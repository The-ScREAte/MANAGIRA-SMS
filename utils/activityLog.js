const db = require("../config/db");

const LOG_SCHEMA_PROMISE_KEY = "_organizationActivityLogSchemaPromise";
const TRACKED_PREFIXES = ["/common", "/account", "/print", "/promotion", "/transcript", "/documents", "/stats", "/guardian"];
const NOISE_PATH_PREFIXES = [
  "/health",
  "/api/chatbot",
  "/account/confirm-password",
  "/account/forget-password",
  "/account/reset-password",
  "/common/reports",
];
const SENSITIVE_KEYS = new Set([
  "password",
  "confirmPassword",
  "currentPassword",
  "newPassword",
  "token",
  "secret",
  "authorization",
  "cookie",
  "connect.sid",
  "_csrf",
]);
const VALUELESS_KEYS = new Set(["submit", "confirm", "redirect", "returnTo", "organizationId"]);

function normalizePath(input) {
  return String(input || "").split("?")[0].trim();
}

function toTitleCase(value) {
  return String(value || "")
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/\b\w/g, (match) => match.toUpperCase());
}

function humanizeFieldName(value) {
  return String(value || "")
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/^./, (match) => match.toUpperCase());
}

function isNonEmptyPrimitive(value) {
  if (value == null) return false;
  if (typeof value === "string") return value.trim() !== "";
  if (typeof value === "number") return Number.isFinite(value);
  if (typeof value === "boolean") return true;
  return false;
}

function safeScalar(value) {
  if (typeof value === "string") {
    return value.trim().slice(0, 240);
  }
  if (typeof value === "number" || typeof value === "boolean") {
    return value;
  }
  return null;
}

function getSessionUser(req) {
  const sessionUser = req.session?.user || {};
  const firstName = req.session?.firstName || sessionUser.first_name || "";
  const lastName = req.session?.lastName || sessionUser.last_name || "";
  const fullName = `${firstName} ${lastName}`.trim();

  return {
    userId: req.session?.userId || sessionUser.user_id || null,
    userName: fullName || req.session?.organizationName || sessionUser.email || "Unknown User",
    userRole: req.session?.userRole || sessionUser.account_type || null,
  };
}

function shouldSkipRequest(req) {
  const path = normalizePath(req.originalUrl || req.path);

  if (!req.session?.organizationId) return true;
  if (!TRACKED_PREFIXES.some((prefix) => path.startsWith(prefix))) return true;
  if (NOISE_PATH_PREFIXES.some((prefix) => path.startsWith(prefix))) return true;
  if (req.session?.accountType === "Admin" || req.session?.accountType === "Mini Admin") return true;
  if (path.startsWith("/hub") || path.startsWith("/admin")) return true;

  return false;
}

function isMeaningfulGet(path) {
  return /(delete|logout|printstudentreport|transcript|meritsheet|download|export|reverse|emailreports)/i.test(path);
}

function shouldTrackRequest(req) {
  if (shouldSkipRequest(req)) return false;

  const path = normalizePath(req.originalUrl || req.path).toLowerCase();
  const method = String(req.method || "GET").toUpperCase();

  if (["POST", "PUT", "PATCH", "DELETE"].includes(method)) return true;
  if (method === "GET") return isMeaningfulGet(path);

  return false;
}

function inferActionType(req) {
  const method = String(req.method || "GET").toUpperCase();
  const path = normalizePath(req.originalUrl || req.path).toLowerCase();

  if (path.includes("logout")) return "Logout";
  if (path.includes("login")) return "Login";
  if (path.includes("approve")) return "Approved";
  if (path.includes("reject")) return "Rejected";
  if (path.includes("delete") || method === "DELETE") return "Deleted";
  if (path.includes("email") || path.includes("notify") || path.includes("message")) return "Messaged";
  if (path.includes("print")) return "Printed";
  if (path.includes("generate")) return "Generated";
  if (path.includes("transcript")) return "Generated";
  if (path.includes("meritsheet")) return "Generated";
  if (path.includes("export") || path.includes("download")) return "Exported";
  if (path.includes("payment") || path.includes("billing") || path.includes("paystack") || path.includes("flutterwave")) return "Payment Action";
  if (path.includes("permission") || path.includes("role")) return "Permission Change";
  if (path.includes("status") || path.includes("toggle") || path.includes("hold") || path.includes("reverse")) return "Status Change";
  if (path.includes("savescore") || path.includes("saveallscore") || path.includes("score")) return "Scored";
  if (path.includes("attendance")) return "Marked Attendance";
  if (path.includes("assign") || path.includes("upload")) return "Uploaded";
  if (method === "POST" && /(create|add|register|invite|new)/i.test(path)) return "Created";
  if (path.includes("modify") || path.includes("edit") || path.includes("update")) return "Updated";
  if (method === "POST" || method === "PUT" || method === "PATCH") return "Updated";

  return "Updated";
}

