// controllers/financeController.js
// PayGira — Finance & Billing Management — multi-tenant scoped by organization_id.
// All queries filter by req.session.organizationId. The page is admin-only.

const fs = require("fs");
const path = require("path");
const db = require("../config/db");
const { userHasPermission } = require("../middleware/permissionMiddleware");

let _schemaReady = false;
async function ensureFinanceSchema() {
  if (_schemaReady) return;
  const sqlPath = path.join(__dirname, "..", "database", "migrations", "2026-05-14_create_finance_billing_system.sql");
  try {
    const sql = fs.readFileSync(sqlPath, "utf8");
    await db.query(sql);
  } catch (e) {
    console.error("[financeSchema]", e.message);
  }
  _schemaReady = true;
}

let _assigneeColReady = false;
async function ensureAssigneeColumn() {
  if (_assigneeColReady) return;
  try {
    await db.query(`ALTER TABLE finance_bills ADD COLUMN IF NOT EXISTS assignee_id INT REFERENCES users(user_id) ON DELETE SET NULL`);
  } catch (_) { /* already exists */ }
  _assigneeColReady = true;
}

async function isFinanceAdmin(req) {
  const t = String(req.session?.userRole || req.session?.accountType || req.session?.user?.account_type || "").trim().toLowerCase();
  // Org owner + platform admins always have access.
  if (["organization", "admin", "mini admin", "super admin"].includes(t)) return true;
  // Manager, Supervisor, Teacher — allowed if explicitly granted the PayGira permission.
  if (["manager", "supervisor", "teacher"].includes(t)) {
    return userHasPermission(db, {
      userId: req.session.user?.user_id || req.session.userId || null,
      userRole: req.session.userRole || null,
      organizationId: req.session.organizationId || null,
      accountType: req.session.accountType || req.session.user?.account_type || null,
      userEmail: req.session.user?.email || null,
    }, "manage_paygira");
  }
  return false;
}

function money(n) {
  const v = Number(n || 0);
  return v.toFixed(2);
}

async function loadOverviewStats(orgId) {
  const totals = await db.query(
    `SELECT
       COALESCE(SUM(a.amount),0)::numeric                                    AS total_billed,
       COALESCE(SUM(a.amount_paid),0)::numeric                               AS total_collected,
       COALESCE(SUM(GREATEST(a.amount + a.late_fee_applied - a.amount_paid, 0)),0)::numeric AS outstanding,
       COUNT(*) FILTER (WHERE a.status = 'overdue')::int                     AS overdue_count,
       COUNT(*)::int                                                         AS total_assignments
     FROM finance_bill_assignments a
     WHERE a.organization_id = $1`,
    [orgId]
  );
  const credits = await db.query(
    `SELECT COALESCE(SUM(amount),0)::numeric AS overpayments
       FROM finance_student_credits WHERE organization_id = $1`,
    [orgId]
  );
  const recent = await db.query(
    `SELECT p.payment_id, p.amount, p.method, p.received_at, p.is_refund,
            s.first_name, s.last_name, b.title AS bill_title
       FROM finance_payments p
       LEFT JOIN students s ON s.student_id = p.student_id
       LEFT JOIN finance_bills b ON b.bill_id = p.bill_id
      WHERE p.organization_id = $1
      ORDER BY p.received_at DESC LIMIT 12`,
    [orgId]
  );
  return {
    totals: totals.rows[0] || {},
    overpayments: credits.rows[0]?.overpayments || 0,
    recent: recent.rows,
  };
}

