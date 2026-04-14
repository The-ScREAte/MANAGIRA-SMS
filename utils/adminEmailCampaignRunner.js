const db = require("../config/db");
const { sendEmailSafely } = require("./emailHelper");
const {
  ensureAdminEmailCampaignSchema,
  computeNextRunAfterSend,
  buildCampaignEmailHtml,
  buildCampaignEmailText,
  parseEmailList,
} = require("./adminEmailCampaigns");

async function runAdminEmailCampaignSweep() {
  await ensureAdminEmailCampaignSchema(db);

  const result = await db.query(
    `SELECT *
     FROM admin_email_campaigns
     WHERE is_active = TRUE
       AND next_run_at IS NOT NULL
       AND next_run_at <= NOW()
     ORDER BY next_run_at ASC
     LIMIT 20`
  );

  const campaigns = result.rows;
  let processed = 0;
  let sent = 0;
  let failed = 0;

  for (const campaign of campaigns) {
    const summary = await processCampaign(campaign);
    processed += 1;
    sent += summary.sent;
    failed += summary.failed;
  }

  return {
    processed,
    sent,
    failed,
  };
}

async function processCampaign(campaign) {
  const claimed = await db.query(
    `UPDATE admin_email_campaigns
     SET next_run_at = NULL
     WHERE id = $1
       AND is_active = TRUE
       AND (next_run_at = $2 OR (next_run_at IS NULL AND $2 IS NULL))
     RETURNING *`,
    [campaign.id, campaign.next_run_at]
  );

  const current = claimed.rows[0];
  if (!current) {
    return { sent: 0, failed: 0 };
  }

  const recipients = await resolveRecipients(current);
  const sentAt = new Date();
  const html = buildCampaignEmailHtml(current.subject, current.content);
  const text = buildCampaignEmailText(current.content);

  if (recipients.length === 0) {
    await db.query(
      `UPDATE admin_email_campaigns
       SET last_error = $1,
           next_run_at = $2,
           is_active = CASE WHEN frequency = 'once' THEN FALSE ELSE is_active END
       WHERE id = $3`,
      [
        "No valid recipient emails were available for this scheduled email.",
        computeNextRunAfterSend(mapCampaignSchedule(current), sentAt),
        current.id,
      ]
    );
    return { sent: 0, failed: 1 };
  }

  let sentCount = 0;
  let failedCount = 0;

  for (const recipient of recipients) {
    const ok = await sendEmailSafely(
      {
        to: recipient,
        subject: current.subject,
        html,
        text,
      },
      `Admin Scheduled Email #${current.id}`
    );

    if (ok) {
      sentCount += 1;
    } else {
      failedCount += 1;
    }
  }

  const nextRunAt = computeNextRunAfterSend(mapCampaignSchedule(current), sentAt);
  const shouldRemainActive = current.frequency !== "once" && current.is_active;
  const errorMessage = failedCount > 0 ? `${failedCount} recipient(s) failed during the last send.` : null;

  await db.query(
    `UPDATE admin_email_campaigns
     SET last_sent_at = $1,
         next_run_at = $2,
         is_active = $3,
         last_error = $4
     WHERE id = $5`,
    [sentAt, nextRunAt, shouldRemainActive, errorMessage, current.id]
  );

  return { sent: sentCount, failed: failedCount };
}

async function resolveRecipients(campaign) {
  const manualRecipients = parseEmailList(campaign.manual_emails);
  const targetUserIds = Array.isArray(campaign.target_user_ids)
    ? campaign.target_user_ids.map((value) => Number(value)).filter((value) => Number.isInteger(value) && value > 0)
    : [];

  const recipientSet = new Set(manualRecipients);

  if (targetUserIds.length > 0) {
    const result = await db.query(
      `SELECT email
       FROM users
       WHERE user_id = ANY($1::int[])
         AND email IS NOT NULL`,
      [targetUserIds]
    );

    for (const row of result.rows) {
      const email = String(row.email || "").trim().toLowerCase();
      if (email) {
        recipientSet.add(email);
      }
    }
  }

  return Array.from(recipientSet);
}

function mapCampaignSchedule(campaign) {
  return {
    frequency: campaign.frequency,
    sendTime: campaign.send_time,
    dayOfWeek: campaign.day_of_week,
    dayOfMonth: campaign.day_of_month,
    startDate: campaign.start_date,
    endDate: campaign.end_date,
  };
}

module.exports = {
  runAdminEmailCampaignSweep,
};