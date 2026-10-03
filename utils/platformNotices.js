// Feedback requests from the Managira admin: a star rating + comment asked of
// chosen roles in chosen schools, repeating on a schedule. Also the shared
// audience lookup used to send bell notifications for admin announcements.
const crypto = require("crypto");
const notifSvc = require("./notificationService");

const ROLE_KEYS = ["manager", "teacher", "supervisor", "driver", "parent", "student"];
const ROLE_LABELS = { manager: "Managers", teacher: "Teachers", supervisor: "Supervisors", driver: "Drivers", parent: "Parents", student: "Students" };
const STAFF_ROLE_TYPES = { manager: "Manager", teacher: "Teacher", supervisor: "Supervisor", driver: "Driver" };
const FREQUENCIES = { once: null, monthly: 30, quarterly: 91, semiannual: 182, yearly: 365, custom: null };
const FREQUENCY_LABELS = { once: "Once", monthly: "Once a month", quarterly: "Every 3 months", semiannual: "Every 6 months", yearly: "Once a year", custom: "Custom" };
const COMMENT_MODES = ["optional", "required", "off"];
const DAY_MS = 24 * 60 * 60 * 1000;

let schemaReady = false;
async function ensureNoticesSchema(db) {
  if (schemaReady) return;
  await db.query(`
    CREATE TABLE IF NOT EXISTS feedback_requests (
      id SERIAL PRIMARY KEY,
      title VARCHAR(160) NOT NULL,
      description TEXT,
      question VARCHAR(200) NOT NULL DEFAULT 'How would you rate your experience?',
      comment_mode VARCHAR(12) NOT NULL DEFAULT 'optional',
      comment_prompt VARCHAR(160),
      anonymous BOOLEAN NOT NULL DEFAULT FALSE,
      allow_edit BOOLEAN NOT NULL DEFAULT FALSE,
      require_response BOOLEAN NOT NULL DEFAULT FALSE,
      roles TEXT[] NOT NULL DEFAULT '{}',
      all_organizations BOOLEAN NOT NULL DEFAULT FALSE,
      organization_ids INTEGER[] NOT NULL DEFAULT '{}',
      frequency VARCHAR(12) NOT NULL DEFAULT 'once',
      custom_days INTEGER,
      starts_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      ends_at TIMESTAMPTZ,
      status VARCHAR(12) NOT NULL DEFAULT 'draft',
      notify BOOLEAN NOT NULL DEFAULT TRUE,
      last_notified_period INTEGER,
      created_by INTEGER,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `);
  await db.query(`
    CREATE TABLE IF NOT EXISTS feedback_responses (
      id SERIAL PRIMARY KEY,
      request_id INTEGER NOT NULL REFERENCES feedback_requests(id) ON DELETE CASCADE,
      period_key INTEGER NOT NULL DEFAULT 0,
      respondent_key VARCHAR(64) NOT NULL,
      organization_id INTEGER,
      role VARCHAR(20),
      respondent_name VARCHAR(160),
      respondent_email VARCHAR(200),
      rating SMALLINT NOT NULL CHECK (rating BETWEEN 1 AND 5),
      comment TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      UNIQUE (request_id, period_key, respondent_key)
    )
  `);
  await db.query(`CREATE INDEX IF NOT EXISTS feedback_responses_request_idx ON feedback_responses (request_id, created_at DESC)`);
  schemaReady = true;
}

// ---- Who is signed in -------------------------------------------------------

// The school user behind a session, or null for admins / signed-out visitors.
function respondentFromSession(session = {}) {
  const orgId = Number(session.organizationId) || null;
  if (!orgId || session.superAdminOrgSwitch) return null;
  const role = String(session.userRole || "").trim();
  const accountType = String(session.accountType || session.user?.account_type || "").trim();
  if (role === "Student" || accountType === "Student") {
    const id = Number(session.studentId || session.userId);
    return id ? { type: "student", id, orgId, role: "student" } : null;
  }
  if (role === "Guardian" || accountType === "Guardian") {
    const id = Number(session.guardianId);
    return id ? { type: "guardian", id, orgId, role: "parent" } : null;
  }
  // The school's own account: notifications address it by its organization id.
  if (accountType.toLowerCase() === "organization") return { type: "staff", id: orgId, orgId, role: "manager", owner: true };
  const staffRole = Object.keys(STAFF_ROLE_TYPES).find((key) => STAFF_ROLE_TYPES[key] === role);
  const userId = Number(session.userId || session.user?.user_id);
  if (!staffRole || !userId) return null;
  return { type: "staff", id: userId, orgId, role: staffRole };
}

