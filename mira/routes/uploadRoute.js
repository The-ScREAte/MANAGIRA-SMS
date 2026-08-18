// File attach - reads a wide range of document types in memory and
// returns extracted text for the client to fold into the next chat
// message. No persistent storage. Plain-text formats are read as-is;
// PDF and Word documents are parsed to extract their text content.
const express = require("express");
const router = express.Router();
const multer = require("multer");
const pdfParse = require("pdf-parse");
const mammoth = require("mammoth");

const MAX_BYTES = 5 * 1024 * 1024; // 5MB - PDFs/docx are bulkier than plain text
const MAX_TEXT_CHARS = 20000; // keep extracted content small enough to fold into one prompt

const TEXT_EXTENSIONS = new Set([
  ".txt", ".csv", ".tsv", ".md", ".json", ".log",
  ".yml", ".yaml", ".xml", ".html", ".htm", ".rtf",
]);
const DOCUMENT_EXTENSIONS = new Set([".pdf", ".docx"]);
const ALLOWED_EXTENSIONS = new Set([...TEXT_EXTENSIONS, ...DOCUMENT_EXTENSIONS]);

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_BYTES },
});

function getExtension(filename) {
  const match = /\.[^.]+$/.exec(filename || "");
  return match ? match[0].toLowerCase() : "";
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
  return null;
}

router.post("/", upload.single("file"), async (req, res) => {
  if (!req.file) {
    return res.status(400).json({ error: "No file uploaded." });
  }

  const ext = getExtension(req.file.originalname);
  if (!ALLOWED_EXTENSIONS.has(ext)) {
    return res.status(415).json({
      error: `Mira can't read that file type yet${ext ? ` (${ext})` : ""}. Supported: ${[...ALLOWED_EXTENSIONS].join(", ")}.`,
    });
  }

  let text;
  try {
    text = await extractText(req.file, ext);
  } catch (error) {
    console.error("[mira/uploadRoute] extraction failed:", error.message);
    return res.status(422).json({ error: "Unable to read that file - it may be corrupted or password-protected." });
  }

  if (text.length > MAX_TEXT_CHARS) {
    text = text.slice(0, MAX_TEXT_CHARS) + "\n\n[Content truncated - the file is longer than Mira can read in one go.]";
  }

  return res.json({ filename: req.file.originalname, text, bytes: req.file.size });
});

router.use((err, req, res, next) => {
  if (err && err.code === "LIMIT_FILE_SIZE") {
    return res.status(413).json({ error: `File is too large - Mira can read attachments up to ${Math.round(MAX_BYTES / (1024 * 1024))}MB right now.` });
  }
  console.error("[mira/uploadRoute]", err);
  return res.status(500).json({ error: "Unable to process the file." });
});

module.exports = router;
