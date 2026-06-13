// utils/paystackPayout.js
// -----------------------------------------------------------------------------
// Automatic settlement (payout) of the school's share for Paystack payments that
// are NOT split at charge time.
//
// Background:
//   * Bank accounts created through Paystack's /subaccount endpoint get an
//     `ACCT_...` code. For those we already pass `subaccount` + `transaction_charge`
//     at charge time, so Paystack settles the school DIRECTLY — no payout needed.
//   * Mobile money + bank fallbacks are stored as Paystack TRANSFER RECIPIENTS
//     (`RCP_...`) or LOCAL_ placeholders. Those do NOT split at charge time, so the
//     full amount lands in Managira's main Paystack balance and the school must be
//     paid out via the Paystack Transfers API.
//
// This module makes that payout automatic + idempotent:
//   1. settleFromPaystackTransaction() — call right after a charge is verified.
//   2. retryPendingPaystackPayouts()   — scheduler hook that retries/reconciles
//      payouts that could not complete immediately (e.g. balance not settled yet).
//
// Idempotency: one payout row per charge reference (UNIQUE source_reference) and a
// deterministic Paystack transfer `reference`, so retries never double-pay.
// -----------------------------------------------------------------------------

const axios = require("axios");
const defaultDb = require("../config/db");

const PAYSTACK_API = "https://api.paystack.co";
const MAX_PAYOUT_ATTEMPTS = 24; // ~ retried by the scheduler until settled

let payoutSchemaReady = false;

function roundMoney(value) {
  return Math.round(((Number(value) || 0) + Number.EPSILON) * 100) / 100;
}

function toMinorUnits(amountMajor) {
  return Math.round((Number(amountMajor) || 0) * 100);
}

// Map a stored mobile-money provider label to Paystack's recipient bank_code.
function resolveMomoProviderCode(provider) {
  const prov = String(provider || "").toLowerCase();
  if (prov.includes("vod")) return "VODAFONE";
  if (prov.includes("airtel") || prov.includes("tigo")) return "AIRTEL_TIGO";
  if (prov.includes("orange")) return "ORANGE";
  return "MTN";
}

const COUNTRY_TO_CURRENCY = {
  GH: "GHS", NG: "NGN", KE: "KES", ZA: "ZAR",
  CI: "XOF", EG: "EGP", TZ: "TZS", UG: "UGX", RW: "RWF",
};

async function resolveOrgCurrency(dbClient, orgId, fallback = "GHS") {
  try {
    const row = (await dbClient.query(
      `SELECT organization_country FROM organizations WHERE organization_id = $1 LIMIT 1`,
      [orgId]
    )).rows[0];
    const iso = String(row?.organization_country || "GH").toUpperCase().slice(0, 2);
    return COUNTRY_TO_CURRENCY[iso] || fallback;
  } catch (_) {
    return fallback;
  }
}

async function ensurePaystackPayoutSchema(dbClient = defaultDb) {
  if (payoutSchemaReady) return;

  await dbClient.query(`
    CREATE TABLE IF NOT EXISTS paystack_payouts (
      id SERIAL PRIMARY KEY,
      organization_id INTEGER NOT NULL,
      source_reference VARCHAR(255) NOT NULL,
      transfer_reference VARCHAR(255) NOT NULL,
      recipient_code VARCHAR(255),
      subaccount_id INTEGER,
      amount NUMERIC(14,2) NOT NULL,
      currency VARCHAR(10) NOT NULL,
      status VARCHAR(20) NOT NULL DEFAULT 'pending',
      context VARCHAR(40),
      paystack_transfer_code VARCHAR(255),
      attempts INTEGER NOT NULL DEFAULT 0,
      last_error TEXT,
      metadata JSONB,
      created_at TIMESTAMP NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMP NOT NULL DEFAULT NOW()
    )
  `);
  await dbClient.query(`
    CREATE UNIQUE INDEX IF NOT EXISTS idx_paystack_payouts_source_reference
      ON paystack_payouts (source_reference)
  `);
  await dbClient.query(`
    CREATE INDEX IF NOT EXISTS idx_paystack_payouts_org_status
      ON paystack_payouts (organization_id, status)
  `);

  payoutSchemaReady = true;
}

