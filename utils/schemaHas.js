"use strict";

// A quick, read-only check that tables, columns and triggers already exist, so code that used to
// run "ADD COLUMN IF NOT EXISTS" or re-create a trigger on every new server can skip it: those
// statements take an exclusive lock on busy tables (organizations, assessments) and, waiting for
// it on a shared database, made pages like the Testing Room fail. Table changes belong in
// database/migrations; these checks only cover databases that predate them.
// Once everything asked for has been found, it stays found (migrations only add, so a table or column
// never goes away while the server runs): the answer is kept and the catalog is not asked again.
// "Not there yet" is never kept, so a migration run later is noticed.
const found = new Set();

async function schemaHas(db, { tables = [], columns = [], triggers = [], nullable = [] } = {}) {
  const memoKey = JSON.stringify([tables, columns, triggers, nullable]);
  if (found.has(memoKey)) return true;
  const { rows } = await db.query(
    `SELECT
       (SELECT COUNT(*)::int FROM unnest($1::text[]) t WHERE to_regclass('public.' || t) IS NOT NULL) AS tables,
       (SELECT COUNT(*)::int FROM information_schema.columns c
          JOIN unnest($2::text[], $3::text[]) AS w(tbl, col) ON c.table_name = w.tbl AND c.column_name = w.col
         WHERE c.table_schema = 'public') AS columns,
       (SELECT COUNT(*)::int FROM pg_trigger WHERE NOT tgisinternal AND tgname = ANY($4::text[])) AS triggers,
       (SELECT COUNT(*)::int FROM information_schema.columns c
          JOIN unnest($5::text[], $6::text[]) AS w(tbl, col) ON c.table_name = w.tbl AND c.column_name = w.col
         WHERE c.table_schema = 'public' AND c.is_nullable = 'YES') AS nullable`,
    [tables, columns.map((c) => c[0]), columns.map((c) => c[1]), triggers, nullable.map((c) => c[0]), nullable.map((c) => c[1])]
  );
  const r = rows[0] || {};
  const all = r.tables === tables.length && r.columns === columns.length && r.triggers === triggers.length && r.nullable === nullable.length;
  // (a column's "may be empty" can change with a migration, so a check on that is always asked again)
  if (all && !nullable.length) found.add(memoKey);
  return all;
}

// True when everything is there; false (never throws) when it isn't or the check couldn't run.
const alreadyThere = (db, spec) => schemaHas(db, spec).catch(() => false);

module.exports = { schemaHas, alreadyThere };
