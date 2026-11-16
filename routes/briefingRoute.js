// The weekly briefing's settings (utils/weeklyBriefing.js): the school's page in Management Tools
// and each class's tab on the class dashboard, both for managers and supervisors, and a preview
// of the email a family or student would get this week (never sent).
const express = require("express");
const db = require("../config/db");
const { isAuthenticated } = require("../middleware/middleware");
const { isEmbeddedRequest } = require("../utils/embeddedMode");
const { isOn } = require("../utils/shards/features");
const briefing = require("../utils/weeklyBriefing");

const router = express.Router();
const FULL_ROLES = new Set(["organization", "admin", "mini admin", "manager", "supervisor", "superviser"]);
const roleOf = (req) => String(req.session?.userRole || req.session?.user?.account_type || req.session?.accountType || "").trim().toLowerCase();

// Managers and supervisors, where the school has the weekly briefing (mirrored in workspaceAccess).
function allowed(req, res, next) {
  const organizationId = Number(req.session?.organizationId);
  if (!organizationId || !FULL_ROLES.has(roleOf(req)) || !isOn("weekly_briefing", { organizationId })) {
    if (req.method === "GET" && !req.xhr) {
      req.flash("error", "You don't have access to the weekly briefing.");
      return res.redirect("/common/orgDashboard");
    }
    return res.status(403).json({ success: false, message: "You can't change the weekly briefing." });
  }
  req.organizationId = organizationId;
  return next();
}

const actorOf = (req) => {
  const user = req.session?.user || {};
  const name = [user.first_name, user.last_name].filter(Boolean).join(" ").trim() || String(req.session?.organizationName || "");
  return { id: Number(user.user_id || req.session?.userId) || null, name };
};

async function classOf(organizationId, classId) {
  const { rows } = await db.query(
    "SELECT class_id, class_name FROM classes WHERE organization_id = $1 AND class_id = $2",
    [organizationId, classId]
  );
  return rows[0] ? { id: Number(rows[0].class_id), name: rows[0].class_name || "" } : null;
}

async function classList(organizationId) {
  const { rows } = await db.query(
    "SELECT class_id, class_name FROM classes WHERE organization_id = $1 ORDER BY LOWER(class_name), class_id",
    [organizationId]
  );
  return rows.map((row) => ({ id: Number(row.class_id), name: row.class_name || "" }));
}

function renderPage(req, res, view) {
  const isEmbedded = isEmbeddedRequest(req, view.classRoom ? "briefingClass" : "briefing");
  res.set("Cache-Control", "no-store");
  return res.render("common/weeklyBriefing", {
    title: "Weekly briefing",
    isEmbedded,
    hideGlobalHeader: isEmbedded,
    hideGlobalFooter: isEmbedded,
    hideGlobalChatbot: isEmbedded,
    sections: briefing.SECTIONS,
    days: briefing.DAYS,
    timeZones: briefing.TIME_ZONES,
    hourLabel: briefing.hourLabel,
    messages: req.flash(),
    ...view,
  });
}

router.get("/", isAuthenticated, allowed, async (req, res) => {
  try {
    const all = await briefing.settingsFor(db, req.organizationId, { fresh: true });
    const classes = await classList(req.organizationId);
    return renderPage(req, res, {
      classRoom: null,
      settings: all.school,
      schedule: all.schedule,
      savedBy: all.savedBy,
      ownClasses: classes.filter((item) => all.classes.has(item.id)),
      classes,
      students: [],
      action: "/common/briefing",
    });
  } catch (error) {
    console.error("[Weekly briefing] settings page:", error.message);
    return res.status(500).send("The weekly briefing settings could not be loaded. Please try again.");
  }
});

router.post("/", isAuthenticated, allowed, async (req, res) => {
  try {
    await briefing.saveSchoolSettings(db, req.organizationId, req.body || {}, actorOf(req));
    req.flash("success", "Saved. The next briefing uses these choices.");
  } catch (error) {
    console.error("[Weekly briefing] save:", error.message);
    req.flash("error", "Your changes weren't saved. Please try again.");
  }
  return res.redirect(`/common/briefing${req.query.embed ? "?embed=workspace" : ""}`);
});

