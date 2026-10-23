// Contact cards for parents and guardians (opened from the Mail Room contact
// list) and the school's contact template.
//
// Every contact has the same base details (name, phone, email, address,
// hometown, date of birth). Those never change shape. A school can add its
// own fields on top in the contact template (Management Tools). A field that
// has been filled in for anyone can't be deleted, only made obsolete: it stops
// appearing on the edit form, but the answers already saved stay on the cards.
//
// A contact can be stored more than once (a guardian_profiles row and older
// per-child guardians rows), so a card is addressed by all of its directory
// keys ("profile:12", "legacy:40"). Custom answers are written to each key and
// read back from whichever was saved last.
//
// Fields can be grouped into sections; each section is a tab on the contact
// card. Fields without a section show under "More details".

const FIELD_TYPES = {
  text: "Short text",
  long_text: "Paragraph",
  number: "Number",
  date: "Date",
  choice: "Choice list",
  yes_no: "Yes / No",
};

// The base details every contact has. Shown on the template page as fixed.
const BASE_FIELDS = [
  { key: "firstName", label: "First name", required: true },
  { key: "lastName", label: "Last name", required: true },
  { key: "phone", label: "Phone", note: "Phone or email is required" },
  { key: "email", label: "Email", note: "Phone or email is required" },
  { key: "address", label: "Address" },
  { key: "hometown", label: "Hometown" },
  { key: "dateOfBirth", label: "Date of birth" },
];

const MAX_FIELDS = 60;
const MAX_SECTIONS = 12;
// Tab names the card already uses.
const RESERVED_SECTION_NAMES = ["contact info", "children", "more details"];
const MAX_OPTIONS = 40;

let schemaReady = false;
let schemaPromise = null;

