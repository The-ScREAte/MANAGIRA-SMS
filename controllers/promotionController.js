const db = require("../config/db");
const { buildStudentDisplayId, getOrganizationStudentIdSettings } = require("../utils/studentIdDisplay");
const { isEmbeddedRequest } = require("../utils/embeddedMode");
const notifSvc = require("../utils/notificationService");

let promotionSubjectSelectionSchemaReady = false;
let promotionScheduleRetrySchemaReady = false;
let promotionAuditSchemaReady = false;

function formatStudentName(row = {}) {
  return [row.first_name, row.last_name].filter(Boolean).join(' ').trim() || `Student ${row.student_id || ''}`.trim();
}

async function ensurePromotionAuditSchema() {
  if (promotionAuditSchemaReady) return;

  await db.query(`
    CREATE TABLE IF NOT EXISTS promotion_schedule_audit (
      id SERIAL PRIMARY KEY,
      schedule_id INT NOT NULL REFERENCES promotion_schedule(id) ON DELETE CASCADE,
      organization_id INT NOT NULL REFERENCES organizations(organization_id) ON DELETE CASCADE,
      action_type VARCHAR(50) NOT NULL,
      enrollment_id INT,
      enrolled_class_id INT,
      enrolled_student_id INT,
      student_id INT,
      class_id INT,
      subject_id INT,
      details_json JSONB NOT NULL DEFAULT '{}'::jsonb,
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
    )
  `);

  await db.query(`
    CREATE INDEX IF NOT EXISTS idx_promotion_schedule_audit_schedule
      ON promotion_schedule_audit (schedule_id, id)
  `);

  promotionAuditSchemaReady = true;
}

async function recordPromotionAuditRows(client, rows) {
  if (!Array.isArray(rows) || rows.length === 0) return;
  await ensurePromotionAuditSchema();

  const values = [];
  const placeholders = [];
  rows.forEach((row, index) => {
    const offset = index * 10;
    values.push(
      Number(row.scheduleId),
      Number(row.organizationId),
      String(row.actionType || '').trim(),
      row.enrollmentId == null ? null : Number(row.enrollmentId),
      row.enrolledClassId == null ? null : Number(row.enrolledClassId),
      row.enrolledStudentId == null ? null : Number(row.enrolledStudentId),
      row.studentId == null ? null : Number(row.studentId),
      row.classId == null ? null : Number(row.classId),
      row.subjectId == null ? null : Number(row.subjectId),
      JSON.stringify(row.details || {})
    );
    placeholders.push(`($${offset + 1}, $${offset + 2}, $${offset + 3}, $${offset + 4}, $${offset + 5}, $${offset + 6}, $${offset + 7}, $${offset + 8}, $${offset + 9}, $${offset + 10}::jsonb)`);
  });

  await client.query(
    `INSERT INTO promotion_schedule_audit (
       schedule_id,
       organization_id,
       action_type,
       enrollment_id,
       enrolled_class_id,
       enrolled_student_id,
       student_id,
       class_id,
       subject_id,
       details_json
     )
     VALUES ${placeholders.join(', ')}`,
    values
  );
}

async function getPromotionAuditSummaryMap(scheduleIds = [], organizationId) {
  const normalizedScheduleIds = Array.isArray(scheduleIds)
    ? [...new Set(scheduleIds.map(Number).filter(Number.isFinite))]
    : [];
  if (!normalizedScheduleIds.length) {
    return new Map();
  }

  await ensurePromotionAuditSchema();

  const result = await db.query(
    `SELECT schedule_id, action_type, details_json, created_at
     FROM promotion_schedule_audit
     WHERE organization_id = $1
       AND schedule_id = ANY($2::int[])
     ORDER BY id ASC`,
    [organizationId, normalizedScheduleIds]
  );

  const map = new Map();
  normalizedScheduleIds.forEach((scheduleId) => {
    map.set(scheduleId, {
      available: false,
      counts: {
        enrollmentsCreated: 0,
        classesAttached: 0,
        studentsEnrolled: 0,
        subjectsAdded: 0,
      },
      actions: [],
    });
  });

  result.rows.forEach((row) => {
    const scheduleId = Number(row.schedule_id);
    if (!map.has(scheduleId)) return;
    const entry = map.get(scheduleId);
    entry.available = true;
    const details = row.details_json && typeof row.details_json === 'object' ? row.details_json : {};
    const actionType = String(row.action_type || 'action');
    if (actionType === 'enrollment_created') entry.counts.enrollmentsCreated += 1;
    if (actionType === 'class_attached') entry.counts.classesAttached += 1;
    if (actionType === 'student_enrolled') entry.counts.studentsEnrolled += 1;
    if (actionType === 'subject_added') entry.counts.subjectsAdded += 1;
    entry.actions.push({
      actionType,
      createdAt: row.created_at,
      details,
    });
  });

  return map;
}

async function notifyPromotionManagersAndSupervisors({ orgId, scheduleId, targetTermId, targetSchoolYearId, enrolledCount, totalEligible }) {
  const normalizedOrgId = Number(orgId || 0);
  if (!normalizedOrgId) return;

  const [recipientResult, targetMetaResult, classesResult] = await Promise.all([
    db.query(
      `SELECT DISTINCT user_id
       FROM users
       WHERE organization_id = $1
         AND COALESCE(on_hold, FALSE) = FALSE
         AND LOWER(TRIM(account_type::text)) IN ('manager', 'supervisor')`,
      [normalizedOrgId]
    ),
    db.query(
      `SELECT t.term_name, sy.year_label
       FROM terms t
       JOIN school_years sy ON sy.id = t.school_year_id
       WHERE t.term_id = $1
         AND sy.id = $2
         AND t.organization_id = $3
       LIMIT 1`,
      [targetTermId, targetSchoolYearId, normalizedOrgId]
    ),
    db.query(
      `SELECT c.class_name
       FROM promotion_schedule_classes psc
       JOIN classes c ON c.class_id = psc.class_id
       WHERE psc.schedule_id = $1
       ORDER BY COALESCE(c.dashboard_sort_order, 2147483647), c.class_name ASC, c.class_id ASC`,
      [scheduleId]
    ),
  ]);

  const recipientIds = new Set(
    recipientResult.rows
      .map((row) => Number(row.user_id))
      .filter((value) => Number.isFinite(value) && value > 0)
  );
  recipientIds.add(0);

  const targetMeta = targetMetaResult.rows[0] || {};
  const targetLabel = [targetMeta.year_label, targetMeta.term_name].filter(Boolean).join(' - ') || 'the selected target term';
  const classLabel = classesResult.rows.length
    ? classesResult.rows.map((row) => row.class_name).filter(Boolean).join(', ')
    : 'selected classes';

  await notifSvc.createNotifications(db, Array.from(recipientIds).map((recipientId) => ({
    orgId: normalizedOrgId,
    recipientType: 'staff',
    recipientId,
    type: 'promotion_completed',
    title: 'Promotion completed',
    body: `${enrolledCount} of ${totalEligible} eligible student(s) were promoted into ${targetLabel} for ${classLabel}.`,
    link: '/promotion/apply',
    refId: Number(scheduleId) || null,
  })));
}

async function ensurePromotionSubjectSelectionSchema() {
  if (promotionSubjectSelectionSchemaReady) return;

  await db.query(`
    CREATE TABLE IF NOT EXISTS promotion_subject_selections (
      id SERIAL PRIMARY KEY,
      organization_id INT NOT NULL REFERENCES organizations(organization_id) ON DELETE CASCADE,
      term_id INT NOT NULL REFERENCES terms(term_id) ON DELETE CASCADE,
      student_id INT NOT NULL REFERENCES students(student_id) ON DELETE CASCADE,
      subject_id INT NOT NULL REFERENCES subjects(subject_id) ON DELETE CASCADE,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      UNIQUE (organization_id, term_id, student_id, subject_id)
    )
  `);

  promotionSubjectSelectionSchemaReady = true;
}

async function ensurePromotionScheduleRetrySchema() {
  if (promotionScheduleRetrySchemaReady) return;

  await db.query(`
    ALTER TABLE promotion_schedule
      ADD COLUMN IF NOT EXISTS apply_attempt_count INTEGER NOT NULL DEFAULT 0,
      ADD COLUMN IF NOT EXISTS max_apply_attempts INTEGER NOT NULL DEFAULT 4,
      ADD COLUMN IF NOT EXISTS next_retry_at TIMESTAMP,
      ADD COLUMN IF NOT EXISTS last_attempt_at TIMESTAMP,
      ADD COLUMN IF NOT EXISTS last_error TEXT,
      ADD COLUMN IF NOT EXISTS failed_at TIMESTAMP
  `);

  promotionScheduleRetrySchemaReady = true;
}

