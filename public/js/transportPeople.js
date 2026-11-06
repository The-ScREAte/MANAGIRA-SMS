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
        + '<section class="ux-sec"><label class="tm-switch"><span>Bus access</span><input type="checkbox" name="busAccess" value="1"' + (a.active ? ' checked' : '') + (data.canRiderList ? '' : ' disabled') + ' /><i aria-hidden="true"></i></label>'
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
      // Someone with only the Rider List can't change bus, route or stop, and the other way round.
      if (!data.canStudentRoutes) {
        ['busId', 'routeId', 'stopId', 'pickupTime', 'dropoffTime', 'homeAddress', 'addressAsStop'].forEach(function (name) { form.elements[name].disabled = true; });
      }
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

  // Search boxes above the Requests and Reports lists, which redraw as they refresh.
  document.querySelectorAll('[data-search-list]').forEach(function (input) {
    var target = $(input.getAttribute('data-search-list'));
    if (!target) return;
    var apply = function () {
      var wanted = input.value.trim().toLowerCase();
      target.querySelectorAll('tr.ux-row').forEach(function (row) {
        row.hidden = Boolean(wanted) && row.textContent.toLowerCase().indexOf(wanted) < 0;
      });
    };
    input.addEventListener('input', apply);
    new MutationObserver(apply).observe(target, { childList: true });
  });

  // Who decides: a setting that saves itself.
  var parentConfirm = $('tm-parent-confirm');
  if (parentConfirm) {
    parentConfirm.addEventListener('change', function () {
      var note = $('tm-parent-confirm-note');
      var wanted = parentConfirm.checked;
      note.textContent = 'Saving…';
      postForm('/transportation/manage/arrival-setting', { parentConfirm: wanted ? '1' : '0' }).then(function () {
        note.textContent = wanted ? 'On. Parents will be asked after each arrival check.' : 'Off.';
      }).catch(function (error) {
        parentConfirm.checked = !wanted;
        note.textContent = error.message;
      });
    });
  }

  /* ---------- driver reports ---------- */
  var reportList = $('tm-reports-list');
  if (reportList) {
    var reportBucket = 'new';
    var reportCache = {};
    var reportDrawn = null;
    var setReportCount = function (count) {
      [$('tm-reports-badge'), $('tm-reports-tab-count')].forEach(function (el) {
        if (!el) return;
        el.textContent = count;
        el.hidden = !count;
      });
      var tile = $('tm-reports-tile');
      if (tile) tile.textContent = count;
    };
    var drawReports = function (result) {
      var key = reportBucket + JSON.stringify(reportBucket === 'arrivals' ? result.arrivals : result.reports);
      if (key === reportDrawn) return;
      reportDrawn = key;
      if (reportBucket === 'arrivals') {
        if (!result.arrivals.length) { reportList.innerHTML = '<p class="ux-empty">No arrival checks yet.</p>'; return; }
        reportList.innerHTML = '<table class="ws-cards"><thead><tr><th>Date</th><th>Route</th><th>Driver</th><th>Arrived</th></tr></thead><tbody>' + result.arrivals.map(function (a) {
          var all = a.arrived === a.total;
          return '<tr class="ux-row" tabindex="0" data-trip-id="' + a.tripId + '"><td data-label="Date" class="ux-when">' + esc(fmtDate(a.checkedAt)) + '</td><td data-label="Route" class="ws-card-title"><strong>' + esc(a.routeName || 'Route') + '</strong></td><td data-label="Driver">' + esc(a.driverName || '–') + '</td><td data-label="Arrived"><span class="ws-pill ' + (all ? 'ws-pill--green' : 'ws-pill--amber') + '">' + a.arrived + ' of ' + a.total + '</span></td></tr>';
        }).join('') + '</tbody></table>';
        return;
      }
      if (!result.reports.length) { reportList.innerHTML = '<p class="ux-empty">' + (reportBucket === 'old' ? 'No old reports yet.' : 'No new reports.') + '</p>'; return; }
      reportList.innerHTML = '<table class="ws-cards"><thead><tr><th>Type</th><th>About</th><th>Driver</th><th>Date</th><th>Priority</th></tr></thead><tbody>' + result.reports.map(function (r) {
        return '<tr class="ux-row" tabindex="0" data-report-id="' + r.id + '"><td data-label="Type" class="ws-card-title"><strong>' + esc(r.issue || r.categoryLabel) + '</strong></td><td data-label="About">' + esc(r.studentName || [r.busNumber ? 'Bus ' + r.busNumber : '', r.routeName].filter(Boolean).join(' · ') || '–') + '</td><td data-label="Driver">' + esc(r.driverName || '–') + '</td><td data-label="Date" class="ux-when">' + esc(fmtDate(r.createdAt)) + '</td><td data-label="Priority"><span class="ws-pill ' + (r.priority === 'urgent' ? 'ws-pill--red' : 'tm-pill--none') + '">' + (r.priority === 'urgent' ? 'Urgent' : 'Normal') + '</span></td></tr>';
      }).join('') + '</tbody></table>';
    };
    var loadReports = function () {
      var asked = reportBucket;
      if (reportCache[asked]) drawReports(reportCache[asked]);
      else { reportDrawn = null; reportList.innerHTML = '<p class="ux-empty">Loading…</p>'; }
      return getJson('/transportation/manage/reports?bucket=' + asked).then(function (result) {
        reportCache[asked] = result;
        setReportCount(result.newCount);
        if (asked === reportBucket) drawReports(result);
      }).catch(function (error) {
        if (asked === reportBucket && !reportCache[asked]) reportList.innerHTML = '<p class="ux-alert">' + esc(error.message) + '</p>';
      });
    };
    var openReportPanel = function (row) {
      var cached = reportCache[reportBucket] || {};
      if (row.dataset.tripId) {
        var trip = (cached.arrivals || []).find(function (a) { return String(a.tripId) === row.dataset.tripId; });
        if (!trip) return;
        openPanel(trip.routeName || 'Trip', row);
        panelBody.innerHTML = '<section class="ux-sec tm-sec--first">'
          + '<div class="ux-kv"><span>Date</span><strong>' + esc(fmtDate(trip.checkedAt)) + '</strong></div>'
          + '<div class="ux-kv"><span>Driver</span><strong>' + esc(trip.driverName || '–') + '</strong></div>'
          + '<div class="ux-kv"><span>Bus</span><strong>' + esc(trip.busNumber || '–') + '</strong></div>'
          + '<div class="ux-kv"><span>Arrived</span><strong>' + trip.arrived + ' of ' + trip.total + '</strong></div>'
          + (trip.parentConfirmed + trip.parentPending + trip.parentNotArrived ? '<div class="ux-kv"><span>Parents</span><strong>' + trip.parentConfirmed + ' confirmed, ' + trip.parentNotArrived + ' said no, ' + trip.parentPending + ' waiting</strong></div>' : '')
          + '</section>'
          + (trip.missing.length ? '<section class="ux-sec"><h3>Did not arrive</h3>' + trip.missing.map(function (m) { return '<div class="ux-kv"><span>' + esc(m.student) + '</span><strong>' + esc(m.reason) + (m.note ? '<br />' + esc(m.note) : '') + '</strong></div>'; }).join('') + '</section>' : '');
        return;
      }
      var report = (cached.reports || []).find(function (r) { return String(r.id) === row.dataset.reportId; });
      if (!report) return;
      openPanel(report.issue || report.categoryLabel, row);
      var who = report.studentId
        ? '<section class="ux-sec"><h3>Who else sees this</h3><label class="tm-check"><input type="checkbox" name="shareWithParents" value="1"' + (report.shareWithParents ? ' checked' : '') + ' /> Parents</label><label class="tm-check" style="margin-top:8px;"><input type="checkbox" name="shareWithTeachers" value="1"' + (report.shareWithTeachers ? ' checked' : '') + ' /> Teachers</label></section>'
        : '';
      panelBody.innerHTML = '<form class="tm-form" novalidate><section class="ux-sec tm-sec--first">'
        + '<div class="ux-kv"><span>Type</span><strong>' + esc(report.categoryLabel) + '</strong></div>'
        + (report.issue ? '<div class="ux-kv"><span>Issue</span><strong>' + esc(report.issue) + '</strong></div>' : '')
        + '<div class="ux-kv"><span>From</span><strong>' + esc(report.driverName || '–') + '</strong></div>'
        + (report.studentName ? '<div class="ux-kv"><span>Student</span><strong>' + esc(report.studentName) + (report.className ? ', ' + esc(report.className) : '') + '</strong></div>' : '')
        + (report.busNumber ? '<div class="ux-kv"><span>Bus</span><strong>' + esc(report.busNumber) + '</strong></div>' : '')
        + (report.routeName ? '<div class="ux-kv"><span>Route</span><strong>' + esc(report.routeName) + '</strong></div>' : '')
        + '<div class="ux-kv"><span>Date</span><strong>' + esc(fmtDate(report.createdAt)) + '</strong></div>'
        + (report.details ? '<p style="margin:10px 0 0;white-space:pre-wrap;">' + esc(report.details) + '</p>' : '') + '</section>'
        + who
        + '<section class="ux-sec"><label class="tm-field"><span>Note' + (report.studentId ? ' (shown to whoever you share with)' : '') + '</span><input name="note" maxlength="300" autocomplete="off" value="' + esc(report.reviewNote || '') + '" /></label></section>'
        + '<p class="tm-form__note" data-form-note role="status" hidden></p>'
        + '<div class="tm-form__actions"><button type="button" class="ws-btn" data-close>Cancel</button><button type="submit" class="ws-btn ws-btn--primary">' + (report.status === 'new' ? 'Mark reviewed' : 'Save') + '</button></div></form>';
      var form = panelBody.querySelector('form');
      form.querySelector('[data-close]').addEventListener('click', closePanel);
      form.addEventListener('submit', function (event) {
        event.preventDefault();
        var submit = form.querySelector('[type="submit"]');
        submit.disabled = true;
        formMessage(form, 'Saving…');
        postForm('/transportation/manage/reports/' + report.id + '/review', {
          note: form.elements.note.value,
          shareWithParents: form.elements.shareWithParents && form.elements.shareWithParents.checked ? '1' : '0',
          shareWithTeachers: form.elements.shareWithTeachers && form.elements.shareWithTeachers.checked ? '1' : '0'
        }).then(function (result) {
          reportCache = {};
          setReportCount(result.newCount);
          closePanel();
          loadReports();
        }).catch(function (error) {
          submit.disabled = false;
          formMessage(form, error.message, true);
        });
      });
    };
    reportList.addEventListener('click', function (event) {
      var row = event.target.closest('tr.ux-row');
      if (row) openReportPanel(row);
    });
    reportList.addEventListener('keydown', function (event) {
      if ((event.key === 'Enter' || event.key === ' ') && event.target.matches('tr.ux-row')) { event.preventDefault(); openReportPanel(event.target); }
    });
    document.querySelectorAll('[data-report-bucket]').forEach(function (button) {
      button.addEventListener('click', function () {
        reportBucket = button.dataset.reportBucket;
        document.querySelectorAll('[data-report-bucket]').forEach(function (other) {
          other.classList.toggle('is-on', other === button);
          other.setAttribute('aria-selected', String(other === button));
        });
        loadReports();
      });
    });
    document.querySelectorAll('[data-pane="reports"], [data-tm-pane="reports"]').forEach(function (button) {
      button.addEventListener('click', loadReports);
    });
    if ($('tm-reports-badge')) loadReports();
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
    if ($('tm-requests-badge')) loadRequests();
  }
})();
