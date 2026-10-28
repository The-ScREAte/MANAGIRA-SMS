const path = require("path");
const fsp = require("fs").promises;
const sharp = require("sharp");
const db = require("../config/db");
const { uploadToS3, deleteFromS3, s3Client, GetObjectCommand, PutObjectCommand } = require("../config/s3");
const zlib = require("zlib");
const crypto = require("crypto");
const { MEDIA_TYPES, ensureAppDemoSchema, getTour, invalidateTourCache } = require("../utils/appDemo");
const capture = require("../utils/appDemoCapture");
const { pack: packCapture, bodyOf, headOf } = require("../public/js/capturePack");
const { promisify } = require("util");
// Large captures are compressed on libuv's thread pool, so other requests keep flowing.
const gzipAsync = promisify(zlib.gzip);
const gunzipAsync = promisify(zlib.gunzip);
const brotliAsync = promisify(zlib.brotliCompress);

const UPLOAD_DIR = path.resolve(__dirname, "../uploads"); // multer's dest; also where uploadToS3 reads from
// Every key is new (timestamped), so browsers may keep the file for good.
const CACHE_CONTROL = "public, max-age=31536000, immutable";
// Screens are full-page captures shown up to ~1600px wide, zoomable to 2x.
const MAX_WIDTH = 2400;
const OPTIMIZABLE_IMAGES = new Set(["image/jpeg", "image/png", "image/webp"]); // GIFs may be animated

async function uploadMediaFile(file) {
  let optimized = null;
  if (OPTIMIZABLE_IMAGES.has(file.mimetype)) {
    try {
      const input = path.join(UPLOAD_DIR, path.basename(file.filename));
      const { data, info } = await sharp(input)
        .rotate()
        .resize({ width: MAX_WIDTH, withoutEnlargement: true })
        .webp({ quality: 84 })
        .toBuffer({ resolveWithObject: true });
      const filename = `${path.basename(file.filename)}-optimized`;
      await fsp.writeFile(path.join(UPLOAD_DIR, filename), data);
      optimized = { filename, mimetype: "image/webp", width: info.width, height: info.height };
      fsp.unlink(input).catch(() => {});
    } catch (err) {
      console.error("[appDemo] image optimize failed, uploading original:", err.message);
    }
  }
  const source = optimized || file;
  const ext = optimized ? ".webp" : path.extname(file.originalname || "").toLowerCase().replace(/[^a-z0-9.]/g, "");
  // Clean key name: original names can contain characters that break the S3 URL.
  const result = await uploadToS3({ filename: source.filename, mimetype: source.mimetype, originalname: `app-demo${ext}`, cacheControl: CACHE_CONTROL });
  return {
    media_type: MEDIA_TYPES[file.mimetype],
    media_url: result.Location,
    s3_key: result.Key,
    mime_type: source.mimetype,
    media_width: optimized ? optimized.width : null,
    media_height: optimized ? optimized.height : null,
  };
}

const text = (value, max) => String(value == null ? "" : value).replace(/\r\n/g, "\n").trim().slice(0, max) || null;
const ids = (body) => (Array.isArray(body && body.ids) ? body.ids : []).map((x) => parseInt(x, 10)).filter(Number.isFinite);
const has = (body, key) => Object.prototype.hasOwnProperty.call(body || {}, key);
const setClause = (cols) => cols.map((c, i) => `${c} = $${i + 1}`).join(", ");
const fileTitle = (file) => text(path.parse(file.originalname || "").name.replace(/[-_]+/g, " "), 80);
// A version is named after its file when the name says light or dark.
const versionName = (file) => {
  const name = String(file.originalname || "").toLowerCase();
  return /dark/.test(name) ? "Dark" : /light/.test(name) ? "Light" : null;
};

function sectionFields(body) {
  const fields = {};
  if (has(body, "name")) fields.name = text(body.name, 60);
  if (has(body, "description")) fields.description = text(body.description, 240);
  return fields;
}

function featureFields(body) {
  const fields = {};
  if (has(body, "title")) fields.title = text(body.title, 120);
  if (has(body, "category")) fields.category = text(body.category, 40);
  if (has(body, "summary")) fields.summary = text(body.summary, 600);
  if (has(body, "category_id")) {
    const id = parseInt(body.category_id, 10);
    fields.category_id = Number.isFinite(id) ? id : null;
  }
  if (has(body, "is_active")) fields.is_active = body.is_active === true || body.is_active === "true" || body.is_active === "1";
  return fields;
}

function screenFields(body) {
  const fields = {};
  if (has(body, "label")) fields.label = text(body.label, 80);
  if (has(body, "caption")) fields.caption = text(body.caption, 400);
  return fields;
}

// Every editor action answers with the whole tour, so the page redraws from one source.
async function respondWithTour(res, extra = {}) {
  invalidateTourCache();
  const tour = await getTour(db, { includeHidden: true });
  return res.json({ success: true, sections: tour.sections, ...extra });
}

function fail(res, err, message) {
  console.error(`[appDemo] ${message}:`, err);
  return res.status(500).json({ success: false, message: `${message}. Please try again.` });
}

const notFound = (res, what) => res.status(404).json({ success: false, message: `${what} not found.` });
const badRequest = (res, message) => res.status(400).json({ success: false, message });

