// Settings: set up single sign-on in four short steps.
(function () {
  'use strict';

  var HELP = {
    google: { saml: 'In the Google Admin console: Apps, Web and mobile apps, Add custom SAML app.', oidc: 'In Google Cloud: APIs & Services, Credentials, Create OAuth client ID (Web application). The issuer is https://accounts.google.com.' },
    microsoft: { saml: 'In the Entra admin center: Enterprise applications, New application, Create your own, then Single sign-on and SAML.', oidc: 'In the Entra admin center: App registrations, New registration. The issuer is https://login.microsoftonline.com/YOUR-TENANT-ID/v2.0.' },
    okta: { saml: 'In the Okta admin console: Applications, Create App Integration, SAML 2.0.', oidc: 'In the Okta admin console: Applications, Create App Integration, OIDC, Web Application. The issuer is your Okta address.' },
    onelogin: { saml: 'In OneLogin: Applications, Add App, SAML Custom Connector.', oidc: 'In OneLogin: Applications, Add App, OpenId Connect (OIDC). The issuer is https://YOUR-SUBDOMAIN.onelogin.com/oidc/2.' },
    classlink: { saml: 'In ClassLink Management Console: Single Sign-On, SAML Console, Add.', oidc: 'Ask ClassLink support to create an OpenID Connect app for these addresses.' },
    clever: { saml: 'In Clever: your SAML Connector settings. Clever gives you the metadata address.' },
    jumpcloud: { saml: 'In JumpCloud: SSO Applications, Add New Application, Custom SAML App.', oidc: 'In JumpCloud: SSO Applications, Add New Application, Custom OIDC App. The issuer is https://oauth.id.jumpcloud.com/.' },
    ping: { saml: 'In PingOne: Applications, Add Application, SAML.', oidc: 'In PingOne: Applications, Add Application, OIDC Web App.' },
    auth0: { saml: 'In Auth0: Applications, Addons, SAML2 Web App.', oidc: 'In Auth0: Applications, Create Application, Regular Web Application. The issuer is your Auth0 domain.' },
    adfs: { saml: 'In AD FS Management: Relying Party Trusts, Add Relying Party Trust. Metadata is at https://YOUR-SERVER/FederationMetadata/2007-06/FederationMetadata.xml.' },
    shibboleth: { saml: 'Add these addresses to your Shibboleth metadata, and release the mail attribute.' },
    other: { saml: 'Any provider that supports SAML 2.0 works, including one your school runs itself. Give your IT team the addresses below.', oidc: 'Any provider that supports OpenID Connect works, including one your school runs itself. Give your IT team the address below.' },
  };
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
      if (c.status === 'tested') return '<span class="sso-pill is-ready">Ready to turn on</span>';
      return '<span class="sso-pill">Off</span>';
    }

    function render() {
      var c = state.connection;
      var html = '<div class="sso-card"><div class="sso-head"><h2>Status</h2>' + pill(c) + '</div>'
        + (c && c.status === 'active' ? '<p style="margin:6px 0 0">' + (state.staff
          ? esc(state.staff.sso) + ' of ' + esc(state.staff.total) + ' staff sign in with ' + esc(c.displayName) + '. Everyone else uses a Managira password. You choose for each person on their staff form, in Users / Employees.'
          : 'People at your school sign in with ' + esc(c.displayName) + '.') + ' Your main manager can always use a password.</p>'
          + (state.staff && state.staff.sso < state.staff.total
            ? '<div class="sso-row" style="margin-top:12px"><label class="sso-field sso-grow" hidden data-everyone-box><span>Your password, to move everyone to ' + esc(c.displayName) + '</span><input name="everyonePassword" type="password" autocomplete="current-password" /></label><button type="button" class="sso-btn sso-btn--go" data-everyone>Use ' + esc(c.displayName) + ' for everyone</button><a class="sso-btn" href="/common/manageEmployees" data-no-spa>Choose people</a></div><p class="sso-msg" data-msg="everyone"></p>'
            : '')
          : '')
        + '</div>';

      // Once it's on, the setup steps fold away: the status and who uses it stay on top.
      var folded = c && c.status === 'active';
      if (folded) html += '<details class="sso-setup"><summary>Connection settings: ' + esc(c.displayName) + ' (' + esc(PROTOCOL[c.protocol] || '') + ')</summary>';
      html += '<div class="sso-card"><h2>1. Your provider</h2><div class="sso-providers">'
        + state.providers.map(function (p) {
          return '<button type="button" class="sso-provider' + (c && c.provider === p.key ? ' is-on' : '') + '" data-provider="' + esc(p.key) + '">' + esc(p.name) + '</button>';
        }).join('') + '</div>';
      if (c) {
        var meta = state.providers.filter(function (p) { return p.key === c.provider; })[0];
        if (meta && meta.protocols.length > 1) {
          html += '<div class="sso-tabs" role="group" aria-label="Sign-in type">' + meta.protocols.map(function (key) {
            return '<button type="button" class="' + (c.protocol === key ? 'is-on' : '') + '" data-protocol="' + key + '" aria-pressed="' + (c.protocol === key) + '">' + PROTOCOL[key] + '</button>';
          }).join('') + '</div><p class="sso-hint">Not sure which? Choose SAML 2.0: every provider here supports it.</p>';
        }
      }
      html += '<p class="sso-msg" data-msg="provider"></p></div>';

      if (c) {
        var help = (HELP[c.provider] || HELP.other)[c.protocol] || '';
        html += '<div class="sso-card"><h2>2. Add Managira to ' + (c.provider === 'other' ? 'your provider' : esc(c.displayName)) + '</h2><p>' + esc(help) + '</p>';
        if (c.protocol === 'saml') {
          html += copyRow('ACS URL (Reply URL)', state.urls.acs) + copyRow('Entity ID (Audience)', state.urls.entityId) + copyRow('Metadata address', state.urls.metadata)
            + '<p style="margin:0">Send the person’s email address as the NameID, or in an attribute named email.</p>';
        } else {
          html += copyRow('Redirect URI', state.urls.redirectUri);
        }
        html += '<details class="sso-more"><summary>A link for your provider’s app list</summary>' + copyRow('Start URL', state.urls.start) + '</details>'
          + '<div class="sso-row"><button type="button" class="sso-btn" data-copy-all>Copy all for our IT team</button></div></div>';

        html += '<div class="sso-card"><h2>3. Copy your provider’s details here</h2>';
        if (c.protocol === 'saml') {
          html += '<p>The metadata address fills in everything for you.</p>'
            + '<div class="sso-row"><label class="sso-field sso-grow"><span>Metadata address</span><input name="metadataUrl" type="url" inputmode="url" autocomplete="off" placeholder="https://" /></label><button type="button" class="sso-btn" data-read-metadata>Read it</button></div>'
            + '<details class="sso-more"' + (manual ? ' open' : '') + '><summary>Paste metadata, or enter the details yourself</summary>'
            + '<label class="sso-field"><span>Metadata</span><textarea name="metadataXml" spellcheck="false" placeholder="<EntityDescriptor ..."></textarea></label><button type="button" class="sso-btn" data-read-xml style="margin-bottom:10px !important">Read it</button>'
            + '<label class="sso-field"><span>Entity ID (Issuer)</span><input name="samlEntityId" autocomplete="off" value="' + esc(c.samlEntityId) + '" /></label>'
            + '<label class="sso-field"><span>Sign-in address (SSO URL)</span><input name="samlSsoUrl" type="url" autocomplete="off" value="' + esc(c.samlSsoUrl) + '" /></label>'
            + '<label class="sso-field"><span>Signing certificate' + (c.hasCertificate ? ' (saved, paste only to replace it)' : '') + '</span><textarea name="samlCertificate" spellcheck="false" placeholder="-----BEGIN CERTIFICATE-----"></textarea></label>'
            + '</details>';
        } else {
          html += '<label class="sso-field"><span>Issuer address</span><input name="oidcIssuer" type="url" autocomplete="off" value="' + esc(c.oidcIssuer) + '" placeholder="https://" /></label>'
            + '<label class="sso-field"><span>Client ID</span><input name="oidcClientId" autocomplete="off" value="' + esc(c.oidcClientId) + '" /></label>'
            + '<label class="sso-field"><span>Client secret' + (c.hasClientSecret ? ' (saved, enter only to replace it)' : '') + '</span><input name="oidcClientSecret" type="password" autocomplete="new-password" /></label>';
        }
        html += '<details class="sso-more"><summary>Advanced</summary><label class="sso-field"><span>Attribute that holds the email, if it isn’t the usual one</span><input name="emailAttribute" autocomplete="off" value="' + esc(c.emailAttribute) + '" /></label></details>'
          + '<div class="sso-row"><button type="button" class="sso-btn sso-btn--go" data-save>Save</button></div><p class="sso-msg" data-msg="save"></p></div>';
        if (folded) html += '</details>';

        html += '<div class="sso-card"><h2>' + (c.status === 'active' ? 'Test or turn off' : '4. Test it, then turn it on') + '</h2>'
          + (c.testedAt ? '<p>Last test worked for ' + esc(c.testedEmail || '') + '.</p>' : '<p>Testing signs in with your provider in a new tab and shows what it sent. It doesn’t change anything.</p>')
          + '<div class="sso-row"><button type="button" class="sso-btn" data-test' + (c.complete ? '' : ' disabled') + '>Test the connection</button></div><p class="sso-msg" data-msg="test"></p>'
          + '<label class="sso-check"><input type="checkbox" data-option="allowStudents"' + (c.allowStudents ? ' checked' : '') + ' /><span>Students sign in this way too<small>For students whose portal email is an account at your provider.</small></span></label>'
          + (c.status === 'active'
            ? '<div class="sso-row"><label class="sso-field sso-grow"><span>Your password, to change or turn off</span><input name="confirmPassword" type="password" autocomplete="current-password" /></label><button type="button" class="sso-btn" data-turn-off>Turn off</button></div>'
            : '<div class="sso-row"><label class="sso-field sso-grow"><span>Your password, to confirm</span><input name="confirmPassword" type="password" autocomplete="current-password" /></label><button type="button" class="sso-btn sso-btn--go" data-turn-on' + (c.status === 'tested' ? '' : ' disabled') + '>Turn on</button></div>')
          + '<p class="sso-msg" data-msg="switch"></p></div>';

        html += '<div class="sso-card"><h2>Recent activity</h2>' + (state.events.length
          ? '<ul class="sso-events">' + state.events.map(function (row) {
            var when = new Date(row.created_at).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
            var what = row.kind === 'setup' ? row.detail : (row.kind === 'test' ? 'Test' : 'Sign-in') + (row.outcome === 'ok' ? '' : ' refused');
            return '<li><span class="' + (row.outcome === 'ok' ? '' : 'is-no') + '">' + esc(what) + (row.email ? ' · ' + esc(row.email) : '') + (row.outcome !== 'ok' && row.detail && row.kind !== 'setup' ? '<small> ' + esc(row.detail) + '</small>' : '') + '</span><small>' + esc(when) + '</small></li>';
          }).join('') + '</ul>'
          : '<p style="margin:0">Nothing yet.</p>')
          + '<div class="sso-row" style="margin-top:12px"><label class="sso-field sso-grow" hidden data-remove-box><span>Your password, to remove this connection</span><input name="removePassword" type="password" autocomplete="current-password" /></label><button type="button" class="sso-btn sso-btn--danger" data-remove>Remove this connection</button></div><p class="sso-msg" data-msg="remove"></p></div>';
      }
      root.innerHTML = html;
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
      return saveWith({ samlEntityId: found.samlEntityId, samlSsoUrl: found.samlSsoUrl, samlCertificates: found.samlCertificates, samlCertificate: undefined }, 'save', 'Read and saved. Now test it.');
    }

    root.addEventListener('click', function (event) {
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
          setTimeout(function () { button.textContent = 'Copy all for our IT team'; }, 1500);
        }).catch(function () { window.prompt('Copy this:', sheet.join(' | ')); });
        return;
      }
      var provider = button.getAttribute('data-provider');
      if (provider) {
        var meta = state.providers.filter(function (p) { return p.key === provider; })[0];
        saveWith({ provider: provider, protocol: meta.protocols[0], displayName: meta.name }, 'provider');
        return;
      }
      var protocol = button.getAttribute('data-protocol');
      if (protocol) { saveWith({ protocol: protocol }, 'provider'); return; }
      if (button.hasAttribute('data-read-metadata') || button.hasAttribute('data-read-xml')) {
        var body = button.hasAttribute('data-read-xml') ? { xml: value('metadataXml') } : { url: value('metadataUrl') };
        button.disabled = true;
        call('/metadata', body).then(useMetadata).catch(function (error) { say('save', error.message); button.disabled = false; });
        return;
      }
      if (button.hasAttribute('data-save')) { saveWith({}, 'save', 'Saved. Now test it.'); return; }
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
        if (!window.confirm('Turn off single sign-on? Everyone signs in with a Managira password; anyone who doesn’t have one sets it with Forgot password.')) return;
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
