"use strict";
// The Custom editor (utils/customForms.js): what a builder may save, which fields show and
// what a person's answers become.
const test = require("node:test");
const assert = require("node:assert/strict");
const cf = require("../utils/customForms");
const questionHelp = require("../utils/questionHelp");

const section = () => cf.normalizeSection({
  name: "Medical",
  filledBy: "parent",
  dueDate: "2026-12-01",
  fields: [
    { id: "f_aaaa1", type: "yesno", label: "Any allergies?", key: "hasAllergies", required: true },
    { id: "f_aaaa2", type: "textarea", label: "Allergy details", required: true, cond: { action: "show", field: "f_aaaa1", op: "is", value: "yes" } },
    { id: "f_aaaa3", type: "choice", label: "Severity", options: ["Mild", "Severe", "Mild"], display: "buttons" },
    { id: "f_aaaa4", type: "date", label: "Review" },
    { id: "f_aaaa5", type: "file", label: "Plan" },
    { id: "f_aaaa6", type: "signature", label: "Signature" },
  ],
});

test("a section is cleaned: options, keys, who fills it in and who sees it", () => {
  const s = section();
  assert.equal(s.showParents, true, "parents see what they fill in");
  assert.deepEqual(s.fields[2].options, ["Mild", "Severe"], "duplicate options go");
  assert.equal(s.fields[0].key, "hasAllergies", "a one-word name keeps its capitals");
  assert.equal(s.fields[1].key, "allergyDetails");
  assert.equal(s.fields[1].cond.field, "f_aaaa1");
  const staff = cf.normalizeSection({ filledBy: "staff", dueDate: "2026-12-01", required: true });
  assert.equal(staff.dueDate, null, "a staff section has no deadline");
  assert.equal(staff.required, false);
  assert.equal(cf.normalizeSection({ icon: "<script>" }).icon, "form");
  assert.equal(cf.normalizeSection({ rules: [{ on: "saved" }] }).rules, undefined, "there are no automations to save");
});

test("a section can live in the driver portal and take one submission only", () => {
  const driver = cf.normalizeSection({ filledBy: "driver", once: true, dueDate: "2026-12-01", required: true, showParents: true });
  assert.equal(driver.filledBy, "driver");
  assert.equal(driver.once, true);
  assert.equal(driver.dueDate, null, "deadlines are for parent and student forms");
  assert.equal(driver.required, false);
  assert.equal(driver.showParents, true, "a driver's answers can be shared with parents");
  assert.equal(cf.normalizeSection({ multiple: true, once: true }).once, false, "a list can't be one-time");
  assert.equal(cf.normalizeSection({ filledBy: "janitor" }).filledBy, "staff");
});

test("a section can be collected every term or year, and print on report cards", () => {
  const term = cf.normalizeSection({ repeat: "term", reportCard: true });
  assert.equal(term.repeat, "term");
  assert.equal(term.reportCard, true);
  assert.equal(cf.normalizeSection({ repeat: "weekly" }).repeat, "", "only every term or every year");
  const list = cf.normalizeSection({ multiple: true, repeat: "year", reportCard: true });
  assert.equal(list.repeat, "", "a list just keeps growing");
  assert.equal(list.reportCard, false, "a list doesn't print on report cards");
  assert.equal(cf.normalizeSection({ protected: true, reportCard: true }).reportCard, false, "a protected section stays off report cards");
});

test("drivers see only driver sections; teachers don't see driver ones", () => {
  const sections = [{ id: 1, filledBy: "staff", status: "live", classIds: [] }, { id: 2, filledBy: "driver", status: "live", classIds: [] }, { id: 3, filledBy: "parent", status: "draft", classIds: [] }];
  assert.deepEqual(cf.sectionsForStaff(sections, { driver: true, students: new Set([5]), classes: new Set() }).map((s) => s.id), [2]);
  assert.deepEqual(cf.sectionsForStaff(sections, { all: false, classes: new Set([7]) }).map((s) => s.id), [1]);
  assert.deepEqual(cf.sectionsForStaff(sections, { all: true, builder: true }).map((s) => s.id), [1, 2, 3]);
});

test("a field shows only when its condition holds", () => {
  const s = section();
  const byId = new Map(s.fields.map((f) => [f.id, f]));
  assert.equal(cf.isVisible(s.fields[1], { f_aaaa1: true }, byId), true);
  assert.equal(cf.isVisible(s.fields[1], { f_aaaa1: false }, byId), false);
  assert.equal(cf.conditionMet({ op: "more", value: "5" }, 7), true);
  assert.equal(cf.conditionMet({ op: "less", value: "2026-01-01" }, "2025-12-31"), true);
  assert.equal(cf.conditionMet({ op: "contains", value: "peanut" }, ["Peanut", "Egg"]), true);
  assert.equal(cf.conditionMet({ op: "empty" }, []), true);
});

