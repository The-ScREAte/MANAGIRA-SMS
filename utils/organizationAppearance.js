const MODES = ['white', 'warm', 'dark'];
let schemaPromise;

function normalizeAppearance(value) {
  return MODES.includes(value) ? value : 'white';
}

async function ensureAppearanceSchema(db) {
  if (!schemaPromise) {
    schemaPromise = db.query(`ALTER TABLE organizations
      ADD COLUMN IF NOT EXISTS appearance_mode VARCHAR(10) NOT NULL DEFAULT 'white'
      CHECK (appearance_mode IN ('white', 'warm', 'dark'))`).catch(error => {
      schemaPromise = undefined;
      throw error;
    });
  }
  await schemaPromise;
}

async function saveAppearance(db, orgId, mode) {
  if (!orgId || !MODES.includes(mode)) throw new Error('Invalid school appearance');
  await ensureAppearanceSchema(db);
  await db.query('UPDATE organizations SET appearance_mode = $1 WHERE organization_id = $2', [mode, orgId]);
  return mode;
}

module.exports = { MODES, normalizeAppearance, ensureAppearanceSchema, saveAppearance };