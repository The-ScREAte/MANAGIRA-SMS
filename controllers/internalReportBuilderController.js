"use strict";

// The Report Builder for Mira (routes/internalApiRoute.js, service-token only).
// Every action runs the Report Builder's own handlers
// (controllers/reportBuilderController.js) as the signed-in staff member, so
// Mira sees and can do exactly what that person can on the page, with the
// same permission checks. On top of that it matches the names people use
// ("JHS 1", "Fall Semester", "Female") to the school's own records, and
// refuses anything it can't match instead of guessing, so every answer comes
// from the school's data in Managira and nowhere else.
const crypto = require("crypto");
const db = require("../config/db");
const { userHasPermission, PERMISSIONS } = require("../middleware/permissionMiddleware");
const { MAX_EXPORT_ROWS } = require("../utils/reportBuilder");
const reportBuilder = require("./reportBuilderController")(db);

const ROW_LIMIT = 50; // rows handed to the assistant per run; totals are always exact
const FORMATS = { xlsx: "Excel", csv: "CSV", docx: "Word", mgrt: "Managira template" };
const LINK_HOURS = 24;

const fail = (status, message, extra = {}) => Object.assign(new Error(message), { status, ...extra });
const norm = (value) => String(value ?? "").trim().toLowerCase().replace(/\s+/g, " ");
const positiveInt = (value) => { const n = Number(value); return Number.isInteger(n) && n > 0 ? n : null; };

// The signed-in staff member, as the Report Builder's handlers expect them.
async function callerFrom(source) {
  const organizationId = positiveInt(source.organizationId);
  const userId = positiveInt(source.userId);
  if (!organizationId || !userId) throw fail(400, "organizationId and userId are required.");
  const identity = { organizationId, userId, userRole: source.userRole, accountType: source.accountType, userEmail: source.userEmail };
  if (!(await userHasPermission(db, identity, PERMISSIONS.MANAGE_REPORTS))) {
    throw fail(403, "You don't have the Manage Reports permission, so the Report Builder isn't available to you.");
  }
  const user = (await db.query("SELECT first_name, last_name, email FROM users WHERE user_id = $1 AND organization_id = $2", [userId, organizationId])).rows[0] || {};
  return {
    organizationId,
    userId,
    session: {
      organizationId,
      userId,
      user: { user_id: userId, account_type: source.accountType || source.userRole, email: user.email || source.userEmail || null },
      userRole: source.userRole,
      accountType: source.accountType,
      firstName: user.first_name || "",
      lastName: user.last_name || "",
    },
  };
}

// Runs one Report Builder handler and captures what it would have sent.
function invoke(handler, caller, { body = {}, params = {}, query = {}, method = "POST" } = {}) {
  return new Promise((resolve, reject) => {
    const headers = {};
    const res = {
      statusCode: 200,
      locals: {},
      status(code) { this.statusCode = code; return this; },
      setHeader(key, value) { headers[String(key).toLowerCase()] = value; },
      json(payload) { resolve({ status: this.statusCode, json: payload, headers }); },
      send(payload) { resolve({ status: this.statusCode, body: payload, headers }); },
      render(view, locals) { resolve({ status: this.statusCode, view, locals }); },
      redirect(location) { resolve({ status: 302, location }); },
    };
    const req = { session: caller.session, body, params, query, method, headers: {}, get: () => undefined, originalUrl: "/internal/report-builder", ip: "127.0.0.1" };
    Promise.resolve(handler(req, res)).catch(reject);
  });
}

const ok = (result, message) => {
  if (result.status >= 400 || (result.json && result.json.success === false)) {
    throw fail(result.status >= 400 ? result.status : 400, (result.json && result.json.error) || message || "The Report Builder couldn't do that.");
  }
  return result;
};

// What this person can see on the Report Builder page: report types, their
// columns and filters, classes, terms and saved reports.
async function pageData(caller) {
  const result = ok(await invoke(reportBuilder.page, caller, { method: "GET" }));
  if (!result.locals) throw fail(500, "Could not load the Report Builder.");
  return result.locals;
}

function describeType(type, families) {
  const family = families.find((f) => f.views.includes(type.key));
  return {
    reportType: type.key,
    title: type.title,
    view: type.variant || "",
    group: family ? family.group : "",
    about: family ? family.description : "",
  };
}

