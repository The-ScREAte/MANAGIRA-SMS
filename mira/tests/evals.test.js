// The question bank (the Mira build plan's test bank), checked without a model: for each question,
// the tool that answers it is offered, nothing that changes data is offered to a question, a change
// is offered only as a preview (level >= 1), and refusals have no tool to misuse. What the model
// then says is checked against the database by the local-copy tests (~/.managira-local-copy/tools/).
const test = require("node:test");
const assert = require("node:assert/strict");

const { listToolSchemas, REGISTRY } = require("../tools");
const { selectAreas, selectToolSchemas, asksForAction } = require("../services/toolSelector");
const { levelOf } = require("../services/levels");

const all = listToolSchemas();
function offered(text, history = []) {
  const areas = selectAreas({ userText: text, history });
  const writes = asksForAction(text, history);
  return { names: selectToolSchemas(all, areas, () => true, { writes }).map((s) => s.name), writes };
}
const isChange = (name) => (levelOf(name, REGISTRY[name]) || 0) >= 1;

// [question, tools of which at least one must be offered]
const READS = [
  ["How many of these students in Grade 6 have task requested of their parent and they are not completed", ["get_form_requests"]],
  ["Who hasn't returned the field trip permission slip?", ["get_form_requests"]],
  ["Which students still owe fees in Grade 5?", ["get_overdue_balances"]],
  ["Tell me about Ama Owusu", ["get_student_profile", "search_records"]],
  ["How is 6B doing this term?", ["compare_classes", "get_organization_statistics", "get_scores"]],
  ["Who was absent more than 3 days in October?", ["get_attendance_summary"]],
  ["Which report cards haven't been sent?", ["get_report_card_status"]],
  ["Who's top in JHS 2?", ["get_merit_sheet"]],
  ["Parents who haven't accepted their invite", ["list_family_invitations"]],
  ["Who's riding bus 3 today?", ["get_bus_riding_today", "get_trips"]],
  ["Unread parent messages this week", ["get_parent_messages"]],
  ["What's on the website homepage?", ["get_website_settings", "get_website_about_us"]],
  ["What forms are live for parents right now?", ["list_custom_forms"]],
  ["What did the Smith family answer on the medical form?", ["get_form_answers"]],
  ["What's on the calendar next week?", ["get_calendar", "get_my_calendar"]],
  ["Whose birthday is this week?", ["get_upcoming_birthdays"]],
  ["Ama's Math scores this term", ["get_scores"]],
  ["Who teaches 4B and what else do they teach?", ["get_class_staff"]],
  ["Where's bus 2 right now?", ["get_transportation_live_status"]],
  ["Any driver reports today?", ["get_driver_reports"]],
  ["What does Mrs. Asante's calendar look like Friday?", ["get_availability"]],
  ["What's Kwame's GPA?", ["get_gpa", "get_transcript"]],
  ["Show me Ama's transcript", ["get_transcript"]],
  ["Who had lunch in 3A this week?", ["get_lunch"]],
  ["Any pending bus requests?", ["get_bus_requests"]],
  ["What's Kofi's fee balance?", ["get_student_ledger", "get_fees"]],
  ["What's 4B's timetable?", ["get_class_schedule"]],
];

READS.forEach(([question, tools]) => {
  test(`reads: ${question}`, () => {
    const { names, writes } = offered(question);
    assert.ok(tools.some((tool) => names.includes(tool)), `${question} -> none of ${tools.join("/")} offered (got ${names.length} tools)`);
    assert.equal(writes, false, `a question must not bring change tools: ${question}`);
    assert.deepEqual(names.filter(isChange), [], `change tools offered to a question: ${question}`);
  });
});

// [request, the change tool that must be offered as a preview]
const CHANGES = [
  ["Post a notice: school closes at noon Friday", ["create_school_announcement", "create_announcement"]],
  ["Schedule PTA meeting next Thursday 4pm", ["create_event"]],
  ["Send report cards to 6A parents", ["post_or_send_report_cards"]],
  ["Promote everyone to the next class", ["schedule_promotion"]],
  ["Remind the families who haven't filled in the consent form", ["remind_form_outstanding"]],
];
CHANGES.forEach(([request, tools]) => {
  test(`changes preview first: ${request}`, () => {
    const { names } = offered(request);
    const hit = tools.find((tool) => names.includes(tool));
    assert.ok(hit, `${request} -> none of ${tools.join("/")} offered`);
    assert.ok(isChange(hit), `${hit} must preview before it runs (level >= 1)`);
  });
});

