/* First-time setup (views/common/firstSetup.ejs, utils/firstSetup.js): only what the school
 * hasn't set, one step at a time; Continue moves on at once and each step saves in the background. The colour and the
 * details are asked; the logo, school year, calendar and website's look can be skipped. The
 * preview beside it shows each step's choice, lightly: the app's header, a report card's
 * heading, the term bar, a school week, the website. */
(function () {
  'use strict';
  var config = window.FIRST_SETUP || { steps: [], labels: {} };
  var steps = config.steps.slice();
  var labels = config.labels || {};
  var school = config.school || {};
  var SKIPPABLE = { logo: true, year: true, calendar: true, website: true };
  var hasTerms = Boolean(config.hasTerms);
  var index = 0;
  var busy = false;
  var summary = {};
  var logoFile = null;
  var logoUrl = school.logo || '';

  var $ = function (id) { return document.getElementById(id); };
  var root = document.documentElement;
  var nextBtn = $('fsNext');
  var backBtn = $('fsBack');
  var skipBtn = $('fsSkip');
  var errorBox = $('fsError');
  var bars = Array.prototype.slice.call(document.querySelectorAll('.fs-progress span'));

  function section(name) { return document.querySelector('.fs-step[data-step="' + name + '"]'); }
  function brand() { return getComputedStyle(root).getPropertyValue('--brand').trim() || '#01535b'; }
  function showError(message) { errorBox.textContent = message || ''; errorBox.hidden = !message; }

  // ── Dates ──────────────────────────────────────────────────────────────
  var DAY = 86400000;
  function parseDay(value) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(value || '')) return null;
    var date = new Date(value + 'T00:00:00Z');
    return isNaN(date.getTime()) ? null : date;
  }
  function iso(date) { return date.toISOString().slice(0, 10); }
  function nice(date) { return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' }); }

  // ── Preview ────────────────────────────────────────────────────────────
  var PREVIEW_FOR = { color: 'app', logo: 'app', details: 'doc', year: 'year', calendar: 'calendar', website: 'website', done: 'app' };
  var NOTES = {
    app: 'This is how your colour and logo look to your staff. Families and visitors see them too.',
    doc: 'Your details head report cards, transcripts and emails to families.',
    year: 'The dashboard and attendance follow the current term.',
    calendar: 'Attendance is taken only on school days.',
    website: 'A sketch of your website’s home page. Your photos and news fill it in.'
  };
  function showPreview(name) {
    var which = PREVIEW_FOR[name] || 'app';
    document.querySelectorAll('[data-pv]').forEach(function (el) { el.hidden = el.getAttribute('data-pv') !== which; });
    $('fsPreviewNote').textContent = NOTES[which] || '';
    if (which === 'doc') showDoc();
    if (which === 'year') showYear();
    if (which === 'calendar') showWeek();
    if (which === 'website') showSite();
  }
  function displayName() {
    var short = $('fsShort') ? $('fsShort').value.trim() : (school.shortName || '');
    return short || school.name || 'Your school';
  }
  function setLogos() {
    document.querySelectorAll('[data-pv-logo]').forEach(function (el) {
      el.textContent = '';
      if (logoUrl) {
        var img = document.createElement('img');
        img.src = logoUrl;
        img.alt = '';
        el.appendChild(img);
      } else {
        el.textContent = (displayName() || 'S').charAt(0).toUpperCase();
      }
    });
  }
  function showDoc() {
    var address = $('fsAddress') ? $('fsAddress').value.trim() : (school.address || '');
    var state = $('fsState') ? $('fsState').value.trim() : (school.state || '');
    var phone = $('fsPhone') ? $('fsPhone').value.trim() : (school.phone || '');
    $('fsPvAddress').textContent = [address, state].filter(Boolean).join(', ') || 'Your address';
    $('fsPvPhone').textContent = phone || 'Your phone';
  }
  function showYear() {
    var term = chosenTerm();
    $('fsPvYearLabel').textContent = term && term.year ? 'School year ' + term.year : 'School year';
    $('fsPvTerm').textContent = term ? term.name : 'Choose the current term';
    var a = term && parseDay(term.start);
    var b = term && parseDay(term.end);
    $('fsPvStart').textContent = a ? nice(a) : '';
    $('fsPvEnd').textContent = b ? nice(b) : '';
    var pct = 0;
    if (a && b && b > a) pct = Math.max(0, Math.min(100, Math.round(((Date.now() - a) / (b - a)) * 100)));
    $('fsPvTrack').style.width = pct + '%';
  }
  function showWeek() {
    var on = Array.prototype.map.call(document.querySelectorAll('input[name="schoolDay"]:checked'), function (i) { return i.value; });
    document.querySelectorAll('#fsPvWeek span').forEach(function (span) { span.classList.toggle('on', on.indexOf(span.getAttribute('data-d')) !== -1); });
    var note = on.length + ' school day' + (on.length === 1 ? '' : 's') + ' a week';
    if ($('fsHolidays') && $('fsHolidays').checked && holidayCount) note += ', ' + holidayCount + ' public holiday' + (holidayCount === 1 ? '' : 's');
    var extra = document.querySelectorAll('.fs-dayoff').length;
    if (extra) note += ', ' + extra + ' other day' + (extra === 1 ? '' : 's') + ' off';
    $('fsPvCalNote').textContent = note + '.';
  }
  function showSite() {
    var picked = document.querySelector('input[name="layout"]:checked') || document.querySelector('input[name="layout"]');
    var box = document.querySelector('[data-pv="website"]');
    box.innerHTML = picked ? designSvg(picked.getAttribute('data-key'), true) : '';
  }

  // Small drawings of each website design, in the school's colour.
  function designSvg(key, big) {
    var c = brand();
    var photo = function (x, y, w, h, rx) {
      return '<rect x="' + x + '" y="' + y + '" width="' + w + '" height="' + h + '" rx="' + (rx == null ? 3 : rx) + '" fill="' + c + '" opacity=".16"/>' +
        '<path d="M' + x + ' ' + (y + h) + ' L' + (x + w * 0.35) + ' ' + (y + h * 0.45) + ' L' + (x + w * 0.55) + ' ' + (y + h * 0.7) + ' L' + (x + w * 0.75) + ' ' + (y + h * 0.35) + ' L' + (x + w) + ' ' + (y + h) + ' Z" fill="' + c + '" opacity=".22"/>';
    };
    var bar = function (x, y, w, h, fill, op) { return '<rect x="' + x + '" y="' + y + '" width="' + w + '" height="' + (h || 3) + '" rx="1.5" fill="' + (fill || '#cbd5e1') + '"' + (op ? ' opacity="' + op + '"' : '') + '/>'; };
    var nav = function (dark) {
      var fill = dark ? '#ffffff' : '#94a3b8';
      return '<circle cx="9" cy="6" r="3" fill="' + (dark ? '#fff' : c) + '"/>' + bar(15, 4.5, 22, 3, dark ? '#fff' : '#334155', dark ? '.9' : '') + bar(110, 5, 10, 2, fill) + bar(124, 5, 10, 2, fill) + bar(138, 5, 12, 2, fill);
    };
    var cards = function (y, h) { return bar(8, y, 44, h, '#f1f5f9') + bar(58, y, 44, h, '#f1f5f9') + bar(108, y, 44, h, '#f1f5f9') + bar(12, y + 5, 26, 3, c, '.7') + bar(62, y + 5, 26, 3, c, '.7') + bar(112, y + 5, 26, 3, c, '.7'); };
    var emblem = function (cx, cy, r) {
      return '<circle cx="' + cx + '" cy="' + cy + '" r="' + r + '" fill="none" stroke="' + c + '" stroke-width="2" opacity=".35"/>' +
        '<path d="M' + cx + ' ' + (cy - r * 0.55) + ' L' + (cx + r * 0.42) + ' ' + (cy - r * 0.3) + ' L' + (cx + r * 0.42) + ' ' + (cy + r * 0.1) + ' Q' + cx + ' ' + (cy + r * 0.6) + ' ' + cx + ' ' + (cy + r * 0.6) + ' Q' + cx + ' ' + (cy + r * 0.6) + ' ' + (cx - r * 0.42) + ' ' + (cy + r * 0.1) + ' L' + (cx - r * 0.42) + ' ' + (cy - r * 0.3) + ' Z" fill="' + c + '" opacity=".35"/>';
    };
    var drawings = {
      academy: '<rect width="160" height="62" fill="' + c + '"/>' + nav(true) + bar(14, 24, 70, 6, '#fff') + bar(14, 34, 50, 3, '#fff', '.75') + bar(14, 44, 26, 7, '#fff') + bar(10, 70, 40, 22, '#f1f5f9') + bar(60, 70, 40, 22, '#f1f5f9') + bar(110, 70, 40, 22, '#f1f5f9') + bar(16, 76, 16, 6, c) + bar(66, 76, 16, 6, c) + bar(116, 76, 16, 6, c),
      classic: nav() + photo(0, 12, 160, 40, 0) + bar(50, 26, 60, 5, '#fff') + bar(62, 35, 36, 3, '#fff', '.85') + cards(60, 30),
      horizon: nav() + bar(10, 22, 60, 6, '#334155') + bar(10, 32, 54, 3) + bar(10, 38, 46, 3) + bar(10, 46, 24, 7, c) + photo(82, 16, 70, 42, 6) + cards(66, 26),
      editorial: bar(55, 4, 50, 4, '#334155') + bar(8, 12, 144, 1, '#cbd5e1') + photo(8, 18, 92, 50) + bar(8, 72, 80, 4, '#334155') + bar(8, 80, 70, 3) + bar(108, 18, 44, 3, '#334155') + bar(108, 24, 40, 2) + bar(108, 29, 38, 2) + bar(108, 40, 44, 3, '#334155') + bar(108, 46, 40, 2) + bar(108, 51, 36, 2) + bar(108, 62, 44, 3, '#334155') + bar(108, 68, 40, 2),
      story: nav() + photo(0, 12, 160, 46, 0) + bar(12, 40, 60, 6, '#fff') + '<circle cx="16" cy="70" r="5" fill="' + c + '"/>' + bar(26, 68, 60, 3) + '<circle cx="16" cy="84" r="5" fill="' + c + '" opacity=".7"/>' + bar(26, 82, 50, 3) + photo(104, 64, 48, 28),
      campus: '<rect width="40" height="100" fill="' + c + '"/><circle cx="12" cy="12" r="4" fill="#fff"/>' + bar(8, 26, 24, 2.5, '#fff', '.85') + bar(8, 33, 20, 2.5, '#fff', '.6') + bar(8, 40, 22, 2.5, '#fff', '.6') + bar(8, 47, 18, 2.5, '#fff', '.6') + photo(48, 8, 104, 40) + bar(48, 56, 60, 5, '#334155') + bar(48, 66, 100, 3) + bar(48, 72, 90, 3) + bar(48, 82, 48, 12, '#f1f5f9') + bar(102, 82, 50, 12, '#f1f5f9'),
      spotlight: nav() + bar(0, 12, 84, 50, c) + bar(10, 26, 56, 6, '#fff') + bar(10, 36, 44, 3, '#fff', '.8') + bar(10, 46, 22, 7, '#fff') + photo(90, 16, 62, 42, 5) + cards(68, 24),
      minimal: nav() + bar(10, 24, 100, 7, '#334155') + bar(10, 36, 80, 3) + bar(10, 42, 90, 3) + bar(10, 48, 70, 3) + bar(10, 58, 22, 6, c) + bar(10, 74, 140, 1) + bar(10, 80, 60, 3) + bar(10, 86, 50, 3),
      mosaic: nav() + photo(8, 14, 70, 40) + bar(82, 14, 34, 19, c) + bar(120, 14, 32, 19, '#f1f5f9') + photo(82, 35, 70, 19) + bar(8, 58, 34, 34, '#f1f5f9') + photo(46, 58, 54, 34) + bar(104, 58, 48, 34, c, '.85') + bar(110, 66, 30, 4, '#fff'),
      glide: nav() + '<g transform="translate(14 14) skewY(-4)">' + photo(0, 4, 132, 40) + '</g>' + bar(40, 26, 80, 5, '#fff') + cards(64, 26),
      prism: '<rect width="160" height="100" fill="' + c + '" opacity=".08"/>' + nav() + bar(20, 22, 70, 46, '#ffffff') + bar(52, 30, 70, 46, '#ffffff') + photo(88, 42, 56, 38) + bar(24, 28, 40, 5, '#334155') + bar(24, 38, 30, 3),
      panorama: photo(0, 0, 160, 70, 0) + nav(true) + bar(12, 40, 80, 7, '#fff') + bar(12, 51, 50, 3, '#fff', '.85') + photo(8, 76, 44, 18) + photo(58, 76, 44, 18) + photo(108, 76, 44, 18),
      orbit: '<rect width="160" height="100" fill="' + c + '" opacity=".08"/>' + nav() + emblem(110, 46, 26) + bar(14, 30, 64, 6, '#334155') + bar(14, 40, 50, 3) + bar(14, 48, 24, 7, c) + bar(10, 80, 140, 12, '#ffffff'),
      crest: nav() + photo(0, 12, 160, 40, 0) + emblem(80, 30, 15) + bar(52, 46, 56, 4, '#fff') + cards(62, 28),
      mascot: nav() + bar(0, 12, 92, 50, c) + bar(10, 28, 58, 6, '#fff') + bar(10, 38, 44, 3, '#fff', '.8') + bar(10, 48, 22, 7, '#fff') + emblem(124, 37, 22) + cards(68, 24)
    };
    var inner = drawings[key] || drawings.classic;
    return '<svg viewBox="0 0 160 100" xmlns="http://www.w3.org/2000/svg" aria-hidden="true"' + (big ? ' style="background:#fff"' : '') + '>' + inner + '</svg>';
  }
  function drawThumbs() {
    document.querySelectorAll('[data-thumb]').forEach(function (el) { el.innerHTML = designSvg(el.getAttribute('data-thumb')); });
    if (steps[index] === 'website') showSite();
  }

  // ── Steps ──────────────────────────────────────────────────────────────
  function render() {
    var name = steps[index];
    document.querySelectorAll('.fs-step').forEach(function (el) { el.hidden = el.getAttribute('data-step') !== name; });
    bars.forEach(function (bar, i) { bar.className = i < index ? 'is-done' : (i === index ? 'is-now' : ''); });
    $('fsCount').textContent = 'Step ' + (index + 1) + ' of ' + steps.length + ' · ' + (labels[name] || '');
    backBtn.hidden = index === 0;
    skipBtn.hidden = !SKIPPABLE[name];
    nextBtn.textContent = index === steps.length - 1 ? 'Finish' : 'Continue';
    showError('');
    if (name === 'calendar') loadHolidays();
    showPreview(name);
    var heading = section(name).querySelector('h1');
    if (heading) { heading.setAttribute('tabindex', '-1'); heading.focus({ preventScroll: true }); }
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

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

  // ── Saving in the background ───────────────────────────────────────────
  // Continue checks the step on the page, moves on at once, and saves behind: one save at a
  // time, in order (the calendar waits for its school year). What a step sends is taken when
  // Continue is pressed, so changing the page afterwards changes nothing already sent. A save
  // the server refuses brings the person back to that step with its message; the steps after
  // it are saved again as they continue. Finish waits only for what is still saving.
  var queue = Promise.resolve();
  var pending = 0;
  var failure = null;
  var savedOnce = false;
  var saveState = $('fsSaveState');

  function showSaveState() {
    if (!saveState) return;
    saveState.classList.toggle('is-busy', pending > 0);
    saveState.textContent = pending ? 'Saving…' : (savedOnce && !failure ? 'Saved' : '');
  }

  function goBackTo(step, message) {
    var at = steps.indexOf(step);
    if (at < 0) return;
    index = at;
    render();
    showError(message);
  }

  function enqueue(step, run) {
    pending += 1;
    showSaveState();
    queue = queue
      .then(function () {
        if (failure && failure.step !== step) return; // an earlier save needs fixing first
        failure = null;
        return run().catch(function (error) {
          failure = { step: step, message: error.message };
          goBackTo(step, error.message);
        });
      })
      .then(function () {
        pending -= 1;
        if (!failure) savedOnce = true;
        showSaveState();
      });
    return queue;
  }

  window.addEventListener('beforeunload', function (event) {
    if (!pending) return;
    event.preventDefault();
    event.returnValue = '';
  });

  // Each step: a message when something on the page needs fixing, or the save to run.
  var prepare = {
    color: function () {
      var picked = document.querySelector('input[name="color"]:checked');
      if (!picked) return { error: 'Choose a colour.' };
      var value = picked.value;
      var name = picked.closest('label').querySelector('span').textContent;
      return { run: function () {
        return send('/common/first-setup/color', { color: value }).then(function () { summary.color = 'Colour: ' + name; });
      } };
    },
    logo: function () {
      if (!logoFile) return { error: 'Choose a picture of your logo, or skip for now.' };
      var file = logoFile;
      return { run: function () {
        var form = new FormData();
        form.append('logo', file);
        return send('/common/first-setup/logo', form, true).then(function () { summary.logo = 'Logo added'; });
      } };
    },
    details: function () {
      var data = {};
      new FormData($('fsDetails')).forEach(function (value, key) { data[key] = String(value); });
      if (Object.prototype.hasOwnProperty.call(data, 'shortName')) {
        var nickname = data.shortName.trim().replace(/\s+/g, ' ');
        if (nickname && nickname.length < 3) { $('fsShort').focus(); return { error: 'A nickname needs at least 3 characters, or leave it empty.' }; }
        if (nickname.length > 60) { $('fsShort').focus(); return { error: 'A nickname is at most 60 characters.' }; }
        data.shortName = nickname;
      }
      if (data.phone && !/^[+()0-9.\-\s]{7,30}$/.test(data.phone.trim())) {
        $('fsPhone').focus();
        return { error: 'Enter the phone number with digits only (spaces, dashes and + are fine).' };
      }
      return { run: function () {
        return send('/common/first-setup/details', data).then(function () { summary.details = 'School details saved'; });
      } };
    },
    year: function () {
      if (config.yearMode === 'current') {
        var pick = document.querySelector('input[name="currentTermId"]:checked');
        if (!pick) return { error: 'Choose the term you’re in now, or skip for now.' };
        var termId = pick.value;
        return { run: function () {
          return send('/common/first-setup/current-term', { termId: termId }).then(function (data) {
            summary.year = data.current + ' (' + data.label + ') is the current term';
          });
        } };
      }
      var label = $('fsYearLabel').value.trim();
      var match = /^(\d{4})-(\d{4})$/.exec(label);
      if (!match || Number(match[2]) !== Number(match[1]) + 1) { $('fsYearLabel').focus(); return { error: 'Write the school year as 2026-2027.' }; }
      var start = $('fsYearStart').value;
      var end = $('fsYearEnd').value;
      var a = parseDay(start);
      var b = parseDay(end);
      if (!a || !b) return { error: 'Choose the first and last day of the school year.' };
      if (b <= a) return { error: 'The last day comes after the first day.' };
      if ((b - a) / DAY > 400) return { error: 'A school year is at most about 13 months.' };
      if (!generated.length) return { error: 'Choose how the year is divided.' };
      var structure = document.querySelector('input[name="structure"]:checked');
      var current = document.querySelector('input[name="newCurrent"]:checked');
      var body = { label: label, start: start, end: end, structure: structure ? structure.value : '', currentIndex: current ? Number(current.value) : undefined };
      // The calendar step follows a year being made.
      hasTerms = true;
      holidaysLoaded = false;
      return { run: function () {
        return send('/common/first-setup/year', body).then(function (data) {
          summary.year = 'School year ' + data.label + ', ' + data.current + ' is current';
          // A changed year takes its calendar with it: that step is set again.
          if (data.replaced) delete summary.calendar;
        });
      } };
    },
    calendar: function () {
      var days = Array.prototype.map.call(document.querySelectorAll('input[name="schoolDay"]:checked'), function (i) { return Number(i.value); });
      if (!days.length) return { error: 'Choose at least one school day.' };
      var daysOff = [];
      var problem = '';
      document.querySelectorAll('.fs-dayoff').forEach(function (row) {
        var date = row.querySelector('input[type="date"]').value;
        var name = row.querySelector('input[type="text"]').value.trim();
        if (!date && !name) return;
        if (!date) problem = 'Each day off needs a date.';
        else if (!name) problem = 'Give each day off a name, such as Thanksgiving break.';
        daysOff.push({ date: date, label: name });
      });
      if (problem) return { error: problem };
      var body = { schoolDays: days, publicHolidays: $('fsHolidays').checked, daysOff: daysOff };
      return { run: function () {
        return send('/common/first-setup/calendar', body).then(function (data) {
          var names = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
          var order = [1, 2, 3, 4, 5, 6, 0].filter(function (d) { return data.schoolDays.indexOf(d) !== -1; });
          var parts = ['School days ' + order.map(function (d) { return names[d]; }).join(', ')];
          if (data.holidays) parts.push(data.holidays + ' public holiday' + (data.holidays === 1 ? '' : 's'));
          if (data.daysOff) parts.push(data.daysOff + ' day' + (data.daysOff === 1 ? '' : 's') + ' off');
          summary.calendar = 'Calendar: ' + parts.join(', ');
        });
      } };
    },
    website: function () {
      var picked = document.querySelector('input[name="layout"]:checked');
      if (!picked) return { error: 'Choose a design, or skip for now.' };
      var value = picked.value;
      var name = picked.getAttribute('data-name');
      return { run: function () {
        return send('/common/first-setup/website', { layout: value }).then(function () { summary.website = 'Website design: ' + name; });
      } };
    }
  };

  var SKIPPED_TEXT = {
    logo: 'Logo: add it any time in Settings',
    year: 'School year: set it in School years & terms',
    calendar: 'Calendar: set school days and days off in Settings › School rules',
    website: 'Website: choose a design in Website settings'
  };

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

  // The end: once everything sent has saved, the setup is marked done.
  function finish() {
    busy = true;
    nextBtn.disabled = true;
    nextBtn.textContent = 'Finishing…';
    queue.then(function () {
      if (failure) { goBackTo(failure.step, failure.message); return null; } // that step needs fixing first
      return send('/common/first-setup/finish', {}).then(showDone);
    }).catch(function (error) {
      showError(error.message);
    }).then(function () {
      busy = false;
      nextBtn.disabled = false;
      if (steps.length) nextBtn.textContent = index === steps.length - 1 ? 'Finish' : 'Continue';
    });
  }

  function showDone() {
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
    list.hidden = !steps.length;
    document.querySelectorAll('.fs-step').forEach(function (el) { el.hidden = el.getAttribute('data-step') !== 'done'; });
    bars.forEach(function (bar) { bar.className = 'is-done'; });
    $('fsCount').textContent = 'All set';
    if (saveState) saveState.textContent = '';
    $('fsActions').hidden = true;
    showError('');
    showPreview('done');
    $('fsGo').focus();
  }

  nextBtn.addEventListener('click', function () {
    if (busy) return;
    var name = steps[index];
    showError('');
    var step = prepare[name]();
    if (step.error) { showError(step.error); return; }
    enqueue(name, step.run);
    advance();
  });
  skipBtn.addEventListener('click', function () { if (!busy) advance(); });
  backBtn.addEventListener('click', function () {
    if (busy || index === 0) return;
    index -= 1;
    if (steps[index] === 'calendar' && !hasTerms && index > 0) index -= 1;
    render();
  });
  if ($('fsDetails')) {
    $('fsDetails').addEventListener('submit', function (event) { event.preventDefault(); nextBtn.click(); });
    $('fsDetails').addEventListener('input', function () {
      showDoc();
      document.querySelectorAll('[data-pv-name]').forEach(function (el) { el.textContent = displayName(); });
      setLogos();
    });
  }

  // ── Colour ─────────────────────────────────────────────────────────────
  document.querySelectorAll('input[name="color"]').forEach(function (input) {
    input.addEventListener('change', function () {
      root.style.setProperty('--brand', input.getAttribute('data-hex'));
      drawThumbs();
    });
  });

  // ── Logo ───────────────────────────────────────────────────────────────
  var TYPES = ['image/png', 'image/jpeg', 'image/webp', 'image/gif'];
  function takeFile(file) {
    if (!file) return;
    if (TYPES.indexOf(file.type) === -1) { showError('Use a PNG, JPG, WebP or GIF picture.'); return; }
    if (file.size > 5 * 1024 * 1024) { showError('Use a picture under 5 MB.'); return; }
    showError('');
    logoFile = file;
    logoUrl = URL.createObjectURL(file);
    var body = $('fsDropBody');
    body.textContent = '';
    var img = document.createElement('img');
    img.src = logoUrl;
    img.alt = 'Your logo';
    var note = document.createElement('small');
    note.textContent = 'Choose another picture';
    body.appendChild(img);
    body.appendChild(document.createElement('br'));
    body.appendChild(note);
    setLogos();
  }
  if ($('fsLogo')) {
    var drop = $('fsDrop');
    $('fsLogo').addEventListener('change', function () { takeFile(this.files && this.files[0]); });
    ['dragenter', 'dragover'].forEach(function (type) { drop.addEventListener(type, function (event) { event.preventDefault(); drop.classList.add('is-over'); }); });
    ['dragleave', 'drop'].forEach(function (type) { drop.addEventListener(type, function () { drop.classList.remove('is-over'); }); });
    drop.addEventListener('drop', function (event) {
      event.preventDefault();
      takeFile(event.dataTransfer && event.dataTransfer.files && event.dataTransfer.files[0]);
    });
  }

  // ── School year ────────────────────────────────────────────────────────
  // The terms as they'll be saved: the shared split (public/js/termPlanner.js, the same as
  // utils/firstSetup.js on the server), as dates for this page.
  function termsFor(structure, start, end) {
    var list = window.ManagiraTerms ? window.ManagiraTerms.termsFor(structure, start, end) : null;
    return list ? list.map(function (t) { return { name: t.name, start: parseDay(t.start), end: parseDay(t.end) }; }) : null;
  }
  var generated = [];
  function showTerms() {
    var list = $('fsTerms');
    if (!list) return;
    var structure = document.querySelector('input[name="structure"]:checked');
    var previous = document.querySelector('input[name="newCurrent"]:checked');
    var keep = previous ? Number(previous.value) : -1;
    generated = termsFor(structure && structure.value, $('fsYearStart').value, $('fsYearEnd').value) || [];
    list.textContent = '';
    if (!generated.length) {
      var empty = document.createElement('li');
      empty.className = 'fs-term-empty';
      empty.textContent = 'Choose a first and last day, with the last day after the first.';
      list.appendChild(empty);
      showYear();
      return;
    }
    var today = iso(new Date());
    var current = generated.findIndex(function (t) { return iso(t.end) >= today; });
    if (current < 0) current = 0;
    if (keep >= 0 && keep < generated.length) current = keep;
    generated.forEach(function (term, i) {
      var li = document.createElement('li');
      var label = document.createElement('label');
      label.className = 'fs-term';
      var radio = document.createElement('input');
      radio.type = 'radio';
      radio.name = 'newCurrent';
      radio.value = String(i);
      radio.checked = i === current;
      radio.addEventListener('change', showYear);
      var name = document.createElement('b');
      name.textContent = term.name;
      var dates = document.createElement('span');
      dates.textContent = nice(term.start) + ' – ' + nice(term.end);
      var tag = document.createElement('em');
      tag.textContent = 'Current';
      label.appendChild(radio);
      label.appendChild(name);
      label.appendChild(dates);
      label.appendChild(tag);
      li.appendChild(label);
      list.appendChild(li);
    });
    showYear();
  }
  function chosenTerm() {
    if (config.yearMode === 'current') {
      var pick = document.querySelector('input[name="currentTermId"]:checked');
      return pick ? { name: pick.getAttribute('data-name'), year: pick.getAttribute('data-year'), start: pick.getAttribute('data-start'), end: pick.getAttribute('data-end') } : null;
    }
    var chosen = document.querySelector('input[name="newCurrent"]:checked');
    var term = chosen ? generated[Number(chosen.value)] : null;
    return term ? { name: term.name, year: $('fsYearLabel').value.trim(), start: iso(term.start), end: iso(term.end) } : null;
  }
  if ($('fsTerms')) {
    ['fsYearStart', 'fsYearEnd'].forEach(function (id) { $(id).addEventListener('input', showTerms); $(id).addEventListener('change', showTerms); });
    document.querySelectorAll('input[name="structure"]').forEach(function (input) { input.addEventListener('change', showTerms); });
    $('fsYearLabel').addEventListener('input', showYear);
    // The year's label follows its first day's year.
    $('fsYearStart').addEventListener('change', function () {
      var a = parseDay($('fsYearStart').value);
      if (a) $('fsYearLabel').value = a.getUTCFullYear() + '-' + (a.getUTCFullYear() + 1);
      showYear();
    });
    showTerms();
  }
  document.querySelectorAll('[data-range]').forEach(function (el) {
    var parts = el.getAttribute('data-range').split('|');
    var a = parseDay(parts[0]);
    var b = parseDay(parts[1]);
    if (a && b) el.textContent = nice(a) + ' – ' + nice(b);
  });
  document.querySelectorAll('input[name="currentTermId"]').forEach(function (input) { input.addEventListener('change', showYear); });

  // ── Calendar ───────────────────────────────────────────────────────────
  var holidaysLoaded = false;
  var holidayCount = 0;
  function loadHolidays() {
    if (holidaysLoaded || !$('fsHolidayList')) return;
    holidaysLoaded = true;
    // After the school year has saved (the holidays follow its dates).
    queue
      .then(function () { return fetch('/common/first-setup/holidays', { credentials: 'same-origin', headers: { Accept: 'application/json' } }); })
      .then(function (res) { return res.ok ? res.json() : null; })
      .catch(function () { return null; })
      .then(function (data) {
        var note = $('fsHolidaysNote');
        var list = $('fsHolidayList');
        list.textContent = '';
        if (!data || !data.holidays) { note.textContent = 'Your country’s public holidays during the school year.'; return; }
        holidayCount = data.holidays.length;
        note.textContent = holidayCount
          ? holidayCount + ' public holiday' + (holidayCount === 1 ? '' : 's') + ' in ' + data.countryName + ' during your school year.'
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
        list.hidden = !holidayCount || !$('fsHolidays').checked;
        showWeek();
      });
  }
  if ($('fsHolidays')) {
    $('fsHolidays').addEventListener('change', function () {
      $('fsHolidayList').hidden = !this.checked || !$('fsHolidayList').children.length;
      showWeek();
    });
    document.querySelectorAll('input[name="schoolDay"]').forEach(function (input) { input.addEventListener('change', showWeek); });
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
      remove.addEventListener('click', function () { row.remove(); showWeek(); });
      row.appendChild(date);
      row.appendChild(label);
      row.appendChild(remove);
      $('fsDaysOff').appendChild(row);
      showWeek();
      if (focus) date.focus();
    };
    $('fsAddDayOff').addEventListener('click', function () {
      if (document.querySelectorAll('.fs-dayoff').length >= 40) return;
      addDayOff(true);
    });
  }

  // ── Website ────────────────────────────────────────────────────────────
  document.querySelectorAll('input[name="layout"]').forEach(function (input) { input.addEventListener('change', showSite); });
  drawThumbs();

  // Nothing left to ask (a reload after the last step): straight to the end.
  if (!steps.length) { finish(); return; }
  render();
})();
