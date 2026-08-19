// Unified announcement/broadcast system: modal + banner popups with role/org/user
// targeting, frequency capping, scheduling, and CTA links. Targeting + frequency
// are enforced entirely server-side in getMyAnnouncements - the client is only ever
// told what to render, never asked what it's allowed to see.
const db = require("../config/db");
const { ensureAnnouncementSchema } = require("../utils/announcementSystem");
const { isFrequencyExhausted } = require("../utils/announcementFrequency");
const { isManagerLikeRole } = require("../middleware/permissionMiddleware");
const { uploadToS3 } = require("../middleware/s3Upload");

function safeString(value) {
  return String(value == null ? "" : value).trim();
}

function isPlatformAdmin(req) {
  return String(req.session?.accountType || "").trim().toLowerCase() === "admin";
}

// Any of the four session identity shapes this app uses (staff/org, guardian,
// student, driver - drivers share the `users` id space with staff, so they
// resolve into the same 'staff' viewer_type bucket).
function resolveViewerIdentity(req) {
  const session = req.session || {};
  if (session.guardianId && session.userRole === "Guardian") {
    return { userId: Number(session.guardianId), viewerType: "guardian", organizationId: session.organizationId || null };
  }
  if (session.studentId && session.userRole === "Student") {
    return { userId: Number(session.studentId), viewerType: "student", organizationId: session.organizationId || null };
  }
  const staffUserId = session.userId || session.user?.user_id || null;
  if (staffUserId) {
    return { userId: Number(staffUserId), viewerType: "staff", organizationId: session.organizationId || null };
  }
  return null;
}

// Role tags a viewer matches against broadcast_announcement_targets rows. A user can
// carry more than one (e.g. a teacher who is also an org owner).
function resolveViewerRoleTags(req) {
  const session = req.session || {};
  const tags = [];
  const userRole = safeString(session.userRole || session.user?.account_type);
  const accountType = safeString(session.accountType || session.user?.account_type);

  if (session.guardianId && userRole === "Guardian") tags.push("parent", "guardian");
  if (session.studentId && userRole === "Student") tags.push("student");
  if (/^teacher$/i.test(userRole)) tags.push("teacher");
  if (/^student teacher$/i.test(userRole)) tags.push("student_teacher");
  if (/^driver$/i.test(userRole) || /^driver$/i.test(accountType)) tags.push("driver");
  if (isManagerLikeRole(userRole) || isManagerLikeRole(accountType)) tags.push("org_admin");
  if (accountType.toLowerCase() === "admin") tags.push("super_admin");

  return [...new Set(tags)];
}

function parseCtaLinks(raw) {
  let links = raw;
  if (typeof raw === "string") {
    try {
      links = JSON.parse(raw);
    } catch {
      links = [];
    }
  }
  if (!Array.isArray(links)) return [];
  return links
    .filter((l) => l && safeString(l.label) && safeString(l.url))
    .map((l) => ({
      label: safeString(l.label).slice(0, 120),
      url: safeString(l.url).slice(0, 2000),
      style: safeString(l.style) || "primary",
      ack_required: !!l.ack_required,
    }));
}

const ROLE_TARGET_VALUES = new Set([
  "teacher",
  "student_teacher",
  "student",
  "parent",
  "guardian",
  "driver",
  "org_admin",
  "super_admin",
]);

function normalizeTargets(rawTargets, { allowOrgTargets }) {
  let targets = rawTargets;
  if (typeof targets === "string") {
    try {
      targets = JSON.parse(targets);
    } catch {
      targets = [];
    }
  }
  if (!Array.isArray(targets)) return [];

  const out = [];
  for (const t of targets) {
    if (!t || !t.target_type) continue;
    const type = safeString(t.target_type).toLowerCase();
    const value = safeString(t.target_value);
    if (!value) continue;
    if (type === "role" && ROLE_TARGET_VALUES.has(value.toLowerCase())) {
      out.push({ target_type: "role", target_value: value.toLowerCase() });
    } else if (type === "org" && allowOrgTargets && /^\d+$/.test(value)) {
      out.push({ target_type: "org", target_value: value });
    } else if (type === "user" && /^\d+$/.test(value)) {
      out.push({ target_type: "user", target_value: value });
    }
  }
  return out;
}

