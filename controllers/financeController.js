// controllers/financeController.js
// PayGira — Finance & Billing Management — multi-tenant scoped by organization_id.
// All queries filter by req.session.organizationId. The page is admin-only.

const fs = require("fs");
const path = require("path");
const db = require("../config/db");
const { userHasPermission } = require("../middleware/permissionMiddleware");
const { logOrganizationActivity } = require("../utils/activityLog");

// PayGira audit logger — captures Admin/Mini-Admin actions that the
// auto-middleware skips, with precise descriptions and field diffs.
async function logPaygira(req, payload) {
  try {
    const organizationId = req.session?.organizationId;
    if (!organizationId) return;
    const sess = req.session || {};
    const user = sess.user || {};
    const guardian = sess.guardian || {};
    const userId =
      user.user_id || sess.userId ||
      guardian.guardian_id || sess.guardianId || null;
    const userName =
      payload.userName ||
      [user.first_name, user.last_name].filter(Boolean).join(" ").trim() ||
      [guardian.first_name, guardian.last_name].filter(Boolean).join(" ").trim() ||
      sess.userName || sess.email || "PayGira User";
    const userRole =
      payload.userRole ||
      sess.accountType || sess.userRole ||
      (sess.guardianId || guardian.guardian_id ? "Guardian" : "Staff");
    await logOrganizationActivity({
      organizationId,
      userId,
      userName,
      userRole,
      actionType: payload.actionType || "Updated",
      moduleName: payload.moduleName || "PayGira",
      pagePath: req.originalUrl || req.path,
      recordType: payload.recordType || "Bill",
      recordId: payload.recordId != null ? String(payload.recordId) : null,
      recordLabel: payload.recordLabel || null,
      description: payload.description || "PayGira action.",
      changedFields: Array.isArray(payload.changedFields) ? payload.changedFields : [],
      ipAddress: req.ip,
    });
  } catch (err) {
    console.error("[paygira-log]", err.message || err);
  }
}

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
    await db.query(`ALTER TABLE finance_bills ADD COLUMN IF NOT EXISTS payment_destination VARCHAR(20) DEFAULT 'stripe'`);
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

// ─── Payment-method helpers ─────────────────────────────────────────
// Stripe supports many payment methods; we let the school enable any of these.
// These are the canonical Stripe Payment Method identifiers.
const STRIPE_METHOD_CATALOG = [
  { id: 'card',             label: 'Card (Visa / Mastercard / Amex)' },
  { id: 'apple_pay',        label: 'Apple Pay' },
  { id: 'google_pay',       label: 'Google Pay' },
  { id: 'link',             label: 'Link by Stripe' },
  { id: 'cashapp',          label: 'Cash App Pay' },
  { id: 'us_bank_account',  label: 'US Bank Account (ACH)' },
  { id: 'sepa_debit',       label: 'SEPA Direct Debit' },
  { id: 'bacs_debit',       label: 'BACS Direct Debit (UK)' },
  { id: 'klarna',           label: 'Klarna' },
  { id: 'afterpay_clearpay',label: 'Afterpay / Clearpay' },
  { id: 'ideal',            label: 'iDEAL' },
];

// Given a school's PSP settings, return the methods parents/staff are allowed to use.
function computeAllowedMethods(pspSettings) {
  const s = pspSettings || {};
  const stripeOn = !!(s.stripe_publishable_key && s.stripe_secret_key);
  // Selected stripe methods – default to ['card'] if Stripe is on but no list saved
  let stripeMethods = [];
  if (stripeOn) {
    const raw = s.stripe_methods;
    if (Array.isArray(raw)) stripeMethods = raw.filter(Boolean);
    else if (typeof raw === 'string' && raw.trim()) stripeMethods = raw.split(',').map(x => x.trim()).filter(Boolean);
    else stripeMethods = ['card'];
  }
  return {
    stripeOn,
    stripeMethods,
    momoOn: !!(s.momo_provider && s.momo_number),
    momoProvider: s.momo_provider || null,
    momoNumber:   s.momo_number || null,
    momoName:     s.momo_name || null,
    bankOn: !!(s.bank_name && s.bank_account_number),
    bank: {
      name:    s.bank_name || null,
      account: s.bank_account_number || null,
      holder:  s.bank_account_name || null,
      branch:  s.bank_branch || null,
    },
    currency: s.currency || 'USD',
  };
}

function maskPspSecrets(p) {
  const safe = { ...(p || {}) };
  ['stripe_secret_key','stripe_webhook_secret'].forEach(k => {
    if (safe[k]) {
      safe[k + '_masked'] = '••••••••' + String(safe[k]).slice(-4);
      delete safe[k];
    }
  });
  return safe;
}

