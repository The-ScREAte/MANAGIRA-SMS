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
                   first_name, last_name, email, organization_address, 
                   organization_phone, proof_of_existence_1, proof_of_existence_2, subdomain
            FROM organizations 
            WHERE deleted = false
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
      console.error("Error fetching dashboard data:", error);
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
      console.error("Error in ensureAdmin middleware:", error);
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
      console.error("❌ Error loading promo codes:", error);
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
      console.error("Error creating promo code:", error);
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
      console.error("Error deleting promo code:", error);
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
        `Dear ${organization.first_name} ${organization.last_name},\n\nYour organization's activities have been temporarily put on hold. Please contact us for further information.\n\nBest regards,\nAdmin Team`
      );

      res.redirect("/admin");
    } catch (error) {
      console.error("Error putting organization on hold:", error);
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
      console.error("Error resuming organization:", error);
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
        `Dear ${organization.first_name} ${organization.last_name},\n\nYour organization has been deleted from our records. If you believe this is a mistake, please contact us.\n\nBest regards,\nAdmin Team`
      );

      res.redirect("/admin");
    } catch (error) {
      console.error("Error deleting organization:", error);
      req.flash("error", "Failed to delete organization.");
      res.redirect("/admin");
    }
  },

  superAdminDashboard: async (req, res) => {
    try {
      // Fetch deleted organizations
      const deletedAccounts = await db.query(`
                SELECT organization_id, first_name, last_name, email, organization_name, organization_address, organization_phone, proof_of_existence_1, proof_of_existence_2
                FROM organizations
                WHERE deleted = true
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
        deletedTickets: deletedThreads.rows, // Pass deleted threads
        messages: req.flash(), // Pass flash messages
        showFooterTopSection: true
      });
    } catch (error) {
      console.error("Error fetching data for Super Admin Dashboard:", error);
      req.flash("error", "Failed to fetch data for the Super Admin Dashboard.");
      res.render("admin/superDashboard", {
        title: "Super Admin Dashboard",
        deletedAccounts: [], // Default to an empty array if the query fails
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
      console.error("Error deleting admin user:", error);
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
      console.error("Error fetching admin users:", error);
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
      console.error("Error toggling admin hold status:", error);
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
      console.error("Error fetching admin user details:", error);
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
      console.error("Error updating admin user details:", error);
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
      console.error("Error creating admin user:", error);
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
      console.error("Error restoring organization:", error);
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
      console.error("Error fetching help messages:", error);
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

      // Send email notification to the customer
      const transporter = nodemailer.createTransport({
        host: process.env.SMTP_HOST, // e.g., smtp.gmail.com, smtp.zoho.com
        port: parseInt(process.env.SMTP_PORT), // usually 465 or 587
        secure: process.env.SMTP_SECURE === "true", // true for 465, false for 587
        auth: {
          user: process.env.ADMIN_NOTIFY_EMAIL_USER,
          pass: process.env.ADMIN_NOTIFY_EMAIL_PASSWORD,
        },
      });

      const mailOptions = {
        from: process.env.NOTIFY_EMAIL_USER,
        to: thread.email,
        subject: `Response to Support Ticket #${threadIdInt}`,
        html: `
  <div style="background:#f4fbfa;padding:40px 0;">
              <div style="max-width:600px;margin:40px auto;background:#fff;border-radius:16px;box-shadow:0 4px 24px #b2e2d6;overflow:hidden;font-family:'Segoe UI',Arial,sans-serif;">
              <div style="background:#6fd3c4;padding:24px 0 24px 32px;display:flex;align-items:center;">
                <img src="cid:managira_logo" alt="Managira Logo" style="height:60px;display:block;">
              </div>
              <div style="padding:36px 32px 32px 32px;">
                <div style="color:#6fd3c4;font-size:24px;font-weight:600;margin-bottom:16px;letter-spacing:1px;">Support Ticket Response</div>
                <p style="font-size:16px;line-height:1.6;margin-bottom:18px;">Dear <b>${thread.name}</b>,</p>
                <p style="font-size:16px;line-height:1.6;margin-bottom:18px;">Our team has responded to your support ticket (#${threadIdInt}):</p>
                <blockquote style="background:#e6f7ec;padding:16px 20px;border-radius:8px;margin:18px 0 18px 0;font-size:15px;color:#222;">${response}</blockquote>
                <p style="font-size:16px;line-height:1.6;margin-bottom:18px;">Best regards,<br>Support Team</p>
                <p style="margin-top:18px;font-size:15px;">If you have any questions, please visit our <a href="https://www.managira.com/legal/help" target="_blank" rel="noopener" style="color:#1ca34a;font-weight:500;">Help Center</a> or <a href="https://www.managira.com/legal/faq" target="_blank" rel="noopener" style="color:#1ca34a;font-weight:500;">FAQ page</a>.</p>
                <p style="color:#b80000;font-size:16px;font-weight:bold;margin-top:32px;text-align:center;letter-spacing:1px;">THIS IS A NO-REPLY MESSAGE. PLEASE DO NOT REPLY TO THIS EMAIL.</p>
              </div>
              <div style="background:#e6f7ec;color:#888;text-align:center;padding:18px 0;font-size:13px;">&copy; ${new Date().getFullYear()} Managira. All rights reserved.</div>
            </div>
          </div>
        `,
        attachments: [
          {
            filename: 'managira.png',
            path: require('path').join(__dirname, '../public/images/managira.png'),
            cid: 'managira_logo'
          }
        ]
      };

      transporter.sendMail(mailOptions, (error) => {
        if (error) {
          req.flash("error", "Failed to send response email.");
        } else {
          req.flash("success", "Response sent and saved successfully.");
        }
        res.redirect("/admin/helpMessages");
      });
    } catch (error) {
      console.error("Error responding to the message:", error);
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

      // Send email notification
      const transporter = nodemailer.createTransport({
        host: process.env.SMTP_HOST, // e.g., smtp.gmail.com, smtp.zoho.com
        port: parseInt(process.env.SMTP_PORT), // usually 465 or 587
        secure: process.env.SMTP_SECURE === "true", // true for 465, false for 587
        auth: {
          user: process.env.ADMIN_NOTIFY_EMAIL_USER,
          pass: process.env.ADMIN_NOTIFY_EMAIL_PASSWORD,
        },
      });

      const mailOptions = {
        from: process.env.NOTIFY_EMAIL_USER,
        to: thread.email,
        subject: `Your Support Ticket #${threadIdInt} Has Been Resolved`,
        html: `
  <div style="background:#f4fbfa;padding:40px 0;">
              <div style="max-width:600px;margin:40px auto;background:#fff;border-radius:16px;box-shadow:0 4px 24px #b2e2d6;overflow:hidden;font-family:'Segoe UI',Arial,sans-serif;">
              <div style="background:#6fd3c4;padding:24px 0 24px 32px;display:flex;align-items:center;">
                <img src="cid:managira_logo" alt="Managira Logo" style="height:60px;display:block;">
              </div>
              <div style="padding:36px 32px 32px 32px;">
                <div style="color:#6fd3c4;font-size:24px;font-weight:600;margin-bottom:16px;letter-spacing:1px;">Support Ticket Resolved</div>
                <p style="font-size:16px;line-height:1.6;margin-bottom:18px;">Dear <b>${thread.name}</b>,</p>
                <p style="font-size:16px;line-height:1.6;margin-bottom:18px;">We are pleased to inform you that your support ticket (Ticket Number: #${threadIdInt}) has been resolved.</p>
                <p style="font-size:16px;line-height:1.6;margin-bottom:18px;">If you have any further questions or concerns, please feel free to reach out to us.</p>
                <p style="font-size:16px;line-height:1.6;margin-bottom:18px;">Best regards,<br>Support Team</p>
                <p style="margin-top:18px;font-size:15px;">If you have any questions, please visit our <a href="https://www.managira.com/legal/help" target="_blank" rel="noopener" style="color:#1ca34a;font-weight:500;">Help Center</a> or <a href="https://www.managira.com/legal/faq" target="_blank" rel="noopener" style="color:#1ca34a;font-weight:500;">FAQ page</a>.</p>
                <p style="color:#b80000;font-size:16px;font-weight:bold;margin-top:32px;text-align:center;letter-spacing:1px;">THIS IS A NO-REPLY MESSAGE. PLEASE DO NOT REPLY TO THIS EMAIL.</p>
              </div>
              <div style="background:#e6f7ec;color:#888;text-align:center;padding:18px 0;font-size:13px;">&copy; ${new Date().getFullYear()} Managira. All rights reserved.</div>
            </div>
          </div>
        `,
        attachments: [
          {
            filename: 'managira.png',
            path: require('path').join(__dirname, '../public/images/managira.png'),
            cid: 'managira_logo'
          }
        ]
      };

      transporter.sendMail(mailOptions, (error, info) => {
        if (error) {
          console.error("Error sending email:", error);
          req.flash("error", "Failed to send resolved notification email.");
        } else {
          req.flash(
            "success",
            "Ticket marked as closed and an email notification was sent."
          );
        }
        res.redirect("/admin/helpMessages");
      });
    } catch (error) {
      console.error("Error marking thread as resolved:", error);
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
      console.error("Error fetching help history:", error);
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

      // Send email notification
      const transporter = nodemailer.createTransport({
        host: process.env.SMTP_HOST, // e.g., smtp.gmail.com, smtp.zoho.com
        port: parseInt(process.env.SMTP_PORT), // usually 465 or 587
        secure: process.env.SMTP_SECURE === "true", // true for 465, false for 587
        auth: {
          user: process.env.ADMIN_NOTIFY_EMAIL_USER,
          pass: process.env.ADMIN_NOTIFY_EMAIL_PASSWORD,
        },
      });

      const mailOptions = {
        from: process.env.NOTIFY_EMAIL_USER,
        to: thread.email,
        subject: `Your Support Ticket #${threadIdInt} Has Been Reopened`,
        html: `
  <div style="background:#f4fbfa;padding:40px 0;">
              <div style="max-width:600px;margin:40px auto;background:#fff;border-radius:16px;box-shadow:0 4px 24px #b2e2d6;overflow:hidden;font-family:'Segoe UI',Arial,sans-serif;">
              <div style="background:#6fd3c4;padding:24px 0 24px 32px;display:flex;align-items:center;">
                <img src="cid:managira_logo" alt="Managira Logo" style="height:60px;display:block;">
              </div>
              <div style="padding:36px 32px 32px 32px;">
                <div style="color:#6fd3c4;font-size:24px;font-weight:600;margin-bottom:16px;letter-spacing:1px;">Support Ticket Reopened</div>
                <p style="font-size:16px;line-height:1.6;margin-bottom:18px;">Dear <b>${thread.name}</b>,</p>
                <p style="font-size:16px;line-height:1.6;margin-bottom:18px;">Your support ticket (Ticket Number: #${threadIdInt}) has been reopened. Our team is actively working on your concerns, and we will update you shortly.</p>
                <p style="font-size:16px;line-height:1.6;margin-bottom:18px;">If you have additional information to share, please reply to this email.</p>
                <p style="font-size:16px;line-height:1.6;margin-bottom:18px;">Best regards,<br>Support Team</p>
                <p style="margin-top:18px;font-size:15px;">If you have any questions, please visit our <a href="https://www.managira.com/legal/help" target="_blank" rel="noopener" style="color:#1ca34a;font-weight:500;">Help Center</a> or <a href="https://www.managira.com/legal/faq" target="_blank" rel="noopener" style="color:#1ca34a;font-weight:500;">FAQ page</a>.</p>
                <p style="color:#b80000;font-size:16px;font-weight:bold;margin-top:32px;text-align:center;letter-spacing:1px;">THIS IS A NO-REPLY MESSAGE. PLEASE DO NOT REPLY TO THIS EMAIL.</p>
              </div>
              <div style="background:#e6f7ec;color:#888;text-align:center;padding:18px 0;font-size:13px;">&copy; ${new Date().getFullYear()} Managira. All rights reserved.</div>
            </div>
          </div>
        `,
        attachments: [
          {
            filename: 'managira.png',
            path: require('path').join(__dirname, '../public/images/managira.png'),
            cid: 'managira_logo'
          }
        ]
      };

      transporter.sendMail(mailOptions, (error, info) => {
        if (error) {
          console.error("Error sending email:", error);
          req.flash("error", "Failed to send reopened notification email.");
        } else {
          req.flash(
            "success",
            "Ticket reopened and an email notification was sent."
          );
        }
        res.redirect("/admin/helpHistory");
      });
    } catch (error) {
      console.error("Error reopening thread:", error);
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
      console.error("Error deleting thread:", error);
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
      console.error("Error restoring thread:", error);
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
      console.error("Error permanently deleting thread:", error);
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
      console.error("Error temporarily deleting thread:", error);
      req.flash("error", "Failed to delete thread.");
      res.redirect("/admin/helpMessages");
    }
  },

  servicePricingGet: async (req, res) => {
    try {
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
        console.error('Error fetching free trial/billing settings:', err);
      }

      res.render("admin/servicePricing", {
        title: "Service Pricing Management",
        features: featuresResult.rows || [],
        plans: plansResult.rows || [],
        messages: req.flash(),
        freeTrialEnabled,
        freeTrialDays,
        billingInterval,
        showFooterTopSection: true
      });
    } catch (error) {
      console.error("Error fetching service pricing:", error);
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
      console.error('Error updating free trial settings:', error);
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
      console.error('Error updating billing interval:', error);
      req.flash('error', 'Failed to update billing interval.');
    }
    res.redirect('/admin/servicePricing');
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
      console.error("Error fetching scheduled holds:", error);
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
      console.error("Error adding feature:", error);
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
      console.error("Error updating feature:", error);
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
      console.error("Error toggling plan status:", error);
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

      req.flash("success", "Feature added and total cost updated.");
      res.redirect("/admin/servicePricing");
    } catch (error) {
      console.error("Error adding feature:", error);
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

      req.flash("success", "Feature removed and total cost updated.");
      res.redirect("/admin/servicePricing");
    } catch (error) {
      console.error("Error removing feature:", error);
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
      console.error("Error updating description:", error);
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
      console.error("Error deleting feature:", error);
      res.json({ success: false, error: "Failed to delete feature." });
    }
  },

  permanentlyDeleteOrganization: async (req, res) => {
    const { orgId } = req.body;
    try {
      await db.query("DELETE FROM organizations WHERE organization_id = $1", [
        orgId,
      ]);
      req.flash("success", "Organization permanently deleted successfully.");
      res.redirect("/admin/superDashboard");
    } catch (error) {
      console.error("Error permanently deleting organization:", error);
      req.flash("error", "Failed to permanently delete organization.");
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
      console.error("Error loading Data Export page:", error);
      req.flash("error", "Failed to load Data Export page.");
      res.redirect("/admin");
    }
  },

  getEmploymentAdmin: async (req, res) => {
    const jobs = await db.query(
      `SELECT * FROM employment ORDER BY created_at DESC`
    );
    res.render("admin/manageEmployment", {
      title: "Manage Employment",
      jobs: jobs.rows,
      messages: req.flash(),
      showFooterTopSection: true
    });
  },

  postEmployment: async (req, res) => {
    const { title, description, external_link } = req.body;
    if (!title || !description || !external_link) {
      req.flash("error", "All fields are required.");
      return res.redirect("/admin/employment");
    }

    try {
      await db.query(
        `INSERT INTO employment (title, description, external_link) VALUES ($1, $2, $3)`,
        [title, description, external_link]
      );
      req.flash("success", "Job added successfully.");
    } catch (err) {
      console.error(err);
      req.flash("error", "Error saving job.");
    }

    res.redirect("/admin/employment");
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
      console.error("Error recalculating plan totals:", error);
      req.flash("error", "Failed to recalculate plan totals.");
      res.redirect("/admin/servicePricing");
    }
  },

  deleteEmployment: async (req, res) => {
    const { id } = req.params;
    try {
      await db.query(`DELETE FROM employment WHERE id = $1`, [id]);
      req.flash("success", "Job deleted.");
    } catch (err) {
      console.error(err);
      req.flash("error", "Error deleting job.");
    }
    res.redirect("/admin/employment");
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
      console.error(err);
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
      console.error(err);
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
      console.error("Error loading admin announcements:", error);
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
      console.error("Error creating announcement:", error);
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
      console.error("Error toggling announcement status:", error);
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
      console.error("Error deleting announcement:", error);
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
      console.error("Error generating organization CSV/PDF:", error);
      req.flash("error", "Failed to generate export.");
      res.redirect("/admin/data-export");
    }
  },
};

