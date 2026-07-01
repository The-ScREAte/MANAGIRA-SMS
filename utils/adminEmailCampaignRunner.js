const db = require("../config/db");
const { sendEmailSafely } = require("./emailHelper");
const {
  ensureAdminEmailCampaignSchema,
  computeNextRunAfterSend,
  computeNextRunAt,
  buildCampaignEmailHtml,
  buildCampaignEmailText,
  parseEmailList,
} = require("./adminEmailCampaigns");

const ADMIN_EMAIL_SWEEP_LOCK_KEY = 886431;
const CAMPAIGN_CLAIM_LEASE_MS = 5 * 60 * 1000;
const ADMIN_EMAIL_LOG_VERBOSE = String(process.env.LOG_ADMIN_EMAIL_SCHEDULER || "").trim().toLowerCase() === "true";
let adminEmailSchemaReadyPromise = null;

async function ensureAdminEmailSchemaReady() {
  if (!adminEmailSchemaReadyPromise) {
    adminEmailSchemaReadyPromise = ensureAdminEmailCampaignSchema(db).catch((error) => {
      adminEmailSchemaReadyPromise = null;
      throw error;
    });
  }

  await adminEmailSchemaReadyPromise;
}

async function runAdminEmailCampaignSweep() {
  await ensureAdminEmailSchemaReady();

  const lockResult = await db.query(
    `SELECT pg_try_advisory_lock($1) AS locked`,
    [ADMIN_EMAIL_SWEEP_LOCK_KEY]
  );
  const locked = lockResult.rows[0]?.locked === true;
  if (!locked) {
    if (ADMIN_EMAIL_LOG_VERBOSE) {
      console.log(`[Admin Email Scheduler] ${new Date().toISOString()} sweep skipped (lock held by another process).`);
    }
    return { processed: 0, sent: 0, failed: 0, skipped: true };
  }

  try {
  await recoverRecurringCampaignsWithNullNextRun();

  const result = await db.query(
    `SELECT *
     FROM admin_email_campaigns
     WHERE is_active = TRUE
       AND next_run_at IS NOT NULL
     ORDER BY next_run_at ASC
     LIMIT 20`
  );

  const nowMs = Date.now();
  const campaigns = result.rows.filter((campaign) => {
    const dueAtMs = new Date(campaign.next_run_at).getTime();
    return Number.isFinite(dueAtMs) && dueAtMs <= nowMs;
  });
  if (ADMIN_EMAIL_LOG_VERBOSE || campaigns.length > 0) {
    console.log(`[Admin Email Scheduler] ${new Date().toISOString()} due campaigns: ${campaigns.length}`);
  }
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
  } finally {
    await db.query(
      `SELECT pg_advisory_unlock($1)`,
      [ADMIN_EMAIL_SWEEP_LOCK_KEY]
    );
  }
}

async function recoverRecurringCampaignsWithNullNextRun() {
  const RECOVERY_MESSAGE = 'Recovered schedule after missing next run timestamp.';
  const stuckResult = await db.query(
    `SELECT *
     FROM admin_email_campaigns
     WHERE is_active = TRUE
       AND frequency <> 'once'
       AND next_run_at IS NULL`
  );

  for (const campaign of stuckResult.rows) {
    const schedule = mapCampaignSchedule(campaign);
    const hasLastSent = campaign.last_sent_at && !Number.isNaN(new Date(campaign.last_sent_at).getTime());
    const nextRunAt = hasLastSent
      ? computeNextRunAfterSend(schedule, new Date(campaign.last_sent_at))
      : computeNextRunAt(schedule, new Date(), { allowImmediateCatchUp: true });

    // Guard against backward scheduling after recovery.
    const safeNextRunAt =
      nextRunAt && nextRunAt.getTime() < Date.now()
        ? computeNextRunAt(schedule, new Date(), { allowImmediateCatchUp: false })
        : nextRunAt;

    await db.query(
      `UPDATE admin_email_campaigns
       SET next_run_at = $2,
           last_error = CASE
             WHEN last_error = $3 THEN NULL
             ELSE last_error
           END
       WHERE id = $1`,
      [campaign.id, safeNextRunAt, RECOVERY_MESSAGE]
    );

    if (ADMIN_EMAIL_LOG_VERBOSE) {
      console.log(
        `[Admin Email Scheduler] Recovered campaign #${campaign.id} nextRun=${safeNextRunAt ? safeNextRunAt.toISOString() : 'null'} (lastSent=${campaign.last_sent_at ? new Date(campaign.last_sent_at).toISOString() : 'null'})`
      );
    }
  }
}

async function processCampaign(campaign) {
  if (ADMIN_EMAIL_LOG_VERBOSE) {
    console.log(
      `[Admin Email Scheduler] Processing campaign #${campaign.id} (${campaign.frequency}) now=${new Date().toISOString()} due=${campaign.next_run_at ? new Date(campaign.next_run_at).toISOString() : 'null'}`
    );
  }
  const claimLeaseUntil = new Date(Date.now() + CAMPAIGN_CLAIM_LEASE_MS);
  const claimed = await db.query(
    `UPDATE admin_email_campaigns
     SET next_run_at = $3
     WHERE id = $1
       AND is_active = TRUE
       AND next_run_at = $2
     RETURNING *`,
    [campaign.id, campaign.next_run_at, claimLeaseUntil]
  );

  const current = claimed.rows[0];
  if (!current) {
    return { sent: 0, failed: 0 };
  }

  const schedule = mapCampaignSchedule(current);

  try {
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
          computeNextRunAfterSend(schedule, sentAt),
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

    const nextRunAt = computeNextRunAfterSend(schedule, sentAt);
    const shouldRemainActive = current.frequency !== "once" && current.is_active;
    const errorMessage = failedCount > 0 ? `${failedCount} recipient(s) failed during the last send.` : null;

    if (ADMIN_EMAIL_LOG_VERBOSE || sentCount > 0 || failedCount > 0) {
      console.log(
        `[Admin Email Scheduler] Campaign #${current.id} sent=${sentCount} failed=${failedCount} nextRun=${nextRunAt ? nextRunAt.toISOString() : 'null'}`
      );
    }

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
  } catch (error) {
    const fallbackNextRun = computeNextRunAt(schedule, new Date(), { allowImmediateCatchUp: false });
    await db.query(
      `UPDATE admin_email_campaigns
       SET next_run_at = $2,
           last_error = $3
       WHERE id = $1`,
      [
        current.id,
        fallbackNextRun,
        `Send failed before completion: ${error.message || 'Unknown error'}`,
      ]
    );

    console.error(
      `[Admin Email Scheduler] Campaign #${current.id} failed mid-send; restored nextRun=${fallbackNextRun ? fallbackNextRun.toISOString() : 'null'} error=${error.message || 'Unknown error'}`
    );
    return { sent: 0, failed: 1 };
  }
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