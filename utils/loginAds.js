// Ads: media (image / PDF / video) with an optional link that can be placed as
// a button anywhere on the media. Each ad can show beside the sign-in form on
// every sign-in page and/or as a small card inside the app after sign-in
// (delivered with the announcement feed, see announcementFeed.js).
// Managed from /admin/announcements.
const { isFrequencyExhausted } = require("./announcementFrequency");

const SCHEMA_READY = { value: false };
const CACHE_TTL_MS = 30 * 1000;
let activeCache = { at: 0, rows: null };

const MEDIA_TYPES = {
  "image/jpeg": "image",
  "image/png": "image",
  "image/gif": "image",
  "image/webp": "image",
  "application/pdf": "pdf",
  "video/mp4": "video",
  "video/webm": "video",
};
const BUTTON_SIZES = ["sm", "md", "lg"];
const APP_POSITIONS = ["bottom-right", "bottom-left", "center"];
const APP_FREQUENCIES = ["once", "until_dismissed", "once_per_session", "every_login", "daily", "n_times"];
// Canonical audience values; viewers are matched by announcementController's role tags.
const APP_ROLES = ["manager", "supervisor", "teacher", "driver", "parent", "student", "super_admin"];
// Pages that show the ad panel beside their sign-in form.
const SIGN_IN_PAGES = new Set([
  "/account/login",
  "/account/guardian-login",
  "/account/student-login",
  "/account/forget-password",
  "/hub/login",
]);
const MAX_FILE_BYTES = 50 * 1024 * 1024;

// Concurrent first requests share one setup run instead of racing the ALTERs.
let schemaPromise = null;
function ensureLoginAdsSchema(db) {
  if (SCHEMA_READY.value) return Promise.resolve();
  if (!schemaPromise) {
    schemaPromise = createLoginAdsSchema(db).catch((err) => {
      schemaPromise = null;
      throw err;
    });
  }
  return schemaPromise;
}

