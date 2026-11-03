const { UNIFORM_SUBJECT_SCALING_TERM_ID } = require("./uniformSubjectScaling");
// Report Builder definitions. Every report is a fixed, reviewed SQL source:
// users only pick column keys and criteria values, which are validated against
// these definitions and always bound as query parameters.
//
// A report has a base `from` (a string, or a function of the criteria for
// reports that filter inside a grouped subquery) plus optional `joins` that
// are only added when a chosen column or criterion needs them.

const STUDENT_NAME = "TRIM(CONCAT_WS(' ', s.first_name, s.last_name))";
const STUDENT_ID = "COALESCE(NULLIF(TRIM(s.custom_student_id), ''), s.student_id::text)";
const CURRENT_TERM = `(SELECT ct.term_id FROM terms ct
   WHERE ct.organization_id = s.organization_id AND (ct.current_term OR ct.current)
   ORDER BY ct.current_term DESC, ct.start_date DESC NULLS LAST LIMIT 1)`;

const initcap = (expression) => `INITCAP(REPLACE(${expression}::text, '_', ' '))`;
const fullName = (alias) => `TRIM(CONCAT_WS(' ', ${alias}.first_name, ${alias}.last_name))`;
const audience = (expression) => `CASE ${expression} WHEN 'both' THEN 'Staff & parents' WHEN 'org' THEN 'Staff'
  WHEN 'public' THEN 'Public' ELSE INITCAP(${expression}) END`;

// ---- Shared joins and columns ----------------------------------------------

const STUDENT_JOINS = {
  parent: `LEFT JOIN LATERAL (
      SELECT
        STRING_AGG(DISTINCT NULLIF(TRIM(CONCAT_WS(' ', p.first_name, p.last_name)), ''), '; ') AS parent_name,
        -- Parent profile IDs; an older parent record's ID only when there's no profile.
        COALESCE(STRING_AGG(DISTINCT p.guardian_id::text, '; ') FILTER (WHERE p.source = 'p'),
                 STRING_AGG(DISTINCT p.guardian_id::text, '; ')) AS parent_id,
        STRING_AGG(DISTINCT NULLIF(TRIM(p.relationship), ''), '; ') AS parent_relationship,
        STRING_AGG(DISTINCT NULLIF(TRIM(p.phone), ''), '; ') AS parent_phone,
        STRING_AGG(DISTINCT NULLIF(TRIM(p.email), ''), '; ') AS parent_email,
        STRING_AGG(DISTINCT NULLIF(TRIM(p.address), ''), '; ') AS parent_address,
        -- The same person can be in both lists; count each name once.
        COUNT(DISTINCT LOWER(NULLIF(TRIM(CONCAT_WS(' ', p.first_name, p.last_name)), ''))) AS parent_count
      FROM (
        SELECT 'p' AS source, gp.guardian_id, gp.first_name, gp.last_name, gs.relationship, gp.phone, gp.email, gp.address
          FROM guardian_students gs
          JOIN guardian_profiles gp ON gp.guardian_id = gs.guardian_id AND gp.organization_id = s.organization_id
         WHERE gs.student_id = s.student_id
        UNION ALL
        SELECT 'g', g.guardian_id, g.first_name, g.last_name, NULL::varchar, g.phone, g.email, g.address
          FROM guardians g
         WHERE g.organization_id = s.organization_id AND g.student_id = s.student_id
      ) p
    ) parent ON TRUE`,
  attendance: `LEFT JOIN LATERAL (
      SELECT COUNT(*) AS days,
             COUNT(*) FILTER (WHERE a2.status::text ILIKE 'present') AS present,
             COUNT(*) FILTER (WHERE a2.status::text ILIKE 'absent') AS absent
        FROM attendance_records a2
       WHERE a2.student_id = s.student_id AND a2.organization_id = s.organization_id
         AND a2.term_id = ${CURRENT_TERM}
    ) att ON TRUE`,
  fees: `LEFT JOIN LATERAL (
      SELECT SUM(COALESCE(f2.amount, 0) + COALESCE(f2.late_fee_applied, 0)) AS billed,
             SUM(COALESCE(f2.amount_paid, 0)) AS paid,
             SUM(GREATEST(COALESCE(f2.amount, 0) + COALESCE(f2.late_fee_applied, 0) - COALESCE(f2.amount_paid, 0), 0)) AS balance
        FROM finance_bill_assignments f2
       WHERE f2.student_id = s.student_id AND f2.organization_id = s.organization_id
    ) fees ON TRUE`,
  portal: `LEFT JOIN LATERAL (
      SELECT sa.login_email FROM student_accounts sa
       WHERE sa.student_id = s.student_id AND sa.organization_id = s.organization_id
       LIMIT 1
    ) portal ON TRUE`,
  bus: `LEFT JOIN LATERAL (
      SELECT t2.route_id, r2.route_name, COALESCE(NULLIF(b2.bus_name, ''), b2.bus_number) AS bus_name, st2.stop_name,
             TO_CHAR(COALESCE(t2.pickup_time, st2.pickup_time), 'HH24:MI') AS pickup_time,
             TO_CHAR(COALESCE(t2.dropoff_time, st2.dropoff_time), 'HH24:MI') AS dropoff_time
        FROM transport_student_assignments t2
        LEFT JOIN transport_routes r2 ON r2.route_id = t2.route_id AND r2.organization_id = t2.organization_id
        LEFT JOIN transport_buses b2 ON b2.bus_id = t2.bus_id AND b2.organization_id = t2.organization_id
        LEFT JOIN transport_stops st2 ON st2.stop_id = t2.stop_id AND st2.organization_id = t2.organization_id
       WHERE t2.student_id = s.student_id AND t2.organization_id = s.organization_id AND COALESCE(t2.active, TRUE)
       ORDER BY t2.assignment_id DESC
       LIMIT 1
    ) bus ON TRUE`,
  archive: `LEFT JOIN LATERAL (
      SELECT a2.archive_kind, a2.reason, a2.reason_note, COALESCE(a2.archived_at_ts, a2.archived_at) AS left_at
        FROM archived_student_info a2
       WHERE a2.student_id = s.student_id AND a2.organization_id = s.organization_id
       ORDER BY COALESCE(a2.archived_at_ts, a2.archived_at) DESC NULLS LAST
       LIMIT 1
    ) arch ON TRUE`,
};

// Audit: what the activity log recorded about a row's record (who changed it
// last, when, what, and how often), read once per row through a join named
// "audit". Only log entries linked to the record count.
function auditJoin(recordTypes, idExpression) {
  // One pass over the school's log ($1 = organization id), grouped by record.
  return `LEFT JOIN (
      SELECT l.record_id, COUNT(*) AS changes, MAX(l.created_at) AS last_at, MIN(l.created_at) AS first_at,
             (ARRAY_AGG(l.user_name ORDER BY l.created_at DESC))[1] AS last_by,
             (ARRAY_AGG(CONCAT_WS(': ', l.action_type, NULLIF(LEFT(l.description, 120), '')) ORDER BY l.created_at DESC))[1] AS last_action
        FROM organization_activity_logs l
       WHERE l.organization_id = $1 AND l.record_type IN (${recordTypes.map((t) => `'${t}'`).join(", ")})
         AND l.record_id IS NOT NULL
       GROUP BY l.record_id
    ) audit ON audit.record_id = (${idExpression})::text`;
}
const AUDIT_COLUMNS = {
  audit_last_at: { label: "Last changed", expression: "audit.last_at", type: "datetime", group: "Audit", join: "audit" },
  audit_last_by: { label: "Last changed by", expression: "audit.last_by", group: "Audit", join: "audit" },
  audit_last_action: { label: "Last change", expression: "audit.last_action", group: "Audit", join: "audit" },
  audit_first_at: { label: "First recorded", expression: "audit.first_at", type: "datetime", group: "Audit", join: "audit" },
  audit_count: { label: "Changes recorded", expression: "COALESCE(audit.changes, 0)", type: "number", group: "Audit", join: "audit" },
};

// Every report about students offers these (a report's own column with the
// same key wins).
const STUDENT_COLUMNS = {
  student_name: { label: "Student name", expression: STUDENT_NAME },
  student_id: { label: "Student ID", expression: STUDENT_ID },
  first_name: { label: "First name", expression: "s.first_name" },
  last_name: { label: "Last name", expression: "s.last_name" },
  gender: { label: "Gender", expression: initcap("s.gender") },
  date_of_birth: { label: "Date of birth", expression: "s.date_of_birth", type: "date" },
  email: { label: "Student email", expression: "s.email" },
  hometown: { label: "Hometown", expression: "s.hometown" },
  address: { label: "Home address", expression: "s.address" },
  ...AUDIT_COLUMNS,
};

const PARENT_COLUMNS = {
  parent_name: { label: "Parent / guardian", expression: "parent.parent_name", join: "parent" },
  parent_id: { label: "Parent ID", expression: "parent.parent_id", join: "parent" },
  parent_relationship: { label: "Relationship", expression: "parent.parent_relationship", join: "parent" },
  parent_phone: { label: "Parent phone", expression: "parent.parent_phone", join: "parent" },
  parent_email: { label: "Parent email", expression: "parent.parent_email", join: "parent" },
  parent_address: { label: "Parent address", expression: "parent.parent_address", join: "parent" },
  parent_count: { label: "No. of parents", expression: "COALESCE(parent.parent_count, 0)", type: "number", join: "parent" },
};

const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const birthMonthCriterion = (expression, key = "birth_month") => choiceCriterion(key, "Birth month",
  MONTHS.map((name, i) => ({ value: String(i + 1), label: name, sql: `EXTRACT(MONTH FROM ${expression}) = ${i + 1}` })));
// IDs match exactly; several can be listed ("12, 15").
const idCriterion = (key, label, where) => ({
  key, label, type: "text",
  where: (bind, value) => {
    const ids = splitTerms(value).filter((v) => /^\d+$/.test(v)).map(Number).filter(Number.isSafeInteger);
    return ids.length ? where(bind(ids)) : "1 = 0";
  },
});

// ---- Criteria helpers ---------------------------------------------------------
// type: text | class | term | select (several values) | choice (one) | date
// where(bind, value) returns a SQL fragment; values only reach SQL through bind().

// Text criteria accept several names at once ("Ama, Kofi Mensah"): a record
// matches when any of them matches.
function splitTerms(value) {
  return [...new Set(String(value || "").split(/[,;\n]+/).map((term) => term.trim()).filter(Boolean))].slice(0, 25);
}

const fieldsMatch = (expressions) => (like) =>
  `(${expressions.map((expression) => `COALESCE(${expression}::text, '') ILIKE ${like}`).join(" OR ")})`;

// Name searches match from the start of a word ("Abena" finds "Abena Poku",
// not "Kwabena"); other text matches anywhere.
function textCriterion(key, label, match, { wordStart = false, ...extra } = {}) {
  return {
    key,
    label,
    type: "text",
    ...extra,
    where: (bind, value) => {
      const terms = splitTerms(value);
      if (!terms.length) return null;
      return `(${terms.map((term) => (wordStart
        ? `(${match(bind(`${term}%`))} OR ${match(bind(`% ${term}%`))})`
        : match(bind(`%${term}%`)))).join(" OR ")})`;
    },
  };
}
const nameCriterion = (key, label, match) => textCriterion(key, label, match, { wordStart: true });

const parentMatch = (fields) => (like) => `(EXISTS (
    SELECT 1 FROM guardian_students gsx
      JOIN guardian_profiles gpx ON gpx.guardian_id = gsx.guardian_id AND gpx.organization_id = s.organization_id
     WHERE gsx.student_id = s.student_id AND ${fieldsMatch(fields.map((field) => field.replace(/\bg\./g, "gpx.")))(like)})
  OR EXISTS (
    SELECT 1 FROM guardians gx
     WHERE gx.student_id = s.student_id AND gx.organization_id = s.organization_id
       AND ${fieldsMatch(fields.map((field) => field.replace(/\bg\./g, "gx.")))(like)}))`;

// "Student name" matches the start of a first or last name, so it covers both.
// Every report about students can be narrowed by these (a report's own
// criterion with the same key wins).
function studentCriteria() {
  return [
    nameCriterion("search", "Student name", fieldsMatch([STUDENT_NAME, "CONCAT_WS(' ', s.last_name, s.first_name)"])),
    textCriterion("student_id", "Student ID", fieldsMatch([STUDENT_ID])),
    textCriterion("student_email", "Student email", fieldsMatch(["s.email"])),
    selectCriterion("gender", "Gender", "s.gender", distinctOptions("students", "gender")),
    birthMonthCriterion("s.date_of_birth"),
    dateCriterion("Date of birth between", "s.date_of_birth", "dob"),
    textCriterion("hometown", "Hometown", fieldsMatch(["s.hometown"])),
    textCriterion("home_address", "Home address", fieldsMatch(["s.address"])),
    nameCriterion("parent", "Parent name", parentMatch(["CONCAT_WS(' ', g.first_name, g.last_name)"])),
    idCriterion("parent_id", "Parent ID", (ids) => `(EXISTS (SELECT 1 FROM guardian_students gsi WHERE gsi.student_id = s.student_id AND gsi.guardian_id = ANY(${ids}::int[]))
      OR EXISTS (SELECT 1 FROM guardians gi WHERE gi.student_id = s.student_id AND gi.organization_id = s.organization_id AND gi.guardian_id = ANY(${ids}::int[])))`),
    textCriterion("parent_contact", "Parent phone or email", parentMatch(["g.phone", "g.email"])),
    textCriterion("parent_address", "Parent address", parentMatch(["g.address"])),
  ];
}

