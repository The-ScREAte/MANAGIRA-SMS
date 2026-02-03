const { S3Client, PutObjectCommand } = require("@aws-sdk/client-s3");
const multer = require("multer");
const multerS3 = require("multer-s3");
const path = require("path");
const fs = require("fs");
const bcrypt = require("bcryptjs");
const crypto = require("crypto");
const nodemailer = require("nodemailer");
require("dotenv").config(); // Load environment variables from .env file
const { uploadToS3, deleteFromS3 } = require("../middleware/s3Upload");
const axios = require("axios");
const he = require("he");

// Configure AWS S3
const s3 = new S3Client({
  region: process.env.AWS_REGION,
  credentials: {
    accessKeyId: process.env.AWS_ACCESS_KEY_ID,
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
  },
});

const BUCKET_NAME = process.env.S3_BUCKET_NAME;

// Helper function for ordinal suffixes (1st, 2nd, 3rd, etc.)
function getOrdinalSuffix(n) {
  const s = ["th", "st", "nd", "rd"];
  const v = n % 100;
  return s[(v - 20) % 10] || s[v] || s[0];
}

// Setup multer for file uploads
const storage = multerS3({
  s3: s3,
  bucket: BUCKET_NAME,
  key: function (req, file, cb) {
    cb(null, Date.now().toString() + "-" + file.originalname);
  },
});

const upload = multer({ storage: storage });

