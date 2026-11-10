// Contact cards (Mail Room) and the contact template (Management Tools).
// See utils/contacts.js.
const db = require("../config/db");
const contacts = require("../utils/contacts");
const { userHasPermission, PERMISSIONS } = require("../middleware/permissionMiddleware");
const { getMailroomAllowedClassIdsFor, getMailroomContactsMap } = require("./guardianMessagingController");

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

async function contactAccess(req) {
  const who = actor(req);
  const [see, edit, template, guardians] = await Promise.all([
    userHasPermission(db, who, PERMISSIONS.SEE_CONTACTS),
    userHasPermission(db, who, PERMISSIONS.EDIT_CONTACTS),
    userHasPermission(db, who, PERMISSIONS.EDIT_CONTACT_TEMPLATE),
    userHasPermission(db, who, PERMISSIONS.MANAGE_GUARDIANS),
  ]);
  // Editing a contact means seeing it first. Manage Guardians ("see and edit parents and
  // guardians") opens and edits every parent's card, from Parents & guardians.
  return { see: see || edit || guardians, edit: edit || guardians, template, guardians };
}

function fail(res, err, fallback) {
  if (err instanceof contacts.ContactError) return res.status(err.status).json({ success: false, error: err.message });
  console.error(`[Contacts] ${fallback}:`, err.message);
  return res.status(500).json({ success: false, error: fallback });
}

// The requested keys that this person may open: the same guardians their
// Mail Room contact list shows (all of them, or their classes' only).
async function keysInScope(req, access) {
  const who = actor(req);
  const keys = contacts.parseKeys(req.method === "GET" ? req.query.keys : req.body && req.body.keys);
  if (!keys.length) return [];
  // Parents & guardians lists the whole school, so its cards are the whole school's.
  if (access && access.guardians) return contacts.keysInSchool(db, who.organizationId, keys);
  const restricted = await getMailroomAllowedClassIdsFor({ orgId: who.organizationId, ...who });
  const allowed = await getMailroomContactsMap(who.organizationId, restricted);
  return keys.filter((k) => allowed.has(k.key));
}

module.exports = {
  // GET /common/contacts/card?keys=profile:12,legacy:40
  card: async (req, res) => {
    try {
      const access = await contactAccess(req);
      if (!access.see) return res.status(403).json({ success: false, error: "You don't have permission to see contact details." });
      const keys = await keysInScope(req, access);
      if (!keys.length) return res.status(404).json({ success: false, error: "This contact isn't in your contact list." });
      const contact = await contacts.readContact(db, Number(req.session.organizationId), keys);
      res.set("Cache-Control", "no-store");
      return res.json({ success: true, contact, canEdit: access.edit, canEditTemplate: access.template });
    } catch (err) {
      return fail(res, err, "Could not load this contact.");
    }
  },

  // POST /common/contacts/card  { keys, base: {...}, fields: { fieldId: value } }
  saveCard: async (req, res) => {
    try {
      const access = await contactAccess(req);
      if (!access.edit) return res.status(403).json({ success: false, error: "You don't have permission to edit contacts." });
      const keys = await keysInScope(req, access);
      if (!keys.length) return res.status(404).json({ success: false, error: "This contact isn't in your contact list." });
      const organizationId = Number(req.session.organizationId);
      await contacts.saveContact(db, organizationId, keys, req.body || {}, actor(req).userId);
      const contact = await contacts.readContact(db, organizationId, keys);
      return res.json({ success: true, contact, canEdit: true, canEditTemplate: access.template });
    } catch (err) {
      return fail(res, err, "Could not save this contact.");
    }
  },

  // GET /common/contact-template: the parents and guardians fields now sit with the
  // student fields in one place, Admissions > Admission Settings.
  templatePage: async (req, res) => {
    const embed = req.query.embed ? `&embed=${encodeURIComponent(String(req.query.embed))}` : "";
    return res.redirect(`/common/admissionSettings?tab=family${embed}`);
  },

  // JSON API behind the template page.
  templateApi: (action) => async (req, res) => {
    try {
      const access = await contactAccess(req);
      if (!access.template) return res.status(403).json({ success: false, error: "You don't have permission to edit the contact template." });
      const organizationId = Number(req.session.organizationId);
      const id = Number(req.params.id) || null;
      const body = req.body || {};
      if (action === "create") await contacts.createField(db, organizationId, body, actor(req).userId);
      if (action === "update") await contacts.updateField(db, organizationId, id, body);
      if (action === "status") await contacts.setFieldStatus(db, organizationId, id, body.status);
      if (action === "delete") await contacts.deleteField(db, organizationId, id);
      if (action === "createSection") await contacts.createSection(db, organizationId, body);
      if (action === "renameSection") await contacts.renameSection(db, organizationId, id, body);
      if (action === "deleteSection") await contacts.deleteSection(db, organizationId, id);
      if (action === "shareSection") {
        if (!require("../utils/shards/features").isOn("family_sharing", { organizationId })) {
          return res.status(404).json({ success: false, error: "Sharing isn't available for your school yet." });
        }
        await contacts.setSectionSharing(db, organizationId, id, body.shared);
      }
      if (action === "order") await contacts.saveOrder(db, organizationId, body);
      return res.json({ success: true, ...(await contacts.getTemplate(db, organizationId)) });
    } catch (err) {
      return fail(res, err, "Could not save the template.");
    }
  },
};
