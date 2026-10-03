// School website extras: saving the extra sections from the Manage Website
// page, section image uploads, the contact-form inbox, and the public
// contact form itself. See utils/websiteExtras.js for the data rules.
const db = require("../config/db");
const { uploadToS3 } = require("../middleware/s3Upload");
const { sendEmailInBackground, renderCleanEmail } = require("../utils/emailHelper");
const {
  SECTION_KEYS,
  ensureWebsiteSchema,
  getWebsiteSettings,
  saveWebsiteSection,
  visibleSections,
} = require("../utils/websiteExtras");

const IMAGE_TYPES = new Set(["image/jpeg", "image/png", "image/webp", "image/gif"]);
const MAX_IMAGE_BYTES = 5 * 1024 * 1024;

// Public form abuse limits: per IP, a few messages per window.
const CONTACT_WINDOW_MS = 10 * 60 * 1000;
const CONTACT_MAX_PER_WINDOW = 5;
const contactAttempts = new Map();

function tooManyContactAttempts(ip) {
  const now = Date.now();
  const recent = (contactAttempts.get(ip) || []).filter((t) => now - t < CONTACT_WINDOW_MS);
  recent.push(now);
  contactAttempts.set(ip, recent);
  if (contactAttempts.size > 5000) contactAttempts.clear();
  return recent.length > CONTACT_MAX_PER_WINDOW;
}

const clean = (value, max) => String(value == null ? "" : value).replace(/\s+/g, " ").trim().slice(0, max);

