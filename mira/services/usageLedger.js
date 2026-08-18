// Per-tenant token/cost tracking and budget-cap enforcement. Checked
// before every model call in the orchestrator so a tenant that's hit its
// cap gets a graceful message instead of an unmetered bill.
const db = require("../config/db");
const { ensureMiraSchema } = require("../db/schema");

// Approximate $ per 1M tokens - for cost *estimation* only, not billing-grade
// precision. Update alongside TASK_MODEL_MAPS in modelRouter.js. OpenRouter
// generally passes through the underlying provider's own price, so these
// reuse the same figures as the direct-API entries above them.
const PRICING_PER_MILLION = {
  "gpt-4o-mini": { prompt: 0.15, completion: 0.6 },
  "claude-sonnet-4-5": { prompt: 3, completion: 15 },
  "openai/gpt-4o-mini": { prompt: 0.15, completion: 0.6 },
  "anthropic/claude-3.5-sonnet": { prompt: 3, completion: 15 },
  mock: { prompt: 0, completion: 0 },
};

function estimateCost(model, promptTokens, completionTokens) {
  const pricing = PRICING_PER_MILLION[model] || PRICING_PER_MILLION.mock;
  return (promptTokens * pricing.prompt + completionTokens * pricing.completion) / 1_000_000;
}

const DEFAULT_DAILY_CAP_USD = process.env.MIRA_DEFAULT_DAILY_CAP_USD ? Number(process.env.MIRA_DEFAULT_DAILY_CAP_USD) : null;
const DEFAULT_MONTHLY_CAP_USD = process.env.MIRA_DEFAULT_MONTHLY_CAP_USD ? Number(process.env.MIRA_DEFAULT_MONTHLY_CAP_USD) : null;

async function getTenantLimits(tenantId) {
  await ensureMiraSchema(db);
  const result = await db.query(`SELECT * FROM mira_tenant_limits WHERE tenant_id = $1`, [tenantId]);
  if (result.rows[0]) return result.rows[0];
  return {
    tenant_id: tenantId,
    daily_cost_cap_usd: DEFAULT_DAILY_CAP_USD,
    monthly_cost_cap_usd: DEFAULT_MONTHLY_CAP_USD,
  };
}

async function getSpend(tenantId) {
  await ensureMiraSchema(db);
  const result = await db.query(
    `SELECT
       COALESCE(SUM(estimated_cost_usd) FILTER (WHERE created_at >= date_trunc('day', now())), 0) AS today_usd,
       COALESCE(SUM(estimated_cost_usd) FILTER (WHERE created_at >= date_trunc('month', now())), 0) AS month_usd
     FROM mira_usage_ledger WHERE tenant_id = $1`,
    [tenantId]
  );
  return result.rows[0];
}

// Call before starting a turn. Returns {allowed: true} or
// {allowed: false, reason} - the orchestrator surfaces `reason` to the user
// verbatim as a graceful "limit reached" message rather than a raw error.
async function checkBudget(tenantId) {
  const [limits, spend] = await Promise.all([getTenantLimits(tenantId), getSpend(tenantId)]);

  if (limits.daily_cost_cap_usd != null && Number(spend.today_usd) >= Number(limits.daily_cost_cap_usd)) {
    return { allowed: false, reason: "Mira's daily usage limit for your school has been reached. It resets at midnight." };
  }
  if (limits.monthly_cost_cap_usd != null && Number(spend.month_usd) >= Number(limits.monthly_cost_cap_usd)) {
    return { allowed: false, reason: "Mira's monthly usage limit for your school has been reached." };
  }
  return { allowed: true };
}

async function recordUsage({ tenantId, userId, provider, model, promptTokens = 0, completionTokens = 0 }) {
  await ensureMiraSchema(db);
  const cost = estimateCost(model, promptTokens, completionTokens);
  await db.query(
    `INSERT INTO mira_usage_ledger (tenant_id, user_id, provider, model, prompt_tokens, completion_tokens, estimated_cost_usd)
     VALUES ($1, $2, $3, $4, $5, $6, $7)`,
    [tenantId, userId, provider || "unknown", model || "unknown", promptTokens, completionTokens, cost]
  );
  return { cost };
}

module.exports = { checkBudget, recordUsage, getTenantLimits, getSpend, estimateCost };