const classCriterion = (expression, label = "Class") => ({
  key: "class",
  label,
  type: "class",
  where: (bind, value) => `${expression} = ANY(${bind(value)}::int[])`,
});

const termCriterion = (expression) => ({
  termExpression: expression,
  key: "term",
  label: "Term",
  type: "term",
  where: (bind, value) => `${expression} = ANY(${bind(value)}::int[])`,
});

// Options come from the school's own data (optionsSql takes $1 = organization id
// and returns value/label); the chosen value is bound as text.
function selectCriterion(key, label, expression, optionsSql, extra = {}) {
  return {
    key,
    label,
    type: "select",
    optionsSql,
    ...extra,
    where: (bind, value) => `${expression}::text = ANY(${bind(value)}::text[])`,
  };
}

// Fixed choices that map to reviewed SQL fragments (no user value reaches SQL).
function choiceCriterion(key, label, options, extra = {}) {
  return {
    key,
    label,
    type: "choice",
    ...extra,
    options: options.map(({ value, label: optionLabel }) => ({ value, label: optionLabel })),
    where: (bind, value) => options.find((option) => option.value === value)?.sql || null,
  };
}

function dateRangeSql(bind, expression, value) {
  const clauses = [];
  if (value.from) clauses.push(`${expression} >= ${bind(value.from)}::date`);
  if (value.to) clauses.push(`${expression} < (${bind(value.to)}::date + 1)`);
  return clauses.length ? clauses.join(" AND ") : null;
}

function dateCriterion(label, expression, key = "date") {
  return { key, label, type: "date", where: (bind, value) => dateRangeSql(bind, expression, value) };
}

const distinctOptions = (table, expression, extra = "") => `
  SELECT DISTINCT ${expression}::text AS value, ${initcap(expression)} AS label
    FROM ${table}
   WHERE organization_id = $1 AND ${expression} IS NOT NULL AND ${expression}::text <> '' ${extra}
   ORDER BY 2 LIMIT 200`;

const CHANNEL_LABEL = (column) => `CASE ${column}
  WHEN 'email' THEN 'Email' WHEN 'sms' THEN 'Text (SMS)' WHEN 'whatsapp' THEN 'WhatsApp'
  WHEN 'report' THEN 'Report card' WHEN 'transcript' THEN 'Transcript' ELSE INITCAP(${column}) END`;

// Grouped attendance reports filter dates inside the subquery, so the date
// criterion is applied by `from` rather than the outer WHERE.
function attendanceRollup(groupBy, bind, criteria) {
  const dateSql = criteria.date ? dateRangeSql(bind, "date", criteria.date) : null;
  return `(
      SELECT organization_id, ${groupBy},
             COUNT(*) AS days,
             COUNT(*) FILTER (WHERE status::text ILIKE 'present') AS present,
             COUNT(*) FILTER (WHERE status::text ILIKE 'absent') AS absent
        FROM attendance_records
       ${dateSql ? `WHERE ${dateSql}` : ""}
       GROUP BY organization_id, ${groupBy}
    ) x`;
}

// ---- Merit sheet helpers ------------------------------------------------------

// A SQL string literal for school-defined names (subjects, categories, remark
// keys). The database uses standard strings, so doubling quotes is enough.
const sqlText = (value) => `'${String(value ?? "").replace(/\u0000/g, "").replace(/'/g, "''")}'`;
const shortHash = (value) => require("crypto").createHash("md5").update(String(value)).digest("hex").slice(0, 10);

function customRemarkTypes(db, organizationId) {
  return db.query(
    `SELECT id, type_key, label FROM organization_custom_remark_types
      WHERE organization_id = $1 AND obsolete_at IS NULL ORDER BY label, id`,
    [organizationId]
  ).then((result) => result.rows).catch(() => []);
}

// One row per student, subject, class and term: recorded scores summed (per
// assessment category too), out of the subject's maximum, and ranked within
// the subject. $1 is always the school; class and term narrow it early.
// Uniform subject scaling (as on the report card, utils/uniformSubjectScaling):
// each subject is scored out of the same base, every assessment counting by its
// weight (or its max score when the subject has no weights), missing scores as 0.
// The school chooses: "settings" (each class's Report Settings), or any
// number each subject is scored out of (1-1000). Not chosen = raw scores.
const scaleValue = (value) => {
  const text = String(value ?? "").trim();
  if (text === "settings") return text;
  const number = Number(text);
  return Number.isFinite(number) && number > 0 && number <= 1000 ? String(Math.round(number * 100) / 100) : null;
};
const scaleCriterion = () => ({
  key: "scale",
  label: "Subject scaling",
  type: "scale",
  group: "Scoring",
  // Each class's own Report Settings, shown (not changed) under "As in Report Settings".
  optionsSql: `SELECT c.class_id::text AS value,
      c.class_name || ': ' || CASE WHEN us.display_settings -> 'sections' -> 'uniformSubjectScaling' ->> 'enabled' = 'true'
        THEN 'each subject out of ' || COALESCE(NULLIF(us.display_settings -> 'sections' -> 'uniformSubjectScaling' ->> 'baseMaxScore', ''), '100')
        ELSE 'off (raw scores)' END AS label
      FROM classes c
      LEFT JOIN report_settings us ON us.organization_id = c.organization_id AND us.class_id = c.class_id AND us.term_id = ${UNIFORM_SUBJECT_SCALING_TERM_ID}
     WHERE c.organization_id = $1
     ORDER BY c.class_name`,
  inFrom: true,
  where: () => null,
});

function subjectTotals(bind, criteria) {
  const scope = (alias) => [
    criteria.class ? `AND ${alias}.class_id = ANY(${bind(criteria.class)}::int[])` : "",
    criteria.term ? `AND ${alias}.term_id = ANY(${bind(criteria.term)}::int[])` : "",
  ].join(" ");
  const scale = scaleValue(criteria.scale);
  // The base each subject is scored out of (NULL = raw scores).
  const base = !scale ? "NULL::numeric"
    : scale === "settings"
      ? `(SELECT CASE WHEN us.display_settings -> 'sections' -> 'uniformSubjectScaling' ->> 'enabled' = 'true'
                 THEN COALESCE(NULLIF(us.display_settings -> 'sections' -> 'uniformSubjectScaling' ->> 'baseMaxScore', '')::numeric, 100) END
            FROM report_settings us
           WHERE us.organization_id = r.organization_id AND us.class_id = r.class_id AND us.term_id = ${UNIFORM_SUBJECT_SCALING_TERM_ID}
           LIMIT 1)`
      : `${Number(scale)}::numeric`;
  return `(
      SELECT r.organization_id, r.student_id, r.class_id, r.term_id, r.subject_id, r.categories,
             CASE WHEN b.base IS NULL THEN r.raw_total
                  ELSE LEAST(b.base, r.scaled_sum / NULLIF(r.total_weight, 0) * b.base) END AS total,
             COALESCE(b.base, mx.max_total) AS max_total, sub.subject_name,
             RANK() OVER (PARTITION BY r.class_id, r.term_id, r.subject_id
                          ORDER BY ROUND(CASE WHEN b.base IS NULL THEN r.raw_total
                                              ELSE r.scaled_sum / NULLIF(r.total_weight, 0) * b.base END, 2) DESC NULLS LAST) AS subject_rank
        FROM (
          SELECT k.organization_id, k.student_id, k.class_id, k.term_id, k.subject_id,
                 SUM(k.cat_total) AS raw_total, SUM(k.cat_scaled) AS scaled_sum, MAX(k.total_weight) AS total_weight,
                 JSONB_OBJECT_AGG(k.category, k.cat_total) AS categories
            FROM (
              SELECT ar.organization_id, ar.student_id, ar.class_id, ar.term_id, a.subject_id,
                     COALESCE(NULLIF(TRIM(a.category), ''), 'Other') AS category, SUM(ar.score) AS cat_total,
                     SUM(LEAST(1, GREATEST(0, ar.score / NULLIF(a.max_score, 0)))
                         * CASE WHEN sw.weighted THEN COALESCE(a.weight, 0) ELSE a.max_score END) AS cat_scaled,
                     MAX(CASE WHEN sw.weighted THEN sw.weight_sum ELSE sw.max_sum END) AS total_weight
                FROM assessment_results ar
                JOIN assessments a ON a.assessment_id = ar.assessment_id AND a.organization_id = ar.organization_id
                LEFT JOIN (
                  SELECT class_id, term_id, subject_id,
                         BOOL_OR(COALESCE(weight, 0) > 0) AS weighted,
                         SUM(GREATEST(COALESCE(weight, 0), 0)) AS weight_sum,
                         SUM(max_score) AS max_sum
                    FROM assessments
                   WHERE organization_id = $1 AND obsolete_at IS NULL AND COALESCE(entry_mode, 'score') = 'score' AND max_score > 0
                   GROUP BY 1, 2, 3
                ) sw ON sw.class_id = ar.class_id AND sw.term_id = ar.term_id AND sw.subject_id = a.subject_id
               WHERE ar.organization_id = $1 AND a.obsolete_at IS NULL AND COALESCE(a.entry_mode, 'score') = 'score'
                 ${scope("ar")}
               GROUP BY 1, 2, 3, 4, 5, 6
            ) k
           GROUP BY 1, 2, 3, 4, 5
        ) r
        LEFT JOIN LATERAL (SELECT ${base} AS base) b ON TRUE
        LEFT JOIN (
          SELECT class_id, term_id, subject_id, SUM(max_score) AS max_total
            FROM assessments
           WHERE organization_id = $1 AND obsolete_at IS NULL AND COALESCE(entry_mode, 'score') = 'score'
           GROUP BY 1, 2, 3
        ) mx ON mx.class_id = r.class_id AND mx.term_id = r.term_id AND mx.subject_id = r.subject_id
        LEFT JOIN subjects sub ON sub.subject_id = r.subject_id AND sub.organization_id = r.organization_id
    ) ss`;
}

// The class's grade band for a percentage: the band that contains it, else
// the nearest band (the same rule the merit sheet and report card use).
const gradeBand = (alias, percentage) => `LEFT JOIN LATERAL (
      SELECT NULLIF(TRIM(b.grade_label), '') AS grade, NULLIF(TRIM(b.remark), '') AS remark
        FROM score_remarks b
       WHERE b.organization_id = ${alias}.organization_id AND b.class_id = ${alias}.class_id
         AND b.term_id = ${alias}.term_id AND (${percentage}) IS NOT NULL
       ORDER BY CASE WHEN (${percentage}) BETWEEN b.from_percentage AND b.to_percentage THEN 0 ELSE 1 END,
                LEAST(ABS((${percentage}) - b.from_percentage), ABS((${percentage}) - b.to_percentage)),
                b.from_percentage DESC
       LIMIT 1
    ) band ON TRUE`;

// ---- Report definitions -----------------------------------------------------
// classExpression: reports with one can be scoped to a teacher's classes;
// reports without one are only offered to school-wide roles.

