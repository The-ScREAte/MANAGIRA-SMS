// Lightweight server-side anti-spam helper for public forms.
// Returns { ok: true } or { ok: false, reason }.
//
// Checks:
//  - Honeypot field (`company_website`) must be empty.
//  - Submission must take at least 3 seconds (form_started_at timestamp).
//  - `confirm_human` checkbox should be present (when required).
//  - Message (if provided) must contain a minimum number of words.
//  - Reject obvious spam patterns (excessive URLs, repeated chars).

const SPAM_PATTERNS = [
  /\b(?:viagra|casino|crypto airdrop|bitcoin doubler|seo services|buy followers)\b/i,
  /(https?:\/\/[^\s]+){4,}/i, // 4+ links
  /(.)\1{12,}/, // 13+ same char in a row
];

function wordCount(s) {
  return String(s || '').trim().split(/\s+/).filter(Boolean).length;
}

function checkAntiSpam(body, opts = {}) {
  const {
    requireConfirm = true,
    minWords = 3,
    messageField = 'message',
    minSeconds = 3,
  } = opts;

  if (body.company_website && String(body.company_website).trim() !== '') {
    return { ok: false, reason: 'Spam detected.' };
  }

  const startedAt = Number(body.form_started_at);
  if (startedAt && Date.now() - startedAt < minSeconds * 1000) {
    return { ok: false, reason: 'Form submitted too quickly. Please try again.' };
  }

  if (requireConfirm && !body.confirm_human) {
    return { ok: false, reason: 'Please confirm this is a genuine request.' };
  }

  const message = body[messageField];
  if (message && wordCount(message) < minWords) {
    return { ok: false, reason: `Please use at least ${minWords} words in your message.` };
  }

  const haystack = [body.name, body.organization, message].filter(Boolean).join(' \n ');
  for (const re of SPAM_PATTERNS) {
    if (re.test(haystack)) return { ok: false, reason: 'Submission flagged as spam.' };
  }

  return { ok: true };
}

module.exports = { checkAntiSpam, wordCount };
