"use strict";

// Admin › Pricing and Admin › Organizations, one way each:
//
//  Pricing (/admin/servicePricing), three tabs:
//   - Schools: plans and what they include, prices by country, add-on prices, billing cycles
//     and the free trial. A single school's bill is worked out in utils/orgPricing.js.
//   - Hubs: the standard add-on prices a new hub starts with (a hub's own prices are on its
//     Billing page) and the extra products hubs can add (utils/hubBilling.js).
//   - Payment settings: gateway, platform fee, Paystack and Stripe modes.
//  Organizations (/admin/hubs), two tabs: single schools (with their own pricing, details,
//  licenses, hold and delete) and hubs.
//
// Forms open in the side panel and save in place (public/js/adminHubs.js): every POST answers
// with req.flash + redirect, which the admin router turns into JSON for those forms.

const db = require("../config/db");
const hubBilling = require("../utils/hubBilling");
const orgPricing = require("../utils/orgPricing");
const planCatalog = require("../utils/planCatalog");
const { COUNTRIES_BY_CONTINENT, COUNTRY_NAME_LOOKUP } = require("../utils/countries");
const { getPaystackSettings } = require("../utils/paystackConfig");
const { getPaymentProvider } = require("../utils/paymentProviderConfig");
const { getStripeSettings, getStripePlatformCredentials } = require("../utils/stripeConfig");
const { getPlatformFeeSettings } = require("../utils/platformFee");
const { ensurePaymentProviderSchema } = require("../utils/paymentProviderSchema");
const { invalidateAccessForPlan } = require("../utils/accessCache");

const PRICING = "/admin/servicePricing";
const ORGS = "/admin/hubs";
const TABS = ["schools", "hubs", "payments"];
const round2 = (n) => Math.round((Number(n) || 0) * 100) / 100;
const toId = (value) => {
  const id = Number.parseInt(value, 10);
  return Number.isInteger(id) && id > 0 ? id : null;
};
// A switch posts a hidden "0" then "1" when ticked: the last value counts.
const on = (value) => {
  const last = Array.isArray(value) ? value[value.length - 1] : value;
  return last === true || last === "true" || last === "on" || last === "1";
};

// A side-panel form opened by its own address goes back to its page with the panel open.
function panelOnly(req, res, page) {
  if (res.locals.drawer) return true;
  res.redirect(`${page}${page.includes("?") ? "&" : "?"}drawer=${encodeURIComponent(req.originalUrl.split("?")[0])}`);
  return false;
}
const panelMissing = (res, text) => res.status(404).send(`<p class="ahd-missing">${text}</p>`);

async function setting(key, fallback = null) {
  try {
    const row = (await db.query("SELECT value FROM app_settings WHERE key = $1 LIMIT 1", [key])).rows[0];
    return row ? row.value : fallback;
  } catch (_error) {
    return fallback;
  }
}

// ------------------------------------------------------------------ data for the pages

async function loadPlans() {
  const [plans, features] = await Promise.all([
    db.query(
      `SELECT p.id, p.plan_name, p.description, p.is_active,
              COALESCE(ARRAY_AGG(pf.feature_id ORDER BY pf.feature_id) FILTER (WHERE pf.feature_id IS NOT NULL), '{}') AS feature_ids,
              (SELECT COUNT(*)::int FROM organizations o WHERE o.plan_id = p.id AND o.deleted = false) AS schools
         FROM plans p
         LEFT JOIN plan_features pf ON pf.plan_id = p.id
        GROUP BY p.id
        ORDER BY p.id`
    ),
    db.query("SELECT id, feature_name, price_usd FROM features ORDER BY feature_name"),
  ]);
  // The plan features in catalog order (utils/planCatalog.js), and what each plan has of them.
  const catalog = planCatalog.planForm(features.rows);
  const everyPlan = catalog.core.filter((item) => item.headline).map((item) => item.label);
  const withIncludes = (p) => {
    const ids = new Set((p.feature_ids || []).map(Number));
    const included = catalog.choices.filter((item) => item.ids.some((id) => ids.has(id)));
    // `includes`: what the plan has, as schools read it (what every plan has, then its own).
    return { ...p, feature_ids: [...ids], included: included.map((item) => item.key), includes: [...everyPlan, ...included.map((item) => item.label)] };
  };
  return { plans: plans.rows.map(withIncludes), features: features.rows, catalog };
}

