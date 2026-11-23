// What's attached to a record before Mira deletes it (GET /internal/api/delete-check): read-only
// counts of everything that points at it. Mira's delete tools call this first and, by default,
// don't delete anything that has records attached (mira/tools/_attached.js):
//   cascades: false  the delete itself is blocked while these exist (a class with students, a
//                    term with attendance): Mira lists them and the steps to clear them.
//   cascades: true   the delete would remove these too (a subject's 12,000 scores, an
//                    enrollment's placements, a bus's riders): it runs only when the person has
//                    asked for that, with every attached record listed in the preview.
const db = require("../config/db");

const count = async (sql, params) => Number((await db.query(sql, params)).rows[0]?.n || 0);
const norm = (value) => String(value || "").trim().replace(/\s+/g, " ").toLowerCase();

async function termsFor(org, yearLabel, termName) {
  const { rows } = await db.query(
    `SELECT t.term_id, t.term_name, sy.year_label, sy.id AS year_id FROM terms t LEFT JOIN school_years sy ON sy.id = t.school_year_id
      WHERE t.organization_id = $1 AND ($2::text IS NULL OR lower(btrim(sy.year_label)) = $2) AND ($3::text IS NULL OR lower(btrim(t.term_name)) = $3)`,
    [org, yearLabel ? norm(yearLabel) : null, termName ? norm(termName) : null]
  );
  return rows;
}

// Each kind: find it, then count what's attached. Returns { name, attached: [{ what, count }], cascades, clear }.
const KINDS = {
  async class(org, q) {
    const { rows } = await db.query("SELECT class_id, class_name FROM classes WHERE organization_id = $1 AND obsolete_at IS NULL AND lower(btrim(class_name)) = $2", [org, norm(q.name)]);
    if (!rows.length) return null;
    const id = rows[0].class_id;
    const p = [org, id];
    return {
      name: rows[0].class_name, cascades: false,
      attached: [
        ["students in it now", await count("SELECT count(*) n FROM students WHERE organization_id = $1 AND class_id = $2 AND graduated IS NOT TRUE", p)],
        ["student placements in enrollments", await count("SELECT count(*) n FROM enrolled_students es JOIN enrollments e ON e.enrollment_id = es.enrollment_id WHERE e.organization_id = $1 AND es.class_id = $2", p)],
        ["attendance records", await count("SELECT count(*) n FROM attendance_records WHERE organization_id = $1 AND class_id = $2", p)],
        ["assessments", await count("SELECT count(*) n FROM assessments WHERE organization_id = $1 AND class_id = $2", p)],
        ["subjects", await count("SELECT count(*) n FROM subjects WHERE organization_id = $1 AND class_id = $2 AND obsolete_at IS NULL", p)],
        ["teachers assigned", await count("SELECT count(*) n FROM user_classes uc JOIN users u ON u.user_id = uc.user_id WHERE u.organization_id = $1 AND uc.class_id = $2", p)],
        ["posted report cards", await count("SELECT count(*) n FROM posted_report_cards WHERE organization_id = $1 AND class_id = $2", p)],
      ],
      clear: ["move its students to another class (or archive them)", "remove the class from each term's enrollment", "move or delete its assessments and subjects", "unassign its teachers"],
    };
  },
  async term(org, q) {
    const terms = await termsFor(org, q.yearLabel, q.termName || q.name);
    if (terms.length !== 1) return terms.length ? { ambiguous: terms.map((t) => `${t.term_name} ${t.year_label || ""}`.trim()) } : null;
    const t = terms[0];
    const p = [org, t.term_id];
    return {
      name: `${t.term_name}${t.year_label ? ` ${t.year_label}` : ""}`, cascades: false,
      attached: [
        ["classes open in its enrollment", await count("SELECT count(*) n FROM enrolled_classes ec JOIN enrollments e ON e.enrollment_id = ec.enrollment_id WHERE e.organization_id = $1 AND e.term_id = $2", p)],
        ["student placements", await count("SELECT count(*) n FROM enrolled_students es JOIN enrollments e ON e.enrollment_id = es.enrollment_id WHERE e.organization_id = $1 AND e.term_id = $2", p)],
        ["attendance records", await count("SELECT count(*) n FROM attendance_records WHERE organization_id = $1 AND term_id = $2", p)],
        ["assessments", await count("SELECT count(*) n FROM assessments WHERE organization_id = $1 AND term_id = $2", p)],
        ["report-card remarks", await count("SELECT count(*) n FROM student_reports WHERE organization_id = $1 AND term_id = $2", p)],
        ["posted report cards", await count("SELECT count(*) n FROM posted_report_cards WHERE organization_id = $1 AND term_id = $2", p)],
      ],
      clear: ["delete the term's enrollment", "delete or move its assessments", "attendance records can't be removed from Mira: they stay with the term"],
    };
  },
  async school_year(org, q) {
    const terms = await termsFor(org, q.yearLabel || q.name, null);
    if (!terms.length) return null;
    const ids = terms.map((t) => t.term_id);
    const p = [org, ids];
    return {
      name: terms[0].year_label, cascades: false,
      attached: [
        ["terms", terms.length],
        ["student placements", await count("SELECT count(*) n FROM enrolled_students es JOIN enrollments e ON e.enrollment_id = es.enrollment_id WHERE e.organization_id = $1 AND e.term_id = ANY($2::int[])", p)],
        ["attendance records", await count("SELECT count(*) n FROM attendance_records WHERE organization_id = $1 AND term_id = ANY($2::int[])", p)],
        ["assessments", await count("SELECT count(*) n FROM assessments WHERE organization_id = $1 AND term_id = ANY($2::int[])", p)],
        ["posted report cards", await count("SELECT count(*) n FROM posted_report_cards WHERE organization_id = $1 AND term_id = ANY($2::int[])", p)],
      ],
      clear: ["clear each of its terms first (their enrollments and assessments)", "attendance records can't be removed from Mira: they stay with the year"],
    };
  },
  async enrollment(org, q) {
    const terms = await termsFor(org, q.yearLabel, q.termName || q.name);
    if (terms.length !== 1) return terms.length ? { ambiguous: terms.map((t) => `${t.term_name} ${t.year_label || ""}`.trim()) } : null;
    const p = [org, terms[0].term_id];
    return {
      name: `the ${terms[0].term_name}${terms[0].year_label ? ` ${terms[0].year_label}` : ""} enrollment`, cascades: true,
      attached: [
        ["classes open in it", await count("SELECT count(*) n FROM enrolled_classes ec JOIN enrollments e ON e.enrollment_id = ec.enrollment_id WHERE e.organization_id = $1 AND e.term_id = $2", p)],
        ["student placements (every student's class for the term)", await count("SELECT count(*) n FROM enrolled_students es JOIN enrollments e ON e.enrollment_id = es.enrollment_id WHERE e.organization_id = $1 AND e.term_id = $2", p)],
      ],
      clear: [],
    };
  },
  async subject(org, q) {
    const { rows } = await db.query(
      `SELECT s.subject_id FROM subjects s LEFT JOIN classes c ON c.class_id = s.class_id
        WHERE s.organization_id = $1 AND s.obsolete_at IS NULL AND lower(btrim(s.subject_name)) = $2 AND ($3::text IS NULL OR lower(btrim(c.class_name)) = $3)`,
      [org, norm(q.name), q.className ? norm(q.className) : null]
    );
    if (!rows.length) return null;
    const p = [org, rows.map((r) => r.subject_id)];
    return {
      name: `${q.name}${q.className ? ` in ${q.className}` : " (every class)"}`, cascades: true,
      attached: [
        ["classes it's in", rows.length],
        ["assessments", await count("SELECT count(*) n FROM assessments WHERE organization_id = $1 AND subject_id = ANY($2::int[])", p)],
        ["student scores", await count("SELECT count(*) n FROM assessment_results ar JOIN assessments a ON a.assessment_id = ar.assessment_id WHERE a.organization_id = $1 AND a.subject_id = ANY($2::int[])", p).catch(() => 0)],
        ["student subject places", await count("SELECT count(*) n FROM student_subjects WHERE organization_id = $1 AND subject_id = ANY($2::int[])", p)],
      ],
      clear: [],
    };
  },
  async bus(org, q) { return transport(org, "bus_id", "SELECT bus_id AS id, bus_number AS name FROM transport_buses WHERE organization_id = $1 AND lower(btrim(bus_number::text)) = $2", q, "bus"); },
  async route(org, q) { return transport(org, "route_id", "SELECT route_id AS id, route_name AS name FROM transport_routes WHERE organization_id = $1 AND lower(btrim(route_name)) = $2", q, "route"); },
  async stop(org, q) { return transport(org, "stop_id", "SELECT stop_id AS id, stop_name AS name FROM transport_stops WHERE organization_id = $1 AND lower(btrim(stop_name)) = $2", q, "stop"); },
  async document(org, q) {
    const { rows } = await db.query(
      "SELECT id, title FROM documents WHERE organization_id = $1 AND is_deleted IS NOT TRUE AND ($2::int IS NULL OR id = $2) AND ($3::text IS NULL OR lower(btrim(title)) = $3)",
      [org, q.documentId ? Number(q.documentId) : null, q.name ? norm(q.name) : null]
    );
    if (rows.length !== 1) return rows.length ? { ambiguous: rows.map((r) => `${r.title} (${r.id})`) } : null;
    const p = [rows[0].id];
    return {
      name: rows[0].title, cascades: true,
      attached: [
        ["classes it's assigned to", await count("SELECT count(*) n FROM document_class_assignments WHERE document_id = $1", p)],
        ["people it's shared with", await count("SELECT count(*) n FROM document_permissions WHERE document_id = $1", p)],
      ],
      clear: [],
    };
  },
};

