// jobs/recurringStripeBilling.js
// Runs recurring subscription charges using Stripe off-session card billing.

const db = require('../config/db');
const { getStripeClient } = require('../utils/stripeConfig');
const { ensurePaymentProviderSchema } = require('../utils/paymentProviderSchema');
const { getOrgChargeCards } = require('../utils/orgChargeCards');
const {
  normalizeCurrencyCode,
  getUsdRate,
} = require('../utils/currencyLocalization');
const {
  computeDynamicMonthlyPrice,
  applyCycle,
  getRegionForCountry,
  getBestPlanRegionPrice,
} = require('../utils/dynamicPricing');
const { sendEmailSafely, renderCleanEmail } = require('../utils/emailHelper');
require('dotenv').config();

// Total failed attempts allowed before hold: 1 initial failure + 3 retries.
const MAX_FAILED_RETRY_ATTEMPTS = 4;
const MS_PER_DAY = 24 * 60 * 60 * 1000;
const fallbackPlanMonthlyCache = new Map();

function getRetryDelayDaysForAttempt(attemptNumber) {
  const attempt = Number(attemptNumber || 0);
  if (!Number.isInteger(attempt) || attempt <= 0) return null;
  if (attempt === 1) return 1;
  if (attempt < MAX_FAILED_RETRY_ATTEMPTS) return 2;
  return null;
}

function buildRetryCooldownSqlClause(failedAttemptsExpr) {
  return `(CASE WHEN ${failedAttemptsExpr} <= 1 THEN interval '1 day' ELSE interval '2 days' END)`;
}

async function getFallbackPlanMonthlyUsd(planId) {
  const normalizedPlanId = Number(planId || 0);
  if (!Number.isInteger(normalizedPlanId) || normalizedPlanId <= 0) return 0;
  if (fallbackPlanMonthlyCache.has(normalizedPlanId)) {
    return Number(fallbackPlanMonthlyCache.get(normalizedPlanId) || 0);
  }

  const result = await db.query(
    `SELECT p.id,
            p.total_cost,
            COALESCE(SUM(f.price_usd), 0) AS feature_sum
       FROM plans p
       LEFT JOIN plan_features pf ON pf.plan_id = p.id
       LEFT JOIN features f ON f.id = pf.feature_id
      WHERE p.id = $1
      GROUP BY p.id, p.total_cost
      LIMIT 1`,
    [normalizedPlanId]
  );

  const row = result.rows?.[0] || null;
  const featureSum = Number(row?.feature_sum || 0);
  const totalCost = Number(row?.total_cost || 0);
  const fallback = featureSum > 0 ? featureSum : totalCost;

  fallbackPlanMonthlyCache.set(normalizedPlanId, fallback);
  return fallback;
}

function resolveStripeChargeCurrencyForOrganization(organizationCountry, organizationCurrency = null) {
  // Recurring subscription renewals are charged in USD only.
  // Organization/country currencies remain display preferences.
  return 'USD';
}

async function convertUsdAmountToCurrency(usdAmount, targetCurrency) {
  const amountUsd = Number(usdAmount || 0);
  const normalizedTarget = normalizeCurrencyCode(targetCurrency) || 'USD';

  if (!(amountUsd > 0)) return 0;
  if (normalizedTarget === 'USD') return amountUsd;

  const rate = Number(await getUsdRate(normalizedTarget));
  if (!(rate > 0)) return amountUsd;

  return amountUsd * rate;
}

