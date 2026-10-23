// A school's own student fields (Admissions > Admission Settings > Forms).
//
// The standard student details (name, date of birth, gender, class...) never
// change. On top of them a school can add fields and choose where each one is
// asked: on the Add Student form, on the online application form, or both.
// Answers given on an application move to the student when it is approved.
//
// A field that has been answered for anyone can't be deleted or change type,
// only be made obsolete: it leaves the forms, and saved answers stay visible.

const FIELD_TYPES = {
  text: "Short text",
  long_text: "Paragraph",
  number: "Number",
  date: "Date",
  choice: "Choice list",
  yes_no: "Yes / No",
};

// Shown on the Forms tab as fixed.
const STANDARD_FIELDS = {
  student: ["First name", "Last name", "Date of birth", "Gender", "Class", "Graduation year group", "Hometown", "Address", "Email", "Photo", "Guardians"],
  application: ["First name", "Last name", "Date of birth", "Gender", "Class", "Hometown", "Email", "Photo", "Guardian"],
};

// Where a field sits on the Add Student form. Every key matches a section of
// that form; "more" is its own section after Student Information.
const SECTIONS = {
  student: "Student Information",
  more: "More Details",
  academic: "Academic Placement",
  guardian: "Guardian Details",
};
const DEFAULT_SECTION = "more";
const sectionOf = (v) => (Object.prototype.hasOwnProperty.call(SECTIONS, v) ? v : DEFAULT_SECTION);

const MAX_FIELDS = 60;
const MAX_OPTIONS = 40;

let schemaReady = false;
let schemaPromise = null;

function ensureStudentFormFieldsSchema(db) {
  if (schemaReady) return Promise.resolve();
  if (!schemaPromise) {
    schemaPromise = createSchema(db)
      .then(() => { schemaReady = true; })
      .catch((err) => { schemaPromise = null; throw err; });
  }
  return schemaPromise;
}