async function loadOverviewStats(orgId, filters = {}) {
  const yr = filters.school_year_id ? parseInt(filters.school_year_id, 10) : null;
  const tm = filters.term_id        ? parseInt(filters.term_id, 10)        : null;

  // We must join through finance_bills to filter by year/term (those live on bill, not assignment).
  const where = ['a.organization_id = $1'];
  const params = [orgId];
  let i = 2;
  if (yr) { where.push(`b.school_year_id = $${i++}`); params.push(yr); }
  if (tm) { where.push(`b.term_id        = $${i++}`); params.push(tm); }
  const whereSql = where.join(' AND ');

  const totals = await db.query(
    `SELECT
       COALESCE(SUM(a.amount),0)::numeric                                                 AS total_billed,
       COALESCE(SUM(a.amount_paid),0)::numeric                                            AS total_collected,
       COALESCE(SUM(GREATEST(a.amount + a.late_fee_applied - a.amount_paid, 0)),0)::numeric AS outstanding,
       COUNT(*) FILTER (WHERE a.status = 'overdue')::int                                  AS overdue_count,
       COUNT(*)::int                                                                      AS total_assignments
     FROM finance_bill_assignments a
     JOIN finance_bills b ON b.bill_id = a.bill_id
     WHERE ${whereSql}`,
    params
  );

  const credits = await db.query(
    `SELECT COALESCE(SUM(amount),0)::numeric AS overpayments
       FROM finance_student_credits WHERE organization_id = $1`,
    [orgId]
  );

  // Recent payments — also filterable by bill year/term
  const rWhere = ['p.organization_id = $1'];
  const rParams = [orgId];
  let j = 2;
  if (yr) { rWhere.push(`b.school_year_id = $${j++}`); rParams.push(yr); }
  if (tm) { rWhere.push(`b.term_id        = $${j++}`); rParams.push(tm); }
  const recent = await db.query(
    `SELECT p.payment_id, p.amount, p.method, p.received_at, p.is_refund,
            s.first_name, s.last_name, b.title AS bill_title
       FROM finance_payments p
       LEFT JOIN students s       ON s.student_id = p.student_id
       LEFT JOIN finance_bills b  ON b.bill_id    = p.bill_id
      WHERE ${rWhere.join(' AND ')}
      ORDER BY p.received_at DESC LIMIT 12`,
    rParams
  );

  return {
    totals: totals.rows[0] || {},
    overpayments: credits.rows[0]?.overpayments || 0,
    recent: recent.rows,
    filters: { school_year_id: yr, term_id: tm },
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
            u.account_type AS assignee_role,
            sy.year_label,
            tm.term_name
       FROM finance_bills b
       LEFT JOIN users        u  ON u.user_id  = b.assignee_id
       LEFT JOIN school_years sy ON sy.id      = b.school_year_id
       LEFT JOIN terms        tm ON tm.term_id = b.term_id
      WHERE b.organization_id = $1
      ORDER BY b.created_at DESC LIMIT 200`,
    [orgId]
  ).catch(async () => {
    // Fallback if year/term columns are missing on legacy schemas
    return db.query(
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
  });
  return r.rows;
}

async function ensurePspSettingsTable() {
  await db.query(`
    CREATE TABLE IF NOT EXISTS finance_psp_settings (
      organization_id INT PRIMARY KEY,
      data JSONB NOT NULL DEFAULT '{}'::jsonb,
      updated_at TIMESTAMPTZ DEFAULT now()
    )
  `).catch(() => null);
}

async function loadPspSettings(orgId) {
  await ensurePspSettingsTable();
  const r = await db.query(
    `SELECT data FROM finance_psp_settings WHERE organization_id = $1`,
    [orgId]
  ).catch(() => ({ rows: [] }));
  return (r.rows[0] && r.rows[0].data) || {};
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
    `SELECT s.student_id, s.first_name, s.last_name, s.image_url, s.class_id, c.class_name
       FROM students s
       LEFT JOIN classes c ON c.class_id = s.class_id
      WHERE s.organization_id = $1
      ORDER BY s.last_name, s.first_name`,
    [orgId]
  );
  // school_years uses columns: id, year_label
  const years = await db.query(
    `SELECT id AS school_year_id, year_label AS name, current
       FROM school_years
      WHERE organization_id = $1
      ORDER BY current DESC NULLS LAST, id DESC`,
    [orgId]
  ).catch(() => ({ rows: [] }));
  const terms = await db.query(
    `SELECT term_id, term_name AS name, school_year_id, current
       FROM terms
      WHERE organization_id = $1
      ORDER BY current DESC NULLS LAST, term_id DESC`,
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

  // PSP / Payment-Settings save
  pspSavePost: async (req, res) => {
    if (!(await isFinanceAdmin(req))) {
      req.flash && req.flash("error", "Access denied.");
      return res.redirect("/account/settings");
    }
    const orgId = req.session.organizationId;
    if (!orgId) return res.redirect("/account/login");
    const provider = String(req.params.provider || '').toLowerCase();
    const allowed = ['stripe','momo','bank','general'];
    if (!allowed.includes(provider)) {
      req.flash && req.flash("error", "Unknown payment provider.");
      return res.redirect("/account/settings/finance?section=settings");
    }
    try {
      await ensurePspSettingsTable();
      const existing = await loadPspSettings(orgId);
      const next = { ...existing };
      // Stripe payment methods come as a multi-checkbox group → normalize to an array
      if (Object.prototype.hasOwnProperty.call(req.body || {}, 'stripe_methods')) {
        const raw = req.body.stripe_methods;
        next.stripe_methods = Array.isArray(raw) ? raw : (raw ? [raw] : []);
        delete req.body.stripe_methods;
      } else if (provider === 'stripe') {
        // Form submitted with no boxes checked → store empty array
        next.stripe_methods = [];
      }
      // Persist whatever fields the form sent, ignoring blanks for secrets
      Object.keys(req.body || {}).forEach(k => {
        const v = req.body[k];
        if (k.endsWith('_secret') || k.endsWith('_key')) {
          if (v && String(v).trim() && !/^[•*]+/.test(v)) next[k] = String(v).trim();
        } else if (v !== undefined && v !== null) {
          next[k] = typeof v === 'string' ? v.trim() : v;
        }
      });
      await db.query(
        `INSERT INTO finance_psp_settings (organization_id, data, updated_at)
         VALUES ($1, $2::jsonb, now())
         ON CONFLICT (organization_id) DO UPDATE SET data = $2::jsonb, updated_at = now()`,
        [orgId, JSON.stringify(next)]
      );
      req.flash && req.flash("success", `${provider.toUpperCase()} settings saved.`);
      await logPaygira(req, {
        actionType: "Saved",
        moduleName: "PayGira Settings",
        recordType: "Payment Provider Settings",
        recordId: provider,
        recordLabel: provider.toUpperCase(),
        description: `Updated ${provider.toUpperCase()} payment provider settings.`,
        changedFields: Object.keys(req.body || {}).filter(k => !k.endsWith('_secret') && !k.endsWith('_key')).map(k => ({ field: k, value: String(req.body[k]).slice(0, 80) })).slice(0, 8),
      });
    } catch (err) {
      console.error("[pspSavePost]", err);
      req.flash && req.flash("error", "Failed to save payment settings.");
    }
    res.redirect("/account/settings/finance?section=settings");
  },

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
      const overviewFilters = {
        school_year_id: req.query.year || null,
        term_id:        req.query.term || null,
      };

      const [overview, bills, studentBilling, templates, refs, pspSettings] = await Promise.all([
        loadOverviewStats(orgId, overviewFilters),
        loadBills(orgId),
        loadStudentBilling(orgId),
        loadTemplates(orgId),
        loadClassesAndStudents(orgId),
        loadPspSettings(orgId),
      ]);

      // Mask sensitive secrets before sending to view
      const safePsp = maskPspSecrets(pspSettings);
      const allowedMethods = computeAllowedMethods(pspSettings);

      res.render("account/finance", {
        title: "Finance & Billing",
        section,
        overview,
        bills,
        studentBilling,
        templates,
        refs,
        pspSettings: safePsp,
        allowedMethods,
        stripeCatalog: STRIPE_METHOD_CATALOG,
        money,
        messages: req.flash ? req.flash() : {},
        req,
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
      const ins = await db.query(
        `INSERT INTO finance_fee_templates
          (organization_id, name, description, amount, bill_type, recurrence, late_fee_amount, late_fee_after_days, created_by)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING template_id`,
        [orgId, name, description || null, Number(amount || 0), bill_type || 'one_time',
          recurrence || null, Number(late_fee_amount || 0), Number(late_fee_after_days || 7),
          req.session.user?.user_id || null]
      );
      req.flash("success", "Template created.");
      await logPaygira(req, {
        actionType: "Created",
        recordType: "Fee Template",
        recordId: ins.rows[0]?.template_id,
        recordLabel: name,
        description: `Created fee template "${name}" ($${Number(amount || 0).toFixed(2)}, ${bill_type || 'one_time'}${recurrence ? `/${recurrence}` : ''}).`,
        changedFields: [
          { field: "Amount", value: `$${Number(amount || 0).toFixed(2)}` },
          { field: "Type", value: bill_type || 'one_time' },
          { field: "Recurrence", value: recurrence || '—' },
        ],
      });
    } catch (e) { console.error(e); req.flash("error", "Could not create template."); }
    res.redirect("/account/settings/finance?section=templates");
  },

  templateDeletePost: async (req, res) => {
    if (!(await isFinanceAdmin(req))) return res.redirect("/account/settings");
    const orgId = req.session.organizationId;
    try {
      const t = (await db.query(`SELECT name FROM finance_fee_templates WHERE template_id=$1 AND organization_id=$2`, [req.params.id, orgId])).rows[0];
      await db.query(`DELETE FROM finance_fee_templates WHERE template_id = $1 AND organization_id = $2`,
        [req.params.id, orgId]);
      req.flash("success", "Template deleted.");
      await logPaygira(req, {
        actionType: "Deleted",
        recordType: "Fee Template",
        recordId: req.params.id,
        recordLabel: t?.name || `Template #${req.params.id}`,
        description: `Deleted fee template "${t?.name || req.params.id}".`,
        changedFields: [],
      });
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
        assignee_id: rawAssigneeId,
        payment_destination
      } = req.body;
      const assignee_id = parseInt(rawAssigneeId, 10) || null;
      const destination = ['stripe','cash','bank','momo'].includes(String(payment_destination))
        ? payment_destination : 'stripe';

      const amt = Number(amount || 0);
      const insert = await db.query(
        `INSERT INTO finance_bills
         (organization_id, title, description, amount, bill_type, recurrence,
          late_fee_amount, late_fee_after_days, applies_to, school_year_id, term_id, due_date,
          accepts_card, accepts_cash, accepts_transfer, notify_email, notify_sms, status, created_by, assignee_id, payment_destination)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21)
         RETURNING bill_id`,
        [orgId, title, description || null, amt, bill_type || 'one_time', recurrence || null,
          Number(late_fee_amount || 0), Number(late_fee_after_days || 7),
          applies_to || 'school',
          school_year_id || null, term_id || null,
          due_date || null,
          !!accepts_card, !!accepts_cash, !!accepts_transfer,
          !!notify_email, !!notify_sms,
          status === 'draft' ? 'draft' : 'active',
          req.session.user?.user_id || null, assignee_id, destination]
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
      await logPaygira(req, {
        actionType: "Created",
        recordType: "Bill",
        recordId: billId,
        recordLabel: title,
        description: `Created bill "${title}" ($${amt.toFixed(2)}) — type: ${bill_type || 'one_time'}, applies to ${applies_to || 'school'}, ${studentRows.length} student(s) assigned, destination: ${destination}.`,
        changedFields: [
          { field: "Amount", value: `$${amt.toFixed(2)}` },
          { field: "Bill Type", value: bill_type || 'one_time' },
          { field: "Audience", value: applies_to || 'school' },
          { field: "Assignments", value: String(studentRows.length) },
          { field: "Destination", value: destination },
          { field: "Status", value: status === 'draft' ? 'draft' : 'active' },
        ],
      });
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
      const billRow = (await db.query(`SELECT title FROM finance_bills WHERE bill_id=$1 AND organization_id=$2`, [req.params.id, orgId])).rows[0];
      await db.query(`UPDATE finance_bills SET status='cancelled', updated_at=now() WHERE bill_id=$1 AND organization_id=$2`,
        [req.params.id, orgId]);
      await db.query(`UPDATE finance_bill_assignments SET status='cancelled', updated_at=now()
        WHERE bill_id=$1 AND organization_id=$2 AND status NOT IN ('paid')`, [req.params.id, orgId]);
      req.flash("success", "Bill cancelled.");
      await logPaygira(req, {
        actionType: "Cancelled",
        recordType: "Bill",
        recordId: req.params.id,
        recordLabel: billRow?.title || `Bill #${req.params.id}`,
        description: `Cancelled bill "${billRow?.title || req.params.id}" and revoked all unpaid assignments.`,
        changedFields: [{ field: "Status", value: "cancelled" }],
      });
    } catch (e) { req.flash("error", "Could not cancel bill."); }
    res.redirect("/account/settings/finance?section=bills");
  },

  billDeletePost: async (req, res) => {
    if (!(await isFinanceAdmin(req))) return res.redirect("/account/settings");
    const orgId = req.session.organizationId;
    try {
      const billRow = (await db.query(`SELECT title FROM finance_bills WHERE bill_id=$1 AND organization_id=$2`, [req.params.id, orgId])).rows[0];
      await db.query(`DELETE FROM finance_bills WHERE bill_id=$1 AND organization_id=$2`, [req.params.id, orgId]);
      req.flash("success", "Bill deleted.");
      await logPaygira(req, {
        actionType: "Deleted",
        recordType: "Bill",
        recordId: req.params.id,
        recordLabel: billRow?.title || `Bill #${req.params.id}`,
        description: `Permanently deleted bill "${billRow?.title || req.params.id}".`,
        changedFields: [],
      });
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
      // Resolve student name for log
      let studentLabel = `Student #${row.student_id}`;
      try {
        const sRow = (await db.query(`SELECT first_name, last_name FROM students WHERE student_id=$1 AND organization_id=$2`, [row.student_id, orgId])).rows[0];
        if (sRow) studentLabel = `${sRow.first_name} ${sRow.last_name}`;
      } catch (_) {}
      const billRow = (await db.query(`SELECT title FROM finance_bills WHERE bill_id=$1`, [row.bill_id])).rows[0];
      await logPaygira(req, {
        actionType: "Recorded Payment",
        recordType: "Payment",
        recordId: row.assignment_id,
        recordLabel: `${studentLabel} — ${billRow?.title || ('Bill #' + row.bill_id)}`,
        description: `Recorded $${amt.toFixed(2)} (${method || 'cash'}) for ${studentLabel} on bill "${billRow?.title || row.bill_id}". New status: ${newStatus}${credit > 0 ? `; $${credit.toFixed(2)} credited.` : ''}.`,
        changedFields: [
          { field: "Amount", value: `$${amt.toFixed(2)}` },
          { field: "Method", value: method || 'cash' },
          { field: "Reference", value: reference || '—' },
          { field: "New Status", value: newStatus },
        ],
      });
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
    const billId = req.params.id;
    const {
      title, description, amount, due_date,
      late_fee_amount, late_fee_after_days,
      assignee_id: rawAid,
      bill_type, recurrence,
      school_year_id, term_id,
      payment_destination,
      accepts_card, accepts_cash, accepts_transfer,
      notify_email, notify_sms,
      status,
    } = req.body;
    const edit_assignee_id = parseInt(rawAid, 10) || null;
    const newAmount = Number(amount || 0);
    const validDest = ['stripe','cash','bank','momo'].includes(String(payment_destination)) ? payment_destination : null;
    const validType = ['one_time','recurring','installment'].includes(String(bill_type)) ? bill_type : null;
    const validRec = ['daily','weekly','monthly','term','year'].includes(String(recurrence)) ? recurrence : null;
    const validStatus = ['active','draft','scheduled','cancelled'].includes(String(status)) ? status : null;
    try {
      // Snapshot existing for diff
      const before = (await db.query(
        `SELECT * FROM finance_bills WHERE bill_id=$1 AND organization_id=$2`,
        [billId, orgId]
      )).rows[0];
      if (!before) {
        req.flash("error", "Bill not found.");
        return res.redirect("/account/settings/finance?section=bills");
      }

      const next = {
        title: title ?? before.title,
        description: description ?? before.description,
        amount: newAmount,
        due_date: due_date || null,
        late_fee_amount: Number(late_fee_amount || 0),
        late_fee_after_days: Number(late_fee_after_days || 7),
        assignee_id: edit_assignee_id,
        bill_type: validType || before.bill_type,
        recurrence: validRec, // null clears
        school_year_id: school_year_id ? Number(school_year_id) : null,
        term_id: term_id ? Number(term_id) : null,
        payment_destination: validDest || before.payment_destination || 'stripe',
        accepts_card: !!accepts_card,
        accepts_cash: !!accepts_cash,
        accepts_transfer: !!accepts_transfer,
        notify_email: !!notify_email,
        notify_sms: !!notify_sms,
        status: validStatus || before.status,
      };

      await db.query(
        `UPDATE finance_bills SET
           title=$1, description=$2, amount=$3, due_date=$4,
           late_fee_amount=$5, late_fee_after_days=$6,
           assignee_id=$7,
           bill_type=$8, recurrence=$9,
           school_year_id=$10, term_id=$11,
           payment_destination=$12,
           accepts_card=$13, accepts_cash=$14, accepts_transfer=$15,
           notify_email=$16, notify_sms=$17,
           status=$18,
           updated_at=now()
         WHERE bill_id=$19 AND organization_id=$20`,
        [
          next.title, next.description, next.amount, next.due_date,
          next.late_fee_amount, next.late_fee_after_days,
          next.assignee_id,
          next.bill_type, next.recurrence,
          next.school_year_id, next.term_id,
          next.payment_destination,
          next.accepts_card, next.accepts_cash, next.accepts_transfer,
          next.notify_email, next.notify_sms,
          next.status,
          billId, orgId,
        ]
      );

      // Sync amount on pending/overdue assignments only (don't disturb paid)
      await db.query(
        `UPDATE finance_bill_assignments SET amount=$1, updated_at=now()
         WHERE bill_id=$2 AND organization_id=$3 AND status IN ('pending','overdue')`,
        [newAmount, billId, orgId]
      );

      // Cancel-propagate if status changed to cancelled
      if (next.status === 'cancelled' && before.status !== 'cancelled') {
        await db.query(
          `UPDATE finance_bill_assignments SET status='cancelled', updated_at=now()
           WHERE bill_id=$1 AND organization_id=$2 AND status NOT IN ('paid')`,
          [billId, orgId]
        );
      }

      // Build changed-field diff for activity log
      const fmtVal = (v) => v === null || v === undefined ? "—" : (typeof v === 'boolean' ? (v ? 'Yes' : 'No') : String(v));
      const diffFields = [];
      const cmp = (key, label) => {
        const a = before[key];
        const b = next[key];
        const aN = a instanceof Date ? a.toISOString().slice(0,10) : a;
        const bN = b instanceof Date ? b.toISOString().slice(0,10) : b;
        if (String(aN ?? '') !== String(bN ?? '')) {
          diffFields.push({ field: label, from: fmtVal(aN), to: fmtVal(bN) });
        }
      };
      cmp('title','Title'); cmp('description','Description'); cmp('amount','Amount');
      cmp('due_date','Due Date'); cmp('late_fee_amount','Late Fee'); cmp('late_fee_after_days','Late Fee Days');
      cmp('assignee_id','Assignee'); cmp('bill_type','Bill Type'); cmp('recurrence','Recurrence');
      cmp('school_year_id','School Year'); cmp('term_id','Term'); cmp('payment_destination','Destination');
      cmp('accepts_card','Accept Card'); cmp('accepts_cash','Accept Cash'); cmp('accepts_transfer','Accept Transfer');
      cmp('notify_email','Notify Email'); cmp('notify_sms','Notify SMS'); cmp('status','Status');

      await logPaygira(req, {
        actionType: "Updated",
        recordType: "Bill",
        recordId: billId,
        recordLabel: next.title,
        description: diffFields.length
          ? `Updated bill "${next.title}" — ${diffFields.map(d => `${d.field}: ${d.from} → ${d.to}`).slice(0, 6).join(" · ")}${diffFields.length > 6 ? ` …(+${diffFields.length - 6} more)` : ""}.`
          : `Re-saved bill "${next.title}" (no field changes).`,
        changedFields: diffFields,
      });

      req.flash("success", "Bill updated.");
    } catch (e) { console.error("[billEdit]", e); req.flash("error", "Could not update bill: " + e.message); }
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
      await logPaygira(req, {
        actionType: "Swept",
        recordType: "Overdue Sweep",
        recordId: null,
        recordLabel: "Overdue Sweep",
        description: `Ran overdue sweep — ${fees.rows.length} late fee(s) applied to overdue assignments.`,
        changedFields: [{ field: "Late Fees Applied", value: String(fees.rows.length) }],
      });
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
      const billRow = (await db.query(`SELECT title FROM finance_bills WHERE bill_id=$1 AND organization_id=$2`, [req.params.id, orgId])).rows[0];
      req.flash("success", "Reminder sent to all outstanding assignees.");
      await logPaygira(req, {
        actionType: "Sent Reminder",
        recordType: "Bill",
        recordId: req.params.id,
        recordLabel: billRow?.title || `Bill #${req.params.id}`,
        description: `Sent reminder to outstanding assignees for bill "${billRow?.title || req.params.id}".`,
        changedFields: [],
      });
    } catch (e) { req.flash("error", "Could not send reminder."); }
    res.redirect("/account/settings/finance?section=bills");
  },

  // ===================================================================
  //  STAFF — "My PayGira": bills where assignee_id = current user
  //  Accessible to Teachers / Class Teachers / Supervisors / Managers
  //  assigned to collect or oversee a bill. Org-scoped.
  // ===================================================================
  staffMyPaygiraGet: async (req, res) => {
    const orgId = req.session.organizationId;
    const userId = req.session.user?.user_id || req.session.userId || null;
    if (!orgId || !userId) return res.redirect("/account/login");
    try {
      const isEmbedded = String(req.query.embed || '').toLowerCase() === 'workspace';
      await ensureFinanceSchema();
      await ensureAssigneeColumn();

      // All bills assigned to me as collector/overseer
      const billsR = await db.query(
        `SELECT b.*,
                (SELECT COUNT(*) FROM finance_bill_assignments a WHERE a.bill_id=b.bill_id)               AS assigned_count,
                (SELECT COALESCE(SUM(a.amount),0)      FROM finance_bill_assignments a WHERE a.bill_id=b.bill_id) AS total_amount,
                (SELECT COALESCE(SUM(a.amount_paid),0) FROM finance_bill_assignments a WHERE a.bill_id=b.bill_id) AS total_paid,
                (SELECT COALESCE(SUM(GREATEST(a.amount + a.late_fee_applied - a.amount_paid, 0)),0)
                   FROM finance_bill_assignments a WHERE a.bill_id=b.bill_id)                            AS total_outstanding
           FROM finance_bills b
          WHERE b.organization_id = $1 AND b.assignee_id = $2
          ORDER BY b.due_date NULLS LAST, b.created_at DESC`,
        [orgId, userId]
      );

      // All outstanding per-student assignments under my bills
      const assignmentsR = await db.query(
        `SELECT a.*, b.title AS bill_title, b.due_date,
                s.first_name, s.last_name, s.image_url, c.class_name
           FROM finance_bill_assignments a
           JOIN finance_bills b ON b.bill_id = a.bill_id
           JOIN students s ON s.student_id = a.student_id
           LEFT JOIN classes c ON c.class_id = s.class_id
          WHERE a.organization_id = $1 AND b.assignee_id = $2
          ORDER BY a.status DESC, b.due_date NULLS LAST, s.last_name`,
        [orgId, userId]
      );

      // Aggregate totals across my assigned bills
      const stats = {
        bills:        billsR.rows.length,
        students:     assignmentsR.rows.length,
        billed:       assignmentsR.rows.reduce((s, a) => s + Number(a.amount || 0), 0),
        collected:    assignmentsR.rows.reduce((s, a) => s + Number(a.amount_paid || 0), 0),
        outstanding:  assignmentsR.rows.reduce((s, a) =>
                          s + Math.max(Number(a.amount || 0) + Number(a.late_fee_applied || 0) - Number(a.amount_paid || 0), 0), 0),
      };

      const pspSettings = await loadPspSettings(orgId);
      const allowedMethods = computeAllowedMethods(pspSettings);

      res.render("account/myPaygira", {
        title: "My PayGira",
        bills: billsR.rows,
        assignments: assignmentsR.rows,
        stats,
        allowedMethods,
        money,
        messages: req.flash ? req.flash() : {},
        isEmbedded,
        hideGlobalHeader: isEmbedded,
        hideGlobalFooter: isEmbedded,
        hideGlobalChatbot: isEmbedded,
      });
    } catch (err) {
      console.error("[staffMyPaygiraGet]", err);
      req.flash && req.flash("error", "Unable to load My PayGira.");
      res.redirect("/account/settings");
    }
  },

  // POST /account/my-paygira/collect — staff collector records a payment
  staffMyPaygiraCollectPost: async (req, res) => {
    const orgId = req.session.organizationId;
    const userId = req.session.user?.user_id || req.session.userId || null;
    if (!orgId || !userId) return res.redirect("/account/login");
    const { assignment_id, amount, method, reference, notes } = req.body;
    const isEmbedded = String((req.query && req.query.embed) || req.body.embedMode || '').toLowerCase() === 'workspace';
    const paygiraRedirectPath = isEmbedded ? "/account/settings/my-paygira?embed=workspace" : "/account/settings/my-paygira";
    try {
      // Verify the assignment belongs to a bill where this user is the assignee
      const a = await db.query(
        `SELECT a.*, b.due_date, b.assignee_id,
                b.accepts_card, b.accepts_cash, b.accepts_transfer, b.payment_destination
           FROM finance_bill_assignments a
           JOIN finance_bills b ON b.bill_id = a.bill_id
          WHERE a.assignment_id=$1 AND a.organization_id=$2`,
        [assignment_id, orgId]
      );
      if (!a.rows.length || a.rows[0].assignee_id !== userId) {
        req.flash && req.flash("error", "Not authorized to collect for this bill.");
        return res.redirect(paygiraRedirectPath);
      }
      const row = a.rows[0];
      const amt = Number(amount || 0);
      if (amt <= 0) {
        req.flash && req.flash("error", "Enter a valid amount.");
        return res.redirect(paygiraRedirectPath);
      }

      // Validate the method against what the school has enabled + what the bill accepts
      const psp = await loadPspSettings(orgId);
      const allow = computeAllowedMethods(psp);
      const requested = String(method || 'cash').toLowerCase();
      const ok =
        (requested === 'cash'          && row.accepts_cash)     ||
        (requested === 'bank_transfer' && row.accepts_transfer && allow.bankOn) ||
        (requested === 'mobile_money'  && allow.momoOn)         ||
        (requested === 'card'          && row.accepts_card && allow.stripeOn) ||
        (requested === 'stripe'        && row.accepts_card && allow.stripeOn) ||
        (requested === 'other');
      if (!ok) {
        req.flash && req.flash("error", `Method "${requested}" is not enabled on this bill / school. Update Payment Settings.`);
        return res.redirect(paygiraRedirectPath);
      }

      await db.query(
        `INSERT INTO finance_payments
          (organization_id, assignment_id, bill_id, student_id, amount, method, reference, notes, received_by)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
        [orgId, row.assignment_id, row.bill_id, row.student_id, amt,
          requested, reference || null, notes || null, userId]
      );

      const newPaid = Number(row.amount_paid) + amt;
      const total = Number(row.amount) + Number(row.late_fee_applied || 0);
      let credit = 0;
      let appliedToAssignment = newPaid;
      if (newPaid > total) { credit = newPaid - total; appliedToAssignment = total; }
      const newStatus = recalcAssignmentStatus(row.amount, row.late_fee_applied, appliedToAssignment, row.due_date);
      await db.query(
        `UPDATE finance_bill_assignments SET amount_paid=$1, status=$2, updated_at=now() WHERE assignment_id=$3`,
        [appliedToAssignment, newStatus, row.assignment_id]
      );
      if (credit > 0) {
        await db.query(
          `INSERT INTO finance_student_credits (organization_id, student_id, amount)
             VALUES ($1,$2,$3)
           ON CONFLICT (student_id) DO UPDATE
              SET amount = finance_student_credits.amount + EXCLUDED.amount, updated_at=now()`,
          [orgId, row.student_id, credit]
        );
      }
      req.flash && req.flash("success", credit > 0
        ? `Collected $${amt.toFixed(2)}. $${credit.toFixed(2)} added as student credit.`
        : `Collected $${amt.toFixed(2)} from this student.`);
      // Audit log
      try {
        const sRow = (await db.query(`SELECT first_name, last_name FROM students WHERE student_id=$1 AND organization_id=$2`, [row.student_id, orgId])).rows[0];
        const bRow = (await db.query(`SELECT title FROM finance_bills WHERE bill_id=$1 AND organization_id=$2`, [row.bill_id, orgId])).rows[0];
        const studentLabel = sRow ? `${sRow.first_name} ${sRow.last_name}` : `Student #${row.student_id}`;
        await logPaygira(req, {
          actionType: "Collected",
          recordType: "Payment",
          recordId: row.assignment_id,
          recordLabel: `${studentLabel} — ${bRow?.title || 'Bill'}`,
          description: `Collector recorded $${amt.toFixed(2)} (${requested}) for ${studentLabel} on bill "${bRow?.title || row.bill_id}". New status: ${newStatus}${credit > 0 ? `; $${credit.toFixed(2)} credited.` : ''}.`,
          changedFields: [
            { field: "Amount", value: `$${amt.toFixed(2)}` },
            { field: "Method", value: requested },
            { field: "Reference", value: reference || '—' },
            { field: "New Status", value: newStatus },
          ],
        });
      } catch (_) {}
    } catch (e) {
      console.error("[staffMyPaygiraCollectPost]", e);
      req.flash && req.flash("error", "Could not record collection: " + e.message);
    }
    res.redirect(paygiraRedirectPath);
  },

  // ===================================================================
  //  GUARDIAN / PARENT PORTAL — PayGira
  //  Lists bills for all the guardian's linked students and lets them pay.
  // ===================================================================
  guardianPaygiraGet: async (req, res, dbArg) => {
    const database = dbArg || db;
    const orgId = req.session.organizationId;
    const guardianId = req.session.guardianId;
    if (!orgId || !guardianId) return res.redirect("/account/login");
    try {
      await ensureFinanceSchema();
      await ensureGuardianCardsSchema();

      // Children linked to this guardian (covers both legacy guardians + guardian_students)
      const kidsR = await database.query(
        `SELECT DISTINCT s.student_id, s.first_name, s.last_name, s.image_url,
                c.class_name
           FROM students s
           LEFT JOIN classes c ON c.class_id = s.class_id
          WHERE s.organization_id = $1
            AND (
              EXISTS (SELECT 1 FROM guardians g
                       WHERE g.student_id=s.student_id AND g.guardian_id=$2 AND g.organization_id=$1)
              OR EXISTS (SELECT 1 FROM guardian_students gs
                       WHERE gs.student_id=s.student_id AND gs.guardian_id=$2)
            )
          ORDER BY s.first_name`,
        [orgId, guardianId]
      );
      const children = kidsR.rows;
      const studentIds = children.map(c => c.student_id);

      // All bill assignments for those children
      let assignments = [];
      let payments = [];
      if (studentIds.length) {
        const r = await database.query(
          `SELECT a.*, b.title AS bill_title, b.description AS bill_description,
                  b.due_date, b.bill_type, b.accepts_card, b.accepts_cash, b.accepts_transfer,
                  b.payment_destination,
                  s.first_name, s.last_name, s.image_url, s.student_id
             FROM finance_bill_assignments a
             JOIN finance_bills b ON b.bill_id = a.bill_id
             JOIN students s ON s.student_id = a.student_id
            WHERE a.organization_id = $1 AND a.student_id = ANY($2::int[])
            ORDER BY a.status, b.due_date NULLS LAST`,
          [orgId, studentIds]
        );
        assignments = r.rows;

        const p = await database.query(
          `SELECT p.payment_id, p.amount, p.method, p.received_at, p.reference,
                  s.first_name, s.last_name, b.title AS bill_title
             FROM finance_payments p
             LEFT JOIN students s ON s.student_id = p.student_id
             LEFT JOIN finance_bills b ON b.bill_id = p.bill_id
            WHERE p.organization_id=$1 AND p.student_id = ANY($2::int[])
            ORDER BY p.received_at DESC LIMIT 30`,
          [orgId, studentIds]
        );
        payments = p.rows;
      }

      // Saved payment cards on file (last 4 only — never PAN)
      const cardsR = await database.query(
        `SELECT card_id, brand, last4, holder_name, exp_month, exp_year, is_default, student_id
           FROM guardian_payment_methods
          WHERE guardian_id=$1 AND organization_id=$2
          ORDER BY is_default DESC, created_at DESC`,
        [guardianId, orgId]
      );

      // Aggregate per-student totals
      const totals = {
        billed:      assignments.reduce((s, a) => s + Number(a.amount || 0), 0),
        paid:        assignments.reduce((s, a) => s + Number(a.amount_paid || 0), 0),
        outstanding: assignments.reduce((s, a) =>
                        s + Math.max(Number(a.amount || 0) + Number(a.late_fee_applied || 0) - Number(a.amount_paid || 0), 0), 0),
      };

      // Guardian profile for header
      const gp = await database.query(
        `SELECT first_name, last_name, image_url FROM guardian_profiles WHERE guardian_id=$1 AND organization_id=$2`,
        [guardianId, orgId]
      );

      // Payment options available to this guardian (set by the school)
      const pspSettings = await loadPspSettings(orgId);
      const maskedPsp = maskPspSecrets(pspSettings);
      const allowedMethods = computeAllowedMethods(pspSettings);

      res.render("guardian/paygira", {
        title: "PayGira — Pay Bills",
        guardian: gp.rows[0] || {},
        children,
        assignments,
        payments,
        cards: cardsR.rows,
        totals,
        pspSettings: maskedPsp,
        allowedMethods,
        money,
        messages: req.flash ? req.flash() : {},
        req,
      });
    } catch (err) {
      console.error("[guardianPaygiraGet]", err);
      req.flash && req.flash("error", "Unable to load PayGira.");
      res.redirect("/guardian/dashboard");
    }
  },

  // Guardian pays a bill (one assignment). Uses saved card metadata or generic.
  guardianPaygiraPayPost: async (req, res, dbArg) => {
    const database = dbArg || db;
    const orgId = req.session.organizationId;
    const guardianId = req.session.guardianId;
    if (!orgId || !guardianId) return res.redirect("/account/login");
    const { assignment_id, amount, card_id, method } = req.body;
    try {
      // Verify this assignment belongs to a student linked to this guardian
      const verify = await database.query(
        `SELECT a.*, b.due_date, b.accepts_card, b.accepts_cash, b.accepts_transfer, b.payment_destination
           FROM finance_bill_assignments a
           JOIN finance_bills b ON b.bill_id = a.bill_id
          WHERE a.assignment_id=$1 AND a.organization_id=$2
            AND (
              EXISTS (SELECT 1 FROM guardians g
                       WHERE g.student_id=a.student_id AND g.guardian_id=$3 AND g.organization_id=$2)
              OR EXISTS (SELECT 1 FROM guardian_students gs
                       WHERE gs.student_id=a.student_id AND gs.guardian_id=$3)
            )
          LIMIT 1`,
        [assignment_id, orgId, guardianId]
      );
      if (!verify.rows.length) {
        req.flash && req.flash("error", "Not authorized to pay this bill.");
        return res.redirect("/guardian/paygira");
      }
      const row = verify.rows[0];
      const amt = Number(amount || 0);
      if (amt <= 0) {
        req.flash && req.flash("error", "Enter a valid amount.");
        return res.redirect("/guardian/paygira");
      }

      // Validate the chosen method against what the school has enabled + bill's accepted methods
      const psp = await loadPspSettings(orgId);
      const allow = computeAllowedMethods(psp);
      const requested = String(method || "card").toLowerCase();
      const ok =
        (requested === 'card'          && row.accepts_card && allow.stripeOn) ||
        (requested === 'stripe'        && row.accepts_card && allow.stripeOn) ||
        (requested === 'bank_transfer' && row.accepts_transfer && allow.bankOn) ||
        (requested === 'mobile_money'  && allow.momoOn) ||
        (requested === 'other');
      if (!ok) {
        req.flash && req.flash("error", `This bill does not accept "${requested}". Choose a method the school has enabled.`);
        return res.redirect("/guardian/paygira");
      }

      // Build a reference label from saved card if used
      let reference = `GUARDIAN-${guardianId}`;
      let payMethod = requested;
      if (card_id && (requested === 'card' || requested === 'stripe')) {
        const c = await database.query(
          `SELECT brand, last4 FROM guardian_payment_methods
            WHERE card_id=$1 AND guardian_id=$2 AND organization_id=$3`,
          [parseInt(card_id, 10) || 0, guardianId, orgId]
        );
        if (c.rows.length) {
          reference = `${c.rows[0].brand || "CARD"} •••• ${c.rows[0].last4}`;
          payMethod = "card";
        }
      }

      await database.query(
        `INSERT INTO finance_payments
          (organization_id, assignment_id, bill_id, student_id, amount, method, reference, notes)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
        [orgId, row.assignment_id, row.bill_id, row.student_id, amt,
          payMethod, reference, `Guardian portal payment by guardian #${guardianId}`]
      );

      const newPaid = Number(row.amount_paid) + amt;
      const total = Number(row.amount) + Number(row.late_fee_applied || 0);
      let credit = 0;
      let appliedToAssignment = newPaid;
      if (newPaid > total) { credit = newPaid - total; appliedToAssignment = total; }
      const newStatus = recalcAssignmentStatus(row.amount, row.late_fee_applied, appliedToAssignment, row.due_date);
      await database.query(
        `UPDATE finance_bill_assignments SET amount_paid=$1, status=$2, updated_at=now() WHERE assignment_id=$3`,
        [appliedToAssignment, newStatus, row.assignment_id]
      );
      if (credit > 0) {
        await database.query(
          `INSERT INTO finance_student_credits (organization_id, student_id, amount)
             VALUES ($1,$2,$3)
           ON CONFLICT (student_id) DO UPDATE
              SET amount = finance_student_credits.amount + EXCLUDED.amount, updated_at=now()`,
          [orgId, row.student_id, credit]
        );
      }
      req.flash && req.flash("success", credit > 0
        ? `Payment of $${amt.toFixed(2)} received. $${credit.toFixed(2)} kept as credit.`
        : `Payment of $${amt.toFixed(2)} received. Thank you.`);
      // Audit log (guardian-initiated)
      try {
        const gRow = (await database.query(`SELECT first_name, last_name FROM guardians WHERE guardian_id=$1 LIMIT 1`, [guardianId])).rows[0];
        const sRow = (await database.query(`SELECT first_name, last_name FROM students WHERE student_id=$1 AND organization_id=$2`, [row.student_id, orgId])).rows[0];
        const bRow = (await database.query(`SELECT title FROM finance_bills WHERE bill_id=$1 AND organization_id=$2`, [row.bill_id, orgId])).rows[0];
        const studentLabel = sRow ? `${sRow.first_name} ${sRow.last_name}` : `Student #${row.student_id}`;
        const guardianName = gRow ? `${gRow.first_name || ''} ${gRow.last_name || ''}`.trim() : `Guardian #${guardianId}`;
        await logPaygira(req, {
          userName: guardianName,
          userRole: "Guardian",
          actionType: "Paid",
          recordType: "Payment",
          recordId: row.assignment_id,
          recordLabel: `${studentLabel} — ${bRow?.title || 'Bill'}`,
          description: `Guardian ${guardianName} paid $${amt.toFixed(2)} (${payMethod}) for ${studentLabel} on bill "${bRow?.title || row.bill_id}". New status: ${newStatus}${credit > 0 ? `; $${credit.toFixed(2)} credited.` : ''}.`,
          changedFields: [
            { field: "Amount", value: `$${amt.toFixed(2)}` },
            { field: "Method", value: payMethod },
            { field: "Reference", value: reference || '—' },
            { field: "New Status", value: newStatus },
          ],
        });
      } catch (_) {}
    } catch (e) {
      console.error("[guardianPaygiraPayPost]", e);
      req.flash && req.flash("error", "Payment could not be processed: " + e.message);
    }
    res.redirect("/guardian/paygira");
  },

  // ===================================================================
  //  GUARDIAN — Saved Payment Cards (PayGira wallet)
  //  IMPORTANT: we never store a raw PAN. Only brand, last4, holder, exp.
  //  Replace the storage layer with a tokenized PSP (Stripe) in prod.
  // ===================================================================
  guardianCardAddPost: async (req, res, dbArg) => {
    const database = dbArg || db;
    const orgId = req.session.organizationId;
    const guardianId = req.session.guardianId;
    if (!orgId || !guardianId) return res.redirect("/account/login");
    try {
      await ensureGuardianCardsSchema();
      const { card_number, holder_name, exp_month, exp_year, brand, child_student_id, set_default } = req.body;
      const digits = String(card_number || "").replace(/\D/g, "");
      if (digits.length < 12 || digits.length > 19) {
        req.flash && req.flash("error", "Invalid card number.");
        return res.redirect("/guardian/settings#cards");
      }
      const last4 = digits.slice(-4);
      const inferredBrand = (brand && String(brand).trim()) || inferCardBrand(digits);
      const mm = parseInt(exp_month, 10) || null;
      const yy = parseInt(exp_year, 10) || null;
      const childId = parseInt(child_student_id, 10) || null;

      // If child specified, verify this guardian is linked to that student
      if (childId) {
        const own = await database.query(
          `SELECT 1 FROM students s
            WHERE s.student_id=$1 AND s.organization_id=$2
              AND (
                EXISTS (SELECT 1 FROM guardians g
                         WHERE g.student_id=s.student_id AND g.guardian_id=$3 AND g.organization_id=$2)
                OR EXISTS (SELECT 1 FROM guardian_students gs
                         WHERE gs.student_id=s.student_id AND gs.guardian_id=$3)
              )
            LIMIT 1`,
          [childId, orgId, guardianId]
        );
        if (!own.rows.length) {
          req.flash && req.flash("error", "Selected child is not linked to your account.");
          return res.redirect("/guardian/settings#cards");
        }
      }

      // Make this card default if it's the first one or user asked for it
      const existing = await database.query(
        `SELECT COUNT(*)::int AS n FROM guardian_payment_methods WHERE guardian_id=$1 AND organization_id=$2`,
        [guardianId, orgId]
      );
      const makeDefault = !!set_default || existing.rows[0].n === 0;
      if (makeDefault) {
        await database.query(
          `UPDATE guardian_payment_methods SET is_default=false
            WHERE guardian_id=$1 AND organization_id=$2`,
          [guardianId, orgId]
        );
      }
      await database.query(
        `INSERT INTO guardian_payment_methods
          (guardian_id, organization_id, brand, last4, holder_name, exp_month, exp_year, is_default, student_id)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
        [guardianId, orgId, inferredBrand, last4, holder_name || null, mm, yy, makeDefault, childId]
      );
      req.flash && req.flash("success", `Card •••• ${last4} added securely.`);
      await logPaygira(req, {
        actionType: "Saved Card",
        recordType: "Payment Method",
        recordId: null,
        recordLabel: `${inferredBrand} •••• ${last4}`,
        description: `Guardian added saved card ${inferredBrand} •••• ${last4}${makeDefault ? ' (default)' : ''}.`,
        changedFields: [
          { field: "Brand", value: inferredBrand },
          { field: "Last 4", value: last4 },
          { field: "Default", value: makeDefault ? 'Yes' : 'No' },
        ],
      });
    } catch (e) {
      console.error("[guardianCardAddPost]", e);
      req.flash && req.flash("error", "Could not save card: " + e.message);
    }
    res.redirect("/guardian/settings#cards");
  },

  guardianCardDeletePost: async (req, res, dbArg) => {
    const database = dbArg || db;
    const orgId = req.session.organizationId;
    const guardianId = req.session.guardianId;
    if (!orgId || !guardianId) return res.redirect("/account/login");
    try {
      await database.query(
        `DELETE FROM guardian_payment_methods WHERE card_id=$1 AND guardian_id=$2 AND organization_id=$3`,
        [req.params.id, guardianId, orgId]
      );
      req.flash && req.flash("success", "Card removed.");
      await logPaygira(req, {
        actionType: "Deleted Card",
        recordType: "Payment Method",
        recordId: req.params.id,
        recordLabel: `Card #${req.params.id}`,
        description: `Guardian removed saved payment method #${req.params.id}.`,
        changedFields: [],
      });
    } catch (e) { req.flash && req.flash("error", "Could not remove card."); }
    res.redirect("/guardian/settings#cards");
  },

  guardianCardDefaultPost: async (req, res, dbArg) => {
    const database = dbArg || db;
    const orgId = req.session.organizationId;
    const guardianId = req.session.guardianId;
    if (!orgId || !guardianId) return res.redirect("/account/login");
    try {
      await database.query(
        `UPDATE guardian_payment_methods SET is_default=false WHERE guardian_id=$1 AND organization_id=$2`,
        [guardianId, orgId]
      );
      await database.query(
        `UPDATE guardian_payment_methods SET is_default=true WHERE card_id=$1 AND guardian_id=$2 AND organization_id=$3`,
        [req.params.id, guardianId, orgId]
      );
      req.flash && req.flash("success", "Default card updated.");
      await logPaygira(req, {
        actionType: "Updated Card",
        recordType: "Payment Method",
        recordId: req.params.id,
        recordLabel: `Card #${req.params.id}`,
        description: `Guardian set payment method #${req.params.id} as default.`,
        changedFields: [{ field: "Default", value: "Yes" }],
      });
    } catch (e) { req.flash && req.flash("error", "Could not update card."); }
    res.redirect("/guardian/settings#cards");
  },

  // ===================================================================
  //  INVOICES & RECEIPTS — staff (assignee) + guardian (parent of student)
  //  Both endpoints are org-scoped and verify the caller is authorized
  //  to view the underlying assignment/payment.
  // ===================================================================
  /**
   * Render an invoice for one assignment.
   * Route: GET /account/settings/my-paygira/invoice/:assignmentId
   *        GET /guardian/paygira/invoice/:assignmentId
   */
  invoiceGet: async (req, res, dbArg) => {
    const database = dbArg || db;
    const orgId = req.session.organizationId;
    const userId = req.session.user?.user_id || req.session.userId || null;
    const guardianId = req.session.guardianId || null;
    if (!orgId || (!userId && !guardianId)) return res.redirect("/account/login");
    const assignmentId = parseInt(req.params.assignmentId, 10);
    if (!assignmentId) return res.status(400).send("Invalid invoice.");
    try {
      const r = await database.query(
        `SELECT a.*, b.title AS bill_title, b.description AS bill_description,
                b.due_date, b.bill_type, b.recurrence, b.assignee_id,
                s.first_name, s.last_name, s.image_url,
                c.class_name,
                o.organization_name, o.email AS org_email, o.organization_phone AS org_phone, o.organization_address AS org_address, o.logo_path AS org_logo
           FROM finance_bill_assignments a
           JOIN finance_bills b ON b.bill_id = a.bill_id
           JOIN students s ON s.student_id = a.student_id
           LEFT JOIN classes c ON c.class_id = s.class_id
           LEFT JOIN organizations o ON o.organization_id = a.organization_id
          WHERE a.assignment_id = $1 AND a.organization_id = $2
          LIMIT 1`,
        [assignmentId, orgId]
      );
      if (!r.rows.length) return res.status(404).send("Invoice not found.");
      const row = r.rows[0];

      // Authorization
      let authorized = false;
      if (userId && row.assignee_id === userId) authorized = true;
      // org admin?
      if (!authorized && userId) authorized = await isFinanceAdmin(req);
      if (!authorized && guardianId) {
        const g = await database.query(
          `SELECT 1 FROM guardians WHERE student_id=$1 AND guardian_id=$2 AND organization_id=$3
            UNION SELECT 1 FROM guardian_students WHERE student_id=$1 AND guardian_id=$2 LIMIT 1`,
          [row.student_id, guardianId, orgId]
        );
        if (g.rows.length) authorized = true;
      }
      if (!authorized) return res.status(403).send("Not authorized to view this invoice.");

      // Payment history for this assignment
      const pays = await database.query(
        `SELECT amount, method, reference, received_at
           FROM finance_payments
          WHERE assignment_id=$1 AND organization_id=$2
          ORDER BY received_at`,
        [assignmentId, orgId]
      );

      res.render("finance/invoice", {
        layout: false,
        assignment: row,
        payments: pays.rows,
        money,
        balance: Math.max(Number(row.amount || 0) + Number(row.late_fee_applied || 0) - Number(row.amount_paid || 0), 0),
      });
    } catch (e) {
      console.error("[invoiceGet]", e);
      res.status(500).send("Unable to render invoice.");
    }
  },

  /**
   * Render a receipt for one payment.
   * Route: GET /account/settings/my-paygira/receipt/:paymentId
   *        GET /guardian/paygira/receipt/:paymentId
   */
  receiptGet: async (req, res, dbArg) => {
    const database = dbArg || db;
    const orgId = req.session.organizationId;
    const userId = req.session.user?.user_id || req.session.userId || null;
    const guardianId = req.session.guardianId || null;
    if (!orgId || (!userId && !guardianId)) return res.redirect("/account/login");
    const paymentId = parseInt(req.params.paymentId, 10);
    if (!paymentId) return res.status(400).send("Invalid receipt.");
    try {
      const r = await database.query(
        `SELECT p.*, b.title AS bill_title, b.assignee_id, b.due_date,
                s.first_name, s.last_name, s.image_url, s.student_id,
                c.class_name,
                a.amount AS assignment_amount, a.amount_paid AS assignment_paid,
                a.late_fee_applied AS assignment_late_fee,
                o.organization_name, o.email AS org_email, o.organization_phone AS org_phone, o.organization_address AS org_address, o.logo_path AS org_logo,
                u.first_name AS recv_first, u.last_name AS recv_last
           FROM finance_payments p
           LEFT JOIN finance_bills b ON b.bill_id = p.bill_id
           LEFT JOIN finance_bill_assignments a ON a.assignment_id = p.assignment_id
           LEFT JOIN students s ON s.student_id = p.student_id
           LEFT JOIN classes c ON c.class_id = s.class_id
           LEFT JOIN organizations o ON o.organization_id = p.organization_id
           LEFT JOIN users u ON u.user_id = p.received_by
          WHERE p.payment_id = $1 AND p.organization_id = $2
          LIMIT 1`,
        [paymentId, orgId]
      );
      if (!r.rows.length) return res.status(404).send("Receipt not found.");
      const row = r.rows[0];

      // Authorization
      let authorized = false;
      if (userId && (row.received_by === userId || row.assignee_id === userId)) authorized = true;
      if (!authorized && userId) authorized = await isFinanceAdmin(req);
      if (!authorized && guardianId && row.student_id) {
        const g = await database.query(
          `SELECT 1 FROM guardians WHERE student_id=$1 AND guardian_id=$2 AND organization_id=$3
            UNION SELECT 1 FROM guardian_students WHERE student_id=$1 AND guardian_id=$2 LIMIT 1`,
          [row.student_id, guardianId, orgId]
        );
        if (g.rows.length) authorized = true;
      }
      if (!authorized) return res.status(403).send("Not authorized to view this receipt.");

      res.render("finance/receipt", {
        layout: false,
        payment: row,
        money,
      });
    } catch (e) {
      console.error("[receiptGet]", e);
      res.status(500).send("Unable to render receipt.");
    }
  },
};

