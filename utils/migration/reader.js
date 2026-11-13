"use strict";
// Reads what a school uploads for its data migration, whatever its system exported: CSV, tab-
// (or semicolon- or pipe-) separated text, Excel workbooks (.xlsx, each sheet a list of its own)
// and .zip files of any of these. Text is read in whatever encoding it came in (UTF-8, UTF-16 or
// Windows-1252, as older Windows exports are). Runs on the reader worker thread
// (utils/migration/readerWorker.js), never on the server's main thread.
const zlib = require("zlib");
const Papa = require("papaparse");

const MAX_ROWS = 200000; // per list
const MAX_ZIP_ENTRIES = 2000;
const MAX_EXPANDED_BYTES = 400 * 1024 * 1024; // everything a .zip or workbook may unpack to
const SAMPLE_ROWS = 500;
const DELIMITERS = [",", "\t", ";", "|"];
const TEXT_TYPES = /\.(csv|tsv|txt|tab|dat)$/i;
const LIST_TYPES = /\.(csv|tsv|txt|tab|dat|xlsx)$/i;
// Any file that isn't a list is a document: kept as it is (utils/migration/documents.js).
const documentOf = (name, path, content, note = null) => ({ name, path: path || name, document: true, content, note });

const isZip = (buf) => buf.length > 4 && buf[0] === 0x50 && buf[1] === 0x4b && buf[2] === 0x03 && buf[3] === 0x04;
const isOldExcel = (buf) => buf.length > 8 && buf[0] === 0xd0 && buf[1] === 0xcf && buf[2] === 0x11 && buf[3] === 0xe0;
const isPdf = (buf) => buf.length > 4 && buf.subarray(0, 4).toString("latin1") === "%PDF";

function decoderFor(label) {
  try { return new TextDecoder(label); } catch (_e) { return null; }
}
// Text in the encoding it was saved in: a byte-order mark says so; UTF-16 without one shows as
// every other byte empty; anything that isn't valid UTF-8 is read as Windows-1252.
function decode(buf) {
  if (buf[0] === 0xef && buf[1] === 0xbb && buf[2] === 0xbf) return buf.subarray(3).toString("utf8");
  if (buf[0] === 0xff && buf[1] === 0xfe) return decoderFor("utf-16le").decode(buf.subarray(2));
  if (buf[0] === 0xfe && buf[1] === 0xff) return (decoderFor("utf-16be") || decoderFor("utf-16le")).decode(buf.subarray(2));
  const head = buf.subarray(0, Math.min(buf.length, 1000));
  let evenZero = 0;
  let oddZero = 0;
  for (let i = 0; i < head.length; i += 1) if (head[i] === 0) { if (i % 2) oddZero += 1; else evenZero += 1; }
  if (head.length > 20 && oddZero > head.length * 0.3 && evenZero < head.length * 0.02) return decoderFor("utf-16le").decode(buf);
  if (head.length > 20 && evenZero > head.length * 0.3 && oddZero < head.length * 0.02) return (decoderFor("utf-16be") || decoderFor("utf-16le")).decode(buf);
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(buf);
  } catch (_e) {
    const latin = decoderFor("windows-1252");
    return latin ? latin.decode(buf) : buf.toString("latin1");
  }
}

// A list's heading row and rows. Papa works out the separator from the text itself.
function parseText(text, { limit = MAX_ROWS } = {}) {
  const result = Papa.parse(String(text || ""), {
    header: true, skipEmptyLines: "greedy", delimitersToGuess: DELIMITERS, transformHeader: (h) => String(h || "").replace(/^﻿/, "").trim(),
  });
  const header = (result.meta.fields || []).filter(Boolean);
  return { header, rows: result.data.slice(0, limit), total: result.data.length, delimiter: result.meta.delimiter };
}

function describe(name, text) {
  if (/\u0000/.test(text.slice(0, 4000))) return { name, error: "That isn't a text or spreadsheet file. Export it as CSV or Excel." };
  const { header, rows, total } = parseText(text);
  if (header.length < 2 || !rows.length) return { name, error: "No columns or rows were found. Check it has a heading row." };
  return { name, text, header, rowCount: Math.min(total, MAX_ROWS), cut: total > MAX_ROWS, sample: rows.slice(0, SAMPLE_ROWS) };
}

// An Excel value as the text a CSV export would hold (dates as YYYY-MM-DD).
function cellText(value) {
  if (value === null || value === undefined) return "";
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? "" : value.toISOString().slice(0, 10);
  if (typeof value === "object") {
    if (Array.isArray(value.richText)) return value.richText.map((t) => t.text || "").join("");
    if (value.text !== undefined) return String(value.text);
    if (value.result !== undefined) return cellText(value.result);
    return "";
  }
  return String(value);
}

