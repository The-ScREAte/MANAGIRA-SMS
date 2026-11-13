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

test("the other apps a school ran are found from its lists' names, never from records of counseling or safety", () => {
  const { appsFrom } = require("../utils/migration/apps");
  const names = ["146_cafeteria_transactions_2025_26.csv", "148_library_checkouts_2019_2026.csv", "150_nurse_visits_history_2019_2026.csv", "118_medicaid_billing_claims.csv",
    "139_online_payment_transactions.csv", "214_bus_routes_master.csv", "business_office_contacts.csv", "108_suicide_risk_screenings.csv", "107_threat_assessments.csv", "142_device_management_mdm.csv"];
  const apps = appsFrom(names.map((name) => ({ name, label: name, rows: 10 })), { areaLabels: { students: "Students", classes: "Classes & subjects", staff: "Staff" } });
  const by = Object.fromEntries(apps.map((a) => [a.key, a]));
  assert.deepEqual(Object.keys(by).sort(), ["devices", "fees", "food", "health", "library", "special", "transport"]);
  assert.deepEqual(by.transport.lists, ["214_bus_routes_master.csv"], "a business office isn't a bus");
  assert.deepEqual(by.special.lists, ["118_medicaid_billing_claims.csv"], "Medicaid billing is special education, not fees");
  assert.deepEqual(by.health.lists, ["150_nurse_visits_history_2019_2026.csv"], "a suicide risk screening is a restricted record, not a health app");
  assert.ok(by.transport.has && by.fees.has && !by.library.has && !by.food.has);
  assert.deepEqual(by.library.connectLabels, ["Students", "Classes & subjects", "Staff"]);
  assert.deepEqual(appsFrom([]), []);
});

test("a school's own role: only real permissions the person may give, and a migration role keeps exactly its permissions", () => {
  const schoolRoles = require("../utils/schoolRoles");
  const { PERMISSIONS: P, HIGH_RISK_PERMISSIONS } = require("../middleware/permissionMiddleware");
  const highRisk = [...HIGH_RISK_PERMISSIONS][0];
  assert.deepEqual(schoolRoles.keep([P.MANAGE_STUDENTS, "not_a_permission", highRisk, P.MANAGE_STUDENTS]), [P.MANAGE_STUDENTS]);
  assert.deepEqual(schoolRoles.keep([P.MANAGE_STUDENTS, highRisk], { highRisk: true }).sort(), [P.MANAGE_STUDENTS, highRisk].sort());
  assert.deepEqual(schoolRoles.keep([P.MANAGE_STUDENTS, P.MARK_ATTENDANCE], { allowed: new Set([P.MARK_ATTENDANCE]) }), [P.MARK_ATTENDANCE], "outside the plan is left out");
  assert.ok(schoolRoles.defaultsFor("Teacher", 1).includes(P.MANAGE_STUDENTS));
  const roles = require("../utils/migration/roles");
  const own = roles.choiceOf({ target: "custom", label: "Food Service", account_type: "Teacher", permissions: [P.MANAGE_STUDENTS, P.STUDENTS_EDIT], school_role_id: 7 });
  assert.equal(own.schoolRoleId, 7);
  assert.deepEqual(own.permissions, [P.MANAGE_STUDENTS, P.STUDENTS_EDIT], "a school role gives exactly what it gives, no follow-ups added");
  assert.ok(roles.compare(null, own).up.length, "an old role nobody matched still needs approval person by person");
  const made = roles.choiceOf({ target: "custom", label: "Food Service", account_type: "Teacher", permissions: [P.MANAGE_STUDENTS] });
  assert.equal(made.schoolRoleId, undefined);
});

