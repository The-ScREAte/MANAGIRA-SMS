const {
  REPORTS,
  FAMILIES,
  FEATURES,
  GROUP_ORDER,
  PAGE_SIZES,
  PAGE_SIZE,
  MAX_EXPORT_ROWS,
  getReport,
  allowedBy,
  ownRowsFor,
  normalizeColumns,
  normalizeCriteria,
  buildQueries,
} = require("../utils/reportBuilder");
const { userHasPermission } = require("../middleware/permissionMiddleware");
const { getMessagingChannelStatus } = require("../utils/guardianMessaging");
const releaseFeatures = require("../utils/shards/features");
const { normalizeBranding, loadReportHeader } = require("../utils/reportBranding");

const elevatedRoles = new Set(["organization", "manager", "supervisor", "admin", "mini admin"]);
// Weekly covers any set of weekdays (every day, every other day, ...).
const FREQUENCIES = new Set(["weekly", "monthly"]);
const FORMATS = new Set(["xlsx", "csv", "docx"]);
const reportTemplates = require("../utils/reportTemplates");
// Morning 3 AM–11 AM or evening 4 PM–10 PM, school time.
const SEND_HOURS = new Set([3, 4, 5, 6, 7, 8, 9, 10, 11, 16, 17, 18, 19, 20, 21, 22]);
let reportSchemaPromise;

// Additive only: saved reports, who they are shared with, and email schedules.
async function ensureReportSchema(db) {
  if (!reportSchemaPromise) {
    reportSchemaPromise = db.query(`
      CREATE TABLE IF NOT EXISTS custom_report_definitions (
        report_id BIGSERIAL PRIMARY KEY,
        organization_id INTEGER NOT NULL,
        created_by INTEGER,
        report_name VARCHAR(120) NOT NULL,
        report_type VARCHAR(40) NOT NULL,
        columns_json JSONB NOT NULL,
        criteria_json JSONB NOT NULL DEFAULT '{}'::jsonb,
        created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
      );
      CREATE INDEX IF NOT EXISTS idx_custom_report_definitions_org_created
        ON custom_report_definitions (organization_id, created_at DESC);
      ALTER TABLE custom_report_definitions ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ;
      ALTER TABLE custom_report_definitions ADD COLUMN IF NOT EXISTS branding_json JSONB NOT NULL DEFAULT '{}'::jsonb;
      CREATE TABLE IF NOT EXISTS custom_report_shares (
        report_id BIGINT NOT NULL REFERENCES custom_report_definitions(report_id) ON DELETE CASCADE,
        user_id INTEGER NOT NULL,
        shared_by INTEGER,
        created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
        PRIMARY KEY (report_id, user_id)
      );
      CREATE INDEX IF NOT EXISTS idx_custom_report_shares_user ON custom_report_shares (user_id);
      CREATE TABLE IF NOT EXISTS custom_report_favorites (
        report_id BIGINT NOT NULL REFERENCES custom_report_definitions(report_id) ON DELETE CASCADE,
        user_id INTEGER NOT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
        PRIMARY KEY (report_id, user_id)
      );
      CREATE TABLE IF NOT EXISTS custom_report_schedules (
        report_id BIGINT PRIMARY KEY REFERENCES custom_report_definitions(report_id) ON DELETE CASCADE,
        organization_id INTEGER NOT NULL,
        frequency VARCHAR(10) NOT NULL CHECK (frequency IN ('daily', 'weekly', 'monthly')),
        weekday SMALLINT CHECK (weekday BETWEEN 0 AND 6),
        month_day SMALLINT CHECK (month_day BETWEEN 1 AND 31),
        file_format VARCHAR(4) NOT NULL DEFAULT 'xlsx',
        include_shared BOOLEAN NOT NULL DEFAULT FALSE,
        last_sent_on DATE,
        last_error TEXT,
        created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
      );
      ALTER TABLE custom_report_schedules ADD COLUMN IF NOT EXISTS send_hour SMALLINT NOT NULL DEFAULT 7;
      ALTER TABLE custom_report_schedules ADD COLUMN IF NOT EXISTS weekdays SMALLINT[];
      ALTER TABLE custom_report_schedules DROP CONSTRAINT IF EXISTS custom_report_schedules_file_format_check;
      ALTER TABLE custom_report_schedules ADD CONSTRAINT custom_report_schedules_file_format_check
        CHECK (file_format IN ('xlsx', 'csv', 'docx'));
      ALTER TABLE custom_report_schedules DROP CONSTRAINT IF EXISTS custom_report_schedules_send_hour_check;
      ALTER TABLE custom_report_schedules ADD CONSTRAINT custom_report_schedules_send_hour_check
        CHECK (send_hour BETWEEN 0 AND 23);
    `).catch((error) => {
      reportSchemaPromise = null;
      throw error;
    });
  }
  await reportSchemaPromise;
}

const positiveInt = (value) => {
  const number = Number(value);
  return Number.isInteger(number) && number > 0 ? number : null;
};

// Who is asking, from a signed-in request or (for scheduled emails) a user row.
function identityFromRequest(req) {
  const session = req.session || {};
  return {
    userId: positiveInt(session.user?.user_id || session.userId),
    userRole: session.userRole || session.user?.account_type || null,
    accountType: session.accountType || session.user?.account_type || null,
    organizationId: positiveInt(session.organizationId),
    userEmail: session.user?.email || null,
    name: [session.firstName, session.lastName].filter(Boolean).join(" "),
  };
}

function isElevated(identity) {
  return [identity.userRole, identity.accountType]
    .map((role) => String(role || "").trim().toLowerCase())
    .some((role) => elevatedRoles.has(role));
}

// Long column lists fold into groups by topic (first matching rule wins);
// a topic needs at least two columns, and short reports stay one list.
const COLUMN_GROUPS = [
  ["Scoring", /subject scaling|counted/i],
  ["Summary", /^totals$/i],
  ["Remarks", /remark|comment|notes/i],
  ["Conduct & attitude", /conduct|attitude|interest/i],
  ["Promotion", /promot/i],
  ["Teachers & staff", /teacher|teaches|marked by|answered by|supervisor|created by|sent by|received by|assigned to|username|^role$|job title|employee/i],
  ["Parent / guardian", /parent|guardian|relationship|children|child/i],
  ["Transportation", /bus |bus$|pickup/i],
  ["Attendance", /absent|absence|present|attendance|days marked/i],
  ["Fees & payments", /fee|balance|billed|paid|payment|^bill|reference|method|amount/i],
  ["Scores & grades", /grade|position|percentage|score|total|average|out of|best subject|weakest subject|^subject|category|assessment|test/i],
  ["Student", /^student|gender|birth|born|^age$|^class$|class size|applicant|^name$|first name|last name|class applied|^classes$/i],
  ["Contact", /email|phone|address|hometown|recipient|channel/i],
  ["Dates & status", /between|^date|status|school year|^term|not active|due|left|joined|enrol|missing details|reason for leaving|submitted|added|created|posted|received|resolved|signed|last login|last active|^day$|^time$|end date|failed|failures|last reply|minutes taken|^done$/i],
  ["Messages & notices", /message|priority|replies|announcement|audience|event|details|reason|belongs to|location/i],
  ["Activity", /log|record|^user$|action|area|task|^type$|^activity$/i],
];
function topicGroups(columns, minimum = 12, everyItem = false) {
  if (columns.length < minimum) return columns;
  const topicOf = (column) => column.group || (COLUMN_GROUPS.find(([, rule]) => rule.test(column.label)) || [""])[0];
  const counts = {};
  columns.forEach((column) => { const t = topicOf(column); if (t) counts[t] = (counts[t] || 0) + 1; });
  return columns.map((column) => {
    const topic = topicOf(column);
    if (everyItem) return { ...column, group: topic || "More" };
    return { ...column, group: topic && (column.group || counts[topic] >= 2) ? topic : "" };
  });
}

