// School data a Doc or Sheet can pull in ("Insert data"): each source has the
// columns a user can pick, and returns { columns, rows } for chosen classes in
// a term. All queries are scoped to the caller's organization.

const SOURCES = {
  students: {
    label: 'Students',
    fields: [
      ['name', 'Full name', true], ['first', 'First name'], ['last', 'Last name'], ['sid', 'Student ID', true],
      ['class', 'Class', true], ['gender', 'Gender'], ['dob', 'Date of birth'], ['age', 'Age'],
      ['email', 'Email'], ['address', 'Address'], ['hometown', 'Hometown'],
      ['parent', 'Parent / guardian'], ['parent_phone', 'Parent phone'], ['parent_email', 'Parent email'],
      ['bus', 'Bus'], ['route', 'Bus route'], ['stop', 'Bus stop'],
    ],
  },
  guardians: {
    label: 'Parents & guardians',
    fields: [
      ['name', 'Parent / guardian', true], ['relationship', 'Relationship'], ['phone', 'Phone', true], ['email', 'Email', true],
      ['address', 'Address'], ['child', 'Child', true], ['class', 'Child’s class', true],
    ],
  },
  subjects: {
    label: 'Subjects',
    fields: [['subject', 'Subject', true], ['class', 'Class', true]],
  },
  staff: {
    label: 'Staff',
    noClasses: true,
    fields: [['name', 'Name', true], ['role', 'Role', true], ['email', 'Email', true], ['phone', 'Phone'], ['class', 'Class']],
  },
  attendance: {
    label: 'Attendance',
    fields: [
      ['name', 'Student', true], ['sid', 'Student ID'], ['class', 'Class', true],
      ['present', 'Days present', true], ['absent', 'Days absent', true], ['total', 'Days marked'], ['rate', 'Attendance %', true],
    ],
  },
  results: {
    label: 'Results',
    fields: [
      ['name', 'Student', true], ['sid', 'Student ID'], ['class', 'Class', true],
      ['scores', 'Score in each subject', true], ['positions', 'Position in each subject'], ['average', 'Average', true],
    ],
  },
};

// Field lists for the page (no SQL details).
function describeSources() {
  return Object.entries(SOURCES).map(([key, s]) => ({
    key,
    label: s.label,
    noClasses: !!s.noClasses,
    fields: s.fields.map(([k, label, def]) => ({ key: k, label, def: !!def })),
  }));
}

const fmtDate = (d) => (d ? new Date(d).toISOString().slice(0, 10) : '');
const ageOf = (d) => {
  if (!d) return '';
  const b = new Date(d), n = new Date();
  let a = n.getFullYear() - b.getFullYear();
  if (n.getMonth() < b.getMonth() || (n.getMonth() === b.getMonth() && n.getDate() < b.getDate())) a--;
  return a >= 0 && a < 120 ? a : '';
};
const fullName = (f, l) => [f, l].filter(Boolean).join(' ').trim();
const round1 = (n) => (n === null || n === undefined || n === '' ? '' : Math.round(Number(n) * 10) / 10);

// The term to use: the requested one if it is this school's, else the current one.
async function resolveTerm(db, orgId, termId) {
  const { rows } = await db.query(`
    SELECT t.term_id, t.term_name, sy.year_label, (t.current AND COALESCE(sy.current, TRUE)) AS is_current
    FROM terms t LEFT JOIN school_years sy ON sy.id = t.school_year_id
    WHERE t.organization_id = $1 AND ($2::int IS NULL OR t.term_id = $2)
    ORDER BY (t.term_id = $2) DESC NULLS LAST, t.current DESC, t.start_date DESC NULLS LAST
    LIMIT 1
  `, [orgId, Number(termId) || null]);
  return rows[0] || null;
}

