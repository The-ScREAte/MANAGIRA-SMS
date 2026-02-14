/* 
 * SPA Router v2 Quick Reference
 * 
 * The SPA (Single Page Application) Router provides instant navigation.
 * 
 * What it does:
 * ─────────────
 * • Instant page transitions without full reloads
 * • Back/Forward buttons work immediately (scroll position restored)
 * • Links preload on hover and when visible in viewport
 * • Videos and images handled correctly during navigation
 * • Automatic progress bar for uncached page loads
 * • Caches up to 25 pages per session
 * • Graceful fallback to full reload on any error
 * 
 * Developer commands (browser console):
 * ─────────────────────────────────────
 * spaRouter.clearCache()         — Clear all cached pages
 * spaRouter.preloadPage(url)     — Manually preload a page
 * 
 * Opting out of SPA for a link:
 * ─────────────────────────────
 * <a href="/page" data-no-spa>Full reload link</a>
 * 
 * Or wrap a section:
 * <div data-no-spa>
 *   <a href="/page">All links here use full reload</a>
 * </div>
 */
