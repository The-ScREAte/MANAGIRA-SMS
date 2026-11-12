// Data migration (utils/dataMigration.js, utils/migration/powerschool.js) and the authenticator
// codes that guard it (utils/mfa.js): the parts that need no database.
const test = require("node:test");
const assert = require("node:assert/strict");
const ps = require("../utils/migration/powerschool");
const migration = require("../utils/dataMigration");
const mfa = require("../utils/mfa");

test("PowerSchool columns are read without their table, and each file is recognized", () => {
  assert.equal(ps.bare("[Students]Student_Number"), "studentnumber");
  assert.equal(ps.bare("[01]Student_Number"), "studentnumber");
  assert.equal(ps.bare("Students.Student_Number"), "studentnumber");
  assert.equal(ps.detectEntity(["[Students]Student_Number", "SectionID", "TermID", "DateEnrolled"]), "enrollments");
  assert.equal(ps.detectEntity(["Section_ID", "Course_Name", "Teacher", "Grade_Level"]), "classes");
  assert.equal(ps.detectEntity(["Student_Number", "Course_Name", "Grade", "EarnedCrHrs", "PotentialCrHrs"]), "grades");
  assert.equal(ps.detectEntity(["Student_Number", "Days_Present", "Days_Absent", "Term"]), "attendance");
  assert.deepEqual(ps.matchColumn("enrollments", "[Students]Student_Number"), { target: "student_source_id", confidence: "confident" });
  assert.equal(ps.matchColumn("grades", "PotentialCrHrs").target, "credits_attempted");
  assert.equal(ps.matchColumn("grades", "TermID").target, "term_id");
  assert.equal(ps.matchColumn("classes", "Grade_Level").target, "grade_level");
});

test("a PowerSchool term ID gives its school year; nonsense gives none", () => {
  assert.equal(ps.schoolYearOfTermId("3300"), "2023-2024");
  assert.equal(ps.schoolYearOfTermId("3601"), "2026-2027");
  assert.equal(ps.schoolYearOfTermId("S1"), "");
  assert.equal(ps.schoolYearOfTermId("12"), "");
});

test("attendance codes: present, tardy, excused, absent, or unknown", () => {
  assert.deepEqual(["P", "", "T", "EX", "A", "U", "Q"].map((c) => ps.attendanceKind(c)), ["present", "present", "tardy", "excused", "absent", "absent", null]);
  assert.equal(ps.attendanceKind("A", "1"), "present"); // a present flag wins
  assert.equal(ps.attendanceKind("", "no"), "absent");
});

test("attendance adds up days, or takes a row of totals as it is", () => {
  const sum = { present: 0, absent: 0, excused: 0, tardy: 0 };
  for (const code of ["P", "T", "A", "EX", "Q"]) migration.addAttendance(sum, { date: "2026-09-08", code });
  assert.deepEqual(sum, { present: 2, absent: 3, excused: 1, tardy: 1 });
  const totals = { present: 0, absent: 0, excused: 0, tardy: 0 };
  migration.addAttendance(totals, { days_present: "80", days_absent: "4.5", days_tardy: "2" });
  assert.deepEqual(totals, { present: 80, absent: 4.5, excused: 0, tardy: 2 });
});

test("GPA is weighted by credits attempted, so a failed course still counts", () => {
  const rows = [{ gpa: 4, attempted: 1, earned: 1 }, { gpa: 3, attempted: 1, earned: 1 }, { gpa: 0, attempted: 1, earned: 0 }];
  assert.equal(migration.gpaOf(rows), 2.33);
  assert.equal(migration.gpaOf([{ gpa: 4, attempted: 2 }, { gpa: 2, attempted: 1 }]), 3.33);
  assert.equal(migration.gpaOf([{ gpa: 4 }, { gpa: 3 }]), 3.5); // no credits: equal weights
  assert.equal(migration.gpaOf([{ gpa: null, earned: 1 }]), null);
});

test("a class enrollment counts only while it holds", () => {
  assert.equal(migration.currentEnrollment({ section_source_id: "S302" }, "2026-11-12"), true);
  assert.equal(migration.currentEnrollment({ section_source_id: "-S302" }, "2026-11-12"), false);
  assert.equal(migration.currentEnrollment({ section_source_id: "S303", date_left: "2026-01-10" }, "2026-11-12"), false);
  assert.equal(migration.currentEnrollment({ section_source_id: "S303", date_left: "2027-06-01" }, "2026-11-12"), true);
});

