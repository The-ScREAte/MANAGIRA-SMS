/* Log out asks first. Every Log out link (the header's, the admin menus', a hub's, the setup
 * page's) opens this question before anything happens: nothing loads and nobody is signed out
 * until "Log out" is pressed. Cancel, Escape or a click outside closes it and leaves the person
 * where they were. It catches the click before every other script (the window, in the capture
 * phase), so the page loader never starts on its own. Under the app header, as every pop-up.
 */
(function () {
  'use strict';
  if (window.__managiraLogoutConfirm) return;
  window.__managiraLogoutConfirm = true;

  var SELECTOR = 'a[href="/account/logout"], a[href^="/account/logout?"], a[href="/hub/logout"], a[href="/admin/logout"], a.logout, [data-logout]';
  var overlay = null;
  var pendingHref = '/account/logout';
  var returnFocus = null;

  function styles() {
    if (document.getElementById('mg-logout-styles')) return;
    var style = document.createElement('style');
    style.id = 'mg-logout-styles';
    style.textContent = [
      '.mg-logout{position:fixed;left:0;right:0;bottom:0;top:var(--mg-logout-top,0);z-index:13000;display:flex;align-items:center;justify-content:center;padding:16px;background:rgba(15,23,42,.38);backdrop-filter:blur(3px);-webkit-backdrop-filter:blur(3px);opacity:0;transition:opacity .18s ease;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,"Helvetica Neue",Arial,sans-serif}',
      '.mg-logout.is-in{opacity:1}',
      '.mg-logout-card{width:min(100%,380px);padding:26px 24px 20px;border-radius:20px;background:#fff;color:#0f172a;text-align:center;box-shadow:0 24px 60px rgba(15,23,42,.22),0 2px 6px rgba(15,23,42,.06);transform:translateY(8px) scale(.97);transition:transform .24s cubic-bezier(.2,.8,.2,1)}',
      '.mg-logout.is-in .mg-logout-card{transform:none}',
      '.mg-logout-icon{display:grid;place-items:center;width:52px;height:52px;margin:0 auto 14px;border-radius:16px;background:#fef2f2;color:#dc2626}',
      '.mg-logout-icon svg{width:24px;height:24px}',
      '.mg-logout-card h2{margin:0 0 6px;font-size:1.15rem;font-weight:700;line-height:1.3;color:#0f172a}',
      '.mg-logout-card p{margin:0 0 20px;color:#475569;font-size:.92rem;line-height:1.5}',
      '.mg-logout-actions{display:flex;gap:10px}',
      '.mg-logout .mg-logout-btn{flex:1;width:auto;height:44px;margin:0;padding:0 14px;border-radius:12px;font:inherit;font-size:.95rem;font-weight:700;cursor:pointer;box-shadow:none;text-transform:none;letter-spacing:normal;transition:filter .15s ease,background .15s ease}',
      '.mg-logout .mg-logout-btn.cancel{border:1px solid #d1d5db;background:#fff;color:#1f2937}',
      '.mg-logout .mg-logout-btn.cancel:hover{background:#f9fafb}',
      '.mg-logout .mg-logout-btn.go{border:0;background:#dc2626;color:#fff}',
      '.mg-logout .mg-logout-btn.go:hover{filter:brightness(.94)}',
      '.mg-logout .mg-logout-btn[disabled]{opacity:.75;cursor:wait}',
      '.mg-logout .mg-logout-btn:focus-visible{outline:2px solid rgba(220,38,38,.35);outline-offset:3px}',
      'html[data-appearance="dark"] .mg-logout-card{background:#111827;color:#f9fafb}',
      'html[data-appearance="dark"] .mg-logout-card h2{color:#f9fafb}',
      'html[data-appearance="dark"] .mg-logout-card p{color:#cbd5e1}',
      'html[data-appearance="dark"] .mg-logout .mg-logout-btn.cancel{background:#111827;border-color:#374151;color:#e5e7eb}',
      '@media (prefers-reduced-motion:reduce){.mg-logout,.mg-logout-card{transition:none}}'
    ].join('\n');
    document.head.appendChild(style);
  }

  function build() {
    styles();
    overlay = document.createElement('div');
    overlay.className = 'mg-logout';
    overlay.hidden = true;
    overlay.setAttribute('role', 'alertdialog');
    overlay.setAttribute('aria-modal', 'true');
    overlay.setAttribute('aria-labelledby', 'mgLogoutTitle');
    overlay.setAttribute('aria-describedby', 'mgLogoutText');
    overlay.innerHTML =
      '<div class="mg-logout-card">' +
        '<div class="mg-logout-icon" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none"><path d="M15 4h3a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2h-3" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/><path d="M10 16l-4-4 4-4M6 12h10" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg></div>' +
        '<h2 id="mgLogoutTitle">Log out of Managira?</h2>' +
        '<p id="mgLogoutText">You’ll need to sign in again to get back in. Anything you haven’t saved on this page will be lost.</p>' +
        '<div class="mg-logout-actions">' +
          '<button type="button" class="mg-logout-btn cancel" data-cancel>Cancel</button>' +
          '<button type="button" class="mg-logout-btn go" data-go>Log out</button>' +
        '</div>' +
      '</div>';
    overlay.addEventListener('click', function (event) {
      if (event.target === overlay || event.target.closest('[data-cancel]')) close();
      else if (event.target.closest('[data-go]')) go();
    });
    overlay.addEventListener('keydown', function (event) {
      if (event.key === 'Escape') { event.preventDefault(); close(); return; }
      if (event.key !== 'Tab') return;
      var buttons = overlay.querySelectorAll('button');
      var first = buttons[0];
      var last = buttons[buttons.length - 1];
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    });
    document.body.appendChild(overlay);
  }

  function open(href, link) {
    if (!overlay) build();
    pendingHref = href || '/account/logout';
    returnFocus = link || null;
    // The header's menu (where Log out lives) closes behind the question.
    var hamburger = document.getElementById('header-hamburger');
    if (hamburger && hamburger.classList.contains('active')) hamburger.click();
    var header = document.getElementById('top-header');
    overlay.style.setProperty('--mg-logout-top', (header ? header.offsetHeight : 0) + 'px');
    var goBtn = overlay.querySelector('[data-go]');
    goBtn.disabled = false;
    goBtn.textContent = 'Log out';
    overlay.hidden = false;
    requestAnimationFrame(function () { overlay.classList.add('is-in'); });
    overlay.querySelector('[data-cancel]').focus();
  }

  function close() {
    if (!overlay || overlay.hidden) return;
    overlay.classList.remove('is-in');
    setTimeout(function () { overlay.hidden = true; }, 180);
    if (window.ManagiraLoading && window.ManagiraLoading.isActive && window.ManagiraLoading.isActive()) window.ManagiraLoading.stop();
    if (returnFocus && document.contains(returnFocus) && returnFocus.offsetParent) returnFocus.focus();
  }

  function go() {
    var goBtn = overlay.querySelector('[data-go]');
    goBtn.disabled = true;
    goBtn.textContent = 'Logging out…';
    if (window.ManagiraLoading && window.ManagiraLoading.start) window.ManagiraLoading.start();
    window.location.href = pendingHref;
  }

  // First of all click handlers, so nothing starts loading before the question. A Ctrl/Cmd or
  // middle click asks too (it would sign out in another tab).
  function intercept(event) {
    if (event.type === 'click' && event.button !== 0) return;
    if (event.type === 'auxclick' && event.button !== 1) return;
    var link = event.target && event.target.closest ? event.target.closest(SELECTOR) : null;
    if (!link || (overlay && overlay.contains(link))) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    open(link.getAttribute('href') || link.getAttribute('data-logout') || '/account/logout', link);
  }
  window.addEventListener('click', intercept, true);
  window.addEventListener('auxclick', intercept, true);

  window.ManagiraLogout = { open: open, close: close };
})();
