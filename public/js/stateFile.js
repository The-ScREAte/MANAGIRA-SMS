// Report Builder › Gov/state report (controllers/stateReportingController.js, utils/stateFile.js).
// A Gov/state report is made from a SAVED report: the report picks the students and the columns; this
// window only decides how the file is written for the state (file type, field names, codes), then
// checks it, makes it and keeps it. Written for people who aren't technical: three plain steps,
// with the rarely needed settings tucked under "More options". Text goes in as text, never markup.
(function () {
  'use strict';

  var TYPES = [
    { key: 'comma', name: 'CSV', note: 'Commas between fields. The most common, and it opens in Excel.' },
    { key: 'tab', name: 'Tab-separated', note: 'A tab between fields.' },
    { key: 'pipe', name: 'Pipe ( | )', note: 'A | between fields.' },
    { key: 'fixed', name: 'Fixed width', note: 'Each field has an exact number of characters, as your state’s layout lists.' },
  ];
  var DATE_LABELS = { YYYYMMDD: '20261007 (CCYYMMDD)', 'YYYY-MM-DD': '2026-10-07', 'MM/DD/YYYY': '10/07/2026', MMDDYYYY: '10072026', 'MM-DD-YYYY': '10-07-2026' };
  var WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
  var STEPS = [['type', '1. File type'], ['fields', '2. Fields'], ['check', '3. Check & make'], ['schedule', 'Schedule & send'], ['files', 'Files made']];
  var state = null;

  // ---------------------------------------------------------------- small helpers
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
  var editable = function () { return state.data.canEdit; };
  function changed() { state.dirty = true; state.check = null; if (state.saveButton) state.saveButton.disabled = false; }

  // ---------------------------------------------------------------- the window
  function shell(title, subtitle) {
    close();
    var host = document.querySelector('.report-builder-page') || document.body;
    var s = state = { tab: 'type', values: {}, check: null, dirty: false };
    s.modal = el('div', { className: 'rb-modal sf-modal', on: {} }, [
      s.dialog = el('div', { className: 'rb-dialog sf-dialog', role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': 'sf-title' }, [
        el('div', { className: 'sf-head' }, [
          el('div', {}, [el('h3', { id: 'sf-title', text: title }), s.subtitle = el('p', { className: 'rb-muted', text: subtitle })]),
          el('button', { type: 'button', className: 'sf-x', 'aria-label': 'Close', text: '×', on: { click: close } }),
        ]),
      ]),
    ]);
    host.appendChild(s.modal);
    // Below the app header, measured now (its height changes with the screen).
    var header = document.getElementById('top-header');
    if (header) {
      var bottom = Math.max(0, header.getBoundingClientRect().bottom);
      s.modal.style.paddingTop = (bottom + 12) + 'px';
      s.dialog.style.maxHeight = 'calc(100vh - ' + (bottom + 28) + 'px)';
    }
    document.addEventListener('keydown', escape);
    return s;
  }
  function close() {
    if (state && state.modal) state.modal.remove();
    document.removeEventListener('keydown', escape);
    state = null;
  }
  function escape(e) { if (e.key === 'Escape') close(); }

  // A report that isn't saved yet: say what a state file is and how to start.
  function saveFirst() {
    var s = shell('Save the report first', 'A Gov/state report is made from a saved report.');
    s.dialog.appendChild(el('div', { className: 'sf-explain' }, [
      el('p', { text: 'The report decides what goes in the file: which students and which columns. The Gov/state report then writes it the way your state asks for it (CSV or fixed width, the state’s field names and codes), and sends it to the people you choose.' }),
      el('p', { text: 'Save this report, then select Gov/state report again. You can also start from any report in My reports.' }),
    ]));
    s.dialog.appendChild(el('div', { className: 'rb-dialog-actions' }, [
      el('button', { type: 'button', className: 'rb-btn rb-btn-light', text: 'Close', on: { click: close } }),
      el('button', { type: 'button', className: 'rb-btn rb-btn-primary', text: 'Save the report', on: { click: function () {
        close();
        var save = document.querySelector('[data-step-panel="5"] [data-open-modal="save"]');
        if (save) save.click();
      } } }),
    ]));
  }

  function open(reportId) {
    var s = shell('Gov/state report', 'Loading…');
    s.reportId = reportId;
    api(base()).then(function (data) {
      if (state !== s) return;
      s.data = data;
      s.settings = data.settings;
      s.subtitle.textContent = 'Made from your saved report “' + data.report.name + '” (' + data.report.title + ', ' + data.columns.length + ' columns).';
      build();
    }).catch(function (error) { if (state === s) s.subtitle.textContent = error.message; });
  }

  function build() {
    var s = state;
    s.dialog.appendChild(el('div', { className: 'sf-how' }, [
      el('strong', { text: 'How it works: ' }),
      el('span', { text: 'the report picks the students and columns. Here you choose how the file is written for your state, check it, make it, and choose who it’s sent to.' }),
    ]));
    s.tabs = el('div', { className: 'sf-tabs', role: 'tablist' }, STEPS.map(function (step) {
      return el('button', { type: 'button', role: 'tab', className: 'sf-tab', 'data-tab': step[0], text: step[0] === 'files' && s.data.files.length ? step[1] + ' (' + s.data.files.length + ')' : step[1], on: { click: function () { show(step[0]); } } });
    }));
    s.body = el('div', { className: 'sf-body' });
    s.status = el('p', { className: 'rb-modal-status sf-status', role: 'status' });
    s.next = el('button', { type: 'button', className: 'rb-btn rb-btn-primary', text: 'Next', on: { click: function () {
      var order = ['type', 'fields', 'check'];
      var at = order.indexOf(s.tab);
      show(order[Math.min(at + 1, order.length - 1)]);
    } } });
    s.saveButton = editable() ? el('button', { type: 'button', className: 'rb-btn rb-btn-light', text: 'Save', disabled: true, on: { click: function () { save().catch(function () {}); } } }) : null;
    var actions = el('div', { className: 'rb-dialog-actions sf-actions' }, [
      s.status,
      el('button', { type: 'button', className: 'rb-btn rb-btn-light', text: 'Close', on: { click: close } }),
      s.saveButton,
      s.next,
    ]);
    if (!editable()) s.dialog.appendChild(el('p', { className: 'sf-note', text: 'Only the person who saved this report changes how its file is written. You can check it, make it and download it.' }));
    [s.tabs, s.body, actions].forEach(function (node) { s.dialog.appendChild(node); });
    // Someone returning to a report already set up starts at the check; a new one at step 1.
    show(s.data.configured ? 'check' : 'type');
  }
  function show(tab) {
    var s = state;
    s.tab = tab;
    Array.prototype.forEach.call(s.tabs.children, function (b) { var on = b.getAttribute('data-tab') === tab; b.classList.toggle('is-on', on); b.setAttribute('aria-selected', on ? 'true' : 'false'); });
    s.next.hidden = !(tab === 'type' || tab === 'fields');
    s.body.textContent = '';
    s.body.appendChild({ type: typeTab, fields: fieldsTab, check: checkTab, schedule: scheduleTab, files: filesTab }[tab]());
    s.body.scrollTop = 0;
  }

  // ---------------------------------------------------------------- 1. File type
  function typeTab() {
    var s = state.settings;
    var cards = el('div', { className: 'sf-types', role: 'radiogroup', 'aria-label': 'File type' }, TYPES.map(function (type) {
      return el('button', { type: 'button', role: 'radio', 'aria-checked': s.layout === type.key ? 'true' : 'false', className: 'sf-type' + (s.layout === type.key ? ' is-on' : ''), disabled: !editable(), on: { click: function () {
        // Fixed-width files usually have no field-name line; the others usually do.
        if (type.key === 'fixed' && s.layout !== 'fixed') s.header = false;
        if (type.key !== 'fixed' && s.layout === 'fixed') s.header = true;
        s.layout = type.key;
        if (type.key === 'comma' && s.extension === 'txt') s.extension = 'csv';
        if (type.key !== 'comma' && s.extension === 'csv') s.extension = 'txt';
        changed(); show('type');
      } } }, [el('strong', { text: type.name }), el('span', { text: type.note })]);
    }));
    function check(label, key) {
      return el('label', { className: 'rb-checkline' }, [el('input', { type: 'checkbox', checked: s[key], disabled: !editable(), on: { change: function (e) { s[key] = e.target.checked; changed(); } } }), ' ' + label]);
    }
    var more = el('details', { className: 'sf-more' }, [
      el('summary', { text: 'More options' }),
      el('div', { className: 'sf-grid' }, [
        s.layout === 'fixed' ? null : el('label', { className: 'rb-field' }, ['Quotes', el('select', { className: 'rb-input', disabled: !editable(), on: { change: function (e) { s.quote = e.target.value; changed(); } } }, options([['needed', 'Only when a value needs them'], ['always', 'Around every value']], s.quote))]),
        el('label', { className: 'rb-field' }, ['Line endings', el('select', { className: 'rb-input', disabled: !editable(), on: { change: function (e) { s.lineEnding = e.target.value; changed(); } } }, options([['crlf', 'Windows (most states)'], ['lf', 'Unix']], s.lineEnding))]),
        el('label', { className: 'rb-field sf-wide' }, ['File name',
          el('div', { className: 'sf-inline' }, [
            el('input', { className: 'rb-input', value: s.fileName, maxlength: '120', disabled: !editable(), on: { input: function (e) { s.fileName = e.target.value; changed(); } } }),
            el('select', { className: 'rb-input sf-ext', 'aria-label': 'Ending', disabled: !editable(), on: { change: function (e) { s.extension = e.target.value; changed(); } } }, options(state.data.choices.extensions.map(function (x) { return [x, '.' + x]; }), s.extension)),
          ]),
          el('span', { className: 'rb-muted sf-hint', text: '{school}, {report} and {date} are filled in for you.' }),
        ]),
        el('div', { className: 'sf-wide sf-checks' }, [check('Plain letters only (accents removed, as most states need)', 'ascii'), check('ALL CAPITALS', 'upper')]),
      ]),
    ]);
    return el('div', { className: 'sf-step' }, [
      el('p', { className: 'sf-lead', text: 'Your state’s instructions say which file type to send. If you’re not sure, CSV is the most common.' }),
      cards,
      el('div', { className: 'sf-grid' }, [
        el('label', { className: 'rb-field' }, ['Dates look like', el('select', { className: 'rb-input', disabled: !editable(), on: { change: function (e) { s.dateFormat = e.target.value; changed(); } } }, options(state.data.choices.dateFormats.map(function (k) { return [k, DATE_LABELS[k] || k]; }), s.dateFormat))]),
        el('div', { className: 'sf-checks sf-align' }, [check('First line lists the field names', 'header')]),
      ]),
      more,
    ]);
  }

  // ---------------------------------------------------------------- 2. Fields
  function fieldsTab() {
    var s = state.settings;
    var fixed = s.layout === 'fixed';
    var presets = [['', 'None']].concat(state.data.choices.presets.map(function (p) { return [p.key, p.label]; }));
    var head = el('div', { className: 'sf-field sf-field-head' + (fixed ? '' : ' no-width') }, [
      el('span', { text: 'From the report' }), el('span', { text: 'Name in the state’s file' }), fixed ? el('span', { text: 'Characters' }) : null, el('span', { text: 'State codes' }), el('span', { text: '' }),
    ]);
    var rows = state.data.columns.map(function (column) {
      var spec = s.columns[column.key];
      var editor = el('div', { className: 'sf-codes', hidden: true });
      var codesButton = el('button', { type: 'button', className: 'rb-btn rb-btn-light rb-btn-sm', text: Object.keys(spec.translations).length || spec.fixed ? 'More ✓' : 'More', title: 'Your own codes, a value for every row, and whether the state requires it', on: { click: function () { editor.hidden = !editor.hidden; if (!editor.hidden) fillCodes(editor, column, spec); } } });
      var row = el('div', { className: 'sf-field' + (fixed ? '' : ' no-width') }, [
        el('div', { className: 'sf-field-name' }, [el('strong', { text: column.label }), spec.required ? el('span', { className: 'sf-tag', text: 'Required' }) : null]),
        el('input', { className: 'rb-input', placeholder: column.label, value: spec.name, maxlength: '80', 'aria-label': 'Name in the state’s file for ' + column.label, disabled: !editable(), on: { input: function (e) { spec.name = e.target.value; changed(); } } }),
        fixed ? el('input', { className: 'rb-input sf-num', type: 'number', min: '1', max: '500', placeholder: '10', value: spec.width || '', 'aria-label': 'Characters for ' + column.label, disabled: !editable(), on: { input: function (e) { spec.width = Number(e.target.value) || null; changed(); } } }) : null,
        el('select', { className: 'rb-input', 'aria-label': 'State codes for ' + column.label, disabled: !editable(), on: { change: function (e) { spec.preset = e.target.value; changed(); } } }, options(presets, spec.preset)),
        codesButton,
      ]);
      return el('div', { className: 'sf-field-wrap' }, [row, editor]);
    });
    return el('div', { className: 'sf-step' }, [
      el('p', { className: 'sf-lead', text: 'Your state’s layout lists the name' + (fixed ? ' and the number of characters' : '') + ' of each field. Leave a name empty to use the report’s own. To change which columns are in the file, or their order, change the report.' }),
      el('div', { className: 'sf-fields' }, [head].concat(rows)),
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
        el('input', { className: 'rb-input', value: spec.translations[from] || '', placeholder: 'State code', maxlength: '120', 'aria-label': 'State code for ' + from, disabled: !editable(), on: { input: function (e) { if (e.target.value) spec.translations[from] = e.target.value; else delete spec.translations[from]; changed(); } } }),
      ]));
    }
    list.forEach(addRow);
    editor.appendChild(el('label', { className: 'rb-checkline' }, [el('input', { type: 'checkbox', checked: spec.required, disabled: !editable(), on: { change: function (e) { spec.required = e.target.checked; changed(); } } }), ' The state requires this field (the check flags it when empty)']));
    editor.appendChild(el('p', { className: 'rb-muted', text: found.length ? 'Your own codes for the values in this report:' : 'Run the check (step 3) to list the values in this report, or add one below.' }));
    editor.appendChild(table);
    if (editable()) {
      var custom = el('input', { className: 'rb-input', placeholder: 'A value from the report', maxlength: '120' });
      editor.appendChild(el('div', { className: 'sf-inline' }, [custom, el('button', { type: 'button', className: 'rb-btn rb-btn-light rb-btn-sm', text: 'Add', on: { click: function () { var v = custom.value.trim(); if (v && !(v in spec.translations)) { spec.translations[v] = ''; addRow(v); custom.value = ''; changed(); } } } })]));
    }
    editor.appendChild(el('label', { className: 'rb-checkline' }, [el('input', { type: 'checkbox', checked: spec.onlyListed, disabled: !editable(), on: { change: function (e) { spec.onlyListed = e.target.checked; changed(); } } }), ' Flag any value that has no code']));
    editor.appendChild(el('label', { className: 'rb-field' }, ['The same value in every row (optional, such as your school or district number)',
      el('input', { className: 'rb-input', value: spec.fixed, maxlength: '120', disabled: !editable(), on: { input: function (e) { spec.fixed = e.target.value; changed(); } } })]));
    if (state.settings.layout === 'fixed') {
      editor.appendChild(el('label', { className: 'rb-field' }, ['Fill short values with', el('select', { className: 'rb-input sf-pad', disabled: !editable(), on: { change: function (e) { spec.pad = e.target.value; changed(); } } }, options([['auto', 'Zeros for numbers, spaces for text'], ['spaces', 'Spaces'], ['zeros', 'Zeros']], spec.pad))]));
    }
  }

  // ---------------------------------------------------------------- 3. Check & make
  function checkTab() {
    var box = el('div', { className: 'sf-step' });
    var result = el('div', {});
    var checkButton = el('button', { type: 'button', className: 'rb-btn rb-btn-light', text: state.check ? 'Check again' : 'Check the file', on: { click: function () { runCheck(result, checkButton); } } });
    var makeButton = el('button', { type: 'button', className: 'rb-btn rb-btn-primary', text: 'Make the file', on: { click: function () { makeNow(makeButton); } } });
    box.appendChild(el('p', { className: 'sf-lead', text: 'Check the file before you make it: you’ll see how many students are in it, anything to fix, and the first rows exactly as the state will get them. Checking saves and sends nothing.' }));
    box.appendChild(el('div', { className: 'sf-inline' }, [checkButton, makeButton]));
    box.appendChild(result);
    if (state.check) drawResult(result, state.check); else runCheck(result, checkButton);
    return box;
  }
  function runCheck(result, button) {
    result.textContent = '';
    result.appendChild(el('p', { className: 'rb-muted', text: 'Checking…' }));
    if (button) button.disabled = true;
    api(base() + '/check', 'POST', { settings: state.settings }).then(function (json) {
      if (!state) return;
      state.values = json.values || {};
      state.check = json;
      drawResult(result, json);
      if (button) { button.disabled = false; button.textContent = 'Check again'; }
    }).catch(function (error) {
      result.textContent = '';
      result.appendChild(el('p', { className: 'sf-result has-problems', text: error.message }));
      if (button) button.disabled = false;
    });
  }
  function drawResult(result, json) {
    result.textContent = '';
    var clean = !json.problems.length;
    result.appendChild(el('div', { className: 'sf-result ' + (clean ? 'is-clean' : 'has-problems') }, [
      el('strong', { text: clean ? '✓ Ready: ' + json.rows.toLocaleString() + (json.rows === 1 ? ' row' : ' rows') + ', nothing to fix.' : json.rows.toLocaleString() + ' rows. ' + json.problems.length + (json.problems.length === 1 ? ' thing' : ' things') + ' to look at before you send it:' }),
      clean ? null : el('ul', {}, json.problems.slice(0, 12).map(function (p) { return el('li', { text: p.text }); })),
      el('span', { className: 'sf-file-name', text: 'File: ' + (json.fileName || '') }),
    ]));
    if (json.sample && json.sample.rows.length) {
      result.appendChild(el('p', { className: 'sf-sub', text: json.header === false ? 'First rows, as they’ll be in the file (the file has no line of field names; they’re shown here to help you read it)' : 'First rows, as they’ll be in the file, starting with the line of field names' }));
      result.appendChild(el('div', { className: 'sf-table-wrap' }, [el('table', { className: 'sf-table' }, [
        el('thead', {}, [el('tr', {}, json.sample.header.map(function (h) { return el('th', { text: h }); }))]),
        el('tbody', {}, json.sample.rows.map(function (row) { return el('tr', {}, row.map(function (v) { return el('td', { text: v }); })); })),
      ])]));
    }
    if (json.preview) result.appendChild(el('details', { className: 'sf-more' }, [el('summary', { text: 'Show the file as plain text' }), el('pre', { className: 'sf-pre', text: json.preview })]));
  }
  function makeNow(button) {
    var go = function () {
      state.status.textContent = 'Making the file…';
      button.disabled = true;
      return api(base() + '/make', 'POST', {}).then(function (json) {
        if (!state) return;
        var hasList = (state.settings.recipients || []).length;
        state.status.textContent = (json.problems.length ? 'Made, with ' + json.problems.length + ' to look at. ' : 'Made. ') + (hasList ? 'Send it or download it below.' : 'Download it below.');
        return refreshFiles().then(function () { show('files'); });
      }).catch(function (error) { if (state) state.status.textContent = error.message; }).then(function () { button.disabled = false; });
    };
    if ((state.dirty || !state.data.configured) && editable()) save().then(go).catch(function () {});
    else go();
  }

  // ---------------------------------------------------------------- Schedule
  function scheduleTab() {
    var s = state.settings;
    var dates = el('div', { className: 'sf-dates' });
    function drawDates() {
      dates.textContent = '';
      s.dates.forEach(function (day, index) {
        dates.appendChild(el('div', { className: 'sf-inline' }, [
          el('input', { className: 'rb-input sf-date', type: 'date', value: day, 'aria-label': 'Count date', disabled: !editable(), on: { change: function (e) { s.dates[index] = e.target.value; changed(); } } }),
          editable() ? el('button', { type: 'button', className: 'rb-btn rb-btn-light rb-btn-sm', text: 'Remove', on: { click: function () { s.dates.splice(index, 1); changed(); drawDates(); } } }) : null,
        ]));
      });
      if (!s.dates.length) dates.appendChild(el('p', { className: 'rb-muted', text: 'No dates yet.' }));
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
    // Who it's sent to: email addresses, each shown with a remove button.
    var people = el('div', { className: 'sf-people' });
    var addInput = el('input', { className: 'rb-input', type: 'email', placeholder: 'name@state.gov', maxlength: '254', 'aria-label': 'Email address to send it to', disabled: !editable() });
    var addMsg = el('p', { className: 'rb-modal-status' });
    function drawPeople() {
      people.textContent = '';
      s.recipients.forEach(function (email, index) {
        people.appendChild(el('span', { className: 'sf-chip' }, [
          el('span', { text: email }),
          editable() ? el('button', { type: 'button', className: 'sf-chip-x', 'aria-label': 'Remove ' + email, text: '×', on: { click: function () { s.recipients.splice(index, 1); changed(); drawPeople(); } } }) : null,
        ]));
      });
      if (!s.recipients.length) people.appendChild(el('span', { className: 'rb-muted', text: 'Nobody yet: only you (and the people this report is shared with) are told when it’s ready.' }));
    }
    function addPerson() {
      var email = addInput.value.trim().toLowerCase();
      addMsg.textContent = '';
      if (!/^[^@\s"<>,;]+@[^@\s"<>,;]+\.[a-z]{2,}$/i.test(email)) { addMsg.textContent = 'Type a full email address.'; return; }
      if (s.recipients.indexOf(email) !== -1) { addInput.value = ''; return; }
      if (s.recipients.length >= 10) { addMsg.textContent = 'Up to 10 people.'; return; }
      s.recipients.push(email); addInput.value = ''; changed(); drawPeople();
    }
    addInput.addEventListener('keydown', function (e) { if (e.key === 'Enter') { e.preventDefault(); addPerson(); } });
    drawPeople();
    return el('div', { className: 'sf-step sf-schedule' }, [
      el('p', { className: 'sf-lead', text: 'Choose who gets the report, and Managira can make and send it for you on the days your state wants it.' }),
      el('h4', { text: 'Send it to' }),
      people,
      editable() ? el('div', { className: 'sf-inline' }, [addInput, el('button', { type: 'button', className: 'rb-btn rb-btn-light rb-btn-sm', text: 'Add', on: { click: addPerson } })]) : null,
      addMsg,
      el('div', { className: 'sf-callout' }, [
        el('strong', { text: 'How each person gets it' }),
        el('p', { text: 'The file is never attached to an email. Staff at your school get a link to sign in and download it. Anyone else, such as your state or district data office, gets a secure link that works for 7 days and a 6-digit code in a separate email. You see every download in Files made.' }),
      ]),
      el('h4', { text: 'On these dates' }),
      el('p', { className: 'rb-muted', text: 'Such as your state’s count day (often the first Wednesday in October). The file holds that day’s records.' }),
      dates,
      editable() && s.dates.length < state.data.choices.maxDates ? el('button', { type: 'button', className: 'rb-btn rb-btn-light rb-btn-sm', text: '+ Add a date', on: { click: function () { s.dates.push(new Date().toISOString().slice(0, 10)); changed(); drawDates(); } } }) : null,
      el('h4', { text: 'And repeat' }),
      el('div', { className: 'sf-inline' }, [
        el('select', { className: 'rb-input', 'aria-label': 'Repeat', disabled: !editable(), on: { change: function (e) { s.repeat = e.target.value; changed(); drawRepeat(); } } },
          options([['none', 'No, only on the dates above'], ['weekdays', 'Every weekday (Monday to Friday)'], ['weekly', 'Every week on'], ['monthly', 'Every month on day']], s.repeat)),
        repeatDetail,
      ]),
      el('label', { className: 'rb-field' }, ['At', el('select', { className: 'rb-input sf-hour', disabled: !editable(), on: { change: function (e) { s.sendHour = Number(e.target.value); changed(); } } }, options(hours, s.sendHour))]),
      editable() ? el('p', { className: 'rb-muted', text: 'Select Save to keep who it goes to and when.' }) : null,
    ]);
  }

  // ---------------------------------------------------------------- Files made
  function filesTab() {
    var files = state.data.files;
    if (!files.length) return el('div', { className: 'sf-step' }, [el('p', { className: 'sf-lead', text: 'No files yet. Go to 3. Check & make, or set dates on Schedule.' })]);
    return el('div', { className: 'sf-step' }, [
      el('p', { className: 'sf-lead', text: 'Each file is kept safely in Managira for a year. Send it to the people on your list, or download it (your password is asked) and upload it to your state’s portal, then mark it as sent.' }),
      el('div', { className: 'sf-files' }, files.map(fileCard)),
    ]);
  }
  function fileCard(file) {
    var msg = el('p', { className: 'rb-modal-status' });
    var actions = el('div', { className: 'sf-inline' });
    var card = el('div', { className: 'sf-file' }, [
      el('div', { className: 'sf-file-top' }, [
        el('strong', { text: file.fileName }),
        el('span', { className: 'sf-pill' + (file.submittedAt || (file.sentTo || []).length ? ' is-sent' : ''), text: file.submittedAt ? 'Sent to the state' : (file.sentTo || []).length ? 'Emailed to ' + new Set(file.sentTo.map(function (r) { return r.email; })).size : 'Not sent yet' }),
      ]),
      el('p', { className: 'rb-muted', text: [
        file.rows.toLocaleString() + ' rows',
        file.problems ? file.problems + ' to look at' : 'nothing to fix',
        (file.automatic ? 'made on schedule' : 'made by ' + file.madeBy) + ', ' + when(file.madeAt),
        file.downloads ? 'downloaded in Managira ' + file.downloads + (file.downloads === 1 ? ' time' : ' times') : '',
      ].filter(Boolean).join(' · ') }),
      file.submittedAt ? el('p', { className: 'rb-muted', text: 'Sent ' + when(file.submittedAt) + ' by ' + file.submittedBy + (file.submittedReference ? ' · reference ' + file.submittedReference : '') }) : null,
      (file.sentTo || []).length ? el('p', { className: 'rb-muted', text: 'Emailed to: ' + file.sentTo.map(function (r) { return r.email + (r.downloads ? ' (downloaded ' + r.downloads + (r.downloads === 1 ? ' time)' : ' times)') : r.locked ? ' (link locked)' : ' (not downloaded yet)'); }).join(', ') }) : null,
      actions,
      msg,
    ]);
    var list = state.settings.recipients || [];
    if (file.available && list.length) {
      actions.appendChild(el('button', { type: 'button', className: 'rb-btn rb-btn-light rb-btn-sm', text: 'Send to ' + list.length + (list.length === 1 ? ' person' : ' people'), title: list.join(', '), on: { click: function (e) { sendFile(file, e.currentTarget, msg); } } }));
    }
    var password = el('input', { className: 'rb-input', type: 'password', autocomplete: 'current-password', placeholder: 'Your password', 'aria-label': 'Your password' });
    var download = el('button', { type: 'button', className: 'rb-btn rb-btn-primary rb-btn-sm', text: 'Download', disabled: !file.available, on: { click: function () { downloadFile(file, password, download, msg); } } });
    if (file.available) actions.appendChild(password);
    actions.appendChild(download);
    if (!file.available) msg.textContent = 'This file was removed after a year; its record stays.';
    if (file.submittedAt) {
      actions.appendChild(el('button', { type: 'button', className: 'rb-btn rb-btn-light rb-btn-sm', text: 'Not sent after all', on: { click: function () { markSent(file, { undo: true }, msg); } } }));
    } else {
      var reference = el('input', { className: 'rb-input', placeholder: 'State’s reference (optional)', maxlength: '120', 'aria-label': 'State’s reference' });
      actions.appendChild(reference);
      actions.appendChild(el('button', { type: 'button', className: 'rb-btn rb-btn-light rb-btn-sm', text: 'Mark as sent', on: { click: function () { markSent(file, { reference: reference.value }, msg); } } }));
    }
    password.addEventListener('keydown', function (e) { if (e.key === 'Enter') { e.preventDefault(); download.click(); } });
    return card;
  }
  function downloadFile(file, password, button, msg) {
    if (!password.value) { msg.textContent = 'Type your password to download.'; password.focus(); return; }
    button.disabled = true;
    msg.textContent = '';
    fetch('/common/report-builder/state-files/' + file.id + '/download', {
      method: 'POST', credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json', 'X-Requested-With': 'XMLHttpRequest' },
      body: JSON.stringify({ password: password.value }),
    }).then(function (res) {
      if (!res.ok) return res.json().catch(function () { return {}; }).then(function (json) { throw new Error(json.error || 'That didn’t work.'); });
      return res.blob().then(function (blob) {
        var link = el('a', { href: URL.createObjectURL(blob), download: file.fileName });
        document.body.appendChild(link); link.click(); link.remove();
        setTimeout(function () { URL.revokeObjectURL(link.href); }, 4000);
        password.value = '';
        msg.textContent = 'Downloaded. Upload it to your state’s portal, then select Mark as sent.';
        return refreshFiles(true);
      });
    }).catch(function (error) { msg.textContent = error.message; }).then(function () { button.disabled = false; });
  }
  function sendFile(file, button, msg) {
    button.disabled = true;
    msg.textContent = 'Sending…';
    api('/common/report-builder/state-files/' + file.id + '/send', 'POST', {}).then(function (json) {
      state.data.files = json.files;
      show('files');
      var count = json.sent.staff.length + json.sent.outside.length;
      state.status.textContent = 'Sent to ' + count + (count === 1 ? ' person' : ' people') + '.';
    }).catch(function (error) { msg.textContent = error.message; button.disabled = false; });
  }
  function markSent(file, body, msg) {
    api('/common/report-builder/state-files/' + file.id + '/submitted', 'POST', body)
      .then(function (json) { state.data.files = json.files; show('files'); })
      .catch(function (error) { msg.textContent = error.message; });
  }
  function refreshFiles(keep) {
    return api(base()).then(function (data) {
      if (!state) return;
      state.data.files = data.files;
      var tab = state.tabs.querySelector('[data-tab="files"]');
      if (tab) tab.textContent = 'Files made' + (data.files.length ? ' (' + data.files.length + ')' : '');
      if (!keep && state.tab === 'files') show('files');
    });
  }

  function save() {
    state.status.textContent = 'Saving…';
    return api(base(), 'PUT', { settings: state.settings }).then(function (json) {
      state.settings = json.settings; state.dirty = false; state.data.configured = true;
      if (state.saveButton) state.saveButton.disabled = true;
      state.status.textContent = 'Saved.';
    }).catch(function (error) { state.status.textContent = error.message; throw error; });
  }

  // A link from an email (…/report-builder?stateFile=<id>) opens the report's window.
  var linked = new URLSearchParams(location.search).get('stateFile');
  if (linked && /^\d+$/.test(linked)) setTimeout(function () { open(linked); }, 300);

  document.addEventListener('click', function (event) {
    var button = event.target.closest('[data-state-file]');
    if (!button) return;
    event.preventDefault();
    var id = button.dataset.reportId || button.dataset.stateFile;
    if (id) open(id); else saveFirst();
  });
})();