async function ensureBillingInvoiceSchema() {
  await db.query(`
    CREATE TABLE IF NOT EXISTS billing_invoices (
      id BIGSERIAL PRIMARY KEY,
      organization_id BIGINT NOT NULL,
      invoice_number TEXT,
      invoice_type TEXT NOT NULL DEFAULT 'precharge',
      status TEXT NOT NULL DEFAULT 'issued',
      amount_due NUMERIC(12, 2) NOT NULL DEFAULT 0,
      currency TEXT NOT NULL DEFAULT 'USD',
      billing_period_key TEXT,
      scheduled_charge_at TIMESTAMPTZ,
      email_sent_at TIMESTAMPTZ,
      paid_at TIMESTAMPTZ,
      failed_at TIMESTAMPTZ,
      payment_intent_id TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);

  await db.query(`
    CREATE UNIQUE INDEX IF NOT EXISTS billing_invoices_unique_precharge_idx
    ON billing_invoices (organization_id, invoice_type, scheduled_charge_at)
  `);
}

async function ensureBillingRetryAttemptSchema() {
  await db.query(`
    CREATE TABLE IF NOT EXISTS billing_retry_attempts (
      id BIGSERIAL PRIMARY KEY,
      organization_id BIGINT NOT NULL,
      attempt_number INTEGER,
      max_attempts INTEGER NOT NULL DEFAULT 4,
      charge_status TEXT NOT NULL,
      amount_due NUMERIC(12, 2) NOT NULL DEFAULT 0,
      currency TEXT NOT NULL DEFAULT 'USD',
      failure_reason TEXT,
      payment_intent_id TEXT,
      email_to_school TEXT,
      email_to_school_sent BOOLEAN,
      email_to_admin TEXT,
      email_to_admin_sent BOOLEAN,
      next_retry_at TIMESTAMPTZ,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);

  await db.query(`
    CREATE INDEX IF NOT EXISTS billing_retry_attempts_org_created_idx
    ON billing_retry_attempts (organization_id, created_at DESC)
  `);
}

async function logBillingRetryAttempt({
  organizationId,
  attemptNumber,
  chargeStatus,
  amountDue,
  currency,
  failureReason,
  paymentIntentId,
  emailToSchool,
  emailToSchoolSent,
  emailToAdmin,
  emailToAdminSent,
  nextRetryAt,
}) {
  await db.query(
    `INSERT INTO billing_retry_attempts (
       organization_id,
       attempt_number,
       max_attempts,
       charge_status,
       amount_due,
       currency,
       failure_reason,
       payment_intent_id,
       email_to_school,
       email_to_school_sent,
       email_to_admin,
       email_to_admin_sent,
       next_retry_at
     ) VALUES (
       $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13
     )`,
    [
      organizationId,
      Number.isInteger(Number(attemptNumber)) ? Number(attemptNumber) : null,
      MAX_FAILED_RETRY_ATTEMPTS,
      chargeStatus,
      Number(amountDue || 0),
      String(currency || 'USD').toUpperCase(),
      failureReason || null,
      paymentIntentId || null,
      emailToSchool || null,
      typeof emailToSchoolSent === 'boolean' ? emailToSchoolSent : null,
      emailToAdmin || null,
      typeof emailToAdminSent === 'boolean' ? emailToAdminSent : null,
      nextRetryAt || null,
    ]
  );
}

function buildPrechargeInvoiceNumber(organizationId, scheduledChargeAt) {
  const d = new Date(scheduledChargeAt || Date.now());
  const safeDate = Number.isNaN(d.getTime()) ? new Date() : d;
  const yyyy = safeDate.getUTCFullYear();
  const mm = String(safeDate.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(safeDate.getUTCDate()).padStart(2, '0');
  const hh = String(safeDate.getUTCHours()).padStart(2, '0');
  const min = String(safeDate.getUTCMinutes()).padStart(2, '0');
  const orgSegment = String(Number(organizationId || 0)).padStart(4, '0');
  return `MGI-${yyyy}${mm}${dd}-${orgSegment}-${hh}${min}`;
}

async function upsertPrechargeInvoiceRecord({
  organizationId,
  scheduledChargeAt,
  amountDue,
  currency,
  billingPeriodKey,
}) {
  const scheduledAt = new Date(scheduledChargeAt || Date.now());
  const invoiceNumber = buildPrechargeInvoiceNumber(organizationId, scheduledAt);

  const upsertResult = await db.query(
    `INSERT INTO billing_invoices (
       organization_id,
       invoice_number,
       invoice_type,
       status,
       amount_due,
       currency,
       billing_period_key,
       scheduled_charge_at
     ) VALUES ($1, $2, 'precharge', 'issued', $3, $4, $5, $6)
     ON CONFLICT (organization_id, invoice_type, scheduled_charge_at)
     DO UPDATE SET
       amount_due = EXCLUDED.amount_due,
       currency = EXCLUDED.currency,
       billing_period_key = EXCLUDED.billing_period_key,
       updated_at = NOW()
     RETURNING id, email_sent_at, status`,
    [
      organizationId,
      invoiceNumber,
      Number(amountDue || 0),
      String(currency || 'usd').toUpperCase(),
      billingPeriodKey || 'monthly',
      scheduledAt,
    ]
  );

  const row = upsertResult.rows[0] || null;
  if (!row) return null;

  return {
    id: row.id,
    invoiceNumber,
    emailSentAt: row.email_sent_at || null,
    status: row.status || null,
    scheduledChargeAt: scheduledAt,
  };
}

async function sendUpcomingInvoiceNotification({
  email,
  organizationName,
  invoiceNumber,
  amount,
  currency,
  chargeDate,
  cycleLabel,
}) {
  if (!email) return;

  const humanChargeDate = new Date(chargeDate).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });

  const html = renderCleanEmail({
    title: 'Upcoming Subscription Invoice',
    greeting: `Hello <strong>${organizationName || 'Managira User'}</strong>,`,
    paragraphs: [
      'Your next subscription invoice has been generated and your saved billing card will be charged automatically in about 1 day.',
      `Invoice ${invoiceNumber}: ${currency.toUpperCase()} ${Number(amount || 0).toFixed(2)} for ${cycleLabel || 'your current billing cycle'}.`,
      `Scheduled charge date: ${humanChargeDate}.`,
    ],
    note: 'You can review invoices anytime in Settings > Billing & Plan.',
  });

  await sendEmailSafely(
    {
      to: email,
      subject: `Managira Invoice ${invoiceNumber}`,
      html,
    },
    'RecurringSubscriptionInvoice'
  );
}

