// Plans for hub schools. A plan decides what a school can use (its features).
// Managira gives each hub a default plan and the plans it may hand out; the
// hub can then give each of its schools one of those plans.
// A hub school's plan: the plan the hub gave it, else the hub's default plan,
// else its own plan.
const { invalidateOrganizationAccessCache } = require('./accessCache');

let ready = null;
function ensureHubPlanSchema(db) {
  if (!ready) {
    ready = (async () => {
      await db.query('ALTER TABLE organizations ADD COLUMN IF NOT EXISTS hub_assigned_plan_id INTEGER REFERENCES plans(id) ON DELETE SET NULL');
      await db.query(`ALTER TABLE managira_hubs ADD COLUMN IF NOT EXISTS allowed_plan_ids INTEGER[] NOT NULL DEFAULT '{}'`);
      await db.query('ALTER TABLE hub_organization_invitations ADD COLUMN IF NOT EXISTS hub_assigned_plan_id INTEGER REFERENCES plans(id) ON DELETE SET NULL');
    })().catch((err) => { ready = null; throw err; });
  }
  return ready;
}

async function activePlans(db) {
  return (await db.query('SELECT id, plan_name FROM plans WHERE is_active = true ORDER BY id')).rows;
}

// The plans a hub may give its schools (its default plan is always one of them).
async function plansForHub(db, hubId) {
  await ensureHubPlanSchema(db);
  const hub = (await db.query('SELECT plan_id, allowed_plan_ids FROM managira_hubs WHERE hub_id = $1', [hubId])).rows[0];
  if (!hub) return { defaultPlanId: null, defaultPlan: null, plans: [] };
  const all = await activePlans(db);
  const allowed = new Set((hub.allowed_plan_ids || []).map(Number));
  if (hub.plan_id) allowed.add(Number(hub.plan_id));
  const plans = all.filter((p) => allowed.has(Number(p.id)));
  return {
    defaultPlanId: hub.plan_id ? Number(hub.plan_id) : null,
    defaultPlan: all.find((p) => Number(p.id) === Number(hub.plan_id)) || null,
    plans,
  };
}

// Read the "plans the hub may give" checkboxes from an admin form.
function readAllowedPlans(body, validIds) {
  const raw = [].concat(body.allowedPlanIds || []).map((v) => parseInt(v, 10));
  const ok = new Set(validIds.map(Number));
  return Array.from(new Set(raw.filter((id) => ok.has(id))));
}

// Give a school a plan. planId null = use the hub's default plan.
// `any` lets Managira pick any active plan; a hub may only pick its own plans.
async function setSchoolPlan(db, hubId, organizationId, planId, { any = false } = {}) {
  await ensureHubPlanSchema(db);
  const school = (await db.query(
    'SELECT organization_id, organization_name FROM organizations WHERE organization_id = $1 AND hub_id = $2 AND deleted = false',
    [organizationId, hubId]
  )).rows[0];
  if (!school) return { ok: false, message: 'This school is not in the hub.' };
  let plan = null;
  if (planId) {
    const choices = any ? await activePlans(db) : (await plansForHub(db, hubId)).plans;
    plan = choices.find((p) => Number(p.id) === Number(planId));
    if (!plan) return { ok: false, message: 'That plan isn’t available for this hub.' };
  }
  await db.query('UPDATE organizations SET hub_assigned_plan_id = $1, updated_at = NOW() WHERE organization_id = $2', [plan ? plan.id : null, school.organization_id]);
  invalidateOrganizationAccessCache(school.organization_id);
  return { ok: true, school, plan };
}

module.exports = { ensureHubPlanSchema, activePlans, plansForHub, readAllowedPlans, setSchoolPlan };
