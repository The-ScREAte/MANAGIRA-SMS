const WEEKDAY_OPTIONS = [
  { value: 1, label: "Monday" },
  { value: 2, label: "Tuesday" },
  { value: 3, label: "Wednesday" },
  { value: 4, label: "Thursday" },
  { value: 5, label: "Friday" },
  { value: 6, label: "Saturday" },
  { value: 7, label: "Sunday" },
];

const WEEKDAY_LABEL_MAP = new Map(WEEKDAY_OPTIONS.map((option) => [option.value, option.label]));
const TIME_PATTERN = /^([01]\d|2[0-3]):([0-5]\d)$/;
let classScheduleSchemaReadyPromise = null;

async function ensureClassScheduleSchema(db) {
  if (!classScheduleSchemaReadyPromise) {
    classScheduleSchemaReadyPromise = (async function initializeClassScheduleSchema() {
      await db.query(`
        CREATE TABLE IF NOT EXISTS class_schedules (
          schedule_id SERIAL PRIMARY KEY,
          organization_id INT NOT NULL REFERENCES organizations(organization_id) ON DELETE CASCADE,
          class_id INT NOT NULL REFERENCES classes(class_id) ON DELETE CASCADE,
          school_year_id INT NOT NULL REFERENCES school_years(id) ON DELETE CASCADE,
          term_id INT NOT NULL REFERENCES terms(term_id) ON DELETE CASCADE,
          reused_from_schedule_id INT REFERENCES class_schedules(schedule_id) ON DELETE SET NULL,
          created_by INT REFERENCES users(user_id) ON DELETE SET NULL,
          updated_by INT REFERENCES users(user_id) ON DELETE SET NULL,
          created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          UNIQUE (organization_id, class_id, school_year_id, term_id)
        )
      `);

      await db.query(`
        CREATE TABLE IF NOT EXISTS class_schedule_entries (
          entry_id SERIAL PRIMARY KEY,
          schedule_id INT NOT NULL REFERENCES class_schedules(schedule_id) ON DELETE CASCADE,
          day_of_week SMALLINT NOT NULL,
          start_time TIME NOT NULL,
          end_time TIME NOT NULL,
          subject_id INT REFERENCES subjects(subject_id) ON DELETE SET NULL,
          row_order INT NOT NULL DEFAULT 0,
          created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          CONSTRAINT class_schedule_entries_day_check CHECK (day_of_week BETWEEN 1 AND 7),
          CONSTRAINT class_schedule_entries_time_check CHECK (end_time > start_time)
        )
      `);

      await db.query(`
        DO $$
        BEGIN
          IF EXISTS (
            SELECT 1
            FROM information_schema.table_constraints
            WHERE constraint_name = 'class_schedule_entries_day_check'
              AND table_name = 'class_schedule_entries'
          ) THEN
            ALTER TABLE class_schedule_entries DROP CONSTRAINT class_schedule_entries_day_check;
          END IF;

          ALTER TABLE class_schedule_entries
            ADD CONSTRAINT class_schedule_entries_day_check CHECK (day_of_week BETWEEN 1 AND 7);
        EXCEPTION
          WHEN duplicate_object THEN NULL;
        END
        $$;
      `);

      await db.query(`
        ALTER TABLE class_schedule_entries
          ADD COLUMN IF NOT EXISTS custom_label TEXT DEFAULT NULL
      `);

      await db.query(`
        CREATE INDEX IF NOT EXISTS idx_class_schedules_org_class_term
          ON class_schedules (organization_id, class_id, term_id)
      `);

      await db.query(`
        CREATE INDEX IF NOT EXISTS idx_class_schedule_entries_schedule_day_time
          ON class_schedule_entries (schedule_id, day_of_week, start_time, row_order)
      `);

      await db.query(`
        DO $$
        BEGIN
          IF EXISTS (
            SELECT 1 FROM pg_proc WHERE proname = 'update_modified_column'
          ) THEN
            IF NOT EXISTS (
              SELECT 1 FROM pg_trigger WHERE tgname = 'update_class_schedules_modtime'
            ) THEN
              CREATE TRIGGER update_class_schedules_modtime
                BEFORE UPDATE ON class_schedules
                FOR EACH ROW
                EXECUTE FUNCTION update_modified_column();
            END IF;

            IF NOT EXISTS (
              SELECT 1 FROM pg_trigger WHERE tgname = 'update_class_schedule_entries_modtime'
            ) THEN
              CREATE TRIGGER update_class_schedule_entries_modtime
                BEFORE UPDATE ON class_schedule_entries
                FOR EACH ROW
                EXECUTE FUNCTION update_modified_column();
            END IF;
          END IF;
        END
        $$;
      `);
    })().catch((error) => {
      classScheduleSchemaReadyPromise = null;
      throw error;
    });
  }

  await classScheduleSchemaReadyPromise;
}