async function getOrganizationStudentCount(organizationId) {
  const countRes = await db.query(
    'SELECT COUNT(*) AS cnt FROM students WHERE organization_id = $1',
    [organizationId]
  );

  return parseInt(countRes.rows[0]?.cnt, 10) || 0;
}

async function getDynamicTermDivider() {
  try {
    const result = await db.query(
      "SELECT value FROM app_settings WHERE key = 'dynamic_term_divider' LIMIT 1"
    );
    const parsed = parseInt(result.rows?.[0]?.value, 10);
    return Number.isInteger(parsed) && parsed > 0 ? parsed : 1;
  } catch (_) {
    return 1;
  }
}

async function getDynamicRegionTermMonths(regionId, fallback = 1) {
  if (!Number.isInteger(Number(regionId))) {
    return Math.max(1, Number(fallback) || 1);
  }

  try {
    const result = await db.query(
      'SELECT value FROM app_settings WHERE key = $1 LIMIT 1',
      [`dynamic_region_term_months_${Number(regionId)}`]
    );
    const parsed = parseInt(result.rows?.[0]?.value, 10);
    return Number.isInteger(parsed) && parsed > 0 ? parsed : Math.max(1, Number(fallback) || 1);
  } catch (_) {
    return Math.max(1, Number(fallback) || 1);
  }
}

