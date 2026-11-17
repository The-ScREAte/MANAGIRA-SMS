"use strict";

// A student's documents (feature student_documents): files the school keeps on a student, such as
// a health insurance card, a birth certificate, an immunization record, an IEP or 504 plan or
// custody papers. Each has a type, a title, an optional note and an optional expiry date, and says
// who sees it: staff who can open the student (Manage Students), managers only, or also the
// family: the student's parents (the child's Documents tile and Portfolio) and the student
// (My portfolio). Added from the student page, Add student and Edit student.
//
// Files are private: stored under student-documents/<school>/<student>/ and opened only through
// Managira, which checks who is asking and hands out a link that works for a few minutes.

const crypto = require("crypto");
const path = require("path");

const TYPES = [
  { key: "insurance", label: "Health insurance card", sharing: "staff" },
  { key: "immunization", label: "Immunization record", sharing: "staff" },
  { key: "medical", label: "Medical or allergy plan", sharing: "staff" },
  { key: "birth_certificate", label: "Birth certificate", sharing: "staff" },
  { key: "proof_of_address", label: "Proof of address", sharing: "staff" },
  { key: "iep_504", label: "IEP or 504 plan", sharing: "managers" },
  { key: "custody", label: "Custody or legal papers", sharing: "managers" },
  { key: "transcript", label: "Transcript from another school", sharing: "staff" },
  { key: "consent", label: "Signed consent or permission", sharing: "staff" },
  { key: "other", label: "Other", sharing: "staff" },
];
const TYPE_KEYS = new Set(TYPES.map((type) => type.key));
const SHARING = [
  { key: "staff", label: "Staff who can open this student" },
  { key: "managers", label: "Managers and supervisors only" },
  { key: "family", label: "Staff, parents and the student" },
];
const SHARING_KEYS = new Set(SHARING.map((item) => item.key));
const ALLOWED_EXTENSIONS = new Set([".pdf", ".jpg", ".jpeg", ".png", ".gif", ".webp", ".heic", ".heif", ".doc", ".docx"]);
const MAX_MB = 15;
const FULL_ROLES = new Set(["organization", "admin", "mini admin", "manager", "supervisor", "superviser"]);

const typeLabel = (key) => (TYPES.find((type) => type.key === key) || TYPES[TYPES.length - 1]).label;
const roleOf = (req) => String(req.session?.userRole || req.session?.user?.account_type || req.session?.accountType || "").trim().toLowerCase();
const isManagerRole = (req) => FULL_ROLES.has(roleOf(req));

const isOn = (organizationId) => require("./shards/features").isOn("student_documents", { organizationId: Number(organizationId) });

// The table exists (its migration has run). Kept once true; asked again a minute after a miss.
let readyKnown = false;
let lastMiss = 0;
async function ready(db) {
  if (readyKnown) return true;
  if (Date.now() - lastMiss < 60000) return false;
  try {
    const { rows } = await db.query("SELECT to_regclass('public.student_documents') IS NOT NULL AS ok");
    readyKnown = rows[0]?.ok === true;
  } catch (_) {
    readyKnown = false;
  }
  if (!readyKnown) lastMiss = Date.now();
  return readyKnown;
}

const clean = (value, max) => String(value ?? "").replace(/\s+/g, " ").trim().slice(0, max);
const cleanNote = (value) => String(value ?? "").replace(/\r\n?/g, "\n").trim().slice(0, 1000);
function cleanDate(value) {
  const text = String(value || "").trim();
  return /^\d{4}-\d{2}-\d{2}$/.test(text) && !Number.isNaN(Date.parse(`${text}T00:00:00Z`)) ? text : null;
}

// What a form sent: the document's details, checked.
function detailsFrom(body = {}) {
  const docType = TYPE_KEYS.has(String(body.docType)) ? String(body.docType) : "other";
  const sharing = SHARING_KEYS.has(String(body.sharing)) ? String(body.sharing) : (TYPES.find((type) => type.key === docType) || {}).sharing || "staff";
  return {
    docType,
    title: clean(body.title, 140) || typeLabel(docType),
    note: cleanNote(body.note),
    expiresOn: cleanDate(body.expiresOn),
    sharing,
  };
}

// Only papers and pictures: never anything a browser or computer would run.
function fileProblem(file) {
  if (!file || !file.buffer || !file.size) return "Choose a file to upload.";
  if (file.size > MAX_MB * 1024 * 1024) return `That file is larger than ${MAX_MB} MB.`;
  if (!ALLOWED_EXTENSIONS.has(path.extname(String(file.originalname || "")).toLowerCase())) {
    return "Upload a PDF, a picture (JPG, PNG, HEIC) or a Word document.";
  }
  return null;
}