function ensureContactsSchema(db) {
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
    await client.query("SELECT pg_advisory_xact_lock(hashtext('contacts_schema'))");
    await client.query(`
      CREATE TABLE IF NOT EXISTS contact_fields (
        field_id SERIAL PRIMARY KEY,
        organization_id INTEGER NOT NULL REFERENCES organizations(organization_id) ON DELETE CASCADE,
        label VARCHAR(80) NOT NULL,
        field_type VARCHAR(20) NOT NULL DEFAULT 'text',
        options JSONB NOT NULL DEFAULT '[]'::jsonb,
        help_text VARCHAR(200),
        position INTEGER NOT NULL DEFAULT 0,
        status VARCHAR(12) NOT NULL DEFAULT 'active',
        created_by INTEGER,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )`);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_contact_fields_org ON contact_fields (organization_id, position)`);
    await client.query(`
      CREATE TABLE IF NOT EXISTS contact_field_sections (
        section_id SERIAL PRIMARY KEY,
        organization_id INTEGER NOT NULL REFERENCES organizations(organization_id) ON DELETE CASCADE,
        name VARCHAR(60) NOT NULL,
        position INTEGER NOT NULL DEFAULT 0,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )`);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_contact_field_sections_org ON contact_field_sections (organization_id, position)`);
    await client.query(`ALTER TABLE contact_fields ADD COLUMN IF NOT EXISTS section_id INTEGER REFERENCES contact_field_sections(section_id) ON DELETE SET NULL`);
    await client.query(`
      CREATE TABLE IF NOT EXISTS contact_field_values (
        field_id INTEGER NOT NULL REFERENCES contact_fields(field_id) ON DELETE CASCADE,
        organization_id INTEGER NOT NULL,
        contact_key VARCHAR(40) NOT NULL,
        value TEXT NOT NULL,
        updated_by INTEGER,
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        PRIMARY KEY (field_id, contact_key)
      )`);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_contact_field_values_contact ON contact_field_values (organization_id, contact_key)`);
    await client.query("COMMIT");
  } catch (err) {
    await client.query("ROLLBACK").catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

class ContactError extends Error {
  constructor(message, status = 400) {
    super(message);
    this.status = status;
  }
}

const clean = (value, max) => String(value == null ? "" : value).replace(/\s+/g, " ").trim().slice(0, max);

// "profile:12" / "legacy:40" -> { source, id }
function parseKey(key) {
  const m = /^(profile|legacy):(\d+)$/.exec(String(key || "").trim());
  return m ? { key: `${m[1]}:${m[2]}`, source: m[1], id: Number(m[2]) } : null;
}

function parseKeys(raw) {
  const list = Array.isArray(raw) ? raw : String(raw || "").split(",");
  const seen = new Map();
  list.map(parseKey).filter(Boolean).forEach((k) => seen.set(k.key, k));
  return [...seen.values()].slice(0, 20);
}

// ---------- Template ----------

function readFieldInput(body) {
  const label = clean(body.label, 80);
  if (!label) throw new ContactError("Give the field a name.");
  const type = Object.prototype.hasOwnProperty.call(FIELD_TYPES, body.type) ? body.type : "text";
  let options = [];
  if (type === "choice") {
    const raw = Array.isArray(body.options) ? body.options : String(body.options || "").split(/\r?\n|,/);
    const seen = new Set();
    options = raw.map((o) => clean(o, 80)).filter((o) => o && !seen.has(o.toLowerCase()) && seen.add(o.toLowerCase())).slice(0, MAX_OPTIONS);
    if (options.length < 2) throw new ContactError("A choice list needs at least two options.");
  }
  const sectionId = Number(body.sectionId) > 0 ? Number(body.sectionId) : null;
  return { label, type, options, helpText: clean(body.helpText, 200) || null, sectionId };
}

async function assertSection(db, organizationId, sectionId) {
  if (!sectionId) return null;
  const r = await db.query(`SELECT 1 FROM contact_field_sections WHERE section_id = $1 AND organization_id = $2`, [sectionId, organizationId]);
  if (!r.rowCount) throw new ContactError("That section no longer exists.", 404);
  return sectionId;
}

async function listFields(db, organizationId) {
  await ensureContactsSchema(db);
  const { rows } = await db.query(
    `SELECT f.field_id, f.label, f.field_type, f.options, f.help_text, f.position, f.status, f.updated_at, f.section_id,
            (SELECT COUNT(DISTINCT v.contact_key)::int FROM contact_field_values v WHERE v.field_id = f.field_id) AS used
       FROM contact_fields f
      WHERE f.organization_id = $1
      ORDER BY f.position, f.field_id`,
    [organizationId]
  );
  return rows.map((r) => ({
    id: r.field_id, label: r.label, type: r.field_type, typeLabel: FIELD_TYPES[r.field_type] || "Short text",
    options: Array.isArray(r.options) ? r.options : [], helpText: r.help_text || "",
    status: r.status, used: r.used, sectionId: r.section_id || null,
  }));
}

async function listSections(db, organizationId) {
  await ensureContactsSchema(db);
  const { rows } = await db.query(
    `SELECT section_id, name FROM contact_field_sections WHERE organization_id = $1 ORDER BY position, section_id`,
    [organizationId]
  );
  return rows.map((r) => ({ id: r.section_id, name: r.name }));
}

async function getTemplate(db, organizationId) {
  const [sections, fields] = await Promise.all([listSections(db, organizationId), listFields(db, organizationId)]);
  return { sections, fields };
}

function readSectionName(body) {
  const name = clean(body && body.name, 60);
  if (!name) throw new ContactError("Give the section a name.");
  if (RESERVED_SECTION_NAMES.includes(name.toLowerCase())) throw new ContactError(`"${name}" is already a tab on every contact card.`);
  return name;
}

async function assertSectionNameFree(db, organizationId, name, exceptId) {
  const dup = await db.query(
    `SELECT 1 FROM contact_field_sections WHERE organization_id = $1 AND LOWER(name) = LOWER($2) AND section_id <> $3 LIMIT 1`,
    [organizationId, name, exceptId || 0]
  );
  if (dup.rowCount) throw new ContactError(`There is already a section called "${name}".`);
}

async function createSection(db, organizationId, body) {
  await ensureContactsSchema(db);
  const name = readSectionName(body);
  const count = await db.query(`SELECT COUNT(*)::int AS n, COALESCE(MAX(position), 0) AS last FROM contact_field_sections WHERE organization_id = $1`, [organizationId]);
  if (count.rows[0].n >= MAX_SECTIONS) throw new ContactError(`A template can have up to ${MAX_SECTIONS} sections.`);
  await assertSectionNameFree(db, organizationId, name);
  const { rows } = await db.query(
    `INSERT INTO contact_field_sections (organization_id, name, position) VALUES ($1, $2, $3) RETURNING section_id`,
    [organizationId, name, count.rows[0].last + 1]
  );
  return rows[0].section_id;
}

async function renameSection(db, organizationId, sectionId, body) {
  await ensureContactsSchema(db);
  const name = readSectionName(body);
  await assertSection(db, organizationId, sectionId);
  await assertSectionNameFree(db, organizationId, name, sectionId);
  await db.query(`UPDATE contact_field_sections SET name = $3 WHERE section_id = $1 AND organization_id = $2`, [sectionId, organizationId, name]);
}

// Deleting a section never loses fields: they move to "More details".
async function deleteSection(db, organizationId, sectionId) {
  await ensureContactsSchema(db);
  await assertSection(db, organizationId, sectionId);
  await db.query(`UPDATE contact_fields SET section_id = NULL WHERE section_id = $1 AND organization_id = $2`, [sectionId, organizationId]);
  await db.query(`DELETE FROM contact_field_sections WHERE section_id = $1 AND organization_id = $2`, [sectionId, organizationId]);
}

// The whole layout after a drag: section order, and each field's section and place.
async function saveOrder(db, organizationId, body) {
  await ensureContactsSchema(db);
  const { sections, fields } = await getTemplate(db, organizationId);
  const sectionIds = new Set(sections.map((x) => x.id));
  const fieldIds = new Set(fields.map((x) => x.id));
  const orderSections = (Array.isArray(body.sections) ? body.sections : []).map(Number).filter((id) => sectionIds.has(id));
  const orderFields = (Array.isArray(body.fields) ? body.fields : [])
    .map((f) => ({ id: Number(f && f.id), sectionId: Number(f && f.sectionId) || null }))
    .filter((f) => fieldIds.has(f.id) && (f.sectionId === null || sectionIds.has(f.sectionId)));
  if (orderSections.length) {
    await db.query(
      `UPDATE contact_field_sections s SET position = o.pos
         FROM unnest($2::int[]) WITH ORDINALITY AS o(id, pos)
        WHERE s.section_id = o.id AND s.organization_id = $1`,
      [organizationId, orderSections]
    );
  }
  if (orderFields.length) {
    await db.query(
      `UPDATE contact_fields f SET position = o.pos, section_id = NULLIF(o.section_id, 0), updated_at = NOW()
         FROM unnest($2::int[], $3::int[]) WITH ORDINALITY AS o(id, section_id, pos)
        WHERE f.field_id = o.id AND f.organization_id = $1`,
      [organizationId, orderFields.map((f) => f.id), orderFields.map((f) => f.sectionId || 0)]
    );
  }
}

async function assertLabelFree(db, organizationId, label, exceptId) {
  const base = BASE_FIELDS.find((f) => f.label.toLowerCase() === label.toLowerCase());
  if (base) throw new ContactError(`"${base.label}" is already a standard detail on every contact.`);
  const dup = await db.query(
    `SELECT 1 FROM contact_fields WHERE organization_id = $1 AND LOWER(label) = LOWER($2) AND field_id <> $3 LIMIT 1`,
    [organizationId, label, exceptId || 0]
  );
  if (dup.rowCount) throw new ContactError(`There is already a field called "${label}".`);
}

async function createField(db, organizationId, body, userId) {
  await ensureContactsSchema(db);
  const f = readFieldInput(body);
  const count = await db.query(`SELECT COUNT(*)::int AS n, COALESCE(MAX(position), 0) AS last FROM contact_fields WHERE organization_id = $1`, [organizationId]);
  if (count.rows[0].n >= MAX_FIELDS) throw new ContactError(`A template can have up to ${MAX_FIELDS} fields.`);
  await assertLabelFree(db, organizationId, f.label);
  await assertSection(db, organizationId, f.sectionId);
  const { rows } = await db.query(
    `INSERT INTO contact_fields (organization_id, label, field_type, options, help_text, position, created_by, section_id)
     VALUES ($1, $2, $3, $4::jsonb, $5, $6, $7, $8) RETURNING field_id`,
    [organizationId, f.label, f.type, JSON.stringify(f.options), f.helpText, count.rows[0].last + 1, userId || null, f.sectionId]
  );
  return rows[0].field_id;
}

async function getField(db, organizationId, fieldId) {
  const { rows } = await db.query(
    `SELECT f.*, EXISTS (SELECT 1 FROM contact_field_values v WHERE v.field_id = f.field_id) AS in_use
       FROM contact_fields f WHERE f.field_id = $1 AND f.organization_id = $2`,
    [fieldId, organizationId]
  );
  if (!rows.length) throw new ContactError("That field no longer exists.", 404);
  return rows[0];
}

// Name, help text and choices can always change. The type can change only
// while nobody has an answer saved, so saved answers always fit their field.
// Choices that saved answers use can't be removed.
async function updateField(db, organizationId, fieldId, body) {
  await ensureContactsSchema(db);
  const field = await getField(db, organizationId, fieldId);
  const f = readFieldInput({ ...body, type: body.type || field.field_type });
  if (field.in_use && f.type !== field.field_type) {
    throw new ContactError("This field already has answers, so its type can't change. Make it obsolete and add a new field instead.");
  }
  if (field.in_use && f.type === "choice") {
    const used = await db.query(`SELECT DISTINCT value FROM contact_field_values WHERE field_id = $1`, [fieldId]);
    const keep = new Set(f.options.map((o) => o.toLowerCase()));
    const missing = used.rows.map((r) => r.value).filter((v) => !keep.has(String(v).toLowerCase()));
    if (missing.length) throw new ContactError(`Keep the options already chosen for some contacts: ${missing.slice(0, 5).join(", ")}.`);
  }
  await assertLabelFree(db, organizationId, f.label, fieldId);
  await assertSection(db, organizationId, f.sectionId);
  await db.query(
    `UPDATE contact_fields SET label = $3, field_type = $4, options = $5::jsonb, help_text = $6, section_id = $7, updated_at = NOW()
      WHERE field_id = $1 AND organization_id = $2`,
    [fieldId, organizationId, f.label, f.type, JSON.stringify(f.options), f.helpText, f.sectionId]
  );
}

async function setFieldStatus(db, organizationId, fieldId, status) {
  await ensureContactsSchema(db);
  if (!["active", "obsolete"].includes(status)) throw new ContactError("Unknown status.");
  await getField(db, organizationId, fieldId);
  await db.query(`UPDATE contact_fields SET status = $3, updated_at = NOW() WHERE field_id = $1 AND organization_id = $2`, [fieldId, organizationId, status]);
}

async function deleteField(db, organizationId, fieldId) {
  await ensureContactsSchema(db);
  const field = await getField(db, organizationId, fieldId);
  if (field.in_use) throw new ContactError("This field has answers saved for some contacts, so it can only be made obsolete.", 409);
  await db.query(
    `DELETE FROM contact_fields f WHERE f.field_id = $1 AND f.organization_id = $2
        AND NOT EXISTS (SELECT 1 FROM contact_field_values v WHERE v.field_id = f.field_id)`,
    [fieldId, organizationId]
  );
}

// ---------- Contact cards ----------

async function readContact(db, organizationId, keys) {
  await ensureContactsSchema(db);
  const profileIds = keys.filter((k) => k.source === "profile").map((k) => k.id);
  const legacyIds = keys.filter((k) => k.source === "legacy").map((k) => k.id);
  const [profiles, legacy, linkedViaProfile, { sections, fields }, values] = await Promise.all([
    profileIds.length
      ? db.query(`SELECT guardian_id, first_name, last_name, phone, email, address, hometown, date_of_birth, image_url, updated_at
                    FROM guardian_profiles WHERE organization_id = $1 AND guardian_id = ANY($2::int[]) ORDER BY guardian_id`, [organizationId, profileIds])
      : { rows: [] },
    legacyIds.length
      ? db.query(`SELECT g.guardian_id, g.first_name, g.last_name, g.phone, g.email, g.address, g.hometown, g.date_of_birth, g.image_url,
                         s.student_id, s.first_name AS s_first, s.last_name AS s_last, c.class_name
                    FROM guardians g
                    LEFT JOIN students s ON s.student_id = g.student_id AND s.organization_id = $1
                    LEFT JOIN classes c ON c.class_id = s.class_id AND c.organization_id = $1
                   WHERE g.organization_id = $1 AND g.guardian_id = ANY($2::int[]) ORDER BY g.guardian_id`, [organizationId, legacyIds])
      : { rows: [] },
    profileIds.length
      ? db.query(`SELECT gs.relationship, s.student_id, s.first_name AS s_first, s.last_name AS s_last, c.class_name
                    FROM guardian_students gs
                    JOIN students s ON s.student_id = gs.student_id AND s.organization_id = $1
                    LEFT JOIN classes c ON c.class_id = s.class_id AND c.organization_id = $1
                   WHERE gs.guardian_id = ANY($2::int[])`, [organizationId, profileIds])
      : { rows: [] },
    getTemplate(db, organizationId),
    db.query(
      `SELECT DISTINCT ON (field_id) field_id, value, updated_at
         FROM contact_field_values
        WHERE organization_id = $1 AND contact_key = ANY($2::text[])
        ORDER BY field_id, updated_at DESC`,
      [organizationId, keys.map((k) => k.key)]
    ),
  ]);

  const base = profiles.rows[0] || legacy.rows[0];
  if (!base) throw new ContactError("This contact could not be found.", 404);

  const students = new Map();
  [...linkedViaProfile.rows, ...legacy.rows].forEach((r) => {
    if (!r.student_id || students.has(r.student_id)) return;
    students.set(r.student_id, {
      id: r.student_id,
      name: [r.s_first, r.s_last].filter(Boolean).join(" "),
      className: r.class_name || "",
      relationship: r.relationship || "",
    });
  });

  const answer = new Map(values.rows.map((v) => [v.field_id, v.value]));
  const dob = base.date_of_birth ? new Date(base.date_of_birth) : null;
  return {
    keys: keys.map((k) => k.key),
    base: {
      firstName: base.first_name || "",
      lastName: base.last_name || "",
      phone: base.phone || "",
      email: base.email || "",
      address: base.address || "",
      hometown: base.hometown || "",
      dateOfBirth: dob && !Number.isNaN(dob.getTime())
        ? `${dob.getFullYear()}-${String(dob.getMonth() + 1).padStart(2, "0")}-${String(dob.getDate()).padStart(2, "0")}`
        : "",
      imageUrl: base.image_url || "",
    },
    students: [...students.values()].sort((a, b) => a.name.localeCompare(b.name)),
    sections,
    // Active fields always; obsolete ones only where this contact has an answer.
    fields: fields
      .filter((f) => f.status === "active" || answer.has(f.id))
      .map((f) => ({ id: f.id, label: f.label, type: f.type, options: f.options, helpText: f.helpText, sectionId: f.sectionId, obsolete: f.status !== "active", value: answer.get(f.id) || "" })),
  };
}

function checkAnswer(field, raw) {
  const value = String(raw == null ? "" : raw).trim();
  if (!value) return "";
  switch (field.field_type) {
    case "long_text": return value.slice(0, 4000);
    case "number":
      if (!/^-?\d+(\.\d+)?$/.test(value)) throw new ContactError(`"${field.label}" needs a number.`);
      return value;
    case "date":
      if (!/^\d{4}-\d{2}-\d{2}$/.test(value) || Number.isNaN(new Date(`${value}T00:00:00Z`).getTime())) throw new ContactError(`"${field.label}" needs a date.`);
      return value;
    case "choice": {
      const match = (Array.isArray(field.options) ? field.options : []).find((o) => o.toLowerCase() === value.toLowerCase());
      if (!match) throw new ContactError(`Pick one of the options for "${field.label}".`);
      return match;
    }
    case "yes_no":
      if (!["yes", "no"].includes(value.toLowerCase())) throw new ContactError(`Answer yes or no for "${field.label}".`);
      return value.toLowerCase();
    default: return clean(value, 500);
  }
}

function readBaseInput(body) {
  const b = body || {};
  const base = {
    firstName: clean(b.firstName, 100),
    lastName: clean(b.lastName, 100),
    phone: clean(b.phone, 40),
    email: clean(b.email, 160).toLowerCase(),
    address: clean(b.address, 300),
    hometown: clean(b.hometown, 120),
    dateOfBirth: clean(b.dateOfBirth, 10),
  };
  if (!base.firstName || !base.lastName) throw new ContactError("First and last name are required.");
  if (!base.phone && !base.email) throw new ContactError("Add a phone number or an email address.");
  if (base.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(base.email)) throw new ContactError("Check the email address.");
  if (base.phone && base.phone.replace(/\D/g, "").length < 7) throw new ContactError("Check the phone number.");
  if (base.dateOfBirth && !/^\d{4}-\d{2}-\d{2}$/.test(base.dateOfBirth)) throw new ContactError("Check the date of birth.");
  return base;
}

// Saves a guardian's base details and keeps the other copies in step: the
// portal login (guardian_accounts) and the guardian stored under the other
// table, matched by the name it had before. Used by the guardian page
// (Management > Parents & guardians) and by contact cards.
async function saveGuardianBaseInfo(db, { organizationId, guardianId, source, firstName, lastName, email, phone, address, hometown, dateOfBirth, imageUrl }) {
  const cleanedPhone = phone ? String(phone).replace(/[^\d+]/g, "") : null;

  if (source === "profile") {
    const oldProfileRow = (await db.query(
      `SELECT first_name, last_name FROM guardian_profiles WHERE guardian_id=$1 AND organization_id=$2`,
      [guardianId, organizationId]
    )).rows[0];

    const updateProfileQuery = imageUrl
      ? `UPDATE guardian_profiles
         SET first_name = $1, last_name = $2, email = $3, phone = $4,
         address = $5, hometown = $6, date_of_birth = $7, image_url = $8, updated_at = NOW()
       WHERE guardian_id = $9 AND organization_id = $10`
      : `UPDATE guardian_profiles
         SET first_name = $1, last_name = $2, email = $3, phone = $4,
         address = $5, hometown = $6, date_of_birth = $7, updated_at = NOW()
       WHERE guardian_id = $8 AND organization_id = $9`;

    const profileParams = imageUrl
      ? [firstName, lastName, email || null, phone || null, address, hometown, dateOfBirth || null, imageUrl, guardianId, organizationId]
      : [firstName, lastName, email || null, phone || null, address, hometown, dateOfBirth || null, guardianId, organizationId];

    await db.query(updateProfileQuery, profileParams);
    await db.query(
      `UPDATE guardian_accounts
       SET login_email = $1, login_phone = $2, updated_at = NOW()
       WHERE guardian_id = $3 AND organization_id = $4`,
      [email || null, cleanedPhone, guardianId, organizationId]
    );

    // Sync to legacy guardians table (name-based match using old name)
    if (oldProfileRow) {
      await db.query(
        `UPDATE guardians
           SET first_name = $1, last_name = $2, email = $3, phone = $4, address = $5, hometown = $6, date_of_birth = $7
         WHERE organization_id = $8
           AND LOWER(TRIM(first_name)) = LOWER(TRIM($9))
           AND LOWER(TRIM(last_name))  = LOWER(TRIM($10))`,
        [firstName, lastName, email || null, phone || null, address, hometown, dateOfBirth || null,
          organizationId, oldProfileRow.first_name, oldProfileRow.last_name]
      );
    }
    return;
  }

  // Read old guardian data so we can cross-sync guardian_profiles / guardian_accounts
  const oldGuardianRow = (await db.query(
    `SELECT first_name, last_name FROM guardians WHERE guardian_id=$1 AND organization_id=$2`,
    [guardianId, organizationId]
  )).rows[0];

  const updateQuery = imageUrl
    ? `UPDATE guardians
       SET first_name = $1, last_name = $2, email = $3, phone = $4,
       address = $5, hometown = $6, date_of_birth = $7, image_url = $8
     WHERE guardian_id = $9 AND organization_id = $10`
    : `UPDATE guardians
       SET first_name = $1, last_name = $2, email = $3, phone = $4,
       address = $5, hometown = $6, date_of_birth = $7
     WHERE guardian_id = $8 AND organization_id = $9`;

  const params = imageUrl
    ? [firstName, lastName, email || null, phone, address, hometown, dateOfBirth || null, imageUrl, guardianId, organizationId]
    : [firstName, lastName, email || null, phone, address, hometown, dateOfBirth || null, guardianId, organizationId];

  await db.query(updateQuery, params);

  // Sync to guardian_profiles and guardian_accounts by old name match
  if (oldGuardianRow) {
    await db.query(
      `UPDATE guardian_profiles
         SET first_name = $1, last_name = $2, email = $3, phone = $4, address = $5, hometown = $6, date_of_birth = $7, updated_at = NOW()
       WHERE organization_id = $8
         AND LOWER(TRIM(first_name)) = LOWER(TRIM($9))
         AND LOWER(TRIM(last_name))  = LOWER(TRIM($10))`,
      [firstName, lastName, email || null, phone || null, address, hometown, dateOfBirth || null,
        organizationId, oldGuardianRow.first_name, oldGuardianRow.last_name]
    );
    await db.query(
      `UPDATE guardian_accounts
         SET login_email = $1, login_phone = $2, updated_at = NOW()
       WHERE organization_id = $3
         AND guardian_id IN (
           SELECT guardian_id FROM guardian_profiles
           WHERE organization_id = $3
             AND LOWER(TRIM(first_name)) = LOWER(TRIM($4))
             AND LOWER(TRIM(last_name))  = LOWER(TRIM($5))
         )`,
      [email || null, cleanedPhone, organizationId, firstName, lastName]
    );
  }
}

// Saves a card: base details on every stored copy of the contact, and answers
// to the template's active fields (obsolete fields are left as they are).
async function saveContact(db, organizationId, keys, body, userId) {
  await ensureContactsSchema(db);
  const base = readBaseInput(body.base);
  const fieldRows = (await db.query(`SELECT field_id, label, field_type, options FROM contact_fields WHERE organization_id = $1 AND status = 'active'`, [organizationId])).rows;
  const incoming = body.fields && typeof body.fields === "object" ? body.fields : {};
  const answers = fieldRows
    .filter((f) => Object.prototype.hasOwnProperty.call(incoming, String(f.field_id)))
    .map((f) => ({ id: f.field_id, value: checkAnswer(f, incoming[f.field_id]) }));

  // Base details are written only when they changed: saving them also updates
  // the parent's portal login and their other stored copies.
  const current = (await readContact(db, organizationId, keys)).base;
  const changed = Object.keys(base).some((k) => String(current[k] || "") !== String(base[k] || ""));
  if (changed) {
    for (const k of keys) {
      await saveGuardianBaseInfo(db, { organizationId, guardianId: k.id, source: k.source, ...base });
    }
  }
  const contactKeys = keys.map((k) => k.key);
  const clear = answers.filter((a) => !a.value).map((a) => a.id);
  const set = answers.filter((a) => a.value);
  if (clear.length) {
    await db.query(`DELETE FROM contact_field_values WHERE organization_id = $1 AND field_id = ANY($2::int[]) AND contact_key = ANY($3::text[])`, [organizationId, clear, contactKeys]);
  }
  if (set.length) {
    await db.query(
      `INSERT INTO contact_field_values (field_id, organization_id, contact_key, value, updated_by, updated_at)
       SELECT a.field_id, $1, k.contact_key, a.value, $4, NOW()
         FROM unnest($2::int[], $3::text[]) AS a(field_id, value)
         CROSS JOIN unnest($5::text[]) AS k(contact_key)
       ON CONFLICT (field_id, contact_key) DO UPDATE SET value = EXCLUDED.value, updated_by = EXCLUDED.updated_by, updated_at = NOW()`,
      [organizationId, set.map((a) => a.id), set.map((a) => a.value), userId || null, contactKeys]
    );
  }
}

module.exports = {
  FIELD_TYPES,
  BASE_FIELDS,
  ContactError,
  ensureContactsSchema,
  parseKeys,
  listFields,
  createField,
  updateField,
  setFieldStatus,
  deleteField,
  getTemplate,
  createSection,
  renameSection,
  deleteSection,
  saveOrder,
  readContact,
  saveContact,
  saveGuardianBaseInfo,
};
