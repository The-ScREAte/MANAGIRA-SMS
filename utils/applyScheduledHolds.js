const db = require("../config/db");
const path = require("path");
const { sendEmailSafely, renderCleanEmail } = require("./emailHelper");
const HUB_CONTRACT_HOLD_BY = "SystemHubContract";

async function enforceHubContractAccess() {
  const dueForHoldResult = await db.query(
    `SELECT o.organization_id, o.organization_name, o.email
     FROM organizations o
     JOIN managira_hubs h ON h.hub_id = o.hub_id
     WHERE o.deleted = false
       AND o.is_hub_member = true
       AND o.hub_id IS NOT NULL
       AND o.on_hold = false
       AND (
         h.deleted = true
         OR h.on_hold = true
         OR (h.contract_start_date IS NOT NULL AND h.contract_start_date > CURRENT_DATE)
         OR (h.contract_end_date IS NOT NULL AND h.contract_end_date < CURRENT_DATE)
       )`
  );

  for (const org of dueForHoldResult.rows) {
    await db.query(
      `UPDATE organizations
       SET on_hold = true,
           hold_by = $2,
           scheduled_hold_date = NULL
       WHERE organization_id = $1`,
      [org.organization_id, HUB_CONTRACT_HOLD_BY]
    );

    await sendHoldNotificationEmail(
      org.email,
      org.organization_name,
      "Your hub contract period is not currently active."
    );
  }

  const dueForResumeResult = await db.query(
    `SELECT o.organization_id
     FROM organizations o
     JOIN managira_hubs h ON h.hub_id = o.hub_id
     WHERE o.deleted = false
       AND o.is_hub_member = true
       AND o.hub_id IS NOT NULL
       AND o.on_hold = true
       AND o.hold_by = $1
       AND h.deleted = false
       AND h.on_hold = false
       AND (h.contract_start_date IS NULL OR h.contract_start_date <= CURRENT_DATE)
       AND (h.contract_end_date IS NULL OR h.contract_end_date >= CURRENT_DATE)`,
    [HUB_CONTRACT_HOLD_BY]
  );

  for (const org of dueForResumeResult.rows) {
    await db.query(
      `UPDATE organizations
       SET on_hold = false,
           hold_by = NULL
       WHERE organization_id = $1`,
      [org.organization_id]
    );
  }
}

/**
 * Apply scheduled holds for organizations whose billing cycle has ended.
 */
async function applyScheduledHolds() {
  try {
    await enforceHubContractAccess();

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
async function sendHoldNotificationEmail(toEmail, orgName, customReason = null) {
  const html = renderCleanEmail({
    title: "Organization Account Placed on Hold",
    greeting: `Dear <strong>${orgName} Admin</strong>,`,
    paragraphs: [
      customReason || "Your organization's subscription has ended, and your account has now been placed on hold.",
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
