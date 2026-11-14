"use strict";
// The data migration's long work runs in the background, never inside a page's request: reading
// uploaded files, importing into the sandbox, going live and the catch-up. A school has at most one
// task open (migration_tasks_one_open_idx), so a double click starts nothing twice. Any server
// can claim a queued task (FOR UPDATE SKIP LOCKED); each server runs one at a time
// (MIGRATION_TASKS_AT_ONCE), and holds the school's advisory lock while it does. A task whose
// server stopped (no heartbeat for 90 seconds) goes back in the queue once: nothing it did was
// half-done (an import reruns safely, a go-live is one transaction). Progress is saved at most
// once a second; the page reads it (`statusOf`), and reading it is also what wakes the queue
// after a restart: nothing polls the database on its own.
const os = require("os");

const AT_ONCE = Math.max(1, Number(process.env.MIGRATION_TASKS_AT_ONCE) || 1);
const STALE_SECONDS = 90;
const HEARTBEAT_MS = 15000;
const LOCK_SPACE = 61803;
const RUNNER = `${os.hostname()}:${process.pid}`;
// Production runs production's tasks; a development server (even on the hosted database) only its own.
const ENV = process.env.NODE_ENV === "production" ? "production" : "development";
const LABELS = { read_files: "Reading your files", import: "Importing into the sandbox", go_live: "Going live", catch_up: "Applying your changes" };
const runners = new Map();
let active = 0;
let pumping = false;

const register = (kind, fn) => runners.set(kind, fn);
const tick = () => new Promise((resolve) => setImmediate(resolve));

async function enqueue(db, job, kind, { actor = null, payload = {} } = {}) {
  try {
    const { rows: [task] } = await db.query(
      "INSERT INTO migration_tasks (job_id, organization_id, kind, actor, payload, env) VALUES ($1, $2, $3, $4, $5::jsonb, $6) RETURNING *",
      [job.job_id, job.organization_id, kind, actor, JSON.stringify(payload), ENV]
    );
    setImmediate(() => pump(db));
    return { task };
  } catch (error) {
    if (error.code === "23505") return { busy: await openTask(db, job.job_id) };
    throw error;
  }
}

const openTask = async (db, jobId) => (await db.query("SELECT * FROM migration_tasks WHERE job_id = $1 AND status IN ('queued', 'running') ORDER BY task_id DESC LIMIT 1", [jobId])).rows[0] || null;
const latestTask = async (db, jobId) => (await db.query("SELECT * FROM migration_tasks WHERE job_id = $1 ORDER BY task_id DESC LIMIT 1", [jobId])).rows[0] || null;

async function recover(db) {
  await db.query(
    `UPDATE migration_tasks
        SET status = CASE WHEN attempts < 2 THEN 'queued' ELSE 'failed' END,
            error = CASE WHEN attempts < 2 THEN NULL ELSE 'The server restarted while this was running. Nothing was half-done: start it again.' END,
            finished_at = CASE WHEN attempts < 2 THEN NULL ELSE NOW() END
      WHERE status = 'running' AND env = $2 AND heartbeat_at < NOW() - make_interval(secs => $1)`,
    [STALE_SECONDS, ENV]
  );
}

async function claim(db) {
  const { rows: [task] } = await db.query(
    `UPDATE migration_tasks SET status = 'running', started_at = COALESCE(started_at, NOW()), heartbeat_at = NOW(), attempts = attempts + 1, runner = $1
      WHERE task_id = (SELECT task_id FROM migration_tasks WHERE status = 'queued' AND env = $2 ORDER BY task_id FOR UPDATE SKIP LOCKED LIMIT 1)
      RETURNING *`,
    [RUNNER, ENV]
  );
  return task || null;
}

async function pump(db) {
  if (pumping) return;
  pumping = true;
  try {
    await recover(db);
    while (active < AT_ONCE) {
      const task = await claim(db);
      if (!task) break;
      active += 1;
      run(db, task).finally(() => { active -= 1; setImmediate(() => pump(db)); });
    }
  } catch (error) {
    console.error("[Migration tasks] queue:", error.message);
  } finally {
    pumping = false;
  }
}

// Progress for the page: a phase (one of `phases`), its step in words, and done / total within it.
function progressOf(db, task) {
  let state = { phase: 1, phases: 1, step: LABELS[task.kind], done: 0, total: 0 };
  let last = 0;
  let writing = false;
  const write = async () => {
    if (writing) return;
    writing = true;
    last = Date.now();
    try { await db.query("UPDATE migration_tasks SET progress = $2::jsonb, heartbeat_at = NOW() WHERE task_id = $1", [task.task_id, JSON.stringify(state)]); } catch (_e) { /* the next update tries again */ }
    writing = false;
  };
  const progress = (update = {}) => {
    const moved = (update.phase && update.phase !== state.phase) || (update.step && update.step !== state.step);
    state = { ...state, ...update };
    if (moved || Date.now() - last > 1000) write();
  };
  progress.flush = write;
  progress.tick = tick;
  return progress;
}

