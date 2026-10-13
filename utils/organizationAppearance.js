// Each person picks how the school app looks for them: white (default), gray
// or dark. Stored per account (staff user, school owner, guardian or student),
// never per school, and kept in the session after the first read.
const MODES = ['white', 'gray', 'dark'];
let schemaPromise;

function normalizeAppearance(value) {
  return MODES.includes(value) ? value : 'white';
}

// Who the choice belongs to: [kind, id] for the signed-in account, or null.
function appearanceOwner(session) {
  if (!session) return null;
  if (session.userId) return ['user', Number(session.userId)];
  if (session.guardianId) return ['guardian', Number(session.guardianId)];
  if (session.studentId) return ['student', Number(session.studentId)];
  if (session.organizationId && String(session.accountType || '') === 'Organization') return ['org', Number(session.organizationId)];
  return null;
}

async function ensureAppearanceSchema(db) {
  if (!schemaPromise) {
    schemaPromise = db.query(`CREATE TABLE IF NOT EXISTS account_appearance (
        account_kind VARCHAR(12) NOT NULL,
        account_id INTEGER NOT NULL,
        mode VARCHAR(10) NOT NULL DEFAULT 'white' CHECK (mode IN ('white', 'gray', 'dark')),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        PRIMARY KEY (account_kind, account_id)
      )`).catch((error) => {
      schemaPromise = undefined;
      throw error;
    });
  }
  await schemaPromise;
}

async function loadAppearance(db, session) {
  const owner = appearanceOwner(session);
  if (!owner) return 'white';
  await ensureAppearanceSchema(db);
  const { rows } = await db.query('SELECT mode FROM account_appearance WHERE account_kind = $1 AND account_id = $2', owner);
  return normalizeAppearance(rows[0] && rows[0].mode);
}

async function saveAppearance(db, session, mode) {
  const owner = appearanceOwner(session);
  if (!owner || !MODES.includes(mode)) throw new Error('Invalid appearance');
  await ensureAppearanceSchema(db);
  await db.query(
    `INSERT INTO account_appearance (account_kind, account_id, mode, updated_at) VALUES ($1, $2, $3, NOW())
     ON CONFLICT (account_kind, account_id) DO UPDATE SET mode = EXCLUDED.mode, updated_at = NOW()`,
    [owner[0], owner[1], mode]
  );
  return mode;
}

module.exports = { MODES, normalizeAppearance, appearanceOwner, ensureAppearanceSchema, loadAppearance, saveAppearance };
