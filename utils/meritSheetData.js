// Merit sheet numbers, shared by the merit sheet page (printController) and
// Mira (internalApiController) so both always show the same totals, grades
// and positions.
const { buildStudentDisplayId, getOrganizationStudentIdSettings } = require("./studentIdDisplay");
const { formatDisplayName } = require("./organizationDisplayPreferences");

// Optional merit sheet columns staff can show or hide. S/N, student name and
// the assessment scores are always shown. The defaults are the original
// layout, so links and callers that do not choose columns are unchanged.
const MERIT_SHEET_COLUMN_KEYS = [
  "studentId",
  "gender",
  "grade",
  "subjectTotal",
  "total",
  "average",
  "percentage",
  "overallGrade",
  "position",
  "remark",
];
const DEFAULT_MERIT_SHEET_COLUMNS = ["studentId", "grade", "total", "average", "position"];

// Accepts an array or comma-separated list of column keys; undefined means
// "not chosen" and gives the defaults. Returns the enabled keys in order.
function parseMeritSheetColumns(input) {
  if (input === undefined || input === null) return [...DEFAULT_MERIT_SHEET_COLUMNS];
  const requested = new Set(
    (Array.isArray(input) ? input : String(input).split(","))
      .map((value) => String(value || "").trim())
      .filter(Boolean)
  );
  return MERIT_SHEET_COLUMN_KEYS.filter((key) => requested.has(key));
}

function meritSheetColumnFlags(columnKeys) {
  const enabled = new Set(columnKeys);
  return Object.fromEntries(MERIT_SHEET_COLUMN_KEYS.map((key) => [key, enabled.has(key)]));
}

// Picks the school's grade band for a percentage (Report Settings grading
// scale): the band containing it, else the nearest band, else the higher one.
function resolveScoreBand(bands, percentage) {
  if (!Number.isFinite(percentage) || !bands.length) return null;
  let best = null;
  let bestDistance = Infinity;
  bands.forEach((band) => {
    const from = Number(band.from_percentage);
    const to = Number(band.to_percentage);
    if (!Number.isFinite(from) || !Number.isFinite(to)) return;
    const distance = percentage >= from && percentage <= to ? 0 : percentage < from ? from - percentage : percentage - to;
    if (!best || distance < bestDistance || (distance === bestDistance && from > Number(best.from_percentage))) {
      best = band;
      bestDistance = distance;
    }
  });
  return best;
}

function getOrdinalSuffix(n) {
  const s = ["th", "st", "nd", "rd"];
  const v = n % 100;
  return s[(v - 20) % 10] || s[v] || s[0];
}

