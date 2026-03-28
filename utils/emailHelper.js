const nodemailer = require("nodemailer");
const dns = require("dns");
require("dotenv").config();

// Cache verified domains to avoid repeated DNS lookups
const _domainCache = new Map();

/**
 * Check if an email domain has valid MX records (can actually receive mail).
 * Results are cached for the lifetime of the process.
 */
async function hasMxRecords(email) {
  const domain = String(email).split("@")[1];
  if (!domain) return false;

  if (_domainCache.has(domain)) return _domainCache.get(domain);

  try {
    const records = await dns.promises.resolveMx(domain);
    // Filter out parked/catch-all domains with dummy MX records like "~" or "."
    const realRecords = (records || []).filter(r =>
      r.exchange && r.exchange.length > 2 && r.exchange !== "~" && r.exchange !== "."
    );
    const valid = realRecords.length > 0;
    _domainCache.set(domain, valid);
    return valid;
  } catch (_err) {
    _domainCache.set(domain, false);
    return false;
  }
}

function firstNonEmpty(...values) {
  for (const value of values) {
    if (value !== undefined && value !== null && String(value).trim() !== "") {
      return String(value).trim();
    }
  }
  return "";
}

function resolveSmtpConfig() {
  const user = firstNonEmpty(
    process.env.ADMIN_NOTIFY_EMAIL_USER,
    process.env.NOTIFY_EMAIL_USER,
    process.env.EMAIL_USER,
    process.env.SMTP_USER,
    process.env.MAIL_USER
  );

  const pass = firstNonEmpty(
    process.env.ADMIN_NOTIFY_EMAIL_PASSWORD,
    process.env.NOTIFY_EMAIL_PASSWORD,
    process.env.EMAIL_PASSWORD,
    process.env.EMAIL_PASS,
    process.env.SMTP_PASSWORD,
    process.env.SMTP_PASS,
    process.env.MAIL_PASSWORD,
    process.env.MAIL_PASS
  );

  const host = firstNonEmpty(
    process.env.SMTP_HOST,
    process.env.EMAIL_HOST,
    process.env.MAIL_HOST,
    "smtp.zoho.com"
  );

  const port = firstNonEmpty(process.env.SMTP_PORT, process.env.EMAIL_PORT, process.env.MAIL_PORT, "587");
  const secure = firstNonEmpty(process.env.SMTP_SECURE, process.env.EMAIL_SECURE, process.env.MAIL_SECURE, "false");

  return { user, pass, host, port, secure };
}

