const express = require("express");
const session = require("express-session");
const multer = require("multer");
const flash = require("connect-flash");
const path = require("path");
require("dotenv").config();
const passport = require("passport");
const db = require("./config/db");
require("./config/passport")(passport);
require("./config/passportHub")(passport); // Hub authentication
require("./utils/promotionJob");
require("./jobs/scheduler"); // Start the billing scheduler
require("./jobs/keepAlive"); // Start the keep-alive scheduler
const cron = require("node-cron");
const applyScheduledHolds = require("./utils/applyScheduledHolds");

const setCurrentTerm = require("./middleware/setCurrentTerm"); // Middleware to set the current term
const {
  notFound,
  globalErrorHandler,
} = require("./middleware/errorMiddleware"); // Error handling middleware
const fetchUnresolvedCount = require("./middleware/fetchUnresolvedCount");

const upload = multer();
const app = express();
const BASE_PORT = Number(process.env.PORT) || 4000;
const IS_DEVELOPMENT = process.env.NODE_ENV !== "production";
const MAX_PORT_RETRIES = Number(process.env.PORT_RETRY_LIMIT) || 10;

const expressLayouts = require("express-ejs-layouts");
const pgSession = require("connect-pg-simple")(session);
const setAllowedFeatures = require("./middleware/setAllowedFeatures");
const setAllowedRoles = require("./middleware/setAllowedRoles");
const setThemeColor = require("./middleware/setThemeColor");
const compression = require("compression");
const { setCacheHeaders, preloadCache } = require("./middleware/cacheMiddleware");
const { createRequestLatencyMonitor } = require("./middleware/requestLatencyMonitor");

// **Dynamic BASE_URL Logic**
const BASE_URL =
  process.env.NODE_ENV === "production"
    ? process.env.BASE_URL_PRODUCTION
    : process.env.BASE_URL_LOCAL;
// Force restart to reload jobs folder

app.set("db", db);

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

const renderOrganizationNotFound = (req, res) => {
  const backToHomeUrl = (req.session && (req.session.userId || req.session.organizationId))
    ? "/common/orgDashboard"
    : "https://managira.com";

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
        <a class="btn" href="https://managira.com/legal/directory">Browse All Organizations</a>
        <a class="home-link" href="${backToHomeUrl}">← Back to Managira Home</a>
      </div>
    </body>
    </html>
  `);
};

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
          return renderOrganizationNotFound(req, res);
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
          SELECT o.*, mh.hub_name, mh.hub_nickname, mh.hub_email, mh.plan_id as hub_plan_id,
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
                 CASE WHEN o.hub_id IS NOT NULL THEN mh.plan_id ELSE NULL END as hub_plan_id,
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
        return renderOrganizationNotFound(req, res);
      }
    } catch (err) {
      console.error("Error fetching subdomain organization:", err);
      return res.status(500).send("Server error");
    }
  }

  next();
});

// Enable gzip compression for faster loading
app.use(compression());
app.use(createRequestLatencyMonitor());

// Static files with long-term caching should bypass session middleware.
app.use(express.static("public", {
  maxAge: '1d',
  etag: true,
  lastModified: true
}));

// Middleware to serve static files from the uploads directory with caching
app.use("/uploads", express.static(path.join(__dirname, "uploads")));

if (process.env.NODE_ENV === "production") {
  // Production: subdomain sharing
  app.use(
    session({
      store: new pgSession({ pool: db, tableName: "user_sessions" }),
      secret: process.env.SESSION_SECRET || "YourSecret",
      resave: false,
      saveUninitialized: false,
      cookie: {
        secure: false,
        domain: ".managira.com",
        sameSite: "lax",
        maxAge: 18000000,
      },
    })
  );
} else {
  // Localhost: no domain sharing
  app.use(
    session({
      store: new pgSession({ pool: db, tableName: "user_sessions" }),
      secret: process.env.SESSION_SECRET || "YourSecret",
      resave: false,
      saveUninitialized: false,
      cookie: {
        secure: false,
        maxAge: 18000000,
      },
    })
  );
}


// Flash messages middleware
app.use(flash());

// Pass session and flash messages to all views
app.use((req, res, next) => {
  res.locals.session = req.session;
  res.locals.getFlash = (type) => req.flash(type);
  res.locals.BASE_URL = BASE_URL;
  res.locals.showFooterTopSection = false;
  res.locals.unresolvedCount = 0;
  next();
});

// Passport middleware
app.use(passport.initialize());
app.use(passport.session());

// Set current term middleware
app.use(async (req, res, next) => {
  req.db = db; // Attach the database instance to the request object
  next();
});
app.use(setCurrentTerm);
app.use(setAllowedFeatures);
app.use(setAllowedRoles);
app.use(setThemeColor);
app.use(preloadCache);

// Template engine setup
app.use(expressLayouts);
app.set("layout", "layout"); // Set default layout file
app.set("view engine", "ejs");

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

    if (!/^https?:\/\//i.test(rawLogo)) {
      if (process.env.S3_BUCKET_NAME && process.env.AWS_REGION) {
        logoUrl = `https://${process.env.S3_BUCKET_NAME}.s3.${process.env.AWS_REGION}.amazonaws.com/${rawLogo}`;
      } else {
        logoUrl = `/${rawLogo.replace(/^\/+/, "")}`;
      }
    }

    return res.redirect(302, logoUrl);
  } catch (error) {
    return next();
  }
});

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Only admin pages need unresolved help-thread notifications.
app.use("/admin", fetchUnresolvedCount);

