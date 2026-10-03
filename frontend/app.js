import { RepTest, BalanceTest, TEST_CONFIG, baselineFrom, weeklyGoal, DAILY_CREDIT_CAP_MIN, UNVERIFIED_WEIGHT, BANDS, ACTIVE_DAY_MIN, CALENDAR_WEEKS, istDayNumber, dailyCredits, streakStats, buildCalendar, dayNumberToISO } from './engine.js';
import { kvGet, kvSet, addEvent, allEvents, unsynced, wipeAll, trySync, api, net, isOnline, getDevicePublicKey } from './store.js';
import { t, setLang, getLang, STR } from './i18n.js';
import { createSource } from './pose.js';

const $ = (s, el = document) => el.querySelector(s);
const app = $('#app');
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const S = {
  profile: null,
  token: null,
  route: 'home',
  opts: { modified: false, silhouette: true, sim: false, badAttempt: false, voice: true },
  prefs: { theme: 'dark', haptics: true, kindness_mode: false, board_opt_out: false, alias: '', avatar: '🏃' },
  run: null
};
const CONSENT_VERSION = '2026-10-v1';

// ---------------------------------------------------------------- haptics & theme
function haptic(ms = 25) {
  if (S.prefs.haptics && 'vibrate' in navigator) {
    try { navigator.vibrate(ms); } catch {}
  }
}

function applyTheme(th) {
  S.prefs.theme = th;
  document.documentElement.setAttribute('data-theme', th);
  // Update theme-color meta
  const metaDark = document.querySelector('meta[name=theme-color][media*=dark]');
  const metaLight = document.querySelector('meta[name=theme-color][media*=light]');
  if (th === 'dark')  { if (metaDark) metaDark.content = '#07100D'; if (metaLight) metaLight.content = '#07100D'; }
  if (th === 'light') { if (metaDark) metaDark.content = '#F4F8F5'; if (metaLight) metaLight.content = '#F4F8F5'; }
  if (th === 'hc')    { if (metaDark) metaDark.content = '#FFFFFF';  if (metaLight) metaLight.content = '#FFFFFF'; }
  // Update icon: dark = sun, light = moon, hc = contrast circle
  const icon = $('#themeIcon');
  if (icon) {
    if (th === 'dark') {
      icon.outerHTML = `<svg id="themeIcon" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="5"/><line x1="12" y1="1" x2="12" y2="3"/><line x1="12" y1="21" x2="12" y2="23"/><line x1="4.22" y1="4.22" x2="5.64" y2="5.64"/><line x1="18.36" y1="18.36" x2="19.78" y2="19.78"/><line x1="1" y1="12" x2="3" y2="12"/><line x1="21" y1="12" x2="23" y2="12"/><line x1="4.22" y1="19.78" x2="5.64" y2="18.36"/><line x1="18.36" y1="5.64" x2="19.78" y2="4.22"/></svg>`;
    } else {
      icon.outerHTML = `<svg id="themeIcon" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/></svg>`;
    }
  }
}

// ---------------------------------------------------------------- speech
function speak(txt) {
  if (!('speechSynthesis' in window) || !S.opts.voice) return;
  try {
    window.speechSynthesis.cancel();
    const u = new SpeechSynthesisUtterance(txt);
    u.lang = getLang() === 'hi' ? 'hi-IN' : 'en-IN';
    u.rate = 1.05;
    window.speechSynthesis.speak(u);
  } catch {}
}

// ---------------------------------------------------------------- celebration confetti — Neon Arena palette
function celebrate() {
  // Skip under reduced motion
  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  if (document.documentElement.dataset.reduceMotion === '1') return;
  const cv = $('#celebrationCanvas');
  if (!cv) return;
  const ctx = cv.getContext('2d');
  cv.width = window.innerWidth;
  cv.height = window.innerHeight;
  const count = 60; // hard cap <=60 per spec
  const particles = [];
  const colors = ['#2EE6A6', '#C6FF3D', '#FFC21A', '#4CC9F0', '#FF5FA2', '#8B7BFF', '#FF9F43'];
  for (let i = 0; i < count; i++) {
    particles.push({
      x: cv.width / 2,
      y: cv.height * 0.4,
      vx: (Math.random() - 0.5) * 14,
      vy: (Math.random() - 0.8) * 16,
      size: Math.random() * 9 + 4,
      color: colors[Math.floor(Math.random() * colors.length)],
      alpha: 1,
      decay: Math.random() * 0.018 + 0.012,
      rot: Math.random() * 360,
      vrot: (Math.random() - 0.5) * 12
    });
  }
  let raf;
  const loop = () => {
    ctx.clearRect(0, 0, cv.width, cv.height);
    let active = 0;
    for (const p of particles) {
      if (p.alpha <= 0) continue;
      active++;
      p.x += p.vx; p.y += p.vy; p.vy += 0.38;
      p.alpha -= p.decay; p.rot += p.vrot;
      ctx.save();
      ctx.translate(p.x, p.y);
      ctx.rotate((p.rot * Math.PI) / 180);
      ctx.fillStyle = p.color;
      ctx.globalAlpha = Math.max(0, p.alpha);
      ctx.fillRect(-p.size / 2, -p.size / 2, p.size, p.size * 0.55);
      ctx.restore();
    }
    if (active > 0) { raf = requestAnimationFrame(loop); }
    else { ctx.clearRect(0, 0, cv.width, cv.height); cancelAnimationFrame(raf); }
  };
  loop();
}

// ---------------------------------------------------------------- local week maths (mirrors the server, works offline)
const IST = 19800000, DAY = 86400000;
const weekStartMs = (ts) => {
  const d = new Date(ts + IST);
  const dow = (d.getUTCDay() + 6) % 7;
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()) - dow * DAY - IST;
};

async function localState() {
  const ev = (await allEvents().catch(() => [])) || [];
  const evList = Array.isArray(ev) ? ev : [];
  const ws = weekStartMs(Date.now());
  const perDay = Array(7).fill(0);
  evList.filter((e) => e && e.type === 'activity' && e.ts >= ws && e.ts < ws + 7 * DAY).forEach((e) => {
    const dIdx = Math.floor((e.ts - ws) / DAY);
    if (dIdx >= 0 && dIdx < 7 && e.payload) {
      perDay[dIdx] += (e.payload.minutes || 0) * (e.payload.verified ? 1 : UNVERIFIED_WEIGHT);
    }
  });
  const credited = perDay.map((v) => Math.min(v, DAILY_CREDIT_CAP_MIN));
  const baseList = evList.filter((e) => e && e.type === 'baseline');
  const base = baseList.length > 0 ? baseList.sort((a, b) => (b.ts || 0) - (a.ts || 0))[0] : null;
  const weeks = base ? Math.max(0, Math.floor((ws - weekStartMs(base.ts || Date.now())) / (7 * DAY))) : 0;
  const goal = (base && base.payload) ? weeklyGoal(base.payload.band, weeks, base.payload.gentle) : null;
  const latest = {};
  evList.filter((e) => e && e.type === 'assessment').sort((a, b) => (a.ts || 0) - (b.ts || 0)).forEach((e) => { if (e.payload?.kind) latest[e.payload.kind] = e.payload; });
  
  // Streak calculation (days with >=10 credited mins, rest days protected)
  const activeDaysThisWeek = credited.filter((v) => v >= ACTIVE_DAY_MIN).length;

  // Daily streak + GitHub-style calendar (all-time history, computed offline from the local event log)
  const dayMap = dailyCredits(evList);
  const todayNum = istDayNumber(Date.now());
  const streak = streakStats(dayMap, todayNum);
  const calendar = buildCalendar(dayMap, todayNum, CALENDAR_WEEKS);
  
  // Retest records
  const retests = evList.filter((e) => e && e.type === 'baseline');
  const hasRetest = retests.length > 1;

  return {
    ev: evList,
    credited,
    total: credited.reduce((a, b) => a + b, 0),
    base: base?.payload,
    goal,
    todayIdx: Math.max(0, Math.min(6, Math.floor((Date.now() - ws) / DAY))),
    latest,
    activeDaysThisWeek,
    streak,
    calendar,
    hasRetest
  };
}

async function recomputeBaseline() {
  const { latest, base: oldBase } = await localState();
  const r = baselineFrom({ squat: latest.squat?.value, pushup: latest.pushup?.value, modifiedPushup: latest.pushup?.modified, balanceMs: latest.balance?.value });
  if (!r) return null;
  await addEvent('baseline', { band: r.band, index: r.index, gentle: !!S.profile?.gentle });
  if (oldBase && oldBase.index !== undefined && oldBase.index !== r.index) {
    if (isOnline() && S.token) {
      try {
        await api('/api/retest/record', { method: 'POST', token: S.token, body: { old_index: oldBase.index, new_index: r.index } });
      } catch {}
    }
  }
  return { ...r, oldIndex: oldBase?.index };
}

// ---------------------------------------------------------------- chrome & navigation (Neon Arena)
const NAV_ITEMS = [
  { k: 'home',        icon: 'M3 11l9-8 9 8v9a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z' },
  { k: 'fitcheck',   icon: 'M4 12h3l2-6 4 12 2-6h5', special: true },
  { k: 'squad',      icon: 'M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8zm14 0a4 4 0 0 0-3.4-4M23 21v-2a4 4 0 0 0-3-3.87' },
  { k: 'leaderboard',icon: 'M18 20V10M12 20V4M6 20v-6' },
  { k: 'privacy',    icon: 'M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6z' }
];

function navTabsHTML() {
  return NAV_ITEMS.map(({ k, icon, special }) => {
    const active = tabOf(S.route) === k;
    const cls = `${special ? 'nav-fitcheck ' : ''}${active ? '' : ''}`;
    return `<button class="${cls}" data-r="${k}" ${active ? 'aria-current="page"' : ''} aria-label="${t(k)}" data-testid="nav-${k}">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="${icon}"/></svg>
      <span>${t(k === 'fitcheck' ? 'fitcheck' : k)}</span>
    </button>`;
  }).join('');
}

async function chrome() {
  const brand = $('#brandName');
  if (brand) brand.textContent = t('app');
  const tabs = $('#tabs');
  const fab = $('#assistantFab');
  const feedBtn = $('#feedHeaderBtn');
  const chatBtn = $('#chatHeaderBtn');
  const hasProfile = Boolean(S.profile && S.token);

  if (fab) fab.hidden = !hasProfile;
  if (feedBtn) feedBtn.hidden = !hasProfile;
  if (chatBtn) chatBtn.hidden = !hasProfile;

  if (!hasProfile) {
    if (tabs) tabs.hidden = true;
  } else {
    if (tabs) {
      tabs.hidden = false;
      tabs.innerHTML = navTabsHTML();
      tabs.querySelectorAll('button[data-r]').forEach((b) => b.onclick = () => { haptic(20); go(b.dataset.r); });
    }
  }
  try {
    const pend = (await unsynced().catch(() => []))?.length || 0;
    const on = isOnline();
    const chip = $('#netChip');
    if (chip) {
      chip.className = 'chip net-chip' + (on ? '' : ' off');
      chip.innerHTML = `<i></i>${on ? t('online') : t('offline')}${pend ? ` · ${pend}` : ''}`;
      chip.title = `${t('lastSynced')}: ${net.lastSync ? new Date(net.lastSync).toLocaleTimeString() : t('never')}${pend ? ` · ${pend} ${t('pending')}` : ''}`;
    }
  } catch {}
}

const tabOf = (r) => (['home', 'log'].includes(r) ? 'home' : ['fitcheck', 'setup', 'run', 'result'].includes(r) ? 'fitcheck' : r);
net.listeners.add(chrome);
window.addEventListener('online', chrome);
window.addEventListener('offline', chrome);
window.addEventListener('ks-event', chrome);

$('#netChip').onclick = () => {
  haptic(25);
  trySync().then(chrome);
  toast(`${t('lastSynced')}: ${net.lastSync ? new Date(net.lastSync).toLocaleTimeString() : t('never')}`);
};

const feedHeaderBtn = $('#feedHeaderBtn');
if (feedHeaderBtn) {
  feedHeaderBtn.onclick = () => {
    haptic(20);
    go('feed');
  };
}

const assistantFab = $('#assistantFab');
if (assistantFab) {
  assistantFab.onclick = () => {
    haptic(25);
    openAssistantModal();
  };
}

const chatHeaderBtn = $('#chatHeaderBtn');
if (chatHeaderBtn) {
  chatHeaderBtn.onclick = () => {
    haptic(20);
    go('chat');
  };
}

const themeBtn = $('#themeToggle');
if (themeBtn) {
  themeBtn.onclick = async () => {
    haptic(20);
    const nxt = S.prefs.theme === 'dark' ? 'light' : 'dark';
    applyTheme(nxt);
    await kvSet('prefs', S.prefs);
    if (isOnline() && S.token) {
      try { await api('/api/user/preferences', { method: 'POST', token: S.token, body: S.prefs }); } catch {}
    }
  };
}

function toast(msg, ms = 2600) {
  const d = document.createElement('div');
  d.className = 'toast';
  d.textContent = msg;
  d.setAttribute('role', 'status');
  document.body.appendChild(d);
  setTimeout(() => d.remove(), ms);
}

function stopRun() {
  if (S.run) {
    S.run.cancelled = true;
    S.run.src?.stop();
    S.run = null;
  }
}

export async function go(route, arg) {
  stopRun();
  S.route = route;
  S.arg = arg;
  try {
    await chrome();
  } catch (e) {
    console.warn('Chrome error:', e);
  }
  try {
    const viewFn = VIEWS[route] || VIEWS.home || viewOnboard;
    await viewFn(arg);
  } catch (err) {
    console.error('Route error:', err);
    if (app) {
      app.innerHTML = `
        <div class="card" style="border-left:4px solid var(--crimson); margin-top:20px;">
          <h2>Application Error</h2>
          <p class="muted">${esc(err?.message || 'Failed to display view')}</p>
          <button class="btn ok" id="resetAppErrBtn">Reset Session</button>
        </div>
      `;
      const rBtn = $('#resetAppErrBtn');
      if (rBtn) rBtn.onclick = () => { wipeAll().then(() => location.reload()); };
    }
  }
  try {
    app?.focus({ preventScroll: true });
    window.scrollTo(0, 0);
  } catch {}
}

