// utils/dynamicPricing.js
// Pure functions for the new dynamic pricing system. Do not couple this file
// to the legacy tier system in any way.
//
// PARALLEL SYSTEM: this module is intentionally NOT imported by any legacy
// controller, the public service-plan renderer, or the recurring billing job.
// Only the new "Dynamic Pricing (Beta)" admin methods import it.

// A price list's free students: a number (free_student_threshold), or a share of the school's
// students (free_student_percent, e.g. 10 = the first 10% are free).
function freeStudentPercent(priceRow) {
  const raw = priceRow ? priceRow.free_student_percent : null;
  if (raw == null || raw === '') return null;
  const percent = Number(raw);
  return Number.isFinite(percent) && percent >= 0 ? Math.min(100, percent) : null;
}

// How long the free students last: a school's first N months (free_student_months), or null
// for always.
function freeStudentMonths(priceRow) {
  const raw = priceRow ? priceRow.free_student_months : null;
  if (raw == null || raw === '') return null;
  const months = Math.round(Number(raw));
  return Number.isFinite(months) && months > 0 ? months : null;
}

// Whole months from a school's first paid day to `at` (0 in its first month, and before it pays).
function monthsSince(paidSince, at = new Date()) {
  const from = paidSince ? new Date(paidSince) : null;
  const to = at ? new Date(at) : new Date();
  if (!from || Number.isNaN(from.getTime()) || Number.isNaN(to.getTime()) || to <= from) return 0;
  let months = (to.getUTCFullYear() - from.getUTCFullYear()) * 12 + (to.getUTCMonth() - from.getUTCMonth());
  if (to.getUTCDate() < from.getUTCDate()) months -= 1;
  return Math.max(0, months);
}

// options.monthIndex: which month of the school's paid time this is (0 = its first). Free
// students given for a time apply only while it is inside that time.
function computeDynamicMonthlyPrice(priceRow, studentCount, options = {}) {
  if (!priceRow) return null;
  const base = Number(priceRow.base_price_usd) || 0;
  const percent = freeStudentPercent(priceRow);
  const planThreshold = percent != null
    ? Math.floor((Number(studentCount) || 0) * percent / 100)
    : Number(priceRow.free_student_threshold) || 0;
  const freeMonths = freeStudentMonths(priceRow);
  const monthIndex = Math.max(0, Math.floor(Number(options.monthIndex) || 0));
  const freeEnded = freeMonths != null && monthIndex >= freeMonths;
  const threshold = freeEnded ? 0 : planThreshold;
  const rate = Number(priceRow.per_student_rate_usd) || 0;
  const monthsPerTerm = Math.max(
    1,
    Number(options.monthsPerTerm) || Number(options.termDivider) || 1
  );
  const extra = Math.max(0, Number(studentCount || 0) - threshold);
  const termStudentCost = extra * rate;
  const studentCost = termStudentCost / monthsPerTerm;
  return {
    basePrice: base,
    threshold,
    planThreshold,
    freeMonths,
    freeEnded,
    freeMonthsLeft: freeMonths == null ? null : Math.max(0, freeMonths - monthIndex),
    freePercent: percent,
    perStudentRate: rate,
    termDivider: monthsPerTerm,
    monthsPerTerm,
    extraStudents: extra,
    termStudentCost,
    studentCost,
    monthlyTotal: base + studentCost,
  };
}

// The average month's price over a bill of `periodMonths` months starting at `monthIndex`:
// a bill that runs past the free months charges each month at its own price.
function averageMonthlyOverPeriod(priceRow, studentCount, options = {}) {
  const months = Math.max(1, Math.round(Number(options.periodMonths) || 1));
  const start = Math.max(0, Math.floor(Number(options.monthIndex) || 0));
  let total = 0;
  for (let i = 0; i < months; i++) {
    total += computeDynamicMonthlyPrice(priceRow, studentCount, { ...options, monthIndex: start + i }).monthlyTotal;
  }
  return total / months;
}