function findType(locals, wanted) {
  const w = norm(wanted);
  if (!w) return null;
  return locals.reportTypes.find((t) => norm(t.key) === w)
    || locals.reportTypes.find((t) => norm(`${t.title} ${t.variant || ""}`) === w || norm(`${t.title} - ${t.variant || ""}`) === w || norm(`${t.title} (${t.variant || ""})`) === w)
    || (locals.reportTypes.filter((t) => norm(t.title) === w).length === 1 ? locals.reportTypes.find((t) => norm(t.title) === w) : null);
}

async function selectOptions(caller, reportType) {
  const result = ok(await invoke(reportBuilder.options, caller, { params: { reportType }, method: "GET" }));
  return result.json.options || {};
}

// The allowed values of every filter on one report, from the school's data.
async function filterChoices(caller, locals, type) {
  const needsSelect = type.criteria.some((c) => c.type === "select" && c.hasOptions);
  const select = needsSelect ? await selectOptions(caller, type.key) : {};
  const choices = {};
  type.criteria.forEach((c) => {
    if (c.type === "class") choices[c.key] = locals.classes.map((k) => k.class_name);
    else if (c.type === "term") choices[c.key] = locals.terms.map((t) => t.term_name + (t.is_current ? " (current)" : ""));
    else if (c.type === "choice") choices[c.key] = (c.options || []).map((o) => o.label);
    else if (c.type === "scale") choices[c.key] = ["As in Report Settings", "a number each subject is scored out of, e.g. 100"];
    else if (c.type === "select") choices[c.key] = (select[c.key] || []).map((o) => o.label);
  });
  return { choices, select };
}

