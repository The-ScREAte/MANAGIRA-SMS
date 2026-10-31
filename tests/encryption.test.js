const test = require("node:test");
const assert = require("node:assert/strict");
const {
  decryptSecret,
  decryptSecretOrThrow,
  decryptSecretStatus,
  encryptSecret,
  isSettingsEncryptionKeyConfigured,
} = require("../utils/encryption");

test("settings encryption validates the server key and encrypts stored values", () => {
  const originalKey = process.env.SETTINGS_ENCRYPTION_KEY;

  try {
    delete process.env.SETTINGS_ENCRYPTION_KEY;
    assert.equal(isSettingsEncryptionKeyConfigured(), false);
    assert.throws(() => encryptSecret("integration-secret"), /SETTINGS_ENCRYPTION_KEY is not set/);

    process.env.SETTINGS_ENCRYPTION_KEY = "a".repeat(64);
    assert.equal(isSettingsEncryptionKeyConfigured(), true);
    const encrypted = encryptSecret("integration-secret");
    assert.notEqual(encrypted, "integration-secret");
    assert.equal(encrypted.split(":").length, 3);
    assert.equal(decryptSecret(encrypted), "integration-secret");
  } finally {
    if (originalKey === undefined) delete process.env.SETTINGS_ENCRYPTION_KEY;
    else process.env.SETTINGS_ENCRYPTION_KEY = originalKey;
  }
});

test("settings encryption rejects keys that are not 32 bytes", () => {
  const originalKey = process.env.SETTINGS_ENCRYPTION_KEY;

  try {
    process.env.SETTINGS_ENCRYPTION_KEY = "too-short";
    assert.equal(isSettingsEncryptionKeyConfigured(), false);
    assert.throws(() => encryptSecret("integration-secret"), /must decode to exactly 32 bytes/);
  } finally {
    if (originalKey === undefined) delete process.env.SETTINGS_ENCRYPTION_KEY;
    else process.env.SETTINGS_ENCRYPTION_KEY = originalKey;
  }
});

test("settings encryption reports when a saved value cannot be read with the current key", () => {
  const originalKey = process.env.SETTINGS_ENCRYPTION_KEY;

  try {
    process.env.SETTINGS_ENCRYPTION_KEY = "a".repeat(64);
    const encrypted = encryptSecret("integration-secret");
    process.env.SETTINGS_ENCRYPTION_KEY = "b".repeat(64);

    assert.deepEqual(decryptSecretStatus(encrypted), {
      value: "",
      stored: true,
      readable: false,
      error: "Saved credential cannot be decrypted with this server encryption key.",
    });
    assert.throws(
      () => decryptSecretOrThrow(encrypted),
      /Restore the original SETTINGS_ENCRYPTION_KEY/
    );
  } finally {
    if (originalKey === undefined) delete process.env.SETTINGS_ENCRYPTION_KEY;
    else process.env.SETTINGS_ENCRYPTION_KEY = originalKey;
  }
});