function inferModuleName(req) {
  const path = normalizePath(req.originalUrl || req.path);
  const cleanPath = path.replace(/^\//, "");
  const segments = cleanPath.split("/").filter(Boolean);
  const candidate = segments[1] || segments[0] || "system";

  const joined = `/${segments.join("/")}`.toLowerCase();
  if (joined.includes("transcript")) return "Transcripts";
  if (joined.includes("meritsheet")) return "Merit Sheet";
  if (joined.includes("printstudentreport") || joined.includes("reportsettings") || joined.includes("reportcard")) return "Report Cards";
  if (joined.startsWith("/print/")) return "Report Cards";
  if (joined.includes("email") || joined.includes("parentmessage") || joined.includes("message") || joined.includes("notify")) return "Messaging";
  if (joined.includes("savescore") || joined.includes("saveallscore") || joined.includes("scoreremark")) return "Assessment";
  if (joined.startsWith("/common/addstudent") || joined.startsWith("/common/student") || joined.startsWith("/common/editstudent") || joined.includes("guardiandetails") || joined.includes("admissionpending")) return "Students";
  if (joined.includes("attendance")) return "Attendance";
  if (joined.includes("employee")) return "Employees";
  if (joined.includes("assessment") || joined.includes("test")) return "Assessment";
  if (joined.includes("event") || joined.includes("announcement")) return "Announcements";
  if (joined.includes("classschedule")) return "Class Schedules";
  if (joined.includes("class") || joined.includes("subject") || joined.includes("schoolyear") || joined.includes("term")) return "Academic Setup";
  if (joined.startsWith("/account/update-card") || joined.includes("payment") || joined.includes("billing") || joined.includes("paystack") || joined.includes("flutterwave") || joined.includes("update-plan")) return "Billing";
  if (joined.startsWith("/account/")) return "Settings";
  if (joined.startsWith("/documents/")) return "Documents";
  if (joined.startsWith("/promotion/")) return "Promotions";
  if (joined.startsWith("/stats/")) return "Analytics";
  if (joined.startsWith("/guardian/")) return "Guardian Portal";

  return toTitleCase(candidate);
}

function inferRecordType(req, moduleName) {
  const path = normalizePath(req.originalUrl || req.path).toLowerCase();
  if (path.includes("student")) return "Student Record";
  if (path.includes("guardian")) return "Guardian Record";
  if (path.includes("employee") || path.includes("user")) return "User Record";
  if (path.includes("assessment") || path.includes("test")) return "Assessment Record";
  if (path.includes("term")) return "Term Record";
  if (path.includes("schoolyear")) return "School Year";
  if (path.includes("classschedule")) return "Class Schedule";
  if (path.includes("class")) return "Class Record";
  if (path.includes("subject")) return "Subject Record";
  if (path.includes("document")) return "Document";
  if (path.includes("payment") || path.includes("billing") || path.includes("paystack")) return "Payment Record";
  if (path.includes("report") || path.includes("transcript")) return "Report";
  if (path.includes("announcement")) return "Announcement";
  if (path.includes("event")) return "Event";
  if (path.includes("promotion")) return "Promotion Batch";
  return moduleName === "Settings" ? "Organization Settings" : moduleName;
}

function extractRecordReference(req, recordType) {
  const params = req.params || {};
  const body = req.body && typeof req.body === "object" ? req.body : {};
  const source = { ...body, ...params };
  const idKeys = [
    "studentId",
    "student_id",
    "userId",
    "user_id",
    "guardianId",
    "guardian_id",
    "documentId",
    "document_id",
    "classId",
    "class_id",
    "subjectId",
    "subject_id",
    "id",
    "reportId",
    "report_id",
    "termId",
    "term_id",
    "schoolYearId",
    "school_year_id",
    "paymentId",
    "payment_id",
  ];
  const labelKeys = [
    "studentName",
    "student_name",
    "fullName",
    "name",
    "title",
    "subject",
    "documentName",
    "document_name",
    "className",
    "class_name",
    "organization_name",
    "email",
  ];

  let recordId = null;
  for (const key of idKeys) {
    if (isNonEmptyPrimitive(source[key])) {
      recordId = String(source[key]).trim().slice(0, 100);
      break;
    }
  }

  let recordLabel = null;
  for (const key of labelKeys) {
    if (isNonEmptyPrimitive(source[key])) {
      recordLabel = String(source[key]).trim().slice(0, 240);
      break;
    }
  }

  if (!recordLabel && recordId) {
    recordLabel = `${recordType} #${recordId}`;
  }

  return { recordId, recordLabel };
}

function summarizeChangedFields(body) {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return [];
  }

  const changedFields = [];
  for (const [key, rawValue] of Object.entries(body)) {
    if (SENSITIVE_KEYS.has(key) || VALUELESS_KEYS.has(key)) continue;

    if (Array.isArray(rawValue)) {
      const values = rawValue
        .map((entry) => safeScalar(entry))
        .filter((entry) => entry != null)
        .slice(0, 5);

      if (values.length > 0) {
        changedFields.push({ field: key, value: values.join(", ") });
      }
      continue;
    }

    const scalar = safeScalar(rawValue);
    if (scalar == null || scalar === "") continue;
    changedFields.push({ field: key, value: scalar });
  }

  return changedFields.slice(0, 8);
}

