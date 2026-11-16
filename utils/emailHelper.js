const { BoundedMap } = require("./boundedMap");
const nodemailer = require("nodemailer");
const dns = require("dns");
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
const {
  renderModernEmail,
  htmlToPlainText,
  unsubscribeLine,
  UNSUBSCRIBE_SLOT,
} = require("./emailLayout");
const { unsubscribeUrl, SETTINGS_URL } = require("./emailLinks");


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
// Reminders and security codes come from their own address, an alias of the same mailbox.
// A caller asks for it with { sender: "reminders" }; nothing else changes about the send.
const REMINDERS_ADDRESS = String(process.env.REMINDERS_EMAIL || "reminders@managira.com").trim();
// Report cards, terminal reports, transcripts and saved reports come from reports@managira.com.
const SENDER_ADDRESSES = {
  reminders: REMINDERS_ADDRESS,
  reports: String(process.env.REPORTS_EMAIL || "reports@managira.com").trim(),
};
const senderAddress = (sender) => (SENDER_ADDRESSES[sender] && EMAIL_ADDRESS_PATTERN.test(SENDER_ADDRESSES[sender]) ? SENDER_ADDRESSES[sender] : null);
const EMAIL_ADDRESS_PATTERN = /^[^\s@]+@[^\s@]+\.[a-z]{2,}$/i;

// The plain-text part (htmlToPlainText, utils/emailLayout.js) goes with every email:
// Gmail/Outlook flag HTML-only mail as promotional more often than multipart/alternative mail.

// Cache verified domains to avoid repeated DNS lookups
const _domainCache = new BoundedMap(2000);

/**
 * Check if an email domain has valid MX records (can actually receive mail).
 * Results are cached for the lifetime of the process.
 */
