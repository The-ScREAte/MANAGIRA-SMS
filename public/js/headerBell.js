// The notification bell in the header. Moved out of the page so browsers keep it between pages.
(function () {
  'use strict';

  // Roles that can access /common/failedEmails — used to gate email-failure notification links
  const _EMAIL_ISSUE_ROLES = new Set(['organization','admin','mini admin','supervisor','superviser','manager']);
  const _CURRENT_ROLE = String(window.__mgHeader.role || '').toLowerCase().replace(/[^a-z ]/g, '');
  const TYPE_META = {
    guardian_report_new:        { bg: '#fef3c7', stroke: '#d97706', icon: '<path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>' },
    guardian_reply:             { bg: '#fef3c7', stroke: '#d97706', icon: '<path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>' },
    staff_reply:                { bg: '#eff6ff', stroke: '#2563eb', icon: '<path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>' },
    staff_report_filed:         { bg: '#eff6ff', stroke: '#2563eb', icon: '<path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>' },
    assessment_created:         { bg: '#f0fdf4', stroke: '#16a34a', icon: '<path d="M9 5H7a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V7a2 2 0 0 0-2-2h-2"/><rect x="9" y="3" width="6" height="4" rx="1" ry="1"/><path d="M9 12h6"/><path d="M9 16h4"/>' },
    assessment_modified:        { bg: '#f0fdf4', stroke: '#16a34a', icon: '<path d="M9 5H7a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V7a2 2 0 0 0-2-2h-2"/><rect x="9" y="3" width="6" height="4" rx="1" ry="1"/><path d="M9 12h6"/><path d="M9 16h4"/>' },
    assessment_locked:          { bg: '#fef2f2', stroke: '#dc2626', icon: '<rect x="3" y="11" width="18" height="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/>' },
    assessment_unlocked:        { bg: '#f0fdf4', stroke: '#16a34a', icon: '<rect x="3" y="11" width="18" height="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 9.9-1"/>' },
    absence_alert:              { bg: '#fef2f2', stroke: '#dc2626', icon: '<circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/>' },
    email_delivery_failed:      { bg: '#fef3c7', stroke: '#d97706', icon: '<path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/>' },
    document_shared_user:       { bg: '#eff6ff', stroke: '#2563eb', icon: '<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/>' },
    document_shared_class:      { bg: '#eff6ff', stroke: '#2563eb', icon: '<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/>' },
    document_permission_changed:{ bg: '#fef3c7', stroke: '#d97706', icon: '<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/>' },
    document_deleted:           { bg: '#fef2f2', stroke: '#dc2626', icon: '<polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6"/><path d="M14 11v6"/>' },
    employee_on_hold:           { bg: '#fef2f2', stroke: '#dc2626', icon: '<circle cx="12" cy="8" r="4"/><path d="M20 21a8 8 0 1 0-16 0"/>' },
    employee_resumed:           { bg: '#f0fdf4', stroke: '#16a34a', icon: '<circle cx="12" cy="8" r="4"/><path d="M20 21a8 8 0 1 0-16 0"/>' },
    class_reassigned:           { bg: '#eff6ff', stroke: '#2563eb', icon: '<path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/>' },
    admission_pending:          { bg: '#fef3c7', stroke: '#d97706', icon: '<path d="M18 9v3m0 0v3m0-3h3m-3 0h-3m-2-5a4 4 0 1 1-8 0 4 4 0 0 1 8 0zM3 20a6 6 0 0 1 12 0v1H3v-1z"/>' },
    admission_approved:         { bg: '#f0fdf4', stroke: '#16a34a', icon: '<polyline points="20 6 9 17 4 12"/>' },
    admission_rejected:         { bg: '#fef2f2', stroke: '#dc2626', icon: '<line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>' },
    event_created:              { bg: '#f5f3ff', stroke: '#7c3aed', icon: '<rect x="3" y="4" width="18" height="18" rx="2" ry="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/>' },
    announcement_created:       { bg: '#f5f3ff', stroke: '#7c3aed', icon: '<path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.73 21a2 2 0 0 1-3.46 0"/>' },
    birthday_student:           { bg: '#fff7ed', stroke: '#ea580c', icon: '<path d="M20 12v7a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2v-7"/><path d="M2 7h20v5H2z"/><path d="M12 22V7"/><path d="M12 7H7.5a2.5 2.5 0 0 1 0-5c2.3 0 4.5 2.6 4.5 5Z"/><path d="M12 7h4.5a2.5 2.5 0 0 0 0-5c-2.3 0-4.5 2.6-4.5 5Z"/>' },
    birthday_staff:             { bg: '#fdf2f8', stroke: '#db2777', icon: '<path d="M20 12v7a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2v-7"/><path d="M2 7h20v5H2z"/><path d="M12 22V7"/><path d="M12 7H7.5a2.5 2.5 0 0 1 0-5c2.3 0 4.5 2.6 4.5 5Z"/><path d="M12 7h4.5a2.5 2.5 0 0 0 0-5c-2.3 0-4.5 2.6-4.5 5Z"/>' },
    birthday_guardian:          { bg: '#eef2ff', stroke: '#4f46e5', icon: '<path d="M20 12v7a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2v-7"/><path d="M2 7h20v5H2z"/><path d="M12 22V7"/><path d="M12 7H7.5a2.5 2.5 0 0 1 0-5c2.3 0 4.5 2.6 4.5 5Z"/><path d="M12 7h4.5a2.5 2.5 0 0 0 0-5c-2.3 0-4.5 2.6-4.5 5Z"/>' },
    term_changed:               { bg: 'color-mix(in srgb, var(--org-primary-color, #01535b) 12%, #ffffff)', stroke: 'var(--org-primary-color, #01535b)', icon: '<circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/>' },
    task_assigned:              { bg: '#e0f2fe', stroke: '#0369a1', icon: '<path d="M9 11l3 3L22 4"/><path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11"/>' },
    task_done:                  { bg: '#f0fdf4', stroke: '#16a34a', icon: '<path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/>' },
    task_reply:                 { bg: '#eff6ff', stroke: '#2563eb', icon: '<path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>' },
    event_tagged:               { bg: '#f5f3ff', stroke: '#7c3aed', icon: '<rect x="3" y="4" width="18" height="18" rx="2" ry="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/>' },
    enrollment_added:           { bg: '#f0fdf4', stroke: '#16a34a', icon: '<path d="M18 9v3m0 0v3m0-3h3m-3 0h-3m-2-5a4 4 0 1 1-8 0 4 4 0 0 1 8 0zM3 20a6 6 0 0 1 12 0v1H3v-1z"/>' },
  };
  const DEFAULT_META = {
    bg: 'color-mix(in srgb, var(--org-primary-color, #01535b) 10%, #f8fafc)',
    stroke: 'var(--org-primary-color, #01535b)',
    icon: '<circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/>'
  };

  function getMeta(type) { return TYPE_META[type] || DEFAULT_META; }

  function iconSvg(type) {
    const m = getMeta(type);
    return `<svg viewBox="0 0 24 24" fill="none" stroke="${m.stroke}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${m.icon}</svg>`;
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

  const ensureHeaderPopupConfettiStyles = () => {
    if (document.getElementById('header-popup-confetti-styles')) return;
    const style = document.createElement('style');
    style.id = 'header-popup-confetti-styles';
    style.textContent = `
      @keyframes headerPopupConfettiDrop {
        0% {
          opacity: 0;
          transform: translate3d(0, -8vh, 0) rotate(0deg);
        }
        8% {
          opacity: 1;
        }
        100% {
          opacity: 0.95;
          transform: translate3d(var(--drift, 0px), 118vh, 0) rotate(var(--spin, 720deg));
        }
      }
    `;
    document.head.appendChild(style);
  };

  const showHeaderInfoPopup = ({ overlayId, title, message, buttonLabel, celebratory = false }) => {
    const existing = document.getElementById(overlayId);
    if (existing) existing.remove();

    const overlay = document.createElement('div');
    overlay.id = overlayId;
    overlay.style.position = 'fixed';
    overlay.style.inset = '0';
    overlay.style.background = 'rgba(15,23,42,0.48)';
    overlay.style.zIndex = '12050';
    overlay.style.display = 'flex';
    overlay.style.alignItems = 'center';
    overlay.style.justifyContent = 'center';

    if (celebratory) {
      ensureHeaderPopupConfettiStyles();
      const confettiLayer = document.createElement('div');
      confettiLayer.style.position = 'absolute';
      confettiLayer.style.inset = '0';
      confettiLayer.style.overflow = 'hidden';
      confettiLayer.style.pointerEvents = 'none';

      const colors = ['#f59e0b', '#f97316', '#ef4444', '#ec4899', '#8b5cf6', '#3b82f6', '#06b6d4', '#22c55e', '#fde047'];
      const shapes = ['square', 'circle', 'ribbon'];
      const fragment = document.createDocumentFragment();
      const totalParticles = window.innerWidth < 640 ? 270 : 420;

      for (let i = 0; i < totalParticles; i += 1) {
        const particle = document.createElement('span');
        const shape = shapes[Math.floor(Math.random() * shapes.length)];
        particle.style.position = 'absolute';
        particle.style.top = '-8vh';
        particle.style.left = `${Math.random() * 100}%`;
        particle.style.opacity = '0';
        particle.style.background = colors[Math.floor(Math.random() * colors.length)];
        particle.style.animationName = 'headerPopupConfettiDrop';
        particle.style.animationTimingFunction = 'linear';
        particle.style.animationFillMode = 'forwards';
        particle.style.animationDuration = `${8.5 + Math.random() * 3.5}s`;
        particle.style.animationDelay = `${Math.random() * 0.8}s`;
        particle.style.setProperty('--drift', `${-120 + Math.random() * 240}px`);
        particle.style.setProperty('--spin', `${360 + Math.random() * 1080}deg`);

        if (shape === 'circle') {
          particle.style.width = '8px';
          particle.style.height = '8px';
          particle.style.borderRadius = '50%';
        } else if (shape === 'ribbon') {
          particle.style.width = '6px';
          particle.style.height = '24px';
          particle.style.borderRadius = '999px';
        } else {
          particle.style.width = '10px';
          particle.style.height = '20px';
          particle.style.borderRadius = '2px';
        }

        fragment.appendChild(particle);
      }

      confettiLayer.appendChild(fragment);
      overlay.appendChild(confettiLayer);
    }

    const card = document.createElement('div');
    card.style.position = 'relative';
    card.style.zIndex = '1';
    card.style.width = 'min(92vw, 390px)';
    card.style.background = '#fff';
    card.style.borderRadius = '12px';
    card.style.padding = '16px';
    card.style.boxShadow = '0 14px 35px rgba(15,23,42,0.22)';
    card.innerHTML = `
      <h3 style="margin:0 0 8px;color:#0f172a;font-size:1.05rem;">${escapeHtml(title || 'Notice')}</h3>
      <p style="margin:0 0 12px;color:#334155;font-size:.9rem;line-height:1.5;">${escapeHtml(message || '')}</p>
      <div style="display:flex;justify-content:flex-end;">
        <button type="button" data-popup-ok="1" style="background:var(--org-primary-color,#01535b);color:#fff;border:none;border-radius:8px;padding:8px 12px;cursor:pointer;font-weight:600;">${escapeHtml(buttonLabel || 'Okay')}</button>
      </div>
    `;

    overlay.appendChild(card);
    document.body.appendChild(overlay);

    const close = () => overlay.remove();
    overlay.addEventListener('click', (event) => {
      if (event.target === overlay) close();
    });
    const okBtn = card.querySelector('[data-popup-ok="1"]');
    if (okBtn) okBtn.addEventListener('click', close);
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
            buttonLabel: 'Okay',
            celebratory: true,
          });
        }
      })
      .catch(() => {});
  }
})();