async function insertTargets(dbClient, announcementId, targets) {
  for (const t of targets) {
    await dbClient.query(
      `INSERT INTO broadcast_announcement_targets (announcement_id, target_type, target_value) VALUES ($1, $2, $3)`,
      [announcementId, t.target_type, t.target_value]
    );
  }
}

// ---- Admin CRUD -----------------------------------------------------------

async function createAnnouncement(req, res) {
  try {
    await ensureAnnouncementSchema(db);
    const organizationId = req.session.organizationId;
    if (!organizationId) return res.status(400).json({ error: "No organization in session." });

    const body = req.body || {};
    const displayType = body.display_type === "banner" ? "banner" : "modal";
    const variant = ["info", "success", "warning", "new"].includes(body.variant) ? body.variant : "info";
    const frequency = require("../utils/announcementFrequency").VALID_FREQUENCIES.has(body.frequency)
      ? body.frequency
      : "once";
    const maxViews = frequency === "n_times" ? parseInt(body.max_views, 10) || null : null;
    const ctaLinks = parseCtaLinks(body.cta_links);
    // Org-scoped creators can never target another tenant or go global -
    // tenant_id is forced server-side regardless of what the client sends.
    const targets = normalizeTargets(body.targets, { allowOrgTargets: false });
    const userId = req.session.userId || req.session.user?.user_id || null;

    const result = await db.query(
      `INSERT INTO broadcast_announcements
        (tenant_id, title, body, image_url, display_type, variant, cta_links, dismissible, frequency, max_views, starts_at, ends_at, is_active, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10, COALESCE($11, now()), $12, $13, $14)
       RETURNING *`,
      [
        organizationId,
        safeString(body.title).slice(0, 255),
        safeString(body.body),
        safeString(body.image_url) || null,
        displayType,
        variant,
        JSON.stringify(ctaLinks),
        body.dismissible !== false,
        frequency,
        maxViews,
        body.starts_at || null,
        body.ends_at || null,
        body.is_active !== false,
        userId,
      ]
    );
    await insertTargets(db, result.rows[0].id, targets);
    return res.status(201).json({ announcement: result.rows[0] });
  } catch (error) {
    console.error("[createAnnouncement]", error);
    return res.status(500).json({ error: "Unable to create announcement." });
  }
}

async function createGlobalAnnouncement(req, res) {
  try {
    await ensureAnnouncementSchema(db);
    const body = req.body || {};
    const displayType = body.display_type === "banner" ? "banner" : "modal";
    const variant = ["info", "success", "warning", "new"].includes(body.variant) ? body.variant : "info";
    const frequency = require("../utils/announcementFrequency").VALID_FREQUENCIES.has(body.frequency)
      ? body.frequency
      : "once";
    const maxViews = frequency === "n_times" ? parseInt(body.max_views, 10) || null : null;
    const ctaLinks = parseCtaLinks(body.cta_links);
    const targets = normalizeTargets(body.targets, { allowOrgTargets: true });
    // tenant_id: null = all orgs (platform staff only), else a specific org.
    const tenantId = body.tenant_id ? parseInt(body.tenant_id, 10) : null;
    const userId = req.session.userId || req.session.user?.user_id || null;

    const result = await db.query(
      `INSERT INTO broadcast_announcements
        (tenant_id, title, body, image_url, display_type, variant, cta_links, dismissible, frequency, max_views, starts_at, ends_at, is_active, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10, COALESCE($11, now()), $12, $13, $14)
       RETURNING *`,
      [
        tenantId,
        safeString(body.title).slice(0, 255),
        safeString(body.body),
        safeString(body.image_url) || null,
        displayType,
        variant,
        JSON.stringify(ctaLinks),
        body.dismissible !== false,
        frequency,
        maxViews,
        body.starts_at || null,
        body.ends_at || null,
        body.is_active !== false,
        userId,
      ]
    );
    await insertTargets(db, result.rows[0].id, targets);
    return res.status(201).json({ announcement: result.rows[0] });
  } catch (error) {
    console.error("[createGlobalAnnouncement]", error);
    return res.status(500).json({ error: "Unable to create announcement." });
  }
}

