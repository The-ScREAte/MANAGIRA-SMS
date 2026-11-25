// Pop-ups from the right open from just under the app header down. A page inside a frame
// (a class tab, a management panel, a drawer) tells the page around it when one of its
// pop-ups is open, and that page lets the frame fill the screen from under the header.
(function () {
  'use strict';
  if (window.__popupLift) return;
  window.__popupLift = true;
  var TYPE = 'managira:popup-lift';
  // A frame inside this page that is lifted counts as an open pop-up here too, so a pop-up two
  // frames deep (a builder opened from the gradebook tab) lifts every frame up to the top page.
  var lifted = 0;
  var check = function () {};

  if (window.parent !== window) {
    // ---- inside a frame: say when a pop-up is open
    var SELECTOR = [
      '.question-modal-overlay.show', '.grade-modal-overlay.is-open', '.reuse-modal-overlay.show',
      '.students-modal-overlay.show', '.students-modal-overlay.is-open', '.qm-preview-overlay.show',
      '.qm-answer-password-overlay.show', '.af-drawer.is-open', '.af-dialog.is-open',
      '.mgr-drawer-overlay.is-open', '.cf-drawer[open]', '.ux-panel.is-open', '.ed-panel.is-open',
      '.ah-drawer.is-open', '.ah-panel[open]', '.att-done.is-in', '.app-confirm', '.cfm', '[data-popup-lift].is-open'
    ].join(',');
    var last = null;
    var tell = function (open) { try { window.parent.postMessage({ type: TYPE, open: open }, window.location.origin); } catch (e) {} };
    check = function () {
      var open = lifted > 0 || Boolean(document.querySelector(SELECTOR));
      if (open === last) return;
      last = open;
      tell(open);
    };
    new MutationObserver(check).observe(document.documentElement, { subtree: true, childList: true, attributes: true, attributeFilter: ['class', 'open'] });
    window.addEventListener('pagehide', function () { if (last) tell(false); });
    check();
  }

  // ---- around a frame: let that frame fill the screen under the header
  var saved = new WeakMap();
  window.addEventListener('message', function (event) {
    var data = event.data || {};
    if (event.origin !== window.location.origin || data.type !== TYPE) return;
    var frames = document.querySelectorAll('iframe');
    for (var i = 0; i < frames.length; i++) {
      var frame = frames[i];
      if (frame.contentWindow !== event.source) continue;
      if (data.open) {
        if (!saved.has(frame)) { saved.set(frame, frame.getAttribute('style')); lifted += 1; }
        var header = document.getElementById('top-header');
        var top = header ? header.offsetHeight : 0;
        var zoom = header && header.offsetHeight ? header.getBoundingClientRect().height / header.offsetHeight : (parseFloat(window.getComputedStyle(document.documentElement).zoom) || 1);
        frame.style.cssText = (saved.get(frame) || '') + ';position:fixed;left:0;right:0;top:' + top + 'px;width:100%;max-width:none;' +
          'height:' + Math.floor(window.innerHeight / zoom - top) + 'px;min-height:0;z-index:12990;border:0;';
      } else if (saved.has(frame)) {
        var was = saved.get(frame);
        saved.delete(frame);
        lifted = Math.max(0, lifted - 1);
        if (was === null) frame.removeAttribute('style'); else frame.setAttribute('style', was);
      }
    }
    check();
  });
})();
