# Database backups

Every night at 3:20 (server time) the `database-backup` job (`utils/backups.js`) backs up the
whole database. Super Admin › Backups shows each run and has **Back up now**.

## What a backup is

- One consistent snapshot of the database (a read-only transaction): the schema rebuilt from
  Postgres's own definitions, every table's rows (COPY), and where every sequence had got to.
  Sign-in sessions are left out (people sign in again). No `pg_dump` is needed.
- Gzipped, then **encrypted on the server** with AES-256-GCM before it leaves, so storage only
  ever holds ciphertext. A wrong key, or a single changed byte, is refused on restore.
- Kept in **Managira's own private S3 bucket** (not Render) for 30 days; the newest is always kept.
- Anything the format can't carry (another schema, row security, a domain type...) stops the
  backup with an error rather than being left out.

## Setting it up (once)

1. Create a new S3 bucket for backups only, with **Block all public access** on (the uploads
   bucket can't be used: its files are public). Turning on versioning is a good extra.
2. An IAM user (or keys) that can `s3:PutObject`, `s3:GetObject`, `s3:ListBucket` and
   `s3:DeleteObject` on that bucket only.
3. Make a key and keep a copy away from Managira (a password manager):
   `node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"`
4. Set on the server: `BACKUP_ENCRYPTION_KEY`, `BACKUP_S3_BUCKET`, and, if they differ from the
   app's, `BACKUP_AWS_ACCESS_KEY_ID`, `BACKUP_AWS_SECRET_ACCESS_KEY`, `BACKUP_AWS_REGION`.
   Optional: `BACKUP_S3_PREFIX` (default `database/`), `BACKUP_KEEP_DAYS` (default 30).
5. Super Admin › Backups › **Back up now**, and check it says Ready and lists the backup.

Without the key no backup can be read: losing it loses every backup.

## Restoring

Restore into a **new, empty** database (Render: create a new Postgres; never the live one: the
script refuses it, and refuses any database that has tables).

```
node scripts/restoreBackup.js --list
node scripts/restoreBackup.js --from latest --to "postgres://USER:PASSWORD@HOST/NEW_DATABASE"
```

It downloads, decrypts and checks the backup, then restores it in one transaction (all of it or
nothing), checks every table's row count, and prints how long each part took. Then point the app's
`DB_CONNECTION_STRING` at the new database (or copy what's needed from it).

Tested on the local copy (127 MB, 298 tables, 367,318 rows): backup 0.5 s (3 MB encrypted),
restore 13 s, every table's rows identical by checksum, and every column, constraint, index,
function, trigger, view, type and sequence the same. The live database is 84 MB, so expect under a
minute plus the download.
