// State reporting files (utils/stateFile.js): the layouts states ask for, translations to state
// codes, the check before a file goes out, and the locked copy kept on the server.
const test = require("node:test");
const assert = require("node:assert/strict");
const stateFile = require("../utils/stateFile");

const report = {
  columns: {
    student_id: { label: "Student ID" },
    last_name: { label: "Last name" },
    first_name: { label: "First name" },
    date_of_birth: { label: "Date of birth", type: "date" },
    gender: { label: "Gender" },
    class_name: { label: "Class" },
    days_absent: { label: "Absent", type: "number" },
  },
};
const columns = Object.keys(report.columns);
const rows = [
  { student_id: "1001", last_name: "Núñez", first_name: "José", date_of_birth: new Date("2015-03-09T00:00:00Z"), gender: "Male", class_name: "Grade 3", days_absent: 2 },
  { student_id: "1002", last_name: "O'Brien, Jr", first_name: "Ann", date_of_birth: "2016-11-30", gender: "Female", class_name: "Kindergarten", days_absent: 0 },
];

test("grade wording becomes federal grade codes", () => {
  assert.equal(stateFile.gradeCode("Kindergarten"), "KG");
  assert.equal(stateFile.gradeCode("Pre-K"), "PK");
  assert.equal(stateFile.gradeCode("Grade 3"), "03");
  assert.equal(stateFile.gradeCode("10th Grade"), "10");
  assert.equal(stateFile.gradeCode("twelfth"), "12");
  assert.equal(stateFile.gradeCode("Lions"), null);
});

test("a CSV with the state's names, codes, dates and CRLF, in plain ASCII", () => {
  const out = stateFile.build(rows, columns, report, {
    layout: "comma",
    dateFormat: "YYYYMMDD",
    columns: {
      student_id: { name: "LOCAL_ID", required: true },
      gender: { name: "SEX", preset: "sex_mfx" },
      class_name: { name: "GRADE", preset: "grade_federal" },
      last_name: { name: "LAST_NAME" },
    },
  });
  const lines = out.content.toString("latin1").split("\r\n");
  assert.equal(lines[0], "LOCAL_ID,LAST_NAME,First name,Date of birth,SEX,GRADE,Absent");
  assert.equal(lines[1], "1001,Nunez,Jose,20150309,M,03,2");
  assert.equal(lines[2], '1002,"O\'Brien, Jr",Ann,20161130,F,KG,0');
  assert.equal(lines[3], "");
  assert.equal(out.rows, 2);
  assert.deepEqual(out.problems, []);
  assert.match(out.sha256, /^[0-9a-f]{64}$/);
});

test("fixed width pads text with spaces and numbers with zeros, and flags what doesn't fit", () => {
  const out = stateFile.build(rows, ["student_id", "last_name", "days_absent"], report, {
    layout: "fixed",
    columns: { student_id: { width: 6 }, last_name: { width: 6 }, days_absent: { width: 3 } },
  });
  const lines = out.content.toString("latin1").split("\r\n");
  assert.equal(lines[0], "1001  Nunez 002");
  assert.equal(lines[1], "1002  O'Brie000"); // cut to fit, and reported below
  const tooLong = out.problems.find((p) => p.kind === "too_long");
  assert.equal(tooLong.rows, 1);
  assert.match(stateFile.describe(tooLong), /longer than 6 characters/);
});

test("the check names empty required fields and values with no state code", () => {
  const out = stateFile.build(
    [{ ...rows[0], student_id: "" }, { ...rows[1], gender: "Prefer not to say", class_name: "Lions" }],
    columns, report,
    { layout: "pipe", columns: { student_id: { required: true, name: "ID" }, gender: { preset: "sex_mfx", onlyListed: true }, class_name: { preset: "grade_federal" } } }
  );
  const kinds = Object.fromEntries(out.problems.map((p) => [`${p.column}:${p.kind}`, p]));
  assert.equal(kinds["ID:missing"].rows, 1);
  assert.deepEqual(kinds["Gender:untranslated"].examples, ["Prefer not to say"]);
  assert.deepEqual(kinds["Class:untranslated"].examples, ["Lions"]);
  assert.ok(out.content.toString("latin1").split("\r\n")[0].includes("|"));
});