function removeTempFiles(files) {
  for (const f of files || []) fsp.unlink(path.join(UPLOAD_DIR, path.basename(f.filename))).catch(() => {});
}

function deleteKeys(rows) {
  rows.forEach((r) => {
    [r.s3_key, r.poster_s3_key].forEach((key) => { if (key) deleteFromS3(key).catch(() => {}); });
  });
}

async function insertMedia(screenId, uploaded, label) {
  await db.query(
    `INSERT INTO app_demo_screen_media (screen_id, label, media_type, media_url, s3_key, mime_type, media_width, media_height, sort_order)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8,
             (SELECT COALESCE(MAX(sort_order), 0) + 1 FROM app_demo_screen_media WHERE screen_id = $1))`,
    [screenId, label, uploaded.media_type, uploaded.media_url, uploaded.s3_key, uploaded.mime_type, uploaded.media_width, uploaded.media_height]
  );
}

// Saves a drag-and-drop order; scopeSql keeps it to one feature or step.
function reorderHandler(table, label, scopeSql) {
  return async (req, res) => {
    const order = ids(req.body);
    if (!order.length) return badRequest(res, "Nothing to reorder.");
    try {
      await ensureAppDemoSchema(db);
      await db.query(
        `UPDATE ${table} AS t SET sort_order = o.ord
           FROM unnest($1::int[]) WITH ORDINALITY AS o(id, ord) WHERE t.id = o.id ${scopeSql ? scopeSql : ""}`,
        scopeSql ? [order, parseInt(req.params.id, 10)] : [order]
      );
      return respondWithTour(res);
    } catch (err) {
      return fail(res, err, `Could not save the ${label} order`);
    }
  };
}

// ---------- Interactive captures (see utils/appDemoCapture.js) ----------

