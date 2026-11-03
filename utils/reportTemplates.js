"use strict";

// Managira report templates (.mgrt): a Report Builder report's design - its
// report type, columns and filters - as a small file anyone can share. No
// school data goes in it: no school name, header or logo, no record ids, and
// no free-text filters (those name people). Filters that point at the school's
// own lists (classes, terms, subjects, remark types...) are kept by their
// names, so a school that imports the file gets them matched to its own lists;
// anything it doesn't have is simply left out and listed.
const { allowedBy } = require("./reportBuilder");

const FORMAT = "managira.report-template";
const VERSION = 1;
const EXTENSION = "mgrt";
const CONTENT_TYPE = "application/vnd.managira.report-template+json";
const SCHOOL_COLUMN = /^(subject|category|remark)_/; // columns made from the school's own lists

const text = (value, max = 120) => String(value ?? "").replace(/[\u0000-\u001f]/g, " ").trim().slice(0, max);
const same = (a, b) => text(a, 200).toLowerCase() === text(b, 200).toLowerCase();

async function classRows(db, context) {
  const ids = context.allowedClassIds;
  const result = await db.query(
    `SELECT class_id AS value, class_name AS label FROM classes
      WHERE organization_id = $1 AND obsolete_at IS NULL ${ids ? "AND class_id = ANY($2::int[])" : ""}`,
    ids ? [context.organizationId, ids] : [context.organizationId]
  );
  return result.rows.map((row) => ({ value: String(row.value), label: text(row.label) }));
}

async function termRows(db, context) {
  const result = await db.query(
    `SELECT t.term_id AS value, t.term_name AS name, sy.year_label AS year,
            COALESCE(t.current_term, FALSE) OR COALESCE(t.current, FALSE) AS is_current
       FROM terms t
       LEFT JOIN school_years sy ON sy.id = t.school_year_id AND sy.organization_id = t.organization_id
      WHERE t.organization_id = $1
      ORDER BY t.start_date DESC NULLS LAST, t.term_id DESC`,
    [context.organizationId]
  );
  return result.rows.map((row) => ({
    value: String(row.value), name: text(row.name), year: text(row.year), isCurrent: Boolean(row.is_current),
    label: [text(row.name), text(row.year)].filter(Boolean).join(" · "),
  }));
}

async function selectRows(db, context, criterion) {
  const result = await db.query(criterion.optionsSql, [context.organizationId]);
  return result.rows
    .filter((row) => row.value !== null && row.value !== "")
    .map((row) => ({ value: String(row.value), label: text(row.label ?? row.value) }));
}

// ---------- export ----------
// input: the validated { reportType, report, columns, criteria } of a report.
async function buildTemplate(db, context, input, name) {
  const { report } = input;
  const filters = [];
  for (const definition of report.criteria || []) {
    if (!Object.hasOwn(input.criteria, definition.key)) continue;
    const value = input.criteria[definition.key];
    const base = { key: definition.key, label: text(definition.label), type: definition.type };
    if (definition.type === "date") filters.push({ ...base, from: value.from || "", to: value.to || "" });
    else if (definition.type === "choice" || definition.type === "scale") filters.push({ ...base, value: String(value) });
    else if (["class", "term", "select"].includes(definition.type)) {
      const rows = definition.type === "class" ? await classRows(db, context)
        : definition.type === "term" ? await termRows(db, context)
        : definition.optionsSql ? await selectRows(db, context, definition) : [];
      const picked = (Array.isArray(value) ? value : [value]).map(String);
      const items = picked.map((v) => {
        const row = rows.find((r) => r.value === v);
        if (definition.type === "term") return row ? { name: row.name, year: row.year } : null;
        if (definition.type === "class") return row ? { label: row.label } : null;
        return { value: v, label: row ? row.label : v }; // list values are names, not ids
      }).filter(Boolean);
      if (items.length) filters.push({ ...base, items });
    }
    // Free-text filters (names, emails, phone numbers, references) stay with the school.
  }
  return {
    format: FORMAT,
    version: VERSION,
    about: "A Managira report template: the report's columns and filters, with no school data. Import it in Reports > Report Builder > My reports > Import.",
    name: text(name) || text(report.title),
    report: { type: input.reportType, title: text(report.title), view: text(report.variant) },
    columns: input.columns.map((key) => ({ key, label: text(report.columns[key].label) })),
    filters,
    exportedAt: new Date().toISOString(),
  };
}

