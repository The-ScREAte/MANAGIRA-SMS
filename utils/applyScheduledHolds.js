const db = require("../config/db");
const { sendEmailSafely, renderCleanEmail, escapeHtml } = require("./emailHelper");
const HUB_CONTRACT_HOLD_BY = "SystemHubContract";
const BASE_URL = String(process.env.BASE_URL_PRODUCTION || process.env.BASE_URL || "https://managira.com").replace(/\/$/, "");

async function enforceHubContractAccess() {
  const hubColumnResult = await db.query(
    `SELECT column_name
     FROM information_schema.columns
     WHERE table_schema = 'public'
       AND table_name = 'managira_hubs'
       AND column_name = ANY($1::text[])`,
    [["contract_start_date", "contract_end_date"]]
  );
  const availableColumns = new Set(hubColumnResult.rows.map((row) => row.column_name));
  const hasContractStartDate = availableColumns.has("contract_start_date");
  const hasContractEndDate = availableColumns.has("contract_end_date");

  const holdContractChecks = [];
  const resumeContractChecks = [];

  if (hasContractStartDate) {
    holdContractChecks.push("(h.contract_start_date IS NOT NULL AND h.contract_start_date > CURRENT_DATE)");
    resumeContractChecks.push("(h.contract_start_date IS NULL OR h.contract_start_date <= CURRENT_DATE)");
  }

  if (hasContractEndDate) {
    holdContractChecks.push("(h.contract_end_date IS NOT NULL AND h.contract_end_date < CURRENT_DATE)");
    resumeContractChecks.push("(h.contract_end_date IS NULL OR h.contract_end_date >= CURRENT_DATE)");
  }

  const holdContractClause = holdContractChecks.length ? ` OR ${holdContractChecks.join(" OR ")}` : "";
  const resumeContractClause = resumeContractChecks.length ? ` AND ${resumeContractChecks.join(" AND ")}` : "";

  const dueForHoldResult = await db.query(
    `SELECT o.organization_id, o.organization_name, o.email, o.first_name, h.hub_name, h.hub_email
     FROM organizations o
     JOIN managira_hubs h ON h.hub_id = o.hub_id
     WHERE o.deleted = false
       AND o.is_hub_member = true
       AND o.hub_id IS NOT NULL
       AND o.on_hold = false
       AND (
         h.deleted = true
         OR h.on_hold = true
         ${holdContractClause}
       )`
  );

  for (const org of dueForHoldResult.rows) {
    await db.query(
      `UPDATE organizations
       SET on_hold = true,
           hold_by = $2,
           scheduled_hold_date = NULL,
           on_hold_at = NOW(),
           hold_reminder_count = 0
       WHERE organization_id = $1`,
      [org.organization_id, HUB_CONTRACT_HOLD_BY]
    );

    await sendHoldNotificationEmail(org.email, org.organization_name, {
      organizationId: org.organization_id,
      firstName: org.first_name,
      hub: { name: org.hub_name, email: org.hub_email },
    });
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
       ${resumeContractClause}`,
    [HUB_CONTRACT_HOLD_BY]
  );

  for (const org of dueForResumeResult.rows) {
    await db.query(
      `UPDATE organizations
       SET on_hold = false,
           hold_by = NULL,
           on_hold_at = NULL,
           hold_reminder_count = 0
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
      `SELECT organization_id, organization_name, email, first_name, scheduled_hold_date
       FROM organizations
       WHERE scheduled_hold_date IS NOT NULL 
       AND scheduled_hold_date <= CURRENT_DATE
       AND on_hold = false`
    );

    if (result.rows.length === 0) {
      return;
    }

    for (const org of result.rows) {
      const { organization_id, organization_name, email, first_name } = org;

      // ✅ 2️⃣ Place the organization on hold
      await db.query(
        `UPDATE organizations 
         SET on_hold = true, hold_by = 'System', scheduled_hold_date = NULL 
         WHERE organization_id = $1`,
        [organization_id]
      );


      // ✅ 3️⃣ Send an email notification
      await sendHoldNotificationEmail(email, organization_name, { organizationId: organization_id, firstName: first_name });
    }

  } catch (error) {
    console.error("❌ Error applying scheduled holds:", error);
  }
}

/**
 * Send an email notification to the organization when their account is placed on hold:
 * its subscription ended, or (`hub`) its hub's Managira plan isn't active.
 */
async function sendHoldNotificationEmail(toEmail, orgName, { organizationId = null, firstName = "", hub = null } = {}) {
  const school = escapeHtml(orgName || "Your school");
  const hubName = hub && hub.name ? escapeHtml(hub.name) : "your hub";
  const html = renderCleanEmail({
    organizationId,
    title: "Your school's account is on hold",
    greeting: String(firstName || "").trim() ? `Hi ${escapeHtml(String(firstName).trim())},` : "Hello,",
    paragraphs: hub
      ? [
          `${school}'s Managira account is on hold because ${hubName}'s plan with Managira isn't active right now. Your school's data is safe, and managers can still sign in.`,
          `${hubName === "your hub" ? "Your hub" : hubName} takes care of your plan, so please contact ${hub.email ? `them at ${escapeHtml(hub.email)}` : "them"} to turn the account back on.`,
        ]
      : [
          `${school}'s Managira subscription has ended, so the account is now on hold. Your school's data is safe.`,
          "To turn it back on, a manager can sign in and choose a plan in Settings › Billing & Plan. Until then, other staff, parents and students can't sign in.",
        ],
    ...(hub ? {} : { cta: { text: "Sign in to Managira", url: `${BASE_URL}/account/login` } }),
  });

  const mailOptions = {
    to: toEmail,
    subject: `${orgName || "Your school"}'s Managira account is on hold`.replace(/\s*[\r\n]+\s*/g, " "),
    html,
  };

  try {
    await sendEmailSafely(mailOptions, "Scheduled Hold Notification Email");
  } catch (error) {
    console.error("❌ Error sending hold notification email:", error);
  }
}

module.exports = applyScheduledHolds;
