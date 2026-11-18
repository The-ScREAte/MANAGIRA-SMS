/* First-time setup (views/common/firstSetup.ejs, utils/firstSetup.js): one step at a time, each
 * saved as the person continues. The colour and the details are asked; the logo, the school
 * year and the website's look can be skipped. The preview follows the colour, logo and name. */
(function () {
  'use strict';
  var config = window.FIRST_SETUP || { steps: ['color', 'logo', 'details'], labels: {} };
  var steps = config.steps.slice();
  var labels = config.labels || {};
  var SKIPPABLE = { logo: true, year: true, calendar: true, website: true };
  var hasTerms = Boolean(config.hasTerms);
  var index = 0;
  var busy = false;
  var summary = {};
  var logoFile = null;

  var $ = function (id) { return document.getElementById(id); };
  var root = document.documentElement;
  var nextBtn = $('fsNext');
  var backBtn = $('fsBack');
  var skipBtn = $('fsSkip');
  var errorBox = $('fsError');
  var bars = Array.prototype.slice.call(document.querySelectorAll('.fs-progress span'));

  function section(name) { return document.querySelector('.fs-step[data-step="' + name + '"]'); }

  function showError(message) {
    errorBox.textContent = message || '';
    errorBox.hidden = !message;
  }

  function render() {
    var name = steps[index];
    document.querySelectorAll('.fs-step').forEach(function (el) { el.hidden = el.getAttribute('data-step') !== name; });
    bars.forEach(function (bar, i) {
      bar.className = i < index ? 'is-done' : (i === index ? 'is-now' : '');
    });
    $('fsCount').textContent = 'Step ' + (index + 1) + ' of ' + steps.length + ' · ' + (labels[name] || '');
    backBtn.hidden = index === 0;
    skipBtn.hidden = !SKIPPABLE[name];
    nextBtn.textContent = index === steps.length - 1 ? 'Finish' : 'Continue';
    showError('');
    if (name === 'calendar') loadHolidays();
    var heading = section(name).querySelector('h1');
    if (heading) { heading.setAttribute('tabindex', '-1'); heading.focus({ preventScroll: true }); }
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  // ── Saving ─────────────────────────────────────────────────────────────
  function send(url, body, isForm) {
    var options = { method: 'POST', credentials: 'same-origin', headers: { Accept: 'application/json', 'X-Requested-With': 'XMLHttpRequest' } };
    if (isForm) options.body = body;
    else { options.headers['Content-Type'] = 'application/json'; options.body = JSON.stringify(body || {}); }
    return fetch(url, options).then(function (res) {
      return res.json().catch(function () { return {}; }).then(function (data) {
        // Signed out meanwhile: the login page says so.
        if (res.status === 401) { window.location.href = data.redirect || '/account/login'; return new Promise(function () {}); }
        if (!res.ok) throw new Error(data.error || 'That couldn’t be saved. Try again.');
        return data;
      });
    });
  }

  var savers = {
    color: function () {
      var picked = document.querySelector('input[name="color"]:checked');
      if (!picked) return Promise.reject(new Error('Choose a colour.'));
      return send('/common/first-setup/color', { color: picked.value }).then(function () {
        summary.color = 'Colour: ' + picked.closest('label').querySelector('span').textContent;
      });
    },
    logo: function () {
      if (!logoFile) return Promise.reject(new Error('Choose a picture of your logo, or skip for now.'));
      var form = new FormData();
      form.append('logo', logoFile);
      return send('/common/first-setup/logo', form, true).then(function () { summary.logo = 'Logo added'; });
    },
    details: function () {
      var form = $('fsDetails');
      var data = {};
      new FormData(form).forEach(function (value, key) { data[key] = value; });
      if (!String(data.name || '').trim()) { $('fsName').focus(); return Promise.reject(new Error('Enter your school’s name.')); }
      return send('/common/first-setup/details', data).then(function () { summary.details = 'School details saved'; });
    },
    year: function () {
      var structure = document.querySelector('input[name="structure"]:checked');
      return send('/common/first-setup/year', {
        label: $('fsYearLabel').value.trim(),
        start: $('fsYearStart').value,
        end: $('fsYearEnd').value,
        structure: structure ? structure.value : ''
      }).then(function (data) {
        summary.year = 'School year ' + data.label + ' (' + data.current + ' is current)';
        hasTerms = true;
        holidaysLoaded = false;
      });
    },
    calendar: function () {
      var days = Array.prototype.map.call(document.querySelectorAll('input[name="schoolDay"]:checked'), function (i) { return Number(i.value); });
      if (!days.length) return Promise.reject(new Error('Choose at least one school day.'));
      var daysOff = [];
      var problem = '';
      document.querySelectorAll('.fs-dayoff').forEach(function (row) {
        var date = row.querySelector('input[type="date"]').value;
        var label = row.querySelector('input[type="text"]').value.trim();
        if (!date && !label) return;
        if (!date) problem = 'Each day off needs a date.';
        else if (!label) problem = 'Give each day off a name, such as Thanksgiving break.';
        daysOff.push({ date: date, label: label });
      });
      if (problem) return Promise.reject(new Error(problem));
      return send('/common/first-setup/calendar', { schoolDays: days, publicHolidays: $('fsHolidays').checked, daysOff: daysOff }).then(function (data) {
        var names = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
        var order = [1, 2, 3, 4, 5, 6, 0].filter(function (d) { return data.schoolDays.indexOf(d) !== -1; });
        var parts = ['School days ' + order.map(function (d) { return names[d]; }).join(', ')];
        if (data.holidays) parts.push(data.holidays + ' public holiday' + (data.holidays === 1 ? '' : 's'));
        if (data.daysOff) parts.push(data.daysOff + ' day' + (data.daysOff === 1 ? '' : 's') + ' off');
        summary.calendar = 'Calendar: ' + parts.join(', ');
      });
    },
    website: function () {
      var picked = document.querySelector('input[name="layout"]:checked');
      if (!picked) return Promise.reject(new Error('Choose a design, or skip for now.'));
      return send('/common/first-setup/website', { layout: picked.value }).then(function () {
        summary.website = 'Website design: ' + picked.closest('label').querySelector('strong').firstChild.textContent.trim();
      });
    }
  };

  var SKIPPED_TEXT = { logo: 'Logo: add it any time in Settings', year: 'School year: set it up from the setup steps', calendar: 'Calendar: set school days and days off in Settings › School rules', website: 'Website: choose a design in Website settings' };

  function advance() {
    if (index < steps.length - 1) {
      index += 1;
      // No school year, so no calendar to set: on to the next step.
      if (steps[index] === 'calendar' && !hasTerms) { advance(); return; }
      render();
      return;
    }
    finish();
  }

  function finish() {
    busy = true;
    nextBtn.disabled = true;
    send('/common/first-setup/finish', {}).then(function () {
      var list = $('fsSummary');
      list.textContent = '';
      steps.forEach(function (name) {
        var done = Boolean(summary[name]);
        var li = document.createElement('li');
        if (!done) li.className = 'is-skipped';
        li.innerHTML = done
          ? '<svg viewBox="0 0 20 20" fill="none" aria-hidden="true"><circle cx="10" cy="10" r="9" fill="currentColor" opacity=".14"/><path d="M6 10.5l2.5 2.5L14 7.5" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>'
          : '<svg viewBox="0 0 20 20" fill="none" aria-hidden="true"><circle cx="10" cy="10" r="8.5" stroke="currentColor" stroke-width="1.6"/></svg>';
        var text = document.createElement('span');
        text.textContent = done ? summary[name] : (SKIPPED_TEXT[name] || labels[name]);
        li.appendChild(text);
        list.appendChild(li);
      });
      document.querySelectorAll('.fs-step').forEach(function (el) { el.hidden = el.getAttribute('data-step') !== 'done'; });
      bars.forEach(function (bar) { bar.className = 'is-done'; });
      $('fsCount').textContent = 'All set';
      $('fsActions').hidden = true;
      showError('');
      $('fsGo').focus();
    }).catch(function (error) {
      showError(error.message);
    }).then(function () {
      busy = false;
      nextBtn.disabled = false;
    });
  }

  nextBtn.addEventListener('click', function () {
    if (busy) return;
    var name = steps[index];
    busy = true;
    nextBtn.disabled = true;
    var label = nextBtn.textContent;
    nextBtn.textContent = 'Saving…';
    showError('');
    savers[name]().then(function () {
      busy = false;
      nextBtn.disabled = false;
      advance();
    }).catch(function (error) {
      busy = false;
      nextBtn.disabled = false;
      nextBtn.textContent = label;
      showError(error.message);
    });
  });
  skipBtn.addEventListener('click', function () { if (!busy) advance(); });
  backBtn.addEventListener('click', function () {
    if (busy || index === 0) return;
    index -= 1;
    if (steps[index] === 'calendar' && !hasTerms && index > 0) index -= 1;
    render();
  });
  $('fsDetails').addEventListener('submit', function (event) { event.preventDefault(); nextBtn.click(); });

  // ── Colour: the page and preview follow the choice ──────────────────────
  document.querySelectorAll('input[name="color"]').forEach(function (input) {
    input.addEventListener('change', function () { root.style.setProperty('--brand', input.getAttribute('data-hex')); });
  });

  // ── Logo: chosen or dropped, shown at once ──────────────────────────────
  var drop = $('fsDrop');
  var fileInput = $('fsLogo');
  var TYPES = ['image/png', 'image/jpeg', 'image/webp', 'image/gif'];
  function takeFile(file) {
    if (!file) return;
    if (TYPES.indexOf(file.type) === -1) { showError('Use a PNG, JPG, WebP or GIF picture.'); return; }
    if (file.size > 5 * 1024 * 1024) { showError('Use a picture under 5 MB.'); return; }
    showError('');
    logoFile = file;
    var url = URL.createObjectURL(file);
    var body = $('fsDropBody');
    body.textContent = '';
    var img = document.createElement('img');
    img.src = url;
    img.alt = 'Your logo';
    var note = document.createElement('small');
    note.textContent = 'Choose another picture';
    body.appendChild(img);
    body.appendChild(document.createElement('br'));
    body.appendChild(note);
    var preview = $('fsPreviewLogo');
    preview.textContent = '';
    var small = document.createElement('img');
    small.src = url;
    small.alt = '';
    preview.appendChild(small);
  }
  fileInput.addEventListener('change', function () { takeFile(fileInput.files && fileInput.files[0]); });
  ['dragenter', 'dragover'].forEach(function (type) {
    drop.addEventListener(type, function (event) { event.preventDefault(); drop.classList.add('is-over'); });
  });
  ['dragleave', 'drop'].forEach(function (type) {
    drop.addEventListener(type, function () { drop.classList.remove('is-over'); });
  });
  drop.addEventListener('drop', function (event) {
    event.preventDefault();
    takeFile(event.dataTransfer && event.dataTransfer.files && event.dataTransfer.files[0]);
  });

  // ── Details: the preview shows the name ─────────────────────────────────
  function showName() {
    var name = ($('fsShort').value.trim() || $('fsName').value.trim() || 'Your school');
    $('fsPreviewName').textContent = name;
    var mark = $('fsPreviewLogo');
    if (!mark.querySelector('img')) mark.textContent = name.charAt(0).toUpperCase();
  }
  $('fsName').addEventListener('input', showName);
  $('fsShort').addEventListener('input', showName);

  // ── School year: the terms as they'll be saved (the same split as utils/firstSetup.js) ──
  var STRUCTURES = {
    semesters: ['Fall Semester', 'Spring Semester'],
    trimesters: ['Trimester 1', 'Trimester 2', 'Trimester 3'],
    quarters: ['Quarter 1', 'Quarter 2', 'Quarter 3', 'Quarter 4'],
    year: ['Full Year']
  };
  var DAY = 86400000;
  function parseDay(value) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(value || '')) return null;
    var date = new Date(value + 'T00:00:00Z');
    return isNaN(date.getTime()) ? null : date;
  }
  function iso(date) { return date.toISOString().slice(0, 10); }
  function nice(date) { return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' }); }
  function termsFor(structure, start, end) {
    var names = STRUCTURES[structure];
    var a = parseDay(start);
    var b = parseDay(end);
    if (!names || !a || !b || b <= a) return null;
    var days = Math.round((b - a) / DAY) + 1;
    if (days < names.length * 7) return null;
    var from = a;
    return names.map(function (name, i) {
      var to = i === names.length - 1 ? b : new Date(a.getTime() + (Math.round((days * (i + 1)) / names.length) - 1) * DAY);
      var term = { name: name, start: from, end: to };
      from = new Date(to.getTime() + DAY);
      return term;
    });
  }
  function showTerms() {
    var list = $('fsTerms');
    if (!list) return;
    var structure = document.querySelector('input[name="structure"]:checked');
    var terms = termsFor(structure && structure.value, $('fsYearStart').value, $('fsYearEnd').value);
    list.textContent = '';
    if (!terms) {
      var li = document.createElement('li');
      li.textContent = 'Choose a first and last day, with the last day after the first.';
      list.appendChild(li);
      return;
    }
    var today = iso(new Date());
    var current = terms.findIndex(function (t) { return iso(t.end) >= today; });
    if (current < 0) current = 0;
    terms.forEach(function (term, i) {
      var li = document.createElement('li');
      var name = document.createElement('b');
      name.textContent = term.name;
      if (i === current) { var tag = document.createElement('em'); tag.textContent = 'Current'; name.appendChild(tag); }
      var dates = document.createElement('span');
      dates.textContent = nice(term.start) + ' – ' + nice(term.end);
      li.appendChild(name);
      li.appendChild(dates);
      list.appendChild(li);
    });
  }
  if ($('fsTerms')) {
    ['fsYearStart', 'fsYearEnd'].forEach(function (id) { $(id).addEventListener('input', showTerms); $(id).addEventListener('change', showTerms); });
    document.querySelectorAll('input[name="structure"]').forEach(function (input) { input.addEventListener('change', showTerms); });
    // The year's label follows its first day's year.
    $('fsYearStart').addEventListener('change', function () {
      var a = parseDay($('fsYearStart').value);
      if (a) $('fsYearLabel').value = a.getUTCFullYear() + '-' + (a.getUTCFullYear() + 1);
    });
    showTerms();
  }

  // ── Calendar: this year's public holidays, and days off ──────────────────
  var holidaysLoaded = false;
  function loadHolidays() {
    if (holidaysLoaded || !$('fsHolidayList')) return;
    holidaysLoaded = true;
    fetch('/common/first-setup/holidays', { credentials: 'same-origin', headers: { Accept: 'application/json' } })
      .then(function (res) { return res.ok ? res.json() : null; })
      .catch(function () { return null; })
      .then(function (data) {
        var note = $('fsHolidaysNote');
        var list = $('fsHolidayList');
        list.textContent = '';
        if (!data || !data.holidays) { note.textContent = 'Your country’s public holidays during the school year.'; return; }
        note.textContent = data.holidays.length
          ? data.holidays.length + ' public holiday' + (data.holidays.length === 1 ? '' : 's') + ' in ' + data.countryName + ' during your school year.'
          : 'No public holidays found for ' + data.countryName + ' during your school year.';
        data.holidays.forEach(function (h) {
          var li = document.createElement('li');
          var name = document.createElement('b');
          name.textContent = h.name;
          name.style.fontWeight = '500';
          var when = document.createElement('span');
          when.textContent = nice(new Date(h.date + 'T00:00:00Z'));
          li.appendChild(name);
          li.appendChild(when);
          list.appendChild(li);
        });
        list.hidden = !data.holidays.length || !$('fsHolidays').checked;
      });
  }
  if ($('fsHolidays')) {
    $('fsHolidays').addEventListener('change', function () {
      $('fsHolidayList').hidden = !this.checked || !$('fsHolidayList').children.length;
    });
    var addDayOff = function (focus) {
      var row = document.createElement('div');
      row.className = 'fs-dayoff';
      var date = document.createElement('input');
      date.type = 'date';
      date.setAttribute('aria-label', 'Date');
      var label = document.createElement('input');
      label.type = 'text';
      label.maxLength = 80;
      label.placeholder = 'e.g. Thanksgiving break';
      label.setAttribute('aria-label', 'Name');
      var remove = document.createElement('button');
      remove.type = 'button';
      remove.setAttribute('aria-label', 'Remove this day off');
      remove.textContent = '×';
      remove.addEventListener('click', function () { row.remove(); });
      row.appendChild(date);
      row.appendChild(label);
      row.appendChild(remove);
      $('fsDaysOff').appendChild(row);
      if (focus) date.focus();
    };
    $('fsAddDayOff').addEventListener('click', function () {
      if (document.querySelectorAll('.fs-dayoff').length >= 40) return;
      addDayOff(true);
    });
  }

  render();
})();
