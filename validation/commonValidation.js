const { check, body, validationResult } = require("express-validator");

// ── Smart sanitization helpers ──────────────────────────────────────────────
function sanitizePhone(raw) {
  if (!raw) return '';
  // Strip everything except digits: +, spaces, dashes, parens, dots
  return String(raw).replace(/[\s\-\(\)\.\+]/g, '');
}

function normalizeGender(raw) {
  if (!raw) return '';
  const g = String(raw).trim().toLowerCase();
  if (g === 'm' || g === 'male' || g === 'boy') return 'Male';
  if (g === 'f' || g === 'female' || g === 'girl') return 'Female';
  // Return original if already "Male"/"Female" or unrecognized
  return raw.trim();
}

// Names: allow letters, spaces, hyphens, apostrophes, accents, periods
const NAME_REGEX = /^[A-Za-zÀ-ÖØ-öø-ÿ\s'\-\.]+$/;

// Helper to validate dynamic student fields
const validateStudents = (req, res, next) => {
  const errors = [];

  const body = req.body;
  const indexes = [];
  const studentFieldPattern = /^(?:firstName|lastName|dateOfBirth|gender|classId|graduationYearGroupId|hometown|height|enrollmentType|schoolYearId|termId)_(\d+)$/;

  const isMultiple = Object.keys(body).some((key) => key.match(/_\d+$/));

  if (isMultiple) {
    Object.keys(body).forEach((key) => {
      const match = key.match(studentFieldPattern);
      if (match && !indexes.includes(match[1])) indexes.push(match[1]);
    });
  } else {
    indexes.push("single");
  }

  for (const index of indexes) {
    const prefix = index === "single" ? "" : `_${index}`;
    const getField = (field) => {
      if (index === "single") {
        return body[field]?.trim() || "";
      }
      return (
        body[`${field}${prefix}`]?.trim() ||
        body[`${field}___${index}`]?.trim() ||
        ""
      );
    };

    const firstName = getField("firstName");
    const lastName = getField("lastName");
    const dateOfBirth = getField("dateOfBirth");
    const gender = getField("gender");
    const classId = getField("classId");
    const graduationGroup = getField("graduationYearGroupId");

    const isCompletelyEmpty = !firstName && !lastName && !dateOfBirth && !gender && !classId;
    if (isCompletelyEmpty) {
      continue;
    }

    if (!firstName.match(/^[A-Za-z\s]+$/)) {
      errors.push(
        `Student ${
          +index + 1
        }: First name is required and must contain only letters and spaces.`
      );
    }

    if (!lastName.match(/^[A-Za-z\s]+$/)) {
      errors.push(
        `Student ${
          +index + 1
        }: Last name is required and must contain only letters and spaces.`
      );
    }

    if (!dateOfBirth) {
      errors.push(`Student ${+index + 1}: Date of birth is required.`);
    }

    if (!gender) {
      errors.push(`Student ${+index + 1}: Gender is required.`);
    }

    if (!classId) {
      errors.push(`Student ${+index + 1}: Class selection is required.`);
    }

    // Validate guardians if any
    const guardianKeys = Object.keys(body).filter((k) =>
      k.startsWith(`guardianFirstName${prefix === "" ? "_" : prefix}_`)
    );
    for (const gk of guardianKeys) {
      const gIdx = gk.split("_")[2];
      const gFirstName = body[`guardianFirstName${prefix}_${gIdx}`]?.trim();
      const gPhone = body[`guardianPhone${prefix}_${gIdx}`]?.trim();

      if (gFirstName && !gFirstName.match(/^[A-Za-z\s]+$/)) {
        errors.push(
          `Student ${+index + 1}: Guardian ${
            +gIdx + 1
          } first name must contain only letters.`
        );
      }

      if (gPhone && !gPhone.match(/^\d{9,15}$/)) {
        errors.push(
          `Student ${+index + 1}: Guardian ${
            +gIdx + 1
          } phone must be numeric (9-15 digits).`
        );
      }
    }
  }

  if (errors.length) {
    console.warn('[AddStudent Validation] Failed required checks', {
      indexes,
      sampleKeys: Object.keys(body).slice(0, 30),
      errors
    });
    req.flash("error", errors);
    return res.redirect("back");
  }

  next();
};

// Validate public register
const validatePublicRegister = [
  check("firstName")
    .trim()
    .escape()
    .matches(/^[A-Za-z\s]+$/)
    .withMessage("First name must contain only letters and spaces.")
    .notEmpty()
    .withMessage("First name is required"),

  check("lastName")
    .trim()
    .escape()
    .matches(/^[A-Za-z\s]+$/)
    .withMessage("Last name must contain only letters and spaces.")
    .notEmpty()
    .withMessage("Last name is required"),

  check("dateOfBirth").notEmpty().withMessage("Date of birth is required"),

  check("gender").notEmpty().withMessage("Gender is required"),

  check("classId").notEmpty().withMessage("Class is required"),

  check("studentImage").optional(),

  check("guardianEmail0")
    .optional({ checkFalsy: true })
    .isEmail()
    .withMessage("Guardian email must be valid"),

  check("guardianPhone0")
    .optional({ checkFalsy: true })
    .matches(/^\d{9,15}$/)
    .withMessage("Guardian phone must be 9–15 digits"),
];

const validatePublicRegisterResult = (req, res, next) => {
  const errors = validationResult(req);
  const orgId = req.query.organizationId;

  if (!errors.isEmpty()) {
    req.flash(
      "error",
      errors.array().map((err) => err.msg)
    );
    return res.redirect("back");
  }

  next();
};

// Validate Employee creation
const validateCreateEmployees = [
  body("firstName")
    .trim()
    .notEmpty()
    .withMessage("First name is required.")
    .isLength({ min: 2, max: 30 })
    .withMessage("First name must be 2-30 characters.")
    .matches(/^[A-Za-z\s]+$/)
    .withMessage("First name must contain only letters and spaces."),

  body("lastName")
    .trim()
    .notEmpty()
    .withMessage("Last name is required.")
    .isLength({ min: 2, max: 30 })
    .withMessage("Last name must be 2-30 characters.")
    .matches(/^[A-Za-z\s]+$/)
    .withMessage("Last name must contain only letters and spaces."),

  body("email")
    .trim()
    .notEmpty()
    .withMessage("Email is required.")
    .isEmail()
    .withMessage("Invalid email address.")
    .normalizeEmail(),
];

const validateCreateEmployeesResult = (req, res, next) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    req.flash(
      "error",
      errors
        .array()
        .map((err) => err.msg)
        .join(" ")
    );
    return res.redirect("back");
  }
  next();
};