// Find the org's paystack_subaccounts row that received this charge. Falls back
// to the org's primary payout account when no explicit code is supplied.
async function findPayoutAccount(dbClient, orgId, subaccountCode) {
  if (subaccountCode) {
    const byCode = (await dbClient.query(
      `SELECT * FROM paystack_subaccounts
        WHERE organization_id = $1 AND subaccount_code = $2
        LIMIT 1`,
      [orgId, subaccountCode]
    )).rows[0];
    if (byCode) return byCode;
  }
  return (await dbClient.query(
    `SELECT * FROM paystack_subaccounts
      WHERE organization_id = $1
      ORDER BY is_primary DESC, id ASC
      LIMIT 1`,
    [orgId]
  )).rows[0] || null;
}

// Ensure we have a usable Paystack transfer recipient (`RCP_...`) for this account.
// LOCAL_ placeholders are upgraded in place to a real recipient code.
// Returns the recipient code, or null when one cannot be created.
async function ensureTransferRecipient(dbClient, { orgId, account, secretKey, currency }) {
  const code = String(account?.subaccount_code || "");
  if (code.startsWith("RCP_")) return code;
  if (code.startsWith("ACCT_")) return null; // split account — never transferred

  if (!secretKey) return null;
  const headers = {
    headers: { Authorization: `Bearer ${secretKey}`, "Content-Type": "application/json" },
  };
  const cur = String(currency || "GHS").toUpperCase();

  let recipientPayload = null;
  if (account?.account_type === "mobile_money") {
    if (!account.momo_number) return null;
    recipientPayload = {
      type: "mobile_money",
      name: account.account_holder_name || account.business_name || "School payout",
      account_number: account.momo_number,
      bank_code: resolveMomoProviderCode(account.momo_provider),
      currency: cur,
    };
  } else if (account?.account_type === "bank") {
    if (!account.account_number || !account.bank_code) return null;
    recipientPayload = {
      type: "ghipss",
      name: account.business_name || account.bank_name || "School payout",
      account_number: account.account_number,
      bank_code: account.bank_code,
      currency: cur,
    };
  } else {
    return null;
  }

  let recipientCode = null;
  try {
    const resp = await axios.post(`${PAYSTACK_API}/transferrecipient`, recipientPayload, headers);
    recipientCode = resp.data?.data?.recipient_code || null;
  } catch (_) {
    return null;
  }

  if (recipientCode && account?.id) {
    // Upgrade the LOCAL_ placeholder so future payouts skip recipient creation.
    await dbClient.query(
      `UPDATE paystack_subaccounts SET subaccount_code = $1, updated_at = NOW()
        WHERE id = $2 AND organization_id = $3`,
      [recipientCode, account.id, orgId]
    ).catch(() => {});
  }

  return recipientCode;
}

// Initiate (or re-attempt) a Paystack transfer for an existing payout row.
async function executeTransfer(dbClient, payout, secretKey) {
  const headers = {
    headers: { Authorization: `Bearer ${secretKey}`, "Content-Type": "application/json" },
  };

  try {
    const resp = await axios.post(
      `${PAYSTACK_API}/transfer`,
      {
        source: "balance",
        amount: toMinorUnits(payout.amount),
        recipient: payout.recipient_code,
        reference: payout.transfer_reference,
        currency: String(payout.currency || "GHS").toUpperCase(),
        reason: `School settlement for ${payout.source_reference}`,
      },
      headers
    );

    const data = resp.data?.data || {};
    const rawStatus = String(data.status || "").toLowerCase();
    // success | pending | queued => money is on its way; otp => needs manual finalize.
    let status = "processing";
    if (rawStatus === "success") status = "success";
    else if (rawStatus === "otp") status = "otp_required";
    else if (rawStatus === "failed") status = "failed";

    await dbClient.query(
      `UPDATE paystack_payouts
          SET status = $1,
              paystack_transfer_code = COALESCE($2, paystack_transfer_code),
              attempts = attempts + 1,
              last_error = NULL,
              updated_at = NOW()
        WHERE id = $3`,
      [status, data.transfer_code || null, payout.id]
    );
    return { status, transferCode: data.transfer_code || null };
  } catch (error) {
    const message =
      error?.response?.data?.message || error?.message || "Transfer failed";
    // Insufficient balance (charge not settled yet) => stay pending for retry.
    await dbClient.query(
      `UPDATE paystack_payouts
          SET status = 'pending',
              attempts = attempts + 1,
              last_error = $1,
              updated_at = NOW()
        WHERE id = $2`,
      [String(message).slice(0, 500), payout.id]
    );
    return { status: "pending", error: message };
  }
}