function canManageClassSchedule(userRole, isMainTeacher) {
  const normalizedRole = String(userRole || "").trim().toLowerCase();
  return normalizedRole === "manager" || normalizedRole === "supervisor" || (normalizedRole === "teacher" && Boolean(isMainTeacher));
}

async function getTermContext(db, organizationId, termId) {
  const result = await db.query(
    `
      SELECT t.term_id, t.term_name, t.start_date, t.end_date, t.school_year_id, sy.year_label
      FROM terms t
      JOIN school_years sy ON sy.id = t.school_year_id
      WHERE t.term_id = $1 AND t.organization_id = $2
      LIMIT 1
    `,
    [termId, organizationId]
  );

  return result.rows[0] || null;
}

async function getClassRecord(db, organizationId, classId) {
  const result = await db.query(
    `
      SELECT class_id, class_name
      FROM classes
      WHERE class_id = $1 AND organization_id = $2
      LIMIT 1
    `,
    [classId, organizationId]
  );

  return result.rows[0] || null;
}

async function getClassScheduleBundle(db, options) {
  const { organizationId, classId, termId } = options;
  await ensureClassScheduleSchema(db);

  const term = await getTermContext(db, organizationId, termId);
  if (!term) {
    return null;
  }

  const classRecord = await getClassRecord(db, organizationId, classId);
  if (!classRecord) {
    return null;
  }

  const currentSchedule = await getClassScheduleForTerm(db, {
    organizationId,
    classId,
    termId,
  });

  const previousSchedule = currentSchedule
    ? null
    : await getPreviousClassSchedule(db, {
        organizationId,
        classId,
        currentTermId: term.term_id,
        currentTermStartDate: term.start_date,
      });

  return {
    classRecord,
    term,
    currentSchedule,
    previousSchedule,
  };
}

async function getClassScheduleForTerm(db, options) {
  const { organizationId, classId, termId } = options;

  const scheduleResult = await db.query(
    `
      SELECT cs.schedule_id,
             cs.organization_id,
             cs.class_id,
             cs.school_year_id,
             cs.term_id,
             cs.reused_from_schedule_id,
             cs.created_by,
             cs.updated_by,
             cs.created_at,
             cs.updated_at,
             t.term_name,
             sy.year_label,
             c.class_name,
             COALESCE(CONCAT_WS(' ', creator.first_name, creator.last_name), creator.email) AS created_by_name,
             COALESCE(CONCAT_WS(' ', updater.first_name, updater.last_name), updater.email) AS updated_by_name
      FROM class_schedules cs
      JOIN terms t ON t.term_id = cs.term_id
      JOIN school_years sy ON sy.id = cs.school_year_id
      JOIN classes c ON c.class_id = cs.class_id
      LEFT JOIN users creator ON creator.user_id = cs.created_by
      LEFT JOIN users updater ON updater.user_id = cs.updated_by
      WHERE cs.organization_id = $1 AND cs.class_id = $2 AND cs.term_id = $3
      LIMIT 1
    `,
    [organizationId, classId, termId]
  );

  if (scheduleResult.rows.length === 0) {
    return null;
  }

  const schedule = scheduleResult.rows[0];
  const entriesResult = await db.query(
    `
      SELECT e.entry_id,
             e.schedule_id,
             e.day_of_week,
             e.start_time::text AS start_time,
             e.end_time::text AS end_time,
             e.subject_id,
             e.row_order,
             e.custom_label,
             s.subject_name
      FROM class_schedule_entries e
      LEFT JOIN subjects s ON s.subject_id = e.subject_id
      WHERE e.schedule_id = $1
      ORDER BY e.day_of_week ASC, e.start_time ASC, e.row_order ASC, e.entry_id ASC
    `,
    [schedule.schedule_id]
  );

  return normalizeSchedule(schedule, entriesResult.rows);
}

