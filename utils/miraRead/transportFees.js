"use strict";

// Mira's reads of Transportation (driver reports, bus requests, the day's trips) and PayGira
// (a student's ledger, overdue balances, bills). Each follows the staff page it comes from:
//
// - get_driver_reports: the leads' Driver reports page (/transportation/manage/reports, Driver
//   Reports) sees every report; the class's Transportation tab (/transportation/reports/class/:id,
//   Class Bus Reports) sees only reports a lead shared with teachers, for the person's own classes
//   (utils/transportReports.js reportsForClass and the route's class check); a driver with
//   Reports (driver_report_builder) sees their own reports, as in Report Builder. A report stays
//   between the driver and the leads until a lead shares it.
// - get_bus_requests: the Rider List's Bus requests (/transportation/manage/requests,
//   utils/transportationRequests.js listRequests).
// - get_trips: Report Builder's Trips and Arrival checks, and boarding from utils/transportBoarding.js.
// - get_student_ledger, get_overdue_balances, list_bills: the PayGira pages themselves
//   (controllers/financeController.js studentDetailGet and financePageGet), called with a
//   session-shaped request, so every figure is the page's own.
//
// Transportation answers nothing while the school has it switched off (utils/integrationSwitches.js).
// The school is always the caller's own; nothing here changes data.
const { ReadError, holds, reqFor, cap, isDriver, roleOf, ROW_MAX } = require("./index");

const P = {
  transport: "manage_transportation",
  reports: "transport_reports",
  classReports: "transport_class_reports",
  riders: "transport_students",
  driverBuilder: "driver_report_builder",
  students: "manage_students",
  workspace: "paygira_workspace",
  bills: "paygira_bills",
  orgBills: "paygira_org_bills",
  subscriptions: "paygira_subscriptions",
  payments: "paygira_payments",
  recordPayments: "paygira_record_payments",
  recovery: "paygira_recovery",
};