const DEFAULT_ACCENT = "#14b8a6";
const toFlag = (v, fallback) => (v === undefined || v === null || v === "" ? fallback : v === true || v === "true" || v === "1" || v === 1);
const cleanAccent = (v) => (/^#[0-9a-f]{6}$/i.test(String(v || "").trim()) ? String(v).trim().toLowerCase() : DEFAULT_ACCENT);
// Keep each explanation tied to its original recorded click, even after removals.
function cleanGuideEntries(raw, length) {
  let list = raw;
  if (typeof raw === "string") { try { list = JSON.parse(raw); } catch (_) { list = []; } }
  if (!Array.isArray(list)) list = [];
  const seen = new Set();
  const entries = [];
  list.forEach((entry, position) => {
    const index = entry && Number.isInteger(Number(entry.index)) ? Number(entry.index) : position;
    if (index < 0 || index >= length || seen.has(index)) return;
    seen.add(index);
    entries.push({ index, text: String((entry && (entry.text != null ? entry.text : entry)) || "").trim().slice(0, 240) });
  });
  return entries;
}
const isPlainObject = (v) => v && typeof v === "object" && !Array.isArray(v);
const attrsOf = (v) => (isPlainObject(v) ? Object.fromEntries(Object.entries(v).filter(([k, x]) => /^[a-z][a-z0-9:_-]*$/i.test(k) && !/^on/i.test(k) && typeof x === "string").slice(0, 40)) : {});

// Checks a capture's shape and keeps only the fields the player reads.
function parseCapture(raw) {
  let data;
  try { data = JSON.parse(raw); } catch (_) { return null; }
  if (!isPlainObject(data) || data.v !== 1 || !isPlainObject(data.viewport)) return null;
  const w = parseInt(data.viewport.w, 10);
  const h = parseInt(data.viewport.h, 10);
  if (!(w >= 320 && w <= 3840 && h >= 240 && h <= 2400)) return null;
  const states = Array.isArray(data.states) ? data.states : [];
  // Packed (public/js/capturePack.js): each view and head lists its pieces of markup from the pool.
  const pool = Array.isArray(data.pool) ? data.pool : null;
  if (pool && !pool.every((x) => typeof x === "string")) return null;
  const isPart = (k) => Number.isInteger(k) && k >= 0 && k < pool.length;
  const headParts = pool && Array.isArray(data.headParts) ? data.headParts : null;
  if (headParts && !headParts.every((parts) => Array.isArray(parts) && parts.every(isPart))) return null;
  const heads = headParts || (Array.isArray(data.heads) ? data.heads.filter((x) => typeof x === "string") : []);
  if (!heads.length || !states.length) return null;
  const cleanStates = [];
  for (const st of states) {
    const head = parseInt(st && st.head, 10);
    if (!isPlainObject(st) || !(head >= 0 && head < heads.length)) return null;
    const markup = pool ? { parts: Array.isArray(st.parts) && st.parts.every(isPart) ? st.parts : null } : { body: typeof st.body === "string" ? st.body : null };
    if (markup.parts === null || markup.body === null) return null;
    cleanStates.push({ head, ...markup, htmlAttrs: attrsOf(st.htmlAttrs), bodyAttrs: attrsOf(st.bodyAttrs), scrollY: Math.max(0, parseInt(st.scrollY, 10) || 0) });
  }
  const links = (Array.isArray(data.links) ? data.links : [])
    .map((l) => ({ from: parseInt(l && l.from, 10), to: parseInt(l && l.to, 10), el: String((l && l.el) || "") }))
    .filter((l) => l.from >= 0 && l.from < cleanStates.length && l.to >= 0 && l.to < cleanStates.length && l.from !== l.to && /^\d+$/.test(l.el));
  // The recorded clicks in order: the guided walkthrough.
  const guide = (Array.isArray(data.guide) ? data.guide : [])
    .map((g) => ({ from: parseInt(g && g.from, 10), to: parseInt(g && g.to, 10), el: String((g && g.el) || ""), label: String((g && g.label) || "").slice(0, 80) }))
    .filter((g) => g.from >= 0 && g.from < cleanStates.length && g.to >= 0 && g.to < cleanStates.length && g.from !== g.to && /^\d+$/.test(g.el));
  // Captures that carry their appearance hold the page's own colors; the player shows them light or dark.
  const look = isPlainObject(data.appearance) ? data.appearance : null;
  const appearance = look && ["white", "gray", "dark"].includes(look.mode)
    ? { mode: look.mode, light: look.light === "gray" ? "gray" : "white" }
    : undefined;
  return {
    v: 1,
    appearance,
    guide,
    title: String(data.title || "").slice(0, 200),
    url: String(data.url || "").slice(0, 500),
    viewport: { w, h },
    ...(headParts ? { headParts } : { heads }),
    states: cleanStates,
    links,
    ...(pool ? { pool } : {}),
  };
}

// The first bytes of a gzipped file (stops decompressing once it has enough).
function gunzipStart(buffer, limit) {
  return new Promise((resolve) => {
    const chunks = [];
    let size = 0;
    const done = () => resolve(Buffer.concat(chunks));
    const unzip = zlib.createGunzip();
    unzip.on("data", (chunk) => {
      chunks.push(chunk);
      size += chunk.length;
      if (size >= limit) { unzip.destroy(); done(); }
    });
    unzip.on("end", done);
    unzip.on("error", done);
    unzip.end(buffer);
  });
}

// The walkthrough of a stored capture, read from the start of the file: the
// guide comes before the views, so a large capture is never parsed whole.
function storedGuide(text) {
  const at = text.indexOf('"guide":[');
  if (at < 0) return [];
  let depth = 0;
  let inString = false;
  for (let i = at + 8; i < text.length; i++) {
    const c = text[i];
    if (inString) { if (c === "\\") i++; else if (c === '"') inString = false; continue; }
    if (c === '"') inString = true;
    else if (c === "[") depth++;
    else if (c === "]" && --depth === 0) { try { return JSON.parse(text.slice(at + 8, i + 1)); } catch (_) { return []; } }
  }
  return [];
}

// Captures kept in memory (newest last), so the player's data is served without
// a trip to S3. They are stored packed and gzipped and sent as they are, with a
// brotli copy (much smaller: views repeat each other beyond gzip's reach). Only older, unpacked captures are packed here, and
// only when small enough: the server never parses a large capture.
const UNPACK_LIMIT = 40 * 1024 * 1024;
const BROTLI_LIMIT = UNPACK_LIMIT;
const capturesInMemory = new Map();
function compressedCapture(key) {
  let entry = capturesInMemory.get(key);
  if (entry) {
    capturesInMemory.delete(key);
  } else {
    entry = (async () => {
      const obj = await s3Client.send(new GetObjectCommand({ Bucket: process.env.S3_BUCKET_NAME, Key: key }));
      const stored = Buffer.from(await obj.Body.transformToByteArray());
      const out = { etag: `"c2-${crypto.createHash("sha1").update(key).digest("hex").slice(0, 16)}"`, gzip: stored, br: null };
      let raw;
      try { raw = await gunzipAsync(stored, { maxOutputLength: UNPACK_LIMIT }); } catch (_) { return out; } // too large: as stored
      // Older captures (unpacked, or packed before heads shared the pool) are packed the current way.
      if (raw.lastIndexOf('"headParts":[') < 0) {
        try {
          raw = Buffer.from(JSON.stringify(packCapture(JSON.parse(raw.toString("utf8")))));
          out.gzip = await gzipAsync(raw, { level: 9 });
          // Stored the new way too (same content, much smaller), so this
          // upgrade happens once instead of after every restart.
          if (process.env.APP_DEMO_STORE_REPACKED !== "false") s3Client.send(new PutObjectCommand({
            Bucket: process.env.S3_BUCKET_NAME, Key: key, Body: out.gzip, ContentType: "application/json", CacheControl: CACHE_CONTROL,
          })).catch((err) => console.error("[appDemo] could not store the repacked capture:", err.message));
        } catch (_) { /* serve it as stored */ }
      }
      if (raw.length <= BROTLI_LIMIT) {
        out.br = await brotliAsync(raw, { params: { [zlib.constants.BROTLI_PARAM_QUALITY]: raw.length > 16 * 1024 * 1024 ? 9 : 10, [zlib.constants.BROTLI_PARAM_SIZE_HINT]: raw.length } });
      }
      return out;
    })();
    entry.catch(() => capturesInMemory.delete(key));
  }
  capturesInMemory.set(key, entry);
  if (capturesInMemory.size > 12) capturesInMemory.delete(capturesInMemory.keys().next().value);
  return entry;
}

const attrString = (attrs) => Object.entries(attrs || {}).map(([k, v]) => ` ${k}="${String(v).replace(/&/g, "&amp;").replace(/"/g, "&quot;")}"`).join("");
const stateHtml = (data, i) => {
  const st = data.states[i];
  return `<!DOCTYPE html><html${attrString(st.htmlAttrs)}><head>${headOf(data, st.head)}</head><body${attrString(st.bodyAttrs)}>${bodyOf(data, i)}</body></html>`;
};

// Renders the first state, as visitors first see it, for the cover image: the
// capture has no scripts; only the appearance script runs, for gray or dark.
async function renderCapturePoster(data) {
  const { withPage } = require("../utils/pdfService");
  const mode = data.appearance ? data.appearance.mode : "white";
  const shot = await withPage(async (page) => {
    await page.setJavaScriptEnabled(mode !== "white");
    await page.setViewport({ width: data.viewport.w, height: data.viewport.h, deviceScaleFactor: 1 });
    const html = mode === "white" ? stateHtml(data, 0) : stateHtml(data, 0).replace(/^<!DOCTYPE html><html([^>]*?) data-appearance="[^"]*"/, "<!DOCTYPE html><html$1").replace(/^<!DOCTYPE html><html/, `<!DOCTYPE html><html data-appearance="${mode}"`);
    await page.setContent(html, { waitUntil: "networkidle0", timeout: 25000 }).catch(() => {});
    if (mode !== "white") {
      await page.addScriptTag({ path: path.join(__dirname, "../public/js/appearance.js") }).catch(() => {});
      await page.waitForFunction(() => document.documentElement.classList.contains("ap-ready"), { timeout: 5000 }).catch(() => {});
      await new Promise((r) => setTimeout(r, 150));
    }
    return page.screenshot({ type: "png" });
  });
  const name = `app-demo-cover-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const info = await sharp(shot).resize({ width: 1600, withoutEnlargement: true }).webp({ quality: 84 }).toFile(path.join(UPLOAD_DIR, name));
  const stored = await uploadToS3({ filename: name, mimetype: "image/webp", originalname: "app-demo-cover.webp", cacheControl: CACHE_CONTROL });
  return { url: stored.Location, key: stored.Key, width: info.width };
}

module.exports = {
  publicPage: async (req, res) => {
    let sections = [];
    try {
      sections = (await getTour(db)).sections;
    } catch (err) {
      console.error("[appDemo] tour load failed:", err.message);
    }
    // The page carries signed-in details (header), so only the visitor's own browser keeps it.
    res.set("Cache-Control", "private, max-age=120, stale-while-revalidate=86400");
    res.render("legal&Compliance/appDemo", {
      title: "See Managira in action - Managira",
      description: "Take a guided tour of Managira for school management, parents, students and Mira, the AI assistant.",
      keywords: "managira demo, school management software demo, product tour, parent portal, student portal, school ai assistant",
      canonicalUrl: "https://managira.com/legal/app-demo",
      showFooterTopSection: false,
      hideGlobalHeader: true,
      hideGlobalFooter: true,
      hideGlobalChatbot: true,
      disableMainZoom: true, // the viewer sizes itself to the window
      sections,
    });
  },

  // Streams an uploaded PDF (for PDF.js) from S3, or serves an interactive
  // capture (packed and compressed, from memory) to the player.
  serveFile: async (req, res) => {
    const id = parseInt(req.params.id, 10);
    try {
      await ensureAppDemoSchema(db);
      const { rows } = await db.query(
        `SELECT m.s3_key, m.mime_type, m.media_type, f.is_active FROM app_demo_screen_media m
           JOIN app_demo_screens s ON s.id = m.screen_id
           JOIN app_demo_features f ON f.id = s.feature_id
          WHERE m.id = $1 AND m.media_type IN ('pdf', 'html')`,
        [id]
      );
      const media = rows[0];
      const isAdmin = req.session && req.session.accountType === "Admin";
      if (!media || !media.s3_key || (!media.is_active && !isAdmin)) return res.sendStatus(404);
      res.set("Cache-Control", media.is_active ? "public, max-age=3600" : "private, no-store");
      if (media.media_type === "html") {
        const capture = await compressedCapture(media.s3_key);
        res.set("ETag", capture.etag);
        res.set("Vary", "Accept-Encoding");
        // Kept by browsers (and the service worker) between visits; a stale copy
        // may be shown while the server is restarting rather than an error.
        res.set("Cache-Control", "public, max-age=600, stale-while-revalidate=604800, stale-if-error=604800");
        if (req.headers["if-none-match"] === capture.etag) return res.status(304).end();
        const br = Boolean(capture.br) && /\bbr\b/.test(req.headers["accept-encoding"] || "");
        res.set("Content-Type", "application/json; charset=utf-8");
        res.set("Content-Encoding", br ? "br" : "gzip");
        res.set("X-Content-Type-Options", "nosniff");
        return res.end(br ? capture.br : capture.gzip);
      }
      const obj = await s3Client.send(new GetObjectCommand({ Bucket: process.env.S3_BUCKET_NAME, Key: media.s3_key }));
      res.set("Content-Type", media.mime_type || "application/pdf");
      if (obj.ContentLength) res.set("Content-Length", String(obj.ContentLength));
      obj.Body.on("error", () => res.end());
      obj.Body.pipe(res);
    } catch (err) {
      console.error("[appDemo] file proxy failed:", err.message);
      if (!res.headersSent) res.sendStatus(404);
    }
  },

  adminPage: async (req, res) => {
    try {
      const [tour, window, schools] = await Promise.all([
        getTour(db, { includeHidden: true }),
        capture.activeWindow(db),
        db.query(`SELECT organization_id AS id, organization_name AS name FROM organizations WHERE deleted = false ORDER BY organization_name`),
      ]);
      res.render("admin/appDemo", {
        title: "App Demo",
        sections: tour.sections,
        captureWindow: window ? { schoolId: window.organization_id, school: window.organization_name, endsAt: new Date(window.ends_at).toISOString() } : null,
        captureMinutes: capture.WINDOW_MINUTES,
        schools: schools.rows,
        messages: req.flash(),
      });
    } catch (err) {
      console.error("[appDemo] admin page failed:", err);
      req.flash("error", "Failed to load the App Demo editor.");
      res.redirect("/admin");
    }
  },

  // ---------- Sections ----------

  createSection: async (req, res) => {
    const fields = sectionFields(req.body);
    if (!fields.name) return badRequest(res, "Give the section a name.");
    try {
      await ensureAppDemoSchema(db);
      const { rows } = await db.query(
        `INSERT INTO app_demo_categories (name, description, sort_order)
         VALUES ($1, $2, (SELECT COALESCE(MAX(sort_order), 0) + 1 FROM app_demo_categories)) RETURNING id`,
        [fields.name, fields.description || null]
      );
      return respondWithTour(res, { id: rows[0].id });
    } catch (err) {
      return fail(res, err, "Could not create the section");
    }
  },

  updateSection: async (req, res) => {
    const id = parseInt(req.params.id, 10);
    const fields = sectionFields(req.body);
    if (has(fields, "name") && !fields.name) return badRequest(res, "The name cannot be empty.");
    const cols = Object.keys(fields);
    if (!cols.length) return badRequest(res, "Nothing to update.");
    try {
      await ensureAppDemoSchema(db);
      const { rowCount } = await db.query(
        `UPDATE app_demo_categories SET ${setClause(cols)}, updated_at = NOW() WHERE id = $${cols.length + 1}`,
        [...cols.map((c) => fields[c]), id]
      );
      if (!rowCount) return notFound(res, "Section");
      return respondWithTour(res);
    } catch (err) {
      return fail(res, err, "Could not save the section");
    }
  },

  deleteSection: async (req, res) => {
    const id = parseInt(req.params.id, 10);
    try {
      await ensureAppDemoSchema(db);
      const used = await db.query(`SELECT COUNT(*)::int AS n FROM app_demo_features WHERE category_id = $1`, [id]);
      if (used.rows[0].n) return badRequest(res, "Move or delete the features in this section first.");
      await db.query(`DELETE FROM app_demo_categories WHERE id = $1`, [id]);
      return respondWithTour(res);
    } catch (err) {
      return fail(res, err, "Could not delete the section");
    }
  },

  reorderSections: reorderHandler("app_demo_categories", "section"),

  // ---------- Features ----------

  createFeature: async (req, res) => {
    const fields = featureFields(req.body);
    if (!fields.title) return badRequest(res, "Give the feature a title.");
    try {
      await ensureAppDemoSchema(db);
      const { rows } = await db.query(
        `INSERT INTO app_demo_features (title, category, summary, category_id, is_active, created_by, sort_order)
         VALUES ($1, $2, $3, $4, $5, $6, (SELECT COALESCE(MAX(sort_order), 0) + 1 FROM app_demo_features))
         RETURNING id`,
        [fields.title, fields.category || null, fields.summary || null, fields.category_id || null, fields.is_active !== false, req.session.userId || null]
      );
      return respondWithTour(res, { id: rows[0].id });
    } catch (err) {
      return fail(res, err, "Could not create the feature");
    }
  },

  updateFeature: async (req, res) => {
    const id = parseInt(req.params.id, 10);
    const fields = featureFields(req.body);
    if (has(fields, "title") && !fields.title) return badRequest(res, "The title cannot be empty.");
    const cols = Object.keys(fields);
    if (!cols.length) return badRequest(res, "Nothing to update.");
    // A feature moved to another section goes to the end of it.
    const move = has(fields, "category_id")
      ? `, sort_order = CASE WHEN category_id IS DISTINCT FROM $${cols.indexOf("category_id") + 1}
           THEN (SELECT COALESCE(MAX(sort_order), 0) + 1 FROM app_demo_features) ELSE sort_order END`
      : "";
    try {
      await ensureAppDemoSchema(db);
      const { rowCount } = await db.query(
        `UPDATE app_demo_features SET ${setClause(cols)}, updated_at = NOW() ${move} WHERE id = $${cols.length + 1}`,
        [...cols.map((c) => fields[c]), id]
      );
      if (!rowCount) return notFound(res, "Feature");
      return respondWithTour(res);
    } catch (err) {
      return fail(res, err, "Could not save the feature");
    }
  },

  deleteFeature: async (req, res) => {
    const id = parseInt(req.params.id, 10);
    try {
      await ensureAppDemoSchema(db);
      const { rows } = await db.query(
        `SELECT m.s3_key, m.poster_s3_key FROM app_demo_screen_media m JOIN app_demo_screens s ON s.id = m.screen_id
          WHERE s.feature_id = $1`,
        [id]
      );
      await db.query(`DELETE FROM app_demo_features WHERE id = $1`, [id]);
      deleteKeys(rows);
      return respondWithTour(res);
    } catch (err) {
      return fail(res, err, "Could not delete the feature");
    }
  },

  reorderFeatures: reorderHandler("app_demo_features", "feature"),

  // ---------- Steps ----------

  // Adds one step per file.
  addScreens: async (req, res) => {
    const featureId = parseInt(req.params.id, 10);
    const files = req.files || [];
    if (!files.length) return badRequest(res, "Choose images (PNG, JPG, WebP, GIF) or a PDF.");
    try {
      await ensureAppDemoSchema(db);
      const exists = await db.query(`SELECT 1 FROM app_demo_features WHERE id = $1`, [featureId]);
      if (!exists.rowCount) {
        removeTempFiles(files);
        return notFound(res, "Feature");
      }
      for (const file of files) {
        const uploaded = await uploadMediaFile(file);
        const { rows } = await db.query(
          `INSERT INTO app_demo_screens (feature_id, label, sort_order)
           VALUES ($1, $2, (SELECT COALESCE(MAX(sort_order), 0) + 1 FROM app_demo_screens WHERE feature_id = $1))
           RETURNING id`,
          [featureId, fileTitle(file)]
        );
        await insertMedia(rows[0].id, uploaded, versionName(file));
      }
      await db.query(`UPDATE app_demo_features SET updated_at = NOW() WHERE id = $1`, [featureId]);
      return respondWithTour(res);
    } catch (err) {
      removeTempFiles(files);
      return fail(res, err, "Could not upload the screens");
    }
  },

  updateScreen: async (req, res) => {
    const id = parseInt(req.params.id, 10);
    const fields = screenFields(req.body);
    const cols = Object.keys(fields);
    if (!cols.length) return badRequest(res, "Nothing to update.");
    try {
      await ensureAppDemoSchema(db);
      const { rowCount } = await db.query(`UPDATE app_demo_screens SET ${setClause(cols)} WHERE id = $${cols.length + 1}`, [...cols.map((c) => fields[c]), id]);
      if (!rowCount) return notFound(res, "Step");
      return respondWithTour(res);
    } catch (err) {
      return fail(res, err, "Could not save the step");
    }
  },

  deleteScreen: async (req, res) => {
    const id = parseInt(req.params.id, 10);
    try {
      await ensureAppDemoSchema(db);
      const { rows } = await db.query(`SELECT s3_key, poster_s3_key FROM app_demo_screen_media WHERE screen_id = $1`, [id]);
      await db.query(`DELETE FROM app_demo_screens WHERE id = $1`, [id]);
      deleteKeys(rows);
      return respondWithTour(res);
    } catch (err) {
      return fail(res, err, "Could not delete the step");
    }
  },

  reorderScreens: reorderHandler("app_demo_screens", "step", "AND t.feature_id = $2"),

  // Moves a step, with its versions, to the end of another feature.
  moveScreen: async (req, res) => {
    const id = parseInt(req.params.id, 10);
    const featureId = parseInt(req.body && req.body.feature_id, 10);
    if (!Number.isInteger(featureId)) return badRequest(res, "Choose a feature.");
    try {
      await ensureAppDemoSchema(db);
      const target = await db.query(`SELECT 1 FROM app_demo_features WHERE id = $1`, [featureId]);
      if (!target.rowCount) return notFound(res, "Feature");
      const { rowCount } = await db.query(
        `UPDATE app_demo_screens
            SET feature_id = $1, sort_order = (SELECT COALESCE(MAX(sort_order), 0) + 1 FROM app_demo_screens WHERE feature_id = $1)
          WHERE id = $2`,
        [featureId, id]
      );
      if (!rowCount) return notFound(res, "Step");
      return respondWithTour(res);
    } catch (err) {
      return fail(res, err, "Could not move the step");
    }
  },

  // ---------- Versions of a step (e.g. Light / Dark) ----------

  addMedia: async (req, res) => {
    const screenId = parseInt(req.params.id, 10);
    const files = req.files || [];
    if (!files.length) return badRequest(res, "Choose an image (PNG, JPG, WebP, GIF) or a PDF.");
    try {
      await ensureAppDemoSchema(db);
      const exists = await db.query(`SELECT 1 FROM app_demo_screens WHERE id = $1`, [screenId]);
      if (!exists.rowCount) {
        removeTempFiles(files);
        return notFound(res, "Step");
      }
      for (const file of files) await insertMedia(screenId, await uploadMediaFile(file), versionName(file));
      return respondWithTour(res);
    } catch (err) {
      removeTempFiles(files);
      return fail(res, err, "Could not upload the version");
    }
  },

  // Renames a version and/or replaces its file.
  updateMedia: async (req, res) => {
    const id = parseInt(req.params.id, 10);
    const fields = {};
    if (has(req.body, "label")) fields.label = text(req.body.label, 30);
    try {
      await ensureAppDemoSchema(db);
      const existing = await db.query(`SELECT s3_key, poster_s3_key FROM app_demo_screen_media WHERE id = $1`, [id]);
      if (!existing.rowCount) {
        if (req.file) removeTempFiles([req.file]);
        return notFound(res, "Version");
      }
      if (req.file) Object.assign(fields, await uploadMediaFile(req.file), { poster_url: null, poster_s3_key: null });
      const cols = Object.keys(fields);
      if (!cols.length) return badRequest(res, "Nothing to update.");
      await db.query(`UPDATE app_demo_screen_media SET ${setClause(cols)} WHERE id = $${cols.length + 1}`, [...cols.map((c) => fields[c]), id]);
      if (req.file) deleteKeys(existing.rows);
      return respondWithTour(res);
    } catch (err) {
      if (req.file) removeTempFiles([req.file]);
      return fail(res, err, "Could not save the version");
    }
  },

  deleteMedia: async (req, res) => {
    const id = parseInt(req.params.id, 10);
    try {
      await ensureAppDemoSchema(db);
      const { rows } = await db.query(
        `SELECT m.s3_key, m.poster_s3_key, (SELECT COUNT(*)::int FROM app_demo_screen_media x WHERE x.screen_id = m.screen_id) AS versions
           FROM app_demo_screen_media m WHERE m.id = $1`,
        [id]
      );
      if (!rows.length) return notFound(res, "Version");
      if (rows[0].versions < 2) return badRequest(res, "A step needs at least one image. Replace it, or delete the step.");
      await db.query(`DELETE FROM app_demo_screen_media WHERE id = $1`, [id]);
      deleteKeys(rows);
      return respondWithTour(res);
    } catch (err) {
      return fail(res, err, "Could not delete the version");
    }
  },

  reorderMedia: reorderHandler("app_demo_screen_media", "version", "AND t.screen_id = $2"),

  // ---------- Interactive capture ----------

  // Admin: opens the capture window for one school (closes any other).
  startCapture: async (req, res) => {
    const organizationId = parseInt(req.body && req.body.organization_id, 10);
    if (!Number.isFinite(organizationId)) return badRequest(res, "Choose a school.");
    try {
      const exists = await db.query(`SELECT 1 FROM organizations WHERE organization_id = $1`, [organizationId]);
      if (!exists.rowCount) return notFound(res, "School");
      const window = await capture.startWindow(db, organizationId, req.session.userId);
      return res.json({ success: true, window: { schoolId: window.organization_id, school: window.organization_name, endsAt: new Date(window.ends_at).toISOString() } });
    } catch (err) {
      return fail(res, err, "Could not turn on capture");
    }
  },

  stopCapture: async (req, res) => {
    try {
      await capture.stopWindow(db);
      return res.json({ success: true });
    } catch (err) {
      return fail(res, err, "Could not turn off capture");
    }
  },

  // Capture bar: where a capture can be saved.
  captureTargets: async (req, res) => {
    try {
      const tour = await getTour(db, { includeHidden: true });
      return res.json({
        success: true,
        sections: tour.sections.map((s) => ({
          id: s.id,
          name: s.name,
          features: s.features.map((f) => ({ id: f.id, title: f.title, steps: f.screens.map((sc, i) => ({ id: sc.id, label: sc.label || `Step ${i + 1}` })) })),
        })),
      });
    } catch (err) {
      return fail(res, err, "Could not load the tour");
    }
  },

  // Capture bar: saves a capture as a new step, or as a version of a step.
  saveCapture: async (req, res) => {
    const file = req.file;
    if (!file) return badRequest(res, "The capture was empty. Please try again.");
    const featureId = parseInt(req.body.feature_id, 10);
    const screenId = parseInt(req.body.screen_id, 10);
    const stepLabel = text(req.body.step_label, 80);
    const versionLabel = text(req.body.version_label, 30) || "Interactive";
    let tempFiles = [file];
    try {
      // The capture bar uploads it gzipped (CompressionStream) where the browser can.
      let raw = await fsp.readFile(path.join(UPLOAD_DIR, path.basename(file.filename)));
      if (raw[0] === 0x1f && raw[1] === 0x8b) raw = await gunzipAsync(raw, { maxOutputLength: 120 * 1024 * 1024 });
      // The capture bar packs before uploading; an unpacked one this large comes from an old copy of the page.
      if (raw.length > UNPACK_LIMIT && raw.lastIndexOf('"pool":[') < 0) {
        removeTempFiles(tempFiles);
        return badRequest(res, "This capture is too large. Reload the page and capture it again.");
      }
      const data = parseCapture(raw.toString("utf8"));
      if (!data) {
        removeTempFiles(tempFiles);
        return badRequest(res, "The capture could not be read. Please capture the page again.");
      }
      await ensureAppDemoSchema(db);
      const feature = await db.query(`SELECT 1 FROM app_demo_features WHERE id = $1`, [featureId]);
      if (!feature.rowCount) {
        removeTempFiles(tempFiles);
        return notFound(res, "Feature");
      }
      if (Number.isFinite(screenId)) {
        const step = await db.query(`SELECT 1 FROM app_demo_screens WHERE id = $1 AND feature_id = $2`, [screenId, featureId]);
        if (!step.rowCount) {
          removeTempFiles(tempFiles);
          return notFound(res, "Step");
        }
      }

      // Stored packed and gzipped; the player gets it from compressedCapture().
      const gzName = `${path.basename(file.filename)}-gz`;
      await fsp.writeFile(path.join(UPLOAD_DIR, gzName), await gzipAsync(JSON.stringify(packCapture(data)), { level: 9 }));
      removeTempFiles([file]);
      tempFiles = [];
      const stored = await uploadToS3({ filename: gzName, mimetype: "application/json", originalname: "app-demo-capture.json", cacheControl: CACHE_CONTROL });
      const poster = await renderCapturePoster(data).catch((err) => {
        console.error("[appDemo] capture cover failed:", err.message);
        return null;
      });

      let targetScreen = Number.isFinite(screenId) ? screenId : null;
      if (!targetScreen) {
        const { rows } = await db.query(
          `INSERT INTO app_demo_screens (feature_id, label, sort_order)
           VALUES ($1, $2, (SELECT COALESCE(MAX(sort_order), 0) + 1 FROM app_demo_screens WHERE feature_id = $1))
           RETURNING id`,
          [featureId, stepLabel || text(data.title, 80) || "Interactive page"]
        );
        targetScreen = rows[0].id;
      }
      // The interactive version is shown first.
      await db.query(
        `INSERT INTO app_demo_screen_media (screen_id, label, media_type, media_url, s3_key, mime_type, media_width, media_height, poster_url, poster_s3_key, guide, accent, guided, sort_order)
         VALUES ($1, $2, 'html', $3, $4, 'application/json', $5, $6, $7, $8, $9, $10, $11,
                 (SELECT COALESCE(MIN(sort_order), 1) - 1 FROM app_demo_screen_media WHERE screen_id = $1))`,
        [targetScreen, versionLabel, stored.Location, stored.Key, data.viewport.w, data.viewport.h, poster ? poster.url : null, poster ? poster.key : null,
          JSON.stringify(cleanGuideEntries(req.body.guide, data.guide.length)), cleanAccent(req.body.accent), toFlag(req.body.guided, true)]
      );
      await db.query(`UPDATE app_demo_features SET updated_at = NOW() WHERE id = $1`, [featureId]);
      invalidateTourCache();
      return res.json({ success: true, featureId, screenId: targetScreen });
    } catch (err) {
      removeTempFiles(tempFiles);
      return fail(res, err, "Could not save the capture");
    }
  },

  // Admin: the explanations and guide accent of an interactive capture.
  updateGuide: async (req, res) => {
    const id = parseInt(req.params.id, 10);
    const steps = Array.isArray(req.body && req.body.steps) ? req.body.steps : [];
    try {
      await ensureAppDemoSchema(db);
      const { rows: captureRows } = await db.query(
        `SELECT m.s3_key FROM app_demo_screen_media m WHERE m.id = $1 AND m.media_type = 'html'`,
        [id]
      );
      if (!captureRows.length) return notFound(res, "Interactive version");
      if (!captureRows[0].s3_key) return badRequest(res, "The interactive capture file is missing.");
      const captureObject = await s3Client.send(new GetObjectCommand({ Bucket: process.env.S3_BUCKET_NAME, Key: captureRows[0].s3_key }));
      const captureBuffer = Buffer.from(await captureObject.Body.transformToByteArray());
      // Only the start of the file is needed: the guide comes before the views.
      const head = (await gunzipStart(captureBuffer, 4 * 1024 * 1024)).toString("utf8");
      const guide = cleanGuideEntries(steps, storedGuide(head).length);
      const { rowCount } = await db.query(
        `UPDATE app_demo_screen_media SET guide = $1, accent = $2, guided = $3 WHERE id = $4 AND media_type = 'html'`,
        [JSON.stringify(guide), cleanAccent(req.body && req.body.accent), toFlag(req.body && req.body.guided, true), id]
      );
      if (!rowCount) return notFound(res, "Interactive version");
      return respondWithTour(res);
    } catch (err) {
      return fail(res, err, "Could not save the guide");
    }
  },

  // Public: the sandboxed player for one interactive capture.
  playerPage: async (req, res) => {
    const id = parseInt(req.params.id, 10);
    try {
      await ensureAppDemoSchema(db);
      const { rows } = await db.query(
        `SELECT m.media_width, m.media_height, m.guide, m.accent, m.guided, m.poster_url, f.is_active, f.title FROM app_demo_screen_media m
           JOIN app_demo_screens s ON s.id = m.screen_id
           JOIN app_demo_features f ON f.id = s.feature_id
          WHERE m.id = $1 AND m.media_type = 'html'`,
        [id]
      );
      const media = rows[0];
      const isAdmin = req.session && req.session.accountType === "Admin";
      if (!media || (!media.is_active && !isAdmin)) return res.sendStatus(404);
      res.set("X-Robots-Tag", "noindex, nofollow");
      res.render("legal&Compliance/appDemoPlayer", {
        layout: false,
        title: media.title,
        dataUrl: `/legal/app-demo/media/${id}/file`,
        width: media.media_width || 1440,
        height: media.media_height || 900,
        accent: cleanAccent(media.accent),
        guided: media.guided !== false,
        poster: media.poster_url || null,
        guideIndexes: Array.isArray(media.guide) ? media.guide.map((g, i) => Number.isInteger(g && g.index) ? g.index : i) : null,
        guideTexts: Array.isArray(media.guide) ? media.guide.map((g) => String((g && g.text) || "")) : [],
      });
    } catch (err) {
      console.error("[appDemo] player failed:", err.message);
      if (!res.headersSent) res.sendStatus(404);
    }
  },
};

// For tests: the check every uploaded capture goes through.
module.exports.parseCapture = parseCapture;