// ---------------------------------------------------------------- onboarding
const ob = { step: 1, name: '', code: 'DEMO', group: '', year: '', age18: false, c1: true, c2: true, parq: Array(7).fill(null), startTime: Date.now() };

function viewOnboard() {
  if (ob.step === 1) {
    ob.startTime = Date.now();
    const langs = Object.keys(STR).map((l) => `<option value="${l}" ${getLang() === l ? 'selected' : ''}>${l === 'en' ? 'English' : 'हिन्दी'}</option>`).join('');
    app.innerHTML = `
      <div style="display:flex; justify-content:space-between; align-items:center;">
        <span class="pill ok">Step 1 of 3</span>
        <span class="muted small">Quick Onboarding</span>
      </div>
      <h1 style="margin-top:8px">${t('welcome')}</h1>
      <p class="muted">${t('tagline')}</p>
      <label for="lang">${t('lang')}</label><select id="lang">${langs}</select>
      <label for="name">${t('yourName')}</label><input id="name" autocomplete="given-name" maxlength="40" value="${esc(ob.name)}">
      <label for="code">${t('college')}</label><input id="code" autocapitalize="characters" maxlength="20" value="${esc(ob.code)}"><p class="muted small">${t('collegeHint')}</p>
      <label for="group">${t('group')}</label><input id="group" maxlength="40" placeholder="Hostel A / CSE-2" value="${esc(ob.group)}">
      <label for="year">${t('year')}</label><select id="year">${['', 1, 2, 3, 4].map((y) => `<option ${String(ob.year) === String(y) ? 'selected' : ''}>${y}</option>`).join('')}</select>
      <label class="check"><input type="checkbox" id="age" ${ob.age18 ? 'checked' : ''}><span>${t('age18')}<br><span class="muted small">${t('ageNote')}</span></span></label>
      <button class="btn" id="next">${t('next')}</button>
      <div id="err" class="muted" role="alert"></div>`;
    $('#lang').onchange = async (e) => {
      setLang(e.target.value);
      await kvSet('lang', e.target.value);
      readOb();
      chrome();
      viewOnboard();
    };
    $('#next').onclick = () => {
      haptic(25);
      readOb();
      if (!ob.name.trim() || !ob.code.trim() || !ob.group.trim() || !ob.age18) {
        $('#err').textContent = '⚠ ' + [t('yourName'), t('college'), t('group'), t('age18')].join(' / ');
        return;
      }
      ob.step = 2;
      viewOnboard();
    };
  } else if (ob.step === 2) {
    app.innerHTML = `
      <div style="display:flex; justify-content:space-between; align-items:center;">
        <span class="pill ok">Step 2 of 3</span>
        <span class="muted small">Privacy Guarantees</span>
      </div>
      <h1 style="margin-top:8px">${t('consentTitle')}</h1>
      <div class="card"><ul class="clean"><li>${t('c1')}</li><li>${t('c2')}</li><li>${t('c3')}</li></ul></div>
      <label class="check"><input type="checkbox" id="c1" ${ob.c1 ? 'checked' : ''}><span>${t('consentAssess')}</span></label>
      <label class="check"><input type="checkbox" id="c2" ${ob.c2 ? 'checked' : ''}><span>${t('consentActivity')}</span></label>
      <button class="btn" id="next">${t('consentHere')}</button>
      <button class="btn alt" id="back">${t('back')}</button>`;
    $('#back').onclick = () => { haptic(15); ob.step = 1; viewOnboard(); };
    $('#next').onclick = () => {
      haptic(25);
      ob.c1 = $('#c1').checked;
      ob.c2 = $('#c2').checked;
      if (!ob.c1 || !ob.c2) return toast(t('consentTitle'));
      ob.step = 3;
      viewOnboard();
    };
  } else {
    app.innerHTML = `
      <div style="display:flex; justify-content:space-between; align-items:center;">
        <span class="pill ok">Step 3 of 3</span>
        <span class="muted small">Health Screening</span>
      </div>
      <h1 style="margin-top:8px">${t('parqTitle')}</h1>
      <p class="muted">${t('parqNote')}</p>` +
      t('parq').map((q, i) => `<div><p>${esc(q)}</p><div class="yn" data-i="${i}"><button aria-pressed="${ob.parq[i] === true}" data-v="1">${t('yes')}</button><button aria-pressed="${ob.parq[i] === false}" data-v="0">${t('no')}</button></div></div>`).join('') +
      `<div id="advice" class="card" hidden>${t('parqAdvice')}</div>
       <button class="btn" id="finish" disabled>${t('start')}</button>
       <button class="btn alt" id="back">${t('back')}</button>
       <div id="err" class="muted" role="alert"></div>`;
    const upd = () => {
      const any = ob.parq.some((v) => v === true);
      $('#advice').hidden = !any;
      $('#finish').disabled = ob.parq.some((v) => v === null);
    };
    app.querySelectorAll('.yn').forEach((g) => g.querySelectorAll('button').forEach((b) => b.onclick = () => {
      haptic(15);
      ob.parq[+g.dataset.i] = b.dataset.v === '1';
      g.querySelectorAll('button').forEach((x) => x.setAttribute('aria-pressed', x === b));
      upd();
    }));
    upd();
    $('#back').onclick = () => { haptic(15); ob.step = 2; viewOnboard(); };
    $('#finish').onclick = () => { haptic(35); register(); };
  }
}

function readOb() {
  ob.name = $('#name')?.value ?? ob.name;
  ob.code = $('#code')?.value ?? ob.code;
  ob.group = $('#group')?.value ?? ob.group;
  ob.year = $('#year')?.value ?? ob.year;
  ob.age18 = $('#age')?.checked ?? ob.age18;
}

async function register() {
  const gentle = ob.parq.some((v) => v === true);
  const elapsedSec = Math.max(1, Math.round((Date.now() - ob.startTime) / 1000));
  try {
    const pubKey = await getDevicePublicKey();
    const r = await api('/api/register', {
      method: 'POST',
      body: {
        name: ob.name.trim(),
        institution_code: ob.code.trim(),
        group: ob.group.trim(),
        year: ob.year ? +ob.year : null,
        age_confirmed_18: ob.age18,
        consent_version: CONSENT_VERSION,
        purposes: ['fitness_assessment', 'activity_tracking'],
        screening_cleared: !gentle,
        gentle,
        public_key: pubKey
      }
    });
    S.profile = { name: ob.name.trim(), group: ob.group.trim(), gentle, institution: r.institution };
    S.token = r.token;
    await kvSet('profile', S.profile);
    await kvSet('token', r.token);
    await kvSet('ob_completion_sec', elapsedSec);
    ob.parq.fill(null);
    toast(`${t('onboardingTime')}: ${elapsedSec}s`);
    go('home');
  } catch (e) {
    $('#err').textContent = e.message === 'offline' ? t('needOnlineRegister') : `${t('registerFail')}: ${e.message}`;
  }
}

// ---------------------------------------------------------------- streak calendar (GitHub-style contribution grid)
function calendarCardHTML(st) {
  const { columns, activeInWindow } = st.calendar;
  const lang = getLang() === 'hi' ? 'hi-IN' : 'en-IN';
  const monthFmt = new Intl.DateTimeFormat(lang, { month: 'short', timeZone: 'UTC' });
  const wkFmt = new Intl.DateTimeFormat(lang, { weekday: 'short', timeZone: 'UTC' });
  const dayNames = Array.from({ length: 7 }, (_, i) => wkFmt.format(new Date(Date.UTC(2026, 9, 5 + i)))); // 2026-10-05 is a Monday

  // Month labels sit above the first column of each month; skip one that would collide with the previous label.
  let lastLabelCol = -9;
  const monthLabels = columns.map((c, i) => {
    if (c.month === null || i - lastLabelCol < 3) return '';
    lastLabelCol = i;
    return `<span class="cal-month" style="grid-column:${i + 2};grid-row:1">${monthFmt.format(new Date(Date.UTC(2026, c.month, 1)))}</span>`;
  }).join('');
  const weekdayLabels = [0, 2, 4].map((r) => `<span class="cal-dow" style="grid-column:1;grid-row:${r + 2}">${dayNames[r]}</span>`).join('');
  const cells = columns.map((c, i) => c.days.map((d, r) => d.future ? '' :
    `<div class="cal-cell lv${d.level}${d.today ? ' today' : ''}" data-day="${d.day}" data-mins="${d.mins}" style="grid-column:${i + 2};grid-row:${r + 2}" aria-hidden="true"></div>`
  ).join('')).join('');
  const summary = `${t('calTitle')}: ${activeInWindow} ${t('calActiveDays')}, ${st.streak.current} ${t('dayStreak')}`;

  return `
    <div class="card cal-card" data-testid="streak-calendar">
      <div class="cal-head">
        <div>
          <div class="bold" style="font-family:var(--font-display)">${t('calTitle')}</div>
          <div class="muted small">${t('calSub').replace('{n}', ACTIVE_DAY_MIN).replace('{w}', CALENDAR_WEEKS)}</div>
        </div>
      </div>
      <div class="cal-stats">
        <div><b data-testid="streak-current">${st.streak.current}</b><span>${t('streakCurrent')}</span></div>
        <div><b data-testid="streak-longest">${st.streak.longest}</b><span>${t('streakLongest')}</span></div>
        <div><b>${activeInWindow}</b><span>${t('calActiveDays')}</span></div>
      </div>
      <div class="cal-scroll">
        <div class="cal-grid" role="img" aria-label="${summary}" style="--weeks:${columns.length}">
          ${monthLabels}${weekdayLabels}${cells}
        </div>
      </div>
      <div class="cal-foot">
        <span class="muted small">${t('calRestNote')}</span>
        <span class="cal-legend" aria-hidden="true">${t('calLess')}
          ${[0, 1, 2, 3, 4].map((l) => `<i class="cal-cell lv${l}"></i>`).join('')}
          ${t('calMore')}</span>
      </div>
    </div>`;
}

