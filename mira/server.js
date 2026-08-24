const path = require("path");
require("dotenv").config({ path: path.resolve(__dirname, "../.env") });
const express = require("express");
const expressLayouts = require("express-ejs-layouts");

const { ssoAuth, pageAuth } = require("./middleware/ssoAuth");
const { tenantScope } = require("./middleware/tenantScope");
const { requireMiraActivated } = require("./middleware/requireMiraActivated");

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

// No auth - used by the deploy platform / uptime checks. `providers` is
// boolean-only (never keys/values) - just enough to diagnose "which LLM
// providers does this deployment actually have configured" without needing
// dashboard access to the host's env vars.
app.get("/health", (req, res) => {
  const { PROVIDER_PRIORITY, MOCK_MODE } = require("./services/modelRouter");
  const providers = {
    openrouter: !!process.env.OPENROUTER_API_KEY,
    telnyx: !!process.env.TELNYX_API_KEY,
    openai: !!process.env.OPENAI_API_KEY,
    anthropic: !!process.env.ANTHROPIC_API_KEY,
  };
  res.json({ status: "ok", service: "mira", time: new Date().toISOString(), mockMode: MOCK_MODE, providerPriority: PROVIDER_PRIORITY, providers });
});

// Mira's own login/continue/logout - deliberately unauthenticated (that's
// the point) and mounted before any auth gate. See routes/authRoute.js.
app.use(require("./routes/authRoute"));

// The main page: browser navigation, so an auth failure means a redirect
// to /login, not a raw JSON 401.
app.get("/", pageAuth, tenantScope, requireMiraActivated, (req, res) => {
  res.render("index", {
    title: "Mira",
    tenant: req.tenant,
    mainAppUrl: MAIN_APP_PUBLIC_URL,
  });
});

// JSON APIs: fetch()/SSE callers need a machine-readable 401, not a redirect.
app.use("/api/chat", ssoAuth, tenantScope, requireMiraActivated, require("./routes/chatRoute"));
app.use("/api/classes", ssoAuth, tenantScope, requireMiraActivated, require("./routes/classesRoute"));
app.use("/api/upload", ssoAuth, tenantScope, requireMiraActivated, require("./routes/uploadRoute"));
app.use("/api/preferences", ssoAuth, tenantScope, requireMiraActivated, require("./routes/preferencesRoute"));

app.use((req, res) => {
  res.status(404).json({ error: "Not found." });
});

app.use((err, req, res, next) => {
  console.error("[mira] unhandled error", err);
  res.status(500).json({ error: "Something went wrong." });
});

// Run schema setup once at boot, not lazily on whichever request happens to
// hit it first. ensureMiraSchema does ~15 DDL statements (tables, indexes,
// the pgvector extension/HNSW index) - against a remote, non-colocated
// Postgres each round trip has real latency, and doing this on a random
// user's first click added ~1.7s to that one request.
//
// Exported as start() (not just run inline behind require.main === module)
// so a single-process production deploy can start Mira as a second listener
// inside the SAME Node process as the main app, instead of needing it run
// as its own separate OS process/service - see server.js's own startServer,
// which calls this after its own app.listen().
// Throws on failure rather than exiting the process itself - the caller
// decides what that means. Standalone (below), that's fatal, same as
// before. Co-started from the main app's server.js, it isn't: Mira just
// won't be available, but the main app (and everything unrelated to Mira)
// keeps running rather than going down because of a Mira-only problem.
async function start() {
  const db = require("./config/db");
  const { ensureMiraSchema } = require("./db/schema");

  await ensureMiraSchema(db);

  return new Promise((resolve, reject) => {
    const server = app.listen(PORT, () => {
      console.log(`[Mira] Running on http://localhost:${PORT}`);
      resolve(server);
    });
    server.on("error", reject);
  });
}

if (require.main === module) {
  start().catch((error) => {
    console.error("[Mira] Failed to start, exiting:", error);
    process.exit(1);
  });
}

module.exports = app;
module.exports.start = start;
