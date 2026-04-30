const MIN_FORM_FILL_MS = 1200;
const MAX_FORM_AGE_MS = 1000 * 60 * 60 * 12;

const EMAIL_PATTERN = /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi;
const URL_PATTERN = /(https?:\/\/|www\.|\b[a-z0-9][a-z0-9-]{1,}\.(com|net|org|info|biz|xyz|top|online|site|link|click|ru|cn|tk)(?:\/[^\s]*)?\b)/i;
const SPAM_KEYWORDS = [
  'viagra',
  'casino',
  'forex',
  'crypto',
  'bitcoin',
  'loan offer',
  'seo service',
  'backlink',
  'guest post',
  'click here',
  'telegram',
  'whatsapp group',
];

function normalizeText(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function countMeaningfulWords(value) {
  const normalized = normalizeText(value);
  if (!normalized) return 0;

  const matches = normalized.match(/[A-Za-z0-9][A-Za-z0-9'-]*/g);
  return matches ? matches.length : 0;
}

function hasRepeatedCharacters(value) {
  return /(.)\1{5,}/i.test(value);
}

function hasRepeatedWordPattern(value) {
  return /\b([a-z]{2,})\b(?:\s+\1\b){2,}/i.test(value);
}

function hasGibberishToken(value) {
  return value
    .split(/\s+/)
    .some((token) => token.length >= 18 && /^[a-z]+$/i.test(token) && !/[aeiou]/i.test(token));
}

function looksSpammy(value) {
  const normalized = normalizeText(value).toLowerCase();
  if (!normalized) return false;

  const withoutEmails = normalized.replace(EMAIL_PATTERN, ' ');

  if (URL_PATTERN.test(withoutEmails)) return true;
  if (hasRepeatedCharacters(normalized)) return true;
  if (hasRepeatedWordPattern(normalized)) return true;
  if (hasGibberishToken(normalized)) return true;
  if (SPAM_KEYWORDS.some((keyword) => normalized.includes(keyword))) return true;

  return false;
}

function validatePublicFormSubmission({
  honeypot,
  startedAt,
  confirmation,
  requiredFields = [],
  textFields = [],
  spamSamples = [],
}) {
  const errors = [];

  if (normalizeText(honeypot)) {
    errors.push('We could not verify your submission. Please try again.');
  }

  const startedAtMs = Number.parseInt(startedAt, 10);
  if (!Number.isFinite(startedAtMs)) {
    errors.push('Please refresh the page and submit the form again.');
  } else {
    const ageMs = Date.now() - startedAtMs;
    if (ageMs < MIN_FORM_FILL_MS) {
      errors.push('Please take a moment to complete the form before submitting.');
    } else if (ageMs > MAX_FORM_AGE_MS) {
      errors.push('This form has expired. Please refresh the page and try again.');
    }
  }

  if (confirmation !== 'yes') {
    errors.push('Please confirm that this is a genuine request before submitting.');
  }

  requiredFields.forEach(({ label, value }) => {
    if (!normalizeText(value)) {
      errors.push(`${label} is required.`);
    }
  });

  textFields.forEach(({ label, value, minWords = 3, required = false }) => {
    const normalized = normalizeText(value);
    if (!normalized) {
      if (required) {
        errors.push(`${label} is required.`);
      }
      return;
    }

    if (countMeaningfulWords(normalized) < minWords) {
      errors.push(`${label} must contain at least ${minWords} words.`);
    }
  });

  const spamText = [...spamSamples, ...textFields.map((field) => field.value)]
    .map(normalizeText)
    .filter(Boolean)
    .join(' ');

  if (spamText && looksSpammy(spamText)) {
    errors.push('Your submission looks automated or promotional. Remove links or repetitive text and try again.');
  }

  return {
    ok: errors.length === 0,
    error: errors[0] || null,
    errors,
  };
}

module.exports = {
  countMeaningfulWords,
  validatePublicFormSubmission,
};