function wireCalendar() {
  const grid = $('.cal-grid');
  if (!grid) return;
  grid.addEventListener('click', (e) => {
    const c = e.target.closest('.cal-cell[data-day]');
    if (!c) return;
    const date = new Intl.DateTimeFormat(getLang() === 'hi' ? 'hi-IN' : 'en-IN', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' }).format(new Date(dayNumberToISO(Number(c.dataset.day)) + 'T00:00:00Z'));
    toast(`${date}: ${c.dataset.mins} ${t('minutes')}`);
  });
}

// ---------------------------------------------------------------- home: Neon Arena bento redesign
const dayLabels = () => Array.from({ length: 7 }, (_, i) => new Intl.DateTimeFormat(getLang() === 'hi' ? 'hi-IN' : 'en-IN', { weekday: 'narrow', timeZone: 'UTC' }).format(new Date(Date.UTC(2026, 9, 5 + i))));

async function viewHome() {
  const st = await localState();
  const planks = st.credited.map((v, i) => {
    const isToday = (i === st.todayIdx);
    const isRest  = (v === 0 && i < st.todayIdx);
    return `<div class="plank ${isToday ? 'today' : ''} ${v === 0 ? 'empty' : ''} ${isRest ? 'rest' : ''}" title="${Math.round(v)} ${t('minutes')}" role="presentation">
      <div class="fill" style="height:${Math.max(6, Math.round(Math.min(1, v / DAILY_CREDIT_CAP_MIN) * 100))}%"></div>
    </div>`;
  }).join('');

  const pct = st.goal ? Math.min(100, Math.round((st.total / st.goal) * 100)) : 0;
  if (pct >= 100) { setTimeout(celebrate, 300); }

  // Goal status copy — encouraging, never shaming
  const remaining = st.goal ? Math.max(0, st.goal - Math.round(st.total)) : 0;
  const activeDays = st.activeDaysThisWeek;
  const statusMsg = !st.goal ? t('noBaseline')
    : pct >= 100 ? '🎉 ' + (t('goalReached') || 'Goal reached! Great week!')
    : remaining <= 20 ? '🔥 ' + (t('almostThere') || `Just ${remaining} min to go!`)
    : activeDays >= 3 ? '💪 ' + (t('goodProgress') || `${activeDays} active days — keep it up!`)
    : '🌱 ' + (t('justStart') || `Every minute counts. You've got this.`);

  // Badges
  const BADGE_SVG = {
    consistency: '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/></svg>',
    comeback:    '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2"><path d="M13 2L3 14h9l-1 8 10-12h-9l1-8z"/></svg>',
    retest:      '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>',
    squad:       '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>'
  };
  const badges = [
    { id: 'consistency', earned: activeDays >= 3,                       name: t('b_consistency'), desc: t('b_consistency_desc') },
    { id: 'comeback',    earned: st.credited.some((v) => v > 0),        name: t('b_comeback'),    desc: t('b_comeback_desc') },
    { id: 'retest',      earned: st.hasRetest,                           name: t('b_retest'),      desc: t('b_retest_desc') },
    { id: 'squad',       earned: !!S.profile,                           name: t('b_squad'),       desc: t('b_squad_desc') }
  ];

  // Streak chip: consecutive active days (one rest day in a row never breaks it)
  const streakN = st.streak.current;
  const streakChip = streakN > 0
    ? `<span class="streak-chip" data-testid="streak-chip" aria-label="${streakN} ${t('dayStreak')}" title="${t('streakProtectedHint')}">🔥 ${streakN} ${t('dayStreak')}</span>`
    : `<span class="streak-chip" data-testid="streak-chip" style="background:rgba(76,201,240,.12);border-color:rgba(76,201,240,.25);color:var(--sky)" title="${t('streakProtectedHint')}">🛡 ${t('streakFrozen')}</span>`;

  app.innerHTML = `
    <!-- Greeting Row -->
    <div class="greeting-row">
      <div class="avatar xl" aria-hidden="true">${esc(S.prefs.avatar || '🏃')}</div>
      <div class="greeting-text">
        <div class="hey">${t('online') ? '' : ''}${t('thisWeek')}</div>
        <div class="name">${t('hey') || 'Hey,'} ${esc(S.profile?.name?.split(' ')[0] || 'Athlete')} 👋</div>
      </div>
      ${streakChip}
    </div>

    <!-- Hero Bridge Card -->
    <div class="hero-card" role="region" aria-label="${t('thisWeek')} progress">
      <div style="display:flex; justify-content:space-between; align-items:flex-start; gap:12px; margin-bottom:8px">
        <div>
          <div class="big" id="bigNum" aria-live="polite">${Math.round(st.total)}<small>${st.goal ? ` / ${st.goal} ${t('minutes')}` : ` ${t('minutes')}`}</small></div>
          <div class="goal-status">${statusMsg}</div>
        </div>
        ${st.goal ? `
          <div class="ring-wrap" style="width:72px;height:72px" role="progressbar" aria-valuenow="${pct}" aria-valuemin="0" aria-valuemax="100" aria-label="${pct}% ${t('ofGoal')}">
            <svg width="72" height="72" viewBox="0 0 72 72" fill="none" aria-hidden="true">
              <circle class="ring-track" cx="36" cy="36" r="30" stroke-width="6"/>
              <circle class="ring-fill" cx="36" cy="36" r="30" stroke-width="6"
                stroke-dasharray="${(2 * Math.PI * 30).toFixed(1)}"
                stroke-dashoffset="${((1 - pct / 100) * 2 * Math.PI * 30).toFixed(1)}"/>
            </svg>
            <div class="ring-label" style="font-size:0.85rem;font-weight:700">${pct}%</div>
          </div>
        ` : ''}
      </div>

      ${st.goal ? `
        <div class="meter" style="margin:0 0 12px">
          <div style="width:${pct}%" aria-hidden="true"></div>
        </div>
      ` : ''}

      <!-- Bridge visualisation -->
      <div class="bridge" aria-label="7-day activity bridge" role="img">
        <svg class="arch" viewBox="0 0 100 44" preserveAspectRatio="none" aria-hidden="true">
          <defs>
            <linearGradient id="archGrad" x1="0%" y1="0%" x2="100%" y2="0%">
              <stop offset="0%" stop-color="#2EE6A6" stop-opacity=".7"/>
              <stop offset="100%" stop-color="#C6FF3D" stop-opacity=".7"/>
            </linearGradient>
          </defs>
          <path d="M0 38 Q50 -10 100 38" fill="none" stroke="url(#archGrad)" stroke-width="1.5" vector-effect="non-scaling-stroke"/>
        </svg>
        <div class="planks">${planks}</div>
      </div>
      <div class="dlabels" aria-hidden="true">${dayLabels().map((d) => `<span>${d}</span>`).join('')}</div>
    </div>

    <!-- Primary CTA -->
    <button class="btn primary cta-pulse" id="fc" data-testid="home-fitcheck-btn" style="margin:12px 0 6px">
      <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" aria-hidden="true"><path d="M4 12h3l2-6 4 12 2-6h5"/></svg>
      ${st.base ? t('fitcheck') : t('takeFitcheck')}
    </button>
    <button class="btn alt" id="log" data-testid="home-log-btn" style="margin-bottom:16px;">${t('logActive')}</button>

    ${calendarCardHTML(st)}

    <!-- Bento Tiles -->
    <div class="bento" role="list">
      <div class="tile squad wide" id="homeChatBtn" data-testid="home-chat-tile" role="listitem" tabindex="0" aria-label="${t('chat')}">
        <div style="display:flex; align-items:center; gap:10px">
          <div class="tile-icon" style="background:rgba(76,201,240,.12); color:var(--sky)">
            <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>
          </div>
          <span class="tile-label">${t('chat')}</span>
        </div>
        <div class="tile-sub">${t('chatTileHint') || 'Announcements & squad chat'}</div>
      </div>

      <div class="tile feed" id="homeFeedBtn" data-testid="home-feed-tile" role="listitem" tabindex="0" aria-label="${t('feed')}">
        <div class="tile-icon" style="background:rgba(255,95,162,.12); color:var(--coral)">
          <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="18" height="18" rx="3"/><circle cx="8.5" cy="8.5" r="1.5"/><polyline points="21 15 16 10 5 21"/></svg>
        </div>
        <div class="tile-label">${t('feed')}</div>
        <div class="tile-sub">${t('feedTileHint') || 'Gym photos'}</div>
      </div>

      <div class="tile meals" id="homeMealsBtn" data-testid="home-meals-tile" role="listitem" tabindex="0" aria-label="${t('meals')}">
        <div class="tile-icon" style="background:rgba(255,159,67,.12); color:var(--orange)">
          <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 2v7c0 1.1.9 2 2 2h4a2 2 0 0 0 2-2V2"/><path d="M7 2v20"/><path d="M21 15V2a5 5 0 0 0-5 5v6c0 1.1.9 2 2 2h3zm0 0v7"/></svg>
        </div>
        <div class="tile-label">${t('meals')}</div>
        <div class="tile-sub">${t('mealsTileHint') || 'Meal nutrition'}</div>
      </div>

      <div class="tile leaderboard" id="homeBoardBtn" data-testid="home-leaderboard-tile" role="listitem" tabindex="0" aria-label="${t('leaderboard')}">
        <div class="tile-icon" style="background:rgba(255,194,26,.12); color:var(--sun)">
          <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="20" x2="18" y2="10"/><line x1="12" y1="20" x2="12" y2="4"/><line x1="6" y1="20" x2="6" y2="14"/></svg>
        </div>
        <div class="tile-label">${t('leaderboard')}</div>
        <div class="tile-sub">${t('leaderboardTileHint') || 'Fairness boards'}</div>
      </div>

      <div class="tile assistant wide" id="homeAssistantBtn" data-testid="home-assistant-tile" role="listitem" tabindex="0" aria-label="${t('assistant')}">
        <div style="display:flex; align-items:center; gap:10px">
          <div class="tile-icon" style="background:rgba(139,123,255,.15); color:var(--violet)">
            <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="3"/><path d="M12 1v4M12 19v4M4.22 4.22l2.83 2.83M16.95 16.95l2.83 2.83M1 12h4M19 12h4M4.22 19.78l2.83-2.83M16.95 7.05l2.83-2.83"/></svg>
          </div>
          <div>
            <div class="tile-label">${t('assistant')}</div>
            <div class="tile-sub">${t('assistantTileHint') || 'AI coaching · not medical advice'}</div>
          </div>
        </div>
      </div>
    </div>

    <!-- Secondary actions -->
    <button class="btn alt" id="slots" data-testid="home-slots-btn" style="margin-top:4px;">${t('slotsBtn')}</button>

    <!-- Milestones carousel -->
    <div class="section-head">
      <h2>${t('badgesTitle')}</h2>
    </div>
    <div class="badges-grid" role="list" aria-label="${t('badgesTitle')}">
      ${badges.map((b) => `
        <div class="badge-item ${b.earned ? 'earned' : ''}" role="listitem" aria-label="${b.name}: ${b.earned ? 'earned' : 'not yet earned'}">
          <div class="badge-icon" aria-hidden="true">${BADGE_SVG[b.id]}</div>
          <div class="badge-name">${b.name}</div>
        </div>
      `).join('')}
    </div>

    ${st.base ? `
      <div class="card" style="margin-top:12px; display:flex; align-items:center; justify-content:space-between; gap:12px">
        <div>
          <div class="bold" style="font-family:var(--font-display)">${t('startingPoint')}: ${t('band_' + st.base.band)}</div>
          <div class="muted small">${t('provisional')}</div>
        </div>
        <span class="pill ok">${st.base.index}/100</span>
      </div>` : ''}

    ${S.profile?.gentle ? `<p class="muted small" style="margin-top:12px">${t('stopIfPain')}</p>` : ''}
    <div style="height:8px"></div>
  `;

  wireCalendar();

  // Wire up tiles + buttons
  const wire = (id, fn) => { const el = $(`#${id}`); if (el) { el.onclick = fn; el.onkeydown = (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); fn(); } }; } };
  wire('homeFeedBtn',      () => { haptic(25); go('feed'); });
  wire('homeMealsBtn',     () => { haptic(25); go('meals'); });
  wire('homeChatBtn',      () => { haptic(25); go('chat'); });
  wire('homeAssistantBtn', () => { haptic(25); openAssistantModal(); });
  wire('homeBoardBtn',     () => { haptic(25); go('leaderboard'); });
  wire('fc',               () => { haptic(25); go('fitcheck'); });
  wire('log',              () => { haptic(25); go('log'); });
  wire('slots',            () => { haptic(25); go('slots'); });

  // Animate count-up for big number
  const bigNumEl = $('#bigNum');
  if (bigNumEl && st.total > 0) {
    const end = Math.round(st.total);
    let cur = 0;
    const step = () => {
      cur = Math.min(end, cur + Math.max(1, Math.ceil((end - cur) / 6)));
      bigNumEl.firstChild.textContent = cur;
      if (cur < end) requestAnimationFrame(step);
    };
    if (!window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      bigNumEl.firstChild.textContent = '0';
      requestAnimationFrame(step);
    }
  }
}

function viewLog() {
  const acts = ['Walk', 'Run', 'Gym', 'Sport', 'Yoga', 'Cycle', 'Other'];
  app.innerHTML = `
    <h1>${t('logTitle')}</h1>
    <p class="muted">${t('logHint')}</p>
    <div class="card">
      <label for="act">${t('activity')}</label><select id="act">${acts.map((a) => `<option>${a}</option>`).join('')}</select>
      <label for="mins">${t('mins')}</label><input id="mins" type="number" inputmode="numeric" min="1" max="180" value="30">
      <button class="btn" id="save">${t('logSave')}</button>
    </div>
    <div class="card" style="margin-top:16px">
      <h3 style="margin-top:0">${t('officerCheckin')}</h3>
      <p class="muted small">${t('officerCheckinHint')}</p>
      <label for="sessCode">${t('enterCode')}</label>
      <input id="sessCode" maxlength="10" autocapitalize="characters" placeholder="e.g. 4B12">
      <button class="btn" id="chkInBtn" style="margin-top:10px">${t('officerCheckin')}</button>
      <div id="chkErr" class="muted small" role="alert" style="margin-top:6px"></div>
    </div>
    <button class="btn alt" id="back" style="margin-top:12px">${t('back')}</button>`;

  $('#back').onclick = () => { haptic(15); go('home'); };
  $('#save').onclick = async () => {
    haptic(30);
    const m = Math.max(1, Math.min(180, +$('#mins').value || 0));
    await addEvent('activity', { minutes: m, activity: $('#act').value.toLowerCase(), verified: false });
    toast(t('done'));
    go('home');
  };
  $('#chkInBtn').onclick = async () => {
    haptic(30);
    const code = $('#sessCode').value.trim().toUpperCase();
    if (code.length < 2) { $('#chkErr').textContent = 'Enter valid session code'; return; }
    try {
      if (isOnline() && S.token) {
        const res = await api('/api/session/checkin', { method: 'POST', token: S.token, body: { code } });
        await addEvent('activity', { minutes: res.credited_minutes, activity: `verified_${res.title.toLowerCase()}`, verified: true, source: 'officer_qr' });
        toast(`${t('checkinSuccess')} ${res.credited_minutes} ${t('minutes')} (${res.title})`);
      } else {
        await addEvent('activity', { minutes: 45, activity: `officer_session_${code}`, verified: true, source: 'officer_qr', code });
        toast(`${t('checkinSuccess')} 45 ${t('minutes')} (offline queued)`);
      }
      go('home');
    } catch (e) {
      $('#chkErr').textContent = e.message;
    }
  };
}

// ---------------------------------------------------------------- FitCheck HUD & Polish
function viewFitcheck() {
  const tile = (k, mode) => `<button class="test" data-k="${k}" data-m="${mode}"><b>${t('t_' + k)}</b><span>${t('d_' + k)}</span></button>`;
  app.innerHTML = `
    <h1>${t('fitcheck')}</h1>
    <p class="muted">${t('fitcheckDoneHint')}</p>
    <div class="testgrid">${['squat', 'pushup', 'balance', 'arm_raise'].map((k) => tile(k, 'test')).join('')}</div>
    <h2>${t('startSession')}</h2>
    <p class="muted small">${t('sessionHint')}</p>
    <div class="testgrid">${['squat', 'pushup', 'arm_raise'].map((k) => tile(k, 'session')).join('')}</div>
    <p class="muted small" style="margin-top:14px">${t('stopIfPain')}</p>`;
  app.querySelectorAll('.test').forEach((b) => b.onclick = () => {
    haptic(25);
    go('setup', { kind: b.dataset.k, mode: b.dataset.m });
  });
}

function viewSetup({ kind, mode }) {
  const o = S.opts;
  app.innerHTML = `
    <h1>${t('t_' + kind)}</h1>
    <div class="card">${t('setup_' + kind)}</div>
    ${kind === 'pushup' ? `<label class="check"><input type="checkbox" id="mod" ${o.modified ? 'checked' : ''}><span>${t('modified')}</span></label>` : ''}
    <label class="check"><input type="checkbox" id="sil" ${o.silhouette ? 'checked' : ''}><span>${t('silhouette')}</span></label>
    <label class="check"><input type="checkbox" id="vc" ${o.voice ? 'checked' : ''}><span>${t('voiceCues')}</span></label>
    <button class="btn" id="go">${t('start')}</button>
    <button class="btn alt" id="sim">${t('useSim')}</button>
    <label class="check"><input type="checkbox" id="bad" ${o.badAttempt ? 'checked' : ''}><span class="muted small">Demo: simulate the person leaving the frame (integrity gate)</span></label>
    <button class="btn alt" id="back">${t('back')}</button>`;
  const sync = () => {
    o.modified = $('#mod')?.checked ?? false;
    o.silhouette = $('#sil').checked;
    o.voice = $('#vc').checked;
    o.badAttempt = $('#bad').checked;
  };
  $('#go').onclick = () => { haptic(30); sync(); o.sim = false; go('run', { kind, mode }); };
  $('#sim').onclick = () => { haptic(30); sync(); o.sim = true; go('run', { kind, mode }); };
  $('#back').onclick = () => { haptic(15); go('fitcheck'); };
}

