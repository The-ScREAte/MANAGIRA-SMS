const test = require("node:test");
const assert = require("node:assert/strict");

const originalBucket = process.env.S3_BUCKET_NAME;
const originalRegion = process.env.AWS_REGION;
process.env.S3_BUCKET_NAME = "school-assets";
process.env.AWS_REGION = "eu-west-1";

const publicImageUrl = require("../utils/publicImageUrl");

test.after(() => {
  if (originalBucket === undefined) delete process.env.S3_BUCKET_NAME;
  else process.env.S3_BUCKET_NAME = originalBucket;
  if (originalRegion === undefined) delete process.env.AWS_REGION;
  else process.env.AWS_REGION = originalRegion;
});

test("encodes raw S3 object keys without changing path separators", () => {
  assert.equal(
    publicImageUrl.s3ObjectUrl("images/logos/My School #1.png"),
    "https://school-assets.s3.eu-west-1.amazonaws.com/images/logos/My%20School%20%231.png"
  );
  assert.equal(
    publicImageUrl.s3ObjectUrl("images/logos/50%20off.png"),
    "https://school-assets.s3.eu-west-1.amazonaws.com/images/logos/50%2520off.png"
  );
});

test("generates signed in-app URLs for supported S3 images", () => {
  const imageUrl = publicImageUrl(
    "https://school-assets.s3.amazonaws.com/images/logos/My%20School.png",
    { secret: "test-secret", expiresInSeconds: 60 }
  );
  const url = new URL(imageUrl, "https://example.test");
  assert.equal(url.pathname, "/public-image");
  assert.equal(url.searchParams.get("key"), "images/logos/My School.png");
  assert.ok(url.searchParams.get("signature"));
  assert.ok(publicImageUrl.verifyPublicImageSignature(
    url.searchParams.get("key"),
    url.searchParams.get("expires"),
    url.searchParams.get("signature"),
    "test-secret",
    "",
    "public"
  ));
  assert.equal(publicImageUrl.verifyPublicImageSignature(
    url.searchParams.get("key"),
    url.searchParams.get("expires"),
    url.searchParams.get("signature"),
    "test-secret",
    "another-session"
  ), false);
});

test("supports explicitly public legacy uploads and leading-slash logo keys", () => {
  const legacyImage = new URL(
    publicImageUrl("https://school-assets.s3.amazonaws.com/1700000000000-school logo.png", {
      secret: "test-secret",
      public: true,
    }),
    "https://example.test"
  );
  assert.equal(legacyImage.searchParams.get("public"), "1");
  assert.equal(legacyImage.searchParams.get("key"), "1700000000000-school logo.png");
  assert.equal(publicImageUrl.isLegacyPublicImageKey(legacyImage.searchParams.get("key")), true);
  assert.equal(
    publicImageUrl("/images/logos/school logo.png", { secret: "test-secret" }).split("?")[0],
    "/public-image"
  );
});

test("binds non-public image links to the current session", () => {
  const imageUrl = publicImageUrl(
    "https://school-assets.s3.amazonaws.com/images/transportation/drivers/driver.png",
    { secret: "test-secret", viewer: "session-a" }
  );
  const url = new URL(imageUrl, "https://example.test");
  assert.equal(publicImageUrl.verifyPublicImageSignature(
    url.searchParams.get("key"),
    url.searchParams.get("expires"),
    url.searchParams.get("signature"),
    "test-secret",
    "session-a"
  ), true);
  assert.equal(publicImageUrl.verifyPublicImageSignature(
    url.searchParams.get("key"),
    url.searchParams.get("expires"),
    url.searchParams.get("signature"),
    "test-secret",
    "session-b"
  ), false);
});

test("leaves unsupported S3 assets on their stable normalized URL", () => {
  assert.equal(
    publicImageUrl("https://school-assets.s3.amazonaws.com/files/report.pdf", { secret: "test-secret" }),
    "https://school-assets.s3.eu-west-1.amazonaws.com/files/report.pdf"
  );
});

test("supports path-style S3 URLs and s3 object references", () => {
  const pathStyleUrl = publicImageUrl(
    "https://s3.eu-west-1.amazonaws.com/school-assets/images/logos/a b.png",
    { secret: "test-secret" }
  );
  const pathStyleImage = new URL(pathStyleUrl, "https://example.test");
  assert.equal(
    pathStyleImage.pathname,
    "/public-image"
  );
  assert.equal(pathStyleImage.searchParams.get("key"), "images/logos/a b.png");
  const s3Uri = new URL(
    publicImageUrl("s3://school-assets/images/logos/a b.png", { secret: "test-secret" }),
    "https://example.test"
  );
  assert.equal(s3Uri.searchParams.get("key"), "images/logos/a b.png");
  assert.equal(
    publicImageUrl.s3ObjectUrl("images/logos/a b.png"),
    "https://school-assets.s3.eu-west-1.amazonaws.com/images/logos/a%20b.png"
  );
});

test("leaves non-S3 URLs and empty values unchanged", () => {
  assert.equal(publicImageUrl("https://cdn.example.com/logo.png"), "https://cdn.example.com/logo.png");
  assert.equal(publicImageUrl("/uploads/logo.png"), "/uploads/logo.png");
  assert.equal(publicImageUrl("profilePlaceholder.png"), "/images/profilePlaceholder.png");
  assert.equal(publicImageUrl(""), "");
  assert.equal(publicImageUrl(null), "");
});

test("does not rewrite signed S3 URLs", () => {
  const signedUrl = "https://school-assets.s3.amazonaws.com/a%20b.png?X-Amz-Signature=abc";
  assert.equal(publicImageUrl(signedUrl, { secret: "test-secret" }), signedUrl);
});

test("limits anonymous images to designated public prefixes and legacy keys", () => {
  assert.equal(publicImageUrl.isPublicImageKey("images/logos/school.png"), true);
  assert.equal(publicImageUrl.isPublicImageKey("images/hub-logos/hub.png"), true);
  assert.equal(publicImageUrl.isPublicImageKey("images/publicdashboard/hero.png"), true);
  assert.equal(publicImageUrl.isPublicImageKey("images/ads/banner.png"), true);
  assert.equal(publicImageUrl.isPublicImageKey("images/transportation/drivers/1.png"), false);
  assert.equal(publicImageUrl.isRoutableImageKey("1700000000000-avatar.png"), true);
  assert.equal(publicImageUrl.isRoutableImageKey("private/avatar.png"), false);
  assert.equal(publicImageUrl.isSupportedImageKey("images/logos/unsafe.svg"), false);
  assert.equal(publicImageUrl.isSupportedImageKey("images/logos/../secret.png"), false);
});