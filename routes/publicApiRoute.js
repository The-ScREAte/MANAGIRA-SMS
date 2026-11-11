// Managira's API for third-party integrations (mounted at /api/v1, before the
// session middleware). Credentials come from Settings -> Access Tokens:
//
//   POST /api/v1/auth/token   { client_id, client_secret, personal_access_token }
//     -> { access_token, token_type: "Bearer", expires_in, scope }
//   GET  /api/v1/...          Authorization: Bearer <access_token>
//
// Every request acts as the token's service account, inside its own school,
// and needs the scope the endpoint names.
const express = require("express");
const router = express.Router();
const db = require("../config/db");
const { checkRateLimit } = require("../utils/rateLimiter");
const { exchangeToken, verifyAccessToken } = require("../utils/apiAccess");
const { recordCall } = require("../utils/apiAllowance");

router.use(express.json({ limit: "64kb" }));
router.use(express.urlencoded({ extended: false, limit: "64kb" }));
router.use((req, res, next) => {
  res.set("Cache-Control", "no-store");
  next();
});

const fail = (res, status, error, message) => res.status(status).json({ error, message });

// The caller's address. In production every request comes through the host's
// proxy, which adds the real address last in X-Forwarded-For (earlier entries
// can be made up by the caller, so only the last one is trusted).
const callerIp = (req) => {
  if (process.env.NODE_ENV === "production") {
    const forwarded = String(req.get("x-forwarded-for") || "").split(",").map((part) => part.trim()).filter(Boolean);
    if (forwarded.length) return forwarded[forwarded.length - 1];
  }
  return req.ip;
};

router.post("/auth/token", async (req, res) => {
  const body = req.body || {};
  // Per caller, and per school (client ID), so guessing is slow from anywhere.
  const perCaller = checkRateLimit(`api-token:ip:${callerIp(req)}`, { max: 20, windowMs: 60 * 1000 });
  const perClient = checkRateLimit(`api-token:client:${String(body.client_id || "").slice(0, 64)}`, { max: 60, windowMs: 60 * 1000 });
  if (!perCaller.allowed || !perClient.allowed) {
    const wait = Math.max(1, Math.ceil(Math.max(perCaller.retryAfterMs || 0, perClient.retryAfterMs || 0) / 1000));
    res.set("Retry-After", String(wait));
    return fail(res, 429, "rate_limited", `Too many token requests. Try again in ${wait} seconds.`);
  }
  try {
    const issued = await exchangeToken({
      clientId: body.client_id,
      clientSecret: body.client_secret,
      personalAccessToken: body.personal_access_token,
      ip: callerIp(req),
    });
    if (!issued) return fail(res, 401, "invalid_client", "The client ID, client secret or access token is not valid, has expired or was revoked.");
    return res.json({ access_token: issued.accessToken, token_type: "Bearer", expires_in: issued.expiresIn, scope: issued.scopes.join(" ") });
  } catch (error) {
    console.error("[api/v1 token]", error);
    return fail(res, 500, "server_error", "Could not issue a token.");
  }
});