async function sendEmailNotification(to, subject, text) {
  const transporter = nodemailer.createTransport({
    host: process.env.SMTP_HOST, // e.g., smtp.gmail.com, smtp.zoho.com
    port: parseInt(process.env.SMTP_PORT), // usually 465 or 587
    secure: process.env.SMTP_SECURE === "true", // true for 465, false for 587
    auth: {
      user: process.env.ADMIN_NOTIFY_EMAIL_USER,
      pass: process.env.ADMIN_NOTIFY_EMAIL_PASSWORD,
    },
  });

  const mailOptions = {
    from: process.env.ADMIN_NOTIFY_EMAIL_USER,
    to,
    subject,
    text,
  };

  await transporter.sendMail(mailOptions);
}

async function sendAdminInviteEmail(email, firstName, lastName, link) {
  const transporter = nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: parseInt(process.env.SMTP_PORT),
    secure: process.env.SMTP_SECURE === "true",
    auth: {
      user: process.env.ADMIN_NOTIFY_EMAIL_USER,
      pass: process.env.ADMIN_NOTIFY_EMAIL_PASSWORD,
    },
  });
  const html = `
  <div style="background:#f4fbfa;padding:40px 0;">
        <div style="max-width:600px;margin:40px auto;background:#fff;border-radius:16px;box-shadow:0 4px 24px #b2e2d6;overflow:hidden;font-family:'Segoe UI',Arial,sans-serif;">
        <div style="background:#6fd3c4;padding:24px 0 24px 32px;display:flex;align-items:center;">
          <img src="cid:managira_logo" alt="Managira Logo" style="height:60px;display:block;">
        </div>
        <div style="padding:36px 32px 32px 32px;">
          <div style="color:#6fd3c4;font-size:24px;font-weight:600;margin-bottom:16px;letter-spacing:1px;">You're Invited to Join as Admin</div>
          <p style="font-size:16px;line-height:1.6;margin-bottom:18px;">Hello <b>${he.encode(firstName)} ${he.encode(lastName)}</b>,</p>
          <p style="font-size:16px;line-height:1.6;margin-bottom:18px;">Managira is inviting you to join as an admin. Please click the button below to set your password:</p>
          <div style="margin:24px 0;">
            <a href="${he.encode(link)}" style="background:#6fd3c4;color:#fff;padding:12px 32px;border-radius:6px;text-decoration:none;font-size:16px;font-weight:600;box-shadow:0 2px 8px #b2e2d6;">Accept Invite & Set Password</a>
          </div>
          <p style="font-size:15px;margin-top:18px;">This link will expire in 24 hours.</p>
          <p style="margin-top:18px;font-size:15px;">If you have any questions, please visit our <a href="https://www.managira.com/legal/help" target="_blank" rel="noopener" style="color:#1ca34a;font-weight:500;">Help Center</a> or <a href="https://www.managira.com/legal/faq" target="_blank" rel="noopener" style="color:#1ca34a;font-weight:500;">FAQ page</a>.</p>
          <p style="color:#b80000;font-size:16px;font-weight:bold;margin-top:32px;text-align:center;letter-spacing:1px;">THIS IS A NO-REPLY MESSAGE. PLEASE DO NOT REPLY TO THIS EMAIL.</p>
        </div>
        <div style="background:#e6f7ec;color:#888;text-align:center;padding:18px 0;font-size:13px;">&copy; ${new Date().getFullYear()} Managira. All rights reserved.</div>
      </div>
    </div>
  `;
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
  await transporter.sendMail(mailOptions);
}