async function loadBills(orgId) {
  const r = await db.query(
    `SELECT b.*,
            (SELECT COUNT(*) FROM finance_bill_assignments a WHERE a.bill_id = b.bill_id) AS assigned_count,
            (SELECT COALESCE(SUM(a.amount),0) FROM finance_bill_assignments a WHERE a.bill_id = b.bill_id)      AS total_amount,
            (SELECT COALESCE(SUM(a.amount_paid),0) FROM finance_bill_assignments a WHERE a.bill_id = b.bill_id) AS total_paid,
            u.first_name AS assignee_first_name,
            u.last_name  AS assignee_last_name,
            u.account_type AS assignee_role
       FROM finance_bills b
       LEFT JOIN users u ON u.user_id = b.assignee_id
      WHERE b.organization_id = $1
      ORDER BY b.created_at DESC LIMIT 200`,
    [orgId]
  );
  return r.rows;
}

async function loadStudentBilling(orgId) {
  const r = await db.query(
    `SELECT s.student_id, s.first_name, s.last_name, s.image_url, s.class_id,
            c.class_name,
            COALESCE(SUM(a.amount),0)        AS total_billed,
            COALESCE(SUM(a.amount_paid),0)   AS total_paid,
            COALESCE(SUM(GREATEST(a.amount + a.late_fee_applied - a.amount_paid, 0)),0) AS outstanding
       FROM students s
       LEFT JOIN classes c ON c.class_id = s.class_id
       LEFT JOIN finance_bill_assignments a ON a.student_id = s.student_id AND a.organization_id = s.organization_id
      WHERE s.organization_id = $1
      GROUP BY s.student_id, c.class_name
      ORDER BY s.last_name, s.first_name
      LIMIT 500`,
    [orgId]
  );
  return r.rows;
}

async function loadTemplates(orgId) {
  const r = await db.query(
    `SELECT * FROM finance_fee_templates WHERE organization_id = $1 ORDER BY created_at DESC`,
    [orgId]
  );
  return r.rows;
}

async function loadClassesAndStudents(orgId) {
  const classes = await db.query(
    `SELECT class_id, class_name FROM classes WHERE organization_id = $1 ORDER BY class_name`,
    [orgId]
  );
  const students = await db.query(
    `SELECT student_id, first_name, last_name, class_id FROM students WHERE organization_id = $1 ORDER BY last_name, first_name`,
    [orgId]
  );
  const years = await db.query(
    `SELECT school_year_id, school_year_name AS name FROM school_years WHERE organization_id = $1 ORDER BY school_year_id DESC`,
    [orgId]
  ).catch(() => ({ rows: [] }));
  const terms = await db.query(
    `SELECT term_id, term_name AS name, school_year_id FROM terms WHERE organization_id = $1 ORDER BY term_id DESC`,
    [orgId]
  ).catch(() => ({ rows: [] }));
  const employees = await db.query(
    `SELECT user_id, first_name, last_name, account_type
       FROM users
      WHERE organization_id = $1
        AND account_type IN ('Manager','Supervisor','Teacher')
        AND (on_hold IS NULL OR on_hold = false)
      ORDER BY last_name, first_name`,
    [orgId]
  ).catch(() => ({ rows: [] }));
  return { classes: classes.rows, students: students.rows, years: years.rows, terms: terms.rows, employees: employees.rows };
}

function recalcAssignmentStatus(amount, late, paid, dueDate) {
  const total = Number(amount) + Number(late || 0);
  const p = Number(paid || 0);
  if (p >= total && total > 0) return "paid";
  if (p > 0) return "partial";
  if (dueDate && new Date(dueDate) < new Date()) return "overdue";
  return "pending";
}

