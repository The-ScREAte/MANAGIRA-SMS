// How much each school's integrations may call the Managira API, how much they
// have used, and requests for more.
//
// Every API call adds one to three counters in a single statement: the school
// this minute, the school today, and the token today (for the usage table).
// Counters live in the database, so they survive restarts and are shared by
// every server. Days are in UTC.
//
// A school gets DEFAULT_ALLOWANCE. Managira admins can raise it for a monthly
// price (Admin -> API requests); that price is added to the school's next bill
// (jobs/recurringStripeBilling.js).
const db = require("../config/db");
const { logOrganizationActivity } = require("./activityLog");

const DEFAULT_ALLOWANCE = { perMinute: 120, perDay: 10000, monthlyPrice: 0 };
const WARN_AT = 0.8; // banner from 80% of the day's allowance
const MAX_PER_MINUTE = 100000;
const MAX_PER_DAY = 100000000;

let schemaPromise = null;
function ensureApiAllowanceSchema(database = db) {
  if (!schemaPromise) {
    schemaPromise = (async () => {
      await database.query(`
        CREATE TABLE IF NOT EXISTS api_allowances (
          organization_id INTEGER PRIMARY KEY REFERENCES organizations(organization_id) ON DELETE CASCADE,
          per_minute INTEGER NOT NULL,
          per_day INTEGER NOT NULL,
          monthly_price NUMERIC(10, 2) NOT NULL DEFAULT 0,
          updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          updated_by VARCHAR(255)
        )`);
      await database.query(`
        CREATE TABLE IF NOT EXISTS api_usage (
          organization_id INTEGER NOT NULL REFERENCES organizations(organization_id) ON DELETE CASCADE,
          bucket VARCHAR(48) NOT NULL,
          count INTEGER NOT NULL DEFAULT 0,
          updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          PRIMARY KEY (organization_id, bucket)
        )`);
      await database.query(`CREATE INDEX IF NOT EXISTS idx_api_usage_updated ON api_usage (updated_at)`);
      await database.query(`
        CREATE TABLE IF NOT EXISTS api_limit_requests (
          request_id SERIAL PRIMARY KEY,
          organization_id INTEGER NOT NULL REFERENCES organizations(organization_id) ON DELETE CASCADE,
          requested_per_minute INTEGER NOT NULL,
          requested_per_day INTEGER NOT NULL,
          reason TEXT NOT NULL DEFAULT '',
          contact_name VARCHAR(255),
          contact_email VARCHAR(255),
          status VARCHAR(12) NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'declined', 'cancelled')),
          granted_per_minute INTEGER,
          granted_per_day INTEGER,
          monthly_price NUMERIC(10, 2),
          admin_note TEXT,
          created_by INTEGER,
          created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          decided_at TIMESTAMPTZ,
          decided_by VARCHAR(255)
        )`);
      await database.query(`CREATE INDEX IF NOT EXISTS idx_api_limit_requests_org ON api_limit_requests (organization_id, created_at DESC)`);
      await database.query(`CREATE INDEX IF NOT EXISTS idx_api_limit_requests_status ON api_limit_requests (status, created_at DESC)`);
    })().catch((error) => { schemaPromise = null; throw error; });
  }
  return schemaPromise;
}

