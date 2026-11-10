"use strict";

// What a single school pays Managira. A school in a hub is billed through its hub
// (utils/hubBilling.js), never here.
//
//  - Its plan: the price for its country and student count (Pricing › Prices by country,
//    utils/dynamicPricing.js), or the monthly price Managira set for this school; then this
//    school's discount, if it has one.
//  - Its add-ons: those it uses, from the one list hubs are priced on too (hubBilling.INTEGRATIONS),
//    at the standard school price or this school's own. Each is per school, or per seat: Mira per
//    staff seat (once its free trial is over), the student portal per student with access, the
//    parent portal per parent with access. Add-ons are charged only where the "addon_pricing"
//    release is on (utils/shards/features.js).
//
// The bill (jobs/recurringStripeBilling.js) then applies the billing cycle's discount to the
// plan and adds the add-ons and the API allowance for each month of the cycle. The school's
// Billing page shows the same numbers.

const { INTEGRATIONS, INTEGRATION_BY_KEY, SEAT_KEYS, SEATS_SQL, perSeat, unitOf, seatCount, integrationSql, loadAddonPrices, saveAddonPrices } = require("./hubBilling");
const features = require("./shards/features");

// Before school prices lived with the hub ones (hubBilling.loadAddonPrices): { key: price }.
const LEGACY_SETTINGS_KEY = "addon_school_prices";
const MAX_DISCOUNT = 90;
const round2 = (n) => Math.round((Number(n) || 0) * 100) / 100;

// "" -> null (not set); a bad or negative number -> NaN.
function parsePrice(value) {
  const text = String(value == null ? "" : value).replace(/[$,\s]/g, "");
  if (!text) return null;
  const n = Number(text);
  return Number.isFinite(n) && n >= 0 && n <= 100000 ? round2(n) : NaN;
}

// ---------------------------------------------------------------- standard add-on prices

// The standard monthly price of each add-on for a single school: { key: { price, unit } }, unit
// "school" or "seat". Free ones are left out.
async function standardAddonPrices(db) {
  let saved = ((await loadAddonPrices(db)) || {}).schools;
  if (!saved) {
    try {
      const row = (await db.query("SELECT value FROM app_settings WHERE key = $1", [LEGACY_SETTINGS_KEY])).rows[0];
      saved = row ? JSON.parse(row.value) : {};
    } catch (_error) {
      saved = {};
    }
  }
  const out = {};
  INTEGRATIONS.forEach(({ key }) => {
    const entry = saved[key];
    const price = round2(entry && typeof entry === "object" ? entry.price : entry);
    if (price > 0) out[key] = { price, unit: unitOf(key, entry && entry.unit) };
  });
  return out;
}

// input: { key: { price: "5.00" | "", unit } }. Empty or 0 makes it free.
async function saveStandardAddonPrices(db, input = {}) {
  const prices = {};
  const errors = [];
  INTEGRATIONS.forEach(({ key, label }) => {
    const entry = input[key] && typeof input[key] === "object" ? input[key] : { price: input[key] };
    const price = parsePrice(entry.price);
    if (Number.isNaN(price)) errors.push(`${label}: enter a price, or leave it empty to keep it free.`);
    else if (price > 0) prices[key] = { price, unit: unitOf(key, entry.unit) };
  });
  if (errors.length) return { errors };
  await saveAddonPrices(db, "schools", prices);
  return { errors: [], prices };
}

// ---------------------------------------------------------------- a school's own prices

const NO_OVERRIDES = Object.freeze({ monthlyPrice: null, discountPercent: 0, addonPrices: {}, notes: "", updatedAt: null });

function normalizeOverrides(row) {
  if (!row) return { ...NO_OVERRIDES, addonPrices: {} };
  const monthly = row.custom_monthly_price == null ? null : round2(row.custom_monthly_price);
  const addonPrices = {};
  const saved = row.custom_addon_prices && typeof row.custom_addon_prices === "object" ? row.custom_addon_prices : {};
  INTEGRATIONS.forEach(({ key }) => {
    if (saved[key] == null || saved[key] === "") return;
    const price = round2(saved[key]);
    if (price >= 0) addonPrices[key] = price;
  });
  return {
    monthlyPrice: monthly != null && monthly > 0 ? monthly : null,
    discountPercent: Math.min(MAX_DISCOUNT, Math.max(0, round2(row.custom_discount_percent))),
    addonPrices,
    notes: String(row.pricing_notes || ""),
    updatedAt: row.pricing_updated_at || null,
  };
}