// Maps input field keys (from req.body / req.params) to { table, idColumn, nameExpr }
// nameExpr is a SQL expression that produces a human-readable label.
const ID_FIELD_LOOKUP = {
  class_id:        { table: "classes",       idColumn: "class_id",       nameExpr: "class_name" },
  classid:         { table: "classes",       idColumn: "class_id",       nameExpr: "class_name" },
  subject_id:      { table: "subjects",      idColumn: "subject_id",     nameExpr: "subject_name" },
  subjectid:       { table: "subjects",      idColumn: "subject_id",     nameExpr: "subject_name" },
  term_id:         { table: "terms",         idColumn: "term_id",        nameExpr: "term_name" },
  termid:          { table: "terms",         idColumn: "term_id",        nameExpr: "term_name" },
  school_year_id:  { table: "school_years",  idColumn: "id",             nameExpr: "year_label" },
  schoolyearid:    { table: "school_years",  idColumn: "id",             nameExpr: "year_label" },
  year_id:         { table: "school_years",  idColumn: "id",             nameExpr: "year_label" },
  student_id:      { table: "students",      idColumn: "student_id",     nameExpr: "first_name || ' ' || last_name" },
  studentid:       { table: "students",      idColumn: "student_id",     nameExpr: "first_name || ' ' || last_name" },
  guardian_id:     { table: "guardians",     idColumn: "guardian_id",    nameExpr: "first_name || ' ' || last_name" },
  guardianid:      { table: "guardians",     idColumn: "guardian_id",    nameExpr: "first_name || ' ' || last_name" },
  user_id:         { table: "users",         idColumn: "user_id",        nameExpr: "first_name || ' ' || last_name" },
  userid:          { table: "users",         idColumn: "user_id",        nameExpr: "first_name || ' ' || last_name" },
  employee_id:     { table: "users",         idColumn: "user_id",        nameExpr: "first_name || ' ' || last_name" },
  employeeid:      { table: "users",         idColumn: "user_id",        nameExpr: "first_name || ' ' || last_name" },
  assessment_id:   { table: "assessments",   idColumn: "assessment_id",  nameExpr: "title" },
  assessmentid:    { table: "assessments",   idColumn: "assessment_id",  nameExpr: "title" },
  announcement_id: { table: "announcements", idColumn: "announcement_id",nameExpr: "LEFT(message, 80)" },
  organization_id: { table: "organizations", idColumn: "organization_id",nameExpr: "organization_name" },
};

const LABEL_CACHE = new Map();
const LABEL_CACHE_TTL_MS = 60_000;

function getCachedLabel(table, id) {
  const key = `${table}:${id}`;
  const entry = LABEL_CACHE.get(key);
  if (entry && entry.expiresAt > Date.now()) return entry.value;
  return undefined;
}

function setCachedLabel(table, id, value) {
  const key = `${table}:${id}`;
  LABEL_CACHE.set(key, { value, expiresAt: Date.now() + LABEL_CACHE_TTL_MS });
  if (LABEL_CACHE.size > 500) {
    // Simple cap - drop oldest insertion
    const firstKey = LABEL_CACHE.keys().next().value;
    if (firstKey) LABEL_CACHE.delete(firstKey);
  }
}

async function resolveIdToLabel(database, table, idColumn, nameExpr, rawId, organizationId) {
  const id = Number(rawId);
  if (!Number.isInteger(id) || id <= 0) return null;

  const cached = getCachedLabel(table, id);
  if (cached !== undefined) return cached;

  try {
    const hasOrgScope = table !== "organizations";
    const sql = hasOrgScope
      ? `SELECT (${nameExpr}) AS label FROM ${table} WHERE ${idColumn} = $1 AND organization_id = $2 LIMIT 1`
      : `SELECT (${nameExpr}) AS label FROM ${table} WHERE ${idColumn} = $1 LIMIT 1`;
    const params = hasOrgScope ? [id, organizationId] : [id];
    const result = await database.query(sql, params);
    const label = result.rows[0]?.label ? String(result.rows[0].label).trim() : null;
    setCachedLabel(table, id, label);
    return label;
  } catch (error) {
    setCachedLabel(table, id, null);
    return null;
  }
}

async function resolveChangedFieldLabels(database, organizationId, changedFields) {
  if (!Array.isArray(changedFields) || changedFields.length === 0) return changedFields;
  if (!organizationId) return changedFields;

  const enriched = await Promise.all(
    changedFields.map(async (entry) => {
      const field = String(entry.field || "").toLowerCase();
      const mapping = ID_FIELD_LOOKUP[field];
      if (!mapping) return entry;

      const label = await resolveIdToLabel(database, mapping.table, mapping.idColumn, mapping.nameExpr, entry.value, organizationId);
      if (!label) return entry;
      return { field: entry.field, value: `${label} (#${entry.value})` };
    })
  );
  return enriched;
}

async function resolveRecordReferenceLabel(database, organizationId, req, recordReference) {
  const params = req.params || {};
  const body = req.body && typeof req.body === "object" ? req.body : {};
  const source = { ...body, ...params };

  // Priority order: most specific named IDs first
  const preferredKeys = [
    "student_id", "studentId",
    "guardian_id", "guardianId",
    "employee_id", "employeeId", "user_id", "userId",
    "assessment_id", "assessmentId",
    "subject_id", "subjectId",
    "class_id", "classId",
    "term_id", "termId",
    "school_year_id", "schoolYearId", "year_id", "yearId",
    "announcement_id", "announcementId",
  ];
  const keysToCheck = [
    ...preferredKeys.filter((key) => Object.prototype.hasOwnProperty.call(source, key)),
    ...Object.keys(source).filter((key) => !preferredKeys.includes(key)),
  ];

  for (const key of keysToCheck) {
    const mapping = ID_FIELD_LOOKUP[String(key).toLowerCase()];
    if (!mapping) continue;
    const rawValue = source[key];
    if (!isNonEmptyPrimitive(rawValue)) continue;

    const label = await resolveIdToLabel(database, mapping.table, mapping.idColumn, mapping.nameExpr, rawValue, organizationId);
    if (label) {
      return {
        recordId: String(rawValue).trim().slice(0, 100),
        recordLabel: label,
      };
    }
  }

  return recordReference;
}

