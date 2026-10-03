const db = require("../config/db");
const { isEmbeddedRequest } = require("../utils/embeddedMode");
const { renderOrganizationStatsPdf, safeFileSegment, sessionCookieFromHeader } = require("../utils/pdfService");

// Pass mark used for pass rates and "needs support" (a student-subject
// percentage below this counts as not passed).
const PASS_MARK = 50;
// Attendance below this rate counts as a concern.
const LOW_ATTENDANCE_RATE = 75;

const CLASS_ORDER_SQL = "COALESCE(c.dashboard_sort_order, 2147483647), c.class_name ASC, c.class_id ASC";

// Each student's percentage per subject for a term. assessment_results keeps
// the subject percentage on every assessment row, so it is taken once per
// student and subject; averaging raw rows would weight subjects by how many
// assessments they have.
const STUDENT_SUBJECT_SCORES_CTE = `
  student_subject AS (
    SELECT ar.student_id, ar.class_id, ar.subject_id, MAX(ar.total_percentage)::float AS pct
    FROM assessment_results ar
    WHERE ar.organization_id = $1 AND ar.term_id = $2 AND ar.total_percentage IS NOT NULL
    GROUP BY ar.student_id, ar.class_id, ar.subject_id
  )`;

const round1 = (value) => (value === null || value === undefined || Number.isNaN(Number(value)) ? null : Math.round(Number(value) * 10) / 10);

// Terms that have anything saved (enrollments, scores or attendance), plus the
// current term. Empty and future terms are left out everywhere.
async function loadTermsWithData(organizationId) {
  const result = await db.query(
    `WITH data_terms AS (
       SELECT e.term_id
       FROM enrollments e
       JOIN enrolled_students es ON es.enrollment_id = e.enrollment_id
       WHERE e.organization_id = $1
       UNION
       SELECT term_id FROM assessment_results WHERE organization_id = $1
       UNION
       SELECT term_id FROM attendance_records WHERE organization_id = $1
     ),
     result_terms AS (
       SELECT DISTINCT term_id FROM assessment_results WHERE organization_id = $1 AND total_percentage IS NOT NULL
     )
     SELECT t.term_id, t.term_name, t.start_date, t.end_date, COALESCE(t.current, FALSE) AS current,
            sy.id AS school_year_id, sy.year_label,
            EXISTS (SELECT 1 FROM result_terms rt WHERE rt.term_id = t.term_id) AS has_results
     FROM terms t
     JOIN school_years sy ON sy.id = t.school_year_id
     WHERE t.organization_id = $1
       AND (t.term_id IN (SELECT term_id FROM data_terms WHERE term_id IS NOT NULL) OR COALESCE(t.current, FALSE))
     ORDER BY t.start_date ASC NULLS LAST, t.term_id ASC`,
    [organizationId]
  );
  return result.rows;
}

function groupTermsBySchoolYear(terms) {
  const years = [];
  terms.forEach((term) => {
    let year = years.find((entry) => entry.school_year_id === term.school_year_id);
    if (!year) {
      year = { school_year_id: term.school_year_id, year_label: term.year_label, terms: [] };
      years.push(year);
    }
    year.terms.push({ term_id: term.term_id, term_name: term.term_name, current: term.current });
  });
  // Most recent school year first in the selector.
  return years.reverse();
}

function renderStats(req, res, locals) {
  const isPdf = req.query.pdf === "true";
  const isEmbedded = isEmbeddedRequest(req, "organizationStats");
  const hideChrome = isEmbedded || isPdf;
  return res.render("stats/organizationStats", {
    title: "Organization Stats",
    isEmbedded,
    isPdf,
    organizationName: req.session.organizationName || "",
    hideGlobalHeader: hideChrome,
    hideGlobalFooter: hideChrome,
    hideGlobalChatbot: hideChrome,
    passMark: PASS_MARK,
    lowAttendanceRate: LOW_ATTENDANCE_RATE,
    ...locals,
  });
}