async function getPreviousClassSchedule(db, options) {
  const { organizationId, classId, currentTermId, currentTermStartDate } = options;

  const result = await db.query(
    `
      SELECT cs.schedule_id,
             cs.organization_id,
             cs.class_id,
             cs.school_year_id,
             cs.term_id,
             cs.reused_from_schedule_id,
             cs.created_by,
             cs.updated_by,
             cs.created_at,
             cs.updated_at,
             t.term_name,
             sy.year_label,
             c.class_name
      FROM class_schedules cs
      JOIN terms t ON t.term_id = cs.term_id
      JOIN school_years sy ON sy.id = cs.school_year_id
      JOIN classes c ON c.class_id = cs.class_id
      WHERE cs.organization_id = $1
        AND cs.class_id = $2
        AND cs.term_id <> $3
        AND t.start_date < $4
      ORDER BY t.start_date DESC, cs.updated_at DESC
      LIMIT 1
    `,
    [organizationId, classId, currentTermId, currentTermStartDate]
  );

  if (result.rows.length === 0) {
    return null;
  }

  const previous = result.rows[0];
  const entriesResult = await db.query(
    `
      SELECT e.entry_id,
             e.schedule_id,
             e.day_of_week,
             e.start_time::text AS start_time,
             e.end_time::text AS end_time,
             e.subject_id,
             e.row_order,
             e.custom_label,
             s.subject_name
      FROM class_schedule_entries e
      LEFT JOIN subjects s ON s.subject_id = e.subject_id
      WHERE e.schedule_id = $1
      ORDER BY e.day_of_week ASC, e.start_time ASC, e.row_order ASC, e.entry_id ASC
    `,
    [previous.schedule_id]
  );

  return normalizeSchedule(previous, entriesResult.rows);
}

function normalizeSchedule(schedule, entries) {
  const normalizedEntries = (entries || []).map((entry, index) => ({
    entryId: entry.entry_id,
    dayOfWeek: Number(entry.day_of_week),
    dayLabel: WEEKDAY_LABEL_MAP.get(Number(entry.day_of_week)) || `Day ${entry.day_of_week}`,
    startTime: normalizeTimeText(entry.start_time),
    endTime: normalizeTimeText(entry.end_time),
    subjectId: entry.subject_id ? Number(entry.subject_id) : null,
    subjectName: entry.subject_name || null,
    customLabel: entry.custom_label || null,
    rowOrder: Number.isInteger(entry.row_order) ? entry.row_order : index,
  }));

  return {
    scheduleId: schedule.schedule_id,
    classId: schedule.class_id,
    className: schedule.class_name,
    schoolYearId: schedule.school_year_id,
    schoolYearLabel: schedule.year_label,
    termId: schedule.term_id,
    termName: schedule.term_name,
    createdAt: schedule.created_at,
    updatedAt: schedule.updated_at,
    createdByName: schedule.created_by_name || null,
    updatedByName: schedule.updated_by_name || null,
    reusedFromScheduleId: schedule.reused_from_schedule_id || null,
    entries: normalizedEntries,
    groupedByDay: groupEntriesByDay(normalizedEntries),
  };
}

function groupEntriesByDay(entries) {
  return WEEKDAY_OPTIONS.map((option) => ({
    dayOfWeek: option.value,
    dayLabel: option.label,
    items: entries.filter((entry) => entry.dayOfWeek === option.value),
  }));
}

async function getClassScheduleSubjects(db, options) {
  const { organizationId, classId, currentUserId, currentUserRole } = options;
  const result = await db.query(
    `
      SELECT subject_id, subject_name
      FROM subjects
      WHERE class_id = $1 AND organization_id = $2
      ORDER BY subject_name ASC
    `,
    [classId, organizationId]
  );

  let assignedSubjectIds = new Set();
  if (String(currentUserRole || '').trim().toLowerCase() === 'teacher' && currentUserId) {
    const assignedSubjectsResult = await db.query(
      `
        SELECT us.subject_id
        FROM user_subjects us
        JOIN subjects s ON s.subject_id = us.subject_id
        WHERE us.user_id = $1 AND s.class_id = $2 AND s.organization_id = $3
      `,
      [currentUserId, classId, organizationId]
    );
    assignedSubjectIds = new Set(
      assignedSubjectsResult.rows.map((row) => Number(row.subject_id)).filter(Number.isFinite)
    );
  }

  return result.rows.map((subject) => ({
    subjectId: Number(subject.subject_id),
    subjectName: subject.subject_name,
    assignedToCurrentTeacher: assignedSubjectIds.has(Number(subject.subject_id)),
  }));
}

