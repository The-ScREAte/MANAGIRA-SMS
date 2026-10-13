// Hub billing pages: Admin › Hubs › Billing (the contract, charges, payment
// link, holds), the hub's own Billing page, and the public card link that is
// emailed to the hub. The billing rules live in utils/hubBilling.js.
const crypto = require('crypto');
const db = require('../config/db');
const billing = require('../utils/hubBilling');
const { ensureHubAccessSchema, HUB_ROLES, actorCan } = require('../utils/hubAccess');
const { parseLimit, hubLicense } = require('../utils/licenses');
const { renderCleanEmail, sendEmailInBackground } = require('../utils/emailHelper');

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const INVITE_DAYS = 7;

// Where links in emails point (the live site), and where Stripe sends people
// back to (the site they are on now, so they stay signed in).
const appBase = (res) => String(res.locals.BASE_URL || process.env.BASE_URL_PRODUCTION || process.env.BASE_URL || 'https://managira.com').replace(/\/$/, '');
const hereBase = (req) => `${req.protocol}://${req.get('host')}`;
const adminLabel = (req) => [req.session.firstName, req.session.lastName].filter(Boolean).join(' ') || 'Managira';
const hubActorLabel = (req) => {
  const a = req.hubActor;
  if (a && a.user) return `${a.user.first_name} ${a.user.last_name}`.trim();
  if (req.session && req.session.adminHubView) return 'Managira';
  return [req.session.firstName, req.session.lastName].filter(Boolean).join(' ') || 'Hub owner';
};
const hubIdParam = (req) => {
  const id = parseInt(req.params.hubId, 10);
  return Number.isInteger(id) && id > 0 ? id : null;
};
const errText = (err, fallback) => (err instanceof billing.BillingError ? err.message : fallback);

// People who sign in to the hub, added by Managira (e.g. the hub's finance team).
// "billing" people are hub users who see billing and reports.
const BILLING_PERMISSIONS = ['billing.view', 'billing.manage', 'reports.view', 'schools.view'];

async function inviteHubPerson(hubId, person, { baseUrl, by }) {
  const token = crypto.randomBytes(32).toString('hex');
  await db.query(
    `UPDATE hub_users SET reset_password_token = $1, reset_password_expires = $2, updated_at = NOW() WHERE hub_user_id = $3`,
    [crypto.createHash('sha256').update(token).digest('hex'), new Date(Date.now() + INVITE_DAYS * 86400000), person.hub_user_id]
  );
  const hub = (await db.query('SELECT hub_name FROM managira_hubs WHERE hub_id = $1', [hubId])).rows[0] || {};
  const role = person.role === 'hub_admin' ? HUB_ROLES.hub_admin.label.toLowerCase() : 'billing contact';
  sendEmailInBackground({
    from: process.env.NOTIFY_EMAIL_USER,
    to: person.email,
    subject: `You have been added to ${hub.hub_name || 'a hub'} on Managira`,
    html: renderCleanEmail({
      title: `Welcome to ${hub.hub_name || 'your hub'}`,
      greeting: `Hello ${person.first_name},`,
      paragraphs: [
        `${by} added you to ${hub.hub_name || 'the hub'} on Managira as a ${role}.`,
        `Set your password with the button below (the link works for ${INVITE_DAYS} days). Then sign in at ${baseUrl}/hub/login with ${person.email}.`,
        person.role === 'hub_admin' ? 'You will see everything in the hub, including Billing.' : 'You will see the hub’s Billing page, its reports and schools.',
      ],
      cta: { text: 'Set your password', url: `${baseUrl}/hub/setup-password?token=${token}` },
    }),
  }, 'Hub person invite');
}

async function emailTaken(email, exceptHubUserId = null) {
  const r = await db.query(
    `SELECT 1 FROM managira_hubs WHERE LOWER(hub_email) = LOWER($1)
     UNION ALL SELECT 1 FROM hub_users WHERE LOWER(email) = LOWER($1) AND ($2::int IS NULL OR hub_user_id <> $2)
     LIMIT 1`,
    [email, exceptHubUserId]
  );
  return r.rows.length > 0;
}

// Read the people rows from a form: people[i][firstName|lastName|email|role].
function readPeople(body) {
  const raw = body.people ? (Array.isArray(body.people) ? body.people : Object.values(body.people)) : [];
  return raw
    .map((p) => ({
      firstName: String((p && p.firstName) || '').trim().slice(0, 100),
      lastName: String((p && p.lastName) || '').trim().slice(0, 100),
      email: String((p && p.email) || '').trim().toLowerCase().slice(0, 255),
      role: p && p.role === 'hub_admin' ? 'hub_admin' : 'billing',
    }))
    .filter((p) => p.firstName || p.lastName || p.email);
}

async function checkPeople(people, ownerEmail) {
  const seen = new Set([String(ownerEmail || '').toLowerCase()]);
  for (const p of people) {
    if (!p.firstName || !p.email) return 'Each person needs a first name and an email.';
    if (!EMAIL_RE.test(p.email)) return `${p.email} doesn’t look like an email address.`;
    if (seen.has(p.email)) return `${p.email} is listed twice.`;
    seen.add(p.email);
    if (await emailTaken(p.email)) return `${p.email} already signs in to a hub. Use a different email.`;
  }
  return '';
}

