// jobs/recurringPaystackBilling.js
// Runs daily to charge organizations the current price using Paystack authorization

const db = require('../config/db');
const axios = require('axios');
const { getPaystackSettings } = require('../utils/paystackConfig');
const { sendEmailSafely, renderCleanEmail } = require('../utils/emailHelper');
require('dotenv').config();

const FAILED_RETRY_COOLDOWN_DAYS = 4;
const MAX_FAILED_RETRY_ATTEMPTS = 4;

function computeTierMonthlyPrice(planBasePrice, tier) {
  const basePrice = Number(planBasePrice || 0);
  const adjustmentPercent = Number(
    tier?.tier_adjustment_percentage ?? tier?.adjustment_percentage
  );
  if (Number.isFinite(adjustmentPercent)) {
    return Math.max(0, basePrice * (1 + adjustmentPercent / 100));
  }
  return Number((tier?.tier_price_usd ?? tier?.price_usd) || 0);
}

function tierMatchesStudentCount(tier, studentCount) {
  const minStudents = Number(tier?.min_students || 0);
  const maxStudents =
    tier?.max_students === null || tier?.max_students === undefined
      ? null
      : Number(tier.max_students);

  return studentCount >= minStudents && (maxStudents === null || studentCount <= maxStudents);
}

function pickTierForStudentCount(tiers, studentCount) {
  if (!Array.isArray(tiers) || tiers.length === 0) {
    return null;
  }

  const exactMatch = tiers.find((tier) => tierMatchesStudentCount(tier, studentCount));
  if (exactMatch) {
    return exactMatch;
  }

  const fallbackTier = [...tiers]
    .reverse()
    .find((tier) => studentCount >= Number(tier.min_students || 0));

  return fallbackTier || tiers[0];
}

async function getOrganizationStudentCount(organizationId) {
  const countRes = await db.query(
    'SELECT COUNT(*) AS cnt FROM students WHERE organization_id = $1',
    [organizationId]
  );

  return parseInt(countRes.rows[0]?.cnt, 10) || 0;
}

async function getPlanStudentTiers(planId) {
  const tiersRes = await db.query(
    `SELECT id, label, min_students, max_students, price_usd, adjustment_percentage
     FROM plan_student_tiers
     WHERE plan_id = $1
     ORDER BY sort_order, min_students, id`,
    [planId]
  );

  return tiersRes.rows;
}

async function getPaymentsFailureColumns() {
  const result = await db.query(
    `SELECT column_name
     FROM information_schema.columns
     WHERE table_name = 'payments'
       AND column_name IN ('failed_attempts', 'last_failed_payment')`
  );

  const columnSet = new Set(result.rows.map((row) => row.column_name));
  return {
    hasFailedAttempts: columnSet.has('failed_attempts'),
    hasLastFailedPayment: columnSet.has('last_failed_payment'),
  };
}

async function sendRenewalFailureNotification({ email, organizationName, amount, reason }) {
  if (!email) return;

  const html = renderCleanEmail({
    title: 'Subscription Renewal Failed',
    greeting: `Hello <strong>${organizationName || 'Managira User'}</strong>,`,
    paragraphs: [
      `We could not process your automatic renewal charge of GHS ${Number(amount || 0).toFixed(2)}.`,
      reason ? `Paystack response: ${reason}` : 'Your card may have insufficient funds or the authorization is no longer valid.',
      'Please update your card details in billing settings to resume successful renewals.',
    ],
  });

  await sendEmailSafely(
    {
      to: email,
      subject: 'Managira: Renewal Payment Failed',
      html,
    },
    'RecurringPaystackFailure'
  );
}