async function hasMxRecords(email) {
  const domain = String(email).split("@")[1];
  if (!domain) return false;

  if (_domainCache.has(domain)) return _domainCache.get(domain);

  try {
    // The DNS resolver has no hard cap of its own — a slow/unreachable
    // resolver can otherwise stall a send for tens of seconds per
    // recipient domain. Fail open (allow the send attempt) on timeout,
    // same as the transient-error path below, rather than blocking.
    const records = await Promise.race([
      dns.promises.resolveMx(domain),
      new Promise((_, reject) => setTimeout(() => reject(Object.assign(new Error("MX lookup timed out"), { code: "ETIMEOUT" })), 4000)),
    ]);
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

  // Build fan-out notification payload: it goes to the person whose own address failed, so it
  // points them to their own profile (a driver's is on the driver app).
  const title = 'Incorrect Email Detected';
  const safeEmail = String(email || '').slice(0, 120);
  const reasonText = getFailureReasonText(reason);
  const body = `We couldn't deliver email to "${safeEmail}". ${reasonText} Check the address in your profile.`;
  let link = '/account/settings';
  if (userType === 'staff') {
    const role = await db.query('SELECT account_type::text AS role FROM users WHERE user_id = $1', [userId]).then((r) => r.rows[0]?.role).catch(() => null);
    if (role === 'Driver') link = '/driver/settings';
  }
  const dedupeHours = 12;

  // Only the member of staff whose own address failed is told here. Managers and
  // supervisors already get the failure itself, with what the email was for
  // (utils/notificationAudience.js decides who else sees it).
  const recipientRows = [];
  if (userType === 'staff') {
    recipientRows.push({ recipientType: 'staff', recipientId: userId });
  }

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

// The new look (utils/emailLayout.js) goes where `email_refresh` is released; everyone else
// gets the classic one below (delete it once the feature is released to everyone). Pass
// `organizationId` (or `hubId`) for a school's or hub's email; Managira's own emails get the
// new look only once it is released to everyone. EMAIL_LOOK=modern|classic forces one locally.
function modernLook({ organizationId = null, hubId = null } = {}) {
  const forced = String(process.env.EMAIL_LOOK || "").trim().toLowerCase();
  if (forced === "modern") return true;
  if (forced === "classic") return false;
  try {
    return require("./shards/features").isOn("email_refresh", { organizationId, hubId });
  } catch (_) {
    return false;
  }
}

function renderCleanEmail(options = {}) {
  return modernLook(options) ? renderModernEmail(options) : renderClassicEmail(options);
}

function renderClassicEmail({
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
  noReply = false,
  showLink = false,
  signoff = "",
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
       </div>${showLink ? `<p style="margin:0 0 12px;font-size:13px;color:#475569;">If the button doesn't work, copy this link into your browser:<br><a href="${normalizedCta.url}" style="color:#0f766e;word-break:break-all;">${escapeHtml(normalizedCta.url)}</a></p>` : ""}`
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
          ${signoff ? `<p style="margin:16px 0 0;font-size:15px;color:#1f2937;">${escapeHtml(signoff).replace(/\n/g, "<br>")}</p>` : ""}
          ${schoolWebsiteHtml}
          ${noReply ? `<p style="margin:18px 0 0;font-size:12px;color:#64748b;">This is an automated message from Managira.</p>` : ""}
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
function resolveEnvelopeFrom(fromAddress) {
  const envelopeFrom = firstNonEmpty(
    process.env.EMAIL_BOUNCE_ADDRESS,
    process.env.SMTP_ENVELOPE_FROM,
    process.env.MAIL_ENVELOPE_FROM,
    process.env.EMAIL_RETURN_PATH,
    fromAddress
  );

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

// The school an email speaks for (`onBehalfOf`): its name goes in the From line ("Lincoln
// High via Managira") and replies reach the school's own address. Read once a minute.
const _schoolSenders = new BoundedMap(500);
async function schoolSender(db, organizationId) {
  const orgId = Number.parseInt(organizationId, 10);
  if (!db || !Number.isInteger(orgId) || orgId <= 0 || !modernLook({ organizationId: orgId })) return null;
  const cached = _schoolSenders.get(orgId);
  if (cached && cached.at > Date.now() - 60000) return cached.value;
  let value = null;
  try {
    const { rows } = await db.query(
      "SELECT organization_name, email FROM organizations WHERE organization_id = $1",
      [orgId]
    );
    if (rows[0]) {
      const name = String(rows[0].organization_name || "").replace(/[\r\n"<>]+/g, " ").replace(/\s+/g, " ").trim().slice(0, 80);
      const email = String(rows[0].email || "").trim().toLowerCase();
      value = { name, replyTo: EMAIL_ADDRESS_PATTERN.test(email) ? email : null };
    }
  } catch (_) {
    value = null;
  }
  _schoolSenders.set(orgId, { at: Date.now(), value });
  return value;
}

// An optional email's kind (a key from utils/emailPreferences.js), with its label.
function emailCategory(key) {
  if (!key) return null;
  try {
    return require("./emailPreferences").categoryOf(key);
  } catch (_) {
    return null;
  }
}

// Who on this list turned this kind of email off. Every choice (an unsubscribe link or a
// settings page) is kept in email_opt_outs, so this is one indexed read for the whole list.
async function optedOutOf(db, recipients, category) {
  if (!db || !category || !recipients.length) return new Set();
  try {
    const { rows } = await db.query(
      "SELECT email FROM email_opt_outs WHERE category = $1 AND email = ANY($2::text[])",
      [category.key, recipients]
    );
    return new Set(rows.map((row) => row.email));
  } catch (_) {
    return new Set(); // email_opt_outs not made yet
  }
}

/**
 * Safely send email with proper error handling.
 * Always uses ADMIN_NOTIFY_EMAIL_USER as the from address (ignores caller's from).
 *
 * Each recipient gets a message of their own, so nobody sees anyone else's address.
 * - `category`: an optional email's kind (a key in utils/emailPreferences.js). Anyone who
 *   turned it off is skipped, and each message carries a one-click unsubscribe (header and
 *   footer). Leave it out for security codes, passwords, receipts and account notices.
 * - `onBehalfOf`: the school the email speaks for (its organization id): its name in the
 *   From line and replies to its address, where the new email look is released.
 * - `sender`: "reminders" or "reports" for those addresses; `senderName` overrides the name.
 */
async function sendEmailSafely(mailOptions, context = "Email") {
  const sendStart = Date.now();
  try {
    const { user, pass } = resolveSmtpConfig();
    const outbox = process.env.EMAIL_TEST_OUTBOX && process.env.RENDER === undefined;

    if (!outbox && (!user || !pass)) {
      console.warn(`[Email][${context}] SMTP credentials not configured — skipping.`);
      return false;
    }

    const db = _getDb();
    const { validRecipients, invalidRecipients } = toRecipientList(mailOptions.to);

    if (invalidRecipients.length > 0) {
      console.warn(`[Email][${context}] Invalid recipient address(es) "${formatRecipientList(invalidRecipients)}" — skipping those recipients.`);
      if (db && !outbox) {
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

    // People who turned this kind of email off are skipped quietly. A caller that already
    // filtered its whole list (filterEmailsByPreference) passes optOutChecked. A caller that
    // must know (a send history) checks first; for everyone else this isn't a failure.
    const category = emailCategory(mailOptions.category);
    const unsubscribed = category && !mailOptions.optOutChecked ? await optedOutOf(db, validRecipients, category) : new Set();
    let deliverableRecipients = validRecipients.filter((recipient) => !unsubscribed.has(recipient));
    if (!deliverableRecipients.length) {
      return true;
    }

    // Skip recipients that have previously failed permanently.
    if (db && !outbox) {
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

    // Verify the domain can receive email (has MX records) unless explicitly bypassed.
    if (!mailOptions.skipMxCheck && !outbox) {
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

    const school = mailOptions.onBehalfOf ? await schoolSender(db, mailOptions.onBehalfOf) : null;
    const fromAddress = senderAddress(mailOptions.sender) || user || "info@managira.com";
    const fromName = String(mailOptions.senderName || (school?.name ? `${school.name} via Managira` : MANAGIRA_FROM_NAME))
      .replace(/[\r\n"]+/g, " ")
      .trim();
    const from = { name: fromName, address: fromAddress };

    // Strip options that only steer this function (and any custom transporter config).
    const {
      smtpConfig: _smtpConfig,
      from: _ignoredFrom,
      skipMxCheck: _skipMxCheck,
      failureNotification: _failureNotification,
      sender: _sender,
      senderName: _senderName,
      category: _category,
      optOutChecked: _optOutChecked,
      onBehalfOf: _onBehalfOf,
      to: _to,
      ...restOptions
    } = mailOptions;

    // The logo is a public HTTPS <img src>; an inline "managira_logo" attachment only made
    // mail clients show it as a file. Real attachments (PDF reports, resumes) are kept.
    const mergedAttachments = (Array.isArray(restOptions.attachments) ? restOptions.attachments : [])
      .filter((item) => !(item && item.cid === "managira_logo"));
    const replyTo = restOptions.replyTo || school?.replyTo || undefined;
    const messageIdDomain = (fromAddress.split("@")[1] || "managira.com").trim();
    const { withShardLinks } = require("./shards/routing");

    const messageFor = (recipient) => {
      let html = restOptions.html || "";
      let text = restOptions.text || "";
      const headers = {
        // Standard transactional-mail headers. We deliberately do NOT set X-Priority /
        // Importance / Priority: those are spam/Promotions signals on Gmail and Outlook.
        "X-Entity-Ref-ID": `managira-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        "X-Auto-Response-Suppress": "All",
        "Auto-Submitted": "auto-generated",
      };
      // Only optional emails offer an unsubscribe, and it really works (RFC 8058 one-click).
      const link = category ? unsubscribeUrl(recipient, category.key) : null;
      if (link) {
        // withShardLinks (here, and on the body below): the one-click POST reaches this school's shard.
        headers["List-Unsubscribe"] = `<${withShardLinks(link)}>`;
        headers["List-Unsubscribe-Post"] = "List-Unsubscribe=One-Click";
        if (html.includes(UNSUBSCRIBE_SLOT)) {
          html = html.replace(UNSUBSCRIBE_SLOT, unsubscribeLine({ url: link, settingsUrl: SETTINGS_URL, label: category.label }));
        }
        if (text) text = `${text}\n\nUnsubscribe: ${link}`;
      }
      if (!text && html) text = htmlToPlainText(html);
      return {
        ...restOptions,
        from,
        ...(replyTo ? { replyTo } : {}),
        to: recipient,
        ...(html ? { html: withShardLinks(html) } : {}),
        text: withShardLinks(text),
        attachments: mergedAttachments,
        envelope: buildEnvelopeConfig(restOptions.envelope, user || fromAddress, [recipient]),
        messageId: `<managira-${Date.now()}-${Math.random().toString(36).slice(2, 10)}@${messageIdDomain}>`,
        headers: { ...headers, ...(restOptions.headers || {}) },
      };
    };

    // The local test copy writes emails to a file instead of sending them. Never on the real site.
    if (outbox) {
      for (const recipient of deliverableRecipients) {
        const message = messageFor(recipient);
        require("fs").appendFileSync(process.env.EMAIL_TEST_OUTBOX, JSON.stringify({
          at: new Date().toISOString(), context, from: `"${from.name}" <${from.address}>`, replyTo: message.replyTo || null,
          to: recipient, subject: message.subject, category: category?.key || null, headers: message.headers,
          html: message.html, text: message.text,
        }) + "\n");
      }
      return true;
    }

    let anyAccepted = false;
    for (const recipient of deliverableRecipients) {
      try {
        const info = await getTransporter().sendMail(messageFor(recipient));

        // sendMail() already succeeded: the message is on its way. Bookkeeping below must
        // never flip an actually-sent message to "failed".
        try {
          const rejected = toRecipientList(info?.rejected || []).validRecipients;
          if (rejected.length > 0 && db) {
            for (const address of rejected) {
              suppressEmail(db, address, "smtp_hard_bounce", info?.response || info?.messageId || "Recipient rejected").catch(() => {});
              await notifyEmailFailure(db, {
                recipient: address,
                reason: "smtp_hard_bounce",
                failureNotification: mailOptions.failureNotification,
              });
            }
          }
          const accepted = toRecipientList(info?.accepted || []).validRecipients;
          if (accepted.length > 0 || rejected.length === 0) anyAccepted = true;
        } catch (bookkeepingError) {
          console.error(`[Email][${context}] Post-send bookkeeping failed (message was already sent):`, bookkeepingError);
          anyAccepted = true;
        }
      } catch (error) {
        _transporter = null;
        _transporterConfig = null;
        console.error(`[Email][${context}] SMTP FAILED after ${Date.now() - sendStart}ms:`, error.message);
        if (error.code === "EAUTH") {
          console.error(`[Email][${context}] Authentication failed — check ADMIN_NOTIFY_EMAIL_*, NOTIFY_EMAIL_*, EMAIL_* or SMTP_* credentials.`);
        } else if (error.code === "ECONNECTION" || error.code === "ETIMEDOUT" || error.code === "ESOCKET") {
          const smtp = resolveSmtpConfig();
          console.error(`[Email][${context}] SMTP connection failed — SMTP_HOST=${smtp.host} SMTP_PORT=${smtp.port}`);
        }
        // A permanent recipient problem goes on the suppression list, so we never burn
        // another SMTP attempt on it.
        if (isHardAddressFailure(error) && db) {
          suppressEmail(db, recipient, "smtp_hard_bounce", error.response || error.message).catch(() => {});
          await notifyEmailFailure(db, {
            recipient,
            reason: "smtp_hard_bounce",
            failureNotification: mailOptions.failureNotification,
          });
        }
        // The server or our login is down: the others would fail the same way.
        if (["EAUTH", "ECONNECTION", "ETIMEDOUT", "ESOCKET"].includes(error.code)) break;
      }
    }
    return anyAccepted;
  } catch (error) {
    console.error(`[Email][${context}] Send failed after ${Date.now() - sendStart}ms:`, error.message);
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
  modernLook,
  htmlToPlainText,
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