const pad = (n) => String(n).padStart(2, "0");
const dayKey = (d = new Date()) => `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
const minuteKey = (d = new Date()) => `${dayKey(d)}T${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}`;
const secondsToNextMinute = (d = new Date()) => 60 - d.getUTCSeconds();
const secondsToNextDay = (d = new Date()) => {
  const next = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() + 1);
  return Math.max(1, Math.ceil((next - d.getTime()) / 1000));
};

async function getAllowance(organizationId) {
  await ensureApiAllowanceSchema();
  const row = (await db.query(`SELECT * FROM api_allowances WHERE organization_id = $1`, [organizationId])).rows[0];
  return row
    ? { perMinute: row.per_minute, perDay: row.per_day, monthlyPrice: Number(row.monthly_price), custom: true, updatedAt: row.updated_at }
    : { ...DEFAULT_ALLOWANCE, custom: false };
}

// One call: count it, and say whether it may go ahead.
async function recordCall(organizationId, tokenId) {
  await ensureApiAllowanceSchema();
  const now = new Date();
  const [allowance, counted] = await Promise.all([
    getAllowance(organizationId),
    db.query(
      `INSERT INTO api_usage (organization_id, bucket, count)
       VALUES ($1, $2, 1), ($1, $3, 1), ($1, $4, 1)
       ON CONFLICT (organization_id, bucket) DO UPDATE SET count = api_usage.count + 1, updated_at = NOW()
       RETURNING bucket, count`,
      [organizationId, `m:${minuteKey(now)}`, `d:${dayKey(now)}`, `t:${tokenId}:${dayKey(now)}`]
    ),
  ]);
  const used = Object.fromEntries(counted.rows.map((r) => [r.bucket.slice(0, 1), r.count]));
  const minuteUsed = used.m || 0;
  const dayUsed = used.d || 0;
  const result = {
    allowance,
    minute: { limit: allowance.perMinute, remaining: Math.max(0, allowance.perMinute - minuteUsed), resetSeconds: secondsToNextMinute(now) },
    day: { limit: allowance.perDay, remaining: Math.max(0, allowance.perDay - dayUsed), resetSeconds: secondsToNextDay(now) },
    allowed: minuteUsed <= allowance.perMinute && dayUsed <= allowance.perDay,
    reason: dayUsed > allowance.perDay ? "daily" : minuteUsed > allowance.perMinute ? "minute" : null,
  };
  if (!result.allowed) {
    // Remember that the limit was hit today, for the school's banner.
    db.query(
      `INSERT INTO api_usage (organization_id, bucket, count) VALUES ($1, $2, 1)
       ON CONFLICT (organization_id, bucket) DO UPDATE SET count = api_usage.count + 1, updated_at = NOW()`,
      [organizationId, `x:${dayKey(now)}`]
    ).catch(() => {});
  }
  // Now and then, drop old counters (minutes after 2 hours, days after 90).
  if (Math.random() < 0.01) {
    db.query(`DELETE FROM api_usage WHERE (bucket LIKE 'm:%' AND updated_at < NOW() - INTERVAL '2 hours')
               OR updated_at < NOW() - INTERVAL '90 days'`).catch(() => {});
  }
  return result;
}

// Today's picture for the school's pages and banner.
async function usageSummary(organizationId) {
  await ensureApiAllowanceSchema();
  const today = dayKey();
  const [allowance, rows, perToken] = await Promise.all([
    getAllowance(organizationId),
    db.query(`SELECT bucket, count FROM api_usage WHERE organization_id = $1 AND bucket = ANY($2::text[])`, [organizationId, [`d:${today}`, `x:${today}`]]),
    db.query(
      `SELECT SPLIT_PART(u.bucket, ':', 2)::int AS token_id, SPLIT_PART(u.bucket, ':', 3) AS day, u.count, t.name
         FROM api_usage u
         LEFT JOIN api_personal_access_tokens t ON t.token_id = SPLIT_PART(u.bucket, ':', 2)::int AND t.organization_id = u.organization_id
        WHERE u.organization_id = $1 AND u.bucket LIKE 't:%' AND u.updated_at > NOW() - INTERVAL '8 days'
        ORDER BY day DESC, u.count DESC`,
      [organizationId]
    ).catch(() => ({ rows: [] })),
  ]);
  const by = Object.fromEntries(rows.rows.map((r) => [r.bucket.slice(0, 1), r.count]));
  const usedToday = by.d || 0;
  const share = allowance.perDay ? usedToday / allowance.perDay : 0;
  const pausedToday = (by.x || 0) > 0;
  return {
    allowance,
    usedToday,
    share,
    limitHitToday: share >= 1,
    // Calls were paused today although the day isn't used up: too many in one minute.
    minuteLimitHit: pausedToday && share < 1,
    nearLimit: share >= WARN_AT || pausedToday,
    resetsInSeconds: secondsToNextDay(),
    recent: perToken.rows,
  };
}

const cleanInt = (value, max) => {
  const n = Number.parseInt(String(value == null ? "" : value).replace(/[,\s]/g, ""), 10);
  return Number.isInteger(n) && n > 0 ? Math.min(n, max) : null;
};
const cleanText = (value, max) => String(value == null ? "" : value).replace(/[\u0000-\u0008\u000b-\u001f\u007f]/g, "").trim().slice(0, max);

async function listRequests(organizationId) {
  await ensureApiAllowanceSchema();
  return (await db.query(`SELECT * FROM api_limit_requests WHERE organization_id = $1 ORDER BY created_at DESC LIMIT 50`, [organizationId])).rows;
}

// A school asks for more. Only one open request at a time.
async function createRequest(req, organizationId, body) {
  await ensureApiAllowanceSchema();
  const current = await getAllowance(organizationId);
  const perMinute = cleanInt(body.perMinute, MAX_PER_MINUTE);
  const perDay = cleanInt(body.perDay, MAX_PER_DAY);
  const reason = cleanText(body.reason, 2000);
  if (!perMinute || !perDay) throw Object.assign(new Error("Choose how many calls you need per minute and per day."), { status: 400 });
  if (perMinute <= current.perMinute && perDay <= current.perDay) {
    throw Object.assign(new Error("Ask for more than your current allowance."), { status: 400 });
  }
  if (reason.length < 10) throw Object.assign(new Error("Tell us briefly what the extra calls are for."), { status: 400 });
  const open = (await db.query(`SELECT 1 FROM api_limit_requests WHERE organization_id = $1 AND status = 'pending'`, [organizationId])).rows[0];
  if (open) throw Object.assign(new Error("You already have a request waiting. We'll reply to it first."), { status: 409 });
  const session = req.session || {};
  const user = session.user || {};
  const contactName = cleanText(body.contactName || [session.firstName || user.first_name, session.lastName || user.last_name].filter(Boolean).join(" "), 255);
  const contactEmail = cleanText(body.contactEmail || user.email, 255);
  if (contactEmail && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(contactEmail)) throw Object.assign(new Error("Enter a valid email address."), { status: 400 });
  const { rows } = await db.query(
    `INSERT INTO api_limit_requests (organization_id, requested_per_minute, requested_per_day, reason, contact_name, contact_email, created_by)
     VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING *`,
    [organizationId, perMinute, perDay, reason, contactName || null, contactEmail || null, Number(session.userId || user.user_id) || null]
  );
  await logOrganizationActivity({
    organizationId,
    userId: Number(session.userId || user.user_id) || null,
    userName: contactName || "Organization",
    userRole: session.userRole || session.accountType || null,
    actionType: "Requested",
    moduleName: "API Access",
    pagePath: req.originalUrl,
    recordType: "API allowance",
    recordId: String(rows[0].request_id),
    recordLabel: `${perMinute}/min, ${perDay}/day`,
    description: `Asked for a bigger API allowance: ${perMinute.toLocaleString("en-US")} calls a minute and ${perDay.toLocaleString("en-US")} a day.`,
    ipAddress: req.ip || null,
  }).catch(() => {});
  notifyAdmins(rows[0], current).catch(() => {});
  return rows[0];
}

async function cancelRequest(req, organizationId, requestId) {
  await ensureApiAllowanceSchema();
  const { rows } = await db.query(
    `UPDATE api_limit_requests SET status = 'cancelled', decided_at = NOW(), decided_by = 'school'
      WHERE organization_id = $1 AND request_id = $2 AND status = 'pending' RETURNING request_id`,
    [organizationId, requestId]
  );
  if (!rows[0]) throw Object.assign(new Error("Request not found."), { status: 404 });
}

const schoolName = async (organizationId) => ((await db.query(`SELECT organization_name FROM organizations WHERE organization_id = $1`, [organizationId])).rows[0] || {}).organization_name || `School #${organizationId}`;
const fmt = (n) => Number(n).toLocaleString("en-US");
const money = (n) => `$${Number(n || 0).toFixed(2)}`;

