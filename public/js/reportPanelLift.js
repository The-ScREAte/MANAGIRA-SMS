// Report pop-ups that show and hide with style.display: mark them open (class is-open) while shown, so
// embedPopupLift.js can lift the frame to start under the app header ([data-popup-lift].is-open).
(function () {
  'use strict';
  var watched = [];
  function sync(el) {
    var shown = el.hasAttribute('data-rp-open') || window.getComputedStyle(el).display !== 'none';
    if (el.classList.contains('is-open') !== shown) el.classList.toggle('is-open', shown);
  }
  function scan() {
    document.querySelectorAll('[data-popup-lift][data-rp-watch]').forEach(function (el) {
      if (watched.indexOf(el) === -1) {
        watched.push(el);
        new MutationObserver(function () { sync(el); }).observe(el, { attributes: true, attributeFilter: ['style', 'class'] });
      }
      sync(el);
    });
  }
  new MutationObserver(scan).observe(document.documentElement, { childList: true, subtree: true });
  scan();
})();
