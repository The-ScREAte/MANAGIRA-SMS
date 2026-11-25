"use strict";

// The heavy spreadsheet work: building an .xlsx and reading one. These are pure functions
// (plain data in, plain data or bytes out) so utils/cpuPool.js can run them on a worker thread
// and keep the web server's event loop free for everybody else. With CPU_WORKERS=0 they run
// right here, as they always did. Nothing in this file touches the database.

// ---- Report Builder: the Excel file ----
// spec: { reportTitle, title, columns: [{ key, label, type }], header }
// values: one array per row, already formatted for export, in the columns' order.
// With a header, the school's details sit above the table: logo top-left, then name, address,
// phone and date beside it.
async function buildReportWorkbook({ spec, values }) {
  const ExcelJS = require("exceljs");
  const { reportTitle, title, columns, header } = spec;
  // The row limits (utils/reportBuilder.js) keep real exports well under this; it stops a
  // freak request from asking the thread for more memory than it has.
  if (values.length * Math.max(columns.length, 1) > 3000000) throw Object.assign(new Error("That report is too big for one Excel file. Add a filter or download it as CSV."), { status: 413 });
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet(reportTitle.slice(0, 31));
  sheet.columns = columns.map((column) => ({
    key: column.key,
    width: Math.min(Math.max(column.label.length + 4, 14), 48),
  }));

  let headerRow = 1;
  if (header) {
    const logo = header.logo ? { ...header.logo, buffer: Buffer.from(header.logo.buffer) } : null;
    const lines = [
      header.orgName && { text: header.orgName, font: { bold: true, size: 15 } },
      header.address && { text: header.address, font: { size: 10, color: { argb: "FF4B5563" } } },
      header.phone && { text: header.phone, font: { size: 10, color: { argb: "FF4B5563" } } },
      { text: title, font: { bold: true, size: 12 } },
      header.date && { text: `Generated ${header.date}`, font: { size: 10, color: { argb: "FF6B7280" } } },
    ].filter(Boolean);
    const centered = header.align === "center";
    const logoHeight = 56;
    const logoWidth = logo ? Math.round((logo.width / logo.height) * logoHeight) : 0;
    let firstTextRow = 1;
    if (logo) {
      const imageId = workbook.addImage({ buffer: logo.buffer, extension: logo.extension });
      if (centered) {
        // Logo above the text, in the middle of the table's width.
        const widths = columns.map((_, index) => (sheet.getColumn(index + 1).width || 14) * 7);
        let x = Math.max(widths.reduce((sum, width) => sum + width, 0) / 2 - logoWidth / 2, 0);
        let col = 0;
        while (col < widths.length - 1 && x > widths[col]) { x -= widths[col]; col += 1; }
        sheet.addImage(imageId, { tl: { col: col + x / widths[col], row: 0.1 }, ext: { width: logoWidth, height: logoHeight }, editAs: "oneCell" });
        sheet.getRow(1).height = 46;
        firstTextRow = 2;
      } else {
        sheet.getColumn(1).width = Math.max(sheet.getColumn(1).width || 14, Math.ceil(logoWidth / 7) + 2);
        sheet.addImage(imageId, { tl: { col: 0.15, row: 0.15 }, ext: { width: logoWidth, height: logoHeight }, editAs: "oneCell" });
      }
    }
    const textColumn = logo && !centered ? 2 : 1;
    lines.forEach((line, index) => {
      const rowNumber = firstTextRow + index;
      const row = sheet.getRow(rowNumber);
      if (centered && columns.length > 1) sheet.mergeCells(rowNumber, 1, rowNumber, columns.length);
      const cell = row.getCell(textColumn);
      cell.value = line.text;
      cell.font = line.font;
      if (centered) cell.alignment = { horizontal: "center" };
      row.height = index === 0 ? 22 : 16;
    });
    headerRow = centered
      ? firstTextRow + lines.length + 1
      : Math.max(lines.length, logo ? 4 : 0) + 2;
  }

  const head = sheet.getRow(headerRow);
  columns.forEach((column, index) => { head.getCell(index + 1).value = column.label; });
  head.font = { bold: true };
  head.eachCell((cell) => { cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFF1F5F9" } }; });
  values.forEach((record, rowIndex) => {
    const row = sheet.getRow(headerRow + 1 + rowIndex);
    columns.forEach((column, index) => {
      const value = record[index];
      if (column.type === "link") {
        // A clickable "Open in Managira" in the sheet.
        if (value) {
          row.getCell(index + 1).value = { text: "Open in Managira", hyperlink: value };
          row.getCell(index + 1).font = { color: { argb: "FF0F766E" }, underline: true };
        }
        return;
      }
      // Text that looks like a formula is stored as plain text.
      row.getCell(index + 1).value = typeof value === "string" && /^[\s]*[=+\-@]/.test(value) ? `'${value}` : value;
    });
  });
  columns.forEach((column, index) => {
    if (column.type === "money") sheet.getColumn(index + 1).numFmt = "#,##0.00";
  });
  sheet.views = [{ state: "frozen", ySplit: headerRow }];
  sheet.autoFilter = { from: { row: headerRow, column: 1 }, to: { row: headerRow, column: columns.length } };
  return Buffer.from(await workbook.xlsx.writeBuffer());
}

// ---- Reading a workbook ----
// Every sheet's non-empty rows as { rowNumber, values }, where values is ExcelJS's row.values
// (index 0 is empty). Takes { buffer } or { path }.
async function readSheetRows({ buffer, path }) {
  const ExcelJS = require("exceljs");
  const workbook = new ExcelJS.Workbook();
  if (buffer) await workbook.xlsx.load(Buffer.from(buffer));
  else if (path) await workbook.xlsx.readFile(path);
  else throw new Error("File data not accessible");
  return workbook.worksheets.map((sheet) => {
    const rows = [];
    sheet.eachRow({ includeEmpty: false }, (row, rowNumber) => { rows.push({ rowNumber, values: row.values }); });
    return { name: sheet.name, rows };
  });
}

// ---- Documents: bring an .xlsx in as an editable sheet (values, merges, fonts, fills, borders, widths) ----
function argbToHex(argb) {
  if (!argb || typeof argb !== "string") return "";
  const hex = argb.length === 8 ? argb.slice(2) : argb;
  return /^[0-9a-f]{6}$/i.test(hex) ? "#" + hex.toLowerCase() : "";
}
function parseCell(id) {
  const m = String(id).match(/^([A-Z]+)(\d+)$/);
  if (!m) return null;
  let c = 0;
  for (const ch of m[1]) c = c * 26 + (ch.charCodeAt(0) - 64);
  return { r: Number(m[2]) - 1, c: c - 1 };
}
const colLabel = (n) => { let s = ""; while (n >= 0) { s = String.fromCharCode(65 + (n % 26)) + s; n = Math.floor(n / 26) - 1; } return s; };

async function importSheet({ buffer }) {
  const ExcelJS = require("exceljs");
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(Buffer.from(buffer));
  const ws = wb.worksheets.find((w) => w.state !== "hidden") || wb.worksheets[0];
  if (!ws) throw Object.assign(new Error("This file has no sheets."), { status: 400 });
  const maxRows = Math.min(ws.rowCount || 0, 600), maxCols = Math.min(ws.columnCount || 0, 80);
  const cells = {}, styles = {}, colWidths = {}, merges = [];
  for (let r = 1; r <= maxRows; r++) {
    const row = ws.getRow(r);
    for (let c = 1; c <= maxCols; c++) {
      const cell = row.getCell(c);
      const id = colLabel(c - 1) + r;
      let v = cell.value;
      if (v && typeof v === "object") {
        if (v.richText) v = v.richText.map((t) => t.text).join("");
        else if (v.formula || v.sharedFormula) v = v.result !== undefined && v.result !== null ? v.result : "";
        else if (v.text) v = v.text;
        else if (v instanceof Date) v = v.toISOString().slice(0, 10);
        else if (v.hyperlink) v = v.text || v.hyperlink;
        else v = "";
      }
      if (v !== null && v !== undefined && v !== "") cells[id] = String(v);
      const st = {};
      const f = cell.font || {};
      if (f.bold) st.b = 1;
      if (f.italic) st.i = 1;
      if (f.underline) st.u = 1;
      if (f.size && Math.round(f.size) !== 11) st.fs = Math.round(f.size * 1.33);
      const color = argbToHex(f.color && f.color.argb);
      if (color && color !== "#000000") st.color = color;
      const fill = cell.fill || {};
      const bg = fill.type === "pattern" && fill.pattern !== "none" ? argbToHex(fill.fgColor && fill.fgColor.argb) : "";
      if (bg && bg !== "#ffffff") st.bg = bg;
      const al = cell.alignment && cell.alignment.horizontal;
      if (al === "center" || al === "centerContinuous") st.align = "center";
      else if (al === "right") st.align = "right";
      const b = cell.border || {};
      const bd = (b.top && b.top.style ? "t" : "") + (b.bottom && b.bottom.style ? "b" : "") + (b.left && b.left.style ? "l" : "") + (b.right && b.right.style ? "r" : "");
      if (bd) st.bd = bd;
      if (Object.keys(st).length) styles[id] = st;
    }
  }
  for (let c = 1; c <= maxCols; c++) {
    const w = ws.getColumn(c).width;
    if (w) colWidths[c - 1] = Math.max(30, Math.min(600, Math.round(w * 7 + 5)));
  }
  const rangeList = (ws.model && ws.model.merges) || [];
  rangeList.forEach((ref) => {
    const [a, b] = String(ref).split(":");
    const p = parseCell(a), q = parseCell(b || a);
    if (p && q && p.r < maxRows && p.c < maxCols) merges.push({ r: p.r, c: p.c, rs: q.r - p.r + 1, cs: q.c - p.c + 1 });
  });
  return { cells, styles, colWidths, merges, rowCount: Math.max(maxRows + 5, 20), colCount: Math.max(maxCols, 10), name: ws.name };
}

module.exports = { buildReportWorkbook, readSheetRows, importSheet };
