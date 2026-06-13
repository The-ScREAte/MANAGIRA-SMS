// jobs/scheduler.js
// Schedules the recurring Paystack billing job to run every minute

const cron = require('node-cron');
const runRecurringBilling = require('./recurringPaystackBilling');
const {
  ensureNotificationSchema,
  runAbsenceAlertSweep,
  runWeeklyDigestSweep,
} = require('../utils/notificationDigestService');
const { runAdminEmailCampaignSweep } = require('../utils/adminEmailCampaignRunner');
const { purgeOldActivityLogs } = require('../utils/activityLog');
const { retryPendingPaystackPayouts } = require('../utils/paystackPayout');
const { getPaystackSettings } = require('../utils/paystackConfig');

const shouldRunScheduler = process.env.NODE_ENV === 'production' || process.env.ENABLE_BILLING_SCHEDULER === 'true';
const shouldRunNotifications = process.env.NODE_ENV === 'production' || process.env.ENABLE_NOTIFICATION_SCHEDULER === 'true';
const shouldRunAdminEmailScheduler = process.env.NODE_ENV === 'production' || process.env.ENABLE_ADMIN_EMAIL_SCHEDULER === 'true';
const shouldRunActivityLogRetention = process.env.NODE_ENV === 'production' || process.env.ENABLE_ACTIVITY_LOG_RETENTION === 'true';
const ACTIVITY_LOG_RETENTION_DAYS = Number(process.env.ACTIVITY_LOG_RETENTION_DAYS) || 1095; // ~3 years

// Resolve the active Paystack secret key for the current mode (test/live).
async function resolveActivePaystackSecret() {
  try {
    const settings = await getPaystackSettings();
    return settings.activeSecretKey || process.env.PAYSTACK_SECRET_KEY || '';
  } catch (_) {
    return process.env.PAYSTACK_SECRET_KEY || '';
  }
}

if (shouldRunScheduler) {
  // Schedule to run every minute for dynamic billing
  cron.schedule('* * * * *', async () => {
    try {
      await runRecurringBilling();
    } catch (error) {
      // Silent fail
    }
  });
} else {
  // Scheduler disabled in dev — set ENABLE_BILLING_SCHEDULER=true to enable.
}

if (shouldRunNotifications) {
  ensureNotificationSchema().catch((error) => {
    console.error('[Notification Scheduler] Failed to ensure schema:', error.message);
  });

  // Daily parent absence threshold sweep.
  cron.schedule('15 19 * * *', async () => {
    try {
      const summary = await runAbsenceAlertSweep();
      console.log(`[Notification Scheduler] Parent absence alerts processed. Emails sent: ${summary.sent || 0}`);
    } catch (error) {
      console.error('[Notification Scheduler] Parent absence sweep failed:', error.message);
    }
  });

  // Hourly digest window sweep; each organization policy controls weekday/hour send.
  cron.schedule('0 * * * *', async () => {
    try {
      const summary = await runWeeklyDigestSweep();
      console.log(
        `[Notification Scheduler] Digest sweep complete. parent=${summary.parentSent || 0}, teacher=${summary.teacherSent || 0}, manager=${summary.managerSent || 0}, hub=${summary.hubSent || 0}`
      );
    } catch (error) {
      console.error('[Notification Scheduler] Weekly digest sweep failed:', error.message);
    }
  });
} else {
  // Notifications disabled in dev — set ENABLE_NOTIFICATION_SCHEDULER=true to enable.
}

if (shouldRunAdminEmailScheduler) {
  cron.schedule('* * * * *', async () => {
    try {
      const summary = await runAdminEmailCampaignSweep();
      if (summary.processed > 0) {
        console.log(
          `[Admin Email Scheduler] Sweep complete. campaigns=${summary.processed}, sent=${summary.sent}, failed=${summary.failed}`
        );
      }
    } catch (error) {
      console.error('[Admin Email Scheduler] Sweep failed:', error.message);
    }
  });
} else {
  // Admin email scheduler disabled in dev — set ENABLE_ADMIN_EMAIL_SCHEDULER=true to enable.
}

if (shouldRunActivityLogRetention) {
  // Runs weekly at 03:15 on Sundays. Deletes activity log rows older than the
  // configured retention (default 3 years). Source records in other tables are
  // never touched — only the audit trail is pruned.
  cron.schedule('15 3 * * 0', async () => {
    try {
      const summary = await purgeOldActivityLogs(undefined, ACTIVITY_LOG_RETENTION_DAYS);
      if (summary.deleted > 0) {
        console.log(`[Activity Log Retention] Purged ${summary.deleted} rows older than ${summary.retentionDays} days.`);
      }
    } catch (error) {
      console.error('[Activity Log Retention] Purge failed:', error.message);
    }
  });
} else {
  // Activity log retention disabled in dev — set ENABLE_ACTIVITY_LOG_RETENTION=true to enable.
}

if (shouldRunScheduler) {
  // Every 3 minutes: retry + reconcile Paystack school payouts (settlements for
  // mobile-money / bank-recipient / local accounts that are not split at charge
  // time). Handles charges whose balance had not settled when first attempted.
  cron.schedule('*/3 * * * *', async () => {
    try {
      const summary = await retryPendingPaystackPayouts(undefined, resolveActivePaystackSecret);
      if (summary.processed > 0) {
        console.log(`[Paystack Payout] Sweep complete. processed=${summary.processed}, settled=${summary.settled}`);
      }
    } catch (error) {
      console.error('[Paystack Payout] Sweep failed:', error.message);
    }
  });
}
