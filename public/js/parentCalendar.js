// The family calendar: every child's activities, school events and homework closing dates.
(function () {
  'use strict';

  function esc(value) {
    return String(value === null || value === undefined ? '' : value).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function pad(n) { return n < 10 ? '0' + n : String(n); }
  function key(d) { return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()); }
  function clock(value) { return value ? new Date('2000-01-01T' + value).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }) : ''; }
  var LABEL = { activity: 'Activity', event: 'School event', work: 'Closes' };

  function mount(root) {
    if (root.dataset.bound) return;
    root.dataset.bound = '1';
    var children = [];
    try { children = JSON.parse(root.getAttribute('data-children') || '[]'); } catch (_) { children = []; }
    var startAt = root.getAttribute('data-date');
    var selected = startAt || key(new Date());
    var first = new Date(selected + 'T12:00:00');
    var month = new Date(first.getFullYear(), first.getMonth(), 1);
    var child = Number(root.getAttribute('data-child')) || 0;
    var items = [];
    var asked = 0;

    root.innerHTML = '<div class="pc-bar"><button type="button" class="pc-nav" data-prev aria-label="Previous month">‹</button><h2 data-month></h2><button type="button" class="pc-nav" data-next aria-label="Next month">›</button></div>'
      + (children.length > 1 ? '<div class="pc-chips" role="group" aria-label="Show a child"><button type="button" data-child-chip="0">All</button>' + children.map(function (c) { return '<button type="button" data-child-chip="' + c.id + '">' + esc(c.name) + '</button>'; }).join('') + '</div>' : '')
      + '<div class="pc-grid" data-grid></div><div class="pc-day" data-day></div>';

    function shown() {
      return items.filter(function (item) { return !child || item.studentIds.indexOf(child) >= 0; });
    }
    function onDay(day) {
      return shown().filter(function (item) { return item.date <= day && (item.endDate || item.date) >= day; });
    }
    function nameFor(item) {
      if (children.length < 2 || item.studentIds.length === children.length) return '';
      return item.studentIds.map(function (id) { var found = children.filter(function (c) { return c.id === id; })[0]; return found ? found.name : ''; }).filter(Boolean).join(', ');
    }
    function renderChips() {
      root.querySelectorAll('[data-child-chip]').forEach(function (chip) {
        var on = Number(chip.getAttribute('data-child-chip')) === child;
        chip.classList.toggle('is-on', on);
        chip.setAttribute('aria-pressed', String(on));
      });
    }
    function renderGrid() {
      root.querySelector('[data-month]').textContent = month.toLocaleDateString(undefined, { month: 'long', year: 'numeric' });
      var html = ['S', 'M', 'T', 'W', 'T', 'F', 'S'].map(function (d) { return '<span class="pc-dow">' + d + '</span>'; }).join('');
      var cursor = new Date(month.getFullYear(), month.getMonth(), 1 - month.getDay());
      var today = key(new Date());
      for (var i = 0; i < 42; i += 1) {
        var day = key(cursor);
        var count = onDay(day);
        var kinds = {};
        count.forEach(function (item) { kinds[item.kind] = true; });
        var other = cursor.getMonth() !== month.getMonth();
        if (other && i >= 35) break;
        html += '<button type="button" class="pc-cell' + (other ? ' is-other' : '') + (day === today ? ' is-today' : '') + (day === selected ? ' is-on' : '') + '" data-pick-day="' + day + '" aria-label="' + esc(cursor.toLocaleDateString(undefined, { month: 'long', day: 'numeric' })) + (count.length ? ', ' + count.length + ' items' : '') + '"><span>' + cursor.getDate() + '</span><i>' + Object.keys(kinds).map(function (k) { return '<b class="pc-dot pc-dot--' + k + '"></b>'; }).join('') + '</i></button>';
        cursor.setDate(cursor.getDate() + 1);
      }
      root.querySelector('[data-grid]').innerHTML = html;
    }
    function renderDay() {
      var list = onDay(selected);
      var title = new Date(selected + 'T12:00:00').toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' });
      root.querySelector('[data-day]').innerHTML = '<h3>' + esc(title) + '</h3>' + (list.length ? list.map(function (item) {
        var meta = [LABEL[item.kind], item.startTime ? clock(item.startTime) + (item.endTime ? ' – ' + clock(item.endTime) : '') : '', item.location, nameFor(item)].filter(Boolean).join(' · ');
        var body = '<i class="pc-dot pc-dot--' + esc(item.kind) + '"></i><div><strong>' + esc(item.title) + '</strong><small>' + esc(meta) + '</small>' + (item.details ? '<p>' + esc(item.details) + '</p>' : '') + '</div>';
        return item.link ? '<a class="pc-item" href="' + esc(item.link) + '">' + body + '</a>' : '<div class="pc-item">' + body + '</div>';
      }).join('') : '<p class="ph-empty">Nothing on this day.</p>');
    }
    function renderAll() { renderChips(); renderGrid(); renderDay(); }
    function load() {
      var from = new Date(month.getFullYear(), month.getMonth(), -6);
      var to = new Date(month.getFullYear(), month.getMonth() + 1, 7);
      var ticket = ++asked;
      return fetch('/guardian/calendar/feed?from=' + key(from) + '&to=' + key(to), { credentials: 'same-origin', headers: { Accept: 'application/json' } })
        .then(function (res) { return res.ok ? res.json() : null; })
        .then(function (result) {
          if (ticket !== asked) return;
          items = result && result.success ? result.items : [];
          renderAll();
        })
        .catch(function () { if (ticket === asked) { items = []; renderAll(); } });
    }
    root.addEventListener('click', function (event) {
      var dayButton = event.target.closest('[data-pick-day]');
      if (dayButton) {
        selected = dayButton.getAttribute('data-pick-day');
        renderGrid();
        renderDay();
        return;
      }
      if (event.target.closest('[data-prev]') || event.target.closest('[data-next]')) {
        month = new Date(month.getFullYear(), month.getMonth() + (event.target.closest('[data-next]') ? 1 : -1), 1);
        selected = key(month);
        renderAll();
        load();
        return;
      }
      var chip = event.target.closest('[data-child-chip]');
      if (chip) {
        child = Number(chip.getAttribute('data-child-chip'));
        renderAll();
      }
    });
    renderAll();
    load();
  }

  function begin() { var root = document.getElementById('parentCalendar'); if (root) mount(root); }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', begin);
  else begin();
  window.addEventListener('spa:pageLoaded', begin);
})();
