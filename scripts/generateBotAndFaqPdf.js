/**
 * Generates two PDFs in the project root:
 *  - Managira_Chatbot_Knowledge.pdf  (every Q&A the chatbot can answer, word-for-word)
 *  - Managira_FAQ.pdf                (every Q&A on the public /legal/FAQ page, word-for-word)
 *
 * Run with:  node scripts/generateBotAndFaqPdf.js
 */

const fs = require("fs");
const path = require("path");
const PDFDocument = require("pdfkit");

const ROOT = path.resolve(__dirname, "..");
const OUT_DIR = path.join(ROOT, "docs");
if (!fs.existsSync(OUT_DIR)) fs.mkdirSync(OUT_DIR, { recursive: true });

// ---------------------------------------------------------------------------
// Shared PDF helpers
// ---------------------------------------------------------------------------

function newDoc(title) {
  const doc = new PDFDocument({
    size: "LETTER",
    margins: { top: 60, bottom: 60, left: 60, right: 60 },
    info: {
      Title: title,
      Author: "Managira",
      Subject: title,
      Creator: "Managira generateBotAndFaqPdf.js",
    },
  });
  return doc;
}

function writeCover(doc, title, subtitle, generatedAt) {
  doc.font("Helvetica-Bold").fontSize(28).fillColor("#0f766e").text(title, { align: "left" });
  doc.moveDown(0.3);
  doc.font("Helvetica").fontSize(13).fillColor("#334155").text(subtitle);
  doc.moveDown(0.5);
  doc.font("Helvetica").fontSize(10).fillColor("#64748b").text(`Generated: ${generatedAt}`);
  doc.moveDown(1);
  doc.strokeColor("#cbd5e1").lineWidth(1).moveTo(60, doc.y).lineTo(552, doc.y).stroke();
  doc.moveDown(1);
}

function writeCategoryHeader(doc, name, count) {
  if (doc.y > 720) doc.addPage();
  doc.moveDown(0.4);
  doc.font("Helvetica-Bold").fontSize(15).fillColor("#0f766e").text(name);
  doc.font("Helvetica").fontSize(10).fillColor("#64748b").text(`${count} item${count === 1 ? "" : "s"}`);
  doc.moveDown(0.3);
  doc.strokeColor("#e2e8f0").lineWidth(0.6).moveTo(60, doc.y).lineTo(552, doc.y).stroke();
  doc.moveDown(0.5);
}

function writeQA(doc, idx, total, q, a, extras) {
  // Page break heuristic.
  if (doc.y > 700) doc.addPage();

  doc.font("Helvetica-Bold").fontSize(11).fillColor("#0f172a").text(`Q${idx}. ${q}`, {
    width: 492,
    paragraphGap: 4,
  });
  doc.font("Helvetica").fontSize(10.5).fillColor("#1e293b").text(a, {
    width: 492,
    paragraphGap: 6,
    align: "left",
  });
  if (extras && extras.length) {
    for (const ex of extras) {
      doc.font("Helvetica-Oblique").fontSize(9).fillColor("#64748b").text(ex, {
        width: 492,
        paragraphGap: 2,
      });
    }
  }
  doc.moveDown(0.5);
  doc.fillColor("#000");
}

// ---------------------------------------------------------------------------
// 1. Chatbot Knowledge PDF (from utils/managiraFAQ.js)
// ---------------------------------------------------------------------------

function generateChatbotPdf() {
  const faqs = require(path.join(ROOT, "utils", "managiraFAQ.js"));
  if (!Array.isArray(faqs)) throw new Error("managiraFAQ.js did not export an array");

  const outPath = path.join(OUT_DIR, "Managira_Chatbot_Knowledge.pdf");
  const doc = newDoc("Managira Chatbot Knowledge Base");
  doc.pipe(fs.createWriteStream(outPath));

  const generatedAt = new Date().toISOString();
  writeCover(
    doc,
    "Managira Chatbot Knowledge Base",
    `Every question and answer the in-app assistant can respond to. Total entries: ${faqs.length}.`,
    generatedAt
  );

  // Group by category, preserve insertion order.
  const order = [];
  const grouped = new Map();
  for (const f of faqs) {
    const cat = f.category || "Uncategorized";
    if (!grouped.has(cat)) {
      grouped.set(cat, []);
      order.push(cat);
    }
    grouped.get(cat).push(f);
  }

  // Table of contents (simple list).
  doc.font("Helvetica-Bold").fontSize(12).fillColor("#0f172a").text("Categories");
  doc.moveDown(0.3);
  for (const cat of order) {
    doc.font("Helvetica").fontSize(10).fillColor("#334155")
      .text(`• ${cat}  (${grouped.get(cat).length})`, { indent: 12 });
  }
  doc.addPage();

  // Body.
  let counter = 1;
  for (const cat of order) {
    const items = grouped.get(cat);
    writeCategoryHeader(doc, cat, items.length);
    for (const item of items) {
      const extras = [];
      if (item.id !== undefined) extras.push(`ID: ${item.id}`);
      if (Array.isArray(item.keywords) && item.keywords.length) {
        extras.push(`Keywords: ${item.keywords.join(", ")}`);
      }
      writeQA(doc, counter, faqs.length, item.question || "", item.answer || "", extras);
      counter += 1;
    }
  }

  // Footer pages numbering (after content).
  const range = doc.bufferedPageRange();
  for (let i = 0; i < range.count; i++) {
    doc.switchToPage(range.start + i);
    doc.font("Helvetica").fontSize(9).fillColor("#94a3b8")
      .text(`Page ${i + 1} of ${range.count}`, 60, 760, { align: "center", width: 492 });
  }

  doc.end();
  return new Promise((resolve, reject) => {
    doc.on("end", () => resolve(outPath));
    doc.on("error", reject);
  });
}

