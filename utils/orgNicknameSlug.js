// utils/orgNicknameSlug.js
// ============================================================================
// One free-text "Organisation Nickname" input is stored as two columns:
//   * organizations.nickname_display — verbatim text the user typed
//     (case + spaces + apostrophes preserved), shown as a UI label.
//   * organizations.nickname         — slugified version used for the
//     subdomain (e.g. `hjs-school.managira.com`). Locked after registration.
//
// Keep this logic in sync with the equivalent client-side helper rendered
// inline in register.ejs / settings.ejs (search "slugifyNickname").
// ============================================================================

const SLUG_MIN_LENGTH = 3;
const SLUG_MAX_LENGTH = 30;
const DISPLAY_MAX_LENGTH = 60;

/**
 * Convert a free-text nickname into the URL-safe subdomain slug.
 *
 *   "HJS School"           -> "hjs-school"
 *   "DDJ SCH"              -> "ddj-sch"
 *   "St. Mary's Academy"   -> "st-marys-academy"
 *   "  multi   space  "    -> "multi-space"
 *   "café 9!"              -> "cafe-9" (accents stripped if available)
 *
 * Returns "" for input that yields no usable characters.
 */
function slugifyNickname(input) {
  let value = String(input == null ? "" : input).trim();
  if (!value) return "";

  // Strip diacritics where Node supports it (Node >= 12 always does).
  try {
    value = value.normalize("NFKD").replace(/[\u0300-\u036f]/g, "");
  } catch (_) {
    // ignore — fall back to as-is
  }

  value = value.toLowerCase();
  // Replace any run of non-[a-z0-9] chars with a single hyphen.
  value = value.replace(/[^a-z0-9]+/g, "-");
  // Collapse repeated hyphens.
  value = value.replace(/-+/g, "-");
  // Trim leading/trailing hyphens.
  value = value.replace(/^-+|-+$/g, "");

  if (value.length > SLUG_MAX_LENGTH) {
    value = value.slice(0, SLUG_MAX_LENGTH).replace(/-+$/g, "");
  }

  return value;
}

/**
 * Normalize the verbatim display name. Trims whitespace, collapses internal
 * whitespace to single spaces, and caps length to keep UI consistent.
 */
function normalizeDisplayName(input) {
  const value = String(input == null ? "" : input).trim().replace(/\s+/g, " ");
  if (value.length > DISPLAY_MAX_LENGTH) {
    return value.slice(0, DISPLAY_MAX_LENGTH).trim();
  }
  return value;
}

/**
 * Validate the user input. Returns { ok: true, slug, display } on success
 * or { ok: false, error } describing the rejection.
 */
function deriveOrgNickname(input) {
  const display = normalizeDisplayName(input);
  if (!display) {
    return { ok: false, error: "Organisation nickname is required." };
  }
  if (display.length < SLUG_MIN_LENGTH) {
    return { ok: false, error: `Nickname must be at least ${SLUG_MIN_LENGTH} characters.` };
  }

  const slug = slugifyNickname(display);
  if (slug.length < SLUG_MIN_LENGTH) {
    return {
      ok: false,
      error:
        "Nickname must contain at least 3 letters or numbers. Try removing extra symbols.",
    };
  }

  return { ok: true, slug, display };
}

module.exports = {
  SLUG_MIN_LENGTH,
  SLUG_MAX_LENGTH,
  DISPLAY_MAX_LENGTH,
  slugifyNickname,
  normalizeDisplayName,
  deriveOrgNickname,
};
