// The Custom editor (Management Tools › Custom editor, feature custom_forms).
// First the sections, lined up. Create New Section offers ready school forms or a blank one.
// An open section shows where it lives, how it's collected and its fields; the rest sits under
// More options. Save sends it all; the server cleans it (utils/customForms.js).
(function () {
  'use strict';
  var R = window.CustomFormRender;
  var app = document.getElementById('cf-app');
  if (!R || !app) return;
  var icon = R.icon;
  var esc = R.esc;
  var boot = JSON.parse(document.getElementById('cf-boot').textContent || '{}');
  var listEl = document.getElementById('cf-sections');
  var state = { sections: boot.sections || [], openId: null, current: null, original: null, pickClasses: false };
  var TYPES = boot.types || [];
  var typeOf = {};
  TYPES.forEach(function (t) { typeOf[t.key] = t; });
  var classById = {};
  (boot.classes || []).forEach(function (c) { classById[c.id] = c; });

  var PLACES = [
    { key: 'staff', label: 'Classroom', icon: 'staff', short: 'Teachers fill it in' },
    { key: 'parent', label: 'Parent portal', icon: 'parent', short: 'Parents fill it in' },
    { key: 'student', label: 'Student portal', icon: 'student', short: 'Students fill it in' },
    { key: 'driver', label: 'Driver portal', icon: 'bus', short: 'For students on their bus' }
  ];
  // How often a section is collected. "many" is a list that grows.
  // How often a section is collected: once, or many times, and then how often.
  var COLLECT = [
    { key: 'one', label: 'Once', text: 'One answer per student.' },
    { key: 'many', label: 'Many times', text: '' }
  ];
  var EVERY = [
    { key: 'day', label: 'Every day', text: 'One answer per student each day, like a lunch count.' },
    { key: 'week', label: 'Every week', text: 'One answer per student each week.' },
    { key: 'term', label: 'Every term', text: 'One answer per student, asked again each term.' },
    { key: 'year', label: 'Every year', text: 'One answer per student, asked again each school year.' },
    { key: 'any', label: 'Any time', text: 'A list that grows: add an entry whenever something happens, like a log.' }
  ];
  var CHANNELS = boot.channels || {};
  // Where a section shows when it has a tile of its own (otherwise it sits under Forms).
  var OWN_TILE = {
    staff: 'In Class Tools, by its name. Without this it sits under Forms.',
    parent: 'On the child’s page, by its name. Without this it sits under Forms.',
    student: 'On the student’s dashboard, by its name. Without this it sits under Forms.',
    driver: 'A card of its own on the driver’s page. Without this it sits under Forms.'
  };
  // Choices that no longer fit what the section now is are switched off (the server does the same).
  function tidy(s) {
    if (s.multiple) { s.once = false; s.reportCard = false; }
    if (s.protected || s.repeat === 'day' || s.repeat === 'week') s.reportCard = false;
    if (s.filledBy !== 'staff' || s.repeat !== 'day') s.attendance = false;
    if (s.filledBy !== 'parent') s.via = { email: false, sms: false, whatsapp: false };
    if (s.filledBy !== 'parent' && s.filledBy !== 'student') { s.dueDate = null; s.required = false; }
  }
  // The answers as a report: Report Builder, on this form, with its fields as columns.
  function openReport(id) {
    var page = '/common/report-builder?type=custom_answers&form=' + id;
    var url = '/common/reports?panel=report-builder&page=' + encodeURIComponent(page) + '&label=' + encodeURIComponent('Report Builder');
    try { window.top.location.href = url; } catch (_e) { window.location.href = url; }
  }
  function collectOf(s) { return s.multiple || s.repeat ? 'many' : 'one'; }
  function everyOf(s) { return s.multiple ? 'any' : s.repeat || ''; }
  function collectLabel(s) {
    var every = EVERY.filter(function (x) { return x.key === s.repeat; })[0];
    return (s.multiple ? 'Many times' : every ? every.label : 'Once') + (s.once && !s.multiple ? ', locked' : '');
  }
  // Only tap-to-answer fields, a few of them: such a section can be filled in for a whole class
  // on one screen (the same rule as the server's quickFields).
  function isQuick(s) {
    var fields = (s.fields || []).filter(function (f) { return !f.retired && f.type !== 'instructions'; });
    return !s.multiple && fields.length > 0 && fields.length <= 4 && fields.every(function (f) { return ['yesno', 'choice', 'rating', 'seat'].indexOf(f.type) !== -1 && !f.cond; });
  }
  var placeOf = function (key) { return PLACES.filter(function (p) { return p.key === key; })[0] || PLACES[0]; };

  // ── Helpers ───────────────────────────────────────────────────────────────────────────
  function uid(prefix) {
    var s = '';
    while (s.length < 8) s += Math.random().toString(36).slice(2);
    return prefix + '_' + s.replace(/[^a-z0-9]/g, '').slice(0, 8);
  }
  function keyFrom(label) {
    var raw = String(label || '').trim();
    if (/^[A-Za-z][A-Za-z0-9]{0,39}$/.test(raw)) return raw[0].toLowerCase() + raw.slice(1);
    var words = raw.replace(/[^\w\s]/g, ' ').trim().split(/[\s_]+/).filter(Boolean).slice(0, 6);
    var key = words.map(function (w, i) { return i ? w[0].toUpperCase() + w.slice(1).toLowerCase() : w.toLowerCase(); }).join('').replace(/^\d+/, '');
    return key.slice(0, 40) || 'field';
  }
  function clone(o) { return JSON.parse(JSON.stringify(o)); }
  function snapshot() { return JSON.stringify(state.current); }
  function isDirty() { return Boolean(state.current) && snapshot() !== state.original; }
  function plural(n, word, many) { return n + ' ' + (n === 1 ? word : (many || word + 's')); }
  function toast(text, error) {
    var t = document.createElement('div');
    t.className = 'cf-toast' + (error ? ' cf-toast--error' : '');
    t.setAttribute('role', 'status');
    t.innerHTML = icon(error ? 'alert' : 'check', 16) + '<span></span>';
    t.querySelector('span').textContent = text;
    document.body.appendChild(t);
    setTimeout(function () { t.remove(); }, 3600);
  }
  function post(url, body) {
    return fetch(url, {
      method: 'POST', credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify(body || {})
    }).then(function (res) {
      return res.json().catch(function () { return {}; }).then(function (json) {
        if (!res.ok || !json.success) throw new Error(json.error || 'Something went wrong. Try again.');
        return json;
      });
    });
  }
  function inputFields(section) { return (section.fields || []).filter(function (f) { return f.type !== 'instructions' && !f.retired; }); }
  function F(type, label, extra) {
    return Object.assign({ id: uid('f'), type: type, label: label, key: keyFrom(label), help: '', required: false, retired: false, width: 'full', notes: '', cond: null }, extra || {});
  }
  // ── The school form library: ready forms for what Managira doesn't already do ──────────
  // (Pickup details, bus reports, bus requests and attendance have their own pages.)
  function show(field, value) { return { action: 'show', field: field.id, op: 'is', value: value }; }
  function inDays(n) { var d = new Date(); d.setDate(d.getDate() + n); return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); }
  var LEVELS = ['Excellent', 'Good', 'Satisfactory', 'Needs improvement'];
  var LIBRARY = [
    { group: 'Report card', items: [
      { name: 'Skills & effort', icon: 'star', filledBy: 'staff', repeat: 'term', reportCard: true, build: function () {
        return [F('choice', 'Effort', { options: LEVELS, width: 'half' }), F('choice', 'Participation', { options: LEVELS, width: 'half' }),
          F('choice', 'Homework', { options: LEVELS, width: 'half' }), F('choice', 'Punctuality', { options: LEVELS, width: 'half' }),
          F('choice', 'Works well with others', { options: LEVELS, width: 'half' }), F('choice', 'Follows instructions', { options: LEVELS, width: 'half' })];
      } },
      { name: 'Student reflection', icon: 'chat', filledBy: 'student', repeat: 'term', showParents: true, build: function () {
        return [F('textarea', 'What I am proud of this term', { required: true }), F('textarea', 'What I want to get better at'), F('rating', 'How I feel about school')];
      } }
    ] },
    { group: 'Health', items: [
      { name: 'Medical & allergies', icon: 'health', filledBy: 'parent', repeat: 'year', required: true, build: function () {
        var a = F('yesno', 'Does your child have any allergies?', { required: true });
        var m = F('yesno', 'Does your child take medicine at school?');
        return [a, F('textarea', 'Allergy details', { required: true, help: 'What they are allergic to and what happens.', cond: show(a, 'yes') }),
          m, F('textarea', 'Medicine, dose and times', { cond: show(m, 'yes') }),
          F('text', 'Doctor’s name', { width: 'half' }), F('phone', 'Doctor’s phone', { width: 'half' }), F('file', 'Care plan (if any)')];
      } },
      { name: 'Medication authorization', icon: 'medicine', filledBy: 'parent', multiple: true, build: function () {
        return [F('text', 'Medicine', { required: true }), F('text', 'Dose', { width: 'half', required: true }), F('time', 'Time to give it', { width: 'half' }),
          F('date', 'Start date', { width: 'half', required: true }), F('date', 'End date', { width: 'half' }), F('textarea', 'Instructions for the nurse'),
          F('file', 'Doctor’s note'), F('signature', 'Parent signature', { required: true })];
      } },
      { name: 'Immunization record', icon: 'shield', filledBy: 'parent', repeat: 'year', build: function () {
        return [F('file', 'Immunization record', { required: true, help: 'A photo or PDF from your doctor.' }), F('date', 'Date of last update', { width: 'half' }), F('textarea', 'Anything to add')];
      } },
      { name: 'Health office visit', icon: 'heart', filledBy: 'staff', multiple: true, build: function () {
        return [F('date', 'Date', { width: 'half', required: true }), F('time', 'Time', { width: 'half' }),
          F('choice', 'Reason', { options: ['Injury', 'Illness', 'Medication', 'Other'], display: 'buttons', required: true }),
          F('textarea', 'What was done'), F('yesno', 'Sent home?', { width: 'half' }), F('yesno', 'Parents called?', { width: 'half' })];
      } }
    ] },
    { group: 'Permissions', items: [
      { name: 'Field trip permission', icon: 'consent', filledBy: 'parent', once: true, required: true, dueDate: inDays(14), build: function () {
        var go = F('choice', 'May your child go on the trip?', { options: ['Yes', 'No'], display: 'buttons', required: true });
        return [F('instructions', 'About the trip', { help: 'Where we are going, when we leave and come back, the cost and what to bring.' }), go,
          F('textarea', 'Anything we should know?', { cond: show(go, 'Yes') }), F('phone', 'Phone number on the day', { cond: show(go, 'Yes') }),
          F('signature', 'Parent signature', { required: true })];
      } },
      { name: 'Photo & media consent', icon: 'camera', filledBy: 'parent', repeat: 'year', build: function () {
        return [F('choice', 'Photos of my child may be used', { options: ['On the school website and social media', 'Inside school only', 'Not at all'], display: 'buttons', required: true }),
          F('signature', 'Parent signature', { required: true })];
      } },
      { name: 'Handbook acknowledgement', icon: 'book', filledBy: 'parent', once: true, repeat: 'year', required: true, build: function () {
        return [F('instructions', 'Family handbook', { help: 'Please read this year’s family handbook before signing.' }),
          F('yesno', 'I have read the handbook and agree to follow it', { required: true }), F('signature', 'Parent signature', { required: true })];
      } },
      { name: 'Device agreement', icon: 'laptop', filledBy: 'student', once: true, repeat: 'year', build: function () {
        return [F('instructions', 'Using school devices', { help: 'I will look after my device, use it for school work and follow the school’s online safety rules.' }),
          F('yesno', 'I agree to the device rules', { required: true }), F('signature', 'Your name', { required: true })];
      } }
    ] },
    { group: 'Requests from parents', items: [
      { name: 'Absence note', icon: 'calendar', filledBy: 'parent', multiple: true, build: function () {
        return [F('date', 'First day absent', { width: 'half', required: true }), F('date', 'Last day absent', { width: 'half' }),
          F('choice', 'Reason', { options: ['Illness', 'Medical appointment', 'Family reason', 'Other'], required: true }), F('textarea', 'Details'), F('file', 'Doctor’s note (if any)')];
      } },
      { name: 'Early dismissal request', icon: 'flag', filledBy: 'parent', multiple: true, build: function () {
        return [F('date', 'Date', { width: 'half', required: true }), F('time', 'Pickup time', { width: 'half', required: true }),
          F('text', 'Who will pick up', { required: true }), F('textarea', 'Reason')];
      } },
      { name: 'Meeting request', icon: 'meeting', filledBy: 'parent', multiple: true, build: function () {
        return [F('choice', 'Topic', { options: ['Progress', 'Behavior', 'Well-being', 'Something else'], width: 'half', required: true }),
          F('date', 'Preferred date', { width: 'half', required: true }), F('time', 'Preferred time', { width: 'half' }),
          F('choice', 'How would you like to meet?', { options: ['In person', 'Video call', 'Phone call'], display: 'buttons' }), F('textarea', 'What would you like to talk about?')];
      } }
    ] },
    { group: 'Every day in class', items: [
      { name: 'Lunch count', icon: 'lunch', filledBy: 'staff', repeat: 'day', attendance: true, build: function () {
        return [F('choice', 'Lunch', { options: ['School lunch', 'Packed lunch', 'No lunch'], display: 'icons', icons: { 'School lunch': 'lunch', 'Packed lunch': 'bag', 'No lunch': 'none' }, required: true })];
      } },
      { name: 'Seating chart', icon: 'seat', filledBy: 'staff', repeat: 'term', tile: true, build: function () {
        return [F('seat', 'Seat')];
      } },
      { name: 'Student groups', icon: 'groups', filledBy: 'staff', repeat: 'term', build: function () {
        return [F('choice', 'Group', { options: ['Group 1', 'Group 2', 'Group 3', 'Group 4'], help: 'Rename these: reading groups, project teams, houses.' })];
      } },
      { name: 'Lunch order', icon: 'apple', filledBy: 'parent', repeat: 'week', build: function () {
        return [F('choice', 'Lunch this week', { options: ['School lunch every day', 'Some days', 'Bringing lunch from home'], display: 'icons', icons: { 'School lunch every day': 'lunch', 'Some days': 'time', 'Bringing lunch from home': 'bag' }, required: true }), F('textarea', 'Allergies or notes for the kitchen')];
      } }
    ] },
    { group: 'Classroom records', items: [
      { name: 'Behavior log', icon: 'behaviour', filledBy: 'staff', multiple: true, build: function () {
        var type = F('choice', 'Type', { options: ['Positive', 'Concern', 'Incident'], display: 'buttons', required: true });
        return [F('date', 'Date', { width: 'half', required: true }), F('yesno', 'Parents told?', { width: 'half' }), type,
          F('textarea', 'What happened', { required: true }), F('textarea', 'What was done', { cond: { action: 'hide', field: type.id, op: 'is', value: 'Positive' } })];
      } },
      { name: 'Reading log', icon: 'book', filledBy: 'student', multiple: true, showParents: true, build: function () {
        return [F('text', 'Book title', { required: true }), F('date', 'Date', { width: 'half' }), F('number', 'Pages read', { width: 'half' }),
          F('rating', 'How much did you like it?'), F('textarea', 'What was it about?')];
      } },
      { name: 'Support plan', icon: 'clipboard', filledBy: 'staff', repeat: 'year', protected: true, build: function () {
        return [F('choice', 'Plan', { options: ['IEP', '504 plan', 'Behavior plan', 'Health plan', 'Other'], width: 'half', required: true }), F('date', 'Next review', { width: 'half' }),
          F('textarea', 'Goals and supports'), F('file', 'Plan document')];
      } }
    ] },
    { group: 'Sign-ups & surveys', items: [
      { name: 'Club & sports sign-up', icon: 'trophy', filledBy: 'parent', once: true, build: function () {
        return [F('choice', 'Activity', { options: ['Soccer', 'Basketball', 'Chess club', 'Choir', 'Robotics'], required: true, help: 'Change these to your school’s activities.' }),
          F('choice', 'T-shirt size', { options: ['Youth S', 'Youth M', 'Youth L', 'Adult S', 'Adult M', 'Adult L'], width: 'half' }),
          F('textarea', 'Anything the coach should know?'), F('signature', 'Parent signature', { required: true })];
      } },
      { name: 'Volunteer sign-up', icon: 'heart', filledBy: 'parent', repeat: 'year', build: function () {
        return [F('checklist', 'I can help with', { options: ['Field trips', 'Classroom reading', 'Events', 'Fundraising', 'Sports'], required: true }), F('phone', 'Best phone number'), F('textarea', 'Anything to add')];
      } },
      { name: 'Family survey', icon: 'survey', filledBy: 'parent', once: true, repeat: 'year', build: function () {
        return [F('rating', 'How is this year going for your child?', { required: true }), F('textarea', 'What is going well?'),
          F('textarea', 'What could we do better?'), F('yesno', 'May we contact you about your answers?')];
      } }
    ] }
  ];
  function fromLibrary(t) {
    return Object.assign(blank(), {
      name: t.name, icon: t.icon, filledBy: t.filledBy, multiple: Boolean(t.multiple), once: Boolean(t.once), repeat: t.repeat || '', reportCard: Boolean(t.reportCard),
      attendance: Boolean(t.attendance), tile: Boolean(t.tile),
      protected: Boolean(t.protected), required: Boolean(t.required), dueDate: t.dueDate || null,
      showParents: t.filledBy === 'parent' || Boolean(t.showParents), showStudents: t.filledBy === 'student', fields: t.build()
    });
  }
  function chooser() {
    var m = modal({
      title: 'New section', size: 'wide', foot: false, focus: false,
      body: '<button type="button" class="cf-libcard cf-libcard--blank" data-lib="blank"><span class="cf-libcard__icon">' + icon('plus', 18) + '</span><span><strong>Blank section</strong><small>Add your own fields</small></span></button>'
        + LIBRARY.map(function (g, gi) {
          return '<p class="cf-libgroup">' + g.group + '</p><div class="cf-libgrid">' + g.items.map(function (t, ti) {
            return '<button type="button" class="cf-libcard" data-lib="' + gi + ':' + ti + '"><span class="cf-libcard__icon">' + icon(t.icon, 18) + '</span><span><strong>' + esc(t.name) + '</strong><small>' + esc(placeOf(t.filledBy).label + ' · ' + collectLabel(t)) + '</small></span></button>';
          }).join('') + '</div>';
        }).join('')
    });
    m.body.addEventListener('click', function (e) {
      var b = e.target.closest('[data-lib]');
      if (!b) return;
      m.close();
      var key = b.getAttribute('data-lib');
      if (key === 'blank') return createNew(blank());
      var parts = key.split(':');
      createNew(fromLibrary(LIBRARY[Number(parts[0])].items[Number(parts[1])]));
    });
  }

  function blank() {
    return { id: null, name: '', icon: 'form', notes: '', multiple: false, once: false, repeat: '', reportCard: false, tile: false, attendance: false, tell: { teacher: true, builders: false }, via: { email: false, sms: false, whatsapp: false }, filledBy: 'staff', classIds: [], showParents: false, showStudents: false, protected: false, required: false, dueDate: null, status: 'live', fields: [], entries: 0 };
  }

  // ── Modal ─────────────────────────────────────────────────────────────────────────────
  function modal(opts) {
    var wrap = document.createElement('div');
    wrap.className = 'cfm';
    wrap.innerHTML = '<div class="cfm__box' + (opts.size ? ' cfm__box--' + opts.size : '') + '" role="dialog" aria-modal="true" aria-labelledby="cfm-title">'
      + '<div class="cfm__head"><h2 id="cfm-title"></h2><button type="button" class="cfm__close" data-close aria-label="Close">' + icon('close') + '</button></div>'
      + '<div class="cfm__body"></div>'
      + (opts.foot === false ? '' : '<div class="cfm__foot"></div>') + '</div>';
    wrap.querySelector('#cfm-title').textContent = opts.title || '';
    wrap.querySelector('.cfm__body').innerHTML = opts.body || '';
    if (opts.foot !== false) wrap.querySelector('.cfm__foot').innerHTML = opts.foot || '';
    function close() { wrap.remove(); document.removeEventListener('keydown', onKey); if (opts.onClose) opts.onClose(); }
    function onKey(e) { if (e.key === 'Escape' && !document.querySelector('.cf-drawer')) close(); }
    wrap.addEventListener('mousedown', function (e) { if (e.target === wrap) close(); });
    wrap.addEventListener('click', function (e) { var c = e.target.closest('[data-close]'); if (c && c.closest('.cfm') === wrap) close(); });
    document.addEventListener('keydown', onKey);
    document.body.appendChild(wrap);
    var first = wrap.querySelector('.cfm__body input:not([type=hidden]), .cfm__body select, .cfm__body textarea');
    if (first && opts.focus !== false) setTimeout(function () { first.focus(); }, 30);
    return { el: wrap, body: wrap.querySelector('.cfm__body'), foot: wrap.querySelector('.cfm__foot'), close: close };
  }
  function confirmBox(title, text, okText, danger) {
    return new Promise(function (resolve) {
      var done = false;
      var m = modal({
        title: title, size: 'narrow', body: '<p style="margin:0;color:var(--cf-muted)"></p>',
        foot: '<span class="cf-spacer"></span><button type="button" class="cf-btn" data-close>Cancel</button><button type="button" class="cf-btn ' + (danger ? 'cf-btn--danger' : 'cf-btn--primary') + '" data-ok></button>',
        onClose: function () { if (!done) resolve(false); }
      });
      m.body.querySelector('p').textContent = text;
      m.foot.querySelector('[data-ok]').textContent = okText;
      m.foot.querySelector('[data-ok]').addEventListener('click', function () { done = true; m.close(); resolve(true); });
    });
  }

  // ── The list of sections ──────────────────────────────────────────────────────────────
  function classesLabel(s) {
    if (!s.classIds || !s.classIds.length) return 'All classes';
    if (s.classIds.length === 1) return (classById[s.classIds[0]] || {}).name || '1 class';
    return plural(s.classIds.length, 'class', 'classes');
  }
  function metaLine(s) {
    return [placeOf(s.filledBy).label, classesLabel(s), collectLabel(s), plural((s.fields || []).length, 'field'), s.entries ? plural(s.entries, 'answer') : ''].filter(Boolean).join(' · ');
  }
  function render() {
    var rows = state.sections.slice();
    if (state.openId === 'new') rows.unshift(state.current);
    if (!rows.length) {
      listEl.innerHTML = '<div class="cf-empty-list cf-ed__empty"><strong>No sections yet</strong>Start from a ready school form, or build your own.<br><button type="button" class="cf-btn cf-btn--primary" data-act="new" style="margin-top:14px">Create New Section</button></div>';
      return;
    }
    listEl.innerHTML = rows.map(function (s, index) {
      var open = (state.openId === 'new' && s === state.current) || (s.id && s.id === state.openId);
      return open ? openHtml() : cardHtml(s, index, rows.length);
    }).join('');
    if (state.current) bindOpen();
  }
  function cardHtml(s, index, total) {
    var live = s.status === 'live';
    return '<article class="cf-sec" data-id="' + s.id + '">'
      + '<button type="button" class="cf-sec__head" data-open="' + s.id + '"><span class="cf-sec__icon">' + icon(s.icon, 20) + '</span>'
      + '<span class="cf-sec__text"><strong>' + esc(s.name) + (live ? '<span class="cf-pill cf-pill--live">Live</span>' : '<span class="cf-pill">Hidden</span>') + '</strong><em>' + esc(metaLine(s)) + '</em></span></button>'
      + '<div class="cf-sec__tools">'
      + (s.reportCard ? '<span class="cf-pill cf-pill--accent">Report card</span>' : '')
      + (s.tile ? '<span class="cf-pill">Own tile</span>' : '')
      + (s.attendance ? '<span class="cf-pill">Attendance</span>' : '')
      + (s.protected ? '<span class="cf-pill" title="Only people who build forms can open it">' + icon('lock', 11) + 'Protected</span>' : '')
      + '<button type="button" class="cf-tool" data-responses="' + s.id + '" title="Answers" aria-label="Answers to ' + esc(s.name) + '">' + icon('list', 18) + '</button>'
      + '<button type="button" class="cf-tool" data-report="' + s.id + '" title="Report: its answers in Report Builder" aria-label="Report on ' + esc(s.name) + '">' + icon('report', 18) + '</button>'
      + '<button type="button" class="cf-tool' + (live ? ' is-live' : '') + '" data-visible="' + s.id + '" title="' + (live ? 'Live: people see it. Click to hide it.' : 'Hidden. Click to make it live.') + '" aria-label="' + (live ? 'Hide' : 'Make live') + '">' + icon(live ? 'eye' : 'eyeOff', 18) + '</button>'
      + '<span class="cf-move"><button type="button" data-move="' + s.id + ':-1"' + (index === 0 ? ' disabled' : '') + ' aria-label="Move up">' + icon('caretUp', 14) + '</button>'
      + '<button type="button" data-move="' + s.id + ':1"' + (index === total - 1 ? ' disabled' : '') + ' aria-label="Move down">' + icon('caretDown', 14) + '</button></span>'
      + '</div></article>';
  }

  // ── An open section: where it lives, how it's collected, its fields ────────────────────
  function row(label, body) {
    return '<div class="cf-prop"><div class="cf-prop__label">' + label + '</div><div class="cf-prop__body">' + body + '</div></div>';
  }
  function seg(attr, current, options) {
    return '<div class="cf-seg" role="radiogroup">' + options.map(function (o) {
      return '<button type="button" ' + attr + '="' + o[0] + '" role="radio" aria-checked="' + (current === o[0]) + '" aria-pressed="' + (current === o[0]) + '">' + o[1] + '</button>';
    }).join('') + '</div>';
  }
  function check(key, checked, label, small) {
    return '<label class="cf-check"><input type="checkbox" data-bind-check="' + key + '"' + (checked ? ' checked' : '') + ' /><span>' + label + (small ? '<small>' + small + '</small>' : '') + '</span></label>';
  }
  function openHtml() {
    var s = state.current;
    var portal = s.filledBy === 'parent' || s.filledBy === 'student';
    var collect = collectOf(s);
    var classMode = s.classIds.length || state.pickClasses ? 'some' : 'all';
    var wasLive = s.id && (state.sections.filter(function (x) { return x.id === s.id; })[0] || {}).status === 'live';
    var live = s.status === 'live';
    var daily = s.repeat === 'day';
    var counted = daily || s.repeat === 'week';
    var hears = s.filledBy !== 'staff' || s.multiple;
    var moreOpen = state.moreOpen || s.dueDate || s.required || s.protected || s.notes || s.reportCard || s.tile || s.attendance
      || s.via.email || s.via.sms || s.via.whatsapp || s.tell.builders || !s.tell.teacher || (!portal && (s.showParents || s.showStudents));
    var more = (portal ? row('Deadline', '<div class="cf-inline"><input type="date" class="cf-input cf-input--auto" data-bind="dueDate" value="' + esc(s.dueDate || '') + '" aria-label="Due date" />'
        + check('required', s.required, 'Required', s.filledBy === 'parent' ? 'Families are reminded 2 days before' : '') + '</div>') : '')
      // Families hear on their bell; the school chooses what else (text and WhatsApp only when it has them).
      + (s.filledBy === 'parent' ? row('Tell families by', '<div class="cf-inline"><label class="cf-check"><input type="checkbox" checked disabled /><span>Notification</span></label>'
        + check('via.email', s.via.email, 'Email') + (CHANNELS.sms ? check('via.sms', s.via.sms, 'Text message') : '') + (CHANNELS.whatsapp ? check('via.whatsapp', s.via.whatsapp, 'WhatsApp') : '')
        + '</div><p class="cf-hint">When it goes live and when you send a reminder.' + (CHANNELS.sms || CHANNELS.whatsapp ? ' Texts and WhatsApp go through your school’s own account.' : '') + '</p>') : '')
      + (hears ? row('When it’s sent, tell', '<div class="cf-inline">' + (s.filledBy !== 'staff' ? check('tell.teacher', s.tell.teacher, 'The class’s main teacher') : '')
        + check('tell.builders', s.tell.builders, 'People who build forms') + '</div>') : '')
      + row('Who sees the answers', '<div class="cf-inline"><label class="cf-check"><input type="checkbox" checked disabled /><span>' + (s.protected ? 'People who build forms' : 'The class’s teachers') + '</span></label>'
        + (!portal ? check('showParents', s.showParents, 'Parents') + check('showStudents', s.showStudents, 'Students') : '') + '</div>'
        + '<div style="margin-top:8px">' + check('protected', s.protected, 'Keep it from teachers', 'Only people who build forms can open it') + '</div>')
      + (s.filledBy === 'staff' && daily ? row('Attendance', check('attendance', s.attendance, 'Add it to the attendance page', 'A column beside each student for today. Shows Yes / No, dropdown and rating fields.')) : '')
      + (!s.multiple && !s.protected && !counted ? row('Report card', check('reportCard', s.reportCard, 'Show on report cards', 'Prints each student’s answers for the term')) : '')
      + row('Its own tile', check('tile', s.tile, 'Give it a tile of its own', OWN_TILE[s.filledBy]))
      + row('Notes', '<textarea class="cf-input" rows="2" data-bind="notes" maxlength="2000" placeholder="Only people who build forms see this">' + esc(s.notes || '') + '</textarea>');
    var every = everyOf(s);
    return '<article class="cf-sec is-open">'
      + '<div class="cf-sec__bar"><button type="button" class="cf-iconbtn" data-act="icon" title="Change the icon" aria-label="Change the icon">' + icon(s.icon, 20) + '</button>'
      + '<input class="cf-nameinput" data-bind="name" maxlength="120" placeholder="Name this section" value="' + esc(s.name) + '" aria-label="Section name" />'
      + '<label class="cf-switch" title="Live sections show to the people they’re for"><input type="checkbox" data-live' + (live ? ' checked' : '') + ' /><span class="cf-switch__track"></span><span>' + (live ? 'Live' : 'Hidden') + '</span></label>'
      + '<button type="button" class="cf-btn cf-btn--sm" data-act="close">Cancel</button>'
      + '<button type="button" class="cf-btn cf-btn--primary cf-btn--sm" data-act="save">Save</button></div>'
      + (live && !wasLive && s.filledBy === 'parent' ? '<div class="cf-sec__note">' + icon('bell', 15) + '<span>Families are notified when you save.' + (s.via.email || s.via.sms || s.via.whatsapp ? ' Also by ' + [s.via.email ? 'email' : '', s.via.sms ? 'text' : '', s.via.whatsapp ? 'WhatsApp' : ''].filter(Boolean).join(', ') + '.' : '') + '</span></div>' : '')
      + '<div class="cf-props">'
      + row('Lives in', '<div class="cf-places">' + PLACES.map(function (p) {
        return '<button type="button" class="cf-place" data-place="' + p.key + '" aria-pressed="' + (s.filledBy === p.key) + '"><span class="cf-place__icon">' + icon(p.icon, 17) + '</span><span><strong>' + p.label + '</strong><small>' + p.short + '</small></span></button>';
      }).join('') + '</div>')
      + row('Classes', seg('data-classes', classMode, [['all', 'All classes'], ['some', 'Choose classes']]) + (classMode === 'some' ? classPicker(s) : ''))
      + row('Collect', seg('data-collect', collect, COLLECT.map(function (x) { return [x.key, x.label]; }))
        + (collect === 'many' ? '<div style="margin-top:8px">' + seg('data-every', every, EVERY.map(function (x) { return [x.key, x.label]; })) + '</div>' : '')
        + '<p class="cf-hint">' + (collect === 'many' ? (EVERY.filter(function (x) { return x.key === every; })[0] || {}).text || '' : COLLECT[0].text) + '</p>'
        + (s.multiple ? '' : '<div style="margin-top:8px">' + check('once', s.once, 'Lock after it’s sent', 'It can’t be changed, and leaves their list') + '</div>')
        + (isQuick(s) && s.filledBy === 'staff' ? '<p class="cf-hint cf-hint--good">' + icon('bolt', 14) + ' Quick to fill in: teachers answer for the whole class on one screen.</p>' : ''))
      + '</div>'
      + '<div class="cf-block"><div class="cf-block__head"><h3>Fields <span class="cf-count">' + s.fields.length + '</span></h3>'
      + '<span class="cf-spacer"></span>' + (s.fields.length ? '<button type="button" class="cf-btn cf-btn--sm" data-act="preview">' + icon('eye', 15) + 'Preview</button>' : '')
      + '<button type="button" class="cf-btn cf-btn--sm cf-btn--primary" data-act="add-field">' + icon('plus', 15) + 'Add field</button></div>'
      + (s.fields.length ? '<ul class="cf-fieldlist" id="cf-fieldlist">' + s.fields.map(function (f, i) {
        var t = typeOf[f.type] || { label: f.type };
        return '<li class="cf-fieldrow' + (f.retired ? ' cf-fieldrow--retired' : '') + '" draggable="true" data-index="' + i + '" tabindex="0">'
          + '<span class="cf-grip" aria-hidden="true">⠿</span><span class="cf-ftype">' + icon(f.type, 15) + '</span>'
          + '<span class="cf-fieldrow__main"><strong>' + esc(f.label) + ' <span>(' + esc(t.label) + ')</span></strong></span>'
          + '<span class="cf-fieldrow__flags">' + fieldFlags(f) + '</span></li>';
      }).join('') + '</ul>' : '<div class="cf-empty-list cf-empty-list--fields">No fields yet. <button type="button" class="cf-link" data-act="add-field">Add the first field</button></div>')
      + '</div>'
      + '<details class="cf-more"' + (moreOpen ? ' open' : '') + '><summary>More options</summary><div class="cf-props">' + more + '</div></details>'
      + '<div class="cf-sec__foot">' + (s.id ? '<button type="button" class="cf-link cf-link--danger" data-act="delete">' + icon('trash', 15) + 'Remove</button>' : '') + '<span class="cf-spacer"></span>'
      + (s.id ? '<button type="button" class="cf-btn cf-btn--sm" data-responses="' + s.id + '">' + icon('list', 15) + 'Answers</button>'
        + '<button type="button" class="cf-btn cf-btn--sm" data-report="' + s.id + '">' + icon('report', 15) + 'Report</button>' : '')
      + '<button type="button" class="cf-btn cf-btn--sm" data-act="close">Cancel</button>'
      + '<button type="button" class="cf-btn cf-btn--primary cf-btn--sm" data-act="save">Save</button></div>'
      + '</article>';
  }
  function classPicker(s) {
    var classes = boot.classes || [];
    if (!classes.length) return '<p class="cf-hint">This school has no classes yet.</p>';
    return '<div style="margin-top:10px">' + (classes.length > 12 ? '<input type="search" class="cf-input" data-class-filter placeholder="Find a class" style="margin-bottom:8px;max-width:300px" />' : '')
      + '<div class="cf-classbox"><div class="cf-chips">' + classes.map(function (c) {
        return '<button type="button" class="cf-chip" data-class="' + c.id + '" aria-pressed="' + (s.classIds.indexOf(c.id) !== -1) + '">' + esc(c.name) + '</button>';
      }).join('') + '</div></div><p class="cf-hint" data-class-hint>' + (s.classIds.length ? plural(s.classIds.length, 'class', 'classes') + ' chosen.' : 'Pick at least one class, or choose All classes.') + '</p></div>';
  }
  function fieldFlags(f) {
    var out = [];
    if (f.required) out.push('<span class="cf-pill cf-pill--warn">Required</span>');
    if (f.cond) out.push('<span class="cf-pill cf-pill--accent">' + (f.cond.action === 'hide' ? 'Hides' : 'Shows') + ' when…</span>');
    if (f.retired) out.push('<span class="cf-pill">Not used</span>');
    return out.join('');
  }
  function syncSave() {
    var dirty = isDirty();
    Array.prototype.forEach.call(listEl.querySelectorAll('[data-act="save"]'), function (b) { b.disabled = !dirty; });
  }
  function changed(rerender) {
    if (rerender) { render(); return; }
    syncSave();
  }
  function bindOpen() {
    syncSave();
    var list = listEl.querySelector('#cf-fieldlist');
    if (list) bindDrag(list);
  }
  function bindDrag(list) {
    var from = null;
    list.addEventListener('dragstart', function (e) {
      var r = e.target.closest('.cf-fieldrow');
      if (!r) return;
      from = Number(r.getAttribute('data-index'));
      r.classList.add('is-dragging');
      e.dataTransfer.effectAllowed = 'move';
      try { e.dataTransfer.setData('text/plain', String(from)); } catch (_) { /* fine */ }
    });
    list.addEventListener('dragover', function (e) {
      var r = e.target.closest('.cf-fieldrow');
      if (!r || from === null) return;
      e.preventDefault();
      Array.prototype.forEach.call(list.children, function (x) { x.classList.toggle('is-over', x === r); });
    });
    list.addEventListener('dragend', function () { from = null; Array.prototype.forEach.call(list.children, function (x) { x.classList.remove('is-over', 'is-dragging'); }); });
    list.addEventListener('drop', function (e) {
      var r = e.target.closest('.cf-fieldrow');
      if (!r || from === null) return;
      e.preventDefault();
      var moved = state.current.fields.splice(from, 1)[0];
      state.current.fields.splice(Number(r.getAttribute('data-index')), 0, moved);
      from = null;
      changed(true);
    });
    list.addEventListener('keydown', function (e) {
      var r = e.target.closest('.cf-fieldrow');
      if (!r) return;
      var i = Number(r.getAttribute('data-index'));
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); editField(i); }
      if ((e.key === 'ArrowUp' || e.key === 'ArrowDown') && e.altKey) {
        e.preventDefault();
        var j = e.key === 'ArrowUp' ? i - 1 : i + 1;
        if (j < 0 || j >= state.current.fields.length) return;
        state.current.fields.splice(j, 0, state.current.fields.splice(i, 1)[0]);
        changed(true);
        var again = listEl.querySelector('.cf-fieldrow[data-index="' + j + '"]');
        if (again) again.focus();
      }
    });
  }

  // ── Fields ────────────────────────────────────────────────────────────────────────────
  var TYPE_HINTS = {
    text: 'A short answer', textarea: 'A longer answer', number: 'A number', date: 'A date', time: 'A time of day', yesno: 'Yes or no', choice: 'Pick one from a list',
    checklist: 'Tick any that apply', rating: 'One to five stars', email: 'An email address', phone: 'A phone number', url: 'A web link',
    file: 'Upload documents or photos', signature: 'Type a name to sign', instructions: 'Text to read, no answer', seat: 'Where a student sits: makes a seating chart'
  };
  function addField() {
    var m = modal({
      title: 'Add a field', size: 'wide', foot: false,
      // A seat belongs to a classroom section answered once per student per period, one per section.
      body: '<div class="cf-typegrid">' + TYPES.filter(function (t) {
        return t.key !== 'seat' || (state.current.filledBy === 'staff' && !state.current.multiple && !state.current.fields.some(function (f) { return f.type === 'seat'; }));
      }).map(function (t) {
        return '<button type="button" class="cf-typebtn" data-type="' + t.key + '"><span class="cf-ftype">' + icon(t.key, 16) + '</span><span>' + esc(t.label) + '<small style="display:block;color:var(--cf-muted);font-weight:400;font-size:12px">' + esc(TYPE_HINTS[t.key] || '') + '</small></span></button>';
      }).join('') + '</div>'
    });
    m.body.addEventListener('click', function (e) {
      var b = e.target.closest('[data-type]');
      if (!b) return;
      m.close();
      var type = b.getAttribute('data-type');
      editField(null, F(type, type === 'instructions' ? 'Please read' : '', typeOf[type].options ? { options: ['Option 1', 'Option 2'], display: 'dropdown' } : {}));
    });
  }
  function opsFor(field) {
    var t = field ? field.type : 'text';
    if (t === 'choice') return [['is', 'is'], ['is_not', 'is not'], ['filled', 'is answered'], ['empty', 'is not answered']];
    if (t === 'checklist') return [['contains', 'includes'], ['is_not', 'doesn’t include'], ['filled', 'is answered'], ['empty', 'is not answered']];
    if (t === 'yesno') return [['is', 'is'], ['filled', 'is answered'], ['empty', 'is not answered']];
    if (t === 'number' || t === 'rating') return [['is', 'is'], ['more', 'is more than'], ['less', 'is less than'], ['filled', 'is filled in'], ['empty', 'is empty']];
    if (t === 'date') return [['is', 'is'], ['more', 'is after'], ['less', 'is before'], ['filled', 'is filled in'], ['empty', 'is empty']];
    if (t === 'file' || t === 'signature') return [['filled', 'is added'], ['empty', 'is missing']];
    return [['is', 'is'], ['is_not', 'is not'], ['contains', 'contains'], ['filled', 'is filled in'], ['empty', 'is empty']];
  }
  function valueControl(field, op, value, attr) {
    if (!field || op === 'filled' || op === 'empty') return '<span></span>';
    var a = ' ' + attr;
    if (field.type === 'choice' || field.type === 'checklist') {
      return '<select class="cf-input"' + a + '>' + (field.options || []).map(function (o) { return '<option' + (o === value ? ' selected' : '') + '>' + esc(o) + '</option>'; }).join('') + '</select>';
    }
    if (field.type === 'yesno') return '<select class="cf-input"' + a + '><option value="yes"' + (value !== 'no' ? ' selected' : '') + '>Yes</option><option value="no"' + (value === 'no' ? ' selected' : '') + '>No</option></select>';
    if (field.type === 'rating') return '<select class="cf-input"' + a + '>' + [1, 2, 3, 4, 5].map(function (n) { return '<option' + (String(n) === String(value) ? ' selected' : '') + '>' + n + '</option>'; }).join('') + '</select>';
    if (field.type === 'date') return '<input type="date" class="cf-input"' + a + ' value="' + esc(value || '') + '" />';
    if (field.type === 'number') return '<input type="number" step="any" class="cf-input"' + a + ' value="' + esc(value || '') + '" />';
    return '<input type="text" class="cf-input"' + a + ' value="' + esc(value || '') + '" placeholder="Value" />';
  }
  function firstValue(field) {
    if (!field) return '';
    if (field.type === 'choice' || field.type === 'checklist') return (field.options || [])[0] || '';
    if (field.type === 'yesno') return 'yes';
    if (field.type === 'rating') return '3';
    return '';
  }
  // A new condition that can actually be met: the field's first answer, or "is filled in" for
  // fields without set answers (a date, a text), never "is" an empty value.
  function defaultCond(field) {
    var op = opsFor(field)[0][0];
    var value = firstValue(field);
    if (!value && op !== 'filled' && op !== 'empty') op = 'filled';
    return { op: op, value: value };
  }
  var needsValue = function (c) { return c && c.op !== 'filled' && c.op !== 'empty' && !String(c.value || '').trim(); };

  // An icon for a choice, from its words (the first rule that matches wins; "No lunch" is "none").
  var ANSWER_ICONS = boot.answerIcons || [];
  var SUGGEST = [
    [/\b(no|none|not|nothing|skip|skipped|absent|away)\b/, 'none'], [/\b(yes|present|done|agree|ok)\b/, 'check'],
    [/packed|bag|bring|from home|home lunch|cold lunch|own lunch/, 'bag'], [/lunch|hot meal|meal|tray|cafeteria|breakfast/, 'lunch'],
    [/fruit|apple|snack|veg|salad/, 'apple'], [/milk|water|drink|juice/, 'water'], [/\bbus\b/, 'bus'], [/walk|\bhome\b/, 'home'],
    [/car|pick ?up|parent/, 'pickup'], [/excellent|outstanding|great|\bstar/, 'star'], [/\bgood\b|well|like/, 'thumbsUp'],
    [/needs|improve|poor|\bbad\b|concern|dislike/, 'thumbsDown'], [/happy|glad|love/, 'smile'], [/sad|upset|unhappy/, 'frown'],
    [/okay|so-so|so so|neutral|fine|some/, 'meh'], [/read|book|library/, 'book'], [/write|pencil|homework/, 'pencil'],
    [/music|choir|band|sing/, 'music'], [/\bart\b|draw|paint/, 'art'], [/sport|soccer|basket|football|game|\brun/, 'sports'],
    [/science|lab/, 'science'], [/sick|nurse|health|\bill\b/, 'health'], [/medic|pill/, 'medicine'], [/late|early|time|minute/, 'time'],
    [/money|pay|paid|fee|cash/, 'money'], [/group|team|house/, 'groups'], [/heart|kind|care/, 'heart'], [/flag|alert|warning/, 'alert']
  ];
  function suggestIcon(words) {
    var text = String(words || '').toLowerCase();
    for (var i = 0; i < SUGGEST.length; i += 1) if (SUGGEST[i][0].test(text) && ANSWER_ICONS.indexOf(SUGGEST[i][1]) !== -1) return SUGGEST[i][1];
    return '';
  }
  function editField(index, fresh) {
    var isNew = index === null;
    var f = clone(isNew ? fresh : state.current.fields[index]);
    var keyTouched = !isNew;
    // While editing, each choice's icon sits at the same position as the choice (picked by hand or suggested).
    f._ic = (f.options || []).map(function (o) { return (f.icons || {})[o] || ''; });
    f._man = (f.options || []).map(function (o) { return Boolean((f.icons || {})[o]); });
    function fitIcons() {
      var n = (f.options || []).length;
      while (f._ic.length < n) { f._ic.push(''); f._man.push(false); }
      f._ic.length = n; f._man.length = n;
      if (f.display === 'icons') f.options.forEach(function (o, i) { if (!f._man[i]) f._ic[i] = suggestIcon(o); });
    }
    var picking = -1; // the choice whose icon is being picked
    var others = state.current.fields.filter(function (o) { return o.id !== f.id && o.type !== 'instructions'; });
    var m = modal({
      title: isNew ? 'New field' : 'Edit field',
      body: '<div class="cf-stack" data-form></div>',
      foot: (isNew ? '' : '<button type="button" class="cf-link cf-link--danger" data-remove>' + icon('trash', 15) + 'Remove</button>')
        + '<span class="cf-spacer"></span><button type="button" class="cf-btn" data-close>Cancel</button><button type="button" class="cf-btn cf-btn--primary" data-done>' + (isNew ? 'Add field' : 'Done') + '</button>'
    });
    var form = m.body.querySelector('[data-form]');
    function draw() {
      var t = typeOf[f.type] || {};
      var cond = f.cond;
      var control = cond ? others.filter(function (o) { return o.id === cond.field; })[0] : null;
      form.innerHTML = ''
        + '<div><label class="cf-label" for="cfm-type">Type</label><select id="cfm-type" class="cf-input" data-f="type">' + TYPES.map(function (x) {
          return '<option value="' + x.key + '"' + (x.key === f.type ? ' selected' : '') + '>' + esc(x.label) + '</option>';
        }).join('') + '</select></div>'
        + '<div><label class="cf-label" for="cfm-label">' + (f.type === 'instructions' ? 'Heading' : 'Question') + '</label><input id="cfm-label" class="cf-input" data-f="label" maxlength="200" value="' + esc(f.label) + '" placeholder="' + (f.type === 'instructions' ? 'e.g. Before you start' : 'e.g. Does your child have any allergies?') + '" /></div>'
        + '<div><label class="cf-label" for="cfm-help">' + (f.type === 'instructions' ? 'Text to show' : 'Help text (optional)') + '</label><textarea id="cfm-help" class="cf-input" data-f="help" rows="' + (f.type === 'instructions' ? 5 : 2) + '" maxlength="' + (f.type === 'instructions' ? 4000 : 1000) + '">' + esc(f.help || '') + '</textarea></div>'
        + (t.options ? optionsHtml(f) : '')
        + (f.type === 'yesno' ? '<div><span class="cf-label">Show as</span><div class="cf-seg"><button type="button" data-display="text" aria-pressed="' + (f.display !== 'icons') + '">Yes / No</button><button type="button" data-display="icons" aria-pressed="' + (f.display === 'icons') + '">' + icon('check', 15) + ' ' + icon('close', 15) + ' Icons</button></div></div>' : '')
        + (f.type === 'seat' ? '<div><span class="cf-label">Show seats with</span><div class="cf-seg"><button type="button" data-display="photos" aria-pressed="' + (f.display !== 'names') + '">Photos and names</button><button type="button" data-display="names" aria-pressed="' + (f.display === 'names') + '">Names only</button></div></div>' : '')
        + (f.type !== 'instructions' ? '<label class="cf-check"><input type="checkbox" data-f-check="required"' + (f.required ? ' checked' : '') + ' /><span>Required</span></label>' : '')
        + '<details class="cf-advanced"' + (f.cond || f.retired ? ' open' : '') + '><summary>More options</summary><div class="cf-advanced__body cf-stack">'
        + '<div><span class="cf-label">Show this field</span>'
        + (others.length
          ? '<div class="cf-cond"><select class="cf-input" data-cond="action"><option value="show"' + (!cond || cond.action === 'show' ? ' selected' : '') + '>Show</option><option value="hide"' + (cond && cond.action === 'hide' ? ' selected' : '') + '>Hide</option></select>'
            + '<select class="cf-input" data-cond="field"><option value="">Always</option>' + others.map(function (o) { return '<option value="' + o.id + '"' + (cond && cond.field === o.id ? ' selected' : '') + '>When “' + esc(o.label) + '”</option>'; }).join('') + '</select><span></span></div>'
            + (control ? '<div class="cf-cond" style="margin-top:8px"><span></span><select class="cf-input" data-cond="op">' + opsFor(control).map(function (o) { return '<option value="' + o[0] + '"' + (cond.op === o[0] ? ' selected' : '') + '>' + o[1] + '</option>'; }).join('') + '</select>'
              + valueControl(control, cond.op, cond.value, 'data-cond="value"') + '</div>' : '')
          : '<p class="cf-hint" style="margin:0">Add another field first to show this one only when it’s needed.</p>')
        + '</div>'
        + '<div><span class="cf-label">Width</span><div class="cf-seg"><button type="button" data-width="full" aria-pressed="' + (f.width !== 'half') + '">Full row</button><button type="button" data-width="half" aria-pressed="' + (f.width === 'half') + '">Half (two side by side)</button></div></div>'
        + (f.type !== 'instructions' ? '<label class="cf-check"><input type="checkbox" data-f-check="retired"' + (f.retired ? ' checked' : '') + ' /><span>Stop using this field<small>It’s hidden from now on. Answers already given are kept.</small></span></label>' : '')
        + '</div></details>';
    }
    function optionsHtml(field) {
      return '<div><div style="display:flex;align-items:center;justify-content:space-between"><span class="cf-label">Choices</span>'
        + '<button type="button" class="cf-link" data-sort title="Sort A to Z">A→Z</button></div>'
        + '<ul class="cf-options">' + (field.options || []).map(function (o, i) {
          var withIcon = field.type === 'choice' && field.display === 'icons';
          return '<li class="cf-option" draggable="true" data-opt="' + i + '"><span class="cf-grip" aria-hidden="true">⠿</span>'
            + (withIcon ? '<button type="button" class="cf-opticon' + (field._ic[i] ? '' : ' is-empty') + '" data-opt-icon="' + i + '" aria-label="Icon for ' + esc(o || 'this choice') + '" aria-expanded="' + (picking === i) + '" title="Choose its icon">' + (field._ic[i] ? icon(field._ic[i], 20) : icon('plus', 15)) + '</button>' : '')
            + '<input class="cf-input" data-opt-input="' + i + '" maxlength="120" value="' + esc(o) + '" aria-label="Item ' + (i + 1) + '" /><button type="button" class="cf-x" data-opt-remove="' + i + '" aria-label="Remove item">' + icon('close', 15) + '</button></li>'
            + (withIcon && picking === i ? '<li class="cf-anspicker">' + ANSWER_ICONS.map(function (name) {
              return '<button type="button" data-pick-icon="' + name + '" aria-pressed="' + (field._ic[i] === name) + '" title="' + name + '">' + icon(name, 20) + '</button>';
            }).join('') + '<button type="button" class="cf-anspicker__none" data-pick-icon="">Words only</button></li>' : '');
        }).join('') + '</ul>'
        + '<button type="button" class="cf-link" data-opt-add style="margin-top:8px">' + icon('plus', 15) + 'Add choice</button>'
        + (field.type === 'choice' ? '<div style="margin-top:12px"><span class="cf-label">Show as</span><div class="cf-seg"><button type="button" data-display="dropdown" aria-pressed="' + (field.display !== 'buttons' && field.display !== 'icons') + '">Dropdown</button><button type="button" data-display="buttons" aria-pressed="' + (field.display === 'buttons') + '">Buttons</button><button type="button" data-display="icons" aria-pressed="' + (field.display === 'icons') + '">Icons</button></div>'
          + '<p class="cf-hint">' + (field.display === 'icons' ? 'Each choice shows its icon. We picked some from the words; tap one to change it.' : field.display === 'buttons' ? 'Each choice is a button with its words.' : 'A list to pick from.') + ' Buttons and icons are answered with one tap in the class list and on the attendance page.</p></div>' : '')
        + '</div>';
    }
    draw();
    form.addEventListener('input', function (e) {
      var k = e.target.getAttribute('data-f');
      if (k) {
        f[k] = e.target.value;
        if (k === 'label' && !keyTouched) f.key = keyFrom(f.label);
      }
      var oi = e.target.getAttribute('data-opt-input');
      if (oi !== null) {
        f.options[Number(oi)] = e.target.value;
        // A suggested icon follows the words as they're typed (one picked by hand stays).
        if (f.display === 'icons' && !f._man[Number(oi)]) {
          var next = suggestIcon(e.target.value);
          if (next !== f._ic[Number(oi)]) {
            f._ic[Number(oi)] = next;
            var b = form.querySelector('[data-opt-icon="' + oi + '"]');
            if (b) { b.innerHTML = next ? icon(next, 20) : icon('plus', 15); b.classList.toggle('is-empty', !next); }
          }
        }
      }
      if (e.target.getAttribute('data-cond') === 'value' && f.cond) f.cond.value = e.target.value;
    });
    form.addEventListener('change', function (e) {
      var k = e.target.getAttribute('data-f');
      if (k === 'type') {
        f.type = e.target.value;
        if (typeOf[f.type].options && !(f.options && f.options.length)) f.options = ['Option 1', 'Option 2'];
        if (f.display && !(f.type === 'choice' || (f.type === 'yesno' && f.display === 'icons') || (f.type === 'seat' && f.display === 'names'))) delete f.display;
        picking = -1;
        fitIcons();
        if (f.type === 'choice' && !f.display) f.display = 'dropdown';
        if (f.type === 'instructions') f.required = false;
        draw();
      }
      var c = e.target.getAttribute('data-f-check');
      if (c) f[c] = e.target.checked;
      var cd = e.target.getAttribute('data-cond');
      if (cd === 'action') { if (f.cond) f.cond.action = e.target.value; else f._action = e.target.value; }
      if (cd === 'field') {
        if (!e.target.value) f.cond = null;
        else {
          var ctl = others.filter(function (o) { return o.id === e.target.value; })[0];
          var start = defaultCond(ctl);
          f.cond = { action: (f.cond && f.cond.action) || f._action || 'show', field: e.target.value, op: start.op, value: start.value };
        }
        draw();
      }
      if (cd === 'op' && f.cond) {
        f.cond.op = e.target.value;
        var ctlField = others.filter(function (o) { return o.id === f.cond.field; })[0];
        if (needsValue(f.cond)) f.cond.value = firstValue(ctlField);
        draw();
      }
      if (cd === 'value' && f.cond) f.cond.value = e.target.value;
    });
    form.addEventListener('click', function (e) {
      var w = e.target.closest('[data-width]');
      if (w) { f.width = w.getAttribute('data-width'); draw(); return; }
      var d = e.target.closest('[data-display]');
      if (d) { f.display = d.getAttribute('data-display'); picking = -1; fitIcons(); draw(); return; }
      var oic = e.target.closest('[data-opt-icon]');
      if (oic) { var at = Number(oic.getAttribute('data-opt-icon')); picking = picking === at ? -1 : at; draw(); return; }
      var pick = e.target.closest('[data-pick-icon]');
      if (pick && picking !== -1) { f._ic[picking] = pick.getAttribute('data-pick-icon'); f._man[picking] = true; picking = -1; draw(); return; }
      if (e.target.closest('[data-opt-add]')) {
        f.options = (f.options || []).concat(['']);
        f._ic.push(''); f._man.push(false);
        draw();
        var inputs = form.querySelectorAll('[data-opt-input]');
        if (inputs.length) inputs[inputs.length - 1].focus();
        return;
      }
      var rm = e.target.closest('[data-opt-remove]');
      if (rm) { var gone = Number(rm.getAttribute('data-opt-remove')); f.options.splice(gone, 1); f._ic.splice(gone, 1); f._man.splice(gone, 1); picking = -1; draw(); return; }
      if (e.target.closest('[data-sort]')) {
        var pairs = f.options.map(function (o, i) { return [o, f._ic[i], f._man[i]]; }).sort(function (a, b) { return a[0].localeCompare(b[0]); });
        f.options = pairs.map(function (p) { return p[0]; }); f._ic = pairs.map(function (p) { return p[1]; }); f._man = pairs.map(function (p) { return p[2]; });
        picking = -1; draw();
      }
    });
    form.addEventListener('keydown', function (e) {
      if (e.key === 'Enter' && e.target.hasAttribute('data-opt-input')) {
        e.preventDefault();
        f.options.splice(Number(e.target.getAttribute('data-opt-input')) + 1, 0, '');
        f._ic.splice(Number(e.target.getAttribute('data-opt-input')) + 1, 0, '');
        f._man.splice(Number(e.target.getAttribute('data-opt-input')) + 1, 0, false);
        draw();
        var next = form.querySelector('[data-opt-input="' + (Number(e.target.getAttribute('data-opt-input')) + 1) + '"]');
        if (next) next.focus();
      }
    });
    var dragFrom = null;
    form.addEventListener('dragstart', function (e) { var li = e.target.closest('.cf-option'); if (li) dragFrom = Number(li.getAttribute('data-opt')); });
    form.addEventListener('dragover', function (e) { if (dragFrom !== null && e.target.closest('.cf-option')) e.preventDefault(); });
    form.addEventListener('drop', function (e) {
      var li = e.target.closest('.cf-option');
      if (!li || dragFrom === null) return;
      e.preventDefault();
      var to = Number(li.getAttribute('data-opt'));
      f.options.splice(to, 0, f.options.splice(dragFrom, 1)[0]);
      f._ic.splice(to, 0, f._ic.splice(dragFrom, 1)[0]);
      f._man.splice(to, 0, f._man.splice(dragFrom, 1)[0]);
      dragFrom = null;
      draw();
    });
    m.foot.querySelector('[data-done]').addEventListener('click', function () {
      f.label = String(f.label || '').trim();
      if (!f.label && f.type !== 'instructions') { toast('Type the question first.', true); form.querySelector('[data-f="label"]').focus(); return; }
      if (typeOf[f.type].options) {
        // Each choice keeps its icon (only when shown as icons).
        var icons = {};
        var kept = [];
        (f.options || []).forEach(function (o, i) {
          var words = String(o || '').trim();
          if (!words) return;
          kept.push(words);
          if (f.display === 'icons' && f._ic[i]) icons[words] = f._ic[i];
        });
        f.options = kept;
        if (f.options.length < 2) { toast('Add at least two choices.', true); return; }
        if (f.type === 'choice' && f.display === 'icons') f.icons = icons; else delete f.icons;
        if (f.type !== 'choice') delete f.display;
      } else if (f.type !== 'yesno' && f.type !== 'seat') { delete f.options; delete f.display; delete f.icons; }
      else { delete f.options; delete f.icons; }
      delete f._ic; delete f._man;
      if (needsValue(f.cond)) { toast('Finish “Visibility”: give the answer it depends on, or choose Always.', true); return; }
      f.key = keyFrom(f.key || f.label);
      delete f._action;
      if (isNew) state.current.fields.push(f);
      else state.current.fields[index] = f;
      m.close();
      changed(true);
    });
    var rmBtn = m.foot.querySelector('[data-remove]');
    if (rmBtn) rmBtn.addEventListener('click', function () {
      var usedBy = state.current.fields.filter(function (o) { return o.cond && o.cond.field === f.id; }).length;
      var msg = (state.current.entries ? 'Answers already given to this field will no longer show. To keep them, choose “Stop using this field” instead. ' : '')
        + (usedBy ? 'Fields that show or hide on it will always show. ' : '') + 'Remove “' + (f.label || 'this field') + '”?';
      confirmBox('Remove this field?', msg, 'Remove field', true).then(function (ok) {
        if (!ok) return;
        state.current.fields.splice(index, 1);
        state.current.fields.forEach(function (o) { if (o.cond && o.cond.field === f.id) o.cond = null; });
        m.close();
        changed(true);
      });
    });
  }

  function iconPicker() {
    var m = modal({
      title: 'Choose an icon', size: 'wide', foot: false,
      body: '<div class="cf-iconpicker">' + (boot.icons || []).map(function (name) {
        return '<button type="button" data-icon="' + name + '" aria-pressed="' + (state.current.icon === name) + '" aria-label="' + name + '" title="' + name.charAt(0).toUpperCase() + name.slice(1) + '">' + icon(name, 26) + '</button>';
      }).join('') + '</div>'
    });
    m.body.addEventListener('click', function (e) {
      var b = e.target.closest('[data-icon]');
      if (!b) return;
      state.current.icon = b.getAttribute('data-icon');
      m.close();
      changed(true);
    });
  }
  function preview() {
    var m = modal({ title: 'Preview: ' + (state.current.name || 'New section'), size: 'wide', foot: false, body: '<div data-preview></div>' });
    R.mount(m.body.querySelector('[data-preview]'), state.current, { preview: true });
  }
  function responses(id, studentId) {
    var s = state.sections.filter(function (x) { return x.id === id; })[0];
    if (!s || !window.CustomFormsFill) return;
    var m = modal({ title: 'Answers: ' + s.name, size: 'wide', foot: false, body: '<div data-answers></div>', focus: false });
    m.el.querySelector('.cfm__box').classList.add('cfm__box--tall');
    // A copy: the answers view keeps only the fields in use, and must not touch the section being edited.
    window.CustomFormsFill.mount(m.body.querySelector('[data-answers]'), { base: '/common/forms', sections: [clone(s)], selected: { section: id, student: studentId || null } });
  }

  // ── Opening, saving, removing ─────────────────────────────────────────────────────────
  function leaveOk() {
    if (!isDirty()) return Promise.resolve(true);
    return confirmBox('Discard your changes?', 'You have changes that aren’t saved yet.', 'Discard changes', true);
  }
  function openSection(id) {
    var s = state.sections.filter(function (x) { return x.id === id; })[0];
    if (!s) return;
    state.openId = id;
    state.current = clone(s);
    state.original = snapshot();
    state.pickClasses = false;
    state.moreOpen = false;
    render();
    var el = listEl.querySelector('.cf-sec.is-open');
    if (el) el.scrollIntoView({ block: 'start', behavior: 'smooth' });
    try { history.replaceState(null, '', '?section=' + id); } catch (_) { /* fine */ }
  }
  function close() {
    state.openId = null;
    state.current = null;
    state.original = null;
    render();
    try { history.replaceState(null, '', location.pathname); } catch (_) { /* fine */ }
  }
  function createNew(start) {
    state.openId = 'new';
    state.current = start || blank();
    // A new section isn't saved yet, so Save is ready from the start.
    state.original = null;
    state.pickClasses = false;
    state.moreOpen = false;
    render();
    var name = listEl.querySelector('.cf-sec.is-open [data-bind="name"]');
    if (name) { name.focus(); name.scrollIntoView({ block: 'center' }); }
  }
  function save() {
    var s = state.current;
    if (!String(s.name || '').trim()) { toast('Name the section first.', true); var n = listEl.querySelector('[data-bind="name"]'); if (n) n.focus(); return; }
    if (s.status === 'live' && !inputFields(s).length) { toast('Add a field first, or switch it to Hidden.', true); return; }
    var buttons = listEl.querySelectorAll('[data-act="save"]');
    Array.prototype.forEach.call(buttons, function (b) { b.disabled = true; b.textContent = 'Saving…'; });
    post('/common/custom-forms/save', s).then(function (res) {
      var saved = res.section;
      var at = -1;
      state.sections.forEach(function (x, i) { if (x.id === saved.id) at = i; });
      if (at === -1) state.sections.push(saved);
      else state.sections[at] = saved;
      state.openId = saved.id;
      state.current = clone(saved);
      state.original = snapshot();
        render();
      try { history.replaceState(null, '', '?section=' + saved.id); } catch (_) { /* fine */ }
      toast(res.announced ? 'Saved. ' + res.announced + ' families were asked to fill it in.' : 'Saved.');
    }).catch(function (err) {
      toast(err.message, true);
      Array.prototype.forEach.call(buttons, function (b) { b.disabled = false; b.textContent = 'Save'; });
    });
  }
  function remove() {
    var s = state.current;
    if (!s.id) { state.original = snapshot(); close(); return; }
    var text = s.entries ? 'This also deletes ' + plural(s.entries, 'answer') + ' already given. It can’t be undone. To stop using it but keep the answers, set it to Hidden instead.' : 'It can’t be undone.';
    confirmBox('Remove “' + s.name + '”?', text, 'Remove section', true).then(function (ok) {
      if (!ok) return;
      post('/common/custom-forms/' + s.id + '/delete').then(function () {
        state.sections = state.sections.filter(function (x) { return x.id !== s.id; });
        state.original = snapshot();
        close();
        toast('Removed.');
      }).catch(function (err) { toast(err.message, true); });
    });
  }
  function toggleVisible(id) {
    var s = state.sections.filter(function (x) { return x.id === id; })[0];
    if (!s) return;
    var next = Object.assign(clone(s), { status: s.status === 'live' ? 'draft' : 'live' });
    if (next.status === 'live' && !inputFields(next).length) { toast('Add a field before it goes live.', true); return; }
    post('/common/custom-forms/save', next).then(function (res) {
      state.sections = state.sections.map(function (x) { return x.id === id ? res.section : x; });
      render();
      toast(res.section.status === 'live' ? (res.announced ? 'Live. ' + res.announced + ' families were asked to fill it in.' : 'Live.') : 'Hidden.');
    }).catch(function (err) { toast(err.message, true); });
  }
  function move(id, step) {
    var i = state.sections.findIndex(function (x) { return x.id === id; });
    var j = i + step;
    if (i < 0 || j < 0 || j >= state.sections.length) return;
    state.sections.splice(j, 0, state.sections.splice(i, 1)[0]);
    render();
    post('/common/custom-forms/order', { ids: state.sections.map(function (x) { return x.id; }) }).catch(function (err) { toast(err.message, true); });
  }

  // ── Events ────────────────────────────────────────────────────────────────────────────
  document.getElementById('cf-new').addEventListener('click', function () {
    leaveOk().then(function (ok) { if (ok) chooser(); });
  });
  listEl.addEventListener('click', function (e) {
    var t;
    if ((t = e.target.closest('[data-open]'))) {
      var id = Number(t.getAttribute('data-open'));
      return leaveOk().then(function (ok) { if (ok) openSection(id); });
    }
    if ((t = e.target.closest('[data-responses]'))) return responses(Number(t.getAttribute('data-responses')));
    if ((t = e.target.closest('[data-report]'))) return openReport(Number(t.getAttribute('data-report')));
    if ((t = e.target.closest('[data-visible]'))) return toggleVisible(Number(t.getAttribute('data-visible')));
    if ((t = e.target.closest('[data-move]'))) { var mv = t.getAttribute('data-move').split(':'); return move(Number(mv[0]), Number(mv[1])); }
    if ((t = e.target.closest('[data-act]'))) {
      var a = t.getAttribute('data-act');
      if (a === 'new') return chooser();
      if (a === 'save') return save();
      if (a === 'close') return leaveOk().then(function (ok) { if (ok) close(); });
      if (a === 'delete') return remove();
      if (a === 'icon') return iconPicker();
      if (a === 'preview') return preview();
      if (a === 'add-field') return addField();
    }
    var s = state.current;
    if (!s) return;
    if ((t = e.target.closest('[data-place]'))) {
      s.filledBy = t.getAttribute('data-place');
      if (s.filledBy === 'parent') s.showParents = true;
      if (s.filledBy === 'student') s.showStudents = true;
      return tidy(s), changed(true);
    }
    if ((t = e.target.closest('[data-collect]'))) {
      // Many times starts as "every term" (the most common); they pick how often next.
      if (t.getAttribute('data-collect') === 'one') { s.multiple = false; s.repeat = ''; }
      else if (!s.multiple && !s.repeat) s.repeat = 'term';
      return tidy(s), changed(true);
    }
    if ((t = e.target.closest('[data-every]'))) {
      var how = t.getAttribute('data-every');
      s.multiple = how === 'any';
      s.repeat = how === 'any' ? '' : how;
      return tidy(s), changed(true);
    }

    if ((t = e.target.closest('[data-classes]'))) {
      if (t.getAttribute('data-classes') === 'all') { s.classIds = []; state.pickClasses = false; } else state.pickClasses = true;
      return changed(true);
    }
    if ((t = e.target.closest('[data-class]'))) {
      var cid = Number(t.getAttribute('data-class'));
      var at = s.classIds.indexOf(cid);
      if (at === -1) s.classIds.push(cid); else s.classIds.splice(at, 1);
      t.setAttribute('aria-pressed', String(at === -1));
      var hint = listEl.querySelector('[data-class-hint]');
      if (hint) hint.textContent = s.classIds.length ? plural(s.classIds.length, 'class', 'classes') + ' chosen.' : 'Pick at least one class, or choose All classes.';
      return changed();
    }
    if ((t = e.target.closest('.cf-fieldrow')) && !e.target.closest('.cf-grip')) return editField(Number(t.getAttribute('data-index')));
  });
  listEl.addEventListener('input', function (e) {
    if (!state.current) return;
    var k = e.target.getAttribute('data-bind');
    if (k) {
      state.current[k] = e.target.value || (k === 'dueDate' ? null : '');
      return changed(false);
    }
    if (e.target.hasAttribute('data-class-filter')) {
      var q = e.target.value.trim().toLowerCase();
      Array.prototype.forEach.call(listEl.querySelectorAll('[data-class]'), function (b) { b.hidden = q && b.textContent.toLowerCase().indexOf(q) === -1; });
    }
  });
  listEl.addEventListener('change', function (e) {
    if (!state.current) return;
    var s = state.current;
    var k = e.target.getAttribute('data-bind-check');
    if (k) {
      // "tell.builders" and the like sit one level down.
      var parts = k.split('.');
      if (parts.length === 2) s[parts[0]][parts[1]] = e.target.checked; else s[k] = e.target.checked;
      tidy(s);
      return changed(k === 'protected' || parts.length === 2);
    }
    if (e.target.hasAttribute('data-live')) { s.status = e.target.checked ? 'live' : 'draft'; return changed(true); }
    if (e.target.getAttribute('data-bind') === 'dueDate') { s.dueDate = e.target.value || null; return changed(false); }
  });
  // "More options" stays as the person left it while the section redraws.
  listEl.addEventListener('toggle', function (e) { if (e.target.classList && e.target.classList.contains('cf-more')) state.moreOpen = e.target.open; }, true);
  window.addEventListener('beforeunload', function (e) { if (isDirty()) { e.preventDefault(); e.returnValue = ''; } });

  // Start: the list, with the section in the address opened (and its answers, from a notification).
  var params = new URLSearchParams(location.search);
  var wanted = Number(params.get('section'));
  render();
  if (wanted && state.sections.some(function (x) { return x.id === wanted; })) {
    openSection(wanted);
    if (params.get('responses')) responses(wanted, Number(params.get('student')) || null);
  }
})();