async function notifyAdmins(request, current) {
  const to = process.env.ADMIN_EMAIL;
  if (!to) return;
  const { sendEmailInBackground, renderCleanEmail } = require("./emailHelper");
  const name = await schoolName(request.organization_id);
  const base = String(process.env.NODE_ENV === "production" ? process.env.BASE_URL_PRODUCTION || "" : process.env.BASE_URL_LOCAL || "").replace(/\/$/, "");
  sendEmailInBackground({
    to,
    subject: `API allowance request: ${name}`,
    html: renderCleanEmail({
      title: "A school asked for a bigger API allowance",
      paragraphs: [
        `${name} would like their integrations to make more calls to the Managira API.`,
        "Grant it with a monthly price, or decline it, on the API requests page.",
      ],
      details: [
        `School: ${name}`,
        `Now: ${fmt(current.perMinute)} a minute, ${fmt(current.perDay)} a day`,
        `Asked for: ${fmt(request.requested_per_minute)} a minute, ${fmt(request.requested_per_day)} a day`,
        `Why: ${request.reason}`,
        `Contact: ${[request.contact_name, request.contact_email].filter(Boolean).join(", ") || "-"}`,
      ],
      ...(base ? { actionUrl: `${base}/admin/api-requests`, actionText: "Open API requests" } : {}),
    }),
  }, "API allowance request");
}

