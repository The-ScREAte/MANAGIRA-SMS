let schemaReady = false;
let schemaPromise = null;

async function ensurePaymentProviderSchema(db) {
  if (schemaReady) return;
  if (schemaPromise) {
    await schemaPromise;
    return;
  }

  schemaPromise = (async () => {
    await db.query(`
      ALTER TABLE organizations
        ADD COLUMN IF NOT EXISTS billing_provider VARCHAR(20) NOT NULL DEFAULT 'paystack',
        ADD COLUMN IF NOT EXISTS stripe_customer_id VARCHAR(255)
    `);

    await db.query(`
      ALTER TABLE payments
        ADD COLUMN IF NOT EXISTS payment_provider VARCHAR(20) NOT NULL DEFAULT 'paystack',
        ADD COLUMN IF NOT EXISTS stripe_payment_intent_id VARCHAR(255)
    `);

    await db.query(`
      ALTER TABLE stored_cards
        ADD COLUMN IF NOT EXISTS provider VARCHAR(20) NOT NULL DEFAULT 'paystack'
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

module.exports = { ensurePaymentProviderSchema };