// utils/payoutRunner.js
// Shared charge-execution logic for the Payouts feature, used by both the
// "Pay Now" button (immediate, one-off) and the recurring sweep
// (jobs/payoutScheduler.js). Charges the org's saved card (Stripe or
// Paystack, whichever the card belongs to) off-session and records the
// result in org_payout_transactions. Money moves from the school's card to
// Managira; the recipient is only emailed a notice — no bank transfer is
// performed here (see [[payout settings decision]]).

const db = require("../config/db");
const axios = require("axios");
const { getStripeClient } = require("./stripeConfig");
const { getPaystackSettings } = require("./paystackConfig");
const { sendEmailSafely, renderCleanEmail } = require("./emailHelper");
const { computeNextRunAfterExecution } = require("./payoutSchedule");

/**
 * Charge the org's saved card for one payout occurrence and record the
 * outcome. Always resolves (never throws) — callers check `.success`.
 */
async function executePayoutCharge(payoutRow, { dbClient = db } = {}) {
  const orgResult = await dbClient.query(
    `SELECT organization_id, organization_name, email, stripe_customer_id
       FROM organizations WHERE organization_id = $1`,
    [payoutRow.organization_id]
  );
  const org = orgResult.rows[0];
  if (!org) {
    return recordFailure(dbClient, payoutRow, "stripe", "Organization not found.");
  }

  const cardResult = await dbClient.query(
    `SELECT id, provider, authorization_code, last4, is_active
       FROM stored_cards WHERE id = $1 AND organization_id = $2`,
    [payoutRow.card_id, payoutRow.organization_id]
  );
  const card = cardResult.rows[0];
  if (!card || !card.is_active) {
    return recordFailure(dbClient, payoutRow, "stripe", "The saved card for this payout is no longer available.");
  }

  const amountMinor = Math.round(Number(payoutRow.amount) * 100);
  const currency = String(payoutRow.currency || "USD").toLowerCase();

  let outcome;
  if (card.provider === "paystack") {
    outcome = await chargePaystackCard({ org, card, amountMinor, currency, payoutRow });
  } else {
    outcome = await chargeStripeCard({ org, card, amountMinor, currency, payoutRow });
  }

  await dbClient.query(
    `INSERT INTO org_payout_transactions
        (payout_id, organization_id, amount, currency, provider, provider_reference, status, failure_reason, executed_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
    [
      payoutRow.payout_id,
      payoutRow.organization_id,
      payoutRow.amount,
      payoutRow.currency,
      card.provider,
      outcome.reference || null,
      outcome.success ? "succeeded" : "failed",
      outcome.success ? null : outcome.message,
      outcome.success ? new Date() : null,
    ]
  );

  const nowIso = new Date();
  if (outcome.success) {
    const nextRunAt = computeNextRunAfterExecution(
      { frequency: payoutRow.frequency, startDate: payoutRow.start_date, endDate: payoutRow.end_date },
      nowIso
    );
    await dbClient.query(
      `UPDATE org_payouts
          SET last_run_at = NOW(),
              next_run_at = $2::timestamptz,
              status = CASE WHEN $2::timestamptz IS NULL THEN 'completed' ELSE status END,
              last_error = NULL
        WHERE payout_id = $1`,
      [payoutRow.payout_id, nextRunAt]
    );
    await sendPayoutReceiptEmail(org, payoutRow, card).catch(() => {});
  } else {
    await dbClient.query(
      `UPDATE org_payouts SET last_run_at = NOW(), last_error = $2 WHERE payout_id = $1`,
      [payoutRow.payout_id, outcome.message]
    );
  }

  return outcome;
}

async function recordFailure(dbClient, payoutRow, provider, message) {
  await dbClient.query(
    `INSERT INTO org_payout_transactions
        (payout_id, organization_id, amount, currency, provider, status, failure_reason)
       VALUES ($1,$2,$3,$4,$5,'failed',$6)`,
    [payoutRow.payout_id, payoutRow.organization_id, payoutRow.amount, payoutRow.currency, provider, message]
  );
  await dbClient.query(
    `UPDATE org_payouts SET last_run_at = NOW(), last_error = $2 WHERE payout_id = $1`,
    [payoutRow.payout_id, message]
  );
  return { success: false, message };
}

async function chargeStripeCard({ org, card, amountMinor, currency, payoutRow }) {
  try {
    const stripe = await getStripeClient(db);
    if (!org.stripe_customer_id) {
      return { success: false, message: "This school has no Stripe customer on file for its saved cards." };
    }
    const idempotencyKey = `org_payout:${payoutRow.payout_id}:${payoutRow.next_run_at || payoutRow.start_date}:${amountMinor}`;
    const paymentIntent = await stripe.paymentIntents.create(
      {
        amount: amountMinor,
        currency,
        customer: org.stripe_customer_id,
        payment_method: card.authorization_code,
        confirm: true,
        off_session: true,
        description: `Payout — ${payoutRow.name}`,
        metadata: {
          flow: "org_payout",
          payout_id: String(payoutRow.payout_id),
          organization_id: String(payoutRow.organization_id),
          recipient_email: payoutRow.recipient_email || "",
        },
      },
      { idempotencyKey }
    );
    if (paymentIntent.status === "succeeded") {
      return { success: true, reference: paymentIntent.id };
    }
    return {
      success: false,
      message: paymentIntent.last_payment_error?.message || `Card declined (status: ${paymentIntent.status}).`,
    };
  } catch (error) {
    return { success: false, message: error?.message || "Stripe charge failed." };
  }
}

async function chargePaystackCard({ org, card, amountMinor, currency, payoutRow }) {
  try {
    const settings = await getPaystackSettings(db);
    const secretKey = settings.activeSecretKey;
    if (!secretKey) {
      return { success: false, message: "Paystack is not configured for this platform." };
    }
    if (!org.email) {
      return { success: false, message: "This school has no billing email on file for Paystack charges." };
    }
    const response = await axios.post(
      "https://api.paystack.co/transaction/charge_authorization",
      {
        authorization_code: card.authorization_code,
        email: org.email,
        amount: amountMinor,
        currency: currency.toUpperCase(),
        metadata: {
          flow: "org_payout",
          payout_id: payoutRow.payout_id,
          organization_id: payoutRow.organization_id,
        },
      },
      { headers: { Authorization: `Bearer ${secretKey}` } }
    );
    const data = response.data?.data;
    if (data?.status === "success") {
      return { success: true, reference: data.reference };
    }
    return { success: false, message: data?.gateway_response || "Card declined." };
  } catch (error) {
    return { success: false, message: error?.response?.data?.message || error.message || "Paystack charge failed." };
  }
}

async function sendPayoutReceiptEmail(org, payoutRow, card) {
  if (!payoutRow.recipient_email) return;
  const amountStr = `${payoutRow.currency} ${Number(payoutRow.amount).toFixed(2)}`;
  const html = renderCleanEmail({
    title: "Payment Notice",
    greeting: `Hi ${payoutRow.recipient_name || "there"},`,
    paragraphs: [
      `${org.organization_name || "Your school"} has sent you a payment of ${amountStr} for "${payoutRow.name}".`,
    ],
    details: [
      { label: "Amount", value: amountStr },
      { label: "Description", value: payoutRow.name },
      { label: "Card", value: `•••• ${card.last4 || "----"}` },
      { label: "Date", value: new Date().toLocaleDateString() },
    ],
    note: "This is an automated payment notice from Managira on behalf of your school.",
  });
  await sendEmailSafely(
    {
      to: payoutRow.recipient_email,
      subject: `You've been paid — ${payoutRow.name}`,
      html,
      text: `${org.organization_name || "Your school"} sent you ${amountStr} for "${payoutRow.name}".`,
    },
    `Org Payout #${payoutRow.payout_id}`
  );
}

module.exports = { executePayoutCharge };
