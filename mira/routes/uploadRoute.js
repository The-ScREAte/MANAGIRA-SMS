// File attach - reads a wide range of document types in memory and
// returns extracted text for the client to fold into the next chat
// message, or (for images) a base64 data URL the client sends along
// with the chat request as a vision input. No persistent storage.
// Accepts multiple files in one request; each is resolved independently
// so one bad file in a batch doesn't fail the rest.
const express = require("express");
const router = express.Router();
const multer = require("multer");
const pdfParse = require("pdf-parse");
const mammoth = require("mammoth");
const ExcelJS = require("exceljs");

const MAX_BYTES = 5 * 1024 * 1024; // 5MB per file - PDFs/docx/images are bulkier than plain text
const MAX_FILES = 5;
const MAX_TEXT_CHARS = 20000; // keep extracted content small enough to fold into one prompt

const TEXT_EXTENSIONS = new Set([
  ".txt", ".csv", ".tsv", ".md", ".json", ".log",
  ".yml", ".yaml", ".xml", ".html", ".htm", ".rtf",
]);
const DOCUMENT_EXTENSIONS = new Set([".pdf", ".docx", ".xlsx"]);
// Older binary Office formats Mira can't read - named so the message can
// say exactly what to do instead.
const LEGACY_FORMATS = { ".xls": "an Excel .xlsx or .csv file", ".doc": "a Word .docx or PDF file", ".ppt": "a PDF file", ".pptx": "a PDF file" };
const IMAGE_MIME_TYPES = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
};
const IMAGE_EXTENSIONS = new Set(Object.keys(IMAGE_MIME_TYPES));
const ALLOWED_EXTENSIONS = new Set([...TEXT_EXTENSIONS, ...DOCUMENT_EXTENSIONS, ...IMAGE_EXTENSIONS]);

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_BYTES },
});

function getExtension(filename) {
  const match = /\.[^.]+$/.exec(filename || "");
  return match ? match[0].toLowerCase() : "";
}

// Spreadsheets become one "Sheet: name" section per worksheet, one row per
// line with cells separated by " | ", so the model can read tables (class
// lists, score sheets) the way they look in Excel.
function excelCellText(cell) {
  const value = cell.value;
  if (value === null || value === undefined) return "";
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  if (typeof value === "object") {
    if (value.richText) return value.richText.map((part) => part.text).join("");
    if (value.text !== undefined) return String(value.text);
    if (value.result !== undefined) return String(value.result);
    if (value.error) return String(value.error);
  }
  return String(value);
}

async function extractExcelText(buffer) {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(buffer);
  const sections = [];
  workbook.eachSheet((sheet) => {
    const lines = [];
    sheet.eachRow({ includeEmpty: false }, (row) => {
      const cells = [];
      for (let column = 1; column <= row.cellCount; column += 1) cells.push(excelCellText(row.getCell(column)).trim());
      while (cells.length && !cells[cells.length - 1]) cells.pop();
      if (cells.some(Boolean)) lines.push(cells.join(" | "));
    });
    if (lines.length) sections.push(`Sheet: ${sheet.name} (${lines.length} rows)\n${lines.join("\n")}`);
  });
  return sections.join("\n\n");
}

async function extractText(file, ext) {
  if (TEXT_EXTENSIONS.has(ext)) return file.buffer.toString("utf8");
  if (ext === ".pdf") {
    const data = await pdfParse(file.buffer);
    return data.text;
  }
  if (ext === ".docx") {
    const result = await mammoth.extractRawText({ buffer: file.buffer });
    return result.value;
  }
  if (ext === ".xlsx") return extractExcelText(file.buffer);
  return null;
}

async function processFile(file) {
  const ext = getExtension(file.originalname);
  if (LEGACY_FORMATS[ext]) {
    return {
      filename: file.originalname,
      error: `Mira can't read ${ext} files. Please save it as ${LEGACY_FORMATS[ext]} and attach that instead.`,
    };
  }
  if (!ALLOWED_EXTENSIONS.has(ext)) {
    return {
      filename: file.originalname,
      error: `Mira can't read that file type yet${ext ? ` (${ext})` : ""}. Supported: ${[...ALLOWED_EXTENSIONS].join(", ")}.`,
    };
  }

  if (IMAGE_EXTENSIONS.has(ext)) {
    const mimeType = file.mimetype && file.mimetype.startsWith("image/") ? file.mimetype : IMAGE_MIME_TYPES[ext];
    const dataUrl = `data:${mimeType};base64,${file.buffer.toString("base64")}`;
    return { filename: file.originalname, kind: "image", mimeType, dataUrl, bytes: file.size };
  }

  try {
    let text = String((await extractText(file, ext)) || "");
    // A PDF that is only a scanned image has no text layer to read.
    if (!text.trim()) {
      return {
        filename: file.originalname,
        error: ext === ".pdf"
          ? "This PDF has no readable text (it looks like a scanned image). Attach a photo/screenshot of the page instead, or a text PDF, Word or Excel version."
          : "This file is empty - there's nothing in it for Mira to read.",
      };
    }
    if (text.length > MAX_TEXT_CHARS) {
      text = text.slice(0, MAX_TEXT_CHARS) + "\n\n[Content truncated - the file is longer than Mira can read in one go.]";
    }
    return { filename: file.originalname, kind: "text", text, bytes: file.size };
  } catch (error) {
    console.error("[mira/uploadRoute] extraction failed:", error.message);
    return { filename: file.originalname, error: "Unable to read that file - it may be corrupted or password-protected." };
  }
}

router.post("/", upload.array("files", MAX_FILES), async (req, res) => {
  if (!req.files || !req.files.length) {
    return res.status(400).json({ error: "No file uploaded." });
  }

  const results = await Promise.all(req.files.map(processFile));
  return res.json({ results });
});

router.use((err, req, res, next) => {
  if (err && err.code === "LIMIT_FILE_SIZE") {
    return res.status(413).json({ error: `A file is too large - Mira can read attachments up to ${Math.round(MAX_BYTES / (1024 * 1024))}MB each right now.` });
  }
  if (err && (err.code === "LIMIT_FILE_COUNT" || err.code === "LIMIT_UNEXPECTED_FILE")) {
    // multer's .array(field, max) throws LIMIT_UNEXPECTED_FILE (not
    // LIMIT_FILE_COUNT) once more than `max` files arrive under the same
    // field name - confirmed directly against this version. Both map to
    // the same "too many files" message.
    return res.status(413).json({ error: `Too many files at once - Mira can read up to ${MAX_FILES} attachments per message.` });
  }
  console.error("[mira/uploadRoute]", err);
  return res.status(500).json({ error: "Unable to process the file." });
});

module.exports = router;