function describeReport(key, report, granted) {
  const allowed = allowedBy(granted);
  return {
    key,
    title: report.title,
    variant: report.variant,
    columns: topicGroups(Object.entries(report.columns).filter(([, column]) => allowed(column)).map(([columnKey, column]) => ({
      key: columnKey,
      label: column.label,
      type: column.type || "text",
      group: column.group || "",
    })), 0, true),
    defaultCriteria: report.defaultCriteria || [],
    defaultColumns: report.defaultColumns.filter((columnKey) => allowed(report.columns[columnKey])),
    criteria: topicGroups((report.criteria || []).filter(allowed).map((criterion) => ({
      key: criterion.key,
      label: criterion.label,
      type: criterion.type,
      options: criterion.options || null,
      hasOptions: Boolean(criterion.optionsSql),
      dependsOn: criterion.dependsOn || null,
      group: criterion.group || "",
    })), 0, true),
  };
}

function csvCell(value) {
  const text = value === null || value === undefined ? "" : String(value);
  const safe = /^[\s]*[=+\-@]/.test(text) ? `'${text}` : text;
  return `"${safe.replace(/"/g, '""')}"`;
}

function exportValue(value, type) {
  if (value === null || value === undefined) return "";
  if (value instanceof Date) {
    return type === "datetime" ? value.toISOString().slice(0, 16).replace("T", " ") : value.toISOString().slice(0, 10);
  }
  if (["number", "money"].includes(type) && value !== "" && Number.isFinite(Number(value))) return Number(value);
  return value;
}

function toCsv(rows, columns, report) {
  const headers = columns.map((key) => csvCell(report.columns[key].label)).join(",");
  const lines = rows.map((row) => columns.map((key) => csvCell(exportValue(row[key], report.columns[key].type))).join(","));
  return `﻿${[headers, ...lines].join("\r\n")}`;
}