// ----- helpers shared across guardian payment methods -----
let _gCardsReady = false;
async function ensureGuardianCardsSchema() {
  if (_gCardsReady) return;
  try {
    await db.query(`
      CREATE TABLE IF NOT EXISTS guardian_payment_methods (
        card_id          SERIAL PRIMARY KEY,
        guardian_id      INT NOT NULL,
        organization_id  INT NOT NULL,
        brand            VARCHAR(40),
        last4            VARCHAR(4) NOT NULL,
        holder_name      VARCHAR(120),
        exp_month        SMALLINT,
        exp_year         SMALLINT,
        is_default       BOOLEAN NOT NULL DEFAULT FALSE,
        student_id       INT,
        created_at       TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
      )
    `);
    await db.query(`CREATE INDEX IF NOT EXISTS idx_gpm_guardian ON guardian_payment_methods(guardian_id, organization_id)`);
  } catch (e) { console.error("[ensureGuardianCardsSchema]", e.message); }
  _gCardsReady = true;
}

function inferCardBrand(digits) {
  if (/^4/.test(digits))                return "Visa";
  if (/^(5[1-5]|2[2-7])/.test(digits))  return "Mastercard";
  if (/^3[47]/.test(digits))            return "Amex";
  if (/^6(011|5)/.test(digits))         return "Discover";
  if (/^(50|56|57|58|6\d)/.test(digits)) return "Verve";
  return "Card";
}

