// The calendar for parents and students: activities, school events, classes and what's closing,
// and one tap to put it in their own Google, Outlook or Apple calendar.
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
  var LABEL = { activity: 'Activity', event: 'School event', work: 'Closes', 'class': 'Class' };

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
    var base = root.getAttribute('data-base') || '/guardian/calendar';
    var links = null;
    var retried = false;

    root.innerHTML = '<div class="pc-bar"><button type="button" class="pc-nav" data-prev aria-label="Previous month">‹</button><h2 data-month></h2><button type="button" class="pc-nav" data-next aria-label="Next month">›</button></div>'
      + (children.length > 1 ? '<div class="pc-chips" role="group" aria-label="Show a child"><button type="button" data-child-chip="0">All</button>' + children.map(function (c) { return '<button type="button" data-child-chip="' + c.id + '">' + esc(c.name) + '</button>'; }).join('') + '</div>' : '')
      + '<div class="pc-grid" data-grid></div><div class="pc-day" data-day></div>'
      + '<button type="button" class="pc-add" data-sync-open>Add to my calendar</button>'
      + '<div class="pc-sheet" data-sync hidden role="dialog" aria-modal="true" aria-label="Add to my calendar"><div class="pc-sheet__box">'
      + '<div class="pc-sheet__head"><h2>Add to my calendar</h2><button type="button" class="pc-sheet__x" data-sync-close aria-label="Close">×</button></div>'
      + '<p class="pc-sheet__note">School events and activities appear in your own calendar and stay up to date. Nothing can be changed from there.</p>'
      + '<div class="pc-sheet__apps" data-sync-apps></div>'
      + '<button type="button" class="pc-sheet__link" data-sync-copy>Copy private link</button>'
      + '<p class="pc-sheet__msg" data-sync-msg role="status"></p>'
      + '<button type="button" class="pc-sheet__reset" data-sync-reset>Make a new link</button>'
      + '<p class="pc-sheet__fine">Anyone with this link can see this calendar. Make a new one if it\u2019s ever shared by mistake.</p>'
      + '</div></div>';

    function shown() {
      return items.filter(function (item) { return !child || item.studentIds.indexOf(child) >= 0; });
    }
    function onDay(day) {
      return shown().filter(function (item) { return item.date <= day && (item.endDate || item.date) >= day; })
        .sort(function (a, b) { return String(a.startTime || '').localeCompare(String(b.startTime || '')); });
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
        // Classes are in the day's list; marking every school day would hide what matters.
        count.forEach(function (item) { if (item.kind !== 'class') kinds[item.kind] = true; });
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
      return fetch(base + '/feed?from=' + key(from) + '&to=' + key(to), { credentials: 'same-origin', headers: { Accept: 'application/json' } })
        .then(function (res) {
          if (!res.ok) throw new Error('feed');
          return res.json();
        })
        .then(function (result) {
          if (ticket !== asked) return;
          retried = false;
          items = result && result.success ? result.items : [];
          renderAll();
        })
        .catch(function () {
          // A brief failure gets one more try before the calendar shows as empty.
          if (ticket !== asked) return;
          if (!retried) { retried = true; setTimeout(load, 800); return; }
          items = [];
          renderAll();
        });
    }
    function renderLinks() {
      var apps = [['google', 'Google Calendar'], ['outlook', 'Outlook'], ['outlookPersonal', 'Outlook.com'], ['apple', 'Apple Calendar']];
      root.querySelector('[data-sync-apps]').innerHTML = apps.map(function (app) {
        return '<a class="pc-sheet__app" data-no-spa target="_blank" rel="noopener noreferrer" href="' + esc(links[app[0]]) + '">' + esc(app[1]) + '</a>';
      }).join('');
    }
    function say(text) { root.querySelector('[data-sync-msg]').textContent = text; }
    function openSheet() {
      root.querySelector('[data-sync]').hidden = false;
      say('');
      if (links) { renderLinks(); return; }
      say('One moment…');
      fetch(base + '/sync', { credentials: 'same-origin', headers: { Accept: 'application/json' } })
        .then(function (res) { return res.json(); })
        .then(function (result) {
          if (!result.success) throw new Error('no');
          links = result.links;
          say('');
          renderLinks();
        })
        .catch(function () { say('That didn\u2019t work. Try again.'); });
    }
    root.addEventListener('click', function (event) {
      if (event.target.closest('[data-sync-open]')) { openSheet(); return; }
      if (event.target.closest('[data-sync-close]') || event.target.matches('[data-sync]')) { root.querySelector('[data-sync]').hidden = true; return; }
      if (event.target.closest('[data-sync-copy]')) {
        if (!links) return;
        var copied = navigator.clipboard ? navigator.clipboard.writeText(links.link) : Promise.reject(new Error('no'));
        copied.then(function () { say('Link copied.'); }).catch(function () { say(links.link); });
        return;
      }
      if (event.target.closest('[data-sync-reset]')) {
        if (!window.confirm('Make a new link? Calendars using the old link stop updating until you add the new one.')) return;
        fetch(base + '/sync/reset', { method: 'POST', credentials: 'same-origin', headers: { Accept: 'application/json', 'X-Requested-With': 'XMLHttpRequest' } })
          .then(function (res) { return res.json(); })
          .then(function (result) {
            if (!result.success) throw new Error('no');
            links = result.links;
            renderLinks();
            say('New link made.');
          })
          .catch(function () { say('That didn\u2019t work. Try again.'); });
        return;
      }
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