test("authenticator codes match RFC 6238 and work once", () => {
  const secret = mfa.base32(Buffer.from("12345678901234567890"));
  assert.equal(secret, "GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ");
  assert.equal(mfa.codeAt(secret, Math.floor(59 / 30)), "287082");
  assert.equal(mfa.codeAt(secret, Math.floor(1111111109 / 30)), "081804");
  assert.equal(mfa.codeAt(secret, Math.floor(2000000000 / 30)), "279037");
  const now = 1_800_000_000_000;
  const step = mfa.stepAt(now);
  assert.equal(mfa.matchStep(secret, mfa.codeAt(secret, step), null, now), step);
  assert.equal(mfa.matchStep(secret, mfa.codeAt(secret, step - 1), null, now), step - 1, "the code before still works (a phone's clock)");
  assert.equal(mfa.matchStep(secret, mfa.codeAt(secret, step), step, now), null, "a used code is refused");
  assert.equal(mfa.matchStep(secret, mfa.codeAt(secret, step - 3), null, now), null, "an old code is refused");
  assert.equal(mfa.matchStep(secret, "12345", null, now), null);
});

test("the code holds for 30 minutes, for the account that gave it", () => {
  const req = { session: { userId: 7, organizationId: 3 } };
  assert.equal(mfa.fresh(req), false);
  mfa.markFresh(req);
  assert.equal(mfa.fresh(req), true);
  assert.equal(mfa.fresh({ session: { ...req.session, userId: 8 } }), false, "another person in the same session isn't");
  req.session.mfa.at -= mfa.FRESH_MS + 1;
  assert.equal(mfa.fresh(req), false);
  assert.deepEqual(mfa.accountOf({ session: { accountType: "Organization", organizationId: 3, userId: 3 } }), { kind: "organization", id: 3, organizationId: 3 });
});

const roles = require("../utils/migration/roles");
const gpa = require("../utils/gpa");

test("old roles match a Managira role: confident, unsure or can't map", () => {
  assert.deepEqual(roles.matchRole("Teachers"), { level: "teacher", target: "teacher", confidence: "confident" });
  assert.deepEqual(roles.matchRole("School Admin"), { level: "admin", target: "manager", confidence: "confident" });
  assert.equal(roles.matchRole("Assistant Principal").level, "leader", "assistant principal isn't the principal");
  assert.deepEqual(roles.matchRole("Office"), { level: "office", target: "office", confidence: "confident" });
  assert.equal(roles.matchRole("Front Office Staff (2nd floor)").confidence, "unsure");
  assert.equal(roles.matchRole("Teaching Assistant").level, "support", "a teaching assistant isn't a teacher");
  assert.equal(roles.matchRole("9").confidence, "none", "a PowerSchool group number can't be matched");
  assert.equal(roles.matchRole("Data Wizards").confidence, "none");
});

test("a match never gives more than the old role; more is flagged, admin-level always is", () => {
  const teacher = roles.choiceOf({ target: "teacher" });
  assert.deepEqual(roles.compare("teacher", teacher), { up: [], adminLevel: false });
  const up = roles.compare("support", teacher);
  assert.ok(up.up.includes("Manage Assessments & Scores"), "a teacher's role on an aide gives more: " + up.up.join(", "));
  assert.ok(roles.compare("teacher", roles.choiceOf({ target: "supervisor" })).up.includes("Every class"), "a supervisor sees every class, a teacher doesn't");
  const manager = roles.compare("admin", roles.choiceOf({ target: "manager" }));
  assert.equal(manager.up.length, 0);
  assert.equal(manager.adminLevel, true, "admin-level, even when it isn't more than before");
  assert.deepEqual(roles.compare("office", roles.choiceOf({ target: "support" })).up, ["Mark Attendance"], "office staff never marked attendance");
  assert.ok(roles.compare(null, teacher).up.length, "an unknown old role is always flagged");
});

test("a custom role holds only what was ticked; a high-risk tick makes it admin-level", () => {
  const custom = roles.choiceOf({ target: "custom", label: "Data clerk", account_type: "Supervisor", permissions: ["manage_students"] });
  assert.equal(custom.accountType, "Supervisor");
  assert.ok(custom.permissions.includes("manage_students") && !custom.permissions.includes("students_delete"), "follow-ups come along, never the high-risk ones");
  assert.equal(roles.compare("office", custom).up.length, 0);
  const risky = roles.choiceOf({ target: "custom", label: "Staff admin", account_type: "Supervisor", permissions: ["manage_employees"] });
  assert.equal(roles.compare("office", risky).adminLevel, true);
  assert.equal(roles.choiceOf({ target: "custom", label: "Sneaky", account_type: "Manager", permissions: [] }).accountType, "Teacher", "a custom role can't be a Manager");
});