app.use((req, res, next) => {
  res.locals.req = req;
  res.locals.url = req.originalUrl;
  next();
});

// Routes
const accountRoute = require("./routes/accountRoute");
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
const documentRoute = require("./routes/documentRoute")(db);

// Debug middleware for admin routes in production
if (process.env.NODE_ENV === "production") {
  app.use("/admin", (req, res, next) => {
    // ...removed log for clean background operation...
    next();
  });
}

// Use routes
app.use("/account", accountRoute);
app.use("/admin", adminRoute);
app.use("/common", commonRoute);
app.use("/print", printRoute);
app.use("/legal", legalRoute);
app.use("/enrollment", enrollmentRoutes);
app.use("/transcript", transcriptRoutes(db));
app.use("/stats", statsRoutes);
app.use("/promotion", promotionRoute);
app.use("/api/chatbot", chatbotRoute);
app.use("/guardian", guardianRoute);
app.use("/documents", documentRoute);
app.use("/hub", require("./routes/hubRoute")); // Hub routes

// Health check endpoint for keep-alive pings
app.get("/health", (req, res) => {
  res.status(200).json({
    status: "ok",
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
  });
});

// Dynamic sitemap for all school public pages
app.get("/sitemap-schools.xml", async (req, res) => {
  try {
    const result = await db.query(
      `SELECT organization_id, nickname, updated_at
       FROM organizations
       WHERE deleted = false
         AND nickname IS NOT NULL
         AND nickname <> ''
       ORDER BY organization_name ASC
       LIMIT 5000`
    );

    const today = new Date().toISOString().split("T")[0];
    const urls = result.rows.map((org) => {
      const lastmod = org.updated_at
        ? new Date(org.updated_at).toISOString().split("T")[0]
        : today;
      return `  <url>
    <loc>https://${org.nickname}.managira.com/</loc>
    <lastmod>${lastmod}</lastmod>
    <changefreq>weekly</changefreq>
    <priority>0.7</priority>
  </url>`;
    });

    const directoryUrlEntry = `  <url>
    <loc>https://www.managira.com/legal/directory</loc>
    <lastmod>${today}</lastmod>
    <changefreq>daily</changefreq>
    <priority>0.9</priority>
  </url>`;

    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${directoryUrlEntry}
${urls.join("\n")}
</urlset>`;

    res.setHeader("Content-Type", "application/xml");
    res.setHeader("Cache-Control", "public, max-age=3600");
    res.send(xml);
  } catch (err) {
    console.error("[sitemap-schools] Error generating school sitemap:", err.message);
    res.status(500).send("<?xml version=\"1.0\" encoding=\"UTF-8\"?><urlset xmlns=\"http://www.sitemaps.org/schemas/sitemap/0.9\"></urlset>");
  }
});

app.get("/test-flash", (req, res) => {
  req.flash("success", "Test flash successful!");
  res.redirect("/account/login");
});

// Home route
// Directory shortcut route for SEO (/directory -> /legal/directory)
app.get("/directory", (req, res) => res.redirect(301, "/legal/directory"));
app.get("/", async (req, res) => {
  const isProduction = process.env.NODE_ENV === "production";
  const isRenderDomain = req.hostname && req.hostname.endsWith(".onrender.com");
  const homeSeo = {
    title: "Managira | All-in-One School Management Platform",
    description:
      "Manage enrollment, classes, attendance, assessments, communication, billing, analytics, and reporting in one school platform.",
    keywords:
      "school management system, school management software, management system for schools, student information system, school ERP, school portal, enrollment management, class management, attendance tracking, assessment management, school billing, school reports, education management software, Managira",
    canonicalUrl: "https://www.managira.com/",
    showFooterTopSection: true,
  };

  // ...removed log for clean background operation...

  // ✅ Case 1: Production root domain (e.g. managira.com or www)
  if (isProduction && req.isRootDomain) {
  // ...removed log for clean background operation...
    return res.render("index", homeSeo);
  }

  // ✅ Case 2: Production subdomain (e.g. myschool.managira.com)
  if (isProduction && req.schoolDetails) {
  // ...removed log for clean background operation...
    return res.redirect(301, "/common/publicDashboard");
  }

  // ✅ Case 3: Render default domain for web service
  if (isProduction && isRenderDomain) {
    return res.render("index", homeSeo);
  }

  // ✅ Case 4: Development (localhost) — just render landing
  if (!isProduction) {
  // ...removed log for clean background operation...
    return res.render("index", {
      ...homeSeo,
      title: "Managira | All-in-One School Management Platform [DEV]",
    });
  }

  // 🛑 Fallback
  return res.status(404).send("Page not found");
});

// Handle 404 errors
app.use(notFound);

// Global error handler for other errors
app.use(globalErrorHandler);

// Global error handler for all unhandled errors
app.use((err, req, res, next) => {
  console.error('Global error handler:', err);
  res.status(500).send('Something went wrong!');
});

cron.schedule("0 0 * * *", async () => {
  await applyScheduledHolds();
});

const { ensurePermissionsSchema } = require('./middleware/permissionMiddleware');

const logStartupDbStatus = async () => {
  try {
    await db.query('SELECT 1');
    console.log('[DB] ✅ Startup database check passed');
    // Pre-warm the permissions schema DDL once at startup so the Promise
    // singleton is already settled before any HTTP request arrives.
    // This prevents the double-log caused by two concurrent first callers.
    await ensurePermissionsSchema(db);
  } catch (error) {
    console.error(
      `[DB] ⚠️ Startup database check failed (${error.code || 'NO_CODE'}): ${error.message}. Verify DB_CONNECTION_STRING uses the full Render DB URL and DB_SSL matches Internal(false)/External(true).`
    );
  }
};

// Start the server with dev fallback when the default port is busy
const startServer = (port, attempt = 0) => {
  const server = app.listen(port, () => {
    console.log(`Server running on http://localhost:${port}`);
    if (port !== BASE_PORT) {
      console.log(`[Server] Base port ${BASE_PORT} was busy, using ${port}`);
    }
    logStartupDbStatus();
  });

  server.on("error", (error) => {
    if (
      error.code === "EADDRINUSE" &&
      IS_DEVELOPMENT &&
      attempt < MAX_PORT_RETRIES
    ) {
      const nextPort = port + 1;
      console.warn(
        `[Server] Port ${port} is already in use. Retrying on port ${nextPort}...`
      );
      setTimeout(() => startServer(nextPort, attempt + 1), 150);
      return;
    }

    console.error("[Server] Failed to start:", error);
    process.exit(1);
  });
};

startServer(BASE_PORT);