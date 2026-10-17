"use strict";

// Setup steps: what a school still has to set up, checked from its real data.
// A step is crossed out as soon as it's done. Required steps can only be
// crossed out by doing them; optional ones can also be skipped. The list
// disappears once every required step is done and every optional one is done
// or skipped.

const hub = (base, panel, page, label) =>
  `${base}?panel=${encodeURIComponent(panel)}&page=${encodeURIComponent(page)}&label=${encodeURIComponent(label)}`;
const management = (panel, page, label) => hub("/common/management", panel, page, label);
const admissions = (panel, page, label) => hub("/common/admissions", panel, page, label);
const reports = (panel, page, label) => hub("/common/reports", panel, page, label);

const norm = (v) => String(v || "").trim().toLowerCase();
const hasFeature = (features, names) => features.some((f) => names.includes(norm(f)));
const WEBSITE = ["school website", "schoolwebsite", "public dashboard", "school public dashboard"];
const PAYGIRA = ["paygira", "pay gira", "paygira & payments", "paygira and payments"];

// Each check gets (db, ctx) where ctx = { organizationId, termId } and
// returns true when the step is done.
const STEPS = [
  {
    key: "school-details",
    required: true,
    title: "Add your school's logo and contact details",
    hint: "Shown on report cards, receipts and the school website.",
    href: "/account/settings?section=customize",
    sql: `SELECT (NULLIF(TRIM(COALESCE(logo, logo_path, '')), '') IS NOT NULL
                  AND (NULLIF(TRIM(COALESCE(organization_phone, '')), '') IS NOT NULL
                       OR NULLIF(TRIM(COALESCE(organization_address, '')), '') IS NOT NULL)) AS done
            FROM organizations WHERE organization_id = $1`,
  },
  {
    key: "school-year",
    required: true,
    title: "Create the school year and its current term",
    hint: "Everything (classes, scores, attendance, fees) belongs to a term.",
    href: management("school-year", "/common/manageRecords", "School Years"),
    sql: `SELECT EXISTS (SELECT 1 FROM school_years sy JOIN terms t ON t.school_year_id = sy.id
                          WHERE sy.organization_id = $1 AND sy.current AND t.current) AS done`,
  },
  {
    key: "classes",
    required: true,
    title: "Add your classes",
    hint: "Grade 1, JHS 2… each class gets its own dashboard.",
    href: management("graduation", "/common/manageClassSubjectAndGradYr", "Classes, Subjects & Grad Years"),
    sql: `SELECT EXISTS (SELECT 1 FROM classes WHERE organization_id = $1 AND obsolete_at IS NULL) AS done`,
  },
  {
    key: "subjects",
    required: true,
    title: "Add subjects to your classes",
    hint: "Subjects are what scores and report cards are built on.",
    href: management("graduation", "/common/manageClassSubjectAndGradYr", "Classes, Subjects & Grad Years"),
    sql: `SELECT EXISTS (SELECT 1 FROM subjects WHERE organization_id = $1 AND obsolete_at IS NULL) AS done`,
  },
  {
    key: "term-classes",
    required: true,
    title: "Put your classes into the current term",
    hint: "Only classes in the term show on the dashboard.",
    href: management("enrollment", "/enrollment/manageEnrollment", "Enrollment"),
    needsTerm: true,
    sql: `SELECT EXISTS (SELECT 1 FROM enrolled_classes ec JOIN enrollments e ON e.enrollment_id = ec.enrollment_id
                          WHERE e.organization_id = $1 AND e.term_id = $2) AS done`,
  },
  {
    key: "students",
    required: true,
    title: "Add your students",
    hint: "One by one, or import them all from a spreadsheet.",
    href: admissions("create-student", "/common/addStudent", "Add New Student"),
    sql: `SELECT EXISTS (SELECT 1 FROM students WHERE organization_id = $1) AS done`,
  },
  {
    key: "assessments",
    required: true,
    title: "Set up this term's assessments",
    hint: "Class work, tests and exams, with how much each one counts.",
    href: management("assessment-scores", "/common/manageAssessment", "Assessments"),
    needsTerm: true,
    sql: `SELECT EXISTS (SELECT 1 FROM assessments WHERE organization_id = $1 AND term_id = $2 AND obsolete_at IS NULL) AS done`,
  },
  {
    key: "grading",
    required: true,
    title: "Set the grading scale for report cards",
    hint: "Which score earns which grade and remark (A, B, Excellent…).",
    href: reports("report-settings", "/print/reportSettings", "Report Settings"),
    needsTerm: true,
    sql: `SELECT EXISTS (SELECT 1 FROM score_remarks WHERE organization_id = $1 AND term_id = $2) AS done`,
  },
  {
    key: "staff",
    required: false,
    title: "Invite your teachers and staff",
    hint: "Each person signs in with their own account and permissions.",
    href: management("employees", "/common/manageEmployees", "Users / Employees"),
    sql: `SELECT (SELECT COUNT(*) FROM users WHERE organization_id = $1) > 1 AS done`,
  },
  {
    key: "calendar",
    required: false,
    title: "Set the school calendar",
    hint: "Weekends and holidays, so attendance counts the right days.",
    href: "/account/settings?section=customize",
    sql: `SELECT EXISTS (SELECT 1 FROM organization_attendance_calendars WHERE organization_id = $1) AS done`,
  },
  {
    key: "signature",
    required: false,
    title: "Add a signature for report cards",
    hint: "The head's signature printed on every report card.",
    href: reports("report-settings", "/print/reportSettings", "Report Settings"),
    needsTerm: true,
    sql: `SELECT EXISTS (SELECT 1 FROM report_settings WHERE organization_id = $1 AND term_id = $2
                          AND NULLIF(signature_image_path, '') IS NOT NULL) AS done`,
  },
  {
    key: "promotion",
    required: false,
    title: "Set promotion rules",
    hint: "The pass mark and which class each class moves up to.",
    href: reports("report-settings", "/print/reportSettings", "Report Settings"),
    needsTerm: true,
    sql: `SELECT EXISTS (SELECT 1 FROM status_settings WHERE organization_id = $1 AND term_id = $2) AS done`,
  },
  {
    key: "guardians",
    required: false,
    title: "Invite parents and guardians",
    hint: "They see report cards, attendance and fees in their own portal.",
    href: management("guardians", "/common/guardians", "Guardians"),
    sql: `SELECT EXISTS (SELECT 1 FROM guardian_accounts WHERE organization_id = $1) AS done`,
  },
  {
    key: "fees",
    required: false,
    feature: PAYGIRA,
    title: "Set up school fees",
    hint: "Fee items and bills, so parents can pay and you can track it.",
    href: "/account/settings/finance",
    sql: `SELECT (EXISTS (SELECT 1 FROM finance_fee_templates WHERE organization_id = $1)
                  OR EXISTS (SELECT 1 FROM finance_bills WHERE organization_id = $1)) AS done`,
  },
  {
    key: "website",
    required: false,
    feature: WEBSITE,
    title: "Set up the school website",
    hint: "Photos, news and your school's details for the public.",
    href: management("public-website", "/account/managePublicContent", "School Website"),
    sql: `SELECT (EXISTS (SELECT 1 FROM organization_images WHERE organization_id = $1)
                  OR EXISTS (SELECT 1 FROM organization_website_settings WHERE organization_id = $1 AND settings <> '{}'::jsonb)) AS done`,
  },
  {
    key: "online-admissions",
    required: false,
    feature: WEBSITE,
    title: "Open online admissions",
    hint: "Let families apply from your website; you review them in Admissions → Online Admission.",
    href: admissions("online-admission-settings", "/account/managePublicContent?focus=registration", "Online admission settings"),
    sql: `SELECT COALESCE(public_registration_enabled, FALSE) AS done FROM organizations WHERE organization_id = $1`,
  },
];

