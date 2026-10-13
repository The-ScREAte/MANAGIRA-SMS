// Hub Reports: pick a report, its columns, the schools (and each school's
// term), then generate a table. CSV and Print/PDF work on what you see.
// Data comes from /hub/overview-stats (the same figures as the dashboard).
(function () {
  const root = document.querySelector('[data-report-builder]');
  if (!root || root.dataset.ready === '1') return;
  root.dataset.ready = '1';

  const canExport = root.dataset.canExport === '1';
  const hubName = root.dataset.hubName || 'Hub';
  const esc = (v) => String(v == null ? '' : v).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const n = (v) => (v === null || v === undefined || Number.isNaN(Number(v)) ? null : Number(v));
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

  // Reports: [key, label, description, columns on by default, more columns]
  const REPORTS = [
    ['attendance', 'Attendance', 'Days present out of days marked, and students below 75%.', ['term', 'enrolled', 'attendanceRate', 'lowAttendance'], ['attendancePresent', 'attendanceMarked']],
    ['academic', 'Academic performance', 'Average scores and pass rates.', ['term', 'averageScore', 'passRate', 'studentsWithScores'], ['results', 'passed', 'needsSupport']],
    ['gender', 'Gender', 'Students enrolled by gender.', ['term', 'male', 'female', 'enrolled'], ['otherGender']],
    ['marks', 'Marks entry', 'How many expected scores teachers have entered.', ['term', 'scoreEntryRate', 'scoresEntered', 'scoresExpected'], ['activeClasses', 'teachers']],
    ['support', 'Students needing support', 'Students averaging below the pass mark or with low attendance.', ['term', 'needsSupport', 'lowAttendance'], ['averageScore', 'studentsWithScores']],
    ['enrollment', 'Enrollment & staffing', 'Students, staff, classes and ratios.', ['students', 'enrolled', 'staff', 'classes', 'studentsPerClass'], ['term', 'enrolledChange', 'teachers', 'subjects', 'studentsPerStaff']],
    ['comparison', 'School comparison', 'The main figures for every school side by side.', ['term', 'students', 'attendanceRate', 'averageScore', 'passRate', 'scoreEntryRate'], ['needsSupport', 'staff', 'classes']],
  ];
  const reportBy = Object.fromEntries(REPORTS.map((r) => [r[0], r]));

  const $ = (sel) => root.querySelector(sel);
  const state = { type: 'attendance', data: null, terms: new Map(), loading: null, termsKey: '' };

  // ----- step 1: report type -----
  $('[data-rb-types]').innerHTML = REPORTS.map(([key, label, desc], i) => `
    <label class="hub-rb__type">
      <input type="radio" name="rbType" value="${key}" ${i === 0 ? 'checked' : ''} />
      <span><strong>${esc(label)}</strong><small>${esc(desc)}</small></span>
    </label>`).join('');

  // ----- step 2: columns for the chosen report -----
  function drawColumns() {
    const [, , , on, more] = reportBy[state.type];
    $('[data-rb-columns]').innerHTML = `
      <label class="hub-rb__check is-fixed"><input type="checkbox" checked disabled /> <span>School</span></label>
      ${on.concat(more).map((key) => `<label class="hub-rb__check"><input type="checkbox" value="${key}" data-rb-col ${on.includes(key) ? 'checked' : ''} /> <span>${esc(COLUMNS[key].label)}</span></label>`).join('')}`;
  }

  // ----- step 3: schools and each school's term -----
  function termSelect(s) {
    const years = (s.termOptions && s.termOptions.years) || [];
    if (!years.length) return '<span class="hub-muted hub-small">No terms yet</span>';
    const chosen = String(state.terms.get(String(s.organizationId)) || s.termId || '');
    return `<select data-rb-term="${s.organizationId}" aria-label="Term for ${esc(s.organizationName)}">
      ${years.map((y) => `<optgroup label="${esc(y.label)}">${(y.terms || []).map((t) => `<option value="${t.id}" ${String(t.id) === chosen ? 'selected' : ''}>${esc(t.name)}${t.current ? ' (current)' : ''}${t.hasData ? '' : ' · no data'}</option>`).join('')}</optgroup>`).join('')}
    </select>`;
  }
  function drawSchools() {
    const box = $('[data-rb-schools]');
    if (!state.data) return;
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
  }

  function termsParam() {
    return Array.from(state.terms.entries()).map(([o, t]) => `${o}:${t}`).join(',');
  }
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

  // ----- generate -----
  function selected() {
    const cols = Array.from(root.querySelectorAll('[data-rb-col]:checked')).map((c) => c.value);
    const ids = new Set(Array.from(root.querySelectorAll('[data-rb-school]:checked')).map((c) => c.value));
    return { cols, ids, skip: $('[data-rb-skip]').checked };
  }
  function buildRows(sel) {
    return (state.data.schools || []).filter((s) => sel.ids.has(String(s.organizationId)) && (!sel.skip || s.hasData));
  }
  function totalOf(key, rows) {
    const c = COLUMNS[key];
    if (!c.total || rows.length < 2) return null;
    if (c.total === 'sum') return rows.reduce((a, r) => a + (n(c.get(r)) || 0), 0);
    return c.total(rows);
  }
  function tableHtml(report, sel, rows) {
    const head = ['School'].concat(sel.cols.map((k) => COLUMNS[k].label));
    const body = rows.map((s) => `<tr><td><strong>${esc(s.organizationName)}</strong></td>${sel.cols.map((k) => `<td class="${COLUMNS[k].type === 'text' ? '' : 'num'}">${esc(fmt[COLUMNS[k].type](COLUMNS[k].get(s)))}</td>`).join('')}</tr>`).join('');
    const showTotal = rows.length > 1 && sel.cols.some((k) => COLUMNS[k].total);
    const foot = showTotal ? `<tfoot><tr><th>All schools</th>${sel.cols.map((k) => { const v = totalOf(k, rows); return `<th class="${COLUMNS[k].type === 'text' ? '' : 'num'}">${v === null ? '' : esc(fmt[COLUMNS[k].type](v))}</th>`; }).join('')}</tr></tfoot>` : '';
    return `<table class="hub-table hub-rb__table"><thead><tr>${head.map((h, i) => `<th class="${i && COLUMNS[sel.cols[i - 1]].type !== 'text' ? 'num' : ''}">${esc(h)}</th>`).join('')}</tr></thead><tbody>${body}</tbody>${foot}</table>`;
  }
  function csv(report, sel, rows) {
    const cell = (v) => { const t = String(v == null ? '' : v); return /[",\n]/.test(t) ? `"${t.replace(/"/g, '""')}"` : t; };
    const lines = [['School'].concat(sel.cols.map((k) => COLUMNS[k].label)).map(cell).join(',')];
    rows.forEach((s) => lines.push([s.organizationName].concat(sel.cols.map((k) => { const v = COLUMNS[k].get(s); return v === null || v === undefined ? '' : v; })).map(cell).join(',')));
    if (rows.length > 1) lines.push(['All schools'].concat(sel.cols.map((k) => { const v = totalOf(k, rows); return v === null ? '' : v; })).map(cell).join(','));
    return lines.join('\n');
  }

  let last = null;
  async function run() {
    const out = $('[data-rb-result]');
    const sel = selected();
    if (!sel.ids.size) { out.innerHTML = '<div class="hub-bill-alert hub-bill-alert--warn"><i class="fa-solid fa-circle-info" aria-hidden="true"></i><span>Pick at least one school.</span></div>'; return; }
    out.innerHTML = '<div class="hub-card hub-loading">Building the report…</div>';
    try { await load(); } catch (_e) { out.innerHTML = '<div class="hub-bill-alert hub-bill-alert--error"><i class="fa-solid fa-circle-exclamation" aria-hidden="true"></i><span>The report could not load. Please try again.</span></div>'; return; }
    const report = reportBy[state.type];
    const rows = buildRows(sel);
    last = { report, sel, rows };
    const stamp = new Date().toLocaleString('en-US', { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' });
    out.innerHTML = `
      <section class="hub-card hub-rb__out" aria-live="polite">
        <div class="hub-card__head hub-rb__out-head">
          <div><h2 class="hub-card__title">${esc(report[1])}</h2><p class="hub-muted hub-small" style="margin:2px 0 0">${rows.length} school${rows.length === 1 ? '' : 's'} · ${esc(stamp)}</p></div>
          <div class="hub-actions">
            ${canExport ? '<button type="button" class="hub-btn hub-btn--sm" data-rb-csv><i class="fa-solid fa-file-csv" aria-hidden="true"></i> CSV</button>' : ''}
            <button type="button" class="hub-btn hub-btn--sm" data-rb-print><i class="fa-solid fa-print" aria-hidden="true"></i> Print or PDF</button>
          </div>
        </div>
        ${rows.length ? `<div class="hub-table-wrap">${tableHtml(report, sel, rows)}</div>` : '<p class="hub-muted" style="margin:0">None of the chosen schools have data for their term. Pick another term, or untick "Leave out schools with no data".</p>'}
      </section>`;
    out.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  function printLast() {
    if (!last) return;
    const w = window.open('', '_blank');
    if (!w) return;
    const title = `${last.report[1]} · ${hubName}`;
    w.document.write(`<!doctype html><html><head><meta charset="utf-8"><title>${esc(title)}</title>
      <style>body{font-family:Inter,system-ui,sans-serif;color:#0f172a;margin:32px}h1{font-size:20px;margin:0 0 4px}p{color:#64748b;margin:0 0 18px;font-size:13px}
      table{width:100%;border-collapse:collapse;font-size:12.5px}th,td{padding:8px 10px;border-bottom:1px solid #e2e8f0;text-align:left}thead th{background:#f8fafc;color:#475569;font-size:11px;text-transform:uppercase;letter-spacing:.04em}
      .num{text-align:right}tfoot th{background:#f8fafc}</style></head><body>
      <h1>${esc(title)}</h1><p>${last.rows.length} school${last.rows.length === 1 ? '' : 's'} · ${esc(new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' }))}</p>
      ${tableHtml(last.report, last.sel, last.rows)}</body></html>`);
    w.document.close();
    w.focus();
    setTimeout(() => w.print(), 200);
  }
  function downloadCsv() {
    if (!last) return;
    const blob = new Blob([csv(last.report, last.sel, last.rows)], { type: 'text/csv;charset=utf-8' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `${last.report[1].replace(/[^a-z0-9]+/gi, '-').toLowerCase()}-${new Date().toISOString().slice(0, 10)}.csv`;
    document.body.appendChild(a);
    a.click();
    setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 500);
  }

  // ----- events -----
  root.addEventListener('change', (e) => {
    if (e.target.name === 'rbType') { state.type = e.target.value; drawColumns(); return; }
    const term = e.target.closest('[data-rb-term]');
    if (term) {
      const school = (state.data.schools || []).find((s) => String(s.organizationId) === term.dataset.rbTerm);
      if (school && String(school.termId) === term.value && !state.terms.has(term.dataset.rbTerm)) return;
      state.terms.set(term.dataset.rbTerm, term.value);
    }
  });
  root.addEventListener('click', (e) => {
    if (e.target.closest('[data-rb-run]')) { run(); return; }
    if (e.target.closest('[data-rb-csv]')) { downloadCsv(); return; }
    if (e.target.closest('[data-rb-print]')) { printLast(); return; }
    if (e.target.closest('[data-rb-all]')) root.querySelectorAll('[data-rb-school]').forEach((c) => { c.checked = true; });
    if (e.target.closest('[data-rb-none]')) root.querySelectorAll('[data-rb-school]').forEach((c) => { c.checked = false; });
  });

  drawColumns();
  load().then(drawSchools).catch(() => { $('[data-rb-schools]').innerHTML = '<p class="hub-muted">Schools could not load. Refresh the page to try again.</p>'; });
})();