// Countries priced together, each with its countries, months per term, plan prices and schools.
async function loadRegions() {
  try {
    const [regions, countries, prices, months, schools] = await Promise.all([
      db.query("SELECT * FROM pricing_regions ORDER BY is_default DESC, sort_order, name"),
      db.query("SELECT region_id, country_code, country_name FROM pricing_region_countries ORDER BY country_name"),
      db.query("SELECT * FROM plan_region_prices"),
      db.query("SELECT key, value FROM app_settings WHERE key LIKE 'dynamic_region_term_months_%' OR key IN ('dynamic_term_months')"),
      db.query(
        `SELECT prc.region_id, COUNT(DISTINCT o.organization_id)::int AS n
           FROM pricing_region_countries prc
           JOIN organizations o ON o.deleted = false AND UPPER(TRIM(o.organization_country)) IN (UPPER(prc.country_code), UPPER(prc.country_name))
          GROUP BY prc.region_id`
      ),
    ]);
    const monthsOf = new Map(months.rows.map((r) => [r.key, parseInt(r.value, 10)]));
    const fallbackMonths = monthsOf.get("dynamic_term_months") || 3;
    const schoolsOf = new Map(schools.rows.map((r) => [Number(r.region_id), r.n]));
    return regions.rows.map((region) => ({
      ...region,
      term_months: monthsOf.get(`dynamic_region_term_months_${region.id}`) || fallbackMonths,
      countries: countries.rows.filter((c) => Number(c.region_id) === Number(region.id)),
      prices: prices.rows.filter((p) => Number(p.region_id) === Number(region.id)),
      schools: schoolsOf.get(Number(region.id)) || 0,
    }));
  } catch (error) {
    if (error.code === "42P01") return [];
    throw error;
  }
}

async function loadCycles() {
  try {
    return (await db.query(
      `SELECT c.*, (SELECT COUNT(*)::int FROM payments p JOIN organizations o ON o.organization_id = p.organization_id
                     WHERE p.billing_period_key = c.cycle_key AND o.deleted = false) AS schools
         FROM dynamic_billing_cycles c ORDER BY c.months, c.sort_order`
    )).rows;
  } catch (error) {
    if (error.code === "42P01") return [];
    throw error;
  }
}

// How many single schools use each add-on, Mira's seats across them, and how many schools
// are charged for add-ons yet (the "addon_pricing" release).
async function addonUse() {
  const features = require("../utils/shards/features");
  const ints = await hubBilling.integrationSql(db);
  const rows = (await db.query(
    `SELECT o.organization_id, ${ints}, ${hubBilling.SEATS_SQL("o")}
       FROM organizations o
      WHERE o.deleted = false AND (o.hub_id IS NULL OR COALESCE(o.is_hub_member, false) = false)`
  )).rows;
  const use = {};
  hubBilling.INTEGRATIONS.forEach(({ key, seat }) => {
    const using = rows.filter((r) => r[`int_${key}`]);
    use[key] = { schools: using.length, seats: seat ? using.reduce((n, r) => n + (Number(r[`seats_${seat}`]) || 0), 0) : null };
  });
  use.released = rows.filter((r) => features.isOn("addon_pricing", { organizationId: r.organization_id })).length;
  use.total = rows.length;
  return use;
}

// ------------------------------------------------------------------ Pricing page

async function pricingGet(req, res) {
  try {
    await ensurePaymentProviderSchema(db);
    await hubBilling.ensureHubBillingSchema(db);
    const [{ plans, features, catalog }, regions, cycles, schoolPrices, hubPrices, use, hubFees, addons, addonHubs, trialEnabled, trialDays,
      paystack, stripe, provider, platformFee] = await Promise.all([
      loadPlans(),
      loadRegions(),
      loadCycles(),
      orgPricing.standardAddonPrices(db),
      hubBilling.loadIntegrationPrices(db),
      addonUse(),
      db.query("SELECT integration_fees FROM hub_billing").then((r) => r.rows.map((x) => x.integration_fees || {})),
      hubBilling.listAddons(db),
      db.query(`SELECT addon_id, COUNT(DISTINCT hub_id)::int AS hubs FROM hub_billing_charges WHERE addon_id IS NOT NULL AND status = 'approved' GROUP BY addon_id`)
        .then((r) => Object.fromEntries(r.rows.map((x) => [x.addon_id, x.hubs]))),
      setting("free_trial_enabled", "false"),
      setting("free_trial_days", "7"),
      getPaystackSettings(db),
      getStripeSettings(db),
      getPaymentProvider(db),
      getPlatformFeeSettings(db),
    ]);
    const stripeStatus = await getStripePlatformCredentials(db).catch(() => ({ mode: stripe.mode, issue: "Stripe platform key status could not be checked." }));
    res.render("admin/pricing", {
      title: "Pricing",
      tab: TABS.includes(req.query.tab) ? req.query.tab : "schools",
      plans,
      features,
      catalog,
      regions,
      cycles,
      countriesByContinent: COUNTRIES_BY_CONTINENT,
      integrations: hubBilling.INTEGRATIONS,
      unitsFor: hubBilling.unitsFor,
      unitOf: hubBilling.unitOf,
      unitLabel: hubBilling.unitLabel,
      seatCount: hubBilling.seatCount,
      seatWho: hubBilling.seatWho,
      perSeat: hubBilling.perSeat,
      schoolPrices,
      hubPrices,
      use,
      hubOwnPrices: hubBilling.INTEGRATIONS.reduce((m, { key }) => {
        const std = hubPrices[key];
        m[key] = hubFees.filter((f) => f[key] && f[key].on && (!std || Number(f[key].price) !== Number(std.price) || hubBilling.unitOf(key, f[key].unit) !== std.unit)).length;
        return m;
      }, {}),
      hubAddons: addons,
      addonHubs,
      money: hubBilling.money,
      freeTrialEnabled: trialEnabled === "true",
      freeTrialDays: String(trialDays),
      paystackMode: paystack.mode,
      stripeMode: stripe.mode,
      stripeKeys: stripe.masked || {},
      stripeStatus,
      paymentProvider: provider,
      platformFeePercentage: Number(platformFee.percentage || 0),
      messages: req.flash(),
      showFooterTopSection: false,
    });
  } catch (error) {
    console.error("[Admin pricing]", error.message);
    req.flash("error", "Could not load pricing.");
    res.redirect("/admin");
  }
}

