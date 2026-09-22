// controllers/payoutController.js
// Settings → Payouts: schedule one-time or recurring payments (e.g. a
// teacher's salary) charged to a card the school already saved. See
// utils/payoutRunner.js for the actual charge execution and
// jobs/payoutScheduler.js for the recurring sweep.

const db = require("../config/db");
const { ensurePayoutSchema } = require("../utils/payoutSchema");
const { executePayoutCharge } = require("../utils/payoutRunner");
const {
  normalizeFrequency,
  formatDateOnly,
  parseDateOnly,
  computeInitialRunAt,
} = require("../utils/payoutSchedule");
const { formatDisplayName } = require("../utils/organizationDisplayPreferences");

async function ensureReady() {
  await ensurePayoutSchema(db);
}

function requireOrgId(req, res) {
  const orgId = req.session?.organizationId;
  if (!orgId) {
    res.status(401).json({ success: false, message: "Please log in again." });
    return null;
  }
  return orgId;
}

module.exports = {
  // GET /account/settings/payouts.json — list payouts + eligible cards for the create form.
  payoutsListJsonGet: async (req, res) => {
    const orgId = requireOrgId(req, res);
    if (!orgId) return;
    try {
      await ensureReady();
      const payouts = await db.query(
        `SELECT p.*, c.provider AS card_provider, c.last4 AS card_last4, c.card_type AS card_brand,
                c.display_name AS card_display_name
           FROM org_payouts p
           LEFT JOIN stored_cards c ON c.id = p.card_id
          WHERE p.organization_id = $1
          ORDER BY (p.status = 'active') DESC, p.next_run_at ASC NULLS LAST, p.created_at DESC`,
        [orgId]
      );
      const cards = await db.query(
        `SELECT id, provider, card_type, last4, exp_month, exp_year, display_name, is_primary
           FROM stored_cards
          WHERE organization_id = $1 AND is_active = true
          ORDER BY is_primary DESC, id ASC`,
        [orgId]
      );
      return res.json({ success: true, payouts: payouts.rows, cards: cards.rows });
    } catch (error) {
      console.error("[payoutsListJsonGet]", error.message);
      return res.status(500).json({ success: false, message: "Unable to load payouts." });
    }
  },

  // GET /account/settings/payouts/recipients/search?q=  — search this org's users
  // (teachers/staff/etc.) to select as a payout recipient.
  payoutRecipientSearchGet: async (req, res) => {
    const orgId = requireOrgId(req, res);
    if (!orgId) return;
    try {
      const query = String(req.query.q || "").trim();
      const params = [orgId];
      let whereClause = "WHERE organization_id = $1 AND email IS NOT NULL";
      if (query) {
        params.push(`%${query}%`);
        whereClause += ` AND (
          CONCAT_WS(' ', first_name, last_name) ILIKE $2
          OR email ILIKE $2
          OR account_type::text ILIKE $2
        )`;
      }
      const result = await db.query(
        `SELECT user_id, first_name, last_name, email, account_type
           FROM users
           ${whereClause}
           ORDER BY first_name, last_name, email
           LIMIT 20`,
        params
      );
      return res.json({
        success: true,
        users: result.rows.map((user) => ({
          userId: user.user_id,
          name: formatDisplayName(user, req.session?.nameDisplayFormat) || [user.first_name, user.last_name].filter(Boolean).join(" "),
          email: user.email,
          accountType: user.account_type,
        })),
      });
    } catch (error) {
      console.error("[payoutRecipientSearchGet]", error.message);
      return res.status(500).json({ success: false, message: "Failed to search users." });
    }
  },

  // POST /account/settings/payouts — create a payout.
  payoutCreatePost: async (req, res) => {
    const orgId = requireOrgId(req, res);
    if (!orgId) return;
    try {
      await ensureReady();
      const body = req.body || {};
      const name = String(body.name || "").trim();
      const amount = Number(body.amount);
      const currency = String(body.currency || "USD").trim().toUpperCase() || "USD";
      const cardId = parseInt(body.card_id, 10);
      const frequency = normalizeFrequency(body.frequency);
      const startDate = formatDateOnly(parseDateOnly(body.start_date || formatDateOnly(new Date()), "Start date"));
      const endDate = body.end_date ? formatDateOnly(parseDateOnly(body.end_date, "End date")) : null;

      const recipientUserId = body.recipient_user_id ? parseInt(body.recipient_user_id, 10) : null;
      let recipientName = String(body.recipient_name || "").trim();
      let recipientEmail = String(body.recipient_email || "").trim().toLowerCase();

      if (!name) throw new Error("Give this payout a name.");
      if (!(amount > 0)) throw new Error("Enter a valid amount.");
      if (!Number.isInteger(cardId)) throw new Error("Choose a card to charge.");

      if (Number.isInteger(recipientUserId) && recipientUserId > 0) {
        const userRow = (await db.query(
          `SELECT first_name, last_name, email FROM users WHERE user_id=$1 AND organization_id=$2`,
          [recipientUserId, orgId]
        )).rows[0];
        if (!userRow) throw new Error("Selected recipient was not found in this school.");
        recipientName = recipientName || [userRow.first_name, userRow.last_name].filter(Boolean).join(" ");
        recipientEmail = recipientEmail || String(userRow.email || "").trim().toLowerCase();
      }

      if (!recipientName) throw new Error("Enter a recipient name.");
      if (!recipientEmail) throw new Error("Enter a recipient email.");

      const cardRow = (await db.query(
        `SELECT id FROM stored_cards WHERE id=$1 AND organization_id=$2 AND is_active=true`,
        [cardId, orgId]
      )).rows[0];
      if (!cardRow) throw new Error("That card is not available for this school.");

      if (endDate && frequency !== "once" && endDate < startDate) {
        throw new Error("End date cannot be before the start date.");
      }

      const nextRunAt = computeInitialRunAt({ frequency, startDate });

      const inserted = await db.query(
        `INSERT INTO org_payouts
            (organization_id, name, amount, currency, recipient_user_id, recipient_name, recipient_email,
             card_id, frequency, start_date, end_date, next_run_at, status, created_by)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,'active',$13)
         RETURNING *`,
        [
          orgId, name, amount, currency,
          Number.isInteger(recipientUserId) ? recipientUserId : null,
          recipientName, recipientEmail,
          cardId, frequency, startDate, endDate, nextRunAt,
          req.session?.userId || req.session?.user?.user_id || null,
        ]
      );

      return res.status(201).json({ success: true, payout: inserted.rows[0], message: "Payout created." });
    } catch (error) {
      return res.status(400).json({ success: false, message: error.message || "Unable to create payout." });
    }
  },

  // POST /account/settings/payouts/:id — edit a payout (also used for pause/resume/cancel via `status`).
  payoutUpdatePost: async (req, res) => {
    const orgId = requireOrgId(req, res);
    if (!orgId) return;
    const payoutId = parseInt(req.params.id, 10);
    if (!Number.isInteger(payoutId)) return res.status(400).json({ success: false, message: "Invalid payout." });
    try {
      await ensureReady();
      const existing = (await db.query(
        `SELECT * FROM org_payouts WHERE payout_id=$1 AND organization_id=$2`,
        [payoutId, orgId]
      )).rows[0];
      if (!existing) return res.status(404).json({ success: false, message: "Payout not found." });

      const body = req.body || {};

      if (body.status) {
        const status = String(body.status).trim().toLowerCase();
        if (!["active", "paused", "cancelled"].includes(status)) {
          return res.status(400).json({ success: false, message: "Invalid status." });
        }
        let nextRunAt = existing.next_run_at;
        if (status === "active" && !nextRunAt) {
          nextRunAt = computeInitialRunAt({ frequency: existing.frequency, startDate: existing.start_date });
        }
        const updated = await db.query(
          `UPDATE org_payouts SET status=$2, next_run_at=$3 WHERE payout_id=$1 RETURNING *`,
          [payoutId, status, status === "active" ? nextRunAt : existing.next_run_at]
        );
        return res.json({ success: true, payout: updated.rows[0], message: "Payout updated." });
      }

      const name = body.name !== undefined ? String(body.name).trim() : existing.name;
      const amount = body.amount !== undefined ? Number(body.amount) : Number(existing.amount);
      const cardId = body.card_id !== undefined ? parseInt(body.card_id, 10) : existing.card_id;
      if (!name) throw new Error("Give this payout a name.");
      if (!(amount > 0)) throw new Error("Enter a valid amount.");

      const cardRow = (await db.query(
        `SELECT id FROM stored_cards WHERE id=$1 AND organization_id=$2 AND is_active=true`,
        [cardId, orgId]
      )).rows[0];
      if (!cardRow) throw new Error("That card is not available for this school.");

      const updated = await db.query(
        `UPDATE org_payouts SET name=$2, amount=$3, card_id=$4 WHERE payout_id=$1 RETURNING *`,
        [payoutId, name, amount, cardId]
      );
      return res.json({ success: true, payout: updated.rows[0], message: "Payout updated." });
    } catch (error) {
      return res.status(400).json({ success: false, message: error.message || "Unable to update payout." });
    }
  },

  // POST /account/settings/payouts/:id/delete
  payoutDeletePost: async (req, res) => {
    const orgId = requireOrgId(req, res);
    if (!orgId) return;
    const payoutId = parseInt(req.params.id, 10);
    try {
      const result = await db.query(
        `DELETE FROM org_payouts WHERE payout_id=$1 AND organization_id=$2`,
        [payoutId, orgId]
      );
      if (!result.rowCount) return res.status(404).json({ success: false, message: "Payout not found." });
      return res.json({ success: true, message: "Payout deleted." });
    } catch (error) {
      return res.status(500).json({ success: false, message: "Unable to delete payout." });
    }
  },

  // POST /account/settings/payouts/:id/pay-now — charge immediately, regardless of schedule.
  payoutPayNowPost: async (req, res) => {
    const orgId = requireOrgId(req, res);
    if (!orgId) return;
    const payoutId = parseInt(req.params.id, 10);
    try {
      await ensureReady();
      const payoutRow = (await db.query(
        `SELECT * FROM org_payouts WHERE payout_id=$1 AND organization_id=$2`,
        [payoutId, orgId]
      )).rows[0];
      if (!payoutRow) return res.status(404).json({ success: false, message: "Payout not found." });
      if (payoutRow.status === "cancelled") {
        return res.status(400).json({ success: false, message: "This payout was cancelled." });
      }

      const outcome = await executePayoutCharge(payoutRow, { dbClient: db });
      if (!outcome.success) {
        return res.status(400).json({ success: false, message: outcome.message || "Charge failed." });
      }
      const refreshed = (await db.query(`SELECT * FROM org_payouts WHERE payout_id=$1`, [payoutId])).rows[0];
      return res.json({ success: true, payout: refreshed, message: "Payment sent." });
    } catch (error) {
      console.error("[payoutPayNowPost]", error.message);
      return res.status(500).json({ success: false, message: "Unable to process payment." });
    }
  },

  // GET /account/settings/payouts/:id/transactions
  payoutTransactionsGet: async (req, res) => {
    const orgId = requireOrgId(req, res);
    if (!orgId) return;
    const payoutId = parseInt(req.params.id, 10);
    try {
      const owns = (await db.query(
        `SELECT 1 FROM org_payouts WHERE payout_id=$1 AND organization_id=$2`,
        [payoutId, orgId]
      )).rows[0];
      if (!owns) return res.status(404).json({ success: false, message: "Payout not found." });

      const result = await db.query(
        `SELECT * FROM org_payout_transactions WHERE payout_id=$1 ORDER BY created_at DESC LIMIT 50`,
        [payoutId]
      );
      return res.json({ success: true, transactions: result.rows });
    } catch (error) {
      return res.status(500).json({ success: false, message: "Unable to load transaction history." });
    }
  },
};
