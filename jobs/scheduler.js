// jobs/scheduler.js
// Schedules the recurring Stripe billing job to run every minute

const nodeCron = require('node-cron');
const { withJobLock } = require('../utils/dbLock');

// Every job holds a Postgres lock while it runs, so it never runs twice at the
// same time — not on two servers, and not overlapping itself when a run is slow.
// Locks are named after the job, so old and new copies agree during a deploy.
const scheduledTasks = [];
const cron = {
  schedule(expression, name, task) {
    const lockKey = `scheduler-job:${name}`;
    const scheduled = nodeCron.schedule(expression, async () => {
      try {
        await withJobLock(lockKey, task);
      } catch (error) {
        console.error(`[Scheduler] ${lockKey} could not run:`, error.message);
      }
    });
    scheduledTasks.push(scheduled);
    return scheduled;
  },
};
const runRecurringBilling = require('./recurringStripeBilling');
const {
  ensureNotificationSchema,
  runAbsenceAlertSweep,
  runWeeklyDigestSweep,
} = require('../utils/notificationDigestService');
const { runAdminEmailCampaignSweep } = require('../utils/adminEmailCampaignRunner');
const { purgeOldActivityLogs } = require('../utils/activityLog');
const { retryPendingPaystackPayouts } = require('../utils/paystackPayout');
const { runPayoutSweep } = require('./payoutScheduler');
const { getPaystackSettings } = require('../utils/paystackConfig');
const {
  syncQueuedGoogleClassroomOrganizations,
  pullGradesFromGoogleClassroom,
} = require('../utils/googleClassroomSync');
const { runTransportArrivalSweep } = require('../utils/transportArrivalNotifier');

