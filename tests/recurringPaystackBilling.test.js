const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const recurringModulePath = path.resolve(__dirname, '../jobs/recurringStripeBilling.js');
const dbModulePath = path.resolve(__dirname, '../config/db.js');
const stripeConfigModulePath = path.resolve(__dirname, '../utils/stripeConfig.js');
const orgChargeCardsModulePath = path.resolve(__dirname, '../utils/orgChargeCards.js');
const dynamicPricingModulePath = path.resolve(__dirname, '../utils/dynamicPricing.js');
const paymentProviderSchemaModulePath = path.resolve(__dirname, '../utils/paymentProviderSchema.js');
const emailHelperModulePath = path.resolve(__dirname, '../utils/emailHelper.js');
const dotenvModulePath = require.resolve('dotenv');

function withMockedModules(mocks) {
  const replacements = new Map([
    [dbModulePath, mocks.db],
    [stripeConfigModulePath, mocks.stripeConfig],
    [orgChargeCardsModulePath, mocks.orgChargeCards],
    [dynamicPricingModulePath, mocks.dynamicPricing],
    [paymentProviderSchemaModulePath, mocks.paymentProviderSchema],
    [emailHelperModulePath, mocks.emailHelper],
    [dotenvModulePath, { config: () => ({ parsed: {} }) }],
  ]);
  const originals = new Map();

  for (const [modulePath, exportsValue] of replacements) {
    originals.set(modulePath, require.cache[modulePath]);
    require.cache[modulePath] = {
      id: modulePath,
      filename: modulePath,
      loaded: true,
      exports: exportsValue,
    };
  }

  delete require.cache[recurringModulePath];
  const runRecurringBilling = require(recurringModulePath);

  return {
    runRecurringBilling,
    restore() {
      delete require.cache[recurringModulePath];
      for (const [modulePath, original] of originals) {
        if (original) {
          require.cache[modulePath] = original;
        } else {
          delete require.cache[modulePath];
        }
      }
    },
  };
}

