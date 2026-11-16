// The look of every Managira email (feature `email_refresh`; utils/emailHelper.js picks it).
//
// Built for mail clients, not browsers: tables for layout, inline styles, a hidden preview
// line, one button, and a quiet footer. A school's email carries the school's name at the top
// and "Sent by <school> through Managira" at the bottom. Optional emails get a per-recipient
// unsubscribe line in the footer slot (UNSUBSCRIBE_SLOT), filled in by sendEmailSafely.

const PUBLIC_BASE = (process.env.BASE_URL_PRODUCTION || process.env.BASE_URL || "https://managira.com").replace(/\/+$/, "");
const LOGO_URL = `${PUBLIC_BASE}/images/managira-logo-sm.png`;
const HELP_URL = `${PUBLIC_BASE}/legal/user-documentation`;
const UNSUBSCRIBE_SLOT = "<!--managira:unsubscribe-->";

const COLORS = {
  page: "#f3f4f6",
  card: "#ffffff",
  border: "#e5e7eb",
  heading: "#0f172a",
  body: "#334155",
  muted: "#64748b",
  faint: "#94a3b8",
  soft: "#f8fafc",
  softBorder: "#eef2f6",
  brand: "#0f766e",
};
const FONT = "-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif";

function escapeHtml(value = "") {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

// A link a caller built (a CTA or website URL). Only http(s) and mailto are kept.
function safeUrl(url) {
  const value = String(url || "").trim();
  return /^(https?:\/\/|mailto:)/i.test(value) ? value.replace(/"/g, "%22") : "";
}

const stripTags = (html) => String(html || "")
  .replace(/<style[\s\S]*?<\/style>/gi, " ")
  .replace(/<[^>]+>/g, " ")
  .replace(/&nbsp;/gi, " ")
  .replace(/&amp;/gi, "&")
  .replace(/&lt;/gi, "<")
  .replace(/&gt;/gi, ">")
  .replace(/&quot;/gi, '"')
  .replace(/&#39;/gi, "'")
  .replace(/\s+/g, " ")
  .trim();

function previewText(text) {
  const plain = stripTags(text);
  if (plain.length <= 140) return plain;
  return `${plain.slice(0, 137).replace(/\s+\S*$/, "")}…`;
}

const BLOCK_START = /^\s*<(table|ul|ol|div|h[1-6]|p|blockquote)\b/i;

function paragraphHtml(text) {
  const content = String(text ?? "");
  if (!content.trim()) return "";
  if (BLOCK_START.test(content)) {
    return `<div class="t-body" style="margin:0 0 16px;font-size:15px;line-height:1.6;color:${COLORS.body};">${content}</div>`;
  }
  return `<p class="t-body" style="margin:0 0 16px;font-size:15px;line-height:1.6;color:${COLORS.body};">${content}</p>`;
}

function detailsHtml(details) {
  const rows = (Array.isArray(details) ? details : [])
    .map((item) => {
      if (item == null || item === "") return "";
      if (typeof item === "string") {
        return `<tr><td colspan="2" class="t-body" style="padding:6px 0;font-size:14px;line-height:1.5;color:${COLORS.body};">${escapeHtml(item)}</td></tr>`;
      }
      const label = String(item.label || "").trim();
      const value = item.value == null || item.value === "" ? "" : String(item.value);
      if (!label && !value) return "";
      if (!label) {
        return `<tr><td colspan="2" class="t-body" style="padding:6px 0;font-size:14px;line-height:1.5;color:${COLORS.body};">${value}</td></tr>`;
      }
      return `<tr>
        <td class="t-muted d-label" valign="top" style="padding:6px 16px 6px 0;width:36%;font-size:14px;line-height:1.5;color:${COLORS.muted};">${escapeHtml(label)}</td>
        <td class="t-strong d-value" valign="top" style="padding:6px 0;font-size:14px;line-height:1.5;color:${COLORS.heading};font-weight:500;">${value || "&mdash;"}</td>
      </tr>`;
    })
    .filter(Boolean);
  if (!rows.length) return "";
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" class="bg-soft" style="margin:4px 0 20px;background:${COLORS.soft};border:1px solid ${COLORS.softBorder};border-radius:10px;">
    <tr><td style="padding:12px 18px;">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">${rows.join("")}</table>
    </td></tr>
  </table>`;
}

function buttonHtml(cta, showLink) {
  const url = safeUrl(cta?.url);
  const text = String(cta?.text || "").trim();
  if (!url || !text) return "";
  const fallback = showLink
    ? `<p class="t-muted" style="margin:0 0 16px;font-size:13px;line-height:1.5;color:${COLORS.muted};">If the button doesn't work, copy this link into your browser:<br><a href="${url}" style="color:${COLORS.brand};word-break:break-all;">${escapeHtml(url)}</a></p>`
    : "";
  return `<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:8px 0 20px;">
      <tr><td align="center" bgcolor="${COLORS.brand}" style="border-radius:8px;background:${COLORS.brand};">
        <a href="${url}" target="_blank" rel="noopener" style="display:inline-block;padding:12px 24px;font-family:${FONT};font-size:15px;font-weight:600;line-height:1.2;color:#ffffff;text-decoration:none;border-radius:8px;">${escapeHtml(text)}</a>
      </td></tr>
    </table>${fallback}`;
}

function brandHtml({ schoolName, schoolLogoUrl }) {
  const name = String(schoolName || "").trim();
  if (name) {
    const logo = /^https:\/\//i.test(String(schoolLogoUrl || ""))
      ? `<td valign="middle" style="padding-right:10px;"><img src="${safeUrl(schoolLogoUrl)}" alt="" width="32" height="32" style="display:block;width:32px;height:32px;border:0;border-radius:6px;object-fit:contain;"></td>`
      : "";
    return `<table role="presentation" cellpadding="0" cellspacing="0" border="0"><tr>${logo}
      <td valign="middle" class="t-strong" style="font-family:${FONT};font-size:16px;font-weight:700;line-height:1.3;color:${COLORS.heading};">${escapeHtml(name)}</td>
    </tr></table>`;
  }
  return `<table role="presentation" cellpadding="0" cellspacing="0" border="0"><tr>
      <td valign="middle" style="padding-right:10px;"><img src="${LOGO_URL}" alt="" width="28" height="28" style="display:block;width:28px;height:28px;border:0;"></td>
      <td valign="middle" class="t-strong" style="font-family:${FONT};font-size:17px;font-weight:700;letter-spacing:-0.01em;line-height:1.3;color:${COLORS.heading};">Managira</td>
    </tr></table>`;
}

function footerHtml({ schoolName, schoolWebsiteUrl, schoolWebsiteHost, reason, year }) {
  const lines = [];
  const name = String(schoolName || "").trim();
  if (name) {
    lines.push(`Sent by ${escapeHtml(name)} through Managira.`);
  } else {
    lines.push(`Managira, the student information system for K-12 schools &middot; <a href="${HELP_URL}" target="_blank" rel="noopener" style="color:${COLORS.muted};text-decoration:underline;">Help Center</a>`);
  }
  const websiteUrl = safeUrl(schoolWebsiteUrl);
  if (websiteUrl) {
    const label = String(schoolWebsiteHost || "").trim() || websiteUrl.replace(/^https?:\/\//i, "").replace(/\/$/, "");
    lines.push(`<a href="${websiteUrl}" target="_blank" rel="noopener" style="color:${COLORS.muted};text-decoration:underline;">${escapeHtml(label)}</a>`);
  }
  if (reason) lines.push(escapeHtml(reason));
  const text = lines
    .map((line) => `<p class="t-muted" style="margin:0 0 6px;font-size:12px;line-height:1.6;color:${COLORS.muted};">${line}</p>`)
    .join("");
  return `${text}${UNSUBSCRIBE_SLOT}<p class="t-faint" style="margin:10px 0 0;font-size:12px;line-height:1.6;color:${COLORS.faint};">&copy; ${Number(year) || new Date().getFullYear()} Managira</p>`;
}

// The unsubscribe line sendEmailSafely puts in the footer slot for each recipient.
function unsubscribeLine({ url, settingsUrl, label }) {
  const what = label ? escapeHtml(String(label).toLowerCase().replace(/\.$/, "")) : "these emails";
  const settings = settingsUrl
    ? ` or <a href="${safeUrl(settingsUrl)}" target="_blank" rel="noopener" style="color:${COLORS.muted};text-decoration:underline;">manage your email settings</a>`
    : "";
  return `<p class="t-muted" style="margin:0 0 6px;font-size:12px;line-height:1.6;color:${COLORS.muted};">Don't want ${what}? <a href="${safeUrl(url)}" target="_blank" rel="noopener" style="color:${COLORS.muted};text-decoration:underline;">Unsubscribe</a>${settings}.</p>`;
}

function renderModernEmail({
  title,
  showTitle = true,
  greeting,
  paragraphs = [],
  details = [],
  cta = null,
  showLink = false,
  note = "",
  signoff = "",
  preheader = "",
  schoolName = "",
  schoolLogoUrl = "",
  schoolWebsiteUrl = "",
  schoolWebsiteHost = "",
  reason = "",
  intro = "",
  message = "",
  closing = "",
  actionUrl = "",
  actionText = "",
  year = new Date().getFullYear(),
} = {}) {
  const allParagraphs = [
    ...(Array.isArray(paragraphs) ? paragraphs : [paragraphs]),
    ...(intro ? [intro] : []),
    ...(message ? [message] : []),
    ...(closing ? [closing] : []),
  ].filter((text) => text != null && String(text).trim() !== "");

  const button = cta?.url && cta?.text ? cta : (actionUrl && actionText ? { url: actionUrl, text: actionText } : null);
  const heading = String(title || "").trim();
  const preview = previewText(preheader || allParagraphs[0] || heading);
  // Zero-width padding keeps mail clients from pulling body text into the preview line.
  const previewPad = "&#847;&zwnj;&nbsp;".repeat(40);

  const body = [
    showTitle && heading
      ? `<h1 class="t-strong" style="margin:0 0 16px;font-family:${FONT};font-size:22px;line-height:1.3;font-weight:700;letter-spacing:-0.01em;color:${COLORS.heading};">${escapeHtml(heading)}</h1>`
      : "",
    greeting ? `<p class="t-body" style="margin:0 0 16px;font-size:15px;line-height:1.6;color:${COLORS.body};">${greeting}</p>` : "",
    allParagraphs.map(paragraphHtml).join(""),
    detailsHtml(details),
    buttonHtml(button, showLink),
    note ? `<p class="t-muted" style="margin:0 0 12px;font-size:13px;line-height:1.6;color:${COLORS.muted};">${note}</p>` : "",
    signoff ? `<p class="t-body" style="margin:20px 0 0;font-size:15px;line-height:1.6;color:${COLORS.body};">${escapeHtml(signoff).replace(/\n/g, "<br>")}</p>` : "",
  ].join("");

  return `<!DOCTYPE html>
<html lang="en" xmlns="http://www.w3.org/1999/xhtml">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="x-apple-disable-message-reformatting">
<meta name="color-scheme" content="light dark">
<meta name="supported-color-schemes" content="light dark">
<title>${escapeHtml(heading || "Managira")}</title>
<style>
  body { margin: 0; padding: 0; width: 100% !important; -webkit-text-size-adjust: 100%; }
  table { border-collapse: separate; mso-table-lspace: 0pt; mso-table-rspace: 0pt; }
  img { -ms-interpolation-mode: bicubic; }
  a { color: ${COLORS.brand}; }
  @media (max-width: 620px) {
    .m-pad { padding: 24px 20px !important; }
    .m-outer { padding: 20px 8px !important; }
    /* Details stack on a phone: the label above its value, both full width. */
    .d-label, .d-value { display: block !important; width: auto !important; }
    .d-label { padding: 10px 0 0 !important; font-size: 13px !important; }
    .d-value { padding: 2px 0 6px !important; }
  }
  @media (prefers-color-scheme: dark) {
    .bg-page { background: #0b1120 !important; }
    .bg-card { background: #111827 !important; border-color: #1f2937 !important; }
    .bg-soft { background: #0f172a !important; border-color: #1e293b !important; }
    .t-strong { color: #f1f5f9 !important; }
    .t-body { color: #cbd5e1 !important; }
    .t-muted { color: #94a3b8 !important; }
    .t-faint { color: #64748b !important; }
  }
</style>
</head>
<body class="bg-page" style="margin:0;padding:0;background:${COLORS.page};">
<!--preheader--><div style="display:none;font-size:1px;line-height:1px;max-height:0;max-width:0;opacity:0;overflow:hidden;mso-hide:all;">${escapeHtml(preview)}${previewPad}</div><!--/preheader-->
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" class="bg-page" style="background:${COLORS.page};">
  <tr><td align="center" class="m-outer" style="padding:32px 12px;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width:600px;font-family:${FONT};">
      <tr><td style="padding:0 4px 16px;">${brandHtml({ schoolName, schoolLogoUrl })}</td></tr>
      <tr><td class="bg-card" style="background:${COLORS.card};border:1px solid ${COLORS.border};border-radius:14px;">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
          <tr><td class="m-pad" style="padding:32px 36px;font-family:${FONT};">${body}</td></tr>
        </table>
      </td></tr>
      <tr><td style="padding:20px 4px 0;font-family:${FONT};">${footerHtml({ schoolName, schoolWebsiteUrl, schoolWebsiteHost, reason, year })}</td></tr>
    </table>
  </td></tr>
</table>
</body>
</html>`;
}

const safeChar = (code) => {
  if (!Number.isInteger(code) || code <= 0 || code > 0x10ffff || (code >= 0xd800 && code <= 0xdfff)) return "";
  if (code === 0x34f || code === 0x200c) return "";
  return String.fromCodePoint(code);
};

// Plain-text part of every email: links keep their address, lists and tables stay readable.
function htmlToPlainText(html) {
  if (!html || typeof html !== "string") return "";
  return html
    .replace(/<!--preheader-->[\s\S]*?<!--\/preheader-->/gi, "")
    .replace(/<head[\s\S]*?<\/head>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<!--[\s\S]*?-->/g, "")
    .replace(/<a\b[^>]*href\s*=\s*"([^"]*)"[^>]*>([\s\S]*?)<\/a>/gi, (_, href, label) => {
      const text = stripTags(label);
      const url = String(href || "").replace(/&amp;/g, "&");
      if (!url || /^#/.test(url)) return text;
      if (!text || text === url || url === `mailto:${text}`) return url.replace(/^mailto:/i, "");
      return `${text} (${url})`;
    })
    .replace(/<\/li>/gi, "")
    .replace(/<li[^>]*>/gi, "\n- ")
    .replace(/<\/t[dh]>\s*<t[dh][^>]*>/gi, ": ")
    .replace(/<\/(p|h[1-6]|ul|ol|table)>/gi, "\n\n")
    .replace(/<\/(div|tr)>/gi, "\n")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/gi, " ")
    .replace(/&middot;/gi, "·")
    .replace(/&mdash;/gi, "—")
    .replace(/&copy;/gi, "©")
    .replace(/&#847;|&zwnj;/gi, "")
    // Numeric entities (he.encode writes &#x27; and friends) become their characters.
    .replace(/&#x([0-9a-f]{1,6});/gi, (_, hex) => safeChar(Number.parseInt(hex, 16)))
    .replace(/&#(\d{1,7});/g, (_, dec) => safeChar(Number.parseInt(dec, 10)))
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/&amp;/gi, "&")
    .replace(/[ \t]+/g, " ")
    .replace(/ *\n */g, "\n")
    // A table row whose first cell is a picture (the logo) leaves no label in front.
    .replace(/^: /gm, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

module.exports = {
  renderModernEmail,
  detailsBlock: detailsHtml,
  htmlToPlainText,
  unsubscribeLine,
  UNSUBSCRIBE_SLOT,
  LOGO_URL,
  HELP_URL,
  escapeHtml,
};