test("answers: required fields that show, hidden values dropped, files of this school only", () => {
  const s = section();
  let r = cf.normalizeEntry(s, { f_aaaa1: "yes" }, { organizationId: 63 });
  assert.equal(r.errors[0].message, "Allergy details is required.");
  r = cf.normalizeEntry(s, { f_aaaa1: "no", f_aaaa2: "kept?" }, { organizationId: 63 });
  assert.equal(r.errors.length, 0);
  assert.equal(r.data.f_aaaa2, undefined, "a hidden field's value isn't kept");
  r = cf.normalizeEntry(s, { f_aaaa1: false, f_aaaa3: "Extreme", f_aaaa4: "2026-02-31" }, { organizationId: 63 });
  assert.deepEqual(r.errors.map((e) => e.field), ["f_aaaa3", "f_aaaa4"], "unknown option and impossible date are refused");
  r = cf.normalizeEntry(s, {
    f_aaaa1: false,
    f_aaaa5: [{ name: "a", key: "custom-forms/63/x.pdf", url: "https://b/custom-forms/63/x.pdf" }, { name: "b", key: "custom-forms/99/y.pdf", url: "https://b/custom-forms/99/y.pdf" }],
    f_aaaa6: { name: "Pat Parent", agreed: false },
  }, { organizationId: 63 });
  assert.equal(r.errors[0].field, "f_aaaa6", "a signature needs the box ticked");
  r = cf.normalizeEntry(s, { f_aaaa1: false, f_aaaa5: [{ name: "b", key: "custom-forms/99/y.pdf", url: "https://b/custom-forms/99/y.pdf" }] }, { organizationId: 63 });
  assert.equal(r.data.f_aaaa5, undefined, "another school's file is dropped");
});

test("a time field takes a time of day", () => {
  const s = cf.normalizeSection({ fields: [{ id: "f_time0001", type: "time", label: "Pickup time", required: true }] });
  assert.equal(cf.normalizeEntry(s, { f_time0001: "15:30" }, { organizationId: 1 }).data.f_time0001, "15:30");
  assert.equal(cf.normalizeEntry(s, { f_time0001: "25:00" }, { organizationId: 1 }).errors[0].field, "f_time0001");
  assert.equal(cf.display(s.fields[0], "15:30"), "3:30 PM");
});

test("help on a question keeps safe links and this school's files only", () => {
  assert.equal(questionHelp.check({ text: "  " }, 63), null);
  const help = questionHelp.check({
    text: "Read chapter 3",
    link: { url: "javascript:alert(1)" },
    files: [{ name: "n", key: "question-help/63/a.pdf", url: "https://x/question-help/63/a.pdf" }, { name: "o", key: "question-help/7/b.pdf", url: "https://x/question-help/7/b.pdf" }],
  }, 63);
  assert.equal(help.link, null);
  assert.equal(help.files.length, 1);
});

test("a section says how often it is collected, and only keeps the choices that fit", () => {
  const daily = cf.normalizeSection({ name: "Lunch count", filledBy: "staff", repeat: "day", attendance: true, reportCard: true, tile: true, fields: [{ type: "choice", label: "Lunch", options: ["School lunch", "Packed lunch"] }] });
  assert.equal(daily.repeat, "day");
  assert.equal(daily.attendance, true, "a classroom section collected every day can go on the attendance page");
  assert.equal(daily.reportCard, false, "a daily count never prints on report cards");
  assert.equal(daily.tile, true);
  assert.deepEqual(daily.tell, { teacher: true, builders: false }, "the main teacher hears unless switched off");
  assert.deepEqual(daily.via, { email: false, sms: false, whatsapp: false });

  const weeklyParent = cf.normalizeSection({ name: "Lunch order", filledBy: "parent", repeat: "week", attendance: true, tell: { teacher: false, builders: true }, via: { email: true, sms: true, whatsapp: "yes" }, fields: [] });
  assert.equal(weeklyParent.repeat, "week");
  assert.equal(weeklyParent.attendance, false, "only a classroom section goes on the attendance page");
  assert.deepEqual(weeklyParent.tell, { teacher: false, builders: true });
  assert.deepEqual(weeklyParent.via, { email: true, sms: true, whatsapp: false }, "a channel is on only when it was ticked");

  const termly = cf.normalizeSection({ name: "Skills", filledBy: "staff", repeat: "term", attendance: true, via: { email: true }, fields: [] });
  assert.equal(termly.attendance, false, "and only one collected every day");
  assert.equal(termly.via.email, false, "only a parent form tells families");
  assert.equal(cf.normalizeSection({ multiple: true, repeat: "day" }).repeat, "", "a list that grows has no schedule");
  assert.equal(cf.normalizeSection({ repeat: "hourly" }).repeat, "");
});

