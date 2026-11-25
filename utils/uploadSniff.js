"use strict";

// Checks what an uploaded file really is by its first bytes, so a name or a declared type can't
// disguise it: a ".pdf" that is a web page, a ".png" that is a script. Used for every upload
// (utils/uploadSafety.js hooks it into multer's storage engines, so it runs once the file has
// arrived). A kind this table doesn't know is left to the route's own rules.
const path = require("path");

const startsWith = (b, bytes, at = 0) => b.length >= at + bytes.length && bytes.every((v, i) => b[at + i] === v);
const ascii = (b, from, to) => b.subarray(from, to).toString("latin1");
const ZIP = (b) => startsWith(b, [0x50, 0x4b, 0x03, 0x04]) || startsWith(b, [0x50, 0x4b, 0x05, 0x06]);
const OLE = (b) => startsWith(b, [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]);
const JPEG = (b) => startsWith(b, [0xff, 0xd8, 0xff]);
const ftyp = (b) => ascii(b, 4, 8) === "ftyp";
const QT_ATOMS = ["moov", "mdat", "wide", "free", "skip", "pnot"];
const MP3 = (b) => ascii(b, 0, 3) === "ID3" || (b[0] === 0xff && (b[1] & 0xe0) === 0xe0);
const MATROSKA = (b) => startsWith(b, [0x1a, 0x45, 0xdf, 0xa3]);
const OGG = (b) => ascii(b, 0, 4) === "OggS";
const WAV = (b) => ascii(b, 0, 4) === "RIFF" && ascii(b, 8, 12) === "WAVE";
const MP4 = (b) => ftyp(b) || QT_ATOMS.includes(ascii(b, 4, 8));

// What a web page, script or picture-with-script begins with: never allowed as "text".
const MARKUP_START = /^\s*(?:<!--|<!doctype\s+html|<html|<head|<body|<script|<svg|<iframe|<meta|<link|<style|<\?php|<%)/i;

// Text: no NUL bytes (UTF-16 with its byte-order mark is fine) and not a web page.
function textProblem(b) {
  const head = b.subarray(0, 8192);
  const utf16 = (head[0] === 0xff && head[1] === 0xfe) || (head[0] === 0xfe && head[1] === 0xff);
  if (!utf16 && head.includes(0)) return "isn't text";
  const sample = utf16 ? Buffer.from(head.subarray(2)).toString(head[0] === 0xff ? "utf16le" : "latin1") : head.toString("utf8").replace(/^﻿/, "");
  if (MARKUP_START.test(sample)) return "is a web page, not a text file";
  return null;
}

const SIGNATURES = {
  ".pdf": (b) => b.subarray(0, 1024).includes("%PDF-"),
  ".png": (b) => startsWith(b, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  ".jpg": JPEG, ".jpeg": JPEG, ".jfif": JPEG,
  ".gif": (b) => ["GIF87a", "GIF89a"].includes(ascii(b, 0, 6)),
  ".webp": (b) => ascii(b, 0, 4) === "RIFF" && ascii(b, 8, 12) === "WEBP",
  ".bmp": (b) => ascii(b, 0, 2) === "BM",
  ".ico": (b) => startsWith(b, [0, 0, 1, 0]) || startsWith(b, [0, 0, 2, 0]),
  ".avif": ftyp, ".heic": ftyp, ".heif": ftyp,
  ".docx": ZIP, ".xlsx": ZIP, ".pptx": ZIP, ".odt": ZIP, ".ods": ZIP, ".odp": ZIP, ".zip": ZIP,
  ".doc": (b) => OLE(b) || ZIP(b) || ascii(b, 0, 5) === "{\\rtf",
  ".ppt": (b) => OLE(b) || ZIP(b),
  ".xls": (b) => OLE(b) || ZIP(b) || !textProblem(b), // some systems save a spreadsheet as plain text under .xls
  ".rtf": (b) => ascii(b, 0, 5) === "{\\rtf",
  ".mp3": MP3,
  ".m4a": MP4, ".mp4": MP4, ".m4v": MP4, ".mov": MP4,
  ".webm": MATROSKA, ".weba": MATROSKA,
  ".ogg": OGG, ".oga": OGG, ".ogv": OGG,
  ".wav": WAV,
  ".aac": (b) => MP3(b) || (b[0] === 0xff && (b[1] & 0xf0) === 0xf0),
};
const TEXT_TYPES = new Set([".txt", ".csv", ".tsv", ".json", ".xml"]);
// A file sent without an ending is judged by its declared picture type.
const FROM_MIME = { "image/png": ".png", "image/jpeg": ".jpg", "image/gif": ".gif", "image/webp": ".webp" };

// Words for a refusal, e.g. "a PDF".
const LABEL = (ext) => (TEXT_TYPES.has(ext) ? "a text file" : `a ${ext.slice(1).toUpperCase()} file`);

// null when the first bytes fit the file's kind (or the kind isn't known here); otherwise a short sentence.
function contentProblem({ originalname, mimetype } = {}, head) {
  let ext = path.extname(String(originalname || "")).toLowerCase();
  if (!ext) ext = FROM_MIME[String(mimetype || "").toLowerCase()] || "";
  const bytes = Buffer.isBuffer(head) ? head : Buffer.alloc(0);
  if (!bytes.length) return null; // nothing in it to run
  if (SIGNATURES[ext]) return SIGNATURES[ext](bytes) ? null : `That file isn't really ${LABEL(ext)}.`;
  if (TEXT_TYPES.has(ext)) {
    const problem = textProblem(bytes);
    if (problem) return `That file ${problem}.`;
    if (ext === ".json" && /^\s*[<]/.test(bytes.subarray(0, 64).toString("utf8"))) return "That file isn't JSON.";
  }
  return null;
}

module.exports = { contentProblem, textProblem, SIGNATURES };
