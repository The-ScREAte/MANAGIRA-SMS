// jobs/scheduler.js
// Schedules the recurring Paystack billing job to run every minute

const cron = require('node-cron');
const runRecurringBilling = require('./recurringPaystackBilling');
const {
  ensureNotificationSchema,
  runAbsenceAlertSweep,
  runWeeklyDigestSweep,
} = require('../utils/notificationDigestService');

const shouldRunScheduler = process.env.NODE_ENV === 'production' || process.env.ENABLE_BILLING_SCHEDULER === 'true';
const shouldRunNotifications = process.env.NODE_ENV === 'production' || process.env.ENABLE_NOTIFICATION_SCHEDULER === 'true';

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
  // Keep local/dev logs clean and avoid missed-execution warnings when machine sleeps.
  console.log('[Billing Scheduler] Disabled outside production. Set ENABLE_BILLING_SCHEDULER=true to enable.');
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
  console.log('[Notification Scheduler] Disabled outside production. Set ENABLE_NOTIFICATION_SCHEDULER=true to enable.');
}
