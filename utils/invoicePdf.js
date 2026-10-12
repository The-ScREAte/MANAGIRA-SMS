// Managira invoice PDF (school subscriptions and hub bills share this look).
// One line: the school renewal invoice. Several lines plus an optional table:
// a hub bill with the schools it covers.
const PDFDocument = require("pdfkit");

function formatInvoicePdfDate(value) {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "-";
  return date.toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

const shortDate = (value) => {
  const d = value ? new Date(value) : null;
  if (!d || Number.isNaN(d.getTime())) return "-";
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
};

function titleCaseStatus(value) {
  return String(value || "unknown")
    .replace(/_/g, " ")
    .split(" ")
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1).toLowerCase())
    .join(" ");
}

/**
 * @param {object} o
 *   reference, status, issuedAt, dueAt, paidAt, failedAt, emailSentAt, periodLabel,
 *   accountName, accountContact, supportEmail, currency,
 *   lines: [{ description, detail, qty, unitAmount, amount }],
 *   discount (number, optional), total (number),
 *   table: { title, columns: [{ label, width, align }], rows: [[...]] } (optional),
 *   note (optional)
 */
function renderInvoicePdf(o) {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: "A4", margin: 48 });
    const chunks = [];
    doc.on("data", (chunk) => chunks.push(chunk));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);

    const pageWidth = doc.page.width;
    const contentWidth = pageWidth - 96;
    const teal = "#00D4AA";
    const deep = "#1a1f2e";
    const muted = "#5a6378";
    const border = "#e6e9f0";
    const soft = "#f5f7fb";

    const currencyCode = String(o.currency || "USD").toUpperCase();
    const fmt = (n) => `${currencyCode} ${Number(n || 0).toFixed(2)}`;
    const lines = Array.isArray(o.lines) && o.lines.length ? o.lines : [];
    const single = lines.length <= 1 && !o.table;
    const status = String(o.status || "issued").toLowerCase();
    const statusLabel = titleCaseStatus(status);
    const bottomLimit = doc.page.height - 90;
    const ensureRoom = (y, need) => {
      if (y + need <= bottomLimit) return y;
      doc.addPage();
      return 56;
    };

    if (single) doc.roundedRect(48, 38, contentWidth, 700, 14).fill("#ffffff").strokeColor(border).lineWidth(1).stroke();

    doc.rect(48, 38, contentWidth, 96).fill("#f5f6fa");
    doc.moveTo(48, 130).lineTo(48 + contentWidth, 130).strokeColor(teal).lineWidth(2).stroke();
    doc.fillColor(deep).font("Helvetica-Bold").fontSize(30).text(o.title || "Invoice", 64, 56, { width: 220 });
    doc.fillColor(muted).font("Helvetica-Bold").fontSize(10).text("Managira (SCREATE LLC)", 320, 64, { width: 220, align: "right" });
    doc.fillColor(muted).font("Helvetica").fontSize(9).text(`Ref ${o.reference}`, 320, 80, { width: 220, align: "right" });

    const statusBg = status === "paid" ? "#d6f7ec" : (status === "failed" || status === "open") ? "#ffd8df" : "#e6e9f0";
    const statusColor = status === "paid" ? "#00845f" : (status === "failed" || status === "open") ? "#b1213e" : "#5a6378";
    doc.roundedRect(452, 138, 88, 18, 9).fill(statusBg);
    doc.fillColor(statusColor).font("Helvetica-Bold").fontSize(8).text((status === "open" ? "Not paid" : statusLabel).toUpperCase(), 452, 144, { width: 88, align: "center" });

    let y = 156;
    const metaRows = [
      ["Invoice ref", o.reference],
      ["Date of issue", shortDate(o.issuedAt)],
      ["Date due", shortDate(o.dueAt)],
      ["Billing period", o.periodLabel || "Monthly"],
      ...(o.periodDates ? [["Period", o.periodDates]] : []),
      ["Account", o.accountName || "Organization"],
    ];
    doc.fillColor(muted).font("Helvetica-Bold").fontSize(8);
    metaRows.forEach((row, index) => {
      const rowY = y + (index * 16);
      doc.text(row[0], 62, rowY, { width: 100 });
      doc.fillColor(deep).font("Helvetica").text(String(row[1] || "-"), 150, rowY, { width: 160, lineBreak: false, ellipsis: true });
      doc.fillColor(muted).font("Helvetica-Bold");
    });

    doc.fillColor(muted).font("Helvetica-Bold").fontSize(8).text("From", 320, y, { width: 100 });
    doc.fillColor(deep).font("Helvetica-Bold").fontSize(10).text("Managira (SCREATE LLC)", 320, y + 14, { width: 220 });
    doc.fillColor(muted).font("Helvetica").fontSize(9).text(`Support: ${o.supportEmail || "support@managira.com"}`, 320, y + 30, { width: 220 });
    doc.fillColor(muted).font("Helvetica-Bold").fontSize(8).text("Bill to", 320, y + 52, { width: 100 });
    doc.fillColor(deep).font("Helvetica-Bold").fontSize(10).text(o.accountName || "Organization", 320, y + 66, { width: 220 });
    doc.fillColor(muted).font("Helvetica").fontSize(9).text(o.accountContact || "-", 320, y + 82, { width: 220 });

    // Lines
    y += Math.max(112, metaRows.length * 16 + 32);
    doc.roundedRect(48, y, contentWidth, 28, 6).fill(soft);
    doc.fillColor(muted).font("Helvetica-Bold").fontSize(8);
    doc.text("Description", 62, y + 10, { width: 260 });
    doc.text("Qty", 330, y + 10, { width: 40, align: "right" });
    doc.text("Unit Price", 375, y + 10, { width: 80, align: "right" });
    doc.text("Amount", 460, y + 10, { width: 80, align: "right" });
    y += 28;
    if (single) {
      const l = lines[0] || {};
      doc.roundedRect(48, y, contentWidth, 58, 6).strokeColor(border).lineWidth(1).stroke();
      doc.fillColor(deep).font("Helvetica").fontSize(10).text(l.description || "Subscription", 62, y + 16, { width: 260 });
      doc.fillColor(muted).font("Helvetica").fontSize(8.5).text(l.detail || "Auto-generated from your billing settings", 62, y + 32, { width: 260 });
      doc.fillColor(deep).font("Helvetica").fontSize(10).text(String(l.qty || 1), 330, y + 22, { width: 40, align: "right" });
      doc.fillColor(deep).font("Helvetica").fontSize(10).text(fmt(l.unitAmount != null ? l.unitAmount : l.amount), 375, y + 22, { width: 80, align: "right" });
      doc.fillColor(deep).font("Helvetica-Bold").fontSize(10).text(fmt(l.amount), 460, y + 22, { width: 80, align: "right" });
      y += 76;
    } else {
      lines.forEach((l) => {
        const h = l.detail ? 40 : 28;
        y = ensureRoom(y, h);
        doc.fillColor(deep).font("Helvetica").fontSize(9.5).text(l.description || "-", 62, y + 9, { width: 260, lineBreak: false, ellipsis: true });
        if (l.detail) doc.fillColor(muted).font("Helvetica").fontSize(8).text(l.detail, 62, y + 23, { width: 260, lineBreak: false, ellipsis: true });
        doc.fillColor(deep).font("Helvetica").fontSize(9.5).text(String(l.qty == null ? 1 : l.qty), 330, y + 9, { width: 40, align: "right" });
        doc.text(l.unitAmount != null ? fmt(l.unitAmount) : "", 375, y + 9, { width: 80, align: "right" });
        doc.font("Helvetica-Bold").text(fmt(l.amount), 460, y + 9, { width: 80, align: "right" });
        y += h;
        doc.moveTo(48, y).lineTo(48 + contentWidth, y).strokeColor(border).lineWidth(1).stroke();
      });
      y += 18;
    }

    // Totals
    y = ensureRoom(y, 80);
    const subtotal = lines.reduce((s, l) => s + Number(l.amount || 0), 0);
    const discount = Number(o.discount || 0);
    const total = o.total != null ? Number(o.total) : subtotal - discount;
    doc.fillColor(muted).font("Helvetica").fontSize(10);
    doc.text("Subtotal", 340, y + 2, { width: 120 });
    doc.fillColor(deep).font("Helvetica").text(fmt(single ? total : subtotal), 430, y + 2, { width: 110, align: "right" });
    let ty = y + 18;
    if (discount > 0) {
      doc.fillColor(muted).font("Helvetica").text("Discount", 340, ty, { width: 120 });
      doc.fillColor("#00845f").font("Helvetica").text(`- ${fmt(discount)}`, 430, ty, { width: 110, align: "right" });
      ty += 16;
    }
    doc.fillColor(muted).font("Helvetica").text("Total", 340, ty, { width: 120 });
    doc.fillColor(deep).font("Helvetica").text(fmt(total), 430, ty, { width: 110, align: "right" });
    doc.moveTo(340, ty + 18).lineTo(540, ty + 18).strokeColor(border).lineWidth(1).stroke();
    doc.fillColor(deep).font("Helvetica-Bold").fontSize(12).text(status === "paid" ? "Amount paid" : "Amount due", 340, ty + 24, { width: 120 });
    doc.text(fmt(total), 430, ty + 24, { width: 110, align: "right" });
    y = ty + 54;

    // Optional table (e.g. the schools a hub bill covers)
    if (o.table && Array.isArray(o.table.rows) && o.table.rows.length) {
      y = ensureRoom(y, 70);
      doc.fillColor(deep).font("Helvetica-Bold").fontSize(10).text(o.table.title || "", 48, y);
      y += 18;
      const cols = o.table.columns;
      let x = 62;
      const xs = cols.map((c) => { const at = x; x += c.width; return at; });
      doc.roundedRect(48, y, contentWidth, 24, 6).fill(soft);
      doc.fillColor(muted).font("Helvetica-Bold").fontSize(8);
      cols.forEach((c, i) => doc.text(c.label, xs[i], y + 8, { width: c.width - 6, align: c.align || "left" }));
      y += 24;
      o.table.rows.forEach((row) => {
        doc.font("Helvetica").fontSize(9);
        const h = Math.max(22, ...row.map((cell, i) => doc.heightOfString(String(cell == null ? "" : cell), { width: cols[i].width - 6 }) + 12));
        y = ensureRoom(y, h);
        doc.fillColor(deep);
        row.forEach((cell, i) => doc.text(String(cell == null ? "" : cell), xs[i], y + 7, { width: cols[i].width - 6, align: cols[i].align || "left" }));
        y += h;
        doc.moveTo(48, y).lineTo(48 + contentWidth, y).strokeColor(border).lineWidth(0.5).stroke();
      });
      if (o.table.note) {
        y += 8;
        doc.fillColor(muted).font("Helvetica").fontSize(8).text(o.table.note, 48, y, { width: contentWidth });
        y += 20;
      }
      y += 12;
    }

    // Timeline (school invoices; hub bills show their dates at the top)
    if (o.timeline === false) {
      const footerY0 = doc.page.height - 58;
      doc.moveTo(48, footerY0 - 10).lineTo(48 + contentWidth, footerY0 - 10).strokeColor(border).lineWidth(1).stroke();
      doc.fillColor(muted).font("Helvetica").fontSize(8);
      doc.text(`Need help? Contact ${o.supportEmail || "support@managira.com"}`, 48, footerY0, { width: 320 });
      doc.text(`Generated ${formatInvoicePdfDate(new Date())}`, 320, footerY0, { width: 228, align: "right" });
      doc.end();
      return;
    }
    const timelineLines = [`Issued: ${formatInvoicePdfDate(o.issuedAt)}`];
    if (o.emailSentAt) timelineLines.push(`Invoice email sent: ${formatInvoicePdfDate(o.emailSentAt)}`);
    timelineLines.push(`${o.dueLabel || "Scheduled charge date"}: ${formatInvoicePdfDate(o.dueAt)}`);
    if (o.paidAt) timelineLines.push(`Paid at: ${formatInvoicePdfDate(o.paidAt)}`);
    if (o.failedAt) timelineLines.push(`Failed at: ${formatInvoicePdfDate(o.failedAt)}`);
    if (o.note) timelineLines.push(o.note);
    const timelineHeight = Math.max(88, 42 + (timelineLines.length * 16));
    y = ensureRoom(y, timelineHeight);
    doc.roundedRect(48, y, contentWidth, timelineHeight, 8).fill(soft);
    doc.fillColor(deep).font("Helvetica-Bold").fontSize(10).text("Payment Timeline", 62, y + 14);
    doc.fillColor(muted).font("Helvetica").fontSize(9);
    timelineLines.forEach((line, index) => doc.text(line, 62, y + 34 + (index * 16), { width: contentWidth - 28 }));

    const footerY = doc.page.height - 58;
    doc.moveTo(48, footerY - 10).lineTo(48 + contentWidth, footerY - 10).strokeColor(border).lineWidth(1).stroke();
    doc.fillColor(muted).font("Helvetica").fontSize(8);
    doc.text(`Need help? Contact ${o.supportEmail || "support@managira.com"}`, 48, footerY, { width: 320 });
    doc.text(`Generated ${formatInvoicePdfDate(new Date())}`, 320, footerY, { width: 228, align: "right" });

    doc.end();
  });
}

module.exports = { renderInvoicePdf, formatInvoicePdfDate, titleCaseStatus };
