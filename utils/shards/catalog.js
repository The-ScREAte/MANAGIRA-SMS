// Reads a database's structure, and can build the same structure in an empty database.
const { Client } = require("pg");

const ident = (name) => `"${String(name).replace(/"/g, '""')}"`;
const quote = (value) => `'${String(value).replace(/'/g, "''")}'`;

function connectTo(url, applicationName = "managira-shards") {
  const local = /@(localhost|127\.0\.0\.1)[:/]/.test(url);
  return new Client({ connectionString: url, ssl: local ? false : { rejectUnauthorized: false }, application_name: applicationName });
}

async function loadCatalog(client) {
  const columns = (await client.query(`
    SELECT c.relname AS table_name, a.attname AS name, format_type(a.atttypid, a.atttypmod) AS type, a.attnotnull AS required
      FROM pg_attribute a
      JOIN pg_class c ON c.oid = a.attrelid
      JOIN pg_namespace n ON n.oid = c.relnamespace
     WHERE n.nspname = 'public' AND c.relkind = 'r' AND a.attnum > 0 AND NOT a.attisdropped
     ORDER BY c.relname, a.attnum`)).rows;
  const tables = new Map();
  columns.forEach((column) => {
    if (!tables.has(column.table_name)) tables.set(column.table_name, { name: column.table_name, columns: [], primaryKey: [], triggers: [] });
    tables.get(column.table_name).columns.push({ name: column.name, type: column.type, required: column.required });
  });
  const keys = (await client.query(`
    SELECT c.relname AS table_name, ARRAY(
             SELECT a.attname FROM unnest(k.conkey) WITH ORDINALITY u(attnum, ord)
             JOIN pg_attribute a ON a.attrelid = k.conrelid AND a.attnum = u.attnum ORDER BY u.ord)::text[] AS columns
      FROM pg_constraint k JOIN pg_class c ON c.oid = k.conrelid JOIN pg_namespace n ON n.oid = c.relnamespace
     WHERE k.contype = 'p' AND n.nspname = 'public'`)).rows;
  keys.forEach((key) => { if (tables.has(key.table_name)) tables.get(key.table_name).primaryKey = key.columns; });
  const triggers = (await client.query(`
    SELECT c.relname AS table_name, t.tgname AS name
      FROM pg_trigger t JOIN pg_class c ON c.oid = t.tgrelid JOIN pg_namespace n ON n.oid = c.relnamespace
     WHERE NOT t.tgisinternal AND t.tgenabled <> 'D' AND n.nspname = 'public'`)).rows;
  triggers.forEach((trigger) => { if (tables.has(trigger.table_name)) tables.get(trigger.table_name).triggers.push(trigger.name); });
  const foreignKeys = (await client.query(`
    SELECT con.conname AS name, ch.relname AS child, pa.relname AS parent,
           ARRAY(SELECT a.attname FROM unnest(con.conkey) WITH ORDINALITY u(attnum, ord)
                 JOIN pg_attribute a ON a.attrelid = con.conrelid AND a.attnum = u.attnum ORDER BY u.ord)::text[] AS columns,
           ARRAY(SELECT a.attname FROM unnest(con.confkey) WITH ORDINALITY u(attnum, ord)
                 JOIN pg_attribute a ON a.attrelid = con.confrelid AND a.attnum = u.attnum ORDER BY u.ord)::text[] AS parent_columns
      FROM pg_constraint con
      JOIN pg_class ch ON ch.oid = con.conrelid
      JOIN pg_class pa ON pa.oid = con.confrelid
      JOIN pg_namespace n ON n.oid = ch.relnamespace
     WHERE con.contype = 'f' AND n.nspname = 'public'`)).rows;
  foreignKeys.forEach((fk) => {
    const child = tables.get(fk.child);
    fk.required = child ? fk.columns.some((name) => child.columns.find((column) => column.name === name)?.required) : false;
  });
  return { tables, foreignKeys };
}

// What the destination is missing for a school's rows to fit.
function schemaDifferences(source, destination, tableNames) {
  const problems = [];
  tableNames.forEach((name) => {
    const from = source.tables.get(name);
    const to = destination.tables.get(name);
    if (!to) { problems.push(`The destination has no table ${name}.`); return; }
    from.columns.forEach((column) => {
      const match = to.columns.find((other) => other.name === column.name);
      if (!match) problems.push(`The destination has no column ${name}.${column.name}.`);
      else if (match.type !== column.type) problems.push(`${name}.${column.name} is ${column.type} here and ${match.type} there.`);
    });
  });
  return problems;
}

