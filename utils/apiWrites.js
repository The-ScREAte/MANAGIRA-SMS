"use strict";

// What an integration can send in through the Managira API (routes/publicApiRoute.js): new and
// changed students and parents, attendance marks, scores and payments. Each one needs its own
// write scope, stays inside the token's school, is checked field by field before anything is
// written, and goes in the school's activity log as done by the service account.
//
// Attendance and scores go through the same code the pages use (saveSingleAttendance and
// saveAllScores), so locks, the term calendar, totals, positions and the teacher's approval
// before families see a score all apply exactly as they do on screen.
const db = require("../config/db");
const { logOrganizationActivity } = require("./activityLog");

class ApiInputError extends Error {
  constructor(status, error, message) {
    super(message);
    this.status = status;
    this.error = error;
  }
}
const bad = (message) => new ApiInputError(400, "invalid_request", message);
const notFound = (message) => new ApiInputError(404, "not_found", message);
const conflict = (message) => new ApiInputError(409, "conflict", message);

// ---------- reading what was sent ----------
const text = (value, field, { max = 120, required = false } = {}) => {
  if (value === undefined || value === null || String(value).trim() === "") {
    if (required) throw bad(`${field} is required.`);
    return null;
  }
  if (typeof value !== "string" && typeof value !== "number") throw bad(`${field} must be text.`);
  const out = String(value).replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim();
  if (out.length > max) throw bad(`${field} can be at most ${max} characters.`);
  return out;
};
const wholeNumber = (value, field, { required = false } = {}) => {
  if (value === undefined || value === null || value === "") {
    if (required) throw bad(`${field} is required.`);
    return null;
  }
  const n = Number(value);
  if (!Number.isInteger(n) || n <= 0 || n > 2147483647) throw bad(`${field} must be a whole number.`);
  return n;
};
const day = (value, field, { required = false } = {}) => {
  if (value === undefined || value === null || value === "") {
    if (required) throw bad(`${field} is required, as YYYY-MM-DD.`);
    return null;
  }
  const t = String(value).trim();
  const d = new Date(`${t}T00:00:00Z`);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(t) || Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== t) throw bad(`${field} must be a real date as YYYY-MM-DD.`);
  return t;
};
const email = (value, field) => {
  const t = text(value, field, { max: 255 });
  if (t && !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(t)) throw bad(`${field} is not a valid email address.`);
  return t ? t.toLowerCase() : null;
};
const phone = (value, field) => {
  const t = text(value, field, { max: 30 });
  if (t && !/^\+?[0-9 ()-]{6,30}$/.test(t)) throw bad(`${field} is not a valid phone number.`);
  return t;
};
const GENDERS = { m: "Male", male: "Male", boy: "Male", f: "Female", female: "Female", girl: "Female", other: "Other", x: "Other" };
const gender = (value) => {
  if (value === undefined || value === null || value === "") return null;
  const g = GENDERS[String(value).trim().toLowerCase()];
  if (!g) throw bad("gender must be male, female or other.");
  return g;
};
const has = (body, key) => Object.prototype.hasOwnProperty.call(body || {}, key);

function log(access, { action, recordType, recordId, label, description }) {
  return logOrganizationActivity({
    organizationId: access.organizationId,
    userId: null,
    userName: `API: ${access.serviceAccount.name}`.slice(0, 255),
    userRole: "Service account",
    actionType: action,
    moduleName: "API Access",
    pagePath: "/api/v1",
    recordType,
    recordId: recordId == null ? null : String(recordId),
    recordLabel: label,
    description,
  }).catch(() => {});
}

// The school's current term (and its year), which new students join.
async function currentTerm(client, organizationId) {
  const { rows } = await client.query(
    `SELECT term_id, school_year_id FROM terms WHERE organization_id = $1 AND current = TRUE ORDER BY start_date DESC NULLS LAST LIMIT 1`,
    [organizationId]
  );
  return rows[0] || null;
}

