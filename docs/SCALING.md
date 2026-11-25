# Running Managira on more than one server

Managira's web servers keep nothing that has to be shared between them: sign-ins live in Postgres, every page asks the database, and the few in-memory copies (session copy for small polls, school settings, bus positions) expire within seconds. So more servers can be added behind the same address. The database is what has to grow with them.

## One server (today): nothing to change

Every setting below has a default equal to what live already uses. With none of them set, behaviour is exactly as before.

## Several web servers

1. **Jobs run once.** Every scheduled job takes a Postgres advisory lock named after the job (`utils/dbLock.js`), so two servers can never run the same job at once. Best practice is still one place: set `RUN_JOBS=false` (or `RUN_SCHEDULED_JOBS=false`) on the web service and run one Background Worker with `npm run worker`.
2. **Bus positions.** A driver's newest position is held in memory on the server that received it; viewers on another server see the database copy. Set `LIVE_BUS_SAVE_MS=3000` so that copy is never more than a few seconds behind (default 15000 is fine for a single server).
3. **Spreadsheet work** (report exports, reading imports) runs on worker threads inside each server, so one large export no longer freezes that server (see "Heavy file work").
4. **Pool sizes.** Total connections = servers x `DB_POOL_MAX` + the worker's pool + Mira's pool (`MIRA_DB_POOL_MAX`, default 4). Keep that under the database's `max_connections` minus about 10, or put PgBouncer in front (below).
5. **Rate limits** are counted per server, so the effective limit is the setting times the number of servers. That is fine for fair use; it is not a security limit.

## One server on several cores (WEB_CONCURRENCY)

`WEB_CONCURRENCY=N` (default 1: one process, exactly as before) turns `node server.js` into a supervisor that starts N copies of the app (`utils/clusterPrimary.js`). Set it to the number of cores the instance has. Nothing else about the deploy changes.

- **Jobs, Mira, shard sync and the keep-alive ping run only in worker 1** (the leader); a replacement for a dead leader is the leader again. Scheduled jobs also keep their Postgres locks.
- **The pool is shared out.** `DB_POOL_MAX` is the whole server's, divided between the workers (at least 4 each), so adding cores never adds database connections.
- **A save in one worker clears the school's kept answers in the others** immediately, through the supervisor. Between separate servers (not workers) kept answers can be up to `STABLE_READ_MS` (15 s) old after another server's save.
- **Bus positions** are saved every 3 s in this mode so every worker sees a fresh one.
- **Per-worker state:** rate-limit counters, the 10-second session copy used by small polls and the in-memory caches are per worker (fair-use limits are therefore N times as loose; nothing depends on them for security).
- **Memory:** each worker is a full copy of the app (about 200-250 MB). Size the instance for N copies.
- **Shutdown:** SIGTERM goes to every worker; each stops accepting, finishes open requests (up to 20 s) and exits, then the supervisor exits 0. A worker that crashes is replaced (with a pause if it keeps crashing at once).

## Fewer queries per page (kept answers)

Lookups every page repeats and that only change when someone saves a setting (the school's switches, terms, classes, calendars, schedules, plans, a person's preferences, question sets, who is in which class) are kept for 15 seconds per school (`utils/stableReads.js`, `STABLE_READ_MS`, 0 turns it off). Only a plain SELECT whose every table is on a short list is kept, so anything joined to live data (attendance, scores, attempts, fees paid, notifications, bus data) is never kept. Any save by the school clears all of its kept answers at once; a request that opens a transaction reads fresh for the rest of its time; each caller gets a private copy. The busy saves that don't change those lookups (exam autosave, bus positions, attendance and score entry) don't clear them, which is what lets a busy school keep them at all. "Is this table or column there yet" checks that said yes are kept for a minute (`STABLE_SCHEMA_MS`); a no is never kept.

## Settings

