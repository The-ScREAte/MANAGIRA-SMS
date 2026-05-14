// controllers/financeController.js
// Finance & Billing Management — multi-tenant scoped by organization_id.
// All queries filter by req.session.organizationId. The page is admin-only.

const fs = require("fs");
const path = require("path");
const db = require("../config/db");

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

function isFinanceAdmin(req) {
  const t = String(req.session?.userRole || req.session?.accountType || req.session?.user?.account_type || "").trim().toLowerCase();
  return ["admin", "mini admin", "super admin"].includes(t);
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
            (SELECT COALESCE(SUM(a.amount_paid),0) FROM finance_bill_assignments a WHERE a.bill_id = b.bill_id) AS total_paid
       FROM finance_bills b
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
  return { classes: classes.rows, students: students.rows, years: years.rows, terms: terms.rows };
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
    if (!isFinanceAdmin(req)) {
      req.flash && req.flash("error", "Access denied.");
      return res.redirect("/account/settings");
    }
    const orgId = req.session.organizationId;
    if (!orgId) return res.redirect("/account/login");

    try {
      await ensureFinanceSchema();
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
    if (!isFinanceAdmin(req)) return res.redirect("/account/settings");
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
    if (!isFinanceAdmin(req)) return res.redirect("/account/settings");
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
    if (!isFinanceAdmin(req)) return res.redirect("/account/settings");
    const orgId = req.session.organizationId;
    try {
      await ensureFinanceSchema();
      const {
        title, description, amount, bill_type, recurrence,
        late_fee_amount, late_fee_after_days,
        applies_to, school_year_id, term_id, due_date,
        accepts_card, accepts_cash, accepts_transfer,
        notify_email, notify_sms,
        target_class_ids, target_student_ids, status
      } = req.body;

      const amt = Number(amount || 0);
      const insert = await db.query(
        `INSERT INTO finance_bills
         (organization_id, title, description, amount, bill_type, recurrence,
          late_fee_amount, late_fee_after_days, applies_to, school_year_id, term_id, due_date,
          accepts_card, accepts_cash, accepts_transfer, notify_email, notify_sms, status, created_by)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19)
         RETURNING bill_id`,
        [orgId, title, description || null, amt, bill_type || 'one_time', recurrence || null,
          Number(late_fee_amount || 0), Number(late_fee_after_days || 7),
          applies_to || 'school',
          school_year_id || null, term_id || null,
          due_date || null,
          !!accepts_card, !!accepts_cash, !!accepts_transfer,
          !!notify_email, !!notify_sms,
          status === 'draft' ? 'draft' : 'active',
          req.session.user?.user_id || null]
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
    if (!isFinanceAdmin(req)) return res.redirect("/account/settings");
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
    if (!isFinanceAdmin(req)) return res.redirect("/account/settings");
    const orgId = req.session.organizationId;
    try {
      await db.query(`DELETE FROM finance_bills WHERE bill_id=$1 AND organization_id=$2`, [req.params.id, orgId]);
      req.flash("success", "Bill deleted.");
    } catch (e) { req.flash("error", "Could not delete bill."); }
    res.redirect("/account/settings/finance?section=bills");
  },

  // Manual payment
  paymentRecordPost: async (req, res) => {
    if (!isFinanceAdmin(req)) return res.redirect("/account/settings");
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
    if (!isFinanceAdmin(req)) return res.status(403).json([]);
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
};