// Add-on prices, one tab at a time: a single school's standard monthly price (Schools), or the
// standard price and billing mode a new hub starts with (Hubs).
async function addonsPost(req, res) {
  const forHubs = req.body.part === "hubs";
  try {
    const result = forHubs
      ? await hubBilling.saveIntegrationPrices(db, { integrations: req.body.hub || {} })
      : await orgPricing.saveStandardAddonPrices(db, req.body.school || {});
    if (result.errors.length) req.flash("error", result.errors.join(" "));
    else req.flash("success", forHubs ? "Hub add-on prices saved. New hubs start with these; each hub keeps its own." : "School add-on prices saved. They apply from each school's next bill.");
  } catch (error) {
    console.error("[Admin pricing] add-ons:", error.message);
    req.flash("error", "Could not save the add-on prices.");
  }
  res.redirect(`${PRICING}?tab=${forHubs ? "hubs" : "schools"}`);
}

// ---------- plans

async function planFormGet(req, res) {
  if (!panelOnly(req, res, PRICING)) return;
  const { plans, catalog } = await loadPlans();
  const plan = plans.find((p) => Number(p.id) === toId(req.params.planId));
  if (!plan) return panelMissing(res, "This plan no longer exists.");
  // The plan's price on the default (United States) list, shown with what it includes.
  const row = (await db.query(
    `SELECT x.base_price_usd, x.free_student_threshold, x.free_student_percent, x.per_student_rate_usd,
            (to_jsonb(x) ->> 'free_student_months') AS free_months,
            (SELECT value FROM app_settings WHERE key = 'dynamic_region_term_months_' || r.id) AS months
       FROM plan_region_prices x JOIN pricing_regions r ON r.id = x.region_id
      WHERE r.is_default AND x.plan_id = $1 AND x.is_active LIMIT 1`,
    [plan.id]
  ).catch(() => ({ rows: [] }))).rows[0];
  const usd = (n) => `$${Number(n || 0).toFixed(2)}`;
  const price = row && Number(row.base_price_usd) > 0 ? {
    base: usd(row.base_price_usd),
    included: row.free_student_percent != null ? `${Number(row.free_student_percent)}% of` : Number(row.free_student_threshold),
    includedFor: Number(row.free_months) > 0 ? ` for a school's first ${Number(row.free_months) === 1 ? "month" : `${Number(row.free_months)} months`}` : "",
    extra: usd(row.per_student_rate_usd),
    per: String(row.months) === "1" ? "month" : "term",
  } : null;
  res.render("admin/forms/pricingPlan", { plan, catalog, price });
}

async function planPost(req, res) {
  const planId = toId(req.params.planId);
  const client = await db.connect();
  try {
    // Chosen plan features (by catalog key), plus what every plan includes, plus the old rows
    // the form no longer offers (the parent portal, Lesson Notes), which stay as they were.
    const chosen = new Set([].concat(req.body.features || []).map(String));
    await client.query("BEGIN");
    const plan = (await client.query("SELECT id, plan_name FROM plans WHERE id = $1 FOR UPDATE", [planId])).rows[0];
    if (!plan) throw Object.assign(new Error("This plan no longer exists."), { shown: true });
    const catalog = planCatalog.planForm((await client.query("SELECT id, feature_name FROM features")).rows);
    const had = new Set((await client.query("SELECT feature_id FROM plan_features WHERE plan_id = $1", [planId])).rows.map((r) => Number(r.feature_id)));
    const known = [...new Set([
      ...catalog.choices.filter((item) => chosen.has(item.key)).flatMap((item) => item.ids),
      ...catalog.coreIds,
      ...catalog.keptIds.filter((id) => had.has(id)),
    ])];
    await client.query("DELETE FROM plan_features WHERE plan_id = $1 AND NOT (feature_id = ANY($2::int[]))", [planId, known]);
    await client.query(
      `INSERT INTO plan_features (plan_id, feature_id)
       SELECT $1, f FROM unnest($2::int[]) AS f
        WHERE NOT EXISTS (SELECT 1 FROM plan_features pf WHERE pf.plan_id = $1 AND pf.feature_id = f)`,
      [planId, known]
    );
    // The plan's fallback total (used only where it has no prices by country) follows its features.
    // One short name per plan ("Starter", "Pro", "Premium"); an empty box keeps the name it has.
    const name = String(req.body.name || "").trim().replace(/\s+/g, " ").slice(0, 60) || plan.plan_name;
    const taken = (await client.query("SELECT 1 FROM plans WHERE LOWER(TRIM(plan_name)) = LOWER($1) AND id <> $2", [name, planId])).rowCount;
    if (taken) throw Object.assign(new Error(`Another plan is already called ${name}.`), { shown: true });
    await client.query(
      `UPDATE plans SET plan_name = $4, description = $2, is_active = $3,
              total_cost = COALESCE((SELECT SUM(f.price_usd) FROM plan_features pf JOIN features f ON f.id = pf.feature_id WHERE pf.plan_id = $1), 0)
        WHERE id = $1`,
      [planId, String(req.body.description || "").trim().slice(0, 500), on(req.body.isActive), name]
    );
    await client.query("COMMIT");
    await invalidateAccessForPlan(db, planId).catch(() => {});
    req.flash("success", `${name} saved.`);
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {});
    if (!error.shown) console.error("[Admin pricing] plan:", error.message);
    req.flash("error", error.shown ? error.message : "Could not save the plan.");
  } finally {
    client.release();
  }
  res.redirect(`${PRICING}?tab=schools`);
}

