// utils/dynamicPricing.js
// Pure functions for the new dynamic pricing system. Do not couple this file
// to the legacy tier system in any way.
//
// PARALLEL SYSTEM: this module is intentionally NOT imported by any legacy
// controller, the public service-plan renderer, or the recurring billing job.
// Only the new "Dynamic Pricing (Beta)" admin methods import it.

function computeDynamicMonthlyPrice(priceRow, studentCount, options = {}) {
  if (!priceRow) return null;
  const base = Number(priceRow.base_price_usd) || 0;
  const threshold = Number(priceRow.free_student_threshold) || 0;
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
    perStudentRate: rate,
    termDivider: monthsPerTerm,
    monthsPerTerm,
    extraStudents: extra,
    termStudentCost,
    studentCost,
    monthlyTotal: base + studentCost,
  };
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

module.exports = {
  computeDynamicMonthlyPrice,
  applyCycle,
  getRegionForCountry,
  getPlanRegionPrice,
};
