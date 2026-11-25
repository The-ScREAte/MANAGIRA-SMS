// The app's own message instead of the browser's alert() box: a small bar at the bottom of the page
// that goes away by itself, on a click or on Escape. A message shown just before the page reloads or
// moves on is shown again on the next page, so it is not lost.
(function () {
  'use strict';
  if (window.__appAlert) return;
  window.__appAlert = true;
  var KEY = 'managira:pending-message';
  var timer = null, shownAt = 0, lastText = '';

  function css() {
    if (document.getElementById('app-alert-css')) return;
    var st = document.createElement('style');
    st.id = 'app-alert-css';
    st.textContent = '.app-alert{position:fixed;left:50%;bottom:max(24px,env(safe-area-inset-bottom,0px));z-index:2147483000;max-width:min(92vw,520px);padding:11px 18px;border-radius:12px;background:#0f172a;color:#fff;font:600 14px/1.4 Inter,system-ui,-apple-system,"Segoe UI",sans-serif;box-shadow:0 10px 30px rgba(15,23,42,.28);cursor:pointer;opacity:0;transform:translate(-50%,8px);transition:opacity .18s ease,transform .18s ease;white-space:pre-line}'
      + '.app-alert.is-open{opacity:1;transform:translate(-50%,0)}.app-alert.is-error{background:#b42318}'
      + '@media (prefers-reduced-motion:reduce){.app-alert{transition:none}}';
    document.head.appendChild(st);
  }

  function hide() {
    var el = document.querySelector('.app-alert');
    if (!el) return;
    clearTimeout(timer);
    el.classList.remove('is-open');
    shownAt = 0;
    setTimeout(function () { if (el.parentNode && !el.classList.contains('is-open')) el.remove(); }, 220);
  }

  function show(message) {
    var text = String(message == null ? '' : message).replace(/^[✅❌⚠️\s]+/, '').trim();
    if (!text) return;
    if (!document.body) { document.addEventListener('DOMContentLoaded', function () { show(text); }); return; }
    css();
    var el = document.querySelector('.app-alert');
    if (!el) {
      el = document.createElement('div');
      el.className = 'app-alert';
      el.addEventListener('click', hide);
      document.body.appendChild(el);
    }
    var bad = /\b(not|could ?n.?t|can.?t|cannot|fail|failed|error|expired|wrong|invalid|unable|try again|no )\b/i.test(text);
    el.setAttribute('role', bad ? 'alert' : 'status');
    el.classList.toggle('is-error', bad);
    el.textContent = text;
    void el.offsetWidth;
    el.classList.add('is-open');
    lastText = text;
    shownAt = Date.now();
    clearTimeout(timer);
    timer = setTimeout(hide, Math.min(9000, 3500 + text.length * 40));
  }

  window.alert = show;
  window.appAlert = show;
  document.addEventListener('keydown', function (e) { if (e.key === 'Escape') hide(); });
  window.addEventListener('pagehide', function () {
    try { if (shownAt && Date.now() - shownAt < 3000) sessionStorage.setItem(KEY, lastText); } catch (e) {}
  });
  try {
    var pending = sessionStorage.getItem(KEY);
    if (pending) { sessionStorage.removeItem(KEY); show(pending); }
  } catch (e) {}
})();