function createHarness(options = {}) {
  const queries = [];
  const emails = [];
  const charges = [];
  const orgsDueRows = options.orgsDueRows || [];
  const upcomingOrgsRows = options.upcomingOrgsRows || [];
  const allOrgsRows = options.allOrgsRows || [];
  const orgChargeCardsRows = options.orgChargeCardsRows || [];
  const planTotalCost = Number(options.planTotalCost ?? 100);
  const studentCount = Number(options.studentCount ?? 0);
  const failureAttemptsReturn = options.failureAttemptsReturn ?? 1;

  const db = {
    async query(sql, params = []) {
      queries.push({ sql, params });

      if (sql.includes('information_schema.columns')) {
        return {
          rows: [
            { column_name: 'failed_attempts' },
            { column_name: 'last_failed_payment' },
          ],
        };
      }

      if (sql.includes('ALTER TABLE organizations') || sql.includes('ALTER TABLE payments') || sql.includes('ALTER TABLE stored_cards')) {
        return { rows: [] };
      }

      if (sql.includes('CREATE INDEX IF NOT EXISTS idx_organizations_billing_provider')
        || sql.includes('CREATE INDEX IF NOT EXISTS idx_payments_provider')
        || sql.includes('CREATE INDEX IF NOT EXISTS idx_stored_cards_provider')) {
        return { rows: [] };
      }

      if (sql.includes('CREATE TABLE IF NOT EXISTS billing_invoices')
        || sql.includes('CREATE UNIQUE INDEX IF NOT EXISTS billing_invoices_unique_precharge_idx')) {
        return { rows: [] };
      }

      if (sql.includes('CREATE TABLE IF NOT EXISTS billing_retry_attempts')
        || sql.includes('CREATE INDEX IF NOT EXISTS billing_retry_attempts_org_created_idx')) {
        return { rows: [] };
      }

      if (sql.includes('INSERT INTO billing_retry_attempts')) {
        return { rows: [] };
      }

      if (sql.includes("SELECT value FROM app_settings WHERE key = 'billing_interval'")) {
        return { rows: [{ value: 'monthly' }] };
      }

      if (sql.includes("SELECT value FROM app_settings WHERE key = 'dynamic_term_divider'")) {
        return { rows: [{ value: '1' }] };
      }

      if (sql.includes('SELECT value FROM app_settings WHERE key = $1')) {
        return { rows: [] };
      }

      if (sql.includes('FROM dynamic_billing_cycles')) {
        return { rows: [] };
      }

      if (sql.includes('FROM organizations o') && sql.includes('JOIN payments p') && sql.includes("p.next_payment_end_date > NOW() + interval '23 hours'")) {
        return { rows: upcomingOrgsRows };
      }

      if (sql.includes('FROM organizations o') && sql.includes('JOIN payments p')) {
        return { rows: orgsDueRows };
      }

      if (sql.includes('LEFT JOIN payments p ON o.organization_id = p.organization_id')) {
        return { rows: allOrgsRows };
      }

      if (sql.includes('SELECT COUNT(*) AS cnt FROM students WHERE organization_id = $1')) {
        return { rows: [{ cnt: String(studentCount) }] };
      }

      if (sql.includes('SELECT pg_try_advisory_lock')) {
        return { rows: [{ locked: true }] };
      }

      if (sql.includes('SELECT pg_advisory_unlock')) {
        return { rows: [{ pg_advisory_unlock: true }] };
      }

      if (sql.includes('FROM payments') && sql.includes('ORDER BY created_at DESC')) {
        const orgId = Number(params[0]);
        const org = orgsDueRows.find((row) => Number(row.organization_id) === orgId);
        return {
          rows: [{
            status: 'active',
            next_payment_end_date: org?.next_payment_end_date || new Date('2026-04-01T00:00:00Z'),
          }],
        };
      }

      if (sql.includes('INSERT INTO billing_invoices')) {
        return { rows: [{ id: 1, email_sent_at: options.prechargeEmailSentAt || null }] };
      }

      if (sql.includes('UPDATE billing_invoices')) {
        return { rows: [] };
      }

      if (sql.includes('UPDATE organizations') && sql.includes('SET on_hold = true')) {
        return { rows: [] };
      }

      if (sql.includes('UPDATE payments') && sql.includes("status = 'active'")) {
        return { rows: [] };
      }

      if (sql.includes('UPDATE payments') && sql.includes('RETURNING COALESCE(failed_attempts, 0) AS failed_attempts')) {
        return { rows: [{ failed_attempts: failureAttemptsReturn }] };
      }

      throw new Error(`Unhandled query: ${sql}`);
    },
  };

  const stripeConfig = {
    getStripeChargeCurrency() {
      return 'usd';
    },
    async getStripeClient() {
      if (options.stripeClientError) {
        throw options.stripeClientError;
      }
      return {
        paymentIntents: {
          create: async (payload) => {
            charges.push({ payload });
            if (options.chargeError) throw options.chargeError;
            if (typeof options.chargeResolver === 'function') {
              return options.chargeResolver(payload);
            }
            return { id: `pi_${charges.length}`, status: 'succeeded' };
          },
        },
      };
    },
  };

  const orgChargeCards = {
    async getOrgChargeCards() {
      if (orgChargeCardsRows.length) return orgChargeCardsRows;
      return orgsDueRows
        .filter((row) => row.authorization_code)
        .map((row, index) => ({
          id: index + 1,
          authorization_code: row.authorization_code,
          provider: 'stripe',
          card_type: 'visa',
          last4: String(index + 1).padStart(4, '0'),
          exp_month: '12',
          exp_year: '30',
          is_primary: index === 0,
          fallback_order: index,
        }));
    },
  };

  const dynamicPricing = {
    async getRegionForCountry() {
      return { id: 1 };
    },
    async getBestPlanRegionPrice() {
      return {
        priceRow: { effective_amount: planTotalCost },
        region: { id: 1 },
        matchType: 'exact',
      };
    },
    async getPlanRegionPrice() {
      return { effective_amount: planTotalCost };
    },
    computeDynamicMonthlyPrice() {
      return { monthlyTotal: planTotalCost };
    },
    applyCycle(monthlyPrice, periodConfig = {}) {
      const months = Number(periodConfig.months) || 1;
      const discount = Number(periodConfig.discount_percentage) || 0;
      const gross = Number(monthlyPrice || 0) * months;
      return { months, finalTotal: gross * (1 - discount / 100) };
    },
  };

  const paymentProviderSchema = {
    async ensurePaymentProviderSchema() {
      return undefined;
    },
  };

  const emailHelper = {
    renderCleanEmail(payload) {
      return JSON.stringify(payload);
    },
    async sendEmailSafely(payload, tag) {
      emails.push({ payload, tag });
    },
  };

  return {
    queries,
    emails,
    charges,
    db,
    stripeConfig,
    orgChargeCards,
    dynamicPricing,
    paymentProviderSchema,
    emailHelper,
  };
}

