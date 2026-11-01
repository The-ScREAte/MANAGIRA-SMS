const STUDENT_PARENT_JOIN = `LEFT JOIN LATERAL (
      SELECT
        STRING_AGG(DISTINCT NULLIF(TRIM(CONCAT_WS(' ', p.first_name, p.last_name)), ''), '; ' ORDER BY NULLIF(TRIM(CONCAT_WS(' ', p.first_name, p.last_name)), '')) AS parent_name,
        STRING_AGG(DISTINCT NULLIF(TRIM(p.relationship), ''), '; ' ORDER BY NULLIF(TRIM(p.relationship), '')) AS parent_relationship,
        STRING_AGG(DISTINCT NULLIF(TRIM(p.phone), ''), '; ' ORDER BY NULLIF(TRIM(p.phone), '')) AS parent_phone,
        STRING_AGG(DISTINCT NULLIF(TRIM(p.email), ''), '; ' ORDER BY NULLIF(TRIM(p.email), '')) AS parent_email
      FROM (
        SELECT gp.first_name, gp.last_name, gs.relationship, gp.phone, gp.email
          FROM guardian_students gs
          JOIN guardian_profiles gp
            ON gp.guardian_id = gs.guardian_id
           AND gp.organization_id = s.organization_id
         WHERE gs.student_id = s.student_id
        UNION ALL
        SELECT g.first_name, g.last_name, NULL::varchar AS relationship, g.phone, g.email
          FROM guardians g
         WHERE g.organization_id = s.organization_id
           AND g.student_id = s.student_id
      ) p
    ) parent ON TRUE`;

const PARENT_COLUMNS = {
  parent_name: { label: "Parent / guardian", expression: "parent.parent_name" },
  parent_relationship: { label: "Relationship", expression: "parent.parent_relationship" },
  parent_phone: { label: "Parent phone", expression: "parent.parent_phone" },
  parent_email: { label: "Parent email", expression: "parent.parent_email" },
};