// ---------- import ----------
// Returns { reportType, columns, criteria, name, report, skipped: [labels] } or { error }.
async function readTemplate(db, context, template) {
  if (!template || typeof template !== "object" || Array.isArray(template) || template.format !== FORMAT) {
    return { error: "This isn't a Managira report template (.mgrt) file." };
  }
  if (Number(template.version) > VERSION) return { error: "This template was made with a newer version of Managira. Refresh the page and try again." };
  const reportType = text(template.report && template.report.type, 60);
  const report = context.accessibleReports.get(reportType);
  if (!report) {
    const title = text(template.report && template.report.title, 80) || "this";
    return { error: `The ${title} report isn't available to you here. It may need a feature your school doesn't use, or a permission your role doesn't have.` };
  }
  const allowed = allowedBy(context.granted);
  const skipped = [];

  // Columns: the same key, or (for columns made from the school's own lists) the same name.
  const columns = [];
  for (const column of (Array.isArray(template.columns) ? template.columns : []).slice(0, 200)) {
    const key = text(column && column.key, 80);
    const label = text(column && column.label);
    let match = Object.hasOwn(report.columns, key) && allowed(report.columns[key]) ? key : null;
    if (!match && SCHOOL_COLUMN.test(key)) {
      const prefix = key.split("_")[0] + "_";
      match = Object.keys(report.columns).find((k) => k.startsWith(prefix) && same(report.columns[k].label, label) && allowed(report.columns[k])) || null;
    }
    if (match && !columns.includes(match)) columns.push(match);
    else if (!match) skipped.push(`Column: ${label || key}`);
  }

  // Filters, matched to this school's own lists by name.
  const criteria = {};
  const definitions = new Map((report.criteria || []).filter(allowed).map((c) => [c.key, c]));
  let classes = null;
  let terms = null;
  for (const filter of (Array.isArray(template.filters) ? template.filters : []).slice(0, 60)) {
    const definition = filter && definitions.get(text(filter.key, 80));
    const label = text(filter && filter.label) || text(filter && filter.key, 80);
    if (!definition || definition.type !== filter.type) { skipped.push(`Filter: ${label}`); continue; }
    const items = (Array.isArray(filter.items) ? filter.items : []).slice(0, 200);
    if (definition.type === "date") {
      criteria[definition.key] = { from: text(filter.from, 10), to: text(filter.to, 10) };
    } else if (definition.type === "choice" || definition.type === "scale") {
      const ok = definition.type === "scale" ? /^(settings|\d+(\.\d+)?)$/.test(String(filter.value || "")) : (definition.options || []).some((o) => o.value === filter.value);
      if (ok) criteria[definition.key] = String(filter.value);
      else skipped.push(`Filter: ${label}`);
    } else if (definition.type === "class") {
      classes = classes || await classRows(db, context);
      const found = []; const missing = [];
      items.forEach((item) => { const row = classes.find((c) => same(c.label, item && item.label)); if (row) found.push(row.value); else missing.push(text(item && item.label)); });
      if (found.length) criteria[definition.key] = [...new Set(found)];
      if (missing.length) skipped.push(`${label}: ${missing.filter(Boolean).join(", ")}`);
    } else if (definition.type === "term") {
      terms = terms || await termRows(db, context);
      const found = []; const missing = [];
      items.forEach((item) => {
        const name = text(item && item.name); const year = text(item && item.year);
        // Same term and year first; otherwise this school's current (or latest) term of that name.
        const row = terms.find((t) => same(t.name, name) && same(t.year, year))
          || terms.filter((t) => same(t.name, name)).sort((a, b) => Number(b.isCurrent) - Number(a.isCurrent))[0];
        if (row) found.push(row.value); else missing.push([name, year].filter(Boolean).join(" · "));
      });
      if (found.length) criteria[definition.key] = [...new Set(found)];
      if (missing.length) skipped.push(`${label}: ${missing.filter(Boolean).join(", ")}`);
    } else if (definition.type === "select") {
      const rows = definition.optionsSql ? await selectRows(db, context, definition).catch(() => []) : [];
      const found = []; const missing = [];
      items.forEach((item) => {
        const row = rows.find((r) => r.value === text(item && item.value, 100)) || rows.find((r) => same(r.label, item && item.label));
        if (row) found.push(row.value); else missing.push(text(item && (item.label || item.value)));
      });
      if (found.length) criteria[definition.key] = [...new Set(found)];
      if (missing.length) skipped.push(`${label}: ${missing.filter(Boolean).join(", ")}`);
    } else {
      skipped.push(`Filter: ${label}`);
    }
  }
  return { reportType, report, columns, criteria, name: text(template.name) || text(report.title), skipped };
}

module.exports = { FORMAT, VERSION, EXTENSION, CONTENT_TYPE, buildTemplate, readTemplate };
