// The last step before a reply reaches the person (services/replyClean.js): no tool names, raw
// record IDs or emojis - and nothing else changed.
const test = require("node:test");
const assert = require("node:assert/strict");

const { cleanReply } = require("../services/replyClean");
const { REGISTRY } = require("../tools");
const NAMES = [...Object.keys(REGISTRY), "load_tools"];

test("tool names become plain words", () => {
  assert.equal(cleanReply("I checked with `get_class` and find_low_attendance.", NAMES), "I checked with get class and find low attendance.");
});

test("raw record IDs go; on-screen student numbers stay", () => {
  assert.equal(cleanReply("Emma (student ID 10142) is in Grade 5 (class_id: 1004).", NAMES), "Emma is in Grade 5.");
  assert.equal(cleanReply("Record ID #88 was updated; studentId 7 too.", NAMES), "Record was updated; too.");
  assert.equal(cleanReply("Ref 3f2b1c4d-1a2b-4c3d-8e9f-0a1b2c3d4e5f done.", NAMES), "Ref done.");
  const table = "| ID | Student | Student ID |\n|---|---|---|\n| 10142 | Emma Carter | S1004-23 |\n| 10143 | Kwame Owusu | S1004-24 |";
  assert.equal(cleanReply(table, NAMES), "| Student | Student ID |\n| --- | --- |\n| Emma Carter | S1004-23 |\n| Kwame Owusu | S1004-24 |");
});

test("emojis go; ordinary symbols, links and words are left alone", () => {
  assert.equal(cleanReply("Done! 🎉 All set ✅ 👍🏽 1️⃣", NAMES), "Done! All set");
  assert.equal(cleanReply("© 2026 Managira™ - 84.5% · 30 students", NAMES), "© 2026 Managira™ - 84.5% · 30 students");
  assert.equal(cleanReply("See [the report](https://example.com/get_class/id/55).", NAMES), "See [the report](https://example.com/get_class/id/55).");
  assert.equal(cleanReply("She paid 50. Did 12 attend? A valid 3-day pass.", NAMES), "She paid 50. Did 12 attend? A valid 3-day pass.");
  const list = "**6 students** below 90%\n\n  1. Emma Carter\n  2. Kwame Owusu";
  assert.equal(cleanReply(list, NAMES), list, "a clean reply comes back exactly as written");
});
