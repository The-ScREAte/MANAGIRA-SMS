"use strict";

// Cancelling a single school's subscription. Only Managira's admins do this (Admin ›
// Organizations, each school's ⋯ menu; Admin › Subscription Cancellation lists what's pending):
// a school asks support, and nobody at the school can end it from Settings.
//
// - The school keeps its access until the end of the period it paid for (`scheduled_hold_date`,
//   applied by utils/applyScheduledHolds.js). A school on its free trial, or with no paid period
//   left, goes on hold now.
// - Saved cards are switched off and payments marked cancelled, so nothing more is charged.
// - Undoing it lifts the hold and switches billing back on.
// - A school in a hub is billed by its hub: end the hub's billing instead.
const { sendEmailInBackground, renderCleanEmail, escapeHtml } = require("./emailHelper");
const { logOrganizationActivity } = require("./activityLog");

const CANCELLED = "Cancelled";
// Holds that came from a cancellation (older ones were made by the school itself as "User").
const CANCELLED_HOLDS = [CANCELLED, "User"];

const dayOf = (value) => new Date(value).toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric", timeZone: "UTC" });

// What the admin menu offers for one school row.
function stateOf(org) {
  if (!org || org.deleted) return { canCancel: false, canUndo: false };
  const inHub = Boolean(org.hub_id && org.is_hub_member);
  const pending = Boolean(org.scheduled_hold_date) && !org.on_hold;
  const heldByCancel = Boolean(org.on_hold) && CANCELLED_HOLDS.includes(org.hold_by);
  return {
    inHub,
    pending,
    endsOn: pending ? org.scheduled_hold_date : null,
    canCancel: !inHub && !org.on_hold && !org.scheduled_hold_date,
    canUndo: !inHub && (pending || heldByCancel),
  };
}

function tell(org, subject, paragraphs) {
  if (!org.email) return;
  const first = String(org.first_name || "").trim().split(/\s+/)[0];
  const html = renderCleanEmail({
    title: subject,
    greeting: first ? `Hi ${escapeHtml(first)},` : "Hello,",
    paragraphs,
    note: 'Questions? Reply to this email or write to <a href="mailto:support@managira.com">support@managira.com</a>.',
    organizationId: org.organization_id,
  });
  sendEmailInBackground({ to: org.email, subject, html }, "Subscription cancellation");
}

function record(org, actor, description) {
  logOrganizationActivity({
    organizationId: org.organization_id,
    userId: null,
    userName: actor || "Managira",
    userRole: "Managira",
    actionType: "Updated",
    moduleName: "Billing",
    pagePath: "/admin/hubs",
    recordType: "Subscription",
    recordLabel: org.organization_name,
    description,
  }).catch(() => {});
}

