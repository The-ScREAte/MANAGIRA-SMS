const nodemailer = require("nodemailer");
const dns = require("dns");
const path = require("path");
require("dotenv").config();

// Lazy db reference so this module can still be required even if config/db
// hasn't initialized (e.g. CLI scripts).
let _db = null;
function _getDb() {
  if (_db) return _db;
  try { _db = require("../config/db"); } catch (_) { _db = null; }
  return _db;
}
let _notificationService = null;
function _getNotificationService() {
  if (_notificationService) return _notificationService;
  try { _notificationService = require("./notificationService"); } catch (_) { _notificationService = null; }
  return _notificationService;
}
const {
  isEmailSuppressed,
  suppressEmail,
  isHardAddressFailure,
} = require("./emailSuppression");

const MANAGIRA_LOGO_PATH = path.join(__dirname, "../public/images/managira.png");

// Public HTTPS URL for the logo — used as the PRIMARY <img src> so mail clients
// that strip inline cid: attachments (Outlook web, some Yahoo flows, forwards,
// gmail's “download images” path) still render the brand. The cid: copy is kept
// as a redundant inline attachment for clients that prefer it.
const MANAGIRA_PUBLIC_BASE =
  (process.env.BASE_URL_PRODUCTION
    || process.env.BASE_URL
    || "https://managira.com").replace(/\/$/, "");
const MANAGIRA_LOGO_URL = `${MANAGIRA_PUBLIC_BASE}/images/managira.png`;

// Display name used on every outgoing email. Mail clients prefer a human-
// readable “From”; emails with just an address score higher for Promotions.
const MANAGIRA_FROM_NAME = process.env.EMAIL_FROM_NAME || "Managira";
const EMAIL_ADDRESS_PATTERN = /^[^\s@]+@[^\s@]+\.[a-z]{2,}$/i;

// Strip HTML to a clean plain-text body. Gmail/Outlook flag HTML-only mail as
// promotional more often than multipart/alternative mail.
function htmlToPlainText(html) {
  if (!html || typeof html !== "string") return "";
  return html
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<\/(p|div|h[1-6]|li|tr|br)>/gi, "\n")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

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
  } catch (error) {
    const hardFailureCodes = new Set(["ENOTFOUND", "ENODATA", "EINVAL", "EBADNAME", "NOTFOUND"]);

    if (hardFailureCodes.has(error?.code)) {
      _domainCache.set(domain, false);
      return false;
    }

    // Do not block outbound email on transient DNS issues in the app host.
    console.warn(`[Email][MX] Lookup failed for domain "${domain}" with ${error?.code || 'unknown error'}; allowing SMTP send attempt.`);
    _domainCache.set(domain, true);
    return true;
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

function sanitizeEnvelope(envelope) {
  if (!envelope || typeof envelope !== "object" || Array.isArray(envelope)) {
    return undefined;
  }

  const sanitized = { ...envelope };
  delete sanitized.size;
  return sanitized;
}

function toRecipientList(value) {
  const rawValues = Array.isArray(value) ? value : [value];
  const validRecipients = [];
  const invalidRecipients = [];
  const seen = new Set();

  for (const rawValue of rawValues) {
    const chunks = String(rawValue ?? "").split(/[;,]/);
    for (const chunk of chunks) {
      const normalized = String(chunk || "").trim().toLowerCase();
      if (!normalized || seen.has(normalized)) {
        continue;
      }
      seen.add(normalized);

      if (EMAIL_ADDRESS_PATTERN.test(normalized)) {
        validRecipients.push(normalized);
      } else {
        invalidRecipients.push(normalized);
      }
    }
  }

  return { validRecipients, invalidRecipients };
}

function formatRecipientList(recipients) {
  return (Array.isArray(recipients) ? recipients : [recipients])
    .filter(Boolean)
    .join(", ");
}

function normalizeFailureNotification(raw) {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return null;
  }

  const orgId = Number.parseInt(raw.orgId, 10);
  if (!Number.isInteger(orgId) || orgId <= 0) {
    return null;
  }

  const recipientType = raw.recipientType === "staff" || raw.recipientType === "guardian"
    ? raw.recipientType
    : "broadcast";
  const parsedRecipientId = Number.parseInt(raw.recipientId, 10);
  const recipientId = recipientType === "broadcast"
    ? 0
    : (Number.isInteger(parsedRecipientId) && parsedRecipientId > 0 ? parsedRecipientId : 0);

  if (recipientType !== "broadcast" && recipientId <= 0) {
    return null;
  }

  const refId = Number.parseInt(raw.refId, 10);
  const dedupeHours = Number.parseInt(raw.dedupeHours, 10);

  return {
    orgId,
    recipientType,
    recipientId,
    title: firstNonEmpty(raw.title) || "Email delivery failed",
    body: firstNonEmpty(raw.body) || "",
    link: firstNonEmpty(raw.link) || '/common/failedEmails',
    refId: Number.isInteger(refId) && refId > 0 ? refId : null,
    dedupeHours: Number.isInteger(dedupeHours) && dedupeHours > 0 ? Math.min(dedupeHours, 72) : 12,
  };
}

