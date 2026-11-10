// The parent / guardian contact card, shared by the Mail Room and Parents & guardians
// (styles in public/css/contactCard.css). Base details, the school's own parent fields in
// their sections (Admissions > Admission Settings), and the children. With "Edit Contacts"
// (or Manage Guardians) every field is editable in place; Save lights up once something changes.
//
//   const card = ManagiraContactCard.create(boxElement, { templateUrl, onClose, onSaved });
//   card.open({ keys: ['profile:12'], guardianName: 'Jane Doe' });
//   card.requestClose();   // asks first when there are unsaved changes
(function () {
  if (window.ManagiraContactCard) return;

  const AVATAR_COLORS = ['#7c5cf0', '#0ea5e9', '#0f9f8f', '#f97316', '#e0457b', '#5b6ee8', '#16a34a', '#c2410c'];
  const escapeHtml = (v) => String(v == null ? '' : v).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  const initials = (name) => String(name || '?').split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0].toUpperCase()).join('') || '?';
  const avatarColor = (name) => AVATAR_COLORS[[...String(name || '')].reduce((n, ch) => (n * 31 + ch.charCodeAt(0)) >>> 0, 7) % AVATAR_COLORS.length];
  const cardSvg = (d) => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${d}</svg>`;
  const ICON = {
    info: cardSvg('<rect x="3" y="5" width="18" height="14" rx="2"/><circle cx="9" cy="11" r="2.2"/><path d="M5.8 16c.6-1.5 1.8-2.3 3.2-2.3s2.6.8 3.2 2.3M15 10h3M15 14h3"/>'),
    kids: cardSvg('<circle cx="9" cy="8" r="3.2"/><path d="M3 20c0-3.3 2.7-6 6-6s6 2.7 6 6"/><circle cx="17" cy="9" r="2.4"/><path d="M21 19c0-2.4-1.6-4.3-4-4.8"/>'),
    section: cardSvg('<path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2Z"/>'),
    user: cardSvg('<circle cx="12" cy="8" r="4"/><path d="M4 21c0-4.4 3.6-8 8-8s8 3.6 8 8"/>'),
    phone: cardSvg('<path d="M22 16.9v3a2 2 0 0 1-2.2 2 19.8 19.8 0 0 1-8.6-3.1 19.5 19.5 0 0 1-6-6A19.8 19.8 0 0 1 2.1 4.2 2 2 0 0 1 4.1 2h3a2 2 0 0 1 2 1.7c.1.9.4 1.8.7 2.7a2 2 0 0 1-.5 2.1L8 9.8a16 16 0 0 0 6 6l1.3-1.3a2 2 0 0 1 2.1-.4c.9.3 1.8.6 2.7.7a2 2 0 0 1 1.7 2Z"/>'),
    mail: cardSvg('<rect x="2" y="4" width="20" height="16" rx="2"/><path d="m22 7-10 6L2 7"/>'),
    pin: cardSvg('<path d="M12 21s-7-6.1-7-11a7 7 0 0 1 14 0c0 4.9-7 11-7 11Z"/><circle cx="12" cy="10" r="2.5"/>'),
    pen: cardSvg('<path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z"/>'),
  };

  function create(box, options = {}) {
    const templateUrl = options.templateUrl || '/common/admissions?panel=online-admission-settings&page=%2Fcommon%2FadmissionSettings%3Ftab%3Dfamily&label=Admission%20Settings';
    const state = { contact: null, data: null, tab: 'info', initial: '', saving: false };
    box.classList.add('cc-card');

    function tabsOf(d) {
      const tabs = [{ id: 'info', label: 'Contact info', icon: ICON.info }, { id: 'kids', label: 'Children', icon: ICON.kids, count: d.students.length }];
      d.sections.forEach((s) => {
        if (d.fields.some((f) => f.sectionId === s.id)) tabs.push({ id: `s${s.id}`, label: s.name, icon: ICON.section });
      });
      if (d.fields.some((f) => !f.sectionId)) tabs.push({ id: 's0', label: 'More details', icon: ICON.section });
      return tabs;
    }

    function baseField(name, label, value, opts = {}) {
      return `<label class="cc-field ${opts.wide ? 'is-wide' : ''}"><span>${label}${opts.required ? ' <i>*</i>' : ''}</span><input name="${name}" value="${escapeHtml(value)}" autocomplete="off" ${opts.attrs || ''}></label>`;
    }

    function customField(f) {
      const name = `field-${f.id}`;
      const v = escapeHtml(f.value);
      let control;
      if (f.type === 'long_text') control = `<textarea name="${name}" maxlength="4000">${v}</textarea>`;
      else if (f.type === 'number') control = `<input name="${name}" inputmode="decimal" value="${v}" autocomplete="off">`;
      else if (f.type === 'date') control = `<input type="date" name="${name}" value="${v}">`;
      else if (f.type === 'choice') control = `<select name="${name}"><option value="">Not set</option>${f.options.map((o) => `<option ${o === f.value ? 'selected' : ''}>${escapeHtml(o)}</option>`).join('')}${f.value && !f.options.includes(f.value) ? `<option selected>${v}</option>` : ''}</select>`;
      else if (f.type === 'yes_no') control = `<select name="${name}"><option value="">Not set</option><option value="yes" ${f.value === 'yes' ? 'selected' : ''}>Yes</option><option value="no" ${f.value === 'no' ? 'selected' : ''}>No</option></select>`;
      else control = `<input name="${name}" maxlength="500" value="${v}" autocomplete="off">`;
      // Obsolete fields keep their saved answer but can't be changed; nothing changes without edit rights.
      if (f.obsolete || !state.data.canEdit) control = control.replace(/^<(input|textarea|select)/, '<$1 disabled');
      if (!state.data.canEdit && !f.value) control = '<input disabled placeholder="Not added">';
      return `<label class="cc-field ${f.type === 'long_text' ? 'is-wide' : ''} ${f.obsolete ? 'cc-obsolete' : ''}"><span>${escapeHtml(f.label)}</span>${control}${f.helpText ? `<small>${escapeHtml(f.helpText)}</small>` : ''}</label>`;
    }

    function cardHtml() {
      const { data: d, canEdit, canEditTemplate } = state.data;
      const b = d.base;
      const name = `${b.firstName} ${b.lastName}`.trim();
      const tabs = tabsOf(d);
      if (!tabs.some((t) => t.id === state.tab)) state.tab = 'info';
      const ro = canEdit ? '' : 'readonly';
      const kidNames = d.students.map((k) => k.name.split(' ')[0]);
      const panel = (id, html) => `<div class="cc-panel ${state.tab === id ? 'is-on' : ''}" data-panel="${id}" role="tabpanel">${html}</div>`;
      const sectionPanel = (id) => `<div class="cc-box"><div class="cc-grid cc-grid--2">${d.fields.filter((f) => (f.sectionId || 0) === id).map(customField).join('')}</div></div>`;
      const telHref = b.phone ? `tel:${b.phone.replace(/[^\d+]/g, '')}` : '#';
      const mailHref = b.email ? `mailto:${b.email}` : '#';
      return `
        <div class="cc-head">
          <div class="cc-avatar" style="--av:${avatarColor(name)}">${b.imageUrl ? `<img src="${escapeHtml(b.imageUrl)}" alt="">` : escapeHtml(initials(name))}</div>
          <div class="cc-id">
            <h3 id="ccName">${escapeHtml(name)}</h3>
            <div class="cc-meta">
              <span class="cc-pill">${ICON.user}Parent / guardian</span>
              ${kidNames.length ? `<span class="cc-pill cc-pill--plain">Parent of ${escapeHtml(kidNames.slice(0, 3).join(', '))}${kidNames.length > 3 ? ` +${kidNames.length - 3}` : ''}</span>` : ''}
            </div>
          </div>
          <div class="cc-actions">
            ${canEditTemplate ? `<a class="cc-btn" href="${templateUrl}" data-no-spa data-card-template title="Change the fields every parent's card has">${ICON.pen}Edit fields</a>` : ''}
            <button type="button" class="cc-btn" data-card-close>Close</button>
            ${canEdit ? '<button type="button" class="cc-btn cc-btn--primary" data-card-save disabled>Save</button>' : ''}
          </div>
        </div>
        <nav class="cc-tabs" role="tablist">
          ${tabs.map((t) => `<button type="button" class="cc-tab ${state.tab === t.id ? 'is-on' : ''}" role="tab" aria-selected="${state.tab === t.id}" data-tab="${t.id}">${t.icon}${escapeHtml(t.label)}${t.count != null ? `<b>${t.count}</b>` : ''}</button>`).join('')}
        </nav>
        <form class="cc-body ${canEdit ? '' : 'is-readonly'}" data-card-form novalidate>
          ${panel('info', `
            <div class="cc-box">
              <h4>${ICON.user}Name</h4>
              <div class="cc-grid">
                ${baseField('firstName', 'First name', b.firstName, { required: true, attrs: `maxlength="100" ${ro}` })}
                ${baseField('lastName', 'Last name', b.lastName, { required: true, attrs: `maxlength="100" ${ro}` })}
                ${baseField('dateOfBirth', 'Date of birth', b.dateOfBirth, { attrs: canEdit || b.dateOfBirth ? `type="date" ${ro}` : 'readonly placeholder="Not added"' })}
              </div>
            </div>
            <div class="cc-row2">
              <div class="cc-box">
                <h4>${ICON.phone}Phone</h4>
                <label class="cc-field"><span>Phone number</span><div class="cc-with-action"><input name="phone" type="tel" maxlength="40" value="${escapeHtml(b.phone)}" placeholder="Enter a phone number" autocomplete="off" ${ro}><a class="cc-icon-link" href="${escapeHtml(telHref)}" title="Call" aria-label="Call" ${b.phone ? '' : 'aria-disabled="true"'}>${ICON.phone}</a></div></label>
              </div>
              <div class="cc-box">
                <h4>${ICON.mail}Email</h4>
                <label class="cc-field"><span>Email address</span><div class="cc-with-action"><input name="email" type="email" maxlength="160" value="${escapeHtml(b.email)}" placeholder="Enter an email address" autocomplete="off" ${ro}><a class="cc-icon-link" href="${escapeHtml(mailHref)}" title="Send email" aria-label="Send email" ${b.email ? '' : 'aria-disabled="true"'}>${ICON.mail}</a></div></label>
              </div>
            </div>
            <div class="cc-box">
              <h4>${ICON.pin}Address</h4>
              <div class="cc-grid cc-grid--2">
                ${baseField('address', 'Street address', b.address, { wide: true, attrs: `maxlength="300" placeholder="Street, city, state, zip" ${ro}` })}
                ${baseField('hometown', 'Hometown', b.hometown, { attrs: `maxlength="120" ${ro}` })}
              </div>
            </div>
            ${!d.fields.length && canEditTemplate ? `<p class="cc-empty" style="padding:14px">Keep more details for every family: <a href="${templateUrl}" data-no-spa data-card-template>add parent fields</a>.</p>` : ''}`)}
          ${panel('kids', d.students.length
            ? `<div class="cc-kids">${d.students.map((k) => `<div class="cc-kid"><span class="cc-kid__av">${escapeHtml(initials(k.name))}</span><div><strong>${escapeHtml(k.name)}</strong><span>${escapeHtml([k.className, k.relationship].filter(Boolean).join(' · ') || 'Student')}</span></div></div>`).join('')}</div>`
            : '<div class="cc-empty">No children are linked to this contact.</div>')}
          ${d.sections.map((s) => (d.fields.some((f) => f.sectionId === s.id) ? panel(`s${s.id}`, sectionPanel(s.id)) : '')).join('')}
          ${d.fields.some((f) => !f.sectionId) ? panel('s0', sectionPanel(0)) : ''}
        </form>
        <p class="cc-status" data-card-status role="status"></p>`;
    }

    function values() {
      const form = box.querySelector('[data-card-form]');
      if (!form) return null;
      const get = (n) => ((form.querySelector(`[name="${n}"]`) || {}).value || '').trim();
      const base = {};
      ['firstName', 'lastName', 'phone', 'email', 'address', 'hometown', 'dateOfBirth'].forEach((k) => { base[k] = get(k); });
      const fields = {};
      state.data.data.fields.filter((f) => !f.obsolete).forEach((f) => { fields[f.id] = get(`field-${f.id}`); });
      return { base, fields };
    }
    const isDirty = () => Boolean(state.data && state.data.canEdit && JSON.stringify(values()) !== state.initial);

    function setStatus(text, tone) {
      const el = box.querySelector('[data-card-status]');
      if (!el) return;
      el.textContent = text || '';
      el.className = `cc-status ${tone ? `is-${tone}` : ''}`;
    }

    function render() {
      if (!state.data) {
        const name = state.contact.guardianName || '';
        box.innerHTML = `<div class="cc-head" style="padding-bottom:20px"><div class="cc-avatar" style="--av:${avatarColor(name)}">${escapeHtml(initials(name))}</div><div class="cc-id"><h3 id="ccName">${escapeHtml(name)}</h3></div><div class="cc-actions"><button type="button" class="cc-btn" data-card-close>Close</button></div></div><div class="cc-loading">Loading contact…</div>`;
        return;
      }
      box.innerHTML = cardHtml();
      state.initial = JSON.stringify(values());
    }

    function showTab(id) {
      state.tab = id;
      box.querySelectorAll('[data-tab]').forEach((t) => { const on = t.dataset.tab === id; t.classList.toggle('is-on', on); t.setAttribute('aria-selected', on); });
      box.querySelectorAll('[data-panel]').forEach((p) => p.classList.toggle('is-on', p.dataset.panel === id));
    }

    async function open(contact) {
      state.contact = contact;
      state.data = null;
      state.tab = 'info';
      render();
      try {
        const res = await fetch('/common/contacts/card?keys=' + encodeURIComponent(contact.keys.join(',')), { credentials: 'same-origin', headers: { Accept: 'application/json' } });
        const out = await res.json().catch(() => ({}));
        if (state.contact !== contact) return;
        if (!res.ok || !out.success) throw new Error(out.error || 'This contact could not be loaded.');
        state.data = { data: out.contact, canEdit: out.canEdit, canEditTemplate: out.canEditTemplate };
        render();
      } catch (err) {
        if (state.contact !== contact) return;
        const loading = box.querySelector('.cc-loading');
        if (loading) loading.textContent = err.message;
      }
    }

    function requestClose() {
      if (isDirty() && !window.confirm('Discard the changes to this contact?')) return false;
      state.contact = null;
      state.data = null;
      if (options.onClose) options.onClose();
      return true;
    }

    async function save() {
      if (state.saving || !isDirty()) return;
      const v = values();
      if (!v.base.firstName || !v.base.lastName) { showTab('info'); setStatus('First and last name are required.', 'error'); return; }
      if (!v.base.phone && !v.base.email) { showTab('info'); setStatus('Add a phone number or an email address.', 'error'); return; }
      const btn = box.querySelector('[data-card-save]');
      state.saving = true;
      btn.disabled = true;
      btn.textContent = 'Saving…';
      setStatus('');
      try {
        const res = await fetch('/common/contacts/card', {
          method: 'POST', credentials: 'same-origin',
          headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
          body: JSON.stringify({ keys: state.contact.keys, ...v }),
        });
        const out = await res.json().catch(() => ({}));
        if (!res.ok || !out.success) throw new Error(out.error || 'The contact could not be saved.');
        state.data = { data: out.contact, canEdit: out.canEdit, canEditTemplate: out.canEditTemplate };
        const contact = state.contact;
        render();
        setStatus('Saved', 'ok');
        if (options.onSaved) options.onSaved(contact, out.contact);
      } catch (err) {
        setStatus(err.message, 'error');
        btn.disabled = false;
        btn.textContent = 'Save';
      } finally {
        state.saving = false;
      }
    }

    box.addEventListener('click', (e) => {
      if (e.target.closest('[data-card-close]')) { requestClose(); return; }
      if (e.target.closest('[data-card-template]') && isDirty() && !window.confirm('Leave without saving the changes to this contact?')) { e.preventDefault(); return; }
      const tab = e.target.closest('[data-tab]');
      if (tab) { showTab(tab.dataset.tab); return; }
      if (e.target.closest('[data-card-save]')) save();
    });
    // Save lights up as soon as anything changes.
    ['input', 'change'].forEach((type) => box.addEventListener(type, () => {
      const btn = box.querySelector('[data-card-save]');
      if (!btn || state.saving) return;
      btn.disabled = !isDirty();
      if (!btn.disabled) setStatus('');
    }));
    box.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && e.target.matches('[data-card-form] input')) { e.preventDefault(); save(); }
    });

    return { open, requestClose, isDirty, isOpen: () => Boolean(state.contact) };
  }

  window.ManagiraContactCard = { create };
})();