function buildDescription(actionType, moduleName, recordReference, changedFields) {
  if (actionType === "Login") return `Signed in to ${moduleName}.`;
  if (actionType === "Logout") return `Signed out of ${moduleName}.`;

  const recordPart = recordReference.recordLabel || recordReference.recordId || moduleName;
  if (changedFields.length > 0) {
    const parts = changedFields.slice(0, 4).map((entry) => {
      const label = humanizeFieldName(entry.field);
      const value = String(entry.value || "").trim();
      if (!value) return label;
      const short = value.length > 60 ? `${value.slice(0, 60)}…` : value;
      return `${label}: ${short}`;
    });
    return `${actionType} ${recordPart} — ${parts.join(" · ")}.`;
  }

  return `${actionType} ${recordPart}.`;
}

async function describeStudentGroup(database, organizationId, studentIds) {
  const ids = Array.from(new Set(studentIds.map((id) => Number(id)).filter((id) => Number.isInteger(id) && id > 0)));
  if (ids.length === 0) return null;

  try {
    const result = await database.query(
      `SELECT student_id, first_name || ' ' || last_name AS name
       FROM students
       WHERE organization_id = $1 AND student_id = ANY($2::int[])
       ORDER BY last_name, first_name`,
      [organizationId, ids]
    );
    const names = result.rows.map((row) => row.name.trim()).filter(Boolean);
    if (names.length === 0) return `${ids.length} students`;
    if (names.length <= 3) return names.join(", ");
    return `${names.slice(0, 3).join(", ")} and ${names.length - 3} more`;
  } catch (error) {
    return `${ids.length} students`;
  }
}

async function describeParentGroup(database, organizationId, studentIds) {
  const ids = Array.from(new Set(studentIds.map((id) => Number(id)).filter((id) => Number.isInteger(id) && id > 0)));
  if (ids.length === 0) return null;

  try {
    const result = await database.query(
      `SELECT DISTINCT first_name || ' ' || last_name AS name
       FROM guardians
       WHERE organization_id = $1 AND student_id = ANY($2::int[])
       ORDER BY name`,
      [organizationId, ids]
    );
    const names = result.rows.map((row) => (row.name || "").trim()).filter(Boolean);
    if (names.length === 0) return null;
    if (names.length <= 2) return names.join(", ");
    return `${names.slice(0, 2).join(", ")} and ${names.length - 2} more`;
  } catch (error) {
    return null;
  }
}

function formatCurrency(value, currency) {
  const num = Number(value);
  if (!Number.isFinite(num)) return null;
  const ccy = String(currency || "").trim().toUpperCase() || "NGN";
  try {
    return new Intl.NumberFormat("en-US", { style: "currency", currency: ccy, maximumFractionDigits: 2 }).format(num);
  } catch {
    return `${ccy} ${num.toFixed(2)}`;
  }
}

function humanizeNameDisplayFormat(value) {
  const normalized = String(value || "").trim().toLowerCase();
  if (normalized === "last_first") return "Last, First";
  return "First Last";
}

function humanizeDateDisplayFormat(value) {
  const normalized = String(value || "").trim().toLowerCase();
  if (normalized === "mm_dd_yyyy") return "MM/DD/YYYY";
  if (normalized === "yyyy_mm_dd") return "YYYY/MM/DD";
  return "DD/MM/YYYY";
}

/**
 * Route-aware enrichment. Runs AFTER basic ID->name resolution so we can
 * override/augment description, record label, and changed fields for high-value
 * operations: attendance, payments, messaging, transcript/report exports.
 */