function buildFailureNotification(orgId, options = {}) {
  return normalizeFailureNotification({
    orgId,
    recipientType: options.recipientType,
    recipientId: options.recipientId,
    title: options.title,
    body: options.body,
    link: options.link,
    refId: options.refId,
    dedupeHours: options.dedupeHours,
  });
}

function getFailureReasonText(reason) {
  switch (reason) {
    case "invalid_format":
      return "The email address format is invalid.";
    case "no_mx_records":
      return "The email domain does not accept mail.";
    case "suppressed":
      return "This address was already marked as undeliverable from an earlier attempt.";
    case "smtp_hard_bounce":
      return "The recipient server rejected the address as undeliverable.";
    default:
      return "Please update the address and try again.";
  }
}

function buildFailureNotificationBody(baseBody, recipient, reason) {
  const safeRecipient = firstNonEmpty(recipient) || "the saved email address";
  const intro = firstNonEmpty(baseBody) || `Messages to ${safeRecipient} could not be delivered.`;
  return `${intro} ${getFailureReasonText(reason)}`.trim();
}

async function notifyEmailFailure(db, { recipient, reason, failureNotification }) {
  const notification = normalizeFailureNotification(failureNotification);
  if (!db || !notification) {
    return;
  }

  const notificationService = _getNotificationService();
  if (!notificationService || typeof notificationService.createNotification !== "function") {
    return;
  }

  const body = buildFailureNotificationBody(notification.body, recipient, reason);

  try {
    const existing = await db.query(
      `SELECT 1
       FROM notifications
       WHERE organization_id = $1
         AND recipient_type = $2
         AND recipient_id = $3
         AND type = 'email_delivery_failed'
         AND title = $4
         AND body = $5
         AND COALESCE(link, '') = COALESCE($6, '')
         AND created_at >= NOW() - ($7::int * INTERVAL '1 hour')
       LIMIT 1`,
      [
        notification.orgId,
        notification.recipientType,
        notification.recipientId,
        notification.title,
        body,
        notification.link,
        notification.dedupeHours,
      ]
    );
    if (existing.rows.length > 0) {
      return;
    }
  } catch (_) {
    // The notifications table may not exist yet; createNotification handles that path.
  }

  try {
    await notificationService.createNotification(db, {
      orgId: notification.orgId,
      recipientType: notification.recipientType,
      recipientId: notification.recipientId,
      type: "email_delivery_failed",
      title: notification.title,
      body,
      link: notification.link,
      refId: notification.refId,
    });
  } catch (error) {
    console.warn(`[Email][Notify] Failed to create delivery notification: ${error?.message || "unknown error"}`);
  }

  // Record failure and fan-out targeted notifications to managers/supervisors.
  // Run in background — never let this block the caller.
  _recordAndFanOutEmailFailure(db, notification.orgId, recipient, reason, notification).catch(() => {});
}

// ── email_delivery_failures table ────────────────────────────────────────────

