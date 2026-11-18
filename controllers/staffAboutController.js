"use strict";

// About me on a member of staff's own profile (/account/update; utils/staffAbout.js, feature
// teacher_cards). Only the person themselves, signed in as a member of staff of this school: never
// the school's own account, a parent, a student or someone looking in from a hub or Managira.

const staffAbout = require("../utils/staffAbout");

// The member of staff signed in as themselves, or null.
async function selfOf(req, db) {
  const session = req.session || {};
  const organizationId = Number(session.organizationId);
  const userId = Number(session.userId || (session.user && session.user.user_id));
  if (!organizationId || !userId || session.accountType === "Organization") return null;
  if (session.guardianId || session.studentId || session.hubOrgSwitch || session.superAdminOrgSwitch) return null;
  if (!staffAbout.isOn(organizationId)) return null;
  const { rows } = await db.query(
    "SELECT 1 FROM users WHERE user_id = $1 AND organization_id = $2 AND removed_at IS NULL",
    [userId, organizationId]
  );
  return rows.length ? { organizationId, userId } : null;
}

const answer = (res, handler) => handler().then((body) => res.json({ success: true, ...body })).catch((error) => {
  if (error instanceof staffAbout.AboutError) return res.status(error.status).json({ success: false, message: error.message });
  console.error("[About me]", error.message);
  return res.status(500).json({ success: false, message: "That didn't save. Try again." });
});

async function needSelf(req, res, db) {
  const me = await selfOf(req, db);
  if (!me) {
    res.status(403).json({ success: false, message: "Only you can change your About me." });
    return null;
  }
  return me;
}

module.exports = {
  selfOf,

  // What the profile page shows, or null where it isn't offered.
  forProfile: async (req, db) => {
    const me = await selfOf(req, db).catch(() => null);
    if (!me || !(await staffAbout.ready(db))) return null;
    return staffAbout.get(db, me.organizationId, me.userId).catch(() => null);
  },

  saveFact: async (req, res, db) => {
    const me = await needSelf(req, res, db);
    if (!me) return null;
    return answer(res, async () => ({ about: await staffAbout.saveFact(db, me.organizationId, me.userId, req.body && req.body.funFact) }));
  },

  addPhoto: async (req, res, db) => {
    const me = await needSelf(req, res, db);
    if (!me) return null;
    return answer(res, async () => ({ about: await staffAbout.addPhoto(db, me.organizationId, me.userId, req.file) }));
  },

  removePhoto: async (req, res, db) => {
    const me = await needSelf(req, res, db);
    if (!me) return null;
    return answer(res, async () => ({ about: await staffAbout.removePhoto(db, me.organizationId, me.userId, req.body && req.body.key) }));
  },
};
