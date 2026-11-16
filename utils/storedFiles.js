"use strict";

// Files kept in Managira's file storage (S3). Student files are private: report cards, transcripts,
// photos, form answers, signatures, documents. Only the school's public images (website, logos,
// announcements, help-center pictures) may be read straight from storage. Everything else is
// reached through Managira, which checks who is asking and then hands out a link that works for a
// few minutes (`signedUrl`), or through the image route (utils/publicImageUrl.js, /public-image).
//
// Stored values are full storage addresses or bare keys. Addresses of an earlier bucket (one the
// files were copied from, S3_LEGACY_BUCKETS) are read as the same key in the current bucket, so
// moving the files to another bucket or region needs no change to what is stored.

const { GetObjectCommand } = require("@aws-sdk/client-s3");

// The prefixes anyone may read straight from storage (the bucket policy allows exactly these;
// scripts/storage/privateBucketPolicy.js).
const PUBLIC_PREFIXES = Object.freeze([
  "images/logos/",
  "images/website/",
  "images/publicdashboard/",
  "videos/publicdashboard/",
  "images/hub-logos/",
  "images/ads/",
  "images/donations/",
  "images/announcements/",
  "documentation/",
]);

// Within those prefixes only pictures and videos are public (images/logos/ also holds schools'
// sign-up documents from before they had a folder of their own). Lower and upper case, as the
// bucket policy matches names exactly.
const PUBLIC_EXTENSIONS = Object.freeze(["png", "jpg", "jpeg", "jfif", "gif", "webp", "avif", "svg", "ico", "bmp", "mp4", "webm", "mov", "m4v"]);

// Prefixes whose second part is the school, for files a signed-in person of that school opens
// through /files/... (form answers, help on a question, parent resources).
const SCHOOL_FILE_PREFIXES = Object.freeze(["custom-forms/", "question-help/", "parent-resources/"]);

const bucketName = () => String(process.env.S3_BUCKET_NAME || "").trim();
const regionName = () => String(process.env.AWS_REGION || "").trim();
const legacyBuckets = () => String(process.env.S3_LEGACY_BUCKETS || "").split(",").map((b) => b.trim()).filter(Boolean);

const decodeKey = (key) => String(key).split("/").map((part) => { try { return decodeURIComponent(part); } catch { return part; } }).join("/");