// The school's own prices; none until the 2026-11-13 migration has run on this database.
async function schoolOverrides(db, organizationId) {
  try {
    const row = (await db.query(
      `SELECT custom_monthly_price, custom_discount_percent, custom_addon_prices, pricing_notes, pricing_updated_at
         FROM organizations WHERE organization_id = $1`,
      [organizationId]
    )).rows[0];
    return normalizeOverrides(row);
  } catch (error) {
    if (error.code === "42703") return normalizeOverrides(null);
    throw error;
  }
}

// body: { monthlyPrice, discountPercent, notes, addons: { key: { mode: "standard"|"own"|"free", price } } }
function parseOverrides(body = {}) {
  const errors = [];
  const monthly = parsePrice(body.monthlyPrice);
  if (Number.isNaN(monthly)) errors.push("Enter the school's monthly price, or leave it empty for the standard price.");
  const discountText = String(body.discountPercent == null ? "" : body.discountPercent).replace(/[%\s]/g, "");
  const discount = discountText ? Number(discountText) : 0;
  if (!Number.isFinite(discount) || discount < 0 || discount > MAX_DISCOUNT) errors.push(`The discount must be between 0 and ${MAX_DISCOUNT}%.`);
  const addonPrices = {};
  const addons = body.addons && typeof body.addons === "object" ? body.addons : {};
  INTEGRATIONS.forEach(({ key, label }) => {
    const pick = addons[key] || {};
    if (pick.mode === "free") addonPrices[key] = 0;
    else if (pick.mode === "own") {
      const price = parsePrice(pick.price);
      if (price == null || Number.isNaN(price)) errors.push(`${label}: enter this school's price, or choose Standard.`);
      else addonPrices[key] = price;
    }
  });
  return {
    errors,
    overrides: {
      monthlyPrice: monthly != null && monthly > 0 ? monthly : null,
      discountPercent: errors.length ? 0 : round2(discount),
      addonPrices,
      notes: String(body.notes || "").trim().slice(0, 1000),
    },
  };
}

async function saveOverrides(db, organizationId, overrides, updatedBy = null) {
  const own = Object.keys(overrides.addonPrices || {}).length;
  const result = await db.query(
    `UPDATE organizations
        SET custom_monthly_price = $2, custom_discount_percent = $3, custom_addon_prices = $4::jsonb,
            pricing_notes = $5, pricing_updated_at = NOW(), pricing_updated_by = $6
      WHERE organization_id = $1 AND deleted = false
      RETURNING organization_name`,
    [
      organizationId,
      overrides.monthlyPrice,
      overrides.discountPercent || 0,
      own ? JSON.stringify(overrides.addonPrices) : null,
      overrides.notes || null,
      updatedBy,
    ]
  );
  return result.rows[0] || null;
}

// ---------------------------------------------------------------- what the school uses

// The add-ons a school uses, its seats (staff with Mira, students and parents with access) and
// when Mira's free trial ends.
async function schoolUsage(db, organizationId) {
  const ints = await integrationSql(db);
  const row = (await db.query(
    `SELECT ${ints}, ${SEATS_SQL("o")}, o.mira_trial_ends_at
       FROM organizations o WHERE o.organization_id = $1`,
    [organizationId]
  )).rows[0] || {};
  return {
    on: INTEGRATIONS.filter((i) => row[`int_${i.key}`]).map((i) => i.key),
    seats: Object.fromEntries(SEAT_KEYS.map((k) => [k, Number(row[`seats_${k}`]) || 0])),
    miraTrialEndsAt: row.mira_trial_ends_at || null,
  };
}

