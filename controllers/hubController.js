const db = require("../config/db");
const bcrypt = require("bcryptjs");
const crypto = require("crypto");
const nodemailer = require("nodemailer");
const path = require("path");
const { uploadToS3, deleteFromS3 } = require("../config/s3");

// Helper function to send emails
async function sendEmail({ to, subject, html }) {
  try {
    const transporter = nodemailer.createTransport({
      host: process.env.SMTP_HOST,
      port: parseInt(process.env.SMTP_PORT),
      secure: process.env.SMTP_SECURE === "true",
      auth: {
        user: process.env.ADMIN_NOTIFY_EMAIL_USER,
        pass: process.env.ADMIN_NOTIFY_EMAIL_PASSWORD,
      },
    });

    const mailOptions = {
      from: process.env.NOTIFY_EMAIL_USER,
      to,
      subject,
      html,
      attachments: [
        {
          filename: "managira.png",
          path: path.join(__dirname, "../public/images/managira.png"),
          cid: "managira_logo",
        },
      ],
    };

    await transporter.sendMail(mailOptions);
    return true;
  } catch (error) {
        return false;
  }
}

// Log hub activity
async function logHubActivity(hubId, actionType, description, targetOrgId = null, performedBy = '', ipAddress = null) {
  try {
    await db.query(
      `INSERT INTO hub_activity_logs (hub_id, action_type, target_organization_id, description, performed_by, ip_address)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [hubId, actionType, targetOrgId, description, performedBy, ipAddress]
    );
  } catch (error) {
      }
}

const hubController = {
  // Hub Login Page
  hubLoginGet: (req, res) => {
    if (req.session.hubId) {
      return res.redirect('/hub/dashboard');
    }
    res.render('hub/login', {
      title: 'Hub Login - Managira',
      messages: req.flash(),
      showFooterTopSection: true
    });
  },

  // Hub Login Authentication
  hubLoginPost: async (req, res) => {
    const { email, password } = req.body;

    try {
      const result = await db.query(
        'SELECT * FROM managira_hubs WHERE hub_email = $1 AND deleted = false',
        [email]
      );

      const hub = result.rows[0];

      if (!hub) {
        req.flash('error', 'Invalid email or password.');
        return res.redirect('/hub/login');
      }

      if (hub.on_hold) {
        req.flash('error', 'Your hub account is currently on hold. Please contact support.');
        return res.redirect('/hub/login');
      }

      if (!hub.hub_password) {
        req.flash('error', 'Please complete your password setup first. Check your email for the setup link.');
        return res.redirect('/hub/login');
      }

      const isMatch = await bcrypt.compare(password, hub.hub_password);

      if (!isMatch) {
        req.flash('error', 'Invalid email or password.');
        return res.redirect('/hub/login');
      }

      // Set hub session
      req.session.hubId = hub.hub_id;
      req.session.accountType = 'Hub';
      req.session.hubName = hub.hub_name;
      req.session.hubEmail = hub.hub_email;
      req.session.firstName = hub.first_name;
      req.session.lastName = hub.last_name;

      await logHubActivity(hub.hub_id, 'LOGIN', `Hub ${hub.hub_name} logged in`, null, hub.hub_email, req.ip);

      req.flash('success', `Welcome back, ${hub.first_name}!`);
      res.redirect('/hub/dashboard');
    } catch (error) {
            req.flash('error', 'An error occurred during login.');
      res.redirect('/hub/login');
    }
  },

  // Hub Logout
  hubLogoutGet: async (req, res) => {
    const hubId = req.session.hubId;
    const hubName = req.session.hubName;
    
    if (hubId) {
      await logHubActivity(hubId, 'LOGOUT', `Hub ${hubName} logged out`);
    }

    req.session.destroy((err) => {
      if (err) {
              }
      res.redirect('/hub/login');
    });
  },

  // Hub Dashboard
  hubDashboardGet: async (req, res) => {
    try {
      const hubId = req.session.hubId;

      // Get hub details
      const hubResult = await db.query(
        `SELECT * FROM managira_hubs WHERE hub_id = $1`,
        [hubId]
      );
      const hub = hubResult.rows[0];

      // Get organization count
      const orgCountResult = await db.query(
        `SELECT COUNT(*) as count FROM organizations 
         WHERE hub_id = $1 AND deleted = false AND is_hub_member = true`,
        [hubId]
      );
      const orgCount = parseInt(orgCountResult.rows[0].count);

      // Get total students across all organizations
      const studentsResult = await db.query(
        `SELECT COUNT(*) as count FROM students 
         WHERE organization_id IN (
           SELECT organization_id FROM organizations 
           WHERE hub_id = $1 AND deleted = false AND is_hub_member = true
         )`,
        [hubId]
      );
      const totalStudents = parseInt(studentsResult.rows[0].count);

      // Get total teachers across all organizations
      const teachersResult = await db.query(
        `SELECT COUNT(*) as count FROM users 
         WHERE organization_id IN (
           SELECT organization_id FROM organizations 
           WHERE hub_id = $1 AND deleted = false AND is_hub_member = true
         )`,
        [hubId]
      );
      const totalTeachers = parseInt(teachersResult.rows[0].count);

      // Get total classes
      const classesResult = await db.query(
        `SELECT COUNT(*) as count FROM classes 
         WHERE organization_id IN (
           SELECT organization_id FROM organizations 
           WHERE hub_id = $1 AND deleted = false AND is_hub_member = true
         )`,
        [hubId]
      );
      const totalClasses = parseInt(classesResult.rows[0].count);

      // Get organizations list with basic stats
      const orgsResult = await db.query(
        `SELECT o.organization_id, o.organization_name, o.email as organization_email, 
                o.first_name, o.last_name, o.created_at, o.nickname, o.joined_hub_at, o.on_hold,
                (SELECT COUNT(*) FROM students WHERE organization_id = o.organization_id) as student_count,
                (SELECT COUNT(*) FROM users WHERE organization_id = o.organization_id) as teacher_count,
                (SELECT COUNT(*) FROM classes WHERE organization_id = o.organization_id) as class_count
         FROM organizations o
         WHERE o.hub_id = $1 AND o.deleted = false AND o.is_hub_member = true
         ORDER BY o.organization_name ASC`,
        [hubId]
      );

      // Get pending invitations
      const invitationsResult = await db.query(
        `SELECT * FROM hub_organization_invitations 
         WHERE hub_id = $1 AND status = 'pending' 
         ORDER BY created_at DESC`,
        [hubId]
      );

      // Get pending detachment requests
      const detachmentRequestsResult = await db.query(
        `SELECT dr.*, o.organization_name, o.nickname, o.email as org_email
         FROM hub_detachment_requests dr
         JOIN organizations o ON dr.organization_id = o.organization_id
         WHERE dr.hub_id = $1 AND dr.status = 'pending'
         ORDER BY dr.created_at DESC`,
        [hubId]
      );

      // Get recent activity
      const activityResult = await db.query(
        `SELECT * FROM hub_activity_logs 
         WHERE hub_id = $1 
         ORDER BY created_at DESC 
         LIMIT 10`,
        [hubId]
      );

      res.render('hub/dashboard', {
        title: 'Hub Dashboard',
        hub,
        orgCount,
        totalStudents,
        totalTeachers,
        totalClasses,
        organizations: orgsResult.rows,
        pendingInvitations: invitationsResult.rows,
        detachmentRequests: detachmentRequestsResult.rows,
        recentActivity: activityResult.rows,
        messages: req.flash(),
        showFooterTopSection: true
      });
    } catch (error) {
            req.flash('error', 'Error loading dashboard.');
      res.redirect('/hub/login');
    }
  },

  // Setup Password (First Time)
  setupPasswordGet: async (req, res) => {
    const { token } = req.query;

    if (!token) {
      req.flash('error', 'Invalid or missing setup link.');
      return res.redirect('/hub/login');
    }

    try {
      // Hash the token to compare with stored hash
      const hashedToken = crypto.createHash('sha256').update(token).digest('hex');

      const result = await db.query(
        `SELECT * FROM managira_hubs 
         WHERE reset_password_token = $1 
         AND reset_password_expires > NOW()
         AND deleted = false`,
        [hashedToken]
      );

      if (result.rows.length === 0) {
        req.flash('error', 'Invalid or expired setup link. Please contact support.');
        return res.redirect('/hub/login');
      }

      const hub = result.rows[0];

      res.render('hub/setupPassword', {
        title: 'Setup Your Hub Password',
        token,
        hub,
        messages: req.flash(),
        showFooterTopSection: true
      });
    } catch (error) {
            req.flash('error', 'An error occurred.');
      res.redirect('/hub/login');
    }
  },

  setupPasswordPost: async (req, res) => {
    const { token, password, confirmPassword } = req.body;

    if (!password || !confirmPassword) {
      req.flash('error', 'All fields are required.');
      return res.redirect(`/hub/setup-password?token=${token}`);
    }

    if (password !== confirmPassword) {
      req.flash('error', 'Passwords do not match.');
      return res.redirect(`/hub/setup-password?token=${token}`);
    }

    if (password.length < 6) {
      req.flash('error', 'Password must be at least 6 characters.');
      return res.redirect(`/hub/setup-password?token=${token}`);
    }

    try {
      const hashedToken = crypto.createHash('sha256').update(token).digest('hex');

      const result = await db.query(
        `SELECT * FROM managira_hubs 
         WHERE reset_password_token = $1 
         AND reset_password_expires > NOW()`,
        [hashedToken]
      );

      if (result.rows.length === 0) {
        req.flash('error', 'Invalid or expired setup link.');
        return res.redirect('/hub/login');
      }

      const hub = result.rows[0];

      // Hash the new password
      const hashedPassword = await bcrypt.hash(password, 10);

      // Update hub password and clear token
      await db.query(
        `UPDATE managira_hubs 
         SET hub_password = $1, reset_password_token = NULL, reset_password_expires = NULL, updated_at = NOW()
         WHERE hub_id = $2`,
        [hashedPassword, hub.hub_id]
      );

      await logHubActivity(hub.hub_id, 'PASSWORD_SETUP', 'Hub password set up successfully');

      req.flash('success', 'Password set up successfully! You can now login.');
      res.redirect('/hub/login');
    } catch (error) {
            req.flash('error', 'An error occurred while setting up your password.');
      res.redirect('/hub/login');
    }
  },

  // Hub Settings
  hubSettingsGet: async (req, res) => {
    try {
      const hubId = req.session.hubId;

      const result = await db.query(
        `SELECT h.*, p.plan_name, p.total_cost 
         FROM managira_hubs h
         LEFT JOIN plans p ON h.plan_id = p.id
         WHERE h.hub_id = $1`,
        [hubId]
      );

      const hub = result.rows[0];

      res.render('hub/settings', {
        title: 'Hub Settings',
        hub,
        messages: req.flash(),
        showFooterTopSection: true
      });
    } catch (error) {
            req.flash('error', 'Error loading settings.');
      res.redirect('/hub/dashboard');
    }
  },

  // Update Hub Profile
  hubSettingsProfilePost: async (req, res) => {
    const { firstName, lastName, hubPhone, hubAddress } = req.body;
    const hubId = req.session.hubId;

    try {
      await db.query(
        `UPDATE managira_hubs 
         SET first_name = $1, last_name = $2, hub_phone = $3, hub_address = $4, updated_at = NOW()
         WHERE hub_id = $5`,
        [firstName, lastName, hubPhone, hubAddress, hubId]
      );

      await logHubActivity(hubId, 'PROFILE_UPDATE', 'Hub profile updated');

      req.flash('success', 'Profile updated successfully.');
      res.redirect('/hub/settings');
    } catch (error) {
            req.flash('error', 'Error updating profile.');
      res.redirect('/hub/settings');
    }
  },

  // Change Hub Password
  hubSettingsPasswordPost: async (req, res) => {
    const { currentPassword, newPassword, confirmPassword } = req.body;
    const hubId = req.session.hubId;

    try {
      // Verify current password
      const result = await db.query(
        'SELECT hub_password FROM managira_hubs WHERE hub_id = $1',
        [hubId]
      );

      const hub = result.rows[0];
      const isMatch = await bcrypt.compare(currentPassword, hub.hub_password);

      if (!isMatch) {
        req.flash('error', 'Current password is incorrect.');
        return res.redirect('/hub/settings');
      }

      if (newPassword !== confirmPassword) {
        req.flash('error', 'New passwords do not match.');
        return res.redirect('/hub/settings');
      }

      if (newPassword.length < 6) {
        req.flash('error', 'Password must be at least 6 characters.');
        return res.redirect('/hub/settings');
      }

      const hashedPassword = await bcrypt.hash(newPassword, 10);

      await db.query(
        'UPDATE managira_hubs SET hub_password = $1, updated_at = NOW() WHERE hub_id = $2',
        [hashedPassword, hubId]
      );

      await logHubActivity(hubId, 'PASSWORD_CHANGE', 'Hub password changed');

      req.flash('success', 'Password changed successfully.');
      res.redirect('/hub/settings');
    } catch (error) {
            req.flash('error', 'Error changing password.');
      res.redirect('/hub/settings');
    }
  },

  // Update Hub Logo
  hubSettingsLogoPost: async (req, res) => {
    const hubId = req.session.hubId;

    try {
      if (!req.file) {
        req.flash('error', 'Please select a logo file.');
        return res.redirect('/hub/settings');
      }

      const { uploadToS3, deleteFromS3 } = require('../middleware/s3Upload');

      // Get current logo to delete from S3
      const currentLogoResult = await db.query(
        'SELECT logo_path FROM managira_hubs WHERE hub_id = $1',
        [hubId]
      );

      const currentLogo = currentLogoResult.rows[0]?.logo_path;

      // Upload new logo to S3 with proper path including filename
      const logoKey = `images/hub-logos/${hubId}/${Date.now()}_${req.file.originalname}`;
      const logoUrl = await uploadToS3(req.file, logoKey);

            // Update database with new logo
      await db.query(
        'UPDATE managira_hubs SET logo_path = $1, updated_at = NOW() WHERE hub_id = $2',
        [logoUrl, hubId]
      );

      // Delete old logo from S3 if it exists and is not the default
      if (currentLogo && currentLogo !== '/images/managira.png' && !currentLogo.includes('managira.png')) {
        try {
          // Extract key from URL
          const s3Prefix = `https://${process.env.S3_BUCKET_NAME}.s3.${process.env.AWS_REGION}.amazonaws.com/`;
          const oldKey = currentLogo.startsWith(s3Prefix) ? currentLogo.substring(s3Prefix.length) : currentLogo;
          await deleteFromS3(oldKey);
        } catch (deleteError) {
                  }
      }

      // Update session with new logo
      req.session.logo = logoUrl;

      await logHubActivity(hubId, 'LOGO_UPDATE', 'Hub logo updated');

      req.flash('success', 'Logo updated successfully.');
      res.redirect('/hub/settings');
    } catch (error) {
            req.flash('error', 'Error updating logo.');
      res.redirect('/hub/settings');
    }
  },

  // GET - Display organization invitation form
  organizationInviteGet: async (req, res) => {
    try {
      const hub = req.hubInfo;

      // Check if hub has reached max organizations
      const orgCountResult = await db.query(
        'SELECT COUNT(*) FROM organizations WHERE hub_id = $1 AND deleted = false',
        [hub.hub_id]
      );
      const currentOrgCount = parseInt(orgCountResult.rows[0].count);

      if (currentOrgCount >= hub.max_organizations) {
        req.flash('error', `You have reached your maximum limit of ${hub.max_organizations} organizations. Please upgrade your plan or contact support.`);
        return res.redirect('/hub/dashboard');
      }

      res.render('hub/organizationInvite', {
        hub,
        currentOrgCount,
        maxOrganizations: hub.max_organizations,
        title: 'Invite Organization'
      });
    } catch (error) {
            req.flash('error', 'Error loading invitation form.');
      res.redirect('/hub/dashboard');
    }
  },

  // POST - Send organization invitation
  organizationInvitePost: async (req, res) => {
    try {
      const hub = req.hubInfo;
      const { organization_name, contact_person_name, contact_person_email, contact_person_phone, message } = req.body;

      // Validate inputs
      if (!organization_name || !contact_person_name || !contact_person_email) {
        req.flash('error', 'Please fill in all required fields.');
        return res.redirect('/hub/organizations/invite');
      }

      // Check if hub has reached max organizations
      const orgCountResult = await db.query(
        'SELECT COUNT(*) FROM organizations WHERE hub_id = $1 AND deleted = false',
        [hub.hub_id]
      );
      const currentOrgCount = parseInt(orgCountResult.rows[0].count);

      if (currentOrgCount >= hub.max_organizations) {
        req.flash('error', `You have reached your maximum limit of ${hub.max_organizations} organizations.`);
        return res.redirect('/hub/dashboard');
      }

      // Check if organization with this email already invited or exists
      const existingCheck = await db.query(
        `SELECT * FROM hub_organization_invitations 
         WHERE hub_id = $1 AND contact_person_email = $2 AND status = 'pending'`,
        [hub.hub_id, contact_person_email]
      );

      if (existingCheck.rows.length > 0) {
        req.flash('error', 'An invitation has already been sent to this email address.');
        return res.redirect('/hub/organizations/invite');
      }

      // Check if organization already exists with this contact email
      const orgCheck = await db.query(
        'SELECT * FROM organizations WHERE email = $1 AND deleted = false',
        [contact_person_email]
      );

      if (orgCheck.rows.length > 0) {
        req.flash('error', 'An organization with this contact email already exists.');
        return res.redirect('/hub/organizations/invite');
      }

      // Generate invitation token
      const invitationToken = crypto.randomBytes(32).toString('hex');
      const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000); // 7 days

      // Insert invitation
      await db.query(
        `INSERT INTO hub_organization_invitations 
         (hub_id, organization_name, contact_person_name, contact_person_email, contact_person_phone, invitation_token, message, expires_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
        [hub.hub_id, organization_name, contact_person_name, contact_person_email, contact_person_phone, invitationToken, message, expiresAt]
      );

      // Send invitation email
      const invitationUrl = `${process.env.APP_URL || 'http://localhost:4000'}/account/accept-hub-invitation/${invitationToken}`;
      
      const emailHtml = `
        <!DOCTYPE html>
        <html>
        <head>
          <style>
            body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
            .container { max-width: 600px; margin: 0 auto; padding: 20px; }
            .header { background: linear-gradient(135deg, #01535b 0%, #6fd3c4 100%); color: white; padding: 30px; text-align: center; border-radius: 10px 10px 0 0; }
            .content { background: #f9f9f9; padding: 30px; border-radius: 0 0 10px 10px; }
            .button { display: inline-block; padding: 12px 30px; background: linear-gradient(135deg, #01535b 0%, #6fd3c4 100%); color: white; text-decoration: none; border-radius: 5px; margin: 20px 0; }
            .info-box { background: white; padding: 15px; border-left: 4px solid #01535b; margin: 20px 0; }
            .footer { text-align: center; padding: 20px; color: #666; font-size: 12px; }
          </style>
        </head>
        <body>
          <div class="container">
            <div class="header">
              <img src="cid:managira_logo" alt="Managira" style="height: 50px; margin-bottom: 10px;">
              <h1>Hub Invitation from ${hub.hub_name}</h1>
            </div>
            <div class="content">
              <p>Dear ${contact_person_name},</p>
              
              <p><strong>${hub.hub_name}</strong> has invited <strong>${organization_name}</strong> to join their hub on Managira SMS.</p>
              
              ${message ? `<div class="info-box"><strong>Message from ${hub.hub_name}:</strong><br>${message}</div>` : ''}
              
              <h3>What is a Hub?</h3>
              <p>A hub is a parent organization that manages multiple schools or educational institutions. By joining this hub:</p>
              <ul>
                <li>Your organization will be managed under ${hub.hub_name}</li>
                <li>You'll inherit the hub's subscription plan (${hub.plan_name || 'Professional'})</li>
                <li>No separate billing - managed by the hub</li>
                <li>Your organization will be accessible at: <strong>${organization_name.toLowerCase().replace(/\s+/g, '')}.${hub.hub_nickname}.managira.com</strong></li>
              </ul>
              
              <h3>Accept This Invitation</h3>
              <p>Click the button below to accept this invitation and set up your organization:</p>
              
              <div style="text-align: center;">
                <a href="${invitationUrl}" class="button">Accept Invitation</a>
              </div>
              
              <p style="color: #666; font-size: 14px;">Or copy and paste this link: ${invitationUrl}</p>
              
              <p style="color: #999; font-size: 12px; margin-top: 30px;">This invitation expires on ${expiresAt.toLocaleDateString()}. If you have any questions, please contact ${hub.hub_name} at ${hub.hub_email}.</p>
            </div>
            <div class="footer">
              <p>&copy; ${new Date().getFullYear()} Managira SMS. All rights reserved.</p>
              <p>Empowering Education Through Technology</p>
            </div>
          </div>
        </body>
        </html>
      `;

      const emailSent = await sendEmail({
        to: contact_person_email,
        subject: `Invitation to Join ${hub.hub_name} Hub on Managira SMS`,
        html: emailHtml
      });

      if (!emailSent) {
        req.flash('warning', 'Invitation created but email could not be sent. Please resend the invitation.');
      } else {
        req.flash('success', `Invitation sent successfully to ${contact_person_email}`);
      }

      // Log activity
      await logHubActivity(
        hub.hub_id,
        'organization_invited',
        `Invited organization: ${organization_name} (${contact_person_email})`,
        null,
        hub.hub_name,
        req.ip
      );

      res.redirect('/hub/dashboard');
    } catch (error) {
            req.flash('error', 'Error sending invitation.');
      res.redirect('/hub/organizations/invite');
    }
  },

  // POST - Resend organization invitation
  resendInvitePost: async (req, res) => {
    try {
      const hub = req.hubInfo;
      const { invitationId } = req.body;

      // Get invitation details
      const invitationResult = await db.query(
        'SELECT * FROM hub_organization_invitations WHERE invitation_id = $1 AND hub_id = $2',
        [invitationId, hub.hub_id]
      );

      if (invitationResult.rows.length === 0) {
        req.flash('error', 'Invitation not found.');
        return res.redirect('/hub/dashboard');
      }

      const invitation = invitationResult.rows[0];

      if (invitation.status !== 'pending') {
        req.flash('error', 'This invitation has already been accepted or declined.');
        return res.redirect('/hub/dashboard');
      }

      // Update expiration date
      const newExpiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
      await db.query(
        'UPDATE hub_organization_invitations SET expires_at = $1, updated_at = CURRENT_TIMESTAMP WHERE invitation_id = $2',
        [newExpiresAt, invitationId]
      );

      // Resend email
      const invitationUrl = `${process.env.APP_URL || 'http://localhost:4000'}/account/accept-hub-invitation/${invitation.invitation_token}`;
      
      const emailHtml = `
        <!DOCTYPE html>
        <html>
        <head>
          <style>
            body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
            .container { max-width: 600px; margin: 0 auto; padding: 20px; }
            .header { background: linear-gradient(135deg, #01535b 0%, #6fd3c4 100%); color: white; padding: 30px; text-align: center; border-radius: 10px 10px 0 0; }
            .content { background: #f9f9f9; padding: 30px; border-radius: 0 0 10px 10px; }
            .button { display: inline-block; padding: 12px 30px; background: linear-gradient(135deg, #01535b 0%, #6fd3c4 100%); color: white; text-decoration: none; border-radius: 5px; margin: 20px 0; }
            .info-box { background: white; padding: 15px; border-left: 4px solid #01535b; margin: 20px 0; }
            .footer { text-align: center; padding: 20px; color: #666; font-size: 12px; }
          </style>
        </head>
        <body>
          <div class="container">
            <div class="header">
              <img src="cid:managira_logo" alt="Managira" style="height: 50px; margin-bottom: 10px;">
              <h1>Reminder: Hub Invitation from ${hub.hub_name}</h1>
            </div>
            <div class="content">
              <p>Dear ${invitation.contact_person_name},</p>
              
              <p>This is a reminder that <strong>${hub.hub_name}</strong> has invited <strong>${invitation.organization_name}</strong> to join their hub on Managira SMS.</p>
              
              ${invitation.message ? `<div class="info-box"><strong>Message from ${hub.hub_name}:</strong><br>${invitation.message}</div>` : ''}
              
              <p>Click the button below to accept this invitation and set up your organization:</p>
              
              <div style="text-align: center;">
                <a href="${invitationUrl}" class="button">Accept Invitation</a>
              </div>
              
              <p style="color: #666; font-size: 14px;">Or copy and paste this link: ${invitationUrl}</p>
              
              <p style="color: #999; font-size: 12px; margin-top: 30px;">This invitation expires on ${newExpiresAt.toLocaleDateString()}.</p>
            </div>
            <div class="footer">
              <p>&copy; ${new Date().getFullYear()} Managira SMS. All rights reserved.</p>
            </div>
          </div>
        </body>
        </html>
      `;

      await sendEmail({
        to: invitation.contact_person_email,
        subject: `Reminder: Invitation to Join ${hub.hub_name} Hub on Managira SMS`,
        html: emailHtml
      });

      // Log activity
      await logHubActivity(
        hub.hub_id,
        'invitation_resent',
        `Resent invitation to: ${invitation.organization_name} (${invitation.contact_person_email})`,
        null,
        hub.hub_name,
        req.ip
      );

      req.flash('success', 'Invitation resent successfully.');
      res.redirect('/hub/dashboard');
    } catch (error) {
            req.flash('error', 'Error resending invitation.');
      res.redirect('/hub/dashboard');
    }
  },

  // POST - Remove organization from hub
  removeOrganizationPost: async (req, res) => {
    try {
      const hub = req.hubInfo;
      const { organizationId } = req.body;

      // Get organization details
      const orgResult = await db.query(
        'SELECT * FROM organizations WHERE organization_id = $1 AND hub_id = $2 AND deleted = false',
        [organizationId, hub.hub_id]
      );

      if (orgResult.rows.length === 0) {
        req.flash('error', 'Organization not found or not part of this hub.');
        return res.redirect('/hub/dashboard');
      }

      const organization = orgResult.rows[0];

      // Remove from hub (unlink)
      await db.query(
        `UPDATE organizations 
         SET hub_id = NULL, is_hub_member = false, joined_hub_at = NULL 
         WHERE organization_id = $1`,
        [organizationId]
      );

      // Log activity
      await logHubActivity(
        hub.hub_id,
        'organization_removed',
        `Removed organization: ${organization.organization_name}`,
        organizationId,
        hub.hub_name,
        req.ip
      );

      // Send notification email to organization
      if (organization.email) {
        const emailHtml = `
          <!DOCTYPE html>
          <html>
          <head>
            <style>
              body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
              .container { max-width: 600px; margin: 0 auto; padding: 20px; }
              .header { background: linear-gradient(135deg, #01535b 0%, #6fd3c4 100%); color: white; padding: 30px; text-align: center; border-radius: 10px 10px 0 0; }
              .content { background: #f9f9f9; padding: 30px; border-radius: 0 0 10px 10px; }
              .alert-box { background: #fff3cd; padding: 15px; border-left: 4px solid #ffc107; margin: 20px 0; }
              .footer { text-align: center; padding: 20px; color: #666; font-size: 12px; }
            </style>
          </head>
          <body>
            <div class="container">
              <div class="header">
                <img src="cid:managira_logo" alt="Managira" style="height: 50px; margin-bottom: 10px;">
                <h1>Hub Membership Update</h1>
              </div>
              <div class="content">
                <div class="alert-box">
                  <strong>Important Notice</strong>
                </div>
                
                <p>Dear ${organization.organization_name} Administrator,</p>
                
                <p>Your organization has been removed from the <strong>${hub.hub_name}</strong> hub.</p>
                
                <h3>What This Means:</h3>
                <ul>
                  <li>Your organization is now independent</li>
                  <li>You will need to set up your own subscription plan</li>
                  <li>Your subdomain has changed to: <strong>${organization.organization_nickname}.managira.com</strong></li>
                  <li>All your data remains intact</li>
                </ul>
                
                <p>If you believe this is an error, please contact ${hub.hub_name} at ${hub.hub_email}.</p>
                
                <p>To set up your subscription, please log in to your organization dashboard.</p>
              </div>
              <div class="footer">
                <p>&copy; ${new Date().getFullYear()} Managira SMS. All rights reserved.</p>
              </div>
            </div>
          </body>
          </html>
        `;

        await sendEmail({
          to: organization.email,
          subject: `Hub Membership Update - ${organization.organization_name}`,
          html: emailHtml
        });
      }

      req.flash('success', `${organization.organization_name} has been removed from your hub.`);
      res.redirect('/hub/dashboard');
    } catch (error) {
            req.flash('error', 'Error removing organization.');
      res.redirect('/hub/dashboard');
    }
  },

  // POST - Cancel pending invitation
  cancelInvitationPost: async (req, res) => {
    try {
      const hub = req.hubInfo;
      const { invitationId } = req.body;

      // Get invitation details
      const invitationResult = await db.query(
        'SELECT * FROM hub_organization_invitations WHERE invitation_id = $1 AND hub_id = $2',
        [invitationId, hub.hub_id]
      );

      if (invitationResult.rows.length === 0) {
        req.flash('error', 'Invitation not found.');
        return res.redirect('/hub/dashboard');
      }

      const invitation = invitationResult.rows[0];

      if (invitation.status !== 'pending') {
        req.flash('error', 'This invitation cannot be cancelled.');
        return res.redirect('/hub/dashboard');
      }

      // Update status to cancelled
      await db.query(
        'UPDATE hub_organization_invitations SET status = $1, updated_at = CURRENT_TIMESTAMP WHERE invitation_id = $2',
        ['cancelled', invitationId]
      );

      // Log activity
      await logHubActivity(
        hub.hub_id,
        'invitation_cancelled',
        `Cancelled invitation to: ${invitation.organization_name} (${invitation.contact_person_email})`,
        null,
        hub.hub_name,
        req.ip
      );

      req.flash('success', 'Invitation cancelled successfully.');
      res.redirect('/hub/dashboard');
    } catch (error) {
            req.flash('error', 'Error cancelling invitation.');
      res.redirect('/hub/dashboard');
    }
  },

  // POST - Toggle organization hold status
  toggleOrganizationHoldPost: async (req, res) => {
    try {
      const hub = req.hubInfo;
      const { organizationId } = req.body;

            // Get organization details
      const orgResult = await db.query(
        'SELECT * FROM organizations WHERE organization_id = $1 AND hub_id = $2 AND deleted = false',
        [organizationId, hub.hub_id]
      );

      if (orgResult.rows.length === 0) {
        req.flash('error', 'Organization not found or not part of this hub.');
        return res.redirect('/hub/dashboard');
      }

      const organization = orgResult.rows[0];
      const newHoldStatus = !organization.on_hold;

            // Toggle hold status
      await db.query(
        'UPDATE organizations SET on_hold = $1 WHERE organization_id = $2',
        [newHoldStatus, organizationId]
      );

      // Log activity
      await logHubActivity(
        hub.hub_id,
        newHoldStatus ? 'organization_held' : 'organization_resumed',
        `${newHoldStatus ? 'Put on hold' : 'Resumed'}: ${organization.organization_name}`,
        organizationId,
        hub.hub_name,
        req.ip
      );

            req.flash('success', `${organization.organization_name} has been ${newHoldStatus ? 'put on hold' : 'resumed'}.`);
      res.redirect('/hub/dashboard');
    } catch (error) {
            req.flash('error', 'Error updating organization status.');
      res.redirect('/hub/dashboard');
    }
  },

  // POST - Permanently delete organization
  deleteOrganizationPost: async (req, res) => {
    try {
      const hub = req.hubInfo;
      const { organizationId } = req.body;

            // Get organization details
      const orgResult = await db.query(
        'SELECT * FROM organizations WHERE organization_id = $1 AND hub_id = $2',
        [organizationId, hub.hub_id]
      );

      if (orgResult.rows.length === 0) {
        req.flash('error', 'Organization not found or not part of this hub.');
        return res.redirect('/hub/dashboard');
      }

      const organization = orgResult.rows[0];

      // Mark as deleted
      await db.query(
        'UPDATE organizations SET deleted = true, deleted_at = CURRENT_TIMESTAMP WHERE organization_id = $1',
        [organizationId]
      );

      // Log activity
      await logHubActivity(
        hub.hub_id,
        'organization_deleted',
        `Deleted organization: ${organization.organization_name}`,
        organizationId,
        hub.hub_name,
        req.ip
      );

            req.flash('success', `${organization.organization_name} has been permanently deleted.`);
      res.redirect('/hub/dashboard');
    } catch (error) {
            req.flash('error', 'Error deleting organization.');
      res.redirect('/hub/dashboard');
    }
  },

  // GET - Edit organization page
  editOrganizationGet: async (req, res) => {
    try {
      const hub = req.hubInfo;
      const { organizationId } = req.params;

      // Get organization details
      const orgResult = await db.query(
        'SELECT * FROM organizations WHERE organization_id = $1 AND hub_id = $2 AND deleted = false',
        [organizationId, hub.hub_id]
      );

      if (orgResult.rows.length === 0) {
        req.flash('error', 'Organization not found.');
        return res.redirect('/hub/dashboard');
      }

      res.render('hub/editOrganization', {
        title: 'Edit Organization',
        organization: orgResult.rows[0],
        hub,
        messages: req.flash(),
        showFooterTopSection: true
      });
    } catch (error) {
            req.flash('error', 'Error loading organization.');
      res.redirect('/hub/dashboard');
    }
  },

  // POST - Update organization details
  editOrganizationPost: async (req, res) => {
    try {
      const hub = req.hubInfo;
      const { organizationId } = req.params;
      const {
        organization_name,
        organization_address,
        organization_phone
      } = req.body;

                  // Validate
      if (!organization_name || !organization_address || !organization_phone) {
        req.flash('error', 'All fields are required.');
        return res.redirect(`/hub/organizations/edit/${organizationId}`);
      }

      // Get organization details
      const orgResult = await db.query(
        'SELECT * FROM organizations WHERE organization_id = $1 AND hub_id = $2 AND deleted = false',
        [organizationId, hub.hub_id]
      );

      if (orgResult.rows.length === 0) {
        req.flash('error', 'Organization not found.');
        return res.redirect('/hub/dashboard');
      }

      // Update organization
      await db.query(
        `UPDATE organizations 
         SET organization_name = $1, organization_address = $2, organization_phone = $3
         WHERE organization_id = $4`,
        [organization_name, organization_address, organization_phone, organizationId]
      );

      // Log activity
      await logHubActivity(
        hub.hub_id,
        'organization_updated',
        `Updated organization: ${organization_name}`,
        organizationId,
        hub.hub_name,
        req.ip
      );

            req.flash('success', 'Organization updated successfully.');
      res.redirect('/hub/dashboard');
    } catch (error) {
            req.flash('error', 'Error updating organization.');
      res.redirect(`/hub/organizations/edit/${req.params.organizationId}`);
    }
  },

  // POST - Approve detachment request
  approveDetachmentPost: async (req, res) => {
    try {
      const hub = req.hubInfo;
      const { requestId } = req.body;

                  // Get request details
      const requestResult = await db.query(
        `SELECT dr.*, o.organization_name, o.nickname, o.email as org_email
         FROM hub_detachment_requests dr
         JOIN organizations o ON dr.organization_id = o.organization_id
         WHERE dr.request_id = $1 AND dr.hub_id = $2 AND dr.status = 'pending'`,
        [requestId, hub.hub_id]
      );

      if (requestResult.rows.length === 0) {
        req.flash('error', 'Detachment request not found or already processed.');
        return res.redirect('/hub/dashboard');
      }

      const request = requestResult.rows[0];

            // Detach organization from hub
      await db.query(
        `UPDATE organizations 
         SET hub_id = NULL, is_hub_member = false, joined_hub_at = NULL 
         WHERE organization_id = $1`,
        [request.organization_id]
      );

            // Update request status
      await db.query(
        `UPDATE hub_detachment_requests 
         SET status = 'approved', reviewed_by = $1, reviewed_at = CURRENT_TIMESTAMP 
         WHERE request_id = $2`,
        [req.session.email, requestId]
      );

            // Log activity
      await logHubActivity(
        hub.hub_id,
        'detachment_approved',
        `Approved detachment request from ${request.organization_name}`,
        request.organization_id,
        hub.hub_name,
        req.ip
      );

      // Send notification email to organization
      const emailHtml = `
        <!DOCTYPE html>
        <html>
        <head>
          <style>
            body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
            .container { max-width: 600px; margin: 0 auto; padding: 20px; }
            .header { background: linear-gradient(135deg, #01535b 0%, #6fd3c4 100%); color: white; padding: 30px; text-align: center; border-radius: 10px 10px 0 0; }
            .content { background: #f9f9f9; padding: 30px; border-radius: 0 0 10px 10px; }
            .success-box { background: #d4edda; padding: 15px; border-left: 4px solid #28a745; margin: 20px 0; }
            .info-box { background: white; padding: 15px; border-left: 4px solid #01535b; margin: 20px 0; }
            .footer { text-align: center; padding: 20px; color: #666; font-size: 12px; }
          </style>
        </head>
        <body>
          <div class="container">
            <div class="header">
              <h1>✅ Detachment Request Approved</h1>
            </div>
            <div class="content">
              <div class="success-box">
                <strong>Your request has been approved</strong>
              </div>
              
              <p>Dear ${request.organization_name} Administrator,</p>
              
              <p>Your request to detach from <strong>${hub.hub_name}</strong> hub has been approved.</p>
              
              <div class="info-box">
                <h3>What's Changed:</h3>
                <ul>
                  <li>Your organization is now independent</li>
                  <li>Your new subdomain: <strong>${request.nickname}.managira.com</strong></li>
                  <li>You'll need to set up your own subscription plan</li>
                  <li>All your data remains intact</li>
                </ul>
              </div>
              
              <h3>Next Steps:</h3>
              <ol>
                <li>Log in to your organization dashboard</li>
                <li>Go to Account Settings to set up your subscription</li>
                <li>Choose a plan that fits your needs</li>
                <li>Complete payment to continue using Managira SMS</li>
              </ol>
              
              <p>If you have any questions, please contact support at support@managira.com.</p>
              
              <p>Thank you for using Managira SMS!</p>
            </div>
            <div class="footer">
              <p>&copy; ${new Date().getFullYear()} Managira SMS. All rights reserved.</p>
            </div>
          </div>
        </body>
        </html>
      `;

      await sendEmail({
        to: request.org_email,
        subject: 'Detachment Request Approved - Managira SMS',
        html: emailHtml
      });

                  req.flash('success', `Detachment approved. ${request.organization_name} is now independent.`);
      res.redirect('/hub/dashboard');
    } catch (error) {
            req.flash('error', 'Error approving detachment request.');
      res.redirect('/hub/dashboard');
    }
  },

  // POST - Reject detachment request
  rejectDetachmentPost: async (req, res) => {
    try {
      const hub = req.hubInfo;
      const { requestId, notes } = req.body;

                        // Get request details
      const requestResult = await db.query(
        `SELECT dr.*, o.organization_name, o.email as org_email
         FROM hub_detachment_requests dr
         JOIN organizations o ON dr.organization_id = o.organization_id
         WHERE dr.request_id = $1 AND dr.hub_id = $2 AND dr.status = 'pending'`,
        [requestId, hub.hub_id]
      );

      if (requestResult.rows.length === 0) {
        req.flash('error', 'Detachment request not found or already processed.');
        return res.redirect('/hub/dashboard');
      }

      const request = requestResult.rows[0];

            // Update request status
      await db.query(
        `UPDATE hub_detachment_requests 
         SET status = 'rejected', reviewed_by = $1, reviewed_at = CURRENT_TIMESTAMP, notes = $2 
         WHERE request_id = $3`,
        [req.session.email, notes, requestId]
      );

            // Log activity
      await logHubActivity(
        hub.hub_id,
        'detachment_rejected',
        `Rejected detachment request from ${request.organization_name}`,
        request.organization_id,
        hub.hub_name,
        req.ip
      );

      // Send notification email to organization
      const emailHtml = `
        <!DOCTYPE html>
        <html>
        <head>
          <style>
            body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
            .container { max-width: 600px; margin: 0 auto; padding: 20px; }
            .header { background: linear-gradient(135deg, #01535b 0%, #6fd3c4 100%); color: white; padding: 30px; text-align: center; border-radius: 10px 10px 0 0; }
            .content { background: #f9f9f9; padding: 30px; border-radius: 0 0 10px 10px; }
            .warning-box { background: #fff3cd; padding: 15px; border-left: 4px solid #ffc107; margin: 20px 0; }
            .info-box { background: white; padding: 15px; border-left: 4px solid #01535b; margin: 20px 0; }
            .footer { text-align: center; padding: 20px; color: #666; font-size: 12px; }
          </style>
        </head>
        <body>
          <div class="container">
            <div class="header">
              <h1>Detachment Request Update</h1>
            </div>
            <div class="content">
              <div class="warning-box">
                <strong>Your request has been reviewed</strong>
              </div>
              
              <p>Dear ${request.organization_name} Administrator,</p>
              
              <p>Your request to detach from <strong>${hub.hub_name}</strong> hub has been reviewed.</p>
              
              ${notes ? `<div class="info-box"><h3>Response from ${hub.hub_name}:</h3><p>${notes}</p></div>` : ''}
              
              <p>If you have concerns or wish to discuss this decision, please contact ${hub.hub_name} at ${hub.hub_email}.</p>
              
              <p>You can submit a new request in the future if needed.</p>
            </div>
            <div class="footer">
              <p>&copy; ${new Date().getFullYear()} Managira SMS. All rights reserved.</p>
            </div>
          </div>
        </body>
        </html>
      `;

      await sendEmail({
        to: request.org_email,
        subject: 'Detachment Request Update - Managira SMS',
        html: emailHtml
      });

                  req.flash('success', `Detachment request from ${request.organization_name} has been rejected.`);
      res.redirect('/hub/dashboard');
    } catch (error) {
            req.flash('error', 'Error rejecting detachment request.');
      res.redirect('/hub/dashboard');
    }
  },

  // GET - Search for existing organizations
  searchOrganizationsGet: async (req, res) => {
    try {
      const hub = req.hubInfo;
      const { q } = req.query;

                  if (!q || q.length < 2) {
        return res.json({ organizations: [] });
      }

      // Search for organizations not in any hub or not in this hub
      const result = await db.query(
        `SELECT organization_id, organization_name, email, nickname, is_hub_member, hub_id
         FROM organizations
         WHERE (LOWER(organization_name) LIKE LOWER($1) OR LOWER(email) LIKE LOWER($1))
         AND deleted = false
         AND organization_id NOT IN (
           SELECT organization_id FROM organizations WHERE hub_id = $2
         )
         ORDER BY organization_name
         LIMIT 10`,
        [`%${q}%`, hub.hub_id]
      );

                  res.json({ organizations: result.rows });
    } catch (error) {
            res.status(500).json({ error: 'Search failed' });
    }
  },

  // POST - Invite existing organization
  inviteExistingOrgPost: async (req, res) => {
    try {
      const hub = req.hubInfo;
      const { organizationId } = req.body;

                  // Check if organization exists and is not in a hub
      const orgResult = await db.query(
        `SELECT * FROM organizations WHERE organization_id = $1 AND deleted = false`,
        [organizationId]
      );

      if (orgResult.rows.length === 0) {
        req.flash('error', 'Organization not found.');
        return res.redirect('/hub/organizations/invite');
      }

      const org = orgResult.rows[0];

      if (org.is_hub_member && org.hub_id) {
        req.flash('error', `${org.organization_name} is already part of a hub.`);
        return res.redirect('/hub/organizations/invite');
      }

      // Check if invitation already exists
      const existingInvite = await db.query(
        `SELECT * FROM hub_organization_invitations 
         WHERE hub_id = $1 AND contact_person_email = $2 AND status = 'pending'`,
        [hub.hub_id, org.email]
      );

      if (existingInvite.rows.length > 0) {
        req.flash('error', 'An invitation has already been sent to this organization.');
        return res.redirect('/hub/organizations/invite');
      }

      // Check hub capacity
      const orgCountResult = await db.query(
        `SELECT COUNT(*) as count FROM organizations WHERE hub_id = $1 AND deleted = false`,
        [hub.hub_id]
      );

      const currentCount = parseInt(orgCountResult.rows[0].count);
      if (currentCount >= hub.max_organizations) {
        req.flash('error', 'You have reached your maximum organization capacity.');
        return res.redirect('/hub/organizations/invite');
      }

            // Generate invitation token
      const token = crypto.randomBytes(32).toString('hex');
      const expiresAt = new Date();
      expiresAt.setDate(expiresAt.getDate() + 7); // 7 days expiry

      // Create invitation record
      await db.query(
        `INSERT INTO hub_organization_invitations 
         (hub_id, organization_name, contact_person_name, contact_person_email, contact_person_phone, 
          invitation_token, expires_at, existing_org_id)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
        [hub.hub_id, org.organization_name, org.organization_name, org.email, '', token, expiresAt, organizationId]
      );

            // Log activity
      await logHubActivity(
        hub.hub_id,
        'invitation_sent',
        `Invited existing organization: ${org.organization_name}`,
        null,
        hub.hub_name,
        req.ip
      );

      // Send email to organization
      const emailHtml = `
        <!DOCTYPE html>
        <html>
        <head>
          <style>
            body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
            .container { max-width: 600px; margin: 0 auto; padding: 20px; }
            .header { background: linear-gradient(135deg, #01535b 0%, #6fd3c4 100%); color: white; padding: 30px; text-align: center; border-radius: 10px 10px 0 0; }
            .content { background: #f9f9f9; padding: 30px; border-radius: 0 0 10px 10px; }
            .button { display: inline-block; padding: 14px 32px; background: #01535b; color: white; text-decoration: none; border-radius: 8px; font-weight: 600; margin: 20px 0; }
            .info-box { background: white; padding: 15px; border-left: 4px solid #01535b; margin: 20px 0; }
            .footer { text-align: center; padding: 20px; color: #666; font-size: 12px; }
            .warning-box { background: #fff3cd; padding: 15px; border-left: 4px solid #ffc107; margin: 20px 0; }
          </style>
        </head>
        <body>
          <div class="container">
            <div class="header">
              <h1>🤝 Hub Invitation</h1>
            </div>
            <div class="content">
              <p>Dear ${org.organization_name} Team,</p>
              
              <p><strong>${hub.hub_name}</strong> has invited you to join their hub on Managira SMS!</p>
              
              <div class="info-box">
                <h3>What is a Hub?</h3>
                <p>A hub allows multiple organizations to be managed under one parent organization. Your organization will remain independent but will benefit from centralized management.</p>
              </div>

              <div class="warning-box">
                <strong>⚠️ Important Changes:</strong>
                <ul>
                  <li>Your subdomain will change to: <strong>${org.nickname}.${hub.hub_nickname}.managira.com</strong></li>
                  <li>Your subscription will be managed by ${hub.hub_name}</li>
                  <li>All your data remains with your organization</li>
                  <li>You'll still have full control over your organization's operations</li>
                </ul>
              </div>
              
              <div style="text-align: center;">
                <a href="${process.env.BASE_URL || 'https://managira.com'}/account/accept-hub-invitation-existing/${token}" class="button">
                  Accept Invitation
                </a>
              </div>
              
              <p style="font-size: 0.9rem; color: #666;">This invitation expires on ${expiresAt.toLocaleDateString()}.</p>
              
              <p>If you have questions, please contact ${hub.hub_name} at ${hub.hub_email}.</p>
            </div>
            <div class="footer">
              <p>&copy; ${new Date().getFullYear()} Managira SMS. All rights reserved.</p>
            </div>
          </div>
        </body>
        </html>
      `;

      await sendEmail({
        to: org.email,
        subject: `Invitation to join ${hub.hub_name} Hub - Managira SMS`,
        html: emailHtml
      });

                  req.flash('success', `Invitation sent to ${org.organization_name}!`);
      res.redirect('/hub/dashboard');
    } catch (error) {
            req.flash('error', 'Error sending invitation.');
      res.redirect('/hub/organizations/invite');
    }
  },
};

module.exports = hubController;
