// jobs/recurringPaystackBilling.js
// Runs daily to charge organizations the current price using Paystack authorization

const db = require('../config/db');
const axios = require('axios');
require('dotenv').config();

async function runRecurringBilling() {
  
  // Fetch current billing interval from database
  let billingInterval = 'monthly';
  try {
    const intervalResult = await db.query("SELECT value FROM app_settings WHERE key = 'billing_interval'");
    if (intervalResult.rows.length > 0) {
      billingInterval = intervalResult.rows[0].value;
    }
  } catch (err) {
  }
  // Find all organizations whose next_payment_end_date is today or earlier and are active
  // ONLY exclude if they are currently in an ACTIVE trial (trial_active_until > NOW())
  
  const orgsDue = await db.query(`
    SELECT o.organization_id, o.email, o.organization_name, o.plan_id, c.authorization_code, p.next_payment_end_date, o.trial_active_until,
           CASE 
             WHEN o.trial_active_until IS NULL THEN 'No Trial'
             WHEN o.trial_active_until > NOW() THEN 'Trial Active'
             ELSE 'Trial Expired'
           END as trial_status
    FROM organizations o
    JOIN payments p ON o.organization_id = p.organization_id
    JOIN stored_cards c ON c.organization_id = o.organization_id AND c.is_primary = true AND c.is_active = true
    WHERE p.status = 'active' 
      AND o.on_hold = false
      AND o.scheduled_hold_date IS NULL
      AND p.next_payment_end_date <= NOW()
      AND (o.trial_active_until IS NULL OR o.trial_active_until < NOW())
  `);

  
  // Debug: Let's also check ALL organizations to see what's happening
  const allOrgs = await db.query(`
    SELECT o.organization_id, o.organization_name, o.trial_active_until, p.next_payment_end_date, p.status,
           CASE 
             WHEN o.trial_active_until IS NULL THEN 'No Trial'
             WHEN o.trial_active_until > NOW() THEN 'Trial Active'
             ELSE 'Trial Expired'
           END as trial_status,
           (p.next_payment_end_date <= NOW()) as payment_due,
           (o.trial_active_until IS NULL OR o.trial_active_until < NOW()) as not_in_trial
    FROM organizations o
    LEFT JOIN payments p ON o.organization_id = p.organization_id
    ORDER BY o.organization_id DESC LIMIT 5
  `);
  
  allOrgs.rows.forEach(org => {
  });
  
  if (orgsDue.rows.length === 0) {
    return;
  }

  // Log details of organizations due

  for (const org of orgsDue.rows) {
    
    // SAFETY CHECK: Double-check trial status before charging
    if (org.trial_active_until) {
      const now = new Date();
      const trialEnd = new Date(org.trial_active_until);
      if (trialEnd > now) {
        continue;
      } else {
      }
    }
    
    // 2. Fetch the current price for the plan
    const planRes = await db.query('SELECT total_cost FROM plans WHERE id = $1', [org.plan_id]);
    if (!planRes.rows.length) {
      continue;
    }
    const amount = Math.round(planRes.rows[0].total_cost * 100); // pesewas

    // 3. Charge via Paystack
    try {
      const chargeRes = await axios.post(
        'https://api.paystack.co/transaction/charge_authorization',
        {
          email: org.email,
          amount,
          authorization_code: org.authorization_code,
          currency: 'GHS',
        },
        {
          headers: { Authorization: `Bearer ${process.env.PAYSTACK_SECRET_KEY}` }
        }
      );
      
      if (chargeRes.data.status) {
        // 4. Update payment record with dynamic billing interval
        let nextPaymentDate;
        switch (billingInterval) {
          case '5_minutes':
            nextPaymentDate = "NOW() + interval '5 minutes'";
            break;
          case 'daily':
            nextPaymentDate = "NOW() + interval '1 day'";
            break;
          case 'weekly':
            nextPaymentDate = "NOW() + interval '1 week'";
            break;
          case 'yearly':
            nextPaymentDate = "NOW() + interval '1 year'";
            break;
          case '2_years':
            nextPaymentDate = "NOW() + interval '2 years'";
            break;
          case '3_years':
            nextPaymentDate = "NOW() + interval '3 years'";
            break;
          case 'monthly':
          default:
            nextPaymentDate = "NOW() + interval '1 month'";
            break;
        }
        
        await db.query(
          `UPDATE payments SET amount_paid = $1, next_payment_end_date = ${nextPaymentDate} WHERE organization_id = $2`,
          [amount / 100, org.organization_id]
        );
        
      } else {
      }
    } catch (err) {
    }
  }
  
}

if (require.main === module) {
  runRecurringBilling().then(() => process.exit());
}

module.exports = runRecurringBilling;
