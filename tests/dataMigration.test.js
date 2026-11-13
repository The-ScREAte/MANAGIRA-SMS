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

test("tidying: capitals become names, US phones one format, emails lower case; anything typed with care is kept", () => {
  const tidy = require("../utils/migration/tidy");
  assert.equal(tidy.name("AMA MENSAH"), "Ama Mensah");
  assert.equal(tidy.name("mary-jane o'brien"), "Mary-Jane O'Brien");
  assert.equal(tidy.name("LUDWIG VAN BEETHOVEN"), "Ludwig van Beethoven");
  assert.equal(tidy.name("MCKENZIE"), "McKenzie");
  assert.equal(tidy.name("MACHADO"), "Machado", "Mac is left alone");
  assert.equal(tidy.name("ROBERT SMITH III"), "Robert Smith III");
  assert.equal(tidy.name("DeShawn"), "DeShawn", "mixed case is kept as typed");
  assert.equal(tidy.phone("555.123.4567"), "(555) 123-4567");
  assert.equal(tidy.phone("+1 555 123 4567"), "(555) 123-4567");
  assert.equal(tidy.phone("555-123-4567 x12"), "555-123-4567 x12", "an extension is kept");
  assert.equal(tidy.phone("+44 20 7946 0958"), "+44 20 7946 0958", "another country is kept");
  assert.equal(tidy.email(" Ama@School.ORG "), "ama@school.org");
  assert.equal(tidy.gender("f"), "Female");
  assert.equal(tidy.gender("Non-binary"), "Non-binary");
  const row = { first_name: "IVY", guardian1_phone: "5550201000", gender: "M", class_name: "GRADE 6", course_name: "ALGEBRA" };
  assert.equal(tidy.record("students", row), 3);
  assert.deepEqual(row, { first_name: "Ivy", guardian1_phone: "(555) 020-1000", gender: "Male", class_name: "GRADE 6", course_name: "ALGEBRA" });
  assert.equal(tidy.record("grades", { first_name: "IVY" }), 0, "only people are tidied");
});

test("keeping what's there: only empty fields are filled; a value the school changed since is never overwritten", () => {
  const live = { first_name: "Mia", last_name: "Ortiz-Lee", gender: null, email: "", class_id: 7 };
  const plan = migration.mergePlan(live, { first_name: "MIA", last_name: "Ortiz", gender: "Female", email: "mia@example.com", class_id: 9 });
  assert.deepEqual(plan.set, { gender: "Female", email: "mia@example.com" }, "empty fields are filled; the same name in capitals isn't a change");
  assert.deepEqual(plan.kept.map((k) => k.field), ["last_name", "class_id"], "differences stay as Managira has them");
  // A record the migration made: what it loaded last time can follow the files, unless the school changed it.
  const mine = migration.mergePlan({ first_name: "Noah", last_name: "Larsen-Hart" }, { first_name: "Adaline", last_name: "Larson" }, { first_name: "Noah", last_name: "Larsen" });
  assert.deepEqual(mine.set, { first_name: "Adaline" });
  assert.deepEqual(mine.kept.map((k) => k.field), ["last_name"]);
});

