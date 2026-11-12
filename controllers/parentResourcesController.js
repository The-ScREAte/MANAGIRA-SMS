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
    if (error.status === 400) return res.status(400).json({ success: false, message: error.message });
    console.error("[Parent resources]", error.message);
    return res.status(500).json({ success: false, message: "Something went wrong. Try again." });
  }
}

module.exports = {
  read: (req, res, db) => answer(req, res, () => parentResources.readSettings(db, req.session.organizationId, toId(req.query.questionSetId))),

  save: (req, res, db) => answer(req, res, async () => {
    // "Students see these with the test" comes with the learning_resources feature.
    const students = features.isOn("learning_resources", { organizationId: req.session.organizationId }) && Object.prototype.hasOwnProperty.call(req.body || {}, "students")
      ? req.body.students === true : undefined;
    const saved = await parentResources.saveSettings(db, req.session.organizationId, toId(req.body?.questionSetId), { show: req.body?.show === true, notes: req.body?.notes, students });
    return saved ? {} : null;
  }),

  addLink: (req, res, db) => answer(req, res, async () => {
    const organizationId = req.session.organizationId;
    const questionSetId = toId(req.body?.questionSetId);
    if (!(await parentResources.readSettings(db, organizationId, questionSetId))) return null;
    const link = await parentResources.addLink(db, organizationId, questionSetId, { url: req.body?.url, label: req.body?.label }, req.session.userId || req.session.user?.user_id || null);
    if (!link) {
      const error = new Error("Give a link that starts with https://");
      error.status = 400;
      throw error;
    }
    return { file: link };
  }),

  // One file for a question's help (utils/questionHelp.js): returned, saved with the question.
  questionHelpFile: async (req, res) => {
    if (!features.isOn("learning_resources", { organizationId: req.session.organizationId })) return res.status(404).json({ success: false, message: "Not available." });
    const file = req.file;
    if (!file) return res.status(400).json({ success: false, message: "Choose a file first." });
    try {
      const crypto = require("crypto");
      const path = require("path");
      const key = `question-help/${Number(req.session.organizationId)}/${crypto.randomUUID()}${path.extname(String(file.originalname || "")).toLowerCase().replace(/[^.a-z0-9]/g, "").slice(0, 12)}`;
      const { uploadToS3 } = require("../middleware/s3Upload");
      const url = await uploadToS3(file, key);
      return res.json({ success: true, file: { name: String(file.originalname || "File").slice(0, 200), key, url } });
    } catch (error) {
      console.error("[Question help] upload:", error.message);
      return res.status(500).json({ success: false, message: "That file could not be uploaded. Try again." });
    }
  },

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