| Variable | Default | What it does |
|---|---|---|
| `DB_POOL_MAX` / `DB_POOL_MIN` | 15 / 8 (production) | Connections per server. |
| `DB_IDLE_TIMEOUT_MS` | 300000 | A connection above the minimum closes after this long idle. |
| `DB_STATEMENT_TIMEOUT_MS` | 30000 | A query running longer is cancelled (0 = no limit). Migrations and backups set their own. |
| `DB_IDLE_IN_TX_TIMEOUT_MS` | 0 (off) | The database ends a transaction left open and silent this long (0 = off), so a request that forgot to finish one cannot hold a connection forever. |
| `DB_CONNECT_TIMEOUT_MS` | 6000 | How long a request waits for a free connection. |
| `DB_MAX_USES` | off | Close a connection after this many uses. |
| `DB_APP_NAME` | `managira-web` (`managira-worker` for the worker) | Shows in `pg_stat_activity`. |
| `DB_POOL_WARN_AFTER_MS` | 10000 | Log `[DB][POOL]` when requests have been waiting for a connection this long. |
| `CPU_WORKERS` | 2 on 4+ cores, else 1 | Threads for spreadsheet work. `0` = on the main thread, as before. |
| `CPU_WORKER_MB` | 512 | Memory ceiling of each thread. |
| `CPU_QUEUE_MAX` | 40 | File jobs allowed to wait; more get a "busy, try again" answer. |
| `RUN_JOBS` / `RUN_SCHEDULED_JOBS` | on | `false` = this server runs no scheduled jobs. |
| `LIVE_BUS_SAVE_MS` | 15000 | How often a bus position is saved to the database. |
| `WEB_CONCURRENCY` | 1 | Worker processes on this server (see above). |
| `STABLE_READ_MS` / `STABLE_SCHEMA_MS` | 15000 / 60000 | How long repeated settings-like lookups / schema checks are kept (0 = off). |
| `DB_PING_IDLE_MS` | 5000 | A connection idle longer than this is checked before a transaction uses it (a dropped one is replaced, never an error). |
| `HEALTH_DETAIL_TOKEN` | unset | Lets a monitor read `/health/detail` with the header `x-health-token`. |
| `DB_PGBOUNCER` | off | `on` when `DB_CONNECTION_STRING` points at PgBouncer (below). |
| `DB_DIRECT_CONNECTION_STRING` | unset | The database's own address, used for locks (below). |

## Watching a server

- `/health` is the cheap liveness check (unchanged).
- `/health/detail` shows pool use (in use, waiting, peak waiting, warnings), event-loop lag (p50, p99, max over the last 10+ seconds), memory, the file-worker threads and whether this server runs jobs. It answers only to the server's own computer or a caller with `HEALTH_DETAIL_TOKEN`; everyone else gets a 404.
- Event-loop lag is the best single sign that a server is full. p99 over about 100 ms means add a server. `waiting` above 0 for long means the pool is too small or a query is slow; the log says so as `[DB][POOL]`.

## Heavy file work

`utils/cpuPool.js` runs the Excel export and the Excel readers (student import, exam-paper upload, document import) on worker threads (`utils/spreadsheetTasks.js` holds the work). A thread starts on first use and closes after a minute idle. A file too large for its thread fails that one request, never the server. PDFs (report cards, invoices) are drawn by a headless Chrome process, which is also outside the web thread but shares the machine's CPU and memory: on a busy day give the instance headroom for it.

## PgBouncer (transaction mode)

PgBouncer lets thousands of web requests share a few dozen real connections, which is what makes 10 or more servers possible on one database. What Managira needs for it:

- `DB_PGBOUNCER=on`. The pool then does not send `statement_timeout` / `idle_in_transaction_session_timeout` as connection settings (PgBouncer refuses unknown settings unless `ignore_startup_parameters` lists them). Set them on the role instead: `ALTER ROLE managira SET statement_timeout = '30s'; ALTER ROLE managira SET idle_in_transaction_session_timeout = '5min';`. Migrations and backups ask for their own limits per transaction.
- `DB_DIRECT_CONNECTION_STRING` = the database's own address (not PgBouncer's). Scheduled-job locks, billing and payout locks, calendar-sync and hub-billing locks are session-level Postgres advisory locks: they only work on one connection that stays the same. They are taken on a small separate connection to this address. Without it, those locks would be unreliable behind PgBouncer. `npm run migrate` and `worker.js` should also use the direct address.
- Nothing else in the app relies on session state: no `LISTEN/NOTIFY`, no temporary tables, no named prepared statements, and every `SET LOCAL` / `set_config(..., true)` is inside a transaction. A transaction stays on one server connection in transaction mode, so `BEGIN ... COMMIT` blocks are safe.
- Mira (the assistant service) has its own pool (`mira/config/db.js`); point it at PgBouncer the same way.
- Suggested PgBouncer settings: `pool_mode = transaction`, `default_pool_size` 20 to 40 per database, `max_client_conn` 2000 or more, `server_idle_timeout` 300.