// Who may see a document: managers-only ones need a manager or supervisor.
const visibleTo = (req) => (doc) => doc.shared_with !== "managers" || isManagerRole(req);

function present(row) {
  const today = new Date().toISOString().slice(0, 10);
  const expires = row.expires_on ? (row.expires_on instanceof Date ? row.expires_on.toISOString().slice(0, 10) : String(row.expires_on).slice(0, 10)) : null;
  const soon = expires && !(expires < today) && Date.parse(`${expires}T00:00:00Z`) - Date.parse(`${today}T00:00:00Z`) <= 30 * 86400000;
  return {
    id: Number(row.document_id),
    studentId: Number(row.student_id),
    docType: row.doc_type,
    typeLabel: typeLabel(row.doc_type),
    title: row.title,
    note: row.note || "",
    fileName: row.file_name,
    sizeBytes: Number(row.size_bytes || 0),
    expiresOn: expires,
    expired: Boolean(expires && expires < today),
    expiresSoon: Boolean(soon),
    sharing: row.shared_with,
    sharingLabel: (SHARING.find((item) => item.key === row.shared_with) || SHARING[0]).label,
    uploadedBy: row.uploaded_by_name || "",
    uploadedAt: row.created_at,
  };
}

// A teacher or supervisor works only on students of their own classes (the student page's rule).
async function inScope(db, req, studentId) {
  const classScope = require("./classScope");
  const mine = await classScope.assignedClasses(db, req);
  if (!mine) return true;
  const allowed = await classScope.studentsInClasses(db, Number(req.session.organizationId), [Number(studentId)], mine);
  return allowed.has(Number(studentId));
}

async function listFor(db, organizationId, studentId, { req = null, family = false } = {}) {
  if (!(await ready(db))) return [];
  const { rows } = await db.query(
    `SELECT * FROM student_documents WHERE organization_id = $1 AND student_id = $2
      ${family ? "AND shared_with = 'family'" : ""}
      ORDER BY created_at DESC, document_id DESC LIMIT 200`,
    [organizationId, studentId]
  );
  return rows.filter(req && !family ? visibleTo(req) : () => true).map(present);
}

async function findOne(db, organizationId, documentId) {
  if (!(await ready(db))) return null;
  const { rows } = await db.query("SELECT * FROM student_documents WHERE organization_id = $1 AND document_id = $2", [organizationId, documentId]);
  return rows[0] || null;
}

async function create(db, { organizationId, studentId, body, file, actor }) {
  const problem = fileProblem(file);
  if (problem) return { error: problem };
  const details = detailsFrom(body);
  const extension = path.extname(String(file.originalname || "")).toLowerCase();
  const key = `student-documents/${Number(organizationId)}/${Number(studentId)}/${Date.now()}-${crypto.randomBytes(8).toString("hex")}${extension}`;
  const { uploadToS3 } = require("../middleware/s3Upload");
  await uploadToS3(file, key);
  const { rows } = await db.query(
    `INSERT INTO student_documents (organization_id, student_id, doc_type, title, note, file_name, storage_key, content_type, size_bytes, expires_on, shared_with, uploaded_by, uploaded_by_name)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13) RETURNING *`,
    [organizationId, studentId, details.docType, details.title, details.note || null, clean(file.originalname, 200) || `document${extension}`,
      key, String(file.mimetype || "").slice(0, 120), file.size, details.expiresOn, details.sharing, actor.id || null, actor.name || null]
  );
  return { document: present(rows[0]) };
}

// Files added on Add student or Edit student: file fields starting with prefix (studentDoc_<form>_ on
// Add student, studentDoc_new on Edit student), each named studentDoc_<key> with its details in
// docTitle_<key>, docType_<key>, docSharing_<key>, docNote_<key>, docExpires_<key>. Saved one by one
// after the student is; returns how many were added and what was refused.
async function saveFromForm(db, { organizationId, studentId, files = [], body = {}, prefix, actor = {}, manager = false }) {
  const result = { added: 0, problems: [] };
  if (!(await ready(db))) return result;
  for (const file of files) {
    const name = String(file.fieldname || "");
    if (!name.startsWith(prefix)) continue;
    // The details sit beside the file under the same key: studentDoc_<key> → docTitle_<key>.
    const key = name.replace(/^studentDoc_/, "");
    if (!/^[A-Za-z0-9_]{1,40}$/.test(key)) continue;
    const fields = {
      docType: body[`docType_${key}`],
      title: body[`docTitle_${key}`],
      note: body[`docNote_${key}`],
      expiresOn: body[`docExpires_${key}`],
      sharing: body[`docSharing_${key}`],
    };
    // Only a manager or supervisor keeps a file to managers; anyone else's stays with staff.
    if (!manager && (fields.sharing === "managers" || (!fields.sharing && detailsFrom(fields).sharing === "managers"))) fields.sharing = "staff";
    try {
      const saved = await create(db, { organizationId, studentId, body: fields, file, actor });
      if (saved.error) result.problems.push(`${clean(file.originalname, 80) || "A file"}: ${saved.error}`);
      else result.added += 1;
    } catch (error) {
      console.error("[Student documents] form upload:", error.message);
      result.problems.push(`${clean(file.originalname, 80) || "A file"} couldn't be saved.`);
    }
  }
  return result;
}

