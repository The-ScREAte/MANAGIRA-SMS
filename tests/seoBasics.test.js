// Search-engine basics, offline: the notifier (HTTP stubbed), the sitemap, the daily update and the
// verification tags. Nothing here calls an outside service or needs a database.
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const ejs = require("ejs");

const ROOT = path.resolve(__dirname, "..");
const PROD = { NODE_ENV: "production", INDEXNOW_KEY: "abcdef1234567890" };
const quiet = async (fn) => { const log = console.log; console.log = () => {}; try { return await fn(); } finally { console.log = log; } };

test("the notifier is inert unless production, a key and not switched off", async () => {
  const { notifyAll } = require("../utils/searchNotify");
  const calls = [];
  const transport = async (c) => { calls.push(c); return 200; };
  for (const env of [{}, { NODE_ENV: "production" }, { INDEXNOW_KEY: "k" }, { ...PROD, NODE_ENV: "development" }, { ...PROD, SEARCH_NOTIFY: "off" }]) {
    assert.equal((await notifyAll(["https://managira.com/"], "t", { env, transport })).skipped, "off");
  }
  assert.equal(calls.length, 0);
});

test("one request: de-duplicated, managira.com only, key file location, batches of 10,000", async () => {
  const { notifyAll } = require("../utils/searchNotify");
  const calls = [];
  const transport = async (c) => { calls.push(c); return 200; };
  const urls = ["https://managira.com/a", "https://managira.com/a", "http://managira.com/b", "https://evil.com/x", "not a url", "https://managira.com/c#frag", "https://managira.com/c"];
  const r = await quiet(() => notifyAll(urls, "t", { env: PROD, transport }));
  assert.equal(calls.length, 1);
  assert.equal(calls[0].hostname, "api.indexnow.org");
  assert.equal(calls[0].path, "/IndexNow");
  assert.deepEqual(calls[0].body.urlList, ["https://managira.com/a", "https://managira.com/c"]);
  assert.equal(calls[0].body.host, "managira.com");
  assert.equal(calls[0].body.keyLocation, "https://managira.com/abcdef1234567890.txt");
  assert.equal(r.sent, 2);
  calls.length = 0;
  const many = Array.from({ length: 10001 }, (_, i) => `https://managira.com/p${i}`);
  await quiet(() => notifyAll(many, "t", { env: PROD, transport }));
  assert.deepEqual(calls.map((c) => c.body.urlList.length).sort((a, b) => b - a), [10000, 1]);
});

test("school addresses are sent for their own host, together", async () => {
  const { notifyAll } = require("../utils/searchNotify");
  const calls = [];
  await quiet(() => notifyAll(["https://managira.com/", "https://one.managira.com/"], "t", { env: PROD, transport: async (c) => { calls.push(c.body); return 202; } }));
  assert.deepEqual(calls.map((c) => c.host).sort(), ["managira.com", "one.managira.com"]);
});

test("a 5xx or 429 is retried once; failures never throw", async () => {
  const { notifyAll } = require("../utils/searchNotify");
  let n = 0;
  const r = await quiet(() => notifyAll(["https://managira.com/"], "t", { env: PROD, retryPauseMs: 1, transport: async () => (++n === 1 ? 503 : 200) }));
  assert.equal(n, 2); assert.equal(r.ok, true);
  n = 0;
  const bad = await quiet(() => notifyAll(["https://managira.com/"], "t", { env: PROD, retryPauseMs: 1, transport: async () => { n++; return 500; } }));
  assert.equal(n, 2); assert.equal(bad.ok, false);
  const thrown = await quiet(() => notifyAll(["https://managira.com/"], "t", { env: PROD, retryPauseMs: 1, transport: async () => { throw new Error("boom"); } }));
  assert.equal(thrown.ok, false);
});

test("the sitemap has real, steady dates and no changefreq/priority", async () => {
  const ai = require("../utils/aiDiscovery");
  const db = { query: async () => ({ rows: [
    { slug: "a", title: "A", topic: "T", updated_at: "2026-03-04T10:00:00Z" },
    { slug: "b", title: "B", topic: "T", updated_at: "2026-05-06T10:00:00Z" },
  ] }) };
  const xml = await ai.rootSitemap(db);
  assert.match(xml, /<lastmod>2026-03-04<\/lastmod>/);
  assert.match(xml, /<lastmod>2026-05-06<\/lastmod>/);
  assert.ok(!/changefreq|priority/.test(xml));
  const locs = [...xml.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1]);
  assert.ok(locs.every((l) => l.startsWith("https://managira.com/")));
  assert.equal(new Set(locs).size, locs.length);
  const today = new Date().toISOString().slice(0, 10);
  const mods = [...xml.matchAll(/<lastmod>([^<]+)<\/lastmod>/g)].map((m) => m[1]);
  assert.ok(new Set(mods).size > 1 && mods.some((m) => m !== today), "dates are not all 'today'");
});