test("lists that fit a Managira feature are recognised by their columns; logs and summaries stay history", () => {
  const f = require("../utils/migration/features");
  const h = (line) => line.split(",");
  assert.equal(f.featureOf("55_alumni_graduates.csv", h("Student_Number,Last_Name,First_Name,DOB,Gender,Graduation_Year,Graduation_Date,Diploma_Type,Final_GPA_Unweighted")), "graduates");
  assert.equal(f.featureOf("56_alumni_transcripts.csv", h("Student_Number,LastFirst,School_Year,Course_Name,Letter_Grade,Percent")), "graduate_transcripts");
  assert.equal(f.featureOf("214_bus_routes_master.csv", h("Route_ID,Bus_Number,Driver_Name,Depot,Route_Type")), "bus_routes");
  assert.equal(f.featureOf("215_bus_stops_master.csv", h("Stop_ID,Route_ID,Sequence,Stop_Location,Am_Time,Pm_Time")), "bus_stops");
  assert.equal(f.featureOf("216_route_runs_schedule.csv", h("Run_ID,Route_ID,Bus_Number,Run_Type,Departure_Time")), "bus_runs");
  assert.equal(f.featureOf("217_student_transportation_assignments.csv", h("Student_Number,Run_ID,Route_ID,Stop_ID,Days,End_Date")), "bus_riders");
  assert.equal(f.featureOf("bus_rider_assignments.csv", h("Other ID,Student Name,Route ID,Bus Number,Stop ID")), "bus_riders", "Skyward's Other ID is a student number");
  assert.equal(f.featureOf("31_student_fees.csv", h("Fee_ID,Student_Number,Fee_Code,Description,Amount,Balance")), "fees");
  assert.equal(f.featureOf("33_cafeteria_meal_accounts.csv", h("Meal_Account_Number,Student_Number,Current_Balance")), "meal_balances");
  assert.equal(f.featureOf("201_parent_guardian_master.csv", h("ContactID,Last_Name,First_Name,Primary_Email,Mobile_Phone")), "parents_master");
  assert.equal(f.featureOf("38_bus_ridership_history.csv", h("Student_Number,Route_ID,Bus_Number,Run,Event,Scan_Time,Stop_ID")), null, "a scan log is history");
  assert.equal(f.featureOf("90_bus_fleet_maintenance.csv", h("Bus_Number,Route_ID,Service_Date,Odometer,Service_Type,Cost")), null, "a maintenance log is history");
  assert.equal(f.featureOf("D16_district_transportation_summary.csv", h("Route_ID,Bus_Number,Riders")), null, "a summary isn't the data");
  assert.equal(f.pick({ Fee_Code: "LAB", Description: "Lab fee" }, "Description", "Fee_Code"), "Lab fee", "the first name asked for wins, not the first column");
  assert.deepEqual(f.daysOf("Mon-Fri"), ["monday", "tuesday", "wednesday", "thursday", "friday"]);
  assert.deepEqual(f.daysOf("Thu, Fri"), ["thursday", "friday"]);
  assert.equal(f.timeOf("3:10 PM"), "15:10");
  assert.equal(f.addMinutes("07:05", 38), "07:43");
});

test("programs and indicators fill the school's own staff-only fields; race and IDs never become one", () => {
  const fields = require("../utils/studentFormFields");
  const label = (c) => (fields.indicatorFor(c) || {}).label || null;
  assert.equal(label("IEP"), "IEP");
  assert.equal(label("Section_504"), "Section 504 plan");
  assert.equal(label("English_Learner"), "English learner");
  assert.equal(label("Gifted"), "Gifted & talented");
  assert.equal(label("Meal_Eligibility"), "Meal eligibility");
  assert.equal(label("Military_Family"), "Military family");
  assert.equal(label("Military_Recruiter_Opt_Out"), null);
  assert.equal(label("Race"), null);
  assert.ok(fields.SECTIONS.programs, "Programs & Indicators is a section of the student form");
  const ps = require("../utils/migration/powerschool");
  assert.equal(ps.sensitiveOf("Race", []), "demographics");
  assert.equal(ps.sensitiveOf("Military_Family", []), "programs");
  assert.equal(ps.matchColumn("students", "Graduation_Year").target, "graduation_year");
});