async function createLoginAdsSchema(db) {
  await db.query(`
    CREATE TABLE IF NOT EXISTS login_ads (
      id SERIAL PRIMARY KEY,
      title TEXT,
      media_type TEXT NOT NULL,
      media_url TEXT NOT NULL,
      s3_key TEXT,
      mime_type TEXT,
      media_width INTEGER,
      media_height INTEGER,
      link_url TEXT,
      link_label TEXT,
      show_as_button BOOLEAN NOT NULL DEFAULT TRUE,
      button_x NUMERIC(6,2) NOT NULL DEFAULT 50,
      button_y NUMERIC(6,2) NOT NULL DEFAULT 85,
      button_color TEXT NOT NULL DEFAULT '#e4572e',
      button_text_color TEXT NOT NULL DEFAULT '#ffffff',
      button_size TEXT NOT NULL DEFAULT 'md',
      is_active BOOLEAN NOT NULL DEFAULT TRUE,
      sort_order INTEGER NOT NULL DEFAULT 0,
      created_by INTEGER,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
  await db.query(`
    CREATE INDEX IF NOT EXISTS login_ads_active_order_idx
      ON login_ads (is_active, sort_order, id)
  `);
  // Placement, in-app delivery, scheduling and click stats.
  await db.query(`
    ALTER TABLE login_ads
      ADD COLUMN IF NOT EXISTS show_on_login BOOLEAN NOT NULL DEFAULT TRUE,
      ADD COLUMN IF NOT EXISTS show_in_app BOOLEAN NOT NULL DEFAULT FALSE,
      ADD COLUMN IF NOT EXISTS app_position VARCHAR(12) NOT NULL DEFAULT 'bottom-right',
      ADD COLUMN IF NOT EXISTS app_frequency VARCHAR(20) NOT NULL DEFAULT 'once_per_session',
      ADD COLUMN IF NOT EXISTS app_max_views INTEGER,
      ADD COLUMN IF NOT EXISTS app_roles TEXT[] NOT NULL DEFAULT '{}',
      ADD COLUMN IF NOT EXISTS starts_at TIMESTAMPTZ,
      ADD COLUMN IF NOT EXISTS ends_at TIMESTAMPTZ,
      ADD COLUMN IF NOT EXISTS login_clicks INTEGER NOT NULL DEFAULT 0
  `);
  await db.query(`
    CREATE TABLE IF NOT EXISTS login_ad_receipts (
      id SERIAL PRIMARY KEY,
      ad_id INTEGER NOT NULL REFERENCES login_ads(id) ON DELETE CASCADE,
      user_id INTEGER NOT NULL,
      viewer_type VARCHAR(10) NOT NULL DEFAULT 'staff',
      view_count INTEGER NOT NULL DEFAULT 0,
      first_seen_at TIMESTAMPTZ,
      last_seen_at TIMESTAMPTZ,
      dismissed_at TIMESTAMPTZ,
      clicked_at TIMESTAMPTZ,
      UNIQUE (ad_id, viewer_type, user_id)
    )
  `);
  SCHEMA_READY.value = true;
}

function invalidateLoginAdsCache() {
  activeCache = { at: 0, rows: null };
}

// Never throws: the login page must render even if this lookup fails.
async function getActiveLoginAds(db) {
  if (activeCache.rows && Date.now() - activeCache.at < CACHE_TTL_MS) {
    return activeCache.rows;
  }
  try {
    await ensureLoginAdsSchema(db);
    const { rows } = await db.query(
      `SELECT id, title, media_type, media_url, mime_type, media_width, media_height,
              link_url, link_label, show_as_button, button_x::float AS button_x,
              button_y::float AS button_y, button_color, button_text_color, button_size
         FROM login_ads
        WHERE is_active = TRUE
          AND show_on_login = TRUE
          AND now() BETWEEN COALESCE(starts_at, '-infinity'::timestamptz) AND COALESCE(ends_at, 'infinity'::timestamptz)
        ORDER BY sort_order ASC, id ASC`
    );
    activeCache = { at: Date.now(), rows };
    return rows;
  } catch (err) {
    console.error("[loginAds] failed to load active ads:", err.message);
    return [];
  }
}

// The in-app ad for a signed-in viewer: the first live ad (in admin order)
// whose audience includes them and whose frequency isn't used up.
async function getInAppAdForViewer(db, { identity, roleTags, seenThisSession }) {
  if (!identity) return null;
  await ensureLoginAdsSchema(db);
  const tags = new Set(roleTags || []);
  if (tags.has("student_teacher")) tags.add("teacher");
  const { rows } = await db.query(
    `SELECT a.id, a.title, a.media_type, a.media_url, a.mime_type, a.media_width, a.media_height,
            a.link_url, a.link_label, a.show_as_button, a.button_x::float AS button_x,
            a.button_y::float AS button_y, a.button_color, a.button_text_color, a.button_size,
            a.app_position, a.app_frequency, a.app_max_views,
            r.view_count, r.last_seen_at, r.dismissed_at
       FROM login_ads a
       LEFT JOIN login_ad_receipts r
         ON r.ad_id = a.id AND r.user_id = $1 AND r.viewer_type = $2
      WHERE a.is_active = TRUE
        AND a.show_in_app = TRUE
        AND now() BETWEEN COALESCE(a.starts_at, '-infinity'::timestamptz) AND COALESCE(a.ends_at, 'infinity'::timestamptz)
        AND (cardinality(a.app_roles) = 0 OR a.app_roles && $3::text[])
      ORDER BY a.sort_order ASC, a.id ASC`,
    [identity.userId, identity.viewerType, [...tags]]
  );
  const seen = new Set(seenThisSession || []);
  const now = new Date();
  const ad = rows.find((row) => {
    if (row.app_frequency === "once_per_session" && seen.has(row.id)) return false;
    const frequency = APP_FREQUENCIES.includes(row.app_frequency) ? row.app_frequency : "once_per_session";
    return !isFrequencyExhausted(
      { frequency, max_views: row.app_max_views },
      row.view_count != null ? row : null,
      now
    );
  });
  if (!ad) return null;
  const { view_count, last_seen_at, dismissed_at, ...clean } = ad;
  return { ...clean, file_url: adFileUrl(clean) };
}

// Only http(s) URLs or same-site paths; blocks javascript:, data:, //host, etc.
function sanitizeLinkUrl(value) {
  const raw = String(value || "").trim();
  if (!raw) return null;
  if (raw.startsWith("/") && !raw.startsWith("//")) return raw.slice(0, 2000);
  const withScheme = /^[a-z][a-z0-9+.-]*:/i.test(raw) ? raw : `https://${raw}`;
  try {
    const url = new URL(withScheme);
    if (url.protocol !== "http:" && url.protocol !== "https:") return null;
    return url.toString().slice(0, 2000);
  } catch (_) {
    return null;
  }
}

function sanitizeColor(value, fallback) {
  const raw = String(value || "").trim();
  return /^#[0-9a-f]{6}$/i.test(raw) ? raw.toLowerCase() : fallback;
}

function clampPercent(value, fallback) {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(100, Math.max(0, Math.round(n * 100) / 100));
}

function toDimension(value) {
  const n = parseInt(value, 10);
  return Number.isFinite(n) && n > 0 && n < 100000 ? n : null;
}

function toBool(value) {
  return value === true || value === "true" || value === "1" || value === "on";
}

// Same-origin URL for PDFs so PDF.js can read them without S3 CORS.
function adFileUrl(ad) {
  return ad.media_type === "pdf" ? `/account/login-ads/${ad.id}/file` : ad.media_url;
}

module.exports = {
  MEDIA_TYPES,
  BUTTON_SIZES,
  APP_POSITIONS,
  APP_FREQUENCIES,
  APP_ROLES,
  SIGN_IN_PAGES,
  getInAppAdForViewer,
  MAX_FILE_BYTES,
  ensureLoginAdsSchema,
  getActiveLoginAds,
  invalidateLoginAdsCache,
  sanitizeLinkUrl,
  sanitizeColor,
  clampPercent,
  toDimension,
  toBool,
  adFileUrl,
};
