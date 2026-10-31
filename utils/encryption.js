const crypto = require("crypto");

const ALGORITHM = "aes-256-gcm";
const IV_LENGTH = 12;

function loadKey() {
  const raw = String(process.env.SETTINGS_ENCRYPTION_KEY || "").trim();
  if (!raw) {
    throw new Error(
      "SETTINGS_ENCRYPTION_KEY is not set. Generate one with `openssl rand -hex 32` and set it in the server environment."
    );
  }

  const key = /^[0-9a-fA-F]{64}$/.test(raw) ? Buffer.from(raw, "hex") : Buffer.from(raw, "base64");
  if (key.length !== 32) {
    throw new Error("SETTINGS_ENCRYPTION_KEY must decode to exactly 32 bytes (a 64-char hex string or base64).");
  }

  return key;
}

function isSettingsEncryptionKeyConfigured() {
  const raw = String(process.env.SETTINGS_ENCRYPTION_KEY || "").trim();
  if (!raw) return false;
  const key = /^[0-9a-fA-F]{64}$/.test(raw) ? Buffer.from(raw, "hex") : Buffer.from(raw, "base64");
  return key.length === 32;
}

// Encrypts a secret for at-rest storage. Returns "<iv>:<authTag>:<ciphertext>" (all base64),
// or "" for empty input so callers can store NULL without special-casing.
function encryptSecret(plainText) {
  const text = String(plainText || "");
  if (!text) return "";

  const key = loadKey();
  const iv = crypto.randomBytes(IV_LENGTH);
  const cipher = crypto.createCipheriv(ALGORITHM, key, iv);
  const ciphertext = Buffer.concat([cipher.update(text, "utf8"), cipher.final()]);
  const authTag = cipher.getAuthTag();

  return [iv.toString("base64"), authTag.toString("base64"), ciphertext.toString("base64")].join(":");
}

// Decrypts a value produced by encryptSecret. Returns "" for empty/malformed input
// rather than throwing, since callers treat "" as "not configured".
function decryptSecretStatus(storedValue) {
  const value = String(storedValue || "");
  if (!value) return { value: "", stored: false, readable: true, error: "" };

  const parts = value.split(":");
  if (parts.length !== 3) {
    return { value: "", stored: true, readable: false, error: "Stored credential data is invalid." };
  }

  try {
    const key = loadKey();
    const [ivPart, authTagPart, ciphertextPart] = parts;
    const iv = Buffer.from(ivPart, "base64");
    const authTag = Buffer.from(authTagPart, "base64");
    const ciphertext = Buffer.from(ciphertextPart, "base64");

    const decipher = crypto.createDecipheriv(ALGORITHM, key, iv);
    decipher.setAuthTag(authTag);
    const plainText = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
    return { value: plainText.toString("utf8"), stored: true, readable: true, error: "" };
  } catch (error) {
    const message = String(error?.message || "");
    const errorMessage = message.includes("SETTINGS_ENCRYPTION_KEY")
      ? message
      : "Saved credential cannot be decrypted with this server encryption key.";
    return { value: "", stored: true, readable: false, error: errorMessage };
  }
}

function decryptSecret(storedValue) {
  return decryptSecretStatus(storedValue).value;
}

function decryptSecretOrThrow(storedValue) {
  const result = decryptSecretStatus(storedValue);
  if (!result.readable) {
    throw new Error(
      `${result.error} Restore the original SETTINGS_ENCRYPTION_KEY or enter and save the credential again.`
    );
  }
  return result.value;
}

// Shows only the last 4 characters — enough for a school to recognize their
// own saved key at a glance, without reconstructing any more of it than that.
function maskSecret(plainText) {
  const value = String(plainText || "").trim();
  if (!value) return "";
  if (value.length <= 4) return "••••";
  return `••••${value.slice(-4)}`;
}

module.exports = {
  encryptSecret,
  decryptSecret,
  decryptSecretStatus,
  decryptSecretOrThrow,
  maskSecret,
  isSettingsEncryptionKeyConfigured,
};
