// The attendance notices in Class settings (views/partials/classNoticeRows.ejs): each switch and number saves as it changes,
// in order, and says "Saved" beside its row. A number waits a moment after the last tap before it saves.
(function () {
  'use strict';
  var queue = Promise.resolve();

  function say(row, text, kind) {
    var msg = row && row.querySelector('[data-cs-msg]');
    if (!msg) return;
    clearTimeout(msg.__t);
    msg.textContent = text || '';
    msg.classList.remove('is-saving', 'is-saved', 'is-error');
    if (kind) msg.classList.add('is-' + kind);
    if (kind === 'saved') msg.__t = setTimeout(function () { msg.textContent = ''; msg.classList.remove('is-saved'); }, 2400);
  }
  function save(list, row, patch, undo) {
    var kind = row.getAttribute('data-notice-kind');
    var body = {}; body[kind] = patch;
    if (list.hasAttribute('data-all')) body.all = true; else body.classId = Number(list.getAttribute('data-class-id'));
    say(row, 'Saving…', 'saving');
    queue = queue.then(function () {
      return fetch(list.getAttribute('data-notices-url'), { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json', Accept: 'application/json', 'X-Requested-With': 'XMLHttpRequest' }, body: JSON.stringify(body) })
        .then(function (r) { return r.json().catch(function () { return null; }); })
        .then(function (json) { if (!json || !json.success) throw new Error((json && json.message) || "That didn't save. Try again."); say(row, 'Saved', 'saved'); });
    }).catch(function (error) { if (undo) undo(); say(row, error.message, 'error'); });
  }
  function clamp(input) {
    var max = Number(input.getAttribute('max')) || 10, v = Math.round(Number(input.value));
    if (!Number.isFinite(v)) v = Number(input.getAttribute('data-last')) || 3;
    return Math.min(max, Math.max(1, v));
  }
  document.addEventListener('click', function (e) {
    var step = e.target.closest && e.target.closest('[data-notice-step]');
    if (!step) return;
    var list = step.closest('[data-notices]'), row = step.closest('[data-notice-kind]'), input = row && row.querySelector('[data-notice-count]');
    if (!list || !input) return;
    input.value = String(Math.min(Number(input.getAttribute('max')) || 10, Math.max(1, clamp(input) + Number(step.getAttribute('data-notice-step')))));
    input.dispatchEvent(new Event('change', { bubbles: true }));
  });
  document.addEventListener('change', function (e) {
    var input = e.target;
    if (!input || !input.closest) return;
    var list = input.closest('[data-notices]'), row = input.closest('[data-notice-kind]');
    if (!list || !row) return;
    if (input.matches('[data-notice-on]')) {
      var on = input.checked;
      save(list, row, { on: on }, function () { input.checked = !on; });
    } else if (input.matches('[data-notice-count]')) {
      var before = Number(input.getAttribute('data-last')) || Number(input.defaultValue) || 3, value = clamp(input);
      input.value = String(value);
      if (value === before && input.getAttribute('data-last')) return;
      clearTimeout(input.__t);
      input.__t = setTimeout(function () {
        input.setAttribute('data-last', String(value));
        save(list, row, { count: value }, function () { input.value = String(before); input.setAttribute('data-last', String(before)); });
      }, 450);
    }
  });
})();
