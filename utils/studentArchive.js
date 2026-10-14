// Graduating and archiving students, and the rules that keep it honest.
//
// A student leaves the active register in one of two ways:
//   - graduated: finished at the school;
//   - left: left before graduating, with a reason (transferred, relocated, ...).
// Their records are kept. They stop showing in classes, attendance and fees.
//
// Because schools are charged per active student, archiving is not a way to
// skip a bill and bring students back afterwards:
//   - an archived student still counts for billing for BILLING_HOLD_DAYS after
//     archiving (archiving right before a charge doesn't lower it);
//   - the school can undo an archive within UNDO_HOURS (a mistake); after that a
//     student who left can be restored only once the billing hold has ended;
//   - a graduate is kept as a permanent record once two terms have finished
//     since graduation (or a year has passed): no restore, no edits.
// Every archive, undo and restore is written to student_archive_events, by a
// database trigger, so older code that archives or restores is tracked and held
// to the same rules.

const BILLING_HOLD_DAYS = 30;
const UNDO_HOURS = 24;

const LEAVE_REASONS = [
  "Transferred to another school",
  "Family relocated or moved away",
  "Financial reasons (fees)",
  "Withdrawn by parent or guardian",
  "Health or medical reasons",
  "Dismissed or expelled",
  "Stopped attending",
  "Left to work or learn a trade",
  "Passed away",
];

let ready = null;