// ---------- Managira admin side ----------
async function adminListRequests() {
  await ensureApiAllowanceSchema();
  const { rows } = await db.query(
    `SELECT r.*, o.organization_name,
            COALESCE(a.per_minute, $1) AS current_per_minute, COALESCE(a.per_day, $2) AS current_per_day,
            COALESCE(a.monthly_price, 0) AS current_price
       FROM api_limit_requests r
       JOIN organizations o ON o.organization_id = r.organization_id
       LEFT JOIN api_allowances a ON a.organization_id = r.organization_id
      ORDER BY (r.status = 'pending') DESC, r.created_at DESC
      LIMIT 300`,
    [DEFAULT_ALLOWANCE.perMinute, DEFAULT_ALLOWANCE.perDay]
  );
  return rows;
}

async function adminListAllowances() {
  await ensureApiAllowanceSchema();
  return (await db.query(
    `SELECT a.*, o.organization_name FROM api_allowances a JOIN organizations o ON o.organization_id = a.organization_id
      ORDER BY o.organization_name`
  )).rows;
}

async function adminPendingCount() {
  await ensureApiAllowanceSchema();
  return Number((await db.query(`SELECT COUNT(*)::int AS n FROM api_limit_requests WHERE status = 'pending'`)).rows[0].n);
}

const adminName = (req) => {
  const s = req.session || {};
  const u = s.user || {};
  return [s.firstName || u.first_name, s.lastName || u.last_name].filter(Boolean).join(" ") || u.email || "Managira admin";
};

// Grant: set the school's new allowance and monthly price.
async function adminGrant(req, requestId, body) {
  await ensureApiAllowanceSchema();
  const perMinute = cleanInt(body.perMinute, MAX_PER_MINUTE);
  const perDay = cleanInt(body.perDay, MAX_PER_DAY);
  const price = Number(String(body.monthlyPrice == null ? "" : body.monthlyPrice).replace(/[$,\s]/g, ""));
  if (!perMinute || !perDay) throw Object.assign(new Error("Enter the calls per minute and per day to allow."), { status: 400 });
  if (!Number.isFinite(price) || price < 0 || price > 100000) throw Object.assign(new Error("Enter a monthly price (0 or more)."), { status: 400 });
  const note = cleanText(body.note, 1000);
  const client = await db.connect();
  try {
    await client.query("BEGIN");
    const request = (await client.query(`SELECT * FROM api_limit_requests WHERE request_id = $1 FOR UPDATE`, [requestId])).rows[0];
    if (!request) throw Object.assign(new Error("Request not found."), { status: 404 });
    if (request.status !== "pending") throw Object.assign(new Error("This request has already been answered."), { status: 409 });
    const by = adminName(req);
    await client.query(
      `INSERT INTO api_allowances (organization_id, per_minute, per_day, monthly_price, updated_at, updated_by)
       VALUES ($1, $2, $3, $4, NOW(), $5)
       ON CONFLICT (organization_id) DO UPDATE SET per_minute = $2, per_day = $3, monthly_price = $4, updated_at = NOW(), updated_by = $5`,
      [request.organization_id, perMinute, perDay, price.toFixed(2), by]
    );
    await client.query(
      `UPDATE api_limit_requests SET status = 'approved', granted_per_minute = $2, granted_per_day = $3, monthly_price = $4,
              admin_note = $5, decided_at = NOW(), decided_by = $6 WHERE request_id = $1`,
      [requestId, perMinute, perDay, price.toFixed(2), note || null, by]
    );
    // A fresh allowance starts without today's "calls were paused" warning.
    await client.query(`DELETE FROM api_usage WHERE organization_id = $1 AND bucket = $2`, [request.organization_id, `x:${dayKey()}`]);
    await client.query("COMMIT");
    await logOrganizationActivity({
      organizationId: request.organization_id,
      userName: `Managira (${by})`,
      userRole: "Managira admin",
      actionType: "Approved",
      moduleName: "API Access",
      recordType: "API allowance",
      recordId: String(requestId),
      recordLabel: `${perMinute}/min, ${perDay}/day`,
      description: `API allowance raised to ${fmt(perMinute)} calls a minute and ${fmt(perDay)} a day, for ${money(price)} a month on the school's bill.`,
    }).catch(() => {});
    notifySchool(request, { approved: true, perMinute, perDay, price, note }).catch(() => {});
    return { organizationId: request.organization_id };
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {});
    throw error;
  } finally {
    client.release();
  }
}

