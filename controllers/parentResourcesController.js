"use strict";

// The question set form's parent section: show it on the portal, notes, and files.
const parentResources = require("../utils/parentResources");
const features = require("../utils/shards/features");

const toId = (value) => {
  const id = Number.parseInt(value, 10);
  return Number.isInteger(id) && id > 0 ? id : null;
};

async function answer(req, res, work) {
  if (!features.isOn("parent_student_hub", { organizationId: req.session.organizationId })) {
    return res.status(404).json({ success: false, message: "Not available." });
  }
  try {
    const result = await work();
    if (!result) return res.status(404).json({ success: false, message: "That set no longer exists." });
    return res.json({ success: true, ...result });
  } catch (error) {
    console.error("[Parent resources]", error.message);
    return res.status(500).json({ success: false, message: "Something went wrong. Try again." });
  }
}

module.exports = {
  read: (req, res, db) => answer(req, res, () => parentResources.readSettings(db, req.session.organizationId, toId(req.query.questionSetId))),

  save: (req, res, db) => answer(req, res, async () => {
    const saved = await parentResources.saveSettings(db, req.session.organizationId, toId(req.body?.questionSetId), { show: req.body?.show === true, notes: req.body?.notes });
    return saved ? {} : null;
  }),

  addFiles: (req, res, db) => answer(req, res, async () => {
    const organizationId = req.session.organizationId;
    const questionSetId = toId(req.body?.questionSetId);
    if (!(await parentResources.readSettings(db, organizationId, questionSetId))) return null;
    return { files: await parentResources.addFiles(db, organizationId, questionSetId, req.files || [], req.session.userId || req.session.user?.user_id || null) };
  }),

  removeFile: (req, res, db) => answer(req, res, async () => {
    const removed = await parentResources.removeFile(db, req.session.organizationId, toId(req.params.id));
    return removed ? {} : null;
  }),
};
