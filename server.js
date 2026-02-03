const express = require("express");
const session = require("express-session");
const multer = require("multer");
const flash = require("connect-flash");
const path = require("path");
require("dotenv").config();
const passport = require("passport");
const db = require("./config/db");
require("./config/passport")(passport);
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
const PORT = process.env.PORT || 4000;

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

  // 🛑 Skip subdomain logic for admin routes and specific account routes only
  if (req.url.startsWith('/admin') || req.url.startsWith('/account')) {
    return next();
  }

  const baseDomain = "managira.com";
  let subdomain = null;

  if (host.endsWith(baseDomain)) {
    const parts = host.split(".");

    if (parts.length > 2 && parts[0] !== "www") {
      subdomain = parts[0]; // e.g. myschool.managira.com
    }

    if (host === baseDomain || host === `www.${baseDomain}`) {
      req.isRootDomain = true;
    }
  }

  if (subdomain) {
    try {
      const result = await db.query(
        "SELECT * FROM organizations WHERE nickname = $1",
        [subdomain]
      );

      if (result.rows.length > 0) {
        req.schoolDetails = result.rows[0];
      } else {
        return res.status(404).send("School not found");
      }
    } catch (err) {
      console.error("Error fetching subdomain school:", err);
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

  // ✅ Case 3: Development (localhost) — just render landing
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

// Start the server
app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});