const statsController = {
  // Classes with students enrolled in a term (for class comparison).
  getClassesByTerm: async (req, res) => {
    const termId = Number(req.params.termId);
    const organizationId = req.session.organizationId;
    if (!organizationId) return res.status(401).json({ error: "Unauthorized" });
    if (!Number.isInteger(termId)) return res.status(400).json({ error: "Invalid term." });

    try {
      const classes = (await db.query(
        `SELECT c.class_id, c.class_name
         FROM classes c
         WHERE c.organization_id = $2
           AND EXISTS (
             SELECT 1
             FROM enrollments e
             JOIN enrolled_students es ON es.enrollment_id = e.enrollment_id
             WHERE e.term_id = $1 AND e.organization_id = $2 AND es.class_id = c.class_id
           )
         ORDER BY COALESCE(c.dashboard_sort_order, 2147483647), c.class_name ASC, c.class_id ASC`,
        [termId, organizationId]
      )).rows;

      res.json(classes);
    } catch (err) {
      console.error("[stats/getClassesByTerm]", err);
      res.status(500).json({ error: "Failed to fetch classes." });
    }
  },

  // Side-by-side figures for chosen classes in one term.
  compareClassesStats: async (req, res) => {
    const organizationId = req.session.organizationId;
    if (!organizationId) return res.status(401).json({ error: "Unauthorized" });
    const termId = Number(req.body?.termId);
    const selectedClasses = (Array.isArray(req.body?.selectedClasses) ? req.body.selectedClasses : [])
      .map(Number)
      .filter((id) => Number.isInteger(id) && id > 0);
    if (!Number.isInteger(termId)) return res.status(400).json({ error: "Select a term." });
    if (!selectedClasses.length) return res.status(400).json({ error: "No classes selected." });

    try {
      res.json(await compareClasses(organizationId, termId, selectedClasses));
    } catch (err) {
      console.error("[stats/compareClassesStats]", err);
      res.status(500).json({ error: "Failed to compare classes." });
    }
  },

  getOrganizationStats: async (req, res) => {
    const organizationId = req.session.organizationId;
    if (!organizationId) return res.status(403).send("Unauthorized access.");

    try {
      const { schoolYears, currentTerm, selectedSchoolYear, stats } = await buildOrganizationStats(organizationId, req.query.selectedTermId);
      return renderStats(req, res, { schoolYears, currentTerm, selectedSchoolYear, stats });
    } catch (error) {
      console.error("[stats/getOrganizationStats]", error);
      req.flash("error", "Failed to load organization stats.");
      return res.redirect("/");
    }
  },

  // Spreadsheet (CSV, opens in Excel) of every figure on the page.
  exportOrganizationStats: async (req, res) => {
    const organizationId = req.session.organizationId;
    if (!organizationId) return res.status(403).send("Unauthorized access.");

    try {
      const { currentTerm, stats } = await buildOrganizationStats(organizationId, req.query.selectedTermId);
      if (!stats) return res.status(404).send("No statistics to export yet.");
      const fileName = statsFileName(req.session.organizationName, currentTerm, "csv");
      res.setHeader("Content-Type", "text/csv; charset=utf-8");
      res.setHeader("Content-Disposition", `attachment; filename="${fileName}"`);
      res.setHeader("Cache-Control", "no-store");
      return res.send(`\uFEFF${statsToCsv(currentTerm, stats)}`);
    } catch (error) {
      console.error("[stats/exportOrganizationStats]", error);
      return res.status(500).send("Failed to export organization stats.");
    }
  },

  // PDF of the page as staff see it (same charts and colours).
  downloadOrganizationStatsPdf: async (req, res) => {
    const organizationId = req.session.organizationId;
    if (!organizationId) return res.status(403).json({ error: "Unauthorized access." });

    try {
      const terms = await loadTermsWithData(organizationId);
      const term = pickTerm(terms, req.query.selectedTermId);
      if (!term) return res.status(404).json({ error: "No statistics to download yet." });

      const pdf = await renderOrganizationStatsPdf({
        baseUrl: `${req.protocol}://${req.get("host")}`,
        sessionCookie: sessionCookieFromHeader(req.headers.cookie),
        termId: term.term_id,
      });
      const fileName = statsFileName(req.session.organizationName, term, "pdf");
      res.setHeader("Content-Type", "application/pdf");
      res.setHeader("Content-Disposition", `attachment; filename="${fileName}"`);
      res.setHeader("Cache-Control", "no-store");
      return res.send(pdf);
    } catch (error) {
      console.error("[stats/downloadOrganizationStatsPdf]", error);
      return res.status(500).json({ error: error.userMessage || "The PDF could not be generated. Please try again." });
    }
  },
};

