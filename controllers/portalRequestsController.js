"use strict";

// Requests for parents and students (utils/portalRequests.js, feature portal_requests), and a
// student's own bus reports. JSON only; the pages draw them (public/js/portalRequests.js).

const portalRequests = require("../utils/portalRequests");
const { todayKeyFor } = require("../utils/localDate");

const bucketOf = (req) => (req.query.bucket === "old" ? "old" : "new");
const fail = (res, status, message) => res.status(status).json({ success: false, message });
const noStore = (res) => res.set("Cache-Control", "private, no-store");

async function listFor(req, res, db, people, audience, linkFor) {
  const organizationId = Number(req.session.organizationId);
  const bucket = bucketOf(req);
  const day = todayKeyFor(req);
  const [items, waiting] = await Promise.all([
    portalRequests.forms(db, organizationId, people, audience, { bucket, day, linkFor }),
    bucket === "new" ? null : portalRequests.forms(db, organizationId, people, audience, { bucket: "new", day, linkFor }),
  ]);
  noStore(res);
  return res.json({ success: true, bucket, requests: items, newCount: (waiting || items).length });
}

module.exports = {
  guardian: async (req, res, db) => {
    const organizationId = Number(req.session.organizationId);
    if (!portalRequests.isOn(organizationId)) return fail(res, 404, "Requests aren't available.");
    try {
      const children = await portalRequests.childrenOfGuardian(db, organizationId, Number(req.session.guardianId));
      return await listFor(req, res, db, children, "parent", (child, formId) => `/guardian/child/forms?studentId=${child.id}&form=${formId}`);
    } catch (error) {
      console.error("[Requests] parent:", error.message);
      return fail(res, 500, "Requests could not load. Try again.");
    }
  },

  student: async (req, res, db) => {
    const organizationId = Number(req.session.organizationId);
    if (!portalRequests.isOn(organizationId)) return fail(res, 404, "Requests aren't available.");
    try {
      const me = await require("../utils/customForms").studentInfo(db, organizationId, Number(req.session.studentId));
      return await listFor(req, res, db, me ? [me] : [], "student", (_child, formId) => `/student/forms?form=${formId}`);
    } catch (error) {
      console.error("[Requests] student:", error.message);
      return fail(res, 500, "Requests could not load. Try again.");
    }
  },

  // Driver reports about this student that the school shared with the family, while the student's
  // class shares the bus with students (Class settings) and the school's transportation is on.
  studentBusReports: async (req, res, db) => {
    const organizationId = Number(req.session.organizationId);
    const studentId = Number(req.session.studentId);
    if (!portalRequests.isOn(organizationId) || !studentId) return fail(res, 404, "Bus reports aren't available.");
    try {
      const { getTransportationIntegrationStatus } = require("../utils/transportation");
      const [integration, sees] = await Promise.all([
        getTransportationIntegrationStatus(db, organizationId).catch(() => null),
        require("../utils/classSettings").studentsSee(db, organizationId, studentId, "transport"),
      ]);
      noStore(res);
      if (!(integration && integration.activated) || sees === false) return res.json({ success: true, reports: [] });
      const reports = await require("../utils/transportReports").reportsForParent(db, organizationId, [studentId]);
      return res.json({ success: true, reports });
    } catch (error) {
      console.error("[Requests] student bus reports:", error.message);
      return fail(res, 500, "Bus reports could not load. Try again.");
    }
  },
};