const REPORTS = {
  // Students
  students: {
    title: "Students",
    variant: "Students",
    permission: "manage_students",
    organizationExpression: "s.organization_id",
    classExpression: "s.class_id",
    stableOrderExpressions: ["s.student_id"],
    from: `FROM students s
      LEFT JOIN classes c ON c.class_id = s.class_id AND c.organization_id = s.organization_id`,
    joins: STUDENT_JOINS,
    defaultColumns: ["student_name", "student_id", "class_name", "gender", "student_status", "parent_name", "parent_phone"],
    defaultSort: { key: "student_name", dir: "asc" },
    columns: {
      ...STUDENT_COLUMNS,
      class_name: { label: "Class", expression: "c.class_name" },
      gender: { label: "Gender", expression: "s.gender" },
      date_of_birth: { label: "Date of birth", expression: "s.date_of_birth", type: "date" },
      age: { label: "Age", expression: "DATE_PART('year', AGE(s.date_of_birth))::int", type: "number" },
      email: { label: "Email", expression: "s.email" },
      hometown: { label: "Hometown", expression: "s.hometown" },
      address: { label: "Address", expression: "s.address" },
      student_status: {
        label: "Status",
        expression: "CASE WHEN arch.archive_kind IS NOT NULL THEN INITCAP(arch.archive_kind) WHEN COALESCE(s.graduated, FALSE) THEN 'Graduated' ELSE 'Active' END",
        join: "archive",
      },
      left_on: { label: "Left on", expression: "arch.left_at", type: "datetime", join: "archive" },
      leaving_reason: { label: "Reason for leaving", expression: "INITCAP(REPLACE(arch.reason, '_', ' '))", join: "archive" },
      portal_account: { label: "Student portal", expression: "CASE WHEN portal.login_email IS NULL THEN 'No' ELSE 'Yes' END", join: "portal" },
      bus_route: { label: "Bus route", expression: "bus.route_name", join: "bus", requires: "transport" },
      bus_stop: { label: "Bus stop", expression: "bus.stop_name", join: "bus", requires: "transport" },
      pickup_time: { label: "Pickup time", expression: "bus.pickup_time", join: "bus", requires: "transport" },
      days_absent: { label: "Absent (this term)", expression: "att.absent", type: "number", join: "attendance" },
      attendance_rate: { label: "Attendance % (this term)", expression: "ROUND(att.present * 100.0 / NULLIF(att.days, 0), 1)", type: "number", join: "attendance" },
      fee_balance: { label: "Fee balance", expression: "fees.balance", type: "money", join: "fees", permission: "manage_paygira", requires: "fees" },
      ...PARENT_COLUMNS,
      parent_relationship: { label: "Relationship", expression: "parent.parent_relationship", join: "parent" },
    },
    criteria: [
      ...studentCriteria({ parentContact: true }),
      classCriterion("s.class_id"),
      selectCriterion("gender", "Gender", "s.gender", distinctOptions("students", "gender")),
      choiceCriterion("status", "Status", [
        { value: "active", label: "Current students", sql: "arch.archive_kind IS NULL AND COALESCE(s.graduated, FALSE) = FALSE" },
        { value: "graduated", label: "Graduated", sql: "arch.archive_kind IS NULL AND COALESCE(s.graduated, FALSE) = TRUE" },
        { value: "left", label: "Withdrew or left", sql: "arch.archive_kind IS NOT NULL" },
        { value: "former", label: "All former students", sql: "(arch.archive_kind IS NOT NULL OR COALESCE(s.graduated, FALSE) = TRUE)" },
      ], { join: "archive" }),
      dateCriterion("Born between", "s.date_of_birth"),
      { ...dateCriterion("Left between", "arch.left_at", "left"), join: "archive" },
      selectCriterion("bus_route", "Bus route", "bus.route_id",
        "SELECT route_id::text AS value, route_name AS label FROM transport_routes WHERE organization_id = $1 ORDER BY route_name LIMIT 200",
        { join: "bus", requires: "transport" }),
      textCriterion("hometown", "Hometown or address", fieldsMatch(["s.hometown", "s.address"])),
      choiceCriterion("portal", "Student portal", [
        { value: "yes", label: "Has an account", sql: "portal.login_email IS NOT NULL" },
        { value: "no", label: "No account", sql: "portal.login_email IS NULL" },
      ], { join: "portal" }),
      choiceCriterion("absences", "Absences this term", [
        { value: "any", label: "Absent at least once", sql: "att.absent > 0" },
        { value: "3plus", label: "Absent 3+ days", sql: "att.absent >= 3" },
        { value: "none", label: "Never absent", sql: "COALESCE(att.absent, 0) = 0" },
      ], { join: "attendance" }),
      choiceCriterion("fees", "Fees", [
        { value: "owing", label: "Has a balance", sql: "fees.balance > 0" },
        { value: "clear", label: "No balance", sql: "COALESCE(fees.balance, 0) = 0" },
      ], { join: "fees", permission: "manage_paygira", requires: "fees" }),
    ],
  },
  enrollments: {
    title: "Admissions & enrollment",
    variant: "Enrollment by term",
    permission: "manage_students",
    organizationExpression: "e.organization_id",
    classExpression: "es.class_id",
    stableOrderExpressions: ["e.enrollment_id", "es.student_id"],
    from: `FROM enrollments e
      JOIN enrolled_students es ON es.enrollment_id = e.enrollment_id
      JOIN students s ON s.student_id = es.student_id AND s.organization_id = e.organization_id
      LEFT JOIN classes c ON c.class_id = es.class_id AND c.organization_id = e.organization_id
      LEFT JOIN terms t ON t.term_id = e.term_id AND t.organization_id = e.organization_id
      LEFT JOIN school_years sy ON sy.id = e.school_year_id AND sy.organization_id = e.organization_id`,
    joins: STUDENT_JOINS,
    defaultColumns: ["student_name", "student_id", "class_name", "school_year", "term_name"],
    defaultSort: { key: "student_name", dir: "asc" },
    columns: {
      ...STUDENT_COLUMNS,
      class_name: { label: "Class", expression: "c.class_name" },
      school_year: { label: "School year", expression: "sy.year_label" },
      term_name: { label: "Term", expression: "t.term_name" },
      gender: { label: "Gender", expression: "s.gender" },
      enrolled_on: { label: "Enrolled on", expression: "e.created_at", type: "datetime" },
      ...PARENT_COLUMNS,
    },
    criteria: [
      ...studentCriteria(),
      classCriterion("es.class_id"),
      termCriterion("e.term_id"),
      selectCriterion("school_year", "School year", "e.school_year_id",
        "SELECT id::text AS value, year_label AS label FROM school_years WHERE organization_id = $1 ORDER BY year_label DESC LIMIT 50"),
      dateCriterion("Enrolled between", "e.created_at"),
    ],
  },
  admissions: {
    title: "Admissions & enrollment",
    variant: "Online applications",
    permission: "approve_admissions",
    organizationExpression: "p.organization_id",
    classExpression: "p.class_id",
    stableOrderExpressions: ["p.pending_id"],
    from: `FROM pending_students p
      LEFT JOIN classes c ON c.class_id = p.class_id AND c.organization_id = p.organization_id
      LEFT JOIN terms t ON t.term_id = p.term_id AND t.organization_id = p.organization_id`,
    defaultColumns: ["applicant_name", "class_name", "gender", "submitted_at", "status"],
    defaultSort: { key: "submitted_at", dir: "desc" },
    columns: {
      applicant_name: { label: "Applicant", expression: fullName("p") },
      class_name: { label: "Class applied for", expression: "c.class_name" },
      term_name: { label: "Term", expression: "t.term_name" },
      gender: { label: "Gender", expression: "p.gender" },
      date_of_birth: { label: "Date of birth", expression: "p.date_of_birth", type: "date" },
      email: { label: "Email", expression: "p.email" },
      hometown: { label: "Hometown", expression: "p.hometown" },
      enrollment_type: { label: "Enrollment type", expression: initcap("p.enrollment_type") },
      submitted_at: { label: "Submitted", expression: "p.submitted_at", type: "datetime" },
      status: { label: "Status", expression: initcap("COALESCE(p.status, 'pending')") },
      payment: {
        label: "Payment",
        expression: "CASE WHEN COALESCE(p.payment_pending, FALSE) THEN 'Pending' WHEN COALESCE(p.stripe_payment_verified, FALSE) THEN 'Paid' ELSE '—' END",
      },
    },
    criteria: [
      nameCriterion("search", "Applicant name", fieldsMatch([fullName("p")])),
      textCriterion("email", "Email", fieldsMatch(["p.email"])),
      classCriterion("p.class_id"),
      termCriterion("p.term_id"),
      selectCriterion("status", "Status", "COALESCE(p.status, 'pending')", distinctOptions("pending_students", "COALESCE(status, 'pending')")),
      selectCriterion("gender", "Gender", "p.gender", distinctOptions("pending_students", "gender")),
      dateCriterion("Submitted between", "p.submitted_at"),
    ],
  },
  // Academics
  assessment_results: {
    title: "Assessments",
    variant: "Recorded scores",
    permission: "manage_assessments",
    organizationExpression: "ar.organization_id",
    classExpression: "ar.class_id",
    stableOrderExpressions: ["ar.student_id", "ar.assessment_id", "ar.subject_id", "ar.category", "ar.choice_label"],
    from: `FROM assessment_results ar
      JOIN students s ON s.student_id = ar.student_id AND s.organization_id = ar.organization_id
      LEFT JOIN classes c ON c.class_id = ar.class_id AND c.organization_id = ar.organization_id
      LEFT JOIN subjects sub ON sub.subject_id = ar.subject_id AND sub.organization_id = ar.organization_id
      LEFT JOIN assessments a ON a.assessment_id = ar.assessment_id AND a.organization_id = ar.organization_id
      LEFT JOIN terms t ON t.term_id = ar.term_id AND t.organization_id = ar.organization_id`,
    joins: STUDENT_JOINS,
    defaultColumns: ["student_name", "class_name", "subject_name", "assessment_name", "score", "percentage"],
    defaultSort: { key: "student_name", dir: "asc" },
    columns: {
      ...STUDENT_COLUMNS,
      class_name: { label: "Class", expression: "c.class_name" },
      subject_name: { label: "Subject", expression: "sub.subject_name" },
      assessment_name: { label: "Assessment", expression: "COALESCE(a.title, ar.title)" },
      category: { label: "Category", expression: "COALESCE(ar.category, a.category)" },
      score: { label: "Score", expression: "ar.score", type: "number" },
      max_score: { label: "Out of", expression: "a.max_score", type: "number" },
      percentage: { label: "Total %", expression: "ar.total_percentage", type: "number" },
      grade: { label: "Grade", expression: "ar.grade" },
      position: { label: "Position", expression: "ar.position", type: "number" },
      term_name: { label: "Term", expression: "t.term_name" },
      ...PARENT_COLUMNS,
    },
    criteria: [
      ...studentCriteria(),
      classCriterion("ar.class_id"),
      termCriterion("ar.term_id"),
      selectCriterion("subject", "Subject", "sub.subject_name", distinctOptions("subjects", "subject_name", "AND obsolete_at IS NULL")),
      selectCriterion("category", "Category", "COALESCE(ar.category, a.category)", distinctOptions("assessments", "category")),
      textCriterion("assessment", "Assessment name", fieldsMatch(["COALESCE(a.title, ar.title)"])),
      selectCriterion("grade", "Grade", "ar.grade", distinctOptions("assessment_results", "grade")),
      choiceCriterion("score_band", "Total %", [
        { value: "below50", label: "Below 50%", sql: "ar.total_percentage < 50" },
        { value: "50to79", label: "50% – 79%", sql: "ar.total_percentage >= 50 AND ar.total_percentage < 80" },
        { value: "80plus", label: "80% and above", sql: "ar.total_percentage >= 80" },
      ]),
      dateCriterion("Term dates between", "t.start_date"),
    ],
  },
  online_tests: {
    title: "Assessments",
    variant: "Online tests",
    permission: "manage_assessments",
    organizationExpression: "sa.organization_id",
    classExpression: "sa.class_id",
    stableOrderExpressions: ["sa.attempt_id"],
    from: `FROM student_assessment_attempts sa
      JOIN students s ON s.student_id = sa.student_id AND s.organization_id = sa.organization_id
      LEFT JOIN classes c ON c.class_id = sa.class_id AND c.organization_id = sa.organization_id
      LEFT JOIN assessments a ON a.assessment_id = sa.assessment_id AND a.organization_id = sa.organization_id
      LEFT JOIN assessment_question_sets qs ON qs.question_set_id = sa.question_set_id AND qs.organization_id = sa.organization_id
      LEFT JOIN subjects sub ON sub.subject_id = COALESCE(qs.subject_id, a.subject_id) AND sub.organization_id = sa.organization_id
      LEFT JOIN terms t ON t.term_id = sa.term_id AND t.organization_id = sa.organization_id`,
    joins: STUDENT_JOINS,
    defaultColumns: ["student_name", "class_name", "subject_name", "test_name", "status", "score", "percent"],
    defaultSort: { key: "submitted_at", dir: "desc" },
    columns: {
      ...STUDENT_COLUMNS,
      class_name: { label: "Class", expression: "c.class_name" },
      subject_name: { label: "Subject", expression: "sub.subject_name" },
      test_name: { label: "Test", expression: "COALESCE(NULLIF(qs.set_title, ''), a.title)" },
      status: { label: "Status", expression: initcap("sa.status") },
      submitted_at: { label: "Submitted", expression: "sa.submitted_at", type: "datetime" },
      minutes: { label: "Minutes taken", expression: "ROUND(EXTRACT(EPOCH FROM (sa.submitted_at - sa.started_at)) / 60)", type: "number" },
      score: { label: "Score", expression: "sa.score", type: "number" },
      max_score: { label: "Out of", expression: "sa.max_score", type: "number" },
      percent: { label: "Score %", expression: "ROUND(sa.score * 100.0 / NULLIF(sa.max_score, 0), 1)", type: "number" },
      term_name: { label: "Term", expression: "t.term_name" },
      ...PARENT_COLUMNS,
    },
    criteria: [
      ...studentCriteria(),
      classCriterion("sa.class_id"),
      termCriterion("sa.term_id"),
      selectCriterion("subject", "Subject", "sub.subject_name", distinctOptions("subjects", "subject_name", "AND obsolete_at IS NULL")),
      selectCriterion("status", "Status", "sa.status", distinctOptions("student_assessment_attempts", "status")),
      textCriterion("test", "Test name", fieldsMatch(["qs.set_title", "a.title"])),
      dateCriterion("Submitted between", "sa.submitted_at"),
    ],
  },
  // Merit sheet: totals of recorded scores per subject, ranked within each
  // class and term, graded with the class's grading scale (Report Settings).
  merit_ranking: {
    title: "Merit sheet",
    variant: "Class ranking",
    permission: "manage_reports",
    requires: "merit",
    organizationExpression: "m.organization_id",
    classExpression: "m.class_id",
    defaultCriteria: ["class", "term", "scale"],
    stableOrderExpressions: ["m.student_id"],
    from: (bind, criteria) => `FROM (
        SELECT g.*,
               RANK() OVER (PARTITION BY g.class_id, g.term_id ORDER BY ROUND(g.total, 2) DESC) AS position,
               COUNT(*) OVER (PARTITION BY g.class_id, g.term_id) AS class_size
          FROM (
            SELECT ss.organization_id, ss.student_id, ss.class_id, ss.term_id,
                   COUNT(*) AS subjects, SUM(ss.total) AS total, SUM(ss.max_total) AS max_total,
                   JSONB_OBJECT_AGG(ss.subject_name, ss.total) AS subject_totals,
                   (ARRAY_AGG(ss.subject_name ORDER BY ss.total / NULLIF(ss.max_total, 0) DESC NULLS LAST))[1] AS best_subject,
                   (ARRAY_AGG(ss.subject_name ORDER BY ss.total / NULLIF(ss.max_total, 0) ASC NULLS LAST))[1] AS weakest_subject
              FROM ${subjectTotals(bind, criteria)}
             GROUP BY ss.organization_id, ss.student_id, ss.class_id, ss.term_id
          ) g
      ) m
      JOIN students s ON s.student_id = m.student_id AND s.organization_id = m.organization_id
      LEFT JOIN classes c ON c.class_id = m.class_id AND c.organization_id = m.organization_id
      LEFT JOIN terms t ON t.term_id = m.term_id AND t.organization_id = m.organization_id
      LEFT JOIN school_years sy ON sy.id = t.school_year_id AND sy.organization_id = t.organization_id
      LEFT JOIN student_reports srp ON srp.organization_id = m.organization_id AND srp.class_id = m.class_id
        AND srp.term_id = m.term_id AND srp.student_id = m.student_id
      LEFT JOIN classes pc ON pc.class_id = srp.promotion_class_id AND pc.organization_id = m.organization_id
      ${gradeBand("m", "m.total * 100.0 / NULLIF(m.max_total, 0)")}`,
    joins: STUDENT_JOINS,
    defaultColumns: ["position", "student_name", "student_id", "class_name", "total", "average", "percentage", "overall_grade", "remark"],
    defaultSort: { key: "position", dir: "asc" },
    columns: {
      position: { label: "Position", expression: "m.position", type: "number" },
      class_size: { label: "Class size", expression: "m.class_size", type: "number" },
      ...STUDENT_COLUMNS,
      gender: { label: "Gender", expression: "s.gender" },
      class_name: { label: "Class", expression: "c.class_name" },
      term_name: { label: "Term", expression: "t.term_name" },
      total: { label: "Total score", expression: "ROUND(m.total, 2)", type: "number" },
      max_total: { label: "Out of", expression: "ROUND(m.max_total, 2)", type: "number" },
      average: { label: "Average", expression: "ROUND(m.total / NULLIF(m.subjects, 0), 2)", type: "number" },
      percentage: { label: "Percentage", expression: "ROUND(m.total * 100.0 / NULLIF(m.max_total, 0), 1)", type: "number" },
      overall_grade: { label: "Overall grade", expression: "band.grade" },
      remark: { label: "Grade remark", expression: "band.remark" },
      best_subject: { label: "Best subject", expression: "m.best_subject" },
      weakest_subject: { label: "Weakest subject", expression: "m.weakest_subject" },
      teacher_remark: { label: "Teacher's remark", expression: "NULLIF(TRIM(srp.teacher_remarks), '')" },
      conduct: { label: "Conduct", expression: "NULLIF(TRIM(srp.conduct_remarks), '')" },
      attitude: { label: "Attitude", expression: "NULLIF(TRIM(srp.attitude_remarks), '')" },
      interest: { label: "Interest", expression: "NULLIF(TRIM(srp.interest_remarks), '')" },
      promotion_status: { label: "Promotion", expression: initcap("NULLIF(TRIM(srp.promotion_status), '')") },
      promoted_to: { label: "Promoted to", expression: "pc.class_name" },
      ...PARENT_COLUMNS,
    },
    criteria: [
      classCriterion("m.class_id"),
      termCriterion("m.term_id"),
      scaleCriterion(),
      ...studentCriteria(),
      selectCriterion("gender", "Gender", "s.gender", distinctOptions("students", "gender")),
      selectCriterion("grade", "Overall grade", "band.grade",
        "SELECT DISTINCT TRIM(grade_label) AS value, TRIM(grade_label) AS label FROM score_remarks WHERE organization_id = $1 AND NULLIF(TRIM(grade_label), '') IS NOT NULL ORDER BY 1 LIMIT 100"),
      selectCriterion("remark", "Grade remark", "band.remark",
        "SELECT DISTINCT TRIM(remark) AS value, TRIM(remark) AS label FROM score_remarks WHERE organization_id = $1 AND NULLIF(TRIM(remark), '') IS NOT NULL ORDER BY 1 LIMIT 100"),
      choiceCriterion("position", "Position", [
        { value: "top3", label: "Top 3", sql: "m.position <= 3" },
        { value: "top5", label: "Top 5", sql: "m.position <= 5" },
        { value: "top10", label: "Top 10", sql: "m.position <= 10" },
        { value: "bottom5", label: "Bottom 5", sql: "m.position > m.class_size - 5" },
      ]),
      choiceCriterion("percentage", "Percentage", [
        { value: "below50", label: "Below 50%", sql: "m.total * 100.0 / NULLIF(m.max_total, 0) < 50" },
        { value: "50to69", label: "50% – 69%", sql: "m.total * 100.0 / NULLIF(m.max_total, 0) >= 50 AND m.total * 100.0 / NULLIF(m.max_total, 0) < 70" },
        { value: "70to84", label: "70% – 84%", sql: "m.total * 100.0 / NULLIF(m.max_total, 0) >= 70 AND m.total * 100.0 / NULLIF(m.max_total, 0) < 85" },
        { value: "85plus", label: "85% and above", sql: "m.total * 100.0 / NULLIF(m.max_total, 0) >= 85" },
      ]),
      selectCriterion("promotion", "Promotion", "srp.promotion_status", distinctOptions("student_reports", "promotion_status")),
      selectCriterion("conduct", "Conduct", "srp.conduct_remarks", distinctOptions("student_reports", "conduct_remarks")),
      selectCriterion("attitude", "Attitude", "srp.attitude_remarks", distinctOptions("student_reports", "attitude_remarks")),
      selectCriterion("interest", "Interest", "srp.interest_remarks", distinctOptions("student_reports", "interest_remarks")),
      textCriterion("teacher_remark", "Teacher's remark", fieldsMatch(["srp.teacher_remarks"])),
    ],
    // Each subject as its own column, and the school's own remark types.
    async extend(db, organizationId) {
      const [subjects, remarkTypes] = await Promise.all([
        db.query(`SELECT DISTINCT TRIM(subject_name) AS name FROM subjects
                   WHERE organization_id = $1 AND obsolete_at IS NULL AND NULLIF(TRIM(subject_name), '') IS NOT NULL
                   ORDER BY 1 LIMIT 150`, [organizationId]),
        customRemarkTypes(db, organizationId),
      ]);
      const columns = {};
      const criteria = [];
      remarkTypes.forEach((type) => {
        const expression = `NULLIF(TRIM(srp.custom_remarks_json ->> ${sqlText(type.type_key)}), '')`;
        columns[`remark_${type.id}`] = { label: type.label, expression };
        criteria.push(textCriterion(`remark_${type.id}`, type.label, fieldsMatch([expression])));
      });
      subjects.rows.forEach(({ name }) => {
        columns[`subject_${shortHash(name)}`] = { label: name, expression: `ROUND((m.subject_totals ->> ${sqlText(name)})::numeric, 2)`, type: "number", group: "Subject scores" };
      });
      return { columns, criteria };
    },
  },
  merit_subjects: {
    title: "Merit sheet",
    variant: "By subject",
    permission: "manage_reports",
    requires: "merit",
    organizationExpression: "ss.organization_id",
    classExpression: "ss.class_id",
    defaultCriteria: ["class", "term", "scale"],
    stableOrderExpressions: ["ss.student_id", "ss.subject_id"],
    from: (bind, criteria) => `FROM ${subjectTotals(bind, criteria)}
      JOIN students s ON s.student_id = ss.student_id AND s.organization_id = ss.organization_id
      LEFT JOIN classes c ON c.class_id = ss.class_id AND c.organization_id = ss.organization_id
      LEFT JOIN terms t ON t.term_id = ss.term_id AND t.organization_id = ss.organization_id
      LEFT JOIN student_term_positions stp ON stp.organization_id = ss.organization_id AND stp.student_id = ss.student_id
        AND stp.subject_id = ss.subject_id AND stp.term_id = ss.term_id
      ${gradeBand("ss", "ss.total * 100.0 / NULLIF(ss.max_total, 0)")}`,
    joins: STUDENT_JOINS,
    defaultColumns: ["subject_name", "subject_position", "student_name", "class_name", "total", "max_total", "percentage", "grade", "remark"],
    defaultSort: { key: "subject_name", dir: "asc" },
    columns: {
      subject_name: { label: "Subject", expression: "ss.subject_name" },
      subject_position: { label: "Position in subject", expression: "COALESCE(stp.position, ss.subject_rank)", type: "number" },
      ...STUDENT_COLUMNS,
      gender: { label: "Gender", expression: "s.gender" },
      class_name: { label: "Class", expression: "c.class_name" },
      term_name: { label: "Term", expression: "t.term_name" },
      total: { label: "Subject total", expression: "ROUND(ss.total, 2)", type: "number" },
      max_total: { label: "Out of", expression: "ROUND(ss.max_total, 2)", type: "number" },
      percentage: { label: "Percentage", expression: "ROUND(ss.total * 100.0 / NULLIF(ss.max_total, 0), 1)", type: "number" },
      grade: { label: "Grade", expression: "band.grade" },
      remark: { label: "Grade remark", expression: "band.remark" },
      ...PARENT_COLUMNS,
    },
    criteria: [
      classCriterion("ss.class_id"),
      termCriterion("ss.term_id"),
      scaleCriterion(),
      ...studentCriteria(),
      selectCriterion("subject", "Subject", "ss.subject_name",
        "SELECT DISTINCT TRIM(subject_name) AS value, TRIM(subject_name) AS label FROM subjects WHERE organization_id = $1 AND obsolete_at IS NULL ORDER BY 1 LIMIT 150"),
      selectCriterion("grade", "Grade", "band.grade",
        "SELECT DISTINCT TRIM(grade_label) AS value, TRIM(grade_label) AS label FROM score_remarks WHERE organization_id = $1 AND NULLIF(TRIM(grade_label), '') IS NOT NULL ORDER BY 1 LIMIT 100"),
      selectCriterion("remark", "Grade remark", "band.remark",
        "SELECT DISTINCT TRIM(remark) AS value, TRIM(remark) AS label FROM score_remarks WHERE organization_id = $1 AND NULLIF(TRIM(remark), '') IS NOT NULL ORDER BY 1 LIMIT 100"),
      choiceCriterion("position", "Position in subject", [
        { value: "top3", label: "Top 3", sql: "COALESCE(stp.position, ss.subject_rank) <= 3" },
        { value: "top5", label: "Top 5", sql: "COALESCE(stp.position, ss.subject_rank) <= 5" },
        { value: "top10", label: "Top 10", sql: "COALESCE(stp.position, ss.subject_rank) <= 10" },
      ]),
      choiceCriterion("percentage", "Percentage", [
        { value: "below50", label: "Below 50%", sql: "ss.total * 100.0 / NULLIF(ss.max_total, 0) < 50" },
        { value: "50to69", label: "50% – 69%", sql: "ss.total * 100.0 / NULLIF(ss.max_total, 0) >= 50 AND ss.total * 100.0 / NULLIF(ss.max_total, 0) < 70" },
        { value: "70to84", label: "70% – 84%", sql: "ss.total * 100.0 / NULLIF(ss.max_total, 0) >= 70 AND ss.total * 100.0 / NULLIF(ss.max_total, 0) < 85" },
        { value: "85plus", label: "85% and above", sql: "ss.total * 100.0 / NULLIF(ss.max_total, 0) >= 85" },
      ]),
    ],
    // A score column for each assessment category the school uses (e.g. Class work, Exams).
    async extend(db, organizationId) {
      const categories = await db.query(
        `SELECT DISTINCT COALESCE(NULLIF(TRIM(category), ''), 'Other') AS name FROM assessments
          WHERE organization_id = $1 AND obsolete_at IS NULL ORDER BY 1 LIMIT 50`,
        [organizationId]
      );
      const columns = {};
      categories.rows.forEach(({ name }) => {
        columns[`category_${shortHash(name)}`] = { label: name, expression: `ROUND((ss.categories ->> ${sqlText(name)})::numeric, 2)`, type: "number" };
      });
      return { columns, criteria: [] };
    },
  },

  // Attendance
  attendance: {
    title: "Attendance",
    variant: "Each mark",
    permission: "mark_attendance",
    organizationExpression: "ar.organization_id",
    classExpression: "ar.class_id",
    stableOrderExpressions: ["ar.student_id", "ar.class_id"],
    from: `FROM attendance_records ar
      JOIN students s ON s.student_id = ar.student_id AND s.organization_id = ar.organization_id
      LEFT JOIN classes c ON c.class_id = ar.class_id AND c.organization_id = ar.organization_id
      LEFT JOIN terms t ON t.term_id = ar.term_id AND t.organization_id = ar.organization_id
      LEFT JOIN users mu ON mu.user_id = ar.marked_by`,
    joins: STUDENT_JOINS,
    defaultColumns: ["date", "student_name", "class_name", "status"],
    defaultSort: { key: "date", dir: "desc" },
    columns: {
      date: { label: "Date", expression: "ar.date", type: "date" },
      weekday: { label: "Day", expression: "TRIM(TO_CHAR(ar.date, 'Day'))" },
      ...STUDENT_COLUMNS,
      class_name: { label: "Class", expression: "c.class_name" },
      status: { label: "Status", expression: "ar.status::text" },
      term_name: { label: "Term", expression: "t.term_name" },
      marked_by: { label: "Marked by", expression: fullName("mu") },
      ...PARENT_COLUMNS,
    },
    criteria: [
      ...studentCriteria(),
      classCriterion("ar.class_id"),
      termCriterion("ar.term_id"),
      selectCriterion("status", "Status", "ar.status", distinctOptions("attendance_records", "status")),
      nameCriterion("marked_by", "Marked by", fieldsMatch([fullName("mu")])),
      dateCriterion("Date between", "ar.date"),
    ],
  },
  attendance_summary: {
    title: "Attendance",
    variant: "Per student",
    permission: "mark_attendance",
    organizationExpression: "x.organization_id",
    classExpression: "x.class_id",
    stableOrderExpressions: ["x.student_id", "x.class_id", "x.term_id"],
    from: (bind, criteria) => `FROM ${attendanceRollup("student_id, class_id, term_id", bind, criteria)}
      JOIN students s ON s.student_id = x.student_id AND s.organization_id = x.organization_id
      LEFT JOIN classes c ON c.class_id = x.class_id AND c.organization_id = x.organization_id
      LEFT JOIN terms t ON t.term_id = x.term_id AND t.organization_id = x.organization_id`,
    joins: STUDENT_JOINS,
    defaultColumns: ["student_name", "class_name", "term_name", "days", "present", "absent", "rate"],
    defaultSort: { key: "student_name", dir: "asc" },
    columns: {
      ...STUDENT_COLUMNS,
      class_name: { label: "Class", expression: "c.class_name" },
      term_name: { label: "Term", expression: "t.term_name" },
      days: { label: "Days marked", expression: "x.days", type: "number" },
      present: { label: "Present", expression: "x.present", type: "number" },
      absent: { label: "Absent", expression: "x.absent", type: "number" },
      rate: { label: "Attendance %", expression: "ROUND(x.present * 100.0 / NULLIF(x.days, 0), 1)", type: "number" },
      ...PARENT_COLUMNS,
    },
    criteria: [
      ...studentCriteria(),
      classCriterion("x.class_id"),
      termCriterion("x.term_id"),
      { ...dateCriterion("Dates between", "date"), where: () => null, inFrom: true },
      choiceCriterion("rate", "Attendance rate", [
        { value: "below75", label: "Below 75%", sql: "x.present * 100.0 / NULLIF(x.days, 0) < 75" },
        { value: "below90", label: "Below 90%", sql: "x.present * 100.0 / NULLIF(x.days, 0) < 90" },
        { value: "90plus", label: "90% or higher", sql: "x.present * 100.0 / NULLIF(x.days, 0) >= 90" },
      ]),
      choiceCriterion("absent", "Days absent", [
        { value: "any", label: "1 or more", sql: "x.absent > 0" },
        { value: "3plus", label: "3 or more", sql: "x.absent >= 3" },
        { value: "5plus", label: "5 or more", sql: "x.absent >= 5" },
      ]),
    ],
  },
  class_attendance: {
    title: "Attendance",
    variant: "Per class & day",
    permission: "mark_attendance",
    organizationExpression: "x.organization_id",
    classExpression: "x.class_id",
    stableOrderExpressions: ["x.class_id"],
    from: (bind, criteria) => `FROM ${attendanceRollup("class_id, term_id, date", bind, criteria)}
      LEFT JOIN classes c ON c.class_id = x.class_id AND c.organization_id = x.organization_id
      LEFT JOIN terms t ON t.term_id = x.term_id AND t.organization_id = x.organization_id`,
    defaultColumns: ["date", "class_name", "days", "present", "absent", "rate"],
    defaultSort: { key: "date", dir: "desc" },
    columns: {
      date: { label: "Date", expression: "x.date", type: "date" },
      weekday: { label: "Day", expression: "TRIM(TO_CHAR(x.date, 'Day'))" },
      class_name: { label: "Class", expression: "c.class_name" },
      term_name: { label: "Term", expression: "t.term_name" },
      days: { label: "Students marked", expression: "x.days", type: "number" },
      present: { label: "Present", expression: "x.present", type: "number" },
      absent: { label: "Absent", expression: "x.absent", type: "number" },
      rate: { label: "Attendance %", expression: "ROUND(x.present * 100.0 / NULLIF(x.days, 0), 1)", type: "number" },
    },
    criteria: [
      classCriterion("x.class_id"),
      termCriterion("x.term_id"),
      { ...dateCriterion("Date between", "date"), where: () => null, inFrom: true },
      choiceCriterion("rate", "Attendance rate", [
        { value: "below90", label: "Below 90%", sql: "x.present * 100.0 / NULLIF(x.days, 0) < 90" },
        { value: "full", label: "Everyone present", sql: "x.absent = 0" },
      ]),
    ],
  },

  // Parents & messages
  parents: {
    title: "Parents & guardians",
    variant: "Parents & guardians",
    permission: "manage_guardians",
    organizationExpression: "gp.organization_id",
    classExpression: null,
    stableOrderExpressions: ["gp.guardian_id"],
    from: `FROM guardian_profiles gp
      LEFT JOIN LATERAL (
        SELECT STRING_AGG(DISTINCT TRIM(CONCAT_WS(' ', s.first_name, s.last_name)), '; ') AS children,
               STRING_AGG(DISTINCT c.class_name, '; ') AS classes,
               STRING_AGG(DISTINCT NULLIF(TRIM(gs.relationship), ''), '; ') AS relationship,
               COUNT(DISTINCT s.student_id) AS child_count
          FROM guardian_students gs
          JOIN students s ON s.student_id = gs.student_id AND s.organization_id = gp.organization_id
          LEFT JOIN classes c ON c.class_id = s.class_id AND c.organization_id = s.organization_id
         WHERE gs.guardian_id = gp.guardian_id
      ) kids ON TRUE
      LEFT JOIN LATERAL (
        SELECT ga.login_email, ga.login_phone FROM guardian_accounts ga
         WHERE ga.guardian_id = gp.guardian_id AND ga.organization_id = gp.organization_id
         LIMIT 1
      ) portal ON TRUE`,
    defaultColumns: ["parent_name", "phone", "email", "children", "portal_account"],
    defaultSort: { key: "parent_name", dir: "asc" },
    columns: {
      parent_name: { label: "Parent / guardian", expression: fullName("gp") },
      parent_id: { label: "Parent ID", expression: "gp.guardian_id::text" },
      first_name: { label: "First name", expression: "gp.first_name" },
      last_name: { label: "Last name", expression: "gp.last_name" },
      date_of_birth: { label: "Date of birth", expression: "gp.date_of_birth", type: "date" },
      phone: { label: "Phone", expression: "gp.phone" },
      email: { label: "Email", expression: "gp.email" },
      address: { label: "Address", expression: "gp.address" },
      hometown: { label: "Hometown", expression: "gp.hometown" },
      relationship: { label: "Relationship", expression: "kids.relationship" },
      children: { label: "Children", expression: "kids.children" },
      classes: { label: "Children's classes", expression: "kids.classes" },
      child_count: { label: "No. of children", expression: "kids.child_count", type: "number" },
      portal_account: {
        label: "Parent portal",
        expression: "CASE WHEN portal.login_email IS NULL AND portal.login_phone IS NULL THEN 'No' ELSE 'Yes' END",
      },
      portal_login: { label: "Portal login", expression: "COALESCE(portal.login_email, portal.login_phone)" },
      created_at: { label: "Added", expression: "gp.created_at", type: "datetime" },
      ...AUDIT_COLUMNS,
    },
    criteria: [
      nameCriterion("search", "Parent name", fieldsMatch([fullName("gp"), "CONCAT_WS(' ', gp.last_name, gp.first_name)"])),
      idCriterion("parent_id", "Parent ID", (ids) => `gp.guardian_id = ANY(${ids}::int[])`),
      textCriterion("contact", "Phone or email", fieldsMatch(["gp.phone", "gp.email"])),
      textCriterion("address", "Address", fieldsMatch(["gp.address"])),
      textCriterion("hometown", "Hometown", fieldsMatch(["gp.hometown"])),
      textCriterion("relationship", "Relationship", fieldsMatch(["kids.relationship"])),
      birthMonthCriterion("gp.date_of_birth"),
      nameCriterion("child", "Child's name", fieldsMatch(["kids.children"])),
      textCriterion("child_id", "Child's student ID", (like) => `EXISTS (
          SELECT 1 FROM guardian_students gs3 JOIN students s ON s.student_id = gs3.student_id AND s.organization_id = gp.organization_id
           WHERE gs3.guardian_id = gp.guardian_id AND ${STUDENT_ID} ILIKE ${like})`),
      choiceCriterion("child_count", "No. of children", [
        { value: "1", label: "1 child", sql: "kids.child_count = 1" },
        { value: "2", label: "2 children", sql: "kids.child_count = 2" },
        { value: "3plus", label: "3 or more", sql: "kids.child_count >= 3" },
        { value: "0", label: "No children linked", sql: "COALESCE(kids.child_count, 0) = 0" },
      ]),
      {
        key: "class",
        label: "Child's class",
        type: "class",
        where: (bind, value) => `EXISTS (
          SELECT 1 FROM guardian_students gs2
            JOIN students s2 ON s2.student_id = gs2.student_id AND s2.organization_id = gp.organization_id
           WHERE gs2.guardian_id = gp.guardian_id AND s2.class_id = ANY(${bind(value)}::int[]))`,
      },
      choiceCriterion("portal", "Parent portal", [
        { value: "yes", label: "Has an account", sql: "(portal.login_email IS NOT NULL OR portal.login_phone IS NOT NULL)" },
        { value: "no", label: "No account", sql: "(portal.login_email IS NULL AND portal.login_phone IS NULL)" },
      ]),
      choiceCriterion("contact_missing", "Missing details", [
        { value: "no_email", label: "No email", sql: "COALESCE(TRIM(gp.email), '') = ''" },
        { value: "no_phone", label: "No phone", sql: "COALESCE(TRIM(gp.phone), '') = ''" },
      ]),
      dateCriterion("Added between", "gp.created_at"),
    ],
  },
  parent_messages: {
    title: "Parent messages",
    variant: "Parent messages",
    permission: "manage_reports",
    organizationExpression: "gr.organization_id",
    classExpression: "s.class_id",
    baseWhere: "gr.deleted_at IS NULL",
    stableOrderExpressions: ["gr.report_id"],
    from: `FROM guardian_reports gr
      LEFT JOIN guardian_profiles gp ON gp.guardian_id = gr.guardian_id AND gp.organization_id = gr.organization_id
      LEFT JOIN students s ON s.student_id = gr.student_id AND s.organization_id = gr.organization_id
      LEFT JOIN classes c ON c.class_id = s.class_id AND c.organization_id = s.organization_id
      LEFT JOIN LATERAL (
        SELECT COUNT(*) AS replies, MAX(created_at) AS last_reply_at,
               STRING_AGG(DISTINCT rr.sender_name, '; ') FILTER (WHERE rr.sender_type <> 'guardian') AS staff_repliers
          FROM guardian_report_replies rr WHERE rr.report_id = gr.report_id
      ) rep ON TRUE`,
    defaultColumns: ["created_at", "parent_name", "student_name", "subject", "status", "replies"],
    defaultSort: { key: "created_at", dir: "desc" },
    columns: {
      created_at: { label: "Received", expression: "gr.created_at", type: "datetime" },
      parent_name: { label: "Parent", expression: fullName("gp") },
      parent_phone: { label: "Parent phone", expression: "gp.phone" },
      student_name: { label: "Student", expression: STUDENT_NAME },
      class_name: { label: "Class", expression: "c.class_name" },
      subject: { label: "Subject", expression: "gr.subject" },
      message: { label: "Message", expression: "gr.message" },
      report_type: { label: "Type", expression: initcap("gr.report_type") },
      priority: { label: "Priority", expression: initcap("gr.priority") },
      status: { label: "Status", expression: initcap("gr.status") },
      replies: { label: "Replies", expression: "rep.replies", type: "number" },
      staff_repliers: { label: "Answered by", expression: "rep.staff_repliers" },
      last_reply_at: { label: "Last reply", expression: "rep.last_reply_at", type: "datetime" },
      resolved_at: { label: "Resolved", expression: "gr.resolved_at", type: "datetime" },
    },
    criteria: [
      textCriterion("search", "Subject or message", fieldsMatch(["gr.subject", "gr.message"])),
      nameCriterion("parent", "Parent name", fieldsMatch([fullName("gp")])),
      nameCriterion("student", "Student name", fieldsMatch([STUDENT_NAME])),
      classCriterion("s.class_id"),
      selectCriterion("status", "Status", "gr.status", distinctOptions("guardian_reports", "status")),
      selectCriterion("priority", "Priority", "gr.priority", distinctOptions("guardian_reports", "priority")),
      choiceCriterion("answered", "Replies", [
        { value: "none", label: "Not answered yet", sql: "COALESCE(rep.replies, 0) = 0" },
        { value: "some", label: "Has replies", sql: "rep.replies > 0" },
      ]),
      dateCriterion("Received between", "gr.created_at"),
    ],
  },
  message_delivery: {
    title: "Messages sent",
    variant: "Sent",
    permission: "mailroom",
    organizationExpression: "d.organization_id",
    classExpression: "d.class_id",
    stableOrderExpressions: ["d.id"],
    from: `FROM delivery_audit_history d
      LEFT JOIN classes c ON c.class_id = d.class_id AND c.organization_id = d.organization_id
      LEFT JOIN terms t ON t.term_id = d.term_id AND t.organization_id = d.organization_id`,
    defaultColumns: ["created_at", "channel", "activity", "recipients", "status"],
    defaultSort: { key: "created_at", dir: "desc" },
    columns: {
      created_at: { label: "Date", expression: "d.created_at", type: "datetime" },
      channel: { label: "Channel", expression: CHANNEL_LABEL("d.event_domain") },
      activity: { label: "Activity", expression: initcap("d.event_name") },
      recipients: { label: "Recipients", expression: "ARRAY_TO_STRING(d.recipient_emails, '; ')" },
      student_name: { label: "Student", expression: "d.student_name" },
      class_name: { label: "Class", expression: "c.class_name" },
      term_name: { label: "Term", expression: "t.term_name" },
      sent_by: { label: "Sent by", expression: "d.actor_name" },
      status: { label: "Status", expression: initcap("d.status") },
      notes: { label: "Notes", expression: "d.notes" },
    },
    criteria: [
      textCriterion("recipient", "Recipient", fieldsMatch(["ARRAY_TO_STRING(d.recipient_emails, ' ')"])),
      nameCriterion("student", "Student name", fieldsMatch(["d.student_name"])),
      nameCriterion("sender", "Sent by", fieldsMatch(["d.actor_name"])),
      selectCriterion("channel", "Channel", "d.event_domain",
        `SELECT DISTINCT event_domain AS value, ${CHANNEL_LABEL("event_domain")} AS label
           FROM delivery_audit_history WHERE organization_id = $1 AND event_domain IS NOT NULL ORDER BY 2 LIMIT 50`,
        { messagingChannels: true }),
      selectCriterion("status", "Status", "d.status", distinctOptions("delivery_audit_history", "status")),
      classCriterion("d.class_id"),
      dateCriterion("Date between", "d.created_at"),
    ],
  },
  failed_emails: {
    title: "Messages sent",
    variant: "Undelivered",
    permission: "mailroom",
    organizationExpression: "f.organization_id",
    classExpression: null,
    stableOrderExpressions: ["f.id"],
    from: "FROM email_delivery_failures f",
    defaultColumns: ["failed_email", "user_type", "reason", "failure_count", "last_failed_at"],
    defaultSort: { key: "last_failed_at", dir: "desc" },
    columns: {
      failed_email: { label: "Email", expression: "f.failed_email" },
      user_type: { label: "Belongs to", expression: initcap("f.user_type") },
      reason: { label: "Reason", expression: "f.reason" },
      failure_count: { label: "Failures", expression: "f.failure_count", type: "number" },
      first_failed_at: { label: "First failed", expression: "f.first_failed_at", type: "datetime" },
      last_failed_at: { label: "Last failed", expression: "f.last_failed_at", type: "datetime" },
    },
    criteria: [
      textCriterion("email", "Email", fieldsMatch(["f.failed_email"])),
      textCriterion("reason", "Reason", fieldsMatch(["f.reason"])),
      selectCriterion("user_type", "Belongs to", "f.user_type", distinctOptions("email_delivery_failures", "user_type")),
      dateCriterion("Last failed between", "f.last_failed_at"),
    ],
  },

  // Staff
  staff: {
    title: "Staff",
    variant: "Staff list",
    permission: "manage_employees",
    organizationExpression: "u.organization_id",
    classExpression: null,
    baseWhere: "u.removed_at IS NULL",
    stableOrderExpressions: ["u.user_id"],
    from: `FROM users u
      LEFT JOIN users sup ON sup.user_id = u.supervisor_user_id`,
    joins: {
      classes: `LEFT JOIN LATERAL (
          SELECT STRING_AGG(DISTINCT c.class_name, '; ') AS classes
            FROM user_classes uc
            JOIN classes c ON c.class_id = uc.class_id AND c.organization_id = u.organization_id
           WHERE uc.user_id = u.user_id AND c.obsolete_at IS NULL
        ) cls ON TRUE`,
      activity: `LEFT JOIN LATERAL (
          SELECT MAX(l.created_at) AS last_active,
                 MAX(l.created_at) FILTER (WHERE l.action_type = 'Login') AS last_login
            FROM organization_activity_logs l
           WHERE l.organization_id = u.organization_id AND l.user_id = u.user_id
        ) act ON TRUE`,
    },
    defaultColumns: ["staff_name", "role", "email", "phone", "classes", "status"],
    defaultSort: { key: "staff_name", dir: "asc" },
    columns: {
      staff_name: { label: "Name", expression: fullName("u") },
      username: { label: "Username", expression: "u.username" },
      role: { label: "Role", expression: "u.account_type::text" },
      job_title: { label: "Job title", expression: "u.org_role_title" },
      email: { label: "Email", expression: "u.email" },
      phone: { label: "Phone", expression: "u.phone_number" },
      classes: { label: "Classes", expression: "cls.classes", join: "classes" },
      supervisor: { label: "Supervisor", expression: fullName("sup") },
      date_of_birth: { label: "Date of birth", expression: "u.date_of_birth", type: "date" },
      created_at: { label: "Joined", expression: "u.created_at", type: "datetime" },
      last_login: { label: "Last login", expression: "act.last_login", type: "datetime", join: "activity" },
      last_active: { label: "Last active", expression: "act.last_active", type: "datetime", join: "activity" },
      status: { label: "Status", expression: "CASE WHEN COALESCE(u.on_hold, FALSE) THEN 'On hold' ELSE 'Active' END" },
      ...AUDIT_COLUMNS,
    },
    criteria: [
      nameCriterion("search", "Name", fieldsMatch([fullName("u"), "CONCAT_WS(' ', u.last_name, u.first_name)"])),
      nameCriterion("username", "Username", fieldsMatch(["u.username"])),
      textCriterion("contact", "Email or phone", fieldsMatch(["u.email", "u.phone_number"])),
      selectCriterion("role", "Role", "u.account_type",
        "SELECT DISTINCT account_type::text AS value, account_type::text AS label FROM users WHERE organization_id = $1 AND removed_at IS NULL ORDER BY 1"),
      {
        key: "class",
        label: "Teaches class",
        type: "class",
        where: (bind, value) => `EXISTS (SELECT 1 FROM user_classes uc2 WHERE uc2.user_id = u.user_id AND uc2.class_id = ANY(${bind(value)}::int[]))`,
      },
      choiceCriterion("status", "Status", [
        { value: "active", label: "Active", sql: "COALESCE(u.on_hold, FALSE) = FALSE" },
        { value: "on_hold", label: "On hold", sql: "COALESCE(u.on_hold, FALSE) = TRUE" },
      ]),
      choiceCriterion("inactive", "Not active for", [
        { value: "7", label: "7+ days", sql: "(act.last_active IS NULL OR act.last_active < NOW() - INTERVAL '7 days')" },
        { value: "30", label: "30+ days", sql: "(act.last_active IS NULL OR act.last_active < NOW() - INTERVAL '30 days')" },
      ], { join: "activity" }),
      dateCriterion("Joined between", "u.created_at"),
    ],
  },
  staff_tasks: {
    title: "Staff",
    variant: "Tasks",
    permission: "manage_employees",
    organizationExpression: "tk.organization_id",
    classExpression: null,
    stableOrderExpressions: ["tk.task_id"],
    from: `FROM org_tasks tk
      LEFT JOIN LATERAL (
        SELECT STRING_AGG(TRIM(CONCAT_WS(' ', au.first_name, au.last_name)), '; ') AS assignees,
               COUNT(*) AS total,
               COUNT(*) FILTER (WHERE ta.status = 'done' OR ta.done_at IS NOT NULL) AS done
          FROM org_task_assignees ta
          LEFT JOIN users au ON au.user_id = ta.user_id
         WHERE ta.task_id = tk.task_id
      ) asg ON TRUE`,
    defaultColumns: ["title", "assignees", "due_date", "priority", "progress", "status"],
    defaultSort: { key: "due_date", dir: "desc" },
    columns: {
      title: { label: "Task", expression: "tk.title" },
      details: { label: "Details", expression: "tk.details" },
      assignees: { label: "Assigned to", expression: "asg.assignees" },
      due_date: { label: "Due", expression: "tk.due_date", type: "date" },
      priority: { label: "Priority", expression: initcap("tk.priority") },
      progress: { label: "Done", expression: "CONCAT(asg.done, ' of ', asg.total)" },
      status: {
        label: "Status",
        expression: "CASE WHEN asg.total > 0 AND asg.done = asg.total THEN 'Done' WHEN tk.due_date < CURRENT_DATE THEN 'Overdue' ELSE 'Open' END",
      },
      created_by: { label: "Created by", expression: "tk.created_by_name" },
      created_at: { label: "Created", expression: "tk.created_at", type: "datetime" },
    },
    criteria: [
      textCriterion("search", "Task", fieldsMatch(["tk.title", "tk.details"])),
      nameCriterion("assignee", "Assigned to", fieldsMatch(["asg.assignees"])),
      nameCriterion("created_by", "Created by", fieldsMatch(["tk.created_by_name"])),
      selectCriterion("priority", "Priority", "tk.priority", distinctOptions("org_tasks", "priority")),
      choiceCriterion("status", "Status", [
        { value: "open", label: "Open", sql: "NOT (asg.total > 0 AND asg.done = asg.total) AND (tk.due_date IS NULL OR tk.due_date >= CURRENT_DATE)" },
        { value: "overdue", label: "Overdue", sql: "NOT (asg.total > 0 AND asg.done = asg.total) AND tk.due_date < CURRENT_DATE" },
        { value: "done", label: "Done", sql: "asg.total > 0 AND asg.done = asg.total" },
      ]),
      dateCriterion("Due between", "tk.due_date"),
      dateCriterion("Created between", "tk.created_at", "created"),
    ],
  },

  // Fees & payments
  fee_balances: {
    title: "Fees & payments",
    variant: "Balances",
    permission: "manage_paygira",
    requires: "fees",
    organizationExpression: "fa.organization_id",
    classExpression: "s.class_id",
    stableOrderExpressions: ["fa.assignment_id"],
    from: `FROM finance_bill_assignments fa
      JOIN finance_bills b ON b.bill_id = fa.bill_id AND b.organization_id = fa.organization_id
      JOIN students s ON s.student_id = fa.student_id AND s.organization_id = fa.organization_id
      LEFT JOIN classes c ON c.class_id = s.class_id AND c.organization_id = s.organization_id
      LEFT JOIN terms t ON t.term_id = b.term_id AND t.organization_id = b.organization_id`,
    joins: STUDENT_JOINS,
    defaultColumns: ["student_name", "class_name", "bill", "amount", "paid", "balance", "status"],
    defaultSort: { key: "student_name", dir: "asc" },
    columns: {
      ...STUDENT_COLUMNS,
      class_name: { label: "Class", expression: "c.class_name" },
      bill: { label: "Bill", expression: "b.title" },
      bill_type: { label: "Bill type", expression: initcap("b.bill_type") },
      term_name: { label: "Term", expression: "t.term_name" },
      billed_on: { label: "Billed on", expression: "fa.created_at", type: "datetime" },
      due_date: { label: "Due", expression: "b.due_date", type: "date" },
      amount: { label: "Billed", expression: "COALESCE(fa.amount, 0) + COALESCE(fa.late_fee_applied, 0)", type: "money" },
      late_fee: { label: "Late fee", expression: "COALESCE(fa.late_fee_applied, 0)", type: "money" },
      paid: { label: "Paid", expression: "COALESCE(fa.amount_paid, 0)", type: "money" },
      balance: {
        label: "Balance",
        expression: "GREATEST(COALESCE(fa.amount, 0) + COALESCE(fa.late_fee_applied, 0) - COALESCE(fa.amount_paid, 0), 0)",
        type: "money",
      },
      status: { label: "Status", expression: initcap("fa.status") },
      ...PARENT_COLUMNS,
    },
    criteria: [
      ...studentCriteria(),
      classCriterion("s.class_id"),
      termCriterion("b.term_id"),
      selectCriterion("bill", "Bill", "b.bill_id",
        "SELECT bill_id::text AS value, title AS label FROM finance_bills WHERE organization_id = $1 ORDER BY created_at DESC LIMIT 200"),
      selectCriterion("status", "Status", "fa.status", distinctOptions("finance_bill_assignments", "status")),
      choiceCriterion("balance", "Balance", [
        { value: "owing", label: "Still owing", sql: "COALESCE(fa.amount, 0) + COALESCE(fa.late_fee_applied, 0) - COALESCE(fa.amount_paid, 0) > 0" },
        { value: "cleared", label: "Paid in full", sql: "COALESCE(fa.amount, 0) + COALESCE(fa.late_fee_applied, 0) - COALESCE(fa.amount_paid, 0) <= 0" },
        { value: "overdue", label: "Overdue", sql: "b.due_date < CURRENT_DATE AND COALESCE(fa.amount, 0) + COALESCE(fa.late_fee_applied, 0) - COALESCE(fa.amount_paid, 0) > 0" },
      ]),
      dateCriterion("Due between", "b.due_date"),
      dateCriterion("Billed between", "fa.created_at", "billed"),
    ],
  },
  payments: {
    title: "Fees & payments",
    variant: "Payments",
    permission: "manage_paygira",
    requires: "fees",
    organizationExpression: "fp.organization_id",
    classExpression: "s.class_id",
    stableOrderExpressions: ["fp.payment_id"],
    from: `FROM finance_payments fp
      LEFT JOIN students s ON s.student_id = fp.student_id AND s.organization_id = fp.organization_id
      LEFT JOIN classes c ON c.class_id = s.class_id AND c.organization_id = s.organization_id
      LEFT JOIN finance_bills b ON b.bill_id = fp.bill_id AND b.organization_id = fp.organization_id
      LEFT JOIN users ru ON ru.user_id = fp.received_by`,
    joins: STUDENT_JOINS,
    defaultColumns: ["received_at", "student_name", "class_name", "bill", "amount", "method"],
    defaultSort: { key: "received_at", dir: "desc" },
    columns: {
      received_at: { label: "Date", expression: "fp.received_at", type: "datetime" },
      ...STUDENT_COLUMNS,
      class_name: { label: "Class", expression: "c.class_name" },
      bill: { label: "Bill", expression: "b.title" },
      amount: { label: "Amount", expression: "CASE WHEN COALESCE(fp.is_refund, FALSE) THEN -fp.amount ELSE fp.amount END", type: "money" },
      kind: { label: "Type", expression: "CASE WHEN COALESCE(fp.is_refund, FALSE) THEN 'Refund' ELSE 'Payment' END" },
      method: { label: "Method", expression: initcap("fp.method") },
      reference: { label: "Reference", expression: "fp.reference" },
      received_by: { label: "Received by", expression: fullName("ru") },
      notes: { label: "Notes", expression: "fp.notes" },
      ...PARENT_COLUMNS,
    },
    criteria: [
      ...studentCriteria(),
      textCriterion("reference", "Reference", fieldsMatch(["fp.reference"])),
      nameCriterion("received_by", "Received by", fieldsMatch([fullName("ru")])),
      classCriterion("s.class_id"),
      selectCriterion("method", "Method", "fp.method", distinctOptions("finance_payments", "method")),
      selectCriterion("bill", "Bill", "fp.bill_id",
        "SELECT bill_id::text AS value, title AS label FROM finance_bills WHERE organization_id = $1 ORDER BY created_at DESC LIMIT 200"),
      choiceCriterion("kind", "Type", [
        { value: "payment", label: "Payments", sql: "COALESCE(fp.is_refund, FALSE) = FALSE" },
        { value: "refund", label: "Refunds", sql: "COALESCE(fp.is_refund, FALSE) = TRUE" },
      ]),
      dateCriterion("Paid between", "fp.received_at"),
    ],
  },

  // School activity
  announcements: {
    title: "Announcements & events",
    variant: "Announcements",
    permission: "manage_reports",
    organizationExpression: "an.organization_id",
    classExpression: null,
    stableOrderExpressions: ["an.announcement_id"],
    from: `FROM announcements an
      LEFT JOIN terms t ON t.term_id = an.term_id AND t.organization_id = an.organization_id
      LEFT JOIN school_years sy ON sy.id = an.school_year_id AND sy.organization_id = an.organization_id`,
    defaultColumns: ["created_at", "message", "audience", "term_name"],
    defaultSort: { key: "created_at", dir: "desc" },
    columns: {
      created_at: { label: "Posted", expression: "an.created_at", type: "datetime" },
      message: { label: "Announcement", expression: "an.message" },
      audience: { label: "Audience", expression: audience("an.visibility") },
      term_name: { label: "Term", expression: "t.term_name" },
      school_year: { label: "School year", expression: "sy.year_label" },
    },
    criteria: [
      textCriterion("search", "Announcement text", fieldsMatch(["an.message"])),
      selectCriterion("audience", "Audience", "an.visibility",
        `SELECT DISTINCT visibility AS value, ${audience("visibility")} AS label FROM announcements WHERE organization_id = $1 AND visibility IS NOT NULL ORDER BY 2`),
      termCriterion("an.term_id"),
      dateCriterion("Posted between", "an.created_at"),
    ],
  },
  events: {
    title: "Announcements & events",
    variant: "Events",
    permission: "manage_reports",
    organizationExpression: "ev.organization_id",
    classExpression: null,
    stableOrderExpressions: ["ev.id"],
    from: `FROM school_events ev
      LEFT JOIN terms t ON t.term_id = ev.term_id AND t.organization_id = ev.organization_id
      LEFT JOIN users eu ON eu.user_id = ev.created_by`,
    defaultColumns: ["event_date", "name", "time", "location", "audience"],
    defaultSort: { key: "event_date", dir: "desc" },
    columns: {
      event_date: { label: "Date", expression: "ev.event_date", type: "date" },
      end_date: { label: "End date", expression: "ev.end_date", type: "date" },
      name: { label: "Event", expression: "ev.name" },
      time: {
        label: "Time",
        expression: "CASE WHEN COALESCE(ev.all_day, FALSE) OR ev.start_time IS NULL THEN 'All day' ELSE CONCAT_WS(' – ', TO_CHAR(ev.start_time, 'HH24:MI'), TO_CHAR(ev.end_time, 'HH24:MI')) END",
      },
      location: { label: "Location", expression: "ev.location" },
      details: { label: "Details", expression: "ev.details" },
      audience: { label: "Audience", expression: audience("ev.visibility") },
      term_name: { label: "Term", expression: "t.term_name" },
      created_by: { label: "Created by", expression: fullName("eu") },
    },
    criteria: [
      textCriterion("search", "Event name", fieldsMatch(["ev.name"])),
      textCriterion("details", "Details or location", fieldsMatch(["ev.details", "ev.location"])),
      selectCriterion("audience", "Audience", "ev.visibility",
        `SELECT DISTINCT visibility AS value, ${audience("visibility")} AS label FROM school_events WHERE organization_id = $1 AND visibility IS NOT NULL ORDER BY 2`),
      termCriterion("ev.term_id"),
      dateCriterion("Date between", "ev.event_date"),
    ],
  },
  activity_log: {
    title: "Activity log",
    variant: "Activity log",
    permission: "manage_reports",
    organizationExpression: "l.organization_id",
    classExpression: null,
    stableOrderExpressions: ["l.log_id"],
    from: "FROM organization_activity_logs l",
    defaultColumns: ["created_at", "user_name", "action_type", "module_name", "description"],
    defaultSort: { key: "created_at", dir: "desc" },
    columns: {
      created_at: { label: "Date & time", expression: "l.created_at", type: "datetime" },
      user_name: { label: "User", expression: "l.user_name" },
      user_role: { label: "Role", expression: "l.user_role" },
      action_type: { label: "Action", expression: "l.action_type" },
      module_name: { label: "Area", expression: "l.module_name" },
      record_label: { label: "Record", expression: "l.record_label" },
      record_type: { label: "Record type", expression: "l.record_type" },
      description: { label: "Details", expression: "l.description" },
    },
    criteria: [
      textCriterion("search", "Search the log", fieldsMatch(["l.action_type", "l.module_name", "l.record_label", "l.description"])),
      textCriterion("record", "Record (student, class…)", fieldsMatch(["l.record_label"])),
      selectCriterion("employee", "Employee", "l.user_id",
        "SELECT user_id::text AS value, TRIM(CONCAT_WS(' ', first_name, last_name)) || COALESCE(' · ' || NULLIF(account_type::text, ''), '') AS label FROM users WHERE organization_id = $1 ORDER BY 2 LIMIT 1000"),
      selectCriterion("record_type", "Record type", "l.record_type",
        "SELECT DISTINCT record_type AS value, INITCAP(REPLACE(record_type, '_', ' ')) AS label FROM organization_activity_logs WHERE organization_id = $1 AND NULLIF(record_type, '') IS NOT NULL ORDER BY 2 LIMIT 100"),
      selectCriterion("user", "Name in the log", "l.user_name",
        "SELECT DISTINCT user_name AS value, user_name AS label FROM organization_activity_logs WHERE organization_id = $1 ORDER BY 1 LIMIT 300"),
      selectCriterion("role", "Role", "l.user_role",
        "SELECT DISTINCT user_role AS value, user_role AS label FROM organization_activity_logs WHERE organization_id = $1 AND user_role IS NOT NULL ORDER BY 1 LIMIT 100"),
      selectCriterion("action", "Action", "l.action_type",
        "SELECT DISTINCT action_type AS value, action_type AS label FROM organization_activity_logs WHERE organization_id = $1 ORDER BY 1 LIMIT 100"),
      selectCriterion("area", "Area", "l.module_name",
        "SELECT DISTINCT module_name AS value, module_name AS label FROM organization_activity_logs WHERE organization_id = $1 ORDER BY 1 LIMIT 200"),
      dateCriterion("Date between", "l.created_at"),
    ],
  },
};

