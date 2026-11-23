// Every reply is checked before it reaches the person (services/grounding.js, orchestrator.js):
// figures only from whole values, names only as the records give them, "all"/"none" claims only
// when a lookup found none, and a corrected reply that still fails is replaced by the records.
const test = require("node:test");
const assert = require("node:assert/strict");

const { unsupportedFigures, unsupportedNames, unsupportedClaims, evidenceValues } = require("../services/grounding");
const { unconfirmedReply, recordsTable, screenToolCall } = require("../services/orchestrator");

const RESULT = '{"total":3,"rows":[{"first_name":"Emma","last_name":"Carter","class_id":1004,"class":"Grade 5 - Room 1","rate":84.46},{"name":"Kwame Owusu-Mensah","rate":72}],"date":"2026-10-12T00:00:00Z"}';
const EVIDENCE = [RESULT, "Which Grade 5 students are below 90%?", "The user is Henry Dean, at Alpine Test School."];
const ORDINARY = ["Answer from the records. Offer the parent portal, the report builder, an attendance summary and next steps."];

test("a figure is backed only by a whole value, never a piece of a date or an id", () => {
  assert.deepEqual(unsupportedFigures("**3 students** below 90%: Emma 84.5%, Kwame 72% (since October 12, 2026).", EVIDENCE), []);
  assert.deepEqual(unsupportedFigures("There are 12 students in Grade 5.", EVIDENCE), ["12"], "12 is only the day in 2026-10-12");
  assert.deepEqual(unsupportedFigures("1000 students are enrolled.", EVIDENCE), ["1000"], "nothing is rounded from an id (class_id 1004)");
  assert.deepEqual(unsupportedFigures("| 1004 | Emma Carter |", EVIDENCE), [], "an id may be quoted exactly");
  assert.deepEqual(unsupportedFigures("Call 555-0319 about S146-10 for 2026-2027 (November 1–18).", EVIDENCE), [], "codes and day ranges aren't figures");
  assert.deepEqual(unsupportedFigures("The 2026 term data shows 3 students.", EVIDENCE), [], "a date's year counts");
  assert.deepEqual(unsupportedFigures("School starts at 8:30 on 10/12/2026.", EVIDENCE), [], "times and dates are checked as dates");
  assert.ok(!evidenceValues('{"student_id":4521,"ref":"room_12","uuid":"3f2b1c4d-1a2b-4c3d-8e9f-0a1b2c3d4e5f"}').some((v) => ["4521", "12"].includes(v)));
});

test("names must come from the records, the context or the person's words", () => {
  const good = "### Attendance Summary\n| Student | Class |\n|---|---|\n| Emma Carter | Grade 5 - Room 1 |\n| Kwame Owusu-Mensah | Grade 5 |\n\nAt Alpine Test School. Next Steps: open the Report Builder or the Parent Portal.";
  assert.deepEqual(unsupportedNames(good, EVIDENCE, ORDINARY), []);
  assert.deepEqual(unsupportedNames("Emma Carter and Lucy Bennett are below 90%.", EVIDENCE, ORDINARY), ["Lucy Bennett"]);
  assert.deepEqual(unsupportedNames("Please contact Mrs. Jane Doe about Emma Carter.", EVIDENCE, ORDINARY), ["Jane Doe"]);
  assert.deepEqual(unsupportedNames("Emma Owusu is below 90%.", EVIDENCE, ORDINARY), [], "each word is in the records (a known limit: mixed names pass)");
  assert.deepEqual(unsupportedNames("henry dean asked about emma carter", EVIDENCE, ORDINARY), [], "lower-case words aren't names");
  assert.deepEqual(unsupportedNames("Hi Henry, here is the list.", EVIDENCE, ORDINARY), []);
});

test("'all' and 'none' claims need a lookup that found none", () => {
  assert.deepEqual(unsupportedClaims("Good news: all fees have been paid for Grade 5.", [RESULT]), ["all fees have been paid"]);
  assert.deepEqual(unsupportedClaims("No one is absent today.", [RESULT]), ["No one is absent"]);
  assert.deepEqual(unsupportedClaims("Everyone has returned the permission slip.", []), ["Everyone has returned"]);
  assert.deepEqual(unsupportedClaims("No students are below 90%.", ['{"total":0,"rows":[]}']), []);
  assert.deepEqual(unsupportedClaims("All forms are completed.", ['{"totals":{"studentsWithOutstanding":0}}']), []);
  assert.deepEqual(unsupportedClaims("Each of these 3 students has not paid yet.", [RESULT]), [], "a negative isn't an 'all' claim");
  assert.deepEqual(unsupportedClaims("Not all have returned it.", [RESULT]), []);
});

