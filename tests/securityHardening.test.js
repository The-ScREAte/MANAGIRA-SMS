const test = require("node:test");
const assert = require("node:assert/strict");
const crypto = require("crypto");

const csp = require("../utils/contentSecurityPolicy");
const { crossSiteReason, isOwnHost } = require("../middleware/securityMiddleware");
const smsAuth = require("../utils/smsWebhookAuth");
const uploads = require("../utils/uploadSafety");
const { dbSslSettings } = require("../utils/dbSsl");

test("the Content-Security-Policy is enforced, names its sources and has no catch-all", () => {
  const value = csp.build({ env: { S3_BUCKET_NAME: "my-bucket", AWS_REGION: "us-east-1" }, miraOrigin: "https://mira.managira.com" });
  const parts = Object.fromEntries(value.split("; ").map((d) => [d.split(" ")[0], d.split(" ").slice(1)]));
  assert.deepEqual(parts["default-src"], ["'self'"]);
  assert.deepEqual(parts["object-src"], ["'none'"]);
  assert.deepEqual(parts["base-uri"], ["'self'"]);
  assert.deepEqual(parts["form-action"], ["'self'"]);
  assert.ok(parts["frame-ancestors"].includes("'self'"));
  assert.ok(parts["img-src"].includes("https://my-bucket.s3.us-east-1.amazonaws.com"), "the school storage bucket");
  assert.ok(parts["frame-src"].includes("https://mira.managira.com"), "Mira's panel");
  assert.ok(parts["script-src"].includes("https://js.stripe.com"));
  assert.equal(parts["report-uri"][0], "/csp-report");
  for (const [name, sources] of Object.entries(parts)) {
    for (const source of sources) {
      if (name === "frame-ancestors" && source === "https://*.managira.com") continue; // our own school sites
      assert.ok(!/^\*$|^https?:$|^https:\/\/\*$|\*\.[a-z]+$/.test(source) || source === "https://*.managira.com", `${name} has a wildcard: ${source}`);
    }
  }
  assert.ok(!parts["script-src"].includes("'unsafe-eval'"));
});

test("the policy mode can be switched to report-only or off, and enforce is the default", () => {
  const names = (env, nonce = "abc") => csp.headers({ env, nonce }).map((h) => h.name);
  assert.deepEqual(names({}), ["Content-Security-Policy"], "the strict policy alone is enforced by default");
  assert.deepEqual(names({ CSP_STRICT: "report-only" }), ["Content-Security-Policy", "Content-Security-Policy-Report-Only"]);
  assert.deepEqual(names({ CSP_STRICT: "off" }), ["Content-Security-Policy"]);
  assert.equal(names({ CSP_MODE: "report-only" })[0], "Content-Security-Policy-Report-Only");
  assert.equal(csp.headers({ env: { CSP_MODE: "report-only" }, nonce: "abc" })[1].value, csp.FRAMING_ONLY);
  assert.equal(csp.headers({ env: { CSP_MODE: "off" } })[0].value, csp.FRAMING_ONLY);
});

test("the enforced policy wants this response's nonce for scripts; the older one (kept as the fallback) allows inline scripts", () => {
  const [enforced] = csp.headers({ env: {}, nonce: "N0nce" });
  assert.match(enforced.value, /script-src 'self' 'nonce-N0nce' https:\/\/cdn\.jsdelivr\.net/);
  assert.ok(!/script-src[^;]*unsafe-inline/.test(enforced.value));
  assert.match(enforced.value, /style-src 'self' 'unsafe-inline'/);
  const [older, strictReport] = csp.headers({ env: { CSP_STRICT: "report-only" }, nonce: "N0nce" });
  assert.match(older.value, /script-src 'self' 'unsafe-inline'/);
  assert.ok(!older.value.includes("nonce-"));
  assert.match(strictReport.value, /'nonce-N0nce'/);
  assert.equal(csp.headers({ env: {} })[0].value.includes("unsafe-inline'"), true, "without a nonce it falls back to the older policy rather than blocking every script");
});