async function classOf(client, organizationId, classId) {
  const { rows } = await client.query(
    `SELECT class_id, class_name FROM classes WHERE class_id = $1 AND organization_id = $2 AND obsolete_at IS NULL`,
    [classId, organizationId]
  );
  if (!rows[0]) throw notFound(`No class ${classId} in this school.`);
  return rows[0];
}

const STUDENT_OUT = `SELECT s.student_id AS id, s.custom_student_id AS student_number, s.first_name, s.last_name, s.gender,
       TO_CHAR(s.date_of_birth, 'YYYY-MM-DD') AS date_of_birth, s.email, s.class_id, c.class_name, s.api_changed_at AS updated_at
  FROM students s LEFT JOIN classes c ON c.class_id = s.class_id AND c.organization_id = s.organization_id
 WHERE s.student_id = $1 AND s.organization_id = $2`;

// ---------- students ----------
async function createStudent(access, body) {
  const organizationId = access.organizationId;
  const firstName = text(body.first_name, "first_name", { required: true, max: 100 });
  const lastName = text(body.last_name, "last_name", { required: true, max: 100 });
  const classId = wholeNumber(body.class_id, "class_id", { required: true });
  const values = {
    gender: gender(body.gender),
    birth: day(body.date_of_birth, "date_of_birth"),
    email: email(body.email, "email"),
    number: text(body.student_number, "student_number", { max: 100 }),
  };
  const client = await db.connect();
  try {
    await client.query("BEGIN");
    const cls = await classOf(client, organizationId, classId);
    const term = await currentTerm(client, organizationId);
    if (values.number) {
      const taken = await client.query(`SELECT 1 FROM students WHERE organization_id = $1 AND custom_student_id = $2`, [organizationId, values.number]);
      if (taken.rows.length) throw conflict(`Student number ${values.number} is already used in this school.`);
    }
    const inserted = await client.query(
      `INSERT INTO students (first_name, last_name, gender, date_of_birth, email, custom_student_id, class_id, term_id, organization_id, api_changed_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, NOW()) RETURNING student_id`,
      [firstName, lastName, values.gender, values.birth, values.email, values.number, cls.class_id, term ? term.term_id : null, organizationId]
    );
    const studentId = inserted.rows[0].student_id;
    // In the class for the current term, with the class's subjects, as an admitted student is.
    let enrolled = false;
    if (term) {
      const enrollment = (await client.query(
        `SELECT enrollment_id FROM enrollments WHERE term_id = $1 AND organization_id = $2 ORDER BY enrollment_id LIMIT 1`,
        [term.term_id, organizationId]
      )).rows[0];
      if (enrollment) {
        await client.query(`INSERT INTO enrolled_students (enrollment_id, student_id, class_id) VALUES ($1, $2, $3)`, [enrollment.enrollment_id, studentId, cls.class_id]);
        await client.query(
          `INSERT INTO student_subjects (student_id, subject_id, organization_id, term_id)
           SELECT $1, s.subject_id, $2, $4 FROM subjects s
            WHERE s.class_id = $3 AND s.organization_id = $2 AND s.obsolete_at IS NULL AND (s.term_id IS NULL OR s.term_id = $4)
           ON CONFLICT DO NOTHING`,
          [studentId, organizationId, cls.class_id, term.term_id]
        );
        enrolled = true;
      }
    }
    await client.query("COMMIT");
    log(access, { action: "Created", recordType: "Student", recordId: studentId, label: `${firstName} ${lastName}`, description: `Added student ${firstName} ${lastName} to ${cls.class_name} through the API.` });
    const out = (await db.query(STUDENT_OUT, [studentId, organizationId])).rows[0];
    return { data: out, enrolled_in_current_term: enrolled, ...(enrolled ? {} : { note: "The student was added to the class, but the school has no current term set up, so they are not enrolled in a term yet." }) };
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {});
    if (error.code === "23505") throw conflict("A student with that student number already exists in this school.");
    throw error;
  } finally {
    client.release();
  }
}

