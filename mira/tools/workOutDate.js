// Exact date arithmetic, so Mira never works out a weekday or a date by itself: "the first Thursday
// after October 16", "3 weeks from Friday", "the last Friday of the term". Reads nothing.
const WEEKDAYS = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"];
const ORDER = { first: 1, next: 1, second: 2, third: 3, fourth: 4, fifth: 5 };

function parseDay(text) {
  const m = String(text || "").trim().match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return null;
  const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
  return Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== text.trim() ? null : d;
}
const key = (d) => d.toISOString().slice(0, 10);
const label = (d) => d.toLocaleDateString("en-US", { weekday: "long", year: "numeric", month: "long", day: "numeric", timeZone: "UTC" });
const addDays = (d, n) => new Date(d.getTime() + n * 86400000);

module.exports = {
  name: "work_out_date",
  description:
    "Work out a date exactly (never do date or weekday arithmetic yourself). From a start date (YYYY-MM-DD; use the dates under Coming days or a tool's dates), " +
    "either find a weekday relative to it (weekday + which: first/next/second/third/fourth/last, direction after or before; \"the first Thursday after October 16\"), " +
    "or add days, weeks or months (\"3 weeks from Friday\"). Says the weekday and whether the date is already past.",
  parameters: {
    type: "object",
    properties: {
      from: { type: "string", description: "Start date, YYYY-MM-DD." },
      weekday: { type: "string", enum: WEEKDAYS.map((d) => d[0].toUpperCase() + d.slice(1)) },
      which: { type: "string", enum: ["first", "next", "second", "third", "fourth", "fifth", "last"], description: "With weekday: which one. 'last' with direction before = the last one before the date; within a month use from = the month's last day." },
      direction: { type: "string", enum: ["after", "before"], description: "With weekday: after (default) or before the start date. The start date itself never counts." },
      add_days: { type: "integer" },
      add_weeks: { type: "integer" },
      add_months: { type: "integer" },
      today: { type: "string", description: "Today's date (YYYY-MM-DD, from the context), to say whether the result is past." },
    },
    required: ["from"],
  },
  async handler(args) {
    const from = parseDay(args && args.from);
    if (!from) return { ok: false, error_message: "from must be a real date, YYYY-MM-DD." };
    let date = from;
    if (args.weekday) {
      const target = WEEKDAYS.indexOf(String(args.weekday).toLowerCase());
      if (target < 0) return { ok: false, error_message: "weekday must be a day of the week." };
      const before = args.direction === "before" || args.which === "last";
      const nth = args.which === "last" ? 1 : ORDER[args.which] || 1;
      let found = 0;
      let cursor = from;
      while (found < nth) {
        cursor = addDays(cursor, before ? -1 : 1);
        if (cursor.getUTCDay() === target) found += 1;
      }
      date = cursor;
    }
    if (Number.isInteger(args.add_months) && args.add_months) {
      const d = new Date(date);
      const day = d.getUTCDate();
      d.setUTCDate(1);
      d.setUTCMonth(d.getUTCMonth() + args.add_months);
      const last = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).getUTCDate();
      d.setUTCDate(Math.min(day, last));
      date = d;
    }
    if (Number.isInteger(args.add_weeks)) date = addDays(date, 7 * args.add_weeks);
    if (Number.isInteger(args.add_days)) date = addDays(date, args.add_days);
    const today = parseDay(args.today);
    return {
      ok: true,
      date: key(date),
      weekday: WEEKDAYS[date.getUTCDay()][0].toUpperCase() + WEEKDAYS[date.getUTCDay()].slice(1),
      reads_as: label(date),
      from: { date: key(from), reads_as: label(from) },
      ...(today ? { already_past: date < today, days_from_today: Math.round((date - today) / 86400000) } : {}),
    };
  },
};
