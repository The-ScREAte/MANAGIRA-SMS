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

// **Dynamic BASE_URL Logic**
const BASE_URL =
  process.env.NODE_ENV === "production"
    ? process.env.BASE_URL_PRODUCTION
    : process.env.BASE_URL_LOCAL;
// Force restart to reload jobs folder

app.set("db", db);

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
        req.schoolDetails = org;
        
        // Set hub context if organization is a hub member
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
            hubLogo: org.hub_logo
          };

          // Check if hub is on hold
          if (org.hub_on_hold) {
            return res.status(403).send("This organization's hub is currently on hold. Please contact the hub administrator.");
          }
        } else {
          req.isHubMember = false;
          req.hubDetails = null;
        }
      } else {
        return res.status(404).send("Organization not found");
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

// Static files with long-term caching
app.use(express.static("public", {
  maxAge: '1d',
  etag: true,
  lastModified: true
}));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Apply fetchUnresolvedCount middleware globally
app.use(fetchUnresolvedCount);

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

app.get("/test-flash", (req, res) => {
  req.flash("success", "Test flash successful!");
  res.redirect("/account/login");
});

// Home route
app.get("/", async (req, res) => {
  const isProduction = process.env.NODE_ENV === "production";
  const isRenderDomain = req.hostname && req.hostname.endsWith(".onrender.com");

  // ...removed log for clean background operation...

  // ✅ Case 1: Production root domain (e.g. managira.com or www)
  if (isProduction && req.isRootDomain) {
  // ...removed log for clean background operation...
    return res.render("index", {
      title: "Welcome to Managira",
      showFooterTopSection: true,
    });
  }

  // ✅ Case 2: Production subdomain (e.g. myschool.managira.com)
  if (isProduction && req.schoolDetails) {
  // ...removed log for clean background operation...
    return res.redirect("/common/publicDashboard");
  }

  // ✅ Case 3: Render default domain for web service
  if (isProduction && isRenderDomain) {
    return res.render("index", {
      title: "Welcome to Managira",
      showFooterTopSection: true,
    });
  }

  // ✅ Case 4: Development (localhost) — just render landing
  if (!isProduction) {
  // ...removed log for clean background operation...
    return res.render("index", {
      title: "Welcome to Managira [DEV]",
      showFooterTopSection: true,
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

const logStartupDbStatus = async () => {
  try {
    await db.query('SELECT 1');
    console.log('[DB] ✅ Startup database check passed');
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