test("every system's lists: students by Skyward's Other ID, Blackbaud's User ID or Veracross's person_id; look-alikes stay kept", () => {
  const lists = require("../utils/migration/lists");
  const h = (s) => s.split(",");
  const profile = lists.recognize("001_Student_Profile.csv", h("Name-ID,Other ID,State ID (SSID),Last Name,First Name,Birth Date,Grade"));
  assert.equal(profile.entity, "students");
  assert.equal(profile.studentColumn, "Other ID", "Other ID before Name-ID");
  assert.equal(lists.recognize("05_students.csv", h("User ID,Host ID,Last Name,First Name,Birth Date,Grade")).entity, "students");
  assert.equal(lists.recognize("05_students.csv", h("person_id,state_id,last_name,first_name,birthday,grade")).entity, "students");
  assert.equal(lists.recognize("060_Staff_Profiles.csv", h("Staff Name-ID,Employee ID,Name,Title,Email,Security Group")).entity, "staff", "a staff list named in one column");
  assert.equal(lists.recognize("234_Teaching_Credentials_Endorsements.csv", h("Employee ID,Name,License No,License Type")).entity, "other", "credentials aren't the staff list");
  assert.equal(lists.recognize("003_Family_Guardian_Profile.csv", h("Guardian ID,Last Name,First Name,Relationship,Family ID,Cell Phone,Primary Email")).entity, "guardians", "a parents list on its own");
  assert.equal(lists.recognize("020_Section_Master.csv", h("Section Key,Course ID,Description,Primary Teacher")).entity, "classes");
  for (const [name, cols] of [["095_Perfect_Attendance_Awards.csv", "Other ID,Student Name,Period,Absences,Tardies"], ["148_Practice_Game_Attendance.csv", "Other ID,Team,Date,Event,Attended"],
    ["054_Parent_Bus_Tracking_Links.csv", "Other ID,Guardian ID,App,Token"], ["126_Seating_Charts.csv", "Section Key,Class,Name-ID,Row,Seat"], ["193_AI_Tutor_Transcripts.csv", "Other ID,Timestamp,Prompt"],
    ["088_Class_Rank_Snapshots.csv", "Other ID,Snapshot,Rank,Weighted GPA At Snapshot"], ["205_parent_contact_methods.csv", "ContactID,Contact_Name,Method_Type,Value"]]) {
    assert.equal(lists.recognize(name, h(cols)).entity, "other", name);
  }
  assert.equal(lists.RESTRICTED.test(lists.baseName("073_Bell_Schedules.csv")), false, "a short word (ELL) never matches inside another (bell)");
  assert.equal(lists.RESTRICTED.test(lists.baseName("112_ELL_Assessment_History.csv")), true);
});

test("best matches: a Mark is the final grade and the Grade beside it the grade level; a parent's cell phone before their home phone", () => {
  const grades = ps.bestMatches("grades", ["Other ID", "Grade", "Course Description", "Mark", "GPA Pts", "Weighted Pts", "Credit Earned"]);
  assert.equal(grades.get("Mark"), "grade");
  assert.equal(grades.get("Grade"), "grade_level");
  assert.equal(grades.get("Other ID"), "student_source_id");
  assert.equal(grades.get("Weighted Pts"), "gpa_weighted_points");
  const ps2 = ps.bestMatches("grades", ["Student_Number", "Grade", "Grade_Level", "Course_Name"]);
  assert.equal(ps2.get("Grade"), "grade", "PowerSchool's Grade stays the grade");
  const parents = ps.bestMatches("guardians", ["Guardian ID", "Home Phone", "Cell Phone", "Primary Email"]);
  assert.equal(parents.get("Cell Phone"), "phone");
  assert.equal(parents.get("Home Phone"), undefined);
  assert.equal(ps.bestMatches("classes", ["SectionNumber", "ClassName"]).get("SectionNumber"), "source_id", "Aeries' section number is the section's ID");
});

test("attendance: the school's own codes decide, and a day counts once however many period rows it has", () => {
  const codes = { unx: "absent", med: "excused", tdy: "tardy", ed: "present" };
  assert.equal(ps.attendanceKind("MED", null, codes), "excused");
  assert.equal(ps.attendanceKind("A", null, codes), "absent", "codes it doesn't list still read as before");
  const sum = { present: 0, absent: 0, excused: 0, tardy: 0 };
  const days = new Map();
  const add = (d) => migration.addAttendance(sum, { student_source_id: "1", ...d }, { codes, days });
  add({ date: "2026-09-15", period: "01", code: "UNX" });
  add({ date: "2026-09-15", period: "05", code: "UNX" });
  add({ date: "2026-09-16", period: "ALL DAY", code: "MED" });
  add({ date: "2026-09-16", period: "03", code: "UNX" });
  add({ date: "2026-09-17", period: "02", code: "TDY" });
  assert.deepEqual(sum, { present: 2, absent: 1, excused: 1, tardy: 1 });
});