// Excel file. With a header, the school's details sit above the table:
// logo top-left, then name, address, phone and date beside it.
async function toWorkbook(rows, columns, report, { title = report.title, header = null } = {}) {
  const ExcelJS = require("exceljs");
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet(report.title.slice(0, 31));
  sheet.columns = columns.map((key) => ({
    key,
    width: Math.min(Math.max(report.columns[key].label.length + 4, 14), 48),
  }));

  let headerRow = 1;
  if (header) {
    const lines = [
      header.orgName && { text: header.orgName, font: { bold: true, size: 15 } },
      header.address && { text: header.address, font: { size: 10, color: { argb: "FF4B5563" } } },
      header.phone && { text: header.phone, font: { size: 10, color: { argb: "FF4B5563" } } },
      { text: title, font: { bold: true, size: 12 } },
      header.date && { text: `Generated ${header.date}`, font: { size: 10, color: { argb: "FF6B7280" } } },
    ].filter(Boolean);
    const centered = header.align === "center";
    const logoHeight = 56;
    const logoWidth = header.logo ? Math.round((header.logo.width / header.logo.height) * logoHeight) : 0;
    let firstTextRow = 1;
    if (header.logo) {
      const imageId = workbook.addImage({ buffer: header.logo.buffer, extension: header.logo.extension });
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
    const textColumn = header.logo && !centered ? 2 : 1;
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
      : Math.max(lines.length, header.logo ? 4 : 0) + 2;
  }

  const head = sheet.getRow(headerRow);
  columns.forEach((key, index) => { head.getCell(index + 1).value = report.columns[key].label; });
  head.font = { bold: true };
  head.eachCell((cell) => { cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFF1F5F9" } }; });
  rows.forEach((record, rowIndex) => {
    const row = sheet.getRow(headerRow + 1 + rowIndex);
    columns.forEach((key, index) => {
      const value = exportValue(record[key], report.columns[key].type);
      // Text that looks like a formula is stored as plain text.
      row.getCell(index + 1).value = typeof value === "string" && /^[\s]*[=+\-@]/.test(value) ? `'${value}` : value;
    });
  });
  columns.forEach((key, index) => {
    if (report.columns[key].type === "money") sheet.getColumn(index + 1).numFmt = "#,##0.00";
  });
  sheet.views = [{ state: "frozen", ySplit: headerRow }];
  sheet.autoFilter = { from: { row: headerRow, column: 1 }, to: { row: headerRow, column: columns.length } };
  return Buffer.from(await workbook.xlsx.writeBuffer());
}

const xmlText = (value) => String(value ?? "")
  .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, "")
  .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

// A Word document: optional school header, the report name, then a landscape table.
async function toDocx(rows, columns, report, title, header = null) {
  const JSZip = require("jszip");
  const run = (text, { bold = false, size = 20, color = "" } = {}) =>
    `<w:r><w:rPr>${bold ? "<w:b/>" : ""}${color ? `<w:color w:val="${color}"/>` : ""}<w:sz w:val="${size}"/></w:rPr><w:t xml:space="preserve">${xmlText(text)}</w:t></w:r>`;
  const paragraph = (text, options = {}) =>
    `<w:p><w:pPr>${options.center ? '<w:jc w:val="center"/>' : ""}<w:spacing w:before="0" w:after="${options.after ?? 60}"/></w:pPr>${run(text, options)}</w:p>`;
  const cell = (text, isHeader) => `<w:tc><w:tcPr>${isHeader ? '<w:shd w:val="clear" w:color="auto" w:fill="EEF1F4"/>' : ""}</w:tcPr>`
    + `<w:p><w:pPr><w:spacing w:after="0"/></w:pPr>${run(text, { bold: isHeader, size: 17 })}</w:p></w:tc>`;
  const row = (cells, isHeader = false) => `<w:tr>${isHeader ? "<w:trPr><w:tblHeader/></w:trPr>" : ""}${cells.map((value) => cell(value, isHeader)).join("")}</w:tr>`;
  const line = '<w:top w:val="single" w:sz="4" w:color="D1D5DB"/><w:left w:val="single" w:sz="4" w:color="D1D5DB"/><w:bottom w:val="single" w:sz="4" w:color="D1D5DB"/><w:right w:val="single" w:sz="4" w:color="D1D5DB"/><w:insideH w:val="single" w:sz="4" w:color="D1D5DB"/><w:insideV w:val="single" w:sz="4" w:color="D1D5DB"/>';
  const none = '<w:top w:val="nil"/><w:left w:val="nil"/><w:bottom w:val="nil"/><w:right w:val="nil"/><w:insideH w:val="nil"/><w:insideV w:val="nil"/>';

  let headerXml = "";
  const media = [];
  if (header) {
    const center = header.align === "center";
    const details = [
      header.orgName && paragraph(header.orgName, { bold: true, size: 30, after: 40, center }),
      header.address && paragraph(header.address, { size: 18, color: "4B5563", after: 20, center }),
      header.phone && paragraph(header.phone, { size: 18, color: "4B5563", after: 20, center }),
      header.date && paragraph(`Generated ${header.date}`, { size: 18, color: "6B7280", after: 20, center }),
    ].filter(Boolean).join("") || paragraph("", { after: 0 });
    let logoCell = "";
    let logoParagraph = "";
    if (header.logo) {
      const heightEmu = 720000; // about 2 cm
      const widthEmu = Math.round((header.logo.width / header.logo.height) * heightEmu);
      media.push({ name: `logo.${header.logo.extension}`, buffer: header.logo.buffer, extension: header.logo.extension });
      const drawing = `<w:drawing><wp:inline distT="0" distB="0" distL="0" distR="0"><wp:extent cx="${widthEmu}" cy="${heightEmu}"/><wp:docPr id="1" name="Logo"/>`
        + '<a:graphic xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture">'
        + `<pic:pic xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture"><pic:nvPicPr><pic:cNvPr id="1" name="logo.${header.logo.extension}"/><pic:cNvPicPr/></pic:nvPicPr>`
        + '<pic:blipFill><a:blip r:embed="rIdLogo"/><a:stretch><a:fillRect/></a:stretch></pic:blipFill>'
        + `<pic:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="${widthEmu}" cy="${heightEmu}"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></pic:spPr></pic:pic>`
        + "</a:graphicData></a:graphic></wp:inline></w:drawing>";
      logoCell = `<w:tc><w:tcPr><w:tcW w:w="${Math.round(widthEmu / 635) + 240}" w:type="dxa"/><w:vAlign w:val="center"/></w:tcPr><w:p><w:pPr><w:spacing w:after="0"/></w:pPr><w:r>${drawing}</w:r></w:p></w:tc>`;
      logoParagraph = `<w:p><w:pPr><w:jc w:val="center"/><w:spacing w:after="80"/></w:pPr><w:r>${drawing}</w:r></w:p>`;
    }
    const rule = '<w:p><w:pPr><w:pBdr><w:bottom w:val="single" w:sz="6" w:space="4" w:color="D1D5DB"/></w:pBdr><w:spacing w:after="200"/></w:pPr></w:p>';
    headerXml = center ? logoParagraph + details + rule : `<w:tbl><w:tblPr><w:tblW w:w="0" w:type="auto"/><w:tblBorders>${none}</w:tblBorders><w:tblCellMar><w:left w:w="0" w:type="dxa"/><w:right w:w="160" w:type="dxa"/></w:tblCellMar></w:tblPr>`
      + `<w:tr>${logoCell}<w:tc><w:tcPr><w:vAlign w:val="center"/></w:tcPr>${details}</w:tc></w:tr></w:tbl>${rule}`;
  }

  const table = `<w:tbl><w:tblPr><w:tblW w:w="5000" w:type="pct"/><w:tblBorders>${line}</w:tblBorders><w:tblCellMar><w:left w:w="80" w:type="dxa"/><w:right w:w="80" w:type="dxa"/></w:tblCellMar></w:tblPr>`
    + row(columns.map((key) => report.columns[key].label), true)
    + rows.map((record) => row(columns.map((key) => exportValue(record[key], report.columns[key].type)))).join("")
    + "</w:tbl>";
  const summary = `${report.title} · ${rows.length.toLocaleString()} ${rows.length === 1 ? "row" : "rows"}${header?.date ? "" : ` · ${new Date().toISOString().slice(0, 10)}`}`;
  const document = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
    + '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing"><w:body>'
    + headerXml
    + paragraph(title, { bold: true, size: 28, after: 40 })
    + paragraph(summary, { size: 18, color: "6B7280", after: 200 })
    + table
    + '<w:sectPr><w:pgSz w:w="16838" w:h="11906" w:orient="landscape"/><w:pgMar w:top="720" w:right="720" w:bottom="720" w:left="720" w:header="360" w:footer="360" w:gutter="0"/></w:sectPr>'
    + "</w:body></w:document>";
  const imageTypes = { png: "image/png", jpeg: "image/jpeg", gif: "image/gif" };
  const zip = new JSZip();
  zip.file("[Content_Types].xml", '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/>'
    + media.map((item) => `<Default Extension="${item.extension}" ContentType="${imageTypes[item.extension]}"/>`).join("")
    + '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>');
  zip.file("_rels/.rels", '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>');
  zip.file("word/_rels/document.xml.rels", '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
    + media.map((item) => `<Relationship Id="rIdLogo" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="media/${item.name}"/>`).join("")
    + "</Relationships>");
  media.forEach((item) => zip.file(`word/media/${item.name}`, item.buffer));
  zip.file("word/document.xml", document);
  return zip.generateAsync({ type: "nodebuffer", compression: "DEFLATE" });
}

function fileNameFor(name) {
  const stamp = new Date().toISOString().slice(0, 10);
  return `${String(name).replace(/[^a-z0-9]+/gi, "-").replace(/^-|-$/g, "").toLowerCase() || "report"}-${stamp}`;
}

// CSV stays plain data; Excel and Word carry the optional school header.
async function buildFile(rows, columns, report, format, title = report.title, header = null) {
  if (format === "csv") return { content: toCsv(rows, columns, report), extension: "csv", contentType: "text/csv; charset=utf-8" };
  if (format === "docx") {
    return {
      content: await toDocx(rows, columns, report, title, header),
      extension: "docx",
      contentType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    };
  }
  return {
    content: await toWorkbook(rows, columns, report, { title, header }),
    extension: "xlsx",
    contentType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  };
}

// Everything that decides what a person may see and runs their reports.
function createReportService(db, { hasPermission = userHasPermission } = {}) {
  async function getClassAccess(identity) {
    if (isElevated(identity)) return null;
    if (!identity.userId) return [];
    const result = await db.query(
      `SELECT DISTINCT uc.class_id
         FROM user_classes uc
         JOIN classes c ON c.class_id = uc.class_id AND c.organization_id = $2
        WHERE uc.user_id = $1`,
      [identity.userId, identity.organizationId]
    );
    return result.rows.map((row) => Number(row.class_id)).filter(Number.isInteger);
  }

  // The reports this person may run: their role must hold the report's
  // permission, class-limited staff only get reports that can be limited to
  // their classes, and feature reports only show once the school uses it.
  async function getContext(identity) {
    const allowedClassIds = await getClassAccess(identity);
    const permissions = [...new Set(Object.values(REPORTS).flatMap((report) => [
      report.permission,
      report.fullAccess,
      ...Object.values(report.columns).map((column) => column.permission),
      ...(report.criteria || []).map((criterion) => criterion.permission),
    ]).flat().filter(Boolean))];
    const featureNames = Object.keys(FEATURES);
    const [results, features] = await Promise.all([
      Promise.all(permissions.map((key) => Promise.resolve(hasPermission(db, identity, key)).catch(() => false))),
      Promise.all(featureNames.map((name) => (typeof FEATURES[name] === "function"
        ? Promise.resolve(FEATURES[name](db, identity.organizationId))
        : db.query(FEATURES[name], [identity.organizationId]).then((result) => result.rows[0]?.available))
        .then(Boolean).catch(() => false))),
    ]);
    const granted = new Set([
      ...permissions.filter((_, index) => results[index]),
      ...featureNames.filter((_, index) => features[index]).map((name) => `feature:${name}`),
    ]);
    const allowed = allowedBy(granted);
    const accessible = Object.entries(REPORTS).filter(([, report]) =>
      allowed(report) && (!allowedClassIds || report.classExpression || report.orgWide)
      && (!report.releaseFeature || releaseFeatures.isOn(report.releaseFeature, { organizationId: identity.organizationId })));
    // Some reports add the school's own columns (each subject, custom remark
    // types, assessment categories); they are merged into a copy per request.
    const extended = await Promise.all(accessible.map(async ([key, report]) => {
      if (!report.extend) return [key, report];
      const extra = await report.extend(db, identity.organizationId).catch(() => ({ columns: {}, criteria: [] }));
      return [key, { ...report, columns: { ...report.columns, ...extra.columns }, criteria: [...report.criteria, ...(extra.criteria || [])] }];
    }));
    return {
      identity,
      organizationId: identity.organizationId,
      allowedClassIds,
      granted,
      accessibleReports: new Map(extended),
    };
  }

  function validateInput(body, context) {
    const reportType = String(body?.reportType || "");
    const report = context ? context.accessibleReports.get(reportType) : getReport(reportType);
    if (!report) return { error: "Choose a report type." };
    const columns = normalizeColumns(report, body?.columns, context?.granted);
    const criteria = normalizeCriteria(report, body?.criteria, context?.granted);
    if (criteria.error) return { error: criteria.error };
    return { reportType, report, columns, criteria: criteria.values };
  }

  async function loadData(context, input, { limit, offset = 0, sort } = {}) {
    const queries = buildQueries(input.report, {
      columns: input.columns,
      criteria: input.criteria,
      organizationId: context.organizationId,
      allowedClassIds: context.allowedClassIds,
      ownRowsOf: ownRowsFor(input.report, context.granted, context.identity.userId),
      sort,
      limit,
      offset,
    });
    const countResult = await db.query(queries.count.sql, queries.count.values);
    const total = Number(countResult.rows[0]?.total || 0);
    if (offset >= total && offset > 0) return { rows: [], total, sort: queries.sort };
    const [dataResult, summaryResult] = await Promise.all([
      db.query(queries.data.sql, queries.data.values),
      queries.summary ? db.query(queries.summary.sql, queries.summary.values) : null,
    ]);
    let summary = null;
    if (summaryResult) {
      const round = (v) => (v === null || v === undefined ? null : Math.round(Number(v) * 100) / 100);
      summary = {
        byClass: queries.summary.byClass,
        rows: summaryResult.rows.map((row, index) => ({
          label: queries.summary.byClass && index < summaryResult.rows.length - 1 ? row.grp : "All records",
          records: row.records,
          values: Object.fromEntries(queries.summary.measured.map(({ key, kind }, i) => [key, {
            total: kind === "total" ? round(row[`s${i}`]) : null,
            average: round(row[`a${i}`]),
          }])),
        })),
      };
    }
    return { rows: dataResult.rows, total, sort: queries.sort, summary };
  }

  return { getContext, getClassAccess, validateInput, loadData };
}

const SAVED_SELECT = `
  SELECT r.report_id, r.report_name, r.report_type, r.created_by,
         TRIM(CONCAT_WS(' ', u.first_name, u.last_name)) AS owner_name,
         (r.created_by = $2) AS is_owner,
         sch.frequency AS schedule_frequency,
         EXISTS (SELECT 1 FROM custom_report_favorites fav WHERE fav.report_id = r.report_id AND fav.user_id = $2) AS is_favorite,
         (SELECT COUNT(*)::int FROM custom_report_shares sh WHERE sh.report_id = r.report_id) AS share_count
    FROM custom_report_definitions r
    LEFT JOIN users u ON u.user_id = r.created_by
    LEFT JOIN custom_report_schedules sch ON sch.report_id = r.report_id`;

function reportBuilderController(db, options = {}) {
  const service = createReportService(db, options);
  const signedOut = (res) => res.status(401).json({ success: false, error: "Please sign in again." });
  const notFound = (res) => res.status(404).json({ success: false, error: "Saved report not found." });

  async function readContext(req) {
    const identity = identityFromRequest(req);
    if (!identity.organizationId) return null;
    return service.getContext(identity);
  }

  // A saved report this person can open (own or shared with them).
  async function findSaved(context, reportId, { ownerOnly = false } = {}) {
    if (!reportId) return null;
    const result = await db.query(
      `SELECT r.report_id, r.report_name, r.report_type, r.columns_json, r.criteria_json, r.branding_json, r.created_by
         FROM custom_report_definitions r
        WHERE r.report_id = $1 AND r.organization_id = $2
          AND (r.created_by = $3 OR (NOT $4::boolean AND EXISTS (
            SELECT 1 FROM custom_report_shares sh WHERE sh.report_id = r.report_id AND sh.user_id = $3)))`,
      [reportId, context.organizationId, context.identity.userId, ownerOnly]
    );
    const saved = result.rows[0];
    return saved && context.accessibleReports.has(saved.report_type) ? saved : null;
  }

  return {
    page: async (req, res) => {
      try {
        await ensureReportSchema(db);
        const context = await readContext(req);
        if (!context) return res.status(401).send("Please sign in again.");
        const { organizationId, allowedClassIds: classIds } = context;
        const [classResult, termResult, savedResult, userResult] = await Promise.all([
          db.query(
            `SELECT class_id, class_name FROM classes
              WHERE organization_id = $1 AND obsolete_at IS NULL
              ${classIds ? "AND class_id = ANY($2::int[])" : ""}
              ORDER BY COALESCE(dashboard_sort_order, 2147483647), class_name, class_id`,
            classIds ? [organizationId, classIds] : [organizationId]
          ),
          db.query(
            `SELECT t.term_id, CONCAT_WS(' · ', t.term_name, sy.year_label) AS term_name,
                    COALESCE(t.current_term, FALSE) OR COALESCE(t.current, FALSE) AS is_current
               FROM terms t
               LEFT JOIN school_years sy ON sy.id = t.school_year_id AND sy.organization_id = t.organization_id
              WHERE t.organization_id = $1
              ORDER BY t.start_date DESC NULLS LAST, t.term_id DESC`,
            [organizationId]
          ),
          db.query(
            `${SAVED_SELECT}
              WHERE r.organization_id = $1
                AND (r.created_by = $2 OR EXISTS (
                  SELECT 1 FROM custom_report_shares sh WHERE sh.report_id = r.report_id AND sh.user_id = $2))
              ORDER BY LOWER(r.report_name), r.report_id`,
            [organizationId, context.identity.userId]
          ),
          db.query("SELECT email FROM users WHERE user_id = $1", [context.identity.userId]),
        ]);
        const orgResult = await db.query(
          `SELECT organization_name, COALESCE(NULLIF(logo, ''), logo_path) AS logo, organization_address, organization_phone
             FROM organizations WHERE organization_id = $1`,
          [organizationId]
        );
        const org = orgResult.rows[0] || {};
        const reportTypes = [...context.accessibleReports.entries()]
          .map(([key, report]) => describeReport(key, report, context.granted));
        // Entries in the list, each with the views this person can open.
        const families = FAMILIES
          .map((family) => ({ ...family, views: family.views.filter((key) => context.accessibleReports.has(key)) }))
          .filter((family) => family.views.length);
        const requestedType = String(req.query.type || "");
        // Links such as the term page's "Merit sheet" open a report already filtered.
        const initialCriteria = {};
        ["class", "term"].forEach((key) => {
          const id = positiveInt(req.query[key]);
          if (id) initialCriteria[key] = id;
        });
        return res.render("common/reportBuilder", {
          title: "Report Builder",
          reportTypes,
          families,
          groups: GROUP_ORDER.filter((group) => families.some((family) => family.group === group)),
          classes: classResult.rows,
          terms: termResult.rows,
          savedReports: savedResult.rows.filter((saved) => context.accessibleReports.has(saved.report_type)),
          initialType: context.accessibleReports.has(requestedType) ? requestedType : "",
          initialCriteria,
          userEmail: userResult.rows[0]?.email || context.identity.userEmail || "",
          school: {
            name: org.organization_name || "",
            logo: org.logo || "",
            address: org.organization_address || "",
            phone: org.organization_phone || "",
          },
          pageSizes: PAGE_SIZES,
          isEmbeddedFrame: Boolean(res.locals.isEmbeddedFrame),
        });
      } catch (error) {
        console.error("[reportBuilder/page]", error);
        return res.status(500).send("Failed to load the report builder.");
      }
    },

    // Criteria choices that come from the school's own data, loaded when the
    // criteria step opens so the page itself stays fast.
    options: async (req, res) => {
      try {
        const context = await readContext(req);
        if (!context) return signedOut(res);
        const report = context.accessibleReports.get(String(req.params.reportType || ""));
        if (!report) return res.status(404).json({ success: false, error: "Report not found." });
        const withOptions = (report.criteria || []).filter((criterion) => criterion.optionsSql && allowedBy(context.granted)(criterion));
        const needsChannels = withOptions.some((criterion) => criterion.messagingChannels);
        const [results, channels] = await Promise.all([
          Promise.all(withOptions.map((criterion) => db.query(criterion.optionsSql, [context.organizationId]))),
          needsChannels ? getMessagingChannelStatus(db, context.organizationId).catch(() => null) : null,
        ]);
        const options = {};
        withOptions.forEach((criterion, index) => {
          let rows = results[index].rows
            .filter((row) => row.value !== null && row.value !== "")
            .map((row) => ({
              value: String(row.value),
              label: String(row.label ?? row.value),
              // Assessments say which classes and terms they belong to, so the list can follow those choices.
              ...(row.classes ? { classes: String(row.classes).split(",") } : {}),
              ...(row.terms ? { terms: String(row.terms).split(",") } : {}),
            }));
          // Text and WhatsApp only appear once the school has switched them on.
          if (criterion.messagingChannels) {
            rows = rows.filter((row) =>
              (row.value !== "sms" || channels?.sms?.ready) && (row.value !== "whatsapp" || channels?.whatsapp?.ready));
          }
          options[criterion.key] = rows;
        });
        res.setHeader("Cache-Control", "no-store");
        return res.json({ success: true, options });
      } catch (error) {
        console.error("[reportBuilder/options]", error);
        return res.status(500).json({ success: false, error: "Could not load the criteria options." });
      }
    },

    run: async (req, res) => {
      try {
        const context = await readContext(req);
        if (!context) return signedOut(res);
        const input = service.validateInput(req.body, context);
        if (input.error) return res.status(400).json({ success: false, error: input.error });

        const page = positiveInt(req.body?.page) || 1;
        const requestedSize = Number(req.body?.pageSize);
        const pageSize = PAGE_SIZES.includes(requestedSize) ? requestedSize : PAGE_SIZE;
        const { rows, total, sort, summary } = await service.loadData(context, input, {
          limit: pageSize,
          offset: (page - 1) * pageSize,
          sort: req.body?.sort,
        });
        res.setHeader("Cache-Control", "no-store");
        return res.json({
          success: true,
          title: input.report.title,
          columns: input.columns.map((key) => ({
            key,
            label: input.report.columns[key].label,
            type: input.report.columns[key].type || "text",
          })),
          rows,
          total,
          page,
          pageSize,
          sort,
          summary,
        });
      } catch (error) {
        console.error("[reportBuilder/run]", error);
        return res.status(500).json({ success: false, error: "Could not run this report." });
      }
    },

    export: async (req, res) => {
      try {
        const context = await readContext(req);
        if (!context) return signedOut(res);
        const input = service.validateInput(req.body, context);
        if (input.error) return res.status(400).json({ success: false, error: input.error });
        const { rows, total } = await service.loadData(context, input, { limit: MAX_EXPORT_ROWS, sort: req.body?.sort });
        if (total > MAX_EXPORT_ROWS) {
          return res.status(413).json({
            success: false,
            error: `This report has ${total.toLocaleString()} rows. Add criteria to export ${MAX_EXPORT_ROWS.toLocaleString()} rows or fewer.`,
          });
        }
        const name = String(req.body?.name || "").trim().slice(0, 120) || input.report.title;
        const format = FORMATS.has(req.body?.format) ? req.body.format : "xlsx";
        const header = format === "csv" ? null : await loadReportHeader(db, context.organizationId, req.body?.branding);
        const file = await buildFile(rows, input.columns, input.report, format, name, header);
        res.setHeader("Cache-Control", "no-store");
        res.setHeader("Content-Type", file.contentType);
        res.setHeader("Content-Disposition", `attachment; filename="${fileNameFor(name)}.${file.extension}"`);
        return res.send(file.content);
      } catch (error) {
        console.error("[reportBuilder/export]", error);
        return res.status(500).json({ success: false, error: "Could not export this report." });
      }
    },

    // The report's design as a Managira template file (.mgrt): columns and
    // filters only, never the school's data (utils/reportTemplates.js).
    template: async (req, res) => {
      try {
        const context = await readContext(req);
        if (!context) return signedOut(res);
        const input = service.validateInput(req.body, context);
        if (input.error) return res.status(400).json({ success: false, error: input.error });
        const name = String(req.body?.name || "").trim().slice(0, 120) || input.report.title;
        const template = await reportTemplates.buildTemplate(db, context, input, name);
        res.setHeader("Cache-Control", "no-store");
        res.setHeader("Content-Type", reportTemplates.CONTENT_TYPE);
        res.setHeader("Content-Disposition", `attachment; filename="${fileNameFor(name).replace(/-\d{4}-\d{2}-\d{2}$/, "")}.${reportTemplates.EXTENSION}"`);
        return res.send(JSON.stringify(template, null, 2));
      } catch (error) {
        console.error("[reportBuilder/template]", error);
        return res.status(500).json({ success: false, error: "Could not make the template." });
      }
    },

    // Adds a shared template to My reports, matched to this school's own lists.
    importTemplate: async (req, res) => {
      try {
        await ensureReportSchema(db);
        const context = await readContext(req);
        if (!context) return signedOut(res);
        const read = await reportTemplates.readTemplate(db, context, req.body?.template);
        if (read.error) return res.status(400).json({ success: false, error: read.error });
        const input = service.validateInput({ reportType: read.reportType, columns: read.columns, criteria: read.criteria }, context);
        if (input.error) return res.status(400).json({ success: false, error: input.error });
        // A new name if one of their reports already uses it.
        const taken = new Set((await db.query(
          "SELECT LOWER(report_name) AS name FROM custom_report_definitions WHERE organization_id = $1 AND created_by = $2",
          [context.organizationId, context.identity.userId]
        )).rows.map((row) => row.name));
        let reportName = read.name;
        for (let n = 2; taken.has(reportName.toLowerCase()) && n < 100; n += 1) reportName = `${read.name.slice(0, 110)} (${n})`;
        const inserted = await db.query(
          `INSERT INTO custom_report_definitions
             (organization_id, created_by, report_name, report_type, columns_json, criteria_json, branding_json, updated_at)
           VALUES ($1, $2, $3, $4, $5::jsonb, $6::jsonb, '{}'::jsonb, NOW())
           RETURNING report_id`,
          [context.organizationId, context.identity.userId, reportName, input.reportType, JSON.stringify(input.columns), JSON.stringify(input.criteria)]
        );
        const saved = await db.query(`${SAVED_SELECT} WHERE r.report_id = $1`, [inserted.rows[0].report_id, context.identity.userId]);
        return res.status(201).json({ success: true, report: saved.rows[0], skipped: read.skipped });
      } catch (error) {
        console.error("[reportBuilder/importTemplate]", error);
        return res.status(500).json({ success: false, error: "Could not import this template." });
      }
    },

    save: async (req, res) => {
      const reportName = String(req.body?.name || "").trim().slice(0, 120);
      if (!reportName) return res.status(400).json({ success: false, error: "Enter a name for this report." });
      try {
        await ensureReportSchema(db);
        const context = await readContext(req);
        if (!context) return signedOut(res);
        const input = service.validateInput(req.body, context);
        if (input.error) return res.status(400).json({ success: false, error: input.error });
        const inserted = await db.query(
          `INSERT INTO custom_report_definitions
             (organization_id, created_by, report_name, report_type, columns_json, criteria_json, branding_json, updated_at)
           VALUES ($1, $2, $3, $4, $5::jsonb, $6::jsonb, $7::jsonb, NOW())
           RETURNING report_id`,
          [context.organizationId, context.identity.userId, reportName, input.reportType,
            JSON.stringify(input.columns), JSON.stringify(input.criteria), JSON.stringify(normalizeBranding(req.body?.branding))]
        );
        const saved = await db.query(`${SAVED_SELECT} WHERE r.report_id = $1`, [inserted.rows[0].report_id, context.identity.userId]);
        return res.status(201).json({ success: true, report: saved.rows[0] });
      } catch (error) {
        console.error("[reportBuilder/save]", error);
        return res.status(500).json({ success: false, error: "Could not save this report." });
      }
    },

    // Saves changes to the same report (only its owner can).
    update: async (req, res) => {
      try {
        await ensureReportSchema(db);
        const context = await readContext(req);
        if (!context) return signedOut(res);
        const saved = await findSaved(context, positiveInt(req.params.reportId), { ownerOnly: true });
        if (!saved) return notFound(res);
        const input = service.validateInput(req.body, context);
        if (input.error) return res.status(400).json({ success: false, error: input.error });
        const reportName = String(req.body?.name || "").trim().slice(0, 120) || saved.report_name;
        await db.query(
          `UPDATE custom_report_definitions
              SET report_name = $3, report_type = $4, columns_json = $5::jsonb, criteria_json = $6::jsonb,
                  branding_json = $7::jsonb, updated_at = NOW()
            WHERE report_id = $1 AND organization_id = $2`,
          [saved.report_id, context.organizationId, reportName, input.reportType,
            JSON.stringify(input.columns), JSON.stringify(input.criteria), JSON.stringify(normalizeBranding(req.body?.branding))]
        );
        const result = await db.query(`${SAVED_SELECT} WHERE r.report_id = $1`, [saved.report_id, context.identity.userId]);
        return res.json({ success: true, report: result.rows[0] });
      } catch (error) {
        console.error("[reportBuilder/update]", error);
        return res.status(500).json({ success: false, error: "Could not save this report." });
      }
    },

    loadSaved: async (req, res) => {
      try {
        await ensureReportSchema(db);
        const context = await readContext(req);
        if (!context) return signedOut(res);
        const saved = await findSaved(context, positiveInt(req.params.reportId));
        if (!saved) return notFound(res);
        return res.json({ success: true, report: { ...saved, is_owner: saved.created_by === context.identity.userId } });
      } catch (error) {
        console.error("[reportBuilder/loadSaved]", error);
        return res.status(500).json({ success: false, error: "Could not load this saved report." });
      }
    },

    deleteSaved: async (req, res) => {
      try {
        await ensureReportSchema(db);
        const context = await readContext(req);
        if (!context) return signedOut(res);
        const result = await db.query(
          `DELETE FROM custom_report_definitions
            WHERE report_id = $1 AND organization_id = $2 AND created_by = $3
            RETURNING report_id`,
          [positiveInt(req.params.reportId), context.organizationId, context.identity.userId]
        );
        if (!result.rows.length) return notFound(res);
        return res.json({ success: true });
      } catch (error) {
        console.error("[reportBuilder/deleteSaved]", error);
        return res.status(500).json({ success: false, error: "Could not delete this saved report." });
      }
    },

    // Star a saved report (per person; works for shared reports too).
    favorite: async (req, res) => {
      try {
        await ensureReportSchema(db);
        const context = await readContext(req);
        if (!context) return signedOut(res);
        const saved = await findSaved(context, positiveInt(req.params.reportId));
        if (!saved) return notFound(res);
        if (req.body?.favorite) {
          await db.query(
            `INSERT INTO custom_report_favorites (report_id, user_id) VALUES ($1, $2)
             ON CONFLICT (report_id, user_id) DO NOTHING`,
            [saved.report_id, context.identity.userId]
          );
        } else {
          await db.query("DELETE FROM custom_report_favorites WHERE report_id = $1 AND user_id = $2",
            [saved.report_id, context.identity.userId]);
        }
        return res.json({ success: true, favorite: Boolean(req.body?.favorite) });
      } catch (error) {
        console.error("[reportBuilder/favorite]", error);
        return res.status(500).json({ success: false, error: "Could not update favorites." });
      }
    },

    // Staff at this school a report can be shared with.
    staff: async (req, res) => {
      try {
        const context = await readContext(req);
        if (!context) return signedOut(res);
        const result = await db.query(
          `SELECT user_id, TRIM(CONCAT_WS(' ', first_name, last_name)) AS name, account_type::text AS role
             FROM users
            WHERE organization_id = $1 AND removed_at IS NULL AND user_id <> $2
              AND account_type::text NOT IN ('Driver', 'Student')
            ORDER BY LOWER(first_name), LOWER(last_name)`,
          [context.organizationId, context.identity.userId]
        );
        return res.json({ success: true, staff: result.rows });
      } catch (error) {
        console.error("[reportBuilder/staff]", error);
        return res.status(500).json({ success: false, error: "Could not load staff." });
      }
    },

    sharing: async (req, res) => {
      try {
        await ensureReportSchema(db);
        const context = await readContext(req);
        if (!context) return signedOut(res);
        const saved = await findSaved(context, positiveInt(req.params.reportId), { ownerOnly: true });
        if (!saved) return notFound(res);
        const [shares, schedule] = await Promise.all([
          db.query("SELECT user_id FROM custom_report_shares WHERE report_id = $1", [saved.report_id]),
          db.query(
            `SELECT frequency, weekday, weekdays, month_day, send_hour, file_format, include_shared, last_sent_on
               FROM custom_report_schedules WHERE report_id = $1`,
            [saved.report_id]
          ),
        ]);
        return res.json({
          success: true,
          userIds: shares.rows.map((row) => row.user_id),
          schedule: schedule.rows[0] || null,
        });
      } catch (error) {
        console.error("[reportBuilder/sharing]", error);
        return res.status(500).json({ success: false, error: "Could not load sharing." });
      }
    },

    updateShares: async (req, res) => {
      try {
        await ensureReportSchema(db);
        const context = await readContext(req);
        if (!context) return signedOut(res);
        const saved = await findSaved(context, positiveInt(req.params.reportId), { ownerOnly: true });
        if (!saved) return notFound(res);
        const requested = [...new Set((Array.isArray(req.body?.userIds) ? req.body.userIds : []).map(positiveInt).filter(Boolean))].slice(0, 500);
        // Only current staff at this school can receive a share.
        const valid = requested.length
          ? (await db.query(
            `SELECT user_id FROM users
              WHERE organization_id = $1 AND removed_at IS NULL AND user_id = ANY($2::int[]) AND user_id <> $3`,
            [context.organizationId, requested, context.identity.userId]
          )).rows.map((row) => row.user_id)
          : [];
        await db.query("DELETE FROM custom_report_shares WHERE report_id = $1 AND NOT (user_id = ANY($2::int[]))", [saved.report_id, valid]);
        if (valid.length) {
          await db.query(
            `INSERT INTO custom_report_shares (report_id, user_id, shared_by)
             SELECT $1, UNNEST($2::int[]), $3
             ON CONFLICT (report_id, user_id) DO NOTHING`,
            [saved.report_id, valid, context.identity.userId]
          );
        }
        return res.json({ success: true, userIds: valid });
      } catch (error) {
        console.error("[reportBuilder/updateShares]", error);
        return res.status(500).json({ success: false, error: "Could not share this report." });
      }
    },

    updateSchedule: async (req, res) => {
      try {
        await ensureReportSchema(db);
        const context = await readContext(req);
        if (!context) return signedOut(res);
        const saved = await findSaved(context, positiveInt(req.params.reportId), { ownerOnly: true });
        if (!saved) return notFound(res);
        const frequency = String(req.body?.frequency || "");
        if (!frequency) {
          await db.query("DELETE FROM custom_report_schedules WHERE report_id = $1", [saved.report_id]);
          return res.json({ success: true, schedule: null });
        }
        if (!FREQUENCIES.has(frequency)) return res.status(400).json({ success: false, error: "Choose how often to send it." });
        const weekdays = frequency === "weekly"
          ? [...new Set((Array.isArray(req.body?.weekdays) ? req.body.weekdays : []).map(Number))]
            .filter((day) => Number.isInteger(day) && day >= 0 && day <= 6).sort()
          : null;
        if (frequency === "weekly" && !weekdays.length) {
          return res.status(400).json({ success: false, error: "Choose at least one day." });
        }
        const monthDay = Number(req.body?.monthDay);
        const schedule = {
          frequency,
          weekdays,
          weekday: weekdays ? weekdays[0] : null,
          month_day: frequency === "monthly" && Number.isInteger(monthDay) && monthDay >= 1 && monthDay <= 31 ? monthDay : (frequency === "monthly" ? 1 : null),
          send_hour: SEND_HOURS.has(Number(req.body?.sendHour)) ? Number(req.body.sendHour) : 7,
          file_format: FORMATS.has(req.body?.format) ? req.body.format : "xlsx",
          include_shared: Boolean(req.body?.includeShared),
        };
        await db.query(
          `INSERT INTO custom_report_schedules
             (report_id, organization_id, frequency, weekday, weekdays, month_day, send_hour, file_format, include_shared)
           VALUES ($1, $2, $3, $4, $5::smallint[], $6, $7, $8, $9)
           ON CONFLICT (report_id) DO UPDATE
             SET frequency = EXCLUDED.frequency, weekday = EXCLUDED.weekday, weekdays = EXCLUDED.weekdays,
                 month_day = EXCLUDED.month_day,
                 send_hour = EXCLUDED.send_hour, file_format = EXCLUDED.file_format,
                 include_shared = EXCLUDED.include_shared, last_error = NULL, updated_at = NOW()`,
          [saved.report_id, context.organizationId, schedule.frequency, schedule.weekday, schedule.weekdays,
            schedule.month_day, schedule.send_hour, schedule.file_format, schedule.include_shared]
        );
        return res.json({ success: true, schedule });
      } catch (error) {
        console.error("[reportBuilder/updateSchedule]", error);
        return res.status(500).json({ success: false, error: "Could not save the schedule." });
      }
    },
  };
}

// ---- Scheduled emails -----------------------------------------------------------

function localParts(date, timeZone) {
  let zone = timeZone || "UTC";
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: zone });
  } catch (_) {
    zone = "UTC";
  }
  const parts = Object.fromEntries(new Intl.DateTimeFormat("en-US", {
    timeZone: zone, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", hourCycle: "h23", weekday: "short",
  }).formatToParts(date).map((part) => [part.type, part.value]));
  const isoDate = `${parts.year}-${parts.month}-${parts.day}`;
  const weekday = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(parts.weekday);
  const daysInMonth = new Date(Date.UTC(Number(parts.year), Number(parts.month), 0)).getUTCDate();
  return { isoDate, hour: Number(parts.hour), weekday, day: Number(parts.day), daysInMonth };
}