// Loads and computes a merit sheet for one class and term over the selected
// subjects and assessments. Returns null when the class or term does not
// belong to the organization.
async function buildMeritSheetData(db, { organizationId, classId, termId, subjectIds, assessmentIds, nameDisplayFormat }) {
  // Everything below depends only on the organization, class, term and
  // selection, so the reads run together.
  const [
    organizationResult,
    studentIdSettings,
    classDetailsResult,
    subjectsResult,
    assessmentsResult,
    studentsResult,
    scoresResult,
    scoreBandsResult,
  ] = await Promise.all([
    db.query(
      `
        SELECT organization_name, logo_path
        FROM organizations
        WHERE organization_id = $1
    `,
      [organizationId]
    ),
    getOrganizationStudentIdSettings(db, organizationId),
    db.query(
      `
        SELECT c.class_name, t.term_name, sy.year_label
        FROM classes c
        JOIN terms t ON t.term_id = $1 AND t.organization_id = $2
        JOIN school_years sy ON t.school_year_id = sy.id
        WHERE c.class_id = $3 AND c.organization_id = $2
    `,
      [termId, organizationId, classId]
    ),
    db.query(
      `SELECT subject_id, subject_name
       FROM subjects
       WHERE subject_id = ANY($1::int[]) AND class_id = $2 AND organization_id = $3
       ORDER BY subject_name ASC, subject_id ASC`,
      [subjectIds, classId, organizationId]
    ),
    db.query(
      `SELECT assessment_id, subject_id, title, weight, category, max_score
       FROM assessments
       WHERE assessment_id = ANY($1::int[]) AND class_id = $2 AND term_id = $3 AND organization_id = $4
       ORDER BY assessment_id ASC`,
      [assessmentIds, classId, termId, organizationId]
    ),
    db.query(`SELECT es.student_id, s.custom_student_id, s.first_name, s.last_name, s.gender
     FROM enrolled_students es
     JOIN students s ON es.student_id = s.student_id
     JOIN enrollments e ON es.enrollment_id = e.enrollment_id
     WHERE es.class_id = $1
       AND e.term_id = $2
       AND e.organization_id = $3`, [classId, termId, organizationId]),
    db.query(
      `
        SELECT
          ar.student_id,
          a.subject_id,
          a.title AS assessment_title,
          ar.score,
          COALESCE(
            (
              SELECT NULLIF(sr.grade_label, '')
              FROM score_remarks sr
              WHERE sr.organization_id = $3
                AND sr.class_id = $1
                AND sr.term_id = $2
              ORDER BY
                CASE
                  WHEN ar.total_percentage >= sr.from_percentage
                       AND ar.total_percentage <= sr.to_percentage THEN 0
                  ELSE 1
                END,
                CASE
                  WHEN ar.total_percentage > sr.to_percentage THEN ar.total_percentage - sr.to_percentage
                  WHEN ar.total_percentage < sr.from_percentage THEN sr.from_percentage - ar.total_percentage
                  ELSE 0
                END,
                sr.from_percentage DESC
              LIMIT 1
            ),
            CASE
              WHEN ar.total_percentage IS NULL THEN NULL
              WHEN ar.total_percentage >= 90 THEN 'A'
              WHEN ar.total_percentage >= 80 THEN 'B'
              WHEN ar.total_percentage >= 70 THEN 'C'
              ELSE 'D'
            END
          ) AS grade,
          a.weight
        FROM assessment_results ar
        JOIN assessments a ON ar.assessment_id = a.assessment_id
        WHERE ar.class_id = $1 AND ar.term_id = $2 AND ar.organization_id = $3
    `,
      [classId, termId, organizationId]
    ),
    // The class's grading scale for this term (Overall Grade and Remark).
    db.query(
      `SELECT from_percentage, to_percentage, NULLIF(TRIM(grade_label), '') AS grade_label, NULLIF(TRIM(remark), '') AS remark
     FROM score_remarks
     WHERE organization_id = $1 AND class_id = $2 AND term_id = $3`,
      [organizationId, classId, termId]
    ),
  ]);

  const organization = organizationResult.rows[0] || null;
  const classDetails = classDetailsResult.rows[0] || null;
  if (!organization || !classDetails) {
    return { organization, classDetails: null };
  }

  const assessmentsBySubject = new Map();
  assessmentsResult.rows.forEach((assessment) => {
    const key = Number(assessment.subject_id);
    if (!assessmentsBySubject.has(key)) assessmentsBySubject.set(key, []);
    assessmentsBySubject.get(key).push(assessment);
  });
  const selectedSubjectsData = subjectsResult.rows.map((subject) => ({
    ...subject,
    assessments: assessmentsBySubject.get(Number(subject.subject_id)) || [],
  }));

  const students = studentsResult.rows;
  const scoreBands = scoreBandsResult.rows;

  // Scores indexed by student, subject and assessment title.
  const scoreByKey = new Map();
  scoresResult.rows.forEach((score) => {
    const key = `${score.student_id}|${score.subject_id}|${score.assessment_title}`;
    if (!scoreByKey.has(key)) scoreByKey.set(key, score);
  });

  // Highest possible total across the selected assessments (for Percentage).
  const maxPossibleTotal = selectedSubjectsData.reduce(
    (sum, subject) =>
      sum + subject.assessments.reduce((subjectSum, assessment) => subjectSum + (Number(assessment.max_score) || 0), 0),
    0
  );

  // Process students and attach scores, grades, and positions
  const meritSheetData = students.map((student) => {
    const studentScores = selectedSubjectsData.map((subject) => {
      const subjectAssessments = subject.assessments.map((assessment) => {
        const scoreData = scoreByKey.get(`${student.student_id}|${subject.subject_id}|${assessment.title}`);

        return {
          title: assessment.title,
          score: scoreData ? scoreData.score : "-",
          grade: scoreData ? scoreData.grade : "-",
          weight: assessment.weight,
        };
      });

      const totalSubjectScore = subjectAssessments.reduce(
        (total, assessment) => {
          return (
            total +
            (assessment.score !== "-" ? parseFloat(assessment.score) : 0)
          );
        },
        0
      );

      return {
        subjectName: subject.subject_name,
        assessments: subjectAssessments,
        totalScore: totalSubjectScore,
      };
    });

    const totalScore = studentScores.reduce(
      (total, subject) => total + subject.totalScore,
      0
    );
    const averageScore = totalScore / studentScores.length;
    const percentageValue = maxPossibleTotal > 0 ? (totalScore / maxPossibleTotal) * 100 : null;
    const hasRecordedScore = studentScores.some((subject) =>
      subject.assessments.some((assessment) => assessment.score !== "-" && assessment.score !== null)
    );
    // No scores yet: no grade band, rather than the lowest band.
    const scoreBand = percentageValue === null || !hasRecordedScore ? null : resolveScoreBand(scoreBands, percentageValue);
    const genderText = String(student.gender || "").trim();

    return {
      studentId: buildStudentDisplayId(student, studentIdSettings),
      name:
        formatDisplayName(student, nameDisplayFormat) ||
        [student.first_name, student.last_name].filter(Boolean).join(" ").trim(),
      scores: studentScores,
      totalScore: totalScore.toFixed(2),
      averageScore: averageScore.toFixed(2),
      percentage: percentageValue === null ? "-" : `${percentageValue.toFixed(2)}%`,
      gender: genderText ? genderText.charAt(0).toUpperCase() + genderText.slice(1).toLowerCase() : "-",
      overallGrade: scoreBand?.grade_label || "-",
      remark: scoreBand?.remark || "-",
    };
  });

  // Sort students by total score and assign positions
  meritSheetData.sort((a, b) => b.totalScore - a.totalScore);
  const hasAnyRecordedScore = meritSheetData.some((student) =>
    Array.isArray(student.scores) &&
    student.scores.some((subject) =>
      Array.isArray(subject.assessments) &&
      subject.assessments.some((assessment) => assessment.score !== "-" && assessment.score !== null)
    )
  );

  // Standard competition ranking (1, 1, 3) so tied totals share a
  // position, matching the report card and score sheet.
  let previousRoundedTotal = null;
  let previousPosition = 0;
  meritSheetData.forEach((student, index) => {
    const roundedTotal = Math.round((Number(student.totalScore) || 0) * 100) / 100;
    const position = roundedTotal === previousRoundedTotal ? previousPosition : index + 1;
    previousRoundedTotal = roundedTotal;
    previousPosition = position;
    student.position = hasAnyRecordedScore
      ? `${position}${getOrdinalSuffix(position)}`
      : "-";
  });

  return {
    organization,
    classDetails,
    subjects: selectedSubjectsData,
    meritSheet: meritSheetData,
    hasAnyRecordedScore,
  };
}

module.exports = {
  MERIT_SHEET_COLUMN_KEYS,
  DEFAULT_MERIT_SHEET_COLUMNS,
  parseMeritSheetColumns,
  meritSheetColumnFlags,
  resolveScoreBand,
  buildMeritSheetData,
};