test("staff status and class roles read as PowerSchool writes them", () => {
  assert.deepEqual(["1", "", "Active", "2", "Inactive", "0"].map(roles.isActive), [true, true, true, false, false, false]);
  assert.deepEqual(["Co-Teacher", "Lead Teacher", "Additional", ""].map(roles.isCoTeacher), [true, false, true, false]);
  assert.deepEqual(roles.schoolsOf("100; 200,300"), ["100", "200", "300"]);
});

test("GPA: letters on the 4.0 scale, and the average of a term's grades", () => {
  assert.deepEqual(["A+", "A", "A-", "B+", "B", "C-", "D", "F", "E", "Excellent", "", "A −"].map(gpa.pointsFor), [4, 4, 3.7, 3.3, 3, 1.7, 1, 0, 0, null, null, 3.7]);
  assert.equal(gpa.gpaOfGrades(["A", "B", "C", "Excellent"]), 3);
  assert.equal(gpa.gpaOfGrades(["Excellent"]), null);
  assert.equal(gpa.formatGpa(3.333), "3.33");
});

test("timing: a code changes every 30 seconds and works 90 seconds at most; a verified session holds 30 minutes", () => {
  assert.equal(mfa.STEP_SECONDS, 30);
  assert.equal(mfa.FRESH_MS, 30 * 60 * 1000);
  const secret = mfa.base32(Buffer.from("timing-test-secret-1234"));
  const issued = 1_800_000_000_000; // the start of a 30-second step
  const code = mfa.codeAt(secret, mfa.stepAt(issued));
  assert.notEqual(mfa.codeAt(secret, mfa.stepAt(issued + 30_000)), code, "the next 30 seconds have another code");
  for (const later of [0, 29_000, 30_000, 59_000]) assert.notEqual(mfa.matchStep(secret, code, null, issued + later), null, `still works ${later / 1000}s on`);
  for (const later of [60_000, 90_000, 30 * 60_000]) assert.equal(mfa.matchStep(secret, code, null, issued + later), null, `refused ${later / 1000}s on`);
  const req = { session: { userId: 5, organizationId: 3 } };
  mfa.markFresh(req);
  req.session.mfa.at = Date.now() - (30 * 60_000 - 1000);
  assert.equal(mfa.fresh(req), true, "29 minutes 59 seconds after the code: still fine");
  req.session.mfa.at = Date.now() - (30 * 60_000 + 1000);
  assert.equal(mfa.fresh(req), false, "30 minutes and a second: asked again");
});

test("weighted GPA: an Honors or AP subject adds its bonus to a pass, never to an F", () => {
  const items = [{ grade: "A", level: "ap" }, { grade: "B", level: "honors" }, { grade: "C", level: null }, { grade: "F", level: "ap" }];
  assert.deepEqual(gpa.gpaOf(items), { unweighted: 2.25, weighted: 2.63 }, "(5 + 3.5 + 2 + 0) / 4");
  assert.deepEqual(gpa.gpaOf(items, { honors: 1, ap: 1 }), { unweighted: 2.25, weighted: 2.75 }, "the school's own bonuses");
  assert.deepEqual(gpa.gpaOf([{ grade: "A" }, { grade: "B" }]), { unweighted: 3.5, weighted: null }, "no weighted GPA without a weighted subject");
  assert.deepEqual(gpa.gpaOf([{ grade: "Excellent", level: "ap" }]), { unweighted: null, weighted: null });
});

test("backups are off unless the server turns them on: nothing runs, nothing is logged", async () => {
  const backups = require("../utils/backups");
  const saved = process.env.BACKUPS_ENABLED;
  delete process.env.BACKUPS_ENABLED;
  let touched = false;
  const db = { query: async () => { touched = true; return { rows: [{}] }; }, connect: async () => { touched = true; } };
  const result = await backups.runBackup(db);
  assert.equal(backups.enabled(), false);
  assert.equal(result.off, true);
  assert.equal(touched, false, "the database isn't even asked");
  process.env.BACKUPS_ENABLED = "TRUE ";
  assert.equal(backups.enabled(), true, "only an explicit true turns them on");
  if (saved === undefined) delete process.env.BACKUPS_ENABLED; else process.env.BACKUPS_ENABLED = saved;
});
