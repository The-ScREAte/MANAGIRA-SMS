// ─── Managira Service Worker ────────────────────────────────────────────────
// Safe PWA caching layer.
// Rules:
//   • Only intercepts same-origin GET requests
//   • NEVER intercepts: POST, /api/, auth routes (login, logout, register, set-password …)
//   • Caches static assets (CSS, JS, images, fonts) with a stale-while-revalidate
//     strategy so a fresh copy is always fetched in the background and the cache
//     self-heals after a deploy (no more permanently-stale old code)
//   • All other requests (HTML pages, etc.) pass straight to the network
// ─────────────────────────────────────────────────────────────────────────────

// Bump this version on every deploy that ships new front-end assets. Changing it
// causes the activate handler to purge ALL previous caches, guaranteeing users
// stop being served old cached code.
const CACHE_NAME = 'managira-static-v2';

// File extensions that get cache-first treatment
const STATIC_EXT = /\.(css|js|png|jpg|jpeg|gif|svg|ico|webp|woff|woff2|ttf|eot)(\?.*)?$/i;

// URL path patterns that must ALWAYS go to the network (never cached)
const NETWORK_ONLY = [
  /\/api\//i,
  /\/login/i,
  /\/logout/i,
  /\/register/i,
  /\/set-password/i,
  /\/reset-password/i,
  /\/forgot-password/i,
  /\/guardian-login/i,
  /\/account-register/i,
  /\/auth\//i,
  /\/session/i,
  /\/notifications/i,
];

function mustSkip(request) {
  // Skip non-GET (POST, PUT, DELETE …)
  if (request.method !== 'GET') return true;

  const url = new URL(request.url);

  // Skip cross-origin requests entirely — let the browser handle them directly
  if (url.origin !== self.location.origin) return true;

  // Skip any auth / API route
  return NETWORK_ONLY.some((pattern) => pattern.test(url.pathname));
}

// ── Install ───────────────────────────────────────────────────────────────────
self.addEventListener('install', (event) => {
  // Skip waiting so the new SW activates immediately
  self.skipWaiting();
});

// ── Activate ──────────────────────────────────────────────────────────────────
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys
            .filter((k) => k !== CACHE_NAME)
            .map((k) => caches.delete(k))
        )
      )
      .then(() => self.clients.claim())
  );
});

// ── Fetch ─────────────────────────────────────────────────────────────────────
self.addEventListener('fetch', (event) => {
  const { request } = event;

  // For any request that must go straight to the network, do NOT call
  // event.respondWith() — the browser handles it normally.
  if (mustSkip(request)) return;

  const url = new URL(request.url);

  if (STATIC_EXT.test(url.pathname)) {
    // Stale-while-revalidate for static assets:
    // 1. Return cached copy instantly if available (fast first paint)
    // 2. ALWAYS fetch from network in the background to refresh the cache so the
    //    next load gets the latest deployed asset — this prevents old code from
    //    being served indefinitely after a deploy.
    event.respondWith(
      caches.match(request).then((cached) => {
        const networkFetch = fetch(request)
          .then((response) => {
            // Only cache valid responses
            if (response && response.ok && response.status === 200) {
              const clone = response.clone();
              caches
                .open(CACHE_NAME)
                .then((cache) => cache.put(request, clone))
                .catch(() => {}); // silently ignore cache write errors
            }
            return response;
          })
          .catch(() => cached); // offline: fall back to cache if we have it

        // Serve cache immediately when present, but keep the network fetch alive
        // so the cache is updated for next time.
        return cached || networkFetch;
      })
    );
    return;
  }

  // For all other same-origin GET requests (HTML page navigations, etc.):
  // Do NOT call event.respondWith() — let the network handle them normally.
  // This guarantees fresh page content and keeps all auth flows intact.
});
