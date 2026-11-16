const test = require("node:test");
const assert = require("node:assert/strict");

process.env.S3_BUCKET_NAME = "school-files-us";
process.env.AWS_REGION = "us-west-2";
process.env.S3_LEGACY_BUCKETS = "oneplaces3";
process.env.AWS_ACCESS_KEY_ID = process.env.AWS_ACCESS_KEY_ID || "AKIATESTTESTTESTTEST";
process.env.AWS_SECRET_ACCESS_KEY = process.env.AWS_SECRET_ACCESS_KEY || "test-secret-key-for-signing-only";

const files = require("../utils/storedFiles");

test("a stored address names its key in the current bucket, and an earlier bucket's address names the same key", () => {
  assert.equal(files.keyOf("https://school-files-us.s3.us-west-2.amazonaws.com/report-cards/63/a.pdf"), "report-cards/63/a.pdf");
  assert.equal(files.keyOf("https://oneplaces3.s3.eu-west-1.amazonaws.com/images/logos/1700000000000_proof%20one.pdf"), "images/logos/1700000000000_proof one.pdf");
  assert.equal(files.keyOf("https://s3.eu-west-1.amazonaws.com/oneplaces3/signatures/x.png"), "signatures/x.png");
  assert.equal(files.keyOf("s3://oneplaces3/transcripts/t.pdf"), "transcripts/t.pdf");
  assert.equal(files.keyOf("report-cards/63/a.pdf"), "report-cards/63/a.pdf");
  // Anything else is not one of Managira's files.
  assert.equal(files.keyOf("https://another-bucket.s3.amazonaws.com/a.pdf"), null);
  assert.equal(files.keyOf("https://example.com/a.pdf"), null);
  assert.equal(files.keyOf("/images/profilePlaceholder.png"), null);
  assert.equal(files.keyOf("data:image/png;base64,AAAA"), null);
});

test("only pictures and videos in the public folders are public; student files never are", () => {
  for (const key of ["images/logos/a.png", "images/publicdashboard/b.JPG", "images/website/org_1/c.webp", "documentation/d.png", "images/ads/e.mp4"]) {
    assert.equal(files.isPublicKey(key), true, key);
  }
  for (const key of [
    "images/logos/1700000000000_proof.pdf", // a school's sign-up document from before it had a folder
    "images/logos/a.docx",
    "images/studentimages/63/a.png",
    "images/guardianimages/63/a.jpg",
    "signatures/63/a.png",
    "report-cards/63/a.pdf",
    "transcripts/a.pdf",
    "custom-forms/63/a.png",
    "school-signup/abc.pdf",
    "1700000000000-uuid-resume.pdf",
  ]) {
    assert.equal(files.isPublicKey(key), false, key);
  }
});

test("a signed link is made for a private file, a public picture keeps its address, another site's address is left alone", async () => {
  const signed = await files.signedUrl("https://oneplaces3.s3.eu-west-1.amazonaws.com/report-cards/63/a.pdf", { seconds: 300 });
  assert.match(signed, /^https:\/\/school-files-us\.s3\.us-west-2\.amazonaws\.com\/report-cards\/63\/a\.pdf\?/);
  assert.match(signed, /X-Amz-Expires=300/);
  assert.equal(await files.signedUrl("images/logos/a.png"), "https://school-files-us.s3.us-west-2.amazonaws.com/images/logos/a.png");
  assert.equal(await files.signedUrl("https://example.com/a.pdf"), "https://example.com/a.pdf");
  assert.equal(await files.signedUrl("report-cards/../secrets"), null);
  // Never longer than storage allows (7 days), never shorter than a minute.
  assert.match(await files.signedUrl("report-cards/a.pdf", { seconds: 10 * 24 * 3600 }), /X-Amz-Expires=604800/);
  assert.match(await files.signedUrl("report-cards/a.pdf", { seconds: 1 }), /X-Amz-Expires=60/);
});