test("a fixed value, other date styles, tabs, and a formula can't run in a spreadsheet", () => {
  const out = stateFile.build([{ student_id: "=HYPERLINK(1)", date_of_birth: "2015-03-09" }], ["student_id", "date_of_birth"], report,
    { layout: "comma", header: false, dateFormat: "MM/DD/YYYY", lineEnding: "lf", columns: {} });
  assert.equal(out.content.toString(), "'=HYPERLINK(1),03/09/2015\n");
  const fixed = stateFile.build([{ student_id: "9" }], ["student_id"], report, { layout: "tab", header: false, columns: { student_id: { fixed: "0420" } } });
  assert.equal(fixed.content.toString(), "0420\r\n");
});

test("settings keep only known choices, the report's own columns and real dates", () => {
  const s = stateFile.normalizeSettings({ layout: "xml", dateFormat: "DD.MM", columns: { student_id: { width: 9999, pad: "x" }, other: {} }, dates: ["2026-10-07", "not a date", "2026-10-07"], fileName: "../{school}_x" }, ["student_id"]);
  assert.equal(s.layout, "comma");
  assert.equal(s.dateFormat, "YYYYMMDD");
  assert.deepEqual(Object.keys(s.columns), ["student_id"]);
  assert.equal(s.columns.student_id.width, null);
  assert.equal(s.columns.student_id.pad, "auto");
  assert.deepEqual(s.dates, ["2026-10-07"]);
  assert.equal(s.fileName.includes("/"), false);
  assert.equal(stateFile.fileNameFor("{school}_{report}_{date}", { school: "Lincoln High", report: "Oct count", day: "2026-10-07" }), "Lincoln_High_Oct_count_20261007");
});

test("a made file is stored locked and opens back to the same bytes", () => {
  const before = process.env.SETTINGS_ENCRYPTION_KEY;
  process.env.SETTINGS_ENCRYPTION_KEY = "a".repeat(64);
  try {
    const content = Buffer.from("LOCAL_ID,SEX\r\n1001,M\r\n");
    const locked = stateFile.lock(content);
    assert.equal(locked.includes("1001"), false);
    assert.deepEqual(stateFile.unlock(locked), content);
  } finally {
    if (before === undefined) delete process.env.SETTINGS_ENCRYPTION_KEY; else process.env.SETTINGS_ENCRYPTION_KEY = before;
  }
});

test("a file is due on a count date or its repeating schedule, from the chosen hour", () => {
  const day = (isoDate, weekday, dayOfMonth, hour = 9) => ({ isoDate, hour, weekday, day: dayOfMonth, daysInMonth: 30 });
  const count = stateFile.normalizeSettings({ dates: ["2026-10-07"], sendHour: 6 }, []);
  assert.equal(stateFile.dueToday(count, day("2026-10-07", 3, 7)), true);
  assert.equal(stateFile.dueToday(count, day("2026-10-07", 3, 7, 5)), false); // before the hour
  assert.equal(stateFile.dueToday(count, day("2026-10-08", 4, 8)), false);
  const weekdays = stateFile.normalizeSettings({ repeat: "weekdays" }, []);
  assert.equal(stateFile.dueToday(weekdays, day("2026-11-16", 1, 16)), true);
  assert.equal(stateFile.dueToday(weekdays, day("2026-11-15", 0, 15)), false); // Sunday
  const weekly = stateFile.normalizeSettings({ repeat: "weekly", weekday: 5 }, []);
  assert.equal(stateFile.dueToday(weekly, day("2026-11-20", 5, 20)), true);
  const monthly = stateFile.normalizeSettings({ repeat: "monthly", monthDay: 31 }, []);
  assert.equal(stateFile.dueToday(monthly, day("2026-11-30", 1, 30)), true); // the last day of a 30-day month
  assert.equal(stateFile.normalizeSettings({ repeat: "hourly" }, []).repeat, "none");
});