// What the "Create new report" list shows: a few entries, each with one or
// more views (report keys). Views of one entry are switched on the next steps.
const FAMILIES = [
  { key: "students", group: "Students", title: "Students", description: "Profiles, class, parents, bus and status, current and former", views: ["students"] },
  { key: "admissions", group: "Students", title: "Admissions & enrollment", description: "Online applications and enrollment by term", views: ["admissions", "enrollments"] },
  { key: "assessments", group: "Students", title: "Assessments", description: "Recorded scores and online tests", views: ["assessment_results", "online_tests"] },
  { key: "merit", group: "Students", title: "Merit sheet", description: "Class rankings by term: totals, averages, grades, positions and remarks", views: ["merit_ranking", "merit_subjects"] },
  { key: "attendance", group: "Students", title: "Attendance", description: "Daily marks, totals per student and class counts", views: ["attendance", "attendance_summary", "class_attendance"] },
  { key: "parents", group: "Parents & messages", title: "Parents & guardians", description: "Contacts, children and parent portal access", views: ["parents"] },
  { key: "parent_messages", group: "Parents & messages", title: "Parent messages", description: "Messages from parents and how they were handled", views: ["parent_messages"] },
  { key: "messages", group: "Parents & messages", title: "Messages sent", description: "Emails, texts and report cards, and undelivered emails", views: ["message_delivery", "failed_emails"] },
  { key: "staff", group: "School", title: "Staff", description: "Staff contacts, roles, classes and tasks", views: ["staff", "staff_tasks"] },
  { key: "fees", group: "School", title: "Fees & payments", description: "Balances owed and payments received", views: ["fee_balances", "payments"] },
  { key: "school_updates", group: "School", title: "Announcements & events", description: "Posts to staff and parents, and calendar events", views: ["announcements", "events"] },
  { key: "activity_log", group: "School", title: "Activity log", description: "Who did what in the app, and when", views: ["activity_log"] },
];
const GROUP_ORDER = ["Students", "Parents & messages", "School"];

