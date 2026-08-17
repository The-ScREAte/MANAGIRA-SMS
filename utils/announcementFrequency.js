const VALID_FREQUENCIES = new Set([
  "once",
  "once_per_session",
  "every_login",
  "daily",
  "n_times",
  "until_dismissed",
  "until_date",
]);

// Local calendar day, not UTC - a "daily" cap should track the server's
// local day boundary (matching how every other date-y feature in this app
// behaves), not UTC midnight. Comparing by UTC components alone caused
// timestamps near local midnight to miscompare across a day boundary.
function isSameCalendarDay(a, b) {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  );
}

/**
 * Pure function: given an announcement's frequency config and a viewer's receipt row
 * (or null if never seen), decides whether the announcement has been exhausted for
 * that viewer and should NOT be shown again. No DB access - keeps the rule set
 * unit-testable independent of the /me/announcements query.
 *
 * `once_per_session` has no receipt-table representation (no session_id column on
 * announcement_receipts), so it's treated identically to `every_login` here; the
 * per-session dedupe is layered on top via req.session in the controller.
 */
function isFrequencyExhausted(frequencyConfig, receiptRow, now = new Date()) {
  const { frequency, max_views, ends_at } = frequencyConfig || {};
  if (!VALID_FREQUENCIES.has(frequency)) {
    throw new Error(`Unknown announcement frequency: ${frequency}`);
  }

  switch (frequency) {
    case "once":
      return !!receiptRow && Number(receiptRow.view_count) > 0;

    case "once_per_session":
    case "every_login":
      return false;

    case "daily":
      if (!receiptRow || !receiptRow.last_seen_at) return false;
      return isSameCalendarDay(new Date(receiptRow.last_seen_at), now);

    case "n_times": {
      const cap = Number(max_views);
      if (!Number.isFinite(cap)) return false;
      return !!receiptRow && Number(receiptRow.view_count) >= cap;
    }

    case "until_dismissed":
      return !!receiptRow && !!receiptRow.dismissed_at;

    case "until_date":
      return !!ends_at && now >= new Date(ends_at);

    default:
      return false;
  }
}

module.exports = { isFrequencyExhausted, VALID_FREQUENCIES };
