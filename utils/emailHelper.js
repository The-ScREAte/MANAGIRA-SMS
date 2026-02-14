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
  try {
    // Check if email credentials are configured
    if (!process.env.ADMIN_NOTIFY_EMAIL_USER || !process.env.ADMIN_NOTIFY_EMAIL_PASSWORD) {
  // ...removed log for clean background operation...
      return false;
    }

    const transporter = nodemailer.createTransport({
      host: process.env.SMTP_HOST,
      port: parseInt(process.env.SMTP_PORT),
      secure: process.env.SMTP_SECURE === "true",
      auth: {
        user: process.env.ADMIN_NOTIFY_EMAIL_USER,
        pass: process.env.ADMIN_NOTIFY_EMAIL_PASSWORD,
      },
    });

    // Verify connection configuration
    await transporter.verify();

    // Send email
    const info = await transporter.sendMail({
      from: process.env.ADMIN_NOTIFY_EMAIL_USER,
      ...mailOptions,
    });

  // ...removed log for clean background operation...
    return true;
  } catch (error) {
    console.error(`${context}: Failed to send email:`, error.message);
    
    // Don't throw the error, just log it and return false
    // This prevents email errors from crashing the application
    if (error.code === 'EAUTH') {
  console.error(`${context}: Email authentication failed. Please check your SMTP credentials and settings.`);
    } else if (error.code === 'ECONNECTION') {
      console.error(`${context}: Email connection failed. Please check your SMTP settings.`);
    }
    
    return false;
  }
}

module.exports = {
  sendEmailSafely,
  renderCleanEmail,
  escapeHtml,
};
