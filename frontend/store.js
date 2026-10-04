// Offline-first storage: IndexedDB key-value + append-only event log, and idempotent sync.
const DB_NAME = 'khelsetu', VER = 1;
let _db;
function open() {
  if (_db) return _db;
  _db = new Promise((res, rej) => {
    const r = indexedDB.open(DB_NAME, VER);
    r.onupgradeneeded = () => {
      const d = r.result;
      d.createObjectStore('kv');
      const ev = d.createObjectStore('events', { keyPath: 'id' });
      ev.createIndex('synced', 'synced');
    };
    r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error);
  });
  return _db;
}
const tx = async (store, mode, fn) => {
  const d = await open();
  return new Promise((res, rej) => { const t = d.transaction(store, mode); const out = fn(t.objectStore(store)); t.oncomplete = () => res(out && typeof out === 'object' && 'result' in out ? out.result : out); t.onerror = () => rej(t.error); });
};
export const kvGet = (k) => tx('kv', 'readonly', (s) => s.get(k));
export const kvSet = (k, v) => tx('kv', 'readwrite', (s) => s.put(v, k));
export const uuid = () => (crypto.randomUUID ? crypto.randomUUID() : 'e-' + Date.now().toString(36) + Math.random().toString(36).slice(2, 10));

let _deviceKeyPair = null;
export async function getDevicePublicKey() {
  if (!_deviceKeyPair && window.crypto?.subtle) {
    try {
      _deviceKeyPair = await window.crypto.subtle.generateKey(
        { name: 'ECDSA', namedCurve: 'P-256' },
        true,
        ['sign', 'verify']
      );
    } catch {}
  }
  if (_deviceKeyPair?.publicKey) {
    try {
      const exported = await window.crypto.subtle.exportKey('jwk', _deviceKeyPair.publicKey);
      return JSON.stringify(exported);
    } catch {}
  }
  return null;
}

export async function signEvent(e) {
  if (!_deviceKeyPair?.privateKey || !window.crypto?.subtle) return null;
  try {
    const enc = new TextEncoder();
    const data = enc.encode(`${e.id}:${e.type}:${e.ts}:${JSON.stringify(e.payload)}`);
    const sig = await window.crypto.subtle.sign({ name: 'ECDSA', hash: { name: 'SHA-256' } }, _deviceKeyPair.privateKey, data);
    return btoa(String.fromCharCode(...new Uint8Array(sig)));
  } catch {
    return null;
  }
}

/** Append an immutable event. Never edited afterwards, so sync cannot conflict. */
export async function addEvent(type, payload, ts = Date.now()) {
  const e = { id: uuid(), type, ts, payload, synced: 0 };
  const sig = await signEvent(e);
  if (sig) e.sig = sig;
  await tx('events', 'readwrite', (s) => s.add(e));
  window.dispatchEvent(new CustomEvent('ks-event'));
  return e;
}
export const allEvents = () => tx('events', 'readonly', (s) => s.getAll());
export async function unsynced() { return (await allEvents()).filter((e) => !e.synced); }
export async function markSynced(ids, status = 1) {
  const d = await open();
  return new Promise((res, rej) => {
    const t = d.transaction('events', 'readwrite'); const s = t.objectStore('events');
    ids.forEach((id) => { const g = s.get(id); g.onsuccess = () => { if (g.result) { g.result.synced = status; s.put(g.result); } }; });
    t.oncomplete = res; t.onerror = () => rej(t.error);
  });
}
export const resetDeviceKey = () => { _deviceKeyPair = null; };
/** Log-out helper: drops the signed-in user's events and cached data but keeps device settings (theme, language, ...). */
export async function clearUserData(keep = ['prefs', 'lang']) {
  const d = await open();
  await new Promise((res, rej) => {
    const t = d.transaction(['kv', 'events'], 'readwrite');
    const kv = t.objectStore('kv');
    const keys = kv.getAllKeys();
    keys.onsuccess = () => keys.result.forEach((k) => { if (!keep.includes(k)) kv.delete(k); });
    t.objectStore('events').clear();
    t.oncomplete = res; t.onerror = () => rej(t.error);
  });
  resetDeviceKey(); // the next user registers with a fresh signing key
}
export async function wipeAll() {
  const d = await open();
  await new Promise((res) => { const t = d.transaction(['kv', 'events'], 'readwrite'); t.objectStore('kv').clear(); t.objectStore('events').clear(); t.oncomplete = res; });
}

// ---- sync ----
export const net = { forceOffline: false, lastSync: null, listeners: new Set() };
const notify = () => net.listeners.forEach((f) => f());
export const isOnline = () => !net.forceOffline && navigator.onLine;

export async function api(path, { method = 'GET', body, token } = {}) {
  if (!isOnline()) throw new Error('offline');
  const r = await fetch(path, { method, headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: 'Bearer ' + token } : {}) }, body: body ? JSON.stringify(body) : undefined });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) { const err = new Error(j.detail || r.statusText); err.status = r.status; throw err; }
  return j;
}

let syncing = false;
export async function trySync() {
  if (syncing || !isOnline()) return { skipped: true };
  const token = await kvGet('token'); if (!token) return { skipped: true };
  syncing = true;
  try {
    const pending = await unsynced(); let accepted = 0, rejected = 0;
    for (let i = 0; i < pending.length; i += 200) {
      const batch = pending.slice(i, i + 200);
      const res = await api('/api/sync', { method: 'POST', token, body: { events: batch.map(({ id, type, ts, payload, sig }) => ({ id, type, ts, payload, sig })) } });
      await markSynced(res.accepted, 1); await markSynced(res.rejected.map((r) => r.id), 2); // 2 = rejected by server, never retried
      accepted += res.accepted.length; rejected += res.rejected.length;
    }
    net.lastSync = Date.now(); notify(); return { accepted, rejected };
  } catch (e) { return { error: e.message }; } finally { syncing = false; notify(); }
}
window.addEventListener('online', () => trySync());
window.addEventListener('ks-event', () => setTimeout(trySync, 300));
setInterval(trySync, 20000);