test('recurring billing charges via stripe and resets failure tracking on success', async () => {
  const harness = createHarness({
    studentCount: 250,
    planTotalCost: 150,
    prechargeEmailSentAt: new Date(),
    orgsDueRows: [
      {
        organization_id: 7,
        email: 'school@example.com',
        organization_name: 'School One',
        plan_id: 3,
        authorization_code: 'pm_123',
        stripe_customer_id: 'cus_123',
        next_payment_end_date: new Date('2026-04-01T00:00:00Z'),
        trial_active_until: null,
        billing_period_key: 'monthly',
        pending_plan_id: null,
        pending_plan_effective_date: null,
      },
    ],
  });

  const loader = withMockedModules(harness);
  try {
    await loader.runRecurringBilling();
  } finally {
    loader.restore();
  }

  const dueQuery = harness.queries.find((entry) =>
    entry.sql.includes('JOIN payments p')
    && entry.sql.includes('COALESCE(p.failed_attempts, 0) < 4')
  );
  assert.ok(dueQuery.sql.includes("COALESCE(p.failed_attempts, 0) < 4"));
  assert.ok(dueQuery.sql.includes("interval '3 days'"));
  assert.ok(dueQuery.sql.includes('COALESCE(o.deleted, false) = false'));

  assert.equal(harness.charges.length, 1);
  assert.equal(harness.charges[0].payload.amount, 15000);
  assert.equal(harness.charges[0].payload.payment_method, 'pm_123');

  const paymentSuccessUpdate = harness.queries.find((entry) => entry.sql.includes("failed_attempts = 0"));
  assert.deepEqual(paymentSuccessUpdate.params, [150, 7]);
});

test('recurring billing puts organization on hold after the fourth failed charge attempt', async () => {
  const originalAdminEmail = process.env.ADMIN_EMAIL;
  process.env.ADMIN_EMAIL = 'admin@example.com';

  const harness = createHarness({
    studentCount: 40,
    planTotalCost: 80,
    failureAttemptsReturn: 4,
    prechargeEmailSentAt: new Date(),
    chargeResolver: async () => ({
      id: 'pi_fail_11',
      status: 'requires_payment_method',
      last_payment_error: { message: 'Card declined' },
    }),
    orgsDueRows: [
      {
        organization_id: 11,
        email: 'billing@example.com',
        organization_name: 'Retry Academy',
        plan_id: 5,
        authorization_code: 'pm_fail',
        stripe_customer_id: 'cus_fail_11',
        next_payment_end_date: new Date('2026-04-01T00:00:00Z'),
        trial_active_until: null,
        billing_period_key: 'monthly',
        pending_plan_id: null,
        pending_plan_effective_date: null,
      },
    ],
  });

  const loader = withMockedModules(harness);
  try {
    await loader.runRecurringBilling();
  } finally {
    loader.restore();
    process.env.ADMIN_EMAIL = originalAdminEmail;
  }

  assert.equal(harness.charges.length, 1);
  assert.equal(harness.charges[0].payload.amount, 8000);

  const failureUpdate = harness.queries.find((entry) => entry.sql.includes('RETURNING COALESCE(failed_attempts, 0) AS failed_attempts'));
  assert.deepEqual(failureUpdate.params, [11]);

  const holdUpdate = harness.queries.find((entry) => entry.sql.includes('SET on_hold = true'));
  assert.ok(holdUpdate);
  assert.deepEqual(holdUpdate.params, [11]);

  assert.equal(harness.emails.length, 2);
  assert.equal(harness.emails[0].payload.to, 'billing@example.com');
  assert.equal(harness.emails[1].payload.to, 'admin@example.com');
});

