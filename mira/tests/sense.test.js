// Making sense of vague requests (services/requestSense.js), from the PTA meeting that Mira made a
// whole-school activity at 6 PM with an invented agenda, without checking the events calendar.
const test = require("node:test");
const assert = require("node:assert/strict");
const sense = require("../services/requestSense");

const PTA = "Schedule a PTA meeting the first Thursday after midterm that doesn’t clash with any event";

test("a meeting with no kind named: Mira asks where it goes, whatever tool it picked", () => {
  ["create_activity", "create_event", "create_school_announcement", "add_to_my_calendar"].forEach((tool) => {
    const r = sense.whereItGoes(tool, PTA, []);
    assert.equal(r && r.status, "needs_choice", tool);
    assert.match(r.ask, /School event[\s\S]*Announcement[\s\S]*Activity[\s\S]*Just your calendar/);
  });
});

test("the person's words (now or in a reply) decide the kind; a wrong pick is turned back", () => {
  assert.equal(sense.whereItGoes("create_event", "Add a PTA meeting event on Dec 3", []), null);
  assert.equal(sense.whereItGoes("create_event", "as a school event", [{ role: "user", content: PTA }]), null);
  assert.equal(sense.whereItGoes("create_activity", "Plan a field trip for 5A on Friday", []), null);
  assert.equal(sense.whereItGoes("create_school_announcement", "Post a notice: school closes at noon Friday", []), null);
  assert.equal(sense.whereItGoes("add_to_my_calendar", "Remind me to call the bus company tomorrow", []), null);
  assert.match(sense.whereItGoes("create_activity", "Add a staff meeting event on Friday", []).ask, /asked for school event/);
});

test("invented times and agendas are refused; given ones pass", () => {
  const args = { title: "PTA Meeting", date: "2026-12-03", startTime: "18:00", endTime: "19:30", details: "Discussion on school activities and parent involvement." };
  const found = sense.inventedDetails("create_activity", args, PTA).map((f) => f.field).sort();
  assert.deepEqual(found, ["details", "endTime", "startTime"]);
  assert.deepEqual(sense.inventedDetails("create_event", { eventName: "PTA meeting", eventDate: "2026-12-03", eventDetails: "PTA meeting", startTime: "16:00" }, "PTA meeting next Thursday at 4pm"), []);
  assert.deepEqual(sense.inventedDetails("create_event", { startTime: "16:00", endTime: "17:00" }, "meeting at 4 pm for an hour"), []);
  assert.deepEqual(sense.inventedDetails("create_event", { startTime: "12:00" }, "closes at noon"), []);
  assert.deepEqual(sense.inventedDetails("create_event", { location: "Main hall" }, "PTA meeting in the main hall"), []);
  assert.equal(sense.inventedDetails("create_event", { location: "Library" }, "PTA meeting Thursday").length, 1);
});

test("'doesn't clash' needs the calendar looked up first", () => {
  assert.equal(sense.needsCalendarFirst(PTA, [], [{ name: "list_activities" }, { name: "get_term" }]).status, "needs_lookup");
  assert.equal(sense.needsCalendarFirst(PTA, [], [{ name: "get_calendar" }]), null);
  assert.equal(sense.needsCalendarFirst("Schedule a PTA event on Dec 3", [], []), null);
});

test("a reply never says it's done while only a preview exists", () => {
  assert.equal(sense.claimsDone("I have scheduled a PTA Meeting for Thursday, December 3."), true);
  assert.equal(sense.claimsDone("The meeting has been successfully created."), true);
  assert.equal(sense.claimsDone("Here's the preview. Shall I go ahead?"), false);
  assert.equal(sense.claimsDone("This will be added to the school calendar once you confirm."), false);
});

test("a date the school names is found on the calendar or asked about, never worked out", () => {
  assert.deepEqual(sense.unresolvedNamedDates(PTA, [], ['{"term":"Fall Semester","end":"2026-12-18"}'], "The first Thursday after midterm (Dec 18) is Dec 24."), ["midterm"]);
  assert.deepEqual(sense.unresolvedNamedDates(PTA, [], [], "Your calendar doesn't name a midterm. Which date do you mean by midterm?"), []);
  assert.deepEqual(sense.unresolvedNamedDates("Make it a school event. By midterm I mean October 16.", [{ role: "user", content: PTA }], [], "ok"), []);
  assert.deepEqual(sense.unresolvedNamedDates(PTA, [], ['{"events":[{"name":"Midterm exams","date":"2026-10-12"}]}'], "After midterm exams on Oct 12"), []);
});

test("a preview Mira writes itself is caught; 'is scheduled as follows' counts as done", () => {
  assert.equal(sense.presentsPreview("Here's the preview for the event. Shall I go ahead and schedule this event?"), true);
  assert.equal(sense.claimsDone("The PTA meeting is scheduled as follows:"), true);
  assert.equal(sense.claimsDone("It will be added to the calendar once you confirm."), false);
});