// Bearer token -> req.api; then each route names the scope it needs.
async function authenticate(req, res, next) {
  const header = String(req.get("authorization") || "");
  const token = header.toLowerCase().startsWith("bearer ") ? header.slice(7).trim() : "";
  if (!token) return fail(res, 401, "unauthorized", "Send an access token: Authorization: Bearer <access_token>.");
  try {
    const access = await verifyAccessToken(token);
    if (!access) return fail(res, 401, "invalid_token", "The access token is not valid, has expired or was revoked.");
    // The school's allowance: counted in the database, reported on every answer.
    const usage = await recordCall(access.organizationId, access.tokenId);
    res.set({
      "X-RateLimit-Limit": String(usage.minute.limit),
      "X-RateLimit-Remaining": String(usage.minute.remaining),
      "X-RateLimit-Reset": String(usage.minute.resetSeconds),
      "X-RateLimit-Daily-Limit": String(usage.day.limit),
      "X-RateLimit-Daily-Remaining": String(usage.day.remaining),
      "X-RateLimit-Daily-Reset": String(usage.day.resetSeconds),
    });
    if (!usage.allowed) {
      const daily = usage.reason === "daily";
      const wait = daily ? usage.day.resetSeconds : usage.minute.resetSeconds;
      res.set("Retry-After", String(wait));
      return fail(res, 429, daily ? "daily_limit_reached" : "rate_limited", daily
        ? `This school's daily API allowance (${usage.day.limit.toLocaleString("en-US")} calls) is used up. It resets at midnight UTC, in ${wait >= 5400 ? `about ${Math.round(wait / 3600)} hours` : `${Math.ceil(wait / 60)} minutes`}.`
        : `Too many calls this minute (limit ${usage.minute.limit}). Retry in ${wait} seconds.`);
    }
    req.api = access;
    return next();
  } catch (error) {
    console.error("[api/v1 auth]", error);
    return fail(res, 500, "server_error", "Could not check the access token.");
  }
}
const needs = (scope) => (req, res, next) => (req.api.scopes.includes(scope)
  ? next()
  : fail(res, 403, "insufficient_scope", `This token does not have the "${scope}" scope.`));

// Query values: only plain whole numbers and real dates get through.
const id = (value) => (/^\d{1,9}$/.test(String(value == null ? "" : value).trim()) ? Number(value) : null);
const dateParam = (value) => {
  const text = String(value == null ? "" : value).trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) return null;
  const d = new Date(`${text}T00:00:00Z`);
  return Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== text ? null : text;
};
const page = (req) => {
  const limit = Math.min(Math.max(id(req.query.limit) || 50, 1), 200);
  const offset = Math.min(id(req.query.offset) || 0, 1000000);
  return { limit, offset };
};
const list = (res, rows, { limit, offset }) => res.json({ data: rows, limit, offset, has_more: rows.length === limit });
const wrap = (fn) => (req, res) => fn(req, res).catch((error) => {
  console.error("[api/v1]", req.path, error.message);
  fail(res, 500, "server_error", "Something went wrong.");
});
// ?updated_since=<ISO time>: only what changed after it. Anything that isn't a
// real time is refused, so a typo can't silently return everything.
const SINCE_OVERLAP_MINUTES = 5;
const sinceOf = (req) => {
  const raw = req.query.updated_since;
  if (raw == null || raw === "") return { value: null };
  const time = Date.parse(String(raw));
  if (!Number.isFinite(time) || time < Date.UTC(2000, 0, 1) || time > Date.now() + 86400000) return { error: true };
  return { value: new Date(time).toISOString() };
};

// A paged, school-scoped list: $1 is always the school, the last two are limit/offset.
// sql may depend on the request. With { incremental: true } the route takes
// ?updated_since and answers with the cursor for the next sync.
const listRoute = (scope, sql, params = () => [], options = {}) => [needs(scope), wrap(async (req, res) => {
  const p = page(req);
  let since = { value: null };
  if (options.incremental) {
    since = sinceOf(req);
    if (since.error) return fail(res, 400, "invalid_request", "updated_since must be a date-time like 2026-11-01T08:00:00Z.");
    req.since = since.value;
  }
  const text = typeof sql === "function" ? sql(req) : sql;
  const values = [req.api.organizationId, ...params(req)];
  const [{ rows }, clock] = await Promise.all([
    db.query(`${text} LIMIT $${values.length + 1} OFFSET $${values.length + 2}`, [...values, p.limit, p.offset]),
    options.incremental ? db.query("SELECT NOW() AS now") : Promise.resolve(null),
  ]);
  if (!options.incremental) return list(res, rows, p);
  const now = clock.rows[0].now;
  return res.json({
    data: rows, limit: p.limit, offset: p.offset, has_more: rows.length === p.limit,
    updated_since: since.value,
    server_time: new Date(now).toISOString(),
    // Use this as updated_since next time. It overlaps a little, so a change
    // saved while you were syncing is never missed (you may see it twice).
    next_updated_since: new Date(new Date(now).getTime() - SINCE_OVERLAP_MINUTES * 60000).toISOString(),
  });
})];