test("the daily update sends only new or changed pages, once", async () => {
  const { runSearchIndexSync } = require("../utils/searchIndexSync");
  const store = new Map();
  const articles = [{ slug: "a", updated_at: "2026-03-04T10:00:00Z" }];
  const db = { query: async (sql, params) => {
    if (/FROM documentation_articles/.test(sql)) return { rows: articles };
    if (/FROM organizations/.test(sql)) return { rows: [{ nickname: "demo" }] };
    if (/^SELECT url, last_hash/.test(sql)) return { rows: [...store].map(([url, last_hash]) => ({ url, last_hash })) };
    if (/INSERT INTO search_index_state/.test(sql)) { params[0].forEach((u, i) => store.set(u, params[1][i])); return { rows: [] }; }
    return { rows: [] };
  } };
  const sent = [];
  const opts = { env: PROD, transport: async (c) => { sent.push(c.body); return 200; } };
  await quiet(() => runSearchIndexSync(db, opts));
  const first = sent.flatMap((b) => b.urlList);
  assert.ok(first.includes("https://managira.com/legal/user-documentation/a") && first.includes("https://demo.managira.com/"));
  sent.length = 0;
  await quiet(() => runSearchIndexSync(db, opts));
  assert.equal(sent.length, 0, "nothing changed, nothing sent");
  articles[0].updated_at = "2026-06-01T00:00:00Z";
  require("../utils/aiDiscovery"); // cached sitemap is not used by publicUrls
  await quiet(() => runSearchIndexSync(db, opts));
  assert.deepEqual(sent.flatMap((b) => b.urlList), ["https://managira.com/legal/user-documentation/a"]);
});

test("the daily update works when the state table cannot be made, and when off", async () => {
  const { runSearchIndexSync } = require("../utils/searchIndexSync");
  const broken = { query: async () => { throw new Error('relation "search_index_state" does not exist'); } };
  const origError = console.error; console.error = () => {};
  try {
    assert.equal((await runSearchIndexSync(broken, { env: PROD, transport: async () => 200 })).skipped, "no-table");
  } finally { console.error = origError; }
  assert.equal((await runSearchIndexSync(broken, { env: {} })).skipped, "off");
});

test("verification tags: Google/Yandex only when set, Bing's built-in token always, all escaped", async () => {
  const file = path.join(ROOT, "views/partials/siteVerification.ejs");
  const saved = { ...process.env };
  try {
    delete process.env.GOOGLE_SITE_VERIFICATION; delete process.env.BING_SITE_VERIFICATION; delete process.env.YANDEX_SITE_VERIFICATION;
    const bare = await ejs.renderFile(file, {});
    assert.ok(!/google-site-verification|yandex-verification/.test(bare));
    assert.match(bare, /name="msvalidate\.01" content="146B7F9A25824DB80293855FC4DF338E"/);
    process.env.GOOGLE_SITE_VERIFICATION = 'g"><script>1</script>'; process.env.BING_SITE_VERIFICATION = "b1"; process.env.YANDEX_SITE_VERIFICATION = "y1";
    const html = await ejs.renderFile(file, {});
    assert.match(html, /name="google-site-verification" content="g&#34;&gt;&lt;script&gt;/);
    assert.match(html, /name="msvalidate\.01" content="b1"/);
    assert.match(html, /name="yandex-verification" content="y1"/);
  } finally { process.env = saved; }
});

test("the home head: title, description, canonical, one robots, absolute image", async () => {
  const html = await ejs.renderFile(path.join(ROOT, "views/home/partials/top.ejs"), {
    title: "Managira SIS | K-12 Student Information System", description: "Managira is the cloud student information system for K-12 schools: records, attendance, grading, fees and Mira.",
    canonicalUrl: "https://managira.com/", assetUrl: (p) => p, cspNonce: "n",
  });
  const title = html.match(/<title>([^<]*)<\/title>/)[1];
  assert.ok(title.length <= 60 && /Managira/.test(title));
  const desc = html.match(/name="description" content="([^"]*)"/)[1];
  assert.ok(desc.length >= 70 && desc.length <= 160);
  assert.equal((html.match(/rel="canonical"/g) || []).length, 1);
  assert.equal((html.match(/name="robots" content="index, follow"/g) || []).length, 1);
  assert.match(html, /og:image" content="https:\/\/managira\.com\/images\//);
  assert.match(html, /<html lang="en">/);
});

test("public page descriptions fit 70-160 characters and titles 60", () => {
  const src = fs.readFileSync(path.join(ROOT, "controllers/legalController.js"), "utf8") + fs.readFileSync(path.join(ROOT, "server.js"), "utf8");
  const pairs = [...src.matchAll(/title: ['"]((?:Managira|About Managira|Mira|Privacy|Terms|Security|Subprocessors|Request)[^'"]*)['"],\s*description: ['"`]((?:[^'"`\\]|\\.)*)['"`]/g)];
  assert.ok(pairs.length >= 6);
  for (const [, title, description] of pairs) {
    const d = description.replace(/\\'/g, "'");
    assert.ok(title.length <= 60, `title too long: ${title}`);
    assert.ok(d.length >= 70 && d.length <= 160, `description ${d.length} chars for ${title}`);
  }
});

test("robots.txt lists every sitemap and the IndexNow key route is guarded", () => {
  const robots = fs.readFileSync(path.join(ROOT, "public/robots.txt"), "utf8");
  for (const s of ["sitemap.xml", "sitemap-schools.xml", "sitemap-schools-index.xml"]) assert.match(robots, new RegExp(`^Sitemap: https://managira\\.com/${s}$`, "m"));
  const server = fs.readFileSync(path.join(ROOT, "server.js"), "utf8");
  assert.match(server, /\^\[A-Za-z0-9-\]\{8,128\}\$\/\.test\(process\.env\.INDEXNOW_KEY/);
});
