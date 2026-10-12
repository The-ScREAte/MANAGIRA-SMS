// Hub users: the people (besides the owner) who sign in to a hub, their role
// and what they are allowed to see and do.
const db = require("../config/db");
const bcrypt = require("bcryptjs");
const crypto = require("crypto");
const { renderCleanEmail } = require("../utils/emailHelper");
const {
  HUB_ROLES,
  HUB_PERMISSION_GROUPS,
  ALL_HUB_PERMISSIONS,
  DEFAULT_HUB_USER_PERMISSIONS,
  ensureHubAccessSchema,
  permissionsForRole,
  notifyHub,
} = require("../utils/hubAccess");

const INVITE_DAYS = 7;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const baseUrl = (res) => String(res.locals.BASE_URL || process.env.BASE_URL_PRODUCTION || process.env.BASE_URL || "https://managira.com").replace(/\/$/, "");
const actorName = (req) => {
  const a = req.hubActor;
  if (a && a.user) return `${a.user.first_name} ${a.user.last_name}`.trim();
  return [req.session.firstName, req.session.lastName].filter(Boolean).join(" ") || "A hub admin";
};
const actorEmail = (req) => (req.hubActor && req.hubActor.user ? req.hubActor.user.email : req.hubInfo && req.hubInfo.hub_email) || "";

async function logActivity(req, type, description) {
  await db.query(
    `INSERT INTO hub_activity_logs (hub_id, action_type, description, performed_by, ip_address) VALUES ($1, $2, $3, $4, $5)`,
    [req.session.hubId, type, description, actorName(req), req.ip]
  ).catch(() => {});
}

async function findUser(req) {
  const id = parseInt(req.params.hubUserId, 10);
  if (!Number.isInteger(id)) return null;
  const { rows } = await db.query(`SELECT * FROM hub_users WHERE hub_user_id = $1 AND hub_id = $2`, [id, req.session.hubId]);
  return rows[0] || null;
}

// Email a link to set (or reset) their password.
async function sendInvite(req, res, user) {
  const token = crypto.randomBytes(32).toString("hex");
  await db.query(
    `UPDATE hub_users SET reset_password_token = $1, reset_password_expires = $2, updated_at = NOW() WHERE hub_user_id = $3`,
    [crypto.createHash("sha256").update(token).digest("hex"), new Date(Date.now() + INVITE_DAYS * 86400000), user.hub_user_id]
  );
  const hubName = (req.hubInfo && req.hubInfo.hub_name) || "your hub";
  const { sendEmailInBackground } = require("../utils/emailHelper");
  sendEmailInBackground({
    from: process.env.NOTIFY_EMAIL_USER,
    to: user.email,
    subject: `You have been added to ${hubName} on Managira`,
    html: renderCleanEmail({
      title: `Welcome to ${hubName}`,
      greeting: `Hello ${user.first_name},`,
      paragraphs: [
        `${actorName(req)} added you to ${hubName} on Managira as a ${(HUB_ROLES[user.role] || HUB_ROLES.hub_user).label.toLowerCase()}.`,
        `Click the button to set your password. The link works for ${INVITE_DAYS} days.`,
        `After that, sign in at ${baseUrl(res)}/hub/login with ${user.email}.`,
      ],
      cta: { text: "Set your password", url: `${baseUrl(res)}/hub/setup-password?token=${token}` },
    }),
  }, "Hub user invite");
}

function tellAdmins(req, text) {
  const hubName = (req.hubInfo && req.hubInfo.hub_name) || "your hub";
  notifyHub(db, req.session.hubId, "hub_user_changes", (r) => ({
    subject: `Hub users changed in ${hubName}`,
    html: renderCleanEmail({
      title: "Hub users changed",
      greeting: `Hello ${r.firstName || ""}`.trim() + ",",
      paragraphs: [text, `Done by ${actorName(req)}.`],
      cta: { text: "See hub users", url: `${process.env.BASE_URL_PRODUCTION || process.env.BASE_URL || "https://managira.com"}/hub/users` },
    }),
  }), { excludeEmail: actorEmail(req) });
}

