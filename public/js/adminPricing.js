// Admin › Pricing and Organizations (views/admin/pricing.ejs, organizations.ejs): tabs that keep
// their place in the address (?tab=), so a save that refreshes the page in place
// (public/js/adminHubs.js) stays on its tab; the country picker's search in the price-list
// panel; and the live preview in a school's pricing panel. Delegated, so it works for panels
// loaded later and is safe to load more than once.
(function () {
  if (window.__apPricing) return;
  window.__apPricing = true;

  const money = (n) => '$' + (Math.round((Number(n) || 0) * 100) / 100).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const num = (el) => {
    const v = Number(String((el && el.value) || '').replace(/[$,%\s]/g, ''));
    return Number.isFinite(v) ? v : 0;
  };

  // ---------- tabs
  document.addEventListener('click', (e) => {
    const tab = e.target.closest('[data-ap-tab]');
    if (!tab) return;
    const root = tab.closest('.ap');
    if (!root) return;
    const key = tab.getAttribute('data-ap-tab');
    root.querySelectorAll('[data-ap-tab]').forEach((t) => {
      const isOn = t === tab;
      t.classList.toggle('is-on', isOn);
      t.setAttribute('aria-selected', String(isOn));
    });
    root.querySelectorAll('[data-ap-panel]').forEach((p) => { p.hidden = p.getAttribute('data-ap-panel') !== key; });
    const url = new URL(location.href);
    url.searchParams.set('tab', key);
    history.replaceState(history.state, '', url);
  });

  // ---------- countries: search, and a count of those chosen
  function countCountries(form) {
    const out = form.querySelector('[data-ap-country-count]');
    if (out) out.textContent = String(form.querySelectorAll('input[name="countries"]:checked').length);
  }
  document.addEventListener('input', (e) => {
    const search = e.target.closest('[data-ap-country-search]');
    if (search) {
      const q = search.value.trim().toLowerCase();
      const form = search.closest('form');
      form.querySelectorAll('[data-ap-country]').forEach((item) => {
        item.hidden = q && !item.getAttribute('data-ap-country').includes(q);
      });
      form.querySelectorAll('[data-ap-continent]').forEach((group) => {
        group.hidden = !group.querySelector('[data-ap-country]:not([hidden])');
      });
      return;
    }
    const pricing = e.target.closest('[data-ap-school-pricing]');
    if (pricing) preview(pricing);
  });
  document.addEventListener('change', (e) => {
    if (e.target.matches('input[name="countries"]')) countCountries(e.target.closest('form'));
    const pricing = e.target.closest('[data-ap-school-pricing]');
    if (pricing) preview(pricing);
  });

  // ---------- a school's pricing: what each bill comes to with the values in the form
  function preview(form) {
    const standard = Number(form.getAttribute('data-standard')) || 0;
    const months = Number(form.getAttribute('data-months')) || 1;
    const cycleOff = Number(form.getAttribute('data-cycle-discount')) || 0;
    const released = form.getAttribute('data-released') === '1';
    const own = form.querySelector('[name="monthlyPrice"]');
    const base = own && String(own.value).trim() ? num(own) : standard;
    const discount = Math.min(Number(form.getAttribute('data-max-discount')) || 90, Math.max(0, num(form.querySelector('[name="discountPercent"]'))));
    const plan = Math.round(base * (1 - discount / 100) * 100) / 100;
    let addons = 0;
    form.querySelectorAll('[data-ap-addon]').forEach((row) => {
      const mode = (row.querySelector('input[type=radio]:checked') || {}).value || 'standard';
      const field = row.querySelector('[data-ap-addon-price]');
      field.hidden = mode !== 'own';
      const qty = Number(row.getAttribute('data-qty')) || 0;
      const price = mode === 'free' ? 0 : mode === 'own' ? num(field.querySelector('input')) : Number(row.getAttribute('data-standard')) || 0;
      const amount = Math.round(price * qty * 100) / 100;
      const out = row.querySelector('[data-ap-addon-amount]');
      if (out) out.textContent = qty ? `${money(amount)} a month` : (row.getAttribute('data-note') || 'Not used');
      addons += amount;
    });
    const charged = released ? addons : 0;
    const bill = plan * months * (1 - cycleOff / 100) + charged * months;
    const set = (sel, text) => { const el = form.querySelector(sel); if (el) el.textContent = text; };
    set('[data-ap-plan-monthly]', `${money(plan)} a month`);
    set('[data-ap-addons-monthly]', released ? `${money(addons)} a month` : `${money(addons)} a month, not charged yet`);
    set('[data-ap-bill]', money(bill));
  }
  // The side panel fills in after this script runs: preview once its form appears.
  new MutationObserver(() => {
    document.querySelectorAll('[data-ap-school-pricing]:not([data-ap-ready])').forEach((form) => {
      form.setAttribute('data-ap-ready', '');
      preview(form);
    });
  }).observe(document.body, { childList: true, subtree: true });
})();
