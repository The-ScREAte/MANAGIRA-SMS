// Hub dashboard: sidebar sections (URL hash), reports from /hub/overview-stats,
// school actions, confirmations and the reject dialog. See views/hub/dashboard.ejs.
(function () {
  const root = document.querySelector('[data-hub]');
  if (!root || root.dataset.ready === '1') return;
  root.dataset.ready = '1';

  const VIEWS = ['overview', 'school-comparison', 'attendance', 'performance', 'enrollment', 'schools', 'invitations', 'requests'];
  const REPORT_VIEWS = ['school-comparison', 'attendance', 'performance', 'enrollment'];

  // ---------- helpers ----------
  const esc = (v) => String(v == null ? '' : v).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const num = (v) => Number(v || 0).toLocaleString('en-US');
  const one = (v) => Number(v || 0).toLocaleString('en-US', { maximumFractionDigits: 1 });
  const pct = (v) => one(v) + '%';
  const tone = (v) => (v >= 75 ? 'good' : v >= 50 ? 'mid' : 'low');
  const empty = (icon, text) => `<div class="hub-card hub-empty"><i class="fa-solid ${icon}" aria-hidden="true"></i>${esc(text)}</div>`;

  // ---------- section switching ----------
  function show(view) {
    if (!VIEWS.includes(view)) view = 'overview';
    root.querySelectorAll('[data-view]').forEach((el) => el.classList.toggle('is-active', el.dataset.view === view));
    root.querySelectorAll('[data-view-link]').forEach((a) => {
      const on = a.dataset.viewLink === view;
      a.classList.toggle('is-active', on);
      if (on) a.setAttribute('aria-current', 'page'); else a.removeAttribute('aria-current');
    });
    if (view === 'overview' || REPORT_VIEWS.includes(view)) loadReports(false);
  }
  const fromHash = () => (window.location.hash || '#overview').slice(1);
  window.addEventListener('hashchange', () => { show(fromHash()); window.scrollTo({ top: 0 }); });

  // ---------- reports ----------
  let data = null;
  let loading = null;

  function loadReports(force) {
    if (data && !force) return Promise.resolve(data);
    if (loading) return loading;
    if (force) root.querySelectorAll('[data-report]').forEach((el) => { el.innerHTML = '<div class="hub-card hub-loading">Loading report…</div>'; });
    loading = fetch('/hub/overview-stats', { headers: { Accept: 'application/json' }, credentials: 'same-origin' })
      .then((r) => { if (!r.ok) throw new Error('failed'); return r.json(); })
      .then((json) => { data = json; renderAll(); return json; })
      .catch(() => {
        const msg = '<div class="hub-card hub-empty"><i class="fa-solid fa-circle-exclamation" aria-hidden="true"></i>Reports could not load. Try Refresh.</div>';
        root.querySelectorAll('[data-report]').forEach((el) => { el.innerHTML = msg; });
        const hl = root.querySelector('[data-highlights]');
        if (hl) hl.innerHTML = '<div class="hub-empty">Report highlights could not load.</div>';
      })
      .finally(() => { loading = null; });
    return loading;
  }

  function bars(items, valueKey, opts) {
    if (!items.length) return '<div class="hub-empty">No data yet.</div>';
    const max = opts.max || Math.max(...items.map((i) => Number(i[valueKey]) || 0), 1);
    return '<div class="hub-bars">' + items.map((item) => {
      const value = Number(item[valueKey]) || 0;
      const width = Math.max(2, Math.min(100, (value / max) * 100));
      const cls = opts.toned ? ' hub-bar__fill--' + tone(value) : '';
      return `<div class="hub-bar">
          <span class="hub-bar__name" title="${esc(item.organizationName)}">${esc(item.organizationName)}</span>
          <span class="hub-bar__track"><span class="hub-bar__fill${cls}" style="width:${width}%"></span></span>
          <span class="hub-bar__value">${opts.format(value)}</span>
          ${opts.sub ? `<span class="hub-bar__sub">${opts.sub(item)}</span>` : ''}
        </div>`;
    }).join('') + '</div>';
  }

  function kpi(value, label, note, href) {
    const tag = href ? 'a' : 'div';
    return `<${tag} class="hub-kpi"${href ? ` href="${href}"` : ''}><span class="hub-kpi__value">${value}</span><span class="hub-kpi__label">${esc(label)}</span>${note ? `<span class="hub-kpi__note">${esc(note)}</span>` : ''}</${tag}>`;
  }

  function renderAll() {
    const h = data.highlights || {};
    const t = data.totals || {};
    const es = data.enrollmentStaffing || {};
    const schools = data.organizationLoadComparison || [];
    const attendance = data.attendanceByOrganization || [];
    const performance = data.topPerformingOrganizations || [];
    const stamp = data.generatedAt ? 'Updated ' + new Date(data.generatedAt).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }) : '';
    root.querySelectorAll('[data-report-stamp]').forEach((el) => { el.textContent = stamp; });

    const hl = root.querySelector('[data-highlights]');
    if (hl) {
      hl.innerHTML =
        kpi(pct(h.attendanceRate), 'Attendance rate', `${num(t.presentDays)} present of ${num(t.totalAttendanceRecords)} records`, '#attendance') +
        kpi(pct(h.averageAssessmentScore), 'Average score', `${pct(h.passRate)} pass rate`, '#performance') +
        kpi(one(h.studentsPerClass), 'Students per class', 'Hub average', '#school-comparison') +
        kpi(one(h.studentsPerStaff), 'Students per staff', 'Hub average', '#enrollment');
    }

    const set = (key, html) => { const el = root.querySelector(`[data-report="${key}"]`); if (el) el.innerHTML = html; };

    // School comparison
    set('school-comparison', !schools.length ? empty('fa-school', 'No schools in your hub yet.') : `
      <div class="hub-card">
        <div class="hub-table-wrap">
          <table class="hub-table">
            <thead><tr><th>School</th><th class="num">Students</th><th class="num">Staff</th><th class="num">Classes</th><th class="num">Subjects</th><th class="num">Students / class</th><th class="num">Students / staff</th><th>Status</th></tr></thead>
            <tbody>${schools.map((s) => `<tr class="${s.onHold ? 'is-held' : ''}">
              <td><a class="hub-school" href="/hub/organizations/${encodeURIComponent(s.organizationId)}?tab=students">${esc(s.organizationName)}</a></td>
              <td class="num">${num(s.studentCount)}</td><td class="num">${num(s.staffCount)}</td><td class="num">${num(s.classCount)}</td><td class="num">${num(s.subjectCount)}</td>
              <td class="num">${one(s.studentsPerClass)}</td><td class="num">${one(s.studentsPerStaff)}</td>
              <td><span class="hub-status${s.onHold ? ' hub-status--hold' : ''}">${s.onHold ? 'On hold' : 'Active'}</span></td>
            </tr>`).join('')}</tbody>
          </table>
        </div>
      </div>`);

    // Attendance
    set('attendance', `
      <div class="hub-kpis">
        ${kpi(pct(h.attendanceRate), 'Hub attendance rate')}
        ${kpi(num(t.presentDays), 'Present records')}
        ${kpi(num(t.absentDays), 'Absent records')}
        ${kpi(num(t.totalAttendanceRecords), 'Total records')}
      </div>
      <div class="hub-card">
        <h2 class="hub-card__title">Present rate by school <small>Green 75%+, amber 50–74%, red under 50%</small></h2>
        ${bars(attendance, 'presentRate', { max: 100, toned: true, format: pct, sub: (i) => `${num(i.presentDays)} present · ${num(i.absentDays)} absent · ${num(i.totalRecords)} records` })}
      </div>`);

    // Academic performance
    set('performance', `
      <div class="hub-kpis">
        ${kpi(pct(h.averageAssessmentScore), 'Average score')}
        ${kpi(pct(h.passRate), 'Pass rate', 'Score of 50% or more')}
        ${kpi(num(t.totalAssessmentResults), 'Assessment results')}
      </div>
      <div class="hub-card">
        <h2 class="hub-card__title">Average score by school</h2>
        ${bars(performance, 'averageScore', { max: 100, toned: true, format: pct, sub: (i) => `${num(i.resultsCount)} results` })}
      </div>`);

    // Enrollment & staffing
    set('enrollment', `
      <div class="hub-kpis">
        ${kpi(num(es.totalStudents), 'Active students', 'Graduated & archived not included')}
        ${kpi(num(es.totalStaff), 'Staff')}
        ${kpi(num(es.totalClasses), 'Classes')}
        ${kpi(num(es.totalSubjects), 'Subjects')}
      </div>
      <div class="hub-grid" style="margin-top:14px;">
        <div class="hub-card">
          <h2 class="hub-card__title">Students by school</h2>
          ${bars(schools, 'studentCount', { format: num, sub: (i) => `${num(i.classCount)} classes · ${one(i.studentsPerClass)} per class` })}
        </div>
        <div class="hub-card">
          <h2 class="hub-card__title">Staff by school</h2>
          ${bars(schools, 'staffCount', { format: num, sub: (i) => `${one(i.studentsPerStaff)} students per staff` })}
        </div>
      </div>`);
  }

  root.querySelectorAll('[data-report-refresh]').forEach((btn) => btn.addEventListener('click', () => loadReports(true)));

  // ---------- school actions ----------
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

  root.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-org-action]');
    if (!btn) return;
    const { orgAction: action, orgId: id, orgName: name } = btn.dataset;
    btn.closest('details').open = false;
    if (action === 'hold' && confirm(`Put "${name}" on hold? They can't use their account until you resume it.`)) post('/hub/organizations/toggle-hold', { organizationId: id });
    if (action === 'resume' && confirm(`Resume "${name}"? They get full access again.`)) post('/hub/organizations/toggle-hold', { organizationId: id });
    if (action === 'remove' && confirm(`Remove "${name}" from your hub?\n\nThey become an independent school and need their own subscription. Their data stays intact.`)) post('/hub/organizations/remove', { organizationId: id });
    if (action === 'delete' && confirm(`Permanently delete "${name}"?\n\nAll of its students, staff and classes are deleted. This can't be undone.`)) {
      if (prompt('Type DELETE to confirm:') === 'DELETE') post('/hub/organizations/delete', { organizationId: id });
      else alert('Not deleted.');
    }
  });

  // Close an open "more" menu when clicking elsewhere.
  document.addEventListener('click', (e) => {
    root.querySelectorAll('.hub-menu[open]').forEach((menu) => { if (!menu.contains(e.target)) menu.open = false; });
  });

  // Confirm before submitting forms that ask for it.
  root.querySelectorAll('form[data-confirm]').forEach((form) => {
    form.addEventListener('submit', (e) => { if (!confirm(form.dataset.confirm)) e.preventDefault(); });
  });

  // Reject dialog
  const dialog = root.querySelector('[data-reject-dialog]');
  root.querySelectorAll('[data-reject-id]').forEach((btn) => btn.addEventListener('click', () => {
    if (!dialog) return;
    dialog.querySelector('[data-reject-id-input]').value = btn.dataset.rejectId;
    dialog.querySelector('[data-reject-name-label]').textContent = btn.dataset.rejectName;
    dialog.querySelector('textarea').value = '';
    dialog.showModal();
  }));
  if (dialog) dialog.querySelector('[data-reject-cancel]').addEventListener('click', () => dialog.close());

  show(fromHash());
})();
