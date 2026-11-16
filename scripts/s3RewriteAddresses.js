#!/usr/bin/env node
// After the files move to the new bucket (scripts/s3MoveToUs.js, docs/security/STORAGE.md), rewrites
// every stored address of the old bucket in the database to the same file in the new bucket, so
// nothing keeps reading the old one and it can be retired. Only the bucket part of an address
// changes; the file name stays.
//
//   node scripts/s3RewriteAddresses.js --from oneplaces3 --to <new-bucket> --region us-west-2
//        shows, per column, how many values name the old bucket; changes nothing
//   ... --apply    rewrites them, one column at a time, each in its own transaction
//
// Text, varchar, json and jsonb columns of every table are looked at, except logs and audit trails
// (they stay exactly as they were written) and sign-in sessions (they expire on their own).
"use strict";

require("dotenv").config();
const { Client } = require("pg");

const args = process.argv.slice(2);
const option = (name) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : null; };
const from = option("--from");
const to = option("--to");
const region = option("--region") || "us-west-2";
const apply = args.includes("--apply");
const ident = (name) => `"${String(name).replace(/"/g, '""')}"`;

(async () => {
  if (!from || !to) throw new Error("Pass --from <old bucket> and --to <new bucket>.");
  if (!/^[a-z0-9.-]{3,63}$/.test(from) || !/^[a-z0-9.-]{3,63}$/.test(to)) throw new Error("Bucket names look wrong.");
  if (!/^us-(east|west)-\d$/.test(region)) throw new Error("The new bucket's region must be a United States region.");
  const newHost = `${to}.s3.${region}.amazonaws.com`;
  // Every way an address of the old bucket is written: virtual-host style (with or without a
  // region) and path style.
  const pattern = `https?://(${from.replace(/\./g, "\\.")}\\.s3(\\.[a-z0-9-]+)?\\.amazonaws\\.com|s3(\\.[a-z0-9-]+)?\\.amazonaws\\.com/${from.replace(/\./g, "\\.")})/`;

  const cs = process.env.DB_CONNECTION_STRING;
  const db = new Client({ connectionString: cs, ssl: cs.includes("sslmode=require") ? { rejectUnauthorized: false } : false, application_name: "s3-rewrite-addresses" });
  await db.connect();
  try {
    const { rows: columns } = await db.query(
      `SELECT c.table_name, c.column_name, c.data_type
         FROM information_schema.columns c
         JOIN information_schema.tables t ON t.table_schema = c.table_schema AND t.table_name = c.table_name AND t.table_type = 'BASE TABLE'
        WHERE c.table_schema = 'public' AND c.data_type IN ('text', 'character varying', 'json', 'jsonb')
        ORDER BY c.table_name, c.column_name`
    );
    let total = 0;
    const KEEP_AS_WRITTEN = /(^|_)(log|logs|audit|history|sessions)(_|$)|_log$|_logs$/i;
    for (const { table_name: table, column_name: column, data_type: type } of columns) {
      if (KEEP_AS_WRITTEN.test(table)) continue;
      const asText = type === "json" || type === "jsonb" ? `${ident(column)}::text` : ident(column);
      const { rows } = await db.query(`SELECT COUNT(*)::int AS n FROM ${ident(table)} WHERE ${asText} ~ $1`, [pattern]);
      const n = rows[0].n;
      if (!n) continue;
      total += n;
      console.log(`${table}.${column} (${type}): ${n} value${n === 1 ? "" : "s"}`);
      if (!apply) continue;
      const replaced = `regexp_replace(${asText}, $1, $2, 'g')`;
      const assign = type === "json" || type === "jsonb" ? `${replaced}::${type}` : replaced;
      await db.query("BEGIN");
      try {
        const result = await db.query(`UPDATE ${ident(table)} SET ${ident(column)} = ${assign} WHERE ${asText} ~ $1`, [pattern, `https://${newHost}/`]);
        await db.query("COMMIT");
        console.log(`  rewrote ${result.rowCount}`);
      } catch (error) {
        await db.query("ROLLBACK");
        throw new Error(`${table}.${column}: ${error.message}`);
      }
    }
    console.log(apply ? `\nDone: ${total} values now name ${newHost}.` : `\n${total} values name the old bucket. Nothing changed; run with --apply to rewrite them.`);
  } finally {
    await db.end();
  }
})().catch((error) => {
  console.error("Rewrite failed:", error.message);
  process.exit(1);
});
