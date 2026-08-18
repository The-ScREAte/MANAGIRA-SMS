// One-off/rerunnable ingestion of Managira's own documentation into
// Mira's RAG store, so the assistant can answer "how do I do X in
// Managira" questions with real, sourced content (and a real, correct
// link) instead of guessing.
//
// Two sources:
// 1. The live help-center articles (documentation_articles table),
//    pulled through the internal API like every other piece of
//    Managira business data Mira touches - the canonical,
//    always-current source, each with a real URL embedded directly in
//    its indexed content so retrieval can cite it exactly.
// 2. The supplementary FAQ/chatbot-knowledge PDFs (../../docs/*.pdf) -
//    still useful for phrasing/coverage, kept as a secondary source.
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
const { callInternalApi } = require("../internalApiClient");

const GLOBAL_TENANT_ID = 0;
const DOCS_BASE_URL = "https://managira.com/legal/user-documentation";

const SOURCES = [
  { file: path.resolve(__dirname, "../../docs/Managira_Chatbot_Knowledge.pdf"), sourceType: "managira_docs" },
  { file: path.resolve(__dirname, "../../docs/Managira_FAQ.pdf"), sourceType: "managira_docs" },
];

// Minimal HTML-to-text: strip tags, keep paragraph/list/heading breaks as
// newlines, decode the handful of entities these articles actually use.
// Good enough for embedding - not trying to be a general HTML parser.
function htmlToText(html) {
  return String(html || "")
    .replace(/<(script|style)[^>]*>[\s\S]*?<\/\1>/gi, " ")
    .replace(/<\/(p|div|h[1-6]|li|tr|blockquote|br)>/gi, "\n")
    .replace(/<li[^>]*>/gi, "- ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/[ \t]+/g, " ")
    .replace(/\n\s+/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

async function ingestLiveDocumentation() {
  const { articles } = await callInternalApi("/internal/api/documentation");
  console.log(`[ingestDocs] live documentation_articles: ${articles.length} articles`);
  for (const article of articles) {
    const url = `${DOCS_BASE_URL}/${article.slug}`;
    const plainText = htmlToText(article.content_html);
    const content =
      `Title: ${article.title}\n` +
      `URL: ${url}\n` +
      `Topic: ${article.topic}${article.subtopic ? " > " + article.subtopic : ""}\n\n` +
      plainText;
    await reindexSource({
      tenantId: GLOBAL_TENANT_ID,
      sourceType: "managira_docs_live",
      sourceId: article.slug,
      content,
    });
  }
  return articles.length;
}

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

  try {
    total += await ingestLiveDocumentation();
  } catch (error) {
    console.error("[ingestDocs] failed to ingest live documentation_articles:", error.message);
  }

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