const savePendingStudentChanges = async (req, res, db) => {
  const { id } = req.params;
  const organizationId = req.session.organizationId;
  const body = req.body;
  const file = req.file;

  const client = await db.connect();

  try {
    await client.query("BEGIN");

    // Parse and coerce values
    const classId = body.class_id ? parseInt(body.class_id) : null;
    const gradGroupId = body.graduation_year_group_id
      ? parseInt(body.graduation_year_group_id)
      : null;

    let schoolYearId = null;
    let termId = null;

    // ✅ If enrollment is current, fetch current school year and term
    if (body.enrollmentType === "current") {
      const currentYearRes = await client.query(
        `SELECT id AS school_year_id FROM school_years WHERE current = TRUE AND organization_id = $1 LIMIT 1`,
        [organizationId]
      );

      if (currentYearRes.rows.length > 0) {
        schoolYearId = currentYearRes.rows[0].school_year_id;

        const currentTermRes = await client.query(
          `SELECT term_id FROM terms WHERE school_year_id = $1 AND current = TRUE LIMIT 1`,
          [schoolYearId]
        );

        if (currentTermRes.rows.length > 0) {
          termId = currentTermRes.rows[0].term_id;
        }
      }
    } else {
      // Use submitted values for future enrollment
      schoolYearId = body.schoolYearId ? parseInt(body.schoolYearId) : null;
      termId = body.termId ? parseInt(body.termId) : null;
    }

    // ✅ Upload and save image if provided
    let imageUrl = null;
    if (file) {
      imageUrl = await uploadToS3(file); // Adjust this if you're using a different upload utility
    }

    // ✅ Update pending student
    const baseParams = [
      body.first_name,
      body.last_name,
      body.date_of_birth,
      body.gender,
      body.hometown,
      classId,
      gradGroupId,
      schoolYearId,
      termId,
      body.enrollmentType,
    ];

    const queryParams = imageUrl
      ? [...baseParams, imageUrl, id, organizationId]
      : [...baseParams, id, organizationId];

    const updateQuery = `
      UPDATE pending_students SET
        first_name = $1,
        last_name = $2,
        date_of_birth = $3,
        gender = $4,
        hometown = $5,
        class_id = $6,
        graduation_year_group_id = $7,
        school_year_id = $8,
        term_id = $9,
        enrollment_type = $10
        ${imageUrl ? ", image_url = $11" : ""}
      WHERE pending_id = $${imageUrl ? 12 : 11} AND organization_id = $${
      imageUrl ? 13 : 12
    }
    `;

    await client.query(updateQuery, queryParams);

    // ✅ Replace subjects
    await client.query(
      `DELETE FROM pending_student_subjects WHERE pending_student_id = $1`,
      [id]
    );
    const subjectArray = Array.isArray(body.subjects)
      ? body.subjects
      : body.subjects
      ? [body.subjects]
      : [];
    for (const subjectId of subjectArray) {
      await client.query(
        `INSERT INTO pending_student_subjects (pending_student_id, subject_id, organization_id)
         VALUES ($1, $2, $3)`,
        [id, parseInt(subjectId), organizationId]
      );
    }

    // ✅ Replace guardians
    await client.query(`DELETE FROM pending_guardians WHERE pending_id = $1`, [
      id,
    ]);
    const guardianKeys = Object.keys(body).filter((k) =>
      k.startsWith("guardianFirstName")
    );
    for (let i = 0; i < guardianKeys.length; i++) {
      const fn = body[`guardianFirstName${i}`];
      if (!fn) continue;
      await client.query(
        `INSERT INTO pending_guardians 
         (pending_id, first_name, last_name, phone, email, hometown)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [
          id,
          fn,
          body[`guardianLastName${i}`],
          body[`guardianPhone${i}`],
          body[`guardianEmail${i}`],
          body[`guardianHometown${i}`],
        ]
      );
    }

    await client.query("COMMIT");
    return res.json({ success: true });
  } catch (err) {
    await client.query("ROLLBACK");
    // ...removed error log for clean background operation...
    return res.status(500).json({ error: "Failed to save changes." });
  } finally {
    client.release();
  }
};

// Middleware to check if user is authenticated
function isAuthenticated(req, res, next) {
  if (req.session.organizationId || req.session.userId) {
    return next();
  } else {
    res.redirect("/account/login");
  }
}

// Helper to extract guardians
function extractGuardians(body) {
  const guardians = [];
  const guardianKeys = Object.keys(body).filter((k) =>
    k.startsWith("guardianFirstName")
  );
  for (let i = 0; i < guardianKeys.length; i++) {
    const firstName = body[`guardianFirstName${i}`];
    if (firstName) {
      guardians.push({
        firstName,
        lastName: body[`guardianLastName${i}`],
        phone: body[`guardianPhone${i}`],
        email: body[`guardianEmail${i}`],
        hometown: body[`guardianHometown${i}`],
      });
    }
  }
  return guardians;
}

// Ensure this function is defined to fetch class names
async function getClassEmployeesWithMain(db, classId) {
  const employeesQuery = `
        SELECT u.user_id, u.first_name || ' ' || u.last_name as name, uc.main
        FROM users u
        JOIN user_classes uc ON u.user_id = uc.user_id
        WHERE uc.class_id = $1;
    `;
  const result = await db.query(employeesQuery, [classId]);
  return result.rows;
}

async function fetchStudentsByClass(db, classId) {
  try {
    const studentsResult = await db.query(
      `
            SELECT student_id, first_name, last_name
            FROM students
            WHERE class_id = $1
            ORDER BY first_name, last_name
        `,
      [classId]
    );
    return studentsResult.rows;
  } catch (error) {
    // ...removed error log for clean background operation...
    throw error;
  }
}

// Function to update or insert category_scores
async function updateCategoryScores(
  student_id,
  class_id,
  subject_id,
  category,
  total_score,
  organization_id,
  db
) {
  // Insert or update category score in a single query
  await db.query(
    `INSERT INTO category_scores (student_id, class_id, subject_id, category, total_score, organization_id)
         VALUES ($1, $2, $3, $4, $5, $6)
         ON CONFLICT (student_id, class_id, subject_id, category, organization_id)
         DO UPDATE SET total_score = EXCLUDED.total_score`,
    [student_id, class_id, subject_id, category, total_score, organization_id]
  );
}

function generateLastFiveDates() {
  const dates = [];
  const today = new Date();
  for (let i = 0; i < 5; i++) {
    const date = new Date();
    date.setDate(today.getDate() - i);
    dates.push(date.toISOString().split("T")[0]);
  }
  return dates.reverse();
}

function generateAllDatesFromStart(termStartDate) {
  const dates = [];
  const currentDate = new Date(termStartDate);
  const today = new Date();
  today.setHours(0, 0, 0, 0); // Set to midnight to avoid any time discrepancies

  while (currentDate <= today) {
    dates.push(currentDate.toISOString().split("T")[0]);
    currentDate.setDate(currentDate.getDate() + 1);
  }
  return dates;
}
function calculateGrade(percentage) {
  if (percentage >= 90) return "A";
  if (percentage >= 80) return "B";
  if (percentage >= 70) return "C";
  if (percentage >= 60) return "D";
  return "F";
}

const commonController = {
  orgDashboard: async (req, res, db) => {
    // ...removed log for clean background operation...
    try {
      // Allow super admin org switch even if not an org user
      const organizationId = req.session.organizationId;
      const currentUserRole = req.session.userRole;
      const url = req.url;
      const isSuperAdminSwitch = req.session.superAdminOrgSwitch;

      // Fetch the current school year and term
      const schoolYearResult = await db.query(
        `
          SELECT sy.id as school_year_id, sy.year_label, t.term_id, t.term_name, t.start_date, t.end_date, t.current
          FROM school_years sy
          LEFT JOIN terms t ON sy.id = t.school_year_id
          WHERE sy.organization_id = $1 AND sy.current = TRUE
          ORDER BY t.start_date
        `,
        [organizationId]
      );

      let schoolYear = null;
      let currentTerm = null;

      if (schoolYearResult.rows.length > 0) {
        schoolYear = {
          id: schoolYearResult.rows[0].school_year_id,
          year_label: schoolYearResult.rows[0].year_label,
          terms: schoolYearResult.rows.map((row) => ({
            term_id: row.term_id,
            term_name: row.term_name,
            start_date: row.start_date,
            end_date: row.end_date,
            current: row.current,
          })),
        };
        currentTerm = schoolYearResult.rows.find((row) => row.current);
      }

      if (schoolYear && currentTerm) {
        return res.redirect(
          `/common/orgDashboard/schoolYearId/${schoolYear.id}/termId/${currentTerm.term_id}`
        );
      }

      // Fetch both global and org-specific admin announcements
      const adminAnnouncementResult = await db.query(
        `
          SELECT * FROM admin_announcements
          WHERE is_active = true
            AND (organization_id IS NULL OR organization_id = $1)
            AND (expiry_date IS NULL OR expiry_date > NOW())
          ORDER BY id DESC
        `,
        [organizationId]
      );

      // If super admin org switch, skip org user checks
      let userSession = null;
      let currentUserId = null;
      let isOrgAccount = false;
      if (isSuperAdminSwitch) {
        // For super admin org switch, use userId from session and treat as user, not org
        currentUserId = req.session.userId || req.session.user_id || null;
        isOrgAccount = false;
      } else {
        userSession = req.session.user || req.session.orgUser;
        currentUserId = userSession
          ? userSession.user_id || userSession.organization_id
          : null;
        isOrgAccount = !!req.session.orgUser;
      }

      const adminAnnouncements = [];
      for (const announcement of adminAnnouncementResult.rows) {
        let viewResult;
        if (isOrgAccount) {
          viewResult = await db.query(
            `SELECT * FROM announcement_views WHERE organization_id = $1 AND announcement_id = $2`,
            [currentUserId, announcement.id]
          );
        } else {
          viewResult = await db.query(
            `SELECT * FROM announcement_views WHERE user_id = $1 AND announcement_id = $2`,
            [currentUserId, announcement.id]
          );
        }

        const shouldShow =
          viewResult.rows.length === 0 ||
          new Date() - new Date(viewResult.rows[0].last_viewed) >
            2 * 24 * 60 * 60 * 1000; // 2 days in milliseconds

        if (shouldShow) {
          adminAnnouncements.push(announcement);
          if (viewResult.rows.length === 0) {
            // For super admin org switch, use the admin's userId for announcement_views
            let insertUserId = currentUserId;
            if (isSuperAdminSwitch) {
              insertUserId = req.session.userId;
              if (!insertUserId) {
                // ...removed warn for clean background operation...
                // Do not attempt insert for super admin if no userId
                // ...removed orphaned continue statement after log cleanup...
              }
            }
            if (insertUserId) {
              await db.query(
                `INSERT INTO announcement_views (user_id, announcement_id) VALUES ($1, $2)`,
                [insertUserId, announcement.id]
              );
            }
          } else {
            await db.query(
              `UPDATE announcement_views SET last_viewed = CURRENT_TIMESTAMP WHERE view_id = $1`,
              [viewResult.rows[0].view_id]
            );
          }
        }
      }

      let orgHeaderName = null;
      let orgHeaderLogo = null;
      let orgHeaderNickname = null;
      if (req.session.superAdminOrgSwitch) {
        const orgResult = await db.query(
          "SELECT organization_name, logo, nickname FROM organizations WHERE organization_id = $1",
          [organizationId]
        );
        if (orgResult.rows.length > 0) {
          orgHeaderName = orgResult.rows[0].organization_name;
          orgHeaderLogo = orgResult.rows[0].logo;
          orgHeaderNickname = orgResult.rows[0].nickname;
        }
      }
      res.render("common/orgDashboard", {
        title: "Organization Dashboard",
        url,
        schoolYear,
        currentTerm,
        classes: [], // No classes found for this scenario
        events: currentUserRole !== "teacher" ? null : [],
        announcements:
          currentUserRole !== "manager" && currentUserRole !== "supervisor"
            ? null
            : [],
        organizationId,
        messages: req.flash(),
        adminAnnouncements,
        showOrgHeader: req.session.superAdminOrgSwitch || false,
        orgHeaderName,
        orgHeaderLogo,
        orgHeaderNickname,
      });
      // ...removed log for clean background operation...
    } catch (error) {
      // ...removed error log for clean background operation...
      req.flash(
        "error",
        "Failed to load dashboard data. Please refresh or contact support if needed."
      );
      res.redirect("/");
    }
  },

  orgDashboardRestricted: async (req, res, db) => {
    // ...removed log for clean background operation...
    try {
      const isSuperAdminSwitch = req.session.superAdminOrgSwitch;
      const isProduction = process.env.NODE_ENV === "production";
      const school = isProduction ? req.schoolDetails : null;
      const organizationId = isProduction
        ? school?.organization_id
        : req.session.organizationId;

      if (!organizationId) {
        req.flash("error", "School not found.");
        return res.redirect("/");
      }

      const url = req.url;
      const { schoolYearId, termId } = req.params;
      const currentUserRole = req.session.userRole;
      const userSession = req.session.user || req.session.orgUser;
      const currentUserId = userSession
        ? userSession.user_id || userSession.organization_id
        : null;
      const isOrgAccount = !!req.session.orgUser;

      // Fetch current school year and term
      const schoolYearResult = await db.query(
        `
          SELECT sy.id as school_year_id, sy.year_label, t.term_id, t.term_name, t.start_date, t.end_date, t.current
          FROM school_years sy
          LEFT JOIN terms t ON sy.id = t.school_year_id
          WHERE sy.id = $1 AND t.term_id = $2 AND sy.organization_id = $3
        `,
        [schoolYearId, termId, organizationId]
      );

      let schoolYear = null;
      let currentTerm = null;

      if (schoolYearResult.rows.length > 0) {
        schoolYear = {
          id: schoolYearResult.rows[0].school_year_id,
          year_label: schoolYearResult.rows[0].year_label,
          terms: schoolYearResult.rows.map((row) => ({
            term_id: row.term_id,
            term_name: row.term_name,
            start_date: row.start_date,
            end_date: row.end_date,
            current: row.current,
          })),
        };
        currentTerm = schoolYearResult.rows.find(
          (row) => row.term_id == termId
        );
      }

      if (!schoolYear || !currentTerm) {
        req.flash("error", "Invalid school year or term.");
        return res.redirect("/common/orgDashboard");
      }

      let classes = [];

      req.session.currentTermId = currentTerm.term_id;
      // ...removed log for clean background operation...
      // ...removed log for clean background operation...

      if (!currentUserId) {
        // ...removed error log for clean background operation...
      }

      if (currentUserRole === "Teacher") {
        const teacherClassesResult = await db.query(
          `
            SELECT uc.class_id, c.class_name,
                json_agg(
                    json_build_object(
                        'user_id', u.user_id,
                        'name', u.first_name || ' ' || u.last_name,
                        'main', uc.main,
                        'on_hold', u.on_hold,
                        'reset_password_token', u.reset_password_token
                    ) ORDER BY u.user_id
                ) AS employees
            FROM user_classes uc
            INNER JOIN classes c ON uc.class_id = c.class_id
            INNER JOIN users u ON u.user_id = uc.user_id
            WHERE uc.class_id IN (
                SELECT class_id FROM user_classes WHERE user_id = $1
            )
            AND u.organization_id = $2
            GROUP BY uc.class_id, c.class_name
          `,
          [currentUserId, organizationId]
        );

        const assignedClasses = teacherClassesResult.rows;
        const enrolledClassesResult = await db.query(
          `
                SELECT ec.class_id
                FROM enrolled_classes ec
                INNER JOIN enrollments e ON ec.enrollment_id = e.enrollment_id
                WHERE e.term_id = $1 AND e.school_year_id = $2 AND e.organization_id = $3
                `,
          [termId, schoolYearId, organizationId]
        );

        let enrolledClassIds = enrolledClassesResult.rows.map(
          (row) => row.class_id
        );

        // Match assigned classes with enrolled classes
        classes = assignedClasses.filter((cls) =>
          enrolledClassIds.includes(cls.class_id)
        );
      } else {
        // Fetch all enrolled classes for other rolese
        const enrolledClassesResult = await db.query(
          `
                    SELECT c.class_id, c.class_name,
                    json_agg(
                        json_build_object(
                            'user_id', u.user_id,
                            'name', u.first_name || ' ' || u.last_name,
                            'main', uc.main,
                            'on_hold', u.on_hold,
                            'reset_password_token', u.reset_password_token
                        ) ORDER BY u.user_id
                    ) AS employees
                FROM enrolled_classes ec
                INNER JOIN classes c ON ec.class_id = c.class_id
                LEFT JOIN user_classes uc ON c.class_id = uc.class_id
                LEFT JOIN users u ON u.user_id = uc.user_id
                WHERE ec.enrollment_id = (
                    SELECT enrollment_id FROM enrollments 
                    WHERE term_id = $1 AND school_year_id = $2 AND organization_id = $3
                    LIMIT 1
                )
                GROUP BY c.class_id

                `,
          [termId, schoolYearId, organizationId]
        );
        classes = enrolledClassesResult.rows;
      }

      // Events and announcements
      const eventsResult = await db.query(
        `
          SELECT * FROM school_events 
          WHERE organization_id = $1 
          AND (visibility = 'org' OR visibility = 'both') 
          AND term_id = $2
          ORDER BY event_date DESC
        `,
        [organizationId, currentTerm.term_id]
      );
      const events = eventsResult.rows.filter(
        (event) => event.school_year_id == schoolYearId
      );

      const announcementsResult = await db.query(
        `
          SELECT * FROM announcements 
          WHERE organization_id = $1 
          AND (visibility = 'org' OR visibility = 'both') 
          AND term_id = $2
          ORDER BY announcement_id DESC
        `,
        [organizationId, currentTerm.term_id]
      );
      const announcements = announcementsResult.rows.filter(
        (a) => a.school_year_id == schoolYearId
      );

      // ✅ Fetch BOTH global and org-specific admin announcements
      const adminAnnouncementResult = await db.query(
        `
          SELECT * FROM admin_announcements
          WHERE is_active = true AND (
            organization_id IS NULL OR organization_id = $1
          ) AND (expiry_date IS NULL OR expiry_date > NOW())
          ORDER BY id DESC
        `,
        [organizationId]
      );

      const adminAnnouncements = [];
      for (const announcement of adminAnnouncementResult.rows) {
        let viewResult;
        if (isOrgAccount) {
          viewResult = await db.query(
            `SELECT * FROM announcement_views WHERE organization_id = $1 AND announcement_id = $2`,
            [currentUserId, announcement.id]
          );
        } else {
          viewResult = await db.query(
            `SELECT * FROM announcement_views WHERE user_id = $1 AND announcement_id = $2`,
            [currentUserId, announcement.id]
          );
        }

        const shouldShow =
          viewResult.rows.length === 0 ||
          new Date() - new Date(viewResult.rows[0].last_viewed) >
            28 * 60 * 60 * 1000;

        if (shouldShow) {
          adminAnnouncements.push(announcement);
          if (viewResult.rows.length === 0) {
            // For super admin org switch, skip insert if no valid userId
            let insertUserId = currentUserId;
            if (isSuperAdminSwitch) {
              insertUserId = req.session.userId;
              if (!insertUserId) {
                // Do not attempt insert for super admin if no userId
                continue;
              }
            }
            if (insertUserId) {
              await db.query(
                `INSERT INTO announcement_views (${
                  isOrgAccount ? "organization_id" : "user_id"
                }, announcement_id) VALUES ($1, $2)`,
                [insertUserId, announcement.id]
              );
            }
          } else {
            await db.query(
              `UPDATE announcement_views SET last_viewed = CURRENT_TIMESTAMP WHERE view_id = $1`,
              [viewResult.rows[0].view_id]
            );
          }
        }
      }

      let orgHeaderName = null;
      let orgHeaderLogo = null;
      let orgHeaderNickname = null;
      if (req.session.superAdminOrgSwitch) {
        const orgResult = await db.query(
          "SELECT organization_name, logo, nickname FROM organizations WHERE organization_id = $1",
          [organizationId]
        );
        if (orgResult.rows.length > 0) {
          orgHeaderName = orgResult.rows[0].organization_name;
          orgHeaderLogo = orgResult.rows[0].logo;
          orgHeaderNickname = orgResult.rows[0].nickname;
        }
      }
      res.render("common/orgDashboard", {
        title: "Organization Dashboard",
        url,
        schoolYear,
        currentTerm,
        classes,
        events,
        announcements,
        organizationId,
        messages: req.flash(), // ✅ pass flash messages to the view
        adminAnnouncements, // ✅ admin announcements to display
        showOrgHeader: req.session.superAdminOrgSwitch || false,
        orgHeaderName,
        orgHeaderLogo,
        orgHeaderNickname,
        // Include any additional data as needed
      });
    } catch (error) {
      // ...removed error log for clean background operation...
      req.flash(
        "error",
        "Failed to load dashboard data. Please try again or contact support if this issue persists."
      ); // ✅ more user-friendly flash
      res.redirect("/"); // ✅ redirect to home if error
    }
  },

  publicDashboardContent: async (req, res, db) => {
    try {
      // Check if the user is logged in by checking the session
      const organizationId = req.query.organizationId || req.organizationId;
      const url = req.url;

      if (!organizationId) {
        throw new Error("Invalid organization ID.");
      }

      // Fetch the saved order of the items
      const orderResult = await db.query(
        "SELECT order_data FROM organization_dashboard WHERE organization_id = $1",
        [organizationId]
      );

      const orgDetailsResult = await db.query(
        `SELECT 
          organization_id, 
          logo, 
          aboutus, 
          motto, 
          organization_name,
          public_registration_enabled,
          registration_start_date,
          registration_end_date
        FROM organizations 
        WHERE organization_id = $1`,
        [organizationId]
      );

      const orgDetails = orgDetailsResult.rows[0];

      // order_data supports both legacy array format and object format:
      // - legacy: ["image-gallery", "text-articles", ...]
      // - new: { order: [...], theme: "classic"|"modern"|"minimal"|"bold" }
      let savedOrder = [];
      let publicDashboardTheme = "classic";
      let publicDashboardLayout = "wireframe1";
      if (orderResult.rows.length > 0) {
        try {
          let rawData = orderResult.rows[0].order_data;
          if (typeof rawData === "string") {
            rawData = JSON.parse(rawData);
          }

          if (Array.isArray(rawData)) {
            savedOrder = rawData;
          } else if (rawData && typeof rawData === "object") {
            if (Array.isArray(rawData.order)) {
              savedOrder = rawData.order;
            }
            if (typeof rawData.theme === "string" && rawData.theme.trim()) {
              publicDashboardTheme = rawData.theme.trim();
            }
            if (typeof rawData.layout === "string" && rawData.layout.trim()) {
              publicDashboardLayout = rawData.layout.trim();
            }
          }
        } catch (parseError) {
          savedOrder = [];
          publicDashboardTheme = "classic";
          publicDashboardLayout = "wireframe1";
        }
      }

      // Fetch images for the organization
      const imagesResult = await db.query(
        "SELECT * FROM organization_images WHERE organization_id = $1 ORDER BY image_id",
        [organizationId]
      );
      const images = imagesResult.rows;

      // Separate images for the slideshow vs. normal images
      const slideshowImages = images.filter(
        (img) => img.allocation.toLowerCase() === "slideshow"
      );

      const normalImages = images.filter(
        (img) => img.allocation.toLowerCase() !== "slideshow"
      );

      // Fetch texts for the organization
      const textsResult = await db.query(
        "SELECT * FROM organization_texts WHERE organization_id = $1 ORDER BY text_id",
        [organizationId]
      );
      const texts = textsResult.rows;

      // Fetch events visible to the public
      const eventsResult = await db.query(
        "SELECT * FROM school_events WHERE organization_id = $1 AND (visibility = 'public' OR visibility = 'both') ORDER BY event_date DESC",
        [organizationId]
      );
      const events = eventsResult.rows;

      // Fetch announcements visible to the public
      const announcementsResult = await db.query(
        "SELECT * FROM announcements WHERE organization_id = $1 AND (visibility = 'public' OR visibility = 'both') ORDER BY announcement_id DESC",
        [organizationId]
      );
      const announcements = announcementsResult.rows;

      // Build the "items" array for all other content
      let items = [];

      // ✅ Wrap all normal images under "image-gallery"
      items.push({
        type: "image-gallery",
        data: normalImages, // All images grouped together
        id: "image-gallery",
      });

      // ✅ Wrap all text articles under "text-articles"
      items.push({
        type: "text-articles",
        data: texts, // All texts grouped together
        id: "text-articles",
      });

      // Add events and announcements
      items.push({ type: "events", data: events, id: "events" });
      items.push({
        type: "announcements",
        data: announcements,
        id: "announcements",
      });

      // Sort items according to saved order or keep original order if there's no saved order
      const orderedItems =
        savedOrder.length > 0
          ? savedOrder
              .map((orderId) => items.find((item) => item.id === orderId))
              .filter(Boolean)
          : items;

      // Render the public dashboard page
      res.render("common/publicDashboard", {
        title: "Public Dashboard",
        slideshowImages, // Pass slideshow images separately
        orderedItems,
        orgDetails,
        publicDashboardTheme,
        publicDashboardLayout,
        url,
        isLoggedIn: req.session && req.session.userId,
        accountType: req.session.accountType || null, // ✅ Pass accountType explicitly
        messages: req.flash(),
      });
    } catch (error) {
      // ...removed error log for clean background operation...
      req.flash("error", "Failed to load public dashboard data.");
      res.status(500).send("Failed to load public dashboard data.");
    }
  },

  saveOrder: async (req, res, db) => {
    try {
      const organizationId =
        req.session?.organizationId || req.query?.organizationId || req.organizationId;

      if (!organizationId) {
        return res.status(400).json({ success: false, error: "Missing organizationId" });
      }

      const order = req.body?.order;
      if (!Array.isArray(order) || order.some((x) => typeof x !== "string")) {
        return res
          .status(400)
          .json({ success: false, error: "Invalid order payload" });
      }

      const existing = await db.query(
        "SELECT order_data FROM organization_dashboard WHERE organization_id = $1",
        [organizationId]
      );

      let theme = "classic";
      if (existing.rows.length > 0) {
        let raw = existing.rows[0].order_data;
        try {
          if (typeof raw === "string") raw = JSON.parse(raw);
          if (raw && typeof raw === "object" && !Array.isArray(raw)) {
            if (typeof raw.theme === "string" && raw.theme.trim()) {
              theme = raw.theme.trim();
            }
          }
        } catch (e) {
          theme = "classic";
        }
      }

      const payload = { order, theme };

      await db.query(
        `INSERT INTO organization_dashboard (organization_id, order_data)
         VALUES ($1, $2)
         ON CONFLICT (organization_id)
         DO UPDATE SET order_data = EXCLUDED.order_data`,
        [organizationId, payload]
      );

      return res.json({ success: true });
    } catch (error) {
      console.error("Error saving dashboard order:", error);
      return res.status(500).json({ success: false });
    }
  },

  addStudentGet: async (req, res, db) => {
    try {
      const organizationId = req.session.organizationId;

      // Fetch classes
      const classQuery = `
            SELECT c.class_id, c.class_name
            FROM classes c
            WHERE c.organization_id = $1
            ORDER BY c.class_name ASC;
        `;
      const classResult = await db.query(classQuery, [organizationId]);

      // Fetch graduation year groups
      const graduationYearGroupQuery = `
            SELECT id, name
            FROM graduation_year_groups
            WHERE organization_id = $1
            ORDER BY name ASC;
        `;
      const graduationYearGroupResult = await db.query(
        graduationYearGroupQuery,
        [organizationId]
      );

      // Fetch subjects
      const subjectQuery = `
            SELECT s.subject_id, s.subject_name
            FROM subjects s
            WHERE s.organization_id = $1
            ORDER BY s.subject_name ASC;
        `;
      const subjectResult = await db.query(subjectQuery, [organizationId]);

      // Fetch school years and their terms
      const schoolYearResults = await db.query(
        `
            SELECT id AS school_year_id, year_label
            FROM school_years
            WHERE organization_id = $1
            ORDER BY created_at DESC
        `,
        [organizationId]
      );
      const schoolYears = schoolYearResults.rows;

      const termResults = await db.query(
        `
            SELECT term_id, school_year_id, term_name
            FROM terms
            WHERE organization_id = $1
            ORDER BY start_date
        `,
        [organizationId]
      );
      const terms = termResults.rows;

      schoolYears.forEach((year) => {
        year.terms = terms.filter(
          (term) => term.school_year_id === year.school_year_id
        );
      });

      // Fetch the current school year and term
      const currentTermResult = await db.query(
        `
            SELECT t.term_id, t.term_name, sy.year_label
            FROM terms t
            JOIN school_years sy ON t.school_year_id = sy.id
            WHERE t.current = true AND sy.organization_id = $1
            LIMIT 1
        `,
        [organizationId]
      );
      const currentTerm = currentTermResult.rows[0];

      res.render("common/addStudent", {
        title: "Add New Student",
        classes: classResult.rows,
        graduationYearGroups: graduationYearGroupResult.rows,
        subjects: subjectResult.rows,
        schoolYears,
        currentTerm,
        messages: req.flash(),
        organizationId: req.session.organizationId,
      });
    } catch (err) {
      // ...removed error log for clean background operation...
      res.status(500).send("Error fetching data for add student");
    }
  },

  addStudentPost: async (req, res, db) => {
    const organizationId = req.session.organizationId;
    const createdBy = req.session.userId || null;
    const body = req.body;

    const indexes = [];

    // Detect whether this is single or multiple students
    const isMultiple = Object.keys(body).some((key) => key.match(/_\d+$/));

    if (isMultiple) {
      Object.keys(body).forEach((key) => {
        const match = key.match(/_(\d+)$/);
        if (match && !indexes.includes(match[1])) indexes.push(match[1]);
      });
    } else {
      indexes.push("single");
    }

    const client = await db.connect();

    try {
      await client.query("BEGIN");

      for (const index of indexes) {
        const prefix = index === "single" ? "" : `_${index}`;

        const student = {
          firstName: body[`firstName${prefix}`],
          lastName: body[`lastName${prefix}`],
          dateOfBirth: body[`dateOfBirth${prefix}`],
          height: body[`height${prefix}`],
          hometown: body[`hometown${prefix}`],
          classId: body[`classId${prefix}`],
          graduationYearGroupId: body[`graduationYearGroupId${prefix}`],
          gender: body[`gender${prefix}`],
          enrollmentType: body[`enrollmentType${prefix}`],
          schoolYearId: body[`schoolYearId${prefix}`],
          termId: body[`termId${prefix}`],
          subjects: body[`subjects_${index}`] || [],
          guardians: [],
        };

        // Collect guardians
        const guardianKeys = Object.keys(body).filter((k) =>
          k.startsWith(`guardianFirstName${prefix === "" ? "_" : prefix}_`)
        );
        for (const gk of guardianKeys) {
          const gIdx = gk.split("_")[2];
          student.guardians.push({
            profileId: body[`guardianProfileId${prefix}_${gIdx}`],
            firstName: body[`guardianFirstName${prefix}_${gIdx}`],
            lastName: body[`guardianLastName${prefix}_${gIdx}`],
            address: body[`guardianAddress${prefix}_${gIdx}`],
            phone: body[`guardianPhone${prefix}_${gIdx}`],
            email: body[`guardianEmail${prefix}_${gIdx}`],
            hometown: body[`guardianHometown${prefix}_${gIdx}`],
            portalPassword: body[`guardianPortalPassword${prefix}_${gIdx}`],
          });
        }

        // Insert student
        const imageFile = req.files.find(
          (f) => f.fieldname === `studentImage${prefix}`
        );
        let imageUrl = "profilePlaceholder.png";
        if (imageFile) {
          const s3Key = `images/studentimages/${organizationId}/${imageFile.originalname}`;
          imageUrl = await uploadToS3(imageFile, s3Key);
        }

        // Use imageUrl as usual in your INSERT query:
        const studentInsert = await client.query(
          `INSERT INTO students 
          (first_name, last_name, date_of_birth, height, hometown, class_id, image_url, graduation_year_group_id, gender, created_by, organization_id)
          VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
          RETURNING student_id`,
          [
            student.firstName,
            student.lastName,
            student.dateOfBirth,
            student.height,
            student.hometown,
            student.classId,
            imageUrl, // ✅ Use uploaded image if present
            student.graduationYearGroupId,
            student.gender,
            createdBy,
            organizationId,
          ]
        );

        if (!studentInsert.rows.length)
          throw new Error("Student insert failed.");
        const studentId = studentInsert.rows[0].student_id;

        // Insert guardians (NEW MASTER + LINK) + ALSO keep existing guardians table insert (compat)
        for (let i = 0; i < student.guardians.length; i++) {
          const g = student.guardians[i];
          if (!g.firstName && !g.profileId) continue;

          // 1) Upload guardian photo if provided
          const guardianImageFile = req.files.find(
            (f) => f.fieldname === `guardianImage${prefix}_${i}`
          );

          let guardianImageUrl = null;
          if (guardianImageFile) {
            const s3Key = `images/guardianimages/${organizationId}/${Date.now()}_${guardianImageFile.originalname}`;
            guardianImageUrl = await uploadToS3(guardianImageFile, s3Key);
          }

          // 2) Upsert/Select guardian_profile
          let guardianId = null;

          if (g.profileId) {
            guardianId = parseInt(g.profileId, 10);

            // Optional: update profile details + image if new image uploaded
            await client.query(
              `
              UPDATE guardian_profiles
              SET first_name = COALESCE(NULLIF($1,''), first_name),
                  last_name  = COALESCE(NULLIF($2,''), last_name),
                  phone      = COALESCE(NULLIF($3,''), phone),
                  email      = COALESCE(NULLIF($4,''), email),
                  address    = COALESCE(NULLIF($5,''), address),
                  hometown   = COALESCE(NULLIF($6,''), hometown),
                  image_url  = COALESCE($7, image_url),
                  updated_at = NOW()
              WHERE guardian_id = $8 AND organization_id = $9
              `,
              [
                g.firstName, g.lastName, g.phone, g.email, g.address, g.hometown,
                guardianImageUrl,
                guardianId, organizationId
              ]
            );
          } else {
            const inserted = await client.query(
              `
              INSERT INTO guardian_profiles
                (organization_id, first_name, last_name, phone, email, address, hometown, image_url)
              VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
              RETURNING guardian_id
              `,
              [
                organizationId,
                g.firstName,
                g.lastName,
                g.phone,
                (g.email || "").toLowerCase() || null,
                g.address,
                g.hometown,
                guardianImageUrl
              ]
            );
            guardianId = inserted.rows[0].guardian_id;
          }

          // 3) Link guardian -> student
          const linkResult = await client.query(
            `
            INSERT INTO guardian_students (guardian_id, student_id)
            VALUES ($1, $2)
            ON CONFLICT (guardian_id, student_id) DO NOTHING
            RETURNING *
            `,
            [guardianId, studentId]
          );

          const isNewLink = linkResult.rowCount > 0;

          // 4) Create/Update guardian login (if password provided AND (email or phone exists))
          const passwordPlain = (g.portalPassword || "").trim();
          const loginEmail = (g.email || "").trim().toLowerCase() || null;
          const loginPhone = (g.phone || "").trim() || null;

          let isNewAccount = false;
          let accountExists = false;

          // Check if account already exists
          if (loginEmail || loginPhone) {
            const existingAccount = await client.query(
              `SELECT id FROM guardian_accounts WHERE guardian_id = $1`,
              [guardianId]
            );
            accountExists = existingAccount.rows.length > 0;
          }

          if (passwordPlain && (loginEmail || loginPhone)) {
            const hash = await bcrypt.hash(passwordPlain, 10);

            // Prefer email uniqueness; fallback to phone uniqueness
            if (loginEmail) {
              const result = await client.query(
                `
                INSERT INTO guardian_accounts
                  (organization_id, guardian_id, login_email, login_phone, password_hash, must_reset_password)
                VALUES ($1,$2,$3,$4,$5,false)
                ON CONFLICT (organization_id, LOWER(login_email))
                DO UPDATE SET
                  guardian_id = EXCLUDED.guardian_id,
                  login_phone = EXCLUDED.login_phone,
                  password_hash = EXCLUDED.password_hash,
                  must_reset_password = false,
                  updated_at = NOW()
                RETURNING (xmax = 0) AS inserted
                `,
                [organizationId, guardianId, loginEmail, loginPhone, hash]
              );
              isNewAccount = result.rows[0]?.inserted || false;
            } else {
              const result = await client.query(
                `
                INSERT INTO guardian_accounts
                  (organization_id, guardian_id, login_phone, password_hash, must_reset_password)
                VALUES ($1,$2,$3,$4,false)
                ON CONFLICT (organization_id, login_phone)
                DO UPDATE SET
                  guardian_id = EXCLUDED.guardian_id,
                  password_hash = EXCLUDED.password_hash,
                  must_reset_password = false,
                  updated_at = NOW()
                RETURNING (xmax = 0) AS inserted
                `,
                [organizationId, guardianId, loginPhone, hash]
              );
              isNewAccount = result.rows[0]?.inserted || false;
            }
          }

          // 5) Send email notifications after transaction commits
          if (loginEmail) {
            // Get organization name and student name for email
            const orgResult = await client.query(
              `SELECT organization_name FROM organizations WHERE organization_id = $1`,
              [organizationId]
            );
            const organizationName = orgResult.rows[0]?.organization_name || 'School';
            const studentName = `${student.firstName} ${student.lastName}`;

            // Send welcome email if this is a new account (first student)
            if (!g.profileId && !accountExists && loginEmail) {
              // New guardian - send welcome email with password setup
              setImmediate(() => {
                sendGuardianWelcomeEmail(
                  loginEmail,
                  g.firstName,
                  g.lastName,
                  studentName,
                  organizationName,
                  organizationId,
                  guardianId
                ).catch(err => console.error('Email sending error:', err));
              });
            } else if (g.profileId && isNewLink && loginEmail) {
              // Existing guardian - send student added notification
              setImmediate(() => {
                sendGuardianStudentAddedEmail(
                  loginEmail,
                  g.firstName,
                  g.lastName,
                  studentName,
                  organizationName
                ).catch(err => console.error('Email sending error:', err));
              });
            }
          }

          // 6) KEEP your old guardians insert so existing pages don't break
          if (g.firstName) {
            await client.query(
              `INSERT INTO guardians (first_name, last_name, address, phone, email, hometown, image_url, student_id, organization_id)
               VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
              [
                g.firstName,
                g.lastName,
                g.address,
                g.phone,
                (g.email || "").toLowerCase() || null,
                g.hometown,
                guardianImageUrl,
                studentId,
                organizationId,
              ]
            );
          }
        }

        // Insert subjects
        const subjectsArray = Array.isArray(student.subjects)
          ? student.subjects
          : student.subjects
          ? [student.subjects]
          : [];

        for (const subjectId of subjectsArray) {
          if (subjectId) {
            await client.query(
              `INSERT INTO student_subjects (student_id, subject_id, organization_id)
               VALUES ($1, $2, $3)`,
              [studentId, subjectId, organizationId]
            );
          }
        }

        // Determine enrollment term & year
        let schoolYear = student.schoolYearId;
        let term = student.termId;

        if (student.enrollmentType === "current") {
          const current = await client.query(
            `SELECT term_id, school_year_id FROM terms WHERE organization_id = $1 AND current = true LIMIT 1`,
            [organizationId]
          );
          if (!current.rows.length) throw new Error("No current term found.");
          term = current.rows[0].term_id;
          schoolYear = current.rows[0].school_year_id;
        }

        if (!schoolYear || !term)
          throw new Error("Missing school year or term.");

        // Check or insert enrollment
        const existing = await client.query(
          `SELECT enrollment_id FROM enrollments WHERE school_year_id = $1 AND term_id = $2 AND organization_id = $3`,
          [schoolYear, term, organizationId]
        );

        let enrollmentId;
        if (existing.rows.length) {
          enrollmentId = existing.rows[0].enrollment_id;
        } else {
          const insertEnrollment = await client.query(
            `INSERT INTO enrollments (school_year_id, term_id, organization_id, created_at)
             VALUES ($1, $2, $3, NOW())
             RETURNING enrollment_id`,
            [schoolYear, term, organizationId]
          );
          enrollmentId = insertEnrollment.rows[0].enrollment_id;
        }

        // Enroll student
        await client.query(
          `INSERT INTO enrolled_students (enrollment_id, student_id, class_id)
           VALUES ($1, $2, $3)`,
          [enrollmentId, studentId, student.classId]
        );
      }

      await client.query("COMMIT");
      req.flash("success", "Student(s) saved successfully.");
      res.redirect("/common/addStudent");
    } catch (err) {
      await client.query("ROLLBACK");
      // ...removed error log for clean background operation...
      req.flash("error", "Failed to save student(s).");
      res.redirect("/common/addStudent");
    } finally {
      client.release();
    }
  },

  publicRegisterStudentGet: async (req, res, db) => {
    try {
      // ✅ Use organizationId from query, or fallback to schoolDetails for production
      const organizationId =
        req.query.organizationId ||
        (req.schoolDetails && req.schoolDetails.organization_id);

      if (!organizationId) {
        req.flash("error", "Missing organization ID.");
        return res.redirect("/common/publicDashboard");
      }

      const orgResult = await db.query(
        `SELECT organization_id, organization_name, registration_description,
              public_registration_enabled, registration_start_date,
              registration_end_date, public_registration_price,
              public_registration_currency, logo, aboutus, motto
        FROM organizations
        WHERE organization_id = $1`,
        [organizationId]
      );

      if (orgResult.rows.length === 0) {
        req.flash("error", "Organization not found.");
        return res.redirect("/common/publicDashboard");
      }

      const orgDetails = orgResult.rows[0];

      const classResult = await db.query(
        `SELECT class_id, class_name FROM classes WHERE organization_id = $1 ORDER BY class_name ASC`,
        [organizationId]
      );

      const graduationYearGroupResult = await db.query(
        `SELECT id, name FROM graduation_year_groups WHERE organization_id = $1 ORDER BY name ASC`,
        [organizationId]
      );

      const subjectResult = await db.query(
        `SELECT subject_id, subject_name FROM subjects WHERE organization_id = $1 ORDER BY subject_name ASC`,
        [organizationId]
      );

      const schoolYearResults = await db.query(
        `SELECT id AS school_year_id, year_label FROM school_years WHERE organization_id = $1 ORDER BY created_at DESC`,
        [organizationId]
      );
      const schoolYears = schoolYearResults.rows;

      const termResults = await db.query(
        `SELECT term_id, school_year_id, term_name, current FROM terms WHERE organization_id = $1 ORDER BY start_date`,
        [organizationId]
      );
      const terms = termResults.rows;

      schoolYears.forEach((year) => {
        year.terms = terms.filter(
          (term) => term.school_year_id === year.school_year_id
        );
      });

      const currentTerm = terms.find((term) => term.current) || null;

      const paystackSubaccountsResult = await db.query(
        `SELECT id, business_name, account_number, account_type, bank_code, subaccount_code FROM paystack_subaccounts WHERE organization_id = $1`,
        [organizationId]
      );
      const paystackSubaccounts = paystackSubaccountsResult.rows;

      res.render("common/publicRegisterStudent", {
        title: "Public Student Registration",
        classes: classResult.rows,
        graduationYearGroups: graduationYearGroupResult.rows,
        subjects: subjectResult.rows,
        schoolYears,
        currentTerm,
        organizationId,
        orgDetails,
        paystackSubaccounts,
        publishableKey: process.env.PAYSTACK_PUBLIC_KEY,
        messages: req.flash(),
      });
    } catch (err) {
      // ...removed error log for clean background operation...
      req.flash("error", "Failed to load registration page.");
      res.redirect("/common/publicDashboard");
    }
  },

  publicRegisterStudentPost: async (req, res, db) => {
    const { body } = req;
    const file = req.file;
    const organizationId =
      req.query.organizationId ||
      (req.schoolDetails && req.schoolDetails.organization_id);

    try {
      if (
        !body.firstName ||
        !body.lastName ||
        !body.dateOfBirth ||
        !body.gender ||
        !body.classId ||
        !body.paymentMethodId
      ) {
        return res
          .status(400)
          .json({ success: false, error: "Missing required fields." });
      }

      const orgResult = await db.query(
        `SELECT public_registration_price, public_registration_currency FROM organizations WHERE organization_id = $1`,
        [organizationId]
      );

      if (orgResult.rows.length === 0) {
        return res
          .status(400)
          .json({ success: false, error: "Organization not found." });
      }

      const {
        public_registration_price: amount,
        public_registration_currency: currency,
      } = orgResult.rows[0];

      // Upload image to S3 if provided
      let imageUrl = "profilePlaceholder.png";
      if (file) {
        const s3Key = `images/studentimages/${organizationId}/${file.originalname}`;
        imageUrl = await uploadToS3(file, s3Key);
      }

      // Insert pending student record right away
      const insertResult = await db.query(
        `INSERT INTO pending_students 
        (first_name, last_name, date_of_birth, gender, hometown, class_id, image_url, enrollment_type, school_year_id, term_id, graduation_year_group_id, organization_id, stripe_payment_verified, payment_pending, submitted_at)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, false, true, NOW())
        RETURNING pending_id`,
        [
          body.firstName,
          body.lastName,
          body.dateOfBirth,
          body.gender,
          body.hometown,
          body.classId,
          imageUrl,
          body.enrollmentType,
          body.schoolYearId,
          body.termId,
          body.graduationYearGroupId,
          organizationId,
        ]
      );

      const pendingStudentId = insertResult.rows[0].pending_id;

      // Save guardians
      const guardians = extractGuardians(body);
      for (const guardian of guardians) {
        await db.query(
          `INSERT INTO pending_guardians (pending_id, first_name, last_name, phone, email, hometown)
           VALUES ($1, $2, $3, $4, $5, $6)`,
          [
            pendingStudentId,
            guardian.firstName,
            guardian.lastName,
            guardian.phone,
            guardian.email,
            guardian.hometown,
          ]
        );
      }

      // Save subjects
      const subjects = Array.isArray(body.subjects)
        ? body.subjects
        : [body.subjects];
      for (const subjectId of subjects) {
        if (subjectId) {
          await db.query(
            `INSERT INTO pending_student_subjects (pending_student_id, subject_id, organization_id) VALUES ($1, $2, $3)`,
            [pendingStudentId, subjectId, organizationId]
          );
        }
      }

      // Save payment info (but mark it as pending)
      await db.query(
        `INSERT INTO pending_student_payments (pending_student_id, payment_method_id, organization_id)
         VALUES ($1, $2, $3)`,
        [pendingStudentId, body.paymentMethodId, organizationId]
      );

      // Save pending student ID in session
      req.session.pendingStudentId = pendingStudentId;

      // Send response for payment initiation
      res.json({ success: true, amount, currency, pendingStudentId });
    } catch (err) {
      // ...removed error log for clean background operation...
      res
        .status(500)
        .json({ success: false, error: "Failed to save pending student." });
    }
  },

  initializePayment: async (req, res, db) => {
    const { subaccountCode, amount } = req.body;

    // ✅ Determine the BASE_URL dynamically
    const BASE_URL =
      process.env.NODE_ENV === "production"
        ? process.env.BASE_URL_PRODUCTION || "https://managira.com"
        : process.env.BASE_URL_LOCAL || "http://localhost:4000";

    const pendingStudentId = req.session.pendingStudentId;

    if (!pendingStudentId) {
      return res
        .status(400)
        .json({ success: false, error: "Missing pending student ID." });
    }

    try {
      // ✅ Fetch organization ID with fallback
      const studentResult = await db.query(
        `SELECT organization_id, first_name, last_name FROM pending_students WHERE pending_id = $1`,
        [pendingStudentId]
      );

      if (studentResult.rows.length === 0) {
        return res
          .status(400)
          .json({ success: false, error: "Pending student not found." });
      }

      const {
        organization_id: organizationId,
        first_name,
        last_name,
      } = studentResult.rows[0];

      // ✅ Fetch currency
      const orgResult = await db.query(
        `SELECT public_registration_currency FROM organizations WHERE organization_id = $1`,
        [organizationId]
      );
      const currency = orgResult.rows[0]?.public_registration_currency || "GHS";

      // ✅ Fetch primary guardian email
      const guardianResult = await db.query(
        `SELECT email, first_name FROM pending_guardians WHERE pending_id = $1 LIMIT 1`,
        [pendingStudentId]
      );
      const primaryGuardian = guardianResult.rows[0];
      const guardianEmail = primaryGuardian?.email || "user@dummy.com";

      // ✅ Generate unique reference
      const paymentReference = `REG-${organizationId}-${pendingStudentId}-${Date.now()}`;

      // ✅ Convert amount to kobo/pesewas (multiply by 100)
      const amountInMinorUnit = Math.round(parseFloat(amount) * 100);

      // ✅ Set up Paystack payment payload
      const paymentPayload = {
        email: guardianEmail,
        amount: amountInMinorUnit,
        currency: currency,
        reference: paymentReference,
        callback_url: `${BASE_URL}/common/paymentCallback?pendingStudentId=${pendingStudentId}`,
        metadata: {
          pending_student_id: pendingStudentId,
          organization_id: organizationId,
          student_name: `${first_name} ${last_name}`,
          guardian_name: primaryGuardian?.first_name || "Guardian",
          custom_fields: [
            {
              display_name: "Student Registration",
              variable_name: "purpose",
              value: "Public Registration Fee",
            },
          ],
        },
        subaccount: subaccountCode,
        channels: ["card"], // Only allow card payments for now
      };

      // ✅ Initialize payment with Paystack
      const response = await axios.post(
        "https://api.paystack.co/transaction/initialize",
        paymentPayload,
        {
          headers: {
            Authorization: `Bearer ${process.env.PAYSTACK_SECRET_KEY}`,
            "Content-Type": "application/json",
          },
        }
      );

      if (response.data.status && response.data.data.authorization_url) {
        // ✅ Store payment details in our tracking table
        await db.query(
          `INSERT INTO public_registration_payments (
            organization_id, student_name, student_email, amount, currency, 
            paystack_reference, subaccount_code, status, metadata
          ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
          [
            organizationId,
            `${first_name} ${last_name}`,
            guardianEmail,
            parseFloat(amount),
            currency,
            paymentReference,
            subaccountCode,
            "pending",
            JSON.stringify(paymentPayload.metadata),
          ]
        );

        // ...removed log for clean background operation...

        res.json({
          success: true,
          payment_url: response.data.data.authorization_url,
          reference: paymentReference,
          access_code: response.data.data.access_code,
        });
      } else {
        throw new Error("Invalid response from Paystack");
      }
    } catch (error) {
      // ...removed error log for clean background operation...
      res.status(500).json({
        success: false,
        error: error.response?.data?.message || "Payment initialization failed",
      });
    }
  },

  paymentCallback: async (req, res, db) => {
    const transactionId = req.query.transaction_id;
    const pendingStudentId = req.query.pendingStudentId;

    if (!transactionId || !pendingStudentId) {
      req.flash("error", "Missing transaction or pending student.");
      return res.redirect("/common/publicDashboard");
    }

    try {
      // ✅ Verify payment with Flutterwave
      const result = await axios.get(
        `https://api.flutterwave.com/v3/transactions/${transactionId}/verify`,
        {
          headers: { Authorization: `Bearer ${process.env.FLW_SECRET_KEY}` },
        }
      );

      const paymentStatus = result.data.data.status;

      if (paymentStatus === "successful") {
        // ✅ Mark payment as verified
        await db.query(
          `UPDATE pending_students SET stripe_payment_verified = true, payment_pending = false WHERE pending_id = $1`,
          [pendingStudentId]
        );

        // ✅ Fetch guardian details
        const guardianResult = await db.query(
          `SELECT email, first_name FROM pending_guardians WHERE pending_id = $1 LIMIT 1`,
          [pendingStudentId]
        );
        const primaryGuardian = guardianResult.rows[0];

        // ✅ Fetch organization details
        const orgResult = await db.query(
          `SELECT organization_id, organization_name, nickname FROM organizations WHERE organization_id = (
            SELECT organization_id FROM pending_students WHERE pending_id = $1
          )`,
          [pendingStudentId]
        );
        const orgDetails = orgResult.rows[0];
        const orgName = orgDetails?.organization_name || "the school";
        const organizationId = orgDetails?.organization_id;

        // ✅ Send email if primary guardian email exists
        if (primaryGuardian && primaryGuardian.email) {
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
                  <div style="color:#6fd3c4;font-size:24px;font-weight:600;margin-bottom:16px;letter-spacing:1px;">Student Registration & Payment Confirmation</div>
                  <p style="font-size:16px;line-height:1.6;margin-bottom:18px;">Hello <b>${
                    primaryGuardian.first_name
                  }</b>,</p>
                  <p style="font-size:16px;line-height:1.6;margin-bottom:18px;">We are pleased to confirm that the student's registration and payment have been successfully processed for <b>${orgName}</b>.</p>
                  <p style="font-size:16px;line-height:1.6;margin-bottom:18px;">The admissions team at <b>${orgName}</b> has received the details. You may hear from them soon, or you can reach out directly if you have any questions.</p>
                  <p style="font-size:16px;line-height:1.6;margin-bottom:18px;">Thank you for choosing us!</p>
                  <p style="margin-top:18px;font-size:15px;">If you have any questions, please visit our <a href="https://www.managira.com/legal/help" target="_blank" rel="noopener" style="color:#1ca34a;font-weight:500;">Help Center</a> or <a href="https://www.managira.com/legal/faq" target="_blank" rel="noopener" style="color:#1ca34a;font-weight:500;">FAQ page</a>.</p>
                  <p style="color:#b80000;font-size:16px;font-weight:bold;margin-top:32px;text-align:center;letter-spacing:1px;">THIS IS A NO-REPLY MESSAGE. PLEASE DO NOT REPLY TO THIS EMAIL.</p>
                </div>
                <div style="background:#e6f7ec;color:#888;text-align:center;padding:18px 0;font-size:13px;">&copy; ${new Date().getFullYear()} Managira. All rights reserved.</div>
              </div>
            </div>
          `;
          const mailOptions = {
            from: process.env.NOTIFY_EMAIL_USER,
            to: primaryGuardian.email,
            subject: `Student Registration & Payment Confirmation - ${orgName}`,
            html,
            attachments: [
              {
                filename: "managira.png",
                path: require("path").join(
                  __dirname,
                  "../public/images/managira.png"
                ),
                cid: "managira_logo",
              },
            ],
          };
          try {
            await transporter.sendMail(mailOptions);
          } catch (error) {
            // ...removed error log for clean background operation...
          }
        }

        req.flash(
          "success",
          "Registration and payment completed successfully!"
        );
        req.session.pendingStudentId = null;

        // ✅ Build proper redirect URL for production (to subdomain) or fallback
        const redirectUrl =
          process.env.NODE_ENV === "production" && orgDetails?.nickname
            ? `https://${orgDetails.nickname}.managira.com/common/publicDashboard?success=1`
            : `/common/publicDashboard?organizationId=${organizationId}&success=1`;

        return res.redirect(redirectUrl);
      } else {
        // Payment failed — delete pending record
        await db.query(`DELETE FROM pending_students WHERE pending_id = $1`, [
          pendingStudentId,
        ]);
        req.flash("error", "Payment failed. Registration was not saved.");
        req.session.pendingStudentId = null;

        const fallbackRedirect =
          process.env.NODE_ENV === "production" && req.schoolDetails
            ? `https://${req.schoolDetails.nickname}.managira.com/common/publicDashboard`
            : `/common/publicDashboard?organizationId=${
                req.session.organizationId || ""
              }`;
        return res.redirect(fallbackRedirect);
      }
    } catch (err) {
      // ...removed error log for clean background operation...
      req.flash("error", "Error verifying payment. Please contact support.");

      const fallbackRedirect =
        process.env.NODE_ENV === "production" && req.schoolDetails
          ? `https://${req.schoolDetails.nickname}.managira.com/common/publicDashboard`
          : `/common/publicDashboard?organizationId=${
              req.session.organizationId || ""
            }`;
      return res.redirect(fallbackRedirect);
    }
  },

  getPendingStudentDetails: async (req, res, db) => {
    const { id } = req.params;
    const organizationId = req.session.organizationId;

    try {
      // Fetch the pending student
      const studentResult = await db.query(
        `
        SELECT ps.*, c.class_name, g.name AS graduation_group
        FROM pending_students ps
        LEFT JOIN classes c ON ps.class_id = c.class_id
        LEFT JOIN graduation_year_groups g ON ps.graduation_year_group_id = g.id
        WHERE ps.pending_id = $1 AND ps.organization_id = $2
      `,
        [id, organizationId]
      );

      if (!studentResult.rows.length) {
        return res.status(404).json({ error: "Student not found." });
      }

      const student = studentResult.rows[0];

      // Fetch selected subjects for the pending student
      const subjectsResult = await db.query(
        `
        SELECT s.subject_id, s.subject_name
        FROM pending_student_subjects pss
        JOIN subjects s ON s.subject_id = pss.subject_id
        WHERE pss.pending_student_id = $1
      `,
        [id]
      );

      // Fetch only subjects for this class
      const allSubjectsResult = await db.query(
        `
        SELECT subject_id, subject_name
        FROM subjects
        WHERE organization_id = $1 AND class_id = $2
        ORDER BY subject_name ASC
      `,
        [organizationId, student.class_id]
      );

      // Fetch guardians
      const guardiansResult = await db.query(
        `
        SELECT * FROM pending_guardians
        WHERE pending_id = $1
      `,
        [id]
      );

      // Fetch all classes
      const classResult = await db.query(
        `
        SELECT class_id, class_name
        FROM classes
        WHERE organization_id = $1
        ORDER BY class_name ASC
      `,
        [organizationId]
      );

      // Fetch all graduation year groups
      const gradGroupResult = await db.query(
        `
        SELECT id, name
        FROM graduation_year_groups
        WHERE organization_id = $1
        ORDER BY name ASC
      `,
        [organizationId]
      );

      // ✅ Fetch school years and terms
      const schoolYearResults = await db.query(
        `
        SELECT id AS school_year_id, year_label
        FROM school_years
        WHERE organization_id = $1
        ORDER BY created_at DESC
      `,
        [organizationId]
      );

      const termResults = await db.query(
        `
        SELECT term_id, school_year_id, term_name
        FROM terms
        WHERE organization_id = $1
        ORDER BY start_date ASC
      `,
        [organizationId]
      );

      const schoolYears = schoolYearResults.rows;
      const terms = termResults.rows;

      schoolYears.forEach((year) => {
        year.terms = terms.filter(
          (term) => term.school_year_id === year.school_year_id
        );
      });

      return res.json({
        student,
        subjects: subjectsResult.rows || [],
        allSubjects: allSubjectsResult.rows || [],
        guardians: guardiansResult.rows || [],
        classes: classResult.rows || [],
        graduationYearGroups: gradGroupResult.rows || [],
        schoolYears, // ✅ now passed to frontend
      });
    } catch (err) {
      // ...removed error log for clean background operation...
      return res.status(500).json({ error: "Error loading student details." });
    }
  },

  viewPendingAdmissions: async (req, res, db) => {
    try {
      const organizationId = req.session.organizationId;

      const result = await db.query(
        `
        SELECT ps.*, c.class_name, g.name AS graduation_group
        FROM pending_students ps
        LEFT JOIN classes c ON ps.class_id = c.class_id
        LEFT JOIN graduation_year_groups g ON ps.graduation_year_group_id = g.id
        WHERE ps.organization_id = $1
        ORDER BY ps.submitted_at DESC
      `,
        [organizationId]
      );

      res.render("common/admissionPending", {
        title: "Admission Pending",
        pendingStudents: result.rows,
        messages: req.flash(),
      });
    } catch (err) {
      // ...removed error log for clean background operation...
      res.status(500).send("Error loading data");
    }
  },

  approvePendingStudent: async (req, res, db) => {
    const { id } = req.params;
    const organizationId = req.session.organizationId;
    const client = await db.connect();

    try {
      await client.query("BEGIN");

      // ✅ Ensure recent changes are saved before approving
      req.file = undefined; // in case no new image was uploaded

      if (req.body && Object.keys(req.body).length > 0) {
        const saveResult = await commonController.savePendingStudentChanges(
          req,
          {
            json: () => {},
            status: () => ({ json: () => {} }),
          },
          db
        );

        if (saveResult?.error) {
          throw new Error("Failed to save student changes before approval.");
        }
      }

      // ✅ Now re-fetch the updated pending record
      const pending = await client.query(
        `SELECT * FROM pending_students WHERE pending_id = $1 AND organization_id = $2`,
        [id, organizationId]
      );
      if (!pending.rows.length) throw new Error("No such pending student.");

      const student = pending.rows[0];

      // ✅ Get org name for email
      const orgResult = await client.query(
        `SELECT organization_name FROM organizations WHERE organization_id = $1`,
        [organizationId]
      );
      const orgName = orgResult.rows[0]?.organization_name || "Our School";

      // ✅ Create student
      const inserted = await client.query(
        `INSERT INTO students (first_name, last_name, date_of_birth, gender, hometown, class_id, graduation_year_group_id, organization_id, image_url)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
         RETURNING student_id`,
        [
          student.first_name,
          student.last_name,
          student.date_of_birth,
          student.gender,
          student.hometown,
          student.class_id,
          student.graduation_year_group_id,
          organizationId,
          student.image_url,
        ]
      );

      const studentId = inserted.rows[0].student_id;

      // ✅ Enrollment
      let enrollmentId;
      const enrollmentCheck = await client.query(
        `SELECT enrollment_id FROM enrollments
         WHERE school_year_id = $1 AND term_id = $2 AND organization_id = $3`,
        [student.school_year_id, student.term_id, organizationId]
      );

      if (enrollmentCheck.rows.length) {
        enrollmentId = enrollmentCheck.rows[0].enrollment_id;
      } else {
        const created = await client.query(
          `INSERT INTO enrollments (school_year_id, term_id, organization_id, created_at)
           VALUES ($1, $2, $3, NOW()) RETURNING enrollment_id`,
          [student.school_year_id, student.term_id, organizationId]
        );
        enrollmentId = created.rows[0].enrollment_id;
      }

      await client.query(
        `INSERT INTO enrolled_students (enrollment_id, student_id, class_id)
         VALUES ($1, $2, $3)`,
        [enrollmentId, studentId, student.class_id]
      );

      // ✅ Subjects
      const subjects = await client.query(
        `SELECT subject_id FROM pending_student_subjects WHERE pending_student_id = $1`,
        [id]
      );

      for (const row of subjects.rows) {
        await client.query(
          `INSERT INTO student_subjects (student_id, subject_id, organization_id)
           VALUES ($1, $2, $3)`,
          [studentId, row.subject_id, organizationId]
        );
      }

      // ✅ Guardians
      const guardians = await client.query(
        `SELECT * FROM pending_guardians WHERE pending_id = $1`,
        [id]
      );

      for (const g of guardians.rows) {
        await client.query(
          `INSERT INTO guardians (first_name, last_name, address, phone, email, hometown, student_id, organization_id)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
          [
            g.first_name,
            g.last_name,
            g.address,
            g.phone,
            g.email,
            g.hometown,
            studentId,
            organizationId,
          ]
        );
      }

      // ✅ Delete from pending
      await client.query(
        `DELETE FROM pending_guardians WHERE pending_id = $1`,
        [id]
      );
      await client.query(
        `DELETE FROM pending_student_subjects WHERE pending_student_id = $1`,
        [id]
      );
      await client.query(`DELETE FROM pending_students WHERE pending_id = $1`, [
        id,
      ]);

      // ✅ Notify guardians
      const guardianEmails = guardians.rows.map((g) => g.email).filter(Boolean);
      if (guardianEmails.length) {
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
                <div style="color:#6fd3c4;font-size:24px;font-weight:600;margin-bottom:16px;letter-spacing:1px;">Admission Approved</div>
                <p style="font-size:16px;line-height:1.6;margin-bottom:18px;">Dear Guardian,</p>
                <p style="font-size:16px;line-height:1.6;margin-bottom:18px;">We are pleased to inform you that the admission application for <strong>${he.encode(
                  student.first_name
                )} ${he.encode(
          student.last_name
        )}</strong> has been approved by <strong>${he.encode(
          orgName
        )}</strong>.</p>
                <p style="font-size:16px;line-height:1.6;margin-bottom:18px;">Thank you for choosing our school.</p>
                <p style="margin-top:18px;font-size:15px;">If you have any questions, please visit our <a href="https://www.managira.com/legal/help" target="_blank" rel="noopener" style="color:#1ca34a;font-weight:500;">Help Center</a> or <a href="https://www.managira.com/legal/faq" target="_blank" rel="noopener" style="color:#1ca34a;font-weight:500;">FAQ page</a>.</p>
                <p style="color:#b80000;font-size:16px;font-weight:bold;margin-top:32px;text-align:center;letter-spacing:1px;">THIS IS A NO-REPLY MESSAGE. PLEASE DO NOT REPLY TO THIS EMAIL.</p>
              </div>
              <div style="background:#e6f7ec;color:#888;text-align:center;padding:18px 0;font-size:13px;">&copy; ${new Date().getFullYear()} Managira. All rights reserved.</div>
            </div>
          </div>
        `;
        const mailOptions = {
          from: process.env.NOTIFY_EMAIL_USER,
          to: guardianEmails.join(","),
          subject: `Admission Approved: ${he.encode(
            student.first_name
          )} ${he.encode(student.last_name)}`,
          html,
          attachments: [
            {
              filename: "managira.png",
              path: require("path").join(
                __dirname,
                "../public/images/managira.png"
              ),
              cid: "managira_logo",
            },
          ],
        };
        transporter.sendMail(mailOptions, (err, info) => {
          // ...removed error log for clean background operation...
        });
      }

      await client.query("COMMIT");
      req.flash("success", "Student approved and added to the system.");
      res.redirect("/common/admissionPending");
    } catch (err) {
      await client.query("ROLLBACK");
      // ...removed error log for clean background operation...
      req.flash("error", "Failed to approve student.");
      res.redirect("/common/admissionPending");
    } finally {
      client.release();
    }
  },

  rejectPendingStudent: async (req, res, db) => {
    const { id } = req.params;
    try {
      const guardians = await db.query(
        `SELECT email FROM pending_guardians WHERE pending_id = $1`,
        [id]
      );
      const pending = await db.query(
        `SELECT first_name, last_name, organization_id FROM pending_students WHERE pending_id = $1`,
        [id]
      );

      const orgId = pending.rows[0]?.organization_id;
      let orgName = "Our School";
      if (orgId) {
        const orgRes = await db.query(
          `SELECT organization_name FROM organizations WHERE organization_id = $1`,
          [orgId]
        );
        orgName = orgRes.rows[0]?.organization_name || orgName;
      }

      await db.query(`DELETE FROM pending_guardians WHERE pending_id = $1`, [
        id,
      ]);
      await db.query(
        `DELETE FROM pending_student_subjects WHERE pending_student_id = $1`,
        [id]
      );
      await db.query(`DELETE FROM pending_students WHERE pending_id = $1`, [
        id,
      ]);

      req.flash("info", "Student application rejected and deleted.");

      if (guardians.rows.length && pending.rows.length) {
        const guardianEmails = guardians.rows
          .map((g) => g.email)
          .filter((e) => e);
        const student = pending.rows[0];

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
                <div style="color:#6fd3c4;font-size:24px;font-weight:600;margin-bottom:16px;letter-spacing:1px;">Admission Rejected</div>
                <p style="font-size:16px;line-height:1.6;margin-bottom:18px;">Dear Guardian,</p>
                <p style="font-size:16px;line-height:1.6;margin-bottom:18px;">We regret to inform you that the admission application for <strong>${
                  student.first_name
                } ${
          student.last_name
        }</strong> has been rejected by <strong>${orgName}</strong>.</p>
                <p style="font-size:16px;line-height:1.6;margin-bottom:18px;">We appreciate your interest in our school.</p>
                <p style="margin-top:18px;font-size:15px;">If you have any questions, please visit our <a href="https://www.managira.com/legal/help" target="_blank" rel="noopener" style="color:#1ca34a;font-weight:500;">Help Center</a> or <a href="https://www.managira.com/legal/faq" target="_blank" rel="noopener" style="color:#1ca34a;font-weight:500;">FAQ page</a>.</p>
                <p style="color:#b80000;font-size:16px;font-weight:bold;margin-top:32px;text-align:center;letter-spacing:1px;">THIS IS A NO-REPLY MESSAGE. PLEASE DO NOT REPLY TO THIS EMAIL.</p>
              </div>
              <div style="background:#e6f7ec;color:#888;text-align:center;padding:18px 0;font-size:13px;">&copy; ${new Date().getFullYear()} Managira. All rights reserved.</div>
            </div>
          </div>
        `;
        const mailOptions = {
          from: process.env.NOTIFY_EMAIL_USER,
          to: guardianEmails.join(","),
          subject: `Admission Rejected: ${student.first_name} ${student.last_name}`,
          html,
          attachments: [
            {
              filename: "managira.png",
              path: require("path").join(
                __dirname,
                "../public/images/managira.png"
              ),
              cid: "managira_logo",
            },
          ],
        };
        transporter.sendMail(mailOptions, (err, info) => {
          // ...removed error log for clean background operation...
        });
      }

      res.redirect("/common/admissionPending");
    } catch (err) {
      // ...removed error log for clean background operation...
      req.flash("error", "Failed to reject student.");
      res.redirect("/common/admissionPending");
    }
  },

  getMajorityGraduationYearGroup: async (req, res, db) => {
    const { classId } = req.query;

    if (!classId) {
      return res.status(400).json({ error: "Class ID is required." });
    }

    try {
      const result = await db.query(
        `
                SELECT graduation_year_group_id, COUNT(*) as count
                FROM students
                WHERE class_id = $1 AND organization_id = $2
                GROUP BY graduation_year_group_id
                ORDER BY count DESC
                LIMIT 1;
            `,
        [classId, req.session.organizationId]
      );

      if (result.rows.length > 0) {
        res.json({
          majorityGraduationYearGroupId:
            result.rows[0].graduation_year_group_id,
        });
      } else {
        res.json({ majorityGraduationYearGroupId: null });
      }
    } catch (err) {
      // ...removed error log for clean background operation...
      res
        .status(500)
        .json({ error: "Failed to fetch majority graduation year group." });
    }
  },

  getSubjectsForClass: async (req, res, db) => {
    const { classId, organizationId } = req.query;

    if (!classId || !organizationId) {
      return res
        .status(400)
        .json({ error: "Class ID and Organization ID are required." });
    }

    try {
      const result = await db.query(
        `
        SELECT subject_id, subject_name
        FROM subjects
        WHERE class_id = $1 AND organization_id = $2
        ORDER BY subject_name ASC
        `,
        [classId, organizationId]
      );

      res.json(result.rows);
    } catch (err) {
      // ...removed error log for clean background operation...
      res.status(500).json({ error: "Failed to load subjects." });
    }
  },

  // Controller for rendering studentDetails page
  studentDetails: async (req, res, db) => {
    const studentId = req.query.studentId;
    const termId = req.query.termId;
    const organizationId = req.session.organizationId;
    const userRole = req.session.userRole;
    const userId = req.session.user ? req.session.user.user_id : null;

    if (!studentId || !termId) {
      return res.status(400).send("Student ID and Term ID are required.");
    }

    try {
      if (!organizationId) {
        req.flash("error", "Organization ID is missing.");
        return res.redirect("/common/orgDashboard");
      }

      // Fetch student details
      const studentResult = await db.query(
        `
          SELECT s.*, c.class_name, c.class_id, g.name AS grad_year_group_name
          FROM students s
          LEFT JOIN classes c ON s.class_id = c.class_id
          LEFT JOIN graduation_year_groups g ON s.graduation_year_group_id = g.id
          WHERE s.student_id = $1 AND s.organization_id = $2
          `,
        [studentId, organizationId]
      );

      if (studentResult.rows.length === 0) {
        return res.status(404).send("Student not found.");
      }

      const student = studentResult.rows[0];
      const classId = student.class_id;

      // **Check if user is the main teacher of the class**
      let isMainTeacher = false;

      if (userRole === "Teacher") {
        const mainTeacherCheck = await db.query(
          `SELECT user_id FROM user_classes 
               WHERE class_id = $1 AND main = TRUE`,
          [classId]
        );

        const mainTeacherId =
          mainTeacherCheck.rows.length > 0
            ? mainTeacherCheck.rows[0].user_id
            : null;
        isMainTeacher = userId === mainTeacherId;
      }

      // **Fetch subjects for the student's class**
      let subjectsQuery;
      let subjectsParams;

      if (userRole === "Teacher" && !isMainTeacher) {
        // If it's a teacher who is not the main teacher, show only their assigned subjects for the student's class
        subjectsQuery = `
          SELECT s.subject_id, s.subject_name
          FROM user_subjects us
          INNER JOIN subjects s ON us.subject_id = s.subject_id
          WHERE us.user_id = $1 AND s.class_id = $2 AND s.organization_id = $3
          ORDER BY s.subject_name
        `;
        subjectsParams = [userId, classId, organizationId];
      } else {
        // For everyone else (including main teacher), show only subjects that the student is actually enrolled in
        subjectsQuery = `
          SELECT s.subject_id, s.subject_name
          FROM student_subjects ss
          INNER JOIN subjects s ON ss.subject_id = s.subject_id
          WHERE ss.student_id = $1 AND ss.organization_id = $2
          ORDER BY s.subject_name
        `;
        subjectsParams = [studentId, organizationId];
      }

      const subjectsResult = await db.query(subjectsQuery, subjectsParams);

      const subjectsMap = new Map();
      subjectsResult.rows.forEach((subject) => {
        subjectsMap.set(subject.subject_id, {
          ...subject,
          totalScore: 0,
          totalMaxScore: 0,
          totalPercentage: null,
          grade: null,
          position: null,
          assessments: [],
        });
      });

      // **Fetch assessments and scores for the student for the specified term**
      const assessmentsResult = await db.query(
        `
          SELECT DISTINCT ON (a.assessment_id) a.assessment_id, a.title, a.weight, ar.score, a.subject_id, a.max_score, a.category,
                 ar.total_subject_score, ar.total_percentage, ar.grade
          FROM assessments a
          LEFT JOIN assessment_results ar ON a.assessment_id = ar.assessment_id AND ar.student_id = $1
          WHERE a.subject_id IN (SELECT subject_id FROM subjects WHERE class_id = $2)
          AND a.organization_id = $3 AND a.term_id = $4
          ORDER BY a.assessment_id
          `,
        [studentId, classId, organizationId, termId]
      );

      // Aggregate assessments by subject
      assessmentsResult.rows.forEach((assessment) => {
        if (subjectsMap.has(assessment.subject_id)) {
          const subject = subjectsMap.get(assessment.subject_id);
          subject.assessments.push(assessment);
          if (assessment.score !== null) {
            subject.totalScore += parseFloat(assessment.score);
            subject.totalMaxScore += parseFloat(assessment.max_score);
          }
          if (assessment.total_percentage !== null) {
            subject.totalPercentage = parseFloat(assessment.total_percentage);
          }
          if (assessment.grade) {
            subject.grade = assessment.grade;
          }
        }
      });

      // Fetch positions from student_positions table for the specified term
      const positionsResult = await db.query(
        `
          SELECT subject_id, position
          FROM student_positions
          WHERE student_id = $1 AND organization_id = $2 AND term_id = $3
          `,
        [studentId, organizationId, termId]
      );

      const positions = positionsResult.rows.reduce((acc, position) => {
        acc[position.subject_id] = position.position;
        return acc;
      }, {});

      subjectsMap.forEach((subject) => {
        subject.position = positions[subject.subject_id] || "-";
      });

      const subjects = Array.from(subjectsMap.values());

      // Calculate unique assessments for all subjects to use in the table headers
      const uniqueAssessments = Array.from(
        new Set(assessmentsResult.rows.map((a) => a.title))
      ).map((title) => {
        return assessmentsResult.rows.find((a) => a.title === title);
      });

      // Fetch guardians associated with the student
      const guardiansResult = await db.query(
        `
          SELECT * FROM guardians
          WHERE student_id = $1
          `,
        [studentId]
      );

      // Fetch current school year from the current term
      const currentTermId = req.session.currentTermId;

      let studentEnrolledInCurrent = false;
      let currentSchoolYearLabel = null;
      let currentTermName = null;

      if (currentTermId) {
        const currentInfoResult = await db.query(
          `
    SELECT t.term_id, t.term_name, sy.id AS school_year_id, sy.year_label
    FROM terms t
    INNER JOIN school_years sy ON t.school_year_id = sy.id
    WHERE t.term_id = $1 AND t.organization_id = $2
  `,
          [currentTermId, organizationId]
        );

        if (currentInfoResult.rows.length > 0) {
          const { school_year_id, year_label, term_name } =
            currentInfoResult.rows[0];
          currentSchoolYearLabel = year_label;
          currentTermName = term_name;

          // Check enrollment
          const enrollmentCheck = await db.query(
            `
      SELECT 1
      FROM enrollments e
      INNER JOIN enrolled_students es ON e.enrollment_id = es.enrollment_id
      WHERE e.term_id = $1 AND e.school_year_id = $2
      AND es.student_id = $3 AND e.organization_id = $4
      LIMIT 1
    `,
            [currentTermId, school_year_id, studentId, organizationId]
          );

          studentEnrolledInCurrent = enrollmentCheck.rows.length > 0;
        }
      }

      const guardians = guardiansResult.rows;

      // Get enrolled class for this term
      const enrolledClassResult = await db.query(
        `
  SELECT c.class_name
  FROM enrolled_students es
  JOIN enrolled_classes ec ON es.enrollment_id = ec.enrollment_id AND es.class_id = ec.class_id
  JOIN classes c ON es.class_id = c.class_id
  JOIN enrollments e ON es.enrollment_id = e.enrollment_id
  WHERE es.student_id = $1 AND e.term_id = $2 AND e.organization_id = $3
  ORDER BY e.created_at DESC
  LIMIT 1
`,
        [studentId, termId, organizationId]
      );

      const enrolledClassForTerm =
        enrolledClassResult.rows[0]?.class_name || "Not enrolled";

      const termResult = await db.query(
        `
  SELECT term_name
  FROM terms
  WHERE term_id = $1 AND organization_id = $2
  LIMIT 1
`,
        [termId, organizationId]
      );

      const termNameForPage = termResult.rows[0]?.term_name || "Unknown";

      res.render("common/studentDetails", {
        title: "Student Details",
        student,
        guardians,
        subjects,
        uniqueAssessments,
        isMainTeacher,
        getOrdinalSuffix,
        gradYearGroupName:
          student.grad_year_group_name || "No graduation year group assigned",
        currentTerm: termId,
        currentSchoolYearLabel,
        currentTermName,
        enrolledClassForTerm,
        termNameForPage,
        studentEnrolledInCurrent,
        messages: req.flash(),
      });
        } catch (err) {
      // ...removed error log for clean background operation...
      res.status(500).send("Failed to fetch student details");
        }
  },

  studentInfo: async (req, res, db) => {
    const studentId = req.query.studentId;

    if (!studentId) {
      return res.status(400).send("Student ID is required.");
    }

    try {
      const organizationId = req.session.organizationId;

      // Fetch student details
      const studentResult = await db.query(
        `
            SELECT s.*, c.class_name, g.name AS grad_year_group_name
            FROM students s
            LEFT JOIN classes c ON s.class_id = c.class_id
            LEFT JOIN graduation_year_groups g ON s.graduation_year_group_id = g.id
            WHERE s.student_id = $1 AND s.organization_id = $2
        `,
        [studentId, organizationId]
      );

      if (studentResult.rows.length === 0) {
        return res.status(404).send("Student not found.");
      }

      const student = studentResult.rows[0];

      // Fetch guardians for the student
      const guardiansResult = await db.query(
        `
            SELECT * FROM guardians WHERE student_id = $1
        `,
        [studentId]
      );

      const guardians = guardiansResult.rows;

      res.render("common/studentInfo", {
        title: "Student Info",
        student,
        guardians,
        gradYearGroupName:
          student.grad_year_group_name || "No graduation year group assigned",
        messages: req.flash(),
      });
    } catch (err) {
      // ...removed error log for clean background operation...
      res.status(500).send("Failed to fetch student information.");
    }
  },

  editStudentGet: async (req, res, db) => {
    try {
      const { studentId } = req.query;
      const organizationId = req.session.organizationId;

      // Fetch student details
      const studentQuery = `
            SELECT s.*, c.class_id, c.class_name 
            FROM students s
            LEFT JOIN classes c ON s.class_id = c.class_id
            WHERE s.student_id = $1 AND s.organization_id = $2;
        `;
      const studentResult = await db.query(studentQuery, [
        studentId,
        organizationId,
      ]);
      const student = studentResult.rows[0];

      if (!student) {
        // ...removed warn for clean background operation...
        req.flash("error", "Student not found.");
        return res.redirect("/common/orgDashboard");
      }

      // ✅ Fetch current term correctly (FIXED SQL QUERY)
      const termQuery = `
            SELECT t.term_id, t.term_name 
            FROM enrollments e
            INNER JOIN enrolled_classes ec ON e.enrollment_id = ec.enrollment_id
            INNER JOIN terms t ON e.term_id = t.term_id
            WHERE ec.class_id = $1 AND e.organization_id = $2
            ORDER BY t.start_date DESC LIMIT 1;
        `;
      const termResult = await db.query(termQuery, [
        student.class_id,
        organizationId,
      ]);
      const currentTerm =
        termResult.rows.length > 0 ? termResult.rows[0] : null;

      if (!currentTerm) {
        // ...removed warn for clean background operation...
        req.flash("error", "No active term found for this class.");
        return res.redirect("/common/orgDashboard");
      }

      // Fetch classes
      const classResult = await db.query(
        `SELECT class_id, class_name FROM classes WHERE organization_id = $1;`,
        [organizationId]
      );

      // Fetch graduation year groups
      const graduationYearGroups = await db.query(
        `SELECT id, name FROM graduation_year_groups WHERE organization_id = $1;`,
        [organizationId]
      );

      // Fetch subjects for the student's class
      const subjects = await db.query(
        `SELECT subject_id, subject_name FROM subjects WHERE class_id = $1 AND organization_id = $2;`,
        [student.class_id, organizationId]
      );

      // Fetch guardians
      const guardians = await db.query(
        `SELECT * FROM guardians WHERE student_id = $1;`,
        [studentId]
      );

      // Fetch subjects already assigned to the student
      const studentSubjects = await db.query(
        `SELECT subject_id FROM student_subjects WHERE student_id = $1;`,
        [studentId]
      );

      // ✅ Ensure term is always defined
      res.render("common/editStudent", {
        title: "Edit Student",
        student,
        classes: classResult.rows,
        graduationYearGroups: graduationYearGroups.rows,
        subjects: subjects.rows,
        studentGuardians: guardians.rows,
        studentSubjects: studentSubjects.rows.map((row) => row.subject_id),
        currentTerm, // ✅ Fix: Now always defined
        messages: req.flash(),
      });
    } catch (error) {
      // ...removed error log for clean background operation...
      req.flash("error", "Failed to fetch student details.");
      res.redirect("/common/orgDashboard");
    }
  },

  editStudentPost: async (req, res, db) => {
    try {
      const { studentId } = req.params; // Ensure studentId is retrieved from req.params
      const {
        firstName,
        lastName,
        dateOfBirth,
        height,
        hometown,
        classId,
        graduationYearGroupId,
        gender,
        subjects,
        guardians,
      } = req.body;

      let imageUrl = null;
      if (req.file) {
        const organizationId = req.session.organizationId;
        const s3Key = `images/studentimages/${organizationId}/${req.file.originalname}`;
        imageUrl = await uploadToS3(req.file, s3Key);
      }

      await db.query("BEGIN"); // Start a database transaction

      // Update student details
      const updateStudentQuery = `
            UPDATE students
            SET first_name = $1, 
                last_name = $2, 
                date_of_birth = $3, 
                height = $4, 
                hometown = $5, 
                class_id = $6, 
                graduation_year_group_id = $7, 
                gender = $8, 
                image_url = COALESCE($9, image_url)
            WHERE student_id = $10 
            AND organization_id = $11;
        `;
      await db.query(updateStudentQuery, [
        firstName,
        lastName,
        dateOfBirth,
        height,
        hometown,
        classId,
        graduationYearGroupId,
        gender,
        imageUrl,
        studentId,
        req.session.organizationId,
      ]);

      // Update subjects
      await db.query(`DELETE FROM student_subjects WHERE student_id = $1;`, [
        studentId,
      ]);
      if (Array.isArray(subjects)) {
        for (const subjectId of subjects) {
          await db.query(
            `INSERT INTO student_subjects (student_id, subject_id, organization_id) VALUES ($1, $2, $3);`,
            [studentId, subjectId, req.session.organizationId]
          );
        }
      }

      // Update guardians
      await db.query(`DELETE FROM guardians WHERE student_id = $1;`, [
        studentId,
      ]);
      if (Array.isArray(guardians)) {
        for (const guardian of guardians) {
          await db.query(
            `
                    INSERT INTO guardians (first_name, last_name, address, phone, email, hometown, student_id, organization_id)
                    VALUES ($1, $2, $3, $4, $5, $6, $7, $8);
                    `,
            [
              guardian.firstName,
              guardian.lastName,
              guardian.address,
              guardian.phone,
              guardian.email, // Add the email field correctly
              guardian.hometown,
              studentId,
              req.session.organizationId,
            ]
          );
        }
      }

      await db.query("COMMIT"); // Commit the transaction
      req.flash("success", "Student updated successfully.");
      res.redirect("/common/editStudent?studentId=" + studentId);
    } catch (error) {
      await db.query("ROLLBACK"); // Rollback the transaction in case of an error
      // ...removed error log for clean background operation...

      // Ensure `studentId` is referenced in error handling
      const studentIdFallback = req.params.studentId || "unknown";
      req.flash("error", "Failed to update student.");
      res.redirect("/common/editStudent?studentId=" + studentIdFallback);
    }
  },

  deleteStudentImage: async (req, res, db) => {
    const { studentId } = req.params;
    const organizationId = req.session.organizationId;

    try {
      if (!studentId || isNaN(Number(studentId))) {
        req.flash("error", "Invalid student ID.");
        return res.redirect("/common/orgDashboard");
      }

      const studentRes = await db.query(
        `SELECT image_url, class_id FROM students WHERE student_id = $1 AND organization_id = $2`,
        [studentId, organizationId]
      );

      if (studentRes.rows.length === 0) {
        // ...removed warn for clean background operation...
        req.flash("error", "Student not found.");
        return res.redirect("/common/orgDashboard");
      }

      const { image_url: currentImageUrl, class_id: classId } =
        studentRes.rows[0];

      if (currentImageUrl && currentImageUrl !== "profilePlaceholder.png") {
        // Remove the S3 URL prefix to get the key if needed
        const s3Prefix = `https://${process.env.S3_BUCKET_NAME}.s3.${process.env.AWS_REGION}.amazonaws.com/`;
        let imageKey = currentImageUrl;
        if (currentImageUrl.startsWith(s3Prefix)) {
          imageKey = currentImageUrl.substring(s3Prefix.length);
        }
        await deleteFromS3(imageKey);
      }

      await db.query(
        `UPDATE students SET image_url = 'profilePlaceholder.png' WHERE student_id = $1 AND organization_id = $2`,
        [studentId, organizationId]
      );

      const termRes = await db.query(
        `SELECT t.term_id FROM enrollments e
         INNER JOIN enrolled_classes ec ON e.enrollment_id = ec.enrollment_id
         INNER JOIN terms t ON e.term_id = t.term_id
         WHERE ec.class_id = $1 AND e.organization_id = $2
         ORDER BY t.start_date DESC LIMIT 1;`,
        [classId, organizationId]
      );

      const termId = termRes.rows.length > 0 ? termRes.rows[0].term_id : null;

      req.flash("success", "Student image deleted successfully.");
      res.redirect(
        `/common/editStudent?studentId=${studentId}${
          termId ? `&termId=${termId}` : ""
        }`
      );
    } catch (err) {
      // ...removed error log for clean background operation...
      req.flash("error", "Failed to delete student image.");
      res.redirect(`/common/editStudent?studentId=${studentId}`);
    }
  },

  deletePendingStudentImage: async (req, res, db) => {
    const { id } = req.params;
    const organizationId = req.session.organizationId;

    try {
      if (!id || isNaN(Number(id))) {
        req.flash("error", "Invalid pending student ID.");
        return res.redirect("/common/admissionPending");
      }

      // Fetch image URL
      const imageRes = await db.query(
        `SELECT image_url FROM pending_students WHERE pending_id = $1 AND organization_id = $2`,
        [id, organizationId]
      );

      if (imageRes.rows.length === 0) {
        // ...removed warn for clean background operation...
        req.flash("error", "Pending student not found.");
        return res.redirect("/common/admissionPending");
      }

      const currentImageUrl = imageRes.rows[0].image_url;

      // Delete from S3 if not placeholder
      if (currentImageUrl && currentImageUrl !== "profilePlaceholder.png") {
        const s3Key = currentImageUrl.startsWith("/")
          ? currentImageUrl.substring(1)
          : currentImageUrl;
        await deleteFromS3(s3Key);
      }

      // Update DB
      await db.query(
        `UPDATE pending_students SET image_url = 'profilePlaceholder.png' WHERE pending_id = $1 AND organization_id = $2`,
        [id, organizationId]
      );

      req.flash("success", "Pending student image deleted successfully.");
      res.redirect(`/common/admissionPending`);
    } catch (err) {
      // ...removed error log for clean background operation...
      req.flash("error", "Failed to delete pending student image.");
      res.redirect(`/common/admissionPending`);
    }
  },

  deleteStudent: async (req, res, db) => {
    const { studentId } = req.params;

    if (!studentId) {
      req.flash("error", "Student ID is required.");
      return res.redirect(`/common/editStudent?studentId=${studentId}`);
    }

    const client = await db.connect();

    try {
      await client.query("BEGIN"); // Start a transaction

      // Fetch the student's image URL and class ID
      const studentResult = await client.query(
        "SELECT image_url, class_id FROM students WHERE student_id = $1",
        [studentId]
      );

      if (studentResult.rows.length > 0) {
        const imageUrl = studentResult.rows[0].image_url;
        const classId = studentResult.rows[0].class_id;

        // Delete the student's image from S3, if applicable
        if (imageUrl && imageUrl !== "profilePlaceholder.png") {
          const imageKey = path.basename(imageUrl);
          await deleteFromS3(`images/${imageKey}`);
        }

        // Delete all references to the student in other tables
        await client.query("DELETE FROM guardians WHERE student_id = $1", [
          studentId,
        ]);
        await client.query(
          "DELETE FROM student_subjects WHERE student_id = $1",
          [studentId]
        );
        await client.query(
          "DELETE FROM enrolled_students WHERE student_id = $1",
          [studentId]
        );
        await client.query(
          "DELETE FROM attendance_records WHERE student_id = $1",
          [studentId]
        );

        // Finally, delete the student
        await client.query(
          "DELETE FROM students WHERE student_id = $1 AND organization_id = $2",
          [studentId, req.session.organizationId]
        );

        await client.query("COMMIT"); // Commit the transaction
        req.flash("success", "Student deleted successfully.");
        res.redirect(`/common/classDashboard?classId=${classId}`);
      } else {
        await client.query("ROLLBACK"); // Rollback transaction on error
        req.flash("error", "Student not found.");
        res.redirect(`/common/editStudent?studentId=${studentId}`);
      }
    } catch (error) {
      await client.query("ROLLBACK"); // Rollback transaction on error
      // ...removed error log for clean background operation...
      req.flash("error", "Failed to delete student.");
      res.redirect(`/common/editStudent?studentId=${studentId}`);
    } finally {
      client.release();
    }
  },

  getAttendanceForClass: async (req, res, db) => {
    const { classId, termId } = req.query;

    if (!termId) {
      return res.status(400).send("Term ID is required");
    }

    try {
      const result = await db.query(
        "SELECT * FROM attendance_records WHERE class_id = $1 AND term_id = $2",
        [classId, termId]
      );
      res.json({ success: true, attendance: result.rows });
    } catch (error) {
      res.json({ success: false, error: error.message });
    }
  },

  attendanceCollection: async (req, res, db) => {
    const { classId, termId } = req.query;

    if (!classId || !termId) {
      return res.status(400).send("Class ID and Term ID are required.");
    }

    try {
      const organizationId = req.session.organizationId;

      // Fetch class name
      const classResult = await db.query(
        "SELECT class_name FROM classes WHERE class_id = $1 AND organization_id = $2",
        [classId, organizationId]
      );

      if (classResult.rows.length === 0) {
        return res.status(404).send("Class not found");
      }
      const className = classResult.rows[0].class_name;

      // Fetch term name and school year
      const termResult = await db.query(
        `SELECT t.term_name, sy.year_label 
                 FROM terms t 
                 JOIN school_years sy ON t.school_year_id = sy.id 
                 WHERE t.term_id = $1`,
        [termId]
      );

      if (termResult.rows.length === 0) {
        return res.status(404).send("Term not found");
      }

      const termName = termResult.rows[0].term_name;
      const schoolYear = {
        year_label: termResult.rows[0].year_label,
      };

      // Fetch students enrolled in the current term for this class
      const studentsResult = await db.query(
        `
                SELECT s.student_id, s.first_name, s.last_name, s.gender
                FROM enrolled_students es
                INNER JOIN enrollments e ON es.enrollment_id = e.enrollment_id
                INNER JOIN students s ON es.student_id = s.student_id
                WHERE es.class_id = $1 
                  AND e.term_id = $2 
                  AND e.organization_id = $3
                  AND s.graduated = FALSE
                ORDER BY s.last_name, s.first_name

            `,
        [classId, termId, organizationId]
      );

      const students = studentsResult.rows;

      // Fetch term dates for the class
      const termDatesResult = await db.query(
        `
                SELECT start_date, end_date
                FROM terms
                WHERE term_id = $1
            `,
        [termId]
      );

      if (termDatesResult.rows.length === 0) {
        return res.status(404).send("Term not found");
      }

      const { start_date, end_date } = termDatesResult.rows[0];
      const dates = [];
      let currentDate = new Date(start_date);
      const today = new Date();

      while (currentDate <= end_date && currentDate <= today) {
        dates.push(currentDate.toISOString().split("T")[0]);
        currentDate.setDate(currentDate.getDate() + 1);
      }

      const displayDates = dates
        .sort((a, b) => new Date(b) - new Date(a))
        .slice(0, 10)
        .reverse();

      // Fetch attendance records
      const attendanceResult = await db.query(
        `
                SELECT student_id, date, status, updated_at
                FROM attendance_records
                WHERE class_id = $1 AND term_id = $2 AND organization_id = $3
            `,
        [classId, termId, organizationId]
      );

      const attendanceMap = {};
      const lastEditedMap = {};

      attendanceResult.rows.forEach((record) => {
        const dateKey = record.date.toISOString().split("T")[0];
        if (!attendanceMap[record.student_id]) {
          attendanceMap[record.student_id] = {};
        }
        attendanceMap[record.student_id][dateKey] = record.status;

        if (record.updated_at) {
          lastEditedMap[dateKey] = record.updated_at;
        }
      });

      // Render the attendance collection page
      res.render("common/attendanceCollection", {
        title: "Attendance Records",
        classId,
        className,
        termId,
        termName,
        displayDates,
        students,
        attendanceMap,
        lastEditedMap,
        schoolYear,
      });
    } catch (error) {
      // ...removed error log for clean background operation...
      res.status(500).send("Error loading attendance records page");
    }
  },

  saveSingleAttendance: async (req, res, db) => {
    const { attendance, classId, termId, date } = req.body;

    if (!termId) {
      return res.status(400).send("Term ID is required");
    }

    try {
      await db.query("BEGIN");

      for (const studentId in attendance) {
        const status = attendance[studentId];

        await db.query(
          `
                    INSERT INTO attendance_records (student_id, date, status, class_id, term_id, marked_by, organization_id)
                    VALUES ($1, $2, $3, $4, $5, $6, $7)
                    ON CONFLICT (student_id, date, term_id)
                    DO UPDATE SET status = EXCLUDED.status, marked_by = EXCLUDED.marked_by, updated_at = NOW()`,
          [
            studentId,
            date,
            status,
            classId,
            termId,
            req.session.userId,
            req.session.organizationId,
          ]
        );
      }

      await db.query("COMMIT");
      res.json({ success: true });
    } catch (error) {
      await db.query("ROLLBACK");
      res
        .status(500)
        .json({ success: false, message: "Failed to save attendance" });
    }
  },

  createEmployeeGet: async (req, res, db) => {
    try {
      const classesResult = await db.query(
        "SELECT * FROM classes WHERE organization_id = $1",
        [req.session.organizationId]
      );
      res.render("common/createEmployee", {
        title: "Create Employee",
        classes: classesResult.rows,
        messages: {
          success: req.flash("success"),
          error: req.flash("error"),
        },
      });
    } catch (error) {
      // ...removed error log for clean background operation...
      req.flash("error", "Failed to load classes.");
      res.redirect("/common/manageEmployees");
    }
  },

  createEmployeePost: async (req, res, db) => {
    const { firstName, lastName, email, account_type } = req.body;

    let classes = req.body.classes || [];
    let subjects = req.body.subjects || [];

    if (!Array.isArray(classes)) classes = [classes];
    if (!Array.isArray(subjects)) subjects = [subjects];

    if (!firstName || !lastName || !email || !account_type) {
      req.flash("error", "All fields are required.");
      return res.redirect("/common/createEmployee");
    }

    const client = await db.connect();

    try {
      await client.query("BEGIN");

      // ✅ Check if the email already exists in users or organizations
      const emailCheckResult = await client.query(
        `SELECT email FROM users WHERE LOWER(email) = LOWER($1)
         UNION
         SELECT email FROM organizations WHERE LOWER(email) = LOWER($1)`,
        [email]
      );

      if (emailCheckResult.rows.length > 0) {
        req.flash(
          "error",
          "This email is already in use by another user or organization."
        );
        await client.query("ROLLBACK");
        return res.redirect("/common/createEmployee");
      }

      // ✅ Generate token for password setup
      const token = crypto.randomBytes(32).toString("hex");
      const hashedToken = crypto
        .createHash("sha256")
        .update(token)
        .digest("hex");
      const tokenExpiration = new Date(Date.now() + 3 * 24 * 60 * 60 * 1000); // 3 days

      // ✅ Insert new employee
      const result = await client.query(
        `INSERT INTO users (
           first_name, last_name, email, account_type, organization_id,
           created_at, updated_at, reset_password_token, reset_password_expires
         )
         VALUES ($1, $2, $3, $4, $5, NOW(), NOW(), $6, $7)
         RETURNING user_id`,
        [
          firstName,
          lastName,
          email,
          account_type,
          req.session.organizationId,
          hashedToken,
          tokenExpiration,
        ]
      );

      const userId = result.rows[0].user_id;

      // ✅ Insert classes
      for (const classId of classes) {
        await client.query(
          "INSERT INTO user_classes (user_id, class_id, main) VALUES ($1, $2, $3)",
          [userId, classId, false]
        );
      }

      // ✅ Insert subjects
      for (const subjectId of subjects) {
        await client.query(
          "INSERT INTO user_subjects (user_id, subject_id) VALUES ($1, $2)",
          [userId, subjectId]
        );
      }

      // ✅ Send invitation email
      const baseUrl = req.protocol + "://" + req.get("host");
      const setPasswordUrl = `${baseUrl}/common/set-password?token=${token}`;
      const organizationName = req.session.organizationName;

      await sendInviteEmail(
        email,
        firstName,
        lastName,
        setPasswordUrl,
        organizationName
      );

      await client.query("COMMIT");
      req.flash(
        "success",
        "Employee created successfully. Invitation sent to set their password. Please note: the invitation link will expire in 2 days. If it expires, the employee will need to consult their organization for assistance."
      );
      res.redirect("/common/createEmployee");
    } catch (error) {
      await client.query("ROLLBACK");
      // ...removed error log for clean background operation...
      req.flash("error", "Failed to create employee: " + error.message);
      res.redirect("/common/createEmployee");
    } finally {
      client.release();
    }
  },

  setPasswordGet: async (req, res, db) => {
    const { token, type } = req.query;

    if (!token) {
      req.flash("error", "Invalid or missing token.");
      return res.redirect("/account/login");
    }

    try {
      // Check password_reset_tokens table
      const tokenResult = await db.query(
        `SELECT user_id, expires_at FROM password_reset_tokens WHERE token = $1`,
        [token]
      );

      if (tokenResult.rows.length === 0) {
        req.flash("error", "Invalid or expired token.");
        return res.redirect("/account/login");
      }

      const { user_id, expires_at } = tokenResult.rows[0];

      if (new Date(expires_at) < new Date()) {
        req.flash("error", "Token has expired. Please request a new password reset.");
        return res.redirect("/account/login");
      }

      // Check if it's a guardian token
      if (type === 'guardian' || user_id.startsWith('guardian_')) {
        const guardianId = user_id.replace('guardian_', '');
        const guardianResult = await db.query(
          `SELECT gp.first_name, gp.last_name, gp.email, ga.login_email, ga.login_phone, o.organization_name
           FROM guardian_profiles gp
           JOIN guardian_accounts ga ON ga.guardian_id = gp.guardian_id
           JOIN organizations o ON o.organization_id = gp.organization_id
           WHERE gp.guardian_id = $1`,
          [guardianId]
        );

        if (guardianResult.rows.length === 0) {
          req.flash("error", "Guardian not found.");
          return res.redirect("/account/login");
        }

        const guardian = guardianResult.rows[0];
        const user = {
          first_name: guardian.first_name,
          last_name: guardian.last_name,
          email: guardian.login_email || guardian.email,
          role: 'Guardian',
          organization: guardian.organization_name
        };

        return res.render("common/setPassword", {
          title: "Set Your Password",
          user,
          token,
          type: 'guardian',
          messages: req.flash(),
        });
      }

      // Staff user token (old logic)
      const hashedToken = crypto.createHash("sha256").update(token).digest("hex");
      const result = await db.query(
        `SELECT user_id, first_name, last_name, email, account_type AS role, $2 AS organization
         FROM users
         WHERE reset_password_token = $1 AND reset_password_expires > NOW()`,
        [hashedToken, req.session.organizationName]
      );

      if (result.rows.length === 0) {
        req.flash("error", "Invalid or expired token.");
        return res.redirect("/account/login");
      }

      const user = result.rows[0];

      res.render("common/setPassword", {
        title: "Set Your Password",
        user,
        token,
        type: 'staff',
        messages: req.flash(),
      });
        } catch (error) {
      // ...removed error log for clean background operation...
      req.flash("error", "An error occurred. Please try again.");
      res.redirect("/account/login");
        }
  },

  setPasswordPost: async (req, res, db) => {
    const { token, password, confirmPassword, type } = req.body;

    if (password !== confirmPassword) {
      req.flash("error", "Passwords do not match.");
      return res.redirect(`/common/set-password?token=${token}&type=${type || ''}`);
    }

    if (password.length < 6) {
      req.flash("error", "Password must be at least 6 characters long.");
      return res.redirect(`/common/set-password?token=${token}&type=${type || ''}`);
    }

    const hashedPassword = await bcrypt.hash(password, 10);

    try {
      // Check password_reset_tokens table
      const tokenResult = await db.query(
        `SELECT user_id, expires_at FROM password_reset_tokens WHERE token = $1`,
        [token]
      );

      if (tokenResult.rows.length === 0) {
        req.flash("error", "Invalid or expired token.");
        return res.redirect("/account/login");
      }

      const { user_id, expires_at } = tokenResult.rows[0];

      if (new Date(expires_at) < new Date()) {
        req.flash("error", "Token has expired.");
        return res.redirect("/account/login");
      }

      // Handle guardian password reset
      if (type === 'guardian' || user_id.startsWith('guardian_')) {
        const guardianId = user_id.replace('guardian_', '');
        
        console.log('💾 Setting guardian password:', {
          guardianId,
          hashedPassword: hashedPassword ? 'generated' : 'missing'
        });
        
        // Update guardian account password
        const updateResult = await db.query(
          `UPDATE guardian_accounts
           SET password_hash = $1, must_reset_password = FALSE, updated_at = NOW()
           WHERE guardian_id = $2
           RETURNING guardian_id, login_email, login_phone`,
          [hashedPassword, guardianId]
        );

        console.log('✅ Password update result:', {
          rowCount: updateResult.rowCount,
          updated: updateResult.rows[0]
        });

        if (updateResult.rowCount === 0) {
          req.flash("error", "Guardian account not found.");
          return res.redirect("/account/login");
        }

        // Delete the used token
        await db.query(`DELETE FROM password_reset_tokens WHERE token = $1`, [token]);

        req.flash("success", "Password set successfully! You can now log in to the Parent Portal.");
        return res.redirect("/account/login");
      }

      // Handle staff password reset (old logic)
      const hashedToken = crypto.createHash("sha256").update(token).digest("hex");
      const result = await db.query(
        `UPDATE users
         SET password = $1, reset_password_token = NULL, reset_password_expires = NULL
         WHERE reset_password_token = $2 RETURNING first_name, last_name, email`,
        [hashedPassword, hashedToken]
      );

      if (result.rowCount === 0) {
        req.flash("error", "Invalid or expired token.");
        return res.redirect("/account/login");
      }

      const { first_name, last_name, email } = result.rows[0];

      // Send success email to the user
      await sendPasswordSetSuccessEmail(email, first_name, last_name);

      req.flash("success", "Password set successfully. You can now log in.");
      res.redirect("/account/login");
        } catch (error) {
      // ...removed error log for clean background operation...
      req.flash("error", "An error occurred. Please try again.");
      res.redirect(`/common/set-password?token=${token}&type=${type || ''}`);
        }
  },

  getEmployeeDetails: async (req, res, db) => {
    try {
      const userId = req.query.userId;

      // Basic employee info
      let employeeResult = await db.query(
        `SELECT user_id, first_name, last_name, email, account_type
         FROM users 
         WHERE user_id = $1 AND organization_id = $2`,
        [userId, req.session.organizationId]
      );

      let employee;
      let isManager = false;

      if (employeeResult.rows.length > 0) {
        employee = employeeResult.rows[0];
        employee.image_url = "/images/profilePlaceholder.png";

        // 🔥 Fetch classes and subjects assigned to this user
        const classSubjectsResult = await db.query(
          `
          SELECT c.class_id, c.class_name, s.subject_id, s.subject_name
          FROM user_classes uc
          JOIN classes c ON uc.class_id = c.class_id
          JOIN subjects s ON s.class_id = c.class_id
          JOIN user_subjects us ON us.subject_id = s.subject_id AND us.user_id = uc.user_id
          WHERE uc.user_id = $1
          ORDER BY c.class_name, s.subject_name
          `,
          [userId]
        );

        // 🔥 Group by classes and subjects
        const classesMap = {};
        classSubjectsResult.rows.forEach((row) => {
          if (!classesMap[row.class_id]) {
            classesMap[row.class_id] = {
              class_id: row.class_id,
              class_name: row.class_name,
              subjects: [],
            };
          }
          classesMap[row.class_id].subjects.push({
            subject_id: row.subject_id,
            subject_name: row.subject_name,
          });
        });

        employee.classes = Object.values(classesMap);
      } else {
        // Manager logic
        const orgResult = await db.query(
          `SELECT 
             o.organization_id AS user_id,
             o.first_name,
             o.last_name,
             o.email,
             'Manager' AS account_type,
             o.organization_name,
             o.nickname,
             p.plan_name
           FROM organizations o
           LEFT JOIN plans p ON o.plan_id = p.id
           WHERE o.organization_id = $1`,
          [userId]
        );

        if (orgResult.rows.length === 0) {
          req.flash("error", "Employee not found.");
          return res.redirect("/common/manageEmployees");
        }

        employee = orgResult.rows[0];
        employee.image_url = "/images/profilePlaceholder.png";
        employee.classes = [];
        isManager = true;
      }

      res.render("common/employeeDetails", {
        employee,
        isManager,
        title: "Employee Details",
        messages: {
          success: req.flash("success"),
          error: req.flash("error"),
        },
        loggedInUserId: req.session.user.user_id,
      });
    } catch (error) {
      // ...removed error log for clean background operation...
      req.flash("error", "Could not load employee details.");
      res.redirect("/common/manageEmployees");
    }
  },

  manageEmployees: async (req, res, db) => {
    try {
      // Basic employee info (with class IDs)
      const result = await db.query(
        `
          SELECT u.user_id, u.first_name, u.last_name, u.email, u.account_type, 
                 u.reset_password_token, array_agg(uc.class_id) as class_ids
          FROM users u
          LEFT JOIN user_classes uc ON u.user_id = uc.user_id
          WHERE u.organization_id = $1
          GROUP BY u.user_id
          ORDER BY u.first_name, u.last_name
        `,
        [req.session.organizationId]
      );

      const classesResult = await db.query(
        "SELECT * FROM classes WHERE organization_id = $1",
        [req.session.organizationId]
      );

      const employees = result.rows;

      for (let employee of employees) {
        const classIds = employee.class_ids || [];

        // 🔥 Fetch only the classes assigned to this employee
        const classesQuery = await db.query(
          "SELECT class_id, class_name FROM classes WHERE class_id = ANY($1)",
          [classIds]
        );
        const classes = classesQuery.rows;

        // 🔥 Fetch subjects only for the assigned classes
        const subjectsQuery = await db.query(
          `
            SELECT s.subject_id, s.subject_name, s.class_id
            FROM user_subjects us
            JOIN subjects s ON us.subject_id = s.subject_id
            WHERE us.user_id = $1 AND s.class_id = ANY($2)
          `,
          [employee.user_id, classIds]
        );

        // 🔥 Group subjects by class_id
        const classMap = {};
        classes.forEach((cls) => {
          classMap[cls.class_id] = {
            class_id: cls.class_id,
            class_name: cls.class_name,
            subjects: [],
          };
        });

        subjectsQuery.rows.forEach((sub) => {
          if (classMap[sub.class_id]) {
            classMap[sub.class_id].subjects.push({
              subject_id: sub.subject_id,
              subject_name: sub.subject_name,
            });
          }
        });

        // 🔥 Assign grouped classes with subjects to the employee
        employee.classes = Object.values(classMap);
      }

      res.render("common/manageEmployees", {
        title: "Manage Employees",
        employees: employees,
        messages: {
          success: req.flash("success"),
          error: req.flash("error"),
        },
      });
    } catch (error) {
      // ...removed error log for clean background operation...
      req.flash("error", "Failed to load employees.");
      res.redirect("/common/createEmployee");
    }
  },

  toggleHoldEmployee: async (req, res, db) => {
    const { userId } = req.params;
    try {
      const result = await db.query(
        "UPDATE users SET on_hold = NOT on_hold WHERE user_id = $1 AND organization_id = $2 RETURNING on_hold",
        [userId, req.session.organizationId]
      );
      const newStatus = result.rows[0].on_hold ? "on hold" : "resumed";
      req.flash("success", `Employee has been ${newStatus}.`);
      res.redirect(`/common/modifyEmployee?userId=${userId}`);
    } catch (error) {
      // ...removed error log for clean background operation...
      req.flash("error", "Failed to update employee status.");
      res.redirect(`/common/modifyEmployee?userId=${userId}`);
    }
  },

  modifyEmployeeGet: async (req, res, db) => {
    const { userId } = req.query;

    if (!userId) {
      res.status(400).send("User ID is required.");
      return;
    }

    try {
      const userResult = await db.query(
        "SELECT * FROM users WHERE user_id = $1 AND organization_id = $2",
        [userId, req.session.organizationId]
      );
      if (userResult.rows.length === 0) {
        res.status(404).send("User not found.");
        return;
      }
      const user = userResult.rows[0];

      const classesResult = await db.query(
        `
                SELECT c.class_id, c.class_name
                FROM classes c
                WHERE c.organization_id = $1
                ORDER BY c.class_name ASC`,
        [req.session.organizationId]
      );

      const subjectsResult = await db.query(
        `
          SELECT subject_id, subject_name, class_id
          FROM subjects
          WHERE organization_id = $1
          ORDER BY class_id ASC, subject_name ASC
        `,
        [req.session.organizationId]
      );

      const classMap = classesResult.rows.reduce((map, cls) => {
        map[cls.class_id] = { ...cls, subjects: [] };
        return map;
      }, {});

      subjectsResult.rows.forEach((subject) => {
        if (classMap[subject.class_id]) {
          classMap[subject.class_id].subjects.push(subject);
        }
      });

      const classes = Object.values(classMap);

      const enrolledSubjectsResult = await db.query(
        `
                SELECT us.subject_id
                FROM user_subjects us
                WHERE us.user_id = $1`,
        [userId]
      );
      const enrolledSubjects = enrolledSubjectsResult.rows.map(
        (subject) => subject.subject_id
      );

      const employeeClassesResult = await db.query(
        `
                SELECT class_id
                FROM user_classes
                WHERE user_id = $1`,
        [userId]
      );
      const enrolledClasses = employeeClassesResult.rows.map(
        (cls) => cls.class_id
      );

      res.render("common/modifyEmployee", {
        title: "Modify Employee",
        user,
        classes,
        enrolledClasses,
        enrolledSubjects,
        messages: req.flash(),
      });
    } catch (error) {
      console.error("Error loading modify employee page:", error);
      res.status(500).send("Failed to load employee details.");
    }
  },

  modifyEmployeePost: async (req, res, db) => {
    const { userId } = req.params;
    const {
      firstName,
      lastName,
      email,
      accountType,
      classIds = [],
      subjects = [],
    } = req.body;

    try {
      // ✅ Check if the email is being changed
      const currentUserResult = await db.query(
        "SELECT email FROM users WHERE user_id = $1 AND organization_id = $2",
        [userId, req.session.organizationId]
      );

      if (currentUserResult.rows.length === 0) {
        req.flash("error", "Employee not found.");
        return res.redirect("/common/manageEmployees");
      }

      const currentEmail = currentUserResult.rows[0].email;

      // ✅ If the email is changing, ensure it doesn’t already exist elsewhere
      if (email !== currentEmail) {
        const emailCheckResult = await db.query(
          `
            SELECT user_id FROM users WHERE email = $1
            UNION
            SELECT organization_id FROM organizations WHERE email = $1
          `,
          [email]
        );

        // If it exists and belongs to another user/org
        if (emailCheckResult.rows.length > 0) {
          req.flash(
            "error",
            "Email already in use by another user or organization. Please use a different email."
          );
          return res.redirect(`/common/modifyEmployee?userId=${userId}`);
        }
      }

      // ✅ Update user details
      await db.query(
        `
          UPDATE users
          SET first_name = $1, last_name = $2, email = $3, account_type = $4, updated_at = NOW()
          WHERE user_id = $5 AND organization_id = $6
        `,
        [
          firstName,
          lastName,
          email,
          accountType,
          userId,
          req.session.organizationId,
        ]
      );

      // ✅ Update classes
      await db.query("DELETE FROM user_classes WHERE user_id = $1", [userId]);
      if (Array.isArray(classIds)) {
        for (const classId of classIds) {
          await db.query(
            "INSERT INTO user_classes (user_id, class_id) VALUES ($1, $2)",
            [userId, classId]
          );
        }
      }

      // ✅ Update subjects
      await db.query("DELETE FROM user_subjects WHERE user_id = $1", [userId]);
      if (Array.isArray(subjects)) {
        for (const subjectId of subjects) {
          await db.query(
            "INSERT INTO user_subjects (user_id, subject_id) VALUES ($1, $2)",
            [userId, subjectId]
          );
        }
      }

      req.flash("success", "Employee details updated successfully.");
      res.redirect("/common/manageEmployees");
    } catch (error) {
      console.error("Error updating employee details:", error);
      req.flash("error", "Failed to update employee details.");
      res.redirect(`/common/modifyEmployee?userId=${userId}`);
    }
  },

  assessment: async function (req, res, db) {
    const { classId, subjectId } = req.query;

    if (!classId || !subjectId) {
      return res
        .status(400)
        .send("Class ID and Subject ID are required for the assessment.");
    }

    try {
      const organizationId = req.session.organizationId;

      // Validate `organizationId`
      if (!organizationId) {
        req.flash("error", "Organization ID is missing.");
        return res.redirect("/common/orgDashboard");
      }

      // Fetch the current school year and term
      const currentTermResult = await db.query(
        `
                SELECT t.term_id, t.term_name, t.start_date, t.end_date
                FROM terms t
                JOIN school_years sy ON t.school_year_id = sy.id
                WHERE sy.organization_id = $1 AND sy.current = TRUE AND t.current = TRUE
                LIMIT 1
            `,
        [organizationId]
      );

      if (currentTermResult.rows.length === 0) {
        req.flash("error", "No current school year or term found.");
        return res.redirect("/common/manageRecords");
      }

      const currentTerm = currentTermResult.rows[0];

      // Fetch the class name and subject name
      const classNameResult = await db.query(
        "SELECT class_name FROM classes WHERE class_id = $1 AND organization_id = $2",
        [classId, organizationId]
      );
      const subjectNameResult = await db.query(
        "SELECT subject_name FROM subjects WHERE subject_id = $1 AND organization_id = $2",
        [subjectId, organizationId]
      );

      if (
        classNameResult.rows.length === 0 ||
        subjectNameResult.rows.length === 0
      ) {
        return res.status(404).send("Class or Subject not found.");
      }

      const className = classNameResult.rows[0].class_name;
      const subjectName = subjectNameResult.rows[0].subject_name;

      // Fetch students enrolled in the class for the current term
      const studentsResult = await db.query(
        `
                SELECT s.student_id, s.first_name, s.last_name
                FROM students s
                JOIN enrolled_students es ON s.student_id = es.student_id
                JOIN enrollments e ON es.enrollment_id = e.enrollment_id
                JOIN student_subjects ss ON s.student_id = ss.student_id
                WHERE es.class_id = $1
                  AND e.term_id = $2
                  AND e.organization_id = $3
                  AND ss.subject_id = $4
                  AND s.graduated = FALSE
                ORDER BY s.last_name ASC, s.first_name ASC
            `,
        [classId, currentTerm.term_id, organizationId, subjectId]
      );

      const students = studentsResult.rows;

      if (students.length === 0) {
        req.flash(
          "error",
          `No students found for this class in the current term. Go to 'Enrollment Management' to add student.`
        );
      }

      // Fetch assessments for the class, subject, and term
      const assessmentsResult = await db.query(
        `
                SELECT assessment_id, title, weight, max_score, category
                FROM assessments
                WHERE subject_id = $1 AND class_id = $2 AND organization_id = $3 AND term_id = $4
                ORDER BY assessment_id
            `,
        [subjectId, classId, organizationId, currentTerm.term_id]
      );

      const assessments = assessmentsResult.rows;

      if (assessments.length === 0) {
        req.flash(
          "error",
          "No assessments found for the current term, subject, and class. Go to 'Create & Manage Assessment Scores' to add assessments "
        );
      }

      // Fetch scores and positions for the students in this subject
      const resultsResult = await db.query(
        `
                SELECT ar.assessment_id, ar.student_id, ar.score, ar.total_subject_score, ar.total_percentage, ar.grade,
                       sp.position
                FROM assessment_results ar
                LEFT JOIN student_positions sp
                ON ar.student_id = sp.student_id AND ar.subject_id = sp.subject_id
                WHERE ar.assessment_id IN (
                    SELECT assessment_id
                    FROM assessments
                    WHERE subject_id = $1 AND class_id = $2 AND organization_id = $3 AND term_id = $4
                )
                AND ar.student_id IN (
                    SELECT es.student_id
                    FROM enrolled_students es
                    JOIN enrollments e ON es.enrollment_id = e.enrollment_id
                    WHERE es.class_id = $2 AND e.term_id = $4 AND e.organization_id = $3
                )
                ORDER BY ar.student_id, ar.assessment_id
            `,
        [subjectId, classId, organizationId, currentTerm.term_id]
      );

      const results = resultsResult.rows;

      // Organize the scores by student and populate total scores and other details
      const studentScores = {};
      results.forEach((result) => {
        if (!studentScores[result.student_id]) {
          studentScores[result.student_id] = {
            assessments: {},
            total_subject_score: result.total_subject_score,
            total_percentage: result.total_percentage,
            grade: result.grade,
            position: result.position,
          };
        }
        studentScores[result.student_id].assessments[result.assessment_id] =
          result.score;
      });

      students.forEach((student) => {
        student.scores = studentScores[student.student_id]
          ? studentScores[student.student_id].assessments
          : {};
        student.total_subject_score = studentScores[student.student_id]
          ? studentScores[student.student_id].total_subject_score
          : "-";
        student.total_percentage = studentScores[student.student_id]
          ? studentScores[student.student_id].total_percentage
          : "-";
        student.grade = studentScores[student.student_id]
          ? studentScores[student.student_id].grade
          : "-";
        student.position = studentScores[student.student_id]
          ? studentScores[student.student_id].position
          : "-";
      });

      // Fetch employees assigned to the class
      const employeesResult = await db.query(
        `
                SELECT u.first_name, u.last_name, uc.main
                FROM user_classes uc
                JOIN users u ON uc.user_id = u.user_id
                WHERE uc.class_id = $1 AND u.organization_id = $2
            `,
        [classId, organizationId]
      );

      const employees = employeesResult.rows;

      // Render the assessment page
      res.render("common/assessment", {
        title: "Assessment",
        classId,
        className,
        subjectId,
        subjectName,
        currentTerm,
        assessments,
        students,
        employees,
        messages: req.flash(),
      });
    } catch (err) {
      console.error("Error fetching assessment data:", err);
      res.status(500).send("Error fetching assessment data.");
    }
  },

  updateStudentPositions: async function (
    db,
    subjectId,
    organizationId,
    classId,
    termId
  ) {
    const updateQuery = `
            WITH RankedScores AS (
                SELECT
                    student_id,
                    subject_id,
                    SUM(score) AS total_subject_score,
                    RANK() OVER (PARTITION BY subject_id ORDER BY SUM(score) DESC) AS position
                FROM assessment_results
                WHERE subject_id = $1 AND organization_id = $2
                GROUP BY student_id, subject_id
            )
            INSERT INTO student_positions (student_id, subject_id, organization_id, total_subject_score, position, class_id, term_id)
            SELECT 
                rs.student_id,
                rs.subject_id,
                $2,
                rs.total_subject_score,
                rs.position,
                $3,
                $4
            FROM RankedScores rs
            ON CONFLICT (student_id, subject_id) DO UPDATE
            SET 
                total_subject_score = EXCLUDED.total_subject_score,
                position = EXCLUDED.position,
                class_id = EXCLUDED.class_id,
                term_id = EXCLUDED.term_id;
        `;

    try {
      await db.query(updateQuery, [subjectId, organizationId, classId, termId]);
    } catch (error) {
      console.error("Error updating student positions:", error);
      throw error;
    }
  },

  saveAllScores: async function (req, res, db) {
    const { subjectId, classId } = req.query;
    const { scores } = req.body;

    if (!subjectId || !classId) {
      res.status(400).send("Subject ID and Class ID are required.");
      return;
    }

    const organizationId = req.session.organizationId;

    try {
      // Fetch the current term for the given class
      const termResult = await db.query(
        `
                SELECT t.term_id
                FROM terms t
                JOIN classes c ON t.organization_id = c.organization_id
                WHERE c.class_id = $1 AND t.organization_id = $2 AND t.current = TRUE
                LIMIT 1
            `,
        [classId, organizationId]
      );

      if (termResult.rows.length === 0) {
        res.status(404).send("No current term found for this class.");
        return;
      }

      const currentTermId = termResult.rows[0].term_id;

      await db.query("BEGIN");

      // Insert or update scores for each student
      for (let studentId in scores) {
        let totalScore = 0;
        let maxTotalScore = 0; // Maximum possible score
        const categoryScoresMap = {}; // To store total scores for each category

        for (let assessmentId in scores[studentId]) {
          let score = scores[studentId][assessmentId];
          if (score === null || score === "") continue;

          // Fetch the assessment weight, max score, and category for calculations
          const assessmentResult = await db.query(
            `SELECT weight, max_score, category FROM assessments WHERE assessment_id = $1`,
            [assessmentId]
          );

          if (assessmentResult.rows.length > 0) {
            const { weight, max_score, category } = assessmentResult.rows[0];

            totalScore += parseFloat(score);
            maxTotalScore += parseFloat(max_score);

            // Insert or update the score in the assessment_results table
            await db.query(
              `
                            INSERT INTO assessment_results (student_id, assessment_id, score, subject_id, term_id, organization_id, class_id, category)
                            VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
                            ON CONFLICT (student_id, assessment_id)
                            DO UPDATE SET 
                                score = EXCLUDED.score,
                                term_id = EXCLUDED.term_id,
                                subject_id = EXCLUDED.subject_id,
                                organization_id = EXCLUDED.organization_id,
                                class_id = EXCLUDED.class_id,
                                category = EXCLUDED.category
                        `,
              [
                studentId,
                assessmentId,
                score,
                subjectId,
                currentTermId,
                organizationId,
                classId,
                category,
              ]
            );

            // Update categoryScoresMap for each category
            if (!categoryScoresMap[category]) {
              categoryScoresMap[category] = 0;
            }
            categoryScoresMap[category] += parseFloat(score);
          }
        }

        // Calculate total percentage based on the scores achieved vs. the maximum possible score
        const totalPercentage =
          maxTotalScore > 0 ? (totalScore / maxTotalScore) * 100 : null;

        // Calculate grade
        const grade =
          totalPercentage !== null ? this.calculateGrade(totalPercentage) : "-";

        // Save total_subject_score, total_percentage, and grade in assessment_results table
        await db.query(
          `
                    UPDATE assessment_results
                    SET total_subject_score = $1,
                        total_percentage = $2,
                        grade = $3
                    WHERE student_id = $4 AND subject_id = $5 AND term_id = $6 AND class_id = $7
                `,
          [
            totalScore,
            totalPercentage,
            grade,
            studentId,
            subjectId,
            currentTermId,
            classId,
          ]
        );

        // Insert or update category scores in the category_scores table
        for (let category in categoryScoresMap) {
          const totalCategoryScore = categoryScoresMap[category];

          await db.query(
            `
                        INSERT INTO category_scores (student_id, class_id, subject_id, organization_id, category, total_score, term_id)
                        VALUES ($1, $2, $3, $4, $5, $6, $7)
                        ON CONFLICT (student_id, class_id, subject_id, organization_id, category, term_id)
                        DO UPDATE SET 
                            total_score = EXCLUDED.total_score
                    `,
            [
              studentId,
              classId,
              subjectId,
              organizationId,
              category,
              totalCategoryScore,
              currentTermId,
            ]
          );
        }
      }

      // Update student positions after scores are updated
      await this.updateStudentPositions(
        db,
        subjectId,
        organizationId,
        classId,
        currentTermId
      );

      await db.query("COMMIT");
      req.flash("success", "Scores and grades saved successfully.");
      res
        .status(200)
        .json({ success: true, message: "Scores saved successfully." });
    } catch (error) {
      await db.query("ROLLBACK");
      console.error("Error saving scores:", error);
      req.flash(
        "error",
        "An error occurred while saving scores. Please try again."
      );
      res.status(500).json({
        error: "An error occurred while saving scores. Please try again.",
      });
    }
  },

  calculateGrade: function (totalPercentage) {
    if (totalPercentage === "-" || isNaN(totalPercentage)) return "-";
    if (totalPercentage >= 90) return "A";
    if (totalPercentage >= 80) return "B";
    if (totalPercentage >= 70) return "C";
    if (totalPercentage >= 60) return "D";
    return "F";
  },

  calculateTotalPercentage: (scores, assessments) => {
    let totalWeightedScore = 0;
    let totalWeight = 0;
    let hasScore = false;

    assessments.forEach((assessment) => {
      const score = scores ? scores[assessment.assessment_id] : null;
      let scorePercentage = 100; // Default to 100% if no score is present

      if (score !== null && score !== undefined) {
        hasScore = true;
        scorePercentage = (score / assessment.max_score) * 100; // Calculate the percentage score
      }

      const weightedScore = (scorePercentage / 100) * assessment.weight; // Scale by the test's weight
      totalWeightedScore += weightedScore;
      totalWeight += assessment.weight;
    });

    if (!hasScore) {
      return "-"; // No score entered for any test
    }

    const scaledTotalPercentage = totalWeight > 0 ? totalWeightedScore : "-";
    return scaledTotalPercentage;
  },

  calculateGrade: (totalPercentage) => {
    if (totalPercentage === "-" || isNaN(totalPercentage)) return "-";
    if (totalPercentage >= 90) return "A";
    if (totalPercentage >= 80) return "B";
    if (totalPercentage >= 70) return "C";
    if (totalPercentage >= 60) return "D";
    return "F";
  },

  getAssessments: async (req, res, db) => {
    const { classId, subjectId } = req.query;

    try {
      const result = await db.query(
        "SELECT * FROM assessments WHERE class_id = $1 AND subject_id = $2 AND organization_id = $3 ORDER BY assessment_id ASC",
        [classId, subjectId, req.session.organizationId]
      );
      res.json(result.rows);
    } catch (error) {
      console.error("Error fetching assessments:", error);
      res.status(500).send("Failed to fetch assessments");
    }
  },

  getScores: async (req, res, db) => {
    const { classId, subjectId } = req.query;

    try {
      const result = await db.query(
        `
                SELECT ar.student_id, ar.assessment_id, ar.score, s.first_name, s.last_name
                FROM assessment_results ar
                JOIN students s ON ar.student_id = s.student_id
                JOIN assessments a ON ar.assessment_id = a.assessment_id
                WHERE a.class_id = $1 AND a.subject_id = $2 AND s.organization_id = $3
                ORDER BY ar.assessment_id ASC, s.student_id ASC`,
        [classId, subjectId, req.session.organizationId]
      );

      res.json(result.rows);
    } catch (error) {
      console.error("Error fetching scores:", error);
      res.status(500).send("Failed to fetch scores");
    }
  },

  manageAssessment: async (req, res, db) => {
    let { organizationId, termId } = req.query;

    if (!organizationId) {
      organizationId = req.session.organizationId;
    }

    if (!termId) {
      termId = req.session.termId;
    }

    // Validate incoming organizationId and termId
    if (!organizationId || !termId) {
      req.flash("error", "Organization ID and Term ID are required.");
      return res.status(400).send("Organization ID and Term ID are required.");
    }

    organizationId = parseInt(organizationId, 10);
    termId = parseInt(termId, 10);

    if (isNaN(organizationId) || isNaN(termId)) {
      req.flash("error", "Invalid Organization ID or Term ID.");
      return res.status(400).send("Invalid Organization ID or Term ID.");
    }

    try {
      // Fetch assessments with their associated classes and subjects, grouped by group_id
      const assessmentsQuery = `
                SELECT a.group_id, a.title, a.weight, a.max_score, a.category, a.term_id, 
                       c.class_id, c.class_name, s.subject_name
                FROM assessments a
                LEFT JOIN classes c ON a.class_id = c.class_id
                LEFT JOIN subjects s ON a.subject_id = s.subject_id
                WHERE a.organization_id = $1 AND a.term_id = $2
                ORDER BY a.group_id, c.class_id, s.subject_name
            `;
      const assessmentsResult = await db.query(assessmentsQuery, [
        organizationId,
        termId,
      ]);

      // Group classes and subjects under each assessment group
      const assessmentsMap = {};
      for (let row of assessmentsResult.rows) {
        const groupId = row.group_id;

        if (!assessmentsMap[groupId]) {
          assessmentsMap[groupId] = {
            group_id: groupId,
            title: row.title,
            weight: row.weight,
            max_score: row.max_score,
            category: row.category,
            term_id: row.term_id,
            assigned_classes: {},
          };
        }

        if (!assessmentsMap[groupId].assigned_classes[row.class_id]) {
          assessmentsMap[groupId].assigned_classes[row.class_id] = {
            class_id: row.class_id,
            class_name: row.class_name,
            subjects: [],
          };
        }

        assessmentsMap[groupId].assigned_classes[row.class_id].subjects.push(
          row.subject_name
        );
      }

      // Convert the map into an array for easier rendering in EJS
      const assessments = Object.values(assessmentsMap).map((assessment) => {
        return {
          ...assessment,
          assigned_classes: Object.values(assessment.assigned_classes),
        };
      });

      res.render("common/manageAssessment", {
        title: "Manage Assessments",
        organizationId,
        termId,
        assessments,
        messages: req.flash(),
      });
    } catch (err) {
      console.error("Error fetching manage assessment data:", err);
      req.flash("error", "Failed to load manage assessment data.");
      res.status(500).send("Error fetching manage assessment data.");
    }
  },

  modifyAssessmentGet: async (req, res, db) => {
    const { organizationId } = req.session;
    const { termId, groupId } = req.query;

    if (!organizationId || !termId || !groupId) {
      req.flash("error", "Missing required parameters.");
      return res.redirect("/common/manageAssessment");
    }

    try {
      // Fetch assessment details for the group
      const assessmentQuery = `
                SELECT title, weight, max_score, category
                FROM assessments
                WHERE group_id = $1 AND organization_id = $2 AND term_id = $3
                LIMIT 1
            `;
      const assessmentResult = await db.query(assessmentQuery, [
        groupId,
        organizationId,
        termId,
      ]);
      const assessment = assessmentResult.rows[0];

      if (!assessment) {
        req.flash("error", "Assessment not found.");
        return res.redirect("/common/manageAssessment");
      }

      // Fetch enrolled classes for the term
      const enrolledClassesQuery = `
                SELECT c.class_id, c.class_name,
                       EXISTS (
                           SELECT 1 FROM assessments a
                           WHERE a.group_id = $1 AND a.class_id = c.class_id
                       ) AS selected
                FROM enrolled_classes ec
                INNER JOIN classes c ON ec.class_id = c.class_id
                WHERE ec.enrollment_id = (
                    SELECT enrollment_id
                    FROM enrollments
                    WHERE term_id = $2 AND organization_id = $3
                    LIMIT 1
                )
                ORDER BY c.class_name
            `;
      const classesResult = await db.query(enrolledClassesQuery, [
        groupId,
        termId,
        organizationId,
      ]);
      const classes = classesResult.rows;

      // Fetch subjects linked to the organization
      const subjectsQuery = `
                SELECT s.subject_id, s.subject_name, s.class_id,
                       EXISTS (
                           SELECT 1 FROM assessments a
                           WHERE a.group_id = $1 AND a.subject_id = s.subject_id
                       ) AS selected
                FROM subjects s
                WHERE s.organization_id = $2
                ORDER BY s.subject_name
            `;
      const subjectsResult = await db.query(subjectsQuery, [
        groupId,
        organizationId,
      ]);
      const subjects = subjectsResult.rows;

      res.render("common/modifyAssessment", {
        title: "Modify Assessment",
        assessment,
        classes,
        subjects,
        organizationId,
        termId,
        groupId,
        messages: req.flash(),
      });
    } catch (error) {
      console.error("Error fetching data for modifyAssessment:", error);
      req.flash("error", "Failed to load assessment details.");
      res.redirect("/common/manageAssessment");
    }
  },

  modifyAssessmentPost: async (req, res, db) => {
    const {
      organizationId,
      termId,
      groupId,
      testName,
      testWeight,
      maxScore,
      category,
      classes = [],
      subjects = [],
    } = req.body;

    // Validate required fields
    if (
      !organizationId ||
      !termId ||
      !groupId ||
      !testName ||
      !testWeight ||
      !maxScore ||
      !category
    ) {
      console.error("Modify Assessment - Missing required fields.");
      return res
        .status(400)
        .json({ error: "Organization ID and Term ID are required." });
    }

    const client = await db.connect();

    try {
      await client.query("BEGIN"); // Start transaction

      // Update the assessment group details
      const updateGroupQuery = `
            UPDATE assessments
            SET title = $1, weight = $2, max_score = $3, category = $4
            WHERE group_id = $5 AND organization_id = $6 AND term_id = $7
        `;
      await client.query(updateGroupQuery, [
        testName,
        testWeight,
        maxScore,
        category,
        groupId,
        organizationId,
        termId,
      ]);

      // Remove all existing entries for this group to prepare for re-insertion
      const deleteExistingQuery = `
            DELETE FROM assessments
            WHERE group_id = $1 AND organization_id = $2 AND term_id = $3
        `;
      await client.query(deleteExistingQuery, [
        groupId,
        organizationId,
        termId,
      ]);

      // Add the updated classes and subjects
      for (const cls of classes) {
        const clsSubjects = subjects.filter((subject) =>
          subject.startsWith(cls + "-")
        );

        for (const subject of clsSubjects) {
          const [, subjectId] = subject.split("-");

          const insertQuery = `
                    INSERT INTO assessments (
                        group_id, title, weight, max_score, category, subject_id, organization_id, term_id, class_id
                    ) VALUES (
                        $1, $2, $3, $4, $5, $6, $7, $8, $9
                    )
                    ON CONFLICT ON CONSTRAINT unique_test_per_term_class_subject DO NOTHING
                `;
          await client.query(insertQuery, [
            groupId,
            testName,
            testWeight,
            maxScore,
            category,
            subjectId,
            organizationId,
            termId,
            cls,
          ]);
        }
      }

      // Fetch term name
      const termQuery = `SELECT term_name FROM terms WHERE term_id = $1`;
      const termResult = await client.query(termQuery, [termId]);
      const termName = termResult.rows[0]?.term_name || "Unknown Term";

      // Fetch class names
      const classQuery = `
            SELECT class_name
            FROM classes
            WHERE class_id = ANY($1::int[])
            ORDER BY class_name
        `;
      const classResult = await client.query(classQuery, [classes]);
      const classNames = classResult.rows.map((row) => row.class_name);

      await client.query("COMMIT"); // Commit transaction

      // Respond with the success message
      res.status(200).json({
        message: `Assessment updated successfully for Term: ${termName} with Classes: ${classNames.join(
          ", "
        )}`,
      });
    } catch (error) {
      console.error("Modify Assessment - Error:", error);
      await client.query("ROLLBACK"); // Rollback transaction
      res
        .status(500)
        .json({ error: "Failed to update assessment. Please try again." });
    } finally {
      client.release();
    }
  },

  // Controller to delete an assessment group
  deleteAssessmentPost: async (req, res, db) => {
    const { groupId } = req.body;

    if (!groupId) {
      return res.status(400).json({ error: "Group ID is required." });
    }

    const client = await db.connect();

    try {
      await client.query("BEGIN"); // Start a transaction

      // Delete all assessments associated with the given group ID
      await client.query(
        `DELETE FROM assessments
             WHERE group_id = $1`,
        [groupId]
      );

      await client.query("COMMIT"); // Commit the transaction
      res
        .status(200)
        .json({ message: "Assessment group deleted successfully." });
    } catch (err) {
      await client.query("ROLLBACK"); // Rollback transaction on error
      console.error("Error deleting assessment group:", err);
      res.status(500).json({ error: "Failed to delete assessment group." });
    } finally {
      client.release();
    }
  },

  createTestGet: async (req, res, db) => {
    const { organizationId } = req.session;
    const { termId: urlTermId } = req.query;

    if (!organizationId) {
      req.flash("error", "Organization ID is required.");
      return res.redirect("/common/orgDashboard");
    }

    try {
      // Fetch the current term for the organization
      const termQuery = `
        SELECT term_id, term_name 
        FROM terms 
        WHERE organization_id = $1 AND (current = TRUE OR (start_date <= NOW() AND end_date >= NOW()))
        ORDER BY current DESC, start_date DESC LIMIT 1
    `;

      const termResult = await db.query(termQuery, [organizationId]);

      if (termResult.rows.length === 0) {
        req.flash(
          "error",
          "No active term found for the organization. Please create or set a term to be able to create & manage assessment scores"
        );
        return res.redirect("/common/manageRecords");
      }

      // Assign termId either from URL or the fetched current term
      const currentTerm = termResult.rows[0];
      const termId = urlTermId || currentTerm.term_id;

      // Fetch enrolled classes for the organization
      const enrolledClassesQuery = `
            SELECT c.class_id, c.class_name
            FROM enrolled_classes ec
            INNER JOIN classes c ON ec.class_id = c.class_id
            WHERE ec.enrollment_id = (
                SELECT enrollment_id 
                FROM enrollments 
                WHERE term_id = $1 AND organization_id = $2
                LIMIT 1
            )
            ORDER BY c.class_name
        `;
      const enrolledClassesResult = await db.query(enrolledClassesQuery, [
        termId,
        organizationId,
      ]);
      const classes = enrolledClassesResult.rows;

      // Fetch subjects associated with the organization
      const subjectsResult = await db.query(
        `SELECT * FROM subjects WHERE organization_id = $1 ORDER BY subject_name`,
        [organizationId]
      );
      const subjects = subjectsResult.rows;

      // Render the createTest view with enrolled classes only
      res.render("common/createTest", {
        title: "Add New Test",
        classes, // Only enrolled classes
        subjects,
        organizationId,
        termId,
        currentTerm,
        messages: req.flash(),
      });
    } catch (error) {
      req.flash("error", "Failed to load create test form.");
      console.error("Error fetching create test form data:", error);
      res.redirect(
        `/common/createTest?organizationId=${organizationId}&termId=${urlTermId}`
      );
    }
  },

  createTestPost: async (req, res, db) => {
    const { organizationId, termId: formTermId, tests } = req.body;

    if (!organizationId || !formTermId) {
      return res
        .status(400)
        .json({ error: "Organization ID and Term ID are required." });
    }

    const client = await db.connect();

    try {
      await client.query("BEGIN"); // Start a transaction

      // Track the classes for which tests were added
      const addedClasses = new Set();

      for (const test of tests) {
        const selectedClasses = test.classes;
        const selectedSubjects = test.subjects;

        if (
          !selectedClasses ||
          !selectedSubjects ||
          selectedClasses.length === 0 ||
          selectedSubjects.length === 0
        ) {
          throw new Error("At least one Class ID and Subject ID are required.");
        }

        // Generate a unique group ID for this form's assessments
        const groupIdResult = await client.query(
          `SELECT nextval('assessments_group_id_seq') AS next_group_id`
        );
        const newGroupId = groupIdResult.rows[0].next_group_id;

        for (let cls of selectedClasses) {
          addedClasses.add(cls); // Track the class ID
          const subjectsForClass = selectedSubjects.filter((subject) => {
            const subjectClassId = subject.split("-")[0];
            return subjectClassId == cls;
          });

          for (let subject of subjectsForClass) {
            const [, subj] = subject.split("-");

            // Insert the test while allowing duplicate names for different subjects or terms
            const insertAssessmentQuery = `
                        INSERT INTO assessments (
                            group_id, title, weight, max_score, category, subject_id, organization_id, term_id, class_id
                        ) VALUES (
                            $1, $2, $3, $4, $5, $6, $7, $8, $9
                        )
                        ON CONFLICT (class_id, subject_id, title, term_id) DO NOTHING
                    `;
            await client.query(insertAssessmentQuery, [
              newGroupId,
              test.testName,
              test.testWeight,
              test.maxScore,
              test.category,
              subj,
              organizationId,
              formTermId,
              cls,
            ]);
          }
        }
      }

      // Fetch term name
      const termQuery = `SELECT term_name FROM terms WHERE term_id = $1`;
      const termResult = await client.query(termQuery, [formTermId]);
      const termName = termResult.rows[0]?.term_name || "Unknown Term";

      // Fetch class names
      const classQuery = `
            SELECT class_name
            FROM classes
            WHERE class_id = ANY($1::int[])
            ORDER BY class_name
        `;
      const classResult = await client.query(classQuery, [
        Array.from(addedClasses),
      ]);
      const classNames = classResult.rows.map((row) => row.class_name);

      await client.query("COMMIT"); // Commit the transaction

      // Respond with the success message
      res.status(200).json({
        message: `Tests added successfully to Term: ${termName} for Classes: ${classNames.join(
          ", "
        )}`,
      });
    } catch (error) {
      await client.query("ROLLBACK");
      console.error("Error adding tests:", error);
      res.status(400).json({ error: `Failed to add tests. ${error.message}` });
    } finally {
      client.release();
    }
  },

  deleteEmployee: async (req, res, db) => {
    const { userId } = req.params;

    if (!userId) {
      return res.status(400).send("User ID is required.");
    }

    try {
      await db.query("DELETE FROM user_classes WHERE user_id = $1", [userId]);
      await db.query("DELETE FROM user_subjects WHERE user_id = $1", [userId]);
      await db.query(
        "DELETE FROM users WHERE user_id = $1 AND organization_id = $2",
        [userId, req.session.organizationId]
      );

      req.flash("success", "Employee deleted successfully.");
      res.redirect("/common/manageEmployees");
    } catch (error) {
      console.error("Error deleting employee:", error);
      req.flash("error", "Failed to delete employee.");
      res.redirect("/common/manageEmployees");
    }
  },

  classDashboard: async (req, res, db, csrfToken) => {
    const classId = req.query.classId;
    if (!classId) {
      res.redirect("/common/orgDashboard");
      return;
    }

    try {
      const organizationId = req.session.organizationId;
      const currentUserRole = req.session.userRole;
      const currentUserId = req.session.user ? req.session.user.user_id : null;

      // Fetch the current school year and term
      const schoolYearResult = await db.query(
        `
            SELECT sy.id as school_year_id, sy.year_label, t.term_id, t.term_name, t.start_date, t.end_date, t.current
            FROM school_years sy
            LEFT JOIN terms t ON sy.id = t.school_year_id
            WHERE sy.organization_id = $1 AND sy.current = TRUE
            ORDER BY t.start_date
            `,
        [organizationId]
      );

      let schoolYear = null;
      let currentTerm = null;

      if (schoolYearResult.rows.length > 0) {
        schoolYear = {
          id: schoolYearResult.rows[0].school_year_id,
          year_label: schoolYearResult.rows[0].year_label,
          terms: schoolYearResult.rows.map((row) => ({
            term_id: row.term_id,
            term_name: row.term_name,
            start_date: row.start_date,
            end_date: row.end_date,
            current: row.current,
          })),
        };

        // Find the current term
        currentTerm = schoolYearResult.rows.find((row) => row.current);
      }

      // If no current term is found, redirect to the org dashboard
      if (!currentTerm) {
        req.flash("error", "No current term found.");
        return res.redirect("/common/orgDashboard");
      }

      // Fetch class details
      const classResult = await db.query(
        `
            SELECT c.class_name, g.name as graduation_year_group_name
            FROM classes c
            LEFT JOIN graduation_year_groups g ON c.graduation_year_group_id = g.id
            WHERE c.class_id = $1 AND c.organization_id = $2
            `,
        [classId, organizationId]
      );

      if (classResult.rows.length === 0) {
        console.error("Class details not found");
        return res
          .status(500)
          .send("Error fetching class details or class not found");
      }

      const className = classResult.rows[0].class_name;
      const graduationYearGroupName =
        classResult.rows[0].graduation_year_group_name;

      // Fetch students enrolled in the current term for this class
      const studentsResult = await db.query(
        `
            SELECT s.student_id, s.first_name, s.last_name
            FROM enrolled_students es
            INNER JOIN students s ON es.student_id = s.student_id
            INNER JOIN enrollments e ON es.enrollment_id = e.enrollment_id
            WHERE es.class_id = $1
              AND e.term_id = $2
              AND e.school_year_id = $3
              AND e.organization_id = $4
              AND s.graduated = FALSE
            ORDER BY s.last_name, s.first_name
            `,
        [classId, currentTerm.term_id, schoolYear.id, organizationId]
      );

      const students = studentsResult.rows;

      // **Fetch subjects for this class**
      let subjectsResult;
      if (currentUserRole === "Teacher") {
        subjectsResult = await db.query(
          `
                SELECT s.subject_id, s.subject_name
                FROM user_subjects us
                INNER JOIN subjects s ON us.subject_id = s.subject_id
                WHERE us.user_id = $1 AND s.class_id = $2 AND s.organization_id = $3
                ORDER BY s.subject_name
                `,
          [currentUserId, classId, organizationId]
        );
      } else {
        subjectsResult = await db.query(
          `
                SELECT subject_id, subject_name
                FROM subjects
                WHERE class_id = $1 AND organization_id = $2
                ORDER BY subject_name
                `,
          [classId, organizationId]
        );
      }
      // Fetch the main teacher assigned to the class
      const mainTeacherResult = await db.query(
        `
  SELECT user_id 
  FROM user_classes 
  WHERE class_id = $1 AND main = TRUE
  `,
        [classId]
      );

      const mainTeacherId =
        mainTeacherResult.rows.length > 0
          ? mainTeacherResult.rows[0].user_id
          : null;
      const isMainTeacher = currentUserId === mainTeacherId;

      // Fetch employees associated with the class
      const employees = await getClassEmployeesWithMain(db, classId);

      // Render the classDashboard view with the updated context
      res.render("common/classDashboard", {
        title: `Class Dashboard - ${className}`,
        className: className,
        graduationYearGroup: graduationYearGroupName,
        students: students,
        subjects: subjectsResult.rows, // Assigned subjects for teacher, all subjects for others
        classId: classId,
        employees: employees,
        attendanceLink: `/common/attendanceCollection?classId=${classId}`,
        schoolYear,
        currentTerm,
        messages: req.flash(),
        csrfToken: csrfToken,
        isMainTeacher: isMainTeacher,
      });
    } catch (err) {
      console.error("🚨 Error fetching class dashboard data:", err);
      res.status(500).send("Error loading class dashboard");
    }
  },

  setMainEmployee: async (req, res, db) => {
    const { class_id, main_employee } = req.body;
    try {
      await db.query("BEGIN");
      await db.query(
        "UPDATE user_classes SET main = FALSE WHERE class_id = $1",
        [class_id]
      );
      await db.query(
        "UPDATE user_classes SET main = TRUE WHERE class_id = $1 AND user_id = $2",
        [class_id, main_employee]
      );
      await db.query("COMMIT");
      res.json({ success: true, message: "Main employee set successfully." });
    } catch (error) {
      await db.query("ROLLBACK");
      console.error("Error setting main employee:", error);
      res
        .status(500)
        .json({ success: false, message: "Failed to set main employee." });
    }
  },

  registerSchoolYear: async (req, res, db) => {
    const { schoolYear, terms } = req.body;

    const dup = await db.query(
      `SELECT 1
         FROM school_years
        WHERE year_label = $1
          AND organization_id = $2`,
      [schoolYear, req.session.organizationId]
    );
    if (dup.rowCount) {
      req.flash("error", "A school year with that label already exists.");
      // re-load classes so we can re-render the form
      const classesResult = await db.query(
        `SELECT class_id, class_name
           FROM classes
          WHERE organization_id = $1
          ORDER BY class_name`,
        [req.session.organizationId]
      );
      return res.render("common/registerSchoolYear", {
        title: "Register School Year",
        classes: classesResult.rows,
        messages: req.flash(),
        oldSchoolYear: schoolYear,
        oldTerms: terms,
        // oldCurrent: isCurrent,
      });
    }

    // ——— 1) Validation: require at least one term ———
    if (!terms || (Array.isArray(terms) && terms.length === 0)) {
      req.flash(
        "error",
        "Please add at least one term before registering the school year."
      );
      // reload classes for the form
      const classesResult = await db.query(
        "SELECT class_id, class_name FROM classes WHERE organization_id=$1 ORDER BY class_name",
        [req.session.organizationId]
      );
      return res.render("common/registerSchoolYear", {
        title: "Register School Year",
        classes: classesResult.rows,
        messages: req.flash(),
        // (optional) you can pass oldSchoolYear back as well, if you’ve wired up
        // your view to prefill it:
        oldSchoolYear: schoolYear,
      });
    }
    try {
      // Insert the new school year into the database
      const yearResult = await db.query(
        "INSERT INTO school_years (year_label, organization_id) VALUES ($1, $2) RETURNING id",
        [schoolYear, req.session.organizationId]
      );
      const schoolYearId = yearResult.rows[0].id;

      // Loop through each term to insert into the database
      for (const term of terms) {
        const termResult = await db.query(
          "INSERT INTO terms (term_name, start_date, end_date, school_year_id, organization_id) VALUES ($1, $2, $3, $4, $5) RETURNING term_id",
          [
            term.termName,
            term.startDate,
            term.endDate,
            schoolYearId,
            req.session.organizationId,
          ]
        );
        const termId = termResult.rows[0].term_id;

        // Check if selectedClasses exists and is an array
        if (Array.isArray(term.selectedClasses)) {
          // Insert each selected class for the term
          for (const classId of term.selectedClasses) {
            await db.query(
              "INSERT INTO term_classes (term_id, class_id, organization_id) VALUES ($1, $2, $3)",
              [termId, classId, req.session.organizationId]
            );
          }
        } else {
          console.warn(`No classes selected for term ${term.termName}`);
        }
      }

      // Add success flash message
      req.flash(
        "success",
        'School year saved successfully. To make this the active current school year, select "Set as Current" beside the school year and one of its terms to activate it.'
      );

      // Redirect to the manageRecords page upon successful insertion
      res.redirect("/common/manageRecords");
    } catch (error) {
      console.error("Error registering school year:", error);
      req.flash("error", "Error registering school year.");
      res.redirect("/common/manageRecords");
    }
  },

  registerSchoolYearGet: async (req, res, db) => {
    // Add this method
    try {
      // Fetch all classes for the organization
      const classesResult = await db.query(
        "SELECT class_id, class_name FROM classes WHERE organization_id = $1 ORDER BY class_name ASC",
        [req.session.organizationId]
      );

      res.render("common/registerSchoolYear", {
        title: "Register School Year",
        classes: classesResult.rows, // Pass classes to the view
        messages: req.flash(),
      });
    } catch (error) {
      console.error("Error loading register school year page:", error);
      req.flash(
        "error",
        "Failed to load the form for registering a school year."
      );
      res.redirect("/common/manageRecords");
    }
  },

  getClasses: async (req, res, db) => {
    try {
      const result = await db.query(
        "SELECT class_id, class_name FROM classes WHERE organization_id = $1 ORDER BY class_name ASC",
        [req.session.organizationId]
      );
      res.json(result.rows);
    } catch (error) {
      console.error("Error fetching classes:", error);
      res.status(500).json({ error: "Failed to load classes." });
    }
  },

  registerSchoolYearEvent: async (req, res, db) => {
    try {
      await db.query(
        "INSERT INTO school_events (name, event_date, details, organization_id, visibility) VALUES ($1, $2, $3, $4, $5)",
        [
          req.body.eventName,
          req.body.startDate,
          req.body.eventDetails,
          req.session.organizationId,
          req.body.visibility,
        ]
      );
      res.redirect("/common/manageRecords");
    } catch (error) {
      console.error("Error adding event:", error);
      res.status(500).send("Error processing your request");
    }
  },

  registerSchoolYearAnnouncement: async (req, res, db) => {
    try {
      await db.query(
        "INSERT INTO announcements (message, organization_id, visibility) VALUES ($1, $2, $3)",
        [req.body.announcement, req.session.organizationId, req.body.visibility]
      );
      res.redirect("/common/manageRecords");
    } catch (error) {
      console.error("Error posting announcement:", error);
      res.status(500).send("Error processing your request");
    }
  },

  getSchoolYearsData: async (db, organizationId) => {
    const schoolYearsResult = await db.query(
      "SELECT * FROM school_years WHERE organization_id = $1 ORDER BY created_at DESC",
      [organizationId]
    );
    const schoolYears = schoolYearsResult.rows;

    for (const year of schoolYears) {
      const termsResult = await db.query(
        "SELECT * FROM terms WHERE year_id = $1 AND organization_id = $2 ORDER BY start_date",
        [year.id, organizationId]
      );
      const terms = termsResult.rows;

      for (const term of terms) {
        const termClassesResult = await db.query(
          `SELECT tc.class_id, c.class_name 
                     FROM term_classes tc
                     JOIN classes c ON tc.class_id = c.class_id
                     WHERE tc.term_id = $1`,
          [term.term_id]
        );
        term.class_ids = termClassesResult.rows.map((row) => row.class_id);
        term.classes = termClassesResult.rows;
      }
      year.terms = terms;
    }
    return schoolYears;
  },

  manageRecords: async (req, res, db) => {
    try {
      const schoolYearsResult = await db.query(
        "SELECT * FROM school_years WHERE organization_id = $1 ORDER BY current DESC, id ASC",
        [req.session.organizationId]
      );
      const termsResult = await db.query(
        `
                SELECT t.*, array_agg(tc.class_id) AS class_ids
                FROM terms t
                LEFT JOIN term_classes tc ON t.term_id = tc.term_id
                WHERE t.organization_id = $1
                GROUP BY t.term_id
            `,
        [req.session.organizationId]
      );
      const classesResult = await db.query(
        "SELECT * FROM classes WHERE organization_id = $1",
        [req.session.organizationId]
      );
      const eventsResult = await db.query(
        "SELECT * FROM school_events WHERE organization_id = $1",
        [req.session.organizationId]
      );
      const announcementsResult = await db.query(
        "SELECT * FROM announcements WHERE organization_id = $1",
        [req.session.organizationId]
      );

      // Attach classes to each term and map them to school years
      const schoolYears = schoolYearsResult.rows.map((schoolYear) => {
        const terms = termsResult.rows
          .filter((term) => term.school_year_id === schoolYear.id)
          .map((term) => ({
            ...term,
            class_ids: term.class_ids || [], // Ensure class_ids is present and defaults to an empty array if none
          }));
        return { ...schoolYear, terms };
      });

      // Pass messages to the view
      res.render("common/manageRecords", {
        title: "Manage Records",
        schoolYears,
        classes: classesResult.rows,
        events: eventsResult.rows,
        announcements: announcementsResult.rows,
        messages: {
          success: req.flash("success"),
          error: req.flash("error"),
        },
      });
    } catch (error) {
      console.error("Error fetching data:", error);
      req.flash("error", "Error loading manage records page.");
      res.redirect("/common/manageRecords");
    }
  },

  updateSchoolYearAndTerms: async (req, res, db) => {
    const {
      yearId,
      year_label,
      currentYear,
      termIds = [],
      termNames = [],
      startDates = [],
      endDates = [],
      currentTerm = [],
      termClasses = [],
    } = req.body;
    const { organizationId } = req.session;

    try {
      // Validate current term selection if current year is set
      if (currentYear && (!currentTerm || currentTerm.length === 0)) {
        req.flash(
          "error",
          "School year cannot be set as current because no term is selected. Please select a term."
        );
        return res.redirect("/common/manageRecords");
      }

      // ✅ Explicitly ensure yearId is a single value
      const yearIdInt = Array.isArray(yearId)
        ? parseInt(yearId[0], 10)
        : parseInt(yearId, 10);

      await db.query("BEGIN");

      // Update school year label
      await db.query(
        "UPDATE school_years SET year_label = $1 WHERE id = $2 AND organization_id = $3",
        [year_label, yearIdInt, organizationId]
      );

      // Mark current year
      if (currentYear) {
        await db.query(
          "UPDATE school_years SET current = FALSE WHERE organization_id = $1",
          [organizationId]
        );
        await db.query(
          "UPDATE school_years SET current = TRUE WHERE id = $1 AND organization_id = $2",
          [yearIdInt, organizationId]
        );
      }

      for (let i = 0; i < termNames.length; i++) {
        // ✅ Sanitize term ID
        const rawTermId = termIds[i];
        const termIdInt = rawTermId
          ? parseInt(Array.isArray(rawTermId) ? rawTermId[0] : rawTermId, 10)
          : null;

        const termName = termNames[i];
        const startDate = startDates[i];
        const endDate = endDates[i];

        // ✅ Check if current term for this term
        const termIdStr = termIdInt ? termIdInt.toString() : "";
        const isCurrent = currentTerm.includes(termIdStr);

        // ✅ Parse classes properly
        let rawClasses = termClasses[i];
        let selectedClasses = [];
        if (Array.isArray(rawClasses)) {
          selectedClasses = rawClasses.map((v) => v.toString().trim());
        } else if (typeof rawClasses === "string") {
          selectedClasses = rawClasses
            .replace(/[\{\}"]/g, "")
            .split(",")
            .map((v) => v.trim())
            .filter((v) => v.length > 0);
        }

        if (termIdInt) {
          // Update existing term
          await db.query(
            "UPDATE terms SET term_name = $1, start_date = $2, end_date = $3 WHERE term_id = $4 AND organization_id = $5",
            [termName, startDate, endDate, termIdInt, organizationId]
          );

          if (isCurrent) {
            await db.query(
              "UPDATE terms SET current = FALSE WHERE organization_id = $1",
              [organizationId]
            );
            await db.query(
              "UPDATE terms SET current = TRUE WHERE term_id = $1 AND organization_id = $2",
              [termIdInt, organizationId]
            );
          }

          // Clean up classes
          await db.query(
            "DELETE FROM term_classes WHERE term_id = $1 AND organization_id = $2",
            [termIdInt, organizationId]
          );

          // Insert selected classes
          for (const classId of selectedClasses) {
            const idInt = parseInt(classId, 10);
            if (!isNaN(idInt)) {
              await db.query(
                "INSERT INTO term_classes (term_id, class_id, organization_id) VALUES ($1, $2, $3)",
                [termIdInt, idInt, organizationId]
              );
            }
          }
        } else {
          // Insert new term
          const newTermResult = await db.query(
            "INSERT INTO terms (term_name, start_date, end_date, school_year_id, organization_id, current) VALUES ($1, $2, $3, $4, $5, FALSE) RETURNING term_id",
            [termName, startDate, endDate, yearIdInt, organizationId]
          );
          const newTermId = newTermResult.rows[0].term_id;

          if (isCurrent) {
            await db.query(
              "UPDATE terms SET current = FALSE WHERE organization_id = $1",
              [organizationId]
            );
            await db.query(
              "UPDATE terms SET current = TRUE WHERE term_id = $1 AND organization_id = $2",
              [newTermId, organizationId]
            );
          }

          // Insert classes for the new term
          for (const classId of selectedClasses) {
            const idInt = parseInt(classId, 10);
            if (!isNaN(idInt)) {
              await db.query(
                "INSERT INTO term_classes (term_id, class_id, organization_id) VALUES ($1, $2, $3)",
                [newTermId, idInt, organizationId]
              );
            }
          }
        }
      }

      await db.query("COMMIT");
      req.flash("success", "School year and terms updated successfully.");
      res.redirect("/common/manageRecords");
    } catch (error) {
      await db.query("ROLLBACK");
      console.error("Error updating school year and terms:", error);
      req.flash("error", "Failed to update school year and terms.");
      res.redirect("/common/manageRecords");
    }
  },

  // Render Create Event & Announcement Form (GET)
  createEventAnnouncementGet: (req, res) => {
    res.render("common/createEventAnnouncement", {
      title: "Create Event & Announcement",
      messages: req.flash(),
    });
  },

  // Handle Create Event & Announcement Form (POST)
  createEventAnnouncementPost: async (req, res, db) => {
    const { type } = req.body;

    try {
      // Log the incoming request body

      // Fetch the current school year and term for the organization
      const currentSchoolYearTerm = await db.query(
        `
            SELECT sy.id as school_year_id, t.term_id
            FROM school_years sy
            JOIN terms t ON sy.id = t.school_year_id
            WHERE sy.organization_id = $1 AND sy.current = TRUE AND t.current = TRUE
        `,
        [req.session.organizationId]
      );

      if (currentSchoolYearTerm.rows.length === 0) {
        req.flash(
          "error",
          "No current school year or term found. Please set the current school year and term."
        );
        return res.redirect("/common/manageRecords");
      }

      const { school_year_id, term_id } = currentSchoolYearTerm.rows[0];

      if (type === "event") {
        // Insert new event with the current school year and term
        await db.query(
          "INSERT INTO school_events (name, event_date, details, visibility, organization_id, school_year_id, term_id) VALUES ($1, $2, $3, $4, $5, $6, $7)",
          [
            req.body.eventName,
            req.body.eventDate,
            req.body.eventDetails,
            req.body.visibility,
            req.session.organizationId,
            school_year_id,
            term_id,
          ]
        );
      } else if (type === "announcement") {
        // Insert new announcement with the current school year and term
        await db.query(
          "INSERT INTO announcements (message, visibility, organization_id, school_year_id, term_id) VALUES ($1, $2, $3, $4, $5)",
          [
            req.body.announcementMessage,
            req.body.visibility,
            req.session.organizationId,
            school_year_id,
            term_id,
          ]
        );
      }

      req.flash("success", "Event/Announcement created successfully.");
      res.redirect("/account/managePublicContent");
    } catch (err) {
      // Log the error to understand what went wrong
      console.error("Error creating event/announcement:", err);

      req.flash("error", "Error creating event/announcement.");
      res.status(500).redirect("/account/managePublicContent");
    }
  },

  // Manage Events & Announcements (GET)
  manageEventsAnnouncementsGet: async (req, res, db) => {
    try {
      // Fetch the current school year and term
      const currentSchoolYearTerm = await db.query(
        `
            SELECT sy.id as school_year_id, t.term_id
            FROM school_years sy
            JOIN terms t ON sy.id = t.school_year_id
            WHERE sy.organization_id = $1 AND sy.current = TRUE AND t.current = TRUE
        `,
        [req.session.organizationId]
      );

      if (currentSchoolYearTerm.rows.length === 0) {
        req.flash("error", "No current school year or term found.");
        return res.redirect("/common/manageRecords");
      }

      const { school_year_id, term_id } = currentSchoolYearTerm.rows[0];

      // Fetch events and announcements tied to the current school year and term
      const events = await db.query(
        "SELECT * FROM school_events WHERE organization_id = $1 AND school_year_id = $2 AND term_id = $3",
        [req.session.organizationId, school_year_id, term_id]
      );
      const announcements = await db.query(
        "SELECT * FROM announcements WHERE organization_id = $1 AND school_year_id = $2 AND term_id = $3",
        [req.session.organizationId, school_year_id, term_id]
      );

      res.render("common/manageEventsAnnouncements", {
        title: "Manage Events & Announcements",
        events: events.rows,
        announcements: announcements.rows,
        messages: req.flash(),
      });
    } catch (err) {
      req.flash("error", "Error loading events and announcements.");
      res.status(500).redirect("/common/manageEventsAnnouncements");
    }
  },

  // Update Event (POST)
  updateEvent: async (req, res, db) => {
    const { id, name, eventDate, details, visibility } = req.body;
    const organizationId = req.session.organizationId;
    try {
      const updateResult = await db.query(
        "UPDATE school_events SET name = $1, event_date = $2, details = $3, visibility = $4 WHERE id = $5 AND organization_id = $6",
        [name, eventDate, details, visibility, id, organizationId]
      );
      if (updateResult.rowCount === 0) {
        req.flash("error", "Event not found.");
      }
      req.flash("success", "Event updated successfully.");
      res.redirect("/account/managePublicContent");
    } catch (err) {
      req.flash("error", "Error updating event.");
      res.status(500).redirect("/account/managePublicContent");
    }
  },

  // Update Announcement (POST)
  updateAnnouncement: async (req, res, db) => {
    const { id, message, visibility } = req.body;
    try {
      await db.query(
        "UPDATE announcements SET message = $1, visibility = $2 WHERE announcement_id = $3 AND organization_id = $4",
        [message, visibility, id, req.session.organizationId]
      );
      req.flash("success", "Announcement updated successfully.");
      res.redirect("/account/managePublicContent");
    } catch (err) {
      req.flash("error", "Error updating announcement.");
      res.status(500).redirect("/account/managePublicContent");
    }
  },

  addClassSubject: async (req, res, db) => {
    try {
      const { organizationId } = req.session;

      const classResult = await db.query(
        "SELECT * FROM classes WHERE organization_id = $1",
        [organizationId]
      );
      const classes = classResult.rows;

      const subjectResult = await db.query(
        "SELECT * FROM subjects WHERE organization_id = $1",
        [organizationId]
      );
      const subjects = subjectResult.rows;

      const gradYearGroupsResult = await db.query(
        "SELECT * FROM graduation_year_groups WHERE organization_id = $1",
        [organizationId]
      );
      const availableGradYearGroups = gradYearGroupsResult.rows;

      res.render("common/addClassSubject", {
        title: "Add Class and Subject",
        classes,
        subjects,
        availableGradYearGroups,
        messages: req.flash(),
      });
    } catch (error) {
      console.error("Error fetching data:", error);
      req.flash(
        "error",
        "Failed to load the form for adding a class and subject."
      );
      res.redirect("/common/orgDashboard");
    }
  },

  addClass: async (req, res, db) => {
    const { className } = req.body; // This will be an array of class names
    const { organizationId } = req.session;

    if (!className || className.length === 0) {
      req.flash("error", "Please provide at least one class name.");
      return res.redirect("/common/addClassSubject");
    }

    const client = await db.connect();
    try {
      await client.query("BEGIN");

      for (let name of className) {
        if (name.trim() !== "") {
          await client.query(
            "INSERT INTO classes (class_name, organization_id) VALUES ($1, $2)",
            [name.trim(), organizationId]
          );
        }
      }

      await client.query("COMMIT");
      req.flash("success", "Classes added successfully.");
      res.redirect("/common/addClassSubject");
    } catch (error) {
      await client.query("ROLLBACK");
      console.error("Error adding classes:", error);
      req.flash("error", "Failed to add classes.");
      res.redirect("/common/addClassSubject");
    } finally {
      client.release();
    }
  },

  addSubject: async (req, res, db) => {
    const { subjectName, classId } = req.body; // Arrays of subject names and classId is now an array of arrays
    const { organizationId } = req.session;

    // Ensure we have at least one subject name and one class ID
    if (!Array.isArray(subjectName) || subjectName.length === 0) {
      req.flash("error", "Please provide at least one subject name.");
      return res.redirect("/common/addClassSubject");
    }

    if (!classId || (Array.isArray(classId) && classId.length === 0)) {
      req.flash("error", "Please select at least one class.");
      return res.redirect("/common/addClassSubject");
    }

    if (subjectName.length > 100) {
      req.flash("error", "Too many subjects submitted.");
      return res.redirect("/common/addClassSubject");
    }

    // prevent  over-insertion of subjects

    const client = await db.connect();
    try {
      await client.query("BEGIN");

      for (let i = 0; i < subjectName.length; i++) {
        const name = subjectName[i].trim();

        // Only add the subject if the name is not empty
        if (name !== "") {
          // Get the classIds for this specific subject (indexed)
          let classIds = classId[i];

          // If classIds is not an array or is undefined, skip this subject
          if (!classIds || !Array.isArray(classIds)) {
            continue;
          }

          // Convert to integers
          classIds = classIds.map(Number);

          // Loop through classIds and insert each subject-class pair
          for (let classIdValue of classIds) {
            // Check if this subject already exists for the given class to avoid duplicates
            const existingSubject = await client.query(
              "SELECT * FROM subjects WHERE subject_name = $1 AND class_id = $2 AND organization_id = $3",
              [name, classIdValue, organizationId]
            );

            // If the subject does not already exist, insert it
            if (existingSubject.rows.length === 0) {
              await client.query(
                "INSERT INTO subjects (subject_name, class_id, organization_id) VALUES ($1, $2, $3)",
                [name, classIdValue, organizationId]
              );
            }
          }
        }
      }
      await client.query("COMMIT");
      req.flash("success", "Subjects added successfully.");
      res.redirect("/common/addClassSubject");
    } catch (error) {
      await client.query("ROLLBACK");
      console.error("Error adding subjects:", error);
      req.flash("error", "Failed to add subjects.");
      res.redirect("/common/addClassSubject");
    } finally {
      client.release();
    }
  },

  updateTerm: async (req, res, db) => {
    const { term_id, term_name, start_date, end_date } = req.body;
    try {
      await db.query(
        "UPDATE terms SET term_name = $1, start_date = $2, end_date = $3 WHERE term_id = $4 AND organization_id = $5",
        [term_name, start_date, end_date, term_id, req.session.organizationId]
      );
      res.redirect("/common/manageRecords");
    } catch (error) {
      console.error("Failed to update term:", error);
      res.status(500).send("Error updating term");
    }
  },

  deleteTerm: async (req, res, db) => {
    const { term_id } = req.body;
    try {
      await db.query(
        "DELETE FROM terms WHERE term_id = $1 AND organization_id = $2",
        [term_id, req.session.organizationId]
      );
      res.json({ success: true, message: "Term deleted successfully." });
    } catch (error) {
      console.error("Error deleting term:", error);
      res
        .status(500)
        .json({ success: false, message: "Failed to delete term." });
    }
  },

  addGraduationYearGroup: async (req, res, db) => {
    const { graduationYear } = req.body; // Array of graduation years
    const { organizationId } = req.session;

    if (!graduationYear || graduationYear.length === 0) {
      req.flash("error", "Please provide at least one graduation year.");
      return res.redirect("/common/addClassSubject");
    }

    const client = await db.connect();
    try {
      await client.query("BEGIN");

      for (let year of graduationYear) {
        if (year.trim() !== "") {
          const yearGroup = `Graduation Class of ${year.trim()} Group`;
          await client.query(
            "INSERT INTO graduation_year_groups (name, organization_id) VALUES ($1, $2) ON CONFLICT (name) DO NOTHING",
            [yearGroup, organizationId]
          );
        }
      }

      await client.query("COMMIT");
      req.flash("success", "Graduation year groups added successfully.");
      res.redirect("/common/addClassSubject");
    } catch (error) {
      await client.query("ROLLBACK");
      console.error("Error adding graduation year groups:", error);
      req.flash("error", "Failed to add graduation year groups.");
      res.redirect("/common/addClassSubject");
    } finally {
      client.release();
    }
  },

  manageClassSubjectAndGradYr: async (req, res, db) => {
    try {
      const graduationYearsResult = await db.query(
        "SELECT * FROM graduation_year_groups WHERE organization_id = $1 ORDER BY name",
        [req.session.organizationId]
      );
      const classesResult = await db.query(
        "SELECT * FROM classes WHERE organization_id = $1 ORDER BY class_name",
        [req.session.organizationId]
      );
      const subjectsResult = await db.query(
        "SELECT * FROM subjects WHERE organization_id = $1 ORDER BY subject_name",
        [req.session.organizationId]
      );

      res.render("common/manageClassSubjectAndGradYr", {
        title: "Modify Class, Subject & Grad Year",
        graduationYearGroups: graduationYearsResult.rows,
        classes: classesResult.rows,
        subjects: subjectsResult.rows,
        messages: {
          success: req.flash("success"),
          error: req.flash("error"),
        },
      });
    } catch (error) {
      console.error("Error fetching data:", error);
      res.status(500).send("Error loading the management page.");
    }
  },

  management: async (req, res, db) => {
    try {
      // Get current term for assessment link
      const termResult = await db.query(`
        SELECT t.term_id, t.term_name
        FROM terms t
        JOIN school_years sy ON t.school_year_id = sy.id
        WHERE sy.organization_id = $1 AND sy.current = TRUE AND t.current = TRUE
        LIMIT 1
      `, [req.session.organizationId]);
      
      const currentTerm = termResult.rows.length > 0 ? termResult.rows[0] : null;

      res.render("common/managementTools", {
        title: "Management Tools",
        currentTerm: currentTerm,
      });
    } catch (error) {
      console.error("Error fetching management data:", error);
      res.status(500).send("Failed to load management data");
    }
  },

  editGraduationYearGroup: async (req, res, db) => {
    const { id, newName } = req.body;
    try {
      await db.query(
        "UPDATE graduation_year_groups SET name = $1 WHERE id = $2 AND organization_id = $3",
        [newName, id, req.session.organizationId]
      );
      req.flash("success", "Graduation year group updated successfully.");
      res.redirect("/common/manageClassSubjectAndGradYr");
    } catch (error) {
      console.error("Error updating graduation year group:", error);
      req.flash("error", "Failed to update graduation year group.");
      res.redirect("/common/manageClassSubjectAndGradYr");
    }
  },

  deleteGraduationYearGroup: async (req, res, db) => {
    const { id } = req.query;
    try {
      await db.query(
        "DELETE FROM graduation_year_groups WHERE id = $1 AND organization_id = $2",
        [id, req.session.organizationId]
      );
      req.flash("success", "Graduation year group deleted successfully.");
      res.redirect("/common/manageClassSubjectAndGradYr");
    } catch (error) {
      console.error("Error deleting graduation year group:", error);
      req.flash("error", "Failed to delete graduation year group.");
      res.redirect("/common/manageClassSubjectAndGradYr");
    }
  },

  deleteClass: async (req, res, db) => {
    const { classId } = req.query;
    try {
      // Warn the user about the consequences of deleting the class
      req.flash(
        "warning",
        "This will delete all associated subjects and user data. Are you sure?"
      );

      // Check if the class has associated subjects and delete them first
      const subjects = await db.query(
        "SELECT subject_id FROM subjects WHERE class_id = $1",
        [classId]
      );

      for (let subject of subjects.rows) {
        // Delete associated records from user_subjects for each subject
        await db.query("DELETE FROM user_subjects WHERE subject_id = $1", [
          subject.subject_id,
        ]);

        // Delete the subject itself
        await db.query("DELETE FROM subjects WHERE subject_id = $1", [
          subject.subject_id,
        ]);
      }

      // Now, delete the class after its subjects and dependencies have been removed
      await db.query(
        "DELETE FROM classes WHERE class_id = $1 AND organization_id = $2",
        [classId, req.session.organizationId]
      );

      req.flash(
        "success",
        "Class and all associated subjects deleted successfully."
      );
    } catch (error) {
      console.error("Error deleting class:", error);
      req.flash("error", "Failed to delete class. " + error.message);
    }

    res.redirect("/common/manageClassSubjectAndGradYr");
  },

  editClass: async (req, res, db) => {
    const { classId, newClassName } = req.body;
    try {
      await db.query(
        "UPDATE classes SET class_name = $1 WHERE class_id = $2 AND organization_id = $3",
        [newClassName, classId, req.session.organizationId]
      );
      req.flash("success", "Class updated successfully.");
      res.redirect("/common/manageClassSubjectAndGradYr");
    } catch (error) {
      console.error("Error updating class:", error);
      req.flash("error", "Failed to update class.");
      res.redirect("/common/manageClassSubjectAndGradYr");
    }
  },

  getSubjectsByClass: async (req, res, db) => {
    const { classId } = req.query;
    if (!classId) {
      return res.status(400).json({ error: "Class ID is required." });
    }

    try {
      const subjectsResult = await db.query(
        "SELECT subject_id, subject_name FROM subjects WHERE class_id = $1 AND organization_id = $2 ORDER BY subject_name",
        [classId, req.session.organizationId]
      );
      res.json(subjectsResult.rows);
    } catch (error) {
      console.error("Error fetching subjects for class:", error);
      res.status(500).json({ error: "Failed to load subjects." });
    }
  },

  editSubject: async (req, res, db) => {
    const { subjectId, newName } = req.body;
    try {
      await db.query(
        "UPDATE subjects SET subject_name = $1 WHERE subject_id = $2 AND organization_id = $3",
        [newName, subjectId, req.session.organizationId]
      );
      req.flash("success", "Subject updated successfully.");
      res.redirect("/common/manageClassSubjectAndGradYr");
    } catch (error) {
      console.error("Error updating subject:", error);
      req.flash("error", "Failed to update subject.");
      res.redirect("/common/manageClassSubjectAndGradYr");
    }
  },

  deleteSubject: async (req, res, db) => {
    const { subjectId } = req.query;

    try {
      // Delete all user_subjects entries related to the subject
      await db.query("DELETE FROM user_subjects WHERE subject_id = $1", [
        subjectId,
      ]);

      // Now delete the subject
      await db.query(
        "DELETE FROM subjects WHERE subject_id = $1 AND organization_id = $2",
        [subjectId, req.session.organizationId]
      );

      req.flash("success", "Subject deleted successfully.");
      res.redirect("/common/manageClassSubjectAndGradYr");
    } catch (err) {
      console.error("Error deleting subject:", err);
      req.flash("error", "Failed to delete subject.");
      res.redirect("/common/manageClassSubjectAndGradYr");
    }
  },

  getGradYearGroupByClassId: async (req, res, db) => {
    const { classId } = req.query;
    if (!classId) {
      return res.status(400).json({ error: "Class ID is required" });
    }
    try {
      const result = await db.query(
        `
                SELECT g.name as grad_year_group_name
                FROM classes c
                JOIN graduation_year_groups g ON c.graduation_year_group_id = g.id
                WHERE c.class_id = $1 AND c.organization_id = $2`,
        [classId, req.session.organizationId]
      );

      if (result.rows.length > 0) {
        res.json({ grad_year_group_name: result.rows[0].grad_year_group_name });
      } else {
        res.status(404).json({
          error: "Graduation year group not found for the given class ID.",
        });
      }
    } catch (err) {
      console.error("Error fetching graduation year group:", err);
      res
        .status(500)
        .json({ error: "Failed to fetch graduation year group data." });
    }
  },

  closeSchoolYear: async (req, res, db) => {
    try {
      const { organizationId } = req.session;

      // Fetch the current school year and its terms
      const currentSchoolYearResult = await db.query(
        `
                SELECT sy.id AS school_year_id, sy.year_label, t.term_id, t.term_name
                FROM school_years sy
                LEFT JOIN terms t ON sy.id = t.school_year_id
                WHERE sy.organization_id = $1 AND sy.current = TRUE
                ORDER BY t.start_date
            `,
        [organizationId]
      );

      const currentSchoolYear =
        currentSchoolYearResult.rows.length > 0
          ? {
              year_label: currentSchoolYearResult.rows[0].year_label,
              terms: currentSchoolYearResult.rows.map((row) => ({
                term_id: row.term_id,
                term_name: row.term_name,
              })),
            }
          : null;

      // Fetch other school years and their terms
      const otherSchoolYearsResult = await db.query(
        `
                SELECT sy.id AS school_year_id, sy.year_label, t.term_id, t.term_name
                FROM school_years sy
                LEFT JOIN terms t ON sy.id = t.school_year_id
                WHERE sy.organization_id = $1 AND sy.current = FALSE
                ORDER BY sy.year_label DESC, t.start_date
            `,
        [organizationId]
      );

      const otherSchoolYears = [];
      otherSchoolYearsResult.rows.forEach((row) => {
        let schoolYear = otherSchoolYears.find(
          (y) => y.year_label === row.year_label
        );
        if (!schoolYear) {
          schoolYear = { year_label: row.year_label, terms: [] };
          otherSchoolYears.push(schoolYear);
        }
        if (row.term_id) {
          schoolYear.terms.push({
            term_id: row.term_id,
            term_name: row.term_name,
          });
        }
      });

      // Render the page
      res.render("common/closeSchoolYear", {
        title: "Close School Year",
        currentSchoolYear,
        otherSchoolYears,
      });
    } catch (error) {
      console.error("Error fetching school year data:", error);
      req.flash("error", "Failed to load school year data.");
      res.redirect("/");
    }
  },

  termDetails: async (req, res, db) => {
    const { termId } = req.params;
    const organizationId = req.session.organizationId;

    try {
      // Fetch term details
      const termResult = await db.query(
        `
                SELECT term_id, term_name, start_date, end_date
                FROM terms
                WHERE term_id = $1 AND organization_id = $2
            `,
        [termId, organizationId]
      );

      const term = termResult.rows[0];
      if (!term) {
        req.flash("error", "Invalid term selected.");
        return res.redirect("/common/closeSchoolYear");
      }

      // Fetch all classes enrolled for the term
      const classesResult = await db.query(
        `
                SELECT DISTINCT c.class_id, c.class_name
                FROM classes c
                INNER JOIN enrolled_classes ec ON c.class_id = ec.class_id
                INNER JOIN enrollments e ON ec.enrollment_id = e.enrollment_id
                WHERE e.term_id = $1 AND c.organization_id = $2
                ORDER BY c.class_name ASC
            `,
        [termId, organizationId]
      );

      const classes = classesResult.rows;

      // Pass title, termId, and classes to the view
      res.render("common/termDetails", {
        title: "Term Details",
        term,
        classes,
        termId,
        organizationId,
        messages: {
          success: req.flash("success"),
          error: req.flash("error"),
          info: req.flash("info"),
        },
      });
    } catch (error) {
      console.error("Error fetching term details:", error);
      req.flash("error", "Failed to load term details.");
      res.redirect("/common/closeSchoolYear");
    }
  },

  closeGraduationYearGroup: async (req, res, db) => {
    try {
      const gradYearGroupsResult = await db.query(
        "SELECT * FROM graduation_year_groups WHERE organization_id = $1 ORDER BY name",
        [req.session.organizationId]
      );

      const studentsResult = await db.query(
        "SELECT * FROM students WHERE organization_id = $1 AND graduated = FALSE ORDER BY last_name, first_name",
        [req.session.organizationId]
      );

      const gradYearGroups = gradYearGroupsResult.rows.map((group) => ({
        ...group,
        students: studentsResult.rows.filter(
          (student) => student.graduation_year_group_id === group.id
        ),
      }));

      res.render("common/closeGraduationYearGroup", {
        title: "Close Graduation Year Group",
        gradYearGroups,
      });
    } catch (error) {
      console.error(
        "Error fetching graduation year groups and students:",
        error
      );
      res.status(500).send("Failed to load close graduation year group page.");
    }
  },

  closeGraduationYearGroupPost: async (req, res, db) => {
    const { students, action } = req.body;

    try {
      const studentIds = Array.isArray(students) ? students : [students];

      if (action === "archive") {
        // Archive selected students
        const studentData = await db.query(
          "SELECT student_id, graduation_year_group_id FROM students WHERE student_id = ANY($1) AND organization_id = $2",
          [studentIds, req.session.organizationId]
        );

        const archiveQueries = studentData.rows.map((student) =>
          db.query(
            "INSERT INTO archived_student_info (student_id, graduation_year_group_id, organization_id) VALUES ($1, $2, $3)",
            [
              student.student_id,
              student.graduation_year_group_id,
              req.session.organizationId,
            ]
          )
        );

        await Promise.all(archiveQueries);

        // Mark students as graduated
        await db.query(
          "UPDATE students SET graduated = TRUE WHERE student_id = ANY($1) AND organization_id = $2",
          [studentIds, req.session.organizationId]
        );
      }

      res.redirect("/common/closeGraduationYearGroup");
    } catch (error) {
      console.error("Error closing graduation year group:", error);
      res.status(500).send("Failed to close graduation year group.");
    }
  },

  archivedStudents: async (req, res, db) => {
    try {
      const archivedGroupsResult = await db.query(
        "SELECT * FROM graduation_year_groups WHERE id IN (SELECT DISTINCT graduation_year_group_id FROM archived_student_info WHERE organization_id = $1)",
        [req.session.organizationId]
      );

      const archivedStudentsResult = await db.query(
        "SELECT s.*, a.graduation_year_group_id FROM students s JOIN archived_student_info a ON s.student_id = a.student_id WHERE a.organization_id = $1",
        [req.session.organizationId]
      );

      const archivedGroups = archivedGroupsResult.rows.map((group) => ({
        ...group,
        students: archivedStudentsResult.rows.filter(
          (student) => student.graduation_year_group_id === group.id
        ),
      }));

      res.render("common/archivedStudents", {
        title: "Archived Students",
        archivedGroups,
      });
    } catch (error) {
      console.error("Error fetching archived students:", error);
      res.status(500).send("Failed to load archived students.");
    }
  },

  unarchiveStudents: async (req, res, db) => {
    const { students } = req.body;

    try {
      const studentIds = Array.isArray(students) ? students : [students];

      // Remove from archive table
      await db.query(
        "DELETE FROM archived_student_info WHERE student_id = ANY($1) AND organization_id = $2",
        [studentIds, req.session.organizationId]
      );

      // Mark students as not graduated
      await db.query(
        "UPDATE students SET graduated = FALSE WHERE student_id = ANY($1) AND organization_id = $2",
        [studentIds, req.session.organizationId]
      );

      res.redirect("/common/archivedStudents");
    } catch (error) {
      console.error("Error unarchiving students:", error);
      res.status(500).send("Failed to unarchive students.");
    }
  },

  // Delete Event (POST)
  deleteEvent: async (req, res, db) => {
    const { id } = req.body;
    try {
      await db.query(
        "DELETE FROM school_events WHERE id = $1 AND organization_id = $2",
        [id, req.session.organizationId]
      );
      req.flash("success", "Event deleted successfully.");
      res.redirect("/account/managePublicContent");
    } catch (err) {
      req.flash("error", "Error deleting event.");
      res.status(500).redirect("/account/managePublicContent");
    }
  },

  // Delete Announcement (POST)
  deleteAnnouncement: async (req, res, db) => {
    const { id } = req.body;
    try {
      await db.query(
        "DELETE FROM announcements WHERE announcement_id = $1 AND organization_id = $2",
        [id, req.session.organizationId]
      );
      req.flash("success", "Announcement deleted successfully.");
      res.redirect("/account/managePublicContent");
    } catch (err) {
      req.flash("error", "Error deleting announcement.");
      res.status(500).redirect("/account/managePublicContent");
    }
  },

  deleteSchoolYear: async (req, res, db) => {
    const { yearId } = req.body;
    try {
      await db.query(
        "DELETE FROM term_classes WHERE term_id IN (SELECT term_id FROM terms WHERE school_year_id = $1)",
        [yearId]
      );
      await db.query("DELETE FROM terms WHERE school_year_id = $1", [yearId]);
      await db.query(
        "DELETE FROM school_years WHERE id = $1 AND organization_id = $2",
        [yearId, req.session.organizationId]
      );

      req.flash("success", "School year deleted successfully.");
      res.redirect("/common/manageRecords");
    } catch (error) {
      console.error("Error deleting school year:", error);
      req.flash("error", "Failed to delete school year.");
      res.redirect("/common/manageRecords");
    }
  },

  deleteSchoolYearPost: async (req, res, db) => {
    try {
      const { yearId } = req.body;

      // Delete all terms associated with the school year
      await db.query("DELETE FROM terms WHERE school_year_id = $1", [yearId]);

      // Delete the school year
      await db.query("DELETE FROM school_years WHERE id = $1", [yearId]);

      req.flash("success", "School year deleted successfully.");
      res.redirect("/common/manageRecords");
    } catch (error) {
      console.error("Error deleting school year:", error);
      req.flash("error", "Failed to delete school year.");
      res.redirect("/common/manageRecords");
    }
  },

  // Guardian Management Functions
  guardiansListGet: async (req, res, db) => {
    try {
      const organizationId = req.session.organizationId;

      console.log('Loading guardians for organization:', organizationId);

      // Use the old guardians table structure
      const guardiansResult = await db.query(
        `
        SELECT 
          DISTINCT ON (g.first_name, g.last_name, g.phone) 
          g.guardian_id,
          g.first_name,
          g.last_name,
          g.phone,
          g.address,
          g.hometown,
          g.image_url,
          COUNT(g.student_id) OVER (PARTITION BY g.first_name, g.last_name, g.phone) as student_count,
          false as has_portal_access
        FROM guardians g
        WHERE g.organization_id = $1
        ORDER BY g.first_name, g.last_name, g.phone, g.guardian_id DESC
        `,
        [organizationId]
      );

      console.log('Found guardians:', guardiansResult.rows.length);

      return res.render("common/guardians", {
        title: "Guardian Management",
        guardians: guardiansResult.rows,
        messages: req.flash(),
        req,
      });
    } catch (error) {
      console.error('Error loading guardians:', error);
      req.flash('error', 'Error loading guardians');
      return res.redirect('/common/orgDashboard');
    }
  },

  guardianDetailsGet: async (req, res, db) => {
    try {
      const organizationId = req.session.organizationId;
      const guardianId = req.query.guardianId;

      if (!guardianId) {
        req.flash('error', 'Guardian ID is required');
        return res.redirect('/common/guardians');
      }

      // Get guardian info from old guardians table
      const guardianResult = await db.query(
        `SELECT * FROM guardians WHERE guardian_id = $1 AND organization_id = $2`,
        [guardianId, organizationId]
      );

      if (!guardianResult.rows.length) {
        req.flash('error', 'Guardian not found');
        return res.redirect('/common/guardians');
      }

      const guardian = guardianResult.rows[0];

      // Get all students linked to this guardian (by matching name and phone)
      const studentsResult = await db.query(
        `
        SELECT s.student_id, s.first_name, s.last_name, s.image_url, 
               c.class_name, c.class_id, 'Parent/Guardian' as relationship
        FROM guardians g
        JOIN students s ON g.student_id = s.student_id
        LEFT JOIN classes c ON s.class_id = c.class_id
        WHERE g.first_name = $1 AND g.last_name = $2 
          AND (g.phone = $3 OR $3 IS NULL)
          AND g.organization_id = $4
        ORDER BY s.first_name ASC
        `,
        [guardian.first_name, guardian.last_name, guardian.phone, organizationId]
      );

      // Get current term
      const currentTermId = req.session.currentTermId;

      return res.render("common/guardianDetails", {
        title: "Guardian Details",
        guardian: guardian,
        students: studentsResult.rows,
        currentTermId: currentTermId,
        account: { login_email: null, login_phone: guardian.phone },
        messages: req.flash(),
        req,
      });
    } catch (error) {
      console.error('Error loading guardian details:', error);
      req.flash('error', 'Error loading guardian details');
      return res.redirect('/common/guardians');
    }
  },

  guardianEditPost: async (req, res, db) => {
    try {
      const organizationId = req.session.organizationId;
      const guardianId = req.params.guardianId;
      const { firstName, lastName, phone, address, hometown } = req.body;

      let imageUrl = null;
      if (req.file) {
        const s3Key = `images/guardianimages/${organizationId}/${Date.now()}_${req.file.originalname}`;
        imageUrl = await uploadToS3(req.file, s3Key);
      }

      // Update all guardian records with matching name and phone
      const updateQuery = imageUrl
        ? `UPDATE guardians 
           SET first_name = $1, last_name = $2, phone = $3, 
               address = $4, hometown = $5, image_url = $6
           WHERE guardian_id = $7 AND organization_id = $8`
        : `UPDATE guardians 
           SET first_name = $1, last_name = $2, phone = $3, 
               address = $4, hometown = $5
           WHERE guardian_id = $6 AND organization_id = $7`;

      const params = imageUrl
        ? [firstName, lastName, phone, address, hometown, imageUrl, guardianId, organizationId]
        : [firstName, lastName, phone, address, hometown, guardianId, organizationId];

      await db.query(updateQuery, params);

      req.flash('success', 'Guardian information updated successfully');
      return res.redirect(`/common/guardianDetails?guardianId=${guardianId}`);
    } catch (error) {
      console.error('Error updating guardian:', error);
      req.flash('error', 'Error updating guardian information');
      return res.redirect(`/common/guardianDetails?guardianId=${req.params.guardianId}`);
    }
  },

  guardianRemoveStudent: async (req, res, db) => {
    try {
      const organizationId = req.session.organizationId;
      const { guardianId, studentId } = req.body;

      // Delete the specific guardian record for this student
      await db.query(
        `DELETE FROM guardians WHERE guardian_id = $1 AND student_id = $2 AND organization_id = $3`,
        [guardianId, studentId, organizationId]
      );

      req.flash('success', 'Student removed from guardian');
      return res.json({ success: true });
    } catch (error) {
      console.error('Error removing student from guardian:', error);
      return res.status(500).json({ success: false, error: 'Error removing student' });
    }
  },

  guardianRequestPasswordReset: async (req, res, db) => {
    try {
      const organizationId = req.session.organizationId;
      const guardianId = req.body.guardianId;

      // Get guardian info from old guardians table
      const guardianResult = await db.query(
        `SELECT * FROM guardians WHERE guardian_id = $1 AND organization_id = $2`,
        [guardianId, organizationId]
      );

      if (!guardianResult.rows.length) {
        return res.status(404).json({ success: false, error: 'Guardian not found' });
      }

      const guardian = guardianResult.rows[0];

      // Check if guardian has email or phone
      if (!guardian.email && !guardian.phone) {
        return res.status(400).json({ 
          success: false, 
          error: 'Guardian must have an email address or phone number to receive login credentials.' 
        });
      }

      const contactEmail = guardian.email;
      const contactPhone = guardian.phone;

      if (!contactEmail) {
        return res.status(400).json({ 
          success: false, 
          error: 'Guardian must have an email address to receive password setup link.' 
        });
      }

      // Check if guardian already has a guardian_profile and account
      const profileCheck = await db.query(
        `SELECT guardian_id FROM guardian_profiles 
         WHERE first_name = $1 AND last_name = $2 AND phone = $3 AND organization_id = $4`,
        [guardian.first_name, guardian.last_name, guardian.phone, organizationId]
      );

      let guardianProfileId = profileCheck.rows.length > 0 ? profileCheck.rows[0].guardian_id : null;

      // If no profile exists, create one
      if (!guardianProfileId) {
        const profileInsert = await db.query(
          `INSERT INTO guardian_profiles (first_name, last_name, phone, email, address, hometown, image_url, organization_id, created_at, updated_at)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, NOW(), NOW())
           RETURNING guardian_id`,
          [guardian.first_name, guardian.last_name, guardian.phone, contactEmail, guardian.address, guardian.hometown, guardian.image_url, organizationId]
        );
        guardianProfileId = profileInsert.rows[0].guardian_id;

        console.log('✅ Created guardian profile:', guardianProfileId);

        // Link all students with matching guardian from OLD guardians table
        // Use the guardianId parameter which refers to the old guardians table
        const studentsResult = await db.query(
          `SELECT DISTINCT g.student_id, s.first_name, s.last_name
           FROM guardians g
           JOIN students s ON g.student_id = s.student_id
           WHERE g.first_name = $1 
           AND g.last_name = $2 
           AND (g.phone = $3 OR $3 IS NULL)
           AND g.organization_id = $4`,
          [guardian.first_name, guardian.last_name, guardian.phone, organizationId]
        );

        console.log('👨‍👩‍👧‍👦 Found students to link from guardian_id', guardianId, ':', studentsResult.rows.length, studentsResult.rows);

        for (const student of studentsResult.rows) {
          await db.query(
            `INSERT INTO guardian_students (guardian_id, student_id, relationship)
             VALUES ($1, $2, 'Parent/Guardian')
             ON CONFLICT DO NOTHING`,
            [guardianProfileId, student.student_id]
          );
          console.log('  ✅ Linked student:', student.student_id, student.first_name, student.last_name);
        }

        console.log('✅ Finished linking students to guardian_profile', guardianProfileId);
      }

      // Check if account exists
      const accountCheck = await db.query(
        `SELECT id, password_hash FROM guardian_accounts WHERE guardian_id = $1 AND organization_id = $2`,
        [guardianProfileId, organizationId]
      );

      const hasAccount = accountCheck.rows.length > 0;
      const hasPassword = hasAccount && accountCheck.rows[0].password_hash;
      const isNewAccount = !hasAccount;

      // If no account, create one
      if (!hasAccount) {
        await db.query(
          `INSERT INTO guardian_accounts (guardian_id, organization_id, login_email, login_phone, password_hash, created_at)
           VALUES ($1, $2, $3, $4, NULL, NOW())`,
          [guardianProfileId, organizationId, contactEmail, contactPhone]
        );
      }

      // Generate token
      const token = crypto.randomBytes(32).toString("hex");
      const tokenExpiry = new Date(Date.now() + 24 * 60 * 60 * 1000);

      // Store token
      await db.query(
        `INSERT INTO password_reset_tokens (user_id, token, expires_at, created_at)
         VALUES ($1, $2, $3, NOW())
         ON CONFLICT (user_id) DO UPDATE SET token = $2, expires_at = $3, created_at = NOW()`,
        [`guardian_${guardianProfileId}`, token, tokenExpiry]
      );

      // Get organization info
      const orgResult = await db.query(
        `SELECT organization_name FROM organizations WHERE organization_id = $1`,
        [organizationId]
      );

      const organizationName = orgResult.rows[0]?.organization_name || 'School';

      // Send password setup/reset email
      const resetLink = process.env.NODE_ENV === "production"
        ? `https://www.managira.com/common/set-password?token=${token}&type=guardian`
        : `http://localhost:4000/common/set-password?token=${token}&type=guardian`;

      // Debug SMTP settings
      console.log('📧 SMTP Configuration:', {
        host: process.env.ADMIN_NOTIFY_SMTP_HOST,
        port: process.env.ADMIN_NOTIFY_SMTP_PORT,
        secure: process.env.ADMIN_NOTIFY_SMTP_SECURE,
        user: process.env.ADMIN_NOTIFY_EMAIL_USER
      });

      const transporter = nodemailer.createTransport({
        host: process.env.ADMIN_NOTIFY_SMTP_HOST || 'mail.privateemail.com',
        port: parseInt(process.env.ADMIN_NOTIFY_SMTP_PORT) || 587,
        secure: process.env.ADMIN_NOTIFY_SMTP_SECURE === "true",
        auth: {
          user: process.env.ADMIN_NOTIFY_EMAIL_USER,
          pass: process.env.ADMIN_NOTIFY_EMAIL_PASSWORD,
        },
      });

      const emailTitle = isNewAccount ? 'Parent Portal Access Setup' : 'Password Reset Request';
      const emailHeading = isNewAccount ? 'Welcome to Parent Portal!' : 'Password Reset Request';
      const emailMessage = isNewAccount 
        ? `You have been invited to access the Parent Portal at ${he.encode(organizationName)}. Click the button below to set your password and access your children's progress.`
        : `A password reset has been requested for your Parent Portal account at ${he.encode(organizationName)}. Click the button below to set a new password.`;

      const html = `
      <div style="background:#f4fbfa;padding:40px 0;">
        <div style="max-width:600px;margin:40px auto;background:#fff;border-radius:16px;box-shadow:0 4px 24px #b2e2d6;overflow:hidden;font-family:'Segoe UI',Arial,sans-serif;">
          <div style="background:#6fd3c4;padding:24px 0 24px 32px;display:flex;align-items:center;">
            <img src="cid:managira_logo" alt="Managira Logo" style="height:60px;display:block;">
          </div>
          <div style="padding:36px 32px 32px 32px;">
            <div style="color:#6fd3c4;font-size:24px;font-weight:600;margin-bottom:16px;letter-spacing:1px;">${emailHeading}</div>
            <p style="font-size:16px;line-height:1.6;margin-bottom:18px;">Hello <b>${he.encode(guardian.first_name)} ${he.encode(guardian.last_name)}</b>,</p>
            <p style="font-size:16px;line-height:1.6;margin-bottom:18px;">${emailMessage}</p>
            ${isNewAccount ? `<p style="font-size:16px;line-height:1.6;margin-bottom:18px;">You can log in using your email <b>${he.encode(contactEmail)}</b> or phone number <b>${he.encode(contactPhone)}</b> along with the password you create.</p>` : ''}
            <div style="margin:24px 0;">
              <a href="${he.encode(resetLink)}" style="background:#6fd3c4;color:#fff;padding:14px 32px;border-radius:6px;text-decoration:none;font-size:16px;font-weight:600;box-shadow:0 2px 8px #b2e2d6;display:inline-block;">${isNewAccount ? 'Set Password' : 'Reset Password'}</a>
            </div>
            <p style="font-size:15px;color:#888;">This link will expire in 24 hours.</p>
            ${!isNewAccount ? '<p style="font-size:15px;margin-top:18px;">If you did not request this password reset, please ignore this email.</p>' : ''}
            <p style="color:#b80000;font-size:16px;font-weight:bold;margin-top:32px;text-align:center;letter-spacing:1px;">THIS IS A NO-REPLY MESSAGE. PLEASE DO NOT REPLY TO THIS EMAIL.</p>
          </div>
          <div style="background:#e6f7ec;color:#888;text-align:center;padding:18px 0;font-size:13px;">&copy; ${new Date().getFullYear()} Managira. All rights reserved.</div>
        </div>
      </div>
      `;

      const mailOptions = {
        from: process.env.ADMIN_NOTIFY_EMAIL_USER,
        to: contactEmail,
        subject: `${emailTitle} - ${organizationName} Parent Portal`,
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

      return res.json({ 
        success: true, 
        message: isNewAccount ? 'Password setup email sent successfully!' : 'Password reset email sent successfully!' 
      });
    } catch (error) {
      console.error('❌ Error sending password setup email:', error);
      console.error('Error stack:', error.stack);
      return res.status(500).json({ success: false, error: 'Error sending password setup email: ' + error.message });
    }
  },

  // Admissions Hub
  admissionsHub: async (req, res, db) => {
    try {
      res.render("common/admissionsHub", {
        title: "Admissions",
      });
    } catch (error) {
      console.error("Error loading admissions hub:", error);
      res.status(500).send("Failed to load admissions page");
    }
  },

  // Reports Hub
  reportsHub: async (req, res, db) => {
    try {
      res.render("common/reportsHub", {
        title: "Reports",
      });
    } catch (error) {
      console.error("Error loading reports hub:", error);
      res.status(500).send("Failed to load reports page");
    }
  },
};


// Helper function to send invitation email
async function sendInviteEmail(
  email,
  firstName,
  lastName,
  link,
  organizationName
) {
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
          <div style="color:#6fd3c4;font-size:24px;font-weight:600;margin-bottom:16px;letter-spacing:1px;">You're Invited to Join ${he.encode(
            organizationName
          )}</div>
          <p style="font-size:16px;line-height:1.6;margin-bottom:18px;">Hello <b>${he.encode(
            firstName
          )} ${he.encode(lastName)}</b>,</p>
          <p style="font-size:16px;line-height:1.6;margin-bottom:18px;">${he.encode(
            organizationName
          )} is inviting you to join their institution. Accept this invitation by clicking the button below to set your password:</p>
          <div style="margin:24px 0;">
            <a href="${he.encode(
              link
            )}" style="background:#6fd3c4;color:#fff;padding:12px 32px;border-radius:6px;text-decoration:none;font-size:16px;font-weight:600;box-shadow:0 2px 8px #b2e2d6;">Accept Invite & Set Password</a>
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
    subject: "Set Your Password - Managira",
    html,
    attachments: [
      {
        filename: "managira.png",
        path: require("path").join(__dirname, "../public/images/managira.png"),
        cid: "managira_logo",
      },
    ],
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
          <p style="font-size:16px;line-height:1.6;margin-bottom:18px;">Hello <b>${he.encode(
            firstName
          )} ${he.encode(lastName)}</b>,</p>
          <p style="font-size:16px;line-height:1.6;margin-bottom:18px;">Your password has been set successfully! You can now log in to your Institution and start having a great time. Use your email and the newly created password to log in.</p>
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
        filename: "managira.png",
        path: require("path").join(__dirname, "../public/images/managira.png"),
        cid: "managira_logo",
      },
    ],
  };
  await transporter.sendMail(mailOptions);
}

