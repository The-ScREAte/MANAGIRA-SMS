// ─── Managira Service Worker ────────────────────────────────────────────────
// Safe PWA caching layer.
// Rules:
//   • Only intercepts same-origin GET requests
//   • NEVER intercepts: POST, /api/, auth routes (login, logout, register, set-password …)
//   • Caches static assets (CSS, JS, images, fonts) with a stale-while-revalidate
//     strategy so a fresh copy is always fetched in the background and the cache
//     self-heals after a deploy (no more permanently-stale old code)
//   • Workspace panels (pages opened inside the Management / Admissions /
//     Reports menus, ?embed=workspace) are kept so a page you come back to
//     shows at once while a fresh copy loads in the background (see below)
//   • All other requests (HTML pages, etc.) pass straight to the network
// ─────────────────────────────────────────────────────────────────────────────

// Bump this version on every deploy that ships new front-end assets. Changing it
// causes the activate handler to purge ALL previous caches, guaranteeing users
// stop being served old cached code.
const CACHE_NAME = 'managira-static-v2';

// ── Workspace panels ──────────────────────────────────────────────────────────
// A panel you open again shows its last copy at once; a fresh copy is fetched
// in the background and the menu page is told when it differs (it swaps it in
// if you haven't started using the page). Kept copies are never shown:
//   • after any change (any POST/PUT/DELETE, or a GET that deletes, removes,
//     switches or signs out): the "generation" changes and every copy is dropped;
//   • when older than PANEL_MAX_AGE_MS;
//   • when the fresh request is redirected (signed out, no access).
const PANEL_CACHE = 'managira-panels-v1';
const PANEL_MAX_AGE_MS = 30 * 60 * 1000;
const CHANGING_GET = /\/(delete|remove|toggle|obsolete|enable|disable|unarchive|archive|logout|switch|impersonat)/i;
// The generation is kept next to the copies, since the browser stops an idle
// service worker after about 30 seconds and its memory starts over.
const GENERATION_KEY = self.location.origin + '/__managira_panel_generation';
const newGeneration = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
let panelGeneration = null;

async function currentGeneration() {
  if (panelGeneration) return panelGeneration;
  const cache = await caches.open(PANEL_CACHE);
  const saved = await cache.match(GENERATION_KEY);
  if (panelGeneration) return panelGeneration; // a change landed meanwhile
  if (saved) {
    panelGeneration = await saved.text();
  } else {
    panelGeneration = newGeneration();
    await cache.put(GENERATION_KEY, new Response(panelGeneration));
  }
  return panelGeneration;
}

function dropPanelCopies() {
  const generation = newGeneration();
  panelGeneration = generation; // at once, so nothing in flight is kept
  return caches.delete(PANEL_CACHE)
    .then(() => caches.open(PANEL_CACHE))
    .then((cache) => cache.put(GENERATION_KEY, new Response(generation)))
    .catch(() => {});
}

function isWorkspacePanel(request, url) {
  return request.method === 'GET'
    && request.mode === 'navigate'
    && url.origin === self.location.origin
    && url.searchParams.get('embed') === 'workspace'
    && !NETWORK_ONLY.some((pattern) => pattern.test(url.pathname));
}

// The menu pages themselves (their sidebar), kept the same way. The panel
// that opens is chosen in the page from its address, so one copy per menu.
const HUB_PAGES = ['/common/management', '/common/admissions', '/common/reports'];
function isHubPage(request, url) {
  return request.method === 'GET'
    && request.mode === 'navigate'
    && url.origin === self.location.origin
    && HUB_PAGES.includes(url.pathname.replace(/\/$/, ''))
    && !url.searchParams.has('embed');
}

async function tellPages(message) {
  const windows = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
  windows.forEach((client) => client.postMessage(message));
}

async function freshPanel(request, generation, cachedText, key = request.url) {
  const response = await fetch(request);
  const finalUrl = new URL(response.url || request.url);
  const sameUrl = !response.redirected || finalUrl.pathname === new URL(request.url).pathname;
  const isHtml = (response.headers.get('content-type') || '').includes('text/html');
  if (!response.ok || !sameUrl || !isHtml) {
    // Signed out or sent elsewhere: drop every kept copy.
    if (response.redirected && !sameUrl) await dropPanelCopies();
    return { response, changed: cachedText !== undefined };
  }
  const text = await response.clone().text();
  if (generation === panelGeneration) {
    const headers = new Headers(response.headers);
    // The kept body is plain text (already decoded).
    headers.delete('content-encoding');
    headers.delete('content-length');
    headers.delete('etag');
    headers.set('x-panel-generation', generation);
    headers.set('x-panel-time', String(Date.now()));
    const cache = await caches.open(PANEL_CACHE);
    await cache.put(key, new Response(text, { status: 200, headers }));
  }
  return { response, changed: cachedText !== undefined && cachedText !== text };
}

async function servePanel(event, key = event.request.url) {
  const { request } = event;
  const generation = await currentGeneration();
  const cache = await caches.open(PANEL_CACHE);
  const cached = await cache.match(key);
  const usable = cached
    && cached.headers.get('x-panel-generation') === generation
    && Date.now() - Number(cached.headers.get('x-panel-time') || 0) < PANEL_MAX_AGE_MS;
  if (!usable) {
    if (cached) cache.delete(key).catch(() => {});
    const { response } = await freshPanel(request, generation, undefined, key);
    return response;
  }
  const cachedText = await cached.clone().text();
  // Show the kept copy now; check for a newer one in the background.
  event.waitUntil(
    freshPanel(request, generation, cachedText, key)
      .then(({ changed }) => { if (changed) return tellPages({ type: 'managira-panel-updated', url: request.url }); })
      .catch(() => {})
  );
  return cached;
}

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
            .filter((k) => k !== CACHE_NAME && k !== PANEL_CACHE)
            .map((k) => caches.delete(k))
        )
      )
      .then(() => self.clients.claim())
  );
});

// ── Fetch ─────────────────────────────────────────────────────────────────────
self.addEventListener('fetch', (event) => {
  const { request } = event;
  const requestUrl = new URL(request.url);

  // Anything that changes data (or signs in/out, or switches school) drops
  // every kept panel copy, so none is shown out of date afterwards.
  if (requestUrl.origin === self.location.origin
      && (request.method !== 'GET' || CHANGING_GET.test(requestUrl.pathname) || /\/login/i.test(requestUrl.pathname))) {
    event.waitUntil(dropPanelCopies());
  }

  if (isWorkspacePanel(request, requestUrl)) {
    event.respondWith(servePanel(event).catch(() => fetch(request)));
    return;
  }
  if (isHubPage(request, requestUrl)) {
    event.respondWith(servePanel(event, requestUrl.origin + requestUrl.pathname.replace(/\/$/, '')).catch(() => fetch(request)));
    return;
  }

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
