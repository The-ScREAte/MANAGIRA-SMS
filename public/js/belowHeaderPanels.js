// Inline pop-ups that slide in from the right start under the app header (never over it).
// Mark the pop-up with data-below-header (open while not hidden), or data-below-header="open"
// (open while it has the class "open"). With data-popup-lift too, the class "is-open" mirrors
// the open state so a page inside a frame can tell the page around it (see embedPopupLift.js).
(function () {
  'use strict';
  if (window.__belowHeaderPanels) return;
  window.__belowHeaderPanels = true;
  var busy = false;
  function sync() {
    if (busy) return;
    busy = true;
    var header = document.getElementById('top-header');
    var rect = header ? header.getBoundingClientRect() : null;
    // A page scaled with CSS zoom (the header too) measures in screen pixels; the panel needs its own.
    var zoom = header && header.offsetHeight && rect && rect.height ? rect.height / header.offsetHeight : 1;
    var top = (rect && rect.height ? Math.max(0, Math.round(rect.bottom / (zoom || 1))) : 0) + 'px';
    document.querySelectorAll('[data-below-header]').forEach(function (el) {
      var cls = el.getAttribute('data-below-header');
      var open = cls ? el.classList.contains(cls) : (!el.hidden && getComputedStyle(el).display !== 'none');
      if (open && el.style.top !== top) el.style.top = top;
      // A panel sized "100%" or "100vh" from the top of the screen runs past the bottom once its top
      // moves down under the header; pin it to the bottom edge instead so its last pixel stays reachable.
      if (open && getComputedStyle(el).position === 'fixed') {
        var box = el.getBoundingClientRect();
        if (box.height > 0 && box.bottom > window.innerHeight + 1) { el.style.bottom = '0px'; el.style.height = 'auto'; el.style.maxHeight = 'none'; }
      }
      if (el.hasAttribute('data-popup-lift') && el.classList.contains('is-open') !== open) el.classList.toggle('is-open', open);
    });
    busy = false;
  }
  new MutationObserver(function () { sync(); }).observe(document.documentElement, { subtree: true, childList: true, attributes: true, attributeFilter: ['hidden', 'class'] });
  window.addEventListener('resize', sync);
  document.addEventListener('DOMContentLoaded', sync);
  sync();
})();
