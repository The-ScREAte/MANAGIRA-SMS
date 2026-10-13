const test = require('node:test');
const assert = require('node:assert/strict');
const { normalizeAppearance, appearanceOwner, saveAppearance, loadAppearance } = require('../utils/organizationAppearance');

test('everyone starts on white until they pick gray or dark', () => {
  assert.equal(normalizeAppearance(undefined), 'white');
  assert.equal(normalizeAppearance('warm'), 'white');
  assert.equal(normalizeAppearance('gray'), 'gray');
  assert.equal(normalizeAppearance('dark'), 'dark');
});

test('the choice belongs to the signed-in person, not the school', () => {
  assert.deepEqual(appearanceOwner({ userId: 90, organizationId: 63 }), ['user', 90]);
  assert.deepEqual(appearanceOwner({ organizationId: 63, accountType: 'Organization' }), ['org', 63]);
  assert.deepEqual(appearanceOwner({ guardianId: 7, organizationId: 63 }), ['guardian', 7]);
  assert.deepEqual(appearanceOwner({ studentId: 12, organizationId: 63 }), ['student', 12]);
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
  assert.equal(await loadAppearance(db, { userId: 6 }), 'white');
});

test('an unknown mode or a signed-out session is never saved', async () => {
  const db = { query: () => assert.fail('must not save') };
  await assert.rejects(saveAppearance(db, { userId: 5 }, 'warm'));
  await assert.rejects(saveAppearance(db, {}, 'dark'));
});
