// Movement for the school website's 3D designs: Glide, Prism and Panorama
// (views/partials/website/site.ejs, public/css/school-website-3d.css).
// The page is complete without this file; it only adds movement:
//   - parts float in as they arrive (REVEAL, the same list as the stylesheet);
//   - parts marked data-mp get --p, from 0 to 1 as they scroll through
//     (data-mp="pin": while a pinned scene is held on screen);
//   - Panorama's gallery sweeps sideways in 3D; figures count up; Prism's
//     photo stack leans toward the pointer; Panorama's chapter dots follow.
// Only transform and opacity change, at most once per frame, and only for parts
// near the screen. Nothing moves for visitors who ask for less motion.
(function () {
  'use strict';
  var site = document.querySelector('.sw-site[data-sw-motion]');
  if (!site) return;
  window.swMotionReady = true;

  var lessMotion = window.matchMedia ? window.matchMedia('(prefers-reduced-motion: reduce)') : null;
  if (lessMotion && lessMotion.matches) {
    site.classList.remove('sw-moving');
    site.classList.add('sw-still');
    return;
  }
  site.classList.add('sw-moving');

  var raf = window.requestAnimationFrame ? window.requestAnimationFrame.bind(window) : function (fn) { return setTimeout(fn, 16); };
  var each = function (list, fn) { Array.prototype.forEach.call(list, fn); };
  var clamp = function (v, lo, hi) { return v < lo ? lo : v > hi ? hi : v; };
  var hasIO = 'IntersectionObserver' in window;
  var vh = window.innerHeight;
  var top = 0; // the site header and the design's menu, both held at the top

  // Pinned scenes and the menu sit under the site header (fixed) and this design's menu.
  function measure() {
    vh = window.innerHeight;
    var header = document.getElementById('top-header');
    var nav = site.querySelector('.sw-mo-nav');
    var head = header && getComputedStyle(header).position === 'fixed' ? Math.round(header.getBoundingClientRect().height) : 0;
    top = head + (nav ? Math.round(nav.getBoundingClientRect().height) : 0);
    site.style.setProperty('--sw-head', head + 'px');
    site.style.setProperty('--sw-top', top + 'px');
  }
  measure();

  // ---------- 1. Parts float in as they arrive ----------
  var REVEAL = '[data-m] .sw-section > .sw-head, '
    + '[data-m] .sw-section > :not(.sw-head):not(.sw-anchor):not(.sw-visually-hidden) > :not([hidden]), '
    + '[data-m-items] > *, [data-m="panel"]';
  var parts = site.querySelectorAll(REVEAL);
  each(parts, function (el) {
    var i = 0;
    for (var sib = el.previousElementSibling; sib; sib = sib.previousElementSibling) i += 1;
    if (i) el.style.setProperty('--i', String(i % 4));
  });
  if (hasIO) {
    var arrive = new IntersectionObserver(function (entries) {
      entries.forEach(function (entry) {
        if (!entry.isIntersecting) return;
        entry.target.classList.add('is-in');
        arrive.unobserve(entry.target);
      });
    }, { rootMargin: '0px', threshold: 0 });
    each(parts, function (el) { arrive.observe(el); });
  } else {
    each(parts, function (el) { el.classList.add('is-in'); });
  }

  // ---------- 2. Scroll-linked parts: --p from 0 to 1 ----------
  var linked = Array.prototype.slice.call(site.querySelectorAll('[data-mp]'));
  var near = new Set(linked);
  if (hasIO) {
    near = new Set();
    var nearby = new IntersectionObserver(function (entries) {
      entries.forEach(function (entry) { if (entry.isIntersecting) near.add(entry.target); else near.delete(entry.target); });
      queue();
    }, { rootMargin: '35% 0px 35% 0px' });
    linked.forEach(function (el) { nearby.observe(el); });
  }
  function progressOf(el, rect) {
    if (el.getAttribute('data-mp') === 'pin') {
      var held = rect.height - (vh - top);
      return held > 0 ? (top - rect.top) / held : (rect.top <= top ? 1 : 0);
    }
    var from = parseFloat(el.getAttribute('data-mp-from') || '1') * vh;
    var to = parseFloat(el.getAttribute('data-mp-to') || '0') * vh;
    return (from - rect.top) / ((from - to) || 1);
  }

  var bar = site.querySelector('.sw-mo-progress i');
  var dotsNav = site.querySelector('.sw-pa-dots');
  var orbit = site.querySelector('[data-sw-orbit]'); // Orbit's emblem turns as the page scrolls
  var opening = site.querySelector('.sw-pa-hero');
  var queued = false;
  function queue() { if (!queued) { queued = true; raf(frame); } }
  function frame() {
    queued = false;
    // Read every position first, then write, so the page is laid out once per frame.
    var changes = [];
    near.forEach(function (el) {
      var p = clamp(progressOf(el, el.getBoundingClientRect()), 0, 1);
      if (el._swP !== p) changes.push([el, p]);
    });
    var openingLeft = dotsNav && opening ? opening.getBoundingClientRect().bottom < vh * 0.6 : false;
    var max = document.documentElement.scrollHeight - vh;
    var read = max > 0 ? clamp((window.pageYOffset || document.documentElement.scrollTop) / max, 0, 1) : 0;
    changes.forEach(function (change) {
      var el = change[0], p = change[1];
      el._swP = p;
      el.style.setProperty('--p', p.toFixed(4));
      if (el._swOnP) el._swOnP(p);
    });
    if (bar) bar.style.transform = 'scaleX(' + read.toFixed(4) + ')';
    if (orbit) orbit.style.setProperty('--sp', read.toFixed(4));
    if (dotsNav) dotsNav.classList.toggle('is-shown', openingLeft);
  }
  window.addEventListener('scroll', queue, { passive: true });

  // ---------- 3. Panorama: the gallery sweeps sideways in 3D ----------
  var flows = [];
  each(site.querySelectorAll('[data-sw-flow]'), function (flow) {
    var stage = flow.querySelector('.sw-pa-flow__stage');
    var track = flow.querySelector('.sw-gallery');
    if (!stage || !track) return;
    var cards = Array.prototype.filter.call(track.children, function (card) { return !card.hidden; });
    if (!cards.length) return;
    var state = { pinned: false, travel: 0, shift: 0, base: 0, centers: [], width: 1 };
    function place(p) {
      if (state.pinned) {
        state.shift = -state.travel * (p == null ? flow._swP || 0 : p);
        track.style.transform = 'translate3d(' + state.shift.toFixed(1) + 'px, 0, 0)';
      }
      var offset = state.pinned ? state.shift : -track.scrollLeft;
      var mid = stage.clientWidth / 2;
      cards.forEach(function (card, i) {
        var d = clamp((state.base + state.centers[i] + offset - mid) / state.width, -2.5, 2.5);
        card.style.setProperty('--d', d.toFixed(3));
        card.style.setProperty('--ad', Math.abs(d).toFixed(3));
      });
    }
    function layout() {
      // Pinned on wider screens; swiped on phones.
      state.pinned = window.innerWidth >= 760;
      flow.classList.toggle('is-pinned', state.pinned);
      track.style.transform = '';
      flow.style.height = '';
      var stageRect = stage.getBoundingClientRect();
      var trackRect = track.getBoundingClientRect();
      state.base = trackRect.left - stageRect.left;
      state.centers = cards.map(function (card) { return card.offsetLeft + card.offsetWidth / 2; });
      state.width = cards[0].offsetWidth || 1;
      if (state.pinned) {
        // Move until the last photo reaches the middle of the screen.
        state.travel = Math.max(0, state.base + state.centers[state.centers.length - 1] - stage.clientWidth / 2);
        flow.style.height = Math.round(stage.offsetHeight + state.travel) + 'px';
      } else {
        state.travel = 0;
      }
      place();
    }
    flow._swOnP = place;
    track.addEventListener('scroll', function () { if (!state.pinned) raf(function () { place(); }); }, { passive: true });
    flows.push(layout);
    layout();
  });

  // ---------- 3b. Prism: neighbouring columns of the photo wall drift apart ----------
  var walls = [];
  each(site.querySelectorAll('.sw-pr-wall .sw-gallery'), function (wall) {
    function columns() {
      var lefts = [];
      var cards = Array.prototype.filter.call(wall.children, function (card) { return !card.hidden; });
      cards.forEach(function (card) { var x = card.offsetLeft; if (lefts.indexOf(x) === -1) lefts.push(x); });
      lefts.sort(function (a, b) { return a - b; });
      cards.forEach(function (card) {
        var col = lefts.indexOf(card.offsetLeft);
        card.style.setProperty('--shift', lefts.length < 2 ? '0' : (col % 2 ? '-1' : '1'));
      });
    }
    walls.push(columns);
    columns();
  });

  // ---------- 4. Figures count up when they arrive ----------
  function countUp(el) {
    var text = el.textContent.trim();
    var m = text.match(/^([$€£¥₦₵~]?)(\d{1,3}(?:,\d{3})+|\d+)(\.\d+)?([+%kKmM]{0,2}\+?)$/);
    if (!m) return;
    var whole = Number(m[2].replace(/,/g, ''));
    var places = m[3] ? m[3].length - 1 : 0;
    var target = whole + (m[3] ? Number(m[3]) : 0);
    if (!isFinite(target) || target <= 0 || target > 1e7) return;
    var commas = m[2].indexOf(',') > -1;
    var show = function (v) {
      var s = places ? v.toFixed(places) : String(Math.round(v));
      if (commas) s = s.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
      return m[1] + s + m[4];
    };
    el.setAttribute('aria-label', text);
    var start = null;
    var step = function (now) {
      if (start === null) start = now;
      var k = Math.min(1, (now - start) / 1400);
      el.textContent = k < 1 ? show(target * (1 - Math.pow(1 - k, 3))) : text;
      if (k < 1) raf(step);
    };
    el.textContent = show(0);
    raf(step);
  }
  var figures = site.querySelectorAll('.sw-fact__value');
  if (hasIO && figures.length) {
    var counted = new IntersectionObserver(function (entries) {
      entries.forEach(function (entry) {
        if (!entry.isIntersecting) return;
        counted.unobserve(entry.target);
        countUp(entry.target);
      });
    }, { rootMargin: '0px 0px -10% 0px' });
    each(figures, function (el) { counted.observe(el); });
  }

  // ---------- 5. Prism: the photo stack leans toward the pointer ----------
  if (window.matchMedia && window.matchMedia('(hover: hover) and (pointer: fine)').matches) {
    each(site.querySelectorAll('[data-m-tilt]'), function (el) {
      var next = null;
      el.addEventListener('pointermove', function (event) {
        var r = el.getBoundingClientRect();
        var first = next === null;
        next = [clamp(((event.clientX - r.left) / r.width) * 2 - 1, -1, 1), clamp(((event.clientY - r.top) / r.height) * 2 - 1, -1, 1)];
        if (first) raf(function () {
          el.style.setProperty('--mx', next[0].toFixed(3));
          el.style.setProperty('--my', next[1].toFixed(3));
          next = null;
        });
      });
      el.addEventListener('pointerleave', function () {
        next = null;
        el.style.setProperty('--mx', '0');
        el.style.setProperty('--my', '0');
      });
    });
  }

  // ---------- 6. Panorama: the chapter dots follow the page ----------
  var dots = site.querySelectorAll('[data-sw-dot]');
  if (hasIO && dots.length) {
    var byKey = {};
    each(dots, function (dot) { byKey[dot.getAttribute('data-sw-dot')] = dot; });
    var chapter = new IntersectionObserver(function (entries) {
      entries.forEach(function (entry) {
        if (!entry.isIntersecting) return;
        var dot = byKey[entry.target.getAttribute('data-sw-block')];
        if (!dot) return;
        each(dots, function (d) {
          var on = d === dot;
          d.classList.toggle('is-active', on);
          if (on) d.setAttribute('aria-current', 'true'); else d.removeAttribute('aria-current');
        });
      });
    }, { rootMargin: '-45% 0px -50% 0px' });
    each(site.querySelectorAll('[data-sw-block]'), function (section) { chapter.observe(section); });
  }

  // ---------- Size changes ----------
  var resizing = null;
  function relayout() {
    resizing = null;
    measure();
    flows.forEach(function (layout) { layout(); });
    walls.forEach(function (columns) { columns(); });
    linked.forEach(function (el) { el._swP = null; });
    queue();
  }
  window.addEventListener('resize', function () { if (!resizing) resizing = setTimeout(relayout, 120); });
  window.addEventListener('load', relayout);
  // The header settles after fonts and images load.
  if ('ResizeObserver' in window) {
    var header = document.getElementById('top-header');
    var nav = site.querySelector('.sw-mo-nav');
    var watch = new ResizeObserver(function () { if (!resizing) resizing = setTimeout(relayout, 60); });
    if (header) watch.observe(header);
    if (nav) watch.observe(nav);
  }
  // Someone who turns on "reduce motion" while the page is open: stop at once.
  if (lessMotion && lessMotion.addEventListener) {
    lessMotion.addEventListener('change', function (event) { if (event.matches) window.location.reload(); });
  }
  queue();
})();
