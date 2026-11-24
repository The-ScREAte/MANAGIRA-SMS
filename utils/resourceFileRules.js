"use strict";
// Files a teacher attaches to a test (notes, worksheets, pictures): which kinds are allowed, how big,
// and whether the file really is what its name says (its first bytes), not just its extension.
const MAX_BYTES = 10 * 1024 * 1024;

const TYPES = {
  ".pdf": (b) => b.slice(0, 4).toString("latin1") === "%PDF",
  ".docx": (b) => b.slice(0, 4).equals(Buffer.from([0x50, 0x4b, 0x03, 0x04])),
  ".pptx": (b) => b.slice(0, 4).equals(Buffer.from([0x50, 0x4b, 0x03, 0x04])),
  ".xlsx": (b) => b.slice(0, 4).equals(Buffer.from([0x50, 0x4b, 0x03, 0x04])),
  ".doc": (b) => b.slice(0, 4).equals(Buffer.from([0xd0, 0xcf, 0x11, 0xe0])),
  ".ppt": (b) => b.slice(0, 4).equals(Buffer.from([0xd0, 0xcf, 0x11, 0xe0])),
  ".xls": (b) => b.slice(0, 4).equals(Buffer.from([0xd0, 0xcf, 0x11, 0xe0])),
  ".png": (b) => b.slice(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])),
  ".jpg": (b) => b[0] === 0xff && b[1] === 0xd8,
  ".jpeg": (b) => b[0] === 0xff && b[1] === 0xd8,
  ".gif": (b) => ["GIF87a", "GIF89a"].includes(b.slice(0, 6).toString("latin1")),
  ".webp": (b) => b.slice(0, 4).toString("latin1") === "RIFF" && b.slice(8, 12).toString("latin1") === "WEBP",
  ".txt": (b) => !b.slice(0, 4096).includes(0),
};

// null when the file is fine; otherwise a short sentence for the teacher.
function checkResourceFile(file) {
  if (!file || !Buffer.isBuffer(file.buffer)) return "Choose a file first.";
  const name = String(file.originalname || "");
  const ext = (name.match(/\.[^.\\/]+$/) || [""])[0].toLowerCase();
  const matches = TYPES[ext];
  if (!matches) return "Use a PDF, Word, PowerPoint, Excel, picture or text file.";
  const size = Number.isFinite(file.size) ? file.size : file.buffer.length;
  if (size > MAX_BYTES) return "Use a file under 10 MB.";
  if (!file.buffer.length || !matches(file.buffer)) return "That file doesn't look like a " + ext.slice(1).toUpperCase() + " file.";
  return null;
}

module.exports = { checkResourceFile, MAX_BYTES, ALLOWED: Object.keys(TYPES) };
