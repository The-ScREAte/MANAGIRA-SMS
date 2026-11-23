// Emergency & pickup details shared beyond the office.
// The school decides per section who sees it (Admissions > Admission Settings >
// Parents & guardians): parents see and update their own here, students see their
// parents', teachers see the class pickup list, drivers with "Pickup & Emergency"
// see their riders'. The data rules are in utils/contacts.js.
const db = require("../config/db");
const contacts = require("../utils/contacts");

module.exports = {
  // GET /guardian/family-details: this parent's details in the sections shared with parents.
  parentGet: async (req, res) => {
    res.set("Cache-Control", "no-store");
    try {
      const details = await contacts.parentPortalDetails(db, Number(req.session.organizationId), Number(req.session.guardianId));
      return res.json({ success: true, ...details });
    } catch (err) {
      console.error("[familyDetails/parentGet]", err.message);
      return res.status(500).json({ success: false, error: "Your details couldn't be loaded. Please try again." });
    }
  },

  // POST /guardian/family-details { fields: { fieldId: value } }: a parent updates their own.
  parentSave: async (req, res) => {
    res.set("Cache-Control", "no-store");
    try {
      const details = await contacts.saveParentPortalDetails(db, Number(req.session.organizationId), Number(req.session.guardianId), req.body || {});
      return res.json({ success: true, ...details });
    } catch (err) {
      if (err instanceof contacts.ContactError) return res.status(err.status).json({ success: false, error: err.message });
      console.error("[familyDetails/parentSave]", err.message);
      return res.status(500).json({ success: false, error: "Your details couldn't be saved. Please try again." });
    }
  },

  // GET /student/family-details: the student's parents and the details shared with students.
  studentGet: async (req, res) => {
    res.set("Cache-Control", "no-store");
    try {
      const studentId = Number(req.session.studentId);
      const map = await contacts.familyDetailsForStudents(db, Number(req.session.organizationId), [studentId], "students");
      return res.json({ success: true, family: map.get(studentId) || [] });
    } catch (err) {
      console.error("[familyDetails/studentGet]", err.message);
      return res.status(500).json({ success: false, error: "These details couldn't be loaded." });
    }
  },
};
