// Helper to parse truthy values from form/query/session
function parseTruthyFlag(val) {
  if (typeof val === 'boolean') return val;
  if (typeof val === 'number') return val === 1;
  if (typeof val === 'string') {
    return val === '1' || val.toLowerCase() === 'true' || val === 'on';
  }
  return false;
}
const bcrypt = require("bcryptjs");

const bcryptjs = require("bcryptjs");

const db = require("../config/db");

const crypto = require("crypto");

const path = require("path");

const nodemailer = require("nodemailer");

const { upload, uploadToS3, deleteFromS3 } = require("../middleware/s3Upload");

const fs = require("fs");

const PDFDocument = require("pdfkit");

const paystack = require("paystack")(process.env.PAYSTACK_SECRET_KEY);

const axios = require("axios");

const he = require("he");

const { readFileSync } = require("fs");
const { sendEmailSafely } = require("../utils/emailHelper");

async function sendBrandedReceiptEmail({
  to,

  name,

  amount,

  reference,

  organization,

  email,
  date,
}) {
  try {
    const templatePath = path.join(
      __dirname,
      "../utils/templates/receiptEmail.html"
    );
    let html = readFileSync(templatePath, "utf8");
    const year = new Date().getFullYear();

    html = html

      .replace(/{{name}}/g, name)

      .replace(/{{amount}}/g, amount)

      .replace(/{{reference}}/g, reference)

      .replace(/{{organization}}/g, organization)

      .replace(/{{email}}/g, email)

      .replace(/{{date}}/g, date)

      .replace(/{{year}}/g, year);

    await sendEmailSafely(
      {
        to,
        subject: "Payment Receipt - Managira",
        html,
        attachments: [
          {
            filename: "managira.png",
            path: path.join(__dirname, "../public/images/managira.png"),
            cid: "managira_logo",
          },
        ],
      },
      "ReceiptEmail"
    );
  } catch (error) {
    console.error("Error sending receipt email:", error.message);

    throw new Error("Failed to send receipt email.");
  }
}

async function sendInvoiceEmail(email, orgName, invoice) {
  try {
    const invoiceUrl = invoice.hosted_invoice_url || "No URL available";

    const dueDate = new Date(invoice.due_date * 1000).toLocaleDateString();

    const amountDue = (invoice.amount_due / 100).toFixed(2);

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

            <div style="color:#6fd3c4;font-size:24px;font-weight:600;margin-bottom:16px;letter-spacing:1px;">New Invoice from Managira</div>

            <p style="font-size:16px;line-height:1.6;margin-bottom:18px;">Hello,</p>

            <p style="font-size:16px;line-height:1.6;margin-bottom:18px;">A new invoice has been generated for your subscription:</p>

            <table style="margin:18px 0 24px 0;font-size:16px;">
              <tr><td style="color:#888;padding:4px 12px 4px 0;">Organization Name:</td><td style="color:#222;font-weight:500;">${he.encode(
                orgName
              )}</td></tr>
              <tr><td style="color:#888;padding:4px 12px 4px 0;">Amount Due:</td><td style="color:#1ca34a;font-weight:600;">$${he.encode(
                amountDue
              )}</td></tr>
              <tr><td style="color:#888;padding:4px 12px 4px 0;">Due Date:</td><td style="color:#222;font-weight:500;">${he.encode(
                dueDate
              )}</td></tr>
            </table>

        

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

      subject: "New Invoice from Managira",

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
  } catch (error) {
    console.error("❌ Error sending invoice email:", error.message);

    throw new Error("Failed to send invoice email.");
  }
}