// Names -> the Report Builder's own values. Anything that doesn't match the
// school's data is returned as a problem, never dropped or guessed.
async function resolveDefinition(caller, locals, args) {
  const type = findType(locals, args.reportType);
  if (!type) {
    throw fail(404, args.reportType ? `There's no "${args.reportType}" report available to you.` : "Say which report to run.", {
      available: locals.reportTypes.map((t) => `${t.key} (${t.title}${t.variant ? " - " + t.variant : ""})`),
    });
  }
  const problems = [];
  const columnByName = (name) => {
    const n = norm(name);
    return type.columns.find((c) => norm(c.key) === n) || type.columns.find((c) => norm(c.label) === n) || null;
  };
  let columns = [];
  for (const wanted of Array.isArray(args.columns) ? args.columns : []) {
    const column = columnByName(wanted);
    if (column) { if (!columns.includes(column.key)) columns.push(column.key); } else problems.push(`No column "${wanted}" on this report.`);
  }
  if (!columns.length) columns = [...type.defaultColumns];

  const criteria = {};
  const applied = [];
  const filters = { ...(args.filters && typeof args.filters === "object" && !Array.isArray(args.filters) ? args.filters : {}) };
  // {from, to} written straight into filters means the report's (only) date filter.
  const dateFilters = type.criteria.filter((c) => c.type === "date");
  if ((filters.from || filters.to) && dateFilters.length === 1 && !filters[dateFilters[0].key]) {
    filters[dateFilters[0].key] = { from: filters.from, to: filters.to };
    delete filters.from; delete filters.to;
  }
  let select = null;
  for (const [wantedKey, raw] of Object.entries(filters)) {
    const def = type.criteria.find((c) => norm(c.key) === norm(wantedKey) || norm(c.label) === norm(wantedKey));
    if (!def) { problems.push(`No filter "${wantedKey}" on this report.`); continue; }
    const values = (Array.isArray(raw) ? raw : [raw]).filter((v) => v !== null && v !== undefined && String(v).trim() !== "");
    if (def.type === "date") {
      const range = raw && typeof raw === "object" && !Array.isArray(raw) ? raw : { from: values[0], to: values[1] };
      const iso = (v) => (v ? String(v).slice(0, 10) : "");
      criteria[def.key] = { from: iso(range.from), to: iso(range.to) };
      applied.push(`${def.label}: ${iso(range.from) || "any"} to ${iso(range.to) || "any"}`);
    } else if (def.type === "class") {
      const ids = [];
      values.forEach((v) => {
        const match = locals.classes.find((k) => String(k.class_id) === String(v) || norm(k.class_name) === norm(v));
        if (match) ids.push(String(match.class_id)); else problems.push(`No class "${v}" (classes: ${locals.classes.map((k) => k.class_name).join(", ")}).`);
      });
      if (ids.length) { criteria[def.key] = ids; applied.push(`${def.label}: ${ids.map((id) => locals.classes.find((k) => String(k.class_id) === id).class_name).join(", ")}`); }
    } else if (def.type === "term") {
      const ids = [];
      values.forEach((v) => {
        const n = norm(String(v).replace(/\(current\)/i, ""));
        const exact = locals.terms.find((t) => String(t.term_id) === String(v) || norm(t.term_name) === n);
        // "Fall Semester" alone: the current one of that name, else the most recent.
        const byName = locals.terms.filter((t) => norm(String(t.term_name).split(" · ")[0]) === n).sort((a, b) => Number(b.is_current) - Number(a.is_current))[0];
        const match = exact || byName;
        if (match) ids.push(String(match.term_id)); else problems.push(`No term "${v}" (terms: ${locals.terms.map((t) => t.term_name).join("; ")}).`);
      });
      if (ids.length) { criteria[def.key] = ids; applied.push(`${def.label}: ${ids.map((id) => locals.terms.find((t) => String(t.term_id) === id).term_name).join(", ")}`); }
    } else if (def.type === "scale") {
      const v = String(values[0] ?? "").trim();
      const value = /setting/i.test(v) ? "settings" : String(Number(v.replace(/[^\d.]/g, "")) || "");
      if (value === "settings" || (Number(value) > 0 && Number(value) <= 1000)) { criteria[def.key] = value; applied.push(`${def.label}: ${value === "settings" ? "as in Report Settings" : `each subject out of ${value}`}`); }
      else problems.push(`${def.label} is "As in Report Settings" or a number from 1 to 1000.`);
    } else if (def.type === "choice") {
      const v = values[0];
      const match = (def.options || []).find((o) => norm(o.value) === norm(v) || norm(o.label) === norm(v));
      if (match) { criteria[def.key] = match.value; applied.push(`${def.label}: ${match.label}`); } else problems.push(`"${v}" isn't a choice for ${def.label} (choices: ${(def.options || []).map((o) => o.label).join(", ")}).`);
    } else if (def.type === "select") {
      select = select || await selectOptions(caller, type.key);
      const options = select[def.key] || [];
      const picked = [];
      values.forEach((v) => {
        const match = options.find((o) => norm(o.value) === norm(v) || norm(o.label) === norm(v));
        if (match) picked.push(match); else problems.push(`"${v}" isn't a value of ${def.label} in your school's data (values: ${options.map((o) => o.label).slice(0, 40).join(", ") || "none yet"}).`);
      });
      if (picked.length) { criteria[def.key] = picked.map((o) => o.value); applied.push(`${def.label}: ${picked.map((o) => o.label).join(", ")}`); }
    } else {
      const text = String(values[0] ?? "").trim().slice(0, 200);
      if (text) { criteria[def.key] = text; applied.push(`${def.label} contains "${text}"`); }
    }
  }
  let sort = null;
  if (args.sortBy) {
    const column = columnByName(args.sortBy);
    if (column && columns.includes(column.key)) sort = { key: column.key, dir: norm(args.sortDirection) === "desc" ? "desc" : "asc" };
    else problems.push(`Can't sort by "${args.sortBy}" - it isn't one of the chosen columns.`);
  }
  if (problems.length) throw fail(409, problems.join(" "), { problems });
  return { type, reportType: type.key, columns, criteria, sort, applied };
}

// A saved report this person can see, by id or exact name.
function findSaved(locals, wanted) {
  const list = locals.savedReports || [];
  if (positiveInt(wanted)) { const byId = list.find((s) => String(s.report_id) === String(wanted)); if (byId) return byId; }
  const matches = list.filter((s) => norm(s.report_name) === norm(wanted));
  if (matches.length === 1) return matches[0];
  if (matches.length > 1) throw fail(409, `More than one saved report is called "${wanted}". Say whose (${matches.map((s) => s.owner_name || "you").join(", ")}).`);
  throw fail(404, `No saved report called "${wanted}" (saved reports: ${list.map((s) => s.report_name).join(", ") || "none"}).`);
}

