// Shared helpers for login-page ads (login page + Announcements editor).
(function () {
  var PDFJS_BASE = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/';
  var pdfJsPromise = null;

  function loadPdfJs() {
    if (window.pdfjsLib) return Promise.resolve(window.pdfjsLib);
    if (pdfJsPromise) return pdfJsPromise;
    pdfJsPromise = new Promise(function (resolve, reject) {
      var s = document.createElement('script');
      s.src = PDFJS_BASE + 'pdf.min.js';
      s.onload = function () {
        window.pdfjsLib.GlobalWorkerOptions.workerSrc = PDFJS_BASE + 'pdf.worker.min.js';
        resolve(window.pdfjsLib);
      };
      s.onerror = function () { pdfJsPromise = null; reject(new Error('Could not load PDF viewer')); };
      document.head.appendChild(s);
    });
    return pdfJsPromise;
  }

  // Draws page 1 of a PDF into the canvas (optionally at a set pixel width).
  // Resolves with the page's natural size.
  function renderPdf(canvas, url, width) {
    return loadPdfJs()
      .then(function (pdfjs) { return pdfjs.getDocument(url).promise; })
      .then(function (pdf) { return pdf.getPage(1); })
      .then(function (page) {
        var base = page.getViewport({ scale: 1 });
        var dpr = Math.min(window.devicePixelRatio || 1, 2);
        var targetWidth = width || Math.min(Math.max(canvas.clientWidth || 800, 800) * dpr, 2400);
        var viewport = page.getViewport({ scale: targetWidth / base.width });
        canvas.width = Math.round(viewport.width);
        canvas.height = Math.round(viewport.height);
        return page.render({ canvasContext: canvas.getContext('2d'), viewport: viewport }).promise
          .then(function () { return { width: Math.round(base.width), height: Math.round(base.height) }; });
      });
  }

  function removeLoading(canvas) {
    var label = canvas.previousElementSibling;
    if (label && label.classList.contains('ad-stage__loading')) label.remove();
  }

  function renderPdfsIn(root) {
    root.querySelectorAll('canvas[data-pdf-src]').forEach(function (canvas) {
      renderPdf(canvas, canvas.dataset.pdfSrc).then(function () { removeLoading(canvas); }, function () { removeLoading(canvas); });
    });
  }

  // Sign-in page clicks are counted without delaying navigation.
  function countSignInClick(id) {
    var url = '/account/login-ads/' + encodeURIComponent(id) + '/click';
    if (navigator.sendBeacon) navigator.sendBeacon(url);
    else fetch(url, { method: 'POST', keepalive: true }).catch(function () {});
  }

  // Rotating panel beside the sign-in form (views/partials/loginAdsPanel.ejs).
  function initSignInPanel(root) {
    if (root.dataset.ready === '1') return;
    root.dataset.ready = '1';
    var slides = Array.prototype.slice.call(root.querySelectorAll('.login-ad'));
    var dots = Array.prototype.slice.call(root.querySelectorAll('[data-ad-dot]'));
    var ROTATE_MS = 8000;
    var current = 0;
    var timer = null;

    renderPdfsIn(root);
    root.querySelectorAll('[data-ad-click]').forEach(function (link) {
      link.addEventListener('click', function () { countSignInClick(link.dataset.adClick); });
    });

    function show(index) {
      current = (index + slides.length) % slides.length;
      slides.forEach(function (slide, i) {
        var active = i === current;
        slide.classList.toggle('is-active', active);
        slide.setAttribute('aria-hidden', active ? 'false' : 'true');
        slide.querySelectorAll('a').forEach(function (a) { a.tabIndex = active ? 0 : -1; });
        var video = slide.querySelector('video');
        if (video) { if (active) video.play().catch(function () {}); else video.pause(); }
      });
      dots.forEach(function (dot, i) { dot.classList.toggle('is-active', i === current); });
    }
    function start() {
      if (slides.length < 2 || timer) return;
      timer = setInterval(function () { show(current + 1); }, ROTATE_MS);
    }
    function stop() { clearInterval(timer); timer = null; }

    dots.forEach(function (dot) {
      dot.addEventListener('click', function () { stop(); show(Number(dot.dataset.adDot)); start(); });
    });
    root.addEventListener('mouseenter', stop);
    root.addEventListener('mouseleave', start);
    root.addEventListener('focusin', stop);
    root.addEventListener('focusout', start);
    show(0);
    start();
  }

  function init() {
    document.querySelectorAll('[data-login-ads]').forEach(initSignInPanel);
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();

  window.LoginAds = { renderPdf: renderPdf, renderPdfsIn: renderPdfsIn };
})();