// Class and term lead every filter list, in that order.
const FILTER_ORDER = { class: 0, term: 1 };
Object.values(REPORTS).forEach((report) => {
  report.criteria.sort((a, b) => (FILTER_ORDER[a.type] ?? 2) - (FILTER_ORDER[b.type] ?? 2));
});

// School features some reports, columns and criteria depend on ($1 = organization id).
const FEATURES = {
  transport: "SELECT EXISTS (SELECT 1 FROM transport_routes WHERE organization_id = $1) AS available",
  fees: "SELECT EXISTS (SELECT 1 FROM finance_bills WHERE organization_id = $1) AS available",
  // Plan feature: the school's plan includes the class merit sheet.
  merit: async (db, organizationId) => {
    const { resolvePlanForOrganization } = require("./accessCache");
    const plan = await resolvePlanForOrganization(db, organizationId);
    if (!plan?.planId) return false;
    const result = await db.query(
      `SELECT 1 FROM features f JOIN plan_features pf ON pf.feature_id = f.id
        WHERE pf.plan_id = $1 AND f.feature_name IN ('Class Base Merit Sheet', 'Class Base Merrit sheet') LIMIT 1`,
      [plan.planId]
    );
    return result.rows.length > 0;
  },
};
const PAGE_SIZES = [25, 50, 100];
const PAGE_SIZE = 25;
const MAX_EXPORT_ROWS = 10000;

