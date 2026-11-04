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
// Each real attempt gets its own reference or key, because Paystack refuses one it has
// seen and Stripe replays the old result. The one exception is a charge whose result
// never came back: its retry reuses the same one, so it can't charge twice. These are
// counted from recorded attempts, because next_run_at is only a lease while a payout runs.
const NOT_CONFIRMED = "Not confirmed:";
async function payoutAttemptReference(dbClient, payoutRow) {
  const { rows } = await dbClient.query(
    `SELECT COUNT(*) OVER()::int AS attempts, failure_reason, provider_reference
       FROM org_payout_transactions
      WHERE payout_id = $1
      ORDER BY transaction_id DESC
      LIMIT 1`,
    [payoutRow.payout_id]
  );
  const last = rows[0];
  if (last && last.provider_reference && String(last.failure_reason || "").startsWith(NOT_CONFIRMED)) {
    return last.provider_reference;
  }
  return `org-payout-${payoutRow.payout_id}-${last ? last.attempts : 0}`;
}

// After a clear failure: try again in 1 hour, then in 24 hours, then tell the school and
// wait for the next scheduled date. A "not confirmed" charge stays on its short lease,
// so it is looked up again soon under the same reference.
async function scheduleAfterFailure(dbClient, payoutRow, org, message) {
  if (String(message || "").startsWith(NOT_CONFIRMED)) return;
  const { rows } = await dbClient.query(
    `SELECT COUNT(*)::int AS failed FROM org_payout_transactions
      WHERE payout_id = $1 AND status = 'failed'
        AND transaction_id > COALESCE((SELECT MAX(transaction_id) FROM org_payout_transactions WHERE payout_id = $1 AND status = 'succeeded'), 0)`,
    [payoutRow.payout_id]
  );
  const failed = rows[0]?.failed || 1;
  const retryHours = failed === 1 ? 1 : failed === 2 ? 24 : null;
  const nextRunAt = retryHours
    ? new Date(Date.now() + retryHours * 60 * 60 * 1000)
    : computeNextRunAfterExecution(
      { frequency: payoutRow.frequency, startDate: payoutRow.start_date, endDate: payoutRow.end_date },
      new Date()
    );
  await dbClient.query(`UPDATE org_payouts SET next_run_at = $2::timestamptz WHERE payout_id = $1`, [payoutRow.payout_id, nextRunAt]);
  if (failed === 3 && org?.email) {
    await sendEmailSafely(
      {
        to: org.email,
        subject: `A scheduled payment failed: ${payoutRow.name}`,
        html: renderCleanEmail({
          title: "A scheduled payment failed",
          greeting: "Hello,",
          paragraphs: [
            `We tried three times to pay "${payoutRow.name}" and could not. The last reason given was: ${message}`,
            nextRunAt ? "We will try again on its next scheduled date. Please check the saved card." : "There are no more scheduled dates, so we won't try again. Please check the saved card.",
          ],
        }),
        text: `We tried three times to pay "${payoutRow.name}" and could not. Reason: ${message}`,
      },
      `Org Payout #${payoutRow.payout_id} failed`
    ).catch(() => {});
  }
}

// What Paystack actually did with a reference, or null if it can't say right now.
async function checkPaystackCharge(reference, secretKey) {
  try {
    const response = await axios.get(
      `https://api.paystack.co/transaction/verify/${encodeURIComponent(reference)}`,
      { headers: { Authorization: `Bearer ${secretKey}` }, timeout: 20000 }
    );
    return response.data?.data || null;
  } catch (error) {
    return null;
  }
}


