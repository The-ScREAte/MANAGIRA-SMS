// Hub pages: side-panel forms (opened from the right, saved without leaving the
// page), confirmations, school actions, dashboard reports with a per-school
// term filter, PDF/CSV/print, Settings tabs, and the people/classes browser on
// a school's page. Used by every signed-in page in views/hub/.
(function () {
  const shell = document.querySelector('.hub-shell');
  if (!shell || shell.dataset.ready === '1') return;
  shell.dataset.ready = '1';
  const alive = () => document.body.contains(shell);

  // A menu link to a dashboard section ("/hub/dashboard#attendance") clicked on
  // another page: remember the section. The page router loads the dashboard
  // before it updates the address, so the address alone would say "overview".
  window.addEventListener('click', (e) => {
    if (!alive() || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey) return;
    const a = e.target.closest && e.target.closest('a[href^="/hub/dashboard#"]');
    if (a && !document.querySelector('[data-hub-dashboard]')) window.__hubWantView = a.getAttribute('href').split('#')[1];
  }, true);

  const esc = (v) => String(v == null ? '' : v).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const num = (v) => Number(v || 0).toLocaleString('en-US');
  const one = (v) => Number(v || 0).toLocaleString('en-US', { maximumFractionDigits: 1 });
  const pct = (v) => one(v) + '%';
  const tone = (v) => (v >= 75 ? 'good' : v >= 50 ? 'mid' : 'low');
  const initials = (name) => String(name || '?').split(/\s+/).filter(Boolean).slice(0, 2).map((p) => p[0]).join('').toUpperCase() || '?';
  const fmtDate = (v) => { if (!v) return '—'; const d = new Date(v); return Number.isNaN(d.getTime()) ? '—' : d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }); };
  const initPhones = (root) => { if (window.initPhoneCountryCombos) { try { window.initPhoneCountryCombos(root); } catch (_e) { /* optional */ } } };

  // ---------- toast ----------
  function toast(message, type) {
    if (!message) return;
    let box = document.querySelector('.hub-toasts');
    if (!box) { box = document.createElement('div'); box.className = 'hub-toasts'; box.setAttribute('aria-live', 'polite'); document.body.appendChild(box); }
    const t = document.createElement('div');
    t.className = 'hub-toast' + (type === 'error' ? ' hub-toast--error' : '');
    t.innerHTML = `<i class="fa-solid ${type === 'error' ? 'fa-circle-exclamation' : 'fa-circle-check'}" aria-hidden="true"></i><span>${esc(message)}</span>`;
    box.appendChild(t);
    setTimeout(() => { t.classList.add('is-leaving'); setTimeout(() => t.remove(), 300); }, type === 'error' ? 6000 : 3500);
  }
  window.HubToast = toast;
  try {
    const pending = sessionStorage.getItem('hubToast');
    if (pending) { sessionStorage.removeItem('hubToast'); const { m, t } = JSON.parse(pending); toast(m, t); }
  } catch (_e) { /* storage may be blocked */ }

  // ---------- confirm box ----------
  function confirmBox({ title, text, ok = 'Yes, continue', danger = false, typeWord = '' }) {
    return new Promise((resolve) => {
      const d = document.createElement('dialog');
      d.className = 'hub-dialog hub-confirm';
      d.innerHTML = `<form method="dialog">
          <div class="hub-dialog__body">
            <h2>${esc(title || 'Are you sure?')}</h2>
            ${text ? `<p>${esc(text)}</p>` : ''}
            ${typeWord ? `<label class="hub-label" for="hubConfirmWord">Type ${esc(typeWord)} to confirm</label><input id="hubConfirmWord" autocomplete="off" />` : ''}
          </div>
          <div class="hub-dialog__actions">
            <button type="button" class="hub-btn" value="no">Cancel</button>
            <button type="button" class="hub-btn ${danger ? 'hub-btn--danger-solid' : 'hub-btn--primary'}" value="yes"${typeWord ? ' disabled' : ''}>${esc(ok)}</button>
          </div>
        </form>`;
      document.body.appendChild(d);
      const yes = d.querySelector('[value="yes"]');
      const word = d.querySelector('#hubConfirmWord');
      if (word) word.addEventListener('input', () => { yes.disabled = word.value.trim() !== typeWord; });
      const done = (v) => { d.close(); d.remove(); resolve(v); };
      yes.addEventListener('click', () => done(true));
      d.querySelector('[value="no"]').addEventListener('click', () => done(false));
      d.addEventListener('cancel', (e) => { e.preventDefault(); done(false); });
      d.showModal();
      (word || yes).focus();
    });
  }
  window.HubConfirm = confirmBox;


  // ---------- after a save: refresh the page in place ----------
  async function refresh() {
    const main = document.querySelector('.hub-main');
    if (!main || !main.hasAttribute('data-refreshable')) {
      window.location.reload();
      return;
    }
    try {
      const r = await fetch(window.location.pathname + window.location.search, { credentials: 'same-origin' });
      if (new URL(r.url).pathname !== window.location.pathname) { window.location.href = r.url; return; }
      const doc = new DOMParser().parseFromString(await r.text(), 'text/html');
      ['.hub-side', '.hub-main'].forEach((sel) => {
        const fresh = doc.querySelector(sel);
        const cur = document.querySelector(sel);
        if (fresh && cur) cur.innerHTML = fresh.innerHTML;
      });
      initPhones(document.querySelector('.hub-main'));
      document.dispatchEvent(new CustomEvent('hub:refreshed'));
    } catch (_e) {
      window.location.reload();
    }
  }
  // Billing shows the saved numbers while Stripe catches up, then refreshes itself.
  let stripeWaits = 0;
  const waitForStripe = () => {
    if (!alive() || !shell.querySelector('[data-hub-billing-refreshing]') || stripeWaits >= 3) return;
    stripeWaits += 1;
    const path = window.location.pathname;
    setTimeout(() => { if (alive() && window.location.pathname === path) refresh(); }, 4000);
  };
  document.addEventListener('hub:refreshed', waitForStripe);
  waitForStripe();

  // Toast now, or after a full reload.
  function done(message) {
    const main = document.querySelector('.hub-main');
    if (main && main.hasAttribute('data-refreshable')) { toast(message); return refresh(); }
    try { sessionStorage.setItem('hubToast', JSON.stringify({ m: message, t: 'ok' })); } catch (_e) { /* ignore */ }
    window.location.reload();
    return null;
  }

  async function ajaxPost(action, fields) {
    const r = await fetch(action, {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'X-Hub-Ajax': '1', Accept: 'application/json', 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams(fields),
    });
    return r.json().catch(() => ({ success: r.ok, message: r.ok ? '' : 'Something went wrong. Please try again.' }));
  }

  // ---------- side panel (drawer) ----------
  const drawer = document.createElement('div');
  drawer.className = 'hub-drawer';
  drawer.hidden = true;
  drawer.innerHTML = `<div class="hub-drawer__backdrop" data-drawer-close></div>
    <aside class="hub-drawer__panel" role="dialog" aria-modal="true" aria-labelledby="hubDrawerTitle" tabindex="-1">
      <header class="hub-drawer__head">
        <div><h2 class="hub-drawer__title" id="hubDrawerTitle"></h2><p class="hub-drawer__sub"></p></div>
        <button type="button" class="hub-drawer__x" data-drawer-close aria-label="Close"><i class="fa-solid fa-xmark" aria-hidden="true"></i></button>
      </header>
      <div class="hub-drawer__error" hidden role="alert"></div>
      <div class="hub-drawer__body"></div>
    </aside>`;
  document.body.appendChild(drawer);
  const drawerPanel = drawer.querySelector('.hub-drawer__panel');
  const drawerBody = drawer.querySelector('.hub-drawer__body');
  const drawerError = drawer.querySelector('.hub-drawer__error');
  let lastFocus = null;

  function setDrawer({ title, sub, html, wide }) {
    drawer.querySelector('.hub-drawer__title').textContent = title || '';
    drawer.querySelector('.hub-drawer__sub').textContent = sub || '';
    drawerPanel.classList.toggle('is-wide', !!wide);
    drawerError.hidden = true;
    if (html !== undefined) drawerBody.innerHTML = html;
  }
  function showDrawer() {
    if (!drawer.hidden && drawer.classList.contains('is-open')) return;
    lastFocus = document.activeElement;
    drawer.hidden = false;
    document.documentElement.classList.add('hub-drawer-open');
    requestAnimationFrame(() => drawer.classList.add('is-open'));
  }
  function closeDrawer() {
    if (drawer.hidden) return;
    drawer.classList.remove('is-open');
    document.documentElement.classList.remove('hub-drawer-open');
    setTimeout(() => { drawer.hidden = true; drawerBody.innerHTML = ''; }, 220);
    if (lastFocus && document.body.contains(lastFocus)) lastFocus.focus();
  }
  function drawerFail(message) {
    drawerError.innerHTML = `<i class="fa-solid fa-circle-exclamation" aria-hidden="true"></i> ${esc(message)}`;
    drawerError.hidden = false;
    drawerError.scrollIntoView({ block: 'nearest' });
  }
  // Open a server-rendered form (GET url?drawer=1) in the side panel.
  async function openDrawer(url) {
    setDrawer({ title: 'Loading…', sub: '', html: '<div class="hub-loading">Loading…</div>' });
    showDrawer();
    try {
      const r = await fetch(url + (url.includes('?') ? '&' : '?') + 'drawer=1', { credentials: 'same-origin', headers: { 'X-Hub-Drawer': '1' } });
      if (!r.ok || r.redirected) throw new Error(r.status === 404 ? 'That item was not found.' : 'You do not have access to this, or it could not load.');
      const html = await r.text();
      const holder = document.createElement('div');
      holder.innerHTML = html;
      const root = holder.querySelector('[data-drawer-title]') || holder;
      setDrawer({ title: root.dataset.drawerTitle, sub: root.dataset.drawerSub, wide: root.hasAttribute('data-drawer-wide'), html: '' });
      drawerBody.appendChild(root);
      initPhones(drawerBody);
      drawerBody.querySelectorAll('[data-user-form]').forEach(initUserForm);
      const first = drawerBody.querySelector('input:not([type=hidden]):not([readonly]):not([disabled]), textarea, select');
      (first || drawerPanel).focus();
    } catch (err) {
      setDrawer({ title: 'Something went wrong', html: '' });
      drawerFail(err.message);
    }
  }
  drawer.addEventListener('click', (e) => { if (e.target.closest('[data-drawer-close]')) closeDrawer(); });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !drawer.hidden && !document.querySelector('dialog[open]')) closeDrawer(); });

  // Links that open the side panel, and "Open school". Window capture phase so the
  // page router never swallows the click first.
  window.addEventListener('click', async (e) => {
    if (!alive() || e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey) return;
    const link = e.target.closest('[data-drawer]');
    if (link) {
      e.preventDefault();
      e.stopPropagation();
      shell.querySelectorAll('.hub-menu[open]').forEach((m) => { m.open = false; });
      openDrawer(link.getAttribute('href') || link.dataset.drawer);
      return;
    }
    const open = e.target.closest('[data-open-school]');
    if (open) {
      e.preventDefault();
      e.stopPropagation();
      const name = open.dataset.name || 'this school';
      if (await confirmBox({ title: `Open ${name}?`, text: `You'll go into ${name}'s own Managira account and see everything, like its owner. Your visit is logged. Use “Back to hub” at the top left to come back.`, ok: 'Open school' })) {
        window.location.href = open.getAttribute('href');
      }
    }
  }, true);

  // ---------- forms that save without leaving the page ----------
  async function submitAjax(form, submitter) {
    if (window.combinePhoneCountryCombos) window.combinePhoneCountryCombos(form);
    const data = new FormData(form);
    if (submitter && submitter.name) data.append(submitter.name, submitter.value);
    const multipart = String(form.getAttribute('enctype') || '').includes('multipart');
    const buttons = Array.from(form.querySelectorAll('button[type=submit]'));
    buttons.forEach((b) => { b.disabled = true; b.setAttribute('aria-busy', 'true'); });
    const inDrawer = drawer.contains(form);
    try {
      const r = await fetch(form.action, {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'X-Hub-Ajax': '1', Accept: 'application/json' },
        body: multipart ? data : new URLSearchParams(data),
      });
      const json = await r.json().catch(() => ({ success: false, message: 'Something went wrong. Please try again.' }));
      // Out of places: approve the extra charge, then send again.
      if (!json.success && json.needsApproval && json.approval) {
        buttons.forEach((b) => { b.disabled = false; b.removeAttribute('aria-busy'); });
        if (await confirmBox(json.approval)) {
          let flag = form.querySelector('input[name="approve_extra"]');
          if (!flag) { flag = document.createElement('input'); flag.type = 'hidden'; flag.name = 'approve_extra'; form.appendChild(flag); }
          flag.value = '1';
          await submitAjax(form, submitter);
        }
        return;
      }
      if (!json.success) {
        if (inDrawer) drawerFail(json.message || 'Could not save. Please check the form.');
        else toast(json.message || 'Could not save.', 'error');
        return;
      }
      const dlg = form.closest('dialog');
      if (dlg) dlg.close();
      if (inDrawer) closeDrawer();
      await done(json.message || 'Saved.');
    } catch (_e) {
      if (inDrawer) drawerFail('Could not reach Managira. Check your connection and try again.');
      else toast('Could not reach Managira. Check your connection and try again.', 'error');
    } finally {
      buttons.forEach((b) => { b.disabled = false; b.removeAttribute('aria-busy'); });
    }
  }
  document.addEventListener('submit', async (e) => {
    const form = e.target;
    if (!alive() || !(form instanceof HTMLFormElement) || !(shell.contains(form) || drawer.contains(form))) return;
    if (form.dataset.confirm && form.dataset.confirmed !== '1') {
      e.preventDefault();
      const ok = await confirmBox({ title: 'Please confirm', text: form.dataset.confirm, danger: /remove|delete|reject/i.test(form.dataset.confirm) });
      if (!ok) return;
      if (form.hasAttribute('data-ajax')) { submitAjax(form, e.submitter); return; }
      form.dataset.confirmed = '1';
      form.requestSubmit ? form.requestSubmit(e.submitter) : form.submit();
      return;
    }
    if (form.hasAttribute('data-ajax')) {
      e.preventDefault();
      shell.querySelectorAll('.hub-menu[open]').forEach((m) => { m.open = false; });
      submitAjax(form, e.submitter);
    }
  });

  // ---------- school actions (dashboard table + school page) ----------
  shell.addEventListener('click', async (e) => {
    const btn = e.target.closest('[data-org-action]');
    if (!btn) return;
    const { orgAction: action, orgId: id, orgName: name } = btn.dataset;
    const menu = btn.closest('details');
    if (menu) menu.open = false;
    const ask = {
      hold: { title: `Put ${name} on hold?`, text: 'Its staff can’t use Managira until you resume it.', ok: 'Put on hold', url: '/hub/organizations/toggle-hold' },
      resume: { title: `Resume ${name}?`, text: 'Its staff get full access again.', ok: 'Resume', url: '/hub/organizations/toggle-hold' },
      remove: { title: `Remove ${name} from your hub?`, text: 'It becomes an independent school and needs its own subscription. Its data stays.', ok: 'Remove', danger: true, url: '/hub/organizations/remove' },
      delete: { title: `Delete ${name} permanently?`, text: 'All of its students, staff and classes are deleted. This can’t be undone.', ok: 'Delete', danger: true, typeWord: 'DELETE', url: '/hub/organizations/delete' },
    }[action];
    if (!ask || !(await confirmBox(ask))) return;
    const json = await ajaxPost(ask.url, { organizationId: id }).catch(() => ({ success: false, message: 'Could not reach Managira.' }));
    if (!json.success) { toast(json.message || 'That did not work.', 'error'); return; }
    if ((action === 'remove' || action === 'delete') && /^\/hub\/organizations\/\d+/.test(window.location.pathname)) {
      try { sessionStorage.setItem('hubToast', JSON.stringify({ m: json.message, t: 'ok' })); } catch (_e) { /* ignore */ }
      window.location.href = '/hub/dashboard#schools';
      return;
    }
    done(json.message || 'Done.');
  });
  document.addEventListener('click', (e) => {
    shell.querySelectorAll('.hub-menu[open]').forEach((m) => { if (!m.contains(e.target)) m.open = false; });
  });
  // Place an open "more" menu on top of everything, next to its button.
  document.addEventListener('toggle', (e) => {
    const menu = e.target;
    if (!(menu instanceof HTMLDetailsElement) || !menu.classList.contains('hub-menu') || !shell.contains(menu)) return;
    const list = menu.querySelector('.hub-menu__list');
    if (!list) return;
    if (!menu.open) { list.classList.remove('is-floating'); list.style.top = list.style.left = ''; return; }
    const r = menu.querySelector('summary').getBoundingClientRect();
    list.classList.add('is-floating');
    const w = list.offsetWidth;
    const h = list.offsetHeight;
    const below = r.bottom + 6 + h <= window.innerHeight;
    list.style.top = `${below ? r.bottom + 6 : Math.max(8, r.top - h - 6)}px`;
    list.style.left = `${Math.max(8, Math.min(window.innerWidth - w - 8, r.right - w))}px`;
  }, true);
  window.addEventListener('scroll', () => { shell.querySelectorAll('.hub-menu[open]').forEach((m) => { m.open = false; }); }, { passive: true });
  // Reject a leave request (dialog with a note).
  shell.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-reject-id]');
    const dialog = shell.querySelector('[data-reject-dialog]');
    if (btn && dialog) {
      dialog.querySelector('[data-reject-id-input]').value = btn.dataset.rejectId;
      dialog.querySelector('[data-reject-name-label]').textContent = btn.dataset.rejectName;
      dialog.querySelector('textarea').value = '';
      dialog.showModal();
    }
    if (e.target.closest('[data-reject-cancel]')) e.target.closest('dialog').close();
  });

  // ---------- invite a school (side panel) ----------
  let searchTimer = null;
  drawer.addEventListener('click', async (e) => {
    const go = e.target.closest('[data-go]');
    if (go) {
      const root = go.closest('[data-invite]');
      root.querySelectorAll('[data-step]').forEach((s) => { s.hidden = s.dataset.step !== go.dataset.go; });
      const focus = root.querySelector(go.dataset.go === 'new' ? '#ivName' : go.dataset.go === 'existing' ? '[data-org-search]' : null);
      if (focus) setTimeout(() => focus.focus(), 30);
      return;
    }
    const inv = e.target.closest('[data-invite-id]');
    if (inv && !inv.disabled) {
      if (!(await confirmBox({ title: `Invite ${inv.dataset.inviteName}?`, text: 'They get an email to join your hub.', ok: 'Send invitation' }))) return;
      inv.disabled = true;
      let json = await ajaxPost('/hub/organizations/invite-existing', { organizationId: inv.dataset.inviteId }).catch(() => ({ success: false }));
      if (!json.success && json.needsApproval && json.approval) {
        if (!(await confirmBox(json.approval))) { inv.disabled = false; return; }
        json = await ajaxPost('/hub/organizations/invite-existing', { organizationId: inv.dataset.inviteId, approve_extra: '1' }).catch(() => ({ success: false }));
      }
      if (!json.success) { inv.disabled = false; drawerFail(json.message || 'The invitation could not be sent.'); return; }
      closeDrawer();
      done(json.message || 'Invitation sent.');
    }
  });
  drawer.addEventListener('input', (e) => {
    const input = e.target.closest('[data-org-search]');
    if (!input) return;
    const results = input.closest('[data-step]').querySelector('[data-org-results]');
    clearTimeout(searchTimer);
    const q = input.value.trim();
    if (q.length < 2) { results.innerHTML = '<div class="hub-empty"><i class="fa-solid fa-magnifying-glass" aria-hidden="true"></i>Type at least 2 letters to search.</div>'; return; }
    results.innerHTML = '<div class="hub-loading">Searching…</div>';
    searchTimer = setTimeout(async () => {
      try {
        const r = await fetch(`/hub/organizations/search?q=${encodeURIComponent(q)}`, { credentials: 'same-origin', headers: { Accept: 'application/json' } });
        const orgs = (await r.json()).organizations || [];
        results.innerHTML = orgs.length
          ? orgs.map((o) => `<div class="hub-result">
              <div><div class="hub-result__name">${esc(o.organization_name)}</div><div class="hub-result__meta">${esc(o.email || '')}${o.nickname ? ' · ' + esc(o.nickname) + '.managira.com' : ''}</div>
              ${o.is_hub_member ? '<span class="hub-tag hub-tag--amber" style="margin-top:6px">Already in a hub</span>' : ''}</div>
              <button type="button" class="hub-btn hub-btn--primary hub-btn--sm" data-invite-id="${esc(o.organization_id)}" data-invite-name="${esc(o.organization_name)}" ${o.is_hub_member ? 'disabled' : ''}>Invite</button>
            </div>`).join('')
          : '<div class="hub-empty"><i class="fa-regular fa-face-meh" aria-hidden="true"></i>No schools found. Try another name, or invite them as a new school.</div>';
      } catch (_e) {
        results.innerHTML = '<div class="hub-empty">Search didn’t work. Please try again.</div>';
      }
    }, 300);
  });

  // ---------- hub user form (side panel) ----------
  function initUserForm(form) {
    const boxes = () => Array.from(form.querySelectorAll('input[name="permissions"]'));
    const defaults = (form.dataset.defaults || '').split(',').filter(Boolean);
    const isSelf = form.dataset.self === '1';
    let choice = new Set(form.dataset.startedAdmin === '1' ? defaults : boxes().filter((b) => b.checked).map((b) => b.value));
    const applyRole = () => {
      if (isSelf) return;
      const admin = (form.querySelector('input[name="role"]:checked') || {}).value === 'hub_admin';
      boxes().forEach((b) => { b.disabled = admin; b.checked = admin ? true : choice.has(b.value); });
      const tools = form.querySelector('[data-perm-tools]');
      if (tools) tools.hidden = admin;
      const note = form.querySelector('[data-perm-note]');
      if (note) note.textContent = admin ? 'Hub admins get everything.' : 'Tick what this person needs.';
    };
    form.addEventListener('change', (e) => {
      if (e.target.name === 'role') { if (e.target.value === 'hub_user' && !choice.size) choice = new Set(defaults); applyRole(); }
      if (e.target.name === 'permissions' && !e.target.disabled) { if (e.target.checked) choice.add(e.target.value); else choice.delete(e.target.value); }
      if (e.target.name === 'isContact') {
        const share = form.querySelector('[data-contact-share]');
        if (share) share.hidden = !e.target.checked;
      }
      if (e.target.name === 'signIn') {
        const field = form.querySelector('[data-password-field]');
        field.hidden = e.target.value !== 'password';
        form.querySelector('#uPassword').required = e.target.value === 'password';
      }
    });
    form.addEventListener('click', (e) => {
      if (e.target.closest('[data-perm-all]')) boxes().forEach((b) => { b.checked = true; choice.add(b.value); });
      if (e.target.closest('[data-perm-none]')) { boxes().forEach((b) => { b.checked = false; }); choice.clear(); }
      if (e.target.closest('[data-generate]')) {
        const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789';
        const bytes = new Uint32Array(12);
        crypto.getRandomValues(bytes);
        const out = Array.from(bytes, (b) => chars[b % chars.length]).join('');
        form.querySelector('#uPassword').value = `${out.slice(0, 4)}-${out.slice(4, 8)}-${out.slice(8)}${bytes[0] % 10}`;
      }
    });
    applyRole();
  }
  // Logo preview before upload.
  drawer.addEventListener('change', (e) => {
    const input = e.target.closest('[data-logo-input]');
    if (!input || !input.files || !input.files[0]) return;
    const preview = input.closest('form').querySelector('[data-logo-preview]');
    if (preview) preview.innerHTML = `<img src="${URL.createObjectURL(input.files[0])}" alt="New logo preview" />`;
  });

  // ---------- settings: tabs and email switches ----------
  window.addEventListener('click', (e) => {
    if (!alive() || e.button !== 0 || e.metaKey || e.ctrlKey) return;
    const tab = e.target.closest('[data-settings-tab]');
    if (!tab) return;
    e.preventDefault();
    e.stopPropagation();
    const key = tab.dataset.settingsTab;
    document.querySelectorAll('[data-settings-tab]').forEach((t) => { const on = t === tab; t.classList.toggle('is-active', on); t.setAttribute('aria-selected', on ? 'true' : 'false'); });
    document.querySelectorAll('[data-settings-pane]').forEach((p) => { p.hidden = p.dataset.settingsPane !== key; });
    const url = new URL(window.location.href);
    url.searchParams.set('tab', key);
    url.searchParams.delete('drawer');
    window.history.replaceState(window.history.state, '', url.pathname + url.search);
  }, true);
  let prefsTimer = null;
  document.addEventListener('change', (e) => {
    const form = e.target.closest('[data-prefs-form]');
    if (!form || !alive()) return;
    const status = document.querySelector('[data-prefs-status]');
    if (status) status.textContent = 'Saving…';
    clearTimeout(prefsTimer);
    prefsTimer = setTimeout(async () => {
      const json = await fetch(form.action, { method: 'POST', credentials: 'same-origin', headers: { 'X-Hub-Ajax': '1', Accept: 'application/json' }, body: new URLSearchParams(new FormData(form)) })
        .then((r) => r.json()).catch(() => ({ success: false }));
      if (status) status.textContent = json.success ? 'Saved' : 'Could not save';
      if (!json.success) toast('Email settings could not be saved.', 'error');
    }, 250);
  });

  // Open a side panel from the address (?drawer=/hub/...) — used when a form link is opened directly.
  {
    const url = new URL(window.location.href);
    const wanted = url.searchParams.get('drawer');
    if (wanted && /^\/hub\//.test(wanted)) {
      url.searchParams.delete('drawer');
      window.history.replaceState(window.history.state, '', url.pathname + url.search + url.hash);
      openDrawer(wanted);
    }
  }

  // ---------- dashboard: one section at a time ----------
  const dash = shell.querySelector('[data-hub-dashboard]');
  if (dash) {
    const VIEWS = Array.from(dash.querySelectorAll('[data-view]')).map((el) => el.dataset.view);
    const canReports = dash.dataset.canReports === '1';
    let attention = null;

    function show(view) {
      if (!VIEWS.includes(view)) view = 'overview';
      dash.querySelectorAll('[data-view]').forEach((el) => el.classList.toggle('is-active', el.dataset.view === view));
      shell.querySelectorAll('[data-view-link]').forEach((a) => {
        const on = a.dataset.viewLink === view;
        a.classList.toggle('is-active', on);
        if (on) a.setAttribute('aria-current', 'page'); else a.removeAttribute('aria-current');
      });
      if (view === 'overview') loadAttention();
      document.dispatchEvent(new CustomEvent('hub:view', { detail: { view } }));
    }
    const fromHash = () => (window.location.hash || '#overview').slice(1);
    window.addEventListener('hashchange', () => { if (document.body.contains(dash)) { show(fromHash()); window.scrollTo({ top: 0 }); } });
    // Links to dashboard sections ("#schools", "/hub/dashboard#reports"): switch the section here
    // before the SPA router, which would otherwise only scroll.
    window.addEventListener('click', (e) => {
      if (!document.body.contains(dash) || e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey) return;
      const a = e.target.closest('a[href]');
      if (!a) return;
      const href = a.getAttribute('href') || '';
      const key = href.startsWith('#') ? href.slice(1) : (href.startsWith('/hub/dashboard#') ? href.split('#')[1] : null);
      if (!key || !VIEWS.includes(key)) return;
      e.preventDefault();
      e.stopPropagation();
      if (window.location.hash !== '#' + key) window.location.hash = key; else show(key);
      window.scrollTo({ top: 0 });
    }, true);

    // Smart "needs your attention" items (attendance, marks, support) for each school's current term.
    function loadAttention() {
      if (!canReports || attention) return;
      attention = fetch('/hub/overview-stats', { headers: { Accept: 'application/json' }, credentials: 'same-origin' })
        .then((r) => (r.ok ? r.json() : null))
        .then((data) => { if (data) renderAttention(data); })
        .catch(() => {});
    }
    function renderAttention(data) {
      const box = dash.querySelector('[data-attention-extra]');
      if (!box) return;
      const rows = (data.schools || []).filter((s) => s.hasData && !s.onHold);
      const plural = (n, one, many) => `<strong>${num(n)}</strong> ${n === 1 ? one : many}`;
      const items = [];
      const lowAtt = rows.filter((s) => s.attendanceRate !== null && s.attendanceRate < data.lowAttendanceRate);
      if (lowAtt.length) items.push(['fa-calendar-xmark', '', `${plural(lowAtt.length, 'school has', 'schools have')} attendance below ${data.lowAttendanceRate}%`]);
      const noAtt = rows.filter((s) => !s.attendanceMarked);
      if (noAtt.length) items.push(['fa-clipboard-question', ' hub-alert--info', `${plural(noAtt.length, 'school hasn’t', 'schools haven’t')} marked attendance this term`]);
      const lowMarks = rows.filter((s) => s.scoreEntryRate !== null && s.scoreEntryRate < 50);
      if (lowMarks.length) items.push(['fa-pen-to-square', ' hub-alert--info', `${plural(lowMarks.length, 'school has', 'schools have')} entered less than half of their marks`]);
      const support = (data.totals && data.totals.needsSupport) || 0;
      if (support) items.push(['fa-hand-holding-heart', '', `${plural(support, 'student is', 'students are')} averaging below ${data.passMark}%`]);
      box.innerHTML = items.map(([icon, cls, text]) => `<a class="hub-alert${cls}" href="#reports"><i class="fa-solid ${icon}" aria-hidden="true"></i><span>${text}</span><i class="fa-solid fa-chevron-right" aria-hidden="true"></i></a>`).join('');
      const clear = dash.querySelector('[data-attention-clear]');
      const serverItems = box.parentElement ? box.parentElement.querySelectorAll(':scope > a.hub-alert').length : 0;
      if (clear) clear.hidden = items.length > 0 || serverItems > 0;
    }

    document.addEventListener('hub:refreshed', () => {
      if (!document.body.contains(dash)) return;
      attention = null;
      show(fromHash());
    });
    const wanted = window.__hubWantView;
    window.__hubWantView = null;
    show(wanted || fromHash());
  }

  // ---------- school page: students / staff / classes ----------
  const browser = shell.querySelector('[data-hub-browser]');
  if (browser) {
    const orgId = browser.dataset.orgId;
    const list = browser.querySelector('[data-list]');
    const detail = browser.querySelector('[data-detail]');
    const search = browser.querySelector('[data-search]');
    const listTitle = browser.querySelector('[data-list-title]');
    const config = {
      students: {
        title: 'Students', key: 'student_id', url: `/hub/organizations/${orgId}/students`,
        name: (i) => `${i.first_name || ''} ${i.last_name || ''}`.trim() || 'Unnamed student',
        meta: (i) => [i.class_name || 'No class', i.gender].filter(Boolean).join(' · '),
      },
      staff: {
        title: 'Staff', key: 'user_id', url: `/hub/organizations/${orgId}/staff`,
        name: (i) => `${i.first_name || ''} ${i.last_name || ''}`.trim() || 'Unnamed staff',
        meta: (i) => [i.account_type || 'Staff', i.email].filter(Boolean).join(' · '),
      },
      classes: {
        title: 'Classes', key: 'class_id', url: `/hub/organizations/${orgId}/classes`,
        name: (i) => i.class_name || 'Unnamed class',
        meta: (i) => `${num(i.student_count)} students · ${num(i.subject_count)} subjects`,
      },
    };
    let current = null;
    let items = [];
    const cache = {};

    function renderList() {
      const c = config[current];
      const q = (search.value || '').trim().toLowerCase();
      const shown = items.filter((i) => !q || (c.name(i) + ' ' + c.meta(i)).toLowerCase().includes(q));
      listTitle.textContent = `${c.title} · ${num(items.length)}`;
      list.innerHTML = shown.length
        ? shown.map((i) => `<button type="button" class="hub-list__item" data-id="${esc(i[c.key])}">
            <span class="hub-avatar">${esc(current === 'classes' ? (c.name(i).replace(/\s+/g, '').slice(0, 3)) : initials(c.name(i)))}</span>
            <span class="hub-list__text"><span class="hub-list__name">${esc(c.name(i))}</span><span class="hub-list__meta">${esc(c.meta(i))}</span></span>
          </button>`).join('')
        : `<div class="hub-empty">${items.length ? 'Nothing matches your search.' : `No ${c.title.toLowerCase()} yet.`}</div>`;
    }
    async function loadTab(tab) {
      current = tab;
      search.value = '';
      search.placeholder = `Search ${config[tab].title.toLowerCase()}…`;
      detail.innerHTML = `<div class="hub-empty"><i class="fa-regular fa-hand-pointer" aria-hidden="true"></i>Pick a name to see the details.</div>`;
      if (cache[tab]) { items = cache[tab]; renderList(); return; }
      list.innerHTML = '<div class="hub-loading">Loading…</div>';
      try {
        const r = await fetch(config[tab].url, { credentials: 'same-origin', headers: { Accept: 'application/json' } });
        const d = await r.json();
        if (!r.ok || d.success === false) throw new Error(d.error || 'Could not load the list.');
        items = cache[tab] = d.items || d.students || d.staff || d.classes || [];
        renderList();
      } catch (err) {
        list.innerHTML = `<div class="hub-empty">${esc(err.message)}</div>`;
      }
    }
    async function loadDetail(id) {
      const c = config[current];
      list.querySelectorAll('.hub-list__item').forEach((b) => b.classList.toggle('is-active', b.dataset.id === String(id)));
      detail.innerHTML = '<div class="hub-loading">Loading…</div>';
      try {
        const r = await fetch(`${c.url}/${encodeURIComponent(id)}`, { credentials: 'same-origin', headers: { Accept: 'application/json' } });
        const d = await r.json();
        if (!r.ok || d.success === false) throw new Error(d.error || 'Could not load the details.');
        detail.innerHTML = renderDetail(current, d.item || d.student || d.staff || d.class || d, d);
        if (window.matchMedia('(max-width: 1100px)').matches) detail.scrollIntoView({ behavior: 'smooth', block: 'start' });
      } catch (err) {
        detail.innerHTML = `<div class="hub-empty">${esc(err.message)}</div>`;
      }
    }
    function head(name, role) {
      return `<div class="hub-detail__head"><span class="hub-avatar">${esc(initials(name))}</span><div><div class="hub-detail__name">${esc(name)}</div><div class="hub-detail__role">${esc(role)}</div></div></div>`;
    }
    const row = (k, v) => `<dt>${esc(k)}</dt><dd>${v == null || v === '' ? '—' : esc(v)}</dd>`;
    function renderDetail(tab, item, raw) {
      if (tab === 'students') {
        const guardians = item.guardians || raw.guardians || [];
        return head(`${item.first_name || ''} ${item.last_name || ''}`.trim(), item.class_name || 'No class') +
          `<dl class="hub-dl">${row('Gender', item.gender)}${row('Date of birth', fmtDate(item.date_of_birth))}${row('Hometown', item.hometown)}${row('Student ID', item.custom_student_id || item.student_id)}</dl>
          <div class="hub-detail__section"><h4>Parents &amp; guardians</h4>${guardians.length ? guardians.map((g) => `<div class="hub-person"><strong>${esc([g.first_name, g.last_name].filter(Boolean).join(' ') || 'Guardian')}</strong>${g.relationship ? ` · ${esc(g.relationship)}` : ''}<br>${esc(g.email || '')}${g.phone ? ` · ${esc(g.phone)}` : ''}</div>`).join('') : '<div class="hub-person">No guardians on file.</div>'}</div>`;
      }
      if (tab === 'staff') {
        return head(`${item.first_name || ''} ${item.last_name || ''}`.trim(), item.account_type || 'Staff') +
          `<dl class="hub-dl">${row('Email', item.email)}${row('Status', item.on_hold ? 'On hold' : 'Active')}${row('Joined', fmtDate(item.created_at))}${row('Last updated', fmtDate(item.updated_at))}</dl>`;
      }
      const subjects = item.subjects || raw.subjects || [];
      const students = item.students || raw.students || [];
      return head(item.class_name || 'Class', `${students.length} students · ${subjects.length} subjects`) +
        `<div class="hub-detail__section"><h4>Subjects</h4><div class="hub-chips">${subjects.length ? subjects.map((s) => `<span class="hub-chip">${esc(s.subject_name || 'Subject')}</span>`).join('') : '<span class="hub-small">No subjects yet.</span>'}</div></div>
        <div class="hub-detail__section"><h4>Students</h4><div class="hub-chips">${students.length ? students.map((s) => `<span class="hub-chip">${esc([s.first_name, s.last_name].filter(Boolean).join(' '))}</span>`).join('') : '<span class="hub-small">No students yet.</span>'}</div></div>`;
    }
    list.addEventListener('click', (e) => { const b = e.target.closest('.hub-list__item'); if (b) loadDetail(b.dataset.id); });
    search.addEventListener('input', renderList);
    browser.loadTab = loadTab;
  }

  // School page tabs (Report / Students / Staff / Classes)
  const tabs = shell.querySelector('[data-hub-tabs]');
  if (tabs) {
    const panes = shell.querySelectorAll('[data-pane]');
    const orgId = tabs.dataset.orgId;
    const activate = (tab) => {
      tabs.querySelectorAll('[data-tab]').forEach((t) => { const on = t.dataset.tab === tab; t.classList.toggle('is-active', on); t.setAttribute('aria-selected', on ? 'true' : 'false'); });
      const people = tab !== 'report';
      panes.forEach((p) => { p.hidden = p.dataset.pane !== (people ? 'people' : 'report'); });
      if (people && browser) browser.loadTab(tab);
      const url = new URL(window.location.href);
      url.searchParams.set('tab', tab);
      window.history.replaceState({}, '', url.pathname + url.search);
    };
    tabs.addEventListener('click', (e) => { const t = e.target.closest('[data-tab]'); if (t) activate(t.dataset.tab); });
    activate(tabs.dataset.initial || 'report');
    void orgId;
  }
})();
