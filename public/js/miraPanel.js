/* Mira beside the page: the header's Mira button opens a panel on the right, under the app
 * header, so staff work with Mira and the page together. On wide screens the page makes room
 * for it; on phones it covers the page.
 *
 * Every member of staff sees the button. Where the school hasn't turned Mira on, the panel says
 * so, with Turn on Mira (Management Tools › Integrations) for those who can. Someone with their own
 * "Use Mira" gets Mira itself (MIRA_PUBLIC_URL/?embed=panel), whose
 * bar has history, new chat, open in a new tab (the full page, same conversation) and close.
 * Anyone else gets the same panel saying they need access, with Manage Mira access for those
 * who can give it (utils/miraAccess.js); Mira isn't loaded for them. Before saying so, the
 * button asks the server again (/account/mira/access), so a permission given since the page
 * loaded opens Mira at once. Ctrl/Cmd-click opens the full Mira page.
 *
 * The panel stays open while moving between pages (the page-switcher keeps it) and opens
 * again after a full page load (sessionStorage); Mira reopens its last conversation itself.
 * A link to a Managira page in Mira's answer opens here, beside it. If Mira says the sign-in
 * has ended, public/js/sessionWatch.js takes the window to the login page.
 */
(function () {
  'use strict';
  if (window.ManagiraMiraPanel) return;

  var OPEN_KEY = 'managira:mira-panel';
  var READY_WAIT_MS = 15000;
  var root = document.documentElement;
  var narrow = window.matchMedia('(max-width: 760px)');
  var panel = null;
  var frame = null;
  var cover = null;
  var origin = '';
  var ready = false;
  var readyTimer = null;
  var returnFocus = null;

  // What the panel showed before a full page load: '1' Mira, 'no-access' the access message.
  function remember(value) {
    try { if (value) sessionStorage.setItem(OPEN_KEY, value === true ? '1' : value); else sessionStorage.removeItem(OPEN_KEY); } catch (_) {}
  }
  function wasOpen() {
    try { return sessionStorage.getItem(OPEN_KEY) || ''; } catch (_) { return ''; }
  }

  function button() { return document.getElementById('header-mira-btn'); }
  function canUse(btn) { return Boolean(btn && btn.getAttribute('data-mira-can-use') === '1'); }
  // What the button knew when the page was drawn, for when the server can't be asked.
  function knownAccess(btn) {
    return {
      activated: Boolean(btn && btn.getAttribute('data-mira-on') === '1'),
      canManage: Boolean(btn && btn.getAttribute('data-mira-manage')),
      canTurnOn: Boolean(btn && btn.getAttribute('data-mira-turn-on')),
    };
  }
  function fullPageUrl(btn) {
    return String((btn && btn.getAttribute('data-mira-panel')) || '').replace(/\/?\?embed=panel$/, '') || '/';
  }

  // Under the app header, never over it (as every drawer and dialog).
  function placeUnderHeader() {
    if (!panel) return;
    var header = document.getElementById('top-header');
    panel.style.top = (header ? header.offsetHeight : 0) + 'px';
  }

  var ICONS = {
    close: '<svg viewBox="0 0 16 16" fill="none" aria-hidden="true"><path d="M4 4l8 8M12 4l-8 8" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/></svg>',
    lock: '<svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><rect x="4.5" y="10.5" width="15" height="10" rx="2.5" stroke="currentColor" stroke-width="1.7"/><path d="M8 10.5V7.5a4 4 0 0 1 8 0v3" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/><circle cx="12" cy="15.5" r="1.4" fill="currentColor"/></svg>',
    mira: '<img src="/images/icons/miralogo-256.png" alt="" />',
    cloud: '<svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M7 18.5h10a4 4 0 0 0 .6-7.95A5.5 5.5 0 0 0 7 10a4.25 4.25 0 0 0 0 8.5z" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round"/><path d="M12 11.5v3M12 16.8v.2" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/></svg>'
  };

  function build() {
    panel = document.createElement('aside');
    panel.className = 'mira-panel';
    panel.id = 'mira-panel';
    panel.setAttribute('aria-label', 'Mira');
    panel.setAttribute('aria-hidden', 'true');
    // The panel's own bar and message, shown whenever Mira itself isn't (opening, no access,
    // not answering). Mira, once open, shows its own bar.
    panel.innerHTML =
      '<div class="mira-panel-cover" data-cover>' +
        '<div class="mira-panel-bar">' +
          '<span class="mira-panel-name"><img src="/images/icons/miralogo-256.png" alt="" />Mira</span>' +
          '<button type="button" class="mira-panel-x" data-close aria-label="Close Mira" title="Close">' + ICONS.close + '</button>' +
        '</div>' +
        '<div class="mira-panel-body" data-body aria-live="polite"></div>' +
      '</div>';
    cover = panel.querySelector('[data-cover]');
    panel.addEventListener('click', function (event) {
      if (event.target.closest('[data-close]')) close();
      else if (event.target.closest('[data-retry]')) loadMira(true);
      else if (event.target.closest('[data-manage]') && narrow.matches) close();
    });
    panel.addEventListener('keydown', function (event) { if (event.key === 'Escape') close(); });
    document.body.appendChild(panel);
  }

  function ensureFrame(url) {
    if (frame) return;
    try { origin = new URL(url, window.location.href).origin; } catch (_) { origin = ''; }
    frame = document.createElement('iframe');
    frame.className = 'mira-panel-frame';
    frame.title = 'Mira';
    frame.setAttribute('allow', 'microphone; clipboard-write');
    frame.hidden = true;
    frame.setAttribute('data-src', url);
    panel.appendChild(frame);
  }

  // What the panel says when Mira itself isn't showing.
  function show(state, details) {
    var body = cover.querySelector('[data-body]');
    body.textContent = '';
    if (frame) frame.hidden = state !== 'mira';
    cover.hidden = state === 'mira';
    panel.setAttribute('data-state', state);
    if (state === 'mira') return;

    if (state === 'loading') {
      body.innerHTML = '<span class="mira-panel-spinner" aria-hidden="true"></span><p class="mira-panel-text">Opening Mira…</p>';
      return;
    }
    var icon = document.createElement('span');
    icon.className = 'mira-panel-icon';
    var off = state === 'no-access' && details && details.activated === false;
    icon.innerHTML = off ? ICONS.mira : (state === 'no-access' ? ICONS.lock : ICONS.cloud);
    if (off) icon.className += ' is-mira';
    var title = document.createElement('p');
    title.className = 'mira-panel-title';
    var text = document.createElement('p');
    text.className = 'mira-panel-text';
    var actions = document.createElement('div');
    actions.className = 'mira-panel-actions';
    body.appendChild(icon);
    body.appendChild(title);
    body.appendChild(text);
    body.appendChild(actions);

    if (off) {
      // The school hasn't turned Mira on. Turn on Mira only for someone who can do it there: Mira
      // Settings and Management › Integrations (utils/miraAccess.js canTurnOn); others ask.
      // Named, so nobody mistakes one school's Mira for another's.
      var schoolName = (button() && button().getAttribute('data-mira-school')) || 'your school';
      title.textContent = 'Mira isn’t turned on for ' + schoolName;
      if (details.canTurnOn) {
        text.textContent = 'Mira is your school’s AI assistant. It finds records, drafts messages and plans the week, using each person’s own permissions. Turn it on in Integrations, then choose who can use it.';
        var turnOn = document.createElement('a');
        turnOn.className = 'mira-panel-btn';
        // Integrations inside Management (a hub panel link: the page-switcher stays out).
        turnOn.href = '/common/management?panel=integrations&page=' + encodeURIComponent('/account/integrations') + '&label=Integrations';
        turnOn.setAttribute('data-no-spa', '');
        turnOn.setAttribute('data-manage', '');
        turnOn.textContent = 'Turn on Mira';
        actions.appendChild(turnOn);
      } else {
        text.textContent = 'Mira is your school’s AI assistant. Ask your school’s manager to turn it on.';
      }
      return;
    }
    if (state === 'no-access') {
      title.textContent = 'You don’t have access to Mira yet';
      if (details && details.canManage) {
        text.textContent = 'Mira works with each person’s own permissions. Turn on Use Mira for yourself, or for anyone on your staff, on the Mira page.';
        var manage = document.createElement('a');
        manage.className = 'mira-panel-btn';
        // The Mira page inside Management (a hub panel link: the page-switcher stays out).
        manage.href = '/common/management?panel=mira&page=' + encodeURIComponent('/account/mira') + '&label=Mira';
        manage.setAttribute('data-no-spa', '');
        manage.setAttribute('data-manage', '');
        manage.textContent = 'Manage Mira access';
        actions.appendChild(manage);
      } else {
        text.textContent = 'Mira works with each person’s own permissions. Ask your school’s manager to turn on Use Mira for you.';
      }
      return;
    }
    // 'trouble': Mira didn't answer.
    title.textContent = 'Mira isn’t answering right now';
    text.textContent = 'Try again in a moment, or open Mira in a new tab.';
    var retry = document.createElement('button');
    retry.type = 'button';
    retry.className = 'mira-panel-btn';
    retry.setAttribute('data-retry', '');
    retry.textContent = 'Try again';
    var tab = document.createElement('a');
    tab.className = 'mira-panel-btn quiet';
    tab.target = '_blank';
    tab.rel = 'noopener';
    tab.href = fullPageUrl(button());
    tab.textContent = 'Open in a new tab';
    actions.appendChild(retry);
    actions.appendChild(tab);
  }

  function loadMira(again) {
    ready = false;
    show('loading');
    clearTimeout(readyTimer);
    readyTimer = setTimeout(function () { if (!ready) show('trouble'); }, READY_WAIT_MS);
    if (again || !frame.getAttribute('src')) frame.setAttribute('src', frame.getAttribute('data-src'));
  }

  function slideIn(instant) {
    placeUnderHeader();
    if (instant) {
      panel.classList.add('no-motion');
      root.classList.add('mira-panel-no-motion');
      requestAnimationFrame(function () { requestAnimationFrame(function () {
        panel.classList.remove('no-motion');
        root.classList.remove('mira-panel-no-motion');
      }); });
    }
    root.classList.add('mira-panel-open');
    panel.classList.add('is-open');
    panel.setAttribute('aria-hidden', 'false');
    var btn = button();
    if (btn) { btn.setAttribute('aria-expanded', 'true'); btn.classList.add('is-active'); }
  }

  function focusMira() {
    if (!ready || !frame || frame.hidden) return;
    frame.focus();
    frame.contentWindow.postMessage({ type: 'mira:focus' }, origin || '*');
  }

  // Mira itself, for someone who may use it.
  function openMira(options) {
    var btn = button();
    if (!btn) return;
    if (!panel) build();
    ensureFrame(btn.getAttribute('data-mira-panel'));
    if (!frame.getAttribute('src')) loadMira(false);
    else show(ready ? 'mira' : 'loading');
    slideIn(options && options.instant);
    remember(true);
    if (!(options && options.instant)) focusMira();
  }

  // Someone without "Use Mira": the panel says so, and Mira isn't loaded. It stays open
  // beside the Mira page when they go there to give themselves access.
  function openNoAccess(details, options) {
    if (!panel) build();
    show('no-access', details);
    slideIn(options && options.instant);
    remember('no-access');
    if (options && options.instant) return;
    var first = panel.querySelector('[data-manage]') || panel.querySelector('[data-close]');
    if (first) first.focus();
  }

  function close() {
    if (!panel) return;
    root.classList.remove('mira-panel-open');
    panel.classList.remove('is-open');
    panel.setAttribute('aria-hidden', 'true');
    var btn = button();
    if (btn) { btn.setAttribute('aria-expanded', 'false'); btn.classList.remove('is-active'); }
    remember(false);
    if (returnFocus && document.contains(returnFocus)) returnFocus.focus();
  }

  function isOpen() { return Boolean(panel && panel.classList.contains('is-open')); }

  // The button says whether this person may use Mira; when it says no, the server is asked
  // again first, so access given since the page loaded works straight away.
  function toggle() {
    if (isOpen()) { close(); return; }
    var btn = button();
    if (canUse(btn)) { openMira(); return; }
    var fallback = knownAccess(btn);
    fetch('/account/mira/access', { credentials: 'same-origin', headers: { Accept: 'application/json' }, cache: 'no-store' })
      .then(function (res) { return res.ok ? res.json() : null; })
      .catch(function () { return null; })
      .then(function (access) {
        if (access && access.canUse) {
          btn.setAttribute('data-mira-can-use', '1');
          btn.href = fullPageUrl(btn);
          btn.target = '_blank';
          openMira();
          return;
        }
        openNoAccess(access || fallback);
      });
  }

  // A Managira page from Mira's answer: through the page-switcher, as any link would.
  function go(path) {
    if (typeof path !== 'string' || path.charAt(0) !== '/' || path.charAt(1) === '/') return;
    var link = document.createElement('a');
    link.href = path;
    link.hidden = true;
    document.body.appendChild(link);
    link.click();
    link.remove();
    // Covering the whole page on a phone: step aside so the page shows.
    if (narrow.matches) close();
  }

  window.addEventListener('message', function (event) {
    if (!frame || event.source !== frame.contentWindow) return;
    if (origin && event.origin !== origin) return;
    var data = event.data || {};
    if (data.type === 'mira:ready') {
      ready = true;
      clearTimeout(readyTimer);
      show('mira');
      if (isOpen()) focusMira();
    } else if (data.type === 'mira:close') {
      close();
    } else if (data.type === 'mira:navigate') {
      go(data.path);
    } else if (data.type === 'mira:notice') {
      // Mira refused (access taken away since): the panel's own message, and Mira unloaded.
      ready = false;
      clearTimeout(readyTimer);
      var btn = button();
      if (btn) btn.setAttribute('data-mira-can-use', '0');
      frame.removeAttribute('src');
      show('no-access', knownAccess(btn));
      remember('no-access');
    } else if (data.type === 'mira:signed-out') {
      clearTimeout(readyTimer);
      if (window.ManagiraSession && window.ManagiraSession.check) window.ManagiraSession.check();
    } else if (data.type === 'mira:unavailable') {
      clearTimeout(readyTimer);
      show('trouble');
    }
  });

  // The header button: a plain click opens or closes the panel; Ctrl/Cmd/Shift or a middle
  // click keeps the link's own behaviour (the full Mira page in a new tab, for those with access).
  document.addEventListener('click', function (event) {
    var btn = event.target.closest && event.target.closest('#header-mira-btn');
    if (!btn || !btn.getAttribute('data-mira-panel')) return;
    if (canUse(btn) && (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey || event.button !== 0)) return;
    event.preventDefault();
    returnFocus = btn;
    toggle();
  });

  window.addEventListener('resize', placeUnderHeader);

  // Use Mira changed (the Mira page saved, or back on this tab): the header button follows, and
  // a panel open on "no access" opens Mira once this person has it.
  var checking = false;
  function recheck() {
    var btn = button();
    if (!btn || checking) return;
    checking = true;
    fetch('/account/mira/access', { credentials: 'same-origin', headers: { Accept: 'application/json' }, cache: 'no-store' })
      .then(function (res) { return res.ok ? res.json() : null; })
      .catch(function () { return null; })
      .then(function (access) {
        checking = false;
        if (!access) return;
        btn.setAttribute('data-mira-can-use', access.canUse ? '1' : '0');
        btn.setAttribute('data-mira-on', access.activated ? '1' : '0');
        if (access.canManage) btn.setAttribute('data-mira-manage', '1'); else btn.removeAttribute('data-mira-manage');
        if (access.canTurnOn) btn.setAttribute('data-mira-turn-on', '1'); else btn.removeAttribute('data-mira-turn-on');
        if (access.canUse) { btn.href = fullPageUrl(btn); btn.target = '_blank'; }
        else { btn.setAttribute('href', '#'); btn.removeAttribute('target'); }
        if (isOpen() && panel.getAttribute('data-state') === 'no-access') {
          if (access.canUse) openMira();
          else show('no-access', access);
        }
      });
  }
  window.addEventListener('managira:mira-access-changed', recheck);
  window.addEventListener('focus', function () {
    if (isOpen() && panel.getAttribute('data-state') === 'no-access') recheck();
  });

  window.ManagiraMiraPanel = { open: toggle, close: close, isOpen: isOpen };

  // Open before a full page load: open again, without the slide.
  function restore() {
    var btn = button();
    var was = wasOpen();
    if (!btn || !was || !btn.getAttribute('data-mira-panel')) return;
    returnFocus = btn;
    if (canUse(btn)) openMira({ instant: true });
    else openNoAccess(knownAccess(btn), { instant: true });
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', restore);
  else restore();
})();