let _failuresSchemaReady = false;
async function _ensureEmailFailuresSchema(db) {
  if (_failuresSchemaReady) return;
  try {
    await db.query(`
      CREATE TABLE IF NOT EXISTS email_delivery_failures (
        id           SERIAL PRIMARY KEY,
        organization_id INTEGER NOT NULL,
        user_id      INTEGER NOT NULL,
        user_type    TEXT NOT NULL DEFAULT 'staff',
        failed_email TEXT NOT NULL,
        reason       TEXT NOT NULL DEFAULT 'unknown',
        failure_count INTEGER NOT NULL DEFAULT 1,
        first_failed_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
        last_failed_at  TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
        UNIQUE (organization_id, user_id, user_type)
      )
    `);
    _failuresSchemaReady = true;
  } catch (_) { /* non-fatal */ }
}

/**
 * Look up which staff member or guardian owns `email` in `orgId`.
 * Returns { userId, userType } or null if not found.
 */
async function _findUserByEmail(db, email, orgId) {
  const addr = String(email || "").trim().toLowerCase();
  if (!addr || !orgId) return null;
  try {
    const staffRes = await db.query(
      `SELECT user_id FROM users WHERE LOWER(email) = $1 AND organization_id = $2 LIMIT 1`,
      [addr, orgId]
    );
    if (staffRes.rows.length > 0) return { userId: staffRes.rows[0].user_id, userType: 'staff' };

    const guardRes = await db.query(
      `SELECT guardian_id AS user_id FROM guardians WHERE LOWER(email) = $1 AND organization_id = $2 LIMIT 1`,
      [addr, orgId]
    );
    if (guardRes.rows.length > 0) return { userId: guardRes.rows[0].user_id, userType: 'guardian' };

    const studentRes = await db.query(
      `SELECT student_id AS user_id FROM students WHERE LOWER(email) = $1 AND organization_id = $2 LIMIT 1`,
      [addr, orgId]
    );
    if (studentRes.rows.length > 0) return { userId: studentRes.rows[0].user_id, userType: 'student' };
  } catch (_) { /* non-fatal */ }
  return null;
}

/**
 * Upsert a row into email_delivery_failures.
 * Exported so the /failedEmails controller can clear rows on successful re-test.
 */
async function recordEmailDeliveryFailure(db, orgId, email, reason, userId, userType) {
  if (!db || !orgId || !userId) return;
  try {
    await _ensureEmailFailuresSchema(db);
    await db.query(
      `INSERT INTO email_delivery_failures
         (organization_id, user_id, user_type, failed_email, reason, failure_count, last_failed_at)
       VALUES ($1, $2, $3, $4, $5, 1, CURRENT_TIMESTAMP)
       ON CONFLICT (organization_id, user_id, user_type) DO UPDATE SET
         failed_email  = EXCLUDED.failed_email,
         reason        = EXCLUDED.reason,
         failure_count = email_delivery_failures.failure_count + 1,
         last_failed_at = CURRENT_TIMESTAMP`,
      [orgId, userId, userType || 'staff', String(email || '').toLowerCase(), String(reason || 'unknown').slice(0, 64)]
    );
  } catch (_) { /* non-fatal */ }
}

/**
 * After recording the failure, send targeted "Incorrect Email Detected"
 * notifications to the affected user + every manager/supervisor in the org.
 */
