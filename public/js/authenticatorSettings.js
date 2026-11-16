// Settings › Two-step sign-in (controllers/authenticatorController.js): an authenticator app for
// this person's own sign-in. Managers and people with Settings access set it up here, and anyone
// the school requires it for. Names and codes go in as text, never as markup.
(function () {
  'use strict';

  function el(tag, attrs, children) {
    var node = document.createElement(tag);
    Object.keys(attrs || {}).forEach(function (key) {
      if (key === 'text') node.textContent = attrs[key];
      else if (key === 'className') node.className = attrs[key];
      else node.setAttribute(key, attrs[key]);
    });
    (children || []).forEach(function (child) { if (child) node.appendChild(child); });
    return node;
  }
  function call(url, body) {
    return fetch(url, {
      method: body ? 'POST' : 'GET',
      credentials: 'same-origin',
      headers: { Accept: 'application/json', 'Content-Type': 'application/json', 'X-Requested-With': 'XMLHttpRequest' },
      body: body ? JSON.stringify(body) : undefined,
    }).then(function (res) {
      return res.json().catch(function () { return {}; }).then(function (json) {
        if (!res.ok || !json.success) throw new Error(json.message || "That didn't work. Try again.");
        return json;
      });
    });
  }
  function say(node, text, good) { node.textContent = text || ''; node.className = 'sso-msg' + (text ? (good ? ' is-good' : ' is-bad') : ''); }

  function start(root) {
    if (root.dataset.ready === '1') return;
    root.dataset.ready = '1';
    root.textContent = '';
    root.appendChild(el('div', { className: 'sso-card' }, [el('p', { text: 'Loading…' })]));
    call('/account/authenticator/status').then(function (state) { render(root, state); })
      .catch(function (error) { root.textContent = ''; root.appendChild(el('div', { className: 'sso-card' }, [el('p', { text: error.message })])); });
  }

  function render(root, state) {
    root.textContent = '';
    var justRequired = /[?&]required=1\b/.test(location.search) && state.required && !state.on;
    if (justRequired) root.appendChild(el('p', { className: 'ts-note', role: 'alert', text: 'Your school asks you to use an authenticator app to sign in. Set it up below to continue.' }));
    if (state.sso) root.appendChild(el('p', { className: 'ts-note', text: 'You signed in with your school’s single sign-on, which has its own two-step check. This app is used when you sign in with your Managira password.' }));

    var pill = el('span', { className: 'sso-pill' + (state.on ? ' is-on' : ''), text: state.on ? 'On' : 'Off' });
    var status = el('div', { className: 'sso-card' }, [
      el('div', { className: 'sso-head' }, [el('h2', { text: 'Authenticator app' }), pill]),
      el('p', { text: state.on
        ? 'When you sign in with your password, Managira asks for the 6-digit code from your app. Lost your phone? Use a recovery code, or ask a manager to reset it.'
        : 'Install an app such as Google Authenticator, Microsoft Authenticator or Authy, then set it up here. It takes a minute.' }),
    ]);
    root.appendChild(status);

    if (!state.on) {
      var msg = el('p', { className: 'sso-msg', role: 'status' });
      var button = el('button', { type: 'button', className: 'sso-btn sso-btn--go', text: 'Set up' });
      status.appendChild(el('div', { className: 'sso-row' }, [button]));
      status.appendChild(msg);
      button.addEventListener('click', function () {
        button.disabled = true;
        call('/account/authenticator/start', {}).then(function (json) { status.replaceWith(setupCard(root, json)); })
          .catch(function (error) { button.disabled = false; say(msg, error.message); });
      });
      return;
    }
    if (state.required) {
      status.appendChild(el('p', { className: 'sso-hint', text: 'Your school requires it, so it stays on.' }));
      return;
    }
    var password = el('input', { type: 'password', className: 'ts-password', autocomplete: 'current-password', placeholder: 'Your password', 'aria-label': 'Your password' });
    var off = el('button', { type: 'button', className: 'sso-btn sso-btn--danger', text: 'Turn off' });
    var offMsg = el('p', { className: 'sso-msg', role: 'status' });
    status.appendChild(el('div', { className: 'sso-row' }, [password, off]));
    status.appendChild(offMsg);
    off.addEventListener('click', function () {
      if (!password.value) { say(offMsg, 'Enter your password to turn it off.'); password.focus(); return; }
      off.disabled = true;
      call('/account/authenticator/off', { password: password.value }).then(function () { return call('/account/authenticator/status'); })
        .then(function (next) { render(root, next); })
        .catch(function (error) { off.disabled = false; say(offMsg, error.message); });
    });
  }

  function setupCard(root, json) {
    var qr = el('img', { className: 'ts-qr', alt: 'QR code for your authenticator app', src: json.qr });
    var code = el('input', { className: 'ts-code', inputmode: 'numeric', autocomplete: 'one-time-code', maxlength: '7', placeholder: '123456', 'aria-label': 'Code from your app' });
    var confirm = el('button', { type: 'button', className: 'sso-btn sso-btn--go', text: 'Turn on' });
    var msg = el('p', { className: 'sso-msg', role: 'status' });
    var card = el('div', { className: 'sso-card' }, [
      el('h2', { text: 'Scan the code' }),
      el('div', { className: 'ts-steps' }, [
        el('div', {}, [
          el('ol', {}, [
            el('li', { text: 'In your authenticator app, add an account (usually the + button).' }),
            el('li', { text: 'Scan the QR code, or type the key below.' }),
            el('li', { text: 'Enter the 6-digit code the app shows.' }),
          ]),
          el('span', { className: 'sso-hint', text: 'Key, if you can’t scan:' }),
          el('code', { className: 'ts-key', text: json.secret }),
        ]),
        qr,
      ]),
      el('div', { className: 'sso-row', style: 'margin-top:12px' }, [code, confirm]),
      msg,
    ]);
    function submit() {
      var value = code.value.replace(/\s+/g, '');
      if (!/^\d{6}$/.test(value)) { say(msg, 'Enter the 6-digit code from your app.'); code.focus(); return; }
      confirm.disabled = true;
      call('/account/authenticator/confirm', { code: value }).then(function (done) { card.replaceWith(recoveryCard(root, done.recovery || [])); })
        .catch(function (error) { confirm.disabled = false; say(msg, error.message); });
    }
    confirm.addEventListener('click', submit);
    code.addEventListener('keydown', function (event) { if (event.key === 'Enter') { event.preventDefault(); submit(); } });
    setTimeout(function () { code.focus(); }, 50);
    return card;
  }

  function recoveryCard(root, codes) {
    var list = el('div', { className: 'ts-codes' }, codes.map(function (c) { return el('div', { text: c }); }));
    var print = el('button', { type: 'button', className: 'sso-btn', text: 'Print' });
    var copy = el('button', { type: 'button', className: 'sso-btn', text: 'Copy' });
    var done = el('button', { type: 'button', className: 'sso-btn sso-btn--go', text: 'Done' });
    var card = el('div', { className: 'sso-card ts-print' }, [
      el('div', { className: 'sso-head' }, [el('h2', { text: 'It’s on. Save your recovery codes' }), el('span', { className: 'sso-pill is-on', text: 'On' })]),
      el('p', { text: 'Each code signs you in once if you lose your phone. Keep them somewhere safe, like a password manager. They won’t be shown again.' }),
      list,
      el('div', { className: 'sso-row' }, [copy, print, done]),
    ]);
    print.addEventListener('click', function () { window.print(); });
    copy.addEventListener('click', function () {
      if (navigator.clipboard) navigator.clipboard.writeText(codes.join('\n')).then(function () { copy.textContent = 'Copied'; }).catch(function () {});
    });
    done.addEventListener('click', function () {
      // Someone the school required it for goes on to Managira; everyone else sees it on.
      if (/[?&]required=1\b/.test(location.search)) { location.href = '/common/orgDashboard'; return; }
      call('/account/authenticator/status').then(function (state) { render(root, state); });
    });
    return card;
  }

  function boot() {
    var root = document.getElementById('twoStepSettings');
    if (root) start(root);
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
  window.addEventListener('spa:pageLoaded', boot);
})();
