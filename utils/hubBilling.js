// Hub billing: each hub's contract with Managira (cycle, price per student or
// user, what is included, trial, discount, contract dates), the extra charges
// the hub approves, and its Stripe customer + subscription.
//
// This is separate from school subscriptions (jobs/recurringStripeBilling.js),
// which skip hub schools. Stripe does the charging: the hub saves a card on a
// Stripe page, we keep one Stripe subscription per hub in step with the
// contract (hourly, and whenever something changes), and Stripe renews it,
// retries failed payments and hosts the invoices.

const crypto = require('crypto');
const stripeConfig = require('./stripeConfig');
const { activeStudentSql } = require('./activeStudents');
const { ORG_USER_COUNT_SQL } = require('./licenses');

const CYCLES = {
  month: { label: 'Monthly', per: 'month', months: 1, interval: 'month', count: 1 },
  quarter: { label: 'Every 3 months', per: '3 months', months: 3, interval: 'month', count: 3 },
  term: { label: 'Every 4 months (term)', per: 'term', months: 4, interval: 'month', count: 4 },
  half: { label: 'Every 6 months', per: '6 months', months: 6, interval: 'month', count: 6 },
  year: { label: 'Yearly', per: 'year', months: 12, interval: 'year', count: 1 },
};
// What a hub can be charged for, each with its own switch, price and how many
// are included in the plan. Counted across every school in the hub.
const METERS = {
  student: { label: 'Per student', one: 'student', many: 'students', title: 'Students', help: 'Active students in every school (not graduated or archived).' },
  employee: { label: 'Per employee', one: 'employee', many: 'employees', title: 'Employees', help: 'Staff accounts in every school: teachers, managers, drivers and other staff.' },
  user: { label: 'Per user', one: 'user', many: 'users', title: 'Users', help: 'Everyone who can sign in: staff, parent and student accounts.' },
};
const METER_KEYS = Object.keys(METERS);

// Integrations a school can switch on (Settings › Integrations). A hub's plan
// can put a fee on each: "auto" bills every school that uses it; "manual"
// means Managira adds the charge when needed (the hub approves it).
// `sql` reads the switch from organizations (alias o).
const INTEGRATIONS = [
  { key: 'mira', label: 'Mira AI assistant', columns: ['mira_activated'] },
  { key: 'whatsapp', label: 'WhatsApp messages', columns: ['whatsapp_activated'] },
  { key: 'sms', label: 'Text messages (SMS)', columns: ['sms_twilio_activated', 'sms_africastalking_activated', 'sms_arkesel_activated'] },
  { key: 'student_portal', label: 'Student portal', columns: ['student_portal_activated'] },
  { key: 'transportation', label: 'Transportation', columns: ['transportation_activated'] },
  { key: 'maps', label: 'Maps navigation', columns: ['transportation_google_maps_nav_activated', 'transportation_apple_maps_nav_activated'] },
  { key: 'google_classroom', label: 'Google Classroom', columns: ['google_classroom_activated'] },
];
const INTEGRATION_BY_KEY = Object.fromEntries(INTEGRATIONS.map((i) => [i.key, i]));

const STATUS = {
  none: { label: 'Not set up', tone: 'muted' },
  draft: { label: 'No price yet', tone: 'muted' },
  awaiting_card: { label: 'Waiting for card', tone: 'amber' },
  trialing: { label: 'Free period', tone: 'blue' },
  active: { label: 'Active', tone: 'green' },
  past_due: { label: 'Payment failed', tone: 'rose' },
  incomplete: { label: 'Payment needed', tone: 'rose' },
  paused: { label: 'On hold', tone: 'amber' },
  canceled: { label: 'Ended', tone: 'muted' },
};
const DISCOUNT_DURATIONS = {
  forever: 'Every bill',
  once: 'First bill only',
  repeating: 'For a number of bills',
};
const CHARGE_KINDS = {
  addon: 'Add-on',
  custom: 'Extra charge',
  integration: 'Integration',
};

class BillingError extends Error {}