// rescheduleOnFailure: for the scheduled sweep. A person pressing Pay Now just sees the
// result, and the schedule stays as it was.
async function executePayoutCharge(payoutRow, { dbClient = db, rescheduleOnFailure = false } = {}) {
  const orgResult = await dbClient.query(
    `SELECT organization_id, organization_name, email, stripe_customer_id
       FROM organizations WHERE organization_id = $1`,
    [payoutRow.organization_id]
  );
  const org = orgResult.rows[0];
  if (!org) {
    const missing = await recordFailure(dbClient, payoutRow, "stripe", "Organization not found.");
    if (rescheduleOnFailure) await scheduleAfterFailure(dbClient, payoutRow, null, missing.message);
    return missing;
  }

  const cardResult = await dbClient.query(
    `SELECT id, provider, authorization_code, last4, is_active
       FROM stored_cards WHERE id = $1 AND organization_id = $2`,
    [payoutRow.card_id, payoutRow.organization_id]
  );
  const card = cardResult.rows[0];
  if (!card || !card.is_active) {
    const noCard = await recordFailure(dbClient, payoutRow, "stripe", "The saved card for this payout is no longer available.");
    if (rescheduleOnFailure) await scheduleAfterFailure(dbClient, payoutRow, org, noCard.message);
    return noCard;
  }

  const amountMinor = Math.round(Number(payoutRow.amount) * 100);
  const currency = String(payoutRow.currency || "USD").toLowerCase();

  let outcome;
  if (card.provider === "paystack") {
    outcome = await chargePaystackCard({ org, card, amountMinor, currency, payoutRow, dbClient });
  } else {
    outcome = await chargeStripeCard({ org, card, amountMinor, currency, payoutRow, dbClient });
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
    if (rescheduleOnFailure) await scheduleAfterFailure(dbClient, payoutRow, org, outcome.message);
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

async function chargeStripeCard({ org, card, amountMinor, currency, payoutRow, dbClient = db }) {
  let idempotencyKey = null;
  try {
    const stripe = await getStripeClient(db);
    if (!org.stripe_customer_id) {
      return { success: false, message: "This school has no Stripe customer on file for its saved cards." };
    }
    idempotencyKey = await payoutAttemptReference(dbClient, payoutRow);
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
    const message = error?.message || "Stripe charge failed.";
    // The request may have reached Stripe: retrying with the same key returns the same
    // payment rather than making a second one.
    if (idempotencyKey && (error?.type === "StripeConnectionError" || error?.type === "StripeAPIError")) {
      return { success: false, message: `${NOT_CONFIRMED} ${message}`, reference: idempotencyKey };
    }
    return { success: false, message };
  }
}

async function chargePaystackCard({ org, card, amountMinor, currency, payoutRow, dbClient = db }) {
  let reference = null;
  let secretKey = null;
  try {
    const settings = await getPaystackSettings(db);
    secretKey = settings.activeSecretKey;
    if (!secretKey) {
      return { success: false, message: "Paystack is not configured for this platform." };
    }
    if (!org.email) {
      return { success: false, message: "This school has no billing email on file for Paystack charges." };
    }
    reference = await payoutAttemptReference(dbClient, payoutRow);
    const response = await axios.post(
      "https://api.paystack.co/transaction/charge_authorization",
      {
        authorization_code: card.authorization_code,
        email: org.email,
        amount: amountMinor,
        reference,
        currency: currency.toUpperCase(),
        metadata: {
          flow: "org_payout",
          payout_id: payoutRow.payout_id,
          organization_id: payoutRow.organization_id,
        },
      },
      { headers: { Authorization: `Bearer ${secretKey}` }, timeout: 20000 }
    );
    const data = response.data?.data;
    if (data?.status === "success") {
      return { success: true, reference: data.reference };
    }
    return { success: false, message: data?.gateway_response || "Card declined." };
  } catch (error) {
    const message = error?.response?.data?.message || error.message || "Paystack charge failed.";
    // No answer, or Paystack says it already has this reference: ask what happened
    // before deciding, because the money may already have moved.
    if (reference && (!error?.response || /duplicate/i.test(message))) {
      const charge = await checkPaystackCharge(reference, secretKey);
      if (charge?.status === "success") return { success: true, reference: charge.reference || reference };
      // Only a clear failure for this exact reference makes a new reference safe.
      if (charge && ["failed", "abandoned", "reversed"].includes(charge.status)) {
        return { success: false, message: charge.gateway_response || message };
      }
      return { success: false, message: `${NOT_CONFIRMED} ${message}`, reference };
    }
    return { success: false, message };
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

module.exports = { executePayoutCharge, _test: { chargePaystackCard } };
