"use strict";
// Nightly backups of the whole database (the "database-backup" job in jobs/scheduler.js, and
// Super Admin › Backups). Made by the app with its own connection, so no pg_dump is needed:
//  - one consistent snapshot (REPEATABLE READ, read only): the schema from Postgres's own
//    definitions (pg_get_*def), every table's rows with COPY, every sequence's position;
//  - gzipped, then encrypted here with AES-256-GCM (BACKUP_ENCRYPTION_KEY) before it leaves the
//    server, so storage only ever holds ciphertext;
//  - kept in Managira's own private S3 bucket (BACKUP_S3_BUCKET; never the uploads bucket, whose
//    files are public), for 30 days (BACKUP_KEEP_DAYS), the newest always kept;
//  - each run logged in backup_runs.
// Restored with scripts/restoreBackup.js into an empty database (docs/BACKUPS.md). Anything the
// format can't carry (another schema, row security, a domain...) stops the backup with an error
// rather than being left out.
const crypto = require("crypto");
const fs = require("fs");
const os = require("os");
const path = require("path");
const zlib = require("zlib");
const { PassThrough, Transform } = require("stream");
const { StringDecoder } = require("string_decoder");
const { pipeline } = require("stream/promises");
const { to: copyTo, from: copyFrom } = require("pg-copy-streams");

const MAGIC = Buffer.from("MGBK1\n");
const KEEP_DAYS = () => Math.max(1, Number(process.env.BACKUP_KEEP_DAYS || 30));
// Rows that aren't worth keeping (and shouldn't be): sign-in sessions. Their tables are kept.
const NO_DATA = new Set(["user_sessions", "hub_sessions"]);

// ── The key ─────────────────────────────────────────────────────────────────────────────
// 32 bytes, as base64 or hex. Its id (the first 8 hex of its SHA-256) is written on each backup,
// so the right key can be found without ever storing it.
function keyFrom(value = process.env.BACKUP_ENCRYPTION_KEY) {
  const text = String(value || "").trim();
  if (!text) return null;
  const key = /^[0-9a-f]{64}$/i.test(text) ? Buffer.from(text, "hex") : Buffer.from(text, "base64");
  return key.length === 32 ? key : null;
}
const keyIdOf = (key) => crypto.createHash("sha256").update(key).digest("hex").slice(0, 8);

// MGBK1\n, the key id (8), the IV (12), the ciphertext, the GCM tag (16).
function encryptStream(key) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
  const head = Buffer.concat([MAGIC, Buffer.from(keyIdOf(key)), iv]);
  let started = false;
  return new Transform({
    transform(chunk, _encoding, done) {
      if (!started) { started = true; this.push(head); }
      done(null, cipher.update(chunk));
    },
    flush(done) {
      if (!started) this.push(head);
      this.push(cipher.final());
      this.push(cipher.getAuthTag());
      done();
    },
  });
}
// Decrypts a backup file into another file, checking the tag: a wrong key or a changed byte fails.
async function decryptFile(source, target, key) {
  const { size } = await fs.promises.stat(source);
  const fd = await fs.promises.open(source, "r");
  const headLength = MAGIC.length + 8 + 12;
  try {
    const head = Buffer.alloc(headLength);
    await fd.read(head, 0, headLength, 0);
    if (size < headLength + 16 || !head.subarray(0, MAGIC.length).equals(MAGIC)) throw new Error("This isn't a Managira backup.");
    const keyId = head.subarray(MAGIC.length, MAGIC.length + 8).toString();
    if (keyId !== keyIdOf(key)) throw new Error(`This backup needs key ${keyId}; the key given is ${keyIdOf(key)}.`);
    const tag = Buffer.alloc(16);
    await fd.read(tag, 0, 16, size - 16);
    const decipher = crypto.createDecipheriv("aes-256-gcm", key, head.subarray(MAGIC.length + 8));
    decipher.setAuthTag(tag);
    await pipeline(fs.createReadStream(source, { start: headLength, end: size - 17 }), decipher, fs.createWriteStream(target));
  } catch (error) {
    await fs.promises.rm(target, { force: true });
    if (/authenticate/i.test(error.message)) throw new Error("The backup didn't decrypt: it was changed, or this is the wrong key.");
    throw error;
  } finally {
    await fd.close();
  }
}

