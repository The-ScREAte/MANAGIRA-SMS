"use strict";

// What parents can see of a set of questions: whether it shows on the portal, a teacher's
// notes, and attached files. Answer keys never leave this file's queries.
const crypto = require("crypto");
const path = require("path");
const { uploadToS3, deleteFromS3 } = require("../middleware/s3Upload");

const TABLE_MISSING = new Set(["42P01", "42703"]);
const MAX_NOTES = 4000;
const orEmpty = (error, fallback) => {
  if (TABLE_MISSING.has(error.code)) return fallback;
  throw error;
};

async function readSettings(db, organizationId, questionSetId) {
  try {
    const [set, files] = await Promise.all([
      db.query("SELECT show_on_parent_portal, parent_notes FROM assessment_question_sets WHERE organization_id = $1 AND question_set_id = $2", [organizationId, questionSetId]),
      db.query("SELECT resource_id, file_name FROM assessment_set_resources WHERE organization_id = $1 AND question_set_id = $2 ORDER BY resource_id", [organizationId, questionSetId]),
    ]);
    if (!set.rows[0]) return null;
    return {
      show: set.rows[0].show_on_parent_portal,
      notes: set.rows[0].parent_notes || "",
      files: files.rows.map((row) => ({ id: Number(row.resource_id), name: row.file_name })),
    };
  } catch (error) {
    return orEmpty(error, { show: false, notes: "", files: [] });
  }
}

async function saveSettings(db, organizationId, questionSetId, { show, notes }) {
  const { rowCount } = await db.query(
    "UPDATE assessment_question_sets SET show_on_parent_portal = $3, parent_notes = $4 WHERE organization_id = $1 AND question_set_id = $2",
    [organizationId, questionSetId, show === true, String(notes || "").trim().slice(0, MAX_NOTES) || null]
  );
  return rowCount > 0;
}

async function addFiles(db, organizationId, questionSetId, files, uploadedBy) {
  const added = [];
  for (const file of files) {
    const key = `parent-resources/${organizationId}/${questionSetId}/${crypto.randomUUID()}${path.extname(String(file.originalname || "")).toLowerCase().slice(0, 12)}`;
    const url = await uploadToS3(file, key);
    const { rows } = await db.query(
      `INSERT INTO assessment_set_resources (organization_id, question_set_id, file_name, file_url, file_key, uploaded_by)
       VALUES ($1, $2, $3, $4, $5, $6) RETURNING resource_id, file_name`,
      [organizationId, questionSetId, String(file.originalname || "File").slice(0, 200), url, key, uploadedBy]
    );
    added.push({ id: Number(rows[0].resource_id), name: rows[0].file_name });
  }
  return added;
}

async function removeFile(db, organizationId, resourceId) {
  const { rows } = await db.query(
    "DELETE FROM assessment_set_resources WHERE organization_id = $1 AND resource_id = $2 RETURNING file_key",
    [organizationId, resourceId]
  );
  if (rows[0]?.file_key) await deleteFromS3(rows[0].file_key).catch((error) => console.error("[Parent resources]", error.message));
  return rows.length > 0;
}

// Of these sets, the ones a teacher chose to show to parents.
async function shownSets(db, organizationId, questionSetIds) {
  if (!questionSetIds.length) return new Map();
  try {
    const { rows } = await db.query(
      "SELECT question_set_id, parent_notes FROM assessment_question_sets WHERE organization_id = $1 AND question_set_id = ANY($2::int[]) AND show_on_parent_portal = TRUE",
      [organizationId, questionSetIds]
    );
    return new Map(rows.map((row) => [Number(row.question_set_id), row]));
  } catch (error) {
    return orEmpty(error, new Map());
  }
}

async function filesForSets(db, organizationId, questionSetIds) {
  if (!questionSetIds.length) return [];
  try {
    const { rows } = await db.query(
      "SELECT resource_id, question_set_id, file_name, created_at FROM assessment_set_resources WHERE organization_id = $1 AND question_set_id = ANY($2::int[]) ORDER BY created_at DESC, resource_id DESC",
      [organizationId, questionSetIds]
    );
    return rows.map((row) => ({ id: Number(row.resource_id), setId: Number(row.question_set_id), name: row.file_name, at: row.created_at }));
  } catch (error) {
    return orEmpty(error, []);
  }
}

// Every set shown to parents this term in this child's class and subjects, including ones
// that have closed, as the child's assessment documents.
async function termSetsForChild(db, organizationId, studentId, classId, termId) {
  if (!classId || !termId) return [];
  try {
    const { rows } = await db.query(
      `SELECT qs.question_set_id, qs.set_title, a.title, a.category, s.subject_name
         FROM assessment_question_sets qs
         JOIN assessments a ON a.assessment_id = qs.assessment_id AND a.organization_id = qs.organization_id
         JOIN subjects s ON s.subject_id = a.subject_id AND s.organization_id = a.organization_id
        WHERE qs.organization_id = $1 AND a.class_id = $2 AND a.term_id = $3
          AND qs.show_on_parent_portal = TRUE AND COALESCE(qs.is_active, TRUE) AND COALESCE(a.is_active, TRUE)
          AND LOWER(COALESCE(qs.review_status, 'pending')) = 'approved'
          AND (qs.retake_student_id IS NULL OR qs.retake_student_id = $4)
          AND EXISTS (SELECT 1 FROM student_subjects ss WHERE ss.organization_id = $1 AND ss.student_id = $4 AND ss.subject_id = a.subject_id)
        ORDER BY s.subject_name, a.title`,
      [organizationId, classId, termId, studentId]
    );
    return rows;
  } catch (error) {
    return orEmpty(error, []);
  }
}

async function fileById(db, organizationId, resourceId) {
  try {
    const { rows } = await db.query(
      "SELECT resource_id, question_set_id, file_name, file_url FROM assessment_set_resources WHERE organization_id = $1 AND resource_id = $2",
      [organizationId, resourceId]
    );
    return rows[0] || null;
  } catch (error) {
    return orEmpty(error, null);
  }
}

async function questionsForParents(db, organizationId, questionSetId) {
  const { rows } = await db.query(
    `SELECT question_id, question_type, question_text, options_json, marks
       FROM assessment_questions
      WHERE organization_id = $1 AND question_set_id = $2
      ORDER BY position_index, question_id`,
    [organizationId, questionSetId]
  );
  return rows;
}

module.exports = { readSettings, saveSettings, addFiles, removeFile, shownSets, filesForSets, termSetsForChild, fileById, questionsForParents };
