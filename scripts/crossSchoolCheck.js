#!/usr/bin/env node
// Cross-school access test: signs in as School A and tries to open School B's
// records by ID (students, reports, invoices, receipts, documents, tasks…).
// Every attempt must be refused or show none of School B's data.
//
// Usage: node scripts/crossSchoolCheck.js [baseUrl] [schoolA] [schoolB]
//   defaults: http://localhost:4000, 63 (Managira Int. School), 146
// Local servers only: it writes temporary sessions to user_sessions and
// deletes them when done. Read-only otherwise (GET requests only).
"use strict";

require("dotenv").config();
const db = require("../config/db");
const signature = require("cookie-signature");

const BASE = (process.argv[2] || "http://localhost:4000").replace(/\/$/, "");
const SCHOOL_A = Number(process.argv[3] || 63);
const SCHOOL_B = Number(process.argv[4] || 146);
const SESSION_PREFIX = "security-crossschool-check-";
const SECRET = process.env.SESSION_SECRET;

if (!/^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(BASE)) {
  console.error("Refusing to run: this test only runs against a local server.");
  process.exit(2);
}
if (!SECRET) {
  console.error("SESSION_SECRET is not set.");
  process.exit(2);
}

async function one(sql, params) {
  try {
    return (await db.query(sql, params)).rows[0] || null;
  } catch (_) {
    return null;
  }
}

async function makeSession(kind, sess) {
  const sid = `${SESSION_PREFIX}${kind}-${Date.now()}`;
  // user_sessions.expire has no time zone, so allow a wide margin; rows are deleted at the end.
  const expires = new Date(Date.now() + 48 * 60 * 60 * 1000);
  const cookie = { originalMaxAge: 3600000, expires: expires.toISOString(), httpOnly: true, path: "/" };
  await db.query(
    "INSERT INTO user_sessions (sid, sess, expire) VALUES ($1, $2, $3)",
    [sid, { cookie, lastActivity: Date.now(), ...sess }, expires]
  );
  return `connect.sid=${encodeURIComponent("s:" + signature.sign(sid, SECRET))}`;
}

// Words that would only appear if School B's record leaked.
function leakMarkers(...values) {
  return values.filter((v) => v && String(v).trim().length >= 4).map((v) => String(v).trim());
}

