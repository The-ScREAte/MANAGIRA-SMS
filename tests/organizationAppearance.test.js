const test = require('node:test');
const assert = require('node:assert/strict');
const { normalizeAppearance, htmlAppearance, appearanceOwner, saveAppearance, loadAppearance } = require('../utils/organizationAppearance');

test('everyone starts on Light until they pick Classic or Dark', () => {
  assert.equal(normalizeAppearance(undefined), 'light');
  assert.equal(normalizeAppearance('warm'), 'light');
  assert.equal(normalizeAppearance('white'), 'light');
  // Older saves of 'gray' were the previous light look.
  assert.equal(normalizeAppearance('gray'), 'light');
  assert.equal(normalizeAppearance('classic'), 'classic');
  assert.equal(normalizeAppearance('dark'), 'dark');
});

test('each look draws the page with its own data-appearance', () => {
  assert.equal(htmlAppearance('light'), 'white');
  assert.equal(htmlAppearance('classic'), 'gray');
  assert.equal(htmlAppearance('dark'), 'dark');
  assert.equal(htmlAppearance(undefined), 'white');
});

test('the choice belongs to the signed-in person, not the school', () => {
  assert.deepEqual(appearanceOwner({ userId: 90, organizationId: 63 }), ['user', 90]);
  assert.deepEqual(appearanceOwner({ organizationId: 63, accountType: 'Organization' }), ['org', 63]);
  assert.deepEqual(appearanceOwner({ guardianId: 7, organizationId: 63 }), ['guardian', 7]);
  assert.deepEqual(appearanceOwner({ studentId: 12, organizationId: 63 }), ['student', 12]);
  assert.deepEqual(appearanceOwner({ hubId: 2 }), ['hub', 2]);
  assert.deepEqual(appearanceOwner({ hubId: 2, hubUserId: 5 }), ['hubuser', 5]);
  // Staff sign-ins that keep the id on session.user only (no session.userId).
  assert.deepEqual(appearanceOwner({ organizationId: 63, accountType: 'Manager', userRole: 'Manager', user: { user_id: 93 } }), ['user', 93]);
  assert.deepEqual(appearanceOwner({ organizationId: 63, accountType: 'Organization', user: { user_id: 63 } }), ['org', 63]);
  assert.deepEqual(appearanceOwner({ organizationId: 63, guardianId: 2, user: { user_id: null } }), ['guardian', 2]);
  assert.equal(appearanceOwner({ organizationId: 63, user: { user_id: null } }), null);
  assert.equal(appearanceOwner({ organizationId: 63 }), null);
  assert.equal(appearanceOwner(null), null);
});

test('saving stores one row per person and reading it back returns that mode', async () => {
  const rows = new Map();
  const db = {
    query: async (sql, values) => {
      if (/INSERT INTO account_appearance/.test(sql)) rows.set(`${values[0]}:${values[1]}`, values[2]);
      if (/SELECT mode FROM account_appearance/.test(sql)) {
        const mode = rows.get(`${values[0]}:${values[1]}`);
        return { rows: mode ? [{ mode }] : [] };
      }
      return { rows: [] };
    },
  };
  assert.equal(await saveAppearance(db, { userId: 5 }, 'dark'), 'dark');
  assert.equal(await loadAppearance(db, { userId: 5 }), 'dark');
  assert.equal(await saveAppearance(db, { userId: 7 }, 'classic'), 'classic');
  assert.equal(await loadAppearance(db, { userId: 7 }), 'classic');
  // Light is stored as 'white'.
  assert.equal(await saveAppearance(db, { userId: 8 }, 'light'), 'light');
  assert.equal(rows.get('user:8'), 'white');
  assert.equal(await loadAppearance(db, { userId: 8 }), 'light');
  // Nothing saved yet: Light.
  assert.equal(await loadAppearance(db, { userId: 6 }), 'light');
});

test('an unknown mode or a signed-out session is never saved', async () => {
  const db = { query: () => assert.fail('must not save') };
  await assert.rejects(saveAppearance(db, { userId: 5 }, 'warm'));
  await assert.rejects(saveAppearance(db, { userId: 5 }, 'gray'));
  await assert.rejects(saveAppearance(db, {}, 'dark'));
});