function pickTerm(terms, requestedTermId) {
  if (!terms.length) return null;
  const requested = Number(requestedTermId);
  return (
    terms.find((term) => term.term_id === requested) ||
    terms.find((term) => term.current) ||
    terms[terms.length - 1]
  );
}

// Side-by-side figures for chosen classes in one term (the page's Compare
// classes panel, and Mira).
async function compareClasses(organizationId, termId, classIds) {
  const rows = (await db.query(
    `WITH ${STUDENT_SUBJECT_SCORES_CTE},
     enrolled AS (
       SELECT es.class_id, COUNT(DISTINCT es.student_id)::int AS enrolled
       FROM enrollments e
       JOIN enrolled_students es ON es.enrollment_id = e.enrollment_id
       WHERE e.organization_id = $1 AND e.term_id = $2
       GROUP BY es.class_id
     ),
     scores AS (
       SELECT class_id,
              AVG(pct) AS average_score,
              COUNT(*) FILTER (WHERE pct >= $4)::int AS passed,
              COUNT(*)::int AS results
       FROM student_subject
       GROUP BY class_id
     ),
     attendance AS (
       SELECT class_id,
              COUNT(*) FILTER (WHERE status = 'Present')::int AS present,
              COUNT(*)::int AS marked
       FROM attendance_records
       WHERE organization_id = $1 AND term_id = $2
       GROUP BY class_id
     )
     SELECT c.class_id, c.class_name,
            COALESCE(en.enrolled, 0) AS enrolled,
            sc.average_score,
            sc.passed, sc.results,
            at.present, at.marked
     FROM classes c
     LEFT JOIN enrolled en ON en.class_id = c.class_id
     LEFT JOIN scores sc ON sc.class_id = c.class_id
     LEFT JOIN attendance at ON at.class_id = c.class_id
     WHERE c.organization_id = $1 AND c.class_id = ANY($3::int[])
     ORDER BY ${CLASS_ORDER_SQL}`,
    [organizationId, termId, classIds, PASS_MARK]
  )).rows;

  return rows.map((row) => ({
    class_name: row.class_name,
    enrolled: row.enrolled,
    average_score: round1(row.average_score),
    pass_rate: row.results ? round1((row.passed / row.results) * 100) : null,
    attendance_rate: row.marked ? round1((row.present / row.marked) * 100) : null,
  }));
}

const termLabel = (term) => `${term.term_name} (${term.year_label})`;
const statsFileName = (organizationName, term, extension) =>
  `${safeFileSegment(organizationName || "School", "School")}_Stats_${safeFileSegment(`${term.term_name} ${term.year_label}`.replace(/\s*-\s*/g, "-"), "Term")}.${extension}`;

const DISTRIBUTION_BANDS = [
  { label: "Below 50%", min: -Infinity, max: 50 },
  { label: "50–59%", min: 50, max: 60 },
  { label: "60–69%", min: 60, max: 70 },
  { label: "70–79%", min: 70, max: 80 },
  { label: "80% and above", min: 80, max: Infinity },
];

