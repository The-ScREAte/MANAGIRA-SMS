"use strict";

// Which of Managira's two daily services a school uses: Attendance and Lunch (Management, Class & notif.
// settings). Both are on until a school turns one off, for schools that keep attendance somewhere else.
// Read from the school's tenant settings (cached a minute, dropped on save), so asking is cheap. A
// database without the columns yet, or a school without a row, answers "both on".
//   services(db, orgId) -> { attendance, lunch, name }
// name is what the class's daily page is called: "Attendance and lunch", "Lunch", "Attendance", or "" when neither.
const tenantSettings = require("./tenantSettings");

function nameFor(attendance, lunch) {
  if (attendance && lunch) return "Attendance and lunch";
  if (lunch) return "Lunch";
  if (attendance) return "Attendance";
  return "";
}

function fromSettings(settings) {
  const attendance = !settings || settings.use_attendance !== false;
  const lunch = !settings || settings.use_lunch !== false;
  return { attendance, lunch, name: nameFor(attendance, lunch) };
}

// Never throws: a failed read answers both on, so a hiccup never hides someone's page.
async function services(db, organizationId) {
  try {
    return fromSettings(await tenantSettings.settingsFor(db, organizationId));
  } catch (error) {
    return fromSettings(null);
  }
}

// The same for the common "is this one on" question.
const attendanceOn = async (db, organizationId) => (await services(db, organizationId)).attendance;
const lunchOn = async (db, organizationId) => (await services(db, organizationId)).lunch;

// The page every "not used" answer shares.
const OFF_MESSAGE = (what) => `${what} isn't used in Managira at this school.`;

module.exports = { services, attendanceOn, lunchOn, nameFor, fromSettings, OFF_MESSAGE };

// Route guard: stops a request for a service the school turned off, politely. `needs` is "attendance", "lunch" or
// "either" (the combined class page). A page gets a short "not available" message; a script gets JSON.
function requireService(db, needs) {
  return async (req, res, next) => {
    try {
      const svc = await services(db, req.session && req.session.organizationId);
      const ok = needs === "either" ? (svc.attendance || svc.lunch) : svc[needs];
      if (ok) return next();
      const what = needs === "lunch" ? "Lunch" : needs === "attendance" ? "Attendance" : "Attendance and lunch";
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
