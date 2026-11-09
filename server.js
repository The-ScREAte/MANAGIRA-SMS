const express = require("express");
const { createProxyMiddleware } = require("http-proxy-middleware");
const https = require("https");
const session = require("express-session");
const multer = require("multer");
const flash = require("connect-flash");
const path = require("path");
require("dotenv").config();
// A failed background promise or a stray error must not take the whole site down.
// Node's default is to exit with status 1, which is what the host reports as a crash.
require("./utils/processGuards").install("Server");
const { isSettingsEncryptionKeyConfigured } = require("./utils/encryption");
const publicImageUrl = require("./utils/publicImageUrl");

if (!isSettingsEncryptionKeyConfigured()) {
  console.error("[Settings encryption] SETTINGS_ENCRYPTION_KEY is missing or invalid. Integration credentials cannot be safely stored or read.");
}

const suppressCronMissedExecutionLogs = process.env.SUPPRESS_NODE_CRON_MISSED_LOGS !== "false";
if (suppressCronMissedExecutionLogs) {
  const originalWarn = console.warn.bind(console);
  console.warn = (...args) => {
    const firstMessage = typeof args[0] === "string" ? args[0] : String(args[0] || "");
    const normalized = firstMessage.toLowerCase();
    if (normalized.includes("node-cron") && normalized.includes("missed execution")) {
      return;
    }
    originalWarn(...args);
  };
}

// Dev-only TLS workaround for local machines missing CA roots.
// Set ALLOW_INSECURE_SSL=false to disable this behavior.
if (process.env.NODE_ENV !== "production" && process.env.ALLOW_INSECURE_SSL !== "false") {
  https.globalAgent.options.rejectUnauthorized = false;
}

const passport = require("passport");
const db = require("./config/db");
require("./config/passport")(passport);
require("./config/passportHub")(passport); // Hub authentication
// Scheduled jobs run here unless RUN_SCHEDULED_JOBS=false (then worker.js runs them).
if (process.env.RUN_SCHEDULED_JOBS !== "false") require("./jobs/scheduler");
if (process.env.NODE_ENV === "production" && (process.env.RUN_SCHEDULED_JOBS !== "false" || process.env.SHARD_SYNC === "on")) require("./jobs/shardSync");
require("./jobs/keepAlive"); // Start the keep-alive scheduler

const setCurrentTerm = require("./middleware/setCurrentTerm"); // Middleware to set the current term
const {
  notFound,
  globalErrorHandler,
} = require("./middleware/errorMiddleware"); // Error handling middleware
const fetchUnresolvedCount = require("./middleware/fetchUnresolvedCount");
const { memo } = require("./utils/memo");

const upload = multer();
const app = express();
// Render's proxy sits in front of the app. Trusting one hop makes req.ip the visitor's
// real address and req.protocol "https". Rate limits read utils/authRateLimit's clientIp.
app.set("trust proxy", 1);
app.disable("x-powered-by");
// Requests through the shard router carry the visitor's real host and address.
const shardRouting = require("./utils/shards/routing");
app.use(shardRouting.trustEdge);
// Shards talking to each other: signed, and needing nothing else below.
app.use("/internal/shard", require("./routes/shardInternalRoute"));
// Security headers + block form posts from other websites (see docs/SECURITY.md).
const { securityHeaders, crossSiteRequestGuard } = require("./middleware/securityMiddleware");
app.use(require("./middleware/botProbes"));
app.use(securityHeaders);
// Only a few large uploads are read into memory at the same time.
app.use(require("./middleware/uploadGate").createUploadGate());
app.use(crossSiteRequestGuard);

// Session signing key. Never fall back to a known value: without SESSION_SECRET,
// use a random key (everyone is signed out on restart, but cookies can't be forged).
const SESSION_SECRET = process.env.SESSION_SECRET || (() => {
  console.warn("[Security] SESSION_SECRET is not set. Using a random key; set it in the environment.");
  return require("crypto").randomBytes(48).toString("hex");
})();
const BASE_PORT = Number(process.env.PORT) || 4000;

const expressLayouts = require("express-ejs-layouts");
const pgSession = require("connect-pg-simple")(session);
const { withSessionCache } = require("./utils/cachedSessionStore");
const CachedPgSession = withSessionCache(pgSession);
const sessionStoreConfig = {
  pool: db,
  tableName: "user_sessions",
  // Sessions save when they change, and activity changes them every 5 minutes, so
  // active people stay signed in without a database write on every request.
  disableTouch: true,
  // Prune less aggressively to avoid competing with request traffic.
  pruneSessionInterval: Number(process.env.SESSION_PRUNE_INTERVAL_SEC || 3600),
  // Keep prune errors from crashing logs with noisy stack traces.
  errorLog: (error) => {
    const message = String(error?.message || error || "session prune failed");
    console.warn(`[SessionStore] prune warning: ${message}`);
  },
};
const setAllowedFeatures = require("./middleware/setAllowedFeatures");
const setAllowedRoles = require("./middleware/setAllowedRoles");
const setAllowedPermissions = require("./middleware/setAllowedPermissions");
const setThemeColor = require("./middleware/setThemeColor");
const setMiraStatus = require("./middleware/setMiraStatus");
const compression = require("compression");
const { createRequestLatencyMonitor } = require("./middleware/requestLatencyMonitor");
const financeController = require("./controllers/financeController");
const { commonController } = require("./controllers/commonController");
const aiDiscovery = require("./utils/aiDiscovery");
const {
  createOrganizationActivityLogMiddleware,
  ensureOrganizationActivityLogSchema,
} = require("./utils/activityLog");
const { ensureNicknameDisplaySchema } = require("./utils/nicknameDisplaySchema");
const { hydrateOrganizationSession } = require("./utils/sessionContext");
const {
  ensureOrganizationDisplayPreferencesSchema,
  getSessionDisplayPreferences,
  formatDisplayName,
  formatDisplayDate,
} = require("./utils/organizationDisplayPreferences");

// **Dynamic BASE_URL Logic**
const BASE_URL =
  process.env.NODE_ENV === "production"
    ? process.env.BASE_URL_PRODUCTION
    : process.env.BASE_URL_LOCAL;
// Force restart to reload jobs folder

app.set("db", db);

ensureOrganizationActivityLogSchema(db).catch((error) => {
  console.error("[ActivityLog] Failed to initialize schema:", error.message || error);
});

// Records that belong to one term stay with that term (positions, report settings),
// then the database rules that keep each school's records safe.
require("./utils/termRecords").ensureTermRecordsSchema(db)
  .catch((error) => {
    console.error("[termRecords] schema setup failed:", error.message);
  })
  .then(() => require("./utils/recordSafety").ensureRecordSafetySchema(db))
  .catch((error) => {
    console.error("[recordSafety] schema setup failed:", error.message);
  });
// Graduating/archiving students: reasons, history, restore and billing rules.
require("./utils/studentArchive").ensureStudentArchiveSchema(db).catch((error) => {
  console.error("[studentArchive] schema setup failed:", error.message);
});
// Obsolete (retired but kept) classes, subjects, remarks, signatures...; and
// removed staff accounts, kept with their records so they can be enabled again.
require("./utils/obsolete").ensureObsoleteSchema(db).catch((error) => {
  console.error("[obsolete] schema setup failed:", error.message);
});
require("./utils/removedUsers").ensureRemovedUsersSchema(db).catch((error) => {
  console.error("[removedUsers] schema setup failed:", error.message);
});
// How each assessment's results are recorded: a score, or the school's own choices (Yes / No ...).
require("./utils/assessmentEntry").ensureAssessmentEntrySchema(db).catch((error) => {
  console.error("[assessmentEntry] schema setup failed:", error.message);
});
require("./utils/setupChecklist").ensureSetupSchema(db).catch((error) => {
  console.error("[setupChecklist] schema setup failed:", error.message);
});
// Each school's assessment names: one id per name, reused across terms and years.
require("./utils/assessmentLibrary").ensureAssessmentLibrarySchema(db).catch((error) => {
  console.error("[assessmentLibrary] schema setup failed:", error.message);
});
// Each school's subject and term libraries (links every subject/term to them).
require("./utils/academicLibrary").ensureAcademicLibrarySchema(db).catch((error) => {
  console.error("[academicLibrary] schema setup failed:", error.message);
});
ensureNicknameDisplaySchema(db).catch((error) => {
  console.error("[NicknameDisplay] Failed to initialize schema:", error.message || error);
});

ensureOrganizationDisplayPreferencesSchema(db).catch((error) => {
  console.error("[DisplayPreferences] Failed to initialize schema:", error.message || error);
});

const SUBDOMAIN_CACHE_TTL_MS = Number(process.env.SUBDOMAIN_CACHE_TTL_MS) || 2 * 60 * 1000;
const SUBDOMAIN_NEGATIVE_CACHE_TTL_MS = Number(process.env.SUBDOMAIN_NEGATIVE_CACHE_TTL_MS) || 30 * 1000;
const SUBDOMAIN_CACHE_MAX_ENTRIES = Number(process.env.SUBDOMAIN_CACHE_MAX_ENTRIES) || 10000;
const subdomainOrgCache = new Map();