router.use(authenticate);

router.get("/me", needs("tenant.read"), wrap(async (req, res) => {
  const org = (await db.query(
    `SELECT organization_id, organization_name, organization_country FROM organizations WHERE organization_id = $1`,
    [req.api.organizationId]
  )).rows[0] || {};
  res.json({
    organization: { id: org.organization_id, name: org.organization_name, country: org.organization_country || null },
    service_account: req.api.serviceAccount,
    scopes: req.api.scopes,
  });
}));

// ---------- classes & subjects ----------
router.get("/classes", ...listRoute("classes.read",
  `SELECT class_id AS id, class_name AS name FROM classes
    WHERE organization_id = $1 AND obsolete_at IS NULL
    ORDER BY COALESCE(dashboard_sort_order, 2147483647), class_name, class_id`));
router.get("/subjects", ...listRoute("classes.read",
  `SELECT subject_id AS id, subject_name AS name, class_id, term_id FROM subjects
    WHERE organization_id = $1 AND obsolete_at IS NULL AND ($2::int IS NULL OR class_id = $2)
    ORDER BY class_id, subject_name, subject_id`, (req) => [id(req.query.class_id)]));
router.get("/school-years", ...listRoute("classes.read",
  `SELECT id, year_label AS name, COALESCE(current, FALSE) AS current FROM school_years
    WHERE organization_id = $1 ORDER BY year_label DESC, id`));
router.get("/terms", ...listRoute("classes.read",
  `SELECT term_id AS id, term_name AS name, school_year_id, TO_CHAR(start_date, 'YYYY-MM-DD') AS start_date,
          TO_CHAR(end_date, 'YYYY-MM-DD') AS end_date, COALESCE(current, FALSE) AS current
     FROM terms WHERE organization_id = $1 AND ($2::int IS NULL OR school_year_id = $2)
    ORDER BY start_date DESC NULLS LAST, term_id`, (req) => [id(req.query.school_year_id)]));

// ---------- students ----------
// status: active, graduated, or the reason they left (archived). updated_at
// moves on any change, including leaving, so incremental sync sees it.
const STUDENT_FROM = `FROM students s
  LEFT JOIN classes c ON c.class_id = s.class_id AND c.organization_id = s.organization_id
  LEFT JOIN LATERAL (
    SELECT a.archive_kind, a.archived_at_ts FROM archived_student_info a
     WHERE a.student_id = s.student_id AND a.organization_id = s.organization_id
     ORDER BY a.id DESC LIMIT 1
  ) arch ON TRUE`;
const STUDENT_FIELDS = `s.student_id AS id, s.custom_student_id AS student_number, s.first_name, s.last_name, s.gender,
  s.class_id, c.class_name,
  CASE WHEN arch.archive_kind IS NOT NULL THEN LOWER(arch.archive_kind) WHEN COALESCE(s.graduated, FALSE) THEN 'graduated' ELSE 'active' END AS status,
  GREATEST(s.api_changed_at, arch.archived_at_ts) AS updated_at`;
router.get("/students", ...listRoute("students.read",
  (req) => `SELECT ${STUDENT_FIELDS} ${STUDENT_FROM}
    WHERE s.organization_id = $1 AND ($2::int IS NULL OR s.class_id = $2)
      AND ($3::timestamptz IS NULL OR GREATEST(s.api_changed_at, arch.archived_at_ts) > $3)
    ORDER BY ${req.since ? "updated_at, s.student_id" : "s.last_name, s.first_name, s.student_id"}`,
  (req) => [id(req.query.class_id), req.since], { incremental: true }));