async function _recordAndFanOutEmailFailure(db, orgId, email, reason, notification) {
  if (!db || !orgId) return;
  const notificationService = _getNotificationService();
  if (!notificationService) return;

  // Find the affected user
  const found = await _findUserByEmail(db, email, orgId);
  if (!found) return; // Can't link to a user — nothing to record

  const { userId, userType } = found;

  // Persist the failure record
  await recordEmailDeliveryFailure(db, orgId, email, reason, userId, userType);

  // Build fan-out notification payload
  const title = 'Incorrect Email Detected';
  const safeEmail = String(email || '').slice(0, 120);
  const reasonText = getFailureReasonText(reason);
  const body = `The email address "${safeEmail}" could not be delivered. ${reasonText}`;
  const link = '/common/failedEmails';
  const dedupeHours = 12;

  // Collect recipient IDs: affected user + all managers + all supervisors
  const recipientRows = [];

  // The affected user themselves (staff only — guardians don't see the management panel)
  if (userType === 'staff') {
    recipientRows.push({ recipientType: 'staff', recipientId: userId });
  }

  // All managers and supervisors in the org
  try {
    const mgrRes = await db.query(
      `SELECT user_id FROM users
       WHERE organization_id = $1
         AND LOWER(account_type) IN ('organization','admin','mini admin','supervisor','superviser','manager')
         AND (deleted = false OR deleted IS NULL)
       LIMIT 30`,
      [orgId]
    );
    for (const row of mgrRes.rows) {
      if (row.user_id !== userId) { // don't double-notify the affected user
        recipientRows.push({ recipientType: 'staff', recipientId: row.user_id });
      }
    }
  } catch (_) { /* non-fatal */ }

  // Deduplicate by recipientId
  const seen = new Set();
  const unique = recipientRows.filter(r => {
    const k = `${r.recipientType}:${r.recipientId}`;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });

  // Create one notification per recipient (with per-recipient deduplication)
  for (const { recipientType, recipientId } of unique) {
    try {
      const existing = await db.query(
        `SELECT 1 FROM notifications
         WHERE organization_id = $1 AND recipient_type = $2 AND recipient_id = $3
           AND type = 'email_delivery_failed' AND title = $4
           AND created_at >= NOW() - ($5::int * INTERVAL '1 hour')
         LIMIT 1`,
        [orgId, recipientType, recipientId, title, dedupeHours]
      );
      if (existing.rows.length > 0) continue;

      await notificationService.createNotification(db, {
        orgId,
        recipientType,
        recipientId,
        type: 'email_delivery_failed',
        title,
        body,
        link,
      });
    } catch (_) { /* non-fatal per-recipient */ }
  }
}

