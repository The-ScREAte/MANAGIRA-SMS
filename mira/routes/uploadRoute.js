// File attach - deliberately scoped: reads small text-based files
// (.txt/.csv/.md/.json) in memory and returns their content for the
// client to fold into the next chat message. No persistent storage, no
// document/image parsing pipeline (OCR, PDF extraction) - that's a
// meaningfully larger feature than this pass covers, and this endpoint
// says so clearly for anything else instead of silently doing nothing.
const express = require("express");
const router = express.Router();
const multer = require("multer");

const MAX_BYTES = 250 * 1024; // 250KB - plenty for a text attachment, small enough to fold into one prompt
const ALLOWED_EXTENSIONS = new Set([".txt", ".csv", ".md", ".json"]);

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_BYTES },
});

function getExtension(filename) {
  const match = /\.[^.]+$/.exec(filename || "");
  return match ? match[0].toLowerCase() : "";
}

router.post("/", upload.single("file"), (req, res) => {
  if (!req.file) {
    return res.status(400).json({ error: "No file uploaded." });
  }

  const ext = getExtension(req.file.originalname);
  if (!ALLOWED_EXTENSIONS.has(ext)) {
    return res.status(415).json({
      error: `Mira can currently only read text files (${[...ALLOWED_EXTENSIONS].join(", ")}). Support for other file types is on the way.`,
    });
  }

  const text = req.file.buffer.toString("utf8");
  return res.json({ filename: req.file.originalname, text, bytes: req.file.size });
});

router.use((err, req, res, next) => {
  if (err && err.code === "LIMIT_FILE_SIZE") {
    return res.status(413).json({ error: `File is too large - Mira can read attachments up to ${Math.round(MAX_BYTES / 1024)}KB right now.` });
  }
  console.error("[mira/uploadRoute]", err);
  return res.status(500).json({ error: "Unable to process the file." });
});

module.exports = router;
