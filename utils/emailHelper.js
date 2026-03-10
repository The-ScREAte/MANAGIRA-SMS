const nodemailer = require("nodemailer");

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
          <img src="cid:managira_logo" alt="Managira" style="height:40px;display:block;">
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

/**
 * Safely send email with proper error handling
 * @param {Object} mailOptions - Email options (to, subject, text, html, attachments, etc.)
 * @param {string} context - Context description for logging
 * @returns {Promise<boolean>} - Returns true if email sent successfully, false otherwise
 */
async function sendEmailSafely(mailOptions, context = "Email") {
  const sendStart = Date.now();
  try {
    // Check if email credentials are configured
    if (!process.env.ADMIN_NOTIFY_EMAIL_USER || !process.env.ADMIN_NOTIFY_EMAIL_PASSWORD) {
      console.warn(`[Email][${context}] SMTP credentials not configured — skipping send.`);
      return false;
    }

    // NOTE: transporter is created per-call intentionally (env vars may change at runtime),
    // but we do NOT call transporter.verify() — it opens a full SMTP handshake and can
    // stall for 10-30 s on a slow server. We rely on sendMail() to fail fast instead.
    const transporter = nodemailer.createTransport({
      host: process.env.SMTP_HOST,
      port: parseInt(process.env.SMTP_PORT),
      secure: process.env.SMTP_SECURE === "true",
      auth: {
        user: process.env.ADMIN_NOTIFY_EMAIL_USER,
        pass: process.env.ADMIN_NOTIFY_EMAIL_PASSWORD,
      },
      // Hard cap: give up after 15 s so the event loop is never blocked indefinitely
      connectionTimeout: 15000,
      greetingTimeout: 10000,
      socketTimeout: 15000,
    });

    console.info(`[Email][${context}] sending to ${mailOptions.to}`);

    // Send email
    const info = await transporter.sendMail({
      from: process.env.ADMIN_NOTIFY_EMAIL_USER,
      ...mailOptions,
    });

    console.info(`[Email][${context}] sent OK in ${Date.now() - sendStart}ms`, info.messageId);
    return true;
  } catch (error) {
    console.error(`[Email][${context}] FAILED after ${Date.now() - sendStart}ms:`, error.message);
    if (error.code === 'EAUTH') {
      console.error(`[Email][${context}] Authentication failed — check SMTP credentials.`);
    } else if (error.code === 'ECONNECTION' || error.code === 'ETIMEDOUT') {
      console.error(`[Email][${context}] SMTP connection failed/timed out — check SMTP_HOST/PORT.`);
    }
    return false;
  }
}

module.exports = {
  sendEmailSafely,
  renderCleanEmail,
  escapeHtml,
};