// The plan's standard monthly price for this school: its country's price for its plan and
// billable students, or, for a plan without country prices, the sum of its features.
async function standardPlanMonthly(db, org) {
  const { getRegionForCountry, getBestPlanRegionPrice, computeDynamicMonthlyPrice } = require("./dynamicPricing");
  const setting = async (key) => {
    try {
      const value = parseInt((await db.query("SELECT value FROM app_settings WHERE key = $1 LIMIT 1", [key])).rows[0]?.value, 10);
      return Number.isInteger(value) && value > 0 ? value : null;
    } catch (_error) {
      return null;
    }
  };
  const students = await require("./studentArchive").countBillableStudents(db, org.organization_id);
  const region = await getRegionForCountry(db, org.organization_country || null);
  const match = await getBestPlanRegionPrice(db, Number(org.plan_id), Number(region?.id || 0) || null);
  if (match?.priceRow) {
    const divider = (await setting("dynamic_term_divider")) || 1;
    const regionId = Number(match.region?.id || region?.id || 0);
    const months = (Number.isInteger(regionId) && regionId > 0 && (await setting(`dynamic_region_term_months_${regionId}`))) || divider;
    const monthly = computeDynamicMonthlyPrice(match.priceRow, students, { termDivider: months });
    return { monthly: round2(monthly?.monthlyTotal), students, region: match.region?.name || region?.name || null };
  }
  const plan = (await db.query(
    `SELECT p.total_cost, COALESCE(SUM(f.price_usd), 0) AS feature_sum
       FROM plans p
       LEFT JOIN plan_features pf ON pf.plan_id = p.id
       LEFT JOIN features f ON f.id = pf.feature_id
      WHERE p.id = $1 GROUP BY p.id, p.total_cost`,
    [Number(org.plan_id) || 0]
  )).rows[0];
  const featureSum = Number(plan?.feature_sum || 0);
  return { monthly: round2(featureSum > 0 ? featureSum : Number(plan?.total_cost || 0)), students, region: null };
}

// ---------------------------------------------------------------- the bill

function planMonthly(standardMonthly, overrides) {
  const standard = round2(standardMonthly);
  const base = overrides.monthlyPrice != null ? overrides.monthlyPrice : standard;
  return {
    standard,
    custom: overrides.monthlyPrice,
    discountPercent: overrides.discountPercent,
    monthly: round2(base * (1 - overrides.discountPercent / 100)),
  };
}

// What the school pays each month, before the billing cycle's discount on the plan.
// Pass `overrides`, `usage` or `prices` to preview unsaved values.
async function schoolBill(db, organizationId, standardMonthly, { overrides, usage, prices } = {}) {
  const own = overrides || (await schoolOverrides(db, organizationId));
  const [use, standard] = await Promise.all([
    usage || schoolUsage(db, organizationId),
    prices || standardAddonPrices(db),
  ]);
  const charging = features.isOn("addon_pricing", { organizationId });
  const addons = [];
  INTEGRATIONS.forEach(({ key, label }) => {
    if (!use.on.includes(key)) return;
    const isOwn = Object.prototype.hasOwnProperty.call(own.addonPrices, key);
    const std = standard[key] || { price: 0, unit: unitOf(key) };
    const unit = unitOf(key, std.unit);
    const unitPrice = isOwn ? own.addonPrices[key] : std.price;
    const bySeat = perSeat(key, unit);
    let quantity = bySeat ? use.seats[INTEGRATION_BY_KEY[key].seat] || 0 : 1;
    let note = bySeat ? seatCount(key, quantity) : "";
    const trialEnds = key === "mira" && use.miraTrialEndsAt ? new Date(use.miraTrialEndsAt) : null;
    if (trialEnds && trialEnds > new Date()) {
      quantity = 0;
      note = `free trial until ${trialEnds.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}`;
    }
    addons.push({ key, label, unit, unitPrice, quantity, amount: round2(unitPrice * quantity), own: isOwn, free: !(unitPrice > 0), note });
  });
  const plan = planMonthly(standardMonthly, own);
  const addonsMonthly = charging ? round2(addons.reduce((sum, line) => sum + line.amount, 0)) : 0;
  return { plan, addons, charging, addonsMonthly, monthly: round2(plan.monthly + addonsMonthly), overrides: own };
}

module.exports = {
  MAX_DISCOUNT,
  parsePrice,
  standardAddonPrices,
  saveStandardAddonPrices,
  schoolOverrides,
  normalizeOverrides,
  parseOverrides,
  saveOverrides,
  schoolUsage,
  standardPlanMonthly,
  planMonthly,
  schoolBill,
};
