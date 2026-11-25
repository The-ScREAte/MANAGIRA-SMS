// Settings: single sign-on in one compact card: provider, values to copy, connect, test, turn on.
(function () {
  'use strict';

  var PROTOCOL = { saml: 'SAML 2.0', oidc: 'OpenID Connect' };

  function esc(value) {
    return String(value === null || value === undefined ? '' : value).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  function mount(root) {
    if (root.dataset.bound) return;
    root.dataset.bound = '1';
    var state = null;
    var manual = false;

    function call(path, body) {
      return fetch('/account/settings/sso' + path, {
        method: body ? 'POST' : 'GET',
        credentials: 'same-origin',
        headers: { Accept: 'application/json', 'X-Requested-With': 'XMLHttpRequest', 'Content-Type': 'application/json' },
        body: body ? JSON.stringify(body) : undefined,
      }).then(function (res) {
        return res.json().catch(function () { return {}; }).then(function (json) {
          if (!res.ok || json.success === false) throw new Error(json.message || 'That didn’t work. Try again.');
          return json;
        });
      });
    }
    function say(id, text, good) {
      var box = root.querySelector('[data-msg="' + id + '"]');
      if (!box) return;
      box.textContent = text || '';
      box.className = 'sso-msg' + (text ? (good ? ' is-good' : ' is-bad') : '');
    }
    function value(name) {
      var input = root.querySelector('[name="' + name + '"]');
      return input ? input.value.trim() : '';
    }
    function copyRow(label, text) {
      return '<div class="sso-copy"><span>' + esc(label) + '</span><div><code>' + esc(text) + '</code><button type="button" class="sso-btn" data-copy="' + esc(text) + '">Copy</button></div></div>';
    }
    function pill(c) {
      if (!c) return '<span class="sso-pill">Not set up</span>';
      if (c.status === 'active') return '<span class="sso-pill is-on">On</span>';
      if (c.status === 'tested') return '<span class="sso-pill is-ready">Ready</span>';
      return '<span class="sso-pill">Off</span>';
    }
    var tips = 0;
    function tip(text) {
      var id = 'sso-tip-' + (++tips);
      return '<span class="fh"><button type="button" class="fh__btn" aria-label="More about this" aria-describedby="' + id + '">?</button><span class="fh__tip" role="tooltip" id="' + id + '">' + esc(text) + '</span></span>';
    }
    function msg(id) { return '<p class="sso-msg" role="status" data-msg="' + id + '"></p>'; }
    function lbl(text, help) { return '<span class="tc-label">' + esc(text) + (help ? tip(help) : '') + '</span>'; }

    function render() {
      var c = state.connection;
      var meta = c ? state.providers.filter(function (p) { return p.key === c.provider; })[0] : null;
      var html = '<div class="sso-card tc-card"><div class="tc-head"><h2>Single sign-on</h2>' + pill(c)
        + (c ? '<button type="button" class="sso-btn tc-head__act" data-copy-all>Copy all</button>' : '') + '</div>';

      // Provider (and sign-in type when the provider offers both).
      html += '<div class="tc-grid"><label class="tc-cell">' + lbl('Provider')
        + '<select class="tc-select" data-provider-select aria-label="Provider">' + (c ? '' : '<option value="" selected>Choose…</option>')
        + state.providers.map(function (p) {
          return '<option value="' + esc(p.key) + '" data-provider="' + esc(p.key) + '"' + (c && c.provider === p.key ? ' selected' : '') + '>' + esc(p.name) + '</option>';
        }).join('') + '</select></label>';
      if (c && meta && meta.protocols.length > 1) {
        html += '<label class="tc-cell">' + lbl('Type', 'Not sure? Choose SAML 2.0.')
          + '<select class="tc-select" data-protocol-select aria-label="Sign-in type">' + meta.protocols.map(function (key) {
            return '<option value="' + key + '" data-protocol="' + key + '"' + (c.protocol === key ? ' selected' : '') + '>' + PROTOCOL[key] + '</option>';
          }).join('') + '</select></label>';
      }
      html += '</div>' + msg('provider');

      if (c) {
        // Values to copy into the provider.
        html += '<div class="tc-sub"><div class="sso-copies">'
          + (c.protocol === 'saml'
            ? copyRow('ACS URL', state.urls.acs) + copyRow('Entity ID', state.urls.entityId) + copyRow('Metadata', state.urls.metadata)
            : copyRow('Redirect URI', state.urls.redirectUri))
          + '</div></div>';

        // Connect: what the provider gives back.
        var connect = '<div class="tc-sub">';
        if (c.protocol === 'saml') {
          connect += '<div class="sso-row"><label class="sso-field sso-grow"><span class="tc-label">Metadata address' + tip('Reads everything else for you.') + '</span><input name="metadataUrl" type="url" inputmode="url" autocomplete="off" placeholder="https://" /></label><button type="button" class="sso-btn" data-read-metadata>Read it</button></div>'
            + '<details class="sso-more"' + (manual ? ' open' : '') + '><summary>Advanced</summary>'
            + '<label class="sso-field"><span class="tc-label">Metadata XML</span><textarea name="metadataXml" spellcheck="false" placeholder="<EntityDescriptor ..."></textarea></label><button type="button" class="sso-btn" data-read-xml>Read it</button>'
            + '<div class="tc-grid"><label class="sso-field"><span class="tc-label">Entity ID (Issuer)</span><input name="samlEntityId" autocomplete="off" value="' + esc(c.samlEntityId) + '" /></label>'
            + '<label class="sso-field"><span class="tc-label">Sign-in URL</span><input name="samlSsoUrl" type="url" autocomplete="off" value="' + esc(c.samlSsoUrl) + '" /></label></div>'
            + '<label class="sso-field"><span class="tc-label">Certificate' + (c.hasCertificate ? ' (saved)' : '') + '</span><textarea name="samlCertificate" spellcheck="false" placeholder="' + (c.hasCertificate ? 'Paste only to replace it' : '-----BEGIN CERTIFICATE-----') + '"></textarea></label>'
            + '<div class="tc-grid"><label class="sso-field"><span class="tc-label">Email attribute</span><input name="emailAttribute" autocomplete="off" value="' + esc(c.emailAttribute) + '" /></label></div>'
            + copyRow('Start URL', state.urls.start)
            + '</details>';
        } else {
          connect += '<div class="tc-grid"><label class="sso-field"><span class="tc-label">Issuer address</span><input name="oidcIssuer" type="url" autocomplete="off" value="' + esc(c.oidcIssuer) + '" placeholder="https://" /></label>'
            + '<label class="sso-field"><span class="tc-label">Client ID</span><input name="oidcClientId" autocomplete="off" value="' + esc(c.oidcClientId) + '" /></label>'
            + '<label class="sso-field"><span class="tc-label">Client secret' + (c.hasClientSecret ? ' (saved)' : '') + '</span><input name="oidcClientSecret" type="password" autocomplete="new-password"' + (c.hasClientSecret ? ' placeholder="Enter only to replace it"' : '') + ' /></label></div>'
            + '<details class="sso-more"><summary>Advanced</summary><div class="tc-grid"><label class="sso-field"><span class="tc-label">Email attribute</span><input name="emailAttribute" autocomplete="off" value="' + esc(c.emailAttribute) + '" /></label></div>' + copyRow('Start URL', state.urls.start) + '</details>';
        }
        connect += '</div>' + msg('save');
        // Once it's on, the connection settings fold away.
        html += (c.status === 'active' ? '<details class="sso-setup"><summary>' + esc(c.displayName) + ' · ' + esc(PROTOCOL[c.protocol] || '') + '</summary>' + connect + '</details>' : connect);

        // Who uses it.
        if (c.status === 'active') {
          html += '<div class="sso-row tc-who"><span class="sso-chip">' + (state.staff ? esc(state.staff.sso) + ' of ' + esc(state.staff.total) + ' staff' : 'Everyone') + '</span>'
            + (state.staff && state.staff.sso < state.staff.total
              ? '<label class="sso-field sso-grow" hidden data-everyone-box><span class="tc-label">Your password</span><input name="everyonePassword" type="password" autocomplete="current-password" /></label><button type="button" class="sso-btn" data-everyone>Use ' + esc(c.displayName) + ' for everyone</button><a class="sso-btn" href="/common/manageEmployees" data-no-spa>Choose people</a>'
              : '')
            + '</div>' + msg('everyone');
        }

        // Test, students, turn on.
        html += '<div class="tc-sub tc-sub--rule"><div class="tc-switchrow"><label class="tc-switch"><input type="checkbox" data-option="allowStudents"' + (c.allowStudents ? ' checked' : '') + ' aria-label="Students too" /><span></span></label>'
          + '<span class="tc-label tc-label--inline">Students too' + tip('For students whose portal email is an account at your provider.') + '</span></div></div>'
          + '<div class="tc-foot tc-foot--wide">'
          + '<label class="sso-field sso-grow tc-pass"><input name="confirmPassword" type="password" autocomplete="current-password" placeholder="Your password" aria-label="Your password' + (c.status === 'active' ? ', to change or turn off' : ', to confirm') + '" /></label>'
          + '<button type="button" class="sso-btn" data-save>Save</button>'
          + '<button type="button" class="sso-btn" data-test' + (c.complete ? '' : ' disabled') + '>Test</button>'
          + (c.status === 'active'
            ? '<button type="button" class="sso-btn" data-turn-off>Turn off</button>'
            : '<button type="button" class="sso-btn sso-btn--go" data-turn-on' + (c.status === 'tested' ? '' : ' disabled') + '>Turn on</button>')
          + '</div>'
          + (c.status === 'active' ? '' : '<p class="tc-warn">Test first, then turn on. Your main manager can always use a password.</p>')
          + (c.testedAt ? '<p class="tc-ok">Test worked for ' + esc(c.testedEmail || '') + '</p>' : '') + msg('test') + msg('switch');

        // Recent activity (only when there is some) and Remove.
        if (state.events.length) {
          html += '<details class="sso-more tc-activity"><summary>Recent activity (' + state.events.length + ')</summary><ul class="sso-events">' + state.events.map(function (row) {
            var when = new Date(row.created_at).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
            var what = row.kind === 'setup' ? row.detail : (row.kind === 'test' ? 'Test' : 'Sign-in') + (row.outcome === 'ok' ? '' : ' refused');
            return '<li><span class="' + (row.outcome === 'ok' ? '' : 'is-no') + '">' + esc(what) + (row.email ? ' · ' + esc(row.email) : '') + (row.outcome !== 'ok' && row.detail && row.kind !== 'setup' ? '<small> ' + esc(row.detail) + '</small>' : '') + '</span><small>' + esc(when) + '</small></li>';
          }).join('') + '</ul></details>';
        }
        html += '<div class="sso-row tc-remove"><label class="sso-field sso-grow" hidden data-remove-box><span class="tc-label">Your password</span><input name="removePassword" type="password" autocomplete="current-password" /></label><button type="button" class="sso-link sso-link--danger" data-remove>Remove connection</button></div>' + msg('remove');
      }
      root.innerHTML = html + '</div>';
    }

    function load() {
      return call('').then(function (result) { state = result; render(); }).catch(function (error) {
        root.innerHTML = '<div class="sso-card"><p>' + esc(error.message) + '</p></div>';
      });
    }
    function settingsBody(extra) {
      var c = state.connection || {};
      var body = {
        provider: c.provider, protocol: c.protocol, displayName: c.displayName,
        allowStudents: Boolean(c.allowStudents), requireSso: Boolean(c.requireSso),
        emailAttribute: value('emailAttribute') || c.emailAttribute || '',
        samlEntityId: value('samlEntityId') || c.samlEntityId || '', samlSsoUrl: value('samlSsoUrl') || c.samlSsoUrl || '', samlCertificate: value('samlCertificate'),
        oidcIssuer: value('oidcIssuer') || c.oidcIssuer || '', oidcClientId: value('oidcClientId') || c.oidcClientId || '', oidcClientSecret: value('oidcClientSecret'),
      };
      Object.keys(extra || {}).forEach(function (key) { body[key] = extra[key]; });
      body.confirmPassword = value('confirmPassword');
      return body;
    }
    function saveWith(extra, where, doneText) {
      return call('', settingsBody(extra)).then(function (result) {
        state.connection = result.connection;
        state.urls = result.urls;
        return call('');
      }).then(function (result) {
        state = result;
        render();
        if (doneText) say(where, doneText, true);
      }).catch(function (error) {
        say(where, error.message);
        // A box that couldn't be saved goes back to what's really saved.
        return load().then(function () { say(where, error.message); });
      });
    }
    function useMetadata(found) {
      return saveWith({ samlEntityId: found.samlEntityId, samlSsoUrl: found.samlSsoUrl, samlCertificates: found.samlCertificates, samlCertificate: undefined }, 'save', 'Saved');
    }

    root.addEventListener('click', async function (event) {
      var button = event.target.closest('button');
      if (!button) return;
      var copy = button.getAttribute('data-copy');
      if (copy !== null) {
        (navigator.clipboard ? navigator.clipboard.writeText(copy) : Promise.reject(new Error('no'))).then(function () {
          button.textContent = 'Copied';
          setTimeout(function () { button.textContent = 'Copy'; }, 1500);
        }).catch(function () { window.prompt('Copy this:', copy); });
        return;
      }
      if (button.hasAttribute('data-copy-all')) {
        var sheet = state.connection.protocol === 'saml'
          ? ['Managira single sign-on (SAML 2.0)', 'ACS URL (Reply URL): ' + state.urls.acs, 'Entity ID (Audience): ' + state.urls.entityId, 'Metadata: ' + state.urls.metadata, 'Start URL: ' + state.urls.start, 'Send the email address as the NameID, or in an attribute named email. Sign the assertion or the response.']
          : ['Managira single sign-on (OpenID Connect)', 'Application type: Web application, authorization code flow', 'Redirect URI: ' + state.urls.redirectUri, 'Scopes: openid email profile', 'Start URL: ' + state.urls.start, 'Send back: the issuer address, the client ID and the client secret.'];
        (navigator.clipboard ? navigator.clipboard.writeText(sheet.join('\n')) : Promise.reject(new Error('no'))).then(function () {
          button.textContent = 'Copied';
          setTimeout(function () { button.textContent = 'Copy all'; }, 1500);
        }).catch(function () { window.prompt('Copy this:', sheet.join(' | ')); });
        return;
      }
      if (button.hasAttribute('data-read-metadata') || button.hasAttribute('data-read-xml')) {
        var body = button.hasAttribute('data-read-xml') ? { xml: value('metadataXml') } : { url: value('metadataUrl') };
        button.disabled = true;
        call('/metadata', body).then(useMetadata).catch(function (error) { say('save', error.message); button.disabled = false; });
        return;
      }
      if (button.hasAttribute('data-save')) { saveWith({}, 'save', 'Saved'); return; }
      if (button.hasAttribute('data-test')) {
        var tab = window.open('/account/settings/sso/test', '_blank');
        if (!tab) { say('test', 'Your browser blocked the new tab. Allow pop-ups for this site, then try again.'); return; }
        say('test', 'Finish signing in on the new tab, then come back here.', true);
        return;
      }
      if (button.hasAttribute('data-turn-on')) {
        call('/turn-on', { password: value('confirmPassword') }).then(function () { return load(); }).then(function () { say('switch', 'Single sign-on is on.', true); }).catch(function (error) { say('switch', error.message); });
        return;
      }
      if (button.hasAttribute('data-everyone')) {
        var everyoneBox = root.querySelector('[data-everyone-box]');
        if (everyoneBox.hidden) { everyoneBox.hidden = false; everyoneBox.querySelector('input').focus(); return; }
        button.disabled = true;
        call('/everyone', { password: value('everyonePassword') }).then(function (result) {
          return load().then(function () { say('switch', result.changed === 1 ? '1 person now signs in with ' + state.connection.displayName + '.' : result.changed + ' people now sign in with ' + state.connection.displayName + '.', true); });
        }).catch(function (error) { button.disabled = false; say('everyone', error.message); });
        return;
      }
      if (button.hasAttribute('data-turn-off')) {
        if (!await window.appConfirm('Turn off single sign-on? Everyone signs in with a Managira password.')) return;
        call('/turn-off', { password: value('confirmPassword') }).then(function () { return load(); }).catch(function (error) { say('switch', error.message); });
        return;
      }
      if (button.hasAttribute('data-remove')) {
        var box = root.querySelector('[data-remove-box]');
        if (box.hidden) { box.hidden = false; box.querySelector('input').focus(); return; }
        call('/remove', { password: value('removePassword') }).then(function () { return load(); }).catch(function (error) { say('remove', error.message); });
      }
    });
    root.addEventListener('change', function (event) {
      if (event.target.hasAttribute && event.target.hasAttribute('data-provider-select')) {
        var key = event.target.value;
        var meta = state.providers.filter(function (p) { return p.key === key; })[0];
        if (meta) saveWith({ provider: key, protocol: meta.protocols[0], displayName: meta.name }, 'provider');
        return;
      }
      if (event.target.hasAttribute && event.target.hasAttribute('data-protocol-select')) { saveWith({ protocol: event.target.value }, 'provider'); return; }
      var option = event.target.getAttribute && event.target.getAttribute('data-option');
      if (!option) return;
      var extra = {};
      extra[option] = event.target.checked;
      saveWith(extra, 'switch', 'Saved.');
    });
    // The test finishes on another tab: pick up the result on the way back.
    window.addEventListener('focus', function () { if (state && state.connection && state.connection.status !== 'active') load(); });
    load();
  }

  function begin() { var root = document.getElementById('ssoSettings'); if (root) mount(root); }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', begin);
  else begin();
  window.addEventListener('spa:pageLoaded', begin);
})();