router.get("/students/:id", needs("students.read"), wrap(async (req, res) => {
  const studentId = id(req.params.id);
  if (!studentId) return fail(res, 404, "not_found", "No such student.");
  const { rows } = await db.query(
    `SELECT ${STUDENT_FIELDS} ${STUDENT_FROM} WHERE s.organization_id = $1 AND s.student_id = $2`,
    [req.api.organizationId, studentId]
  );
  return rows[0] ? res.json({ data: rows[0] }) : fail(res, 404, "not_found", "No such student.");
}));

// ---------- parents & guardians ----------
router.get("/guardians", ...listRoute("guardians.read",
  (req) => `SELECT g.guardian_id AS id, g.first_name, g.last_name, g.email, g.phone,
          COALESCE(ARRAY_AGG(s.student_id ORDER BY s.student_id) FILTER (WHERE s.student_id IS NOT NULL), '{}') AS student_ids,
          GREATEST(g.updated_at, MAX(gs.created_at)) AS updated_at
     FROM guardian_profiles g
     LEFT JOIN guardian_students gs ON gs.guardian_id = g.guardian_id
     LEFT JOIN students s ON s.student_id = gs.student_id AND s.organization_id = g.organization_id
    WHERE g.organization_id = $1
    GROUP BY g.guardian_id
    HAVING ($2::timestamptz IS NULL OR GREATEST(g.updated_at, MAX(gs.created_at)) > $2)
    ORDER BY ${req.since ? "updated_at, g.guardian_id" : "g.last_name, g.first_name, g.guardian_id"}`,
  (req) => [req.since], { incremental: true }));

// ---------- attendance ----------
// One day (?date=), or everything marked/changed since (?updated_since=).
router.get("/attendance", needs("attendance.read"), (req, res, next) => {
  if (req.query.date == null && req.query.updated_since) return next();
  return dateParam(req.query.date) ? next() : fail(res, 400, "invalid_request", "Pass a real date as YYYY-MM-DD, or updated_since.");
}, ...listRoute("attendance.read",
  (req) => `SELECT a.attendance_id AS id, a.student_id, a.class_id, TO_CHAR(a.date, 'YYYY-MM-DD') AS date, a.status, a.marked_at,
          COALESCE(a.updated_at, a.marked_at) AS updated_at
     FROM attendance_records a
    WHERE a.organization_id = $1 AND ($2::date IS NULL OR a.date = $2::date) AND ($3::int IS NULL OR a.class_id = $3)
      AND ($4::timestamptz IS NULL OR COALESCE(a.updated_at, a.marked_at) > $4)
    ORDER BY ${req.since ? "updated_at, a.attendance_id" : "a.class_id, a.student_id"}`,
  (req) => [dateParam(req.query.date), id(req.query.class_id), req.since], { incremental: true }));

// ---------- grades ----------
router.get("/grades", ...listRoute("grades.read",
  `SELECT ar.student_id, ar.class_id, ar.subject_id, sub.subject_name, ar.term_id, ar.assessment_id,
          COALESCE(a.title, ar.title) AS assessment, COALESCE(a.category, ar.category) AS category,
          ar.score, a.max_score, ar.total_percentage, ar.grade, ar.position
     FROM assessment_results ar
     JOIN students s ON s.student_id = ar.student_id AND s.organization_id = ar.organization_id
     LEFT JOIN subjects sub ON sub.subject_id = ar.subject_id AND sub.organization_id = ar.organization_id
     LEFT JOIN assessments a ON a.assessment_id = ar.assessment_id AND a.organization_id = ar.organization_id
    WHERE ar.organization_id = $1 AND ($2::int IS NULL OR ar.term_id = $2)
      AND ($3::int IS NULL OR ar.class_id = $3) AND ($4::int IS NULL OR ar.student_id = $4)
    ORDER BY ar.term_id DESC NULLS LAST, ar.class_id, ar.student_id, ar.subject_id, ar.result_id`,
  (req) => [id(req.query.term_id), id(req.query.class_id), id(req.query.student_id)]));