async function adminDecline(req, requestId, body) {
  await ensureApiAllowanceSchema();
  const note = cleanText(body.note, 1000);
  const { rows } = await db.query(
    `UPDATE api_limit_requests SET status = 'declined', admin_note = $2, decided_at = NOW(), decided_by = $3
      WHERE request_id = $1 AND status = 'pending' RETURNING *`,
    [requestId, note || null, adminName(req)]
  );
  if (!rows[0]) throw Object.assign(new Error("Request not found or already answered."), { status: 404 });
  await logOrganizationActivity({
    organizationId: rows[0].organization_id,
    userName: `Managira (${adminName(req)})`,
    userRole: "Managira admin",
    actionType: "Declined",
    moduleName: "API Access",
    recordType: "API allowance",
    recordId: String(requestId),
    description: `Request for a bigger API allowance was declined${note ? `: ${note}` : "."}`,
  }).catch(() => {});
  notifySchool(rows[0], { approved: false, note }).catch(() => {});
}

// Back to the standard allowance (stops the monthly charge).
async function adminReset(organizationId, req) {
  await ensureApiAllowanceSchema();
  await db.query(`DELETE FROM api_allowances WHERE organization_id = $1`, [organizationId]);
  await logOrganizationActivity({
    organizationId,
    userName: `Managira (${adminName(req)})`,
    userRole: "Managira admin",
    actionType: "Updated",
    moduleName: "API Access",
    recordType: "API allowance",
    description: "API allowance set back to the standard amount; the monthly API charge stopped.",
  }).catch(() => {});
}

async function notifySchool(request, { approved, perMinute, perDay, price, note }) {
  if (!request.contact_email) return;
  const { sendEmailInBackground, renderCleanEmail } = require("./emailHelper");
  const name = await schoolName(request.organization_id);
  sendEmailInBackground({
    to: request.contact_email,
    subject: approved ? "Your API allowance has been raised" : "About your API allowance request",
    html: renderCleanEmail({
      title: approved ? "Your API allowance has been raised" : "Your API allowance request",
      paragraphs: approved
        ? [
            `${name}'s integrations can now make ${fmt(perMinute)} calls a minute and ${fmt(perDay)} a day.`,
            `${money(price)} a month is added to your Managira bill from your next payment. You can see it in Settings → Access Tokens.`,
            ...(note ? [note] : []),
          ]
        : ["We couldn't raise your API allowance this time.", ...(note ? [note] : []), "Reply to this email if you'd like to talk about it."],
    }),
  }, "API allowance answer");
}

// What the school's bill adds each month for the API.
async function monthlyAddonUsd(organizationId, database = db) {
  try {
    await ensureApiAllowanceSchema(database);
    const row = (await database.query(`SELECT monthly_price FROM api_allowances WHERE organization_id = $1`, [organizationId])).rows[0];
    const price = Number(row && row.monthly_price);
    return Number.isFinite(price) && price > 0 ? price : 0;
  } catch (_e) {
    return 0;
  }
}

module.exports = {
  DEFAULT_ALLOWANCE,
  WARN_AT,
  ensureApiAllowanceSchema,
  getAllowance,
  recordCall,
  usageSummary,
  listRequests,
  createRequest,
  cancelRequest,
  adminListRequests,
  adminListAllowances,
  adminPendingCount,
  adminGrant,
  adminDecline,
  adminReset,
  monthlyAddonUsd,
  dayKey,
  minuteKey,
};