const LINK = [[11, 12], [11, 13], [13, 15], [12, 14], [14, 16], [11, 23], [12, 24], [23, 24], [23, 25], [25, 27], [24, 26], [26, 28]];
async function viewRun({ kind, mode }) {
  const o = S.opts;
  const hideVideo = o.silhouette || o.sim;
  app.innerHTML = `
    <div class="stage ${o.sim ? '' : 'mirror'}" id="stage">
      <video id="vid" playsinline muted class="${hideVideo ? 'hide' : ''}"></video>
      <canvas id="cv"></canvas>
      <div class="framing-guide"></div>
      <div class="hud">
        <div>
          <div class="count-wrap">
            <span class="count" id="cnt">0</span>
            <span id="sub" class="small muted" style="color:rgba(255,255,255,0.8)"></span>
          </div>
        </div>
        <div class="time" id="tm"></div>
      </div>
      <div class="hint" id="hint"><span class="dot" id="dot"></span><span id="htxt">${t('loadingModel')}</span></div>
      <div class="overlay" id="ov" hidden></div>
    </div>
    <button class="btn alt" id="stop" style="margin-top:12px">${mode === 'session' ? t('stopSession') : t('back')}</button>`;

  const run = { cancelled: false, src: null };
  S.run = run;
  const hint = (txt, on) => { $('#htxt').textContent = txt; $('#dot').classList.toggle('on', !!on); };
  let src;
  try {
    src = await createSource({ sim: o.sim, kind, simOpts: o.badAttempt ? { hideFromMs: 9000 } : {}, videoEl: $('#vid'), onStatus: (k) => hint(t(k)) });
  } catch (e) {
    hint(e.code === 'model_missing' ? t('modelMissing') : e.code === 'cam_denied' ? t('camDenied') : e.message);
    $('#stop').onclick = () => go('setup', { kind, mode });
    return;
  }
  if (run.cancelled) { src.stop(); return; }
  run.src = src;
  $('#stage').style.aspectRatio = String(src.aspect);
  const cv = $('#cv'), g = cv.getContext('2d');
  const isBal = kind === 'balance';
  let probe = isBal ? new BalanceTest() : new RepTest(kind, { modified: o.modified });
  let test = probe, phase = 'ready', readySince = null, cdStart = 0, runStart = 0, lastT = 0, msgUntil = 0, msg = '';
  const dur = TEST_CONFIG[kind].durationMs;

  const draw = (lms) => {
    const w = cv.clientWidth, h = cv.clientHeight;
    if (cv.width !== w) { cv.width = w; cv.height = h; }
    g.clearRect(0, 0, w, h);
    if (hideVideo) { g.fillStyle = '#081C17'; g.fillRect(0, 0, w, h); }
    if (!lms) return;
    g.lineWidth = 4;
    g.strokeStyle = '#F59E0B';
    g.lineCap = 'round';
    for (const [a, b] of LINK) {
      const p = lms[a], q = lms[b];
      if (p && q && (p.visibility ?? 1) > 0.4 && (q.visibility ?? 1) > 0.4) {
        g.beginPath();
        g.moveTo(p.x * w, p.y * h);
        g.lineTo(q.x * w, q.y * h);
        g.stroke();
      }
    }
    g.fillStyle = '#FFFFFF';
    for (const i of [11, 12, 13, 14, 15, 16, 23, 24, 25, 26, 27, 28]) {
      const p = lms[i];
      if (p && (p.visibility ?? 1) > 0.4) {
        g.beginPath();
        g.arc(p.x * w, p.y * h, 5, 0, 7);
        g.fill();
      }
    }
  };

  let lastCdSecond = null;
  let audioCtx = null;
  const getAudio = () => {
    if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    if (audioCtx.state === 'suspended') audioCtx.resume();
    return audioCtx;
  };
  const tone = (freq, dur = 0.08, type = 'sine', vol = 0.1) => {
    try {
      const ctx = getAudio();
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = type; osc.frequency.setValueAtTime(freq, ctx.currentTime);
      gain.gain.setValueAtTime(vol, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + dur);
      osc.connect(gain); gain.connect(ctx.destination);
      osc.start(); osc.stop(ctx.currentTime + dur);
    } catch {}
  };
  const soundRep = () => {
    tone(587, 0.06);
    setTimeout(() => tone(880, 0.1), 50);
    const cntEl = $('#cnt');
    if (cntEl) {
      cntEl.classList.add('pop');
      setTimeout(() => cntEl.classList.remove('pop'), 200);
    }
  };
  const soundReject = () => { tone(220, 0.16, 'sawtooth', 0.12); };
  const soundFinish = () => { [523, 659, 784, 1046].forEach((f, i) => setTimeout(() => tone(f, 0.18, 'sine', 0.12), i * 90)); };

  const finish = () => {
    if (phase === 'done') return;
    phase = 'done';
    const elapsed = performance.now() - runStart;
    run.cancelled = true;
    src.stop();
    soundFinish();
    const summary = isBal ? test.summary() : test.summary(Math.min(elapsed, dur));
    if (mode === 'session') summary.activeMs = activeMs(test.repTimes);
    speak(`${t('result')}: ${summary.value} ${t(summary.unit)}`);
    S.run = null;
    go('result', { kind, mode, summary, modified: o.modified });
  };

  $('#stop').onclick = () => {
    haptic(20);
    if (mode === 'session' && phase === 'running') finish();
    else go(mode === 'session' ? 'fitcheck' : 'setup', { kind, mode });
  };

  const step = (now) => {
    const simT = phase === 'running' ? now - runStart : 0;
    const f = src.next(simT);
    const out = test.process(f.lms, now, { aspect: f.aspect, poses: f.poses, counting: phase === 'running' });
    draw(f.lms);
    if (out.event?.rep) {
      soundRep();
      haptic(35);
      if (out.event.rep % 5 === 0) speak(`${out.event.rep} ${t('reps')}`);
    }
    if (out.event?.rejected) {
      soundReject();
      haptic(50);
      msg = t('r_' + out.event.rejected);
      msgUntil = now + 2500;
      speak(msg);
    }
    if (phase === 'ready') {
      const posture = isBal ? out.valid : kind === 'arm_raise' ? out.valid && out.phase === 'down' : out.valid && out.phase === 'up';
      hint(posture ? '✓' : t('h_' + (out.hint || 'no_person')), posture);
      if (posture) {
        readySince ??= now;
        if (now - readySince > 1000) { phase = 'countdown'; cdStart = now; lastCdSecond = null; }
      } else readySince = null;
    }
    if (phase === 'countdown') {
      const left = 3 - Math.floor((now - cdStart) / 1000);
      if (left !== lastCdSecond) {
        lastCdSecond = left;
        if (left > 0) { tone(440, 0.08); speak(String(left)); haptic(20); }
        else if (left === 0) { tone(880, 0.2); speak(t('go')); haptic(40); }
      }
      $('#ov').hidden = false;
      $('#ov').textContent = left > 0 ? left : t('go');
      hint(t('getReady'), true);
      if (left <= 0 && now - cdStart >= 3000) {
        $('#ov').hidden = true;
        phase = 'running';
        runStart = now;
        if (isBal) test = new BalanceTest();
      }
    } else if (phase === 'running') {
      const el = now - runStart;
      if (isBal) {
        $('#cnt').textContent = (test.holdMs / 1000).toFixed(1);
        $('#sub').textContent = t('hold') + ' (' + t('seconds') + ')';
        $('#tm').textContent = '';
        if (test.done) return finish();
      } else {
        $('#cnt').textContent = test.reps;
        $('#sub').textContent = t('reps');
        $('#tm').textContent = mode === 'session' ? fmt(el) : Math.max(0, Math.ceil((dur - el) / 1000)) + t('seconds');
        if (mode !== 'session' && el >= dur) return finish();
      }
      hint(now < msgUntil ? msg : out.valid ? (out.hint ? t('h_' + out.hint) : '✓') : t('h_' + (out.hint || 'body_not_visible')), out.valid && now >= msgUntil);
    }
  };

  const loop = (ts) => {
    if (run.cancelled) return;
    if (ts - lastT >= 40) { lastT = ts; step(ts); }
    requestAnimationFrame(loop);
  };
  requestAnimationFrame(loop);
}

const fmt = (ms) => `${Math.floor(ms / 60000)}:${String(Math.floor(ms / 1000) % 60).padStart(2, '0')}`;
export function activeMs(times, maxGap = 15000, perRep = 2000) {
  if (!times?.length) return 0;
  let s = perRep;
  for (let i = 1; i < times.length; i++) {
    const d = times[i] - times[i - 1];
    s += d <= maxGap ? d : perRep;
  }
  return s;
}

async function viewResult({ kind, mode, summary: s, modified }) {
  const o = S.opts;
  const cls = s.verdict === 'verified' ? 'ok' : s.verdict === 'low_confidence' ? 'low' : 'bad';
  const valueTxt = kind === 'balance' ? `${(s.value / 1000).toFixed(1)} ${t('seconds')}` : `${s.value} ${t('reps')}`;
  const reasons = (s.reasons || []).map((r) => `<li>${t('why_' + r)}</li>`).join('');
  const sessionMin = mode === 'session' ? Math.round((s.activeMs / 60000) * 10) / 10 : 0;
  const canSave = s.verdict !== 'invalid' && (mode !== 'session' || sessionMin >= 0.2);

  app.innerHTML = `
    <h1>${t('result')}</h1>
    ${o.sim ? `<div style="margin-bottom:8px"><span class="pill low">${t('simSource')}</span></div>` : ''}
    <div class="card">
      <div class="big">${mode === 'session' ? `${sessionMin}<small> ${t('minutes')} · ${s.value} ${t('reps')}</small>` : valueTxt}</div>
      <p style="margin:8px 0">
        <span class="pill ${cls}">✓ ${t(s.verdict)}</span>
        <span class="muted small">${Math.round((s.confidence || 0) * 100)}% confidence</span>
      </p>
      ${reasons ? `<ul class="clean muted">${reasons}</ul>` : ''}
      ${s.verdict === 'invalid' ? `<p class="muted">${t('v_invalid')}</p>` : s.verdict === 'low_confidence' ? `<p class="muted">${t('v_low')}</p>` : ''}
    </div>
    <button class="btn" id="save" ${canSave ? '' : 'disabled'}>${t('saveResult')}</button>
    <button class="btn alt" id="retry">${t('retry')}</button>
    ${mode === 'test' ? `<details style="margin-top:12px"><summary class="muted">${t('manualEntry')}</summary><label for="man">${kind === 'balance' ? t('seconds') : t('reps')}</label><input id="man" type="number" min="0" inputmode="numeric"><button class="btn alt" id="manSave">${t('save')}</button></details>` : ''}`;

  $('#retry').onclick = () => { haptic(15); go('setup', { kind, mode }); };
  $('#save').onclick = async () => {
    haptic(35);
    const srcTag = o.sim ? 'sim' : 'camera';
    if (mode === 'session') {
      await addEvent('activity', { minutes: sessionMin, activity: kind + '_session', verified: s.verdict === 'verified' && !o.sim, reps: s.value, source: srcTag });
    } else {
      await addEvent('assessment', { kind, value: s.value, unit: s.unit, validity: s.verdict, confidence: s.confidence, modified: !!modified, source: srcTag });
      const bRes = await recomputeBaseline();
      if (bRes?.oldIndex !== undefined && bRes.oldIndex !== bRes.index) {
        const delta = bRes.index - bRes.oldIndex;
        toast(`${t('retestDelta')}: ${delta > 0 ? '+' : ''}${delta} ${t('points')}`);
        celebrate();
      }
    }
    toast(t('baselineReady'));
    go('home');
  };

  const ms = $('#manSave');
  if (ms) ms.onclick = async () => {
    haptic(30);
    const n = +$('#man').value;
    if (!(n >= 0)) return;
    await addEvent('assessment', { kind, value: kind === 'balance' ? Math.min(120000, n * 1000) : n, unit: s.unit, validity: 'manual', confidence: 0, modified: !!modified, source: 'manual' });
    await recomputeBaseline();
    go('home');
  };
}

// ---------------------------------------------------------------- Feature B: Leaderboards View
let currentLbTab = 'squads';

async function viewLeaderboard() {
  app.innerHTML = `
    <div style="display:flex; justify-content:space-between; align-items:center;">
      <h1>${t('leaderboard')}</h1>
      <button class="chip" id="lbSettingsBtn" title="Preferences" aria-label="Leaderboard Settings">⚙</button>
    </div>
    <p class="muted small">${t('lb_fairnessNotice')}</p>
    
    <div class="board-tabs" role="tablist">
      <button class="board-tab ${currentLbTab === 'squads' ? 'active' : ''}" data-tab="squads">${t('lb_squads')}</button>
      <button class="board-tab ${currentLbTab === 'departments' ? 'active' : ''}" data-tab="departments">${t('lb_departments')}</button>
      <button class="board-tab ${currentLbTab === 'consistency' ? 'active' : ''}" data-tab="consistency">${t('lb_consistency')}</button>
      <button class="board-tab ${currentLbTab === 'improved' ? 'active' : ''}" data-tab="improved">${t('lb_improved')}</button>
    </div>
    
    <div id="lbContent"><div class="skeleton" style="height:160px"></div></div>
    
    <div id="lbModal" class="card" hidden style="margin-top:16px; border:2px solid var(--court)">
      <h3 style="margin-top:0">Leaderboard Safety & Alias</h3>
      <label class="check">
        <input type="checkbox" id="kindMode" ${S.prefs.kindness_mode ? 'checked' : ''}>
        <span><b>${t('lb_kindnessMode')}</b><br><span class="muted small">Hides leader rankings everywhere, showing only your personal bridge progress.</span></span>
      </label>
      <label class="check">
        <input type="checkbox" id="hideMe" ${S.prefs.board_opt_out ? 'checked' : ''}>
        <span>${t('lb_hideMe')}</span>
      </label>
      <label for="aliasInput">${t('lb_aliasLabel')}</label>
      <input id="aliasInput" maxlength="25" placeholder="e.g. SwiftRunner" value="${esc(S.prefs.alias || '')}">
      <button class="btn" id="saveLbPrefs">${t('save')}</button>
    </div>
    
    <div style="display:flex; justify-content:space-between; align-items:center; margin-top:14px">
      <span class="muted small">${t('lb_resetNote')}</span>
      <span class="pill">${isOnline() ? 'Live' : t('lb_offlineNote')}</span>
    </div>`;

  $('#lbSettingsBtn').onclick = () => {
    haptic(15);
    const m = $('#lbModal');
    m.hidden = !m.hidden;
  };

  $('#saveLbPrefs').onclick = async () => {
    haptic(25);
    S.prefs.kindness_mode = $('#kindMode').checked;
    S.prefs.board_opt_out = $('#hideMe').checked;
    S.prefs.alias = $('#aliasInput').value.trim();
    await kvSet('prefs', S.prefs);
    if (isOnline() && S.token) {
      try { await api('/api/user/preferences', { method: 'POST', token: S.token, body: S.prefs }); } catch {}
    }
    toast(t('done'));
    $('#lbModal').hidden = true;
    renderLbContent();
  };

  app.querySelectorAll('.board-tab').forEach((btn) => {
    btn.onclick = () => {
      haptic(15);
      currentLbTab = btn.dataset.tab;
      app.querySelectorAll('.board-tab').forEach((b) => b.classList.toggle('active', b === btn));
      renderLbContent();
    };
  });

  renderLbContent();
}