// Who sees the setup steps: the school's own account, its managers, Managira
// admins looking after the school, and hub users. Never teachers or
// supervisors, whatever permissions they were given.
function canSeeSetupSteps(session) {
  if (!session || !session.organizationId) return false;
  if (session.superAdminOrgSwitch || session.hubOrgSwitch || session.hubId) return true;
  const kind = String(session.accountType || "").trim().toLowerCase();
  if (kind === "organization") return true;
  const role = String(session.userRole || (session.user && session.user.account_type) || "").trim().toLowerCase();
  return ["manager", "admin", "mini admin"].includes(role);
}

let ready = null;
function ensureSetupSchema(db) {
  if (!ready) {
    ready = db.query(`
      CREATE TABLE IF NOT EXISTS organization_setup_skips (
        organization_id INTEGER NOT NULL,
        step_key TEXT NOT NULL,
        skipped_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        skipped_by INTEGER,
        PRIMARY KEY (organization_id, step_key)
      )
    `).catch((err) => { ready = null; throw err; });
  }
  return ready;
}

const cache = new Map(); // organizationId -> { at, value }
const TTL_MS = 30 * 1000;

function forget(organizationId) {
  cache.delete(String(organizationId));
}

async function currentTermId(db, organizationId) {
  const { rows } = await db.query(
    `SELECT t.term_id FROM terms t JOIN school_years sy ON sy.id = t.school_year_id
      WHERE sy.organization_id = $1 AND sy.current AND t.current
      ORDER BY t.start_date DESC NULLS LAST LIMIT 1`,
    [organizationId]
  );
  return rows[0] ? rows[0].term_id : null;
}