async function sendCancellationEmail(orgName, firstName, email) {
  if (!email) {
    throw new Error("Recipient email is not defined.");
  }

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

          <div style="color:#6fd3c4;font-size:24px;font-weight:600;margin-bottom:16px;letter-spacing:1px;">Subscription Cancellation Confirmation</div>

          <p style="font-size:16px;line-height:1.6;margin-bottom:18px;">Dear <b>${firstName}</b>,</p>

          <p style="font-size:16px;line-height:1.6;margin-bottom:18px;">We wanted to confirm that your subscription for the organization <b>${orgName}</b> has been <span style='color:#b80000;font-weight:600;'>successfully canceled</span>.</p>

          <p style="font-size:16px;line-height:1.6;margin-bottom:18px;">You will <b>continue to have full access to the platform</b> until the end of your <b>current billing cycle</b>, after which your subscription will be fully deactivated. During this period, all users within your organization can continue their normal activities.</p>

          <p style="font-size:16px;line-height:1.6;margin-bottom:18px;">We truly value our relationship with you and would love the opportunity to work together again in the future. If you decide to <b>reactivate your subscription</b>, you can do so <b>before the end of your current billing cycle</b> through your account settings. Should you need any assistance, our support team is always available to help.</p>

          <p style="font-size:16px;line-height:1.6;margin-bottom:18px;">Additionally, if you would like to request a copy of your organization’s data, please let us know. Rest assured, all data remains securely stored with us.</p>

          <p style="font-size:16px;line-height:1.6;margin-bottom:18px;">If you have any questions or need further assistance, please visit our <a href="https://www.managira.com/legal/help" target="_blank" rel="noopener" style="color:#1ca34a;font-weight:500;">Help Center</a> or <a href="https://www.managira.com/legal/faq" target="_blank" rel="noopener" style="color:#1ca34a;font-weight:500;">FAQ page</a>.</p>

          <p style="color:#b80000;font-size:16px;font-weight:bold;margin-top:32px;text-align:center;letter-spacing:1px;">THIS IS A NO-REPLY MESSAGE. PLEASE DO NOT REPLY TO THIS EMAIL.</p>

        </div>

        <div style="background:#e6f7ec;color:#888;text-align:center;padding:18px 0;font-size:13px;">&copy; ${new Date().getFullYear()} Managira. All rights reserved.</div>

      </div>

    </div>

  `;

  const mailOptions = {
    from: process.env.NOTIFY_EMAIL_USER,

    to: email,

    subject: "Subscription Cancellation Confirmation",

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
}

async function sendRegistrationSuccessEmail(
  email,

  firstName,

  lastName
) {
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

    const html = `

      <div style="background:#f4fbfa;padding:40px 0;">

        <div style="max-width:600px;margin:40px auto;background:#fff;border-radius:16px;box-shadow:0 4px 24px #b2e2d6;overflow:hidden;font-family:'Segoe UI',Arial,sans-serif;">

          <div style="background:#6fd3c4;padding:24px 0 24px 32px;display:flex;align-items:center;">

            <img src="cid:managira_logo" alt="Managira Logo" style="height:60px;display:block;">

          </div>

          <div style="padding:36px 32px 32px 32px;">

            <div style="color:#6fd3c4;font-size:28px;font-weight:600;margin-bottom:16px;letter-spacing:1px;">Welcome to Managira!</div>

            <p style="font-size:17px;line-height:1.6;margin-bottom:18px;">Hi <b>${firstName} ${lastName}</b>,</p>

            <p style="font-size:16px;line-height:1.6;margin-bottom:18px;">Your organization account has been <b style='color:#1ca34a;'>successfully registered</b> and is now active.</p>

            <p style="font-size:16px;line-height:1.6;margin-bottom:18px;">You can now log in and start using all the features of <span style='color:#1ca34a;font-weight:500;'>Managira</span>.</p>

            <div style="margin-top:32px;margin-bottom:18px;">

              <a href="https://www.managira.com/account/login" style="background:#6fd3c4;color:#fff;padding:12px 32px;border-radius:6px;text-decoration:none;font-size:16px;font-weight:600;box-shadow:0 2px 8px #b2e2d6;">Log In to Your Account</a>

            </div>

            <p style="margin-top:18px;font-size:15px;">If you have any questions, please visit our <a href="https://www.managira.com/legal/help" target="_blank" rel="noopener" style="color:#1ca34a;font-weight:500;">Help Center</a> or <a href="https://www.managira.com/legal/faq" target="_blank" rel="noopener" style="color:#1ca34a;font-weight:500;">FAQ page</a>.</p>



            <p style="margin-top:18px;font-size:15px;line-height:1.6;">To get onboarded fast, please open the attached <strong>Managira Starter Pack (PDF)</strong> for step-by-step setup instructions. You can also watch a short walkthrough video on our YouTube channel: <a href="https://youtu.be/D8da4yiDBWc?si=NMJKd9PCmMq98IzJ" target="_blank" rel="noopener" style="color:#1ca34a;font-weight:500;">Watch the walkthrough on YouTube</a>. .</p>

            <p style="color:#b80000;font-size:16px;font-weight:bold;margin-top:32px;text-align:center;letter-spacing:1px;">THIS IS A NO-REPLY MESSAGE. PLEASE DO NOT REPLY TO THIS EMAIL.</p>

          </div>

          <div style="background:#e6f7ec;color:#888;text-align:center;padding:18px 0;font-size:13px;">&copy; ${new Date().getFullYear()} Managira. All rights reserved.</div>

        </div>

      </div>

    `;

    const mailOptions = {
      from: process.env.NOTIFY_EMAIL_USER,

      to: email,

      subject: "Account Registration Confirmation",

      html,

      attachments: [
        {
          filename: "managira.png",
          path: path.join(__dirname, "../public/images/managira.png"),
          cid: "managira_logo",
        },

        {
          // Attach the starter pack PDF for new users
          filename: "Managira Starter Pack.pdf",
          path: path.join(
            __dirname,
            "../public/managira pdf/Managira Starter Pack.pdf"
          ),
        },
      ],
    };

    await transporter.sendMail(mailOptions);
  } catch (error) {
    console.error("Error sending registration success email:", error.message);

    throw new Error("Failed to send registration success email.");
  }
}

// Helper function to send password reset email

async function sendPasswordResetEmail(email, token, baseUrl) {
  const transporter = nodemailer.createTransport({
    host: process.env.SMTP_HOST, // e.g., smtp.gmail.com, smtp.zoho.com

    port: parseInt(process.env.SMTP_PORT), // usually 465 or 587

    secure: process.env.SMTP_SECURE === "true", // true for 465, false for 587

    auth: {
      user: process.env.ADMIN_NOTIFY_EMAIL_USER,

      pass: process.env.ADMIN_NOTIFY_EMAIL_PASSWORD,
    },
  });

  const resetLink = `${baseUrl}/account/reset-password?token=${token}`;

  const mailOptions = {
    from: process.env.NOTIFY_EMAIL_USER,

    to: email,

    subject: "Password Reset Request",

    html: `

        <p>You requested to reset your password. Please click the link below to reset it:</p>

        <p><a href="${resetLink}" target="_blank">Reset Password</a></p>

        <p>This link will expire in 15 minutes.</p>

        <p>If you didn't request this, please ignore this email.</p>

        `,
  };

  await transporter.sendMail(mailOptions);
}

async function sendPasswordResetConfirmationEmail(email) {
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

    to: email,

    subject: "Password Reset Successful",

    html: `

            <p>Dear User,</p>

            <p>Your password has been successfully reset. If you made this change, no further action is required.</p>

            <p><strong>Keep your password safe:</strong> Do not share it with anyone.</p>

            <p>If you did not request this password reset, please <a href="mailto:support@example.com">contact our support team</a> immediately.</p>

            <p>Best regards,<br>Managira Team</p>

        `,
  };

  try {
    await transporter.sendMail(mailOptions);
  } catch (error) {
    console.error(
      "Error sending password reset confirmation email:",

      error.message
    );
  }
}

async function notifyAdminOfRegistration(
  firstName,

  lastName,

  orgName,

  email,

  orgPhone
) {
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

    to: process.env.ADMIN_EMAIL,

    subject: "New Account Registration",

    text: `A new account has been registered:\n\nName: ${firstName} ${lastName}\nOrganization: ${orgName}\nEmail: ${email}\nPhone: ${orgPhone}\n\nPlease review the registration details.`,
  };

  await transporter.sendMail(mailOptions);
}

async function saveCardAuthorization(db, orgId, authorization) {
  await db.query(
    `INSERT INTO stored_cards (
      organization_id,
      authorization_code,
      last_four,
      exp_month,
      exp_year,
      card_type,
      bank,
      is_primary
    ) VALUES ($1, $2, $3, $4, $5, $6, $7, false)
    ON CONFLICT (organization_id, authorization_code) DO NOTHING`,
    [
      orgId,
      authorization.authorization_code,
      authorization.last4,
      authorization.exp_month,
      authorization.exp_year,
      authorization.card_type,
      authorization.bank || "Unknown",
    ]
  );

  const cardCountResult = await db.query(
    "SELECT COUNT(*) as count FROM stored_cards WHERE organization_id = $1",
    [orgId]
  );

  if (cardCountResult.rows[0].count === "1") {
    await db.query(
      "UPDATE stored_cards SET is_primary = true WHERE organization_id = $1 AND authorization_code = $2",
      [orgId, authorization.authorization_code]
    );
  }
}

async function buildChargeResponse(db, orgId, chargeResult) {
  if (chargeResult?.status && chargeResult?.data?.authorization) {
    const authorization = chargeResult.data.authorization;
    await saveCardAuthorization(db, orgId, authorization);
    return {
      success: true,
      message: "Card added successfully",
      card: {
        authorization_code: authorization.authorization_code,
        last_four: authorization.last4,
        card_type: authorization.card_type,
        bank: authorization.bank,
      },
    };
  }

  const status = chargeResult?.data?.status;
  const stepMap = {
    send_pin: "pin",
    send_otp: "otp",
    send_phone: "phone",
    send_birthday: "birthday",
  };

  if (chargeResult?.status && status && stepMap[status]) {
    return {
      success: false,
      nextStep: stepMap[status],
      reference: chargeResult?.data?.reference,
      message:
        chargeResult?.data?.display_text ||
        chargeResult?.data?.message ||
        chargeResult?.message ||
        "Additional verification required.",
    };
  }

  return {
    success: false,
    message:
      chargeResult?.message ||
      chargeResult?.data?.message ||
      "Failed to add card. Please check your card details.",
  };
}
const accountController = {
  // Utility: List Paystack banks for UI dropdowns

  sendBrandedReceiptEmail,

  listPaystackBanks: async (req, res) => {
    try {
      const country = (req.query.country || "ghana").toLowerCase();
      const headers = {
        headers: { Authorization: `Bearer ${process.env.PAYSTACK_SECRET_KEY}` },
      };
      const response = await axios.get(
        `https://api.paystack.co/bank?country=${country}`,
        headers
      );
      return res.json({ success: true, banks: response.data?.data || [] });
    } catch (err) {
      console.error(
        "❌ Error listing Paystack banks:",
        err.response?.data || err.message
      );
      return res
        .status(500)
        .json({ success: false, message: "Failed to list banks" });
    }
  },

  servicePlanGet: async (req, res) => {
    try {
      // Optional reset for a fresh signup flow
      if (req.query.new) {
        delete req.session.registrationDetails;
        delete req.session.planSelection;
      }

      // If a plan is preselected via query, keep it for highlighting
      const preselectedPlanId = req.session.planSelection?.planId || req.query.plan || null;
      const trialRequested = parseTruthyFlag(
        req.session.planSelection?.trialRequested || req.query.trial
      );

      const url = req.url;

      const plansResult = await db.query(`

            SELECT p.id AS plan_id, p.plan_name, p.description, p.is_active, p.plan_name AS category,

            COALESCE(JSON_AGG(json_build_object('feature_name', f.feature_name) ORDER BY f.feature_name)

            FILTER (WHERE f.id IS NOT NULL), '[]') AS features,

            COALESCE(SUM(f.price_usd), 0) AS total_price

            FROM plans p

            LEFT JOIN plan_features pf ON p.id = pf.plan_id

            LEFT JOIN features f ON pf.feature_id = f.id

            WHERE p.is_active = TRUE

            GROUP BY p.id

            ORDER BY p.id;

            `);

      const plans = plansResult.rows.map((plan) => ({
        ...plan,

        total_price: parseFloat(plan.total_price) || 0, // Ensure total_price is a number
      }));

      // Defaults for trial/premium display on plan page
      const freeTrialEnabled = false;
      const freeTrialLengthLabel = null;
      const premiumPlanId = null;
      const premiumPlanName = null;
      const trialEligible = true;

      res.render("account/servicePlan", {
        title: "Choose Your Plan",

        plans,

        url,

        preselectedPlanId,
        preferredPlanId: preselectedPlanId,
        trialRequested,
        freeTrialEnabled,
        freeTrialLengthLabel,
        premiumPlanId,
        premiumPlanName,
        trialEligible,

        showFooterTopSection: true,
        messages: req.flash(),
      });
    } catch (error) {
      console.error("Error fetching service plans:", error);

      req.flash("error", "Failed to fetch service plans.");

      res.redirect("/account");
    }
  },

  servicePlanPost: async (req, res) => {
    const { plan, plan_id } = req.body;
    if (!plan || !plan_id) {
      req.flash("error", "Please select a plan.");

      return res.redirect("/account/service-plan");
    }
    // Fetch plan details from DB for price

    const planQuery = await db.query(
      "SELECT id, total_cost FROM plans WHERE plan_name = $1 AND id = $2",

      [plan, plan_id]
    );

    if (planQuery.rows.length === 0) {
      req.flash("error", "Invalid plan selected.");

      return res.redirect("/account/service-plan");
    }

    const totalCost = Number(planQuery.rows[0].total_cost);

    // Store the plan choice until registration is completed
    req.session.planSelection = {
      plan,
      planId: plan_id,
      totalCost,
      trialRequested: parseTruthyFlag(req.body.trialRequested),
    };

    req.flash("success", "Plan selected. Please complete registration.");

    return res.redirect("/account/register");
  },

  registerGet: async (req, res) => {
    // If ?new=1 is present, clear any previous registration session
    if (req.query.new) {
      delete req.session.registrationDetails;
      delete req.session.planSelection;
    }

    // Require a plan selection before showing the registration form
    if (!req.session.planSelection) {
      req.flash("info", "Please choose a plan to begin registration.");
      return res.redirect("/account/service-plan");
    }

    // Check for sticky form data and error in session
    const formData = req.session.formData || {};
    delete req.session.formData;
    const messages = req.session.formMessages || req.flash();
    delete req.session.formMessages;

    // Plan/trial info from selection
    const preferredPlanId = req.session.planSelection.planId || '';
    const preferredPlanName = req.session.planSelection.plan || '';
    const trialRequested = !!req.session.planSelection.trialRequested;

    res.render("account/register", {
      title: "Register Your Organization",
      showFooterTopSection: true,
      messages,
      formData,
      preferredPlanId,
      preferredPlanName,
      trialRequested,
    });
  },

  registerPost: async (req, res) => {
    try {
      const planSelection = req.session.planSelection;

      if (!planSelection) {
        req.flash("error", "Please select a plan before registering.");
        return res.redirect("/account/service-plan");
      }
      const {
        firstName,

        lastName,

        email,

        password,

        confirmPassword,

        orgName,

        orgNickName,

        orgAddress,

        orgPhone,
      } = req.body;

      const { trialRequested = false, plan, planId, totalCost } = planSelection;

      const proof1 = req.files?.proof1?.[0] || null;

      const proof2 = req.files?.proof2?.[0] || null;

      // Preserve all form data including password fields for re-render

      const formData = {
        firstName,

        lastName,

        email,

        password,

        confirmPassword,

        orgName,

        orgNickName,

        orgAddress,

        orgPhone,

        confirmEmail: req.body.confirmEmail,
      };

      // Helper: on error, store formData/messages in session and redirect

      function stickyError(message) {
        req.session.formData = formData;

        req.session.formMessages = { error: [message] };

        return res.redirect("/account/register");
      }

      // Required fields check

      if (
        !firstName ||
        !lastName ||
        !email ||
        !password ||
        !confirmPassword ||
        !orgName ||
        !orgNickName ||
        !orgAddress ||
        !orgPhone
      ) {
        return stickyError("All fields are required.");
      }

      // Passwords match check

      if (password !== confirmPassword) {
        return stickyError("Passwords do not match.");
      }

      // Nickname validation: 3-15 lowercase letters only

      const nicknamePattern = /^[a-z]{3,15}$/;

      if (!nicknamePattern.test(orgNickName)) {
        return stickyError(
          "Organization nickname must be 3-15 lowercase letters (no spaces or special characters)."
        );
      }

      // Check if email already exists

      const emailCheckQuery = `

        SELECT email FROM users WHERE LOWER(email) = LOWER($1)

        UNION

        SELECT email FROM organizations WHERE LOWER(email) = LOWER($1)

      `;

      const emailCheckResult = await db.query(emailCheckQuery, [email]);

      if (emailCheckResult.rows.length > 0) {
        return stickyError(
          "This email address is already in use. Please use a different email."
        );
      }

      // Confirm email match check

      if (email !== req.body.confirmEmail) {
        return stickyError("Email and confirm email do not match.");
      }

      // Proof of existence validation

      if (!proof1) {
        return stickyError("Proof of existence is required.");
      }

      // Password security check

      const passwordRegex =
        /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[!@#$%^&*]).{6,}$/;

      if (!passwordRegex.test(password)) {
        return stickyError("Password must meet security standards.");
      }

      const hashedPassword = await bcryptjs.hash(password, 10);

      const wantsTrial = parseTruthyFlag(trialRequested);

      if (wantsTrial) {
        const { enabled: trialEnabled } = await getFreeTrialSettings(db);

        if (!trialEnabled) {
          return stickyError(
            "Free trials are currently unavailable. Please continue with a paid plan."
          );
        }

        const alreadyUsed = await hasEmailLockedTrial(email, db);

        if (alreadyUsed) {
          return stickyError(
            "This email has already redeemed a free trial. Please choose a paid plan to continue."
          );
        }
      }

      // Upload proofs to S3 after validations; ensure cleanup on errors
      let proof1Url = "";
      let proof2Url = "";
      try {
        proof1Url = await uploadToS3(proof1);
        proof2Url = proof2 ? await uploadToS3(proof2) : "";
      } catch (uploadErr) {
        console.error("❌ Error uploading proofs:", uploadErr);
        return stickyError("Unable to upload proof documents. Please retry.");
      }

      // Save registration details in session with selected plan

      req.session.registrationDetails = {
        firstName,

        lastName,

        email,

        passwordHash: hashedPassword,

        orgName,

        orgNickName,

        orgAddress,

        orgPhone,

        proof1Url,

        proof2Url,

        plan,

        planId: Number(planId),

        totalCost,

        trialRequested: wantsTrial,
      };

      delete req.session.planSelection;

      req.flash("success", "Registration details saved. Proceed to payment.");

      delete req.session.formData;
      delete req.session.formMessages;
      return res.redirect("/account/payment");
    } catch (error) {
      console.error("❌ Error during registration:", error);

      // Attempt cleanup of uploaded proofs if present
      if (typeof proof1Url !== "undefined" && proof1Url) {
        try {
          await deleteFromS3(proof1Url);
        } catch (cleanupErr) {
          console.error("⚠️ Failed to clean up proof1:", cleanupErr.message);
        }
      }
      if (typeof proof2Url !== "undefined" && proof2Url) {
        try {
          await deleteFromS3(proof2Url);
        } catch (cleanupErr) {
          console.error("⚠️ Failed to clean up proof2:", cleanupErr.message);
        }
      }

      req.session.formData = req.body;

      req.session.formMessages = {
        error: ["Registration failed. Please try again."],
      };

      return res.redirect("/account/register");
    }
  },

  paymentGet: async (req, res) => {
    const registrationDetails = req.session.registrationDetails;

    // Only allow access if registration and plan selection are complete

    if (
      !registrationDetails ||
      !registrationDetails.plan ||
      !registrationDetails.planId
    ) {
      req.flash(
        "error",

        "Please complete registration and select a plan before proceeding to payment."
      );

      return res.redirect("/account/register");
    }

    const decodedPlan = decodeURIComponent(registrationDetails.plan);

    try {
      const planResult = await db.query(
        `SELECT p.total_cost AS total_price

                 FROM plans p

                 WHERE p.plan_name = $1 AND p.is_active = TRUE`,

        [decodedPlan]
      );

      if (planResult.rows.length === 0) {
        req.flash(
          "error",

          "Selected plan not found or inactive. Please try again."
        );

        return res.redirect("/account/login");
      }

      // Fetch billing interval, free trial days, and free trial enabled from app_settings
      let billingInterval = "monthly";
      let freeTrialDays = null;
      let freeTrialEnabled = "false";
      let freeTrialLengthLabel = null;
      let billingIntervalLabel = null;
      let postTrialPriceDisplay = null;
      let isTrialCheckout = false;
      try {
        const intervalResult = await db.query(
          "SELECT value FROM app_settings WHERE key = 'billing_interval'"
        );
        if (intervalResult.rows.length > 0)
          billingInterval = intervalResult.rows[0].value;
        const trialResult = await db.query(
          "SELECT value FROM app_settings WHERE key = 'free_trial_days'"
        );
        if (trialResult.rows.length > 0)
          freeTrialDays = trialResult.rows[0].value;
        const enabledResult = await db.query(
          "SELECT value FROM app_settings WHERE key = 'free_trial_enabled'"
        );
        if (enabledResult.rows.length > 0)
          freeTrialEnabled = enabledResult.rows[0].value;
      } catch (err) {
        console.error(
          "Error fetching interval/trial/enabled for payment page:",
          err
        );
      }

      // Labels for UI
      billingIntervalLabel = billingInterval;
      if (freeTrialDays) {
        freeTrialLengthLabel =
          freeTrialDays === "5_minutes"
            ? "5 minutes"
            : `${freeTrialDays} day${parseInt(freeTrialDays) === 1 ? "" : "s"}`;
      }

      // Calculate amount based on free trial settings
      const planPrice = Number(planResult.rows[0].total_price) || 0;
      let amountDue = Math.round(planPrice * 100); // Default to normal amount

      let isTrialActive = false;

      let trialActiveUntil = null;
      if (freeTrialEnabled === "true" && freeTrialDays) {
        amountDue = 100; // 1 cedi in pesewas for validation

        trialActiveUntil = new Date();
        if (freeTrialDays === "5_minutes") {
          trialActiveUntil.setMinutes(trialActiveUntil.getMinutes() + 5);
        } else {
          const days = parseInt(freeTrialDays);
          if (days > 0) {
            trialActiveUntil.setDate(trialActiveUntil.getDate() + days);
          }
        }

        isTrialCheckout = true;
      } else {
        // If not free trial, check if org has a trial period (legacy logic)

        let orgId = req.session.organizationId;

        if (orgId) {
          const orgResult = await db.query(
            "SELECT trial_active_until FROM organizations WHERE organization_id = $1",
            [orgId]
          );
          if (
            orgResult.rows.length > 0 &&
            orgResult.rows[0].trial_active_until
          ) {
            trialActiveUntil = new Date(orgResult.rows[0].trial_active_until);

            const now = new Date();

            if (trialActiveUntil > now) {
              isTrialActive = true;

              amountDue = 100; // 1 cedi in pesewas
            }
          }
        }
      }

      const intervalLabel = billingInterval === "yearly" ? "per year" : "per month";
      postTrialPriceDisplay = `₵${planPrice.toFixed(2)} ${intervalLabel}`;

      const trialEndDisplay =
        trialActiveUntil instanceof Date
          ? trialActiveUntil.toLocaleString("en-US", {
              weekday: "long",

              month: "long",

              day: "numeric",

              year: "numeric",

              hour: "numeric",

              minute: "2-digit",

              timeZoneName: "short",
            })
          : null;

      // Generate a unique reference for this payment
      const paymentReference = `pay_${Date.now()}_${Math.random()
        .toString(36)
        .substr(2, 9)}`;

      // Store payment reference in session for verification

      req.session.paymentReference = paymentReference;

      res.render("account/payment", {
        title: "Complete Payment",

        registrationDetails,

        paymentDetails: { amount: amountDue },

        paymentReference: paymentReference,

        publishableKey: process.env.PAYSTACK_PUBLIC_KEY,

        orgEmail: orgRow.email || "",
        orgPhone: orgRow.organization_phone || "",
        showFooterTopSection: true,
        messages: req.flash(),

        promoCode: "", // Include promo code field

        billingInterval,

        freeTrialDays,

        isTrialActive,

        trialActiveUntil,

        freeTrialEnabled,

        billingIntervalLabel,

        freeTrialLengthLabel,

        trialEndDisplay,

        postTrialPriceDisplay,

        isTrialCheckout,

        // layout: false // Use default layout for header and footer
      });
    } catch (error) {
      console.error("Error initializing payment:", error);

      req.flash("error", "Unable to initialize payment. Please try again.");

      return res.redirect("/account/login");
    }
  },

  paymentPost: async (req, res) => {
    const { registrationDetails } = req.session;

    const { paymentReference, promoCode } = req.body;

    if (!paymentReference) {
      req.flash("error", "Payment reference is missing. Please try again.");

      return res.redirect("/account/payment");
    }

    if (!registrationDetails) {
      req.flash(
        "error",

        "No registration details found. Please register again."
      );

      return res.redirect("/account/login");
    }

    try {
      // Verify payment with Paystack

      const verificationResponse = await axios.get(
        `https://api.paystack.co/transaction/verify/${paymentReference}`,

        {
          headers: {
            Authorization: `Bearer ${process.env.PAYSTACK_SECRET_KEY}`,
          },
        }
      );

      const { data } = verificationResponse.data;

      if (!data || data.status !== "success") {
        req.flash("error", "Payment verification failed. Please try again.");

        return res.redirect("/account/payment");
      }

      const {
        email,

        orgName,

        orgNickName,

        totalCost,

        planId,

        passwordHash,

        firstName,

        lastName,

        orgAddress,

        orgPhone,

        proof1Url,

        proof2Url,
      } = registrationDetails;

      let discountAmount = 0;

      let applyDiscountOnce = false;

      // ✅ Check Promo Code Validity (only if a code is entered)
      const promoCodeStr =
        typeof promoCode === "string" ? promoCode.trim() : "";
      if (promoCodeStr !== "") {
        const promoResult = await db.query(
          `SELECT discount_percentage, applies_once FROM promo_codes 

                     WHERE UPPER(code) = UPPER($1) AND is_active = TRUE AND expiration_date > NOW()`,

          [promoCodeStr]
        );

        if (promoResult.rows.length === 0) {
          req.flash("error", "Invalid or expired promo code.");

          return res.redirect("/account/payment");
        }

        discountAmount = promoResult.rows[0].discount_percentage;

        applyDiscountOnce = promoResult.rows[0].applies_once;
      }

      // ✅ Apply Discount to First Payment Only

      let finalAmount = Number(totalCost) || 0;

      if (discountAmount > 0) {
        finalAmount = finalAmount - finalAmount * (discountAmount / 100);
      }

      let amountDue = Math.round(finalAmount * 100); // Convert to pesewas

      // ✅ Create Paystack Customer

      const customerResponse = await axios.post(
        "https://api.paystack.co/customer",

        {
          email: email,

          first_name: firstName,

          last_name: lastName,

          phone: orgPhone,
        },

        {
          headers: {
            Authorization: `Bearer ${process.env.PAYSTACK_SECRET_KEY}`,

            "Content-Type": "application/json",
          },
        }
      );

      const customerCode = customerResponse.data.data.customer_code;

      // Fetch global billing interval and free trial settings

      let billingInterval = "monthly";

      let freeTrialDays = null;

      let freeTrialEnabled = false;

      try {
        const intervalResult = await db.query(
          "SELECT value FROM app_settings WHERE key = 'billing_interval'"
        );
        if (intervalResult.rows.length > 0)
          billingInterval = intervalResult.rows[0].value;
        const enabledResult = await db.query(
          "SELECT value FROM app_settings WHERE key = 'free_trial_enabled'"
        );
        if (enabledResult.rows.length > 0)
          freeTrialEnabled = enabledResult.rows[0].value;
        const daysResult = await db.query(
          "SELECT value FROM app_settings WHERE key = 'free_trial_days'"
        );
        if (daysResult.rows.length > 0)
          freeTrialDays = daysResult.rows[0].value;
      } catch (err) {
        console.error("Error fetching billing/trial settings:", err);
      }

      const isTrialCheckout =
        freeTrialEnabled &&
        !!registrationDetails.trialRequested &&
        !!freeTrialDays;

      if (isTrialCheckout) {
        amountDue = 100; // Minimal validation charge for trial
      }

      // Calculate trial end date if free trial is enabled

      let trialActiveUntil = null;
      if (freeTrialEnabled === "true" && freeTrialDays) {
        trialActiveUntil = new Date();
        if (freeTrialDays === "5_minutes") {
          trialActiveUntil.setMinutes(trialActiveUntil.getMinutes() + 5);
          console.log(
            "🎯 TRIAL DEBUG: 5-minute trial set, ends at:",
            trialActiveUntil
          );
        } else {
          const days = parseInt(freeTrialDays);
          if (days > 0) {
            trialActiveUntil.setDate(trialActiveUntil.getDate() + days);
            console.log(
              "🎯 TRIAL DEBUG: " + days + "-day trial set, ends at:",
              trialActiveUntil
            );
          }
        }
      } else {
        console.log("🎯 TRIAL DEBUG: No trial enabled or invalid settings");
      }

      // Only create Paystack plan/subscription if not on free trial

      let paystackPlanCode = null;

      let subscriptionCode = null;
      if (freeTrialEnabled !== "true") {
        // ✅ Create Paystack Plan for subscription using global interval

        const planResponse = await axios.post(
          "https://api.paystack.co/plan",

          {
            name: `${orgName} - ${registrationDetails.plan}`,

            amount: amountDue,

            interval: billingInterval,

            currency: "GHS",
          },

          {
            headers: {
              Authorization: `Bearer ${process.env.PAYSTACK_SECRET_KEY}`,

              "Content-Type": "application/json",
            },
          }
        );

        paystackPlanCode = planResponse.data.data.plan_code;

        // ✅ Create Subscription

        const subscriptionResponse = await axios.post(
          "https://api.paystack.co/subscription",

          {
            customer: customerCode,

            plan: paystackPlanCode,

            authorization: data.authorization.authorization_code,
          },

          {
            headers: {
              Authorization: `Bearer ${process.env.PAYSTACK_SECRET_KEY}`,

              "Content-Type": "application/json",
            },
          }
        );

        subscriptionCode = subscriptionResponse.data.data.subscription_code;
      }

      // ✅ Store Organization and Payment in Database

      const client = await db.connect();

      await client.query("BEGIN");

      const orgResult = await client.query(
        `INSERT INTO organizations (organization_name, nickname, organization_address, organization_phone, email, password, first_name, last_name, proof_of_existence_1, proof_of_existence_2, plan_id, paystack_customer_code, trial_active_until)

                 VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13) RETURNING organization_id`,

        [
          orgName,

          orgNickName,

          orgAddress,

          orgPhone,

          email,

          passwordHash,

          firstName,

          lastName,

          proof1Url,

          proof2Url,

          planId,

          customerCode,

          trialActiveUntil,
        ]
      );

      const organization_id = orgResult.rows[0].organization_id;

      // ✅ Store payment record

      const nextPaymentEndDate = (() => {
        // If we have a trial period AND we're charging the $1 validation amount, use trial end date

        if (trialActiveUntil && data.amount <= 100) {
          console.log(
            "🎯 Trial payment detected - Setting next payment to trial end date:",
            trialActiveUntil
          );
          return new Date(trialActiveUntil);
        }

        // If we have trial period but charging full amount, still respect trial (shouldn't happen but safety check)

        if (trialActiveUntil) {
          console.log(
            "🎯 Trial active - Setting next payment to trial end date:",
            trialActiveUntil
          );
          return new Date(trialActiveUntil);
        }

        // No trial - use normal billing interval

        const d = new Date();
        console.log("📅 No trial - Using billing interval:", billingInterval);
        switch (billingInterval) {
          case "5_minutes":
            d.setMinutes(d.getMinutes() + 5);

            break;
          case "daily":
            d.setDate(d.getDate() + 1);

            break;
          case "weekly":
            d.setDate(d.getDate() + 7);

            break;
          case "monthly":
            d.setMonth(d.getMonth() + 1);

            break;
          case "yearly":
            d.setFullYear(d.getFullYear() + 1);

            break;
          case "2_years":
            d.setFullYear(d.getFullYear() + 2);

            break;
          case "3_years":
            d.setFullYear(d.getFullYear() + 3);

            break;

          default:
            d.setMonth(d.getMonth() + 1);
        }

        return d;
      })();

      console.log("💾 PAYMENT DEBUG: About to save payment with:");
      console.log("   Amount paid:", data.amount / 100);
      console.log("   Is trial:", trialActiveUntil ? true : false);
      console.log("   Trial ends at:", trialActiveUntil);
      console.log("   Next payment end date:", nextPaymentEndDate);

      await client.query(
        `INSERT INTO payments (organization_id, paystack_subscription_code, paystack_reference, amount_paid, status, discount_applied, applies_once, is_trial, trial_ends_at, next_payment_end_date)

                 VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,

        [
          organization_id,

          subscriptionCode,

          paymentReference,

          data.amount / 100, // Convert from pesewas to GHS

          "active",

          discountAmount > 0 ? `${discountAmount}%` : null,

          applyDiscountOnce,

          trialActiveUntil ? true : false,

          trialActiveUntil || null,

          nextPaymentEndDate,
        ]
      );

      // ✅ Store the card authorization for future use

      const authCode = data.authorization.authorization_code;

      const cardData = data.authorization;

      await client.query(
        `INSERT INTO stored_cards (organization_id, authorization_code, card_type, last4, exp_month, exp_year, bin, bank, channel, signature, reusable, country_code, is_primary, is_active)

         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)`,

        [
          organization_id,

          authCode,

          cardData.card_type,

          cardData.last4,

          cardData.exp_month,

          cardData.exp_year,

          cardData.bin,

          cardData.bank,

          cardData.channel,

          cardData.signature,

          cardData.reusable,

          cardData.country_code,

          true, // First card is primary
          true, // Card is active
        ]
      );

      await client.query("COMMIT");

      // Send registration success email (bypass error)

      try {
        await sendRegistrationSuccessEmail(
          email,

          firstName,

          lastName
        );
      } catch (emailErr) {
        console.error("[WARN] Registration email failed:", emailErr.message);
      }

      // Send receipt email (bypass error)

      try {
        await sendReceiptEmail(
          email,
          {
            amount: data.amount,
            paymentReference: paymentReference,
          },
          orgName
        );
      } catch (receiptErr) {
        console.error("[WARN] Receipt email failed:", receiptErr.message);
      }

      req.session.registrationDetails = null;

      req.session.paymentReference = null;

      let message = "";

      if (discountAmount > 0) {
        message += `Discount applied successfully. You will be charged ₵${finalAmount} per month. `;
      }
      message +=
        "Registration and payment successful! Your subscription is now active and your card has been saved for future payments. You may now log in to your account.";
      req.flash("success", message);

      req.session.save(() => {
        res.redirect("/account/login");
      });
    } catch (error) {
      console.error("❌ Error Processing Paystack Payment:", error);

      if (error.response) {
        console.error("Paystack API Error:", error.response.data);
      }
      req.flash(
        "error",
        "An error occurred processing your payment. Please try again."
      );
      return res.redirect("/account/payment");
    }
  },

  validatePromoGet: async (req, res) => {
    const { code } = req.query;

    if (!code) {
      return res.json({ success: false, message: "Promo code is required." });
    }

    if (!db || !db.query) {
      console.error("🚨 Database connection is not initialized.");

      return res.json({
        success: false,

        message: "Database connection error.",
      });
    }

    try {
      const html = `

  <div style="background:#f4fbfa;padding:40px 0;">

            <div style="max-width:600px;margin:40px auto;background:#fff;border-radius:16px;box-shadow:0 4px 24px #b2e2d6;overflow:hidden;font-family:'Segoe UI',Arial,sans-serif;">

            <div style="background:#6fd3c4;padding:24px 0 24px 32px;display:flex;align-items:center;">

              <img src="cid:managira_logo" alt="Managira Logo" style="height:60px;display:block;">

            </div>

            <div style="padding:36px 32px 32px 32px;">

              <div style="color:#6fd3c4;font-size:28px;font-weight:600;margin-bottom:16px;letter-spacing:1px;">Welcome to Managira!</div>

              <p style="font-size:17px;line-height:1.6;margin-bottom:18px;">Hi <b>${firstName} ${lastName}</b>,</p>

              <p style="font-size:16px;line-height:1.6;margin-bottom:18px;">Your organization account has been <b style='color:#1ca34a;'>successfully registered</b> and is now active.</p>

              <p style="font-size:16px;line-height:1.6;margin-bottom:18px;">You can now log in and start using all the features of <span style='color:#1ca34a;font-weight:500;'>Managira</span>.</p>

              <div style="margin-top:32px;margin-bottom:18px;">

                <a href="https://www.managira.com/login" style="background:#6fd3c4;color:#fff;padding:12px 32px;border-radius:6px;text-decoration:none;font-size:16px;font-weight:600;box-shadow:0 2px 8px #b2e2d6;">Log In to Your Account</a>

              </div>

              <p style="margin-top:18px;font-size:15px;">If you have any questions, please visit our <a href="https://www.managira.com/legal/help" target="_blank" rel="noopener" style="color:#1ca34a;font-weight:500;">Help Center</a> or <a href="https://www.managira.com/legal/faq" target="_blank" rel="noopener" style="color:#1ca34a;font-weight:500;">FAQ page</a>.</p>

              <p style="color:#b80000;font-size:16px;font-weight:bold;margin-top:32px;text-align:center;letter-spacing:1px;">THIS IS A NO-REPLY MESSAGE. PLEASE DO NOT REPLY TO THIS EMAIL.</p>

            </div>

            <div style="background:#e6f7ec;color:#888;text-align:center;padding:18px 0;font-size:13px;">&copy; ${new Date().getFullYear()} Managira. All rights reserved.</div>

          </div>

        </div>

      `;

      const discount = result.rows[0].discount_percentage;

      return res.json({ success: true, discount });
    } catch (error) {
      console.error("❌ Database error while validating promo code:", error);

      res.json({ success: false, message: "Error validating promo code." });
    }
  },

  paystackWebhookPost: async (req, res) => {
    try {
      const hash = crypto
        .createHmac("sha512", process.env.PAYSTACK_WEBHOOK_SECRET)
        .update(JSON.stringify(req.body))
        .digest("hex");

      if (hash !== req.headers["x-paystack-signature"]) {
        console.error("⚠️ Paystack webhook signature verification failed.");
        return res.status(400).send("Webhook signature verification failed");
      }

      const event = req.body;

      console.log("✅ Paystack webhook received:", event.event);

      switch (event.event) {
        case "subscription.create": {
          const subscription = event.data;
          console.log(
            "✅ Subscription created:",
            subscription.subscription_code
          );
          // Subscription creation is handled in the payment flow

          break;
        }

        case "invoice.payment_failed": {
          const invoice = event.data;

          const customerCode = invoice.customer?.customer_code;

          if (customerCode) {
            // Find organization and email by customer code

            const orgResult = await db.query(
              "SELECT organization_id, organization_name, email, first_name, last_name FROM organizations WHERE paystack_customer_code = $1",

              [customerCode]
            );

            if (orgResult.rows.length > 0) {
              const {
                organization_id,
                organization_name,
                email,
                first_name,
                last_name,
              } = orgResult.rows[0];
              // Update payment record

              await db.query(
                "UPDATE payments SET status = 'active', amount_paid = $1, last_payment_date = NOW() WHERE organization_id = $2",

                [invoice.amount / 100, organization_id]
              );

              // Send branded receipt email

              await sendBrandedReceiptEmail({
                to: email,

                name: organization_name,

                amount: (invoice.amount / 100).toFixed(2),
                reference: invoice.reference || invoice.invoice_code || "",
                organization: organization_name,

                email,
                date: new Date().toLocaleDateString(),
              });

              // Send decorated registration success email to user

              try {
                await sendRegistrationSuccessEmail(
                  email,
                  first_name || "",
                  last_name || ""
                );
              } catch (emailErr) {
                console.error(
                  "[WARN] Registration email failed:",
                  emailErr.message
                );
              }
            }
          }

          break;
        }

        case "subscription.disable": {
          const subscription = event.data;

          const customerCode = subscription.customer?.customer_code;

          if (customerCode) {
            // Find and disable organization

            const orgResult = await db.query(
              "SELECT organization_id, organization_name FROM organizations WHERE paystack_customer_code = $1",

              [customerCode]
            );

            if (orgResult.rows.length > 0) {
              const { organization_id, organization_name } = orgResult.rows[0];

              await db.query(
                "UPDATE organizations SET on_hold = true WHERE organization_id = $1",

                [organization_id]
              );

              await db.query(
                "UPDATE payments SET status = 'cancelled' WHERE organization_id = $1",

                [organization_id]
              );

              // ✅ CRITICAL FIX: Deactivate all stored cards to prevent future charges
              await db.query(
                "UPDATE stored_cards SET is_active = false WHERE organization_id = $1",

                [organization_id]
              );

              console.log(
                `🔴 Subscription disabled for organization: ${organization_name}`
              );
              console.log(
                `🔴 All payment cards deactivated for organization: ${organization_name}`
              );
            }
          }

          break;
        }
      }

      res.json({ received: true });
    } catch (error) {
      console.error("❌ Paystack webhook processing error:", error);

      res.status(500).send("Webhook processing error");
    }
  },

  webhookPost: async (req, res) => {
    const sig = req.headers["stripe-signature"];

    let event;

    try {
      event = stripe.webhooks.constructEvent(
        req.body,

        sig,

        process.env.STRIPE_WEBHOOK_SECRET
      );
    } catch (err) {
      console.error("⚠️ Webhook signature verification failed.", err.message);

      return res.status(400).send(`Webhook Error: ${err.message}`);
    }

    try {
      switch (event.type) {
        case "invoice.created": {
          const invoice = event.data.object;

          const {
            customer,

            hosted_invoice_url,

            due_date,

            amount_due,

            id: invoiceId,

            subscription,
          } = invoice;

          // ✅ Retrieve the organization associated with this customer

          const orgResult = await db.query(
            "SELECT email, organization_name, plan_id FROM organizations WHERE stripe_customer_id = $1",

            [customer]
          );

          if (orgResult.rows.length > 0) {
            const { email, organization_name, plan_id } = orgResult.rows[0];

            // ✅ Fetch the latest total_cost from the plans table

            const planResult = await db.query(
              "SELECT total_cost FROM plans WHERE id = $1",

              [plan_id]
            );

            if (planResult.rows.length > 0) {
              const newAmount = Math.round(planResult.rows[0].total_cost * 100); // Convert to cents

              // ✅ Temporarily stop auto-advancing invoice

              await stripe.invoices.update(invoiceId, { auto_advance: false });

              // ✅ Update invoice with the latest plan price

              await stripe.invoiceItems.create({
                customer,

                amount: newAmount,

                currency: "ghs",

                invoice: invoiceId,
              });

              // ✅ Finalize the invoice with the updated price

              await stripe.invoices.finalizeInvoice(invoiceId);
            }

            // ✅ Send Invoice Email

            await sendInvoiceEmail(email, organization_name, {
              hosted_invoice_url,

              due_date,

              amount_due,
            });
          }

          break;
        }

        case "invoice.payment_succeeded": {
          const invoice = event.data.object;

          const { customer, amount_paid, subscription } = invoice;

          // ✅ Confirm the subscription remains active

          await stripe.subscriptions.update(subscription, {
            cancel_at_period_end: false, // Ensure it renews
          });

          // ✅ Update database

          await db.query(
            "UPDATE payments SET status = 'paid', amount_paid = $1, last_payment_date = NOW() WHERE stripe_subscription_id = $2",

            [amount_paid, subscription]
          );

          break;
        }

        case "invoice.payment_failed": {
          const invoice = event.data.object;

          const { customer, subscription } = invoice;

          // ✅ Retrieve organization details

          const orgResult = await db.query(
            "SELECT email, organization_id FROM organizations WHERE stripe_customer_id = $1",

            [customer]
          );

          if (orgResult.rows.length > 0) {
            const { email, organization_id } = orgResult.rows[0];

            // ✅ Send payment failure email

            await sendPaymentFailureEmail(email);

            await sendPaymentFailureEmail(process.env.ADMIN_EMAIL);

            // ✅ Track failed attempts

            await db.query(
              "UPDATE payments SET failed_attempts = failed_attempts + 1, last_failed_payment = NOW() WHERE stripe_subscription_id = $1",

              [subscription]
            );

            // ✅ Check if failed attempts exceed 15 days

            const failureCheck = await db.query(
              "SELECT last_failed_payment FROM payments WHERE stripe_subscription_id = $1",

              [subscription]
            );

            const lastFailedPayment = failureCheck.rows[0]?.last_failed_payment;

            if (lastFailedPayment) {
              const now = new Date();

              const lastFailedDate = new Date(lastFailedPayment);

              const differenceInDays =
                (now - lastFailedDate) / (1000 * 60 * 60 * 24);

              if (differenceInDays >= 15) {
                // ✅ Deactivate the account after 15 days

                await db.query(
                  "UPDATE organizations SET on_hold = true WHERE organization_id = $1",

                  [organization_id]
                );
              }
            }
          }

          break;
        }

        case "customer.subscription.deleted": {
          const subscription = event.data.object;

          const { customer } = subscription;

          await db.query(
            "UPDATE organizations SET on_hold = true WHERE stripe_customer_id = $1",

            [customer]
          );

          const orgResult = await db.query(
            "SELECT email, organization_name FROM organizations WHERE stripe_customer_id = $1",

            [customer]
          );

          if (orgResult.rows.length > 0) {
            const { email, organization_name } = orgResult.rows[0];

            await sendCancellationEmail(organization_name, "Customer", email);
          }

          break;
        }
      }
    } catch (error) {
      console.error("❌ Webhook processing error:", error);

      return res.status(500).send("Webhook processing error");
    }

    res.json({ received: true });
  },

  processSuccessfulPayment: async (
    req,

    res,

    paymentIntent,

    registrationDetails,

    trialActiveUntil = null
  ) => {
    const client = await db.connect();

    await client.query("BEGIN");

    try {
      const hashedPassword =
        registrationDetails.passwordHash ||
        (registrationDetails.password
          ? await bcryptjs.hash(registrationDetails.password, 10)
          : null);

      // **Insert Organization with Plan ID and Trial Information**

      const result = await client.query(
        `INSERT INTO organizations 

                 (organization_name, nickname, organization_address, organization_phone, email, password, 

                  first_name, last_name, proof_of_existence_1, proof_of_existence_2, plan_id, trial_active_until) 

                 VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12) RETURNING organization_id`,

        [
          registrationDetails.orgName,

          registrationDetails.orgNickName,

          registrationDetails.orgAddress,

          registrationDetails.orgPhone,

          registrationDetails.email,

          hashedPassword,

          registrationDetails.firstName,

          registrationDetails.lastName,

          registrationDetails.proof1Url,

          registrationDetails.proof2Url,

          registrationDetails.planId, // ✅ Store the plan ID

          trialActiveUntil, // ✅ Store trial end date
        ]
      );

      const organization_id = result.rows[0].organization_id;

      let customerId = paymentIntent.customer;

      // **Create Stripe Customer if not already created**

      if (!customerId) {
        const customer = await stripe.customers.create({
          email: registrationDetails.email,

          name: registrationDetails.orgName,
        });

        customerId = customer.id;
      }

      // **Update Organization with Stripe Customer ID**

      await client.query(
        "UPDATE organizations SET stripe_customer_id = $1 WHERE organization_id = $2",

        [customerId, organization_id]
      );

      await client.query("COMMIT");

      // **Send Registration Success Email**

      await sendRegistrationSuccessEmail(
        registrationDetails.email,

        registrationDetails.firstName,

        registrationDetails.lastName
      );

      req.session.registrationDetails = null;

      req.flash("success", "Registration and payment successful!");

      res.redirect("/account/login");
    } catch (error) {
      await client.query("ROLLBACK");

      console.error("Error during successful payment processing:", error);

      req.flash("error", "An error occurred. Please try again.");

      res.redirect("/account/payment");
    }
  },

  paymentConfirmPost: async (req, res) => {
    const { registrationDetails, paymentIntentId } = req.session;

    if (!registrationDetails || !paymentIntentId) {
      req.flash("error", "No payment session found. Please try again.");

      return res.redirect("/account/payment");
    }

    try {
      // Confirm the payment using the existing intent

      const paymentIntent = await stripe.paymentIntents.confirm(
        paymentIntentId
      );

      if (paymentIntent.status !== "succeeded") {
        req.flash(
          "error",

          `Payment confirmation failed: ${
            paymentIntent.last_payment_error?.message || "Unknown error"
          }`
        );

        return res.redirect("/account/payment");
      }

      // If successful, process the payment (continue with similar steps from paymentPost)

      await accountController.processSuccessfulPayment(
        paymentIntent,

        registrationDetails,

        res
      );
    } catch (error) {
      console.error("Error confirming payment:", error);

      req.flash("error", "An error occurred while confirming the payment.");

      return res.redirect("/account/payment");
    }
  },

  updateCardGet: async (req, res) => {
    try {
      if (!req.session.passwordVerified) {
        return res.redirect(
          "/account/confirm-password?redirect=/account/update-card"
        );
      }

      const orgId = req.session.organizationId;

      // Fetch Paystack customer and Flutterwave data

      const orgResult = await db.query(
        `SELECT paystack_customer_code, email, organization_phone, organization_name, first_name, last_name
         FROM organizations
         WHERE organization_id = $1`,
        [orgId]
      );

      const orgRow = orgResult.rows[0] || {};
      let paystackCustomerCode = orgRow.paystack_customer_code;

      if (!paystackCustomerCode) {
        try {
          const customerData = {
            email: orgRow.email,
            first_name: orgRow.first_name || orgRow.organization_name || "Organization",
            last_name: orgRow.last_name || "Account",
          };

          const customerResponse = await axios.post(
            "https://api.paystack.co/customer",
            customerData,
            {
              headers: {
                Authorization: `Bearer ${process.env.PAYSTACK_SECRET_KEY}`,
                "Content-Type": "application/json",
              },
            }
          );

          paystackCustomerCode = customerResponse.data.data.customer_code;

          await db.query(
            "UPDATE organizations SET paystack_customer_code = $1 WHERE organization_id = $2",
            [paystackCustomerCode, orgId]
          );
        } catch (error) {
          console.error("Error creating Paystack customer:", error?.message || error);
          req.flash("error", "Paystack customer not found.");
          return res.redirect("/account/update");
        }
      }

      // ✅ Fetch all saved Paystack cards (payment methods)

      let paymentMethods = [];

      let defaultPaymentMethod = null;

      try {
        const customerResponse = await axios.get(
          `https://api.paystack.co/customer/${paystackCustomerCode}`,

          {
            headers: {
              Authorization: `Bearer ${process.env.PAYSTACK_SECRET_KEY}`,
            },
          }
        );

        const customer = customerResponse.data.data;

        // Get saved cards from Paystack customer

        if (customer.authorizations && customer.authorizations.length > 0) {
          paymentMethods = customer.authorizations
            .filter((auth) => auth.channel === "card" && auth.reusable)
            .map((auth) => ({
              id: auth.authorization_code,

              brand: auth.brand,

              last4: auth.last4,

              expMonth: auth.exp_month,

              expYear: auth.exp_year,

              email: auth.email,
            }));

          // The first reusable authorization is usually the default

          defaultPaymentMethod = paymentMethods[0] || null;
        }
      } catch (paystackError) {
        console.error(
          "❌ Error fetching Paystack customer:",
          paystackError.message
        );
        // Continue with empty payment methods if API fails
      }

      // ✅ Fetch all Paystack subaccounts

      const paystackSubaccountsResult = await db.query(
        `SELECT * FROM paystack_subaccounts 

         WHERE organization_id = $1

         ORDER BY account_type, is_primary DESC, created_at`,

        [orgId]
      );

      const paystackSubaccounts = paystackSubaccountsResult.rows;

      // ✅ Render the page

      res.render("account/updateCard", {
        title: "Update Payment Method",

        needsPassword: false,

        publishableKey: process.env.PAYSTACK_PUBLIC_KEY,

        orgEmail: orgRow.email || "",
        orgPhone: orgRow.organization_phone || "",
        paystackCustomerCode,

        defaultPaymentMethod,

        paymentMethods,

        paystackSubaccounts,

        messages: req.flash(),
      });
    } catch (error) {
      console.error("❌ Error loading update card page:", error);

      req.flash("error", "Failed to load payment settings.");

      res.redirect("/account/update");
    }
  },

  addCardPost: async (req, res) => {
    try {
      // For Paystack, cards are automatically saved during payment transactions

      // This endpoint will handle manual card tokenization if needed

      const { authorizationCode } = req.body;

      const orgId = req.session.organizationId;

      if (!authorizationCode) {
        return res.status(400).json({
          success: false,
          message:
            "Authorization code is required. Please complete a payment first to save your card.",
        });
      }

      // Retrieve Paystack customer code

      const result = await db.query(
        "SELECT paystack_customer_code FROM organizations WHERE organization_id = $1",

        [orgId]
      );

      if (result.rows.length === 0) {
        console.error(
          "❌ No Paystack customer code found for organization:",

          orgId
        );

        return res.status(404).json({
          success: false,

          message: "Paystack customer not found. Please contact support.",
        });
      }

      const paystackCustomerCode = result.rows[0].paystack_customer_code;

      // Fetch updated customer data with saved cards

      const customerResponse = await axios.get(
        `https://api.paystack.co/customer/${paystackCustomerCode}`,

        {
          headers: {
            Authorization: `Bearer ${process.env.PAYSTACK_SECRET_KEY}`,
          },
        }
      );

      const customer = customerResponse.data.data;

      let paymentMethods = [];

      let defaultPaymentMethod = null;

      if (customer.authorizations && customer.authorizations.length > 0) {
        paymentMethods = customer.authorizations
          .filter((auth) => auth.channel === "card" && auth.reusable)
          .map((auth) => ({
            id: auth.authorization_code,

            brand: auth.brand,

            last4: auth.last4,

            expMonth: auth.exp_month,

            expYear: auth.exp_year,

            email: auth.email,
          }));

        defaultPaymentMethod = paymentMethods[0] || null;
      }

      res.json({
        success: true,

        message: "Card information updated successfully.",

        paymentMethods,

        defaultPaymentMethod,
      });
    } catch (error) {
      console.error("❌ Error updating card:", error);

      res.status(500).json({
        success: false,

        message: "An error occurred while updating the card. Please try again.",

        error: error.message,
      });
    }
  },

  setPrimaryCardPost: async (req, res) => {
    try {
      const { authorizationCode } = req.body;

      const orgId = req.session.organizationId;

      if (!orgId || !authorizationCode) {
        return res

          .status(400)

          .json({ success: false, message: "Missing required parameters." });
      }

      await db.query(
        "UPDATE stored_cards SET is_primary = false WHERE organization_id = $1",
        [orgId]
      );

      const updateResult = await db.query(
        "UPDATE stored_cards SET is_primary = true WHERE organization_id = $1 AND authorization_code = $2 RETURNING authorization_code",
        [orgId, authorizationCode]
      );

      if (updateResult.rows.length === 0) {
        return res.status(404).json({
          success: false,
          message: 'Card not found for this organization.',
        });
      }

      res.json({ success: true, message: 'Primary card updated.' });
    } catch (error) {
      console.error("❌ [BACKEND] Error setting primary card:", error);

      return res.status(500).json({
        success: false,

        message: "Internal server error.",

        error: error.message,
      });
    }
  },

  removeCardPost: async (req, res) => {
    try {
      const { authorizationCode } = req.body;

      const orgId = req.session.organizationId;

      if (!authorizationCode) {
        return res.status(400).json({
          success: false,

          message: "Authorization code is required.",
        });
      }

      // Step 1: Retrieve Paystack customer code

      const result = await db.query(
        "SELECT paystack_customer_code FROM organizations WHERE organization_id = $1",

        [orgId]
      );

      const paystackCustomerCode = result.rows[0]?.paystack_customer_code;

      if (!paystackCustomerCode) {
        return res.status(404).json({
          success: false,

          message: "Paystack customer not found. Please contact support.",
        });
      }

      // Step 2: Deactivate the authorization on Paystack

      try {
        await axios.post(
          "https://api.paystack.co/customer/deactivate_authorization",

          {
            authorization_code: authorizationCode,
          },

          {
            headers: {
              Authorization: `Bearer ${process.env.PAYSTACK_SECRET_KEY}`,

              "Content-Type": "application/json",
            },
          }
        );
      } catch (deactivateError) {
        console.error(
          "❌ Error deactivating authorization:",
          deactivateError.message
        );
        return res.status(500).json({
          success: false,

          message: "Failed to remove card from Paystack.",
        });
      }

      // Step 3: Fetch updated customer data

      const customerResponse = await axios.get(
        `https://api.paystack.co/customer/${paystackCustomerCode}`,

        {
          headers: {
            Authorization: `Bearer ${process.env.PAYSTACK_SECRET_KEY}`,
          },
        }
      );

      const customer = customerResponse.data.data;

      let paymentMethods = [];

      let defaultPaymentMethod = null;

      if (customer.authorizations && customer.authorizations.length > 0) {
        paymentMethods = customer.authorizations
          .filter((auth) => auth.channel === "card" && auth.reusable)
          .map((auth) => ({
            id: auth.authorization_code,

            brand: auth.brand,

            last4: auth.last4,

            expMonth: auth.exp_month,

            expYear: auth.exp_year,

            email: auth.email,
          }));

        defaultPaymentMethod = paymentMethods[0] || null;
      }

      res.json({
        success: true,

        message: "Card removed successfully.",

        paymentMethods,

        defaultPaymentMethod,
      });
    } catch (error) {
      console.error("❌ Error removing card:", error);

      res.status(500).json({
        success: false,

        message: "An error occurred while removing the card. Please try again.",
      });
    }
  },

  confirmPasswordGet: (req, res) => {
    const redirectUrl = req.query.redirect || "/account/update";

    res.render("account/confirmPassword", {
      title: "Confirm Password",

      redirectUrl,

      showFooterTopSection: true,
      messages: req.flash(),
    });
  },

  confirmPasswordPost: async (req, res) => {
    const { password, redirectUrl } = req.body;

    const orgId = req.session.organizationId;

    try {
      const result = await db.query(
        "SELECT password FROM organizations WHERE organization_id = $1",

        [orgId]
      );

      if (result.rows.length === 0) {
        req.flash("error", "Organization not found. Please log in again.");

        return res.redirect("/account/login");
      }

      const storedHashedPassword = result.rows[0].password;

      const match = await bcryptjs.compare(password, storedHashedPassword);

      if (!match) {
        req.flash("error", "Incorrect password. Please try again.");

        return res.redirect(
          `/account/confirm-password?redirect=${encodeURIComponent(
            redirectUrl
          )}`
        );
      }

      // ✅ Set password verification flag

      req.session.passwordVerified = true;

      await req.session.save();

      // ✅ Redirect user to their intended page (Update Card Page)

      return res.redirect(redirectUrl || "/account/update-card");
    } catch (error) {
      console.error("❌ Error verifying password:", error);

      req.flash("error", "An unexpected error occurred. Please try again.");

      return res.redirect(
        `/account/confirm-password?redirect=${encodeURIComponent(redirectUrl)}`
      );
    }
  },

  confirmPasswordJson: async (req, res) => {
    const { password } = req.body;
    if (!password) {
      return res.status(400).json({
        success: false,
        message: 'Password is required.',
      });
    }
    const orgId = req.session.organizationId;

    try {
      if (!orgId) {
        return res.status(401).json({
          success: false,
          message: 'Organization not found. Please log in again.',
        });
      }

      const result = await db.query(
        'SELECT password FROM organizations WHERE organization_id = $1',
        [orgId]
      );

      if (result.rows.length === 0) {
        return res.status(404).json({
          success: false,
          message: 'Organization not found. Please log in again.',
        });
      }

      const storedHashedPassword = result.rows[0].password;
      const match = await bcryptjs.compare(password, storedHashedPassword);

      if (!match) {
        return res.status(401).json({
          success: false,
          message: 'Incorrect password. Please try again.',
        });
      }

      req.session.passwordVerified = true;
      await req.session.save();

      return res.json({ success: true });
    } catch (error) {
      console.error('�?O Error verifying password:', error);
      return res.status(500).json({
        success: false,
        message: 'An unexpected error occurred. Please try again.',
      });
    }
  },

  loginGet: (req, res) => {
    const url = req.url;

    res.render("account/login", {
      title: "Login",

      url,

      showFooterTopSection: true,
      messages: req.flash(),
    });
  },

  loginPost: async (req, res, db) => {
    const { email, password } = req.body;

    try {
      // Store the requested URL if not already stored

      if (
        !req.session.returnTo &&
        req.headers.referer &&
        !req.headers.referer.includes("/account/login")
      ) {
        req.session.returnTo = req.headers.referer;
      }

      // ✅ Step 1: Check if it's an Admin or Mini Admin
      // ...removed log for clean background operation...
      const adminResult = await db.query(
        `SELECT * FROM users WHERE LOWER(email) = LOWER($1) 

         AND (account_type = 'Admin' OR account_type = 'Mini Admin') 

         AND organization_id IS NULL`,

        [email]
      );
      // ...removed log for clean background operation...

      if (adminResult.rows.length > 0) {
        const admin = adminResult.rows[0];

        if (!admin.password) {
          console.error(`🚨 Admin account missing password: ${email}`);

          req.flash("error", "Invalid email or password.");

          return res.redirect("/account/login");
        }

        const match = await bcrypt.compare(password, admin.password);

        if (!match) {
          console.warn(`⚠️ Admin password mismatch for: ${email}`);

          req.flash("error", "Invalid email or password.");

          return res.redirect("/account/login");
        }

        req.session.regenerate((err) => {
          if (err) {
            console.error("❌ Error regenerating session:", err);

            req.flash("error", "Login failed. Please try again.");

            return res.redirect("/account/login");
          }

          // Set session variables

          req.session.userId = admin.user_id;

          req.session.firstName = admin.first_name;

          req.session.lastName = admin.last_name;

          req.session.accountType = admin.account_type;

          req.session.userRole = admin.account_type;

          req.session.save((err) => {
            if (err) {
              console.error("❌ Error saving session:", err);

              req.flash("error", "Login failed. Please try again.");

              return res.redirect("/account/login");
            }

            req.flash("success", `Welcome, Admin ${admin.first_name}!`);

            const redirectUrl =
              process.env.NODE_ENV === "production" ? "/admin" : "/admin";

            return res.redirect(req.session.returnTo || redirectUrl);
          });
        });

        return;
      }

      // ✅ Step 2: Check if it's a Regular User login (Teachers, Supervisors, etc.)

      const userResult = await db.query(
        `SELECT * FROM users WHERE LOWER(email) = LOWER($1) 

           AND account_type NOT IN ('Admin', 'Mini Admin') 

           AND organization_id IS NOT NULL`,

        [email]
      );

      console.log('👤 Staff user check:', {
        email: email,
        found: userResult.rows.length > 0
      });

      if (userResult.rows.length > 0) {
        const user = userResult.rows[0];

        console.log('👤 Staff user found:', {
          user_id: user.user_id,
          account_type: user.account_type,
          has_password: !!user.password
        });

        // Check if password has been set
        if (!user.password) {
          req.flash("error", "Your account password has not been set up yet. Please contact your administrator to receive a password setup email.");
          return res.redirect("/account/login");
        }

        const match = await bcrypt.compare(password, user.password);

        req.session.userId = user.user_id;

        if (match) {
          const orgResult = await db.query(
            `SELECT * FROM organizations WHERE organization_id = $1`,

            [user.organization_id]
          );

          if (orgResult.rows.length > 0) {
            const organization = orgResult.rows[0];

            if (organization.deleted) {
              req.flash(
                "error",

                "Your organization account has been deleted. Please contact support."
              );

              return res.redirect("/account/login");
            }

            if (organization.on_hold) {
              req.flash(
                "error",

                "Your organization account is currently on hold. Please contact support."
              );

              return res.redirect("/account/login");
            }

            req.session.regenerate((err) => {
              if (err) {
                console.error("Error regenerating session:", err);

                req.flash("error", "Login failed. Please try again.");

                return res.redirect("/account/login");
              }

              req.session.user = {
                user_id: user.user_id,

                first_name: user.first_name,

                last_name: user.last_name,

                email: user.email,

                phone: user.phone,

                account_type: user.account_type,
              };

              req.session.userRole = user.account_type;

              req.session.organizationId = user.organization_id;

              req.session.firstName = user.first_name;

              req.session.lastName = user.last_name;

              req.session.organizationName = organization.organization_name;

              req.session.logo = organization.logo;

              req.session.fontStyle = organization.font_style;

              req.session.accountType = user.account_type;

              req.session.orgNickName = organization.nickname;

              req.session.save((err) => {
                if (err) {
                  console.error("Error saving session:", err);

                  req.flash("error", "Login failed. Please try again.");

                  return res.redirect("/account/login");
                }

                const redirectUrl =
                  process.env.NODE_ENV === "production"
                    ? `https://${req.session.orgNickName}.managira.com/common/orgDashboard`
                    : "/common/orgDashboard?organizationId=" +
                      req.session.organizationId;

                req.flash("success", `Welcome, ${user.first_name}!`);

                return res.redirect(req.session.returnTo || redirectUrl);
              });
            });

            return;
          }
        } else {
          req.flash("error", "Invalid email or password.");

          return res.redirect("/account/login");
        }
      }

      // ✅ Step 3: Check if it's an Organization login (Managers)

      const orgResult = await db.query(
        `SELECT * FROM organizations WHERE LOWER(email) = LOWER($1)`,

        [email]
      );

      if (orgResult.rows.length > 0) {
        const organization = orgResult.rows[0];

        const match = await bcrypt.compare(password, organization.password);

        if (match) {
          if (organization.deleted) {
            req.flash(
              "error",

              "Your organization account has been deleted. Please contact support."
            );

            return res.redirect("/account/login");
          }

          if (organization.on_hold) {
            req.flash(
              "error",

              "Your organization account is currently on hold. Please contact support."
            );

            return res.redirect("/account/login");
          }

          req.session.regenerate((err) => {
            if (err) {
              console.error("Error regenerating session:", err);

              req.flash("error", "Login failed. Please try again.");

              return res.redirect("/account/login");
            }

            req.session.user = {
              user_id: organization.organization_id,

              first_name: organization.first_name,

              last_name: organization.last_name,

              email: organization.email,

              account_type: "Manager",
            };

            req.session.organizationId = organization.organization_id;

            req.session.organizationName = organization.organization_name;

            req.session.firstName = organization.first_name;

            req.session.lastName = organization.last_name;

            req.session.logo = organization.logo;

            req.session.fontStyle = organization.font_style;

            req.session.accountType = "Organization";

            req.session.userRole = "Manager";

            req.session.orgNickName = organization.nickname;

            // Do NOT fetch or store features here; handled by setAllowedFeatures middleware

            req.session.save((err) => {
              if (err) {
                console.error("Error saving session:", err);

                req.flash("error", "Login failed. Please try again.");

                return res.redirect("/account/login");
              }

              const redirectUrl =
                process.env.NODE_ENV === "production"
                  ? `https://${req.session.orgNickName}.managira.com/common/orgDashboard`
                  : "/common/orgDashboard?organizationId=" +
                    req.session.organizationId;

              req.flash(
                "success",

                `Successfully signed in ${organization.organization_name}!`
              );

              return res.redirect(req.session.returnTo || redirectUrl);
            });
          });

          return;
        } else {
          req.flash("error", "Invalid email or password.");

          return res.redirect("/account/login");
        }
      }

      // ❌ No match found

      req.flash(
        "error",

        "No account found with that email. Please register first"
      );

      res.redirect("/account/login");
    } catch (error) {
      console.error("🚨 Error logging in:", error);

      req.flash("error", "Login failed. Please try again.");

      res.redirect("/account/login");
    }
  },

  guardianLoginGet: (req, res) => {
    const url = req.url;

    return res.render("account/guardianLogin", {
      title: "Parent Portal Login",
      url,
      showFooterTopSection: true,
      messages: req.flash(),
    });
  },

  guardianLoginPost: async (req, res, db) => {
    const { identifier, password } = req.body;

    try {
      const cleanedPhone = String(identifier || "").replace(/[^\d+]/g, "");

      const guardianAcc = await db.query(
        `
        SELECT ga.*, gp.first_name, gp.last_name,
               o.organization_id, o.organization_name, o.nickname, o.logo, o.font_style, o.theme_color, o.deleted, o.on_hold
        FROM guardian_accounts ga
        JOIN guardian_profiles gp ON gp.guardian_id = ga.guardian_id
        JOIN organizations o ON o.organization_id = ga.organization_id
        WHERE
          (ga.login_email IS NOT NULL AND LOWER(ga.login_email) = LOWER($1))
          OR
          (ga.login_phone IS NOT NULL AND ga.login_phone = $2)
        LIMIT 1
        `,
        [identifier, cleanedPhone]
      );

      if (!guardianAcc.rows.length) {
        req.flash("error", "Invalid email/phone or password.");
        return res.redirect("/account/guardian-login");
      }

      const ga = guardianAcc.rows[0];

      if (!ga.password_hash) {
        req.flash(
          "error",
          "Your account password has not been set up yet. Please contact your school administrator to receive a password setup email."
        );
        return res.redirect("/account/guardian-login");
      }

      const match = await bcrypt.compare(password, ga.password_hash);
      if (!match) {
        req.flash("error", "Invalid email/phone or password.");
        return res.redirect("/account/guardian-login");
      }

      if (ga.deleted || ga.on_hold) {
        req.flash(
          "error",
          "Organization account is suspended. Please contact support."
        );
        return res.redirect("/account/guardian-login");
      }

      req.session.regenerate((err) => {
        if (err) {
          req.flash("error", "Login failed. Please try again.");
          return res.redirect("/account/guardian-login");
        }

        req.session.user = {
          user_id: null,
          first_name: ga.first_name,
          last_name: ga.last_name,
          email: ga.login_email || null,
          account_type: "Guardian",
        };

        req.session.userRole = "Guardian";
        req.session.accountType = "Guardian";
        req.session.guardianId = ga.guardian_id;

        req.session.organizationId = ga.organization_id;
        req.session.organizationName = ga.organization_name;
        req.session.orgNickName = ga.nickname;
        req.session.logo = ga.logo;
        req.session.fontStyle = ga.font_style;
        req.session.themeColor = ga.theme_color || 'teal';

        req.session.firstName = ga.first_name;
        req.session.lastName = ga.last_name;

        req.session.save(() => {
          const redirectUrl =
            process.env.NODE_ENV === "production"
              ? `https://${req.session.orgNickName}.managira.com/guardian/dashboard`
              : "/guardian/dashboard";

          return res.redirect(redirectUrl);
        });
      });
    } catch (error) {
      console.error("Guardian login error:", error);
      req.flash("error", "Login failed. Please try again.");
      return res.redirect("/account/guardian-login");
    }
  },

  logoutGet: (req, res) => {
    req.session.destroy((err) => {
      if (err) {
        console.error("Error logging out:", err);

        req.flash("error", "Failed to log out. Please try again.");

        return res.redirect("/account/login");
      }

      // Clear client-side cookies

      res.clearCookie("connect.sid", { path: "/" });

      // Redirect based on environment

      const isProduction = process.env.NODE_ENV === "production";

      const redirectUrl = isProduction
        ? "https://managira.com"
        : "/account/login";

      res.redirect(redirectUrl);
    });
  },

  accountGet: (req, res) => {
    res.render("account/account", {
      title: "Account Management",

      messages: req.flash(),
    });
  },

  updateGet: async (req, res) => {
    // Log entire session object

    if (!req.session.user || !req.session.user.user_id) {
      req.flash("error", "You must be logged in.");

      return res.redirect("/account/login");
    }

    try {
      let userDetails;

      let orgDetails;

      if (req.session.user.account_type === "Manager") {
        const orgQuery = await db.query(
          `SELECT organization_id, first_name, last_name, email, scheduled_hold_date, on_hold 

                 FROM organizations WHERE organization_id = $1`,

          [req.session.organizationId]
        );

        if (orgQuery.rows.length === 0) {
          req.flash("error", "Organization not found.");

          return res.redirect("/account/login");
        }

        userDetails = {
          first_name: orgQuery.rows[0].first_name,

          last_name: orgQuery.rows[0].last_name,

          email: orgQuery.rows[0].email,
        };

        orgDetails = orgQuery.rows[0];
      } else {
        const userQuery = await db.query(
          `SELECT first_name, last_name, email FROM users WHERE user_id = $1`,

          [req.session.user.user_id]
        );

        if (userQuery.rows.length === 0) {
          req.flash("error", "User not found.");

          return res.redirect("/account/login");
        }

        userDetails = userQuery.rows[0];

        const orgQuery = await db.query(
          `SELECT organization_id, scheduled_hold_date, on_hold FROM organizations WHERE organization_id = $1`,

          [req.session.organizationId]
        );

        orgDetails = orgQuery.rows.length > 0 ? orgQuery.rows[0] : {};
      }

      res.render("account/update", {
        title: "Update Account Information",

        userDetails,

        orgDetails,

        messages: req.flash(),
      });
    } catch (error) {
      console.error("❌ Error fetching user details:", error);

      req.flash("error", "Failed to load account details.");

      res.redirect("/account");
    }
  },

  updatePost: async (req, res) => {
    if (!req.session.user || !req.session.user.user_id) {
      req.flash("error", "You must be logged in.");

      return res.redirect("/account/login");
    }

    const { firstName, lastName, email, password, confirmPassword } = req.body;

    const userId = req.session.user.user_id;

    const orgId = req.session.organizationId;

    if (password && password !== confirmPassword) {
      req.flash("error", "Passwords do not match.");

      return res.redirect("/account/update");
    }

    try {
      // Check if the new email already exists in other users or organizations

      const emailCheckQuery = `

        SELECT email FROM users WHERE LOWER(email) = LOWER($1) AND user_id != $2

        UNION

        SELECT email FROM organizations WHERE LOWER(email) = LOWER($1) AND organization_id != $3

      `;

      const emailCheckResult = await db.query(emailCheckQuery, [
        email,

        userId,

        orgId,
      ]);

      if (emailCheckResult.rows.length > 0) {
        req.flash("error", "Email is already in use by another account.");

        return res.redirect("/account/update");
      }

      // Determine if updating a user (employee) or an organization

      if (req.session.user.account_type === "Manager") {
        // Update organization

        let updateQuery = `UPDATE organizations SET first_name = $1, last_name = $2, email = $3`;

        let params = [firstName, lastName, email];

        if (password) {
          const hashedPassword = await bcrypt.hash(password, 10);

          updateQuery += ", password = $4 WHERE organization_id = $5";

          params.push(hashedPassword, orgId);
        } else {
          updateQuery += " WHERE organization_id = $4";

          params.push(orgId);
        }

        await db.query(updateQuery, params);

        // ✅ Update session

        req.session.user.first_name = firstName;

        req.session.user.last_name = lastName;

        req.session.user.email = email;

        req.session.save();
      } else {
        // Update user

        let updateQuery = `UPDATE users SET first_name = $1, last_name = $2, email = $3`;

        let params = [firstName, lastName, email];

        if (password) {
          const hashedPassword = await bcrypt.hash(password, 10);

          updateQuery += ", password = $4 WHERE user_id = $5";

          params.push(hashedPassword, userId);
        } else {
          updateQuery += " WHERE user_id = $4";

          params.push(userId);
        }

        await db.query(updateQuery, params);

        // ✅ Update session

        req.session.user.first_name = firstName;

        req.session.user.last_name = lastName;

        req.session.user.email = email;

        req.session.save();
      }

      req.flash("success", "Account information updated successfully.");

      res.redirect("/account/update");
    } catch (error) {
      console.error("❌ Error updating account:", error);

      req.flash(
        "error",

        "Failed to update account information. Please try again."
      );

      res.redirect("/account/update");
    }
  },

  updateProfileNamePost: async (req, res, db) => {
    if (!req.session.user || !req.session.organizationId) {
      req.flash("error", "You must be logged in.");
      return res.redirect("/account/login");
    }

    const { firstName, lastName, redirectTo } = req.body;
    const orgId = req.session.organizationId;
    const userId = req.session.user.user_id;
    const isOrgAccount = req.session.accountType === "Organization";

    if (!firstName || !lastName) {
      req.flash("error", "First name and last name are required.");
      return res.redirect(redirectTo || "/account/settings");
    }

    try {
      if (isOrgAccount) {
        await db.query(
          "UPDATE organizations SET first_name = $1, last_name = $2 WHERE organization_id = $3",
          [firstName, lastName, orgId]
        );
      } else {
        await db.query(
          "UPDATE users SET first_name = $1, last_name = $2 WHERE user_id = $3 AND organization_id = $4",
          [firstName, lastName, userId, orgId]
        );
      }

      req.session.firstName = firstName;
      req.session.lastName = lastName;
      if (req.session.user) {
        req.session.user.first_name = firstName;
        req.session.user.last_name = lastName;
      }
      req.session.save();

      req.flash("success", "Profile updated successfully.");
      return res.redirect(redirectTo || "/account/settings");
    } catch (error) {
      console.error("Error updating profile name:", error);
      req.flash("error", "Failed to update profile.");
      return res.redirect(redirectTo || "/account/settings");
    }
  },

  updateProfileImagePost: async (req, res, db) => {
    if (!req.session.user || !req.session.organizationId) {
      req.flash("error", "You must be logged in.");
      return res.redirect("/account/login");
    }

    const { redirectTo } = req.body;
    const orgId = req.session.organizationId;
    const userId = req.session.user.user_id;
    const isOrgAccount = req.session.accountType === "Organization";

    if (!req.file) {
      req.flash("error", "Please select an image to upload.");
      return res.redirect(redirectTo || "/account/settings");
    }

    try {
      // Upload image to S3
      const s3Key = `images/profiles/${orgId}/${req.file.originalname}`;
      const imageUrl = await uploadToS3(req.file, s3Key);

      // Update database
      if (isOrgAccount) {
        await db.query(
          "UPDATE organizations SET image_url = $1 WHERE organization_id = $2",
          [imageUrl, orgId]
        );
      } else {
        await db.query(
          "UPDATE users SET image_url = $1 WHERE user_id = $2 AND organization_id = $3",
          [imageUrl, userId, orgId]
        );
      }

      // Update session
      if (req.session.user) {
        req.session.user.image_url = imageUrl;
      }
      req.session.save();

      req.flash("success", "Profile picture updated successfully!");
      return res.redirect(redirectTo || "/account/settings");
    } catch (error) {
      console.error("Error updating profile image:", error);
      req.flash("error", "Failed to update profile picture.");
      return res.redirect(redirectTo || "/account/settings");
    }
  },

  updateSecurityEmailPost: async (req, res, db) => {
    if (!req.session.user || !req.session.organizationId) {
      req.flash("error", "You must be logged in.");
      return res.redirect("/account/login");
    }

    const { email, redirectTo } = req.body;
    const orgId = req.session.organizationId;
    const userId = req.session.user.user_id;
    const isOrgAccount = req.session.accountType === "Organization";

    if (!email) {
      req.flash("error", "Email is required.");
      return res.redirect(redirectTo || "/account/settings");
    }

    try {
      const emailCheckQuery = `
        SELECT email FROM users WHERE LOWER(email) = LOWER($1) AND user_id != $2
        UNION
        SELECT email FROM organizations WHERE LOWER(email) = LOWER($1) AND organization_id != $3
      `;

      const emailCheckResult = await db.query(emailCheckQuery, [
        email,
        userId || 0,
        orgId || 0,
      ]);

      if (emailCheckResult.rows.length > 0) {
        req.flash("error", "Email is already in use by another account.");
        return res.redirect(redirectTo || "/account/settings");
      }

      if (isOrgAccount) {
        await db.query(
          "UPDATE organizations SET email = $1 WHERE organization_id = $2",
          [email, orgId]
        );
      } else {
        await db.query(
          "UPDATE users SET email = $1 WHERE user_id = $2 AND organization_id = $3",
          [email, userId, orgId]
        );
      }

      if (req.session.user) {
        req.session.user.email = email;
      }
      req.session.save();

      req.flash("success", "Email updated successfully.");
      return res.redirect(redirectTo || "/account/settings");
    } catch (error) {
      console.error("Error updating email:", error);
      req.flash("error", "Failed to update email.");
      return res.redirect(redirectTo || "/account/settings");
    }
  },

  updateSecurityPasswordPost: async (req, res, db) => {
    if (!req.session.user || !req.session.organizationId) {
      req.flash("error", "You must be logged in.");
      return res.redirect("/account/login");
    }

    const { password, confirmPassword, redirectTo } = req.body;
    const orgId = req.session.organizationId;
    const userId = req.session.user.user_id;
    const isOrgAccount = req.session.accountType === "Organization";

    if (!password || !confirmPassword) {
      req.flash("error", "Password and confirmation are required.");
      return res.redirect(redirectTo || "/account/settings");
    }

    if (password !== confirmPassword) {
      req.flash("error", "Passwords do not match.");
      return res.redirect(redirectTo || "/account/settings");
    }

    try {
      const hashedPassword = await bcrypt.hash(password, 10);

      if (isOrgAccount) {
        await db.query(
          "UPDATE organizations SET password = $1 WHERE organization_id = $2",
          [hashedPassword, orgId]
        );
      } else {
        await db.query(
          "UPDATE users SET password = $1 WHERE user_id = $2 AND organization_id = $3",
          [hashedPassword, userId, orgId]
        );
      }

      req.flash("success", "Password updated successfully.");
      return res.redirect(redirectTo || "/account/settings");
    } catch (error) {
      console.error("Error updating password:", error);
      req.flash("error", "Failed to update password.");
      return res.redirect(redirectTo || "/account/settings");
    }
  },

  personalizationGet: async (req, res) => {
    try {
      const { organizationId } = req.session;

      const result = await db.query(
        "SELECT * FROM organizations WHERE organization_id = $1",

        [organizationId]
      );

      const orgDetails = result.rows[0];

      const heroImageResult = await db.query(
        "SELECT * FROM organization_images WHERE organization_id = $1 AND allocation = $2",

        [organizationId, "hero"]
      );

      const heroImage = heroImageResult.rows[0];

      const slideshowImagesResult = await db.query(
        "SELECT * FROM organization_images WHERE organization_id = $1 AND allocation = $2",

        [organizationId, "slideshow"]
      );

      const slideshowImages = slideshowImagesResult.rows;

      res.render("account/accountPersonalization", {
        title: "Account Personalization",

        organizationId,

        orgDetails,

        heroImage,

        slideshowImages,

        messages: req.flash(),
      });
    } catch (error) {
      console.error("Error rendering account personalization page:", error);

      req.flash("error", "Failed to load personalization page.");

      res.redirect("/");
    }
  },

  personalizationPost: async (req, res) => {
    try {
      const { orgName, font } = req.body;

      const updateQuery = `

                UPDATE organizations

                SET organization_name = $1, font_style = $2

                WHERE organization_id = $3

            `;

      await db.query(updateQuery, [orgName, font, req.session.organizationId]);

      req.session.organizationName = orgName;

      req.session.fontStyle = font;

      req.flash("success", "Personalization updated successfully.");

      res.redirect("/account/personalization");
    } catch (err) {
      console.error("Error updating personalization:", err);

      req.flash(
        "error",

        "An error occurred while updating personalization. Please try again."
      );

      res.redirect(req.body.redirectTo || "/account/personalization");
    }
  },

  updateOrgNamePost: async (req, res, db) => {
    try {
      const { orgName, redirectTo } = req.body;
      const orgId = req.session.organizationId;

      if (!orgName || !orgId) {
        req.flash("error", "Organization name is required.");
        return res.redirect(redirectTo || "/account/personalization");
      }

      await db.query(
        "UPDATE organizations SET organization_name = $1 WHERE organization_id = $2",
        [orgName, orgId]
      );

      req.session.organizationName = orgName;
      req.flash("success", "Organization name updated successfully.");
      return res.redirect(redirectTo || "/account/personalization");
    } catch (err) {
      console.error("Error updating organization name:", err);
      req.flash("error", "Failed to update organization name.");
      return res.redirect(req.body.redirectTo || "/account/personalization");
    }
  },

  updateFontPost: async (req, res, db) => {
    try {
      const { font, redirectTo } = req.body;
      const orgId = req.session.organizationId;

      if (!font || !orgId) {
        req.flash("error", "Font selection is required.");
        return res.redirect(redirectTo || "/account/personalization");
      }

      await db.query(
        "UPDATE organizations SET font_style = $1 WHERE organization_id = $2",
        [font, orgId]
      );

      req.session.fontStyle = font;
      req.flash("success", "Font updated successfully.");
      return res.redirect(redirectTo || "/account/personalization");
    } catch (err) {
      console.error("Error updating font:", err);
      req.flash("error", "Failed to update font.");
      return res.redirect(req.body.redirectTo || "/account/personalization");
    }
  },

  personalizationLogoPost: async (req, res) => {
    const { file } = req;

    const { organizationId } = req.session;

    if (!file) {
      req.flash("error", "No file uploaded. Please select a file to upload.");

      return res.redirect(req.body.redirectTo || "/account/personalization");
    }

    try {
      const result = await db.query(
        "SELECT logo FROM organizations WHERE organization_id = $1",

        [organizationId]
      );

      const previousLogo = result.rows[0].logo;

      // Upload the new logo to S3 under images/logos/{organizationId}/

      const logoKey = `images/logos/${organizationId}/${file.originalname}`;

      const logoUrl = await uploadToS3(file, logoKey);

      // Update the organization record with the new logo URL

      await db.query(
        "UPDATE organizations SET logo = $1 WHERE organization_id = $2",

        [logoUrl, organizationId]
      );

      // Update the session with the new logo URL

      req.session.logo = logoUrl;

      req.session.save();

      // Delete the old logo from S3 if it exists

      if (previousLogo) {
        // Remove the S3 URL prefix to get the key

        const s3Prefix = `https://${process.env.S3_BUCKET_NAME}.s3.${process.env.AWS_REGION}.amazonaws.com/`;

        let oldLogoKey = previousLogo;

        if (previousLogo.startsWith(s3Prefix)) {
          oldLogoKey = previousLogo.substring(s3Prefix.length);
        }

        await deleteFromS3(oldLogoKey);
      }

      req.flash("success", "Logo updated successfully.");

      res.redirect(req.body.redirectTo || "/account/personalization");
    } catch (err) {
      console.error("Error updating logo:", err);

      req.flash(
        "error",

        "An error occurred while updating the logo. Please try again."
      );

      res.redirect(req.body.redirectTo || "/account/personalization");
    }
  },

  updateNicknamePost: async (req, res) => {
    const { orgNickName } = req.body;

    const orgId = req.session?.organizationId;

    // Validate nickname

    const nicknamePattern = /^[a-z]+$/;

    if (!nicknamePattern.test(orgNickName)) {
      if (req.session)
        req.flash(
          "error",

          "Invalid nickname. Only lowercase letters allowed, No Space and special characters."
        );

      return res.redirect(req.body.redirectTo || "/account/personalization");
    }

    try {
      // Check for duplicate nickname

      const existing = await db.query(
        "SELECT organization_id FROM organizations WHERE nickname = $1 AND organization_id != $2",

        [orgNickName, orgId]
      );

      if (existing.rows.length > 0) {
        if (req.session)
          req.flash(
            "error",

            "That nickname is already taken by another organization."
          );

        return res.redirect(req.body.redirectTo || "/account/personalization");
      }

      // Update nickname

      await db.query(
        "UPDATE organizations SET nickname = $1 WHERE organization_id = $2",

        [orgNickName, orgId]
      );

      // ✅ Clear sessions for everyone in this org

      const sessionDeleteQuery = `

        DELETE FROM user_sessions WHERE sess::jsonb->'organizationId' = to_jsonb($1::int)

      `;

      await db.query(sessionDeleteQuery, [orgId]);

      // ✅ Remove any existing nickname change announcement for this org

      await db.query(
        "DELETE FROM admin_announcements WHERE organization_id = $1",

        [orgId]
      );

      // ✅ Insert a new one-time announcement (5 days expiry)

      const announcementTitle = "Organization URL Changed(One Time Notice)";

      const announcementDescription = `

        Your school's URL has been changed to: ${orgNickName}.

        To access the public website, please use: ${orgNickName}.managira.com

        You can also share this new link with others.

      `;

      const expiryDate = new Date();

      expiryDate.setDate(expiryDate.getDate() + 5);

      await db.query(
        `INSERT INTO admin_announcements

          (organization_id, title, description, is_active, expiry_date)

         VALUES ($1, $2, $3, true, $4)`,

        [orgId, announcementTitle, announcementDescription, expiryDate]
      );

      // ✅ Destroy the current session and redirect to login on main domain

      req.session.regenerate((err) => {
        if (err) {
          console.error("Error destroying session after nickname change:", err);

          // fallback: redirect to login on main domain

          return res.redirect("https://managira.com/account/login");
        }

        res.clearCookie("connect.sid", { path: "/" });

        res.redirect("https://managira.com/account/login");
      });
    } catch (error) {
      console.error("Error updating nickname:", error);

      if (req.session)
        req.flash("error", "Failed to update nickname. Please try again.");

      res.redirect(req.body.redirectTo || "/account/personalization");
    }
  },

  getSubjectsByClass: async (req, res) => {
    const { classId } = req.query;

    if (!classId) {
      return res.status(400).json({ message: "Class ID is required" });
    }

    try {
      const result = await db.query(
        "SELECT subject_id, subject_name FROM subjects WHERE class_id = $1",

        [classId]
      );

      res.json(result.rows);
    } catch (error) {
      console.error("Error fetching subjects:", error);

      res.status(500).json({ message: "Failed to fetch subjects." });
    }
  },

  uploadSlideshowImages: async (req, res) => {
    try {
      const { contentType } = req.body;

      const files = req.files; // Assuming multer is set up properly to use `req.files`

      const captions = Array.isArray(req.body["fileTexts"])
        ? req.body["fileTexts"]
        : [req.body["fileTexts"]]; // Ensure `captions` is always an array

      const orgId = req.session.organizationId;

      if (!files || files.length === 0) {
        req.flash("error", "No files selected for upload.");

        return res.redirect("/account/personalization");
      }

      if (contentType === "slideshow" && files.length < 2) {
        req.flash(
          "error",

          "Please upload at least two images or videos for the slideshow."
        );

        return res.redirect("/account/personalization");
      }

      // Generate a unique `slideshow_id` for this set of images

      let slideshowId = null;

      if (contentType === "slideshow") {
        const slideshowIdResult = await db.query(
          "INSERT INTO slideshows (organization_id) VALUES ($1) RETURNING slideshow_id",

          [orgId]
        );

        slideshowId = slideshowIdResult.rows[0].slideshow_id;
      }

      // Loop over files and upload them to S3, save to DB with `slideshow_id`

      for (let i = 0; i < files.length; i++) {
        const file = files[i];

        const caption = captions[i] || ""; // Match the caption to the file by index

        // Upload to S3 under images/publicdashboard/{orgId}/

        const imageKey = `images/publicdashboard/${orgId}/${file.originalname}`;

        const imageUrl = await uploadToS3(file, imageKey);

        // Save the file data to the database

        await db.query(
          "INSERT INTO organization_images (organization_id, slideshow_id, image_url, caption, allocation) VALUES ($1, $2, $3, $4, $5)",

          [orgId, slideshowId, imageUrl, caption, contentType]
        );
      }

      req.flash("success", "Content uploaded successfully.");

      res.redirect("/account/managePublicContent");
    } catch (error) {
      console.error("Error uploading content:", error);

      req.flash("error", "Failed to upload content. Please try again.");

      res.redirect("/account/managePublicContent");
    }
  },

  addTextSection: async (req, res) => {
    const { heading, paragraph } = req.body;

    const orgId = req.session.organizationId;

    try {
      await db.query(
        "INSERT INTO organization_texts (organization_id, heading, paragraph) VALUES ($1, $2, $3)",

        [orgId, heading, paragraph]
      );

      req.flash("success", "Text section added successfully.");

      res.redirect("/account/managePublicContent");
    } catch (error) {
      console.error("Error adding text section:", error);

      req.flash("error", "Failed to add text section. Please try again.");

      res.redirect("/account/managePublicContent");
    }
  },

  updateAboutUsSection: async (req, res) => {
    const { organization_id, aboutUs, motto } = req.body;

    try {
      await db.query(
        `UPDATE organizations SET aboutUs = $1, motto = $2 WHERE organization_id = $3`,

        [aboutUs, motto, organization_id]
      );

      res.redirect("/account/managePublicContent"); // Replace with the actual page route
    } catch (error) {
      console.error("Error updating About Us:", error);

      res.status(500).send("Server Error updating about us");
    }
  },

  managePublicContentGet: async (req, res) => {
    const { organizationId } = req.session;

    const url = req.url;

    try {
      const imagesResult = await db.query(
        "SELECT * FROM organization_images WHERE organization_id = $1",

        [organizationId]
      );

      const textsResult = await db.query(
        "SELECT * FROM organization_texts WHERE organization_id = $1",

        [organizationId]
      );

      const result = await db.query(
        "SELECT * FROM organizations WHERE organization_id = $1",

        [organizationId]
      );

      const orgDetails = result.rows[0];

      const heroImageResult = await db.query(
        "SELECT * FROM organization_images WHERE organization_id = $1 AND allocation = $2",

        [organizationId, "hero"]
      );

      const heroImage = heroImageResult.rows[0];

      const slideshowImagesResult = await db.query(
        "SELECT * FROM organization_images WHERE organization_id = $1 AND allocation = $2",

        [organizationId, "slideshow"]
      );

      const slideshowImages = slideshowImagesResult.rows;

      const currentSchoolYearTerm = await db.query(
        `

                SELECT sy.id as school_year_id, t.term_id

                FROM school_years sy

                JOIN terms t ON sy.id = t.school_year_id

                WHERE sy.organization_id = $1 AND sy.current = TRUE AND t.current = TRUE

            `,

        [organizationId]
      );

      if (currentSchoolYearTerm.rows.length === 0) {
        req.flash(
          "error",

          "No current school year or term found. Create one to be able to edit organization dashboards"
        );

        return res.redirect("/common/manageRecords");
      }

      const { school_year_id, term_id } = currentSchoolYearTerm.rows[0];

      // Fetch events and announcements tied to the current school year and term

      const events = await db.query(
        "SELECT * FROM school_events WHERE organization_id = $1 AND school_year_id = $2 AND term_id = $3",

        [organizationId, school_year_id, term_id]
      );

      const formattedEvents = events.rows.map((event) => ({
        ...event,

        event_date: new Date(event.event_date).toISOString().split("T")[0], // Convert to YYYY-MM-DD
      }));

      const announcements = await db.query(
        "SELECT * FROM announcements WHERE organization_id = $1 AND school_year_id = $2 AND term_id = $3",

        [organizationId, school_year_id, term_id]
      );

      // Load current school website theme/layout from organization_dashboard
      let publicDashboardTheme = "classic";
      let publicDashboardLayout = "wireframe1";
      try {
        const dashRow = await db.query(
          "SELECT order_data FROM organization_dashboard WHERE organization_id = $1",
          [organizationId]
        );
        if (dashRow.rows.length > 0) {
          let raw = dashRow.rows[0].order_data;
          if (typeof raw === "string") raw = JSON.parse(raw);
          if (raw && typeof raw === "object" && !Array.isArray(raw)) {
            if (typeof raw.theme === "string" && raw.theme.trim()) {
              publicDashboardTheme = raw.theme.trim();
            }
            if (typeof raw.layout === "string" && raw.layout.trim()) {
              publicDashboardLayout = raw.layout.trim();
            }
          }
        }
      } catch (e) {
        publicDashboardTheme = "classic";
        publicDashboardLayout = "wireframe1";
      }

      res.render("account/managePublicContent", {
        title: "Manage Public Content",

        images: imagesResult.rows,

        texts: textsResult.rows,

        organizationId,

        orgDetails,

        heroImage,

        slideshowImages,

        url,

        events: formattedEvents,

        announcements: announcements.rows,

        publicDashboardTheme,
        publicDashboardLayout,

        messages: {
          error: req.flash("error"),

          success: req.flash("success"),
        },
      });
    } catch (error) {
      console.error("Error fetching public content:", error);

      req.flash("error", "Failed to load public content.");

      res.redirect("/account");
    }
  },

  updatePublicDashboardLayoutPost: async (req, res) => {
    const organizationId = req.session.organizationId;
    const layout = (req.body?.publicDashboardLayout || "").trim();
    const allowedLayouts = new Set(["wireframe1", "wireframe2", "wireframe3", "wireframe4"]);

    if (!organizationId) {
      req.flash("error", "Missing organization.");
      return res.redirect("/account/managePublicContent");
    }

    if (!allowedLayouts.has(layout)) {
      req.flash("error", "Invalid website layout selected.");
      return res.redirect("/account/managePublicContent");
    }

    try {
      const existing = await db.query(
        "SELECT order_data FROM organization_dashboard WHERE organization_id = $1",
        [organizationId]
      );

      let order = [];
      let theme = "classic";

      if (existing.rows.length > 0) {
        let raw = existing.rows[0].order_data;
        try {
          if (typeof raw === "string") raw = JSON.parse(raw);
          if (Array.isArray(raw)) {
            order = raw;
          } else if (raw && typeof raw === "object") {
            if (Array.isArray(raw.order)) order = raw.order;
            if (typeof raw.theme === "string" && raw.theme.trim()) theme = raw.theme.trim();
          }
        } catch (e) {
          order = [];
          theme = "classic";
        }
      }

      const payload = { order, theme, layout };

      await db.query(
        `INSERT INTO organization_dashboard (organization_id, order_data)
         VALUES ($1, $2)
         ON CONFLICT (organization_id)
         DO UPDATE SET order_data = EXCLUDED.order_data`,
        [organizationId, payload]
      );

      req.flash("success", "Website layout updated successfully.");
      return res.redirect("/account/managePublicContent");
    } catch (error) {
      console.error("Error updating school website layout:", error);
      req.flash("error", "Failed to update website layout.");
      return res.redirect("/account/managePublicContent");
    }
  },

  updatePublicDashboardThemePost: async (req, res) => {
    const organizationId = req.session.organizationId;
    const theme = (req.body?.publicDashboardTheme || "").trim();
    
    // Map public theme values to organization button theme values
    const themeMapping = {
      'classic': 'teal',
      'modern': 'blue',
      'green': 'green',
      'minimal': 'purple',
      'indigo': 'indigo',
      'rose': 'rose',
      'amber': 'amber',
      'slate': 'slate'
    };
    
    const allowedThemes = new Set(Object.keys(themeMapping));

    if (!organizationId) {
      req.flash("error", "Missing organization.");
      return res.redirect("/account/managePublicContent");
    }

    if (!allowedThemes.has(theme)) {
      req.flash("error", "Invalid website style selected.");
      return res.redirect("/account/managePublicContent");
    }

    try {
      const existing = await db.query(
        "SELECT order_data FROM organization_dashboard WHERE organization_id = $1",
        [organizationId]
      );

      let order = [];
      if (existing.rows.length > 0) {
        let raw = existing.rows[0].order_data;
        try {
          if (typeof raw === "string") raw = JSON.parse(raw);
          if (Array.isArray(raw)) {
            order = raw;
          } else if (raw && typeof raw === "object" && Array.isArray(raw.order)) {
            order = raw.order;
          }
        } catch (e) {
          order = [];
        }
      }

      const payload = { order, theme };

      // Update school website theme
      await db.query(
        `INSERT INTO organization_dashboard (organization_id, order_data)
         VALUES ($1, $2)
         ON CONFLICT (organization_id)
         DO UPDATE SET order_data = EXCLUDED.order_data`,
        [organizationId, payload]
      );

      // Update organization button theme color
      const orgThemeColor = themeMapping[theme];
      await db.query(
        "UPDATE organizations SET theme_color = $1 WHERE organization_id = $2",
        [orgThemeColor, organizationId]
      );

      // Update session with new theme color
      req.session.themeColor = orgThemeColor;

      req.flash("success", "Website style updated successfully.");
      return res.redirect("/account/managePublicContent");
    } catch (error) {
      console.error("Error updating school website theme:", error);
      req.flash("error", "Failed to update website style.");
      return res.redirect("/account/managePublicContent");
    }
  },

  updatePublicRegistration: async (req, res) => {
    const { enabled, startDate, endDate, price, currency } = req.body;

    const organizationId = req.session.organizationId;

    try {
      await db.query(
        `UPDATE organizations 

         SET public_registration_enabled = $1,

             registration_start_date = $2,

             registration_end_date = $3,

             public_registration_price = $4,

             public_registration_currency = $5

         WHERE organization_id = $6`,

        [
          enabled === "on",

          startDate || null,

          endDate || null,

          price || 0,

          currency || "USD",

          organizationId,
        ]
      );

      req.flash("success", "Public registration settings updated!");

      // ✅ Instead of manually rendering with empty data, redirect:

      res.redirect("/account/managePublicContent");
    } catch (error) {
      console.error("Error updating registration settings:", error);

      req.flash("error", "Could not update registration settings.");

      res.redirect("/account/managePublicContent");
    }
  },

  updateImagePost: async (req, res) => {
    const { imageId, caption, allocation } = req.body;

    const { organizationId } = req.session;

    try {
      await db.query(
        "UPDATE organization_images SET caption = $1, allocation = $2 WHERE image_id = $3 AND organization_id = $4",

        [caption, allocation, imageId, organizationId]
      );

      req.flash("success", "Image updated successfully.");

      res.redirect("/account/managePublicContent");
    } catch (error) {
      console.error("Error updating image:", error);

      req.flash("error", "Failed to update image. Please try again.");

      res.redirect("/account/managePublicContent");
    }
  },

  deleteImageGet: async (req, res) => {
    const { imageId } = req.params;

    const { organizationId } = req.session;

    try {
      // Fetch the image URL first

      const imageResult = await db.query(
        "SELECT image_url FROM organization_images WHERE image_id = $1 AND organization_id = $2",

        [imageId, organizationId]
      );

      if (imageResult.rows.length === 0) {
        req.flash("error", "Image not found.");

        return res.redirect("/account/managePublicContent");
      }

      const imageUrl = imageResult.rows[0].image_url;

      // Delete image from DB

      await db.query(
        "DELETE FROM organization_images WHERE image_id = $1 AND organization_id = $2",

        [imageId, organizationId]
      );

      // Delete image from S3

      if (imageUrl) {
        // Remove the S3 URL prefix to get the key

        const s3Prefix = `https://${process.env.S3_BUCKET_NAME}.s3.${process.env.AWS_REGION}.amazonaws.com/`;

        let imageKey = imageUrl;

        if (imageUrl.startsWith(s3Prefix)) {
          imageKey = imageUrl.substring(s3Prefix.length);
        }

        await deleteFromS3(imageKey);
      }

      req.flash("success", "Image deleted successfully.");

      res.redirect("/account/managePublicContent");
    } catch (error) {
      console.error("Error deleting image:", error);

      req.flash("error", "Failed to delete image. Please try again.");

      res.redirect("/account/managePublicContent");
    }
  },

  updateTextPost: async (req, res) => {
    const { textId, heading, paragraph } = req.body;

    const { organizationId } = req.session;

    try {
      await db.query(
        "UPDATE organization_texts SET heading = $1, paragraph = $2 WHERE text_id = $3 AND organization_id = $4",

        [heading, paragraph, textId, organizationId]
      );

      req.flash("success", "Text updated successfully.");

      res.redirect("/account/managePublicContent");
    } catch (error) {
      console.error("Error updating text:", error);

      req.flash("error", "Failed to update text. Please try again.");

      res.redirect("/account/managePublicContent");
    }
  },

  deleteTextGet: async (req, res) => {
    const { textId } = req.params;

    const { organizationId } = req.session;

    try {
      await db.query(
        "DELETE FROM organization_texts WHERE text_id = $1 AND organization_id = $2",

        [textId, organizationId]
      );

      req.flash("success", "Text deleted successfully.");

      res.redirect("/account/managePublicContent");
    } catch (error) {
      console.error("Error deleting text:", error);

      req.flash("error", "Failed to delete text. Please try again.");

      res.redirect("/account/managePublicContent");
    }
  },

  forgetPasswordGet: (req, res) => {
    res.render("account/forgetPassword", {
      title: "Forget Password",

      showFooterTopSection: true,
      messages: req.flash(),
    });
  },

  forgetPasswordPost: async (req, res) => {
    const { email } = req.body;

    const baseUrl = res.locals.BASE_URL; // Get BASE_URL from middleware

    try {
      const userResult = await db.query(
        `SELECT email, 'users' AS table FROM users WHERE email = $1

                 UNION

                 SELECT email, 'organizations' AS table FROM organizations WHERE email = $1`,

        [email]
      );

      if (userResult.rows.length === 0) {
        req.flash("error", "No account found with that email address.");

        return res.redirect("/account/forget-password");
      }

      const user = userResult.rows[0];

      const table = user.table;

      const token = crypto.randomBytes(32).toString("hex");

      const hashedToken = crypto

        .createHash("sha256")

        .update(token)

        .digest("hex");

      const tokenExpiration = new Date(Date.now() + 15 * 60 * 1000); // 15 minutes from now

      await db.query(
        `UPDATE ${table} SET reset_password_token = $1, reset_password_expires = $2 WHERE email = $3`,

        [hashedToken, tokenExpiration, email]
      );

      await sendPasswordResetEmail(email, token, baseUrl); // Pass BASE_URL here

      req.flash(
        "success",

        "A password reset link has been sent to your email. The link will expire in 15 minutes."
      );

      res.redirect("/account/login");
    } catch (error) {
      console.error("Error in forgetPasswordPost:", error.message);

      req.flash("error", "An error occurred. Please try again.");

      res.redirect("/account/forget-password");
    }
  },

  resetPasswordGet: async (req, res) => {
    const { token } = req.query;

    if (!token) {
      req.flash("error", "Invalid reset link.");

      return res.render("account/resetPassword", {
        title: "Reset Password",

        token: null,

        email: null,
        showFooterTopSection: true,

        messages: { error: req.flash("error"), success: [] },
      });
    }

    const hashedToken = crypto.createHash("sha256").update(token).digest("hex");

    try {
      // Query without checking expiration

      const userResult = await db.query(
        `SELECT email 

                 FROM users WHERE reset_password_token = $1

                 UNION

                 SELECT email 

                 FROM organizations WHERE reset_password_token = $1`,

        [hashedToken]
      );

      if (userResult.rows.length === 0) {
        req.flash("error", "Invalid reset link.");

        return res.render("account/resetPassword", {
          title: "Reset Password",

          token: null,

          email: null,
          showFooterTopSection: true,

          messages: { error: req.flash("error"), success: [] },
        });
      }

      // Extract email

      const email = userResult.rows[0].email;

      res.render("account/resetPassword", {
        title: "Reset Password",

        token,

        email,
        showFooterTopSection: true,
        messages: { error: req.flash("error"), success: [] },
      });
    } catch (error) {
      console.error("Error in resetPasswordGet:", error.message);

      req.flash("error", "An error occurred. Please try again.");

      res.render("account/resetPassword", {
        title: "Reset Password",

        token: null,

        email: null,
        showFooterTopSection: true,
        messages: { error: req.flash("error"), success: [] },
      });
    }
  },

  resetPasswordPost: async (req, res) => {
    const { token, password, confirmPassword } = req.body;

    if (password !== confirmPassword) {
      req.flash("error", "Passwords do not match.");

      return res.render("account/resetPassword", {
        title: "Reset Password",

        token,
        showFooterTopSection: true,
        messages: req.flash(),
      });
    }

    const passwordRegex =
      /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[!@#$%^&*]).{6,}$/;

    if (!passwordRegex.test(password)) {
      req.flash(
        "error",

        "Password must be at least 6 characters long, contain uppercase, lowercase, a number, and a special character."
      );

      return res.render("account/resetPassword", {
        title: "Reset Password",

        token,
        showFooterTopSection: true,
        messages: req.flash(),
      });
    }

    const hashedToken = crypto.createHash("sha256").update(token).digest("hex");

    const hashedPassword = await bcrypt.hash(password, 10);

    try {
      // Update the password for the user or organization

      const userResult = await db.query(
        `UPDATE users SET password = $1, reset_password_token = NULL

                 WHERE reset_password_token = $2

                 RETURNING email`,

        [hashedPassword, hashedToken]
      );

      let email = null;

      if (userResult.rows.length === 0) {
        const orgResult = await db.query(
          `UPDATE organizations SET password = $1, reset_password_token = NULL

                     WHERE reset_password_token = $2

                     RETURNING email`,

          [hashedPassword, hashedToken]
        );

        if (orgResult.rowCount === 0) {
          req.flash("error", "Invalid reset link.");

          return res.render("account/resetPassword", {
            title: "Reset Password",

            token: null,
            showFooterTopSection: true,
            messages: req.flash(),
          });
        }

        email = orgResult.rows[0].email;
      } else {
        email = userResult.rows[0].email;
      }

      // Notify user about the password reset

      await sendPasswordResetConfirmationEmail(email);

      req.flash(
        "success",

        "Password reset successful. A confirmation email has been sent to you."
      );

      res.redirect("/account/login");
    } catch (error) {
      console.error("Error in resetPasswordPost:", error.message);

      req.flash("error", "An error occurred. Please try again.");

      res.render("account/resetPassword", {
        title: "Reset Password",

        token,
        showFooterTopSection: true,
        messages: req.flash(),
      });
    }
  },

  settingsGet: async (req, res, db) => {
    try {
      const sessionUserId = req.session.user?.user_id || req.session.userId;
      const userId = req.query.userId || sessionUserId;
      let orgId = req.session.organizationId;

      if (!orgId && userId) {
        const orgLookup = await db.query(
          "SELECT organization_id FROM users WHERE user_id = $1",
          [userId]
        );
        if (orgLookup.rows.length > 0) {
          orgId = orgLookup.rows[0].organization_id;
        }
      }

      const orgResult = orgId
        ? await db.query(
            `SELECT organization_name, logo, logo_path, font_style, nickname, role, email, paystack_customer_code, first_name, last_name, organization_phone
             FROM organizations 
             WHERE organization_id = $1`,
            [orgId]
          )
        : { rows: [] };

      const planDetailsResult = orgId
        ? await db.query(
            `SELECT o.plan_id, p.plan_name, o.pending_plan_id, o.pending_plan_effective_date, p2.plan_name AS pending_plan_name
             FROM organizations o
             JOIN plans p ON o.plan_id = p.id
             LEFT JOIN plans p2 ON o.pending_plan_id = p2.id
             WHERE o.organization_id = $1`,
            [orgId]
          )
        : { rows: [] };

      const currentPlan = planDetailsResult.rows.length
        ? {
            plan_id: planDetailsResult.rows[0].plan_id,
            plan_name: planDetailsResult.rows[0].plan_name,
          }
        : null;

      const pendingPlan = planDetailsResult.rows[0]?.pending_plan_id
        ? {
            plan_id: planDetailsResult.rows[0].pending_plan_id,
            plan_name: planDetailsResult.rows[0].pending_plan_name,
            effective_date: planDetailsResult.rows[0].pending_plan_effective_date,
          }
        : null;

      const plansResult = orgId
        ? await db.query(`
            SELECT p.id AS plan_id, p.plan_name, p.description,
            COALESCE(
              JSON_AGG(
                json_build_object('feature_name', f.feature_name)
                ORDER BY f.feature_name
              ) FILTER (WHERE f.id IS NOT NULL), '[]'
            ) AS features,
            COALESCE(SUM(f.price_usd), 0) AS total_price
            FROM plans p
            LEFT JOIN plan_features pf ON p.id = pf.plan_id
            LEFT JOIN features f ON pf.feature_id = f.id
            WHERE p.is_active = TRUE
            GROUP BY p.id, p.plan_name, p.description
            ORDER BY p.id;
          `)
        : { rows: [] };

      let user = null;
      if (userId && orgId) {
        const userResult = await db.query(
          `SELECT first_name, last_name, email, account_type 
           FROM users 
           WHERE user_id = $1 AND organization_id = $2`,
          [userId, orgId]
        );
        if (userResult.rows.length > 0) {
          user = userResult.rows[0];
        }
      }

      if (!user && orgId) {
        const orgUserResult = await db.query(
          `SELECT first_name, last_name, email, 'Manager' AS account_type
           FROM organizations
           WHERE organization_id = $1`,
          [orgId]
        );
        if (orgUserResult.rows.length > 0) {
          user = orgUserResult.rows[0];
        }
      }

      const orgRow = orgResult.rows[0] || {};
      let paystackCustomerCode = orgRow.paystack_customer_code || '';
      let paymentMethods = [];
      let defaultPaymentMethod = null;
      let paystackSubaccounts = [];

      if (orgId) {
        try {
          const paystackSubaccountsResult = await db.query(
            `SELECT * FROM paystack_subaccounts` +
              ` WHERE organization_id = $1` +
              ` ORDER BY account_type, is_primary DESC, created_at`,
            [orgId]
          );
          paystackSubaccounts = paystackSubaccountsResult.rows;
        } catch (err) {
          console.error('Error loading Paystack subaccounts:', err.message);
        }
      }

      if (orgId && process.env.PAYSTACK_SECRET_KEY && orgRow.email) {
        if (!paystackCustomerCode) {
          try {
            const customerData = {
              email: orgRow.email,
              first_name: orgRow.first_name || orgRow.organization_name || 'Organization',
              last_name: orgRow.last_name || 'Account',
            };

            const customerResponse = await axios.post(
              'https://api.paystack.co/customer',
              customerData,
              {
                headers: {
                  Authorization: `Bearer ${process.env.PAYSTACK_SECRET_KEY}`,
                  'Content-Type': 'application/json',
                },
              }
            );

            paystackCustomerCode = customerResponse.data.data.customer_code;
            await db.query(
              'UPDATE organizations SET paystack_customer_code = $1 WHERE organization_id = $2',
              [paystackCustomerCode, orgId]
            );
          } catch (error) {
            console.error('Error creating Paystack customer:', error?.message || error);
          }
        }

        if (paystackCustomerCode) {
          try {
            const customerResponse = await axios.get(
              `https://api.paystack.co/customer/${paystackCustomerCode}`,
              {
                headers: {
                  Authorization: `Bearer ${process.env.PAYSTACK_SECRET_KEY}`,
                },
              }
            );

            const customer = customerResponse.data.data;
            if (customer.authorizations && customer.authorizations.length > 0) {
              paymentMethods = customer.authorizations
                .filter((auth) => auth.channel === 'card' && auth.reusable)
                .map((auth) => ({
                  id: auth.authorization_code,
                  brand: auth.brand,
                  last4: auth.last4,
                  expMonth: auth.exp_month,
                  expYear: auth.exp_year,
                  email: auth.email,
                }));
              defaultPaymentMethod = paymentMethods[0] || null;
            }
          } catch (paystackError) {
            console.error('Error fetching Paystack customer:', paystackError.message);
          }
        }
      }

      res.render("account/settings", {
        title: "Settings",
        org: orgRow,
        user: user || {},
        planName: currentPlan ? currentPlan.plan_name : "",
        currentPlan,
        pendingPlan,
        plans: plansResult.rows,
        paymentMethods,
        defaultPaymentMethod,
        paystackSubaccounts,
        paystackCustomerCode,
        passwordVerified: req.session.passwordVerified || false,
        userId,
        messages: req.flash(),
      });
    } catch (error) {
      console.error("Error loading settings page:", error);
      req.flash("error", "Unable to load settings page.");
      res.redirect("/account");
    }
  },

  cancelSubscriptionGet: (req, res) => {
    res.render("account/cancelSubscription", {
      title: "Cancel Subscription",

      messages: req.flash(),
    });
  },

  cancelSubscriptionPost: async (req, res) => {
    const { password, orgName } = req.body;

    const orgId = req.session.organizationId;

    try {
      // Step 1: Fetch organization details (trial status, name, email)

      const orgResult = await db.query(
        `SELECT trial_active_until, organization_name, email FROM organizations WHERE organization_id = $1`,

        [orgId]
      );

      if (orgResult.rows.length === 0) {
        req.flash("error", "Organization not found.");

        return res.redirect("/account/update");
      }
      const { trial_active_until, organization_name, email } =
        orgResult.rows[0];

      // Step 2: Check for next_payment_end_date in latest payment

      const paymentResult = await db.query(
        `SELECT next_payment_end_date FROM payments WHERE organization_id = $1 ORDER BY created_at DESC LIMIT 1`,

        [orgId]
      );

      const now = new Date();

      let scheduledHoldDate = null;

      let immediateHold = false;

      if (trial_active_until && new Date(trial_active_until) > now) {
        // Free trial is active, put org on hold immediately

        await db.query(
          `UPDATE organizations SET on_hold = true, hold_by = 'User', trial_active_until = NULL, scheduled_hold_date = NOW() WHERE organization_id = $1`,

          [orgId]
        );

        // ✅ CRITICAL FIX: Deactivate all stored cards to prevent future charges
        await db.query(
          `UPDATE stored_cards SET is_active = false WHERE organization_id = $1`,

          [orgId]
        );

        // ✅ CRITICAL FIX: Set payment status to cancelled
        await db.query(
          `UPDATE payments SET status = 'cancelled' WHERE organization_id = $1`,

          [orgId]
        );

        scheduledHoldDate = now;

        immediateHold = true;
      } else if (
        paymentResult.rows.length > 0 &&
        paymentResult.rows[0].next_payment_end_date
      ) {
        // Schedule hold for the end of the current paid period
        scheduledHoldDate = new Date(
          paymentResult.rows[0].next_payment_end_date
        );
        await db.query(
          `UPDATE organizations SET scheduled_hold_date = $1, hold_by = 'User' WHERE organization_id = $2`,

          [scheduledHoldDate, orgId]
        );

        // ✅ CRITICAL FIX: Set payment status to cancelled (will take effect after billing period)
        await db.query(
          `UPDATE payments SET status = 'cancelled' WHERE organization_id = $1`,

          [orgId]
        );

        // ✅ CRITICAL FIX: Deactivate all stored cards to prevent future charges
        await db.query(
          `UPDATE stored_cards SET is_active = false WHERE organization_id = $1`,

          [orgId]
        );

        immediateHold = false;
      } else {
        // No payment info, put org on hold immediately

        await db.query(
          `UPDATE organizations SET on_hold = true, hold_by = 'User', scheduled_hold_date = NOW() WHERE organization_id = $1`,

          [orgId]
        );

        // ✅ CRITICAL FIX: Deactivate all stored cards to prevent future charges
        await db.query(
          `UPDATE stored_cards SET is_active = false WHERE organization_id = $1`,

          [orgId]
        );

        // ✅ CRITICAL FIX: Set payment status to cancelled
        await db.query(
          `UPDATE payments SET status = 'cancelled' WHERE organization_id = $1`,

          [orgId]
        );

        scheduledHoldDate = now;

        immediateHold = true;
      }

      try {
        await sendCancellationEmail(
          organization_name,

          req.session.firstName,

          email,

          scheduledHoldDate
        );
      } catch (e) {
        // Ignore email errors
      }

      if (immediateHold) {
        // Log user out and show cancellation message

        req.session.destroy((err) => {
          res.clearCookie("connect.sid", { path: "/" });

          req.flash(
            "error",

            "Your account has been cancelled and placed on hold. If you need further assistance, please contact support."
          );

          return res.redirect("/account/login");
        });
      } else {
        // Do not log out, just redirect to update page

        req.flash(
          "success",

          "Your subscription has been cancelled. You will retain access until the end of your current billing period."
        );

        return res.redirect("/account/update");
      }
    } catch (error) {
      console.error("Error cancelling subscription:", error);

      req.flash("error", "An unexpected error occurred. Please try again.");

      res.redirect("/account/cancel-subscription");
    }
  },

  resumeOrCancelCancellationPost: async (req, res) => {
    const orgId = req.session.organizationId;

    try {
      // Only update the org's scheduled_hold_date and hold_by fields

      const orgResult = await db.query(
        `SELECT organization_id FROM organizations WHERE organization_id = $1`,

        [orgId]
      );

      if (orgResult.rows.length === 0) {
        req.flash("error", "Organization not found.");

        return res.redirect("/account/update");
      }

      await db.query(
        `UPDATE organizations 

                 SET scheduled_hold_date = NULL, hold_by = NULL, on_hold = false 

                 WHERE organization_id = $1`,

        [orgId]
      );

      req.flash(
        "success",
        "Your organization has been resumed successfully. Payments will continue via Paystack."
      );
      return res.redirect("/account/update");
    } catch (error) {
      console.error("❌ Error resuming organization:", error);

      req.flash("error", "Failed to resume organization. Please try again.");

      return res.redirect("/account/update");
    }
  },

  updatePlanGet: async (req, res) => {
    try {
      const orgId = req.session.organizationId;

      // Fetch the organization's current and pending plan

      const orgResult = await db.query(
        `SELECT o.plan_id, p.plan_name, o.pending_plan_id, o.pending_plan_effective_date, p2.plan_name AS pending_plan_name

                 FROM organizations o 

                 JOIN plans p ON o.plan_id = p.id 

                 LEFT JOIN plans p2 ON o.pending_plan_id = p2.id

                 WHERE o.organization_id = $1`,

        [orgId]
      );

      if (orgResult.rows.length === 0) {
        req.flash("error", "Organization not found.");

        return res.redirect("/account");
      }

      const orgData = orgResult.rows[0];
      const currentPlan = {
        plan_id: orgData.plan_id,
        plan_name: orgData.plan_name,
      };
      const pendingPlan = orgData.pending_plan_id
        ? {
            plan_id: orgData.pending_plan_id,
            plan_name: orgData.pending_plan_name,
            effective_date: orgData.pending_plan_effective_date,
          }
        : null;

      // Fetch available plans

      const plansResult = await db.query(`

                SELECT p.id AS plan_id, p.plan_name, p.description, 

                COALESCE(

                  JSON_AGG(

                    json_build_object('feature_name', f.feature_name)

                    ORDER BY f.feature_name

                  ) FILTER (WHERE f.id IS NOT NULL), '[]'

                ) AS features,

                COALESCE(SUM(f.price_usd), 0) AS total_price

                FROM plans p

                LEFT JOIN plan_features pf ON p.id = pf.plan_id

                LEFT JOIN features f ON pf.feature_id = f.id

                WHERE p.is_active = TRUE

                GROUP BY p.id, p.plan_name, p.description

                ORDER BY p.id;

            `);

      res.render("account/updatePlan", {
        title: "Update Subscription Plan",

        currentPlan,

        pendingPlan,

        plans: plansResult.rows, // Make sure this is not empty

        messages: req.flash(),
      });
    } catch (error) {
      console.error("Error fetching plans:", error);

      req.flash("error", "Failed to load plans.");

      res.redirect("/account");
    }
  },

  updatePlanPost: async (req, res) => {
    try {
      const { newPlanId, redirectTo } = req.body;

      const orgId = req.session.organizationId;

      // Fetch the current plan of the organization

      const currentPlanResult = await db.query(
        "SELECT plan_id FROM organizations WHERE organization_id = $1",

        [orgId]
      );

      if (currentPlanResult.rows.length === 0) {
        req.flash("error", "Organization not found.");

        return res.redirect(redirectTo || "/account/update-plan");
      }

      const currentPlanId = currentPlanResult.rows[0].plan_id;

      // Prevent selecting the same plan

      if (parseInt(newPlanId) === parseInt(currentPlanId)) {
        req.flash(
          "error",

          "⚠️ You are already on this plan. Please select a different one to upgrade."
        );

        return res.redirect(redirectTo || "/account/update-plan");
      }

      // Fetch the price of the current and new plan

      const planPrices = await db.query(
        `SELECT p.id, COALESCE(SUM(f.price_usd), 0) AS total_price

         FROM plans p

         LEFT JOIN plan_features pf ON p.id = pf.plan_id

         LEFT JOIN features f ON pf.feature_id = f.id

         WHERE p.id = $1 OR p.id = $2

         GROUP BY p.id`,

        [currentPlanId, newPlanId]
      );
      let currentPrice = 0,
        newPrice = 0;
      for (const row of planPrices.rows) {
        if (parseInt(row.id) === parseInt(currentPlanId))
          currentPrice = parseFloat(row.total_price);
        if (parseInt(row.id) === parseInt(newPlanId))
          newPrice = parseFloat(row.total_price);
      }

      // If downgrading (new plan is cheaper), schedule for next payment period

      if (newPrice < currentPrice) {
        // Get next payment end date

        const paymentResult = await db.query(
          `SELECT next_payment_end_date FROM payments WHERE organization_id = $1 ORDER BY created_at DESC LIMIT 1`,

          [orgId]
        );

        let effectiveDate = null;
        if (
          paymentResult.rows.length > 0 &&
          paymentResult.rows[0].next_payment_end_date
        ) {
          effectiveDate = paymentResult.rows[0].next_payment_end_date;
        }

        if (effectiveDate) {
          await db.query(
            `UPDATE organizations SET pending_plan_id = $1, pending_plan_effective_date = $2 WHERE organization_id = $3`,

            [newPlanId, effectiveDate, orgId]
          );
          req.flash(
            "success",
            `Your plan will be changed to the selected plan on ${new Date(
              effectiveDate
            ).toLocaleDateString()}. You will retain your current plan until then.`
          );
        } else {
          // If no payment info, downgrade immediately

          await db.query(
            `UPDATE organizations SET plan_id = $1, pending_plan_id = NULL, pending_plan_effective_date = NULL WHERE organization_id = $2`,

            [newPlanId, orgId]
          );
          req.flash(
            "success",
            "Your plan has been changed to the selected plan."
          );
        }
      } else {
        // Upgrade or same price: change immediately

        await db.query(
          `UPDATE organizations SET plan_id = $1, pending_plan_id = NULL, pending_plan_effective_date = NULL WHERE organization_id = $2`,

          [newPlanId, orgId]
        );
        req.flash(
          "success",
          "Your plan has been changed to the selected plan."
        );
      }

      return res.redirect(redirectTo || "/account/update-plan");
    } catch (error) {
      console.error("Error updating plan:", error);

      req.flash("error", "❌ Failed to update plan.");

      return res.redirect(redirectTo || "/account/update-plan");
    }
  },

  addFlutterwaveAccountPost: async (req, res) => {
    const { organizationId, organizationName } = req.session;

    const {
      account_number,

      account_name,

      bank_or_provider,

      country,

      account_type,

      makePrimary,
    } = req.body;

    const safeAccountNumber = String(account_number || "").trim();

    const safeAccountName = String(account_name || "").trim();

    const safeBankOrProvider = String(bank_or_provider || "").trim();

    const safeCountry = country || "GH";

    const safePaymentType = account_type || "bank";

    const isPrimary = makePrimary === "on";

    try {
      // Enforce max 1 subaccount per type (bank/momo) per org

      const existingAccounts = await db.query(
        `SELECT * FROM flutterwave_accounts WHERE organization_id = $1 AND account_type = $2`,

        [organizationId, safePaymentType]
      );

      if (existingAccounts.rows.length > 0) {
        const message = `Only one ${safePaymentType.toUpperCase()} subaccount is allowed.`;

        if (req.headers["content-type"] === "application/json") {
          return res.status(400).json({ success: false, message });
        } else {
          req.flash("error", message);

          return res.redirect("/account/update-card");
        }
      }

      // Create subaccount in Flutterwave

      const response = await axios.post(
        "https://api.flutterwave.com/v3/subaccounts",

        {
          account_bank: safeBankOrProvider,

          account_number: safeAccountNumber,

          business_name: `${organizationName}-${organizationId}`,

          business_email: `${organizationName

            .replace(/\s+/g, "")

            .toLowerCase()}@managira.com`,

          business_contact: safeAccountName,

          business_contact_mobile: "0000000000",

          country: safeCountry,

          split_type: "percentage",

          split_value: 0.9,
        },

        {
          headers: {
            Authorization: `Bearer ${process.env.FLW_SECRET_KEY}`,
          },
        }
      );

      const subaccountId = response.data?.data?.subaccount_id;

      if (!subaccountId)
        throw new Error("No subaccount ID returned from Flutterwave.");

      // Set as primary (unset others)

      if (isPrimary) {
        await db.query(
          `UPDATE flutterwave_accounts SET is_primary = FALSE

           WHERE organization_id = $1 AND account_type = $2`,

          [organizationId, safePaymentType]
        );
      }

      // Insert into DB

      await db.query(
        `INSERT INTO flutterwave_accounts (

          organization_id, account_type, account_name, account_number,

          bank_or_provider, country, subaccount_id, is_primary

        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,

        [
          organizationId,

          safePaymentType,

          safeAccountName,

          safeAccountNumber,

          safeBankOrProvider,

          safeCountry,

          subaccountId,

          isPrimary,
        ]
      );

      if (req.headers["content-type"] === "application/json") {
        return res.status(200).json({ success: true });
      } else {
        req.flash("success", "🎉 Flutterwave account connected successfully.");

        return res.redirect("/account/update-card");
      }
    } catch (error) {
      const message =
        error.response?.data?.message || error.message || "Unknown error";

      console.error("❌ Flutterwave error:", message);

      if (req.headers["content-type"] === "application/json") {
        return res.status(500).json({ success: false, message });
      } else {
        req.flash("error", `Failed to connect Flutterwave account: ${message}`);

        return res.redirect("/account/update-card");
      }
    }
  },

  deleteFlutterwaveAccount: async (req, res) => {
    const { id } = req.body;

    try {
      await db.query(`DELETE FROM flutterwave_accounts WHERE id = $1`, [id]);

      res.json({ success: true });
    } catch (err) {
      console.error("Error deleting account:", err);

      res.json({ success: false, message: "Delete failed." });
    }
  },

  getFlutterwaveAccountById: async (req, res) => {
    const { id } = req.params;

    const { organizationId } = req.session;

    if (!organizationId) {
      console.error("❌ Missing organizationId in session.");

      return res.status(401).json({ success: false, message: "Unauthorized" });
    }

    try {
      const result = await db.query(
        `SELECT id, account_type, account_name, account_number, bank_or_provider, country

         FROM flutterwave_accounts

         WHERE id = $1 AND organization_id = $2`,

        [id, organizationId]
      );

      if (result.rows.length === 0) {
        return res

          .status(404)

          .json({ success: false, message: "Account not found" });
      }

      return res.json({ success: true, account: result.rows[0] });
    } catch (error) {
      console.error("❌ Error fetching Flutterwave account:", error);

      res.status(500).json({ success: false, message: "Server error" });
    }
  },

  updateFlutterwaveAccount: async (req, res) => {
    const {
      id,

      account_name,

      account_number,

      bank_or_provider,

      country,

      account_type,
    } = req.body;

    const { organizationId } = req.session;

    try {
      const safeAccountName = String(account_name || "").trim();

      const safeAccountNumber = String(account_number || "").trim();

      const safeBankOrProvider = String(bank_or_provider || "").trim();

      const safeCountry = country || "GH";

      const safeAccountType = account_type || "bank";

      const result = await db.query(
        `UPDATE flutterwave_accounts

         SET account_name = $1, account_number = $2,

             bank_or_provider = $3, country = $4

         WHERE id = $5 AND organization_id = $6 AND account_type = $7`,

        [
          safeAccountName,

          safeAccountNumber,

          safeBankOrProvider,

          safeCountry,

          id,

          organizationId,

          safeAccountType,
        ]
      );

      res.json({ success: true, message: "Account updated successfully" });
    } catch (error) {
      console.error("❌ Error updating Flutterwave account:", error);

      res

        .status(500)

        .json({ success: false, message: "Failed to update account" });
    }
  },

  deleteFlutterwaveAccount: async (req, res) => {
    const { id } = req.params;

    const { organizationId } = req.session;

    try {
      // Step 1: Get the subaccount_id from DB

      const result = await db.query(
        `SELECT subaccount_id FROM flutterwave_accounts

         WHERE id = $1 AND organization_id = $2`,

        [id, organizationId]
      );

      if (result.rows.length === 0) {
        return res

          .status(404)

          .json({ success: false, message: "Account not found" });
      }

      const subaccountId = result.rows[0].subaccount_id;

      // Step 2: Delete from Flutterwave (optional – Flutterwave might not fully delete)

      try {
        await axios.delete(
          `https://api.flutterwave.com/v3/subaccounts/${subaccountId}`,

          {
            headers: {
              Authorization: `Bearer ${process.env.FLW_SECRET_KEY}`,
            },
          }
        );
      } catch (flwErr) {
        console.warn(
          "⚠️ Flutterwave subaccount deletion failed (may not be critical):",

          flwErr.response?.data || flwErr.message
        );

        // Optionally ignore if subaccount is already gone
      }

      // Step 3: Delete locally

      await db.query(
        `DELETE FROM flutterwave_accounts WHERE id = $1 AND organization_id = $2`,

        [id, organizationId]
      );

      res.json({ success: true });
    } catch (err) {
      console.error("❌ Error deleting Flutterwave account:", err);

      res.status(500).json({ success: false, message: "Delete failed." });
    }
  },

  // ✅ Card tokenization without payment

  tokenizeCard: async (req, res) => {
    try {
      const { cardNumber, expiryMonth, expiryYear, cvv } = req.body;
      const orgId = req.session.organizationId;

      if (!cardNumber || !expiryMonth || !expiryYear || !cvv) {
        return res.status(400).json({
          success: false,
          message: "All card details are required",
        });
      }

      // Get organization details

      const orgResult = await db.query(
        "SELECT email AS organization_email, paystack_customer_code FROM organizations WHERE organization_id = $1",
        [orgId]
      );

      if (orgResult.rows.length === 0) {
        return res.status(404).json({
          success: false,
          message: "Organization not found",
        });
      }

      const { organization_email, paystack_customer_code } = orgResult.rows[0];
      let customerCode = paystack_customer_code;

      // Create customer if doesn't exist

      if (!customerCode) {
        const customerData = {
          email: organization_email,
          first_name: "Organization",
          last_name: "Account",
        };

        const customerResponse = await axios.post(
          "https://api.paystack.co/customer",
          customerData,
          {
            headers: {
              Authorization: `Bearer ${process.env.PAYSTACK_SECRET_KEY}`,
              "Content-Type": "application/json",
            },
          }
        );

        customerCode = customerResponse.data.data.customer_code;

        // Update organization with customer code

        await db.query(
          "UPDATE organizations SET paystack_customer_code = $1 WHERE organization_id = $2",
          [customerCode, orgId]
        );
      }

      // Use Paystack's charge endpoint with a minimal amount for tokenization

      const chargeData = {
        email: organization_email,
        amount: 50,
        card: {
          number: cardNumber,
          cvv: cvv,
          expiry_month: expiryMonth,
          expiry_year: expiryYear,
        },
        customer: customerCode,
        metadata: {
          tokenization_only: true,
          purpose: "Card tokenization",
        },
      };

      const chargeResponse = await axios.post(
        "https://api.paystack.co/charge",
        chargeData,
        {
          headers: {
            Authorization: `Bearer ${process.env.PAYSTACK_SECRET_KEY}`,
            "Content-Type": "application/json",
          },
        }
      );

      const payload = await buildChargeResponse(db, orgId, chargeResponse.data);

      if (payload.success || payload.nextStep) {
        return res.json(payload);
      }

      console.error("�?O Card tokenization failed:", chargeResponse.data);
      return res.status(400).json(payload);
    } catch (error) {
      console.error(
        "�?O Error in card tokenization:",
        error.response?.data || error.message
      );

      if (error.response?.data?.message) {
        return res.status(400).json({
          success: false,
          message: error.response.data.message,
        });
      }

      return res.status(500).json({
        success: false,
        message: "Failed to add card. Please try again.",
      });
    }
  },

  tokenizeCardSubmitPin: async (req, res) => {
    try {
      const { reference, pin } = req.body;
      const orgId = req.session.organizationId;

      if (!reference || !pin) {
        return res.status(400).json({
          success: false,
          message: "Reference and PIN are required",
        });
      }

      const chargeResponse = await axios.post(
        "https://api.paystack.co/charge/submit_pin",
        { reference, pin },
        {
          headers: {
            Authorization: `Bearer ${process.env.PAYSTACK_SECRET_KEY}`,
            "Content-Type": "application/json",
          },
        }
      );

      const payload = await buildChargeResponse(db, orgId, chargeResponse.data);

      if (payload.success || payload.nextStep) {
        return res.json(payload);
      }

      return res.status(400).json(payload);
    } catch (error) {
      console.error(
        "�?O Error submitting card PIN:",
        error.response?.data || error.message
      );

      if (error.response?.data?.message) {
        return res.status(400).json({
          success: false,
          message: error.response.data.message,
        });
      }

      return res.status(500).json({
        success: false,
        message: "Failed to submit PIN. Please try again.",
      });
    }
  },

  tokenizeCardSubmitOtp: async (req, res) => {
    try {
      const { reference, otp } = req.body;
      const orgId = req.session.organizationId;

      if (!reference || !otp) {
        return res.status(400).json({
          success: false,
          message: "Reference and OTP are required",
        });
      }

      const chargeResponse = await axios.post(
        "https://api.paystack.co/charge/submit_otp",
        { reference, otp },
        {
          headers: {
            Authorization: `Bearer ${process.env.PAYSTACK_SECRET_KEY}`,
            "Content-Type": "application/json",
          },
        }
      );

      const payload = await buildChargeResponse(db, orgId, chargeResponse.data);

      if (payload.success || payload.nextStep) {
        return res.json(payload);
      }

      return res.status(400).json(payload);
    } catch (error) {
      console.error(
        "�?O Error submitting OTP:",
        error.response?.data || error.message
      );

      if (error.response?.data?.message) {
        return res.status(400).json({
          success: false,
          message: error.response.data.message,
        });
      }

      return res.status(500).json({
        success: false,
        message: "Failed to submit OTP. Please try again.",
      });
    }
  },

  tokenizeCardSubmitPhone: async (req, res) => {
    try {
      const { reference, phone } = req.body;
      const orgId = req.session.organizationId;

      if (!reference || !phone) {
        return res.status(400).json({
          success: false,
          message: "Reference and phone number are required",
        });
      }

      const chargeResponse = await axios.post(
        "https://api.paystack.co/charge/submit_phone",
        { reference, phone },
        {
          headers: {
            Authorization: `Bearer ${process.env.PAYSTACK_SECRET_KEY}`,
            "Content-Type": "application/json",
          },
        }
      );

      const payload = await buildChargeResponse(db, orgId, chargeResponse.data);

      if (payload.success || payload.nextStep) {
        return res.json(payload);
      }

      return res.status(400).json(payload);
    } catch (error) {
      console.error(
        "�?O Error submitting phone number:",
        error.response?.data || error.message
      );

      if (error.response?.data?.message) {
        return res.status(400).json({
          success: false,
          message: error.response.data.message,
        });
      }

      return res.status(500).json({
        success: false,
        message: "Failed to submit phone number. Please try again.",
      });
    }
  },

  // ✅ Paystack Subaccount Management

  addPaystackSubaccountPost: async (req, res) => {
    const {
      account_type,
      business_name,
      account_number,
      bank_code,
      bank_name,
      momo_number,
      momo_provider,
      account_holder_name,
    } = req.body;
    const orgId = req.session.organizationId;

    try {
      if (!process.env.PAYSTACK_SECRET_KEY) {
        return res.status(500).json({
          success: false,
          message: "Paystack secret key is not configured.",
        });
      }

      if (!account_type || !business_name) {
        return res.status(400).json({
          success: false,
          message: "Account type and business name are required",
        });
      }

      // Validate fields based on account type
      if (account_type === "bank") {
        if (!account_number || !bank_code || !bank_name) {
          return res.status(400).json({
            success: false,
            message:
              "Account number, bank code, and bank name are required for bank accounts",
          });
        }
      } else if (account_type === "mobile_money") {
        if (!momo_number || !momo_provider || !account_holder_name) {
          return res.status(400).json({
            success: false,
            message:
              "Mobile money number, provider, and account holder name are required for mobile money accounts",
          });
        }
      }

      // Check if organization already has this account type

      const existingResult = await db.query(
        `SELECT * FROM paystack_subaccounts WHERE organization_id = $1 AND account_type = $2`,

        [orgId, account_type]
      );

      if (existingResult.rows.length > 0) {
        return res.status(400).json({
          success: false,
          message: `A ${account_type} account already exists. Please edit the existing one or delete it first.`,
        });
      }

      const paystackHeaders = {
        headers: {
          Authorization: `Bearer ${process.env.PAYSTACK_SECRET_KEY}`,
          "Content-Type": "application/json",
        },
      };
      const currency = "GHS";

      if (account_type === "bank") {
        // Ghana: Use Transfer Recipients (visible in Paystack dashboard under Transfers > Recipients)
        console.log(
          "🏦 Creating Ghana bank transfer recipient via Paystack..."
        );

        // Check if this is the first account of this type

        const existingOfTypeResult = await db.query(
          `SELECT * FROM paystack_subaccounts WHERE organization_id = $1 AND account_type = $2`,

          [orgId, account_type]
        );

        const isFirstOfType = existingOfTypeResult.rows.length === 0;

        // Get Ghana bank list from Paystack to resolve code if needed

        let resolvedBankCode = bank_code;

        try {
          const banksResp = await axios.get(
            `https://api.paystack.co/bank?country=ghana`,
            paystackHeaders
          );
          const banks = banksResp.data?.data || [];

          // Match by exact code first, else by name includes
          const match =
            banks.find(
              (b) =>
                String(b.code).toLowerCase() === String(bank_code).toLowerCase()
            ) ||
            banks.find((b) =>
              (bank_name || "")
                .toLowerCase()
                .includes(String(b.name).toLowerCase())
            );
          if (match) {
            resolvedBankCode = match.code;
          } else {
            console.warn(
              "⚠️ Could not resolve Ghana bank code from provided values, proceeding with provided bank_code"
            );
          }
        } catch (e) {
          console.warn(
            "⚠️ Failed to fetch Ghana banks from Paystack:",
            e.response?.data || e.message
          );
        }

        // Create Paystack Transfer Recipient for Ghana bank

        const recipientPayload = {
          type: "ghipss",
          name: business_name,

          account_number,

          bank_code: resolvedBankCode,
          currency,
        };

        console.log(
          "📤 Creating bank recipient:",
          JSON.stringify(recipientPayload)
        );
        const recipientResp = await axios.post(
          "https://api.paystack.co/transferrecipient",
          recipientPayload,
          paystackHeaders
        );
        if (
          !recipientResp.data?.status ||
          !recipientResp.data?.data?.recipient_code
        ) {
          throw new Error(
            recipientResp.data?.message || "Failed to create bank recipient"
          );
        }

        const recipientCode = recipientResp.data.data.recipient_code;

        // Save to local database (store recipient_code in subaccount_code column for compatibility)

        await db.query(
          `INSERT INTO paystack_subaccounts (

            organization_id, account_type, business_name, account_number, 

            bank_code, bank_name, subaccount_code, is_primary

          ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,

          [
            orgId,

            account_type,

            business_name,

            account_number,

            resolvedBankCode,

            bank_name,

            recipientCode,
            isFirstOfType,
          ]
        );

        console.log("✅ Paystack bank recipient created:", recipientCode);
        return res.json({
          success: true,
          message: "Bank account connected via Paystack (Recipient)",
          recipient_code: recipientCode,
        });
      } else if (account_type === "mobile_money") {
        // Ghana MoMo: Use Transfer Recipients with type 'mobile_money'

        console.log("📱 Creating MoMo transfer recipient via Paystack...");

        if (!momo_number || !momo_provider || !account_holder_name) {
          return res.status(400).json({
            success: false,
            message:
              "Mobile money number, provider, and account holder name are required.",
          });
        }

        // Check if this is the first account of this type

        const existingOfTypeResult = await db.query(
          `SELECT * FROM paystack_subaccounts WHERE organization_id = $1 AND account_type = $2`,

          [orgId, account_type]
        );

        const isFirstOfType = existingOfTypeResult.rows.length === 0;

        // Map to Paystack provider codes
        let providerCode = "MTN";
        const prov = String(momo_provider || "").toLowerCase();
        if (prov.includes("vod")) providerCode = "VODAFONE";
        else if (prov.includes("airtel") || prov.includes("tigo"))
          providerCode = "AIRTEL_TIGO";

        const recipientPayload = {
          type: "mobile_money",
          name: account_holder_name || business_name,

          account_number: momo_number,

          bank_code: providerCode,
          currency,
        };

        console.log(
          "📤 Creating MoMo recipient:",
          JSON.stringify(recipientPayload)
        );
        const recipientResp = await axios.post(
          "https://api.paystack.co/transferrecipient",
          recipientPayload,
          paystackHeaders
        );
        if (
          !recipientResp.data?.status ||
          !recipientResp.data?.data?.recipient_code
        ) {
          throw new Error(
            recipientResp.data?.message || "Failed to create MoMo recipient"
          );
        }

        const recipientCode = recipientResp.data.data.recipient_code;

        await db.query(
          `INSERT INTO paystack_subaccounts (

            organization_id, account_type, business_name, momo_number, 

            momo_provider, account_holder_name, subaccount_code, is_primary

          ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,

          [
            orgId,

            account_type,

            business_name,

            momo_number,

            momo_provider,

            account_holder_name,

            recipientCode,
            isFirstOfType,
          ]
        );

        console.log("✅ Paystack MoMo recipient created:", recipientCode);
        return res.json({
          success: true,
          message: "Mobile Money account connected via Paystack (Recipient)",
          recipient_code: recipientCode,
        });
      }
    } catch (error) {
      const message = error.response?.data?.message || error.message;

      console.error("❌ Paystack subaccount error:", message);

      // If Paystack rejects the bank details, create a local entry instead
      if (
        message.includes("Account details are invalid") ||
        message.includes("Invalid")
      ) {
        console.log(
          "🔄 Paystack rejected bank details, creating local entry..."
        );

        try {
          // Create local bank account entry (similar to mobile money)
          const isFirstAccount =
            (
              await db.query(
                `SELECT * FROM paystack_subaccounts WHERE organization_id = $1`,
                [orgId]
              )
            ).rows.length === 0;

          const localSubaccountCode = `SUBACCT_bank_${orgId}_${Date.now()}`;

          await db.query(
            `INSERT INTO paystack_subaccounts (

              organization_id, account_type, business_name, account_number, 

              bank_code, bank_name, subaccount_code, is_primary

            ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,

            [
              orgId,

              account_type,

              business_name,

              account_number,

              bank_code,

              bank_name,

              localSubaccountCode,
              isFirstAccount,
            ]
          );

          console.log("✅ Local bank account created:", localSubaccountCode);

          return res.json({
            success: true,
            message:
              "Bank account saved locally (Paystack integration pending)",
          });
        } catch (localError) {
          console.error("❌ Failed to create local bank account:", localError);

          return res.status(500).json({
            success: false,
            message: "Failed to save bank account",
          });
        }
      }

      if (message.includes("already exists")) {
        return res.status(400).json({
          success: false,
          message: "This account is already registered with Paystack",
        });
      }

      return res.status(500).json({
        success: false,
        message: `Failed to connect account: ${message}`,
      });
    }
  },

  deletePaystackSubaccount: async (req, res) => {
    try {
      const { id } = req.params;

      await db.query(`DELETE FROM paystack_subaccounts WHERE id = $1`, [id]);

      res.json({ success: true });
    } catch (err) {
      console.error("❌ Error deleting Paystack subaccount:", err);

      res.status(500).json({ success: false, message: "Delete failed." });
    }
  },

  getPaystackSubaccountById: async (req, res) => {
    try {
      const { id } = req.params;

      const result = await db.query(
        `SELECT id, organization_id, account_type, business_name, 

                account_number, bank_code, bank_name, 

                momo_number, momo_provider, account_holder_name,

                subaccount_code, is_primary, created_at

         FROM paystack_subaccounts

         WHERE id = $1`,

        [id]
      );

      if (result.rows.length === 0) {
        return res
          .status(404)
          .json({ success: false, message: "Account not found." });
      }

      res.json({ success: true, account: result.rows[0] });
    } catch (err) {
      console.error("❌ Error fetching Paystack subaccount:", err);

      res.status(500).json({ success: false, message: "Fetch failed." });
    }
  },

  updatePaystackSubaccount: async (req, res) => {
    try {
      const id = req.params.id || req.body.id;
      const {
        business_name,

        account_type,

        // Bank fields

        account_number,

        bank_code,

        bank_name,

        // Mobile money fields

        momo_number,

        momo_provider,
        account_holder_name,
      } = req.body;

      const orgId = req.session.organizationId;

      // Validate required fields based on account type
      if (account_type === "bank") {
        if (!business_name || !account_number || !bank_code || !bank_name) {
          return res.status(400).json({
            success: false,
            message:
              "Business name, account number, bank code, and bank name are required for bank accounts.",
          });
        }
      } else if (account_type === "mobile_money") {
        if (
          !business_name ||
          !momo_number ||
          !momo_provider ||
          !account_holder_name
        ) {
          return res.status(400).json({
            success: false,
            message:
              "Business name, mobile money number, provider, and account holder name are required for mobile money accounts.",
          });
        }
      }

      // First check if account exists

      const existingAccount = await db.query(
        "SELECT id, subaccount_code FROM paystack_subaccounts WHERE id = $1 AND organization_id = $2",
        [id, orgId]
      );

      if (existingAccount.rows.length === 0) {
        return res
          .status(404)
          .json({ success: false, message: "Account not found." });
      }

      const subaccountCode = existingAccount.rows[0].subaccount_code;
      let updateSuccess = false; // We no longer update Paystack here; create a new recipient instead if bank details change

      // Update local database

      const updateQuery = `

        UPDATE paystack_subaccounts 

        SET business_name = $1,

            account_type = $2,

            account_number = $3,

            bank_code = $4,

            bank_name = $5,

            momo_number = $6,

            momo_provider = $7,

            account_holder_name = $8,

            updated_at = CURRENT_TIMESTAMP

        WHERE id = $9 AND organization_id = $10

        RETURNING *

      `;

      const result = await db.query(updateQuery, [
        business_name,

        account_type,
        account_type === "bank" ? account_number : null,
        account_type === "bank" ? bank_code : null,
        account_type === "bank" ? bank_name : null,
        account_type === "mobile_money" ? momo_number : null,
        account_type === "mobile_money" ? momo_provider : null,
        account_type === "mobile_money" ? account_holder_name : null,
        id,
        orgId,
      ]);

      console.log("✅ Paystack subaccount updated:", id);

      res.json({
        success: true,

        message: "Account updated successfully.",

        account: result.rows[0],
        paystack_updated: updateSuccess,
      });
    } catch (err) {
      console.error("❌ Error updating Paystack subaccount:", err);

      res.status(500).json({ success: false, message: "Update failed." });
    }
  },

  setPaystackSubaccountPrimary: async (req, res) => {
    try {
      const { id, account_type } = req.body;

      const orgId = req.session.organizationId;

      // Set all accounts of this type to non-primary

      await db.query(
        `UPDATE paystack_subaccounts SET is_primary = FALSE

         WHERE organization_id = $1 AND account_type = $2`,

        [orgId, account_type]
      );

      // Set selected account as primary

      await db.query(
        `UPDATE paystack_subaccounts SET is_primary = TRUE

         WHERE id = $1 AND organization_id = $2`,

        [id, orgId]
      );

      res.json({ success: true });
    } catch (err) {
      console.error("❌ Error setting primary Paystack subaccount:", err);

      res.status(500).json({ success: false, message: "Update failed." });
    }
  },
};

accountController.sendBrandedReceiptEmail = sendBrandedReceiptEmail;

accountController.sendRegistrationSuccessEmail = sendRegistrationSuccessEmail;

accountController.sendInvoiceEmail = sendInvoiceEmail;

accountController.sendCancellationEmail = sendCancellationEmail;

module.exports = accountController;