async function saveClassSchedule(db, options) {
  const { organizationId, classId, termId, schoolYearId, entries, actorUserId } = options;
  await ensureClassScheduleSchema(db);

  const normalizedEntries = normalizeEntries(entries);
  if (normalizedEntries.length === 0) {
    throw new Error("Add at least one class schedule row before saving.");
  }

  const validSubjectIds = new Set((await getClassScheduleSubjects(db, { organizationId, classId })).map((item) => item.subjectId));
  for (const entry of normalizedEntries) {
    if (entry.subjectId !== null && !validSubjectIds.has(entry.subjectId)) {
      throw new Error("One or more selected subjects are not available for this class.");
    }
  }

  // Dedicated connection: BEGIN/COMMIT on the pool can run on different
  // connections and strand writes in an open transaction.
  const txClient = await db.connect();
  try {
    await txClient.query("BEGIN");
    const upsertResult = await txClient.query(
      `
        INSERT INTO class_schedules (
          organization_id, class_id, school_year_id, term_id, created_by, updated_by
        ) VALUES ($1, $2, $3, $4, $5, $5)
        ON CONFLICT (organization_id, class_id, school_year_id, term_id)
        DO UPDATE SET updated_by = EXCLUDED.updated_by, updated_at = NOW()
        RETURNING schedule_id
      `,
      [organizationId, classId, schoolYearId, termId, actorUserId || null]
    );

    const scheduleId = upsertResult.rows[0].schedule_id;
    await txClient.query(`DELETE FROM class_schedule_entries WHERE schedule_id = $1`, [scheduleId]);

    if (normalizedEntries.length) {
      // One bulk insert instead of one round trip per row.
      await txClient.query(
        `
          INSERT INTO class_schedule_entries (
            schedule_id, day_of_week, start_time, end_time, subject_id, row_order, custom_label
          )
          SELECT $1, e.day_of_week, e.start_time, e.end_time, e.subject_id, e.row_order, e.custom_label
          FROM unnest($2::int[], $3::time[], $4::time[], $5::int[], $6::int[], $7::text[])
               AS e(day_of_week, start_time, end_time, subject_id, row_order, custom_label)
        `,
        [
          scheduleId,
          normalizedEntries.map((entry) => entry.dayOfWeek),
          normalizedEntries.map((entry) => entry.startTime),
          normalizedEntries.map((entry) => entry.endTime),
          normalizedEntries.map((entry) => entry.subjectId),
          normalizedEntries.map((entry, index) => index),
          normalizedEntries.map((entry) => entry.customLabel || null),
        ]
      );
    }

    await txClient.query("COMMIT");
    return getClassScheduleForTerm(db, { organizationId, classId, termId });
  } catch (error) {
    await txClient.query("ROLLBACK").catch(() => {});
    throw error;
  } finally {
    txClient.release();
  }
}

async function deleteClassSchedule(db, options) {
  const { organizationId, classId, termId } = options;
  await ensureClassScheduleSchema(db);
  return db.query(
    `
      DELETE FROM class_schedules
      WHERE organization_id = $1 AND class_id = $2 AND term_id = $3
    `,
    [organizationId, classId, termId]
  );
}

