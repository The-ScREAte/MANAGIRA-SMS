// Setup steps bar: what the school still has to set up. Done steps are crossed
// out; required steps stay until they're done, optional ones can be skipped.
(function () {
  if (window.__setupStepsBound) return;
  window.__setupStepsBound = true;

  var root = document.getElementById('ssRoot');
  if (!root) return;
  var OPEN_KEY = 'managiraSetupStepsOpen';
  var data = null;
  var loading = false;

  function esc(v) {
    return String(v == null ? '' : v).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function readOpen() { try { return localStorage.getItem(OPEN_KEY) === '1'; } catch (e) { return false; } }
  function writeOpen(v) { try { localStorage.setItem(OPEN_KEY, v ? '1' : '0'); } catch (e) { /* private mode */ } }

  var CHECK = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 12l5 5L20 7"/></svg>';

  function stepHtml(s) {
    var cls = 'ss-step' + (s.required ? ' is-required' : '') + (s.done ? ' is-done' : '') + (s.skipped ? ' is-skipped' : '');
    var title = s.done || s.skipped
      ? '<span class="ss-title">' + esc(s.title) + '</span>'
      : '<a class="ss-title" href="' + esc(s.href) + '" data-no-spa>' + esc(s.title) + '</a>';
    var side = '';
    if (!s.done && s.required) side = '<span class="ss-tag ss-tag--required">Required</span>';
    else if (!s.done && !s.required && !s.skipped) side = '<button type="button" class="ss-skip" data-skip="' + esc(s.key) + '" title="Not needed for your school">Skip</button>';
    else if (s.skipped) side = '<button type="button" class="ss-skip" data-unskip="' + esc(s.key) + '">Undo</button>';
    return '<li class="' + cls + '"><span class="ss-check">' + (s.done ? CHECK : '') + '</span>' +
      '<span class="ss-body">' + title + '<span class="ss-hint">' + esc(s.hint) + '</span></span>' + side + '</li>';
  }

  function render() {
    if (!data || data.complete) { root.hidden = true; return; }
    var todoRequired = data.steps.filter(function (s) { return s.required && !s.done; });
    var todoOptional = data.steps.filter(function (s) { return !s.required && !s.done && !s.skipped; });
    var finished = data.steps.filter(function (s) { return s.done || s.skipped; });
    var pct = data.total ? data.finished / data.total : 0;
    var C = 2 * Math.PI * 12;
    var sub = data.requiredLeft
      ? data.requiredLeft + ' required step' + (data.requiredLeft === 1 ? '' : 's') + ' left'
      : data.optionalLeft + ' optional step' + (data.optionalLeft === 1 ? '' : 's') + ' left';
    var list = '';
    if (todoRequired.length) list += '<li class="ss-group">Required</li>' + todoRequired.map(stepHtml).join('');
    if (todoOptional.length) list += '<li class="ss-group">Recommended</li>' + todoOptional.map(stepHtml).join('');
    if (finished.length) list += '<li class="ss-group">Done</li>' + finished.map(stepHtml).join('');
    var open = root.classList.contains('is-open');
    root.innerHTML =
      '<div class="ss-panel" id="ssPanel" role="dialog" aria-label="Setup steps">' +
        '<div class="ss-head"><div><h2>Finish setting up your school</h2><p>' + esc(sub) + '. Each step is crossed out once it\'s done.</p></div>' +
        '<button type="button" class="ss-close" data-ss-toggle aria-label="Close setup steps">&times;</button></div>' +
        '<ul class="ss-list">' + list + '</ul>' +
        '<div class="ss-foot">Required steps can\'t be skipped. Recommended steps can be skipped if your school doesn\'t need them.</div>' +
      '</div>' +
      '<button type="button" class="ss-bar" data-ss-toggle aria-expanded="' + (open ? 'true' : 'false') + '" aria-controls="ssPanel">' +
        '<svg class="ss-ring" viewBox="0 0 30 30" aria-hidden="true"><circle class="ss-ring__track" cx="15" cy="15" r="12"/>' +
        '<circle class="ss-ring__fill" cx="15" cy="15" r="12" stroke-dasharray="' + C.toFixed(2) + '" stroke-dashoffset="' + (C * (1 - pct)).toFixed(2) + '"/></svg>' +
        '<span class="ss-bar__text">Setup steps<span class="ss-bar__sub">' + data.finished + ' of ' + data.total + ' done</span></span>' +
        '<svg class="ss-bar__chev" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" aria-hidden="true"><path d="M6 15l6-6 6 6"/></svg>' +
      '</button>';
    root.hidden = false;
  }

  function load() {
    if (loading) return;
    loading = true;
    fetch('/common/setupSteps', { credentials: 'same-origin', headers: { Accept: 'application/json' } })
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (json) { if (json && json.steps) { data = json; render(); } })
      .catch(function () { /* keep the last state */ })
      .then(function () { loading = false; });
  }

  function setOpen(v) {
    root.classList.toggle('is-open', v);
    writeOpen(v);
    var bar = root.querySelector('.ss-bar');
    if (bar) bar.setAttribute('aria-expanded', v ? 'true' : 'false');
  }

  root.addEventListener('click', function (event) {
    if (event.target.closest('[data-ss-toggle]')) { setOpen(!root.classList.contains('is-open')); return; }
    var btn = event.target.closest('[data-skip], [data-unskip]');
    if (btn) {
      var key = btn.getAttribute('data-skip') || btn.getAttribute('data-unskip');
      btn.disabled = true;
      fetch('/common/setupSteps/skip', {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify({ key: key, skip: btn.hasAttribute('data-skip') }),
      }).then(function (r) { return r.json().catch(function () { return {}; }); })
        .then(function (json) { if (json && json.steps) { data = json; render(); } else { btn.disabled = false; } })
        .catch(function () { btn.disabled = false; });
      return;
    }
    // Opening a step closes the panel so the page is in view.
    if (event.target.closest('a.ss-title')) setOpen(false);
  });
  document.addEventListener('keydown', function (event) {
    if (event.key === 'Escape' && root.classList.contains('is-open')) setOpen(false);
  });

  if (readOpen()) root.classList.add('is-open');
  load();
  // Done steps cross out as the school works: check again when coming back to
  // the tab and after in-app navigation.
  document.addEventListener('visibilitychange', function () { if (!document.hidden) load(); });
  window.addEventListener('spa:pageLoaded', load);
  window.addEventListener('focus', load);
})();
