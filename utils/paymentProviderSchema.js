let schemaReady = false;
let schemaPromise = null;

let subaccountSchemaReady = false;
let subaccountSchemaPromise = null;

/**
 * Ensures paystack_subaccounts.account_type allows 'stripe_card'.
 * Safe to call multiple times — runs once per process lifetime.
 */
async function ensureStripeSubaccountSchema(db) {
  if (subaccountSchemaReady) return;
  if (subaccountSchemaPromise) {
    await subaccountSchemaPromise;
    return;
  }

  subaccountSchemaPromise = (async () => {
    // Drop old account_type constraint that only had 'bank','mobile_money'
    await db.query(`
      ALTER TABLE paystack_subaccounts
        DROP CONSTRAINT IF EXISTS paystack_subaccounts_account_type_check
    `);

    // Drop nullability cross-checks that would block stripe_card rows
    await db.query(`ALTER TABLE paystack_subaccounts DROP CONSTRAINT IF EXISTS bank_fields_null_for_momo`);
    await db.query(`ALTER TABLE paystack_subaccounts DROP CONSTRAINT IF EXISTS momo_fields_null_for_bank`);
    await db.query(`ALTER TABLE paystack_subaccounts DROP CONSTRAINT IF EXISTS bank_fields_check`);
    await db.query(`ALTER TABLE paystack_subaccounts DROP CONSTRAINT IF EXISTS momo_fields_check`);

    // New constraint: bank, mobile_money, stripe_card
    await db.query(`
      ALTER TABLE paystack_subaccounts
        ADD CONSTRAINT paystack_subaccounts_account_type_check
        CHECK (account_type IN ('bank', 'mobile_money', 'stripe_card'))
    `);

    // Restore bank fields check (enforced only for bank rows)
    await db.query(`
      ALTER TABLE paystack_subaccounts
        ADD CONSTRAINT bank_fields_check CHECK (
          (account_type = 'bank' AND account_number IS NOT NULL AND bank_code IS NOT NULL AND bank_name IS NOT NULL)
          OR account_type <> 'bank'
        )
    `);

    // Restore momo fields check (enforced only for mobile_money rows)
    await db.query(`
      ALTER TABLE paystack_subaccounts
        ADD CONSTRAINT momo_fields_check CHECK (
          (account_type = 'mobile_money' AND momo_number IS NOT NULL AND momo_provider IS NOT NULL AND account_holder_name IS NOT NULL)
          OR account_type <> 'mobile_money'
        )
    `);

    subaccountSchemaReady = true;
  })();

  try {
    await subaccountSchemaPromise;
  } finally {
    subaccountSchemaPromise = null;
  }
}

async function ensurePaymentProviderSchema(db) {
  if (schemaReady) return;
  if (schemaPromise) {
    await schemaPromise;
    return;
  }

  schemaPromise = (async () => {
    // PAYSTACK_DISABLED: default new rows to 'stripe' while Paystack is off.
    // Existing rows keep whatever value they had; we don't migrate data here.
    await db.query(`
      ALTER TABLE organizations
        ADD COLUMN IF NOT EXISTS billing_provider VARCHAR(20) NOT NULL DEFAULT 'stripe',
        ADD COLUMN IF NOT EXISTS stripe_customer_id VARCHAR(255)
    `);
    await db.query(`ALTER TABLE organizations ALTER COLUMN billing_provider SET DEFAULT 'stripe'`).catch(() => {});

    await db.query(`
      ALTER TABLE payments
        ADD COLUMN IF NOT EXISTS payment_provider VARCHAR(20) NOT NULL DEFAULT 'stripe',
        ADD COLUMN IF NOT EXISTS stripe_payment_intent_id VARCHAR(255)
    `);
    await db.query(`ALTER TABLE payments ALTER COLUMN payment_provider SET DEFAULT 'stripe'`).catch(() => {});

    await db.query(`
      ALTER TABLE stored_cards
        ADD COLUMN IF NOT EXISTS provider VARCHAR(20) NOT NULL DEFAULT 'stripe'
    `);
    await db.query(`ALTER TABLE stored_cards ALTER COLUMN provider SET DEFAULT 'stripe'`).catch(() => {});

    // Fallback order for Managira recurring billing.
    // NULL = not in fallback chain; lower number = tried sooner.
    // Primary card is always tried first regardless of this column.
    await db.query(`
      ALTER TABLE stored_cards
        ADD COLUMN IF NOT EXISTS fallback_order INT
    `);

    await db.query(`
      CREATE INDEX IF NOT EXISTS idx_organizations_billing_provider
        ON organizations(billing_provider)
    `);
    await db.query(`
      CREATE INDEX IF NOT EXISTS idx_payments_provider
        ON payments(payment_provider)
    `);
    await db.query(`
      CREATE INDEX IF NOT EXISTS idx_stored_cards_provider
        ON stored_cards(organization_id, provider, is_active)
    `);

    schemaReady = true;
  })();

  try {
    await schemaPromise;
  } finally {
    schemaPromise = null;
  }
}

module.exports = { ensurePaymentProviderSchema, ensureStripeSubaccountSchema };