async function resolveBillingCycle(periodKey) {
  const key = String(periodKey || 'monthly').trim() || 'monthly';

  try {
    const dynamic = await db.query(
      `SELECT cycle_key AS period_key, label, months, discount_percentage
       FROM dynamic_billing_cycles
       WHERE cycle_key = $1 AND is_active = TRUE
       LIMIT 1`,
      [key]
    );

    if (dynamic.rows.length) {
      return {
        period_key: dynamic.rows[0].period_key,
        label: dynamic.rows[0].label,
        months: Number(dynamic.rows[0].months) || 1,
        discount_percentage: Number(dynamic.rows[0].discount_percentage) || 0,
      };
    }
  } catch (_) {
  }

  return {
    period_key: 'monthly',
    label: 'Monthly',
    months: 1,
    discount_percentage: 0,
  };
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
      `We could not process your automatic renewal charge of ${Number(amount || 0).toFixed(2)}.`,
      reason ? `Payment gateway response: ${reason}` : 'Your card may have insufficient funds or the authorization is no longer valid.',
      'Please update your card details in billing settings to resume successful renewals.',
    ],
  });

  return sendEmailSafely(
    {
      to: email,
      subject: 'Managira: Renewal Payment Failed',
      html,
    },
    'RecurringSubscriptionFailure'
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

async function createAndSendPrechargeInvoices() {
  const upcomingOrgs = await db.query(`
    SELECT o.organization_id, o.email, o.organization_name, o.plan_id, o.organization_country, o.organization_currency,
           o.trial_active_until,
           p.next_payment_end_date,
           COALESCE(p.billing_period_key, 'monthly') AS billing_period_key
    FROM organizations o
    JOIN payments p ON o.organization_id = p.organization_id
    WHERE p.status IN ('active', 'failed')
      AND COALESCE(o.deleted, false) = false
      AND o.on_hold = false
      AND o.scheduled_hold_date IS NULL
      AND NOT (COALESCE(o.is_hub_member, false) = true AND o.hub_id IS NOT NULL)
      AND p.next_payment_end_date > NOW()
      AND p.next_payment_end_date <= NOW() + interval '25 hours'
      AND (o.trial_active_until IS NULL OR o.trial_active_until <= p.next_payment_end_date)
      AND EXISTS (
        SELECT 1 FROM stored_cards c
         WHERE c.organization_id = o.organization_id
           AND c.is_active = true
           AND c.provider = 'stripe'
      )
  `);

  for (const org of upcomingOrgs.rows) {
    try {
      const actualStudentCount = await getOrganizationStudentCount(org.organization_id);
      const dynamicTermDivider = await getDynamicTermDivider();
      const region = await getRegionForCountry(db, org.organization_country || null);
      const pricingMatch = await getBestPlanRegionPrice(
        db,
        Number(org.plan_id),
        Number(region?.id || 0) || null
      );

      let monthlyPrice = 0;
      if (pricingMatch?.priceRow) {
        const resolvedRegion = pricingMatch.region || region;
        const monthsPerTerm = await getDynamicRegionTermMonths(
          Number(resolvedRegion?.id || region?.id || 0),
          dynamicTermDivider
        );
        const monthly = computeDynamicMonthlyPrice(pricingMatch.priceRow, actualStudentCount, {
          termDivider: monthsPerTerm,
        });
        monthlyPrice = Number(monthly?.monthlyTotal || 0);
      } else {
        monthlyPrice = await getFallbackPlanMonthlyUsd(org.plan_id);
      }
      if (!(monthlyPrice > 0)) continue;

      const periodConfig = await resolveBillingCycle(org.billing_period_key || 'monthly');
      const cycleBreakdown = applyCycle(monthlyPrice, periodConfig);
      const chargeAmountUsd = Number(cycleBreakdown.finalTotal || 0);
      const chargeCurrency = resolveStripeChargeCurrencyForOrganization(
        org.organization_country,
        org.organization_currency || null
      );
      const chargeAmount = await convertUsdAmountToCurrency(chargeAmountUsd, chargeCurrency);

      const invoiceRecord = await upsertPrechargeInvoiceRecord({
        organizationId: org.organization_id,
        scheduledChargeAt: org.next_payment_end_date,
        amountDue: chargeAmount,
        currency: chargeCurrency,
        billingPeriodKey: org.billing_period_key || 'monthly',
      });

      if (!invoiceRecord || invoiceRecord.emailSentAt) {
        continue;
      }

      await sendUpcomingInvoiceNotification({
        email: org.email,
        organizationName: org.organization_name,
        invoiceNumber: invoiceRecord.invoiceNumber,
        amount: chargeAmount,
        currency: String(chargeCurrency || 'usd').toUpperCase(),
        chargeDate: invoiceRecord.scheduledChargeAt,
        cycleLabel: periodConfig.label || org.billing_period_key || 'Monthly',
      });

      await db.query(
        `UPDATE billing_invoices
         SET status = 'email_sent',
             email_sent_at = NOW(),
             updated_at = NOW()
         WHERE id = $1`,
        [invoiceRecord.id]
      );
    } catch (_) {
      // Continue invoice generation for other organizations.
    }
  }
}

async function runRecurringBilling() {
  await ensurePaymentProviderSchema(db);
  await ensureBillingInvoiceSchema();
  await ensureBillingRetryAttemptSchema();
  let stripe = null;
  try {
    stripe = await getStripeClient(db);
  } catch (_) {
    stripe = null;
  }
  const paymentFailureColumns = await getPaymentsFailureColumns();
  await createAndSendPrechargeInvoices();
  const retryStatusClause = paymentFailureColumns.hasFailedAttempts && paymentFailureColumns.hasLastFailedPayment
    ? `(p.status = 'active' OR (p.status = 'failed' AND COALESCE(p.failed_attempts, 0) < ${MAX_FAILED_RETRY_ATTEMPTS} AND (p.last_failed_payment IS NULL OR p.last_failed_payment <= NOW() - ${buildRetryCooldownSqlClause('COALESCE(p.failed_attempts, 0)')})))`
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
      SELECT o.organization_id, o.email, o.organization_name, o.plan_id, p.next_payment_end_date, o.trial_active_until,
        o.organization_country, o.organization_currency,
        COALESCE(o.billing_provider, 'stripe') AS billing_provider,
        o.stripe_customer_id,
           COALESCE(p.billing_period_key, 'monthly') AS billing_period_key,
           o.pending_plan_id, o.pending_plan_effective_date,
           CASE 
             WHEN o.trial_active_until IS NULL THEN 'No Trial'
             WHEN o.trial_active_until > NOW() THEN 'Trial Active'
             ELSE 'Trial Expired'
           END as trial_status
    FROM organizations o
    JOIN payments p ON o.organization_id = p.organization_id
    WHERE ${retryStatusClause}
      AND COALESCE(o.deleted, false) = false
      AND o.on_hold = false
      AND o.scheduled_hold_date IS NULL
      AND NOT (COALESCE(o.is_hub_member, false) = true AND o.hub_id IS NOT NULL)
      AND p.next_payment_end_date <= NOW()
      AND (o.trial_active_until IS NULL OR o.trial_active_until < NOW())
      AND EXISTS (
        SELECT 1 FROM stored_cards c
         WHERE c.organization_id = o.organization_id
           AND c.is_active = true
           AND c.provider = 'stripe'
      )
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
    const lockKey = `recurring_subscription_charge:${org.organization_id}`;
    const lockResult = await db.query(
      'SELECT pg_try_advisory_lock(hashtext($1)) AS locked',
      [lockKey]
    );
    if (!lockResult.rows[0]?.locked) {
      continue;
    }

    try {
      // Re-check due-state inside the lock to avoid double charging from concurrent workers.
      const latestPaymentResult = await db.query(
        `SELECT status, next_payment_end_date
         FROM payments
         WHERE organization_id = $1
         ORDER BY created_at DESC
         LIMIT 1`,
        [org.organization_id]
      );
      const latestPayment = latestPaymentResult.rows[0];
      if (!latestPayment) {
        continue;
      }
      const latestStatus = String(latestPayment.status || '').toLowerCase();
      const allowedStatus = latestStatus === 'active' || latestStatus === 'failed';
      const stillDue = latestPayment.next_payment_end_date
        ? new Date(latestPayment.next_payment_end_date) <= new Date()
        : false;
      if (!allowedStatus || !stillDue) {
        continue;
      }
    
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
    
      // 2. Compute dynamic real-time monthly price from region+plan row and current student count.
      const actualStudentCount = await getOrganizationStudentCount(org.organization_id);
      const dynamicTermDivider = await getDynamicTermDivider();
      const region = await getRegionForCountry(db, org.organization_country || null);
      const pricingMatch = await getBestPlanRegionPrice(
        db,
        Number(org.plan_id),
        Number(region?.id || 0) || null
      );

      let monthlyPrice = 0;
      if (pricingMatch?.priceRow) {
        const resolvedRegion = pricingMatch.region || region;
        const monthsPerTerm = await getDynamicRegionTermMonths(
          Number(resolvedRegion?.id || region?.id || 0),
          dynamicTermDivider
        );
        const monthly = computeDynamicMonthlyPrice(pricingMatch.priceRow, actualStudentCount, {
          termDivider: monthsPerTerm,
        });
        monthlyPrice = Number(monthly?.monthlyTotal || 0);
      } else {
        monthlyPrice = await getFallbackPlanMonthlyUsd(org.plan_id);
      }

      if (!(monthlyPrice > 0)) {
        continue;
      }

      const periodConfig = await resolveBillingCycle(org.billing_period_key || 'monthly');
      const cycleBreakdown = applyCycle(monthlyPrice, periodConfig);
      const periodMonths = Number(cycleBreakdown.months) || 1;
      const chargeAmountUsd = Number(cycleBreakdown.finalTotal || 0);
      const stripeChargeCurrency = String(
        resolveStripeChargeCurrencyForOrganization(
          org.organization_country,
          org.organization_currency || null
        )
      ).toLowerCase();
      const chargeAmount = await convertUsdAmountToCurrency(chargeAmountUsd, stripeChargeCurrency);
      const amount = Math.round(chargeAmount * 100); // minor units in charge currency

      let dueInvoiceRecord = null;
      try {
        dueInvoiceRecord = await upsertPrechargeInvoiceRecord({
          organizationId: org.organization_id,
          scheduledChargeAt: org.next_payment_end_date,
          amountDue: chargeAmount,
          currency: stripeChargeCurrency,
          billingPeriodKey: org.billing_period_key || 'monthly',
        });
      } catch (invoiceErr) {
        console.warn(
          `[RecurringBilling] invoice upsert failed for org ${org.organization_id}; skipping charge this run: ${invoiceErr.message || invoiceErr}`
        );
        continue;
      }

      if (!dueInvoiceRecord?.id) {
        continue;
      }

      // 3. Charge via Stripe using saved cards (primary first, then fallbacks)
      let chargeRes = null;
      let chargeCard = null;
      let lastFailureMessage = null;
      let cardsTriedCount = 0;
      let chargeError = null;
      try {
        if (!stripe || !org.stripe_customer_id) {
          throw new Error('Stripe is not configured for recurring charges.');
        }

        const orgCards = await getOrgChargeCards(db, org.organization_id, 'stripe');
        if (!orgCards.length) {
          throw new Error('No active card on file for this organization.');
        }

        for (const card of orgCards) {
          cardsTriedCount += 1;
          try {
            const dueIso = org.next_payment_end_date
              ? new Date(org.next_payment_end_date).toISOString().slice(0, 19)
              : 'no_due_date';
            const cardToken = String(card.authorization_code || `card_${cardsTriedCount}`).slice(-24);
            const idempotencyKey = `renew:${org.organization_id}:${dueIso}:${amount}:${cardToken}`;

            const paymentIntent = await stripe.paymentIntents.create({
              amount,
              currency: stripeChargeCurrency,
              customer: org.stripe_customer_id,
              payment_method: card.authorization_code,
              confirm: true,
              off_session: true,
              metadata: {
                flow: 'recurring_renewal',
                organization_id: String(org.organization_id),
                billing_period_key: org.billing_period_key || 'monthly',
                charge_currency: stripeChargeCurrency,
                card_position: String(cardsTriedCount),
                is_primary_card: String(Boolean(card.is_primary)),
              },
            }, {
              idempotencyKey,
            });

            const attemptRes = {
              data: {
                status: paymentIntent.status === 'succeeded',
                message: paymentIntent.last_payment_error?.message || null,
                paymentIntentId: paymentIntent.id || null,
              },
            };

            if (attemptRes.data?.status) {
              chargeRes = attemptRes;
              chargeCard = card;
              // Remember which card succeeded on the row (for downstream reporting/auditing).
              org.authorization_code = card.authorization_code;
              break;
            }
            lastFailureMessage = attemptRes.data?.message || lastFailureMessage || 'Charge declined.';
            console.warn(
              `[RecurringBilling] charge declined for org ${org.organization_id} on card ${cardsTriedCount}/${orgCards.length} (last4=${card.last4 || '????'}): ${lastFailureMessage}`
            );
          } catch (perCardErr) {
            lastFailureMessage = perCardErr?.response?.data?.message || perCardErr.message || lastFailureMessage || 'Charge request failed.';
            console.warn(
              `[RecurringBilling] charge errored for org ${org.organization_id} on card ${cardsTriedCount}/${orgCards.length} (last4=${card.last4 || '????'}): ${lastFailureMessage}`
            );
            // continue to the next card in the fallback chain
          }
        }

        if (!chargeRes || !chargeRes.data?.status) {
          // All fallback cards exhausted — synthesize a failure response so the existing
          // failure-handling branch below runs (record failure, email, on-hold logic).
          chargeRes = { data: { status: false, message: lastFailureMessage || 'All saved cards failed.' } };
        }
      } catch (outerErr) {
        chargeError = outerErr;
      }

      try {
        if (chargeError) throw chargeError;
      
        if (chargeRes.data.status) {
        // 4. Update payment record — prefer selected dynamic cycle months;
        // fallback to global interval only for single-month cycles.
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
                 WHERE organization_id = $2
                   AND next_payment_end_date <= NOW()`
              : `UPDATE payments
                 SET amount_paid = $1,
                     next_payment_end_date = ${nextPaymentDate},
                     status = 'active'
                 WHERE organization_id = $2
                   AND next_payment_end_date <= NOW()`,
            [chargeAmountUsd, org.organization_id]
          );

          await db.query(
            `UPDATE billing_invoices
             SET status = 'paid',
                 paid_at = NOW(),
                 failed_at = NULL,
                 payment_intent_id = COALESCE($2, payment_intent_id),
                 updated_at = NOW()
             WHERE id = $1`,
            [dueInvoiceRecord.id, chargeRes.data?.paymentIntentId || null]
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

        } else {
          const failureMessage = chargeRes.data?.message || 'Charge authorization failed.';

          await db.query(
            `UPDATE billing_invoices
             SET status = 'failed',
                 failed_at = NOW(),
                 updated_at = NOW()
             WHERE id = $1`,
            [dueInvoiceRecord.id]
          );

          const failedAttempts = await recordRenewalFailure({
            organizationId: org.organization_id,
            paymentFailureColumns,
          });

          const schoolEmailSent = await sendRenewalFailureNotification({
            email: org.email,
            organizationName: org.organization_name,
            amount: amount / 100,
            reason: failureMessage,
          });

          let adminEmailSent = null;
          if (process.env.ADMIN_EMAIL && process.env.ADMIN_EMAIL !== org.email) {
            adminEmailSent = await sendRenewalFailureNotification({
              email: process.env.ADMIN_EMAIL,
              organizationName: org.organization_name,
              amount: amount / 100,
              reason: failureMessage,
            });
          }

          const retryDelayDays = getRetryDelayDaysForAttempt(failedAttempts);
          const nextRetryAt = typeof retryDelayDays === 'number' && retryDelayDays > 0
            ? new Date(Date.now() + Number(retryDelayDays) * MS_PER_DAY)
            : null;

          await logBillingRetryAttempt({
            organizationId: org.organization_id,
            attemptNumber: failedAttempts,
            chargeStatus: 'failed',
            amountDue: chargeAmount,
            currency: stripeChargeCurrency,
            failureReason: failureMessage,
            paymentIntentId: chargeRes.data?.paymentIntentId || null,
            emailToSchool: org.email,
            emailToSchoolSent: Boolean(schoolEmailSent),
            emailToAdmin: process.env.ADMIN_EMAIL || null,
            emailToAdminSent: adminEmailSent,
            nextRetryAt,
          });
        }
      } catch (err) {
        const failureMessage = err?.response?.data?.message || err.message || 'Charge request failed.';

        await db.query(
          `UPDATE billing_invoices
           SET status = 'failed',
               failed_at = NOW(),
               updated_at = NOW()
           WHERE id = $1`,
          [dueInvoiceRecord.id]
        );

        const failedAttempts = await recordRenewalFailure({
          organizationId: org.organization_id,
          paymentFailureColumns,
        });

        const schoolEmailSent = await sendRenewalFailureNotification({
          email: org.email,
          organizationName: org.organization_name,
          amount: amount / 100,
          reason: failureMessage,
        });

        let adminEmailSent = null;
        if (process.env.ADMIN_EMAIL && process.env.ADMIN_EMAIL !== org.email) {
          adminEmailSent = await sendRenewalFailureNotification({
            email: process.env.ADMIN_EMAIL,
            organizationName: org.organization_name,
            amount: amount / 100,
            reason: failureMessage,
          });
        }

        const retryDelayDays = getRetryDelayDaysForAttempt(failedAttempts);
        const nextRetryAt = typeof retryDelayDays === 'number' && retryDelayDays > 0
          ? new Date(Date.now() + Number(retryDelayDays) * MS_PER_DAY)
          : null;

        await logBillingRetryAttempt({
          organizationId: org.organization_id,
          attemptNumber: failedAttempts,
          chargeStatus: 'failed',
          amountDue: chargeAmount,
          currency: stripeChargeCurrency,
          failureReason: failureMessage,
          paymentIntentId: null,
          emailToSchool: org.email,
          emailToSchoolSent: Boolean(schoolEmailSent),
          emailToAdmin: process.env.ADMIN_EMAIL || null,
          emailToAdminSent: adminEmailSent,
          nextRetryAt,
        });
      }
    } finally {
      await db.query('SELECT pg_advisory_unlock(hashtext($1))', [lockKey]);
    }
  }
  
}

if (require.main === module) {
  runRecurringBilling().then(() => process.exit());
}

module.exports = runRecurringBilling;