/**
 * The school's setup steps with done/skipped state.
 * features: the school's plan features (res.locals.allowedFeatures).
 */
async function getSetupChecklist(db, organizationId, features = []) {
  const key = String(organizationId);
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < TTL_MS) return hit.value;

  await ensureSetupSchema(db);
  const [termId, skips] = await Promise.all([
    currentTermId(db, organizationId),
    db.query("SELECT step_key FROM organization_setup_skips WHERE organization_id = $1", [organizationId]),
  ]);
  const skipped = new Set(skips.rows.map((r) => r.step_key));
  const list = Array.isArray(features) ? features : [];

  const steps = [];
  for (const step of STEPS) {
    if (step.feature && !hasFeature(list, step.feature)) continue;
    let done = false;
    if (!step.needsTerm || termId) {
      try {
        const { rows } = await db.query(step.sql, step.needsTerm ? [organizationId, termId] : [organizationId]);
        done = Boolean(rows[0] && rows[0].done);
      } catch (error) {
        // A table the school doesn't use yet: not done.
        done = false;
      }
    }
    steps.push({
      key: step.key,
      title: step.title,
      hint: step.hint,
      href: step.href,
      required: step.required,
      done,
      skipped: !done && !step.required && skipped.has(step.key),
    });
  }
  const requiredLeft = steps.filter((s) => s.required && !s.done).length;
  const optionalLeft = steps.filter((s) => !s.required && !s.done && !s.skipped).length;
  const value = {
    steps,
    total: steps.length,
    finished: steps.filter((s) => s.done || s.skipped).length,
    requiredLeft,
    optionalLeft,
    complete: requiredLeft === 0 && optionalLeft === 0,
  };
  cache.set(key, { at: Date.now(), value });
  return value;
}

// Optional steps only: a required step can't be skipped.
async function setStepSkipped(db, organizationId, stepKey, skip, userId) {
  const step = STEPS.find((s) => s.key === stepKey);
  if (!step) return { ok: false, status: 404, message: "That setup step doesn't exist." };
  if (step.required) return { ok: false, status: 409, message: "This step is required. It's crossed out once it's done." };
  await ensureSetupSchema(db);
  if (skip) {
    await db.query(
      `INSERT INTO organization_setup_skips (organization_id, step_key, skipped_by) VALUES ($1, $2, $3)
       ON CONFLICT (organization_id, step_key) DO NOTHING`,
      [organizationId, stepKey, Number.isInteger(Number(userId)) ? Number(userId) : null]
    );
  } else {
    await db.query("DELETE FROM organization_setup_skips WHERE organization_id = $1 AND step_key = $2", [organizationId, stepKey]);
  }
  forget(organizationId);
  return { ok: true, status: 200 };
}

module.exports = { STEPS, canSeeSetupSteps, ensureSetupSchema, getSetupChecklist, setStepSkipped, forget };
