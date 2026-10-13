// Shared calendar/task UI: create dialog (event / announcement / task), people
// picker, @mention autocomplete and a toast. Exposes window.Workspace.
// Used by views/common/calendar.ejs and views/common/orgDashboard.ejs.
(function () {
  if (window.Workspace) return;

  const esc = (v) => String(v == null ? '' : v).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const initials = (name) => String(name || '?').split(/\s+/).filter(Boolean).slice(0, 2).map((p) => p[0]).join('').toUpperCase() || '?';
  const avatar = (p, cls) => `<span class="ws-avatar ${cls || ''}">${p.image ? `<img src="${esc(p.image)}" alt="">` : esc(initials(p.name))}</span>`;
  const pad = (n) => String(n).padStart(2, '0');
  const dateKey = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  const timeKey = (d) => `${pad(d.getHours())}:${pad(d.getMinutes())}`;

  // ---------- data ----------
  let staffPromise = null;
  function loadStaff() {
    if (!staffPromise) {
      staffPromise = fetch('/common/workspace/staff', { credentials: 'same-origin', headers: { Accept: 'application/json' } })
        .then((r) => (r.ok ? r.json() : []))
        .catch(() => []);
    }
    return staffPromise;
  }

  async function post(url, body) {
    const r = await fetch(url, {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify(body || {}),
    });
    let data = {};
    try { data = await r.json(); } catch (_e) { /* ignore */ }
    if (!r.ok || data.success === false) throw new Error(data.error || 'Something went wrong. Please try again.');
    return data;
  }

  // ---------- toast ----------
  let toastTimer = null;
  function toast(message) {
    let el = document.querySelector('.ws-toast');
    if (!el) { el = document.createElement('div'); el.className = 'ws-toast'; el.setAttribute('role', 'status'); document.body.appendChild(el); }
    el.textContent = message;
    el.classList.add('is-on');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => el.classList.remove('is-on'), 2600);
  }

  // ---------- people picker ----------
  // container: .ws-people element. Returns { get(), set(ids), add(person) }.
  function peoplePicker(container, { placeholder, onChange } = {}) {
    const selected = new Map();
    container.innerHTML = `<input type="text" autocomplete="off" placeholder="${esc(placeholder || 'Add people…')}" aria-label="${esc(placeholder || 'Add people')}"><div class="ws-menu" hidden role="listbox"></div>`;
    const input = container.querySelector('input');
    const menu = container.querySelector('.ws-menu');
    let active = 0;
    let matches = [];

    function renderChips() {
      container.querySelectorAll('.ws-chip').forEach((c) => c.remove());
      selected.forEach((p) => {
        const chip = document.createElement('span');
        chip.className = 'ws-chip';
        chip.dataset.id = p.id;
        chip.innerHTML = `${avatar(p)}${esc(p.name)}<button type="button" aria-label="Remove ${esc(p.name)}">×</button>`;
        container.insertBefore(chip, input);
      });
      if (onChange) onChange([...selected.keys()]);
    }
    async function search() {
      const staff = await loadStaff();
      const q = input.value.trim().toLowerCase();
      matches = staff.filter((p) => !selected.has(p.id) && (!q || p.name.toLowerCase().includes(q))).slice(0, 8);
      active = 0;
      menu.innerHTML = matches.length
        ? matches.map((p, i) => `<div class="ws-menu__item${i === 0 ? ' is-active' : ''}" data-id="${p.id}" role="option">${avatar(p)}${esc(p.name)}${p.me ? ' (you)' : ''}<small>${esc(p.role)}</small></div>`).join('')
        : `<div class="ws-menu__empty">${staff.length ? 'No one matches' : 'No staff found'}</div>`;
      menu.hidden = false;
    }
    function pick(id) {
      loadStaff().then((staff) => {
        const p = staff.find((x) => x.id === Number(id));
        if (p) { selected.set(p.id, p); renderChips(); }
        input.value = '';
        menu.hidden = true;
        input.focus();
      });
    }
    container.addEventListener('click', (e) => {
      const remove = e.target.closest('.ws-chip button');
      if (remove) { selected.delete(Number(remove.parentElement.dataset.id)); renderChips(); return; }
      const item = e.target.closest('.ws-menu__item');
      if (item) { pick(item.dataset.id); return; }
      input.focus();
    });
    input.addEventListener('focus', search);
    input.addEventListener('input', search);
    input.addEventListener('keydown', (e) => {
      const items = menu.querySelectorAll('.ws-menu__item');
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault();
        if (!items.length) return;
        active = (active + (e.key === 'ArrowDown' ? 1 : items.length - 1)) % items.length;
        items.forEach((el, i) => el.classList.toggle('is-active', i === active));
      } else if (e.key === 'Enter') {
        if (!menu.hidden && items[active]) { e.preventDefault(); pick(items[active].dataset.id); }
      } else if (e.key === 'Backspace' && !input.value && selected.size) {
        selected.delete([...selected.keys()].pop()); renderChips();
      } else if (e.key === 'Escape') {
        if (!menu.hidden) { e.stopPropagation(); menu.hidden = true; }
      }
    });
    document.addEventListener('click', (e) => { if (!container.contains(e.target)) menu.hidden = true; });

    return {
      get: () => [...selected.keys()],
      add: (p) => { if (p && !selected.has(p.id)) { selected.set(p.id, p); renderChips(); } },
      set: async (ids) => {
        const staff = await loadStaff();
        selected.clear();
        (ids || []).forEach((id) => { const p = staff.find((x) => x.id === Number(id)); if (p) selected.set(p.id, p); });
        renderChips();
      },
    };
  }

  // ---------- @mentions in a textarea ----------
  function mentionInput(textarea, { onMention } = {}) {
    const wrap = textarea.parentElement;
    wrap.classList.add('ws-mention-wrap');
    const menu = document.createElement('div');
    menu.className = 'ws-menu';
    menu.hidden = true;
    wrap.appendChild(menu);
    let state = null; // { start, query, matches, active }

    function close() { menu.hidden = true; state = null; }
    async function update() {
      const pos = textarea.selectionStart;
      const before = textarea.value.slice(0, pos);
      const m = before.match(/(^|\s)@([\w.'-]{0,30})$/);
      if (!m) return close();
      const staff = await loadStaff();
      const q = m[2].toLowerCase();
      const matches = staff.filter((p) => p.name.toLowerCase().split(/\s+/).some((part) => part.startsWith(q)) || p.name.toLowerCase().startsWith(q)).slice(0, 6);
      state = { start: pos - m[2].length - 1, matches, active: 0 };
      menu.innerHTML = matches.length
        ? matches.map((p, i) => `<div class="ws-menu__item${i === 0 ? ' is-active' : ''}" data-id="${p.id}">${avatar(p)}${esc(p.name)}<small>${esc(p.role)}</small></div>`).join('')
        : '<div class="ws-menu__empty">No one matches</div>';
      menu.hidden = false;
    }
    function choose(id) {
      if (!state) return;
      const p = state.matches.find((x) => x.id === Number(id));
      if (!p) return close();
      const pos = textarea.selectionStart;
      const insert = `@${p.name} `;
      textarea.value = textarea.value.slice(0, state.start) + insert + textarea.value.slice(pos);
      const caret = state.start + insert.length;
      textarea.setSelectionRange(caret, caret);
      close();
      textarea.focus();
      if (onMention) onMention(p);
    }
    textarea.addEventListener('input', update);
    textarea.addEventListener('click', update);
    textarea.addEventListener('keydown', (e) => {
      if (menu.hidden || !state || !state.matches.length) return;
      const items = menu.querySelectorAll('.ws-menu__item');
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault();
        state.active = (state.active + (e.key === 'ArrowDown' ? 1 : items.length - 1)) % items.length;
        items.forEach((el, i) => el.classList.toggle('is-active', i === state.active));
      } else if (e.key === 'Enter' || e.key === 'Tab') {
        e.preventDefault();
        choose(items[state.active].dataset.id);
      } else if (e.key === 'Escape') {
        e.stopPropagation();
        close();
      }
    });
    menu.addEventListener('mousedown', (e) => {
      const item = e.target.closest('.ws-menu__item');
      if (item) { e.preventDefault(); choose(item.dataset.id); }
    });
    textarea.addEventListener('blur', () => setTimeout(close, 150));
  }

  // ---------- create / edit dialog ----------
  const COLORS = ['teal', 'blue', 'violet', 'amber', 'rose', 'green', 'slate'];
  let dialog = null;
  let pickers = {};
  let current = {};

  function buildDialog() {
    dialog = document.createElement('dialog');
    dialog.className = 'ws-dialog';
    dialog.setAttribute('aria-labelledby', 'ws-dialog-title');
    dialog.innerHTML = `
      <form method="dialog" novalidate>
        <div class="ws-dialog__head">
          <h2 class="ws-dialog__title" id="ws-dialog-title">Create</h2>
          <button type="button" class="ws-close" data-ws-close aria-label="Close">×</button>
        </div>
        <div class="ws-tabs" role="tablist">
          <button type="button" class="ws-tab" data-ws-tab="event" role="tab"><i class="fa-regular fa-calendar"></i> Event</button>
          <button type="button" class="ws-tab" data-ws-tab="announcement" role="tab"><i class="fa-solid fa-bullhorn"></i> Announcement</button>
          <button type="button" class="ws-tab" data-ws-tab="task" role="tab"><i class="fa-regular fa-square-check"></i> Task</button>
        </div>
        <div class="ws-dialog__body">
          <div class="ws-pane" data-ws-pane="event">
            <input class="ws-input ws-input--title" name="ev_title" placeholder="Add a title" maxlength="200" aria-label="Event title">
            <div class="ws-inline">
              <label class="ws-check"><input type="checkbox" name="ev_allday" checked> All day</label>
            </div>
            <div class="ws-row">
              <div class="ws-field"><label class="ws-label" for="ws-ev-date">Starts</label><input class="ws-input" type="date" id="ws-ev-date" name="ev_date"></div>
              <div class="ws-field" data-ws-time><label class="ws-label" for="ws-ev-start">Start time</label><input class="ws-input" type="time" id="ws-ev-start" name="ev_start" step="300"></div>
            </div>
            <div class="ws-row">
              <div class="ws-field"><label class="ws-label" for="ws-ev-enddate">Ends</label><input class="ws-input" type="date" id="ws-ev-enddate" name="ev_enddate"></div>
              <div class="ws-field" data-ws-time><label class="ws-label" for="ws-ev-end">End time</label><input class="ws-input" type="time" id="ws-ev-end" name="ev_end" step="300"></div>
            </div>
            <div class="ws-field"><label class="ws-label" for="ws-ev-loc">Location</label><input class="ws-input" id="ws-ev-loc" name="ev_location" placeholder="e.g. School hall" maxlength="200"></div>
            <div class="ws-field"><label class="ws-label" for="ws-ev-details">Details</label><textarea class="ws-textarea" id="ws-ev-details" name="ev_details" placeholder="What should people know?"></textarea></div>
            <div class="ws-field"><span class="ws-label">Tag people</span><div class="ws-people" data-ws-people="event"></div><span class="ws-hint">Tagged staff get a notification and an email, and it shows on their dashboard and calendar.</span></div>
            <div class="ws-row">
              <div class="ws-field"><label class="ws-label" for="ws-ev-vis">Who can see it</label>
                <select class="ws-select" id="ws-ev-vis" name="ev_visibility" data-ws-visibility></select></div>
              <div class="ws-field"><span class="ws-label">Colour</span>
                <div class="ws-colors">${COLORS.map((c) => `<label class="ws-color" title="${c}"><input type="radio" name="ev_color" value="${c}"><span class="ws-swatch--${c}"></span></label>`).join('')}</div></div>
            </div>
            <label class="ws-check" data-ws-notify-row><input type="checkbox" name="ev_notify"> Also email parents and staff about this event</label>
          </div>

          <div class="ws-pane" data-ws-pane="announcement" hidden>
            <div class="ws-field"><label class="ws-label" for="ws-an-msg">Announcement</label><textarea class="ws-textarea" id="ws-an-msg" name="an_message" rows="6" placeholder="Write the announcement…"></textarea><span class="ws-hint">It's posted right away and shows on everyone's dashboard.</span></div>
            <div class="ws-field"><label class="ws-label" for="ws-an-vis">Who can see it</label><select class="ws-select" id="ws-an-vis" name="an_visibility" data-ws-visibility></select></div>
            <label class="ws-check"><input type="checkbox" name="an_notify"> Also email parents and staff</label>
          </div>

          <div class="ws-pane" data-ws-pane="task" hidden>
            <div class="ws-field"><label class="ws-label" for="ws-tk-title">Task</label><input class="ws-input" id="ws-tk-title" name="tk_title" maxlength="200" placeholder="e.g. Send JSS 2 results"></div>
            <div class="ws-field"><label class="ws-label" for="ws-tk-details">Details</label>
              <div><textarea class="ws-textarea" id="ws-tk-details" name="tk_details" placeholder="Add details. Type @ and a colleague's name to mention them."></textarea></div></div>
            <div class="ws-field"><span class="ws-label">Assign to</span><div class="ws-people" data-ws-people="task"></div><span class="ws-hint">Everyone you @mention is added here. They get a notification and an email.</span></div>
            <div class="ws-row ws-row--3">
              <div class="ws-field"><label class="ws-label" for="ws-tk-date">Due date</label><input class="ws-input" type="date" id="ws-tk-date" name="tk_date"></div>
              <div class="ws-field"><label class="ws-label" for="ws-tk-time">Time</label><input class="ws-input" type="time" id="ws-tk-time" name="tk_time" step="300"></div>
              <div class="ws-field"><span class="ws-label">Priority</span>
                <div class="ws-seg">${['low', 'normal', 'high'].map((p) => `<label><input type="radio" name="tk_priority" value="${p}"${p === 'normal' ? ' checked' : ''}><span>${p[0].toUpperCase() + p.slice(1)}</span></label>`).join('')}</div></div>
            </div>
          </div>
          <p class="ws-error" data-ws-error role="alert"></p>
        </div>
        <div class="ws-dialog__foot">
          <button type="button" class="ws-btn ws-btn--danger" data-ws-delete hidden><i class="fa-regular fa-trash-can"></i> Delete</button>
          <div class="ws-dialog__foot-right">
            <button type="button" class="ws-btn" data-ws-close>Cancel</button>
            <button type="submit" class="ws-btn ws-btn--primary" data-ws-save>Save</button>
          </div>
        </div>
      </form>`;
    document.body.appendChild(dialog);

    pickers.event = peoplePicker(dialog.querySelector('[data-ws-people="event"]'), { placeholder: 'Search staff to tag…' });
    pickers.task = peoplePicker(dialog.querySelector('[data-ws-people="task"]'), { placeholder: 'Search staff…' });
    mentionInput(dialog.querySelector('[name="tk_details"]'), { onMention: (p) => pickers.task.add(p) });

    const form = dialog.querySelector('form');
    dialog.querySelectorAll('[data-ws-close]').forEach((b) => b.addEventListener('click', () => dialog.close()));
    dialog.addEventListener('click', (e) => { if (e.target === dialog) dialog.close(); });
    dialog.querySelectorAll('[data-ws-tab]').forEach((tab) => tab.addEventListener('click', () => showTab(tab.dataset.wsTab)));
    form.ev_allday.addEventListener('change', syncAllDay);
    form.ev_visibility.addEventListener('change', syncVisibility);
    form.ev_date.addEventListener('change', () => { if (!form.ev_enddate.value || form.ev_enddate.value < form.ev_date.value) form.ev_enddate.value = form.ev_date.value; });
    form.addEventListener('submit', (e) => { e.preventDefault(); save(); });
    dialog.querySelector('[data-ws-delete]').addEventListener('click', remove);
  }

  function syncVisibility() {
    const personal = dialog.querySelector('[name="ev_visibility"]').value === 'personal';
    dialog.querySelector('[data-ws-notify-row]').style.display = personal ? 'none' : '';
  }

  function syncAllDay() {
    const allDay = dialog.querySelector('[name="ev_allday"]').checked;
    dialog.querySelectorAll('[data-ws-time]').forEach((el) => { el.style.display = allDay ? 'none' : ''; });
  }

  function showTab(type) {
    current.type = type;
    dialog.querySelectorAll('[data-ws-tab]').forEach((t) => {
      const on = t.dataset.wsTab === type;
      t.classList.toggle('is-active', on);
      t.setAttribute('aria-selected', on ? 'true' : 'false');
    });
    dialog.querySelectorAll('[data-ws-pane]').forEach((p) => { p.hidden = p.dataset.wsPane !== type; });
    dialog.querySelector('[data-ws-error]').textContent = '';
    const focus = { event: '[name="ev_title"]', announcement: '[name="an_message"]', task: '[name="tk_title"]' }[type];
    setTimeout(() => { const el = dialog.querySelector(focus); if (el) el.focus(); }, 30);
  }

  /**
   * Open the dialog.
   * opts: { type, canPublish, hasWebsite, start: Date, end: Date, allDay, event (for editing), onSaved }
   */
  function open(opts = {}) {
    if (!dialog) buildDialog();
    current = { ...opts };
    const form = dialog.querySelector('form');
    form.reset();
    const canPublish = !!opts.canPublish;
    const editing = !!opts.event;
    dialog.querySelector('[data-ws-tab="event"]').hidden = false;
    dialog.querySelector('[data-ws-tab="announcement"]').hidden = !canPublish || editing;
    dialog.querySelector('[data-ws-tab="task"]').hidden = editing;
    dialog.querySelector('.ws-tabs').style.display = editing ? 'none' : '';
    dialog.querySelector('#ws-dialog-title').textContent = editing ? (opts.event.kind === 'personal' ? 'Edit personal event' : 'Edit event') : 'Create';
    dialog.querySelector('[data-ws-delete]').hidden = !editing;
    dialog.querySelector('[data-ws-save]').textContent = 'Save';

    const schoolVis = opts.hasWebsite
      ? '<option value="org">Staff only (internal)</option><option value="both">Staff, parents & website</option><option value="public">Website only</option>'
      : '<option value="org">Staff only (internal)</option><option value="both">Staff & parents</option>';
    const personalVis = '<option value="personal">Just me (personal) · plus anyone I tag</option>';
    const editingPersonal = editing && opts.event.kind === 'personal';
    const editingSchool = editing && !editingPersonal;
    form.ev_visibility.innerHTML = editingPersonal ? personalVis : (editingSchool ? schoolVis : (canPublish ? schoolVis + personalVis : personalVis));
    form.an_visibility.innerHTML = schoolVis;

    const start = opts.start || new Date();
    const end = opts.end || null;
    const allDay = opts.allDay !== false;
    form.ev_date.value = dateKey(start);
    // FullCalendar gives an exclusive end for all-day selections.
    let endDay = end ? new Date(end) : new Date(start);
    if (end && allDay) endDay.setDate(endDay.getDate() - 1);
    if (endDay < start) endDay = new Date(start);
    form.ev_enddate.value = dateKey(endDay);
    form.ev_allday.checked = allDay;
    form.ev_start.value = allDay ? '09:00' : timeKey(start);
    form.ev_end.value = allDay ? '10:00' : (end ? timeKey(end) : '');
    form.ev_visibility.value = canPublish ? (opts.hasWebsite ? 'both' : 'org') : 'personal';
    form.querySelector('[name="ev_color"][value="teal"]').checked = true;
    form.tk_date.value = opts.start ? dateKey(start) : '';
    form.tk_time.value = opts.start && !allDay ? timeKey(start) : '';
    form.an_visibility.value = opts.hasWebsite ? 'both' : 'org';
    pickers.event.set([]);
    pickers.task.set([]);

    if (editing) {
      const ev = opts.event;
      form.ev_title.value = ev.title || '';
      form.ev_details.value = ev.details || '';
      form.ev_location.value = ev.location || '';
      form.ev_date.value = ev.date;
      form.ev_enddate.value = ev.endDate || ev.date;
      form.ev_allday.checked = !ev.startTime;
      form.ev_start.value = ev.startTime || '09:00';
      form.ev_end.value = ev.endTime || '';
      form.ev_visibility.value = ev.kind === 'personal' ? 'personal' : (ev.visibility || 'org');
      const color = form.querySelector(`[name="ev_color"][value="${ev.color || 'teal'}"]`);
      if (color) color.checked = true;
      pickers.event.set((ev.tags || []).map((t) => t.id));
    }

    syncAllDay();
    syncVisibility();
    const type = editing ? 'event' : (opts.type === 'announcement' && !canPublish ? 'event' : (opts.type || 'event'));
    if (!dialog.open) dialog.showModal();
    showTab(type);
  }

  async function save() {
    const form = dialog.querySelector('form');
    const error = dialog.querySelector('[data-ws-error]');
    const btn = dialog.querySelector('[data-ws-save]');
    error.textContent = '';
    let url;
    let body;
    if (current.type === 'event') {
      const allDay = form.ev_allday.checked;
      body = {
        title: form.ev_title.value.trim(),
        date: form.ev_date.value,
        endDate: form.ev_enddate.value || form.ev_date.value,
        allDay,
        startTime: allDay ? '' : form.ev_start.value,
        endTime: allDay ? '' : form.ev_end.value,
        location: form.ev_location.value.trim(),
        details: form.ev_details.value.trim(),
        visibility: form.ev_visibility.value,
        color: (form.querySelector('[name="ev_color"]:checked') || {}).value || 'teal',
        tagIds: pickers.event.get(),
        notifyByEmail: form.ev_notify.checked,
      };
      if (!body.title) { error.textContent = 'Give the event a title.'; form.ev_title.focus(); return; }
      if (!body.date) { error.textContent = 'Pick a date.'; return; }
      if (!allDay && !body.startTime) { error.textContent = 'Pick a start time, or tick All day.'; return; }
      const personal = current.event ? current.event.kind === 'personal' : body.visibility === 'personal';
      const base = personal ? '/common/calendar/personal' : '/common/calendar/events';
      url = current.event ? `${base}/${current.event.id}` : base;
      if (personal) body.notifyByEmail = false;
    } else if (current.type === 'announcement') {
      body = { message: form.an_message.value.trim(), visibility: form.an_visibility.value, notifyByEmail: form.an_notify.checked };
      if (!body.message) { error.textContent = 'Write the announcement first.'; form.an_message.focus(); return; }
      url = '/common/calendar/announcements';
    } else {
      body = {
        title: form.tk_title.value.trim(),
        details: form.tk_details.value.trim(),
        assigneeIds: pickers.task.get(),
        dueDate: form.tk_date.value,
        dueTime: form.tk_time.value,
        priority: (form.querySelector('[name="tk_priority"]:checked') || {}).value || 'normal',
      };
      if (!body.title && !body.details) { error.textContent = 'Describe the task first.'; form.tk_title.focus(); return; }
      if (!body.assigneeIds.length) { error.textContent = 'Assign it to at least one person — type @ or search above.'; return; }
      url = '/common/tasks';
    }
    btn.disabled = true;
    btn.textContent = 'Saving…';
    try {
      await post(url, body);
      const type = current.type;
      const onSaved = current.onSaved;
      dialog.close();
      toast({ event: current.event ? 'Event updated' : 'Event added', announcement: 'Announcement posted', task: 'Task sent' }[type]);
      if (onSaved) onSaved(type);
    } catch (err) {
      error.textContent = err.message;
    } finally {
      btn.disabled = false;
      btn.textContent = 'Save';
    }
  }

  async function remove() {
    if (!current.event || !confirm(`Delete "${current.event.title}"? This can't be undone.`)) return;
    try {
      await post(`/common/calendar/${current.event.kind === 'personal' ? 'personal' : 'events'}/${current.event.id}/delete`);
      const onSaved = current.onSaved;
      dialog.close();
      toast('Event deleted');
      if (onSaved) onSaved('delete');
    } catch (err) {
      dialog.querySelector('[data-ws-error]').textContent = err.message;
    }
  }

  window.Workspace = { open, post, toast, loadStaff, peoplePicker, mentionInput, esc, initials, avatar, dateKey, timeKey };
})();