router.get("/class/:classId(\\d+)", isAuthenticated, allowed, async (req, res) => {
  try {
    const classRoom = await classOf(req.organizationId, Number(req.params.classId));
    if (!classRoom) return res.status(404).send("That class wasn't found.");
    const all = await briefing.settingsFor(db, req.organizationId, { fresh: true });
    const own = all.classes.get(classRoom.id) || null;
    const students = await briefing.currentStudents(db, req.organizationId, { classId: classRoom.id });
    return renderPage(req, res, {
      classRoom,
      own: Boolean(own),
      settings: own || all.school,
      schoolSettings: all.school,
      schedule: all.schedule,
      savedBy: own ? own.savedBy : null,
      classes: [],
      ownClasses: [],
      students: students.map((student) => ({ id: student.id, name: `${student.firstName} ${student.lastName}`.trim() })),
      action: `/common/briefing/class/${classRoom.id}`,
    });
  } catch (error) {
    console.error("[Weekly briefing] class page:", error.message);
    return res.status(500).send("The weekly briefing settings could not be loaded. Please try again.");
  }
});

router.post("/class/:classId(\\d+)", isAuthenticated, allowed, async (req, res) => {
  const classId = Number(req.params.classId);
  try {
    const classRoom = await classOf(req.organizationId, classId);
    if (!classRoom) return res.status(404).send("That class wasn't found.");
    const saved = await briefing.saveClassSettings(db, req.organizationId, classRoom.id, req.body || {}, actorOf(req));
    req.flash("success", saved ? `Saved. ${classRoom.name} uses its own choices.` : `Saved. ${classRoom.name} uses the school's choices.`);
  } catch (error) {
    console.error("[Weekly briefing] class save:", error.message);
    req.flash("error", "Your changes weren't saved. Please try again.");
  }
  return res.redirect(`/common/briefing/class/${classId}${req.query.embed ? "?embed=workspace" : ""}`);
});

// A class's current students, for the school page's preview picker.
router.get("/students", isAuthenticated, allowed, async (req, res) => {
  const classId = Number.parseInt(req.query.classId, 10);
  if (!classId) return res.json({ students: [] });
  const students = await briefing.currentStudents(db, req.organizationId, { classId }).catch(() => []);
  return res.json({ students: students.map((student) => ({ id: student.id, name: `${student.firstName} ${student.lastName}`.trim() })) });
});

router.get("/preview", isAuthenticated, allowed, async (req, res) => {
  const audience = req.query.audience === "students" ? "students" : "parents";
  try {
    const result = await briefing.preview(db, req.organizationId, { studentId: Number(req.query.studentId), audience });
    res.set("Cache-Control", "no-store");
    res.set("X-Robots-Tag", "noindex");
    if (!result) return res.status(404).send("That student wasn't found.");
    const name = `${result.student.firstName} ${result.student.lastName}`.trim();
    const who = audience === "students" ? name : (result.parentEmail ? `${name}'s family` : `${name}'s family (no parent email on file)`);
    const kind = audience === "students" ? "student" : "family";
    const note = result.off
      ? `This class has the ${kind} briefing turned off, so nothing is sent.${result.empty ? "" : " Below is what it would include."}`
      : result.empty
        ? `Nothing to report for ${name} this week, so no email would be sent.`
        : `Preview of what ${who} would get this week. Nothing is sent.`;
    const bar = `<div style="position:sticky;top:0;z-index:5;background:#0f172a;color:#f8fafc;font:14px/1.5 -apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Arial,sans-serif;padding:10px 16px;text-align:center;">${note.replace(/&/g, "&amp;").replace(/</g, "&lt;")}${result.subject ? `<br><span style="color:#94a3b8;">Subject: ${String(result.subject).replace(/&/g, "&amp;").replace(/</g, "&lt;")}</span>` : ""}</div>`;
    if (!result.html) {
      return res.send(`<!DOCTYPE html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Weekly briefing preview</title></head><body style="margin:0;background:#f3f4f6;">${bar}</body></html>`);
    }
    return res.send(result.html.replace(/<body([^>]*)>/i, (match) => `${match}${bar}`));
  } catch (error) {
    console.error("[Weekly briefing] preview:", error.message);
    return res.status(500).send("The preview could not be made. Please try again.");
  }
});

module.exports = router;