async function renderLbContent() {
  const box = $('#lbContent');
  if (!box) return;

  if (S.prefs.kindness_mode) {
    box.innerHTML = `
      <div class="card" style="text-align:center; padding:24px 16px">
        <div style="font-size:2.5rem; margin-bottom:8px">🌱</div>
        <h3>Kindness Mode Active</h3>
        <p class="muted">You have chosen to focus purely on your personal movement habit without comparisons. Keep building your daily bridge!</p>
      </div>`;
    return;
  }

  box.innerHTML = `<div class="skeleton" style="height:160px"></div>`;

  try {
    let data;
    const cacheKey = `lb_cache_${currentLbTab}`;

    if (isOnline() && S.token) {
      try {
        data = await api(`/api/leaderboards/${currentLbTab}`, { token: S.token });
        await kvSet(cacheKey, data);
      } catch (e) {
        data = await kvGet(cacheKey);
      }
    } else {
      data = await kvGet(cacheKey);
    }

    if (!data) {
      box.innerHTML = `<div class="card"><p class="muted">${t('squadNeedsOnline')}</p></div>`;
      return;
    }

    if (currentLbTab === 'squads') {
      const divs = data.divisions || {};
      let html = '';
      for (const [divName, squads] of Object.entries(divs)) {
        if (!squads.length) continue;
        html += `<div class="card"><h3 style="margin-top:0">${t('divisionLabel')}: ${t('band_' + divName)}</h3>`;
        html += squads.map((s) => `
          <div class="leader-row">
            <div class="leader-rank ${s.rank <= 3 ? 'top' + s.rank : ''}">#${s.rank}</div>
            <div class="leader-info">
              <b>${esc(s.name)}</b>
              <div class="muted small">${s.members_count} members</div>
            </div>
            <div class="leader-score">${s.score} pts</div>
          </div>
        `).join('');
        html += `</div>`;
      }
      box.innerHTML = html || `<div class="card"><p class="muted">No squads active in this division.</p></div>`;
    } else if (currentLbTab === 'departments') {
      const deps = data.departments || [];
      box.innerHTML = `
        <div class="card">
          ${deps.map((d) => {
            if (d.suppressed) {
              return `<div class="leader-row muted" style="opacity:0.65">
                <div class="leader-rank">–</div>
                <div class="leader-info"><i>${esc(d.group)}</i><div class="small">${t('lb_smallGroupSuppressed')}</div></div>
                <div class="leader-score">–</div>
              </div>`;
            }
            return `<div class="leader-row">
              <div class="leader-rank ${d.rank <= 3 ? 'top' + d.rank : ''}">#${d.rank}</div>
              <div class="leader-info">
                <b>${esc(d.group)}</b>
                <div class="muted small">${d.meeting_target_count || 0}/${d.n} ${t('lb_participationRate')}</div>
              </div>
              <div class="leader-score">${d.participation_rate}%</div>
            </div>`;
          }).join('')}
        </div>`;
    } else if (currentLbTab === 'consistency') {
      const board = data.board || [];
      const st = data.your_standing || {};
      box.innerHTML = `
        <div class="card">
          ${board.map((u) => `
            <div class="leader-row ${u.is_you ? 'me' : ''}">
              <div class="leader-rank ${u.rank <= 3 ? 'top' + u.rank : ''}">#${u.rank}</div>
              <div class="leader-info">
                <b>${esc(u.name)}${u.is_you ? ' (You)' : ''}</b>
                <div class="muted small">${u.active_days} ${t('lb_activeDays')}</div>
              </div>
              <div class="leader-score">${u.completion_pct}%</div>
            </div>
          `).join('')}
          ${st.rank && st.rank > 10 ? `
            <div class="leader-row me" style="margin-top:8px; border-top:1px dashed var(--line-strong)">
              <div class="leader-rank">#${st.rank}</div>
              <div class="leader-info"><b>${t('lb_you')}</b><div class="muted small">${st.active_days} ${t('lb_activeDays')}</div></div>
              <div class="leader-score">${st.completion_pct}%</div>
            </div>
          ` : ''}
          ${st.opted_out ? `<p class="muted small" style="margin-top:10px">You are currently hidden from this leaderboard.</p>` : ''}
        </div>`;
    } else if (currentLbTab === 'improved') {
      const list = data.board || [];
      box.innerHTML = `
        <div class="card">
          <p class="muted small" style="margin-top:0">${data.reset_note}</p>
          ${list.length ? list.map((u) => `
            <div class="leader-row ${u.is_you ? 'me' : ''}">
              <div class="leader-rank ${u.rank <= 3 ? 'top' + u.rank : ''}">#${u.rank}</div>
              <div class="leader-info">
                <b>${esc(u.name)}${u.is_you ? ' (You)' : ''}</b>
              </div>
              <div class="leader-score">+${u.delta} pts</div>
            </div>
          `).join('') : `<p class="muted">No verified retests recorded yet this cycle.</p>`}
        </div>`;
    }
  } catch (e) {
    box.innerHTML = `<div class="card"><p class="muted">${e.message}</p></div>`;
  }
}

// ---------------------------------------------------------------- squad view
async function viewSquad() {
  app.innerHTML = `<h1>${t('squadTitle')}</h1><div id="sq"></div>`;
  const box = $('#sq');
  let view = await kvGet('squad');
  const hideMyPct = (await kvGet('hide_squad_pct')) || false;
  if (isOnline() && S.token) {
    try { view = (await api('/api/squads/me', { token: S.token })).squad; await kvSet('squad', view); }
    catch (e) { if (e.status === 401) return toast('Session expired'); }
  } else if (!view) {
    box.innerHTML = `<p class="muted">${t('squadNeedsOnline')}</p>`;
    return;
  }
  const draw = (v) => {
    if (!v) {
      box.innerHTML = `<p class="muted">${t('noSquad')}</p>
        <label for="sn">${t('squadName')}</label><input id="sn" maxlength="30"><button class="btn" id="mk">${t('createSquad')}</button>
        <label for="jc">${t('code')}</label><input id="jc" maxlength="8" autocapitalize="characters"><button class="btn alt" id="jn">${t('joinSquad')}</button><div id="err" class="muted" role="alert"></div>`;
      const act = async (path, body) => {
        try { const r = await api(path, { method: 'POST', token: S.token, body }); await kvSet('squad', r); draw(r); }
        catch (e) { $('#err').textContent = e.message === 'offline' ? t('squadNeedsOnline') : e.message; }
      };
      $('#mk').onclick = () => { haptic(25); act('/api/squads', { name: $('#sn').value }); };
      $('#jn').onclick = () => { haptic(25); act('/api/squads/join', { code: $('#jc').value }); };
      return;
    }
    box.innerHTML = `<div class="card"><h2 style="margin-top:0">${esc(v.name)}</h2><p class="muted small">${t('share')}</p><div class="codebox">${esc(v.code)}</div>
      <div class="row"><div><div class="big">${v.score}</div><span class="muted small">${t('squadScore')}</span></div><div><div class="big">${v.rank ?? '–'}<small>/${v.of}</small></div><span class="muted small">${t('rank')} · ${t('divisionLabel')}: ${t('band_' + v.division)}</span></div></div></div>
      <div class="card"><h3 style="margin-top:0">${t('members')}</h3>${v.members.map((m) => {
        const pctDisplay = (m.you && hideMyPct) ? 'Private' : `${m.completion_pct}%`;
        const pctWidth = (m.you && hideMyPct) ? 0 : m.completion_pct;
        return `<div style="margin:10px 0"><div class="row" style="justify-content:space-between"><span>${esc(m.name)}${m.you ? ' ★' : ''}</span><span class="muted">${pctDisplay}</span></div><div class="meter"><div style="width:${pctWidth}%"></div></div></div>`;
      }).join('')}</div>
      <label class="check"><input type="checkbox" id="hidePct" ${hideMyPct ? 'checked' : ''}><span>${t('hideMyScore')}</span></label>
      <div class="row" style="margin-top:14px; gap:8px;">
        <button class="btn alt warn" id="leaveBtn" style="flex:1">${t('leaveSquad')}</button>
        <button class="btn alt" id="repBtn" style="flex:1">${t('reportSquad')}</button>
      </div>
      <p class="muted small" style="margin-top:14px">${t('fairNote')}</p>`;

    $('#hidePct').onchange = async (e) => {
      await kvSet('hide_squad_pct', e.target.checked);
      viewSquad();
    };
    $('#leaveBtn').onclick = async () => {
      if (!confirm(t('leaveConfirm'))) return;
      try {
        await api(`/api/squads/${v.id}/leave`, { method: 'POST', token: S.token });
        await kvSet('squad', null);
        toast(t('leftSquad'));
        viewSquad();
      } catch (e) { toast(e.message); }
    };
    $('#repBtn').onclick = async () => {
      const reason = prompt(t('reportReason') + ' (e.g. offensive name, spam):');
      if (!reason || !reason.trim()) return;
      try {
        await api(`/api/squads/${v.id}/report`, { method: 'POST', token: S.token, body: { reason: reason.trim() } });
        toast(t('reported'));
      } catch (e) { toast(e.message); }
    };
  };
  draw(view);
}

// ---------------------------------------------------------------- privacy & settings (You screen)
async function viewPrivacy() {
  const langs = Object.keys(STR).map((l) => `<option value="${l}" ${getLang() === l ? 'selected' : ''}>${l === 'en' ? 'English' : 'हिन्दी'}</option>`).join('');
  let isPersisted = false;
  if (navigator.storage && navigator.storage.persisted) {
    try { isPersisted = await navigator.storage.persisted(); } catch {}
  }
  const emojis = ['🏃', '🧘', '⚡', '🌟', '🏸', '🚴', '🦁', '🌿'];
  const currentTheme = S.prefs.theme || 'dark';
  const currentTier  = document.documentElement.dataset.tier || 'full';
  const isRm = document.documentElement.dataset.reduceMotion === '1';

  app.innerHTML = `
    <h1>${t('privacy')}</h1>

    <!-- Avatar / Profile card -->
    <div class="card" style="text-align:center">
      <b>${t('avatarChoose')}</b>
      <div class="avatar-picker">
        ${emojis.map((em) => `<button class="avatar-opt ${S.prefs.avatar === em ? 'active' : ''}" data-em="${em}">${em}</button>`).join('')}
      </div>
      <p class="muted small" style="margin-top:8px">${esc(S.profile?.name || '')} · ${esc(S.profile?.group || '')}</p>
    </div>

    <!-- Appearance -->
    <div class="card">
      <b style="display:block; margin-bottom:12px">Appearance</b>
      <div class="privacy-row">
        <label for="themeSelect">Theme</label>
        <select id="themeSelect" style="width:auto; min-width:130px; min-height:40px; padding:8px 12px">
          <option value="dark"  ${currentTheme === 'dark'  ? 'selected' : ''}>🌑 Neon Arena (Dark)</option>
          <option value="light" ${currentTheme === 'light' ? 'selected' : ''}>☀️ Chalk (Light)</option>
          <option value="hc"    ${currentTheme === 'hc'    ? 'selected' : ''}>◑ High Contrast</option>
        </select>
      </div>
      <div class="privacy-row">
        <label for="tierSelect">Performance Tier</label>
        <select id="tierSelect" style="width:auto; min-width:130px; min-height:40px; padding:8px 12px">
          <option value="full"    ${currentTier === 'full'    ? 'selected' : ''}>Full (blur, aurora)</option>
          <option value="lite"    ${currentTier === 'lite'    ? 'selected' : ''}>Lite (no blur)</option>
          <option value="minimal" ${currentTier === 'minimal' ? 'selected' : ''}>Minimal (flat)</option>
        </select>
      </div>
      <label class="check" style="margin-top:8px">
        <input type="checkbox" id="rmCheck" ${isRm ? 'checked' : ''}>
        <span>Reduce Motion</span>
      </label>
    </div>

    <!-- Haptics & preferences -->
    <div class="card">
      <label class="check">
        <input type="checkbox" id="hapticCheck" ${S.prefs.haptics ? 'checked' : ''}>
        <span>${t('hapticsToggle')}</span>
      </label>
    </div>

    <div class="card"><ul class="clean"><li>${t('c1')}</li><li>${t('c2')}</li><li>${t('c3')}</li></ul></div>
    <label for="lang">${t('lang')}</label><select id="lang">${langs}</select>
    <div class="card" style="margin:12px 0">
      <b>${t('storagePersist')}</b>
      <p class="muted small">${isPersisted ? `✓ ${t('storagePersisted')}` : t('storageNotPersisted')}</p>
      ${!isPersisted ? `<button class="btn alt" id="reqPersist">${t('storagePersist')}</button>` : ''}
    </div>
    <button class="btn alt" id="exp">${t('exportData')}</button>
    <button class="btn danger" id="del">${t('deleteData')}</button>
    <h2>Demo</h2>
    <label class="check"><input type="checkbox" id="air" ${net.forceOffline ? 'checked' : ''}><span>${t('airplane')}</span></label>
    <a class="btn alt" href="admin.html" target="_blank" rel="noopener">${t('adminLink')}</a>
    <p class="muted small">v0.2 P2 · Neon Arena</p>`;

  app.querySelectorAll('.avatar-opt').forEach((b) => {
    b.onclick = async () => {
      haptic(20);
      S.prefs.avatar = b.dataset.em;
      await kvSet('prefs', S.prefs);
      app.querySelectorAll('.avatar-opt').forEach((x) => x.classList.toggle('active', x === b));
      toast('Avatar updated');
    };
  });

  $('#themeSelect').onchange = async (e) => {
    haptic(20);
    applyTheme(e.target.value);
    await kvSet('prefs', S.prefs);
    if (isOnline() && S.token) {
      try { await api('/api/user/preferences', { method: 'POST', token: S.token, body: S.prefs }); } catch {}
    }
  };

  $('#tierSelect').onchange = (e) => {
    document.documentElement.dataset.tier = e.target.value;
    S.prefs.tier = e.target.value;
    kvSet('prefs', S.prefs).catch(() => {});
    toast(`Performance tier: ${e.target.value}`);
  };

  $('#rmCheck').onchange = (e) => {
    document.documentElement.dataset.reduceMotion = e.target.checked ? '1' : '0';
    S.prefs.reduceMotion = e.target.checked;
    kvSet('prefs', S.prefs).catch(() => {});
  };

  $('#hapticCheck').onchange = async (e) => {
    S.prefs.haptics = e.target.checked;
    await kvSet('prefs', S.prefs);
    if (S.prefs.haptics) haptic(30);
  };

  $('#lang').onchange = async (e) => {
    setLang(e.target.value);
    await kvSet('lang', e.target.value);
    chrome();
    viewPrivacy();
  };

  $('#air').onchange = (e) => {
    net.forceOffline = e.target.checked;
    chrome();
    if (!net.forceOffline) trySync();
  };

  const rp = $('#reqPersist');
  if (rp) {
    rp.onclick = async () => {
      if (navigator.storage && navigator.storage.persist) {
        const ok = await navigator.storage.persist();
        toast(ok ? t('storagePersisted') : 'Storage permission denied');
        viewPrivacy();
      }
    };
  }

  $('#exp').onclick = async () => {
    haptic(20);
    let data;
    try { data = await api('/api/me/export', { token: S.token }); }
    catch { data = { offline_copy: true, events: await allEvents(), prefs: S.prefs }; }
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }));
    a.download = 'khelsetu-my-data.json';
    a.click();
  };

  $('#del').onclick = async () => {
    haptic(40);
    if (!confirm(t('deleteConfirm'))) return;
    try { await api('/api/me/delete', { method: 'POST', token: S.token }); }
    catch (e) { if (e.message === 'offline') return toast(t('needOnlineRegister')); }
    await wipeAll();
    S.profile = null;
    S.token = null;
    Object.assign(ob, { step: 1, name: '', group: '', age18: false });
    go('onboard');
  };
}


