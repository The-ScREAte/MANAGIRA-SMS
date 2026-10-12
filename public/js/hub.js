// Hub pages: side-panel forms (opened from the right, saved without leaving the
// page), confirmations, school actions, dashboard reports with a per-school
// term filter, PDF/CSV/print, Settings tabs, and the people/classes browser on
// a school's page. Used by every signed-in page in views/hub/.
(function () {
  const shell = document.querySelector('.hub-shell');
  if (!shell || shell.dataset.ready === '1') return;
  shell.dataset.ready = '1';
  const alive = () => document.body.contains(shell);

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

  // ---------- dashboard ----------
  const dash = shell.querySelector('[data-hub-dashboard]');
  if (dash) {
    const VIEWS = Array.from(dash.querySelectorAll('[data-view]')).map((el) => el.dataset.view);
    const REPORT_VIEWS = ['school-comparison', 'attendance', 'performance', 'marks-entry', 'support', 'enrollment'].filter((v) => VIEWS.includes(v));
    const canReports = REPORT_VIEWS.length > 0;
    const canSchools = dash.dataset.canSchools === '1';
    const canExport = dash.dataset.canExport === '1';
    const pdfMode = dash.dataset.pdf === '1';
    const dash$ = (sel) => Array.from(dash.querySelectorAll(sel));
    let data = null;
    let loading = null;
    // Each school is read on its own calendar. A term picked for one school with
    // the filter beside it is kept in the address (?terms=63:150,64:201).
    const overrides = new Map();
    String(new URLSearchParams(window.location.search).get('terms') || '').split(',').forEach((pair) => {
      const [o, t] = pair.split(':');
      if (o && t) overrides.set(String(o), String(t));
    });
    const termsParam = () => Array.from(overrides.entries()).map(([o, t]) => `${o}:${t}`).join(',');
    function saveOverrides() {
      const url = new URL(window.location.href);
      if (overrides.size) url.searchParams.set('terms', termsParam()); else url.searchParams.delete('terms');
      window.history.replaceState(window.history.state, '', url.pathname + url.search + url.hash);
    }

    function show(view) {
      if (!VIEWS.includes(view)) view = 'overview';
      dash$('[data-view]').forEach((el) => el.classList.toggle('is-active', el.dataset.view === view));
      shell.querySelectorAll('[data-view-link]').forEach((a) => {
        const on = a.dataset.viewLink === view;
        a.classList.toggle('is-active', on);
        if (on) a.setAttribute('aria-current', 'page'); else a.removeAttribute('aria-current');
      });
      if (canReports && (view === 'overview' || REPORT_VIEWS.includes(view))) loadReports(false);
    }
    const fromHash = () => (window.location.hash || '#overview').slice(1);
    window.addEventListener('hashchange', () => { if (document.body.contains(dash)) { show(fromHash()); window.scrollTo({ top: 0 }); } });
    // Links to dashboard sections ("#schools", "/hub/dashboard#attendance"): handle them here
    // before the SPA router, which would otherwise only scroll and never switch the section.
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

    const dash0 = (v) => (v === null || v === undefined ? '—' : null);
    const pctOr = (v) => dash0(v) || pct(v);
    const kpi = (accent, icon, label, value, note, bar, href) => {
      const tag = href ? 'a' : 'div';
      return `<${tag} class="hub-kpi hub-kpi--${accent}"${href ? ` href="${href}"` : ''}>
        <span class="hub-kpi__top"><span class="hub-kpi__icon"><i class="fa-solid ${icon}" aria-hidden="true"></i></span><span class="hub-kpi__label">${esc(label)}</span></span>
        <span class="hub-kpi__value">${value}</span>
        ${bar != null ? `<span class="hub-kpi__bar"><span style="width:${Math.max(0, Math.min(100, Number(bar) || 0))}%"></span></span>` : ''}
        ${note ? `<span class="hub-kpi__note">${esc(note)}</span>` : ''}
      </${tag}>`;
    };
    const empty = (icon, text) => `<div class="hub-card hub-empty"><i class="fa-solid ${icon}" aria-hidden="true"></i>${esc(text)}</div>`;
    const card = (title, body, small) => `<div class="hub-card"><div class="hub-card__head"><h2 class="hub-card__title">${esc(title)}${small ? ` <small>${esc(small)}</small>` : ''}</h2></div>${body}</div>`;
    const schoolLink = (s) => canSchools
      ? `<a class="hub-school" href="/hub/organizations/${encodeURIComponent(s.organizationId)}?tab=report${s.termId ? '&selectedTermId=' + encodeURIComponent(s.termId) : ''}">${esc(s.organizationName)}</a>`
      : `<span class="hub-school">${esc(s.organizationName)}</span>`;
    function bars(items, valueKey, opts) {
      const list = items.filter((i) => opts.keep ? opts.keep(i) : true);
      if (!list.length) return `<div class="hub-empty">${esc(opts.emptyText || 'No data for this period yet.')}</div>`;
      const max = opts.max || Math.max(...list.map((i) => Number(i[valueKey]) || 0), 1);
      return '<div class="hub-bars">' + list.map((item) => {
        const raw = item[valueKey];
        const value = Number(raw) || 0;
        const width = raw === null || raw === undefined ? 0 : Math.max(2, Math.min(100, (value / max) * 100));
        const name = item.organizationName || item.name || item.label || item.gender || '';
        return `<div class="hub-bar">
          <span class="hub-bar__name" title="${esc(name)}">${esc(name)}${item.organizationId && item.termOptions ? termChip(item) : ''}</span>
          <span class="hub-bar__track"><span class="hub-bar__fill${opts.toned && raw != null ? ' hub-bar__fill--' + tone(value) : ''}" style="width:${width}%"></span></span>
          <span class="hub-bar__value">${raw === null || raw === undefined ? '—' : opts.format(value)}</span>
          ${opts.sub ? `<span class="hub-bar__sub">${opts.sub(item)}</span>` : ''}
        </div>`;
      }).join('') + '</div>';
    }

    // ----- per-school term filter -----
    function periodLabel() {
      if (!data) return '';
      const custom = overrides.size;
      return custom ? `Each school’s own term · ${custom} school${custom === 1 ? '' : 's'} set by you` : 'Each school’s current term';
    }
    const termChip = (s) => `<button type="button" class="hub-term${overrides.has(String(s.organizationId)) ? ' is-custom' : ''}" data-school-filter="${esc(s.organizationId)}" title="Choose ${esc(s.organizationName)}’s school year and term"><i class="fa-solid fa-sliders" aria-hidden="true"></i><span>${s.termLabel ? esc(s.termLabel) : 'No term yet'}</span></button>`;
    function renderPeriod() {
      const custom = overrides.size;
      const html = `<div class="hub-period">
          <i class="fa-regular fa-calendar" aria-hidden="true"></i>
          <span><strong>${custom ? `${custom} school${custom === 1 ? '' : 's'} on a term you chose` : 'Each school’s current term'}</strong>
          <span class="hub-period__hint">Schools keep their own calendars. Use <i class="fa-solid fa-sliders" aria-hidden="true"></i> beside a school to see another school year or term.</span></span>
          ${custom ? '<button type="button" class="hub-btn hub-btn--sm" data-terms-reset>Back to current terms</button>' : ''}
        </div>`;
      dash$('[data-period-slot]').forEach((slot) => { slot.innerHTML = html; });
      dash$('[data-period-label]').forEach((el) => { el.textContent = '· ' + periodLabel(); });
    }

    function loadReports(force) {
      if (!canReports) return Promise.resolve(null);
      if (data && !force) return Promise.resolve(data);
      if (loading) return loading;
      if (force) dash$('[data-report]').forEach((el) => { el.innerHTML = '<div class="hub-card hub-loading">Loading report…</div>'; });
      const q = new URLSearchParams();
      if (overrides.size) q.set('terms', termsParam());
      loading = fetch('/hub/overview-stats?' + q.toString(), { headers: { Accept: 'application/json' }, credentials: 'same-origin' })
        .then((r) => { if (!r.ok) throw new Error('failed'); return r.json(); })
        .then((json) => {
          data = json;
          renderPeriod();
          renderAll();
          if (pdfMode) setTimeout(() => { window.__hubReportReady = true; }, 150);
          return json;
        })
        .catch(() => {
          dash$('[data-report]').forEach((el) => { el.innerHTML = empty('fa-circle-exclamation', 'Reports could not load. Try Refresh.'); });
          const hl = dash.querySelector('[data-highlights]');
          if (hl) hl.innerHTML = '<div class="hub-empty">Report highlights could not load.</div>';
        })
        .finally(() => { loading = null; });
      return loading;
    }

    // ----- smart "needs your attention" items for the chosen period -----
    function renderAttention() {
      const box = dash.querySelector('[data-attention-extra]');
      if (!box) return;
      const rows = data.schools.filter((s) => s.hasData && !s.onHold);
      const items = [];
      const lowAtt = rows.filter((s) => s.attendanceRate !== null && s.attendanceRate < data.lowAttendanceRate);
      if (lowAtt.length) items.push(['#attendance', 'fa-calendar-xmark', '', `<strong>${lowAtt.length}</strong> school${lowAtt.length === 1 ? ' has' : 's have'} attendance below ${data.lowAttendanceRate}%`]);
      const noAtt = rows.filter((s) => !s.attendanceMarked);
      if (noAtt.length) items.push(['#attendance', 'fa-clipboard-question', ' hub-alert--info', `<strong>${noAtt.length}</strong> school${noAtt.length === 1 ? ' hasn’t' : 's haven’t'} marked attendance this term`]);
      const lowMarks = rows.filter((s) => s.scoreEntryRate !== null && s.scoreEntryRate < 50);
      if (lowMarks.length) items.push(['#marks-entry', 'fa-pen-to-square', ' hub-alert--info', `<strong>${lowMarks.length}</strong> school${lowMarks.length === 1 ? ' has' : 's have'} entered less than half of their marks`]);
      if (data.totals.needsSupport) items.push(['#support', 'fa-hand-holding-heart', '', `<strong>${num(data.totals.needsSupport)}</strong> student${data.totals.needsSupport === 1 ? ' is' : 's are'} averaging below ${data.passMark}%`]);
      const noData = data.schools.filter((s) => !s.hasData);
      if (noData.length && !overrides.size) items.push(['#school-comparison', 'fa-circle-info', ' hub-alert--info', `<strong>${noData.length}</strong> school${noData.length === 1 ? ' has' : 's have'} no attendance, enrollment or scores yet`]);
      box.innerHTML = items.map(([href, icon, cls, text]) => `<a class="hub-alert${cls}" href="${href}"><i class="fa-solid ${icon}" aria-hidden="true"></i><span>${text}</span><i class="fa-solid fa-chevron-right" aria-hidden="true"></i></a>`).join('');
      const clear = dash.querySelector('[data-attention-clear]');
      const serverItems = box.parentElement ? box.parentElement.querySelectorAll(':scope > a.hub-alert').length : 0;
      if (clear) clear.hidden = items.length > 0 || serverItems > 0;
    }

    function renderAll() {
      const t = data.totals || {};
      const rows = data.schools || [];
      const withData = rows.filter((s) => s.hasData);
      const termOf = (s) => termChip(s) + (s.hasData ? '' : '<span class="hub-small">No data for this term yet</span>');
      const stamp = data.generatedAt ? 'Updated ' + new Date(data.generatedAt).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }) : '';
      dash$('[data-report-stamp]').forEach((el) => { el.textContent = stamp; });

      const hl = dash.querySelector('[data-highlights]');
      if (hl) {
        hl.innerHTML =
          kpi('violet', 'fa-calendar-check', 'Attendance rate', pctOr(t.attendanceRate), `${num(t.attendancePresent)} present of ${num(t.attendanceMarked)} marked`, t.attendanceRate, '#attendance') +
          kpi('green', 'fa-chart-line', 'Average score', pctOr(t.averageScore), `Pass rate ${pctOr(t.passRate)} · pass mark ${data.passMark}%`, t.averageScore, '#performance') +
          kpi('sky', 'fa-pen-to-square', 'Marks entered', pctOr(t.scoreEntryRate), `${num(t.scoresEntered)} of ${num(t.scoresExpected)} expected scores`, t.scoreEntryRate, '#marks-entry') +
          kpi('rose', 'fa-hand-holding-heart', 'Need support', num(t.needsSupport), `Below ${data.passMark}% average · ${num(t.lowAttendance)} with low attendance`, null, '#support');
      }
      renderAttention();
      const set = (key, html) => { const el = dash.querySelector(`[data-report="${key}"]`); if (el) el.innerHTML = html; };
      if (!rows.length) { REPORT_VIEWS.forEach((k) => set(k, empty('fa-school', 'No schools in your hub yet.'))); return; }

      set('school-comparison', `<div class="hub-card"><div class="hub-table-wrap"><table class="hub-table" data-sortable>
          <thead><tr>
            <th data-sort="organizationName">School</th><th>Term</th>
            <th class="num" data-sort="enrolled">Enrolled</th><th class="num" data-sort="attendanceRate">Attendance</th>
            <th class="num" data-sort="averageScore">Avg score</th><th class="num" data-sort="passRate">Pass rate</th>
            <th class="num" data-sort="scoreEntryRate">Marks entered</th><th class="num" data-sort="staff">Staff</th>
            <th class="num" data-sort="classes">Classes</th><th class="num" data-sort="subjects">Subjects</th><th>Status</th>
          </tr></thead>
          <tbody>${rows.map((s) => `<tr class="${s.onHold ? 'is-held' : ''}">
            <td>${schoolLink(s)}</td><td>${termOf(s)}</td>
            <td class="num">${s.hasData ? num(s.enrolled) : '—'}</td><td class="num">${pctOr(s.attendanceRate)}</td>
            <td class="num">${pctOr(s.averageScore)}</td><td class="num">${pctOr(s.passRate)}</td>
            <td class="num">${pctOr(s.scoreEntryRate)}</td><td class="num">${num(s.staff)}</td>
            <td class="num">${num(s.classes)}</td><td class="num">${num(s.subjects)}</td>
            <td><span class="hub-status${s.onHold ? ' hub-status--hold' : ''}">${s.onHold ? 'On hold' : 'Active'}</span></td>
          </tr>`).join('')}</tbody>
          ${rows.length > 1 ? `<tfoot><tr><th>All schools</th><th></th><th class="num">${num(t.enrolled)}</th><th class="num">${pctOr(t.attendanceRate)}</th><th class="num">${pctOr(t.averageScore)}</th><th class="num">${pctOr(t.passRate)}</th><th class="num">${pctOr(t.scoreEntryRate)}</th><th class="num">${num(t.staff)}</th><th class="num">${num(t.classes)}</th><th class="num">${num(t.subjects)}</th><th></th></tr></tfoot>` : ''}
        </table></div><p class="hub-small" style="margin:12px 0 0">Subjects are counted once per school, even when several classes take the same subject. Click a column to sort.</p></div>`);

      set('attendance', `<div class="hub-kpis">
          ${kpi('violet', 'fa-calendar-check', 'Attendance rate', pctOr(t.attendanceRate), periodLabel(), t.attendanceRate)}
          ${kpi('green', 'fa-user-check', 'Present', num(t.attendancePresent), 'Attendance marks')}
          ${kpi('sky', 'fa-list-check', 'Marked', num(t.attendanceMarked), 'All attendance marks')}
          ${kpi('rose', 'fa-user-clock', `Below ${data.lowAttendanceRate}%`, num(t.lowAttendance), 'Students with low attendance')}
        </div>
        ${card('Attendance by school', bars(rows, 'attendanceRate', { max: 100, toned: true, format: pct, keep: (s) => s.hasData, sub: (s) => `${num(s.attendancePresent)} present of ${num(s.attendanceMarked)} · ${num(s.lowAttendance)} below ${data.lowAttendanceRate}% · ${esc(s.termLabel)}` }), 'Green 75%+, amber 50–74%, red under 50%')}`);

      const subjects = data.subjects || [];
      set('performance', `<div class="hub-kpis">
          ${kpi('green', 'fa-chart-line', 'Average score', pctOr(t.averageScore), 'Each student’s subject score, capped at 100%', t.averageScore)}
          ${kpi('teal', 'fa-circle-check', 'Pass rate', pctOr(t.passRate), `Subject results at ${data.passMark}% or above`, t.passRate)}
          ${kpi('sky', 'fa-file-lines', 'Subject results', num(t.results))}
          ${kpi('rose', 'fa-arrow-trend-down', `Below ${data.passMark}%`, num(t.needsSupport), 'Students averaging below the pass mark')}
        </div>
        ${card('Average score by school', bars(rows, 'averageScore', { max: 100, toned: true, format: pct, keep: (s) => s.results > 0, emptyText: 'No scores for this period yet.', sub: (s) => `Pass rate ${pctOr(s.passRate)} · ${num(s.results)} results${s.academicLabel ? ' · from ' + esc(s.academicLabel) : ''}` }))}
        <div class="hub-grid">
          ${card('Subjects across your schools', subjects.length ? `<div class="hub-table-wrap"><table class="hub-table"><thead><tr><th>Subject</th><th class="num">Avg score</th><th class="num">Pass rate</th><th class="num">Results</th><th class="num">Schools</th></tr></thead><tbody>${subjects.map((x) => `<tr><td>${esc(x.name)}</td><td class="num">${pctOr(x.averageScore)}</td><td class="num">${pctOr(x.passRate)}</td><td class="num">${num(x.results)}</td><td class="num">${num(x.schools)}</td></tr>`).join('')}</tbody></table></div>` : '<div class="hub-empty">No subject scores for this period yet.</div>')}
          ${card('Student averages', bars((data.distribution || []).map((d) => ({ label: d.label, students: d.students })), 'students', { format: num, emptyText: 'No scores for this period yet.' }), 'How many students fall in each band')}
        </div>`);

      set('marks-entry', `<div class="hub-kpis">
          ${kpi('sky', 'fa-pen-to-square', 'Marks entered', pctOr(t.scoreEntryRate), periodLabel(), t.scoreEntryRate)}
          ${kpi('green', 'fa-check', 'Entered', num(t.scoresEntered), 'Scores teachers have entered')}
          ${kpi('amber', 'fa-hourglass-half', 'Still missing', num(Math.max(0, (t.scoresExpected || 0) - (t.scoresEntered || 0))), 'Expected scores not entered yet')}
          ${kpi('violet', 'fa-list-ol', 'Expected', num(t.scoresExpected), 'Enrolled students × assessments set')}
        </div>
        ${card('Marks entered by school', bars(rows, 'scoreEntryRate', { max: 100, toned: true, format: pct, keep: (s) => s.scoresExpected > 0, emptyText: 'No assessments have been set for this period yet.', sub: (s) => `${num(s.scoresEntered)} of ${num(s.scoresExpected)} scores · ${esc(s.termLabel)}` }))}`);

      set('support', `<div class="hub-kpis">
          ${kpi('rose', 'fa-arrow-trend-down', `Averaging below ${data.passMark}%`, num(t.needsSupport), 'Across all subjects')}
          ${kpi('amber', 'fa-user-clock', `Attendance below ${data.lowAttendanceRate}%`, num(t.lowAttendance), periodLabel())}
          ${kpi('teal', 'fa-user-graduate', 'Students with scores', num(rows.reduce((a, s) => a + (s.studentsWithScores || 0), 0)))}
        </div>
        <div class="hub-card"><div class="hub-table-wrap"><table class="hub-table">
          <thead><tr><th>School</th><th>Term</th><th class="num">Below ${data.passMark}% average</th><th class="num">Below ${data.lowAttendanceRate}% attendance</th><th class="num">Students with scores</th><th></th></tr></thead>
          <tbody>${rows.map((s) => `<tr><td>${schoolLink(s)}</td><td>${termOf(s)}</td>
            <td class="num">${s.hasData ? `<span class="hub-pill${s.needsSupport ? ' hub-pill--rose' : ''}">${num(s.needsSupport)}</span>` : '—'}</td>
            <td class="num">${s.hasData ? `<span class="hub-pill${s.lowAttendance ? ' hub-pill--amber' : ''}">${num(s.lowAttendance)}</span>` : '—'}</td>
            <td class="num">${s.hasData ? num(s.studentsWithScores) : '—'}</td>
            <td>${canSchools && s.hasData ? `<a class="hub-btn hub-btn--sm" href="/hub/organizations/${encodeURIComponent(s.organizationId)}?tab=report&selectedTermId=${encodeURIComponent(s.termId)}">See students</a>` : ''}</td></tr>`).join('')}</tbody>
        </table></div><p class="hub-small" style="margin:12px 0 0">Names are shown on each school’s report.</p></div>`);

      const gender = data.gender || [];
      const trend = rows.length === 1 && rows[0].enrollmentTrend ? rows[0].enrollmentTrend : null;
      set('enrollment', `<div class="hub-kpis">
          ${kpi('blue', 'fa-user-graduate', 'Enrolled this term', num(t.enrolled), periodLabel())}
          ${kpi('teal', 'fa-users', 'Active students', num(t.students), 'Graduated & archived not counted')}
          ${kpi('amber', 'fa-user-tie', 'Staff', num(t.staff), `${one(t.studentsPerStaff)} students per staff`)}
          ${kpi('violet', 'fa-chalkboard', 'Classes', num(t.classes), `${one(t.studentsPerClass)} students per class · ${num(t.subjects)} subjects`)}
        </div>
        <div class="hub-grid">
          ${card('Enrolled by school', bars(rows, 'enrolled', { format: num, keep: (s) => s.hasData, sub: (s) => (s.enrolledChange === null || s.enrolledChange === undefined ? esc(s.termLabel) : `${s.enrolledChange >= 0 ? '+' : ''}${num(s.enrolledChange)} vs ${esc(s.previousTermLabel)}`) }))}
          ${card('Staff by school', bars(rows, 'staff', { format: num, sub: (s) => `${num(s.teachers || 0)} teachers · ${one(s.studentsPerStaff)} students per staff` }))}
          ${card('Students by gender', bars(gender, 'count', { format: num, emptyText: 'No enrollment for this period yet.' }), 'Enrolled this term')}
          ${trend ? card('Enrollment over time', bars(trend.map((x) => ({ label: x.label, enrolled: x.enrolled })), 'enrolled', { format: num })) : card('Classes by school', bars(rows, 'classes', { format: num, sub: (s) => `${num(s.subjects)} subjects · ${one(s.studentsPerClass)} students per class` }))}
        </div>`);
    }

    // Click a column heading to sort the comparison table.
    dash.addEventListener('click', (e) => {
      const th = e.target.closest('table[data-sortable] th[data-sort]');
      if (!th || !data) return;
      const key = th.dataset.sort;
      const dir = th.dataset.dir === 'desc' ? 'asc' : 'desc';
      data.schools.sort((a, b) => {
        const x = a[key]; const y = b[key];
        if (typeof x === 'string' || typeof y === 'string') return dir === 'asc' ? String(x).localeCompare(String(y)) : String(y).localeCompare(String(x));
        return dir === 'asc' ? (x ?? -1) - (y ?? -1) : (y ?? -1) - (x ?? -1);
      });
      renderAll();
      const again = dash.querySelector(`table[data-sortable] th[data-sort="${key}"]`);
      if (again) { again.dataset.dir = dir; again.setAttribute('aria-sort', dir === 'asc' ? 'ascending' : 'descending'); }
    });

    // ----- CSV downloads -----
    const CSV = {
      'school-comparison': () => [['School', 'Term', 'Enrolled', 'Attendance %', 'Average score %', 'Pass rate %', 'Marks entered %', 'Staff', 'Classes', 'Subjects', 'Active students', 'Status'],
        ...data.schools.map((s) => [s.organizationName, s.termLabel || 'No data', s.enrolled, s.attendanceRate, s.averageScore, s.passRate, s.scoreEntryRate, s.staff, s.classes, s.subjects, s.students, s.onHold ? 'On hold' : 'Active'])],
      attendance: () => [['School', 'Term', 'Attendance %', 'Present', 'Marked', `Students below ${data.lowAttendanceRate}%`],
        ...data.schools.map((s) => [s.organizationName, s.termLabel || 'No data', s.attendanceRate, s.attendancePresent, s.attendanceMarked, s.lowAttendance])],
      performance: () => [['School', 'Term', 'Average score %', 'Pass rate %', 'Subject results', `Students below ${data.passMark}%`],
        ...data.schools.map((s) => [s.organizationName, s.academicLabel || s.termLabel || 'No data', s.averageScore, s.passRate, s.results, s.needsSupport]),
        [], ['Subject', 'Average score %', 'Pass rate %', 'Results', 'Schools'], ...(data.subjects || []).map((x) => [x.name, x.averageScore, x.passRate, x.results, x.schools])],
      'marks-entry': () => [['School', 'Term', 'Marks entered %', 'Entered', 'Expected'],
        ...data.schools.map((s) => [s.organizationName, s.termLabel || 'No data', s.scoreEntryRate, s.scoresEntered, s.scoresExpected])],
      support: () => [['School', 'Term', `Averaging below ${data.passMark}%`, `Attendance below ${data.lowAttendanceRate}%`, 'Students with scores'],
        ...data.schools.map((s) => [s.organizationName, s.termLabel || 'No data', s.needsSupport, s.lowAttendance, s.studentsWithScores])],
      enrollment: () => [['School', 'Term', 'Enrolled', 'Change vs previous term', 'Active students', 'Staff', 'Teachers', 'Classes', 'Subjects'],
        ...data.schools.map((s) => [s.organizationName, s.termLabel || 'No data', s.enrolled, s.enrolledChange, s.students, s.staff, s.teachers, s.classes, s.subjects])],
    };
    const cell = (v) => { const x = v === null || v === undefined ? '' : String(v); const safe = /^[=+\-@]/.test(x) ? `'${x}` : x; return /[",\r\n]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe; };
    dash.addEventListener('click', (e) => {
      const btn = e.target.closest('[data-report-csv]');
      if (!btn || !data) return;
      const key = btn.dataset.reportCsv;
      const rows = [[`Report: ${btn.closest('section').querySelector('.hub-hero__title').textContent.trim()}`], [`Period: ${periodLabel()}`], [`Downloaded: ${new Date().toISOString().slice(0, 10)}`], [], ...CSV[key]()];
      const blob = new Blob(['﻿' + rows.map((r) => r.map(cell).join(',')).join('\r\n')], { type: 'text/csv;charset=utf-8' });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = `Hub_${key}_${periodLabel().replace(/[^A-Za-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'report'}.csv`;
      document.body.appendChild(a);
      a.click();
      setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 500);
    });

    // ----- the filter pop-up for one school -----
    function sfOptions(school, yearId, termId) {
      const opts = school.termOptions || { years: [] };
      const year = opts.years.find((y) => String(y.id) === String(yearId)) || opts.years[0];
      const terms = year ? year.terms : [];
      const pick = terms.find((t) => String(t.id) === String(termId)) || terms.find((t) => t.current) || [...terms].reverse().find((t) => t.hasData) || terms[terms.length - 1];
      return {
        yearHtml: opts.years.map((y) => `<option value="${esc(y.id)}"${year && y.id === year.id ? ' selected' : ''}>${esc(y.label)}</option>`).join(''),
        termHtml: terms.map((t) => `<option value="${esc(t.id)}"${pick && t.id === pick.id ? ' selected' : ''}>${esc(t.name)}${t.current ? ' (current)' : ''}${t.hasData ? '' : ' · no data yet'}</option>`).join(''),
      };
    }
    async function sfPreview(root, school, termId) {
      const box = root.querySelector('[data-sf-preview]');
      box.innerHTML = '<div class="hub-loading">Loading this term…</div>';
      try {
        const r = await fetch(`/hub/overview-stats?org=${encodeURIComponent(school.organizationId)}&term=${encodeURIComponent(termId)}`, { credentials: 'same-origin', headers: { Accept: 'application/json' } });
        const json = await r.json();
        if (root.querySelector('[data-sf-term]').value !== String(termId)) return; // a newer choice is loading
        const s = json.schools[0] || {};
        if (!s.hasData) { box.innerHTML = '<div class="hub-empty"><i class="fa-regular fa-calendar-xmark" aria-hidden="true"></i>No attendance, enrollment or scores for this term yet.</div>'; return; }
        const tile = (label, value, note) => `<div class="hub-mini"><span class="hub-mini__label">${esc(label)}</span><span class="hub-mini__value">${value}</span>${note ? `<span class="hub-mini__note">${esc(note)}</span>` : ''}</div>`;
        box.innerHTML = `<div class="hub-minis">
            ${tile('Enrolled', num(s.enrolled), s.enrolledChange == null ? '' : `${s.enrolledChange >= 0 ? '+' : ''}${num(s.enrolledChange)} vs ${s.previousTermLabel}`)}
            ${tile('Attendance', pctOr(s.attendanceRate), `${num(s.attendancePresent)} of ${num(s.attendanceMarked)} marked present`)}
            ${tile('Average score', pctOr(s.averageScore), s.academicLabel ? `From ${s.academicLabel}` : `Pass rate ${pctOr(s.passRate)}`)}
            ${tile('Marks entered', pctOr(s.scoreEntryRate), `${num(s.scoresEntered)} of ${num(s.scoresExpected)}`)}
            ${tile(`Below ${json.passMark}%`, num(s.needsSupport), 'Students averaging below the pass mark')}
            ${tile('Low attendance', num(s.lowAttendance), `Students below ${json.lowAttendanceRate}%`)}
          </div>
          ${(json.subjects || []).length ? `<p class="hub-drawer-section__title">Subjects</p><div class="hub-table-wrap"><table class="hub-table" data-no-global-sort><thead><tr><th>Subject</th><th class="num">Average</th><th class="num">Pass rate</th></tr></thead><tbody>${json.subjects.map((x) => `<tr><td>${esc(x.name)}</td><td class="num">${pctOr(x.averageScore)}</td><td class="num">${pctOr(x.passRate)}</td></tr>`).join('')}</tbody></table></div>` : ''}`;
      } catch (_e) {
        box.innerHTML = '<div class="hub-empty">This term could not load. Try again.</div>';
      }
    }
    function openSchoolFilter(id) {
      const school = data && data.schools.find((s) => String(s.organizationId) === String(id));
      if (!school) return;
      const yearOf = (termId) => ((school.termOptions.years.find((y) => y.terms.some((t) => String(t.id) === String(termId))) || {}).id);
      const o = sfOptions(school, yearOf(school.termId), school.termId);
      setDrawer({
        title: school.organizationName,
        sub: 'This school’s own school year and term.',
        html: `<div class="hub-sf" data-sf="${esc(school.organizationId)}">
            <div class="hub-form__grid">
              <label class="hub-field"><span class="hub-label">School year</span><select data-sf-year>${o.yearHtml || '<option value="">No school years yet</option>'}</select></label>
              <label class="hub-field"><span class="hub-label">Term</span><select data-sf-term>${o.termHtml || '<option value="">No terms yet</option>'}</select></label>
            </div>
            <div data-sf-preview></div>
            <div class="hub-drawer__foot">
              <button type="button" class="hub-btn hub-btn--primary" data-sf-apply><i class="fa-solid fa-check" aria-hidden="true"></i> Use in hub reports</button>
              ${canSchools ? '<a class="hub-btn" data-sf-open href="#"><i class="fa-solid fa-chart-pie" aria-hidden="true"></i> Full report</a>' : ''}
              ${canSchools && canExport ? '<button type="button" class="hub-btn" data-sf-pdf><i class="fa-solid fa-file-pdf" aria-hidden="true"></i> PDF</button>' : ''}
            </div>
          </div>`,
      });
      showDrawer();
      const root = drawerBody.querySelector('[data-sf]');
      const termSel = root.querySelector('[data-sf-term]');
      const sync = () => {
        const link = root.querySelector('[data-sf-open]');
        if (link) link.href = `/hub/organizations/${encodeURIComponent(school.organizationId)}?tab=report&selectedTermId=${encodeURIComponent(termSel.value)}`;
        if (/^\d+$/.test(termSel.value)) sfPreview(root, school, termSel.value);
        else root.querySelector('[data-sf-preview]').innerHTML = '<div class="hub-empty">This school has no terms set up yet.</div>';
      };
      root.querySelector('[data-sf-year]').addEventListener('change', (e) => {
        termSel.innerHTML = sfOptions(school, e.target.value, null).termHtml;
        sync();
      });
      termSel.addEventListener('change', sync);
      root.querySelector('[data-sf-apply]').addEventListener('click', () => {
        const key = String(school.organizationId);
        const currentTerm = (school.termOptions.years.flatMap((y) => y.terms).find((t) => t.current) || {}).id;
        if (!termSel.value || String(termSel.value) === String(currentTerm)) overrides.delete(key); else overrides.set(key, String(termSel.value));
        saveOverrides();
        closeDrawer();
        const chosen = termSel.selectedOptions[0] ? termSel.selectedOptions[0].textContent.replace(' (current)', '').replace(' · no data yet', '') : 'its current term';
        toast(`${school.organizationName} now shows ${chosen}.`);
        loadReports(true);
      });
      const pdfBtn = root.querySelector('[data-sf-pdf]');
      if (pdfBtn) pdfBtn.addEventListener('click', () => downloadPdf(pdfBtn, `/hub/organizations/${encodeURIComponent(school.organizationId)}/report/pdf?selectedTermId=${encodeURIComponent(termSel.value)}`));
      sync();
    }

    // ----- PDF and print -----
    async function downloadPdf(btn, url) {
      if (btn.getAttribute('aria-busy') === 'true') return;
      const html = btn.innerHTML;
      btn.setAttribute('aria-busy', 'true');
      btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin" aria-hidden="true"></i> Preparing…';
      try {
        const r = await fetch(url, { credentials: 'same-origin' });
        if (!r.ok) { const body = await r.json().catch(() => ({})); throw new Error(body.error || 'The PDF could not be made. Please try again.'); }
        const name = ((r.headers.get('Content-Disposition') || '').match(/filename="([^"]+)"/) || [])[1] || 'Hub_report.pdf';
        const href = URL.createObjectURL(await r.blob());
        const a = document.createElement('a');
        a.href = href;
        a.download = name;
        document.body.appendChild(a);
        a.click();
        a.remove();
        setTimeout(() => URL.revokeObjectURL(href), 10000);
        toast('PDF downloaded.');
      } catch (err) {
        toast(err.message, 'error');
      } finally {
        btn.removeAttribute('aria-busy');
        btn.innerHTML = html;
      }
    }

    dash.addEventListener('click', (e) => {
      if (e.target.closest('[data-report-refresh]')) { loadReports(true); return; }
      if (e.target.closest('[data-report-print]')) { window.print(); return; }
      if (e.target.closest('[data-terms-reset]')) { overrides.clear(); saveOverrides(); loadReports(true); return; }
      const chip = e.target.closest('[data-school-filter]');
      if (chip) { openSchoolFilter(chip.dataset.schoolFilter); return; }
      const pdf = e.target.closest('[data-report-pdf]');
      if (pdf) {
        const q = new URLSearchParams({ view: pdf.dataset.reportPdf });
        if (overrides.size) q.set('terms', termsParam());
        downloadPdf(pdf, '/hub/reports/pdf?' + q.toString());
      }
    });
    // After a save refreshes the page content, draw the reports again.
    document.addEventListener('hub:refreshed', () => {
      if (!document.body.contains(dash)) return;
      show(fromHash());
      if (data) { renderPeriod(); renderAll(); }
    });
    show(fromHash());
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
