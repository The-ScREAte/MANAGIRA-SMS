const db = require("../config/db");
const path = require("path");
const { sendEmailSafely, renderCleanEmail } = require("./emailHelper");

/**
 * Apply scheduled holds for organizations whose billing cycle has ended.
 */
async function applyScheduledHolds() {
  try {

    // ✅ 1️⃣ Find organizations that have a scheduled hold date and are NOT already on hold.
    const result = await db.query(
      `SELECT organization_id, organization_name, email, scheduled_hold_date
       FROM organizations
       WHERE scheduled_hold_date IS NOT NULL 
       AND scheduled_hold_date <= CURRENT_DATE
       AND on_hold = false`
    );

    if (result.rows.length === 0) {
      return;
    }

    for (const org of result.rows) {
      const { organization_id, organization_name, email, scheduled_hold_date } = org;

      // ✅ 2️⃣ Place the organization on hold
      await db.query(
        `UPDATE organizations 
         SET on_hold = true, hold_by = 'System', scheduled_hold_date = NULL 
         WHERE organization_id = $1`,
        [organization_id]
      );


      // ✅ 3️⃣ Send an email notification
      await sendHoldNotificationEmail(email, organization_name);
    }

  } catch (error) {
    console.error("❌ Error applying scheduled holds:", error);
  }
}

/**
 * Send an email notification to the organization when their account is placed on hold.
 */
async function sendHoldNotificationEmail(toEmail, orgName) {
  const html = renderCleanEmail({
    title: "Organization Account Placed on Hold",
    greeting: `Dear <strong>${orgName} Admin</strong>,`,
    paragraphs: [
      "Your organization's subscription has ended, and your account has now been placed on hold.",
      "Users will no longer be able to log in until the subscription is resumed.",
      "To reactivate your account, log in and update your payment details.",
    ],
  });

  const mailOptions = {
    from: process.env.ADMIN_NOTIFY_EMAIL_USER,
    to: toEmail,
    subject: `Your Organization (${orgName}) Has Been Placed on Hold`,
    html,
    attachments: [
      {
        filename: "managira.png",
        path: path.join(__dirname, "../public/images/managira.png"),
        cid: "managira_logo",
      },
    ],
  };

  try {
    await sendEmailSafely(mailOptions, "Scheduled Hold Notification Email");
  } catch (error) {
    console.error("❌ Error sending hold notification email:", error);
  }
}

module.exports = applyScheduledHolds;