// Everything needed to rebuild this database's structure, in order. Read-only.
async function schemaStatements(client, { typeMap = {}, skipExtensions = [] } = {}) {
  await client.query("SET search_path = public");
  const statements = [];
  const notFromExtension = (alias) => `NOT EXISTS (SELECT 1 FROM pg_depend d WHERE d.objid = ${alias}.oid AND d.deptype = 'e')`;

  (await client.query("SELECT extname FROM pg_extension WHERE extname <> 'plpgsql' ORDER BY 1")).rows.forEach(({ extname }) => {
    if (!skipExtensions.includes(extname)) statements.push(`CREATE EXTENSION IF NOT EXISTS ${ident(extname)}`);
  });
  (await client.query(`
    SELECT t.typname, ARRAY(SELECT e.enumlabel::text FROM pg_enum e WHERE e.enumtypid = t.oid ORDER BY e.enumsortorder) AS labels
      FROM pg_type t JOIN pg_namespace n ON n.oid = t.typnamespace
     WHERE n.nspname = 'public' AND t.typtype = 'e' AND ${notFromExtension("t")} ORDER BY 1`)).rows.forEach((row) => {
    statements.push(`CREATE TYPE ${ident(row.typname)} AS ENUM (${row.labels.map(quote).join(", ")})`);
  });
  (await client.query(`
    SELECT t.typname, format_type(t.typbasetype, t.typtypmod) AS base, t.typnotnull, t.typdefault,
           ARRAY(SELECT pg_get_constraintdef(c.oid) FROM pg_constraint c WHERE c.contypid = t.oid) AS checks
      FROM pg_type t JOIN pg_namespace n ON n.oid = t.typnamespace
     WHERE n.nspname = 'public' AND t.typtype = 'd' AND ${notFromExtension("t")} ORDER BY 1`)).rows.forEach((row) => {
    statements.push(`CREATE DOMAIN ${ident(row.typname)} AS ${row.base}${row.typdefault ? ` DEFAULT ${row.typdefault}` : ""}${row.typnotnull ? " NOT NULL" : ""} ${row.checks.join(" ")}`);
  });
  (await client.query(`
    SELECT s.sequencename, s.data_type, s.start_value, s.min_value, s.max_value, s.increment_by, s.cycle, s.cache_size
      FROM pg_sequences s WHERE s.schemaname = 'public' ORDER BY 1`)).rows.forEach((row) => {
    statements.push(`CREATE SEQUENCE IF NOT EXISTS ${ident(row.sequencename)} AS ${row.data_type} INCREMENT BY ${row.increment_by} MINVALUE ${row.min_value} MAXVALUE ${row.max_value} START WITH ${row.start_value} CACHE ${row.cache_size}${row.cycle ? " CYCLE" : ""}`);
  });
  (await client.query(`
    SELECT pg_get_functiondef(p.oid) AS definition
      FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname = 'public' AND p.prokind = 'f' AND ${notFromExtension("p")} ORDER BY p.proname`)).rows.forEach((row) => statements.push(row.definition));

  const columns = (await client.query(`
    SELECT c.relname AS table_name, a.attname, format_type(a.atttypid, a.atttypmod) AS type, a.attnotnull,
           pg_get_expr(d.adbin, d.adrelid) AS default_value, a.attidentity, a.attgenerated
      FROM pg_attribute a
      JOIN pg_class c ON c.oid = a.attrelid
      JOIN pg_namespace n ON n.oid = c.relnamespace
      LEFT JOIN pg_attrdef d ON d.adrelid = a.attrelid AND d.adnum = a.attnum
     WHERE n.nspname = 'public' AND c.relkind = 'r' AND a.attnum > 0 AND NOT a.attisdropped
     ORDER BY c.relname, a.attnum`)).rows;
  const byTable = new Map();
  columns.forEach((column) => {
    if (!byTable.has(column.table_name)) byTable.set(column.table_name, []);
    const base = column.type.replace(/\(.*$/, "");
    const type = Object.hasOwn(typeMap, base) ? typeMap[base] : column.type;
    const parts = [`${ident(column.attname)} ${type}`];
    if (column.attgenerated) parts.push(`GENERATED ALWAYS AS (${column.default_value}) STORED`);
    else if (column.default_value) parts.push(`DEFAULT ${column.default_value}`);
    if (column.attidentity) parts.push(`GENERATED ${column.attidentity === "a" ? "ALWAYS" : "BY DEFAULT"} AS IDENTITY`);
    if (column.attnotnull) parts.push("NOT NULL");
    byTable.get(column.table_name).push(parts.join(" "));
  });
  byTable.forEach((definitions, table) => statements.push(`CREATE TABLE IF NOT EXISTS ${ident(table)} (\n  ${definitions.join(",\n  ")}\n)`));

  (await client.query(`
    SELECT s.relname AS sequence_name, t.relname AS table_name, a.attname
      FROM pg_depend d
      JOIN pg_class s ON s.oid = d.objid AND s.relkind = 'S'
      JOIN pg_class t ON t.oid = d.refobjid
      JOIN pg_attribute a ON a.attrelid = t.oid AND a.attnum = d.refobjsubid
      JOIN pg_namespace n ON n.oid = s.relnamespace
     WHERE d.deptype = 'a' AND n.nspname = 'public'`)).rows.forEach((row) => {
    statements.push(`ALTER SEQUENCE ${ident(row.sequence_name)} OWNED BY ${ident(row.table_name)}.${ident(row.attname)}`);
  });

  const constraints = (await client.query(`
    SELECT c.relname AS table_name, k.conname, k.contype, pg_get_constraintdef(k.oid) AS definition
      FROM pg_constraint k JOIN pg_class c ON c.oid = k.conrelid JOIN pg_namespace n ON n.oid = c.relnamespace
     WHERE n.nspname = 'public' AND c.relkind = 'r' AND k.contype IN ('p', 'u', 'c', 'x', 'f')
     ORDER BY CASE k.contype WHEN 'p' THEN 0 WHEN 'u' THEN 1 WHEN 'x' THEN 2 WHEN 'c' THEN 3 ELSE 4 END, c.relname, k.conname`)).rows;
  constraints.filter((row) => row.contype !== "f").forEach((row) => {
    statements.push(`ALTER TABLE ${ident(row.table_name)} ADD CONSTRAINT ${ident(row.conname)} ${row.definition}`);
  });
  (await client.query(`
    SELECT pg_get_indexdef(i.indexrelid) AS definition
      FROM pg_index i
      JOIN pg_class c ON c.oid = i.indrelid
      JOIN pg_namespace n ON n.oid = c.relnamespace
     WHERE n.nspname = 'public' AND c.relkind = 'r'
       AND NOT EXISTS (SELECT 1 FROM pg_constraint k WHERE k.conindid = i.indexrelid AND k.contype IN ('p', 'u', 'x'))
     ORDER BY 1`)).rows.forEach((row) => statements.push(row.definition));
  constraints.filter((row) => row.contype === "f").forEach((row) => {
    statements.push(`ALTER TABLE ${ident(row.table_name)} ADD CONSTRAINT ${ident(row.conname)} ${row.definition}`);
  });
  (await client.query(`
    SELECT c.relname, pg_get_viewdef(c.oid) AS definition
      FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
     WHERE n.nspname = 'public' AND c.relkind = 'v' AND ${notFromExtension("c")} ORDER BY 1`)).rows.forEach((row) => {
    statements.push(`CREATE OR REPLACE VIEW ${ident(row.relname)} AS ${row.definition}`);
  });
  (await client.query(`
    SELECT pg_get_triggerdef(t.oid) AS definition
      FROM pg_trigger t JOIN pg_class c ON c.oid = t.tgrelid JOIN pg_namespace n ON n.oid = c.relnamespace
     WHERE NOT t.tgisinternal AND n.nspname = 'public' ORDER BY c.relname, t.tgname`)).rows.forEach((row) => statements.push(row.definition));
  return statements;
}

// Builds the structure in an empty database. All or nothing.
async function applySchema(destination, statements) {
  await destination.query("BEGIN");
  try {
    await destination.query("SET LOCAL check_function_bodies = off");
    for (const statement of statements) await destination.query(statement);
    await destination.query("COMMIT");
  } catch (error) {
    await destination.query("ROLLBACK");
    throw error;
  }
}

// Every counter in a shard starts in its own block, so an id can never mean two different
// records on two shards. That's what lets a school move and keep its ids. Block 0 is the
// original database; each block holds 100 million ids.
const ID_BLOCK_SIZE = 100000000;

async function assignIdBlock(client, block) {
  if (!Number.isInteger(block) || block < 1 || block > 20) throw new Error("A shard's id block must be from 1 to 20.");
  const start = block * ID_BLOCK_SIZE;
  const sequences = (await client.query("SELECT sequencename FROM pg_sequences WHERE schemaname = 'public'")).rows;
  for (const { sequencename } of sequences) {
    await client.query("SELECT setval($1::regclass, $2, false)", [ident(sequencename), start]);
  }
  return sequences.length;
}

module.exports = { ident, connectTo, loadCatalog, schemaDifferences, schemaStatements, applySchema, assignIdBlock, ID_BLOCK_SIZE };