async function transport(org, column, findSql, q, what) {
  const { rows } = await db.query(findSql, [org, norm(q.name)]);
  if (!rows.length) return null;
  return {
    name: `${what} ${rows[0].name}`, cascades: true,
    attached: [["students assigned to it", await count(`SELECT count(*) n FROM transport_student_assignments WHERE organization_id = $1 AND ${column} = $2 AND active IS NOT FALSE`, [org, rows[0].id])]],
    clear: [],
  };
}

// GET /internal/api/delete-check?kind=class&name=...&yearLabel=&termName=&className=&documentId=
async function deleteCheck(req, res) {
  try {
    const org = parseInt(req.query.organizationId, 10);
    if (!Number.isInteger(org)) return res.status(400).json({ error: "organizationId is required." });
    const kind = String(req.query.kind || "");
    if (!KINDS[kind]) return res.status(400).json({ error: `Unknown kind "${kind}".` });
    const found = await KINDS[kind](org, req.query);
    if (!found) return res.json({ kind, found: false });
    if (found.ambiguous) return res.json({ kind, found: true, ambiguous: found.ambiguous });
    const attached = found.attached.filter(([, n]) => n > 0).map(([what, n]) => ({ what, count: n }));
    return res.json({ kind, found: true, name: found.name, cascades: found.cascades, attached, total: attached.reduce((s, a) => s + a.count, 0), clear: found.clear });
  } catch (error) {
    console.error("[internalApi/deleteCheck]", error);
    return res.status(500).json({ error: "Couldn't check what's attached." });
  }
}

module.exports = { deleteCheck };
