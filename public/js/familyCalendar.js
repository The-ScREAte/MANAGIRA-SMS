// The calendar for parents and students: the school calendar's look (FullCalendar, the same
// sidebar and colors), showing classes, activities, school events and what's due. Sync is
// Google Calendar and Outlook. Everything typed by people goes in as text.
(function () {
  'use strict';

  var COLOR = { event: '#0f766e', activity: '#12883f', 'class': '#b45309', work: '#d92d20' };
  var LABEL = { event: 'School event', activity: 'Activity', 'class': 'Class', work: 'Due' };
  var APPS = [
    { key: 'google', name: 'Google Calendar', logo: '<img src="https://www.gstatic.com/images/branding/product/1x/calendar_2020q4_48dp.png" alt="" width="28" height="28">' },
    { key: 'outlook', name: 'Outlook', logo: '<svg width="28" height="28" viewBox="0 0 24 24" aria-hidden="true"><rect x="2" y="4" width="13" height="16" rx="2" fill="#0078d4"/><rect x="9" y="6" width="13" height="12" rx="2" fill="#28a8ea"/><circle cx="8.5" cy="12" r="3.2" fill="none" stroke="#fff" stroke-width="1.8"/></svg>' },
  ];
  function esc(value) {
    return String(value === null || value === undefined ? '' : value).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function pad(n) { return n < 10 ? '0' + n : String(n); }
  function key(d) { return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()); }
  function clock(value) { return value ? new Date('2000-01-01T' + value).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }) : ''; }

  function mount(root) {
    if (root.dataset.ready === '1' || !window.FullCalendar) return;
    root.dataset.ready = '1';
    var base = root.getAttribute('data-base') || '/guardian/calendar';
    var children = [];
    try { children = JSON.parse(root.getAttribute('data-children') || '[]'); } catch (_) { children = []; }
    var child = Number(root.getAttribute('data-child')) || 0;
    var hidden = {};
    var all = [];
    var calendar = null;
    var calendarEl = document.getElementById('calendar');

    function visible() {
      return all.filter(function (item) { return !hidden[item.kind] && (!child || (item.studentIds || []).indexOf(child) >= 0); });
    }
    function toEvent(item) {
      var allDay = !item.startTime;
      var start = allDay ? item.date : item.date + 'T' + item.startTime;
      var end;
      if (allDay) {
        if (item.endDate && item.endDate > item.date) { var d = new Date(item.endDate + 'T12:00:00'); d.setDate(d.getDate() + 1); end = key(d); }
      } else if (item.endTime) {
        end = (item.endDate || item.date) + 'T' + item.endTime;
      }
      return { id: String(item.id), title: item.title, start: start, end: end, allDay: allDay, classNames: ['cal-ev'], extendedProps: { item: item, layer: item.kind } };
    }
    function nameFor(item) {
      if (children.length < 2 || (item.studentIds || []).length === children.length) return '';
      return (item.studentIds || []).map(function (id) { var f = children.filter(function (c) { return c.id === id; })[0]; return f ? f.name : ''; }).filter(Boolean).join(', ');
    }
    function metaOf(item) {
      return [LABEL[item.kind], item.startTime ? clock(item.startTime) + (item.endTime ? ' – ' + clock(item.endTime) : '') : '', item.location, nameFor(item)].filter(Boolean).join(' · ');
    }

    function renderSide() {
      var counts = {};
      all.filter(function (item) { return !child || (item.studentIds || []).indexOf(child) >= 0; }).forEach(function (item) { counts[item.kind] = (counts[item.kind] || 0) + 1; });
      root.querySelectorAll('[data-cal-count]').forEach(function (n) { n.textContent = counts[n.getAttribute('data-cal-count')] || ''; });
      var today = key(new Date());
      var next = visible().filter(function (item) { return (item.endDate || item.date) >= today; })
        .sort(function (a, b) { return (a.date + (a.startTime || '')).localeCompare(b.date + (b.startTime || '')); }).slice(0, 6);
      var list = root.querySelector('[data-cal-upcoming]');
      list.innerHTML = next.length ? next.map(function (item, i) {
        var day = new Date(item.date + 'T12:00:00').toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' });
        return '<li><button type="button" data-up="' + i + '"><span class="cal-up__dot" style="background:' + COLOR[item.kind] + '"></span><span class="cal-up__title">' + esc(item.title) + '</span><span class="cal-up__when">' + esc(day + (item.startTime ? ' · ' + clock(item.startTime) : '')) + '</span></button></li>';
      }).join('') : '<li class="cal-empty">Nothing coming up.</li>';
      list._items = next;
    }
    function renderChildren() {
      var holder = root.querySelector('[data-cal-children]');
      if (!holder) return;
      var rows = [{ id: 0, name: 'All children' }].concat(children);
      holder.innerHTML = rows.map(function (c) {
        return '<label class="cal-layer" style="--dot:#475569"><input type="radio" name="calChild" value="' + c.id + '"' + (c.id === child ? ' checked' : '') + '><span class="cal-layer__box" style="border-radius:50%"></span>' + esc(c.name) + '</label>';
      }).join('');
    }

    function fitHeight() {
      if (window.matchMedia('(max-width: 640px)').matches) return 'auto';
      var probe = document.createElement('div');
      probe.style.cssText = 'position:absolute;top:0;left:0;width:1px;height:100px;visibility:hidden';
      document.body.appendChild(probe);
      var scale = (probe.getBoundingClientRect().height / 100) || 1;
      probe.remove();
      var top = calendarEl.getBoundingClientRect().top + window.scrollY;
      return Math.max(480, Math.floor((window.innerHeight - top - 18) / scale));
    }

    // Everything for the range the calendar asks for; kept, so paging back is instant.
    var kept = {};
    function load(start, end) {
      var from = start.slice(0, 10), to = end.slice(0, 10);
      var id = from + '|' + to;
      if (kept[id]) return Promise.resolve(kept[id]);
      return fetch(base + '/feed?from=' + from + '&to=' + to, { credentials: 'same-origin', headers: { Accept: 'application/json' } })
        .then(function (res) { if (!res.ok) throw new Error('feed'); return res.json(); })
        .then(function (json) { kept[id] = json && json.success ? json.items : []; return kept[id]; });
    }

    var isPhone = window.matchMedia('(max-width: 640px)').matches;
    var selectedDay = null;
    var dayBox = root.querySelector('[data-cal-day]');
    calendar = new FullCalendar.Calendar(calendarEl, {
      initialView: 'dayGridMonth',
      initialDate: root.getAttribute('data-initial-date') || undefined,
      headerToolbar: { left: 'prev,next today', center: 'title', right: 'dayGridMonth,timeGridWeek,timeGridDay,listMonth' },
      buttonText: { today: 'Today', month: 'Month', week: 'Week', day: 'Day', list: 'Agenda' },
      height: fitHeight(),
      firstDay: 1,
      nowIndicator: true,
      dayMaxEvents: isPhone ? 2 : true,
      moreLinkContent: function (a) { return isPhone ? '+' + a.num : '+' + a.num + ' more'; },
      dayHeaderFormat: isPhone ? { weekday: 'narrow' } : undefined,
      eventDisplay: 'block',
      navLinks: !isPhone,
      dateClick: function (info) { if (isPhone && info.view.type === 'dayGridMonth') { selectedDay = info.dateStr.slice(0, 10); renderDay(); } },
      datesSet: function (info) {
        hidePeek();
        if (!isPhone) return;
        var tk = key(new Date());
        var cur = key(info.view.currentStart);
        selectedDay = info.view.type === 'dayGridMonth' ? (tk.slice(0, 7) === cur.slice(0, 7) ? tk : cur) : null;
        renderDay();
      },
      slotMinTime: '06:00:00',
      slotMaxTime: '21:00:00',
      scrollTime: '08:00:00',
      slotDuration: '00:30:00',
      eventTimeFormat: { hour: 'numeric', minute: '2-digit', meridiem: 'short' },
      events: function (info, success, failure) {
        load(info.startStr, info.endStr).then(function (items) {
          all = items; renderSide();
          success(visible().map(toEvent));
          setTimeout(renderDay, 0);
        }).catch(function (error) { failure(error); });
      },
      eventDidMount: function (info) {
        var layer = info.event.extendedProps.layer;
        if (COLOR[layer]) info.el.style.setProperty('--c', COLOR[layer]);
        info.el.setAttribute('title', info.event.title);
      },
      eventClick: function (info) { info.jsEvent.preventDefault(); peek(info.event.extendedProps.item, info.el); },
    });
    calendar.render();
    // After drawing, measure where the calendar really ends and size it to end at the bottom of
    // the window (the page zoom makes a first guess land a little off), as the school calendar does.
    function fitToWindow() {
      if (!document.body.contains(calendarEl)) return;
      if (window.matchMedia('(max-width: 640px)').matches) { calendar.setOption('height', 'auto'); return; }
      var current = calendar.getOption('height');
      var box = calendarEl.getBoundingClientRect();
      if (typeof current !== 'number' || !box.height) { calendar.setOption('height', fitHeight()); return; }
      var wanted = window.innerHeight - (box.top + window.scrollY) - 14;
      var next = Math.max(480, Math.round(wanted * (current / box.height)));
      if (Math.abs(next - current) > 2) calendar.setOption('height', next);
    }
    requestAnimationFrame(function () { calendar.setOption('height', fitHeight()); setTimeout(fitToWindow, 60); });
    var resizeTimer = null;
    window.addEventListener('resize', function () { clearTimeout(resizeTimer); resizeTimer = setTimeout(fitToWindow, 150); });

    function redraw() {
      calendar.removeAllEvents();
      calendar.addEventSource(visible().map(toEvent));
      renderSide();
      renderDay();
      markFilter();
    }

    // ---------- details: a card by the event, a sheet at the bottom of a phone ----------
    var sheet = document.querySelector('[data-cal-peek]');
    function hidePeek() { if (sheet) sheet.hidden = true; }
    function peek(item, anchor) {
      var when = new Date(item.date + 'T12:00:00').toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' });
      var rows = ['<div class="ws-peek__row"><i class="fa-regular fa-clock"></i><span>' + esc(when + (item.startTime ? ' · ' + clock(item.startTime) + (item.endTime ? ' – ' + clock(item.endTime) : '') : ' · All day')) + '</span></div>'];
      if (item.location) rows.push('<div class="ws-peek__row"><i class="fa-solid fa-location-dot"></i><span>' + esc(item.location) + '</span></div>');
      var who = nameFor(item);
      if (who) rows.push('<div class="ws-peek__row"><i class="fa-regular fa-user"></i><span>' + esc(who) + '</span></div>');
      if (item.details) rows.push('<div class="ws-peek__row"><i class="fa-solid fa-align-left"></i><span class="ws-peek__details">' + esc(item.details) + '</span></div>');
      sheet.innerHTML = '<div class="ws-peek__top"><span class="ws-peek__bar" style="--c:' + COLOR[item.kind] + '"></span>'
        + '<div style="flex:1;min-width:0;"><div class="ws-peek__kind">' + esc(LABEL[item.kind] || '') + '</div><h3 class="ws-peek__title">' + esc(item.title) + '</h3></div>'
        + '<button type="button" class="ws-close" data-peek-close aria-label="Close">\u00d7</button></div>'
        + '<div class="ws-peek__rows">' + rows.join('') + '</div>'
        + (item.link ? '<div class="ws-peek__actions"><a class="ws-btn ws-btn--primary" data-no-spa href="' + esc(item.link) + '">Open</a></div>' : '');
      sheet.hidden = false;
      if (anchor) {
        var r = anchor.getBoundingClientRect(), w = sheet.offsetWidth, h = sheet.offsetHeight;
        var left = r.right + 10, top = r.top;
        if (left + w > window.innerWidth - 12) left = r.left - w - 10;
        if (left < 12) { left = Math.max(12, Math.min(window.innerWidth - w - 12, r.left)); top = r.bottom + 8; }
        top = Math.min(top, window.innerHeight - h - 12);
        sheet.style.left = Math.round(left) + 'px';
        sheet.style.top = Math.round(Math.max(12, top)) + 'px';
      }
      sheet.querySelector('[data-peek-close]').addEventListener('click', hidePeek);
    }
    document.addEventListener('mousedown', function (e) { if (sheet && !sheet.hidden && !sheet.contains(e.target) && !e.target.closest('.fc-event, [data-up], [data-day-ev]')) hidePeek(); });
    document.addEventListener('keydown', function (e) { if (e.key === 'Escape') hidePeek(); });
    window.addEventListener('scroll', hidePeek, { passive: true });

    // ---------- phone: the tapped day's agenda under the month grid, and the filters button ----------
    function renderDay() {
      if (!isPhone || !dayBox) return;
      document.querySelectorAll('#calendar .cal-day-sel').forEach(function (c) { c.classList.remove('cal-day-sel'); });
      if (!selectedDay) { dayBox.hidden = true; return; }
      var cell = document.querySelector('#calendar .fc-daygrid-day[data-date="' + selectedDay + '"]');
      if (cell) cell.classList.add('cal-day-sel');
      var p = selectedDay.split('-').map(Number);
      var day = new Date(p[0], p[1] - 1, p[2]);
      var evs = visible().filter(function (item) { return item.date <= selectedDay && (item.endDate || item.date) >= selectedDay; })
        .sort(function (a, b) { return (a.startTime || '').localeCompare(b.startTime || ''); });
      dayBox._items = evs;
      var label = day.toLocaleDateString(undefined, { weekday: 'long', month: 'short', day: 'numeric' });
      dayBox.innerHTML = '<div class="cal-day__head"><h2>' + esc(label) + '</h2><span>' + (evs.length ? evs.length + (evs.length === 1 ? ' item' : ' items') : '') + '</span></div>'
        + (evs.length
          ? '<ul class="cal-day__list">' + evs.slice(0, 40).map(function (item, i) {
            return '<li><button type="button" data-day-ev="' + i + '"><span class="cal-up__dot" style="background:' + COLOR[item.kind] + '"></span><span class="cal-day__title">' + esc(item.title) + '</span><span class="cal-day__when">' + (item.startTime ? esc(clock(item.startTime)) : 'All day') + '</span></button></li>';
          }).join('') + '</ul>'
          : '<p class="cal-empty">Nothing on this day.</p>');
      dayBox.hidden = false;
    }
    if (dayBox) dayBox.addEventListener('click', function (event) {
      var button = event.target.closest('[data-day-ev]');
      var item = button && (dayBox._items || [])[Number(button.getAttribute('data-day-ev'))];
      if (item) peek(item, button);
    });
    var filterBtn = root.querySelector('[data-cal-filter]');
    var filterDot = root.querySelector('[data-cal-filter-dot]');
    function markFilter() { if (filterDot) filterDot.hidden = !(child || Object.keys(hidden).some(function (k) { return hidden[k]; })); }
    markFilter();
    if (filterBtn) filterBtn.addEventListener('click', function () {
      var open = root.classList.toggle('cal-filters-open');
      filterBtn.setAttribute('aria-expanded', open ? 'true' : 'false');
    });

    // ---------- sidebar ----------
    root.addEventListener('change', function (event) {
      var layer = event.target.closest('[data-cal-layer]');
      if (layer) { hidden[layer.getAttribute('data-cal-layer')] = !layer.checked; redraw(); return; }
      var radio = event.target.closest('input[name="calChild"]');
      if (radio) { child = Number(radio.value) || 0; redraw(); }
    });
    root.querySelector('[data-cal-upcoming]').addEventListener('click', function (event) {
      var button = event.target.closest('[data-up]');
      var list = root.querySelector('[data-cal-upcoming]')._items || [];
      if (button && list[Number(button.getAttribute('data-up'))]) peek(list[Number(button.getAttribute('data-up'))], button);
    });
    renderChildren();

    // ---------- sync: Google Calendar and Outlook ----------
    var sync = document.querySelector('[data-sync-dialog]');
    var error = sync.querySelector('[data-sync-error]');
    var links = null;
    function drawApps() {
      sync.querySelector('[data-sync-apps]').innerHTML = APPS.map(function (app) {
        return '<div class="sync-row"><span class="sync-row__logo">' + app.logo + '</span><span class="sync-row__text"><strong>' + esc(app.name) + '</strong></span>'
          + '<a class="ws-btn ws-btn--primary sync-row__go" data-no-spa target="_blank" rel="noopener noreferrer" href="' + esc(links[app.key]) + '">Add</a></div>';
      }).join('');
    }
    root.querySelector('[data-cal-sync]').addEventListener('click', function () {
      error.textContent = '';
      if (!sync.open) sync.showModal();
      if (links) { drawApps(); return; }
      fetch(base + '/sync', { credentials: 'same-origin', headers: { Accept: 'application/json' } })
        .then(function (res) { return res.json(); })
        .then(function (json) { if (!json.success) throw new Error('no'); links = json.links; drawApps(); })
        .catch(function () { error.textContent = 'That didn’t work. Try again.'; });
    });
    sync.querySelector('[data-sync-close]').addEventListener('click', function () { sync.close(); });
    sync.addEventListener('click', function (e) { if (e.target === sync) sync.close(); });
    sync.querySelector('[data-sync-reset]').addEventListener('click', async function () {
      if (!await window.appConfirm('Make a new link? Calendars using the old link stop updating until you add the new one.')) return;
      fetch(base + '/sync/reset', { method: 'POST', credentials: 'same-origin', headers: { Accept: 'application/json', 'X-Requested-With': 'XMLHttpRequest' } })
        .then(function (res) { return res.json(); })
        .then(function (json) { if (!json.success) throw new Error('no'); links = json.links; drawApps(); })
        .catch(function () { error.textContent = 'That didn’t work. Try again.'; });
    });
  }

  function begin() { var root = document.getElementById('familyCalendar'); if (root) mount(root); }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', begin);
  else begin();
  window.addEventListener('spa:pageLoaded', begin);
})();
