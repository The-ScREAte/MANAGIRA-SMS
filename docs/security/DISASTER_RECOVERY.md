# Disaster recovery

How Managira recovers from losing its database, its files or its servers, and how quickly.
*Last reviewed: November 15, 2026. Restore drill: once a year (record the date and time taken below).*

## Objectives

| | Database | Files |
|---|---|---|
| **Recovery point** (most data that could be lost) | Minutes, with Render's point-in-time recovery (last 3 or 7 days); 24 hours from Managira's nightly backups (30 days) | Nothing, for a deleted or overwritten file (kept 30 days as an older version in the United States bucket) |
| **Recovery time** (target to be back) | 4 hours | 4 hours |

## What can go wrong, and what to do

| Event | Recovery |
|---|---|
| Data deleted or damaged by mistake, noticed within Render's window | Render › the database › Recovery › restore to a time just before; point the app at it |
| Same, noticed later (up to 30 days) | Restore the nightly backup into a new database: `node scripts/restoreBackup.js --list`, then `--from <name> --to <new database URL>` ([BACKUPS.md](../BACKUPS.md)); point `DB_CONNECTION_STRING` at it |
| A file deleted or overwritten | AWS S3 › the bucket › show versions › restore the older version |
| A server or deploy fails | Render › the service › roll back to the previous deploy |
| Render unavailable in Oregon | Create a new Render service and database in another region, restore the newest nightly backup, and point the domain at it |
| A security incident | [INCIDENT_RESPONSE.md](INCIDENT_RESPONSE.md) first, then the rows above |

## Restore drill (once a year)

1. Restore the newest nightly backup into a new, empty database (`scripts/restoreBackup.js`). It
   checks every table's row count.
2. Start a copy of the app against it with scheduled jobs off (`RUN_SCHEDULED_JOBS=false`) and sign in
   as a test account.
3. Restore one file version in the storage bucket.
4. Record the date, how long each step took, and anything to fix.

| Date | Database restore | App check | File restore | Notes |
|---|---|---|---|---|
| | | | | |

## Contacts

The people who carry this out are named in [INCIDENT_RESPONSE.md](INCIDENT_RESPONSE.md), section 1.