// ── Shared helpers ─────────────────────────────────────────────────────────────────────────
const norm = (value) => String(value == null ? "" : value).toLowerCase().replace(/[^a-z0-9#\s-]/g, " ").replace(/\s+/g, " ").trim();
const nameOf = (row) => [row.first_name, row.last_name].filter(Boolean).join(" ").trim();
const round2 = (value) => Math.round(Number(value || 0) * 100) / 100;
const listOf = (items) => items.filter(Boolean).join(", ");
// A DATE column comes back as local midnight: its own calendar day, never shifted by UTC.
const dateText = (value) => {
  if (!value) return null;
  if (value instanceof Date) {
    if (Number.isNaN(value.getTime())) return null;
    return `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, "0")}-${String(value.getDate()).padStart(2, "0")}`;
  }
  return String(value).slice(0, 10);
};

function editDistance(a, b) {
  const x = String(a);
  const y = String(b);
  const row = Array.from({ length: y.length + 1 }, (_, i) => i);
  for (let i = 1; i <= x.length; i += 1) {
    let prev = row[0];
    row[0] = i;
    for (let j = 1; j <= y.length; j += 1) {
      const keep = row[j];
      row[j] = Math.min(row[j] + 1, row[j - 1] + 1, prev + (x[i - 1] === y[j - 1] ? 0 : 1));
      prev = keep;
    }
  }
  return row[y.length];
}
const closest = (wanted, names, n = 5) => [...new Set(names)]
  .map((name) => ({ name, d: editDistance(norm(wanted), norm(name)) }))
  .sort((a, b) => a.d - b.d || a.name.localeCompare(b.name))
  .slice(0, n)
  .map((item) => item.name);

// "Today" as a page without the browser's time zone sees it (utils/localDate.js).
function timeZone(actor) {
  return require("../localDate").timeZoneOf(reqFor(actor));
}
function dayKey(actor, value, label, fallback = "today") {
  const text = String(value == null || value === "" ? fallback : value).trim().toLowerCase();
  if (!text) return null;
  const { dateKeyIn } = require("../localDate");
  const zone = timeZone(actor);
  if (text === "today") return dateKeyIn(zone);
  if (text === "yesterday") return dateKeyIn(zone, new Date(Date.now() - 864e5));
  if (/^\d{4}-\d{2}-\d{2}$/.test(text) && !Number.isNaN(Date.parse(`${text}T12:00:00Z`))) return text;
  throw new ReadError("VALIDATION", `${label} must be a date like 2026-11-18 (or "today", "yesterday").`);
}

async function transportOn(db, actor) {
  const switches = require("../integrationSwitches");
  if (!(await switches.isOn(db, actor.organizationId, "transportation"))) {
    throw new ReadError("PLAN_FEATURE_OFF", switches.offMessage("transportation"));
  }
}

// A student of this school, by name (either order, or part of it) or by student ID.
async function findStudent(db, organizationId, words) {
  const text = String(words == null ? "" : words).trim();
  if (!text) throw new ReadError("VALIDATION", "Which student? Give their name or student ID.");
  const base = `SELECT s.student_id, s.first_name, s.last_name, s.custom_student_id, c.class_name, COALESCE(s.graduated, FALSE) AS graduated
                  FROM students s
                  LEFT JOIN classes c ON c.class_id = s.class_id AND c.organization_id = s.organization_id
                 WHERE s.organization_id = $1`;
  const label = (row) => `${nameOf(row)} (${row.class_name || (row.graduated ? "former student" : "no class")}, ID ${row.custom_student_id || row.student_id})`;
  const one = (rows, what) => {
    if (rows.length === 1) return rows[0];
    if (rows.length > 1) {
      throw new ReadError("AMBIGUOUS", `Several students match ${what}: ${rows.slice(0, 8).map(label).join("; ")}${rows.length > 8 ? `; and ${rows.length - 8} more` : ""}. Say which one (a student ID works).`);
    }
    return null;
  };
  // An ID is one word with a digit in it: the school's own student ID ("S1017-1") or Managira's number.
  const idText = text.replace(/^#/, "");
  if (/^\S+$/.test(idText) && /\d/.test(idText)) {
    const id = /^\d+$/.test(idText) ? Number(idText) : NaN;
    const numeric = Number.isSafeInteger(id) && id > 0 && id < 2147483647;
    const { rows } = await db.query(
      `${base} AND (LOWER(s.custom_student_id) = LOWER($2) ${numeric ? "OR s.student_id = $3" : ""}) ORDER BY s.student_id LIMIT 10`,
      numeric ? [organizationId, idText, id] : [organizationId, idText]
    );
    const found = one(rows, `ID ${idText}`);
    if (found) return found;
    if (/^\d+$/.test(idText) || /^[a-z]*[-_]?\d[\w-]*$/i.test(idText)) throw new ReadError("NOT_FOUND", `No student with ID ${idText} in this school.`);
  }
  const wanted = norm(text).replace(/,/g, " ");
  const { rows: exact } = await db.query(
    `${base} AND (LOWER(TRIM(CONCAT_WS(' ', s.first_name, s.last_name))) = $2 OR LOWER(TRIM(CONCAT_WS(' ', s.last_name, s.first_name))) = $2)
      ORDER BY COALESCE(s.graduated, FALSE), s.last_name, s.first_name LIMIT 50`,
    [organizationId, wanted]
  );
  const exactOne = one(exact, `"${text}"`);
  if (exactOne) return exactOne;
  const tokens = wanted.split(" ").filter((t) => t.length > 0).slice(0, 4);
  const params = [organizationId, ...tokens.map((t) => `%${t.replace(/[%_\\]/g, "\\$&")}%`)];
  const { rows: partial } = await db.query(
    `${base} AND ${tokens.map((_, i) => `CONCAT_WS(' ', s.first_name, s.last_name) ILIKE $${i + 2}`).join(" AND ")}
      ORDER BY COALESCE(s.graduated, FALSE), s.last_name, s.first_name LIMIT 50`,
    params
  );
  const partialOne = one(partial, `"${text}"`);
  if (partialOne) return partialOne;
  const starts = [...new Set(tokens.map((t) => t.slice(0, 2)))];
  const { rows: near } = await db.query(
    `${base} AND (LOWER(LEFT(s.first_name, 2)) = ANY($2::text[]) OR LOWER(LEFT(s.last_name, 2)) = ANY($2::text[])) LIMIT 400`,
    [organizationId, starts]
  );
  const suggestions = closest(text, near.map(nameOf));
  throw new ReadError("NOT_FOUND", `No student named "${text}" in this school.${suggestions.length ? ` Closest names: ${suggestions.join(", ")}.` : ""}`);
}

// Buses by number or name ("Bus 7", "7", "Blue bus"), routes by name or code.
async function findBuses(db, organizationId, words) {
  const { rows } = await db.query("SELECT bus_id, bus_number, bus_name FROM transport_buses WHERE organization_id = $1", [organizationId]);
  const q = norm(words);
  const bare = q.replace(/^bus\s*(no\s*|number\s*|#\s*)?/, "").replace(/^#/, "").trim();
  const names = (bus) => [bus.bus_number, bus.bus_name].filter(Boolean).map((n) => norm(n).replace(/^#/, ""));
  let hit = rows.filter((bus) => names(bus).some((n) => n === q || n === bare || n === `bus ${bare}` || n.replace(/^bus\s*/, "") === bare));
  if (!hit.length && bare) hit = rows.filter((bus) => names(bus).some((n) => n.includes(bare)));
  if (!hit.length) {
    const all = rows.map((bus) => (bus.bus_name ? `${bus.bus_name} (${bus.bus_number})` : bus.bus_number));
    throw new ReadError("NOT_FOUND", `No bus matches "${words}".${all.length ? ` Buses: ${closest(words, all, 12).join(", ")}.` : " This school has no buses yet."}`);
  }
  return hit;
}
async function findRoutes(db, organizationId, words) {
  const { rows } = await db.query("SELECT route_id, route_name, route_code FROM transport_routes WHERE organization_id = $1", [organizationId]);
  const q = norm(words);
  const bare = q.replace(/\s*route$/, "").replace(/^route\s*/, "").trim();
  const names = (route) => [route.route_name, route.route_code].filter(Boolean).map(norm);
  let hit = rows.filter((route) => names(route).some((n) => n === q || n === bare || n.replace(/\s*route$/, "") === bare));
  if (!hit.length && bare) hit = rows.filter((route) => names(route).some((n) => n.includes(bare)));
  if (!hit.length) {
    const all = rows.map((route) => route.route_name);
    throw new ReadError("NOT_FOUND", `No route matches "${words}".${all.length ? ` Routes: ${closest(words, all, 12).join(", ")}.` : " This school has no routes yet."}`);
  }
  return hit;
}

// Classes from people's words ("Grade 6", "6A, 7B"), the same matching as Forms & requests.
async function findClasses(db, organizationId, words) {
  const { matchClasses } = require("../formRequests");
  const { rows } = await db.query(
    "SELECT class_id, class_name FROM classes WHERE organization_id = $1 AND obsolete_at IS NULL ORDER BY class_name",
    [organizationId]
  );
  const classes = rows.map((row) => ({ id: Number(row.class_id), name: row.class_name }));
  const phrases = String(words || "").split(/\s*(?:,|;|\band\b|\+)\s*/i).map((p) => p.trim()).filter(Boolean);
  const picked = new Map();
  phrases.forEach((phrase) => {
    const hits = matchClasses(classes, phrase);
    if (!hits.length) {
      throw new ReadError("NOT_FOUND", `No class matches "${phrase}". Classes: ${closest(phrase, classes.map((c) => c.name), 15).join(", ")}.`);
    }
    hits.forEach((c) => picked.set(c.id, c));
  });
  return [...picked.values()];
}

// ── PayGira: the page's own handlers, called as the person ─────────────────────────────────
// A request shaped like the person's own visit (their session, the school's display settings)
// and a response that hands back what the page would have shown.
async function callPage(handler, actor, { query = {}, params = {}, path = "/", pages = {} } = {}) {
  const req = { ...reqFor(actor, { ...query }), params, path, originalUrl: path, method: "GET" };
  await require("../sessionContext").hydrateOrganizationSession(req).catch(() => null);
  const prefs = require("../organizationDisplayPreferences");
  const display = prefs.getSessionDisplayPreferences(req.session || {});
  return new Promise((resolve, reject) => {
    const done = (value) => resolve(value);
    const res = {
      statusCode: 200,
      locals: {
        isEmbeddedFrame: true, // the section itself, never the PayGira menu page
        publicImageUrl: () => null,
        formatDisplayDate: (value) => prefs.formatDisplayDate(value, display.dateDisplayFormat),
        formatDisplayName: (person = {}) => prefs.formatDisplayName(person, display.nameDisplayFormat),
        workspaceAccess: () => ({ paygira: pages }),
      },
      set() { return res; },
      setHeader() { return res; },
      status(code) { res.statusCode = code; return res; },
      json(body) { done({ kind: "json", status: res.statusCode, body }); return res; },
      render(view, data) { done({ kind: "render", view, data: data || {} }); },
      redirect(a, b) { done({ kind: "redirect", url: typeof a === "string" ? a : b }); },
      send(body) { done({ kind: "send", status: res.statusCode, body }); return res; },
      end() { done({ kind: "end", status: res.statusCode }); return res; },
    };
    Promise.resolve(handler(req, res)).catch(reject);
  });
}

// Main PayGira plus one of these follow-ups (routes/financeRoute.js paygiraPage). A school whose
// plan leaves PayGira out gets PLAN_FEATURE_OFF, as the pages refuse it for everyone.
async function needPaygira(db, actor, followUps, label) {
  const { planAllowsPermission } = require("../../middleware/permissionMiddleware");
  if (!(await planAllowsPermission(db, actor.organizationId, P.workspace).catch(() => true))) {
    throw new ReadError("PLAN_FEATURE_OFF", "PayGira isn't in this school's plan.");
  }
  const held = new Set();
  if (await holds(db, actor, P.workspace)) {
    for (const key of followUps) if (await holds(db, actor, key)) held.add(key);
  }
  if (!held.size) throw new ReadError("PERMISSION_DENIED", `You need the Main PayGira permission with ${label} for this.`);
  return held;
}

// The school's money as PayGira shows it: its own currency, else its country's, else the one the
// pages detect, else US dollars (financeController buildFinanceDisplayContext).
async function moneyFor(db, actor) {
  const currency = require("../currencyLocalization");
  const { rows } = await db.query(
    "SELECT organization_country, to_jsonb(o) ->> 'organization_currency' AS organization_currency FROM organizations o WHERE organization_id = $1",
    [actor.organizationId]
  );
  const row = rows[0] || {};
  let code = currency.normalizeCurrencyCode(row.organization_currency)
    || currency.normalizeCurrencyCode(currency.getCurrencyForCountry(String(row.organization_country || "").trim().toUpperCase()));
  if (!code) {
    const profile = await Promise.race([
      currency.getCurrencyProfileForRequest(reqFor(actor), { organizationId: actor.organizationId }).catch(() => null),
      new Promise((resolve) => setTimeout(() => resolve(null), 250)),
    ]);
    code = currency.normalizeCurrencyCode(profile && profile.userCurrency) || "USD";
  }
  const locale = currency.getLocaleForCurrency(code);
  return { code, format: (value) => currency.formatCurrencyAmount(value, code, locale) };
}

// The academic period: the page's default (the current term), the current school year, or every
// bill. `current` is the school year the PayGira pages take as current (getCurrentAcademicContext:
// the one marked current, else the first in the same order).
async function periodOf(db, actor, period) {
  const which = String(period || "current_term").trim().toLowerCase().replace(/\s+/g, "_");
  if (["current_term", "term", "this_term", ""].includes(which)) return { kind: "term", label: "current term" };
  if (["school_year", "year", "this_year", "current_year"].includes(which)) {
    const { rows } = await db.query(
      `SELECT id, current FROM school_years WHERE organization_id = $1
        ORDER BY current DESC NULLS LAST, year_label DESC, id DESC`,
      [actor.organizationId]
    );
    const current = rows.find((row) => row.current) || rows[0];
    if (!current) throw new ReadError("NOT_FOUND", "This school has no school year yet.");
    return { kind: "year", label: "current school year", yearId: String(current.id) };
  }
  if (["all", "all_time", "everything", "any", "every_year"].includes(which)) return { kind: "all", label: "every school year" };
  throw new ReadError("VALIDATION", "period must be current_term, school_year or all.");
}

async function periodNames(db, organizationId, yearIds, termIds) {
  const [years, terms] = await Promise.all([
    yearIds.length ? db.query("SELECT id, year_label FROM school_years WHERE organization_id = $1 AND id = ANY($2::int[])", [organizationId, yearIds]) : { rows: [] },
    termIds.length ? db.query("SELECT term_id, term_name FROM terms WHERE organization_id = $1 AND term_id = ANY($2::int[])", [organizationId, termIds]) : { rows: [] },
  ]);
  return {
    schoolYears: years.rows.map((row) => row.year_label),
    terms: terms.rows.map((row) => row.term_name),
  };
}

const LEDGER_STATUS = { paid: "Paid", partial: "Part paid", pending: "Owes", overdue: "Overdue", draft: "Draft", cancelled: "Cancelled" };
const LEDGER_METHOD = { cash: "Cash", cheque: "Check", bank_transfer: "Bank transfer", transfer: "Bank transfer", card: "Card", stripe: "Card", momo: "Mobile money", mobile_money: "Mobile money", credit: "Credit", other: "Other" };
const OWED_STATUS = { overdue: "Overdue", partial: "Part paid", defaulted: "30+ days late", never_paid: "Nothing paid" };
const BILL_STATUS = { active: "Sent", draft: "Draft", cancelled: "Cancelled", paid: "Paid" };
const REPEATS = { daily: "every day", weekly: "every week", monthly: "every month", term: "every term", year: "every year" };
const BILL_KIND = (bill) => (bill.bill_type === "recurring" ? `Repeats ${REPEATS[bill.recurrence] || ""}`.trim() : bill.bill_type === "installment" ? "In installments" : "One-time");

// Who rides a bus, for other reads to combine with (find_students): Map(student_id -> { bus, route,
// stop }) for students with an active bus assignment, optionally only those whose class is one of
// classIds. Who may see a student's bus is the Transportation routes' own rule (staffSeesStudent):
// a teacher for students of their own classes; anyone else with Manage Students or a
// Transportation students permission. Refused (ReadError) while Transportation is switched off.
async function ridersIn(db, actor, classIds = null) {
  await transportOn(db, actor);
  const org = actor.organizationId;
  const wanted = [...(classIds || [])].map(Number).filter((id) => Number.isInteger(id) && id > 0);
  let mine = null;
  if (roleOf(actor) === "teacher") {
    mine = await require("../classScope").assignedClasses(db, reqFor(actor));
    if (!mine || !mine.size) return new Map();
  } else {
    let allowed = false;
    for (const key of [P.students, P.riders, "transport_student_routes"]) {
      if (await holds(db, actor, key)) { allowed = true; break; }
    }
    if (!allowed) throw new ReadError("PERMISSION_DENIED", "You need Manage Students or a Transportation students permission to see who rides the bus.");
  }
  const { rows } = await db.query(
    `SELECT a.student_id, b.bus_number, b.bus_name, r.route_name, st.stop_name
       FROM transport_student_assignments a
       JOIN students s ON s.student_id = a.student_id AND s.organization_id = a.organization_id
       LEFT JOIN transport_buses b ON b.bus_id = a.bus_id AND b.organization_id = a.organization_id
       LEFT JOIN transport_routes r ON r.route_id = a.route_id AND r.organization_id = a.organization_id
       LEFT JOIN transport_stops st ON st.stop_id = a.stop_id AND st.organization_id = a.organization_id
      WHERE a.organization_id = $1 AND a.active = TRUE
        AND ($2::int[] IS NULL OR s.class_id = ANY($2::int[]))`,
    [org, wanted.length ? wanted : null]
  );
  const seen = mine
    ? await require("../classScope").studentsInClasses(db, org, rows.map((row) => row.student_id), mine)
    : null;
  const out = new Map();
  rows.forEach((row) => {
    const id = Number(row.student_id);
    if (seen && !seen.has(id)) return;
    out.set(id, {
      bus: row.bus_name ? `${row.bus_name} (${row.bus_number})` : (row.bus_number || null),
      route: row.route_name || null,
      stop: row.stop_name || null,
    });
  });
  return out;
}

module.exports = {
  // ── Driver reports ──────────────────────────────────────────────────────────────────────
  // GET /internal/api/read/get_driver_reports?from=&to=&bus=&route=&student=&shared=&status=
  get_driver_reports: {
    async run(db, actor, q) {
      await transportOn(db, actor);
      const transportReports = require("../transportReports");
      const org = actor.organizationId;
      let view = null;
      if (await holds(db, actor, P.reports)) view = "lead";
      else if (await holds(db, actor, P.classReports)) view = "class";
      else if (isDriver(actor) && await holds(db, actor, P.driverBuilder)) view = "own";
      if (!view) {
        throw new ReadError("PERMISSION_DENIED", isDriver(actor)
          ? "Your reports go to your lead. You need the driver Reports permission to look back at the ones you sent."
          : "You need the Driver Reports permission (or Class Bus Reports, for reports shared with your classes) for this.");
      }

      const where = ["r.organization_id = $1"];
      const params = [org];
      const add = (sql, value) => { params.push(value); where.push(sql.replace(/\?/g, `$${params.length}`)); };
      const scope = { view: { lead: "every driver report (Driver Reports)", class: "reports a lead shared with teachers, for your classes", own: "the reports you sent" }[view] };

      let classNames = null;
      if (view === "class") {
        // The class's Transportation tab: a teacher only for their own classes; others for any
        // class with Manage Students (or as a manager), else their own (reportsForClassGet).
        const role = roleOf(actor);
        const every = role !== "teacher" && (role === "manager" || await holds(db, actor, P.students));
        where.push("r.share_with_teachers = TRUE", "r.student_id IS NOT NULL");
        if (every) {
          where.push("s.class_id IS NOT NULL");
          scope.classes = "every class";
        } else {
          const { rows } = await db.query(
            `SELECT DISTINCT c.class_id, c.class_name FROM user_classes uc
               JOIN classes c ON c.class_id = uc.class_id AND c.organization_id = $2
              WHERE uc.user_id = $1 ORDER BY c.class_name`,
            [actor.userId || 0, org]
          );
          classNames = rows.map((row) => row.class_name);
          add("s.class_id = ANY(?::int[])", rows.map((row) => Number(row.class_id)));
          scope.classes = classNames;
        }
      }
      if (view === "own") add("r.driver_user_id = ?", actor.userId || 0);

      const zone = timeZone(actor);
      const from = q.from ? dayKey(actor, q.from, "from") : null;
      const to = q.to ? dayKey(actor, q.to, "to") : null;
      if (from) { params.push(zone); add(`(r.created_at AT TIME ZONE $${params.length})::date >= ?::date`, from); }
      if (to) { params.push(zone); add(`(r.created_at AT TIME ZONE $${params.length})::date <= ?::date`, to); }
      if (from || to) scope.dates = { from: from || "the first report", to: to || "today" };
      if (q.bus) {
        const buses = await findBuses(db, org, q.bus);
        add("r.bus_id = ANY(?::int[])", buses.map((b) => Number(b.bus_id)));
        scope.bus = listOf(buses.map((b) => b.bus_number));
      }
      if (q.route) {
        const routes = await findRoutes(db, org, q.route);
        add("r.route_id = ANY(?::int[])", routes.map((r) => Number(r.route_id)));
        scope.route = listOf(routes.map((r) => r.route_name));
      }
      if (q.student) {
        const student = await findStudent(db, org, q.student);
        add("r.student_id = ?", Number(student.student_id));
        scope.student = nameOf(student);
      }
      const shared = String(q.shared || "any").trim().toLowerCase();
      if (!["any", "all", "", "parents", "teachers", "either", "none"].includes(shared)) throw new ReadError("VALIDATION", "shared must be parents, teachers, either, none or any.");
      if (view !== "lead" && !["any", "all", "", "teachers"].includes(shared)) {
        throw new ReadError("PERMISSION_DENIED", "Only people with the Driver Reports permission see who else a report was shared with.");
      }
      if (view === "lead") {
        if (shared === "parents") where.push("r.share_with_parents");
        if (shared === "teachers") where.push("r.share_with_teachers");
        if (shared === "either") where.push("(r.share_with_parents OR r.share_with_teachers)");
        if (shared === "none") where.push("NOT r.share_with_parents AND NOT r.share_with_teachers");
        if (!["any", "all", ""].includes(shared)) scope.shared = shared;
      }
      const status = String(q.status || "all").trim().toLowerCase();
      if (!["all", "", "new", "reviewed", "old"].includes(status)) throw new ReadError("VALIDATION", "status must be new, reviewed or all.");
      if (view !== "class" && ["new", "reviewed", "old"].includes(status)) {
        add("r.status = ?", status === "new" ? "new" : "reviewed");
        scope.status = status === "new" ? "new (not yet reviewed)" : "reviewed";
      }

      const from_ = `FROM transport_driver_reports r
        LEFT JOIN students s ON s.student_id = r.student_id AND s.organization_id = r.organization_id
        LEFT JOIN classes c ON c.class_id = s.class_id AND c.organization_id = r.organization_id
        LEFT JOIN transport_buses b ON b.bus_id = r.bus_id AND b.organization_id = r.organization_id
        LEFT JOIN transport_routes tr ON tr.route_id = r.route_id AND tr.organization_id = r.organization_id
        WHERE ${where.join(" AND ")}`;
      const [list, sums, byCategory] = await Promise.all([
        db.query(
          `SELECT r.report_id, r.category, r.issue, r.priority, r.details, r.status, r.driver_name, r.created_at,
                  r.share_with_parents, r.share_with_teachers, r.review_note, r.reviewed_by_name, r.reviewed_at,
                  s.first_name, s.last_name, c.class_name, b.bus_number, tr.route_name
             ${from_}
            ORDER BY r.created_at DESC, r.report_id DESC
            LIMIT ${ROW_MAX + 1}`,
          params
        ),
        db.query(
          `SELECT COUNT(*)::int AS total,
                  COUNT(*) FILTER (WHERE r.status = 'new')::int AS new,
                  COUNT(*) FILTER (WHERE r.status = 'new' AND r.priority = 'urgent')::int AS urgent_new,
                  COUNT(*) FILTER (WHERE r.share_with_parents)::int AS shared_parents,
                  COUNT(*) FILTER (WHERE r.share_with_teachers)::int AS shared_teachers,
                  COUNT(DISTINCT r.student_id)::int AS students
             ${from_}`,
          params
        ),
        db.query(`SELECT r.category, COUNT(*)::int AS n ${from_} GROUP BY r.category ORDER BY 2 DESC`, params),
      ]);
      const { rows, truncated } = cap(list.rows);
      const label = (row) => transportReports.CATEGORIES[row.category] || "Other";
      const data = rows.map((row) => {
        const base = {
          id: Number(row.report_id),
          reportedAt: row.created_at,
          type: label(row),
          issue: row.issue || null,
          student: nameOf(row) || null,
          bus: row.bus_number || null,
          route: row.route_name || null,
        };
        // A teacher sees what happened and the school's note, never who else was told (sharedReport).
        if (view === "class") return base;
        return {
          ...base,
          class: row.class_name || null,
          driver: row.driver_name || null,
          priority: row.priority,
          status: row.status === "new" ? "New" : "Reviewed",
          ...(view === "lead" ? {
            sharedWithParents: Boolean(row.share_with_parents),
            sharedWithTeachers: Boolean(row.share_with_teachers),
            reviewedBy: row.reviewed_by_name || null,
            reviewedAt: row.reviewed_at || null,
          } : {}),
        };
      });
      const untrusted = rows
        .map((row) => ({
          report: Number(row.report_id),
          details: row.details || null,
          ...(view !== "own" && row.review_note ? { [view === "lead" ? "leadNote" : "schoolNote"]: row.review_note } : {}),
        }))
        .filter((item) => item.details || item.leadNote || item.schoolNote);
      const sum = sums.rows[0];
      const totals = {
        reports: sum.total,
        students: sum.students,
        byType: Object.fromEntries(byCategory.rows.map((row) => [transportReports.CATEGORIES[row.category] || "Other", row.n])),
        ...(view !== "class" ? { new: sum.new, urgentNew: sum.urgent_new, reviewed: sum.total - sum.new } : {}),
        ...(view === "lead" ? { sharedWithParents: sum.shared_parents, sharedWithTeachers: sum.shared_teachers } : {}),
      };
      return { data, totals, scope, truncated, untrusted };
    },
  },

  // ── Bus requests ────────────────────────────────────────────────────────────────────────
  // GET /internal/api/read/get_bus_requests?status=pending|all
  get_bus_requests: {
    async run(db, actor, q) {
      await transportOn(db, actor);
      if (!(await holds(db, actor, P.riders))) throw new ReadError("PERMISSION_DENIED", "You need the Rider List permission (Transportation) to see bus requests.");
      const busRequests = require("../transportationRequests");
      const org = actor.organizationId;
      const status = String(q.status || "pending").trim().toLowerCase();
      if (!["pending", "new", "open", "all"].includes(status)) throw new ReadError("VALIDATION", "status must be pending or all.");
      const all = status === "all";
      const [open, closed, counts] = await Promise.all([
        busRequests.listRequests(db, org, { bucket: "new" }),
        all ? busRequests.listRequests(db, org, { bucket: "old" }) : [],
        db.query("SELECT status, COUNT(*)::int AS n FROM transport_student_requests WHERE organization_id = $1 GROUP BY status", [org]),
      ]);
      const by = Object.fromEntries(counts.rows.map((row) => [row.status, row.n]));
      const totals = {
        pending: by.pending || 0,
        approved: by.approved || 0,
        declined: by.declined || 0,
        cancelled: by.cancelled || 0,
      };
      totals.all = totals.pending + totals.approved + totals.declined + totals.cancelled;
      const list = [...open, ...closed];
      const { rows, truncated: overCap } = cap(list);
      const shownOf = all ? totals.all : totals.pending;
      const data = rows.map((r) => ({
        id: r.id,
        student: r.studentName,
        class: r.className,
        status: r.status,
        askedBy: r.requesterType === "guardian" ? `Parent${r.requesterName ? ` (${r.requesterName})` : ""}` : `Staff${r.requesterName ? ` (${r.requesterName})` : ""}`,
        route: r.routeName,
        stop: r.stopName,
        distanceKm: r.distanceKm === null ? null : round2(r.distanceKm),
        askedAt: r.createdAt,
        decidedBy: r.decidedBy,
        decidedAt: r.decidedAt,
      }));
      const untrusted = rows
        .map((r) => ({ request: r.id, address: r.address || null, ...(r.decisionNote ? { decisionNote: r.decisionNote } : {}) }))
        .filter((item) => item.address || item.decisionNote);
      return {
        data,
        totals,
        scope: { status: all ? "every request (newest first, as the Bus requests page lists them)" : "pending (waiting for a decision)", page: "Transportation > Rider List > Bus requests" },
        truncated: overCap || rows.length < shownOf,
        untrusted,
      };
    },
  },

  // ── Trips ───────────────────────────────────────────────────────────────────────────────
  // GET /internal/api/read/get_trips?date=&bus=&route=
  get_trips: {
    async run(db, actor, q) {
      await transportOn(db, actor);
      const org = actor.organizationId;
      const full = await holds(db, actor, P.transport);
      const own = !full && isDriver(actor) && await holds(db, actor, P.driverBuilder);
      if (!full && !own) {
        throw new ReadError("PERMISSION_DENIED", isDriver(actor)
          ? "Your trip today is on your driver page. Looking back at trips needs the driver Reports permission."
          : "You need the Transportation permission to see trips. For who isn't riding your class's bus today, ask about riding today.");
      }
      // Who didn't arrive and why: Driver Reports, or the driver's own trips (Report Builder's Arrival checks).
      const arrivalDetails = own || await holds(db, actor, P.reports);
      const zone = timeZone(actor);
      const day = dayKey(actor, q.date, "date");
      const where = ["t.organization_id = $1", "(t.started_at AT TIME ZONE $2)::date = $3::date"];
      const params = [org, zone, day];
      const add = (sql, value) => { params.push(value); where.push(sql.replace("?", `$${params.length}`)); };
      const scope = { date: day, view: own ? "your own trips" : "every trip" };
      if (own) add("t.driver_user_id = ?", actor.userId || 0);
      if (q.bus) {
        const buses = await findBuses(db, org, q.bus);
        add("t.bus_id = ANY(?::int[])", buses.map((b) => Number(b.bus_id)));
        scope.bus = listOf(buses.map((b) => b.bus_number));
      }
      if (q.route) {
        const routes = await findRoutes(db, org, q.route);
        add("t.route_id = ANY(?::int[])", routes.map((r) => Number(r.route_id)));
        scope.route = listOf(routes.map((r) => r.route_name));
      }
      const { rows: trips } = await db.query(
        `SELECT t.trip_id, t.status, t.started_at, t.ended_at, t.bus_id, t.route_id, t.driver_user_id,
                r.route_name, b.bus_number, b.bus_name,
                COALESCE(NULLIF(TRIM(d.driver_name), ''), NULLIF(TRIM(CONCAT_WS(' ', u.first_name, u.last_name)), '')) AS driver_name,
                ROUND(EXTRACT(EPOCH FROM (t.ended_at - t.started_at)) / 60)::int AS minutes,
                arr.arrived, arr.missed, arr.parent_confirmed, arr.parent_pending, arr.parent_not_arrived
           FROM transport_trip_sessions t
           LEFT JOIN transport_routes r ON r.route_id = t.route_id AND r.organization_id = t.organization_id
           LEFT JOIN transport_buses b ON b.bus_id = t.bus_id AND b.organization_id = t.organization_id
           LEFT JOIN users u ON u.user_id = t.driver_user_id
           LEFT JOIN transport_drivers d ON d.user_id = t.driver_user_id AND d.organization_id = t.organization_id
           LEFT JOIN LATERAL (
             SELECT COUNT(*) FILTER (WHERE ar.arrived)::int AS arrived,
                    COUNT(*) FILTER (WHERE NOT ar.arrived)::int AS missed,
                    COUNT(*) FILTER (WHERE ar.parent_status = 'confirmed')::int AS parent_confirmed,
                    COUNT(*) FILTER (WHERE ar.parent_status = 'pending')::int AS parent_pending,
                    COUNT(*) FILTER (WHERE ar.parent_status = 'not_arrived')::int AS parent_not_arrived
               FROM transport_trip_arrivals ar
              WHERE ar.trip_id = t.trip_id AND ar.organization_id = t.organization_id
           ) arr ON TRUE
          WHERE ${where.join(" AND ")}
          ORDER BY t.started_at, t.trip_id`,
        params
      );
      const ids = trips.map((t) => Number(t.trip_id));
      const features = require("../shards/features");
      const boardingOn = features.isOn("bus_boarding", { organizationId: org });
      const transportBoarding = require("../transportBoarding");
      // A driver's page shows the boarding of their trip under way; anyone with Transportation sees every trip's.
      const boardingTrips = boardingOn ? trips.filter((t) => full || t.status === "active") : [];
      const [riders, notRiding, boardings, missing] = await Promise.all([
        ids.length ? db.query("SELECT student_id, bus_id, route_id FROM transport_student_assignments WHERE organization_id = $1 AND active = TRUE", [org]).then((r) => r.rows) : [],
        boardingOn && ids.length ? transportBoarding.schoolDay(db, org, day).then((reading) => new Set(reading.notRiding.map((row) => row.studentId))) : new Set(),
        Promise.all(boardingTrips.map((t) => transportBoarding.tripBoardings(db, org, t.trip_id).then((list) => [Number(t.trip_id), list]))).then((pairs) => new Map(pairs)),
        arrivalDetails && ids.length
          ? db.query(
              `SELECT ar.arrival_id, ar.trip_id, ar.arrived, ar.reason, ar.note, ar.parent_status, s.first_name, s.last_name
                 FROM transport_trip_arrivals ar
                 JOIN students s ON s.student_id = ar.student_id AND s.organization_id = ar.organization_id
                WHERE ar.organization_id = $1 AND ar.trip_id = ANY($2::int[]) AND (NOT ar.arrived OR ar.parent_status = 'not_arrived')
                ORDER BY s.last_name, s.first_name`,
              [org, ids]
            ).then((r) => r.rows)
          : [],
      ]);
      const notBoardedIds = [...new Set([].concat(...[...boardings.values()].map((list) => list.filter((b) => !b.boarded).map((b) => b.studentId))))];
      const stopIds = [...new Set([].concat(...[...boardings.values()].map((list) => list.filter((b) => !b.boarded && b.stopId).map((b) => b.stopId))))];
      const [names, stops] = await Promise.all([
        notBoardedIds.length ? db.query("SELECT student_id, first_name, last_name FROM students WHERE organization_id = $1 AND student_id = ANY($2::int[])", [org, notBoardedIds]).then((r) => new Map(r.rows.map((row) => [Number(row.student_id), nameOf(row)]))) : new Map(),
        stopIds.length ? db.query("SELECT stop_id, stop_name FROM transport_stops WHERE organization_id = $1 AND stop_id = ANY($2::int[])", [org, stopIds]).then((r) => new Map(r.rows.map((row) => [Number(row.stop_id), row.stop_name]))) : new Map(),
      ]);
      const { ARRIVAL_REASONS } = require("../transportReports");
      const untrusted = [];
      const data = trips.map((t) => {
        const id = Number(t.trip_id);
        // A trip's riders: active riders of its bus or its route, as boarding counts them.
        const ridersOf = riders.filter((r) => (t.bus_id && Number(r.bus_id) === Number(t.bus_id)) || (t.route_id && Number(r.route_id) === Number(t.route_id)));
        const riderIds = new Set(ridersOf.map((r) => Number(r.student_id)));
        const trip = {
          id,
          status: t.status === "active" ? "Under way" : t.status === "completed" ? "Ended" : String(t.status || ""),
          started: t.started_at,
          ended: t.ended_at || null,
          minutes: t.minutes === null ? null : Number(t.minutes),
          bus: t.bus_name ? `${t.bus_name} (${t.bus_number})` : (t.bus_number || null),
          route: t.route_name || null,
          driver: t.driver_name || null,
          riders: riderIds.size,
          ...(boardingOn ? { notComingToday: [...riderIds].filter((sid) => notRiding.has(sid)).length } : {}),
          arrivalCheck: { arrived: t.arrived || 0, didNotArrive: t.missed || 0, parentConfirmed: t.parent_confirmed || 0, parentWaiting: t.parent_pending || 0, parentSaysNotArrived: t.parent_not_arrived || 0 },
        };
        if (boardings.has(id)) {
          const list = boardings.get(id);
          trip.boarding = {
            boarded: list.filter((b) => b.boarded).length,
            didNotBoard: list.filter((b) => !b.boarded).map((b) => ({ student: names.get(b.studentId) || "A student", stop: (b.stopId && stops.get(b.stopId)) || null })),
          };
        }
        if (arrivalDetails) {
          const mine = missing.filter((m) => Number(m.trip_id) === id);
          trip.arrivalCheck.didNotArriveStudents = mine.filter((m) => !m.arrived).map((m) => ({ student: nameOf(m), reason: ARRIVAL_REASONS[m.reason] || "Other", parent: m.parent_status || null }));
          trip.arrivalCheck.parentSaysNotArrivedStudents = mine.filter((m) => m.arrived && m.parent_status === "not_arrived").map((m) => nameOf(m));
          mine.filter((m) => m.note).forEach((m) => untrusted.push({ trip: id, student: nameOf(m), note: m.note }));
        }
        return trip;
      });
      const sumOf = (fn) => data.reduce((total, trip) => total + fn(trip), 0);
      const totals = {
        trips: data.length,
        underWay: data.filter((t) => t.status === "Under way").length,
        ended: data.filter((t) => t.status === "Ended").length,
        arrived: sumOf((t) => t.arrivalCheck.arrived),
        didNotArrive: sumOf((t) => t.arrivalCheck.didNotArrive),
        ...(boardingTrips.length ? { boarded: sumOf((t) => (t.boarding ? t.boarding.boarded : 0)), didNotBoard: sumOf((t) => (t.boarding ? t.boarding.didNotBoard.length : 0)) } : {}),
      };
      if (!boardingOn) scope.boarding = "Bus boarding isn't on for this school.";
      else if (own) scope.boarding = "Shown for your trip under way, as on your driver page.";
      if (!arrivalDetails) scope.arrivalDetails = "Who didn't arrive, and why, needs the Driver Reports permission.";
      return { data, totals, scope, truncated: false, untrusted };
    },
  },

  // ── A student's PayGira ledger ──────────────────────────────────────────────────────────
  // GET /internal/api/read/get_student_ledger?student=
  get_student_ledger: {
    async run(db, actor, q) {
      await needPaygira(db, actor, [P.bills, P.orgBills, P.payments, P.recordPayments, P.recovery], "Bills, Student ledger, Payments or Overdue");
      const student = await findStudent(db, actor.organizationId, q.student);
      const finance = require("../../controllers/financeController");
      const page = await callPage(finance.studentDetailGet, actor, { params: { id: String(student.student_id) } });
      if (page.kind !== "json" || page.status !== 200 || !page.body || !page.body.student) {
        if (page.status === 404) throw new ReadError("NOT_FOUND", `${nameOf(student)} isn't in this school's PayGira.`);
        if (page.status === 403) throw new ReadError("PERMISSION_DENIED", "You need the Main PayGira permission for this.");
        throw new Error(`student ledger answered ${page.kind} ${page.status || ""}`);
      }
      const d = page.body;
      const money = await moneyFor(db, actor);
      const bills = d.bills || [];
      const payments = d.payments || [];
      // The ledger's own totals (views/account/finance.ejs buildDrawerHtml).
      const credit = Number(d.credit || 0);
      const billed = bills.reduce((a, b) => a + Number(b.amount || 0), 0);
      const paid = bills.reduce((a, b) => a + Number(b.amount_paid || 0), 0);
      const owed = bills.reduce((a, b) => a + Number(b.balance != null ? b.balance : Math.max(Number(b.amount || 0) + Number(b.late_fee_applied || 0) - Number(b.amount_paid || 0), 0)), 0);
      const stillOwed = Math.max(owed - credit, 0);
      const { rows: count } = await db.query("SELECT COUNT(*)::int AS n FROM finance_payments WHERE organization_id = $1 AND student_id = $2", [actor.organizationId, student.student_id]);
      const shownBills = cap(bills);
      const shownPayments = cap(payments);
      return {
        data: {
          student: { name: nameOf(d.student), class: d.student.class_name || "No class", former: Boolean(student.graduated) },
          bills: shownBills.rows.map((b) => {
            const balance = Number(b.balance != null ? b.balance : Math.max(Number(b.amount || 0) + Number(b.late_fee_applied || 0) - Number(b.amount_paid || 0), 0));
            return {
              bill: b.title,
              kind: BILL_KIND(b),
              due: b.due_display || null,
              billed: round2(b.amount), billedText: money.format(b.amount),
              paid: round2(b.amount_paid), paidText: money.format(b.amount_paid),
              balance: round2(balance), balanceText: money.format(balance),
              status: LEDGER_STATUS[String(b.status || "").toLowerCase()] || b.status || null,
            };
          }),
          payments: shownPayments.rows.map((p) => ({
            date: p.received_display || null,
            bill: p.bill_title || null,
            paidBy: LEDGER_METHOD[String(p.method || "").toLowerCase()] || p.method || null,
            amount: round2(p.amount), amountText: money.format(p.amount),
          })),
        },
        totals: {
          billed: round2(billed), billedText: money.format(billed),
          paid: round2(paid), paidText: money.format(paid),
          stillOwed: round2(stillOwed), stillOwedText: money.format(stillOwed),
          creditHeld: round2(credit), creditHeldText: money.format(credit),
          bills: bills.length,
          payments: count[0].n,
        },
        scope: {
          page: "PayGira > Student ledger, the student's ledger",
          currency: money.code,
          note: `Every bill this student has, with the ledger's own totals (still owed is after credit).${count[0].n > payments.length ? ` The ledger lists the latest ${payments.length} of ${count[0].n} payments.` : ""}`,
        },
        truncated: shownBills.truncated || shownPayments.truncated || count[0].n > payments.length,
        untrusted: payments.filter((p) => p.reference).map((p) => ({ payment: p.received_display || null, amount: money.format(p.amount), reference: p.reference })),
      };
    },
  },

  // ── Overdue balances ────────────────────────────────────────────────────────────────────
  // GET /internal/api/read/get_overdue_balances?classes=&min_amount=&period=
  get_overdue_balances: {
    async run(db, actor, q) {
      await needPaygira(db, actor, [P.recovery], "Overdue (fee recovery)");
      const org = actor.organizationId;
      const query = { section: "arrears" };
      const scope = { page: "PayGira > Student ledger > Overdue" };
      if (q.classes) {
        const classes = await findClasses(db, org, q.classes);
        query.classIds = classes.map((c) => c.id).join(",");
        scope.classes = classes.map((c) => c.name);
      } else scope.classes = "every class";
      if (q.min_amount !== undefined && q.min_amount !== null && q.min_amount !== "") {
        const min = Number(String(q.min_amount).replace(/[^0-9.]/g, ""));
        if (!Number.isFinite(min) || min < 0) throw new ReadError("VALIDATION", "min_amount must be an amount, like 50.");
        query.minOutstanding = String(min);
      }
      // The page's own filter: school years named (then every term of them); none named = the
      // current term. "," names none but counts as given, so nothing is filtered by year or term.
      const period = await periodOf(db, actor, q.period);
      if (period.kind === "year") query.schoolYearIds = period.yearId;
      if (period.kind === "all") query.schoolYearIds = ",";
      const finance = require("../../controllers/financeController");
      const page = await callPage(finance.financeArrearsPageGet, actor, { query, path: "/finance/arrears", pages: { arrears: true } });
      if (page.kind !== "render" || !page.data.arrearsData) {
        if (page.kind === "redirect") throw new ReadError("PERMISSION_DENIED", "You need the Main PayGira permission with Overdue for this.");
        throw new Error(`overdue page answered ${page.kind}`);
      }
      const arrears = page.data.arrearsData;
      const fmt = typeof page.data.formatMoney === "function" ? page.data.formatMoney : (await moneyFor(db, actor)).format;
      const names = await periodNames(db, org, (arrears.filters.schoolYearIds || []).map(Number).filter(Boolean), (arrears.filters.termIds || []).map(Number).filter(Boolean));
      scope.period = period.label === "current term" ? { term: names.terms.join(", ") || "current term", schoolYear: names.schoolYears.join(", ") || null } : { label: period.label, schoolYears: names.schoolYears };
      if (query.minOutstanding) scope.minAmount = fmt(Number(query.minOutstanding));
      scope.currency = page.data.financeCurrency && page.data.financeCurrency.code;
      scope.includes = "Every student with money still owed after credit: overdue, part paid, nothing paid (due or not yet due), and 30+ days late.";
      const students = arrears.students || [];
      const { rows, truncated } = cap(students);
      const s = arrears.summary || {};
      return {
        data: rows.map((st) => ({
          student_id: Number(st.student_id),
          student: st.student_name,
          class: st.class_name || "No class",
          owed: round2(st.outstanding), owedText: fmt(st.outstanding),
          billed: round2(st.total_billed), paid: round2(st.total_paid),
          credit: round2(st.student_credit || 0),
          status: OWED_STATUS[st.primary_status] || st.primary_status,
          mostDaysLate: st.max_days_overdue || 0,
          parent: st.guardian_name || null,
          bills: (st.bills || []).map((b) => ({ bill: b.bill_title, due: dateText(b.due_date), owed: round2(b.outstanding), daysLate: b.days_overdue || 0, status: OWED_STATUS[b.status] || b.status })),
        })),
        totals: {
          studentsOwing: s.count || 0,
          totalOwed: round2(s.totalOutstanding || 0), totalOwedText: fmt(s.totalOutstanding || 0),
          paidTowardsThem: round2(s.partialPayments || 0), paidTowardsThemText: fmt(s.partialPayments || 0),
          owedWithNothingPaid: round2(s.neverPaidOutstanding || 0), owedWithNothingPaidText: fmt(s.neverPaidOutstanding || 0),
          thirtyPlusDaysLate: s.overdueThirtyPlus || 0,
          familiesWithEmail: s.hasEmail || 0,
          familiesWithoutEmail: s.noEmail || 0,
        },
        scope,
        truncated,
      };
    },
  },

  // ── Bills ───────────────────────────────────────────────────────────────────────────────
  // GET /internal/api/read/list_bills?status=&class=&period=
  list_bills: {
    async run(db, actor, q) {
      const held = await needPaygira(db, actor, [P.bills, P.subscriptions], "Bills (or Repeating bills)");
      const org = actor.organizationId;
      const section = held.has(P.bills) ? "bills" : "subscriptions";
      const status = String(q.status || "all").trim().toLowerCase();
      const STATUSES = ["all", "sent", "active", "draft", "cancelled", "owing", "unpaid", "paid"];
      if (!STATUSES.includes(status)) throw new ReadError("VALIDATION", "status must be sent, draft, cancelled, owing, paid or all.");
      let classes = null;
      if (q.class) classes = await findClasses(db, org, q.class);
      // The Bills page's filter: billYear (then every term of it); none = the current term. A
      // billYear that isn't a year id filters nothing: the page's list of every bill.
      const period = await periodOf(db, actor, q.period);
      const query = { section };
      if (period.kind === "year") query.billYear = period.yearId;
      if (period.kind === "all") query.billYear = "all";
      const finance = require("../../controllers/financeController");
      const page = await callPage(finance.financePageGet, actor, { query, path: "/finance", pages: { [section]: true } });
      if (page.kind !== "render" || !Array.isArray(page.data.bills)) {
        if (page.kind === "redirect") throw new ReadError("PERMISSION_DENIED", "You need the Main PayGira permission with Bills for this.");
        throw new Error(`bills page answered ${page.kind}`);
      }
      const fmt = typeof page.data.formatMoney === "function" ? page.data.formatMoney : (await moneyFor(db, actor)).format;
      let bills = page.data.bills;
      if (section === "subscriptions") bills = bills.filter((b) => b.bill_type === "recurring");
      const filters = page.data.billListFilters || {};
      const names = await periodNames(db, org, [Number(filters.school_year_id)].filter(Boolean), [Number(filters.term_id)].filter(Boolean));

      // Each student's share, by the bill's own schedule (every assignment of a bill repeats on the
      // bill's dates: financeController enrichScheduledAssignment), to say who has paid.
      const billIds = bills.map((b) => Number(b.bill_id));
      const { rows: shares } = billIds.length
        ? await db.query(
            `SELECT a.bill_id, a.student_id, a.amount, a.amount_paid, a.late_fee_applied, a.status, s.class_id
               FROM finance_bill_assignments a
               LEFT JOIN students s ON s.student_id = a.student_id AND s.organization_id = a.organization_id
              WHERE a.organization_id = $1 AND a.bill_id = ANY($2::int[])`,
            [org, billIds]
          )
        : { rows: [] };
      const classSet = classes ? new Set(classes.map((c) => c.id)) : null;
      const byBill = new Map(billIds.map((id) => [id, []]));
      shares.forEach((row) => byBill.get(Number(row.bill_id)).push(row));
      const shareOf = (bill, row) => {
        const times = bill.bill_type === "recurring" ? Math.max((bill.scheduled_occurrence_dates || []).length, 1) : 1;
        const billed = Number(row.amount || 0) * times;
        const owed = Math.max(billed + Number(row.late_fee_applied || 0) - Number(row.amount_paid || 0), 0);
        return { billed, owed, paid: Number(row.amount_paid || 0) };
      };
      const tally = (bill, rows) => {
        const out = { students: rows.length, paid: 0, partlyPaid: 0, unpaid: 0, cancelled: 0, billed: 0, collected: 0, owed: 0 };
        rows.forEach((row) => {
          const share = shareOf(bill, row);
          out.billed += share.billed;
          out.collected += share.paid;
          out.owed += share.owed;
          if (String(row.status || "").toLowerCase() === "cancelled") out.cancelled += 1;
          else if (share.owed <= 0.005) out.paid += 1;
          else if (share.paid > 0) out.partlyPaid += 1;
          else out.unpaid += 1;
        });
        return out;
      };

      const { rows: classRows } = await db.query("SELECT class_id, class_name FROM classes WHERE organization_id = $1", [org]);
      const className = new Map(classRows.map((row) => [Number(row.class_id), row.class_name]));
      let listed = bills.map((b) => {
        const rows = byBill.get(Number(b.bill_id)) || [];
        const all = tally(b, rows);
        const inClass = classSet ? tally(b, rows.filter((row) => classSet.has(Number(row.class_id)))) : null;
        const who = b.applies_to === "classes"
          ? listOf((b.target_class_ids || []).map((id) => className.get(Number(id)) || null)) || "Chosen classes"
          : b.applies_to === "students" ? `${(b.target_student_ids || []).length} chosen students` : "Whole school";
        return { bill: b, rows, all, inClass, who };
      });
      if (classSet) listed = listed.filter((item) => item.inClass.students > 0);
      const owedOf = (item) => Number(item.bill.total_outstanding || 0);
      listed = listed.filter(({ bill, all }) => {
        if (status === "sent" || status === "active") return bill.status === "active";
        if (status === "draft" || status === "cancelled") return bill.status === status;
        if (status === "owing" || status === "unpaid") return bill.status !== "cancelled" && owedOf({ bill }) > 0.005;
        if (status === "paid") return bill.status !== "cancelled" && all.students > 0 && owedOf({ bill }) <= 0.005;
        return true;
      });
      const { rows, truncated } = cap(listed);
      const data = rows.map(({ bill, all, inClass, who }) => ({
        id: Number(bill.bill_id),
        bill: bill.title,
        kind: BILL_KIND(bill),
        status: BILL_STATUS[bill.status] || bill.status,
        due: dateText(bill.due_date),
        for: who,
        term: bill.term_name || null,
        schoolYear: bill.year_label || null,
        amountEach: round2(bill.amount), amountEachText: fmt(bill.amount),
        students: Number(bill.assigned_count || 0),
        billed: round2(bill.total_amount), billedText: fmt(bill.total_amount),
        paid: round2(bill.total_paid), paidText: fmt(bill.total_paid),
        owed: round2(bill.total_outstanding), owedText: fmt(bill.total_outstanding),
        studentsPaid: all.paid,
        studentsPartlyPaid: all.partlyPaid,
        studentsUnpaid: all.unpaid,
        ...(all.cancelled ? { studentsCancelled: all.cancelled } : {}),
        ...(inClass ? {
          inClass: {
            students: inClass.students, paid: inClass.paid, partlyPaid: inClass.partlyPaid, unpaid: inClass.unpaid,
            billed: round2(inClass.billed), billedText: fmt(inClass.billed),
            collected: round2(inClass.collected), collectedText: fmt(inClass.collected),
            owed: round2(inClass.owed), owedText: fmt(inClass.owed),
          },
        } : {}),
      }));
      const sum = (fn) => listed.reduce((total, item) => total + fn(item), 0);
      const shownIds = listed.map((item) => Number(item.bill.bill_id));
      const distinct = new Set([].concat(...listed.map((item) => (classSet ? item.rows.filter((row) => classSet.has(Number(row.class_id))) : item.rows).map((row) => Number(row.student_id)))));
      const billed = sum((item) => Number(item.bill.total_amount || 0));
      const paid = sum((item) => Number(item.bill.total_paid || 0));
      const owed = sum((item) => Number(item.bill.total_outstanding || 0));
      const totals = {
        bills: listed.length,
        byStatus: listed.reduce((acc, item) => { const k = BILL_STATUS[item.bill.status] || item.bill.status; acc[k] = (acc[k] || 0) + 1; return acc; }, {}),
        studentsBilled: distinct.size,
        billed: round2(billed), billedText: fmt(billed),
        paid: round2(paid), paidText: fmt(paid),
        owed: round2(owed), owedText: fmt(owed),
        studentsPaid: sum((item) => item.all.paid),
        studentsPartlyPaid: sum((item) => item.all.partlyPaid),
        studentsUnpaid: sum((item) => item.all.unpaid),
        ...(classSet ? {
          inClass: {
            billed: round2(sum((item) => item.inClass.billed)), billedText: fmt(sum((item) => item.inClass.billed)),
            collected: round2(sum((item) => item.inClass.collected)), collectedText: fmt(sum((item) => item.inClass.collected)),
            owed: round2(sum((item) => item.inClass.owed)), owedText: fmt(sum((item) => item.inClass.owed)),
            paid: sum((item) => item.inClass.paid), partlyPaid: sum((item) => item.inClass.partlyPaid), unpaid: sum((item) => item.inClass.unpaid),
          },
        } : {}),
      };
      const morePages = Boolean(page.data.billPagination && page.data.billPagination.hasMore);
      return {
        data,
        totals,
        scope: {
          page: section === "bills" ? "PayGira > Bills > All bills" : "PayGira > Bills > Repeating",
          period: period.label === "current term"
            ? { term: names.terms.join(", ") || "current term", schoolYear: names.schoolYears.join(", ") || null }
            : { label: period.label, schoolYear: names.schoolYears.join(", ") || null },
          status: status === "all" ? "every bill" : status,
          ...(classes ? { class: classes.map((c) => c.name), classNote: "Bills with students in these classes; inClass counts only those students." } : {}),
          currency: page.data.financeCurrency && page.data.financeCurrency.code,
          ...(morePages ? { note: "The Bills page shows its first 500 bills for this period; totals cover those." } : {}),
          billIds: shownIds.length > 50 ? undefined : shownIds,
        },
        truncated: truncated || morePages,
      };
    },
  },
};

// Not a tool (the group loader lists only enumerable keys): for other reads to combine with.
Object.defineProperty(module.exports, "ridersIn", { value: ridersIn, enumerable: false });