// ---------- staff ----------
// Includes people who were removed (status "removed") or put on hold, so an
// integration can switch them off too.
router.get("/employees", ...listRoute("staff.read",
  (req) => `SELECT user_id AS id, first_name, last_name, email, account_type AS role,
          CASE WHEN removed_at IS NOT NULL OR organization_id IS DISTINCT FROM $1 THEN 'removed' WHEN COALESCE(on_hold, FALSE) THEN 'on_hold' ELSE 'active' END AS status,
          GREATEST(updated_at, removed_at) AS updated_at
     FROM users
    WHERE (organization_id = $1 OR removed_from_organization_id = $1)
      AND ($2::timestamptz IS NULL OR GREATEST(updated_at, removed_at) > $2)
    ORDER BY ${req.since ? "updated_at, user_id" : "last_name, first_name, user_id"}`,
  (req) => [req.since], { incremental: true }));

// ---------- events & announcements ----------
router.get("/events", ...listRoute("calendar.read",
  `SELECT id, name, details, TO_CHAR(event_date, 'YYYY-MM-DD') AS start_date, TO_CHAR(end_date, 'YYYY-MM-DD') AS end_date,
          start_time, end_time, COALESCE(all_day, FALSE) AS all_day, location, visibility, term_id
     FROM school_events WHERE organization_id = $1 AND ($2::date IS NULL OR event_date >= $2::date)
    ORDER BY event_date DESC, id DESC`, (req) => [dateParam(req.query.from)]));
router.get("/announcements", ...listRoute("calendar.read",
  `SELECT announcement_id AS id, message, visibility, term_id, school_year_id, created_at
     FROM announcements WHERE organization_id = $1
    ORDER BY created_at DESC, announcement_id DESC`));

// ---------- PayGira ----------
router.get("/paygira/bills", ...listRoute("paygira.read",
  (req) => `SELECT bill_id AS id, title, description, amount, bill_type, recurrence, TO_CHAR(due_date, 'YYYY-MM-DD') AS due_date,
          status, term_id, school_year_id, created_at, COALESCE(updated_at, created_at) AS updated_at
     FROM finance_bills WHERE organization_id = $1 AND ($2::timestamptz IS NULL OR COALESCE(updated_at, created_at) > $2)
    ORDER BY ${req.since ? "updated_at, bill_id" : "created_at DESC, bill_id DESC"}`,
  (req) => [req.since], { incremental: true }));
router.get("/paygira/balances", ...listRoute("paygira.read",
  (req) => `SELECT fa.assignment_id AS id, fa.bill_id, b.title AS bill, fa.student_id,
          COALESCE(fa.amount, 0) + COALESCE(fa.late_fee_applied, 0) AS billed, COALESCE(fa.amount_paid, 0) AS paid,
          GREATEST(COALESCE(fa.amount, 0) + COALESCE(fa.late_fee_applied, 0) - COALESCE(fa.amount_paid, 0), 0) AS balance,
          fa.status, TO_CHAR(b.due_date, 'YYYY-MM-DD') AS due_date, COALESCE(fa.updated_at, fa.created_at) AS updated_at
     FROM finance_bill_assignments fa
     JOIN finance_bills b ON b.bill_id = fa.bill_id AND b.organization_id = fa.organization_id
    WHERE fa.organization_id = $1 AND ($2::int IS NULL OR fa.student_id = $2) AND ($3::int IS NULL OR fa.bill_id = $3)
      AND ($4::timestamptz IS NULL OR COALESCE(fa.updated_at, fa.created_at) > $4)
    ORDER BY ${req.since ? "updated_at, fa.assignment_id" : "fa.assignment_id"}`, (req) => [id(req.query.student_id), id(req.query.bill_id), req.since], { incremental: true }));
