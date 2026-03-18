// jobs/scheduler.js
// Schedules the recurring Paystack billing job to run every minute

const cron = require('node-cron');
const runRecurringBilling = require('./recurringPaystackBilling');

const shouldRunScheduler = process.env.NODE_ENV === 'production' || process.env.ENABLE_BILLING_SCHEDULER === 'true';

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
