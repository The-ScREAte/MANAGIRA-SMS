const test = require('node:test');
const assert = require('node:assert/strict');

const {
  computeNextRunAt,
  computeNextRunAfterSend,
} = require('../utils/adminEmailCampaigns');

function withMinuteOffset(date, minutesToAdd) {
  const next = new Date(date);
  next.setSeconds(0, 0);
  next.setMinutes(next.getMinutes() + minutesToAdd);
  return next;
}

test('legacy every_3_minutes maps to 5-minute schedule', () => {
  const from = new Date(2026, 5, 24, 16, 32, 1, 80);
  const next = computeNextRunAt(
    {
      frequency: 'every_3_minutes',
      sendTime: '09:00',
      startDate: '2026-06-24',
      endDate: null,
    },
    from,
    { allowImmediateCatchUp: true }
  );

  assert.ok(next instanceof Date);
  assert.equal(next.getTime(), withMinuteOffset(from, 5).getTime());
});

test('every_5_minutes schedules from now minute + 5', () => {
  const from = new Date(2026, 5, 24, 16, 45, 5, 0);
  const next = computeNextRunAt(
    {
      frequency: 'every_5_minutes',
      sendTime: '09:00',
      startDate: '2026-06-24',
      endDate: null,
    },
    from,
    { allowImmediateCatchUp: true }
  );

  assert.ok(next instanceof Date);
  assert.equal(next.getTime(), withMinuteOffset(from, 5).getTime());
});

test('every_5_minutes after send advances exactly 5 minutes', () => {
  const sentAt = new Date(2026, 5, 24, 16, 45, 5, 0);
  const next = computeNextRunAfterSend(
    {
      frequency: 'every_5_minutes',
      sendTime: '09:00',
      startDate: '2026-06-24',
      endDate: null,
    },
    sentAt
  );

  assert.ok(next instanceof Date);
  assert.equal(next.getTime(), withMinuteOffset(sentAt, 5).getTime());
});

test('daily schedules next day when today time has passed', () => {
  const from = new Date(2026, 5, 24, 9, 2, 0, 0);
  const next = computeNextRunAt(
    {
      frequency: 'daily',
      sendTime: '09:00',
      startDate: '2026-06-24',
      endDate: null,
    },
    from,
    { allowImmediateCatchUp: false }
  );

  assert.ok(next instanceof Date);
  assert.equal(next.getFullYear(), 2026);
  assert.equal(next.getMonth(), 5);
  assert.equal(next.getDate(), 25);
  assert.equal(next.getHours(), 9);
  assert.equal(next.getMinutes(), 0);
});

test('weekly schedules to requested weekday', () => {
  const from = new Date(2026, 5, 24, 10, 16, 0, 0); // Wednesday
  const next = computeNextRunAt(
    {
      frequency: 'weekly',
      sendTime: '10:15',
      dayOfWeek: 2, // Tuesday
      startDate: '2026-06-24',
      endDate: null,
    },
    from,
    { allowImmediateCatchUp: false }
  );

  assert.ok(next instanceof Date);
  assert.equal(next.getDay(), 2);
  assert.equal(next.getHours(), 10);
  assert.equal(next.getMinutes(), 15);
  assert.ok(next.getTime() > from.getTime());
});

test('monthly handles day 31 using month max day', () => {
  const from = new Date(2026, 3, 30, 8, 30, 0, 0); // Apr 30
  const next = computeNextRunAt(
    {
      frequency: 'monthly',
      sendTime: '08:00',
      dayOfMonth: 31,
      startDate: '2026-01-01',
      endDate: null,
    },
    from,
    { allowImmediateCatchUp: false }
  );

  assert.ok(next instanceof Date);
  assert.equal(next.getFullYear(), 2026);
  assert.equal(next.getMonth(), 4); // May
  assert.equal(next.getDate(), 31);
  assert.equal(next.getHours(), 8);
  assert.equal(next.getMinutes(), 0);
});

test('once deactivates after send', () => {
  const next = computeNextRunAfterSend(
    {
      frequency: 'once',
      sendTime: '09:00',
      startDate: '2026-06-24',
      endDate: null,
    },
    new Date(2026, 5, 24, 9, 1, 0, 0)
  );

  assert.equal(next, null);
});