test("every inline script in a page carries the response's nonce", () => {
  const fs = require("fs"), path = require("path");
  const bare = [];
  const walk = (dir) => fs.readdirSync(dir, { withFileTypes: true }).forEach((e) => {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) return walk(full);
    if (!e.name.endsWith(".ejs")) return;
    fs.readFileSync(full, "utf8").split("\n").forEach((line, i) => {
      // A tag whose attributes hold <%= ... %> is read with those parts blanked, so their ">" is not taken as the tag's end.
      const text = line.replace(/<%[\s\S]*?%>/g, "@@");
      for (const m of text.matchAll(/<script(\s[^>]*)?>/g)) if (!/src=|nonce=/.test(m[1] || "")) bare.push(`${full}:${i + 1}`);
    });
  });
  walk(path.join(__dirname, "..", "views"));
  assert.deepEqual(bare, []);
});

test("a violation report becomes one short log line", () => {
  assert.equal(csp.reportLine({ "csp-report": { "effective-directive": "script-src-elem", "blocked-uri": "https://evil.example/x.js?q=1", "document-uri": "https://school.managira.com/a?secret=1" } }),
    "script-src-elem blocked https://evil.example/x.js?q=1 on https://school.managira.com/a");
  assert.equal(csp.reportLine({}), "");
  assert.equal(csp.reportLine(null), "");
});

const request = (headers = {}) => ({ get: (name) => headers[String(name).toLowerCase()] });

test("own hosts are matched as whole host names, never by a text suffix", () => {
  assert.ok(isOwnHost("managira.com"));
  assert.ok(isOwnHost("grace-academy.managira.com"));
  assert.ok(isOwnHost("School.Managira.com."));
  assert.ok(isOwnHost("shop.example.org", "shop.example.org:4000"), "the very host that was asked");
  for (const bad of ["evilmanagira.com", "managira.com.evil.example", "managira.com@evil.example", "xmanagira.com", "managira.co", "evil.example", "-.managira.com", ""]) {
    assert.equal(isOwnHost(bad, "managira.com"), false, bad);
  }
});

test("a post that carries a sign-in cookie must come from our own site", () => {
  const cookie = "connect.sid=s%3Aabc";
  const own = "https://school.managira.com";
  assert.equal(crossSiteReason(request({ host: "school.managira.com", origin: own, cookie })), null);
  assert.equal(crossSiteReason(request({ host: "school.managira.com", origin: "https://evil.example", cookie })), "origin");
  assert.equal(crossSiteReason(request({ host: "school.managira.com", origin: "null", cookie })), "origin");
  assert.equal(crossSiteReason(request({ host: "school.managira.com", origin: "https://managira.com.evil.example", cookie })), "origin");
  // No Origin: the Referer decides.
  assert.equal(crossSiteReason(request({ host: "school.managira.com", referer: `${own}/page`, cookie })), null);
  assert.equal(crossSiteReason(request({ host: "school.managira.com", referer: "https://evil.example/page", cookie })), "referer");
  // Neither header and a cookie: refused, unless the browser says it is the same site.
  assert.equal(crossSiteReason(request({ host: "school.managira.com", cookie })), "no-origin");
  assert.equal(crossSiteReason(request({ host: "school.managira.com", cookie, "sec-fetch-site": "same-origin" })), null);
  // No cookie, nothing to ride: a visitor's public form post still works.
  assert.equal(crossSiteReason(request({ host: "school.managira.com" })), null);
  assert.equal(crossSiteReason(request({ host: "school.managira.com", origin: "null" })), null);
  assert.equal(crossSiteReason(request({ host: "school.managira.com", origin: "https://evil.example" })), "origin", "another site is refused with or without a cookie");
});

test("SMS delivery callbacks need the shared secret, or Twilio's signature", async () => {
  const env = { SMS_WEBHOOK_SECRET: "s3cret-value" };
  const withQuery = (query, headers = {}, body = {}) => ({ query, body, protocol: "https", originalUrl: "/account/sms/webhook/twilio?orgId=5", get: (n) => ({ host: "managira.com", ...headers })[String(n).toLowerCase()] });
  assert.equal(await smsAuth.webhookIsGenuine(withQuery({ token: "s3cret-value" }), "arkesel", null, env), true);
  assert.equal(await smsAuth.webhookIsGenuine(withQuery({ token: "wrong" }), "arkesel", null, env), false);
  assert.equal(await smsAuth.webhookIsGenuine(withQuery({}, { "x-webhook-token": "s3cret-value" }), "africastalking", null, env), true);
  assert.equal(await smsAuth.webhookIsGenuine(withQuery({}), "arkesel", null, env), false, "unsigned");
  assert.equal(await smsAuth.webhookIsGenuine(withQuery({ token: "anything" }), "arkesel", null, {}), false, "no secret set: nothing passes");
  const body = { MessageSid: "SM1", MessageStatus: "delivered", To: "+15551234567" };
  const signature = smsAuth.twilioSignature("https://managira.com/account/sms/webhook/twilio?orgId=5", body, "twilio-auth-token");
  const authTokenFor = async (orgId) => (orgId === 5 ? "twilio-auth-token" : "other");
  assert.equal(await smsAuth.webhookIsGenuine(withQuery({ orgId: "5" }, { "x-twilio-signature": signature }, body), "twilio", authTokenFor, {}), true);
  assert.equal(await smsAuth.webhookIsGenuine(withQuery({ orgId: "5" }, { "x-twilio-signature": signature }, { ...body, MessageStatus: "failed" }), "twilio", authTokenFor, {}), false, "a changed field breaks the signature");
  assert.equal(await smsAuth.webhookIsGenuine(withQuery({ orgId: "6" }, { "x-twilio-signature": signature }, body), "twilio", authTokenFor, {}), false, "another school's token");
});