async function updateStudent(access, studentId, body) {
  const organizationId = access.organizationId;
  const found = (await db.query(`SELECT student_id, first_name, last_name FROM students WHERE student_id = $1 AND organization_id = $2`, [studentId, organizationId])).rows[0];
  if (!found) throw notFound("No such student.");
  const sets = [];
  const params = [studentId, organizationId];
  const set = (column, value) => { params.push(value); sets.push(`${column} = $${params.length}`); };
  if (has(body, "first_name")) set("first_name", text(body.first_name, "first_name", { required: true, max: 100 }));
  if (has(body, "last_name")) set("last_name", text(body.last_name, "last_name", { required: true, max: 100 }));
  if (has(body, "gender")) set("gender", gender(body.gender));
  if (has(body, "date_of_birth")) set("date_of_birth", day(body.date_of_birth, "date_of_birth"));
  if (has(body, "email")) set("email", email(body.email, "email"));
  if (has(body, "student_number")) {
    const number = text(body.student_number, "student_number", { max: 100 });
    if (number) {
      const taken = await db.query(`SELECT 1 FROM students WHERE organization_id = $1 AND custom_student_id = $2 AND student_id <> $3`, [organizationId, number, studentId]);
      if (taken.rows.length) throw conflict(`Student number ${number} is already used in this school.`);
    }
    set("custom_student_id", number);
  }
  if (has(body, "class_id")) throw bad("To move a student to another class, use Transfer in Managira: it carries their scores across.");
  if (!sets.length) throw bad("Send at least one field to change: first_name, last_name, gender, date_of_birth, email or student_number.");
  await db.query(`UPDATE students SET ${sets.join(", ")}, api_changed_at = NOW() WHERE student_id = $1 AND organization_id = $2`, params);
  log(access, { action: "Updated", recordType: "Student", recordId: studentId, label: `${found.first_name} ${found.last_name}`, description: `Updated student ${found.first_name} ${found.last_name} through the API (${Object.keys(body).filter((k) => k !== "class_id").join(", ")}).` });
  return { data: (await db.query(STUDENT_OUT, [studentId, organizationId])).rows[0] };
}

// ---------- parents & guardians ----------
const RELATIONSHIPS = new Set(["mother", "father", "parent", "guardian", "grandmother", "grandfather", "grandparent", "aunt", "uncle", "sibling", "stepmother", "stepfather", "foster parent", "other"]);
const relationship = (value) => {
  const t = text(value, "relationship", { max: 50 });
  if (!t) return "Parent";
  if (!RELATIONSHIPS.has(t.toLowerCase())) throw bad(`relationship must be one of: ${[...RELATIONSHIPS].join(", ")}.`);
  return t.charAt(0).toUpperCase() + t.slice(1).toLowerCase();
};
const GUARDIAN_OUT = `SELECT g.guardian_id AS id, g.first_name, g.last_name, g.email, g.phone,
       COALESCE(ARRAY_AGG(s.student_id ORDER BY s.student_id) FILTER (WHERE s.student_id IS NOT NULL), '{}') AS student_ids, g.updated_at
  FROM guardian_profiles g
  LEFT JOIN guardian_students gs ON gs.guardian_id = g.guardian_id
  LEFT JOIN students s ON s.student_id = gs.student_id AND s.organization_id = g.organization_id
 WHERE g.guardian_id = $1 AND g.organization_id = $2
 GROUP BY g.guardian_id`;

