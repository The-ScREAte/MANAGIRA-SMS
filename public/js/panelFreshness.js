// Menu pages (Management, Admissions, Reports). A page you come back to is
// shown at once from memory (see service-worker.js) while a fresh copy loads in
// the background. When the fresh copy differs, swap it in quietly, unless you
// have already started using that page (then the next visit shows it).
(function () {
  if (!('serviceWorker' in navigator) || window.__panelFreshnessBound) return;
  window.__panelFreshnessBound = true;

  // Note when someone starts using a page (click, typing, scrolling).
  document.addEventListener('load', function (event) {
    var frame = event.target;
    if (!frame || frame.tagName !== 'IFRAME' || !frame.classList.contains('embed-iframe')) return;
    frame.dataset.touched = '';
    try {
      var doc = frame.contentDocument;
      ['pointerdown', 'keydown', 'input', 'scroll'].forEach(function (type) {
        doc.addEventListener(type, function () { frame.dataset.touched = '1'; }, { once: true, capture: true, passive: true });
      });
    } catch (err) { /* not same-origin: leave it */ }
  }, true);

  navigator.serviceWorker.addEventListener('message', function (event) {
    var data = event.data || {};
    if (data.type !== 'managira-panel-updated' || !data.url) return;
    var target = new URL(data.url, window.location.href).href;
    Array.prototype.forEach.call(document.querySelectorAll('iframe.embed-iframe'), function (frame) {
      var href;
      try { href = frame.contentWindow.location.href; } catch (err) { return; }
      if (href !== target || frame.dataset.touched === '1') return;
      try { frame.contentWindow.location.reload(); } catch (err) { /* ignore */ }
    });
  });
})();
