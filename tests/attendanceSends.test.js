// Families hear about a day's attendance after the teacher is done, not on Save (utils/attendanceSends.js).
// Runs on the local copy's database inside a transaction that is always rolled back.
const test = require("node:test");
const assert = require("node:assert");
const pool = require("../config/db");
const sends = require("../utils/attendanceSends");

const MIN = 60000;
const at = (base, minutes) => new Date(base.getTime() + minutes * MIN);

async function setup(t) {
  let client;
  try { client = await pool.connect(); } catch (_) { t.skip("no database"); return null; }
  await client.query("BEGIN");
  const cls = (await client.query("SELECT class_id, organization_id FROM classes WHERE obsolete_at IS NULL ORDER BY class_id LIMIT 1")).rows[0];
  const ready = await client.query("SELECT to_regclass('public.attendance_sends') AS t");
  if (!cls || !ready.rows[0].t) { await client.query("ROLLBACK"); client.release(); t.skip("no test data or migration not run"); return null; }
  return { client, cls };
}
const rowOf = async (client, cls, day) => (await client.query(
  "SELECT confirmed_at, sent_at, send_after FROM attendance_sends WHERE organization_id = $1 AND class_id = $2 AND attendance_date = $3::date", [cls.organization_id, cls.class_id, day])).rows[0];

test("a save waits 2 hours; 'done' waits 30 minutes; a correction keeps the wait", async (t) => {
  const s = await setup(t); if (!s) return;
  const { client, cls } = s, day = "2020-01-06", now = new Date("2020-01-06T09:00:00Z");
  try {
    const first = await sends.onSaved(client, cls.organization_id, { classId: cls.class_id, date: day, studentIds: [1], now });
    assert.deepStrictEqual(first, { held: true, confirmed: false });
    assert.strictEqual((await rowOf(client, cls, day)).send_after.toISOString(), at(now, 120).toISOString());

    // Saved again, nobody answered: the 2 hours run from the latest save.
    await sends.onSaved(client, cls.organization_id, { classId: cls.class_id, date: day, studentIds: [1], now: at(now, 10) });
    assert.strictEqual((await rowOf(client, cls, day)).send_after.toISOString(), at(now, 130).toISOString());

    // "Yes, I'm done" at 20 minutes: families hear 30 minutes later.
    assert.strictEqual(await sends.confirm(client, cls.organization_id, { classId: cls.class_id, date: day, now: at(now, 20) }), true);
    assert.strictEqual((await rowOf(client, cls, day)).send_after.toISOString(), at(now, 50).toISOString());
    // Answering again, or correcting a mark afterwards, never pushes it later.
    await sends.confirm(client, cls.organization_id, { classId: cls.class_id, date: day, now: at(now, 30) });
    const again = await sends.onSaved(client, cls.organization_id, { classId: cls.class_id, date: day, studentIds: [1], now: at(now, 25) });
    assert.deepStrictEqual(again, { held: true, confirmed: true });
    assert.strictEqual((await rowOf(client, cls, day)).send_after.toISOString(), at(now, 50).toISOString());

    // Nothing waits for a class and day that was never saved.
    assert.strictEqual(await sends.confirm(client, cls.organization_id, { classId: cls.class_id, date: "2020-01-07", now }), false);
  } finally { await client.query("ROLLBACK"); client.release(); }
});

test("the send step tells families once, only when the wait is over, from the marks as they stand", async (t) => {
  const s = await setup(t); if (!s) return;
  const { client, cls } = s, day = "2020-01-06", now = new Date("2020-01-06T09:00:00Z");
  const original = sends.tellFamilies;
  const told = [];
  try {
    const kids = (await client.query("SELECT student_id FROM students WHERE organization_id = $1 AND class_id = $2 ORDER BY student_id LIMIT 2", [cls.organization_id, cls.class_id])).rows.map((r) => r.student_id);
    if (kids.length < 2) { t.skip("no students"); return; }
    const term = (await client.query("SELECT term_id FROM terms WHERE organization_id = $1 LIMIT 1", [cls.organization_id])).rows[0];
    for (const id of kids) {
      await client.query("INSERT INTO attendance_records (student_id, date, status, class_id, term_id, marked_by, organization_id) VALUES ($1, $2::date, 'Absent', $3, $4, NULL, $5)", [id, day, cls.class_id, term.term_id, cls.organization_id]);
    }
    sends.tellFamilies = async (db, org, ids, date) => { told.push({ org, ids: [...ids].sort(), date }); };
    await sends.onSaved(client, cls.organization_id, { classId: cls.class_id, date: day, studentIds: kids, now });
    assert.strictEqual(await sends.sendDue(client, { now: at(now, 119) }), 0, "not before 2 hours");
    assert.strictEqual(told.length, 0);
    // A correction before the send: the first child is present after all.
    await client.query("UPDATE attendance_records SET status = 'Present' WHERE student_id = $1 AND date = $2::date", [kids[0], day]);
    assert.strictEqual(await sends.sendDue(client, { now: at(now, 121) }), 1);
    assert.strictEqual(told.length, 1);
    assert.deepStrictEqual(told[0].ids, [...kids].sort(), "the day's marks as they stand are looked at when it is sent");
    assert.strictEqual(told[0].date, day);
    assert.ok((await rowOf(client, cls, day)).sent_at, "marked as sent");
    assert.strictEqual(await sends.sendDue(client, { now: at(now, 300) }), 0, "never twice");
    assert.strictEqual(told.length, 1);
  } finally { sends.tellFamilies = original; await client.query("ROLLBACK"); client.release(); }
});

test("saving attendance no longer tells families at once", () => {
  const source = require("fs").readFileSync(require("path").join(__dirname, "../controllers/commonController.js"), "utf8");
  const start = source.indexOf("saveSingleAttendance: async");
  const body = source.slice(start, source.indexOf("createEmployeeGet: async", start));
  assert.ok(!/onAbsent\(|attendanceNotices"\)\.run|triggerAbsenceAlertsForStudents\(/.test(body), "the save must only record the pending send");
  assert.ok(/attendanceSends"\)/.test(body));
});
