// Code writes the facts: for Mira's most-used lookups, the result the model sees starts with
// `summary_text` (one sentence with the exact totals) and `table` (a Markdown table of the rows),
// both built here from the tool's own result - so the model never counts a list, adds up
// classes or works out a total itself. The system prompt tells it to use them as written.
//
// Totals come from the server's own totals where it gives them; a list's length is used as a
// count only when the list is complete (not cut short). A result that's an error or a question
// back (needs_info) is left as it is. The ten tools covered are the most-used read tools in the
// local copy's mira_tool_call_log (2026-11-22).

const TABLE_ROWS = 25;
const LIST_IN_SENTENCE = 8;

const plural = (n, one, many = `${one}s`) => `${Number(n).toLocaleString("en-US")} ${Number(n) === 1 ? one : many}`;
const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

// "2026-11-22" -> "Sunday, November 22, 2026" (the weekday worked out here, never guessed).
function dayInWords(iso) {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(iso || ""));
  if (!m) return String(iso || "");
  const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
  return `${WEEKDAYS[d.getUTCDay()]}, ${MONTHS[d.getUTCMonth()]} ${d.getUTCDate()}, ${d.getUTCFullYear()}`;
}

function cell(value) {
  if (value === null || value === undefined || value === "") return "";
  const text = Array.isArray(value) ? value.map((v) => (v && typeof v === "object" ? v.name || "" : v)).filter(Boolean).join(", ") : String(value);
  return text.replace(/\|/g, "/").replace(/\s+/g, " ").trim().slice(0, 80);
}

// columns: [[heading, row => value], ...]
function table(rows, columns, total) {
  if (!rows || !rows.length) return "";
  const lines = [`| ${columns.map(([h]) => h).join(" | ")} |`, `| ${columns.map(() => "---").join(" | ")} |`];
  rows.slice(0, TABLE_ROWS).forEach((row) => lines.push(`| ${columns.map(([, get]) => cell(get(row))).join(" | ")} |`));
  const all = total === undefined ? rows.length : total;
  if (all > Math.min(rows.length, TABLE_ROWS)) lines.push(`\nShowing ${Math.min(rows.length, TABLE_ROWS)} of ${Number(all).toLocaleString("en-US")}.`);
  return lines.join("\n");
}

const nameOf = (r) => r.name || r.student || r.student_name || [r.first_name || r.firstName, r.last_name || r.lastName].filter(Boolean).join(" ") || r.title || "";
const classOf = (r) => r.class_name || r.className || r.class || "";

function namesList(rows, describe, total) {
  const shown = rows.slice(0, LIST_IN_SENTENCE).map(describe).filter(Boolean);
  const more = (total === undefined ? rows.length : total) - shown.length;
  return `${shown.join(", ")}${more > 0 ? `, and ${plural(more, "more", "more")}` : ""}`;
}

const isError = (result) => !result || typeof result !== "object"
  || result.ok === false || result.found === false || ["needs_info", "error", "blocked", "failed"].includes(String(result.status || ""));

