// utils/payoutDestination.js
// Unified payout destination resolver for Managira schools.
// One source of truth for: Guardian Paygira + Public Registration payments.
//
// Strategy
//   1. School sets payout pref in Settings → Billing → Payment Method → Payout
//      Accounts (column: organizations.payout_provider_pref).
//      Values: 'stripe' | 'paystack'.
//   2. Resolver returns the active provider + destination id + readiness.
//   3. Paystack countries are fetched LIVE from the org's active Paystack
//      account (api.paystack.co/country) and cached 24h so the UI only
//      surfaces countries actually enabled on the platform.

const NodeCache = require('node-cache');
const axios = require('axios');
const defaultDb = require('../config/db');

const cache = new NodeCache({ stdTTL: 60, checkperiod: 120 });
const countryCache = new NodeCache({ stdTTL: 60 * 60 * 24 }); // 24h

// Hard-coded fallback when Paystack /country call fails. These are the
// countries where Paystack is currently live (Nov 2025).
const PAYSTACK_FALLBACK_COUNTRIES = [
  { iso_code: 'NG', name: 'Nigeria',       currency: 'NGN' },
  { iso_code: 'GH', name: 'Ghana',         currency: 'GHS' },
  { iso_code: 'ZA', name: 'South Africa',  currency: 'ZAR' },
  { iso_code: 'KE', name: 'Kenya',         currency: 'KES' },
  { iso_code: 'CI', name: "Côte d'Ivoire", currency: 'XOF' },
  { iso_code: 'EG', name: 'Egypt',         currency: 'EGP' },
];

/** Normalize a country string to ISO-2 uppercase. Accepts names too. */
function normalizeCountryIso(value) {
  if (!value) return '';
  const v = String(value).trim();
  if (v.length === 2) return v.toUpperCase();
  const lower = v.toLowerCase();
  const hit = PAYSTACK_FALLBACK_COUNTRIES.find(
    (c) => c.name.toLowerCase() === lower
  );
  if (hit) return hit.iso_code;
  // Quick alias map for the most common spellings used in our org records.
  const aliases = {
    nigeria: 'NG', ghana: 'GH', kenya: 'KE', 'south africa': 'ZA',
    "cote d'ivoire": 'CI', 'ivory coast': 'CI', egypt: 'EG',
    'united states': 'US', usa: 'US', 'united kingdom': 'GB', uk: 'GB',
    canada: 'CA', australia: 'AU', germany: 'DE', france: 'FR',
  };
  return (aliases[lower] || '').toUpperCase();
}

/**
 * Fetch live Paystack-enabled countries via the school's PAYSTACK_SECRET_KEY.
 * Returns the cached fallback list if the API call fails.
 */
async function fetchPaystackCountries() {
  const cached = countryCache.get('paystack_countries');
  if (cached) return cached;
  const secret = process.env.PAYSTACK_SECRET_KEY;
  if (!secret) {
    countryCache.set('paystack_countries', PAYSTACK_FALLBACK_COUNTRIES);
    return PAYSTACK_FALLBACK_COUNTRIES;
  }
  try {
    const resp = await axios.get('https://api.paystack.co/country', {
      headers: { Authorization: `Bearer ${secret}` },
      timeout: 6000,
    });
    const list = (resp.data?.data || [])
      .map((c) => ({
        iso_code: String(c.iso_code || c.country_code || '').toUpperCase(),
        name: c.name || c.country || '',
        currency: c.default_currency_code || c.currency || '',
      }))
      .filter((c) => c.iso_code);
    const finalList = list.length ? list : PAYSTACK_FALLBACK_COUNTRIES;
    countryCache.set('paystack_countries', finalList);
    return finalList;
  } catch (_) {
    countryCache.set('paystack_countries', PAYSTACK_FALLBACK_COUNTRIES, 60 * 60); // shorter retry
    return PAYSTACK_FALLBACK_COUNTRIES;
  }
}

async function isPaystackSupportedCountry(iso) {
  if (!iso) return false;
  const list = await fetchPaystackCountries();
  return list.some((c) => c.iso_code === String(iso).toUpperCase());
}