test("uploads take only known safe kinds, and refuse anything that can run code", () => {
  const file = (originalname, mimetype) => ({ originalname, mimetype });
  const ok = [["photo.JPG", "image/jpeg"], ["scan.pdf", "application/pdf"], ["sheet.xlsx", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"], ["list.csv", "application/vnd.ms-excel"], ["clip.mp4", "video/mp4"], ["voice.m4a", "audio/mp4"], ["pic.heic", "application/octet-stream"], ["capture", "image/png"]];
  for (const [name, type] of ok) assert.equal(uploads.isAllowedFile(file(name, type)), true, name);
  const refused = [["page.html", "text/html"], ["logo.svg", "image/svg+xml"], ["x.svg", "image/png"], ["run.js", "application/javascript"], ["a.exe", "application/octet-stream"], ["a.php", "application/x-httpd-php"], ["photo.png", "text/html"], ["photo.png.html", "image/png"], ["notes.pdf", "image/svg+xml"], ["data.json", "application/json"], ["a.zip", "application/zip"], ["noext", "application/octet-stream"], ["doc.pdf", "image/png"], ["pic.jpg", "application/pdf"], [".htaccess", "text/plain"]];
  for (const [name, type] of refused) assert.equal(uploads.isAllowedFile(file(name, type)), false, `${name} ${type}`);
  // A route can take more kinds where it really reads them.
  assert.equal(uploads.isAllowedFile(file("export.zip", "application/zip"), ["document", "archive"]), true);
  assert.equal(uploads.isAllowedFile(file("export.json", "application/json"), ["data"]), true);
  assert.equal(uploads.isAllowedFile(file("page.html", "text/html"), ["document", "archive", "data", "image"]), false);
  assert.equal(uploads.isAllowedFile(file("photo.png", "image/png"), ["document"]), false, "a spreadsheet import takes no pictures");
});

test("the database certificate is checked only when asked, and a CA is trusted when given", () => {
  const url = "postgres://u@host.example/db?sslmode=require";
  assert.deepEqual(dbSslSettings(url, {}).ssl, { rejectUnauthorized: false });
  assert.equal(dbSslSettings(url, {}).connectionString, url, "default: nothing changes");
  const verify = dbSslSettings(url, { DB_SSL_VERIFY: "true" });
  assert.deepEqual(verify.ssl, { rejectUnauthorized: true });
  assert.ok(!/sslmode/.test(verify.connectionString));
  const pem = "-----BEGIN CERTIFICATE-----\nAAAA\n-----END CERTIFICATE-----";
  const withCa = dbSslSettings("postgres://u@h/db?a=1&sslmode=require&b=2", { DB_SSL_CA: pem });
  assert.equal(withCa.ssl.ca, pem);
  assert.equal(withCa.ssl.rejectUnauthorized, true);
  assert.equal(withCa.connectionString, "postgres://u@h/db?a=1&b=2");
});

test("without SESSION_SECRET, signed values use a random key, never a known one", () => {
  const saved = process.env.SESSION_SECRET;
  delete process.env.SESSION_SECRET;
  const warn = console.warn; console.warn = () => {};
  try {
    const { sessionSecret } = require("../utils/sessionSecret");
    const key = sessionSecret();
    assert.equal(key.length, 96);
    assert.equal(sessionSecret(), key, "one key per process");
    assert.ok(!/YourSecret|managira/i.test(key));
    process.env.SESSION_SECRET = "from-the-environment";
    assert.equal(sessionSecret(), "from-the-environment");
  } finally {
    console.warn = warn;
    if (saved === undefined) delete process.env.SESSION_SECRET; else process.env.SESSION_SECRET = saved;
  }
  const source = require("fs").readFileSync(require.resolve("../controllers/internalApiController"), "utf8");
  assert.ok(!source.includes("YourSecret"), "no built-in secret left in the Mira session code");
});

test("raw database error text is replaced before it reaches a browser", () => {
  const { scrubBody } = require("../utils/errorScrub");
  for (const raw of ['invalid input syntax for type integer: "1;SELECT pg_sleep(3)--"', 'column "secret" does not exist', 'duplicate key value violates unique constraint "users_email_key"', "syntax error at or near \"FROM\"", "connect ECONNREFUSED 10.0.0.5:5432"]) {
    const { body, hit } = scrubBody({ success: false, error: raw });
    assert.equal(body.error, "Something went wrong. Please try again.");
    assert.equal(hit, raw);
  }
  const plain = { success: false, message: "That student does not exist." };
  assert.equal(scrubBody(plain).body, plain, "an ordinary message is left alone");
  assert.deepEqual(scrubBody([1, 2]).body, [1, 2]);
});

test("a file's first bytes must fit its kind (sniffing)", () => {
  const { contentProblem } = require("../utils/uploadSniff");
  const b = (...bytes) => Buffer.from(bytes);
  const text = (s) => Buffer.from(s);
  const cases = [
    ["a.pdf", text("%PDF-1.7\n..."), true], ["a.pdf", text("<html><script>alert(1)</script>"), false], ["a.pdf", text("MZ\x90\x00"), false],
    ["a.png", b(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0), true], ["a.png", text("<svg onload=alert(1)>"), false], ["a.png", text("GIF89a"), false],
    ["a.JPG", b(0xff, 0xd8, 0xff, 0xe0), true], ["a.jpg", text("<script>"), false],
    ["a.gif", text("GIF89a...."), true], ["a.webp", Buffer.concat([text("RIFF"), b(1, 2, 3, 4), text("WEBP")]), true], ["a.webp", text("RIFFxxxxWAVE"), false],
    ["a.heic", Buffer.concat([b(0, 0, 0, 24), text("ftypheic")]), true],
    ["a.docx", b(0x50, 0x4b, 0x03, 0x04, 1), true], ["a.xlsx", text("<html>"), false], ["a.pptx", b(0x50, 0x4b, 0x03, 0x04), true],
    ["a.doc", b(0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1), true], ["a.xls", b(0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1), true], ["a.xls", text("name,score\nAda,9\n"), true], ["a.xls", text("<html><body>"), false], ["a.ppt", text("%PDF-1.4"), false],
    ["a.mp3", text("ID3\x04"), true], ["a.mp3", b(0xff, 0xfb, 0x90), true], ["a.mp3", text("<html>"), false],
    ["a.mp4", Buffer.concat([b(0, 0, 0, 32), text("ftypisom")]), true], ["a.mov", Buffer.concat([b(0, 0, 0, 8), text("wide")]), true], ["a.mp4", text("%PDF-"), false],
    ["a.webm", b(0x1a, 0x45, 0xdf, 0xa3), true], ["a.wav", Buffer.concat([text("RIFF"), b(0, 0, 0, 0), text("WAVE")]), true], ["a.ogg", text("OggS\0"), true],
    ["a.csv", text("name,score\nAda,9\n"), true], ["a.csv", Buffer.concat([b(0xef, 0xbb, 0xbf), text("a,b\n1,2")]), true], ["a.csv", Buffer.concat([b(0xff, 0xfe), Buffer.from("a,b\n", "utf16le")]), true],
    ["a.csv", text("<!DOCTYPE html><html>"), false], ["a.txt", b(0x41, 0, 0x42, 0), false], ["a.txt", text("  <script>alert(1)</script>"), false], ["a.txt", text("plain notes"), true], ["a.csv", text("<svg xmlns='x'>"), false],
    ["capture", text("not an image"), true], // no ending, no declared picture type: nothing to judge
  ];
  for (const [name, bytes, ok] of cases) assert.equal(contentProblem({ originalname: name, mimetype: "" }, bytes) === null, ok, `${name} ${bytes.subarray(0, 12).toString("latin1")}`);
  assert.equal(contentProblem({ originalname: "blob", mimetype: "image/png" }, text("<html>")) === null, false, "no ending: judged by the declared picture type");
  assert.equal(contentProblem({ originalname: "a.pdf", mimetype: "application/pdf" }, Buffer.alloc(0)), null, "an empty file has nothing to run");
});

test("real multipart uploads: genuine files arrive, disguised ones are refused (memory and disk storage)", async () => {
  const express = require("express"), multer = require("multer"), os = require("os"), fs = require("fs");
  const { safeUploadOptions } = uploads;
  const memory = multer({ storage: multer.memoryStorage(), ...safeUploadOptions({ maxMb: 1 }) });
  const dir = fs.mkdtempSync(require("path").join(os.tmpdir(), "sniff-"));
  const disk = multer({ dest: dir, ...safeUploadOptions({ maxMb: 1 }) });
  const app = express();
  app.post("/memory", memory.single("f"), (req, res) => res.json({ ok: true, size: req.file.size }));
  app.post("/disk", disk.single("f"), (req, res) => res.json({ ok: true, size: req.file.size }));
  app.use((err, req, res, next) => res.status(400).json({ ok: false, message: uploads.uploadErrorMessage(err) || err.message }));
  const server = await new Promise((resolve) => { const s = app.listen(0, "127.0.0.1", () => resolve(s)); });
  const base = `http://127.0.0.1:${server.address().port}`;
  const send = async (route, name, type, bytes) => {
    const form = new FormData();
    form.set("f", new Blob([bytes], { type }), name);
    const r = await fetch(base + route, { method: "POST", body: form });
    return { status: r.status, body: await r.json() };
  };
  try {
    const png = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(32)]);
    for (const route of ["/memory", "/disk"]) {
      assert.equal((await send(route, "photo.png", "image/png", png)).status, 200, route);
      assert.equal((await send(route, "doc.pdf", "application/pdf", Buffer.from("%PDF-1.4\n%%EOF"))).status, 200, route);
      assert.equal((await send(route, "list.csv", "text/csv", Buffer.from("a,b\n1,2\n"))).status, 200, route);
      const fake = await send(route, "photo.png", "image/png", Buffer.from("<html><script>alert(1)</script></html>"));
      assert.equal(fake.status, 400, route);
      assert.match(fake.body.message, /isn't really a PNG/);
      assert.equal((await send(route, "report.pdf", "application/pdf", Buffer.from("<script>1</script>"))).status, 400, route);
    }
    assert.deepEqual(fs.readdirSync(dir).length, 3, "a refused file is not left on disk (only the three real ones remain)");
  } finally {
    server.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("raw error text is also kept out of flashed messages and short plain answers", () => {
  const { scrubText, flashScrub } = require("../utils/errorScrub");
  assert.equal(scrubText('relation "users" does not exist').text, "Something went wrong. Please try again.");
  assert.equal(scrubText("Your changes were saved.").text, "Your changes were saved.");
  const saved = process.env.NODE_ENV; process.env.NODE_ENV = "production";
  const warn = console.warn; console.warn = () => {};
  try {
    const stored = [];
    const req = { method: "POST", path: "/x", flash: (...args) => { stored.push(args); } };
    flashScrub(req, {}, () => {});
    req.flash("error", 'duplicate key value violates unique constraint "k"');
    req.flash("error", ["Saved.", "invalid input syntax for type integer: \"x\""]);
    req.flash("success", "Saved.");
    req.flash("error");
    assert.deepEqual(stored, [["error", "Something went wrong. Please try again."], ["error", ["Saved.", "Something went wrong. Please try again."]], ["success", "Saved."], ["error"]]);
  } finally { console.warn = warn; process.env.NODE_ENV = saved; }
});

test("reset and set-password links find the person, so their own name and email are refused", async () => {
  const identity = require("../utils/passwordIdentity");
  const rules = require("../utils/passwordRules");
  const db = { query: async (sql, params) => {
    if (/FROM users WHERE reset_password_token/.test(sql)) return { rows: params[0] === "hashed" ? [{ email: "ada@school.org", first_name: "Ada", last_name: "Lovelace" }] : [] };
    if (/FROM password_reset_tokens/.test(sql)) return { rows: params[0] === "gtoken" ? [{ user_id: "guardian_7" }] : params[0] === "stoken" ? [{ user_id: "student_9" }] : [] };
    if (/FROM guardian_accounts/.test(sql)) return { rows: [{ email: "parent@home.org", first_name: "Pat", last_name: "Doe" }] };
    if (/FROM student_accounts/.test(sql)) return { rows: [{ email: "kid@home.org", first_name: "Sam", last_name: "Ray" }] };
    return { rows: [] };
  } };
  const who = await identity.forResetToken(db, "hashed");
  assert.equal(who.email, "ada@school.org");
  assert.match(rules.passwordProblem("adalovelace1", who) || "", /name or email/);
  assert.deepEqual(await identity.forResetToken(db, "unknown"), {});
  assert.equal((await identity.forSetPasswordToken(db, "gtoken")).email, "parent@home.org");
  assert.match(rules.passwordProblem("PatDoe12345".toLowerCase(), await identity.forSetPasswordToken(db, "gtoken")) || "x", /./);
  assert.equal((await identity.forSetPasswordToken(db, "stoken")).lastName, "Ray");
  assert.deepEqual(await identity.forSetPasswordToken(db, "nothing"), {});
  assert.deepEqual(await identity.forResetToken({ query: async () => { throw new Error("db down"); } }, "x"), {}, "a failed lookup never blocks the reset");
});

test("a refused SMS callback only logs; sending never depends on the webhook, and start-up notes schools that need the secret", async () => {
  const source = require("fs").readFileSync(require.resolve("../utils/smsIntegration"), "utf8");
  assert.ok(!/smsWebhookAuth/.test(source), "sending code doesn't use the webhook check");
  const warnings = []; const warn = console.warn; console.warn = (m) => warnings.push(String(m));
  try {
    await smsAuth.logIfSecretNeeded({ query: async () => ({ rows: [{ provider: "arkesel", schools: 2 }] }) }, {});
    await smsAuth.logIfSecretNeeded({ query: async () => ({ rows: [{ provider: "arkesel", schools: 2 }] }) }, { SMS_WEBHOOK_SECRET: "x" });
    await smsAuth.logIfSecretNeeded({ query: async () => { throw new Error("no column"); } }, {});
  } finally { console.warn = warn; }
  assert.equal(warnings.length, 1);
  assert.match(warnings[0], /2 school\(s\).*SMS_WEBHOOK_SECRET/);
});

// ── No inline event handlers: the strict (nonce) policy refuses them ─────────────────────────────
const EVENTS = "click|change|submit|input|load|error|keyup|keydown|focus|blur|mouseover|mouseout|mouseenter|mouseleave|dblclick|keypress|touchstart|toggle|select|scroll|paste|drop|dragover|dragstart|dragend|dragenter|dragleave|contextmenu|reset|invalid|wheel|touchend|touchmove|focusin|focusout|ended|play|pause|mousedown|mouseup|mousemove|pointerdown|pointerup";
function sourceFiles() {
  const fs = require("fs"), path = require("path");
  const root = path.join(__dirname, "..");
  const out = [];
  const walk = (dir) => fs.readdirSync(dir, { withFileTypes: true }).forEach((e) => {
    if (["node_modules", "vendor", "mira", "tests", "uploads", ".git"].includes(e.name)) return;
    const full = path.join(dir, e.name);
    if (e.isDirectory()) return walk(full);
    if (/\.(ejs|js|html)$/.test(e.name) && !/\.min\.js$/.test(e.name) && !full.endsWith(path.join("public", "js", "mgActions.js"))) out.push(full);
  });
  ["views", "public", "controllers", "utils", "routes", "middleware"].forEach((d) => walk(path.join(root, d)));
  return out;
}

test("no page, script or generated HTML uses an inline on<event>= handler or a javascript: link", () => {
  const fs = require("fs");
  const handler = new RegExp(`(?<![\\w.$-])on(${EVENTS})\\s*=\\s*(?:\\\\?["'])`, "g");
  const found = [];
  for (const file of sourceFiles()) {
    const text = fs.readFileSync(file, "utf8");
    if (/^\s*\/\/ no-inline-handlers-check: skip/m.test(text)) continue;
    // Comments that only talk about handlers don't count.
    const code = text.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:"'])\/\/[^\n]*/g, "$1").replace(/<!--[\s\S]*?-->/g, "").replace(/<%#[\s\S]*?%>/g, "");
    for (const m of code.matchAll(handler)) found.push(`${file.replace(/.*MANAGIRA-SMS\//, "")}: ${m[0]}`);
    for (const m of code.matchAll(/(?:href|action|formaction)\s*=\s*\\?["']\s*javascript:/gi)) found.push(`${file.replace(/.*MANAGIRA-SMS\//, "")}: ${m[0]}`);
  }
  assert.deepEqual(found, [], "use data-on<event>=\"<id>\" and an entry in public/js/mgActions.js instead");
});

test("every data-on<event> id used in a page or script has its function in public/js/mgActions.js", () => {
  const fs = require("fs"), vm = require("vm"), path = require("path");
  const table = fs.readFileSync(path.join(__dirname, "..", "public", "js", "mgActions.js"), "utf8");
  new vm.Script(table); // it parses
  const known = new Set([...table.matchAll(/^"([^"]+)": function\(event\)/gm)].map((m) => m[1]));
  assert.ok(known.size > 300, "the table is there");
  const used = new Map();
  for (const file of sourceFiles()) {
    for (const m of fs.readFileSync(file, "utf8").matchAll(new RegExp(`data-on(${EVENTS})=\\\\?["']([A-Za-z0-9_.-]+)`, "g"))) used.set(m[2], file);
  }
  const missing = [...used].filter(([id]) => !known.has(id)).map(([id, file]) => `${id} (${file.replace(/.*MANAGIRA-SMS\//, "")})`);
  assert.deepEqual(missing, []);
});

test("a confirm-only handler keeps its question where the app's own dialog can ask it", () => {
  const table = require("fs").readFileSync(require("path").join(__dirname, "..", "public", "js", "mgActions.js"), "utf8");
  assert.match(table, /"guardian-reports\.3": function\(\)\{ return 'Delete this report/);
  assert.match(require("fs").readFileSync(require("path").join(__dirname, "..", "public", "js", "appAlert.js"), "utf8"), /__mgAct\.C/);
});

test("the database certificate is checked by default on Render's public address only, and gives way only when that was automatic", () => {
  const { isRenderPublicHost, fallBack } = require("../utils/dbSsl");
  const external = "postgres://u:p@dpg-abc123-a.oregon-postgres.render.com:5432/db?sslmode=require";
  const internal = "postgres://u:p@dpg-abc123-a:5432/db";
  assert.equal(isRenderPublicHost(external), true);
  assert.equal(isRenderPublicHost("postgres://u@dpg-abc123-a.frankfurt-postgres.render.com/db"), true);
  for (const other of [internal, "postgres://u@localhost/db", "postgres://u@evil-render.com/db", "postgres://u@render.com/db", "postgres://u@x.render.com.evil.example/db", "postgres://u@db.supabase.co/db"]) assert.equal(isRenderPublicHost(other), false, other);
  const auto = dbSslSettings(external, {});
  assert.deepEqual(auto.ssl, { rejectUnauthorized: true });
  assert.equal(auto.automatic, true);
  assert.ok(!/sslmode/.test(auto.connectionString));
  const inside = dbSslSettings(internal, {});
  assert.deepEqual(inside.ssl, { rejectUnauthorized: false });
  assert.equal(inside.connectionString, internal);
  assert.deepEqual(dbSslSettings(external, { DB_SSL_VERIFY: "false" }).ssl, { rejectUnauthorized: false }, "switched off on purpose");
  assert.deepEqual(dbSslSettings(internal, { DB_SSL_VERIFY: "true" }).ssl, { rejectUnauthorized: true }, "asked for on an internal name");
  // The automatic check gives way on a certificate error; a check someone asked for never does.
  const warn = console.warn; console.warn = () => {};
  try {
    const certError = Object.assign(new Error("unable to verify"), { code: "UNABLE_TO_VERIFY_LEAF_SIGNATURE" });
    const pool = { options: { ssl: { rejectUnauthorized: true } } };
    assert.equal(fallBack(pool, auto, new Error("password authentication failed")), false, "not a certificate problem");
    assert.equal(fallBack(pool, auto, certError), true);
    assert.deepEqual(pool.options.ssl, { rejectUnauthorized: false });
    const asked = dbSslSettings(external, { DB_SSL_VERIFY: "true" });
    const strict = { options: { ssl: { rejectUnauthorized: true } } };
    assert.equal(fallBack(strict, asked, certError), false);
    assert.deepEqual(strict.options.ssl, { rejectUnauthorized: true });
  } finally { console.warn = warn; }
});
