// The notification bell in the header. Moved out of the page so browsers keep it between pages.
(function () {
  'use strict';

  // Roles that can access /common/failedEmails — used to gate email-failure notification links
  const _EMAIL_ISSUE_ROLES = new Set(['organization','admin','mini admin','supervisor','superviser','manager']);
  const _CURRENT_ROLE = String(window.__mgHeader.role || '').toLowerCase().replace(/[^a-z ]/g, '');
  const TYPE_META = {
    guardian_report_new:        { bg: '#fef3c7', stroke: '#d97706', nav: 'feedback' },
    guardian_reply:             { bg: '#fef3c7', stroke: '#d97706', nav: 'feedback' },
    staff_reply:                { bg: '#eff6ff', stroke: '#2563eb', nav: 'feedback' },
    staff_report_filed:         { bg: '#eff6ff', stroke: '#2563eb', nav: 'feedback' },
    assessment_created:         { bg: '#f0fdf4', stroke: '#16a34a', nav: 'grading' },
    assessment_modified:        { bg: '#f0fdf4', stroke: '#16a34a', nav: 'grading' },
    assessment_locked:          { bg: '#fef2f2', stroke: '#dc2626', nav: 'lock' },
    assessment_unlocked:        { bg: '#f0fdf4', stroke: '#16a34a', nav: 'unlock' },
    absence_alert:              { bg: '#fef2f2', stroke: '#dc2626', nav: 'alert' },
    email_delivery_failed:      { bg: '#fef3c7', stroke: '#d97706', nav: 'emailIssues' },
    document_shared_user:       { bg: '#eff6ff', stroke: '#2563eb', nav: 'docs' },
    document_shared_class:      { bg: '#eff6ff', stroke: '#2563eb', nav: 'docs' },
    document_permission_changed:{ bg: '#fef3c7', stroke: '#d97706', nav: 'docs' },
    document_deleted:           { bg: '#fef2f2', stroke: '#dc2626', nav: 'trash' },
    employee_on_hold:           { bg: '#fef2f2', stroke: '#dc2626', nav: 'userLock' },
    employee_resumed:           { bg: '#f0fdf4', stroke: '#16a34a', nav: 'profile' },
    class_reassigned:           { bg: '#eff6ff', stroke: '#2563eb', nav: 'students' },
    admission_pending:          { bg: '#fef3c7', stroke: '#d97706', nav: 'addStudent' },
    admission_approved:         { bg: '#f0fdf4', stroke: '#16a34a', nav: 'check' },
    admission_rejected:         { bg: '#fef2f2', stroke: '#dc2626', nav: 'x' },
    event_created:              { bg: '#f5f3ff', stroke: '#7c3aed', nav: 'calendar' },
    announcement_created:       { bg: '#f5f3ff', stroke: '#7c3aed', nav: 'announcements' },
    birthday_student:           { bg: '#fff7ed', stroke: '#ea580c', nav: 'birthdays' },
    birthday_staff:             { bg: '#fdf2f8', stroke: '#db2777', nav: 'birthdays' },
    birthday_guardian:          { bg: '#eef2ff', stroke: '#4f46e5', nav: 'birthdays' },
    term_changed:               { bg: 'color-mix(in srgb, var(--org-primary-color, #01535b) 12%, #ffffff)', stroke: 'var(--org-primary-color, #01535b)', nav: 'history' },
    task_assigned:              { bg: '#e0f2fe', stroke: '#0369a1', nav: 'task' },
    task_done:                  { bg: '#f0fdf4', stroke: '#16a34a', nav: 'checkCircle' },
    task_reply:                 { bg: '#eff6ff', stroke: '#2563eb', nav: 'feedback' },
    event_tagged:               { bg: '#f5f3ff', stroke: '#7c3aed', nav: 'calendar' },
    enrollment_added:           { bg: '#f0fdf4', stroke: '#16a34a', nav: 'addStudent' },
  };
  const DEFAULT_META = {
    bg: 'color-mix(in srgb, var(--org-primary-color, #01535b) 10%, #f8fafc)',
    stroke: 'var(--org-primary-color, #01535b)',
    nav: 'alert'
  };

  function getMeta(type) { return TYPE_META[type] || DEFAULT_META; }

  function iconSvg(type) {
    const m = getMeta(type);
    return window.ManagiraNavIcon(m.nav).replace('<svg ', `<svg style="color:${m.stroke}" `);
  }

  function timeAgo(dateStr) {
    const diff = Math.floor((Date.now() - new Date(dateStr).getTime()) / 1000);
    if (diff < 60)   return 'Just now';
    if (diff < 3600) return Math.floor(diff / 60) + 'm ago';
    if (diff < 86400) return Math.floor(diff / 3600) + 'h ago';
    if (diff < 604800) return Math.floor(diff / 86400) + 'd ago';
    return new Date(dateStr).toLocaleDateString();
  }

  function escapeHtml(s) {
    return String(s || '')
      .replace(/&/g,'&amp;').replace(/</g,'&lt;')
      .replace(/>/g,'&gt;').replace(/"/g,'&quot;');
  }

  // ── Elements ─────────────────────────────────────────────────────────────
  // The SPA router swaps the whole header on navigation, so always look the
  // elements up fresh and re-bind the new markup (see window.initNotifBell).
  if (!document.getElementById('notif-bell-wrapper')) return; // Not logged in / not on authenticated page
  const $ = (id) => document.getElementById(id);
  const isOpen = () => { const p = $('notif-panel'); return !!(p && p.classList.contains('notif-panel--open')); };

  function updateBadge(count) {
    const badge = $('notif-badge');
    if (!badge) return;
    if (count > 0) {
      badge.textContent = count > 99 ? '99+' : String(count);
      badge.classList.remove('notif-badge--hidden');
    } else {
      badge.textContent = '';
      badge.classList.add('notif-badge--hidden');
    }
  }

  function renderList(items) {
    const list = $('notif-list');
    if (!list) return;
    if (!items || items.length === 0) {
      list.innerHTML = '<div class="notif-empty">No notifications yet</div>';
      return;
    }
    list.innerHTML = items.map(n => {
      const m = getMeta(n.type);
      const isRead = n.is_read === true || n.is_read === 't' || n.is_read === 'true';
      const cls = isRead ? 'notif-item notif-item--read' : 'notif-item notif-item--unread';
      // For email-delivery-failed, always use /common/failedEmails if the user has access
      // (covers old notifications that were stored without a link).
      // For all other types, use whatever link is on the notification.
      const href = (n.type === 'email_delivery_failed')
        ? (_EMAIL_ISSUE_ROLES.has(_CURRENT_ROLE) ? '/common/failedEmails' : '')
        : (n.link || '');
      const hrefAttr = href ? `href="${escapeHtml(href)}"` : 'role="button"';
      // data-no-spa: the SPA router must not swallow these clicks — the handler
      // below marks the item read (or dismisses it) and then navigates itself.
      return `
        <a class="${cls}" ${hrefAttr} data-no-spa data-notif-id="${n.id}" data-link="${escapeHtml(href)}"${href ? '' : ' style="cursor:default;"'}>
          <span class="notif-icon" style="background:${m.bg};">${iconSvg(n.type)}</span>
          <span class="notif-content">
            <span class="notif-title">${escapeHtml(n.title)}</span>
            ${n.body ? `<span class="notif-body">${escapeHtml(n.body)}</span>` : ''}
            <span class="notif-time">${timeAgo(n.created_at)}</span>
          </span>
          ${!isRead ? '<span class="notif-unread-dot" aria-hidden="true"></span>' : ''}
          <button class="notif-dismiss-btn" data-dismiss-id="${n.id}" title="Dismiss" aria-label="Dismiss notification" type="button">&times;</button>
        </a>`;
    }).join('');
  }

  async function loadFeed() {
    const list = $('notif-list');
    if (!list) return;
    list.innerHTML = '<div class="notif-loading">Loading…</div>';
    try {
      const r = await fetch('/notifications/feed', { credentials: 'same-origin', cache: 'no-store' });
      if (!r.ok) throw new Error('HTTP ' + r.status);
      const data = await r.json();
      renderList(data.notifications || []);
    } catch {
      const current = $('notif-list');
      if (current) current.innerHTML = '<div class="notif-empty">Could not load notifications</div>';
    }
  }

  async function refreshCount() {
    if (!$('notif-bell-wrapper')) return;
    try {
      const r = await fetch('/notifications/count', { credentials: 'same-origin', cache: 'no-store' });
      if (!r.ok) return;
      const data = await r.json();
      updateBadge(data.count || 0);
    } catch { /* silent */ }
  }

  function openPanel() {
    const panel = $('notif-panel');
    if (!panel) return;
    panel.classList.add('notif-panel--open');
    const btn = $('notif-bell-btn');
    if (btn) btn.setAttribute('aria-expanded', 'true');
    loadFeed();
  }

  function closePanel() {
    const panel = $('notif-panel');
    if (panel) panel.classList.remove('notif-panel--open');
    const btn = $('notif-bell-btn');
    if (btn) btn.setAttribute('aria-expanded', 'false');
  }

  function removeItem(item) {
    item.style.transition = 'opacity 0.2s';
    item.style.opacity = '0';
    setTimeout(() => {
      const list = item.parentElement;
      item.remove();
      if (list && !list.querySelector('.notif-item')) {
        list.innerHTML = '<div class="notif-empty">No notifications yet</div>';
      }
    }, 200);
  }

  function onListClick(e) {
    // Dismiss button
    const dismissBtn = e.target.closest('.notif-dismiss-btn');
    if (dismissBtn) {
      e.preventDefault();
      e.stopPropagation();
      const item = dismissBtn.closest('.notif-item');
      if (item) removeItem(item);
      fetch('/notifications/dismiss', {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ notifId: dismissBtn.dataset.dismissId }),
      }).then(() => refreshCount()).catch(() => {});
      return;
    }

    const item = e.target.closest('.notif-item[data-notif-id]');
    if (!item) return;
    e.preventDefault();
    const link = item.dataset.link;

    // Optimistically mark as read in UI
    item.classList.remove('notif-item--unread');
    item.classList.add('notif-item--read');
    const dot = item.querySelector('.notif-unread-dot');
    if (dot) dot.remove();

    const marked = fetch('/notifications/mark-read', {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ notifId: item.dataset.notifId }),
      keepalive: true,
    }).then(() => refreshCount()).catch(() => {});

    if (link && link !== '#') {
      closePanel();
      if (window.spaRouter && window.spaRouter.shouldHandleRoute && window.spaRouter.shouldHandleRoute(link)) {
        window.spaRouter.navigate(link);
      } else {
        // Full page load: give mark-read a moment to leave first.
        Promise.race([marked, new Promise((r) => setTimeout(r, 400))]).then(() => { window.location.href = link; });
      }
    }
  }

  async function onMarkAll() {
    try {
      await fetch('/notifications/mark-all-read', { method: 'POST', credentials: 'same-origin' });
      updateBadge(0);
      const list = $('notif-list');
      if (!list) return;
      list.querySelectorAll('.notif-item--unread').forEach(el => {
        el.classList.remove('notif-item--unread');
        el.classList.add('notif-item--read');
        const dot = el.querySelector('.notif-unread-dot');
        if (dot) dot.remove();
      });
    } catch { /* silent */ }
  }

  async function onClearAll() {
    const list = $('notif-list');
    if (list) {
      list.querySelectorAll('.notif-item').forEach(el => { el.style.transition = 'opacity 0.2s'; el.style.opacity = '0'; });
      setTimeout(() => {
        const current = $('notif-list');
        if (current) current.innerHTML = '<div class="notif-empty">No notifications yet</div>';
      }, 220);
    }
    try {
      await fetch('/notifications/dismiss-all', { method: 'POST', credentials: 'same-origin' });
      updateBadge(0);
    } catch { /* silent */ }
  }

  // Bind the current header's bell (safe to call repeatedly).
  function initNotifBell() {
    const wrapper = $('notif-bell-wrapper');
    if (!wrapper || wrapper.dataset.notifBound === '1') return;
    wrapper.dataset.notifBound = '1';
    const btn = $('notif-bell-btn');
    if (btn) {
      btn.setAttribute('aria-expanded', 'false');
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        if (isOpen()) closePanel(); else openPanel();
      });
    }
    const list = $('notif-list');
    if (list) list.addEventListener('click', onListClick);
    const markAllBtn = $('notif-mark-all-btn');
    if (markAllBtn) markAllBtn.addEventListener('click', onMarkAll);
    const clearAllBtn = $('notif-clear-all-btn');
    if (clearAllBtn) clearAllBtn.addEventListener('click', onClearAll);
  }
  window.initNotifBell = initNotifBell;
  initNotifBell();

  // Page-wide listeners: register once, even if this script runs again.
  if (!window.__notifBellGlobalsBound) {
    window.__notifBellGlobalsBound = true;
    document.addEventListener('click', (e) => {
      const wrapper = $('notif-bell-wrapper');
      if (isOpen() && wrapper && !wrapper.contains(e.target)) closePanel();
    });
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && isOpen()) closePanel();
    });
    // Poll for new notifications every 60 s while page is active
    setInterval(refreshCount, 60000);
    // After SPA navigation the header is new: re-bind it and refresh the count.
    window.addEventListener('spa:pageLoaded', () => { initNotifBell(); refreshCount(); });
  }

  // Fetch count immediately on page load so the badge never waits for the
  // 60-second poll interval. The server-side render may be stale (cached) or
  // zero; this corrects it within ~100 ms without blocking page load.
  refreshCount();

  // Celebration and welcome popups (a new term, finishing the first-time setup, a student's
  // birthday): one light card, a short confetti burst in the school's colours, still for anyone
  // who asks their device for less motion. Under the app header, as every pop-up.
  // The shared confetti, loaded the first time a celebration needs it (same version as this file).
  const ownQuery = (() => { try { return (document.currentScript && new URL(document.currentScript.src).search) || ''; } catch (_) { return ''; } })();
  let confettiLoading = null;
  const loadConfetti = () => {
    if (window.ManagiraConfetti) return Promise.resolve(window.ManagiraConfetti);
    if (!confettiLoading) {
      confettiLoading = new Promise((resolve) => {
        const script = document.createElement('script');
        script.src = `/js/confetti.js${ownQuery}`;
        script.onload = () => resolve(window.ManagiraConfetti || null);
        script.onerror = () => resolve(null);
        document.head.appendChild(script);
      });
    }
    return confettiLoading;
  };

  const ensureHeaderPopupStyles = () => {
    if (document.getElementById('header-popup-styles')) return;
    const style = document.createElement('style');
    style.id = 'header-popup-styles';
    style.textContent = `
      .mg-pop { position: fixed; inset: 0; z-index: 12050; display: flex; align-items: center; justify-content: center; padding: 16px; background: rgba(15, 23, 42, 0.38); backdrop-filter: blur(3px); -webkit-backdrop-filter: blur(3px); opacity: 0; transition: opacity .22s ease; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif; }
      .mg-pop.is-in { opacity: 1; }
      .mg-pop-card { position: relative; z-index: 1; width: min(100%, 400px); padding: 30px 28px 24px; border-radius: 22px; background: #fff; color: #0f172a; text-align: center; box-shadow: 0 24px 60px rgba(15, 23, 42, 0.22), 0 2px 6px rgba(15, 23, 42, 0.06); transform: translateY(10px) scale(.97); transition: transform .32s cubic-bezier(.2,.8,.2,1); }
      .mg-pop.is-in .mg-pop-card { transform: none; }
      .mg-pop-badge { display: grid; place-items: center; width: 64px; height: 64px; margin: 0 auto 16px; border-radius: 20px; background: color-mix(in srgb, var(--pop-brand, #01535b) 14%, #fff); color: var(--pop-brand, #01535b); }
      .mg-pop-badge svg { width: 30px; height: 30px; }
      .mg-pop-card h3 { margin: 0 0 8px; font-size: 1.3rem; font-weight: 700; letter-spacing: -0.01em; line-height: 1.3; color: #0f172a; }
      .mg-pop-card p { margin: 0 0 22px; color: #475569; font-size: .95rem; line-height: 1.55; }
      .mg-pop-card button.mg-pop-ok { display: block; width: 100%; height: 46px; margin: 0; padding: 0 18px; border: 0; border-radius: 12px; background: var(--pop-brand, #01535b); color: #fff; font: inherit; font-size: 1rem; font-weight: 700; cursor: pointer; box-shadow: none; transition: filter .15s ease; }
      .mg-pop-card button.mg-pop-ok:hover { filter: brightness(.93); }
      .mg-pop-card button.mg-pop-ok:focus-visible { outline: 2px solid color-mix(in srgb, var(--pop-brand, #01535b) 35%, transparent); outline-offset: 3px; }
      html[data-appearance="dark"] .mg-pop-card { background: #111827; color: #f9fafb; }
      html[data-appearance="dark"] .mg-pop-card h3 { color: #f9fafb; }
      html[data-appearance="dark"] .mg-pop-card p { color: #cbd5e1; }
      html[data-appearance="dark"] .mg-pop-badge { background: #1f2937; }
      @media (prefers-reduced-motion: reduce) { .mg-pop, .mg-pop-card { transition: none; } }
    `;
    document.head.appendChild(style);
  };

  const POPUP_ICONS = {
    setup: '<svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M5 12.5l4.5 4.5L19 7.5" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/></svg>',
    term: '<svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><rect x="3.5" y="5" width="17" height="15" rx="3" stroke="currentColor" stroke-width="1.8"/><path d="M3.5 10h17M8 3v4M16 3v4" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/><path d="M12 12.6l.9 1.8 2 .3-1.45 1.4.35 2-1.8-.95-1.8.95.35-2-1.45-1.4 2-.3z" fill="currentColor"/></svg>',
    birthday: '<svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M4 20h16M5 20v-6a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2v6" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/><path d="M5 16c1.2 1 2.3 1 3.5 0s2.3-1 3.5 0 2.3 1 3.5 0 2.3-1 3.5 0" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/><path d="M12 12V8.5M12 5.2c.8.8.8 1.8 0 2.3-.8-.5-.8-1.5 0-2.3z" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  };

  const showHeaderInfoPopup = ({ overlayId, title, message, buttonLabel, celebratory = false, kind = 'term' }) => {
    const existing = document.getElementById(overlayId);
    if (existing) existing.remove();
    ensureHeaderPopupStyles();

    const overlay = document.createElement('div');
    overlay.id = overlayId;
    overlay.className = 'mg-pop';
    overlay.setAttribute('role', 'dialog');
    overlay.setAttribute('aria-modal', 'true');
    overlay.setAttribute('aria-labelledby', `${overlayId}-title`);

    const reduceMotion = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    // The school's colour, read where the app sets it (the header's buttons use it).
    const headerEl = document.getElementById('top-header') || document.body;
    const brand = getComputedStyle(headerEl).getPropertyValue('--org-primary-color').trim()
      || getComputedStyle(document.documentElement).getPropertyValue('--org-primary-color').trim() || '#01535b';
    overlay.style.setProperty('--pop-brand', brand);
    if (celebratory && !reduceMotion) {
      // The shared confetti (public/js/confetti.js), in the school's colour, once the card is in.
      loadConfetti().then((confetti) => { if (confetti && overlay.isConnected) setTimeout(() => confetti.celebrate({ colors: [brand], container: overlay }), 120); });
    }

    const card = document.createElement('div');
    card.className = 'mg-pop-card';
    card.innerHTML = `
      <div class="mg-pop-badge">${POPUP_ICONS[kind] || POPUP_ICONS.term}</div>
      <h3 id="${overlayId}-title">${escapeHtml(title || 'Notice')}</h3>
      <p>${escapeHtml(message || '')}</p>
      <button type="button" class="mg-pop-ok" data-popup-ok="1">${escapeHtml(buttonLabel || 'Okay')}</button>
    `;
    overlay.appendChild(card);
    document.body.appendChild(overlay);
    requestAnimationFrame(() => overlay.classList.add('is-in'));

    const close = () => {
      document.removeEventListener('keydown', onKey);
      overlay.classList.remove('is-in');
      setTimeout(() => overlay.remove(), reduceMotion ? 0 : 220);
    };
    const onKey = (event) => { if (event.key === 'Escape') close(); };
    document.addEventListener('keydown', onKey);
    overlay.addEventListener('click', (event) => {
      if (event.target === overlay) close();
    });
    const okBtn = card.querySelector('[data-popup-ok="1"]');
    if (okBtn) {
      okBtn.addEventListener('click', close);
      setTimeout(() => okBtn.focus(), 60);
    }
  };

  // Student-only birthday popup (simple modal via AJAX)
  const _isStudentSession = String(window.__mgHeader.role || '').toLowerCase() === 'student';
  if (_isStudentSession) {
    fetch('/notifications/student-birthday-popup', { credentials: 'same-origin' })
      .then((response) => response.ok ? response.json() : null)
      .then((payload) => {
        if (payload && payload.success && payload.shouldShow) {
          showHeaderInfoPopup({
            overlayId: 'student-birthday-popup-overlay',
            title: payload.title,
            message: payload.message,
            buttonLabel: 'Thank you',
            celebratory: true,
            kind: 'birthday',
          });
        }
      })
      .catch(() => {});
  }

  const _staffRole = String(window.__mgHeader.staffRole || '').toLowerCase();
  if (_staffRole.includes('manager') || _staffRole.includes('supervisor') || _staffRole === 'organization') {
    fetch('/notifications/new-term-popup', { credentials: 'same-origin' })
      .then((response) => response.ok ? response.json() : null)
      .then((payload) => {
        if (payload && payload.success && payload.shouldShow) {
          showHeaderInfoPopup({
            overlayId: 'staff-new-term-popup-overlay',
            title: payload.title,
            message: payload.message,
            buttonLabel: payload.kind === 'setup' ? 'Let\u2019s go' : 'Thanks',
            celebratory: true,
            kind: payload.kind === 'setup' ? 'setup' : 'term',
          });
        }
      })
      .catch(() => {});
  }
})();
