// Admissions > Admission Settings: online admission (open/close, dates, fee)
// and the student form fields (utils/studentFormFields.js).
const db = require("../config/db");
const fields = require("../utils/studentFormFields");
const websiteExtras = require("../utils/websiteExtras");
const contacts = require("../utils/contacts");
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

const canManage = (req) => userHasPermission(db, actor(req), PERMISSIONS.SETTINGS_ADMISSIONS).catch(() => false);
// The parents and guardians fields (the contact template) are edited here too: one
// place for everything a school records about its students and their families.
const canEditFamily = (req) => userHasPermission(db, actor(req), PERMISSIONS.EDIT_CONTACT_TEMPLATE).catch(() => false);

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
  // GET /common/admissionSettings?tab=online|forms|family
  // Online admission and student fields need Admission Settings; the parents and
  // guardians fields need Edit Contact Template. Each person sees the tabs they can use.
  page: async (req, res) => {
    const [canAdmissions, canFamily] = await Promise.all([canManage(req), canEditFamily(req)]);
    if (!canAdmissions && !canFamily) {
      req.flash("error", "You don't have permission to change admission settings.");
      return res.redirect("/common/admissions");
    }
    try {
      const organizationId = Number(req.session.organizationId);
      const website = hasWebsite(res) && canAdmissions;
      const [orgRow, list, familyTemplate] = await Promise.all([
        db.query(
          `SELECT public_registration_enabled, registration_start_date, registration_end_date,
                  public_registration_price, public_registration_currency
             FROM organizations WHERE organization_id = $1`,
          [organizationId]
        ),
        canAdmissions ? fields.listFields(db, organizationId) : [],
        canFamily ? contacts.getTemplate(db, organizationId).catch(() => ({ sections: [], fields: [] })) : null,
      ]);
      const org = orgRow.rows[0] || {};
      const tabs = [website && "online", canAdmissions && "forms", canFamily && "family"].filter(Boolean);
      const tab = tabs.includes(req.query.tab) ? req.query.tab : tabs[0];
      return res.render("common/admissionSettings", {
        title: "Admission Settings",
        tab,
        canAdmissions,
        canFamily,
        familyTemplate,
        familyBaseFields: contacts.BASE_FIELDS,
        familyFieldTypes: contacts.FIELD_TYPES,
        hasWebsite: website,
        org,
        organizationId,
        registrationStatus: websiteExtras.registrationState(org),
        formFields: list,
        fieldTypes: fields.FIELD_TYPES,
        standardFields: fields.STANDARD_FIELDS,
        indicatorLabels: fields.INDICATORS.map((i) => i.label),
        // Parent details belong under Parents & guardians (kept once per parent). The student
        // form's Guardian Details part is offered only to schools already using it.
        fieldSections: (canFamily && !list.some((f) => f.section === "guardian"))
          ? Object.fromEntries(Object.entries(fields.SECTIONS).filter(([key]) => key !== "guardian"))
          : fields.SECTIONS,
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
      if (action === "indicators") await fields.addIndicators(db, organizationId, actor(req).userId);
      return res.json({ success: true, fields: await fields.listFields(db, organizationId) });
    } catch (err) {
      return fail(res, err, "Could not save the form.");
    }
  },
};