// ---------------------------------------------------------------- campus facility slots
async function viewSlots() {
  app.innerHTML = `<h1>${t('slotsTitle')}</h1><div id="slotList"><p class="muted">Loading facilities…</p></div><button class="btn alt" id="back" style="margin-top:12px">${t('back')}</button>`;
  $('#back').onclick = () => { haptic(15); go('home'); };
  const box = $('#slotList');
  try {
    let res;
    if (isOnline() && S.token) {
      res = await api('/api/facilities/slots', { token: S.token });
    } else {
      res = {
        facilities: [
          { id: 'badminton', name: 'Badminton Court', location: 'Indoor Sports Complex', capacity: 8, occupied: 4, slots: ['06:00 - 06:45', '17:00 - 17:45', '18:00 - 18:45'] },
          { id: 'gym', name: 'Strength & Multi-Gym', location: 'Student Activity Center', capacity: 20, occupied: 11, slots: ['06:30 - 07:15', '16:30 - 17:15', '17:30 - 18:15'] },
          { id: 'table_tennis', name: 'Table Tennis Arena', location: 'Hostel Block Common Hall', capacity: 6, occupied: 2, slots: ['17:00 - 17:45', '18:00 - 18:45'] },
          { id: 'track', name: 'Athletic Running Track', location: 'Main Campus Ground', capacity: 50, occupied: 18, slots: ['06:00 - 06:45', '17:30 - 18:15'] },
        ]
      };
    }
    box.innerHTML = res.facilities.map((f) => {
      const occPct = Math.round((f.occupied / f.capacity) * 100);
      return `<div class="card" style="margin-bottom:12px">
        <h3 style="margin-top:0">${esc(f.name)}</h3>
        <p class="muted small">${esc(f.location)}</p>
        <div class="row" style="justify-content:space-between; margin:8px 0">
          <span class="muted small">${t('occupancy')}: ${f.occupied}/${f.capacity}</span>
          <span class="pill ${occPct > 80 ? 'bad' : occPct > 50 ? 'low' : 'ok'}">${occPct}% Full</span>
        </div>
        <div class="meter"><div style="width:${occPct}%"></div></div>
        <div style="margin-top:10px">
          <label class="small muted">Available 45-min slots:</label>
          <div style="display:flex; flex-wrap:wrap; gap:6px; margin-top:4px">
            ${f.slots.map((s) => `<button class="btn alt rsvBtn" data-fid="${f.id}" data-time="${s}" style="padding:6px 10px; font-size:0.85rem">${s}</button>`).join('')}
          </div>
        </div>
      </div>`;
    }).join('');

    box.querySelectorAll('.rsvBtn').forEach((b) => {
      b.onclick = async () => {
        haptic(25);
        const fid = b.dataset.fid, slot = b.dataset.time;
        try {
          if (isOnline() && S.token) {
            const r = await api('/api/facilities/reserve', { method: 'POST', token: S.token, body: { facility_id: fid, slot_time: slot } });
            toast(`${t('reservedNote')} ${r.checkin_code}`);
          } else {
            toast(`${t('reservedNote')} ${fid.substring(0, 2).toUpperCase()}99 (offline queued)`);
          }
        } catch (e) { toast(e.message); }
      };
    });
  } catch (e) {
    box.innerHTML = `<p class="muted">${e.message}</p>`;
  }
}

// ---------------------------------------------------------------- Feature C: Committee Chat View
let activeChannelId = null;
let chatPollInterval = null;

async function viewChat() {
  if (chatPollInterval) clearInterval(chatPollInterval);
  
  app.innerHTML = `
    <div style="display:flex; justify-content:space-between; align-items:center;">
      <h1>${t('chat')}</h1>
      <span class="pill ok">${t('online')}</span>
    </div>
    <p class="muted small" style="margin-bottom:10px">${t('chat_notE2E')}</p>
    
    <div class="board-tabs" id="chatChannels" role="tablist">
      <div class="skeleton" style="height:36px; width:100%"></div>
    </div>
    
    <div id="crisisBanner" class="card" hidden style="background:var(--warn-bg); border-color:var(--warn); margin:8px 0"></div>
    
    <div class="chat-container">
      <div class="chat-messages" id="chatMessages">
        <div class="skeleton" style="height:120px"></div>
      </div>
      
      <div class="chat-composer">
        <input type="text" id="chatInput" maxlength="500" placeholder="${t('chat_typePlaceholder')}" autocomplete="off">
        <button class="btn mari" id="chatSendBtn">${t('chat_send')}</button>
      </div>
    </div>
    <button class="btn alt" id="chatBack" style="margin-top:12px">${t('back')}</button>`;

  $('#chatBack').onclick = () => {
    if (chatPollInterval) clearInterval(chatPollInterval);
    go('home');
  };

  try {
    const r = await api('/api/chat/channels', { token: S.token });
    const channels = r.channels || [];
    if (!channels.length) {
      $('#chatChannels').innerHTML = `<p class="muted">No channels available.</p>`;
      return;
    }
    if (!activeChannelId || !channels.some((c) => c.id === activeChannelId)) {
      activeChannelId = channels[0].id;
    }

    const chanTabs = $('#chatChannels');
    chanTabs.innerHTML = channels.map((c) => {
      const label = c.kind === 'announcements' ? `📢 ${t('chat_announcements')}` : c.kind === 'squad' ? `👥 ${t('chat_squad')}` : `💬 ${t('chat_ask')}`;
      return `<button class="board-tab ${c.id === activeChannelId ? 'active' : ''}" data-cid="${c.id}">${label}</button>`;
    }).join('');

    chanTabs.querySelectorAll('.board-tab').forEach((btn) => {
      btn.onclick = () => {
        haptic(15);
        activeChannelId = btn.dataset.cid;
        chanTabs.querySelectorAll('.board-tab').forEach((b) => b.classList.toggle('active', b === btn));
        loadMessages();
      };
    });

    await loadMessages();
    chatPollInterval = setInterval(loadMessages, 15000);

    const input = $('#chatInput');
    const sendBtn = $('#chatSendBtn');

    const handleSend = async () => {
      const text = input.value.trim();
      if (!text || !activeChannelId) return;
      haptic(25);
      input.value = '';
      const clientMsgId = 'msg-' + Math.random().toString(36).substring(2, 10) + '-' + Date.now();
      try {
        const res = await api(`/api/chat/channels/${activeChannelId}/messages`, {
          method: 'POST',
          token: S.token,
          body: { id: clientMsgId, content: text }
        });
        if (res.crisis_notice) {
          const cb = $('#crisisBanner');
          cb.hidden = false;
          cb.innerHTML = `<b>Support Notice</b><p class="small">${esc(res.crisis_notice)}</p>`;
        }
        await loadMessages();
      } catch (e) {
        toast(e.message);
      }
    };

    sendBtn.onclick = handleSend;
    input.onkeydown = (e) => {
      if (e.key === 'Enter') handleSend();
    };

  } catch (e) {
    $('#chatMessages').innerHTML = `<p class="muted">${e.message}</p>`;
  }
}

async function loadMessages() {
  if (!activeChannelId || !S.token) return;
  const box = $('#chatMessages');
  if (!box) return;
  try {
    const res = await api(`/api/chat/channels/${activeChannelId}/messages`, { token: S.token });
    const msgs = res.messages || [];
    if (!msgs.length) {
      box.innerHTML = `<div style="text-align:center; padding:30px 10px;" class="muted small">No messages yet in this channel. Send the first message!</div>`;
      return;
    }
    box.innerHTML = msgs.map((m) => {
      const roleBadge = m.sender_role !== 'student' ? `<span class="pill ok" style="font-size:0.68rem; padding:1px 6px">${m.sender_role}</span>` : '';
      const isPeer = !m.is_you;
      const isOfficer = m.sender_role !== 'student';
      const rowClass = m.is_you ? 'me' : isOfficer ? 'peer officer' : 'peer';
      const timeStr = new Date(m.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
      const reacts = Object.entries(m.reactions || {}).map(([em, cnt]) =>
        `<span class="react-pill ${m.my_reactions?.includes(em) ? 'active' : ''}" data-mid="${m.id}" data-em="${em}">${em} ${cnt}</span>`
      ).join('');

      return `
        <div class="msg-row ${rowClass}">
          <div class="msg-meta">
            <span>${esc(m.sender_name)}</span>
            ${roleBadge}
            <span>· ${timeStr}</span>
          </div>
          <div class="msg-bubble">
            ${esc(m.content)}
            ${m.held_for_review ? `<div class="pill low small" style="margin-top:4px">${t('chat_heldReview')}</div>` : ''}
          </div>
          <div class="msg-reactions">
            ${reacts}
            <button class="react-pill react-add" data-mid="${m.id}" title="React">➕</button>
            ${isPeer ? `<button class="react-pill report-btn" data-mid="${m.id}" title="${t('chat_reportMsg')}">🚩</button>` : ''}
            ${m.is_you ? `<button class="react-pill del-btn" data-mid="${m.id}" title="${t('chat_deleteMsg')}">🗑</button>` : ''}
          </div>
        </div>`;
    }).join('');

    box.scrollTop = box.scrollHeight;

    box.querySelectorAll('.react-add').forEach((b) => {
      b.onclick = async () => {
        const mid = b.dataset.mid;
        const emoji = prompt('React with emoji (e.g. 🔥, 👍, ❤️, 👏):', '👍');
        if (!emoji || !emoji.trim()) return;
        try {
          await api(`/api/chat/messages/${mid}/reactions`, { method: 'POST', token: S.token, body: { emoji: emoji.trim() } });
          loadMessages();
        } catch (e) { toast(e.message); }
      };
    });

    box.querySelectorAll('.report-btn').forEach((b) => {
      b.onclick = async () => {
        const mid = b.dataset.mid;
        const reason = prompt(t('chat_reportMsg') + ' (e.g. harassment, spam):');
        if (!reason || !reason.trim()) return;
        try {
          await api(`/api/chat/messages/${mid}/report`, { method: 'POST', token: S.token, body: { reason: reason.trim() } });
          toast(t('chat_reported'));
        } catch (e) { toast(e.message); }
      };
    });

    box.querySelectorAll('.del-btn').forEach((b) => {
      b.onclick = async () => {
        const mid = b.dataset.mid;
        if (!confirm('Delete this message?')) return;
        try {
          await api(`/api/chat/messages/${mid}/delete`, { method: 'POST', token: S.token, body: { reason: 'deleted_by_user' } });
          loadMessages();
        } catch (e) { toast(e.message); }
      };
    });

  } catch (e) {
    box.innerHTML = `<p class="muted">${e.message}</p>`;
  }
}


// ---------------------------------------------------------------- Web Share Milestone Card (Feature D)
async function generateShareCard(data) {
  const canvas = document.createElement('canvas');
  canvas.width = 1080;
  canvas.height = 1080;
  const ctx = canvas.getContext('2d');

  const grad = ctx.createLinearGradient(0, 0, 1080, 1080);
  grad.addColorStop(0, '#156654');
  grad.addColorStop(1, '#081C17');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, 1080, 1080);

  ctx.strokeStyle = 'rgba(245, 158, 11, 0.25)';
  ctx.lineWidth = 14;
  ctx.beginPath();
  ctx.arc(920, 180, 240, 0, Math.PI * 2);
  ctx.stroke();

  ctx.strokeStyle = 'rgba(255, 255, 255, 0.08)';
  ctx.lineWidth = 20;
  ctx.beginPath();
  ctx.arc(160, 920, 300, 0, Math.PI * 2);
  ctx.stroke();

  ctx.fillStyle = '#F59E0B';
  ctx.font = 'bold 44px sans-serif';
  ctx.fillText('KHELSETU', 100, 140);

  ctx.fillStyle = 'rgba(255, 255, 255, 0.75)';
  ctx.font = '26px sans-serif';
  ctx.fillText('FITNESS MILESTONE CARD', 100, 185);

  ctx.fillStyle = 'rgba(255, 255, 255, 0.08)';
  ctx.beginPath();
  ctx.roundRect(100, 230, 880, 630, 32);
  ctx.fill();
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.15)';
  ctx.lineWidth = 2;
  ctx.stroke();

  ctx.fillStyle = '#FFFFFF';
  ctx.font = 'bold 54px sans-serif';
  ctx.fillText(data.name || 'Campus Athlete', 150, 330);

  if (data.squad) {
    ctx.fillStyle = '#FBBF24';
    ctx.font = 'bold 30px sans-serif';
    ctx.fillText(`Squad: ${data.squad}`, 150, 385);
  }

  ctx.strokeStyle = 'rgba(255, 255, 255, 0.2)';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(150, 420);
  ctx.lineTo(930, 420);
  ctx.stroke();

  ctx.fillStyle = 'rgba(255, 255, 255, 0.7)';
  ctx.font = '26px sans-serif';
  ctx.fillText('ACTIVE MINUTES THIS WEEK', 150, 490);
  ctx.fillStyle = '#FFFFFF';
  ctx.font = 'bold 70px sans-serif';
  ctx.fillText(`${Math.round(data.minutes || 0)} min`, 150, 570);

  ctx.fillStyle = 'rgba(255, 255, 255, 0.7)';
  ctx.font = '26px sans-serif';
  ctx.fillText('ACTIVE DAYS STREAK', 580, 490);
  ctx.fillStyle = '#F59E0B';
  ctx.font = 'bold 70px sans-serif';
  ctx.fillText(`${data.streak || 1} 🔥`, 580, 570);

  ctx.fillStyle = 'rgba(255, 255, 255, 0.7)';
  ctx.font = '26px sans-serif';
  ctx.fillText('WEEKLY GOAL PROGRESS', 150, 670);
  ctx.fillStyle = '#34D399';
  ctx.font = 'bold 64px sans-serif';
  ctx.fillText(`${Math.min(100, Math.round(data.completion || 0))}% Completed`, 150, 750);

  ctx.fillStyle = 'rgba(255, 255, 255, 0.65)';
  ctx.font = '24px sans-serif';
  ctx.fillText('Movement · Habit · Teamwork · #KhelSetu #FitIndia', 100, 930);
  ctx.fillText('Privacy First: Zero body measurements or comparative weight metrics.', 100, 965);

  return new Promise((resolve) => {
    canvas.toBlob((blob) => resolve(blob), 'image/png');
  });
}