test("records already in Managira: matched by old number or name and birthday; anyone who only might be the same is asked about", async () => {
  const live = [
    { student_id: 1, first_name: "Mia", last_name: "Ortiz-Lee", date_of_birth: "2012-10-05", custom_student_id: "900102" },
    { student_id: 2, first_name: "Ava", last_name: "Rivera", date_of_birth: "2013-06-05", custom_student_id: null },
    { student_id: 3, first_name: "Liam", last_name: "Silva", date_of_birth: "2011-07-22", custom_student_id: null },
    { student_id: 4, first_name: "Eli", last_name: "Chen", date_of_birth: "2014-04-16", custom_student_id: "S-1" },
    { student_id: 5, first_name: "Kai", last_name: "Brown", date_of_birth: null, custom_student_id: "900108" },
  ];
  const fakeDb = (links = []) => ({ query: async (sql) => ({ rows: /FROM students/.test(sql) ? live : /FROM migration_links/.test(sql) ? links : [] }) });
  const staged = [
    { source_id: "900102", data: { first_name: "Mia", last_name: "Ortiz", date_of_birth: "10/4/2012" } }, // old number, same first name
    { source_id: "900100", data: { first_name: "AVA", last_name: "Rivera", date_of_birth: "6/5/2013" } }, // name and birthday
    { source_id: "900101", data: { first_name: "Liam", last_name: "Silva", date_of_birth: "4/2/2012" } }, // same name, another birthday
    { source_id: "900103", data: { first_name: "Noah", last_name: "Okafor", date_of_birth: "3/10/2013" } }, // new
    { source_id: "900104", data: { first_name: "Noah", last_name: "Okafor", date_of_birth: "3/10/2013" } }, // twice in the files
    { source_id: "900108", data: { first_name: "Zed", last_name: "Stone", date_of_birth: "1/1/2014" } }, // old number, another person
  ];
  const job = { organization_id: 63, source_system: "powerschool", match_decisions: {} };
  let found = await migration.studentMatches(fakeDb(), job, staged);
  assert.deepEqual(found.out.get("900102"), { id: 1, how: "number" });
  assert.deepEqual(found.out.get("900100"), { id: 2, how: "name and date of birth" });
  assert.deepEqual(found.out.get("900103"), { fresh: true });
  assert.deepEqual(found.out.get("900101"), { waiting: true });
  assert.deepEqual(found.out.get("900104"), { waiting: true });
  assert.deepEqual(found.out.get("900108"), { waiting: true }, "the old number of someone with another name is asked about, never matched");
  assert.deepEqual(found.questions.map((q) => q.key), ["students:900101", "file:900104", "students:900108"]);
  assert.deepEqual(found.questions[0].candidates.map((c) => c.id), [3]);
  assert.equal(found.waiting, 3);
  // The school's answers: the same student (one shown), the same one twice, a different one.
  job.match_decisions = { "students:900101": { same: 3 }, "file:900104": { sameAs: "900103" }, "students:900108": { different: true } };
  found = await migration.studentMatches(fakeDb(), job, staged);
  assert.deepEqual(found.out.get("900101"), { id: 3, how: "your answer" });
  assert.deepEqual(found.out.get("900104"), { sameAs: "900103" });
  assert.deepEqual(found.out.get("900108"), { fresh: true });
  assert.equal(found.waiting, 0);
  // An answer naming a student who wasn't shown counts as no answer.
  job.match_decisions = { "students:900101": { same: 2 } };
  found = await migration.studentMatches(fakeDb(), job, staged);
  assert.deepEqual(found.out.get("900101"), { waiting: true });
  // A student this migration already linked is never offered to anyone else.
  job.match_decisions = {};
  found = await migration.studentMatches(fakeDb([{ source_id: "800000", managira_id: 3, loaded: null }]), job, [...staged, { source_id: "800000", data: { first_name: "Liam", last_name: "Silva" } }]);
  assert.deepEqual(found.out.get("900101"), { fresh: true });
  assert.deepEqual(found.out.get("800000"), { id: 3, how: "link", loaded: null });
});