// ── Where backups are kept ──────────────────────────────────────────────────────────────
// S3 (BACKUP_S3_BUCKET, a private bucket), or a folder ("local:/path", for tests and copies).
function storage() {
  const target = String(process.env.BACKUP_STORAGE || "s3");
  if (target.startsWith("local:")) {
    const dir = target.slice(6);
    return {
      where: `folder ${dir}`,
      async put(name, stream) { await fs.promises.mkdir(dir, { recursive: true }); await pipeline(stream, fs.createWriteStream(path.join(dir, name))); },
      async list() {
        const names = (await fs.promises.readdir(dir).catch(() => [])).filter((n) => n.endsWith(".mgbk"));
        return Promise.all(names.map(async (name) => { const st = await fs.promises.stat(path.join(dir, name)); return { name, size: st.size, at: st.mtime }; }));
      },
      async download(name, file) { await fs.promises.copyFile(path.join(dir, path.basename(name)), file); },
      async remove(names) { for (const name of names) await fs.promises.rm(path.join(dir, path.basename(name)), { force: true }); },
    };
  }
  const bucket = process.env.BACKUP_S3_BUCKET;
  if (!bucket) return { error: "BACKUP_S3_BUCKET isn't set: backups need a private bucket of their own (never the uploads bucket, whose files are public)." };
  if (bucket === process.env.S3_BUCKET_NAME) return { error: "BACKUP_S3_BUCKET is the uploads bucket, whose files are public: give backups a private bucket of their own." };
  const { S3Client, ListObjectsV2Command, GetObjectCommand, DeleteObjectsCommand } = require("@aws-sdk/client-s3");
  const { Upload } = require("@aws-sdk/lib-storage");
  const s3 = new S3Client({
    region: process.env.BACKUP_AWS_REGION || process.env.AWS_REGION,
    credentials: {
      accessKeyId: process.env.BACKUP_AWS_ACCESS_KEY_ID || process.env.AWS_ACCESS_KEY_ID,
      secretAccessKey: process.env.BACKUP_AWS_SECRET_ACCESS_KEY || process.env.AWS_SECRET_ACCESS_KEY,
    },
  });
  const prefix = String(process.env.BACKUP_S3_PREFIX || "database/").replace(/^\/+/, "");
  return {
    where: `s3://${bucket}/${prefix}`,
    async put(name, stream) {
      await new Upload({ client: s3, params: { Bucket: bucket, Key: prefix + name, Body: stream, ContentType: "application/octet-stream", ServerSideEncryption: "AES256" } }).done();
    },
    async list() {
      const out = [];
      let token;
      do {
        const page = await s3.send(new ListObjectsV2Command({ Bucket: bucket, Prefix: prefix, ContinuationToken: token }));
        (page.Contents || []).filter((o) => o.Key.endsWith(".mgbk")).forEach((o) => out.push({ name: o.Key.slice(prefix.length), size: o.Size, at: o.LastModified }));
        token = page.IsTruncated ? page.NextContinuationToken : null;
      } while (token);
      return out;
    },
    async download(name, file) {
      const object = await s3.send(new GetObjectCommand({ Bucket: bucket, Key: prefix + path.basename(name) }));
      await pipeline(object.Body, fs.createWriteStream(file));
    },
    async remove(names) {
      for (let i = 0; i < names.length; i += 1000) {
        await s3.send(new DeleteObjectsCommand({ Bucket: bucket, Delete: { Objects: names.slice(i, i + 1000).map((n) => ({ Key: prefix + n })) } }));
      }
    },
  };
}
// The backups older than the days kept, but never the newest one.
function expired(list, days = KEEP_DAYS(), now = Date.now()) {
  const sorted = [...list].sort((a, b) => new Date(b.at) - new Date(a.at));
  return sorted.slice(1).filter((item) => now - new Date(item.at).getTime() > days * 86400000).map((item) => item.name);
}

