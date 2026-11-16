// /gov-report/:token: a Gov/state report a school sent to someone outside it (a state or district
// data office). No sign-in: the link from one email and the 6-digit code from another
// (controllers/stateReportingController.js createGovShare).
const express = require("express");

module.exports = (db) => {
  const router = express.Router();
  const share = require("../controllers/stateReportingController").createGovShare(db);
  router.get("/:token", share.page);
  router.post("/:token", express.urlencoded({ extended: false, limit: "2kb" }), share.download);
  return router;
};