router.get("/paygira/payments", ...listRoute("paygira.read",
  (req) => `SELECT payment_id AS id, bill_id, student_id, assignment_id,
          CASE WHEN COALESCE(is_refund, FALSE) THEN -amount ELSE amount END AS amount,
          CASE WHEN COALESCE(is_refund, FALSE) THEN 'refund' ELSE 'payment' END AS kind,
          method, reference, received_at
     FROM finance_payments
    WHERE organization_id = $1 AND ($2::date IS NULL OR received_at >= $2::date)
      AND ($3::date IS NULL OR received_at < ($3::date + 1))
      AND ($4::timestamptz IS NULL OR received_at > $4)
    ORDER BY ${req.since ? "received_at, payment_id" : "received_at DESC, payment_id DESC"}`,
  (req) => [dateParam(req.query.from), dateParam(req.query.to), req.since], { incremental: true }));

// ---------- transportation ----------
router.get("/transportation/routes", ...listRoute("transport.read",
  `SELECT r.route_id AS id, r.route_name AS name, r.route_code AS code, r.route_status AS status,
          COALESCE(JSON_AGG(JSON_BUILD_OBJECT('id', st.stop_id, 'name', st.stop_name, 'address', st.stop_address,
            'pickup_time', st.pickup_time, 'dropoff_time', st.dropoff_time, 'order', st.stop_order)
            ORDER BY st.stop_order, st.stop_id) FILTER (WHERE st.stop_id IS NOT NULL), '[]') AS stops
     FROM transport_routes r
     LEFT JOIN transport_stops st ON st.route_id = r.route_id AND st.organization_id = r.organization_id
    WHERE r.organization_id = $1
    GROUP BY r.route_id
    ORDER BY r.route_name, r.route_id`));
router.get("/transportation/stops", ...listRoute("transport.read",
  `SELECT stop_id AS id, route_id, stop_name AS name, stop_address AS address, pickup_time, dropoff_time, stop_order AS "order"
     FROM transport_stops WHERE organization_id = $1 AND ($2::int IS NULL OR route_id = $2)
    ORDER BY route_id NULLS LAST, stop_order, stop_id`, (req) => [id(req.query.route_id)]));
router.get("/transportation/buses", ...listRoute("transport.read",
  `SELECT bus_id AS id, bus_number, bus_name AS name, capacity, status, license_plate
     FROM transport_buses WHERE organization_id = $1
    ORDER BY bus_number, bus_id`));
router.get("/transportation/assignments", ...listRoute("transport.read",
  `SELECT a.student_id, a.bus_id, a.route_id, a.stop_id, st.stop_name, a.pickup_time, a.dropoff_time
     FROM transport_student_assignments a
     LEFT JOIN transport_stops st ON st.stop_id = a.stop_id AND st.organization_id = a.organization_id
    WHERE a.organization_id = $1 AND COALESCE(a.active, TRUE) AND ($2::int IS NULL OR a.student_id = $2)
    ORDER BY a.student_id, a.assignment_id`, (req) => [id(req.query.student_id)]));

// ---------- assessments (to send scores to) ----------
router.get("/assessments", ...listRoute("grades.read",
  `SELECT a.assessment_id AS id, a.title, a.category, a.max_score, a.class_id, a.subject_id, sub.subject_name, a.term_id,
          COALESCE(a.is_locked, FALSE) AS locked
     FROM assessments a
     LEFT JOIN subjects sub ON sub.subject_id = a.subject_id AND sub.organization_id = a.organization_id
    WHERE a.organization_id = $1 AND COALESCE(a.is_active, TRUE) AND a.obsolete_at IS NULL
      AND ($2::int IS NULL OR a.term_id = $2) AND ($3::int IS NULL OR a.class_id = $3) AND ($4::int IS NULL OR a.subject_id = $4)
    ORDER BY a.term_id DESC NULLS LAST, a.class_id, a.subject_id, a.assessment_id`,
  (req) => [id(req.query.term_id), id(req.query.class_id), id(req.query.subject_id)]));

