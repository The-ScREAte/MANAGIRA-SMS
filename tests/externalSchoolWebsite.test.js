const test = require("node:test");
const assert = require("node:assert/strict");
const { normalizeExternalSchoolWebsiteUrl } = require("../utils/externalSchoolWebsite");

test("normalizes school website addresses and supports a missing scheme", () => {
  assert.deepEqual(normalizeExternalSchoolWebsiteUrl("https://district.edu"), {
    url: "https://district.edu/",
    error: null,
  });
  assert.deepEqual(normalizeExternalSchoolWebsiteUrl("www.district.edu"), {
    url: "https://www.district.edu/",
    error: null,
  });
});

test("allows clearing the external website address", () => {
  assert.deepEqual(normalizeExternalSchoolWebsiteUrl("  "), {
    url: null,
    error: null,
  });
});

test("rejects unsafe or invalid website addresses", () => {
  for (const value of ["javascript:alert(1)", "https://user:pass@district.edu", "not a url"]) {
    assert.ok(normalizeExternalSchoolWebsiteUrl(value).error, `${value} should be rejected`);
  }
});

test("enforces the supported website address length", () => {
  const result = normalizeExternalSchoolWebsiteUrl(`https://${"a".repeat(2048)}.edu`);
  assert.equal(result.url, null);
  assert.ok(result.error);
});
