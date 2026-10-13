const path = require("path");
const fsp = require("fs").promises;
const sharp = require("sharp");
const db = require("../config/db");
const { resolveViewerIdentity } = require("./announcementController");
const { uploadToS3, deleteFromS3, s3Client, GetObjectCommand } = require("../config/s3");
const {
  MEDIA_TYPES,
  BUTTON_SIZES,
  APP_POSITIONS,
  APP_FREQUENCIES,
  APP_ROLES,
  ensureLoginAdsSchema,
  invalidateLoginAdsCache,
  sanitizeLinkUrl,
  sanitizeColor,
  clampPercent,
  toDimension,
  toBool,
  adFileUrl,
} = require("../utils/loginAds");

const AD_COLUMN_LIST = [
  "id", "title", "media_type", "media_url", "s3_key", "mime_type", "media_width", "media_height",
  "link_url", "link_label", "show_as_button", "button_x::float AS button_x", "button_y::float AS button_y",
  "button_color", "button_text_color", "button_size", "is_active", "sort_order", "created_at", "updated_at",
  "show_on_login", "show_in_app", "app_position", "app_frequency", "app_max_views", "app_roles",
  "starts_at", "ends_at", "login_clicks",
];
const adColumns = (prefix = "") => AD_COLUMN_LIST.map((c) => prefix + c).join(", ");
const AD_COLUMNS = adColumns();
const UPLOAD_DIR = path.resolve(__dirname, "../uploads"); // multer's dest; also where uploadToS3 reads from

function withFileUrl(ad) {
  return { ...ad, file_url: adFileUrl(ad) };
}

// Every ad key is new (timestamped), so browsers may keep the file for good.
const AD_CACHE_CONTROL = "public, max-age=31536000, immutable";
// Ads show at most ~600px wide: a 1200px WebP stays sharp on retina screens
// and is a small fraction of a full-size PNG or photo.
const AD_MAX_WIDTH = 1200;
const OPTIMIZABLE_IMAGES = new Set(["image/jpeg", "image/png", "image/webp"]); // GIFs may be animated

async function optimizeAdImage(file) {
  if (!OPTIMIZABLE_IMAGES.has(file.mimetype)) return null;
  const input = path.join(UPLOAD_DIR, path.basename(file.filename));
  const { data, info } = await sharp(input)
    .rotate()
    .resize({ width: AD_MAX_WIDTH, withoutEnlargement: true })
    .webp({ quality: 80 })
    .toBuffer({ resolveWithObject: true });
  const filename = `${path.basename(file.filename)}-optimized`;
  await fsp.writeFile(path.join(UPLOAD_DIR, filename), data);
  return { filename, mimetype: "image/webp", width: info.width, height: info.height };
}

async function uploadAdFile(file) {
  let optimized = null;
  try {
    optimized = await optimizeAdImage(file);
  } catch (err) {
    console.error("[loginAds] image optimize failed, uploading original:", err.message);
  }
  const source = optimized || file;
  const ext = optimized ? ".webp" : path.extname(file.originalname || "").toLowerCase().replace(/[^a-z0-9.]/g, "") || "";
  try {
    // Clean key name: original names can contain characters that break the S3 URL.
    const result = await uploadToS3({ filename: source.filename, mimetype: source.mimetype, originalname: `login-ad${ext}`, cacheControl: AD_CACHE_CONTROL });
    return {
      url: result.Location,
      key: result.Key,
      mimetype: source.mimetype,
      width: optimized ? optimized.width : null,
      height: optimized ? optimized.height : null,
    };
  } finally {
    if (optimized) fsp.unlink(path.join(UPLOAD_DIR, optimized.filename)).catch(() => {});
  }
}

// Columns from the uploaded (possibly optimized) file.
function fileFields(uploaded) {
  return {
    media_type: MEDIA_TYPES[uploaded.mimetype],
    media_url: uploaded.url,
    s3_key: uploaded.key,
    mime_type: uploaded.mimetype,
    ...(uploaded.width && uploaded.height ? { media_width: uploaded.width, media_height: uploaded.height } : {}),
  };
}

