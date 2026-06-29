const { getClassScheduleForTerm } = require("../utils/classScheduleService");
const { ensureStudentPortalSchema } = require("../utils/studentPortal");

let studentAssessmentLockSchemaReady = false;
let studentAssessmentAttemptIntegrityReady = false;
let assessmentQuestionSetRetakeSchemaReady = false;
let assessmentModeSchemaReady = false;

async function ensureAssessmentModeSchema(dbClient) {
  if (assessmentModeSchemaReady) return;
  await dbClient.query(`
    ALTER TABLE assessments
      ADD COLUMN IF NOT EXISTS open_book BOOLEAN DEFAULT FALSE,
      ADD COLUMN IF NOT EXISTS time_limit_minutes INTEGER
  `);
  assessmentModeSchemaReady = true;
}

async function ensureStudentAssessmentLockSchema(dbClient) {
  if (studentAssessmentLockSchemaReady) return;
  await dbClient.query(`
    CREATE TABLE IF NOT EXISTS student_assessment_lock_overrides (
      id SERIAL PRIMARY KEY,
      organization_id INTEGER NOT NULL REFERENCES organizations(organization_id) ON DELETE CASCADE,
      student_id INTEGER NOT NULL REFERENCES students(student_id) ON DELETE CASCADE,
      assessment_id INTEGER NOT NULL REFERENCES assessments(assessment_id) ON DELETE CASCADE,
      question_set_id INTEGER REFERENCES assessment_question_sets(question_set_id) ON DELETE SET NULL,
      is_locked BOOLEAN NOT NULL DEFAULT TRUE,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      UNIQUE (organization_id, student_id, assessment_id)
    )
  `);
  studentAssessmentLockSchemaReady = true;
}

async function ensureAssessmentQuestionSetRetakeSchema(dbClient) {
  if (assessmentQuestionSetRetakeSchemaReady) return;
  await dbClient.query(`
    ALTER TABLE assessment_question_sets
      ADD COLUMN IF NOT EXISTS retake_student_id INTEGER REFERENCES students(student_id) ON DELETE SET NULL
  `);
  assessmentQuestionSetRetakeSchemaReady = true;
}

async function ensureStudentAssessmentAttemptIntegrity(dbClient) {
  if (studentAssessmentAttemptIntegrityReady) return;

  await dbClient.query(`
    WITH ranked_attempts AS (
      SELECT
        attempt_id,
        ROW_NUMBER() OVER (
          PARTITION BY organization_id, student_id, assessment_id, status
          ORDER BY started_at DESC NULLS LAST, updated_at DESC NULLS LAST, attempt_id DESC
        ) AS row_rank
      FROM student_assessment_attempts
      WHERE LOWER(COALESCE(status, '')) = 'in_progress'
    )
    DELETE FROM student_assessment_attempts saa
    USING ranked_attempts ra
    WHERE saa.attempt_id = ra.attempt_id
      AND ra.row_rank > 1
  `);

  await dbClient.query(`
    CREATE UNIQUE INDEX IF NOT EXISTS idx_student_attempts_one_in_progress
      ON student_assessment_attempts (organization_id, student_id, assessment_id)
      WHERE LOWER(COALESCE(status, '')) = 'in_progress'
  `);

  studentAssessmentAttemptIntegrityReady = true;
}

let scoreRemarkGradeSchemaReady = false;

async function ensureScoreRemarkGradeSchema(dbClient) {
  if (scoreRemarkGradeSchemaReady) return;
  await dbClient.query(
    "ALTER TABLE score_remarks ADD COLUMN IF NOT EXISTS grade_label TEXT"
  );
  scoreRemarkGradeSchemaReady = true;
}

function getDefaultGradeLabel(percentage) {
  const value = Number(percentage);
  if (!Number.isFinite(value)) return "-";
  if (value >= 90) return "A";
  if (value >= 80) return "B";
  if (value >= 70) return "C";
  return "D";
}

async function getGradeLabelFromScoreRemark(
  dbClient,
  organizationId,
  classId,
  termId,
  percentage
) {
  if (percentage === null || percentage === undefined || Number.isNaN(percentage)) {
    return "-";
  }

  await ensureScoreRemarkGradeSchema(dbClient);

  const remarkResult = await dbClient.query(
    `SELECT grade_label
     FROM score_remarks
     WHERE organization_id = $1
       AND class_id = $2
       AND term_id = $3
       AND NULLIF(TRIM(grade_label), '') IS NOT NULL
     ORDER BY
       CASE
         WHEN $4::numeric BETWEEN from_percentage AND to_percentage THEN 0
         WHEN $4::numeric < from_percentage THEN from_percentage - $4::numeric
         ELSE $4::numeric - to_percentage
       END ASC,
       from_percentage DESC
     LIMIT 1`,
    [organizationId, classId, termId, percentage]
  );

  const configuredLabel = String(remarkResult.rows[0]?.grade_label || "").trim();
  return configuredLabel || getDefaultGradeLabel(percentage);
}