async function addPeople(hubId, people, { baseUrl, by }) {
  await ensureHubAccessSchema(db);
  for (const p of people) {
    const role = p.role === 'hub_admin' ? 'hub_admin' : 'hub_user';
    const row = (await db.query(
      `INSERT INTO hub_users (hub_id, first_name, last_name, email, role, permissions, created_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING *`,
      [hubId, p.firstName, p.lastName || '', p.email, role, role === 'hub_admin' ? [] : BILLING_PERMISSIONS, by]
    )).rows[0];
    await inviteHubPerson(hubId, row, { baseUrl, by });
    await db.query(
      'INSERT INTO hub_activity_logs (hub_id, action_type, description, performed_by) VALUES ($1, $2, $3, $4)',
      [hubId, 'USER_ADDED', `${p.firstName} ${p.lastName} was added by Managira as a ${role === 'hub_admin' ? 'hub admin' : 'billing contact'}`, by]
    ).catch(() => {});
  }
}

// Contract dates / schools included / user licenses are hub columns.
function readHubTerms(body) {
  const errors = [];
  const maxOrganizations = parseInt(body.maxOrganizations, 10);
  if (!Number.isInteger(maxOrganizations) || maxOrganizations < 1) errors.push('Schools included must be 1 or more.');
  return {
    errors,
    values: {
      max_organizations: Number.isInteger(maxOrganizations) && maxOrganizations > 0 ? Math.min(maxOrganizations, 100000) : 1,
      max_users: parseLimit(body.maxUsers),
      contract_start_date: billing.isoDay(body.contractStartDate) || null,
      contract_end_date: billing.isoDay(body.contractEndDate) || null,
    },
  };
}

// When a hub is out of school places or user licenses. If its plan has a price
// for extras, someone who manages billing can approve one more; the charge is
// added once the school / user is actually added (call commit()).
// Returns { blocked } (a reply was sent) or { commit }.
async function extraGate(req, res, kind, back) {
  const hubId = req.session.hubId;
  const cap = await billing.capacity(db, hubId, kind);
  const go = { blocked: false, commit: async () => {} };
  if (!cap || !cap.full) return go;
  const what = kind === 'school' ? 'school' : 'user license';
  const has = kind === 'school' ? `${cap.limit} school${cap.limit === 1 ? '' : 's'}` : `${cap.limit} user license${cap.limit === 1 ? '' : 's'}`;
  const ajax = req.get('X-Hub-Ajax') === '1';
  const stop = (message) => {
    req.flash('error', message);
    res.redirect(back);
    return { blocked: true };
  };
  const inUse = kind === 'school' && cap.pending ? ` (${cap.members} in the hub, ${cap.pending} invited)` : '';
  if (!cap.canBuy) return stop(`Your plan has ${has} and all are in use${inUse}. Contact Managira to add more.`);
  const price = `${billing.money(cap.price, cap.currency)} each ${cap.per}`;
  if (!actorCan(req.hubActor, 'billing.manage') || req.session.adminHubView) {
    return stop(`Your plan has ${has} and all are in use${inUse}. One more costs ${price}. Ask a hub admin who manages billing to approve it.`);
  }
  if (req.body.approve_extra === '1') {
    return {
      blocked: false,
      commit: async () => {
        await billing.approveExtra(db, hubId, kind, { by: hubActorLabel(req) }).catch((err) => console.error('[extraGate]', err.message));
        billing.syncSubscription(db, hubId).catch(() => {});
      },
    };
  }
  const when = kind === 'school' ? 'once the school joins' : 'from now on';
  const text = `Your plan has ${has} and all are in use${inUse}. One more ${what} adds ${price} to your bill ${when}. Do you approve this charge?`;
  if (ajax) {
    res.json({ success: false, needsApproval: true, message: text, approval: { title: `Add one more ${what}?`, text, ok: 'Approve and continue' } });
    return { blocked: true };
  }
  return stop(`${text} Approve it from the form to continue.`);
}

// Side-panel forms (Admin › Hubs) are fetched with ?drawer=1. Opened any other
// way, go to their page with the panel open.
function panelOnly(req, res, page) {
  if (res.locals.drawer) return true;
  res.redirect(`${page}?drawer=${encodeURIComponent(req.originalUrl.split('?')[0])}`);
  return false;
}
const panelMissing = (res, text) => res.status(404).send(`<p class="ahd-missing">${text}</p>`);

async function hubForPanel(hubId) {
  await require('../utils/hubPlans').ensureHubPlanSchema(db);
  return (await db.query(
    `SELECT hub_id, hub_name, hub_nickname, hub_email, first_name, last_name, hub_phone, hub_address, plan_id, allowed_plan_ids,
            max_organizations, max_users, contract_start_date, contract_end_date, hub_footer_text, hub_branding_enabled,
            on_hold, deleted, created_at
       FROM managira_hubs WHERE hub_id = $1`,
    [hubId]
  )).rows[0] || null;
}

