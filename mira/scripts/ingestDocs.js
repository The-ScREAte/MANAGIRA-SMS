// One-off/rerunnable ingestion of Managira's own documentation into
// Mira's RAG store, so the assistant can answer "how do I do X in
// Managira" questions with real, sourced content instead of guessing.
// Source PDFs (../../docs/*.pdf) are purpose-built Q&A knowledge bases
// already maintained alongside the app - this just indexes them.
//
// Stored under tenantId 0, a reserved "global" scope (see
// vectorStore.js's search()) so every school's Mira session can draw on
// it, not just one tenant's. Real organization IDs are always > 0, so 0
// never collides with a real school.
//
// Usage: node scripts/ingestDocs.js
require("dotenv").config({ path: require("path").resolve(__dirname, "../../.env") });
const fs = require("fs");
const path = require("path");
const pdfParse = require("pdf-parse");
const { reindexSource } = require("../services/ragService");

const GLOBAL_TENANT_ID = 0;

const SOURCES = [
  { file: path.resolve(__dirname, "../../docs/Managira_Chatbot_Knowledge.pdf"), sourceType: "managira_docs" },
  { file: path.resolve(__dirname, "../../docs/Managira_FAQ.pdf"), sourceType: "managira_docs" },
];

// Each entry looks like:
//   Q12. <question, may wrap lines>
//   <answer, may wrap lines>
//   ID: 12
//   Keywords: a, b, c
// Category sections look like "<Name>\n<N> items" right before their
// first "Q1." - tracked as we scan so each chunk can carry its category.
function parseEntries(text, fileLabel) {
  const lines = text.split("\n");
  let currentCategory = "General";
  const categoryHeaderRe = /^(\d+)\s+items?$/;
  const entryStartRe = /^Q(\d+)\.\s*(.*)$/;
  const idLineRe = /^ID:\s*(\d+)$/;
  const keywordsLineRe = /^Keywords:\s*(.*)$/;

  const entries = [];
  let current = null;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;

    if (categoryHeaderRe.test(line) && i > 0) {
      currentCategory = lines[i - 1].trim() || currentCategory;
      continue;
    }

    const startMatch = line.match(entryStartRe);
    if (startMatch) {
      if (current) entries.push(current);
      current = { id: `${fileLabel}-${startMatch[1]}`, category: currentCategory, lines: [line] };
      continue;
    }

    if (!current) continue;

    const idMatch = line.match(idLineRe);
    const keywordsMatch = line.match(keywordsLineRe);
    if (idMatch || keywordsMatch) {
      // Metadata lines aren't useful chunk content - drop them, entry is complete.
      continue;
    }
    current.lines.push(line);
  }
  if (current) entries.push(current);

  return entries.map((e) => ({
    id: e.id,
    content: `Category: ${e.category}\n${e.lines.join(" ")}`,
  }));
}

async function main() {
  let total = 0;
  for (const source of SOURCES) {
    if (!fs.existsSync(source.file)) {
      console.log(`[ingestDocs] skipping missing file: ${source.file}`);
      continue;
    }
    const buf = fs.readFileSync(source.file);
    const { text } = await pdfParse(buf);
    const fileLabel = path.basename(source.file, ".pdf");
    const entries = parseEntries(text, fileLabel);
    console.log(`[ingestDocs] ${fileLabel}: ${entries.length} entries`);

    for (const entry of entries) {
      await reindexSource({
        tenantId: GLOBAL_TENANT_ID,
        sourceType: source.sourceType,
        sourceId: entry.id,
        content: entry.content,
      });
      total++;
    }
  }
  console.log(`[ingestDocs] done - indexed ${total} chunks total`);
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error("[ingestDocs] failed:", err);
    process.exit(1);
  });