const getSubdomainCache = (cacheKey) => {
  const cached = subdomainOrgCache.get(cacheKey);
  if (!cached) {
    return null;
  }

  if (cached.expiresAt <= Date.now()) {
    subdomainOrgCache.delete(cacheKey);
    return null;
  }

  return cached;
};

const setSubdomainCache = (cacheKey, data, ttlMs) => {
  if (subdomainOrgCache.size >= SUBDOMAIN_CACHE_MAX_ENTRIES) {
    const oldestKey = subdomainOrgCache.keys().next().value;
    if (oldestKey) {
      subdomainOrgCache.delete(oldestKey);
    }
  }

  subdomainOrgCache.set(cacheKey, {
    ...data,
    expiresAt: Date.now() + ttlMs,
  });
};

const attachSchoolContext = (req, org) => {
  req.schoolDetails = org;

  if (org.is_hub_member && org.hub_id) {
    req.isHubMember = true;
    req.hubDetails = {
      hubId: org.hub_id,
      hubName: org.hub_name,
      hubNickname: org.hub_nickname,
      hubEmail: org.hub_email,
      hubPlanId: org.hub_plan_id,
      hubBrandingEnabled: org.hub_branding_enabled,
      hubFooterText: org.hub_footer_text,
      hubOnHold: org.hub_on_hold,
      hubLogo: org.hub_logo,
    };
  } else {
    req.isHubMember = false;
    req.hubDetails = null;
  }
};