// Students in the chosen classes for a term: who was enrolled in it, or (for
// the current term) each active student's class when they aren't enrolled yet.
const ROSTER_SQL = `
  WITH term_enr AS (
    SELECT DISTINCT ON (es.student_id) es.student_id, es.class_id
    FROM enrolled_students es JOIN enrollments e ON e.enrollment_id = es.enrollment_id
    WHERE e.organization_id = $1 AND e.term_id = $2
    ORDER BY es.student_id
  ),
  roster AS (
    SELECT s.student_id, COALESCE(te.class_id, CASE WHEN $3 THEN s.class_id END) AS class_id
    FROM students s LEFT JOIN term_enr te ON te.student_id = s.student_id
    WHERE s.organization_id = $1 AND (te.student_id IS NOT NULL OR (s.graduated = FALSE AND $3))
  )
  SELECT r.student_id, r.class_id, c.class_name, s.first_name, s.last_name, s.custom_student_id,
         s.gender, s.date_of_birth, s.email, s.address, s.hometown
  FROM roster r
  JOIN students s ON s.student_id = r.student_id
  JOIN classes c ON c.class_id = r.class_id AND c.organization_id = $1
  WHERE ($4::int[] IS NULL OR r.class_id = ANY($4::int[]))
  ORDER BY COALESCE(c.dashboard_sort_order, 2147483647), c.class_name, s.last_name, s.first_name
`;

async function loadRoster(db, orgId, term, classIds) {
  const { rows } = await db.query(ROSTER_SQL, [orgId, term.term_id, !!term.is_current, classIds]);
  return rows;
}

