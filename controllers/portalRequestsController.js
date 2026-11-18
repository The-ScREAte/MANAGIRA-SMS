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
  // A parent's requests from every school on their sign-in (feature family_link): the school they
  // signed in at, and each other school whose invitation they accepted. Each school's forms are read
  // with that school's own id; a link opens the form in its school (familyLink.followChild).
  guardian: async (req, res, db) => {
    const familyLink = require("../utils/familyLink");
    const home = familyLink.homeOf(req.session) || { guardianId: Number(req.session.guardianId), organizationId: Number(req.session.organizationId) };
    if (!portalRequests.isOn(home.organizationId)) return fail(res, 404, "Requests aren't available.");
    try {
      const family = await familyLink.familyFor(db, req.session).catch(() => null);
      const schools = [{ organizationId: home.organizationId, guardianId: home.guardianId, name: family && family.homeSchool ? family.homeSchool.name : "" }]
        .concat(((family && family.schools) || []).map((s) => ({ organizationId: s.school.id, guardianId: s.guardianId, name: s.school.name })));
      const bucket = bucketOf(req);
      const day = todayKeyFor(req);
      const linkFor = (child, formId) => `/guardian/child/forms?studentId=${child.id}&form=${formId}`;
      const lists = await Promise.all(schools.map(async (school) => {
        const children = await portalRequests.childrenOfGuardian(db, school.organizationId, school.guardianId);
        const [items, waiting] = await Promise.all([
          portalRequests.forms(db, school.organizationId, children, "parent", { bucket, day, linkFor }),
          bucket === "new" ? null : portalRequests.forms(db, school.organizationId, children, "parent", { bucket: "new", day, linkFor }),
        ]);
        const named = (list) => (schools.length > 1 ? list.map((item) => ({ ...item, schoolName: school.name })) : list);
        return { items: named(items), newCount: (waiting || items).length };
      }));
      const requests = lists.flatMap((l) => l.items);
      if (bucket === "new") requests.sort((a, b) => String(a.dueDate || "9999").localeCompare(String(b.dueDate || "9999")) || Number(b.required) - Number(a.required));
      else requests.sort((a, b) => new Date(b.sentAt) - new Date(a.sentAt));
      noStore(res);
      return res.json({ success: true, bucket, requests, newCount: lists.reduce((n, l) => n + l.newCount, 0) });
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
