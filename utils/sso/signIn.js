"use strict";

// Who an answer from a school's provider signs in, and the session that makes them. Only ever
// an account of that school, and never a platform admin. The sessions are the same ones the
// password sign-ins make (accountController.loginPost and studentLoginPost).
const { logOrganizationActivity } = require("../activityLog");
const { getStudentPortalIntegrationStatus } = require("../studentPortal");

const landing = (nickname, path) => (process.env.NODE_ENV === "production" && !process.env.SSO_STAY_ON_THIS_HOST
  ? `https://${nickname}.managira.com${path}`
  : path);

class SignInRefused extends Error {}

async function schoolOf(db, organizationId) {
  const { rows } = await db.query(
    `SELECT o.*, CASE WHEN o.hub_id IS NOT NULL THEN mh.hub_name ELSE NULL END AS hub_name,
            CASE WHEN o.hub_id IS NOT NULL THEN mh.logo_path ELSE NULL END AS hub_logo
       FROM organizations o LEFT JOIN managira_hubs mh ON o.hub_id = mh.hub_id
      WHERE o.organization_id = $1`,
    [organizationId]
  );
  return rows[0] || null;
}

// { kind: 'staff' | 'manager' | 'student', ... } for this email at this school, or null.
async function findAccount(db, connection, email) {
  const organizationId = connection.organization_id;
  const staff = await db.query(
    `SELECT * FROM users WHERE LOWER(email) = $1 AND organization_id = $2 AND account_type NOT IN ('Admin', 'Mini Admin', 'Internal Worker')`,
    [email, organizationId]
  );
  if (staff.rows[0]) return { kind: "staff", user: staff.rows[0] };
  const owner = await db.query("SELECT organization_id FROM organizations WHERE LOWER(email) = $1 AND organization_id = $2", [email, organizationId]);
  if (owner.rows[0]) return { kind: "manager" };
  if (connection.allow_students) {
    const student = await db.query(
      `SELECT sa.student_id, s.first_name, s.last_name
         FROM student_accounts sa JOIN students s ON s.student_id = sa.student_id AND s.organization_id = sa.organization_id
        WHERE LOWER(sa.login_email) = $1 AND sa.organization_id = $2`,
      [email, organizationId]
    );
    if (student.rows[0]) return { kind: "student", student: student.rows[0] };
  }
  return null;
}

const regenerate = (req) => new Promise((resolve, reject) => req.session.regenerate((error) => (error ? reject(error) : resolve())));
const save = (req) => new Promise((resolve, reject) => req.session.save((error) => (error ? reject(error) : resolve())));

function schoolSession(req, school) {
  req.session.organizationId = school.organization_id;
  req.session.organizationName = school.organization_name;
  req.session.logo = school.logo;
  req.session.fontStyle = school.font_style;
  req.session.orgNickName = school.nickname;
  req.session.orgNickNameDisplay = (school.nickname_display && String(school.nickname_display).trim()) || school.nickname;
  if (school.is_hub_member && school.hub_id) {
    req.session.hubName = school.hub_name;
    req.session.hubLogo = school.hub_logo;
  }
  req.session.signedInWith = "sso";
  // The provider decides how long people stay signed in there; here it lasts the browser session.
  req.session.keepSignedIn = false;
}

function logged(req, school, id, name, role, what) {
  logOrganizationActivity({
    organizationId: school.organization_id,
    userId: id,
    userName: name,
    userRole: role,
    actionType: "Login",
    moduleName: "Authentication",
    pagePath: "/account/sso",
    recordType: "Session",
    recordLabel: `${school.organization_name} login`,
    description: `${what} signed in with single sign-on.`,
    changedFields: [],
    ipAddress: req.ip,
  }).catch(() => {});
}

// Signs the person in and says where to go. Throws SignInRefused with words for them.
async function signIn(db, req, connection, account) {
  const school = await schoolOf(db, connection.organization_id);
  if (!school || school.deleted) throw new SignInRefused("Your organization account has been deleted. Please contact support.");

  if (account.kind === "student") {
    if (school.on_hold) throw new SignInRefused("School account is suspended. Please contact support.");
    const portal = await getStudentPortalIntegrationStatus(db, school.organization_id);
    if (!portal.activated) throw new SignInRefused("Student portal is deactivated for this organization. Please contact your school administrator.");
    const { student } = account;
    await regenerate(req);
    schoolSession(req, school);
    req.session.user = { user_id: student.student_id, first_name: student.first_name, last_name: student.last_name, email: account.email, account_type: "Student" };
    req.session.userRole = "Student";
    req.session.accountType = "Student";
    req.session.studentId = student.student_id;
    req.session.userId = null;
    req.session.guardianId = null;
    req.session.themeColor = school.theme_color || "teal";
    req.session.firstName = student.first_name;
    req.session.lastName = student.last_name;
    await save(req);
    logged(req, school, student.student_id, `${student.first_name || ""} ${student.last_name || ""}`.trim(), "Student", student.first_name || "A student");
    return landing(school.nickname, "/student/dashboard");
  }

  if (account.kind === "manager") {
    const onHold = Boolean(school.on_hold);
    await regenerate(req);
    schoolSession(req, school);
    req.session.user = { user_id: school.organization_id, first_name: school.first_name, last_name: school.last_name, email: school.email, account_type: "Manager" };
    req.session.firstName = school.first_name;
    req.session.lastName = school.last_name;
    req.session.accountType = "Organization";
    req.session.userRole = "Manager";
    req.session.onHoldRestricted = onHold;
    await save(req);
    logged(req, school, school.organization_id, `${school.first_name || ""} ${school.last_name || ""}`.trim() || school.email, "Manager", school.first_name || school.email);
    return onHold ? "/account/settings" : landing(school.nickname, "/common/orgDashboard");
  }

  const { user } = account;
  if (user.removed_at) throw new SignInRefused("Your school removed this account. Ask your school to enable it again.");
  const isManager = String(user.account_type || "").trim().toLowerCase() === "manager";
  if (school.on_hold && !isManager) throw new SignInRefused("Your organization account is currently on hold. Please contact support.");
  const onHold = Boolean(school.on_hold && isManager);
  await regenerate(req);
  schoolSession(req, school);
  req.session.userId = user.user_id;
  req.session.user = { user_id: user.user_id, first_name: user.first_name, last_name: user.last_name, email: user.email, phone: user.phone, account_type: user.account_type };
  req.session.userRole = user.account_type;
  req.session.firstName = user.first_name;
  req.session.lastName = user.last_name;
  req.session.accountType = user.account_type;
  req.session.onHoldRestricted = onHold;
  await save(req);
  logged(req, school, user.user_id, `${user.first_name || ""} ${user.last_name || ""}`.trim() || user.email, user.account_type, user.first_name || user.email);
  if (onHold) return "/account/settings";
  return landing(school.nickname, String(user.account_type || "").trim() === "Driver" ? "/driver/dashboard" : "/common/orgDashboard");
}

module.exports = { findAccount, signIn, SignInRefused };