// Scores for one term: per class, per subject and per student.
async function loadAcademicStats(organizationId, term) {
  const params = [organizationId, term.term_id, PASS_MARK];
  const [classResult, subjectResult, studentResult] = await Promise.all([
    db.query(
      `WITH ${STUDENT_SUBJECT_SCORES_CTE}
       SELECT c.class_name, AVG(ss.pct) AS average_score,
              COUNT(*) FILTER (WHERE ss.pct >= $3)::int AS passed, COUNT(*)::int AS results
       FROM student_subject ss
       JOIN classes c ON c.class_id = ss.class_id
       GROUP BY c.class_id, c.class_name, c.dashboard_sort_order
       ORDER BY ${CLASS_ORDER_SQL}`,
      params
    ),
    db.query(
      `WITH ${STUDENT_SUBJECT_SCORES_CTE}
       SELECT MIN(TRIM(sub.subject_name)) AS subject_name,
              AVG(ss.pct) AS average_score,
              COUNT(*) FILTER (WHERE ss.pct >= $3)::int AS passed,
              COUNT(*)::int AS results
       FROM student_subject ss
       JOIN subjects sub ON sub.subject_id = ss.subject_id
       GROUP BY LOWER(TRIM(sub.subject_name))
       ORDER BY AVG(ss.pct) DESC`,
      params
    ),
    db.query(
      `WITH ${STUDENT_SUBJECT_SCORES_CTE}
       SELECT ss.student_id, s.first_name, s.last_name, c.class_name,
              AVG(ss.pct) AS average_score, COUNT(*)::int AS subjects
       FROM student_subject ss
       JOIN students s ON s.student_id = ss.student_id
       LEFT JOIN classes c ON c.class_id = ss.class_id
       GROUP BY ss.student_id, s.first_name, s.last_name, c.class_name
       ORDER BY AVG(ss.pct) DESC, s.last_name, s.first_name`,
      params.slice(0, 2)
    ),
  ]);

  const classRows = classResult.rows;
  const results = classRows.reduce((sum, row) => sum + row.results, 0);
  const passed = classRows.reduce((sum, row) => sum + row.passed, 0);
  const weightedTotal = classRows.reduce((sum, row) => sum + Number(row.average_score) * row.results, 0);

  const students = studentResult.rows.map((row) => ({
    name: [row.first_name, row.last_name].filter(Boolean).join(" ").trim(),
    class_name: row.class_name || "-",
    average_score: round1(row.average_score),
    subjects: row.subjects,
  }));
  const needsSupport = students
    .filter((student) => student.average_score !== null && student.average_score < PASS_MARK)
    .sort((a, b) => a.average_score - b.average_score);

  return {
    term: { term_id: term.term_id, label: termLabel(term) },
    averageScore: results ? round1(weightedTotal / results) : null,
    passRate: results ? round1((passed / results) * 100) : null,
    studentsWithScores: students.length,
    needsSupportCount: needsSupport.length,
    classes: classRows.map((row) => ({
      class_name: row.class_name,
      average_score: round1(row.average_score),
      pass_rate: row.results ? round1((row.passed / row.results) * 100) : null,
      results: row.results,
    })),
    subjects: subjectResult.rows.map((row) => ({
      subject_name: row.subject_name,
      average_score: round1(row.average_score),
      pass_rate: row.results ? round1((row.passed / row.results) * 100) : null,
      results: row.results,
    })),
    distribution: DISTRIBUTION_BANDS.map((band) => ({
      label: band.label,
      students: students.filter((s) => s.average_score !== null && s.average_score >= band.min && s.average_score < band.max).length,
    })),
    topStudents: students.slice(0, 10),
    needsSupport: needsSupport.slice(0, 10),
  };
}

