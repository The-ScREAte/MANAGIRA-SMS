const test = require("node:test");
const assert = require("node:assert");
const { commonController: common } = require("../controllers/commonController");
const flow = require("../controllers/assessmentFlowController");
const { requireQuestionScope } = require("../utils/questionScope");
const { checkResourceFile } = require("../utils/resourceFileRules");

const res = () => {
  const out = { code: 200, body: null };
  out.status = (c) => { out.code = c; return out; };
  out.json = (b) => { out.body = b; return out; };
  out.locals = { publicImageUrl: (k) => k };
  return out;
};
const session = (role, userId = 7) => ({ organizationId: 63, userId, userRole: role });

test("only a manager or supervisor reviews a question set, and never their own", async () => {
  const calls = [];
  const db = {
    query: async (sql, params) => {
      calls.push(/reviewed_by = \$3/.test(sql) ? "REVIEW" : "other");
      if (/SELECT created_by/.test(sql)) return { rows: [{ created_by: 7 }] };
      if (/reviewed_by = \$3/.test(sql)) return { rows: [{ question_set_id: 5, review_status: "approved" }] };
      return { rows: [] };
    },
  };
  const review = async (role, userId) => { const r = res(); await common.reviewAssessmentQuestionSet({ session: session(role, userId), body: { questionSetId: 5, action: "approve" } }, r, db); return r; };
  assert.strictEqual((await review("Teacher", 9)).code, 403, "a teacher can't review");
  const own = await review("Manager", 7);
  assert.strictEqual(own.code, 403);
  assert.match(own.body.error, /Someone else/);
  assert.ok(!calls.includes("REVIEW"), "nothing was changed");
  const other = await review("Supervisor", 9);
  assert.strictEqual(other.code, 200);
  assert.strictEqual(other.body.success, true);
});

test("a teacher approves grades only for subjects they teach", async () => {
  const db = { query: async (sql, params) => {
    if (/FROM user_subjects/.test(sql)) return { rows: [{ subject_id: 3 }] };
    if (/FROM assessments WHERE/.test(sql)) return { rows: [{ subject_id: Number(params[1]) === 11 ? 3 : 4 }] };
    return { rows: [] };
  } };
  const gate = requireQuestionScope(db);
  const run = async (assessmentId) => { const r = res(); let passed = false; await gate({ session: session("Teacher"), query: {}, body: { assessmentId } }, r, () => { passed = true; }); return { passed, code: r.code }; };
  assert.deepStrictEqual(await run(11), { passed: true, code: 200 });
  assert.deepStrictEqual(await run(12), { passed: false, code: 403 });
  // A manager is not limited.
  const r = res(); let passed = false;
  await gate({ session: session("Manager"), query: {}, body: { assessmentId: 12 } }, r, () => { passed = true; });
  assert.ok(passed);
});

test("the question library follows the subjects a teacher teaches, like every other question action", async () => {
  const seen = [];
  const db = { query: async (sql, params) => { seen.push({ sql, params }); return { rows: [] }; } };
  await flow.library({ session: session("Teacher", 7), query: {} }, res(), db);
  await flow.librarySet({ session: session("Teacher", 7), params: { setId: "4" } }, res(), db);
  seen.forEach(({ sql, params }) => {
    assert.match(sql, /user_subjects/);
    assert.doesNotMatch(sql, /user_classes/);
    assert.ok(params.includes(7));
  });
  // A manager sees every set.
  const mgr = []; 
  await flow.library({ session: session("Manager", 8), query: {} }, res(), { query: async (sql, params) => { mgr.push(params); return { rows: [] }; } });
  assert.strictEqual(mgr[0][2], null);
});

test("attached files: allowed kinds, 10 MB, and the content has to match the name", () => {
  const file = (name, bytes, size) => ({ originalname: name, buffer: Buffer.from(bytes), size: size || bytes.length });
  assert.strictEqual(checkResourceFile(file("notes.pdf", "%PDF-1.7 hello")), null);
  assert.strictEqual(checkResourceFile(file("sheet.docx", [0x50, 0x4b, 0x03, 0x04, 1, 2])), null);
  assert.strictEqual(checkResourceFile(file("pic.PNG", [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0])), null);
  assert.strictEqual(checkResourceFile(file("a.txt", "plain words")), null);
  assert.match(checkResourceFile(file("virus.exe", "MZ....")), /Use a PDF/);
  assert.match(checkResourceFile(file("page.html", "<script>")), /Use a PDF/);
  assert.match(checkResourceFile(file("fake.pdf", "<html>not a pdf</html>")), /doesn't look like a PDF/);
  assert.match(checkResourceFile(file("fake.png", "MZ not a picture")), /doesn't look like a PNG/);
  assert.match(checkResourceFile(file("big.pdf", "%PDF-1.7", 11 * 1024 * 1024)), /under 10 MB/);
  assert.match(checkResourceFile(file("bin.txt", [65, 0, 66])), /doesn't look like a TXT/);
  assert.match(checkResourceFile({ originalname: "a.pdf" }), /Choose a file/);
});
