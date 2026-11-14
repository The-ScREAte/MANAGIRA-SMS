"use strict";
// Documents from a school's old system: any file that isn't a list (PDFs, photos, scans, Word
// files…). Kept privately: in S3 under migrations/ (the bucket never serves that prefix publicly)
// when S3 is set up, otherwise in the database (a local copy). Shown only through Managira, to
// staff who may open the student, and the restricted ones only with an authenticator code.
const crypto = require("crypto");

const TYPES = {
  pdf: "application/pdf", png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", gif: "image/gif", webp: "image/webp", heic: "image/heic",
  tif: "image/tiff", tiff: "image/tiff", bmp: "image/bmp", txt: "text/plain", rtf: "application/rtf", doc: "application/msword",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document", xls: "application/vnd.ms-excel",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", ppt: "application/vnd.ms-powerpoint",
  pptx: "application/vnd.openxmlformats-officedocument.presentationml.presentation", csv: "text/csv", zip: "application/zip", mp4: "video/mp4", mp3: "audio/mpeg",
};
// Shown in the browser only when that's safe; anything else is downloaded, never run.
const INLINE = new Set(["application/pdf", "image/png", "image/jpeg", "image/gif", "image/webp", "text/plain"]);
const typeOf = (name) => TYPES[String(name || "").split(".").pop().toLowerCase()] || "application/octet-stream";

// What a document is, from its name: "birth_certificate.pdf" → "Birth certificate".
const kindOf = (name) => {
  const base = String(name || "").split("/").pop().replace(/\.[a-z0-9]{2,5}$/i, "").replace(/[_-]+/g, " ").replace(/\s+/g, " ").trim();
  return base ? base[0].toUpperCase() + base.slice(1) : "Document";
};
// Kept restricted unless the school's index says otherwise: identity, health, special education,
// legal and discipline papers.
const RESTRICTED = /birth|passport|ssn|social|residen|custody|court|legal|order|name.?change|immuni|medical|health|doctor|physician|care.?plan|allerg|medicat|iep|504|evaluat|psych|special|sped|disciplin|incident|suspen|threat|safety|counsel|title.?ix|truanc|work.?permit/i;

function s3() {
  if (!process.env.S3_BUCKET_NAME || !process.env.AWS_ACCESS_KEY_ID) return null;
  return require("../../config/s3");
}
const storeName = () => (s3() ? "s3" : "db");

async function put(db, job, { path, buffer, uploadId = null, actor = null }) {
  const fileName = String(path).split("/").pop().slice(0, 200) || "document";
  const sha256 = crypto.createHash("sha256").update(buffer).digest("hex");
  const contentType = typeOf(fileName);
  const client = s3();
  // The same file sent again in a later upload (same place in the export) replaces the earlier one.
  const { rows: older } = await db.query("SELECT document_id, store, storage_key, sha256 FROM migration_documents WHERE job_id = $1 AND path = $2 AND upload_id IS DISTINCT FROM $3", [job.job_id, String(path).slice(0, 500), uploadId]);
  for (const old of older.filter((o) => o.sha256 !== sha256)) {
    if (old.store === "s3" && old.storage_key && client) {
      const { DeleteObjectCommand } = require("@aws-sdk/client-s3");
      await client.s3Client.send(new DeleteObjectCommand({ Bucket: process.env.S3_BUCKET_NAME, Key: old.storage_key })).catch(() => {});
    }
    await db.query("DELETE FROM migration_documents WHERE document_id = $1", [old.document_id]);
  }
  let key = null;
  if (client) {
    key = `migrations/${job.organization_id}/${job.job_id}/documents/${sha256.slice(0, 20)}-${fileName.replace(/[^A-Za-z0-9._-]+/g, "_")}`;
    const { PutObjectCommand } = require("@aws-sdk/client-s3");
    await client.s3Client.send(new PutObjectCommand({ Bucket: process.env.S3_BUCKET_NAME, Key: key, Body: buffer, ContentType: contentType, ServerSideEncryption: "AES256" }));
  }
  const { rows: [doc] } = await db.query(
    `INSERT INTO migration_documents (job_id, organization_id, upload_id, file_name, path, content_type, size_bytes, sha256, store, storage_key, content, kind, restricted, uploaded_by)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)
     ON CONFLICT (job_id, path, sha256) DO UPDATE SET upload_id = EXCLUDED.upload_id RETURNING document_id`,
    [job.job_id, job.organization_id, uploadId, fileName, String(path).slice(0, 500), contentType, buffer.length, sha256, client ? "s3" : "db", key, client ? null : buffer, kindOf(fileName), RESTRICTED.test(path), actor]
  );
  return doc;
}

async function read(doc) {
  if (doc.store === "db") return doc.content;
  const client = s3();
  if (!client) throw new Error("Document storage isn't set up.");
  const { GetObjectCommand } = require("@aws-sdk/client-s3");
  const out = await client.s3Client.send(new GetObjectCommand({ Bucket: process.env.S3_BUCKET_NAME, Key: doc.storage_key }));
  return Buffer.from(await out.Body.transformToByteArray());
}

// Every document of a migration, removed (a cancelled migration).
async function removeAll(db, jobId) {
  const { rows } = await db.query("SELECT storage_key FROM migration_documents WHERE job_id = $1 AND store = 's3' AND storage_key IS NOT NULL", [jobId]);
  const client = s3();
  if (client && rows.length) {
    const { DeleteObjectCommand } = require("@aws-sdk/client-s3");
    for (const r of rows) await client.s3Client.send(new DeleteObjectCommand({ Bucket: process.env.S3_BUCKET_NAME, Key: r.storage_key })).catch(() => {});
  }
  await db.query("DELETE FROM migration_documents WHERE job_id = $1", [jobId]);
}

module.exports = { put, read, removeAll, typeOf, kindOf, INLINE, RESTRICTED, storeName };
