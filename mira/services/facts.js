// Code writes the facts: for Mira's most-used lookups, the result the model sees starts with
// `summary_text` (one sentence with the exact totals) and `table` (a Markdown table of the rows),
// both built here from the tool's own result - so the model never counts a list, adds up
// classes or works out a total itself. The system prompt tells it to use them as written.
//
// Totals come from the server's own totals where it gives them; a list's length is used as a
// count only when the list is complete (not cut short). A result that's an error or a question
// back (needs_info) is left as it is. The ten tools covered are the most-used read tools in the
// local copy's mira_tool_call_log (2026-11-22).

// Lists are given in full up to 100 rows (pages show fewer, for speed; Mira can show the whole list).
const TABLE_ROWS = 100;
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
    if (result && result.truncated && Array.isArray(result.classes)) {
      return {
        summary_text: `${plural(result.total_classes, "class", "classes")} in all; the list shows the first ${result.classes.length}, so the student total isn't given here.`,
        table: table(result.classes, [["Class", (c) => c.class_name], ["Students", (c) => c.student_count]], result.total_classes),
        total: result.total_classes,
      };
    }
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
    if (result && result.truncated && Array.isArray(result.students)) {
      return {
        summary_text: `${plural(result.total_matches, "student")} match "${args.query}"; the first ${result.students.length} are listed. Ask for a class or the full name to narrow it.`,
        table: table(result.students, [["Student", nameOf], ["Class", classOf]], result.total_matches),
        total: result.total_matches,
      };
    }
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
    const scope = result.scope || {};
    const each = Array.isArray(scope.each_condition) ? scope.each_condition : [];
    const conditions = each.length
      ? each.map((c) => `${c.condition}: ${c.students}${c.from ? ` (${dayInWords(c.from)} to ${dayInWords(c.to)}${typeof c.school_days === "number" ? `, ${plural(c.school_days, "school day")}${typeof c.days_marked === "number" ? `, attendance taken on ${c.days_marked}` : ""}` : ""})` : ""}`)
      : Object.entries(totals).filter(([key, v]) => key !== "matched" && typeof v === "number").map(([key, v]) => `${key.replace(/_/g, " ")}: ${v}`);
    const classes = Array.isArray(scope.classes) ? scope.classes : [];
    return {
      summary_text: `${plural(matched, "student")} ${matched === 1 ? "matches" : "match"} all of the conditions${classes.length ? ` in ${classes.length > 4 ? plural(classes.length, "class", "classes") : classes.join(", ")}` : ""}${typeof totals.students_in_scope === "number" ? ` (${plural(totals.students_in_scope, "student")} checked)` : ""}${conditions.length ? `. Each condition on its own - ${conditions.join("; ")}` : ""}.`,
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

// ── The next ten (2026-11-23): terms, birthdays, a student's attendance and fees, forms, staff,
// Report Builder, overdue balances, sent messages and subjects ──
const n = (v) => Number(v || 0).toLocaleString("en-US");
const range = (from, to) => `${dayInWords(from)} to ${dayInWords(to)}`;
Object.assign(BUILDERS, {
  get_term(result) {
    if (!Array.isArray(result)) return null;
    if (!result.length) return { summary_text: "No terms are set up for this school yet.", table: "", total: 0 };
    const current = result.find((t) => t.current || t.current_term);
    const others = result.filter((t) => t !== current);
    return {
      summary_text: `${current ? `Current term: ${current.term_name} ${current.year_label || ""}, ${range(current.start_date, current.end_date)}.` : "No term is marked current."}${others.length ? ` Other terms: ${others.map((t) => `${t.term_name} ${t.year_label || ""} (${range(t.start_date, t.end_date)})`.replace(/\s+\(/, " (")).join("; ")}.` : ""}`.replace(/\s+,/g, ","),
      table: table(result, [["Term", (t) => t.term_name], ["School year", (t) => t.year_label], ["Starts", (t) => dayInWords(t.start_date)], ["Ends", (t) => dayInWords(t.end_date)], ["Current", (t) => (t.current || t.current_term ? "Yes" : "")]]),
      total: result.length,
    };
  },
  get_upcoming_birthdays(result) {
    const rows = Array.isArray(result.birthdays) ? result.birthdays : null;
    if (!rows) return null;
    const today = rows.filter((b) => b.isToday);
    return {
      summary_text: `${rows.length ? plural(rows.length, "birthday") : "No birthdays"} in the next ${plural(result.windowDays || 7, "day")} (${result.scope || "this school"})${today.length ? `; ${today.length} today: ${namesList(today, (b) => b.name)}` : ""}.`,
      table: table(rows, [["Name", (b) => b.name], ["Class or role", (b) => b.roleOrClass], ["Birthday", (b) => b.nextBirthdayLabel], ["Turning", (b) => b.turningAge], ["When", (b) => b.timingLabel]]),
      total: rows.length,
    };
  },
  get_attendance(result) {
    if (!result.student || !Array.isArray(result.summary)) return null;
    const count = (status) => (result.summary.find((x) => String(x.status).toLowerCase() === status) || {}).count || 0;
    const marked = result.summary.reduce((sum, x) => sum + Number(x.count || 0), 0);
    return {
      summary_text: `${nameOf(result.student)}, ${result.covers || "recent days"}: ${marked ? `${n(count("present"))} present, ${n(count("absent"))} absent${count("late") ? `, ${n(count("late"))} late` : ""} of ${plural(marked, "day")} marked` : "no attendance marked"}.`,
      table: table((result.records || []).slice().reverse(), [["Date", (r) => dayInWords(r.date)], ["Status", (r) => r.status]]),
      total: marked,
    };
  },
  get_form_requests(result) {
    const t = result.totals;
    if (!t || typeof t.studentsInScope !== "number") return null;
    const classes = result.scope && Array.isArray(result.scope.classes) ? result.scope.classes : [];
    const where = classes.length === 1 ? classes[0] : `${plural(classes.length, "class", "classes")}`;
    const forms = Array.isArray(result.by_form) ? result.by_form : [];
    return {
      summary_text: !t.formsAsked
        ? `No live form has been asked of families in ${where}.`
        : `${n(t.studentsWithOutstanding)} of ${plural(t.studentsInScope, "student")} in ${where} have a form outstanding (${plural(t.formsOutstanding, "form")} outstanding in all${t.overdueOutstanding ? `, ${n(t.overdueOutstanding)} overdue` : ""}); ${n(t.studentsAllDone)} have completed every form asked of them.`,
      table: table(forms, [["Form", (f) => f.title || f.form], ["Outstanding", (f) => f.outstanding], ["Completed", (f) => f.completed], ["Due", (f) => (f.dueDate ? dayInWords(f.dueDate) : "")]]),
      total: t.studentsWithOutstanding,
    };
  },
  list_employees(result) {
    if (typeof result.total !== "number" || !Array.isArray(result.employees)) return null;
    const roles = Object.entries(result.byRole || {}).sort((a, b) => b[1] - a[1]).map(([role, count]) => plural(count, role));
    return {
      summary_text: `${plural(result.total, "staff member")}${roles.length ? `: ${roles.join(", ")}` : ""}.`,
      table: table(result.employees, [["Name", (e) => e.name], ["Role", (e) => e.role], ["Classes", (e) => (Array.isArray(e.classNames) ? e.classNames.length : "")], ["Status", (e) => (e.onHold ? "On hold" : e.pendingSetup ? "Setup pending" : "Active")]], result.total),
      total: result.total,
    };
  },
  get_fees(result) {
    if (!result.student || !result.totals) return null;
    const payments = Array.isArray(result.payments) ? result.payments : [];
    return {
      summary_text: `${nameOf(result.student)}: ${n(result.totals.total_paid)} paid${Number(result.totals.total_refunded) ? ` and ${n(result.totals.total_refunded)} refunded` : ""}, in ${plural(payments.length, "payment")} recorded${payments.length >= 20 ? " (the 20 most recent are listed; the totals cover all of them)" : ""}. This is what was paid, not what is owed (the overdue balances list shows what is still owed).`,
      table: table(payments, [["Date", (pmt) => dayInWords(pmt.received_at || pmt.occurrence_date)], ["Amount", (pmt) => pmt.amount], ["Method", (pmt) => pmt.method], ["Refund", (pmt) => (pmt.is_refund ? "Yes" : "")]]),
      total: payments.length,
    };
  },
  run_report(result) {
    if (typeof result.total !== "number" || !Array.isArray(result.rows)) return null;
    const columns = (result.columns || Object.keys(result.rows[0] || {})).slice(0, 6);
    const filters = Array.isArray(result.filtersApplied) ? result.filtersApplied.join("; ") : "";
    return {
      summary_text: `${plural(result.total, "row")} in "${result.report}"${filters ? ` (${filters})` : ""}${result.rows.length < result.total ? `; this page shows ${result.rows.length}` : ""}.`,
      table: table(result.rows, columns.map((c) => [c, (row) => row[c]]), result.total),
      total: result.total,
    };
  },
  get_overdue_balances(result) {
    const t = result.totals;
    if (!t || typeof t.studentsOwing !== "number") return null;
    const rows = Array.isArray(result.data) ? result.data : [];
    const scope = result.scope || {};
    const period = scope.period ? `${scope.period.term || ""} ${scope.period.schoolYear || ""}`.trim() : "";
    return {
      summary_text: t.studentsOwing
        ? `${plural(t.studentsOwing, "student")} owe ${t.totalOwedText || n(t.totalOwed)} in all (${scope.classes || "every class"}${period ? `, ${period}` : ""})${t.owedWithNothingPaidText ? `; ${t.owedWithNothingPaidText} of it with nothing paid` : ""}${typeof t.thirtyPlusDaysLate === "number" ? `; ${n(t.thirtyPlusDaysLate)} of them 30+ days late` : ""}.`
        : `No student owes anything (${scope.classes || "every class"}${period ? `, ${period}` : ""}).`,
      table: table(rows, [["Student", (r) => r.student], ["Class", (r) => r.class], ["Owed", (r) => r.owedText || r.owed], ["Status", (r) => r.status], ["Parent", (r) => r.parent]], t.studentsOwing),
      total: t.studentsOwing,
    };
  },
  list_sent_messages(result) {
    const rows = Array.isArray(result.messages) ? result.messages : null;
    if (!rows) return null;
    const by = (status) => rows.filter((m) => m.status === status).length;
    return {
      summary_text: rows.length
        ? `The ${plural(rows.length, "most recent message")}${result.onlyYourOwnSends ? " you sent" : ""} (a list, not a total): ${by("sent")} sent, ${by("failed")} failed, ${by("pending")} pending.`
        : `No messages${result.onlyYourOwnSends ? " sent by you" : ""} in the Mailroom's history.`,
      table: table(rows, [["When", (m) => dayInWords(m.at)], ["To", (m) => m.to], ["Channel", (m) => m.channel], ["Status", (m) => m.status], ["Message", (m) => m.subject || m.message]]),
      total: rows.length,
    };
  },
  list_student_remarks(result) {
    if (!result.totals || !Array.isArray(result.students)) return null;
    const t = result.totals;
    return {
      summary_text: `${result.class}, ${result.term}${result.schoolYear ? ` ${result.schoolYear}` : ""}: ${plural(t.students, "student")}; ${n(t.withATeacherRemark)} have a teacher remark, ${n(t.withNoRemarks)} have no remarks at all.`,
      table: table(result.students, [["Student", (s) => s.student], ["Teacher", (s) => s.teacher], ["Conduct", (s) => s.conduct], ["Attitude", (s) => s.attitude], ["Interest", (s) => s.interest]], t.students),
      total: t.students,
    };
  },
  list_report_signatures(result) {
    const rows = Array.isArray(result.signatures) ? result.signatures : null;
    if (!rows) return null;
    return {
      summary_text: rows.length ? `${plural(rows.length, "uploaded signature")}: ${rows.map((s) => `${s.label}${s.obsolete ? " (obsolete)" : ""} on ${s.classes.length ? plural(s.classes.length, "class", "classes") : "no classes"}`).join("; ")}.` : "No report-card signature has been uploaded yet (Report Settings).",
      table: table(rows, [["Signature", (s) => s.label], ["Classes", (s) => s.classes.join(", ") || "(none)"], ["Obsolete", (s) => (s.obsolete ? "Yes" : "")]]),
      total: rows.length,
    };
  },
  list_subjects(result) {
    if (!Array.isArray(result)) return null;
    return {
      summary_text: result.length ? `${plural(result.length, "subject")}: ${namesList(result, (x) => `${x.subject_name} (${plural((x.assigned_classes || []).length, "class", "classes")})`)}.` : "No subjects are set up yet.",
      table: table(result, [["Subject", (x) => x.subject_name], ["Classes", (x) => (x.assigned_classes || []).length]]),
      total: result.length,
    };
  },
});

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