// -----------------------------------------------------------------------------
// PUBLIC: Settle the school's share from a verified Paystack transaction object.
// `txn` is the Paystack transaction (callback verify response `.data.data` or the
// webhook `event.data`). Safe to call multiple times for the same charge.
// -----------------------------------------------------------------------------
async function settleFromPaystackTransaction(dbClient, { txn, context, secretKey }) {
  if (!txn) return { settled: false, reason: "no_transaction" };
  await ensurePaystackPayoutSchema(dbClient);

  const metadata = txn.metadata || {};
  const sourceReference = String(txn.reference || "").trim();
  const orgId = parseInt(metadata.organization_id, 10);
  if (!sourceReference || !Number.isInteger(orgId)) {
    return { settled: false, reason: "missing_reference_or_org" };
  }

  // Already settled / in-flight for this charge?
  const existing = (await dbClient.query(
    `SELECT id, status FROM paystack_payouts WHERE source_reference = $1 LIMIT 1`,
    [sourceReference]
  )).rows[0];
  if (existing && ["success", "processing", "otp_required"].includes(existing.status)) {
    return { settled: existing.status === "success", reason: "already_recorded", status: existing.status };
  }

  // Determine the destination account used for this charge.
  const subaccountCode =
    metadata.payout_subaccount_code ||
    txn.subaccount?.subaccount_code ||
    null;

  // ACCT_ subaccounts settle at charge time via the split — nothing to do.
  if (subaccountCode && String(subaccountCode).startsWith("ACCT_")) {
    return { settled: true, reason: "split_settled" };
  }

  const account = await findPayoutAccount(dbClient, orgId, subaccountCode);
  if (!account) {
    return { settled: false, reason: "no_payout_account" };
  }
  if (String(account.subaccount_code || "").startsWith("ACCT_")) {
    return { settled: true, reason: "split_settled" };
  }

  // School net = amount charged − platform fee (matches the split model exactly,
  // for both 'parent' and 'school' fee-bearer modes).
  const totalMajor = roundMoney((Number(txn.amount) || 0) / 100);
  const platformFee = roundMoney(metadata.platform_fee_amount || 0);
  const schoolNet = roundMoney(Math.max(totalMajor - platformFee, 0));
  if (!(schoolNet > 0)) {
    return { settled: false, reason: "non_positive_net" };
  }

  const currency =
    String(txn.currency || "").toUpperCase() ||
    (await resolveOrgCurrency(dbClient, orgId));

  const recipientCode = await ensureTransferRecipient(dbClient, {
    orgId,
    account,
    secretKey,
    currency,
  });

  const transferReference = `payout_${sourceReference}`;

  // Insert the ledger row (idempotent on source_reference).
  await dbClient.query(
    `INSERT INTO paystack_payouts
       (organization_id, source_reference, transfer_reference, recipient_code,
        subaccount_id, amount, currency, status, context, metadata)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
     ON CONFLICT (source_reference) DO UPDATE
        SET recipient_code = COALESCE(EXCLUDED.recipient_code, paystack_payouts.recipient_code),
            updated_at = NOW()`,
    [
      orgId,
      sourceReference,
      transferReference,
      recipientCode,
      account.id || null,
      schoolNet,
      currency,
      recipientCode ? "pending" : "needs_recipient",
      context || null,
      JSON.stringify({
        platform_fee_amount: platformFee,
        total_amount: totalMajor,
        account_type: account.account_type || null,
        flow: metadata.flow || null,
      }),
    ]
  );

  if (!recipientCode) {
    return { settled: false, reason: "no_recipient" };
  }
  if (!secretKey) {
    return { settled: false, reason: "no_secret_key" };
  }

  const payout = (await dbClient.query(
    `SELECT * FROM paystack_payouts WHERE source_reference = $1 LIMIT 1`,
    [sourceReference]
  )).rows[0];

  const result = await executeTransfer(dbClient, payout, secretKey);
  return { settled: result.status === "success", status: result.status, reason: "transfer_attempted" };
}