// Everything the page shows for one term. When the term has no scores yet
// (for example a term that just started), the academic figures come from the
// most recent earlier term with results and are labelled as such.
async function buildOrganizationStats(organizationId, requestedTermId) {
  const terms = await loadTermsWithData(organizationId);
  const schoolYears = groupTermsBySchoolYear(terms);
  const currentTerm = pickTerm(terms, requestedTermId);
  if (!currentTerm) return { schoolYears, currentTerm: null, selectedSchoolYear: null, stats: null };

  const selectedSchoolYear = schoolYears.find((year) => year.school_year_id === currentTerm.school_year_id);
  const termIndex = terms.findIndex((term) => term.term_id === currentTerm.term_id);
  const previousTerm = termIndex > 0 ? terms[termIndex - 1] : null;
  const academicTerm = currentTerm.has_results
    ? currentTerm
    : terms.slice(0, termIndex).reverse().find((term) => term.has_results) || null;
  const termId = currentTerm.term_id;
  const params = [organizationId, termId];

  const [
    academic,
    enrollmentByTermResult,
    classResult,
    attendanceResult,
    genderResult,
    staffResult,
    scoreEntryResult,
    lowAttendanceResult,
    totalClassesResult,
  ] = await Promise.all([
    academicTerm ? loadAcademicStats(organizationId, academicTerm) : null,
    // Enrolled students per term.
    db.query(
      `SELECT e.term_id, COUNT(DISTINCT es.student_id)::int AS enrolled
       FROM enrollments e
       JOIN enrolled_students es ON es.enrollment_id = e.enrollment_id
       WHERE e.organization_id = $1
       GROUP BY e.term_id`,
      [organizationId]
    ),
    // Per class this term: enrolled and attendance.
    db.query(
      `WITH enrolled AS (
         SELECT es.class_id, COUNT(DISTINCT es.student_id)::int AS enrolled
         FROM enrollments e
         JOIN enrolled_students es ON es.enrollment_id = e.enrollment_id
         WHERE e.organization_id = $1 AND e.term_id = $2
         GROUP BY es.class_id
       ),
       attendance AS (
         SELECT class_id, COUNT(*) FILTER (WHERE status = 'Present')::int AS present, COUNT(*)::int AS marked
         FROM attendance_records
         WHERE organization_id = $1 AND term_id = $2
         GROUP BY class_id
       )
       SELECT c.class_id, c.class_name, COALESCE(en.enrolled, 0) AS enrolled, at.present, at.marked
       FROM classes c
       LEFT JOIN enrolled en ON en.class_id = c.class_id
       LEFT JOIN attendance at ON at.class_id = c.class_id
       WHERE c.organization_id = $1 AND (en.enrolled IS NOT NULL OR at.marked IS NOT NULL)
       ORDER BY ${CLASS_ORDER_SQL}`,
      params
    ),
    db.query(
      `SELECT COUNT(*) FILTER (WHERE status = 'Present')::int AS present, COUNT(*)::int AS marked
       FROM attendance_records WHERE organization_id = $1 AND term_id = $2`,
      params
    ),
    // Gender of students enrolled this term.
    db.query(
      `SELECT COALESCE(NULLIF(INITCAP(TRIM(s.gender)), ''), 'Not set') AS gender, COUNT(DISTINCT s.student_id)::int AS count
       FROM enrollments e
       JOIN enrolled_students es ON es.enrollment_id = e.enrollment_id
       JOIN students s ON s.student_id = es.student_id
       WHERE e.organization_id = $1 AND e.term_id = $2
       GROUP BY 1
       ORDER BY count DESC`,
      params
    ),
    // Active staff by role.
    db.query(
      `SELECT account_type::text AS role, COUNT(*)::int AS count
       FROM users
       WHERE organization_id = $1 AND COALESCE(on_hold, FALSE) = FALSE
       GROUP BY account_type
       ORDER BY count DESC`,
      [organizationId]
    ),
    // Score entry per class: scores entered vs. expected (enrolled students
    // x assessments set for their class this term).
    db.query(
      `WITH enrolled AS (
         SELECT DISTINCT es.class_id, es.student_id
         FROM enrollments e
         JOIN enrolled_students es ON es.enrollment_id = e.enrollment_id
         WHERE e.organization_id = $1 AND e.term_id = $2
       )
       SELECT c.class_name,
              COUNT(*)::int AS expected,
              COUNT(ar.result_id)::int AS entered
       FROM enrolled en
       JOIN assessments a ON a.class_id = en.class_id AND a.term_id = $2 AND a.organization_id = $1
       JOIN classes c ON c.class_id = en.class_id
       LEFT JOIN assessment_results ar
         ON ar.student_id = en.student_id AND ar.assessment_id = a.assessment_id AND ar.score IS NOT NULL
       GROUP BY c.class_id, c.class_name, c.dashboard_sort_order
       ORDER BY ${CLASS_ORDER_SQL}`,
      params
    ),
    // Students whose attendance rate this term is below the threshold.
    db.query(
      `SELECT COUNT(*)::int AS students
       FROM (
         SELECT student_id
         FROM attendance_records
         WHERE organization_id = $1 AND term_id = $2
         GROUP BY student_id
         HAVING COUNT(*) FILTER (WHERE status = 'Present') * 100.0 / NULLIF(COUNT(*), 0) < $3
       ) low`,
      [...params, LOW_ATTENDANCE_RATE]
    ),
    db.query(`SELECT COUNT(*)::int AS total FROM classes WHERE organization_id = $1`, [organizationId]),
  ]);

  const enrolledByTerm = new Map(enrollmentByTermResult.rows.map((row) => [row.term_id, row.enrolled]));
  const enrollmentTrend = terms.map((term) => ({
    label: termLabel(term),
    term_name: term.term_name,
    year_label: term.year_label,
    enrolled: enrolledByTerm.get(term.term_id) || 0,
  }));
  const enrolledNow = enrolledByTerm.get(termId) || 0;
  const enrolledBefore = previousTerm ? enrolledByTerm.get(previousTerm.term_id) || 0 : null;

  const classes = classResult.rows.map((row) => ({
    class_name: row.class_name,
    enrolled: row.enrolled,
    attendance_rate: row.marked ? round1((row.present / row.marked) * 100) : null,
  }));
  const scoreEntry = scoreEntryResult.rows.map((row) => ({
    class_name: row.class_name,
    entered: row.entered,
    expected: row.expected,
    rate: row.expected ? round1((row.entered / row.expected) * 100) : null,
  }));
  const scoresEntered = scoreEntry.reduce((sum, row) => sum + row.entered, 0);
  const scoresExpected = scoreEntry.reduce((sum, row) => sum + row.expected, 0);
  const attendance = attendanceResult.rows[0];
  const staff = staffResult.rows;

  const stats = {
    kpis: {
      enrolled: enrolledNow,
      enrolledChange: enrolledBefore === null ? null : enrolledNow - enrolledBefore,
      previousTermLabel: previousTerm ? termLabel(previousTerm) : null,
      attendanceRate: attendance.marked ? round1((attendance.present / attendance.marked) * 100) : null,
      scoreEntryRate: scoresExpected ? round1((scoresEntered / scoresExpected) * 100) : null,
      scoresEntered,
      scoresExpected,
      lowAttendance: lowAttendanceResult.rows[0].students,
      activeClasses: classes.filter((c) => c.enrolled > 0).length,
      totalClasses: totalClassesResult.rows[0].total,
      staff: staff.reduce((sum, row) => sum + row.count, 0),
      teachers: (staff.find((row) => row.role === "Teacher") || {}).count || 0,
    },
    academic: academic ? { ...academic, isFallback: academicTerm.term_id !== termId } : null,
    classes,
    scoreEntry,
    enrollmentTrend,
    gender: genderResult.rows,
    staff,
  };

  return { schoolYears, currentTerm, selectedSchoolYear, stats };
}

