// utils/payoutSchema.js
// Schema for the "Payouts" feature (Settings → Payouts): lets a school
// schedule one-time or recurring payments to a person (an existing Managira
// user, e.g. a teacher, or an external payee) charged against a card the
// school already saved (the same `stored_cards` pool used for subscription
// billing — see utils/orgChargeCards.js). Charging happens off-session via
// Stripe/Paystack depending on the card's provider; no money is transferred
// to the recipient's bank by Managira — the recipient is emailed a receipt.

let _payoutSchemaReady = false;

async function ensurePayoutSchema(db) {
  if (_payoutSchemaReady) return;

  await db.query(`
    CREATE TABLE IF NOT EXISTS org_payouts (
      payout_id SERIAL PRIMARY KEY,
      organization_id INT NOT NULL REFERENCES organizations(organization_id) ON DELETE CASCADE,
      name VARCHAR(160) NOT NULL,
      amount NUMERIC(12,2) NOT NULL CHECK (amount > 0),
      currency VARCHAR(10) NOT NULL DEFAULT 'USD',
      recipient_user_id INT REFERENCES users(user_id) ON DELETE SET NULL,
      recipient_name VARCHAR(160) NOT NULL,
      recipient_email VARCHAR(255) NOT NULL,
      card_id INT NOT NULL REFERENCES stored_cards(id) ON DELETE RESTRICT,
      frequency VARCHAR(20) NOT NULL DEFAULT 'once',
      start_date DATE NOT NULL,
      end_date DATE,
      next_run_at TIMESTAMPTZ,
      last_run_at TIMESTAMPTZ,
      status VARCHAR(20) NOT NULL DEFAULT 'active',
      last_error TEXT,
      created_by INT REFERENCES users(user_id) ON DELETE SET NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      CONSTRAINT org_payouts_frequency_check
        CHECK (frequency IN ('once', 'weekly', 'biweekly', 'monthly')),
      CONSTRAINT org_payouts_status_check
        CHECK (status IN ('active', 'paused', 'cancelled', 'completed'))
    )
  `);

  await db.query(`
    CREATE INDEX IF NOT EXISTS idx_org_payouts_org
    ON org_payouts(organization_id, status)
  `);

  await db.query(`
    CREATE INDEX IF NOT EXISTS idx_org_payouts_due
    ON org_payouts(status, next_run_at)
  `);

  await db.query(`
    CREATE TABLE IF NOT EXISTS org_payout_transactions (
      transaction_id SERIAL PRIMARY KEY,
      payout_id INT NOT NULL REFERENCES org_payouts(payout_id) ON DELETE CASCADE,
      organization_id INT NOT NULL REFERENCES organizations(organization_id) ON DELETE CASCADE,
      amount NUMERIC(12,2) NOT NULL,
      currency VARCHAR(10) NOT NULL,
      provider VARCHAR(20) NOT NULL,
      provider_reference VARCHAR(255),
      status VARCHAR(20) NOT NULL DEFAULT 'pending',
      failure_reason TEXT,
      executed_at TIMESTAMPTZ,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      CONSTRAINT org_payout_transactions_status_check
        CHECK (status IN ('pending', 'succeeded', 'failed'))
    )
  `);

  await db.query(`
    CREATE INDEX IF NOT EXISTS idx_org_payout_transactions_payout
    ON org_payout_transactions(payout_id, created_at DESC)
  `);

  await db.query(`
    DO $$
    BEGIN
      IF NOT EXISTS (
        SELECT 1 FROM pg_trigger WHERE tgname = 'update_org_payouts_modtime'
      ) THEN
        CREATE TRIGGER update_org_payouts_modtime
          BEFORE UPDATE ON org_payouts
          FOR EACH ROW
          EXECUTE FUNCTION update_modified_column();
      END IF;
    END
    $$;
  `).catch(() => {});

  _payoutSchemaReady = true;
}

module.exports = { ensurePayoutSchema };
