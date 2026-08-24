// Default trial length. Org-wide (not per-seat): the whole school gets
// unlimited free seats for this window, starting the moment Mira is first
// activated. Once billing/pricing is actually built, whoever still holds a
// "Use Mira" grant after trial_ends_at becomes a billable seat at the next
// renewal - no proration, matching how every other billing change in this
// app already works (see jobs/recurringStripeBilling.js).
const DEFAULT_TRIAL_DAYS = 30;

let miraSchemaReady = false;

async function ensureMiraIntegrationSchema(dbClient) {
  if (miraSchemaReady) return;

  await dbClient.query(`
    ALTER TABLE organizations
      ADD COLUMN IF NOT EXISTS mira_activated BOOLEAN NOT NULL DEFAULT FALSE
  `);
  await dbClient.query(`
    ALTER TABLE organizations
      ADD COLUMN IF NOT EXISTS mira_trial_started_at TIMESTAMPTZ
  `);
  await dbClient.query(`
    ALTER TABLE organizations
      ADD COLUMN IF NOT EXISTS mira_trial_ends_at TIMESTAMPTZ
  `);

  miraSchemaReady = true;
}

function buildMiraIntegrationStatus(row = {}) {
  const activated = Boolean(row.mira_activated);
  const trialStartedAt = row.mira_trial_started_at || null;
  const trialEndsAt = row.mira_trial_ends_at || null;
  const trialActive = !!(trialEndsAt && new Date(trialEndsAt).getTime() > Date.now());
  const trialDaysRemaining = trialActive
    ? Math.max(0, Math.ceil((new Date(trialEndsAt).getTime() - Date.now()) / (24 * 60 * 60 * 1000)))
    : 0;

  return {
    activated,
    shouldShowFeatures: activated,
    trialStartedAt,
    trialEndsAt,
    trialActive,
    trialDaysRemaining,
    // trial was started at some point but has now lapsed - seats granted
    // are billable once real pricing/charging is wired up.
    trialEnded: !!(trialEndsAt && !trialActive),
  };
}

async function getMiraIntegrationStatus(dbClient, organizationId) {
  if (!organizationId) return buildMiraIntegrationStatus({});
  await ensureMiraIntegrationSchema(dbClient);

  let result = await dbClient.query(
    `SELECT mira_activated, mira_trial_started_at, mira_trial_ends_at
     FROM organizations
     WHERE organization_id = $1
     LIMIT 1`,
    [organizationId]
  );

  const row = result.rows[0] || {};
  // Backfill: an org activated before trial tracking existed has
  // mira_activated=TRUE but no trial dates - start their trial now rather
  // than leaving them in limbo (neither "on trial" nor "trial ended").
  if (row.mira_activated && !row.mira_trial_started_at) {
    result = await dbClient.query(
      `UPDATE organizations
       SET mira_trial_started_at = NOW(),
           mira_trial_ends_at = NOW() + ($2 || ' days')::interval
       WHERE organization_id = $1
       RETURNING mira_activated, mira_trial_started_at, mira_trial_ends_at`,
      [organizationId, String(DEFAULT_TRIAL_DAYS)]
    );
    return buildMiraIntegrationStatus(result.rows[0] || {});
  }

  return buildMiraIntegrationStatus(row);
}

// Activating no longer implicitly grants anyone access - it only turns the
// integration on for the org and (the first time only) starts the org-wide
// free trial clock. Every individual seat, owner included, still needs an
// explicit "Use Mira" grant via /account/mira.
async function setMiraIntegrationActivation(dbClient, organizationId, activated, { trialDays = DEFAULT_TRIAL_DAYS } = {}) {
  await ensureMiraIntegrationSchema(dbClient);

  if (activated) {
    await dbClient.query(
      `UPDATE organizations
       SET mira_activated = TRUE,
           mira_trial_started_at = COALESCE(mira_trial_started_at, NOW()),
           mira_trial_ends_at = COALESCE(mira_trial_ends_at, NOW() + ($2 || ' days')::interval)
       WHERE organization_id = $1`,
      [organizationId, String(trialDays)]
    );
    return;
  }

  await dbClient.query(
    `UPDATE organizations
     SET mira_activated = FALSE
     WHERE organization_id = $1`,
    [organizationId]
  );
}

module.exports = {
  ensureMiraIntegrationSchema,
  getMiraIntegrationStatus,
  setMiraIntegrationActivation,
  DEFAULT_TRIAL_DAYS,
};
