"use strict";

// Shared upload rules: a size cap (uploads are held in memory, so an unlimited
// file could crash the server) and an allow-list of file kinds. A file is accepted only when
// its extension is a known safe kind AND its declared type fits that kind; anything that can run
// code in a browser or on a computer (html, svg, js, exe, scripts...) is refused whatever its name.
const multer = require("multer");
const path = require("path");

// Safe extensions, by kind. `allow` on a route can add the extra kinds (archive, data).
const KINDS = {
  image: [".png", ".jpg", ".jpeg", ".jfif", ".gif", ".webp", ".avif", ".bmp", ".heic", ".heif", ".ico"],
  document: [".pdf", ".doc", ".docx", ".xls", ".xlsx", ".ppt", ".pptx", ".odt", ".ods", ".odp", ".rtf", ".txt", ".csv", ".tsv"],
  audio: [".mp3", ".m4a", ".wav", ".ogg", ".oga", ".aac", ".weba"],
  video: [".mp4", ".mov", ".m4v", ".webm", ".ogv"],
  archive: [".zip"],
  data: [".json", ".xml"],
};
const DEFAULT_KINDS = ["image", "document", "audio", "video"];
const kindOf = (ext) => Object.keys(KINDS).find((kind) => KINDS[kind].includes(ext)) || null;

// Kept as a second wall: types that run code, whatever the name says.
const BLOCKED_EXTENSIONS = new Set([
  ".html", ".htm", ".xhtml", ".svg", ".svgz", ".js", ".mjs", ".php", ".exe", ".msi", ".bat", ".cmd",
  ".sh", ".ps1", ".vbs", ".jar", ".dll", ".scr", ".com", ".app", ".dmg", ".apk",
]);
const BLOCKED_MIME = /^(text\/html|image\/svg|application\/(x-)?(javascript|ecmascript|msdownload|msdos-program|sh|php|java-archive|xhtml\+xml)|text\/javascript)/i;
// A phone or an old browser sometimes sends no type, or a generic one.
const GENERIC_MIME = /^(application\/octet-stream|binary\/octet-stream|)$/i;
// What each kind of picture, sound or video may be called by the browser.
const FAMILY_MIME = { image: /^image\//i, audio: /^(audio|video)\//i, video: /^(video|audio)\//i };

function isBlockedFile(file) {
  const ext = path.extname(String(file.originalname || "")).toLowerCase();
  return BLOCKED_EXTENSIONS.has(ext) || BLOCKED_MIME.test(String(file.mimetype || ""));
}

// Whether the file is an allowed kind: a known extension, and a declared type that fits it.
function isAllowedFile(file, kinds = DEFAULT_KINDS) {
  if (isBlockedFile(file)) return false;
  const ext = path.extname(String(file.originalname || "")).toLowerCase();
  const mime = String(file.mimetype || "").trim();
  // A picture, sound or video sent without a file name's ending (a camera capture, a cropped photo) is judged by its declared type.
  const kind = kindOf(ext) || (!ext && /^(image|audio|video)\//i.test(mime) ? mime.split("/")[0] : null);
  if (!kind || !kinds.includes(kind)) return false;
  if (GENERIC_MIME.test(mime)) return true;
  if (FAMILY_MIME[kind]) return FAMILY_MIME[kind].test(mime);
  // Documents are named many ways by browsers (a CSV as application/vnd.ms-excel); a document may not be a picture, sound or video.
  return !/^(image|audio|video)\//i.test(mime);
}

function safeFileFilter(kinds) {
  const list = Array.isArray(kinds) ? kinds : DEFAULT_KINDS;
  return (req, file, cb) => {
    if (!isAllowedFile(file, list)) {
      const error = new multer.MulterError("LIMIT_UNEXPECTED_FILE", file.fieldname);
      error.message = "That file type isn't allowed.";
      error.blockedType = true;
      return cb(error);
    }
    return cb(null, true);
  };
}

// Options to spread into multer({...}). maxMb: per-file limit.
// kinds: which kinds of file the route takes (default: pictures, documents, sound, video; add
// "archive" or "data" where a route really reads them, or give only ["document"] for imports).
function safeUploadOptions({ maxMb = 15, maxFiles = 20, kinds = DEFAULT_KINDS } = {}) {
  return {
    limits: { fileSize: maxMb * 1024 * 1024, files: maxFiles },
    fileFilter: safeFileFilter(kinds),
  };
}

// Every multer storage engine (memory and disk) checks a file's first bytes once it has arrived
// (utils/uploadSniff.js): a name or declared type can't disguise another kind of file. One patch
// here covers every upload route, whatever storage it uses.
function sniffArrivedFiles() {
  const sniff = require("./uploadSniff");
  const fs = require("fs");
  const engines = [require("multer/storage/memory")(), require("multer/storage/disk")({})];
  for (const engine of engines) {
    const proto = Object.getPrototypeOf(engine);
    if (proto.__managiraSniffed) continue;
    const original = proto._handleFile;
    proto.__managiraSniffed = true;
    proto._handleFile = function handleAndCheck(req, file, cb) {
      return original.call(this, req, file, (error, info) => {
        if (error) return cb(error);
        const refuse = (message) => {
          const problem = new multer.MulterError("LIMIT_UNEXPECTED_FILE", file.fieldname);
          problem.message = message;
          problem.blockedType = true;
          problem.contentMismatch = true;
          return problem;
        };
        if (info && Buffer.isBuffer(info.buffer)) {
          const message = sniff.contentProblem(file, info.buffer.subarray(0, 8192));
          return message ? cb(refuse(message)) : cb(null, info);
        }
        const where = info && info.path;
        if (!where) return cb(null, info);
        fs.open(where, "r", (openError, fd) => {
          if (openError) return cb(null, info);
          const head = Buffer.alloc(8192);
          fs.read(fd, head, 0, 8192, 0, (readError, count) => {
            fs.close(fd, () => {});
            const message = readError ? null : sniff.contentProblem(file, head.subarray(0, count));
            if (!message) return cb(null, info);
            fs.unlink(where, () => cb(refuse(message)));
          });
        });
      });
    };
  }
}
sniffArrivedFiles();

// Friendly message for upload errors (used by the global error handler).
function uploadErrorMessage(err) {
  if (!err || err.name !== "MulterError") return null;
  if (err.contentMismatch) return err.message;
  if (err.blockedType) return "That file type isn't allowed.";
  if (err.code === "LIMIT_FILE_SIZE") return "That file is too large.";
  if (err.code === "LIMIT_FILE_COUNT") return "Too many files at once.";
  return "That upload couldn't be accepted.";
}

module.exports = { safeUploadOptions, safeFileFilter, isBlockedFile, isAllowedFile, uploadErrorMessage, KINDS, DEFAULT_KINDS };