async function ownStudents(client, organizationId, ids) {
  const list = [...new Set((Array.isArray(ids) ? ids : []).map((v) => wholeNumber(v, "student_ids")))];
  if (list.length > 20) throw bad("A parent can be linked to at most 20 students at once.");
  if (!list.length) return [];
  const { rows } = await client.query(`SELECT student_id FROM students WHERE organization_id = $1 AND student_id = ANY($2::int[])`, [organizationId, list]);
  const found = new Set(rows.map((r) => r.student_id));
  const missing = list.filter((sid) => !found.has(sid));
  if (missing.length) throw notFound(`No student ${missing.join(", ")} in this school.`);
  return list;
}

async function createGuardian(access, body) {
  const organizationId = access.organizationId;
  const firstName = text(body.first_name, "first_name", { required: true, max: 100 });
  const lastName = text(body.last_name, "last_name", { max: 100 });
  const mail = email(body.email, "email");
  const tel = phone(body.phone, "phone");
  if (!mail && !tel) throw bad("Send an email or a phone number, so the school can reach this parent.");
  const rel = relationship(body.relationship);
  const client = await db.connect();
  try {
    await client.query("BEGIN");
    const students = await ownStudents(client, organizationId, body.student_ids);
    if (!students.length) throw bad("student_ids: link the parent to at least one student.");
    if (mail) {
      // One record per parent: the same email in this school is the same parent.
      const existing = (await client.query(`SELECT guardian_id FROM guardian_profiles WHERE organization_id = $1 AND LOWER(email) = $2 LIMIT 1`, [organizationId, mail])).rows[0];
      if (existing) throw conflict(`A parent with this email already exists (id ${existing.guardian_id}). Link more children to them with PATCH /guardians/${existing.guardian_id}.`);
    }
    const inserted = await client.query(
      `INSERT INTO guardian_profiles (first_name, last_name, email, phone, organization_id, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, NOW(), NOW()) RETURNING guardian_id`,
      [firstName, lastName, mail, tel, organizationId]
    );
    const guardianId = inserted.rows[0].guardian_id;
    await client.query(
      `INSERT INTO guardian_students (guardian_id, student_id, relationship, created_at)
       SELECT $1, sid, $3, NOW() FROM unnest($2::int[]) AS sid ON CONFLICT DO NOTHING`,
      [guardianId, students, rel]
    );
    await client.query("COMMIT");
    log(access, { action: "Created", recordType: "Guardian", recordId: guardianId, label: [firstName, lastName].filter(Boolean).join(" "), description: `Added parent ${[firstName, lastName].filter(Boolean).join(" ")} for ${students.length} student(s) through the API.` });
    return { data: (await db.query(GUARDIAN_OUT, [guardianId, organizationId])).rows[0] };
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {});
    throw error;
  } finally {
    client.release();
  }
}

async function updateGuardian(access, guardianId, body) {
  const organizationId = access.organizationId;
  const found = (await db.query(`SELECT guardian_id, first_name, last_name FROM guardian_profiles WHERE guardian_id = $1 AND organization_id = $2`, [guardianId, organizationId])).rows[0];
  if (!found) throw notFound("No such parent or guardian.");
  const client = await db.connect();
  try {
    await client.query("BEGIN");
    const sets = [];
    const params = [guardianId, organizationId];
    const set = (column, value) => { params.push(value); sets.push(`${column} = $${params.length}`); };
    if (has(body, "first_name")) set("first_name", text(body.first_name, "first_name", { required: true, max: 100 }));
    if (has(body, "last_name")) set("last_name", text(body.last_name, "last_name", { max: 100 }));
    if (has(body, "email")) {
      const mail = email(body.email, "email");
      if (mail) {
        const taken = await client.query(`SELECT 1 FROM guardian_profiles WHERE organization_id = $1 AND LOWER(email) = $2 AND guardian_id <> $3`, [organizationId, mail, guardianId]);
        if (taken.rows.length) throw conflict("Another parent in this school already has this email.");
      }
      set("email", mail);
    }
    if (has(body, "phone")) set("phone", phone(body.phone, "phone"));
    if (sets.length) await client.query(`UPDATE guardian_profiles SET ${sets.join(", ")}, updated_at = NOW() WHERE guardian_id = $1 AND organization_id = $2`, params);
    // Links are only ever added here; unlinking a child is done in Managira, where it is seen.
    const add = has(body, "add_student_ids") ? await ownStudents(client, organizationId, body.add_student_ids) : [];
    if (add.length) {
      await client.query(
        `INSERT INTO guardian_students (guardian_id, student_id, relationship, created_at)
         SELECT $1, sid, $3, NOW() FROM unnest($2::int[]) AS sid ON CONFLICT DO NOTHING`,
        [guardianId, add, relationship(body.relationship)]
      );
      await client.query(`UPDATE guardian_profiles SET updated_at = NOW() WHERE guardian_id = $1`, [guardianId]);
    }
    if (!sets.length && !add.length) throw bad("Send at least one field to change: first_name, last_name, email, phone or add_student_ids.");
    await client.query("COMMIT");
    log(access, { action: "Updated", recordType: "Guardian", recordId: guardianId, label: [found.first_name, found.last_name].filter(Boolean).join(" "), description: `Updated parent ${[found.first_name, found.last_name].filter(Boolean).join(" ")} through the API.` });
    return { data: (await db.query(GUARDIAN_OUT, [guardianId, organizationId])).rows[0] };
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {});
    throw error;
  } finally {
    client.release();
  }
}