function escapeHtml(value = "") {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function renderCleanEmail({
  title,
  greeting,
  paragraphs = [],
  details = [],
  cta = null,
  note = "",
  schoolWebsiteUrl = "",
  schoolWebsiteHost = "",
  intro = "",
  message = "",
  closing = "",
  actionUrl = "",
  actionText = "",
  noReply = true,
  year = new Date().getFullYear(),
}) {
  const normalizedParagraphs = [
    ...paragraphs,
    ...(intro ? [intro] : []),
    ...(message ? [message] : []),
    ...(closing ? [closing] : []),
  ];

  const normalizedCta = cta?.url && cta?.text
    ? cta
    : actionUrl && actionText
      ? { url: actionUrl, text: actionText }
      : null;

  const detailsHtml = details.length
    ? `<div style="background:#f8fafc;border:1px solid #e5e7eb;border-radius:8px;padding:14px 16px;margin:18px 0;">
        ${details
          .map((item) => {
            if (typeof item === "string") {
              return `<p style="margin:6px 0;font-size:14px;color:#334155;">${escapeHtml(item)}</p>`;
            }

            const label = item?.label || "";
            const value = item?.value || "";

            if (!label) {
              return `<p style="margin:6px 0;font-size:14px;color:#334155;">${value}</p>`;
            }

            return `<p style="margin:6px 0;font-size:14px;color:#334155;"><strong>${escapeHtml(label)}:</strong> ${value}</p>`;
          })
          .join("")}
      </div>`
    : "";

  const ctaHtml = normalizedCta?.url && normalizedCta?.text
    ? `<div style="margin:22px 0;">
         <a href="${normalizedCta.url}" style="display:inline-block;background:#0f766e;color:#ffffff;text-decoration:none;padding:11px 18px;border-radius:8px;font-size:14px;font-weight:600;">${escapeHtml(
           normalizedCta.text
         )}</a>
       </div>`
    : "";

  const normalizedWebsiteUrl = String(schoolWebsiteUrl || "").trim();
  const normalizedWebsiteHost = String(schoolWebsiteHost || "").trim();
  const websiteLabel = normalizedWebsiteHost || normalizedWebsiteUrl.replace(/^https?:\/\//i, "");
  const schoolWebsiteHtml = normalizedWebsiteUrl
    ? `<p style="margin:12px 0 0;font-size:13px;color:#334155;">
         School website: <a href="${normalizedWebsiteUrl}" target="_blank" rel="noopener" style="color:#0f766e;text-decoration:underline;">${escapeHtml(websiteLabel)}</a>
       </p>`
    : "";

  return `
    <div style="background:#f8fafc;padding:24px 0;">
      <div style="max-width:620px;margin:0 auto;background:#ffffff;border:1px solid #e5e7eb;border-radius:10px;overflow:hidden;font-family:'Segoe UI',Arial,sans-serif;">
        <div style="background:#0f766e;padding:18px 22px;">
          <img src="https://www.managira.com/images/managira.png" alt="Managira" style="height:40px;display:block;">
        </div>
        <div style="padding:24px 22px;color:#0f172a;line-height:1.65;">
          <h2 style="margin:0 0 14px;font-size:21px;color:#0f766e;font-weight:700;">${escapeHtml(title || "Notification")}</h2>
          ${greeting ? `<p style="margin:0 0 12px;font-size:15px;">${greeting}</p>` : ""}
          ${normalizedParagraphs
            .map((text) => `<p style="margin:0 0 12px;font-size:15px;color:#1f2937;">${text}</p>`)
            .join("")}
          ${detailsHtml}
          ${ctaHtml}
          ${note ? `<p style="margin:14px 0 0;font-size:13px;color:#475569;">${note}</p>` : ""}
          ${schoolWebsiteHtml}
          ${noReply ? `<p style="margin:18px 0 0;font-size:12px;color:#b91c1c;font-weight:700;">THIS IS A NO-REPLY MESSAGE. PLEASE DO NOT REPLY TO THIS EMAIL.</p>` : ""}
        </div>
        <div style="border-top:1px solid #e5e7eb;background:#f8fafc;padding:12px 18px;text-align:center;font-size:12px;color:#64748b;">&copy; ${year} Managira. All rights reserved.</div>
      </div>
    </div>
  `;
}

// Persistent transporter — created once and reused across all sends to avoid
// repeated TCP/TLS handshake overhead on every call. If credentials are not
// yet available at module load, it is created lazily on first use.
let _transporter = null;
let _transporterConfig = null;

function getTransporter() {
  const { user, pass, host, port, secure } = resolveSmtpConfig();

  // Rebuild if config has changed (e.g. env hot-reload) or not yet created.
  const configKey = `${user}:${host}:${port}:${secure}`;
  if (_transporter && _transporterConfig === configKey) {
    return _transporter;
  }

  _transporter = nodemailer.createTransport({
    host,
    port: parseInt(port, 10),
    secure: secure === "true",
    auth: { user, pass },
    pool: true,           // keep-alive connection pool
    maxConnections: 3,
    maxMessages: 100,
    connectionTimeout: 10000,  // 10s to establish connection
    greetingTimeout: 10000,    // 10s for SMTP greeting
    socketTimeout: 15000,      // 15s for socket inactivity
    dsn: {
      id: 'managira-notify',
      return: 'HDRS',
      notify: ['NEVER'],       // suppress all bounce-back / DSN replies
      recipient: user,
    },
  });

  _transporterConfig = configKey;
  return _transporter;
}

/**
 * Safely send email with proper error handling.
 * Always uses ADMIN_NOTIFY_EMAIL_USER as the from address (ignores caller's from).
 */
async function sendEmailSafely(mailOptions, context = "Email") {
  const sendStart = Date.now();
  try {
    const { user, pass } = resolveSmtpConfig();

    if (!user || !pass) {
      console.warn(`[Email][${context}] SMTP credentials not configured — skipping.`);
      return false;
    }

    // Validate recipient email before attempting send
    const recipient = String(mailOptions.to || "").trim().toLowerCase();
    if (!recipient || !/^[^\s@]+@[^\s@]+\.[a-z]{2,}$/.test(recipient)) {
      console.warn(`[Email][${context}] Invalid recipient address "${mailOptions.to}" — skipping.`);
      return false;
    }

    // Verify the domain can receive email (has MX records)
    const domainOk = await hasMxRecords(recipient);
    if (!domainOk) {
      console.warn(`[Email][${context}] Domain has no MX records for "${recipient}" — skipping.`);
      return false;
    }

    const transporter = getTransporter();

    // Always use the authenticated SMTP user as the from address
    const from = user;

    // Strip smtpConfig if caller passed it (we ignore custom transporter configs)
    const { smtpConfig, from: _ignoredFrom, ...restOptions } = mailOptions;

    console.info(`[Email][${context}] sending via SMTP to ${restOptions.to}`);

    const info = await transporter.sendMail({
      from,
      ...restOptions,
      headers: {
        ...restOptions.headers,
        'X-Auto-Response-Suppress': 'All',
        'Auto-Submitted': 'auto-generated',
      },
    });

    console.info(`[Email][${context}] SMTP sent OK in ${Date.now() - sendStart}ms`, info.messageId);
    return true;
  } catch (error) {
    _transporter = null;
    _transporterConfig = null;
    console.error(`[Email][${context}] SMTP FAILED after ${Date.now() - sendStart}ms:`, error.message);
    if (error.code === 'EAUTH') {
      console.error(`[Email][${context}] Authentication failed — check ADMIN_NOTIFY_EMAIL_*, NOTIFY_EMAIL_*, EMAIL_* or SMTP_* credentials.`);
    } else if (error.code === 'ECONNECTION' || error.code === 'ETIMEDOUT' || error.code === 'ESOCKET') {
      const smtp = resolveSmtpConfig();
      console.error(`[Email][${context}] SMTP connection failed — SMTP_HOST=${smtp.host} SMTP_PORT=${smtp.port}`);
    }
    return false;
  }
}

/**
 * Fire-and-forget email sender. Queues the email in the background and returns
 * immediately so the HTTP response is never blocked by SMTP latency/timeouts.
 * Use this for all non-critical emails (notifications, confirmations, etc.).
 */
function sendEmailInBackground(mailOptions, context = "Email") {
  // Intentionally NOT awaited — runs in background
  sendEmailSafely(mailOptions, context).catch((err) => {
    console.error(`[Email][${context}] Background send error:`, err.message);
  });
}

module.exports = {
  sendEmailSafely,
  sendEmailInBackground,
  renderCleanEmail,
  escapeHtml,
};