function getRetryDelayExpressionForAttempt(attemptCount) {
  if (attemptCount === 1) return "INTERVAL '3 minutes'";
  if (attemptCount === 2) return "INTERVAL '1 hour'";
  if (attemptCount === 3) return "INTERVAL '1 day'";
  return null;
}

async function markPromotionAttemptStarted(scheduleId, organizationId) {
  const result = await db.query(
    `UPDATE promotion_schedule
     SET apply_attempt_count = COALESCE(apply_attempt_count, 0) + 1,
         last_attempt_at = CURRENT_TIMESTAMP
     WHERE id = $1 AND organization_id = $2
     RETURNING apply_attempt_count, COALESCE(max_apply_attempts, 4) AS max_apply_attempts`,
    [scheduleId, organizationId]
  );

  return result.rows[0] || null;
}

async function markPromotionAttemptSuccess(scheduleId, organizationId) {
  await db.query(
    `UPDATE promotion_schedule
     SET next_retry_at = NULL,
         last_error = NULL,
         failed_at = NULL
     WHERE id = $1 AND organization_id = $2`,
    [scheduleId, organizationId]
  );
}

async function markPromotionAttemptFailure({ scheduleId, organizationId, attemptCount, maxAttempts, reason }) {
  const normalizedReason = String(reason || "Promotion apply failed.").slice(0, 1000);
  const retryDelayExpression = getRetryDelayExpressionForAttempt(attemptCount);

  if (!retryDelayExpression || attemptCount >= maxAttempts) {
    await db.query(
      `UPDATE promotion_schedule
       SET status = 'failed',
           next_retry_at = NULL,
           failed_at = CURRENT_TIMESTAMP,
           last_error = $3
       WHERE id = $1 AND organization_id = $2`,
      [scheduleId, organizationId, normalizedReason]
    );
    return { willRetry: false, message: normalizedReason };
  }

  await db.query(
    `UPDATE promotion_schedule
     SET status = 'scheduled',
         next_retry_at = CURRENT_TIMESTAMP + ${retryDelayExpression},
         last_error = $3
     WHERE id = $1 AND organization_id = $2`,
    [scheduleId, organizationId, normalizedReason]
  );

  const retryMessage = attemptCount === 1
    ? 'First attempt failed. Will retry in about 3 minutes.'
    : attemptCount === 2
      ? 'Second attempt failed. Will retry in about 1 hour.'
      : 'Third attempt failed. Will retry in about 1 day.';

  return { willRetry: true, message: `${normalizedReason} ${retryMessage}` };
}

async function executePromotionWithRetryPolicy(promo) {
  const scheduleId = Number(promo?.id);
  const organizationId = Number(promo?.organization_id);
  if (!Number.isFinite(scheduleId) || !Number.isFinite(organizationId)) {
    return { success: false, reason: "Invalid promotion schedule context.", willRetry: false };
  }

  await ensurePromotionScheduleRetrySchema();

  const attemptMeta = await markPromotionAttemptStarted(scheduleId, organizationId);
  if (!attemptMeta) {
    return { success: false, reason: "Promotion schedule not found for retry processing.", willRetry: false };
  }

  const attemptCount = Number(attemptMeta.apply_attempt_count) || 1;
  const maxAttempts = Number(attemptMeta.max_apply_attempts) || 4;

  try {
    const result = await module.exports._applyPromotionCore(promo);
    if (result.success) {
      await markPromotionAttemptSuccess(scheduleId, organizationId);
      return { ...result, attemptCount, maxAttempts, willRetry: false };
    }

    const failureState = await markPromotionAttemptFailure({
      scheduleId,
      organizationId,
      attemptCount,
      maxAttempts,
      reason: result.reason || "Promotion apply failed.",
    });

    return {
      success: false,
      reason: failureState.message,
      attemptCount,
      maxAttempts,
      willRetry: failureState.willRetry,
    };
  } catch (error) {
    const failureState = await markPromotionAttemptFailure({
      scheduleId,
      organizationId,
      attemptCount,
      maxAttempts,
      reason: error?.message || "Promotion apply crashed.",
    });

    return {
      success: false,
      reason: failureState.message,
      attemptCount,
      maxAttempts,
      willRetry: failureState.willRetry,
    };
  }
}

function normalizeClassIds(input) {
  if (Array.isArray(input)) {
    return input.map(Number).filter(Number.isFinite);
  }
  if (typeof input === "string") {
    return input
      .split(",")
      .map((value) => Number(String(value).trim()))
      .filter(Number.isFinite);
  }
  const singleValue = Number(input);
  return Number.isFinite(singleValue) ? [singleValue] : [];
}

function extractPromotionOverrideMap(payload = {}) {
  return Object.entries(payload).reduce((accumulator, [key, value]) => {
    const match = /^promotionOverride_(\d+)$/.exec(String(key || ""));
    if (!match) return accumulator;
    const studentId = Number(match[1]);
    const classId = Number(value);
    if (Number.isFinite(studentId) && Number.isFinite(classId)) {
      accumulator[studentId] = classId;
    }
    return accumulator;
  }, {});
}

function extractPromotionSubjectSelectionPayload(payload = {}) {
  const subjectSelections = {};
  const touchedStudentIds = new Set();

  Object.entries(payload || {}).forEach(([key, value]) => {
    const touchedMatch = /^promotionSubjectTouched_(\d+)$/.exec(String(key || ""));
    if (touchedMatch) {
      const studentId = Number(touchedMatch[1]);
      if (Number.isFinite(studentId)) {
        touchedStudentIds.add(studentId);
      }
      return;
    }

    const selectionMatch = /^promotionSubject_(\d+)$/.exec(String(key || ""));
    if (!selectionMatch) return;

    const studentId = Number(selectionMatch[1]);
    if (!Number.isFinite(studentId)) return;

    const rawValues = Array.isArray(value) ? value : [value];
    const subjectIds = [...new Set(rawValues
      .map((item) => Number(item))
      .filter(Number.isFinite))];

    subjectSelections[studentId] = subjectIds;
    touchedStudentIds.add(studentId);
  });

  touchedStudentIds.forEach((studentId) => {
    if (!Object.prototype.hasOwnProperty.call(subjectSelections, studentId)) {
      subjectSelections[studentId] = [];
    }
  });

  return {
    subjectSelections,
    touchedStudentIds: Array.from(touchedStudentIds),
  };
}

function buildPromotionOptionList(row) {
  const optionMap = new Map();

  [
    {
      classId: row.promoted_class_id,
      className: row.promoted_class_name,
      label: "Promoted"
    },
    {
      classId: row.repeated_class_id,
      className: row.repeated_class_name,
      label: "Repeated"
    },
    {
      classId: row.promotion_class_id,
      className: row.assigned_class_name,
      label: "Assigned"
    }
  ].forEach((option) => {
    const classId = Number(option.classId);
    if (!Number.isFinite(classId) || optionMap.has(classId)) return;
    optionMap.set(classId, {
      classId,
      className: option.className || `Class ${classId}`,
      label: option.label
    });
  });

  return Array.from(optionMap.values());
}

