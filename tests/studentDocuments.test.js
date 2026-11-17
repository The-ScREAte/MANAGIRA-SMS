const test = require("node:test");
const assert = require("node:assert");
const docs = require("../utils/studentDocuments");

test("details: type, title, sharing and expiry are checked", () => {
  const d = docs.detailsFrom({ docType: "custody", title: "  Court   order ", expiresOn: "2027-02-30x", note: "a\r\nb" });
  assert.strictEqual(d.docType, "custody");
  assert.strictEqual(d.title, "Court order");
  assert.strictEqual(d.sharing, "managers", "a custody paper starts managers-only");
  assert.strictEqual(d.expiresOn, null);
  assert.strictEqual(d.note, "a\nb");
  const e = docs.detailsFrom({ docType: "nope", sharing: "everyone" });
  assert.strictEqual(e.docType, "other");
  assert.strictEqual(e.sharing, "staff");
  assert.strictEqual(e.title, "Other");
});

test("files: papers and pictures only", () => {
  const file = (name, size = 10) => ({ originalname: name, size, buffer: Buffer.alloc(1) });
  assert.strictEqual(docs.fileProblem(file("card.PDF")), null);
  assert.strictEqual(docs.fileProblem(file("photo.heic")), null);
  assert.match(docs.fileProblem(file("run.exe")), /PDF/);
  assert.match(docs.fileProblem(file("page.html")), /PDF/);
  assert.match(docs.fileProblem(file("big.pdf", 16 * 1024 * 1024)), /larger/);
  assert.match(docs.fileProblem(null), /Choose/);
});

test("managers-only documents need a manager or supervisor", () => {
  const as = (role) => ({ session: { userRole: role } });
  const doc = { shared_with: "managers" };
  assert.strictEqual(docs.visibleTo(as("Teacher"))(doc), false);
  assert.strictEqual(docs.visibleTo(as("Supervisor"))(doc), true);
  assert.strictEqual(docs.visibleTo(as("Teacher"))({ shared_with: "family" }), true);
});

test("expiry flags", () => {
  const past = docs.present({ document_id: 1, student_id: 2, doc_type: "insurance", title: "t", file_name: "f", expires_on: "2000-01-01", shared_with: "staff" });
  assert.strictEqual(past.expired, true);
  const soon = new Date(Date.now() + 5 * 86400000).toISOString().slice(0, 10);
  assert.strictEqual(docs.present({ document_id: 1, student_id: 2, doc_type: "x", title: "t", file_name: "f", expires_on: soon, shared_with: "staff" }).expiresSoon, true);
});
