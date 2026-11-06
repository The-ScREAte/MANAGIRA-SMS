// Plans, prices, features and other platform data are managed on the control shard. Every
// other shard keeps an identical copy, so a school's plan means the same thing everywhere.
const { connectTo, ident } = require("./catalog");
const { REFERENCE, SHARED_ROWS } = require("./schoolTables");

const NOT_FOR_TESTING = new Set(["app_settings", "promo_codes", ...Object.keys(SHARED_ROWS)]);

async function primaryKeyOf(client, table) {
  const { rows } = await client.query(`
    SELECT ARRAY(SELECT a.attname FROM unnest(k.conkey) u(attnum) JOIN pg_attribute a ON a.attrelid = k.conrelid AND a.attnum = u.attnum)::text[] AS columns
      FROM pg_constraint k WHERE k.conrelid = to_regclass($1) AND k.contype = 'p'`, [`public.${ident(table)}`]);
  return rows[0]?.columns || [];
}

async function columnsOf(client, table) {
  const { rows } = await client.query(
    "SELECT a.attname AS name FROM pg_attribute a WHERE a.attrelid = to_regclass($1) AND a.attnum > 0 AND NOT a.attisdropped ORDER BY a.attnum",
    [`public.${ident(table)}`]
  );
  return rows.map((row) => row.name);
}

// Copies the control shard's reference tables here: new and changed rows, and rows the
// control shard no longer has, as long as nothing here still uses them.
async function syncReferenceData(source, destination, { environment = "production" } = {}) {
  let changed = environment === "production" ? await syncPlatformAdmins(source, destination) : 0;
  for (const table of [...REFERENCE, ...Object.keys(SHARED_ROWS)]) {
    const only = SHARED_ROWS[table] || "TRUE";
    if (environment !== "production" && NOT_FOR_TESTING.has(table)) continue;
    const [fromColumns, toColumns, key] = await Promise.all([columnsOf(source, table), columnsOf(destination, table), primaryKeyOf(destination, table)]);
    if (!fromColumns.length || !toColumns.length || !key.length) continue;
    const columns = fromColumns.filter((column) => toColumns.includes(column));
    const list = columns.map(ident).join(", ");
    const { rows } = await source.query(`SELECT COALESCE(JSON_AGG(t), '[]')::text AS rows FROM (SELECT ${list} FROM ${ident(table)} WHERE ${only}) t`);
    const updates = columns.filter((column) => !key.includes(column)).map((column) => `${ident(column)} = EXCLUDED.${ident(column)}`).join(", ");
    const distinct = columns.filter((column) => !key.includes(column)).map((column) => `${ident(table)}.${ident(column)} IS DISTINCT FROM EXCLUDED.${ident(column)}`).join(" OR ");
    const result = await destination.query(
      `INSERT INTO ${ident(table)} (${list}) SELECT ${list} FROM JSON_POPULATE_RECORDSET(NULL::${ident(table)}, $1::json)
       ON CONFLICT (${key.map(ident).join(", ")}) ${updates ? `DO UPDATE SET ${updates} WHERE ${distinct}` : "DO NOTHING"}`,
      [rows[0].rows]
    );
    changed += result.rowCount;
    const match = key.map((column) => `t.${ident(column)} = v.${ident(column)}`).join(" AND ");
    await destination.query(
      `DELETE FROM ${ident(table)} t WHERE ${only} AND NOT EXISTS (SELECT 1 FROM JSON_POPULATE_RECORDSET(NULL::${ident(table)}, $1::json) v WHERE ${match})`,
      [rows[0].rows]
    ).then((removed) => { changed += removed.rowCount; }).catch(() => {}); // Still in use here: it stays.
  }
  return changed;
}

// Super admins sign in on any production shard to look after its schools.
const ADMIN_TYPES = ["Admin", "Mini Admin", "Internal Worker"];
async function syncPlatformAdmins(source, destination) {
  const [fromColumns, toColumns] = await Promise.all([columnsOf(source, "users"), columnsOf(destination, "users")]);
  const columns = fromColumns.filter((column) => toColumns.includes(column));
  const list = columns.map(ident).join(", ");
  const { rows } = await source.query(
    `SELECT COALESCE(JSON_AGG(t), '[]')::text AS rows FROM (SELECT ${list} FROM users WHERE organization_id IS NULL AND account_type::text = ANY($1::text[])) t`,
    [ADMIN_TYPES]
  );
  const updates = columns.filter((column) => column !== "user_id").map((column) => `${ident(column)} = EXCLUDED.${ident(column)}`).join(", ");
  const saved = await destination.query(
    `INSERT INTO users (${list}) SELECT ${list} FROM JSON_POPULATE_RECORDSET(NULL::users, $1::json)
     ON CONFLICT (user_id) DO UPDATE SET ${updates}`,
    [rows[0].rows]
  );
  await destination.query(
    `DELETE FROM users u WHERE u.organization_id IS NULL AND u.account_type::text = ANY($2::text[])
       AND NOT EXISTS (SELECT 1 FROM JSON_POPULATE_RECORDSET(NULL::users, $1::json) v WHERE v.user_id = u.user_id)`,
    [rows[0].rows, ADMIN_TYPES]
  ).catch(() => {});
  return saved.rowCount;
}

async function syncFromControl(localDb, { environment } = {}) {
  const url = process.env.CONTROL_DB_URL;
  if (!url) return 0;
  const control = connectTo(url);
  await control.connect();
  try {
    return await syncReferenceData(control, localDb, { environment });
  } finally {
    await control.end().catch(() => {});
  }
}

module.exports = { syncReferenceData, syncFromControl };