function getReport(reportType) {
  const key = String(reportType || "");
  return Object.hasOwn(REPORTS, key) ? REPORTS[key] : null;
}

// Columns and criteria can carry their own permission (fee figures need the
// fee permission even on the student roster).
// `granted` holds the person's permissions plus "feature:<name>" for features the school uses.
const allowedBy = (granted) => (item) => !granted
  || ((!item.permission || granted.has(item.permission)) && (!item.requires || granted.has(`feature:${item.requires}`)));

function normalizeColumns(report, selectedColumns, granted = null) {
  const requested = Array.isArray(selectedColumns) ? selectedColumns : [];
  const allowed = allowedBy(granted);
  const valid = [...new Set(requested.filter((key) =>
    typeof key === "string" && Object.hasOwn(report.columns, key) && allowed(report.columns[key])))];
  return valid.length ? valid : report.defaultColumns.filter((key) => allowed(report.columns[key]));
}

function normalizeDate(value) {
  const raw = String(value || "");
  if (!raw) return "";
  if (!/^\d{4}-\d{2}-\d{2}$/.test(raw)) return null;
  const date = new Date(`${raw}T00:00:00.000Z`);
  return Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== raw ? null : raw;
}

// Keeps only criteria this report defines, with values of the right shape.
// Returns { values, error }.
function normalizeCriteria(report, criteria = {}, granted = null) {
  const safe = criteria && typeof criteria === "object" && !Array.isArray(criteria) ? criteria : {};
  const allowed = allowedBy(granted);
  const values = {};
  for (const definition of report.criteria || []) {
    if (!Object.hasOwn(safe, definition.key) || !allowed(definition)) continue;
    const raw = safe[definition.key];
    if (definition.type === "date") {
      const range = raw && typeof raw === "object" ? raw : {};
      const from = normalizeDate(range.from);
      const to = normalizeDate(range.to);
      if (from === null || to === null) return { values, error: "Enter dates in a valid YYYY-MM-DD format." };
      if (from && to && from > to) return { values, error: "The start date must be before the end date." };
      if (from || to) values[definition.key] = { from, to };
      continue;
    }
    // Class, term and list filters accept one or more values (older saved
    // reports stored a single value).
    if (["class", "term", "select"].includes(definition.type)) {
      const list = [...new Set((Array.isArray(raw) ? raw : [raw])
        .map((item) => String(item ?? "").trim().slice(0, 100)).filter(Boolean))].slice(0, 200);
      const picked = definition.type === "select"
        ? list
        : list.filter((item) => /^\d+$/.test(item)).map(Number).filter((id) => Number.isSafeInteger(id) && id > 0);
      if (picked.length) values[definition.key] = picked;
      continue;
    }
    const text = String(raw ?? "").trim().slice(0, definition.type === "text" ? 500 : 100);
    if (!text) continue;
    if (definition.type === "scale") {
      const scale = scaleValue(text);
      if (scale) values[definition.key] = scale;
      else return { values, error: "Subject scaling: enter a number between 1 and 1000." };
    } else if (definition.type === "choice") {
      if (definition.options.some((option) => option.value === text)) values[definition.key] = text;
    } else {
      values[definition.key] = text;
    }
  }
  return { values, error: null };
}