// -----------------------------------------------------------------------------
// PUBLIC: Retry/reconcile payouts that did not settle immediately. Designed to be
// called on a schedule. Resolves the active secret key lazily via the supplied
// getter so it works regardless of mode (test/live).
// -----------------------------------------------------------------------------
async function retryPendingPaystackPayouts(dbClient = defaultDb, getSecretKey) {
  await ensurePaystackPayoutSchema(dbClient);

  const resolveSecret =
    typeof getSecretKey === "function"
      ? getSecretKey
      : async () => process.env.PAYSTACK_SECRET_KEY || "";

  let secretKey = "";
  try {
    secretKey = await resolveSecret();
  } catch (_) {
    secretKey = process.env.PAYSTACK_SECRET_KEY || "";
  }
  if (!secretKey) return { processed: 0, settled: 0 };

  const headers = { headers: { Authorization: `Bearer ${secretKey}` } };

  // 1. Reconcile in-flight transfers (processing) against Paystack's final status.
  const inFlight = (await dbClient.query(
    `SELECT * FROM paystack_payouts
      WHERE status = 'processing'
      ORDER BY updated_at ASC
      LIMIT 50`
  )).rows;

  for (const payout of inFlight) {
    try {
      const resp = await axios.get(
        `${PAYSTACK_API}/transfer/verify/${encodeURIComponent(payout.transfer_reference)}`,
        headers
      );
      const status = String(resp.data?.data?.status || "").toLowerCase();
      let mapped = null;
      if (status === "success") mapped = "success";
      else if (status === "failed") mapped = "failed";
      else if (status === "reversed") mapped = "reversed";
      if (mapped) {
        await dbClient.query(
          `UPDATE paystack_payouts SET status = $1, updated_at = NOW() WHERE id = $2`,
          [mapped, payout.id]
        );
      }
    } catch (_) {
      /* leave as processing; try again next sweep */
    }
  }

  // 2. (Re)attempt payouts that are pending or missing a recipient.
  const pending = (await dbClient.query(
    `SELECT * FROM paystack_payouts
      WHERE status IN ('pending', 'needs_recipient', 'failed')
        AND attempts < $1
      ORDER BY created_at ASC
      LIMIT 50`,
    [MAX_PAYOUT_ATTEMPTS]
  )).rows;

  let settled = 0;
  for (const payout of pending) {
    let recipientCode = payout.recipient_code;

    // Try to mint a recipient if we still don't have one.
    if (!recipientCode) {
      const account = await findPayoutAccount(dbClient, payout.organization_id, null);
      if (account) {
        recipientCode = await ensureTransferRecipient(dbClient, {
          orgId: payout.organization_id,
          account,
          secretKey,
          currency: payout.currency,
        });
        if (recipientCode) {
          await dbClient.query(
            `UPDATE paystack_payouts SET recipient_code = $1, status = 'pending', updated_at = NOW() WHERE id = $2`,
            [recipientCode, payout.id]
          );
          payout.recipient_code = recipientCode;
        }
      }
    }

    if (!recipientCode) continue;

    const result = await executeTransfer(dbClient, payout, secretKey);
    if (result.status === "success" || result.status === "processing") settled += 1;
  }

  return { processed: inFlight.length + pending.length, settled };
}

module.exports = {
  ensurePaystackPayoutSchema,
  settleFromPaystackTransaction,
  retryPendingPaystackPayouts,
};