async function enrichPayloadForRoute(database, req, payload) {
  const organizationId = payload.organizationId;
  const path = String(payload.pagePath || "").toLowerCase();
  const body = req.body && typeof req.body === "object" && !Array.isArray(req.body) ? req.body : {};
  if (!organizationId) return payload;

  // ---- Attendance batch save -------------------------------------------------
  if (path.includes("attendance") && body.attendance && typeof body.attendance === "object") {
    const entries = Object.entries(body.attendance);
    const studentIds = entries.map(([sid]) => sid);
    const statusCounts = entries.reduce((acc, [, status]) => {
      const key = String(status || "unknown").toLowerCase();
      acc[key] = (acc[key] || 0) + 1;
      return acc;
    }, {});

    const studentsLabel = await describeStudentGroup(database, organizationId, studentIds);
    const parentsLabel = await describeParentGroup(database, organizationId, studentIds);
    const statusSummary = Object.entries(statusCounts)
      .map(([k, v]) => `${v} ${k}`)
      .join(", ");

    payload.changedFields = [
      ...(studentsLabel ? [{ field: "Students", value: studentsLabel }] : []),
      ...(parentsLabel ? [{ field: "Guardians", value: parentsLabel }] : []),
      ...(statusSummary ? [{ field: "Status", value: statusSummary }] : []),
      ...(body.date ? [{ field: "Date", value: String(body.date) }] : []),
      ...payload.changedFields.filter((f) => !["attendance", "classid", "class_id", "termid", "term_id", "date"].includes(String(f.field).toLowerCase())),
    ].slice(0, 8);

    payload.actionType = "Marked Attendance";
    payload.moduleName = "Attendance";
    if (!payload.recordLabel) payload.recordLabel = "Attendance batch";
    payload.description = `Marked attendance for ${studentsLabel || entries.length + " students"} (${statusSummary || "status updated"}) on ${body.date || "today"}.`;
  }

  // ---- Payment / Billing operations -----------------------------------------
  if (
    /paystack|flutterwave|payment|billing|update-plan|update-card|add-card|cancel-subscription|remove-card|tokenize-card|paystack-subaccount/.test(path)
  ) {
    const amount = body.amount || body.amountPaid || body.total_amount || body.price;
    const currency = body.currency || body.ccy || "NGN";
    const method = body.method || body.paymentMethod || body.channel;
    const planName = body.plan_name || body.planName;
    const planId = body.plan_id || body.planId;
    const last4 = body.card_last4 || body.last4;
    const description = body.description || body.note;

    const extras = [];
    const amountLabel = formatCurrency(amount, currency);
    if (amountLabel) extras.push({ field: "Amount", value: amountLabel });
    if (method) extras.push({ field: "Method", value: String(method) });
    if (planName) extras.push({ field: "Plan", value: String(planName) });
    else if (planId) extras.push({ field: "Plan Id", value: String(planId) });
    if (last4) extras.push({ field: "Card", value: `•••• ${String(last4).slice(-4)}` });
    if (description) extras.push({ field: "Note", value: String(description).slice(0, 80) });

    if (extras.length > 0) {
      payload.changedFields = [
        ...extras,
        ...payload.changedFields.filter((f) => !["amount", "currency", "method", "plan_id", "plan_name", "card_last4", "last4", "description"].includes(String(f.field).toLowerCase())),
      ].slice(0, 8);
    }

    payload.moduleName = "Billing";
    if (!payload.recordLabel) payload.recordLabel = planName || "Billing action";
    if (extras.length > 0) {
      payload.description = `${payload.actionType} billing — ${extras.map((e) => `${e.field}: ${e.value}`).join(" · ")}.`;
    }
  }

  // ---- Organization display preferences --------------------------------------
  if (path.includes("display-preferences")) {
    const nameFormat = humanizeNameDisplayFormat(body.nameDisplayFormat);
    const dateFormat = humanizeDateDisplayFormat(body.dateDisplayFormat);

    payload.actionType = "Updated";
    payload.moduleName = "Settings";
    payload.recordType = "Organization Settings";
    payload.recordLabel = "Display Preferences";
    payload.changedFields = [
      { field: "Name format", value: nameFormat },
      { field: "Date format", value: dateFormat },
      ...payload.changedFields.filter((entry) => {
        const key = String(entry.field || "").toLowerCase();
        return key !== "namedisplayformat" && key !== "datedisplayformat";
      }),
    ].slice(0, 8);
    payload.description = `Updated display preferences — Name format: ${nameFormat} · Date format: ${dateFormat}.`;
  }

  // ---- PayGira collection/sign-off operations --------------------------------
  if (/my-paygira|\/guardian\/paygira/.test(path)) {
    const amount = formatCurrency(body.amount || body.totalAmount || body.total_amount, body.currency || "NGN");
    const method = body.method || body.paymentMethod || body.channel;
    const assignmentId = body.assignment_id || body.assignmentId;
    const occurrenceDate = body.occurrence_date || body.occurrenceDate;
    const selectedDates = Array.isArray(body.occurrence_dates) ? body.occurrence_dates.length : null;
    const bulkItems = Array.isArray(body.items) ? body.items.length : null;

    payload.moduleName = "Billing";

    if (path.includes("signoff")) {
      payload.actionType = "Status Change";
      payload.recordLabel = "PayGira Sign-off";
      payload.description = `Signed off PayGira collection${occurrenceDate ? ` for ${occurrenceDate}` : ""}.`;
      payload.changedFields = [
        ...(occurrenceDate ? [{ field: "Occurrence", value: String(occurrenceDate) }] : []),
        ...payload.changedFields,
      ].slice(0, 8);
    } else if (path.includes("collect/bulk")) {
      payload.actionType = "Payment Action";
      payload.recordLabel = "PayGira Bulk Collection";
      payload.description = `Recorded bulk PayGira collection${amount ? ` — Amount: ${amount}` : ""}${method ? ` · Method: ${method}` : ""}.`;
      payload.changedFields = [
        ...(bulkItems ? [{ field: "Items", value: String(bulkItems) }] : []),
        ...(amount ? [{ field: "Amount", value: amount }] : []),
        ...(method ? [{ field: "Method", value: String(method) }] : []),
        ...payload.changedFields,
      ].slice(0, 8);
    } else if (path.includes("collect") || path.includes("/pay")) {
      payload.actionType = "Payment Action";
      payload.recordLabel = "PayGira Payment";
      payload.description = `Recorded PayGira payment${amount ? ` — Amount: ${amount}` : ""}${method ? ` · Method: ${method}` : ""}.`;
      payload.changedFields = [
        ...(assignmentId ? [{ field: "Assignment", value: String(assignmentId) }] : []),
        ...(occurrenceDate ? [{ field: "Occurrence", value: String(occurrenceDate) }] : []),
        ...(selectedDates ? [{ field: "Dates", value: String(selectedDates) }] : []),
        ...(amount ? [{ field: "Amount", value: amount }] : []),
        ...(method ? [{ field: "Method", value: String(method) }] : []),
        ...payload.changedFields,
      ].slice(0, 8);
    }
  }

  // ---- Messaging: parent email / announcement email -------------------------
  if (/email|parentmessage|notify|sendmessage|message/.test(path) && !path.includes("parentmessageread")) {
    const subject = body.subject || body.title;
    const recipientCount = Array.isArray(body.recipients) ? body.recipients.length : (body.recipient_count || null);
    const studentId = body.studentId || body.student_id;

    const extras = [];
    if (subject) extras.push({ field: "Subject", value: String(subject).slice(0, 80) });
    if (recipientCount) extras.push({ field: "Recipients", value: `${recipientCount}` });

    if (studentId) {
      const name = await resolveIdToLabel(database, "students", "student_id", "first_name || ' ' || last_name", studentId, organizationId);
      if (name) extras.push({ field: "Student", value: `${name} (#${studentId})` });
    }

    if (extras.length > 0) {
      payload.moduleName = "Messaging";
      payload.actionType = "Messaged";
      payload.changedFields = [...extras, ...payload.changedFields].slice(0, 8);
      payload.description = `Sent message — ${extras.map((e) => `${e.field}: ${e.value}`).join(" · ")}.`;
      if (!payload.recordLabel && subject) payload.recordLabel = String(subject).slice(0, 120);
    }
  }

  // ---- Transcript / Report Card / Merit Sheet prints ------------------------
  if (/transcript|printstudentreport|meritsheet|emailreports/.test(path)) {
    const studentId = body.studentId || body.student_id || (req.params && (req.params.studentId || req.params.student_id));
    const termId = body.termId || body.term_id;
    const classId = body.classId || body.class_id;

    const extras = [];
    if (studentId) {
      const name = await resolveIdToLabel(database, "students", "student_id", "first_name || ' ' || last_name", studentId, organizationId);
      if (name) extras.push({ field: "Student", value: `${name} (#${studentId})` });
    }
    if (classId) {
      const name = await resolveIdToLabel(database, "classes", "class_id", "class_name", classId, organizationId);
      if (name) extras.push({ field: "Class", value: `${name} (#${classId})` });
    }
    if (termId) {
      const name = await resolveIdToLabel(database, "terms", "term_id", "term_name", termId, organizationId);
      if (name) extras.push({ field: "Term", value: `${name} (#${termId})` });
    }

    if (extras.length > 0) {
      payload.changedFields = [...extras, ...payload.changedFields].slice(0, 8);
      const kind = path.includes("transcript") ? "transcript" : path.includes("meritsheet") ? "merit sheet" : "report card";
      payload.description = `${payload.actionType} ${kind} — ${extras.map((e) => `${e.field}: ${e.value}`).join(" · ")}.`;
    }
  }

  return payload;
}

