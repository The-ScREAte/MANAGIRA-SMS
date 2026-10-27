const test = require("node:test");
const assert = require("node:assert");
const { pack, createPacker, splitMarkup, bodyOf, headOf } = require("../public/js/capturePack");
const { parseCapture } = require("../controllers/appDemoController");

// A page with a workspace pane: its markup sits escaped in the iframe's srcdoc.
const rows = (n, checked) => Array.from({ length: n }, (_, i) => `&lt;tr&gt;&lt;td&gt;Student ${i}&lt;/td&gt;&lt;td&gt;&lt;input type=&quot;checkbox&quot;${i === checked ? " checked" : ""}&gt;&lt;/td&gt;&lt;/tr&gt;`).join("");
const page = (checked) => `<main><h1>Class</h1><iframe srcdoc="&lt;table&gt;${rows(3000, checked)}&lt;/table&gt;"></iframe></main>`;
const head = `<style>${"body{color:#111}".repeat(5000)}</style>`;
const capture = () => ({
  v: 1, title: "Class", url: "https://x.test/", viewport: { w: 1440, h: 900 },
  heads: [head, head + "<title>2</title>"],
  states: [0, 1, 2].map((k) => ({ head: k === 2 ? 1 : 0, body: page(k * 100), htmlAttrs: {}, bodyAttrs: {}, scrollY: 0 })),
  links: [{ from: 0, to: 1, el: "1" }],
  guide: [{ from: 0, to: 1, el: "1", label: "Tick" }],
});

test("packing is lossless and shares what views have in common", () => {
  const data = capture();
  const packed = pack(data);
  data.states.forEach((st, i) => {
    assert.strictEqual(bodyOf(packed, i), st.body);
    assert.strictEqual(headOf(packed, packed.states[i].head), data.heads[st.head]);
  });
  const total = packed.pool.reduce((n, p) => n + p.length, 0);
  const raw = data.heads.join("").length + data.states.reduce((n, s) => n + s.body.length, 0);
  assert.ok(total < raw / 2.5, `pool ${total} should be far smaller than ${raw}`);
  assert.ok(!("heads" in packed));
  assert.deepStrictEqual(pack(packed), packed, "packing again changes nothing");
});

test("escaped pane markup is cut into small pieces", () => {
  const pieces = splitMarkup(page(5));
  assert.ok(pieces.length > 50);
  assert.ok(Math.max(...pieces.map((p) => p.length)) <= 65536);
  assert.strictEqual(pieces.join(""), page(5));
});

test("the recorder's incremental packer and the final pack agree", () => {
  const packer = createPacker();
  const data = capture();
  const live = { ...data, headParts: data.heads.map((h) => packer.add(h)), states: data.states.map((s) => ({ ...s, parts: packer.add(s.body), body: undefined })), pool: packer.pool };
  delete live.heads;
  const packed = pack(live);
  data.states.forEach((st, i) => assert.strictEqual(bodyOf(packed, i), st.body));
});

test("the server accepts packed captures and keeps the guide ahead of the views", () => {
  const packed = pack(capture());
  const parsed = parseCapture(JSON.stringify(packed));
  assert.ok(parsed);
  assert.deepStrictEqual(parsed.headParts, packed.headParts);
  const json = JSON.stringify(pack(parsed));
  assert.ok(json.indexOf('"guide":[') < json.indexOf('"states":['));
  // A piece number outside the pool is refused.
  const bad = JSON.parse(JSON.stringify(packed));
  bad.headParts[0].push(bad.pool.length + 5);
  assert.strictEqual(parseCapture(JSON.stringify(bad)), null);
  // Older unpacked captures still pass.
  assert.ok(parseCapture(JSON.stringify(capture())));
});
