// Service worker: precache the app shell + pose runtime with Network-First strategy
const CACHE = 'khelsetu-v5-streak-calendar';

const SHELL = [
  './',
  './index.html',
  './tokens.css',
  './styles.css',
  './app.js',
  './engine.js',
  './sim.js',
  './pose.js',
  './store.js',
  './i18n.js',
  './manifest.webmanifest',
  './icon.svg',
  './admin.html',
  './vendor/mediapipe/vision_bundle.mjs',
  './vendor/mediapipe/wasm/vision_wasm_internal.js',
  './vendor/mediapipe/wasm/vision_wasm_internal.wasm',
  './vendor/mediapipe/wasm/vision_wasm_nosimd_internal.js',
  './vendor/mediapipe/wasm/vision_wasm_nosimd_internal.wasm',
  './vendor/mediapipe/wasm/vision_wasm_module_internal.js',
  './vendor/mediapipe/wasm/vision_wasm_module_internal.wasm',
  './vendor/models/pose_landmarker_lite.task'
];

self.addEventListener('install', (e) => {
  self.skipWaiting();
  e.waitUntil(
    caches.open(CACHE).then((c) => Promise.all(SHELL.map((u) => c.add(u).catch(() => null))))
  );
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then((ks) => Promise.all(ks.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.pathname.startsWith('/api/')) return;

  // Heavy static assets (WASM / models) -> Cache-First
  if (url.pathname.includes('/vendor/')) {
    e.respondWith(
      caches.match(e.request).then((hit) => hit || fetch(e.request).then((res) => {
        if (res.ok) {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put(e.request, copy));
        }
        return res;
      }))
    );
    return;
  }

  // App shell (HTML / CSS / JS) -> Network-First, fallback to Cache
  e.respondWith(
    fetch(e.request).then((res) => {
      if (res.ok && url.origin === location.origin) {
        const copy = res.clone();
        caches.open(CACHE).then((c) => c.put(e.request, copy));
      }
      return res;
    }).catch(() => caches.match(e.request, { ignoreSearch: true }).then((hit) => hit || caches.match('./index.html')))
  );
});
