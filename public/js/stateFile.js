// Report Builder › State file (controllers/stateReportingController.js, utils/stateFile.js):
// write a saved report the way the state asks for it, check it, schedule it, and keep each file
// made. Everything a school typed or a report holds goes in as text, never as markup.
(function () {
  'use strict';

  var LAYOUT_LABELS = { comma: 'Comma-separated (CSV)', tab: 'Tab-separated', pipe: 'Pipe-separated ( | )', fixed: 'Fixed width' };
  var DATE_LABELS = { YYYYMMDD: 'CCYYMMDD (20261007)', 'YYYY-MM-DD': 'YYYY-MM-DD', 'MM/DD/YYYY': 'MM/DD/YYYY', MMDDYYYY: 'MMDDYYYY', 'MM-DD-YYYY': 'MM-DD-YYYY' };
  var WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
  var state = null;

  function el(tag, attrs, children) {
    var node = document.createElement(tag);
    Object.keys(attrs || {}).forEach(function (key) {
      var value = attrs[key];
      if (value === undefined || value === null || value === false) return;
      if (key === 'text') node.textContent = value;
      else if (key === 'className') node.className = value;
      else if (key === 'on') Object.keys(value).forEach(function (type) { node.addEventListener(type, value[type]); });
      else if (key === 'checked' || key === 'disabled' || key === 'hidden') node[key] = Boolean(value);
      else if (key === 'value') node.value = value;
      else node.setAttribute(key, value === true ? '' : value);
    });
    (children || []).forEach(function (child) { if (child) node.appendChild(typeof child === 'string' ? document.createTextNode(child) : child); });
    return node;
  }
  function options(list, current) {
    return list.map(function (item) { return el('option', { value: item[0], text: item[1], selected: String(item[0]) === String(current) ? 'selected' : null }); });
  }
  function api(url, method, body) {
    return fetch(url, {
      method: method || 'GET',
      credentials: 'same-origin',
      headers: { Accept: 'application/json', 'Content-Type': 'application/json', 'X-Requested-With': 'XMLHttpRequest' },
      body: body ? JSON.stringify(body) : undefined,
    }).then(function (res) {
      return res.json().catch(function () { return {}; }).then(function (json) {
        if (!res.ok || !json.success) throw new Error(json.error || json.message || "That didn't work. Try again.");
        return json;
      });
    });
  }
  var when = function (value) { return value ? new Date(value).toLocaleString(undefined, { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' }) : ''; };
  var base = function () { return '/common/report-builder/saved/' + encodeURIComponent(state.reportId) + '/state-file'; };

  // ---------------------------------------------------------------- window
  function open(reportId) {
    close();
    state = { reportId: reportId, tab: 'format', values: {}, check: null, dirty: false };
    var host = document.querySelector('.report-builder-page') || document.body;
    state.modal = el('div', { className: 'rb-modal sf-modal', on: { click: function (e) { if (e.target === state.modal) close(); } } }, [
      state.dialog = el('div', { className: 'rb-dialog sf-dialog', role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': 'sf-title' }, [
        el('div', { className: 'sf-head' }, [
          el('div', {}, [el('h3', { id: 'sf-title', text: 'State file' }), state.subtitle = el('p', { className: 'rb-muted', text: 'Loading…' })]),
          el('button', { type: 'button', className: 'sf-x', 'aria-label': 'Close', text: '×', on: { click: close } }),
        ]),
      ]),
    ]);
    host.appendChild(state.modal);
    // Below the app header, measured now (its height changes with the screen).
    var header = document.getElementById('top-header');
    if (header) {
      var bottom = Math.max(0, header.getBoundingClientRect().bottom);
      state.modal.style.paddingTop = (bottom + 12) + 'px';
      state.dialog.style.maxHeight = 'calc(100vh - ' + (bottom + 28) + 'px)';
    }
    document.addEventListener('keydown', escape);
    api(base()).then(function (data) {
      state.data = data;
      state.settings = data.settings;
      state.subtitle.textContent = data.report.name + ' · write it the way your state asks for it, check it, and keep every file you send.';
      build();
    }).catch(function (error) { state.subtitle.textContent = error.message; });
  }
  function close() {
    if (state && state.modal) state.modal.remove();
    document.removeEventListener('keydown', escape);
    state = null;
  }
  function escape(e) { if (e.key === 'Escape') close(); }

  function build() {
    var data = state.data;
    state.tabs = el('div', { className: 'sf-tabs', role: 'tablist' }, [
      tabButton('format', 'Format'), tabButton('fields', 'Fields'), tabButton('schedule', 'Schedule'),
      tabButton('files', 'Files' + (data.files.length ? ' (' + data.files.length + ')' : '')),
    ]);
    state.result = el('div', { className: 'sf-result', hidden: true });
    state.body = el('div', { className: 'sf-body' });
    state.status = el('p', { className: 'rb-modal-status sf-status', role: 'status' });
    var actions = el('div', { className: 'rb-dialog-actions sf-actions' }, [
      el('button', { type: 'button', className: 'rb-btn rb-btn-light', text: 'Check file', on: { click: check } }),
      data.canEdit ? el('button', { type: 'button', className: 'rb-btn rb-btn-light', text: 'Save', on: { click: function () { save().catch(function () {}); } } }) : null,
      el('button', { type: 'button', className: 'rb-btn rb-btn-primary', text: 'Make file now', on: { click: makeNow } }),
    ]);
    if (!data.canEdit) state.dialog.appendChild(el('p', { className: 'sf-note', text: 'Only the person who saved this report changes how its file is written. You can check it, make it and download it.' }));
    [state.tabs, state.result, state.body, state.status, actions].forEach(function (node) { state.dialog.appendChild(node); });
    show(state.tab);
  }
  function tabButton(key, label) {
    return el('button', { type: 'button', role: 'tab', className: 'sf-tab', 'data-tab': key, text: label, on: { click: function () { show(key); } } });
  }
  function show(tab) {
    state.tab = tab;
    Array.prototype.forEach.call(state.tabs.children, function (b) { var on = b.getAttribute('data-tab') === tab; b.classList.toggle('is-on', on); b.setAttribute('aria-selected', on ? 'true' : 'false'); });
    state.body.textContent = '';
    state.body.appendChild({ format: formatTab, fields: fieldsTab, schedule: scheduleTab, files: filesTab }[tab]());
  }
  function changed() { state.dirty = true; }
  var editable = function () { return state.data.canEdit; };

  // ---------------------------------------------------------------- Format
  function formatTab() {
    var s = state.settings;
    var choice = state.data.choices;
    function select(label, key, list, after) {
      return el('label', { className: 'rb-field' }, [label, el('select', { className: 'rb-input', disabled: !editable(), on: { change: function (e) { s[key] = e.target.value; changed(); if (after) after(); } } }, options(list, s[key]))]);
    }
    function check(label, key, hint) {
      return el('label', { className: 'rb-checkline' }, [el('input', { type: 'checkbox', checked: s[key], disabled: !editable(), on: { change: function (e) { s[key] = e.target.checked; changed(); } } }), ' ' + label, hint ? el('span', { className: 'rb-muted', text: ' · ' + hint }) : null]);
    }
    return el('div', { className: 'sf-grid' }, [
      select('Layout', 'layout', choice.layouts.map(function (k) { return [k, LAYOUT_LABELS[k] || k]; }), function () { show('format'); }),
      select('Dates', 'dateFormat', choice.dateFormats.map(function (k) { return [k, DATE_LABELS[k] || k]; })),
      s.layout === 'fixed' ? null : select('Quotes', 'quote', [['needed', 'Only when needed'], ['always', 'Around every value']]),
      select('Line endings', 'lineEnding', [['crlf', 'Windows (CRLF), most states'], ['lf', 'Unix (LF)']]),
      el('label', { className: 'rb-field sf-wide' }, ['File name',
        el('div', { className: 'sf-inline' }, [
          el('input', { className: 'rb-input', value: s.fileName, maxlength: '120', disabled: !editable(), on: { input: function (e) { s.fileName = e.target.value; changed(); } } }),
          el('select', { className: 'rb-input sf-ext', disabled: !editable(), on: { change: function (e) { s.extension = e.target.value; changed(); } } }, options(choice.extensions.map(function (x) { return [x, '.' + x]; }), s.extension)),
        ]),
        el('span', { className: 'rb-muted sf-hint', text: 'Use {school}, {report} and {date} (CCYYMMDD).' }),
      ]),
      el('div', { className: 'sf-wide sf-checks' }, [
        check('Header row', 'header', 'the field names on the first line'),
        check('Plain ASCII', 'ascii', 'accents dropped, as most state systems need'),
        check('CAPITAL LETTERS', 'upper'),
      ]),
    ]);
  }

  // ---------------------------------------------------------------- Fields
  function fieldsTab() {
    var s = state.settings;
    var fixed = s.layout === 'fixed';
    var presets = [['', 'None']].concat(state.data.choices.presets.map(function (p) { return [p.key, p.label]; }));
    var rows = state.data.columns.map(function (column) {
      var spec = s.columns[column.key];
      var editor = el('div', { className: 'sf-codes', hidden: true });
      var row = el('div', { className: 'sf-field' }, [
        el('div', { className: 'sf-field-name' }, [el('strong', { text: column.label }), el('span', { className: 'rb-muted', text: column.type === 'text' ? '' : column.type })]),
        el('input', { className: 'rb-input', placeholder: column.label, value: spec.name, maxlength: '80', 'aria-label': 'State field name for ' + column.label, disabled: !editable(), on: { input: function (e) { spec.name = e.target.value; changed(); } } }),
        fixed ? el('input', { className: 'rb-input sf-num', type: 'number', min: '1', max: '500', placeholder: 'Width', value: spec.width || '', 'aria-label': 'Width', disabled: !editable(), on: { input: function (e) { spec.width = Number(e.target.value) || null; changed(); } } }) : null,
        fixed ? el('select', { className: 'rb-input sf-pad', 'aria-label': 'Padding', disabled: !editable(), on: { change: function (e) { spec.pad = e.target.value; changed(); } } }, options([['auto', 'Auto'], ['spaces', 'Spaces'], ['zeros', 'Zeros']], spec.pad)) : null,
        el('select', { className: 'rb-input', 'aria-label': 'State codes', disabled: !editable(), on: { change: function (e) { spec.preset = e.target.value; changed(); } } }, options(presets, spec.preset)),
        el('label', { className: 'rb-checkline sf-req' }, [el('input', { type: 'checkbox', checked: spec.required, disabled: !editable(), on: { change: function (e) { spec.required = e.target.checked; changed(); } } }), ' Required']),
        el('button', { type: 'button', className: 'rb-btn rb-btn-light rb-btn-sm', text: Object.keys(spec.translations).length || spec.fixed ? 'Codes ✓' : 'Codes', on: { click: function () { editor.hidden = !editor.hidden; if (!editor.hidden) fillCodes(editor, column, spec); } } }),
      ]);
      return el('div', { className: 'sf-field-wrap' }, [row, editor]);
    });
    return el('div', {}, [
      el('p', { className: 'rb-muted sf-lead', text: 'Name each field the way your state\'s layout does, and turn your values into its codes (for example Female → F, Kindergarten → KG).' + (fixed ? ' Fixed-width files need a width for every field.' : '') }),
      el('div', { className: 'sf-fields' }, rows),
    ]);
  }
  function fillCodes(editor, column, spec) {
    editor.textContent = '';
    var found = state.values[column.key] || [];
    var known = Object.keys(spec.translations);
    var list = found.concat(known.filter(function (v) { return found.indexOf(v) === -1; }));
    var table = el('div', { className: 'sf-code-list' });
    function addRow(from) {
      table.appendChild(el('div', { className: 'sf-code-row' }, [
        el('span', { text: from }),
        el('span', { className: 'rb-muted', text: '→' }),
        el('input', { className: 'rb-input', value: spec.translations[from] || '', placeholder: 'State code', maxlength: '120', disabled: !editable(), on: { input: function (e) { if (e.target.value) spec.translations[from] = e.target.value; else delete spec.translations[from]; changed(); } } }),
      ]));
    }
    list.forEach(addRow);
    var custom = el('input', { className: 'rb-input', placeholder: 'Another value from this report', maxlength: '120', disabled: !editable() });
    editor.appendChild(el('p', { className: 'rb-muted', text: found.length ? 'Values found in this report:' : 'Select Check file to list the values this report holds, or add one below.' }));
    editor.appendChild(table);
    if (editable()) {
      editor.appendChild(el('div', { className: 'sf-inline' }, [custom, el('button', { type: 'button', className: 'rb-btn rb-btn-light rb-btn-sm', text: 'Add', on: { click: function () { var v = custom.value.trim(); if (v && !(v in spec.translations)) { spec.translations[v] = ''; addRow(v); custom.value = ''; changed(); } } } })]));
    }
    editor.appendChild(el('label', { className: 'rb-checkline' }, [el('input', { type: 'checkbox', checked: spec.onlyListed, disabled: !editable(), on: { change: function (e) { spec.onlyListed = e.target.checked; changed(); } } }), ' Flag any value without a code']));
    editor.appendChild(el('label', { className: 'rb-field' }, ['Same value in every row (optional, such as your district or school code)',
      el('input', { className: 'rb-input', value: spec.fixed, maxlength: '120', disabled: !editable(), on: { input: function (e) { spec.fixed = e.target.value; changed(); } } })]));
  }

  // ---------------------------------------------------------------- Schedule
  function scheduleTab() {
    var s = state.settings;
    var dates = el('div', { className: 'sf-dates' });
    function drawDates() {
      dates.textContent = '';
      s.dates.forEach(function (day, index) {
        dates.appendChild(el('div', { className: 'sf-inline' }, [
          el('input', { className: 'rb-input', type: 'date', value: day, disabled: !editable(), on: { change: function (e) { s.dates[index] = e.target.value; changed(); } } }),
          editable() ? el('button', { type: 'button', className: 'rb-btn rb-btn-light rb-btn-sm', text: 'Remove', on: { click: function () { s.dates.splice(index, 1); changed(); drawDates(); } } }) : null,
        ]));
      });
      if (!s.dates.length) dates.appendChild(el('p', { className: 'rb-muted', text: 'No count dates yet.' }));
    }
    drawDates();
    var repeatDetail = el('span', {});
    function drawRepeat() {
      repeatDetail.textContent = '';
      if (s.repeat === 'weekly') repeatDetail.appendChild(el('select', { className: 'rb-input', 'aria-label': 'Day of the week', disabled: !editable(), on: { change: function (e) { s.weekday = Number(e.target.value); changed(); } } }, options(WEEKDAYS.map(function (d, i) { return [i, d]; }), s.weekday)));
      if (s.repeat === 'monthly') repeatDetail.appendChild(el('select', { className: 'rb-input', 'aria-label': 'Day of the month', disabled: !editable(), on: { change: function (e) { s.monthDay = Number(e.target.value); changed(); } } }, options(Array.from({ length: 31 }, function (_, i) { return [i + 1, i + 1 === 31 ? '31 (or the last day)' : String(i + 1)]; }), s.monthDay)));
    }
    drawRepeat();
    var hours = Array.from({ length: 24 }, function (_, h) { return [h, (h % 12 || 12) + ':00 ' + (h < 12 ? 'AM' : 'PM')]; });
    return el('div', { className: 'sf-schedule' }, [
      el('h4', { text: 'Count dates' }),
      el('p', { className: 'rb-muted', text: 'The days your state counts students, such as the first Wednesday in October. On each date the file is made from that day\'s records.' }),
      dates,
      editable() && s.dates.length < state.data.choices.maxDates ? el('button', { type: 'button', className: 'rb-btn rb-btn-light rb-btn-sm', text: '+ Add a date', on: { click: function () { s.dates.push(new Date().toISOString().slice(0, 10)); changed(); drawDates(); } } }) : null,
      el('h4', { text: 'Repeat' }),
      el('div', { className: 'sf-inline' }, [
        el('select', { className: 'rb-input', 'aria-label': 'Repeat', disabled: !editable(), on: { change: function (e) { s.repeat = e.target.value; changed(); drawRepeat(); } } },
          options([['none', 'Only on the count dates'], ['weekdays', 'Every weekday (Monday to Friday)'], ['weekly', 'Every week on'], ['monthly', 'Every month on day']], s.repeat)),
        repeatDetail,
      ]),
      el('label', { className: 'rb-field' }, ['Time (school time)', el('select', { className: 'rb-input sf-hour', disabled: !editable(), on: { change: function (e) { s.sendHour = Number(e.target.value); changed(); } } }, options(hours, s.sendHour))]),
      el('div', { className: 'sf-callout' }, [
        el('strong', { text: 'What happens' }),
        el('p', { text: 'The file is made automatically, checked, and kept locked in Managira for a year. You, and the people this report is shared with who have State Reporting, get an email that it\'s ready, with no student data in it. Download it here (your password is asked) and upload it to the state\'s portal.' }),
      ]),
    ]);
  }

  // ---------------------------------------------------------------- Files
  function filesTab() {
    var files = state.data.files;
    if (!files.length) return el('p', { className: 'rb-muted sf-lead', text: 'No files yet. Check the file, then select Make file now, or set count dates on the Schedule tab.' });
    return el('div', { className: 'sf-files' }, files.map(fileCard));
  }
  function fileCard(file) {
    var msg = el('p', { className: 'rb-modal-status' });
    var actions = el('div', { className: 'sf-inline' });
    var card = el('div', { className: 'sf-file' }, [
      el('div', { className: 'sf-file-top' }, [
        el('div', {}, [el('strong', { text: file.fileName }), el('span', { className: 'rb-muted', text: (file.forDate ? ' · for ' + file.forDate : '') })]),
        el('span', { className: 'sf-pill' + (file.submittedAt ? ' is-sent' : ''), text: file.submittedAt ? 'Sent to the state' : 'Not sent yet' }),
      ]),
      el('p', { className: 'rb-muted', text: [
        file.rows.toLocaleString() + ' rows',
        file.problems ? file.problems + ' to check' : 'nothing to fix',
        (file.automatic ? 'made on schedule' : 'made by ' + file.madeBy) + ' ' + when(file.madeAt),
        file.downloads ? 'downloaded ' + file.downloads + '×, last by ' + file.lastDownloadedBy : 'not downloaded yet',
        'fingerprint ' + file.fingerprint,
      ].join(' · ') }),
      file.submittedAt ? el('p', { className: 'rb-muted', text: 'Sent ' + when(file.submittedAt) + ' by ' + file.submittedBy + (file.submittedReference ? ' · reference ' + file.submittedReference : '') }) : null,
      actions,
      msg,
    ]);
    var password = el('input', { className: 'rb-input', type: 'password', autocomplete: 'current-password', placeholder: 'Your password', 'aria-label': 'Your password' });
    var download = el('button', { type: 'button', className: 'rb-btn rb-btn-primary rb-btn-sm', text: 'Download', disabled: !file.available, on: { click: function () { downloadFile(file, password, download, msg); } } });
    if (file.available) actions.appendChild(password);
    actions.appendChild(download);
    if (!file.available) msg.textContent = 'The content was removed after a year; the record stays.';
    var reference = el('input', { className: 'rb-input', placeholder: 'State reference (optional)', maxlength: '120' });
    if (file.submittedAt) {
      actions.appendChild(el('button', { type: 'button', className: 'rb-btn rb-btn-light rb-btn-sm', text: 'Not sent', on: { click: function () { markSent(file, { undo: true }, msg); } } }));
    } else {
      actions.appendChild(reference);
      actions.appendChild(el('button', { type: 'button', className: 'rb-btn rb-btn-light rb-btn-sm', text: 'Mark as sent', on: { click: function () { markSent(file, { reference: reference.value }, msg); } } }));
    }
    password.addEventListener('keydown', function (e) { if (e.key === 'Enter') { e.preventDefault(); download.click(); } });
    return card;
  }
  function downloadFile(file, password, button, msg) {
    if (!password.value) { msg.textContent = 'Enter your password to download.'; password.focus(); return; }
    button.disabled = true;
    msg.textContent = '';
    fetch('/common/report-builder/state-files/' + file.id + '/download', {
      method: 'POST', credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json', 'X-Requested-With': 'XMLHttpRequest' },
      body: JSON.stringify({ password: password.value }),
    }).then(function (res) {
      if (!res.ok) return res.json().catch(function () { return {}; }).then(function (json) { throw new Error(json.error || 'That didn\'t work.'); });
      return res.blob().then(function (blob) {
        var link = el('a', { href: URL.createObjectURL(blob), download: file.fileName });
        document.body.appendChild(link); link.click(); link.remove();
        setTimeout(function () { URL.revokeObjectURL(link.href); }, 4000);
        password.value = '';
        msg.textContent = 'Downloaded. Upload it to your state\'s portal, then mark it as sent.';
        return refreshFiles();
      });
    }).catch(function (error) { msg.textContent = error.message; }).then(function () { button.disabled = false; });
  }
  function markSent(file, body, msg) {
    api('/common/report-builder/state-files/' + file.id + '/submitted', 'POST', body)
      .then(function (json) { state.data.files = json.files; show('files'); })
      .catch(function (error) { msg.textContent = error.message; });
  }
  function refreshFiles() {
    return api(base()).then(function (data) { if (!state) return; state.data.files = data.files; if (state.tab === 'files') show('files'); });
  }

  // ---------------------------------------------------------------- actions
  function save() {
    state.status.textContent = 'Saving…';
    return api(base(), 'PUT', { settings: state.settings }).then(function (json) {
      state.settings = json.settings; state.dirty = false;
      state.status.textContent = 'Saved.';
      show(state.tab);
    }).catch(function (error) { state.status.textContent = error.message; throw error; });
  }
  function check() {
    state.status.textContent = 'Checking…';
    api(base() + '/check', 'POST', { settings: state.settings }).then(function (json) {
      state.values = json.values || {};
      state.status.textContent = '';
      showResult(json);
      if (state.tab === 'fields') show('fields');
    }).catch(function (error) { state.status.textContent = error.message; });
  }
  function showResult(json) {
    var r = state.result;
    r.textContent = '';
    r.hidden = false;
    r.className = 'sf-result' + (json.problems.length ? ' has-problems' : ' is-clean');
    r.appendChild(el('strong', { text: json.rows.toLocaleString() + ' rows · ' + (json.problems.length ? json.problems.length + ' to check before you send it' : 'ready to send') }));
    if (json.problems.length) r.appendChild(el('ul', {}, json.problems.slice(0, 12).map(function (p) { return el('li', { text: p.text }); })));
    if (json.preview) r.appendChild(el('details', {}, [el('summary', { text: 'First lines of the file' }), el('pre', { text: json.preview })]));
  }
  function makeNow() {
    var go = function () {
      state.status.textContent = 'Making the file…';
      return api(base() + '/make', 'POST', {}).then(function (json) {
        state.status.textContent = json.problems.length ? 'Made, with ' + json.problems.length + ' to check. It\'s on the Files tab.' : 'Made. It\'s on the Files tab, ready to download.';
        return refreshFiles().then(function () { show('files'); });
      }).catch(function (error) { state.status.textContent = error.message; });
    };
    if (state.dirty && editable()) save().then(go).catch(function () {});
    else go();
  }

  document.addEventListener('click', function (event) {
    var button = event.target.closest('[data-state-file]');
    if (!button || !button.dataset.reportId) return;
    event.preventDefault();
    open(button.dataset.reportId);
  });
})();