async function fetchPromotionPreviewRows(organizationId, termId, classIds = []) {
  const normalizedTermId = Number(termId);
  if (!Number.isFinite(normalizedTermId)) {
    return [];
  }

  const studentIdSettings = await getOrganizationStudentIdSettings(db, organizationId);

  const normalizedClassIds = Array.isArray(classIds)
    ? classIds.map(Number).filter(Number.isFinite)
    : [];
  if (!normalizedClassIds.length) {
    return [];
  }

  const classMetaResult = await db.query(
    `SELECT class_id, class_name
     FROM classes
     WHERE organization_id = $1
       AND class_id = ANY($2::int[])`,
    [organizationId, normalizedClassIds]
  );
  const classMetaMap = new Map(
    classMetaResult.rows.map((row) => [Number(row.class_id), row.class_name || `Class ${row.class_id}`])
  );

  const enrolledCountResult = await db.query(
    `SELECT es.class_id, COUNT(DISTINCT es.student_id)::int AS total_students
     FROM enrolled_students es
     JOIN enrollments e ON e.enrollment_id = es.enrollment_id
     JOIN students s ON s.student_id = es.student_id
     WHERE e.organization_id = $1
       AND e.term_id = $2
       AND s.organization_id = $1
       AND COALESCE(s.graduated, FALSE) = FALSE
       AND es.class_id = ANY($3::int[])
     GROUP BY es.class_id`,
    [organizationId, normalizedTermId, normalizedClassIds]
  );
  const enrolledCountMap = new Map(
    enrolledCountResult.rows.map((row) => [Number(row.class_id), Number(row.total_students) || 0])
  );

  const params = [organizationId, normalizedTermId, normalizedClassIds];

  const result = await db.query(
    `SELECT
      sr.student_id,
      sr.class_id AS current_class_id,
      sr.promotion_status,
      sr.promotion_class_id,
      s.custom_student_id,
      COALESCE(NULLIF(TRIM(s.last_name || ', ' || s.first_name), ','), TRIM(CONCAT_WS(' ', s.first_name, s.last_name)), CONCAT('Student ', sr.student_id::text)) AS student_name,
      cc.class_name AS current_class_name,
      assigned.class_name AS assigned_class_name,
      CASE
        WHEN NULLIF(TRIM(ss.promoted_class::text), '') ~ '^\\d+$'
          THEN TRIM(ss.promoted_class::text)::int
        ELSE NULL
      END AS promoted_class_id,
      promoted.class_name AS promoted_class_name,
      CASE
        WHEN NULLIF(TRIM(ss.repeated_class::text), '') ~ '^\\d+$'
          THEN TRIM(ss.repeated_class::text)::int
        ELSE NULL
      END AS repeated_class_id,
      repeated.class_name AS repeated_class_name
    FROM student_reports sr
    JOIN students s
      ON s.student_id = sr.student_id
      AND s.organization_id = sr.organization_id
      AND COALESCE(s.graduated, FALSE) = FALSE
    LEFT JOIN classes cc ON cc.class_id = sr.class_id
    LEFT JOIN status_settings ss
      ON ss.organization_id = sr.organization_id
      AND ss.term_id = sr.term_id
      AND ss.class_id = sr.class_id
    LEFT JOIN classes assigned ON assigned.class_id = sr.promotion_class_id
    LEFT JOIN classes promoted ON promoted.class_id = CASE
      WHEN NULLIF(TRIM(ss.promoted_class::text), '') ~ '^\\d+$'
        THEN TRIM(ss.promoted_class::text)::int
      ELSE NULL
    END
    LEFT JOIN classes repeated ON repeated.class_id = CASE
      WHEN NULLIF(TRIM(ss.repeated_class::text), '') ~ '^\\d+$'
        THEN TRIM(ss.repeated_class::text)::int
      ELSE NULL
    END
    WHERE sr.organization_id = $1
      AND sr.term_id = $2
      AND sr.class_id = ANY($3::int[])
      AND sr.promotion_status IN ('Promoted', 'Repeated')
      AND sr.promotion_class_id IS NOT NULL
      AND EXISTS (
        SELECT 1
        FROM enrollments e
        JOIN enrolled_students es
          ON es.enrollment_id = e.enrollment_id
         AND es.student_id = sr.student_id
         AND es.class_id = sr.class_id
        WHERE e.organization_id = sr.organization_id
          AND e.term_id = sr.term_id
      )
    ORDER BY cc.class_name ASC NULLS LAST, student_name ASC`,
    params
  );

  await ensurePromotionSubjectSelectionSchema();

  const allOptionClassIds = new Set();
  result.rows.forEach((row) => {
    const optionClassIds = buildPromotionOptionList(row).map((option) => Number(option.classId)).filter(Number.isFinite);
    optionClassIds.forEach((classId) => allOptionClassIds.add(classId));
    const assignedClassId = Number(row.promotion_class_id);
    if (Number.isFinite(assignedClassId)) {
      allOptionClassIds.add(assignedClassId);
    }
  });

  const classSubjectMap = new Map();
  if (allOptionClassIds.size > 0) {
    const subjectResult = await db.query(
      `SELECT class_id, subject_id, subject_name
       FROM subjects
       WHERE organization_id = $1 AND obsolete_at IS NULL
         AND class_id = ANY($2::int[])
       ORDER BY subject_name ASC, subject_id ASC`,
      [organizationId, Array.from(allOptionClassIds)]
    );

    subjectResult.rows.forEach((row) => {
      const classId = Number(row.class_id);
      if (!Number.isFinite(classId)) return;
      if (!classSubjectMap.has(classId)) {
        classSubjectMap.set(classId, []);
      }
      classSubjectMap.get(classId).push({
        subjectId: Number(row.subject_id),
        subjectName: row.subject_name || `Subject ${row.subject_id}`,
      });
    });
  }

  const previewStudentIds = [...new Set(result.rows.map((row) => Number(row.student_id)).filter(Number.isFinite))];
  const savedSubjectSelectionMap = new Map();
  if (previewStudentIds.length > 0) {
    const savedSelectionsResult = await db.query(
      `SELECT student_id, subject_id
       FROM promotion_subject_selections
       WHERE organization_id = $1
         AND term_id = $2
         AND student_id = ANY($3::int[])`,
      [organizationId, normalizedTermId, previewStudentIds]
    );

    savedSelectionsResult.rows.forEach((row) => {
      const studentId = Number(row.student_id);
      const subjectId = Number(row.subject_id);
      if (!Number.isFinite(studentId) || !Number.isFinite(subjectId)) return;
      if (!savedSubjectSelectionMap.has(studentId)) {
        savedSubjectSelectionMap.set(studentId, new Set());
      }
      savedSubjectSelectionMap.get(studentId).add(subjectId);
    });
  }

  const rowsByClassId = new Map();
  normalizedClassIds.forEach((classId) => {
    rowsByClassId.set(classId, []);
  });

  result.rows.forEach((row) => {
    const classId = Number(row.current_class_id);
    if (!rowsByClassId.has(classId)) {
      rowsByClassId.set(classId, []);
    }
    rowsByClassId.get(classId).push({
      studentId: row.student_id,
      studentName: row.student_name,
      displayStudentId: buildStudentDisplayId(row, studentIdSettings),
      displayStudentIdText: studentIdSettings && studentIdSettings.use_custom_student_id
        ? buildStudentDisplayId(row, studentIdSettings)
        : `#${buildStudentDisplayId(row, studentIdSettings)}`,
      currentClassId: row.current_class_id,
      currentClassName: row.current_class_name || "Unknown Class",
      promotionStatus: row.promotion_status,
      assignedClassId: row.promotion_class_id,
      assignedClassName: row.assigned_class_name || "Unknown Class",
      availableOptions: buildPromotionOptionList(row),
      classSubjectOptions: Object.fromEntries(
        buildPromotionOptionList(row).map((option) => {
          const classIdValue = Number(option.classId);
          const subjects = classSubjectMap.get(classIdValue) || [];
          return [String(classIdValue), subjects];
        })
      ),
      selectedSubjectIds: (() => {
        const studentId = Number(row.student_id);
        const assignedClassId = Number(row.promotion_class_id);
        const assignedClassSubjects = classSubjectMap.get(assignedClassId) || [];
        const savedSet = savedSubjectSelectionMap.get(studentId);
        if (!savedSet) {
          return assignedClassSubjects.map((subject) => Number(subject.subjectId)).filter(Number.isFinite);
        }
        return assignedClassSubjects
          .map((subject) => Number(subject.subjectId))
          .filter((subjectId) => Number.isFinite(subjectId) && savedSet.has(subjectId));
      })(),
    });
  });

  return normalizedClassIds.map((classId) => {
    const classStudents = rowsByClassId.get(classId) || [];
    const totalStudents = enrolledCountMap.get(classId) || 0;
    let state = "saved";
    let message = "";
    if (totalStudents === 0) {
      state = "no-students";
      message = "This class does not have any student record for the selected term.";
    } else if (classStudents.length === 0) {
      state = "unsaved";
      message = "Students exist in this class, but no saved promotion decision is available yet.";
    } else if (classStudents.length < totalStudents) {
      state = "partial";
      message = `Only ${classStudents.length} of ${totalStudents} students currently have saved promotion decisions.`;
    }

    return {
      classId,
      className: classMetaMap.get(classId) || `Class ${classId}`,
      totalStudents,
      savedStudents: classStudents.length,
      state,
      message,
      reportUrl: `/print/printStudentReport?classId=${classId}&termId=${normalizedTermId}`,
      students: classStudents,
    };
  });
}

