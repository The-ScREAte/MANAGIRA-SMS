require("dotenv").config();
const express = require("express");
const path = require("path");
const expressLayouts = require("express-ejs-layouts");

const { ssoAuth } = require("./middleware/ssoAuth");
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

app.use(express.json());
app.use(express.static(path.join(__dirname, "public")));

// No auth - used by the deploy platform / uptime checks.
app.get("/health", (req, res) => {
  res.json({ status: "ok", service: "mira", time: new Date().toISOString() });
});

// Everything past this point requires a valid Managira session.
app.use(ssoAuth, tenantScope);

app.get("/", (req, res) => {
  res.render("index", {
    title: "Mira",
    tenant: req.tenant,
    mainAppUrl: MAIN_APP_PUBLIC_URL,
  });
});

app.use("/api/chat", require("./routes/chatRoute"));
app.use("/api/classes", require("./routes/classesRoute"));

app.use((req, res) => {
  res.status(404).json({ error: "Not found." });
});

app.use((err, req, res, next) => {
  console.error("[mira] unhandled error", err);
  res.status(500).json({ error: "Something went wrong." });
});

if (require.main === module) {
  app.listen(PORT, () => {
    console.log(`[Mira] Running on http://localhost:${PORT}`);
  });
}

module.exports = app;
