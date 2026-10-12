// User licenses: how many people may sign in to a hub (owner included) or to a
// school (its staff accounts). Set by Managira admins; empty means no limit.

let ready = null;
function ensureLicenseSchema(db) {
  if (!ready) {
    ready = (async () => {
      await db.query('ALTER TABLE managira_hubs ADD COLUMN IF NOT EXISTS max_users INTEGER');
      await db.query('ALTER TABLE organizations ADD COLUMN IF NOT EXISTS max_users INTEGER');
      // The admin hub form saves contract dates; older databases never got these columns.
      await db.query('ALTER TABLE managira_hubs ADD COLUMN IF NOT EXISTS contract_start_date DATE');
      await db.query('ALTER TABLE managira_hubs ADD COLUMN IF NOT EXISTS contract_end_date DATE');
    })().catch((err) => { ready = null; throw err; });
  }
  return ready;
}

const parseLimit = (value) => {
  const n = parseInt(String(value == null ? '' : value).trim(), 10);
  return Number.isInteger(n) && n > 0 ? Math.min(n, 100000) : null;
};

// Staff accounts that count against a school's licenses (not Managira's own accounts).
const ORG_USER_COUNT_SQL = `SELECT COUNT(*)::int AS used FROM users
  WHERE organization_id = $1 AND LOWER(COALESCE(account_type::text, '')) NOT IN ('admin', 'internal worker', 'mini admin')`;

async function orgLicense(db, organizationId) {
  await ensureLicenseSchema(db);
  const [org, count] = await Promise.all([
    db.query('SELECT max_users FROM organizations WHERE organization_id = $1', [organizationId]),
    db.query(ORG_USER_COUNT_SQL, [organizationId]),
  ]);
  const max = org.rows[0] ? org.rows[0].max_users : null;
  const used = count.rows[0].used;
  return { max, used, left: max == null ? null : Math.max(0, max - used), full: max != null && used >= max };
}

// Hub licenses count the owner plus every hub user.
async function hubLicense(db, hubId) {
  await ensureLicenseSchema(db);
  const [hub, count] = await Promise.all([
    db.query('SELECT max_users FROM managira_hubs WHERE hub_id = $1', [hubId]),
    db.query('SELECT COUNT(*)::int AS n FROM hub_users WHERE hub_id = $1', [hubId]).catch(() => ({ rows: [{ n: 0 }] })),
  ]);
  const max = hub.rows[0] ? hub.rows[0].max_users : null;
  const used = count.rows[0].n + 1;
  return { max, used, left: max == null ? null : Math.max(0, max - used), full: max != null && used >= max };
}

module.exports = { ensureLicenseSchema, parseLimit, orgLicense, hubLicense, ORG_USER_COUNT_SQL };
