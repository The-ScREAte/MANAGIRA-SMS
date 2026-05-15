// utils/orgChargeCards.js
// Single source of truth for an organization's charge-cards (the cards Managira charges
// for subscription billing, and that surface in PayGira Payment Settings, Account ->
// Payment Methods, and Enrollment Billing).
//
// Backed by the stored_cards table. Ordering:
//   1. is_primary DESC  (the primary card is always tried first)
//   2. fallback_order ASC NULLS LAST  (admin-defined fallback chain)
//   3. id ASC           (stable tiebreaker)
//
// Only is_active = true rows are returned. If `provider` is given, results are
// scoped to that provider (paystack / stripe). Pass null to get all active cards
// across providers.

/**
 * @param {object} db        pg pool / client
 * @param {number} orgId
 * @param {string|null} provider 'paystack' | 'stripe' | null
 * @returns {Promise<Array<{
 *   id:number,
 *   authorization_code:string,
 *   provider:string,
 *   card_type:string|null,
 *   last4:string|null,
 *   exp_month:string|null,
 *   exp_year:string|null,
 *   is_primary:boolean,
 *   fallback_order:number|null,
 * }>>}
 */
async function getOrgChargeCards(db, orgId, provider = null) {
  if (!orgId) return [];
  const result = await db.query(
    `SELECT id, authorization_code, provider, card_type, last4, exp_month, exp_year,
            is_primary, fallback_order
       FROM stored_cards
      WHERE organization_id = $1
        AND is_active = true
        AND ($2::text IS NULL OR provider = $2)
      ORDER BY is_primary DESC,
               fallback_order ASC NULLS LAST,
               id ASC`,
    [orgId, provider]
  );
  return result.rows.map((row) => ({
    ...row,
    is_primary: Boolean(row.is_primary),
    fallback_order: row.fallback_order === null ? null : Number(row.fallback_order),
  }));
}

module.exports = { getOrgChargeCards };
