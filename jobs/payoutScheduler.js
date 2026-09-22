// jobs/payoutScheduler.js
// Sweeps due org_payouts (Settings → Payouts) and charges the org's saved
// card for each one that's due, via utils/payoutRunner. Mirrors the
// advisory-lock + claim-before-process pattern used by
// utils/adminEmailCampaignRunner.js so two overlapping sweeps never
// double-charge the same payout.

const db = require("../config/db");
const { ensurePayoutSchema } = require("../utils/payoutSchema");
const { executePayoutCharge } = require("../utils/payoutRunner");

const PAYOUT_SWEEP_LOCK_KEY = 886432;
const CLAIM_LEASE_MS = 5 * 60 * 1000;

let schemaReadyPromise = null;
async function ensureSchemaReady() {
  if (!schemaReadyPromise) {
    schemaReadyPromise = ensurePayoutSchema(db).catch((error) => {
      schemaReadyPromise = null;
      throw error;
    });
  }
  await schemaReadyPromise;
}

async function runPayoutSweep() {
  await ensureSchemaReady();

  const lockResult = await db.query(`SELECT pg_try_advisory_lock($1) AS locked`, [PAYOUT_SWEEP_LOCK_KEY]);
  if (lockResult.rows[0]?.locked !== true) {
    return { processed: 0, succeeded: 0, failed: 0, skipped: true };
  }

  try {
    const dueResult = await db.query(
      `SELECT * FROM org_payouts
        WHERE status = 'active' AND next_run_at IS NOT NULL AND next_run_at <= NOW()
        ORDER BY next_run_at ASC
        LIMIT 25`
    );

    let processed = 0;
    let succeeded = 0;
    let failed = 0;

    for (const payout of dueResult.rows) {
      // Claim it first (bump next_run_at forward to a lease) so a second
      // sweep starting concurrently won't also pick it up.
      const claimLeaseUntil = new Date(Date.now() + CLAIM_LEASE_MS);
      const claimed = await db.query(
        `UPDATE org_payouts
            SET next_run_at = $3
          WHERE payout_id = $1 AND status = 'active' AND next_run_at = $2
        RETURNING *`,
        [payout.payout_id, payout.next_run_at, claimLeaseUntil]
      );
      const current = claimed.rows[0];
      if (!current) continue;

      processed += 1;
      try {
        const outcome = await executePayoutCharge(current, { dbClient: db });
        if (outcome.success) succeeded += 1;
        else failed += 1;
      } catch (error) {
        failed += 1;
        // Unexpected failure before executePayoutCharge could record its own
        // outcome — restore the pre-claim next_run_at so this payout is
        // retried on the next sweep instead of stuck on the 5-minute lease.
        await db.query(
          `UPDATE org_payouts SET next_run_at = $2, last_error = $3 WHERE payout_id = $1`,
          [current.payout_id, payout.next_run_at, error.message]
        ).catch(() => {});
      }
    }

    return { processed, succeeded, failed, skipped: false };
  } finally {
    await db.query(`SELECT pg_advisory_unlock($1)`, [PAYOUT_SWEEP_LOCK_KEY]);
  }
}

module.exports = { runPayoutSweep };