// What went wrong, in words a school can act on; the details stay in the server's log.
const friendly = (kind, error) => (kind === "go_live" || kind === "catch_up"
  ? "It stopped and nothing was changed. Try again, or contact Managira if it happens again."
  : String(error && error.message || "").startsWith("That file") ? error.message : "It stopped part way. Nothing is lost: try again.");

async function run(db, task) {
  const lock = await db.connect();
  let locked = false;
  const beat = setInterval(() => { db.query("UPDATE migration_tasks SET heartbeat_at = NOW() WHERE task_id = $1 AND status = 'running'", [task.task_id]).catch(() => {}); }, HEARTBEAT_MS);
  beat.unref();
  try {
    locked = (await lock.query("SELECT pg_try_advisory_lock($1, $2) AS ok", [LOCK_SPACE, task.job_id])).rows[0].ok;
    if (!locked) return; // its first server is still running it: leave it to that one
    const progress = progressOf(db, task);
    const { rows: [job] } = await db.query("SELECT * FROM migration_jobs WHERE job_id = $1", [task.job_id]);
    const fn = runners.get(task.kind);
    let result;
    try {
      if (!job) throw new Error("The migration is gone.");
      if (!fn) throw new Error(`Nothing runs ${task.kind}.`);
      result = await fn(db, job, task, progress);
    } catch (error) {
      console.error(`[Migration tasks] ${task.kind} for school ${task.organization_id}:`, error.stack || error.message);
      result = { error: friendly(task.kind, error) };
    }
    await progress.flush();
    await db.query(
      "UPDATE migration_tasks SET status = $2, result = $3::jsonb, error = $4, finished_at = NOW(), heartbeat_at = NOW() WHERE task_id = $1",
      [task.task_id, result && result.error ? "failed" : "done", JSON.stringify(result || {}), result && result.error ? String(result.error).slice(0, 1000) : null]
    );
  } catch (error) {
    console.error("[Migration tasks] running:", error.message);
  } finally {
    clearInterval(beat);
    if (locked) await lock.query("SELECT pg_advisory_unlock($1, $2)", [LOCK_SPACE, task.job_id]).catch(() => {});
    lock.release();
  }
}

// For the page: the school's open task, or the last one if it finished in the last 10 minutes.
async function statusOf(db, jobId) {
  const task = await latestTask(db, jobId);
  if (!task) return null;
  // A queued task, or one whose server went quiet, gets the queue moving (after a restart, say).
  if (task.status === "queued" || (task.status === "running" && Date.now() - new Date(task.heartbeat_at || 0).getTime() > STALE_SECONDS * 1000)) setImmediate(() => pump(db));
  const open = ["queued", "running"].includes(task.status);
  if (!open && Date.now() - new Date(task.finished_at || task.created_at).getTime() > 10 * 60 * 1000) return null;
  const p = task.progress || {};
  const within = p.total ? Math.min(1, (p.done || 0) / p.total) : 0;
  const percent = task.status === "done" ? 100 : Math.round(((Math.max(1, p.phase || 1) - 1 + within) / Math.max(1, p.phases || 1)) * 100);
  const ahead = task.status === "queued" ? Number((await db.query("SELECT COUNT(*)::int AS n FROM migration_tasks WHERE status IN ('queued', 'running') AND task_id < $1", [task.task_id])).rows[0].n) : 0;
  return {
    id: Number(task.task_id), kind: task.kind, label: LABELS[task.kind], status: task.status, open, percent, ahead,
    step: p.step || null, done: p.done || 0, total: p.total || 0, phase: p.phase || 1, phases: p.phases || 1,
    error: task.error, result: task.result || null, startedAt: task.started_at, finishedAt: task.finished_at,
    seconds: Math.max(0, Math.round(((task.finished_at ? new Date(task.finished_at) : new Date()) - new Date(task.started_at || task.created_at)) / 1000)),
  };
}

// Once after a server starts (production only): a task its last run was in the middle of (a deploy,
// say) is picked up again without waiting for someone to open the page.
function wakeAfterStart(db) {
  if (ENV !== "production") return;
  const timer = setTimeout(() => pump(db), (STALE_SECONDS + 10) * 1000);
  timer.unref();
}

module.exports = { register, enqueue, wakeAfterStart, openTask, latestTask, statusOf, pump, recover, tick, LABELS, STALE_SECONDS };
