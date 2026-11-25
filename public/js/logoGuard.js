(function () {
  'use strict';
  // A school's logo in the header that fails to load (slow or no connection) is tried again quietly,
  // and again when the connection comes back. If it still can't load, the school's initials show
  // instead of a broken picture, and the picture takes its place the moment it can be fetched.
  var SELECTOR = 'img.logo, img.fam-logo';
  var DELAYS = [800, 2500, 7000];

  function schoolName(img) {
    var holder = img.closest('.header-mobile-left, header, .siteName');
    var name = holder && holder.querySelector('.org-names');
    return ((name && name.textContent) || img.getAttribute('data-school') || document.title || 'S').trim();
  }
  function initials(text) {
    var words = String(text).replace(/[^A-Za-z0-9 ]+/g, ' ').split(/\s+/).filter(Boolean);
    return (words.slice(0, 2).map(function (w) { return w[0]; }).join('') || 'S').toUpperCase();
  }
  function withRetry(src, n) {
    return src.replace(/([?&])logoretry=\d+&?/, '$1').replace(/[?&]$/, '') + (src.indexOf('?') > -1 ? '&' : '?') + 'logoretry=' + n;
  }
  function showFallback(img) {
    if (img.__logoFallback) return;
    var badge = document.createElement('span');
    badge.className = img.className + ' logo-fallback';
    badge.setAttribute('role', 'img');
    badge.setAttribute('aria-label', schoolName(img));
    badge.textContent = initials(schoolName(img));
    img.__logoFallback = badge;
    img.style.display = 'none';
    img.parentNode.insertBefore(badge, img.nextSibling);
  }
  function restore(img) {
    if (img.__logoFallback) { img.__logoFallback.remove(); img.__logoFallback = null; }
    img.style.display = '';
  }
  function retry(img) {
    var tries = img.__logoTries || 0;
    if (tries >= DELAYS.length) { showFallback(img); return; }
    img.__logoTries = tries + 1;
    window.setTimeout(function () {
      if (!img.isConnected) return;
      img.src = withRetry(img.getAttribute('src') || '', img.__logoTries);
    }, DELAYS[tries]);
  }
  function failed(img) { return img.complete && img.naturalWidth === 0 && (img.getAttribute('src') || ''); }

  // Error events don't bubble, but they can be caught on the way down.
  document.addEventListener('error', function (event) {
    var img = event.target;
    if (img && img.tagName === 'IMG' && img.matches(SELECTOR)) retry(img);
  }, true);
  document.addEventListener('load', function (event) {
    var img = event.target;
    if (img && img.tagName === 'IMG' && img.matches(SELECTOR)) { img.__logoTries = 0; restore(img); }
  }, true);

  function sweep(reset) {
    Array.prototype.forEach.call(document.querySelectorAll(SELECTOR), function (img) {
      if (!failed(img)) return;
      if (reset) img.__logoTries = 0;
      retry(img);
    });
  }
  // A picture that failed before this script ran.
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', function () { sweep(false); });
  else sweep(false);
  window.addEventListener('online', function () { sweep(true); });
  document.addEventListener('visibilitychange', function () { if (!document.hidden) sweep(true); });
})();
