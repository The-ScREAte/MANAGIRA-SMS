"use strict";

// Makes school website uploads light before they are stored:
//  - photos: turned upright, at most 2400px wide, saved as WebP (quality 80);
//  - videos: at most 1280px wide (720p), H.264 at a modest quality, AAC sound,
//    ready to start playing before it has fully downloaded, plus a poster frame.
// Large phone videos (often 50-200 MB) usually come out at 5-15% of their size.
const fs = require("fs");
const os = require("os");
const path = require("path");
const crypto = require("crypto");
const { execFile } = require("child_process");
const sharp = (...args) => require("sharp")(...args); // loaded on first use
const multer = require("multer");
const db = require("../config/db");

const ffmpegPath = (() => { try { return require("ffmpeg-static"); } catch (_e) { return null; } })();

const IMAGE_MAX_WIDTH = 2400;
const VIDEO_MAX_MB = 300;
const VIDEO_MAX_SECONDS = 180;

const isVideo = (file) => /^video\//i.test(String(file && file.mimetype));
const isImage = (file) => /^image\//i.test(String(file && file.mimetype)) && !/svg/i.test(String(file.mimetype));

// Uploads for the website gallery/slideshow go to a temp folder (videos are too
// big to hold in memory); only photos and videos are accepted.
const websiteMediaUpload = multer({
  storage: multer.diskStorage({
    destination: os.tmpdir(),
    filename: (req, file, cb) => cb(null, `mgr-upload-${crypto.randomBytes(8).toString("hex")}`),
  }),
  limits: { fileSize: VIDEO_MAX_MB * 1024 * 1024, files: 20 },
  fileFilter: (req, file, cb) => {
    if (isImage(file) || isVideo(file)) return cb(null, true);
    const error = new multer.MulterError("LIMIT_UNEXPECTED_FILE", file.fieldname);
    error.message = "Only photos and videos can be added to the website.";
    error.blockedType = true;
    return cb(error);
  },
});

// Upload middleware for the website settings form: problems become a clear
// message on the same page instead of a generic error.
function websiteMediaFields(field, back = "/account/managePublicContent") {
  const handler = websiteMediaUpload.array(field);
  return (req, res, next) => handler(req, res, (error) => {
    if (!error) return next();
    removeTempFiles(req.files);
    const message = error.blockedType ? "Only photos (JPG, PNG, WebP, GIF) and videos (MP4, MOV, WebM) can be added to the website."
      : error.code === "LIMIT_FILE_SIZE" ? `Each photo or video can be up to ${VIDEO_MAX_MB} MB.`
      : error.code === "LIMIT_FILE_COUNT" ? "Add up to 20 files at a time."
      : "That upload couldn't be accepted. Please try again.";
    if (typeof req.flash === "function") req.flash("error", message);
    return res.redirect(back);
  });
}

async function optimizeImage(input) {
  const buffer = await sharp(input, { failOn: "none" })
    .rotate()
    .resize({ width: IMAGE_MAX_WIDTH, withoutEnlargement: true })
    .webp({ quality: 80 })
    .toBuffer();
  return { buffer, mimetype: "image/webp", ext: ".webp" };
}

function run(args) {
  return new Promise((resolve, reject) => {
    if (!ffmpegPath) return reject(new Error("Video processing is not available on this server."));
    const child = execFile(ffmpegPath, args, { maxBuffer: 1024 * 1024 * 8, timeout: 10 * 60 * 1000 }, (error, stdout, stderr) => {
      if (error) return reject(Object.assign(new Error("The video could not be processed."), { detail: String(stderr).slice(-600) }));
      return resolve();
    });
    // Pages come first: the video only gets the CPU when the server isn't busy.
    try { os.setPriority(child.pid, 19); } catch (_) {}
  });
}

// Returns { buffer, mimetype, ext, poster: { buffer, mimetype, ext } }.
async function optimizeVideo(inputPath) {
  const out = path.join(os.tmpdir(), `mgr-video-${crypto.randomBytes(8).toString("hex")}.mp4`);
  const still = path.join(os.tmpdir(), `mgr-poster-${crypto.randomBytes(8).toString("hex")}.jpg`);
  try {
    await run([
      "-y", "-i", inputPath, "-t", String(VIDEO_MAX_SECONDS),
      "-vf", "scale='min(1280,iw)':-2:flags=lanczos,fps=30",
      "-c:v", "libx264", "-threads", "2", "-preset", "veryfast", "-crf", "28", "-profile:v", "high", "-pix_fmt", "yuv420p",
      "-c:a", "aac", "-b:a", "96k", "-ac", "2",
      "-movflags", "+faststart", out,
    ]);
    await run(["-y", "-ss", "1", "-i", out, "-frames:v", "1", still]).catch(() => run(["-y", "-i", out, "-frames:v", "1", still]));
    const buffer = await fs.promises.readFile(out);
    const poster = await optimizeImage(await fs.promises.readFile(still));
    return { buffer, mimetype: "video/mp4", ext: ".mp4", poster };
  } finally {
    fs.promises.unlink(out).catch(() => {});
    fs.promises.unlink(still).catch(() => {});
  }
}

// One uploaded file -> what to store. file is a multer disk file.
async function optimizeUpload(file) {
  if (isVideo(file)) return { type: "video", ...(await optimizeVideo(file.path)) };
  if (isImage(file)) {
    const original = await fs.promises.readFile(file.path);
    // GIFs keep their animation; anything sharp can't read is kept as it is.
    if (/gif/i.test(file.mimetype)) return { type: "image", buffer: original, mimetype: file.mimetype, ext: ".gif" };
    const optimized = await optimizeImage(original).catch(() => null);
    return { type: "image", ...(optimized || { buffer: original, mimetype: file.mimetype, ext: path.extname(file.originalname || "") || ".jpg" }) };
  }
  throw Object.assign(new Error("Only photos and videos can be added to the website."), { status: 400 });
}

const removeTempFiles = (files) => (files || []).forEach((f) => f && f.path && fs.promises.unlink(f.path).catch(() => {}));

// organization_images keeps photos and videos; videos also keep a poster image.
let schemaPromise = null;
function ensureMediaColumns(database = db) {
  if (!schemaPromise) {
    schemaPromise = database.query(`
      ALTER TABLE organization_images ADD COLUMN IF NOT EXISTS media_type VARCHAR(10) NOT NULL DEFAULT 'image';
      ALTER TABLE organization_images ADD COLUMN IF NOT EXISTS poster_url TEXT;
    `).catch((error) => { schemaPromise = null; throw error; });
  }
  return schemaPromise;
}

module.exports = { websiteMediaUpload, websiteMediaFields, optimizeImage, optimizeVideo, optimizeUpload, removeTempFiles, ensureMediaColumns, isVideo, isImage, VIDEO_MAX_MB };