const SCHEMA_SQL = `
  -- A student who leaves may not belong to a graduation group.
  ALTER TABLE archived_student_info ALTER COLUMN graduation_year_group_id DROP NOT NULL;
  ALTER TABLE archived_student_info ADD COLUMN IF NOT EXISTS archive_kind TEXT;
  ALTER TABLE archived_student_info ADD COLUMN IF NOT EXISTS reason TEXT;
  ALTER TABLE archived_student_info ADD COLUMN IF NOT EXISTS reason_note TEXT;
  ALTER TABLE archived_student_info ADD COLUMN IF NOT EXISTS archived_by_user_id INTEGER;
  ALTER TABLE archived_student_info ADD COLUMN IF NOT EXISTS archived_by_name TEXT;
  ALTER TABLE archived_student_info ADD COLUMN IF NOT EXISTS archived_at_ts TIMESTAMPTZ;
  ALTER TABLE archived_student_info ADD COLUMN IF NOT EXISTS billable_until TIMESTAMPTZ;
  ALTER TABLE archived_student_info ADD COLUMN IF NOT EXISTS undo_until TIMESTAMPTZ;
  ALTER TABLE archived_student_info ADD COLUMN IF NOT EXISTS rode_bus BOOLEAN NOT NULL DEFAULT FALSE;
  -- Archives made from now on (by any code) get the billing hold and undo window;
  -- rows that existed before keep no hold.
  ALTER TABLE archived_student_info ALTER COLUMN archived_at_ts SET DEFAULT NOW();
  ALTER TABLE archived_student_info ALTER COLUMN billable_until SET DEFAULT NOW() + INTERVAL '${BILLING_HOLD_DAYS} days';
  ALTER TABLE archived_student_info ALTER COLUMN undo_until SET DEFAULT NOW() + INTERVAL '${UNDO_HOURS} hours';
  ALTER TABLE archived_student_info ALTER COLUMN archive_kind SET DEFAULT 'graduated';

  CREATE TABLE IF NOT EXISTS student_archive_events (
    id SERIAL PRIMARY KEY,
    organization_id INTEGER NOT NULL REFERENCES organizations(organization_id) ON DELETE CASCADE,
    student_id INTEGER NOT NULL REFERENCES students(student_id) ON DELETE CASCADE,
    action TEXT NOT NULL,              -- graduated | left | undone | restored
    archive_kind TEXT,
    reason TEXT,
    reason_note TEXT,
    actor_user_id INTEGER,
    actor_name TEXT,
    billable_until TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  );
  CREATE INDEX IF NOT EXISTS student_archive_events_student_idx
    ON student_archive_events (organization_id, student_id, created_at DESC);

  -- Why a student can't be restored right now (NULL when they can).
  CREATE OR REPLACE FUNCTION archive_restore_block(p_student_id INTEGER, p_organization_id INTEGER)
  RETURNS TEXT LANGUAGE plpgsql STABLE AS $$
  DECLARE
    a RECORD;
    v_since TIMESTAMPTZ;
    v_terms INTEGER;
  BEGIN
    SELECT * INTO a FROM archived_student_info
     WHERE student_id = p_student_id AND organization_id = p_organization_id
     ORDER BY COALESCE(archived_at_ts, archived_at::timestamptz) DESC
     LIMIT 1;
    IF NOT FOUND THEN RETURN NULL; END IF;
    v_since := COALESCE(a.archived_at_ts, a.archived_at::timestamptz);
    IF COALESCE(a.archive_kind, 'graduated') = 'graduated' THEN
      SELECT COUNT(*) INTO v_terms FROM terms t
       WHERE t.organization_id = p_organization_id
         AND t.start_date >= v_since::date
         AND t.end_date < CURRENT_DATE;
      IF v_terms >= 2 OR v_since < NOW() - INTERVAL '365 days' THEN
        RETURN 'permanent';
      END IF;
    END IF;
    IF a.undo_until IS NOT NULL AND NOW() <= a.undo_until THEN RETURN NULL; END IF;
    IF a.billable_until IS NOT NULL AND NOW() < a.billable_until THEN
      RETURN 'hold:' || to_char(a.billable_until AT TIME ZONE 'UTC', 'YYYY-MM-DD');
    END IF;
    RETURN NULL;
  END $$;

  -- Logs every archive and restore, and refuses a restore the rules don't allow
  -- (the app sets managira.archive_override for Managira support only).
  CREATE OR REPLACE FUNCTION track_student_archive() RETURNS trigger AS $$
  DECLARE
    v_block TEXT;
    v_actor_id INTEGER := NULLIF(current_setting('managira.actor_id', true), '')::INTEGER;
    v_actor_name TEXT := NULLIF(current_setting('managira.actor_name', true), '');
  BEGIN
    IF TG_OP = 'INSERT' THEN
      INSERT INTO student_archive_events
        (organization_id, student_id, action, archive_kind, reason, reason_note, actor_user_id, actor_name, billable_until)
      VALUES (NEW.organization_id, NEW.student_id, COALESCE(NEW.archive_kind, 'graduated'),
              COALESCE(NEW.archive_kind, 'graduated'), NEW.reason, NEW.reason_note,
              COALESCE(NEW.archived_by_user_id, v_actor_id), COALESCE(NEW.archived_by_name, v_actor_name), NEW.billable_until);
      RETURN NEW;
    END IF;
    IF COALESCE(current_setting('managira.archive_override', true), '') <> 'support' THEN
      v_block := archive_restore_block(OLD.student_id, OLD.organization_id);
      IF v_block IS NOT NULL THEN
        RAISE EXCEPTION 'STUDENT_ARCHIVE_LOCKED:%', v_block USING ERRCODE = 'P0001';
      END IF;
    END IF;
    INSERT INTO student_archive_events
      (organization_id, student_id, action, archive_kind, actor_user_id, actor_name, billable_until)
    VALUES (OLD.organization_id, OLD.student_id,
            CASE WHEN OLD.undo_until IS NOT NULL AND NOW() <= OLD.undo_until THEN 'undone' ELSE 'restored' END,
            COALESCE(OLD.archive_kind, 'graduated'), v_actor_id, v_actor_name, OLD.billable_until);
    RETURN OLD;
  END $$ LANGUAGE plpgsql;

  DROP TRIGGER IF EXISTS archived_student_info_track ON archived_student_info;
  CREATE TRIGGER archived_student_info_track
    AFTER INSERT ON archived_student_info
    FOR EACH ROW EXECUTE FUNCTION track_student_archive();
  DROP TRIGGER IF EXISTS archived_student_info_guard ON archived_student_info;
  CREATE TRIGGER archived_student_info_guard
    BEFORE DELETE ON archived_student_info
    FOR EACH ROW EXECUTE FUNCTION track_student_archive();
`;

