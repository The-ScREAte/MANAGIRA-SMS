const test = require("node:test");
const assert = require("node:assert/strict");

// The question builder saves several right answers as a JSON list; the student's answer must match it.
const { evaluateResponse } = require("../controllers/studentController");

const question = (key) => ({ question_type: "multiple_choice", answer_key: key, marks: 2, options_json: ["2", "3", "4"] });

test("a multiple-choice question saved as a JSON list marks the right answers correct", () => {
  const key = JSON.stringify(["2", "3"]);
  assert.equal(evaluateResponse(question(key), ["2", "3"]).awardedMarks, 2);
  assert.equal(evaluateResponse(question(key), "3,2").awardedMarks, 2);
  assert.equal(evaluateResponse(question(key), ["2"]).awardedMarks, 0);
  assert.equal(evaluateResponse(question(key), ["2", "3", "4"]).awardedMarks, 0);
});

test("an older comma-separated key still marks correctly", () => {
  assert.equal(evaluateResponse(question("2,3"), ["3", "2"]).awardedMarks, 2);
  assert.equal(evaluateResponse(question("2,3"), ["4"]).awardedMarks, 0);
});
