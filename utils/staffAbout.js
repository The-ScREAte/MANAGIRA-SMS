"use strict";

// "About me" (feature teacher_cards): a fun fact and up to two photos a member of staff writes
// about themselves on their profile (/account/update). Families see it on a child's Teachers page
// only where the class shares it (Class settings › Share with › Teacher's About me).
// Table staff_about (database/migrations/2026-12-19_staff_about.sql). Photos are re-drawn on the
// server (turned upright, at most 1600px, as JPEG), which also drops what a camera writes into a
// file (where it was taken), and stored privately under staff-about/<school>/<person>/: they open
// only through /files/ for people signed in to that school (utils/storedFiles.js).

const crypto = require("crypto");

const FEATURE = "teacher_cards";
const MAX_FACT = 280;
const MAX_PHOTOS = 2;
const MAX_BYTES = 8 * 1024 * 1024;
const PICTURE_TYPES = new Set(["image/jpeg", "image/png", "image/webp", "image/heic", "image/heif"]);

class AboutError extends Error {
  constructor(message, status = 400) { super(message); this.status = status; }
}

const isOn = (organizationId) => require("./shards/features").isOn(FEATURE, { organizationId: Number(organizationId) });

// Whether the table exists yet. A failed check keeps its last answer and asks again next time.
let known = null;
let checkedAt = 0;
async function ready(db) {
  if (known === true || (known === false && Date.now() - checkedAt < 60000)) return known;
  try {
    const { rows } = await db.query("SELECT to_regclass('public.staff_about') IS NOT NULL AS there");
    known = Boolean(rows[0] && rows[0].there);
    checkedAt = Date.now();
  } catch (_) {
    return Boolean(known);
  }
  return known;
}

const tidyFact = (value) => String(value == null ? "" : value).replace(/\r\n?/g, "\n").replace(/[^\S\n]+/g, " ").replace(/\n{3,}/g, "\n\n").trim().slice(0, MAX_FACT);
const photosOf = (value) => (Array.isArray(value) ? value : [])
  .filter((p) => p && typeof p.key === "string" && p.key.startsWith("staff-about/"))
  .slice(0, MAX_PHOTOS)
  .map((p) => ({ key: p.key }));

// The address a viewer is given for a photo: Managira's own /files/ link, never storage's.
const linkOf = (photo) => require("./storedFiles").fileLink(photo);

function shape(row) {
  return {
    funFact: row ? tidyFact(row.fun_fact) : "",
    photos: row ? photosOf(row.photos).map((p) => ({ key: p.key, url: linkOf(p) })).filter((p) => p.url) : [],
  };
}

async function get(db, organizationId, userId) {
  if (!(await ready(db))) return shape(null);
  const { rows } = await db.query("SELECT fun_fact, photos FROM staff_about WHERE organization_id = $1 AND user_id = $2", [organizationId, userId]);
  return shape(rows[0]);
}

// Many people at once (a child's Teachers page): Map userId -> { funFact, photos }.
async function many(db, organizationId, userIds) {
  const ids = [...new Set((userIds || []).map(Number).filter((id) => Number.isInteger(id) && id > 0))];
  const out = new Map();
  if (!ids.length || !(await ready(db))) return out;
  const { rows } = await db.query("SELECT user_id, fun_fact, photos FROM staff_about WHERE organization_id = $1 AND user_id = ANY($2::int[])", [organizationId, ids]);
  rows.forEach((row) => out.set(Number(row.user_id), shape(row)));
  return out;
}

async function saveFact(db, organizationId, userId, text) {
  if (!(await ready(db))) throw new AboutError("About me isn't ready yet. Try again later.", 503);
  const funFact = tidyFact(text);
  await db.query(
    `INSERT INTO staff_about (organization_id, user_id, fun_fact) VALUES ($1, $2, $3)
     ON CONFLICT (organization_id, user_id) DO UPDATE SET fun_fact = EXCLUDED.fun_fact, updated_at = NOW()
      WHERE staff_about.fun_fact IS DISTINCT FROM EXCLUDED.fun_fact`,
    [organizationId, userId, funFact]
  );
  return get(db, organizationId, userId);
}

// One photo, from a multer memory upload. A third photo is refused (in the same statement, so two
// uploads at once can't make three).
async function addPhoto(db, organizationId, userId, file) {
  if (!(await ready(db))) throw new AboutError("About me isn't ready yet. Try again later.", 503);
  if (!file || !file.buffer || !file.buffer.length) throw new AboutError("Choose a photo first.");
  if (file.buffer.length > MAX_BYTES) throw new AboutError("That photo is too large. Choose one under 8 MB.");
  if (!PICTURE_TYPES.has(String(file.mimetype || "").toLowerCase())) throw new AboutError("Choose a JPG, PNG, WebP or HEIC photo.");
  let picture;
  try {
    picture = await require("sharp")(file.buffer, { failOn: "error", limitInputPixels: 50e6 })
      .rotate()
      .resize({ width: 1600, height: 1600, fit: "inside", withoutEnlargement: true })
      .jpeg({ quality: 82, mozjpeg: true })
      .toBuffer();
  } catch (_) {
    throw new AboutError("That file isn't a photo we can read. Try another.");
  }
  const key = `staff-about/${Number(organizationId)}/${Number(userId)}/${crypto.randomUUID()}.jpg`;
  const { uploadToS3, deleteFromS3 } = require("../middleware/s3Upload");
  await uploadToS3({ buffer: picture, mimetype: "image/jpeg", originalname: "photo.jpg" }, key);
  const { rowCount } = await db.query(
    `INSERT INTO staff_about (organization_id, user_id, photos) VALUES ($1, $2, jsonb_build_array(jsonb_build_object('key', $3::text)))
     ON CONFLICT (organization_id, user_id) DO UPDATE
        SET photos = staff_about.photos || jsonb_build_array(jsonb_build_object('key', $3::text)), updated_at = NOW()
      WHERE jsonb_array_length(staff_about.photos) < $4`,
    [organizationId, userId, key, MAX_PHOTOS]
  );
  if (!rowCount) {
    deleteFromS3(key).catch(() => {});
    throw new AboutError(`You can add up to ${MAX_PHOTOS} photos. Remove one first.`);
  }
  return get(db, organizationId, userId);
}

async function removePhoto(db, organizationId, userId, key) {
  if (!(await ready(db))) throw new AboutError("About me isn't ready yet. Try again later.", 503);
  const wanted = String(key || "");
  // Only this person's own photo: the key carries their school and their id.
  if (!wanted.startsWith(`staff-about/${Number(organizationId)}/${Number(userId)}/`)) throw new AboutError("That photo isn't yours.", 403);
  const { rowCount } = await db.query(
    `UPDATE staff_about
        SET photos = COALESCE((SELECT jsonb_agg(p) FROM jsonb_array_elements(photos) p WHERE p->>'key' <> $3), '[]'::jsonb), updated_at = NOW()
      WHERE organization_id = $1 AND user_id = $2 AND photos @> jsonb_build_array(jsonb_build_object('key', $3::text))`,
    [organizationId, userId, wanted]
  );
  if (rowCount) require("../middleware/s3Upload").deleteFromS3(wanted).catch(() => {});
  return get(db, organizationId, userId);
}

module.exports = { FEATURE, MAX_FACT, MAX_PHOTOS, MAX_BYTES, AboutError, isOn, ready, get, many, saveFact, addPhoto, removePhoto, tidyFact };
