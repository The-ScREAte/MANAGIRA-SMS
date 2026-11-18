/* How a school year divides into terms, for every page that sets one up (the first-time setup,
 * Management › School years). The same split as utils/firstSetup.js on the server: back-to-back
 * terms of (nearly) equal length from the first day to the last.
 *
 *   ManagiraTerms.termsFor('quarters', '2026-08-15', '2027-06-10')
 *     -> [{ name: 'Quarter 1', start: '2026-08-15', end: '2026-10-28' }, ...]
 *   ManagiraTerms.suggestYear(['2025-2026'])  -> { label: '2026-2027', start: '2026-08-15', end: '2027-06-10' }
 */
(function () {
  'use strict';
  if (window.ManagiraTerms) return;

  var STRUCTURES = {
    semesters: { label: 'Semesters', count: '2 terms', names: ['Fall Semester', 'Spring Semester'] },
    trimesters: { label: 'Trimesters', count: '3 terms', names: ['Trimester 1', 'Trimester 2', 'Trimester 3'] },
    quarters: { label: 'Quarters', count: '4 terms', names: ['Quarter 1', 'Quarter 2', 'Quarter 3', 'Quarter 4'] },
    year: { label: 'Full year', count: '1 term', names: ['Full Year'] }
  };
  var DAY = 86400000;

  function parseDay(value) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(value || '')) return null;
    var date = new Date(value + 'T00:00:00Z');
    return isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== value ? null : date;
  }
  function iso(date) { return date.toISOString().slice(0, 10); }

  function termsFor(structure, start, end) {
    var plan = STRUCTURES[structure];
    var a = parseDay(start);
    var b = parseDay(end);
    if (!plan || !a || !b || b <= a) return null;
    var days = Math.round((b - a) / DAY) + 1;
    if (days < plan.names.length * 7) return null;
    var from = a;
    return plan.names.map(function (name, i) {
      var to = i === plan.names.length - 1 ? b : new Date(a.getTime() + (Math.round((days * (i + 1)) / plan.names.length) - 1) * DAY);
      var term = { name: name, start: iso(from), end: iso(to) };
      from = new Date(to.getTime() + DAY);
      return term;
    });
  }

  // The usual US school year for a label: mid-August to early June.
  function datesForLabel(label) {
    var match = /^(\d{4})\s*-\s*(\d{4})$/.exec(String(label || '').trim());
    if (!match || Number(match[2]) !== Number(match[1]) + 1) return null;
    return { start: match[1] + '-08-15', end: match[2] + '-06-10' };
  }

  // The year a school is most likely setting up: the one it's in, or the next if it has that.
  function suggestYear(existingLabels, today) {
    var now = today || new Date();
    var first = now.getMonth() >= 6 ? now.getFullYear() : now.getFullYear() - 1;
    var taken = (existingLabels || []).map(function (l) { return String(l || '').replace(/\s+/g, ''); });
    while (taken.indexOf(first + '-' + (first + 1)) !== -1 && first < now.getFullYear() + 5) first += 1;
    var label = first + '-' + (first + 1);
    var dates = datesForLabel(label);
    return { label: label, start: dates.start, end: dates.end };
  }

  function nice(value) {
    var date = parseDay(value);
    return date ? date.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' }) : '';
  }

  window.ManagiraTerms = { STRUCTURES: STRUCTURES, termsFor: termsFor, datesForLabel: datesForLabel, suggestYear: suggestYear, parseDay: parseDay, nice: nice };
})();