module.exports = {
  formGet: async (req, res) => {
    try {
      await ensureHubAccessSchema(db);
      const editing = req.params.hubUserId ? await findUser(req) : null;
      if (req.params.hubUserId && !editing) {
        req.flash("error", "That user was not found.");
        return res.redirect("/hub/settings?tab=users");
      }
      if (!res.locals.drawer) {
        const self = editing ? `/hub/users/${editing.hub_user_id}/edit` : "/hub/users/new";
        return res.redirect(`/hub/settings?tab=users&drawer=${encodeURIComponent(self)}`);
      }
      res.render("hub/forms/user", {
        title: editing ? `Edit ${editing.first_name}` : "Add a hub user",
        editing,
        isSelf: !!(editing && req.session.hubUserId && editing.hub_user_id === req.session.hubUserId),
        roles: HUB_ROLES,
        permissionGroups: HUB_PERMISSION_GROUPS,
        selected: editing ? permissionsForRole(editing.role, editing.permissions) : DEFAULT_HUB_USER_PERMISSIONS,
        defaults: DEFAULT_HUB_USER_PERMISSIONS,
        messages: req.flash(),
      });
    } catch (err) {
      console.error("[hubUsers.formGet]", err.message);
      req.flash("error", "Could not open the form.");
      res.redirect("/hub/settings?tab=users");
    }
  },

  savePost: async (req, res) => {
    const back = req.params.hubUserId ? `/hub/users/${req.params.hubUserId}/edit` : "/hub/users/new";
    try {
      await ensureHubAccessSchema(db);
      const editing = req.params.hubUserId ? await findUser(req) : null;
      if (req.params.hubUserId && !editing) {
        req.flash("error", "That user was not found.");
        return res.redirect("/hub/settings?tab=users");
      }
      const isSelf = !!(editing && req.session.hubUserId && editing.hub_user_id === req.session.hubUserId);

      const firstName = String(req.body.firstName || "").trim().slice(0, 100);
      const lastName = String(req.body.lastName || "").trim().slice(0, 100);
      const email = String(req.body.email || "").trim().toLowerCase().slice(0, 255);
      const phone = String(req.body.phone || "").trim().slice(0, 40) || null;
      const jobTitle = String(req.body.jobTitle || "").trim().slice(0, 120) || null;
      let role = req.body.role === "hub_admin" ? "hub_admin" : "hub_user";
      let permissions = role === "hub_admin" ? [] : permissionsForRole("hub_user", req.body.permissions);
      if (isSelf) { role = editing.role; permissions = editing.permissions || []; }

      if (!firstName || !lastName || !EMAIL_RE.test(email)) {
        req.flash("error", "Add a first name, last name and a valid email.");
        return res.redirect(back);
      }
      if (role === "hub_user" && !permissions.length) {
        req.flash("error", "Tick at least one thing this user can see or do, or make them a hub admin.");
        return res.redirect(back);
      }
      const taken = await db.query(
        `SELECT 1 FROM managira_hubs WHERE LOWER(hub_email) = $1
         UNION ALL
         SELECT 1 FROM hub_users WHERE LOWER(email) = $1 AND hub_user_id <> $2`,
        [email, editing ? editing.hub_user_id : 0]
      );
      if (taken.rows.length) {
        req.flash("error", "That email already has a hub account. Use a different email.");
        return res.redirect(back);
      }

      if (editing) {
        const roleChanged = editing.role !== role;
        await db.query(
          `UPDATE hub_users SET first_name = $1, last_name = $2, email = $3, phone = $4, job_title = $5,
                  role = $6, permissions = $7, updated_at = NOW()
            WHERE hub_user_id = $8`,
          [firstName, lastName, email, phone, jobTitle, role, permissions, editing.hub_user_id]
        );
        await logActivity(req, "USER_UPDATE", `${firstName} ${lastName}'s access was updated`);
        if (roleChanged) tellAdmins(req, `${firstName} ${lastName} is now a ${HUB_ROLES[role].label.toLowerCase()}.`);
        req.flash("success", `${firstName} ${lastName} saved.`);
        return res.redirect("/hub/settings?tab=users");
      }

      const signIn = req.body.signIn === "password" ? "password" : "invite";
      let password = null;
      if (signIn === "password") {
        const raw = String(req.body.password || "");
        if (raw.length < 8 || !/[A-Za-z]/.test(raw) || !/\d/.test(raw)) {
          req.flash("error", "The password needs at least 8 characters with letters and numbers.");
          return res.redirect(back);
        }
        password = await bcrypt.hash(raw, 10);
      }
      const created = (await db.query(
        `INSERT INTO hub_users (hub_id, first_name, last_name, email, phone, job_title, role, permissions, password, created_by)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10) RETURNING *`,
        [req.session.hubId, firstName, lastName, email, phone, jobTitle, role, permissions, password, actorName(req)]
      )).rows[0];
      if (signIn === "invite") await sendInvite(req, res, created);
      await logActivity(req, "USER_ADDED", `${firstName} ${lastName} was added as a ${HUB_ROLES[role].label.toLowerCase()}`);
      tellAdmins(req, `${firstName} ${lastName} (${email}) was added as a ${HUB_ROLES[role].label.toLowerCase()}.`);
      req.flash("success", signIn === "invite"
        ? `${firstName} was added. We emailed ${email} a link to set their password.`
        : `${firstName} was added. They can sign in at /hub/login with ${email} and the password you set.`);
      res.redirect("/hub/settings?tab=users");
    } catch (err) {
      console.error("[hubUsers.savePost]", err.message);
      req.flash("error", "Could not save this user.");
      res.redirect(back);
    }
  },

  holdPost: async (req, res) => {
    try {
      const user = await findUser(req);
      if (!user) { req.flash("error", "That user was not found."); return res.redirect("/hub/settings?tab=users"); }
      if (req.session.hubUserId === user.hub_user_id) { req.flash("error", "You can't put yourself on hold."); return res.redirect("/hub/settings?tab=users"); }
      await db.query(`UPDATE hub_users SET on_hold = NOT on_hold, updated_at = NOW() WHERE hub_user_id = $1`, [user.hub_user_id]);
      const name = `${user.first_name} ${user.last_name}`;
      await logActivity(req, user.on_hold ? "USER_RESUMED" : "USER_HELD", `${name} was ${user.on_hold ? "resumed" : "put on hold"}`);
      tellAdmins(req, `${name} was ${user.on_hold ? "given access again" : "put on hold and can no longer sign in"}.`);
      req.flash("success", user.on_hold ? `${name} can sign in again.` : `${name} is on hold and can't sign in.`);
    } catch (err) {
      req.flash("error", "Could not update this user.");
    }
    res.redirect("/hub/settings?tab=users");
  },

  invitePost: async (req, res) => {
    try {
      const user = await findUser(req);
      if (!user) { req.flash("error", "That user was not found."); return res.redirect("/hub/settings?tab=users"); }
      await sendInvite(req, res, user);
      await logActivity(req, "USER_INVITE", `Password link sent to ${user.first_name} ${user.last_name}`);
      req.flash("success", `We emailed ${user.email} a link to set their password.`);
    } catch (err) {
      req.flash("error", "Could not send the email.");
    }
    res.redirect("/hub/settings?tab=users");
  },

  deletePost: async (req, res) => {
    try {
      const user = await findUser(req);
      if (!user) { req.flash("error", "That user was not found."); return res.redirect("/hub/settings?tab=users"); }
      if (req.session.hubUserId === user.hub_user_id) { req.flash("error", "You can't remove yourself."); return res.redirect("/hub/settings?tab=users"); }
      await db.query(`DELETE FROM hub_users WHERE hub_user_id = $1`, [user.hub_user_id]);
      const name = `${user.first_name} ${user.last_name}`;
      await logActivity(req, "USER_REMOVED", `${name} was removed`);
      tellAdmins(req, `${name} (${user.email}) was removed from the hub.`);
      req.flash("success", `${name} was removed.`);
    } catch (err) {
      req.flash("error", "Could not remove this user.");
    }
    res.redirect("/hub/settings?tab=users");
  },
};
