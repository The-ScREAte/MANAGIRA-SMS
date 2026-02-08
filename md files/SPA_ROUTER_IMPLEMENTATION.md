# SPA Router Implementation - Single Page Application Navigation

## Overview
The SPA (Single Page Application) Router enables smooth, seamless navigation between public and authentication pages without full page reloads. This creates a faster, more app-like experience for users.

## Features

### ✅ Instant Navigation
- No page reloads when navigating between supported routes
- Smooth fade transitions between pages
- Browser history support (back/forward buttons work correctly)

### ✅ Smart Preloading
- **Hover Preloading**: Pages are preloaded when users hover over links
- **Common Pages**: Login, register, and legal pages are preloaded automatically
- **Intelligent Caching**: Up to 10 pages cached in memory for instant loading

### ✅ Supported Routes
The router handles navigation for the following pages:

**Home & Auth Pages:**
- `/` - Landing page
- `/account/login` - Organization login
- `/account/register` - Organization registration
- `/hub/login` - Hub login
- `/account/guardian-login` - Parent/Guardian login
- `/account/reset-password` - Password reset

**Legal & Info Pages:**
- `/legal/help` - Help/Support
- `/legal/employment` - Employment opportunities
- `/legal/donations` - Donation page
- `/legal/about-us` - About us
- `/legal/privacy-policy` - Privacy policy
- `/legal/terms-of-service` - Terms of service
- `/legal/faq` - Frequently asked questions

**Other:**
- `/common/pricing` - Pricing page

## Implementation Details

### Files Modified

1. **public/js/spa-router.js** (NEW)
   - Main router class implementation
   - Handles navigation, caching, and preloading
   - Re-initializes scripts after page transitions

2. **views/partials/head.ejs**
   - Added router script inclusion for all pages

3. **views/index.ejs**
   - Added router script for landing page

### How It Works

1. **Link Interception**: The router intercepts clicks on links that match supported routes
2. **AJAX Loading**: Fetches page content via AJAX without full reload
3. **Content Replacement**: Replaces only the main content area
4. **Script Re-execution**: Re-runs page-specific JavaScript
5. **History Management**: Updates browser URL and maintains history

### Technical Features

**Caching Strategy:**
```javascript
- LRU (Least Recently Used) cache
- Maximum 10 pages in memory
- Preloading on hover and after initial load
```

**Loading States:**
```javascript
- Smooth opacity transitions
- Loading spinner overlay during navigation
- Fade-in animation for new content
```

**Script Handling:**
```javascript
- Re-executes inline scripts
- Re-initializes password toggles
- Maintains event listeners
- Custom event dispatching for hooks
```

## User Experience

### Before (Traditional Navigation):
1. User clicks link
2. Browser shows loading spinner
3. Full page reloads (1-3 seconds)
4. White flash between pages
5. Scroll position resets

### After (SPA Navigation):
1. User hovers over link → Page preloads
2. User clicks link
3. Smooth fade transition (150ms)
4. Content updates instantly
5. No white flash or jarring transitions

## Browser Compatibility

- ✅ Chrome/Edge (Modern)
- ✅ Firefox (Modern)
- ✅ Safari (Modern)
- ✅ Mobile browsers

**Fallback:** If JavaScript is disabled or routing fails, traditional navigation still works.

## Events & Hooks

The router dispatches custom events that other scripts can listen to:

```javascript
// Listen for page changes
window.addEventListener('spa:pageLoaded', (event) => {
  console.log('New page loaded:', event.detail.path);
  // Your custom initialization code here
});
```

## Performance Benefits

1. **Reduced Server Load**: Cached pages don't require server requests
2. **Faster Navigation**: Preloaded pages load instantly
3. **Bandwidth Savings**: Only main content is transferred, not headers/footers
4. **Better UX**: Smooth transitions feel more professional

## Maintenance

### Adding New Routes

To add new routes to the SPA system:

1. Open `public/js/spa-router.js`
2. Add the route to the `this.routes` array in the constructor:

```javascript
this.routes = [
  // ... existing routes
  '/your/new/route',
];
```

### Debugging

The router includes console logging for errors:
- Navigation errors
- Script execution errors
- Cache operations

Check browser console for detailed information.

## Best Practices

1. **Keep routes simple**: Avoid routes with complex query parameters
2. **Test after updates**: Verify navigation works after adding new pages
3. **Clear cache**: Use `window.spaRouter.clearCache()` if experiencing issues
4. **Monitor performance**: Check Network tab to ensure caching works

## Known Limitations

1. **Route Scope**: Only works for specified routes, not all pages
2. **Form Submissions**: Complex forms may require page reload
3. **External Links**: External URLs still use traditional navigation
4. **Authentication**: Login/logout may still require full reload for session management

## Future Enhancements

- [ ] Service Worker integration for offline support
- [ ] Prefetch on mobile touch start
- [ ] Animated page transitions (slide/zoom effects)
- [ ] Progress bar for slower connections
- [ ] localStorage persistence for multi-session caching

## Support

For issues or questions about the SPA router:
1. Check browser console for error messages
2. Clear cache: `window.spaRouter.clearCache()`
3. Try traditional navigation to verify route exists
4. Contact development team with specific error details

---

**Implementation Date**: February 2026  
**Version**: 1.0.0  
**Developer Notes**: Ensure all new public-facing pages follow the same structure for compatibility with the router.