// Builds the column -> value map from a (multipart) body, only for keys present.
function readAdFields(body) {
  const fields = {};
  const has = (k) => Object.prototype.hasOwnProperty.call(body, k);
  if (has("title")) fields.title = String(body.title || "").trim().slice(0, 200) || null;
  if (has("link_url")) fields.link_url = sanitizeLinkUrl(body.link_url);
  if (has("link_label")) fields.link_label = String(body.link_label || "").trim().slice(0, 80) || null;
  if (has("show_as_button")) fields.show_as_button = toBool(body.show_as_button);
  if (has("button_x")) fields.button_x = clampPercent(body.button_x, 50);
  if (has("button_y")) fields.button_y = clampPercent(body.button_y, 85);
  if (has("button_color")) fields.button_color = sanitizeColor(body.button_color, "#e4572e");
  if (has("button_text_color")) fields.button_text_color = sanitizeColor(body.button_text_color, "#ffffff");
  if (has("button_size")) fields.button_size = BUTTON_SIZES.includes(body.button_size) ? body.button_size : "md";
  if (has("is_active")) fields.is_active = toBool(body.is_active);
  if (has("media_width")) fields.media_width = toDimension(body.media_width);
  if (has("media_height")) fields.media_height = toDimension(body.media_height);
  if (has("show_on_login")) fields.show_on_login = toBool(body.show_on_login);
  if (has("show_in_app")) fields.show_in_app = toBool(body.show_in_app);
  if (has("app_position")) fields.app_position = APP_POSITIONS.includes(body.app_position) ? body.app_position : "bottom-right";
  if (has("app_frequency")) fields.app_frequency = APP_FREQUENCIES.includes(body.app_frequency) ? body.app_frequency : "once_per_session";
  if (has("app_max_views")) {
    const n = parseInt(body.app_max_views, 10);
    fields.app_max_views = Number.isFinite(n) && n > 0 ? Math.min(n, 1000) : null;
  }
  if (has("app_roles")) {
    const raw = Array.isArray(body.app_roles) ? body.app_roles : String(body.app_roles || "").split(",");
    fields.app_roles = [...new Set(raw.map((r) => String(r).trim()).filter((r) => APP_ROLES.includes(r)))];
  }
  if (has("starts_at")) fields.starts_at = toDate(body.starts_at);
  if (has("ends_at")) fields.ends_at = toDate(body.ends_at);
  return fields;
}

function toDate(value) {
  const raw = String(value || "").trim();
  if (!raw) return null;
  const d = new Date(raw);
  return Number.isNaN(d.getTime()) ? null : d;
}

function validationError(body) {
  const raw = String(body.link_url || "").trim();
  if (raw && !sanitizeLinkUrl(raw)) return "Link must be a web address (https://…) or a site path (/…).";
  const starts = toDate(body.starts_at);
  const ends = toDate(body.ends_at);
  if (starts && ends && ends <= starts) return "The end date must be after the start date.";
  return null;
}