function normalizeSort(report, columns, sort) {
  const requested = sort && typeof sort === "object" ? sort : {};
  const fallback = report.defaultSort && columns.includes(report.defaultSort.key)
    ? report.defaultSort
    : { key: columns[0], dir: "asc" };
  const key = columns.includes(requested.key) ? requested.key : fallback.key;
  const dir = requested.key === key && ["asc", "desc"].includes(requested.dir)
    ? requested.dir
    : (key === fallback.key ? fallback.dir : "asc");
  return { key, dir };
}

// Builds the count and data queries for one run. Both share the same bound
// values; the data query adds LIMIT/OFFSET at the end.
function buildQueries(report, { columns, criteria = {}, organizationId, allowedClassIds = null, sort, limit, offset = 0 }) {
  const values = [organizationId];
  const bind = (value) => {
    values.push(value);
    return `$${values.length}`;
  };

  const fromSql = typeof report.from === "function" ? report.from(bind, criteria) : report.from;
  const clauses = [`${report.organizationExpression} = $1`];
  if (report.baseWhere) clauses.push(report.baseWhere);
  if (allowedClassIds) {
    if (!allowedClassIds.length || !report.classExpression) clauses.push("1 = 0");
    else clauses.push(`${report.classExpression} = ANY(${bind(allowedClassIds)}::int[])`);
  }
  const criteriaJoins = new Set();
  for (const definition of report.criteria || []) {
    if (!Object.hasOwn(criteria, definition.key) || definition.inFrom) continue;
    const clause = definition.where(bind, criteria[definition.key]);
    if (!clause) continue;
    clauses.push(clause);
    if (definition.join) criteriaJoins.add(definition.join);
  }
  const whereSql = clauses.join(" AND ");
  const order = normalizeSort(report, columns, sort);
  const dataJoins = new Set(criteriaJoins);
  columns.forEach((key) => { if (report.columns[key].join) dataJoins.add(report.columns[key].join); });
  const joinSql = (names) => [...names].map((name) => report.joins[name]).join("\n");

  // Plain dates are returned as text so they never shift with the server's time zone.
  const selections = columns.map((key) => {
    const column = report.columns[key];
    const expression = column.type === "date" ? `TO_CHAR(${column.expression}, 'YYYY-MM-DD')` : column.expression;
    return `${expression} AS "${key}"`;
  }).join(", ");
  const direction = order.dir === "desc" ? "DESC" : "ASC";
  const stableOrder = report.stableOrderExpressions.map((expression) => `${expression} ${direction}`).join(", ");

  const countSql = `SELECT COUNT(*)::int AS total ${fromSql} ${joinSql(criteriaJoins)} WHERE ${whereSql}`;
  let dataSql = `SELECT ${selections} ${fromSql} ${joinSql(dataJoins)} WHERE ${whereSql}
    ORDER BY ${report.columns[order.key].expression} ${direction} NULLS LAST, ${stableOrder}`;
  const dataValues = [...values];
  if (Number.isInteger(limit)) {
    dataValues.push(limit);
    dataSql += ` LIMIT $${dataValues.length}`;
    if (offset > 0) {
      dataValues.push(offset);
      dataSql += ` OFFSET $${dataValues.length}`;
    }
  }
  // Totals over every matching record (not just this page), overall or per class.
  let summary = null;
  const totalsMode = criteria.totals;
  const measured = columns.filter((key) => ["number", "money"].includes(report.columns[key].type) && totalKind(report.columns[key]) !== "none");
  if (totalsMode && measured.length) {
    const classColumn = totalsMode === "class" ? report.columns.class_name : null;
    const summaryJoins = new Set(criteriaJoins);
    measured.forEach((key) => { if (report.columns[key].join) summaryJoins.add(report.columns[key].join); });
    if (classColumn && classColumn.join) summaryJoins.add(classColumn.join);
    const aggregates = measured.map((key, i) => {
      const expression = `(${report.columns[key].expression})::numeric`;
      return `SUM(${expression}) AS "s${i}", AVG(${expression}) AS "a${i}", COUNT(${expression}) AS "c${i}"`;
    }).join(", ");
    const group = classColumn ? `COALESCE((${classColumn.expression})::text, 'No class')` : "'All'";
    summary = {
      sql: `SELECT ${group} AS grp, COUNT(*)::int AS records, ${aggregates} ${fromSql} ${joinSql(summaryJoins)} WHERE ${whereSql}
        ${classColumn ? `GROUP BY ROLLUP (${group}) ORDER BY GROUPING(${group}), 1` : ""}`,
      values,
      measured: measured.map((key) => ({ key, kind: totalKind(report.columns[key]) })),
      byClass: Boolean(classColumn),
    };
  }
  return { count: { sql: countSql, values }, data: { sql: dataSql, values: dataValues }, sort: order, summary };
}

