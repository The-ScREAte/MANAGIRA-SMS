// Each person picks how Managira looks for them: light (the default, a soft
// gray) or dark. Stored per account (staff user, school owner, guardian,
// student, hub owner or hub user), never per school, and kept in the session
// after the first read. Older saves of "white" read as light.
const MODES = ['gray', 'dark'];
let schemaPromise;

function normalizeAppearance(value) {
  return value === 'dark' ? 'dark' : 'gray';
}

// Who the choice belongs to: [kind, id] for the signed-in account, or null.
function appearanceOwner(session) {
  if (!session) return null;
  // A Managira admin looking at a hub or a school keeps their own choice.
  if (session.adminHubView && session.userId) return ['user', Number(session.userId)];
  // Hub people (also while they have a school open from the hub).
  if (session.hubId && (session.hubOrgSwitch || !session.organizationId)) {
    return session.hubUserId ? ['hubuser', Number(session.hubUserId)] : ['hub', Number(session.hubId)];
  }
  if (session.userId) return ['user', Number(session.userId)];
  if (session.guardianId) return ['guardian', Number(session.guardianId)];
  if (session.studentId) return ['student', Number(session.studentId)];
  if (session.organizationId && String(session.accountType || '') === 'Organization') return ['org', Number(session.organizationId)];
  // School staff sign-ins keep their id on session.user only.
  const staffId = Number(session.user && session.user.user_id);
  if (session.organizationId && Number.isInteger(staffId) && staffId > 0) return ['user', staffId];
  return null;
}

async function ensureAppearanceSchema(db) {
  if (!schemaPromise) {
    schemaPromise = db.query(`CREATE TABLE IF NOT EXISTS account_appearance (
        account_kind VARCHAR(12) NOT NULL,
        account_id INTEGER NOT NULL,
        mode VARCHAR(10) NOT NULL DEFAULT 'gray' CHECK (mode IN ('white', 'gray', 'dark')),
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
  if (!owner) return 'gray';
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