// ---------- attendance and scores: through the pages' own code ----------
// Calls a page handler with a request made for this school and reads its answer.
function callPageHandler(handler, self, { query = {}, body = {}, session }) {
  return new Promise((resolve, reject) => {
    const res = {
      statusCode: 200,
      status(code) { this.statusCode = code; return this; },
      json(payload) { resolve({ status: this.statusCode, body: payload }); return this; },
      send(payload) { resolve({ status: this.statusCode, body: typeof payload === "string" ? { error: payload } : payload }); return this; },
    };
    Promise.resolve(handler.call(self, { query, body, session, headers: {}, get: () => "" }, res, db)).catch(reject);
  });
}

async function markAttendance(access, body) {
  const organizationId = access.organizationId;
  const date = day(body.date, "date", { required: true });
  const classId = wholeNumber(body.class_id, "class_id", { required: true });
  const records = Array.isArray(body.records) ? body.records : null;
  if (!records || !records.length) throw bad("records: send a list like [{ \"student_id\": 12, \"status\": \"present\" }].");
  if (records.length > 500) throw bad("Send at most 500 marks at once.");
  const cls = await classOf(db, organizationId, classId);
  // The term the date falls in (else the current one).
  const term = (await db.query(
    `SELECT term_id FROM terms WHERE organization_id = $1 AND $2::date BETWEEN start_date AND end_date ORDER BY current DESC LIMIT 1`,
    [organizationId, date]
  )).rows[0] || await currentTerm(db, organizationId);
  if (!term) throw bad("This school has no term covering that date.");
  const attendance = {};
  records.forEach((record, at) => {
    const studentId = wholeNumber(record && record.student_id, `records[${at}].student_id`, { required: true });
    const status = String((record && record.status) || "").trim().toLowerCase();
    if (status !== "present" && status !== "absent") throw bad(`records[${at}].status must be present or absent.`);
    attendance[studentId] = status;
  });
  const common = require("../controllers/commonController").commonController;
  const out = await callPageHandler(common.saveSingleAttendance, common, {
    body: { attendance, classId: cls.class_id, termId: term.term_id, date },
    session: { organizationId, userId: null },
  });
  if (out.status >= 400 || !out.body || out.body.success === false) {
    throw new ApiInputError(out.status >= 400 ? out.status : 400, "rejected", (out.body && (out.body.message || out.body.error)) || "The attendance could not be saved.");
  }
  // What was actually saved: marks for students not in this class are left out.
  const saved = await db.query(
    `SELECT student_id, LOWER(status::text) AS status FROM attendance_records
      WHERE organization_id = $1 AND class_id = $2 AND date = $3::date AND student_id = ANY($4::int[])`,
    [organizationId, cls.class_id, date, Object.keys(attendance).map(Number)]
  );
  const savedIds = new Set(saved.rows.map((r) => r.student_id));
  const skipped = Object.keys(attendance).map(Number).filter((sid) => !savedIds.has(sid));
  log(access, { action: "Updated", recordType: "Attendance", recordId: cls.class_id, label: `${cls.class_name}, ${date}`, description: `Marked attendance for ${saved.rows.length} student(s) in ${cls.class_name} on ${date} through the API.` });
  return { data: { class_id: cls.class_id, date, saved: saved.rows, skipped_student_ids: skipped }, ...(skipped.length ? { note: "Some students were skipped: they are not in this class for that term." } : {}) };
}