const REPORTS = {
  students: {
    title: "Student roster",
    description: "Student profiles and current class placement.",
    searchLabel: "Find a student",
    organizationExpression: "s.organization_id",
    classExpression: "s.class_id",
    termExpression: null,
    stableOrderExpressions: ["s.student_id"],
    from: `FROM students s
      LEFT JOIN classes c ON c.class_id = s.class_id AND c.organization_id = s.organization_id
      ${STUDENT_PARENT_JOIN}`,
    defaultColumns: ["student_id", "student_name", "class_name", "email", "parent_name"],
    columns: {
      student_id: { label: "Student ID", expression: "s.student_id" },
      student_name: { label: "Student name", expression: "TRIM(CONCAT_WS(' ', s.first_name, s.last_name))" },
      class_name: { label: "Class", expression: "c.class_name" },
      email: { label: "Email", expression: "s.email" },
      gender: { label: "Gender", expression: "s.gender" },
      date_of_birth: { label: "Date of birth", expression: "s.date_of_birth" },
      student_status: {
        label: "Student status",
        expression: "CASE WHEN COALESCE(s.graduated, FALSE) THEN 'Graduated' ELSE 'Active' END",
      },
      ...PARENT_COLUMNS,
    },
  },
  enrollments: {
    title: "Enrollment list",
    description: "Students enrolled in classes and academic terms.",
    searchLabel: "Find a student",
    organizationExpression: "e.organization_id",
    classExpression: "es.class_id",
    termExpression: "e.term_id",
    stableOrderExpressions: ["e.enrollment_id", "es.student_id"],
    from: `FROM enrollments e
      JOIN enrolled_students es ON es.enrollment_id = e.enrollment_id
      JOIN students s ON s.student_id = es.student_id AND s.organization_id = e.organization_id
      LEFT JOIN classes c ON c.class_id = es.class_id AND c.organization_id = e.organization_id
      LEFT JOIN terms t ON t.term_id = e.term_id AND t.organization_id = e.organization_id
      LEFT JOIN school_years sy ON sy.id = e.school_year_id AND sy.organization_id = e.organization_id
      ${STUDENT_PARENT_JOIN}`,
    defaultColumns: ["student_name", "class_name", "school_year", "term_name", "student_id"],
    columns: {
      student_name: { label: "Student name", expression: "TRIM(CONCAT_WS(' ', s.first_name, s.last_name))" },
      student_id: { label: "Student ID", expression: "s.student_id" },
      class_name: { label: "Class", expression: "c.class_name" },
      school_year: { label: "School year", expression: "sy.year_label" },
      term_name: { label: "Term", expression: "t.term_name" },
      gender: { label: "Gender", expression: "s.gender" },
      ...PARENT_COLUMNS,
    },
  },
  attendance: {
    title: "Attendance",
    description: "Attendance records by student, date, and class.",
    searchLabel: "Find a student",
    organizationExpression: "ar.organization_id",
    classExpression: "ar.class_id",
    termExpression: "ar.term_id",
    dateExpression: "ar.date",
    stableOrderExpressions: ["ar.date", "ar.student_id", "ar.class_id"],
    from: `FROM attendance_records ar
      JOIN students s ON s.student_id = ar.student_id AND s.organization_id = ar.organization_id
      LEFT JOIN classes c ON c.class_id = ar.class_id AND c.organization_id = ar.organization_id
      LEFT JOIN terms t ON t.term_id = ar.term_id AND t.organization_id = ar.organization_id
      ${STUDENT_PARENT_JOIN}`,
    defaultColumns: ["date", "student_name", "class_name", "status", "term_name"],
    columns: {
      date: { label: "Date", expression: "ar.date" },
      student_name: { label: "Student name", expression: "TRIM(CONCAT_WS(' ', s.first_name, s.last_name))" },
      student_id: { label: "Student ID", expression: "s.student_id" },
      class_name: { label: "Class", expression: "c.class_name" },
      status: { label: "Attendance status", expression: "ar.status" },
      term_name: { label: "Term", expression: "t.term_name" },
      ...PARENT_COLUMNS,
    },
  },
  assessment_results: {
    title: "Assessment results",
    description: "Recorded student scores by assessment, subject, and term.",
    searchLabel: "Find a student",
    organizationExpression: "ar.organization_id",
    classExpression: "ar.class_id",
    termExpression: "ar.term_id",
    stableOrderExpressions: ["ar.student_id", "ar.assessment_id", "ar.subject_id", "ar.category", "ar.choice_label"],
    from: `FROM assessment_results ar
      JOIN students s ON s.student_id = ar.student_id AND s.organization_id = ar.organization_id
      LEFT JOIN classes c ON c.class_id = ar.class_id AND c.organization_id = ar.organization_id
      LEFT JOIN subjects sub ON sub.subject_id = ar.subject_id AND sub.organization_id = ar.organization_id
      LEFT JOIN assessments a ON a.assessment_id = ar.assessment_id AND a.organization_id = ar.organization_id
      LEFT JOIN terms t ON t.term_id = ar.term_id AND t.organization_id = ar.organization_id
      ${STUDENT_PARENT_JOIN}`,
    defaultColumns: ["student_name", "class_name", "subject_name", "assessment_name", "score", "percentage"],
    columns: {
      student_name: { label: "Student name", expression: "TRIM(CONCAT_WS(' ', s.first_name, s.last_name))" },
      student_id: { label: "Student ID", expression: "s.student_id" },
      class_name: { label: "Class", expression: "c.class_name" },
      subject_name: { label: "Subject", expression: "sub.subject_name" },
      assessment_name: { label: "Assessment", expression: "a.title" },
      score: { label: "Score", expression: "ar.score" },
      percentage: { label: "Percentage", expression: "ar.total_percentage" },
      term_name: { label: "Term", expression: "t.term_name" },
      ...PARENT_COLUMNS,
    },
  },
};

const PAGE_SIZE = 50;
const MAX_EXPORT_ROWS = 5000;