async function createSchema(db) {
  const client = await db.connect();
  try {
    await client.query("BEGIN");
    await client.query("SELECT pg_advisory_xact_lock(hashtext('student_form_fields_schema'))");
    await client.query(`
      CREATE TABLE IF NOT EXISTS student_form_fields (
        field_id SERIAL PRIMARY KEY,
        organization_id INTEGER NOT NULL REFERENCES organizations(organization_id) ON DELETE CASCADE,
        label VARCHAR(80) NOT NULL,
        field_type VARCHAR(20) NOT NULL DEFAULT 'text',
        options JSONB NOT NULL DEFAULT '[]'::jsonb,
        help_text VARCHAR(200),
        is_required BOOLEAN NOT NULL DEFAULT FALSE,
        on_student_form BOOLEAN NOT NULL DEFAULT TRUE,
        on_application BOOLEAN NOT NULL DEFAULT FALSE,
        position INTEGER NOT NULL DEFAULT 0,
        status VARCHAR(12) NOT NULL DEFAULT 'active',
        created_by INTEGER,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )`);
    await client.query(`ALTER TABLE student_form_fields ADD COLUMN IF NOT EXISTS section VARCHAR(20) NOT NULL DEFAULT 'more'`);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_student_form_fields_org ON student_form_fields (organization_id, position)`);
    await client.query(`
      CREATE TABLE IF NOT EXISTS student_field_values (
        field_id INTEGER NOT NULL REFERENCES student_form_fields(field_id) ON DELETE CASCADE,
        student_id INTEGER NOT NULL,
        organization_id INTEGER NOT NULL,
        value TEXT NOT NULL,
        updated_by INTEGER,
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        PRIMARY KEY (field_id, student_id)
      )`);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_student_field_values_student ON student_field_values (student_id)`);
    await client.query(`
      CREATE TABLE IF NOT EXISTS application_field_values (
        field_id INTEGER NOT NULL REFERENCES student_form_fields(field_id) ON DELETE CASCADE,
        pending_id INTEGER NOT NULL,
        organization_id INTEGER NOT NULL,
        value TEXT NOT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        PRIMARY KEY (field_id, pending_id)
      )`);
    await client.query("COMMIT");
  } catch (err) {
    await client.query("ROLLBACK").catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

class FieldError extends Error {
  constructor(message, status = 400) {
    super(message);
    this.status = status;
  }
}

const clean = (value, max) => String(value == null ? "" : value).replace(/\s+/g, " ").trim().slice(0, max);
const truthy = (v) => v === true || v === "true" || v === "on" || v === "1" || v === 1;

function toField(r) {
  return {
    id: r.field_id,
    label: r.label,
    type: r.field_type,
    typeLabel: FIELD_TYPES[r.field_type] || "Short text",
    options: Array.isArray(r.options) ? r.options : [],
    helpText: r.help_text || "",
    required: r.is_required,
    onStudentForm: r.on_student_form,
    onApplication: r.on_application,
    section: sectionOf(r.section),
    status: r.status,
    used: Number(r.used || 0),
  };
}

// ---------- Template (Forms tab) ----------

async function listFields(db, organizationId) {
  await ensureStudentFormFieldsSchema(db);
  const { rows } = await db.query(
    `SELECT f.*,
            (SELECT COUNT(*)::int FROM student_field_values v WHERE v.field_id = f.field_id)
          + (SELECT COUNT(*)::int FROM application_field_values a WHERE a.field_id = f.field_id) AS used
       FROM student_form_fields f
      WHERE f.organization_id = $1
      ORDER BY f.position, f.field_id`,
    [organizationId]
  );
  return rows.map(toField);
}

// Fields asked on one form ("student" or "application"), active only.
async function formFields(db, organizationId, form) {
  if (!organizationId) return [];
  await ensureStudentFormFieldsSchema(db);
  const column = form === "application" ? "on_application" : "on_student_form";
  const { rows } = await db.query(
    `SELECT * FROM student_form_fields
      WHERE organization_id = $1 AND status = 'active' AND ${column} = TRUE
      ORDER BY position, field_id`,
    [organizationId]
  );
  return rows.map(toField);
}

function readFieldInput(body) {
  const label = clean(body.label, 80);
  if (!label) throw new FieldError("Give the field a name.");
  const type = Object.prototype.hasOwnProperty.call(FIELD_TYPES, body.type) ? body.type : "text";
  let options = [];
  if (type === "choice") {
    const raw = Array.isArray(body.options) ? body.options : String(body.options || "").split(/\r?\n|,/);
    const seen = new Set();
    options = raw.map((o) => clean(o, 80)).filter((o) => o && !seen.has(o.toLowerCase()) && seen.add(o.toLowerCase())).slice(0, MAX_OPTIONS);
    if (options.length < 2) throw new FieldError("A choice list needs at least two options.");
  }
  const onStudentForm = truthy(body.onStudentForm);
  const onApplication = truthy(body.onApplication);
  if (!onStudentForm && !onApplication) throw new FieldError("Choose at least one form to show this field on.");
  return { label, type, options, helpText: clean(body.helpText, 200) || null, required: truthy(body.required), onStudentForm, onApplication, section: sectionOf(body.section) };
}

async function assertLabelFree(db, organizationId, label, exceptId) {
  const standard = [...new Set([...STANDARD_FIELDS.student, ...STANDARD_FIELDS.application])]
    .find((name) => name.toLowerCase() === label.toLowerCase());
  if (standard) throw new FieldError(`"${standard}" is already a standard field on the forms.`);
  const dup = await db.query(
    `SELECT 1 FROM student_form_fields WHERE organization_id = $1 AND LOWER(label) = LOWER($2) AND field_id <> $3 LIMIT 1`,
    [organizationId, label, exceptId || 0]
  );
  if (dup.rowCount) throw new FieldError(`There is already a field called "${label}".`);
}

async function getField(db, organizationId, fieldId) {
  const { rows } = await db.query(
    `SELECT f.*,
            EXISTS (SELECT 1 FROM student_field_values v WHERE v.field_id = f.field_id)
         OR EXISTS (SELECT 1 FROM application_field_values a WHERE a.field_id = f.field_id) AS in_use
       FROM student_form_fields f WHERE f.field_id = $1 AND f.organization_id = $2`,
    [fieldId, organizationId]
  );
  if (!rows.length) throw new FieldError("That field no longer exists.", 404);
  return rows[0];
}

async function createField(db, organizationId, body, userId) {
  await ensureStudentFormFieldsSchema(db);
  const f = readFieldInput(body);
  const count = await db.query(`SELECT COUNT(*)::int AS n, COALESCE(MAX(position), 0) AS last FROM student_form_fields WHERE organization_id = $1`, [organizationId]);
  if (count.rows[0].n >= MAX_FIELDS) throw new FieldError(`You can have up to ${MAX_FIELDS} fields.`);
  await assertLabelFree(db, organizationId, f.label);
  await db.query(
    `INSERT INTO student_form_fields (organization_id, label, field_type, options, help_text, is_required, on_student_form, on_application, position, created_by, section)
     VALUES ($1, $2, $3, $4::jsonb, $5, $6, $7, $8, $9, $10, $11)`,
    [organizationId, f.label, f.type, JSON.stringify(f.options), f.helpText, f.required, f.onStudentForm, f.onApplication, count.rows[0].last + 1, userId || null, f.section]
  );
}

// Name, help text, required, where it's asked and choices can change any time.
// The type is fixed once someone has answered, and choices already used stay.
async function updateField(db, organizationId, fieldId, body) {
  await ensureStudentFormFieldsSchema(db);
  const field = await getField(db, organizationId, fieldId);
  const f = readFieldInput({ ...body, type: body.type || field.field_type });
  if (field.in_use && f.type !== field.field_type) {
    throw new FieldError("This field already has answers, so its type can't change. Make it obsolete and add a new field instead.");
  }
  if (field.in_use && f.type === "choice") {
    const used = await db.query(
      `SELECT value FROM student_field_values WHERE field_id = $1 UNION SELECT value FROM application_field_values WHERE field_id = $1`,
      [fieldId]
    );
    const keep = new Set(f.options.map((o) => o.toLowerCase()));
    const missing = used.rows.map((r) => r.value).filter((v) => !keep.has(String(v).toLowerCase()));
    if (missing.length) throw new FieldError(`Keep the options already chosen for some students: ${missing.slice(0, 5).join(", ")}.`);
  }
  await assertLabelFree(db, organizationId, f.label, fieldId);
  await db.query(
    `UPDATE student_form_fields
        SET label = $3, field_type = $4, options = $5::jsonb, help_text = $6, is_required = $7,
            on_student_form = $8, on_application = $9, section = $10, updated_at = NOW()
      WHERE field_id = $1 AND organization_id = $2`,
    [fieldId, organizationId, f.label, f.type, JSON.stringify(f.options), f.helpText, f.required, f.onStudentForm, f.onApplication, f.section]
  );
}

async function setFieldStatus(db, organizationId, fieldId, status) {
  await ensureStudentFormFieldsSchema(db);
  if (!["active", "obsolete"].includes(status)) throw new FieldError("Unknown status.");
  await getField(db, organizationId, fieldId);
  await db.query(`UPDATE student_form_fields SET status = $3, updated_at = NOW() WHERE field_id = $1 AND organization_id = $2`, [fieldId, organizationId, status]);
}

async function deleteField(db, organizationId, fieldId) {
  await ensureStudentFormFieldsSchema(db);
  const field = await getField(db, organizationId, fieldId);
  if (field.in_use) throw new FieldError("This field has answers saved, so it can only be made obsolete.", 409);
  await db.query(`DELETE FROM student_form_fields WHERE field_id = $1 AND organization_id = $2`, [fieldId, organizationId]);
}

// ids: the new order. sections (optional): { fieldId: section } for fields
// dragged into another section of the form.
async function saveOrder(db, organizationId, ids, sections) {
  await ensureStudentFormFieldsSchema(db);
  const list = (Array.isArray(ids) ? ids : []).map(Number).filter((n) => Number.isInteger(n) && n > 0);
  if (!list.length) return;
  const map = sections && typeof sections === "object" ? sections : {};
  const secs = list.map((id) => (map[id] != null ? sectionOf(map[id]) : null));
  await db.query(
    `UPDATE student_form_fields f SET position = o.pos, section = COALESCE(o.sec, f.section)
       FROM unnest($2::int[], $3::text[]) WITH ORDINALITY AS o(id, sec, pos)
      WHERE f.field_id = o.id AND f.organization_id = $1`,
    [organizationId, list, secs]
  );
}

// ---------- Answers ----------

function checkAnswer(field, raw) {
  const value = String(raw == null ? "" : raw).trim();
  if (!value) {
    if (field.required) throw new FieldError(`"${field.label}" is required.`);
    return "";
  }
  switch (field.type) {
    case "long_text": return value.slice(0, 4000);
    case "number":
      if (!/^-?\d+(\.\d+)?$/.test(value)) throw new FieldError(`"${field.label}" needs a number.`);
      return value;
    case "date":
      if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new FieldError(`"${field.label}" needs a date.`);
      return value;
    case "choice": {
      const match = field.options.find((o) => o.toLowerCase() === value.toLowerCase());
      if (!match) throw new FieldError(`Pick one of the options for "${field.label}".`);
      return match;
    }
    case "yes_no":
      if (!["yes", "no"].includes(value.toLowerCase())) throw new FieldError(`Answer yes or no for "${field.label}".`);
      return value.toLowerCase();
    default: return clean(value, 500);
  }
}

// Reads and checks answers for `fields`; `get(name)` returns the posted value
// for a field input named "cf<fieldId>". Throws FieldError on a bad answer.
// Fields the form didn't send are left alone (e.g. a bulk import), unless
// `strict` (the public application, where required fields must be answered).
function readAnswers(fields, get, { strict = false } = {}) {
  return fields
    .filter((f) => strict || get(`cf${f.id}`) !== undefined)
    .map((f) => ({ id: f.id, value: checkAnswer(f, get(`cf${f.id}`)) }));
}

async function saveStudentAnswers(db, organizationId, studentId, answers, userId) {
  const set = answers.filter((a) => a.value);
  const clear = answers.filter((a) => !a.value).map((a) => a.id);
  if (clear.length) {
    await db.query(`DELETE FROM student_field_values WHERE student_id = $1 AND field_id = ANY($2::int[])`, [studentId, clear]);
  }
  if (set.length) {
    await db.query(
      `INSERT INTO student_field_values (field_id, student_id, organization_id, value, updated_by, updated_at)
       SELECT a.field_id, $1, $2, a.value, $3, NOW() FROM unnest($4::int[], $5::text[]) AS a(field_id, value)
       ON CONFLICT (field_id, student_id) DO UPDATE SET value = EXCLUDED.value, updated_by = EXCLUDED.updated_by, updated_at = NOW()`,
      [studentId, organizationId, userId || null, set.map((a) => a.id), set.map((a) => a.value)]
    );
  }
}

async function saveApplicationAnswers(db, organizationId, pendingId, answers) {
  const set = answers.filter((a) => a.value);
  if (!set.length) return;
  await db.query(
    `INSERT INTO application_field_values (field_id, pending_id, organization_id, value)
     SELECT a.field_id, $1, $2, a.value FROM unnest($3::int[], $4::text[]) AS a(field_id, value)
     ON CONFLICT (field_id, pending_id) DO UPDATE SET value = EXCLUDED.value`,
    [pendingId, organizationId, set.map((a) => a.id), set.map((a) => a.value)]
  );
}

// On approval: the application's answers become the student's. `db` may be a
// transaction's client, so the tables must already exist (ensure them first).
async function copyApplicationAnswers(db, organizationId, pendingId, studentId) {
  await db.query(
    `INSERT INTO student_field_values (field_id, student_id, organization_id, value)
     SELECT field_id, $2, $3, value FROM application_field_values WHERE pending_id = $1 AND organization_id = $3
     ON CONFLICT (field_id, student_id) DO NOTHING`,
    [pendingId, studentId, organizationId]
  );
}

const displayValue = (type, value) => {
  if (!value) return "";
  if (type === "yes_no") return value === "yes" ? "Yes" : "No";
  if (type === "date") {
    const d = new Date(`${value}T00:00:00`);
    return Number.isNaN(d.getTime()) ? value : d.toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" });
  }
  return value;
};

// Fields with this student's (or application's) answers: active ones on that
// form, plus obsolete or other-form fields that have an answer.
async function answersFor(db, organizationId, { studentId, pendingId }, form) {
  await ensureStudentFormFieldsSchema(db);
  const table = pendingId ? "application_field_values" : "student_field_values";
  const key = pendingId ? "pending_id" : "student_id";
  const column = form === "application" ? "on_application" : "on_student_form";
  const { rows } = await db.query(
    `SELECT f.*, v.value
       FROM student_form_fields f
       LEFT JOIN ${table} v ON v.field_id = f.field_id AND v.${key} = $2
      WHERE f.organization_id = $1
        AND ((f.status = 'active' AND f.${column}) OR v.value IS NOT NULL)
      ORDER BY f.position, f.field_id`,
    [organizationId, pendingId || studentId]
  );
  return rows.map((r) => ({ ...toField(r), value: r.value || "", display: displayValue(r.field_type, r.value || "") }));
}

module.exports = {
  FIELD_TYPES,
  STANDARD_FIELDS,
  FieldError,
  SECTIONS,
  DEFAULT_SECTION,
  ensureStudentFormFieldsSchema,
  listFields,
  formFields,
  createField,
  updateField,
  setFieldStatus,
  deleteField,
  saveOrder,
  readAnswers,
  saveStudentAnswers,
  saveApplicationAnswers,
  copyApplicationAnswers,
  answersFor,
};