module.exports = {
  // POST /account/website/section/:key  (JSON) - saves one section.
  saveSection: async (req, res) => {
    const organizationId = req.session.organizationId;
    try {
      const key = String(req.params.key || "");
      if (!SECTION_KEYS.includes(key)) return res.status(400).json({ success: false, message: "Unknown section." });
      const section = await saveWebsiteSection(db, organizationId, key, req.body || {});
      return res.json({ success: true, section, message: "Saved." });
    } catch (error) {
      console.error("[website/saveSection]", error);
      return res.status(error.status || 500).json({ success: false, message: error.status ? error.message : "Could not save. Please try again." });
    }
  },

  // POST /account/website/image (multipart "image") - returns the image URL.
  uploadImage: async (req, res) => {
    const organizationId = req.session.organizationId;
    try {
      const file = req.file;
      if (!file) return res.status(400).json({ success: false, message: "Choose an image." });
      if (!IMAGE_TYPES.has(file.mimetype)) return res.status(400).json({ success: false, message: "Use a JPG, PNG, WebP or GIF image." });
      if (file.size > MAX_IMAGE_BYTES) return res.status(400).json({ success: false, message: "Images can be up to 5 MB." });
      const safeName = String(file.originalname || "image").replace(/[^a-zA-Z0-9._-]+/g, "_").slice(-60);
      const url = await uploadToS3(file, `images/website/org_${organizationId}/${Date.now()}_${safeName}`);
      return res.json({ success: true, url });
    } catch (error) {
      console.error("[website/uploadImage]", error);
      return res.status(500).json({ success: false, message: "The image could not be uploaded. Please try again." });
    }
  },

  // GET /account/website/messages?status=new|read|archived
  listMessages: async (req, res) => {
    const organizationId = req.session.organizationId;
    try {
      await ensureWebsiteSchema(db);
      const status = ["new", "read", "archived"].includes(req.query.status) ? req.query.status : null;
      const rows = (await db.query(
        `SELECT id, name, email, phone, subject, message, status, created_at
         FROM website_contact_messages
         WHERE organization_id = $1 AND ($2::text IS NULL OR status = $2) AND ($2::text IS NOT NULL OR status <> 'archived')
         ORDER BY created_at DESC LIMIT 100`,
        [organizationId, status]
      )).rows;
      const unread = rows.filter((r) => r.status === "new").length;
      return res.json({ success: true, messages: rows, unread });
    } catch (error) {
      console.error("[website/listMessages]", error);
      return res.status(500).json({ success: false, message: "Could not load messages." });
    }
  },

  // POST /account/website/messages/:id  { status: "read" | "new" | "archived" }
  updateMessage: async (req, res) => {
    const organizationId = req.session.organizationId;
    try {
      const status = String(req.body?.status || "");
      if (!["new", "read", "archived"].includes(status)) return res.status(400).json({ success: false, message: "Invalid status." });
      await ensureWebsiteSchema(db);
      const result = await db.query(
        `UPDATE website_contact_messages SET status = $1 WHERE id = $2 AND organization_id = $3`,
        [status, Number(req.params.id), organizationId]
      );
      if (!result.rowCount) return res.status(404).json({ success: false, message: "Message not found." });
      return res.json({ success: true });
    } catch (error) {
      console.error("[website/updateMessage]", error);
      return res.status(500).json({ success: false, message: "Could not update the message." });
    }
  },

  // POST /common/publicContact - the website's contact form (public).
  publicContact: async (req, res) => {
    const wantsJson = (req.get("accept") || "").includes("application/json");
    const reply = (status, message) => (wantsJson
      ? res.status(status).json({ success: status < 400, message })
      : res.status(status).send(message));
    try {
      const organizationId = Number(req.body?.organizationId);
      // Honeypot: real visitors never fill the hidden "website" field.
      if (String(req.body?.website || "").trim()) return reply(200, "Thank you - your message has been sent.");
      if (!organizationId) return reply(400, "This form isn't set up correctly.");
      if (tooManyContactAttempts(req.ip || "unknown")) return reply(429, "Too many messages - please try again in a few minutes.");

      const name = clean(req.body?.name, 120);
      const fromEmail = clean(req.body?.email, 200).toLowerCase();
      const phone = clean(req.body?.phone, 40);
      const subject = clean(req.body?.subject, 200);
      const message = String(req.body?.message || "").replace(/\r\n/g, "\n").trim().slice(0, 4000);
      if (!name || !message) return reply(400, "Please add your name and a message.");
      if (fromEmail && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(fromEmail)) return reply(400, "Please check your email address.");
      if (!fromEmail && !phone) return reply(400, "Please add an email address or phone number so the school can reply.");

      const settings = await getWebsiteSettings(db, organizationId);
      const toEmail = settings.contact.notifyEmail;
      if (!visibleSections(settings).contact) {
        return reply(404, "This school isn't accepting messages online right now.");
      }

      await db.query(
        `INSERT INTO website_contact_messages (organization_id, name, email, phone, subject, message)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [organizationId, name, fromEmail || null, phone || null, subject || null, message]
      );

      const school = (await db.query(`SELECT organization_name FROM organizations WHERE organization_id = $1`, [organizationId])).rows[0];
      sendEmailInBackground({
        to: toEmail,
        replyTo: fromEmail || undefined,
        subject: `Website message${subject ? `: ${subject}` : ""} - ${name}`,
        html: renderCleanEmail({
          title: "New message from your school website",
          greeting: `Hello ${school?.organization_name || ""}`.trim() + ",",
          paragraphs: message.split(/\n+/),
          details: [
            { label: "From", value: name },
            ...(fromEmail ? [{ label: "Email", value: fromEmail }] : []),
            ...(phone ? [{ label: "Phone", value: phone }] : []),
            ...(subject ? [{ label: "Subject", value: subject }] : []),
          ],
          note: fromEmail ? "Reply to this email to answer them directly. All messages are also in Manage Website > Messages." : "All messages are also in Manage Website > Messages.",
        }),
      }, "Website Contact Form");

      return reply(200, "Thank you - your message has been sent. The school will get back to you soon.");
    } catch (error) {
      console.error("[website/publicContact]", error);
      return reply(500, "Your message could not be sent. Please try again.");
    }
  },

  // Used by the public page and the manage page.
  getWebsiteSettings: (organizationId) => getWebsiteSettings(db, organizationId),
};
