// managira.com homepage: glass header on scroll, menus, phone menu and gentle reveals.
(function () {
  'use strict';
  var root = document.documentElement;
  root.classList.add('lp-js');

  function ready(fn) { if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', fn); else fn(); }

  ready(function () {
    var header = document.querySelector('[data-lp-header]');
    if (!header) return;

    // The header turns to glass once the page moves.
    var onScroll = function () { header.classList.toggle('is-scrolled', window.scrollY > 8); };
    onScroll();
    window.addEventListener('scroll', onScroll, { passive: true });

    // Desktop menus: open on hover or click, close on Escape or a click elsewhere.
    var items = Array.prototype.slice.call(header.querySelectorAll('.lp-nav__item.has-menu'));
    var hoverable = window.matchMedia('(hover: hover)').matches;
    function close(except) {
      items.forEach(function (item) {
        if (item === except) return;
        item.classList.remove('is-open');
        var trigger = item.querySelector('[data-menu-trigger]');
        if (trigger) trigger.setAttribute('aria-expanded', 'false');
      });
    }
    function open(item) {
      close(item);
      item.classList.add('is-open');
      item.querySelector('[data-menu-trigger]').setAttribute('aria-expanded', 'true');
    }
    items.forEach(function (item) {
      var trigger = item.querySelector('[data-menu-trigger]');
      var timer = null;
      trigger.addEventListener('click', function (event) {
        event.stopPropagation();
        if (item.classList.contains('is-open')) close(); else open(item);
      });
      if (hoverable) {
        item.addEventListener('mouseenter', function () { clearTimeout(timer); open(item); });
        item.addEventListener('mouseleave', function () { timer = setTimeout(function () { item.classList.remove('is-open'); trigger.setAttribute('aria-expanded', 'false'); }, 140); });
      }
    });
    document.addEventListener('click', function (event) { if (!header.contains(event.target)) close(); });
    document.addEventListener('keydown', function (event) {
      if (event.key !== 'Escape') return;
      close();
      setSheet(false);
    });

    // Phone menu.
    var burger = header.querySelector('[data-burger]');
    var sheet = header.querySelector('[data-sheet]');
    function setSheet(on) {
      if (!burger || !sheet) return;
      burger.setAttribute('aria-expanded', on ? 'true' : 'false');
      burger.setAttribute('aria-label', on ? 'Close menu' : 'Open menu');
      sheet.hidden = !on;
      header.classList.toggle('is-open', on);
      document.body.style.overflow = on ? 'hidden' : '';
    }
    if (burger) burger.addEventListener('click', function () { setSheet(burger.getAttribute('aria-expanded') !== 'true'); });
    if (sheet) sheet.addEventListener('click', function (event) { if (event.target.closest('a')) setSheet(false); });
    window.addEventListener('resize', function () { if (window.innerWidth > 1180) setSheet(false); });

    // Sections ease in as they arrive; everything shows at once without motion support.
    var parts = document.querySelectorAll('[data-reveal]');
    var show = function (el) { el.classList.add('is-in'); };
    if (!('IntersectionObserver' in window)) { Array.prototype.forEach.call(parts, show); return; }
    var seen = new IntersectionObserver(function (entries) {
      entries.forEach(function (entry) {
        if (!entry.isIntersecting) return;
        show(entry.target);
        seen.unobserve(entry.target);
      });
    }, { rootMargin: '0px 0px -8% 0px', threshold: 0.08 });
    Array.prototype.forEach.call(parts, function (el) { seen.observe(el); });
  });
})();
