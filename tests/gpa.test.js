"use strict";
// GPA the way registrars work it out (utils/gpa.js): quality points (grade points × credits) over
// credits, a term's own courses for its GPA, every course to date for the cumulative GPA.
const test = require("node:test");
const assert = require("node:assert/strict");
const gpa = require("../utils/gpa");

test("each course counts by its credits: quality points over credits", () => {
  // 4.0 × 3 + 3.0 × 4 + 2.0 × 3 + 3.7 × 3 = 12 + 12 + 6 + 11.1 = 41.1 over 13 credits = 3.1615…
  const items = [{ grade: "A", credits: 3 }, { grade: "B", credits: 4 }, { grade: "C", credits: 3 }, { grade: "A-", credits: 3 }];
  const totals = gpa.totalsOf(items);
  assert.equal(totals.unweighted, 3.16);
  assert.equal(totals.qualityPoints, 41.1);
  assert.equal(totals.gpaCredits, 13);
  assert.equal(totals.attempted, 13);
  assert.equal(totals.earned, 13);
  // Without credits every course counts once (the GPA a school without course credits gets).
  assert.equal(gpa.totalsOf(items.map(({ grade }) => ({ grade }))).unweighted, 3.18, "(4 + 3 + 2 + 3.7) / 4 = 3.175");
});

test("the cumulative GPA is all quality points over all credits, never an average of term GPAs", () => {
  const rows = [
    { term: "Fall", grade: "A", credits: 1 },
    { term: "Spring", grade: "C", credits: 1 }, { term: "Spring", grade: "C", credits: 1 }, { term: "Spring", grade: "C", credits: 1 },
  ];
  const { terms, all } = gpa.termByTerm(rows, (r) => r.term);
  assert.equal(terms.Fall.unweighted, 4);
  assert.equal(terms.Spring.unweighted, 2);
  assert.equal(terms.Fall.cumulative.unweighted, 4, "after the first term, the cumulative is that term");
  assert.equal(terms.Spring.cumulative.unweighted, 2.5, "(4 + 2 + 2 + 2) / 4, not (4 + 2) / 2 = 3");
  assert.equal(all.unweighted, 2.5);
  assert.equal(terms.Spring.cumulative.attempted, 4);
});

test("F counts with no points and earns no credit; Pass earns credit with no GPA; withdrawn and incomplete count for nothing", () => {
  const totals = gpa.totalsOf([
    { grade: "A", credits: 1 }, { grade: "F", credits: 1 }, { grade: "P", credits: 0.5 }, { grade: "W", credits: 1 }, { grade: "INC", credits: 1 }, { grade: "", credits: 1 }, { grade: "-", credits: 1 },
  ]);
  assert.equal(totals.unweighted, 2, "(4 + 0) / 2: the F counts, the Pass doesn't");
  assert.equal(totals.gpaCredits, 2);
  assert.equal(totals.attempted, 2.5, "A, F and the Pass");
  assert.equal(totals.earned, 1.5, "A and the Pass");
  assert.equal(gpa.totalsOf([{ grade: "NP", credits: 1 }]).earned, 0);
  assert.equal(gpa.totalsOf([{ grade: "2" }]).unweighted, null, "a number on a school's own scale has no grade points");
});

test("weighted GPA adds Honors and AP points to passing grades only, weighted by credits", () => {
  const items = [{ grade: "B+", level: "ap", credits: 1 }, { grade: "A-", level: "honors", credits: 0.5 }, { grade: "F", level: "ap", credits: 1 }];
  const totals = gpa.totalsOf(items);
  // unweighted: 3.3 + 3.7 × 0.5 + 0 = 5.15 over 2.5 = 2.06; weighted: 4.3 + 4.2 × 0.5 + 0 = 6.4 over 2.5 = 2.56
  assert.equal(totals.unweighted, 2.06);
  assert.equal(totals.weighted, 2.56);
  assert.equal(gpa.totalsOf([{ grade: "A", level: null }]).weighted, null, "no weighted GPA without a weighted subject");
});

test("GPA rounds half up once, exactly, with no floating point error", () => {
  // 2.625 exactly: binary floating point would give 2.62 with Math.round(2.625 * 100) / 100 on some inputs.
  assert.equal(gpa.totalsOf([{ grade: "A", level: "ap" }, { grade: "B", level: "honors" }, { grade: "C" }, { grade: "F", level: "ap" }]).weighted, 2.63);
  // (1.0 × 14.75 + 1.3 × 0.25) / 15 = 1.005 exactly; in floating point 1.005 × 100 is 100.4999…, which
  // Math.round(x * 100) / 100 turns into 1.00. Worked out in whole numbers it's 1.01.
  assert.equal(gpa.totalsOf([{ grade: "D", credits: 14.75 }, { grade: "D+", credits: 0.25 }]).unweighted, 1.01);
  // 3.3 + 3.7 + 4.0 = 11 over 3 = 3.666… → 3.67
  assert.equal(gpa.totalsOf([{ grade: "B+" }, { grade: "A-" }, { grade: "A" }]).unweighted, 3.67);
  // 3.0 + 3.3 = 6.3 over 2 = 3.15 (3.1499… in floating point)
  assert.equal(gpa.totalsOf([{ grade: "B" }, { grade: "B+" }]).unweighted, 3.15);
});