// How a number column adds up: amounts and counts get a total and an
// average; percentages, averages and rates only an average; positions and
// sizes neither (adding them up means nothing).
function totalKind(column) {
  const label = String(column.label || "");
  if (/position|rank|class size|\bid\b|year/i.test(label)) return "none";
  if (/%|percent|average|rate|^age$|out of/i.test(label)) return "average";
  return "total";
}

// "Totals" (Summary section): sums and averages under the results.
Object.values(REPORTS).forEach((report) => {
  const numbers = Object.values(report.columns || {}).filter((column) => ["number", "money"].includes(column.type) && totalKind(column) !== "none");
  if (!numbers.length || !Array.isArray(report.criteria)) return;
  report.criteria.push({
    key: "totals",
    label: "Totals",
    type: "choice",
    group: "Summary",
    inFrom: true,
    options: [
      { value: "all", label: "Totals for all records" },
      ...(report.columns.class_name ? [{ value: "class", label: "Totals per class" }] : []),
    ],
    where: () => null,
  });
});

// Audit join per kind of record (see AUDIT_COLUMNS).
Object.values(REPORTS).forEach((report) => {
  if (!report.columns || !report.columns.audit_count) return;
  const isParent = report === REPORTS.parents, isStaff = report === REPORTS.staff;
  report.joins = {
    ...(report.joins || {}),
    audit: isParent ? auditJoin(["Guardian Record"], "gp.guardian_id")
      : isStaff ? auditJoin(["User Record"], "u.user_id")
      : auditJoin(["Student Record", "Students"], "s.student_id"),
  };
});

// One criterion per key: a report's own definition (listed after the shared
// ones) replaces the shared one in its place.
Object.values(REPORTS).forEach((report) => {
  if (!Array.isArray(report.criteria)) return;
  const last = new Map(report.criteria.map((criterion) => [criterion.key, criterion]));
  const seen = new Set();
  report.criteria = report.criteria.filter((criterion) => !seen.has(criterion.key) && seen.add(criterion.key)).map((criterion) => last.get(criterion.key));
});
// Every report with a term can also be narrowed to, shown and sorted by school year.
const schoolYearOf = (termExpression) => `(SELECT sy3.year_label FROM terms t3
    JOIN school_years sy3 ON sy3.id = t3.school_year_id AND sy3.organization_id = t3.organization_id
   WHERE t3.term_id = ${termExpression})`;
Object.values(REPORTS).forEach((report) => {
  const term = (report.criteria || []).find((criterion) => criterion.key === "term" && criterion.termExpression);
  if (!term) return;
  if (!report.criteria.some((criterion) => criterion.key === "school_year")) {
    report.criteria.splice(report.criteria.indexOf(term) + 1, 0, selectCriterion("school_year", "School year",
      `(SELECT t4.school_year_id FROM terms t4 WHERE t4.term_id = ${term.termExpression})`,
      "SELECT id::text AS value, year_label AS label FROM school_years WHERE organization_id = $1 ORDER BY year_label DESC LIMIT 50"));
  }
  if (report.columns && !Object.values(report.columns).some((column) => column.label === "School year")) {
    report.columns.school_year = { label: "School year", expression: schoolYearOf(term.termExpression) };
  }
});

// The Students report already has "Born between" and "Hometown or address".
REPORTS.students.criteria = REPORTS.students.criteria.filter((criterion) => !["dob", "home_address"].includes(criterion.key));

module.exports = {
  REPORTS,
  FAMILIES,
  FEATURES,
  GROUP_ORDER,
  PAGE_SIZES,
  PAGE_SIZE,
  MAX_EXPORT_ROWS,
  getReport,
  allowedBy,
  splitTerms,
  normalizeColumns,
  normalizeCriteria,
  normalizeSort,
  buildQueries,
};