async function loadOwnedAnnouncement(req, id) {
  const result = await db.query(`SELECT * FROM broadcast_announcements WHERE id = $1`, [id]);
  const row = result.rows[0];
  if (!row) return { row: null, allowed: false };
  if (isPlatformAdmin(req)) return { row, allowed: true };
  const allowed = row.tenant_id === req.session.organizationId;
  return { row, allowed };
}

async function updateAnnouncement(req, res) {
  try {
    await ensureAnnouncementSchema(db);
    const id = parseInt(req.params.id, 10);
    const { row, allowed } = await loadOwnedAnnouncement(req, id);
    if (!row) return res.status(404).json({ error: "Announcement not found." });
    if (!allowed) return res.status(403).json({ error: "Not permitted to edit this announcement." });

    const body = req.body || {};
    const displayType = body.display_type === "banner" ? "banner" : "modal";
    const variant = ["info", "success", "warning", "new"].includes(body.variant) ? body.variant : row.variant;
    const frequency = require("../utils/announcementFrequency").VALID_FREQUENCIES.has(body.frequency)
      ? body.frequency
      : row.frequency;
    const maxViews = frequency === "n_times" ? parseInt(body.max_views, 10) || row.max_views : null;
    const ctaLinks = body.cta_links !== undefined ? parseCtaLinks(body.cta_links) : row.cta_links;
    const allowOrgTargets = isPlatformAdmin(req);

    const result = await db.query(
      `UPDATE broadcast_announcements SET
        title=$1, body=$2, image_url=$3, display_type=$4, variant=$5, cta_links=$6,
        dismissible=$7, frequency=$8, max_views=$9, starts_at=COALESCE($10, starts_at),
        ends_at=$11, is_active=$12, updated_at=now()
       WHERE id=$13 RETURNING *`,
      [
        safeString(body.title).slice(0, 255) || row.title,
        body.body !== undefined ? safeString(body.body) : row.body,
        body.image_url !== undefined ? safeString(body.image_url) || null : row.image_url,
        displayType,
        variant,
        JSON.stringify(ctaLinks),
        body.dismissible !== undefined ? body.dismissible !== false : row.dismissible,
        frequency,
        maxViews,
        body.starts_at || null,
        body.ends_at !== undefined ? body.ends_at || null : row.ends_at,
        body.is_active !== undefined ? body.is_active !== false : row.is_active,
        id,
      ]
    );

    if (body.targets !== undefined) {
      const targets = normalizeTargets(body.targets, { allowOrgTargets });
      await db.query(`DELETE FROM broadcast_announcement_targets WHERE announcement_id = $1`, [id]);
      await insertTargets(db, id, targets);
    }

    return res.json({ announcement: result.rows[0] });
  } catch (error) {
    console.error("[updateAnnouncement]", error);
    return res.status(500).json({ error: "Unable to update announcement." });
  }
}

async function deleteAnnouncement(req, res) {
  try {
    await ensureAnnouncementSchema(db);
    const id = parseInt(req.params.id, 10);
    const { row, allowed } = await loadOwnedAnnouncement(req, id);
    if (!row) return res.status(404).json({ error: "Announcement not found." });
    if (!allowed) return res.status(403).json({ error: "Not permitted to delete this announcement." });

    await db.query(`DELETE FROM broadcast_announcements WHERE id = $1`, [id]);
    return res.json({ success: true });
  } catch (error) {
    console.error("[deleteAnnouncement]", error);
    return res.status(500).json({ error: "Unable to delete announcement." });
  }
}