// The object key a stored value names, in the current bucket (or an earlier one), or null for
// anything else (another site's address, a data: URL, a page of Managira's own).
function keyOf(value) {
  const text = String(value || "").trim();
  if (!text) return null;
  const buckets = [bucketName(), ...legacyBuckets()].filter(Boolean).map((b) => b.toLowerCase());
  const s3Uri = text.match(/^s3:\/\/([^/]+)\/(.+)$/i);
  if (s3Uri) return buckets.includes(s3Uri[1].toLowerCase()) ? decodeKey(s3Uri[2]) : null;
  const absolute = text.match(/^https?:\/\/([^/]+)\/([^?#]+)/i);
  if (absolute) {
    const host = absolute[1].toLowerCase().replace(/:\d+$/, "");
    const path = absolute[2];
    const virtualHost = host.match(/^(.+)\.s3(?:[.-][a-z0-9-]+)?\.amazonaws\.com$/i);
    if (virtualHost) return buckets.includes(virtualHost[1].toLowerCase()) ? decodeKey(path) : null;
    if (/^s3(?:[.-][a-z0-9-]+)?\.amazonaws\.com$/i.test(host)) {
      const slash = path.indexOf("/");
      return slash > 0 && buckets.includes(path.slice(0, slash).toLowerCase()) ? decodeKey(path.slice(slash + 1)) : null;
    }
    return null;
  }
  if (text.startsWith("/") || text.startsWith("data:") || /^(?:https?:)?\/\//i.test(text)) return null;
  return text;
}

const isSafeKey = (key) => Boolean(key) && !String(key).split("/").some((part) => part === "." || part === "..");
const extensionOf = (key) => (String(key || "").match(/\.([a-z0-9]+)$/i) || [])[1] || "";
const isPublicKey = (key) => {
  const ext = extensionOf(key);
  return PUBLIC_PREFIXES.some((prefix) => String(key || "").startsWith(prefix))
    && (PUBLIC_EXTENSIONS.includes(ext) || PUBLIC_EXTENSIONS.includes(ext.toLowerCase()) && ext === ext.toUpperCase());
};

function publicUrl(key) {
  const bucket = bucketName();
  const region = regionName();
  const path = String(key).split("/").map(encodeURIComponent).join("/");
  if (!region || region === "us-east-1") return `https://${bucket}.s3.amazonaws.com/${path}`;
  return `https://${bucket}.s3.${region}.amazonaws.com/${path}`;
}

// A link to a stored file that works for `seconds` (5 minutes unless given; at most 7 days, the
// longest storage allows). A public image keeps its plain address; anything that isn't a stored
// file (another site's address) is returned as it was.
async function signedUrl(value, { seconds = 300, downloadName = null } = {}) {
  const key = keyOf(value);
  if (!key) return String(value || "");
  if (!isSafeKey(key)) return null;
  if (isPublicKey(key)) return publicUrl(key);
  const { getSignedUrl } = require("@aws-sdk/s3-request-presigner");
  const { s3Client } = require("../config/s3");
  const params = { Bucket: bucketName(), Key: key };
  if (downloadName) params.ResponseContentDisposition = `inline; filename="${String(downloadName).replace(/["\\\r\n]/g, "")}"`;
  return getSignedUrl(s3Client, new GetObjectCommand(params), { expiresIn: Math.max(60, Math.min(Number(seconds) || 300, 7 * 24 * 3600)) });
}

// The school a /files/... key belongs to (custom-forms/63/..., question-help/63/..., parent-resources/63/...).
function schoolOfKey(key) {
  const text = String(key || "");
  const prefix = SCHOOL_FILE_PREFIXES.find((p) => text.startsWith(p));
  if (!prefix) return null;
  const id = Number(text.slice(prefix.length).split("/")[0]);
  return Number.isInteger(id) && id > 0 ? id : null;
}

// Managira's own link to a school file: /files/<key>, opened only by someone signed in to that school.
const fileRoute = (key) => `/files/${String(key).split("/").map(encodeURIComponent).join("/")}`;

// The address a person is given for an uploaded school file ({ key, url } as stored with a form
// answer or a question's help): Managira's own link when the key is a school file, never the
// storage address. `absolute` adds the site's address, for a link that leaves the page (a CSV).
function fileLink(file, { absolute = false } = {}) {
  const key = file && typeof file === "object" ? String(file.key || "") : "";
  if (!key || !schoolOfKey(key) || !isSafeKey(key)) return "";
  const route = fileRoute(key);
  if (!absolute) return route;
  const base = String(process.env.BASE_URL_PRODUCTION || process.env.BASE_URL_PRODUCTION_FALLBACK || "https://managira.com").replace(/\/+$/, "");
  return `${base}${route}`;
}

// GET /files/<key>: a form answer, help on a question or a parent resource of the school the person
// is signed in to (staff, parent or student). Keys carry the school and a random name, so a link
// can't be guessed, and opening one from another school is refused.
async function serveSchoolFile(req, res) {
  const key = decodeKey(String(req.params[0] || ""));
  const school = schoolOfKey(key);
  const session = req.session || {};
  const signedInSchool = Number(session.organizationId) || null;
  // A person really signed in (staff, parent or student); a school id alone is not a sign-in.
  const signedIn = Boolean(session.userId || session.user || session.guardianId || session.studentId);
  if (!school || !isSafeKey(key) || !signedIn || signedInSchool !== school) return res.status(404).send("That file isn't available.");
  return redirectToFile(res, key);
}

// Sends the person to a stored file through a link that works for a few minutes (a page that has
// already checked who may open it: an admin page, a parent's own child).
async function redirectToFile(res, value, { downloadName = null } = {}) {
  try {
    const link = value ? await signedUrl(value, { seconds: 300, downloadName }) : null;
    if (!link) return res.status(404).send("That file isn't available.");
    res.set("Cache-Control", "private, no-store");
    res.set("Referrer-Policy", "no-referrer");
    return res.redirect(302, link);
  } catch (error) {
    console.error("[storedFiles] couldn't open a file:", error.name || error.message);
    return res.status(502).send("That file couldn't be opened. Try again.");
  }
}

module.exports = { PUBLIC_PREFIXES, PUBLIC_EXTENSIONS, SCHOOL_FILE_PREFIXES, keyOf, isPublicKey, isSafeKey, publicUrl, signedUrl, schoolOfKey, fileRoute, fileLink, serveSchoolFile, redirectToFile };
