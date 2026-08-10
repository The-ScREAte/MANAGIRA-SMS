// Shared helper for pages that can be loaded inside a hub's iframe (see
// views/common/managementTools.ejs, admissionsHub.ejs, reportsHub.ejs). The
// hub appends ?embed=workspace to the initial iframe src so the destination
// page knows to render without the global header/footer/chatbot (it already
// has its own, from the hub shell around it).
//
// Problem this solves: these pages have many internal redirects (save
// handlers, validation fallbacks, etc.) that rebuild their own URL and do
// not all know to carry the ?embed=workspace flag forward. Patching every
// redirect individually is fragile — miss one and the header/footer flash
// back in. Instead, the FIRST embedded request for a given page stores a
// short-lived marker on the session; a later request to that same page
// without the query param can still count as embedded, but ONLY if it looks
// like a genuine continuation of that embedded page (see below) — not just
// "the session touched this page recently."
//
// Why not trust the session marker alone: sessions are shared across every
// tab. A user who opens Integrations inside the Management hub (setting the
// marker), then opens a brand new tab and types /account/settings directly,
// would otherwise have that second, completely unrelated tab silently
// rendered in embedded mode too — hiding its sidebar and header for no
// reason the user can see. That's exactly what "the menu sometimes
// disappears" on the standalone settings page turned out to be.
//
// The fix: require the request to carry a Referer that itself points at an
// embedded URL (i.e. it was reached via a link/redirect FROM a page that was
// already rendered embedded) before honoring the session marker. A fresh
// top-level visit — typed URL, bookmark, a normal in-app link from a
// non-embedded page — never has that, so it can't inherit stale state. A
// narrow, short fallback window covers the rare case where the browser
// strips the Referer entirely (privacy settings, cross-origin policy) but
// the redirect still happened within the same instant.
const WINDOW_MS = 5 * 60 * 1000; // how long the marker itself stays eligible
const NO_REFERER_FALLBACK_MS = 8 * 1000; // grace period when Referer is missing

function isEmbeddedRequest(req, routeKey) {
  const requestedNow = String(req.query.embed || "").toLowerCase() === "workspace";

  if (!req.session) {
    return requestedNow;
  }

  req.session.embeddedRoutes = req.session.embeddedRoutes || {};

  if (requestedNow) {
    req.session.embeddedRoutes[routeKey] = Date.now() + WINDOW_MS;
    return true;
  }

  const expiresAt = req.session.embeddedRoutes[routeKey];
  if (!expiresAt || expiresAt <= Date.now()) {
    if (expiresAt) delete req.session.embeddedRoutes[routeKey]; // lapsed — clean up
    return false;
  }

  const referer = String(req.get("referer") || req.get("referrer") || "");
  const refererLooksEmbedded = /[?&]embed=workspace(?:&|$)/.test(referer);
  const setAt = expiresAt - WINDOW_MS;
  const withinNoRefererFallback = Date.now() - setAt <= NO_REFERER_FALLBACK_MS;

  if (!refererLooksEmbedded && !withinNoRefererFallback) {
    return false;
  }

  req.session.embeddedRoutes[routeKey] = Date.now() + WINDOW_MS; // refresh window
  return true;
}

module.exports = { isEmbeddedRequest };
