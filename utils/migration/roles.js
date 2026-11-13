"use strict";
// Staff roles in a data migration (utils/dataMigration.js). Each role or access group of the old
// system is matched to a Managira role, never giving more access than the old role gave: when
// unsure, the more limited one. A Managira role is an account type and a set of permissions,
// saved on the person (saved rows are authoritative: middleware/permissionMiddleware.js).
// Built-in roles follow the staff form's presets; the Managira team can make a custom one (a
// name, an account type and the permissions ticked). Admin-level access always needs the school
// admin's approval, person by person.
const perms = require("../../middleware/permissionMiddleware");

const { PERMISSIONS: P, PERMISSION_OPTIONS, HIGH_RISK_PERMISSIONS, ROLE_DEFAULT_PERMISSIONS } = perms;
const OPTION = new Map(PERMISSION_OPTIONS.map((o) => [o.key, o]));
const rootOf = (key) => { let o = OPTION.get(key); while (o && o.parent && OPTION.get(o.parent)) o = OPTION.get(o.parent); return o ? o.key : key; };
const norm = (value) => String(value || "").toLowerCase().replace(/[^a-z0-9]/g, "");

// Main permissions with the follow-ups that come with them. High-risk ones are never added on
// their own: only when ticked themselves.
function withFollowUps(mains) {
  const chosen = new Set(mains);
  return PERMISSION_OPTIONS.filter((o) => !o.retired && chosen.has(rootOf(o.key)) && (chosen.has(o.key) || !o.highRisk) && o.key !== P.SET_ASSESSMENT_QUESTIONS).map((o) => o.key);
}

// The Managira roles a school's old roles are matched to. `allClasses`: sees every class (a
// Teacher account sees only its own).
const ROLES = {
  manager: { label: "Manager", accountType: "Manager", about: "Runs the school: every permission, every class.", allClasses: true, permissions: () => ROLE_DEFAULT_PERMISSIONS.Manager },
  supervisor: { label: "Supervisor", accountType: "Supervisor", about: "School leadership: students, parents, assessments, reports, admissions, events, transcripts; every class.", allClasses: true, permissions: () => perms.rolePresetPermissions("Supervisor") },
  teacher: { label: "Teacher", accountType: "Teacher", about: "Their own classes: students, assessments and scores, attendance, reports.", allClasses: false, permissions: () => perms.rolePresetPermissions("Teacher") },
  counselor: { label: "Counselor", accountType: "Supervisor", about: "Students, parents, report cards and transcripts; every class. No scores or school settings.", allClasses: true, permissions: () => withFollowUps([P.MANAGE_STUDENTS, P.MANAGE_GUARDIANS, P.MANAGE_REPORTS, P.GENERATE_TRANSCRIPTS]) },
  office: { label: "Office staff", accountType: "Supervisor", about: "Students, parents, admissions, events and announcements; every class. No grades.", allClasses: true, permissions: () => withFollowUps([P.MANAGE_STUDENTS, P.MANAGE_GUARDIANS, P.APPROVE_ADMISSIONS, P.PUBLISH_EVENTS_ANNOUNCEMENTS]) },
  support: { label: "Support staff", accountType: "Teacher", about: "Their own classes: the students and attendance. No grades.", allClasses: false, permissions: () => withFollowUps([P.MANAGE_STUDENTS, P.MARK_ATTENDANCE]) },
  driver: { label: "Driver", accountType: "Driver", about: "Their bus routes and riders.", allClasses: false, permissions: () => [] },
};
const ACCOUNT_TYPES = ["Supervisor", "Teacher", "Driver"]; // a custom role's; Manager only through "manager"

// What a role gave in the old system, and the most a match may give in Managira.
const LEVELS = {
  admin: { label: "Runs the school or district (admin)", ceiling: "manager" },
  leader: { label: "School leadership (assistant principal, dean, head of department)", ceiling: "supervisor" },
  teacher: { label: "Teaches classes", ceiling: "teacher" },
  counselor: { label: "Counselor", ceiling: "counselor" },
  office: { label: "Office staff (front office, registrar, clerk)", ceiling: "office" },
  support: { label: "Support staff (aide, nurse, librarian)", ceiling: "support" },
  driver: { label: "Driver", ceiling: "driver" },
};