// ---- The app's own confirm: appConfirm('Delete this?', { ok: 'Delete', danger: true }) answers true or false.
// It opens from just under the app header and closes with Cancel or Escape (never by clicking outside).
(function () {
  'use strict';
  if (window.appConfirm) return;
  function css() {
    if (document.getElementById('app-confirm-css')) return;
    var st = document.createElement('style');
    st.id = 'app-confirm-css';
    st.textContent = '.app-confirm{position:fixed;left:0;right:0;bottom:0;z-index:2147483001;display:flex;align-items:center;justify-content:center;padding:16px;background:rgba(15,23,42,.38);font-family:Inter,system-ui,-apple-system,"Segoe UI",sans-serif}'
      + '.app-confirm__card{width:min(100%,400px);padding:22px 22px 18px;border-radius:16px;background:#fff;color:#0f172a;box-shadow:0 24px 60px rgba(15,23,42,.24)}'
      + '.app-confirm__title{margin:0 0 6px;font-size:1.05rem;font-weight:700;line-height:1.3}'
      + '.app-confirm__text{margin:0 0 18px;color:#475569;font-size:.92rem;line-height:1.5;white-space:pre-line}'
      + '.app-confirm__row{display:flex;gap:10px;justify-content:flex-end}'
      + '.app-confirm__btn{height:40px;min-width:92px;margin:0;padding:0 16px;border-radius:10px;font:inherit;font-size:.92rem;font-weight:700;cursor:pointer;box-shadow:none}'
      + '.app-confirm__btn.no{border:1px solid #d1d5db;background:#fff;color:#1f2937}'
      + '.app-confirm__btn.yes{border:0;background:var(--org-primary-color,#0f766e);color:#fff}.app-confirm__btn.yes.danger{background:#b42318}'
      + '.app-confirm__btn:focus-visible{outline:2px solid rgba(15,118,110,.45);outline-offset:2px}';
    document.head.appendChild(st);
  }
  function top() {
    var h = document.getElementById('top-header');
    if (!h) return 0;
    var r = h.getBoundingClientRect();
    return Math.max(0, Math.round(r.bottom));
  }
  window.appConfirm = function (text, opts) {
    opts = opts || {};
    return new Promise(function (resolve) {
      css();
      var parts = String(text == null ? '' : text).replace(/^[\u26A0\uFE0F\s]+/, '').split(/\n\s*\n/);
      var title = opts.title || (parts.length > 1 ? parts.shift() : '');
      var body = parts.join('\n\n');
      var box = document.createElement('div');
      box.className = 'app-confirm';
      box.style.top = top() + 'px';
      box.setAttribute('role', 'alertdialog'); box.setAttribute('aria-modal', 'true');
      var card = document.createElement('div'); card.className = 'app-confirm__card';
      if (title) { var h = document.createElement('h2'); h.className = 'app-confirm__title'; h.textContent = title; card.appendChild(h); box.setAttribute('aria-label', title); }
      var p = document.createElement('p'); p.className = 'app-confirm__text'; p.textContent = body || (title ? '' : String(text)); if (!p.textContent) p.hidden = true; card.appendChild(p);
      var row = document.createElement('div'); row.className = 'app-confirm__row';
      var no = document.createElement('button'); no.type = 'button'; no.className = 'app-confirm__btn no'; no.textContent = opts.cancel || 'Cancel';
      var t = String(text == null ? '' : text);
      var label = opts.ok || (/^(\W*)Post\b/.test(t) ? 'Post' : /^(\W*)Take back/.test(t) ? 'Take back' : /^(\W*)Delete/.test(t) ? 'Delete' : /^(\W*)Remove/.test(t) ? 'Remove' : /^(\W*)Lock/.test(t) ? 'Lock' : /^(\W*)Let /.test(t) ? 'Allow' : /^(\W*)Mark /.test(t) ? 'Mark again' : /^(\W*)(Send|Approve|Reject|Apply|Reverse|Save|Submit|Retry|Restore|Unlock)\b/.exec(t) ? /^(\W*)(\w+)/.exec(t)[2] : 'OK');
      if (opts.danger === undefined) opts.danger = /\b(delete|permanently|cannot be undone|can.t be undone)\b/i.test(t);
      var yes = document.createElement('button'); yes.type = 'button'; yes.className = 'app-confirm__btn yes' + (opts.danger ? ' danger' : ''); yes.textContent = label;
      row.appendChild(no); row.appendChild(yes); card.appendChild(row); box.appendChild(card);
      var before = document.activeElement;
      function done(v) { document.removeEventListener('keydown', onKey, true); box.remove(); try { before && before.focus && before.focus(); } catch (e) {} resolve(v); }
      function onKey(e) {
        if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); done(false); }
        else if (e.key === 'Tab') { var f = [no, yes]; var i = f.indexOf(document.activeElement); e.preventDefault(); f[(i + (e.shiftKey ? -1 : 1) + 2) % 2].focus(); }
      }
      no.addEventListener('click', function () { done(false); });
      yes.addEventListener('click', function () { done(true); });
      document.addEventListener('keydown', onKey, true);
      document.body.appendChild(box);
      (opts.danger ? no : yes).focus();
    });
  };

  // Forms and buttons whose handler is only `return confirm('...')` (data-onsubmit / data-onclick,
  // public/js/mgActions.js keeps the question in __mgAct.C) ask with the app's own dialog.
  function ask(el, attr, event) {
    var id = el.getAttribute(attr);
    var question = window.__mgAct && window.__mgAct.C && window.__mgAct.C[id];
    if (typeof question !== 'function') return false;
    var msg = String(question.call(el));
    var submitter = event.submitter || null; // the clicked submit button keeps its name, value and formaction
    event.preventDefault(); event.stopImmediatePropagation();
    var danger = /delet|remov|permanent|cannot be undone|can.t be undone/i.test(msg);
    window.appConfirm(msg, { ok: danger ? (/delet/i.test(msg) ? 'Delete' : (/remov/i.test(msg) ? 'Remove' : 'Continue')) : 'Continue', danger: danger }).then(function (yes) {
      if (!yes) return;
      el.removeAttribute(attr);
      try { if (attr === 'data-onsubmit') { if (el.requestSubmit) el.requestSubmit(submitter && submitter.form === el ? submitter : undefined); else el.submit(); } else { el.click(); } }
      finally { setTimeout(function () { el.setAttribute(attr, id); }, 0); }
    });
    return true;
  }
  window.addEventListener('submit', function (e) { var f = e.target; if (f && f.getAttribute && f.hasAttribute('data-onsubmit')) ask(f, 'data-onsubmit', e); }, true);
  window.addEventListener('click', function (e) { var b = e.target && e.target.closest && e.target.closest('[data-onclick]'); if (b) ask(b, 'data-onclick', e); }, true);

  // Links, buttons and forms marked data-confirm="..." ask with the app's own dialog.
  function askData(el, event, isSubmit) {
    if (el.__dataConfirmed) { el.__dataConfirmed = false; return; }
    var msg = el.getAttribute('data-confirm');
    if (!msg) return;
    var submitter = event.submitter || null;
    event.preventDefault(); event.stopImmediatePropagation();
    window.appConfirm(msg).then(function (yes) {
      if (!yes) return;
      el.__dataConfirmed = true;
      if (isSubmit) { if (el.requestSubmit) el.requestSubmit(submitter && submitter.form === el ? submitter : undefined); else el.submit(); } else { el.click(); }
    });
  }
  window.addEventListener('click', function (e) { var b = e.target && e.target.closest && e.target.closest('[data-confirm]'); if (b && b.tagName !== 'FORM') askData(b, e, false); }, true);
  window.addEventListener('submit', function (e) { var f = e.target; if (f && f.tagName === 'FORM' && f.hasAttribute && f.hasAttribute('data-confirm')) askData(f, e, true); }, true);
})();