test("reading uploads: any encoding, tab or semicolon separated, Excel sheets and .zip files; every other file kept as a document", async () => {
  const reader = require("../utils/migration/reader");
  const zlib = require("zlib");
  const ExcelJS = require("exceljs");
  const JSZip = require("jszip");
  assert.equal(reader.decode(Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from("Name\nJosé")])), "Name\nJosé");
  assert.equal(reader.decode(Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from("A\tB", "utf16le")])), "A\tB");
  assert.equal(reader.decode(Buffer.from("A\tB\nOne\tTwo", "utf16le")), "A\tB\nOne\tTwo", "UTF-16 without a byte-order mark");
  assert.equal(reader.decode(Buffer.from("Jos\xe9 N\xfa\xf1ez", "latin1")), "José Núñez", "Windows-1252");
  const [tsv] = await reader.expand("contacts.txt", Buffer.from("Student_Number\tFirst_Name\n900100\tAva\n"));
  assert.deepEqual([tsv.header, tsv.rowCount, tsv.sample[0].First_Name], [["Student_Number", "First_Name"], 1, "Ava"]);
  const [semi] = await reader.expand("x.csv", Buffer.from("A;B;C\n1;2;3\n"));
  assert.deepEqual(semi.header, ["A", "B", "C"]);
  const book = new ExcelJS.Workbook();
  const sheet = book.addWorksheet("Students");
  sheet.addRow(["Student_Number", "DOB", "GPA"]);
  sheet.addRow([900100, new Date(Date.UTC(2013, 5, 5)), { formula: "3+0.5", result: 3.5 }]);
  book.addWorksheet("Notes");
  const xlsx = Buffer.from(await book.xlsx.writeBuffer());
  const sheets = await reader.expand("book.xlsx", xlsx);
  assert.equal(sheets.length, 1, "an empty sheet is left out");
  assert.deepEqual([sheets[0].name, sheets[0].sample[0]], ["book.xlsx › Students", { Student_Number: "900100", DOB: "2013-06-05", GPA: "3.5" }]);
  const zip = new JSZip();
  zip.file("export/students.csv", "Student_Number,First_Name\n900100,Ava\n");
  zip.file("export/book.xlsx", xlsx);
  zip.file("__MACOSX/export/._students.csv", "x");
  zip.file("export/readme.pdf", "%PDF-1.4");
  const lists = await reader.expand("export.zip", await zip.generateAsync({ type: "nodebuffer" }));
  assert.deepEqual(lists.map((l) => l.name), ["export.zip › students.csv", "export.zip › book.xlsx › Students", "export.zip › readme.pdf"]);
  assert.deepEqual([lists[2].document, lists[2].path, lists[2].content.toString()], [true, "export/readme.pdf", "%PDF-1.4"], "any other file is kept as a document, with its folder");
  const oldExcel = (await reader.expand("old.xls", Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0, 0, 0, 0, 0])))[0];
  assert.ok(oldExcel.document && /save it as \.xlsx or CSV/.test(oldExcel.note), "an old .xls is kept, with how to import it as a list");
  assert.ok((await reader.expand("iep.pdf", Buffer.from("%PDF-1.7")))[0].document);
  assert.ok((await reader.expand("photo.jpg", Buffer.from([0xff, 0xd8, 0xff, 0])))[0].document);
  assert.match((await reader.expand("pic.csv", Buffer.from("\u0000\u0001binary,x\n1,2")))[0].error, /isn't a text or spreadsheet file/);
  // Rows come back as arrays in the same column order the upload recorded, repeated headings renamed alike.
  const text = "Student_Number,Name,Name,,Grade\n900100,Ava,Rivera,x,6\n";
  const [chunk] = [...reader.rowChunks(zlib.gzipSync(Buffer.from(text)), true)];
  assert.deepEqual(reader.parseText(text).header, ["Student_Number", "Name", "Name_1", "Grade"]);
  assert.deepEqual([chunk.header, chunk.rows], [["Student_Number", "Name", "Name_1", "", "Grade"], [["900100", "Ava", "Rivera", "x", "6"]]]);
});

test("a member of staff is inactive however the export words it", () => {
  const roles = require("../utils/migration/roles");
  for (const s of ["Active", "1", "A", "", "Current"]) assert.equal(roles.isActive(s), true, s);
  for (const s of ["0", "2", "I", "Inactive", "inactive", "Inactive (resigned 2026-06-05)", "Left school", "Terminated", "Resigned 2025", "Retired"]) assert.equal(roles.isActive(s), false, s);
});

test("lists are known by their name first: core lists load, the school's own field list becomes fields, everything else is kept", () => {
  const lists = require("../utils/migration/lists");
  const h = (s) => s.split(",");
  assert.equal(lists.recognize("x.zip › 05_students.csv", h("Student_Number,First_Name,Last_Name,DOB")).entity, "students");
  assert.equal(lists.recognize("06_parents_guardians_contacts.csv", h("ContactID,Student_Number,First_Name,Relationship")).entity, "guardians");
  assert.equal(lists.recognize("08_staff_roles_permissions.csv", h("TeacherNumber,Role,Security_Group")).entity, "staff_roles");
  assert.equal(lists.recognize("47_custom_fields.csv", h("Student_Number,LastFirst,Locker_Number")).entity, "student_details");
  for (const [name, cols] of [["55_alumni_graduates.csv", "Student_Number,First_Name,Last_Name,DOB"], ["13_current_grades_2026_27.csv", "Student_Number,Course_Name,Letter_Grade"],
    ["85_staff_attendance.csv", "TeacherNumber,First_Name,Date"], ["22_attendance_code_definitions.csv", "Code,Description"], ["49_early_dismissal_pickups.csv", "Student_Number,Relationship,Picked_Up_By"]]) {
    assert.equal(lists.recognize(name, h(cols)).entity, "other", name);
  }
  const kept = lists.recognize("108_suicide_risk_screenings.csv", h("Student_Number,Screening_Date,Result"));
  assert.ok(kept.restricted && kept.studentColumn === "Student_Number");
  assert.equal(lists.recognize("03_school_calendar_2026_27.csv", h("Date,Day_Type")).studentColumn, null, "a list with no student number is kept for the school");
});