async function enterScores(access, body) {
  const organizationId = access.organizationId;
  const assessmentId = wholeNumber(body.assessment_id, "assessment_id", { required: true });
  const scores = Array.isArray(body.scores) ? body.scores : null;
  if (!scores || !scores.length) throw bad("scores: send a list like [{ \"student_id\": 12, \"score\": 18.5 }].");
  if (scores.length > 500) throw bad("Send at most 500 scores at once.");
  const assessment = (await db.query(
    `SELECT assessment_id, title, class_id, subject_id, term_id, max_score FROM assessments
      WHERE assessment_id = $1 AND organization_id = $2 AND COALESCE(is_active, TRUE) AND obsolete_at IS NULL`,
    [assessmentId, organizationId]
  )).rows[0];
  if (!assessment) throw notFound("No such assessment in this school.");
  const sheet = {};
  scores.forEach((entry, at) => {
    const studentId = wholeNumber(entry && entry.student_id, `scores[${at}].student_id`, { required: true });
    const raw = entry ? entry.score : undefined;
    if (raw === null) { sheet[studentId] = { [assessmentId]: "" }; return; }
    const n = Number(raw);
    if (raw === undefined || raw === "" || !Number.isFinite(n)) throw bad(`scores[${at}].score must be a number (or null to clear it).`);
    sheet[studentId] = { [assessmentId]: n };
  });
  const common = require("../controllers/commonController").commonController;
  const out = await callPageHandler(common.saveAllScores, common, {
    query: { subjectId: String(assessment.subject_id), classId: String(assessment.class_id), termId: String(assessment.term_id) },
    body: { scores: sheet },
    session: { organizationId, currentTermId: assessment.term_id },
  });
  if (out.status >= 400 || !out.body || !out.body.success) {
    throw new ApiInputError(out.status >= 400 ? out.status : 400, "rejected", (out.body && (out.body.error || out.body.message)) || "The scores could not be saved.");
  }
  const flowOn = (() => { try { return require("./assessmentApproval").flowOn(organizationId); } catch (_e) { return false; } })();
  log(access, { action: "Updated", recordType: "Assessment", recordId: assessmentId, label: assessment.title, description: `Entered ${out.body.savedCount || 0} score(s) for "${assessment.title}" through the API.` });
  return {
    data: { assessment_id: assessmentId, saved: out.body.savedCount || 0, cleared: out.body.clearedCount || 0, skipped: out.body.skippedStudentCount || 0 },
    note: flowOn ? "Scores wait for the teacher to post them before parents and the student see them." : undefined,
  };
}