test("a quick section is a few tap-to-answer fields; its rows may be saved part done", () => {
  const section = cf.normalizeSection({ name: "Seats and lunch", filledBy: "staff", repeat: "term", fields: [
    { type: "seat", label: "Seat" }, { type: "choice", label: "Lunch", options: ["School", "Packed"], required: true }, { type: "yesno", label: "Milk" },
  ] });
  const [seat, lunch, milk] = section.fields;
  assert.deepEqual(cf.quickFields(section).map((field) => field.type), ["seat", "choice", "yesno"]);
  assert.equal(cf.quickFields({ ...section, multiple: true }).length, 0, "a list that grows is not quick");
  assert.equal(cf.quickFields({ ...section, fields: [...section.fields, { id: "f_note1", type: "textarea", label: "Note" }] }).length, 0, "one typed field and it is filled in the usual way");
  assert.equal(cf.quickFields({ ...section, fields: [{ ...milk, cond: { action: "show", field: lunch.id, op: "is", value: "School" } }] }).length, 0, "nor with a field shown on a condition");

  // A seat is a row and a place in the room; anything else is no seat at all.
  assert.deepEqual(cf.normalizeEntry(section, { [seat.id]: { r: "2", c: 3 } }, { partial: true }).data[seat.id], { r: 2, c: 3 });
  assert.equal(cf.normalizeEntry(section, { [seat.id]: { r: 0, c: 999 } }, { partial: true }).data[seat.id], undefined);
  assert.equal(cf.normalizeEntry(section, { [seat.id]: "front row" }, { partial: true }).data[seat.id], undefined);
  assert.equal(cf.display(seat, { r: 2, c: 3 }), "Row 2, seat 3");

  // One tap at a time: a required field left for the next tap is not an error yet...
  assert.deepEqual(cf.normalizeEntry(section, { [milk.id]: "yes" }, { partial: true }), { data: { [milk.id]: true }, errors: [] });
  // ...but a whole form still needs it, and a made-up choice is always refused.
  assert.equal(cf.normalizeEntry(section, { [milk.id]: "yes" }).errors.length, 1);
  assert.equal(cf.normalizeEntry(section, { [lunch.id]: "Caviar" }, { partial: true }).errors.length, 1);
});

test("choices can show as icons; a seat shows a photo or a name; unknown icons are dropped", () => {
  const section = cf.normalizeSection({ name: "Lunch", filledBy: "staff", repeat: "day", fields: [
    { type: "choice", label: "Lunch", options: ["School lunch", "Packed lunch", "No lunch"], display: "icons", icons: { "School lunch": "lunch", "Packed lunch": "bag", "No lunch": "<script>", Ghost: "star" } },
    { type: "yesno", label: "Milk", display: "icons" },
    { type: "seat", label: "Seat", display: "names" },
    { type: "choice", label: "Plain", options: ["A", "B"], display: "pictures", icons: { A: "star" } },
  ] });
  const [lunch, milk, seat, plain] = section.fields;
  assert.equal(lunch.display, "icons");
  assert.deepEqual(lunch.icons, { "School lunch": "lunch", "Packed lunch": "bag" }, "only known icons for real choices are kept");
  assert.equal(milk.display, "icons");
  assert.equal(seat.display, "names");
  assert.equal(plain.display, "dropdown", "an unknown way to show falls back to a dropdown");
  assert.equal(plain.icons, undefined, "icons are kept only when choices show as icons");
  assert.equal(cf.normalizeSection({ fields: [{ type: "yesno", label: "x", display: "buttons" }] }).fields[0].display, undefined);
});

