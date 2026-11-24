// Settings, Tenant configuration: how long a sign-in lasts, Keep me logged in, and the
// verification code. Saved together; the server only accepts the choices shown.
(function () {
  'use strict';

  var HOURS = { 8: '8 hours', 12: '12 hours', 24: '24 hours', 72: '3 days', 168: '7 days' };

  function esc(value) {
    return String(value === null || value === undefined ? '' : value).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  function call(body) {
    return fetch('/account/settings/tenant', {
      method: body ? 'POST' : 'GET',
      credentials: 'same-origin',
      headers: { Accept: 'application/json', 'X-Requested-With': 'XMLHttpRequest', 'Content-Type': 'application/json' },
      body: body ? JSON.stringify(body) : undefined,
    }).then(function (res) {
      return res.json().catch(function () { return {}; }).then(function (json) {
        if (!res.ok || !json.success) throw new Error(json.message || "That didn't work. Try again.");
        return json;
      });
    });
  }

  function select(name, values, current, label, describe) {
    return '<select class="tc-select" name="' + name + '" aria-label="' + esc(label) + '">' + values.map(function (v) {
      return '<option value="' + esc(v) + '"' + (String(v) === String(current) ? ' selected' : '') + '>' + esc(describe(v)) + '</option>';
    }).join('') + '</select>';
  }
  var RULES = { off: 'Each person chooses', admins: 'Managers and supervisors', staff: 'All staff' };
  function when(value) {
    if (!value) return '';
    var d = new Date(value);
    return isNaN(d.getTime()) ? '' : d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
  }
  function toggle(name, on, label) {
    return '<label class="tc-switch"><input type="checkbox" name="' + name + '"' + (on ? ' checked' : '') + ' aria-label="' + esc(label) + '" /><span></span></label>';
  }
  // The small round "?" (public/css/fieldHelp.css).
  function tip(text, id) {
    return '<span class="fh"><button type="button" class="fh__btn" aria-label="More about this" aria-describedby="' + id + '">?</button><span class="fh__tip" role="tooltip" id="' + id + '">' + esc(text) + '</span></span>';
  }
  // One labelled cell of the grid: small uppercase label above its control.
  var tipCount = 0;
  function cell(title, control, hide, help) {
    return '<div class="tc-cell"' + (hide ? ' data-hide="' + hide + '"' : '') + '><span class="tc-label">' + esc(title) + (help ? tip(help, 'tch-' + (++tipCount)) : '') + '</span>' + control + '</div>';
  }
  function foot(label) {
    return '<div class="tc-foot"><p class="sso-msg" role="status"></p><button type="submit" class="sso-btn sso-btn--go" disabled>' + label + '</button></div>';
  }
  var days = function (d) { return Number(d) === 1 ? '1 day' : d + ' days'; };

  function render(root, state) {
    var s = state.settings, c = state.choices;
    var html =
      '<form class="tc-form" novalidate>' +
      '<div class="sso-card tc-card"><div class="tc-head"><h2>Session</h2></div><div class="tc-grid">' +
      cell('Session timeout', select('session_hours', c.session_hours, s.session_hours, 'Session timeout', function (h) { return HOURS[h] || h + ' hours'; })) +
      cell('Allow Keep me logged in', toggle('keep_signed_in_allowed', s.keep_signed_in_allowed, 'Allow Keep me logged in')) +
      cell('Keep me logged in for', select('keep_signed_in_days', c.keep_signed_in_days, s.keep_signed_in_days, 'Keep me logged in for', days), 'keep_signed_in_allowed');
    if (state.codeAvailable) {
      html +=
        cell('Email a code at sign-in', toggle('login_code_required', s.login_code_required, 'Email a code at sign-in')) +
        cell('Allow device to be remembered', toggle('remember_device_allowed', s.remember_device_allowed, 'Allow device to be remembered'), 'login_code_required', 'Skips the code on a device that already passed it.') +
        cell('Trust duration', select('remember_device_days', c.remember_device_days, s.remember_device_days, 'Trust duration', days), 'remember_device_allowed');
    }
    html += '</div>' + foot('Save') + '</div>';
    var app = state.authenticator || {};
    if (app.available) {
      var people = app.people || [];
      html +=
        '<div class="sso-card tc-card"><div class="tc-head"><h2>Two-step sign-in</h2></div><div class="tc-inline"><div class="tc-grid tc-grid--one">' +
        cell('Authenticator app at sign-in', select('mfa_required', c.mfa_required || ['off', 'admins', 'staff'], s.mfa_required || 'off', 'Authenticator app at sign-in', function (v) { return RULES[v] || v; }), null, 'Set up your own under Two-step sign-in.') +
        '</div>' + foot('Save') + '</div>' +
        (people.length
          ? '<ul class="tc-list">' + people.map(function (p) {
              return '<li><span><strong></strong><small></small></span><button type="button" class="sso-btn" data-reset-kind="' + esc(p.kind) + '" data-reset-id="' + esc(p.id) + '">Reset</button></li>';
            }).join('') + '</ul>'
          : '') +
        '<div class="tc-reset" hidden><input type="password" class="tc-select" autocomplete="current-password" placeholder="Your password" aria-label="Your password" /> <button type="button" class="sso-btn sso-btn--go" data-reset-go>Reset</button> <button type="button" class="sso-btn" data-reset-cancel>Cancel</button><p class="sso-msg" role="status"></p></div>' +
        '</div>';
    }
    html += '</form>';
    root.innerHTML = html;
    // Names go in as text, never as markup.
    root.querySelectorAll('.tc-list li').forEach(function (li, i) {
      var p = (app.people || [])[i];
      if (!p) return;
      li.querySelector('strong').textContent = p.name || 'Someone';
      li.querySelector('small').textContent = p.since ? ' · since ' + when(p.since) + (p.recoveryLeft ? ' · ' + p.recoveryLeft + ' codes left' : '') : '';
    });
    var resetBox = root.querySelector('.tc-reset');
    var resetting = null;
    root.querySelectorAll('[data-reset-kind]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        resetting = { kind: btn.getAttribute('data-reset-kind'), id: Number(btn.getAttribute('data-reset-id')) };
        resetBox.hidden = false;
        resetBox.querySelector('input').value = '';
        resetBox.querySelector('input').focus();
      });
    });
    if (resetBox) {
      resetBox.querySelector('[data-reset-cancel]').addEventListener('click', function () { resetBox.hidden = true; resetting = null; });
      resetBox.querySelector('[data-reset-go]').addEventListener('click', function () {
        var password = resetBox.querySelector('input').value;
        var note = resetBox.querySelector('.sso-msg');
        if (!resetting || !password) { note.textContent = 'Enter your password.'; note.className = 'sso-msg is-bad'; return; }
        fetch('/account/settings/tenant/authenticator/reset', {
          method: 'POST', credentials: 'same-origin',
          headers: { Accept: 'application/json', 'Content-Type': 'application/json', 'X-Requested-With': 'XMLHttpRequest' },
          body: JSON.stringify({ kind: resetting.kind, id: resetting.id, password: password }),
        }).then(function (res) { return res.json().then(function (json) { if (!res.ok || !json.success) throw new Error(json.message || "That didn't work."); return json; }); })
          .then(function (next) { render(root, next); var m = root.querySelector('.tc-foot:last-child .sso-msg') || root.querySelector('.tc-foot .sso-msg'); m.textContent = 'Reset.'; m.className = 'sso-msg is-good'; })
          .catch(function (error) { note.textContent = error.message; note.className = 'sso-msg is-bad'; });
      });
    }
    var form = root.querySelector('form');
    var buttons = Array.prototype.slice.call(form.querySelectorAll('[type="submit"]'));
    var button = buttons[0];
    var msg = form.querySelector('.tc-foot .sso-msg');
    var field = function (name) { return form.querySelector('[name="' + name + '"]'); };

    function sync() {
      form.querySelectorAll('[data-hide]').forEach(function (r) {
        var parent = field(r.getAttribute('data-hide'));
        var grand = parent && parent.closest('[data-hide]');
        var shown = parent && parent.checked && !(grand && grand.hidden);
        r.hidden = !shown;
      });
    }
    sync();
    form.addEventListener('change', function (event) {
      sync();
      // Only the card that was touched offers its Save; either one saves the whole form.
      var card = event.target.closest('.tc-card');
      var own = card && card.querySelector('[type="submit"]');
      (own ? [own] : buttons).forEach(function (b) { b.disabled = false; });
      form.querySelectorAll('.tc-foot .sso-msg').forEach(function (m) { m.textContent = ''; m.className = 'sso-msg'; });
    });
    form.addEventListener('submit', function (event) {
      event.preventDefault();
      var body = {};
      form.querySelectorAll('select[name]').forEach(function (el) { body[el.name] = el.value; });
      form.querySelectorAll('input[type="checkbox"]').forEach(function (el) { body[el.name] = el.checked; });
      var pressed = (event.submitter && event.submitter.type === 'submit') ? event.submitter : button;
      var feedback = pressed.parentNode.querySelector('.sso-msg') || msg;
      buttons.forEach(function (b) { b.disabled = true; });
      pressed.textContent = 'Saving…';
      call(body).then(function (next) {
        render(root, next);
        var after = (root.querySelectorAll('.tc-foot .sso-msg')[Array.prototype.indexOf.call(buttons, pressed)]) || root.querySelector('.tc-foot .sso-msg');
        after.textContent = 'Saved';
        after.className = 'sso-msg is-good';
      }).catch(function (error) {
        buttons.forEach(function (b) { b.disabled = false; });
        pressed.textContent = 'Save';
        feedback.textContent = error.message;
        feedback.className = 'sso-msg is-bad';
      });
    });
  }

  function mount(root) {
    if (root.dataset.bound) return;
    root.dataset.bound = '1';
    call().then(function (state) { render(root, state); }).catch(function (error) {
      root.innerHTML = '<p class="sso-msg is-bad">' + esc(error.message) + '</p>';
    });
  }

  function begin() { var root = document.getElementById('tenantSettings'); if (root) mount(root); }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', begin); else begin();
  window.addEventListener('spa:pageLoaded', begin);
})();
