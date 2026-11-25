"use strict";

// Which of Managira's two daily services a school uses: Attendance and Lunch (Management, Class & notif.
// settings). Both are on until a school turns one off, for schools that keep attendance somewhere else.
// Read from the school's tenant settings (cached a minute, dropped on save), so asking is cheap. A
// database without the columns yet, or a school without a row, answers "both on".
//   services(db, orgId) -> { attendance, lunch, name, icons }
// name is what the class's daily page is called: "Attendance & lunch", "Lunch", "Attendance", or "" when neither.
// icons are the navIcon names to draw before it: ["attendance", "lunch"], one of them, or [].
//
// A class has its own Take attendance and Take lunch switches (utils/classSettings.js). What a class really takes is the
// school's choice AND the class's, and that is the only answer anything should use for a class, a student or their family:
//   classServices(db, orgId, classId)        -> { attendance, lunch, name, icons }
//   classServicesFor(db, orgId, classIds)    -> Map(classId -> the same)
//   studentServicesFor(db, orgId, studentIds) -> Map(studentId -> the same), by the class each student is in now
// Stored attendance and lunch are never deleted; they just stop showing while the class doesn't take them.
const tenantSettings = require("./tenantSettings");

function nameFor(attendance, lunch) {
  if (attendance && lunch) return "Attendance & lunch";
  if (lunch) return "Lunch";
  if (attendance) return "Attendance";
  return "";
}

// The icons that go before the name (names for utils/navIcons.js), in the order the name reads.
const iconsFor = (attendance, lunch) => [attendance ? "attendance" : null, lunch ? "lunch" : null].filter(Boolean);

function build(attendance, lunch) {
  return { attendance: Boolean(attendance), lunch: Boolean(lunch), name: nameFor(attendance, lunch), icons: iconsFor(attendance, lunch) };
}

function fromSettings(settings) {
  return build(!settings || settings.use_attendance !== false, !settings || settings.use_lunch !== false);
}

// Never throws: a failed read answers both on, so a hiccup never hides someone's page.
async function services(db, organizationId) {
  try {
    return fromSettings(await tenantSettings.settingsFor(db, organizationId));
  } catch (error) {
    return fromSettings(null);
  }
}

// What one class takes: the school's switches and the class's own (the class's settings come back already combined).
async function classServices(db, organizationId, classId) {
  const school = await services(db, organizationId);
  if (!Number(classId) || (!school.attendance && !school.lunch)) return school;
  try {
    const settings = await require("./classSettings").settingsFor(db, organizationId, classId);
    return build(settings.attendance !== false, settings.lunch !== false);
  } catch (error) {
    return school; // a hiccup never hides someone's page
  }
}

async function classServicesFor(db, organizationId, classIds) {
  const out = new Map();
  const school = await services(db, organizationId);
  const ids = [...new Set((classIds || []).map(Number).filter((id) => Number.isInteger(id) && id > 0))];
  ids.forEach((id) => out.set(id, school));
  if (!ids.length || (!school.attendance && !school.lunch)) return out;
  try {
    const byClass = await require("./classSettings").settingsForClasses(db, organizationId, ids);
    byClass.forEach((settings, id) => out.set(id, build(settings.attendance !== false, settings.lunch !== false)));
  } catch (error) { /* the school's answer stands */ }
  return out;
}

// By student: the class each is in now (students.class_id). A student without a class: the school's answer.
async function studentServicesFor(db, organizationId, studentIds) {
  const out = new Map();
  const ids = [...new Set((studentIds || []).map(Number).filter((id) => Number.isInteger(id) && id > 0))];
  const school = await services(db, organizationId);
  ids.forEach((id) => out.set(id, school));
  if (!ids.length || (!school.attendance && !school.lunch)) return out;
  try {
    const { rows } = await db.query("SELECT student_id, class_id FROM students WHERE student_id = ANY($1::int[]) AND organization_id = $2", [ids, Number(organizationId)]);
    const byClass = await classServicesFor(db, organizationId, rows.map((r) => r.class_id));
    rows.forEach((r) => { if (byClass.has(Number(r.class_id))) out.set(Number(r.student_id), byClass.get(Number(r.class_id))); });
  } catch (error) { /* the school's answer stands */ }
  return out;
}

// The same for the common "is this one on" question.
const attendanceOn = async (db, organizationId) => (await services(db, organizationId)).attendance;
const lunchOn = async (db, organizationId) => (await services(db, organizationId)).lunch;

// The page every "not used" answer shares.
const OFF_MESSAGE = (what) => `${what} isn't used in Managira at this school.`;

module.exports = { services, classServices, classServicesFor, studentServicesFor, attendanceOn, lunchOn, nameFor, iconsFor, build, fromSettings, OFF_MESSAGE };

// Route guard: stops a request for a service the school turned off, politely. `needs` is "attendance", "lunch" or
// "either" (the combined class page). A page gets a short "not available" message; a script gets JSON.
function requireService(db, needs) {
  return async (req, res, next) => {
    try {
      // A request that names a class (classId in the path, query or body) is answered for that class.
      const source = { ...(req.params || {}), ...(req.query || {}), ...(req.body && typeof req.body === "object" ? req.body : {}) };
      const classId = Number.parseInt(source.classId ?? source.class_id, 10);
      const orgId = req.session && req.session.organizationId;
      const svc = classId > 0 ? await classServices(db, orgId, classId) : await services(db, orgId);
      const ok = needs === "either" ? (svc.attendance || svc.lunch) : svc[needs];
      if (ok) return next();
      const what = needs === "lunch" ? "Lunch" : needs === "attendance" ? "Attendance" : "Attendance & lunch";
      const message = OFF_MESSAGE(what);
      const wantsJson = req.method !== "GET" || /json/.test(String(req.get("Accept") || "")) || req.xhr;
      if (wantsJson) return res.status(403).json({ success: false, error: message, message });
      return res.status(403).send(`<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${what}</title><body style="font:14px system-ui,sans-serif;color:#475467;background:#fff;margin:0;padding:48px 24px;text-align:center"><h1 style="font-size:22px;font-weight:700;color:#101828;margin:0 0 8px">${what} isn't used here</h1><p style="margin:0">${message}</p></body>`);
    } catch (error) {
      return next();
    }
  };
}

module.exports.requireService = requireService;