// ── The dump ────────────────────────────────────────────────────────────────────────────
// Plain text: a header line carrying this dump's marker, then blocks: "--@<marker>@sql" (SQL to
// run), "--@<marker>@copy <table> (<columns>)" followed by COPY rows up to "\.", and
// "--@<marker>@end" followed by each table's row count (JSON).
async function writeDump(client, out) {
  const marker = crypto.randomBytes(6).toString("hex");
  const write = (data) => (out.write(data) ? Promise.resolve() : new Promise((resolve) => out.once("drain", resolve)));
  const block = async (kind, arg, body) => {
    await write(`--@${marker}@${kind}${arg ? " " + arg : ""}\n`);
    if (body) await write(body.endsWith("\n") ? body : body + "\n");
  };
  const all = async (sql, args) => (await client.query(sql, args)).rows;
  const { rows: [{ schema, version }] } = await client.query("SELECT current_schema() AS schema, current_setting('server_version') AS version");

  // What this format can't carry stops the backup, rather than being left out.
  const [{ what }] = await all(
    `SELECT concat_ws(', ',
       (SELECT 'schema ' || string_agg(nspname, ', ') FROM pg_namespace ns WHERE nspname NOT LIKE 'pg\\_%' AND nspname NOT IN ('information_schema', $1)
          AND EXISTS (SELECT 1 FROM pg_class c WHERE c.relnamespace = ns.oid)),
       (SELECT 'row security on ' || string_agg(relname, ', ') FROM pg_class WHERE relnamespace = $1::regnamespace AND relrowsecurity),
       (SELECT 'objects of kind ' || string_agg(DISTINCT relkind::text, ', ') FROM pg_class WHERE relnamespace = $1::regnamespace AND relkind NOT IN ('r', 'i', 'S', 'v')),
       (SELECT 'type ' || string_agg(typname, ', ') FROM pg_type t WHERE typnamespace = $1::regnamespace AND typtype IN ('d', 'c', 'r', 'm')
          AND NOT EXISTS (SELECT 1 FROM pg_class c WHERE c.reltype = t.oid)),
       (SELECT 'generated or identity columns' FROM pg_attribute a JOIN pg_class c ON c.oid = a.attrelid
          WHERE c.relnamespace = $1::regnamespace AND a.attnum > 0 AND (a.attgenerated <> '' OR a.attidentity <> '') LIMIT 1)
     ) AS what`,
    [schema]
  );
  if (what) throw new Error(`The backup can't carry ${what}.`);

  await write(`-- managira-backup 1 ${marker} ${JSON.stringify({ at: new Date().toISOString(), server: version, schema })}\n`);
  const extensions = await all("SELECT format('CREATE EXTENSION IF NOT EXISTS %I WITH SCHEMA %I;', e.extname, n.nspname) AS sql FROM pg_extension e JOIN pg_namespace n ON n.oid = e.extnamespace WHERE e.extname <> 'plpgsql' ORDER BY e.extname");
  const enums = await all(
    `SELECT format('CREATE TYPE %I AS ENUM (%s);', t.typname, string_agg(quote_literal(e.enumlabel), ', ' ORDER BY e.enumsortorder)) AS sql
       FROM pg_type t JOIN pg_enum e ON e.enumtypid = t.oid WHERE t.typnamespace = $1::regnamespace GROUP BY t.typname ORDER BY t.typname`,
    [schema]
  );
  const sequences = await all(
    `SELECT format('CREATE SEQUENCE %I AS %s INCREMENT BY %s MINVALUE %s MAXVALUE %s START WITH %s CACHE %s%s;',
            sequencename, data_type, increment_by, min_value, max_value, start_value, cache_size, CASE WHEN cycle THEN ' CYCLE' ELSE '' END) AS sql,
            quote_ident(sequencename) AS ident
       FROM pg_sequences WHERE schemaname = $1 ORDER BY sequencename`,
    [schema]
  );
  const functions = await all(
    `SELECT pg_get_functiondef(p.oid) || ';' AS sql FROM pg_proc p
      WHERE p.pronamespace = $1::regnamespace AND p.prokind IN ('f', 'p')
        AND NOT EXISTS (SELECT 1 FROM pg_depend d WHERE d.objid = p.oid AND d.deptype = 'e')
      ORDER BY p.proname, p.oid`,
    [schema]
  );
  const tables = await all(
    `SELECT c.relname AS name, quote_ident(c.relname) AS ident,
            format('CREATE TABLE %I (%s);', c.relname, COALESCE(string_agg(format('%I %s%s%s', a.attname, format_type(a.atttypid, a.atttypmod),
              CASE WHEN ad.adbin IS NOT NULL THEN ' DEFAULT ' || pg_get_expr(ad.adbin, ad.adrelid) ELSE '' END,
              CASE WHEN a.attnotnull THEN ' NOT NULL' ELSE '' END), ', ' ORDER BY a.attnum), '')) AS sql,
            string_agg(quote_ident(a.attname), ', ' ORDER BY a.attnum) AS columns
       FROM pg_class c
       LEFT JOIN pg_attribute a ON a.attrelid = c.oid AND a.attnum > 0 AND NOT a.attisdropped
       LEFT JOIN pg_attrdef ad ON ad.adrelid = c.oid AND ad.adnum = a.attnum
      WHERE c.relnamespace = $1::regnamespace AND c.relkind = 'r'
      GROUP BY c.oid, c.relname ORDER BY c.relname`,
    [schema]
  );
  await block("sql", "", ["SET check_function_bodies = false;", ...extensions.map((r) => r.sql), ...enums.map((r) => r.sql), ...sequences.map((r) => r.sql)].join("\n"));
  for (const f of functions) await block("sql", "", f.sql);
  await block("sql", "", tables.map((t) => t.sql).join("\n"));

  // Every table's rows, as COPY writes them (one line a row), straight into the backup.
  const counts = {};
  for (const t of tables) {
    if (!t.columns || NO_DATA.has(t.name)) { counts[t.name] = 0; continue; }
    await block("copy", `${t.ident} (${t.columns})`);
    let rows = 0;
    for await (const chunk of client.query(copyTo(`COPY ${t.ident} (${t.columns}) TO STDOUT`))) {
      for (let at = chunk.indexOf(10); at !== -1; at = chunk.indexOf(10, at + 1)) rows += 1;
      await write(chunk);
    }
    await write("\\.\n");
    counts[t.name] = rows;
  }

  // After the rows: keys and checks, then foreign keys, indexes, views, triggers, and where each
  // sequence had got to.
  const constraints = await all(
    `SELECT format('ALTER TABLE ONLY %I ADD CONSTRAINT %I %s;', c.relname, co.conname, pg_get_constraintdef(co.oid)) AS sql
       FROM pg_constraint co JOIN pg_class c ON c.oid = co.conrelid
      WHERE c.relnamespace = $1::regnamespace AND c.relkind = 'r' AND co.contype IN ('p', 'u', 'x', 'c', 'f')
      ORDER BY CASE co.contype WHEN 'p' THEN 0 WHEN 'u' THEN 1 WHEN 'x' THEN 2 WHEN 'c' THEN 3 ELSE 4 END, c.relname, co.conname`,
    [schema]
  );
  // A foreign key may point at a unique index rather than a constraint: indexes come first.
  const foreignKeys = constraints.filter((r) => / FOREIGN KEY /.test(r.sql));
  const keys = constraints.filter((r) => !/ FOREIGN KEY /.test(r.sql));
  const indexes = await all(
    `SELECT pg_get_indexdef(i.indexrelid) || ';' AS sql FROM pg_index i JOIN pg_class c ON c.oid = i.indrelid JOIN pg_class ic ON ic.oid = i.indexrelid
      WHERE c.relnamespace = $1::regnamespace AND c.relkind = 'r'
        AND NOT EXISTS (SELECT 1 FROM pg_constraint co WHERE co.conindid = i.indexrelid AND co.contype IN ('p', 'u', 'x'))
      ORDER BY c.relname, ic.relname`,
    [schema]
  );
  const views = await all("SELECT format('CREATE VIEW %I AS %s', c.relname, pg_get_viewdef(c.oid)) AS sql FROM pg_class c WHERE c.relnamespace = $1::regnamespace AND c.relkind = 'v' ORDER BY c.oid", [schema]);
  const triggers = await all(
    `SELECT pg_get_triggerdef(t.oid) || ';' AS sql FROM pg_trigger t JOIN pg_class c ON c.oid = t.tgrelid
      WHERE c.relnamespace = $1::regnamespace AND NOT t.tgisinternal ORDER BY c.relname, t.tgname`,
    [schema]
  );
  const owned = await all(
    `SELECT format('ALTER SEQUENCE %I OWNED BY %I.%I;', s.relname, t.relname, a.attname) AS sql
       FROM pg_depend d JOIN pg_class s ON s.oid = d.objid AND s.relkind = 'S'
       JOIN pg_class t ON t.oid = d.refobjid JOIN pg_attribute a ON a.attrelid = t.oid AND a.attnum = d.refobjsubid
      WHERE d.deptype = 'a' AND s.relnamespace = $1::regnamespace ORDER BY s.relname`,
    [schema]
  );
  const positions = [];
  for (const s of sequences) {
    const { rows: [p] } = await client.query(`SELECT last_value, is_called FROM ${s.ident}`);
    positions.push(`SELECT setval(${(await client.query("SELECT quote_literal($1) AS q", [s.ident])).rows[0].q}, ${p.last_value}, ${p.is_called});`);
  }
  if (keys.length) await block("sql", "", keys.map((r) => r.sql).join("\n"));
  if (indexes.length) await block("sql", "", indexes.map((r) => r.sql).join("\n"));
  if (foreignKeys.length) await block("sql", "", foreignKeys.map((r) => r.sql).join("\n"));
  for (const v of views) await block("sql", "", v.sql.trim().replace(/;?$/, ";"));
  if (triggers.length) await block("sql", "", triggers.map((r) => r.sql).join("\n"));
  if (owned.length) await block("sql", "", owned.map((r) => r.sql).join("\n"));
  if (positions.length) await block("sql", "", positions.join("\n"));
  await block("end", "", JSON.stringify({ counts }));
  return { tables: tables.length, rows: Object.values(counts).reduce((a, b) => a + b, 0), counts };
}

