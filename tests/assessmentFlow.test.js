const test = require("node:test");
const assert = require("node:assert");
const questionMedia = require("../utils/questionMedia");
const assessmentApproval = require("../utils/assessmentApproval");

const KEY = "images/questions/63/0f8fad5b-d9cb-469f-a165-70867728950e.png";

test("a picture question keeps only this school's pictures and needs an answer per spot", () => {
  const label = (labels, key = KEY) => questionMedia.checkMedia({ questionType: "image_label", media: { image: { key }, labels } }, 63);
  assert.match(label([]).error, /click the picture/);
  assert.match(questionMedia.checkMedia({ questionType: "image_label", media: null }, 63).error, /add the picture/);
  assert.match(label([{ x: 0.2, y: 0.3, answer: "" }]).error, /spot 1/);
  assert.match(label([{ x: 0.2, y: 0.3, answer: "Heart" }], "images/questions/64/0f8fad5b-d9cb-469f-a165-70867728950e.png").error, /couldn't be used/);
  assert.match(label([{ x: 0.2, y: 0.3, answer: "Heart" }], "../../etc/passwd").error, /couldn't be used/);
  const ok = label([{ x: 1.7, y: -2, answer: "  heart / the   heart " }, { x: 0.5, y: 0.5, answer: "lung" }]);
  assert.strictEqual(ok.error, undefined);
  assert.deepStrictEqual(ok.media.labels[0], { x: 1, y: 0, answer: "heart / the heart" });
  assert.strictEqual(ok.answerKey, "heart / the heart | lung");
  const tooMany = label(Array.from({ length: questionMedia.MAX_LABELS + 1 }, () => ({ x: 0.1, y: 0.1, answer: "a" })));
  assert.match(tooMany.error, /at most/);
});

test("any question may carry a picture; spots only belong to picture questions", () => {
  const plain = questionMedia.checkMedia({ questionType: "short_text", media: { image: { key: KEY, alt: "Map" }, labels: [{ x: 0.1, y: 0.1, answer: "x" }] } }, 63);
  assert.deepStrictEqual(plain.media, { image: { key: KEY, alt: "Map" } });
  assert.deepStrictEqual(questionMedia.checkMedia({ questionType: "essay" }, 63), { media: null });
});

test("label answers earn an equal share of the marks, alternatives and case ignored", () => {
  const question = { marks: 4, media_json: { labels: [{ answer: "heart / the heart" }, { answer: "Lung" }] } };
  assert.strictEqual(questionMedia.markLabels(question, ["The  Heart", "lung"]).awardedMarks, 4);
  assert.strictEqual(questionMedia.markLabels(question, ["heart", "kidney"]).awardedMarks, 2);
  assert.strictEqual(questionMedia.markLabels(question, ["", ""]).awardedMarks, 0);
  // One spot answered: a string, not a list.
  assert.strictEqual(questionMedia.markLabels({ marks: 3, media_json: { labels: [{ answer: "Ghana" }] } }, "ghana").awardedMarks, 3);
  // Thirds round to cents.
  assert.strictEqual(questionMedia.markLabels({ marks: 1, media_json: { labels: [{ answer: "a" }, { answer: "b" }, { answer: "c" }] } }, ["a", "x", "x"]).awardedMarks, 0.33);
});

test("pages get a picture's signed link, never its answers unless asked", () => {
  const media = { image: { key: KEY, alt: "Heart" }, labels: [{ x: 0.4, y: 0.5, answer: "aorta" }] };
  const shown = questionMedia.forDisplay(media, (key) => `/public-image?key=${encodeURIComponent(key)}`);
  assert.strictEqual(shown.image.url, `/public-image?key=${encodeURIComponent(KEY)}`);
  assert.deepStrictEqual(shown.labels, [{ x: 0.4, y: 0.5 }]);
  assert.ok(!JSON.stringify(shown).includes("aorta"));
  assert.strictEqual(questionMedia.forDisplay(media, String, { withAnswers: true }).labels[0].answer, "aorta");
  assert.strictEqual(questionMedia.forDisplay(null, String), null);
});

test("a gradebook cell is posted, waiting for approval, or new from an online test", () => {
  assert.strictEqual(assessmentApproval.cellState({ score: "15.00", pending_since: null }), "posted");
  assert.strictEqual(assessmentApproval.cellState({ score: "15.00", pending_since: new Date(), pending_source: "teacher" }), "waiting");
  assert.strictEqual(assessmentApproval.cellState({ score: "4.00", pending_since: new Date(), pending_source: "online" }), "new");
  assert.strictEqual(assessmentApproval.cellState({ score: null, choice_label: "Yes", pending_since: null }), "posted");
  assert.strictEqual(assessmentApproval.cellState({ score: null, choice_label: null }), null);
});

test("parents see the posted score while a change waits; with the flow off, the score itself", () => {
  assert.strictEqual(assessmentApproval.visibleScore("ar", true), "CASE WHEN ar.pending_since IS NULL THEN ar.score ELSE ar.posted_score END");
  assert.strictEqual(assessmentApproval.visibleScore("ar", false), "ar.score");
  assert.strictEqual(assessmentApproval.waitingSql("r", false), "FALSE");
});

test("a subject's totals wait while any of its grades waits", () => {
  const rows = [
    { subject_id: 1, grade_waiting: false, total_percentage: "80", total_subject_score: "16", grade: "B" },
    { subject_id: 1, grade_waiting: true, total_percentage: "80", total_subject_score: "16", grade: "B" },
    { subject_id: 2, grade_waiting: false, total_percentage: "90", total_subject_score: "18", grade: "A" },
  ];
  assessmentApproval.hideWaitingTotals(rows);
  assert.deepStrictEqual(rows.map((row) => row.total_percentage), [null, null, "90"]);
  assert.deepStrictEqual(rows.map((row) => row.grade), [null, null, "A"]);
});

test("approving posts only the waiting scores of that assessment", async () => {
  const calls = [];
  const db = { query: async (sql, params) => { calls.push({ sql, params }); return { rows: [{ assessment_id: 9, student_id: 5 }] }; } };
  const approved = await assessmentApproval.approve(db, { organizationId: 63, assessmentIds: [9, "x"], userId: 240 });
  assert.deepStrictEqual(approved, [{ assessmentId: 9, studentId: 5 }]);
  assert.match(calls[0].sql, /pending_since IS NOT NULL/);
  assert.match(calls[0].sql, /SET pending_since = NULL/);
  assert.deepStrictEqual(calls[0].params, [63, [9], 240, null]);
  assert.deepStrictEqual(await assessmentApproval.approve(db, { organizationId: 63, assessmentIds: [] }), []);
});
