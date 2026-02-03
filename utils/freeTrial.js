const defaultDb = require("../config/db");

const normalizeEmail = (email = "") => email.trim().toLowerCase();

async function getFreeTrialSettings(dbClient = defaultDb) {
  try {
    const enabledResult = await dbClient.query(
      "SELECT value FROM app_settings WHERE key = 'free_trial_enabled'"
    );
    const daysResult = await dbClient.query(
      "SELECT value FROM app_settings WHERE key = 'free_trial_days'"
    );
    return {
      enabled: enabledResult.rows[0]?.value === "true",
      days: daysResult.rows[0]?.value || null,
    };
  } catch (err) {
    console.error("Error fetching trial settings:", err);
    return { enabled: false, days: null };
  }
}

function formatFreeTrialLength(value) {
  if (!value) {
    return null;
  }
  if (value === "5_minutes") {
    return "5 minutes";
  }
  const numeric = Number(value);
  if (!Number.isNaN(numeric) && numeric > 0) {
    return `${numeric} day${numeric === 1 ? "" : "s"}`;
  }
  return String(value);
}

async function getPremiumTrialPlan(dbClient = defaultDb) {
  const premiumResult = await dbClient.query(
    `
    SELECT id, plan_name, COALESCE(total_cost, 0) AS total_cost
    FROM plans
    WHERE is_active = TRUE
    ORDER BY
      CASE
        WHEN LOWER(plan_name) LIKE '%premium%' OR LOWER(plan_name) LIKE '%business%' THEN 0
        WHEN LOWER(plan_name) LIKE '%pro%' OR LOWER(plan_name) LIKE '%professional%' THEN 1
        ELSE 2
      END,
      COALESCE(total_cost, 0) DESC
    LIMIT 1
  `
  );
  return premiumResult.rows[0] || null;
}

async function hasEmailLockedTrial(email, dbClient = defaultDb) {
  const normalized = normalizeEmail(email);
  if (!normalized) {
    return false;
  }
  // Has this email ever completed a trial payment?
  const trialPayment = await dbClient.query(
    `
      SELECT 1
      FROM payments p
      JOIN organizations o ON o.organization_id = p.organization_id
      WHERE LOWER(o.email) = $1
        AND p.is_trial = TRUE
      LIMIT 1
    `,
    [normalized]
  );
  if (trialPayment.rows.length > 0) {
    return true;
  }
  // Fallback: an organization with this email that still has a trial window
  const trialOrg = await dbClient.query(
    `
      SELECT 1
      FROM organizations o
      WHERE LOWER(o.email) = $1
        AND o.trial_active_until IS NOT NULL
      LIMIT 1
    `,
    [normalized]
  );
  return trialOrg.rows.length > 0;
}

module.exports = {
  getFreeTrialSettings,
  formatFreeTrialLength,
  getPremiumTrialPlan,
  hasEmailLockedTrial,
};
