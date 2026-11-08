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
      return '<option value="' + v + '"' + (Number(v) === Number(current) ? ' selected' : '') + '>' + esc(describe(v)) + '</option>';
    }).join('') + '</select>';
  }
  function toggle(name, on, label) {
    return '<label class="tc-switch"><input type="checkbox" name="' + name + '"' + (on ? ' checked' : '') + ' aria-label="' + esc(label) + '" /><span></span></label>';
  }
  function row(title, control, hide) {
    return '<div class="tc-row"' + (hide ? ' data-hide="' + hide + '"' : '') + '><span>' + esc(title) + '</span>' + control + '</div>';
  }
  var days = function (d) { return Number(d) === 1 ? '1 day' : d + ' days'; };

  function render(root, state) {
    var s = state.settings, c = state.choices;
    var html =
      '<form class="tc-form" novalidate>' +
      '<div class="sso-card"><h2>Session</h2>' +
      row('Session timeout', select('session_hours', c.session_hours, s.session_hours, 'Session timeout', function (h) { return HOURS[h] || h + ' hours'; })) +
      row('Allow Keep me logged in', toggle('keep_signed_in_allowed', s.keep_signed_in_allowed, 'Allow Keep me logged in')) +
      row('Keep me logged in for', select('keep_signed_in_days', c.keep_signed_in_days, s.keep_signed_in_days, 'Keep me logged in for', days), 'keep_signed_in_allowed') +
      '</div>';
    if (state.codeAvailable) {
      html +=
        '<div class="sso-card"><h2>Verification code</h2>' +
        row('Email a code at sign-in', toggle('login_code_required', s.login_code_required, 'Email a code at sign-in')) +
        row('Allow device to be remembered', toggle('remember_device_allowed', s.remember_device_allowed, 'Allow device to be remembered'), 'login_code_required') +
        row('Trust duration', select('remember_device_days', c.remember_device_days, s.remember_device_days, 'Trust duration', days), 'remember_device_allowed') +
        '</div>';
    }
    html += '<div class="tc-save"><button type="submit" class="sso-btn sso-btn--go" disabled>Save</button><p class="sso-msg" role="status"></p></div></form>';
    root.innerHTML = html;
    var form = root.querySelector('form');
    var button = form.querySelector('[type="submit"]');
    var msg = form.querySelector('.sso-msg');
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
    form.addEventListener('change', function () { sync(); button.disabled = false; msg.textContent = ''; msg.className = 'sso-msg'; });
    form.addEventListener('submit', function (event) {
      event.preventDefault();
      var body = {};
      form.querySelectorAll('select').forEach(function (el) { body[el.name] = el.value; });
      form.querySelectorAll('input[type="checkbox"]').forEach(function (el) { body[el.name] = el.checked; });
      button.disabled = true;
      button.textContent = 'Saving…';
      call(body).then(function (next) {
        render(root, next);
        var after = root.querySelector('.sso-msg');
        after.textContent = 'Saved.';
        after.className = 'sso-msg is-good';
      }).catch(function (error) {
        button.disabled = false;
        button.textContent = 'Save';
        msg.textContent = error.message;
        msg.className = 'sso-msg is-bad';
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
