// A class's weekly briefing inside Class settings (views/partials/classSettingsPanel.ejs): each switch saves as it
// changes, one at a time and in order, like the rows around it. "Choose for this class" off means the class follows the
// school's choices: the rows show them and can't be changed.
(function () {
  'use strict';

  function mount(card) {
    if (!card || card.__briefBound) return;
    card.__briefBound = true;
    var url = card.getAttribute('data-brief-url');
    var own = card.querySelector('[data-brief-own]');
    var rows = card.querySelector('[data-brief-rows]');
    var queue = Promise.resolve();

    function say(row, text, kind) {
      var msg = row && row.querySelector('[data-cs-msg]');
      if (!msg) return;
      clearTimeout(msg.__t);
      msg.textContent = text || '';
      msg.classList.remove('is-saving', 'is-saved', 'is-error');
      if (kind) msg.classList.add('is-' + kind);
      if (kind === 'saved') msg.__t = setTimeout(function () { msg.textContent = ''; msg.classList.remove('is-saved'); }, 2600);
    }
    function boxes() { return Array.prototype.slice.call(rows.querySelectorAll('input[type="checkbox"][name]')); }
    function body() {
      var params = new URLSearchParams();
      if (own.checked) {
        params.set('mode', 'own');
        boxes().forEach(function (box) { if (box.checked) params.set(box.name, 'on'); });
      }
      return params.toString();
    }
    function save(row, undo) {
      say(row, 'Saving…', 'saving');
      queue = queue.then(function () {
        return fetch(url, { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json', 'X-Requested-With': 'XMLHttpRequest' }, body: body() })
          .then(function (r) { return r.json().catch(function () { return null; }); })
          .then(function (json) { if (!json || !json.success) throw new Error((json && json.message) || "That didn't save. Try again."); say(row, 'Saved', 'saved'); });
      }).catch(function (error) { if (undo) undo(); say(row, error.message, 'error'); });
    }

    // Off: back to the school's choices (shown, not editable). On: start from them, editable.
    function applyOwn(on) {
      boxes().forEach(function (box) {
        if (!on) box.checked = box.getAttribute('data-brief-school') === '1';
        box.disabled = !on;
      });
      rows.classList.toggle('is-readonly', !on);
    }

    card.addEventListener('change', function (event) {
      var input = event.target;
      if (!input || !input.matches) return;
      var row = input.closest('[data-cs-row]');
      if (input === own) {
        var on = own.checked;
        applyOwn(on);
        save(row, function () { own.checked = !on; applyOwn(!on); });
      } else if (input.matches('input[type="checkbox"][name]')) {
        save(row, function () { input.checked = !input.checked; });
      }
    });
  }

  function begin() { document.querySelectorAll('[data-brief]').forEach(mount); }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', begin); else begin();
  window.addEventListener('spa:pageLoaded', begin);
})();
