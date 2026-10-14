// Saved records that keep a school year, term, class or subject from being
// deleted. Past report cards, transcripts, attendance and reports have to stay
// exactly as they were, so anything that already holds records stays.
// Setup that only describes the item (grade bands, report settings, teacher
// assignments, the class list for a term) does not block: it goes with it.

const ENROLLED_IN_TERMS = {
  label: ["student enrollment", "student enrollments"],
  sql: `SELECT COUNT(*)::int AS n FROM enrolled_students es
          JOIN enrollments e ON e.enrollment_id = es.enrollment_id
         WHERE e.organization_id = $2 AND e.term_id = ANY($1::int[])`,
};

const SOURCES = {
  term: [
    { table: "assessment_results", column: "term_id", label: ["score", "scores"] },
    { table: "assessments", column: "term_id", label: ["assessment", "assessments"] },
    { table: "attendance_records", column: "term_id", label: ["attendance record", "attendance records"] },
    ENROLLED_IN_TERMS,
    { table: "category_scores", column: "term_id", label: ["score total", "score totals"] },
    { table: "student_term_positions", column: "term_id", label: ["subject position", "subject positions"] },
    { table: "class_positions", column: "term_id", label: ["class position", "class positions"] },
    { table: "posted_report_cards", column: "term_id", label: ["posted report card", "posted report cards"] },
    { table: "student_reports", column: "term_id", label: ["student report", "student reports"] },
    { table: "finance_bills", column: "term_id", label: ["bill", "bills"] },
    { table: "class_schedules", column: "term_id", label: ["class timetable", "class timetables"] },
    { table: "school_events", column: "term_id", label: ["event", "events"] },
    { table: "announcements", column: "term_id", label: ["announcement", "announcements"] },
    { table: "promotion_subject_selections", column: "term_id", label: ["promotion choice", "promotion choices"] },
    { table: "student_assessment_attempts", column: "term_id", label: ["online test attempt", "online test attempts"] },
    { table: "assessment_question_sets", column: "term_id", label: ["question set", "question sets"] },
    { table: "report_paygira_manual_overrides", column: "term_id", label: ["report fee override", "report fee overrides"] },
    { table: "pending_students", column: "term_id", label: ["pending admission", "pending admissions"] },
  ],
  schoolYear: [
    { table: "class_positions", column: "school_year_id", label: ["class position", "class positions"] },
    { table: "posted_report_cards", column: "school_year_id", label: ["posted report card", "posted report cards"] },
    { table: "finance_bills", column: "school_year_id", label: ["bill", "bills"] },
    { table: "school_events", column: "school_year_id", label: ["event", "events"] },
    { table: "announcements", column: "school_year_id", label: ["announcement", "announcements"] },
    { table: "pending_students", column: "school_year_id", label: ["pending admission", "pending admissions"] },
    {
      label: ["student enrollment", "student enrollments"],
      sql: `SELECT COUNT(*)::int AS n FROM enrolled_students es
              JOIN enrollments e ON e.enrollment_id = es.enrollment_id
             WHERE e.organization_id = $2 AND e.school_year_id = ANY($1::int[])`,
    },
  ],
  class: [
    {
      label: ["student currently in the class", "students currently in the class"],
      sql: `SELECT COUNT(*)::int AS n FROM students
             WHERE organization_id = $2 AND class_id = ANY($1::int[]) AND NOT COALESCE(graduated, FALSE)`,
    },
    {
      label: ["student enrollment", "student enrollments"],
      sql: `SELECT COUNT(*)::int AS n FROM enrolled_students es
              JOIN enrollments e ON e.enrollment_id = es.enrollment_id
             WHERE e.organization_id = $2 AND es.class_id = ANY($1::int[])`,
    },
    { table: "assessment_results", column: "class_id", label: ["score", "scores"] },
    { table: "assessments", column: "class_id", label: ["assessment", "assessments"] },
    { table: "attendance_records", column: "class_id", label: ["attendance record", "attendance records"] },
    { table: "category_scores", column: "class_id", label: ["score total", "score totals"] },
    { table: "student_term_positions", column: "class_id", label: ["subject position", "subject positions"] },
    { table: "class_positions", column: "class_id", label: ["class position", "class positions"] },
    { table: "posted_report_cards", column: "class_id", label: ["posted report card", "posted report cards"] },
    { table: "student_reports", column: "class_id", label: ["student report", "student reports"] },
    { table: "class_schedules", column: "class_id", label: ["class timetable", "class timetables"] },
    { table: "student_assessment_attempts", column: "class_id", label: ["online test attempt", "online test attempts"] },
    { table: "assessment_question_sets", column: "class_id", label: ["question set", "question sets"] },
    { table: "finance_collection_signoffs", column: "class_id", label: ["fee collection sign-off", "fee collection sign-offs"] },
    { table: "report_paygira_manual_overrides", column: "class_id", label: ["report fee override", "report fee overrides"] },
    { table: "pending_students", column: "class_id", label: ["pending admission", "pending admissions"] },
  ],
  subject: [
    { table: "assessment_results", column: "subject_id", label: ["score", "scores"] },
    { table: "assessments", column: "subject_id", label: ["assessment", "assessments"] },
    { table: "category_scores", column: "subject_id", label: ["score total", "score totals"] },
    { table: "student_term_positions", column: "subject_id", label: ["subject position", "subject positions"] },
    { table: "assessment_question_sets", column: "subject_id", label: ["question set", "question sets"] },
    { table: "promotion_subject_selections", column: "subject_id", label: ["promotion choice", "promotion choices"] },
    { table: "class_schedule_entries", column: "subject_id", label: ["timetable slot", "timetable slots"] },
    { table: "pending_student_subjects", column: "subject_id", label: ["pending admission choice", "pending admission choices"] },
  ],
};