// ── A night's backup ────────────────────────────────────────────────────────────────────
async function runBackup(db, { triggeredBy = "schedule" } = {}) {
  const key = keyFrom();
  const store = storage();
  const { rows: [run] } = await db.query("INSERT INTO backup_runs (status, triggered_by) VALUES ('running', $1) RETURNING run_id, started_at", [triggeredBy]);
  const fail = async (message) => {
    await db.query("UPDATE backup_runs SET status = 'failed', finished_at = NOW(), error = $2 WHERE run_id = $1", [run.run_id, String(message).slice(0, 2000)]);
    console.error("[Backup] failed:", message);
    return { ok: false, runId: run.run_id, error: message };
  };
  if (!key) return fail("BACKUP_ENCRYPTION_KEY isn't set (32 bytes, base64 or hex).");
  if (store.error) return fail(store.error);
  const name = `managira-${new Date().toISOString().replace(/[:.]/g, "-")}.mgbk`;
  const hash = crypto.createHash("sha256");
  let bytes = 0;
  const measure = new Transform({ transform(chunk, _e, done) { hash.update(chunk); bytes += chunk.length; done(null, chunk); } });
  const client = await db.connect();
  try {
    await client.query("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY");
    await client.query("SET LOCAL statement_timeout = 0");
    await client.query("SET LOCAL idle_in_transaction_session_timeout = 0");
    const dump = new PassThrough({ highWaterMark: 1 << 20 });
    const gzip = zlib.createGzip({ level: 6 });
    const sealed = encryptStream(key);
    const sent = store.put(name, measure);
    const chain = pipeline(dump, gzip, sealed, measure);
    let summary;
    try {
      summary = await writeDump(client, dump);
      dump.end();
    } catch (error) {
      dump.destroy(error); // never a finished-looking backup of half the database
      await Promise.allSettled([chain, sent]);
      await store.remove([name]).catch(() => {});
      throw error;
    }
    await chain;
    await sent;
    await client.query("COMMIT");
    let removed = [];
    try {
      removed = expired(await store.list());
      if (removed.length) await store.remove(removed);
    } catch (error) {
      console.error("[Backup] clearing old backups:", error.message);
    }
    await db.query(
      "UPDATE backup_runs SET status = 'ok', finished_at = NOW(), storage_key = $2, bytes = $3, tables = $4, row_count = $5, sha256 = $6, key_id = $7, removed_old = $8 WHERE run_id = $1",
      [run.run_id, `${store.where}${name}`, bytes, summary.tables, summary.rows, hash.digest("hex"), keyIdOf(key), removed.length]
    );
    return { ok: true, runId: run.run_id, name, bytes, ...summary, removed: removed.length };
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {});
    return fail(error.message);
  } finally {
    client.release();
  }
}

