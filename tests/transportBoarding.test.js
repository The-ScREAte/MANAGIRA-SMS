const test = require("node:test");
const assert = require("node:assert");
const { dayFrom, forStudents, schoolDay, tripBoardings, setRiding } = require("../utils/transportBoarding");

const noTable = () => Object.assign(new Error("relation does not exist"), { code: "42P01" });
const missingTables = { query: async () => { throw noTable(); } };

test("the day is the phone's own date, within reason", () => {
  const today = new Date().toISOString().slice(0, 10);
  const yesterday = new Date(Date.now() - 86400000).toISOString().slice(0, 10);
  assert.strictEqual(dayFrom(yesterday), yesterday);
  assert.strictEqual(dayFrom("2001-01-01"), today);
  assert.strictEqual(dayFrom("not a date"), today);
  assert.strictEqual(dayFrom(undefined), today);
});

test("a family only sees its own children", () => {
  const reading = {
    notRiding: [{ studentId: 1, by: "parent" }, { studentId: 2, by: "staff" }],
    events: [{ id: 9, studentId: 2, boarded: true }, { id: 10, studentId: 3, boarded: true }],
  };
  const mine = forStudents(reading, [2]);
  assert.deepStrictEqual(mine.notRiding.map((row) => row.studentId), [2]);
  assert.deepStrictEqual(mine.events.map((row) => row.id), [9]);
});

test("before the migration, pages have nothing to show and keep working", async () => {
  assert.deepStrictEqual(await schoolDay(missingTables, 1, "2026-11-08"), { notRiding: [], events: [] });
  assert.deepStrictEqual(await tripBoardings(missingTables, 1, 5), []);
});

test("before the migration, saving says so plainly", async () => {
  await assert.rejects(setRiding(missingTables, 1, 2, "2026-11-08", false, { by: "parent" }), /isn't available yet/);
});

test("viewers of a school share one read", async () => {
  let reads = 0;
  const db = { query: async () => { reads += 1; return { rows: [] }; } };
  await Promise.all([schoolDay(db, 77, "2026-11-08"), schoolDay(db, 77, "2026-11-08"), schoolDay(db, 77, "2026-11-08")]);
  await schoolDay(db, 77, "2026-11-08");
  assert.strictEqual(reads, 2); // one for who's away, one for who boarded
});
