// Helper to parse truthy values from form/query/session
function parseTruthyFlag(val) {
  if (typeof val === 'boolean') return val;
  if (typeof val === 'number') return val === 1;
  if (typeof val === 'string') {
    return val === '1' || val.toLowerCase() === 'true' || val === 'on';
  }
  return false;
}

function startOfDayLocal(date) {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  return d;
}

function formatDateForInput(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function parseDateInput(value) {
  if (typeof value !== "string") {
    return null;
  }
  const trimmed = value.trim();
  const datePattern = /^(\d{4})-(\d{2})-(\d{2})$/;
  const match = trimmed.match(datePattern);
  if (!match) {
    return null;
  }
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const parsed = new Date(year, month - 1, day);
  parsed.setHours(0, 0, 0, 0);

  if (
    parsed.getFullYear() !== year ||
    parsed.getMonth() !== month - 1 ||
    parsed.getDate() !== day
  ) {
    return null;
  }

  return parsed;
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

const axios = require("axios");

const he = require("he");

const { sendEmailSafely, renderCleanEmail } = require("../utils/emailHelper");
const {
  getCurrencyProfileForRequest,
  localizeUsdAmount,
  formatCurrencyAmount,
} = require("../utils/currencyLocalization");
const {
  getFreeTrialSettings,
  formatFreeTrialLength,
  hasEmailLockedTrial,
} = require("../utils/freeTrial");
const { getPaystackSettings } = require("../utils/paystackConfig");
const {
  WEEKDAY_OPTIONS,
  parseBoolean,
  normalizeWeekendDaysInput,
  ensureAttendanceCalendarSchema,
  getHolidayCountryOptions,
  getTermRecord,
  getAttendanceCalendarProfile,
  getAttendanceCalendarDays,
  upsertAttendanceCalendarProfile,
  syncPublicHolidayDays,
  upsertManualCalendarDay,
  deleteManualCalendarDay,
} = require("../utils/attendanceCalendar");
const { hasGuardianPortalFeature } = require("../utils/guardianPortalAccess");
const { invalidateOrganizationAccessCache } = require("../utils/accessCache");

function extractS3KeyFromUrl(url) {
  const value = String(url || "").trim();
  if (!value || value === "profilePlaceholder.png") return null;

  const s3Prefix = `https://${process.env.S3_BUCKET_NAME}.s3.${process.env.AWS_REGION}.amazonaws.com/`;
  if (value.startsWith(s3Prefix)) {
    return value.substring(s3Prefix.length);
  }
  if (value.startsWith("images/")) {
    return value;
  }
  return null;
}

async function getActivePaystackSecretKey() {
  const settings = await getPaystackSettings(db);
  return settings.activeSecretKey || process.env.PAYSTACK_SECRET_KEY || "";
}

async function getActivePaystackPublicKey() {
  const settings = await getPaystackSettings(db);
  return settings.activePublicKey || process.env.PAYSTACK_PUBLIC_KEY || "";
}

async function ensureProfileImageColumns(db) {
  await db.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS image_url TEXT DEFAULT 'profilePlaceholder.png'`);
  await db.query(`ALTER TABLE organizations ADD COLUMN IF NOT EXISTS image_url TEXT DEFAULT 'profilePlaceholder.png'`);
}

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
    let html = await fs.promises.readFile(templatePath, "utf8");
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
        throw new Error("Failed to send receipt email.");
  }
}

async function sendInvoiceEmail(email, orgName, invoice) {
  try {
    const invoiceUrl = invoice.hosted_invoice_url || "No URL available";

    const dueDate = new Date(invoice.due_date * 1000).toLocaleDateString();

    const amountDue = (invoice.amount_due / 100).toFixed(2);

    const html = renderCleanEmail({
      title: "New Invoice from Managira",
      greeting: "Hello,",
      paragraphs: ["A new invoice has been generated for your subscription."],
      details: [
        { label: "Organization Name", value: he.encode(orgName) },
        { label: "Amount Due", value: `$${he.encode(amountDue)}` },
        { label: "Due Date", value: he.encode(dueDate) },
      ],
      cta: invoiceUrl !== "No URL available" ? { text: "View Invoice", url: invoiceUrl } : null,
      note: 'If you have any questions, please visit our <a href="https://www.managira.com/legal/help" target="_blank" rel="noopener">Help Center</a> or <a href="https://www.managira.com/legal/faq" target="_blank" rel="noopener">FAQ page</a>.',
    });

    const mailOptions = {

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

    await sendEmailSafely(mailOptions, "Invoice Email");
  } catch (error) {
        throw new Error("Failed to send invoice email.");
  }
}

async function sendCancellationEmail(orgName, firstName, email) {
  if (!email) {
    throw new Error("Recipient email is not defined.");
  }

  const html = renderCleanEmail({
    title: "Subscription Cancellation Confirmation",
    greeting: `Dear <strong>${he.encode(firstName)}</strong>,`,
    paragraphs: [
      `We wanted to confirm that your subscription for <strong>${he.encode(orgName)}</strong> has been successfully canceled.`,
      "You will continue to have full access until the end of your current billing cycle, after which your subscription will be fully deactivated.",
      "If you decide to reactivate before the billing cycle ends, you can do so from your account settings.",
      "If you need any assistance, our support team is always available.",
    ],
    note: 'If you have questions, please visit our <a href="https://www.managira.com/legal/help" target="_blank" rel="noopener">Help Center</a> or <a href="https://www.managira.com/legal/faq" target="_blank" rel="noopener">FAQ page</a>.',
  });

  const mailOptions = {

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
  await sendEmailSafely(mailOptions, "Cancellation Email");
}

async function sendRegistrationSuccessEmail(
  email,

  firstName,

  lastName
) {
  try {
    const html = renderCleanEmail({
      title: "Welcome to Managira",
      greeting: `Hi <strong>${he.encode(firstName)} ${he.encode(lastName)}</strong>,`,
      paragraphs: [
        "Your organization account has been successfully registered and is now active.",
        "You can now log in and start using all the features of Managira.",
      ],
      cta: { text: "Log In to Your Account", url: "https://www.managira.com/account/login" },
      note: 'To get onboarded fast, open the attached Managira Starter Pack (PDF). You can also watch our walkthrough on YouTube: <a href="https://youtu.be/D8da4yiDBWc?si=NMJKd9PCmMq98IzJ" target="_blank" rel="noopener">Watch the walkthrough</a>.',
    });

    const mailOptions = {

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

    await sendEmailSafely(mailOptions, "Registration Success Email");
  } catch (error) {
        throw new Error("Failed to send registration success email.");
  }
}

// Helper function to send password reset email

async function sendPasswordResetEmail(email, token, baseUrl) {
  const resetLink = `${baseUrl}/account/reset-password?token=${token}`;

  const html = renderCleanEmail({
    title: "Password Reset Request",
    greeting: "Hello,",
    paragraphs: [
      "You requested to reset your password.",
      "Click the button below to continue. This link will expire in 15 minutes.",
      "If you did not request this, you can safely ignore this email.",
    ],
    cta: { text: "Reset Password", url: resetLink },
  });

  const mailOptions = {

    to: email,

    subject: "Password Reset Request",

    html,
  };

  await sendEmailSafely(mailOptions, "Password Reset Request Email");
}

async function sendPasswordResetConfirmationEmail(email) {
  const html = renderCleanEmail({
    title: "Password Reset Successful",
    greeting: "Dear User,",
    paragraphs: [
      "Your password has been successfully reset.",
      "If you did not request this change, please contact support immediately.",
    ],
  });

  const mailOptions = {

    to: email,

    subject: "Password Reset Successful",

    html,
  };

  try {
    await sendEmailSafely(mailOptions, "Password Reset Confirmation Email");
  } catch (error) {
      }
}

async function notifyAdminOfRegistration(firstName, lastName, orgName, email, orgPhone) {
  await sendEmailSafely({
    to: process.env.ADMIN_EMAIL,
    subject: "New Account Registration",
    text: `A new account has been registered:\n\nName: ${firstName} ${lastName}\nOrganization: ${orgName}\nEmail: ${email}\nPhone: ${orgPhone}\n\nPlease review the registration details.`,
  }, "Admin Registration Notification");
}

async function saveCardAuthorization(db, orgId, authorization) {
  await db.query(
    `INSERT INTO stored_cards (
      organization_id,
      authorization_code,
      last4,
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

async function getStoredCardPaymentMethods(db, orgId) {
  const result = await db.query(
    `SELECT authorization_code, card_type, last4, exp_month, exp_year, is_primary
     FROM stored_cards
     WHERE organization_id = $1 AND is_active = true
     ORDER BY is_primary DESC, updated_at DESC, created_at DESC`,
    [orgId]
  );

  return result.rows.map((row) => ({
    id: row.authorization_code,
    brand: row.card_type || "Card",
    last4: row.last4,
    expMonth: row.exp_month,
    expYear: row.exp_year,
    isPrimary: Boolean(row.is_primary),
  }));
}

function pickDefaultCard(paymentMethods = [], storedCardMethods = []) {
  if (!paymentMethods.length) return null;

  const primaryStoredCard = storedCardMethods.find((card) => card.isPrimary);
  if (primaryStoredCard) {
    const matched = paymentMethods.find((card) => card.id === primaryStoredCard.id);
    if (matched) return matched;
  }

  return paymentMethods[0] || null;
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
      const paystackSecretKey = await getActivePaystackSecretKey();
      const headers = {
        headers: { Authorization: `Bearer ${paystackSecretKey}` },
      };
      const response = await axios.get(
        `https://api.paystack.co/bank?country=${country}`,
        headers
      );
      return res.json({ success: true, banks: response.data?.data || [] });
    } catch (err) {
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
      const currencyProfile = await getCurrencyProfileForRequest(req);

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

      const plans = plansResult.rows
        .map((plan) => ({
          ...plan,

          total_price: parseFloat(plan.total_price) || 0,
        }))
        .map((plan) => {
          const localized = localizeUsdAmount(plan.total_price, currencyProfile);
          return {
            ...plan,
            priceUsdDisplay: formatCurrencyAmount(localized.amountUsd, "USD"),
            localizedPriceDisplay: formatCurrencyAmount(
              localized.localizedAmount,
              localized.userCurrency,
              currencyProfile.locale
            ),
            localizedCurrencyCode: localized.userCurrency,
          };
        });

      const trialSettings = await getFreeTrialSettings(db);
      const freeTrialEnabled = Boolean(trialSettings.enabled);
      const freeTrialLengthLabel = formatFreeTrialLength(trialSettings.days);
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
        currencyProfile,
        paystackChargeCurrency: "GHS",

        showFooterTopSection: true,
        messages: req.flash(),
      });
    } catch (error) {
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

    return req.session.save((err) => {
      if (err) {
        req.flash("error", "Session error. Please try again.");
        return res.redirect("/account/service-plan");
      }
      return res.redirect("/account/register");
    });
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
      // Uses session.save() to guarantee persistence before redirecting (avoids mobile race condition)
      function stickyError(message) {
        req.session.formData = formData;
        req.session.formMessages = { error: [message] };
        req.session.save(() => res.redirect("/account/register"));
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

      // Explicitly save session before redirect — prevents mobile race condition where
      // the browser follows the redirect before connect-pg-simple writes to Postgres.
      return req.session.save((err) => {
        if (err) {
          req.session.formData = formData;
          req.session.formMessages = { error: ["Session error. Please try again."] };
          return req.session.save(() => res.redirect("/account/register"));
        }
        return res.redirect("/account/payment");
      });
    } catch (error) {
            // Attempt cleanup of uploaded proofs if present
      if (typeof proof1Url !== "undefined" && proof1Url) {
        try {
          await deleteFromS3(proof1Url);
        } catch (cleanupErr) {
                  }
      }
      if (typeof proof2Url !== "undefined" && proof2Url) {
        try {
          await deleteFromS3(proof2Url);
        } catch (cleanupErr) {
                  }
      }

      req.session.formData = req.body;

      req.session.formMessages = {
        error: ["Registration failed. Please try again."],
      };

      return req.session.save(() => res.redirect("/account/register"));
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

    let decodedPlan = registrationDetails.plan;
    try {
      decodedPlan = decodeURIComponent(String(registrationDetails.plan || ""));
    } catch (_) {
      decodedPlan = registrationDetails.plan;
    }

    try {
      let currencyProfile = {
        userCurrency: "USD",
        locale: "en-US",
        usdToUserRate: 1,
        usdToGhsRate: null,
      };
      try {
        currencyProfile = await getCurrencyProfileForRequest(req);
      } catch (_) {
      }

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
              }

      // Labels for UI
      billingIntervalLabel = billingInterval;
      if (freeTrialDays) {
        freeTrialLengthLabel =
          freeTrialDays === "5_minutes"
            ? "5 minutes"
            : `${freeTrialDays} day${parseInt(freeTrialDays) === 1 ? "" : "s"}`;
      }
      isTrialCheckout = freeTrialEnabled === "true" && !!freeTrialDays;

      // Calculate amount based on free trial settings
      const planPrice = Number(planResult.rows[0].total_price) || 0;
      const localizedPlan = localizeUsdAmount(planPrice, currencyProfile);
      const ghsChargeBase =
        localizedPlan.ghsAmount && localizedPlan.ghsAmount > 0
          ? localizedPlan.ghsAmount
          : planPrice;

      let amountDue = Math.round(ghsChargeBase * 100);

      let isTrialActive = false;

      let trialActiveUntil = null;
      let trialStartAt = null;
      const trialStartDateMin = formatDateForInput(startOfDayLocal(new Date()));
      const trialStartMaxDate = startOfDayLocal(new Date());
      trialStartMaxDate.setMonth(trialStartMaxDate.getMonth() + 3);
      const trialStartDateMax = formatDateForInput(trialStartMaxDate);
      let trialStartDateValue = trialStartDateMin;

      if (isTrialCheckout) {
        amountDue = 100; // 1 cedi in pesewas for validation

        const sessionTrialDate = parseDateInput(registrationDetails.trialStartDate || "");
        if (
          sessionTrialDate &&
          sessionTrialDate >= startOfDayLocal(new Date()) &&
          sessionTrialDate <= trialStartMaxDate
        ) {
          trialStartAt = sessionTrialDate;
        } else {
          trialStartAt = startOfDayLocal(new Date());
        }
        trialStartDateValue = formatDateForInput(trialStartAt);

        trialActiveUntil = new Date(trialStartAt);
        if (freeTrialDays === "5_minutes") {
          trialActiveUntil.setMinutes(trialActiveUntil.getMinutes() + 5);
        } else {
          const days = parseInt(freeTrialDays);
          if (days > 0) {
            trialActiveUntil.setDate(trialActiveUntil.getDate() + days);
          }
        }
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
      const usdPriceDisplay = formatCurrencyAmount(planPrice, "USD");
      const localizedPriceDisplay = formatCurrencyAmount(
        localizedPlan.localizedAmount,
        localizedPlan.userCurrency,
        currencyProfile.locale
      );
      const ghsChargeDisplay = formatCurrencyAmount(ghsChargeBase, "GHS");
      postTrialPriceDisplay = `${usdPriceDisplay} (≈ ${localizedPriceDisplay}) ${intervalLabel}`;

      let verificationChargeUsdDisplay = null;
      let verificationChargeLocalDisplay = null;
      if (isTrialCheckout) {
        const verificationGhsAmount = amountDue / 100;
        let usdPerGhs = null;

        if (currencyProfile.usdToGhsRate && Number(currencyProfile.usdToGhsRate) > 0) {
          usdPerGhs = 1 / Number(currencyProfile.usdToGhsRate);
        } else if (localizedPlan.ghsAmount && localizedPlan.ghsAmount > 0 && planPrice > 0) {
          usdPerGhs = planPrice / localizedPlan.ghsAmount;
        }

        const verificationUsdAmount = usdPerGhs && usdPerGhs > 0
          ? verificationGhsAmount * usdPerGhs
          : verificationGhsAmount;

        verificationChargeUsdDisplay = formatCurrencyAmount(verificationUsdAmount, "USD");

        if (
          currencyProfile.userCurrency &&
          currencyProfile.userCurrency !== "USD" &&
          currencyProfile.usdToUserRate &&
          Number(currencyProfile.usdToUserRate) > 0
        ) {
          const localAmount = verificationUsdAmount * Number(currencyProfile.usdToUserRate);
          verificationChargeLocalDisplay = formatCurrencyAmount(
            localAmount,
            currencyProfile.userCurrency,
            currencyProfile.locale
          );
        }
      }

      const trialEndDisplay =
        trialActiveUntil instanceof Date
          ? trialActiveUntil.toLocaleDateString("en-US", {
              weekday: "long",

              month: "long",

              day: "numeric",

              year: "numeric",
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

        publishableKey: await getActivePaystackPublicKey(),

        orgEmail: registrationDetails.email || "",
        orgPhone: registrationDetails.orgPhone || "",
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
        trialStartDateMin,
        trialStartDateMax,
        trialStartDateValue,

        postTrialPriceDisplay,

        isTrialCheckout,
        currencyProfile,
        paystackChargeCurrency: "GHS",
        usdPriceDisplay,
        localizedPriceDisplay,
        ghsChargeDisplay,
        verificationChargeUsdDisplay,
        verificationChargeLocalDisplay,

        // layout: false // Use default layout for header and footer
      });
    } catch (error) {
            req.flash("error", "Unable to initialize payment. Please try again.");

      return res.redirect("/account/login");
    }
  },

  paymentPost: async (req, res) => {
    const { registrationDetails } = req.session;

    const { paymentReference, promoCode, trialStartDate } = req.body;

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
            Authorization: `Bearer ${await getActivePaystackSecretKey()}`,
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
            Authorization: `Bearer ${await getActivePaystackSecretKey()}`,

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
              }

      const isTrialCheckout =
        freeTrialEnabled === "true" && !!freeTrialDays;

      if (isTrialCheckout) {
        amountDue = 100; // Minimal validation charge for trial
      }

      // Calculate trial end date if free trial is enabled

      let trialActiveUntil = null;
      let trialStartAt = null;
      if (isTrialCheckout) {
        const minDate = startOfDayLocal(new Date());
        const maxDate = startOfDayLocal(new Date());
        maxDate.setMonth(maxDate.getMonth() + 3);

        trialStartAt = parseDateInput(trialStartDate);
        if (!trialStartAt || trialStartAt < minDate || trialStartAt > maxDate) {
          req.flash(
            "error",
            "Please choose a valid trial start date between today and the next 3 months."
          );
          return res.redirect("/account/payment");
        }

        registrationDetails.trialStartDate = formatDateForInput(trialStartAt);
        trialActiveUntil = new Date(trialStartAt);
        if (freeTrialDays === "5_minutes") {
          trialActiveUntil.setMinutes(trialActiveUntil.getMinutes() + 5);
                  } else {
          const days = parseInt(freeTrialDays);
          if (days > 0) {
            trialActiveUntil.setDate(trialActiveUntil.getDate() + days);
                      }
        }
      } else {
              }

      // Only create Paystack plan/subscription if not on free trial

      let paystackPlanCode = null;

      let subscriptionCode = null;
      if (!isTrialCheckout) {
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
              Authorization: `Bearer ${await getActivePaystackSecretKey()}`,

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
              Authorization: `Bearer ${await getActivePaystackSecretKey()}`,

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
        `INSERT INTO organizations (organization_name, nickname, organization_address, organization_phone, email, password, first_name, last_name, proof_of_existence_1, proof_of_existence_2, plan_id, paystack_customer_code, trial_start_at, trial_active_until)

           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14) RETURNING organization_id`,

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

          trialStartAt,

          trialActiveUntil,
        ]
      );

      const organization_id = orgResult.rows[0].organization_id;

      // ✅ Store payment record

      const nextPaymentEndDate = (() => {
        // If we have a trial period AND we're charging the $1 validation amount, use trial end date

        if (trialActiveUntil && data.amount <= 100) {
                    return new Date(trialActiveUntil);
        }

        // If we have trial period but charging full amount, still respect trial (shouldn't happen but safety check)

        if (trialActiveUntil) {
                    return new Date(trialActiveUntil);
        }

        // No trial - use normal billing interval

        const d = new Date();
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

                                    await client.query(
        `INSERT INTO payments (organization_id, paystack_subscription_code, paystack_reference, amount_paid, status, discount_applied, applies_once, is_trial, trial_starts_at, trial_ends_at, next_payment_end_date)

           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,

        [
          organization_id,

          subscriptionCode,

          paymentReference,

          data.amount / 100, // Convert from pesewas to GHS

          "active",

          discountAmount > 0 ? `${discountAmount}%` : null,

          applyDiscountOnce,

          trialActiveUntil ? true : false,

          trialStartAt || null,

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
            if (error.response) {
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
            return res.json({
        success: false,

        message: "Database connection error.",
      });
    }

    try {
      const result = await db.query(
        `SELECT discount_percentage
         FROM promo_codes
         WHERE UPPER(code) = UPPER($1)
           AND is_active = TRUE
           AND expiration_date > NOW()
         LIMIT 1`,
        [String(code).trim()]
      );

      if (result.rows.length === 0) {
        return res.json({ success: false, message: "Invalid or expired promo code." });
      }

      const discount = result.rows[0].discount_percentage;

      return res.json({ success: true, discount });
    } catch (error) {
            res.json({ success: false, message: "Error validating promo code." });
    }
  },

  paystackWebhookPost: async (req, res) => {
    try {
      const rawBody = Buffer.isBuffer(req.body)
        ? req.body.toString("utf8")
        : JSON.stringify(req.body || {});

      const hash = crypto
        .createHmac("sha512", process.env.PAYSTACK_WEBHOOK_SECRET)
        .update(rawBody)
        .digest("hex");

      if (hash !== req.headers["x-paystack-signature"]) {
                return res.status(400).send("Webhook signature verification failed");
      }

      const event = Buffer.isBuffer(req.body) ? JSON.parse(rawBody) : req.body;

            switch (event.event) {
        case "subscription.create": {
          const subscription = event.data;
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
              } = orgResult.rows[0];
              // Update payment record

              await db.query(
                "UPDATE payments SET status = 'failed' WHERE organization_id = $1",
                [organization_id]
              );

              if (email) {
                await sendPaymentFailureEmail(email);
              }
              if (process.env.ADMIN_EMAIL) {
                await sendPaymentFailureEmail(process.env.ADMIN_EMAIL);
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

                                        }
          }

          break;
        }
      }

      res.json({ received: true });
    } catch (error) {
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
        `SELECT paystack_customer_code, email, organization_phone, organization_name, first_name, last_name, is_hub_member, hub_id
         FROM organizations
         WHERE organization_id = $1`,
        [orgId]
      );

      const orgRow = orgResult.rows[0] || {};
      let paystackCustomerCode = orgRow.paystack_customer_code;
      const isHubMember = Boolean(orgRow.is_hub_member && orgRow.hub_id);

      let hubContractEndDate = null;
      let hubName = null;

      if (isHubMember) {
        const hubResult = await db.query(
          `SELECT hub_name, contract_end_date
           FROM managira_hubs
           WHERE hub_id = $1 AND deleted = false`,
          [orgRow.hub_id]
        );

        if (hubResult.rows.length > 0) {
          hubName = hubResult.rows[0].hub_name;
          hubContractEndDate = hubResult.rows[0].contract_end_date;
        }
      }

      if (!paystackCustomerCode && !isHubMember) {
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
                Authorization: `Bearer ${await getActivePaystackSecretKey()}`,
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
                    req.flash("error", "Paystack customer not found.");
          return res.redirect("/account/update");
        }
      }

      // ✅ Fetch all saved Paystack cards (payment methods)

      let paymentMethods = [];

      let defaultPaymentMethod = null;
      let storedCardMethods = [];

      try {
        storedCardMethods = await getStoredCardPaymentMethods(db, orgId);
      } catch (err) {
              }

      if (!isHubMember && paystackCustomerCode) {
        try {
          const customerResponse = await axios.get(
            `https://api.paystack.co/customer/${paystackCustomerCode}`,

            {
              headers: {
                Authorization: `Bearer ${await getActivePaystackSecretKey()}`,
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
          }
        } catch (paystackError) {
                  // Continue with empty payment methods if API fails
        }
      }

      if (!paymentMethods.length && storedCardMethods.length) {
        paymentMethods = storedCardMethods;
      }

      defaultPaymentMethod = pickDefaultCard(paymentMethods, storedCardMethods);

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

        publishableKey: await getActivePaystackPublicKey(),

        orgEmail: orgRow.email || "",
        orgPhone: orgRow.organization_phone || "",
        paystackCustomerCode,

        defaultPaymentMethod,

        paymentMethods,

        paystackSubaccounts,
        isHubMember,
        hubName,
        hubContractEndDate,

        messages: req.flash(),
      });
    } catch (error) {
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
            Authorization: `Bearer ${await getActivePaystackSecretKey()}`,
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

      if (!orgId || !authorizationCode) {
        return res.status(400).json({
          success: false,

          message: "Missing required parameters.",
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

      const customerBeforeResponse = await axios.get(
        `https://api.paystack.co/customer/${paystackCustomerCode}`,
        {
          headers: {
            Authorization: `Bearer ${await getActivePaystackSecretKey()}`,
          },
        }
      );

      const customerBefore = customerBeforeResponse.data.data;
      const removableCards = (customerBefore.authorizations || []).filter(
        (auth) => auth.channel === "card" && auth.reusable
      );

      if (removableCards.length <= 1) {
        return res.status(400).json({
          success: false,
          message: "You must keep at least one saved card on file.",
        });
      }

      const selectedCardExists = removableCards.some(
        (auth) => auth.authorization_code === authorizationCode
      );

      if (!selectedCardExists) {
        return res.status(404).json({
          success: false,
          message: "Card not found for this organization.",
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
              Authorization: `Bearer ${await getActivePaystackSecretKey()}`,

              "Content-Type": "application/json",
            },
          }
        );
      } catch (deactivateError) {
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
            Authorization: `Bearer ${await getActivePaystackSecretKey()}`,
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

      await db.query(
        "UPDATE stored_cards SET is_active = false, is_primary = false WHERE organization_id = $1 AND authorization_code = $2",
        [orgId, authorizationCode]
      );

      if (defaultPaymentMethod?.id) {
        await db.query(
          "UPDATE stored_cards SET is_primary = false WHERE organization_id = $1",
          [orgId]
        );

        await db.query(
          "UPDATE stored_cards SET is_active = true, is_primary = true WHERE organization_id = $1 AND authorization_code = $2",
          [orgId, defaultPaymentMethod.id]
        );
      }

      res.json({
        success: true,

        message: "Card removed successfully.",

        paymentMethods,

        defaultPaymentMethod,
      });
    } catch (error) {
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
                    req.flash("error", "Invalid email or password.");

          return res.redirect("/account/login");
        }

        const match = await bcrypt.compare(password, admin.password);

        if (!match) {
                    req.flash("error", "Invalid email or password.");

          return res.redirect("/account/login");
        }

        req.session.regenerate((err) => {
          if (err) {
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
                            req.flash("error", "Login failed. Please try again.");

              return res.redirect("/account/login");
            }

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

            if (userResult.rows.length > 0) {
        const user = userResult.rows[0];

                // Check if password has been set
        if (!user.password) {
          req.flash("error", "Your account password has not been set up yet. Please contact your administrator to receive a password setup email.");
          return res.redirect("/account/login");
        }

        const match = await bcrypt.compare(password, user.password);

        req.session.userId = user.user_id;

        if (match) {
          const orgResult = await db.query(
            `SELECT o.*, 
                    CASE WHEN o.hub_id IS NOT NULL THEN mh.hub_name ELSE NULL END as hub_name,
                    CASE WHEN o.hub_id IS NOT NULL THEN mh.logo_path ELSE NULL END as hub_logo
             FROM organizations o
             LEFT JOIN managira_hubs mh ON o.hub_id = mh.hub_id
             WHERE o.organization_id = $1`,

            [user.organization_id]
          );

          if (orgResult.rows.length > 0) {
            const organization = orgResult.rows[0];

            if (
              user.email &&
              organization.email &&
              String(user.email).trim().toLowerCase() === String(organization.email).trim().toLowerCase() &&
              String(user.account_type || '').trim().toLowerCase() !== 'manager'
            ) {
              await db.query(
                `UPDATE users
                 SET account_type = 'Manager', updated_at = NOW()
                 WHERE user_id = $1 AND organization_id = $2`,
                [user.user_id, user.organization_id]
              );
              user.account_type = 'Manager';
            }

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

              // Add hub information if organization is part of a hub
              if (organization.is_hub_member && organization.hub_id) {
                                req.session.isHubMember = true;
                req.session.hubName = organization.hub_name;
                req.session.hubLogo = organization.hub_logo;
              } else {
                              }

              req.session.save((err) => {
                if (err) {
                                    req.flash("error", "Login failed. Please try again.");

                  return res.redirect("/account/login");
                }

                const redirectUrl =
                  process.env.NODE_ENV === "production"
                    ? `https://${req.session.orgNickName}.managira.com/common/orgDashboard`
                    : "/common/orgDashboard?organizationId=" +
                      req.session.organizationId;

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
        `SELECT o.*, 
                CASE WHEN o.hub_id IS NOT NULL THEN mh.hub_name ELSE NULL END as hub_name,
                CASE WHEN o.hub_id IS NOT NULL THEN mh.logo_path ELSE NULL END as hub_logo
         FROM organizations o
         LEFT JOIN managira_hubs mh ON o.hub_id = mh.hub_id
         WHERE LOWER(o.email) = LOWER($1)`,

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

            // Add hub information if organization is part of a hub
            if (organization.is_hub_member && organization.hub_id) {
              req.session.isHubMember = true;
              req.session.hubName = organization.hub_name;
              req.session.hubLogo = organization.hub_logo;
            }

            // Do NOT fetch or store features here; handled by setAllowedFeatures middleware

            req.session.save((err) => {
              if (err) {
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

      const guardianPortalEnabled = await hasGuardianPortalFeature(
        db,
        ga.organization_id
      );
      if (!guardianPortalEnabled) {
        req.flash("error", "Parent portal access is not enabled for this school.");
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
            req.flash("error", "Login failed. Please try again.");
      return res.redirect("/account/guardian-login");
    }
  },

  logoutGet: (req, res) => {
    req.session.destroy((err) => {
      if (err) {
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
            req.flash("error", "Failed to update profile.");
      return res.redirect(redirectTo || "/account/settings");
    }
  },

  updateProfileImagePost: async (req, res, db) => {
    if (!req.session.organizationId) {
      req.flash("error", "You must be logged in.");
      return res.redirect("/account/login");
    }

    const { redirectTo } = req.body;
    const orgId = req.session.organizationId;
    const sessionUserId = req.session.user?.user_id || req.session.userId;

    if (!req.file) {
      req.flash("error", "Please select an image to upload.");
      return res.redirect(redirectTo || "/account/settings");
    }

    if (!sessionUserId) {
      req.flash("error", "Unable to identify user for profile image update.");
      return res.redirect(redirectTo || "/account/settings");
    }

    try {
      await ensureProfileImageColumns(db);

      const currentUserResult = await db.query(
        "SELECT image_url FROM users WHERE user_id = $1 AND organization_id = $2",
        [sessionUserId, orgId]
      );

      const isUserRow = currentUserResult.rows.length > 0;
      let previousImageUrl = null;

      if (isUserRow) {
        previousImageUrl = currentUserResult.rows[0].image_url;
      } else {
        const currentOrgResult = await db.query(
          "SELECT image_url FROM organizations WHERE organization_id = $1",
          [orgId]
        );
        if (currentOrgResult.rows.length > 0) {
          previousImageUrl = currentOrgResult.rows[0].image_url;
        }
      }

      // Upload image to S3
      const s3Key = `images/profiles/${orgId}/${Date.now()}_${req.file.originalname}`;
      const imageUrl = await uploadToS3(req.file, s3Key);

      if (isUserRow) {
        await db.query(
          "UPDATE users SET image_url = $1 WHERE user_id = $2 AND organization_id = $3",
          [imageUrl, sessionUserId, orgId]
        );
      } else {
        await db.query(
          "UPDATE organizations SET image_url = $1 WHERE organization_id = $2",
          [imageUrl, orgId]
        );
      }

      // Delete old profile image from S3 if present
      const oldImageKey = extractS3KeyFromUrl(previousImageUrl);
      if (oldImageKey && oldImageKey !== s3Key) {
        try {
          await deleteFromS3(oldImageKey);
        } catch (cleanupError) {
          // Ignore cleanup failure to avoid blocking successful update
        }
      }

      // Update session
      if (req.session.user) {
        req.session.user.image_url = imageUrl;
      }
      req.session.save();

      req.flash("success", "Profile picture updated successfully!");
      return res.redirect(redirectTo || "/account/settings");
    } catch (error) {
            req.flash("error", "Failed to update profile picture.");
      return res.redirect(redirectTo || "/account/settings");
    }
  },

        deleteProfileImagePost: async (req, res, db) => {
          if (!req.session.organizationId) {
            req.flash("error", "You must be logged in.");
            return res.redirect("/account/login");
          }

          const { redirectTo } = req.body;
          const orgId = req.session.organizationId;
          const sessionUserId = req.session.user?.user_id || req.session.userId;
          

          if (!sessionUserId) {
            req.flash("error", "Unable to identify user for image deletion.");
            return res.redirect(redirectTo || "/account/settings");
          }

          try {
            await ensureProfileImageColumns(db);

            const currentUserResult = await db.query(
              "SELECT image_url FROM users WHERE user_id = $1 AND organization_id = $2",
              [sessionUserId, orgId]
            );

            const isUserRow = currentUserResult.rows.length > 0;
            let previousImageUrl = null;

            if (isUserRow) {
              previousImageUrl = currentUserResult.rows[0].image_url;
            } else {
              const currentOrgResult = await db.query(
                "SELECT image_url FROM organizations WHERE organization_id = $1",
                [orgId]
              );
              if (currentOrgResult.rows.length > 0) {
                previousImageUrl = currentOrgResult.rows[0].image_url;
              }
            }

            const placeholderImage = "profilePlaceholder.png";

            if (isUserRow) {
              await db.query(
                "UPDATE users SET image_url = $1 WHERE user_id = $2 AND organization_id = $3",
                [placeholderImage, sessionUserId, orgId]
              );
            } else {
              await db.query(
                "UPDATE organizations SET image_url = $1 WHERE organization_id = $2",
                [placeholderImage, orgId]
              );
            }

            const oldImageKey = extractS3KeyFromUrl(previousImageUrl);
            if (oldImageKey) {
              try {
                await deleteFromS3(oldImageKey);
              } catch (cleanupError) {
                // Ignore cleanup failure to avoid blocking successful delete
              }
            }

            if (req.session.user) {
              req.session.user.image_url = placeholderImage;
            }
            req.session.save();

            req.flash("success", "Profile picture removed successfully.");
            return res.redirect(redirectTo || "/account/settings");
          } catch (error) {
            req.flash("error", "Failed to remove profile picture.");
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

      // Upload the new logo to S3 under images/logos/{organizationId}/ using a safe unique filename
      const originalExt = path.extname(file.originalname || "").toLowerCase();
      const safeExt = /^[a-z0-9.]+$/.test(originalExt) && originalExt ? originalExt : "";
      const baseName = path.basename(file.originalname || "logo", originalExt);
      const safeBaseName = baseName
        .normalize("NFKD")
        .replace(/[^a-zA-Z0-9_-]+/g, "-")
        .replace(/-+/g, "-")
        .replace(/^-|-$/g, "")
        .toLowerCase() || "logo";
      const uniqueSuffix = `${Date.now()}-${crypto.randomBytes(4).toString("hex")}`;
      const logoKey = `images/logos/${organizationId}/${uniqueSuffix}-${safeBaseName}${safeExt}`;

      const logoUrl = await uploadToS3(file, logoKey);

      // Update the organization record with the new logo URL

      await db.query(
        "UPDATE organizations SET logo = $1 WHERE organization_id = $2",

        [logoUrl, organizationId]
      );

      // Update the session with the new logo URL

      req.session.logo = logoUrl;

      req.session.save();

      // Delete the old logo from S3 if it exists and is not the same key
      const oldLogoKey = extractS3KeyFromUrl(previousLogo);
      if (oldLogoKey && oldLogoKey !== logoKey) {
        try {
          await deleteFromS3(oldLogoKey);
        } catch (deleteErr) {
          console.warn("Failed to delete previous logo from S3:", deleteErr.message);
        }
      }

      req.flash("success", "Logo updated successfully.");

      res.redirect(req.body.redirectTo || "/account/personalization");
    } catch (err) {
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
                    // fallback: redirect to login on main domain

          return res.redirect("https://managira.com/account/login");
        }

        res.clearCookie("connect.sid", { path: "/" });

        res.redirect("https://managira.com/account/login");
      });
    } catch (error) {
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

        return res.redirect("/account/managePublicContent");
      }

      if (contentType === "slideshow" && files.length < 2) {
        req.flash(
          "error",

          "Please upload at least two images or videos for the slideshow."
        );

        return res.redirect("/account/managePublicContent");
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
            req.flash("error", "Failed to add text section. Please try again.");

      res.redirect("/account/managePublicContent");
    }
  },

  updateAboutUsSection: async (req, res) => {
    const { organization_id, aboutUs } = req.body;

    const toList = (value) => {
      const values = Array.isArray(value) ? value : [value];
      return values
        .map((item) => String(item || "").trim())
        .filter(Boolean);
    };

    const mottoInput = String(req.body?.motto || "").trim();
    const mottos = mottoInput
      ? [mottoInput]
      : toList(req.body?.mottos).slice(0, 1);
    const emails = toList(req.body?.contactEmails);
    const phones = toList(req.body?.contactPhones);
    const primaryMotto = mottos[0] || "";

    try {
      await db.query(
        `UPDATE organizations SET aboutUs = $1, motto = $2 WHERE organization_id = $3`,

        [aboutUs, primaryMotto, organization_id]
      );

      const existingDash = await db.query(
        "SELECT order_data FROM organization_dashboard WHERE organization_id = $1",
        [organization_id]
      );

      let order = [];
      let theme = "classic";
      let layout = "wireframe1";

      if (existingDash.rows.length > 0) {
        let raw = existingDash.rows[0].order_data;
        try {
          if (typeof raw === "string") raw = JSON.parse(raw);
          if (Array.isArray(raw)) {
            order = raw;
          } else if (raw && typeof raw === "object") {
            if (Array.isArray(raw.order)) order = raw.order;
            if (typeof raw.theme === "string" && raw.theme.trim()) theme = raw.theme.trim();
            if (typeof raw.layout === "string" && raw.layout.trim()) layout = raw.layout.trim();
          }
        } catch (e) {
          order = [];
          theme = "classic";
          layout = "wireframe1";
        }
      }

      const payload = {
        order,
        theme,
        layout,
        aboutDetails: { mottos, emails, phones },
      };

      await db.query(
        `INSERT INTO organization_dashboard (organization_id, order_data)
         VALUES ($1, $2)
         ON CONFLICT (organization_id)
         DO UPDATE SET order_data = EXCLUDED.order_data`,
        [organization_id, payload]
      );

      res.redirect("/account/managePublicContent"); // Replace with the actual page route
    } catch (error) {
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
      let aboutDetails = {
        mottos: orgDetails?.motto ? [orgDetails.motto] : [],
        emails: orgDetails?.email ? [orgDetails.email] : [],
        phones: orgDetails?.organization_phone ? [orgDetails.organization_phone] : [],
      };
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
            if (raw.aboutDetails && typeof raw.aboutDetails === "object") {
              const toList = (value) => {
                const values = Array.isArray(value) ? value : [value];
                return values
                  .map((item) => String(item || "").trim())
                  .filter(Boolean);
              };

              aboutDetails = {
                mottos: toList(raw.aboutDetails.mottos),
                emails: toList(raw.aboutDetails.emails),
                phones: toList(raw.aboutDetails.phones),
              };

              if (!aboutDetails.mottos.length && orgDetails?.motto) {
                aboutDetails.mottos = [orgDetails.motto];
              }
              if (!aboutDetails.emails.length && orgDetails?.email) {
                aboutDetails.emails = [orgDetails.email];
              }
              if (!aboutDetails.phones.length && orgDetails?.organization_phone) {
                aboutDetails.phones = [orgDetails.organization_phone];
              }
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
        aboutDetails,

        messages: {
          error: req.flash("error"),

          success: req.flash("success"),
        },
      });
    } catch (error) {
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
      let aboutDetails = {};

      if (existing.rows.length > 0) {
        let raw = existing.rows[0].order_data;
        try {
          if (typeof raw === "string") raw = JSON.parse(raw);
          if (Array.isArray(raw)) {
            order = raw;
          } else if (raw && typeof raw === "object") {
            if (Array.isArray(raw.order)) order = raw.order;
            if (typeof raw.theme === "string" && raw.theme.trim()) theme = raw.theme.trim();
            if (raw.aboutDetails && typeof raw.aboutDetails === "object") {
              aboutDetails = raw.aboutDetails;
            }
          }
        } catch (e) {
          order = [];
          theme = "classic";
          aboutDetails = {};
        }
      }

      const payload = { order, theme, layout, aboutDetails };

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
            req.flash("error", "Failed to update website layout.");
      return res.redirect("/account/managePublicContent");
    }
  },

  updatePublicDashboardThemePost: async (req, res) => {
    const organizationId = req.session.organizationId;
    const theme = (req.body?.publicDashboardTheme || "").trim();
    const redirectTo = (req.body?.redirectTo || "").trim();
    const safeRedirect = redirectTo.startsWith("/account/")
      ? redirectTo
      : "/account/managePublicContent";
    const withThemeApplied = `${safeRedirect}${safeRedirect.includes("?") ? "&" : "?"}themeApplied=1`;
    
    // Map public theme values to organization button theme values
    const themeMapping = {
      'classic': 'teal',
      'modern': 'blue',
      'green': 'green',
      'minimal': 'purple',
      'indigo': 'indigo',
      'rose': 'rose',
      'amber': 'amber',
      'yellow': 'yellow',
      'slate': 'slate'
    };
    
    const allowedThemes = new Set(Object.keys(themeMapping));

    if (!organizationId) {
      req.flash("error", "Missing organization.");
      return res.redirect(safeRedirect);
    }

    if (!allowedThemes.has(theme)) {
      req.flash("error", "Invalid website style selected.");
      return res.redirect(safeRedirect);
    }

    try {
      const existing = await db.query(
        "SELECT order_data FROM organization_dashboard WHERE organization_id = $1",
        [organizationId]
      );

      let order = [];
      let layout = "wireframe1";
      let aboutDetails = {};
      if (existing.rows.length > 0) {
        let raw = existing.rows[0].order_data;
        try {
          if (typeof raw === "string") raw = JSON.parse(raw);
          if (Array.isArray(raw)) {
            order = raw;
          } else if (raw && typeof raw === "object" && Array.isArray(raw.order)) {
            order = raw.order;
            if (typeof raw.layout === "string" && raw.layout.trim()) {
              layout = raw.layout.trim();
            }
            if (raw.aboutDetails && typeof raw.aboutDetails === "object") {
              aboutDetails = raw.aboutDetails;
            }
          } else if (raw && typeof raw === "object") {
            if (typeof raw.layout === "string" && raw.layout.trim()) {
              layout = raw.layout.trim();
            }
            if (raw.aboutDetails && typeof raw.aboutDetails === "object") {
              aboutDetails = raw.aboutDetails;
            }
          }
        } catch (e) {
          order = [];
          layout = "wireframe1";
          aboutDetails = {};
        }
      }

      const payload = { order, theme, layout, aboutDetails };

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
      return res.redirect(withThemeApplied);
    } catch (error) {
            req.flash("error", "Failed to update website style.");
      return res.redirect(safeRedirect);
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
      await ensureProfileImageColumns(db);
      await ensureAttendanceCalendarSchema(db);

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
            `SELECT organization_name, logo, logo_path, image_url, font_style, nickname, role, email, paystack_customer_code, first_name, last_name, organization_phone, is_hub_member, hub_id
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
          `SELECT first_name, last_name, email, account_type, image_url
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
          `SELECT first_name, last_name, email, 'Manager' AS account_type, image_url
           FROM organizations
           WHERE organization_id = $1`,
          [orgId]
        );
        if (orgUserResult.rows.length > 0) {
          user = {
            ...orgUserResult.rows[0],
            image_url: orgUserResult.rows[0]?.image_url || req.session?.user?.image_url || "profilePlaceholder.png",
          };
        }
      }

      const orgRow = orgResult.rows[0] || {};
      const isHubMember = Boolean(orgRow.is_hub_member && orgRow.hub_id);
      let paystackCustomerCode = orgRow.paystack_customer_code || '';
      let paymentMethods = [];
      let defaultPaymentMethod = null;
      let paystackSubaccounts = [];
      let storedCardMethods = [];

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
                  }

        try {
          storedCardMethods = await getStoredCardPaymentMethods(db, orgId);
        } catch (err) {
                  }
      }

      if (orgId && (await getActivePaystackSecretKey()) && orgRow.email && !isHubMember) {
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
                  Authorization: `Bearer ${await getActivePaystackSecretKey()}`,
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
                      }
        }

        if (paystackCustomerCode) {
          try {
            const customerResponse = await axios.get(
              `https://api.paystack.co/customer/${paystackCustomerCode}`,
              {
                headers: {
                  Authorization: `Bearer ${await getActivePaystackSecretKey()}`,
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
            }
          } catch (paystackError) {
                      }
        }
      }

      if (!paymentMethods.length && storedCardMethods.length) {
        paymentMethods = storedCardMethods;
      }

      defaultPaymentMethod = pickDefaultCard(paymentMethods, storedCardMethods);

      const calendarSchoolYears = [];
      let selectedCalendarTermId = Number(req.query.calendarTermId) || null;
      let selectedCalendarTerm = null;
      let attendanceCalendarProfile = null;
      let attendanceCalendarDays = [];
      let publicDashboardTheme = "classic";

      if (orgId) {
        const schoolYearTermResult = await db.query(
          `
            SELECT sy.id AS school_year_id,
                   sy.year_label,
                   sy.current AS school_year_current,
                   t.term_id,
                   t.term_name,
                   t.start_date,
                   t.end_date,
                   t.current AS term_current
            FROM school_years sy
            LEFT JOIN terms t ON t.school_year_id = sy.id
            WHERE sy.organization_id = $1
            ORDER BY sy.year_label DESC, t.start_date ASC
          `,
          [orgId]
        );

        const yearMap = new Map();
        schoolYearTermResult.rows.forEach((row) => {
          if (!yearMap.has(row.school_year_id)) {
            yearMap.set(row.school_year_id, {
              school_year_id: row.school_year_id,
              year_label: row.year_label,
              current: row.school_year_current,
              terms: [],
            });
          }

          if (row.term_id) {
            yearMap.get(row.school_year_id).terms.push({
              term_id: row.term_id,
              term_name: row.term_name,
              start_date: row.start_date,
              end_date: row.end_date,
              current: row.term_current,
            });
          }
        });

        calendarSchoolYears.push(...Array.from(yearMap.values()));

        if (!selectedCalendarTermId) {
          const currentTerm = schoolYearTermResult.rows.find(
            (row) => row.school_year_current && row.term_current && row.term_id
          );
          const fallbackTerm = schoolYearTermResult.rows.find((row) => row.term_id);
          selectedCalendarTermId = Number(
            (currentTerm && currentTerm.term_id) || (fallbackTerm && fallbackTerm.term_id) || null
          );
        }

        if (selectedCalendarTermId) {
          selectedCalendarTerm = await getTermRecord(db, orgId, selectedCalendarTermId);
          attendanceCalendarProfile = await getAttendanceCalendarProfile(db, orgId, selectedCalendarTermId);

          if (
            attendanceCalendarProfile &&
            selectedCalendarTerm &&
            selectedCalendarTerm.start_date &&
            selectedCalendarTerm.end_date
          ) {
            attendanceCalendarDays = await getAttendanceCalendarDays(
              db,
              attendanceCalendarProfile.calendar_id,
              selectedCalendarTerm.start_date,
              selectedCalendarTerm.end_date
            );
          }
        }

        try {
          const dashRow = await db.query(
            "SELECT order_data FROM organization_dashboard WHERE organization_id = $1",
            [orgId]
          );

          if (dashRow.rows.length > 0) {
            let raw = dashRow.rows[0].order_data;
            if (typeof raw === "string") raw = JSON.parse(raw);

            if (raw && typeof raw === "object" && !Array.isArray(raw)) {
              if (typeof raw.theme === "string" && raw.theme.trim()) {
                publicDashboardTheme = raw.theme.trim();
              }
            }
          }
        } catch (e) {
          publicDashboardTheme = "classic";
        }
      }

      const holidayCountries = getHolidayCountryOptions();

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
        isHubMember,
        passwordVerified: req.session.passwordVerified || false,
        userId,
        calendarSchoolYears,
        selectedCalendarTermId,
        selectedCalendarTerm,
        attendanceCalendarProfile,
        attendanceCalendarDays,
        weekdayOptions: WEEKDAY_OPTIONS,
        holidayCountries,
        publicDashboardTheme,
        messages: req.flash(),
      });
    } catch (error) {
            req.flash("error", "Unable to load settings page.");
      res.redirect("/common/orgDashboard");
    }
  },

  saveAttendanceCalendarProfilePost: async (req, res, db) => {
    const organizationId = req.session.organizationId;
    const redirectBase = "/account/settings?section=customize";

    try {
      await ensureAttendanceCalendarSchema(db);

      const termId = Number(req.body.termId);
      const countryCode = String(req.body.countryCode || "GH").toUpperCase();
      const includePublicHolidays = parseBoolean(req.body.includePublicHolidays);
      const weekendDays = normalizeWeekendDaysInput(req.body.weekendDays || []);

      if (!termId) {
        req.flash("error", "Please select a term/semester for calendar settings.");
        return res.redirect(redirectBase);
      }

      const term = await getTermRecord(db, organizationId, termId);
      if (!term) {
        req.flash("error", "Invalid term selected for attendance calendar.");
        return res.redirect(redirectBase);
      }

      const userId = req.session.userId || req.session.user?.user_id || null;

      const profile = await upsertAttendanceCalendarProfile(db, {
        organizationId,
        schoolYearId: term.school_year_id,
        termId,
        countryCode,
        weekendDays,
        includePublicHolidays,
        userId,
      });

      if (includePublicHolidays) {
        await syncPublicHolidayDays(db, {
          calendarId: profile.calendar_id,
          organizationId,
          countryCode,
          startDate: term.start_date,
          endDate: term.end_date,
          userId,
        });
      } else {
        await db.query(
          `DELETE FROM organization_attendance_calendar_days WHERE calendar_id = $1 AND source = 'public_holiday'`,
          [profile.calendar_id]
        );
      }

      req.flash("success", "Attendance calendar rules saved for the selected term.");
      return res.redirect(`${redirectBase}&calendarTermId=${termId}`);
    } catch (error) {
      req.flash("error", "Failed to save attendance calendar rules.");
      return res.redirect(redirectBase);
    }
  },

  addAttendanceCalendarDayPost: async (req, res, db) => {
    const organizationId = req.session.organizationId;
    const redirectBase = "/account/settings?section=customize";

    try {
      await ensureAttendanceCalendarSchema(db);

      const termId = Number(req.body.termId);
      const calendarDate = req.body.calendarDate;
      const label = (req.body.label || "").trim();
      const countsForAttendance = parseBoolean(req.body.countsForAttendance);

      if (!termId || !calendarDate) {
        req.flash("error", "Term and date are required to add a calendar day.");
        return res.redirect(redirectBase);
      }

      const term = await getTermRecord(db, organizationId, termId);
      if (!term) {
        req.flash("error", "Invalid term selected.");
        return res.redirect(redirectBase);
      }

      if (calendarDate < String(term.start_date) || calendarDate > String(term.end_date)) {
        req.flash("error", "Date must be inside the selected term range.");
        return res.redirect(`${redirectBase}&calendarTermId=${termId}`);
      }

      const userId = req.session.userId || req.session.user?.user_id || null;
      let profile = await getAttendanceCalendarProfile(db, organizationId, termId);

      if (!profile) {
        profile = await upsertAttendanceCalendarProfile(db, {
          organizationId,
          schoolYearId: term.school_year_id,
          termId,
          countryCode: "GH",
          weekendDays: [0, 6],
          includePublicHolidays: true,
          userId,
        });

        await syncPublicHolidayDays(db, {
          calendarId: profile.calendar_id,
          organizationId,
          countryCode: profile.country_code,
          startDate: term.start_date,
          endDate: term.end_date,
          userId,
        });
      }

      await upsertManualCalendarDay(db, {
        calendarId: profile.calendar_id,
        organizationId,
        calendarDate,
        label,
        countsForAttendance,
        userId,
      });

      req.flash("success", "Calendar day rule saved.");
      return res.redirect(`${redirectBase}&calendarTermId=${termId}`);
    } catch (error) {
      req.flash("error", "Failed to save calendar day rule.");
      return res.redirect(redirectBase);
    }
  },

  deleteAttendanceCalendarDayPost: async (req, res, db) => {
    const organizationId = req.session.organizationId;
    const termId = Number(req.body.termId);
    const calendarDayId = Number(req.body.calendarDayId);
    const redirectBase = "/account/settings?section=customize";

    try {
      await ensureAttendanceCalendarSchema(db);

      if (!calendarDayId) {
        req.flash("error", "Invalid calendar day selected.");
        return res.redirect(termId ? `${redirectBase}&calendarTermId=${termId}` : redirectBase);
      }

      const deleted = await deleteManualCalendarDay(db, {
        calendarDayId,
        organizationId,
      });

      if (!deleted) {
        req.flash("info", "Only manual calendar rules can be deleted.");
      } else {
        req.flash("success", "Manual calendar day removed.");
      }

      return res.redirect(termId ? `${redirectBase}&calendarTermId=${termId}` : redirectBase);
    } catch (error) {
      req.flash("error", "Failed to remove calendar day.");
      return res.redirect(termId ? `${redirectBase}&calendarTermId=${termId}` : redirectBase);
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
            req.flash("error", "Failed to resume organization. Please try again.");

      return res.redirect("/account/update");
    }
  },

  updatePlanGet: async (req, res) => {
    try {
      const orgId = req.session.organizationId;
      const currencyProfile = await getCurrencyProfileForRequest(req);

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

      const plans = plansResult.rows
        .map((plan) => ({
          ...plan,
          total_price: parseFloat(plan.total_price) || 0,
        }))
        .map((plan) => {
          const localized = localizeUsdAmount(plan.total_price, currencyProfile);
          return {
            ...plan,
            priceUsdDisplay: formatCurrencyAmount(localized.amountUsd, "USD"),
            localizedPriceDisplay: formatCurrencyAmount(
              localized.localizedAmount,
              localized.userCurrency,
              currencyProfile.locale
            ),
            localizedCurrencyCode: localized.userCurrency,
          };
        });

      res.render("account/updatePlan", {
        title: "Update Subscription Plan",

        currentPlan,

        pendingPlan,

        plans,
        currencyProfile,

        messages: req.flash(),
      });
    } catch (error) {
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
          invalidateOrganizationAccessCache(orgId);
          req.session.allowedFeatures = [];
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
        invalidateOrganizationAccessCache(orgId);
        req.session.allowedFeatures = [];
        req.flash(
          "success",
          "Your plan has been changed to the selected plan."
        );
      }

      return res.redirect(redirectTo || "/account/update-plan");
    } catch (error) {
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
            res.json({ success: false, message: "Delete failed." });
    }
  },

  getFlutterwaveAccountById: async (req, res) => {
    const { id } = req.params;

    const { organizationId } = req.session;

    if (!organizationId) {
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
        // Optionally ignore if subaccount is already gone
      }

      // Step 3: Delete locally

      await db.query(
        `DELETE FROM flutterwave_accounts WHERE id = $1 AND organization_id = $2`,

        [id, organizationId]
      );

      res.json({ success: true });
    } catch (err) {
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
              Authorization: `Bearer ${await getActivePaystackSecretKey()}`,
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
            Authorization: `Bearer ${await getActivePaystackSecretKey()}`,
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
            Authorization: `Bearer ${await getActivePaystackSecretKey()}`,
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
            Authorization: `Bearer ${await getActivePaystackSecretKey()}`,
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
            Authorization: `Bearer ${await getActivePaystackSecretKey()}`,
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
      if (!(await getActivePaystackSecretKey())) {
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
          Authorization: `Bearer ${await getActivePaystackSecretKey()}`,
          "Content-Type": "application/json",
        },
      };
      const currency = "GHS";

      if (account_type === "bank") {
        // Ghana: Use Transfer Recipients (visible in Paystack dashboard under Transfers > Recipients)
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
          }
        } catch (e) {
          // Failed to fetch banks, use provided code as-is
        }

        // Create Paystack Transfer Recipient for Ghana bank

        const recipientPayload = {
          type: "ghipss",
          name: business_name,

          account_number,

          bank_code: resolvedBankCode,
          currency,
        };

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

                return res.json({
          success: true,
          message: "Bank account connected via Paystack (Recipient)",
          recipient_code: recipientCode,
        });
      } else if (account_type === "mobile_money") {
        // Ghana MoMo: Use Transfer Recipients with type 'mobile_money'

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

                return res.json({
          success: true,
          message: "Mobile Money account connected via Paystack (Recipient)",
          recipient_code: recipientCode,
        });
      }
    } catch (error) {
      const message = error.response?.data?.message || error.message;

            // If Paystack rejects the bank details, create a local entry instead
      if (
        message.includes("Account details are invalid") ||
        message.includes("Invalid")
      ) {
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

                    return res.json({
            success: true,
            message:
              "Bank account saved locally (Paystack integration pending)",
          });
        } catch (localError) {
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

            res.json({
        success: true,

        message: "Account updated successfully.",

        account: result.rows[0],
        paystack_updated: updateSuccess,
      });
    } catch (err) {
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
            res.status(500).json({ success: false, message: "Update failed." });
    }
  },

  // GET - Display hub invitation acceptance page
  hubInvitationAcceptGet: async (req, res) => {
    try {
      const { token } = req.params;

      // Validate token
      const invitationResult = await db.query(
        `SELECT hoi.*, mh.hub_name, mh.hub_nickname, mh.hub_email, mh.plan_id, p.plan_name
         FROM hub_organization_invitations hoi
         JOIN managira_hubs mh ON hoi.hub_id = mh.hub_id
         LEFT JOIN plans p ON mh.plan_id = p.id
         WHERE hoi.invitation_token = $1 AND hoi.status = 'pending'`,
        [token]
      );

      if (invitationResult.rows.length === 0) {
        req.flash('error', 'Invalid or expired invitation link.');
        return res.redirect('/account/login');
      }

      const invitation = invitationResult.rows[0];

      // Check if invitation has expired
      if (new Date(invitation.expires_at) < new Date()) {
        req.flash('error', 'This invitation has expired. Please contact the hub for a new invitation.');
        return res.redirect('/account/login');
      }

      res.render('account/hubInvitation', {
        title: 'Accept Hub Invitation',
        invitation,
        token,
        showFooterTopSection: true
      });
    } catch (error) {
            req.flash('error', 'An error occurred while loading the invitation.');
      res.redirect('/account/login');
    }
  },

  // POST - Process hub invitation acceptance
  hubInvitationAcceptPost: async (req, res) => {
    const client = await db.connect();
    try {
      await client.query('BEGIN');
      
            const { token } = req.params;
            
      const {
        organization_nickname,
        admin_email,
        admin_password,
        admin_first_name,
        admin_last_name,
        admin_phone,
        accept_terms
      } = req.body;

            // Validate required fields
      if (!organization_nickname || !admin_email || !admin_password || !admin_first_name || !admin_last_name) {
                await client.query('ROLLBACK');
        client.release();
        req.flash('error', 'Please fill in all required fields.');
        return res.redirect(`/account/accept-hub-invitation/${token}`);
      }

      if (!accept_terms) {
                await client.query('ROLLBACK');
        client.release();
        req.flash('error', 'You must accept the terms and conditions.');
        return res.redirect(`/account/accept-hub-invitation/${token}`);
      }

            // Get invitation details
            const invitationResult = await client.query(
        `SELECT hoi.*, mh.hub_name, mh.hub_nickname, mh.hub_email, mh.hub_id, mh.plan_id
         FROM hub_organization_invitations hoi
         JOIN managira_hubs mh ON hoi.hub_id = mh.hub_id
         WHERE hoi.invitation_token = $1 AND hoi.status = 'pending'`,
        [token]
      );

      if (invitationResult.rows.length === 0) {
                await client.query('ROLLBACK');
        client.release();
        req.flash('error', 'Invalid or expired invitation.');
        return res.redirect('/account/login');
      }

      const invitation = invitationResult.rows[0];
      
      // Check expiration
      if (new Date(invitation.expires_at) < new Date()) {
        await client.query('ROLLBACK');
        client.release();
        req.flash('error', 'This invitation has expired.');
        return res.redirect('/account/login');
      }

      // Check if nickname is available
      const nicknameCheck = await client.query(
        'SELECT organization_id FROM organizations WHERE nickname = $1',
        [organization_nickname.toLowerCase()]
      );

      if (nicknameCheck.rows.length > 0) {
        await client.query('ROLLBACK');
        client.release();
        req.flash('error', 'This subdomain is already taken. Please choose another.');
        return res.redirect(`/account/accept-hub-invitation/${token}`);
      }

            // Check if admin email exists
            const emailCheck = await client.query(
        'SELECT user_id FROM users WHERE email = $1',
        [admin_email]
      );

      if (emailCheck.rows.length > 0) {
                await client.query('ROLLBACK');
        client.release();
        req.flash('error', 'This email is already registered. Please use a different email.');
        return res.redirect(`/account/accept-hub-invitation/${token}`);
      }

            // Hash password
            const hashedPassword = await bcrypt.hash(admin_password, 10);
            // Create organization with proper password and fields
            const orgParams = [
        invitation.organization_name,
        organization_nickname.toLowerCase(),
        admin_email,
        admin_first_name,
        admin_last_name,
        admin_phone || '',
        invitation.hub_id,
        invitation.plan_id,
        hashedPassword
      ];
            const orgResult = await client.query(
        `INSERT INTO organizations 
         (organization_name, nickname, email, first_name, last_name, 
          organization_phone, organization_address, hub_id, is_hub_member, joined_hub_at, plan_id, created_at, 
          approved, password, proof_of_existence_1, proof_of_existence_2)
         VALUES ($1, $2, $3, $4, $5, $6, '', $7, true, CURRENT_TIMESTAMP, $8, CURRENT_TIMESTAMP, true, $9, '', '')
         RETURNING organization_id`,
        orgParams
      );

      const organizationId = orgResult.rows[0].organization_id;
            // Create admin user
            const userParams = [organizationId, admin_email, admin_first_name, admin_last_name, admin_phone || '', hashedPassword];
            await client.query(
        `INSERT INTO users 
         (organization_id, email, first_name, last_name, phone, password, role, isActive, created_at)
         VALUES ($1, $2, $3, $4, $5, $6, 'admin', true, CURRENT_TIMESTAMP)`,
        userParams
      );

            // Update invitation status
            await client.query(
        `UPDATE hub_organization_invitations 
         SET status = 'accepted', updated_at = CURRENT_TIMESTAMP 
         WHERE invitation_id = $1`,
        [invitation.invitation_id]
      );
            // Log hub activity
            await client.query(
        `INSERT INTO hub_activity_logs (hub_id, action_type, target_organization_id, description, performed_by, ip_address)
         VALUES ($1, 'invitation_accepted', $2, $3, $4, $5)`,
        [
          invitation.hub_id,
          organizationId,
          `Organization ${invitation.organization_name} accepted invitation`,
          admin_email,
          req.ip
        ]
      );
                  // Send welcome email to organization admin
      const welcomeEmailHtml = renderCleanEmail({
        title: 'Welcome to Managira SMS',
        greeting: `Dear ${admin_first_name},`,
        intro: `Your organization ${invitation.organization_name} has successfully joined the ${invitation.hub_name} hub.`,
        message: 'You can now log in and start using your dashboard.',
        actionUrl: `${process.env.APP_URL || 'http://localhost:4000'}/account/login`,
        actionText: 'Go to Dashboard',
        details: [
          `Organization: ${invitation.organization_name}`,
          `Subdomain: ${organization_nickname}.${invitation.hub_nickname}.managira.com`,
          `Admin Email: ${admin_email}`,
          `Hub: ${invitation.hub_name}`,
        ],
        note: `If you have questions, contact your hub administrator at ${invitation.hub_email}.`,
        closing: 'Welcome aboard!',
      });

      const smtpConfig = {
        host: process.env.SMTP_HOST,
        port: parseInt(process.env.SMTP_PORT),
        secure: process.env.SMTP_SECURE === 'true',
        auth: {
          user: process.env.ADMIN_NOTIFY_EMAIL_USER,
          pass: process.env.ADMIN_NOTIFY_EMAIL_PASSWORD,
        },
      };

      await sendEmailSafely({
        smtpConfig,
        to: admin_email,
        subject: `Welcome to ${invitation.hub_name} Hub - Managira SMS`,
        html: welcomeEmailHtml,
        from: process.env.NOTIFY_EMAIL_USER,
      });

      // Notify hub
      const hubNotificationHtml = renderCleanEmail({
        title: 'New Organization Joined',
        greeting: 'Good news,',
        intro: `${invitation.organization_name} has accepted your invitation and joined your hub.`,
        details: [
          `Name: ${invitation.organization_name}`,
          `Subdomain: ${organization_nickname}.${invitation.hub_nickname}.managira.com`,
          `Admin: ${admin_first_name} ${admin_last_name}`,
          `Email: ${admin_email}`,
          `Joined: ${new Date().toLocaleDateString()}`,
        ],
        closing: 'You can now manage this organization from your hub dashboard.',
      });

      await sendEmailSafely({
        smtpConfig,
        to: invitation.hub_email,
        subject: `${invitation.organization_name} Joined Your Hub`,
        html: hubNotificationHtml,
        from: process.env.NOTIFY_EMAIL_USER,
      });

                  
      await client.query('COMMIT');
      client.release();
      
            req.flash('success', `Welcome! Your organization has been set up successfully. Please log in with your credentials.`);
      res.redirect('/account/login');
    } catch (error) {
      await client.query('ROLLBACK');
      client.release();
      
                                                      
      // More specific error messages
      let errorMessage = 'An error occurred while processing your invitation.';
      if (error.code === '23505') { // PostgreSQL unique violation
                if (error.constraint && error.constraint.includes('nickname')) {
          errorMessage = 'This subdomain is already taken. Please choose another.';
                  } else if (error.constraint && error.constraint.includes('email')) {
          errorMessage = 'This email is already registered. Please use a different email.';
                  }
      }
      
      req.flash('error', errorMessage);
      return res.redirect(`/account/accept-hub-invitation/${req.params.token}`);
    }
  },

  // POST - Request detachment from hub
  requestHubDetachmentPost: async (req, res) => {
    try {
      const organizationId = req.session.organizationId;
      const { reason } = req.body;

                        if (!reason || reason.trim().length < 10) {
        req.flash('error', 'Please provide a detailed reason for detachment (at least 10 characters).');
        return res.redirect('/account/update');
      }

      // Get organization details
      const orgResult = await db.query(
        'SELECT * FROM organizations WHERE organization_id = $1',
        [organizationId]
      );

      if (orgResult.rows.length === 0) {
        req.flash('error', 'Organization not found.');
        return res.redirect('/account/update');
      }

      const organization = orgResult.rows[0];

      if (!organization.hub_id || !organization.is_hub_member) {
        req.flash('error', 'Your organization is not part of a hub.');
        return res.redirect('/account/update');
      }

            // Check for existing pending request
      const existingRequest = await db.query(
        `SELECT * FROM hub_detachment_requests 
         WHERE organization_id = $1 AND status = 'pending'`,
        [organizationId]
      );

      if (existingRequest.rows.length > 0) {
                req.flash('warning', 'You already have a pending detachment request. Please wait for hub review.');
        return res.redirect('/account/update');
      }

      // Create detachment request
      await db.query(
        `INSERT INTO hub_detachment_requests 
         (organization_id, hub_id, reason, requested_by)
         VALUES ($1, $2, $3, $4)`,
        [organizationId, organization.hub_id, reason, req.session.email]
      );

            // Get hub details for notification
      const hubResult = await db.query(
        'SELECT * FROM managira_hubs WHERE hub_id = $1',
        [organization.hub_id]
      );

      if (hubResult.rows.length > 0) {
        const hub = hubResult.rows[0];

        const emailHtml = renderCleanEmail({
          title: "Detachment Request",
          greeting: `Dear <strong>${he.encode(hub.hub_name)} Administrator</strong>,`,
          paragraphs: [
            `<strong>${he.encode(organization.organization_name)}</strong> has requested to detach from your hub.`,
            "Please log in to your hub dashboard to review and approve/reject this request.",
          ],
          details: [
            { label: "Organization", value: he.encode(organization.organization_name) },
            { label: "Subdomain", value: `${he.encode(organization.nickname)}.${he.encode(hub.hub_nickname)}.managira.com` },
            { label: "Contact", value: he.encode(organization.email) },
            { label: "Requested by", value: he.encode(req.session.email || '') },
            { label: "Date", value: new Date().toLocaleDateString() },
            { label: "Reason", value: he.encode(reason) },
          ],
          cta: {
            text: "Review Request",
            url: `${process.env.APP_URL || 'http://localhost:4000'}/hub/dashboard`,
          },
        });

        await sendEmail({
          to: hub.hub_email,
          subject: `Detachment Request from ${organization.organization_name}`,
          html: emailHtml
        });

              }

      // Log activity
      await db.query(
        `INSERT INTO hub_activity_logs (hub_id, action_type, target_organization_id, description, performed_by, ip_address)
         VALUES ($1, 'detachment_requested', $2, $3, $4, $5)`,
        [
          organization.hub_id,
          organizationId,
          `Detachment request from ${organization.organization_name}`,
          req.session.email,
          req.ip
        ]
      );

            req.flash('success', 'Your detachment request has been submitted. The hub will review your request and respond accordingly.');
      res.redirect('/account/update');
    } catch (error) {
            req.flash('error', 'Error submitting detachment request.');
      res.redirect('/account/update');
    }
  },

  // GET - Accept hub invitation for existing organization
  hubInvitationAcceptExistingGet: async (req, res) => {
    try {
      const { token } = req.params;

      // Find invitation
      const inviteResult = await db.query(
        `SELECT hi.*, h.hub_name, h.hub_nickname, h.hub_email
         FROM hub_organization_invitations hi
         JOIN managira_hubs h ON hi.hub_id = h.hub_id
         WHERE hi.invitation_token = $1 AND hi.status = 'pending' AND hi.expires_at > NOW()`,
        [token]
      );

      if (inviteResult.rows.length === 0) {
                req.flash('error', 'Invalid or expired invitation link.');
        return res.redirect('/account/login');
      }

      const invitation = inviteResult.rows[0];

            res.render('account/acceptHubInvitationExisting', {
        invitation,
        token,
        title: 'Accept Hub Invitation',
        req
      });
    } catch (error) {
            req.flash('error', 'Error loading invitation.');
      res.redirect('/account/login');
    }
  },

  // POST - Accept hub invitation for existing organization
  hubInvitationAcceptExistingPost: async (req, res) => {
    const client = await db.connect();
    
    try {
      const { token } = req.params;
      const { confirm } = req.body;

      if (confirm !== 'yes') {
        req.flash('error', 'You must confirm to accept the invitation.');
        return res.redirect(`/account/accept-hub-invitation-existing/${token}`);
      }

      await client.query('BEGIN');

      // Get invitation details
      const inviteResult = await client.query(
        `SELECT hi.*, h.hub_id, h.hub_name, h.hub_nickname, h.hub_email
         FROM hub_organization_invitations hi
         JOIN managira_hubs h ON hi.hub_id = h.hub_id
         WHERE hi.invitation_token = $1 AND hi.status = 'pending' AND hi.expires_at > NOW()`,
        [token]
      );

      if (inviteResult.rows.length === 0) {
        await client.query('ROLLBACK');
        req.flash('error', 'Invalid or expired invitation.');
        return res.redirect('/account/login');
      }

      const invitation = inviteResult.rows[0];

            // Verify organization exists and is not in a hub
      const orgResult = await client.query(
        `SELECT * FROM organizations WHERE organization_id = $1 AND deleted = false`,
        [invitation.existing_org_id]
      );

      if (orgResult.rows.length === 0) {
        await client.query('ROLLBACK');
        req.flash('error', 'Organization not found.');
        return res.redirect('/account/login');
      }

      const organization = orgResult.rows[0];

      if (organization.is_hub_member && organization.hub_id) {
        await client.query('ROLLBACK');
        req.flash('error', 'This organization is already part of a hub.');
        return res.redirect('/account/login');
      }

            // Update organization to join hub
      await client.query(
        `UPDATE organizations 
         SET hub_id = $1, is_hub_member = true, joined_hub_at = CURRENT_TIMESTAMP
         WHERE organization_id = $2`,
        [invitation.hub_id, invitation.existing_org_id]
      );

            // Update invitation status
      await client.query(
        `UPDATE hub_organization_invitations 
         SET status = 'accepted', accepted_at = CURRENT_TIMESTAMP 
         WHERE invitation_id = $1`,
        [invitation.invitation_id]
      );

            // Log activity
      await client.query(
        `INSERT INTO hub_activity_logs (hub_id, action_type, target_organization_id, description, performed_by, ip_address)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [
          invitation.hub_id,
          'organization_joined',
          invitation.existing_org_id,
          `${organization.organization_name} accepted invitation and joined hub`,
          organization.email,
          req.ip
        ]
      );

            await client.query('COMMIT');
      client.release();

            // Send confirmation emails
      const hubEmailHtml = renderCleanEmail({
        title: "Organization Joined Your Hub",
        greeting: `Good news, <strong>${he.encode(invitation.hub_name)} Team</strong>,`,
        paragraphs: [
          `<strong>${he.encode(organization.organization_name)}</strong> accepted your invitation and is now part of your hub.`,
        ],
        details: [
          { label: "Organization", value: he.encode(organization.organization_name) },
          { label: "Email", value: he.encode(organization.email) },
          { label: "Subdomain", value: `${he.encode(organization.nickname)}.${he.encode(invitation.hub_nickname)}.managira.com` },
        ],
      });

      const orgEmailHtml = renderCleanEmail({
        title: `Welcome to ${he.encode(invitation.hub_name)}`,
        greeting: `Dear <strong>${he.encode(organization.organization_name)} Team</strong>,`,
        paragraphs: [
          `Your organization is now part of <strong>${he.encode(invitation.hub_name)}</strong>.`,
          `You can continue using Managira as usual. For questions, contact ${he.encode(invitation.hub_name)} at ${he.encode(invitation.hub_email)}.`,
        ],
        details: [
          { label: "New Subdomain", value: `${he.encode(organization.nickname)}.${he.encode(invitation.hub_nickname)}.managira.com` },
          { label: "Subscription", value: `Managed by ${he.encode(invitation.hub_name)}` },
          { label: "Data", value: "All your data remains intact" },
        ],
      });

      // Send emails
      await sendEmailSafely({
        to: invitation.hub_email,
        subject: `${organization.organization_name} Joined Your Hub`,
        html: hubEmailHtml,
        attachments: [{
          filename: 'managira.png',
          path: path.join(__dirname, '../public/images/managira.png'),
          cid: 'managira_logo'
        }]
      }, 'HubJoinConfirmation');

      await sendEmailSafely({
        to: organization.email,
        subject: `Welcome to ${invitation.hub_name} Hub`,
        html: orgEmailHtml,
        attachments: [{
          filename: 'managira.png',
          path: path.join(__dirname, '../public/images/managira.png'),
          cid: 'managira_logo'
        }]
      }, 'OrgWelcomeToHub');

      req.flash('success', `Successfully joined ${invitation.hub_name}! You can now log in with your existing credentials.`);
      res.redirect('/account/login');
    } catch (error) {
      await client.query('ROLLBACK');
      client.release();
            req.flash('error', 'Error accepting invitation.');
      res.redirect('/account/login');
    }
  },
};

accountController.sendBrandedReceiptEmail = sendBrandedReceiptEmail;

accountController.sendRegistrationSuccessEmail = sendRegistrationSuccessEmail;

accountController.sendInvoiceEmail = sendInvoiceEmail;

accountController.sendCancellationEmail = sendCancellationEmail;

module.exports = accountController;













