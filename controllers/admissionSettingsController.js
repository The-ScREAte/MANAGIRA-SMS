// Admissions > Admission Settings: online admission (open/close, dates, fee)
// and the student form fields (utils/studentFormFields.js).
const db = require("../config/db");
const fields = require("../utils/studentFormFields");
const websiteExtras = require("../utils/websiteExtras");
const { userHasPermission, PERMISSIONS } = require("../middleware/permissionMiddleware");

function actor(req) {
  const s = req.session || {};
  return {
    userId: s.user?.user_id || s.userId || null,
    userRole: s.userRole || s.user?.account_type || null,
    organizationId: s.organizationId || null,
    accountType: s.accountType || s.user?.account_type || null,
    userEmail: s.user?.email || null,
  };
}

const canManage = (req) => userHasPermission(db, actor(req), PERMISSIONS.MANAGE_SETTINGS).catch(() => false);

// Online admission needs the school website (its Apply Now button).
const hasWebsite = (res) => {
  const features = Array.isArray(res.locals.allowedFeatures) ? res.locals.allowedFeatures : [];
  return features.includes("School Website") || features.includes("SchoolWebsite");
};

function fail(res, err, fallback) {
  if (err instanceof fields.FieldError) return res.status(err.status).json({ success: false, error: err.message });
  console.error(`[AdmissionSettings] ${fallback}:`, err.message);
  return res.status(500).json({ success: false, error: fallback });
}

module.exports = {
  // GET /common/admissionSettings?tab=online|forms
  page: async (req, res) => {
    if (!(await canManage(req))) {
      req.flash("error", "You don't have permission to change admission settings.");
      return res.redirect("/common/admissions");
    }
    try {
      const organizationId = Number(req.session.organizationId);
      const website = hasWebsite(res);
      const [orgRow, list] = await Promise.all([
        db.query(
          `SELECT public_registration_enabled, registration_start_date, registration_end_date,
                  public_registration_price, public_registration_currency
             FROM organizations WHERE organization_id = $1`,
          [organizationId]
        ),
        fields.listFields(db, organizationId),
      ]);
      const org = orgRow.rows[0] || {};
      const tab = website && req.query.tab !== "forms" ? "online" : "forms";
      return res.render("common/admissionSettings", {
        title: "Admission Settings",
        tab,
        hasWebsite: website,
        org,
        organizationId,
        registrationStatus: websiteExtras.registrationState(org),
        formFields: list,
        fieldTypes: fields.FIELD_TYPES,
        standardFields: fields.STANDARD_FIELDS,
        fieldSections: fields.SECTIONS,
        messages: req.flash(),
      });
    } catch (err) {
      console.error("[AdmissionSettings] page failed:", err.message);
      req.flash("error", "Could not load admission settings.");
      return res.redirect("/common/admissions");
    }
  },

  // JSON API behind the Forms tab.
  fieldsApi: (action) => async (req, res) => {
    try {
      if (!(await canManage(req))) return res.status(403).json({ success: false, error: "You don't have permission to change admission settings." });
      const organizationId = Number(req.session.organizationId);
      const id = Number(req.params.id) || null;
      const body = req.body || {};
      if (action === "create") await fields.createField(db, organizationId, body, actor(req).userId);
      if (action === "update") await fields.updateField(db, organizationId, id, body);
      if (action === "status") await fields.setFieldStatus(db, organizationId, id, body.status);
      if (action === "delete") await fields.deleteField(db, organizationId, id);
      if (action === "order") await fields.saveOrder(db, organizationId, body.ids, body.sections);
      return res.json({ success: true, fields: await fields.listFields(db, organizationId) });
    } catch (err) {
      return fail(res, err, "Could not save the form.");
    }
  },
};