async function savedDefinition(caller, locals, wanted) {
  const saved = findSaved(locals, wanted);
  const full = ok(await invoke(reportBuilder.loadSaved, caller, { params: { reportId: String(saved.report_id) }, method: "GET" })).json.report;
  const type = locals.reportTypes.find((t) => t.key === full.report_type);
  return { saved, full, type, reportType: full.report_type, columns: full.columns_json || [], criteria: full.criteria_json || {}, branding: full.branding_json || {} };
}

const describeCriteria = (locals, type, criteria) => Object.entries(criteria || {}).map(([key, value]) => {
  const def = (type?.criteria || []).find((c) => c.key === key);
  const label = def ? def.label : key;
  const list = Array.isArray(value) ? value : [value];
  if (def?.type === "class") return `${label}: ${list.map((id) => (locals.classes.find((k) => String(k.class_id) === String(id)) || {}).class_name || id).join(", ")}`;
  if (def?.type === "term") return `${label}: ${list.map((id) => (locals.terms.find((t) => String(t.term_id) === String(id)) || {}).term_name || id).join(", ")}`;
  if (def?.type === "date") return `${label}: ${value.from || "any"} to ${value.to || "any"}`;
  if (def?.type === "choice") return `${label}: ${((def.options || []).find((o) => o.value === value) || {}).label || value}`;
  return `${label}: ${list.join(", ")}`;
});

// ---------- signed, encrypted download links ----------
const linkKey = () => crypto.createHash("sha256").update(`report-download:${process.env.SESSION_SECRET || ""}`).digest();
function sealLink(payload) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", linkKey(), iv);
  const data = Buffer.concat([cipher.update(JSON.stringify(payload), "utf8"), cipher.final()]);
  return Buffer.concat([iv, cipher.getAuthTag(), data]).toString("base64url");
}
function openLink(token) {
  try {
    const raw = Buffer.from(String(token || ""), "base64url");
    const decipher = crypto.createDecipheriv("aes-256-gcm", linkKey(), raw.subarray(0, 12));
    decipher.setAuthTag(raw.subarray(12, 28));
    const payload = JSON.parse(Buffer.concat([decipher.update(raw.subarray(28)), decipher.final()]).toString("utf8"));
    return payload && payload.x > Date.now() ? payload : null;
  } catch (_error) { return null; }
}
const appBaseUrl = () => String((process.env.NODE_ENV === "production" ? process.env.BASE_URL_PRODUCTION : process.env.BASE_URL_LOCAL) || "http://localhost:4000").replace(/\/$/, "");

// ---------- handlers ----------
const handle = (fn) => async (req, res) => {
  try {
    return res.json(await fn(req));
  } catch (error) {
    if (error.status) return res.status(error.status).json({ error: error.message, ...(error.problems ? { problems: error.problems } : {}), ...(error.available ? { available: error.available } : {}) });
    console.error("[internalApi/reportBuilder]", error);
    return res.status(500).json({ error: "The Report Builder couldn't do that right now." });
  }
};

