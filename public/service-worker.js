// Managira Service Worker
// Strategy:
//   - Navigation (HTML pages): network-only — pages are dynamic/server-rendered
//   - Static assets (CSS, JS, images): cache-first, fallback to network

const CACHE_NAME = 'managira-v1';

// Static assets to pre-cache on install
const PRE_CACHE = [
  '/css/style.css',
  '/css/buttons.css',
  '/css/index.css',
  '/images/managira.png',
  '/favicon.ico',
];

// ── Install ────────────────────────────────────────────────────────────────
self.addEventListener('install', (e) => {
  e.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(PRE_CACHE))
  );
  // Take control immediately without waiting for old SW to be replaced
  self.skipWaiting();
});

// ── Activate ───────────────────────────────────────────────────────────────
self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys
          .filter((key) => key !== CACHE_NAME)
          .map((key) => caches.delete(key))
      )
    )
  );
  // Claim all existing clients so the new SW is active immediately
  self.clients.claim();
});

// ── Fetch ──────────────────────────────────────────────────────────────────
self.addEventListener('fetch', (e) => {
  const { request } = e;
  const url = new URL(request.url);

  // Only intercept same-origin requests
  if (url.origin !== self.location.origin) return;

  // Navigation requests (full page loads) — always go to network
  // This keeps dynamic EJS pages fresh (session data, school data, etc.)
  if (request.mode === 'navigate') {
    e.respondWith(fetch(request));
    return;
  }

  // Static asset requests — cache-first, then network + cache
  if (
    request.method === 'GET' &&
    (url.pathname.startsWith('/css/') ||
      url.pathname.startsWith('/js/') ||
      url.pathname.startsWith('/images/') ||
      url.pathname.startsWith('/static/') ||
      url.pathname === '/favicon.ico')
  ) {
    e.respondWith(
      caches.match(request).then((cached) => {
        if (cached) return cached;
        return fetch(request).then((response) => {
          if (response.ok) {
            const clone = response.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(request, clone));
          }
          return response;
        });
      })
    );
  }
});
