"use strict";

// One parent sign-in across schools (utils/familyLink.js, feature family_link).

const familyLink = require("../utils/familyLink");
const { saveSession } = (() => {
  const save = (req) => new Promise((resolve, reject) => req.session.save((error) => (error ? reject(error) : resolve())));
  return { saveSession: save };
})();

const json = (res, status, body) => res.status(status).set("Cache-Control", "private, no-store").json(body);

module.exports = {
  // POST /guardian/family/open { organizationId, studentId }: that child's page, in their school.
  open: async (req, res, db) => {
    try {
      await familyLink.switchToChild(db, req, req.body && req.body.organizationId, req.body && req.body.studentId);
      await saveSession(req);
      return res.redirect(303, `/guardian/child?studentId=${Number(req.body.studentId)}`);
    } catch (error) {
      if (!(error instanceof familyLink.LinkError)) console.error("[Family link] open:", error.message);
      req.flash("error", error instanceof familyLink.LinkError ? error.message : "That child's page could not open. Try again.");
      return res.redirect(303, "/guardian/dashboard");
    }
  },

  sendCode: async (req, res, db) => {
    try {
      const to = await familyLink.sendConfirmCode(db, req);
      await saveSession(req);
      return json(res, 200, { success: true, to });
    } catch (error) {
      if (!(error instanceof familyLink.LinkError)) console.error("[Family link] send:", error.message);
      return json(res, error.status || 500, { success: false, message: error instanceof familyLink.LinkError ? error.message : "The code could not be sent. Try again." });
    }
  },

  confirm: async (req, res, db) => {
    try {
      await familyLink.confirmCode(db, req, req.body && req.body.code);
      await saveSession(req);
      return json(res, 200, { success: true });
    } catch (error) {
      await saveSession(req).catch(() => {});
      if (!(error instanceof familyLink.LinkError)) console.error("[Family link] confirm:", error.message);
      return json(res, error.status || 500, { success: false, message: error instanceof familyLink.LinkError ? error.message : "That didn't work. Try again." });
    }
  },
};