// Due once per local day, from the chosen hour (school time), on the chosen day.
function isScheduleDue(schedule, now, timeZone) {
  const local = localParts(now, timeZone);
  if (local.hour < Number(schedule.send_hour ?? 7)) return false;
  const lastSent = schedule.last_sent_on instanceof Date
    ? schedule.last_sent_on.toISOString().slice(0, 10)
    : String(schedule.last_sent_on || "").slice(0, 10);
  if (lastSent && lastSent >= local.isoDate) return false;
  if (schedule.frequency === "daily") return true;
  if (schedule.frequency === "weekly") {
    const days = Array.isArray(schedule.weekdays) && schedule.weekdays.length ? schedule.weekdays : [schedule.weekday ?? 1];
    return days.map(Number).includes(local.weekday);
  }
  if (schedule.frequency === "monthly") return local.day === Math.min(Number(schedule.month_day || 1), local.daysInMonth);
  return false;
}

// Sends every saved report whose schedule is due. Each report runs with its
// owner's current access, so a schedule never shows more than they could see.
async function runDueReportSchedules(db, { now = new Date(), send, hasPermission } = {}) {
  await ensureReportSchema(db);
  const { sendEmailSafely, renderCleanEmail, escapeHtml } = require("../utils/emailHelper");
  const deliver = send || sendEmailSafely;
  const service = createReportService(db, hasPermission ? { hasPermission } : {});
  const schedules = await db.query(
    `SELECT sch.*, r.report_name, r.report_type, r.columns_json, r.criteria_json, r.branding_json, r.created_by,
            u.email AS owner_email, u.first_name AS owner_first_name, u.account_type::text AS owner_role,
            o.organization_name, o.whatsapp_timezone
       FROM custom_report_schedules sch
       JOIN custom_report_definitions r ON r.report_id = sch.report_id
       JOIN users u ON u.user_id = r.created_by AND u.organization_id = r.organization_id AND u.removed_at IS NULL
       JOIN organizations o ON o.organization_id = r.organization_id`
  );
  const summary = { checked: schedules.rows.length, sent: 0, failed: 0 };
  for (const row of schedules.rows) {
    if (!isScheduleDue(row, now, row.whatsapp_timezone)) continue;
    const today = localParts(now, row.whatsapp_timezone).isoDate;
    try {
      // The owner must still hold the report; each person it is shared with gets
      // only what their own permissions and classes allow, or no copy at all.
      const recipients = [{ userId: row.created_by, role: row.owner_role, email: row.owner_email, isOwner: true }];
      if (row.include_shared) {
        const shared = await db.query(
          `SELECT u.user_id, u.email, u.account_type::text AS role FROM custom_report_shares sh
             JOIN users u ON u.user_id = sh.user_id AND u.organization_id = $2 AND u.removed_at IS NULL
            WHERE sh.report_id = $1 AND u.email IS NOT NULL`,
          [row.report_id, row.organization_id]
        );
        shared.rows.forEach((recipient) => {
          if (recipient.user_id !== row.created_by) recipients.push({ userId: recipient.user_id, role: recipient.role, email: recipient.email });
        });
      }
      const header = row.file_format === "csv" ? null : await loadReportHeader(db, row.organization_id, row.branding_json);
      for (const recipient of recipients) {
        const context = await service.getContext({
          userId: recipient.userId,
          userRole: recipient.role,
          accountType: recipient.role,
          organizationId: row.organization_id,
          userEmail: recipient.email,
        });
        const input = service.validateInput({
          reportType: row.report_type,
          columns: row.columns_json,
          criteria: row.criteria_json,
        }, context);
        if (input.error) {
          if (recipient.isOwner) throw new Error(input.error);
          continue;
        }
        if (!recipient.email) continue;
        const { rows, total } = await service.loadData(context, input, { limit: MAX_EXPORT_ROWS });
        const file = await buildFile(rows, input.columns, input.report, row.file_format, row.report_name, header);
        const note = total > MAX_EXPORT_ROWS
          ? `This report has ${total.toLocaleString()} rows; the first ${MAX_EXPORT_ROWS.toLocaleString()} are attached.`
          : `${total.toLocaleString()} ${total === 1 ? "row" : "rows"}.`;
        const email = recipient.email;
        await deliver({
          to: email,
          subject: `${row.report_name} · ${row.organization_name}`,
          html: renderCleanEmail({
            title: escapeHtml(row.report_name),
            greeting: "Hello,",
            paragraphs: [
              `Here is your ${escapeHtml(row.frequency)} report <strong>${escapeHtml(row.report_name)}</strong> (${escapeHtml(input.report.title)}) from ${escapeHtml(row.organization_name)}.`,
              escapeHtml(note),
            ],
            note: "To change or stop this email, open Reports → Report Builder and edit the report's schedule.",
          }),
          attachments: [{ filename: `${fileNameFor(row.report_name)}.${file.extension}`, content: file.content, contentType: file.contentType }],
        }, "Scheduled report");
      }
      await db.query("UPDATE custom_report_schedules SET last_sent_on = $2, last_error = NULL WHERE report_id = $1", [row.report_id, today]);
      summary.sent++;
    } catch (error) {
      // Recorded and not retried until the next due day, so a broken report never floods inboxes.
      await db.query("UPDATE custom_report_schedules SET last_sent_on = $2, last_error = $3 WHERE report_id = $1",
        [row.report_id, today, String(error.message || error).slice(0, 500)]);
      summary.failed++;
    }
  }
  return summary;
}

module.exports = reportBuilderController;
module.exports.runDueReportSchedules = runDueReportSchedules;
module.exports._test = {
  ensureReportSchema,
  createReportService,
  identityFromRequest,
  isScheduleDue,
  csvCell,
  toCsv,
  toWorkbook,
  toDocx,
};
