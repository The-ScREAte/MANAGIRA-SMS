// Reports a hub saved from the Reports page: what was asked for (config) and
// the table as it was when saved (snapshot), so it can be opened again later.

const REPORT_TYPES = ['attendance', 'academic', 'gender', 'marks', 'support', 'enrollment', 'comparison'];
const MAX_SNAPSHOT_BYTES = 300 * 1024;

let schemaReady = null;
function ensureSavedReportsSchema(db) {
  if (!schemaReady) {
    schemaReady = (async () => {
      await db.query(`
        CREATE TABLE IF NOT EXISTS hub_saved_reports (
          report_id SERIAL PRIMARY KEY,
          hub_id INTEGER NOT NULL REFERENCES managira_hubs(hub_id) ON DELETE CASCADE,
          name VARCHAR(120) NOT NULL,
          report_type VARCHAR(30) NOT NULL,
          config JSONB NOT NULL DEFAULT '{}'::jsonb,
          snapshot JSONB NOT NULL DEFAULT '{}'::jsonb,
          created_by_hub_user_id INTEGER,
          created_by_name VARCHAR(200),
          created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )`);
      await db.query('CREATE INDEX IF NOT EXISTS hub_saved_reports_hub_idx ON hub_saved_reports (hub_id, created_at DESC)');
    })().catch((err) => { schemaReady = null; throw err; });
  }
  return schemaReady;
}

function actorName(actor, hub) {
  if (actor && actor.user) return `${actor.user.first_name || ''} ${actor.user.last_name || ''}`.trim();
  return [hub && hub.first_name, hub && hub.last_name].filter(Boolean).join(' ') || 'Hub owner';
}

function canDelete(actor, row) {
  if (!actor || !row) return false;
  if (actor.role === 'hub_admin') return true;
  return !!actor.hubUserId && Number(actor.hubUserId) === Number(row.created_by_hub_user_id);
}

async function list(db, hubId) {
  await ensureSavedReportsSchema(db);
  const { rows } = await db.query(
    `SELECT report_id, name, report_type, created_by_hub_user_id, created_by_name, created_at,
            COALESCE(jsonb_array_length(snapshot->'rows'), 0) AS school_count
       FROM hub_saved_reports WHERE hub_id = $1 ORDER BY created_at DESC LIMIT 200`,
    [hubId]
  );
  return rows;
}

async function get(db, hubId, reportId) {
  await ensureSavedReportsSchema(db);
  const { rows } = await db.query('SELECT * FROM hub_saved_reports WHERE hub_id = $1 AND report_id = $2', [hubId, reportId]);
  return rows[0] || null;
}

async function create(db, hubId, actor, hub, body) {
  await ensureSavedReportsSchema(db);
  const name = String((body && body.name) || '').trim().slice(0, 120);
  const type = String((body && body.type) || '');
  if (!name) throw Object.assign(new Error('Give the report a name.'), { userMessage: 'Give the report a name.' });
  if (!REPORT_TYPES.includes(type)) throw Object.assign(new Error('Unknown report.'), { userMessage: 'Unknown report.' });
  const config = body.config && typeof body.config === 'object' ? body.config : {};
  const snapshot = body.snapshot && typeof body.snapshot === 'object' ? body.snapshot : {};
  if (JSON.stringify(snapshot).length + JSON.stringify(config).length > MAX_SNAPSHOT_BYTES) {
    throw Object.assign(new Error('Report too large.'), { userMessage: 'This report is too large to save.' });
  }
  const { rows } = await db.query(
    `INSERT INTO hub_saved_reports (hub_id, name, report_type, config, snapshot, created_by_hub_user_id, created_by_name)
     VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING report_id`,
    [hubId, name, type, config, snapshot, actor && actor.hubUserId ? actor.hubUserId : null, actorName(actor, hub)]
  );
  return rows[0].report_id;
}

async function remove(db, hubId, reportId) {
  await ensureSavedReportsSchema(db);
  await db.query('DELETE FROM hub_saved_reports WHERE hub_id = $1 AND report_id = $2', [hubId, reportId]);
}

module.exports = { REPORT_TYPES, ensureSavedReportsSchema, list, get, create, remove, canDelete };