test("form answers and question help link to Managira, never to storage", () => {
  assert.equal(files.fileLink({ key: "custom-forms/63/abc.pdf", url: "https://oneplaces3.s3.eu-west-1.amazonaws.com/custom-forms/63/abc.pdf" }), "/files/custom-forms/63/abc.pdf");
  assert.equal(files.fileLink({ key: "question-help/63/abc.png" }, { absolute: true }).endsWith("/files/question-help/63/abc.png"), true);
  assert.equal(files.fileLink({ key: "report-cards/63/a.pdf" }), "");
  assert.equal(files.fileLink({ key: "custom-forms/63/../../report-cards/a.pdf" }), "");
  assert.equal(files.fileLink({ url: "https://oneplaces3.s3.eu-west-1.amazonaws.com/custom-forms/63/abc.pdf" }), "");
  assert.equal(files.schoolOfKey("custom-forms/63/abc.pdf"), 63);
  assert.equal(files.schoolOfKey("custom-forms/x/abc.pdf"), null);
});

function fakeRes() {
  const res = { statusCode: 200, headers: {}, body: null, location: null };
  res.status = (code) => { res.statusCode = code; return res; };
  res.send = (body) => { res.body = body; return res; };
  res.set = (name, value) => { res.headers[name] = value; return res; };
  res.redirect = (code, location) => { res.statusCode = code; res.location = location; return res; };
  return res;
}

test("a school's file opens only for someone signed in to that school", async () => {
  const key = "custom-forms/63/abc.pdf";
  const ask = async (session) => {
    const res = fakeRes();
    await files.serveSchoolFile({ params: { 0: key }, session }, res);
    return res;
  };
  assert.equal((await ask({})).statusCode, 404);
  assert.equal((await ask({ organizationId: 63 })).statusCode, 404, "a school id alone is not a sign-in");
  assert.equal((await ask({ userId: 9, organizationId: 64 })).statusCode, 404, "another school");
  const staff = await ask({ userId: 9, organizationId: 63 });
  assert.equal(staff.statusCode, 302);
  assert.match(staff.location, /custom-forms\/63\/abc\.pdf\?.*X-Amz-Signature=/);
  assert.equal(staff.headers["Cache-Control"], "private, no-store");
  assert.equal(staff.headers["Referrer-Policy"], "no-referrer");
  assert.equal((await ask({ guardianId: 4, organizationId: 63 })).statusCode, 302);
  assert.equal((await ask({ studentId: 5, organizationId: 63 })).statusCode, 302);
});

test("short links are 64 random bits and refuse anything that isn't a code", async () => {
  const shortLink = require("../utils/shortLink");
  let saved = null;
  const db = { query: async (sql, params) => { if (/INSERT INTO short_links/.test(sql)) { saved = params[0]; return { rows: [{ code: params[0] }] }; } return { rows: [] }; } };
  const link = await shortLink.createShortLink(db, { targetUrl: "report-cards/63/a.pdf", organizationId: 63, baseUrl: "https://managira.com/" });
  assert.match(saved, /^[A-Za-z0-9_-]{11}$/);
  assert.equal(link, `https://managira.com/r/${saved}`);
  assert.equal(await shortLink.resolveShortLink(db, "../../etc"), null);
  assert.equal(await shortLink.resolveShortLink(db, ""), null);
  assert.equal(shortLink.FILE_LINK_DAYS, 90);
});

test("a short link to a student file stops working after 90 days; a public picture's link doesn't", async () => {
  const shortLink = require("../utils/shortLink");
  const dbFor = (target, old) => ({ query: async (sql) => (/SELECT target_url/.test(sql) ? { rows: [{ target_url: target, past_file_age: old }] } : { rows: [] }) });
  assert.equal(await shortLink.resolveShortLink(dbFor("report-cards/63/a.pdf", false), "AbCdEfGhIjK"), "report-cards/63/a.pdf");
  assert.equal(await shortLink.resolveShortLink(dbFor("report-cards/63/a.pdf", true), "AbCdEfGhIjK"), null);
  assert.equal(await shortLink.resolveShortLink(dbFor("images/logos/a.png", true), "AbCdEfG"), "images/logos/a.png");
  assert.equal(await shortLink.resolveShortLink(dbFor("https://example.com/page", true), "AbCdEfG"), "https://example.com/page");
});