// ---------- PayGira ----------
// A payment taken outside Managira (another payment system, the bank, the office). The same
// reference on the same bill is recorded once, so a retried request never pays twice.
const METHODS = new Set(["cash", "cheque", "bank_transfer", "card", "mobile_money", "other"]);
async function recordPayment(access, body) {
  const organizationId = access.organizationId;
  const assignmentId = wholeNumber(body.balance_id ?? body.assignment_id, "balance_id", { required: true });
  const amount = Math.round(Number(body.amount) * 100) / 100;
  if (!Number.isFinite(amount) || amount <= 0 || amount > 1000000) throw bad("amount must be a positive number.");
  const method = String(body.method || "other").trim().toLowerCase();
  if (!METHODS.has(method)) throw bad(`method must be one of: ${[...METHODS].join(", ")}.`);
  const reference = text(body.reference, "reference", { required: true, max: 120 });
  const notes = text(body.notes, "notes", { max: 500 });
  const client = await db.connect();
  try {
    await client.query("BEGIN");
    const row = (await client.query(
      `SELECT a.assignment_id, a.bill_id, a.student_id, a.amount, COALESCE(a.amount_paid, 0) AS amount_paid, COALESCE(a.late_fee_applied, 0) AS late_fee,
              b.due_date, b.title, COALESCE(b.status, 'active') AS bill_status
         FROM finance_bill_assignments a JOIN finance_bills b ON b.bill_id = a.bill_id AND b.organization_id = a.organization_id
        WHERE a.assignment_id = $1 AND a.organization_id = $2
        FOR UPDATE OF a`,
      [assignmentId, organizationId]
    )).rows[0];
    if (!row) throw notFound("No such balance in this school (see GET /paygira/balances).");
    if (row.bill_status === "cancelled") throw conflict("This bill was cancelled.");
    const repeat = (await client.query(
      `SELECT payment_id FROM finance_payments WHERE organization_id = $1 AND assignment_id = $2 AND reference = $3 LIMIT 1`,
      [organizationId, assignmentId, reference]
    )).rows[0];
    if (repeat) {
      await client.query("ROLLBACK");
      return { data: { id: repeat.payment_id, balance_id: assignmentId, already_recorded: true } };
    }
    const inserted = await client.query(
      `INSERT INTO finance_payments (organization_id, assignment_id, bill_id, student_id, amount, method, reference, notes, received_by, received_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, NULL, NOW()) RETURNING payment_id`,
      [organizationId, assignmentId, row.bill_id, row.student_id, amount, method, reference, notes ? `${notes} (API: ${access.serviceAccount.name})` : `API: ${access.serviceAccount.name}`]
    );
    const total = Number(row.amount) + Number(row.late_fee);
    const paid = Number(row.amount_paid) + amount;
    const applied = Math.min(paid, total);
    const credit = Math.max(paid - total, 0);
    const status = applied >= total && total > 0 ? "paid" : applied > 0 ? "partial" : row.due_date && new Date(row.due_date) < new Date() ? "overdue" : "pending";
    await client.query(`UPDATE finance_bill_assignments SET amount_paid = $1, status = $2, updated_at = NOW() WHERE assignment_id = $3`, [applied, status, assignmentId]);
    if (credit > 0) {
      await client.query(
        `INSERT INTO finance_student_credits (organization_id, student_id, amount) VALUES ($1, $2, $3)
         ON CONFLICT (student_id) DO UPDATE SET amount = finance_student_credits.amount + EXCLUDED.amount, updated_at = NOW()`,
        [organizationId, row.student_id, credit]
      );
    }
    await client.query("COMMIT");
    try { require("../controllers/financeController").invalidateFinanceCache(organizationId); } catch (_e) { /* the cache refreshes on its own */ }
    log(access, { action: "Recorded Payment", recordType: "Payment", recordId: inserted.rows[0].payment_id, label: row.title, description: `Recorded ${amount.toFixed(2)} (${method}, ref ${reference}) on "${row.title}" through the API.` });
    return { data: { id: inserted.rows[0].payment_id, balance_id: assignmentId, amount, method, reference, status, credit_added: credit } };
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {});
    throw error;
  } finally {
    client.release();
  }
}

module.exports = { ApiInputError, createStudent, updateStudent, createGuardian, updateGuardian, markAttendance, enterScores, recordPayment };
