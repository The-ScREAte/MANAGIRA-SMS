const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const recurringModulePath = path.resolve(__dirname, '../jobs/recurringPaystackBilling.js');
const dbModulePath = path.resolve(__dirname, '../config/db.js');
const paystackConfigModulePath = path.resolve(__dirname, '../utils/paystackConfig.js');
const emailHelperModulePath = path.resolve(__dirname, '../utils/emailHelper.js');
const axiosModulePath = require.resolve('axios');
const dotenvModulePath = require.resolve('dotenv');

function withMockedModules(mocks) {
  const replacements = new Map([
    [dbModulePath, mocks.db],
    [paystackConfigModulePath, mocks.paystackConfig],
    [emailHelperModulePath, mocks.emailHelper],
    [axiosModulePath, mocks.axios],
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
  const allOrgsRows = options.allOrgsRows || [];
  const planTotalCost = options.planTotalCost ?? 100;
  const studentCount = options.studentCount ?? 0;
  const billingPeriod = options.billingPeriod || { months: 1, discount_percentage: 0 };
  const tiers = options.tiers || [];
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

      if (sql.includes("SELECT value FROM app_settings WHERE key = 'billing_interval'")) {
        return { rows: [{ value: 'monthly' }] };
      }

      if (sql.includes('FROM organizations o') && sql.includes('JOIN payments p')) {
        return { rows: orgsDueRows };
      }

      if (sql.includes('LEFT JOIN payments p ON o.organization_id = p.organization_id')) {
        return { rows: allOrgsRows };
      }

      if (sql.includes('SELECT total_cost FROM plans WHERE id = $1')) {
        return { rows: [{ total_cost: planTotalCost }] };
      }

      if (sql.includes('SELECT COUNT(*) AS cnt FROM students WHERE organization_id = $1')) {
        return { rows: [{ cnt: String(studentCount) }] };
      }

      if (sql.includes('FROM plan_student_tiers')) {
        return { rows: tiers };
      }

      if (sql.includes('SELECT months, discount_percentage FROM billing_periods')) {
        return { rows: [billingPeriod] };
      }

      if (sql.includes('UPDATE organizations') && sql.includes('selected_student_tier_id = $1')) {
        return { rows: [] };
      }

      if (sql.includes('UPDATE organizations') && sql.includes('selected_student_tier_id = NULL')) {
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

      if (sql.includes('UPDATE organizations SET student_tier_exceeded_notified = true')) {
        return { rows: [] };
      }

      throw new Error(`Unhandled query: ${sql}`);
    },
  };

  const axios = {
    async post(url, payload) {
      charges.push({ url, payload });
      if (options.chargeError) {
        throw options.chargeError;
      }
      return options.chargeResponse || { data: { status: true } };
    },
  };

  const paystackConfig = {
    async getPaystackSettings() {
      return { activeSecretKey: 'test-secret' };
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

  return { queries, emails, charges, db, axios, paystackConfig, emailHelper };
}

test('recurring billing recalculates tier from live student count and resets failure tracking after a successful recharge', async () => {
  const originalAdminEmail = process.env.ADMIN_EMAIL;
  process.env.ADMIN_EMAIL = 'admin@example.com';

  const harness = createHarness({
    studentCount: 250,
    planTotalCost: 100,
    tiers: [
      { id: 1, label: 'Small', min_students: 0, max_students: 100, price_usd: 100, adjustment_percentage: 0 },
      { id: 2, label: 'Medium', min_students: 101, max_students: 300, price_usd: 150, adjustment_percentage: 50 },
    ],
    orgsDueRows: [
      {
        organization_id: 7,
        email: 'school@example.com',
        organization_name: 'School One',
        plan_id: 3,
        authorization_code: 'AUTH_123',
        next_payment_end_date: new Date('2026-04-01T00:00:00Z'),
        trial_active_until: null,
        billing_period_key: 'monthly',
        pending_plan_id: null,
        pending_plan_effective_date: null,
        selected_student_tier_id: 1,
        approx_student_count: 90,
        tier_price_usd: 100,
        tier_adjustment_percentage: 0,
        tier_max_students: 100,
        tier_label: 'Small',
        student_tier_exceeded_notified: false,
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

  const dueQuery = harness.queries.find((entry) => entry.sql.includes('JOIN payments p') && entry.sql.includes('WHERE'));
  assert.ok(dueQuery.sql.includes("COALESCE(p.failed_attempts, 0) < 4"));
  assert.ok(dueQuery.sql.includes("interval '4 days'"));

  assert.equal(harness.charges.length, 1);
  assert.equal(harness.charges[0].url, 'https://api.paystack.co/transaction/charge_authorization');
  assert.equal(harness.charges[0].payload.amount, 15000);
  assert.equal(harness.charges[0].payload.authorization_code, 'AUTH_123');

  const orgTierUpdate = harness.queries.find((entry) => entry.sql.includes('SET selected_student_tier_id = $1'));
  assert.deepEqual(orgTierUpdate.params, [2, 250, false, 7]);

  const paymentSuccessUpdate = harness.queries.find((entry) => entry.sql.includes("failed_attempts = 0"));
  assert.deepEqual(paymentSuccessUpdate.params, [150, 7]);

  assert.equal(harness.emails.length, 0);
});

test('recurring billing puts the organization on hold after the fourth failed charge attempt', async () => {
  const originalAdminEmail = process.env.ADMIN_EMAIL;
  process.env.ADMIN_EMAIL = 'admin@example.com';

  const harness = createHarness({
    studentCount: 40,
    planTotalCost: 80,
    failureAttemptsReturn: 4,
    tiers: [],
    chargeResponse: { data: { status: false, message: 'Card declined' } },
    orgsDueRows: [
      {
        organization_id: 11,
        email: 'billing@example.com',
        organization_name: 'Retry Academy',
        plan_id: 5,
        authorization_code: 'AUTH_FAIL',
        next_payment_end_date: new Date('2026-04-01T00:00:00Z'),
        trial_active_until: null,
        billing_period_key: 'monthly',
        pending_plan_id: null,
        pending_plan_effective_date: null,
        selected_student_tier_id: null,
        approx_student_count: 40,
        tier_price_usd: null,
        tier_adjustment_percentage: null,
        tier_max_students: null,
        tier_label: null,
        student_tier_exceeded_notified: false,
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
    tiers: [],
    orgsDueRows: [
      {
        organization_id: 21,
        email: 'trial@example.com',
        organization_name: 'Trial School',
        plan_id: 9,
        authorization_code: 'AUTH_TRIAL',
        next_payment_end_date: new Date('2026-04-01T00:00:00Z'),
        trial_active_until: new Date('2099-01-01T00:00:00Z'),
        billing_period_key: 'monthly',
        pending_plan_id: null,
        pending_plan_effective_date: null,
        selected_student_tier_id: null,
        approx_student_count: 60,
        tier_price_usd: null,
        tier_adjustment_percentage: null,
        tier_max_students: null,
        tier_label: null,
        student_tier_exceeded_notified: false,
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
  assert.equal(harness.emails.length, 0);

  const paymentUpdates = harness.queries.filter((entry) => entry.sql.includes('UPDATE payments'));
  assert.equal(paymentUpdates.length, 0);
});

test('recurring billing sends the growth notification when live student count exceeds the highest configured tier', async () => {
  const harness = createHarness({
    studentCount: 350,
    planTotalCost: 100,
    tiers: [
      { id: 1, label: 'Small', min_students: 0, max_students: 100, price_usd: 100, adjustment_percentage: 0 },
      { id: 2, label: 'Large', min_students: 101, max_students: 300, price_usd: 160, adjustment_percentage: 60 },
    ],
    orgsDueRows: [
      {
        organization_id: 31,
        email: 'growth@example.com',
        organization_name: 'Growth School',
        plan_id: 12,
        authorization_code: 'AUTH_GROWTH',
        next_payment_end_date: new Date('2026-04-01T00:00:00Z'),
        trial_active_until: null,
        billing_period_key: 'monthly',
        pending_plan_id: null,
        pending_plan_effective_date: null,
        selected_student_tier_id: 1,
        approx_student_count: 80,
        tier_price_usd: 100,
        tier_adjustment_percentage: 0,
        tier_max_students: 100,
        tier_label: 'Small',
        student_tier_exceeded_notified: false,
      },
    ],
  });

  const loader = withMockedModules(harness);

  try {
    await loader.runRecurringBilling();
  } finally {
    loader.restore();
  }

  assert.equal(harness.charges.length, 1);
  assert.equal(harness.charges[0].payload.amount, 16000);

  const growthEmail = harness.emails.find((entry) => entry.tag === 'StudentTierExceeded');
  assert.ok(growthEmail);
  assert.equal(growthEmail.payload.to, 'growth@example.com');
  assert.match(growthEmail.payload.html, /350 students/);
  assert.match(growthEmail.payload.html, /300 students/);

  const notifiedUpdate = harness.queries.find((entry) =>
    entry.sql.includes('UPDATE organizations SET student_tier_exceeded_notified = true')
  );
  assert.ok(notifiedUpdate);
  assert.deepEqual(notifiedUpdate.params, [31]);
});