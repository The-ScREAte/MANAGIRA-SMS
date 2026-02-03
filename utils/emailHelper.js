const nodemailer = require("nodemailer");

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
};