async function sendPasswordSetSuccessEmail(email, firstName, lastName) {
  const transporter = nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: parseInt(process.env.SMTP_PORT),
    secure: process.env.SMTP_SECURE === "true",
    auth: {
      user: process.env.ADMIN_NOTIFY_EMAIL_USER,
      pass: process.env.ADMIN_NOTIFY_EMAIL_PASSWORD,
    },
  });
  const html = `
  <div style="background:#f4fbfa;padding:40px 0;">
        <div style="max-width:600px;margin:40px auto;background:#fff;border-radius:16px;box-shadow:0 4px 24px #b2e2d6;overflow:hidden;font-family:'Segoe UI',Arial,sans-serif;">
        <div style="background:#6fd3c4;padding:24px 0 24px 32px;display:flex;align-items:center;">
          <img src="cid:managira_logo" alt="Managira Logo" style="height:60px;display:block;">
        </div>
        <div style="padding:36px 32px 32px 32px;">
          <div style="color:#6fd3c4;font-size:24px;font-weight:600;margin-bottom:16px;letter-spacing:1px;">Password Set Successfully</div>
          <p style="font-size:16px;line-height:1.6;margin-bottom:18px;">Hello <b>${he.encode(firstName)} ${he.encode(lastName)}</b>,</p>
          <p style="font-size:16px;line-height:1.6;margin-bottom:18px;">Your password has been set successfully! You can now log in to Managira using your email and the newly created password:</p>
          <div style="margin:24px 0;">
            <a href="https://www.managira.com/account/login" style="background:#6fd3c4;color:#fff;padding:12px 32px;border-radius:6px;text-decoration:none;font-size:16px;font-weight:600;box-shadow:0 2px 8px #b2e2d6;">Log in to Managira</a>
          </div>
          <p style="font-size:16px;line-height:1.6;margin-bottom:18px;">If you didn't perform this action, please contact your administrator immediately.</p>
          <p style="margin-top:18px;font-size:15px;">If you have any questions, please visit our <a href="https://www.managira.com/legal/help" target="_blank" rel="noopener" style="color:#1ca34a;font-weight:500;">Help Center</a> or <a href="https://www.managira.com/legal/faq" target="_blank" rel="noopener" style="color:#1ca34a;font-weight:500;">FAQ page</a>.</p>
          <p style="color:#b80000;font-size:16px;font-weight:bold;margin-top:32px;text-align:center;letter-spacing:1px;">THIS IS A NO-REPLY MESSAGE. PLEASE DO NOT REPLY TO THIS EMAIL.</p>
        </div>
        <div style="background:#e6f7ec;color:#888;text-align:center;padding:18px 0;font-size:13px;">&copy; ${new Date().getFullYear()} Managira. All rights reserved.</div>
      </div>
    </div>
  `;
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
  await transporter.sendMail(mailOptions);
}

module.exports = {
  ...adminController,
  sendAdminInviteEmail,
  sendPasswordSetSuccessEmail,
};