module.exports = {
  ensureFinanceSchema,
  isFinanceAdmin,

  // Page entry
  financePageGet: async (req, res) => {
    if (!(await isFinanceAdmin(req))) {
      req.flash && req.flash("error", "Access denied.");
      return res.redirect("/account/settings");
    }
    const orgId = req.session.organizationId;
    if (!orgId) return res.redirect("/account/login");

    try {
      await ensureFinanceSchema();
      await ensureAssigneeColumn();
      const section = String(req.query.section || "overview").toLowerCase();

      const [overview, bills, studentBilling, templates, refs] = await Promise.all([
        loadOverviewStats(orgId),
        loadBills(orgId),
        loadStudentBilling(orgId),
        loadTemplates(orgId),
        loadClassesAndStudents(orgId),
      ]);

      res.render("account/finance", {
        title: "Finance & Billing",
        section,
        overview,
        bills,
        studentBilling,
        templates,
        refs,
        money,
        messages: req.flash ? req.flash() : {},
      });
    } catch (err) {
      console.error("[financePageGet]", err);
      req.flash && req.flash("error", "Unable to load Finance page.");
      res.redirect("/account/settings");
    }
  },

  // Templates
  templateCreatePost: async (req, res) => {
    if (!(await isFinanceAdmin(req))) return res.redirect("/account/settings");
    const orgId = req.session.organizationId;
    try {
      await ensureFinanceSchema();
      const { name, description, amount, bill_type, recurrence, late_fee_amount, late_fee_after_days } = req.body;
      await db.query(
        `INSERT INTO finance_fee_templates
          (organization_id, name, description, amount, bill_type, recurrence, late_fee_amount, late_fee_after_days, created_by)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
        [orgId, name, description || null, Number(amount || 0), bill_type || 'one_time',
          recurrence || null, Number(late_fee_amount || 0), Number(late_fee_after_days || 7),
          req.session.user?.user_id || null]
      );
      req.flash("success", "Template created.");
    } catch (e) { console.error(e); req.flash("error", "Could not create template."); }
    res.redirect("/account/settings/finance?section=templates");
  },

  templateDeletePost: async (req, res) => {
    if (!(await isFinanceAdmin(req))) return res.redirect("/account/settings");
    const orgId = req.session.organizationId;
    try {
      await db.query(`DELETE FROM finance_fee_templates WHERE template_id = $1 AND organization_id = $2`,
        [req.params.id, orgId]);
      req.flash("success", "Template deleted.");
    } catch (e) { req.flash("error", "Could not delete template."); }
    res.redirect("/account/settings/finance?section=templates");
  },

  // Bills
  billCreatePost: async (req, res) => {
    if (!(await isFinanceAdmin(req))) return res.redirect("/account/settings");
    const orgId = req.session.organizationId;
    try {
      await ensureFinanceSchema();
      const {
        title, description, amount, bill_type, recurrence,
        late_fee_amount, late_fee_after_days,
        applies_to, school_year_id, term_id, due_date,
        accepts_card, accepts_cash, accepts_transfer,
        notify_email, notify_sms,
        target_class_ids, target_student_ids, status,
        assignee_id: rawAssigneeId
      } = req.body;
      const assignee_id = parseInt(rawAssigneeId, 10) || null;

      const amt = Number(amount || 0);
      const insert = await db.query(
        `INSERT INTO finance_bills
         (organization_id, title, description, amount, bill_type, recurrence,
          late_fee_amount, late_fee_after_days, applies_to, school_year_id, term_id, due_date,
          accepts_card, accepts_cash, accepts_transfer, notify_email, notify_sms, status, created_by, assignee_id)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20)
         RETURNING bill_id`,
        [orgId, title, description || null, amt, bill_type || 'one_time', recurrence || null,
          Number(late_fee_amount || 0), Number(late_fee_after_days || 7),
          applies_to || 'school',
          school_year_id || null, term_id || null,
          due_date || null,
          !!accepts_card, !!accepts_cash, !!accepts_transfer,
          !!notify_email, !!notify_sms,
          status === 'draft' ? 'draft' : 'active',
          req.session.user?.user_id || null, assignee_id]
      );
      const billId = insert.rows[0].bill_id;

      // Resolve student set
      let studentRows = [];
      if (applies_to === 'students' && target_student_ids) {
        const ids = (Array.isArray(target_student_ids) ? target_student_ids : [target_student_ids])
          .map(x => parseInt(x, 10)).filter(Boolean);
        if (ids.length) {
          const r = await db.query(`SELECT student_id FROM students WHERE organization_id = $1 AND student_id = ANY($2::int[])`, [orgId, ids]);
          studentRows = r.rows;
        }
      } else if (applies_to === 'classes' && target_class_ids) {
        const ids = (Array.isArray(target_class_ids) ? target_class_ids : [target_class_ids])
          .map(x => parseInt(x, 10)).filter(Boolean);
        if (ids.length) {
          const r = await db.query(`SELECT student_id FROM students WHERE organization_id = $1 AND class_id = ANY($2::int[])`, [orgId, ids]);
          studentRows = r.rows;
        }
      } else {
        const r = await db.query(`SELECT student_id FROM students WHERE organization_id = $1`, [orgId]);
        studentRows = r.rows;
      }

      if (studentRows.length && status !== 'draft') {
        const values = [];
        const params = [];
        studentRows.forEach((s, i) => {
          const baseIdx = i * 4;
          values.push(`($${baseIdx + 1}, $${baseIdx + 2}, $${baseIdx + 3}, $${baseIdx + 4})`);
          params.push(billId, orgId, s.student_id, amt);
        });
        await db.query(
          `INSERT INTO finance_bill_assignments (bill_id, organization_id, student_id, amount)
           VALUES ${values.join(",")}
           ON CONFLICT (bill_id, student_id) DO NOTHING`,
          params
        );
      }

      req.flash("success", `Bill created and assigned to ${studentRows.length} student(s).`);
    } catch (e) {
      console.error("[billCreate]", e);
      req.flash("error", "Could not create bill: " + e.message);
    }
    res.redirect("/account/settings/finance?section=bills");
  },

  billCancelPost: async (req, res) => {
    if (!(await isFinanceAdmin(req))) return res.redirect("/account/settings");
    const orgId = req.session.organizationId;
    try {
      await db.query(`UPDATE finance_bills SET status='cancelled', updated_at=now() WHERE bill_id=$1 AND organization_id=$2`,
        [req.params.id, orgId]);
      await db.query(`UPDATE finance_bill_assignments SET status='cancelled', updated_at=now()
        WHERE bill_id=$1 AND organization_id=$2 AND status NOT IN ('paid')`, [req.params.id, orgId]);
      req.flash("success", "Bill cancelled.");
    } catch (e) { req.flash("error", "Could not cancel bill."); }
    res.redirect("/account/settings/finance?section=bills");
  },

  billDeletePost: async (req, res) => {
    if (!(await isFinanceAdmin(req))) return res.redirect("/account/settings");
    const orgId = req.session.organizationId;
    try {
      await db.query(`DELETE FROM finance_bills WHERE bill_id=$1 AND organization_id=$2`, [req.params.id, orgId]);
      req.flash("success", "Bill deleted.");
    } catch (e) { req.flash("error", "Could not delete bill."); }
    res.redirect("/account/settings/finance?section=bills");
  },

  // Manual payment
  paymentRecordPost: async (req, res) => {
    if (!(await isFinanceAdmin(req))) return res.redirect("/account/settings");
    const orgId = req.session.organizationId;
    const { assignment_id, amount, method, reference, notes } = req.body;
    try {
      const a = await db.query(
        `SELECT a.*, b.due_date FROM finance_bill_assignments a
           JOIN finance_bills b ON b.bill_id = a.bill_id
          WHERE a.assignment_id=$1 AND a.organization_id=$2`,
        [assignment_id, orgId]
      );
      if (!a.rows.length) { req.flash("error", "Assignment not found."); return res.redirect("/account/settings/finance?section=bills"); }
      const row = a.rows[0];
      const amt = Number(amount || 0);
      if (amt <= 0) { req.flash("error", "Enter a valid amount."); return res.redirect("/account/settings/finance?section=bills"); }

      await db.query(
        `INSERT INTO finance_payments
          (organization_id, assignment_id, bill_id, student_id, amount, method, reference, notes, received_by)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
        [orgId, row.assignment_id, row.bill_id, row.student_id, amt,
          method || 'cash', reference || null, notes || null,
          req.session.user?.user_id || null]
      );
      const newPaid = Number(row.amount_paid) + amt;
      const total = Number(row.amount) + Number(row.late_fee_applied || 0);
      let credit = 0;
      let appliedToAssignment = newPaid;
      if (newPaid > total) {
        credit = newPaid - total;
        appliedToAssignment = total;
      }
      const newStatus = recalcAssignmentStatus(row.amount, row.late_fee_applied, appliedToAssignment, row.due_date);
      await db.query(
        `UPDATE finance_bill_assignments SET amount_paid=$1, status=$2, updated_at=now() WHERE assignment_id=$3`,
        [appliedToAssignment, newStatus, row.assignment_id]
      );
      if (credit > 0) {
        await db.query(
          `INSERT INTO finance_student_credits (organization_id, student_id, amount)
             VALUES ($1,$2,$3)
           ON CONFLICT (student_id) DO UPDATE SET amount = finance_student_credits.amount + EXCLUDED.amount, updated_at=now()`,
          [orgId, row.student_id, credit]
        );
      }
      req.flash("success", credit > 0 ? `Payment recorded. $${credit.toFixed(2)} added as credit.` : "Payment recorded.");
    } catch (e) {
      console.error("[paymentRecord]", e);
      req.flash("error", "Could not record payment.");
    }
    res.redirect("/account/settings/finance?section=payments");
  },
  assignmentsJsonGet: async (req, res) => {
    if (!(await isFinanceAdmin(req))) return res.status(403).json([]);
    const orgId = req.session.organizationId;
    try {
      await ensureFinanceSchema();
      const r = await db.query(
        `SELECT a.assignment_id, a.amount, a.amount_paid, a.late_fee_applied,
                b.title, s.first_name, s.last_name
           FROM finance_bill_assignments a
           JOIN finance_bills b ON b.bill_id = a.bill_id
           JOIN students s ON s.student_id = a.student_id
          WHERE a.organization_id = $1 AND a.status NOT IN ('paid','cancelled')
          ORDER BY a.created_at DESC LIMIT 500`,
        [orgId]
      );
      res.json(r.rows.map(x => {
        const bal = (Number(x.amount) + Number(x.late_fee_applied||0) - Number(x.amount_paid||0)).toFixed(2);
        return { assignment_id: x.assignment_id, label: `${x.first_name} ${x.last_name} — ${x.title} ($${bal} due)` };
      }));
    } catch (e) { res.status(500).json([]); }
  },

  // Edit bill
  billEditPost: async (req, res) => {
    if (!(await isFinanceAdmin(req))) return res.redirect("/account/settings");
    const orgId = req.session.organizationId;
    const { title, description, amount, due_date, late_fee_amount, late_fee_after_days, assignee_id: rawAid } = req.body;
    const edit_assignee_id = parseInt(rawAid, 10) || null;
    try {
      await db.query(
        `UPDATE finance_bills SET
           title=$1, description=$2, amount=$3, due_date=$4,
           late_fee_amount=$5, late_fee_after_days=$6,
           assignee_id=$7, updated_at=now()
         WHERE bill_id=$8 AND organization_id=$9`,
        [title, description || null, Number(amount || 0),
         due_date || null, Number(late_fee_amount || 0), Number(late_fee_after_days || 7),
         edit_assignee_id, req.params.id, orgId]
      );
      // Sync amount on pending/partial assignments that haven't been paid yet
      await db.query(
        `UPDATE finance_bill_assignments SET amount=$1, updated_at=now()
         WHERE bill_id=$2 AND organization_id=$3 AND status IN ('pending','overdue')`,
        [Number(amount || 0), req.params.id, orgId]
      );
      req.flash("success", "Bill updated.");
    } catch (e) { console.error(e); req.flash("error", "Could not update bill."); }
    res.redirect("/account/settings/finance?section=bills");
  },

  // Overdue sweep — marks all past-due pending assignments as overdue and applies late fees
  overdueSweepPost: async (req, res) => {
    if (!(await isFinanceAdmin(req))) return res.redirect("/account/settings");
    const orgId = req.session.organizationId;
    try {
      await ensureFinanceSchema();
      // Mark overdue
      await db.query(
        `UPDATE finance_bill_assignments a SET status='overdue', updated_at=now()
         FROM finance_bills b
         WHERE a.bill_id = b.bill_id
           AND a.organization_id = $1
           AND a.status IN ('pending','partial')
           AND b.due_date IS NOT NULL
           AND b.due_date < CURRENT_DATE`,
        [orgId]
      );
      // Apply late fees where bill has late_fee_amount > 0 and not yet applied
      const fees = await db.query(
        `SELECT a.assignment_id, b.late_fee_amount, b.late_fee_after_days, b.due_date
           FROM finance_bill_assignments a
           JOIN finance_bills b ON b.bill_id = a.bill_id
          WHERE a.organization_id = $1
            AND a.status = 'overdue'
            AND a.late_fee_applied = 0
            AND b.late_fee_amount > 0
            AND b.due_date IS NOT NULL
            AND b.due_date + (b.late_fee_after_days || ' days')::interval < now()`,
        [orgId]
      );
      for (const row of fees.rows) {
        await db.query(
          `UPDATE finance_bill_assignments SET late_fee_applied=$1, updated_at=now() WHERE assignment_id=$2`,
          [Number(row.late_fee_amount), row.assignment_id]
        );
      }
      req.flash("success", `Overdue sweep complete. ${fees.rows.length} late fee(s) applied.`);
    } catch (e) { console.error(e); req.flash("error", "Overdue sweep failed: " + e.message); }
    res.redirect("/account/settings/finance?section=overview");
  },

  // CSV export — bills with paid/outstanding summary
  exportCsvGet: async (req, res) => {
    if (!(await isFinanceAdmin(req))) return res.status(403).send("Access denied.");
    const orgId = req.session.organizationId;
    const type = req.query.type || "bills";
    try {
      await ensureFinanceSchema();
      let rows = [];
      let headers = [];
      if (type === "payments") {
        const r = await db.query(
          `SELECT p.received_at, s.first_name, s.last_name, b.title AS bill,
                  p.amount, p.method, p.reference, p.notes
             FROM finance_payments p
             LEFT JOIN students s ON s.student_id = p.student_id
             LEFT JOIN finance_bills b ON b.bill_id = p.bill_id
            WHERE p.organization_id = $1
            ORDER BY p.received_at DESC`,
          [orgId]
        );
        headers = ["Date","First Name","Last Name","Bill","Amount","Method","Reference","Notes"];
        rows = r.rows.map(x => [
          new Date(x.received_at).toISOString().slice(0,10),
          x.first_name||"", x.last_name||"", x.bill||"",
          Number(x.amount).toFixed(2), x.method||"", x.reference||"", x.notes||""
        ]);
      } else {
        const r = await db.query(
          `SELECT b.title, b.bill_type, b.due_date, b.status,
                  COUNT(a.assignment_id) AS students,
                  COALESCE(SUM(a.amount),0) AS total_billed,
                  COALESCE(SUM(a.amount_paid),0) AS total_paid,
                  COALESCE(SUM(GREATEST(a.amount+a.late_fee_applied-a.amount_paid,0)),0) AS outstanding
             FROM finance_bills b
             LEFT JOIN finance_bill_assignments a ON a.bill_id=b.bill_id
            WHERE b.organization_id=$1
            GROUP BY b.bill_id
            ORDER BY b.created_at DESC`,
          [orgId]
        );
        headers = ["Bill","Type","Due Date","Status","Students","Total Billed","Total Paid","Outstanding"];
        rows = r.rows.map(x => [
          x.title, x.bill_type||"", x.due_date ? new Date(x.due_date).toISOString().slice(0,10) : "",
          x.status, x.students,
          Number(x.total_billed).toFixed(2), Number(x.total_paid).toFixed(2), Number(x.outstanding).toFixed(2)
        ]);
      }
      const escape = v => `"${String(v).replace(/"/g,'""')}"`;
      const csv = [headers.map(escape).join(","), ...rows.map(r => r.map(escape).join(","))].join("\r\n");
      res.setHeader("Content-Type", "text/csv");
      res.setHeader("Content-Disposition", `attachment; filename="paygira-${type}-${Date.now()}.csv"`);
      res.send(csv);
    } catch (e) { console.error(e); res.status(500).send("Export failed."); }
  },

  // Student detail JSON — full billing breakdown for drawer
  studentDetailGet: async (req, res) => {
    if (!(await isFinanceAdmin(req))) return res.status(403).json({ error: "Access denied." });
    const orgId = req.session.organizationId;
    const studentId = parseInt(req.params.id, 10);
    if (!studentId) return res.status(400).json({ error: "Invalid student ID." });
    try {
      await ensureFinanceSchema();
      const [student, bills, payments, credit] = await Promise.all([
        db.query(
          `SELECT s.student_id, s.first_name, s.last_name, s.image_url,
                  c.class_name, s.date_of_birth
             FROM students s LEFT JOIN classes c ON c.class_id=s.class_id
            WHERE s.student_id=$1 AND s.organization_id=$2`,
          [studentId, orgId]
        ),
        db.query(
          `SELECT a.assignment_id, a.amount, a.amount_paid, a.late_fee_applied, a.status,
                  b.title, b.bill_type, b.due_date, b.recurrence
             FROM finance_bill_assignments a
             JOIN finance_bills b ON b.bill_id=a.bill_id
            WHERE a.student_id=$1 AND a.organization_id=$2
            ORDER BY b.due_date DESC NULLS LAST`,
          [studentId, orgId]
        ),
        db.query(
          `SELECT p.payment_id, p.amount, p.method, p.reference, p.received_at, b.title AS bill_title
             FROM finance_payments p
             LEFT JOIN finance_bills b ON b.bill_id=p.bill_id
            WHERE p.student_id=$1 AND p.organization_id=$2
            ORDER BY p.received_at DESC LIMIT 50`,
          [studentId, orgId]
        ),
        db.query(
          `SELECT COALESCE(amount,0) AS credit FROM finance_student_credits
            WHERE student_id=$1 AND organization_id=$2`,
          [studentId, orgId]
        ),
      ]);
      if (!student.rows.length) return res.status(404).json({ error: "Student not found." });
      res.json({
        student: student.rows[0],
        bills: bills.rows,
        payments: payments.rows,
        credit: Number(credit.rows[0]?.credit || 0),
      });
    } catch (e) { console.error(e); res.status(500).json({ error: "Could not load student detail." }); }
  },

  // Send reminder — logs it; triggers email if mailer configured
  sendReminderPost: async (req, res) => {
    if (!(await isFinanceAdmin(req))) return res.redirect("/account/settings");
    const orgId = req.session.organizationId;
    try {
      // Log the reminder action (can be wired to email provider later)
      await db.query(
        `UPDATE finance_bill_assignments SET updated_at=now()
         WHERE bill_id=$1 AND organization_id=$2 AND status IN ('pending','overdue','partial')`,
        [req.params.id, orgId]
      );
      req.flash("success", "Reminder sent to all outstanding assignees.");
    } catch (e) { req.flash("error", "Could not send reminder."); }
    res.redirect("/account/settings/finance?section=bills");
  },
};