(async () => {
  const results = [];
  try {
    // ---- School A identities ----
    const orgA = await one("SELECT organization_id, organization_name, first_name, last_name, email, nickname, nickname_display, logo, font_style FROM organizations WHERE organization_id = $1", [SCHOOL_A]);
    const orgB = await one("SELECT organization_id, organization_name, nickname FROM organizations WHERE organization_id = $1", [SCHOOL_B]);
    if (!orgA || !orgB) throw new Error("School A or B not found.");

    const owner = await makeSession("owner", {
      organizationId: SCHOOL_A, organizationName: orgA.organization_name, firstName: orgA.first_name, lastName: orgA.last_name,
      accountType: "Organization", userRole: "Manager", orgNickName: orgA.nickname, orgNickNameDisplay: orgA.nickname_display || orgA.nickname,
      logo: orgA.logo, fontStyle: orgA.font_style,
      user: { user_id: SCHOOL_A, first_name: orgA.first_name, last_name: orgA.last_name, email: orgA.email, account_type: "Manager" },
    });
    const stA = await one("SELECT s.student_id, s.first_name, s.last_name FROM students s WHERE s.organization_id = $1 AND EXISTS (SELECT 1 FROM student_accounts sa WHERE sa.student_id = s.student_id) LIMIT 1", [SCHOOL_A]);
    const student = stA && await makeSession("student", {
      organizationId: SCHOOL_A, organizationName: orgA.organization_name, accountType: "Student", userRole: "Student",
      studentId: stA.student_id, firstName: stA.first_name, lastName: stA.last_name,
    });
    const gA = await one("SELECT gp.guardian_id, gp.first_name, gp.last_name FROM guardian_profiles gp JOIN guardian_accounts ga ON ga.guardian_id = gp.guardian_id WHERE gp.organization_id = $1 LIMIT 1", [SCHOOL_A]);
    const guardian = gA && await makeSession("guardian", {
      organizationId: SCHOOL_A, organizationName: orgA.organization_name, accountType: "Guardian", userRole: "Guardian",
      guardianId: gA.guardian_id, firstName: gA.first_name, lastName: gA.last_name,
      user: { user_id: null, first_name: gA.first_name, last_name: gA.last_name, account_type: "Guardian" },
    });

    // ---- School B records ----
    const stB = await one("SELECT student_id, first_name, last_name, class_id FROM students WHERE organization_id = $1 AND first_name IS NOT NULL ORDER BY student_id LIMIT 1", [SCHOOL_B]);
    const termB = await one("SELECT term_id, term_name FROM terms WHERE organization_id = $1 ORDER BY term_id DESC LIMIT 1", [SCHOOL_B]);
    const guardB = await one("SELECT guardian_id, first_name, last_name FROM guardian_profiles WHERE organization_id = $1 AND first_name IS NOT NULL LIMIT 1", [SCHOOL_B]);
    const pendB = await one("SELECT pending_id, first_name, last_name FROM pending_students WHERE organization_id = $1 LIMIT 1", [SCHOOL_B]);
    const docB = await one("SELECT document_id, title FROM documents WHERE organization_id = $1 LIMIT 1", [SCHOOL_B]);
    const billB = await one("SELECT assignment_id FROM finance_bill_assignments WHERE organization_id = $1 LIMIT 1", [SCHOOL_B]);
    const payB = await one("SELECT payment_id FROM finance_payments WHERE organization_id = $1 LIMIT 1", [SCHOOL_B]);
    const taskB = await one("SELECT task_id, title FROM org_tasks WHERE organization_id = $1 LIMIT 1", [SCHOOL_B]);
    const arrB = await one("SELECT report_id FROM finance_arrears_reports WHERE organization_id = $1 LIMIT 1", [SCHOOL_B]);
    const asmB = await one("SELECT assessment_id, title FROM assessments WHERE organization_id = $1 ORDER BY assessment_id DESC LIMIT 1", [SCHOOL_B]);

    const studentMarkers = stB ? leakMarkers(`${stB.first_name} ${stB.last_name}`) : [];
    const orgMarkers = leakMarkers(orgB.organization_name);

    const cases = [];
    const add = (who, cookie, label, path, markers) => { if (cookie && path) cases.push({ who, cookie, label, path, markers }); };
    // Controls: each test login must open its OWN school's pages, or the
    // "refused" results below would prove nothing.
    const controls = [];
    const stAOwn = await one("SELECT student_id, first_name, last_name FROM students WHERE organization_id = $1 AND first_name IS NOT NULL ORDER BY student_id LIMIT 1", [SCHOOL_A]);
    if (stAOwn) controls.push({ who: "owner", cookie: owner, label: "Control: own student profile opens", path: `/common/studentInfo?studentId=${stAOwn.student_id}`, expect: `${stAOwn.first_name}` });
    if (student) controls.push({ who: "student", cookie: student, label: "Control: own Testing Room opens", path: "/student/testing-room", expect: "Testing Room" });
    if (guardian) controls.push({ who: "guardian", cookie: guardian, label: "Control: own parent dashboard opens", path: "/guardian/dashboard", expect: gA.first_name || "" });

    add("owner", owner, "School ID in the address bar is ignored", `/common/orgDashboard?organizationId=${SCHOOL_B}`, orgMarkers);
    if (stB) {
      add("owner", owner, "Other school's student profile", `/common/studentInfo?studentId=${stB.student_id}`, studentMarkers);
      add("owner", owner, "Other school's student details", `/common/studentDetails?studentId=${stB.student_id}&classId=${stB.class_id || ""}&termId=${termB ? termB.term_id : ""}`, studentMarkers);
      add("owner", owner, "Other school's report card", `/print/printStudentReport?studentId=${stB.student_id}&classId=${stB.class_id || ""}&termId=${termB ? termB.term_id : ""}`, studentMarkers);
      add("owner", owner, "Other school's student finance", `/account/settings/finance/students/${stB.student_id}/detail.json`, studentMarkers);
      add("owner", owner, "Other school's transcript", `/transcript/transcript/${stB.student_id}`, studentMarkers);
    }
    if (termB) add("owner", owner, "Other school's term", `/common/termDetails/${termB.term_id}`, leakMarkers(termB.term_name).concat(orgMarkers));
    if (guardB) add("owner", owner, "Other school's parent", `/common/guardianDetails?guardianId=${guardB.guardian_id}`, leakMarkers(`${guardB.first_name} ${guardB.last_name}`));
    if (pendB) add("owner", owner, "Other school's admission", `/common/getPendingStudentDetails/${pendB.pending_id}`, leakMarkers(`${pendB.first_name} ${pendB.last_name}`));
    if (docB) {
      add("owner", owner, "Other school's document (edit)", `/documents/edit/${docB.document_id}`, leakMarkers(docB.title));
      add("owner", owner, "Other school's document (content)", `/documents/content/${docB.document_id}`, leakMarkers(docB.title));
    }
    if (billB) add("owner", owner, "Other school's invoice", `/account/settings/finance/invoice/${billB.assignment_id}`, studentMarkers.concat(orgMarkers));
    if (payB) add("owner", owner, "Other school's receipt", `/account/settings/finance/receipt/${payB.payment_id}`, studentMarkers.concat(orgMarkers));
    if (arrB) add("owner", owner, "Other school's arrears report", `/account/settings/finance/arrears/reports/${arrB.report_id}/view`, orgMarkers);
    if (taskB) add("owner", owner, "Other school's task comments", `/common/tasks/${taskB.task_id}/comments`, leakMarkers(taskB.title));
    add("owner", owner, "Other school's uploaded file", `/print/preview/${encodeURIComponent(`migrations/org_${SCHOOL_B}/x.pdf`)}`, []);
    if (asmB) {
      add("student", student, "Student opens other school's test", `/student/testing-room/${asmB.assessment_id}`, leakMarkers(asmB.title));
      add("owner", owner, "Other school's question sets", `/common/assessment/questions?assessmentId=${asmB.assessment_id}`, leakMarkers(asmB.title));
    }
    if (stB) {
      add("guardian", guardian, "Parent opens other school's child report", `/guardian/reports/${stB.student_id}`, studentMarkers);
      add("guardian", guardian, "Parent opens other school's report PDF", `/guardian/student-report-cards/${stB.student_id}/pdf`, studentMarkers);
    }

    // A wrong password must never sign anyone in (staff, owner).
    const wrongPasswordAccounts = [];
    const staffA = await one("SELECT email FROM users WHERE organization_id = $1 AND password IS NOT NULL AND email IS NOT NULL AND account_type NOT IN ('Admin','Mini Admin','Internal Worker') ORDER BY user_id LIMIT 1", [SCHOOL_A]);
    if (staffA) wrongPasswordAccounts.push({ label: "Wrong password: staff not signed in", email: staffA.email });
    if (orgA.email) wrongPasswordAccounts.push({ label: "Wrong password: owner not signed in", email: orgA.email });
    for (const w of wrongPasswordAccounts) {
      let jar = "";
      const keep = (r) => { const c = r.headers.get("set-cookie"); if (c) jar = c.split(";")[0]; };
      const login = await fetch(BASE + "/account/login", {
        method: "POST", redirect: "manual",
        headers: { "content-type": "application/x-www-form-urlencoded", origin: BASE },
        body: new URLSearchParams({ email: w.email, password: `wrong-${Date.now()}` }).toString(),
      });
      keep(login);
      const after = await fetch(BASE + "/common/orgDashboard", { headers: { cookie: jar, accept: "text/html" }, redirect: "manual" });
      const location = after.headers.get("location") || "";
      const ok = after.status >= 300 && after.status < 400 && /\/account\/login/.test(location);
      results.push({ who: "anyone", label: w.label, path: "/account/login", status: after.status, location, leaked: null, ok });
    }

    for (const c of controls) {
      let status = 0;
      let body = "";
      try {
        const r = await fetch(BASE + c.path, { headers: { cookie: c.cookie, accept: "text/html" }, redirect: "manual" });
        status = r.status;
        body = await r.text();
      } catch (_) {
        status = -1;
      }
      const ok = status === 200 && (!c.expect || body.includes(c.expect));
      results.push({ ...c, status, location: "", leaked: null, ok, control: true });
      if (c.who === "owner" && status === 200) {
        // Private pages must never be stored by the browser.
        const r = await fetch(BASE + c.path, { headers: { cookie: c.cookie, accept: "text/html" }, redirect: "manual" });
        const cacheControl = r.headers.get("cache-control") || "";
        results.push({ who: "owner", label: "Signed-in page is never cached", path: c.path, status: r.status, location: cacheControl, leaked: null, ok: /no-store/.test(cacheControl) });
      }
    }

    for (const c of cases) {
      let status = 0;
      let body = "";
      let location = "";
      try {
        const r = await fetch(BASE + c.path, { headers: { cookie: c.cookie, accept: "text/html,application/json" }, redirect: "manual" });
        status = r.status;
        location = r.headers.get("location") || "";
        body = await r.text();
      } catch (error) {
        body = "";
        status = -1;
      }
      const leaked = c.markers.find((m) => body.toLowerCase().includes(m.toLowerCase()));
      results.push({ ...c, status, location, leaked, ok: !leaked && status !== -1 });
    }
  } finally {
    await db.query("DELETE FROM user_sessions WHERE sid LIKE $1", [`${SESSION_PREFIX}%`]).catch(() => {});
  }

  let failed = 0;
  console.log(`Signed in as school ${SCHOOL_A}, trying school ${SCHOOL_B}'s records:\n`);
  for (const r of results) {
    if (!r.ok) failed += 1;
    const outcome = r.status >= 300 && r.status < 400 ? `${r.status} → ${r.location.slice(0, 40)}` : String(r.status);
    console.log(`${r.ok ? "PASS" : "FAIL"}  [${r.who}] ${r.label.padEnd(44)} ${outcome}${r.leaked ? `  LEAKED "${r.leaked}"` : ""}`);
  }
  console.log(`\n${results.length - failed}/${results.length} passed against ${BASE}`);
  await db.end();
  process.exit(failed ? 1 : 0);
})().catch(async (error) => {
  console.error("Cross-school check could not run:", error.message);
  await db.query("DELETE FROM user_sessions WHERE sid LIKE $1", [`${SESSION_PREFIX}%`]).catch(() => {});
  process.exit(2);
});
