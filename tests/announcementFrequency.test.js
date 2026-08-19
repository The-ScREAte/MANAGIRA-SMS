const test = require('node:test');
const assert = require('node:assert/strict');

const { isFrequencyExhausted, VALID_FREQUENCIES } = require('../utils/announcementFrequency');

test('once: eligible with no receipt, exhausted after any view', () => {
  assert.equal(isFrequencyExhausted({ frequency: 'once' }, null), false);
  assert.equal(isFrequencyExhausted({ frequency: 'once' }, { view_count: 0 }), false);
  assert.equal(isFrequencyExhausted({ frequency: 'once' }, { view_count: 1 }), true);
  assert.equal(isFrequencyExhausted({ frequency: 'once' }, { view_count: 5 }), true);
});

test('every_login and once_per_session are never receipt-exhausted', () => {
  const receipt = { view_count: 999, dismissed_at: new Date() };
  assert.equal(isFrequencyExhausted({ frequency: 'every_login' }, receipt), false);
  assert.equal(isFrequencyExhausted({ frequency: 'once_per_session' }, receipt), false);
  assert.equal(isFrequencyExhausted({ frequency: 'every_login' }, null), false);
});

test('daily: exhausted only if last_seen_at falls on the same calendar day', () => {
  const now = new Date(2026, 5, 24, 10, 0, 0);
  const today = new Date(2026, 5, 24, 2, 0, 0);
  const yesterday = new Date(2026, 5, 23, 23, 59, 0);

  assert.equal(isFrequencyExhausted({ frequency: 'daily' }, { last_seen_at: today }, now), true);
  assert.equal(isFrequencyExhausted({ frequency: 'daily' }, { last_seen_at: yesterday }, now), false);
  assert.equal(isFrequencyExhausted({ frequency: 'daily' }, null, now), false);
});

test('n_times: exhausted once view_count reaches max_views', () => {
  assert.equal(isFrequencyExhausted({ frequency: 'n_times', max_views: 3 }, { view_count: 2 }), false);
  assert.equal(isFrequencyExhausted({ frequency: 'n_times', max_views: 3 }, { view_count: 3 }), true);
  assert.equal(isFrequencyExhausted({ frequency: 'n_times', max_views: 3 }, { view_count: 4 }), true);
  assert.equal(isFrequencyExhausted({ frequency: 'n_times', max_views: 3 }, null), false);
});

test('until_dismissed: exhausted once dismissed_at is set', () => {
  assert.equal(isFrequencyExhausted({ frequency: 'until_dismissed' }, { dismissed_at: null }), false);
  assert.equal(isFrequencyExhausted({ frequency: 'until_dismissed' }, { dismissed_at: new Date() }), true);
  assert.equal(isFrequencyExhausted({ frequency: 'until_dismissed' }, null), false);
});

test('until_date: exhausted once now passes ends_at', () => {
  const ends_at = new Date(2026, 5, 24, 12, 0, 0);
  const before = new Date(2026, 5, 24, 11, 0, 0);
  const after = new Date(2026, 5, 24, 13, 0, 0);
  assert.equal(isFrequencyExhausted({ frequency: 'until_date', ends_at }, null, before), false);
  assert.equal(isFrequencyExhausted({ frequency: 'until_date', ends_at }, null, after), true);
  assert.equal(isFrequencyExhausted({ frequency: 'until_date', ends_at: null }, null, after), false);
});

test('unknown frequency throws rather than silently allowing/blocking', () => {
  assert.throws(() => isFrequencyExhausted({ frequency: 'whenever' }, null), /Unknown announcement frequency/);
});

test('VALID_FREQUENCIES matches the documented set', () => {
  const expected = ['once', 'once_per_session', 'every_login', 'daily', 'n_times', 'until_dismissed', 'until_date'];
  assert.deepEqual([...VALID_FREQUENCIES].sort(), expected.sort());
});
