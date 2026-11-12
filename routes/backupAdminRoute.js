// Super Admin › Backups (utils/backups.js): platform super admins only, with a password confirmed
// in the last 30 minutes and an authenticator code, as for the Migration queue.
const express = require("express");
const db = require("../config/db");
const { requireSuperAdmin, requireFreshPassword } = require("../middleware/shardAdminGuard");
const { adminCodeGate } = require("../controllers/dataMigrationController");
const backups = require("../utils/backups");

const router = express.Router();
router.use(requireSuperAdmin, requireFreshPassword, adminCodeGate);
router.get("/", async (req, res) => {
  try {
    res.render("admin/backups", { title: "Backups", ...(await backups.overview(db)), messages: req.flash() });
  } catch (error) {
    req.flash("error", "Backups couldn't be read: run the database update (2026-11-30_gpa_backups.sql) first.");
    res.redirect("/admin");
  }
});
router.post("/run", async (req, res) => {
  if (!backups.enabled()) { req.flash("error", "Backups are turned off. Set BACKUPS_ENABLED=true on the server to turn them on."); return res.redirect("/admin/backups"); }
  const result = await backups.runBackup(db, { triggeredBy: req.shardActor || "Super Admin" }).catch((error) => ({ ok: false, error: error.message }));
  require("../utils/shards/registry").audit(req, "backup_run", result.name || null, { ok: result.ok, bytes: result.bytes || null });
  if (result.ok) req.flash("success", `Backed up: ${result.tables} tables, ${result.rows.toLocaleString("en-US")} rows, ${(result.bytes / 1048576).toFixed(1)} MB encrypted${result.removed ? `; ${result.removed} older than the days kept removed` : ""}.`);
  else req.flash("error", `The backup didn't finish: ${result.error}`);
  res.redirect("/admin/backups");
});
module.exports = router;
