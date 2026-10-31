const test = require("node:test");
const assert = require("node:assert/strict");
const { ensureStudentContactMethodsSchema } = require("../utils/studentContactMethods");

test("student contact schema adds names and is initialized once with uniqueness and lookup indexes", async () => {
  const statements = [];
  const fakeDb = {
    async query(statement) {
      statements.push(statement);
      return { rows: [] };
    },
  };

  await Promise.all([
    ensureStudentContactMethodsSchema(fakeDb),
    ensureStudentContactMethodsSchema(fakeDb),
  ]);
  await ensureStudentContactMethodsSchema(fakeDb);

  assert.equal(statements.length, 4);
  assert.match(statements[0], /CREATE TABLE IF NOT EXISTS student_contact_methods/);
  assert.match(statements[0], /contact_type IN \('email', 'phone'\)/);
  assert.match(statements[0], /contact_name VARCHAR\(160\) NOT NULL/);
  assert.match(statements[1], /ADD COLUMN IF NOT EXISTS contact_name/);
  assert.match(statements[2], /UNIQUE INDEX IF NOT EXISTS/);
  assert.match(statements[3], /student_contact_methods_student_idx/);
});
