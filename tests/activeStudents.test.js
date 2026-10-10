const test = require("node:test");
const assert = require("node:assert");
const { activeStudentSql, countActiveStudents } = require("../utils/activeStudents");

test("active student filter excludes graduated and archived students", () => {
  const sql = activeStudentSql("s");
  assert.match(sql, /COALESCE\(s\.graduated, FALSE\) = FALSE/);
  assert.match(sql, /NOT EXISTS[\s\S]*archived_student_info[\s\S]*student_id = s\.student_id/);
});

test("countActiveStudents counts with the active filter", async () => {
  const seen = [];
  const db = { query: async (sql, params) => { seen.push(sql); return { rows: [{ cnt: 41 }] }; } };
  assert.strictEqual(await countActiveStudents(db, 7), 41);
  assert.ok(seen[0].includes("archived_student_info"));
});

test("countActiveStudents still drops graduated students without the archive table", async () => {
  const db = {
    query: async (sql) => {
      if (sql.includes("archived_student_info")) throw new Error('relation "archived_student_info" does not exist');
      assert.ok(sql.includes("COALESCE(graduated, FALSE) = FALSE"));
      return { rows: [{ cnt: 12 }] };
    },
  };
  assert.strictEqual(await countActiveStudents(db, 7), 12);
});

test("countActiveStudents returns 0 without an organization", async () => {
  assert.strictEqual(await countActiveStudents({ query: async () => { throw new Error("should not query"); } }, null), 0);
});
