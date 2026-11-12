// Taking a test (views/student/takeAssessmentNext.ejs): start, answers saved as the student
// works, the timer (submits itself when time is up), the question list, open-book resources
// beside the questions, and, for a secure test, locking it when the student leaves the page.
(function () {
  'use strict';
  var root = document.getElementById('ex');
  var configEl = document.getElementById('ex-config');
  if (!root || !configEl) return;
  var cfg = {};
  try { cfg = JSON.parse(configEl.textContent || '{}'); } catch (_) { return; }

  var base = '/student/testing-room/' + cfg.assessmentId;
  var form = document.getElementById('ex-form');
  var saveEl = document.getElementById('ex-save');
  var timerEl = document.getElementById('ex-timer');
  var alertEl = document.getElementById('ex-alert');
  var progressEl = document.getElementById('ex-progress');
  var startBtn = document.getElementById('ex-start');
  var exitLink = document.getElementById('ex-exit');
  var questions = Array.prototype.slice.call(document.querySelectorAll('[data-ex-q]'));
  var navItems = Array.prototype.slice.call(document.querySelectorAll('[data-ex-nav]'));

  var started = Boolean(cfg.startedAt);
  var startedAt = cfg.startedAt ? new Date(cfg.startedAt) : null;
  var minutes = Number(cfg.timeLimitMinutes || 0);
  var submitting = false;
  var locked = false;
  var dirty = false;
  var saving = false;
  var saveTimer = null;
  var saveLoop = null;
  var tickLoop = null;

  function showAlert(text, tone) {
    if (!alertEl) return;
    alertEl.textContent = text || '';
    alertEl.hidden = !text;
    alertEl.className = 'ex-alert' + (tone ? ' ex-alert--' + tone : '');
  }
  function setSave(text, isError) {
    if (!saveEl) return;
    saveEl.textContent = text || '';
    saveEl.classList.toggle('is-error', Boolean(isError));
  }

  // ---- Answered: the count, the question list and each question's state.
  function isAnswered(card) {
    if (card.querySelector('input[type=radio]:checked, input[type=checkbox]:checked')) return true;
    var texts = Array.prototype.slice.call(card.querySelectorAll('input[type=text], textarea'));
    return texts.length > 0 && texts.every(function (field) { return String(field.value || '').trim(); });
  }
  function refreshProgress() {
    var count = 0;
    questions.forEach(function (card, index) {
      var done = isAnswered(card);
      if (done) count += 1;
      card.classList.toggle('is-answered', done);
      if (navItems[index]) navItems[index].classList.toggle('is-answered', done);
    });
    if (progressEl) progressEl.querySelector('strong').textContent = String(count);
    return count;
  }

  // ---- Saving answers: shortly after each change, every 15 seconds while there are
  // unsaved ones, and once more when the page is left.
  function answers() {
    var out = {};
    if (!form) return out;
    new FormData(form).forEach(function (value, key) {
      var match = /^responses\[(\d+)\]$/.exec(String(key));
      if (!match) return;
      var id = match[1];
      if (Object.prototype.hasOwnProperty.call(out, id)) {
        if (!Array.isArray(out[id])) out[id] = [out[id]];
        out[id].push(value);
      } else {
        out[id] = value;
      }
    });
    // A "label the picture" question always sends every spot, in order.
    questions.forEach(function (card) {
      var fields = card.querySelectorAll('.ex-labels input');
      if (fields.length > 1) {
        var name = fields[0].name;
        var id = (/^responses\[(\d+)\]$/.exec(name) || [])[1];
        if (id) out[id] = Array.prototype.map.call(fields, function (f) { return f.value; });
      }
    });
    return out;
  }
  function payload() { return JSON.stringify({ attemptId: cfg.attemptId, responses: answers() }); }
  function save() {
    if (!started || !dirty || saving || submitting || locked) return Promise.resolve();
    saving = true;
    dirty = false;
    setSave('Saving…');
    return fetch(base + '/autosave', {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: payload(),
    }).then(function (response) {
      return response.json().catch(function () { return {}; }).then(function (result) {
        if (!response.ok || !result.success) throw new Error(result.error || 'Not saved. Retrying…');
        setSave('All changes saved');
      });
    }).catch(function (error) {
      dirty = true;
      setSave(error.message || 'Not saved. Retrying…', true);
    }).then(function () { saving = false; });
  }
  function changed() {
    refreshProgress();
    if (!started || submitting || locked) return;
    dirty = true;
    setSave('Unsaved changes');
    clearTimeout(saveTimer);
    saveTimer = setTimeout(save, 1200);
  }
  function saveOnLeave() {
    if (!started || !dirty || submitting || locked || !navigator.sendBeacon) return;
    try { navigator.sendBeacon(base + '/autosave', new Blob([payload()], { type: 'application/json' })); } catch (_) {}
  }

  // ---- The timer: counts down, warns near the end, and submits at zero.
  function deadline() {
    if (!(minutes > 0) || !startedAt || Number.isNaN(startedAt.getTime())) return null;
    return startedAt.getTime() + minutes * 60000;
  }
  function clock(seconds) {
    var h = Math.floor(seconds / 3600);
    var m = Math.floor((seconds % 3600) / 60);
    var s = seconds % 60;
    var mm = (h ? String(m).padStart(2, '0') : String(m)) + ':' + String(s).padStart(2, '0');
    return h ? h + ':' + mm : mm;
  }
  function startTimer() {
    var end = deadline();
    if (!timerEl || !end) return;
    timerEl.hidden = false;
    function tick() {
      var left = Math.ceil((end - Date.now()) / 1000);
      if (left <= 0) {
        timerEl.textContent = '0:00';
        clearInterval(tickLoop);
        showAlert('Time is up. Submitting your test…', 'warn');
        submitNow();
        return;
      }
      timerEl.textContent = clock(left);
      timerEl.classList.toggle('is-low', left <= 300 && left > 60);
      timerEl.classList.toggle('is-out', left <= 60);
    }
    tick();
    tickLoop = setInterval(tick, 1000);
  }

  // ---- Start, and the exam view.
  function showExam() {
    root.setAttribute('data-state', 'exam');
    refreshProgress();
    startTimer();
    saveLoop = setInterval(save, 15000);
    if (resources.length) showResource(0);
  }
  function start() {
    if (!startBtn) return;
    startBtn.disabled = true;
    startBtn.textContent = 'Starting…';
    showAlert('');
    fetch(base + '/start', {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({ attemptId: cfg.attemptId }),
    }).then(function (response) {
      return response.json().catch(function () { return {}; }).then(function (result) {
        if (!response.ok || !result.success) throw new Error(result.error || 'The test could not start. Try again.');
        if (result.startedAt) startedAt = new Date(result.startedAt);
        if (Number.isFinite(Number(result.timeLimitMinutes))) minutes = Math.trunc(Number(result.timeLimitMinutes));
        started = true;
        if (cfg.secure && document.documentElement.requestFullscreen) {
          document.documentElement.requestFullscreen().catch(function () {});
        }
        showExam();
        window.scrollTo(0, 0);
      });
    }).catch(function (error) {
      showAlert(error.message, 'error');
      startBtn.disabled = false;
      startBtn.textContent = 'Start test';
    });
  }

  // ---- A dialog for Submit and for leaving a secure test.
  var modal = document.getElementById('ex-modal');
  var modalOk = document.getElementById('ex-modal-ok');
  var modalCancel = document.getElementById('ex-modal-cancel');
  var onConfirm = null;
  function ask(title, text, okLabel, cancelLabel, action, danger) {
    if (!modal) { if (window.confirm(text)) action(); return; }
    document.getElementById('ex-modal-title').textContent = title;
    document.getElementById('ex-modal-text').textContent = text;
    modalOk.textContent = okLabel;
    modalCancel.textContent = cancelLabel;
    modalOk.classList.toggle('ex-btn--danger', Boolean(danger));
    onConfirm = action;
    modal.hidden = false;
    modalCancel.focus();
  }
  function closeModal() { if (modal) modal.hidden = true; onConfirm = null; }
  if (modal) {
    modalCancel.addEventListener('click', closeModal);
    modalOk.addEventListener('click', function () { var action = onConfirm; closeModal(); if (action) action(); });
    modal.addEventListener('click', function (event) { if (event.target === modal) closeModal(); });
    document.addEventListener('keydown', function (event) { if (event.key === 'Escape' && !modal.hidden) closeModal(); });
  }

  // ---- Submit.
  function submitNow() {
    if (!form || submitting) return;
    submitting = true;
    clearTimeout(saveTimer);
    clearInterval(saveLoop);
    clearInterval(tickLoop);
    window.removeEventListener('beforeunload', warnBeforeLeaving);
    root.classList.add('is-submitting');
    document.querySelectorAll('#ex-submit, #ex-submit-top').forEach(function (button) {
      button.disabled = true;
      button.textContent = 'Submitting…';
    });
    form.submit();
  }
  function askToSubmit() {
    if (!started || submitting || locked) return;
    var left = questions.length - refreshProgress();
    var text = (left
      ? left + ' question' + (left === 1 ? ' is' : 's are') + ' not answered. '
      : 'All ' + questions.length + ' questions are answered. ')
      + (cfg.finalAttempt ? 'You can’t change your answers after you submit.' : 'This uses one of your attempts.');
    ask('Submit your test?', text, 'Submit', 'Keep working', submitNow);
  }
  document.querySelectorAll('#ex-submit, #ex-submit-top').forEach(function (button) {
    button.addEventListener('click', askToSubmit);
  });
  if (form) form.addEventListener('submit', function (event) { if (!submitting) { event.preventDefault(); askToSubmit(); } });

  // ---- Leaving.
  function warnBeforeLeaving(event) {
    if (!started || submitting || locked) return;
    event.preventDefault();
    event.returnValue = '';
  }
  window.addEventListener('beforeunload', warnBeforeLeaving);
  window.addEventListener('pagehide', saveOnLeave);

  function lockTest(reason, thenLeave) {
    if (!cfg.secure || !started || submitting || locked) return;
    locked = true;
    clearTimeout(saveTimer);
    clearInterval(saveLoop);
    clearInterval(tickLoop);
    if (form) Array.prototype.forEach.call(form.elements, function (field) { field.disabled = true; });
    document.querySelectorAll('#ex-submit, #ex-submit-top').forEach(function (button) { button.disabled = true; });
    showAlert('This test is locked because you left the page. Ask your teacher to unlock it.', 'error');
    var request = fetch(base + '/lock', {
      method: 'POST',
      credentials: 'same-origin',
      keepalive: true,
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({ attemptId: cfg.attemptId, reason: String(reason || 'left_page') }),
    }).catch(function () {});
    if (thenLeave) Promise.resolve(request).then(function () { window.location.replace(cfg.backUrl); });
  }
  if (exitLink) {
    exitLink.addEventListener('click', function (event) {
      if (!started || submitting || locked) return;
      event.preventDefault();
      if (cfg.secure) {
        ask('Leave this test?', 'Leaving locks it until your teacher unlocks it. Your answers so far are kept.', 'Leave and lock', 'Stay', function () { lockTest('manual_exit_click', true); }, true);
        return;
      }
      // Open book: save, then go back to the Testing Room; the student can resume.
      window.removeEventListener('beforeunload', warnBeforeLeaving);
      save().then(function () { window.location.href = cfg.backUrl; });
    });
  }

  // ---- Secure (closed-book) tests: leaving the page locks the test.
  if (cfg.secure) {
    document.addEventListener('visibilitychange', function () {
      if (document.visibilityState === 'hidden') lockTest('visibility_hidden', false);
    });
    window.addEventListener('blur', function () { lockTest('window_blur', false); });
    window.addEventListener('pagehide', function () { lockTest('pagehide', false); });
    window.addEventListener('focus', function () { if (locked) window.location.replace(cfg.backUrl); });
    document.addEventListener('contextmenu', function (event) { if (started) event.preventDefault(); });
    // New tab or window, reload, address bar: stopped. Option / Alt alone types accents and is fine.
    document.addEventListener('keydown', function (event) {
      if (!started || submitting || locked) return;
      var key = String(event.key || '').toLowerCase();
      if ((event.metaKey || event.ctrlKey) && !event.altKey && ['t', 'n', 'w', 'r', 'l'].indexOf(key) !== -1) event.preventDefault();
    });
  }

  // ---- Question list: jump to a question.
  var main = document.getElementById('ex-main');
  navItems.forEach(function (item) {
    item.addEventListener('click', function (event) {
      event.preventDefault();
      var card = questions[Number(item.getAttribute('data-ex-nav'))];
      if (!card) return;
      card.scrollIntoView({ behavior: 'smooth', block: 'start' });
      var field = card.querySelector('input, textarea');
      if (field) setTimeout(function () { field.focus({ preventScroll: true }); }, 350);
    });
  });
  if ('IntersectionObserver' in window && questions.length) {
    var seen = new IntersectionObserver(function (entries) {
      entries.forEach(function (entry) {
        if (!entry.isIntersecting) return;
        var index = Number(entry.target.getAttribute('data-ex-q'));
        navItems.forEach(function (item, i) { item.classList.toggle('is-current', i === index); });
      });
    }, { root: root.classList.contains('ex--split') ? main : null, rootMargin: '-30% 0px -60% 0px' });
    questions.forEach(function (card) { seen.observe(card); });
  }

  // ---- Open-book resources on the left.
  var resources = Array.isArray(cfg.resources) ? cfg.resources : [];
  var view = document.getElementById('ex-res-view');
  var openLink = document.getElementById('ex-res-open');
  var pick = document.getElementById('ex-res-pick');
  function showResource(index) {
    var file = resources[index];
    if (!file || !view) return;
    if (openLink) openLink.href = file.url;
    view.textContent = '';
    if (file.kind === 'pdf') {
      var frame = document.createElement('iframe');
      frame.src = file.url;
      frame.title = file.name;
      frame.setAttribute('referrerpolicy', 'no-referrer');
      view.appendChild(frame);
    } else if (file.kind === 'image') {
      var img = document.createElement('img');
      img.src = file.url;
      img.alt = file.name;
      view.appendChild(img);
    } else {
      var box = document.createElement('div');
      box.className = 'ex-res__file';
      var name = document.createElement('p');
      name.textContent = file.name;
      var note = document.createElement('p');
      note.className = 'ex-res__note';
      note.textContent = file.kind === 'link' ? 'This link opens in a new tab.' : 'This file opens in a new tab.';
      var link = document.createElement('a');
      link.className = 'ex-btn ex-btn--ghost';
      link.href = file.url;
      link.target = '_blank';
      link.rel = 'noopener noreferrer';
      link.textContent = file.kind === 'link' ? 'Open link' : 'Open file';
      box.appendChild(name);
      box.appendChild(note);
      box.appendChild(link);
      view.appendChild(box);
    }
  }
  if (pick) pick.addEventListener('change', function () { showResource(Number(pick.value)); });
  // Phones: one pane at a time.
  document.querySelectorAll('[data-ex-pane]').forEach(function (tab) {
    tab.addEventListener('click', function () {
      var pane = tab.getAttribute('data-ex-pane');
      root.setAttribute('data-pane', pane);
      document.querySelectorAll('[data-ex-pane]').forEach(function (other) {
        var on = other === tab;
        other.classList.toggle('is-on', on);
        other.setAttribute('aria-selected', on ? 'true' : 'false');
      });
    });
  });

  if (form) {
    form.addEventListener('input', changed);
    form.addEventListener('change', changed);
  }
  if (startBtn) startBtn.addEventListener('click', start);
  refreshProgress();
  if (started) showExam();
})();