async function respondentIdentity(db, who) {
  try {
    if (who.owner) {
      const r = (await db.query(`SELECT organization_name AS name, email FROM organizations WHERE organization_id = $1`, [who.orgId])).rows[0];
      return { name: r?.name || "School account", email: r?.email || null };
    }
    if (who.type === "staff") {
      const r = (await db.query(`SELECT first_name, last_name, email FROM users WHERE user_id = $1`, [who.id])).rows[0];
      return { name: [r?.first_name, r?.last_name].filter(Boolean).join(" ") || null, email: r?.email || null };
    }
    if (who.type === "guardian") {
      const r = (await db.query(
        `SELECT gp.first_name, gp.last_name, ga.login_email FROM guardian_profiles gp
         LEFT JOIN guardian_accounts ga ON ga.guardian_id = gp.guardian_id AND ga.organization_id = gp.organization_id
         WHERE gp.guardian_id = $1 AND gp.organization_id = $2 LIMIT 1`, [who.id, who.orgId])).rows[0];
      return { name: [r?.first_name, r?.last_name].filter(Boolean).join(" ") || null, email: r?.login_email || null };
    }
    const r = (await db.query(
      `SELECT s.first_name, s.last_name, sa.login_email FROM students s
       LEFT JOIN student_accounts sa ON sa.student_id = s.student_id
       WHERE s.student_id = $1 LIMIT 1`, [who.id])).rows[0];
    return { name: [r?.first_name, r?.last_name].filter(Boolean).join(" ") || null, email: r?.login_email || null };
  } catch (_) {
    return { name: null, email: null };
  }
}

// Stable per-request key: stops duplicate answers without storing who
// answered when the request is anonymous.
function respondentKey(requestId, who) {
  const secret = process.env.SESSION_SECRET || "managira-feedback";
  return crypto.createHash("sha256").update(`${secret}|${requestId}|${who.type}|${who.id}|${who.orgId}`).digest("hex").slice(0, 48);
}

// ---- Feedback requests ------------------------------------------------------

function periodDays(request) {
  if (request.frequency === "custom") return Math.max(1, Number(request.custom_days) || 30);
  return FREQUENCIES[request.frequency] || null;
}

function periodKey(request, now = new Date()) {
  const days = periodDays(request);
  if (!days) return 0;
  return Math.max(0, Math.floor((now - new Date(request.starts_at)) / (days * DAY_MS)));
}

function nextPeriodStart(request, now = new Date()) {
  const days = periodDays(request);
  if (!days) return null;
  return new Date(new Date(request.starts_at).getTime() + (periodKey(request, now) + 1) * days * DAY_MS);
}

function requestState(request, now = new Date()) {
  if (request.status === "draft") return "draft";
  if (request.status === "closed" || (request.ends_at && new Date(request.ends_at) <= now)) return "closed";
  if (new Date(request.starts_at) > now) return "scheduled";
  return "active";
}

function normalizeRequestInput(body = {}) {
  const clean = (v, max) => String(v == null ? "" : v).replace(/\s+/g, " ").trim().slice(0, max);
  const bool = (v) => v === true || v === "true" || v === "on" || v === "1";
  const list = (v) => (Array.isArray(v) ? v : v == null || v === "" ? [] : [v]);
  const roles = [...new Set(list(body.roles).map(String).filter((r) => ROLE_KEYS.includes(r)))];
  const organizationIds = [...new Set(list(body.organizationIds).map(Number).filter((n) => Number.isInteger(n) && n > 0))];
  const frequency = Object.prototype.hasOwnProperty.call(FREQUENCIES, body.frequency) ? body.frequency : "once";
  const parseDate = (v) => { if (!v) return null; const d = new Date(v); return Number.isNaN(d.getTime()) ? null : d; };
  const data = {
    title: clean(body.title, 160),
    description: String(body.description || "").replace(/\r\n/g, "\n").trim().slice(0, 1200),
    question: clean(body.question, 200) || "How would you rate your experience?",
    commentMode: COMMENT_MODES.includes(body.commentMode) ? body.commentMode : "optional",
    commentPrompt: clean(body.commentPrompt, 160) || null,
    anonymous: bool(body.anonymous),
    allowEdit: bool(body.allowEdit),
    requireResponse: bool(body.requireResponse),
    roles,
    allOrganizations: bool(body.allOrganizations),
    organizationIds,
    frequency,
    customDays: frequency === "custom" ? Math.min(730, Math.max(1, parseInt(body.customDays, 10) || 0)) : null,
    startsAt: parseDate(body.startsAt) || new Date(),
    endsAt: parseDate(body.endsAt),
    notify: body.notify === undefined ? true : bool(body.notify),
  };
  const errors = [];
  if (!data.title) errors.push("Add a title.");
  if (!data.roles.length) errors.push("Choose at least one group of people.");
  if (!data.allOrganizations && !data.organizationIds.length) errors.push("Choose at least one school, or select all schools.");
  if (frequency === "custom" && !data.customDays) errors.push("Set how many days between requests.");
  if (data.endsAt && data.endsAt <= data.startsAt) errors.push("The end date must be after the start date.");
  return { data, errors };
}

