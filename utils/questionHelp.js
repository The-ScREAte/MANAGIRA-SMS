"use strict";
// Help on one question (feature learning_resources): a recommendation to read, a link and up to
// three files the teacher uploaded, shown to the student under that question. Stored as
// assessment_questions.help_json; files live in question-help/<school>/ so a question can only
// point at files uploaded for its own school.
const features = require("./shards/features");

const MAX_FILES = 3;
const featureOn = (organizationId) => features.isOn("learning_resources", { organizationId: Number(organizationId) || null });

// The column comes from database/migrations/2026-11-22_custom_forms_portfolio.sql; until it is
// there questions save and load exactly as before (checked again each minute).
let columnKnown = false;
let lastCheck = 0;
let checking = null;
function checkColumn() {
  if (!checking) {
    checking = require("../config/db").query(
      `SELECT COUNT(*)::int AS n FROM information_schema.columns
        WHERE table_schema = current_schema()
          AND ((table_name = 'assessment_questions' AND column_name = 'help_json')
            OR (table_name = 'assessment_question_sets' AND column_name = 'students_see_resources'))`
    ).then(({ rows }) => { columnKnown = Number(rows[0] && rows[0].n) === 2; })
      .catch(() => {})
      .finally(() => { lastCheck = Date.now(); checking = null; });
  }
  return checking;
}
function columnReady() {
  if (!columnKnown && Date.now() - lastCheck > 60000) checkColumn();
  return columnKnown;
}
async function whenChecked() {
  if (!columnKnown && Date.now() - lastCheck > 60000) await checkColumn();
  return columnKnown;
}

const clean = (value, max) => String(value == null ? "" : value).replace(/\r\n/g, "\n").trim().slice(0, max);

// What a teacher sent, made safe. Null when there is nothing to keep.
function check(raw, organizationId) {
  if (!raw || typeof raw !== "object") return null;
  const text = clean(raw.text, 2000);
  const url = clean(raw.link && raw.link.url, 1000);
  const link = /^https?:\/\/[^\s]+$/i.test(url) ? { url, label: clean(raw.link.label, 120) || "" } : null;
  const prefix = `question-help/${organizationId}/`;
  const files = (Array.isArray(raw.files) ? raw.files : [])
    .filter((file) => file && String(file.key || "").startsWith(prefix) && String(file.url || "").endsWith(String(file.key)))
    .slice(0, MAX_FILES)
    .map((file) => ({ name: clean(file.name, 200) || "File", key: String(file.key), url: String(file.url) }));
  if (!text && !link && !files.length) return null;
  return { text, link, files };
}

// What the student sees: the same, read straight from the row.
function forDisplay(value) {
  if (!value || typeof value !== "object") return null;
  const text = clean(value.text, 2000);
  const link = value.link && /^https?:\/\//i.test(String(value.link.url || "")) ? { url: String(value.link.url), label: clean(value.link.label, 120) } : null;
  const files = (Array.isArray(value.files) ? value.files : []).filter((file) => file && file.url).map((file) => ({ name: clean(file.name, 200) || "File", url: String(file.url) }));
  return text || link || files.length ? { text, link, files } : null;
}

module.exports = { featureOn, columnReady, whenChecked, check, forDisplay, MAX_FILES };