const shouldRunScheduler = process.env.NODE_ENV === 'production' || process.env.ENABLE_BILLING_SCHEDULER === 'true';
const shouldRunNotifications = process.env.NODE_ENV === 'production' || process.env.ENABLE_NOTIFICATION_SCHEDULER === 'true';
// Announcement/email scheduling should work in both prod and local unless
// explicitly disabled.
const shouldRunAdminEmailScheduler = process.env.ENABLE_ADMIN_EMAIL_SCHEDULER !== 'false';
const shouldRunActivityLogRetention = process.env.NODE_ENV === 'production' || process.env.ENABLE_ACTIVITY_LOG_RETENTION === 'true';
// Payouts (Settings → Payouts) — opt-out like the admin email scheduler, so
// scheduled/recurring payouts are testable locally without extra env config.
const shouldRunPayoutScheduler = process.env.ENABLE_PAYOUT_SCHEDULER !== 'false';
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
  // Promotions scheduled for today.
  cron.schedule('0 0 * * *', 'scheduled-promotions', async () => {
    try {
      await require('../controllers/promotionController').applyScheduledPromotions();
    } catch (error) {
      console.error('[Promotions] Automatic apply failed:', error.message);
    }
  });

  // Bus positions older than a month.
  cron.schedule('50 2 * * *', 'live-location-purge', async () => {
    try {
      const { rowCount } = await require('../config/db').query(
        "DELETE FROM transport_live_locations WHERE recorded_at < NOW() - INTERVAL '30 days'"
      );
      if (rowCount) console.log(`[Transport] Removed ${rowCount} old bus positions.`);
    } catch (error) {
      console.error('[Transport] Old position cleanup failed:', error.message);
    }
  });

  // Schedule to run every minute for dynamic billing
  cron.schedule('* * * * *', 'recurring-billing', async () => {
    try {
      await runRecurringBilling();
    } catch (error) {
      console.error('[Billing] Recurring billing failed:', error.message);
    }
  });
  // Hub billing (separate from school subscriptions): scheduled holds, keeping
  // each hub's Stripe subscription in step with its numbers, invoices, reminders.
  cron.schedule('7 * * * *', 'hub-billing', async () => {
    try {
      const summary = await require('../utils/hubBilling').runHubBillingSweep(require('../config/db'));
      if (summary.holds || summary.resumed || summary.reminders || summary.errors) {
        console.log(`[Hub Billing] holds=${summary.holds} resumed=${summary.resumed} synced=${summary.synced} reminders=${summary.reminders} errors=${summary.errors}`);
      }
    } catch (error) {
      console.error('[Hub Billing] Sweep failed:', error.message);
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
  cron.schedule('15 19 * * *', 'absence-alerts', async () => {
    try {
      const summary = await runAbsenceAlertSweep();
      console.log(`[Notification Scheduler] Parent absence alerts processed. Emails sent: ${summary.sent || 0}`);
    } catch (error) {
      console.error('[Notification Scheduler] Parent absence sweep failed:', error.message);
    }
  });

  // 16:00 UTC: tomorrow's activity reminders to families (still the same calendar day from the
  // US west coast to east Africa). Each activity is sent once (utils/classActivities.js).
  cron.schedule('0 16 * * *', 'activity-reminders', async () => {
    try {
      const summary = await require('../utils/classActivities').sendActivityReminders(require('../config/db'));
      if (summary.emails) console.log(`[Activity Reminders] ${summary.activities} activities, ${summary.emails} emails`);
    } catch (error) {
      console.error('[Activity Reminders] Failed:', error.message);
    }
  });

  // Hourly: custom form reminders (N days before a date in a form, or before a form's deadline
  // to those who haven't filled it in). Each reminder goes once (utils/customForms.js).
  cron.schedule('25 * * * *', 'custom-form-reminders', async () => {
    try {
      const summary = await require('../utils/customForms').runReminders(require('../config/db'));
      if (summary.runs) console.log(`[Custom forms] ${summary.runs} reminders`);
    } catch (error) {
      console.error('[Custom forms] Reminders failed:', error.message);
    }
  });

  // Nightly: the whole database, encrypted, to Managira's own private storage, kept 30 days
  // (utils/backups.js; Super Admin › Backups). Without its key or bucket it logs why and stops.
  cron.schedule('20 3 * * *', 'database-backup', async () => {
    try {
      const result = await require('../utils/backups').runBackup(require('../config/db'), { triggeredBy: 'schedule' });
      if (result.ok) console.log(`[Backup] ${result.tables} tables, ${result.rows} rows, ${(result.bytes / 1048576).toFixed(1)} MB`);
    } catch (error) {
      console.error('[Backup] failed:', error.message);
    }
  });

  // Daily: 30 days after a school's data migration went live, its uploaded files, snapshot and
  // sandbox are deleted (utils/dataMigration.js). The loaded records stay.
  cron.schedule('40 3 * * *', 'migration-purge', async () => {
    try {
      const summary = await require('../utils/dataMigration').purgeDue(require('../config/db'));
      if (summary.purged) console.log(`[Migration] cleaned up ${summary.purged} finished migrations`);
    } catch (error) {
      console.error('[Migration] Clean-up failed:', error.message);
    }
  });

  // Hourly digest window sweep; each organization policy controls weekday/hour send.
  cron.schedule('0 * * * *', 'weekly-digest', async () => {
    try {
      const summary = await runWeeklyDigestSweep();
      console.log(
        `[Notification Scheduler] Digest sweep complete. parent=${summary.parentSent || 0}, teacher=${summary.teacherSent || 0}, manager=${summary.managerSent || 0}, hub=${summary.hubSent || 0}`
      );
    } catch (error) {
      console.error('[Notification Scheduler] Weekly digest sweep failed:', error.message);
    }
  });
  // Every minute: check active bus trips against student home/stop locations
  // and fire "approaching" (~5 min out) / "arrived" parent notifications.
  cron.schedule('* * * * *', 'transport-arrivals', async () => {
    try {
      const summary = await runTransportArrivalSweep();
      if (summary.approachingSent > 0 || summary.arrivedSent > 0) {
        console.log(
          `[Transport Arrival Sweep] trips=${summary.tripsChecked}, approaching=${summary.approachingSent}, arrived=${summary.arrivedSent}`
        );
      }
    } catch (error) {
      console.error('[Transport Arrival Sweep] Failed:', error.message);
    }
  });
} else {
  // Notifications disabled in dev — set ENABLE_NOTIFICATION_SCHEDULER=true to enable.
}

if (shouldRunAdminEmailScheduler) {
  cron.schedule('* * * * *', 'admin-email-campaigns', async () => {
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

if (shouldRunPayoutScheduler) {
  // Every 5 minutes: charge due org_payouts (one-time and recurring) against
  // the school's saved card and email the recipient a receipt.
  cron.schedule('*/5 * * * *', 'payout-sweep', async () => {
    try {
      const summary = await runPayoutSweep();
      if (summary.processed > 0) {
        console.log(`[Payout Scheduler] Sweep complete. processed=${summary.processed}, succeeded=${summary.succeeded}, failed=${summary.failed}`);
      }
    } catch (error) {
      console.error('[Payout Scheduler] Sweep failed:', error.message);
    }
  });
} else {
  // Payout scheduler disabled — set ENABLE_PAYOUT_SCHEDULER=false to disable, unset/true to enable.
}

// Saved reports emailed daily, weekly or monthly (Report Builder). Off in local
// development unless ENABLE_REPORT_SCHEDULES=true, so testing never emails anyone.
if (process.env.NODE_ENV === 'production' || process.env.ENABLE_REPORT_SCHEDULES === 'true') {
  cron.schedule('20 * * * *', 'report-schedules', async () => {
    try {
      const summary = await require('../controllers/reportBuilderController').runDueReportSchedules(require('../config/db'));
      if (summary.sent || summary.failed) {
        console.log(`[Report Schedules] sent=${summary.sent} failed=${summary.failed}`);
      }
    } catch (error) {
      console.error('[Report Schedules] Sweep failed:', error.message);
    }
  });
}

if (shouldRunActivityLogRetention) {
  // Runs weekly at 03:15 on Sundays. Deletes activity log rows older than the
  // configured retention (default 3 years). Source records in other tables are
  // never touched — only the audit trail is pruned.
  cron.schedule('15 3 * * 0', 'activity-log-purge', async () => {
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
  cron.schedule('*/3 * * * *', 'paystack-payout-retry', async () => {
    try {
      const summary = await retryPendingPaystackPayouts(undefined, resolveActivePaystackSecret);
      if (summary.processed > 0) {
        console.log(`[Paystack Payout] Sweep complete. processed=${summary.processed}, settled=${summary.settled}`);
      }
    } catch (error) {
      console.error('[Paystack Payout] Sweep failed:', error.message);
    }
  });

  // Every 5 minutes: process queued Google Classroom course/roster sync jobs.
  cron.schedule('*/5 * * * *', 'google-classroom-sync', async () => {
    try {
      const processed = await syncQueuedGoogleClassroomOrganizations({ limit: 8 });
      if (processed > 0) {
        console.log(`[Google Classroom] Sync sweep complete. organizations=${processed}`);
      }
    } catch (error) {
      console.error('[Google Classroom] Sync sweep failed:', error.message);
    }
  });

  // Every 10 minutes: connected Google and Outlook calendars get what changed in Managira.
  cron.schedule('*/10 * * * *', 'calendar-sync', async () => {
    try {
      const synced = await require('../controllers/workspaceController').runCalendarSyncSweep(require('../config/db'));
      if (synced > 0) console.log(`[Calendar] Sync sweep complete. calendars=${synced}`);
    } catch (error) {
      console.error('[Calendar] Sync sweep failed:', error.message);
    }
  });

  // Every 30 minutes: pull Google Classroom grades back into assessment_results.
  cron.schedule('*/30 * * * *', 'google-classroom-grades', async () => {
    try {
      const imported = await pullGradesFromGoogleClassroom({ limitOrganizations: 40 });
      if (imported > 0) {
        console.log(`[Google Classroom] Grade pull complete. upserts=${imported}`);
      }
    } catch (error) {
      console.error('[Google Classroom] Grade pull failed:', error.message);
    }
  });
}

// Daily: rejected online applications are removed 60 days after the decision
// (until then they stay under Admissions → Online Applications → Rejected).
if (shouldRunScheduler) {
  cron.schedule('40 2 * * *', 'admission-rejection-purge', async () => {
    try {
      const { purgeOldRejections } = require('../utils/admissionRejections');
      const summary = await purgeOldRejections(require('../config/db'));
      if (summary.deleted > 0) console.log(`[Admissions] Removed ${summary.deleted} applications rejected over 60 days ago.`);
    } catch (error) {
      console.error('[Admissions] Rejected application cleanup failed:', error.message);
    }
  });
}

// Midnight: apply scheduled account holds, then remind managers of on-hold accounts.
const shouldRunScheduledHolds = process.env.NODE_ENV === 'production' || process.env.ENABLE_SCHEDULED_HOLDS_CRON === 'true';
if (shouldRunScheduledHolds) {
  cron.schedule('0 0 * * *', 'scheduled-holds', async () => {
    try {
      await require('../utils/applyScheduledHolds')();
    } catch (error) {
      console.error('[Scheduled Holds] Failed:', error.message);
    }
    try {
      const summary = await require('../utils/onHoldManagerReminders').runOnHoldManagerReminderSweep();
      if (summary.emailsSent > 0) {
        console.log(`[On-Hold Manager Reminder] Sweep complete. orgs=${summary.orgsProcessed}, emails=${summary.emailsSent}`);
      }
    } catch (error) {
      console.error('[On-Hold Manager Reminder] Sweep failed:', error.message);
    }
  });
}

module.exports = { stopAll: () => scheduledTasks.forEach((scheduled) => scheduled.stop()) };
