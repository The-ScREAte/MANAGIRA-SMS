//server side validation for account routes
const db = require("../config/db");
const { check, body, validationResult } = require("express-validator");

// validation for login page
const validateLogin = [
  check("email")
    .trim()
    .escape()
    .notEmpty()
    .withMessage("Email is required.")
    .isEmail()
    .withMessage("Invalid email format"),
  check("password")
    .trim()
    .escape()
    .notEmpty()
    .withMessage("Password is required."),
];

const validateLoginResult = (req, res, next) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    req.flash(
      "error",
      errors.array().map((err) => err.msg)
    );
    return res.redirect("back");
  }
  next();
};

// Guardian login (email OR phone)
const validateGuardianLogin = [
  check("identifier")
    .trim()
    .escape()
    .notEmpty()
    .withMessage("Email or phone number is required."),
  check("password")
    .trim()
    .escape()
    .notEmpty()
    .withMessage("Password is required."),
];

const validateGuardianLoginResult = (req, res, next) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    req.flash(
      "error",
      errors.array().map((err) => err.msg)
    );
    return res.redirect("back");
  }
  next();
};

//validation for registration page
const validateRegistration = [
  check("firstName")
    .escape()
    .trim()
    .not()
    .isEmpty()
    .withMessage("First name is required"),
  check("lastName")
    .escape()
    .trim()
    .not()
    .isEmpty()
    .withMessage("Last name is required"),
  check("email").isEmail().withMessage("Invalid email format"),
  check("password")
    .escape()
    .trim()
    .not()
    .isEmpty()
    .withMessage("Password is required")
    .matches(/^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[!@#$%^&*]).{6,}$/)
    .withMessage("Password must meet security standards"),
  check("confirmPassword").custom((value, { req }) => {
    if (value !== req.body.password) {
      throw new Error("Passwords do not match");
    }
    return true;
  }),

  check("orgName")
    .escape()
    .trim()
    .not()
    .isEmpty()
    .withMessage("Organization name is required")
    .isLength({ min: 3, max: 50 })
    .withMessage("Organization name must be between 3 and 50 characters"),
  check("orgNickName")
    .escape()
    .trim()
    .not()
    .isEmpty()
    .withMessage("Organization nickname is required")
    .isLength({ min: 3, max: 15 })
    .withMessage("Organization nickname must be between 3 and 15 characters")
    .matches(/^[a-z]+$/)
    .withMessage("Only lowercase letters allowed (a-z)")
    .custom(async (value, { req }) => {
      await checkNickNameExists(value);
      return true;
    }),
  check("orgAddress")
    .escape()
    .trim()
    .not()
    .isEmpty()
    .withMessage("Organization address is required")
    .isLength({ min: 10, max: 100 })
    .withMessage("Organization address must be between 10 and 100 characters"),
  check("orgPhone")
    .escape()
    .trim()
    .not()
    .isEmpty()
    .withMessage("Organization phone number is required")
    .matches(
      /^(\+?233|0)?\s?\d{2,3}[\s-]?\d{3}[\s-]?\d{4}$|^(\(\d{3}\)|\d{3})[-.\s]?\d{3}[-.\s]?\d{4}$/
    )
    .withMessage("Invalid phone number format"),
  // check("plan").not().isEmpty().withMessage("Please select a plan"), // Removed plan validation for registration
  check("proof1").custom((value, { req }) => {
    if (!req.files?.proof1?.[0]) {
      throw new Error("Proof of existence is required");
    }
    return true;
  }),
];

const validateRegistrationResult = (req, res, next) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    req.flash(
      "error",
      errors.array().map((error) => error.msg)
    );
    return res.redirect("/account/register");
  }
  next();
};

const checkNickNameExists = async (nickname) => {
  const result = await db.query(
    "SELECT COUNT(*) AS count FROM organizations WHERE nickname = $1",
    [nickname]
  );
  if (result.rows[0].count > 0) {
    throw new Error("Organization nickname already exists");
  }
};

// validate account update page

const validateAccountUpdate = [
  check("firstName")
    .escape()
    .trim()
    .notEmpty()
    .withMessage("First name is required")
    .matches(/^[a-zA-Z]+$/)
    .withMessage("First name must contain only letters"),
  check("lastName")
    .escape()
    .trim()
    .notEmpty()
    .withMessage("Last name is required")
    .matches(/^[a-zA-Z]+$/)
    .withMessage("Last name must contain only letters"),
  check("email").isEmail().withMessage("Valid email is required"),

  // Password checks only if a password is provided
  body("password")
    .optional({ checkFalsy: true })
    .isLength({ min: 6 })
    .withMessage("Password must be at least 6 characters")
    .matches(/[A-Z]/)
    .withMessage("Password must contain an uppercase letter")
    .matches(/[a-z]/)
    .withMessage("Password must contain a lowercase letter")
    .matches(/\d/)
    .withMessage("Password must contain a digit")
    .matches(/[!@#$%^&*]/)
    .withMessage("Password must contain a special character"),

  body("confirmPassword").custom((value, { req }) => {
    if (req.body.password && value !== req.body.password) {
      throw new Error("Passwords do not match");
    }
    return true;
  }),
];

const validateUpdateResult = (req, res, next) => {
  const { validationResult } = require("express-validator");
  const errors = validationResult(req);

  if (!errors.isEmpty()) {
    req.flash(
      "error",
      errors.array().map((e) => e.msg)
    );
    return res.redirect("/account/update");
  }

  next();
};

// validate nickname update.

const validateNickname = [
  check("orgNickName")
    .escape()
    .trim()
    .notEmpty()
    .withMessage("Organization nickname is required")
    .matches(/^[a-z]{3,15}$/)
    .withMessage("Nickname must be 3–15 lowercase letters only (a–z)"),
];

const validateNicknameResult = (req, res, next) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    req.flash(
      "error",
      errors.array().map((e) => e.msg)
    );
    return res.redirect("/account/personalization");
  }
  next();
};

// Validate public dashboard edit addTextSection
const validateTextSection = [
  check("heading")
    .trim()
    .notEmpty()
    .withMessage("Heading is required")
    .isLength({ min: 3, max: 100 })
    .withMessage("Heading must be 3 to 100 characters"),

  check("paragraph")
    .trim()
    .notEmpty()
    .withMessage("Text content is required")
    .isLength({ min: 10 })
    .withMessage("Text must be at least 10 characters long"),
];

const validateTextSectionResult = (req, res, next) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    req.flash(
      "error",
      errors.array().map((e) => e.msg)
    );
    return res.redirect("/account/managePublicContent");
  }
  next();
};

module.exports = {
  validateLogin,
  validateLoginResult,
  validateGuardianLogin,
  validateGuardianLoginResult,
  validateRegistration,
  validateRegistrationResult,
  validateAccountUpdate,
  validateUpdateResult,
  validateNickname,
  validateNicknameResult,
  validateTextSection,
  validateTextSectionResult,
};
