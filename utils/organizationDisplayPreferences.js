const DEFAULT_NAME_DISPLAY_FORMAT = "first_last";
const DEFAULT_DATE_DISPLAY_FORMAT = "dd_mm_yyyy";

const ALLOWED_NAME_DISPLAY_FORMATS = new Set(["first_last", "last_first"]);
const ALLOWED_DATE_DISPLAY_FORMATS = new Set([
  "dd_mm_yyyy",
  "mm_dd_yyyy",
  "yyyy_mm_dd",
]);

let schemaReady = false;
let schemaPromise = null;

function normalizeNameDisplayFormat(value) {
  const normalized = String(value || "").trim().toLowerCase();
  return ALLOWED_NAME_DISPLAY_FORMATS.has(normalized)
    ? normalized
    : DEFAULT_NAME_DISPLAY_FORMAT;
}

function normalizeDateDisplayFormat(value) {
  const normalized = String(value || "").trim().toLowerCase();
  return ALLOWED_DATE_DISPLAY_FORMATS.has(normalized)
    ? normalized
    : DEFAULT_DATE_DISPLAY_FORMAT;
}

function pad2(value) {
  return String(value).padStart(2, "0");
}

function normalizeDateInput(value) {
  if (!value) return null;

  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return value;
  }

  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return null;
  }

  return parsed;
}

function formatDisplayNameFromParts(firstName, lastName, nameDisplayFormat) {
  const first = String(firstName || "").trim();
  const last = String(lastName || "").trim();
  const effectiveFormat = normalizeNameDisplayFormat(nameDisplayFormat);

  if (effectiveFormat === "last_first") {
    if (last && first) return `${last}, ${first}`;
    return last || first || "";
  }

  return [first, last].filter(Boolean).join(" ").trim();
}

function formatDisplayName(person = {}, nameDisplayFormat) {
  return formatDisplayNameFromParts(
    person.first_name ?? person.firstName,
    person.last_name ?? person.lastName,
    nameDisplayFormat
  );
}

function formatDisplayDate(value, dateDisplayFormat) {
  const date = normalizeDateInput(value);
  if (!date) return "";

  const year = date.getFullYear();
  const month = pad2(date.getMonth() + 1);
  const day = pad2(date.getDate());
  const effectiveFormat = normalizeDateDisplayFormat(dateDisplayFormat);

  if (effectiveFormat === "mm_dd_yyyy") return `${month}/${day}/${year}`;
  if (effectiveFormat === "yyyy_mm_dd") return `${year}/${month}/${day}`;
  return `${day}/${month}/${year}`;
}

function buildNameSortExpression(format, tableAlias = "s") {
  const alias = String(tableAlias || "s").replace(/[^a-zA-Z0-9_]/g, "") || "s";
  const effectiveFormat = normalizeNameDisplayFormat(format);

  if (effectiveFormat === "last_first") {
    return `${alias}.last_name ASC NULLS LAST, ${alias}.first_name ASC NULLS LAST`;
  }

  return `${alias}.first_name ASC NULLS LAST, ${alias}.last_name ASC NULLS LAST`;
}

async function ensureOrganizationDisplayPreferencesSchema(dbClient) {
  if (schemaReady) return;
  if (schemaPromise) {
    await schemaPromise;
    return;
  }

  schemaPromise = (async () => {
    await dbClient.query(`
      ALTER TABLE organizations
        ADD COLUMN IF NOT EXISTS name_display_format VARCHAR(20),
        ADD COLUMN IF NOT EXISTS date_display_format VARCHAR(20)
    `);

    await dbClient.query(
      `UPDATE organizations
          SET name_display_format = $1
        WHERE name_display_format IS NULL OR TRIM(name_display_format) = ''`,
      [DEFAULT_NAME_DISPLAY_FORMAT]
    );

    await dbClient.query(
      `UPDATE organizations
          SET date_display_format = $1
        WHERE date_display_format IS NULL OR TRIM(date_display_format) = ''`,
      [DEFAULT_DATE_DISPLAY_FORMAT]
    );

    schemaReady = true;
  })();

  try {
    await schemaPromise;
  } finally {
    schemaPromise = null;
  }
}

function getSessionDisplayPreferences(session = {}) {
  return {
    nameDisplayFormat: normalizeNameDisplayFormat(session.nameDisplayFormat),
    dateDisplayFormat: normalizeDateDisplayFormat(session.dateDisplayFormat),
  };
}

function applyDisplayPreferencesToSession(session = {}, row = {}) {
  session.nameDisplayFormat = normalizeNameDisplayFormat(row.name_display_format);
  session.dateDisplayFormat = normalizeDateDisplayFormat(row.date_display_format);
}

module.exports = {
  DEFAULT_NAME_DISPLAY_FORMAT,
  DEFAULT_DATE_DISPLAY_FORMAT,
  normalizeNameDisplayFormat,
  normalizeDateDisplayFormat,
  formatDisplayName,
  formatDisplayNameFromParts,
  formatDisplayDate,
  buildNameSortExpression,
  ensureOrganizationDisplayPreferencesSchema,
  getSessionDisplayPreferences,
  applyDisplayPreferencesToSession,
};
