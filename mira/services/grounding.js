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

// Dates and times in a reply are checked by unsupportedDates/wrongWeekdays, not as figures: the
// 12 in "October 12" or the 30 in "9:30" isn't a count.
const ISO_DATE = /\b(\d{4})-(\d{2})-(\d{2})(?:[T ]\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:?\d{2})?)?/g;
const SLASH_DATE = /\b\d{1,2}\/\d{1,2}\/\d{2,4}\b/g;
const TIME = /\b\d{1,2}:\d{2}(?::\d{2})?(?:\s?[ap]\.?m\.?)?/gi;

// Numbers joined by hyphens are codes, not figures: a phone number (555-0319), a student number
// (S146-10), a school year (2026-2027).
const CODE = /[\p{L}\d]*\d[\p{L}\d]*(?:[-–][\p{L}\d]+)+/gu;

function withoutDates(text) {
  return String(text || "")
    .replace(MONTH_RANGE, " ")
    .replace(ISO_DATE, " ")
    .replace(SLASH_DATE, " ")
    .replace(TIME, " ")
    .replace(SAID_MONTH_FIRST, " ")
    .replace(SAID_DAY_FIRST, " ")
    .replace(CODE, " ");
}

// The whole values evidence holds. A figure is backed only by a whole value, never by a piece of
// something else: not the day or month inside a date (2026-10-12 backs no "12 students"), not an
// id ("class_id":1004 backs no "1004 students"), not digits inside a word or code ("v12",
// "room_12", a UUID). A date's year does count: "the 2026 school year".
const UUID = /\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi;
const ID_VALUE = /\\?"[A-Za-z_]*(?:_id|Id|ID|_ids|Ids)\\?"\s*:\s*(?:\[[\d,\s]*\]|-?\d+)/g;
const BARE_ID = /\\?"id\\?"\s*:\s*-?\d+/g;
const WHOLE_VALUE = /(?<![\w.,-])\d{1,3}(?:,\d{3})+(?:\.\d+)?(?![\w])|(?<![\w.-])\d+(?:\.\d+)?(?![\w-])/g;

// Ids are kept apart: a reply may quote one exactly (a student number in a table), but no count
// is ever rounded from one. Returns { values, ids }.
function evidenceIds(pool) {
  const ids = [];
  for (const m of pool.matchAll(ID_VALUE)) ids.push(...(m[0].split(":").pop().match(/-?\d+/g) || []));
  for (const m of pool.matchAll(BARE_ID)) ids.push(...(m[0].split(":").pop().match(/-?\d+/g) || []));
  return ids;
}

function evidenceValues(pool) {
  const years = (pool.match(ISO_DATE) || []).map((d) => d.slice(0, 4));
  const cleaned = pool
    .replace(UUID, " ")
    .replace(ID_VALUE, " ")
    .replace(BARE_ID, " ")
    .replace(ISO_DATE, " ")
    .replace(SLASH_DATE, " ")
    .replace(TIME, " ");
  return [...years, ...(cleaned.match(WHOLE_VALUE) || [])];
}