test('recurring billing skips charging organizations whose trial is still active', async () => {
  const harness = createHarness({
    studentCount: 60,
    planTotalCost: 80,
    prechargeEmailSentAt: new Date(),
    orgsDueRows: [
      {
        organization_id: 21,
        email: 'trial@example.com',
        organization_name: 'Trial School',
        plan_id: 9,
        authorization_code: 'pm_trial',
        stripe_customer_id: 'cus_trial_21',
        next_payment_end_date: new Date('2026-04-01T00:00:00Z'),
        trial_active_until: new Date('2099-01-01T00:00:00Z'),
        billing_period_key: 'monthly',
        pending_plan_id: null,
        pending_plan_effective_date: null,
      },
    ],
  });

  const loader = withMockedModules(harness);
  try {
    await loader.runRecurringBilling();
  } finally {
    loader.restore();
  }

  assert.equal(harness.charges.length, 0);
  const paymentUpdates = harness.queries.filter((entry) => entry.sql.includes('UPDATE payments'));
  assert.equal(paymentUpdates.length, 0);
});

test('recurring billing tries fallback cards in order until one succeeds', async () => {
  const harness = createHarness({
    studentCount: 120,
    planTotalCost: 100,
    prechargeEmailSentAt: new Date(),
    orgsDueRows: [
      {
        organization_id: 44,
        email: 'fallback@example.com',
        organization_name: 'Fallback School',
        plan_id: 2,
        stripe_customer_id: 'cus_fallback_44',
        next_payment_end_date: new Date('2026-04-01T00:00:00Z'),
        trial_active_until: null,
        billing_period_key: 'monthly',
        pending_plan_id: null,
        pending_plan_effective_date: null,
      },
    ],
    orgChargeCardsRows: [
      {
        id: 1,
        authorization_code: 'pm_fail_first',
        provider: 'stripe',
        card_type: 'visa',
        last4: '1111',
        exp_month: '12',
        exp_year: '30',
        is_primary: true,
        fallback_order: 0,
      },
      {
        id: 2,
        authorization_code: 'pm_success_second',
        provider: 'stripe',
        card_type: 'mastercard',
        last4: '2222',
        exp_month: '11',
        exp_year: '31',
        is_primary: false,
        fallback_order: 1,
      },
    ],
    chargeResolver: async (payload) => {
      if (payload.payment_method === 'pm_fail_first') {
        return {
          id: 'pi_fail_first',
          status: 'requires_payment_method',
          last_payment_error: { message: 'Primary declined' },
        };
      }
      return {
        id: 'pi_success_second',
        status: 'succeeded',
      };
    },
  });

  const loader = withMockedModules(harness);
  try {
    await loader.runRecurringBilling();
  } finally {
    loader.restore();
  }

  assert.equal(harness.charges.length, 2);
  assert.equal(harness.charges[0].payload.payment_method, 'pm_fail_first');
  assert.equal(harness.charges[1].payload.payment_method, 'pm_success_second');

  const paymentSuccessUpdate = harness.queries.find((entry) => entry.sql.includes("failed_attempts = 0"));
  assert.ok(paymentSuccessUpdate);
  assert.deepEqual(paymentSuccessUpdate.params, [100, 44]);
});

test('recurring billing creates upcoming precharge invoice and sends invoice email', async () => {
  const harness = createHarness({
    studentCount: 25,
    planTotalCost: 65,
    upcomingOrgsRows: [
      {
        organization_id: 63,
        email: 'finance@example.com',
        organization_name: 'Menis',
        plan_id: 2,
        organization_country: 'US',
        next_payment_end_date: new Date(Date.now() + 24 * 60 * 60 * 1000),
        trial_active_until: null,
        billing_period_key: 'monthly',
      },
    ],
    orgsDueRows: [],
  });

  const loader = withMockedModules(harness);
  try {
    await loader.runRecurringBilling();
  } finally {
    loader.restore();
  }

  const invoiceInsert = harness.queries.find((entry) => entry.sql.includes('INSERT INTO billing_invoices'));
  assert.ok(invoiceInsert);
  const upcomingQuery = harness.queries.find((entry) =>
    entry.sql.includes("p.next_payment_end_date > NOW() + interval '23 hours'")
  );
  assert.ok(upcomingQuery.sql.includes('COALESCE(o.deleted, false) = false'));
  assert.equal(harness.emails.length, 1);
  assert.equal(harness.emails[0].tag, 'RecurringSubscriptionInvoice');
  assert.equal(harness.emails[0].payload.to, 'finance@example.com');
});