// The help center's articles (utils/docs): every guide is complete, every link and picture is real,
// older addresses redirect, crawlable text presents Managira as a US company, and a development
// server on the hosted database never writes help content.
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const catalog = require("../utils/docs/catalog");
const { prepareArticle } = require("../utils/docs/present");

const ROOT = path.join(__dirname, "..");
const slugs = new Set(catalog.ARTICLES.map((a) => a.slug));
const topics = new Set(catalog.TOPICS.map((t) => t.name));
const rows = catalog.syncRows();

test("every guide has a unique address, a known topic, a short summary and content", () => {
  assert.equal(slugs.size, catalog.ARTICLES.length, "slugs are unique");
  for (const article of catalog.ARTICLES) {
    assert.match(article.slug, /^[a-z0-9-]+$/, article.slug);
    assert.ok(topics.has(article.topic), `${article.slug}: topic ${article.topic}`);
    assert.ok(article.title && article.title.length <= 90, `${article.slug}: title`);
    assert.ok(article.summary && article.summary.length <= 160, `${article.slug}: summary is ${article.summary && article.summary.length} characters`);
  }
  for (const row of rows) assert.ok(row.contentHtml.length > 200, `${row.slug} has content`);
  for (const topic of catalog.TOPICS) assert.ok(catalog.ARTICLES.some((a) => a.topic === topic.name), `${topic.name} has guides`);
});

test("related guides and links inside guides all exist", () => {
  for (const article of catalog.ARTICLES) {
    for (const other of article.related || []) assert.ok(slugs.has(other), `${article.slug} -> ${other}`);
  }
  for (const row of rows) {
    for (const [, slug] of row.contentHtml.matchAll(/href="\/legal\/user-documentation\/([^"#?]+)"/g)) {
      assert.ok(slugs.has(slug), `${row.slug} links to ${slug}`);
    }
  }
});

test("every screenshot a guide shows is in the repository, with its size recorded", () => {
  const manifest = JSON.parse(fs.readFileSync(path.join(ROOT, "public/images/docs/manifest.json"), "utf8"));
  for (const article of catalog.ARTICLES) {
    for (const image of catalog.imagesOf(article)) {
      const file = image.replace(/^\/images\/docs\//, "");
      assert.ok(fs.existsSync(path.join(ROOT, "public", image)), `${article.slug}: ${image} exists`);
      assert.ok(Array.isArray(manifest[file]), `${article.slug}: ${file} has a size`);
    }
  }
});

test("older addresses redirect to a current guide", () => {
  for (const [from, to] of Object.entries(catalog.REDIRECTS)) {
    assert.ok(!slugs.has(from), `${from} is retired`);
    assert.ok(slugs.has(to), `${from} -> ${to}`);
  }
});

test("pages get anchors for every heading and an outline of the sections", () => {
  const out = prepareArticle("<h2>Before you start</h2><p>x</p><h3>Detail</h3><h2>Before you start</h2><img src=\"/images/docs/none.webp\" alt=\"\">");
  assert.match(out.html, /<h2 id="before-you-start">/);
  assert.match(out.html, /<h2 id="before-you-start-2">/);
  assert.match(out.html, /<h3 id="detail">/);
  assert.match(out.html, /loading="lazy"/);
  assert.deepEqual(out.toc.map((t) => t.id), ["before-you-start", "before-you-start-2"]);
});

test("what search engines and AI assistants read presents Managira as a US company", () => {
  const OTHER = /nigeria|ghana|lagos|abuja|accra|kumasi|kenya|nairobi|africa(?!'s talking)|paystack|mobile money|arkesel|\+233|\+234/i;
  for (const row of rows) assert.doesNotMatch(row.contentHtml + row.title + row.seoDescription, OTHER, row.slug);
  for (const file of ["public/llms.txt", "utils/aiDiscovery.js", "utils/managiraFAQ.js", "utils/managiraChatbotKnowledge.js", "views/home/landing.ejs",
    "views/legal&Compliance/userDocumentation.ejs", "views/legal&Compliance/requestDemo.ejs", "views/legal&Compliance/Help.ejs"]) {
    assert.doesNotMatch(fs.readFileSync(path.join(ROOT, file), "utf8"), /nigeria|ghana|kumasi|accra|lagos|\+234|\+233/i, file);
  }
});

test("only production or a database on this computer writes help content", () => {
  const before = { env: process.env.NODE_ENV, url: process.env.DB_CONNECTION_STRING };
  const check = (env, url) => {
    process.env.NODE_ENV = env;
    process.env.DB_CONNECTION_STRING = url;
    delete require.cache[require.resolve("../utils/documentationCenter")];
    return require("../utils/documentationCenter").documentationWritesAllowed();
  };
  try {
    assert.equal(check("production", "postgres://u:p@db.example.com/x"), true);
    assert.equal(check("development", "postgres://u:p@db.example.com/x"), false);
    assert.equal(check("development", "postgres://postgres@127.0.0.1:55432/postgres"), true);
  } finally {
    if (before.env === undefined) delete process.env.NODE_ENV; else process.env.NODE_ENV = before.env;
    if (before.url === undefined) delete process.env.DB_CONNECTION_STRING; else process.env.DB_CONNECTION_STRING = before.url;
    delete require.cache[require.resolve("../utils/documentationCenter")];
  }
});
