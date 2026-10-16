"use strict";

// Shared upload rules: a size cap (uploads are held in memory, so an unlimited
// file could crash the server) and a block on file types that run code in a
// browser or on a computer.
const multer = require("multer");
const path = require("path");

const BLOCKED_EXTENSIONS = new Set([
  ".html", ".htm", ".xhtml", ".js", ".mjs", ".php", ".exe", ".msi", ".bat", ".cmd",
  ".sh", ".ps1", ".vbs", ".jar", ".dll", ".scr", ".com", ".app", ".dmg", ".apk",
]);
const BLOCKED_MIME = /^(text\/html|application\/(x-)?(javascript|ecmascript|msdownload|msdos-program|sh|php|java-archive|xhtml\+xml)|text\/javascript)/i;

function isBlockedFile(file) {
  const ext = path.extname(String(file.originalname || "")).toLowerCase();
  return BLOCKED_EXTENSIONS.has(ext) || BLOCKED_MIME.test(String(file.mimetype || ""));
}

function safeFileFilter(req, file, cb) {
  if (isBlockedFile(file)) {
    const error = new multer.MulterError("LIMIT_UNEXPECTED_FILE", file.fieldname);
    error.message = "That file type isn't allowed.";
    error.blockedType = true;
    return cb(error);
  }
  return cb(null, true);
}

// Options to spread into multer({...}). maxMb: per-file limit.
function safeUploadOptions({ maxMb = 15, maxFiles = 20 } = {}) {
  return {
    limits: { fileSize: maxMb * 1024 * 1024, files: maxFiles },
    fileFilter: safeFileFilter,
  };
}

// Friendly message for upload errors (used by the global error handler).
function uploadErrorMessage(err) {
  if (!err || err.name !== "MulterError") return null;
  if (err.blockedType) return "That file type isn't allowed.";
  if (err.code === "LIMIT_FILE_SIZE") return "That file is too large.";
  if (err.code === "LIMIT_FILE_COUNT") return "Too many files at once.";
  return "That upload couldn't be accepted.";
}

module.exports = { safeUploadOptions, safeFileFilter, isBlockedFile, uploadErrorMessage };