// ---------- prices by country

// Free students for a time, and a school's own free students, need the 2026-11-20 database
// update; until it has run here, the forms say so (checked once a minute).
const columnChecks = new Map();
async function columnReady(table, column) {
  const key = `${table}.${column}`;
  const seen = columnChecks.get(key);
  if (seen && Date.now() - seen.at < 60000) return seen.ready;
  const ready = (await db.query(
    "SELECT 1 FROM information_schema.columns WHERE table_name = $1 AND column_name = $2", [table, column]
  ).catch(() => ({ rows: [] }))).rows.length > 0;
  columnChecks.set(key, { at: Date.now(), ready });
  return ready;
}
const freeMonthsReady = () => columnReady("plan_region_prices", "free_student_months");
const FREE_MONTHS_CHOICES = [1, 2, 3, 4, 5, 6, 9, 12];

async function regionFormGet(req, res) {
  if (!panelOnly(req, res, PRICING)) return;
  const [{ plans }, regions] = await Promise.all([loadPlans(), loadRegions()]);
  const regionId = toId(req.params.regionId);
  const region = regionId ? regions.find((r) => Number(r.id) === regionId) : null;
  if (regionId && !region) return panelMissing(res, "This price list no longer exists.");
  // Countries already priced elsewhere are marked, so moving one is a choice.
  const takenBy = {};
  regions.forEach((r) => r.countries.forEach((c) => { if (!region || Number(r.id) !== Number(region.id)) takenBy[c.country_code] = r.name; }));
  res.render("admin/forms/pricingRegion", {
    region,
    plans: plans.filter((p) => p.is_active || (region && region.prices.some((x) => Number(x.plan_id) === Number(p.id)))),
    countriesByContinent: COUNTRIES_BY_CONTINENT,
    takenBy,
    defaultMonths: parseInt(await setting("dynamic_term_months", "3"), 10) || 3,
    freeMonthsReady: await freeMonthsReady(),
    freeMonthsChoices: FREE_MONTHS_CHOICES,
  });
}

function parseRegionPrices(body, planIds) {
  const errors = [];
  const prices = [];
  const all = body.prices && typeof body.prices === "object" ? body.prices : {};
  // Fields are named prices[plan_<id>][...]: a bare number would be read as an array index.
  planIds.forEach((planId) => {
    const p = all[`plan_${planId}`] || {};
    const blank = ["base", "free", "rate"].every((k) => String(p[k] == null ? "" : p[k]).trim() === "");
    if (blank) return;
    const base = orgPricing.parsePrice(p.base);
    // Free students: a number, or a share of the school's students.
    const asPercent = p.freeUnit === "percent";
    const freeText = String(p.free == null ? "" : p.free).replace(/[%\s]/g, "") || "0";
    const free = Number(freeText);
    const rateText = String(p.rate == null ? "" : p.rate).replace(/[$,\s]/g, "");
    const rate = rateText ? Number(rateText) : 0;
    // How long the free students last: blank for always, or a school's first N months.
    const monthsText = String(p.freeMonths == null ? "" : p.freeMonths).trim();
    const freeMonths = monthsText ? Number(monthsText) : null;
    if (base == null || Number.isNaN(base)) errors.push("Enter each plan's monthly price.");
    else if (asPercent && (!Number.isFinite(free) || free < 0 || free > 100)) errors.push("A share of free students must be between 0 and 100%.");
    else if (!asPercent && (!Number.isInteger(free) || free < 0 || free > 1000000)) errors.push("Free students must be a whole number.");
    else if (!Number.isFinite(rate) || rate < 0 || rate > 100000) errors.push("Enter the price per student, or 0.");
    else if (freeMonths != null && (!Number.isInteger(freeMonths) || freeMonths < 1 || freeMonths > 36)) errors.push("Free students can be for a school's first 1 to 36 months, or always.");
    else prices.push({ planId, base, free: asPercent ? 0 : free, freePercent: asPercent ? Math.round(free * 100) / 100 : null, rate: Math.round(rate * 10000) / 10000, freeMonths });
  });
  return { errors: [...new Set(errors)], prices };
}

