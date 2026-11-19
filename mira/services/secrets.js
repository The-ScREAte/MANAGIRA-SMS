// Nothing secret ever reaches the model or the chat: every tool result passes through scrub()
// (tools/index.js runTool). Keys that hold secrets are hidden whatever their value; strings are
// cleaned of signed or storage links, API keys, bearer tokens, JWTs and password hashes.
const SECRET_KEY = /^(password|password_?hash|passwd|pass_hash|secret|client_?secret|api_?key|apikey|access_?token|refresh_?token|id_?token|token|session_?token|auth_?token|private_?key|totp_?secret|mfa_?secret|recovery_?codes?|card_?number|cvc|cvv|iban|account_?number|routing_?number|signature_?secret|webhook_?secret)$/i;
const PATTERNS = [
  [/https?:\/\/[^\s"'<>]*(?:X-Amz-Signature|X-Amz-Credential|Signature=|AWSAccessKeyId=)[^\s"'<>]*/gi, "[private link hidden]"],
  [/https?:\/\/[^\s"'<>]*\.amazonaws\.com\/[^\s"'<>]*/gi, "[storage link hidden]"],
  [/\b(?:sk|rk)_(?:live|test)_[A-Za-z0-9]{10,}\b/g, "[key hidden]"],
  [/\bwhsec_[A-Za-z0-9]{10,}\b/g, "[key hidden]"],
  [/\bAKIA[0-9A-Z]{16}\b/g, "[key hidden]"],
  [/\bBearer\s+[A-Za-z0-9._~+/-]{20,}=*/g, "Bearer [hidden]"],
  [/\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/g, "[token hidden]"],
  [/\$2[aby]\$\d{2}\$[./A-Za-z0-9]{53}/g, "[hidden]"],
  [/-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g, "[key hidden]"],
];

function scrubString(text, found) {
  let out = text;
  PATTERNS.forEach(([pattern, replacement]) => {
    out = out.replace(pattern, () => { found.push(replacement); return replacement; });
  });
  return out;
}

function scrub(value, found = [], depth = 0) {
  if (depth > 12) return value;
  if (typeof value === "string") return scrubString(value, found);
  if (Array.isArray(value)) return value.map((item) => scrub(item, found, depth + 1));
  if (value && typeof value === "object") {
    const out = {};
    Object.entries(value).forEach(([key, item]) => {
      if (SECRET_KEY.test(key) && item !== null && item !== undefined && item !== "" && typeof item !== "boolean") {
        found.push(key);
        out[key] = "[hidden]";
      } else out[key] = scrub(item, found, depth + 1);
    });
    return out;
  }
  return value;
}

module.exports = { scrub, SECRET_KEY, PATTERNS };