test("a yes / no field from a status: active is yes; not, exited and monitored are no", () => {
  for (const v of ["Y", "Yes", "Active EL", "Eligible", "Current"]) assert.equal(migration.fieldValueAs("yes_no", v), "yes", v);
  for (const v of ["N", "Not EL", "Exited 2025", "Monitored", "Never", "Inactive"]) assert.equal(migration.fieldValueAs("yes_no", v), "no", v);
});

test("a kept list reaches its students by whichever column names them: a student's other number, a parent's, a family's", () => {
  const reach = { primary: new Set(["31000", "31007"]), aliases: new Map([["YODERADA000", "31000"]]), contacts: new Map([["G1", new Set(["31000", "31007"])]]), families: new Map([["F1", new Set(["31007"])]]) };
  const byName = migration.reachOf(["Visit", "Student Name-ID"], [["V1", "YODERADA000"], ["V2", "YODERADA000"]], null, reach);
  assert.equal(byName.kind, "student");
  assert.deepEqual(byName.studentsOf(["V1", "YODERADA000"]), ["31000"]);
  const byParent = migration.reachOf(["Guardian ID", "Language"], [["G1", "Spanish"], ["G1", "Spanish"]], null, reach);
  assert.equal(byParent.kind, "parent");
  assert.deepEqual(byParent.studentsOf(["G1", "Spanish"]).sort(), ["31000", "31007"]);
  assert.equal(migration.reachOf(["Family ID", "Size"], [["F1", "4"], ["F1", "4"]], null, reach).kind, "family");
  assert.equal(migration.reachOf(["Bus", "Speed"], [["14", "25"], ["14", "30"]], null, reach).kind, "none", "a bus's log reaches nobody");
});

test("lists kept by hand become forms the school keeps using; logs, family lists and the document index stay history", () => {
  const forms = require("../utils/migration/forms");
  const base = { perStudent: true, students: 40, people: 20, via: "student", columns: 6, header: ["Other ID", "Date", "Hours"] };
  assert.equal(forms.suggest({ ...base, label: "Community service hours", name: "153_Community_Service_Hours.csv" }).use, "form");
  assert.equal(forms.suggest({ ...base, label: "Meal transactions itemized", name: "038_Meal_Transactions_Itemized.csv" }).use, "history");
  assert.equal(forms.suggest({ ...base, label: "Bus pass scans", name: "x.csv", header: ["Other ID", "Latitude", "Longitude"] }).use, "history");
  assert.equal(forms.suggest({ ...base, label: "Communication preferences", name: "x.csv", via: "parent" }).use, "history");
  assert.equal(forms.offered({ ...base, label: "Document index", name: "308_Document_Index.csv" }), false);
  const nurse = forms.suggest({ ...base, label: "Nurse visit log", name: "029_Nurse_Visit_Log.csv", restricted: true });
  assert.ok(nurse.use === "history" && !nurse.fixed, "a restricted list is offered, not suggested");
  assert.equal(forms.typeOf(["2", "3.5", "10"], migration.isoDate), "number");
  assert.equal(forms.typeOf(["09/20/2026", "10/11/2026"], migration.isoDate), "date");
  assert.equal(forms.typeOf(["Y", "N"], migration.isoDate), "yesno");
  assert.equal(forms.typeOf(["0123", "0456"], migration.isoDate), "text", "codes with a leading zero stay text");
  const cf = require("../utils/customForms");
  const rows = [{ "Other ID": "1", "Student Name": "Yoder, Adam", Date: "09/20/2026", Hours: "2", Combination: "10-20-30" }];
  const { section, dateField, secret } = forms.sectionFor({ label: "Locker and service", keyColumn: "Other ID" }, rows, { isoDate: migration.isoDate, normalizeSection: cf.normalizeSection });
  assert.deepEqual(section.fields.map((f) => f.label), ["Date", "Hours"], "the student's own columns and codes never show on the form");
  assert.deepEqual(secret, ["Combination"]);
  const entry = forms.entryFor(section, rows[0], migration.isoDate);
  assert.equal(entry[dateField], "2026-09-20");
  assert.equal(Object.values(entry).includes(2), true);
  assert.equal(cf.normalizeSection({ ...section, origin: section.origin }).origin.list, "Locker and service", "the origin survives every save");
  assert.equal(forms.topicOf("Nurse visit log"), "Health");
  assert.equal(forms.topicOf("Locker assignments"), "Library & devices");
});