// Guardian search API for autocomplete in addStudent form
const searchGuardiansApi = async (req, res, db) => {
  try {
    const organizationId = req.session.organizationId;
    const q = (req.query.q || "").trim();

    if (!organizationId) return res.status(400).json({ guardians: [] });
    if (q.length < 2) return res.json({ guardians: [] });

    const like = `%${q}%`;

    const result = await db.query(
      `
      SELECT guardian_id, first_name, last_name, phone, email, image_url
      FROM guardian_profiles
      WHERE organization_id = $1
        AND (
          CONCAT_WS(' ', first_name, last_name) ILIKE $2
          OR phone ILIKE $2
          OR email ILIKE $2
        )
      ORDER BY updated_at DESC, guardian_id DESC
      LIMIT 8
      `,
      [organizationId, like]
    );

    return res.json({ guardians: result.rows });
  } catch (e) {
    console.error('Guardian search error:', e);
    return res.status(500).json({ guardians: [] });
  }
};

// Send welcome email to new guardian with password setup
const sendGuardianWelcomeEmail = async (guardianEmail, guardianFirstName, guardianLastName, studentName, organizationName, organizationId, guardianId) => {
  try {
    // Generate token for password setup
    const token = crypto.randomBytes(32).toString("hex");
    const tokenExpiry = new Date(Date.now() + 24 * 60 * 60 * 1000); // 24 hours

    // Store token in database
    await db.query(
      `INSERT INTO password_reset_tokens (user_id, token, expires_at, created_at)
       VALUES ($1, $2, $3, NOW())
       ON CONFLICT (user_id) DO UPDATE SET token = $2, expires_at = $3, created_at = NOW()`,
      [`guardian_${guardianId}`, token, tokenExpiry]
    );

    const setupLink = process.env.NODE_ENV === "production"
      ? `https://www.managira.com/account/setPassword?token=${token}&type=guardian`
      : `http://localhost:4000/account/setPassword?token=${token}&type=guardian`;

    const transporter = nodemailer.createTransport({
      host: process.env.ADMIN_NOTIFY_SMTP_HOST,
      port: process.env.ADMIN_NOTIFY_SMTP_PORT,
      secure: process.env.ADMIN_NOTIFY_SMTP_SECURE === "true",
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
          <div style="color:#6fd3c4;font-size:24px;font-weight:600;margin-bottom:16px;letter-spacing:1px;">Welcome to ${he.encode(organizationName)} Parent Portal! 🎓</div>
          <p style="font-size:16px;line-height:1.6;margin-bottom:18px;">Hello <b>${he.encode(guardianFirstName)} ${he.encode(guardianLastName)}</b>,</p>
          <p style="font-size:16px;line-height:1.6;margin-bottom:18px;">Great news! <b>${he.encode(studentName)}</b> has been registered at ${he.encode(organizationName)}, and you've been added as their guardian.</p>
          <p style="font-size:16px;line-height:1.6;margin-bottom:18px;">To monitor your child's academic progress, grades, and connect with teachers, please set up your Parent Portal password:</p>
          <div style="margin:24px 0;">
            <a href="${he.encode(setupLink)}" style="background:#6fd3c4;color:#fff;padding:14px 32px;border-radius:6px;text-decoration:none;font-size:16px;font-weight:600;box-shadow:0 2px 8px #b2e2d6;display:inline-block;">Set My Password</a>
          </div>
          <div style="background:#e6f7ec;padding:16px;border-left:4px solid #6fd3c4;margin:20px 0;">
            <p style="margin:0 0 8px 0;font-weight:600;color:#0f2d32;">What you can do in the Parent Portal:</p>
            <ul style="margin:8px 0;padding-left:20px;color:#52606d;">
              <li>View your child's grades and assessment scores</li>
              <li>Track academic performance across terms</li>
              <li>See teacher information and contact details</li>
              <li>Monitor attendance and progress</li>
            </ul>
          </div>
          <p style="font-size:15px;margin-top:18px;"><b>Login Email:</b> ${he.encode(guardianEmail)}</p>
          <p style="font-size:15px;color:#888;">This password setup link will expire in 24 hours.</p>
          <p style="margin-top:18px;font-size:15px;">If you have any questions, please contact ${he.encode(organizationName)} directly.</p>
          <p style="color:#b80000;font-size:16px;font-weight:bold;margin-top:32px;text-align:center;letter-spacing:1px;">THIS IS A NO-REPLY MESSAGE. PLEASE DO NOT REPLY TO THIS EMAIL.</p>
        </div>
        <div style="background:#e6f7ec;color:#888;text-align:center;padding:18px 0;font-size:13px;">&copy; ${new Date().getFullYear()} Managira. All rights reserved.</div>
      </div>
    </div>
    `;

    const mailOptions = {
      from: process.env.ADMIN_NOTIFY_EMAIL_USER,
      to: guardianEmail,
      subject: `Welcome to ${organizationName} Parent Portal - Set Your Password`,
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
    console.log(`✅ Welcome email sent to guardian: ${guardianEmail}`);
  } catch (error) {
    console.error('Error sending guardian welcome email:', error);
  }
};

// Send notification when additional student is added to existing guardian
const sendGuardianStudentAddedEmail = async (guardianEmail, guardianFirstName, guardianLastName, studentName, organizationName) => {
  try {
    const transporter = nodemailer.createTransport({
      host: process.env.ADMIN_NOTIFY_SMTP_HOST,
      port: process.env.ADMIN_NOTIFY_SMTP_PORT,
      secure: process.env.ADMIN_NOTIFY_SMTP_SECURE === "true",
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
          <div style="color:#6fd3c4;font-size:24px;font-weight:600;margin-bottom:16px;letter-spacing:1px;">New Student Added to Your Account</div>
          <p style="font-size:16px;line-height:1.6;margin-bottom:18px;">Hello <b>${he.encode(guardianFirstName)} ${he.encode(guardianLastName)}</b>,</p>
          <p style="font-size:16px;line-height:1.6;margin-bottom:18px;"><b>${he.encode(studentName)}</b> has been added to your Parent Portal account at ${he.encode(organizationName)}.</p>
          <p style="font-size:16px;line-height:1.6;margin-bottom:18px;">You can now view their academic progress, grades, and teacher information by logging into your Parent Portal.</p>
          <div style="margin:24px 0;">
            <a href="${process.env.NODE_ENV === 'production' ? 'https://www.managira.com/account/login' : 'http://localhost:4000/account/login'}" style="background:#6fd3c4;color:#fff;padding:14px 32px;border-radius:6px;text-decoration:none;font-size:16px;font-weight:600;box-shadow:0 2px 8px #b2e2d6;display:inline-block;">Login to Parent Portal</a>
          </div>
          <p style="font-size:15px;margin-top:18px;"><b>Your Login Email:</b> ${he.encode(guardianEmail)}</p>
          <p style="color:#b80000;font-size:16px;font-weight:bold;margin-top:32px;text-align:center;letter-spacing:1px;">THIS IS A NO-REPLY MESSAGE. PLEASE DO NOT REPLY TO THIS EMAIL.</p>
        </div>
        <div style="background:#e6f7ec;color:#888;text-align:center;padding:18px 0;font-size:13px;">&copy; ${new Date().getFullYear()} Managira. All rights reserved.</div>
      </div>
    </div>
    `;

    const mailOptions = {
      from: process.env.ADMIN_NOTIFY_EMAIL_USER,
      to: guardianEmail,
      subject: `New Student Added - ${organizationName} Parent Portal`,
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
    console.log(`✅ Student added notification sent to guardian: ${guardianEmail}`);
  } catch (error) {
    console.error('Error sending student added email:', error);
  }
};

module.exports = {
  upload,
  isAuthenticated,
  commonController,
  sendInviteEmail,
  sendPasswordSetSuccessEmail,
  searchGuardiansApi,
  sendGuardianWelcomeEmail,
  sendGuardianStudentAddedEmail,
};