test("a reply that still fails after correction is replaced by the records and what wasn't confirmed", () => {
  const reply = unconfirmedReply(["the name Lucy Bennett", "the figure 12"], [{ label: "Students below 90%", result: JSON.parse(RESULT) }]);
  assert.match(reply, /exactly what Managira returned for \*\*Students below 90%\*\*/);
  assert.match(reply, /\| first name \| last name \| class \| rate \|/);
  assert.match(reply, /\| Emma \| Carter \| Grade 5 - Room 1 \| 84\.46 \|/);
  assert.match(reply, /\*\*total:\*\* 3/);
  assert.doesNotMatch(reply, /1004/, "ids aren't shown");
  assert.match(reply, /Left out because your school's records don't confirm them: the name Lucy Bennett; the figure 12/);
  assert.doesNotMatch(reply.split("_Left out")[0], /Lucy Bennett/, "the unbacked name isn't stated as fact");
  const nothing = unconfirmedReply(["the figure 1,250"], []);
  assert.match(nothing, /haven't given it \(not confirmed: the figure 1,250\)/);
});

test("the records table shows at most 25 rows and says so", () => {
  const rows = Array.from({ length: 40 }, (_, i) => ({ name: `Student ${i}`, rate: 80 + (i % 10) }));
  const table = recordsTable({ total: 40, rows });
  assert.equal(table.split("\n").filter((l) => l.startsWith("| Student")).length, 25);
  assert.match(table, /Showing 25 of the 40 rows/);
});

test("a tool the person can't use is refused first, and never recorded or counted", () => {
  const made = new Set();
  const schema = { type: "object", properties: { studentId: { type: "number" } }, required: ["studentId"] };
  const refused = screenToolCall({ name: "get_fees", args: {} }, made, null, "You don't have access to fees.");
  assert.deepEqual(refused, { refuse: "You don't have access to fees." });
  assert.equal(made.size, 0);
  assert.deepEqual(screenToolCall({ name: "get_fees", args: { studentId: 5 } }, made, schema), { args: { studentId: 5 } });
  assert.equal(made.size, 1);
});

test("a zero backs only a claim about the same thing", () => {
  const invites = '{"totals":{"parents":1801,"accepted":1801,"not_accepted":0,"no_login":0}}';
  const fees = '{"question":"Students who owe fees","totals":{"owing":0},"students":[]}';
  const attendance = '{"status":"done","question":"Students below 90% attendance","total":0,"students":[]}';
  const forms = '{"totals":{"formsAsked":3,"studentsWithOutstanding":0}}';
  const classes = '{"summary_text":"No class matching \\"Grade 9\\"","total":0,"results":[]}';

  assert.deepEqual(unsupportedClaims("All fees are paid.", [invites]), ["All fees are paid"], "no_login: 0 is about logins, not fees");
  assert.deepEqual(unsupportedClaims("All fees are paid.", [classes]), ["All fees are paid"], "an empty class lookup isn't about fees");
  assert.deepEqual(unsupportedClaims("All fees are paid.", [fees]), []);
  assert.deepEqual(unsupportedClaims("No one is absent.", [fees]), ["No one is absent"], "a fees zero isn't about attendance");
  assert.deepEqual(unsupportedClaims("No students are below 90% attendance.", [attendance]), []);
  assert.deepEqual(unsupportedClaims("Everyone has returned the permission slip.", [attendance]), ["Everyone has returned"]);
  assert.deepEqual(unsupportedClaims("Everyone has returned the permission slip.", [forms]), []);
  assert.deepEqual(unsupportedClaims("All parents have accepted their invitations.", [invites]), []);
  assert.deepEqual(unsupportedClaims("All parents have accepted their invitations.", [fees]), ["All parents have accepted"]);
  assert.deepEqual(unsupportedClaims("All fees are paid and no one is absent.", [fees]), ["no one is absent"], "each claim needs its own zero");
});