const round2 = (n) => Math.round((Number(n) || 0) * 100) / 100;
const toCents = (n) => Math.round(round2(n) * 100);
const money = (n, currency = 'usd') => {
  const value = Number(n) || 0;
  try {
    return new Intl.NumberFormat('en-US', { style: 'currency', currency: String(currency || 'usd').toUpperCase() }).format(value);
  } catch (_e) {
    return `$${value.toFixed(2)}`;
  }
};
const fmtDate = (d) => (d ? new Date(d).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' }) : '');
const ts = (d) => Math.floor(new Date(d).getTime() / 1000);
const fromTs = (n) => (n ? new Date(n * 1000) : null);
const plural = (n, one, many) => `${Number(n).toLocaleString('en-US')} ${Number(n) === 1 ? one : many}`;

// A date-only value (YYYY-MM-DD or Date) as 12:00 UTC that day, so it shows as
// the same day everywhere.
function dayAtNoon(value) {
  if (!value) return null;
  const pad = (n) => String(n).padStart(2, '0');
  let s;
  if (value instanceof Date) {
    // pg gives DATE columns as local midnight; anything else is a moment in time.
    const localMidnight = value.getHours() === 0 && value.getMinutes() === 0 && value.getSeconds() === 0;
    s = localMidnight
      ? `${value.getFullYear()}-${pad(value.getMonth() + 1)}-${pad(value.getDate())}`
      : value.toISOString().slice(0, 10);
  } else {
    s = String(value).slice(0, 10);
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return null;
  const d = new Date(`${s}T12:00:00Z`);
  return Number.isNaN(d.getTime()) ? null : d;
}
const isoDay = (value) => {
  const d = dayAtNoon(value);
  return d ? d.toISOString().slice(0, 10) : '';
};

function addMonths(date, months) {
  const d = new Date(date);
  const day = d.getUTCDate();
  d.setUTCMonth(d.getUTCMonth() + months);
  if (d.getUTCDate() < day) d.setUTCDate(0);
  return d;
}
// Whole months from `from` to `to` (rounded down).
function wholeMonthsBetween(from, to) {
  let m = 0;
  while (m < 600 && addMonths(from, m + 1) <= to) m += 1;
  return m;
}

// ---------------------------------------------------------------- schema

let schemaReady = null;
function ensureHubBillingSchema(db) {
  if (!schemaReady) {
    schemaReady = (async () => {
      await require('./licenses').ensureLicenseSchema(db);
      await db.query(`
        CREATE TABLE IF NOT EXISTS hub_billing (
          hub_id INTEGER PRIMARY KEY REFERENCES managira_hubs(hub_id) ON DELETE CASCADE,
          currency VARCHAR(3) NOT NULL DEFAULT 'usd',
          billing_cycle VARCHAR(12) NOT NULL DEFAULT 'month',
          meters JSONB NOT NULL DEFAULT '{}'::jsonb,
          integration_fees JSONB NOT NULL DEFAULT '{}'::jsonb,
          base_fee NUMERIC(12,2) NOT NULL DEFAULT 0,
          extra_school_price NUMERIC(12,2),
          extra_user_price NUMERIC(12,2),
          trial_end_date DATE,
          auto_renew BOOLEAN NOT NULL DEFAULT TRUE,
          discount_type VARCHAR(10) NOT NULL DEFAULT 'none',
          discount_value NUMERIC(12,2) NOT NULL DEFAULT 0,
          discount_duration VARCHAR(12) NOT NULL DEFAULT 'forever',
          discount_cycles INTEGER,
          billing_email VARCHAR(255),
          notes TEXT,
          status VARCHAR(20) NOT NULL DEFAULT 'draft',
          ended_at TIMESTAMPTZ,
          stripe_mode VARCHAR(8),
          stripe_customer_id VARCHAR(255),
          stripe_subscription_id VARCHAR(255),
          stripe_coupon_id VARCHAR(255),
          applied_discount_key VARCHAR(120),
          applied_first_charge_at TIMESTAMPTZ,
          card_brand VARCHAR(30),
          card_last4 VARCHAR(4),
          card_exp_month INTEGER,
          card_exp_year INTEGER,
          card_added_at TIMESTAMPTZ,
          next_charge_at TIMESTAMPTZ,
          next_charge_amount NUMERIC(12,2),
          current_period_end TIMESTAMPTZ,
          hold_starts_at TIMESTAMPTZ,
          hold_ends_at TIMESTAMPTZ,
          setup_token VARCHAR(64),
          setup_link_sent_at TIMESTAMPTZ,
          setup_reminders INTEGER NOT NULL DEFAULT 0,
          last_error TEXT,
          last_synced_at TIMESTAMPTZ,
          created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )`);
      await db.query(`
        CREATE TABLE IF NOT EXISTS hub_billing_addons (
          addon_id SERIAL PRIMARY KEY,
          name VARCHAR(120) NOT NULL,
          description TEXT,
          unit_price NUMERIC(12,2) NOT NULL DEFAULT 0,
          frequency VARCHAR(10) NOT NULL DEFAULT 'recurring',
          is_active BOOLEAN NOT NULL DEFAULT TRUE,
          created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )`);
      await db.query(`
        CREATE TABLE IF NOT EXISTS hub_billing_charges (
          charge_id SERIAL PRIMARY KEY,
          hub_id INTEGER NOT NULL REFERENCES managira_hubs(hub_id) ON DELETE CASCADE,
          kind VARCHAR(20) NOT NULL DEFAULT 'custom',
          addon_id INTEGER REFERENCES hub_billing_addons(addon_id) ON DELETE SET NULL,
          name VARCHAR(120) NOT NULL,
          description TEXT,
          unit_price NUMERIC(12,2) NOT NULL DEFAULT 0,
          quantity INTEGER NOT NULL DEFAULT 1,
          frequency VARCHAR(10) NOT NULL DEFAULT 'recurring',
          status VARCHAR(12) NOT NULL DEFAULT 'pending',
          requested_by VARCHAR(10) NOT NULL DEFAULT 'admin',
          requested_by_label VARCHAR(255),
          decided_by_label VARCHAR(255),
          decided_at TIMESTAMPTZ,
          removed_at TIMESTAMPTZ,
          stripe_mode VARCHAR(8),
          stripe_invoice_item_id VARCHAR(255),
          billed_at TIMESTAMPTZ,
          created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )`);
      await db.query('CREATE INDEX IF NOT EXISTS hub_billing_charges_hub_idx ON hub_billing_charges (hub_id, status)');
      // A charge for an integration a school uses (manual integration fees).
      await db.query('ALTER TABLE hub_billing_charges ADD COLUMN IF NOT EXISTS integration_key VARCHAR(40)');
      await db.query('ALTER TABLE hub_billing_charges ADD COLUMN IF NOT EXISTS organization_id INTEGER');
      // Whether schools and staff on hold are still billed.
      await db.query('ALTER TABLE hub_billing ADD COLUMN IF NOT EXISTS count_on_hold BOOLEAN NOT NULL DEFAULT TRUE');
      // Separate switches for students / employees / users and integration fees
      // (replaced a single "charge per student or per user" choice).
      await db.query(`ALTER TABLE hub_billing ADD COLUMN IF NOT EXISTS meters JSONB NOT NULL DEFAULT '{}'::jsonb`);
      await db.query(`ALTER TABLE hub_billing ADD COLUMN IF NOT EXISTS integration_fees JSONB NOT NULL DEFAULT '{}'::jsonb`);
      await db.query('ALTER TABLE hub_billing DROP COLUMN IF EXISTS charge_basis, DROP COLUMN IF EXISTS unit_price, DROP COLUMN IF EXISTS included_units');
      await db.query(`
        CREATE TABLE IF NOT EXISTS hub_billing_invoices (
          stripe_invoice_id VARCHAR(255) PRIMARY KEY,
          hub_id INTEGER NOT NULL REFERENCES managira_hubs(hub_id) ON DELETE CASCADE,
          stripe_mode VARCHAR(8),
          number VARCHAR(80),
          status VARCHAR(20),
          amount_due NUMERIC(12,2) NOT NULL DEFAULT 0,
          amount_paid NUMERIC(12,2) NOT NULL DEFAULT 0,
          currency VARCHAR(3) NOT NULL DEFAULT 'usd',
          period_start TIMESTAMPTZ,
          period_end TIMESTAMPTZ,
          issued_at TIMESTAMPTZ,
          paid_at TIMESTAMPTZ,
          attempt_count INTEGER NOT NULL DEFAULT 0,
          last_error TEXT,
          hosted_invoice_url TEXT,
          invoice_pdf TEXT,
          notified_paid BOOLEAN NOT NULL DEFAULT FALSE,
          notified_failed_attempt INTEGER NOT NULL DEFAULT 0,
          updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )`);
      await db.query('CREATE INDEX IF NOT EXISTS hub_billing_invoices_hub_idx ON hub_billing_invoices (hub_id, issued_at DESC)');
      // What each bill was for (its lines) and the schools counted when it was made.
      await db.query('ALTER TABLE hub_billing_invoices ADD COLUMN IF NOT EXISTS lines JSONB');
      await db.query('ALTER TABLE hub_billing_invoices ADD COLUMN IF NOT EXISTS discount NUMERIC(12,2) NOT NULL DEFAULT 0');
      await db.query('ALTER TABLE hub_billing_invoices ADD COLUMN IF NOT EXISTS total NUMERIC(12,2)');
      await db.query('ALTER TABLE hub_billing_invoices ADD COLUMN IF NOT EXISTS schools JSONB');
      await db.query(`
        CREATE TABLE IF NOT EXISTS hub_billing_stripe_refs (
          mode VARCHAR(8) NOT NULL,
          ref_key VARCHAR(80) NOT NULL,
          stripe_id VARCHAR(255) NOT NULL,
          PRIMARY KEY (mode, ref_key)
        )`);
    })().catch((err) => { schemaReady = null; throw err; });
  }
  return schemaReady;
}

// ---------------------------------------------------------------- the contract form

function parseMoney(value, { label, allowBlank = true, max = 1000000 } = {}) {
  const raw = String(value == null ? '' : value).replace(/[,\s$]/g, '');
  if (!raw) return { value: allowBlank ? null : 0 };
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 0) return { error: `${label} must be a number of 0 or more.` };
  if (n > max) return { error: `${label} is too large.` };
  return { value: Math.round(n * 10000) / 10000 };
}
function parseCount(value, { label, max = 1000000 } = {}) {
  const raw = String(value == null ? '' : value).replace(/[,\s]/g, '');
  if (!raw) return { value: null };
  const n = Number(raw);
  if (!Number.isInteger(n) || n < 0) return { error: `${label} must be a whole number.` };
  if (n > max) return { error: `${label} is too large.` };
  return { value: n };
}

// Read the billing part of the admin hub form. Returns { values, errors }.
// Contract dates, schools included and user licenses live on managira_hubs;
// they are checked here too because the billing rules depend on them.
function parseContractForm(body = {}, { today = new Date() } = {}) {
  const errors = [];
  const take = (r) => { if (r.error) errors.push(r.error); return r.value; };

  const cycle = CYCLES[body.billingCycle] ? body.billingCycle : 'month';
  const isOn = (v) => v === 'on' || v === '1' || v === true;

  // Per student / employee / user: each switched on with a price and an included number.
  const meters = {};
  const meterBody = body.meters || {};
  METER_KEYS.forEach((key) => {
    const m = meterBody[key] || {};
    if (!isOn(m.on)) return;
    const price = take(parseMoney(m.price, { label: `Price per ${METERS[key].one}`, allowBlank: false }));
    if (!(price > 0)) { errors.push(`Enter the price per ${METERS[key].one}, or switch it off.`); return; }
    const included = take(parseCount(m.included, { label: `${METERS[key].title} included` })) || 0;
    meters[key] = { on: true, price, included };
  });

  // Integration fees: per school that uses it, each bill. Auto or manual.
  const integrationFees = {};
  const intBody = body.integrations || {};
  INTEGRATIONS.forEach(({ key, label }) => {
    const f = intBody[key] || {};
    if (!isOn(f.on)) return;
    const price = take(parseMoney(f.price, { label: `${label} fee`, allowBlank: false }));
    if (!(price > 0)) { errors.push(`Enter the fee for ${label}, or switch it off.`); return; }
    integrationFees[key] = { on: true, price: round2(price), mode: f.mode === 'manual' ? 'manual' : 'auto' };
  });

  const baseFee = isOn(body.baseFeeOn) ? round2(take(parseMoney(body.baseFee, { label: 'Plan fee' })) || 0) : 0;
  if (isOn(body.baseFeeOn) && !(baseFee > 0)) errors.push('Enter the plan fee, or switch it off.');
  const extraSchoolPrice = take(parseMoney(body.extraSchoolPrice, { label: 'Price per extra school' }));
  const extraUserPrice = take(parseMoney(body.extraUserPrice, { label: 'Price per extra user license' }));

  const trialEndDate = body.trialEnabled === 'on' || body.trialEnabled === '1' ? isoDay(body.trialEndDate) : '';
  if ((body.trialEnabled === 'on' || body.trialEnabled === '1') && !trialEndDate) errors.push('Choose the day the free trial ends.');

  const start = isoDay(body.contractStartDate);
  const end = isoDay(body.contractEndDate);
  if (start && end && end <= start) errors.push('The contract end date must be after the start date.');
  const autoRenew = !(body.autoRenew === '0' || body.autoRenew === 'off');
  if (!autoRenew) {
    if (!end) errors.push('Add a contract end date, or let billing renew automatically.');
    else if (dayAtNoon(end) <= today) errors.push('To stop billing at the end of the contract, the end date must be in the future.');
  }

  let discountType = ['percent', 'amount'].includes(body.discountType) ? body.discountType : 'none';
  let discountValue = 0;
  let discountDuration = DISCOUNT_DURATIONS[body.discountDuration] ? body.discountDuration : 'forever';
  let discountCycles = null;
  if (discountType !== 'none') {
    discountValue = round2(take(parseMoney(body.discountValue, { label: 'Discount' })) || 0);
    if (!(discountValue > 0)) { discountType = 'none'; discountValue = 0; }
    if (discountType === 'percent' && discountValue > 100) errors.push('A percentage discount can’t be more than 100%.');
    if (discountDuration === 'repeating') {
      discountCycles = take(parseCount(body.discountCycles, { label: 'Number of discounted bills', max: 120 }));
      if (!discountCycles) errors.push('Say how many bills get the discount.');
    }
  }
  if (discountType === 'none') { discountDuration = 'forever'; discountCycles = null; }

  const countOnHold = !(body.countOnHold === '0' || body.countOnHold === 'off');

  const billingEmail = String(body.billingEmail || '').trim().toLowerCase();
  if (billingEmail && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(billingEmail)) errors.push('The billing email doesn’t look right.');

  return {
    errors,
    values: {
      billing_cycle: cycle,
      meters,
      integration_fees: integrationFees,
      base_fee: baseFee,
      extra_school_price: extraSchoolPrice == null ? null : round2(extraSchoolPrice),
      extra_user_price: extraUserPrice == null ? null : round2(extraUserPrice),
      trial_end_date: trialEndDate || null,
      auto_renew: autoRenew,
      discount_type: discountType,
      discount_value: discountValue,
      discount_duration: discountDuration,
      discount_cycles: discountCycles,
      count_on_hold: countOnHold,
      billing_email: billingEmail || null,
      notes: String(body.billingNotes || '').trim().slice(0, 2000) || null,
    },
  };
}

const metersOf = (b) => (b && b.meters && typeof b.meters === 'object' ? b.meters : {});
const integrationFeesOf = (b) => (b && b.integration_fees && typeof b.integration_fees === 'object' ? b.integration_fees : {});
// Billing needs at least one price: a meter or the plan fee.
const hasPrice = (b) => !!b && (Number(b.base_fee) > 0 || METER_KEYS.some((k) => metersOf(b)[k] && metersOf(b)[k].on && Number(metersOf(b)[k].price) > 0));

// ---------------------------------------------------------------- the bill (pure)

// What one bill comes to, from the contract, today's numbers and the approved
// charges. Used for the estimates people see and to build the Stripe items.
function computeBill(billing, usage = {}, charges = []) {
  const b = billing || {};
  const cycle = CYCLES[b.billing_cycle] || CYCLES.month;
  const lines = [];
  const add = (line) => {
    const amount = round2(line.quantity * line.unitPrice);
    if (amount > 0) lines.push({ recurring: true, ...line, amount });
  };

  if (Number(b.base_fee) > 0) add({ key: 'base', label: 'Hub plan fee', quantity: 1, unitPrice: Number(b.base_fee) });

  // Students / employees / users: at least the included number; more are charged at the same price.
  const meters = {};
  METER_KEYS.forEach((key) => {
    const m = metersOf(b)[key];
    if (!m || !m.on || !(Number(m.price) > 0)) return;
    const def = METERS[key];
    const actual = Math.max(0, Number(usage[key === 'student' ? 'students' : key === 'employee' ? 'employees' : 'users']) || 0);
    const included = Math.max(0, Number(m.included) || 0);
    const billed = Math.max(actual, included);
    meters[key] = { actual, included, billed, price: Number(m.price) };
    if (billed > 0) {
      add({
        key: `meter:${key}`,
        label: def.title,
        quantity: billed,
        unitPrice: Number(m.price),
        note: actual > included
          ? `${plural(actual, def.one, def.many)} now: ${included.toLocaleString('en-US')} in your plan + ${(actual - included).toLocaleString('en-US')} more`
          : `${included.toLocaleString('en-US')} in your plan (${actual.toLocaleString('en-US')} now)`,
      });
    }
  });

  // Integrations billed automatically for each school that uses them.
  const integrationUse = usage.integrations || {};
  INTEGRATIONS.forEach(({ key, label }) => {
    const f = integrationFeesOf(b)[key];
    if (!f || !f.on || f.mode !== 'auto' || !(Number(f.price) > 0)) return;
    const schools = Number(integrationUse[key]) || 0;
    if (schools > 0) add({ key: `integration:${key}`, label, quantity: schools, unitPrice: Number(f.price), note: `${plural(schools, 'school uses', 'schools use')} it` });
  });

  // Schools and hub sign-ins beyond the plan, from today's numbers (if the plan prices them).
  const schoolsIncluded = Number(usage.schoolsIncluded) || 0;
  const extraSchools = Math.max(0, (Number(usage.schools) || 0) - schoolsIncluded);
  if (Number(b.extra_school_price) > 0 && extraSchools > 0) {
    add({ key: 'extra_schools', label: 'Extra schools', quantity: extraSchools, unitPrice: Number(b.extra_school_price), note: `${usage.schools} schools: ${schoolsIncluded} in your plan + ${extraSchools} more` });
  }
  if (usage.seatsIncluded != null) {
    const extraSeats = Math.max(0, (Number(usage.hubPeople) || 0) - Number(usage.seatsIncluded));
    if (Number(b.extra_user_price) > 0 && extraSeats > 0) {
      add({ key: 'extra_users', label: 'Extra user licenses', quantity: extraSeats, unitPrice: Number(b.extra_user_price), note: `${usage.hubPeople} people sign in to the hub: ${usage.seatsIncluded} in your plan + ${extraSeats} more` });
    }
  }

  (charges || []).filter((c) => c.status === 'approved').forEach((c) => {
    if (c.frequency === 'once') {
      if (c.billed_at) return;
      add({ key: `once:${c.charge_id}`, chargeId: c.charge_id, label: `${c.name} (one time)`, quantity: Number(c.quantity) || 1, unitPrice: Number(c.unit_price), recurring: false });
    } else {
      add({ key: `charge:${c.charge_id}`, chargeId: c.charge_id, label: c.name, quantity: Number(c.quantity) || 1, unitPrice: Number(c.unit_price) });
    }
  });

  const subtotal = round2(lines.reduce((s, l) => s + l.amount, 0));
  let discount = 0;
  if (b.discount_type === 'percent') discount = round2(subtotal * Math.min(100, Number(b.discount_value) || 0) / 100);
  else if (b.discount_type === 'amount') discount = Math.min(subtotal, round2(b.discount_value));
  return {
    cycle,
    lines,
    meters,
    subtotal,
    discount,
    total: round2(subtotal - discount),
    recurringTotal: round2(lines.filter((l) => l.recurring).reduce((s, l) => s + l.amount, 0)),
  };
}

// "Oct 1, 2026 – Sep 30, 2027", "From …", "Until …" or "No end date".
function contractLabel(hub, billing) {
  const start = hub && hub.contract_start_date ? fmtDate(dayAtNoon(hub.contract_start_date)) : '';
  const end = hub && hub.contract_end_date ? fmtDate(dayAtNoon(hub.contract_end_date)) : '';
  const after = end ? (billing && billing.auto_renew === false ? ', then billing stops' : ', renews automatically') : '';
  if (start && end) return `${start} – ${end}${after}`;
  if (end) return `Until ${end}${after}`;
  if (start) return `From ${start}, no end date`;
  return 'No end date';
}

function discountLabel(b) {
  if (!b || b.discount_type === 'none' || !(Number(b.discount_value) > 0)) return '';
  const what = b.discount_type === 'percent' ? `${Number(b.discount_value)}% off` : `${money(b.discount_value, b.currency)} off`;
  if (b.discount_duration === 'once') return `${what} the first bill`;
  if (b.discount_duration === 'repeating') return `${what} the first ${plural(b.discount_cycles || 1, 'bill', 'bills')}`;
  return `${what} every bill`;
}

// When the first charge happens: the later of the trial end and the contract
// start, if that is still ahead. null = charge as soon as the card is saved.
function firstChargeAt(billing, hub, now = new Date()) {
  const dates = [billing && billing.trial_end_date, hub && hub.contract_start_date]
    .map(dayAtNoon).filter((d) => d && d > now);
  return dates.length ? new Date(Math.max(...dates.map((d) => d.getTime()))) : null;
}

// When billing stops on its own (contract end, if it doesn't renew).
function cancelAtFor(billing, hub) {
  if (!billing || billing.auto_renew || !hub || !hub.contract_end_date) return null;
  return dayAtNoon(hub.contract_end_date);
}

// Stripe coupon for the discount. Repeating discounts are counted from the
// first charge: Stripe counts from when the coupon is applied, so whole months
// of free period are added on.
function couponSpec(billing, firstCharge, now = new Date()) {
  const b = billing || {};
  if (b.discount_type === 'none' || !(Number(b.discount_value) > 0)) return null;
  const cycle = CYCLES[b.billing_cycle] || CYCLES.month;
  const spec = { name: discountLabel(b).slice(0, 40), metadata: { managira: 'hub_billing' } };
  if (b.discount_type === 'percent') spec.percent_off = Math.min(100, Number(b.discount_value));
  else { spec.amount_off = toCents(b.discount_value); spec.currency = b.currency || 'usd'; }
  if (b.discount_duration === 'forever') spec.duration = 'forever';
  else {
    const bills = b.discount_duration === 'once' ? 1 : Math.max(1, Number(b.discount_cycles) || 1);
    spec.duration = 'repeating';
    spec.duration_in_months = bills * cycle.months + (firstCharge ? wholeMonthsBetween(now, firstCharge) : 0);
  }
  const key = [b.discount_type, Number(b.discount_value), b.discount_duration, b.discount_cycles || 0, b.billing_cycle].join(':');
  return { key, spec };
}

// ---------------------------------------------------------------- loading

async function loadHub(db, hubId) {
  return (await db.query(
    `SELECT hub_id, hub_name, hub_nickname, hub_email, first_name, last_name, on_hold, deleted,
            max_organizations, max_users, contract_start_date, contract_end_date
       FROM managira_hubs WHERE hub_id = $1`,
    [hubId]
  )).rows[0] || null;
}
async function loadBilling(db, hubId) {
  await ensureHubBillingSchema(db);
  return (await db.query('SELECT * FROM hub_billing WHERE hub_id = $1', [hubId])).rows[0] || null;
}
async function loadCharges(db, hubId, { all = false } = {}) {
  await ensureHubBillingSchema(db);
  return (await db.query(
    `SELECT * FROM hub_billing_charges WHERE hub_id = $1 ${all ? '' : "AND status IN ('pending', 'approved')"}
      ORDER BY CASE status WHEN 'pending' THEN 0 WHEN 'approved' THEN 1 ELSE 2 END, created_at DESC`,
    [hubId]
  )).rows;
}

// Staff accounts that count as users (not Managira's own accounts).
const STAFF_SQL = (a) => `LOWER(COALESCE(${a}.account_type::text, '')) NOT IN ('admin', 'internal worker', 'mini admin')`;

// Which integration switches exist in this database (read once).
let integrationColumns = null;
async function integrationSql(db) {
  if (!integrationColumns) {
    const all = INTEGRATIONS.flatMap((i) => i.columns);
    const found = (await db.query(
      `SELECT column_name FROM information_schema.columns WHERE table_name = 'organizations' AND column_name = ANY($1::text[])`,
      [all]
    )).rows.map((r) => r.column_name);
    integrationColumns = new Set(found);
  }
  return INTEGRATIONS.map((i) => {
    const cols = i.columns.filter((c) => integrationColumns.has(c));
    const expr = cols.length ? cols.map((c) => `COALESCE(o.${c}, false)`).join(' OR ') : 'false';
    return `(${expr}) AS "int_${i.key}"`;
  }).join(',\n            ');
}

// Today's numbers across every school in the hub, school by school:
// students, employees (staff accounts), parent and student logins, users
// (everyone who signs in) and the integrations each school has on. Schools
// and staff on hold are counted unless the contract says otherwise.
async function loadUsage(db, hubId) {
  const [hub, billing] = await Promise.all([loadHub(db, hubId), loadBilling(db, hubId)]);
  const countOnHold = !billing || billing.count_on_hold !== false;
  const ints = await integrationSql(db);
  const perSchool = (studentFilter) => db.query(
    `SELECT o.organization_id, o.organization_name, COALESCE(o.on_hold, false) AS on_hold,
            (SELECT COUNT(*)::int FROM students s WHERE s.organization_id = o.organization_id AND ${studentFilter}) AS students,
            (SELECT COUNT(*)::int FROM users u WHERE u.organization_id = o.organization_id AND ${STAFF_SQL('u')}) AS employees,
            (SELECT COUNT(*)::int FROM users u WHERE u.organization_id = o.organization_id AND ${STAFF_SQL('u')} AND COALESCE(u.on_hold, false)) AS employees_on_hold,
            (SELECT COUNT(*)::int FROM guardian_accounts g WHERE g.organization_id = o.organization_id) AS parent_logins,
            (SELECT COUNT(*)::int FROM student_accounts sa WHERE sa.organization_id = o.organization_id) AS student_logins,
            ${ints}
       FROM organizations o
      WHERE o.hub_id = $1 AND o.deleted = false AND COALESCE(o.is_hub_member, false) = true
      ORDER BY o.organization_name`,
    [hubId]
  );
  let rows;
  try {
    rows = (await perSchool(require('./studentArchive').billableStudentSql('s'))).rows;
  } catch (_e) {
    rows = (await perSchool('COALESCE(s.graduated, false) = false')).rows;
  }
  const schools = rows.map((r) => {
    const counted = countOnHold || !r.on_hold;
    const employees = countOnHold ? r.employees : r.employees - r.employees_on_hold;
    const integrations = INTEGRATIONS.filter((i) => r[`int_${i.key}`]).map((i) => i.key);
    return {
      organization_id: r.organization_id,
      organization_name: r.organization_name,
      on_hold: r.on_hold,
      counted,
      students: r.students,
      employees: r.employees,
      employees_on_hold: r.employees_on_hold,
      parent_logins: r.parent_logins,
      student_logins: r.student_logins,
      integrations,
      billedStudents: counted ? r.students : 0,
      billedEmployees: counted ? employees : 0,
      billedUsers: counted ? employees + r.parent_logins + r.student_logins : 0,
    };
  });
  const counted = schools.filter((x) => x.counted);
  const sum = (k) => counted.reduce((n, x) => n + x[k], 0);
  const integrations = {};
  INTEGRATIONS.forEach((i) => { integrations[i.key] = counted.filter((x) => x.integrations.includes(i.key)).length; });
  const [people, pending] = await Promise.all([
    db.query('SELECT COUNT(*)::int AS n FROM hub_users WHERE hub_id = $1', [hubId]).catch(() => ({ rows: [{ n: 0 }] })),
    db.query(
      `SELECT COUNT(*)::int AS n FROM hub_organization_invitations
        WHERE hub_id = $1 AND status = 'pending' AND (expires_at IS NULL OR expires_at > NOW())`,
      [hubId]
    ).catch(() => ({ rows: [{ n: 0 }] })),
  ]);
  return {
    countOnHold,
    breakdown: schools,
    schools: counted.length,
    memberSchools: schools.length,
    pendingInvites: pending.rows[0].n,
    students: sum('billedStudents'),
    employees: sum('billedEmployees'),
    users: sum('billedUsers'),
    integrations,
    hubPeople: people.rows[0].n + 1,
    schoolsIncluded: hub ? Number(hub.max_organizations) || 0 : 0,
    seatsIncluded: hub && hub.max_users != null ? Number(hub.max_users) : null,
  };
}

// Is billing switched on for this hub (a contract with a price that hasn't ended)?
const billingLive = (b) => !!b && hasPrice(b) && !b.ended_at;

// School places and hub user licenses. Pending invitations hold a place. When
// the plan has a price for extras, the hub can go over after approving the cost;
// extras are then billed from the real numbers.
async function capacity(db, hubId, kind) {
  const [hub, billing] = await Promise.all([loadHub(db, hubId), loadBilling(db, hubId)]);
  if (!hub) return null;
  let included;
  let used;
  let members = 0;
  let pending = 0;
  if (kind === 'school') {
    included = Number(hub.max_organizations) || 0;
    members = (await db.query('SELECT COUNT(*)::int AS n FROM organizations WHERE hub_id = $1 AND deleted = false', [hubId])).rows[0].n;
    pending = (await db.query(
      `SELECT COUNT(*)::int AS n FROM hub_organization_invitations WHERE hub_id = $1 AND status = 'pending' AND (expires_at IS NULL OR expires_at > NOW())`,
      [hubId]
    ).catch(() => ({ rows: [{ n: 0 }] }))).rows[0].n;
    used = members + pending;
  } else {
    included = hub.max_users == null ? null : Number(hub.max_users);
    used = (await db.query('SELECT COUNT(*)::int AS n FROM hub_users WHERE hub_id = $1', [hubId]).catch(() => ({ rows: [{ n: 0 }] }))).rows[0].n + 1;
  }
  const price = billing ? Number(kind === 'school' ? billing.extra_school_price : billing.extra_user_price) || 0 : 0;
  return {
    kind,
    included,
    limit: included,
    used,
    members,
    pending,
    extra: included == null ? 0 : Math.max(0, used - included),
    full: included != null && used >= included,
    price,
    canBuy: billingLive(billing) && price > 0,
    per: (CYCLES[billing && billing.billing_cycle] || CYCLES.month).per,
    currency: (billing && billing.currency) || 'usd',
  };
}

// ---------------------------------------------------------------- Stripe plumbing

async function stripeClient(db) {
  const settings = await stripeConfig.getStripeSettings(db);
  let stripe;
  try {
    stripe = await stripeConfig.getStripeClient(db);
  } catch (_e) {
    throw new BillingError('Stripe is not connected. Add the Stripe keys first.');
  }
  return { stripe, mode: settings.mode };
}

// "Visa •••• 4242", "Link", "us bank account •••• 6789".
function methodLabel(b) {
  if (!b || !b.card_brand) return 'No card';
  const brand = b.card_brand === 'link' ? 'Link' : b.card_brand.charAt(0).toUpperCase() + b.card_brand.slice(1);
  return b.card_last4 && b.card_last4 !== '0000' ? `${brand} •••• ${b.card_last4}` : brand;
}

const stripeMessage = (err) => {
  const msg = (err && (err.raw && err.raw.message)) || (err && err.message) || 'Stripe did not accept the request.';
  return String(msg).slice(0, 500);
};

// Cached Stripe ids (products) per Stripe mode.
async function stripeRef(db, mode, key, create) {
  const found = (await db.query('SELECT stripe_id FROM hub_billing_stripe_refs WHERE mode = $1 AND ref_key = $2', [mode, key])).rows[0];
  if (found) return found.stripe_id;
  const id = await create();
  await db.query(
    `INSERT INTO hub_billing_stripe_refs (mode, ref_key, stripe_id) VALUES ($1, $2, $3)
     ON CONFLICT (mode, ref_key) DO UPDATE SET stripe_id = EXCLUDED.stripe_id`,
    [mode, key, id]
  );
  return id;
}
const productFor = (db, stripe, mode, key, name) => stripeRef(db, mode, `product:${key}`, async () => (
  await stripe.products.create({ name: String(name).slice(0, 250), metadata: { managira: 'hub_billing', ref_key: key } })
).id);

async function setBilling(db, hubId, fields) {
  const keys = Object.keys(fields);
  if (!keys.length) return;
  const sets = keys.map((k, i) => `${k} = $${i + 2}`).join(', ');
  await db.query(`UPDATE hub_billing SET ${sets}, updated_at = NOW() WHERE hub_id = $1`, [hubId, ...keys.map((k) => fields[k])]);
}

async function logHub(db, hubId, type, description, by = 'Managira') {
  await db.query(
    'INSERT INTO hub_activity_logs (hub_id, action_type, description, performed_by) VALUES ($1, $2, $3, $4)',
    [hubId, type, description, by]
  ).catch(() => {});
}

// The hub's Stripe customer in the current Stripe mode (made if missing).
async function ensureCustomer(db, stripe, mode, hub, billing) {
  if (billing.stripe_customer_id && billing.stripe_mode === mode) {
    try {
      const c = await stripe.customers.retrieve(billing.stripe_customer_id);
      if (c && !c.deleted) return c;
    } catch (err) {
      if (!(err && err.code === 'resource_missing')) throw err;
    }
  }
  const customer = await stripe.customers.create({
    email: billing.billing_email || hub.hub_email,
    name: hub.hub_name,
    description: `Managira hub: ${hub.hub_name}`,
    metadata: { managira_hub_id: String(hub.hub_id), managira_kind: 'hub' },
  });
  await setBilling(db, hub.hub_id, {
    stripe_customer_id: customer.id,
    stripe_mode: mode,
    stripe_subscription_id: null,
    stripe_coupon_id: null,
    applied_discount_key: null,
    applied_first_charge_at: null,
    card_brand: null,
    card_last4: null,
    card_exp_month: null,
    card_exp_year: null,
  });
  Object.assign(billing, { stripe_customer_id: customer.id, stripe_mode: mode, stripe_subscription_id: null, stripe_coupon_id: null, applied_discount_key: null });
  return customer;
}

// What we show for the saved payment method (a card, or Link / a bank account).
function methodFields(pm) {
  if (!pm || typeof pm !== 'object') return { card_brand: null, card_last4: null, card_exp_month: null, card_exp_year: null };
  if (pm.card) return { card_brand: pm.card.brand, card_last4: pm.card.last4, card_exp_month: pm.card.exp_month, card_exp_year: pm.card.exp_year };
  const detail = pm[pm.type] || {};
  return {
    card_brand: pm.type === 'link' ? 'link' : String(pm.type || 'saved').replace(/_/g, ' '),
    card_last4: String(detail.last4 || '').slice(-4) || '0000',
    card_exp_month: null,
    card_exp_year: null,
  };
}

// One sync at a time per hub in this process.
const locks = new Map();
function withLock(hubId, fn) {
  const prev = locks.get(hubId) || Promise.resolve();
  const next = prev.then(fn);
  const tail = next.catch(() => {});
  locks.set(hubId, tail);
  tail.then(() => { if (locks.get(hubId) === tail) locks.delete(hubId); });
  return next;
}

// ---------------------------------------------------------------- card setup (Stripe Checkout)

// The card link is stable (so an emailed link keeps working) until Managira
// makes a new one. It only opens Stripe's page to save a card for this hub.
async function setupLink(db, hubId, baseUrl, { rotate = false } = {}) {
  await ensureHubBillingSchema(db);
  const billing = await loadBilling(db, hubId);
  let token = billing && billing.setup_token;
  if (!token || rotate) {
    token = crypto.randomBytes(24).toString('hex');
    await setBilling(db, hubId, { setup_token: token });
  }
  return `${String(baseUrl).replace(/\/$/, '')}/hub/billing/setup/${token}`;
}
async function hubIdForSetupToken(db, token) {
  if (!/^[a-f0-9]{48}$/.test(String(token || ''))) return null;
  await ensureHubBillingSchema(db);
  const row = (await db.query('SELECT hub_id FROM hub_billing WHERE setup_token = $1', [String(token)])).rows[0];
  return row ? row.hub_id : null;
}

// What the Stripe page tells them before they save the card.
async function cardPageMessage(db, hubId) {
  const [hub, billing] = await Promise.all([loadHub(db, hubId), loadBilling(db, hubId)]);
  if (!billing) return '';
  if (billing.stripe_subscription_id && billing.status !== 'canceled') return `This card will pay ${hub.hub_name}’s Managira bills from now on.`;
  const bill = computeBill(billing, await loadUsage(db, hubId), await loadCharges(db, hubId));
  const first = firstChargeAt(billing, hub);
  const amount = money(bill.total, billing.currency);
  return first
    ? `Nothing is charged today. Your first bill, about ${amount}, is on ${fmtDate(first)}. After that you are billed ${bill.cycle.label.toLowerCase()} until the contract ends or is cancelled.`
    : `Your first bill, about ${amount}, is charged once the card is saved. After that you are billed ${bill.cycle.label.toLowerCase()} until the contract ends or is cancelled.`;
}

async function createCardSession(db, hubId, { successUrl, cancelUrl }) {
  const [hub, billing] = await Promise.all([loadHub(db, hubId), loadBilling(db, hubId)]);
  if (!hub || hub.deleted) throw new BillingError('This hub no longer exists.');
  if (!billingLive(billing)) throw new BillingError('Billing isn’t set up for this hub yet. Please contact Managira.');
  const { stripe, mode } = await stripeClient(db);
  const customer = await ensureCustomer(db, stripe, mode, hub, billing);
  const sep = successUrl.includes('?') ? '&' : '?';
  const params = {
    mode: 'setup',
    customer: customer.id,
    payment_method_types: ['card'],
    success_url: `${successUrl}${sep}session_id={CHECKOUT_SESSION_ID}`,
    cancel_url: cancelUrl,
    metadata: { flow: 'hub_billing_setup', managira_hub_id: String(hubId) },
    setup_intent_data: {
      description: `${hub.hub_name}: Managira hub billing`.slice(0, 250),
      metadata: { flow: 'hub_billing_setup', managira_hub_id: String(hubId) },
    },
  };
  const message = await cardPageMessage(db, hubId);
  let session;
  try {
    session = await stripe.checkout.sessions.create(message ? { ...params, custom_text: { submit: { message: message.slice(0, 1000) } } } : params);
  } catch (err) {
    if (!message) throw err;
    session = await stripe.checkout.sessions.create(params);
  }
  return session.url;
}

// After the Stripe page: make the card the default and start (or update) billing.
async function completeCardSession(db, hubId, sessionId) {
  if (!/^cs_[A-Za-z0-9_]+$/.test(String(sessionId || ''))) throw new BillingError('That card setup link is not valid.');
  const { stripe } = await stripeClient(db);
  const session = await stripe.checkout.sessions.retrieve(sessionId, { expand: ['setup_intent'] });
  if (!session || String((session.metadata || {}).managira_hub_id) !== String(hubId)) throw new BillingError('This card setup belongs to a different hub.');
  const si = session.setup_intent;
  if (!si || si.status !== 'succeeded') throw new BillingError('The card was not saved. Please try again.');
  const pm = typeof si.payment_method === 'string' ? si.payment_method : si.payment_method && si.payment_method.id;
  return saveCard(db, hubId, pm);
}

async function saveCard(db, hubId, paymentMethodId, { by = 'The hub' } = {}) {
  const billing = await loadBilling(db, hubId);
  if (!billing || !billing.stripe_customer_id) throw new BillingError('Billing isn’t set up for this hub yet.');
  const { stripe } = await stripeClient(db);
  const pm = await stripe.paymentMethods.retrieve(paymentMethodId);
  const owner = typeof pm.customer === 'string' ? pm.customer : pm.customer && pm.customer.id;
  if (owner !== billing.stripe_customer_id) throw new BillingError('This card belongs to a different account.');
  await stripe.customers.update(billing.stripe_customer_id, { invoice_settings: { default_payment_method: pm.id } });
  const fields = methodFields(pm);
  const already = billing.card_last4 === fields.card_last4 && billing.card_added_at;
  await setBilling(db, hubId, { ...fields, card_added_at: new Date(), last_error: null });
  if (billing.stripe_subscription_id) {
    await stripe.subscriptions.update(billing.stripe_subscription_id, { default_payment_method: pm.id }).catch(() => {});
    // Pay anything that failed on the old card.
    const open = await stripe.invoices.list({ customer: billing.stripe_customer_id, status: 'open', limit: 5 }).catch(() => ({ data: [] }));
    for (const inv of open.data) {
      await stripe.invoices.pay(inv.id, { payment_method: pm.id, off_session: true }).catch(() => {});
    }
  }
  if (!already) await logHub(db, hubId, 'BILLING_CARD_SAVED', `${methodLabel(fields)} saved for billing`, by);
  // A problem starting the subscription is kept in last_error and shown to Managira.
  await syncSubscription(db, hubId).catch(() => {});
  return refresh(db, hubId);
}

// ---------------------------------------------------------------- keeping Stripe in step

async function desiredItems(db, stripe, mode, billing, bill) {
  const cycle = bill.cycle;
  const recurring = { interval: cycle.interval, interval_count: cycle.count };
  const items = [];
  for (const line of bill.lines.filter((l) => l.recurring)) {
    let productKey;
    let productName;
    if (line.key === 'base') { productKey = 'base'; productName = 'Hub plan fee'; }
    else if (line.key.startsWith('meter:')) { productKey = line.key; productName = `Hub plan: ${METERS[line.key.slice(6)].many}`; }
    else if (line.key.startsWith('integration:')) { productKey = line.key; productName = line.label; }
    else if (line.key === 'extra_schools') { productKey = 'extra_schools'; productName = 'Extra schools'; }
    else if (line.key === 'extra_users') { productKey = 'extra_users'; productName = 'Extra user licenses'; }
    else { productKey = `charge:${line.chargeId}`; productName = line.label; }
    items.push({
      key: line.key,
      quantity: line.quantity,
      price_data: {
        currency: billing.currency || 'usd',
        product: await productFor(db, stripe, mode, productKey, productName),
        recurring,
        unit_amount_decimal: String(Math.round(line.unitPrice * 100 * 10000) / 10000),
      },
    });
  }
  return items;
}

function sameItemPrice(existing, wanted) {
  const p = existing.price || {};
  const r = p.recurring || {};
  return String(p.product) === String(wanted.price_data.product)
    && Number(p.unit_amount_decimal != null ? p.unit_amount_decimal : p.unit_amount) === Number(wanted.price_data.unit_amount_decimal)
    && r.interval === wanted.price_data.recurring.interval
    && Number(r.interval_count || 1) === Number(wanted.price_data.recurring.interval_count)
    && String(p.currency).toLowerCase() === String(wanted.price_data.currency).toLowerCase();
}

const LIVE_SUB = ['trialing', 'active', 'past_due', 'unpaid', 'incomplete', 'paused'];

// Make the hub's Stripe subscription match its contract. Creates it once a
// card is saved. Safe to call any time; it only sends what changed.
function syncSubscription(db, hubId) {
  return withLock(hubId, async () => {
    const [hub, billing] = await Promise.all([loadHub(db, hubId), loadBilling(db, hubId)]);
    if (!hub || !billing) return { skipped: 'no billing' };
    if (!hasPrice(billing)) {
      await setBilling(db, hubId, { status: billing.stripe_subscription_id ? billing.status : 'draft' });
      return { skipped: 'no price' };
    }
    if (billing.ended_at) return { skipped: 'ended' };

    const { stripe, mode } = await stripeClient(db);
    if (!billing.stripe_customer_id || billing.stripe_mode !== mode) {
      await setBilling(db, hubId, { status: 'awaiting_card' });
      return { skipped: 'no card' };
    }

    let changed = false;
    try {
      const customer = await stripe.customers.retrieve(billing.stripe_customer_id);
      const pm = customer && !customer.deleted && customer.invoice_settings && customer.invoice_settings.default_payment_method;
      const wantEmail = billing.billing_email || hub.hub_email;
      if (customer && !customer.deleted && (customer.email !== wantEmail || customer.name !== hub.hub_name)) {
        await stripe.customers.update(customer.id, { email: wantEmail, name: hub.hub_name });
      }
      const [usage, charges] = await Promise.all([loadUsage(db, hubId), loadCharges(db, hubId)]);
      const bill = computeBill(billing, usage, charges);
      const items = await desiredItems(db, stripe, mode, billing, bill);

      let sub = null;
      if (billing.stripe_subscription_id) {
        sub = await stripe.subscriptions.retrieve(billing.stripe_subscription_id).catch(() => null);
        if (sub && !LIVE_SUB.includes(sub.status)) sub = null;
      }
      if (!sub) {
        const list = await stripe.subscriptions.list({ customer: billing.stripe_customer_id, status: 'all', limit: 20 });
        sub = list.data.find((s) => LIVE_SUB.includes(s.status) && (s.metadata || {}).managira_hub_id === String(hubId)) || null;
      }

      const now = new Date();
      const first = firstChargeAt(billing, hub, now);
      const cancelAt = cancelAtFor(billing, hub);
      const coupon = couponSpec(billing, first, now);
      let couponId = billing.stripe_coupon_id;
      const couponChanged = (coupon ? coupon.key : '') !== (billing.applied_discount_key || '');
      if (coupon && (couponChanged || !couponId)) couponId = (await stripe.coupons.create(coupon.spec)).id;

      if (!sub) {
        if (!pm) { await setBilling(db, hubId, { status: 'awaiting_card' }); return { skipped: 'no card' }; }
        if (!items.length) { await setBilling(db, hubId, { status: 'draft', last_error: 'Nothing to bill yet: set a price.' }); return { skipped: 'nothing to bill' }; }
        const params = {
          customer: billing.stripe_customer_id,
          default_payment_method: typeof pm === 'string' ? pm : pm.id,
          collection_method: 'charge_automatically',
          items: items.map((i) => ({ price_data: i.price_data, quantity: i.quantity, metadata: { key: i.key } })),
          metadata: { managira_hub_id: String(hubId), managira_kind: 'hub' },
          description: `Managira hub: ${hub.hub_name}`.slice(0, 500),
          proration_behavior: 'none',
          off_session: true,
          payment_behavior: 'allow_incomplete',
        };
        const freePeriod = first && first.getTime() - now.getTime() > 120000;
        if (freePeriod) params.trial_end = ts(first);
        // Charged now: one-time charges go on this first bill. (With a free
        // period they are added below and land on the first paid bill.)
        const onceNow = freePeriod ? [] : charges.filter((x) => x.status === 'approved' && x.frequency === 'once' && !x.billed_at);
        if (onceNow.length) {
          params.add_invoice_items = [];
          for (const c of onceNow) {
            params.add_invoice_items.push({
              price_data: { currency: billing.currency || 'usd', product: await productFor(db, stripe, mode, `charge:${c.charge_id}`, c.name), unit_amount_decimal: String(Math.round(Number(c.unit_price) * 100 * 10000) / 10000) },
              quantity: Number(c.quantity) || 1,
            });
          }
        }
        if (coupon) params.discounts = [{ coupon: couponId }];
        if (cancelAt && cancelAt > now) params.cancel_at = ts(cancelAt);
        const key = crypto.createHash('sha1').update(JSON.stringify(params)).digest('hex').slice(0, 24);
        sub = await stripe.subscriptions.create(params, { idempotencyKey: `hub-sub-${hubId}-${key}` });
        changed = true;
        if (onceNow.length) {
          await db.query(
            `UPDATE hub_billing_charges SET stripe_invoice_item_id = $1, stripe_mode = $2, billed_at = NOW(), updated_at = NOW() WHERE charge_id = ANY($3::int[])`,
            [`first-bill:${sub.id}`, mode, onceNow.map((x) => x.charge_id)]
          );
          onceNow.forEach((x) => { x.billed_at = new Date(); });
        }
        await setBilling(db, hubId, {
          stripe_subscription_id: sub.id,
          stripe_coupon_id: coupon ? couponId : null,
          applied_discount_key: coupon ? coupon.key : null,
          applied_first_charge_at: first,
        });
        await logHub(db, hubId, 'BILLING_STARTED', first ? `Billing set up. First bill on ${fmtDate(first)}.` : 'Billing started.');
      } else {
        const update = {};
        if (sub.id !== billing.stripe_subscription_id) await setBilling(db, hubId, { stripe_subscription_id: sub.id });

        // Items: add, change or remove only what differs.
        const byKey = new Map(sub.items.data.map((it) => [(it.metadata || {}).key || it.id, it]));
        const changes = [];
        for (const want of items) {
          const have = byKey.get(want.key);
          byKey.delete(want.key);
          if (!have) changes.push({ price_data: want.price_data, quantity: want.quantity, metadata: { key: want.key } });
          else if (!sameItemPrice(have, want)) changes.push({ id: have.id, price_data: want.price_data, quantity: want.quantity });
          else if (Number(have.quantity) !== Number(want.quantity)) changes.push({ id: have.id, quantity: want.quantity });
        }
        byKey.forEach((have) => changes.push({ id: have.id, deleted: true }));
        if (changes.length && items.length) update.items = changes;

        // Free period / start date.
        const applied = billing.applied_first_charge_at ? new Date(billing.applied_first_charge_at).getTime() : null;
        const wanted = first ? first.getTime() : null;
        if (applied !== wanted) {
          if (first && first.getTime() - now.getTime() > 120000) update.trial_end = ts(first);
          else if (sub.status === 'trialing') update.trial_end = 'now';
        }

        // Contract end.
        const haveCancel = sub.cancel_at || null;
        const wantCancel = cancelAt && cancelAt > now ? ts(cancelAt) : null;
        if (!sub.cancel_at_period_end && haveCancel !== wantCancel) update.cancel_at = wantCancel || '';

        // Discount.
        if (couponChanged) update.discounts = coupon ? [{ coupon: couponId }] : '';

        // Hold: Stripe voids bills while the hub is on hold.
        const paused = !!sub.pause_collection;
        const shouldPause = hub.on_hold || hub.deleted;
        if (shouldPause && !paused) {
          update.pause_collection = { behavior: 'void' };
          if (billing.hold_ends_at && new Date(billing.hold_ends_at) > now) update.pause_collection.resumes_at = ts(billing.hold_ends_at);
        } else if (!shouldPause && paused) {
          update.pause_collection = '';
        }

        if (Object.keys(update).length) {
          update.proration_behavior = 'none';
          sub = await stripe.subscriptions.update(sub.id, update);
          changed = true;
        }
        await setBilling(db, hubId, {
          stripe_coupon_id: coupon ? couponId : null,
          applied_discount_key: coupon ? coupon.key : null,
          applied_first_charge_at: first,
        });
      }

      // A hold that starts before the subscription existed.
      if ((hub.on_hold || hub.deleted) && !sub.pause_collection) {
        sub = await stripe.subscriptions.update(sub.id, { pause_collection: { behavior: 'void' } });
        changed = true;
      }

      // One-time charges go on the next bill.
      for (const c of charges.filter((x) => x.status === 'approved' && x.frequency === 'once' && !x.billed_at)) {
        const item = await stripe.invoiceItems.create({
          customer: billing.stripe_customer_id,
          subscription: sub.id,
          currency: billing.currency || 'usd',
          amount: toCents(Number(c.unit_price) * (Number(c.quantity) || 1)),
          description: `${c.name}${Number(c.quantity) > 1 ? ` × ${c.quantity}` : ''}`.slice(0, 250),
          metadata: { managira_hub_id: String(hubId), charge_id: String(c.charge_id) },
        }, { idempotencyKey: `hub-charge-${c.charge_id}-${mode}` });
        await db.query(
          'UPDATE hub_billing_charges SET stripe_invoice_item_id = $1, stripe_mode = $2, billed_at = NOW(), updated_at = NOW() WHERE charge_id = $3',
          [item.id, mode, c.charge_id]
        );
        changed = true;
      }

      await setBilling(db, hubId, { last_error: null });
      // Read back the next charge and any new bill.
      if (changed) await refresh(db, hubId).catch(() => {});
      return { ok: true, changed, subscriptionId: sub.id };
    } catch (err) {
      const message = err instanceof BillingError ? err.message : stripeMessage(err);
      console.error('[hubBilling.sync]', hubId, message);
      await setBilling(db, hubId, { last_error: message });
      throw err instanceof BillingError ? err : new BillingError(message);
    }
  });
}

const STRIPE_STATUS = { trialing: 'trialing', active: 'active', past_due: 'past_due', unpaid: 'past_due', incomplete: 'incomplete', paused: 'paused', canceled: 'canceled', incomplete_expired: 'canceled' };

// Read the latest from Stripe: status, card, next bill and invoices.
async function refresh(db, hubId) {
  const [hub, billing] = await Promise.all([loadHub(db, hubId), loadBilling(db, hubId)]);
  if (!hub || !billing) return null;
  let mode;
  let stripe;
  try { ({ stripe, mode } = await stripeClient(db)); } catch (_e) { return billing; }
  const fields = { last_synced_at: new Date() };

  if (!billing.stripe_customer_id || billing.stripe_mode !== mode) {
    fields.status = !hasPrice(billing) ? 'draft' : billing.ended_at ? 'canceled' : 'awaiting_card';
    await setBilling(db, hubId, fields);
    return loadBilling(db, hubId);
  }

  try {
    const customer = await stripe.customers.retrieve(billing.stripe_customer_id, { expand: ['invoice_settings.default_payment_method'] });
    const pm = customer && !customer.deleted && customer.invoice_settings && customer.invoice_settings.default_payment_method;
    if (pm && typeof pm === 'object') Object.assign(fields, methodFields(pm));
    else if (!pm) Object.assign(fields, methodFields(null));

    let sub = null;
    if (billing.stripe_subscription_id) sub = await stripe.subscriptions.retrieve(billing.stripe_subscription_id).catch(() => null);
    if (sub) {
      let status = STRIPE_STATUS[sub.status] || 'active';
      if (sub.pause_collection && status !== 'canceled') status = 'paused';
      fields.status = status;
      fields.current_period_end = fromTs(sub.current_period_end);
      fields.next_charge_at = status === 'canceled' || status === 'paused' ? null : fromTs(sub.status === 'trialing' ? sub.trial_end : sub.current_period_end);
      if (sub.cancel_at && fields.next_charge_at && sub.cancel_at <= ts(fields.next_charge_at)) fields.next_charge_at = null;
      fields.next_charge_amount = null;
      if (fields.next_charge_at) {
        const preview = await stripe.invoices.createPreview({ customer: billing.stripe_customer_id, subscription: sub.id }).catch(() => null);
        if (preview) fields.next_charge_amount = round2((preview.amount_due || 0) / 100);
      }
      if (status === 'canceled' && !billing.ended_at) fields.ended_at = fromTs(sub.ended_at) || new Date();
    } else {
      fields.status = !hasPrice(billing) ? 'draft' : billing.ended_at ? 'canceled' : 'awaiting_card';
      fields.next_charge_at = null;
      fields.next_charge_amount = null;
    }

    // Only write bills that are new or changed.
    const invoices = await stripe.invoices.list({ customer: billing.stripe_customer_id, limit: 24 });
    const known = new Map((await db.query(
      'SELECT stripe_invoice_id, status, amount_paid, attempt_count, (lines IS NOT NULL) AS has_lines FROM hub_billing_invoices WHERE stripe_invoice_id = ANY($1::text[])',
      [invoices.data.map((i) => i.id)]
    )).rows.map((r) => [r.stripe_invoice_id, r]));
    for (const inv of invoices.data) {
      const k = known.get(inv.id);
      if (k && k.has_lines && k.status === inv.status && Number(k.amount_paid) === round2((inv.amount_paid || 0) / 100) && Number(k.attempt_count) === Number(inv.attempt_count || 0)) continue;
      await recordInvoice(db, hubId, mode, inv);
    }
  } catch (err) {
    fields.last_error = stripeMessage(err);
  }
  await setBilling(db, hubId, fields);
  return loadBilling(db, hubId);
}

// Keep a copy of each Stripe invoice and email about new payments / failures.
async function recordInvoice(db, hubId, mode, inv) {
  if (!inv || !inv.id || inv.status === 'draft') return;
  const lastError = inv.last_finalization_error ? inv.last_finalization_error.message : null;
  // The period the bill pays for (the invoice's own period is the previous one).
  const lines = (inv.lines && inv.lines.data) || [];
  const line = lines.find((l) => l.type === 'subscription') || lines[0];
  const period = line && line.period ? line.period : { start: inv.period_start, end: inv.period_end };
  const row = (await db.query(
    `INSERT INTO hub_billing_invoices (stripe_invoice_id, hub_id, stripe_mode, number, status, amount_due, amount_paid, currency,
        period_start, period_end, issued_at, paid_at, attempt_count, last_error, hosted_invoice_url, invoice_pdf, updated_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,NOW())
     ON CONFLICT (stripe_invoice_id) DO UPDATE SET status = EXCLUDED.status, number = EXCLUDED.number, amount_due = EXCLUDED.amount_due,
        period_start = EXCLUDED.period_start, period_end = EXCLUDED.period_end,
        amount_paid = EXCLUDED.amount_paid, paid_at = EXCLUDED.paid_at, attempt_count = EXCLUDED.attempt_count,
        last_error = EXCLUDED.last_error, hosted_invoice_url = EXCLUDED.hosted_invoice_url, invoice_pdf = EXCLUDED.invoice_pdf, updated_at = NOW()
     RETURNING *`,
    [
      inv.id, hubId, mode, inv.number || null, inv.status, round2((inv.amount_due || 0) / 100), round2((inv.amount_paid || 0) / 100),
      inv.currency || 'usd', fromTs(period.start), fromTs(period.end), fromTs(inv.status_transitions && inv.status_transitions.finalized_at) || fromTs(inv.created),
      fromTs(inv.status_transitions && inv.status_transitions.paid_at), inv.attempt_count || 0, lastError,
      inv.hosted_invoice_url || null, inv.invoice_pdf || null,
    ]
  )).rows[0];

  // First time we see this bill: keep its lines and the schools counted now.
  if (!row.lines) {
    const billLines = lines.filter((l) => Number(l.amount) !== 0 || l.type === 'subscription').map((l) => ({
      description: String(l.description || '').replace(/^\d+ × /, '').replace(/ \(at .*\)$/, ''),
      qty: Number(l.quantity) || 1,
      unitAmount: l.price && (l.price.unit_amount_decimal != null || l.price.unit_amount != null)
        ? round2(Number(l.price.unit_amount_decimal != null ? l.price.unit_amount_decimal : l.price.unit_amount) / 100)
        : null,
      amount: round2((l.amount || 0) / 100),
      period: l.period ? { start: l.period.start, end: l.period.end } : null,
    }));
    const discount = round2((inv.total_discount_amounts || []).reduce((n, d) => n + (d.amount || 0), 0) / 100);
    let schools = null;
    try {
      schools = (await loadUsage(db, hubId)).breakdown.map((x) => ({
        name: x.organization_name, counted: x.counted, students: x.billedStudents, employees: x.billedEmployees, users: x.billedUsers, integrations: x.integrations,
      }));
    } catch (_e) { /* the invoice still shows its lines */ }
    await db.query(
      'UPDATE hub_billing_invoices SET lines = $2, discount = $3, total = $4, schools = $5 WHERE stripe_invoice_id = $1',
      [inv.id, JSON.stringify(billLines), discount, round2((inv.total || 0) / 100), schools ? JSON.stringify(schools) : null]
    );
  }

  if (row.status === 'paid' && Number(row.amount_paid) > 0 && !row.notified_paid) {
    await db.query('UPDATE hub_billing_invoices SET notified_paid = TRUE WHERE stripe_invoice_id = $1', [inv.id]);
    await logHub(db, hubId, 'BILLING_PAID', `Payment of ${money(row.amount_paid, row.currency)} received${row.number ? ` (invoice ${row.number})` : ''}`);
    await emailBilling(db, hubId, (hub) => ({
      subject: `Payment received: ${money(row.amount_paid, row.currency)} for ${hub.hub_name}`,
      title: 'Payment received',
      paragraphs: [
        `We received ${money(row.amount_paid, row.currency)} for ${hub.hub_name}’s Managira hub${row.number ? ` (invoice ${row.number})` : ''}. Thank you.`,
        'You can see every bill on the Billing page of your hub.',
      ],
      cta: row.hosted_invoice_url ? { text: 'View receipt', url: row.hosted_invoice_url } : null,
    }));
  }
  if (row.status === 'open' && row.attempt_count > 0 && row.attempt_count > row.notified_failed_attempt) {
    await db.query('UPDATE hub_billing_invoices SET notified_failed_attempt = $2 WHERE stripe_invoice_id = $1', [inv.id, row.attempt_count]);
    await logHub(db, hubId, 'BILLING_FAILED', `Payment of ${money(row.amount_due, row.currency)} failed`);
    await emailBilling(db, hubId, (hub) => ({
      subject: `Payment failed for ${hub.hub_name} on Managira`,
      title: 'We couldn’t take your payment',
      paragraphs: [
        `Your card was declined for ${hub.hub_name}’s bill of ${money(row.amount_due, row.currency)}.`,
        'Please pay it with the button below, or add a new card on your hub’s Billing page. We will also try the card again automatically.',
      ],
      cta: row.hosted_invoice_url ? { text: 'Pay this bill', url: row.hosted_invoice_url } : null,
    }));
  }
}

// ---------------------------------------------------------------- emails

const appUrl = () => String(process.env.BASE_URL_PRODUCTION || process.env.BASE_URL || 'https://managira.com').replace(/\/$/, '');

// Billing emails go to the hub owner, the billing email (if any) and hub
// users who see billing and have not turned billing emails off.
async function billingRecipients(db, hubId) {
  const { getHubRecipients } = require('./hubAccess');
  const out = new Map();
  (await getHubRecipients(db, hubId, 'hub_billing').catch(() => [])).forEach((r) => out.set(r.email.toLowerCase(), r));
  // Billing people who were invited but haven't set a password yet still get billing emails.
  (await db.query(
    `SELECT u.email, u.first_name FROM hub_users u
       LEFT JOIN hub_user_email_preferences p ON p.hub_user_id = u.hub_user_id AND p.preference_key = 'hub_billing'
      WHERE u.hub_id = $1 AND u.on_hold = FALSE AND u.password IS NULL AND COALESCE(p.enabled, TRUE)
        AND (u.role = 'hub_admin' OR 'billing.view' = ANY(u.permissions))`,
    [hubId]
  ).catch(() => ({ rows: [] }))).rows.forEach((u) => out.set(u.email.toLowerCase(), { email: u.email, firstName: u.first_name }));
  const billing = await loadBilling(db, hubId);
  if (billing && billing.billing_email) out.set(billing.billing_email.toLowerCase(), { email: billing.billing_email, firstName: '' });
  return Array.from(out.values());
}

async function emailBilling(db, hubId, build, { to } = {}) {
  try {
    const hub = await loadHub(db, hubId);
    if (!hub) return 0;
    const list = to || await billingRecipients(db, hubId);
    if (!list.length) return 0;
    const { sendEmailInBackground, renderCleanEmail } = require('./emailHelper');
    list.forEach((r) => {
      const m = build(hub, r);
      sendEmailInBackground({
        from: process.env.NOTIFY_EMAIL_USER,
        to: r.email,
        subject: m.subject,
        html: renderCleanEmail({
          title: m.title,
          greeting: `Hello${r.firstName ? ` ${r.firstName}` : ''},`,
          paragraphs: m.paragraphs,
          details: m.details || [],
          cta: m.cta || null,
          note: m.note || '',
        }),
      }, 'Hub billing');
    });
    return list.length;
  } catch (err) {
    console.error('[hubBilling.email]', err && err.message);
    return 0;
  }
}

async function planDetails(db, hubId) {
  const [hub, billing] = await Promise.all([loadHub(db, hubId), loadBilling(db, hubId)]);
  const bill = computeBill(billing, await loadUsage(db, hubId), await loadCharges(db, hubId));
  const first = firstChargeAt(billing, hub);
  const out = [
    `Billing: ${bill.cycle.label}`,
    ...METER_KEYS.filter((k) => metersOf(billing)[k] && metersOf(billing)[k].on).map((k) => {
      const m = metersOf(billing)[k];
      return `${METERS[k].label}: ${money(m.price, billing.currency)} each ${bill.cycle.per} (${Number(m.included || 0).toLocaleString('en-US')} included)`;
    }),
    Number(billing.base_fee) > 0 ? `Plan fee: ${money(billing.base_fee, billing.currency)} each ${bill.cycle.per}` : null,
    ...INTEGRATIONS.filter((i) => integrationFeesOf(billing)[i.key] && integrationFeesOf(billing)[i.key].on).map((i) => {
      const f = integrationFeesOf(billing)[i.key];
      return `${i.label}: ${money(f.price, billing.currency)} per school each ${bill.cycle.per}${f.mode === 'manual' ? ' (added when needed)' : ' (for each school that uses it)'}`;
    }),
    discountLabel(billing) ? `Discount: ${discountLabel(billing)}` : null,
    `Each bill: about ${money(bill.total, billing.currency)} with today’s numbers`,
    first ? `First charge: ${fmtDate(first)}` : 'First charge: when the card is saved',
    hub.contract_end_date ? `Contract ends: ${fmtDate(dayAtNoon(hub.contract_end_date))}${billing.auto_renew ? ' (renews automatically)' : ''}` : null,
  ].filter(Boolean);
  return { hub, billing, bill, first, details: out };
}

// Email the card setup link (owner + billing contacts, or `to`).
async function sendSetupLink(db, hubId, { baseUrl, to, by = 'Managira' } = {}) {
  const billing = await loadBilling(db, hubId);
  if (!billingLive(billing)) throw new BillingError('Set a price for this hub before sending the payment link.');
  const url = await setupLink(db, hubId, baseUrl || appUrl());
  const { details } = await planDetails(db, hubId);
  const sent = await emailBilling(db, hubId, (hub) => ({
    subject: `Action needed: add a card for ${hub.hub_name} on Managira`,
    title: 'Set up your hub payment',
    paragraphs: [
      `${hub.hub_name}’s Managira hub is ready. Please add the card we should charge, using Stripe’s secure page.`,
      'Your card is only charged on the dates in your agreement. You can see every charge on your hub’s Billing page.',
    ],
    details,
    cta: { text: 'Add your card', url },
    note: 'This link stays valid until the card is added. You can also add the card from Billing after you sign in.',
  }), { to });
  await setBilling(db, hubId, { setup_link_sent_at: new Date() });
  await logHub(db, hubId, 'BILLING_LINK_SENT', 'Payment link emailed', by);
  return { sent, url };
}

// ---------------------------------------------------------------- charges

async function addCharge(db, hubId, { kind = 'custom', addonId = null, integrationKey = null, organizationId = null, name, description, unitPrice, quantity = 1, frequency = 'recurring', status = 'pending', requestedBy = 'admin', by }) {
  await ensureHubBillingSchema(db);
  const row = (await db.query(
    `INSERT INTO hub_billing_charges (hub_id, kind, addon_id, integration_key, organization_id, name, description, unit_price, quantity, frequency, status,
        requested_by, requested_by_label, decided_by_label, decided_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15) RETURNING *`,
    [hubId, kind, addonId, integrationKey, organizationId, String(name).slice(0, 120), description || null, round2(unitPrice), Math.max(1, parseInt(quantity, 10) || 1),
      frequency === 'once' ? 'once' : 'recurring', status, requestedBy, by || null,
      status === 'approved' ? (by || null) : null, status === 'approved' ? new Date() : null]
  )).rows[0];
  return row;
}

function chargeSummary(c, billing) {
  const per = c.frequency === 'once' ? 'one time' : `each ${(CYCLES[billing && billing.billing_cycle] || CYCLES.month).per}`;
  const qty = Number(c.quantity) > 1 ? ` × ${c.quantity}` : '';
  return `${c.name}: ${money(c.unit_price, billing && billing.currency)}${qty} ${per}`;
}

// Managira adds a charge; it waits for the hub to approve it.
async function requestCharge(db, hubId, fields, { baseUrl, by = 'Managira' } = {}) {
  const billing = await loadBilling(db, hubId);
  const charge = await addCharge(db, hubId, { ...fields, status: 'pending', requestedBy: 'admin', by });
  await logHub(db, hubId, 'BILLING_CHARGE_REQUESTED', `${chargeSummary(charge, billing)} is waiting for approval`, by);
  await emailBilling(db, hubId, (hub) => ({
    subject: `Please approve a new charge for ${hub.hub_name}`,
    title: 'A new charge needs your approval',
    paragraphs: [
      `Managira added a charge to ${hub.hub_name}’s bill. Nothing is charged until someone in your hub approves it.`,
    ],
    details: [chargeSummary(charge, billing), charge.description ? charge.description : null].filter(Boolean),
    cta: { text: 'Review the charge', url: `${(baseUrl || appUrl()).replace(/\/$/, '')}/hub/billing` },
  }));
  return charge;
}

async function decideCharge(db, hubId, chargeId, approve, { by }) {
  const c = (await db.query(`SELECT * FROM hub_billing_charges WHERE charge_id = $1 AND hub_id = $2`, [chargeId, hubId])).rows[0];
  if (!c) throw new BillingError('That charge was not found.');
  if (c.status !== 'pending') throw new BillingError('That charge was already decided.');
  const done = await db.query(
    `UPDATE hub_billing_charges SET status = $1, decided_by_label = $2, decided_at = NOW(), updated_at = NOW()
      WHERE charge_id = $3 AND status = 'pending'`,
    [approve ? 'approved' : 'declined', by, chargeId]
  );
  if (!done.rowCount) throw new BillingError('That charge was already decided.');
  const billing = await loadBilling(db, hubId);
  await logHub(db, hubId, approve ? 'BILLING_CHARGE_APPROVED' : 'BILLING_CHARGE_DECLINED', `${chargeSummary(c, billing)} ${approve ? 'approved' : 'declined'}`, by);
  if (approve) await syncSubscription(db, hubId).catch(() => {});
  return c;
}

async function removeCharge(db, hubId, chargeId, { by = 'Managira' } = {}) {
  const c = (await db.query(`SELECT * FROM hub_billing_charges WHERE charge_id = $1 AND hub_id = $2`, [chargeId, hubId])).rows[0];
  if (!c) throw new BillingError('That charge was not found.');
  if (!['pending', 'approved'].includes(c.status)) return c;
  if (c.stripe_invoice_item_id) {
    try {
      const { stripe } = await stripeClient(db);
      const item = await stripe.invoiceItems.retrieve(c.stripe_invoice_item_id);
      if (item && !item.invoice) await stripe.invoiceItems.del(c.stripe_invoice_item_id);
      else throw new BillingError('This one-time charge is already on a bill, so it can’t be removed. Refund it in Stripe if needed.');
    } catch (err) {
      if (err instanceof BillingError) throw err;
    }
  }
  await db.query(`UPDATE hub_billing_charges SET status = 'removed', removed_at = NOW(), updated_at = NOW() WHERE charge_id = $1`, [chargeId]);
  const billing = await loadBilling(db, hubId);
  await logHub(db, hubId, 'BILLING_CHARGE_REMOVED', `${chargeSummary(c, billing)} removed`, by);
  if (c.status === 'approved') await syncSubscription(db, hubId).catch(() => {});
  return c;
}

// The hub approves going over its plan by one school / user license. Nothing
// is stored as a charge: extras are billed from the real numbers. This keeps a
// record of who approved what, at which price.
async function approveExtra(db, hubId, kind, { by }) {
  const cap = await capacity(db, hubId, kind);
  if (!cap || !cap.canBuy) throw new BillingError('Extra places can’t be added on this plan. Please contact Managira.');
  const what = kind === 'school' ? 'school' : 'user license';
  await logHub(db, hubId, 'BILLING_EXTRA_APPROVED', `Approved 1 extra ${what} at ${money(cap.price, cap.currency)} each ${cap.per}`, by);
  return cap;
}

// ---------------------------------------------------------------- hold / end

async function holdNow(db, hubId, { endsAt = null, by = 'Managira' } = {}) {
  await ensureHubBillingSchema(db);
  await db.query('UPDATE managira_hubs SET on_hold = true, updated_at = NOW() WHERE hub_id = $1', [hubId]);
  await db.query(
    `INSERT INTO hub_billing (hub_id, hold_ends_at) VALUES ($1, $2)
     ON CONFLICT (hub_id) DO UPDATE SET hold_starts_at = NULL, hold_ends_at = $2, updated_at = NOW()`,
    [hubId, endsAt]
  );
  await logHub(db, hubId, 'BILLING_HOLD', endsAt ? `Hub put on hold until ${fmtDate(endsAt)}. No bills while on hold.` : 'Hub put on hold. No bills while on hold.', by);
  await syncSubscription(db, hubId).catch(() => {});
  await refresh(db, hubId).catch(() => {});
}

async function scheduleHold(db, hubId, { startsAt, endsAt = null, by = 'Managira' }) {
  await ensureHubBillingSchema(db);
  await db.query(
    `INSERT INTO hub_billing (hub_id, hold_starts_at, hold_ends_at) VALUES ($1, $2, $3)
     ON CONFLICT (hub_id) DO UPDATE SET hold_starts_at = $2, hold_ends_at = $3, updated_at = NOW()`,
    [hubId, startsAt, endsAt]
  );
  await logHub(db, hubId, 'BILLING_HOLD_SCHEDULED', `Hold scheduled from ${fmtDate(startsAt)}${endsAt ? ` to ${fmtDate(endsAt)}` : ''}`, by);
}

async function resumeNow(db, hubId, { by = 'Managira' } = {}) {
  await ensureHubBillingSchema(db);
  await db.query('UPDATE managira_hubs SET on_hold = false, updated_at = NOW() WHERE hub_id = $1', [hubId]);
  await db.query('UPDATE hub_billing SET hold_starts_at = NULL, hold_ends_at = NULL, updated_at = NOW() WHERE hub_id = $1', [hubId]);
  await logHub(db, hubId, 'BILLING_RESUMED', 'Hub resumed. Billing continues.', by);
  await syncSubscription(db, hubId).catch(() => {});
  await refresh(db, hubId).catch(() => {});
}

async function cancelScheduledHold(db, hubId, { by = 'Managira' } = {}) {
  await ensureHubBillingSchema(db);
  await db.query('UPDATE hub_billing SET hold_starts_at = NULL, hold_ends_at = CASE WHEN hold_starts_at IS NULL THEN hold_ends_at ELSE NULL END, updated_at = NOW() WHERE hub_id = $1', [hubId]);
  await logHub(db, hubId, 'BILLING_HOLD_CANCELLED', 'Scheduled hold cancelled', by);
}

// Stop billing: at the end of the paid period, or now.
async function endBilling(db, hubId, { now = false, by = 'Managira' } = {}) {
  const billing = await loadBilling(db, hubId);
  if (!billing) throw new BillingError('This hub has no billing.');
  const { stripe, mode } = await stripeClient(db);
  if (billing.stripe_subscription_id && billing.stripe_mode === mode) {
    try {
      if (now) await stripe.subscriptions.cancel(billing.stripe_subscription_id);
      else await stripe.subscriptions.update(billing.stripe_subscription_id, { cancel_at_period_end: true });
    } catch (err) {
      if (!(err && err.code === 'resource_missing')) throw new BillingError(stripeMessage(err));
    }
  }
  if (now || !billing.stripe_subscription_id) await setBilling(db, hubId, { ended_at: new Date(), status: 'canceled', next_charge_at: null, next_charge_amount: null });
  await logHub(db, hubId, 'BILLING_ENDED', now || !billing.stripe_subscription_id ? 'Billing ended' : 'Billing ends at the end of the current period', by);
  await refresh(db, hubId).catch(() => {});
}

// A hub deleted for good: stop charging its card (its billing rows go with it).
async function cancelForDeletedHub(db, hubId) {
  try {
    await ensureHubBillingSchema(db);
    const billing = await loadBilling(db, hubId);
    if (!billing || !billing.stripe_subscription_id) return;
    const { stripe, mode } = await stripeClient(db);
    if (billing.stripe_mode !== mode) return;
    await stripe.subscriptions.cancel(billing.stripe_subscription_id).catch((err) => {
      if (!(err && err.code === 'resource_missing')) throw err;
    });
  } catch (err) {
    console.error('[hubBilling.cancelForDeletedHub]', hubId, err && err.message);
  }
}

async function restartBilling(db, hubId, { by = 'Managira' } = {}) {
  const billing = await loadBilling(db, hubId);
  if (!billing) throw new BillingError('This hub has no billing.');
  await setBilling(db, hubId, { ended_at: null, stripe_subscription_id: null, applied_first_charge_at: null, applied_discount_key: null, stripe_coupon_id: null, status: 'awaiting_card' });
  if (billing.stripe_subscription_id) {
    // A subscription set to end at period end can simply carry on.
    try {
      const { stripe } = await stripeClient(db);
      const sub = await stripe.subscriptions.retrieve(billing.stripe_subscription_id);
      if (sub && LIVE_SUB.includes(sub.status)) {
        await stripe.subscriptions.update(sub.id, { cancel_at_period_end: false });
        await setBilling(db, hubId, { stripe_subscription_id: sub.id, applied_first_charge_at: billing.applied_first_charge_at, applied_discount_key: billing.applied_discount_key, stripe_coupon_id: billing.stripe_coupon_id });
      }
    } catch (_e) { /* a new subscription is made below */ }
  }
  await logHub(db, hubId, 'BILLING_RESTARTED', 'Billing started again', by);
  await syncSubscription(db, hubId).catch(() => {});
  return refresh(db, hubId);
}

// ---------------------------------------------------------------- saving the contract

async function saveContract(db, hubId, values, { by = 'Managira' } = {}) {
  await ensureHubBillingSchema(db);
  const before = await loadBilling(db, hubId);
  const cols = Object.keys(values);
  await db.query(
    `INSERT INTO hub_billing (hub_id, ${cols.join(', ')}) VALUES ($1, ${cols.map((_, i) => `$${i + 2}`).join(', ')})
     ON CONFLICT (hub_id) DO UPDATE SET ${cols.map((c) => `${c} = EXCLUDED.${c}`).join(', ')}, updated_at = NOW()`,
    [hubId, ...cols.map((c) => values[c])]
  );
  const after = await loadBilling(db, hubId);
  if (!after.stripe_subscription_id) await setBilling(db, hubId, { status: hasPrice(after) ? (after.ended_at ? 'canceled' : 'awaiting_card') : 'draft' });
  await logHub(db, hubId, before ? 'BILLING_UPDATED' : 'BILLING_CREATED', before ? 'Billing terms updated' : 'Billing terms set', by);
  return after;
}

// ---------------------------------------------------------------- hourly sweep + webhook

async function runHubBillingSweep(db) {
  await ensureHubBillingSchema(db);
  const summary = { holds: 0, resumed: 0, synced: 0, reminders: 0, errors: 0 };

  // Scheduled holds that start now.
  const starting = (await db.query(
    `SELECT b.hub_id, b.hold_ends_at FROM hub_billing b JOIN managira_hubs h ON h.hub_id = b.hub_id
      WHERE b.hold_starts_at IS NOT NULL AND b.hold_starts_at <= NOW() AND COALESCE(h.deleted, false) = false`
  )).rows;
  for (const r of starting) {
    try { await holdNow(db, r.hub_id, { endsAt: r.hold_ends_at, by: 'Scheduled hold' }); summary.holds += 1; } catch (_e) { summary.errors += 1; }
  }
  // Holds that end now.
  const ending = (await db.query(
    `SELECT b.hub_id FROM hub_billing b JOIN managira_hubs h ON h.hub_id = b.hub_id
      WHERE b.hold_starts_at IS NULL AND b.hold_ends_at IS NOT NULL AND b.hold_ends_at <= NOW() AND h.on_hold = true AND COALESCE(h.deleted, false) = false`
  )).rows;
  for (const r of ending) {
    try { await resumeNow(db, r.hub_id, { by: 'Scheduled hold ended' }); summary.resumed += 1; } catch (_e) { summary.errors += 1; }
  }

  let mode = null;
  try { mode = (await stripeConfig.getStripeSettings(db)).mode; } catch (_e) { return summary; }

  // Keep every live subscription in step (numbers change every day) and read back invoices.
  const live = (await db.query(
    `SELECT b.hub_id FROM hub_billing b JOIN managira_hubs h ON h.hub_id = b.hub_id
      WHERE b.stripe_customer_id IS NOT NULL AND b.stripe_mode = $1 AND b.ended_at IS NULL AND COALESCE(h.deleted, false) = false`,
    [mode]
  )).rows;
  for (const r of live) {
    try { await syncSubscription(db, r.hub_id); } catch (_e) { summary.errors += 1; }
    try { await refresh(db, r.hub_id); summary.synced += 1; } catch (_e) { summary.errors += 1; }
  }

  // Remind hubs that haven't added a card (every 3 days, 3 times).
  const waiting = (await db.query(
    `SELECT b.hub_id FROM hub_billing b JOIN managira_hubs h ON h.hub_id = b.hub_id
      WHERE b.status = 'awaiting_card' AND b.setup_link_sent_at IS NOT NULL AND b.setup_link_sent_at < NOW() - INTERVAL '3 days'
        AND b.setup_reminders < 3 AND b.ended_at IS NULL AND COALESCE(h.deleted, false) = false AND COALESCE(h.on_hold, false) = false`
  )).rows;
  for (const r of waiting) {
    try {
      await sendSetupLink(db, r.hub_id, { by: 'Reminder' });
      await db.query('UPDATE hub_billing SET setup_reminders = setup_reminders + 1 WHERE hub_id = $1', [r.hub_id]);
      summary.reminders += 1;
    } catch (_e) { summary.errors += 1; }
  }
  return summary;
}

// Stripe events for hub customers (sent to the existing Stripe webhook).
// Returns true when the event belonged to a hub, so other handlers skip it.
async function handleStripeEvent(db, event) {
  const type = String((event && event.type) || '');
  if (!/^(checkout\.session\.completed|invoice\.|customer\.subscription\.)/.test(type)) return false;
  const obj = (event.data && event.data.object) || {};
  const customer = typeof obj.customer === 'string' ? obj.customer : obj.customer && obj.customer.id;
  if (!customer) return false;
  await ensureHubBillingSchema(db);
  const row = (await db.query('SELECT hub_id FROM hub_billing WHERE stripe_customer_id = $1', [customer])).rows[0];
  if (!row) return false;
  try {
    if (type === 'checkout.session.completed') {
      if ((obj.metadata || {}).flow === 'hub_billing_setup') await completeCardSession(db, row.hub_id, obj.id);
    } else if (type === 'invoice.upcoming') {
      // A renewal is coming: make sure it uses today's numbers.
      await syncSubscription(db, row.hub_id);
      await refresh(db, row.hub_id);
    } else {
      await refresh(db, row.hub_id);
    }
  } catch (err) {
    console.error('[hubBilling.webhook]', type, err && err.message);
  }
  return true;
}

// ---------------------------------------------------------------- page data

// Bring a hub's billing in step with Stripe without making a page wait for it.
// One refresh per hub at a time; pages show the saved numbers meanwhile.
const refreshing = new Map();
function isStale(billing, maxAgeMs) {
  return !!(billing && billing.stripe_customer_id
    && (!billing.last_synced_at || Date.now() - new Date(billing.last_synced_at).getTime() > maxAgeMs));
}
function refreshInBackground(db, hubId) {
  const key = Number(hubId);
  if (refreshing.has(key)) return refreshing.get(key);
  const job = (async () => {
    const billing = await loadBilling(db, key);
    if (billing && billing.stripe_subscription_id && !billing.ended_at) await syncSubscription(db, key).catch(() => {});
    await refresh(db, key);
  })()
    .catch((err) => console.error('[hubBilling] background refresh', key, err.message))
    .finally(() => refreshing.delete(key));
  refreshing.set(key, job);
  return job;
}

async function overview(db, hubId, { fresh = false } = {}) {
  await ensureHubBillingSchema(db);
  let billing = await loadBilling(db, hubId);
  if (billing && fresh && billing.stripe_customer_id) {
    // Numbers change every day: bring Stripe in step first, then read it back.
    if (billing.stripe_subscription_id && !billing.ended_at) await syncSubscription(db, hubId).catch(() => {});
    billing = (await refresh(db, hubId).catch(() => null)) || billing;
  }
  const hub = await loadHub(db, hubId);
  const [usage, charges, allCharges, invoices] = await Promise.all([
    loadUsage(db, hubId),
    loadCharges(db, hubId),
    loadCharges(db, hubId, { all: true }),
    db.query('SELECT * FROM hub_billing_invoices WHERE hub_id = $1 ORDER BY issued_at DESC NULLS LAST LIMIT 24', [hubId]).then((r) => r.rows),
  ]);
  const bill = computeBill(billing, usage, charges);
  let mode = null;
  try { mode = (await stripeConfig.getStripeSettings(db)).mode; } catch (_e) { /* not connected */ }
  const status = !billing ? 'none' : billing.status;
  // Manual integration fees: schools using it without a charge yet, and charges
  // for a school that has since switched it off.
  const fees = integrationFeesOf(billing);
  const open = allCharges.filter((c) => ['pending', 'approved'].includes(c.status) && c.integration_key);
  const manualToAdd = [];
  usage.breakdown.filter((x) => x.counted).forEach((school) => {
    school.integrations.forEach((key) => {
      const f = fees[key];
      if (!f || !f.on || f.mode !== 'manual') return;
      if (open.some((c) => c.integration_key === key && Number(c.organization_id) === Number(school.organization_id))) return;
      manualToAdd.push({ key, label: INTEGRATION_BY_KEY[key].label, price: Number(f.price), organization_id: school.organization_id, organization_name: school.organization_name });
    });
  });
  const unused = new Set(open.filter((c) => {
    const school = usage.breakdown.find((x) => Number(x.organization_id) === Number(c.organization_id));
    return !school || !school.integrations.includes(c.integration_key);
  }).map((c) => c.charge_id));
  return {
    manualToAdd,
    unusedCharges: unused,
    hub,
    billing,
    usage,
    charges: allCharges,
    pending: charges.filter((c) => c.status === 'pending'),
    approved: charges.filter((c) => c.status === 'approved'),
    // Every bill the hub has had; ones from Stripe test mode are marked.
    invoices: invoices.map((i) => ({ ...i, isTest: i.stripe_mode === 'test' && mode !== 'test' })),
    bill,
    status,
    statusInfo: STATUS[status] || STATUS.none,
    firstCharge: billing ? firstChargeAt(billing, hub) : null,
    discount: discountLabel(billing),
    schools: await capacity(db, hubId, 'school'),
    seats: await capacity(db, hubId, 'user'),
    stripeMode: mode,
    hasCard: !!(billing && billing.card_last4 && billing.stripe_mode === mode),
    live: billingLive(billing),
  };
}

// A hub bill as a PDF, in the same layout as school invoices, listing the
// schools it covers.
async function invoicePdf(db, hubId, invoiceId) {
  await ensureHubBillingSchema(db);
  const inv = (await db.query('SELECT * FROM hub_billing_invoices WHERE stripe_invoice_id = $1 AND hub_id = $2', [invoiceId, hubId])).rows[0];
  if (!inv) return null;
  const [hub, billing] = await Promise.all([loadHub(db, hubId), loadBilling(db, hubId)]);
  const cycle = CYCLES[billing && billing.billing_cycle] || CYCLES.month;
  let schools = inv.schools;
  let note = 'Schools as counted when this bill was made.';
  if (!schools) {
    schools = (await loadUsage(db, hubId)).breakdown.map((x) => ({ name: x.organization_name, counted: x.counted, students: x.billedStudents, employees: x.billedEmployees, users: x.billedUsers, integrations: x.integrations }));
    note = 'Schools as counted today.';
  }
  const lines = Array.isArray(inv.lines) && inv.lines.length
    ? inv.lines
    : [{ description: 'Managira hub plan', qty: 1, unitAmount: Number(inv.amount_due), amount: Number(inv.amount_due) }];
  const { renderInvoicePdf } = require('./invoicePdf');
  const total = inv.total != null ? Number(inv.total) : Number(inv.status === 'paid' ? inv.amount_paid : inv.amount_due);
  const pdf = await renderInvoicePdf({
    reference: inv.number || inv.stripe_invoice_id,
    status: inv.status,
    issuedAt: inv.issued_at,
    dueAt: inv.paid_at || inv.issued_at,
    dueLabel: inv.status === 'paid' ? 'Charged' : 'Due',
    paidAt: inv.paid_at,
    periodLabel: cycle.label,
    periodDates: inv.period_start ? `${fmtDate(inv.period_start)} – ${fmtDate(inv.period_end)}` : '',
    accountName: hub ? hub.hub_name : 'Hub',
    accountContact: [hub && hub.hub_email, billing && billing.billing_email].filter(Boolean).join(' · '),
    supportEmail: 'support@managira.com',
    currency: inv.currency || 'usd',
    lines,
    discount: Number(inv.discount || 0),
    total,
    timeline: false,
    table: {
      title: `Schools in this bill (${schools.filter((x) => x.counted !== false).length})`,
      columns: [
        { label: 'School', width: 170 },
        { label: 'Students', width: 58, align: 'right' },
        { label: 'Employees', width: 66, align: 'right' },
        { label: 'Users', width: 50, align: 'right' },
        { label: 'Integrations', width: 140 },
      ],
      rows: schools.map((x) => [
        `${x.name}${x.counted === false ? ' (on hold, not billed)' : ''}`,
        Number(x.students || 0).toLocaleString('en-US'),
        Number(x.employees || 0).toLocaleString('en-US'),
        Number(x.users || 0).toLocaleString('en-US'),
        (x.integrations || []).map((k) => (INTEGRATION_BY_KEY[k] ? INTEGRATION_BY_KEY[k].label : k)).join(', ') || '-',
      ]),
      note,
    },
  });
  return { pdf, filename: `Managira-hub-invoice-${String(inv.number || inv.stripe_invoice_id).replace(/[^A-Za-z0-9-]/g, '')}.pdf` };
}

async function listAddons(db, { activeOnly = false } = {}) {
  await ensureHubBillingSchema(db);
  return (await db.query(`SELECT * FROM hub_billing_addons ${activeOnly ? 'WHERE is_active = true' : ''} ORDER BY is_active DESC, name`)).rows;
}

module.exports = {
  CYCLES,
  METERS,
  METER_KEYS,
  INTEGRATIONS,
  INTEGRATION_BY_KEY,
  metersOf,
  integrationFeesOf,
  STATUS,
  DISCOUNT_DURATIONS,
  CHARGE_KINDS,
  BillingError,
  money,
  fmtDate,
  methodLabel,
  dayAtNoon,
  isoDay,
  round2,
  ensureHubBillingSchema,
  parseContractForm,
  parseMoney,
  computeBill,
  discountLabel,
  contractLabel,
  firstChargeAt,
  cancelAtFor,
  couponSpec,
  wholeMonthsBetween,
  hasPrice,
  billingLive,
  loadBilling,
  loadUsage,
  loadCharges,
  capacity,
  saveContract,
  setupLink,
  hubIdForSetupToken,
  sendSetupLink,
  createCardSession,
  completeCardSession,
  saveCard,
  syncSubscription,
  refresh,
  isStale,
  refreshInBackground,
  recordInvoice,
  requestCharge,
  addCharge,
  decideCharge,
  removeCharge,
  chargeSummary,
  approveExtra,
  holdNow,
  scheduleHold,
  resumeNow,
  cancelScheduledHold,
  endBilling,
  restartBilling,
  cancelForDeletedHub,
  runHubBillingSweep,
  handleStripeEvent,
  overview,
  listAddons,
  invoicePdf,
  emailBilling,
  planDetails,
};
