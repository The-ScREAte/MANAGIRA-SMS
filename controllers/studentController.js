const { getClassScheduleForTerm } = require("../utils/classScheduleService");
const { ensureStudentPortalSchema } = require("../utils/studentPortal");
const {
  ensureAttendanceCalendarSchema,
  getAttendanceCalendarProfile,
  getAttendanceCalendarDays,
  buildCalendarDayMap,
  toDateKey,
  isAttendanceCountableForDate,
} = require("../utils/attendanceCalendar");
const { getStudentTransportationSnapshot } = require("./transportationController");

const STUDENT_TESTING_ROOM_FEATURE_NAMES = [
  "Set Assessment Questions",
  "Assessment Questions",
];

function resolveScheduleWatermarkUrl(req) {
  const rawLogo = String(
    req?.schoolDetails?.logo ||
    req?.schoolDetails?.logo_path ||
    req?.session?.schoolLogo ||
    req?.session?.logo ||
    ""
  ).trim();

  if (!rawLogo) return "";
  if (/^https?:\/\//i.test(rawLogo)) return rawLogo;
  if (rawLogo.startsWith("/")) return rawLogo;

  const s3Bucket = String(process.env.S3_BUCKET_NAME || "").trim();
  const s3Region = String(process.env.AWS_REGION || "").trim();
  if (s3Bucket && s3Region) {
    return `https://${s3Bucket}.s3.${s3Region}.amazonaws.com/${rawLogo.replace(/^\/+/, "")}`;
  }

  return `/uploads/${rawLogo.replace(/^\/+/, "")}`;
}

function canUseStudentTestingRoom(req) {
  const allowedFeatures = Array.isArray(req?.session?.allowedFeatures)
    ? req.session.allowedFeatures
    : [];

  if (!allowedFeatures.length) return false;

  const normalized = new Set(
    allowedFeatures.map((featureName) => String(featureName || "").trim().toLowerCase())
  );

  return STUDENT_TESTING_ROOM_FEATURE_NAMES.some((featureName) =>
    normalized.has(String(featureName || "").trim().toLowerCase())
  );
}

let studentAssessmentLockSchemaReady = false;
let studentAssessmentAttemptIntegrityReady = false;
let assessmentQuestionSetRetakeSchemaReady = false;
let assessmentModeSchemaReady = false;

async function ensureAssessmentModeSchema(dbClient) {
  if (assessmentModeSchemaReady) return;
  await dbClient.query(`
    ALTER TABLE assessments
      ADD COLUMN IF NOT EXISTS open_book BOOLEAN DEFAULT FALSE,
      ADD COLUMN IF NOT EXISTS time_limit_minutes INTEGER,
      ADD COLUMN IF NOT EXISTS max_attempts INTEGER DEFAULT 1
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

  await dbClient.query(`
    CREATE OR REPLACE FUNCTION validate_student_assessment_lock_override_set()
    RETURNS trigger AS $$
    BEGIN
      IF NEW.question_set_id IS NULL THEN
        RETURN NEW;
      END IF;

      IF NOT EXISTS (
        SELECT 1
        FROM assessment_question_sets qs
        WHERE qs.question_set_id = NEW.question_set_id
          AND qs.organization_id = NEW.organization_id
          AND qs.assessment_id = NEW.assessment_id
      ) THEN
        RAISE EXCEPTION 'Invalid question_set_id % for assessment_id % in organization %',
          NEW.question_set_id, NEW.assessment_id, NEW.organization_id;
      END IF;

      RETURN NEW;
    END;
    $$ LANGUAGE plpgsql;
  `);

  await dbClient.query(`
    DROP TRIGGER IF EXISTS trg_validate_student_assessment_lock_override_set
      ON student_assessment_lock_overrides;
  `);

  await dbClient.query(`
    CREATE TRIGGER trg_validate_student_assessment_lock_override_set
    BEFORE INSERT OR UPDATE OF question_set_id, assessment_id, organization_id
    ON student_assessment_lock_overrides
    FOR EACH ROW
    EXECUTE FUNCTION validate_student_assessment_lock_override_set();
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

async function resolveCurrentStudentTermContext(db, organizationId, studentId, preferredTermId = null) {
  const safePreferredTermId = Number.parseInt(preferredTermId, 10);

  const loadTermById = async (termId) => {
    if (!Number.isInteger(termId) || termId <= 0) return null;
    const result = await db.query(
      `SELECT t.term_id, t.term_name, t.current, t.school_year_id, sy.year_label,
              t.start_date, t.end_date
         FROM terms t
         JOIN school_years sy ON sy.id = t.school_year_id
        WHERE t.organization_id = $1 AND t.term_id = $2
        LIMIT 1`,
      [organizationId, termId]
    );
    return result.rows[0] || null;
  };

  const loadCurrentTerm = async () => {
    const result = await db.query(
      `SELECT t.term_id, t.term_name, t.current, t.school_year_id, sy.year_label,
              t.start_date, t.end_date
         FROM terms t
         JOIN school_years sy ON sy.id = t.school_year_id
        WHERE t.organization_id = $1 AND t.current = TRUE
        ORDER BY t.start_date DESC, t.term_id DESC
        LIMIT 1`,
      [organizationId]
    );
    return result.rows[0] || null;
  };

  let selectedTerm = await loadTermById(safePreferredTermId);
  if (!selectedTerm) {
    selectedTerm = await loadCurrentTerm();
  }

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

  let enrolledClassId = enrollmentResult.rows[0]?.class_id || null;
  let enrolledClassName = enrollmentResult.rows[0]?.class_name || null;

  if (!enrolledClassId && Number.isInteger(safePreferredTermId) && selectedTerm.term_id === safePreferredTermId) {
    const currentTerm = await loadCurrentTerm();
    if (currentTerm && currentTerm.term_id !== selectedTerm.term_id) {
      const currentEnrollmentResult = await db.query(
        `SELECT c.class_id, c.class_name
           FROM enrollments e
           JOIN enrolled_students es ON es.enrollment_id = e.enrollment_id
           JOIN classes c ON c.class_id = es.class_id
          WHERE e.organization_id = $1
            AND e.term_id = $2
            AND es.student_id = $3
          ORDER BY e.created_at DESC
          LIMIT 1`,
        [organizationId, currentTerm.term_id, studentId]
      );

      if (currentEnrollmentResult.rows[0]?.class_id) {
        selectedTerm = currentTerm;
        enrolledClassId = currentEnrollmentResult.rows[0].class_id;
        enrolledClassName = currentEnrollmentResult.rows[0].class_name;
      }
    }
  }

  return {
    selectedTerm,
    enrolledClassId,
    enrolledClassName,
  };
}

async function getStudentPortalTermOptions(db, organizationId, studentId) {
  const termResult = await db.query(
    `SELECT t.term_id,
            t.term_name,
            t.current,
            t.school_year_id,
            sy.year_label,
            t.start_date,
            t.end_date,
            EXISTS (
              SELECT 1
                FROM enrollments e
                JOIN enrolled_students es ON es.enrollment_id = e.enrollment_id
               WHERE e.organization_id = t.organization_id
                 AND e.term_id = t.term_id
                 AND es.student_id = $2
            ) AS student_enrolled
       FROM terms t
       JOIN school_years sy ON sy.id = t.school_year_id
      WHERE t.organization_id = $1
      ORDER BY t.start_date DESC, t.term_id DESC`,
    [organizationId, studentId]
  );

  return termResult.rows || [];
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
      GREATEST(COALESCE(a.max_attempts, 1), 1) AS max_attempts,
        a.edit_window_end,
        s.subject_name,
        COALESCE(sa.submitted_count, 0)::int AS submitted_attempts,
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
             AND (qs.retake_student_id IS NULL OR qs.retake_student_id = $4)
         GROUP BY qs.question_set_id, qs.updated_at, qs.retake_student_id
           ORDER BY
             CASE WHEN qs.retake_student_id = $4 THEN 0 ELSE 1 END,
             qs.updated_at DESC,
             qs.question_set_id DESC
         LIMIT 1
       ) qs ON TRUE
       LEFT JOIN student_assessment_lock_overrides salo
         ON salo.organization_id = a.organization_id
        AND salo.student_id = $4
        AND salo.assessment_id = a.assessment_id
       LEFT JOIN LATERAL (
         SELECT COUNT(*)::int AS submitted_count
         FROM student_assessment_attempts saa
         WHERE saa.organization_id = a.organization_id
           AND saa.student_id = $4
           AND saa.assessment_id = a.assessment_id
           AND saa.status = 'submitted'
       ) sa ON TRUE
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
        AND COALESCE(salo.is_locked, FALSE) = FALSE
        AND (
          COALESCE(sa.submitted_count, 0) < GREATEST(COALESCE(a.max_attempts, 1), 1)
          OR (salo.id IS NOT NULL AND COALESCE(salo.is_locked, FALSE) = FALSE)
        )
      GROUP BY a.assessment_id, a.title, a.max_score, a.category, a.open_book, salo.is_locked, a.time_limit_minutes, a.max_attempts, a.edit_window_end, s.subject_name, sa.submitted_count, qs.question_count, qs.updated_at
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
           GREATEST(COALESCE(a.max_attempts, 1), 1) AS max_attempts,
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
      GROUP BY a.assessment_id, a.title, a.max_score, a.category, a.open_book, a.time_limit_minutes, a.max_attempts, s.subject_name,
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
    const testingRoomEnabled = canUseStudentTestingRoom(req);

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
      const transportationSnapshot = await getStudentTransportationSnapshot(
        db,
        organizationId,
        Number(studentId)
      ).catch(() => null);

      const availableTerms = await getStudentPortalTermOptions(db, organizationId, studentId);

      const requestedTermId = req.query.termId || req.session.currentTermId || null;
      const { selectedTerm, enrolledClassId, enrolledClassName } = await resolveCurrentStudentTermContext(
        db,
        organizationId,
        studentId,
        requestedTermId
      );
      const scheduleWatermarkUrl = resolveScheduleWatermarkUrl(req);
      if (!selectedTerm) {
        req.flash("error", "No school term is currently available.");
        return res.render("student/dashboard", {
          title: "Student Portal",
          student,
          selectedTerm: null,
          availableTerms,
          enrolledClassName: null,
          mainTeacher: null,
          subjectTeachers: [],
          subjects: [],
          assessmentGrades: [],
          gradeAssessmentHeaders: [],
          attendanceSummary: { totalDays: 0, present: 0, absent: 0, late: 0, attendanceRate: 0 },
          classSchedule: null,
          scheduleTable: { periods: [], rows: [] },
          scheduleWatermarkUrl,
          transportationSnapshot,
          openAssessmentsCount: 0,
          testingRoomEnabled,
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
             FROM student_subjects_in_term($3::int) ss
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
                 FROM student_subjects_in_term($3::int) ss
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
                 FROM student_term_positions
                WHERE student_id = $1
                  AND organization_id = $2
                  AND class_id = $3
                  AND term_id = $4`,
              [studentId, organizationId, effectiveClassId, selectedTerm.term_id]
            )
          : { rows: [] },
        effectiveClassId
          ? db.query(
              `SELECT ar.date::text AS date, ar.status
                 FROM attendance_records ar
                 JOIN terms t
                   ON t.term_id = ar.term_id
                  AND t.organization_id = ar.organization_id
                WHERE ar.organization_id = $1
                  AND ar.student_id = $2
                  AND ar.term_id = $3
                  AND t.school_year_id = $4
                  AND ar.class_id = $5`,
              [organizationId, studentId, selectedTerm.term_id, selectedTerm.school_year_id, effectiveClassId]
            )
          : db.query(
              `SELECT ar.date::text AS date, ar.status
                 FROM attendance_records ar
                 JOIN terms t
                   ON t.term_id = ar.term_id
                  AND t.organization_id = ar.organization_id
                WHERE ar.organization_id = $1
                  AND ar.student_id = $2
                  AND ar.term_id = $3
                  AND t.school_year_id = $4`,
              [organizationId, studentId, selectedTerm.term_id, selectedTerm.school_year_id]
            ),
        effectiveClassId
          ? getClassScheduleForTerm(db, {
              organizationId,
              classId: effectiveClassId,
              termId: selectedTerm.term_id,
            })
          : null,
        testingRoomEnabled
          ? getOpenAssessments(db, organizationId, studentId, effectiveClassId, selectedTerm.term_id)
          : Promise.resolve([]),
      ]);

      const attendanceRows = attendanceResult.rows || [];
      const attendanceByDate = new Map();
      attendanceRows.forEach((row) => {
        const dateKey = toDateKey(row.date);
        if (!dateKey) return;
        attendanceByDate.set(dateKey, String(row.status || "").toLowerCase());
      });

      const attendanceSummary = {
        totalDays: 0,
        present: 0,
        absent: 0,
        late: 0,
        attendanceRate: 0,
      };

      const termStartKey = toDateKey(selectedTerm.start_date);
      const termEndKey = toDateKey(selectedTerm.end_date);
      const todayKey = toDateKey(new Date());
      const effectiveEndKey = termEndKey && termEndKey < todayKey ? termEndKey : todayKey;

      if (termStartKey && effectiveEndKey && termStartKey <= effectiveEndKey) {
        await ensureAttendanceCalendarSchema(db);
        const attendanceCalendarProfile = await getAttendanceCalendarProfile(db, organizationId, selectedTerm.term_id);
        const attendanceCalendarDays = attendanceCalendarProfile
          ? await getAttendanceCalendarDays(
              db,
              attendanceCalendarProfile.calendar_id,
              new Date(`${termStartKey}T00:00:00.000Z`),
              new Date(`${effectiveEndKey}T23:59:59.999Z`)
            )
          : [];
        const attendanceCalendarDayMap = buildCalendarDayMap(attendanceCalendarDays);

        const cursor = new Date(`${termStartKey}T00:00:00.000Z`);
        const lastDate = new Date(`${effectiveEndKey}T00:00:00.000Z`);

        while (cursor <= lastDate) {
          const dateKey = cursor.toISOString().slice(0, 10);
          const isOfficialTermEnd = Boolean(termEndKey) && dateKey === termEndKey;
          const countable = isOfficialTermEnd
            ? true
            : isAttendanceCountableForDate(dateKey, attendanceCalendarProfile, attendanceCalendarDayMap);

          if (countable) {
            attendanceSummary.totalDays += 1;
            const normalizedStatus = attendanceByDate.get(dateKey);
            if (normalizedStatus === "present") attendanceSummary.present += 1;
            if (normalizedStatus === "late") attendanceSummary.late += 1;
          }

          cursor.setUTCDate(cursor.getUTCDate() + 1);
        }

        attendanceSummary.absent = Math.max(
          attendanceSummary.totalDays - attendanceSummary.present - attendanceSummary.late,
          0
        );
      } else {
        attendanceSummary.totalDays = attendanceRows.length;
        attendanceSummary.present = attendanceRows.filter((item) => String(item.status || "").toLowerCase() === "present").length;
        attendanceSummary.absent = attendanceRows.filter((item) => String(item.status || "").toLowerCase() === "absent").length;
        attendanceSummary.late = attendanceRows.filter((item) => String(item.status || "").toLowerCase() === "late").length;
      }

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
        availableTerms,
        enrolledClassName,
        mainTeacher: mainTeacherResult.rows[0] || null,
        subjectTeachers: subjectTeachersResult.rows || [],
        subjects: subjectsResult.rows || [],
        assessmentGrades,
        gradeAssessmentHeaders,
        attendanceSummary,
        classSchedule,
        scheduleTable,
        scheduleWatermarkUrl,
        transportationSnapshot,
        openAssessmentsCount: openAssessments.length,
        testingRoomEnabled,
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
    const testingRoomEnabled = canUseStudentTestingRoom(req);

    if (!testingRoomEnabled) {
      req.flash("error", "Testing Room is not enabled for your organization.");
      return res.redirect("/student/dashboard");
    }

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
    const requestedQuestionSetId = Number.parseInt(req.query.questionSetId, 10);
    const testingRoomEnabled = canUseStudentTestingRoom(req);

    if (!testingRoomEnabled) {
      req.flash("error", "Testing Room is not enabled for your organization.");
      return res.redirect("/student/dashboard");
    }

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
          GREATEST(COALESCE(a.max_attempts, 1), 1) AS max_attempts,
          a.edit_window_start,
          a.edit_window_end,
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
      const maxAttempts = Number(assessment.max_attempts || 1);

      const submittedAttemptResult = await db.query(
        `SELECT COUNT(*)::int AS submitted_count
           FROM student_assessment_attempts
          WHERE organization_id = $1
            AND student_id = $2
            AND assessment_id = $3
            AND status = 'submitted'`,
        [organizationId, studentId, assessmentId]
      );
      const submittedAttemptCount = Number(submittedAttemptResult.rows[0]?.submitted_count || 0);
      if (!explicitUnlock && submittedAttemptCount >= maxAttempts) {
        req.flash("success", "Assessment attempt limit reached. This test is now locked unless your teacher unlocks it.");
        return res.redirect("/student/testing-room");
      }

      if (lockOverrideResult.rows.length && Boolean(lockOverrideResult.rows[0].is_locked)) {
        req.flash("error", "This assessment is currently locked for you.");
        return res.redirect("/student/testing-room");
      }

      const preferredQuestionSetId =
        Number.isInteger(requestedQuestionSetId) && requestedQuestionSetId > 0
          ? requestedQuestionSetId
          : (
        lockOverrideResult.rows.length && lockOverrideResult.rows[0].question_set_id
          ? Number(lockOverrideResult.rows[0].question_set_id)
          : null
          );

      let questionSetResult = await db.query(
        `SELECT question_set_id, set_title, set_description
           FROM assessment_question_sets
          WHERE organization_id = $1
            AND assessment_id = $2
            AND (
              ($3::int IS NOT NULL AND question_set_id = $3)
              OR (
                $3::int IS NULL
                AND (retake_student_id IS NULL OR retake_student_id = $4)
              )
            )
            AND LOWER(COALESCE(review_status, 'pending')) = 'approved'
          ORDER BY
            CASE WHEN retake_student_id = $4 THEN 0 ELSE 1 END,
            updated_at DESC,
            question_set_id DESC
          LIMIT 1`,
        [
          organizationId,
          assessmentId,
          preferredQuestionSetId,
          studentId,
        ]
      );

      // Recover from stale override mapping (e.g. override points to a set that
      // belongs to another assessment or is no longer approved).
      if (!questionSetResult.rows.length && preferredQuestionSetId) {
        questionSetResult = await db.query(
          `SELECT question_set_id, set_title, set_description
             FROM assessment_question_sets
            WHERE organization_id = $1
              AND assessment_id = $2
              AND (retake_student_id IS NULL OR retake_student_id = $3)
              AND LOWER(COALESCE(review_status, 'pending')) = 'approved'
            ORDER BY
              CASE WHEN retake_student_id = $3 THEN 0 ELSE 1 END,
              updated_at DESC,
              question_set_id DESC
            LIMIT 1`,
          [organizationId, assessmentId, studentId]
        );

        if (questionSetResult.rows.length) {
          try {
            await db.query(
              `UPDATE student_assessment_lock_overrides
                  SET question_set_id = $4,
                      updated_at = NOW()
                WHERE organization_id = $1
                  AND student_id = $2
                  AND assessment_id = $3`,
              [
                organizationId,
                studentId,
                assessmentId,
                Number(questionSetResult.rows[0].question_set_id),
              ]
            );
          } catch (_) {
            // Non-fatal: proceed with recovered question set even if self-heal update fails.
          }
        }
      }

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
          ORDER BY started_at DESC NULLS LAST, updated_at DESC NULLS LAST, attempt_id DESC
          LIMIT 1`,
        [organizationId, studentId, assessmentId]
      );

      let attemptId = attemptResult.rows[0]?.attempt_id || null;
      if (!attemptId) {
        try {
          const createdAttempt = await db.query(
            `INSERT INTO student_assessment_attempts (
               organization_id, student_id, assessment_id, question_set_id, term_id, class_id, status, started_at, created_at, updated_at
             ) VALUES ($1, $2, $3, $4, $5, $6, 'in_progress', NULL, NOW(), NOW())
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
        maxAttempts,
        submittedAttemptCount,
        remainingAttempts: Math.max(maxAttempts - submittedAttemptCount, 0),
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

  startAssessmentAttemptPost: async (req, res, db) => {
    const organizationId = req.session.organizationId;
    const studentId = req.session.studentId;
    const assessmentId = Number(req.params.assessmentId);
    const attemptId = Number(req.body.attemptId);

    if (!Number.isInteger(assessmentId) || assessmentId <= 0 || !Number.isInteger(attemptId) || attemptId <= 0) {
      return res.status(400).json({ success: false, error: "Invalid assessment start request." });
    }

    const client = await db.connect();
    try {
      await ensureStudentPortalSchema(client);
      await ensureAssessmentModeSchema(client);
      await ensureStudentAssessmentLockSchema(client);
      await client.query("BEGIN");

      const { selectedTerm, enrolledClassId } = await resolveCurrentStudentTermContext(client, organizationId, studentId);
      const effectiveClassId = enrolledClassId || null;
      if (!selectedTerm || !effectiveClassId) {
        await client.query("ROLLBACK");
        return res.status(409).json({ success: false, error: "Your current class or term could not be resolved." });
      }

      const attemptResult = await client.query(
        `SELECT attempt_id, started_at, status
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
        return res.status(409).json({ success: false, error: "This attempt can no longer be started." });
      }

      const assessmentResult = await client.query(
        `SELECT assessment_id,
                term_id,
                class_id,
                subject_id,
                time_limit_minutes,
                GREATEST(COALESCE(max_attempts, 1), 1) AS max_attempts
           FROM assessments
          WHERE assessment_id = $1
            AND organization_id = $2
            AND class_id = $3
            AND term_id = $4
            AND COALESCE(is_active, TRUE) = TRUE
            AND (edit_window_start IS NULL OR edit_window_start <= NOW())
            AND (edit_window_end IS NULL OR edit_window_end >= NOW())
            AND EXISTS (
              SELECT 1
              FROM student_subjects ss
              WHERE ss.organization_id = $2
                AND ss.student_id = $5
                AND ss.subject_id = assessments.subject_id
            )
          LIMIT 1`,
        [assessmentId, organizationId, effectiveClassId, selectedTerm.term_id, studentId]
      );

      if (!assessmentResult.rows.length) {
        await client.query("ROLLBACK");
        return res.status(409).json({ success: false, error: "This assessment is not currently available." });
      }

      const assessment = assessmentResult.rows[0];
      const maxAttempts = Number(assessment.max_attempts || 1);

      const lockOverrideResult = await client.query(
        `SELECT is_locked
           FROM student_assessment_lock_overrides
          WHERE organization_id = $1
            AND student_id = $2
            AND assessment_id = $3
          LIMIT 1`,
        [organizationId, studentId, assessmentId]
      );

      const explicitUnlock = lockOverrideResult.rows.length && !Boolean(lockOverrideResult.rows[0].is_locked);

      if (lockOverrideResult.rows.length && Boolean(lockOverrideResult.rows[0].is_locked)) {
        await client.query("ROLLBACK");
        return res.status(403).json({ success: false, error: "This assessment is currently locked for you." });
      }

      const submittedCountResult = await client.query(
        `SELECT COUNT(*)::int AS submitted_count
           FROM student_assessment_attempts
          WHERE organization_id = $1
            AND student_id = $2
            AND assessment_id = $3
            AND status = 'submitted'`,
        [organizationId, studentId, assessmentId]
      );
      const submittedAttemptCount = Number(submittedCountResult.rows[0]?.submitted_count || 0);
      if (!explicitUnlock && submittedAttemptCount >= maxAttempts) {
        await client.query("ROLLBACK");
        return res.status(409).json({ success: false, error: "You have reached the maximum number of attempts for this assessment." });
      }

      const existingStartedAt = attempt.started_at ? new Date(attempt.started_at) : null;
      const timeLimitMinutes = Number(assessment.time_limit_minutes || 0);
      if (existingStartedAt && Number.isFinite(timeLimitMinutes) && timeLimitMinutes > 0) {
        const expiresAtMs = existingStartedAt.getTime() + (timeLimitMinutes * 60 * 1000);
        if (Date.now() > expiresAtMs) {
          await client.query("ROLLBACK");
          return res.status(409).json({ success: false, error: "Assessment time has elapsed. Further submissions are not allowed." });
        }
      }

      const startedAtResult = await client.query(
        `UPDATE student_assessment_attempts
            SET started_at = COALESCE(started_at, NOW()),
                updated_at = NOW()
          WHERE attempt_id = $1
        RETURNING started_at`,
        [attemptId]
      );

      await client.query("COMMIT");
      return res.json({
        success: true,
        startedAt: startedAtResult.rows[0]?.started_at || new Date().toISOString(),
        timeLimitMinutes: Number.isFinite(timeLimitMinutes) && timeLimitMinutes > 0 ? Math.trunc(timeLimitMinutes) : 0,
      });
    } catch (error) {
      await client.query("ROLLBACK").catch(() => {});
      return res.status(500).json({ success: false, error: "Could not start assessment." });
    } finally {
      client.release();
    }
  },

  lockAssessmentAttemptPost: async (req, res, db) => {
    const organizationId = req.session.organizationId;
    const studentId = req.session.studentId;
    const assessmentId = Number(req.params.assessmentId);
    const attemptId = Number(req.body.attemptId);

    if (!Number.isInteger(assessmentId) || assessmentId <= 0 || !Number.isInteger(attemptId) || attemptId <= 0) {
      return res.status(400).json({ success: false, error: "Invalid assessment lock request." });
    }

    const client = await db.connect();
    try {
      await ensureStudentPortalSchema(client);
      await ensureAssessmentModeSchema(client);
      await ensureStudentAssessmentLockSchema(client);
      await client.query("BEGIN");

      const { selectedTerm, enrolledClassId } = await resolveCurrentStudentTermContext(client, organizationId, studentId);
      const effectiveClassId = enrolledClassId || null;
      if (!selectedTerm || !effectiveClassId) {
        await client.query("ROLLBACK");
        return res.status(409).json({ success: false, error: "Your current class or term could not be resolved." });
      }

      const assessmentResult = await client.query(
        `SELECT COALESCE(open_book, FALSE) AS open_book
           FROM assessments
          WHERE assessment_id = $1
            AND organization_id = $2
            AND class_id = $3
            AND term_id = $4
            AND EXISTS (
              SELECT 1
              FROM student_subjects ss
              WHERE ss.organization_id = $2
                AND ss.student_id = $5
                AND ss.subject_id = assessments.subject_id
            )
          LIMIT 1`,
        [assessmentId, organizationId, effectiveClassId, selectedTerm.term_id, studentId]
      );

      if (!assessmentResult.rows.length) {
        await client.query("ROLLBACK");
        return res.status(404).json({ success: false, error: "Assessment not found." });
      }

      if (Boolean(assessmentResult.rows[0].open_book)) {
        await client.query("ROLLBACK");
        return res.status(409).json({ success: false, error: "Lock action is only available in secure mode." });
      }

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
        return res.json({ success: true, alreadyClosed: true });
      }

      await client.query(
        `INSERT INTO student_assessment_lock_overrides (
           organization_id,
           student_id,
           assessment_id,
           question_set_id,
           is_locked,
           created_at,
           updated_at
         ) VALUES ($1, $2, $3, $4, TRUE, NOW(), NOW())
         ON CONFLICT (organization_id, student_id, assessment_id)
         DO UPDATE SET
           question_set_id = COALESCE(EXCLUDED.question_set_id, student_assessment_lock_overrides.question_set_id),
           is_locked = TRUE,
           updated_at = NOW()`,
        [organizationId, studentId, assessmentId, attempt.question_set_id || null]
      );

      await client.query("COMMIT");
      return res.json({ success: true, locked: true });
    } catch (error) {
      await client.query("ROLLBACK").catch(() => {});
      return res.status(500).json({ success: false, error: "Could not lock assessment." });
    } finally {
      client.release();
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
            AND status = 'in_progress'
            AND attempt_id <> $4
          FOR UPDATE`,
        [organizationId, studentId, assessmentId, attemptId]
      );

      const assessmentResult = await client.query(
        `SELECT assessment_id, subject_id, term_id, class_id, category,
                COALESCE(open_book, FALSE) AS open_book,
                time_limit_minutes,
                GREATEST(COALESCE(max_attempts, 1), 1) AS max_attempts
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
      const maxAttempts = Number(assessment.max_attempts || 1);

      const submittedCountResult = await client.query(
        `SELECT COUNT(*)::int AS submitted_count
           FROM student_assessment_attempts
          WHERE organization_id = $1
            AND student_id = $2
            AND assessment_id = $3
            AND status = 'submitted'`,
        [organizationId, studentId, assessmentId]
      );
      const submittedAttemptCount = Number(submittedCountResult.rows[0]?.submitted_count || 0);

      const attemptStartedAt = attempt.started_at ? new Date(attempt.started_at) : null;
      const timeLimitMinutes = Number(assessment.time_limit_minutes || 0);
      let timedOutAtSubmission = false;
      if (Number.isFinite(timeLimitMinutes) && timeLimitMinutes > 0 && !attemptStartedAt) {
        await client.query("ROLLBACK");
        req.flash("error", "Start the assessment before submitting.");
        return res.redirect(`/student/testing-room/${assessmentId}`);
      }

      if (attemptStartedAt && Number.isFinite(timeLimitMinutes) && timeLimitMinutes > 0) {
        const expiresAtMs = attemptStartedAt.getTime() + (timeLimitMinutes * 60 * 1000);
        if (Date.now() > expiresAtMs) {
          timedOutAtSubmission = true;
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

      const explicitUnlock = lockOverrideResult.rows.length && !Boolean(lockOverrideResult.rows[0].is_locked);

      if (!explicitUnlock && submittedAttemptCount >= maxAttempts) {
        await client.query("ROLLBACK");
        req.flash("error", "You have reached the maximum number of attempts for this assessment.");
        return res.redirect("/student/testing-room");
      }

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

      // Note: does NOT write into assessment_results here. Scores only become
      // visible on the subject/class dashboard once a teacher explicitly
      // clicks "Post Score" (commonController.postAssessmentQuestionSetScores),
      // which reads student_assessment_attempts.score set above.

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

      const submittedCountAfterResult = await client.query(
        `SELECT COUNT(*)::int AS submitted_count
           FROM student_assessment_attempts
          WHERE organization_id = $1
            AND student_id = $2
            AND assessment_id = $3
            AND status = 'submitted'`,
        [organizationId, studentId, assessmentId]
      );
      const submittedAfter = Number(submittedCountAfterResult.rows[0]?.submitted_count || 0);
      const remainingAttempts = Math.max(maxAttempts - submittedAfter, 0);

      await client.query("COMMIT");

      const completionMessage = remainingAttempts > 0
        ? `Assessment completed successfully. Score: ${autoScore.toFixed(2)} / ${maxScore.toFixed(2)}. Attempts left: ${remainingAttempts}.`
        : `Assessment completed successfully. Score: ${autoScore.toFixed(2)} / ${maxScore.toFixed(2)}. Attempt limit reached.`;

      req.flash("success", timedOutAtSubmission
        ? `Time is up. Your assessment has been auto-submitted. ${completionMessage}`
        : completionMessage
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
      await ensureAssessmentModeSchema(client);
      await client.query("BEGIN");

      const { selectedTerm, enrolledClassId } = await resolveCurrentStudentTermContext(client, organizationId, studentId);
      const effectiveClassId = enrolledClassId || null;
      if (!selectedTerm || !effectiveClassId) {
        await client.query("ROLLBACK");
        return res.status(409).json({ success: false, error: "Your current class or term could not be resolved." });
      }

      const assessmentScopeResult = await client.query(
        `SELECT assessment_id
           FROM assessments
          WHERE assessment_id = $1
            AND organization_id = $2
            AND class_id = $3
            AND term_id = $4
            AND COALESCE(is_active, TRUE) = TRUE
            AND (edit_window_start IS NULL OR edit_window_start <= NOW())
            AND (edit_window_end IS NULL OR edit_window_end >= NOW())
            AND EXISTS (
              SELECT 1
              FROM student_subjects ss
              WHERE ss.organization_id = $2
                AND ss.student_id = $5
                AND ss.subject_id = assessments.subject_id
            )
          LIMIT 1`,
        [assessmentId, organizationId, effectiveClassId, selectedTerm.term_id, studentId]
      );

      if (!assessmentScopeResult.rows.length) {
        await client.query("ROLLBACK");
        return res.status(403).json({ success: false, error: "This assessment is not available for your current class or term." });
      }

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