test("the bucket policy makes only site pictures public, requires HTTPS and fits S3's limit", () => {
  const storagePolicy = require("../utils/storagePolicy");
  const policy = storagePolicy.bucketPolicy("school-files-us", { extraPublicKeys: ["1700000000000-banner.webp", "images/logos/a.png", "report-cards/*", "../x"] });
  assert.ok(Buffer.byteLength(JSON.stringify(policy)) < storagePolicy.POLICY_LIMIT_BYTES);
  const [pictures, banners, https] = policy.Statement;
  assert.equal(pictures.Effect, "Allow");
  assert.deepEqual([].concat(pictures.Action), ["s3:GetObject"]);
  assert.ok(pictures.Resource.includes("arn:aws:s3:::school-files-us/images/logos/*.png"));
  assert.ok(pictures.Resource.includes("arn:aws:s3:::school-files-us/images/publicdashboard/*.JPG"));
  assert.ok(pictures.Resource.every((arn) => /\/\*\.[A-Za-z0-9]+$/.test(arn)), "only pictures and videos by type, never a whole folder");
  for (const folder of ["studentimages", "guardianimages", "profiles", "reportsignature", "transcriptsignature"]) {
    assert.ok(!pictures.Resource.some((arn) => arn.includes(`images/${folder}/`)), folder);
  }
  assert.ok(!pictures.Resource.some((arn) => /report-cards|transcripts|signatures|custom-forms|migrations|school-signup/.test(arn)));
  assert.ok(!pictures.Resource.some((arn) => /\.(pdf|docx?)$/i.test(arn)));
  // A banner is named exactly; a wildcard, an unsafe name or an already public picture is not added.
  assert.deepEqual(banners.Resource, ["arn:aws:s3:::school-files-us/1700000000000-banner.webp"]);
  assert.equal(https.Effect, "Deny");
  assert.deepEqual(https.Condition, { Bool: { "aws:SecureTransport": "false" } });
  assert.equal(storagePolicy.PUBLIC_ACCESS_BLOCK.BlockPublicAcls, true);
  assert.deepEqual(storagePolicy.CORS_RULES[0].AllowedMethods, ["GET", "HEAD"]);
  assert.ok(!storagePolicy.CORS_RULES[0].AllowedOrigins.includes("*"));
});

test("sign-up documents in a public folder are refused to anonymous readers, by name", () => {
  const storagePolicy = require("../utils/storagePolicy");
  const policy = storagePolicy.bucketPolicy("school-files-us", { privateKeys: ["images/logos/1700000000000_proof.png", "school-signup/abc.pdf", "images/logos/*.png"] });
  const deny = policy.Statement.find((s) => s.Sid === "PrivateSignUpDocuments");
  assert.ok(deny, "a deny statement");
  assert.equal(deny.Effect, "Deny");
  // Only the named picture in a public folder: a private folder needs nothing, a wildcard is never named.
  assert.deepEqual(deny.Resource, ["arn:aws:s3:::school-files-us/images/logos/1700000000000_proof.png"]);
  // Signed links (Managira's own, an authenticated principal) still open it.
  assert.deepEqual(deny.Condition, { StringEquals: { "aws:PrincipalType": "Anonymous" } });
  assert.equal(storagePolicy.accessOf("images/logos/1700000000000_proof.png", new Set(), new Set(["images/logos/1700000000000_proof.png"])), "private");
  assert.equal(storagePolicy.accessOf("videos/publicdashboard/63/clip.mp4"), "public");
});