const hubBillingController = {
  extraGate,
  readPeople,
  checkPeople,
  addPeople,
  readHubTerms,

  // ------------------------------------------------------------ admin side panels

  adminHubCreateFormGet: async (req, res) => {
    if (!panelOnly(req, res, '/admin/hubs')) return;
    await billing.ensureHubBillingSchema(db);
    const plans = (await db.query('SELECT id, plan_name FROM plans WHERE is_active = true ORDER BY id')).rows;
    res.render('admin/forms/hubCreate', { plans, b: billing });
  },

  adminHubEditFormGet: async (req, res) => {
    if (!panelOnly(req, res, '/admin/hubs')) return;
    const hub = await hubForPanel(hubIdParam(req));
    if (!hub) return panelMissing(res, 'This hub no longer exists.');
    const plans = (await db.query('SELECT id, plan_name FROM plans WHERE is_active = true ORDER BY id')).rows;
    res.render('admin/forms/hubEdit', { hub, plans });
  },

  adminHubPasswordFormGet: async (req, res) => {
    if (!panelOnly(req, res, '/admin/hubs')) return;
    const hub = await hubForPanel(hubIdParam(req));
    if (!hub) return panelMissing(res, 'This hub no longer exists.');
    res.render('admin/forms/hubPassword', { hub, loginUrl: `${appBase(res)}/hub/login` });
  },

  adminSchoolLicensesFormGet: async (req, res) => {
    const hubId = hubIdParam(req);
    if (!panelOnly(req, res, `/admin/hubs/${hubId}/organizations`)) return;
    const org = (await db.query(
      'SELECT organization_id, organization_name, max_users FROM organizations WHERE organization_id = $1 AND hub_id = $2',
      [req.params.organizationId, hubId]
    )).rows[0];
    if (!org) return panelMissing(res, 'This school is not in the hub.');
    const license = await require('../utils/licenses').orgLicense(db, org.organization_id);
    res.render('admin/forms/schoolLicenses', { org, license });
  },

  // A school's plan inside a hub (Managira can pick any active plan).
  adminSchoolPlanFormGet: async (req, res) => {
    const hubId = hubIdParam(req);
    if (!panelOnly(req, res, `/admin/hubs/${hubId}/organizations`)) return;
    const hubPlans = require('../utils/hubPlans');
    await hubPlans.ensureHubPlanSchema(db);
    const org = (await db.query(
      'SELECT organization_id, organization_name, hub_assigned_plan_id FROM organizations WHERE organization_id = $1 AND hub_id = $2 AND deleted = false',
      [req.params.organizationId, hubId]
    )).rows[0];
    if (!org) return panelMissing(res, 'This school is not in the hub.');
    const forHub = await hubPlans.plansForHub(db, hubId);
    res.render('admin/forms/schoolPlan', { org, hubId, plans: await hubPlans.activePlans(db), hubPlanIds: forHub.plans.map((p) => Number(p.id)), defaultPlan: forHub.defaultPlan });
  },

  adminSchoolPlanPost: async (req, res) => {
    const hubId = hubIdParam(req);
    const back = `/admin/hubs/${hubId}/organizations`;
    try {
      const set = await require('../utils/hubPlans').setSchoolPlan(db, hubId, req.params.organizationId, parseInt(req.body.planId, 10) || null, { any: true });
      if (!set.ok) { req.flash('error', set.message); return res.redirect(back); }
      await db.query(
        'INSERT INTO hub_activity_logs (hub_id, action_type, target_organization_id, description, performed_by) VALUES ($1, $2, $3, $4, $5)',
        [hubId, 'organization_updated', set.school.organization_id, `${set.school.organization_name} is now on ${set.plan ? set.plan.plan_name : 'the hub’s default plan'}`, adminLabel(req)]
      ).catch(() => {});
      req.flash('success', `${set.school.organization_name}: ${set.plan ? set.plan.plan_name : 'hub default plan'}.`);
    } catch (err) {
      console.error('[adminSchoolPlanPost]', err.message);
      req.flash('error', 'Could not change the plan.');
    }
    res.redirect(back);
  },

  adminPlanFormGet: async (req, res) => {
    const hubId = hubIdParam(req);
    if (!panelOnly(req, res, `/admin/hubs/${hubId}/billing`)) return;
    const hub = await hubForPanel(hubId);
    if (!hub) return panelMissing(res, 'This hub no longer exists.');
    const data = await billing.overview(db, hubId);
    res.render('admin/forms/hubPlan', {
      hub,
      billingRow: data.billing,
      usage: data.usage,
      extrasTotal: data.bill.lines.filter((l) => l.recurring && String(l.key).startsWith('charge:')).reduce((sum, l) => sum + l.amount, 0),
      hasSub: !!(data.billing && data.billing.stripe_subscription_id && !data.billing.ended_at),
      b: billing,
    });
  },

  adminChargeFormGet: async (req, res) => {
    const hubId = hubIdParam(req);
    if (!panelOnly(req, res, `/admin/hubs/${hubId}/billing`)) return;
    const hub = await hubForPanel(hubId);
    if (!hub) return panelMissing(res, 'This hub no longer exists.');
    const b = await billing.loadBilling(db, hubId);
    if (!billing.billingLive(b)) return panelMissing(res, 'Set a price for this hub first.');
    // "Add charge" for a school using a manual-fee integration: filled in.
    let preset = null;
    const fee = billing.integrationFeesOf(b)[req.query.integration];
    const orgId = parseInt(req.query.org, 10);
    if (fee && fee.on && Number.isInteger(orgId)) {
      const org = (await db.query('SELECT organization_id, organization_name FROM organizations WHERE organization_id = $1 AND hub_id = $2', [orgId, hubId])).rows[0];
      if (org) {
        const label = billing.INTEGRATION_BY_KEY[req.query.integration].label;
        preset = { integrationKey: req.query.integration, organizationId: org.organization_id, name: `${label}: ${org.organization_name}`.slice(0, 120), price: Number(fee.price), description: `${org.organization_name} uses ${label}.` };
      }
    }
    res.render('admin/forms/hubCharge', { hub, preset, per: (billing.CYCLES[b.billing_cycle] || billing.CYCLES.month).per, addons: await billing.listAddons(db, { activeOnly: true }), b: billing });
  },

  adminHoldFormGet: async (req, res) => {
    const hubId = hubIdParam(req);
    if (!panelOnly(req, res, `/admin/hubs/${hubId}/billing`)) return;
    const hub = await hubForPanel(hubId);
    if (!hub) return panelMissing(res, 'This hub no longer exists.');
    res.render('admin/forms/hubHold', { hub, billingRow: await billing.loadBilling(db, hubId), b: billing });
  },

  adminEndFormGet: async (req, res) => {
    const hubId = hubIdParam(req);
    if (!panelOnly(req, res, `/admin/hubs/${hubId}/billing`)) return;
    const hub = await hubForPanel(hubId);
    if (!hub) return panelMissing(res, 'This hub no longer exists.');
    res.render('admin/forms/hubEnd', { hub, billingRow: await billing.loadBilling(db, hubId), b: billing });
  },

  adminPersonFormGet: async (req, res) => {
    const hubId = hubIdParam(req);
    if (!panelOnly(req, res, `/admin/hubs/${hubId}/billing`)) return;
    const hub = await hubForPanel(hubId);
    if (!hub) return panelMissing(res, 'This hub no longer exists.');
    res.render('admin/forms/hubPerson', { hub, license: await hubLicense(db, hubId) });
  },

  adminAddonFormGet: async (req, res) => {
    if (!panelOnly(req, res, '/admin/hubs/add-ons')) return;
    await billing.ensureHubBillingSchema(db);
    let addon = null;
    if (req.params.addonId) {
      addon = (await db.query('SELECT * FROM hub_billing_addons WHERE addon_id = $1', [req.params.addonId])).rows[0];
      if (!addon) return panelMissing(res, 'This add-on no longer exists.');
    }
    res.render('admin/forms/hubAddon', { addon });
  },

  // ------------------------------------------------------------ admin

  adminBillingGet: async (req, res) => {
    const hubId = hubIdParam(req);
    try {
      await billing.ensureHubBillingSchema(db);
      await ensureHubAccessSchema(db);
      const hubRow = (await db.query(
        `SELECT h.*, p.plan_name FROM managira_hubs h LEFT JOIN plans p ON p.id = h.plan_id WHERE h.hub_id = $1`,
        [hubId]
      )).rows[0];
      if (!hubRow) {
        req.flash('error', 'Hub not found.');
        return res.redirect('/admin/hubs');
      }
      const { hub_password, reset_password_token, ...hub } = hubRow;
      // Show the saved numbers now; Stripe catches up in the background and the
      // page refreshes itself when it's done.
      const refreshing = billing.isStale(await billing.loadBilling(db, hubId), 20000);
      if (refreshing) billing.refreshInBackground(db, hubId);
      const data = await billing.overview(db, hubId);
      const [people, addons, activity] = await Promise.all([
        db.query(
          `SELECT hub_user_id, first_name, last_name, email, role, permissions, on_hold, (password IS NOT NULL) AS has_password, last_login_at
             FROM hub_users WHERE hub_id = $1 ORDER BY CASE role WHEN 'hub_admin' THEN 0 ELSE 1 END, first_name`,
          [hubId]
        ).then((r) => r.rows),
        billing.listAddons(db, { activeOnly: true }),
        db.query(
          `SELECT action_type, description, performed_by, created_at FROM hub_activity_logs
            WHERE hub_id = $1 AND action_type LIKE 'BILLING%' ORDER BY created_at DESC LIMIT 12`,
          [hubId]
        ).then((r) => r.rows),
      ]);
      const link = data.live ? await billing.setupLink(db, hubId, appBase(res)) : '';
      res.render('admin/hubBilling', {
        title: `Billing · ${hub.hub_name}`,
        ...data,
        hub: { ...hub, has_password: !!hub_password },
        extrasTotal: data.bill.lines.filter((l) => l.recurring && String(l.key).startsWith('charge:')).reduce((sum, l) => sum + l.amount, 0),
        people,
        addons,
        activity,
        setupUrl: link,
        license: await hubLicense(db, hubId),
        b: billing,
        hasSub: !!(data.billing && data.billing.stripe_subscription_id && !data.billing.ended_at),
        refreshing,
        messages: req.flash(),
        showFooterTopSection: false,
      });
    } catch (err) {
      console.error('[adminBillingGet]', err.message);
      req.flash('error', 'Could not load billing for this hub.');
      res.redirect('/admin/hubs');
    }
  },

  adminBillingSavePost: async (req, res) => {
    const hubId = hubIdParam(req);
    const back = `/admin/hubs/${hubId}/billing`;
    try {
      const terms = readHubTerms(req.body);
      const contract = billing.parseContractForm(req.body);
      const errors = [...terms.errors, ...contract.errors];
      if (errors.length) {
        req.flash('error', errors.join(' '));
        return res.redirect(back);
      }
      await db.query(
        `UPDATE managira_hubs SET max_organizations = $1, max_users = $2, contract_start_date = $3, contract_end_date = $4, updated_at = NOW()
          WHERE hub_id = $5`,
        [terms.values.max_organizations, terms.values.max_users, terms.values.contract_start_date, terms.values.contract_end_date, hubId]
      );
      await billing.saveContract(db, hubId, contract.values, { by: adminLabel(req) });
      try {
        await billing.syncSubscription(db, hubId);
        req.flash('success', 'Billing saved. Stripe is up to date.');
      } catch (err) {
        req.flash('error', `Billing saved, but Stripe said: ${errText(err, 'it could not be updated')}`);
      }
    } catch (err) {
      console.error('[adminBillingSavePost]', err.message);
      req.flash('error', 'Could not save billing.');
    }
    res.redirect(back);
  },

  adminSendLinkPost: async (req, res) => {
    const hubId = hubIdParam(req);
    try {
      if (req.body.rotate === '1') await billing.setupLink(db, hubId, appBase(res), { rotate: true });
      const { sent } = await billing.sendSetupLink(db, hubId, { baseUrl: appBase(res), by: adminLabel(req) });
      req.flash('success', sent ? `Payment link emailed to ${sent} ${sent === 1 ? 'person' : 'people'}.` : 'Nobody is set to get billing emails for this hub. Add a billing email or person first.');
    } catch (err) {
      req.flash('error', errText(err, 'Could not send the payment link.'));
    }
    res.redirect(`/admin/hubs/${hubId}/billing`);
  },

  adminNewLinkPost: async (req, res) => {
    const hubId = hubIdParam(req);
    try {
      await billing.setupLink(db, hubId, appBase(res), { rotate: true });
      req.flash('success', 'New payment link made. The old link no longer works.');
    } catch (err) {
      req.flash('error', 'Could not make a new link.');
    }
    res.redirect(`/admin/hubs/${hubId}/billing`);
  },

  adminSyncPost: async (req, res) => {
    const hubId = hubIdParam(req);
    try {
      await billing.syncSubscription(db, hubId);
      await billing.refresh(db, hubId);
      req.flash('success', 'Up to date with Stripe.');
    } catch (err) {
      req.flash('error', errText(err, 'Could not reach Stripe.'));
    }
    res.redirect(`/admin/hubs/${hubId}/billing`);
  },

  adminChargeAddPost: async (req, res) => {
    const hubId = hubIdParam(req);
    const back = `/admin/hubs/${hubId}/billing#charges`;
    try {
      let fields;
      const addonId = parseInt(req.body.addonId, 10);
      const quantity = Math.max(1, Math.min(100000, parseInt(req.body.quantity, 10) || 1));
      if (Number.isInteger(addonId)) {
        const addon = (await db.query('SELECT * FROM hub_billing_addons WHERE addon_id = $1 AND is_active = true', [addonId])).rows[0];
        if (!addon) { req.flash('error', 'That add-on was not found.'); return res.redirect(back); }
        fields = { kind: 'addon', addonId, name: addon.name, description: addon.description, unitPrice: Number(addon.unit_price), quantity, frequency: addon.frequency };
      } else {
        const name = String(req.body.name || '').trim();
        const price = billing.parseMoney(req.body.unitPrice, { label: 'Price', allowBlank: false });
        if (!name) { req.flash('error', 'Give the charge a name.'); return res.redirect(back); }
        if (price.error || !(price.value > 0)) { req.flash('error', price.error || 'Enter a price above 0.'); return res.redirect(back); }
        fields = { kind: 'custom', name, description: String(req.body.description || '').trim().slice(0, 500) || null, unitPrice: price.value, quantity, frequency: req.body.frequency === 'once' ? 'once' : 'recurring' };
        // A charge for a school's integration (manual integration fee).
        if (billing.INTEGRATION_BY_KEY[req.body.integrationKey]) {
          const org = (await db.query('SELECT organization_id FROM organizations WHERE organization_id = $1 AND hub_id = $2', [req.body.organizationId, hubId])).rows[0];
          if (org) Object.assign(fields, { kind: 'integration', integrationKey: req.body.integrationKey, organizationId: org.organization_id });
        }
      }
      await billing.requestCharge(db, hubId, fields, { baseUrl: appBase(res), by: adminLabel(req) });
      req.flash('success', `${fields.name} sent to the hub for approval. It is billed once they approve it.`);
    } catch (err) {
      console.error('[adminChargeAddPost]', err.message);
      req.flash('error', errText(err, 'Could not add the charge.'));
    }
    res.redirect(back);
  },

  adminChargeRemovePost: async (req, res) => {
    const hubId = hubIdParam(req);
    try {
      const c = await billing.removeCharge(db, hubId, parseInt(req.params.chargeId, 10), { by: adminLabel(req) });
      req.flash('success', `${c.name} removed.`);
    } catch (err) {
      req.flash('error', errText(err, 'Could not remove the charge.'));
    }
    res.redirect(`/admin/hubs/${hubId}/billing#charges`);
  },

  adminHoldPost: async (req, res) => {
    const hubId = hubIdParam(req);
    const back = `/admin/hubs/${hubId}/billing`;
    try {
      const endsAt = billing.dayAtNoon(req.body.endsOn);
      if (req.body.when === 'later') {
        const startsAt = billing.dayAtNoon(req.body.startsOn);
        if (!startsAt || startsAt <= new Date()) { req.flash('error', 'Pick a start day in the future.'); return res.redirect(back); }
        if (endsAt && endsAt <= startsAt) { req.flash('error', 'The hold must end after it starts.'); return res.redirect(back); }
        await billing.scheduleHold(db, hubId, { startsAt, endsAt, by: adminLabel(req) });
        req.flash('success', `Hold scheduled for ${billing.fmtDate(startsAt)}. Billing pauses that day.`);
      } else {
        if (endsAt && endsAt <= new Date()) { req.flash('error', 'Pick an end day in the future, or leave it empty.'); return res.redirect(back); }
        await billing.holdNow(db, hubId, { endsAt, by: adminLabel(req) });
        req.flash('success', `Hub is on hold${endsAt ? ` until ${billing.fmtDate(endsAt)}` : ''}. No bills are charged while it is on hold.`);
      }
    } catch (err) {
      console.error('[adminHoldPost]', err.message);
      req.flash('error', errText(err, 'Could not put the hub on hold.'));
    }
    res.redirect(back);
  },

  adminResumePost: async (req, res) => {
    const hubId = hubIdParam(req);
    try {
      await billing.resumeNow(db, hubId, { by: adminLabel(req) });
      req.flash('success', 'Hub resumed. Billing continues.');
    } catch (err) {
      req.flash('error', errText(err, 'Could not resume the hub.'));
    }
    res.redirect(`/admin/hubs/${hubId}/billing`);
  },

  adminCancelHoldPost: async (req, res) => {
    const hubId = hubIdParam(req);
    await billing.cancelScheduledHold(db, hubId, { by: adminLabel(req) }).catch(() => {});
    req.flash('success', 'Scheduled hold cancelled.');
    res.redirect(`/admin/hubs/${hubId}/billing`);
  },

  adminEndPost: async (req, res) => {
    const hubId = hubIdParam(req);
    try {
      const now = req.body.when === 'now';
      await billing.endBilling(db, hubId, { now, by: adminLabel(req) });
      req.flash('success', now ? 'Billing ended. The card won’t be charged again.' : 'Billing ends at the end of the current period.');
    } catch (err) {
      req.flash('error', errText(err, 'Could not end billing.'));
    }
    res.redirect(`/admin/hubs/${hubId}/billing`);
  },

  adminRestartPost: async (req, res) => {
    const hubId = hubIdParam(req);
    try {
      await billing.restartBilling(db, hubId, { by: adminLabel(req) });
      req.flash('success', 'Billing is on again.');
    } catch (err) {
      req.flash('error', errText(err, 'Could not restart billing.'));
    }
    res.redirect(`/admin/hubs/${hubId}/billing`);
  },

  adminPersonAddPost: async (req, res) => {
    const hubId = hubIdParam(req);
    const back = `/admin/hubs/${hubId}/billing#people`;
    try {
      const people = readPeople({ people: [req.body] });
      const hub = (await db.query('SELECT hub_email FROM managira_hubs WHERE hub_id = $1', [hubId])).rows[0];
      if (!hub || !people.length) { req.flash('error', 'Add a name and email.'); return res.redirect(back); }
      const problem = await checkPeople(people, hub.hub_email);
      if (problem) { req.flash('error', problem); return res.redirect(back); }
      const license = await hubLicense(db, hubId);
      if (license.full) { req.flash('error', `All ${license.max} user licenses are used. Raise the user licenses first.`); return res.redirect(back); }
      await addPeople(hubId, people, { baseUrl: appBase(res), by: adminLabel(req) });
      req.flash('success', `${people[0].firstName} was added. We emailed ${people[0].email} a link to set their password.`);
    } catch (err) {
      console.error('[adminPersonAddPost]', err.message);
      req.flash('error', 'Could not add this person.');
    }
    res.redirect(back);
  },

  adminPersonInvitePost: async (req, res) => {
    const hubId = hubIdParam(req);
    try {
      const person = (await db.query('SELECT * FROM hub_users WHERE hub_user_id = $1 AND hub_id = $2', [req.params.hubUserId, hubId])).rows[0];
      if (!person) throw new Error('not found');
      await inviteHubPerson(hubId, person, { baseUrl: appBase(res), by: adminLabel(req) });
      req.flash('success', `We emailed ${person.email} a new link to set their password.`);
    } catch (err) {
      req.flash('error', 'Could not send the invitation.');
    }
    res.redirect(`/admin/hubs/${hubId}/billing#people`);
  },

  // Add-on catalog (products and services hubs can add to their bill).
  adminAddonsGet: async (req, res) => {
    try {
      const addons = await billing.listAddons(db);
      const used = (await db.query(
        `SELECT addon_id, COUNT(DISTINCT hub_id)::int AS hubs FROM hub_billing_charges WHERE addon_id IS NOT NULL AND status = 'approved' GROUP BY addon_id`
      )).rows.reduce((m, r) => ({ ...m, [r.addon_id]: r.hubs }), {});
      res.render('admin/hubAddons', { title: 'Hub add-ons', addons, used, b: billing, messages: req.flash(), showFooterTopSection: false });
    } catch (err) {
      console.error('[adminAddonsGet]', err.message);
      req.flash('error', 'Could not load add-ons.');
      res.redirect('/admin/hubs');
    }
  },

  adminAddonSavePost: async (req, res) => {
    try {
      await billing.ensureHubBillingSchema(db);
      const name = String(req.body.name || '').trim().slice(0, 120);
      const price = billing.parseMoney(req.body.unitPrice, { label: 'Price', allowBlank: false });
      if (!name) { req.flash('error', 'Give the add-on a name.'); return res.redirect('/admin/hubs/add-ons'); }
      if (price.error || !(price.value > 0)) { req.flash('error', price.error || 'Enter a price above 0.'); return res.redirect('/admin/hubs/add-ons'); }
      const values = [name, String(req.body.description || '').trim().slice(0, 500) || null, billing.round2(price.value), req.body.frequency === 'once' ? 'once' : 'recurring'];
      const id = parseInt(req.params.addonId, 10);
      if (Number.isInteger(id)) {
        await db.query('UPDATE hub_billing_addons SET name = $1, description = $2, unit_price = $3, frequency = $4, updated_at = NOW() WHERE addon_id = $5', [...values, id]);
        req.flash('success', `${name} saved. Hubs that already have it keep the price they approved.`);
      } else {
        await db.query('INSERT INTO hub_billing_addons (name, description, unit_price, frequency) VALUES ($1, $2, $3, $4)', values);
        req.flash('success', `${name} added. Hubs can now add it from their Billing page.`);
      }
    } catch (err) {
      console.error('[adminAddonSavePost]', err.message);
      req.flash('error', 'Could not save the add-on.');
    }
    res.redirect('/admin/hubs/add-ons');
  },

  adminAddonTogglePost: async (req, res) => {
    try {
      const r = await db.query('UPDATE hub_billing_addons SET is_active = NOT is_active, updated_at = NOW() WHERE addon_id = $1 RETURNING name, is_active', [req.params.addonId]);
      if (r.rows[0]) req.flash('success', r.rows[0].is_active ? `${r.rows[0].name} is available again.` : `${r.rows[0].name} is hidden. Hubs that have it keep it.`);
    } catch (err) {
      req.flash('error', 'Could not change the add-on.');
    }
    res.redirect('/admin/hubs/add-ons');
  },

  // ------------------------------------------------------------ the hub's Billing page

  hubBillingGet: async (req, res) => {
    const hubId = req.session.hubId;
    try {
      const refreshing = billing.isStale(await billing.loadBilling(db, hubId), 60000);
      if (refreshing) billing.refreshInBackground(db, hubId);
      const data = await billing.overview(db, hubId);
      const addons = data.live ? await billing.listAddons(db, { activeOnly: true }) : [];
      const taken = new Set(data.approved.filter((c) => c.addon_id && c.frequency !== 'once').map((c) => c.addon_id));
      res.render('hub/billing', {
        title: 'Billing',
        hub: req.hubInfo,
        ...data,
        addons: addons.filter((a) => !taken.has(a.addon_id)),
        canManage: actorCan(req.hubActor, 'billing.manage'),
        cardResult: req.query.card || '',
        refreshing,
        b: billing,
        messages: req.flash(),
      });
    } catch (err) {
      console.error('[hubBillingGet]', err.message);
      req.flash('error', 'Could not load billing.');
      res.redirect('/hub/dashboard');
    }
  },

  // Off to Stripe's page to save a card.
  hubCardGet: async (req, res) => {
    try {
      const url = await billing.createCardSession(db, req.session.hubId, {
        successUrl: `${hereBase(req)}/hub/billing/card/done`,
        cancelUrl: `${hereBase(req)}/hub/billing?card=cancelled`,
      });
      res.redirect(303, url);
    } catch (err) {
      console.error('[hubCardGet]', err.message);
      req.flash('error', errText(err, 'Could not open the card page. Please try again.'));
      res.redirect('/hub/billing');
    }
  },

  hubCardDoneGet: async (req, res) => {
    try {
      const b = await billing.completeCardSession(db, req.session.hubId, req.query.session_id);
      req.flash('success', `${billing.methodLabel(b)} saved. It pays your bills from now on.`);
      res.redirect('/hub/billing?card=saved');
    } catch (err) {
      console.error('[hubCardDoneGet]', err.message);
      req.flash('error', errText(err, 'The card could not be saved. Please try again.'));
      res.redirect('/hub/billing');
    }
  },

  hubChargeDecisionPost: async (req, res) => {
    const approve = req.params.decision === 'approve';
    try {
      const c = await billing.decideCharge(db, req.session.hubId, parseInt(req.params.chargeId, 10), approve, { by: hubActorLabel(req) });
      req.flash('success', approve ? `${c.name} approved. It is added to your bill.` : `${c.name} declined.`);
    } catch (err) {
      req.flash('error', errText(err, 'Could not save your answer.'));
    }
    res.redirect('/hub/billing');
  },

  hubAddonPost: async (req, res) => {
    const hubId = req.session.hubId;
    try {
      const current = await billing.loadBilling(db, hubId);
      if (!billing.billingLive(current)) throw new billing.BillingError('Billing isn’t set up for your hub yet.');
      const addon = (await db.query('SELECT * FROM hub_billing_addons WHERE addon_id = $1 AND is_active = true', [req.params.addonId])).rows[0];
      if (!addon) throw new billing.BillingError('That add-on is no longer available.');
      if (addon.frequency !== 'once') {
        const has = (await db.query(`SELECT 1 FROM hub_billing_charges WHERE hub_id = $1 AND addon_id = $2 AND status = 'approved' AND frequency = 'recurring'`, [hubId, addon.addon_id])).rows[0];
        if (has) throw new billing.BillingError(`${addon.name} is already on your bill.`);
      }
      const by = hubActorLabel(req);
      const charge = await billing.addCharge(db, hubId, {
        kind: 'addon', addonId: addon.addon_id, name: addon.name, description: addon.description,
        unitPrice: Number(addon.unit_price), quantity: 1, frequency: addon.frequency, status: 'approved', requestedBy: 'hub', by,
      });
      await db.query(
        'INSERT INTO hub_activity_logs (hub_id, action_type, description, performed_by) VALUES ($1, $2, $3, $4)',
        [hubId, 'BILLING_ADDON_ADDED', `${billing.chargeSummary(charge, current)} added and approved`, by]
      ).catch(() => {});
      await billing.syncSubscription(db, hubId).catch(() => {});
      req.flash('success', `${addon.name} added. It is on your next bill.`);
    } catch (err) {
      req.flash('error', errText(err, 'Could not add this.'));
    }
    res.redirect('/hub/billing');
  },

  // Invoice PDF (hub: its own bills; admin: any hub's bills).
  invoicePdfGet: async (req, res) => {
    const hubId = req.params.hubId ? hubIdParam(req) : req.session.hubId;
    try {
      const out = await billing.invoicePdf(db, hubId, String(req.params.invoiceId || ''));
      if (!out) return res.status(404).send('Invoice not found.');
      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader('Content-Disposition', `inline; filename="${out.filename}"`);
      res.send(out.pdf);
    } catch (err) {
      console.error('[invoicePdfGet]', err.message);
      res.status(500).send('Could not make this invoice. Please try again.');
    }
  },

  // ------------------------------------------------------------ the emailed card link (no sign-in)

  setupPageGet: async (req, res) => {
    const render = (state, extra = {}) => res.status(state === 'invalid' ? 404 : 200).render('hub/billingSetup', { layout: false, state, token: req.params.token, ...extra });
    try {
      const hubId = await billing.hubIdForSetupToken(db, req.params.token);
      if (!hubId) return render('invalid');
      const data = await billing.overview(db, hubId);
      if (!data.live) return render('closed', { hub: data.hub });
      const { details } = await billing.planDetails(db, hubId);
      return render(req.query.cancelled ? 'cancelled' : 'ready', { ...data, details, hasCard: data.hasCard });
    } catch (err) {
      console.error('[setupPageGet]', err.message);
      return render('error');
    }
  },

  setupGoGet: async (req, res) => {
    try {
      const hubId = await billing.hubIdForSetupToken(db, req.params.token);
      if (!hubId) return res.redirect(`/hub/billing/setup/${encodeURIComponent(req.params.token)}`);
      const base = `${hereBase(req)}/hub/billing/setup/${req.params.token}`;
      const url = await billing.createCardSession(db, hubId, { successUrl: `${base}/done`, cancelUrl: `${base}?cancelled=1` });
      res.redirect(303, url);
    } catch (err) {
      console.error('[setupGoGet]', err.message);
      res.status(500).render('hub/billingSetup', { layout: false, state: 'error', token: req.params.token, message: errText(err, '') });
    }
  },

  setupDoneGet: async (req, res) => {
    try {
      const hubId = await billing.hubIdForSetupToken(db, req.params.token);
      if (!hubId) return res.status(404).render('hub/billingSetup', { layout: false, state: 'invalid', token: req.params.token });
      const b = await billing.completeCardSession(db, hubId, req.query.session_id);
      const data = await billing.overview(db, hubId);
      res.render('hub/billingSetup', { layout: false, state: 'done', token: req.params.token, ...data, card: b });
    } catch (err) {
      console.error('[setupDoneGet]', err.message);
      res.status(400).render('hub/billingSetup', { layout: false, state: 'error', token: req.params.token, message: errText(err, '') });
    }
  },
};

module.exports = hubBillingController;