// Which tables/columns exist (and which have organization_id), read once.
let schemaPromise = null;
function loadSchema(db) {
  if (!schemaPromise) {
    schemaPromise = db
      .query(`SELECT table_name, column_name FROM information_schema.columns WHERE table_schema = 'public'`)
      .then(({ rows }) => {
        const columns = new Map();
        rows.forEach(({ table_name: table, column_name: column }) => {
          if (!columns.has(table)) columns.set(table, new Set());
          columns.get(table).add(column);
        });
        return columns;
      })
      .catch((err) => {
        schemaPromise = null;
        throw err;
      });
  }
  return schemaPromise;
}

// The saved records for these ids, e.g. [{ count: 72, text: "72 scores" }].
async function savedRecords(db, kind, ids, organizationId) {
  const safeIds = (Array.isArray(ids) ? ids : [ids]).map(Number).filter((id) => Number.isInteger(id) && id > 0);
  if (!safeIds.length || !SOURCES[kind]) return [];
  const columns = await loadSchema(db);
  const found = [];
  for (const source of SOURCES[kind]) {
    let sql = source.sql;
    let params = [safeIds, organizationId];
    if (!sql) {
      const tableColumns = columns.get(source.table);
      if (!tableColumns || !tableColumns.has(source.column)) continue;
      const scoped = tableColumns.has("organization_id");
      sql = `SELECT COUNT(*)::int AS n FROM ${source.table} WHERE ${source.column} = ANY($1::int[])${scoped ? " AND organization_id = $2" : ""}`;
      if (!scoped) params = [safeIds];
    }
    const { rows } = await db.query(sql, params);
    const count = Number(rows[0] && rows[0].n) || 0;
    if (count > 0) {
      found.push({ count, text: `${count.toLocaleString("en-US")} ${count === 1 ? source.label[0] : source.label[1]}` });
    }
  }
  return found;
}

function joinList(parts) {
  if (parts.length <= 1) return parts.join("");
  return `${parts.slice(0, -1).join(", ")} and ${parts[parts.length - 1]}`;
}

// "“Mathematics” in 3rd Grade can't be deleted because it already has saved
// records: 72 scores and 4 assessments. ..."
function savedRecordsMessage(what, records) {
  const top = records.slice().sort((a, b) => b.count - a.count);
  const shown = top.slice(0, 5).map((r) => r.text);
  if (top.length > 5) shown.push(`${top.length - 5} more kind${top.length - 5 === 1 ? "" : "s"} of record`);
  return `${what} can't be deleted because it already has saved records: ${joinList(shown)}. ` +
    "They are kept so past report cards, transcripts and reports stay exactly as they were.";
}

// Setup that belongs only to these terms, removed before the terms themselves.
// The school's attendance calendar is moved to another term instead of going
// with them (it holds the school's weekends and holidays).
async function clearTermSetup(client, organizationId, termIds) {
  const ids = termIds.map(Number).filter(Number.isInteger);
  if (!ids.length) return;
  const columns = await loadSchema(client);
  const replacement = await client.query(
    `SELECT t.term_id, t.school_year_id FROM terms t
      WHERE t.organization_id = $1 AND t.term_id <> ALL($2::int[])
      ORDER BY t.current DESC, t.start_date DESC NULLS LAST, t.term_id DESC
      LIMIT 1`,
    [organizationId, ids]
  );
  if (replacement.rows.length && columns.has("organization_attendance_calendars")) {
    await client.query(
      `UPDATE organization_attendance_calendars SET term_id = $3, school_year_id = $4
        WHERE organization_id = $1 AND term_id = ANY($2::int[])`,
      [organizationId, ids, replacement.rows[0].term_id, replacement.rows[0].school_year_id]
    );
  }
  // Enrollments with no students are just the class list for the term.
  await client.query(
    `DELETE FROM enrolled_classes WHERE enrollment_id IN (
       SELECT e.enrollment_id FROM enrollments e
        WHERE e.organization_id = $1 AND e.term_id = ANY($2::int[])
          AND NOT EXISTS (SELECT 1 FROM enrolled_students es WHERE es.enrollment_id = e.enrollment_id))`,
    [organizationId, ids]
  );
  await client.query(
    `DELETE FROM enrollments e WHERE e.organization_id = $1 AND e.term_id = ANY($2::int[])
        AND NOT EXISTS (SELECT 1 FROM enrolled_students es WHERE es.enrollment_id = e.enrollment_id)`,
    [organizationId, ids]
  );
  const setupTables = [
    "term_classes", "score_remarks", "score_remark_class_locks", "score_remark_default_state",
    "score_remark_rule_locks", "report_settings", "status_settings", "staff_term_popup_views",
    "google_classroom_course_mappings",
  ];
  for (const table of setupTables) {
    const tableColumns = columns.get(table);
    if (!tableColumns || !tableColumns.has("term_id")) continue;
    const scoped = tableColumns.has("organization_id");
    await client.query(
      `DELETE FROM ${table} WHERE term_id = ANY($1::int[])${scoped ? " AND organization_id = $2" : ""}`,
      scoped ? [ids, organizationId] : [ids]
    );
  }
}

module.exports = { savedRecords, savedRecordsMessage, clearTermSetup };