// Edit student: changes to the files already there (docEditTitle_<id> …) and the ones ticked to remove.
async function applyFormEdits(db, { organizationId, studentId, body = {}, manager = false }) {
  const result = { changed: 0, removed: 0 };
  if (!(await ready(db))) return result;
  const docs = (await db.query("SELECT * FROM student_documents WHERE organization_id = $1 AND student_id = $2", [organizationId, studentId])).rows
    .filter((doc) => manager || doc.shared_with !== "managers");
  const removing = new Set([].concat(body.removeDoc || []).map((value) => Number(value)));
  for (const doc of docs) {
    const id = Number(doc.document_id);
    if (removing.has(id)) {
      if (await remove(db, { organizationId, studentId, documentId: id })) result.removed += 1;
      continue;
    }
    if (body[`docEditTitle_${id}`] === undefined) continue;
    // A field the form didn't show (expiry, note) keeps what the file has.
    const before = present(doc);
    const fields = {
      docType: body[`docEditType_${id}`] ?? doc.doc_type,
      title: body[`docEditTitle_${id}`],
      note: body[`docEditNote_${id}`] ?? before.note,
      expiresOn: body[`docEditExpires_${id}`] ?? before.expiresOn,
      sharing: body[`docEditSharing_${id}`] ?? doc.shared_with,
    };
    if (!manager && fields.sharing === "managers") fields.sharing = doc.shared_with === "managers" ? "managers" : "staff";
    const next = detailsFrom(fields);
    if (next.docType === before.docType && next.title === before.title && next.note === before.note && next.expiresOn === before.expiresOn && next.sharing === before.sharing) continue;
    if (await update(db, { organizationId, studentId, documentId: id, body: fields })) result.changed += 1;
  }
  return result;
}

// The school's choices (student_document_settings): Add student asks for a file only when the
// school requires it. Off when never saved or before the table exists.
async function settingsFor(db, organizationId) {
  try {
    const { rows } = await db.query("SELECT required_on_add FROM student_document_settings WHERE organization_id = $1", [organizationId]);
    return { requiredOnAdd: rows[0] ? rows[0].required_on_add === true : false, ready: true };
  } catch (_) {
    return { requiredOnAdd: false, ready: false };
  }
}

async function saveSettings(db, organizationId, { requiredOnAdd }, userId = null) {
  await db.query(
    `INSERT INTO student_document_settings (organization_id, required_on_add, updated_by, updated_at)
     VALUES ($1, $2, $3, NOW())
     ON CONFLICT (organization_id) DO UPDATE SET required_on_add = EXCLUDED.required_on_add, updated_by = EXCLUDED.updated_by, updated_at = NOW()`,
    [organizationId, requiredOnAdd === true, userId]
  );
  return settingsFor(db, organizationId);
}

async function update(db, { organizationId, studentId, documentId, body }) {
  const details = detailsFrom(body);
  const { rowCount } = await db.query(
    `UPDATE student_documents SET doc_type = $4, title = $5, note = $6, expires_on = $7, shared_with = $8, updated_at = NOW()
      WHERE organization_id = $1 AND student_id = $2 AND document_id = $3`,
    [organizationId, studentId, documentId, details.docType, details.title, details.note || null, details.expiresOn, details.sharing]
  );
  return rowCount === 1;
}

async function remove(db, { organizationId, studentId, documentId }) {
  const { rows } = await db.query(
    "DELETE FROM student_documents WHERE organization_id = $1 AND student_id = $2 AND document_id = $3 RETURNING storage_key",
    [organizationId, studentId, documentId]
  );
  if (!rows[0]) return false;
  await require("../middleware/s3Upload").deleteFromS3(rows[0].storage_key).catch((error) => {
    console.warn("[Student documents] file left in storage:", error.message);
  });
  return true;
}

module.exports = {
  TYPES, SHARING, MAX_MB, ALLOWED_EXTENSIONS,
  isOn, ready, isManagerRole, visibleTo, detailsFrom, fileProblem, typeLabel, inScope,
  listFor, findOne, create, update, remove, present, saveFromForm, applyFormEdits, settingsFor, saveSettings,
};
