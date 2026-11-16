const db = require("../config/db");
const { sendEmailSafely, renderCleanEmail, escapeHtml } = require("./emailHelper");

// A school put on hold because its payments didn't go through hears about it twice at most:
// a week after the hold, then two weeks later. Only its managers who can still sign in are
// told (they can reach Billing & Plan while the school is on hold). A school in a hub is left
// out: its hub pays, and applyScheduledHolds already told it to contact the hub.
const MAX_REMINDERS = 2;
const FIRST_REMINDER_DELAY_DAYS = 7;
const REMINDER_INTERVAL_DAYS = 14;

const BASE_URL = String(
  process.env.BASE_URL_PRODUCTION || process.env.BASE_URL || "https://managira.com"
).replace(/\/$/, "");

async function getManagerRecipients(organizationId, orgEmail) {
  const managers = await db.query(
    `SELECT email, first_name, last_name
     FROM users
     WHERE organization_id = $1
       AND account_type = 'Manager'
       AND NOT COALESCE(on_hold, FALSE)
       AND email IS NOT NULL`,
    [organizationId]
  );

  if (managers.rows.length > 0) {
    return managers.rows.map((row) => ({
      email: row.email,
      firstName: row.first_name || "",
    }));
  }

  if (orgEmail) {
    return [{ email: orgEmail, firstName: "" }];
  }

  return [];
}

async function sendOnHoldReminderEmail({ email, firstName, organizationId, organizationName, onHoldAt }) {
  const school = escapeHtml(organizationName || "Your school");
  const since = onHoldAt && !Number.isNaN(new Date(onHoldAt).getTime())
    ? ` since ${new Date(onHoldAt).toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" })},`
    : "";
  const html = renderCleanEmail({
    organizationId,
    title: "Your school's account is still on hold",
    greeting: String(firstName || "").trim() ? `Hi ${escapeHtml(String(firstName).trim())},` : "Hello,",
    paragraphs: [
      `${school}'s Managira account has been on hold${since} because a payment didn't go through.`,
      "A manager can sign in to update the card or make the payment in Settings › Billing & Plan. Everyone else can sign in again as soon as it's done.",
    ],
    cta: {
      url: `${BASE_URL}/account/login`,
      text: "Sign in to Managira",
    },
    note: 'Questions? Write to <a href="mailto:support@managira.com">support@managira.com</a>.',
  });

  return sendEmailSafely(
    {
      to: email,
      subject: `Reminder: ${organizationName || "your school"}'s Managira account is on hold`.replace(/\s*[\r\n]+\s*/g, " "),
      sender: "reminders",
      html,
    },
    "OnHoldManagerReminder"
  );
}

async function runOnHoldManagerReminderSweep() {
  const summary = { orgsProcessed: 0, emailsSent: 0 };

  try {
    const dueResult = await db.query(
      `SELECT organization_id, organization_name, email, hold_reminder_count, on_hold_at
       FROM organizations
       WHERE deleted = false
         AND on_hold = true
         AND on_hold_at IS NOT NULL
         AND COALESCE(hold_by, '') <> 'SystemHubContract'
         AND NOT (COALESCE(is_hub_member, false) = true AND hub_id IS NOT NULL)
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
            firstName: recipient.firstName,
            organizationId: org.organization_id,
            organizationName: org.organization_name,
            onHoldAt: org.on_hold_at,
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