function unsupportedFigures(reply, evidence) {
  const found = figuresIn(withoutDates(reply)).filter((figure) => toNumber(figure) >= 10);
  if (!found.length) return [];
  const pool = (Array.isArray(evidence) ? evidence : [evidence]).map((part) => String(part || "")).join("\n");
  const known = new Set();
  const values = [];
  evidenceValues(pool).forEach((figure) => {
    known.add(String(figure).replace(/,/g, ""));
    values.push(toNumber(figure));
  });
  evidenceIds(pool).forEach((id) => known.add(id));
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
// "November 1–18", "Nov 3 - 7": a range of days in a month.
const MONTH_RANGE = new RegExp(`\\b${MONTH}\\.?\\s+\\d{1,2}(?:st|nd|rd|th)?\\s*[–—-]\\s*\\d{1,2}(?:st|nd|rd|th)?\\b`, "gi");
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

// ── Names ──
// Every person, class or place named in a reply must be named somewhere it could have come from:
// a tool result, the context, or the person's own words. A name is a run of two to four
// Capitalised words ("Emma Carter", "Ama Owusu-Mensah"). Words that are ordinary English - ones
// written in lower case somewhere in Mira's instructions, the tools' descriptions or the reply
// itself ("Attendance Summary", "Next Steps") - prove nothing either way, so only the other
// words of a name are looked for; a run made only of ordinary words is no name. Every word that
// remains must appear, whole and in any case, in the evidence. Headings are skipped.
const NAME_RUN = /(?<![\p{L}\p{N}])(?:\p{Lu}[\p{Ll}'’-]+|\p{Lu}\.)(?:[ \t]+(?:\p{Lu}[\p{Ll}'’-]+|\p{Lu}\.|de|da|del|van|von|la|le|bin|al)){1,3}(?![\p{L}\p{N}])/gu;
const TITLES = new Set(["mr", "mrs", "ms", "miss", "mx", "dr", "prof", "sir", "madam", "mr.", "mrs.", "ms.", "dr."]);
// Product and feature names written capitalised everywhere, and calendar words.
const ALWAYS_COMMON = new Set([
  "managira", "mira", "paygira", "hub", "january", "february", "march", "april", "may", "june", "july", "august", "september",
  "october", "november", "december", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday",
  "i", "i'm", "i've", "i'll", "i'd", "ok", "okay",
  // Greetings and openers that start a sentence before a name ("Hi Henry", "Thanks Ama").
  "hi", "hello", "hey", "dear", "thanks", "thank", "congratulations", "welcome", "great", "sure", "yes", "no", "good", "morning",
  "afternoon", "evening", "note", "update", "reminder", "re", "fyi",
  // Everyday words, so a capitalised one ("About Us", "Here Is") never needs a record.
  "a", "an", "the", "and", "or", "but", "if", "of", "in", "on", "at", "to", "for", "from", "by", "with", "about", "as", "into", "over",
  "under", "after", "before", "up", "down", "out", "off", "all", "any", "each", "every", "some", "no", "not", "our", "us", "we", "you",
  "your", "my", "me", "it", "its", "this", "that", "these", "those", "here", "there", "what", "which", "who", "how", "why", "when",
  "where", "is", "are", "was", "were", "be", "has", "have", "had", "do", "does", "can", "will", "new", "next", "first", "last", "more",
  "most", "other", "own", "same", "so", "than", "too", "very", "just", "also", "now", "then", "only", "both", "per",
  // Number words start sentences ("Six Grade 5 students ..."): never part of a name.
  "one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten", "eleven", "twelve", "thirteen", "fourteen",
  "fifteen", "sixteen", "seventeen", "eighteen", "nineteen", "twenty", "thirty", "forty", "fifty", "hundred", "thousand",
  "first", "second", "third", "fourth", "fifth", "half", "none", "several", "many", "few",
]);