function getReport(reportType) {
  const key = String(reportType || "");
  return Object.hasOwn(REPORTS, key) ? REPORTS[key] : null;
}

function normalizeColumns(report, selectedColumns) {
  const requested = Array.isArray(selectedColumns) ? selectedColumns : [];
  const valid = [...new Set(requested.filter((key) => Object.hasOwn(report.columns, key)))];
  return valid.length ? valid : [...report.defaultColumns];
}

function normalizeCriteria(criteria = {}) {
  const safe = criteria && typeof criteria === "object" && !Array.isArray(criteria) ? criteria : {};
  const classValue = String(safe.classId || "");
  const termValue = String(safe.termId || "");
  const classId = /^\d+$/.test(classValue) ? Number(classValue) : null;
  const termId = /^\d+$/.test(termValue) ? Number(termValue) : null;
  const normalizeDate = (value) => {
    const raw = String(value || "");
    if (!raw) return "";
    if (!/^\d{4}-\d{2}-\d{2}$/.test(raw)) return null;
    const date = new Date(`${raw}T00:00:00.000Z`);
    return Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== raw ? null : raw;
  };
  const fromDate = normalizeDate(safe.fromDate);
  const toDate = normalizeDate(safe.toDate);
  return {
    search: String(safe.search || "").trim().slice(0, 100),
    classId: Number.isSafeInteger(classId) && classId > 0 ? classId : null,
    termId: Number.isSafeInteger(termId) && termId > 0 ? termId : null,
    fromDate,
    toDate,
    validDates: fromDate !== null && toDate !== null,
  };
}

function buildWhere(report, criteria, organizationId, allowedClassIds) {
  const values = [organizationId];
  const clauses = [`${report.organizationExpression} = $1`];
  const bind = (value) => {
    values.push(value);
    return `$${values.length}`;
  };

  if (allowedClassIds) {
    if (!allowedClassIds.length) {
      clauses.push("1 = 0");
    } else {
      clauses.push(`${report.classExpression} = ANY(${bind(allowedClassIds)}::int[])`);
    }
  }
  if (criteria.classId && report.classExpression) {
    clauses.push(`${report.classExpression} = ${bind(criteria.classId)}`);
  }
  if (criteria.termId && report.termExpression) {
    clauses.push(`${report.termExpression} = ${bind(criteria.termId)}`);
  }
  if (criteria.search) {
    const search = bind(`%${criteria.search}%`);
    clauses.push(`(CONCAT_WS(' ', s.first_name, s.last_name) ILIKE ${search} OR COALESCE(s.email, '') ILIKE ${search})`);
  }
  if (report.dateExpression && criteria.fromDate) {
    clauses.push(`${report.dateExpression} >= ${bind(criteria.fromDate)}::date`);
  }
  if (report.dateExpression && criteria.toDate) {
    clauses.push(`${report.dateExpression} <= ${bind(criteria.toDate)}::date`);
  }
  return { sql: clauses.join(" AND "), values };
}

function buildSelect(report, selectedColumns, where, { limit, offset = 0 } = {}) {
  const selections = selectedColumns
    .map((key) => `${report.columns[key].expression} AS "${key}"`)
    .join(", ");
  const stableOrder = report.stableOrderExpressions.join(", ");
  let sql = `SELECT ${selections} ${report.from} WHERE ${where.sql}
    ORDER BY ${report.columns[selectedColumns[0]].expression} NULLS LAST, ${stableOrder}`;
  const values = [...where.values];
  if (Number.isInteger(limit)) {
    values.push(limit);
    sql += ` LIMIT $${values.length}`;
    if (offset > 0) {
      values.push(offset);
      sql += ` OFFSET $${values.length}`;
    }
  }
  return { sql, values };
}

module.exports = {
  REPORTS,
  PAGE_SIZE,
  MAX_EXPORT_ROWS,
  getReport,
  normalizeColumns,
  normalizeCriteria,
  buildWhere,
  buildSelect,
};