// Archives that existed before these rules: their time, and they were graduations.
const BACKFILL_SQL = `
  UPDATE archived_student_info
     SET archived_at_ts = COALESCE(archived_at_ts, archived_at::timestamptz),
         archive_kind = COALESCE(archive_kind, 'graduated')
   WHERE archived_at_ts IS NULL OR archive_kind IS NULL;
`;

async function ensureStudentArchiveSchema(db) {
  if (!ready) {
    ready = (async () => {
      // The defaults must not touch rows that already exist, so columns are
      // added first (above, without defaults) and defaults set afterwards.
      await db.query(SCHEMA_SQL);
      await db.query(BACKFILL_SQL);
    })().catch((err) => {
      ready = null;
      throw err;
    });
  }
  return ready;
}

// Students the school is billed for: active ones, plus anyone archived within
// the billing hold (archiving doesn't lower the very next bill).
function billableStudentSql(alias = "s") {
  return `(
    (COALESCE(${alias}.graduated, FALSE) = FALSE
      AND NOT EXISTS (SELECT 1 FROM archived_student_info archived
                       WHERE archived.student_id = ${alias}.student_id AND archived.organization_id = ${alias}.organization_id))
    OR EXISTS (SELECT 1 FROM archived_student_info held
                WHERE held.student_id = ${alias}.student_id AND held.organization_id = ${alias}.organization_id
                  AND held.billable_until > NOW())
  )`;
}

async function countBillableStudents(db, organizationId) {
  if (!organizationId) return 0;
  try {
    const { rows } = await db.query(
      `SELECT COUNT(*)::int AS cnt FROM students s WHERE s.organization_id = $1 AND ${billableStudentSql("s")}`,
      [organizationId]
    );
    return Number(rows[0]?.cnt || 0);
  } catch (_) {
    // Before the archive columns exist: the plain active count.
    return require("./activeStudents").countActiveStudents(db, organizationId);
  }
}

// Plain words for a restore block from archive_restore_block().
function describeRestoreBlock(block) {
  if (!block) return null;
  if (block === "permanent") return "Kept as a permanent graduate record. It can't be restored or edited.";
  if (block.startsWith("hold:")) {
    const date = new Date(`${block.slice(5)}T00:00:00Z`);
    const label = date.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" });
    return `Can be restored from ${label}.`;
  }
  return "Can't be restored right now.";
}

module.exports = {
  BILLING_HOLD_DAYS,
  UNDO_HOURS,
  LEAVE_REASONS,
  ensureStudentArchiveSchema,
  billableStudentSql,
  countBillableStudents,
  describeRestoreBlock,
};

// A student's archive status for display (null when active).
async function getStudentArchiveStatus(db, organizationId, studentId) {
  if (!organizationId || !studentId) return null;
  try {
    const { rows } = await db.query(
      `SELECT COALESCE(a.archive_kind, 'graduated') AS kind, a.reason, a.reason_note,
              COALESCE(a.archived_at_ts, a.archived_at::timestamptz) AS archived_at, a.archived_by_name,
              archive_restore_block(a.student_id, a.organization_id) AS block
         FROM archived_student_info a
        WHERE a.organization_id = $1 AND a.student_id = $2
        ORDER BY COALESCE(a.archived_at_ts, a.archived_at::timestamptz) DESC
        LIMIT 1`,
      [organizationId, studentId]
    );
    if (rows.length) {
      const row = rows[0];
      return {
        kind: row.kind,
        label: row.kind === "left" ? "Left school" : "Graduated",
        reason: row.reason || null,
        note: row.reason_note || null,
        archivedAt: row.archived_at,
        archivedBy: row.archived_by_name || null,
        permanent: row.block === "permanent",
      };
    }
    // Marked graduated by older code without an archive record.
    const flag = await db.query(
      "SELECT 1 FROM students WHERE organization_id = $1 AND student_id = $2 AND COALESCE(graduated, FALSE)",
      [organizationId, studentId]
    );
    return flag.rows.length ? { kind: "graduated", label: "Graduated", reason: null, note: null, archivedAt: null, archivedBy: null, permanent: false } : null;
  } catch (_) {
    return null;
  }
}

module.exports.getStudentArchiveStatus = getStudentArchiveStatus;