// Old role names: exact ones match with confidence, words that only hint are unsure. Leadership
// is looked at before admin ("assistant principal" isn't the principal), support before teacher.
const MATCH = [
  ["leader", ["assistantprincipal", "viceprincipal", "dean", "deanofstudents", "departmenthead", "headofdepartment", "coordinator", "supervisor", "schoolleadership"], /assistant ?principal|vice ?principal|\bdean\b|department ?head|head ?of ?department|coordinator|supervisor/],
  ["admin", ["admin", "admins", "administrator", "administrators", "schooladmin", "schooladministrator", "districtadmin", "districtadministrator", "principal", "superintendent", "headofschool", "director", "sysadmin", "systemadministrator"], /admin|principal|superintendent|head ?of ?school|director/],
  ["counselor", ["counselor", "counselors", "counsellor", "guidance", "guidancecounselor", "schoolcounselor"], /counsel|guidance/],
  ["office", ["office", "officestaff", "frontoffice", "secretary", "registrar", "clerk", "receptionist", "attendanceclerk", "dataentry", "schoolsecretary"], /office|secretar|registrar|clerk|reception|front ?desk|data ?entry/],
  ["support", ["aide", "teacheraide", "teachingassistant", "paraprofessional", "para", "nurse", "schoolnurse", "librarian", "supportstaff"], /\baide\b|para|nurse|librar|support staff|health/],
  ["driver", ["driver", "busdriver", "drivers"], /driver|\bbus\b|transport/],
  ["teacher", ["teacher", "teachers", "faculty", "instructor", "classroomteacher", "coteacher", "substitute", "substituteteacher"], /teach|instructor|faculty|educator|substitute/],
];
function matchRole(oldRole) {
  const key = norm(oldRole);
  if (!key || /^\d+$/.test(key)) return { level: null, target: null, confidence: "none" };
  for (const [level, exact] of MATCH) if (exact.includes(key)) return { level, target: LEVELS[level].ceiling, confidence: "confident" };
  const text = String(oldRole).toLowerCase();
  for (const [level, , hint] of MATCH) if (hint.test(text)) return { level, target: LEVELS[level].ceiling, confidence: "unsure" };
  return { level: null, target: null, confidence: "none" };
}

// A migration_roles row's Managira role: a built-in one, or the custom one it holds.
function choiceOf(row) {
  if (!row || !row.target) return null;
  if (row.target === "custom") {
    const accountType = ACCOUNT_TYPES.includes(row.account_type) ? row.account_type : "Teacher";
    const mains = (Array.isArray(row.permissions) ? row.permissions : []).filter((k) => OPTION.has(k));
    return {
      key: `custom:${accountType}:${[...mains].sort().join(",")}:${row.label || ""}`, label: row.label || "Custom role", accountType, custom: true,
      allClasses: accountType === "Supervisor", permissions: accountType === "Driver" ? perms.driverPermissions(withFollowUps(mains)) : withFollowUps(mains),
      about: "Made for this school by Managira.",
    };
  }
  const role = ROLES[row.target];
  if (!role) return null;
  return { key: row.target, label: role.label, accountType: role.accountType, allClasses: role.allClasses, permissions: role.permissions(), about: role.about };
}

// Whether a match gives more than the old role did: what it adds beyond the level's ceiling,
// and whether it's admin-level (a Manager, or any high-risk permission).
function compare(level, choice) {
  if (!choice) return { up: [], adminLevel: false };
  const adminLevel = choice.accountType === "Manager" || choice.permissions.some((k) => HIGH_RISK_PERMISSIONS.has(k));
  const ceilingRole = level && LEVELS[level] ? ROLES[LEVELS[level].ceiling] : null;
  if (!ceilingRole) return { up: ["Its old access isn't known"], adminLevel };
  const allowed = new Set(ceilingRole.permissions());
  const up = choice.permissions.filter((k) => !allowed.has(k) && !OPTION.get(k)?.parent).map((k) => OPTION.get(k)?.label || k);
  choice.permissions.filter((k) => !allowed.has(k) && OPTION.get(k)?.parent && allowed.has(OPTION.get(k).parent)).forEach((k) => up.push(OPTION.get(k).label));
  if (choice.allClasses && !ceilingRole.allClasses) up.unshift("Every class");
  return { up, adminLevel };
}

// "What they can do", in a line.
const summary = (choice) => {
  if (!choice) return "No role";
  const mains = PERMISSION_OPTIONS.filter((o) => !o.parent && choice.permissions.includes(o.key)).map((o) => o.label);
  return `${choice.allClasses ? "Every class" : "Their own classes"}${mains.length ? ": " + mains.join(", ") : ": no permissions"}`;
};

// A member of staff is active unless the export says otherwise (PowerSchool: 1 active, 2 inactive).
// Inactive however the export words it: "0", "I", "Inactive", "Inactive (resigned 2026-06-05)", "Left school"…
const isActive = (value) => {
  const text = String(value == null ? "" : value).trim();
  return !/^(2|0|i|n|no|false)$/i.test(text) && !/^(inactive|not active|former|terminated|left|disabled|resigned|retired|separated|deceased|withdrawn)\b/i.test(text);
};
// Co-teacher or lead in a class (PowerSchool's section teacher roles).
const isCoTeacher = (value) => /co[- ]?teach|assist|additional|second|support|para/i.test(String(value || ""));
const schoolsOf = (value) => String(value || "").split(/[;,|]/).map((s) => s.trim()).filter(Boolean);

// Main permissions a custom role can be given (the staff form's list, high-risk marked).
const pickable = () => PERMISSION_OPTIONS.filter((o) => !o.parent && !o.retired && o.group !== "Driver").map((o) => ({ key: o.key, label: o.label, group: o.group, highRisk: Boolean(o.highRisk) }));

module.exports = { ROLES, LEVELS, ACCOUNT_TYPES, matchRole, choiceOf, compare, summary, isActive, isCoTeacher, schoolsOf, withFollowUps, pickable, norm };
