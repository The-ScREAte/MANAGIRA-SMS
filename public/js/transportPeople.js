// Transportation page: the Students list, the Requests tab and the panel that slides
// in from the right for both. Everything saves in place, without reloading the page.
(function () {
  'use strict';

  var root = document.getElementById('tm-people-data');
  if (!root || root.dataset.bound === '1') return;
  root.dataset.bound = '1';
  var data = JSON.parse(root.textContent || '{}');
  var buses = data.buses || [];
  var routes = data.routes || [];
  var stops = data.stops || [];
  var unit = data.unit === 'mi' ? 'mi' : 'km';

  var $ = function (id) { return document.getElementById(id); };
  var panel = $('tm-panel');
  var backdrop = $('tm-panel-backdrop');
  var panelBody = $('tm-panel-body');
  var panelTitle = $('tm-panel-title');
  if (!panel) return;

  function esc(value) {
    return String(value == null ? '' : value).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function getJson(url) {
    return fetch(url, { credentials: 'same-origin', headers: { Accept: 'application/json' } }).then(readJson);
  }
  function postForm(url, fields) {
    var body = new URLSearchParams();
    Object.keys(fields).forEach(function (key) {
      var value = fields[key];
      if (Array.isArray(value)) value.forEach(function (item) { body.append(key, item); });
      else if (value !== null && value !== undefined) body.append(key, value);
    });
    return fetch(url, {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8', Accept: 'application/json', 'X-Requested-With': 'XMLHttpRequest' },
      body: body.toString()
    }).then(readJson);
  }
  function readJson(res) {
    return res.json().catch(function () { return null; }).then(function (json) {
      if (!res.ok || !json || json.success === false || json.ok === false) throw new Error((json && json.message) || 'Something went wrong. Please try again.');
      return json;
    });
  }
  function options(list, valueKey, label, selected, emptyLabel) {
    return '<option value="">' + esc(emptyLabel) + '</option>' + list.map(function (item) {
      var value = String(item[valueKey]);
      return '<option value="' + esc(value) + '"' + (String(selected) === value ? ' selected' : '') + '>' + esc(label(item)) + '</option>';
    }).join('');
  }
  function busOptions(selected) { return options(buses, 'bus_id', function (b) { return 'Bus ' + b.bus_number; }, selected, 'No bus yet'); }
  function routeOptions(selected) { return options(routes, 'route_id', function (r) { return r.route_name; }, selected, 'No route yet'); }
  function stopOptions(routeId, selected) {
    var list = stops.filter(function (s) { return String(s.route_id) === String(routeId); });
    return options(list, 'stop_id', function (s) { return s.stop_name; }, selected, list.length ? 'Choose a stop' : 'No stops on this route');
  }
  function bindRouteStop(form) {
    var route = form.querySelector('[name="routeId"]');
    var stop = form.querySelector('[name="stopId"]');
    if (route && stop) route.addEventListener('change', function () { stop.innerHTML = stopOptions(route.value, ''); });
  }
  function fmtDate(value) {
    try { return new Date(value).toLocaleDateString([], { month: 'short', day: 'numeric', year: 'numeric' }); } catch (_) { return ''; }
  }
  function fmtDistance(km) {
    if (km === null || km === undefined) return '';
    return unit === 'mi' ? (km * 0.621371).toFixed(1) + ' mi' : km.toFixed(1) + ' km';
  }

  /* ---------- panel ---------- */
  var openRow = null;
  function openPanel(title, row) {
    panelTitle.textContent = title;
    panelBody.innerHTML = '<p class="ux-muted">Loading…</p>';
    if (openRow) openRow.classList.remove('is-selected');
    openRow = row || null;
    if (openRow) openRow.classList.add('is-selected');
    backdrop.hidden = false;
    panel.classList.add('is-open');
    panel.setAttribute('aria-hidden', 'false');
    $('tm-panel-close').focus();
  }
  function closePanel() {
    panel.classList.remove('is-open');
    panel.setAttribute('aria-hidden', 'true');
    backdrop.hidden = true;
    if (openRow) { openRow.classList.remove('is-selected'); openRow.focus(); openRow = null; }
  }
  $('tm-panel-close').addEventListener('click', closePanel);
  backdrop.addEventListener('click', closePanel);
  document.addEventListener('keydown', function (event) {
    if (event.key === 'Escape' && panel.classList.contains('is-open')) closePanel();
  });
  function showPanelError(message) { panelBody.innerHTML = '<p class="ux-alert">' + esc(message) + '</p>'; }
  function formMessage(form, text, isError) {
    var note = form.querySelector('[data-form-note]');
    if (!note) return;
    note.hidden = !text;
    note.textContent = text || '';
    note.classList.toggle('is-error', Boolean(isError));
  }

  /* ---------- students ---------- */
  var list = $('tm-students-table');
  if (list) {
    var rows = Array.prototype.slice.call(list.querySelectorAll('tr.ux-row'));
    var nameFilter = $('tm-filter-name');
    var classFilter = $('tm-filter-class');
    var accessFilter = $('tm-filter-access');
    var shown = $('tm-students-shown');
    var empty = $('tm-students-empty');
    var classTools = $('tm-class-tools');
    var editClass = $('tm-class-edit');
    var saveClass = $('tm-class-save');
    var cancelClass = $('tm-class-cancel');
    var notify = $('tm-class-notify');
    var classNote = $('tm-class-note');
    var bulk = false;

    var applyFilters = function () {
      var name = nameFilter.value.trim().toLowerCase();
      var klass = classFilter.value;
      var access = accessFilter.value;
      var count = 0;
      rows.forEach(function (row) {
        var match = (!name || row.dataset.name.indexOf(name) >= 0)
          && (!klass || row.dataset.classId === klass)
          && (!access || row.dataset.access === access);
        row.hidden = !match;
        if (match) count += 1;
      });
      shown.textContent = count + ' of ' + rows.length + ' student' + (rows.length === 1 ? '' : 's');
      empty.hidden = count > 0;
      classTools.hidden = !klass;
      if (notify) {
        notify.hidden = !klass || klass === '__unassigned__';
        notify.dataset.contextId = klass;
      }
      if (!klass && bulk) setBulk(false);
    };
    var setBulk = function (on) {
      bulk = on;
      list.classList.toggle('is-bulk', on);
      editClass.hidden = on;
      saveClass.hidden = !on;
      cancelClass.hidden = !on;
      classFilter.disabled = on;
      classNote.textContent = on ? 'Tick who has bus access, then save.' : '';
      rows.forEach(function (row) {
        var box = row.querySelector('input[type="checkbox"]');
        box.checked = row.dataset.access === 'yes';
      });
    };
    var setRowAccess = function (row, yes) {
      row.dataset.access = yes ? 'yes' : 'no';
      var pill = row.querySelector('[data-access-pill]');
      pill.className = 'ws-pill ' + (yes ? 'ws-pill--green' : 'tm-pill--none');
      pill.textContent = yes ? 'Bus access' : 'No bus access';
      refreshRiderCount();
    };
    var refreshRiderCount = function () {
      var el = $('tm-riders-count');
      if (el) el.textContent = rows.filter(function (row) { return row.dataset.access === 'yes'; }).length;
    };

    [nameFilter, classFilter, accessFilter].forEach(function (el) {
      el.addEventListener('input', applyFilters);
      el.addEventListener('change', applyFilters);
    });
    $('tm-filters-clear').addEventListener('click', function () {
      nameFilter.value = ''; classFilter.value = ''; accessFilter.value = '';
      applyFilters();
    });
    editClass.addEventListener('click', function () { setBulk(true); });
    cancelClass.addEventListener('click', function () { setBulk(false); });
    saveClass.addEventListener('click', function () {
      var klass = classFilter.value;
      var inClass = rows.filter(function (row) { return row.dataset.classId === klass; });
      var selected = inClass.filter(function (row) { return row.querySelector('input[type="checkbox"]').checked; });
      saveClass.disabled = true;
      classNote.textContent = 'Saving…';
      postForm('/transportation/manage/students/access', {
        classId: klass,
        allStudentIds: inClass.map(function (row) { return row.dataset.studentId; }),
        selectedStudentIds: selected.map(function (row) { return row.dataset.studentId; })
      }).then(function () {
        inClass.forEach(function (row) { setRowAccess(row, selected.indexOf(row) >= 0); });
        setBulk(false);
        classNote.textContent = 'Saved.';
        applyFilters();
      }).catch(function (error) {
        classNote.textContent = error.message;
      }).then(function () { saveClass.disabled = false; });
    });

    var renderStudent = function (info, row) {
      var s = info.student, a = info.assignment;
      panelTitle.textContent = s.firstName + ' ' + s.lastName;
      panelBody.innerHTML = '<form class="tm-form" novalidate>'
        + '<section class="ux-sec tm-sec--first">'
        + '<div class="ux-kv"><span>Class</span><strong>' + esc(s.className || 'None') + '</strong></div>'
        + '<div class="ux-kv"><span>Home address</span><strong>' + esc(s.address || 'None') + '</strong></div>'
        + '</section>'
        + '<section class="ux-sec"><label class="tm-switch"><span>Bus access</span><input type="checkbox" name="busAccess" value="1"' + (a.active ? ' checked' : '') + ' /><i aria-hidden="true"></i></label>'
        + '<div class="tm-fields" data-bus-fields' + (a.active ? '' : ' hidden') + '>'
        + '<label class="tm-field tm-field--wide"><span>Bus</span><select name="busId">' + busOptions(a.busId) + '</select></label>'
        + '<label class="tm-field tm-field--wide"><span>Route</span><select name="routeId">' + routeOptions(a.routeId) + '</select></label>'
        + '<label class="tm-field tm-field--wide"><span>Stop</span><select name="stopId">' + stopOptions(a.routeId, a.stopId) + '</select></label>'
        + '<label class="tm-field"><span>Pickup time</span><input type="time" name="pickupTime" value="' + esc(a.pickupTime) + '" /></label>'
        + '<label class="tm-field"><span>Drop-off time</span><input type="time" name="dropoffTime" value="' + esc(a.dropoffTime) + '" /></label>'
        + '<label class="tm-field tm-field--wide"><span>Pickup address</span><input name="homeAddress" maxlength="300" autocomplete="off" placeholder="' + esc(s.address || 'Street, area') + '" value="' + esc(a.homeAddress) + '" /></label>'
        + '<label class="tm-check tm-field--wide"><input type="checkbox" name="addressAsStop" value="1"' + (a.addressAsStop ? ' checked' : '') + ' /> Address as stop</label>'
        + '</div></section>'
        + '<p class="tm-form__note" data-form-note role="status" hidden></p>'
        + '<div class="tm-form__actions"><button type="button" class="ws-btn" data-close>Cancel</button><button type="submit" class="ws-btn ws-btn--primary">Save</button></div>'
        + '</form>';
      var form = panelBody.querySelector('form');
      bindRouteStop(form);
      form.elements.busAccess.addEventListener('change', function () {
        form.querySelector('[data-bus-fields]').hidden = !form.elements.busAccess.checked;
      });
      form.querySelector('[data-close]').addEventListener('click', closePanel);
      form.addEventListener('submit', function (event) {
        event.preventDefault();
        var fields = Object.fromEntries(new FormData(form).entries());
        var submit = form.querySelector('[type="submit"]');
        submit.disabled = true;
        formMessage(form, 'Saving…');
        postForm('/transportation/manage/students/' + encodeURIComponent(s.id) + '/save', fields).then(function (result) {
          setRowAccess(row, Boolean(result.hasAccess));
          applyFilters();
          if (result.warning) formMessage(form, result.warning, true);
          else closePanel();
        }).catch(function (error) {
          formMessage(form, error.message, true);
        }).then(function () { submit.disabled = false; });
      });
    };

    var openStudent = function (row) {
      if (bulk) return;
      openPanel(row.querySelector('[data-name]').textContent, row);
      var wanted = row;
      getJson('/transportation/manage/students/' + encodeURIComponent(row.dataset.studentId)).then(function (info) {
        if (openRow === wanted) renderStudent(info, wanted);
      }).catch(function (error) { if (openRow === wanted) showPanelError(error.message); });
    };
    list.addEventListener('click', function (event) {
      if (event.target.closest('input, label')) return;
      var row = event.target.closest('tr.ux-row');
      if (row) openStudent(row);
    });
    list.addEventListener('keydown', function (event) {
      if ((event.key === 'Enter' || event.key === ' ') && event.target.matches('tr.ux-row')) {
        event.preventDefault();
        openStudent(event.target);
      }
    });
    applyFilters();
  }

  /* ---------- requests ---------- */
  var requestList = $('tm-requests-list');
  if (requestList) {
    var bucket = 'new';
    var cache = {};
    var STATUS = {
      pending: ['Waiting', 'ws-pill--amber'], approved: ['Approved', 'ws-pill--green'],
      declined: ['Declined', 'ws-pill--red'], cancelled: ['Cancelled', 'tm-pill--none']
    };
    var setCount = function (count) {
      [$('tm-requests-badge'), $('tm-requests-tab-count')].forEach(function (el) {
        if (!el) return;
        el.textContent = count;
        el.hidden = !count;
      });
      var tile = $('tm-requests-tile');
      if (tile) tile.textContent = count;
    };
    var requestRow = function (r) {
      var place = [r.routeName, r.stopName].filter(Boolean).join(' · ') || 'No stop chosen';
      var status = STATUS[r.status] || STATUS.pending;
      return '<tr class="ux-row" tabindex="0" data-request-id="' + r.id + '">'
        + '<td data-label="Student" class="ws-card-title"><strong>' + esc(r.studentName) + '</strong></td>'
        + '<td data-label="Class">' + esc(r.className || '–') + '</td>'
        + '<td data-label="Route and stop" class="ws-card-wide">' + esc(place) + '</td>'
        + '<td data-label="Asked by">' + esc(r.requesterName || (r.requesterType === 'guardian' ? 'Parent' : 'Staff')) + '</td>'
        + '<td data-label="Date" class="ux-when">' + esc(fmtDate(bucket === 'old' ? (r.decidedAt || r.createdAt) : r.createdAt)) + '</td>'
        + (bucket === 'old' ? '<td data-label="Status"><span class="ws-pill ' + status[1] + '">' + status[0] + '</span></td>' : '')
        + '</tr>';
    };
    var drawn = null;
    var renderRequests = function (requests) {
      // Same list as on screen: leave it alone, so nothing flickers under the pointer.
      var key = bucket + JSON.stringify(requests);
      if (key === drawn) return;
      drawn = key;
      if (!requests.length) {
        requestList.innerHTML = '<p class="ux-empty">' + (bucket === 'old' ? 'No old requests yet.' : 'No new requests.') + '</p>';
        return;
      }
      requestList.innerHTML = '<table class="ws-cards"><thead><tr><th>Student</th><th>Class</th><th>Route and stop</th><th>Asked by</th><th>Date</th>'
        + (bucket === 'old' ? '<th>Status</th>' : '') + '</tr></thead><tbody>' + requests.map(requestRow).join('') + '</tbody></table>';
    };
    var loadRequests = function (quiet) {
      if (!quiet && !cache[bucket]) { drawn = null; requestList.innerHTML = '<p class="ux-empty">Loading…</p>'; }
      if (cache[bucket]) renderRequests(cache[bucket]);
      var asked = bucket;
      return getJson('/transportation/manage/requests?bucket=' + asked).then(function (result) {
        cache[asked] = result.requests;
        setCount(result.newCount);
        if (asked === bucket) renderRequests(result.requests);
      }).catch(function (error) {
        if (asked === bucket && !cache[asked]) requestList.innerHTML = '<p class="ux-alert">' + esc(error.message) + '</p>';
      });
    };
    var renderReview = function (r) {
      var mapLink = r.latitude !== null ? 'https://www.google.com/maps/search/?api=1&query=' + r.latitude + ',' + r.longitude : null;
      var who = (r.requesterName || (r.requesterType === 'guardian' ? 'Parent' : 'Staff')) + ', ' + fmtDate(r.createdAt);
      var summary = '<section class="ux-sec tm-sec--first">'
        + '<div class="ux-kv"><span>Class</span><strong>' + esc(r.className || 'None') + '</strong></div>'
        + '<div class="ux-kv"><span>Asked by</span><strong>' + esc(who) + '</strong></div>'
        + '<div class="ux-kv"><span>Address</span><strong>' + esc(r.address || 'Pin on map') + (mapLink ? '<br /><a href="' + esc(mapLink) + '" target="_blank" rel="noopener">View on map</a>' : '') + '</strong></div>'
        + (r.distanceKm !== null ? '<div class="ux-kv"><span>Distance to stop</span><strong>' + esc(fmtDistance(r.distanceKm)) + '</strong></div>' : '')
        + '</section>';
      if (r.status !== 'pending') {
        var status = STATUS[r.status] || STATUS.pending;
        panelBody.innerHTML = summary + '<section class="ux-sec"><div class="ux-kv"><span>Status</span><strong><span class="ws-pill ' + status[1] + '">' + status[0] + '</span></strong></div>'
          + '<div class="ux-kv"><span>Route and stop</span><strong>' + esc([r.routeName, r.stopName].filter(Boolean).join(' · ') || 'None') + '</strong></div>'
          + (r.decidedBy ? '<div class="ux-kv"><span>Answered by</span><strong>' + esc(r.decidedBy) + ', ' + esc(fmtDate(r.decidedAt)) + '</strong></div>' : '')
          + (r.decisionNote ? '<div class="ux-kv"><span>Note</span><strong>' + esc(r.decisionNote) + '</strong></div>' : '')
          + '</section>';
        return;
      }
      panelBody.innerHTML = summary + '<form class="tm-form" novalidate><section class="ux-sec"><h3>Put on a bus</h3><div class="tm-fields">'
        + '<label class="tm-field tm-field--wide"><span>Route</span><select name="routeId">' + routeOptions(r.routeId) + '</select></label>'
        + '<label class="tm-field tm-field--wide"><span>Stop</span><select name="stopId">' + stopOptions(r.routeId, r.stopId) + '</select></label>'
        + '<label class="tm-field tm-field--wide"><span>Bus</span><select name="busId">' + options(buses, 'bus_id', function (b) { return 'Bus ' + b.bus_number; }, '', 'The route\'s scheduled bus') + '</select></label>'
        + '<label class="tm-field tm-field--wide"><span>Note to the family (optional)</span><input name="note" maxlength="300" autocomplete="off" /></label>'
        + '</div></section><p class="tm-form__note" data-form-note role="status" hidden></p>'
        + '<div class="tm-form__actions"><button type="button" class="ws-btn ws-btn--danger" data-decline>Decline</button><button type="submit" class="ws-btn ws-btn--primary">Approve</button></div></form>';
      var form = panelBody.querySelector('form');
      bindRouteStop(form);
      var decide = function (action, fields, button) {
        button.disabled = true;
        formMessage(form, 'Saving…');
        postForm('/transportation/manage/requests/' + r.id + '/' + action, fields).then(function (result) {
          cache = {};
          setCount(result.newCount);
          closePanel();
          loadRequests(true);
          if (action === 'approve') {
            var row = document.querySelector('#tm-students-table tr.ux-row[data-student-id="' + r.studentId + '"]');
            if (row) {
              row.dataset.access = 'yes';
              var pill = row.querySelector('[data-access-pill]');
              pill.className = 'ws-pill ws-pill--green';
              pill.textContent = 'Bus access';
            }
          }
        }).catch(function (error) {
          formMessage(form, error.message, true);
          cache = {};
          loadRequests(true);
        }).then(function () { button.disabled = false; });
      };
      form.addEventListener('submit', function (event) {
        event.preventDefault();
        decide('approve', Object.fromEntries(new FormData(form).entries()), form.querySelector('[type="submit"]'));
      });
      form.querySelector('[data-decline]').addEventListener('click', function (event) {
        decide('decline', { note: form.elements.note.value }, event.currentTarget);
      });
    };
    var openRequest = function (row) {
      var request = (cache[bucket] || []).find(function (r) { return String(r.id) === row.dataset.requestId; });
      if (!request) return;
      openPanel(request.studentName, row);
      renderReview(request);
    };
    requestList.addEventListener('click', function (event) {
      var row = event.target.closest('tr.ux-row');
      if (row) openRequest(row);
    });
    requestList.addEventListener('keydown', function (event) {
      if ((event.key === 'Enter' || event.key === ' ') && event.target.matches('tr.ux-row')) {
        event.preventDefault();
        openRequest(event.target);
      }
    });
    document.querySelectorAll('[data-request-bucket]').forEach(function (button) {
      button.addEventListener('click', function () {
        bucket = button.dataset.requestBucket;
        document.querySelectorAll('[data-request-bucket]').forEach(function (other) {
          var on = other === button;
          other.classList.toggle('is-on', on);
          other.setAttribute('aria-selected', String(on));
        });
        loadRequests();
      });
    });
    // New requests come from parents and teachers: look again whenever the tab opens.
    document.querySelectorAll('[data-pane="requests"], [data-tm-pane="requests"]').forEach(function (button) {
      button.addEventListener('click', function () { loadRequests(true); });
    });
    loadRequests();
  }
})();
