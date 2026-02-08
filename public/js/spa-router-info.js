/* 
 * SPA Router Quick Reference
 * 
 * The SPA (Single Page Application) Router is now active on your site!
 * 
 * What does it do?
 * ----------------
 * - Makes navigation between auth and public pages instant (no page reload)
 * - Preloads pages when you hover over links
 * - Caches up to 10 pages for ultra-fast navigation
 * - Works with browser back/forward buttons
 * 
 * Pages with instant navigation:
 * -----------------------------
 * ✓ Home page (/)
 * ✓ Login page (/account/login)
 * ✓ Register page (/account/register)
 * ✓ Hub login (/hub/login)
 * ✓ Guardian login (/account/guardian-login)
 * ✓ Reset password (/account/reset-password)
 * ✓ Pricing page (/common/pricing)
 * ✓ All footer links (Help, Employment, Donations, About Us, Privacy, Terms, FAQ)
 * 
 * How to use:
 * -----------
 * Just click links normally! The router handles everything automatically.
 * 
 * Developer commands (in browser console):
 * ---------------------------------------
 * window.spaRouter.clearCache()       - Clear all cached pages
 * window.spaRouter.preloadPage(url)   - Manually preload a page
 * 
 * Troubleshooting:
 * ---------------
 * If navigation isn't working:
 * 1. Check browser console for errors
 * 2. Run: window.spaRouter.clearCache()
 * 3. Refresh the page
 * 
 * Still having issues? The router will automatically fall back to 
 * traditional navigation if something goes wrong.
 */


