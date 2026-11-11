// A reply may only state figures that came from somewhere: a tool result, a
// message in the conversation, or the context Mira was given. This finds the
// figures in a reply that appear nowhere in that evidence, so the
// orchestrator can send the reply back once for correction before it stands.
//
// Small numbers (under 10) are left alone: they are everywhere (list items,
// "2 classes") and can't be told apart from real data. Rounding is allowed
// (a tool's 87.46 may be said as 87.5 or 87), and so are thousands
// separators and a trailing % or currency sign.

const FIGURE = /(?<![\w.])\d{1,3}(?:,\d{3})+(?:\.\d+)?(?![\w])|(?<![\w.])\d+(?:\.\d+)?(?![\w])/g;

function figuresIn(text) {
  return String(text || "")
    // Links and images: their addresses come from tools, never from the model's head.
    .replace(/\]\([^)]*\)/g, "]")
    .replace(/https?:\/\/\S+/g, " ")
    // List numbering ("1. ", "2) ") isn't data.
    .replace(/^\s*\d+[.)]\s+/gm, " ")
    .match(FIGURE) || [];
}

function toNumber(figure) {
  return Number(String(figure).replace(/,/g, ""));
}

function unsupportedFigures(reply, evidence) {
  const found = figuresIn(reply).filter((figure) => toNumber(figure) >= 10);
  if (!found.length) return [];
  const pool = (Array.isArray(evidence) ? evidence : [evidence]).map((part) => String(part || "")).join("\n");
  const known = new Set();
  const values = [];
  // Evidence is read loosely: every run of digits counts, so the day in a
  // timestamp like 2026-10-12T00:00:00Z backs up "October 12".
  (pool.match(/\d{1,3}(?:,\d{3})+(?:\.\d+)?|\d+(?:\.\d+)?/g) || []).forEach((figure) => {
    known.add(String(figure).replace(/,/g, ""));
    values.push(toNumber(figure));
  });
  const supported = (figure) => {
    const plain = String(figure).replace(/,/g, "");
    if (known.has(plain)) return true;
    const value = toNumber(figure);
    // Rounded from a figure the tools gave (to whole numbers or one decimal).
    return values.some((v) => Math.abs(v - value) <= (plain.includes(".") ? 0.05 : 0.5));
  };
  return [...new Set(found.filter((figure) => !supported(figure)))];
}

// A weekday said with a date must be that date's weekday ("Tuesday, November 18, 2026" is
// wrong: it's a Wednesday). Models get this wrong even with a calendar in front of them.
const WEEKDAYS = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"];
const MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];
const DAY = "(sun|mon|tues?|wed(?:nes)?|thu(?:rs?)?|fri|sat(?:ur)?)(?:day)?";
const MONTH = "(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|june?|july?|aug(?:ust)?|sept?(?:ember)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)";
const MONTH_FIRST = new RegExp(`\\b${DAY}\\.?,?\\s+${MONTH}\\.?\\s+(\\d{1,2})(?:st|nd|rd|th)?\\b(?:,?\\s+(\\d{4}))?`, "gi");
const DAY_FIRST = new RegExp(`\\b${DAY}\\.?,?\\s+(\\d{1,2})(?:st|nd|rd|th)?\\s+(?:of\\s+)?${MONTH}\\b\\.?(?:,?\\s+(\\d{4}))?`, "gi");

function weekdayIndex(word) {
  const w = word.toLowerCase();
  return WEEKDAYS.findIndex((day) => day.startsWith(w.slice(0, 3)));
}

function wrongWeekdays(reply, today = new Date()) {
  const text = String(reply || "");
  const wrong = [];
  const check = (said, dayWord, monthWord, dateText, yearText) => {
    const month = MONTHS.indexOf(monthWord.toLowerCase().slice(0, 3));
    const date = Number(dateText);
    if (month < 0 || date < 1 || date > 31) return;
    // No year said: the one that puts the date nearest today.
    const years = yearText ? [Number(yearText)] : [today.getUTCFullYear() - 1, today.getUTCFullYear(), today.getUTCFullYear() + 1];
    const when = years
      .map((year) => new Date(Date.UTC(year, month, date)))
      .filter((d) => d.getUTCDate() === date)
      .sort((a, b) => Math.abs(a - today) - Math.abs(b - today))[0];
    if (!when) return;
    const actual = when.getUTCDay();
    if (weekdayIndex(dayWord) !== actual) {
      const name = WEEKDAYS[actual];
      wrong.push(`"${said.trim()}" (that date is a ${name.charAt(0).toUpperCase()}${name.slice(1)})`);
    }
  };
  for (const m of text.matchAll(MONTH_FIRST)) check(m[0], m[1], m[2], m[3], m[4]);
  for (const m of text.matchAll(DAY_FIRST)) check(m[0], m[1], m[3], m[2], m[4]);
  return [...new Set(wrong)];
}

// A date said in a reply ("November 9", "9 Nov 2026") must be a date some tool result, the
// context (today, the coming days) or the person's words gave: day numbers are too small for
// the figure check, so a misread birthday would otherwise pass.
const SAID_MONTH_FIRST = new RegExp(`\\b${MONTH}\\.?\\s+(\\d{1,2})(?:st|nd|rd|th)?\\b(?!:)(?:,?\\s+(\\d{4}))?`, "gi");
const SAID_DAY_FIRST = new RegExp(`\\b(\\d{1,2})(?:st|nd|rd|th)?\\s+(?:of\\s+)?${MONTH}\\b\\.?(?:,?\\s+(\\d{4}))?`, "gi");

function datesIn(text) {
  const found = [];
  const add = (said, monthWord, day, year) => {
    const month = MONTHS.indexOf(monthWord.toLowerCase().slice(0, 3));
    const date = Number(day);
    if (month >= 0 && date >= 1 && date <= 31) found.push({ said: said.trim(), month: month + 1, day: date, year: year ? Number(year) : null });
  };
  for (const m of String(text || "").matchAll(SAID_MONTH_FIRST)) add(m[0], m[1], m[2], m[3]);
  for (const m of String(text || "").matchAll(SAID_DAY_FIRST)) add(m[0], m[2], m[1], m[3]);
  return found;
}

function unsupportedDates(reply, evidence) {
  const said = datesIn(reply);
  if (!said.length) return [];
  const pool = (Array.isArray(evidence) ? evidence : [evidence]).map((part) => String(part || "")).join("\n");
  const known = new Set();
  const mark = (year, month, day) => { known.add(`${month}-${day}`); if (year) known.add(`${year}-${month}-${day}`); };
  // 2026-11-13, 2026-11-13T00:00:00Z (a time can move it a day either way), 11/13/2026.
  for (const m of pool.matchAll(/\b(\d{4})-(\d{2})-(\d{2})(T\d{2}:\d{2})?/g)) {
    const base = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
    const shifts = m[4] ? [-1, 0, 1] : [0];
    shifts.forEach((shift) => {
      const d = new Date(base.getTime() + shift * 86400000);
      mark(d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate());
    });
  }
  for (const m of pool.matchAll(/\b(\d{1,2})\/(\d{1,2})\/(\d{4})\b/g)) mark(Number(m[3]), Number(m[1]), Number(m[2]));
  datesIn(pool).forEach((d) => mark(d.year, d.month, d.day));
  return [...new Set(said
    .filter((d) => !(d.year ? known.has(`${d.year}-${d.month}-${d.day}`) || known.has(`${d.month}-${d.day}`) : known.has(`${d.month}-${d.day}`)))
    .map((d) => d.said))];
}

module.exports = { unsupportedFigures, figuresIn, wrongWeekdays, unsupportedDates };