// ---------- sending information in ----------
// Each needs its own write scope (Management, Service accounts: "Information it may send in").
// A request that changes something answers with what was saved, or a clear reason it wasn't.
const writes = require("../utils/apiWrites");
const sendIn = (scope, run, created = false) => [needs(scope), (req, res) => {
  if (!req.is("application/json")) return fail(res, 415, "unsupported_media_type", "Send the body as JSON (Content-Type: application/json).");
  return new Promise((resolve) => resolve(run(req)))
    .then((out) => res.status(created && !(out && out.data && out.data.already_recorded) ? 201 : 200).json(out))
    .catch((error) => {
      if (error instanceof writes.ApiInputError) return fail(res, error.status, error.error, error.message);
      console.error("[api/v1 write]", req.path, error && error.message);
      return fail(res, 500, "server_error", "Something went wrong. Nothing was saved.");
    });
}];
router.post("/students", ...sendIn("students.write", (req) => writes.createStudent(req.api, req.body || {}), true));
router.patch("/students/:id", ...sendIn("students.write", (req) => {
  const studentId = id(req.params.id);
  if (!studentId) throw new writes.ApiInputError(404, "not_found", "No such student.");
  return writes.updateStudent(req.api, studentId, req.body || {});
}));
router.post("/guardians", ...sendIn("guardians.write", (req) => writes.createGuardian(req.api, req.body || {}), true));
router.patch("/guardians/:id", ...sendIn("guardians.write", (req) => {
  const guardianId = id(req.params.id);
  if (!guardianId) throw new writes.ApiInputError(404, "not_found", "No such parent or guardian.");
  return writes.updateGuardian(req.api, guardianId, req.body || {});
}));
router.post("/attendance", ...sendIn("attendance.write", (req) => writes.markAttendance(req.api, req.body || {})));
router.post("/grades", ...sendIn("grades.write", (req) => writes.enterScores(req.api, req.body || {})));
router.post("/paygira/payments", ...sendIn("paygira.write", (req) => writes.recordPayment(req.api, req.body || {}), true));

// ---------- deletions ----------
// Students, guardians and attendance marks deleted since a time, for the areas
// this token can read. Pair with updated_since on the lists.
const DELETED_SCOPES = { student: "students.read", guardian: "guardians.read", attendance: "attendance.read" };
router.get("/deleted", (req, res, next) => {
  const since = sinceOf(req);
  if (!since.value) return fail(res, 400, "invalid_request", "Pass updated_since, e.g. ?updated_since=2026-11-01T08:00:00Z.");
  req.since = since.value;
  const allowed = Object.keys(DELETED_SCOPES).filter((entity) => req.api.scopes.includes(DELETED_SCOPES[entity]));
  if (!allowed.length) return fail(res, 403, "insufficient_scope", "This token can't read students, guardians or attendance.");
  req.deletedEntities = allowed;
  return next();
}, ...listRoute("managira.api.access",
  `SELECT entity, record_id AS id, deleted_at FROM api_deleted_records
    WHERE organization_id = $1 AND entity = ANY($2::text[]) AND deleted_at > $3
    ORDER BY deleted_at, id`,
  (req) => [req.deletedEntities, req.since], { incremental: true }));

router.use((req, res) => fail(res, 404, "not_found", "No such API endpoint."));
// Bad request bodies (broken JSON, too large) get a JSON answer, never a page.
// eslint-disable-next-line no-unused-vars
router.use((error, req, res, next) => {
  if (error && error.type === "entity.too.large") return fail(res, 413, "payload_too_large", "The request body is too large.");
  if (error && (error.type === "entity.parse.failed" || error instanceof SyntaxError)) return fail(res, 400, "invalid_request", "The request body is not valid JSON.");
  console.error("[api/v1]", error && error.message);
  return fail(res, 500, "server_error", "Something went wrong.");
});

module.exports = router;