function applyCycle(monthlyTotal, cycle) {
  const months = Number(cycle?.months) || 1;
  const discount = Number(cycle?.discount_percentage) || 0;
  const raw = monthlyTotal * months;
  const final = raw * (1 - discount / 100);
  return {
    months,
    discountPercentage: discount,
    rawTotal: raw,
    finalTotal: final,
    perMonthEquivalent: final / months,
    savings: raw - final,
  };
}

async function getRegionForCountry(db, countryCode) {
  if (countryCode) {
    const r = await db.query(`
      SELECT pr.*
      FROM pricing_regions pr
      JOIN pricing_region_countries prc ON prc.region_id = pr.id
      WHERE prc.country_code = $1 AND pr.is_active = TRUE
      LIMIT 1
    `, [String(countryCode).toUpperCase()]);
    if (r.rows[0]) return r.rows[0];
  }
  const def = await db.query(
    'SELECT * FROM pricing_regions WHERE is_default = TRUE AND is_active = TRUE LIMIT 1'
  );
  return def.rows[0] || null;
}

async function getPlanRegionPrice(db, planId, regionId) {
  const r = await db.query(
    'SELECT * FROM plan_region_prices WHERE plan_id = $1 AND region_id = $2',
    [planId, regionId]
  );
  return r.rows[0] || null;
}

async function getBestPlanRegionPrice(db, planId, preferredRegionId = null) {
  const normalizedPlanId = Number(planId || 0);
  if (!Number.isInteger(normalizedPlanId) || normalizedPlanId <= 0) return null;

  const normalizedPreferredRegionId = Number(preferredRegionId || 0);
  if (Number.isInteger(normalizedPreferredRegionId) && normalizedPreferredRegionId > 0) {
    const exact = await db.query(
      `SELECT prp.*, pr.id AS matched_region_id, pr.name AS matched_region_name
         FROM plan_region_prices prp
         JOIN pricing_regions pr ON pr.id = prp.region_id
        WHERE prp.plan_id = $1
          AND prp.region_id = $2
          AND pr.is_active = TRUE
        LIMIT 1`,
      [normalizedPlanId, normalizedPreferredRegionId]
    );
    if (exact.rows[0]) {
      return {
        priceRow: exact.rows[0],
        region: {
          id: Number(exact.rows[0].matched_region_id),
          name: exact.rows[0].matched_region_name,
        },
        matchType: "exact",
      };
    }
  }

  const defaultRegion = await db.query(
    `SELECT prp.*, pr.id AS matched_region_id, pr.name AS matched_region_name
       FROM plan_region_prices prp
       JOIN pricing_regions pr ON pr.id = prp.region_id
      WHERE prp.plan_id = $1
        AND pr.is_active = TRUE
        AND pr.is_default = TRUE
      ORDER BY pr.sort_order ASC, pr.id ASC
      LIMIT 1`,
    [normalizedPlanId]
  );
  if (defaultRegion.rows[0]) {
    return {
      priceRow: defaultRegion.rows[0],
      region: {
        id: Number(defaultRegion.rows[0].matched_region_id),
        name: defaultRegion.rows[0].matched_region_name,
      },
      matchType: "default",
    };
  }

  const anyActive = await db.query(
    `SELECT prp.*, pr.id AS matched_region_id, pr.name AS matched_region_name
       FROM plan_region_prices prp
       JOIN pricing_regions pr ON pr.id = prp.region_id
      WHERE prp.plan_id = $1
        AND pr.is_active = TRUE
      ORDER BY pr.is_default DESC, pr.sort_order ASC, pr.id ASC
      LIMIT 1`,
    [normalizedPlanId]
  );
  if (!anyActive.rows[0]) return null;

  return {
    priceRow: anyActive.rows[0],
    region: {
      id: Number(anyActive.rows[0].matched_region_id),
      name: anyActive.rows[0].matched_region_name,
    },
    matchType: "any-active",
  };
}

module.exports = {
  freeStudentPercent,
  freeStudentMonths,
  monthsSince,
  averageMonthlyOverPeriod,
  computeDynamicMonthlyPrice,
  applyCycle,
  getRegionForCountry,
  getPlanRegionPrice,
  getBestPlanRegionPrice,
};