async function activeOrganizations(db) {
  return (await db.query(
    `SELECT organization_id, organization_name FROM organizations
     WHERE COALESCE(deleted, false) = false ORDER BY organization_name ASC`
  )).rows;
}

// Everyone a notice reaches: [{ type, id, orgId, role }].
async function audienceMembers(db, { roles, allOrganizations, organizationIds }) {
  const orgIds = allOrganizations
    ? (await activeOrganizations(db)).map((o) => o.organization_id)
    : (organizationIds || []).map(Number);
  if (!orgIds.length || !roles.length) return [];
  const members = [];
  const staffTypes = roles.filter((r) => STAFF_ROLE_TYPES[r]).map((r) => STAFF_ROLE_TYPES[r]);
  if (staffTypes.length) {
    const rows = (await db.query(
      `SELECT user_id, organization_id, account_type::text AS t FROM users
       WHERE organization_id = ANY($1::int[]) AND account_type::text = ANY($2::text[]) AND COALESCE(on_hold, false) = false`,
      [orgIds, staffTypes]
    )).rows;
    rows.forEach((r) => members.push({ type: "staff", id: r.user_id, orgId: r.organization_id, role: Object.keys(STAFF_ROLE_TYPES).find((k) => STAFF_ROLE_TYPES[k] === r.t) }));
  }
  if (roles.includes("manager")) {
    // The school's own account (signs in with the school email).
    orgIds.forEach((orgId) => members.push({ type: "staff", id: orgId, orgId, role: "manager", owner: true }));
  }
  if (roles.includes("parent")) {
    (await db.query(`SELECT guardian_id, organization_id FROM guardian_accounts WHERE organization_id = ANY($1::int[])`, [orgIds])).rows
      .forEach((r) => members.push({ type: "guardian", id: r.guardian_id, orgId: r.organization_id, role: "parent" }));
  }
  if (roles.includes("student")) {
    (await db.query(`SELECT student_id, organization_id FROM student_accounts WHERE organization_id = ANY($1::int[])`, [orgIds])).rows
      .forEach((r) => members.push({ type: "student", id: r.student_id, orgId: r.organization_id, role: "student" }));
  }
  const seen = new Set();
  return members.filter((m) => { const k = `${m.type}:${m.id}:${m.orgId}`; if (seen.has(k)) return false; seen.add(k); return true; });
}

// Bell notifications exist for staff and parents only (students have no bell);
// students still get the in-app prompt.
async function notifyMembers(db, members, { type, title, body, link, refId }) {
  const list = members
    .filter((m) => m.type === "staff" || m.type === "guardian")
    .map((m) => ({ orgId: m.orgId, recipientType: m.type, recipientId: m.id, type, title, body, link, refId }));
  for (let i = 0; i < list.length; i += 400) {
    await notifSvc.createNotifications(db, list.slice(i, i + 400));
  }
  return list.length;
}

// Sends the bell notification for each request whose current period hasn't
// been announced yet (a new request, or the start of a new period).
async function sendDueFeedbackNotifications(db, now = new Date()) {
  await ensureNoticesSchema(db);
  const due = (await db.query(
    `SELECT * FROM feedback_requests
     WHERE status = 'active' AND notify = true AND starts_at <= now() AND (ends_at IS NULL OR ends_at > now())`
  )).rows;
  let sent = 0;
  for (const request of due) {
    const period = periodKey(request, now);
    if (request.last_notified_period !== null && request.last_notified_period >= period) continue;
    // Claim the period first so two servers never notify twice.
    const claimed = await db.query(
      `UPDATE feedback_requests SET last_notified_period = $2
       WHERE id = $1 AND (last_notified_period IS NULL OR last_notified_period < $2) RETURNING id`,
      [request.id, period]
    );
    if (!claimed.rowCount) continue;
    const members = await audienceMembers(db, { roles: request.roles, allOrganizations: request.all_organizations, organizationIds: request.organization_ids });
    sent += await notifyMembers(db, members, {
      type: "feedback_request",
      title: "We'd love your feedback",
      body: request.title,
      link: `/notices/feedback/${request.id}`,
      refId: request.id,
    });
  }
  return sent;
}

