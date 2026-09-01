const db = require("../config/db");
const { sendEmailSafely, renderCleanEmail } = require("./emailHelper");

const MAX_REMINDERS = 3;
const FIRST_REMINDER_DELAY_DAYS = 7;
const REMINDER_INTERVAL_DAYS = 5;

const BASE_URL = String(
  process.env.BASE_URL_PRODUCTION || process.env.BASE_URL || "https://managira.com"
).replace(/\/$/, "");

async function getManagerRecipients(organizationId, orgEmail) {
  const managers = await db.query(
    `SELECT email, first_name, last_name
     FROM users
     WHERE organization_id = $1
       AND account_type = 'Manager'
       AND email IS NOT NULL`,
    [organizationId]
  );

  if (managers.rows.length > 0) {
    return managers.rows.map((row) => ({
      email: row.email,
      name: [row.first_name, row.last_name].filter(Boolean).join(" ") || "Manager",
    }));
  }

  if (orgEmail) {
    return [{ email: orgEmail, name: "Manager" }];
  }

  return [];
}

async function sendOnHoldReminderEmail({ email, name, organizationName }) {
  const html = renderCleanEmail({
    title: "Your Account Is Still On Hold",
    greeting: `Dear <strong>${name}</strong>,`,
    paragraphs: [
      `Your organization (${organizationName}) is still on hold due to a payment issue.`,
      "Only a manager can log in to resolve this — teachers and other staff will not be able to access their accounts until it is fixed.",
      "Please log in and update your payment method or complete the outstanding payment to restore full access for your organization.",
    ],
    cta: {
      url: `${BASE_URL}/account/login`,
      text: "Log In to Resolve",
    },
  });

  return sendEmailSafely(
    {
      to: email,
      subject: "Managira: Your Account Is Still On Hold",
      html,
    },
    "OnHoldManagerReminder"
  );
}

async function runOnHoldManagerReminderSweep() {
  const summary = { orgsProcessed: 0, emailsSent: 0 };

  try {
    const dueResult = await db.query(
      `SELECT organization_id, organization_name, email, hold_reminder_count
       FROM organizations
       WHERE deleted = false
         AND on_hold = true
         AND on_hold_at IS NOT NULL
         AND hold_reminder_count < $1
         AND on_hold_at + ($2 || ' days')::interval
             + (hold_reminder_count * ($3 || ' days')::interval) <= NOW()`,
      [MAX_REMINDERS, FIRST_REMINDER_DELAY_DAYS, REMINDER_INTERVAL_DAYS]
    );

    for (const org of dueResult.rows) {
      const recipients = await getManagerRecipients(org.organization_id, org.email);

      let sentAny = false;
      for (const recipient of recipients) {
        try {
          await sendOnHoldReminderEmail({
            email: recipient.email,
            name: recipient.name,
            organizationName: org.organization_name,
          });
          sentAny = true;
          summary.emailsSent += 1;
        } catch (error) {
          console.error(
            `[On-Hold Manager Reminder] Failed to email ${recipient.email}:`,
            error.message
          );
        }
      }

      if (sentAny) {
        await db.query(
          `UPDATE organizations SET hold_reminder_count = hold_reminder_count + 1 WHERE organization_id = $1`,
          [org.organization_id]
        );
      }

      summary.orgsProcessed += 1;
    }
  } catch (error) {
    console.error("[On-Hold Manager Reminder] Sweep failed:", error.message);
  }

  return summary;
}

module.exports = { runOnHoldManagerReminderSweep };
