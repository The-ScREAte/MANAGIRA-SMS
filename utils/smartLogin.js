"use strict";

// Parents, students and hub staff sometimes sign in on the main login page. Once their own
// password has been checked by their own sign-in, they're taken to their portal. Nothing is
// said about an email until its password is right, so this tells a stranger nothing.
const features = require("./shards/features");

const PORTALS = {
  guardian: { name: "parent portal", field: "identifier" },
  student: { name: "student portal", field: "email" },
  hub: { name: "hub", field: "email" },
};
const TABLE_MISSING = "42P01";

async function portalsFor(db, email) {
  const address = String(email || "").trim().toLowerCase();
  if (!address) return [];
  const lookup = (sql) => db.query(sql, [address]).then((result) => result.rows).catch((error) => {
    if (error.code !== TABLE_MISSING) console.error("[Smart login]", error.message);
    return [];
  });
  const [guardians, students, hubs, hubStaff] = await Promise.all([
    lookup("SELECT organization_id FROM guardian_accounts WHERE LOWER(login_email) = $1 LIMIT 5"),
    lookup("SELECT organization_id FROM student_accounts WHERE LOWER(login_email) = $1 LIMIT 5"),
    lookup("SELECT hub_id FROM managira_hubs WHERE LOWER(hub_email) = $1 AND COALESCE(deleted, FALSE) = FALSE LIMIT 1"),
    lookup("SELECT hub_id FROM hub_users WHERE LOWER(email) = $1 LIMIT 1"),
  ]);
  const on = (row) => features.isOn("smart_login", row.hub_id ? { hubId: row.hub_id } : { organizationId: row.organization_id });
  const found = [];
  if (guardians.some(on)) found.push("guardian");
  if (students.some(on)) found.push("student");
  if ([...hubs, ...hubStaff].some(on)) found.push("hub");
  return found;
}

// Runs a portal's real sign-in. Whatever it would have redirected to comes back here instead.
function tryPortal(handler, req, res, db) {
  return new Promise((resolve) => {
    const stand = Object.create(res);
    stand.redirect = (...args) => resolve(args[args.length - 1]);
    stand.render = () => resolve(null);
    stand.send = () => resolve(null);
    stand.json = () => resolve(null);
    stand.status = () => stand;
    Promise.resolve(handler(req, stand, db)).catch((error) => {
      console.error("[Smart login] portal sign-in:", error.message);
      resolve(null);
    });
  });
}

const signedInAs = (req, kind) => Boolean(kind === "guardian" ? req.session.guardianId : kind === "student" ? req.session.studentId : req.session.hubId);

// True if it answered. handlers: { guardian, student, hub } in the portals' own sign-ins.
async function routeToPortal(req, res, db, email, handlers) {
  const portals = await portalsFor(db, email);
  if (!portals.length) return false;
  const password = req.body.password;
  for (const kind of portals) {
    req.body = { email, identifier: email, password };
    const target = await tryPortal(handlers[kind], req, res, db);
    if (target && signedInAs(req, kind)) {
      res.render("account/goingTo", { layout: false, title: `Going to the ${PORTALS[kind].name}`, portal: PORTALS[kind].name, target });
      return true;
    }
    req.flash("error"); // That sign-in's own message isn't for this page.
  }
  req.flash("error", "Invalid email or password.");
  res.redirect("/account/login");
  return true;
}

module.exports = { routeToPortal, portalsFor };
