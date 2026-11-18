/* School website: words over photos stay readable on every photo. Each opening that puts its
 * name and words over the photos (Academy, Story, Panorama: [data-sw-tone-host]) looks at how
 * light the photo is right behind the words, for the photo showing now, and sets
 * data-sw-tone="dark" (white words over a soft dark shade) or "light" (dark words over a soft
 * light shade); data-sw-busy adds a stronger shade where the photo is busy. It looks again on
 * every slide. Every slider's dots get data-sw-dots="dark" over a light photo. Without it (or if a photo can't be read) the designed white words and dark shade
 * stay. The photos come from the school's own address, so reading them is allowed.
 */
(function () {
  'use strict';
  var SAMPLE_W = 48;
  var SAMPLE_H = 24;
  var canvas = document.createElement('canvas');
  canvas.width = SAMPLE_W;
  canvas.height = SAMPLE_H;
  var ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) return;

  // Where an <img> draws its picture inside its box, for object-fit contain / cover / fill.
  function drawnRect(img) {
    var box = img.getBoundingClientRect();
    var nw = img.naturalWidth;
    var nh = img.naturalHeight;
    if (!nw || !nh || !box.width || !box.height) return null;
    var style = getComputedStyle(img);
    var fit = style.objectFit || 'fill';
    var w = box.width;
    var h = box.height;
    if (fit === 'contain' || fit === 'scale-down') {
      var s1 = Math.min(box.width / nw, box.height / nh);
      w = nw * s1; h = nh * s1;
    } else if (fit === 'cover') {
      var s2 = Math.max(box.width / nw, box.height / nh);
      w = nw * s2; h = nh * s2;
    }
    var pos = String(style.objectPosition || '50% 50%').split(/\s+/);
    var px = parseFloat(pos[0]);
    var py = parseFloat(pos[1] == null ? pos[0] : pos[1]);
    px = isNaN(px) ? 0.5 : px / 100;
    py = isNaN(py) ? 0.5 : py / 100;
    return { left: box.left + (box.width - w) * px, top: box.top + (box.height - h) * py, width: w, height: h, nw: nw, nh: nh };
  }

  // Average lightness (0 dark to 1 light) and how much it varies, of an image under a screen area.
  function sample(img, area) {
    var r = drawnRect(img);
    if (!r) return null;
    var left = Math.max(area.left, r.left);
    var top = Math.max(area.top, r.top);
    var right = Math.min(area.right, r.left + r.width);
    var bottom = Math.min(area.bottom, r.top + r.height);
    if (right - left < 4 || bottom - top < 4) return null;
    var sx = ((left - r.left) / r.width) * r.nw;
    var sy = ((top - r.top) / r.height) * r.nh;
    var sw = ((right - left) / r.width) * r.nw;
    var sh = ((bottom - top) / r.height) * r.nh;
    try {
      ctx.clearRect(0, 0, SAMPLE_W, SAMPLE_H);
      ctx.drawImage(img, sx, sy, sw, sh, 0, 0, SAMPLE_W, SAMPLE_H);
      var data = ctx.getImageData(0, 0, SAMPLE_W, SAMPLE_H).data;
      var sum = 0, sumSq = 0, n = 0;
      for (var i = 0; i < data.length; i += 4) {
        if (data[i + 3] < 128) continue;
        var l = (0.2126 * data[i] + 0.7152 * data[i + 1] + 0.0722 * data[i + 2]) / 255;
        sum += l; sumSq += l * l; n += 1;
      }
      if (!n) return null;
      var mean = sum / n;
      return { mean: mean, spread: Math.sqrt(Math.max(0, sumSq / n - mean * mean)), share: ((right - left) * (bottom - top)) / ((area.right - area.left) * (area.bottom - area.top)) };
    } catch (_) {
      return null; // a photo from elsewhere can't be read: the designed look stays
    }
  }

  // How light the showing photo is under an element: { mean, spread } or null.
  function lightness(root, over) {
    var slide = root.querySelector('.sw-slide.is-active') || root.querySelector('.sw-slide');
    if (!over || !slide) return null;
    var area = over.getBoundingClientRect();
    if (!area.width || !area.height) return null;
    var main = slide.querySelector('img.sw-slide__img');
    var back = slide.querySelector('img.sw-slide__backdrop');
    if (!main && slide.querySelector('video')) main = null;
    var parts = [];
    var a = main && main.complete ? sample(main, area) : null;
    if (a) parts.push(a);
    // Words beside a whole photo sit over its blurred copy: that counts for the rest.
    if ((!a || a.share < 0.95) && back && back.complete) {
      var b = sample(back, area);
      if (b) {
        // It is drawn dimmed (filter: brightness(...)): count it as it shows.
        var dim = /brightness\(([\d.]+)(%?)\)/.exec(getComputedStyle(back).filter || '');
        var k = dim ? parseFloat(dim[1]) / (dim[2] ? 100 : 1) : 1;
        if (k > 0 && k < 1) { b.mean *= k; b.spread *= k; }
        b.share = Math.max(0, 1 - (a ? a.share : 0));
        parts.push(b);
      }
    }
    if (!parts.length) return null;
    var total = parts.reduce(function (t, p) { return t + p.share; }, 0) || 1;
    return {
      mean: parts.reduce(function (t, p) { return t + p.mean * p.share; }, 0) / total,
      spread: parts.reduce(function (t, p) { return t + p.spread * p.share; }, 0) / total
    };
  }

  function decide(host) {
    // The words over the photo (an opening that puts them there).
    if (host.hasAttribute('data-sw-tone-host')) {
      var words = lightness(host, host.querySelector('[data-sw-tone-text]'));
      if (words) {
        host.setAttribute('data-sw-tone', words.mean > 0.62 ? 'light' : 'dark');
        host.toggleAttribute('data-sw-busy', words.spread > 0.2);
      }
    }
    // The slider's dots, on every design: dark dots on a light photo. Under the words' shade
    // (an opening with words over the photo) they follow the words.
    var tone = host.getAttribute('data-sw-tone');
    host.querySelectorAll('[data-sw-slider]').forEach(function (slider) {
      if (tone) { slider.setAttribute('data-sw-dots', tone === 'light' ? 'dark' : 'light'); return; }
      var dots = lightness(slider, slider.querySelector('.sw-slider__dots'));
      if (dots) slider.setAttribute('data-sw-dots', dots.mean > 0.62 ? 'dark' : 'light');
    });
  }

  function watch(host) {
    var run = function () { decide(host); };
    host.querySelectorAll('img.sw-slide__img, img.sw-slide__backdrop').forEach(function (img) {
      if (!img.complete) img.addEventListener('load', run, { once: true });
    });
    // A new slide: look again.
    var observer = new MutationObserver(function (changes) {
      if (changes.some(function (c) { return c.target.classList && c.target.classList.contains('sw-slide') && c.target.classList.contains('is-active'); })) run();
    });
    host.querySelectorAll('.sw-slide').forEach(function (slide) { observer.observe(slide, { attributes: true, attributeFilter: ['class'] }); });
    var timer = null;
    window.addEventListener('resize', function () { clearTimeout(timer); timer = setTimeout(run, 200); });
    run();
  }

  // Each opening with words over the photos, and each other slider on its own.
  function start() {
    document.querySelectorAll('[data-sw-tone-host]').forEach(watch);
    document.querySelectorAll('[data-sw-slider]').forEach(function (slider) {
      if (!slider.closest('[data-sw-tone-host]')) watch(slider.parentElement || slider);
    });
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start);
  else start();
})();