async function duplicateAnnouncement(req, res) {
  try {
    await ensureAnnouncementSchema(db);
    const id = parseInt(req.params.id, 10);
    const { row, allowed } = await loadOwnedAnnouncement(req, id);
    if (!row) return res.status(404).json({ error: "Announcement not found." });
    if (!allowed) return res.status(403).json({ error: "Not permitted to duplicate this announcement." });

    const targetsResult = await db.query(
      `SELECT target_type, target_value FROM broadcast_announcement_targets WHERE announcement_id = $1`,
      [id]
    );
    const userId = req.session.userId || req.session.user?.user_id || null;
    const insertResult = await db.query(
      `INSERT INTO broadcast_announcements
        (tenant_id, title, body, image_url, display_type, variant, cta_links, dismissible, frequency, max_views, starts_at, ends_at, is_active, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10, now(), $11, false, $12)
       RETURNING *`,
      [
        row.tenant_id,
        `${row.title} (copy)`,
        row.body,
        row.image_url,
        row.display_type,
        row.variant,
        JSON.stringify(row.cta_links),
        row.dismissible,
        row.frequency,
        row.max_views,
        row.ends_at,
        userId,
      ]
    );
    await insertTargets(
      db,
      insertResult.rows[0].id,
      targetsResult.rows.map((t) => ({ target_type: t.target_type, target_value: t.target_value }))
    );
    return res.status(201).json({ announcement: insertResult.rows[0] });
  } catch (error) {
    console.error("[duplicateAnnouncement]", error);
    return res.status(500).json({ error: "Unable to duplicate announcement." });
  }
}

async function listAnnouncements(req, res) {
  try {
    await ensureAnnouncementSchema(db);
    const admin = isPlatformAdmin(req);
    const organizationId = req.session.organizationId;

    const result = admin
      ? await db.query(`SELECT * FROM broadcast_announcements ORDER BY created_at DESC`)
      : await db.query(
          `SELECT * FROM broadcast_announcements WHERE tenant_id = $1 OR tenant_id IS NULL ORDER BY created_at DESC`,
          [organizationId]
        );

    const ids = result.rows.map((r) => r.id);
    let statsByAnnouncement = {};
    let targetsByAnnouncement = {};
    if (ids.length) {
      const statsResult = await db.query(
        `SELECT announcement_id,
                COUNT(*) FILTER (WHERE view_count > 0) AS seen_count,
                COUNT(*) FILTER (WHERE dismissed_at IS NOT NULL) AS dismissed_count
         FROM broadcast_announcement_receipts WHERE announcement_id = ANY($1::int[])
         GROUP BY announcement_id`,
        [ids]
      );
      statsByAnnouncement = Object.fromEntries(
        statsResult.rows.map((r) => [r.announcement_id, { seen: Number(r.seen_count), dismissed: Number(r.dismissed_count) }])
      );

      const targetsResult = await db.query(
        `SELECT announcement_id, target_type, target_value FROM broadcast_announcement_targets WHERE announcement_id = ANY($1::int[])`,
        [ids]
      );
      targetsByAnnouncement = targetsResult.rows.reduce((acc, t) => {
        (acc[t.announcement_id] = acc[t.announcement_id] || []).push({ target_type: t.target_type, target_value: t.target_value });
        return acc;
      }, {});
    }

    const announcements = result.rows.map((row) => ({
      ...row,
      stats: statsByAnnouncement[row.id] || { seen: 0, dismissed: 0 },
      targets: targetsByAnnouncement[row.id] || [],
    }));

    return res.json({ announcements });
  } catch (error) {
    console.error("[listAnnouncements]", error);
    return res.status(500).json({ error: "Unable to list announcements." });
  }
}