// ── The ten tools ──
const BUILDERS = {
  get_class(result, args) {
    if (!Array.isArray(result)) return null;
    const asked = args && args.query ? ` matching "${args.query}"` : "";
    if (!result.length) return { summary_text: `No class${asked} in this school.`, table: "", total: 0 };
    const students = result.reduce((sum, c) => sum + (Number(c.student_count) || 0), 0);
    return {
      summary_text: `${plural(result.length, "class", "classes")}${asked}: ${namesList(result, (c) => `${c.class_name} (${plural(c.student_count || 0, "student")})`)}. ${plural(students, "student")} in all.`,
      table: table(result, [["Class", (c) => c.class_name], ["Students", (c) => c.student_count]]),
      total: result.length,
    };
  },

  find_student(result, args) {
    if (!Array.isArray(result)) return null;
    const asked = args && args.query ? ` matching "${args.query}"` : "";
    if (!result.length) return { summary_text: `No student${asked} found.`, table: "", total: 0 };
    return {
      summary_text: `${plural(result.length, "student")}${asked}: ${namesList(result, (s) => `${nameOf(s)}${classOf(s) ? ` (${classOf(s)})` : ""}`)}.`,
      table: table(result, [["Student", nameOf], ["Class", classOf]]),
      total: result.length,
    };
  },

  get_calendar(result) {
    const totals = result.totals || {};
    const scope = result.scope || {};
    const items = Array.isArray(result.data) ? result.data : [];
    const kinds = Object.entries(totals.by_kind || {}).map(([kind, n]) => plural(n, kind.replace(/_/g, " ")));
    const range = scope.from ? ` from ${dayInWords(scope.from)} to ${dayInWords(scope.to)}` : "";
    const count = typeof totals.items === "number" ? totals.items : items.length;
    return {
      summary_text: `${count ? plural(count, "item") : "Nothing"} on the ${scope.scope || ""} calendar${range}${kinds.length ? ` (${kinds.join(", ")})` : ""}${totals.days_off ? `; ${plural(totals.days_off, "day off", "days off")}` : ""}.`.replace(/\s+/g, " "),
      table: table(items, [["Date", (i) => (i.date || i.start ? dayInWords(i.date || i.start) : "")], ["Time", (i) => i.time || i.start_time || ""], ["What", (i) => i.title || i.name || ""], ["Kind", (i) => i.kind || i.type || ""]], count),
      total: count,
    };
  },

  find_students(result) {
    const totals = result.totals || {};
    const rows = Array.isArray(result.data) ? result.data : Array.isArray(result.data && result.data.students) ? result.data.students : [];
    const matched = typeof totals.matched === "number" ? totals.matched : null;
    if (matched === null) return null;
    const conditions = Object.entries(totals).filter(([key, n]) => key !== "matched" && typeof n === "number").map(([key, n]) => `${key.replace(/_/g, " ")}: ${n}`);
    return {
      summary_text: `${plural(matched, "student")} ${matched === 1 ? "matches" : "match"} all of the conditions${conditions.length ? ` (each on its own - ${conditions.join("; ")})` : ""}.`,
      table: table(rows, [["Student", nameOf], ["Class", classOf]], matched),
      total: matched,
    };
  },

  find_low_attendance(result, args) {
    if (typeof result.total !== "number") return null;
    const below = (args && args.below) || null;
    const rows = Array.isArray(result.students) ? result.students : [];
    const capped = /only the first/i.test(String(result.note || ""));
    return {
      summary_text: `${plural(result.total, "student")}${below ? ` below ${below}% attendance` : ""} - ${typeof result.classes === "string" ? result.classes : (result.classes || []).join(", ")}, ${result.term || "this term"}.${capped ? ` ${String(result.note).match(/Only the first[^.]*\./i)?.[0] || ""}` : ""}`.trim(),
      table: table(rows, [["Student", nameOf], ["Class", classOf], ["Attendance %", (r) => r.attendancePercent], ["Days absent", (r) => r.absent]], result.total),
      total: result.total,
    };
  },

  list_events(result) {
    const events = Array.isArray(result.events) ? result.events : null;
    if (!events) return null;
    return {
      summary_text: events.length ? `${plural(events.length, "event")}: ${namesList(events, (e) => `${e.title || e.name}${e.date || e.event_date ? ` (${dayInWords(e.date || e.event_date)})` : ""}`)}.` : "No events found.",
      table: table(events, [["Event", (e) => e.title || e.name], ["Date", (e) => dayInWords(e.date || e.event_date || e.start || "")], ["Where", (e) => e.location || ""]]),
      total: events.length,
    };
  },

  list_activities(result) {
    const rows = Array.isArray(result.activities) ? result.activities : null;
    if (!rows) return null;
    const total = typeof result.total === "number" ? result.total : rows.length;
    const range = result.from ? ` from ${dayInWords(result.from)} to ${dayInWords(result.to)}` : "";
    return {
      summary_text: `${total ? plural(total, "activity", "activities") : "No activities"}${range}${total ? `: ${namesList(rows, (a) => a.title || a.name, total)}` : ""}.`,
      table: table(rows, [["Activity", (a) => a.title || a.name], ["Date", (a) => dayInWords(a.date || a.start || a.start_date || "")], ["Who", (a) => a.audience || a.class || a.classes || ""]], total),
      total,
    };
  },

  list_students(result) {
    const counts = result.counts;
    if (!counts || typeof counts.total !== "number") return null;
    const rows = Array.isArray(result.students) ? result.students : [];
    const byClass = (counts.byClass || []).map((c) => `${c.name} ${c.count}`);
    const byGender = (counts.byGender || []).map((g) => `${g.count} ${String(g.name).toLowerCase()}`);
    const parts = [
      typeof counts.active === "number" ? `${counts.active} active` : "",
      counts.graduated ? `${counts.graduated} graduated` : "",
    ].filter(Boolean);
    return {
      summary_text: `${plural(counts.total, "student")}${parts.length ? ` (${parts.join(", ")})` : ""}${byClass.length === 1 ? ` in ${counts.byClass[0].name}` : byClass.length ? ` - by class: ${byClass.slice(0, LIST_IN_SENTENCE).join(", ")}${byClass.length > LIST_IN_SENTENCE ? `, and ${byClass.length - LIST_IN_SENTENCE} more classes` : ""}` : ""}${byGender.length ? `; ${byGender.join(", ")}` : ""}.`,
      table: table(rows, [["Student", nameOf], ["Class", classOf], ["Gender", (s) => s.gender]], counts.total),
      total: counts.total,
    };
  },

  get_class_readiness(result) {
    const rows = Array.isArray(result.data) ? result.data : null;
    if (!rows) return null;
    const t = result.totals;
    // The server's totals cover every class in scope, even when a status filter lists none.
    if (t && typeof t.classes === "number") {
      return {
        summary_text: `${plural(t.classes, "class", "classes")}: ${t.ready_to_post} ready to post (every score entered), ${t.with_missing_scores} still missing scores, ${t.with_report_cards_not_posted} with report cards not all posted, ${t.all_posted} with every report card posted.`,
        table: table(rows, [["Class", (c) => c.class], ["Students", (c) => c.students], ["Posted", (c) => c.report_cards_posted], ["Not posted", (c) => c.report_cards_not_posted], ["Scores missing", (c) => c.scores_missing], ["Ready to post", (c) => (c.ready_to_post ? "Yes" : "No")], ["Main teacher", (c) => c.main_teacher]], t.listed || rows.length),
        total: t.classes,
      };
    }
    const complete = result.truncated !== true;
    const ready = rows.filter((c) => c.ready_to_post).length;
    const missing = rows.filter((c) => Number(c.scores_missing) > 0).length;
    const allPosted = rows.filter((c) => Number(c.report_cards_not_posted) === 0 && Number(c.students) > 0).length;
    const n = rows.length;
    return {
      summary_text: complete
        ? `${plural(n, "class", "classes")}: ${ready} ready to post (every score entered), ${missing} still missing scores, ${allPosted} with every report card posted.`
        : `Showing ${plural(n, "class", "classes")} (the list was cut short, so these aren't totals for the school): ${ready} ready to post, ${missing} missing scores.`,
      table: table(rows, [["Class", (c) => c.class], ["Students", (c) => c.students], ["Posted", (c) => c.report_cards_posted], ["Not posted", (c) => c.report_cards_not_posted], ["Scores missing", (c) => c.scores_missing], ["Ready to post", (c) => (c.ready_to_post ? "Yes" : "No")], ["Main teacher", (c) => c.main_teacher]]),
      total: n,
    };
  },

  list_family_invitations(result) {
    const t = result.totals;
    if (!t || typeof t.parents !== "number") return null;
    const rows = result.data && Array.isArray(result.data.parents) ? result.data.parents : [];
    const notYet = [t.no_login ? `${t.no_login} with no login` : "", t.setup_pending ? `${t.setup_pending} with setup pending` : ""].filter(Boolean);
    return {
      summary_text: `${Number(t.accepted).toLocaleString("en-US")} of ${plural(t.parents, "parent")} have accepted their invitation; ${Number(t.not_accepted).toLocaleString("en-US")} haven't${notYet.length ? ` (${notYet.join(", ")})` : ""}. ${typeof t.students_in_scope === "number" ? `${plural(t.students_in_scope, "student")} in scope (${(result.scope && result.scope.classes) || "every class"})` : ""}${t.students_with_no_parent_linked ? `; ${t.students_with_no_parent_linked} with no parent linked` : ""}.`.replace(/\s+\./, "."),
      table: table(rows, [["Parent", nameOf], ["Children", (p) => p.students || p.children || ""], ["Status", (p) => p.status || ""]], t.listed),
      total: t.parents,
    };
  },
};

const COVERED = Object.keys(BUILDERS);

/**
 * withFacts(name, result, args) -> the result the model sees: { summary_text, table, ...result }
 * (a list is kept under `results`), or the result unchanged when the tool isn't covered, the
 * result is an error or a question back, or its shape isn't one this file knows.
 */
function withFacts(name, result, args) {
  const build = BUILDERS[name];
  if (!build || (!Array.isArray(result) && isError(result))) return result;
  let facts = null;
  try {
    facts = build(result, args || {});
  } catch (error) {
    console.error(`[mira/facts] ${name}: couldn't build the summary`, error.message);
  }
  if (!facts) return result;
  // First, with the server's own totals, so they survive when a long result is cut short for the
  // model (a list of 1,800 parents comes before its totals).
  const head = {
    summary_text: facts.summary_text,
    ...(facts.table ? { table: facts.table } : {}),
    ...(result && typeof result === "object" && !Array.isArray(result) && result.totals ? { totals: result.totals } : {}),
  };
  return Array.isArray(result) ? { ...head, total: facts.total, results: result } : { ...head, ...result };
}

module.exports = { withFacts, COVERED, dayInWords };