async function ensureOrganizationActivityLogSchema(database = db) {
  if (global[LOG_SCHEMA_PROMISE_KEY]) return global[LOG_SCHEMA_PROMISE_KEY];

  global[LOG_SCHEMA_PROMISE_KEY] = (async () => {
    await database.query(`
      CREATE TABLE IF NOT EXISTS organization_activity_logs (
        log_id SERIAL PRIMARY KEY,
        organization_id INTEGER NOT NULL REFERENCES organizations(organization_id) ON DELETE CASCADE,
        user_id INTEGER,
        user_name VARCHAR(255) NOT NULL,
        user_role VARCHAR(100),
        action_type VARCHAR(100) NOT NULL,
        module_name VARCHAR(120) NOT NULL,
        page_path VARCHAR(255),
        record_type VARCHAR(120),
        record_id VARCHAR(100),
        record_label VARCHAR(255),
        description TEXT NOT NULL,
        changed_fields JSONB DEFAULT '[]'::jsonb,
        ip_address VARCHAR(45),
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    await database.query(`CREATE INDEX IF NOT EXISTS idx_org_activity_logs_org_created ON organization_activity_logs(organization_id, created_at DESC)`);
    await database.query(`CREATE INDEX IF NOT EXISTS idx_org_activity_logs_org_action ON organization_activity_logs(organization_id, action_type)`);
    await database.query(`CREATE INDEX IF NOT EXISTS idx_org_activity_logs_org_module ON organization_activity_logs(organization_id, module_name)`);
    await database.query(`CREATE INDEX IF NOT EXISTS idx_org_activity_logs_org_user ON organization_activity_logs(organization_id, user_name)`);
  })();

  global[LOG_SCHEMA_PROMISE_KEY].catch(() => {
    global[LOG_SCHEMA_PROMISE_KEY] = null;
  });

  return global[LOG_SCHEMA_PROMISE_KEY];
}

async function logOrganizationActivity(input, database = db) {
  const organizationId = Number(input?.organizationId);
  if (!organizationId) return;

  await ensureOrganizationActivityLogSchema(database);

  await database.query(
    `INSERT INTO organization_activity_logs (
      organization_id,
      user_id,
      user_name,
      user_role,
      action_type,
      module_name,
      page_path,
      record_type,
      record_id,
      record_label,
      description,
      changed_fields,
      ip_address
    ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12::jsonb, $13)`,
    [
      organizationId,
      input.userId || null,
      String(input.userName || "Unknown User").slice(0, 255),
      input.userRole ? String(input.userRole).slice(0, 100) : null,
      String(input.actionType || "Updated").slice(0, 100),
      String(input.moduleName || "System").slice(0, 120),
      input.pagePath ? String(input.pagePath).slice(0, 255) : null,
      input.recordType ? String(input.recordType).slice(0, 120) : null,
      input.recordId ? String(input.recordId).slice(0, 100) : null,
      input.recordLabel ? String(input.recordLabel).slice(0, 255) : null,
      String(input.description || "Updated a record.").slice(0, 3000),
      JSON.stringify(Array.isArray(input.changedFields) ? input.changedFields : []),
      input.ipAddress ? String(input.ipAddress).slice(0, 45) : null,
    ]
  );
}

// Latest activate/deactivate entry per integration record label, for showing
// "who changed this and when" inline on each integration card.
async function getLatestIntegrationActivity(database, organizationId, recordLabels) {
  const orgId = Number(organizationId);
  const labels = Array.isArray(recordLabels) ? recordLabels.filter(Boolean) : [];
  if (!orgId || !labels.length) return {};

  await ensureOrganizationActivityLogSchema(database);

  const result = await database.query(
    `SELECT DISTINCT ON (record_label)
       record_label, action_type, user_name, user_role, created_at
     FROM organization_activity_logs
     WHERE organization_id = $1
       AND module_name = 'Integrations'
       AND record_label = ANY($2::text[])
     ORDER BY record_label, created_at DESC`,
    [orgId, labels]
  );

  const byLabel = {};
  result.rows.forEach((row) => {
    byLabel[row.record_label] = {
      actionType: row.action_type,
      userName: row.user_name,
      userRole: row.user_role,
      createdAt: row.created_at,
    };
  });
  return byLabel;
}

async function buildLogPayloadFromRequest(req, database = db) {
  const moduleName = inferModuleName(req);
  const recordType = inferRecordType(req, moduleName);
  const rawRecordReference = extractRecordReference(req, recordType);
  const rawChangedFields = summarizeChangedFields(req.body);
  const sessionUser = getSessionUser(req);
  const actionType = inferActionType(req);
  const organizationId = req.session?.organizationId;

  const [recordReference, changedFields] = await Promise.all([
    resolveRecordReferenceLabel(database, organizationId, req, rawRecordReference),
    resolveChangedFieldLabels(database, organizationId, rawChangedFields),
  ]);

  const payload = {
    organizationId,
    userId: sessionUser.userId,
    userName: sessionUser.userName,
    userRole: sessionUser.userRole,
    actionType,
    moduleName,
    pagePath: normalizePath(req.originalUrl || req.path),
    recordType,
    recordId: recordReference.recordId,
    recordLabel: recordReference.recordLabel,
    description: buildDescription(actionType, moduleName, recordReference, changedFields),
    changedFields,
    ipAddress: req.ip,
  };

  return enrichPayloadForRoute(database, req, payload);
}

function createOrganizationActivityLogMiddleware(database = db) {
  const debug = process.env.ACTIVITY_LOG_DEBUG === "1" || process.env.ACTIVITY_LOG_DEBUG === "true";
  return (req, res, next) => {
    const path = normalizePath(req.originalUrl || req.path);
    const method = String(req.method || "GET").toUpperCase();
    const tracked = shouldTrackRequest(req);

    if (debug && (method !== "GET" || isMeaningfulGet(path.toLowerCase()))) {
      const reasons = [];
      if (!req.session?.organizationId) reasons.push("no-org-session");
      if (!TRACKED_PREFIXES.some((prefix) => path.startsWith(prefix))) reasons.push("prefix-not-tracked");
      if (NOISE_PATH_PREFIXES.some((prefix) => path.startsWith(prefix))) reasons.push("noise-path");
      if (req.session?.accountType === "Admin" || req.session?.accountType === "Mini Admin") reasons.push("admin-account");
      if (path.startsWith("/hub") || path.startsWith("/admin")) reasons.push("admin-hub-path");
      console.log(`[ActivityLog] ${method} ${path} tracked=${tracked}${reasons.length ? ` skip=[${reasons.join(",")}]` : ""} orgId=${req.session?.organizationId || "-"} acct=${req.session?.accountType || "-"}`);
    }

    if (!tracked) {
      return next();
    }

    res.on("finish", () => {
      if (res.statusCode < 200 || res.statusCode >= 400) {
        if (debug) console.log(`[ActivityLog] skipped write status=${res.statusCode} ${method} ${path}`);
        return;
      }

      // Guard: session may have been destroyed (e.g. during logout) by the time this fires
      if (!req.session?.organizationId) {
        if (debug) console.log(`[ActivityLog] skipped write (session unavailable) ${method} ${path}`);
        return;
      }

      (async () => {
        const payload = await buildLogPayloadFromRequest(req, database);
        await logOrganizationActivity(payload, database);
        if (debug) console.log(`[ActivityLog] wrote ${payload.actionType} ${payload.moduleName} org=${payload.organizationId}`);
      })().catch((error) => {
        console.error("[ActivityLog] Failed to log request activity:", error.message || error);
      });
    });

    next();
  };
}

function parseDateFilter(value, endOfDay = false) {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) return null;

  const parsed = new Date(`${trimmed}T00:00:00`);
  if (Number.isNaN(parsed.getTime())) return null;
  if (endOfDay) parsed.setHours(23, 59, 59, 999);
  return parsed;
}

async function getActivityLogFilterOptions(database, organizationId) {
  const result = await database.query(
    `SELECT
       ARRAY_REMOVE(ARRAY_AGG(DISTINCT user_name ORDER BY user_name), NULL) AS users,
       ARRAY_REMOVE(ARRAY_AGG(DISTINCT user_role ORDER BY user_role), NULL) AS roles,
       ARRAY_REMOVE(ARRAY_AGG(DISTINCT action_type ORDER BY action_type), NULL) AS actions,
       ARRAY_REMOVE(ARRAY_AGG(DISTINCT module_name ORDER BY module_name), NULL) AS modules
     FROM organization_activity_logs
     WHERE organization_id = $1`,
    [organizationId]
  );

  return result.rows[0] || { users: [], roles: [], actions: [], modules: [] };
}

async function getOrganizationActivityLogs(database, options) {
  const organizationId = Number(options.organizationId);
  const page = Math.max(1, Number(options.page) || 1);
  const pageSize = Math.min(200, Math.max(10, Number(options.pageSize) || 20));
  const offset = (page - 1) * pageSize;
  const filters = options.filters || {};

  const conditions = ["organization_id = $1"];
  const params = [organizationId];

  const addParam = (value) => {
    params.push(value);
    return `$${params.length}`;
  };

  if (filters.user) conditions.push(`user_name = ${addParam(filters.user)}`);
  if (filters.role) conditions.push(`user_role = ${addParam(filters.role)}`);
  if (filters.action) conditions.push(`action_type = ${addParam(filters.action)}`);
  if (filters.module) conditions.push(`module_name = ${addParam(filters.module)}`);

  const startDate = parseDateFilter(filters.startDate, false);
  if (startDate) conditions.push(`created_at >= ${addParam(startDate)}`);

  const endDate = parseDateFilter(filters.endDate, true);
  if (endDate) conditions.push(`created_at <= ${addParam(endDate)}`);

  if (filters.search) {
    const like = `%${String(filters.search).trim()}%`;
    conditions.push(`(
      user_name ILIKE ${addParam(like)} OR
      COALESCE(user_role, '') ILIKE ${addParam(like)} OR
      action_type ILIKE ${addParam(like)} OR
      module_name ILIKE ${addParam(like)} OR
      COALESCE(record_label, '') ILIKE ${addParam(like)} OR
      COALESCE(description, '') ILIKE ${addParam(like)}
    )`);
  }

  const whereClause = conditions.join(" AND ");
  const countResult = await database.query(
    `SELECT COUNT(*)::int AS total
     FROM organization_activity_logs
     WHERE ${whereClause}`,
    params
  );

  const pageSizePlaceholder = addParam(pageSize);
  const offsetPlaceholder = addParam(offset);
  const logsResult = await database.query(
    `SELECT log_id, user_name, user_role, action_type, module_name, page_path, record_type, record_id, record_label, description, changed_fields, created_at
     FROM organization_activity_logs
     WHERE ${whereClause}
     ORDER BY created_at DESC, log_id DESC
     LIMIT ${pageSizePlaceholder}
     OFFSET ${offsetPlaceholder}`,
    params
  );

  const total = Number(countResult.rows[0]?.total || 0);

  return {
    rows: logsResult.rows,
    total,
    page,
    pageSize,
    totalPages: Math.max(1, Math.ceil(total / pageSize)),
  };
}

/**
 * Retention cleanup. Deletes activity log rows older than `retentionDays`.
 * Default is 3 years (1095 days). Called by jobs/scheduler.js weekly.
 */
async function purgeOldActivityLogs(database = db, retentionDays = 1095) {
  const days = Math.max(30, Number(retentionDays) || 1095);
  try {
    await ensureOrganizationActivityLogSchema(database);
    const result = await database.query(
      `DELETE FROM organization_activity_logs
       WHERE created_at < NOW() - ($1 || ' days')::interval`,
      [String(days)]
    );
    return { deleted: result.rowCount || 0, retentionDays: days };
  } catch (error) {
    console.error("[ActivityLog] Retention purge failed:", error.message || error);
    return { deleted: 0, retentionDays: days, error: error.message || String(error) };
  }
}

module.exports = {
  createOrganizationActivityLogMiddleware,
  ensureOrganizationActivityLogSchema,
  getActivityLogFilterOptions,
  getOrganizationActivityLogs,
  getLatestIntegrationActivity,
  logOrganizationActivity,
  purgeOldActivityLogs,
};