async function uploadImage(req, res) {
  try {
    if (!req.file) return res.status(400).json({ error: "No image uploaded." });
    const result = await uploadToS3(req.file, `images/announcements/${Date.now()}_${req.file.originalname}`);
    return res.json({ image_url: result.Location });
  } catch (error) {
    console.error("[announcement/uploadImage]", error);
    return res.status(500).json({ error: "Unable to upload image." });
  }
}

// Role tags that live in users.account_type (a free-text role string - there
// is no user_role column). student/parent/guardian live in separate tables
// entirely, and super_admin is Managira platform staff (the `admins` table),
// not an org user at all.
const ROLE_TAG_ACCOUNT_TYPES = {
  teacher: ["Teacher"],
  student_teacher: ["Student Teacher"],
  driver: ["Driver"],
  org_admin: ["Organization", "Admin", "Mini Admin"],
};

async function estimateRecipients(req, res) {
  try {
    await ensureAnnouncementSchema(db);
    const admin = isPlatformAdmin(req);
    const organizationId = req.session.organizationId;
    const targets = normalizeTargets(req.query.targets, { allowOrgTargets: admin });
    const tenantId = admin && req.query.tenant_id ? parseInt(req.query.tenant_id, 10) : organizationId;

    if (!targets.length) return res.json({ estimate: 0 });

    const roleValues = targets.filter((t) => t.target_type === "role").map((t) => t.target_value);
    const userValues = targets.filter((t) => t.target_type === "user").map((t) => parseInt(t.target_value, 10));
    const orgValues = targets.filter((t) => t.target_type === "org").map((t) => parseInt(t.target_value, 10));

    let estimate = 0;

    const staffAccountTypes = roleValues.flatMap((r) => ROLE_TAG_ACCOUNT_TYPES[r] || []);
    if (staffAccountTypes.length && tenantId) {
      const roleResult = await db.query(
        `SELECT COUNT(*) FROM users WHERE organization_id = $1 AND account_type = ANY($2::text[])`,
        [tenantId, staffAccountTypes]
      );
      estimate += Number(roleResult.rows[0].count);
    }
    if (roleValues.includes("student") && tenantId) {
      const studentResult = await db.query(`SELECT COUNT(*) FROM students WHERE organization_id = $1`, [tenantId]);
      estimate += Number(studentResult.rows[0].count);
    }
    if ((roleValues.includes("parent") || roleValues.includes("guardian")) && tenantId) {
      const guardianResult = await db.query(
        `SELECT COUNT(*) FROM guardian_profiles WHERE organization_id = $1`,
        [tenantId]
      );
      estimate += Number(guardianResult.rows[0].count);
    }
    if (roleValues.includes("super_admin")) {
      const adminResult = await db.query(`SELECT COUNT(*) FROM admins`).catch(() => ({ rows: [{ count: 0 }] }));
      estimate += Number(adminResult.rows[0].count);
    }

    estimate += userValues.length;
    if (orgValues.length && admin) {
      const orgResult = await db.query(
        `SELECT COUNT(*) FROM users WHERE organization_id = ANY($1::int[])`,
        [orgValues]
      );
      estimate += Number(orgResult.rows[0].count);
    }

    return res.json({ estimate });
  } catch (error) {
    console.error("[estimateRecipients]", error);
    return res.status(500).json({ error: "Unable to estimate recipients." });
  }
}

// ---- End-user delivery ------------------------------------------------

