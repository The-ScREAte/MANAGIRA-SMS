/* About me on a member of staff's profile (views/account/update.ejs, controllers/staffAboutController.js):
 * the fun fact saves with its own button (greyed until it changes), photos upload as soon as one is
 * chosen and are removed with ×. The page is drawn again from what the server answered.
 */
(function () {
  'use strict';
  function mount() {
    var root = document.querySelector('[data-staff-about]');
    if (!root || root.dataset.bound === '1') return;
    root.dataset.bound = '1';
    var fact = root.querySelector('.sa-fact');
    var count = root.querySelector('[data-sa-count]');
    var save = root.querySelector('[data-sa-save]');
    var status = root.querySelector('[data-sa-status]');
    var photos = root.querySelector('[data-sa-photos]');
    var add = root.querySelector('[data-sa-add]');
    var file = root.querySelector('[data-sa-file]');
    var saved = fact.value;

    function say(text, error) {
      status.textContent = text || '';
      status.classList.toggle('is-error', Boolean(error));
    }
    function send(url, options) {
      return fetch(url, Object.assign({ credentials: 'same-origin', headers: { Accept: 'application/json' } }, options)).then(function (res) {
        return res.json().catch(function () { return null; }).then(function (body) {
          if (!res.ok || !body || !body.success) throw new Error((body && body.message) || 'That didn’t save. Try again.');
          return body.about;
        });
      });
    }
    function draw(about) {
      photos.querySelectorAll('.sa-photo').forEach(function (el) { el.remove(); });
      (about.photos || []).forEach(function (p) {
        var fig = document.createElement('figure');
        fig.className = 'sa-photo';
        var img = document.createElement('img');
        img.src = p.url; img.alt = '';
        var btn = document.createElement('button');
        btn.type = 'button'; btn.className = 'sa-remove'; btn.setAttribute('data-sa-remove', p.key);
        btn.setAttribute('aria-label', 'Remove this photo'); btn.textContent = '×';
        fig.appendChild(img); fig.appendChild(btn);
        photos.insertBefore(fig, add);
      });
      add.hidden = (about.photos || []).length >= 2;
    }

    fact.addEventListener('input', function () {
      count.textContent = fact.value.length + '/280';
      save.disabled = fact.value.trim() === saved.trim();
      say('');
    });
    save.addEventListener('click', function () {
      save.disabled = true;
      say('Saving…');
      send('/account/about', { method: 'POST', headers: { 'Content-Type': 'application/json', Accept: 'application/json' }, body: JSON.stringify({ funFact: fact.value }) })
        .then(function (about) {
          saved = about.funFact; fact.value = about.funFact;
          count.textContent = fact.value.length + '/280';
          say('Saved');
        })
        .catch(function (error) { save.disabled = false; say(error.message, true); });
    });
    file.addEventListener('change', function () {
      var chosen = file.files && file.files[0];
      if (!chosen) return;
      if (chosen.size > 8 * 1024 * 1024) { say('That photo is too large. Choose one under 8 MB.', true); file.value = ''; return; }
      var form = new FormData();
      form.append('photo', chosen);
      add.classList.add('is-busy');
      say('Uploading…');
      send('/account/about/photo', { method: 'POST', body: form })
        .then(function (about) { draw(about); say('Photo added'); })
        .catch(function (error) { say(error.message, true); })
        .then(function () { add.classList.remove('is-busy'); file.value = ''; });
    });
    photos.addEventListener('click', function (event) {
      var btn = event.target.closest('[data-sa-remove]');
      if (!btn) return;
      btn.disabled = true;
      send('/account/about/photo/remove', { method: 'POST', headers: { 'Content-Type': 'application/json', Accept: 'application/json' }, body: JSON.stringify({ key: btn.getAttribute('data-sa-remove') }) })
        .then(function (about) { draw(about); say('Photo removed'); })
        .catch(function (error) { btn.disabled = false; say(error.message, true); });
    });
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', mount);
  else mount();
  window.addEventListener('spa:pageLoaded', mount);
})();