// Each sheet with a heading row and rows becomes a list. The whole workbook is read on the reader
// thread, whose memory is capped: a workbook too big for it stops the thread, never the server.
async function readWorkbook(name, buf) {
  const ExcelJS = require("exceljs");
  const book = new ExcelJS.Workbook();
  await book.xlsx.load(buf, { ignoreNodes: ["dataValidations", "conditionalFormatting", "hyperlinks", "drawing", "picture", "legacyDrawing"] });
  const sheets = [];
  book.eachSheet((sheet) => {
    const rows = [];
    sheet.eachRow({ includeEmpty: false }, (row) => {
      if (rows.length > MAX_ROWS) return;
      const values = (Array.isArray(row.values) ? row.values.slice(1) : []).map(cellText);
      if (values.some((v) => v.trim())) rows.push(values);
    });
    if (rows.length < 2) return;
    const width = Math.max(...rows.slice(0, 50).map((r) => r.length));
    const text = Papa.unparse(rows.map((r) => (r.length < width ? [...r, ...Array(width - r.length).fill("")] : r.slice(0, width))));
    sheets.push(describe(`${name} › ${sheet.name}`, text));
  });
  return sheets.length ? sheets : [{ name, error: "The workbook has no sheet with a heading row and rows." }];
}

async function readZip(name, buf, depth) {
  const JSZip = require("jszip");
  const zip = await JSZip.loadAsync(buf);
  const entries = Object.values(zip.files).filter((f) => !f.dir && !/(^|\/)(__MACOSX|\.)/.test(f.name));
  if (zip.files["xl/workbook.xml"]) return readWorkbook(name, buf); // an .xlsx saved under another name
  if (entries.length > MAX_ZIP_ENTRIES) return [{ name, error: `The .zip holds ${entries.length} files; send at most ${MAX_ZIP_ENTRIES} at a time.` }];
  const declared = entries.reduce((sum, f) => sum + Number((f._data && f._data.uncompressedSize) || 0), 0);
  if (declared > MAX_EXPANDED_BYTES) return [{ name, error: "The .zip unpacks to more than 400 MB. Send it in parts." }];
  const out = [];
  let expanded = 0;
  for (const entry of entries) {
    const inner = `${name} › ${entry.name.split("/").pop()}`;
    const content = await entry.async("nodebuffer");
    expanded += content.length;
    if (expanded > MAX_EXPANDED_BYTES) { out.push({ name: inner, error: "The .zip unpacks to more than 400 MB. Send it in parts." }); break; }
    if (!LIST_TYPES.test(entry.name) && !/\.zip$/i.test(entry.name)) { out.push(documentOf(inner, entry.name, content)); continue; }
    out.push(...(await expand(inner, content, depth + 1, entry.name)));
  }
  return out.length ? out : [{ name, error: "The .zip has no files in it." }];
}

// One upload, as the lists it holds: [{ name, text, header, rowCount, sample }] or { name, error }.
async function expand(name, buf, depth = 0, path = null) {
  if (!buf || !buf.length) return [{ name, error: "That file is empty." }];
  if (isOldExcel(buf)) return [documentOf(name, path, buf, "An older Excel file (.xls): kept as a document. To import it as a list, save it as .xlsx or CSV.")];
  if (isPdf(buf)) return [documentOf(name, path, buf)];
  if (!isZip(buf) && !LIST_TYPES.test(String(path || name).split("›").pop().trim())) return [documentOf(name, path, buf)];
  if (isZip(buf)) {
    if (depth > 1) return [{ name, error: "A .zip inside a .zip inside a .zip: unpack it first." }];
    try {
      return /\.xlsx$/i.test(name) ? await readWorkbook(name, buf) : await readZip(name, buf, depth);
    } catch (error) {
      return [{ name, error: /\.xlsx$/i.test(name) ? "The workbook couldn't be read. Open it in Excel and save it again, or export as CSV." : "The .zip couldn't be opened." }];
    }
  }
  const list = describe(name, decode(buf));
  // A .txt that isn't a list is a note: kept as a document.
  if (list.error && /\.txt$/i.test(String(path || name))) return [documentOf(name, path, buf)];
  return [list];
}

// The rows of a stored list (gzip when `compressed`), as arrays in heading order, a chunk at a time.
// Parsed as arrays (lighter than an object per row); the heading row is read the same way as on
// upload, so its names (repeated ones renamed) match the columns already matched.
function* rowChunks(content, compressed, size = 5000) {
  const text = decode(compressed ? zlib.gunzipSync(content) : content);
  const all = Papa.parse(text, { header: false, skipEmptyLines: "greedy", delimitersToGuess: DELIMITERS });
  const head = Papa.parse(text, { header: true, preview: 1, skipEmptyLines: "greedy", delimiter: all.meta.delimiter, transformHeader: (h) => String(h || "").replace(/^\uFEFF/, "").trim() });
  const header = head.meta.fields || [];
  const rows = all.data.slice(1, MAX_ROWS + 1);
  all.data = null;
  for (let i = 0; i < rows.length; i += size) yield { header, offset: i, total: rows.length, rows: rows.slice(i, i + size) };
  if (!rows.length) yield { header, offset: 0, total: 0, rows: [] };
}

module.exports = { expand, decode, parseText, rowChunks, cellText, MAX_ROWS, SAMPLE_ROWS };