async function buildData(db, { orgId, source, classIds, fields, termId }) {
  const def = SOURCES[source];
  if (!def) throw Object.assign(new Error('Unknown data source.'), { status: 400 });
  const allowed = new Map(def.fields.map(([k, label]) => [k, label]));
  let picked = (Array.isArray(fields) ? fields : []).filter((f) => allowed.has(f));
  if (!picked.length) picked = def.fields.filter((f) => f[2]).map((f) => f[0]);
  const ids = (Array.isArray(classIds) ? classIds : []).map(Number).filter((n) => Number.isInteger(n) && n > 0);
  const classFilter = ids.length && !def.noClasses ? ids : null;
  const term = await resolveTerm(db, orgId, termId);
  if (!term && source !== 'staff') return { columns: [], rows: [], term: null };
  const termLabel = term ? `${term.term_name}${term.year_label ? ' · ' + term.year_label : ''}` : null;
  const simple = (getters) => ({
    columns: picked.map((k) => allowed.get(k)),
    rowsFrom: (list) => list.map((item) => picked.map((k) => { const v = getters[k](item); return v === null || v === undefined ? '' : v; })),
  });

  if (source === 'students') {
    const roster = await loadRoster(db, orgId, term, classFilter);
    const studentIds = roster.map((r) => r.student_id);
    const extra = new Map();
    if (studentIds.length && picked.some((k) => /^(parent|bus|route|stop)/.test(k))) {
      const { rows } = await db.query(`
        SELECT s.student_id, g.first_name AS g_first, g.last_name AS g_last, g.phone AS g_phone, g.email AS g_email,
               COALESCE(NULLIF(b.bus_name, ''), b.bus_number) AS bus, rt.route_name AS route, st.stop_name AS stop
        FROM UNNEST($2::int[]) AS s(student_id)
        LEFT JOIN LATERAL (
          SELECT g.* FROM guardians g
          LEFT JOIN guardian_students gs ON gs.guardian_id = g.guardian_id AND gs.student_id = s.student_id
          WHERE g.organization_id = $1 AND (gs.student_id IS NOT NULL OR g.student_id = s.student_id)
          ORDER BY g.guardian_id LIMIT 1
        ) g ON TRUE
        LEFT JOIN LATERAL (
          SELECT * FROM transport_student_assignments a
          WHERE a.student_id = s.student_id AND a.organization_id = $1 AND COALESCE(a.active, TRUE)
          ORDER BY a.updated_at DESC NULLS LAST LIMIT 1
        ) a ON TRUE
        LEFT JOIN transport_buses b ON b.bus_id = a.bus_id AND b.organization_id = $1
        LEFT JOIN transport_routes rt ON rt.route_id = a.route_id AND rt.organization_id = $1
        LEFT JOIN transport_stops st ON st.stop_id = a.stop_id AND st.organization_id = $1
      `, [orgId, studentIds]);
      rows.forEach((r) => extra.set(r.student_id, r));
    }
    const x = (r) => extra.get(r.student_id) || {};
    const t = simple({
      name: (r) => fullName(r.first_name, r.last_name), first: (r) => r.first_name, last: (r) => r.last_name,
      sid: (r) => r.custom_student_id, class: (r) => r.class_name, gender: (r) => r.gender,
      dob: (r) => fmtDate(r.date_of_birth), age: (r) => ageOf(r.date_of_birth), email: (r) => r.email,
      address: (r) => r.address, hometown: (r) => r.hometown,
      parent: (r) => fullName(x(r).g_first, x(r).g_last), parent_phone: (r) => x(r).g_phone, parent_email: (r) => x(r).g_email,
      bus: (r) => x(r).bus, route: (r) => x(r).route, stop: (r) => x(r).stop,
    });
    return { columns: t.columns, rows: t.rowsFrom(roster), term: termLabel };
  }

  if (source === 'guardians') {
    const roster = await loadRoster(db, orgId, term, classFilter);
    if (!roster.length) return { columns: picked.map((k) => allowed.get(k)), rows: [], term: termLabel };
    const byId = new Map(roster.map((r) => [r.student_id, r]));
    const { rows } = await db.query(`
      SELECT DISTINCT ON (g.guardian_id, s.student_id) g.guardian_id, s.student_id, g.first_name, g.last_name, g.phone, g.email, g.address, gs.relationship
      FROM UNNEST($2::int[]) AS s(student_id)
      JOIN guardians g ON g.organization_id = $1
      LEFT JOIN guardian_students gs ON gs.guardian_id = g.guardian_id AND gs.student_id = s.student_id
      WHERE gs.student_id IS NOT NULL OR g.student_id = s.student_id
      ORDER BY g.guardian_id, s.student_id, gs.relationship NULLS LAST
    `, [orgId, roster.map((r) => r.student_id)]);
    const order = new Map(roster.map((r, i) => [r.student_id, i]));
    rows.sort((a, b) => order.get(a.student_id) - order.get(b.student_id) || a.guardian_id - b.guardian_id);
    const kid = (r) => byId.get(r.student_id) || {};
    const t = simple({
      name: (r) => fullName(r.first_name, r.last_name), relationship: (r) => r.relationship, phone: (r) => r.phone,
      email: (r) => r.email, address: (r) => r.address, child: (r) => fullName(kid(r).first_name, kid(r).last_name),
      class: (r) => kid(r).class_name,
    });
    return { columns: t.columns, rows: t.rowsFrom(rows), term: termLabel };
  }

  if (source === 'subjects') {
    const { rows } = await db.query(`
      SELECT DISTINCT ON (c.class_id, LOWER(sub.subject_name)) sub.subject_name, c.class_name, c.class_id, c.dashboard_sort_order
      FROM subjects sub JOIN classes c ON c.class_id = sub.class_id AND c.organization_id = $1
      WHERE sub.organization_id = $1 AND (sub.term_id = $2 OR sub.term_id IS NULL)
        AND ($3::int[] IS NULL OR sub.class_id = ANY($3::int[]))
      ORDER BY c.class_id, LOWER(sub.subject_name), sub.term_id NULLS LAST
    `, [orgId, term.term_id, classFilter]);
    rows.sort((a, b) => (a.dashboard_sort_order ?? 2147483647) - (b.dashboard_sort_order ?? 2147483647) || a.class_name.localeCompare(b.class_name) || a.subject_name.localeCompare(b.subject_name));
    const t = simple({ subject: (r) => r.subject_name, class: (r) => r.class_name });
    return { columns: t.columns, rows: t.rowsFrom(rows), term: termLabel };
  }

  if (source === 'staff') {
    const { rows } = await db.query(`
      SELECT u.first_name, u.last_name, u.email, u.phone_number, COALESCE(NULLIF(u.org_role_title, ''), u.account_type::text) AS role, c.class_name
      FROM users u LEFT JOIN classes c ON c.class_id = u.class_id AND c.organization_id = $1
      WHERE u.organization_id = $1 AND u.account_type::text NOT IN ('Guardian', 'Parent', 'Student')
      ORDER BY u.first_name, u.last_name
    `, [orgId]);
    const t = simple({
      name: (r) => fullName(r.first_name, r.last_name), role: (r) => r.role, email: (r) => r.email,
      phone: (r) => r.phone_number, class: (r) => r.class_name,
    });
    return { columns: t.columns, rows: t.rowsFrom(rows), term: null };
  }

  if (source === 'attendance') {
    const roster = await loadRoster(db, orgId, term, classFilter);
    const { rows } = roster.length ? await db.query(`
      SELECT student_id,
             COUNT(*) FILTER (WHERE status::text ILIKE 'present' OR status::text ILIKE 'late') AS present,
             COUNT(*) FILTER (WHERE status::text ILIKE 'absent') AS absent,
             COUNT(*) AS total
      FROM attendance_records
      WHERE organization_id = $1 AND term_id = $2 AND student_id = ANY($3::int[])
      GROUP BY student_id
    `, [orgId, term.term_id, roster.map((r) => r.student_id)]) : { rows: [] };
    const att = new Map(rows.map((r) => [r.student_id, r]));
    const a = (r) => att.get(r.student_id) || { present: 0, absent: 0, total: 0 };
    const t = simple({
      name: (r) => fullName(r.first_name, r.last_name), sid: (r) => r.custom_student_id, class: (r) => r.class_name,
      present: (r) => Number(a(r).present), absent: (r) => Number(a(r).absent), total: (r) => Number(a(r).total),
      rate: (r) => (Number(a(r).total) ? round1((100 * Number(a(r).present)) / Number(a(r).total)) : ''),
    });
    return { columns: t.columns, rows: t.rowsFrom(roster), term: termLabel };
  }

  // results: one row per student, a column per subject.
  const roster = await loadRoster(db, orgId, term, classFilter);
  const { rows } = roster.length ? await db.query(`
    SELECT p.student_id, sub.subject_name, p.total_subject_score, p.position
    FROM student_term_positions p JOIN subjects sub ON sub.subject_id = p.subject_id
    WHERE p.organization_id = $1 AND p.term_id = $2 AND p.student_id = ANY($3::int[])
  `, [orgId, term.term_id, roster.map((r) => r.student_id)]) : { rows: [] };
  const subjects = Array.from(new Set(rows.map((r) => r.subject_name))).sort((x, y) => x.localeCompare(y));
  const res = new Map();
  rows.forEach((r) => {
    if (!res.has(r.student_id)) res.set(r.student_id, {});
    res.get(r.student_id)[r.subject_name] = r;
  });
  const columns = [];
  const getters = [];
  picked.forEach((k) => {
    if (k === 'name') { columns.push('Student'); getters.push((r) => fullName(r.first_name, r.last_name)); }
    else if (k === 'sid') { columns.push('Student ID'); getters.push((r) => r.custom_student_id || ''); }
    else if (k === 'class') { columns.push('Class'); getters.push((r) => r.class_name); }
    else if (k === 'scores') subjects.forEach((s) => { columns.push(s); getters.push((r) => { const v = (res.get(r.student_id) || {})[s]; return v ? round1(v.total_subject_score) : ''; }); });
    else if (k === 'positions') subjects.forEach((s) => { columns.push(s + ' position'); getters.push((r) => { const v = (res.get(r.student_id) || {})[s]; return v && v.position ? v.position : ''; }); });
    else if (k === 'average') {
      columns.push('Average');
      getters.push((r) => {
        const vals = Object.values(res.get(r.student_id) || {}).map((v) => Number(v.total_subject_score)).filter((n) => !Number.isNaN(n));
        return vals.length ? round1(vals.reduce((a2, b) => a2 + b, 0) / vals.length) : '';
      });
    }
  });
  return { columns, rows: roster.map((r) => getters.map((g) => g(r))), term: termLabel };
}

module.exports = { SOURCES, describeSources, buildData, resolveTerm };