const fold = (word) => word.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[’]/g, "'").replace(/^'+|'+$/g, "").replace(/'s$/, "");

// Words written in lower case in these texts: ordinary words.
function commonWords(texts) {
  const words = new Set(ALWAYS_COMMON);
  for (const text of texts) {
    for (const m of String(text || "").matchAll(/(?<![\p{L}])[\p{Ll}][\p{L}'’-]*/gu)) words.add(fold(m[0]));
  }
  return words;
}

function evidenceWords(pool) {
  const words = new Set();
  for (const m of pool.matchAll(/[\p{L}][\p{L}'’]*/gu)) {
    words.add(fold(m[0]));
    // Hyphenated names are found whole and in parts ("Owusu-Mensah").
  }
  for (const m of pool.matchAll(/[\p{L}][\p{L}'’]*(?:-[\p{L}][\p{L}'’]*)+/gu)) words.add(fold(m[0]));
  return words;
}

function namesIn(reply) {
  const text = String(reply || "")
    .split("\n")
    .filter((line) => !/^\s*#/.test(line))
    .join("\n")
    .replace(/\]\([^)]*\)/g, "]")
    .replace(/https?:\/\/\S+/g, " ")
    .replace(/`[^`]*`/g, " ")
    // Table cells and lines are separate: a name never runs across them.
    .replace(/\|/g, "\n")
    .replace(/[*_]/g, " ");
  return [...new Set(text.match(NAME_RUN) || [])].map((name) => name.trim());
}

/**
 * unsupportedNames(reply, evidence, ordinaryTexts) -> names in the reply with a word that no
 * evidence holds. `ordinaryTexts` are texts whose lower-case words count as ordinary (Mira's
 * instructions, the tools' descriptions); the reply's own lower-case words always do.
 */
function unsupportedNames(reply, evidence, ordinaryTexts = []) {
  const names = namesIn(reply);
  if (!names.length) return [];
  const pool = (Array.isArray(evidence) ? evidence : [evidence]).map((part) => String(part || "")).join("\n");
  const known = evidenceWords(pool);
  const ordinary = commonWords([...ordinaryTexts, reply]);
  const missing = [];
  for (const name of names) {
    const words = name.split(/\s+/).map(fold).filter((w) => w && !TITLES.has(w));
    const telling = words.filter((w) => !ordinary.has(w) && w.length > 1);
    if (!telling.length) continue;
    const absent = telling.filter((w) => !known.has(w) && !w.split("-").every((part) => known.has(part)));
    if (absent.length) missing.push(name);
  }
  return missing;
}

// ── "All" and "none" claims ──
// "All fees are paid", "no one is absent", "everyone returned the form": a claim about every
// student needs a lookup that found none outstanding - a zero total or an empty list in a tool
// result. Without one, the reply can't say it (a list of 3 who owe never backs "all paid").
const NEGATIVE = "(?:owe|owes|owing|owed|unpaid|outstanding|overdue|missing|absent|late|behind|below|incomplete|not (?:yet )?(?:paid|returned|submitted|signed|completed|done)|hasn'?t|haven'?t|didn'?t|did not|has not|have not)";
const POSITIVE = "(?:paid|paid up|returned|submitted|signed|completed|attended|present|up to date|cleared|accepted|logged in|signed up)";
const CLAIMS = [
  new RegExp(`\\b(?:no one|nobody|no students?|no pupils?|no learners?|no families|no parents|no guardians|none of (?:the|them|these|your)\\b[^.\\n]{0,30}?|not a single (?:student|one|family|parent))\\b[^.\\n]{0,50}?\\b${NEGATIVE}\\b`, "gi"),
  new RegExp(`\\b(?:all|every|everyone|everybody|each)\\b[^.\\n]{0,40}?\\b(?:ha(?:ve|s)\\s+(?:all\\s+)?(?:been\\s+)?|are\\s+(?:all\\s+)?|is\\s+|were\\s+|was\\s+)?${POSITIVE}\\b`, "gi"),
  /\b(?:fully paid|all paid|100% (?:attendance|paid|complete)|perfect attendance|no (?:outstanding|unpaid|overdue|missing) (?:fees|balances|forms|payments|requests|work))\b/gi,
];
// What a claim is about, and the zeros that can back it. A zero only backs a claim about the same
// thing: "all fees are paid" needs a zero for owing, never "no_login": 0. Each topic: the words
// that put a claim in it, the keys whose zero backs it, and the words that make a whole lookup
// about it (so its general total/count/matched of 0, or its empty list, backs the claim too).
const TOPICS = {
  fees: {
    claim: /\b(?:fees?|paid|pay|payments?|owe|owes|owing|owed|unpaid|balances?|overdue|debts?|money|tuition)\b/i,
    keys: /(?:owing|owe|owed|unpaid|overdue|balance|fee|debt|amount_due|due_amount|outstanding_amount)/i,
    about: /\b(?:fees?|owes?|owing|owed|unpaid|balances?|overdue|payments?|paygira|tuition)\b|owes_fees|min_owed/i,
  },
  attendance: {
    claim: /\b(?:absent|absences?|attended|attendance|present|late|tardy|missed school)\b/i,
    keys: /(?:absent|absence|attendance|late|tardy|below|present_missing)/i,
    about: /\battendance\b|\babsen|attendancePercent|min_absences|days_?marked/i,
  },
  forms: {
    claim: /\b(?:forms?|slips?|consent|returned|submitted|signed|completed|requests?|sign[- ]?ups?)\b/i,
    keys: /(?:outstanding|incomplete|not_completed|not_returned|not_signed|not_submitted|missing|pending)/i,
    about: /\bforms?\b|\bslips?\b|\bconsent\b|forms_outstanding|formsAsked|studentsWithOutstanding/i,
  },
  invitations: {
    claim: /\b(?:invit\w*|accepted|log ?ins?|logged in|signed up|set up their account)\b/i,
    keys: /(?:not_accepted|no_login|setup_pending|unaccepted|pending)/i,
    about: /\binvit|not_accepted|no_login|setup_pending/i,
  },
};
const GENERAL_ZERO = /\\?"[A-Za-z_]*(?:total|count|matched|listed|rows|results|students)[A-Za-z_]*\\?"\s*:\s*0(?![\d.])|:\s*\[\s*\]/i;
const ZERO_KEYS = /\\?"([A-Za-z_]+)\\?"\s*:\s*0(?![\d.])/g;
const EMPTY = /^\s*\[\s*\]\s*$|^\s*\{\s*"[^"]+"\s*:\s*\[\s*\]\s*\}\s*$/;

function topicsOf(claim) {
  return Object.entries(TOPICS).filter(([, t]) => t.claim.test(claim)).map(([name]) => name);
}

// Does this lookup result found none of `topic`? A zero under one of its keys, or a general zero
// (total, matched, an empty list) in a lookup that is about it.
function foundNone(part, topic) {
  const t = TOPICS[topic];
  for (const m of part.matchAll(ZERO_KEYS)) if (t.keys.test(m[1])) return true;
  return t.about.test(part) && (GENERAL_ZERO.test(part) || EMPTY.test(part));
}

// "Each of these 3 has not paid" and "not all have returned it" say some haven't: no "all" claim.
const NEGATED = /\b(?:not|never|yet to|still)\b|n'?t\b/i;

function claimsIn(reply) {
  const text = String(reply || "").replace(/[*_]/g, "");
  const found = [];
  CLAIMS.forEach((re, i) => {
    for (const m of text.matchAll(re)) {
      if (i === 1 && (NEGATED.test(m[0]) || /\bnot\s+$/i.test(text.slice(Math.max(0, m.index - 5), m.index)))) continue;
      found.push(m[0].trim());
    }
  });
  return [...new Set(found)];
}

/** unsupportedClaims(reply, toolResults) -> "all"/"none" claims no tool result found zero for. */
function unsupportedClaims(reply, toolResults) {
  const claims = claimsIn(reply);
  if (!claims.length) return [];
  const results = (Array.isArray(toolResults) ? toolResults : [toolResults]).map((part) => String(part || ""));
  return claims.filter((claim) => {
    const topics = topicsOf(claim);
    // A claim on no topic this check knows needs a lookup that found none of anything at all.
    if (!topics.length) return !results.some((part) => GENERAL_ZERO.test(part) || EMPTY.test(part));
    // On every topic it names, a lookup about that topic found none.
    return !topics.every((topic) => results.some((part) => foundNone(part, topic)));
  });
}

module.exports = { unsupportedFigures, figuresIn, wrongWeekdays, unsupportedDates, unsupportedNames, namesIn, unsupportedClaims, claimsIn, evidenceValues };