async function regionPost(req, res) {
  const regionId = toId(req.params.regionId);
  const name = String(req.body.name || "").trim().slice(0, 120);
  const months = Number.parseInt(req.body.termMonths, 10);
  const codes = [...new Set([].concat(req.body.countries || []).map((c) => String(c || "").trim().toUpperCase()).filter((c) => COUNTRY_NAME_LOOKUP[c]))];
  const wantsDefault = on(req.body.isDefault);
  const active = regionId ? on(req.body.isActive) : true;
  const back = `${PRICING}?tab=schools`;
  if (!name) { req.flash("error", "Give the price list a name."); return res.redirect(back); }
  if (!Number.isInteger(months) || months < 1 || months > 12) { req.flash("error", "Months per term must be between 1 and 12."); return res.redirect(back); }
  const planIds = (await db.query("SELECT id FROM plans")).rows.map((r) => Number(r.id));
  const { errors, prices } = parseRegionPrices(req.body, planIds);
  if (errors.length) { req.flash("error", errors.join(" ")); return res.redirect(back); }
  // Free students as a share need the 2026-11-13 database update.
  const percentReady = (await db.query(
    "SELECT 1 FROM information_schema.columns WHERE table_name = 'plan_region_prices' AND column_name = 'free_student_percent'"
  )).rows.length > 0;
  if (!percentReady && prices.some((p) => p.freePercent != null)) {
    req.flash("error", "Free students as a percentage need the 2026-11-13 database update first.");
    return res.redirect(back);
  }
  const monthsReady = await freeMonthsReady();
  if (!monthsReady && prices.some((p) => p.freeMonths != null)) {
    req.flash("error", "Free students for a school's first months need the 2026-11-20 database update first.");
    return res.redirect(back);
  }

  const client = await db.connect();
  try {
    await client.query("BEGIN");
    let id = regionId;
    if (id) {
      const current = (await client.query("SELECT id, is_default FROM pricing_regions WHERE id = $1 FOR UPDATE", [id])).rows[0];
      if (!current) throw Object.assign(new Error("This price list no longer exists."), { shown: true });
      if (current.is_default && (!wantsDefault || !active)) {
        throw Object.assign(new Error("One price list must stay the default for countries not listed anywhere. Make another one the default first."), { shown: true });
      }
      await client.query("UPDATE pricing_regions SET name = $2, is_active = $3, updated_at = NOW() WHERE id = $1", [id, name, active]);
    } else {
      const anyDefault = (await client.query("SELECT 1 FROM pricing_regions WHERE is_default = TRUE AND is_active = TRUE LIMIT 1")).rows.length > 0;
      id = (await client.query(
        "INSERT INTO pricing_regions (name, sort_order, is_default, is_active) VALUES ($1, 0, FALSE, TRUE) RETURNING id",
        [name]
      )).rows[0].id;
      if (!anyDefault) await client.query("UPDATE pricing_regions SET is_default = TRUE WHERE id = $1", [id]);
    }
    if (wantsDefault) {
      await client.query("UPDATE pricing_regions SET is_default = FALSE, updated_at = NOW() WHERE id <> $1 AND is_default = TRUE", [id]);
      await client.query("UPDATE pricing_regions SET is_default = TRUE, is_active = TRUE, updated_at = NOW() WHERE id = $1", [id]);
    }
    await client.query(
      `INSERT INTO app_settings (key, value) VALUES ($1, $2) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value`,
      [`dynamic_region_term_months_${id}`, String(months)]
    );
    // A country is priced by one list only: choosing it here moves it.
    if (codes.length) await client.query("DELETE FROM pricing_region_countries WHERE country_code = ANY($1::text[]) AND region_id <> $2", [codes, id]);
    await client.query("DELETE FROM pricing_region_countries WHERE region_id = $1 AND NOT (country_code = ANY($2::text[]))", [id, codes]);
    await client.query(
      `INSERT INTO pricing_region_countries (region_id, country_code, country_name)
       SELECT $1, c.code, c.name FROM unnest($2::text[], $3::text[]) AS c(code, name)
       ON CONFLICT (country_code) DO UPDATE SET region_id = EXCLUDED.region_id, country_name = EXCLUDED.country_name`,
      [id, codes, codes.map((c) => COUNTRY_NAME_LOOKUP[c])]
    );
    // Plan prices; each change is kept in the audit trail.
    for (const p of prices) {
      const previous = (await client.query(
        `SELECT base_price_usd, free_student_threshold, per_student_rate_usd${percentReady ? ", free_student_percent" : ", NULL AS free_student_percent"}${monthsReady ? ", free_student_months" : ", NULL AS free_student_months"}
           FROM plan_region_prices WHERE plan_id = $1 AND region_id = $2`,
        [p.planId, id]
      )).rows[0];
      const samePercent = (previous && previous.free_student_percent != null ? Number(previous.free_student_percent) : null) === p.freePercent;
      const sameMonths = (previous && previous.free_student_months != null ? Number(previous.free_student_months) : null) === p.freeMonths;
      const samePrices = previous && samePercent && Number(previous.base_price_usd) === p.base && Number(previous.free_student_threshold) === p.free && Number(previous.per_student_rate_usd) === p.rate;
      if (samePrices && sameMonths) continue;
      // How long the free students last, once the row exists.
      const saveMonths = () => (monthsReady && !sameMonths
        ? client.query("UPDATE plan_region_prices SET free_student_months = $3, updated_at = NOW() WHERE plan_id = $1 AND region_id = $2", [p.planId, id, p.freeMonths])
        : null);
      if (samePrices) { await saveMonths(); continue; }
      await client.query(
        percentReady
          ? `INSERT INTO plan_region_prices (plan_id, region_id, base_price_usd, free_student_threshold, per_student_rate_usd, free_student_percent, is_active)
             VALUES ($1, $2, $3, $4, $5, $6, TRUE)
             ON CONFLICT (plan_id, region_id) DO UPDATE SET base_price_usd = EXCLUDED.base_price_usd,
               free_student_threshold = EXCLUDED.free_student_threshold, per_student_rate_usd = EXCLUDED.per_student_rate_usd,
               free_student_percent = EXCLUDED.free_student_percent, updated_at = NOW()`
          : `INSERT INTO plan_region_prices (plan_id, region_id, base_price_usd, free_student_threshold, per_student_rate_usd, is_active)
             VALUES ($1, $2, $3, $4, $5, TRUE)
             ON CONFLICT (plan_id, region_id) DO UPDATE SET base_price_usd = EXCLUDED.base_price_usd,
               free_student_threshold = EXCLUDED.free_student_threshold, per_student_rate_usd = EXCLUDED.per_student_rate_usd, updated_at = NOW()`,
        percentReady ? [p.planId, id, p.base, p.free, p.rate, p.freePercent] : [p.planId, id, p.base, p.free, p.rate]
      );
      await client.query(
        `INSERT INTO plan_region_prices_audit (plan_id, region_id, old_base_price_usd, new_base_price_usd, old_free_student_threshold,
           new_free_student_threshold, old_per_student_rate_usd, new_per_student_rate_usd, changed_by_user_id)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
        [p.planId, id, previous ? Number(previous.base_price_usd) : null, p.base, previous ? Number(previous.free_student_threshold) : null, p.free,
          previous ? Number(previous.per_student_rate_usd) : null, p.rate, req.session.userId || null]
      ).catch((error) => { if (error.code !== "42P01") throw error; });
      await saveMonths();
    }
    await client.query("COMMIT");
    req.flash("success", `${name} saved.`);
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {});
    if (error.code === "23505") req.flash("error", "Another price list already has that name.");
    else {
      if (!error.shown) console.error("[Admin pricing] region:", error.message);
      req.flash("error", error.shown ? error.message : "Could not save the price list.");
    }
  } finally {
    client.release();
  }
  res.redirect(back);
}

async function regionDeletePost(req, res) {
  const regionId = toId(req.params.regionId);
  try {
    const region = (await db.query("SELECT name, is_default FROM pricing_regions WHERE id = $1", [regionId])).rows[0];
    if (!region) req.flash("error", "This price list no longer exists.");
    else if (region.is_default) req.flash("error", "The default price list can't be removed. Make another one the default first.");
    else {
      // Its countries and plan prices go with it; those schools then use the default list.
      await db.query("DELETE FROM pricing_regions WHERE id = $1", [regionId]);
      await db.query("DELETE FROM app_settings WHERE key = $1", [`dynamic_region_term_months_${regionId}`]);
      req.flash("success", `${region.name} removed. Its countries now use the default prices.`);
    }
  } catch (error) {
    console.error("[Admin pricing] region delete:", error.message);
    req.flash("error", "Could not remove the price list.");
  }
  res.redirect(`${PRICING}?tab=schools`);
}

// ---------- billing cycles (their lengths stay: schools' payments are stored by cycle)

async function cyclesPost(req, res) {
  try {
    // Fields are named cycles[cycle_<id>][...]: a bare number would be read as an array index.
    const rows = req.body.cycles && typeof req.body.cycles === "object" && !Array.isArray(req.body.cycles) ? req.body.cycles : {};
    const ids = Object.keys(rows).filter((key) => /^cycle_\d+$/.test(key)).map((key) => toId(key.slice(6))).filter(Boolean);
    const plan = [];
    for (const id of ids) {
      const row = rows[`cycle_${id}`] || {};
      const label = String(row.label || "").trim().slice(0, 60);
      const discount = Number(String(row.discount == null ? "" : row.discount).trim() || "0");
      if (!label) throw Object.assign(new Error("Every cycle needs a name."), { shown: true });
      if (!Number.isFinite(discount) || discount < 0 || discount > 50) throw Object.assign(new Error("A cycle's discount must be between 0 and 50%."), { shown: true });
      plan.push([id, label, Math.round(discount), on(row.active)]);
    }
    if (plan.length && !plan.some((p) => p[3])) throw Object.assign(new Error("Keep at least one billing cycle on."), { shown: true });
    await db.query(
      `UPDATE dynamic_billing_cycles c SET label = v.label, discount_percentage = v.discount, is_active = v.active, updated_at = NOW()
         FROM unnest($1::int[], $2::text[], $3::int[], $4::bool[]) AS v(id, label, discount, active)
        WHERE c.id = v.id`,
      [plan.map((p) => p[0]), plan.map((p) => p[1]), plan.map((p) => p[2]), plan.map((p) => p[3])]
    );
    req.flash("success", "Billing cycles saved.");
  } catch (error) {
    if (!error.shown) console.error("[Admin pricing] cycles:", error.message);
    req.flash("error", error.shown ? error.message : "Could not save the billing cycles.");
  }
  res.redirect(`${PRICING}?tab=schools`);
}

// ------------------------------------------------------------------ Organizations page

// Single schools (not in a hub), with what they pay.
async function loadSchools() {
  const ints = await hubBilling.integrationSql(db);
  const own = await db.query("SELECT custom_monthly_price FROM organizations LIMIT 0").then(() => true).catch(() => false);
  const rows = (await db.query(
    `SELECT o.organization_id, o.organization_name, o.nickname, o.on_hold, o.hold_by, o.max_users, o.created_at,
            o.first_name, o.last_name, o.email, o.organization_country, p.plan_name,
            ${own ? "o.custom_monthly_price, o.custom_discount_percent, o.custom_addon_prices" : "NULL::numeric AS custom_monthly_price, 0 AS custom_discount_percent, NULL::jsonb AS custom_addon_prices"},
            (SELECT COUNT(*)::int FROM users u WHERE u.organization_id = o.organization_id
               AND LOWER(COALESCE(u.account_type::text, '')) NOT IN ('admin', 'internal worker', 'mini admin')) AS user_count,
            pay.status AS payment_status, pay.next_payment_end_date, pay.billing_period_key,
            ${ints}
       FROM organizations o
       LEFT JOIN plans p ON p.id = o.plan_id
       LEFT JOIN LATERAL (
         SELECT status, next_payment_end_date, billing_period_key FROM payments
          WHERE organization_id = o.organization_id ORDER BY created_at DESC NULLS LAST LIMIT 1
       ) pay ON TRUE
      WHERE o.deleted = false AND (o.hub_id IS NULL OR COALESCE(o.is_hub_member, false) = false)
      ORDER BY LOWER(o.organization_name)`
  ).catch(async (error) => {
    if (error.code !== "42703" && error.code !== "42P01") throw error;
    // Older databases without payments.status or billing_period_key: the list without billing.
    return db.query(
      `SELECT o.organization_id, o.organization_name, o.nickname, o.on_hold, o.hold_by, o.max_users, o.created_at,
              o.first_name, o.last_name, o.email, o.organization_country, p.plan_name,
              NULL::numeric AS custom_monthly_price, 0 AS custom_discount_percent, NULL::jsonb AS custom_addon_prices, 0 AS user_count, ${ints}
         FROM organizations o LEFT JOIN plans p ON p.id = o.plan_id
        WHERE o.deleted = false AND (o.hub_id IS NULL OR COALESCE(o.is_hub_member, false) = false)
        ORDER BY LOWER(o.organization_name)`
    );
  })).rows;
  return rows.map((r) => ({
    ...r,
    addons: hubBilling.INTEGRATIONS.filter((i) => r[`int_${i.key}`]).map((i) => i.label),
    ownPricing: orgPricing.normalizeOverrides(r),
  }));
}

async function loadHubs() {
  await require("../utils/hubAccess").ensureHubAccessSchema(db);
  await hubBilling.ensureHubBillingSchema(db);
  return (await db.query(
    `SELECT h.*, (h.hub_password IS NOT NULL) AS has_password, p.plan_name,
            hb.status AS billing_status, hb.next_charge_at, hb.next_charge_amount, hb.currency AS billing_currency, hb.hold_starts_at,
            (SELECT COUNT(*)::int FROM hub_billing_charges c WHERE c.hub_id = h.hub_id AND c.status = 'pending') AS pending_charges,
            (SELECT COUNT(*)::int FROM hub_users hu WHERE hu.hub_id = h.hub_id) + 1 AS user_count,
            (SELECT COUNT(*)::int FROM organizations WHERE hub_id = h.hub_id AND deleted = false AND is_hub_member = true) AS org_count
       FROM managira_hubs h
       LEFT JOIN plans p ON h.plan_id = p.id
       LEFT JOIN hub_billing hb ON hb.hub_id = h.hub_id
      WHERE h.deleted = false
      ORDER BY h.created_at DESC`
  )).rows.map(({ hub_password, reset_password_token, ...hub }) => hub);
}

async function organizationsGet(req, res) {
  const isAdmin = req.session.accountType === "Admin";
  try {
    const [schools, hubs] = await Promise.all([loadSchools(), isAdmin ? loadHubs() : []]);
    res.render("admin/organizations", {
      title: "Organizations",
      tab: isAdmin && req.query.tab === "hubs" ? "hubs" : "schools",
      isAdmin,
      schools,
      hubs,
      billingStatus: hubBilling.STATUS,
      money: hubBilling.money,
      messages: req.flash(),
      showFooterTopSection: false,
    });
  } catch (error) {
    console.error("[Admin organizations]", error.message);
    req.flash("error", "Could not load the organizations.");
    res.redirect("/admin");
  }
}

async function schoolForPanel(organizationId) {
  return (await db.query(
    `SELECT o.*, p.plan_name FROM organizations o LEFT JOIN plans p ON p.id = o.plan_id
      WHERE o.organization_id = $1 AND o.deleted = false`,
    [organizationId]
  )).rows[0] || null;
}

async function schoolDetailsGet(req, res) {
  if (!panelOnly(req, res, ORGS)) return;
  const org = await schoolForPanel(toId(req.params.organizationId));
  if (!org) return panelMissing(res, "This school no longer exists.");
  const license = await require("../utils/licenses").orgLicense(db, org.organization_id);
  res.render("admin/forms/schoolDetails", { org, license, isAdmin: req.session.accountType === "Admin" });
}

// What the school pays now and with its own prices: the side panel previews as you type.
async function schoolPricingGet(req, res) {
  if (!panelOnly(req, res, ORGS)) return;
  const org = await schoolForPanel(toId(req.params.organizationId));
  if (!org) return panelMissing(res, "This school no longer exists.");
  if (org.hub_id && org.is_hub_member) return panelMissing(res, "This school is billed through its hub. Set its prices on the hub's Billing page.");
  const [standard, bill, schoolPrices, cycle] = await Promise.all([
    orgPricing.standardPlanMonthly(db, org).catch(() => ({ monthly: 0, students: 0, region: null })),
    orgPricing.standardPlanMonthly(db, org).then((s) => orgPricing.schoolBill(db, org.organization_id, s.monthly)).catch(() => null),
    orgPricing.standardAddonPrices(db),
    db.query(
      `SELECT c.label, c.months, c.discount_percentage FROM payments p JOIN dynamic_billing_cycles c ON c.cycle_key = p.billing_period_key
        WHERE p.organization_id = $1 ORDER BY p.created_at DESC NULLS LAST LIMIT 1`,
      [org.organization_id]
    ).then((r) => r.rows[0] || null).catch(() => null),
  ]);
  res.render("admin/forms/schoolPricing", {
    org,
    standard,
    bill,
    schoolPrices,
    cycle,
    integrations: hubBilling.INTEGRATIONS,
    unitOf: hubBilling.unitOf,
    unitLabel: hubBilling.unitLabel,
    maxDiscount: orgPricing.MAX_DISCOUNT,
    released: require("../utils/shards/features").isOn("addon_pricing", { organizationId: org.organization_id }),
    freeOwnReady: await columnReady("organizations", "custom_free_students"),
    freeMonthsChoices: FREE_MONTHS_CHOICES,
  });
}

async function schoolPricingPost(req, res) {
  const organizationId = toId(req.params.organizationId);
  try {
    const { errors, overrides } = orgPricing.parseOverrides(req.body);
    if (errors.length) {
      req.flash("error", errors.join(" "));
      return res.redirect(ORGS);
    }
    const saved = await orgPricing.saveOverrides(db, organizationId, overrides, req.session.userId || null);
    if (!saved) req.flash("error", "This school no longer exists.");
    else req.flash("success", `${saved.organization_name}: prices saved. They apply from its next bill.`);
  } catch (error) {
    if (error.code === "FREE_STUDENTS_COLUMN") req.flash("error", "A school's own free students need the 2026-11-20 database update first. Its other prices were saved.");
    else if (error.code === "42703") req.flash("error", "School prices need the 2026-11-13 database update first.");
    else {
      console.error("[Admin organizations] pricing:", error.message);
      req.flash("error", "Could not save the school's prices.");
    }
  }
  res.redirect(ORGS);
}

module.exports = {
  pricingGet,
  addonsPost,
  planFormGet,
  planPost,
  regionFormGet,
  regionPost,
  regionDeletePost,
  cyclesPost,
  organizationsGet,
  schoolDetailsGet,
  schoolPricingGet,
  schoolPricingPost,
};