function renderCleanEmail({
  title,
  showTitle = true,
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
  followManagira = false,
  linkedinUrl = "https://www.linkedin.com/company/managira",
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

  const followManagiraHtml = followManagira
    ? `<p style="margin:14px 0 0;font-size:13px;color:#475569;">Follow <a href="${linkedinUrl}" target="_blank" rel="noopener" style="color:#0f766e;text-decoration:underline;">Managira on LinkedIn</a> for more info and broader updates.</p>`
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
        <div style="background:#0f766e;padding:16px 22px;display:flex;align-items:center;gap:12px;">
          <img src="${MANAGIRA_LOGO_URL}" alt="Managira" width="40" height="40" style="height:40px;width:40px;display:block;border:0;outline:none;text-decoration:none;border-radius:6px;background:#ffffff;padding:4px;">
          <span style="color:#ffffff;font-size:18px;font-weight:700;letter-spacing:0.02em;font-family:'Segoe UI',Arial,sans-serif;">Managira</span>
        </div>
        <div style="padding:24px 22px;color:#0f172a;line-height:1.65;">
          ${showTitle ? `<h2 style="margin:0 0 14px;font-size:21px;color:#0f766e;font-weight:700;">${escapeHtml(title || "Notification")}</h2>` : ""}
          ${greeting ? `<p style="margin:0 0 12px;font-size:15px;">${greeting}</p>` : ""}
          ${normalizedParagraphs
            .map((text) => `<p style="margin:0 0 12px;font-size:15px;color:#1f2937;">${text}</p>`)
            .join("")}
          ${detailsHtml}
          ${ctaHtml}
          ${followManagiraHtml}
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
let _warnedMissingBounceAddress = false;

function resolveEnvelopeFrom(fromAddress) {
  const envelopeFrom = firstNonEmpty(
    process.env.EMAIL_BOUNCE_ADDRESS,
    process.env.SMTP_ENVELOPE_FROM,
    process.env.MAIL_ENVELOPE_FROM,
    process.env.EMAIL_RETURN_PATH,
    fromAddress
  );

  if (!_warnedMissingBounceAddress && envelopeFrom === fromAddress) {
    _warnedMissingBounceAddress = true;
    console.warn('[Email] Dedicated bounce address is not configured. Mailer-Daemon replies may still go to the authenticated mailbox. Set EMAIL_BOUNCE_ADDRESS or SMTP_ENVELOPE_FROM to route bounces elsewhere.');
  }

  return envelopeFrom;
}

function buildEnvelopeConfig(rawEnvelope, fromAddress, recipients) {
  const sanitizedEnvelope = sanitizeEnvelope(rawEnvelope) || {};
  const envelopeFrom = firstNonEmpty(sanitizedEnvelope.from) || resolveEnvelopeFrom(fromAddress);
  const explicitTo = sanitizedEnvelope.to;
  const envelopeRecipients = Array.isArray(explicitTo)
    ? explicitTo
    : (explicitTo ? toRecipientList(explicitTo).validRecipients : recipients);

  if (!envelopeFrom || !Array.isArray(envelopeRecipients) || envelopeRecipients.length === 0) {
    return undefined;
  }

  return {
    ...sanitizedEnvelope,
    from: envelopeFrom,
    to: envelopeRecipients,
  };
}

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
  let attemptedRecipients = [];
  try {
    const { user, pass } = resolveSmtpConfig();

    if (!user || !pass) {
      console.warn(`[Email][${context}] SMTP credentials not configured — skipping.`);
      return false;
    }

    const db = _getDb();
    const { validRecipients, invalidRecipients } = toRecipientList(mailOptions.to);

    if (invalidRecipients.length > 0) {
      console.warn(`[Email][${context}] Invalid recipient address(es) "${formatRecipientList(invalidRecipients)}" — skipping those recipients.`);
      if (db) {
        for (const invalidRecipient of invalidRecipients) {
          suppressEmail(db, invalidRecipient, "invalid_format", "Malformed address").catch(() => {});
          await notifyEmailFailure(db, {
            recipient: invalidRecipient,
            reason: "invalid_format",
            failureNotification: mailOptions.failureNotification,
          });
        }
      }
    }

    if (!validRecipients.length) {
      return false;
    }

    let deliverableRecipients = [...validRecipients];

    // Skip recipients that have previously failed permanently.
    if (db) {
      const filteredRecipients = [];
      for (const recipient of deliverableRecipients) {
        try {
          const blocked = await isEmailSuppressed(db, recipient);
          if (blocked) {
            await notifyEmailFailure(db, {
              recipient,
              reason: "suppressed",
              failureNotification: mailOptions.failureNotification,
            });
            continue;
          }
        } catch (_) {
          // Fall through and try to send to this recipient.
        }
        filteredRecipients.push(recipient);
      }
      deliverableRecipients = filteredRecipients;
    }

    if (!deliverableRecipients.length) {
      return false;
    }

    const skipMxCheck = Boolean(mailOptions.skipMxCheck);

    // Verify the domain can receive email (has MX records) unless explicitly bypassed.
    if (!skipMxCheck) {
      const filteredRecipients = [];
      for (const recipient of deliverableRecipients) {
        const domainOk = await hasMxRecords(recipient);
        if (!domainOk) {
          console.warn(`[Email][${context}] Domain has no MX records for "${recipient}" — skipping.`);
          if (db) {
            suppressEmail(db, recipient, "no_mx_records", "Domain has no MX records").catch(() => {});
            await notifyEmailFailure(db, {
              recipient,
              reason: "no_mx_records",
              failureNotification: mailOptions.failureNotification,
            });
          }
          continue;
        }
        filteredRecipients.push(recipient);
      }
      deliverableRecipients = filteredRecipients;
    }

    if (!deliverableRecipients.length) {
      return false;
    }

    attemptedRecipients = deliverableRecipients;

    const transporter = getTransporter();

    // Build a friendly From header (“Managira <notify@…>”). Mail clients penalize
    // bare-address senders in their Promotions classifier.
    const fromAddress = user;
    const from = `"${MANAGIRA_FROM_NAME}" <${fromAddress}>`;

    // Strip smtpConfig if caller passed it (we ignore custom transporter configs)
    const {
      smtpConfig,
      from: _ignoredFrom,
      skipMxCheck: _skipMxCheck,
      failureNotification: _failureNotification,
      ...restOptions
    } = mailOptions;

    // Strip any caller-provided "managira_logo" inline attachment. The logo is
    // now rendered via a public HTTPS <img src> in renderCleanEmail, so adding
    // it as an inline attachment caused mail clients (Gmail/Outlook) to show
    // the logo as a downloadable file alongside the message — which we do not
    // want. Real file attachments (PDF reports, resumes, etc.) are kept.
    const mergedAttachments = (Array.isArray(restOptions.attachments) ? restOptions.attachments : [])
      .filter((item) => !(item && item.cid === 'managira_logo'));
    const envelope = buildEnvelopeConfig(restOptions.envelope, fromAddress, deliverableRecipients);

    // Provide a plain-text fallback whenever one wasn’t supplied. multipart/
    // alternative mail is a strong Primary-tab signal.
    const textBody = restOptions.text
      || (restOptions.html ? htmlToPlainText(restOptions.html) : "");

    const recipientHeader = formatRecipientList(deliverableRecipients);

    console.info(`[Email][${context}] sending via SMTP to ${recipientHeader}`);

    const messageIdDomain = (fromAddress.split('@')[1] || 'managira.com').trim();
    const messageId = `<managira-${Date.now()}-${Math.random().toString(36).slice(2, 10)}@${messageIdDomain}>`;

    const info = await transporter.sendMail({
      from,
      replyTo: restOptions.replyTo || fromAddress,
      ...restOptions,
      to: recipientHeader,
      text: textBody,
      attachments: mergedAttachments,
      envelope,
      messageId,
      headers: {
        // Standard transactional-mail headers. We deliberately do NOT set
        // X-Priority / Importance / Priority — those are spam/Promotions
        // signals on Gmail and Outlook even when the mail is legitimate.
        'X-Entity-Ref-ID': `managira-${Date.now()}`,
        'List-Unsubscribe': `<mailto:${fromAddress}?subject=unsubscribe>`,
        'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click',
        'X-Auto-Response-Suppress': 'All',
        'Auto-Submitted': 'auto-generated',
        ...restOptions.headers,
      },
    });

    const rejectedRecipients = toRecipientList(info?.rejected || []).validRecipients;
    if (rejectedRecipients.length > 0 && db) {
      for (const recipient of rejectedRecipients) {
        suppressEmail(
          db,
          recipient,
          "smtp_hard_bounce",
          info?.response || info?.messageId || "Recipient rejected"
        ).catch(() => {});
        await notifyEmailFailure(db, {
          recipient,
          reason: "smtp_hard_bounce",
          failureNotification: mailOptions.failureNotification,
        });
      }
    }

    const acceptedRecipients = toRecipientList(info?.accepted || []).validRecipients;
    const sendSucceeded = acceptedRecipients.length > 0 || rejectedRecipients.length === 0;

    console.info(`[Email][${context}] SMTP sent OK in ${Date.now() - sendStart}ms`, info.messageId);
    return sendSucceeded;
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
    // If this looks like a permanent recipient problem, add to the suppression
    // list so we never burn another SMTP attempt on it.
    if (isHardAddressFailure(error)) {
      const db = _getDb();
      if (db) {
        const recipientsToFlag = attemptedRecipients.length > 0
          ? attemptedRecipients
          : toRecipientList(mailOptions.to).validRecipients;
        for (const recipient of recipientsToFlag) {
          suppressEmail(
            db,
            recipient,
            "smtp_hard_bounce",
            error.response || error.message
          ).catch(() => {});
          await notifyEmailFailure(db, {
            recipient,
            reason: "smtp_hard_bounce",
            failureNotification: mailOptions.failureNotification,
          });
        }
      }
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
  return sendEmailSafely(mailOptions, context).catch((err) => {
    console.error(`[Email][${context}] Background send error:`, err.message);
    return false;
  });
}

module.exports = {
  buildFailureNotification,
  sendEmailSafely,
  sendEmailInBackground,
  renderCleanEmail,
  escapeHtml,
  recordEmailDeliveryFailure,
  isEmailSuppressed: (email) => {
    const db = _getDb();
    return db ? isEmailSuppressed(db, email) : Promise.resolve(false);
  },
  suppressEmail: (email, reason, lastError) => {
    const db = _getDb();
    return db ? suppressEmail(db, email, reason, lastError) : Promise.resolve();
  },
};
