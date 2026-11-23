// A page bar for long lists: "Rows per page [20 v]   21–40 of 1,801   < >". One component for every list (Parents &
// guardians, staff, Assessments, Graduate & Withdraw, Class settings, Home's classes, Docs & Sheets), so they all
// look and work the same. The person's rows-per-page choice is remembered on this device.
//   var pager = ManagiraPager.create({ mount: el, key: 'guardians', total: 1801, onChange: function (s) { ...draw s.page, s.size... } });
//   pager.setTotal(n)  — after a filter changes the list (goes back to the first page)
//   pager.state        — { page, size, from, to, total }
//   pager.show(total, page) — redraw for a list the caller pages itself (no onChange)
(function () {
  'use strict';
  var SIZES = [10, 20, 50, 100, 200];

  function storageKey(key) { return 'managira-pager:' + key; }
  function savedSize(key, fallback) {
    try { var v = Number(localStorage.getItem(storageKey(key))); return SIZES.indexOf(v) >= 0 ? v : fallback; } catch (e) { return fallback; }
  }
  function saveSize(key, size) { try { localStorage.setItem(storageKey(key), String(size)); } catch (e) { /* not remembered */ } }
  function n(v) { return Number(v).toLocaleString('en-US'); }
  function el(tag, cls, text) { var x = document.createElement(tag); if (cls) x.className = cls; if (text != null) x.textContent = text; return x; }
  var chevron = function (dir) { return '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="' + (dir === 'left' ? 'm15 6-6 6 6 6' : 'm9 6 6 6-6 6') + '"/></svg>'; };

  function create(options) {
    var host = options.mount;
    if (!host) return null;
    var state = { page: 1, size: savedSize(options.key, options.defaultSize || 20), total: Number(options.total) || 0, from: 0, to: 0 };
    host.textContent = '';
    host.classList.add('mgr-pager');
    host.setAttribute('role', 'navigation');
    host.setAttribute('aria-label', options.label || 'Pages');

    var sizeWrap = el('label', 'mgr-pager__size');
    sizeWrap.appendChild(el('span', null, options.sizeLabel || 'Rows per page'));
    var select = el('select');
    select.setAttribute('aria-label', 'Rows per page');
    SIZES.forEach(function (s) { var o = el('option', null, String(s)); o.value = String(s); select.appendChild(o); });
    sizeWrap.appendChild(select);
    var range = el('span', 'mgr-pager__range'); range.setAttribute('aria-live', 'polite');
    var buttons = el('span', 'mgr-pager__buttons');
    var prev = el('button', 'mgr-pager__btn'); prev.type = 'button'; prev.innerHTML = chevron('left'); prev.setAttribute('aria-label', 'Previous page'); prev.title = 'Previous page';
    var next = el('button', 'mgr-pager__btn'); next.type = 'button'; next.innerHTML = chevron('right'); next.setAttribute('aria-label', 'Next page'); next.title = 'Next page';
    var which = el('span', 'mgr-pager__which');
    buttons.appendChild(prev); buttons.appendChild(which); buttons.appendChild(next);
    host.appendChild(sizeWrap); host.appendChild(range); host.appendChild(buttons);

    function pages() { return Math.max(1, Math.ceil(state.total / state.size)); }
    function paint() {
      select.value = String(state.size);
      if (state.page > pages()) state.page = pages();
      state.from = state.total ? (state.page - 1) * state.size + 1 : 0;
      state.to = Math.min(state.total, state.page * state.size);
      range.textContent = state.total ? n(state.from) + '–' + n(state.to) + ' of ' + n(state.total) : '0 of 0';
      which.textContent = pages() > 1 ? 'Page ' + state.page + ' of ' + n(pages()) : '';
      prev.disabled = state.page <= 1;
      next.disabled = state.page >= pages();
      // Nothing to page through: the bar stays (rows per page is still a choice) but the arrows rest.
      host.classList.toggle('is-single', pages() <= 1);
      host.hidden = !state.total || (state.total <= SIZES[0] && options.hideWhenSmall !== false);
    }
    function emit() { paint(); if (typeof options.onChange === 'function') options.onChange({ page: state.page, size: state.size, from: state.from, to: state.to, total: state.total }); }

    select.addEventListener('change', function () { state.size = Number(select.value); state.page = 1; saveSize(options.key, state.size); emit(); });
    prev.addEventListener('click', function () { if (state.page > 1) { state.page -= 1; emit(); } });
    next.addEventListener('click', function () { if (state.page < pages()) { state.page += 1; emit(); } });

    var api = {
      state: state,
      setTotal: function (total, keepPage) { state.total = Number(total) || 0; if (!keepPage) state.page = 1; emit(); },
      goTo: function (page) { state.page = Math.max(1, Math.min(pages(), page)); emit(); },
      refresh: emit,
      // Draw the bar for a list the caller already paged, without calling onChange back.
      show: function (total, page) { state.total = Number(total) || 0; state.page = Math.max(1, Number(page) || 1); paint(); },
    };
    // The first draw is the caller's to ask for (api.refresh()) once its rows exist.
    paint();
    return api;
  }

  window.ManagiraPager = { create: create, SIZES: SIZES, savedSize: savedSize };
})();
