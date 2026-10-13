const test = require('node:test');
const assert = require('node:assert/strict');
const { normalizeAppearance, saveAppearance } = require('../utils/organizationAppearance');
const { contrastInk, luminance } = require('../public/js/orgAppearance');

test('all schools default to white until a valid appearance is selected', () => {
  assert.equal(normalizeAppearance(undefined), 'white');
  assert.equal(normalizeAppearance('brown'), 'white');
});
test('white, lighter brown and dark are the three persisted choices', async () => {
  const updates = [];
  const db = { query: async (sql, values) => { if (values) updates.push(values); } };
  for (const mode of ['white', 'warm', 'dark']) {
    assert.equal(await saveAppearance(db, 42, mode), mode);
  }
  assert.deepEqual(updates, [['white',42], ['warm',42], ['dark',42]]);
});
test('invalid appearance cannot change the organization setting', async () => {
  await assert.rejects(saveAppearance({query: () => assert.fail('must not save')}, 42, 'invalid'));
});
test('brand areas always choose ink with at least WCAG AA contrast', () => {
  for (const color of [[234,88,12], [234,179,8], [1,83,91], [37,99,235], [220,38,38], [255,255,255], [24,24,27]]) {
    const ink = contrastInk(color);
    const l = luminance(color);
    const ratio = ink === 'black' ? (l+.05)/.05 : 1.05/(l+.05);
    assert.ok(ratio >= 4.5, `${color} has insufficient contrast`);
  }
});