async function recordRenewalFailure({
  organizationId,
  paymentFailureColumns,
}) {
  if (paymentFailureColumns.hasFailedAttempts && paymentFailureColumns.hasLastFailedPayment) {
    const failureUpdate = await db.query(
      `UPDATE payments
       SET status = 'failed',
           failed_attempts = COALESCE(failed_attempts, 0) + 1,
           last_failed_payment = NOW()
       WHERE organization_id = $1
       RETURNING COALESCE(failed_attempts, 0) AS failed_attempts`,
      [organizationId]
    );

    const failedAttempts = Number(failureUpdate.rows[0]?.failed_attempts || 0);
    if (failedAttempts >= MAX_FAILED_RETRY_ATTEMPTS) {
      await db.query(
        `UPDATE organizations
         SET on_hold = true
         WHERE organization_id = $1`,
        [organizationId]
      );
    }

    return failedAttempts;
  }

  await db.query(
    `UPDATE payments
     SET status = 'failed'
     WHERE organization_id = $1`,
    [organizationId]
  );

  return null;
}

async function runRecurringBilling() {
  const paystackSettings = await getPaystackSettings(db);
  const activePaystackSecretKey = paystackSettings.activeSecretKey || process.env.PAYSTACK_SECRET_KEY;
  const paymentFailureColumns = await getPaymentsFailureColumns();
  const retryStatusClause = paymentFailureColumns.hasFailedAttempts && paymentFailureColumns.hasLastFailedPayment
    ? `(p.status = 'active' OR (p.status = 'failed' AND COALESCE(p.failed_attempts, 0) < ${MAX_FAILED_RETRY_ATTEMPTS} AND (p.last_failed_payment IS NULL OR p.last_failed_payment <= NOW() - interval '${FAILED_RETRY_COOLDOWN_DAYS} days')))`
    : `p.status = 'active'`;
  
  // Fetch current billing interval from database
  let billingInterval = 'monthly';
  try {
    const intervalResult = await db.query("SELECT value FROM app_settings WHERE key = 'billing_interval'");
    if (intervalResult.rows.length > 0) {
      billingInterval = intervalResult.rows[0].value;
    }
  } catch (err) {
  }
  // Find all organizations whose next_payment_end_date is today or earlier and are retryable.
  // ONLY exclude if they are currently in an ACTIVE trial (trial_active_until > NOW()).
  
  const orgsDue = await db.query(`
    SELECT o.organization_id, o.email, o.organization_name, o.plan_id, c.authorization_code, p.next_payment_end_date, o.trial_active_until,
           COALESCE(p.billing_period_key, 'monthly') AS billing_period_key,
           o.pending_plan_id, o.pending_plan_effective_date,
           o.selected_student_tier_id,
          o.approx_student_count,
           pst.price_usd AS tier_price_usd,
           pst.adjustment_percentage AS tier_adjustment_percentage,
           pst.max_students AS tier_max_students,
           pst.label AS tier_label,
           COALESCE(o.student_tier_exceeded_notified, false) AS student_tier_exceeded_notified,
           CASE 
             WHEN o.trial_active_until IS NULL THEN 'No Trial'
             WHEN o.trial_active_until > NOW() THEN 'Trial Active'
             ELSE 'Trial Expired'
           END as trial_status
    FROM organizations o
    JOIN payments p ON o.organization_id = p.organization_id
    JOIN stored_cards c ON c.organization_id = o.organization_id AND c.is_primary = true AND c.is_active = true
    LEFT JOIN plan_student_tiers pst ON pst.id = o.selected_student_tier_id
    WHERE ${retryStatusClause}
      AND o.on_hold = false
      AND o.scheduled_hold_date IS NULL
      AND NOT (COALESCE(o.is_hub_member, false) = true AND o.hub_id IS NOT NULL)
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

    // Apply pending plan downgrade if effective date has arrived
    // We store this flag but only apply AFTER successful payment
    let shouldApplyPendingPlan = false;
    let pendingPlanId = null;
    if (org.pending_plan_id && org.pending_plan_effective_date) {
      const effectiveDate = new Date(org.pending_plan_effective_date);
      if (effectiveDate <= new Date()) {
        shouldApplyPendingPlan = true;
        pendingPlanId = org.pending_plan_id;
        // Use the new (downgraded) plan for the charge amount
        org.plan_id = org.pending_plan_id;
      }
    }
    
    // 2. Fetch the current price for the plan
    const planRes = await db.query('SELECT total_cost FROM plans WHERE id = $1', [org.plan_id]);
    if (!planRes.rows.length) {
      continue;
    }
    const actualStudentCount = await getOrganizationStudentCount(org.organization_id);
    const planTiers = await getPlanStudentTiers(org.plan_id);
    const billingTier = pickTierForStudentCount(planTiers, actualStudentCount);
    const tierCoversCurrentCount = billingTier
      ? tierMatchesStudentCount(billingTier, actualStudentCount)
      : false;

    if (billingTier) {
      const shouldResetExceededFlag = tierCoversCurrentCount && org.student_tier_exceeded_notified;
      const tierChanged = Number(org.selected_student_tier_id) !== Number(billingTier.id);
      const countChanged = Number(org.approx_student_count) !== actualStudentCount;

      if (tierChanged || countChanged || shouldResetExceededFlag) {
        await db.query(
          `UPDATE organizations
           SET selected_student_tier_id = $1,
               approx_student_count = $2,
               student_tier_exceeded_notified = $3
           WHERE organization_id = $4`,
          [
            billingTier.id,
            actualStudentCount,
            shouldResetExceededFlag ? false : org.student_tier_exceeded_notified,
            org.organization_id,
          ]
        );
      }

      org.selected_student_tier_id = billingTier.id;
      org.tier_price_usd = billingTier.price_usd;
      org.tier_adjustment_percentage = billingTier.adjustment_percentage;
      org.tier_max_students = billingTier.max_students;
      org.tier_label = billingTier.label;
      org.student_tier_exceeded_notified = shouldResetExceededFlag ? false : org.student_tier_exceeded_notified;
    } else if (org.selected_student_tier_id || Number(org.approx_student_count) !== actualStudentCount) {
      await db.query(
        `UPDATE organizations
         SET selected_student_tier_id = NULL,
             approx_student_count = $1,
             student_tier_exceeded_notified = false
         WHERE organization_id = $2`,
        [actualStudentCount, org.organization_id]
      );

      org.selected_student_tier_id = null;
      org.tier_max_students = null;
      org.tier_label = null;
      org.student_tier_exceeded_notified = false;
    }

    const monthlyPrice = billingTier
      ? computeTierMonthlyPrice(planRes.rows[0].total_cost, billingTier)
      : Number(planRes.rows[0].total_cost);

    // Calculate period-aware charge amount
    let periodMonths = 1;
    let periodDiscount = 0;
    try {
      const bpRes = await db.query(
        'SELECT months, discount_percentage FROM billing_periods WHERE period_key = $1',
        [org.billing_period_key || 'monthly']
      );
      if (bpRes.rows.length > 0) {
        periodMonths = bpRes.rows[0].months;
        periodDiscount = bpRes.rows[0].discount_percentage || 0;
      }
    } catch (bpErr) {
      // fallback to monthly
    }
    const rawTotal = monthlyPrice * periodMonths;
    const chargeAmount = periodDiscount > 0 ? rawTotal * (1 - periodDiscount / 100) : rawTotal;
    const amount = Math.round(chargeAmount * 100); // pesewas

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
          headers: { Authorization: `Bearer ${activePaystackSecretKey}` }
        }
      );
      
      if (chargeRes.data.status) {
        // 4. Update payment record — use billing period months or fall back to global interval
        let nextPaymentDate;
        if (periodMonths > 1) {
          nextPaymentDate = `NOW() + interval '${periodMonths} months'`;
        } else {
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
        }
        
        await db.query(
          paymentFailureColumns.hasFailedAttempts && paymentFailureColumns.hasLastFailedPayment
            ? `UPDATE payments
               SET amount_paid = $1,
                   next_payment_end_date = ${nextPaymentDate},
                   status = 'active',
                   failed_attempts = 0,
                   last_failed_payment = NULL
               WHERE organization_id = $2`
            : `UPDATE payments
               SET amount_paid = $1,
                   next_payment_end_date = ${nextPaymentDate},
                   status = 'active'
               WHERE organization_id = $2`,
          [amount / 100, org.organization_id]
        );

        // Apply pending plan downgrade only after successful payment
        if (shouldApplyPendingPlan && pendingPlanId) {
          try {
            await db.query(
              `UPDATE organizations
               SET plan_id = $1, pending_plan_id = NULL, pending_plan_effective_date = NULL
               WHERE organization_id = $2`,
              [pendingPlanId, org.organization_id]
            );
          } catch (pendingErr) {
            // Plan switch failed but payment succeeded — will retry next cycle
          }
        }

        // Check if school has exceeded their student tier limit (one-time notification)
        if (org.selected_student_tier_id && org.tier_max_students != null && !org.student_tier_exceeded_notified) {
          try {
            if (actualStudentCount > org.tier_max_students) {
              // Send congratulations email
              const congratsHtml = renderCleanEmail({
                title: 'Congratulations on Your Growth!',
                greeting: `Hello <strong>${org.organization_name || 'Managira User'}</strong>,`,
                paragraphs: [
                  `Great news! Your school has grown to <strong>${actualStudentCount} students</strong>, exceeding your current tier limit of <strong>${org.tier_max_students} students</strong> (${org.tier_label || 'current tier'}).`,
                  'This is a wonderful milestone! To ensure you get the best pricing and service for your school size, we recommend upgrading your student count tier.',
                  'You can update your tier in your account billing settings.',
                ],
              });
              await sendEmailSafely(
                {
                  to: org.email,
                  subject: 'Managira: Congratulations on Your School Growth!',
                  html: congratsHtml,
                },
                'StudentTierExceeded'
              );
              // Mark as notified so we don't send again
              await db.query(
                'UPDATE organizations SET student_tier_exceeded_notified = true WHERE organization_id = $1',
                [org.organization_id]
              );
            }
          } catch (tierCheckErr) {
            // Non-critical — don't fail the billing cycle
          }
        }
        
      } else {
        const failureMessage = chargeRes.data?.message || 'Charge authorization failed.';

        await recordRenewalFailure({
          organizationId: org.organization_id,
          paymentFailureColumns,
        });

        await sendRenewalFailureNotification({
          email: org.email,
          organizationName: org.organization_name,
          amount: amount / 100,
          reason: failureMessage,
        });

        if (process.env.ADMIN_EMAIL && process.env.ADMIN_EMAIL !== org.email) {
          await sendRenewalFailureNotification({
            email: process.env.ADMIN_EMAIL,
            organizationName: org.organization_name,
            amount: amount / 100,
            reason: failureMessage,
          });
        }
      }
    } catch (err) {
      const failureMessage = err?.response?.data?.message || err.message || 'Charge request failed.';

      await recordRenewalFailure({
        organizationId: org.organization_id,
        paymentFailureColumns,
      });

      await sendRenewalFailureNotification({
        email: org.email,
        organizationName: org.organization_name,
        amount: amount / 100,
        reason: failureMessage,
      });

      if (process.env.ADMIN_EMAIL && process.env.ADMIN_EMAIL !== org.email) {
        await sendRenewalFailureNotification({
          email: process.env.ADMIN_EMAIL,
          organizationName: org.organization_name,
          amount: amount / 100,
          reason: failureMessage,
        });
      }
    }
  }
  
}

if (require.main === module) {
  runRecurringBilling().then(() => process.exit());
}

module.exports = runRecurringBilling;