test("credits are a number from 0 to 20, else 1", () => {
  assert.deepEqual([null, undefined, "", "0.5", 2, 0, 20, 21, -1, "x"].map(gpa.creditsOf), [1, 1, 1, 0.5, 2, 0, 20, 1, 1, 1]);
  // A course of 0 credits doesn't move the GPA.
  assert.equal(gpa.totalsOf([{ grade: "A", credits: 1 }, { grade: "F", credits: 0 }]).unweighted, 4);
  assert.equal(gpa.totalsOf([{ grade: "A", credits: 0 }]).unweighted, null, "no credits, no GPA");
});

// A stand-in database: answers the GPA module's reads and records its writes.
function fakeDb({ levels = [], credits = [] } = {}) {
  const writes = [];
  return {
    writes,
    async query(sql, params = []) {
      if (/information_schema\.columns[\s\S]*gpa_level/.test(sql)) return { rows: [{ n: 3 }] };
      if (/information_schema\.columns[\s\S]*gpa_credits/.test(sql)) return { rows: [{ "?column?": 1 }] };
      if (/FROM gpa_settings/.test(sql)) return { rows: [] };
      if (/SELECT subject_id, gpa_level FROM subjects/.test(sql)) return { rows: levels };
      if (/SELECT subject_id, gpa_credits FROM subjects/.test(sql)) return { rows: credits };
      writes.push({ sql: sql.replace(/\s+/g, " ").trim(), params });
      return { rows: [] };
    },
  };
}
const features = require("../utils/shards/features");

test("saving credits keeps 0 to 20 in hundredths, empty puts a course back to 1, and nothing else is written", async () => {
  const isOn = features.isOn;
  features.isOn = () => true;
  try {
    const db = fakeDb();
    const result = await gpa.saveSettings(db, 7, { credits: { 11: "1", 12: "0.505", 13: "", 14: "25", 15: "-1", x: "2" } }, 1);
    const update = db.writes.find((w) => /SET gpa_credits/.test(w.sql));
    assert.ok(update, "credits are saved");
    assert.deepEqual(update.params, [7, [11, 12, 13], [1, 0.51, null]], "25 and -1 are refused; empty means 1 again");
    assert.match(update.sql, /organization_id = \$1/, "only this school's subjects");
    assert.match(update.sql, /IS DISTINCT FROM/, "an unchanged course isn't written");
    assert.equal(result.credits, 3);
  } finally {
    features.isOn = isOn;
  }
});

test("a school without course credits saves none and counts every course once", async () => {
  const isOn = features.isOn;
  features.isOn = (key) => key !== "gpa_credits";
  try {
    const db = fakeDb({ credits: [{ subject_id: 11, gpa_credits: "3.00" }] });
    await gpa.saveSettings(db, 7, { credits: { 11: "3" } }, 1);
    assert.equal(db.writes.some((w) => /gpa_credits/.test(w.sql)), false);
    const rows = [{ subject_id: 11, grade: "A", year_label: "2025", term_name: "Fall" }, { subject_id: 12, grade: "C", year_label: "2025", term_name: "Fall" }];
    const summary = await gpa.transcriptGpa(db, 7, rows);
    assert.equal(summary.usesCredits, false);
    assert.equal(summary.all.unweighted, 3, "(4 + 2) / 2, the stored 3 credits ignored");
    assert.equal(rows[0].credits, null, "no credits column");
  } finally {
    features.isOn = isOn;
  }
});

test("a transcript with course credits: each term, the cumulative to date, and every row's credits", async () => {
  const isOn = features.isOn;
  features.isOn = () => true;
  try {
    const db = fakeDb({ levels: [{ subject_id: 11, gpa_level: "ap" }], credits: [{ subject_id: 11, gpa_credits: "3.00" }] });
    const fall = { year_label: "2025", term_name: "Fall", start_date: "2025-08-18", end_date: "2025-12-19" };
    const spring = { year_label: "2025", term_name: "Spring", start_date: "2026-01-05", end_date: "2026-05-29" };
    const rows = [{ ...fall, subject_id: 11, grade: "B" }, { ...fall, subject_id: 12, grade: "A" }, { ...spring, subject_id: 12, grade: "C" }];
    const summary = await gpa.transcriptGpa(db, 7, rows);
    const [fallKey, springKey] = [gpa.termKeyOf(fall), gpa.termKeyOf(spring)];
    assert.equal(summary.usesCredits, true);
    assert.deepEqual(rows.map((r) => r.credits), [3, 1, 1], "unset credits print as 1");
    assert.equal(summary.terms[fallKey].unweighted, 3.25, "(3 × 3 + 4 × 1) / 4");
    assert.equal(summary.terms[fallKey].weighted, 4, "(4 × 3 + 4 × 1) / 4: AP adds 1 to the B");
    assert.equal(summary.terms[springKey].unweighted, 2);
    assert.equal(summary.terms[springKey].cumulative.unweighted, 3, "(9 + 4 + 2) / 5");
    assert.equal(summary.terms[springKey].cumulative.earned, 5);
    assert.equal(summary.all.unweighted, 3);
  } finally {
    features.isOn = isOn;
  }
});