async function shareMilestoneCard() {
  const st = await localState();
  const goal = st.goal || 60;
  const pct = goal > 0 ? (st.total / goal) * 100 : 0;
  let sqName = null;
  if (isOnline() && S.token) {
    try {
      const res = await api('/api/squads/me', { token: S.token });
      sqName = res.squad?.name;
    } catch {}
  }
  const blob = await generateShareCard({
    name: S.profile?.name,
    squad: sqName,
    minutes: st.total,
    streak: st.streak.current,
    completion: pct
  });

  const file = new File([blob], 'khelsetu-milestone.png', { type: 'image/png' });
  if (navigator.canShare && navigator.canShare({ files: [file] })) {
    try {
      await navigator.share({
        files: [file],
        title: 'KhelSetu Fitness Milestone',
        text: `Crushed ${Math.round(st.total)} active minutes this week on KhelSetu! 🏃 #KhelSetu #FitIndia`
      });
      return;
    } catch (e) {
      if (e.name === 'AbortError') return;
    }
  }

  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'khelsetu-milestone.png';
  a.click();
  URL.revokeObjectURL(url);
  toast(t('feed_downloadCard'));
}


// ---------------------------------------------------------------- Gym-Photo Feed (Feature D)
let activeFeedVis = 'all';

async function viewFeed() {
  app.innerHTML = `
    <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:8px">
      <h2>📷 ${t('feed')}</h2>
      <button class="btn ok small" id="feedNewPostBtn" style="margin:0; width:auto; padding:8px 14px;">+ ${t('feed_createPost')}</button>
    </div>
    
    <div class="feed-filter-bar" id="feedVisFilters">
      <button class="board-tab ${activeFeedVis === 'all' ? 'active' : ''}" data-vis="all">🌐 All</button>
      <button class="board-tab ${activeFeedVis === 'squad' ? 'active' : ''}" data-vis="squad">👥 ${t('feed_squadOnly')}</button>
      <button class="board-tab ${activeFeedVis === 'hostel' ? 'active' : ''}" data-vis="hostel">🏢 ${t('feed_hostelOnly')}</button>
      <button class="board-tab ${activeFeedVis === 'campus' ? 'active' : ''}" data-vis="campus">🏛 ${t('feed_campus')}</button>
    </div>

    <div style="margin-bottom:12px; display:flex; gap:8px;">
      <button class="btn alt small" id="feedShareCardBtn" style="margin:0; flex:1">🌟 ${t('feed_shareCard')}</button>
      <a class="btn alt small" href="docs/COMMUNITY_GUIDELINES.md" target="_blank" style="margin:0; text-decoration:none; display:grid; place-items:center; padding:0 12px">📜 ${t('feed_guidelines')}</a>
    </div>

    <div id="feedUploadModal" class="card" hidden style="border-color:var(--court); background:var(--paper-subtle); margin-bottom:16px;">
      <h3 style="margin-top:0">${t('feed_createPost')}</h3>
      <p class="small muted">Only share sports, gym, or activity photos. EXIF & GPS metadata will be automatically stripped before storage.</p>
      
      <label class="field">
        <span>${t('feed_selectPhoto')}</span>
        <input type="file" id="feedFileInput" accept="image/jpeg,image/png,image/webp">
      </label>
      
      <div id="feedImgPreview" style="display:none; margin:8px 0; border-radius:8px; overflow:hidden; max-height:200px; text-align:center;">
        <img id="feedPreviewImg" style="max-height:200px; object-fit:contain; border-radius:8px;">
      </div>

      <label class="field">
        <span>${t('feed_chooseTag')}</span>
        <select id="feedTagSelect">
          <option value="Gym Day">💪 Gym Day</option>
          <option value="Morning Run">🏃 Morning Run</option>
          <option value="FitCheck Win">🎯 FitCheck Win</option>
          <option value="Yoga & Mobility">🧘 Yoga & Mobility</option>
          <option value="Campus Sports">⚽ Campus Sports</option>
          <option value="Rest & Recovery">☕ Rest & Recovery</option>
        </select>
      </label>

      <label class="field">
        <span>Visibility</span>
        <select id="feedVisSelect">
          <option value="squad">👥 ${t('feed_squadOnly')}</option>
          <option value="hostel">🏢 ${t('feed_hostelOnly')}</option>
          <option value="campus">🏛 ${t('feed_campus')}</option>
        </select>
      </label>

      <label class="field">
        <span>Caption</span>
        <textarea id="feedCaptionInput" maxlength="300" rows="2" placeholder="${t('feed_captionPlaceholder')}"></textarea>
      </label>

      <div style="display:flex; gap:8px; margin-top:10px;">
        <button class="btn ok" id="feedSubmitPostBtn" style="margin:0; flex:1">${t('feed_postBtn')}</button>
        <button class="btn alt" id="feedCancelPostBtn" style="margin:0; width:auto">${t('back')}</button>
      </div>
    </div>

    <div id="feedPostsList">
      <div class="skeleton" style="height:250px; margin-bottom:12px;"></div>
      <div class="skeleton" style="height:250px;"></div>
    </div>
  `;

  $('#feedShareCardBtn').onclick = () => {
    haptic(25);
    shareMilestoneCard();
  };

  const modal = $('#feedUploadModal');
  const fileInput = $('#feedFileInput');
  const prevBox = $('#feedImgPreview');
  const prevImg = $('#feedPreviewImg');
  let selectedBlob = null;

  $('#feedNewPostBtn').onclick = () => {
    haptic(20);
    modal.hidden = false;
  };
  $('#feedCancelPostBtn').onclick = () => {
    haptic(15);
    modal.hidden = true;
    selectedBlob = null;
    prevBox.style.display = 'none';
  };

  fileInput.onchange = (e) => {
    const f = e.target.files[0];
    if (!f) return;
    selectedBlob = f;
    prevImg.src = URL.createObjectURL(f);
    prevBox.style.display = 'block';
  };

  $('#feedSubmitPostBtn').onclick = async () => {
    if (!selectedBlob) return toast('Please select an image first');
    haptic(30);
    const caption = $('#feedCaptionInput').value.trim();
    const tag = $('#feedTagSelect').value;
    const visibility = $('#feedVisSelect').value;

    const fd = new FormData();
    fd.append('file', selectedBlob);

    try {
      toast(t('feed_uploading'));
      const up = await api('/api/feed/upload', { method: 'POST', token: S.token, body: fd, isFormData: true });
      const postId = 'post-' + Math.random().toString(36).substring(2, 10) + '-' + Date.now();
      await api('/api/feed/posts', {
        method: 'POST',
        token: S.token,
        body: { id: postId, image_id: up.id, caption, tag, visibility }
      });
      toast('Post published!');
      modal.hidden = true;
      selectedBlob = null;
      prevBox.style.display = 'none';
      loadFeedPosts();
    } catch (e) {
      toast(e.message);
    }
  };

  $('#feedVisFilters').querySelectorAll('.board-tab').forEach((b) => {
    b.onclick = () => {
      haptic(15);
      activeFeedVis = b.dataset.vis;
      $('#feedVisFilters').querySelectorAll('.board-tab').forEach((x) => x.classList.toggle('active', x === b));
      loadFeedPosts();
    };
  });

  await loadFeedPosts();
}

async function loadFeedPosts() {
  const container = $('#feedPostsList');
  if (!container || !S.token) return;
  try {
    const res = await api(`/api/feed/posts?visibility=${activeFeedVis}`, { token: S.token });
    const posts = res.posts || [];
    if (!posts.length) {
      container.innerHTML = `<div class="card" style="text-align:center; padding:30px;"><p class="muted">${t('feed_noPosts')}</p></div>`;
      return;
    }

    container.innerHTML = posts.map((p) => {
      const timeStr = new Date(p.created_at).toLocaleDateString([], { month: 'short', day: 'numeric' });
      const reacts = Object.entries(p.reactions || {}).map(([em, cnt]) =>
        `<span class="react-pill ${p.my_reaction === em ? 'active' : ''}" data-pid="${p.id}" data-em="${em}">${em} ${cnt}</span>`
      ).join('');

      return `
        <div class="feed-card" id="card-${p.id}">
          <div class="feed-card-header">
            <div class="feed-author-info">
              <div class="feed-author-avatar">${p.author_name.charAt(0)}</div>
              <div>
                <b>${esc(p.author_name)}</b>
                <div class="small muted">${p.grp || p.visibility} · ${timeStr}</div>
              </div>
            </div>
            <span class="pill ok" style="font-size:0.75rem">${esc(p.tag)}</span>
          </div>
          
          <div class="feed-img-wrap">
            <img src="${p.thumb_url}" loading="lazy" alt="${esc(p.caption || 'Workout photo')}">
          </div>

          <div class="feed-card-body">
            ${p.caption ? `<div class="feed-caption">${esc(p.caption)}</div>` : ''}
            
            <div class="feed-reactions-bar">
              <div style="display:flex; gap:4px; flex-wrap:wrap">
                ${reacts}
                <button class="react-pill post-react-add" data-pid="${p.id}">🔥💪</button>
              </div>
              <div style="display:flex; gap:6px;">
                <button class="react-pill post-comm-toggle" data-pid="${p.id}">💬 ${p.comment_count || 0}</button>
                ${p.is_mine ? `<button class="react-pill post-del-btn" data-pid="${p.id}">🗑</button>` : `<button class="react-pill post-rep-btn" data-pid="${p.id}">🚩</button>`}
              </div>
            </div>
          </div>

          <div class="feed-comments-section" id="comms-${p.id}" hidden>
            <div class="comms-list" id="comms-list-${p.id}"></div>
            <div style="display:flex; gap:6px; margin-top:8px;">
              <input type="text" class="comm-input" id="comm-in-${p.id}" placeholder="${t('feed_addComment')}" style="min-height:36px; padding:6px 10px; font-size:0.85rem;">
              <button class="btn ok small comm-send-btn" data-pid="${p.id}" style="margin:0; width:auto; padding:6px 12px;">Send</button>
            </div>
          </div>
        </div>`;
    }).join('');

    // Attach reaction listeners
    container.querySelectorAll('.post-react-add').forEach((b) => {
      b.onclick = async () => {
        const pid = b.dataset.pid;
        const emoji = prompt('Choose reaction emoji (🔥, 💪, 👏, 🎯):', '💪');
        if (!emoji || !emoji.trim()) return;
        try {
          await api(`/api/feed/posts/${pid}/reactions`, { method: 'POST', token: S.token, body: { emoji: emoji.trim() } });
          loadFeedPosts();
        } catch (e) { toast(e.message); }
      };
    });

    // Attach comment toggle listeners
    container.querySelectorAll('.post-comm-toggle').forEach((b) => {
      b.onclick = async () => {
        const pid = b.dataset.pid;
        const sec = $(`#comms-${pid}`);
        sec.hidden = !sec.hidden;
        if (!sec.hidden) loadPostComments(pid);
      };
    });

    // Attach comment send listeners
    container.querySelectorAll('.comm-send-btn').forEach((b) => {
      b.onclick = async () => {
        const pid = b.dataset.pid;
        const input = $(`#comm-in-${pid}`);
        const content = input.value.trim();
        if (!content) return;
        input.value = '';
        const cid = 'comm-' + Math.random().toString(36).substring(2, 10) + '-' + Date.now();
        try {
          await api(`/api/feed/posts/${pid}/comments`, { method: 'POST', token: S.token, body: { id: cid, content } });
          loadPostComments(pid);
        } catch (e) { toast(e.message); }
      };
    });

    // Attach delete listeners
    container.querySelectorAll('.post-del-btn').forEach((b) => {
      b.onclick = async () => {
        const pid = b.dataset.pid;
        if (!confirm('Delete this post?')) return;
        try {
          await api(`/api/feed/posts/${pid}/delete`, { method: 'POST', token: S.token });
          loadFeedPosts();
        } catch (e) { toast(e.message); }
      };
    });

    // Attach report listeners
    container.querySelectorAll('.post-rep-btn').forEach((b) => {
      b.onclick = async () => {
        const pid = b.dataset.pid;
        const reason = prompt('Reason for reporting post:');
        if (!reason || !reason.trim()) return;
        try {
          await api(`/api/feed/posts/${pid}/report`, { method: 'POST', token: S.token, body: { reason: reason.trim() } });
          toast('Post reported to campus moderation');
        } catch (e) { toast(e.message); }
      };
    });

  } catch (e) {
    container.innerHTML = `<p class="muted">${e.message}</p>`;
  }
}

