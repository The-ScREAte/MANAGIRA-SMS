"use strict";

// The alerts a person sets for themselves (feature alert_rules, utils/alertRules.js). One small
// JSON API for every kind of person; each signs in through their own door, so this works out who is
// asking from the session and never takes an id from the request.
const express = require("express");
const alertRules = require("../utils/alertRules");
const { sessionActor } = require("../middleware/permissionMiddleware");

module.exports = (db) => {
  const router = express.Router();

  async function personOf(req) {
    const s = req.session || {};
    const organizationId = Number(s.organizationId);
    if (!organizationId) return null;
    if (s.userRole === "Guardian" && s.guardianId) return { organizationId, type: "guardian", audience: "guardian", id: Number(s.guardianId) };
    if (s.userRole === "Student" && s.studentId) return { organizationId, type: "student", audience: "student", id: Number(s.studentId) };
    // Staff of a school: never the school's own account (its session carries the school's id as
    // the user id) or Managira's own roles. The account type is read from the person's own row.
    const userId = Number(sessionActor(req).userId);
    if (!userId || sessionActor(req).accountType === "Organization") return null;
    const { rows } = await db.query("SELECT account_type::text AS role FROM users WHERE user_id = $1 AND organization_id = $2 AND COALESCE(on_hold, FALSE) = FALSE AND removed_at IS NULL", [userId, organizationId]);
    const role = rows[0] && rows[0].role;
    if (!["Teacher", "Driver", "Manager", "Supervisor"].includes(role)) return null;
    return { organizationId, type: "staff", audience: alertRules.audienceOf(role), id: userId };
  }

  router.use(async (req, res, next) => {
    try {
      const person = await personOf(req);
      if (!person) return res.status(401).json({ success: false, message: "Sign in to set your alerts." });
      if (!alertRules.featureOn(person.organizationId)) return res.json({ success: true, off: true, alerts: [] });
      req.alertPerson = person;
      return next();
    } catch (error) {
      return next(error);
    }
  });

  // A parent's child page asks for that child's own alerts: only their own children.
  async function childOf(req) {
    const person = req.alertPerson;
    const raw = req.query.studentId || (req.body && req.body.studentId);
    if (person.audience !== "guardian" || !raw) return 0;
    const studentId = Number(raw);
    if (!Number.isInteger(studentId) || studentId <= 0) return -1;
    const { rows } = await db.query(
      `SELECT 1 FROM guardian_students gs JOIN students s ON s.student_id = gs.student_id AND s.organization_id = $3
        WHERE gs.guardian_id = $1 AND gs.student_id = $2`,
      [person.id, studentId, person.organizationId]
    );
    return rows.length ? studentId : -1;
  }

  router.get("/data", async (req, res) => {
    try {
      const { type, id, audience, organizationId } = req.alertPerson;
      const studentId = await childOf(req);
      if (studentId < 0) return res.status(404).json({ success: false, message: "That child isn't on your account." });
      const settings = await alertRules.settingsFor(db, organizationId, { type, id, audience }, studentId);
      return res.json({ success: true, audience, ...settings });
    } catch (error) {
      console.error("[Alerts] data:", error.message);
      return res.status(500).json({ success: false, message: "Could not load your alerts. Try again." });
    }
  });

  router.post("/save", express.json({ limit: "20kb" }), async (req, res) => {
    try {
      const { type, id, audience, organizationId } = req.alertPerson;
      const studentId = await childOf(req);
      if (studentId < 0) return res.status(404).json({ success: false, message: "That child isn't on your account." });
      await alertRules.saveRules(db, organizationId, { type, id, audience }, req.body, studentId);
      const settings = await alertRules.settingsFor(db, organizationId, { type, id, audience }, studentId);
      return res.json({ success: true, message: "Your alerts are saved.", audience, ...settings });
    } catch (error) {
      console.error("[Alerts] save:", error.message);
      return res.status(500).json({ success: false, message: "Could not save your alerts. Try again." });
    }
  });

  return router;
};