// validating event and announcement create and updates on school website edit
const validateEvent = [
  check("eventName")
    .trim()
    .notEmpty()
    .withMessage("Event name is required.")
    .isLength({ min: 3, max: 100 })
    .withMessage("Event name must be between 3 and 100 characters."),
  check("eventDate")
    .notEmpty()
    .withMessage("Event date is required.")
    .isISO8601()
    .withMessage("Invalid date format."),
  check("eventDetails")
    .trim()
    .notEmpty()
    .withMessage("Event details are required.")
    .isLength({ min: 10 })
    .withMessage("Event details must be at least 10 characters."),
];

const validateEventResult = (req, res, next) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    req.flash(
      "error",
      errors
        .array()
        .map((err) => err.msg)
        .join(" ")
    );
    return res.redirect("back");
  }
  next();
};

const validateAnnouncement = [
  check("announcementMessage")
    .trim()
    .notEmpty()
    .withMessage("Announcement message is required.")
    .isLength({ min: 5 })
    .withMessage("Announcement message must be at least 5 characters."),
];

const validateAnnouncementResult = (req, res, next) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    req.flash(
      "error",
      errors
        .array()
        .map((err) => err.msg)
        .join(" ")
    );
    return res.redirect("back");
  }
  next();
};

// validate add class subject and graduation year

const validateAddClass = [
  check("className.*")
    .trim()
    .notEmpty()
    .withMessage("Class name is required.")
    .matches(/^[A-Za-z0-9\s\-]+$/)
    .withMessage(
      "Class name can only contain letters, numbers, spaces, or hyphens."
    ),
];

const validateAddClassResult = (req, res, next) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    req.flash(
      "error",
      errors
        .array()
        .map((err) => err.msg)
        .join(" ")
    );
    return res.redirect("back");
  }
  next();
};

const validateAddSubject = [
  check("subjectName.*")
    .trim()
    .notEmpty()
    .withMessage("Subject name is required.")
    .isLength({ min: 2 })
    .withMessage("Subject name must be at least 2 characters."),
  check("classId")
    .exists()
    .withMessage("At least one class must be selected for each subject."),
];

const validateAddSubjectResult = (req, res, next) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    req.flash(
      "error",
      errors
        .array()
        .map((err) => err.msg)
        .join(" ")
    );
    return res.redirect("back");
  }
  next();
};

const validateGraduationYear = [
  check("graduationYear.*")
    .trim()
    .notEmpty()
    .withMessage("Graduation year is required.")
    .matches(/^\d{4}$/)
    .withMessage("Graduation year must be a 4-digit number."),
];

const validateGraduationYearResult = (req, res, next) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    req.flash(
      "error",
      errors
        .array()
        .map((err) => err.msg)
        .join(" ")
    );
    return res.redirect("back");
  }
  next();
};

module.exports = {
  validateStudents,
  validatePublicRegister,
  validatePublicRegisterResult,
  validateCreateEmployees,
  validateCreateEmployeesResult,
  validateEvent,
  validateEventResult,
  validateAnnouncement,
  validateAnnouncementResult,
  validateAddClass,
  validateAddClassResult,
  validateAddSubject,
  validateAddSubjectResult,
  validateGraduationYear,
  validateGraduationYearResult,
};
