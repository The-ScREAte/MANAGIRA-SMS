// Phone numbers in international form for texts and WhatsApp.
// Schools type numbers the local way ("0244 123 456", "(801) 555-1234"); SMS
// providers and WhatsApp need the country code ("+233244123456"). The school's
// country fills in the missing code, so a saved number never has to change.
const { parsePhoneNumberFromString } = require("libphonenumber-js/min");

function normalizeCountry(countryCode) {
  const code = String(countryCode || "").trim().toUpperCase();
  return /^[A-Z]{2}$/.test(code) ? code : undefined;
}

function parse(raw, country) {
  try {
    const parsed = parsePhoneNumberFromString(raw, country);
    return parsed && parsed.isValid() ? parsed : null;
  } catch (_) {
    return null;
  }
}

// "+<country code><number>", or null when it can't be a real number.
function toInternationalPhone(value, defaultCountry) {
  let raw = String(value || "").trim();
  if (!raw) return null;
  if (raw.startsWith("00")) raw = `+${raw.slice(2)}`;
  const country = normalizeCountry(defaultCountry);

  let parsed = raw.startsWith("+") ? parse(raw) : parse(raw, country);
  // Saved with the country code but no "+" ("233244123456").
  if (!parsed && !raw.startsWith("+")) {
    const digits = raw.replace(/\D+/g, "");
    if (digits.length >= 10) parsed = parse(`+${digits}`);
  }
  return parsed ? parsed.number : null;
}

const INVALID_PHONE_MESSAGE = "Invalid phone number. Check the number, or add the country code (it starts with +).";

// WhatsApp form: digits with the country code, no "+".
function normalizeWhatsappPhoneNumber(value, defaultCountry) {
  if (!String(value || "").trim()) return { normalized: "", valid: false, reason: "Phone number is required." };
  const international = toInternationalPhone(value, defaultCountry);
  if (!international) {
    return { normalized: String(value).replace(/\D+/g, ""), valid: false, reason: INVALID_PHONE_MESSAGE };
  }
  return { normalized: international.slice(1), valid: true, reason: "" };
}

// For the hint under phone fields: how the number will be dialled.
function describePhone(value, defaultCountry) {
  const international = toInternationalPhone(value, defaultCountry);
  if (!international) return { valid: false, international: null, display: null };
  const parsed = parse(international);
  return { valid: true, international, display: parsed ? parsed.formatInternational() : international };
}

module.exports = { toInternationalPhone, normalizeWhatsappPhoneNumber, describePhone, INVALID_PHONE_MESSAGE };
