const path = require("path");
require("dotenv").config({ path: path.resolve(__dirname, "../.env") });
const express = require("express");
const expressLayouts = require("express-ejs-layouts");

const { ssoAuth, pageAuth } = require("./middleware/ssoAuth");
const { tenantScope } = require("./middleware/tenantScope");

const app = express();
const PORT = Number(process.env.MIRA_PORT) || 4100;
// The browser-facing URL of the main app (for links like Logout) - not to
// be confused with MAIN_APP_INTERNAL_BASE_URL, which internalApiClient.js
// uses for server-to-server calls and may differ (e.g. an internal
// hostname in production vs. the public one).
const MAIN_APP_PUBLIC_URL = process.env.MAIN_APP_PUBLIC_URL || process.env.MAIN_APP_INTERNAL_BASE_URL || "http://localhost:4000";

app.set("views", path.join(__dirname, "views"));
app.set("view engine", "ejs");
app.use(expressLayouts);
app.set("layout", "layout");

// Default 100kb is too small for a chat message carrying a base64 image
// data URL (a 5MB upload inflates to ~6.7MB base64) - raised to cover
// that with headroom. File uploads themselves go through multer's own
// memory storage (routes/uploadRoute.js), not this parser.
app.use(express.json({ limit: "10mb" }));
app.use(express.static(path.join(__dirname, "public")));

// No auth - used by the deploy platform / uptime checks.
app.get("/health", (req, res) => {
  res.json({ status: "ok", service: "mira", time: new Date().toISOString() });
});

// Mira's own login/continue/logout - deliberately unauthenticated (that's
// the point) and mounted before any auth gate. See routes/authRoute.js.
app.use(require("./routes/authRoute"));

// The main page: browser navigation, so an auth failure means a redirect
// to /login, not a raw JSON 401.
app.get("/", pageAuth, tenantScope, (req, res) => {
  res.render("index", {
    title: "Mira",
    tenant: req.tenant,
    mainAppUrl: MAIN_APP_PUBLIC_URL,
  });
});

// JSON APIs: fetch()/SSE callers need a machine-readable 401, not a redirect.
app.use("/api/chat", ssoAuth, tenantScope, require("./routes/chatRoute"));
app.use("/api/classes", ssoAuth, tenantScope, require("./routes/classesRoute"));
app.use("/api/upload", ssoAuth, tenantScope, require("./routes/uploadRoute"));

app.use((req, res) => {
  res.status(404).json({ error: "Not found." });
});

app.use((err, req, res, next) => {
  console.error("[mira] unhandled error", err);
  res.status(500).json({ error: "Something went wrong." });
});

if (require.main === module) {
  // Run schema setup once at boot, not lazily on whichever request happens
  // to hit it first. ensureMiraSchema does ~15 DDL statements (tables,
  // indexes, the pgvector extension/HNSW index) - against a remote,
  // non-colocated Postgres each round trip has real latency, and doing
  // this on a random user's first click added ~1.7s to that one request.
  const db = require("./config/db");
  const { ensureMiraSchema } = require("./db/schema");

  ensureMiraSchema(db)
    .then(() => {
      app.listen(PORT, () => {
        console.log(`[Mira] Running on http://localhost:${PORT}`);
      });
    })
    .catch((error) => {
      console.error("[Mira] Failed to initialize database schema, exiting:", error);
      process.exit(1);
    });
}

module.exports = app;