// ── Restoring ───────────────────────────────────────────────────────────────────────────
// Splits a stream on newlines (and only newlines: COPY rows never hold one).
async function* lines(stream) {
  const decoder = new StringDecoder("utf8"); // a character split across two chunks stays whole
  let rest = "";
  for await (const chunk of stream) {
    const text = rest + (typeof chunk === "string" ? chunk : decoder.write(chunk));
    const parts = text.split("\n");
    rest = parts.pop();
    for (const part of parts) yield part;
  }
  rest += decoder.end();
  if (rest) yield rest;
}
// Runs a decrypted backup (a gzip file) into `client`'s database, which must be empty, in one
// transaction: it all goes in, or nothing does. Returns each table's count, checked.
async function restoreFile(client, file) {
  const source = fs.createReadStream(file).pipe(zlib.createGunzip());
  let marker = null;
  let header = null;
  let sql = [];
  let copy = null;
  let expected = null;
  const runSql = async () => { if (sql.length) { await client.query(sql.join("\n")); sql = []; } };
  const startCopy = (target) => {
    const stream = client.query(copyFrom(`COPY ${target} FROM STDIN`));
    const done = new Promise((resolve, reject) => { stream.on("finish", resolve); stream.on("error", reject); });
    copy = { stream, done };
  };
  const writeCopy = (line) => (copy.stream.write(line + "\n") ? null : new Promise((resolve) => copy.stream.once("drain", resolve)));
  let ending = false;
  let endLines = [];
  for await (const line of lines(source)) {
    if (!marker) {
      const m = line.match(/^-- managira-backup 1 ([0-9a-f]{12}) (.*)$/);
      if (!m) throw new Error("This isn't a Managira backup (no header).");
      marker = `--@${m[1]}@`;
      header = JSON.parse(m[2]);
      continue;
    }
    if (copy) {
      if (line === "\\.") { copy.stream.end(); await copy.done; copy = null; } else { const wait = writeCopy(line); if (wait) await wait; }
      continue;
    }
    if (line.startsWith(marker)) {
      await runSql();
      const [kind, ...rest] = line.slice(marker.length).split(" ");
      if (kind === "copy") startCopy(rest.join(" "));
      else if (kind === "end") ending = true;
      continue;
    }
    if (ending) endLines.push(line); else sql.push(line);
  }
  await runSql();
  if (copy) throw new Error("The backup ends in the middle of a table: it's incomplete.");
  if (!ending) throw new Error("The backup has no end: it's incomplete.");
  expected = JSON.parse(endLines.join("\n")).counts;
  const mismatched = [];
  for (const [table, count] of Object.entries(expected)) {
    const { rows: [{ n }] } = await client.query(`SELECT COUNT(*)::bigint AS n FROM ${(await client.query("SELECT quote_ident($1) AS q", [table])).rows[0].q}`);
    if (Number(n) !== Number(count)) mismatched.push(`${table}: ${n} of ${count}`);
  }
  if (mismatched.length) throw new Error(`Row counts don't match: ${mismatched.slice(0, 5).join("; ")}`);
  return { header, tables: Object.keys(expected).length, rows: Object.values(expected).reduce((a, b) => a + Number(b), 0) };
}

// The last runs, and the backups in storage (Super Admin › Backups).
async function overview(db) {
  const { rows: runs } = await db.query("SELECT * FROM backup_runs ORDER BY started_at DESC LIMIT 40").catch(() => ({ rows: [] }));
  const store = storage();
  let stored = [];
  let storeError = store.error || null;
  if (!storeError) stored = await store.list().catch((error) => { storeError = error.message; return []; });
  return {
    runs,
    stored: stored.sort((a, b) => new Date(b.at) - new Date(a.at)),
    where: store.where || null,
    storeError,
    keySet: Boolean(keyFrom()),
    keyId: keyFrom() ? keyIdOf(keyFrom()) : null,
    keepDays: KEEP_DAYS(),
  };
}

const tempFile = (name) => path.join(os.tmpdir(), `managira-${process.pid}-${Date.now()}-${name}`);

module.exports = { keyFrom, keyIdOf, encryptStream, decryptFile, storage, expired, writeDump, runBackup, restoreFile, overview, lines, tempFile, NO_DATA, MAGIC };
