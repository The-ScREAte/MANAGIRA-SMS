"use strict";

// Mira's read tools on the main app: GET /internal/api/read/:tool (routes/internalApiRoute.js).
// Each tool lives in a group file beside this one (utils/miraRead/<group>.js, loaded
// automatically) exporting { tool_name: { run: async (db, actor, query) => result } }.
//
// Rules every tool keeps (AGENTS.md):
// - The person is Mira's verified caller (identity added by mira/internalApiClient.js; the school
//   is always the caller's own). A tool never takes a school from its arguments.
// - It reuses the page's own logic and permission check (userHasPermission, classScope, the
//   page's helpers), never a parallel rule; a teacher sees only what their pages show them.
// - It answers in one envelope: { ok, as_of, data, totals, scope, truncated } with totals worked
//   out on the server over the whole scope, rows capped at ROW_MAX, and text people wrote under
//   `untrusted`. Errors carry a code: PERMISSION_DENIED, PLAN_FEATURE_OFF, NOT_FOUND, AMBIGUOUS,
//   VALIDATION.
const fs = require("fs");
const path = require("path");

const ROW_MAX = 500;

class ReadError extends Error {
  constructor(code, message, status) {
    super(message);
    this.code = code;
    this.status = status || ({ PERMISSION_DENIED: 403, PLAN_FEATURE_OFF: 404, NOT_FOUND: 404, AMBIGUOUS: 409, VALIDATION: 400 }[code] || 400);
  }
}

const actorFrom = (q) => ({
  organizationId: parseInt(q.organizationId, 10),
  userId: parseInt(q.userId, 10) || null,
  userRole: String(q.userRole || ""),
  accountType: String(q.accountType || ""),
  userEmail: String(q.userEmail || ""),
});

// A request shaped like a signed-in page visit, for page helpers that read req.session.
function reqFor(actor, query = {}) {
  const user = { user_id: actor.userId, email: actor.userEmail, account_type: actor.userRole || actor.accountType };
  return {
    session: { userId: actor.userId, user, userRole: actor.userRole, accountType: actor.accountType, organizationId: actor.organizationId },
    query,
    body: {},
    params: {},
    headers: {},
    get: () => "",
  };
}

const roleOf = (actor) => String(actor.userRole || actor.accountType || "").trim().toLowerCase();
const isDriver = (actor) => roleOf(actor) === "driver";

async function holds(db, actor, key) {
  const { userHasPermission } = require("../../middleware/permissionMiddleware");
  return userHasPermission(db, actor, key).catch(() => false);
}

// The permissions of `keys` this person holds; refuses when they hold none.
async function needAny(db, actor, keys, label) {
  const held = [];
  for (const key of keys) if (await holds(db, actor, key)) held.push(key);
  if (!held.length) throw new ReadError("PERMISSION_DENIED", `You need the ${label} permission for this.`);
  return new Set(held);
}

// The classes a teacher may open (null = every class), the same as their class pages.
async function classesInReach(db, actor) {
  const classScope = require("../classScope");
  const scope = await classScope.listScope(db, reqFor(actor));
  return scope ? new Set([...scope].map(Number)) : null;
}

function cap(list, max = ROW_MAX) {
  const rows = Array.isArray(list) ? list : [];
  return { rows: rows.slice(0, max), truncated: rows.length > max };
}

// ── The registry: every group file in this folder ──
let TOOLS = null;
// MIRA_READ_RELOAD (set only by the local test copy) reads the group files afresh on every call.
function tools() {
  if (TOOLS && !process.env.MIRA_READ_RELOAD) return TOOLS;
  if (process.env.MIRA_READ_RELOAD) {
    Object.keys(require.cache).filter((key) => key.startsWith(__dirname + path.sep) && !key.endsWith(`${path.sep}index.js`)).forEach((key) => delete require.cache[key]);
  }
  TOOLS = {};
  fs.readdirSync(__dirname)
    .filter((file) => file.endsWith(".js") && file !== "index.js" && !file.startsWith("_"))
    .forEach((file) => {
      const group = require(path.join(__dirname, file));
      Object.entries(group).forEach(([name, tool]) => {
        if (TOOLS[name]) throw new Error(`miraRead: ${name} is defined twice`);
        if (!tool || typeof tool.run !== "function") throw new Error(`miraRead: ${name} has no run()`);
        TOOLS[name] = tool;
      });
    });
  return TOOLS;
}

async function handle(req, res) {
  const tool = tools()[req.params.tool];
  if (!tool) return res.status(404).json({ error: "Unknown read tool.", code: "NOT_FOUND" });
  const actor = actorFrom(req.query || {});
  if (!Number.isInteger(actor.organizationId) || !actor.userId || (req.query.viewerType && req.query.viewerType !== "staff")) {
    return res.status(403).json({ error: "Mira is for school staff only.", code: "PERMISSION_DENIED" });
  }
  try {
    const db = require("../../config/db");
    // "Today" is the person's own (their browser's time zone, sent by Mira).
    const zone = typeof req.query.timeZone === "string" ? req.query.timeZone.slice(0, 64) : null;
    const result = await require("../localDate").inTimeZone(zone, () => tool.run(db, actor, req.query || {}));
    return res.json({ ok: true, as_of: new Date().toISOString(), ...result });
  } catch (error) {
    if (error instanceof ReadError) return res.status(error.status).json({ error: error.message, code: error.code });
    console.error(`[mira read] ${req.params.tool}:`, error.message);
    return res.status(500).json({ error: "That couldn't be read just now.", code: "FAILED" });
  }
}

module.exports = { ROW_MAX, ReadError, actorFrom, reqFor, roleOf, isDriver, holds, needAny, classesInReach, cap, tools, handle };