async function savePromotionSubjectSelections({ organizationId, termId, subjectSelections, touchedStudentIds, overrides = {} }) {
  const normalizedTermId = Number(termId);
  if (!Number.isFinite(normalizedTermId)) {
    return 0;
  }

  const normalizedSelections = {};
  Object.entries(subjectSelections || {}).forEach(([studentIdText, rawSubjectIds]) => {
    const studentId = Number(studentIdText);
    if (!Number.isFinite(studentId)) return;
    const ids = Array.isArray(rawSubjectIds) ? rawSubjectIds : [rawSubjectIds];
    normalizedSelections[studentId] = [...new Set(ids.map((value) => Number(value)).filter(Number.isFinite))];
  });

  const studentIdSet = new Set(
    Object.keys(normalizedSelections).map(Number).filter(Number.isFinite)
  );
  (Array.isArray(touchedStudentIds) ? touchedStudentIds : []).forEach((studentId) => {
    const parsed = Number(studentId);
    if (Number.isFinite(parsed)) {
      studentIdSet.add(parsed);
      if (!Object.prototype.hasOwnProperty.call(normalizedSelections, parsed)) {
        normalizedSelections[parsed] = [];
      }
    }
  });

  const studentIds = Array.from(studentIdSet);
  if (!studentIds.length) {
    return 0;
  }

  await ensurePromotionSubjectSelectionSchema();

  const overrideValues = [];
  const overridePlaceholders = [];
  Object.entries(overrides || {}).forEach(([studentIdText, classIdValue]) => {
    const studentId = Number(studentIdText);
    const classId = Number(classIdValue);
    if (!Number.isFinite(studentId) || !Number.isFinite(classId)) return;
    const offset = overrideValues.length;
    overrideValues.push(studentId, classId);
    overridePlaceholders.push(`($${offset + 1}::int, $${offset + 2}::int)`);
  });

  const effectiveClassQuery = overridePlaceholders.length
    ? `
      SELECT sr.student_id, COALESCE(ov.class_id, sr.promotion_class_id) AS effective_class_id
      FROM student_reports sr
      LEFT JOIN (VALUES ${overridePlaceholders.join(", ")}) AS ov(student_id, class_id)
        ON ov.student_id = sr.student_id
      JOIN students s
        ON s.student_id = sr.student_id
       AND s.organization_id = sr.organization_id
       AND COALESCE(s.graduated, FALSE) = FALSE
      WHERE sr.organization_id = $${overrideValues.length + 1}
        AND sr.term_id = $${overrideValues.length + 2}
        AND sr.student_id = ANY($${overrideValues.length + 3}::int[])
        AND sr.promotion_status IN ('Promoted', 'Repeated')
        AND COALESCE(ov.class_id, sr.promotion_class_id) IS NOT NULL
        AND EXISTS (
          SELECT 1
          FROM enrollments e
          JOIN enrolled_students es
            ON es.enrollment_id = e.enrollment_id
           AND es.student_id = sr.student_id
           AND es.class_id = sr.class_id
          WHERE e.organization_id = sr.organization_id
            AND e.term_id = sr.term_id
        )
    `
    : `
      SELECT sr.student_id, sr.promotion_class_id AS effective_class_id
      FROM student_reports sr
      JOIN students s
        ON s.student_id = sr.student_id
       AND s.organization_id = sr.organization_id
       AND COALESCE(s.graduated, FALSE) = FALSE
      WHERE sr.organization_id = $1
        AND sr.term_id = $2
        AND sr.student_id = ANY($3::int[])
        AND sr.promotion_status IN ('Promoted', 'Repeated')
        AND sr.promotion_class_id IS NOT NULL
        AND EXISTS (
          SELECT 1
          FROM enrollments e
          JOIN enrolled_students es
            ON es.enrollment_id = e.enrollment_id
           AND es.student_id = sr.student_id
           AND es.class_id = sr.class_id
          WHERE e.organization_id = sr.organization_id
            AND e.term_id = sr.term_id
        )
    `;

  const effectiveClassParams = overridePlaceholders.length
    ? [...overrideValues, organizationId, normalizedTermId, studentIds]
    : [organizationId, normalizedTermId, studentIds];

  const effectiveClassResult = await db.query(effectiveClassQuery, effectiveClassParams);
  const effectiveClassByStudent = new Map();
  const effectiveClassIds = new Set();
  effectiveClassResult.rows.forEach((row) => {
    const studentId = Number(row.student_id);
    const classId = Number(row.effective_class_id);
    if (!Number.isFinite(studentId) || !Number.isFinite(classId)) return;
    effectiveClassByStudent.set(studentId, classId);
    effectiveClassIds.add(classId);
  });

  const allowedSubjectsByClass = new Map();
  if (effectiveClassIds.size > 0) {
    const subjectResult = await db.query(
      `SELECT class_id, subject_id
       FROM subjects
       WHERE organization_id = $1
         AND class_id = ANY($2::int[])`,
      [organizationId, Array.from(effectiveClassIds)]
    );
    subjectResult.rows.forEach((row) => {
      const classId = Number(row.class_id);
      const subjectId = Number(row.subject_id);
      if (!Number.isFinite(classId) || !Number.isFinite(subjectId)) return;
      if (!allowedSubjectsByClass.has(classId)) {
        allowedSubjectsByClass.set(classId, new Set());
      }
      allowedSubjectsByClass.get(classId).add(subjectId);
    });
  }

  let touchedAndEligibleCount = 0;
  const insertRows = [];
  studentIds.forEach((studentId) => {
    const effectiveClassId = effectiveClassByStudent.get(studentId);
    if (!Number.isFinite(effectiveClassId)) return;
    touchedAndEligibleCount += 1;

    const allowedSet = allowedSubjectsByClass.get(effectiveClassId) || new Set();
    const selectedIds = (normalizedSelections[studentId] || []).filter((subjectId) => allowedSet.has(subjectId));

    selectedIds.forEach((subjectId) => {
      insertRows.push({ studentId, subjectId });
    });
  });

  if (touchedAndEligibleCount === 0) {
    return 0;
  }

  const client = await db.connect();
  try {
    await client.query('BEGIN');
    await client.query(
      `DELETE FROM promotion_subject_selections
       WHERE organization_id = $1
         AND term_id = $2
         AND student_id = ANY($3::int[])`,
      [organizationId, normalizedTermId, Array.from(effectiveClassByStudent.keys())]
    );

    if (insertRows.length > 0) {
      const values = [];
      const placeholders = [];
      insertRows.forEach((row, index) => {
        const offset = index * 4;
        values.push(organizationId, normalizedTermId, row.studentId, row.subjectId);
        placeholders.push(`($${offset + 1}, $${offset + 2}, $${offset + 3}, $${offset + 4})`);
      });

      await client.query(
        `INSERT INTO promotion_subject_selections (organization_id, term_id, student_id, subject_id)
         VALUES ${placeholders.join(', ')}
         ON CONFLICT (organization_id, term_id, student_id, subject_id)
         DO UPDATE SET updated_at = CURRENT_TIMESTAMP`,
        values
      );
    }

    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }

  return insertRows.length;
}

async function applyPromotionOverrides({ organizationId, termId, overrides }) {
  const studentIds = Object.keys(overrides || {})
    .map(Number)
    .filter(Number.isFinite);
  if (!Number.isFinite(Number(termId)) || studentIds.length === 0) {
    return 0;
  }

  const values = [];
  const placeholders = [];
  studentIds.forEach((studentId, index) => {
    const classId = Number(overrides[studentId]);
    if (!Number.isFinite(classId)) return;
    const offset = values.length;
    values.push(studentId, classId);
    placeholders.push(`($${offset + 1}::int, $${offset + 2}::int)`);
  });

  if (placeholders.length === 0) {
    return 0;
  }

  const query = `
    UPDATE student_reports sr
    SET promotion_class_id = data.class_id,
        updated_at = CURRENT_TIMESTAMP
    FROM (VALUES ${placeholders.join(", ")}) AS data(student_id, class_id)
    WHERE sr.organization_id = $${values.length + 1}
      AND sr.term_id = $${values.length + 2}
      AND sr.student_id = data.student_id
      AND sr.promotion_status IN ('Promoted', 'Repeated')
      AND EXISTS (
        SELECT 1
        FROM students s
        WHERE s.student_id = sr.student_id
          AND s.organization_id = sr.organization_id
          AND COALESCE(s.graduated, FALSE) = FALSE
      )
      AND EXISTS (
        SELECT 1
        FROM enrollments e
        JOIN enrolled_students es
          ON es.enrollment_id = e.enrollment_id
         AND es.student_id = sr.student_id
         AND es.class_id = sr.class_id
        WHERE e.organization_id = sr.organization_id
          AND e.term_id = sr.term_id
      )
  `;

  const result = await db.query(query, [...values, organizationId, Number(termId)]);
  return result.rowCount || 0;
}