module.exports = {
  // Shown in the "Ads" panel of /admin/announcements, with in-app stats.
  listAds: async () => {
    try {
      await ensureLoginAdsSchema(db);
      const { rows } = await db.query(
        `SELECT ${adColumns("a.")},
                COALESCE(s.seen, 0)::int AS app_seen, COALESCE(s.closed, 0)::int AS app_closed, COALESCE(s.clicked, 0)::int AS app_clicked
           FROM login_ads a
           LEFT JOIN (
             SELECT ad_id, COUNT(*) FILTER (WHERE view_count > 0) AS seen,
                    COUNT(*) FILTER (WHERE dismissed_at IS NOT NULL) AS closed,
                    COUNT(*) FILTER (WHERE clicked_at IS NOT NULL) AS clicked
               FROM login_ad_receipts GROUP BY ad_id
           ) s ON s.ad_id = a.id
          ORDER BY a.sort_order ASC, a.id ASC`
      );
      return rows.map(withFileUrl);
    } catch (err) {
      console.error("[loginAds] list failed:", err.message);
      return [];
    }
  },

  create: async (req, res) => {
    if (!req.file) {
      return res.status(400).json({ success: false, message: "Choose an image, PDF or video (JPG, PNG, GIF, WebP, PDF, MP4, WebM)." });
    }
    const badLink = validationError(req.body);
    if (badLink) return res.status(400).json({ success: false, message: badLink });

    try {
      await ensureLoginAdsSchema(db);
      const uploaded = await uploadAdFile(req.file);
      const fields = {
        show_as_button: true,
        is_active: true,
        ...readAdFields(req.body),
        ...fileFields(uploaded),
        created_by: req.session && req.session.userId ? req.session.userId : null,
      };
      const cols = Object.keys(fields);
      const { rows } = await db.query(
        `INSERT INTO login_ads (${cols.join(", ")}, sort_order)
         VALUES (${cols.map((_, i) => `$${i + 1}`).join(", ")},
                 (SELECT COALESCE(MAX(sort_order), 0) + 1 FROM login_ads))
         RETURNING ${AD_COLUMNS}`,
        cols.map((c) => fields[c])
      );
      invalidateLoginAdsCache();
      return res.json({ success: true, ad: withFileUrl(rows[0]) });
    } catch (err) {
      console.error("[loginAds] create failed:", err);
      return res.status(500).json({ success: false, message: "Failed to save the ad. Please try again." });
    }
  },

  update: async (req, res) => {
    const id = parseInt(req.params.id, 10);
    const badLink = validationError(req.body);
    if (badLink) return res.status(400).json({ success: false, message: badLink });

    try {
      await ensureLoginAdsSchema(db);
      const existing = await db.query(`SELECT s3_key FROM login_ads WHERE id = $1`, [id]);
      if (!existing.rows.length) return res.status(404).json({ success: false, message: "Ad not found." });

      const fields = readAdFields(req.body);
      if (req.file) {
        const uploaded = await uploadAdFile(req.file);
        Object.assign(fields, fileFields(uploaded));
      }
      const cols = Object.keys(fields);
      if (!cols.length) return res.status(400).json({ success: false, message: "Nothing to update." });

      const { rows } = await db.query(
        `UPDATE login_ads
            SET ${cols.map((c, i) => `${c} = $${i + 1}`).join(", ")}, updated_at = NOW()
          WHERE id = $${cols.length + 1}
          RETURNING ${AD_COLUMNS}`,
        [...cols.map((c) => fields[c]), id]
      );
      invalidateLoginAdsCache();

      const oldKey = existing.rows[0].s3_key;
      if (req.file && oldKey) deleteFromS3(oldKey).catch(() => {});
      return res.json({ success: true, ad: withFileUrl(rows[0]) });
    } catch (err) {
      console.error("[loginAds] update failed:", err);
      return res.status(500).json({ success: false, message: "Failed to update the ad." });
    }
  },

  remove: async (req, res) => {
    const id = parseInt(req.params.id, 10);
    try {
      await ensureLoginAdsSchema(db);
      const { rows } = await db.query(`DELETE FROM login_ads WHERE id = $1 RETURNING s3_key`, [id]);
      invalidateLoginAdsCache();
      if (rows[0] && rows[0].s3_key) deleteFromS3(rows[0].s3_key).catch(() => {});
      return res.json({ success: true });
    } catch (err) {
      console.error("[loginAds] delete failed:", err);
      return res.status(500).json({ success: false, message: "Failed to delete the ad." });
    }
  },

  reorder: async (req, res) => {
    const ids = (Array.isArray(req.body && req.body.ids) ? req.body.ids : [])
      .map((x) => parseInt(x, 10))
      .filter(Number.isFinite);
    if (!ids.length) return res.status(400).json({ success: false, message: "No ads to reorder." });
    try {
      await ensureLoginAdsSchema(db);
      await db.query(
        `UPDATE login_ads AS a SET sort_order = o.ord, updated_at = NOW()
           FROM unnest($1::int[]) WITH ORDINALITY AS o(id, ord)
          WHERE a.id = o.id`,
        [ids]
      );
      invalidateLoginAdsCache();
      return res.json({ success: true });
    } catch (err) {
      console.error("[loginAds] reorder failed:", err);
      return res.status(500).json({ success: false, message: "Failed to save the order." });
    }
  },

  // Signed-in viewer receipts for the in-app ad card: seen / dismiss / click.
  recordViewerEvent: async (req, res) => {
    const id = parseInt(req.params.id, 10);
    const action = req.params.action;
    const identity = resolveViewerIdentity(req);
    if (!identity) return res.status(401).json({ error: "Not signed in." });
    if (!Number.isFinite(id) || !["seen", "dismiss", "click"].includes(action)) return res.sendStatus(400);
    try {
      await ensureLoginAdsSchema(db);
      if (action === "seen") {
        const seen = req.session.seenLoginAdIds || (req.session.seenLoginAdIds = []);
        if (!seen.includes(id)) seen.push(id);
        await db.query(
          `INSERT INTO login_ad_receipts (ad_id, user_id, viewer_type, view_count, first_seen_at, last_seen_at)
           SELECT $1, $2, $3, 1, now(), now() WHERE EXISTS (SELECT 1 FROM login_ads WHERE id = $1)
           ON CONFLICT (ad_id, viewer_type, user_id)
           DO UPDATE SET view_count = login_ad_receipts.view_count + 1, last_seen_at = now()`,
          [id, identity.userId, identity.viewerType]
        );
      } else {
        const column = action === "dismiss" ? "dismissed_at" : "clicked_at";
        await db.query(
          `INSERT INTO login_ad_receipts (ad_id, user_id, viewer_type, ${column})
           SELECT $1, $2, $3, now() WHERE EXISTS (SELECT 1 FROM login_ads WHERE id = $1)
           ON CONFLICT (ad_id, viewer_type, user_id) DO UPDATE SET ${column} = now()`,
          [id, identity.userId, identity.viewerType]
        );
      }
      return res.json({ success: true });
    } catch (err) {
      console.error("[loginAds] viewer event failed:", err.message);
      return res.status(500).json({ error: "Unable to record." });
    }
  },

  // Public: counts a click on a sign-in page ad (sent with navigator.sendBeacon).
  recordSignInClick: async (req, res) => {
    const id = parseInt(req.params.id, 10);
    if (!Number.isFinite(id)) return res.sendStatus(400);
    try {
      await db.query(`UPDATE login_ads SET login_clicks = login_clicks + 1 WHERE id = $1 AND is_active = TRUE`, [id]);
    } catch (_) {}
    return res.sendStatus(204);
  },

  // Public: streams a PDF ad from S3 so the login page can render it with PDF.js.
  // Inactive ads are only served to full Admins (for the editor preview).
  serveFile: async (req, res) => {
    const id = parseInt(req.params.id, 10);
    try {
      await ensureLoginAdsSchema(db);
      const { rows } = await db.query(
        `SELECT s3_key, mime_type, is_active FROM login_ads WHERE id = $1 AND media_type = 'pdf'`,
        [id]
      );
      const ad = rows[0];
      const isAdmin = req.session && req.session.accountType === "Admin";
      if (!ad || !ad.s3_key || (!ad.is_active && !isAdmin)) return res.sendStatus(404);

      const obj = await s3Client.send(
        new GetObjectCommand({ Bucket: process.env.S3_BUCKET_NAME, Key: ad.s3_key })
      );
      res.set("Content-Type", ad.mime_type || "application/pdf");
      res.set("Cache-Control", ad.is_active ? "public, max-age=3600" : "private, no-store");
      if (obj.ContentLength) res.set("Content-Length", String(obj.ContentLength));
      obj.Body.on("error", () => res.end());
      obj.Body.pipe(res);
    } catch (err) {
      console.error("[loginAds] file proxy failed:", err.message);
      if (!res.headersSent) res.sendStatus(404);
    }
  },
};
