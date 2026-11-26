/* Requests and Bus reports tabs in the parent and student portals (feature portal_requests).
 *   <div data-gdr-tabs data-portal-requests="parent|student" [data-bus-requests]> … [data-gdr-tab] …
 *   <section data-gdr-panel="requests"> [data-gdr-bucket] … [data-gdr-list]
 *   <section data-gdr-panel="reports"> [data-gdr-reports]
 * Requests: forms the school asks them to fill in (/guardian/requests, /student/requests), New = still
 * to do, Old = sent; for a family on the bus, their bus requests too (/transportation/requests/mine).
 * Everything typed by people goes in as text.
 */
(function () {
  'use strict';
  var STATUS = { pending: 'Waiting', approved: 'Approved', declined: 'Declined', cancelled: 'Cancelled' };

  function esc(value) {
    return String(value == null ? '' : value).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function get(url) {
    return fetch(url, { credentials: 'same-origin', headers: { Accept: 'application/json' } }).then(function (res) {
      return res.json().catch(function () { return null; }).then(function (body) {
        if (!res.ok || !body || body.success === false) throw new Error((body && body.message) || 'This could not load. Try again.');
        return body;
      });
    });
  }
  function post(url) {
    return fetch(url, { method: 'POST', credentials: 'same-origin', headers: { Accept: 'application/json', 'Content-Type': 'application/json' }, body: '{}' }).then(function (res) {
      return res.json().catch(function () { return null; }).then(function (body) {
        if (!res.ok || !body || body.success === false) throw new Error((body && body.message) || 'That didn’t work. Try again.');
        return body;
      });
    });
  }
  function day(value, withYear) {
    if (!value) return '';
    var d = /^\d{4}-\d{2}-\d{2}$/.test(String(value)) ? new Date(value + 'T12:00:00') : new Date(value);
    if (isNaN(d.getTime())) return '';
    var opts = { month: 'short', day: 'numeric' };
    if (withYear || d.getFullYear() !== new Date().getFullYear()) opts.year = 'numeric';
    return d.toLocaleDateString(undefined, opts);
  }
  function dueText(due) {
    if (!due) return '';
    var d = new Date(due + 'T23:59:59');
    var left = Math.ceil((d - new Date()) / 86400000);
    if (left < 0) return 'Was due ' + day(due);
    if (left === 0) return 'Due today';
    if (left === 1) return 'Due tomorrow';
    return 'Due ' + day(due);
  }

  function formItem(r, audience) {
    var meta = [];
    if (audience === 'parent' && r.studentName) meta.push('For ' + r.studentName + (r.schoolName ? ' at ' + r.schoolName : ''));
    if (r.status === 'new') {
      var due = dueText(r.dueDate);
      if (due) meta.push(due);
      if (r.required) meta.push('Required');
    } else {
      meta.push('Sent ' + day(r.sentAt) + (r.sentBy ? ' by ' + r.sentBy : ''));
    }
    var late = r.status === 'new' && r.dueDate && new Date(r.dueDate + 'T23:59:59') < new Date();
    var pill = r.status === 'new' ? '<span class="gdr-pill pr-pill--todo' + (late ? ' is-late' : '') + '">' + (late ? 'Overdue' : 'To do') + '</span>' : '<span class="gdr-pill gdr-pill--approved">Sent</span>';
    var action = r.href
      ? '<a class="pr-go' + (r.status === 'new' ? ' is-primary' : '') + '" href="' + esc(r.href) + '">' + (r.status === 'new' ? 'Fill in' : 'View') + '</a>'
      : '';
    return '<li class="gdr-item pr-item"><span class="pr-icon" aria-hidden="true"><svg viewBox="0 0 24 24"><path d="M7 3h7l5 5v13H7z" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/><path d="M14 3v5h5M10 13h6M10 17h6" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg></span>'
      + '<div class="pr-body"><div class="gdr-item__top"><strong>' + esc(r.title) + '</strong>' + pill + '</div>'
      + '<p class="pr-meta">' + esc(meta.join(' · ')) + '</p></div>' + action + '</li>';
  }
  function busItem(r) {
    var place = [r.routeName, r.stopName].filter(Boolean).join(' · ');
    return '<li class="gdr-item pr-item"><span class="pr-icon" aria-hidden="true"><svg viewBox="0 0 24 24"><path d="M6 3h12a2 2 0 0 1 2 2v11a2 2 0 0 1-1 1.7V19a1 1 0 0 1-1 1h-1a1 1 0 0 1-1-1v-1H8v1a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1v-1.3A2 2 0 0 1 4 16V5a2 2 0 0 1 2-2Zm0 3v5h12V6H6Z" fill="currentColor"/></svg></span>'
      + '<div class="pr-body"><div class="gdr-item__top"><strong>Bus for ' + esc(r.studentName) + '</strong><span class="gdr-pill gdr-pill--' + esc(r.status) + '">' + esc(STATUS[r.status] || r.status) + '</span></div>'
      + (place ? '<p class="pr-meta">' + esc(place) + '</p>' : '')
      + (r.address ? '<p class="pr-meta">' + esc(r.address) + '</p>' : '')
      + (r.decisionNote ? '<p class="pr-meta">School’s note: ' + esc(r.decisionNote) + '</p>' : '')
      + '</div>'
      + (r.status === 'pending' ? '<button type="button" class="pr-go" data-gdr-cancel="' + esc(r.id) + '">Cancel</button>' : '')
      + '</li>';
  }
  function reportItem(r, audience) {
    return '<li class="gdr-item"><div class="gdr-item__top"><strong>' + esc(audience === 'student' ? (r.issue || r.categoryLabel || 'Bus report') : (r.studentName || r.categoryLabel)) + '</strong><span>' + esc(day(r.createdAt)) + '</span></div>'
      + (audience !== 'student' && r.issue ? '<p><b>' + esc(r.issue) + '</b></p>' : '') + (r.details ? '<p>' + esc(r.details) + '</p>' : '') + (r.note ? '<p>School’s note: ' + esc(r.note) + '</p>' : '') + '</li>';
  }

  function mount() {
    var tabs = document.querySelector('[data-gdr-tabs][data-portal-requests]');
    if (!tabs || tabs.dataset.prBound === '1') return;
    tabs.dataset.prBound = '1';
    var audience = tabs.getAttribute('data-portal-requests') === 'student' ? 'student' : 'parent';
    var withBus = tabs.hasAttribute('data-bus-requests');
    var scope = tabs.closest('[data-pr-scope]') || document;
    var panel = scope.querySelector('[data-gdr-panel="requests"]');
    var list = panel && panel.querySelector('[data-gdr-list]');
    var badge = tabs.querySelector('[data-gdr-count]');
    var bucket = 'new';
    var requestsUrl = audience === 'student' ? '/student/requests' : '/guardian/requests';
    var reportsUrl = audience === 'student' ? '/student/bus-reports' : '/transportation/reports/mine';
    if (!panel || !list) return;

    function setCount(count) { if (!badge) return; badge.textContent = count > 99 ? '99+' : String(count); badge.hidden = !count; }
    function load() {
      var asked = bucket;
      return Promise.all([
        get(requestsUrl + '?bucket=' + asked).catch(function (error) { return { error: error, requests: [], newCount: 0 }; }),
        withBus ? get('/transportation/requests/mine?bucket=' + asked).catch(function () { return { requests: [] }; }) : Promise.resolve({ requests: [] }),
        withBus && asked === 'old' ? get('/transportation/requests/mine?bucket=new').catch(function () { return { requests: [] }; }) : Promise.resolve(null),
      ]).then(function (out) {
        var formsResult = out[0], bus = out[1].requests || [], busNew = out[2] ? (out[2].requests || []).length : bus.length;
        setCount((formsResult.newCount || 0) + busNew);
        if (asked !== bucket) return;
        var forms = formsResult.requests || [];
        if (formsResult.error && !bus.length) { list.innerHTML = '<p class="gdr-empty"></p>'; list.firstChild.textContent = formsResult.error.message; return; }
        if (!forms.length && !bus.length) {
          list.innerHTML = '<div class="pr-empty"><strong>' + (bucket === 'new' ? 'You’re all caught up' : 'Nothing sent yet') + '</strong><span>' + (bucket === 'new'
            ? (audience === 'student' ? 'When your school asks you to fill something in, it shows here.' : 'When the school asks you to fill something in, it shows here.')
            : 'Forms you send show here.') + '</span></div>';
          return;
        }
        var both = forms.length && bus.length;
        var html = '';
        if (forms.length) html += (both ? '<h3 class="pr-group">From the school</h3>' : '') + '<ul class="gdr-list">' + forms.map(function (r) { return formItem(r, audience); }).join('') + '</ul>';
        if (bus.length) html += (both ? '<h3 class="pr-group">Bus requests</h3>' : '') + '<ul class="gdr-list">' + bus.map(busItem).join('') + '</ul>';
        list.innerHTML = html;
      });
    }
    function loadReports() {
      var box = scope.querySelector('[data-gdr-reports]');
      if (!box) return;
      get(reportsUrl).then(function (result) {
        if (!result.reports || !result.reports.length) { box.innerHTML = '<div class="pr-empty"><strong>No bus reports</strong><span>Reports the school shares about the bus show here.</span></div>'; return; }
        box.innerHTML = '<ul class="gdr-list">' + result.reports.map(function (r) { return reportItem(r, audience); }).join('') + '</ul>';
      }).catch(function (error) { box.innerHTML = '<p class="gdr-empty"></p>'; box.firstChild.textContent = error.message; });
    }

    tabs.addEventListener('click', function (event) {
      var tab = event.target.closest('[data-gdr-tab]');
      if (!tab) return;
      var name = tab.getAttribute('data-gdr-tab');
      tabs.querySelectorAll('[data-gdr-tab]').forEach(function (other) {
        var on = other === tab;
        other.classList.toggle('is-on', on);
        other.setAttribute('aria-selected', String(on));
      });
      scope.querySelectorAll('[data-gdr-panel]').forEach(function (section) { section.hidden = section.getAttribute('data-gdr-panel') !== name; });
      if (name === 'requests') load();
      if (name === 'reports') loadReports();
    });
    panel.addEventListener('click', function (event) {
      var segment = event.target.closest('[data-gdr-bucket]');
      if (segment) {
        bucket = segment.getAttribute('data-gdr-bucket');
        panel.querySelectorAll('[data-gdr-bucket]').forEach(function (other) {
          var on = other === segment;
          other.classList.toggle('is-on', on);
          other.setAttribute('aria-selected', String(on));
        });
        list.innerHTML = '<p class="gdr-empty">Loading…</p>';
        load();
        return;
      }
      var cancel = event.target.closest('[data-gdr-cancel]');
      if (cancel) {
        cancel.disabled = true;
        post('/transportation/requests/' + encodeURIComponent(cancel.getAttribute('data-gdr-cancel')) + '/cancel').then(load).catch(function (error) {
          cancel.disabled = false;
          window.alert(error.message);
        });
      }
    });
    document.addEventListener('busrequest:changed', load);
    // ?tab=requests opens Requests (a notice can link straight to it).
    var wanted = new URLSearchParams(window.location.search).get('tab');
    var start = wanted && tabs.querySelector('[data-gdr-tab="' + wanted.replace(/[^a-z]/g, '') + '"]');
    if (start) start.click(); else load();
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', mount);
  else mount();
  window.addEventListener('spa:pageLoaded', mount);
})();
