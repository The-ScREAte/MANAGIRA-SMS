/* "Children at another school?" on the parent dashboard (feature family_link): sends a code to the
 * parent's sign-in email and, once it's entered, reloads so the other schools' children show. */
(function () {
  'use strict';
  function post(url, body) {
    return fetch(url, { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json', Accept: 'application/json' }, body: JSON.stringify(body || {}) })
      .then(function (res) {
        return res.json().catch(function () { return null; }).then(function (data) {
          if (!res.ok || !data || !data.success) throw new Error((data && data.message) || 'That didn’t work. Try again.');
          return data;
        });
      });
  }
  function mount() {
    var box = document.querySelector('[data-family-confirm]');
    if (!box || box.dataset.bound === '1') return;
    box.dataset.bound = '1';
    var note = box.querySelector('[data-fl-note]');
    var sendStep = box.querySelector('[data-fl-step="send"]');
    var codeStep = box.querySelector('[data-fl-step="code"]');
    var send = box.querySelector('[data-fl-send]');
    var input = box.querySelector('[data-fl-code]');
    function say(text, error) { note.textContent = text || ''; note.classList.toggle('is-error', Boolean(error)); }
    send.addEventListener('click', function () {
      send.disabled = true;
      say('Sending…');
      post('/guardian/family/confirm/send').then(function (data) {
        sendStep.hidden = true;
        codeStep.hidden = false;
        say('We sent a code to ' + data.to + '. Enter it here.');
        input.focus();
      }).catch(function (error) { send.disabled = false; say(error.message, true); });
    });
    codeStep.addEventListener('submit', function (event) {
      event.preventDefault();
      var btn = codeStep.querySelector('button');
      btn.disabled = true;
      say('Checking…');
      post('/guardian/family/confirm', { code: input.value }).then(function () {
        say('Confirmed. Adding your children…');
        window.location.reload();
      }).catch(function (error) { btn.disabled = false; say(error.message, true); });
    });
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', mount);
  else mount();
  window.addEventListener('spa:pageLoaded', mount);
})();
