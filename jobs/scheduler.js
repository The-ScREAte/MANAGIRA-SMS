// jobs/scheduler.js
// Schedules the recurring Paystack billing job to run every minute

const cron = require('node-cron');
const runRecurringBilling = require('./recurringPaystackBilling');


// Schedule to run every minute for dynamic billing
cron.schedule('* * * * *', async () => {
  try {
    await runRecurringBilling();
  } catch (error) {
    // Silent fail
  }
});