module.exports = {
  // GET ?reportType= : the reports this person can run, or one report's columns and filter values.
  catalog: handle(async (req) => {
    const caller = await callerFrom(req.query);
    const locals = await pageData(caller);
    if (!req.query.reportType) {
      return {
        reports: locals.reportTypes.map((t) => describeType(t, locals.families)),
        savedReports: (locals.savedReports || []).length,
        note: "Only these reports exist. Pass reportType to see a report's columns and filters.",
      };
    }
    const type = findType(locals, req.query.reportType);
    if (!type) throw fail(404, `There's no "${req.query.reportType}" report available to you.`, { available: locals.reportTypes.map((t) => t.key) });
    const { choices } = await filterChoices(caller, locals, type);
    return {
      ...describeType(type, locals.families),
      columns: type.columns.map((c) => ({ key: c.key, label: c.label, type: c.type, group: c.group || undefined })),
      defaultColumns: type.defaultColumns,
      filters: type.criteria.map((c) => ({
        key: c.key, label: c.label, type: c.type,
        ...(choices[c.key] ? { allowedValues: choices[c.key].slice(0, 200) } : {}),
        ...(c.type === "date" ? { format: "{ from: YYYY-MM-DD, to: YYYY-MM-DD }" } : {}),
        ...(c.type === "text" ? { format: "text to match" } : {}),
      })),
    };
  }),

  // POST: run a report (a new design or a saved report) and return exact totals.
  run: handle(async (req) => {
    const caller = await callerFrom(req.body);
    const locals = await pageData(caller);
    let def;
    let savedName = null;
    if (req.body.savedReport) {
      const saved = await savedDefinition(caller, locals, req.body.savedReport);
      def = { reportType: saved.reportType, columns: saved.columns, criteria: saved.criteria, type: saved.type, applied: describeCriteria(locals, saved.type, saved.criteria), sort: null };
      savedName = saved.saved.report_name;
    } else {
      def = await resolveDefinition(caller, locals, req.body);
    }
    const page = positiveInt(req.body.page) || 1;
    const result = ok(await invoke(reportBuilder.run, caller, { body: { reportType: def.reportType, columns: def.columns, criteria: def.criteria, sort: def.sort, page, pageSize: ROW_LIMIT } })).json;
    const pageCount = Math.max(1, Math.ceil(result.total / ROW_LIMIT));
    return {
      report: `${def.type.title}${def.type.variant ? " - " + def.type.variant : ""}`,
      savedReport: savedName,
      filtersApplied: def.applied.length ? def.applied : ["NONE - this total covers ALL records, not any particular class, term or dates"],
      columns: result.columns.map((c) => c.label),
      rows: result.rows.map((row) => Object.fromEntries(result.columns.map((c) => [c.label, row[c.key] ?? null]))),
      total: result.total,
      page,
      pageCount,
      note: result.total > result.rows.length + (page - 1) * ROW_LIMIT
        ? `Showing rows ${(page - 1) * ROW_LIMIT + 1}-${(page - 1) * ROW_LIMIT + result.rows.length} of ${result.total}. "total" is the exact count; export for every row.`
        : `All ${result.total} matching rows.`,
    };
  }),

  // GET: the saved reports this person can open.
  saved: handle(async (req) => {
    const caller = await callerFrom(req.query);
    const locals = await pageData(caller);
    return {
      savedReports: (locals.savedReports || []).map((s) => {
        const type = locals.reportTypes.find((t) => t.key === s.report_type);
        return {
          name: s.report_name, id: s.report_id, report: type ? `${type.title}${type.variant ? " - " + type.variant : ""}` : s.report_type,
          owner: s.is_owner ? "you" : s.owner_name, sharedWith: s.share_count || 0, emailed: s.schedule_frequency || "no", favorite: Boolean(s.is_favorite),
        };
      }),
    };
  }),

  // POST: save a new report, or (confirm=true) replace a saved one's design.
  save: handle(async (req) => {
    const caller = await callerFrom(req.body);
    const locals = await pageData(caller);
    const name = String(req.body.name || "").trim().slice(0, 120);
    const def = await resolveDefinition(caller, locals, req.body);
    const branding = req.body.includeSchoolHeader ? { orgName: true, logo: true, address: true, phone: true, date: true } : {};
    if (req.body.replaceSavedReport) {
      const saved = findSaved(locals, req.body.replaceSavedReport);
      if (!saved.is_owner) throw fail(403, "Only the person who made a saved report can change it.");
      if (req.body.confirm !== true) {
        return { status: "confirmation_required", warning: `This replaces the columns and filters of "${saved.report_name}" with: ${def.columns.length} columns; filters ${def.applied.join("; ") || "none"}. People it's shared with will see the new version. Ask the user to confirm.` };
      }
      ok(await invoke(reportBuilder.update, caller, { params: { reportId: String(saved.report_id) }, body: { reportType: def.reportType, columns: def.columns, criteria: def.criteria, name: name || saved.report_name, branding } }));
      return { status: "done", savedReport: name || saved.report_name, updated: true, filtersApplied: def.applied };
    }
    if (!name) throw fail(400, "Give the report a name.");
    const result = ok(await invoke(reportBuilder.save, caller, { body: { reportType: def.reportType, columns: def.columns, criteria: def.criteria, name, branding } })).json;
    return { status: "done", savedReport: result.report.report_name, id: result.report.report_id, filtersApplied: def.applied, note: "It's now in Report Builder > My reports." };
  }),

  // POST: delete a saved report (confirm=true after a warning).
  remove: handle(async (req) => {
    const caller = await callerFrom(req.body);
    const locals = await pageData(caller);
    const saved = findSaved(locals, req.body.savedReport);
    if (!saved.is_owner) throw fail(403, "Only the person who made a saved report can delete it.");
    if (req.body.confirm !== true) {
      return { status: "confirmation_required", warning: `Deleting "${saved.report_name}" can't be undone${saved.share_count ? `, and the ${saved.share_count} people it's shared with lose it` : ""}${saved.schedule_frequency ? `, and its ${saved.schedule_frequency} email stops` : ""}. Ask the user to confirm.` };
    }
    ok(await invoke(reportBuilder.deleteSaved, caller, { params: { reportId: String(saved.report_id) }, method: "DELETE" }));
    return { status: "done", deleted: saved.report_name };
  }),

  // POST: share a saved report with staff (add/remove by name), after a confirm.
  share: handle(async (req) => {
    const caller = await callerFrom(req.body);
    const locals = await pageData(caller);
    const saved = findSaved(locals, req.body.savedReport);
    if (!saved.is_owner) throw fail(403, "Only the person who made a saved report can share it.");
    const sharing = ok(await invoke(reportBuilder.sharing, caller, { params: { reportId: String(saved.report_id) }, method: "GET" })).json;
    const staff = ok(await invoke(reportBuilder.staff, caller, { method: "GET" })).json.staff || [];
    const current = new Set((sharing.userIds || sharing.shares || []).map((x) => String(x.user_id || x)));
    const byName = (n) => staff.filter((p) => norm(p.name) === norm(n) || norm(p.name).split(" ").includes(norm(n)));
    const problems = [];
    const pick = (names) => (Array.isArray(names) ? names : []).map((n) => {
      const found = byName(n);
      if (found.length === 1) return found[0];
      problems.push(found.length ? `"${n}" matches ${found.map((p) => p.name).join(", ")} - say which.` : `No staff member called "${n}".`);
      return null;
    }).filter(Boolean);
    const add = pick(req.body.addStaff);
    const drop = pick(req.body.removeStaff);
    if (problems.length) throw fail(409, problems.join(" "), { problems });
    const next = new Set(current);
    add.forEach((p) => next.add(String(p.user_id)));
    drop.forEach((p) => next.delete(String(p.user_id)));
    const names = (ids) => [...ids].map((id) => (staff.find((p) => String(p.user_id) === id) || {}).name).filter(Boolean);
    if (req.body.confirm !== true) {
      return { status: "confirmation_required", warning: `"${saved.report_name}" will be shared with: ${names(next).join(", ") || "nobody"}. They'll see it in My reports, showing only data their own role allows. Ask the user to confirm.` };
    }
    ok(await invoke(reportBuilder.updateShares, caller, { params: { reportId: String(saved.report_id) }, body: { userIds: [...next].map(Number) }, method: "PUT" }));
    return { status: "done", savedReport: saved.report_name, sharedWith: names(next) };
  }),

  // POST: email a saved report on a schedule (or stop it), after a confirm.
  schedule: handle(async (req) => {
    const caller = await callerFrom(req.body);
    const locals = await pageData(caller);
    const saved = findSaved(locals, req.body.savedReport);
    if (!saved.is_owner) throw fail(403, "Only the person who made a saved report can schedule it.");
    const frequency = ["daily", "weekly", "monthly"].includes(norm(req.body.frequency)) ? norm(req.body.frequency) : "";
    const DAYS = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"];
    const weekdays = (Array.isArray(req.body.weekdays) ? req.body.weekdays : []).map((d) => (Number.isInteger(Number(d)) ? Number(d) : DAYS.findIndex((x) => x.startsWith(norm(d).slice(0, 3))))).filter((d) => d >= 0 && d <= 6);
    const format = FORMATS[req.body.format] && req.body.format !== "mgrt" ? req.body.format : "xlsx";
    const sendHour = Number.isInteger(Number(req.body.sendHour)) ? Number(req.body.sendHour) : 7;
    const plan = frequency
      ? `email "${saved.report_name}" ${frequency}${frequency === "weekly" ? ` on ${weekdays.map((d) => DAYS[d]).join(", ") || "(choose days)"}` : ""}${frequency === "monthly" ? ` on day ${positiveInt(req.body.monthDay) || 1}` : ""} at ${sendHour}:00 school time, as ${FORMATS[format]}, to your email${req.body.includeShared ? " and the people it's shared with" : ""}`
      : `stop emailing "${saved.report_name}"`;
    if (req.body.confirm !== true) return { status: "confirmation_required", warning: `This will ${plan}. Ask the user to confirm.` };
    ok(await invoke(reportBuilder.updateSchedule, caller, { params: { reportId: String(saved.report_id) }, body: { frequency, weekdays, monthDay: positiveInt(req.body.monthDay) || 1, sendHour, format, includeShared: Boolean(req.body.includeShared) }, method: "PUT" }));
    return { status: "done", schedule: plan };
  }),

  // POST: star / unstar a saved report.
  favorite: handle(async (req) => {
    const caller = await callerFrom(req.body);
    const locals = await pageData(caller);
    const saved = findSaved(locals, req.body.savedReport);
    ok(await invoke(reportBuilder.favorite, caller, { params: { reportId: String(saved.report_id) }, body: { favorite: Boolean(req.body.favorite) }, method: "PUT" }));
    return { status: "done", savedReport: saved.report_name, favorite: Boolean(req.body.favorite) };
  }),

  // POST: a download link (Excel, CSV, Word or a .mgrt template) that only this
  // person, signed in, can open; it runs the export fresh with their permissions.
  exportLink: handle(async (req) => {
    const caller = await callerFrom(req.body);
    const locals = await pageData(caller);
    const format = FORMATS[req.body.format] ? req.body.format : "xlsx";
    let definition;
    let name;
    let applied;
    if (req.body.savedReport) {
      const saved = await savedDefinition(caller, locals, req.body.savedReport);
      definition = { reportType: saved.reportType, columns: saved.columns, criteria: saved.criteria, branding: saved.branding };
      name = String(req.body.name || saved.saved.report_name);
      applied = describeCriteria(locals, saved.type, saved.criteria);
    } else {
      const def = await resolveDefinition(caller, locals, req.body);
      definition = { reportType: def.reportType, columns: def.columns, criteria: def.criteria, sort: def.sort, branding: req.body.includeSchoolHeader ? { orgName: true, logo: true, address: true, phone: true, date: true } : {} };
      name = String(req.body.name || `${def.type.title}${def.type.variant ? " - " + def.type.variant : ""}`);
      applied = def.applied;
    }
    const check = ok(await invoke(reportBuilder.run, caller, { body: { ...definition, page: 1, pageSize: 25 } })).json;
    if (format !== "mgrt" && check.total > MAX_EXPORT_ROWS) {
      throw fail(413, `This report has ${check.total.toLocaleString()} rows; exports take up to ${MAX_EXPORT_ROWS.toLocaleString()}. Add a filter (a class, term or dates).`);
    }
    const token = sealLink({ u: caller.userId, o: caller.organizationId, x: Date.now() + LINK_HOURS * 3600 * 1000, d: { ...definition, name: name.slice(0, 120), format } });
    return {
      status: "done",
      format: FORMATS[format],
      fileName: name,
      rows: format === "mgrt" ? undefined : check.total,
      filtersApplied: applied.length ? applied : ["none"],
      url: `${appBaseUrl()}/common/report-builder/download/${token}`,
      note: format === "mgrt"
        ? "A Managira template carries only the report's design (columns and filters), no data. Anyone using Managira can import it."
        : `The link works for ${LINK_HOURS} hours, only for you while signed in, and always downloads the latest data.`,
    };
  }),

  // POST: add a shared template (.mgrt) to My reports.
  importTemplate: handle(async (req) => {
    const caller = await callerFrom(req.body);
    let template = req.body.template;
    if (typeof template === "string") {
      try { template = JSON.parse(template); } catch (_error) { throw fail(400, "That isn't a Managira report template (.mgrt) - the file couldn't be read."); }
    }
    const result = ok(await invoke(reportBuilder.importTemplate, caller, { body: { template } })).json;
    return { status: "done", savedReport: result.report.report_name, leftOut: result.skipped || [], note: "It's in Report Builder > My reports, filled with your school's own data." };
  }),

  // For the download route: the sealed link's contents, if it's valid for this person.
  openLink,
};