let lastSweepAt = 0;
function sweepFeedbackNotificationsSoon(db) {
  if (Date.now() - lastSweepAt < 10 * 60 * 1000) return;
  lastSweepAt = Date.now();
  sendDueFeedbackNotifications(db).catch((error) => console.error("[notices] feedback notification sweep failed:", error.message));
}

// Open requests for this person that still need an answer this period.
async function pendingFeedbackFor(db, who, now = new Date()) {
  await ensureNoticesSchema(db);
  const open = (await db.query(
    `SELECT * FROM feedback_requests
     WHERE status = 'active' AND starts_at <= now() AND (ends_at IS NULL OR ends_at > now())
       AND $1 = ANY(roles) AND (all_organizations OR $2 = ANY(organization_ids))
     ORDER BY require_response DESC, starts_at ASC`,
    [who.role, who.orgId]
  )).rows;
  if (!open.length) return [];
  const keys = open.map((r) => respondentKey(r.id, who));
  const answered = new Set((await db.query(
    `SELECT request_id, period_key FROM feedback_responses WHERE respondent_key = ANY($1::text[])`,
    [keys]
  )).rows.map((r) => `${r.request_id}:${r.period_key}`));
  return open.filter((r) => !answered.has(`${r.id}:${periodKey(r, now)}`));
}

function publicRequest(request, now = new Date()) {
  return {
    id: request.id,
    title: request.title,
    description: request.description || "",
    question: request.question,
    commentMode: request.comment_mode,
    commentPrompt: request.comment_prompt || (request.comment_mode === "required" ? "Tell us more" : "Tell us more (optional)"),
    anonymous: request.anonymous,
    required: request.require_response,
    period: periodKey(request, now),
  };
}

async function loadRequestForRespondent(db, requestId, who) {
  await ensureNoticesSchema(db);
  const request = (await db.query(`SELECT * FROM feedback_requests WHERE id = $1`, [requestId])).rows[0];
  if (!request) return { error: "This feedback request no longer exists.", status: 404 };
  const targeted = request.roles.includes(who.role) && (request.all_organizations || request.organization_ids.includes(who.orgId));
  if (!targeted) return { error: "This feedback request isn't for your account.", status: 403 };
  if (requestState(request) !== "active") return { error: "This feedback request is closed.", status: 410, request };
  const key = respondentKey(request.id, who);
  const existing = (await db.query(
    `SELECT rating, comment, updated_at FROM feedback_responses WHERE request_id = $1 AND period_key = $2 AND respondent_key = $3`,
    [request.id, periodKey(request), key]
  )).rows[0] || null;
  return { request, existing, key };
}

async function saveFeedbackResponse(db, who, requestId, { rating, comment }) {
  const loaded = await loadRequestForRespondent(db, requestId, who);
  if (loaded.error) return loaded;
  const { request, existing, key } = loaded;
  const stars = parseInt(rating, 10);
  if (!(stars >= 1 && stars <= 5)) return { error: "Please choose a star rating.", status: 400 };
  const text = request.comment_mode === "off" ? "" : String(comment || "").replace(/\r\n/g, "\n").trim().slice(0, 2000);
  if (request.comment_mode === "required" && text.length < 2) return { error: "Please add a comment before submitting.", status: 400 };
  if (existing && !request.allow_edit) return { error: "You've already shared your feedback - thank you!", status: 409 };
  const identity = request.anonymous ? { name: null, email: null } : await respondentIdentity(db, who);
  await db.query(
    `INSERT INTO feedback_responses (request_id, period_key, respondent_key, organization_id, role, respondent_name, respondent_email, rating, comment)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
     ON CONFLICT (request_id, period_key, respondent_key)
     DO UPDATE SET rating = EXCLUDED.rating, comment = EXCLUDED.comment, updated_at = now()`,
    [request.id, periodKey(request), key, who.orgId, who.role, identity.name, identity.email, stars, text || null]
  );
  return { ok: true, updated: Boolean(existing) };
}

module.exports = {
  ROLE_KEYS,
  ROLE_LABELS,
  FREQUENCY_LABELS,
  ensureNoticesSchema,
  respondentFromSession,
  respondentKey,
  periodKey,
  nextPeriodStart,
  requestState,
  normalizeRequestInput,
  activeOrganizations,
  audienceMembers,
  notifyMembers,
  sendDueFeedbackNotifications,
  sweepFeedbackNotificationsSoon,
  pendingFeedbackFor,
  publicRequest,
  loadRequestForRespondent,
  saveFeedbackResponse,
};
