// Draws a custom form (feature custom_forms) from its fields: inputs that follow each field's
// "show when" rule as people type, or a read-only view of what was filled in. The same rules
// run on the server (utils/customForms.js), which has the final say.
(function (window) {
  'use strict';
  if (window.CustomFormRender) return;

  // Icons: 24px strokes. Section icons, field types and a few for the pages.
  var P = {
    form: '<path d="M8 3h8l4 4v13a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1h3"/><path d="M8 11h8M8 15h6"/>',
    health: '<path d="M12 21s-7-4.5-7-10a4 4 0 0 1 7-2.6A4 4 0 0 1 19 11c0 5.5-7 10-7 10z"/><path d="M12 9v5M9.5 11.5h5"/>',
    consent: '<path d="M9 11l2 2 4-4"/><path d="M12 3l7 3v6c0 4.5-3 7.5-7 9-4-1.5-7-4.5-7-9V6z"/>',
    behaviour: '<circle cx="12" cy="12" r="9"/><path d="M8.5 14.5s1.2 1.8 3.5 1.8 3.5-1.8 3.5-1.8M9 9.5h.01M15 9.5h.01"/>',
    book: '<path d="M4 5a2 2 0 0 1 2-2h13v16H6a2 2 0 0 0-2 2z"/><path d="M4 19a2 2 0 0 1 2-2h13"/>',
    bus: '<rect x="4" y="3" width="16" height="15" rx="2"/><path d="M4 11h16M8 21v-3M16 21v-3"/><circle cx="8" cy="14.5" r=".8"/><circle cx="16" cy="14.5" r=".8"/>',
    meeting: '<circle cx="8" cy="8" r="3"/><circle cx="17" cy="9" r="2.5"/><path d="M2.5 20c.5-3.5 2.8-5.5 5.5-5.5s5 2 5.5 5.5M14 15.2c.9-.5 1.9-.7 3-.7 2.4 0 4.2 1.8 4.5 5"/>',
    star: '<path d="M12 3l2.7 5.6 6.1.9-4.4 4.3 1 6.1L12 17l-5.4 2.9 1-6.1L3.2 9.5l6.1-.9z"/>',
    shield: '<path d="M12 3l7 3v6c0 4.5-3 7.5-7 9-4-1.5-7-4.5-7-9V6z"/>',
    flag: '<path d="M5 21V4M5 4h11l-2 4 2 4H5"/>',
    calendar: '<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M3 10h18M8 3v4M16 3v4"/>',
    chat: '<path d="M21 12a8 8 0 0 1-11.7 7.1L4 20.5l1.4-4.9A8 8 0 1 1 21 12z"/>',
    clipboard: '<rect x="5" y="4" width="14" height="17" rx="2"/><path d="M9 4V3h6v1M9 11h6M9 15h4"/>',
    heart: '<path d="M12 20s-7.5-4.6-7.5-10A4.5 4.5 0 0 1 12 7a4.5 4.5 0 0 1 7.5 3c0 5.4-7.5 10-7.5 10z"/>',
    trophy: '<path d="M8 4h8v5a4 4 0 0 1-8 0zM8 6H4v1a3 3 0 0 0 4 3M16 6h4v1a3 3 0 0 1-4 3M12 13v4M8 21h8M9 17h6"/>',
    alert: '<path d="M12 3l9.5 16.5H2.5z"/><path d="M12 10v4M12 17h.01"/>',
    none: '<circle cx="12" cy="12" r="9"/><path d="M5.6 5.6l12.8 12.8"/>',
    bag: '<path d="M6 8h12l-1 12H7z"/><path d="M9 8V6.5a3 3 0 0 1 6 0V8"/>',
    smile: '<circle cx="12" cy="12" r="9"/><path d="M8.5 14s1.2 2 3.5 2 3.5-2 3.5-2M9 9.5h.01M15 9.5h.01"/>',
    meh: '<circle cx="12" cy="12" r="9"/><path d="M8.5 15h7M9 9.5h.01M15 9.5h.01"/>',
    frown: '<circle cx="12" cy="12" r="9"/><path d="M8.5 16.2s1.2-2 3.5-2 3.5 2 3.5 2M9 9.5h.01M15 9.5h.01"/>',
    thumbsUp: '<path d="M7 11v9H4v-9z"/><path d="M7 11l4-7a2 2 0 0 1 2.8 1.8L13 10h5.3a2 2 0 0 1 2 2.4l-1.4 6A2 2 0 0 1 17 20H7"/>',
    thumbsDown: '<path d="M7 13V4H4v9z"/><path d="M7 13l4 7a2 2 0 0 0 2.8-1.8L13 14h5.3a2 2 0 0 0 2-2.4l-1.4-6A2 2 0 0 0 17 4H7"/>',
    lunch: '<path d="M7 3v8M5 3v5a2 2 0 0 0 4 0V3M7 11v10"/><path d="M17 3c-2 0-3 2.5-3 5.5s1 4.5 3 4.5V3zM17 13v8"/>',
    apple: '<path d="M12 7.5c-1.5-1.5-4-1.5-5.5 0-2 2-1.5 6.2.5 9.2 1.2 1.8 2.6 2.5 5 1.5 2.4 1 3.8.3 5-1.5 2-3 2.5-7.2.5-9.2-1.5-1.5-4-1.5-5.5 0z"/><path d="M12 7.5c0-2 1-3.5 3-4"/>',
    seat: '<path d="M7 4h10v9H7z"/><path d="M5 13h14v3H5zM7 16v5M17 16v5"/>',
    groups: '<circle cx="12" cy="8" r="3"/><circle cx="5.5" cy="10" r="2.2"/><circle cx="18.5" cy="10" r="2.2"/><path d="M6.5 20c.4-3.2 2.6-5 5.5-5s5.1 1.8 5.5 5M2 18.5c.3-2 1.5-3.2 3.5-3.4M22 18.5c-.3-2-1.5-3.2-3.5-3.4"/>',
    music: '<path d="M9 18V5l11-2v13"/><circle cx="6.5" cy="18" r="2.5"/><circle cx="17.5" cy="16" r="2.5"/>',
    sports: '<circle cx="12" cy="12" r="9"/><path d="M5.6 5.6c3.5 3.5 3.5 9.3 0 12.8M18.4 5.6c-3.5 3.5-3.5 9.3 0 12.8M3 12h18"/>',
    art: '<path d="M12 3a9 9 0 1 0 0 18c1.2 0 2-.8 2-1.8 0-.5-.2-.9-.5-1.3-.3-.4-.5-.8-.5-1.3 0-1 .8-1.8 1.8-1.8H17a4 4 0 0 0 4-4c0-4.3-4-7.8-9-7.8z"/><circle cx="7.5" cy="11.5" r="1"/><circle cx="10" cy="7.5" r="1"/><circle cx="14.5" cy="7.5" r="1"/>',
    science: '<path d="M9 3h6M10 3v6l-5 9a2 2 0 0 0 1.8 3h10.4a2 2 0 0 0 1.8-3l-5-9V3"/><path d="M7.5 15h9"/>',
    globe: '<circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3c2.5 2.7 3.8 5.7 3.8 9s-1.3 6.3-3.8 9c-2.5-2.7-3.8-5.7-3.8-9S9.5 5.7 12 3z"/>',
    home: '<path d="M4 11l8-7 8 7"/><path d="M6 10v10h12V10"/><path d="M10 20v-6h4v6"/>',
    money: '<circle cx="12" cy="12" r="9"/><path d="M14.5 9.2c-.5-.8-1.4-1.2-2.5-1.2-1.5 0-2.6.8-2.6 2s1 1.7 2.6 2 2.7.8 2.7 2-1.2 2-2.7 2c-1.2 0-2.2-.5-2.7-1.3M12 6.5V8M12 16v1.5"/>',
    gift: '<path d="M4 11h16v9H4zM3 8h18v3H3zM12 8v12"/><path d="M12 8C10 4 6.5 5 7.5 7.2 8 8 12 8 12 8zM12 8c2-4 5.5-3 4.5-.8C16 8 12 8 12 8z"/>',
    sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2.5M12 19.5V22M2 12h2.5M19.5 12H22M4.9 4.9l1.8 1.8M17.3 17.3l1.8 1.8M4.9 19.1l1.8-1.8M17.3 6.7l1.8-1.8"/>',
    pencil: '<path d="M4 20l1-4L16.5 4.5a2.1 2.1 0 0 1 3 3L8 19l-4 1z"/><path d="M14.5 6.5l3 3"/>',
    cap: '<path d="M2 9l10-5 10 5-10 5z"/><path d="M6 11.5V16c1.5 1.5 3.5 2.2 6 2.2s4.5-.7 6-2.2v-4.5M22 9v5"/>',
    medal: '<circle cx="12" cy="15" r="5"/><path d="M9 10.5L6 3h4l2 4 2-4h4l-3 7.5"/>',
    thermometer: '<path d="M10 14.5V5a2 2 0 0 1 4 0v9.5a4 4 0 1 1-4 0z"/><path d="M12 11v5"/>',
    bandage: '<rect x="2.5" y="8" width="19" height="8" rx="4" transform="rotate(-45 12 12)"/><path d="M9.5 9.5l5 5M12 12h.01"/>',
    key: '<circle cx="8" cy="15" r="4"/><path d="M11 12l9-9M16 7l3 3M14 9l2 2"/>',
    pin: '<path d="M12 21s-6.5-6-6.5-11a6.5 6.5 0 0 1 13 0c0 5-6.5 11-6.5 11z"/><circle cx="12" cy="10" r="2.3"/>',
    megaphone: '<path d="M4 10v4h3l8 4V6L7 10H4z"/><path d="M18 9.5a3.5 3.5 0 0 1 0 5"/>',
    ticket: '<path d="M3 8a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v2a2 2 0 0 0 0 4v2a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-2a2 2 0 0 0 0-4z"/><path d="M14 6v12"/>',
    water: '<path d="M12 3s6 6.5 6 11a6 6 0 0 1-12 0c0-4.5 6-11 6-11z"/>',
    shirt: '<path d="M8 3l4 2 4-2 5 4-3 3-2-1.5V21H8V8.5L6 10 3 7z"/>',
    box: '<path d="M4 8l8-4 8 4v8l-8 4-8-4z"/><path d="M4 8l8 4 8-4M12 12v8"/>',
    report: '<path d="M4 20V4M4 20h16"/><path d="M8 16v-4M12 16V8M16 16v-6"/>',
    // field types
    text: '<path d="M5 7V5h14v2M12 5v14M9 19h6"/>',
    textarea: '<path d="M4 6h16M4 10h16M4 14h16M4 18h10"/>',
    number: '<path d="M9 4L7 20M17 4l-2 16M4 9h16M3 15h16"/>',
    date: '<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M3 10h18M8 3v4M16 3v4"/>',
    time: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
    download: '<path d="M12 4v11M7 10l5 5 5-5M5 20h14"/>',
    send: '<path d="M22 2L11 13M22 2l-7 20-4-9-9-4z"/>',
    medicine: '<rect x="3" y="8" width="18" height="8" rx="4"/><path d="M12 8v8"/>',
    camera: '<path d="M4 8h3l2-3h6l2 3h3a1 1 0 0 1 1 1v10a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V9a1 1 0 0 1 1-1z"/><circle cx="12" cy="13" r="3.5"/>',
    laptop: '<rect x="4" y="5" width="16" height="11" rx="1.5"/><path d="M2 19h20"/>',
    survey: '<path d="M9 5h10M9 12h10M9 19h10"/><path d="M4 5l1 1 2-2M4 12l1 1 2-2M4 19l1 1 2-2"/>',
    pickup: '<circle cx="9" cy="7" r="3"/><path d="M3 20a6 6 0 0 1 12 0"/><path d="M16 11l2 2 4-4"/>',
    yesno: '<rect x="2" y="7" width="20" height="10" rx="5"/><circle cx="16" cy="12" r="3"/>',
    choice: '<rect x="3" y="5" width="18" height="14" rx="2"/><path d="M14 11l2 2 2-2"/><path d="M6 12h5"/>',
    checklist: '<path d="M4 6l1.5 1.5L8 5M4 12l1.5 1.5L8 11M4 18l1.5 1.5L8 17M11 6h9M11 12h9M11 18h9"/>',
    rating: '<path d="M12 3l2.7 5.6 6.1.9-4.4 4.3 1 6.1L12 17l-5.4 2.9 1-6.1L3.2 9.5l6.1-.9z"/>',
    email: '<rect x="3" y="5" width="18" height="14" rx="2"/><path d="M3 7l9 6 9-6"/>',
    phone: '<path d="M5 4h4l2 5-2.5 1.5a11 11 0 0 0 5 5L15 13l5 2v4a2 2 0 0 1-2 2A16 16 0 0 1 3 6a2 2 0 0 1 2-2"/>',
    url: '<path d="M10 14a4 4 0 0 0 6 0l3-3a4 4 0 0 0-6-6l-1 1M14 10a4 4 0 0 0-6 0l-3 3a4 4 0 0 0 6 6l1-1"/>',
    file: '<path d="M14 3H6a1 1 0 0 0-1 1v16a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1V8z"/><path d="M14 3v5h5M12 12v6M9 15l3-3 3 3"/>',
    signature: '<path d="M3 17c3 0 4-8 6-8s0 8 2 8 2-4 4-4 1 4 3 4h3"/><path d="M3 21h18"/>',
    instructions: '<circle cx="12" cy="12" r="9"/><path d="M12 11v6M12 7.5h.01"/>',
    // page
    search: '<circle cx="11" cy="11" r="7"/><path d="M20 20l-3.5-3.5"/>',
    plus: '<path d="M12 5v14M5 12h14"/>',
    close: '<path d="M6 6l12 12M18 6L6 18"/>',
    bolt: '<path d="M13 2L4 14h7l-1 8 9-12h-7z"/>',
    task: '<rect x="4" y="4" width="16" height="16" rx="3"/><path d="M8.5 12l2.5 2.5 4.5-5"/>',
    bell: '<path d="M18 16V11a6 6 0 1 0-12 0v5l-2 2h16zM10 21h4"/>',
    info: '<circle cx="12" cy="12" r="9"/><path d="M12 11v6M12 7.5h.01"/>',
    up: '<path d="M12 19V5M6 11l6-6 6 6"/>',
    down: '<path d="M12 5v14M6 13l6 6 6-6"/>',
    staff: '<circle cx="12" cy="8" r="4"/><path d="M4 21c.8-4 4-6 8-6s7.2 2 8 6"/>',
    parent: '<circle cx="9" cy="7" r="3"/><circle cx="17" cy="9" r="2.3"/><path d="M3 20c.6-3.5 3-5.5 6-5.5s5.4 2 6 5.5M15 14.6c.6-.3 1.3-.4 2-.4 2.3 0 4 1.6 4.3 4.8"/>',
    student: '<path d="M2 9l10-5 10 5-10 5z"/><path d="M6 11v5c0 1.5 2.7 3 6 3s6-1.5 6-3v-5"/>',
    list: '<path d="M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01"/>',
    one: '<rect x="4" y="4" width="16" height="16" rx="3"/><path d="M12 8v8M10 9.5l2-1.5"/>',
    lock: '<rect x="4" y="10" width="16" height="11" rx="2"/><path d="M8 10V7a4 4 0 0 1 8 0v3"/>',
    eye: '<path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/>',
    eyeOff: '<path d="M3 3l18 18"/><path d="M10.6 6.1A10 10 0 0 1 12 6c6.5 0 10 6 10 6a17 17 0 0 1-3.2 3.9M6.6 6.6A17 17 0 0 0 2 12s3.5 7 10 7a9.7 9.7 0 0 0 5.4-1.6"/><path d="M9.9 9.9a3 3 0 0 0 4.2 4.2"/>',
    caretUp: '<path d="M6 15l6-6 6 6"/>',
    caretDown: '<path d="M6 9l6 6 6-6"/>',
    trash: '<path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13"/>',
    copy: '<rect x="8" y="8" width="12" height="12" rx="2"/><path d="M16 8V5a1 1 0 0 0-1-1H5a1 1 0 0 0-1 1v10a1 1 0 0 0 1 1h3"/>',
    pause: '<path d="M9 5v14M15 5v14"/>',
    play: '<path d="M7 5l12 7-12 7z"/>',
    edit: '<path d="M4 20h4L19 9l-4-4L4 16z"/>',
    external: '<path d="M14 4h6v6M20 4l-9 9M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5"/>',
    check: '<path d="M5 12.5l4.5 4.5L19 7.5"/>',
    folder: '<path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/>'
  };
  function icon(name, size) {
    var s = size || 18;
    return '<svg width="' + s + '" height="' + s + '" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + (P[name] || P.form) + '</svg>';
  }
  var STAR = '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M12 3l2.7 5.6 6.1.9-4.4 4.3 1 6.1L12 17l-5.4 2.9 1-6.1L3.2 9.5l6.1-.9z"/></svg>';

  function esc(value) {
    return String(value === null || value === undefined ? '' : value).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function isEmpty(v) {
    return v === null || v === undefined || v === '' || (Array.isArray(v) && !v.length) || (typeof v === 'object' && !Array.isArray(v) && !Object.keys(v).length);
  }
  function asText(v) {
    if (v === true) return 'yes';
    if (v === false) return 'no';
    if (Array.isArray(v)) return v.map(function (i) { return i && typeof i === 'object' ? i.name : i; }).join(', ');
    if (v && typeof v === 'object') return v.name || '';
    return v === null || v === undefined ? '' : String(v);
  }
  function conditionMet(cond, value) {
    if (!cond) return true;
    var want = String(cond.value || '').trim().toLowerCase();
    if (cond.op === 'filled') return !isEmpty(value);
    if (cond.op === 'empty') return isEmpty(value);
    if (Array.isArray(value)) {
      var items = value.map(function (i) { return String(i && typeof i === 'object' ? i.name : i).toLowerCase(); });
      if (cond.op === 'contains' || cond.op === 'is') return items.indexOf(want) !== -1;
      if (cond.op === 'is_not') return items.indexOf(want) === -1;
      return false;
    }
    var have = asText(value).trim().toLowerCase();
    if (cond.op === 'is') return have === want;
    if (cond.op === 'is_not') return have !== want;
    if (cond.op === 'contains') return have.indexOf(want) !== -1;
    if (cond.op === 'more' || cond.op === 'less') {
      if (isEmpty(value)) return false;
      var a = Number(have), b = Number(want);
      if (have !== '' && want !== '' && isFinite(a) && isFinite(b)) return cond.op === 'more' ? a > b : a < b;
      return cond.op === 'more' ? have > want : have < want;
    }
    return false;
  }
  function isVisible(field, data, byId, depth) {
    depth = depth || 0;
    if (!field || field.retired) return false;
    if (!field.cond || depth > 10) return true;
    var control = byId[field.cond.field];
    if (!control) return true;
    var value = isVisible(control, data, byId, depth + 1) ? data[control.id] : null;
    var met = conditionMet(field.cond, value);
    return field.cond.action === 'hide' ? !met : met;
  }
  function fmtDate(v) {
    var d = new Date(String(v) + 'T00:00:00');
    return isNaN(d.getTime()) ? String(v) : d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
  }
  function display(field, v) {
    if (isEmpty(v)) return '';
    if (field.type === 'yesno') return v ? 'Yes' : 'No';
    if (field.type === 'rating') return v + ' / 5';
    if (field.type === 'date') return fmtDate(v);
    if (field.type === 'time') { var hm = String(v).split(':'); return new Date(2000, 0, 1, Number(hm[0]), Number(hm[1])).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' }); }
    if (field.type === 'signature') return 'Signed by ' + v.name + (v.at ? ' on ' + new Date(v.at).toLocaleDateString() : '');
    if (field.type === 'seat') return 'Row ' + v.r + ', seat ' + v.c;
    return asText(v);
  }
  function answerIcon(field, value) {
    if (!field || field.display !== 'icons') return '';
    if (field.type === 'yesno') return value === true || value === 'yes' ? 'check' : value === false || value === 'no' ? 'close' : '';
    return (field.icons || {})[value] || '';
  }
  // The choices a field offers as [value, label, icon], for tap-to-answer buttons.
  function choicesOf(field) {
    if (field.type === 'yesno') return [['yes', 'Yes', answerIcon(field, 'yes')], ['no', 'No', answerIcon(field, 'no')]];
    return (field.options || []).map(function (o) { return [o, o, answerIcon(field, o)]; });
  }
  var seq = 0;
  var hasInput = function (f) { return f.type !== 'instructions'; };

  // Choices as icon tiles: the icon with its words under it (a choice without an icon shows its words).
  function iconChoices(field, id, current) {
    return '<div class="cff-icons" role="radiogroup">' + choicesOf(field).map(function (c) {
      return '<label class="cff-iconopt" title="' + esc(c[1]) + '"><input type="radio" name="' + id + '" value="' + esc(c[0]) + '"' + (String(current) === String(c[0]) ? ' checked' : '') + ' />'
        + '<span>' + (c[2] ? icon(c[2], 26) : '') + '<small>' + esc(c[1]) + '</small></span></label>';
    }).join('') + '</div>';
  }
  function controlHtml(field, value, uid, opts) {
    var id = uid + field.id;
    var name = ' name="' + id + '" id="' + id + '"';
    var ph = field.placeholder ? ' placeholder="' + esc(field.placeholder) + '"' : '';
    switch (field.type) {
      case 'textarea': return '<textarea class="cff-input" rows="4"' + name + ph + '>' + esc(value || '') + '</textarea>';
      case 'number': return '<input class="cff-input" type="number" step="any" inputmode="decimal"' + name + ' value="' + esc(value === null || value === undefined ? '' : value) + '" />';
      case 'date': return '<input class="cff-input" type="date"' + name + ' value="' + esc(value || '') + '" />';
      case 'time': return '<input class="cff-input" type="time"' + name + ' value="' + esc(value || '') + '" />';
      case 'email': return '<input class="cff-input" type="email" autocomplete="email"' + name + ' value="' + esc(value || '') + '" />';
      case 'phone': return '<input class="cff-input" type="tel" autocomplete="tel"' + name + ' value="' + esc(value || '') + '" />';
      case 'url': return '<input class="cff-input" type="url" placeholder="https://"' + name + ' value="' + esc(value || '') + '" />';
      case 'yesno':
        if (field.display === 'icons') return iconChoices(field, id, value === true ? 'yes' : value === false ? 'no' : '');
        return '<div class="cff-pills" role="radiogroup">' + [['yes', 'Yes', value === true], ['no', 'No', value === false]].map(function (o) {
          return '<label class="cff-pill"><input type="radio" name="' + id + '" value="' + o[0] + '"' + (o[2] ? ' checked' : '') + ' /><span>' + o[1] + '</span></label>';
        }).join('') + '</div>';
      case 'choice':
        if (field.display === 'icons') return iconChoices(field, id, value);
        if (field.display === 'buttons') {
          return '<div class="cff-pills" role="radiogroup">' + (field.options || []).map(function (o) {
            return '<label class="cff-pill"><input type="radio" name="' + id + '" value="' + esc(o) + '"' + (value === o ? ' checked' : '') + ' /><span>' + esc(o) + '</span></label>';
          }).join('') + '</div>';
        }
        return '<select class="cff-input"' + name + '><option value="">Choose…</option>' + (field.options || []).map(function (o) {
          return '<option' + (value === o ? ' selected' : '') + '>' + esc(o) + '</option>';
        }).join('') + '</select>';
      case 'checklist':
        return '<div class="cff-checks">' + (field.options || []).map(function (o) {
          var on = Array.isArray(value) && value.indexOf(o) !== -1;
          return '<label><input type="checkbox" name="' + id + '" value="' + esc(o) + '"' + (on ? ' checked' : '') + ' />' + esc(o) + '</label>';
        }).join('') + '</div>';
      case 'rating':
        var stars = '';
        for (var n = 1; n <= 5; n += 1) {
          stars += '<label class="' + (value >= n ? 'is-on' : '') + '" title="' + n + ' of 5"><input type="radio" name="' + id + '" value="' + n + '"' + (value === n ? ' checked' : '') + ' />' + STAR + '</label>';
        }
        return '<div class="cff-stars" role="radiogroup">' + stars + '</div>';
      case 'file':
        var files = Array.isArray(value) ? value : [];
        return '<label class="cff-drop">' + icon('file') + '<span>' + (opts.preview ? 'Upload a file' : 'Choose a file to upload') + '</span><input type="file" id="' + id + '" /></label>'
          + '<ul class="cff-files">' + files.map(function (f, i) {
            return '<li><a href="' + esc(f.url) + '" target="_blank" rel="noopener">' + esc(f.name) + '</a><button type="button" data-remove-file="' + i + '">Remove</button></li>';
          }).join('') + '</ul>';
      case 'signature':
        var sig = value && typeof value === 'object' ? value : {};
        return '<div class="cff-sign"><input class="cff-input" type="text" autocomplete="name" placeholder="Type your full name" id="' + id + '" value="' + esc(sig.name || '') + '" />'
          + '<label><input type="checkbox" data-agree' + (sig.agreed ? ' checked' : '') + ' />I confirm this is my signature and I agree to the above.</label>'
          + (sig.at ? '<p class="cff-signed">Signed ' + esc(new Date(sig.at).toLocaleString()) + '</p>' : '') + '</div>';
      case 'seat':
        // A seat is a row and a place in it (the seating chart sets it by a tap).
        var seat = value && typeof value === 'object' ? value : {};
        return '<div class="cff-seat"><label>Row <input class="cff-input" type="number" min="1" max="40" inputmode="numeric" data-seat="r" value="' + esc(seat.r || '') + '" /></label>'
          + '<label>Seat <input class="cff-input" type="number" min="1" max="40" inputmode="numeric" data-seat="c" value="' + esc(seat.c || '') + '" /></label></div>';
      default: return '<input class="cff-input" type="text"' + name + ph + ' value="' + esc(value || '') + '" />';
    }
  }

  function fieldHtml(field, value, uid, opts) {
    var cls = 'cff-field' + (field.width === 'half' ? ' cff-field--half' : '');
    if (field.type === 'instructions') {
      return '<div class="' + cls + '" data-field="' + esc(field.id) + '"><div class="cff-instructions">' + (field.label ? '<strong>' + esc(field.label) + '</strong>' : '') + esc(field.help || '') + '</div></div>';
    }
    var labelFor = ['yesno', 'checklist', 'rating'].indexOf(field.type) !== -1 || (field.type === 'choice' && field.display === 'buttons') ? '' : ' for="' + uid + field.id + '"';
    return '<div class="' + cls + '" data-field="' + esc(field.id) + '">'
      + '<label class="cff-label"' + labelFor + '>' + esc(field.label) + (field.required ? '<span class="cff-req" aria-hidden="true">*</span>' : '') + '</label>'
      + controlHtml(field, value, uid, opts)
      + (field.help ? '<p class="cff-help">' + esc(field.help) + '</p>' : '')
      + '<p class="cff-error" hidden></p></div>';
  }

  // An editable form. opts: values, upload(file) -> Promise<{name,key,url}>, onChange, preview.
  function mount(container, section, opts) {
    opts = opts || {};
    var uid = 'cff' + (seq += 1) + '_';
    var fields = (section.fields || []).filter(function (f) { return !f.retired; });
    var byId = {};
    (section.fields || []).forEach(function (f) { byId[f.id] = f; });
    var values = JSON.parse(JSON.stringify(opts.values || {}));
    container.classList.add('cff');
    container.innerHTML = fields.length ? fields.map(function (f) { return fieldHtml(f, values[f.id], uid, opts); }).join('')
      : '<div class="cff-empty">' + (opts.preview ? 'Add a field and it shows here.' : 'This form has no fields yet.') + '</div>';

    function wrapOf(el) { return el.closest('[data-field]'); }
    function fieldOf(el) { var w = wrapOf(el); return w ? byId[w.getAttribute('data-field')] : null; }
    function apply() {
      fields.forEach(function (f) {
        var w = container.querySelector('[data-field="' + f.id + '"]');
        if (w) w.hidden = !isVisible(f, values, byId);
      });
    }
    function read(f) {
      var w = container.querySelector('[data-field="' + f.id + '"]');
      if (!w) return;
      if (f.type === 'yesno') {
        var y = w.querySelector('input:checked');
        values[f.id] = y ? y.value === 'yes' : null;
      } else if (f.type === 'checklist') {
        values[f.id] = Array.prototype.map.call(w.querySelectorAll('input:checked'), function (i) { return i.value; });
      } else if (f.type === 'rating' || (f.type === 'choice' && (f.display === 'buttons' || f.display === 'icons'))) {
        var r = w.querySelector('input:checked');
        values[f.id] = r ? (f.type === 'rating' ? Number(r.value) : r.value) : null;
        if (f.type === 'rating') Array.prototype.forEach.call(w.querySelectorAll('.cff-stars label'), function (l, i) { l.classList.toggle('is-on', r && i < Number(r.value)); });
      } else if (f.type === 'signature') {
        var nameInput = w.querySelector('input[type="text"]');
        var prev = values[f.id] && typeof values[f.id] === 'object' ? values[f.id] : {};
        values[f.id] = nameInput.value.trim() ? { name: nameInput.value.trim(), agreed: w.querySelector('[data-agree]').checked, at: prev.name === nameInput.value.trim() ? prev.at : undefined } : null;
      } else if (f.type === 'seat') {
        var row = Number(w.querySelector('[data-seat="r"]').value), place = Number(w.querySelector('[data-seat="c"]').value);
        values[f.id] = row >= 1 && place >= 1 ? { r: row, c: place } : null;
      } else if (f.type === 'file') {
        return;
      } else {
        var input = w.querySelector('.cff-input');
        values[f.id] = input ? input.value : null;
      }
    }
    function changed(e) {
      var f = fieldOf(e.target);
      if (!f) return;
      if (f.type === 'file' && e.target.type === 'file') return upload(f, e.target);
      read(f);
      clearError(f.id);
      apply();
      if (opts.onChange) opts.onChange(values);
    }
    function renderFiles(f) {
      var w = container.querySelector('[data-field="' + f.id + '"] .cff-files');
      var list = Array.isArray(values[f.id]) ? values[f.id] : [];
      w.innerHTML = list.map(function (file, i) {
        return '<li><a href="' + esc(file.url) + '" target="_blank" rel="noopener">' + esc(file.name) + '</a><button type="button" data-remove-file="' + i + '">Remove</button></li>';
      }).join('');
    }
    function upload(f, input) {
      var file = input.files && input.files[0];
      if (!file) return;
      if (!opts.upload) { input.value = ''; return; }
      var drop = input.closest('.cff-drop');
      drop.classList.add('is-busy');
      opts.upload(file).then(function (saved) {
        var list = Array.isArray(values[f.id]) ? values[f.id] : [];
        if (list.length >= 5) throw new Error('Up to 5 files.');
        values[f.id] = list.concat([saved]);
        renderFiles(f);
        clearError(f.id);
        apply();
        if (opts.onChange) opts.onChange(values);
      }).catch(function (err) {
        showError(f.id, (err && err.message) || 'That file could not be uploaded.');
      }).then(function () { drop.classList.remove('is-busy'); input.value = ''; });
    }
    container.addEventListener('input', changed);
    container.addEventListener('change', changed);
    container.addEventListener('click', function (e) {
      var rm = e.target.closest('[data-remove-file]');
      if (!rm) return;
      var f = fieldOf(rm);
      var list = (values[f.id] || []).slice();
      list.splice(Number(rm.getAttribute('data-remove-file')), 1);
      values[f.id] = list.length ? list : null;
      renderFiles(f);
      apply();
      if (opts.onChange) opts.onChange(values);
    });
    function showError(fieldId, message) {
      var w = container.querySelector('[data-field="' + fieldId + '"]');
      if (!w) return;
      w.classList.add('has-error');
      var p = w.querySelector('.cff-error');
      if (p) { p.textContent = message; p.hidden = false; }
    }
    function clearError(fieldId) {
      var w = container.querySelector('[data-field="' + fieldId + '"]');
      if (!w) return;
      w.classList.remove('has-error');
      var p = w.querySelector('.cff-error');
      if (p) p.hidden = true;
    }
    apply();
    return {
      // What shows, as the server wants it.
      values: function () {
        var out = {};
        fields.forEach(function (f) {
          if (!hasInput(f) || !isVisible(f, values, byId)) return;
          if (!isEmpty(values[f.id])) out[f.id] = values[f.id];
        });
        return out;
      },
      // Quick check before sending; the server checks again.
      validate: function () {
        var errors = [];
        fields.forEach(function (f) {
          clearError(f.id);
          if (!hasInput(f) || !isVisible(f, values, byId)) return;
          var v = values[f.id];
          if (f.required && isEmpty(v)) errors.push({ field: f.id, message: f.label + ' is required.' });
          else if (f.type === 'signature' && v && !v.agreed) errors.push({ field: f.id, message: 'Tick the box to sign.' });
        });
        errors.forEach(function (e) { showError(e.field, e.message); });
        if (errors.length) {
          var first = container.querySelector('[data-field="' + errors[0].field + '"]');
          if (first) first.scrollIntoView({ block: 'center', behavior: 'smooth' });
        }
        return errors;
      },
      showErrors: function (list) { (list || []).forEach(function (e) { showError(e.field, e.message); }); }
    };
  }

  // What was filled in, read only.
  function view(container, section, data) {
    var byId = {};
    (section.fields || []).forEach(function (f) { byId[f.id] = f; });
    var rows = (section.fields || []).filter(function (f) { return hasInput(f) && isVisible(f, data || {}, byId); }).map(function (f) {
      var v = (data || {})[f.id];
      var body;
      if (f.type === 'file' && Array.isArray(v)) body = v.map(function (file) { return '<a href="' + esc(file.url) + '" target="_blank" rel="noopener">' + esc(file.name) + '</a>'; }).join('<br>');
      else if (f.type === 'url' && v) body = '<a href="' + esc(v) + '" target="_blank" rel="noopener">' + esc(v) + '</a>';
      else body = (answerIcon(f, v) ? '<span class="cff-answericon">' + icon(answerIcon(f, v), 16) + '</span>' : '') + esc(display(f, v));
      return '<div class="' + (f.width === 'half' ? 'cff-field--half' : '') + '"><dt>' + esc(f.label) + '</dt><dd' + (body ? '' : ' class="is-empty"') + '>' + (body || '—') + '</dd></div>';
    });
    container.innerHTML = '<dl class="cff-view">' + (rows.join('') || '<div><dd class="is-empty">Nothing filled in.</dd></div>') + '</dl>';
  }

  window.CustomFormRender = { mount: mount, view: view, isVisible: isVisible, conditionMet: conditionMet, display: display, esc: esc, icon: icon, isEmpty: isEmpty, answerIcon: answerIcon, choicesOf: choicesOf };
  // The server draws the same icons on tiles and menu items (app.locals.formIcon).
  if (typeof module !== 'undefined' && module.exports) module.exports = { icon: icon };
})(typeof window !== 'undefined' ? window : {});
