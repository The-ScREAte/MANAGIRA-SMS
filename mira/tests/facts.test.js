// Code writes the facts for the most-used lookups (services/facts.js), and only real records
// back a reply - never Mira's own earlier replies (orchestrator.js historyEvidence).
const test = require("node:test");
const assert = require("node:assert/strict");

const { withFacts, COVERED, dayInWords } = require("../services/facts");
const { historyEvidence } = require("../services/orchestrator");
const { unsupportedNames, unsupportedFigures, wrongWeekdays } = require("../services/grounding");

// Shapes as the local copy returned them (2026-11-22).
const CLASSES = [
  { class_id: 1004, class_name: "Grade 5 - Room 1", student_count: 30 },
  { class_id: 1016, class_name: "Grade 5 - Room 2", student_count: 28 },
];

test("the ten most-used lookups are covered", () => {
  assert.deepEqual(COVERED.sort(), ["find_low_attendance", "find_student", "find_students", "get_calendar", "get_class", "get_class_readiness", "list_activities", "list_events", "list_family_invitations", "list_students"]);
});

test("get_class: exact totals worked out in code, a table, and the list kept", () => {
  const seen = withFacts("get_class", CLASSES, { query: "Grade 5" });
  assert.equal(seen.summary_text, '2 classes matching "Grade 5": Grade 5 - Room 1 (30 students), Grade 5 - Room 2 (28 students). 58 students in all.');
  assert.match(seen.table, /\| Class \| Students \|\n\| --- \| --- \|\n\| Grade 5 - Room 1 \| 30 \|/);
  assert.deepEqual(seen.results, CLASSES);
  assert.deepEqual(Object.keys(seen).slice(0, 2), ["summary_text", "table"], "first, so they survive a cut");
  assert.equal(withFacts("get_class", [], { query: "Grade 9" }).summary_text, 'No class matching "Grade 9" in this school.');
});

test("totals come from the server, and a list cut short is never counted", () => {
  const students = Array.from({ length: 30 }, (_, i) => ({ student: `Student ${i}`, class: "Grade 2 - Room 1", attendancePercent: 92, absent: "4" }));
  const seen = withFacts("find_low_attendance", { status: "done", term: "Fall Semester 2026-2027 (current term)", classes: "every class you can see", total: 1000, students, note: "All 1000 matching students. Only the first 1,000 students were checked; narrow it to a class for a complete answer. Attendance %..." }, { below: 95 });
  assert.match(seen.summary_text, /^1,000 students below 95% attendance - every class you can see, Fall Semester 2026-2027 \(current term\)\. Only the first 1,000 students were checked; narrow it to a class for a complete answer\.$/);
  assert.match(seen.table, /Showing 25 of 1,000\./);

  const invites = withFacts("list_family_invitations", { ok: true, data: { parents: [] }, totals: { parents: 1801, accepted: 1801, not_accepted: 0, no_login: 0, setup_pending: 0, listed: 0, students_in_scope: 2400, students_with_no_parent_linked: 0 }, scope: { classes: "every class (current students)" }, truncated: false });
  assert.equal(invites.summary_text, "1,801 of 1,801 parents have accepted their invitation; 0 haven't. 2,400 students in scope (every class (current students)).");

  const roster = withFacts("list_students", { counts: { total: 30, active: 30, graduated: 0, byClass: [{ name: "Grade 5 - Room 1", count: 30 }], byGender: [{ name: "Male", count: 15 }, { name: "Female", count: 15 }] }, students: [{ name: "Xavier Baker", className: "Grade 5 - Room 1", gender: "Male", studentId: 10142 }] });
  assert.equal(roster.summary_text, "30 students (30 active) in Grade 5 - Room 1; 15 male, 15 female.");
  assert.doesNotMatch(roster.table, /10142/, "ids stay out of the table");

  const filtered = withFacts("get_class_readiness", { ok: true, data: [], totals: { classes: 80, ready_to_post: 0, with_missing_scores: 80, with_report_cards_not_posted: 80, all_posted: 0, listed: 0 }, truncated: false });
  assert.equal(filtered.summary_text, "80 classes: 0 ready to post (every score entered), 80 still missing scores, 80 with report cards not all posted, 0 with every report card posted.");
  const long = withFacts("list_family_invitations", { ok: true, data: { parents: Array.from({ length: 900 }, (_, i) => ({ name: `Parent ${i}`, status: "Active" })) }, totals: { parents: 1801, accepted: 1801, not_accepted: 0, listed: 1801 } });
  assert.ok(JSON.stringify(long).slice(0, 3000).includes('"not_accepted":0'), "totals come before the long list");
  const cut = withFacts("get_class_readiness", { ok: true, data: [{ class: "6th Grade", students: 30, report_cards_posted: 0, report_cards_not_posted: 30, scores_missing: 239, ready_to_post: false, main_teacher: "Brian Sullivan" }], truncated: true });
  assert.match(cut.summary_text, /cut short, so these aren't totals/);
});

test("dates are written with their real weekday", () => {
  assert.equal(dayInWords("2026-11-22"), "Sunday, November 22, 2026");
  const cal = withFacts("get_calendar", { ok: true, data: [], totals: { items: 0, by_kind: {}, days_off: 0 }, scope: { scope: "school", from: "2026-11-22", to: "2026-12-05" }, truncated: false });
  assert.equal(cal.summary_text, "Nothing on the school calendar from Sunday, November 22, 2026 to Saturday, December 5, 2026.");
  assert.deepEqual(wrongWeekdays(cal.summary_text), []);
});

test("errors, questions back and unknown tools are left as they are", () => {
  const off = { ok: false, error_code: "PLAN_FEATURE_OFF", error_message: "Transportation is turned off." };
  assert.equal(withFacts("find_students", off), off);
  const ask = { status: "needs_info", message: "Which term?" };
  assert.equal(withFacts("find_low_attendance", ask), ask);
  assert.deepEqual(withFacts("get_term", [{ term_name: "Fall" }]), [{ term_name: "Fall" }]);
});

test("the summary backs the reply, so code's figures pass the check", () => {
  const seen = withFacts("get_class", CLASSES, { query: "Grade 5" });
  assert.deepEqual(unsupportedFigures("**58 students** in 2 Grade 5 classes.", [JSON.stringify(seen)]), []);
});

test("Mira's own earlier reply never backs a name or figure in the next one", () => {
  const history = [
    { role: "user", content: "Who is in the choir?" },
    { role: "assistant", content: null, toolCalls: [{ id: "a", name: "find_student", args: { query: "Lucy Bennett" } }] },
    { role: "tool_results", results: [{ toolCallId: "a", content: '[{"name":"Emma Carter","class_name":"Grade 5 - Room 1"}]' }] },
    { role: "assistant", content: "Emma Carter and Lucy Bennett sing in the choir, 14 students in all." },
  ];
  const evidence = ["Tell me more about them.", ...historyEvidence(history)];
  assert.ok(evidence.some((e) => e.includes("Emma Carter")), "lookups replayed with the history count");
  assert.ok(!evidence.some((e) => e.includes("Lucy Bennett")), "neither Mira's reply nor the details it searched with");
  assert.deepEqual(unsupportedNames("Lucy Bennett is in Grade 5.", evidence, []), ["Lucy Bennett"]);
  assert.deepEqual(unsupportedNames("Emma Carter is in Grade 5 - Room 1.", evidence, []), []);
  assert.deepEqual(unsupportedFigures("There are 14 students.", evidence), ["14"]);
});