/**
 * Main resolver.
 * @returns {Promise<{
 *   provider: 'stripe'|'paystack'|null,
 *   ready: boolean,
 *   preference: 'stripe'|'paystack'|null,
 *   country: string,
 *   stripe:   { accountId: string, chargesEnabled: boolean, available: boolean },
 *   paystack: { subaccountCode: string, accountType: string, available: boolean, countrySupported: boolean },
 *   reason: string,
 * }>}
 */
async function resolveSchoolPayoutDestination(orgId, db = defaultDb, opts = {}) {
  const cacheKey = `payout:${orgId}`;
  if (!opts.fresh) {
    const cached = cache.get(cacheKey);
    if (cached) return cached;
  }

  const orgRow = (await db.query(
    `SELECT organization_id,
            organization_country,
            payout_provider_pref,
            stripe_connect_account_id,
            stripe_connect_account_id_test,
            stripe_connect_account_id_live
       FROM organizations
      WHERE organization_id = $1
      LIMIT 1`,
    [orgId]
  )).rows[0] || {};

  const country = normalizeCountryIso(orgRow.organization_country);
  const rawPreference = String(orgRow.payout_provider_pref || '').trim().toLowerCase();
  const preference = rawPreference === 'stripe' || rawPreference === 'paystack'
    ? rawPreference
    : null;

  const stripeAccountId =
    String(orgRow.stripe_connect_account_id_live || '').trim() ||
    String(orgRow.stripe_connect_account_id || '').trim() ||
    String(orgRow.stripe_connect_account_id_test || '').trim();

  // Stripe readiness: do a soft check (presence). Caller can deep-check
  // charges_enabled when it has a Stripe client in hand.
  const stripeAvailable = Boolean(stripeAccountId);

  // Paystack readiness: any subaccount/recipient row counts as "configured".
  const paystackRows = (await db.query(
    `SELECT subaccount_code, account_type, is_primary
       FROM paystack_subaccounts
      WHERE organization_id = $1
      ORDER BY is_primary DESC, id ASC`,
    [orgId]
  )).rows;
  const primaryPaystack =
    paystackRows.find((r) => r.is_primary) || paystackRows[0] || null;
  const paystackAvailable = Boolean(primaryPaystack?.subaccount_code);
  const paystackCountrySupported = await isPaystackSupportedCountry(country);

  // Decide active provider.
  let provider = null;
  let reason = '';
  const pref = preference;

  if (pref === 'paystack') {
    provider = paystackAvailable ? 'paystack' : null;
  } else if (pref === 'stripe') {
    provider = stripeAvailable ? 'stripe' : null;
  } else {
    // NULL / auto — keep legacy behaviour: Stripe wins when present.
    if (stripeAvailable) provider = 'stripe';
    else if (paystackAvailable) provider = 'paystack';
  }

  if (!provider) {
    if (paystackCountrySupported && !paystackAvailable) {
      reason = 'School has not configured a Paystack payout account yet.';
    } else if (!stripeAvailable) {
      reason = 'School has not connected a Stripe payout account yet.';
    } else {
      reason = 'No payout method configured.';
    }
  }

  const result = {
    provider,
    ready: Boolean(provider),
    preference,
    country,
    stripe: {
      accountId: stripeAccountId,
      chargesEnabled: stripeAvailable, // soft — caller can override
      available: stripeAvailable,
    },
    paystack: {
      subaccountCode: primaryPaystack?.subaccount_code || '',
      accountType: primaryPaystack?.account_type || '',
      available: paystackAvailable,
      countrySupported: paystackCountrySupported,
    },
    reason,
  };
  cache.set(cacheKey, result);
  return result;
}

function invalidatePayoutCache(orgId) {
  cache.del(`payout:${orgId}`);
}

module.exports = {
  resolveSchoolPayoutDestination,
  invalidatePayoutCache,
  fetchPaystackCountries,
  isPaystackSupportedCountry,
  normalizeCountryIso,
  PAYSTACK_FALLBACK_COUNTRIES,
};
