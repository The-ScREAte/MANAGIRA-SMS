// Mira skills (services/skills.js, feature mira_skills): each person's own skills and the school's.
// Everything is scoped to the signed-in member of staff and their school; school skills change only
// with the Mira Settings permission (checked again on every write).
const express = require("express");
const router = express.Router();
const skills = require("../services/skills");
const { loadAccess } = require("../services/access");

const fail = (res, error) => {
  if (error instanceof skills.SkillError) return res.status(error.status).json({ error: error.message });
  console.error("[mira/skills]", error.message);
  return res.status(500).json({ error: "That didn't work. Try again." });
};
const withAccess = (handler) => async (req, res) => {
  res.set("Cache-Control", "private, no-store");
  try {
    const access = await loadAccess(req.tenant);
    if (!skills.isOn(access) || !access.ok) return res.status(404).json({ error: "Skills aren't available for your school yet." });
    return await handler(req, res, access);
  } catch (error) {
    return fail(res, error);
  }
};

router.get("/", withAccess(async (req, res, access) => {
  const list = await skills.listFor(req.tenant);
  return res.json({
    ready: await skills.ready(),
    canManageSchool: skills.canManageSchool(access),
    limits: skills.LIMITS,
    school: list.school,
    personal: list.personal,
    templates: skills.templatesForUi(),
  });
}));
router.post("/", withAccess(async (req, res, access) => res.status(201).json({ skill: await skills.create(req.tenant, access, req.body || {}) })));
router.put("/:id", withAccess(async (req, res, access) => res.json({ skill: await skills.update(req.tenant, access, req.params.id, req.body || {}) })));
router.delete("/:id", withAccess(async (req, res, access) => res.json(await skills.remove(req.tenant, access, req.params.id))));

module.exports = router;