function csvCell(value) {
  const text = value === null || value === undefined ? "" : String(value);
  // Leading = + - @ would run as a formula in Excel.
  const safe = /^[=+\-@]/.test(text) ? `'${text}` : text;
  return /[",\r\n]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
}

function statsToCsv(term, stats) {
  const lines = [];
  const row = (...cells) => lines.push(cells.map(csvCell).join(","));
  const pct = (value) => (value === null || value === undefined ? "" : `${value}%`);
  const k = stats.kpis;
  const a = stats.academic;

  row("Organization statistics", termLabel(term));
  row("Generated", new Date().toISOString().slice(0, 10));
  row();
  row("Summary", "Value");
  row("Enrolled students", k.enrolled);
  if (k.enrolledChange !== null) row(`Change vs ${k.previousTermLabel}`, k.enrolledChange);
  row(`Average score${a && a.isFallback ? ` (${a.term.label})` : ""}`, pct(a && a.averageScore));
  row(`Pass rate at ${PASS_MARK}%${a && a.isFallback ? ` (${a.term.label})` : ""}`, pct(a && a.passRate));
  row("Attendance rate", pct(k.attendanceRate));
  row(`Students below ${LOW_ATTENDANCE_RATE}% attendance`, k.lowAttendance);
  row("Scores entered", `${k.scoresEntered} of ${k.scoresExpected}`);
  row("Score entry", pct(k.scoreEntryRate));
  row(`Students averaging below ${PASS_MARK}%`, a ? a.needsSupportCount : "");
  row("Active classes", `${k.activeClasses} of ${k.totalClasses}`);
  row("Staff", k.staff);
  row("Teachers", k.teachers);

  if (a) {
    row();
    row(`Class results${a.isFallback ? ` (${a.term.label})` : ""}`);
    row("Class", "Average score", "Pass rate", "Subject results");
    a.classes.forEach((c) => row(c.class_name, pct(c.average_score), pct(c.pass_rate), c.results));
    row();
    row(`Subject results${a.isFallback ? ` (${a.term.label})` : ""}`);
    row("Subject", "Average score", "Pass rate", "Results");
    a.subjects.forEach((s) => row(s.subject_name, pct(s.average_score), pct(s.pass_rate), s.results));
    row();
    row("Score distribution", "Students");
    a.distribution.forEach((b) => row(b.label, b.students));
    row();
    row("Top students", "Class", "Average");
    a.topStudents.forEach((s) => row(s.name, s.class_name, pct(s.average_score)));
    row();
    row(`Students averaging below ${PASS_MARK}%`, "Class", "Subjects", "Average");
    a.needsSupport.forEach((s) => row(s.name, s.class_name, s.subjects, pct(s.average_score)));
  }

  row();
  row("Class", "Enrolled", "Attendance rate", "Scores entered", "Scores expected", "Score entry");
  const entryByClass = new Map(stats.scoreEntry.map((e) => [e.class_name, e]));
  stats.classes.forEach((c) => {
    const e = entryByClass.get(c.class_name) || {};
    row(c.class_name, c.enrolled, pct(c.attendance_rate), e.entered ?? "", e.expected ?? "", pct(e.rate));
  });
  row();
  row("Term", "Enrolled students");
  stats.enrollmentTrend.forEach((t) => row(t.label, t.enrolled));
  row();
  row("Gender", "Students");
  stats.gender.forEach((g) => row(g.gender, g.count));
  row();
  row("Staff role", "Count");
  stats.staff.forEach((s) => row(s.role, s.count));
  return lines.join("\r\n");
}

module.exports = statsController;
// Shared with Mira (controllers/internalApiController.js) so its numbers
// match this page exactly.
module.exports.buildOrganizationStats = buildOrganizationStats;
module.exports.compareClasses = compareClasses;
module.exports.PASS_MARK = PASS_MARK;
module.exports.LOW_ATTENDANCE_RATE = LOW_ATTENDANCE_RATE;