// ---------------------------------------------------------------------------
// 2. Public FAQ PDF (from views/legal&Compliance/FAQ.ejs)
// ---------------------------------------------------------------------------

function decodeHtmlEntities(str) {
  return String(str)
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&apos;/g, "'")
    .replace(/&nbsp;/g, " ")
    .replace(/&mdash;/g, "—")
    .replace(/&ndash;/g, "–")
    .replace(/&hellip;/g, "…")
    .replace(/&rsquo;/g, "\u2019")
    .replace(/&lsquo;/g, "\u2018")
    .replace(/&rdquo;/g, "\u201D")
    .replace(/&ldquo;/g, "\u201C")
    .replace(/&copy;/g, "©")
    .replace(/&reg;/g, "®")
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
    .replace(/&#x([0-9a-fA-F]+);/g, (_, n) => String.fromCharCode(parseInt(n, 16)));
}

function stripTags(html) {
  return decodeHtmlEntities(String(html).replace(/<[^>]*>/g, "")).replace(/\s+/g, " ").trim();
}

function parseFaqEjs(filePath) {
  const src = fs.readFileSync(filePath, "utf8");

  // Find each <div class="faq-category" ...>...</div> block. We do this by
  // locating `<div class="faq-category"` start markers, then extracting until
  // we hit `</div>\n      </div>` (closing the category container). Easier
  // reliable approach: split on the marker and take chunks until next marker
  // or the end-of-categories marker.
  const categories = [];

  // The whole faq area: from first `<div class="faq-categories">` to its closing? Use simpler: regex over each category block.
  const catBlockRe =
    /<div\s+class="faq-category"[^>]*>([\s\S]*?)<\/div>\s*<\/div>\s*(?=<div\s+class="faq-category"|<\/div>\s*<div\s+class="help-cta"|<\/div>\s*<\/main|<\/div>\s*$)/g;

  // Fallback simpler approach: capture each category lazily from h2 to next h2 or close.
  const simpleSplit = src.split(/<div\s+class="faq-category"[^>]*>/);
  // simpleSplit[0] = preamble, [1..] = category contents starting after the opening tag
  for (let i = 1; i < simpleSplit.length; i++) {
    const chunk = simpleSplit[i];
    // Cut at the next `<div class="faq-category"` (already split) OR at the closing of the .faq-categories container.
    // We'll truncate chunk at the LAST `</div>` followed by another category — but since we already split, we just need to drop the trailing closing `</div>` for this category container (the category div).
    // Detect heading
    const h2Match = chunk.match(/<h2[^>]*>([\s\S]*?)<\/h2>/);
    const heading = h2Match ? stripTags(h2Match[1]) : "Uncategorized";

    // Each Q/A pair is structured as:
    //   <div class="faq-item">
    //     <div class="faq-question">Q TEXT</div>
    //     <div class="faq-answer">A TEXT</div>
    //   </div>
    const items = [];
    const itemRe = /<div\s+class="faq-question"[^>]*>([\s\S]*?)<\/div>\s*<div\s+class="faq-answer"[^>]*>([\s\S]*?)<\/div>/g;
    let m;
    while ((m = itemRe.exec(chunk)) !== null) {
      items.push({
        question: stripTags(m[1]),
        answer: stripTags(m[2]),
      });
    }

    if (items.length) categories.push({ heading, items });
  }

  return categories;
}

function generateFaqPdf() {
  const faqEjsPath = path.join(ROOT, "views", "legal&Compliance", "FAQ.ejs");
  const categories = parseFaqEjs(faqEjsPath);
  const totalItems = categories.reduce((s, c) => s + c.items.length, 0);

  const outPath = path.join(OUT_DIR, "Managira_FAQ.pdf");
  const doc = newDoc("Managira Public FAQ");
  doc.pipe(fs.createWriteStream(outPath));

  writeCover(
    doc,
    "Managira Public FAQ",
    `Every question and answer published on the public Help Centre. Total entries: ${totalItems}.`,
    new Date().toISOString()
  );

  doc.font("Helvetica-Bold").fontSize(12).fillColor("#0f172a").text("Categories");
  doc.moveDown(0.3);
  for (const cat of categories) {
    doc.font("Helvetica").fontSize(10).fillColor("#334155")
      .text(`• ${cat.heading}  (${cat.items.length})`, { indent: 12 });
  }
  doc.addPage();

  let counter = 1;
  for (const cat of categories) {
    writeCategoryHeader(doc, cat.heading, cat.items.length);
    for (const item of cat.items) {
      writeQA(doc, counter, totalItems, item.question, item.answer);
      counter += 1;
    }
  }

  const range = doc.bufferedPageRange();
  for (let i = 0; i < range.count; i++) {
    doc.switchToPage(range.start + i);
    doc.font("Helvetica").fontSize(9).fillColor("#94a3b8")
      .text(`Page ${i + 1} of ${range.count}`, 60, 760, { align: "center", width: 492 });
  }

  doc.end();
  return new Promise((resolve, reject) => {
    doc.on("end", () => resolve(outPath));
    doc.on("error", reject);
  });
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

(async () => {
  try {
    const a = await generateChatbotPdf();
    const b = await generateFaqPdf();
    console.log("Wrote:", a);
    console.log("Wrote:", b);
  } catch (err) {
    console.error("PDF generation failed:", err);
    process.exit(1);
  }
})();