async function clonePreviousClassSchedule(db, options) {
  const { organizationId, classId, termId, schoolYearId, actorUserId } = options;
  await ensureClassScheduleSchema(db);

  const term = await getTermContext(db, organizationId, termId);
  if (!term) {
    throw new Error("Current term could not be found.");
  }

  const previousSchedule = await getPreviousClassSchedule(db, {
    organizationId,
    classId,
    currentTermId: term.term_id,
    currentTermStartDate: term.start_date,
  });

  if (!previousSchedule) {
    throw new Error("No previous class schedule is available to reuse.");
  }

  const validSubjectIds = new Set((await getClassScheduleSubjects(db, { organizationId, classId })).map((item) => item.subjectId));
  const clonedEntries = previousSchedule.entries.map((entry) => ({
    dayOfWeek: entry.dayOfWeek,
    startTime: entry.startTime,
    endTime: entry.endTime,
    subjectId: entry.subjectId && validSubjectIds.has(entry.subjectId) ? entry.subjectId : null,
    customLabel: entry.customLabel || null,
  }));

  // Dedicated connection: BEGIN/COMMIT on the pool can run on different
  // connections and strand writes in an open transaction.
  const txClient = await db.connect();
  try {
    await txClient.query("BEGIN");
    const insertResult = await txClient.query(
      `
        INSERT INTO class_schedules (
          organization_id, class_id, school_year_id, term_id, reused_from_schedule_id, created_by, updated_by
        ) VALUES ($1, $2, $3, $4, $5, $6, $6)
        ON CONFLICT (organization_id, class_id, school_year_id, term_id)
        DO UPDATE SET
          reused_from_schedule_id = EXCLUDED.reused_from_schedule_id,
          updated_by = EXCLUDED.updated_by,
          updated_at = NOW()
        RETURNING schedule_id
      `,
      [organizationId, classId, schoolYearId, termId, previousSchedule.scheduleId, actorUserId || null]
    );

    const scheduleId = insertResult.rows[0].schedule_id;
    await txClient.query(`DELETE FROM class_schedule_entries WHERE schedule_id = $1`, [scheduleId]);

    if (clonedEntries.length) {
      // One bulk insert instead of one round trip per row.
      await txClient.query(
        `
          INSERT INTO class_schedule_entries (
            schedule_id, day_of_week, start_time, end_time, subject_id, row_order, custom_label
          )
          SELECT $1, e.day_of_week, e.start_time, e.end_time, e.subject_id, e.row_order, e.custom_label
          FROM unnest($2::int[], $3::time[], $4::time[], $5::int[], $6::int[], $7::text[])
               AS e(day_of_week, start_time, end_time, subject_id, row_order, custom_label)
        `,
        [
          scheduleId,
          clonedEntries.map((entry) => entry.dayOfWeek),
          clonedEntries.map((entry) => entry.startTime),
          clonedEntries.map((entry) => entry.endTime),
          clonedEntries.map((entry) => entry.subjectId),
          clonedEntries.map((entry, index) => index),
          clonedEntries.map((entry) => entry.customLabel || null),
        ]
      );
    }

    await txClient.query("COMMIT");
  } catch (error) {
    await txClient.query("ROLLBACK").catch(() => {});
    throw error;
  } finally {
    txClient.release();
  }

  return getClassScheduleForTerm(db, { organizationId, classId, termId });
}

function normalizeEntries(entries) {
  if (!Array.isArray(entries)) {
    throw new Error("Schedule rows are required.");
  }

  return entries.map((entry) => {
    const dayOfWeek = Number(entry.dayOfWeek);
    const startTime = normalizeTimeText(entry.startTime);
    const endTime = normalizeTimeText(entry.endTime);
    const subjectId = entry.subjectId === null || entry.subjectId === undefined || entry.subjectId === ""
      ? null
      : Number(entry.subjectId);

    if (!Number.isInteger(dayOfWeek) || !WEEKDAY_LABEL_MAP.has(dayOfWeek)) {
      throw new Error("Each schedule row must use a valid weekday.");
    }

    if (!TIME_PATTERN.test(startTime) || !TIME_PATTERN.test(endTime)) {
      throw new Error("Each schedule row must include valid start and end times.");
    }

    if (endTime <= startTime) {
      throw new Error("Each schedule row must end after it starts.");
    }

    if (subjectId !== null && (!Number.isInteger(subjectId) || subjectId <= 0)) {
      throw new Error("Each schedule row must reference a valid subject.");
    }

    const customLabel = (entry.customLabel && typeof entry.customLabel === 'string') ? entry.customLabel.trim().slice(0, 100) : null;

    return {
      dayOfWeek,
      startTime,
      endTime,
      subjectId,
      customLabel: subjectId === null ? customLabel : null,
    };
  }).sort((left, right) => {
    if (left.dayOfWeek !== right.dayOfWeek) {
      return left.dayOfWeek - right.dayOfWeek;
    }
    if (left.startTime !== right.startTime) {
      return left.startTime.localeCompare(right.startTime);
    }
    return left.endTime.localeCompare(right.endTime);
  });
}

function normalizeTimeText(value) {
  const raw = String(value || "").trim();
  const short = raw.slice(0, 5);
  if (TIME_PATTERN.test(short)) {
    return short;
  }
  return raw;
}

module.exports = {
  WEEKDAY_OPTIONS,
  ensureClassScheduleSchema,
  canManageClassSchedule,
  getTermContext,
  getClassScheduleBundle,
  getClassScheduleForTerm,
  getPreviousClassSchedule,
  getClassScheduleSubjects,
  saveClassSchedule,
  deleteClassSchedule,
  clonePreviousClassSchedule,
  groupEntriesByDay,
};