async function cancel(db, organizationId, { actor } = {}) {
  const client = await db.connect();
  let result;
  try {
    await client.query("BEGIN");
    const { rows } = await client.query(
      `SELECT organization_id, organization_name, email, first_name, trial_active_until, on_hold, hold_by,
              scheduled_hold_date, hub_id, is_hub_member, deleted
         FROM organizations WHERE organization_id = $1 FOR UPDATE`,
      [organizationId]
    );
    const org = rows[0];
    const state = stateOf(org);
    if (!org || org.deleted) result = { error: "This school no longer exists." };
    else if (state.inHub) result = { error: `${org.organization_name} is billed through its hub. End the hub's billing instead.` };
    else if (org.scheduled_hold_date && !org.on_hold) result = { error: `${org.organization_name}'s subscription is already cancelled. It ends on ${dayOf(org.scheduled_hold_date)}.` };
    else if (org.on_hold) result = { error: `${org.organization_name} is on hold already.` };
    if (result) {
      await client.query("ROLLBACK");
      return result;
    }

    const now = new Date();
    const onTrial = Boolean(org.trial_active_until && new Date(org.trial_active_until) > now);
    const paid = await client.query(
      "SELECT next_payment_end_date FROM payments WHERE organization_id = $1 ORDER BY created_at DESC LIMIT 1",
      [organizationId]
    );
    const paidUntil = !onTrial && paid.rows[0] && paid.rows[0].next_payment_end_date ? new Date(paid.rows[0].next_payment_end_date) : null;
    const endsNow = !paidUntil || paidUntil <= now;

    if (endsNow) {
      await client.query(
        `UPDATE organizations
            SET on_hold = true, hold_by = $2, on_hold_at = NOW(), scheduled_hold_date = NULL, hold_reminder_count = 0
                ${onTrial ? ", trial_active_until = NULL" : ""}
          WHERE organization_id = $1`,
        [organizationId, CANCELLED]
      );
    } else {
      await client.query("UPDATE organizations SET scheduled_hold_date = $2, hold_by = $3 WHERE organization_id = $1", [organizationId, paidUntil, CANCELLED]);
    }
    await client.query("UPDATE stored_cards SET is_active = false WHERE organization_id = $1", [organizationId]);
    await client.query("UPDATE payments SET status = 'cancelled' WHERE organization_id = $1", [organizationId]);
    await client.query("COMMIT");

    const endsOn = endsNow ? now : paidUntil;
    record(org, actor, endsNow
      ? "Managira cancelled the subscription. The school is on hold from today."
      : `Managira cancelled the subscription. The school keeps its access until ${dayOf(endsOn)}.`);
    const name = escapeHtml(org.organization_name);
    tell(org, "Your Managira subscription is canceled", endsNow
      ? [`As you asked, the subscription for <strong>${name}</strong> is canceled, and the school's account is now on hold. Nothing more will be charged.`,
        "Your school's records are kept. If you'd like to come back, or need a copy of your records, contact Managira support."]
      : [`As you asked, the subscription for <strong>${name}</strong> is canceled. Your school keeps full access until <strong>${escapeHtml(dayOf(endsOn))}</strong>, the end of the period you paid for. Nothing more will be charged.`,
        "Changed your mind? Contact Managira support before that date and we'll keep your subscription going."]);
    return { org, endsOn, endsNow };
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {});
    throw error;
  } finally {
    client.release();
  }
}

async function undo(db, organizationId, { actor } = {}) {
  const client = await db.connect();
  try {
    await client.query("BEGIN");
    const { rows } = await client.query(
      `SELECT organization_id, organization_name, email, first_name, on_hold, hold_by, scheduled_hold_date, hub_id, is_hub_member, deleted
         FROM organizations WHERE organization_id = $1 FOR UPDATE`,
      [organizationId]
    );
    const org = rows[0];
    const state = stateOf(org);
    if (!org || org.deleted || !state.canUndo) {
      await client.query("ROLLBACK");
      return { error: !org || org.deleted ? "This school no longer exists." : `${org.organization_name} has no cancellation to undo.` };
    }
    await client.query(
      `UPDATE organizations
          SET scheduled_hold_date = NULL, hold_by = NULL, on_hold = false, on_hold_at = NULL, hold_reminder_count = 0
        WHERE organization_id = $1`,
      [organizationId]
    );
    await client.query("UPDATE stored_cards SET is_active = true WHERE organization_id = $1", [organizationId]);
    await client.query("UPDATE payments SET status = 'active' WHERE organization_id = $1 AND status = 'cancelled'", [organizationId]);
    await client.query("COMMIT");
    record(org, actor, "Managira undid the cancellation. The subscription continues.");
    tell(org, "Your Managira subscription continues", [
      `The cancellation for <strong>${escapeHtml(org.organization_name)}</strong> is undone, and your subscription continues as before.`,
      "Billing goes on as usual with your saved payment method.",
    ]);
    return { org };
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {});
    throw error;
  } finally {
    client.release();
  }
}

module.exports = { cancel, undo, stateOf, CANCELLED, CANCELLED_HOLDS };
