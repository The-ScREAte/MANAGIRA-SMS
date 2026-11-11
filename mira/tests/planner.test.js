// Understanding and planning a message, the Enhance button, and steps in plain words.
const test = require("node:test");
const assert = require("node:assert/strict");
const { needsPlan, parsePlan, planForModel, planTurn, enhanceDraft, cleanEnhanced, tidyDraft, toolStepLabel } = require("../services/planner");

test("quick replies need no plan; requests do", () => {
  for (const text of ["yes", "Yes please", "ok", "go ahead", "thanks!", "the first one", "Hi", "both"]) assert.equal(needsPlan(text), false, text);
  for (const text of ["who is absent today in grade 5", "draft a reminder to parents about fees", "how do I add a teacher"]) assert.equal(needsPlan(text), true, text);
  // An attachment with a question still gets a plan; the attachment alone is no question.
  assert.equal(needsPlan("[Attached file: list.csv]\n\nname,class\n\n---\n\ncheck this list against our students"), true);
  assert.equal(needsPlan("[Attached file: list.csv]\n\nname,class"), false);
});

test("a plan is one sentence and up to five short steps, or nothing", () => {
  const plan = parsePlan('Here you go: {"understanding": "You want  this term\'s attendance for Grade 5.", "steps": ["1. Find Grade 5", "Check attendance", "", "List anyone below 80%", "a", "b", "c"]}');
  assert.equal(plan.understanding, "You want this term's attendance for Grade 5.");
  assert.deepEqual(plan.steps, ["Find Grade 5", "Check attendance", "List anyone below 80%", "a", "b"]);
  assert.equal(parsePlan("no json here"), null);
  assert.equal(parsePlan('{"steps": ["x"]}'), null);
  assert.equal(parsePlan("{not json}"), null);
});

test("Mira is told its plan, and that the message and the tools come first", () => {
  const text = planForModel({ understanding: "You want X.", steps: ["Find it", "Show it"] });
  assert.match(text, /You want X\. Steps: 1\. Find it\. 2\. Show it\. Work through it/);
  assert.match(text, /follow the message/);
  assert.match(text, /the tool results and help guides are the facts/);
  assert.equal(planForModel(null), null);
});

test("without a model the plan and Enhance still work", async () => {
  const plan = await planTurn({ userText: "list my students in grade 5" });
  assert.match(plan.understanding, /list my students in grade 5/);
  assert.equal(await planTurn({ userText: "thanks" }), null);
  const enhanced = await enhanceDraft({ draft: "how many students   are absent today" });
  assert.deepEqual(enhanced, { text: "How many students are absent today?", changed: true });
  assert.deepEqual(await enhanceDraft({ draft: "   " }), { text: "", changed: false });
});

test("an enhanced draft loses labels and quotes, and a runaway answer is refused", () => {
  assert.equal(cleanEnhanced('Improved message: "Show me Grade 5\'s attendance this term."', "attendance g5"), "Show me Grade 5's attendance this term.");
  assert.equal(cleanEnhanced("```\nList unpaid fees.\n```", "fees"), "List unpaid fees.");
  assert.equal(cleanEnhanced("", "x"), null);
  assert.equal(cleanEnhanced("x".repeat(5000), "short"), null);
  assert.equal(tidyDraft("send reminder to parents"), "Send reminder to parents.");
  assert.equal(tidyDraft("can i see fees"), "Can I see fees?");
});

test("each step is said in plain words, with what it's about", () => {
  assert.equal(toolStepLabel("get_attendance", {}), "Checking attendance");
  assert.equal(toolStepLabel("find_student", { query: "Ama Mensah" }), "Finding the student: Ama Mensah");
  assert.equal(toolStepLabel("create_event", {}), "Adding the event");
  assert.equal(toolStepLabel("rename_class", {}), "Getting the change ready");
  assert.equal(toolStepLabel("list_transport_routes", {}), "Checking transport routes");
  assert.equal(toolStepLabel("delete_test", {}), "Checking what this would change");
  assert.equal(toolStepLabel("something_new", null), "Looking it up");
});

test("an answer's dates and weekdays are checked against what the tools gave", () => {
  const { unsupportedDates, wrongWeekdays } = require("../services/grounding");
  const evidence = [JSON.stringify([{ name: "Dante", date_of_birth: "2011-05-09" }, { name: "Rosa", date_of_birth: "2011-11-05" }]), "Today is Wednesday, November 11, 2026."];
  assert.deepEqual(unsupportedDates("Rosa: November 5. Dante: November 9.", evidence), ["November 9"]);
  assert.deepEqual(unsupportedDates("Dante was born on 9 May 2011; today is November 11.", evidence), []);
  const today = new Date("2026-11-11T12:00:00Z");
  assert.deepEqual(wrongWeekdays("Tuesday, November 18, 2026", today), ['"Tuesday, November 18, 2026" (that date is a Wednesday)']);
  assert.deepEqual(wrongWeekdays("Wednesday, Nov 18 and Fri 13 November", today), []);
});
