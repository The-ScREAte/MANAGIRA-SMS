// Activities for staff: a list with Add and Edit. Used on a class's tab and in Management Tools.
(function () {
  'use strict';

  function esc(value) {
    return String(value === null || value === undefined ? '' : value).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function send(url, body) {
    return fetch(url, {
      method: body ? 'POST' : 'GET',
      credentials: 'same-origin',
      headers: body ? { 'Content-Type': 'application/json', Accept: 'application/json', 'X-Requested-With': 'XMLHttpRequest' } : { Accept: 'application/json' },
      body: body ? JSON.stringify(body) : undefined
    }).then(function (res) {
      return res.json().catch(function () { return null; }).then(function (json) {
        if (!res.ok || !json || !json.success) throw new Error((json && json.message) || 'Something went wrong. Try again.');
        return json;
      });
    });
  }
  function pad(n) { return n < 10 ? '0' + n : String(n); }
  function today() { var d = new Date(); return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()); }
  function dayParts(value) {
    var d = new Date(value + 'T12:00:00');
    return { month: d.toLocaleDateString(undefined, { month: 'short' }), day: d.getDate(), weekday: d.toLocaleDateString(undefined, { weekday: 'short' }) };
  }
  function clock(value) {
    if (!value) return '';
    var d = new Date('2000-01-01T' + value);
    return d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  }
  function when(item) {
    if (item.endDate) { var last = dayParts(item.endDate); return 'Until ' + last.month + ' ' + last.day; }
    if (!item.startTime) return 'All day';
    return clock(item.startTime) + (item.endTime ? ' – ' + clock(item.endTime) : '');
  }

  function mount(root) {
    if (root.dataset.bound) return;
    root.dataset.bound = '1';
    var classId = root.getAttribute('data-class-id') || '';
    var classes = [];
    try { classes = JSON.parse(root.getAttribute('data-classes') || '[]'); } catch (_) { classes = []; }
    var items = [];

    root.innerHTML = '<div class="act-bar"><p class="act-count" data-count></p><button type="button" class="act-btn act-btn--go" data-add>Add activity</button></div><div data-list><p class="act-empty">Loading…</p></div>';

    function row(item) {
      var parts = dayParts(item.date);
      var meta = [when(item), item.location, classId ? '' : (item.className || 'Whole school')].filter(Boolean).join(' · ');
      return '<button type="button" class="act-row" data-edit="' + item.id + '"><span class="act-date"><small>' + esc(parts.month) + '</small><strong>' + parts.day + '</strong></span>'
        + '<span class="act-text"><strong>' + esc(item.title) + '</strong><small>' + esc(meta) + '</small>' + (item.details ? '<span class="act-details">' + esc(item.details) + '</span>' : '') + '</span></button>';
    }
    function render() {
      var now = today();
      var coming = items.filter(function (item) { return (item.endDate || item.date) >= now; });
      var past = items.filter(function (item) { return (item.endDate || item.date) < now; }).reverse();
      root.querySelector('[data-count]').textContent = coming.length ? coming.length + (coming.length === 1 ? ' coming up' : ' coming up') : '';
      root.querySelector('[data-list]').innerHTML = (coming.length ? '<div class="act-list">' + coming.map(row).join('') + '</div>' : '<p class="act-empty">No activities coming up.</p>')
        + (past.length ? '<details class="act-past"><summary>Past (' + past.length + ')</summary><div class="act-list">' + past.map(row).join('') + '</div></details>' : '');
    }
    function load() {
      return send('/common/activities/list' + (classId ? '?classId=' + encodeURIComponent(classId) : '')).then(function (result) {
        items = result.activities;
        render();
      }).catch(function (error) {
        root.querySelector('[data-list]').innerHTML = '<p class="act-empty">' + esc(error.message) + '</p>';
      });
    }

    function openForm(item) {
      var box = document.createElement('div');
      box.className = 'act-modal';
      box.setAttribute('role', 'dialog');
      box.setAttribute('aria-modal', 'true');
      box.setAttribute('aria-label', item ? 'Edit activity' : 'Add activity');
      var picker = classId ? '' : '<label class="act-field"><span>Who it’s for</span><select name="classId"><option value="">Whole school</option>' + classes.map(function (c) {
        return '<option value="' + c.id + '"' + (item && item.classId === c.id ? ' selected' : '') + '>' + esc(c.name) + '</option>';
      }).join('') + '</select></label>';
      box.innerHTML = '<form class="act-sheet" novalidate>'
        + '<div class="act-head"><h2>' + (item ? 'Edit activity' : 'Add activity') + '</h2><button type="button" class="act-x" data-close aria-label="Close">×</button></div>'
        + '<div class="act-body">'
        + '<label class="act-field"><span>Title</span><input name="title" maxlength="200" required value="' + esc(item ? item.title : '') + '" /></label>'
        + picker
        + '<div class="act-grid"><label class="act-field"><span>Date</span><input type="date" name="date" required value="' + esc(item ? item.date : today()) + '" /></label>'
        + '<label class="act-field"><span>Location</span><input name="location" maxlength="200" value="' + esc(item ? item.location : '') + '" /></label>'
        + '<label class="act-field"><span>Starts</span><input type="time" name="startTime" value="' + esc(item ? item.startTime || '' : '') + '" /></label>'
        + '<label class="act-field"><span>Ends</span><input type="time" name="endTime" value="' + esc(item ? item.endTime || '' : '') + '" /></label></div>'
        + '<label class="act-field"><span>Details for parents</span><textarea name="details" rows="3" maxlength="4000">' + esc(item ? item.details : '') + '</textarea></label>'
        + '<p class="act-error" role="alert" hidden></p></div>'
        + '<div class="act-foot">' + (item ? '<button type="button" class="act-btn act-btn--danger" data-delete>Delete</button>' : '') + '<span></span><button type="button" class="act-btn" data-close>Cancel</button><button type="submit" class="act-btn act-btn--go">Save</button></div>'
        + '</form>';
      document.body.appendChild(box);
      var form = box.querySelector('form');
      var error = box.querySelector('.act-error');
      var fail = function (text) { error.textContent = text; error.hidden = false; };
      form.elements.title.focus();
      box.addEventListener('click', function (event) {
        if (event.target === box || event.target.closest('[data-close]')) { box.remove(); return; }
        if (event.target.closest('[data-delete]')) {
          if (!window.confirm('Delete this activity?')) return;
          send('/common/activities/' + item.id + '/delete', {}).then(function () { box.remove(); return load(); }).catch(function (err) { fail(err.message); });
        }
      });
      form.addEventListener('submit', function (event) {
        event.preventDefault();
        error.hidden = true;
        var save = form.querySelector('[type="submit"]');
        save.disabled = true;
        send('/common/activities/save', {
          id: item ? item.id : null,
          classId: classId || (form.elements.classId ? form.elements.classId.value : ''),
          title: form.elements.title.value,
          date: form.elements.date.value,
          location: form.elements.location.value,
          startTime: form.elements.startTime.value,
          endTime: form.elements.endTime.value,
          details: form.elements.details.value
        }).then(function () { box.remove(); return load(); }).catch(function (err) { save.disabled = false; fail(err.message); });
      });
    }

    root.addEventListener('click', function (event) {
      if (event.target.closest('[data-add]')) { openForm(null); return; }
      var edit = event.target.closest('[data-edit]');
      if (edit) {
        var id = Number(edit.getAttribute('data-edit'));
        openForm(items.filter(function (item) { return item.id === id; })[0] || null);
      }
    });
    load();
  }

  function begin() { document.querySelectorAll('[data-activities]').forEach(mount); }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', begin);
  else begin();
  window.addEventListener('spa:pageLoaded', begin);
})();