function normalizeAnswerValue(value) {
  return String(value || "")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

function toAnswerSet(value) {
  const normalized = String(value || "")
    .split(",")
    .map((part) => normalizeAnswerValue(part))
    .filter(Boolean)
    .sort();
  return normalized;
}

function evaluateResponse(question, rawResponse) {
  const questionType = String(question.question_type || "short_text").toLowerCase();
  const marks = Number(question.marks || 0);

  if (["essay", "matching"].includes(questionType)) {
    return { isCorrect: null, awardedMarks: 0, normalizedResponse: rawResponse };
  }

  const answerKey = String(question.answer_key || "");
  const responseText = Array.isArray(rawResponse) ? rawResponse.join(",") : String(rawResponse || "");

  if (questionType === "multiple_choice") {
    const expected = toAnswerSet(answerKey);
    const received = toAnswerSet(responseText);
    const correct = expected.length > 0 && expected.join("|") === received.join("|");
    return {
      isCorrect: correct,
      awardedMarks: correct ? marks : 0,
      normalizedResponse: received.join(","),
    };
  }

  const correct = normalizeAnswerValue(answerKey) === normalizeAnswerValue(responseText);
  return {
    isCorrect: correct,
    awardedMarks: correct ? marks : 0,
    normalizedResponse: normalizeAnswerValue(responseText),
  };
}

async function resolveStudentContext(db, organizationId, studentId) {
  const studentResult = await db.query(
    `SELECT s.student_id, s.first_name, s.last_name, s.email, s.image_url,
            s.class_id, c.class_name
       FROM students s
       LEFT JOIN classes c ON c.class_id = s.class_id
      WHERE s.organization_id = $1 AND s.student_id = $2
      LIMIT 1`,
    [organizationId, studentId]
  );

  return studentResult.rows[0] || null;
}

async function resolveCurrentStudentTermContext(db, organizationId, studentId) {
  const currentTermResult = await db.query(
    `SELECT t.term_id, t.term_name, t.current, t.school_year_id, sy.year_label,
            t.start_date, t.end_date
       FROM terms t
       JOIN school_years sy ON sy.id = t.school_year_id
      WHERE t.organization_id = $1 AND t.current = TRUE
      ORDER BY t.start_date DESC, t.term_id DESC
      LIMIT 1`,
    [organizationId]
  );

  const selectedTerm = currentTermResult.rows[0] || null;
  if (!selectedTerm) {
    return { selectedTerm: null, enrolledClassId: null, enrolledClassName: null };
  }

  const enrollmentResult = await db.query(
    `SELECT c.class_id, c.class_name
       FROM enrollments e
       JOIN enrolled_students es ON es.enrollment_id = e.enrollment_id
       JOIN classes c ON c.class_id = es.class_id
      WHERE e.organization_id = $1
        AND e.term_id = $2
        AND es.student_id = $3
      ORDER BY e.created_at DESC
      LIMIT 1`,
    [organizationId, selectedTerm.term_id, studentId]
  );

  return {
    selectedTerm,
    enrolledClassId: enrollmentResult.rows[0]?.class_id || null,
    enrolledClassName: enrollmentResult.rows[0]?.class_name || null,
  };
}

function buildScheduleTableModel(classSchedule) {
  const groupedByDay = Array.isArray(classSchedule?.groupedByDay) ? classSchedule.groupedByDay : [];
  const periodMap = new Map();

  groupedByDay.forEach((day) => {
    (Array.isArray(day.items) ? day.items : []).forEach((item) => {
      const periodKey = `${item.startTime || ""}-${item.endTime || ""}`;
      if (!periodMap.has(periodKey)) {
        periodMap.set(periodKey, {
          key: periodKey,
          startTime: item.startTime || "",
          endTime: item.endTime || "",
        });
      }
    });
  });

  const periods = Array.from(periodMap.values()).sort((a, b) => {
    return String(a.startTime || "").localeCompare(String(b.startTime || ""));
  });

  const rows = groupedByDay.map((day) => {
    const byPeriod = new Map();
    (Array.isArray(day.items) ? day.items : []).forEach((item) => {
      const key = `${item.startTime || ""}-${item.endTime || ""}`;
      byPeriod.set(key, item.customLabel || item.subjectName || "-");
    });

    return {
      dayLabel: day.dayLabel,
      cells: periods.map((period) => byPeriod.get(period.key) || "-"),
    };
  });

  return { periods, rows };
}

function buildAssessmentHeaderKey(assessment) {
  const title = String(assessment?.title || assessment?.assessment_title || "")
    .trim()
    .toLowerCase();
  const weight = Number(assessment?.weight || 0);
  const category = String(assessment?.category || "Assessment")
    .trim()
    .toLowerCase();
  const maxScore = Number(assessment?.max_score || 0);
  return `${title}|${weight}|${category}|${maxScore}`;
}

async function getOpenAssessments(db, organizationId, studentId, classId, termId) {
  if (!classId || !termId) return [];

  await ensureAssessmentModeSchema(db);
  await ensureStudentAssessmentLockSchema(db);
  await ensureAssessmentQuestionSetRetakeSchema(db);

  const assessmentsResult = await db.query(
      `SELECT a.assessment_id, a.title, a.max_score, a.category,
        COALESCE(a.open_book, FALSE) AS open_book,
        COALESCE(salo.is_locked, FALSE) AS is_locked,
        a.time_limit_minutes,
        a.edit_window_end,
        s.subject_name,
            qs.question_count,
            qs.updated_at AS latest_question_update
       FROM assessments a
       JOIN subjects s
         ON s.subject_id = a.subject_id
        AND s.organization_id = a.organization_id
       JOIN LATERAL (
         SELECT
           qs.question_set_id,
           qs.updated_at,
           COUNT(q.question_id)::int AS question_count
         FROM assessment_question_sets qs
         LEFT JOIN assessment_questions q
           ON q.question_set_id = qs.question_set_id
         WHERE qs.organization_id = a.organization_id
           AND qs.assessment_id = a.assessment_id
           AND LOWER(COALESCE(qs.review_status, 'pending')) = 'approved'
           AND qs.retake_student_id IS NULL
         GROUP BY qs.question_set_id, qs.updated_at
         ORDER BY qs.updated_at DESC, qs.question_set_id DESC
         LIMIT 1
       ) qs ON TRUE
       LEFT JOIN student_assessment_lock_overrides salo
         ON salo.organization_id = a.organization_id
        AND salo.student_id = $4
        AND salo.assessment_id = a.assessment_id
      WHERE a.organization_id = $1
        AND a.class_id = $2
        AND a.term_id = $3
        AND COALESCE(a.is_active, TRUE) = TRUE
        AND (a.edit_window_start IS NULL OR a.edit_window_start <= NOW())
        AND (a.edit_window_end IS NULL OR a.edit_window_end >= NOW())
        AND EXISTS (
          SELECT 1
            FROM student_subjects ss
           WHERE ss.organization_id = $1
             AND ss.student_id = $4
             AND ss.subject_id = a.subject_id
        )
        AND (
          (COALESCE(salo.is_locked, FALSE) = FALSE AND salo.id IS NOT NULL)
          OR NOT EXISTS (
            SELECT 1
              FROM student_assessment_attempts saa
             WHERE saa.organization_id = $1
               AND saa.student_id = $4
               AND saa.assessment_id = a.assessment_id
               AND saa.status = 'submitted'
          )
        )
      GROUP BY a.assessment_id, a.title, a.max_score, a.category, a.open_book, salo.is_locked, a.time_limit_minutes, a.edit_window_end, s.subject_name, qs.question_count, qs.updated_at
      ORDER BY s.subject_name ASC, a.title ASC`,
    [organizationId, classId, termId, studentId]
  );

  return assessmentsResult.rows;
}

async function getCompletedAssessments(db, organizationId, studentId, classId, termId) {
  if (!classId || !termId) return [];

  await ensureAssessmentModeSchema(db);
  await ensureStudentAssessmentLockSchema(db);
  await ensureAssessmentQuestionSetRetakeSchema(db);

  const completedResult = await db.query(
    `WITH latest_submitted AS (
       SELECT DISTINCT ON (saa.assessment_id)
              saa.attempt_id,
              saa.assessment_id,
              saa.organization_id,
              saa.student_id,
              saa.question_set_id,
              saa.score,
              saa.max_score,
              saa.submitted_at
         FROM student_assessment_attempts saa
        WHERE saa.organization_id = $1
          AND saa.student_id = $2
          AND saa.status = 'submitted'
        ORDER BY saa.assessment_id ASC,
                 saa.submitted_at DESC NULLS LAST,
                 saa.updated_at DESC NULLS LAST,
                 saa.attempt_id DESC
     )
         SELECT a.assessment_id, a.title, a.max_score, a.category,
           COALESCE(a.open_book, FALSE) AS open_book,
           a.time_limit_minutes,
           s.subject_name,
            ls.score, ls.max_score AS attempt_max_score, ls.submitted_at,
            COUNT(q.question_id)::int AS question_count
       FROM latest_submitted ls
       JOIN assessments a
         ON a.assessment_id = ls.assessment_id
        AND a.organization_id = ls.organization_id
       JOIN subjects s
         ON s.subject_id = a.subject_id
        AND s.organization_id = a.organization_id
       LEFT JOIN student_assessment_lock_overrides salo
         ON salo.organization_id = ls.organization_id
        AND salo.student_id = ls.student_id
        AND salo.assessment_id = ls.assessment_id
       LEFT JOIN assessment_questions q ON q.question_set_id = ls.question_set_id
      WHERE a.class_id = $3
        AND a.term_id = $4
        AND COALESCE(salo.is_locked, TRUE) = TRUE
      GROUP BY a.assessment_id, a.title, a.max_score, a.category, a.open_book, a.time_limit_minutes, s.subject_name,
               ls.score, ls.max_score, ls.submitted_at
      ORDER BY ls.submitted_at DESC NULLS LAST, a.title ASC`,
    [organizationId, studentId, classId, termId]
  );

  return completedResult.rows;
}

module.exports = {
  dashboardGet: async (req, res, db) => {
    const organizationId = req.session.organizationId;
    const studentId = req.session.studentId;

    try {
      await ensureStudentPortalSchema(db);
      await ensureAssessmentModeSchema(db);
      await ensureStudentAssessmentLockSchema(db);
      await ensureStudentAssessmentAttemptIntegrity(db);

      const student = await resolveStudentContext(db, organizationId, studentId);
      if (!student) {
        req.flash("error", "Student profile not found.");
        return res.redirect("/account/student-login");
      }

      const { selectedTerm, enrolledClassId, enrolledClassName } = await resolveCurrentStudentTermContext(
        db,
        organizationId,
        studentId
      );
      if (!selectedTerm) {
        req.flash("error", "No school term is currently available.");
        return res.render("student/dashboard", {
          title: "Student Portal",
          student,
          selectedTerm: null,
          enrolledClassName: null,
          mainTeacher: null,
          subjectTeachers: [],
          subjects: [],
          assessmentGrades: [],
          gradeAssessmentHeaders: [],
          attendanceSummary: { totalDays: 0, present: 0, absent: 0, late: 0, attendanceRate: 0 },
          classSchedule: null,
          scheduleTable: { periods: [], rows: [] },
          openAssessmentsCount: 0,
          messages: req.flash(),
        });
      }

      req.session.currentTermId = selectedTerm.term_id;

      const effectiveClassId = enrolledClassId || student.class_id;
      const [mainTeacherResult, subjectTeachersResult, subjectsResult, gradeAssessmentHeadersResult, assessmentGradesResult, assessmentPositionsResult, attendanceResult, classSchedule, openAssessments] = await Promise.all([
        effectiveClassId
          ? db.query(
              `SELECT u.first_name, u.last_name, u.email
                 FROM user_classes uc
                 JOIN users u ON u.user_id = uc.user_id
                WHERE uc.class_id = $1 AND uc.main = TRUE
                LIMIT 1`,
              [effectiveClassId]
            )
          : { rows: [] },
        effectiveClassId
          ? db.query(
              `SELECT u.user_id,
                      u.first_name,
                      u.last_name,
                      u.email,
                      ARRAY_AGG(DISTINCT subj.subject_name ORDER BY subj.subject_name) AS subject_names
                 FROM student_subjects ss
                 JOIN subjects subj ON subj.subject_id = ss.subject_id AND subj.organization_id = ss.organization_id
                   AND subj.class_id = $3
                 JOIN user_subjects us ON us.subject_id = subj.subject_id
                 JOIN user_classes uc ON uc.user_id = us.user_id AND uc.class_id = $3
                 JOIN users u ON u.user_id = us.user_id AND u.organization_id = ss.organization_id
                WHERE ss.organization_id = $1 AND ss.student_id = $2
                  AND LOWER(COALESCE(u.account_type::text, '')) = 'teacher'
                GROUP BY u.user_id, u.first_name, u.last_name, u.email
                ORDER BY u.last_name ASC, u.first_name ASC, u.user_id ASC`,
              [organizationId, studentId, effectiveClassId]
            )
          : { rows: [] },
        db.query(
          `SELECT subj.subject_id, subj.subject_name,
                  COALESCE(SUM(ar.score), 0) AS total_score,
                  COALESCE(SUM(a.max_score), 0) AS total_max_score,
                  MAX(ar.total_percentage) AS total_percentage,
                  MAX(ar.grade) AS grade
             FROM student_subjects ss
             JOIN subjects subj ON subj.subject_id = ss.subject_id AND subj.organization_id = ss.organization_id
             LEFT JOIN assessments a
               ON a.subject_id = subj.subject_id
              AND a.organization_id = ss.organization_id
              AND a.term_id = $3
             LEFT JOIN assessment_results ar
               ON ar.assessment_id = a.assessment_id
              AND ar.student_id = ss.student_id
            WHERE ss.organization_id = $1
              AND ss.student_id = $2
              AND subj.class_id = $4
            GROUP BY subj.subject_id, subj.subject_name
            ORDER BY subj.subject_name ASC`,
          [organizationId, studentId, selectedTerm.term_id, effectiveClassId]
        ),
        effectiveClassId
          ? db.query(
              `SELECT DISTINCT ON (a.assessment_id)
                      a.assessment_id,
                      a.title,
                      a.weight,
                      a.category,
                      a.max_score
                 FROM assessments a
                 JOIN terms t ON t.term_id = a.term_id AND t.organization_id = a.organization_id
                WHERE a.organization_id = $1
                  AND a.class_id = $2
                  AND a.term_id = $3
                  AND t.school_year_id = $4
                ORDER BY a.assessment_id`,
              [organizationId, effectiveClassId, selectedTerm.term_id, selectedTerm.school_year_id]
            )
          : { rows: [] },
        effectiveClassId
          ? db.query(
              `SELECT subj.subject_id,
                      subj.subject_name,
                      a.assessment_id,
                      a.title AS assessment_title,
                      a.weight,
                      a.category,
                      a.max_score,
                      COALESCE(a.scale_base, 100) AS scale_base,
                      ar.score
                 FROM student_subjects ss
                 JOIN subjects subj
                   ON subj.subject_id = ss.subject_id
                  AND subj.organization_id = ss.organization_id
                 LEFT JOIN assessments a
                   ON a.subject_id = subj.subject_id
                  AND a.organization_id = ss.organization_id
                  AND a.term_id = $3
                  AND a.class_id = $4
                 LEFT JOIN terms t
                   ON t.term_id = a.term_id
                  AND t.organization_id = a.organization_id
                 LEFT JOIN assessment_results ar
                   ON ar.assessment_id = a.assessment_id
                  AND ar.organization_id = ss.organization_id
                  AND ar.student_id = $2
                  AND ar.term_id = $3
                  AND ar.class_id = $4
                WHERE ss.organization_id = $1
                  AND ss.student_id = $2
                  AND subj.class_id = $4
                  AND (a.assessment_id IS NULL OR t.school_year_id = $5)
                ORDER BY subj.subject_name ASC, a.assessment_id ASC`,
              [organizationId, studentId, selectedTerm.term_id, effectiveClassId, selectedTerm.school_year_id]
            )
          : { rows: [] },
        effectiveClassId
          ? db.query(
              `SELECT subject_id, position
                 FROM student_positions
                WHERE student_id = $1
                  AND organization_id = $2
                  AND class_id = $3
                  AND term_id = $4`,
              [studentId, organizationId, effectiveClassId, selectedTerm.term_id]
            )
          : { rows: [] },
        db.query(
          `SELECT status
             FROM attendance_records
            WHERE organization_id = $1 AND student_id = $2 AND term_id = $3`,
          [organizationId, studentId, selectedTerm.term_id]
        ),
        effectiveClassId
          ? getClassScheduleForTerm(db, {
              organizationId,
              classId: effectiveClassId,
              termId: selectedTerm.term_id,
            })
          : null,
        getOpenAssessments(db, organizationId, studentId, effectiveClassId, selectedTerm.term_id),
      ]);

      const attendanceRows = attendanceResult.rows || [];
      const attendanceSummary = {
        totalDays: attendanceRows.length,
        present: attendanceRows.filter((item) => String(item.status || "").toLowerCase() === "present").length,
        absent: attendanceRows.filter((item) => String(item.status || "").toLowerCase() === "absent").length,
        late: attendanceRows.filter((item) => String(item.status || "").toLowerCase() === "late").length,
        attendanceRate: 0,
      };

      if (attendanceSummary.totalDays > 0) {
        attendanceSummary.attendanceRate = Number(((attendanceSummary.present / attendanceSummary.totalDays) * 100).toFixed(1));
      }

      const scheduleTable = buildScheduleTableModel(classSchedule);

      const positionBySubject = {};
      (assessmentPositionsResult.rows || []).forEach((row) => {
        positionBySubject[row.subject_id] = row.position;
      });

      const subjectGradeMap = new Map();
      const gradeAssessmentHeaderMap = new Map();
      (gradeAssessmentHeadersResult.rows || []).forEach((assessment) => {
        const headerKey = buildAssessmentHeaderKey(assessment);
        if (!headerKey || headerKey.startsWith("|")) return;
        if (gradeAssessmentHeaderMap.has(headerKey)) return;

        gradeAssessmentHeaderMap.set(headerKey, {
          assessment_key: headerKey,
          title: assessment.title || "Assessment",
          weight: Number(assessment.weight || 0),
          category: assessment.category || "Assessment",
          max_score: Number(assessment.max_score || 0),
        });
      });

      (assessmentGradesResult.rows || []).forEach((row) => {
        if (!subjectGradeMap.has(row.subject_id)) {
          subjectGradeMap.set(row.subject_id, {
            subject_id: row.subject_id,
            subject_name: row.subject_name,
            total_subject_score: null,
            total_max_score: 0,
            total_percentage: null,
            scaled_score: null,
            grade: "-",
            scale_base: Number(row.scale_base || 100),
            position: positionBySubject[row.subject_id] || "-",
            has_entered_score: false,
            assessment_scores: {},
          });
        }

        const summary = subjectGradeMap.get(row.subject_id);
        if (Number.isFinite(Number(row.scale_base))) {
          summary.scale_base = Number(row.scale_base);
        }

        const headerKey = row.assessment_id ? buildAssessmentHeaderKey(row) : null;

        if (row.assessment_id && row.score !== null && row.score !== undefined) {
          if (!headerKey || !gradeAssessmentHeaderMap.has(headerKey)) {
            return;
          }
          const numericScore = Number(row.score);
          const numericMaxScore = Number(row.max_score);
          if (Number.isFinite(numericScore)) {
            summary.total_subject_score = (summary.total_subject_score || 0) + numericScore;
            summary.has_entered_score = true;
            summary.assessment_scores[headerKey] = numericScore;
          }
          if (Number.isFinite(numericMaxScore)) {
            summary.total_max_score += numericMaxScore;
          }
        } else if (row.assessment_id) {
          if (!headerKey || !gradeAssessmentHeaderMap.has(headerKey)) {
            return;
          }
          summary.assessment_scores[headerKey] = null;
        }
      });

      const gradeAssessmentHeaders = Array.from(gradeAssessmentHeaderMap.values()).sort((a, b) => {
        return String(a.title || "").localeCompare(String(b.title || ""), undefined, {
          sensitivity: "base",
        });
      });

      const assessmentGrades = await Promise.all(
        Array.from(subjectGradeMap.values()).map(async (summary) => {
          if (!summary.has_entered_score || summary.total_max_score <= 0) {
            return summary;
          }

          const percentage = (Number(summary.total_subject_score) / Number(summary.total_max_score)) * 100;
          const scaledScore = (percentage / 100) * Number(summary.scale_base || 100);
          const grade = await getGradeLabelFromScoreRemark(
            db,
            organizationId,
            effectiveClassId,
            selectedTerm.term_id,
            percentage
          );

          return {
            ...summary,
            total_percentage: percentage,
            scaled_score: scaledScore,
            grade,
          };
        })
      );

      res.render("student/dashboard", {
        title: "Student Portal",
        student,
        selectedTerm,
        enrolledClassName,
        mainTeacher: mainTeacherResult.rows[0] || null,
        subjectTeachers: subjectTeachersResult.rows || [],
        subjects: subjectsResult.rows || [],
        assessmentGrades,
        gradeAssessmentHeaders,
        attendanceSummary,
        classSchedule,
        scheduleTable,
        openAssessmentsCount: openAssessments.length,
        messages: req.flash(),
      });
    } catch (error) {
      console.error("[StudentDashboard]", error.message || error);
      req.flash("error", "Could not load student dashboard.");
      return res.redirect("/account/student-login");
    }
  },

  testingRoomGet: async (req, res, db) => {
    const organizationId = req.session.organizationId;
    const studentId = req.session.studentId;

    try {
      await ensureStudentPortalSchema(db);
      await ensureAssessmentModeSchema(db);
      await ensureStudentAssessmentLockSchema(db);
      await ensureAssessmentQuestionSetRetakeSchema(db);

      const student = await resolveStudentContext(db, organizationId, studentId);
      if (!student) {
        req.flash("error", "Student profile not found.");
        return res.redirect("/account/student-login");
      }

      const { selectedTerm, enrolledClassId } = await resolveCurrentStudentTermContext(db, organizationId, studentId);
      if (!selectedTerm) {
        req.flash("error", "No term found for testing room.");
        return res.redirect("/student/dashboard");
      }

      req.session.currentTermId = selectedTerm.term_id;
      const effectiveClassId = enrolledClassId || student.class_id;
      const [openAssessments, completedAssessments] = await Promise.all([
        getOpenAssessments(db, organizationId, studentId, effectiveClassId, selectedTerm.term_id),
        getCompletedAssessments(db, organizationId, studentId, effectiveClassId, selectedTerm.term_id),
      ]);

      res.render("student/testingRoom", {
        title: "Testing Room",
        student,
        terms: [selectedTerm],
        selectedTerm,
        openAssessments,
        completedAssessments,
        messages: req.flash(),
      });
    } catch (error) {
      console.error("[TestingRoom]", error.message || error);
      req.flash("error", "Could not load testing room.");
      return res.redirect("/student/dashboard");
    }
  },

  takeAssessmentGet: async (req, res, db) => {
    const organizationId = req.session.organizationId;
    const studentId = req.session.studentId;
    const assessmentId = Number(req.params.assessmentId);

    if (!Number.isInteger(assessmentId) || assessmentId <= 0) {
      req.flash("error", "Invalid assessment.");
      return res.redirect("/student/testing-room");
    }

    try {
      await ensureStudentPortalSchema(db);
      await ensureStudentAssessmentLockSchema(db);
      await ensureAssessmentQuestionSetRetakeSchema(db);

      const student = await resolveStudentContext(db, organizationId, studentId);
      if (!student) {
        req.flash("error", "Student profile not found.");
        return res.redirect("/account/student-login");
      }

      const { selectedTerm, enrolledClassId } = await resolveCurrentStudentTermContext(db, organizationId, studentId);
      const effectiveClassId = enrolledClassId || student.class_id;
      if (!selectedTerm || !effectiveClassId) {
        req.flash("error", "Your current class or term could not be resolved.");
        return res.redirect("/student/testing-room");
      }

      const assessmentResult = await db.query(
        `SELECT a.assessment_id, a.title, a.max_score, a.category, a.term_id, a.class_id, a.subject_id,
          COALESCE(a.open_book, FALSE) AS open_book,
          a.time_limit_minutes,
                s.subject_name
           FROM assessments a
           JOIN subjects s ON s.subject_id = a.subject_id AND s.organization_id = a.organization_id
          WHERE a.organization_id = $1
            AND a.assessment_id = $2
            AND a.class_id = $3
            AND a.term_id = $5
            AND COALESCE(a.is_active, TRUE) = TRUE
            AND (a.edit_window_start IS NULL OR a.edit_window_start <= NOW())
            AND (a.edit_window_end IS NULL OR a.edit_window_end >= NOW())
            AND EXISTS (
              SELECT 1 FROM student_subjects ss
               WHERE ss.organization_id = $1
                 AND ss.student_id = $4
                 AND ss.subject_id = a.subject_id
            )
          LIMIT 1`,
        [organizationId, assessmentId, effectiveClassId, studentId, selectedTerm.term_id]
      );

      if (!assessmentResult.rows.length) {
        req.flash("error", "This assessment is not open for you.");
        return res.redirect("/student/testing-room");
      }

      const assessment = assessmentResult.rows[0];

      const lockOverrideResult = await db.query(
        `SELECT question_set_id, is_locked
           FROM student_assessment_lock_overrides
          WHERE organization_id = $1
            AND student_id = $2
            AND assessment_id = $3
          LIMIT 1`,
        [organizationId, studentId, assessmentId]
      );

      const explicitUnlock = lockOverrideResult.rows.length && !Boolean(lockOverrideResult.rows[0].is_locked);

      const submittedAttemptResult = await db.query(
        `SELECT attempt_id FROM student_assessment_attempts
          WHERE organization_id = $1 AND student_id = $2 AND assessment_id = $3 AND status = 'submitted'
          LIMIT 1`,
        [organizationId, studentId, assessmentId]
      );
      if (submittedAttemptResult.rows.length && !explicitUnlock) {
        req.flash("success", "Assessment completed. This test is now locked and cannot be accessed again.");
        return res.redirect("/student/testing-room");
      }

      if (lockOverrideResult.rows.length && Boolean(lockOverrideResult.rows[0].is_locked)) {
        req.flash("error", "This assessment is currently locked for you.");
        return res.redirect("/student/testing-room");
      }

      const questionSetResult = await db.query(
        `SELECT question_set_id, set_title, set_description
           FROM assessment_question_sets
          WHERE organization_id = $1
            AND assessment_id = $2
            AND (
              $3::int IS NULL
              OR question_set_id = $3
            )
            AND (
              $3::int IS NOT NULL
              OR retake_student_id IS NULL
            )
            AND LOWER(COALESCE(review_status, 'pending')) = 'approved'
          ORDER BY updated_at DESC, question_set_id DESC
          LIMIT 1`,
        [
          organizationId,
          assessmentId,
          lockOverrideResult.rows.length && lockOverrideResult.rows[0].question_set_id
            ? Number(lockOverrideResult.rows[0].question_set_id)
            : null,
        ]
      );

      if (!questionSetResult.rows.length) {
        req.flash("error", "Questions for this assessment are not available yet.");
        return res.redirect("/student/testing-room");
      }

      const questionSet = questionSetResult.rows[0];

      const questionsResult = await db.query(
        `SELECT question_id, question_type, question_text, options_json, marks, position_index
           FROM assessment_questions
          WHERE question_set_id = $1
          ORDER BY position_index ASC, question_id ASC`,
        [questionSet.question_set_id]
      );

      if (!questionsResult.rows.length) {
        req.flash("error", "This assessment has no questions yet.");
        return res.redirect("/student/testing-room");
      }

      let attemptResult = await db.query(
        `SELECT attempt_id, question_set_id, started_at
           FROM student_assessment_attempts
          WHERE organization_id = $1
            AND student_id = $2
            AND assessment_id = $3
            AND status = 'in_progress'
          ORDER BY started_at DESC
          LIMIT 1`,
        [organizationId, studentId, assessmentId]
      );

      let attemptId = attemptResult.rows[0]?.attempt_id || null;
      if (!attemptId) {
        try {
          const createdAttempt = await db.query(
            `INSERT INTO student_assessment_attempts (
               organization_id, student_id, assessment_id, question_set_id, term_id, class_id, status, started_at, created_at, updated_at
             ) VALUES ($1, $2, $3, $4, $5, $6, 'in_progress', NOW(), NOW(), NOW())
             RETURNING attempt_id`,
            [organizationId, studentId, assessmentId, questionSet.question_set_id, assessment.term_id, assessment.class_id]
          );
          attemptId = createdAttempt.rows[0].attempt_id;
        } catch (error) {
          if (error && error.code === '23505') {
            const existingAttemptResult = await db.query(
              `SELECT attempt_id, started_at
                 FROM student_assessment_attempts
                WHERE organization_id = $1
                  AND student_id = $2
                  AND assessment_id = $3
                  AND status = 'in_progress'
                ORDER BY started_at DESC NULLS LAST, updated_at DESC NULLS LAST, attempt_id DESC
                LIMIT 1`,
              [organizationId, studentId, assessmentId]
            );
            attemptId = existingAttemptResult.rows[0]?.attempt_id || null;
            attemptResult = existingAttemptResult;
          } else {
            throw error;
          }
        }

        if (!attemptId) {
          throw new Error('Could not create or recover assessment attempt.');
        }
      }

      const responsesResult = await db.query(
        `SELECT question_id, response_text, response_json
           FROM student_assessment_responses
          WHERE attempt_id = $1`,
        [attemptId]
      );

      const responsesByQuestionId = responsesResult.rows.reduce((acc, row) => {
        const key = String(row.question_id);
        if (row.response_json && Array.isArray(row.response_json.values)) {
          acc[key] = row.response_json.values;
        } else {
          acc[key] = row.response_text || "";
        }
        return acc;
      }, {});

      res.render("student/takeAssessment", {
        title: "Take Assessment",
        student,
        assessment,
        questionSet,
        questions: questionsResult.rows,
        attemptId,
        attemptStartedAt: attemptResult.rows[0]?.started_at || null,
        responsesByQuestionId,
        messages: req.flash(),
        hideGlobalFooter: true,
        hideGlobalChatbot: true,
      });
    } catch (error) {
      console.error("[TakeAssessment]", error.message || error);
      req.flash("error", "Could not open assessment.");
      return res.redirect("/student/testing-room");
    }
  },

  submitAssessmentPost: async (req, res, db) => {
    const organizationId = req.session.organizationId;
    const studentId = req.session.studentId;
    const assessmentId = Number(req.params.assessmentId);
    const attemptId = Number(req.body.attemptId);
    const responses = req.body.responses || {};

    if (!Number.isInteger(assessmentId) || assessmentId <= 0 || !Number.isInteger(attemptId) || attemptId <= 0) {
      req.flash("error", "Invalid assessment submission.");
      return res.redirect("/student/testing-room");
    }

    const client = await db.connect();

    try {
      await ensureStudentPortalSchema(client);
      await ensureAssessmentModeSchema(client);
      await ensureStudentAssessmentLockSchema(client);
      await ensureStudentAssessmentAttemptIntegrity(client);
      await ensureAssessmentQuestionSetRetakeSchema(client);
      await client.query("BEGIN");

      const { selectedTerm, enrolledClassId } = await resolveCurrentStudentTermContext(client, organizationId, studentId);
      const effectiveClassId = enrolledClassId || null;
      if (!selectedTerm || !effectiveClassId) {
        await client.query("ROLLBACK");
        req.flash("error", "Your current class or term could not be resolved.");
        return res.redirect("/student/testing-room");
      }

      const attemptResult = await client.query(
        `SELECT attempt_id, question_set_id, status, started_at
           FROM student_assessment_attempts
          WHERE attempt_id = $1
            AND organization_id = $2
            AND student_id = $3
            AND assessment_id = $4
          FOR UPDATE`,
        [attemptId, organizationId, studentId, assessmentId]
      );

      if (!attemptResult.rows.length) {
        await client.query("ROLLBACK");
        req.flash("error", "Assessment attempt not found.");
        return res.redirect("/student/testing-room");
      }

      const attempt = attemptResult.rows[0];
      if (attempt.status === "submitted") {
        await client.query("ROLLBACK");
        req.flash("success", "Assessment completed. This test is now locked and cannot be accessed again.");
        return res.redirect("/student/testing-room");
      }

      const siblingAttemptsResult = await client.query(
        `SELECT attempt_id, status
           FROM student_assessment_attempts
          WHERE organization_id = $1
            AND student_id = $2
            AND assessment_id = $3
            AND attempt_id <> $4
          FOR UPDATE`,
        [organizationId, studentId, assessmentId, attemptId]
      );

      const assessmentResult = await client.query(
        `SELECT assessment_id, subject_id, term_id, class_id, category,
                COALESCE(open_book, FALSE) AS open_book,
                time_limit_minutes
           FROM assessments
          WHERE assessment_id = $1
            AND organization_id = $2
            AND class_id = $3
            AND term_id = $4
            AND COALESCE(is_active, TRUE) = TRUE
            AND (edit_window_start IS NULL OR edit_window_start <= NOW())
            AND (edit_window_end IS NULL OR edit_window_end >= NOW())
          LIMIT 1`,
        [assessmentId, organizationId, effectiveClassId, selectedTerm.term_id]
      );

      if (!assessmentResult.rows.length) {
        await client.query("ROLLBACK");
        req.flash("error", "Assessment is no longer available for submission.");
        return res.redirect("/student/testing-room");
      }

      const assessment = assessmentResult.rows[0];

      const attemptStartedAt = attempt.started_at ? new Date(attempt.started_at) : null;
      const timeLimitMinutes = Number(assessment.time_limit_minutes || 0);
      if (attemptStartedAt && Number.isInteger(timeLimitMinutes) && timeLimitMinutes > 0) {
        const expiresAtMs = attemptStartedAt.getTime() + (timeLimitMinutes * 60 * 1000);
        if (Date.now() > expiresAtMs) {
          await client.query("ROLLBACK");
          req.flash("error", "Assessment time has elapsed. Further submissions are not allowed.");
          return res.redirect("/student/testing-room");
        }
      }

      const lockOverrideResult = await client.query(
        `SELECT is_locked
           FROM student_assessment_lock_overrides
          WHERE organization_id = $1
            AND student_id = $2
            AND assessment_id = $3
          LIMIT 1`,
        [organizationId, studentId, assessmentId]
      );

      if (lockOverrideResult.rows.length && Boolean(lockOverrideResult.rows[0].is_locked)) {
        await client.query("ROLLBACK");
        req.flash("error", "This assessment is currently locked for you.");
        return res.redirect("/student/testing-room");
      }

      const questionsResult = await client.query(
        `SELECT question_id, question_type, answer_key, marks
           FROM assessment_questions
          WHERE question_set_id = $1
          ORDER BY position_index ASC, question_id ASC`,
        [attempt.question_set_id]
      );

      if (!questionsResult.rows.length) {
        await client.query("ROLLBACK");
        req.flash("error", "No questions were found for this attempt.");
        return res.redirect("/student/testing-room");
      }

      let autoScore = 0;
      let maxScore = 0;

      await client.query(`DELETE FROM student_assessment_responses WHERE attempt_id = $1`, [attemptId]);

      for (const question of questionsResult.rows) {
        const raw = responses[String(question.question_id)] ?? "";
        const evaluated = evaluateResponse(question, raw);
        const marks = Number(question.marks || 0);

        autoScore += Number(evaluated.awardedMarks || 0);
        maxScore += marks;

        const responseText = Array.isArray(raw) ? raw.join(",") : String(raw || "").trim();
        const responseJson = Array.isArray(raw) ? { values: raw } : null;

        await client.query(
          `INSERT INTO student_assessment_responses (
             attempt_id, question_id, response_text, response_json, is_correct, awarded_marks, created_at, updated_at
           ) VALUES ($1, $2, $3, $4::jsonb, $5, $6, NOW(), NOW())`,
          [
            attemptId,
            question.question_id,
            responseText || null,
            responseJson ? JSON.stringify(responseJson) : null,
            evaluated.isCorrect,
            Number(evaluated.awardedMarks || 0),
          ]
        );
      }

      await client.query(
        `UPDATE student_assessment_attempts
            SET status = 'submitted',
                submitted_at = NOW(),
                score = $1,
                auto_graded_score = $1,
                max_score = $2,
                updated_at = NOW()
          WHERE attempt_id = $3`,
        [autoScore, maxScore, attemptId]
      );

      await client.query(
        `INSERT INTO assessment_results (
           student_id, assessment_id, score, subject_id, term_id, organization_id, class_id, category
         ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
         ON CONFLICT (student_id, assessment_id)
         DO UPDATE SET
           score = EXCLUDED.score,
           subject_id = EXCLUDED.subject_id,
           term_id = EXCLUDED.term_id,
           organization_id = EXCLUDED.organization_id,
           class_id = EXCLUDED.class_id,
           category = EXCLUDED.category`,
        [
          studentId,
          assessmentId,
          autoScore,
          assessment.subject_id,
          assessment.term_id,
          organizationId,
          assessment.class_id,
          assessment.category,
        ]
      );

      await client.query(
        `DELETE FROM student_assessment_lock_overrides
         WHERE organization_id = $1
           AND student_id = $2
           AND assessment_id = $3`,
        [organizationId, studentId, assessmentId]
      );

      const siblingAttemptIds = siblingAttemptsResult.rows
        .map((row) => Number(row.attempt_id))
        .filter((id) => Number.isInteger(id) && id > 0);

      if (siblingAttemptIds.length) {
        await client.query(
          `DELETE FROM student_assessment_attempts
           WHERE attempt_id = ANY($1::int[])`,
          [siblingAttemptIds]
        );
      }

      await client.query("COMMIT");

      req.flash(
        "success",
        `Assessment completed successfully. Score: ${autoScore.toFixed(2)} / ${maxScore.toFixed(2)}. This test is now locked.`
      );
      return res.redirect("/student/testing-room");
    } catch (error) {
      await client.query("ROLLBACK").catch(() => {});
      console.error("[SubmitAssessment]", error.message || error);
      req.flash("error", "Could not submit assessment. Please try again.");
      return res.redirect(`/student/testing-room/${assessmentId}`);
    } finally {
      client.release();
    }
  },

  saveAssessmentDraftPost: async (req, res, db) => {
    const organizationId = req.session.organizationId;
    const studentId = req.session.studentId;
    const assessmentId = Number(req.params.assessmentId);
    const attemptId = Number(req.body.attemptId);
    const responses = req.body.responses && typeof req.body.responses === "object" ? req.body.responses : {};

    if (!Number.isInteger(assessmentId) || assessmentId <= 0 || !Number.isInteger(attemptId) || attemptId <= 0) {
      return res.status(400).json({ success: false, error: "Invalid autosave request." });
    }

    const client = await db.connect();
    try {
      await ensureStudentPortalSchema(client);
      await client.query("BEGIN");

      const attemptResult = await client.query(
        `SELECT attempt_id, question_set_id, status
           FROM student_assessment_attempts
          WHERE attempt_id = $1
            AND organization_id = $2
            AND student_id = $3
            AND assessment_id = $4
          FOR UPDATE`,
        [attemptId, organizationId, studentId, assessmentId]
      );

      if (!attemptResult.rows.length) {
        await client.query("ROLLBACK");
        return res.status(404).json({ success: false, error: "Assessment attempt not found." });
      }

      const attempt = attemptResult.rows[0];
      if (String(attempt.status || "").toLowerCase() !== "in_progress") {
        await client.query("ROLLBACK");
        return res.status(409).json({ success: false, error: "This attempt can no longer be edited." });
      }

      const questionsResult = await client.query(
        `SELECT question_id
           FROM assessment_questions
          WHERE question_set_id = $1`,
        [attempt.question_set_id]
      );

      const allowedQuestionIds = new Set(
        questionsResult.rows.map((row) => String(row.question_id))
      );

      await client.query(`DELETE FROM student_assessment_responses WHERE attempt_id = $1`, [attemptId]);

      for (const questionId of allowedQuestionIds) {
        const raw = responses[questionId] ?? "";
        const isArrayResponse = Array.isArray(raw);
        const normalizedArray = isArrayResponse
          ? raw.map((value) => String(value || "").trim()).filter(Boolean)
          : [];
        const normalizedText = isArrayResponse
          ? normalizedArray.join(",")
          : String(raw || "").trim();

        if ((!isArrayResponse && !normalizedText) || (isArrayResponse && !normalizedArray.length)) {
          continue;
        }

        await client.query(
          `INSERT INTO student_assessment_responses (
             attempt_id, question_id, response_text, response_json, created_at, updated_at
           ) VALUES ($1, $2, $3, $4::jsonb, NOW(), NOW())`,
          [
            attemptId,
            Number(questionId),
            normalizedText || null,
            isArrayResponse ? JSON.stringify({ values: normalizedArray }) : null,
          ]
        );
      }

      const savedAtResult = await client.query(
        `UPDATE student_assessment_attempts
            SET updated_at = NOW()
          WHERE attempt_id = $1
        RETURNING updated_at`,
        [attemptId]
      );

      await client.query("COMMIT");
      return res.json({
        success: true,
        savedAt: savedAtResult.rows[0]?.updated_at || new Date().toISOString(),
      });
    } catch (error) {
      await client.query("ROLLBACK").catch(() => {});
      return res.status(500).json({ success: false, error: "Could not save draft." });
    } finally {
      client.release();
    }
  },
};