const escapeXml = (value) => String(value || "")
  .replace(/&/g, "&amp;")
  .replace(/</g, "&lt;")
  .replace(/>/g, "&gt;")
  .replace(/"/g, "&quot;")
  .replace(/'/g, "&apos;");

// A plan change shows up on the website within 5 minutes.
const planHasSchoolWebsite = memo(async (planId) => {
  const { rows } = await db.query(
    `SELECT 1 FROM plan_features pf JOIN features f ON f.id = pf.feature_id
      WHERE pf.plan_id = $1 AND LOWER(TRIM(f.feature_name)) = 'school website' LIMIT 1`,
    [planId]
  );
  return rows.length > 0;
}, { ttlMs: 5 * 60 * 1000, max: 500 });

const organizationHasSchoolWebsiteFeature = async (org) => {
  const planIdToCheck = org?.is_hub_member && org?.hub_plan_id ? org.hub_plan_id : org?.plan_id;
  return planIdToCheck ? planHasSchoolWebsite(planIdToCheck) : false;
};

const renderWebsiteNotActivated = (res) => {
  return res.status(200).send(`<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Website Not Activated</title>
  <style>
    :root {
      --bg-1: #f4f7fb;
      --bg-2: #eaf1f7;
      --card-bg: #ffffff;
      --border: #d7e2ee;
      --text-main: #1f2937;
      --text-muted: #4b5563;
      --accent: #01535b;
    }

    * {
      box-sizing: border-box;
    }

    html,
    body {
      margin: 0;
      min-height: 100%;
    }

    body {
      font-family: "Segoe UI", Tahoma, Geneva, Verdana, sans-serif;
      background: linear-gradient(180deg, var(--bg-1) 0%, var(--bg-2) 100%);
      display: grid;
      place-items: center;
      padding: 24px;
      color: var(--text-main);
    }

    .notice-card {
      width: min(720px, 100%);
      background: var(--card-bg);
      border: 1px solid var(--border);
      border-radius: 16px;
      box-shadow: 0 20px 44px rgba(2, 12, 27, 0.08);
      padding: 28px 24px;
      text-align: center;
    }

    .notice-title {
      margin: 0 0 12px;
      font-size: clamp(1.25rem, 2vw, 1.55rem);
      color: var(--accent);
      line-height: 1.2;
    }

    .notice-text {
      margin: 0;
      font-size: 1rem;
      line-height: 1.6;
      color: var(--text-muted);
    }
  </style>
</head>
<body>
  <main class="notice-card" role="main" aria-live="polite">
    <h1 class="notice-title">Website Not Activated Yet</h1>
    <p class="notice-text">Oops! This school has not set up a website with Managira yet. Please reach out to the school to encourage them to activate their School Website plan.</p>
  </main>
</body>
</html>`);
};

// SEO host normalization: serve a single canonical root host.
// Keeps Google from indexing both managira.com and www.managira.com as duplicates.
app.use((req, res, next) => {
  if (process.env.NODE_ENV !== "production") return next();
  const host = String(req.hostname || "").toLowerCase();
  if (host !== "www.managira.com") return next();
  return res.redirect(301, `https://managira.com${req.originalUrl || "/"}`);
});

// ── Levenshtein distance (used for "Did you mean?" subdomain suggestions) ─────
function _levenshtein(a, b) {
  const m = a.length, n = b.length;
  const dp = Array.from({ length: m + 1 }, (_, i) =>
    Array.from({ length: n + 1 }, (_, j) => (i === 0 ? j : j === 0 ? i : 0))
  );
  for (let i = 1; i <= m; i++)
    for (let j = 1; j <= n; j++)
      dp[i][j] =
        a[i - 1] === b[j - 1]
          ? dp[i - 1][j - 1]
          : 1 + Math.min(dp[i - 1][j], dp[i][j - 1], dp[i - 1][j - 1]);
  return dp[m][n];
}

// Bots try names like mail. and cpanel. all day, so the list is loaded at most every 10 minutes.
const schoolNicknames = memo(async () => (await db.query(
  `SELECT nickname, organization_name FROM organizations
    WHERE deleted = false AND nickname IS NOT NULL AND nickname <> ''`
)).rows, { ttlMs: 10 * 60 * 1000, max: 1 });

const renderOrganizationNotFound = async (req, res, subdomain) => {
  const backToHomeUrl = (req.session && (req.session.userId || req.session.organizationId))
    ? "/common/orgDashboard"
    : "https://managira.com";

  // ── Try to suggest the closest matching school ────────────────────────────
  let suggestion = null;
  if (subdomain) {
    try {
      const typed = subdomain.toLowerCase();
      const threshold = Math.max(2, Math.floor(typed.length * 0.4));
      let bestDist = Infinity, bestRow = null;
      for (const row of await schoolNicknames("all")) {
        const name = row.nickname.toLowerCase();
        if (Math.abs(name.length - typed.length) > threshold) continue; // can't be close enough
        const d = _levenshtein(typed, name);
        if (d < bestDist) { bestDist = d; bestRow = row; }
      }
      if (bestRow && bestDist <= threshold && bestDist > 0) {
        suggestion = { nickname: bestRow.nickname, name: bestRow.organization_name };
      }
    } catch (_) { /* non-fatal — just skip suggestion */ }
  }

  const suggestionHtml = suggestion
    ? `<div class="suggestion">
        Did you mean <strong>${escapeXml(suggestion.name)}</strong>?
        <a href="https://${escapeXml(suggestion.nickname)}.managira.com/">Go to ${escapeXml(suggestion.nickname)}.managira.com →</a>
       </div>`
    : "";

  return res.status(404).send(`
    <!DOCTYPE html>
    <html lang="en">
    <head>
      <meta charset="UTF-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <title>Organization Not Found - Managira</title>
      <style>
        * { box-sizing: border-box; margin: 0; padding: 0; }
        body { font-family: "Inter", -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; background: #f8fafc; min-height: 100vh; display: flex; align-items: center; justify-content: center; text-align: center; padding: 20px; }
        .container { max-width: 480px; }
        .status-code { font-size: 5rem; font-weight: 800; color: #0f5a66; margin-bottom: 8px; line-height: 1; }
        h1 { font-size: 1.5rem; font-weight: 700; color: #1e293b; margin-bottom: 12px; }
        p { color: #64748b; font-size: 1rem; line-height: 1.6; margin-bottom: 28px; }
        .suggestion { background: #f0fdf4; border: 1px solid #bbf7d0; border-radius: 10px; padding: 14px 18px; margin-bottom: 24px; font-size: 0.95rem; color: #166534; line-height: 1.6; }
        .suggestion a { display: block; margin-top: 6px; color: #0f5a66; font-weight: 700; text-decoration: none; }
        .suggestion a:hover { text-decoration: underline; }
        .btn { display: inline-block; padding: 14px 32px; background: linear-gradient(135deg, #0f2d32, #0f5a66); color: white; text-decoration: none; border-radius: 10px; font-weight: 600; font-size: 0.95rem; transition: transform 0.2s, box-shadow 0.2s; box-shadow: 0 4px 14px rgba(15,90,102,0.25); }
        .btn:hover { transform: translateY(-2px); box-shadow: 0 6px 20px rgba(15,90,102,0.35); }
        .home-link { display: block; margin-top: 16px; color: #0f5a66; text-decoration: none; font-size: 0.9rem; font-weight: 600; }
        .home-link:hover { text-decoration: underline; }
      </style>
    </head>
    <body>
      <div class="container">
        <div class="status-code">404</div>
        <h1>Organization Not Found</h1>
        <p>The organization you're looking for doesn't exist on Managira or may have been removed.</p>
        ${suggestionHtml}
        <a class="btn" href="${backToHomeUrl}">Visit Managira Home</a>
        <a class="home-link" href="${backToHomeUrl}">← Back to Managira Home</a>
      </div>
    </body>
    </html>
  `);
};

// Reverse-proxy mira.managira.com straight through to the separate Mira
// service, before the general subdomain middleware below gets a chance to
// treat "mira" as an organization nickname lookup (it isn't one - it 404s
// as "Organization Not Found" otherwise, since Mira and school subdomains
// currently share the same wildcard *.managira.com DNS). MIRA_INTERNAL_URL
// should point wherever the Mira service actually runs - same-host sibling
// process (e.g. http://localhost:4100) or a real internal network address
// if it's deployed as a separate service.
const MIRA_INTERNAL_URL = process.env.MIRA_INTERNAL_URL || `http://localhost:${process.env.MIRA_PORT || 4100}`;
const miraProxy = createProxyMiddleware({
  target: MIRA_INTERNAL_URL,
  changeOrigin: true,
  ws: true,
  logger: console,
});
app.use((req, res, next) => {
  const host = String(req.hostname || "").toLowerCase();
  if (host === "mira.managira.com") {
    return miraProxy(req, res, next);
  }
  next();
});

// middleware for dynamic subdomains
app.use(async (req, res, next) => {
  const host = req.hostname;

  // 🛑 Skip subdomain logic locally
  if (process.env.NODE_ENV !== "production") {
    return next();
  }

  // 🛑 Skip subdomain logic for admin routes, hub routes, and specific account routes
  if (req.url.startsWith('/admin') || req.url.startsWith('/account') || req.url.startsWith('/hub')) {
    return next();
  }

  const baseDomain = "managira.com";
  let subdomain = null;
  let hubSubdomain = null;

  if (host.endsWith(baseDomain)) {
    const parts = host.split(".");

    // Check for root domain
    if (host === baseDomain || host === `www.${baseDomain}`) {
      req.isRootDomain = true;
      return next();
    }

    // Determine subdomain structure
    if (parts.length === 3 && parts[0] !== "www") {
      // Single level: org.managira.com
      subdomain = parts[0];
    } else if (parts.length === 4) {
      // Two levels: org.hub.managira.com
      subdomain = parts[0];
      hubSubdomain = parts[1];
    }
  }

  // Fetch organization and hub details
  if (subdomain) {
    try {
      const cacheKey = host.toLowerCase();
      const cached = getSubdomainCache(cacheKey);

      if (cached) {
        if (!cached.found) {
          return await renderOrganizationNotFound(req, res, subdomain);
        }

        attachSchoolContext(req, cached.org);

        if (req.hubDetails?.hubOnHold) {
          return res.status(403).send("This organization's hub is currently on hold. Please contact the hub administrator.");
        }

        return next();
      }

      let orgQuery;
      let queryParams;

      if (hubSubdomain) {
        // Two-level subdomain: org.hub.managira.com
        orgQuery = `
          SELECT o.*, mh.hub_name, mh.hub_nickname, mh.hub_email, COALESCE(o.hub_assigned_plan_id, mh.plan_id) as hub_plan_id,
                 mh.hub_branding_enabled, mh.hub_footer_text, mh.on_hold as hub_on_hold, mh.logo_path as hub_logo
          FROM organizations o
          JOIN managira_hubs mh ON o.hub_id = mh.hub_id
          WHERE o.nickname = $1 AND mh.hub_nickname = $2 AND o.is_hub_member = true AND o.deleted = false
        `;
        queryParams = [subdomain, hubSubdomain];
      } else {
        // Single-level subdomain: org.managira.com
        orgQuery = `
          SELECT o.*, 
                 CASE WHEN o.hub_id IS NOT NULL THEN mh.hub_name ELSE NULL END as hub_name,
                 CASE WHEN o.hub_id IS NOT NULL THEN mh.hub_nickname ELSE NULL END as hub_nickname,
                 CASE WHEN o.hub_id IS NOT NULL THEN mh.hub_email ELSE NULL END as hub_email,
                 CASE WHEN o.hub_id IS NOT NULL THEN COALESCE(o.hub_assigned_plan_id, mh.plan_id) ELSE NULL END as hub_plan_id,
                 CASE WHEN o.hub_id IS NOT NULL THEN mh.hub_branding_enabled ELSE false END as hub_branding_enabled,
                 CASE WHEN o.hub_id IS NOT NULL THEN mh.hub_footer_text ELSE NULL END as hub_footer_text,
                 CASE WHEN o.hub_id IS NOT NULL THEN mh.on_hold ELSE false END as hub_on_hold,
                 CASE WHEN o.hub_id IS NOT NULL THEN mh.logo_path ELSE NULL END as hub_logo
          FROM organizations o
          LEFT JOIN managira_hubs mh ON o.hub_id = mh.hub_id
          WHERE o.nickname = $1 AND o.deleted = false
        `;
        queryParams = [subdomain];
      }

      const result = await db.query(orgQuery, queryParams);

      if (result.rows.length > 0) {
        const org = result.rows[0];
        setSubdomainCache(cacheKey, { found: true, org }, SUBDOMAIN_CACHE_TTL_MS);
        attachSchoolContext(req, org);

        if (req.hubDetails?.hubOnHold) {
          return res.status(403).send("This organization's hub is currently on hold. Please contact the hub administrator.");
        }
      } else {
        setSubdomainCache(cacheKey, { found: false }, SUBDOMAIN_NEGATIVE_CACHE_TTL_MS);
        return await renderOrganizationNotFound(req, res, subdomain);
      }
    } catch (err) {
      console.error("Error fetching subdomain organization:", err);
      return res.status(500).send("Server error");
    }
  }

  next();
});

// ── Subdomain-aware robots.txt ────────────────────────────────────────────────
// For school subdomains: point to the school's own sitemap so Google knows
// exactly which URL to index for that school.
app.get("/robots.txt", (req, res, next) => {
  const host = String(req.hostname || "").toLowerCase();
  const isRootHost = host === "managira.com" || host === "www.managira.com" ||
                     host === "localhost" || host.startsWith("127.");
  if (isRootHost || !req.schoolDetails) return next(); // serve static file

  const nickname = req.schoolDetails.nickname;
  const schoolSitemap = `https://${nickname}.managira.com/sitemap.xml`;
  res.setHeader("Content-Type", "text/plain");
  res.setHeader("Cache-Control", "public, max-age=86400");
  res.send(
`User-agent: *
Allow: /
Disallow: /account/
Disallow: /admin/
Disallow: /api/
Disallow: /documents/
Disallow: /enrollment/
Disallow: /guardian/
Disallow: /hub/
Disallow: /notifications/
Disallow: /print/
Disallow: /promotion/
Disallow: /stats/
Disallow: /transcript/

Sitemap: ${schoolSitemap}
Sitemap: https://managira.com/sitemap-schools.xml`
  );
});

// ── Per-school sitemap at the subdomain level ─────────────────────────────────
// Googlebot looks for /sitemap.xml on every host it crawls. Serving a
// school-specific sitemap here makes the school page get indexed faster.
app.get("/sitemap.xml", async (req, res, next) => {
  const host = String(req.hostname || "").toLowerCase();
  const isRootHost = host === "managira.com" || host === "www.managira.com" ||
                     host === "localhost" || host.startsWith("127.");
  if (isRootHost || !req.schoolDetails) {
    // managira.com: key pages plus every published help article (utils/aiDiscovery.js).
    try {
      const xml = await aiDiscovery.rootSitemap(db);
      res.setHeader("Content-Type", "application/xml; charset=utf-8");
      res.setHeader("Cache-Control", "public, max-age=3600");
      return res.send(xml);
    } catch (err) {
      console.error("[sitemap] root sitemap failed, serving the static one:", err.message);
      return next();
    }
  }

  const nickname = req.schoolDetails.nickname;
  const today = new Date().toISOString().split("T")[0];
  const schoolUrl = `https://${escapeXml(nickname)}.managira.com/`;

  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"
        xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"
        xsi:schemaLocation="http://www.sitemaps.org/schemas/sitemap/0.9
          http://www.sitemaps.org/schemas/sitemap/0.9/sitemap.xsd">
  <url>
    <loc>${schoolUrl}</loc>
    <lastmod>${today}</lastmod>
    <changefreq>weekly</changefreq>
    <priority>1.0</priority>
  </url>
</urlset>`;

  res.setHeader("Content-Type", "application/xml");
  res.setHeader("Cache-Control", "public, max-age=3600");
  res.send(xml);
});

// ── llms.txt / llms-full.txt (managira.com only) ──────────────────────────────
// Plain-text summaries of Managira for AI assistants and answer engines, built
// from the live help center (utils/aiDiscovery.js). School subdomains don't
// serve these; their content is the school's own.
const serveAiText = (build, fallbackFile) => async (req, res, next) => {
  if (req.schoolDetails) return next();
  try {
    const text = await build(db);
    res.setHeader("Content-Type", "text/plain; charset=utf-8");
    res.setHeader("Cache-Control", "public, max-age=3600");
    res.setHeader("X-Robots-Tag", "noindex"); // for AI readers, not search results
    return res.send(text);
  } catch (err) {
    console.error(`[ai-discovery] ${req.path} failed:`, err.message);
    return fallbackFile ? res.sendFile(path.join(__dirname, "public", fallbackFile)) : next();
  }
};
app.get("/llms.txt", serveAiText(aiDiscovery.llmsTxt, "llms.txt"));
app.get("/llms-full.txt", serveAiText(aiDiscovery.llmsFullTxt));

// Enable gzip compression for faster loading
app.use(compression());
app.use(createRequestLatencyMonitor());

// These answer before express.static (which would otherwise serve the service
// worker and manifest with its one-day cache) and before the session middleware.
// Service worker — must be served with no-cache headers so the browser always
// picks up the latest version and the SW scope is correct (root of the app).
app.get("/service-worker.js", (req, res) => {
  res.setHeader("Cache-Control", "no-cache, no-store, must-revalidate");
  res.setHeader("Content-Type", "application/javascript; charset=utf-8");
  res.sendFile(path.join(__dirname, "public", "service-worker.js"));
});

// Web app manifest — explicit route ensures correct MIME type on all hosts
// (some CDNs/proxies serve .webmanifest as text/plain which breaks PWA install)
app.get("/images/favicon_io/site.webmanifest", (req, res) => {
  res.setHeader("Content-Type", "application/manifest+json; charset=utf-8");
  res.setHeader("Cache-Control", "no-cache, no-store, must-revalidate");
  res.sendFile(path.join(__dirname, "public", "images", "favicon_io", "site.webmanifest"));
});

// Health check endpoint for keep-alive pings
app.get("/health", (req, res) => {
  res.status(200).json({
    status: "ok",
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
  });
});

// Static files with long-term caching should bypass session middleware.
// A URL from assetUrl() carries the file's content hash (?v=...): it changes
// whenever the file does, so that copy can be kept for a year. Anything else,
// including hand-written ?v=2 links, keeps the one-day cache.
const { assetUrl: versionedAssetUrl } = require("./utils/assetUrl");
// The folder holds a design copy of the homepage for the local preview. On the real site it
// doesn't exist: a stale copy of a page is one nobody keeps safe.
app.use("/static", (req, res, next) => (process.env.NODE_ENV === "production" ? res.sendStatus(404) : next()));

app.use(express.static("public", {
  maxAge: '1d',
  etag: true,
  lastModified: true,
  setHeaders: (res) => {
    const req = res.req;
    const version = req && req.query && req.query.v;
    if (typeof version === "string" && version && versionedAssetUrl(req.path) === `${req.path}?v=${version}`) {
      res.setHeader("Cache-Control", "public, max-age=31536000, immutable");
    }
  },
}));

// The shared stylesheet bundle is a static file too: serve it here, before the
// session and the per-request database lookups (it used to run all of them,
// and gave first-time visitors a session just for fetching a stylesheet).
const { cssBundleUrl, serveCssBundle } = require("./utils/cssBundle");
app.get("/css/:name.css", serveCssBundle);

// Older school logos are still read from /uploads. That folder is also where every
// upload waits before it goes to S3 (documents, captures, student files), so only
// plain images are served from it: no SVG (it can carry scripts), no other files.
app.use("/uploads", (req, res, next) => {
  if (!/^\/[^/]+\.(png|jpe?g|gif|webp)$/i.test(req.path)) return res.sendStatus(404);
  return next();
}, express.static(path.join(__dirname, "uploads"), { dotfiles: "deny", index: false }));

// Managira API for third-party integrations: bearer tokens, no sessions or
// cookies, so it sits before the session middleware (see routes/publicApiRoute.js).
app.use(require("./utils/requestStats").requestStats);
app.use("/api/v1", require("./routes/publicApiRoute"));

app.use(require("./utils/cachedSessionStore").markSmallRequests);
if (process.env.NODE_ENV === "production") {
  // Production: subdomain sharing
  app.use(
    session({
      store: new CachedPgSession(sessionStoreConfig),
      secret: SESSION_SECRET,
      resave: false,
      rolling: false,
      saveUninitialized: false,
      // Render terminates HTTPS; trust its X-Forwarded-Proto so secure cookies are set.
      proxy: true,
      cookie: {
        // Session cookie only travels over HTTPS (SESSION_COOKIE_SECURE=false to turn off).
        secure: process.env.SESSION_COOKIE_SECURE !== "false",
        httpOnly: true,
        domain: (process.env.SESSION_COOKIE_DOMAIN === undefined ? ".managira.com" : process.env.SESSION_COOKIE_DOMAIN || undefined),
        sameSite: "lax",
        maxAge: 24 * 60 * 60 * 1000, // 24-hour hard ceiling (idle timeout enforces 4h inactivity limit)
      },
    })
  );
} else {
  // Localhost: no domain sharing
  app.use(
    session({
      store: new CachedPgSession(sessionStoreConfig),
      secret: SESSION_SECRET,
      resave: false,
      rolling: false,
      saveUninitialized: false,
      cookie: {
        secure: false,
        sameSite: "lax",
        maxAge: 24 * 60 * 60 * 1000, // 24-hour hard ceiling (idle timeout enforces 4h inactivity limit)
      },
    })
  );
}

// Fair-use request limit (after sessions so signed-in users count per session).
app.use(require("./middleware/securityMiddleware").requestRateLimit);

// Saving anything changes this small cookie. Pages the browser keeps for a
// minute (workspace panels; their responses Vary on Cookie) are then fetched
// fresh right after an edit, so a save always shows straight away.
app.use((req, res, next) => {
  if (req.method !== "GET" && req.method !== "HEAD" && req.session && (req.session.userId || req.session.organizationId || req.session.hubId)) {
    res.cookie("mgv", Date.now().toString(36), {
      httpOnly: true,
      sameSite: "lax",
      path: "/",
      ...(process.env.NODE_ENV === "production" ? { domain: (process.env.SESSION_COOKIE_DOMAIN === undefined ? ".managira.com" : process.env.SESSION_COOKIE_DOMAIN || undefined), secure: process.env.SESSION_COOKIE_SECURE !== "false" } : {}),
    });
  }
  next();
});


// Idle session timeout — log out users after 4 hours of real inactivity.
// Background polling paths (notifications, health) are excluded so they
// don't count as "activity" and don't reset the idle clock.
const IDLE_TIMEOUT_MS = 4 * 60 * 60 * 1000; // 4 hours
const IDLE_SKIP_PATHS = new Set([
  '/notifications/count',
  '/notifications/feed',
  '/health',
]);
const tenantSettings = require("./utils/tenantSettings");
app.use(async (req, res, next) => {
  if (!req.session || !req.session.organizationId) return next();
  if (IDLE_SKIP_PATHS.has(req.path)) return next();

  const now = Date.now();
  const lastActivity = req.session.lastActivity || now;
  // A sign-in lasts as long as its school allows (24 hours unless the school chose otherwise,
  // or its Keep me logged in time), however busy it has been. One already open starts counting now.
  // The school's rules are read once a minute per server; if they can't be read, nobody is signed out.
  if (!req.session.signedInAt) req.session.signedInAt = now;
  // Schools get it with Tenant configuration (sandbox first, then everyone once released in admin).
  let tooOld = false;
  if (require("./utils/shards/features").isOn("tenant_config", { organizationId: req.session.organizationId })) {
    try {
      const settings = await tenantSettings.settingsFor(db, req.session.organizationId);
      tooOld = now - req.session.signedInAt > tenantSettings.sessionLimitMs(settings, req.session.keepSignedIn);
    } catch (_error) {
      tooOld = false;
    }
  }

  // Someone who ticked Keep me logged in isn't timed out for a quiet spell.
  if (tooOld || now - lastActivity > require("./utils/keepSignedIn").idleLimitFor(req.session, IDLE_TIMEOUT_MS)) {
    return req.session.destroy(() => {
      if (req.xhr || (req.headers.accept || '').includes('application/json')) {
        return res.status(401).json({ error: 'Your sign-in has ended. Please log in again.' });
      }
      return res.redirect(`/account/login?reason=${tooOld ? 'expired' : 'idle'}`);
    });
  }

  // Only touch (and re-save) the session when lastActivity is meaningfully
  // stale. Writing it on every single request — including background
  // polling — makes express-session re-persist the session to the store on
  // nearly every request, which can race a concurrent logout: an in-flight
  // poll started before logout can finish saving the session back to the
  // store *after* logout deletes it, resurrecting the user's login.
  const ACTIVITY_WRITE_INTERVAL_MS = 5 * 60 * 1000; // 5 minutes
  if (now - lastActivity > ACTIVITY_WRITE_INTERVAL_MS) {
    req.session.lastActivity = now;
  }
  next();
});

// Prevent browsers (and back-forward cache) from serving a stale authenticated
// page after logout — always revalidate logged-in HTML requests so the header
// never shows a previous user's info once the session has ended.
app.use((req, res, next) => {
  if (
    req.session &&
    (req.session.userId || req.session.organizationId || req.session.studentId || req.session.guardianId || req.session.hubId) &&
    req.method === "GET" &&
    (req.headers.accept || "").includes("text/html")
  ) {
    res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate, proxy-revalidate");
    res.setHeader("Pragma", "no-cache");
  }
  next();
});

// Flash messages middleware
app.use(flash());
// A school being moved to another shard waits on a short page; everyone else is untouched.
app.use(shardRouting.pauseWhileMoving);

// Pass session and flash messages to all views
app.use((req, res, next) => {
  res.locals.session = req.session;
  res.locals.getFlash = (type) => req.flash(type);
  res.locals.BASE_URL = BASE_URL;
  res.locals.yearLabel = "";
  res.locals.currentPath = req.path || "";
  res.locals.showFooterTopSection = false;
  res.locals.unresolvedCount = 0;

  // Hide global header/footer when page is embedded inside the class dashboard workspace.
  // Sec-Fetch-Dest: iframe covers every page reached by clicking around inside
  // a workspace pane, even when the link didn't carry ?embed=workspace forward.
  if (req.query.embed === 'workspace' || String(req.get('sec-fetch-dest') || '').toLowerCase() === 'iframe') {
    res.locals.isEmbeddedFrame = true;
    res.locals.hideGlobalHeader = true;
    res.locals.hideGlobalFooter = true;
    res.locals.hideGlobalChatbot = true;
  }

  // Compact UI flags — reduced headings + compact tables on authenticated app pages.
  // Excluded: legal pages, unauthenticated/public pages, organization dashboard,
  // and printable report card / merit sheet / transcript pages.
  const p = req.path || "";
  const excludedExact = new Set([
    "/",
    "/stats/organization",
    "/account/login",
    "/account/register",
    "/account/servicePlan",
    "/account/payment",
    "/account/forgetPassword",
    "/account/guardianLogin",
    "/hub/login",
    "/hub/setupPassword",
    "/print/printStudentReport",
    "/print/meritSheetPage",
  ]);
  const excludedPrefix = [
    "/legal/",
    "/account/resetPassword",
    "/account/hubInvitation",
    "/account/acceptHubInvitation",
    "/transcript/",
  ];
  const isExcluded =
    excludedExact.has(p) ||
    excludedPrefix.some((prefix) => p === prefix || p.startsWith(prefix));
  res.locals.compactUi = !isExcluded;
  res.locals.compactTables = !isExcluded;

  const displayPreferences = getSessionDisplayPreferences(req.session || {});
  res.locals.displayPreferences = displayPreferences;
  res.locals.formatDisplayName = (person = {}) =>
    formatDisplayName(person, displayPreferences.nameDisplayFormat);
  res.locals.formatDisplayDate = (value) =>
    formatDisplayDate(value, displayPreferences.dateDisplayFormat);

  next();
});

// Passport middleware
app.use(passport.initialize());
app.use(passport.session());

app.use(async (req, res, next) => {
  try {
    await hydrateOrganizationSession(req);
  } catch (error) {
    console.error("[sessionContext] Failed to hydrate organization session:", error.message || error);
  }
  next();
});

app.use((req, res, next) => {
  const displayPreferences = getSessionDisplayPreferences(req.session || {});
  res.locals.displayPreferences = displayPreferences;
  res.locals.formatDisplayName = (person = {}) =>
    formatDisplayName(person, displayPreferences.nameDisplayFormat);
  res.locals.formatDisplayDate = (value) =>
    formatDisplayDate(value, displayPreferences.dateDisplayFormat);
  next();
});

// Set current term middleware
app.use(async (req, res, next) => {
  req.db = db; // Attach the database instance to the request object
  next();
});
app.use(require("./utils/shortCache").forgetSchoolAfterChanges);
app.use(setCurrentTerm);
// Schools in a hub show the hub's logo in their footer.
app.use(require("./utils/hubBrand").hubBrandMiddleware(db));
app.use(setAllowedFeatures);
app.use(setAllowedRoles);
app.use(setAllowedPermissions);
app.use(setThemeColor);
app.use(setMiraStatus);

// Hamburger-menu hub panels (Management/Admissions/Reports workspaces) load
// each section in an iframe tagged with ?embed=workspace. The hub keeps every
// panel it has loaded and preloads the others in the background (see the hub
// views), so switching is instant. Here the browser may keep a private copy
// but must check it every time ("no-cache"): a panel never shows data that is
// out of date (right after a save, for example), and when nothing changed the
// server answers 304 with no body (the ETag matches), so it isn't downloaded
// again. Only for signed-in GET requests; everything else keeps no-store.
app.use((req, res, next) => {
  if (req.method === "GET" && req.query && req.query.embed === "workspace" && req.session &&
      (req.session.userId || req.session.organizationId || req.session.hubId)) {
    res.setHeader("Cache-Control", "private, no-cache");
    res.removeHeader("Pragma");
    res.setHeader("Vary", "Cookie, Accept-Encoding");
  }
  next();
});

// Demo capture bar for the school an Admin opened a capture window for (utils/appDemoCapture.js).
const appDemoCapture = require("./utils/appDemoCapture");
app.use(appDemoCapture.captureLocals(db));

// Template engine setup
app.locals.assetUrl = require("./utils/assetUrl").assetUrl;
app.locals.themePalette = require("./utils/themePalette").THEME_PALETTE;
app.locals.brandColorChoices = require("./utils/themePalette").BRAND_COLOR_OPTIONS;
app.locals.footerPaletteFor = require("./utils/themePalette").footerPaletteFor;
app.locals.canSeeSetupSteps = require("./utils/setupChecklist").canSeeSetupSteps;
app.locals.navIcon = require("./utils/navIcons").navIcon;
// Stamped on changing scripts/styles (?v=) so browsers and the offline cache load new versions at once.
app.locals.assetVersion = String(process.env.RENDER_GIT_COMMIT || Date.now()).slice(0, 12);
app.locals.cssBundleUrl = cssBundleUrl;
// Phone browsers zoom the page into a form field (sign-in, search, any form)
// when it is tapped. maximum-scale=1 stops that on every browser; on iPhone and
// iPad people can still pinch to zoom. Every page reads it as
// <%= locals.viewportContent %>.
app.locals.viewportContent = "width=device-width, initial-scale=1.0, maximum-scale=1.0";
app.use(expressLayouts);
app.set("layout", "layout"); // Set default layout file
app.set("view engine", "ejs");

app.use((req, res, next) => {
  res.locals.publicImageUrl = (value, options = {}) => publicImageUrl(value, {
    ...options,
    secret: SESSION_SECRET,
    viewer: req.sessionID || "",
  });
  next();
});

app.get("/public-image", async (req, res) => {
  const key = String(req.query.key || "");
  const expires = String(req.query.expires || "");
  const signature = String(req.query.signature || "");
  const publicScope = req.query.public === "1";
  const isPublicKey = publicImageUrl.isPublicImageKey(key);
  const isPublic = isPublicKey || (publicScope && publicImageUrl.isLegacyPublicImageKey(key));
  if (
    !publicImageUrl.isRoutableImageKey(key) ||
    (publicScope && !isPublic) ||
    !publicImageUrl.verifyPublicImageSignature(
      key,
      expires,
      signature,
      SESSION_SECRET,
      isPublic ? "" : req.sessionID || "",
      publicScope ? "public" : ""
    )
  ) {
    return res.sendStatus(404);
  }

  const session = req.session || {};
  const isAuthenticated = Boolean(
    req.user ||
    session.userId ||
    session.user?.user_id ||
    session.organizationId ||
    session.guardianId ||
    session.studentId ||
    session.hubId ||
    session.hubUserId ||
    session.adminId ||
    session.adminUserId ||
    session.admin
  );
  if (!isPublic && !isAuthenticated) return res.sendStatus(404);
  if (!process.env.S3_BUCKET_NAME) {
    console.error("[Public image] S3_BUCKET_NAME is not configured.");
    return res.sendStatus(503);
  }

  try {
    const { s3Client, GetObjectCommand } = require("./config/s3");
    const object = await s3Client.send(
      new GetObjectCommand({ Bucket: process.env.S3_BUCKET_NAME, Key: key })
    );
    if (!object.Body) return res.sendStatus(404);
    if (Number(object.ContentLength) > 20 * 1024 * 1024) {
      object.Body.destroy();
      return res.sendStatus(413);
    }

    res.set({
      "Content-Type": publicImageUrl.imageContentType(key),
      "Content-Disposition": "inline",
      "X-Content-Type-Options": "nosniff",
      "Cache-Control": `${isPublic ? "public" : "private"}, max-age=${Math.max(300, Math.min(3600, Number(expires) - Math.floor(Date.now() / 1000)))}`,
    });
    if (!isPublic) res.set("Vary", "Cookie");
    object.Body.once("error", (error) => {
      console.error("[Public image] S3 stream failed:", error.name || "stream error");
      if (!res.headersSent) res.status(502).end("Image could not be loaded.");
      else res.destroy();
    });
    // A phone showing a small round photo shouldn't download a 2 MB picture. Only these sizes,
    // so nobody can make the server produce endless versions.
    const width = [128, 256, 512].includes(Number(req.query.w)) ? Number(req.query.w) : null;
    if (width && /^image\/(jpeg|png|webp)$/i.test(publicImageUrl.imageContentType(key) || "")) {
      const smaller = require("sharp")({ failOn: "none" }).rotate().resize({ width, withoutEnlargement: true }).webp({ quality: 80 });
      smaller.once("error", (error) => {
        console.error("[Public image] couldn't make a smaller copy:", error.message);
        if (!res.headersSent) res.status(502).end("Image could not be loaded.");
        else res.destroy();
      });
      res.set("Content-Type", "image/webp");
      return object.Body.pipe(smaller).pipe(res);
    }
    return object.Body.pipe(res);
  } catch (error) {
    if (error.name === "NoSuchKey" || error.name === "NotFound" || error.$metadata?.httpStatusCode === 404) {
      return res.sendStatus(404);
    }
    console.error("[Public image] S3 retrieval failed:", error.name || "S3 error");
    return res.sendStatus(502);
  }
});

// Short-link redirects (see utils/shortLink.js) — keeps SMS message bodies
// from having long S3 URLs inlined, which would burn extra SMS segments.
app.get("/r/:code", async (req, res) => {
  try {
    const { resolveShortLink } = require("./utils/shortLink");
    const target = await resolveShortLink(db, req.params.code);
    if (!target) return res.status(404).send("This link has expired or doesn't exist.");
    return res.redirect(302, target);
  } catch (error) {
    return res.status(500).send("Unable to open this link right now.");
  }
});

// Dynamic favicon for subdomains: root domain keeps default favicon,
// school subdomains use school logo so search engines can show school branding.
app.get("/favicon.ico", (req, res, next) => {
  try {
    const host = String(req.hostname || "").toLowerCase();
    const isRootHost = host === "managira.com" || host === "www.managira.com" || host === "localhost" || host === "127.0.0.1";

    if (isRootHost) {
      return next();
    }

    const schoolLogo = req.schoolDetails?.logo || req.schoolDetails?.logo_path;
    if (!schoolLogo) {
      return next();
    }

    const rawLogo = String(schoolLogo).trim();
    let logoUrl = rawLogo;

    logoUrl = publicImageUrl(rawLogo, { secret: SESSION_SECRET });

    res.setHeader("Cache-Control", "public, max-age=300");
    return res.redirect(302, logoUrl);
  } catch (error) {
    return next();
  }
});

app.post(
  "/account/settings/finance/webhooks/stripe",
  express.raw({ type: "application/json" }),
  (req, res) => financeController.financeStripeWebhookPost(req, res, db)
);

// 10mb (Express default is 100kb) - Mira's internal API forwards an
// already-attached chat image (base64, up to ~5MB raw -> ~6.7MB encoded)
// straight through as a JSON body when publishing it to the school
// website (upload_website_image); the default limit would 413 before the
// request ever reached that route.
const bigJson = express.json({ limit: "10mb" });
const smallJson = express.json({ limit: "1mb" });
const bigForm = express.urlencoded({ extended: true, limit: "10mb", parameterLimit: 100000 });
const smallForm = express.urlencoded({ extended: true, limit: "1mb", parameterLimit: 2000 });
// Sessions get keys like returnTo and flash messages before anyone signs in, so
// this looks for the fields each kind of sign-in sets.
const isSignedIn = (session) => Boolean(session && (session.userId || session.user || session.guardianId
  || session.studentId || session.hubId || session.hubUserId || (session.organizationId && session.accountType)));
// Signed-in work and Mira's internal API can be large. Anyone else, bots included,
// can't make the server parse a huge request.
const allowsBigBody = (req) => req.path.startsWith("/internal/api")
  || isSignedIn(req.session);
app.use((req, res, next) => (allowsBigBody(req) ? bigJson : smallJson)(req, res, next));
// parameterLimit raised from the qs/Express default of 1000 - large schools submit
// forms with per-student, per-subject fields (e.g. promotion scheduling), which
// blow past 1000 total fields and crash body-parsing with an unhandled 500 before
// the request ever reaches a route handler.
app.use((req, res, next) => (allowsBigBody(req) ? bigForm : smallForm)(req, res, next));

// Light or dark, for whoever is signed in (staff, school owner, parent, student,
// driver, hub owner or hub user). Kept per person.
app.post("/appearance", (req, res) => require("./controllers/themeController").updateAppearancePost(req, res));
app.use(createOrganizationActivityLogMiddleware(db));

// Only admin pages need unresolved help-thread notifications.
app.use("/admin", fetchUnresolvedCount);

const landingPages = require("./utils/landing");
app.use((req, res, next) => {
  res.locals.req = req;
  res.locals.url = req.originalUrl;
  // Signed-out pages get the public site's header and footer once new_landing is on.
  res.locals.lp = landingPages;
  res.locals.newPublicLook = landingPages.isNewLook();
  next();
});

// Routes
const accountRoute = require("./routes/accountRoute");
const financeRoute = require("./routes/financeRoute");
const payoutRoute = require("./routes/payoutRoute");
const adminRoute = require("./routes/adminRoute")(db);
const commonRoute = require("./routes/commonRoute")(db);
const printRoute = require("./routes/printRoute")(db);
const legalRoute = require("./routes/legalRoute");
const enrollmentRoutes = require("./routes/enrollmentRoutes")(db);
const transcriptRoutes = require("./routes/transcriptRoute");
const statsRoutes = require("./routes/statsRoutes");
const promotionRoute = require("./routes/promotionRoute");
const chatbotRoute = require("./routes/chatbotRoute");
const guardianRoute = require("./routes/guardianRoute")(db);
const studentRoute = require("./routes/studentRoute")(db);
const documentRoute = require("./routes/documentRoute")(db);
const transportationRoute = require("./routes/transportationRoute")(db);
const driverRoute = require("./routes/driverRoute")(db);
const internalApiRoute = require("./routes/internalApiRoute");
const announcementRoute = require("./routes/announcementRoute")(db);
const announcementController = require("./controllers/announcementController");

// Debug middleware for admin routes in production
if (process.env.NODE_ENV === "production") {
  app.use("/admin", (req, res, next) => {
    // ...removed log for clean background operation...
    next();
  });
}

// Ads beside the sign-in form on every sign-in page (views/partials/loginAdsPanel.ejs).
{
  const { SIGN_IN_PAGES, getActiveLoginAds, adFileUrl } = require("./utils/loginAds");
  app.use(async (req, res, next) => {
    if (req.method === "GET" && SIGN_IN_PAGES.has(req.path)) {
      const ads = await getActiveLoginAds(db);
      res.locals.loginAds = ads.map((ad) => ({ ...ad, file_url: adFileUrl(ad) }));
    }
    next();
  });
}

// Use routes
app.use("/account/settings", financeRoute);
app.use("/account/settings", payoutRoute);
const ssoRoutes = require("./routes/ssoRoute")(db);
app.use("/account/sso", ssoRoutes.signIn);
app.use("/account/settings/sso", ssoRoutes.settings);
app.use("/account", accountRoute);
app.use("/admin/shards", require("./routes/shardAdminRoute"));
app.use("/admin", adminRoute);
// Private calendar subscription feed (Google Calendar / Outlook / Apple fetch it without a login).
app.get("/calendar/ics/:token([a-f0-9]{48}).ics", (req, res) =>
  require("./controllers/workspaceController").icsFeed(req, res, db)
);
// The same for parents and students: their own school calendar, read only.
app.get("/calendar/family/:token([a-f0-9]{48}).ics", (req, res) =>
  require("./controllers/familyCalendarController").ics(req, res, db)
);
app.use("/common", commonRoute);
// Service accounts, access tokens and client secrets (school admin screens).
app.use("/api-access", require("./routes/apiAccessRoute"));
app.use("/announcements", announcementRoute);
// Canonical end-user feed path per spec; alias of GET /announcements/me.
app.get("/me/announcements", announcementController.getMyAnnouncements);

// The hint under phone fields (public/js/phoneField.js): how a typed number
// will be dialled for texts and WhatsApp, using the school's country.
const { describePhone } = require("./utils/phoneNumber");
app.get("/phone-check", async (req, res) => {
  res.set("Cache-Control", "no-store");
  const number = String(req.query.n || "").slice(0, 40);
  let country = res.locals.schoolCountry || req.schoolDetails?.organization_country || "";
  if (!country && /^[A-Za-z]{2}$/.test(String(req.query.country || ""))) country = String(req.query.country);
  // No country known and no country code typed: say nothing rather than guess.
  if (!country && !/^\s*(\+|00)/.test(number)) return res.json({ valid: null });
  return res.json(describePhone(number, country));
});
// In-app ad card receipts (seen / dismiss / click) - see announcementFeed.js.
app.post("/me/ads/:id(\\d+)/:action(seen|dismiss|click)", require("./controllers/loginAdsController").recordViewerEvent);
app.use("/print", printRoute);
// Service-to-service only (shared-token gated) - consumed by the separate
// Mira AI service, never reachable from a browser session.
app.use("/internal/api", internalApiRoute);
app.use("/legal", legalRoute);
// Saving interactive page captures to the product tour (utils/appDemoCapture.js).
{
  const appDemoController = require("./controllers/appDemoController");
  const captureUpload = multer({ dest: "uploads/", limits: { fileSize: 40 * 1024 * 1024, files: 1 } });
  const captureFile = (req, res, next) => captureUpload.single("capture")(req, res, (err) => {
    if (!err) return next();
    const message = err.code === "LIMIT_FILE_SIZE" ? "This page is too large to capture (over 40 MB)." : "Upload failed.";
    return res.status(400).json({ success: false, message });
  });
  app.get("/app-demo-capture/status", appDemoCapture.captureStatus(db));
  const captureSaveSession = appDemoCapture.requireCaptureSession(db, { allowExpired: true });
  app.get("/app-demo-capture/targets", captureSaveSession, appDemoController.captureTargets);
  app.post("/app-demo-capture/save", captureSaveSession, captureFile, appDemoController.saveCapture);
}
// Disabled: School Directory page is hidden for now, so the /directory alias is commented out too.
// Short-URL alias so the path Google has been trying (/directory) resolves with a 301 to the canonical page.
// app.get("/directory", (req, res) => res.redirect(301, "/legal/directory"));
app.use("/enrollment", enrollmentRoutes);
app.use("/transcript", transcriptRoutes(db));
app.use("/stats", statsRoutes);
app.use("/promotion", promotionRoute);
app.use("/api/chatbot", chatbotRoute);
app.use("/guardian", guardianRoute);
app.use("/student", studentRoute);
app.use("/documents", documentRoute);
// Who sees each feature is known before the first request, so nothing starts in the wrong state.
require("./utils/shards/features").keepFresh();
app.use("/transportation", transportationRoute);
app.use("/driver", driverRoute);
app.use("/hub", require("./routes/hubRoute")); // Hub routes

app.get("/school-index.json", async (req, res, next) => {
  if (!req.schoolDetails) return next();

  try {
    const canonicalUrl = `https://${req.schoolDetails.nickname}.managira.com/`;
    const hasWebsiteFeature = await organizationHasSchoolWebsiteFeature(req.schoolDetails);

    res.setHeader("Cache-Control", "public, max-age=300");
    return res.json({
      ok: true,
      indexable: hasWebsiteFeature,
      status: hasWebsiteFeature ? 200 : 403,
      school: req.schoolDetails.organization_name || req.schoolDetails.nickname,
      nickname: req.schoolDetails.nickname,
      canonicalUrl,
      sitemap: `${canonicalUrl}sitemap.xml`,
      robots: `${canonicalUrl}robots.txt`,
    });
  } catch (error) {
    return res.status(500).json({ ok: false, error: "Unable to check school indexing status." });
  }
});

// Notification bell: count badge for all authenticated pages

// Notifications API (bell feed, mark-read)
const notificationsRoute = require("./routes/notificationsRoute");
app.use("/notifications", notificationsRoute);

// Admin feedback requests and announcements for signed-in school users
app.use("/notices", require("./routes/noticesRoute"));

// Only list a school's subdomain in the sitemap if its plan actually has the
// "School Website" feature active — otherwise the public URL just renders a
// generic "Website Not Activated Yet" placeholder (see checkFeatureAccess.js).
// Submitting thousands of near-identical placeholder pages to Google is worse
// than not listing them at all: it reads as thin/duplicate content at scale,
// which hurts how the whole domain (including schools that DO have a real
// site) gets crawled and ranked. This mirrors checkFeatureAccess.js's own
// feature-gate lookup for the /common/publicDashboard route exactly, rather
// than hardcoding a specific feature id/name that could drift out of sync.
const fetchSitemapOrganizations = async () => {
  const result = await db.query(
    `SELECT o.organization_id, o.nickname, o.updated_at
       FROM organizations o
       LEFT JOIN managira_hubs mh ON o.hub_id = mh.hub_id
      WHERE o.deleted = false
        AND o.nickname IS NOT NULL
        AND o.nickname <> ''
        -- Test schools ("(TEST)" in the name, or "test" as a word of the address) aren't listed for search engines.
        AND o.organization_name !~* '\\(test\\)'
        AND o.nickname !~* '(^|-)test(-|$)'
        AND COALESCE(mh.on_hold, false) = false
        AND (
          NOT EXISTS (
            SELECT 1 FROM feature_routes fr
            WHERE fr.route_path = '/common/publicDashboard'
          )
          OR EXISTS (
            SELECT 1 FROM feature_routes fr
            JOIN plan_features pf ON pf.feature_id = fr.feature_id
            WHERE fr.route_path = '/common/publicDashboard'
              AND pf.plan_id = (
                CASE
                  WHEN o.is_hub_member AND COALESCE(o.hub_assigned_plan_id, mh.plan_id) IS NOT NULL THEN COALESCE(o.hub_assigned_plan_id, mh.plan_id)
                  ELSE o.plan_id
                END
              )
          )
        )
      ORDER BY o.organization_name ASC
      LIMIT 5000`
  );
  return result.rows;
};

// Sitemap index for school subdomain sitemaps. This is an extra discovery layer
// that helps crawlers find each school sitemap quickly.
app.get("/sitemap-schools-index.xml", async (req, res) => {
  try {
    const organizations = await fetchSitemapOrganizations();
    const today = new Date().toISOString().split("T")[0];

    const sitemapEntries = organizations.map((org) => {
      const lastmod = org.updated_at
        ? new Date(org.updated_at).toISOString().split("T")[0]
        : today;

      return `  <sitemap>\n    <loc>https://${escapeXml(org.nickname)}.managira.com/sitemap.xml</loc>\n    <lastmod>${lastmod}</lastmod>\n  </sitemap>`;
    });

    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${sitemapEntries.join("\n")}
</sitemapindex>`;

    res.setHeader("Content-Type", "application/xml");
    res.setHeader("Cache-Control", "public, max-age=300");
    res.send(xml);
  } catch (err) {
    console.error("[sitemap-schools-index] Error generating school sitemap index:", err.message);
    res.status(500).send("<?xml version=\"1.0\" encoding=\"UTF-8\"?><sitemapindex xmlns=\"http://www.sitemaps.org/schemas/sitemap/0.9\"></sitemapindex>");
  }
});

// Dynamic sitemap for all school public pages
app.get("/sitemap-schools.xml", async (req, res) => {
  try {
    const organizations = await fetchSitemapOrganizations();

    const today = new Date().toISOString().split("T")[0];
    const urls = organizations.map((org) => {
      const lastmod = org.updated_at
        ? new Date(org.updated_at).toISOString().split("T")[0]
        : today;
      return `  <url>
    <loc>https://${escapeXml(org.nickname)}.managira.com/</loc>
    <lastmod>${lastmod}</lastmod>
    <changefreq>weekly</changefreq>
    <priority>0.7</priority>
  </url>`;
    });

    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${urls.join("\n")}
</urlset>`;

    res.setHeader("Content-Type", "application/xml");
    res.setHeader("Cache-Control", "public, max-age=300");
    res.send(xml);
  } catch (err) {
    console.error("[sitemap-schools] Error generating school sitemap:", err.message);
    res.status(500).send("<?xml version=\"1.0\" encoding=\"UTF-8\"?><urlset xmlns=\"http://www.sitemaps.org/schemas/sitemap/0.9\"></urlset>");
  }
});

// Price range of the active plans (monthly base price per school, all
// regions), for the homepage's structured data. Cached for an hour.
let homePricingCache = { at: 0, value: null };
async function getHomePricing() {
  if (Date.now() - homePricingCache.at < 60 * 60 * 1000) return homePricingCache.value;
  let value = null;
  try {
    const { rows } = await db.query(
      `SELECT MIN(x.base_price_usd)::numeric(10,2) AS low, MAX(x.base_price_usd)::numeric(10,2) AS high, COUNT(DISTINCT p.id)::int AS plans
         FROM plan_region_prices x
         JOIN plans p ON p.id = x.plan_id
         JOIN pricing_regions r ON r.id = x.region_id
        WHERE x.is_active AND p.is_active AND r.is_active AND x.base_price_usd > 0`
    );
    const row = rows[0];
    if (row && row.low && row.high) value = { lowPrice: String(row.low), highPrice: String(row.high), offerCount: row.plans };
  } catch (err) {
    console.error("[home] pricing for structured data failed:", err.message);
  }
  homePricingCache = { at: Date.now(), value };
  return value;
}

// Home route
app.get("/", async (req, res) => {
  const isProduction = process.env.NODE_ENV === "production";
  const isRenderDomain = req.hostname && req.hostname.endsWith(".onrender.com");
  const homeSeo = {
    title: "Managira | K-12 Student Information System",
    description:
      "Managira is the cloud student information system for K-12 schools and districts: one secure record for every student, connected classrooms, engaged families and Mira, a built-in AI assistant.",
    keywords:
      "school management system, school management software, management system for schools, student information system, school ERP, school portal, enrollment management, class management, attendance tracking, assessment management, school billing, school reports, education management software, Managira",
    canonicalUrl: "https://managira.com/",
    showFooterTopSection: true,
    homePricing: null,
  };

  // ...removed log for clean background operation...

  // An already-logged-in org user landing on the bare root domain (typed it
  // directly, reopened the tab with the session still alive, or - in dev -
  // just running on localhost) wants their dashboard, not the public
  // marketing homepage - send them straight there instead of making them
  // click through the marketing page first. Deliberately excludes an
  // actual school subdomain (Case 2 below, req.schoolDetails set) - a
  // logged-in admin visiting their own school's public subdomain is
  // previewing the public site, not asking to be bounced to their
  // dashboard, so that case is left untouched.
  const isSchoolSubdomain = isProduction && !!req.schoolDetails;
  if (!isSchoolSubdomain && req.session && (req.session.organizationId || req.session.userId)) {
    return res.redirect("/common/orgDashboard");
  }

  if (!req.schoolDetails) homeSeo.homePricing = await getHomePricing();
  // The new homepage: everywhere in development; in production once released in admin (new_landing).
  const homeView = require("./utils/landing").isNewLook() ? "home/landing" : "index";
  const homeLocals = homeView === "index" ? homeSeo : { ...homeSeo, layout: false, lp: require("./utils/landing") };

  // ✅ Case 1: Production root domain (e.g. managira.com or www)
  if (isProduction && req.isRootDomain) {
    return res.render(homeView, homeLocals);
  }

  // ✅ Case 2: Production subdomain (e.g. myschool.managira.com)
  if (isProduction && req.schoolDetails) {
    const hasWebsiteFeature = await organizationHasSchoolWebsiteFeature(req.schoolDetails);
    if (!hasWebsiteFeature) {
      return renderWebsiteNotActivated(res);
    }

    try {
      const {
        ensureExternalSchoolWebsiteSchema,
        normalizeExternalSchoolWebsiteUrl,
      } = require("./utils/externalSchoolWebsite");
      await ensureExternalSchoolWebsiteSchema(db);
      const { rows } = await db.query(
        "SELECT external_website_url FROM organizations WHERE organization_id = $1",
        [req.schoolDetails.organization_id]
      );
      const { url } = normalizeExternalSchoolWebsiteUrl(rows[0]?.external_website_url);
      if (url) return res.redirect(302, url);
    } catch (error) {
      console.error("[PublicWebsite] External website lookup failed:", error);
      return res.status(503).send("The school website is temporarily unavailable.");
    }

    req.organizationId = req.schoolDetails.organization_id;
    return commonController.publicDashboardContent(req, res, db);
  }

  // ✅ Case 3: Render default domain for web service
  if (isProduction && isRenderDomain) {
    return res.render(homeView, homeLocals);
  }

  // ✅ Case 4: Development (localhost) — just render landing
  if (!isProduction) {
  // ...removed log for clean background operation...
    return res.render(homeView, { ...homeLocals, title: "Managira | All-in-One School Management Software [DEV]" });
  }

  // 🛑 Fallback
  return res.status(404).send("Page not found");
});

// Handle 404 errors
app.use(notFound);

// Global error handler for other errors
app.use(globalErrorHandler);


// Scheduled holds + on-hold reminders now run with the other jobs (jobs/scheduler.js).

const { ensurePermissionsSchema } = require('./middleware/permissionMiddleware');

const logServerHostInfo = (port) => {
  const env = String(process.env.NODE_ENV || 'development');
  const host = process.env.HOST || 'localhost';
  console.log(`[Server] Running on http://${host}:${port} (${env})`);
};

const logStartupDbStatus = async () => {
  try {
    // Open the pool's standing connections now, so the first visitors don't
    // wait for them.
    const warmConnections = Math.max(1, Number(db.options && db.options.min) || 1);
    await Promise.all(Array.from({ length: warmConnections }, () => db.query('SELECT 1')));
    // Pre-warm the permissions schema DDL once at startup so the Promise
    // singleton is already settled before any HTTP request arrives.
    // This prevents the double-log caused by two concurrent first callers.
    await ensurePermissionsSchema(db);
    // Rejected online applications are kept (with a status) for 60 days.
    await require("./utils/admissionRejections").ensureAdmissionStatusSchema(db);
    // Product tour captures ready before the first visitor asks for one.
    setTimeout(() => require("./controllers/appDemoController").warmCaptures(), 5000).unref();
    // Idempotent: adds the 'Driver' user_role enum value if it isn't there yet.
    await db.query(`ALTER TYPE user_role ADD VALUE IF NOT EXISTS 'Driver'`);
  } catch (error) {
    console.error(
      `[DB] ⚠️ Startup database check failed (${error.code || 'NO_CODE'}): ${error.message}. Verify DB_CONNECTION_STRING uses the full Render DB URL and DB_SSL matches Internal(false)/External(true).`
    );
  }
};

// Start the server on the configured port only.
const startServer = (port) => {
  const server = app.listen(port, () => {
    logServerHostInfo(port);
    logStartupDbStatus();
  });

  server.on("error", (error) => {
    if (error.code === "EADDRINUSE") {
      console.error(`[Server] Port ${port} is already in use. Stop the other process and restart.`);
      process.exit(1);
    }

    console.error("[Server] Failed to start:", error);
    process.exit(1);
  });

  // Release the DB connection pool on shutdown so restarts (nodemon, deploys,
  // crashes) don't leak connections toward the DB instance's connection limit.
  let shuttingDown = false;
  const shutdown = (signal) => {
    if (shuttingDown) return;
    shuttingDown = true;
    console.log(`[Server] Received ${signal}, shutting down gracefully...`);

    // Idle keep-alive connections would otherwise hold this open until the timeout.
    if (typeof server.closeIdleConnections === "function") server.closeIdleConnections();
    server.close(() => {
      db.end()
        .then(() => console.log("[Server] DB pool closed. Exiting."))
        .catch((err) => console.error("[Server] Error closing DB pool:", err.message || err))
        .finally(() => process.exit(0));
    });

    setTimeout(() => {
      // Asked to stop and stopping is not a crash: the host counts status 1 as one.
      console.warn("[Server] Requests still open after 20 seconds; stopping anyway.");
      process.exit(0);
    }, 20000).unref();
  };

  process.on("SIGTERM", () => shutdown("SIGTERM"));
  process.on("SIGINT", () => shutdown("SIGINT"));
};

// Mira runs as its own Express app/port, but on a single-service deploy
// (one Render web service, `npm start` running only this file) nothing
// else ever starts it - production's plain `node server.js` never runs
// Mira on its own. Starting it here, in-process, right after the main app
// comes up, makes it work the same way in production without needing a
// second Render service.
//
// Skipped in development: `npm run dev` already starts Mira as its own
// separate process via concurrently (see package.json's dev:mira script)
// so it can be nodemon-watched independently - co-starting it here too
// would just fight that process for port 4100 (EADDRINUSE). Set
// MIRA_STANDALONE_SERVICE=true to also skip this in production, for the
// same reason, if Mira is ever deployed as its own separate service there
// instead of co-located with the main app.
const shouldCoStartMira =
  process.env.NODE_ENV === "production" &&
  String(process.env.MIRA_STANDALONE_SERVICE || "").toLowerCase() !== "true";
if (shouldCoStartMira) {
  try {
    require("./mira/server").start().catch((error) => {
      console.error("[Mira] Failed to start alongside the main app:", error);
    });
  } catch (error) {
    console.error("[Mira] Failed to load:", error);
  }
}

require("./utils/memoryRelief").install();

startServer(BASE_PORT);