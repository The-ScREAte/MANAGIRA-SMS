"use strict";

// Forms & requests for Mira (utils/formRequests.js). Identity comes from Mira's validated session
// (added to every call by mira/internalApiClient.js): the query string for reads, the body for the
// reminder. Errors carry a code Mira passes on: PERMISSION_DENIED, PLAN_FEATURE_OFF, NOT_FOUND,
// VALIDATION.
const db = require("../config/db");
const formRequests = require("../utils/formRequests");

const actorFrom = (src) => ({
  organizationId: parseInt(src.organizationId, 10),
  userId: parseInt(src.userId, 10) || null,
  userRole: src.userRole || "",
  accountType: src.accountType || "",
  userEmail: src.userEmail || "",
});
const fail = (res, error) => {
  if (error instanceof formRequests.FormsError) return res.status(error.status).json({ error: error.message, code: error.code });
  console.error("[mira forms]", error.message);
  return res.status(500).json({ error: "Form status couldn't be read.", code: "FAILED" });
};
const list = (value) => (value === undefined || value === null || value === "" ? [] : String(value).split(",").map((v) => v.trim()).filter(Boolean));

async function status(req, res) {
  const actor = actorFrom(req.query || {});
  if (!Number.isInteger(actor.organizationId) || req.query.viewerType && req.query.viewerType !== "staff") return res.status(403).json({ error: "Staff only.", code: "PERMISSION_DENIED" });
  try {
    const result = await formRequests.status(db, actor, {
      classQuery: req.query.classQuery || null,
      classIds: list(req.query.classIds),
      formId: req.query.formId || null,
      formQuery: req.query.formQuery || null,
      audience: req.query.audience || "parent",
      status: req.query.status || "outstanding",
      day: /^\d{4}-\d{2}-\d{2}$/.test(String(req.query.day || "")) ? req.query.day : null,
    });
    return res.json({ ok: true, ...result });
  } catch (error) {
    return fail(res, error);
  }
}

async function remind(req, res) {
  const actor = actorFrom(req.body || {});
  if (!Number.isInteger(actor.organizationId)) return res.status(400).json({ error: "organizationId is required.", code: "VALIDATION" });
  try {
    const siteUrl = String(process.env.BASE_URL_PRODUCTION || process.env.BASE_URL || "").replace(/\/+$/, "");
    const result = await formRequests.remind(db, actor, {
      formId: req.body.formId, classQuery: req.body.classQuery || null, classIds: Array.isArray(req.body.classIds) ? req.body.classIds : null, siteUrl,
    });
    return res.json({ ok: true, ...result });
  } catch (error) {
    return fail(res, error);
  }
}

module.exports = { status, remind };
