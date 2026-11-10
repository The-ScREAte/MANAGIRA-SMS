const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');

// A stand-in permission check: each test says which permissions the person holds.
const permissionPath = path.join(__dirname, '..', 'middleware', 'permissionMiddleware.js');
let holds = new Set();
require.cache[permissionPath] = {
  id: permissionPath,
  filename: permissionPath,
  loaded: true,
  exports: {
    PERMISSIONS: new Proxy({}, { get: (_target, key) => String(key).toLowerCase() }),
    userHasPermission: async (_db, _who, permission) => holds.has(permission),
  },
};
const { broadcastAudience, forgetAudience, ASSESSMENT_TYPES, CLASS_WORK_TYPES } = require('../utils/notificationAudience');

const db = { query: async () => ({ rows: [] }) };
const audienceFor = (userId, userRole, held = []) => {
  holds = new Set(held);
  forgetAudience(9, userId);
  return broadcastAudience(db, { orgId: 9, recipientId: userId, who: { userId, userRole, accountType: userRole } });
};

test('a driver hears no school notices and none of a class work', async () => {
  const audience = await audienceFor(11, 'Driver', ['manage_assessments']);
  assert.equal(audience.school, false);
  assert.equal(audience.managers, false);
  assert.deepEqual(audience.titles, []);
  assert.deepEqual(audience.hide, CLASS_WORK_TYPES);
  assert.ok(CLASS_WORK_TYPES.includes('enrollment_added') && CLASS_WORK_TYPES.includes('document_shared_class'));
});

test('assessment notices show only to staff with Manage Assessments', async () => {
  assert.deepEqual((await audienceFor(12, 'Teacher', [])).hide, ASSESSMENT_TYPES);
  assert.deepEqual((await audienceFor(13, 'Teacher', ['manage_assessments'])).hide, []);
});

test('the school account sees everything; parents and students get no staff broadcasts', async () => {
  assert.deepEqual((await broadcastAudience(db, { orgId: 9, recipientId: 0 })).hide, []);
  for (const role of ['Guardian', 'Student']) {
    const audience = await audienceFor(14, role);
    assert.equal(audience.school, false);
    assert.deepEqual(audience.titles, []);
  }
});