// ── Report-card remarks and forms beside each student (feature report_remarks_forms) ──────
test("a typed field offers suggestions and prints as a remark only on a classroom section on report cards", () => {
  const remarks = cf.normalizeSection({ name: "Remarks", filledBy: "staff", repeat: "term", reportCard: true, fields: [
    { type: "textarea", label: "Teacher's remark", printsAs: "TEACHER", suggestions: ["  Works  hard. ", "works hard.", "", null, "Needs\r\nhelp"] },
    { type: "textarea", label: "Another teacher's remark", printsAs: "teacher" },
    { type: "text", label: "Principal", printsAs: "custom:principal-remark" },
    { type: "choice", label: "Effort", options: ["Good", "Fair"], printsAs: "conduct", suggestions: ["x"] },
    { type: "textarea", label: "Odd", printsAs: "custom:<b>" },
    { type: "textarea", label: "Old", printsAs: "attitude", retired: true },
  ] });
  const [teacher, again, principal, effort, odd, old] = remarks.fields;
  assert.equal(teacher.printsAs, "teacher");
  assert.deepEqual(teacher.suggestions, ["Works hard.", "Needs help"], "phrases are tidied and kept once");
  assert.equal(again.printsAs, undefined, "one field per remark: the first one wins");
  assert.equal(principal.printsAs, "custom:principal-remark", "a school's own remark type");
  assert.equal(effort.printsAs, undefined, "only typed answers print as a remark");
  assert.equal(effort.suggestions, undefined, "or offer suggestions");
  assert.equal(odd.printsAs, undefined, "an unknown remark is dropped");
  assert.equal(old.printsAs, undefined, "a field no longer used prints nowhere");
  assert.deepEqual(cf.remarkFields(remarks).map((field) => field.printsAs), ["teacher", "custom:principal-remark"]);

  const field = [{ type: "textarea", label: "Remark", printsAs: "teacher", suggestions: ["Good"] }];
  assert.equal(cf.normalizeSection({ filledBy: "staff", repeat: "term", fields: field }).fields[0].printsAs, undefined, "not on report cards: no remark");
  assert.equal(cf.normalizeSection({ filledBy: "parent", repeat: "term", reportCard: true, fields: field }).fields[0].printsAs, undefined, "a parent form fills no remark");
  assert.equal(cf.normalizeSection({ filledBy: "staff", repeat: "day", reportCard: true, fields: field }).fields[0].printsAs, undefined, "a daily count is never on report cards");
  assert.deepEqual(cf.normalizeSection({ filledBy: "parent", fields: field }).fields[0].suggestions, ["Good"], "suggestions work on any form");
  const many = cf.normalizeSection({ fields: [{ type: "text", label: "x", suggestions: Array.from({ length: 60 }, (_, i) => `Phrase ${i}`) }] });
  assert.equal(many.fields[0].suggestions.length, 40);
});

test("a section sits beside each student only in the classroom", () => {
  assert.equal(cf.normalizeSection({ filledBy: "staff", beside: true }).beside, true);
  assert.equal(cf.normalizeSection({ filledBy: "staff", multiple: true, beside: true }).beside, true, "a log too: coloured once it has entries");
  assert.equal(cf.normalizeSection({ filledBy: "parent", beside: true }).beside, false);
  assert.equal(cf.normalizeSection({ filledBy: "driver", beside: true }).beside, false);
  assert.equal(cf.normalizeSection({ filledBy: "staff", beside: "yes" }).beside, false);
});

test("Report card remarks is made from the remarks the school uses, hidden until made live", () => {
  const section = cf.remarksSection({ used: [
    { key: "teacher", label: "Teacher's Remarks", suggestions: ["Very hardworking.", "Very hardworking."] },
    { key: "custom:principal-remark", label: "Principal remark", suggestions: [] },
  ] });
  assert.equal(section.status, "draft");
  assert.equal(section.filledBy, "staff");
  assert.equal(section.repeat, "term");
  assert.equal(section.reportCard, true);
  assert.equal(section.beside, true);
  assert.deepEqual(section.fields.map((field) => [field.type, field.key, field.printsAs]), [["textarea", "teacherRemarks", "teacher"], ["textarea", "principalRemark", "custom:principal-remark"]]);
  assert.deepEqual(section.fields[0].suggestions, ["Very hardworking."]);
  assert.equal(section.fields[1].suggestions, undefined);
});

// A stand-in database for the reads below: one school, its sections, one term and the answers.
function stubDb({ sections, entries, seen }) {
  return {
    query: async (sql, params) => {
      if (seen) seen.push(sql);
      if (/information_schema/.test(sql)) return { rows: [{ n: 8 }] };
      if (/FROM custom_sections/.test(sql)) return { rows: sections };
      if (/FROM terms/.test(sql)) return { rows: [{ term_id: 241, school_year_id: 9 }] };
      if (/FROM custom_section_entries/.test(sql)) return { rows: typeof entries === "function" ? entries(sql, params) : entries };
      return { rows: [] };
    },
  };
}
const sectionRow = (id, raw) => {
  const clean = cf.normalizeSection(raw);
  return {
    section_id: id, name: clean.name, icon: clean.icon, notes: "", multiple: clean.multiple, once: clean.once, filled_by: clean.filledBy, class_ids: clean.classIds,
    show_parents: clean.showParents, show_students: clean.showStudents, protected: clean.protected, required: clean.required, due_date: null, status: "live",
    fields: clean.fields, options: { repeat: clean.repeat, reportCard: clean.reportCard, beside: clean.beside }, position: id,
  };
};
async function withRemarksFeature(run) {
  const features = require("../utils/shards/features");
  const isOn = features.isOn;
  features.isOn = () => true;
  try { return await run(); } finally { features.isOn = isOn; }
}

