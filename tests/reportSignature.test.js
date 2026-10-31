const test = require("node:test");
const assert = require("node:assert/strict");
const { REPORT_SIGNATURE_TERM_ID, ensurePersistentReportSignatures } = require("../utils/reportSignature");

test("report signatures are migrated per class from the latest current-year term", async () => {
  let called = false;
  const db = {
    async query(sql, values) {
      called = true;
      assert.match(sql, /INSERT INTO report_settings/);
      assert.match(sql, /DISTINCT ON \(rs\.class_id\)/);
      assert.match(sql, /sy\.current DESC/);
      assert.match(sql, /ON CONFLICT \(organization_id, class_id, term_id\) DO NOTHING/);
      assert.deepEqual(values, [146, REPORT_SIGNATURE_TERM_ID]);
      return { rows: [] };
    },
  };

  await ensurePersistentReportSignatures(db, 146);
  assert.equal(called, true);
  assert.equal(REPORT_SIGNATURE_TERM_ID, -2);
});
