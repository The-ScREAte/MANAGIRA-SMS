const db = require("../config/db");
const nodemailer = require("nodemailer");
const bcrypt = require("bcryptjs");
const { Parser } = require("json2csv");
const crypto = require("crypto");
const path = require("path");
const fs = require("fs");
const PDFDocument = require("pdfkit");
const { uploadToS3, deleteFromS3 } = require("../config/s3");
const he = require("he");
const cacheManager = require("../utils/cacheManager");
const { sendEmailSafely, sendEmailInBackground, renderCleanEmail } = require("../utils/emailHelper");
const {
  getCurrencyProfileForRequest,
  localizeUsdAmount,
  formatCurrencyAmount,
} = require("../utils/currencyLocalization");
const {
  getPaystackSettings,
  upsertPaystackSettings,
  normalizeMode,
} = require("../utils/paystackConfig");
const {
  invalidateOrganizationAccessCache,
  invalidateAccessForPlan,
} = require("../utils/accessCache");
const { ensureEmploymentSchema } = require("../utils/employmentSchema");

const adminController = {
  adminDashboard: async (req, res) => {
    try {
      // Use cache for organizations list - refreshes in background
      const applications = await cacheManager.getOrFetch(
        'admin',
        'organizations:list',
        async () => {
          const result = await db.query(`
            SELECT organization_id, organization_name, on_hold, hold_by, 
                   first_name, last_name, email, organization_address, organization_country, organization_province,
                   organization_phone, proof_of_existence_1, proof_of_existence_2, subdomain
            FROM organizations 
            WHERE deleted = false
              AND (hub_id IS NULL OR is_hub_member = false)
            ORDER BY organization_name ASC
          `);
          return result.rows;
        },
        { ttl: 300 } // 5 minute cache
      );

      res.render("admin/dashboard", {
        title: "Admin Dashboard",
        applications,
        messages: req.flash(),
        nodeEnv: process.env.NODE_ENV,
        baseDomain: "managira.com",
        showFooterTopSection: true
      });
    } catch (error) {
            req.flash("error", "Error fetching dashboard data.");
      res.render("admin/dashboard", {
        title: "Admin Dashboard",
        applications: [],
        messages: req.flash(),
        nodeEnv: process.env.NODE_ENV,
        baseDomain: "managira.com",
        showFooterTopSection: true
      });
    }
  },

  ensureAdmin: async (req, res, next) => {
    try {
      if (req.session.accountType !== "Admin") {
        req.flash("error", "You do not have permission to access this page.");
        return res.redirect("/admin");
      }
      next();
    } catch (error) {
            req.flash("error", "An error occurred during authorization.");
      res.redirect("/admin");
    }
  },

  createPromoPage: async (req, res) => {
    try {
      const promoCodesResult = await db.query(
        "SELECT * FROM promo_codes ORDER BY expiration_date DESC"
      );

      if (!promoCodesResult.rows.length) {
      }

      // Ensure promoCodes is always an array
      const promoCodes = promoCodesResult.rows || [];

      // Log what is being sent to the frontend

      res.render("admin/createPromo", {
        title: "Create Promo Code",
        promoCodes, // ✅ Ensure promoCodes is passed correctly
        messages: req.flash(),
        showFooterTopSection: true
      });
    } catch (error) {
            req.flash("error", "Failed to load promo codes.");
      res.redirect("/admin");
    }
  },

  createPromoCode: async (req, res) => {
    const { code, discount, expirationDate } = req.body;

    if (!code || !discount || !expirationDate) {
      req.flash("error", "All fields are required.");
      return res.redirect("/admin/create-promo");
    }

    try {
      const existingPromo = await db.query(
        "SELECT * FROM promo_codes WHERE code = $1",
        [code.toUpperCase()]
      );
      if (existingPromo.rows.length > 0) {
        req.flash("error", "Promo code already exists.");
        return res.redirect("/admin/create-promo");
      }

      await db.query(
        "INSERT INTO promo_codes (code, discount_percentage, expiration_date, is_active) VALUES ($1, $2, $3, TRUE)",
        [code.toUpperCase(), discount, expirationDate]
      );

      req.flash("success", "Promo code created successfully!");
      return res.redirect("/admin/create-promo");
    } catch (error) {
            req.flash("error", "An error occurred. Please try again.");
      return res.redirect("/admin/create-promo");
    }
  },

  deletePromoCode: async (req, res) => {
    const { id } = req.params;

    if (!id) {
      req.flash("error", "Invalid promo code ID.");
      return res.redirect("/admin/create-promo");
    }

    try {
      await db.query("DELETE FROM promo_codes WHERE id = $1", [id]);

      req.flash("success", "Promo code deleted successfully!");
      return res.redirect("/admin/create-promo");
    } catch (error) {
            req.flash("error", "Failed to delete promo code.");
      return res.redirect("/admin/create-promo");
    }
  },

  holdOrganization: async (req, res) => {
    const { orgId } = req.body;
    try {
      // Update on_hold to true and record Admin in hold_by
      const result = await db.query(
        `UPDATE organizations 
                 SET on_hold = true, hold_by = 'Admin' 
                 WHERE organization_id = $1 
                 RETURNING email, first_name, last_name`,
        [orgId]
      );
      const organization = result.rows[0];

      // Invalidate cache after update
      cacheManager.invalidate('admin', 'organizations:list');

      req.flash("success", "Organization put on hold successfully by Admin.");

      // Send email notification to the organization
      await sendEmailNotification(
        organization.email,
        "Your organization has been put on hold",
        `Dear ${organization.first_name} ${organization.last_name},\n\nYour organization's activities have been temporarily put on hold. Please contact us at info@managira.com for further information.\n\nBest regards,\nAdmin Team`
      );

      res.redirect("/admin");
    } catch (error) {
            req.flash("error", "Failed to put organization on hold.");
      res.redirect("/admin");
    }
  },

  resumeOrganization: async (req, res) => {
    const { orgId } = req.body;
    try {
      const result = await db.query(
        "UPDATE organizations SET on_hold = false WHERE organization_id = $1 RETURNING email, first_name, last_name",
        [orgId]
      );
      const organization = result.rows[0];

      // Invalidate cache after update
      cacheManager.invalidate('admin', 'organizations:list');

      req.flash("success", "Organization resumed successfully.");

      await sendEmailNotification(
        organization.email,
        "Your organization has been resumed",
        `Dear ${organization.first_name} ${organization.last_name},\n\nYour organization's activities have been resumed. You can continue using the platform.\n\nBest regards,\nAdmin Team`
      );

      res.redirect("/admin");
    } catch (error) {
            req.flash("error", "Failed to resume organization.");
      res.redirect("/admin");
    }
  },

  deleteOrganization: async (req, res) => {
    const { orgId } = req.body;
    try {
      const result = await db.query(
        "UPDATE organizations SET deleted = true WHERE organization_id = $1 RETURNING email, first_name, last_name",
        [orgId]
      );
      const organization = result.rows[0];

      // Invalidate cache after update
      cacheManager.invalidate('admin', 'organizations:list');

      req.flash("success", "Organization deleted successfully.");

      await sendEmailNotification(
        organization.email,
        "Your organization has been deleted",
        `Dear ${organization.first_name} ${organization.last_name},\n\nYour organization has been deleted from our records. If you believe this is a mistake, please contact us at info@managira.com.\n\nBest regards,\nAdmin Team`
      );

      res.redirect("/admin");
    } catch (error) {
            req.flash("error", "Failed to delete organization.");
      res.redirect("/admin");
    }
  },

  superAdminDashboard: async (req, res) => {
    try {
      // Fetch deleted organizations
      const deletedAccounts = await db.query(`
                SELECT organization_id, first_name, last_name, email, organization_name, organization_address, organization_country, organization_province, organization_phone, proof_of_existence_1, proof_of_existence_2
                FROM organizations
                WHERE deleted = true
            `);

      // Fetch deleted hubs
      const deletedHubs = await db.query(`
                SELECT h.hub_id,
                       h.hub_name,
                       h.hub_nickname,
                       h.hub_email,
                       h.first_name,
                       h.last_name,
                       h.hub_phone,
                       h.hub_address,
                       h.on_hold,
                       h.created_at,
                       h.updated_at,
                       COUNT(o.organization_id)::int AS linked_organizations_count,
                       COALESCE(
                         JSON_AGG(
                           JSON_BUILD_OBJECT(
                             'organization_id', o.organization_id,
                             'organization_name', o.organization_name,
                             'email', o.email,
                             'on_hold', o.on_hold,
                             'is_hub_member', o.is_hub_member
                           )
                           ORDER BY o.organization_name
                         ) FILTER (WHERE o.organization_id IS NOT NULL),
                         '[]'
                       ) AS linked_organizations
                FROM managira_hubs h
                LEFT JOIN organizations o ON o.hub_id = h.hub_id AND o.deleted = false
                WHERE h.deleted = true
                GROUP BY h.hub_id, h.hub_name, h.hub_nickname, h.hub_email, h.first_name, h.last_name,
                         h.hub_phone, h.hub_address, h.on_hold, h.created_at, h.updated_at
                ORDER BY h.updated_at DESC, h.created_at DESC
            `);

      // Fetch deleted threads
      const deletedThreads = await db.query(`
                SELECT ht.id AS thread_id, ht.name, ht.organization, ht.email, ht.phone, 
                       ARRAY_AGG(hm.message ORDER BY hm.created_at ASC) AS messages,
                       ht.is_resolved, ht.created_at, ht.last_updated
                FROM help_threads ht
                JOIN help_messages hm ON ht.id = hm.thread_id
                WHERE ht.is_deleted = true
                GROUP BY ht.id
                ORDER BY ht.id ASC
            `);

      res.render("admin/superDashboard", {
        title: "Super Admin Dashboard",
        deletedAccounts: deletedAccounts.rows, // Pass deleted accounts
        deletedHubs: deletedHubs.rows,
        deletedTickets: deletedThreads.rows, // Pass deleted threads
        messages: req.flash(), // Pass flash messages
        showFooterTopSection: true
      });
    } catch (error) {
            req.flash("error", "Failed to fetch data for the Super Admin Dashboard.");
      res.render("admin/superDashboard", {
        title: "Super Admin Dashboard",
        deletedAccounts: [], // Default to an empty array if the query fails
        deletedHubs: [],
        deletedTickets: [], // Default to an empty array if the query fails
        messages: req.flash(),
        showFooterTopSection: true
      });
    }
  },

  deleteAdminUser: async (req, res) => {
    const { userId } = req.params; // Ensure the userId is fetched correctly

    try {
      // Delete the user from the database
      await db.query(`DELETE FROM users WHERE user_id = $1`, [userId]);

      req.flash("success", "Admin user deleted successfully.");
      res.redirect("/admin/superSettings"); // Redirect back to the settings page
    } catch (error) {
            req.flash("error", "Failed to delete admin user.");
      res.redirect("/admin/superSettings");
    }
  },

  superAdminSettings: async (req, res) => {
    try {
      // Fetch all admin users (Mini Admin and Admin)
      const adminsResult = await db.query(
        `SELECT user_id, first_name, last_name, email, account_type, on_hold
                     FROM users
                     WHERE account_type IN ('Admin', 'Mini Admin')`
      );

      res.render("admin/superSettings", {
        title: "Super Admin Settings",
        admins: adminsResult.rows,
        messages: req.flash(),
        showFooterTopSection: true
      });
    } catch (error) {
            req.flash("error", "Failed to fetch admin users.");
      res.render("admin/superSettings", {
        title: "Super Admin Settings",
        admins: [],
        messages: req.flash(),
        showFooterTopSection: true
      });
    }
  },

  toggleAdminHoldStatus: async (req, res) => {
    const { userId } = req.body;

    try {
      // Toggle the hold status of the user
      const result = await db.query(
        `UPDATE users
                     SET on_hold = NOT on_hold
                     WHERE user_id = $1
                     RETURNING on_hold`,
        [userId]
      );

      const status = result.rows[0].on_hold ? "on hold" : "active";
      req.flash("success", `Admin user is now ${status}.`);
      res.redirect("/admin/superSettings");
    } catch (error) {
            req.flash("error", "Failed to update admin status.");
      res.redirect("/admin/superSettings");
    }
  },

  editAdminUserGet: async (req, res) => {
    const { userId } = req.params;

    try {
      // Fetch user details by userId
      const result = await db.query(
        `SELECT user_id, first_name, last_name, email, account_type
                     FROM users
                     WHERE user_id = $1`,
        [userId]
      );

      if (result.rows.length === 0) {
        req.flash("error", "Admin user not found.");
        return res.redirect("/admin/superSettings");
      }

      res.render("admin/editAdminUser", {
        title: "Edit Admin User",
        admin: result.rows[0],
        messages: req.flash(),
        showFooterTopSection: true
      });
    } catch (error) {
            req.flash("error", "Failed to load admin user details.");
      res.redirect("/admin/superSettings");
    }
  },

  editAdminUserPost: async (req, res) => {
    const { userId } = req.params;
    const { firstName, lastName, email, accountType } = req.body;

    try {
      const currentUserResult = await db.query(
        `SELECT email FROM users WHERE user_id = $1`,
        [userId]
      );

      if (currentUserResult.rows.length === 0) {
        req.flash("error", "Admin user not found.");
        return res.redirect("/admin/superSettings");
      }

      const currentEmail = currentUserResult.rows[0].email;

      if (email !== currentEmail) {
        // 🔍 Check email in users table
        const userCheck = await db.query(
          `SELECT user_id FROM users WHERE email = $1 LIMIT 1`,
          [email]
        );

        if (userCheck.rows.length > 0) {
          req.flash("error", "This email is already in use by another user.");
          return res.redirect(`/admin/editAdminUser/${userId}`);
        }

        // 🔍 Check email in organizations table
        const orgCheck = await db.query(
          `SELECT organization_id FROM organizations WHERE email = $1 LIMIT 1`,
          [email]
        );

        if (orgCheck.rows.length > 0) {
          req.flash(
            "error",
            "This email is already in use by an organization."
          );
          return res.redirect(`/admin/editAdminUser/${userId}`);
        }
      }

      await db.query(
        `UPDATE users
                 SET first_name = $1, last_name = $2, email = $3, account_type = $4, updated_at = NOW()
                 WHERE user_id = $5`,
        [firstName, lastName, email, accountType, userId]
      );

      req.flash("success", "Admin user details updated successfully.");
      res.redirect("/admin/superSettings");
    } catch (error) {
            req.flash("error", "Failed to update admin user details.");
      res.redirect(`/admin/editAdminUser/${userId}`);
    }
  },

  createAdminUser: async (req, res) => {
    const { firstName, lastName, adminUsername, adminEmail, adminRole } =
      req.body;

    try {
      // ✅ Check if the email exists in either users or organizations
      const emailCheckResult = await db.query(
        `
                  SELECT user_id FROM users WHERE email = $1
                  UNION
                  SELECT organization_id FROM organizations WHERE email = $1
                `,
        [adminEmail]
      );

      if (emailCheckResult.rows.length > 0) {
        req.flash(
          "error",
          "Email is already in use by an existing user or organization. Please choose a different email."
        );
        return res.redirect("/admin/superSettings");
      }

      // ✅ Generate a unique token for setting the password
      const token = crypto.randomBytes(32).toString("hex");
      const hashedToken = crypto
        .createHash("sha256")
        .update(token)
        .digest("hex");
      const tokenExpiration = new Date(Date.now() + 24 * 60 * 60 * 1000); // Token expires in 24 hours

      // ✅ Insert the admin user without a password
      await db.query(
        `INSERT INTO users (first_name, last_name, email, account_type, username, created_at, updated_at, reset_password_token, reset_password_expires)
                 VALUES ($1, $2, $3, $4, $5, NOW(), NOW(), $6, $7)`,
        [
          firstName,
          lastName,
          adminEmail,
          adminRole,
          adminUsername,
          hashedToken,
          tokenExpiration,
        ]
      );

      // ✅ Generate the password setup link
      const baseUrl = req.protocol + "://" + req.get("host");
      const setPasswordUrl = `${baseUrl}/common/set-password?token=${token}`;

      // ✅ Send the invite email
      await sendAdminInviteEmail(
        adminEmail,
        firstName,
        lastName,
        setPasswordUrl
      );

      req.flash(
        "success",
        "Admin user created successfully. Invitation sent to set their password."
      );
      res.redirect("/admin/superSettings");
    } catch (error) {
            req.flash("error", "Failed to create admin user.");
      res.redirect("/admin/superSettings");
    }
  },

  restoreOrganization: async (req, res) => {
    const { orgId } = req.body;
    try {
      const result = await db.query(
        "UPDATE organizations SET deleted = false WHERE organization_id = $1 RETURNING email, first_name, last_name",
        [orgId]
      );
      const organization = result.rows[0];

      req.flash("success", "Organization restored successfully.");

      await sendEmailNotification(
        organization.email,
        "Your organization has been restored",
        `Dear ${organization.first_name} ${organization.last_name},\n\nWe apologize for any inconvenience caused. Your organization has been restored.\n\nBest regards,\nAdmin Team`
      );

      res.redirect("/admin/superDashboard");
    } catch (error) {
            req.flash("error", "Failed to restore organization.");
      res.redirect("/admin/superDashboard");
    }
  },

  // Display help messages page
  helpMessages: async (req, res) => {
    try {
      const threads = await db.query(`
                SELECT ht.id AS thread_id, ht.name, ht.organization, ht.email, ht.phone, 
                       ARRAY_AGG(hm.message ORDER BY hm.created_at ASC) AS messages,
                       ht.is_resolved, ht.is_deleted, ht.created_at, ht.last_updated
                FROM help_threads ht
                JOIN help_messages hm ON ht.id = hm.thread_id
                WHERE ht.is_resolved = false AND ht.is_deleted = false
                GROUP BY ht.id
                ORDER BY ht.id ASC
            `);

      res.render("admin/helpMessages", {
        title: "Help Messages",
        threads: threads.rows,
        messages: req.flash(),
        showFooterTopSection: true
      });
    } catch (error) {
            res.status(500).send("Failed to fetch help messages.");
    }
  },

  respondToMessage: async (req, res) => {
    const { threadId, response } = req.body;

    try {
      const threadIdInt = parseInt(threadId, 10);
      if (isNaN(threadIdInt)) {
        req.flash("error", "Invalid thread ID.");
        return res.redirect("/admin/helpMessages");
      }

      // Fetch the thread details
      const threadQuery = await db.query(
        `SELECT id, name, email FROM help_threads WHERE id = $1 LIMIT 1`,
        [threadIdInt]
      );

      if (threadQuery.rows.length === 0) {
        req.flash("error", "Thread not found.");
        return res.redirect("/admin/helpMessages");
      }

      const thread = threadQuery.rows[0];

      // Save the admin response
      await db.query(
        `INSERT INTO help_messages (thread_id, name, email, message, is_response) 
                 VALUES ($1, $2, $3, $4, true)`, // `is_response` is `true` for admin
        [threadIdInt, "Admin", process.env.EMAIL_USER, response]
      );

      const html = renderCleanEmail({
        title: "Support Ticket Response",
        greeting: `Dear <strong>${he.encode(thread.name)}</strong>,`,
        paragraphs: [
          `Our team has responded to your support ticket (#${threadIdInt}).`,
        ],
        details: [
          { label: "Ticket Number", value: `#${threadIdInt}` },
          { label: "Response", value: response },
        ],
        note: 'If you have any questions, please visit our <a href="https://www.managira.com/legal/help" target="_blank" rel="noopener">Help Center</a> or <a href="https://www.managira.com/legal/faq" target="_blank" rel="noopener">FAQ page</a>.',
      });

      const mailOptions = {
        from: process.env.NOTIFY_EMAIL_USER,
        to: thread.email,
        subject: `Response to Support Ticket #${threadIdInt}`,
        html,
        attachments: [
          {
            filename: 'managira.png',
            path: require('path').join(__dirname, '../public/images/managira.png'),
            cid: 'managira_logo'
          }
        ]
      };

      sendEmailInBackground(mailOptions, "Admin Support Response Email");
      req.flash("success", "Response sent and saved successfully.");
      res.redirect("/admin/helpMessages");
    } catch (error) {
            req.flash("error", "Failed to process the response.");
      res.redirect("/admin/helpMessages");
    }
  },

  // Mark a message as resolved
  markAsResolved: async (req, res) => {
    const { threadId } = req.body;

    try {
      const threadIdInt = parseInt(threadId, 10);
      if (isNaN(threadIdInt)) {
        req.flash("error", "Invalid thread ID.");
        return res.redirect("/admin/helpMessages");
      }

      // Fetch the thread details
      const threadQuery = await db.query(
        `SELECT id, name, email FROM help_threads WHERE id = $1 LIMIT 1`,
        [threadIdInt]
      );

      if (threadQuery.rows.length === 0) {
        req.flash("error", "Thread not found.");
        return res.redirect("/admin/helpMessages");
      }

      const thread = threadQuery.rows[0];

      // Mark the ticket as resolved
      await db.query(
        `UPDATE help_threads SET is_resolved = true WHERE id = $1`,
        [threadIdInt]
      );

      const html = renderCleanEmail({
        title: "Support Ticket Resolved",
        greeting: `Dear <strong>${he.encode(thread.name)}</strong>,`,
        paragraphs: [
          `We are pleased to inform you that your support ticket (#${threadIdInt}) has been resolved.`,
          "If you have any further questions, please reach out to us.",
        ],
        note: 'If you have any questions, please visit our <a href="https://www.managira.com/legal/help" target="_blank" rel="noopener">Help Center</a> or <a href="https://www.managira.com/legal/faq" target="_blank" rel="noopener">FAQ page</a>.',
      });

      const mailOptions = {
        from: process.env.NOTIFY_EMAIL_USER,
        to: thread.email,
        subject: `Your Support Ticket #${threadIdInt} Has Been Resolved`,
        html,
        attachments: [
          {
            filename: 'managira.png',
            path: require('path').join(__dirname, '../public/images/managira.png'),
            cid: 'managira_logo'
          }
        ]
      };

      sendEmailInBackground(mailOptions, "Admin Ticket Resolved Email");
      req.flash("success", "Ticket marked as closed and email notification queued.");
      res.redirect("/admin/helpMessages");
    } catch (error) {
            req.flash("error", "Failed to mark as closed.");
      res.redirect("/admin/helpMessages");
    }
  },

  helpHistory: async (req, res) => {
    try {
      const threads = await db.query(`
                SELECT ht.id AS thread_id, ht.name, ht.organization, ht.email, ht.phone, 
                       ARRAY_AGG(hm.message ORDER BY hm.created_at ASC) AS messages,
                       ht.is_resolved, ht.created_at, ht.last_updated
                FROM help_threads ht
                JOIN help_messages hm ON ht.id = hm.thread_id
                WHERE ht.is_resolved = true AND ht.is_deleted = false
                GROUP BY ht.id
                ORDER BY ht.id ASC
            `);

      res.render("admin/helpHistory", {
        title: "Help History",
        threads: threads.rows,
        showFooterTopSection: true
      });
    } catch (error) {
            res.status(500).send("Failed to fetch help history.");
    }
  },

  reopenThread: async (req, res) => {
    const { threadId } = req.body;

    try {
      const threadIdInt = parseInt(threadId, 10);
      if (isNaN(threadIdInt)) {
        req.flash("error", "Invalid thread ID.");
        return res.redirect("/admin/helpHistory");
      }

      // Fetch the thread details
      const threadQuery = await db.query(
        `SELECT id, name, email FROM help_threads WHERE id = $1 LIMIT 1`,
        [threadIdInt]
      );

      if (threadQuery.rows.length === 0) {
        req.flash("error", "Thread not found.");
        return res.redirect("/admin/helpHistory");
      }

      const thread = threadQuery.rows[0];

      // Reopen the ticket
      await db.query(
        `UPDATE help_threads SET is_resolved = false WHERE id = $1`,
        [threadIdInt]
      );

      const html = renderCleanEmail({
        title: "Support Ticket Reopened",
        greeting: `Dear <strong>${he.encode(thread.name)}</strong>,`,
        paragraphs: [
          `Your support ticket (#${threadIdInt}) has been reopened. Our team is actively working on your concern and will update you shortly.`,
        ],
        note: 'If you have any questions, please visit our <a href="https://www.managira.com/legal/help" target="_blank" rel="noopener">Help Center</a> or <a href="https://www.managira.com/legal/faq" target="_blank" rel="noopener">FAQ page</a>.',
      });

      const mailOptions = {
        from: process.env.NOTIFY_EMAIL_USER,
        to: thread.email,
        subject: `Your Support Ticket #${threadIdInt} Has Been Reopened`,
        html,
        attachments: [
          {
            filename: 'managira.png',
            path: require('path').join(__dirname, '../public/images/managira.png'),
            cid: 'managira_logo'
          }
        ]
      };

      sendEmailInBackground(mailOptions, "Admin Ticket Reopened Email");
      req.flash("success", "Ticket reopened and email notification queued.");
      res.redirect("/admin/helpHistory");
    } catch (error) {
            req.flash("error", "Failed to reopen the thread.");
      res.redirect("/admin/helpHistory");
    }
  },

  deleteThread: async (req, res) => {
    const { threadId } = req.body;

    try {
      await db.query(`DELETE FROM help_threads WHERE id = $1`, [threadId]);
      req.flash("success", "Thread deleted successfully.");
      res.redirect("/admin/helpHistory");
    } catch (error) {
            req.flash("error", "Failed to delete thread.");
      res.redirect("/admin/helpHistory");
    }
  },

  restoreMessage: async (req, res) => {
    const { threadId } = req.body;

    try {
      await db.query(
        `UPDATE help_threads SET is_deleted = false, is_resolved = false WHERE id = $1`,
        [threadId]
      );
      req.flash("success", "Thread restored to Help Messages.");
      res.redirect("/admin/superDashboard");
    } catch (error) {
            req.flash("error", "Failed to restore thread.");
      res.redirect("/admin/superDashboard");
    }
  },

  permanentDeleteMessage: async (req, res) => {
    const { threadId } = req.body;

    try {
      await db.query(`DELETE FROM help_threads WHERE id = $1`, [threadId]);
      req.flash("success", "Thread permanently deleted.");
      res.redirect("/admin/superDashboard");
    } catch (error) {
            req.flash("error", "Failed to delete thread.");
      res.redirect("/admin/superDashboard");
    }
  },

  tempDeleteMessage: async (req, res) => {
    const { threadId } = req.body;

    try {
      const threadIdInt = parseInt(threadId, 10);
      if (isNaN(threadIdInt)) {
        req.flash("error", "Invalid thread ID.");
        return res.redirect("/admin/helpMessages");
      }

      // Temporarily delete the thread
      await db.query(
        `UPDATE help_threads SET is_deleted = true WHERE id = $1`,
        [threadIdInt]
      );

      req.flash(
        "success",
        "Thread moved to review in the Super Admin Dashboard."
      );
      res.redirect("/admin/helpMessages");
    } catch (error) {
            req.flash("error", "Failed to delete thread.");
      res.redirect("/admin/helpMessages");
    }
  },

  servicePricingGet: async (req, res) => {
    try {
      const currencyProfile = await getCurrencyProfileForRequest(req);
      const paystackSettings = await getPaystackSettings(db);
      const featuresResult = await db.query(
        "SELECT * FROM features ORDER BY feature_name ASC"
      );

      const plansResult = await db.query(`
                SELECT p.id AS plan_id, p.plan_name, p.description, p.is_active, p.total_cost,
                    COALESCE(JSON_AGG(json_build_object(
                        'id', f.id, 
                        'feature_name', f.feature_name, 
                        'price_usd', f.price_usd
                    )) FILTER (WHERE f.id IS NOT NULL), '[]') AS features
                FROM plans p
                LEFT JOIN plan_features pf ON p.id = pf.plan_id
                LEFT JOIN features f ON pf.feature_id = f.id
                WHERE p.id IN (1, 2, 3, 4)
                GROUP BY p.id
                ORDER BY p.id;
            `);


      const localizedFeatures = (featuresResult.rows || []).map((feature) => {
        const usdPrice = Number(feature.price_usd || 0);
        const localized = localizeUsdAmount(usdPrice, currencyProfile);
        return {
          ...feature,
          priceUsdDisplay: formatCurrencyAmount(localized.amountUsd, "USD"),
          localizedPriceDisplay: formatCurrencyAmount(
            localized.localizedAmount,
            localized.userCurrency,
            currencyProfile.locale
          ),
        };
      });

      const localizedPlans = (plansResult.rows || []).map((plan) => {
        const totalUsd = Number(plan.total_cost || 0);
        const localized = localizeUsdAmount(totalUsd, currencyProfile);
        const normalizedFeatures = Array.isArray(plan.features) ? plan.features : [];
        return {
          ...plan,
          features: normalizedFeatures.map((feature) => {
            const featureUsd = Number(feature.price_usd || 0);
            const featureLocalized = localizeUsdAmount(featureUsd, currencyProfile);
            return {
              ...feature,
              priceUsdDisplay: formatCurrencyAmount(featureLocalized.amountUsd, "USD"),
              localizedPriceDisplay: formatCurrencyAmount(
                featureLocalized.localizedAmount,
                featureLocalized.userCurrency,
                currencyProfile.locale
              ),
            };
          }),
          totalUsdDisplay: formatCurrencyAmount(localized.amountUsd, "USD"),
          localizedTotalDisplay: formatCurrencyAmount(
            localized.localizedAmount,
            localized.userCurrency,
            currencyProfile.locale
          ),
        };
      });

      // Get free trial and billing interval settings directly from DB
      let freeTrialEnabled = 'false';
      let freeTrialDays = 7;
      let billingInterval = 'monthly';
      try {
        const enabledResult = await db.query("SELECT value FROM app_settings WHERE key = 'free_trial_enabled'");
        if (enabledResult.rows.length > 0) freeTrialEnabled = enabledResult.rows[0].value;
        const daysResult = await db.query("SELECT value FROM app_settings WHERE key = 'free_trial_days'");
        if (daysResult.rows.length > 0) freeTrialDays = daysResult.rows[0].value;
        const intervalResult = await db.query("SELECT value FROM app_settings WHERE key = 'billing_interval'");
        if (intervalResult.rows.length > 0) billingInterval = intervalResult.rows[0].value;
      } catch (err) {
              }

      res.render("admin/servicePricing", {
        title: "Service Pricing Management",
        features: localizedFeatures,
        plans: localizedPlans,
        currencyProfile,
        messages: req.flash(),
        freeTrialEnabled,
        freeTrialDays,
        billingInterval,
        paystackMode: paystackSettings.mode,
        showFooterTopSection: true
      });
    } catch (error) {
            req.flash("error", "Failed to fetch service pricing.");
      res.redirect("/admin");
    }
  },

  updateFreeTrialSettings: async (req, res) => {
    try {
      const { free_trial_enabled, free_trial_days } = req.body;
      const enabled = free_trial_enabled === 'true' ? 'true' : 'false';
      let days;
      if (free_trial_days === '5_minutes') {
        days = '5_minutes';
      } else {
        const numDays = parseInt(free_trial_days, 10);
        if ([1, 7, 14, 30, 60, 90, 120].includes(numDays)) {
          days = String(numDays);
        } else {
          days = '7'; // Default fallback
        }
      }
      await db.query(`INSERT INTO app_settings(key, value) VALUES ('free_trial_enabled', $1)
        ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value`, [enabled]);
      await db.query(`INSERT INTO app_settings(key, value) VALUES ('free_trial_days', $1)
        ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value`, [days]);
      req.flash('success', 'Free trial settings updated.');
    } catch (error) {
            req.flash('error', 'Failed to update free trial settings.');
    }
    res.redirect('/admin/servicePricing');
  },

  updateBillingInterval: async (req, res) => {
    try {
      const { billing_interval } = req.body;
      const allowed = ['5_minutes', 'daily', 'weekly', 'monthly', 'yearly', '2_years', '3_years'];
      const interval = allowed.includes(billing_interval) ? billing_interval : 'monthly';
      await db.query(`INSERT INTO app_settings(key, value) VALUES ('billing_interval', $1)
        ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value`, [interval]);
      req.flash('success', 'Billing interval updated.');
    } catch (error) {
            req.flash('error', 'Failed to update billing interval.');
    }
    res.redirect('/admin/servicePricing');
  },

  updatePaystackSettings: async (req, res) => {
    try {
      const { paystack_mode } = req.body;

      const existing = await getPaystackSettings(db);
      const mode = normalizeMode(paystack_mode);

      if (mode === "live" && (!existing.liveSecretKey || !existing.livePublicKey)) {
        req.flash("error", "Live mode requires both live secret and live public keys.");
        return res.redirect("/admin/servicePricing");
      }

      if (mode === "test" && (!existing.testSecretKey || !existing.testPublicKey)) {
        req.flash("error", "Test mode requires both test secret and test public keys.");
        return res.redirect("/admin/servicePricing");
      }

      await upsertPaystackSettings(
        {
          paystack_mode: mode,
        },
        db
      );

      req.flash("success", `Paystack mode set to ${mode.toUpperCase()} and keys saved.`);
    } catch (error) {
      req.flash("error", "Failed to update Paystack settings.");
    }

    return res.redirect("/admin/servicePricing");
  },

  scheduledHoldsPage: async (req, res) => {
    try {
      const result = await db.query(
        `SELECT organization_id, organization_name, scheduled_hold_date 
                     FROM organizations 
                     WHERE scheduled_hold_date IS NOT NULL 
                     ORDER BY scheduled_hold_date ASC`
      );

      res.render("admin/scheduledHolds", {
        title: "Scheduled Holds",
        organizations: result.rows,
        messages: req.flash(),
      });
    } catch (error) {
            req.flash("error", "Failed to load scheduled holds.");
      res.redirect("/admin");
    }
  },

  addFeature: async (req, res) => {
    const { featureName, priceUsd } = req.body;
    try {
      await db.query(
        "INSERT INTO features (feature_name, price_usd) VALUES ($1, $2)",
        [featureName, priceUsd]
      );
      req.flash("success", "Feature added successfully.");
      res.redirect("/admin/servicePricing");
    } catch (error) {
            req.flash("error", "Failed to add feature.");
      res.redirect("/admin/servicePricing");
    }
  },

  updateFeature: async (req, res) => {
    const { featureId, featureName, priceUsd } = req.body;
    try {
      await db.query(
        "UPDATE features SET feature_name = $1, price_usd = $2 WHERE id = $3",
        [featureName, priceUsd, featureId]
      );
      req.flash("success", "Feature updated successfully.");
      res.redirect("/admin/servicePricing");
    } catch (error) {
            req.flash("error", "Failed to update feature.");
      res.redirect("/admin/servicePricing");
    }
  },

  togglePlanStatus: async (req, res) => {
    const { planId } = req.body;
    try {
      await db.query(
        "UPDATE plans SET is_active = NOT is_active WHERE id = $1",
        [planId]
      );
      req.flash("success", "Plan activation status updated.");
      res.redirect("/admin/servicePricing");
    } catch (error) {
            req.flash("error", "Failed to update plan status.");
      res.redirect("/admin/servicePricing");
    }
  },

  addFeatureToPlan: async (req, res) => {
    const { planId, featureId } = req.body;

    try {
      // Get feature price
      const featureResult = await db.query(
        "SELECT price_usd FROM features WHERE id = $1",
        [featureId]
      );

      if (featureResult.rows.length === 0) {
        req.flash("error", "Feature not found.");
        return res.redirect("/admin/servicePricing");
      }

      const featurePrice = featureResult.rows[0].price_usd;

      // Add feature to plan
      await db.query(
        "INSERT INTO plan_features (plan_id, feature_id) VALUES ($1, $2)",
        [planId, featureId]
      );

      // Update total cost
      await db.query(
        "UPDATE plans SET total_cost = total_cost + $1 WHERE id = $2",
        [featurePrice, planId]
      );

      await invalidateAccessForPlan(db, planId);

      req.flash("success", "Feature added and total cost updated.");
      res.redirect("/admin/servicePricing");
    } catch (error) {
            req.flash("error", "Failed to add feature.");
      res.redirect("/admin/servicePricing");
    }
  },

  removeFeatureFromPlan: async (req, res) => {
    const { planId, featureId } = req.body;

    try {
      // Get feature price
      const featureResult = await db.query(
        "SELECT price_usd FROM features WHERE id = $1",
        [featureId]
      );

      if (featureResult.rows.length === 0) {
        req.flash("error", "Feature not found.");
        return res.redirect("/admin/servicePricing");
      }

      const featurePrice = featureResult.rows[0].price_usd;

      // Remove feature from plan
      await db.query(
        "DELETE FROM plan_features WHERE plan_id = $1 AND feature_id = $2",
        [planId, featureId]
      );

      // Update total cost
      await db.query(
        "UPDATE plans SET total_cost = total_cost - $1 WHERE id = $2",
        [featurePrice, planId]
      );

      await invalidateAccessForPlan(db, planId);

      req.flash("success", "Feature removed and total cost updated.");
      res.redirect("/admin/servicePricing");
    } catch (error) {
            req.flash("error", "Failed to remove feature.");
      res.redirect("/admin/servicePricing");
    }
  },

  updatePlanDescription: async (req, res) => {
    const { planId, description } = req.body;
    try {
      await db.query("UPDATE plans SET description = $1 WHERE id = $2", [
        description,
        planId,
      ]);
      req.flash("success", "Plan description updated.");
      res.redirect("/admin/servicePricing");
    } catch (error) {
            req.flash("error", "Failed to update.");
      res.redirect("/admin/servicePricing");
    }
  },

  deleteFeature: async (req, res) => {
    const { featureId } = req.body;
    try {
      await db.query("DELETE FROM features WHERE id = $1", [featureId]);
      res.json({ success: true });
    } catch (error) {
            res.json({ success: false, error: "Failed to delete feature." });
    }
  },

  permanentlyDeleteOrganization: async (req, res) => {
    const { orgId } = req.body;
    try {
      await db.query("BEGIN");

      await db.query(
        `DELETE FROM user_subjects
         WHERE user_id IN (
           SELECT user_id FROM users WHERE organization_id = $1
         )
         OR subject_id IN (
           SELECT subject_id FROM subjects WHERE organization_id = $1
         )`,
        [orgId]
      );

      await db.query(
        `DELETE FROM organization_texts WHERE organization_id = $1`,
        [orgId]
      );

      const deleteResult = await db.query("DELETE FROM organizations WHERE organization_id = $1", [
        orgId,
      ]);

      if (deleteResult.rowCount === 0) {
        await db.query("ROLLBACK");
        req.flash("error", "Organization not found or already deleted.");
        return res.redirect("/admin/superDashboard");
      }

      await db.query("COMMIT");

      req.flash("success", "Organization permanently deleted successfully.");
      res.redirect("/admin/superDashboard");
    } catch (error) {
      try { await db.query("ROLLBACK"); } catch (_) {}

      let detailedMessage = "Failed to permanently delete organization.";

      if (error?.code === "23503") {
        detailedMessage =
          "Failed to permanently delete organization: it is linked to protected records.";

        try {
          if (error?.constraint) {
            const fkInfoResult = await db.query(
              `SELECT ns.nspname AS schema_name,
                      cls.relname AS table_name,
                      att.attname AS column_name
               FROM pg_constraint con
               JOIN pg_class cls ON cls.oid = con.conrelid
               JOIN pg_namespace ns ON ns.oid = cls.relnamespace
               JOIN unnest(con.conkey) WITH ORDINALITY AS ck(attnum, ord) ON true
               JOIN pg_attribute att ON att.attrelid = con.conrelid AND att.attnum = ck.attnum
               WHERE con.conname = $1
               LIMIT 1`,
              [error.constraint]
            );

            const fkInfo = fkInfoResult.rows[0];

            if (fkInfo) {
              const qSchema = String(fkInfo.schema_name).replace(/"/g, '""');
              const qTable = String(fkInfo.table_name).replace(/"/g, '""');
              const qColumn = String(fkInfo.column_name).replace(/"/g, '""');

              const countResult = await db.query(
                `SELECT COUNT(*)::int AS count
                 FROM "${qSchema}"."${qTable}"
                 WHERE "${qColumn}" = $1`,
                [orgId]
              );

              let linkedCount = countResult.rows[0]?.count || 0;

              if (linkedCount === 0 && fkInfo.table_name === "user_subjects") {
                if (fkInfo.column_name === "subject_id") {
                  const accurateCountResult = await db.query(
                    `SELECT COUNT(*)::int AS count
                     FROM user_subjects us
                     JOIN subjects s ON s.subject_id = us.subject_id
                     WHERE s.organization_id = $1`,
                    [orgId]
                  );
                  linkedCount = accurateCountResult.rows[0]?.count || 0;
                } else if (fkInfo.column_name === "user_id") {
                  const accurateCountResult = await db.query(
                    `SELECT COUNT(*)::int AS count
                     FROM user_subjects us
                     JOIN users u ON u.user_id = us.user_id
                     WHERE u.organization_id = $1`,
                    [orgId]
                  );
                  linkedCount = accurateCountResult.rows[0]?.count || 0;
                }
              }

              detailedMessage = linkedCount > 0
                ? `Failed to permanently delete organization: linked to ${linkedCount} record(s) in ${fkInfo.table_name} (${fkInfo.column_name}). Remove or reassign these records first.`
                : `Failed to permanently delete organization: linked records exist in ${fkInfo.table_name} (${fkInfo.column_name}). Remove or reassign related records first.`;
            }
          }
        } catch (fkLookupError) {
        }
      } else if (error?.message) {
        detailedMessage = `Failed to permanently delete organization: ${error.message}`;
      }

      req.flash("error", detailedMessage);
      res.redirect("/admin/superDashboard");
    }
  },

  dataExportPage: async (req, res) => {
    try {
      const result = await db.query(
        "SELECT organization_id, organization_name FROM organizations"
      );
      res.render("admin/dataExport", {
        title: "Data Export",
        organizations: result.rows,
        messages: req.flash(),
      });
    } catch (error) {
            req.flash("error", "Failed to load Data Export page.");
      res.redirect("/admin");
    }
  },

  getEmploymentAdmin: async (req, res) => {
    await ensureEmploymentSchema(db);

    const jobs = await db.query(`
      SELECT
        e.*,
        COALESCE(a.application_count, 0)::int AS application_count
      FROM employment e
      LEFT JOIN (
        SELECT employment_id, COUNT(*) AS application_count
        FROM employment_applications
        GROUP BY employment_id
      ) a ON a.employment_id = e.id
      ORDER BY e.created_at DESC
    `);

    const applications = await db.query(`
      SELECT
        ea.*,
        e.title AS job_title
      FROM employment_applications ea
      JOIN employment e ON e.id = ea.employment_id
      ORDER BY
        CASE
          WHEN ea.status = 'pending' THEN 0
          WHEN ea.status = 'approved' THEN 1
          ELSE 2
        END,
        ea.created_at DESC
    `);

    res.render("admin/manageEmployment", {
      title: "Manage Employment",
      jobs: jobs.rows,
      applications: applications.rows,
      messages: req.flash(),
      showFooterTopSection: true
    });
  },

  postEmployment: async (req, res) => {
    await ensureEmploymentSchema(db);

    const { title, description, external_link, application_mode } = req.body;
    const normalizedMode = application_mode === "in_app" ? "in_app" : "external";
    const normalizedExternalLink = external_link ? external_link.trim() : "";

    if (!title || !description) {
      req.flash("error", "All fields are required.");
      return res.redirect("/admin/employment");
    }

    if (normalizedMode === "external" && !normalizedExternalLink) {
      req.flash("error", "External application link is required for external mode.");
      return res.redirect("/admin/employment");
    }

    try {
      await db.query(
        `INSERT INTO employment (title, description, external_link, application_mode, is_active) VALUES ($1, $2, $3, $4, TRUE)`,
        [
          title.trim(),
          description.trim(),
          normalizedMode === "external" ? normalizedExternalLink : null,
          normalizedMode,
        ]
      );
      req.flash("success", "Job added successfully.");
    } catch (err) {
            req.flash("error", "Error saving job.");
    }

    res.redirect("/admin/employment");
  },

  updateEmployment: async (req, res) => {
    await ensureEmploymentSchema(db);

    const employmentId = Number.parseInt(req.params.id, 10);
    const { title, description, external_link, application_mode } = req.body;
    const normalizedMode = application_mode === "in_app" ? "in_app" : "external";
    const normalizedExternalLink = external_link ? external_link.trim() : "";

    if (!Number.isInteger(employmentId)) {
      req.flash("error", "Invalid job selected.");
      return res.redirect("/admin/employment");
    }

    if (!title || !description) {
      req.flash("error", "Title and description are required.");
      return res.redirect("/admin/employment");
    }

    if (normalizedMode === "external" && !normalizedExternalLink) {
      req.flash("error", "External application link is required for external mode.");
      return res.redirect("/admin/employment");
    }

    try {
      const result = await db.query(
        `UPDATE employment
         SET title = $2,
             description = $3,
             external_link = $4,
             application_mode = $5,
             updated_at = CURRENT_TIMESTAMP
         WHERE id = $1
         RETURNING id`,
        [
          employmentId,
          title.trim(),
          description.trim(),
          normalizedMode === "external" ? normalizedExternalLink : null,
          normalizedMode,
        ]
      );

      if (!result.rows.length) {
        req.flash("error", "Job not found.");
      } else {
        req.flash("success", "Job updated successfully.");
      }
    } catch (error) {
      req.flash("error", "Failed to update job.");
    }

    return res.redirect("/admin/employment");
  },

  toggleEmploymentStatus: async (req, res) => {
    await ensureEmploymentSchema(db);

    const employmentId = Number.parseInt(req.params.id, 10);
    if (!Number.isInteger(employmentId)) {
      req.flash("error", "Invalid job selected.");
      return res.redirect("/admin/employment");
    }

    try {
      const result = await db.query(
        `UPDATE employment
         SET is_active = NOT is_active,
             updated_at = CURRENT_TIMESTAMP
         WHERE id = $1
         RETURNING is_active`,
        [employmentId]
      );

      if (!result.rows.length) {
        req.flash("error", "Job not found.");
      } else {
        req.flash("success", result.rows[0].is_active ? "Job is now active and visible on Job Posting." : "Job is now inactive and hidden from Job Posting.");
      }
    } catch (error) {
      req.flash("error", "Failed to change job status.");
    }

    return res.redirect("/admin/employment");
  },

  recalculateAllPlanTotals: async (req, res) => {
    try {
      // Recalculate total_cost for all plans based on their current features
      await db.query(`
        UPDATE plans 
        SET total_cost = COALESCE((
          SELECT SUM(f.price_usd) 
          FROM plan_features pf 
          JOIN features f ON pf.feature_id = f.id 
          WHERE pf.plan_id = plans.id
        ), 0)
      `);
      
      req.flash("success", "All plan total costs have been recalculated successfully.");
      res.redirect("/admin/servicePricing");
    } catch (error) {
            req.flash("error", "Failed to recalculate plan totals.");
      res.redirect("/admin/servicePricing");
    }
  },

  deleteEmployment: async (req, res) => {
    await ensureEmploymentSchema(db);

    const { id } = req.params;
    try {
      await db.query(`DELETE FROM employment WHERE id = $1`, [id]);
      req.flash("success", "Job deleted.");
    } catch (err) {
            req.flash("error", "Error deleting job.");
    }
    res.redirect("/admin/employment");
  },

  approveEmploymentApplication: async (req, res) => {
    await ensureEmploymentSchema(db);

    const applicationId = Number.parseInt(req.params.id, 10);

    if (!Number.isInteger(applicationId)) {
      req.flash("error", "Invalid application selected.");
      return res.redirect("/admin/employment");
    }

    try {
      const applicationResult = await db.query(
        `SELECT
          ea.id,
          ea.first_name,
          ea.last_name,
          ea.email,
          ea.status,
          e.title AS job_title
        FROM employment_applications ea
        JOIN employment e ON e.id = ea.employment_id
        WHERE ea.id = $1`,
        [applicationId]
      );

      if (!applicationResult.rows.length) {
        req.flash("error", "Application not found.");
        return res.redirect("/admin/employment");
      }

      const application = applicationResult.rows[0];

      if (application.status !== "pending") {
        req.flash("error", "Only pending applications can be approved. Reverse rejection first if needed.");
        return res.redirect("/admin/employment");
      }

      const updateResult = await db.query(
        `UPDATE employment_applications
         SET status = 'approved',
             rejection_reason = NULL,
             reviewed_at = CURRENT_TIMESTAMP
         WHERE id = $1
         RETURNING id`,
        [applicationId]
      );

      if (!updateResult.rows.length) {
        req.flash("error", "Application not found.");
        return res.redirect("/admin/employment");
      }

      const html = renderCleanEmail({
        title: "Employment Application Approved",
        greeting: `Dear <strong>${he.encode(application.first_name)} ${he.encode(application.last_name)}</strong>,`,
        paragraphs: [
          "Thank you for applying for the Content Manager - Tanzania position at Managira.",
          "We are pleased to inform you that your application has been approved for the next stage of the selection process.",
          "Our team will be in touch shortly with the next steps, which may include an interview and/or additional assessments.",
          "If you have any questions in the meantime, please feel free to reply to this email.",
        ],
        details: [
          { label: "Position", value: application.job_title },
          { label: "Application Status", value: "Approved for Next Stage" },
        ],
        noReply: false,
      });

      sendEmailInBackground(
        {
          to: application.email,
          subject: `Your ${application.job_title} application has been approved`,
          html,
          attachments: [
            {
              filename: "managira.png",
              path: path.join(__dirname, "../public/images/managira.png"),
              cid: "managira_logo",
            },
          ],
        },
        "Employment Approval Email"
      );

      req.flash("success", "Application approved and notification email queued.");
    } catch (error) {
      req.flash("error", "Failed to approve application.");
    }

    return res.redirect("/admin/employment");
  },

  rejectEmploymentApplication: async (req, res) => {
    await ensureEmploymentSchema(db);

    const applicationId = Number.parseInt(req.params.id, 10);
    const rejectionReason = (req.body.rejection_reason || "").trim();

    if (!Number.isInteger(applicationId)) {
      req.flash("error", "Invalid application selected.");
      return res.redirect("/admin/employment");
    }

    try {
      const applicationResult = await db.query(
        `SELECT
          ea.id,
          ea.first_name,
          ea.last_name,
          ea.email,
          ea.status,
          e.title AS job_title
        FROM employment_applications ea
        JOIN employment e ON e.id = ea.employment_id
        WHERE ea.id = $1`,
        [applicationId]
      );

      if (!applicationResult.rows.length) {
        req.flash("error", "Application not found.");
        return res.redirect("/admin/employment");
      }

      const application = applicationResult.rows[0];

      const details = [
        { label: "Position", value: application.job_title },
        { label: "Application Status", value: "Rejected" },
      ];
      if (rejectionReason) {
        details.push({ label: "Reason", value: rejectionReason });
      }

      const html = renderCleanEmail({
        title: "Employment Application Update",
        greeting: `Dear <strong>${he.encode(application.first_name)} ${he.encode(application.last_name)}</strong>,`,
        paragraphs: [
          "Thank you for your interest in the Content Manager - Tanzania position at Managira.",
          "After careful consideration, we regret to inform you that we will not be progressing with your application at this stage.",
          "We sincerely appreciate the time and effort you invested in your application. We encourage you to apply for future opportunities with Managira that align with your experience and skills.",
        ],
        details,
        noReply: true,
      });

      sendEmailInBackground(
        {
          to: application.email,
          subject: `Update on your ${application.job_title} application`,
          html,
          attachments: [
            {
              filename: "managira.png",
              path: path.join(__dirname, "../public/images/managira.png"),
              cid: "managira_logo",
            },
          ],
        },
        "Employment Rejection Email"
      );

      await db.query(
        `UPDATE employment_applications
         SET status = 'rejected',
             rejection_reason = $2,
             reviewed_at = CURRENT_TIMESTAMP
         WHERE id = $1`,
        [applicationId, rejectionReason || null]
      );

      req.flash("success", "Application rejected and notification email queued.");
    } catch (error) {
      req.flash("error", "Failed to reject application.");
    }

    return res.redirect("/admin/employment");
  },

  reverseEmploymentRejection: async (req, res) => {
    await ensureEmploymentSchema(db);

    const applicationId = Number.parseInt(req.params.id, 10);
    if (!Number.isInteger(applicationId)) {
      req.flash("error", "Invalid application selected.");
      return res.redirect("/admin/employment");
    }

    try {
      const applicationResult = await db.query(
        `SELECT
          ea.id,
          ea.first_name,
          ea.last_name,
          ea.email,
          ea.status,
          e.title AS job_title
        FROM employment_applications ea
        JOIN employment e ON e.id = ea.employment_id
        WHERE ea.id = $1`,
        [applicationId]
      );

      if (!applicationResult.rows.length) {
        req.flash("error", "Application not found.");
        return res.redirect("/admin/employment");
      }

      const application = applicationResult.rows[0];
      if (application.status !== "rejected") {
        req.flash("error", "Only rejected applications can be reversed.");
        return res.redirect("/admin/employment");
      }

      const html = renderCleanEmail({
        title: "Update on Your Employment Application",
        greeting: `Dear <strong>${he.encode(application.first_name)} ${he.encode(application.last_name)}</strong>,`,
        paragraphs: [
          "Please disregard the previous email regarding your application for the Content Manager - Tanzania position.",
          "Following an additional review, we are pleased to inform you that your application has been reopened and is currently under consideration.",
          "Our team will share a further update with you shortly regarding next steps.",
        ],
        details: [
          { label: "Position", value: application.job_title },
          { label: "Application Status", value: "Reopened for Review" },
        ],
        noReply: true,
      });

      sendEmailInBackground(
        {
          to: application.email,
          subject: `Update: ${application.job_title} application reconsideration`,
          html,
          attachments: [
            {
              filename: "managira.png",
              path: path.join(__dirname, "../public/images/managira.png"),
              cid: "managira_logo",
            },
          ],
        },
        "Employment Reversal Email"
      );

      await db.query(
        `UPDATE employment_applications
         SET status = 'pending',
             rejection_reason = NULL,
             reviewed_at = CURRENT_TIMESTAMP
         WHERE id = $1`,
        [applicationId]
      );

      req.flash("success", "Rejection reversed and applicant notified by email.");
    } catch (error) {
      req.flash("error", "Failed to reverse rejection.");
    }

    return res.redirect("/admin/employment");
  },

  deleteEmploymentApplication: async (req, res) => {
    await ensureEmploymentSchema(db);

    const applicationId = Number.parseInt(req.params.id, 10);

    if (!Number.isInteger(applicationId)) {
      req.flash("error", "Invalid application selected.");
      return res.redirect("/admin/employment");
    }

    try {
      const deleteResult = await db.query(
        `DELETE FROM employment_applications WHERE id = $1 RETURNING id`,
        [applicationId]
      );

      if (!deleteResult.rows.length) {
        req.flash("error", "Application not found.");
      } else {
        req.flash("success", "Application deleted.");
      }
    } catch (error) {
      req.flash("error", "Failed to delete application.");
    }

    return res.redirect("/admin/employment");
  },

  getDonationsAdmin: async (req, res) => {
    const donations = await db.query(
      `SELECT * FROM donations ORDER BY created_at DESC`
    );
    res.render("admin/manageDonations", {
      title: "Manage Donations",
      donations: donations.rows,
      messages: req.flash(),
      showFooterTopSection: true
    });
  },

  postDonation: async (req, res) => {
    const { title, description, external_link } = req.body;
    const file = req.file;

    if (!title || !description || !external_link || !file) {
      req.flash("error", "All fields including an image are required.");
      return res.redirect("/admin/donations");
    }

    try {
      const uploadResult = await uploadToS3(file);
      await db.query(
        `INSERT INTO donations (title, description, external_link, image_url, s3_key) VALUES ($1, $2, $3, $4, $5)`,
        [
          title,
          description,
          external_link,
          uploadResult.Location,
          uploadResult.Key,
        ]
      );
      req.flash("success", "Donation created.");
    } catch (err) {
            req.flash("error", "Failed to save donation.");
    }

    res.redirect("/admin/donations");
  },

  deleteDonation: async (req, res) => {
    const { id } = req.params;
    const { imageKey } = req.query;

    try {
      await deleteFromS3(imageKey);
      await db.query(`DELETE FROM donations WHERE id = $1`, [id]);
      req.flash("success", "Donation deleted.");
    } catch (err) {
            req.flash("error", "Error deleting donation.");
    }

    res.redirect("/admin/donations");
  },

  getAdminAnnouncements: async (req, res) => {
    try {
      const result = await db.query(
        `SELECT * FROM admin_announcements ORDER BY created_at DESC`
      );
      res.render("admin/adminAnnouncements", {
        title: "Manage Admin Announcements",
        announcements: result.rows,
        messages: req.flash(),
      });
    } catch (error) {
            req.flash("error", "Failed to load announcements.");
      res.redirect("/admin");
    }
  },

  createAdminAnnouncement: async (req, res) => {
    const { title, description } = req.body;
    if (!title || !description) {
      req.flash("error", "Both title and description are required.");
      return res.redirect("/admin/announcements");
    }

    try {
      await db.query(
        `INSERT INTO admin_announcements (title, description, is_active) VALUES ($1, $2, TRUE)`,
        [title, description]
      );
      req.flash("success", "Announcement created.");
    } catch (error) {
            req.flash("error", "Failed to create announcement.");
    }

    res.redirect("/admin/announcements");
  },

  toggleAdminAnnouncement: async (req, res) => {
    const { id } = req.params;
    try {
      await db.query(
        `UPDATE admin_announcements SET is_active = NOT is_active WHERE id = $1`,
        [id]
      );
      req.flash("success", "Announcement status toggled.");
    } catch (error) {
            req.flash("error", "Failed to update announcement.");
    }

    res.redirect("/admin/announcements");
  },

  deleteAdminAnnouncement: async (req, res) => {
    const { id } = req.params;
    try {
      await db.query(`DELETE FROM admin_announcements WHERE id = $1`, [id]);
      req.flash("success", "Announcement deleted.");
    } catch (error) {
            req.flash("error", "Failed to delete announcement.");
    }

    res.redirect("/admin/announcements");
  },

  generateOrganizationCSV: async (req, res) => {
    try {
      const { organizationId, format } = req.body;
      if (!organizationId) {
        req.flash("error", "Invalid organization selected.");
        return res.redirect("/admin/data-export");
      }

      // Fetch Organization Information
      const orgQuery = await db.query(
        `
                SELECT organization_id, organization_name, organization_address, organization_phone, 
                       email, logo_path, created_at 
                FROM organizations WHERE organization_id = $1
            `,
        [organizationId]
      );

      if (orgQuery.rows.length === 0) {
        req.flash("error", "No organization data found.");
        return res.redirect("/admin/data-export");
      }
      const organization = orgQuery.rows[0];

      // Fetch Users (Admins, Teachers, Employees)
      const usersQuery = await db.query(
        `
                SELECT user_id, first_name, last_name, email, account_type, created_at, updated_at, on_hold
                FROM users WHERE organization_id = $1
            `,
        [organizationId]
      );

      // Fetch School Years & Terms
      const termsQuery = await db.query(
        `
                SELECT sy.id AS school_year_id, sy.year_label, sy.created_at AS start_date, 
                       t.term_id AS current_term_id, t.term_name AS current_term_name, 
                       t.start_date AS term_start_date, t.end_date AS term_end_date
                FROM school_years sy
                LEFT JOIN terms t ON sy.id = t.school_year_id
                WHERE sy.organization_id = $1
            `,
        [organizationId]
      );

      // Fetch Classes & Subjects
      const classesQuery = await db.query(
        `
                SELECT c.class_id, c.class_name, g.name AS graduation_year_group, 
                       COALESCE(STRING_AGG(s.subject_name, ', '), 'No subjects assigned') AS subjects_assigned
                FROM classes c
                LEFT JOIN subjects s ON c.class_id = s.class_id
                LEFT JOIN graduation_year_groups g ON c.graduation_year_group_id = g.id
                WHERE c.organization_id = $1
                GROUP BY c.class_id, g.name
            `,
        [organizationId]
      );

      // Fetch Students Information (Include Guardian Info)
      const studentsQuery = await db.query(
        `
                SELECT s.student_id, s.first_name, s.last_name, s.date_of_birth, s.gender, s.hometown, 
                       c.class_name AS class, s.image_url, 
                       COALESCE(g.first_name || ' ' || g.last_name, 'No Guardian') AS guardian_name, 
                       COALESCE(g.phone, 'N/A') AS guardian_phone, 
                       COALESCE(g.email, 'N/A') AS guardian_email
                FROM students s
                LEFT JOIN classes c ON s.class_id = c.class_id
                LEFT JOIN guardians g ON s.student_id = g.student_id
                WHERE s.organization_id = $1
            `,
        [organizationId]
      );

      // Fetch Student Assessments & Scores
      const assessmentsQuery = await db.query(
        `
                SELECT ar.student_id, sub.subject_name, a.title AS assessment_title, 
                       a.weight AS assessment_weight, ar.score, ar.grade
                FROM assessment_results ar
                LEFT JOIN assessments a ON ar.assessment_id = a.assessment_id
                LEFT JOIN subjects sub ON a.subject_id = sub.subject_id
                WHERE ar.organization_id = $1
            `,
        [organizationId]
      );

      // Fetch Attendance Records
      const attendanceQuery = await db.query(
        `
                SELECT s.student_id, c.class_name AS class, 
                       COUNT(CASE WHEN a.status = 'Present' THEN 1 END) AS total_days_present,
                       COUNT(CASE WHEN a.status = 'Absent' THEN 1 END) AS total_days_absent, t.term_name AS term
                FROM attendance_records a
                LEFT JOIN students s ON a.student_id = s.student_id
                LEFT JOIN classes c ON a.class_id = c.class_id
                LEFT JOIN terms t ON a.term_id = t.term_id
                WHERE a.organization_id = $1 
                GROUP BY s.student_id, c.class_name, t.term_name
            `,
        [organizationId]
      );

      // Fetch Remarks (Teacher, Conduct, Attitude, Interest)
      const remarksQuery = await db.query(
        `
                SELECT s.student_id, 
                       COALESCE(sr.teacher_remarks, 'No remarks') AS teacher_remark, 
                       COALESCE(sr.conduct_remarks, 'No remarks') AS conduct_remark, 
                       COALESCE(sr.attitude_remarks, 'No remarks') AS attitude_remark, 
                       COALESCE(sr.interest_remarks, 'No remarks') AS interest_remark
                FROM student_reports sr
                LEFT JOIN students s ON sr.student_id = s.student_id
                WHERE sr.organization_id = $1
            `,
        [organizationId]
      );

      // Fetch Events & Announcements
      const eventsQuery = await db.query(
        `
                SELECT e.id AS event_id, e.name AS event_name, e.event_date, e.details AS event_description, 
                       COALESCE(a.message, 'No announcements') AS announcement_details
                FROM school_events e
                LEFT JOIN announcements a ON e.organization_id = a.organization_id
                WHERE e.organization_id = $1
            `,
        [organizationId]
      );

      const dataSections = {
        "Organization Details": [organization],
        Users: usersQuery.rows || [],
        "School Years & Terms": termsQuery.rows || [],
        Classes: classesQuery.rows || [],
        Students: studentsQuery.rows || [],
        Assessments: assessmentsQuery.rows || [],
        Attendance: attendanceQuery.rows || [],
        "Student Remarks": remarksQuery.rows || [],
        "Events & Announcements": eventsQuery.rows || [],
      };

      if (format === "csv") {
        const json2csvParser = new Parser({ header: true });

        let csvContent = `### ${organization.organization_name}\n`;
        csvContent += `Comprehensive Data Report From Managira\nGenerated on: ${new Date().toLocaleString()}\n\n`;

        for (const [sectionTitle, data] of Object.entries(dataSections)) {
          csvContent += `### ${sectionTitle}\n`;
          csvContent += data.length
            ? json2csvParser.parse(data) + "\n\n"
            : "No data available.\n\n";
        }

        res.setHeader(
          "Content-Disposition",
          `attachment; filename="${organization.organization_name}_Data.csv"`
        );
        res.setHeader("Content-Type", "text/csv");
        res.send(csvContent);
      } else {
        // PDF Export with Report Header
        const doc = new PDFDocument({ margin: 30 });
        res.setHeader(
          "Content-Disposition",
          `attachment; filename="${organization.organization_name}_Data.pdf"`
        );
        res.setHeader("Content-Type", "application/pdf");
        doc.pipe(res);

        // Report Title & Metadata (Header)
        doc
          .fontSize(20)
          .fillColor("black")
          .text(`${organization.organization_name}`, { align: "center" });
        doc
          .fontSize(14)
          .text("Comprehensive Data Report From Managira", { align: "center" });
        doc.fontSize(10).text(`Generated on: ${new Date().toLocaleString()}`, {
          align: "center",
        });
        doc.moveDown(2);

        const addSection = (title, data, color) => {
          doc
            .moveDown(1)
            .fontSize(16)
            .fillColor(color)
            .text(title, { underline: true });
          doc.moveDown(0.5).fontSize(10).fillColor("black");

          if (data.length === 0) {
            doc.text("No data available.");
          } else {
            data.forEach((row, index) => {
              doc.text(`${index + 1}. ${JSON.stringify(row, null, 2)}`);
              doc.moveDown(0.5);
            });
          }
        };

        Object.entries(dataSections).forEach(([title, data], index) => {
          const colors = [
            "blue",
            "green",
            "orange",
            "purple",
            "red",
            "brown",
            "darkblue",
            "teal",
            "pink",
          ];
          addSection(title, data, colors[index % colors.length]);
        });

        doc.end();
      }
    } catch (error) {
            req.flash("error", "Failed to generate export.");
      res.redirect("/admin/data-export");
    }
  },
};

async function sendEmailNotification(to, subject, text) {
  const rawText = String(text || "").trim();
  const chunks = rawText
    ? rawText
        .split(/\n\s*\n/)
        .map((part) => part.trim())
        .filter(Boolean)
    : [];

  let greeting = "Hello,";
  const paragraphs = [];

  chunks.forEach((part, index) => {
    if (index === 0 && /^dear\s+/i.test(part)) {
      greeting = he.encode(part.replace(/\s*,$/, "")) + ",";
      return;
    }

    if (/^best regards/i.test(part)) {
      return;
    }

    paragraphs.push(he.encode(part));
  });

  if (paragraphs.length === 0) {
    paragraphs.push("Please review this administrative update from Managira.");
  }

  const html = renderCleanEmail({
    title: he.encode(subject || "Account Update"),
    greeting,
    paragraphs,
    note: 'For help, visit our <a href="https://www.managira.com/legal/help" target="_blank" rel="noopener">Help Center</a> or <a href="https://www.managira.com/legal/faq" target="_blank" rel="noopener">FAQ page</a>.',
  });

  sendEmailInBackground(
    {
      to,
      subject,
      html,
      attachments: [
        {
          filename: 'managira.png',
          path: path.join(__dirname, '../public/images/managira.png'),
          cid: 'managira_logo',
        },
      ],
    },
    "Admin Email Notification"
  );
}

async function sendAdminInviteEmail(email, firstName, lastName, link) {
  const html = renderCleanEmail({
    title: "You're Invited to Join as Admin",
    greeting: `Hello <strong>${he.encode(firstName)} ${he.encode(lastName)}</strong>,`,
    paragraphs: [
      "Managira is inviting you to join as an admin. Use the button below to set your password.",
    ],
    cta: { text: "Accept Invite & Set Password", url: he.encode(link) },
    note: 'This link will expire in 24 hours. For help, visit our <a href="https://www.managira.com/legal/help" target="_blank" rel="noopener">Help Center</a> or <a href="https://www.managira.com/legal/faq" target="_blank" rel="noopener">FAQ page</a>.',
  });
  const mailOptions = {
    from: process.env.NOTIFY_EMAIL_USER,
    to: email,
    subject: "You are invited to Managira - Set Your Password",
    html,
    attachments: [
      {
        filename: 'managira.png',
        path: require('path').join(__dirname, '../public/images/managira.png'),
        cid: 'managira_logo'
      }
    ]
  };
  sendEmailInBackground(mailOptions, "Admin Invite Email");
}

async function sendPasswordSetSuccessEmail(email, firstName, lastName) {
  const html = renderCleanEmail({
    title: "Password Set Successfully",
    greeting: `Hello <strong>${he.encode(firstName)} ${he.encode(lastName)}</strong>,`,
    paragraphs: [
      "Your password has been set successfully. You can now log in to Managira using your email and new password.",
      "If you did not perform this action, please contact your administrator immediately.",
    ],
    cta: { text: "Log in to Managira", url: "https://www.managira.com/account/login" },
    note: 'If you have any questions, please visit our <a href="https://www.managira.com/legal/help" target="_blank" rel="noopener">Help Center</a> or <a href="https://www.managira.com/legal/faq" target="_blank" rel="noopener">FAQ page</a>.',
  });
  const mailOptions = {
    from: process.env.NOTIFY_EMAIL_USER,
    to: email,
    subject: "Your Password Has Been Set Successfully",
    html,
    attachments: [
      {
        filename: 'managira.png',
        path: require('path').join(__dirname, '../public/images/managira.png'),
        cid: 'managira_logo'
      }
    ]
  };
  sendEmailInBackground(mailOptions, "Admin Password Success Email");
}

// =====================================================
// HUB MANAGEMENT FUNCTIONS
// =====================================================

// List all hubs
adminController.hubsListGet = async (req, res) => {
  try {
    const hubsResult = await db.query(`
      SELECT h.*, p.plan_name, p.total_cost,
             (SELECT COUNT(*) FROM organizations WHERE hub_id = h.hub_id AND deleted = false AND is_hub_member = true) as org_count
      FROM managira_hubs h
      LEFT JOIN plans p ON h.plan_id = p.id
      WHERE h.deleted = false
      ORDER BY h.created_at DESC
    `);

    res.render('admin/hubs', {
      title: 'Manage Hubs',
      hubs: hubsResult.rows,
      messages: req.flash(),
      showFooterTopSection: true
    });
  } catch (error) {
        req.flash('error', 'Error loading hubs.');
    res.redirect('/admin');
  }
};

// Create hub form
adminController.hubCreateGet = async (req, res) => {
  try {
    const plansResult = await db.query('SELECT * FROM plans WHERE is_active = true ORDER BY id');
    
    res.render('admin/hubCreate', {
      title: 'Create New Hub',
      plans: plansResult.rows,
      messages: req.flash(),
      showFooterTopSection: true
    });
  } catch (error) {
        req.flash('error', 'Error loading form.');
    res.redirect('/admin/hubs');
  }
};

// Create hub
adminController.hubCreatePost = async (req, res) => {
  const {
    hubName,
    hubNickname,
    hubEmail,
    firstName,
    lastName,
    hubPhone,
    hubAddress,
    planId,
    maxOrganizations,
    hubFooterText,
    contractStartDate,
    contractEndDate,
  } = req.body;

  try {
    // Validate required fields
    if (!hubName || !hubNickname || !hubEmail || !firstName || !lastName) {
      req.flash('error', 'All required fields must be filled.');
      return res.redirect('/admin/hubs/create');
    }

    // Check if nickname is already taken
    const nicknameCheck = await db.query(
      'SELECT hub_id FROM managira_hubs WHERE hub_nickname = $1',
      [hubNickname]
    );

    if (nicknameCheck.rows.length > 0) {
      req.flash('error', 'Hub nickname is already taken.');
      return res.redirect('/admin/hubs/create');
    }

    // Check if email is already taken
    const emailCheck = await db.query(
      `SELECT hub_email FROM managira_hubs WHERE hub_email = $1
       UNION
       SELECT email FROM organizations WHERE email = $1
       UNION
       SELECT email FROM users WHERE email = $1`,
      [hubEmail]
    );

    if (emailCheck.rows.length > 0) {
      req.flash('error', 'Email is already in use.');
      return res.redirect('/admin/hubs/create');
    }

    // Generate password setup token
    const token = crypto.randomBytes(32).toString('hex');
    const hashedToken = crypto.createHash('sha256').update(token).digest('hex');
    const tokenExpiration = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000); // 7 days

    // Insert hub
    const result = await db.query(
      `INSERT INTO managira_hubs 
       (hub_name, hub_nickname, hub_email, first_name, last_name, hub_phone, hub_address, 
        plan_id, max_organizations, hub_footer_text, contract_start_date, contract_end_date,
        reset_password_token, reset_password_expires, created_by_admin_id)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)
       RETURNING hub_id`,
      [hubName, hubNickname, hubEmail, firstName, lastName, hubPhone, hubAddress, 
       planId || null, maxOrganizations || 5, hubFooterText || '',
       contractStartDate || null, contractEndDate || null,
       hashedToken, tokenExpiration, req.session.userId]
    );

    const hubId = result.rows[0].hub_id;

    // Send setup email
    const baseUrl = req.protocol + '://' + req.get('host');
    const setupUrl = `${baseUrl}/hub/setup-password?token=${token}`;

    const emailHtml = renderCleanEmail({
      title: 'Welcome to Managira Hub',
      greeting: `Dear ${firstName} ${lastName},`,
      intro: `Your Managira Hub ${hubName} has been created successfully.`,
      message: 'To get started, please set up your password using the button below.',
      actionUrl: setupUrl,
      actionText: 'Set Up Password',
      details: [
        `Hub Name: ${hubName}`,
        `Hub Nickname: ${hubNickname}`,
        `Hub Login: ${baseUrl}/hub/login`,
        `Email: ${hubEmail}`,
        `Max Organizations: ${maxOrganizations || 5}`,
        `Contract Start: ${contractStartDate || 'Not set'}`,
        `Contract End: ${contractEndDate || 'Not set'}`,
      ],
      note: 'This setup link expires in 7 days. Please complete setup before then.',
      closing: 'This is a no-reply message. Please do not reply to this email.',
    });

    sendEmailInBackground({
      to: hubEmail,
      subject: 'Welcome to Managira Hub - Set Up Your Password',
      html: emailHtml,
    }, 'Hub Setup Email');

    req.flash('success', 'Hub created successfully! Setup instructions sent to the hub email.');
    res.redirect('/admin/hubs');
  } catch (error) {
        req.flash('error', 'Error creating hub.');
    res.redirect('/admin/hubs/create');
  }
};

// Edit hub form
adminController.hubEditGet = async (req, res) => {
  const { hubId } = req.params;

  try {
    const hubResult = await db.query(
      'SELECT * FROM managira_hubs WHERE hub_id = $1',
      [hubId]
    );

    if (hubResult.rows.length === 0) {
      req.flash('error', 'Hub not found.');
      return res.redirect('/admin/hubs');
    }

    const plansResult = await db.query('SELECT * FROM plans WHERE is_active = true ORDER BY id');

    res.render('admin/hubEdit', {
      title: 'Edit Hub',
      hub: hubResult.rows[0],
      plans: plansResult.rows,
      messages: req.flash(),
      showFooterTopSection: true
    });
  } catch (error) {
        req.flash('error', 'Error loading form.');
    res.redirect('/admin/hubs');
  }
};

// Update hub
adminController.hubEditPost = async (req, res) => {
  const { hubId } = req.params;
  const {
    hubName,
    hubNickname,
    firstName,
    lastName,
    hubPhone,
    hubAddress,
    planId,
    maxOrganizations,
    hubFooterText,
    hubBrandingEnabled,
    contractStartDate,
    contractEndDate,
  } = req.body;

  try {
    const existingHubResult = await db.query(
      'SELECT plan_id FROM managira_hubs WHERE hub_id = $1',
      [hubId]
    );

    // Check if nickname is taken by another hub
    const nicknameCheck = await db.query(
      'SELECT hub_id FROM managira_hubs WHERE hub_nickname = $1 AND hub_id != $2',
      [hubNickname, hubId]
    );

    if (nicknameCheck.rows.length > 0) {
      req.flash('error', 'Hub nickname is already taken by another hub.');
      return res.redirect(`/admin/hubs/${hubId}/edit`);
    }

    await db.query(
      `UPDATE managira_hubs 
       SET hub_name = $1, hub_nickname = $2, first_name = $3, last_name = $4, 
           hub_phone = $5, hub_address = $6, plan_id = $7, max_organizations = $8, 
           hub_footer_text = $9, hub_branding_enabled = $10,
           contract_start_date = $11, contract_end_date = $12, updated_at = NOW()
      WHERE hub_id = $13`,
      [hubName, hubNickname, firstName, lastName, hubPhone, hubAddress, 
         planId || null, maxOrganizations || 5, hubFooterText || '',
         hubBrandingEnabled === 'on', contractStartDate || null, contractEndDate || null, hubId]
    );

    const previousPlanId = existingHubResult.rows[0]?.plan_id || null;
    const nextPlanId = planId || null;
    if (String(previousPlanId || '') !== String(nextPlanId || '')) {
      const memberOrganizations = await db.query(
        `SELECT organization_id
         FROM organizations
         WHERE hub_id = $1 AND deleted = false AND COALESCE(is_hub_member, false) = true`,
        [hubId]
      );

      for (const row of memberOrganizations.rows) {
        invalidateOrganizationAccessCache(row.organization_id);
      }
    }

    req.flash('success', 'Hub updated successfully.');
    res.redirect('/admin/hubs');
  } catch (error) {
        req.flash('error', 'Error updating hub.');
    res.redirect(`/admin/hubs/${hubId}/edit`);
  }
};

// Put hub on hold
adminController.hubHoldPost = async (req, res) => {
  const { hubId } = req.body;

  try {
    await db.query(
      'UPDATE managira_hubs SET on_hold = true, updated_at = NOW() WHERE hub_id = $1',
      [hubId]
    );

    req.flash('success', 'Hub put on hold successfully.');
    res.redirect('/admin/hubs');
  } catch (error) {
        req.flash('error', 'Error putting hub on hold.');
    res.redirect('/admin/hubs');
  }
};

// Resume hub
adminController.hubResumePost = async (req, res) => {
  const { hubId } = req.body;

  try {
    await db.query(
      'UPDATE managira_hubs SET on_hold = false, updated_at = NOW() WHERE hub_id = $1',
      [hubId]
    );

    req.flash('success', 'Hub resumed successfully.');
    res.redirect('/admin/hubs');
  } catch (error) {
        req.flash('error', 'Error resuming hub.');
    res.redirect('/admin/hubs');
  }
};

// Delete hub
adminController.hubDeletePost = async (req, res) => {
  const { hubId } = req.body;

  try {
    await db.query('BEGIN');

    const result = await db.query(
      `UPDATE managira_hubs
       SET deleted = true, on_hold = true, updated_at = NOW()
       WHERE hub_id = $1
       RETURNING hub_name, hub_email, first_name, last_name`,
      [hubId]
    );

    const hub = result.rows[0];

    const memberOrganizations = await db.query(
      `UPDATE organizations
       SET on_hold = true,
           hold_by = 'Hub',
           updated_at = NOW()
       WHERE hub_id = $1
         AND deleted = false
       RETURNING organization_name, email, first_name, last_name`,
      [hubId]
    );

    await db.query('COMMIT');

    if (hub && hub.hub_email) {
      await sendEmailNotification(
        hub.hub_email,
        'Your hub has been placed on hold and moved to deleted review',
        `Dear ${hub.first_name || ''} ${hub.last_name || ''},\n\nYour hub "${hub.hub_name}" has been placed on hold and moved to deleted review by an administrator. Your data is retained and can be restored by the Super Admin.\n\nIf you believe this is a mistake, please contact info@managira.com.\n\nBest regards,\nAdmin Team`
      );
    }

    for (const org of memberOrganizations.rows) {
      if (!org.email) continue;
      await sendEmailNotification(
        org.email,
        'Your organization has been put on hold',
        `Dear ${org.first_name || ''} ${org.last_name || ''},\n\nYour organization "${org.organization_name}" has been placed on hold because your hub was temporarily deleted by an administrator.\n\nYour data remains safe and can be restored when the hub is restored.\n\nBest regards,\nAdmin Team`
      );
    }

    req.flash('success', `Hub moved to deleted review and placed on hold successfully. ${memberOrganizations.rows.length} linked organization(s) were also placed on hold.`);
    res.redirect('/admin/hubs');
  } catch (error) {
    try { await db.query('ROLLBACK'); } catch (rollbackError) {}
        req.flash('error', 'Error deleting hub.');
    res.redirect('/admin/hubs');
  }
};

// Restore hub from deleted review
adminController.restoreHub = async (req, res) => {
  const { hubId } = req.body;

  try {
    const result = await db.query(
      `UPDATE managira_hubs
       SET deleted = false, on_hold = false, updated_at = NOW()
       WHERE hub_id = $1
       RETURNING hub_name, hub_email, first_name, last_name`,
      [hubId]
    );

    const hub = result.rows[0];

    if (hub && hub.hub_email) {
      await sendEmailNotification(
        hub.hub_email,
        'Your hub has been restored',
        `Dear ${hub.first_name || ''} ${hub.last_name || ''},\n\nYour hub "${hub.hub_name}" has been restored and reactivated. You can now continue using Managira Hub services.\n\nBest regards,\nAdmin Team`
      );
    }

    req.flash('success', 'Hub restored successfully.');
    res.redirect('/admin/superDashboard');
  } catch (error) {
        req.flash('error', 'Failed to restore hub.');
    res.redirect('/admin/superDashboard');
  }
};

// Permanently delete hub
adminController.permanentlyDeleteHub = async (req, res) => {
  const { hubId } = req.body;

  try {
    await db.query('BEGIN');

    // Detach all member organizations from this hub before hard delete
    await db.query(
      `UPDATE organizations
       SET hub_id = NULL,
           is_hub_member = false,
           joined_hub_at = NULL,
           updated_at = NOW()
       WHERE hub_id = $1`,
      [hubId]
    );

    await db.query('DELETE FROM managira_hubs WHERE hub_id = $1', [hubId]);

    await db.query('COMMIT');
    req.flash('success', 'Hub permanently deleted successfully.');
    res.redirect('/admin/superDashboard');
  } catch (error) {
    try { await db.query('ROLLBACK'); } catch (rollbackError) {}
        req.flash('error', 'Failed to permanently delete hub.');
    res.redirect('/admin/superDashboard');
  }
};

// View hub organizations
adminController.hubOrganizationsGet = async (req, res) => {
  const { hubId } = req.params;

  try {
    const hubResult = await db.query('SELECT * FROM managira_hubs WHERE hub_id = $1', [hubId]);
    
    if (hubResult.rows.length === 0) {
      req.flash('error', 'Hub not found.');
      return res.redirect('/admin/hubs');
    }

    const orgsResult = await db.query(
      `SELECT o.*,
              (SELECT COUNT(*) FROM students WHERE organization_id = o.organization_id) as student_count,
              (SELECT COUNT(*) FROM users WHERE organization_id = o.organization_id) as teacher_count,
              (SELECT COUNT(*) FROM classes WHERE organization_id = o.organization_id) as class_count
       FROM organizations o
       WHERE o.hub_id = $1 AND o.deleted = false AND o.is_hub_member = true
       ORDER BY o.organization_name ASC`,
      [hubId]
    );

    res.render('admin/hubOrganizations', {
      title: 'Hub Organizations',
      hub: hubResult.rows[0],
      organizations: orgsResult.rows,
      messages: req.flash(),
      showFooterTopSection: true
    });
  } catch (error) {
        req.flash('error', 'Error loading organizations.');
    res.redirect('/admin/hubs');
  }
};

module.exports = {
  ...adminController,
  sendAdminInviteEmail,
  sendPasswordSetSuccessEmail,
};
