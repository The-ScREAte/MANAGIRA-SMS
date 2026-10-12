// Hub pages: dashboard views + reports, school actions, confirmations, the
// reject dialog, and the people/classes browser on a school's page.
// Used by every signed-in page in views/hub/.
(function () {
  const shell = document.querySelector('.hub-shell');
  if (!shell || shell.dataset.ready === '1') return;
  shell.dataset.ready = '1';

  const esc = (v) => String(v == null ? '' : v).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const num = (v) => Number(v || 0).toLocaleString('en-US');
  const one = (v) => Number(v || 0).toLocaleString('en-US', { maximumFractionDigits: 1 });
  const pct = (v) => one(v) + '%';
  const tone = (v) => (v >= 75 ? 'good' : v >= 50 ? 'mid' : 'low');
  const initials = (name) => String(name || '?').split(/\s+/).filter(Boolean).slice(0, 2).map((p) => p[0]).join('').toUpperCase() || '?';
  const fmtDate = (v) => { if (!v) return '—'; const d = new Date(v); return Number.isNaN(d.getTime()) ? '—' : d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }); };

  // ---------- school actions (dashboard table + school page) ----------
  function post(action, fields) {
    const form = document.createElement('form');
    form.method = 'POST';
    form.action = action;
    Object.keys(fields).forEach((k) => {
      const input = document.createElement('input');
      input.type = 'hidden'; input.name = k; input.value = fields[k];
      form.appendChild(input);
    });
    document.body.appendChild(form);
    form.submit();
  }
  shell.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-org-action]');
    if (!btn) return;
    const { orgAction: action, orgId: id, orgName: name } = btn.dataset;
    const menu = btn.closest('details');
    if (menu) menu.open = false;
    if (action === 'hold' && confirm(`Put "${name}" on hold? Its staff can't use Managira until you resume it.`)) post('/hub/organizations/toggle-hold', { organizationId: id });
    if (action === 'resume' && confirm(`Resume "${name}"? Its staff get full access again.`)) post('/hub/organizations/toggle-hold', { organizationId: id });
    if (action === 'remove' && confirm(`Remove "${name}" from your hub?\n\nIt becomes an independent school and needs its own subscription. Its data stays intact.`)) post('/hub/organizations/remove', { organizationId: id });
    if (action === 'delete' && confirm(`Permanently delete "${name}"?\n\nAll of its students, staff and classes are deleted. This can't be undone.`)) {
      if (prompt('Type DELETE to confirm:') === 'DELETE') post('/hub/organizations/delete', { organizationId: id });
      else alert('Not deleted.');
    }
  });
  document.addEventListener('click', (e) => {
    shell.querySelectorAll('.hub-menu[open]').forEach((m) => { if (!m.contains(e.target)) m.open = false; });
  });
  shell.querySelectorAll('form[data-confirm]').forEach((form) => {
    form.addEventListener('submit', (e) => { if (!confirm(form.dataset.confirm)) e.preventDefault(); });
  });
  const dialog = shell.querySelector('[data-reject-dialog]');
  shell.querySelectorAll('[data-reject-id]').forEach((btn) => btn.addEventListener('click', () => {
    if (!dialog) return;
    dialog.querySelector('[data-reject-id-input]').value = btn.dataset.rejectId;
    dialog.querySelector('[data-reject-name-label]').textContent = btn.dataset.rejectName;
    dialog.querySelector('textarea').value = '';
    dialog.showModal();
  }));
  if (dialog) dialog.querySelector('[data-reject-cancel]').addEventListener('click', () => dialog.close());

  // ---------- dashboard ----------
  const dash = shell.querySelector('[data-hub-dashboard]');
  if (dash) {
    const VIEWS = Array.from(dash.querySelectorAll('[data-view]')).map((el) => el.dataset.view);
    const REPORT_VIEWS = ['school-comparison', 'attendance', 'performance', 'marks-entry', 'support', 'enrollment'].filter((v) => VIEWS.includes(v));
    const canReports = REPORT_VIEWS.length > 0;
    const canSchools = dash.dataset.canSchools === '1';
    const dash$ = (sel) => Array.from(dash.querySelectorAll(sel));
    let data = null;
    let loading = null;
    // Chosen period, kept in the address so a refresh or shared link keeps it.
    const qs = new URLSearchParams(window.location.search);
    const period = { org: qs.get('org') || 'all', year: qs.get('year') || 'current', term: qs.get('term') || 'current' };

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
          <span class="hub-bar__name" title="${esc(name)}">${esc(name)}</span>
          <span class="hub-bar__track"><span class="hub-bar__fill${opts.toned && raw != null ? ' hub-bar__fill--' + tone(value) : ''}" style="width:${width}%"></span></span>
          <span class="hub-bar__value">${raw === null || raw === undefined ? '—' : opts.format(value)}</span>
          ${opts.sub ? `<span class="hub-bar__sub">${opts.sub(item)}</span>` : ''}
        </div>`;
      }).join('') + '</div>';
    }

    // ----- period filter -----
    function periodLabel() {
      const f = (data && data.filter) || {};
      const find = (list, key) => ((list || []).find((x) => String(x.key) === String(key)) || {}).label || '';
      if (f.org === 'all') {
        if (f.year === 'current' && f.term === 'current') return 'Each school’s current term';
        return [find(f.terms, f.term), find(f.years, f.year)].filter(Boolean).join(' · ');
      }
      const school = ((f.schools || []).find((x) => String(x.id) === String(f.org)) || {}).name || '';
      return [school, find(f.terms, f.term).replace(' (current)', ''), find(f.years, f.year)].filter(Boolean).join(' · ');
    }
    function renderFilters() {
      const f = data.filter;
      const opt = (value, label, selected) => `<option value="${esc(value)}"${String(value) === String(selected) ? ' selected' : ''}>${esc(label)}</option>`;
      const html = `<form class="hub-filter" data-filter onsubmit="return false">
          <label class="hub-filter__field"><span>School</span><select name="org">${opt('all', 'All schools', f.org)}${f.schools.map((s) => opt(s.id, s.name, f.org)).join('')}</select></label>
          <label class="hub-filter__field"><span>School year</span><select name="year"${f.years.length ? '' : ' disabled'}>${f.years.length ? f.years.map((y) => opt(y.key, y.label, f.year)).join('') : '<option>No school years yet</option>'}</select></label>
          <label class="hub-filter__field"><span>Term</span><select name="term"${f.terms.length ? '' : ' disabled'}>${f.terms.length ? f.terms.map((t) => opt(t.key, t.label, f.term)).join('') : '<option>No terms yet</option>'}</select></label>
          <span class="hub-filter__note"><i class="fa-regular fa-calendar" aria-hidden="true"></i> ${f.org === 'all' ? 'Each school is read on its own calendar. Pick a school to choose its exact term.' : 'Showing this school’s own school year and term.'}</span>
        </form>`;
      dash$('[data-filter-slot]').forEach((slot) => { slot.innerHTML = html; });
      dash$('[data-period-label]').forEach((el) => { el.textContent = '· ' + periodLabel(); });
    }
    dash.addEventListener('change', (e) => {
      const sel = e.target.closest('[data-filter] select');
      if (!sel) return;
      if (sel.name === 'org') { period.org = sel.value; period.year = sel.value === 'all' ? 'current' : ''; period.term = sel.value === 'all' ? 'current' : ''; }
      if (sel.name === 'year') { period.year = sel.value; period.term = period.org === 'all' ? 'current' : ''; }
      if (sel.name === 'term') period.term = sel.value;
      const next = new URLSearchParams();
      if (period.org !== 'all' || period.year !== 'current' || period.term !== 'current') {
        next.set('org', period.org); if (period.year) next.set('year', period.year); if (period.term) next.set('term', period.term);
      }
      const q = next.toString();
      window.history.replaceState(window.history.state, '', window.location.pathname + (q ? '?' + q : '') + window.location.hash);
      loadReports(true);
    });

    function loadReports(force) {
      if (!canReports) return Promise.resolve(null);
      if (data && !force) return Promise.resolve(data);
      if (loading) return loading;
      if (force) dash$('[data-report]').forEach((el) => { el.innerHTML = '<div class="hub-card hub-loading">Loading report…</div>'; });
      const q = new URLSearchParams({ org: period.org, year: period.year || '', term: period.term || '' });
      loading = fetch('/hub/overview-stats?' + q.toString(), { headers: { Accept: 'application/json' }, credentials: 'same-origin' })
        .then((r) => { if (!r.ok) throw new Error('failed'); return r.json(); })
        .then((json) => {
          data = json;
          Object.assign(period, { org: json.filter.org, year: json.filter.year, term: json.filter.term });
          renderFilters();
          renderAll();
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
      if (noData.length && data.filter.org === 'all' && data.filter.term === 'current') items.push(['#school-comparison', 'fa-circle-info', ' hub-alert--info', `<strong>${noData.length}</strong> school${noData.length === 1 ? ' has' : 's have'} no attendance, enrollment or scores yet`]);
      box.innerHTML = items.map(([href, icon, cls, text]) => `<a class="hub-alert${cls}" href="${href}"><i class="fa-solid ${icon}" aria-hidden="true"></i><span>${text}</span><i class="fa-solid fa-chevron-right" aria-hidden="true"></i></a>`).join('');
      const clear = dash.querySelector('[data-attention-clear]');
      const serverItems = box.parentElement ? box.parentElement.querySelectorAll(':scope > a.hub-alert').length : 0;
      if (clear) clear.hidden = items.length > 0 || serverItems > 0;
    }

    function renderAll() {
      const t = data.totals || {};
      const rows = data.schools || [];
      const withData = rows.filter((s) => s.hasData);
      const termOf = (s) => (s.hasData ? esc(s.termLabel) : (s.termLabel ? `${esc(s.termLabel)}<span class="hub-small">No data yet</span>` : '<span class="hub-small">No term in this period</span>'));
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

    dash$('[data-report-refresh]').forEach((btn) => btn.addEventListener('click', () => loadReports(true)));
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
