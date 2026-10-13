// Hub Reports: the reports a hub saved, and a three-step builder (report,
// columns, schools and term) that generates a table across the hub's schools.
// Figures come from /hub/overview-stats. Saved reports keep the table as it
// was (a snapshot) and can be refreshed with the latest figures.
(function () {
  const esc = (v) => String(v == null ? '' : v).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const n = (v) => (v === null || v === undefined || v === '' || Number.isNaN(Number(v)) ? null : Number(v));
  const fmt = {
    num: (v) => (n(v) === null ? '—' : n(v).toLocaleString('en-US')),
    pct: (v) => (n(v) === null ? '—' : `${n(v).toLocaleString('en-US', { maximumFractionDigits: 1 })}%`),
    ratio: (v) => (n(v) === null ? '—' : n(v).toLocaleString('en-US', { maximumFractionDigits: 1 })),
    signed: (v) => (n(v) === null ? '—' : `${n(v) > 0 ? '+' : ''}${n(v).toLocaleString('en-US')}`),
    text: (v) => (v === null || v === undefined || v === '' ? '—' : String(v)),
  };
  const sum = (rows, key) => rows.reduce((a, r) => a + (n(r[key]) || 0), 0);
  const rate = (rows, top, bottom) => { const b = sum(rows, bottom); return b ? Math.round((sum(rows, top) / b) * 1000) / 10 : null; };
  const genderOf = (s, which) => {
    const list = Array.isArray(s.gender) ? s.gender : [];
    if (which === 'other') return list.filter((g) => !/^(male|female)$/i.test(g.gender || '')).reduce((a, g) => a + (n(g.count) || 0), 0);
    const hit = list.find((g) => String(g.gender || '').toLowerCase() === which);
    return hit ? n(hit.count) : 0;
  };
  const when = (d) => new Date(d).toLocaleString('en-US', { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' });
  const day = (d) => new Date(d).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  const schoolsText = (k) => (k === 1 ? '1 school' : `${k} schools`);

  // Every column a report can show. total: how the "All schools" row is worked out.
  const COLUMNS = {
    term: { label: 'Term', type: 'text', get: (s) => s.termLabel },
    students: { label: 'Active students', type: 'num', get: (s) => s.students, total: 'sum' },
    enrolled: { label: 'Enrolled this term', type: 'num', get: (s) => s.enrolled, total: 'sum' },
    enrolledChange: { label: 'Change vs last term', type: 'signed', get: (s) => s.enrolledChange, total: 'sum' },
    attendanceRate: { label: 'Attendance rate', type: 'pct', get: (s) => s.attendanceRate, total: (rows) => rate(rows, 'attendancePresent', 'attendanceMarked') },
    attendancePresent: { label: 'Days present', type: 'num', get: (s) => s.attendancePresent, total: 'sum' },
    attendanceMarked: { label: 'Days marked', type: 'num', get: (s) => s.attendanceMarked, total: 'sum' },
    lowAttendance: { label: 'Students below 75% attendance', type: 'num', get: (s) => s.lowAttendance, total: 'sum' },
    averageScore: { label: 'Average score', type: 'pct', get: (s) => s.averageScore, total: (rows) => { const w = sum(rows, 'results'); return w ? Math.round(rows.reduce((a, r) => a + (n(r.averageScore) || 0) * (n(r.results) || 0), 0) / w * 10) / 10 : null; } },
    passRate: { label: 'Pass rate', type: 'pct', get: (s) => s.passRate, total: (rows) => rate(rows, 'passed', 'results') },
    results: { label: 'Subject results', type: 'num', get: (s) => s.results, total: 'sum' },
    passed: { label: 'Results passed', type: 'num', get: (s) => s.passed, total: 'sum' },
    studentsWithScores: { label: 'Students with scores', type: 'num', get: (s) => s.studentsWithScores, total: 'sum' },
    needsSupport: { label: 'Students needing support', type: 'num', get: (s) => s.needsSupport, total: 'sum' },
    scoreEntryRate: { label: 'Marks entered', type: 'pct', get: (s) => s.scoreEntryRate, total: (rows) => rate(rows, 'scoresEntered', 'scoresExpected') },
    scoresEntered: { label: 'Scores entered', type: 'num', get: (s) => s.scoresEntered, total: 'sum' },
    scoresExpected: { label: 'Scores expected', type: 'num', get: (s) => s.scoresExpected, total: 'sum' },
    staff: { label: 'Staff', type: 'num', get: (s) => s.staff, total: 'sum' },
    teachers: { label: 'Teachers', type: 'num', get: (s) => s.teachers, total: 'sum' },
    classes: { label: 'Classes', type: 'num', get: (s) => s.classes, total: 'sum' },
    activeClasses: { label: 'Classes with students', type: 'num', get: (s) => s.activeClasses, total: 'sum' },
    subjects: { label: 'Subjects', type: 'num', get: (s) => s.subjects },
    studentsPerClass: { label: 'Students per class', type: 'ratio', get: (s) => s.studentsPerClass },
    studentsPerStaff: { label: 'Students per staff', type: 'ratio', get: (s) => s.studentsPerStaff },
    male: { label: 'Male', type: 'num', get: (s) => genderOf(s, 'male'), total: 'sum' },
    female: { label: 'Female', type: 'num', get: (s) => genderOf(s, 'female'), total: 'sum' },
    otherGender: { label: 'Other / not set', type: 'num', get: (s) => genderOf(s, 'other'), total: 'sum' },
  };

  // [key, label, description, icon, columns on by default, more columns]
  const REPORTS = [
    ['attendance', 'Attendance', 'Days present out of days marked, and students below 75%.', 'fa-calendar-check', ['term', 'enrolled', 'attendanceRate', 'lowAttendance'], ['attendancePresent', 'attendanceMarked']],
    ['academic', 'Academic performance', 'Average scores and pass rates.', 'fa-chart-line', ['term', 'averageScore', 'passRate', 'studentsWithScores'], ['results', 'passed', 'needsSupport']],
    ['gender', 'Gender', 'Students enrolled by gender.', 'fa-venus-mars', ['term', 'male', 'female', 'enrolled'], ['otherGender']],
    ['marks', 'Marks entry', 'How many expected scores teachers have entered.', 'fa-pen-to-square', ['term', 'scoreEntryRate', 'scoresEntered', 'scoresExpected'], ['activeClasses', 'teachers']],
    ['support', 'Students needing support', 'Students averaging below the pass mark or with low attendance.', 'fa-hand-holding-heart', ['term', 'needsSupport', 'lowAttendance'], ['averageScore', 'studentsWithScores']],
    ['enrollment', 'Enrollment & staffing', 'Students, staff, classes and ratios.', 'fa-users', ['students', 'enrolled', 'staff', 'classes', 'studentsPerClass'], ['term', 'enrolledChange', 'teachers', 'subjects', 'studentsPerStaff']],
    ['comparison', 'School comparison', 'The main figures for every school side by side.', 'fa-table-list', ['term', 'students', 'attendanceRate', 'averageScore', 'passRate', 'scoreEntryRate'], ['needsSupport', 'staff', 'classes']],
  ];
  const reportBy = Object.fromEntries(REPORTS.map((r) => [r[0], r]));
  const STEPS = ['type', 'columns', 'schools'];

  function api(url, options) {
    return fetch(url, Object.assign({ credentials: 'same-origin', headers: { Accept: 'application/json', 'Content-Type': 'application/json' } }, options || {}))
      .then((r) => r.json().catch(() => ({})).then((body) => {
        if (!r.ok || body.success === false) throw new Error(body.error || body.message || 'Something went wrong. Please try again.');
        return body;
      }));
  }
  const say = (msg, type) => { if (window.HubToast) window.HubToast(msg, type); };
  const confirmBox = (opts) => (window.HubConfirm ? window.HubConfirm(opts) : Promise.resolve(window.confirm(opts.text || opts.title)));

  function init() {
    const root = document.querySelector('[data-reports]');
    if (!root || root.dataset.ready === '1') return;
    root.dataset.ready = '1';
    const canCreate = root.dataset.canCreate === '1';
    const canExport = root.dataset.canExport === '1';
    const hubName = root.dataset.hubName || 'Hub';
    const listBox = root.querySelector('[data-rp-list]');
    const builder = root.querySelector('[data-rp-builder]');
    const out = root.querySelector('[data-rp-result]');
    const inBuilder = (sel) => (builder ? builder.querySelector(sel) : null);
    const state = { type: 'attendance', data: null, terms: new Map(), loading: null, loadingKey: '', termsKey: null, saved: null, current: null };

    // ----- saved reports -----
    function loadList() {
      listBox.innerHTML = '<div class="hub-loading">Loading saved reports…</div>';
      return api('/hub/reports/saved')
        .then((body) => { state.saved = body.reports || []; drawList(); })
        .catch(() => { listBox.innerHTML = '<div class="hub-empty">Saved reports could not load. Refresh the page to try again.</div>'; });
    }
    function drawList() {
      const list = state.saved || [];
      if (!list.length) {
        listBox.innerHTML = `<div class="hub-empty"><i class="fa-regular fa-folder-open" aria-hidden="true"></i><strong>No saved reports yet</strong>${canCreate ? 'Build a report and save it to find it here.<button type="button" class="hub-btn hub-btn--primary hub-btn--sm" data-rp-new>New report</button>' : 'Reports your hub saves will show here.'}</div>`;
        return;
      }
      listBox.innerHTML = `<div class="hub-card__head"><h2 class="hub-card__title">Saved reports</h2><span class="hub-muted hub-small">${list.length}</span></div>
        <ul class="hub-rp__list">${list.map((r) => {
          const rep = reportBy[r.report_type] || [r.report_type, r.report_type, '', 'fa-file-lines'];
          return `<li class="hub-rp__item">
            <button type="button" class="hub-rp__open" data-rp-open="${r.report_id}">
              <span class="hub-rp__icon"><i class="fa-solid ${rep[3]}" aria-hidden="true"></i></span>
              <span class="hub-rp__text"><strong>${esc(r.name)}</strong><small>${esc(rep[1])} · ${schoolsText(Number(r.school_count) || 0)} · ${esc(r.created_by_name || 'Hub')}, ${esc(day(r.created_at))}</small></span>
              <i class="fa-solid fa-chevron-right hub-rp__go" aria-hidden="true"></i>
            </button>
            ${r.canDelete ? `<button type="button" class="hub-btn hub-btn--ghost hub-btn--sm hub-rp__del" data-rp-delete="${r.report_id}" aria-label="Delete ${esc(r.name)}" title="Delete"><i class="fa-regular fa-trash-can" aria-hidden="true"></i></button>` : ''}
          </li>`;
        }).join('')}</ul>`;
    }
    function showList() {
      if (builder) builder.hidden = true;
      listBox.hidden = false;
      out.innerHTML = '';
      state.current = null;
      if (!state.saved) loadList(); else drawList();
    }
    function showBuilder() {
      if (!builder) return;
      listBox.hidden = true;
      builder.hidden = false;
      out.innerHTML = '';
      state.current = null;
      openStep('type');
      ensureData();
      window.scrollTo({ top: 0 });
    }

    // ----- builder: one step open at a time; closed steps show what was picked -----
    function openStep(key) {
      if (!builder) return;
      builder.querySelectorAll('[data-step]').forEach((step) => {
        const on = step.dataset.step === key;
        step.classList.toggle('is-open', on);
        const head = step.querySelector('[data-step-toggle]');
        if (head) head.setAttribute('aria-expanded', on ? 'true' : 'false');
      });
      summarise();
    }
    function summarise() {
      if (!builder) return;
      const sel = selected();
      const total = state.data ? (state.data.schools || []).length : 0;
      const sums = {
        type: reportBy[state.type][1],
        columns: `${sel.cols.length + 1} columns`,
        schools: state.data ? `${sel.ids.size} of ${schoolsText(total)}` : '',
      };
      builder.querySelectorAll('[data-step]').forEach((step) => {
        const s = step.querySelector('[data-step-sum]');
        if (s) s.textContent = sums[step.dataset.step] || '';
      });
    }
    function drawTypes() {
      const box = inBuilder('[data-rb-types]');
      if (!box) return;
      box.innerHTML = REPORTS.map(([key, label, desc, icon]) => `
        <label class="hub-rb__type">
          <input type="radio" name="rbType" value="${key}" ${key === state.type ? 'checked' : ''} />
          <span class="hub-rb__type-icon"><i class="fa-solid ${icon}" aria-hidden="true"></i></span>
          <span><strong>${esc(label)}</strong><small>${esc(desc)}</small></span>
        </label>`).join('');
    }
    function drawColumns() {
      const box = inBuilder('[data-rb-columns]');
      if (!box) return;
      const [, , , , on, more] = reportBy[state.type];
      box.innerHTML = `
        <label class="hub-rb__check is-fixed"><input type="checkbox" checked disabled /> <span>School</span></label>
        ${on.concat(more).map((key) => `<label class="hub-rb__check"><input type="checkbox" value="${key}" data-rb-col ${on.includes(key) ? 'checked' : ''} /> <span>${esc(COLUMNS[key].label)}</span></label>`).join('')}`;
    }
    function termSelect(s) {
      const years = (s.termOptions && s.termOptions.years) || [];
      if (!years.length) return '<span class="hub-muted hub-small">No terms yet</span>';
      const chosen = String(state.terms.get(String(s.organizationId)) || s.termId || '');
      return `<select data-rb-term="${s.organizationId}" aria-label="Term for ${esc(s.organizationName)}">
        ${years.map((y) => `<optgroup label="${esc(y.label)}">${(y.terms || []).map((t) => `<option value="${t.id}" ${String(t.id) === chosen ? 'selected' : ''}>${esc(y.label)} · ${esc(t.name)}${t.current ? ' (current)' : ''}${t.hasData ? '' : ' · no data'}</option>`).join('')}</optgroup>`).join('')}
      </select>`;
    }
    function drawSchools() {
      const box = inBuilder('[data-rb-schools]');
      if (!box || !state.data) return;
      const schools = state.data.schools || [];
      if (!schools.length) { box.innerHTML = '<p class="hub-muted">No schools in your hub yet.</p>'; return; }
      box.innerHTML = `
        <div class="hub-rb__bulk"><button type="button" class="hub-btn hub-btn--ghost hub-btn--sm" data-rb-all>Select all</button><button type="button" class="hub-btn hub-btn--ghost hub-btn--sm" data-rb-none>Clear</button></div>
        <div class="hub-rb__schools">
          ${schools.map((s) => `
            <div class="hub-rb__school">
              <label class="hub-rb__check"><input type="checkbox" value="${s.organizationId}" data-rb-school ${s.onHold ? '' : 'checked'} /> <span>${esc(s.organizationName)}${s.onHold ? ' <em>(on hold)</em>' : ''}</span></label>
              ${termSelect(s)}
            </div>`).join('')}
        </div>`;
      summarise();
    }

    // ----- data -----
    const termsParam = () => Array.from(state.terms.entries()).map(([o, t]) => `${o}:${t}`).join(',');
    function load() {
      const key = termsParam();
      if (state.data && state.termsKey === key) return Promise.resolve(state.data);
      if (state.loading && state.loadingKey === key) return state.loading;
      const q = new URLSearchParams();
      if (key) q.set('terms', key);
      state.loadingKey = key;
      state.loading = fetch('/hub/overview-stats?' + q.toString(), { headers: { Accept: 'application/json' }, credentials: 'same-origin' })
        .then((r) => { if (!r.ok) throw new Error('failed'); return r.json(); })
        .then((json) => { state.data = json; state.termsKey = key; return json; })
        .finally(() => { state.loading = null; });
      return state.loading;
    }
    function ensureData() {
      if (state.data) { if (!inBuilder('[data-rb-school]')) drawSchools(); return; }
      load().then(drawSchools).catch(() => {
        const box = inBuilder('[data-rb-schools]');
        if (box) box.innerHTML = '<p class="hub-muted">Schools could not load. Refresh the page to try again.</p>';
      });
    }

    // ----- the table -----
    function selected() {
      if (!builder) return { cols: [], ids: new Set(), skip: true };
      const cols = Array.from(builder.querySelectorAll('[data-rb-col]:checked')).map((c) => c.value);
      const ids = new Set(Array.from(builder.querySelectorAll('[data-rb-school]:checked')).map((c) => c.value));
      const skip = inBuilder('[data-rb-skip]');
      return { cols, ids, skip: skip ? skip.checked : true };
    }
    function totalOf(key, rows) {
      const c = COLUMNS[key];
      if (!c.total || rows.length < 2) return null;
      if (c.total === 'sum') return rows.reduce((a, r) => a + (n(c.get(r)) || 0), 0);
      return c.total(rows);
    }
    // A snapshot is everything needed to show, print or download the table later.
    function snapshotOf(type, cols, rows) {
      const showTotal = rows.length > 1 && cols.some((k) => COLUMNS[k].total);
      return {
        type,
        title: reportBy[type][1],
        columns: cols.map((k) => ({ key: k, label: COLUMNS[k].label, type: COLUMNS[k].type })),
        rows: rows.map((s) => ({ name: s.organizationName, raw: cols.map((k) => { const v = COLUMNS[k].get(s); return v === undefined ? null : v; }) })),
        total: showTotal ? cols.map((k) => totalOf(k, rows)) : null,
        generatedAt: new Date().toISOString(),
      };
    }
    function tableHtml(snap) {
      const cls = (c) => (c.type === 'text' ? '' : 'num');
      const show = (c, v) => esc((fmt[c.type] || fmt.text)(v));
      const head = `<tr><th>School</th>${snap.columns.map((c) => `<th class="${cls(c)}">${esc(c.label)}</th>`).join('')}</tr>`;
      const body = snap.rows.map((r) => `<tr><td><strong>${esc(r.name)}</strong></td>${snap.columns.map((c, i) => `<td class="${cls(c)}">${show(c, r.raw[i])}</td>`).join('')}</tr>`).join('');
      const foot = snap.total ? `<tfoot><tr><th>All schools</th>${snap.columns.map((c, i) => `<th class="${cls(c)}">${snap.total[i] === null ? '' : show(c, snap.total[i])}</th>`).join('')}</tr></tfoot>` : '';
      return `<table class="hub-table hub-rb__table"><thead>${head}</thead><tbody>${body}</tbody>${foot}</table>`;
    }
    function csvOf(snap) {
      const cell = (v) => { const t = String(v == null ? '' : v); return /[",\n]/.test(t) ? `"${t.replace(/"/g, '""')}"` : t; };
      const lines = [['School'].concat(snap.columns.map((c) => c.label)).map(cell).join(',')];
      snap.rows.forEach((r) => lines.push([r.name].concat(r.raw.map((v) => (v === null ? '' : v))).map(cell).join(',')));
      if (snap.total) lines.push(['All schools'].concat(snap.total.map((v) => (v === null ? '' : v))).map(cell).join(','));
      return lines.join('\n');
    }

    // state.current = { snap, config, name?, saved? (the saved row), live? }
    function drawResult() {
      const cur = state.current;
      if (!cur) { out.innerHTML = ''; return; }
      const snap = cur.snap;
      const count = schoolsText(snap.rows.length);
      const meta = cur.saved
        ? `${esc(snap.title)} · ${count} · ${cur.live ? `Latest figures, ${esc(when(snap.generatedAt))}` : `Saved by ${esc(cur.saved.created_by_name || 'Hub')}, ${esc(when(cur.saved.created_at))}`}`
        : `${count} · ${esc(when(snap.generatedAt))}`;
      const actions = [];
      if (cur.saved) actions.push(`<button type="button" class="hub-btn hub-btn--sm" data-rp-refresh${cur.live ? ' disabled' : ''}><i class="fa-solid fa-rotate" aria-hidden="true"></i> Latest figures</button>`);
      if (canExport && snap.rows.length) {
        actions.push('<button type="button" class="hub-btn hub-btn--sm" data-rb-csv><i class="fa-solid fa-file-csv" aria-hidden="true"></i> CSV</button>');
        actions.push('<button type="button" class="hub-btn hub-btn--sm" data-rb-print><i class="fa-solid fa-print" aria-hidden="true"></i> Print or PDF</button>');
      }
      if (cur.saved && cur.saved.canDelete) actions.push(`<button type="button" class="hub-btn hub-btn--sm hub-btn--ghost" data-rp-delete="${cur.saved.report_id}" aria-label="Delete report" title="Delete"><i class="fa-regular fa-trash-can" aria-hidden="true"></i></button>`);
      const saveBar = canCreate && !cur.saved && snap.rows.length ? `
        <form class="hub-rp__save" data-rp-save>
          <label class="hub-rp__save-label" for="rpName">Save this report</label>
          <div class="hub-rp__save-row">
            <input id="rpName" name="name" maxlength="120" required value="${esc(`${snap.title} · ${day(snap.generatedAt)}`)}" />
            <button type="submit" class="hub-btn hub-btn--primary hub-btn--sm"><i class="fa-regular fa-bookmark" aria-hidden="true"></i> Save</button>
          </div>
        </form>` : '';
      out.innerHTML = `
        ${cur.saved ? '<div class="hub-rp__bar"><button type="button" class="hub-btn hub-btn--ghost hub-btn--sm" data-rp-back><i class="fa-solid fa-arrow-left" aria-hidden="true"></i> Saved reports</button></div>' : ''}
        <section class="hub-card hub-rb__out" aria-live="polite">
          <div class="hub-rb__out-head">
            <div style="min-width:0"><h2 class="hub-card__title">${esc(cur.name || snap.title)}</h2><p class="hub-muted hub-small">${meta}</p></div>
            ${actions.length ? `<div class="hub-actions">${actions.join('')}</div>` : ''}
          </div>
          ${snap.rows.length ? `<div class="hub-table-wrap">${tableHtml(snap)}</div>` : '<p class="hub-muted" style="margin:0">None of the chosen schools have data for their term. Pick another term, or untick “Leave out schools with no data”.</p>'}
          ${saveBar}
        </section>`;
    }

    async function run() {
      const sel = selected();
      if (!sel.ids.size) { openStep('schools'); say('Pick at least one school.', 'error'); return; }
      out.innerHTML = '<div class="hub-card hub-loading">Building the report…</div>';
      try { await load(); } catch (_e) { out.innerHTML = '<div class="hub-card hub-empty">The report could not load. Please try again.</div>'; return; }
      const rows = (state.data.schools || []).filter((s) => sel.ids.has(String(s.organizationId)) && (!sel.skip || s.hasData));
      const config = { type: state.type, cols: sel.cols, schools: Array.from(sel.ids), terms: Object.fromEntries(state.terms), skip: sel.skip };
      state.current = { snap: snapshotOf(state.type, sel.cols, rows), config };
      openStep(null);
      drawResult();
      out.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }

    async function openSaved(id) {
      listBox.hidden = true;
      if (builder) builder.hidden = true;
      out.innerHTML = '<div class="hub-card hub-loading">Opening the report…</div>';
      try {
        const { report } = await api(`/hub/reports/saved/${encodeURIComponent(id)}`);
        state.current = { snap: report.snapshot, config: report.config || {}, name: report.name, saved: report };
        drawResult();
        window.scrollTo({ top: 0 });
      } catch (err) {
        showList();
        say(err.message, 'error');
      }
    }
    async function refreshSaved() {
      const cur = state.current;
      if (!cur || !cur.saved) return;
      const cfg = cur.config || {};
      state.terms = new Map(Object.entries(cfg.terms || {}).map(([o, t]) => [String(o), String(t)]));
      const btn = out.querySelector('[data-rp-refresh]');
      if (btn) { btn.disabled = true; btn.innerHTML = '<i class="fa-solid fa-rotate fa-spin" aria-hidden="true"></i> Updating…'; }
      try {
        await load();
        const ids = new Set((cfg.schools || []).map(String));
        const cols = (cfg.cols || []).filter((k) => COLUMNS[k]);
        const type = reportBy[cfg.type] ? cfg.type : cur.snap.type;
        const rows = (state.data.schools || []).filter((s) => ids.has(String(s.organizationId)) && (!cfg.skip || s.hasData));
        cur.snap = snapshotOf(type, cols, rows);
        cur.live = true;
        drawResult();
      } catch (_e) {
        say('The latest figures could not load. Please try again.', 'error');
        if (btn) { btn.disabled = false; btn.innerHTML = '<i class="fa-solid fa-rotate" aria-hidden="true"></i> Latest figures'; }
      }
    }
    async function save(form) {
      const cur = state.current;
      if (!cur) return;
      const name = form.elements.name.value.trim();
      if (!name) { form.elements.name.focus(); return; }
      const btn = form.querySelector('button');
      btn.disabled = true;
      try {
        await api('/hub/reports/saved', { method: 'POST', body: JSON.stringify({ name, type: cur.snap.type, config: cur.config, snapshot: cur.snap }) });
        say('Report saved.');
        state.saved = null;
        showList();
        window.scrollTo({ top: 0 });
      } catch (err) {
        btn.disabled = false;
        say(err.message, 'error');
      }
    }
    async function remove(id) {
      const row = (state.saved || []).find((r) => String(r.report_id) === String(id)) || (state.current && state.current.saved);
      const ok = await confirmBox({ title: 'Delete this report?', text: `“${row ? row.name : 'This report'}” will be removed for everyone in your hub.`, ok: 'Delete report', danger: true });
      if (!ok) return;
      try {
        await api(`/hub/reports/saved/${encodeURIComponent(id)}/delete`, { method: 'POST', body: '{}' });
        say('Report deleted.');
        state.saved = null;
        showList();
      } catch (err) { say(err.message, 'error'); }
    }

    function printCurrent() {
      const cur = state.current;
      if (!cur) return;
      const w = window.open('', '_blank');
      if (!w) return;
      const title = `${cur.name || cur.snap.title} · ${hubName}`;
      w.document.write(`<!doctype html><html><head><meta charset="utf-8"><title>${esc(title)}</title>
        <style>html,body{background:#fff;color:#0f172a}body{font-family:Inter,system-ui,sans-serif;margin:32px}h1{font-size:20px;margin:0 0 4px}p{color:#64748b;margin:0 0 18px;font-size:13px}
        table{width:100%;border-collapse:collapse;font-size:12.5px}th,td{padding:8px 10px;border-bottom:1px solid #e2e8f0;text-align:left}thead th{background:#f8fafc;color:#475569;font-size:11px;text-transform:uppercase;letter-spacing:.04em}
        .num{text-align:right}tfoot th{background:#f8fafc}@media print{body{margin:12mm}}</style></head><body>
        <h1>${esc(title)}</h1><p>${esc(cur.snap.title)} · ${schoolsText(cur.snap.rows.length)} · ${esc(when(cur.snap.generatedAt))}</p>
        ${tableHtml(cur.snap)}</body></html>`);
      w.document.close();
      w.focus();
      setTimeout(() => w.print(), 200);
    }
    function downloadCsv() {
      const cur = state.current;
      if (!cur) return;
      const blob = new Blob([csvOf(cur.snap)], { type: 'text/csv;charset=utf-8' });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = `${(cur.name || cur.snap.title).replace(/[^a-z0-9]+/gi, '-').replace(/^-|-$/g, '').toLowerCase() || 'report'}.csv`;
      document.body.appendChild(a);
      a.click();
      setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 500);
    }

    // ----- events -----
    root.addEventListener('change', (e) => {
      if (e.target.name === 'rbType') { state.type = e.target.value; drawColumns(); summarise(); return; }
      const term = e.target.closest('[data-rb-term]');
      if (term) {
        const school = ((state.data && state.data.schools) || []).find((s) => String(s.organizationId) === term.dataset.rbTerm);
        if (school && String(school.termId) === term.value && !state.terms.has(term.dataset.rbTerm)) return;
        state.terms.set(term.dataset.rbTerm, term.value);
      }
      summarise();
    });
    root.addEventListener('submit', (e) => {
      const form = e.target.closest('[data-rp-save]');
      if (!form) return;
      e.preventDefault();
      e.stopPropagation();
      save(form);
    }, true);
    root.addEventListener('click', (e) => {
      const t = e.target;
      if (t.closest('[data-rp-new]')) { showBuilder(); return; }
      if (t.closest('[data-rp-back]')) { showList(); window.scrollTo({ top: 0 }); return; }
      const open = t.closest('[data-rp-open]');
      if (open) { openSaved(open.dataset.rpOpen); return; }
      const del = t.closest('[data-rp-delete]');
      if (del) { remove(del.dataset.rpDelete); return; }
      if (t.closest('[data-rp-refresh]')) { refreshSaved(); return; }
      const head = t.closest('[data-step-toggle]');
      if (head) {
        const step = head.closest('[data-step]');
        openStep(step.classList.contains('is-open') ? null : step.dataset.step);
        return;
      }
      const next = t.closest('[data-step-next]');
      if (next) { openStep(STEPS[STEPS.indexOf(next.closest('[data-step]').dataset.step) + 1] || null); return; }
      if (t.closest('[data-rb-run]')) { run(); return; }
      if (t.closest('[data-rb-csv]')) { downloadCsv(); return; }
      if (t.closest('[data-rb-print]')) { printCurrent(); return; }
      if (t.closest('[data-rb-all]')) { root.querySelectorAll('[data-rb-school]').forEach((c) => { c.checked = true; }); summarise(); }
      if (t.closest('[data-rb-none]')) { root.querySelectorAll('[data-rb-school]').forEach((c) => { c.checked = false; }); summarise(); }
    });

    drawTypes();
    drawColumns();
    summarise();
    // The list loads the first time Reports is shown (it may start hidden behind Overview).
    const section = root.closest('[data-view]');
    const maybeLoad = () => { if (!state.saved && !listBox.hidden && document.body.contains(root)) loadList(); };
    if (section && section.classList.contains('is-active')) maybeLoad();
    document.addEventListener('hub:view', (e) => { if (e.detail && e.detail.view === 'reports') maybeLoad(); });
  }

  init();
  document.addEventListener('hub:refreshed', init);
})();
