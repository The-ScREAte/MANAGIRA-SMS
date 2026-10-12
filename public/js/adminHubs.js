// Admin › Hubs pages: forms open in a side panel on the right and save without
// leaving the page; the page then refreshes in place. Also the confirm box,
// toasts, the "open hub / school" check, search and the billing form helpers.
// Safe to load more than once (the page router re-runs scripts).
(function () {
  if (window.__ahHubs) { window.__ahHubs.init(); return; }

  const esc = (v) => String(v == null ? '' : v).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const page = () => document.querySelector('.ah:not(.ah--float)');

  // ---------- toast ----------
  function toast(message, type) {
    if (!message) return;
    let box = document.querySelector('.ah-toasts');
    if (!box) { box = document.createElement('div'); box.className = 'ah-toasts'; box.setAttribute('aria-live', 'polite'); document.body.appendChild(box); }
    const t = document.createElement('div');
    t.className = 'ah-toast' + (type === 'error' ? ' ah-toast--error' : '');
    t.innerHTML = `<i class="fa-solid ${type === 'error' ? 'fa-circle-exclamation' : 'fa-circle-check'}" aria-hidden="true"></i><span>${esc(message)}</span>`;
    box.appendChild(t);
    setTimeout(() => { t.classList.add('is-leaving'); setTimeout(() => t.remove(), 300); }, type === 'error' ? 7000 : 4000);
  }
  function toastAfterReload(message, type) {
    try { sessionStorage.setItem('ahToast', JSON.stringify({ m: message, t: type || 'ok' })); } catch (_e) { /* storage blocked */ }
  }
  function pendingToast() {
    try {
      const v = sessionStorage.getItem('ahToast');
      if (v) { sessionStorage.removeItem('ahToast'); const { m, t } = JSON.parse(v); toast(m, t); }
    } catch (_e) { /* ignore */ }
  }

  // ---------- confirm box ----------
  function confirmBox({ title, text, ok = 'Yes, continue', danger = false }) {
    return new Promise((resolve) => {
      const d = document.createElement('dialog');
      d.className = 'ah ah--float ah-dialog';
      d.innerHTML = `<div class="ah-dialog__body">
          <h2 class="ah-dialog__title">${esc(title || 'Are you sure?')}</h2>
          ${text ? `<p class="ah-dialog__text">${esc(text)}</p>` : ''}
        </div>
        <div class="ah-dialog__foot">
          <button type="button" class="ah-btn" data-v="no">Cancel</button>
          <button type="button" class="ah-btn ${danger ? 'ah-btn--danger-solid' : 'ah-btn--primary'}" data-v="yes">${esc(ok)}</button>
        </div>`;
      document.body.appendChild(d);
      const finish = (v) => { d.close(); d.remove(); resolve(v); };
      d.querySelector('[data-v="yes"]').addEventListener('click', () => finish(true));
      d.querySelector('[data-v="no"]').addEventListener('click', () => finish(false));
      d.addEventListener('cancel', (e) => { e.preventDefault(); finish(false); });
      d.showModal();
      d.querySelector('[data-v="yes"]').focus();
    });
  }

  // ---------- side panel ----------
  const drawer = document.createElement('div');
  drawer.className = 'ahd';
  drawer.hidden = true;
  drawer.innerHTML = `<div class="ahd__backdrop" data-ahd-close></div>
    <aside class="ahd__panel ah ah--float" role="dialog" aria-modal="true" aria-labelledby="ahdTitle" tabindex="-1">
      <header class="ahd__head">
        <div style="min-width:0"><h2 class="ahd__title" id="ahdTitle"></h2><p class="ahd__sub"></p></div>
        <button type="button" class="ahd__x" data-ahd-close aria-label="Close"><i class="fa-solid fa-xmark" aria-hidden="true"></i></button>
      </header>
      <div class="ahd__error" role="alert" hidden></div>
      <div class="ahd__body"></div>
    </aside>`;
  document.body.appendChild(drawer);
  const panel = drawer.querySelector('.ahd__panel');
  const body = drawer.querySelector('.ahd__body');
  const errorBox = drawer.querySelector('.ahd__error');
  let lastFocus = null;

  function drawerFail(message) {
    errorBox.innerHTML = `<i class="fa-solid fa-circle-exclamation" aria-hidden="true"></i><span>${esc(message)}</span>`;
    errorBox.hidden = false;
    panel.scrollTop = 0;
    body.scrollTop = 0;
  }
  function closeDrawer() {
    if (drawer.hidden) return;
    drawer.classList.remove('is-open');
    document.documentElement.classList.remove('ahd-lock');
    setTimeout(() => { drawer.hidden = true; body.innerHTML = ''; }, 200);
    if (lastFocus && document.body.contains(lastFocus)) lastFocus.focus();
  }

  let dialCodes = null;
  function phones(root) {
    if (!root.querySelector('.phone-combo')) return;
    const run = () => { try { window.initPhoneCountryCombos && window.initPhoneCountryCombos(root); } catch (_e) { /* optional */ } };
    if (window.initPhoneCountryCombos) { run(); return; }
    if (!dialCodes) {
      dialCodes = new Promise((resolve) => {
        const s = document.createElement('script');
        s.src = '/js/dialCodes.js';
        s.onload = resolve;
        s.onerror = resolve;
        document.head.appendChild(s);
      });
    }
    dialCodes.then(run);
  }

  async function openDrawer(url) {
    lastFocus = document.activeElement;
    drawer.hidden = false;
    errorBox.hidden = true;
    drawer.querySelector('.ahd__title').textContent = 'Loading…';
    drawer.querySelector('.ahd__sub').textContent = '';
    panel.classList.remove('is-wide');
    body.innerHTML = '<div class="ahd-loading"><i class="fa-solid fa-circle-notch fa-spin" aria-hidden="true"></i></div>';
    document.documentElement.classList.add('ahd-lock');
    requestAnimationFrame(() => drawer.classList.add('is-open'));
    try {
      const r = await fetch(url + (url.includes('?') ? '&' : '?') + 'drawer=1', { credentials: 'same-origin', headers: { Accept: 'text/html' } });
      const target = new URL(r.url, location.origin);
      if (r.redirected && target.searchParams.get('drawer') !== '1') { location.href = r.url; return; }
      const html = await r.text();
      body.innerHTML = html;
      const root = body.firstElementChild;
      drawer.querySelector('.ahd__title').textContent = (root && root.dataset.ahdTitle) || (r.ok ? '' : 'Not available');
      drawer.querySelector('.ahd__sub').textContent = (root && root.dataset.ahdSub) || '';
      panel.classList.toggle('is-wide', !!(root && root.hasAttribute('data-ahd-wide')));
      if (!r.ok) return;
      initForms(body);
      phones(body);
      const first = body.querySelector('input:not([type=hidden]):not([disabled]), select, textarea');
      (first || panel).focus({ preventScroll: true });
    } catch (_e) {
      drawer.querySelector('.ahd__title').textContent = 'Could not open';
      body.innerHTML = '<p class="ahd-missing">Could not reach Managira. Check your connection and try again.</p>';
    }
  }

  // ---------- refresh the page in place ----------
  async function refreshPage() {
    const current = page();
    if (!current) { location.reload(); return; }
    try {
      const r = await fetch(location.pathname + location.search, { credentials: 'same-origin' });
      if (new URL(r.url).pathname !== location.pathname) { location.href = r.url; return; }
      const doc = new DOMParser().parseFromString(await r.text(), 'text/html');
      const fresh = doc.querySelector('.ah:not(.ah--float)');
      if (!fresh) { location.reload(); return; }
      const y = window.scrollY;
      current.innerHTML = fresh.innerHTML;
      current.querySelectorAll('.flash-wrapper').forEach((f) => f.remove());
      window.scrollTo(0, y);
      initPage();
    } catch (_e) {
      location.reload();
    }
  }

  // ---------- forms that save without leaving the page ----------
  async function submitAjax(form, submitter) {
    if (window.combinePhoneCountryCombos) { try { window.combinePhoneCountryCombos(form); } catch (_e) { /* optional */ } }
    const data = new FormData(form);
    if (submitter && submitter.name) data.append(submitter.name, submitter.value);
    const buttons = Array.from(form.querySelectorAll('button[type=submit]'));
    const inDrawer = drawer.contains(form);
    buttons.forEach((b) => { b.disabled = true; b.setAttribute('aria-busy', 'true'); });
    if (inDrawer) errorBox.hidden = true;
    try {
      const r = await fetch(form.action, {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'X-Admin-Ajax': '1', Accept: 'application/json' },
        body: new URLSearchParams(data),
      });
      let json = null;
      try { json = await r.json(); } catch (_e) { json = null; }
      if (!json) {
        if (r.redirected) { location.href = r.url; return; }
        throw new Error('bad response');
      }
      if (!json.success) {
        if (json.redirect && /\/account\/login|confirm-password/.test(json.redirect)) { location.href = json.redirect; return; }
        if (inDrawer) drawerFail(json.message || 'Could not save. Please check the form.');
        else toast(json.message || 'That did not work.', 'error');
        return;
      }
      if (inDrawer) closeDrawer();
      if (form.hasAttribute('data-ah-follow') && json.redirect && new URL(json.redirect, location.origin).pathname !== location.pathname) {
        toastAfterReload(json.message || 'Saved.');
        location.href = json.redirect;
        return;
      }
      toast(json.message || 'Saved.');
      await refreshPage();
    } catch (_e) {
      if (inDrawer) drawerFail('Could not reach Managira. Check your connection and try again.');
      else toast('Could not reach Managira. Check your connection and try again.', 'error');
    } finally {
      buttons.forEach((b) => { b.disabled = false; b.removeAttribute('aria-busy'); });
    }
  }

  document.addEventListener('submit', async (e) => {
    const form = e.target;
    if (!(form instanceof HTMLFormElement)) return;
    const inPage = page() && page().contains(form);
    const inDrawer = drawer.contains(form);
    if (!inDrawer && !(inPage && form.hasAttribute('data-ah-ajax'))) return;
    e.preventDefault();
    page() && page().querySelectorAll('.ah-menu[open]').forEach((m) => m.removeAttribute('open'));
    const ask = form.dataset.ahAsk;
    if (ask && !(await confirmBox({ title: 'Please confirm', text: ask, ok: form.dataset.ahAskOk || 'Yes, continue', danger: form.hasAttribute('data-ah-danger') }))) return;
    submitAjax(form, e.submitter);
  }, true);

  // ---------- clicks ----------
  // Window capture phase, so the page router never takes these links first.
  window.addEventListener('click', async (e) => {
    if (!page() && !drawer.contains(e.target)) return;
    if (e.metaKey || e.ctrlKey || e.shiftKey || e.button > 0) return;

    if (e.target.closest('[data-ahd-close]')) { e.preventDefault(); closeDrawer(); return; }

    const link = e.target.closest('[data-ah-drawer]');
    if (link) {
      e.preventDefault();
      e.stopPropagation();
      page() && page().querySelectorAll('.ah-menu[open]').forEach((m) => m.removeAttribute('open'));
      openDrawer(link.getAttribute('href') || link.dataset.ahDrawer);
      return;
    }

    // Opening a hub or a school: same check as the admin dashboard.
    const open = e.target.closest('[data-ah-open]');
    if (open && page() && page().contains(open)) {
      e.preventDefault();
      e.stopPropagation();
      const isHub = open.dataset.kind === 'hub';
      const ok = await confirmBox({
        title: `Open ${open.dataset.name || (isHub ? 'this hub' : 'this school')}?`,
        text: isHub
          ? 'You will see the hub exactly as its owner does. Use “Back to Admin” at the top to return.'
          : 'You will see the school’s dashboard as its admin. Use “Back to Admin” at the top to return.',
        ok: isHub ? 'Open hub' : 'Open school',
      });
      if (ok) location.href = open.getAttribute('href');
      return;
    }

    const copy = e.target.closest('[data-ah-copy]');
    if (copy) {
      const src = document.querySelector(copy.dataset.ahCopy || '[data-ah-copy-src]');
      if (!src) return;
      const value = src.value || src.textContent;
      (navigator.clipboard ? navigator.clipboard.writeText(value) : Promise.reject()).catch(() => { src.select && src.select(); document.execCommand('copy'); });
      const old = copy.innerHTML;
      copy.innerHTML = '<i class="fa-solid fa-check" aria-hidden="true"></i> Copied';
      setTimeout(() => { copy.innerHTML = old; }, 1600);
      return;
    }

    if (e.target.closest('[data-ah-pw-generate]')) {
      const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789';
      const bytes = new Uint32Array(12);
      crypto.getRandomValues(bytes);
      let out = Array.from(bytes, (b) => chars[b % chars.length]).join('');
      out = `${out.slice(0, 4)}-${out.slice(4, 8)}-${out.slice(8)}${bytes[0] % 10}`;
      const input = drawer.querySelector('[data-ah-pw-input]');
      if (input) input.value = out;
      return;
    }
    const pwCopy = e.target.closest('[data-ah-pw-copy]');
    if (pwCopy) {
      const input = drawer.querySelector('[data-ah-pw-input]');
      if (input && input.value && navigator.clipboard) navigator.clipboard.writeText(input.value).catch(() => {});
      return;
    }

    // People rows on the New hub form.
    if (e.target.closest('[data-ahp-add]')) {
      const form = e.target.closest('form');
      const rows = form.querySelector('[data-ahp-rows]');
      const tpl = form.querySelector('[data-ahp-template]');
      rows.appendChild(tpl.content.cloneNode(true));
      renumberPeople(rows);
      rows.lastElementChild.querySelector('input').focus();
      return;
    }
    const remove = e.target.closest('[data-ahp-remove]');
    if (remove) {
      const rows = remove.closest('[data-ahp-rows]');
      remove.closest('.ahp-row').remove();
      renumberPeople(rows);
    }
  }, true);

  function renumberPeople(rows) {
    rows.querySelectorAll('.ahp-row').forEach((row, i) => {
      row.querySelectorAll('[data-name]').forEach((el) => { el.name = `people[${i}][${el.getAttribute('data-name')}]`; });
    });
  }

  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !drawer.hidden && !document.querySelector('dialog[open]')) closeDrawer(); });
  document.addEventListener('click', (e) => {
    const p = page();
    if (!p) return;
    p.querySelectorAll('.ah-menu[open]').forEach((m) => { if (!m.contains(e.target)) m.removeAttribute('open'); });
  });

  // ---------- billing form (switch rows + live estimate) ----------
  const money = (n) => '$' + (Math.round(n * 100) / 100).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const num = (el) => { const n = parseFloat(String((el && el.value) || '').replace(/[,$\s]/g, '')); return Number.isFinite(n) && n > 0 ? n : 0; };

  function billingEstimate(root) {
    const q = (s) => root.querySelector(s);
    root.querySelectorAll('[data-ahb-row]').forEach((row) => {
      const on = row.querySelector('[data-ahb-toggle]').checked;
      row.classList.toggle('is-off', !on);
      row.querySelectorAll('[data-ahb-fields] input, [data-ahb-fields] select').forEach((el) => { el.disabled = !on; });
    });
    const disc = q('[data-ahb-disc]').value;
    root.querySelectorAll('[data-ahb-disc-only]').forEach((el) => { el.hidden = disc === 'none'; });
    q('[data-ahb-disc-cycles]').hidden = disc === 'none' || q('[data-ahb-disc-dur]').value !== 'repeating';
    q('[data-ahb-disc-label]').textContent = disc === 'amount' ? 'Amount ($)' : 'Percent (%)';
    q('[data-ahb-trial-date]').hidden = !q('[data-ahb-trial]').checked;

    let subtotal = 0;
    const parts = [];
    root.querySelectorAll('[data-ahb-meter]').forEach((toggle) => {
      if (!toggle.checked) return;
      const row = toggle.closest('[data-ahb-row]');
      const key = toggle.dataset.ahbMeter;
      const actual = Number(root.getAttribute(`data-${key === 'student' ? 'students' : key === 'employee' ? 'employees' : 'users'}`)) || 0;
      const included = Math.max(0, parseInt(row.querySelector('[data-ahb-included]').value, 10) || 0);
      const units = Math.max(actual, included);
      subtotal += num(row.querySelector('[data-ahb-price]')) * units;
      parts.push(`${units.toLocaleString('en-US')} ${key}s`);
    });
    const base = q('[data-ahb-base]');
    if (base && !base.disabled) subtotal += num(base);
    root.querySelectorAll('[data-ahb-int]').forEach((toggle) => {
      if (!toggle.checked) return;
      const row = toggle.closest('[data-ahb-row]');
      const auto = row.querySelector('input[value="auto"]').checked;
      const schools = Number(root.getAttribute(`data-int-${toggle.dataset.ahbInt}`)) || 0;
      if (auto && schools) subtotal += num(row.querySelector('input[name$="[price]"]')) * schools;
    });
    const extras = Number(root.getAttribute('data-extras')) || 0;
    subtotal += extras;
    const dv = num(q('[data-ahb-disc-value]'));
    const off = disc === 'percent' ? subtotal * Math.min(100, dv) / 100 : disc === 'amount' ? Math.min(subtotal, dv) : 0;
    const cycle = q('[data-ahb-cycle]');
    q('[data-ahb-total]').textContent = `${money(subtotal - off)} / ${cycle.options[cycle.selectedIndex].getAttribute('data-per')}`;
    if (extras > 0) parts.push(`${money(extras)} of approved extras`);
    if (off > 0) parts.push(`${money(off)} discount`);
    q('[data-ahb-note]').textContent = parts.length ? parts.join(' · ') + '.' : 'Switch on at least one charge.';
  }

  function chargePick(form) {
    const pick = form.querySelector('[data-ah-charge-pick]');
    if (!pick) return;
    const custom = !pick.value;
    form.querySelectorAll('[data-ah-custom]').forEach((el) => {
      el.hidden = !custom;
      el.querySelectorAll('input, select').forEach((i) => { i.disabled = !custom; });
    });
  }
  function holdWhen(form) {
    const later = form.querySelector('[data-ah-hold-when]:checked');
    const box = form.querySelector('[data-ah-hold-later]');
    if (later && box) box.hidden = later.value !== 'later';
  }

  function initForms(root) {
    root.querySelectorAll('[data-ahb]').forEach(billingEstimate);
    root.querySelectorAll('[data-ah-charge]').forEach(chargePick);
    root.querySelectorAll('[data-ah-hold]').forEach(holdWhen);
  }
  document.addEventListener('input', (e) => { const root = e.target.closest('[data-ahb]'); if (root) billingEstimate(root); });
  document.addEventListener('change', (e) => {
    const root = e.target.closest('[data-ahb]');
    if (root) billingEstimate(root);
    const charge = e.target.closest('[data-ah-charge]');
    if (charge) chargePick(charge);
    const hold = e.target.closest('[data-ah-hold]');
    if (hold) holdWhen(hold);
  });

  // ---------- page bits ----------
  function initPage() {
    const p = page();
    if (!p) return;
    const filter = p.querySelector('[data-ah-filter]');
    if (filter && !filter.dataset.ready) {
      filter.dataset.ready = '1';
      filter.addEventListener('input', () => {
        const qv = filter.value.trim().toLowerCase();
        let shown = 0;
        p.querySelectorAll('[data-ah-row]').forEach((r) => { const hit = !qv || r.dataset.ahRow.includes(qv); r.hidden = !hit; if (hit) shown += 1; });
        const none = p.querySelector('[data-ah-noresults]');
        if (none) none.hidden = shown > 0;
      });
    }
    initForms(p);
  }

  function init() {
    pendingToast();
    initPage();
    // ?drawer=/admin/... opens that form (links from emails or old pages).
    const params = new URLSearchParams(location.search);
    const want = params.get('drawer');
    if (want && /^\/admin\//.test(want) && page()) {
      params.delete('drawer');
      history.replaceState(null, '', location.pathname + (params.toString() ? `?${params}` : '') + location.hash);
      openDrawer(want);
    }
  }

  window.__ahHubs = { init, openDrawer, closeDrawer, toast, confirmBox, refreshPage };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