async function getMyAnnouncements(req, res) {
  try {
    await ensureAnnouncementSchema(db);
    const identity = resolveViewerIdentity(req);
    if (!identity) return res.status(401).json({ error: "Not signed in." });

    const roleTags = resolveViewerRoleTags(req);
    const orgId = identity.organizationId;

    const result = await db.query(
      `SELECT a.*, r.view_count, r.last_seen_at, r.dismissed_at, r.acknowledged_at
       FROM broadcast_announcements a
       LEFT JOIN broadcast_announcement_receipts r
         ON r.announcement_id = a.id AND r.user_id = $1 AND r.viewer_type = $2
       WHERE a.is_active = TRUE
         AND now() BETWEEN a.starts_at AND COALESCE(a.ends_at, 'infinity'::timestamptz)
         AND (a.tenant_id IS NULL OR a.tenant_id = $3)
         AND EXISTS (
           SELECT 1 FROM broadcast_announcement_targets t
           WHERE t.announcement_id = a.id
             AND ((t.target_type = 'role' AND t.target_value = ANY($4::text[]))
               OR (t.target_type = 'org' AND t.target_value = $3::text)
               OR (t.target_type = 'user' AND t.target_value = $1::text))
         )
       ORDER BY a.display_type ASC, a.created_at DESC`,
      [identity.userId, identity.viewerType, orgId, roleTags]
    );

    const now = new Date();
    const seenThisSession = new Set(req.session.seenAnnouncementIds || []);

    const eligible = result.rows.filter((row) => {
      if (row.frequency === "once_per_session" && seenThisSession.has(row.id)) return false;
      const receipt = row.view_count != null ? row : null;
      return !isFrequencyExhausted(
        { frequency: row.frequency, max_views: row.max_views, ends_at: row.ends_at },
        receipt,
        now
      );
    });

    const banners = eligible.filter((r) => r.display_type === "banner");
    const modals = eligible.filter((r) => r.display_type === "modal");

    return res.json({ banners, modals });
  } catch (error) {
    console.error("[getMyAnnouncements]", error);
    return res.status(500).json({ error: "Unable to load announcements." });
  }
}

async function upsertReceipt(req, res, field) {
  try {
    await ensureAnnouncementSchema(db);
    const identity = resolveViewerIdentity(req);
    if (!identity) return res.status(401).json({ error: "Not signed in." });
    const id = parseInt(req.params.id, 10);
    if (!id) return res.status(400).json({ error: "Invalid announcement id." });

    if (field === "seen") {
      if (!req.session.seenAnnouncementIds) req.session.seenAnnouncementIds = [];
      if (!req.session.seenAnnouncementIds.includes(id)) req.session.seenAnnouncementIds.push(id);

      await db.query(
        `INSERT INTO broadcast_announcement_receipts (announcement_id, user_id, viewer_type, tenant_id, view_count, first_seen_at, last_seen_at)
         VALUES ($1,$2,$3,$4,1,now(),now())
         ON CONFLICT (announcement_id, viewer_type, user_id)
         DO UPDATE SET view_count = broadcast_announcement_receipts.view_count + 1, last_seen_at = now()`,
        [id, identity.userId, identity.viewerType, identity.organizationId]
      );
    } else {
      const column = field === "dismiss" ? "dismissed_at" : "acknowledged_at";
      await db.query(
        `INSERT INTO broadcast_announcement_receipts (announcement_id, user_id, viewer_type, tenant_id, ${column})
         VALUES ($1,$2,$3,$4, now())
         ON CONFLICT (announcement_id, viewer_type, user_id)
         DO UPDATE SET ${column} = now()`,
        [id, identity.userId, identity.viewerType, identity.organizationId]
      );
    }

    return res.json({ success: true });
  } catch (error) {
    console.error(`[announcement/${field}]`, error);
    return res.status(500).json({ error: `Unable to record ${field}.` });
  }
}

const markSeen = (req, res) => upsertReceipt(req, res, "seen");
const markDismissed = (req, res) => upsertReceipt(req, res, "dismiss");
const markAcknowledged = (req, res) => upsertReceipt(req, res, "acknowledge");

module.exports = {
  createAnnouncement,
  createGlobalAnnouncement,
  updateAnnouncement,
  deleteAnnouncement,
  duplicateAnnouncement,
  listAnnouncements,
  estimateRecipients,
  uploadImage,
  getMyAnnouncements,
  markSeen,
  markDismissed,
  markAcknowledged,
  resolveViewerIdentity,
  resolveViewerRoleTags,
};