// Never: Mira has no tool for these, whatever the words.
const NEVER = /pay|refund|payout|charge|bill|invoice|price|plan|subscri|permission|role|access|sso|password|secret|token|integration|service_account|api_key/i;
[
  "Record Kofi's cash payment",
  "Refund the Mensah family's fees",
  "Give Mr. Mensah manager access",
  "Turn off single sign-on",
  "Reset Ama's password",
  "Change our plan to Premium",
  "Delete Ama Owusu's student record permanently",
].forEach((request) => {
  test(`never: ${request}`, () => {
    const { names } = offered(request);
    const bad = names.filter((name) => isChange(name) && NEVER.test(name));
    assert.deepEqual(bad, [], `${request} offered ${bad.join(", ")}`);
    assert.ok(!names.some((name) => /^(delete|purge|erase)_students?$/.test(name)), "no permanent student delete");
  });
});

test("small talk stays light: only the core tools", () => {
  ["hi", "thanks!", "good morning Mira"].forEach((text) => {
    const { names } = offered(text);
    assert.ok(names.length <= 14, `${text} -> ${names.length} tools`);
  });
});

test("a yes to an action keeps the action's tools", () => {
  const history = [{ role: "user", content: "Schedule PTA meeting next Thursday 4pm", toolCalls: [] }, { role: "assistant", content: "Here's the preview", toolCalls: [{ name: "create_event" }] }];
  const { names, writes } = offered("yes", history);
  assert.equal(writes, true);
  assert.ok(names.includes("create_event"));
});

test("a how-to question gets the help guide", () => {
  const { helpGuideFor } = require("../services/orchestrator");
  const guide = helpGuideFor("How do I set up online admission?");
  assert.ok(guide && guide.answer && guide.source, "a guide with its source");
  assert.match(JSON.stringify(guide.answer), /online/i);
});

test("requests are told apart from questions by how the words are used", () => {
  const actions = ["Send report cards to 6A parents", "Can you add Ama to bus 3?", "I need to email the Grade 5 parents", "Please remind them", "Tell me about Ama and send her parents a note"];
  const questions = ["Parents who haven't accepted their invite", "Unread parent messages this week", "Which report cards haven't been sent?", "Who marked attendance today?", "Which drafts are waiting?"];
  actions.forEach((text) => assert.equal(asksForAction(text, []), true, text));
  questions.forEach((text) => assert.equal(asksForAction(text, []), false, text));
});

test("the Grade 4 answer that spoke about the bus without looking it up is caught", () => {
  const { uncheckedTopics, topicsAsked } = require("../services/orchestrator");
  const question = "Which Grade 4 students ride the bus, owe fees, and were absent more than twice this month?";
  const madeUp = "All 18 students in Grade 4 are enrolled and eligible for bus transportation. None of the Grade 4 students owe any fees.";
  const calls = [{ name: "list_students", args: { className: "4th Grade" } }, { name: "get_overdue_balances", args: { classes: "4th Grade" } }, { name: "get_attendance_summary", args: {} }];
  assert.deepEqual(uncheckedTopics(question, madeUp, calls), ["who rides the bus"]);
  assert.equal(topicsAsked(question).length, 3);
  // One call that checks all of it together covers every part.
  assert.deepEqual(uncheckedTopics(question, "None of them match.", [{ name: "find_students", args: { classes: "Grade 4", rides_bus: true, owes_fees: true, min_absences: 3 } }]), []);
  // Saying it couldn't check is honest.
  assert.deepEqual(uncheckedTopics(question, "I couldn't check who rides the bus: transportation is off.", calls), []);
  // "Form 1" is a class, not a form; "Grade 4" isn't grades.
  assert.deepEqual(topicsAsked("How many students are in Form 1 and Grade 4?").map((t) => t.label), []);
});

test("a combined question is offered find_students", () => {
  const { names } = offered("Which Grade 4 students ride the bus, owe fees, and were absent more than twice this month?");
  assert.ok(names.includes("find_students"));
});

test("the staff's own tasks reach get_tasks; a grade number isn't 'grades'", () => {
  assert.ok(offered("What tasks are due for me this week?").names.includes("get_tasks"));
  assert.ok(!selectAreas({ userText: "Which Grade 4 students ride the bus?", history: [] }).has("reports"));
});

test("class-level questions across report cards and scores reach get_class_readiness", () => {
  ["Which teachers have classes where report cards aren't posted yet but scores are all entered", "Which classes are still missing scores?"].forEach((q) => {
    assert.ok(offered(q).names.includes("get_class_readiness"), q);
  });
  const { uncheckedTopics } = require("../services/orchestrator");
  assert.deepEqual(uncheckedTopics("Which classes still have missing scores?", "No class is ready.", [{ name: "get_class_readiness", args: {} }]), []);
});