test("a remark answer prints in its place on the report card, and not again under its section", () => withRemarksFeature(async () => {
  const remarks = sectionRow(1, { name: "Report card remarks", filledBy: "staff", repeat: "term", reportCard: true, fields: [
    { id: "f_teach01", type: "textarea", label: "Teacher's Remarks", printsAs: "teacher" },
    { id: "f_princ01", type: "textarea", label: "Principal remark", printsAs: "custom:principal-remark" },
    { id: "f_effor01", type: "choice", label: "Effort", options: ["Good", "Fair"] },
  ] });
  const skills = sectionRow(2, { name: "Skills", filledBy: "staff", repeat: "term", reportCard: true, fields: [{ id: "f_skill01", type: "choice", label: "Reading", options: ["Good", "Fair"] }] });
  const db = stubDb({ sections: [remarks, skills], entries: [
    { section_id: 1, student_id: 5, term_id: 241, school_year_id: 9, data: { f_teach01: "Works hard.", f_effor01: "Good" } },
    { section_id: 1, student_id: 6, term_id: 240, school_year_id: 9, data: { f_teach01: "Last term's remark." } },
    { section_id: 2, student_id: 5, term_id: 241, school_year_id: 9, data: { f_skill01: "Fair" } },
  ] });
  const card = await cf.reportCard(db, 9101, { classId: 146, termId: 241, studentIds: [5, 6] });
  assert.deepEqual(card.remarks.get(5), { teacher: { text: "Works hard.", section: "Report card remarks", sectionId: 1 } });
  assert.equal(card.remarks.get(6), undefined, "another term's answer doesn't print: the remark saved on the card does");
  assert.deepEqual(card.sections.get(5), [{ name: "Report card remarks", rows: [{ label: "Effort", value: "Good" }] }, { name: "Skills", rows: [{ label: "Reading", value: "Fair" }] }],
    "a remark isn't printed twice; the section's other answers still print");
  cf.forget(9101);
  const unticked = await cf.reportCard(db, 9101, { classId: 146, termId: 241, studentIds: [5], visibility: { 1: false } });
  assert.equal(unticked.remarks.size, 0, "a section unticked in Report Settings prints nothing, remarks included");
  assert.deepEqual(unticked.sections.get(5).map((block) => block.name), ["Skills"]);
  cf.forget(9101);
}));

test("forms beside each student: one read for the class, coloured once this period's entry is in", () => withRemarksFeature(async () => {
  const seen = [];
  const db = stubDb({
    seen,
    sections: [
      sectionRow(1, { name: "Report card remarks", filledBy: "staff", repeat: "term", reportCard: true, beside: true, fields: [{ id: "f_teach01", type: "textarea", label: "Teacher", printsAs: "teacher" }] }),
      sectionRow(2, { name: "Lunch count", filledBy: "staff", repeat: "day", beside: true, classIds: [999], fields: [{ type: "yesno", label: "Lunch" }] }),
      sectionRow(3, { name: "Behavior log", filledBy: "staff", multiple: true, fields: [{ type: "textarea", label: "What happened" }] }),
    ],
    entries: (sql, params) => {
      assert.match(sql, /x\.section_id = \$3 AND x\.term_id IS NOT DISTINCT FROM \$4::int/, "the term the classroom shows");
      assert.deepEqual(params, [9102, [5, 6], 1, 241]);
      return [{ section_id: 1, student_id: 6 }];
    },
  });
  const beside = await cf.besideFor(db, 9102, { classId: 146, studentIds: [5, 6, 6], termId: 241, day: "2026-11-15" });
  assert.deepEqual(beside.sections.map((section) => section.id), [1], "only live classroom sections for this class that asked to be beside each student");
  assert.deepEqual(beside.done, { 1: [6] });
  assert.deepEqual(beside.remarkSlots, ["teacher"], "this class's teacher remark comes from the Custom editor");
  assert.equal(seen.filter((sql) => /custom_section_entries/.test(sql)).length, 1);
  cf.forget(9102);
}));
