"use strict";

// Tenant configuration: a school's sign-in rules.
const test = require("node:test");
const assert = require("node:assert");
const tenant = require("../utils/tenantSettings");

const HOUR = 3600e3;
const DAY = 24 * HOUR;

function fakeDb(row, { missing = false } = {}) {
  const calls = [];
  return {
    calls,
    query: async (sql, args) => {
      calls.push({ sql, args });
      if (/^SELECT/.test(sql)) {
        if (missing) throw Object.assign(new Error("no table"), { code: "42P01" });
        return { rows: row ? [row] : [] };
      }
      return { rows: [] };
    },
  };
}

test("a school that never chose anything signs out after 24 hours", async () => {
  const settings = await tenant.settingsFor(fakeDb(null), 9001);
  assert.strictEqual(settings.session_hours, 24);
  assert.strictEqual(tenant.sessionLimitMs(settings, false), 24 * HOUR);
  assert.strictEqual(tenant.sessionLimitMs(settings, true), 30 * DAY);
});

test("before the table exists, the defaults apply and nothing breaks", async () => {
  const settings = await tenant.settingsFor(fakeDb(null, { missing: true }), 9002);
  assert.deepStrictEqual(settings, { ...tenant.DEFAULTS });
});

test("a school's own choices are used, and read once for many requests", async () => {
  const db = fakeDb({ organization_id: 9003, session_hours: 8, keep_signed_in_allowed: false, keep_signed_in_days: 7 });
  const [a, b] = await Promise.all([tenant.settingsFor(db, 9003), tenant.settingsFor(db, 9003)]);
  assert.strictEqual(a.session_hours, 8);
  assert.strictEqual(b.session_hours, 8);
  assert.strictEqual(db.calls.length, 1);
  // Keep me logged in turned off: a kept sign-in falls back to the session timeout.
  assert.strictEqual(tenant.sessionLimitMs(a, true), 8 * HOUR);
});

test("only the choices shown are saved", async () => {
  for (const body of [{ session_hours: 5 }, { keep_signed_in_days: 9999 }, { remember_device_days: "30; DROP TABLE x" }]) {
    await assert.rejects(tenant.saveSettings(fakeDb(null), 9004, body, "M"), tenant.TenantSettingsError);
  }
  const db = fakeDb(null);
  const { before, after } = await tenant.saveSettings(db, 9005, { session_hours: "72", login_code_required: false, remember_device_allowed: "on" }, "M");
  assert.strictEqual(before.session_hours, 24);
  assert.strictEqual(after.session_hours, 72);
  assert.strictEqual(after.login_code_required, false);
  assert.strictEqual(after.remember_device_allowed, true);
  assert.ok(db.calls.some((c) => /INSERT INTO tenant_settings/.test(c.sql)));
});

test("no school id means the defaults, with no database read", async () => {
  const db = fakeDb(null);
  assert.deepStrictEqual(await tenant.settingsFor(db, null), { ...tenant.DEFAULTS });
  assert.strictEqual(db.calls.length, 0);
});