module.exports = {
  // Page to view and schedule promotions
  applyPromotionPage: async (req, res) => {
    const organizationId = req.session.organizationId;
    const isEmbedded = isEmbeddedRequest(req, "applyPromotion");

    try {
      await ensurePromotionScheduleRetrySchema();

      const currentTermResult = await db.query(
        `SELECT * FROM terms WHERE current = true AND organization_id = $1`,
        [organizationId]
      );

      const currentSchoolYearResult = await db.query(
        `SELECT id AS school_year_id, year_label AS label FROM school_years WHERE current = true AND organization_id = $1`,
        [organizationId]
      );

      const allTermsResult = await db.query(
        `SELECT term_id, school_year_id, term_name FROM terms WHERE organization_id = $1 ORDER BY start_date`,
        [organizationId]
      );

      const allYearsResult = await db.query(
        `SELECT id AS school_year_id, year_label AS label FROM school_years WHERE organization_id = $1 ORDER BY created_at DESC`,
        [organizationId]
      );

      const structuredYears = allYearsResult.rows.map(year => ({
        ...year,
        terms: allTermsResult.rows.filter(t => t.school_year_id === year.school_year_id)
      }));

      const classesResult = await db.query(
        `SELECT class_id, class_name FROM classes WHERE organization_id = $1 AND obsolete_at IS NULL ORDER BY COALESCE(dashboard_sort_order, 2147483647), class_name ASC, class_id ASC`,
        [organizationId]
      );

      const scheduleResult = await db.query(
        `SELECT * FROM promotion_schedule WHERE organization_id = $1 ORDER BY scheduled_date DESC`,
        [organizationId]
      );

      // Fetch classes for each schedule
      const schedules = await Promise.all(scheduleResult.rows.map(async (schedule) => {
        const scheduleClasses = await db.query(
          `SELECT c.class_name FROM promotion_schedule_classes psc
           JOIN classes c ON psc.class_id = c.class_id
           WHERE psc.schedule_id = $1`,
          [schedule.id]
        );
        return {
          ...schedule,
          classes: scheduleClasses.rows.map(row => row.class_name)
        };
      }));

      const auditMap = await getPromotionAuditSummaryMap(
        schedules.map((schedule) => Number(schedule.id)).filter(Number.isFinite),
        organizationId
      );

      const schedulesWithAudit = schedules.map((schedule) => {
        const auditTrail = auditMap.get(Number(schedule.id)) || {
          available: false,
          counts: {
            enrollmentsCreated: 0,
            classesAttached: 0,
            studentsEnrolled: 0,
            subjectsAdded: 0,
          },
          actions: [],
        };

        return {
          ...schedule,
          auditTrail,
          canReverseExact: String(schedule.status || '').toLowerCase() === 'completed' && auditTrail.available,
        };
      });

      res.render("promotion/applyPromotion", {
        title: "Promotion Scheduler",
        isEmbedded,
        hideGlobalHeader: isEmbedded,
        hideGlobalFooter: isEmbedded,
        hideGlobalChatbot: isEmbedded,
        currentTerm: currentTermResult.rows[0],
        currentSchoolYear: currentSchoolYearResult.rows[0],
        allTerms: allTermsResult.rows,
        allYears: structuredYears,
        allClasses: classesResult.rows,
        schedules: schedulesWithAudit,
        messages: req.flash(),
        success_msg: req.flash("success_msg"),
        error_msg: req.flash("error_msg")
      });
    } catch (err) {
      console.error("❌ Failed to load promotion scheduling page:", err);
      res.status(500).send("Failed to load promotion scheduling.");
    }
  },

  getPromotionPreview: async (req, res) => {
    const organizationId = req.session.organizationId;
    const termId = Number(req.query.termId);
    const classIds = normalizeClassIds(req.query.classIds);

    try {
      if (!Number.isFinite(termId)) {
        return res.json({ success: true, students: [] });
      }

      const classes = await fetchPromotionPreviewRows(organizationId, termId, classIds);
      return res.json({ success: true, classes });
    } catch (error) {
      return res.status(500).json({ success: false, error: "Failed to load promotion preview." });
    }
  },

  savePromotionPreviewOverrides: async (req, res) => {
    const organizationId = req.session.organizationId;
    const termId = Number(req.body.termId);
    const overrides = req.body && typeof req.body.overrides === "object" && req.body.overrides !== null
      ? req.body.overrides
      : extractPromotionOverrideMap(req.body);
    const payloadSubjectSelections = req.body && typeof req.body.subjectSelections === "object" && req.body.subjectSelections !== null
      ? req.body.subjectSelections
      : null;
    const payloadTouchedStudentIds = Array.isArray(req.body?.touchedStudentIds)
      ? req.body.touchedStudentIds
      : [];
    const parsedSubjectPayload = extractPromotionSubjectSelectionPayload(req.body);
    const subjectSelections = payloadSubjectSelections || parsedSubjectPayload.subjectSelections;
    const touchedStudentIds = payloadTouchedStudentIds.length
      ? payloadTouchedStudentIds
      : parsedSubjectPayload.touchedStudentIds;

    try {
      const [updatedCount, subjectSelectionCount] = await Promise.all([
        applyPromotionOverrides({
          organizationId,
          termId,
          overrides,
        }),
        savePromotionSubjectSelections({
          organizationId,
          termId,
          subjectSelections,
          touchedStudentIds,
          overrides,
        }),
      ]);

      return res.json({ success: true, updatedCount, subjectSelectionCount });
    } catch (error) {
      return res.status(500).json({ success: false, error: "Failed to save promotion decisions." });
    }
  },

  // Schedule a promotion
  schedulePromotion: async (req, res) => {
    const {
      fromSchoolYearId,
      fromTermId,
      targetYearId,
      targetTermId,
      scheduledDate,
      classIds,
      applyMode
    } = req.body;
    const organizationId = req.session.organizationId;
    const normalizedApplyMode = applyMode === 'applyNow' ? 'applyNow' : 'scheduleLater';
    const selectedClassIds = Array.isArray(classIds)
      ? classIds.map(Number).filter(Boolean)
      : (classIds ? [Number(classIds)].filter(Boolean) : []);
    const promotionOverrides = extractPromotionOverrideMap(req.body);
    const parsedSubjectPayload = extractPromotionSubjectSelectionPayload(req.body);

    const normalizedTargetTermId = Number(targetTermId);
    const normalizedTargetYearId = Number(targetYearId);

    if (!Number.isFinite(normalizedTargetTermId)) {
      req.flash("error", "Please select a target term before scheduling or applying promotion.");
      return res.redirect("/promotion/apply");
    }

    if (!Number.isFinite(normalizedTargetYearId)) {
      req.flash("error", "Please select a target school year before scheduling or applying promotion.");
      return res.redirect("/promotion/apply");
    }
  
    try {
      await ensurePromotionScheduleRetrySchema();

      const targetTermOwnershipCheck = await db.query(
        `SELECT 1
         FROM terms
         WHERE term_id = $1
           AND school_year_id = $2
           AND organization_id = $3
         LIMIT 1`,
        [normalizedTargetTermId, normalizedTargetYearId, organizationId]
      );

      if (!targetTermOwnershipCheck.rows.length) {
        req.flash("error", "Selected target term is invalid for the chosen school year.");
        return res.redirect("/promotion/apply");
      }

      await applyPromotionOverrides({
        organizationId,
        termId: fromTermId,
        overrides: promotionOverrides,
      });

      await savePromotionSubjectSelections({
        organizationId,
        termId: fromTermId,
        subjectSelections: parsedSubjectPayload.subjectSelections,
        touchedStudentIds: parsedSubjectPayload.touchedStudentIds,
        overrides: promotionOverrides,
      });

      // 0️⃣ Block duplicate schedule/apply for the same source -> target combination
      const existingSchedule = await db.query(`
        SELECT id, status FROM promotion_schedule
        WHERE organization_id = $1
          AND current_term_id = $2 AND current_school_year_id = $3
          AND target_term_id = $4 AND target_school_year_id = $5
          AND status IN ('scheduled', 'completed')
        ORDER BY id DESC
        LIMIT 1
      `, [
        organizationId,
        fromTermId,
        fromSchoolYearId,
        normalizedTargetTermId,
        normalizedTargetYearId
      ]);
  
      if (existingSchedule.rows.length > 0) {
        const existingStatus = String(existingSchedule.rows[0].status || '').toLowerCase();
        if (existingStatus === 'completed') {
          req.flash("error", "This promotion has already been applied for the selected source and target terms.");
        } else {
          req.flash("error", "This promotion is already scheduled for the selected source and target terms.");
        }
        return res.redirect("/promotion/apply");
      }
  
      // 1️⃣ Fetch students intended for promotion
      const promotedStudentsResult = await db.query(`
        SELECT sr.student_id, sr.promotion_class_id
        FROM student_reports sr
        JOIN students s
          ON s.student_id = sr.student_id
          AND s.organization_id = sr.organization_id
          AND COALESCE(s.graduated, FALSE) = FALSE
        WHERE sr.organization_id = $1 AND sr.term_id = $2
          AND sr.promotion_status IN ('Promoted', 'Repeated')
          AND sr.promotion_class_id IS NOT NULL
          AND EXISTS (
            SELECT 1
            FROM enrollments e
            JOIN enrolled_students es
              ON es.enrollment_id = e.enrollment_id
             AND es.student_id = sr.student_id
             AND es.class_id = sr.class_id
            WHERE e.organization_id = sr.organization_id
              AND e.term_id = sr.term_id
          )
      `, [organizationId, fromTermId]);
  
      const studentsToPromote = promotedStudentsResult.rows;
      if (studentsToPromote.length === 0) {
        req.flash("error", "No students eligible for promotion.");
        return res.redirect("/promotion/apply");
      }
  
      // 2️⃣ Check for already applied promotion pairs
      const enrollmentResult = await db.query(`
        SELECT enrollment_id FROM enrollments
        WHERE term_id = $1 AND school_year_id = $2 AND organization_id = $3
      `, [normalizedTargetTermId, normalizedTargetYearId, organizationId]);
  
      let existingPairs = new Set();
      if (enrollmentResult.rows.length > 0) {
        const enrollmentId = enrollmentResult.rows[0].enrollment_id;
  
        const existingPromotions = await db.query(`
          SELECT student_id, class_id FROM enrolled_students
          WHERE enrollment_id = $1 AND added_by_promotion = TRUE
        `, [enrollmentId]);
  
        existingPairs = new Set(
          existingPromotions.rows.map(r => `${r.student_id}-${r.class_id}`)
        );
      }
  
      // 3️⃣ Filter out already-applied students
      const newPromotionPairs = studentsToPromote.filter(
        row => !existingPairs.has(`${row.student_id}-${row.promotion_class_id}`)
      );
  
      if (newPromotionPairs.length === 0) {
        req.flash("error", "This promotion you're trying to schedule has either already been scheduled or applied. No new changes detected.");
        return res.redirect("/promotion/apply");
      }
  
      // 4️⃣ Insert the schedule
      const effectiveScheduleDate = normalizedApplyMode === 'applyNow'
        ? new Date()
        : new Date(scheduledDate);

      if (normalizedApplyMode === 'scheduleLater' && Number.isNaN(effectiveScheduleDate.getTime())) {
        req.flash("error", "Please select a valid schedule date.");
        return res.redirect("/promotion/apply");
      }

      const scheduleInsertResult = await db.query(`
        INSERT INTO promotion_schedule (
          organization_id, current_school_year_id, current_term_id,
          target_school_year_id, target_term_id, scheduled_date, status
        )
        VALUES ($1, $2, $3, $4, $5, $6, 'scheduled')
        RETURNING id
      `, [
        organizationId,
        fromSchoolYearId,
        fromTermId,
        normalizedTargetYearId,
        normalizedTargetTermId,
        effectiveScheduleDate
      ]);
  
      const scheduleId = scheduleInsertResult.rows[0].id;
  
      // 5️⃣ Insert selected classes (if any)
      if (selectedClassIds.length > 0) {
        await db.query(`
          INSERT INTO promotion_schedule_classes (schedule_id, class_id, organization_id)
          SELECT $1, unnest($2::int[]), $3
        `, [scheduleId, selectedClassIds, organizationId]);
      }

      if (normalizedApplyMode === 'applyNow') {
        const justCreated = await db.query(
          `SELECT * FROM promotion_schedule WHERE id = $1 AND organization_id = $2`,
          [scheduleId, organizationId]
        );

        const result = await executePromotionWithRetryPolicy(justCreated.rows[0]);
        if (result.success) {
          req.flash("success", `Promotion applied! ${result.enrolledCount} students enrolled into their new classes.`);
        } else {
          req.flash("error", result.willRetry
            ? `${result.reason} Next retry will run automatically based on retry policy.`
            : `${result.reason} Retry attempts exhausted.`);
        }
      } else {
        req.flash("success", "Promotion scheduled successfully.");
      }

      res.redirect("/promotion/apply");
  
    } catch (err) {
      console.error("[Promotion] schedulePromotion failed:", err);
      const detailedMessage = err && err.message ? String(err.message) : "Failed to schedule promotion.";
      req.flash("error", process.env.NODE_ENV === 'development'
        ? `Failed to schedule promotion. ${detailedMessage}`
        : "Failed to schedule promotion.");
      res.redirect("/promotion/apply");
    }
  },
  
    
      
  // Cancel a scheduled promotion
  cancelScheduledPromotion: async (req, res) => {
    const organizationId = req.session.organizationId;
    const scheduleId = req.body.scheduleId;

    try {
      await db.query(
        `DELETE FROM promotion_schedule_classes WHERE schedule_id = $1`,
        [scheduleId]
      );

      await db.query(
        `DELETE FROM promotion_schedule WHERE id = $1 AND organization_id = $2`,
        [scheduleId, organizationId]
      );

      req.flash("success_msg", "Scheduled promotion has been deleted.");
      res.redirect("/promotion/apply");
    } catch (err) {
            req.flash("error_msg", "Failed to delete promotion.");
      res.redirect("/promotion/apply");
    }
  },

  reverseAppliedPromotion: async (req, res) => {
    const organizationId = req.session.organizationId;
    const scheduleId = req.body.scheduleId;
  
    let client;
    try {
      await ensurePromotionAuditSchema();
      client = await db.connect();
      await client.query('BEGIN');

      // 1️⃣ Get the promotion schedule to reverse
      const scheduleResult = await client.query(
        `SELECT * FROM promotion_schedule WHERE id = $1 AND organization_id = $2 AND status = 'completed'`,
        [scheduleId, organizationId]
      );

      if (scheduleResult.rows.length === 0) {
        req.flash("error_msg", "Promotion cannot be reversed (expired or not applicable).");
        await client.query('ROLLBACK');
        return res.redirect("/promotion/apply");
      }
      const auditResult = await client.query(
        `SELECT *
         FROM promotion_schedule_audit
         WHERE schedule_id = $1 AND organization_id = $2
         ORDER BY id DESC`,
        [scheduleId, organizationId]
      );

      if (!auditResult.rows.length) {
        req.flash("error_msg", "Exact reverse is unavailable for this older promotion record because no action audit was stored when it was applied.");
        await client.query('ROLLBACK');
        return res.redirect("/promotion/apply");
      }

      const enrollmentCreatedRows = auditResult.rows.filter((row) => row.action_type === 'enrollment_created');
      const classAttachedRows = auditResult.rows.filter((row) => row.action_type === 'class_attached');
      const studentEnrolledRows = auditResult.rows.filter((row) => row.action_type === 'student_enrolled');
      const subjectAddedRows = auditResult.rows.filter((row) => row.action_type === 'subject_added');

      if (subjectAddedRows.length > 0) {
        await client.query(
          `DELETE FROM student_subjects ss
           WHERE EXISTS (
             SELECT 1
             FROM promotion_schedule_audit psa
             WHERE psa.schedule_id = $1
               AND psa.organization_id = $2
               AND psa.action_type = 'subject_added'
               AND psa.student_id = ss.student_id
               AND psa.subject_id = ss.subject_id
           )`,
          [scheduleId, organizationId]
        );
      }

      if (studentEnrolledRows.length > 0) {
        await client.query(
          `DELETE FROM enrolled_students
           WHERE enrolled_student_id = ANY($1::int[])`,
          [studentEnrolledRows.map((row) => Number(row.enrolled_student_id)).filter(Number.isFinite)]
        );
      }

      for (const row of classAttachedRows) {
        const enrolledClassId = Number(row.enrolled_class_id);
        const enrollmentId = Number(row.enrollment_id);
        if (!Number.isFinite(enrolledClassId) || !Number.isFinite(enrollmentId)) continue;

        const usageResult = await client.query(
          `SELECT 1
           FROM enrolled_students
           WHERE enrollment_id = $1
             AND class_id = $2
           LIMIT 1`,
          [enrollmentId, Number(row.class_id)]
        );

        if (usageResult.rows.length === 0) {
          await client.query(
            `DELETE FROM enrolled_classes
             WHERE enrolled_class_id = $1`,
            [enrolledClassId]
          );
        }
      }

      for (const row of enrollmentCreatedRows) {
        const enrollmentId = Number(row.enrollment_id);
        if (!Number.isFinite(enrollmentId)) continue;

        const remainingStudents = await client.query(
          `SELECT 1 FROM enrolled_students WHERE enrollment_id = $1 LIMIT 1`,
          [enrollmentId]
        );
        const remainingClasses = await client.query(
          `SELECT 1 FROM enrolled_classes WHERE enrollment_id = $1 LIMIT 1`,
          [enrollmentId]
        );

        if (remainingStudents.rows.length === 0 && remainingClasses.rows.length === 0) {
          await client.query(`DELETE FROM enrollments WHERE enrollment_id = $1`, [enrollmentId]);
        }
      }

      // 2️⃣ Mark promotion as reversed
      await client.query(`
        UPDATE promotion_schedule
        SET status = 'reversed'
        WHERE id = $1
      `, [scheduleId]);

      await client.query('COMMIT');

      req.flash("success_msg", "Promotion reversed. Recorded promotion actions were undone exactly where safe to do so.");
      res.redirect("/promotion/apply");
    } catch (err) {
      if (client) {
        try {
          await client.query('ROLLBACK');
        } catch (rollbackError) {
          console.error("[Promotion] rollback failed during reverseAppliedPromotion:", rollbackError.message || rollbackError);
        }
      }
      console.error("[Promotion] reverseAppliedPromotion failed:", err);
      req.flash("error_msg", "Failed to reverse promotion.");
      res.redirect("/promotion/apply");
    } finally {
      if (client) client.release();
    }
  },
  
  
  
  deleteReversedPromotion: async (req, res) => {
    const organizationId = req.session.organizationId;
    const scheduleId = req.body.scheduleId;
  
    try {
      await db.query(
        `DELETE FROM promotion_schedule_classes WHERE schedule_id = $1`,
        [scheduleId]
      );
  
      await db.query(
        `DELETE FROM promotion_schedule WHERE id = $1 AND organization_id = $2 AND status = 'reversed'`,
        [scheduleId, organizationId]
      );
  
      req.flash("success_msg", "Reversed promotion has been deleted.");
      res.redirect("/promotion/apply");
    } catch (err) {
            req.flash("error_msg", "Failed to delete reversed promotion.");
      res.redirect("/promotion/apply");
    }
  },
  

  // Shared core logic for applying a single promotion
  _applyPromotionCore: async (promo) => {
    const {
      id: scheduleId,
      organization_id,
      target_term_id,
      target_school_year_id,
      current_term_id
    } = promo;

    await ensurePromotionAuditSchema();
    await ensurePromotionSubjectSelectionSchema();

    const client = await db.connect();
    try {
      await client.query('BEGIN');

      // 1️⃣ Get class filter from promotion_schedule_classes
      const classFilterResult = await client.query(
        `SELECT class_id FROM promotion_schedule_classes WHERE schedule_id = $1`,
        [scheduleId]
      );
      const filterClassIds = classFilterResult.rows.map(r => r.class_id);

      // 2️⃣ Check activate_promotion flag on status_settings for filtered classes
      let classCondition = '';
      const queryParams = [organization_id, current_term_id];
      if (filterClassIds.length > 0) {
        classCondition = ` AND ss.class_id = ANY($3::int[])`;
        queryParams.push(filterClassIds);
      }

      // Only process classes where activate_promotion = true
      const activeClassesResult = await client.query(
        `SELECT ss.class_id FROM status_settings ss
         WHERE ss.organization_id = $1 AND ss.term_id = $2 AND ss.activate_promotion = true${classCondition}`,
        queryParams
      );
      const activeClassIds = activeClassesResult.rows.map(r => r.class_id);

      if (activeClassIds.length === 0) {
        await client.query('ROLLBACK');
        return { success: false, reason: 'No classes have promotion activated' };
      }

      // 3️⃣ Fetch students with promotion data, filtered by active classes
      const promotedStudentsResult = await client.query(`
        SELECT sr.student_id, sr.class_id AS current_class_id, sr.promotion_status, sr.promotion_class_id
        FROM student_reports sr
        JOIN students s
          ON s.student_id = sr.student_id
          AND s.organization_id = sr.organization_id
          AND COALESCE(s.graduated, FALSE) = FALSE
        WHERE sr.organization_id = $1 AND sr.term_id = $2
          AND sr.class_id = ANY($3::int[])
          AND sr.promotion_status IN ('Promoted', 'Repeated')
          AND sr.promotion_class_id IS NOT NULL
          AND EXISTS (
            SELECT 1
            FROM enrollments e
            JOIN enrolled_students es
              ON es.enrollment_id = e.enrollment_id
             AND es.student_id = sr.student_id
             AND es.class_id = sr.class_id
            WHERE e.organization_id = sr.organization_id
              AND e.term_id = sr.term_id
          )
      `, [organization_id, current_term_id, activeClassIds]);

      if (promotedStudentsResult.rows.length === 0) {
        await client.query('ROLLBACK');
        return { success: false, reason: 'No students eligible for promotion. Generate reports first to auto-calculate promotion status.' };
      }

      // 4️⃣ Ensure enrollment exists or create one
      let enrollmentId;
      const auditRows = [];
      const existingEnrollmentResult = await client.query(`
        SELECT enrollment_id FROM enrollments
        WHERE term_id = $1 AND school_year_id = $2 AND organization_id = $3
      `, [target_term_id, target_school_year_id, organization_id]);

      if (existingEnrollmentResult.rows.length > 0) {
        enrollmentId = existingEnrollmentResult.rows[0].enrollment_id;
      } else {
        const newEnrollmentResult = await client.query(`
          INSERT INTO enrollments (school_year_id, term_id, organization_id, created_at)
          VALUES ($1, $2, $3, NOW())
          RETURNING enrollment_id
        `, [target_school_year_id, target_term_id, organization_id]);
        enrollmentId = newEnrollmentResult.rows[0].enrollment_id;
      auditRows.push({
        scheduleId,
        organizationId: organization_id,
        actionType: 'enrollment_created',
        enrollmentId,
        details: {
          enrollmentId,
          targetTermId: Number(target_term_id),
          targetSchoolYearId: Number(target_school_year_id),
          message: 'Created target term enrollment.',
        },
      });
    }

    const finalEnrollments = promotedStudentsResult.rows.map(row => ({
      student_id: row.student_id,
      target_class_id: row.promotion_class_id
    }));

    // 5️⃣ Insert classes
    // Attach every destination class involved in this promotion plan, not only
    // classes from students inserted in this run. This keeps target-term class
    // enrollment complete while still avoiding duplicates.
    const promotionClassPoolResult = await client.query(
      `SELECT DISTINCT sr.promotion_class_id AS target_class_id
       FROM student_reports sr
       JOIN students s
         ON s.student_id = sr.student_id
        AND s.organization_id = sr.organization_id
        AND COALESCE(s.graduated, FALSE) = FALSE
       WHERE sr.organization_id = $1
         AND sr.term_id = $2
         AND sr.class_id = ANY($3::int[])
         AND sr.promotion_status IN ('Promoted', 'Repeated')
         AND sr.promotion_class_id IS NOT NULL`,
      [organization_id, current_term_id, activeClassIds]
    );

    const plannedTargetClassIds = promotionClassPoolResult.rows
      .map((row) => Number(row.target_class_id))
      .filter(Number.isFinite);

    const classNameResult = await client.query(
      `SELECT class_id, class_name
       FROM classes
       WHERE class_id = ANY($1::int[])`,
      [[...new Set([...plannedTargetClassIds, ...finalEnrollments.map((row) => Number(row.target_class_id)).filter(Number.isFinite)])]]
    );
    const classNameMap = new Map(
      classNameResult.rows.map((row) => [Number(row.class_id), row.class_name || `Class ${row.class_id}`])
    );

    const studentNameResult = await client.query(
      `SELECT student_id, first_name, last_name
       FROM students
       WHERE organization_id = $1
         AND student_id = ANY($2::int[])`,
      [organization_id, [...new Set(finalEnrollments.map((row) => Number(row.student_id)).filter(Number.isFinite))]]
    );
    const studentNameMap = new Map(
      studentNameResult.rows.map((row) => [Number(row.student_id), formatStudentName(row)])
    );

    const classCheckResult = await client.query(
      `SELECT class_id FROM enrolled_classes WHERE enrollment_id = $1`,
      [enrollmentId]
    );
    const existingClassIds = new Set(classCheckResult.rows.map(r => r.class_id));
    const newClassIds = [...new Set(
      [...plannedTargetClassIds, ...finalEnrollments.map((r) => Number(r.target_class_id)).filter(Number.isFinite)]
    )].filter(cid => !existingClassIds.has(cid));

    if (newClassIds.length > 0) {
      const insertedClassResult = await client.query(`
        INSERT INTO enrolled_classes (enrollment_id, class_id)
        SELECT $1, unnest($2::int[])
        RETURNING enrolled_class_id, class_id
      `, [enrollmentId, newClassIds]);

      insertedClassResult.rows.forEach((row) => {
        const classId = Number(row.class_id);
        auditRows.push({
          scheduleId,
          organizationId: organization_id,
          actionType: 'class_attached',
          enrollmentId,
          enrolledClassId: Number(row.enrolled_class_id),
          classId,
          details: {
            classId,
            className: classNameMap.get(classId) || `Class ${classId}`,
            message: `Attached ${classNameMap.get(classId) || `Class ${classId}`} to the target enrollment.`,
          },
        });
      });
    }

    // 6️⃣ Insert students
    let enrolledCount = 0;
    for (const { student_id, target_class_id } of finalEnrollments) {
      const result = await client.query(`
        INSERT INTO enrolled_students (enrollment_id, student_id, class_id, added_by_promotion)
        VALUES ($1, $2, $3, TRUE)
        ON CONFLICT DO NOTHING
        RETURNING enrolled_student_id, student_id, class_id
      `, [enrollmentId, student_id, target_class_id]);
      enrolledCount += result.rowCount;
      result.rows.forEach((row) => {
        const studentId = Number(row.student_id);
        const classId = Number(row.class_id);
        auditRows.push({
          scheduleId,
          organizationId: organization_id,
          actionType: 'student_enrolled',
          enrollmentId,
          enrolledStudentId: Number(row.enrolled_student_id),
          studentId,
          classId,
          details: {
            studentId,
            studentName: studentNameMap.get(studentId) || `Student ${studentId}`,
            classId,
            className: classNameMap.get(classId) || `Class ${classId}`,
            message: `${studentNameMap.get(studentId) || `Student ${studentId}`} was enrolled into ${classNameMap.get(classId) || `Class ${classId}`}.`,
          },
        });
      });
    }

    const targetClassIds = [...new Set(finalEnrollments.map((row) => Number(row.target_class_id)).filter(Number.isFinite))];
    const classSubjectsByClass = new Map();
    const subjectNameMap = new Map();
    if (targetClassIds.length > 0) {
      const classSubjectsResult = await client.query(
        `SELECT class_id, subject_id, subject_name
         FROM subjects
         WHERE organization_id = $1
           AND class_id = ANY($2::int[])`,
        [organization_id, targetClassIds]
      );

      classSubjectsResult.rows.forEach((row) => {
        const classId = Number(row.class_id);
        const subjectId = Number(row.subject_id);
        if (!Number.isFinite(classId) || !Number.isFinite(subjectId)) return;
        if (!classSubjectsByClass.has(classId)) {
          classSubjectsByClass.set(classId, []);
        }
        classSubjectsByClass.get(classId).push(subjectId);
        subjectNameMap.set(subjectId, row.subject_name || `Subject ${subjectId}`);
      });
    }

    const promotedStudentIds = [...new Set(finalEnrollments.map((row) => Number(row.student_id)).filter(Number.isFinite))];
    const savedSelectionByStudent = new Map();
    if (promotedStudentIds.length > 0) {
      const savedSelectionResult = await client.query(
        `SELECT student_id, subject_id
         FROM promotion_subject_selections
         WHERE organization_id = $1
           AND term_id = $2
           AND student_id = ANY($3::int[])`,
        [organization_id, current_term_id, promotedStudentIds]
      );

      savedSelectionResult.rows.forEach((row) => {
        const studentId = Number(row.student_id);
        const subjectId = Number(row.subject_id);
        if (!Number.isFinite(studentId) || !Number.isFinite(subjectId)) return;
        if (!savedSelectionByStudent.has(studentId)) {
          savedSelectionByStudent.set(studentId, new Set());
        }
        savedSelectionByStudent.get(studentId).add(subjectId);
      });
    }

    const subjectInsertRows = [];
    finalEnrollments.forEach(({ student_id, target_class_id }) => {
      const classId = Number(target_class_id);
      const studentId = Number(student_id);
      if (!Number.isFinite(classId) || !Number.isFinite(studentId)) return;

      const classSubjectIds = classSubjectsByClass.get(classId) || [];
      if (classSubjectIds.length === 0) return;

      const savedSet = savedSelectionByStudent.get(studentId);
      const subjectIdsToAssign = savedSet
        ? classSubjectIds.filter((subjectId) => savedSet.has(subjectId))
        : classSubjectIds;

      subjectIdsToAssign.forEach((subjectId) => {
        subjectInsertRows.push({ studentId, subjectId });
      });
    });

    if (promotedStudentIds.length > 0) {
      // A promoted student's subject list belongs to their NEW class only -
      // clear out whatever was assigned under their old class before
      // re-inserting below. Without this, re-running promotion (or a
      // school-year enrollment carry-over that runs afterward) piles new
      // rows on top of the old class's subjects instead of replacing them,
      // so a student ends up with every subject listed twice.
      await client.query(
        `DELETE FROM student_subjects WHERE organization_id = $1 AND student_id = ANY($2::int[])`,
        [organization_id, promotedStudentIds]
      );
    }

    if (subjectInsertRows.length > 0) {
      const values = [];
      const placeholders = [];
      subjectInsertRows.forEach((row, index) => {
        const offset = index * 4;
        const targetClassId = finalEnrollments.find((entry) => Number(entry.student_id) === Number(row.studentId))?.target_class_id || null;
        values.push(row.studentId, row.subjectId, organization_id, targetClassId == null ? null : Number(targetClassId));
        placeholders.push(`($${offset + 1}::int, $${offset + 2}::int, $${offset + 3}::int, $${offset + 4}::int)`);
      });

      const insertedSubjectResult = await client.query(
        `WITH source_rows(student_id, subject_id, organization_id, class_id) AS (
           VALUES ${placeholders.join(', ')}
         )
         INSERT INTO student_subjects (student_id, subject_id, organization_id)
         SELECT student_id::int, subject_id::int, organization_id::int
         FROM source_rows
         ON CONFLICT DO NOTHING
         RETURNING student_id, subject_id`,
        values
      );

      insertedSubjectResult.rows.forEach((row) => {
        const studentId = Number(row.student_id);
        const subjectId = Number(row.subject_id);
        const classId = Number(finalEnrollments.find((entry) => Number(entry.student_id) === studentId)?.target_class_id);
        auditRows.push({
          scheduleId,
          organizationId: organization_id,
          actionType: 'subject_added',
          studentId,
          classId: Number.isFinite(classId) ? classId : null,
          subjectId,
          details: {
            studentId,
            studentName: studentNameMap.get(studentId) || `Student ${studentId}`,
            classId: Number.isFinite(classId) ? classId : null,
            className: Number.isFinite(classId) ? (classNameMap.get(classId) || `Class ${classId}`) : null,
            subjectId,
            subjectName: subjectNameMap.get(subjectId) || `Subject ${subjectId}`,
            message: `${studentNameMap.get(studentId) || `Student ${studentId}`} received ${subjectNameMap.get(subjectId) || `Subject ${subjectId}`}.`,
          },
        });
      });
    }

    await recordPromotionAuditRows(client, auditRows);

    // 7️⃣ Mark schedule as completed
    await client.query(`
      UPDATE promotion_schedule SET status = 'completed' WHERE id = $1
    `, [scheduleId]);

      await client.query('COMMIT');

      notifyPromotionManagersAndSupervisors({
        orgId: organization_id,
        scheduleId,
        targetTermId: target_term_id,
        targetSchoolYearId: target_school_year_id,
        enrolledCount,
        totalEligible: finalEnrollments.length,
      }).catch((error) => {
        console.error('[Promotion] promotion_completed notification failed:', error.message || error);
      });

      return { success: true, enrolledCount, totalEligible: finalEnrollments.length };
    } catch (error) {
      try {
        await client.query('ROLLBACK');
      } catch (rollbackError) {
        console.error('[Promotion] rollback failed during _applyPromotionCore:', rollbackError.message || rollbackError);
      }
      throw error;
    } finally {
      client.release();
    }
  },

  // Cron job entry point
  applyScheduledPromotions: async () => {
    try {
      await ensurePromotionScheduleRetrySchema();

      const now = new Date().toISOString();
      const promotionsResult = await db.query(`
        SELECT * FROM promotion_schedule 
        WHERE scheduled_date <= $1
          AND status = 'scheduled'
          AND (next_retry_at IS NULL OR next_retry_at <= $1)
      `, [now]);

      for (const promo of promotionsResult.rows) {
        try {
          const result = await executePromotionWithRetryPolicy(promo);
          if (result.success) {
            console.log(`✅ Promotion ${promo.id} applied: ${result.enrolledCount}/${result.totalEligible} students enrolled`);
          } else {
            const retryHint = result.willRetry ? ' Retry already queued.' : ' Retry attempts exhausted.';
            console.warn(`⚠️ Promotion ${promo.id} skipped: ${result.reason}.${retryHint}`);
          }
        } catch (innerErr) {
          console.error(`❌ Promotion ${promo.id} failed:`, innerErr.message);
        }
      }
    } catch (err) {
      console.error("❌ applyScheduledPromotions error:", err.message);
    }
  },

  // "Apply Now" - instant promotion
  applyNow: async (req, res) => {
    const scheduleId = req.body.scheduleId;
    const organizationId = req.session.organizationId;

    try {
      await ensurePromotionScheduleRetrySchema();

      const scheduleResult = await db.query(
        `SELECT * FROM promotion_schedule WHERE id = $1 AND organization_id = $2 AND status = 'scheduled'`,
        [scheduleId, organizationId]
      );

      if (scheduleResult.rows.length === 0) {
        req.flash("error", "Promotion not found or already applied.");
        return res.redirect("/promotion/apply");
      }

      const result = await executePromotionWithRetryPolicy(scheduleResult.rows[0]);

      if (result.success) {
        req.flash("success", `Promotion applied! ${result.enrolledCount} students enrolled into their new classes.`);
      } else {
        req.flash("error", result.willRetry
          ? `${result.reason} Next retry will run automatically based on retry policy.`
          : `${result.reason} Retry attempts exhausted.`);
      }
      res.redirect("/promotion/apply");
    } catch (err) {
      console.error("❌ Apply Now failed:", err);
      req.flash("error", "Failed to apply promotion: " + err.message);
      res.redirect("/promotion/apply");
    }
  }
};
