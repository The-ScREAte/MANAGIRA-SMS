const test = require("node:test");
const assert = require("node:assert/strict");
const { scriptSafeStringify, TEMPLATE_JSON } = require("../utils/safeJson");
const { withinScope, teacherScope } = require("../utils/classScope");

test("template JSON can't end a script block or an attribute, and reads back the same", () => {
  const value = { name: `</script><svg onload=alert(2)>`, note: `it's "quoted" & <b>bold</b>`, list: [1, null, true], line: `a${String.fromCharCode(0x2028)}b` };
  const out = scriptSafeStringify(value);
  assert.ok(!/[<>&']/.test(out), "no <, >, & or ' left");
  assert.ok(!out.includes(String.fromCharCode(0x2028)));
  assert.deepEqual(JSON.parse(out), value);
  assert.equal(TEMPLATE_JSON.stringify(undefined), undefined);
  assert.deepEqual(TEMPLATE_JSON.parse(TEMPLATE_JSON.stringify(value, null, 2)), value);
});

const teacher = (userId) => ({ session: { userRole: "Teacher", userId, organizationId: 9 } });
// user 5 teaches subject 51 in class 1 and is the main teacher of class 2 (subjects 61, 62).
const db = {
  query: async (sql, params) => {
    if (/FROM user_classes/.test(sql)) return { rows: params[0] === 5 ? [{ class_id: 1, main: false }, { class_id: 2, main: true }] : [] };
    if (/FROM user_subjects/.test(sql)) return { rows: params[0] === 5 ? [{ subject_id: 51, class_id: 1 }] : [] };
    if (/FROM subjects/.test(sql)) return { rows: ({ 51: [{ class_id: 1 }], 52: [{ class_id: 1 }], 61: [{ class_id: 2 }], 71: [{ class_id: 3 }] })[params[0]] || [] };
    throw new Error("unexpected query");
  },
};

test("a teacher works only in their classes, and on their subjects unless they are the main teacher", async () => {
  const scope = await teacherScope(db, teacher(5));
  const can = (named) => withinScope(db, 9, scope, named);
  assert.equal(await can({ classId: 1, subjectId: 51 }), true, "their subject in their class");
  assert.equal(await can({ classId: 1, subjectId: 52 }), false, "another teacher's subject in the same class");
  assert.equal(await can({ classId: 2, subjectId: 61 }), true, "any subject of the class they lead");
  assert.equal(await can({ classId: 3 }), false, "a class they aren't assigned to");
  assert.equal(await can({ classId: 3, subjectId: 71 }), false);
  assert.equal(await can({ subjectId: 71 }), false, "a subject by its number alone");
  assert.equal(await can({}), true, "a request naming neither is not this guard's business");
  assert.equal(await can({ subjectId: 999 }), true, "an unknown subject is for the page to answer");
});

test("only teachers are limited by class", async () => {
  assert.equal(await teacherScope(db, { session: { userRole: "Manager", userId: 1, organizationId: 9 } }), null);
  assert.equal(await teacherScope(db, { session: { userRole: "Supervisor", userId: 1, organizationId: 9 } }), null);
  const stranger = await teacherScope(db, teacher(77));
  assert.equal(await withinScope(db, 9, stranger, { classId: 1 }), false);
});
