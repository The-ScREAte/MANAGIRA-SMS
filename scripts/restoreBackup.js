#!/usr/bin/env node
// Restores a nightly backup (utils/backups.js) into an EMPTY database. docs/BACKUPS.md.
//
//   node scripts/restoreBackup.js --list
//   node scripts/restoreBackup.js --from latest --to postgres://.../new_database
//   node scripts/restoreBackup.js --from managira-2026-11-13T03-20-00-000Z.mgbk --to ...
//   node scripts/restoreBackup.js --from ./copy-of-a-backup.mgbk --to ...
//
// Needs BACKUP_ENCRYPTION_KEY (or --key-file) and, for S3, the BACKUP_* storage settings. It
// never writes to DB_CONNECTION_STRING (the live database) or to a database that has tables. It
// runs in one transaction, checks every table's row count, and says how long each part took.
"use strict";
require("dotenv").config();
const fs = require("fs");
const { Client } = require("pg");
const backups = require("../utils/backups");

const args = process.argv.slice(2);
const option = (name) => { const i = args.indexOf(name); return i === -1 ? null : args[i + 1]; };
const seconds = (since) => ((Date.now() - since) / 1000).toFixed(1) + "s";
const sameDatabase = (a, b) => {
  try { const x = new URL(a); const y = new URL(b); return x.hostname === y.hostname && (x.port || "5432") === (y.port || "5432") && x.pathname === y.pathname; } catch (_) { return false; }
};

(async () => {
  const store = backups.storage();
  if (args.includes("--list")) {
    if (store.error) throw new Error(store.error);
    const list = (await store.list()).sort((a, b) => new Date(b.at) - new Date(a.at));
    list.forEach((b) => console.log(`${new Date(b.at).toISOString()}  ${(b.size / 1048576).toFixed(1)} MB  ${b.name}`));
    console.log(`${list.length} backups in ${store.where}`);
    return;
  }
  const from = option("--from");
  const to = option("--to");
  if (!from || !to) throw new Error("Use --from <backup|latest|file> --to <postgres url of an empty database>, or --list.");
  if (process.env.DB_CONNECTION_STRING && sameDatabase(to, process.env.DB_CONNECTION_STRING)) throw new Error("That's the database the app runs on. Restore into a new, empty database.");
  const keyText = option("--key-file") ? fs.readFileSync(option("--key-file"), "utf8") : process.env.BACKUP_ENCRYPTION_KEY;
  const key = backups.keyFrom(keyText);
  if (!key) throw new Error("No key: set BACKUP_ENCRYPTION_KEY or pass --key-file.");

  const started = Date.now();
  const sealed = backups.tempFile("backup.mgbk");
  const plain = backups.tempFile("backup.gz");
  const client = new Client({ connectionString: to, ssl: /sslmode=require|render\.com/.test(to) ? { rejectUnauthorized: false } : false });
  let connected = false; // a client never connected must not be asked anything: it would wait forever
  try {
    let phase = Date.now();
    if (fs.existsSync(from)) await fs.promises.copyFile(from, sealed);
    else {
      if (store.error) throw new Error(store.error);
      let name = from;
      if (from === "latest") {
        const list = (await store.list()).sort((a, b) => new Date(b.at) - new Date(a.at));
        if (!list.length) throw new Error(`There are no backups in ${store.where}.`);
        name = list[0].name;
      }
      await store.download(name, sealed);
      console.log(`Downloaded ${name} (${(fs.statSync(sealed).size / 1048576).toFixed(1)} MB) in ${seconds(phase)}`);
    }
    phase = Date.now();
    await backups.decryptFile(sealed, plain, key);
    console.log(`Decrypted and checked in ${seconds(phase)}`);

    await client.connect();
    connected = true;
    const { rows: [{ n }] } = await client.query("SELECT COUNT(*)::int AS n FROM pg_class c JOIN pg_namespace ns ON ns.oid = c.relnamespace WHERE ns.nspname = current_schema() AND c.relkind IN ('r', 'v', 'S')");
    if (n > 0) throw new Error("That database isn't empty. Restore into a new, empty one.");
    phase = Date.now();
    await client.query("BEGIN");
    const result = await backups.restoreFile(client, plain);
    await client.query("COMMIT");
    console.log(`Restored ${result.tables} tables and ${result.rows} rows (backup of ${result.header.at}, Postgres ${result.header.server}) in ${seconds(phase)}; every table's count checked`);
    console.log(`Done in ${seconds(started)}.`);
  } catch (error) {
    if (connected) await client.query("ROLLBACK").catch(() => {});
    throw error;
  } finally {
    if (connected) await client.end().catch(() => {});
    for (const file of [sealed, plain]) await fs.promises.rm(file, { force: true });
  }
})().then(() => process.exit(0), (error) => {
  console.error("Restore stopped:", error.message);
  process.exit(1);
});
// Whatever happens, it never ends quietly as if it had worked.
process.on("beforeExit", () => { console.error("Restore stopped: it ended without finishing."); process.exit(1); });
