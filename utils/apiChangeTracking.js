// What integrations need for incremental sync ("give me what changed since my
// last sync") instead of downloading everything each time:
//
//  - students.api_changed_at: set on insert (column default) and on every update
//    by a trigger, so any change anywhere in the app is caught.
//  - api_deleted_records: a trigger notes each deleted student, guardian and
//    attendance mark, so integrations can remove them too (GET /api/v1/deleted).
//
// Other tables already keep updated_at (guardians, staff, attendance, PayGira).
// Everything here is idempotent and only creates triggers that are missing.
const db = require("../config/db");

const TRACKED_DELETES = [
  { table: "students", entity: "student", idColumn: "student_id" },
  { table: "guardian_profiles", entity: "guardian", idColumn: "guardian_id" },
  { table: "attendance_records", entity: "attendance", idColumn: "attendance_id" },
];

let promise = null;
function ensureChangeTracking(database = db) {
  if (!promise) {
    promise = (async () => {
      await database.query(`ALTER TABLE students ADD COLUMN IF NOT EXISTS api_changed_at TIMESTAMPTZ NOT NULL DEFAULT NOW()`);
      await database.query(`CREATE INDEX IF NOT EXISTS idx_students_org_api_changed ON students (organization_id, api_changed_at)`);
      await database.query(`
        CREATE OR REPLACE FUNCTION api_touch_changed_at() RETURNS trigger AS $$
        BEGIN
          NEW.api_changed_at := clock_timestamp();
          RETURN NEW;
        END $$ LANGUAGE plpgsql`);
      await database.query(`DO $$ BEGIN
          IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_students_api_changed') THEN
            CREATE TRIGGER trg_students_api_changed BEFORE UPDATE ON students
              FOR EACH ROW EXECUTE FUNCTION api_touch_changed_at();
          END IF;
        END $$`);

      await database.query(`
        CREATE TABLE IF NOT EXISTS api_deleted_records (
          id BIGSERIAL PRIMARY KEY,
          organization_id INTEGER,
          entity VARCHAR(30) NOT NULL,
          record_id INTEGER NOT NULL,
          deleted_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )`);
      await database.query(`CREATE INDEX IF NOT EXISTS idx_api_deleted_records_org ON api_deleted_records (organization_id, deleted_at)`);
      // Never lets a deletion fail: if noting it goes wrong, the delete still happens.
      await database.query(`
        CREATE OR REPLACE FUNCTION api_record_deletion() RETURNS trigger AS $$
        BEGIN
          BEGIN
            INSERT INTO api_deleted_records (organization_id, entity, record_id)
            VALUES ((to_jsonb(OLD) ->> 'organization_id')::int, TG_ARGV[0], (to_jsonb(OLD) ->> TG_ARGV[1])::int);
          EXCEPTION WHEN OTHERS THEN
            NULL;
          END;
          RETURN OLD;
        END $$ LANGUAGE plpgsql`);
      for (const t of TRACKED_DELETES) {
        const name = `trg_${t.table}_api_deleted`;
        await database.query(`DO $$ BEGIN
            IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = '${name}') THEN
              CREATE TRIGGER ${name} AFTER DELETE ON ${t.table}
                FOR EACH ROW EXECUTE FUNCTION api_record_deletion('${t.entity}', '${t.idColumn}');
            END IF;
          END $$`);
      }
    })().catch((error) => { promise = null; throw error; });
  }
  return promise;
}

module.exports = { ensureChangeTracking, TRACKED_DELETES };
