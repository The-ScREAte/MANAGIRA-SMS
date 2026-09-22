// utils/payoutSchedule.js
// Scheduling math for the Payouts feature. Deliberately day-granularity only
// (no time-of-day) — payroll-style payments don't need minute precision, and
// keeping it simple keeps the create-payout form simple.

const ALLOWED_FREQUENCIES = new Set(['once', 'weekly', 'biweekly', 'monthly']);
const DAY_MS = 24 * 60 * 60 * 1000;

function normalizeFrequency(value) {
  const frequency = String(value || 'once').trim().toLowerCase();
  if (!ALLOWED_FREQUENCIES.has(frequency)) {
    throw new Error('Invalid payout frequency.');
  }
  return frequency;
}

function formatDateOnly(date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function parseDateOnly(value, fieldName = 'Date') {
  if (value instanceof Date) return new Date(value.getFullYear(), value.getMonth(), value.getDate());
  const raw = String(value || '').trim();
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(raw);
  if (!match) throw new Error(`${fieldName} is invalid.`);
  const date = new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
  if (Number.isNaN(date.getTime())) throw new Error(`${fieldName} is invalid.`);
  return date;
}

function startOfDay(date) {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

// Add `months` to a date, clamping to the last day of the target month when
// the original day-of-month doesn't exist there (e.g. Jan 31 + 1mo -> Feb 28/29).
function addMonthsClamped(date, months) {
  const targetMonthIndex = date.getMonth() + months;
  const targetYear = date.getFullYear() + Math.floor(targetMonthIndex / 12);
  const normalizedMonth = ((targetMonthIndex % 12) + 12) % 12;
  const daysInTargetMonth = new Date(targetYear, normalizedMonth + 1, 0).getDate();
  const day = Math.min(date.getDate(), daysInTargetMonth);
  return new Date(targetYear, normalizedMonth, day);
}

/**
 * Compute the first run for a newly created payout.
 * `schedule.startDate` is a 'YYYY-MM-DD' string or Date.
 * Returns a Date (day-granularity, local midnight) or null if the schedule
 * has already fully elapsed (e.g. a 'once' payout dated in the past that the
 * caller does not want to auto-catch-up).
 */
function computeInitialRunAt(schedule, { allowPastCatchUp = true } = {}) {
  const frequency = normalizeFrequency(schedule.frequency);
  const startDate = startOfDay(parseDateOnly(schedule.startDate, 'Start date'));
  const today = startOfDay(new Date());

  if (startDate >= today) return startDate;
  // Start date is in the past.
  if (frequency === 'once') {
    return allowPastCatchUp ? startDate : null;
  }
  // For recurring schedules, roll forward from startDate to the next
  // occurrence that is today or later, so a payout created mid-cycle doesn't
  // immediately fire a backlog of missed runs.
  let cursor = startDate;
  let guard = 0;
  while (cursor < today && guard < 1000) {
    cursor = computeNextRunAfterExecution({ frequency, startDate: formatDateOnly(startDate) }, cursor);
    guard += 1;
  }
  return cursor;
}

/**
 * Compute the next run date after a given occurrence executed (or was
 * skipped). Returns null for a 'once' schedule (it never repeats) or for a
 * recurring schedule whose endDate has passed.
 */
function computeNextRunAfterExecution(schedule, fromDate) {
  const frequency = normalizeFrequency(schedule.frequency);
  if (frequency === 'once') return null;

  const from = startOfDay(fromDate instanceof Date ? fromDate : parseDateOnly(fromDate));
  let next;
  if (frequency === 'weekly') {
    next = new Date(from.getTime() + 7 * DAY_MS);
  } else if (frequency === 'biweekly') {
    next = new Date(from.getTime() + 14 * DAY_MS);
  } else if (frequency === 'monthly') {
    next = addMonthsClamped(from, 1);
  }

  if (schedule.endDate) {
    const end = startOfDay(parseDateOnly(schedule.endDate, 'End date'));
    if (next > end) return null;
  }
  return next;
}

module.exports = {
  ALLOWED_FREQUENCIES,
  normalizeFrequency,
  formatDateOnly,
  parseDateOnly,
  computeInitialRunAt,
  computeNextRunAfterExecution,
};