async function loadPostComments(postId) {
  const box = $(`#comms-list-${postId}`);
  if (!box || !S.token) return;
  try {
    const res = await api(`/api/feed/posts/${postId}/comments`, { token: S.token });
    const comms = res.comments || [];
    if (!comms.length) {
      box.innerHTML = `<div class="muted small" style="padding:4px 0">No comments yet.</div>`;
      return;
    }
    box.innerHTML = comms.map((c) => `
      <div class="feed-comment-item">
        <b>${esc(c.author_name)}:</b> ${esc(c.content)}
      </div>
    `).join('');
  } catch (e) {
    box.innerHTML = `<p class="muted small">${e.message}</p>`;
  }
}


// ---------------------------------------------------------------- Meal Photo Calorie Tracking (Feature E)
let currentAnalyzedMeal = null;

async function viewMeals() {
  app.innerHTML = `
    <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:8px">
      <h2>🥗 ${t('meals_title')}</h2>
      <button class="btn alt small" id="mealsBackBtn" style="margin:0; width:auto">${t('back')}</button>
    </div>

    <div class="card" style="background:var(--paper-subtle); border-color:var(--court); margin-bottom:16px;">
      <h3 style="margin-top:0">${t('meals_takePhoto')}</h3>
      <p class="small muted">Upload or capture your hostel mess plate or canteen meal to analyze calories and macronutrients.</p>
      
      <label class="field">
        <input type="file" id="mealPhotoInput" accept="image/jpeg,image/png,image/webp" capture="environment">
      </label>

      <div id="mealAnalyzingSpinner" hidden style="text-align:center; padding:16px;">
        <div class="skeleton" style="height:40px; margin-bottom:8px;"></div>
        <p class="small muted">${t('meals_analyzing')}</p>
      </div>
    </div>

    <!-- Confirm and Edit Screen -->
    <div id="mealConfirmSection" class="card" hidden style="border-color:var(--marigold); margin-bottom:16px;">
      <h3 style="margin-top:0">${t('meals_confirmTitle')}</h3>
      <p class="small muted">${t('meals_disclaimer')}</p>

      <div class="nutrition-pill-grid" id="mealNutritionTotals">
        <div class="macro-box"><div class="macro-val" id="totalKcal">0</div><div class="macro-label">kcal</div></div>
        <div class="macro-box"><div class="macro-val" id="totalProtein">0g</div><div class="macro-label">Protein</div></div>
        <div class="macro-box"><div class="macro-val" id="totalCarbs">0g</div><div class="macro-label">Carbs</div></div>
        <div class="macro-box"><div class="macro-val" id="totalFat">0g</div><div class="macro-label">Fat</div></div>
      </div>

      <div id="mealItemsEditorList" style="margin:12px 0;"></div>

      <label class="field">
        <span>Meal Type</span>
        <select id="mealTypeSelect">
          <option value="lunch">Lunch</option>
          <option value="dinner">Dinner</option>
          <option value="breakfast">Breakfast</option>
          <option value="snack">Snack</option>
        </select>
      </label>

      <div style="display:flex; gap:8px; margin-top:12px;">
        <button class="btn ok" id="mealSaveLogBtn" style="margin:0; flex:1">Save Meal Log</button>
        <button class="btn alt" id="mealAddItemBtn" style="margin:0; width:auto">+ Add Item</button>
      </div>
    </div>

    <!-- Recent Meal Logs -->
    <div class="card">
      <h3 style="margin-top:0">Today's Nutrition Log</h3>
      <div id="recentMealsList">
        <div class="skeleton" style="height:60px;"></div>
      </div>
    </div>
  `;

  $('#mealsBackBtn').onclick = () => go('home');

  const photoInput = $('#mealPhotoInput');
  const spinner = $('#mealAnalyzingSpinner');
  const confirmSec = $('#mealConfirmSection');

  photoInput.onchange = async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    haptic(25);
    spinner.hidden = false;
    confirmSec.hidden = true;

    const fd = new FormData();
    fd.append('file', file);

    try {
      const res = await api('/api/meals/analyze', { method: 'POST', token: S.token, body: fd, isFormData: true });
      currentAnalyzedMeal = res;
      spinner.hidden = true;
      confirmSec.hidden = false;
      renderMealItemsEditor();
    } catch (err) {
      spinner.hidden = true;
      toast(err.message);
    }
  };

  $('#mealAddItemBtn').onclick = () => {
    if (!currentAnalyzedMeal) return;
    const name = prompt('Food item name (e.g. Roti, Curd, Banana):', 'Roti');
    if (!name) return;
    const g = parseFloat(prompt('Portion weight in grams (e.g. 60):', '60')) || 60;
    currentAnalyzedMeal.items.push({
      name: name.trim(),
      portion_g: g,
      calories: Math.round(g * 1.5),
      protein_g: Math.round(g * 0.08 * 10) / 10,
      carbs_g: Math.round(g * 0.25 * 10) / 10,
      fat_g: Math.round(g * 0.03 * 10) / 10,
      fiber_g: 1.0,
      source_db: 'IFCT2017'
    });
    renderMealItemsEditor();
  };

  $('#mealSaveLogBtn').onclick = async () => {
    if (!currentAnalyzedMeal || !currentAnalyzedMeal.items.length) return;
    haptic(35);
    const mealId = 'meal-' + Math.random().toString(36).substring(2, 10) + '-' + Date.now();
    const mealType = $('#mealTypeSelect').value;

    try {
      await api('/api/meals/log', {
        method: 'POST',
        token: S.token,
        body: {
          id: mealId,
          meal_type: mealType,
          title: mealType.charAt(0).toUpperCase() + mealType.slice(1),
          image_id: currentAnalyzedMeal.image_id,
          items: currentAnalyzedMeal.items
        }
      });
      toast(t('meals_logged'));
      confirmSec.hidden = true;
      currentAnalyzedMeal = null;
      loadMealHistory();
    } catch (e) {
      toast(e.message);
    }
  };

  await loadMealHistory();
}

function renderMealItemsEditor() {
  if (!currentAnalyzedMeal) return;
  const items = currentAnalyzedMeal.items;
  const list = $('#mealItemsEditorList');
  if (!list) return;

  const totalCal = items.reduce((a, b) => a + b.calories, 0);
  const totalP = items.reduce((a, b) => a + b.protein_g, 0);
  const totalC = items.reduce((a, b) => a + b.carbs_g, 0);
  const totalF = items.reduce((a, b) => a + b.fat_g, 0);

  $('#totalKcal').textContent = Math.round(totalCal);
  $('#totalProtein').textContent = Math.round(totalP) + 'g';
  $('#totalCarbs').textContent = Math.round(totalC) + 'g';
  $('#totalFat').textContent = Math.round(totalF) + 'g';

  list.innerHTML = items.map((item, idx) => `
    <div style="display:flex; justify-content:space-between; align-items:center; padding:8px 0; border-bottom:1px solid var(--line);">
      <div>
        <b>${esc(item.name)}</b>
        <div class="small muted">${item.portion_g}g · ${item.calories} kcal (P: ${item.protein_g}g, C: ${item.carbs_g}g, F: ${item.fat_g}g)</div>
      </div>
      <button class="react-pill del-meal-item" data-idx="${idx}">✕</button>
    </div>
  `).join('');

  list.querySelectorAll('.del-meal-item').forEach((b) => {
    b.onclick = () => {
      const idx = +b.dataset.idx;
      currentAnalyzedMeal.items.splice(idx, 1);
      renderMealItemsEditor();
    };
  });
}

async function loadMealHistory() {
  const container = $('#recentMealsList');
  if (!container || !S.token) return;
  try {
    const res = await api('/api/meals/history?days=3', { token: S.token });
    const meals = res.meals || [];
    if (!meals.length) {
      container.innerHTML = `<p class="muted small">No meals logged today yet.</p>`;
      return;
    }
    container.innerHTML = meals.map((m) => {
      const timeStr = new Date(m.logged_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
      const itemNames = (m.items || []).map((i) => i.name).join(', ');
      return `
        <div style="display:flex; justify-content:space-between; align-items:center; padding:10px 0; border-bottom:1px solid var(--line);">
          <div>
            <b>${esc(m.title)}</b> <span class="small muted">· ${timeStr}</span>
            <div class="small muted">${esc(itemNames)}</div>
          </div>
          <span class="pill ok">${Math.round(m.total_calories)} kcal</span>
        </div>`;
    }).join('');
  } catch (e) {
    container.innerHTML = `<p class="muted small">${e.message}</p>`;
  }
}


// ---------------------------------------------------------------- KhelBuddy AI Assistant (Feature F)
function openAssistantModal() {
  let modal = $('#assistantModal');
  if (!modal) {
    modal = document.createElement('div');
    modal.id = 'assistantModal';
    modal.className = 'assistant-modal';
    document.body.appendChild(modal);
  }

  modal.innerHTML = `
    <div class="assistant-sheet">
      <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:8px">
        <div style="display:flex; align-items:center; gap:8px;">
          <span style="font-size:1.4rem">🤖</span>
          <div>
            <b style="display:block">${t('assistant_title')}</b>
            <span class="small muted">${t('assistant_disclaimer')}</span>
          </div>
        </div>
        <button class="react-pill" id="assistantCloseBtn">✕</button>
      </div>

      <div class="suggestions-row" id="assistantSuggestions">
        <button class="suggestion-chip" data-q="How am I doing on my weekly goal?">🎯 My Goal</button>
        <button class="suggestion-chip" data-q="How is my squad doing this week?">👥 Squad Progress</button>
        <button class="suggestion-chip" data-q="What are good recovery tips for rest days?">☕ Rest Day Tips</button>
        <button class="suggestion-chip" data-q="Give me healthy mess diet advice">🥗 Nutrition Tips</button>
      </div>

      <div class="assistant-chat-body" id="assistantChatBody">
        <div class="ai-bubble">
          👋 Hi! I'm KhelBuddy, your collegiate fitness and habit assistant. How can I help you today?
        </div>
      </div>

      <div class="chat-composer" style="margin-top:8px;">
        <input type="text" id="assistantInput" placeholder="${t('assistant_placeholder')}" autocomplete="off">
        <button class="btn mari" id="assistantSendBtn">${t('chat_send')}</button>
      </div>
    </div>
  `;

  modal.hidden = false;
  $('#assistantCloseBtn').onclick = () => { modal.hidden = true; };

  const input = $('#assistantInput');
  const sendBtn = $('#assistantSendBtn');
  const body = $('#assistantChatBody');

  const sendAssistantMessage = async (text) => {
    if (!text || !text.trim()) return;
    haptic(25);
    input.value = '';
    body.innerHTML += `<div class="user-bubble">${esc(text)}</div>`;
    body.scrollTop = body.scrollHeight;

    const loaderId = 'ai-load-' + Date.now();
    body.innerHTML += `<div class="ai-bubble muted" id="${loaderId}">⏳ ${t('assistant_thinking')}</div>`;
    body.scrollTop = body.scrollHeight;

    try {
      const res = await api('/api/assistant/chat', { method: 'POST', token: S.token, body: { message: text } });
      const loadEl = $(`#${loaderId}`);
      if (loadEl) loadEl.remove();
      body.innerHTML += `<div class="ai-bubble">${esc(res.reply).replace(/\\n/g, '<br>')}</div>`;
      body.scrollTop = body.scrollHeight;
    } catch (e) {
      const loadEl = $(`#${loaderId}`);
      if (loadEl) loadEl.textContent = `Error: ${e.message}`;
    }
  };

  sendBtn.onclick = () => sendAssistantMessage(input.value);
  input.onkeydown = (e) => { if (e.key === 'Enter') sendAssistantMessage(input.value); };

  modal.querySelectorAll('.suggestion-chip').forEach((chip) => {
    chip.onclick = () => {
      sendAssistantMessage(chip.dataset.q);
    };
  });
}


const VIEWS = {
  onboard: viewOnboard,
  home: viewHome,
  log: viewLog,
  fitcheck: viewFitcheck,
  setup: viewSetup,
  run: viewRun,
  result: viewResult,
  squad: viewSquad,
  leaderboard: viewLeaderboard,
  chat: viewChat,
  feed: viewFeed,
  meals: viewMeals,
  privacy: viewPrivacy,
  slots: viewSlots
};

// ---------------------------------------------------------------- boot
(async function boot() {
  // 1. Detect performance tier BEFORE rendering to avoid flicker
  const tier = (() => {
    if (typeof navigator.deviceMemory !== 'undefined' && navigator.deviceMemory < 2) return 'lite';
    if (typeof navigator.hardwareConcurrency !== 'undefined' && navigator.hardwareConcurrency < 4) return 'lite';
    if (window.matchMedia('(prefers-reduced-data: reduce)').matches) return 'lite';
    return 'full';
  })();
  document.documentElement.dataset.tier = tier;

  // 2. Honour system reduce-motion
  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
    document.documentElement.dataset.reduceMotion = '1';
  }

  // 3. Load stored settings
  try {
    const lang = await kvGet('lang').catch(() => null);
    setLang(lang || 'en');
    S.profile = await kvGet('profile').catch(() => null);
    S.token = await kvGet('token').catch(() => null);
    const savedPrefs = await kvGet('prefs').catch(() => null);
    if (savedPrefs) Object.assign(S.prefs, savedPrefs);
    // On first load with Neon Arena redesign, migrate to dark theme
    // (old saved 'light' was from a different design era)
    if (!savedPrefs?.neonMigrated) {
      S.prefs.theme = 'dark';
      S.prefs.neonMigrated = true;
      await kvSet('prefs', S.prefs).catch(() => {});
    }
    applyTheme(S.prefs.theme);
  } catch (err) {
    console.warn('Boot storage init error:', err);
    applyTheme('dark');
  }

  // 4. Service worker
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('sw.js').then((reg) => {
      reg.update().catch(() => {});
      reg.addEventListener('updatefound', () => {
        const newWorker = reg.installing;
        newWorker?.addEventListener('statechange', () => {
          if (newWorker.state === 'installed' && navigator.serviceWorker.controller) {
            toast(t('appUpdated'), 5000);
          }
        });
      });
    }).catch(() => {});
  }
  if (navigator.storage && navigator.storage.persist) {
    navigator.storage.persisted().then((p) => { if (!p) navigator.storage.persist().catch(() => {}); }).catch(() => {});
  }

  go(S.profile ? 'home' : 'onboard');
  trySync().catch(() => {});
})();

window.__ks = { S, go, localState, net };

