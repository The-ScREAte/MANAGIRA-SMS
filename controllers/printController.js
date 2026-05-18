const {
  PutObjectCommand,
  GetObjectCommand,
  DeleteObjectCommand,
  ListObjectsV2Command,
} = require("@aws-sdk/client-s3");
const { s3Client } = require("../config/s3");
const db = require("../config/db");
const pdfParse = require("pdf-parse");
const Papa = require("papaparse");
const { Readable } = require("stream");
const path = require("path");
const bcrypt = require("bcryptjs");
const puppeteer = require("puppeteer");
const fs = require("fs");
const ejs = require("ejs");
const axios = require("axios");
const { sendEmailSafely } = require("../utils/emailHelper");
const { getOrganizationWebsiteInfo } = require("../utils/schoolWebsiteAccess");
// Lightweight async wrapper to avoid dependency errors
const asyncHandler = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
const organizationCache = {};
const CACHE_DURATION = 10 * 60 * 1000; // Cache organization data for 10 minutes
const NodeCache = require("node-cache");
const cache = new NodeCache({ stdTTL: 600 }); // Cache for 10 minutes

// Ensure signature metadata columns exist (safe to call multiple times)
let ensuredSignatureMeta = false;
async function ensureSignatureMetaColumns(dbClient) {
  if (ensuredSignatureMeta) return;
  try {
    await dbClient.query(
      "ALTER TABLE report_settings ADD COLUMN IF NOT EXISTS signature_name TEXT"
    );
    await dbClient.query(
      "ALTER TABLE report_settings ADD COLUMN IF NOT EXISTS signature_title TEXT"
    );
    ensuredSignatureMeta = true;
  } catch (err) {
    console.error("[ensureSignatureMetaColumns] Failed to add columns", err);
  }
}

// Helper functions for S3 actions
async function uploadToS3(key, file) {
  const command = new PutObjectCommand({
    Bucket: process.env.S3_BUCKET_NAME,
    Key: key,
    Body: file.buffer,
    ContentType: file.mimetype,
  });

  try {
    await s3Client.send(command);
    return key;
  } catch (error) {
        throw new Error("Could not upload file to S3.");
  }
}

async function getFromS3(key) {
  try {
    // Return the full URL to the image in S3 (public access assumed)
    return `https://${process.env.S3_BUCKET_NAME}.s3.amazonaws.com/${key}`;
  } catch (error) {
        throw new Error("Could not retrieve image from S3.");
  }
}

// Helper function to get correct ordinal suffix
function getOrdinalSuffix(n) {
  const s = ["th", "st", "nd", "rd"];
  const v = n % 100;
  return s[(v - 20) % 10] || s[v] || s[0];
}

async function deleteFromS3(key) {
  const command = new DeleteObjectCommand({
    Bucket: process.env.S3_BUCKET_NAME,
    Key: key,
  });

  try {
    await s3Client.send(command);
  } catch (error) {
        throw new Error("Could not delete file from S3.");
  }
}

// Helper function to fetch and cache organization details
async function getCachedOrganizationDetails(organizationId, db) {
  const cacheKey = `org_${organizationId}`;
  const cachedData = cache.get(cacheKey);
  if (cachedData) {
    return cachedData; // Data is already parsed
  }

  const organizationResult = await db.query(
    `
        SELECT organization_name, organization_address, organization_country, organization_province, organization_phone, email, logo_path 
        FROM organizations 
        WHERE organization_id = $1
    `,
    [organizationId]
  );

  const organization = organizationResult.rows[0];
  if (organization) {
    cache.set(cacheKey, organization); // Cache the data
  }

  return organization;
}

const assignScoreRemark = async (percentage, organizationId, db) => {
  const cacheKey = `remark_${organizationId}_${percentage}`;
  const cachedRemark = cache.get(cacheKey);
  if (cachedRemark) {
    return cachedRemark; // Data is already parsed in Node-Cache
  }

  const remarkResult = await db.query(
    `
        SELECT remark FROM score_remarks
        WHERE organization_id = $1
        AND $2::numeric BETWEEN from_percentage AND to_percentage
        LIMIT 1
    `,
    [organizationId, percentage]
  );

  const remark = remarkResult.rows[0]
    ? remarkResult.rows[0].remark
    : "No Remarks";

  cache.set(cacheKey, remark); // Cache the data
  return remark;
};

const printController = (db) => ({
  printStudentReport: async (req, res) => {
    const { classId, termId, studentId } = req.query;
    const organizationId = req.session.organizationId;
    await ensureSignatureMetaColumns(db);
    // Validate inputs
    if (!organizationId) {
      return res.status(400).send("Organization ID is not set in session.");
    }

    if (!classId || isNaN(classId)) {
      return res.status(400).send("Invalid or missing classId.");
    }

    if (!termId || isNaN(termId)) {
      return res.status(400).send("Invalid or missing termId.");
    }

    const parsedClassId = parseInt(classId, 10);
    const parsedTermId = parseInt(termId, 10);
    const parsedStudentId =
      studentId && !isNaN(studentId) ? parseInt(studentId, 10) : null;

    try {
      // Fetch organization details
      const organization = await getCachedOrganizationDetails(
        organizationId,
        db
      );
      if (!organization) {
        return res.status(404).send("Organization not found.");
      }

      const websiteInfo = await getOrganizationWebsiteInfo(db, organizationId);

      const logoUrl = organization.logo_path
        ? await getFromS3(organization.logo_path)
        : null;

      // Fetch class and term details
      const [classResult, termResult] = await Promise.all([
        db.query(
          "SELECT * FROM classes WHERE class_id = $1 AND organization_id = $2",
          [parsedClassId, organizationId]
        ),
        db.query(
          `SELECT t.term_name, t.start_date, t.end_date, sy.year_label
                     FROM terms t
                     JOIN school_years sy ON t.school_year_id = sy.id
                     WHERE t.term_id = $1 AND t.organization_id = $2`,
          [parsedTermId, organizationId]
        ),
      ]);

      const classData = classResult.rows[0];
      const term = termResult.rows[0];

      if (!classData) {
        return res
          .status(404)
          .send("Class not found for the given class ID and organization ID.");
      }

      if (!term) {
        return res.status(404).send("Term not found for the given term ID.");
      }

      // Fetch status settings
      const statusSettingsResult = await db.query(
        `SELECT cut_off_point, promoted_class, repeated_class, school_reopen_date, activate_promotion, term_end_date
         FROM status_settings
         WHERE organization_id = $1 AND class_id = $2
         LIMIT 1`,
        [organizationId, parsedClassId]
      );

      const statusSettings = statusSettingsResult.rows[0] || {};
      const cutOffPoint = statusSettings.cut_off_point || 50;
      const schoolReopenDate = statusSettings.school_reopen_date
        ? new Date(statusSettings.school_reopen_date).toLocaleDateString()
        : "TBA";
      const termEndDate = statusSettings.term_end_date
        ? new Date(statusSettings.term_end_date).toLocaleDateString()
        : new Date(term.end_date).toLocaleDateString();

      const promotedClassId = statusSettings.promoted_class;
      const repeatedClassId = statusSettings.repeated_class;

      // Fetch promoted/repeated class names
      const [promotedClassName, repeatedClassName] = await Promise.all([
        promotedClassId
          ? db
              .query("SELECT class_name FROM classes WHERE class_id = $1 AND organization_id = $2", [
                promotedClassId,
                organizationId,
              ])
              .then((res) => res.rows[0]?.class_name || "No Promoted Class")
          : "No Promoted Class",
        repeatedClassId
          ? db
              .query("SELECT class_name FROM classes WHERE class_id = $1 AND organization_id = $2", [
                repeatedClassId,
                organizationId,
              ])
              .then((res) => res.rows[0]?.class_name || "No Repeated Class")
          : "No Repeated Class",
      ]);

      // Fetch saved reports (filtered by studentId if provided)
      const savedReportsQuery = parsedStudentId
        ? `SELECT student_id, conduct_remarks, attitude_remarks, interest_remarks, teacher_remarks
         FROM student_reports
         WHERE organization_id = $1 AND class_id = $2 AND term_id = $3 AND student_id = $4`
        : `SELECT student_id, conduct_remarks, attitude_remarks, interest_remarks, teacher_remarks
         FROM student_reports
         WHERE organization_id = $1 AND class_id = $2 AND term_id = $3`;

      const savedReportsParams = parsedStudentId
        ? [organizationId, parsedClassId, parsedTermId, parsedStudentId]
        : [organizationId, parsedClassId, parsedTermId];

      const savedReportsResult = await db.query(
        savedReportsQuery,
        savedReportsParams
      );

      const savedReportsMap = Object.fromEntries(
        savedReportsResult.rows.map((report) => [report.student_id, report])
      );

      // Fetch attendance days
      const totalDaysResult = await db.query(
        `SELECT COUNT(*) AS total_days
                 FROM generate_series($1::date, LEAST($2::date, CURRENT_DATE), '1 day') AS all_dates
                 WHERE EXTRACT(ISODOW FROM all_dates) < 6`,
        [term.start_date, term.end_date]
      );
      const totalDays = totalDaysResult.rows[0]?.total_days || 0;

      // Fetch max scores for each subject
      const maxScoresResult = await db.query(
        `SELECT subject_id, SUM(max_score) AS max_score
                 FROM assessments
                 WHERE class_id = $1 AND term_id = $2 AND organization_id = $3
                 GROUP BY subject_id`,
        [parsedClassId, parsedTermId, organizationId]
      );

      const maxScoresMap = maxScoresResult.rows.reduce((map, row) => {
        map[row.subject_id] = row.max_score || 100;
        return map;
      }, {});

      // Fetch students, subjects, remarks, and scores
      const studentFilterId = parsedStudentId || null;

      const [
        studentsResult,
        subjectsResult,
        remarksResult,
        scoreRemarksResult,
        reportSettingsResult,
        attendanceResult,
        scoresResult,
        percentagesResult,
        subjectPositionsResult, // ✅ Add this
      ] = await Promise.all([
        db.query(
          `SELECT es.student_id, s.first_name, s.last_name, s.image_url, c.class_name
             FROM enrolled_students es
             JOIN students s ON es.student_id = s.student_id
             JOIN enrollments e ON es.enrollment_id = e.enrollment_id
             JOIN classes c ON es.class_id = c.class_id
             WHERE es.class_id = $1 AND e.term_id = $2 AND e.organization_id = $3
               AND ($4::int IS NULL OR es.student_id = $4)`,
          [parsedClassId, parsedTermId, organizationId, studentFilterId]
        ),
        db.query(
          "SELECT subject_id, subject_name FROM subjects WHERE class_id = $1 AND organization_id = $2",
          [parsedClassId, organizationId]
        ),
        db.query(
          "SELECT id, remark, remark_type FROM remarks WHERE organization_id = $1",
          [organizationId]
        ),
        db.query(
          'SELECT from_percentage AS "fromPercentage", to_percentage AS "toPercentage", remark FROM score_remarks WHERE organization_id = $1 AND class_id = $2 AND term_id = $3',
          [organizationId, parsedClassId, parsedTermId]
        ),
        db.query(
          "SELECT signature_image_path, signature_name, signature_title FROM report_settings WHERE class_id = $1 AND term_id = $2 AND organization_id = $3",
          [parsedClassId, parsedTermId, organizationId]
        ),
        db.query(
          `SELECT student_id, COUNT(*) FILTER (WHERE status = 'Present') AS present_days
             FROM attendance_records
             WHERE class_id = $1 AND term_id = $2 AND organization_id = $3
             GROUP BY student_id`,
          [parsedClassId, parsedTermId, organizationId]
        ),
        db.query(
          `SELECT ar.student_id, ar.subject_id, a.category,
                    SUM(ar.score) AS total_score
             FROM assessment_results ar
             JOIN assessments a ON a.assessment_id = ar.assessment_id
             WHERE ar.class_id = $1
               AND ar.term_id = $2
               AND ar.organization_id = $3
             GROUP BY ar.student_id, ar.subject_id, a.category`,
          [parsedClassId, parsedTermId, organizationId]
        ),
        db.query(
          `SELECT student_id, subject_id, total_percentage, grade
             FROM assessment_results
             WHERE class_id = $1 AND term_id = $2 AND organization_id = $3`,
          [parsedClassId, parsedTermId, organizationId]
        ),
        db.query(
          `SELECT student_id, subject_id, position
             FROM student_positions
             WHERE class_id = $1 AND term_id = $2 AND organization_id = $3`,
          [parsedClassId, parsedTermId, organizationId]
        ),
      ]);

      // Map scores for easy access
      const scoresMap = scoresResult.rows.reduce((acc, row) => {
        acc[`${row.student_id}_${row.subject_id}_${row.category}`] =
          row.total_score || 0;
        return acc;
      }, {});

      percentagesResult.rows.forEach((row) => {
        scoresMap[`${row.student_id}_${row.subject_id}_total_percentage`] =
          row.total_percentage || "-";
        scoresMap[`${row.student_id}_${row.subject_id}_grade`] =
          row.grade || "-";
      });

      // ✅ Put this HERE, AFTER scoresMap is declared
      subjectPositionsResult.rows.forEach((row) => {
        scoresMap[`${row.student_id}_${row.subject_id}_subject_position`] =
          row.position || null;
      });

      const students = studentsResult.rows;
      const allSubjects = subjectsResult.rows;
      const teacherRemarks = remarksResult.rows.filter(
        (r) => r.remark_type === "teacher"
      );
      const conductRemarks = remarksResult.rows.filter(
        (r) => r.remark_type === "conduct"
      );
      const interestRemarks = remarksResult.rows.filter(
        (r) => r.remark_type === "interest"
      );
      const attitudeRemarks = remarksResult.rows.filter(
        (r) => r.remark_type === "attitude"
      );
      const scoreRemarks = scoreRemarksResult.rows;
      const signatureImagePath =
        reportSettingsResult.rows[0]?.signature_image_path;
      const signatureName = reportSettingsResult.rows[0]?.signature_name || null;
      const signatureTitle = reportSettingsResult.rows[0]?.signature_title || null;
      const signatureImageUrl = signatureImagePath
        ? await getFromS3(signatureImagePath)
        : null;

      const attendanceMap = Object.fromEntries(
        attendanceResult.rows.map((record) => [
          record.student_id,
          record.present_days || 0,
        ])
      );

      percentagesResult.rows.forEach((row) => {
        scoresMap[`${row.student_id}_${row.subject_id}_total_percentage`] =
          row.total_percentage || "-";
        scoresMap[`${row.student_id}_${row.subject_id}_grade`] =
          row.grade || "-";
      });

      // Process students
      const getCategoryScore = (studentId, subjectId, categories) =>
        categories.reduce(
          (total, categoryName) =>
            total +
            parseFloat(scoresMap[`${studentId}_${subjectId}_${categoryName}`] || 0),
          0
        );

      students.forEach((student) => {
        const savedReport = savedReportsMap[student.student_id] || {};

        student.conductRemarks = savedReport.conduct_remarks || "";
        student.attitudeRemarks = savedReport.attitude_remarks || "";
        student.interestRemarks = savedReport.interest_remarks || "";
        student.teacherRemarks = savedReport.teacher_remarks || "";

        let totalScoreSum = 0;
        let totalPercentageSum = 0;
        let subjectCount = 0;

        // ✅ NEW: Assign class position to student
        student.positionInClass = student.class_position
          ? `${student.class_position}${getOrdinalSuffix(
              student.class_position
            )}`
          : "-";

        student.subjects = allSubjects.map((subject) => {
          const maxScore = maxScoresMap[subject.subject_id] || 100;

          const classScore = getCategoryScore(student.student_id, subject.subject_id, [
            "Class Assessment",
          ]);
          const examsScore = getCategoryScore(student.student_id, subject.subject_id, [
            "Exams Assessment",
            "Exam Assessment",
          ]);
          const otherScore = getCategoryScore(student.student_id, subject.subject_id, [
            "Other",
            "Other Assessment",
          ]);

          const totalScore = classScore + examsScore + otherScore;
          const totalPercentage =
            scoresMap[
              `${student.student_id}_${subject.subject_id}_total_percentage`
            ] || "-";
          const grade =
            scoresMap[`${student.student_id}_${subject.subject_id}_grade`] ||
            "-";

          const matchingRemark = scoreRemarks.find(
            (rule) =>
              parseFloat(totalPercentage) >= parseFloat(rule.fromPercentage) &&
              parseFloat(totalPercentage) <= parseFloat(rule.toPercentage)
          );
          const remarks =
            totalPercentage > 0
              ? matchingRemark
                ? matchingRemark.remark
                : "-"
              : "-";

          if (totalPercentage > 0) {
            totalPercentageSum += parseFloat(totalPercentage);
            subjectCount++;
          }
          totalScoreSum += totalScore;

          return {
            subject_name: subject.subject_name,
            classAssessmentScore: classScore > 0 ? classScore.toFixed(2) : "-",
            examsAssessmentScore: examsScore > 0 ? examsScore.toFixed(2) : "-",
            otherAssessmentScore: otherScore > 0 ? otherScore.toFixed(2) : "-",
            totalScore: totalScore > 0 ? totalScore.toFixed(2) : "-",
            totalPercentage: totalPercentage > 0 ? `${totalPercentage} %` : "-",
            grade,
            remarks,

            // ✅ NEW: Assign subject position
            position:
              totalScore > 0 &&
              scoresMap[
                `${student.student_id}_${subject.subject_id}_subject_position`
              ]
                ? `${
                    scoresMap[
                      `${student.student_id}_${subject.subject_id}_subject_position`
                    ]
                  }${getOrdinalSuffix(
                    scoresMap[
                      `${student.student_id}_${subject.subject_id}_subject_position`
                    ]
                  )}`
                : "-",
          };
        });
        

        student.totalScoreSum = totalScoreSum;
        student.overallPercentage =
          subjectCount > 0
            ? ((totalPercentageSum / (subjectCount * 100)) * 100).toFixed(2)
            : "0.00";

        student.attendance = {
          presentDays: attendanceMap[student.student_id] || 0,
          totalDays,
        };

        student.promotionClass =
          student.overallPercentage >= cutOffPoint
            ? promotedClassName
            : repeatedClassName;
        student.promotionStatus =
          student.overallPercentage >= cutOffPoint ? "Promoted" : "Repeated";
      });



      // Assign class position based on overall percentage
// Assign class position based on overall percentage
students
  .filter((s) => !isNaN(parseFloat(s.overallPercentage)))
  .sort(
    (a, b) =>
      parseFloat(b.overallPercentage) - parseFloat(a.overallPercentage)
  )
  .forEach((student, index, arr) => {
    if (
      index > 0 &&
      parseFloat(student.overallPercentage) ===
        parseFloat(arr[index - 1].overallPercentage)
    ) {
      student.class_position = arr[index - 1].class_position; // Tie: same position as previous
    } else {
      student.class_position = index + 1; // Otherwise assign current index + 1
    }

    // Add ordinal suffix
    student.positionInClass = `${student.class_position}${getOrdinalSuffix(student.class_position)}`;

    // ✅ INSERT PROMOTION CLASS ID SETTING HERE
    if (student.overallPercentage >= cutOffPoint) {
      student.promotionClass = promotedClassName;
      student.promotionStatus = "Promoted";
      student.promotionClassId = promotedClassId; // ✅ SET promotion class id
    } else {
      student.promotionClass = repeatedClassName;
      student.promotionStatus = "Repeated";
      student.promotionClassId = repeatedClassId; // ✅ SET repeated class id
    }
  });

      // ✅ Auto-save promotion status to student_reports so promotion scheduler has data
      if (statusSettings.activate_promotion && cutOffPoint > 0) {
        try {
          const autoSavePromises = students
            .filter(s => s.promotionStatus && s.promotionClassId)
            .map(student =>
              db.query(
                `INSERT INTO student_reports (
                  organization_id, class_id, term_id, student_id,
                  promotion_status, promotion_class_id
                ) VALUES ($1, $2, $3, $4, $5, $6)
                ON CONFLICT (organization_id, class_id, term_id, student_id)
                DO UPDATE SET
                  promotion_status = EXCLUDED.promotion_status,
                  promotion_class_id = EXCLUDED.promotion_class_id,
                  updated_at = CURRENT_TIMESTAMP`,
                [
                  organizationId,
                  parsedClassId,
                  parsedTermId,
                  student.student_id,
                  student.promotionStatus,
                  student.promotionClassId,
                ]
              )
            );
          await Promise.all(autoSavePromises);
          console.log(`[printStudentReport] Auto-saved promotion status for ${autoSavePromises.length} students`);
        } catch (autoSaveErr) {
          console.error("[printStudentReport] Auto-save promotion status failed (non-blocking):", autoSaveErr.message);
        }
      }

      // Render the report
      res.render("print/printStudentReport", {
        title: "Student Final Report",
        students,
        orgName: organization.organization_name || "Default School Name",
        orgAddress: organization.organization_address,
        orgCountry: organization.organization_country,
        orgProvince: organization.organization_province,
        orgPhone: organization.organization_phone,
        email: organization.email,
        logoUrl,
        signatureImageUrl,
        signatureName,
        signatureTitle,
        term,
        schoolYearLabel: term.year_label || "No School Year Available",
        termEndDate,
        teacherRemarks,
        conductRemarks,
        interestRemarks,
        attitudeRemarks,
        scoreRemarks,
        classId: parsedClassId,
        termId: parsedTermId,
        schoolReopenDate,
        promotedClass: promotedClassName,
        repeatedClass: repeatedClassName,
        activatePromotion: statusSettings.activate_promotion,
        remarks: {
          // ✅ Pass remarks in an object for clarity
          teacher: teacherRemarks,
          conduct: conductRemarks,
          interest: interestRemarks,
          attitude: attitudeRemarks,
        },
        promotedClass: promotedClassName,
        repeatedClass: repeatedClassName,
        promotedClassId,       // ✅ add this
        repeatedClassId, 
        hasSchoolWebsite: websiteInfo.hasWebsite,
        schoolWebsiteHost: websiteInfo.websiteHost,
        reportYear: new Date().getFullYear(),
      });
    } catch (error) {
            res.status(500).send("Failed to generate student report.");
    }
  },

  reportSettingsPage: async (req, res) => {
    const { classId, termId } = req.query;
    const organizationId = req.session.organizationId;
    await ensureSignatureMetaColumns(db);

    try {
      const organizationClassesResult = await db.query(
        `SELECT class_id, class_name FROM classes WHERE organization_id = $1 ORDER BY class_name ASC`,
        [organizationId],
      );
      const organizationClasses = organizationClassesResult.rows;

      const currentTermResult = await db.query(
        `SELECT term_id FROM terms WHERE organization_id = $1 AND current = TRUE ORDER BY start_date DESC LIMIT 1`,
        [organizationId],
      );

      let fallbackTermId = currentTermResult.rows[0]?.term_id;
      if (!fallbackTermId) {
        const latestTermResult = await db.query(
          `SELECT term_id FROM terms WHERE organization_id = $1 ORDER BY start_date DESC LIMIT 1`,
          [organizationId],
        );
        fallbackTermId = latestTermResult.rows[0]?.term_id;
      }

      if (organizationClasses.length === 0 || !fallbackTermId) {
        return res.render("print/reportSettings", {
          title: "Report Settings",
          statusSettings: {},
          groupedStatusSettings: [],
          remarks: [],
          scoreRemarks: [],
          availableClasses: [],
          signatureImageUrl: null,
          signatureName: null,
          signatureTitle: null,
          signatureGroups: {},
          transcriptSignatureGroups: {},
          statusSettingsClasses: [],
          enrolledClasses: organizationClasses,
          classId: null,
          termId: fallbackTermId || null,
          setupRequired: true,
          setupMessage: "This is for classes. Kindly start by adding classes and setting up your school first to be able to access it.",
          messages: req.flash(),
        });
      }

      let resolvedClassId = classId;
      let resolvedTermId = termId;

      if (!resolvedClassId || isNaN(resolvedClassId) || !resolvedTermId || isNaN(resolvedTermId)) {
        return res.redirect(
          `/print/reportSettings?classId=${organizationClasses[0].class_id}&termId=${fallbackTermId}`,
        );
      }

      const parsedClassId = parseInt(resolvedClassId, 10);
      const parsedTermId = parseInt(resolvedTermId, 10);

      // Validate that classId belongs to current organization
      const classCheck = await db.query(
        `SELECT class_id FROM classes WHERE class_id = $1 AND organization_id = $2`,
        [parsedClassId, organizationId]
      );
      if (classCheck.rows.length === 0) {
        // ClassId doesn't belong to this org, redirect to fallback
        return res.redirect(`/print/reportSettings?classId=${organizationClasses[0].class_id}&termId=${parsedTermId}`);
      }
  
      // Fetch all classes with saved status settings for the given term
      const savedClassesResult = await db.query(
        `SELECT DISTINCT class_id FROM status_settings 
         WHERE organization_id = $1 AND term_id = $2`,
        [organizationId, parsedTermId]
      );
      const statusSettingsClasses = savedClassesResult.rows.map(
        (row) => row.class_id
      );
  
      // Fetch enrolled classes
      const enrolledClasses = organizationClasses;
  
      // Fetch remarks
      const remarksResult = await db.query(
        `SELECT id, remark, remark_type FROM remarks 
         WHERE organization_id = $1`,
        [organizationId]
      );
      const remarks = remarksResult.rows || [];
  
      // Fetch score remarks for all classes in this term
      const scoreRemarksResult = await db.query(
        `SELECT * FROM score_remarks 
         WHERE organization_id = $1 AND term_id = $2
         ORDER BY class_id, from_percentage ASC`,
        [organizationId, parsedTermId]
      );
      const scoreRemarks = scoreRemarksResult.rows || [];
  
      // Fetch signature image for this class/term
      const reportSettingsResult = await db.query(
        `SELECT signature_image_path, signature_name, signature_title FROM report_settings 
         WHERE organization_id = $1 AND class_id = $2 AND term_id = $3`,
        [organizationId, parsedClassId, parsedTermId]
      );
      const reportSettings = reportSettingsResult.rows[0];
      let signatureImageUrl = null;
      const signatureName = reportSettings?.signature_name || null;
      const signatureTitle = reportSettings?.signature_title || null;
      if (reportSettings && reportSettings.signature_image_path) {
        signatureImageUrl = await getFromS3(reportSettings.signature_image_path);
      }
  
      // Fetch all signature groups for current term
      const signatureClassesResult = await db.query(
        `SELECT DISTINCT class_id, signature_image_path, signature_name, signature_title FROM report_settings 
         WHERE organization_id = $1 AND term_id = $2 AND signature_image_path IS NOT NULL`,
        [organizationId, parsedTermId]
      );
  
      const signatureGroups = {};
      for (const row of signatureClassesResult.rows) {
        if (!signatureGroups[row.signature_image_path]) {
          signatureGroups[row.signature_image_path] = {
            classes: [],
            signature_image_url: await getFromS3(row.signature_image_path),
            signature_name: row.signature_name || null,
            signature_title: row.signature_title || null,
          };
        }
        const classInfo = enrolledClasses.find(
          (c) => c.class_id === row.class_id
        );
        signatureGroups[row.signature_image_path].classes.push({
          class_id: row.class_id,
          class_name: classInfo?.class_name || "Unknown Class",
        });
      }
      
      console.log(`[reportSettingsPage] Found ${Object.keys(signatureGroups).length} signature groups for term ${parsedTermId}:`, 
        Object.entries(signatureGroups).map(([path, data]) => ({
          path: path.substring(path.lastIndexOf('/') + 1),
          classes: data.classes.map(c => c.class_name).join(', ')
        }))
      );
  
      const assignedClassIds = signatureClassesResult.rows.map(
        (row) => row.class_id
      );
      const availableClasses = enrolledClasses.filter(
        (c) => !assignedClassIds.includes(c.class_id)
      );

      // Fetch transcript signatures (term_id = -1)
      const transcriptSignatureClassesResult = await db.query(
        `SELECT DISTINCT class_id, signature_image_path, signature_name, signature_title FROM report_settings 
         WHERE organization_id = $1 AND term_id = -1 AND signature_image_path IS NOT NULL`,
        [organizationId]
      );

      const transcriptSignatureGroups = {};
      for (const row of transcriptSignatureClassesResult.rows) {
        if (!transcriptSignatureGroups[row.signature_image_path]) {
          transcriptSignatureGroups[row.signature_image_path] = {
            classes: [],
            signature_image_url: await getFromS3(row.signature_image_path),
            signature_name: row.signature_name || null,
            signature_title: row.signature_title || null,
          };
        }
        const classInfo = enrolledClasses.find(
          (c) => c.class_id === row.class_id
        );
        transcriptSignatureGroups[row.signature_image_path].classes.push({
          class_id: row.class_id,
          class_name: classInfo?.class_name || "Unknown Class",
        });
      }
      
      console.log(`[reportSettingsPage] Found ${Object.keys(transcriptSignatureGroups).length} transcript signature groups:`, 
        Object.entries(transcriptSignatureGroups).map(([path, data]) => ({
          path: path.substring(path.lastIndexOf('/') + 1),
          classes: data.classes.map(c => c.class_name).join(', ')
        }))
      );
  
      // ✅ Fetch grouped status settings for this term only
      const groupedStatusSettingsResult = await db.query(
        `SELECT 
          promoted_class, 
          repeated_class, 
          activate_promotion, 
          cut_off_point, 
          school_reopen_date,
          array_agg(class_id ORDER BY class_id ASC) AS classes
        FROM status_settings
        WHERE organization_id = $1 AND term_id = $2
        GROUP BY promoted_class, repeated_class, activate_promotion, cut_off_point, school_reopen_date`,
        [organizationId, parsedTermId]
      );
  
      // ✅ Map with correct typing
      const groupedStatusSettings = groupedStatusSettingsResult.rows.map(
        (setting) => ({
          ...setting,
          promoted_class: setting.promoted_class
            ? parseInt(setting.promoted_class)
            : null,
          repeated_class: setting.repeated_class
            ? parseInt(setting.repeated_class)
            : null,
          classes: setting.classes.map((id) => parseInt(id)),
        })
      );
  
      res.render("print/reportSettings", {
        title: "Report Settings",
        statusSettings: {},
        groupedStatusSettings,
        remarks,
        scoreRemarks,
        availableClasses,
        signatureImageUrl,
        signatureName,
        signatureTitle,
        signatureGroups,
        transcriptSignatureGroups,
        statusSettingsClasses,
        enrolledClasses,
        classId: parsedClassId,
        termId: parsedTermId,
        setupRequired: false,
        setupMessage: null,
        messages: req.flash(),
      });
    } catch (error) {
            res.status(500).send("Failed to load report settings page.");
    }
  },

  deleteStatusSettings: async (req, res) => {
    const { classId, termId } = req.query;
    const organizationId = req.session.organizationId;

    try {
      await db.query(
        `DELETE FROM status_settings WHERE organization_id = $1 AND class_id = $2`,
        [organizationId, classId]
      );
      req.flash("success_msg", "Status settings deleted.");
      res.redirect(`/print/reportSettings?classId=${classId}&termId=${termId}`);
    } catch (error) {
            req.flash("error_msg", "Failed to delete.");
      res.redirect(`/print/reportSettings?classId=${classId}`);
    }
  },
  
  updateReportSettings: async (req, res) => {
    const { classId } = req.query;
    const organizationId = req.session.organizationId;
    const { schoolReopenDate, activatePromotion } = req.body;

    try {
      const activatePromotionStatus = activatePromotion === "on"; // If checked, this will be 'on'

      await db.query(
        `
                UPDATE status_settings 
                SET school_reopen_date = $1, activate_promotion = $2 
                WHERE organization_id = $3 AND class_id = $4
            `,
        [schoolReopenDate, activatePromotionStatus, organizationId, classId]
      );

      req.flash("success", "Settings updated successfully");
      res.redirect(`/print/reportSettings?classId=${classId}`);
    } catch (error) {
            req.flash("error", "Failed to update settings.");
      res.redirect(`/print/reportSettings?classId=${classId}`);
    }
  },

  savePromotionSettings: async (req, res) => {
    const {
      cutOffPoint,
      promotedClass,
      repeatedClass,
      schoolReopenDate,
      termEndDate,
      activatePromotion,
      selectedStatusClasses,
      classId: formClassId,
      termId: formTermId,
    } = req.body;
  
    const organizationId = req.session.organizationId;
    const fallbackClassId = formClassId || req.query.classId;
    const termId = formTermId || req.query.termId;
  
    try {
      console.log("[savePromotionSettings] incoming", {
        cutOffPoint,
        promotedClass,
        repeatedClass,
        schoolReopenDate,
        termEndDate,
        activatePromotion,
        selectedStatusClasses,
        formClassId,
        formTermId,
        queryClassId: req.query.classId,
        queryTermId: req.query.termId,
      });

      if (!organizationId) {
        req.flash("error", "Organization ID is not set in session.");
        return res.redirect(
          `/print/reportSettings?classId=${fallbackClassId}&termId=${termId}`
        );
      }
  
      if (!termId || isNaN(termId)) {
        req.flash("error", "Invalid or missing termId.");
        return res.redirect(
          `/print/reportSettings?classId=${fallbackClassId}&termId=${termId}`
        );
      }
  
      const parsedTermId = parseInt(termId, 10);
      const parsedClassId = parseInt(formClassId || fallbackClassId, 10);
  
      if (isNaN(parsedClassId) || isNaN(parsedTermId)) {
        req.flash("error", "Invalid class or term ID.");
        return res.redirect(
          `/print/reportSettings?classId=${fallbackClassId}&termId=${termId}`
        );
      }
  
      let classesToApply = Array.isArray(selectedStatusClasses)
        ? selectedStatusClasses.map((id) => parseInt(id, 10))
        : selectedStatusClasses
        ? [parseInt(selectedStatusClasses, 10)]
        : [parsedClassId];

      classesToApply = classesToApply.filter((id) => !isNaN(id));

      if (!classesToApply.length) {
        req.flash("error", "No class selected for status settings.");
        return res.redirect(
          `/print/reportSettings?classId=${fallbackClassId}&termId=${termId}`
        );
      }
  
      for (const classIdToSave of classesToApply) {
        // Check if setting exists for this org + class (constraint is on org + class only)
        const existing = await db.query(
          `SELECT id, term_id FROM status_settings 
           WHERE organization_id = $1 AND class_id = $2`,
          [organizationId, classIdToSave]
        );
  
        if (existing.rows.length > 0) {
          const existingTermId = existing.rows[0].term_id;
          
          // Update existing record with new values
          await db.query(
            `UPDATE status_settings SET
              term_id = $1,
              cut_off_point = $2,
              promoted_class = $3,
              repeated_class = $4,
              school_reopen_date = $5,
              term_end_date = $6,
              activate_promotion = $7
            WHERE organization_id = $8 AND class_id = $9`,
            [
              parsedTermId,
              parseInt(cutOffPoint, 10) || null,
              promotedClass || null,
              repeatedClass || null,
              schoolReopenDate || null,
              termEndDate || null,
              activatePromotion === "on",
              organizationId,
              classIdToSave,
            ]
          );
          
          console.log(`[savePromotionSettings] Updated existing setting for class ${classIdToSave} from term ${existingTermId} to ${parsedTermId}`);
        } else {
          // Insert new record
          await db.query(
            `INSERT INTO status_settings (
              organization_id, class_id, term_id, cut_off_point, promoted_class,
              repeated_class, school_reopen_date, term_end_date, activate_promotion
            ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
            [
              organizationId,
              classIdToSave,
              parsedTermId,
              parseInt(cutOffPoint, 10) || null,
              promotedClass || null,
              repeatedClass || null,
              schoolReopenDate || null,
              termEndDate || null,
              activatePromotion === "on",
            ]
          );
          
          console.log(`[savePromotionSettings] Inserted new setting for class ${classIdToSave}, term ${parsedTermId}`);
        }
      }
  
      req.flash("success", "Promotion settings processed.");
      res.redirect(
        `/print/reportSettings?classId=${fallbackClassId}&termId=${parsedTermId}`
      );
    } catch (error) {
      console.error("[savePromotionSettings] error", error);
            req.flash("error", "Error saving promotion settings.");
      res.redirect(
        `/print/reportSettings?classId=${fallbackClassId}&termId=${termId}`
      );
    }
  },
  

  saveRemarks: async (req, res) => {
    const organizationId = req.session.organizationId;
    const remarks = req.body["remarks[]"] || req.body.remarks || [];
    const remarkTypes = req.body["remarkType[]"] || req.body.remarkType || [];
    const { classId, termId } = req.query; // Get classId and termId from the query parameters

    if (!organizationId) {
      req.flash("error", "Organization ID is not set in session.");
      return res.redirect(`/print/reportSettings`);
    }

    try {
      // Convert remarks and remarkTypes to arrays if they are single values
      const remarksArray = Array.isArray(remarks) ? remarks : [remarks];
      const remarkTypesArray = Array.isArray(remarkTypes)
        ? remarkTypes
        : [remarkTypes];

      // Insert each remark and corresponding remark type
      for (let i = 0; i < remarksArray.length; i++) {
        await db.query(
          `
                    INSERT INTO remarks (organization_id, remark, remark_type)
                    VALUES ($1, $2, $3)
                `,
          [organizationId, remarksArray[i], remarkTypesArray[i]]
        );
      }

      req.flash("success", "Remarks saved successfully.");
      res.redirect(`/print/reportSettings?classId=${classId}&termId=${termId}`);
    } catch (error) {
            req.flash("error", "Failed to save remarks.");
      res.redirect(`/print/reportSettings?classId=${classId}&termId=${termId}`);
    }
  },

  deleteRemark: async (req, res) => {
    const { id } = req.params;
    const { classId, termId } = req.query; // Get classId and termId from the query parameters
    const organizationId = req.session.organizationId;

    try {
      if (!organizationId) {
        req.flash("error", "Unauthorized.");
        return res.redirect(`/print/reportSettings?classId=${classId}&termId=${termId}`);
      }
      // Tenant boundary: remark id must belong to caller's org.
      await db.query(
        "DELETE FROM remarks WHERE id = $1 AND organization_id = $2",
        [id, organizationId]
      );
      req.flash("success", "Remark deleted successfully.");
      res.redirect(`/print/reportSettings?classId=${classId}&termId=${termId}`);
    } catch (error) {
            req.flash("error", "Error deleting remark.");
      res.redirect(`/print/reportSettings?classId=${classId}&termId=${termId}`);
    }
  },

  saveScoreRemarks: async (req, res) => {
    const { remark, from_percentage, to_percentage, classId } = req.body;
    const organizationId = req.session.organizationId;
    const termId = req.body.termId;

    console.log("[saveScoreRemarks] incoming", {
      remark,
      from_percentage,
      to_percentage,
      termId,
      classId,
      organizationId,
    });

    try {
      if (!organizationId) {
        console.error("[saveScoreRemarks] Missing organizationId");
        req.flash("error", "Organization ID is not set in session.");
        return res.redirect(`/print/reportSettings?termId=${termId || ""}`);
      }

      if (!termId || isNaN(termId)) {
        console.error("[saveScoreRemarks] Invalid or missing termId:", termId);
        req.flash("error", "Invalid or missing term ID.");
        return res.redirect(`/print/reportSettings`);
      }

      if (!classId || isNaN(classId)) {
        console.error("[saveScoreRemarks] Invalid or missing classId:", classId);
        req.flash("error", "Invalid or missing class ID.");
        return res.redirect(`/print/reportSettings?termId=${termId}`);
      }

      if (!remark || remark.trim() === "") {
        console.error("[saveScoreRemarks] Missing remark");
        req.flash("error", "Remark text is required.");
        return res.redirect(`/print/reportSettings?classId=${classId}&termId=${termId}`);
      }

      const parsedTermId = parseInt(termId, 10);
      const parsedClassId = parseInt(classId, 10);

      // Basic range validation
      const fromPct = parseFloat(from_percentage);
      const toPct = parseFloat(to_percentage);
      
      console.log("[saveScoreRemarks] parsed percentages:", { fromPct, toPct });

      if (
        Number.isNaN(fromPct) ||
        Number.isNaN(toPct) ||
        fromPct < 0 ||
        toPct > 100 ||
        fromPct > toPct
      ) {
        console.error("[saveScoreRemarks] Invalid percentage range:", { fromPct, toPct });
        req.flash("error", "Provide a valid percentage range (0-100, from <= to).");
        return res.redirect(`/print/reportSettings?classId=${parsedClassId}&termId=${parsedTermId}`);
      }

      // Insert or update for the selected class
      console.log("[saveScoreRemarks] Saving for class:", parsedClassId);
      await db.query(
        `
          INSERT INTO score_remarks (organization_id, class_id, term_id, remark, from_percentage, to_percentage)
          VALUES ($1, $2, $3, $4, $5, $6)
          ON CONFLICT (organization_id, class_id, remark) DO UPDATE
          SET term_id = EXCLUDED.term_id,
              from_percentage = EXCLUDED.from_percentage,
              to_percentage = EXCLUDED.to_percentage
        `,
        [organizationId, parsedClassId, parsedTermId, remark, fromPct, toPct]
      );

      console.log("[saveScoreRemarks] Successfully saved");
      req.flash("success", "Score remark saved successfully.");
      res.redirect(`/print/reportSettings?classId=${parsedClassId}&termId=${parsedTermId}`);
    } catch (error) {
      console.error("[saveScoreRemarks] error", error);
      req.flash("error", "Failed to save score remark.");
      res.redirect(`/print/reportSettings?classId=${classId || ""}&termId=${termId || ""}`);
    }
  },

  deleteScoreRemark: async (req, res) => {
    const { id } = req.params;
    const { termId, classId } = req.query;

    try {
      if (!termId) {
        req.flash("error", "Invalid or missing termId.");
        return res.redirect("/print/reportSettings");
      }

      await db.query("DELETE FROM score_remarks WHERE id = $1", [id]);

      req.flash("success", "Score remark deleted successfully.");
      res.redirect(`/print/reportSettings?classId=${classId || ""}&termId=${termId}`);
    } catch (error) {
            req.flash("error", "Error deleting score remark.");
      res.redirect(`/print/reportSettings?classId=${classId || ""}&termId=${termId}`);
    }
  },

  saveScoreRemarksAjax: async (req, res) => {
    const { remark, from_percentage, to_percentage, termId, selectedClasses } = req.body;
    const organizationId = req.session.organizationId;

    console.log("[saveScoreRemarksAjax] incoming", {
      remark,
      from_percentage,
      to_percentage,
      termId,
      selectedClasses,
      organizationId,
    });

    try {
      if (!organizationId) {
        return res.json({ success: false, message: "Organization ID is not set in session." });
      }

      if (!termId || isNaN(termId)) {
        return res.json({ success: false, message: "Invalid or missing term ID." });
      }

      if (!selectedClasses || !Array.isArray(selectedClasses) || selectedClasses.length === 0) {
        return res.json({ success: false, message: "Please select at least one class." });
      }

      if (!remark || remark.trim() === "") {
        return res.json({ success: false, message: "Remark text is required." });
      }

      const parsedTermId = parseInt(termId, 10);
      const fromPct = parseFloat(from_percentage);
      const toPct = parseFloat(to_percentage);

      if (
        Number.isNaN(fromPct) ||
        Number.isNaN(toPct) ||
        fromPct < 0 ||
        toPct > 100 ||
        fromPct > toPct
      ) {
        return res.json({ success: false, message: "Provide a valid percentage range (0-100, from <= to)." });
      }

      const savedRemarks = [];

      for (const classId of selectedClasses) {
        const parsedClassId = parseInt(classId, 10);
        
        const result = await db.query(
          `
            INSERT INTO score_remarks (organization_id, class_id, term_id, remark, from_percentage, to_percentage)
            VALUES ($1, $2, $3, $4, $5, $6)
            ON CONFLICT (organization_id, class_id, remark) DO UPDATE
            SET term_id = EXCLUDED.term_id,
                from_percentage = EXCLUDED.from_percentage,
                to_percentage = EXCLUDED.to_percentage
            RETURNING *
          `,
          [organizationId, parsedClassId, parsedTermId, remark, fromPct, toPct]
        );

        savedRemarks.push(result.rows[0]);
      }

      console.log("[saveScoreRemarksAjax] Successfully saved");
      res.json({ success: true, savedRemarks });
    } catch (error) {
      console.error("[saveScoreRemarksAjax] error", error);
      res.json({ success: false, message: "Failed to save score remark." });
    }
  },

  uploadSignatureImage: async (req, res) => {
    const { file } = req;
    const organizationId = req.session.organizationId;
    const { classId, termId, applyAllClasses, selectedSignatureClasses, signatureName, signatureTitle } =
      req.body;
    await ensureSignatureMetaColumns(db);

    if (!file) {
      req.flash("error", "No signature provided.");
      return res.redirect(
        `/print/reportSettings?classId=${classId}&termId=${termId}`
      );
    }

    try {
      if (!organizationId) {
        req.flash("error", "Organization ID is not set in session.");
        return res.redirect(
          `/print/reportSettings?classId=${classId}&termId=${termId}`
        );
      }

      if (!termId) {
        req.flash("error", "Invalid or missing termId.");
        return res.redirect(`/print/reportSettings?classId=${classId}`);
      }

      let classesToApply = [];
      if (applyAllClasses) {
        const allClassesResult = await db.query(
          "SELECT class_id FROM classes WHERE organization_id = $1",
          [organizationId]
        );
        classesToApply = allClassesResult.rows.map((row) => row.class_id);
      } else if (Array.isArray(selectedSignatureClasses)) {
        classesToApply = selectedSignatureClasses.map((id) => parseInt(id, 10));
      } else if (selectedSignatureClasses) {
        classesToApply = [parseInt(selectedSignatureClasses, 10)];
      } else if (classId) {
        classesToApply = [parseInt(classId, 10)];
      }

      const timestamp = Date.now();
      const randomSuffix = Math.random().toString(36).substring(2, 8);
      const filename = `signature-${timestamp}-${randomSuffix}.png`;
      const key = `images/reportsignature/${organizationId}/${filename}`;
      const uploadedKey = await uploadToS3(key, file);
      
      console.log(`[uploadSignatureImage] Created new signature: ${filename} for classes:`, classesToApply);

      for (const currentClassId of classesToApply) {
        // Get the existing signature path for this class
        const existingSignatureResult = await db.query(
          `SELECT signature_image_path 
           FROM report_settings 
           WHERE organization_id = $1 AND class_id = $2 AND term_id = $3`,
          [organizationId, currentClassId, termId]
        );

        const existingSignaturePath = existingSignatureResult.rows[0]?.signature_image_path;

        // Insert or update the new signature image path
        await db.query(
          `INSERT INTO report_settings (organization_id, class_id, term_id, signature_image_path, signature_name, signature_title)
           VALUES ($1, $2, $3, $4, $5, $6)
           ON CONFLICT (organization_id, class_id, term_id)
           DO UPDATE SET signature_image_path = EXCLUDED.signature_image_path,
                         signature_name = EXCLUDED.signature_name,
                         signature_title = EXCLUDED.signature_title`,
          [organizationId, currentClassId, termId, uploadedKey, signatureName || null, signatureTitle || null]
        );

        // Check if old signature is still used by other classes
        if (existingSignaturePath && existingSignaturePath !== uploadedKey) {
          const otherUsesResult = await db.query(
            `SELECT COUNT(*) as count 
             FROM report_settings 
             WHERE organization_id = $1 AND term_id = $2 AND signature_image_path = $3`,
            [organizationId, termId, existingSignaturePath]
          );

          const otherUsesCount = parseInt(otherUsesResult.rows[0]?.count || 0);

          // If no other classes use this signature, delete it from S3
          if (otherUsesCount === 0) {
            const s3Prefix = `https://${process.env.S3_BUCKET_NAME}.s3.${process.env.AWS_REGION}.amazonaws.com/`;
            let oldSignatureKey = existingSignaturePath;
            if (existingSignaturePath.startsWith(s3Prefix)) {
              oldSignatureKey = existingSignaturePath.substring(s3Prefix.length);
            }
            await deleteFromS3(oldSignatureKey);
            console.log(`[uploadSignatureImage] Deleted orphaned signature: ${oldSignatureKey}`);
          }
        }
      }

      req.flash("success", "Signature image uploaded successfully.");
      res.redirect(`/print/reportSettings?classId=${classId}&termId=${termId}`);
    } catch (error) {
            req.flash("error", "Failed to upload signature image.");
      res.redirect(`/print/reportSettings?classId=${classId}&termId=${termId}`);
    }
  },

  deleteSignatureImage: async (req, res) => {
    const organizationId = req.session.organizationId;
    const { classId, termId } = req.query;

    if (!organizationId) {
      req.flash("error", "Organization ID is not set in session.");
      return res.redirect(
        `/print/reportSettings?classId=${classId}&termId=${termId}`
      );
    }

    if (!termId) {
      req.flash("error", "Invalid or missing termId.");
      return res.redirect(`/print/reportSettings?classId=${classId}`);
    }

    try {
      const result = await db.query(
        "SELECT signature_image_path FROM report_settings WHERE organization_id = $1 AND class_id = $2 AND term_id = $3",
        [organizationId, classId, termId]
      );
      const signatureImagePath = result.rows[0]?.signature_image_path;

      if (signatureImagePath) {
        // Remove the S3 URL prefix to get the key if needed
        const s3Prefix = `https://${process.env.S3_BUCKET_NAME}.s3.${process.env.AWS_REGION}.amazonaws.com/`;
        let oldSignatureKey = signatureImagePath;
        if (signatureImagePath.startsWith(s3Prefix)) {
          oldSignatureKey = signatureImagePath.substring(s3Prefix.length);
        }
        await deleteFromS3(oldSignatureKey);
      }

      await db.query(
        "UPDATE report_settings SET signature_image_path = NULL WHERE organization_id = $1 AND class_id = $2 AND term_id = $3",
        [organizationId, classId, termId]
      );

      req.flash("success", "Signature image deleted successfully.");
      res.redirect(`/print/reportSettings?classId=${classId}&termId=${termId}`);
    } catch (error) {
            req.flash("error", "Failed to delete signature image.");
      res.redirect(`/print/reportSettings?classId=${classId}&termId=${termId}`);
    }
  },

  deleteSignatureForClass: async (req, res) => {
    const organizationId = req.session.organizationId;
    const { classId, termId } = req.query;

    if (!organizationId) {
      req.flash("error", "Organization ID is not set in session.");
      return res.redirect(`/print/reportSettings?classId=${classId}&termId=${termId}`);
    }

    if (!termId || !classId) {
      req.flash("error", "Invalid or missing parameters.");
      return res.redirect(`/print/reportSettings`);
    }

    try {
      // Get the signature path before deleting
      const sigResult = await db.query(
        "SELECT signature_image_path FROM report_settings WHERE organization_id = $1 AND class_id = $2 AND term_id = $3",
        [organizationId, classId, termId]
      );
      const signaturePath = sigResult.rows[0]?.signature_image_path;

      // Remove the signature assignment for this class
      await db.query(
        "UPDATE report_settings SET signature_image_path = NULL WHERE organization_id = $1 AND class_id = $2 AND term_id = $3",
        [organizationId, classId, termId]
      );

      // Check if this signature is used by any other class
      if (signaturePath) {
        const otherClassesResult = await db.query(
          "SELECT COUNT(*) as count FROM report_settings WHERE organization_id = $1 AND term_id = $2 AND signature_image_path = $3",
          [organizationId, termId, signaturePath]
        );

        const otherClassesCount = parseInt(otherClassesResult.rows[0]?.count || 0);

        // If no other classes use this signature, delete it from S3
        if (otherClassesCount === 0) {
          const s3Prefix = `https://${process.env.S3_BUCKET_NAME}.s3.${process.env.AWS_REGION}.amazonaws.com/`;
          let signatureKey = signaturePath;
          if (signaturePath.startsWith(s3Prefix)) {
            signatureKey = signaturePath.substring(s3Prefix.length);
          }
          await deleteFromS3(signatureKey);
          console.log(`[deleteSignatureForClass] Deleted orphaned signature from S3: ${signatureKey}`);
        }
      }

      req.flash("success", "Signature removed from class successfully.");
      res.redirect(`/print/reportSettings?classId=${classId}&termId=${termId}`);
    } catch (error) {
      console.error("[deleteSignatureForClass] error", error);
      req.flash("error", "Failed to remove signature.");
      res.redirect(`/print/reportSettings?classId=${classId}&termId=${termId}`);
    }
  },

  deleteEntireSignature: async (req, res) => {
    const organizationId = req.session.organizationId;
    const { signaturePath, termId } = req.query;

    if (!organizationId) {
      req.flash("error", "Organization ID is not set in session.");
      return res.redirect(`/print/reportSettings?termId=${termId}`);
    }

    if (!termId || !signaturePath) {
      req.flash("error", "Invalid or missing parameters.");
      return res.redirect(`/print/reportSettings?termId=${termId}`);
    }

    try {
      // Remove signature from all classes in this organization and term
      await db.query(
        "UPDATE report_settings SET signature_image_path = NULL WHERE organization_id = $1 AND term_id = $2 AND signature_image_path = $3",
        [organizationId, termId, signaturePath]
      );

      // Delete the signature file from S3
      const s3Prefix = `https://${process.env.S3_BUCKET_NAME}.s3.${process.env.AWS_REGION}.amazonaws.com/`;
      let signatureKey = signaturePath;
      if (signaturePath.startsWith(s3Prefix)) {
        signatureKey = signaturePath.substring(s3Prefix.length);
      }
      await deleteFromS3(signatureKey);

      console.log(`[deleteEntireSignature] Deleted signature: ${signatureKey}`);
      req.flash("success", "Signature deleted successfully from all classes.");
      res.redirect(`/print/reportSettings?termId=${termId}`);
    } catch (error) {
      console.error("[deleteEntireSignature] error", error);
      req.flash("error", "Failed to delete signature.");
      res.redirect(`/print/reportSettings?termId=${termId}`);
    }
  },

  addClassesToSignature: async (req, res) => {
    const { signaturePath, termId, selectedClasses } = req.body;
    const organizationId = req.session.organizationId;

    console.log("[addClassesToSignature] incoming", {
      signaturePath,
      termId,
      selectedClasses,
      organizationId,
    });

    try {
      if (!organizationId) {
        return res.json({ success: false, message: "Organization ID is not set in session." });
      }

      if (!termId || !signaturePath || !Array.isArray(selectedClasses) || selectedClasses.length === 0) {
        return res.json({ success: false, message: "Invalid parameters." });
      }

      const parsedTermId = parseInt(termId, 10);

      // Add signature to selected classes
      for (const classId of selectedClasses) {
        const parsedClassId = parseInt(classId, 10);
        
        await db.query(
          `
            INSERT INTO report_settings (organization_id, class_id, term_id, signature_image_path)
            VALUES ($1, $2, $3, $4)
            ON CONFLICT (organization_id, class_id, term_id)
            DO UPDATE SET signature_image_path = EXCLUDED.signature_image_path
          `,
          [organizationId, parsedClassId, parsedTermId, signaturePath]
        );
      }

      console.log("[addClassesToSignature] Successfully added classes to signature");
      res.json({ success: true });
    } catch (error) {
      console.error("[addClassesToSignature] error", error);
      res.json({ success: false, message: "Failed to add classes to signature." });
    }
  },

  // Transcript Signature Methods
  uploadTranscriptSignature: async (req, res) => {
    const { file } = req;
    const organizationId = req.session.organizationId;
    const { selectedTranscriptClasses, transcriptSignatureName, transcriptSignatureTitle } = req.body;
    await ensureSignatureMetaColumns(db);

    if (!file) {
      req.flash("error", "No signature provided.");
      return res.redirect(`/print/reportSettings`);
    }

    try {
      if (!organizationId) {
        req.flash("error", "Organization ID is not set in session.");
        return res.redirect(`/print/reportSettings`);
      }

      const normalizedTranscriptClasses = Array.isArray(selectedTranscriptClasses)
        ? selectedTranscriptClasses
        : selectedTranscriptClasses
        ? [selectedTranscriptClasses]
        : [];

      if (normalizedTranscriptClasses.length === 0) {
        req.flash("error", "Please select at least one class.");
        return res.redirect(`/print/reportSettings`);
      }

      const classesToApply = normalizedTranscriptClasses.map((id) => parseInt(id, 10));
      const timestamp = Date.now();
      const randomSuffix = Math.random().toString(36).substring(2, 8);
      const filename = `transcript-signature-${timestamp}-${randomSuffix}.png`;
      const key = `images/transcriptsignature/${organizationId}/${filename}`;
      const uploadedKey = await uploadToS3(key, file);
      
      console.log(`[uploadTranscriptSignature] Created new transcript signature: ${filename} for classes:`, classesToApply);

      const transcriptTermId = -1; // Transcript signatures use term_id = -1

      for (const currentClassId of classesToApply) {
        // Get existing transcript signature
        const existingSignatureResult = await db.query(
          `SELECT signature_image_path 
           FROM report_settings 
           WHERE organization_id = $1 AND class_id = $2 AND term_id = $3`,
          [organizationId, currentClassId, transcriptTermId]
        );

        const existingSignaturePath = existingSignatureResult.rows[0]?.signature_image_path;

        // Insert or update
        await db.query(
          `INSERT INTO report_settings (organization_id, class_id, term_id, signature_image_path, signature_name, signature_title)
           VALUES ($1, $2, $3, $4, $5, $6)
           ON CONFLICT (organization_id, class_id, term_id)
           DO UPDATE SET signature_image_path = EXCLUDED.signature_image_path,
                         signature_name = EXCLUDED.signature_name,
                         signature_title = EXCLUDED.signature_title`,
          [organizationId, currentClassId, transcriptTermId, uploadedKey, transcriptSignatureName || null, transcriptSignatureTitle || null]
        );

        // Cleanup old signature if orphaned
        if (existingSignaturePath && existingSignaturePath !== uploadedKey) {
          const otherUsesResult = await db.query(
            `SELECT COUNT(*) as count 
             FROM report_settings 
             WHERE organization_id = $1 AND term_id = $2 AND signature_image_path = $3`,
            [organizationId, transcriptTermId, existingSignaturePath]
          );

          const otherUsesCount = parseInt(otherUsesResult.rows[0]?.count || 0);

          if (otherUsesCount === 0) {
            const s3Prefix = `https://${process.env.S3_BUCKET_NAME}.s3.${process.env.AWS_REGION}.amazonaws.com/`;
            let oldSignatureKey = existingSignaturePath;
            if (existingSignaturePath.startsWith(s3Prefix)) {
              oldSignatureKey = existingSignaturePath.substring(s3Prefix.length);
            }
            await deleteFromS3(oldSignatureKey);
            console.log(`[uploadTranscriptSignature] Deleted orphaned signature: ${oldSignatureKey}`);
          }
        }
      }

      req.flash("success", "Transcript signature uploaded successfully.");
      res.redirect(`/print/reportSettings`);
    } catch (error) {
      console.error("[uploadTranscriptSignature] error", error);
      req.flash("error", "Failed to upload transcript signature.");
      res.redirect(`/print/reportSettings`);
    }
  },

  deleteTranscriptSignatureForClass: async (req, res) => {
    const organizationId = req.session.organizationId;
    const { classId } = req.query;

    try {
      const transcriptTermId = -1;

      const sigResult = await db.query(
        "SELECT signature_image_path FROM report_settings WHERE organization_id = $1 AND class_id = $2 AND term_id = $3",
        [organizationId, classId, transcriptTermId]
      );
      const signaturePath = sigResult.rows[0]?.signature_image_path;

      await db.query(
        "UPDATE report_settings SET signature_image_path = NULL WHERE organization_id = $1 AND class_id = $2 AND term_id = $3",
        [organizationId, classId, transcriptTermId]
      );

      if (signaturePath) {
        const otherClassesResult = await db.query(
          "SELECT COUNT(*) as count FROM report_settings WHERE organization_id = $1 AND term_id = $2 AND signature_image_path = $3",
          [organizationId, transcriptTermId, signaturePath]
        );

        const otherClassesCount = parseInt(otherClassesResult.rows[0]?.count || 0);

        if (otherClassesCount === 0) {
          const s3Prefix = `https://${process.env.S3_BUCKET_NAME}.s3.${process.env.AWS_REGION}.amazonaws.com/`;
          let signatureKey = signaturePath;
          if (signaturePath.startsWith(s3Prefix)) {
            signatureKey = signaturePath.substring(s3Prefix.length);
          }
          await deleteFromS3(signatureKey);
          console.log(`[deleteTranscriptSignatureForClass] Deleted orphaned signature: ${signatureKey}`);
        }
      }

      req.flash("success", "Transcript signature removed from class.");
      res.redirect(`/print/reportSettings`);
    } catch (error) {
      console.error("[deleteTranscriptSignatureForClass] error", error);
      req.flash("error", "Failed to remove transcript signature.");
      res.redirect(`/print/reportSettings`);
    }
  },

  deleteEntireTranscriptSignature: async (req, res) => {
    const organizationId = req.session.organizationId;
    const { signaturePath } = req.query;

    try {
      const transcriptTermId = -1;

      await db.query(
        "UPDATE report_settings SET signature_image_path = NULL WHERE organization_id = $1 AND term_id = $2 AND signature_image_path = $3",
        [organizationId, transcriptTermId, signaturePath]
      );

      const s3Prefix = `https://${process.env.S3_BUCKET_NAME}.s3.${process.env.AWS_REGION}.amazonaws.com/`;
      let signatureKey = signaturePath;
      if (signaturePath.startsWith(s3Prefix)) {
        signatureKey = signaturePath.substring(s3Prefix.length);
      }
      await deleteFromS3(signatureKey);

      console.log(`[deleteEntireTranscriptSignature] Deleted signature: ${signatureKey}`);
      req.flash("success", "Transcript signature deleted successfully.");
      res.redirect(`/print/reportSettings`);
    } catch (error) {
      console.error("[deleteEntireTranscriptSignature] error", error);
      req.flash("error", "Failed to delete transcript signature.");
      res.redirect(`/print/reportSettings`);
    }
  },

  addClassesToTranscriptSignature: async (req, res) => {
    const { signaturePath, selectedClasses } = req.body;
    const organizationId = req.session.organizationId;

    try {
      if (!organizationId) {
        return res.json({ success: false, message: "Organization ID is not set in session." });
      }

      if (!signaturePath || !Array.isArray(selectedClasses) || selectedClasses.length === 0) {
        return res.json({ success: false, message: "Invalid parameters." });
      }

      const transcriptTermId = -1;

      for (const classId of selectedClasses) {
        const parsedClassId = parseInt(classId, 10);
        
        await db.query(
          `INSERT INTO report_settings (organization_id, class_id, term_id, signature_image_path)
           VALUES ($1, $2, $3, $4)
           ON CONFLICT (organization_id, class_id, term_id)
           DO UPDATE SET signature_image_path = EXCLUDED.signature_image_path`,
          [organizationId, parsedClassId, transcriptTermId, signaturePath]
        );
      }

      res.json({ success: true });
    } catch (error) {
      console.error("[addClassesToTranscriptSignature] error", error);
      res.json({ success: false, message: "Failed to add classes to transcript signature." });
    }
  },

  meritSheetPage: async (req, res) => {
    const { classId, termId } = req.query;
    const organizationId = req.session.organizationId;

    try {
      // Fetch organization details
      const organizationResult = await db.query(
        `
            SELECT organization_name, logo_path 
            FROM organizations 
            WHERE organization_id = $1
        `,
        [organizationId]
      );

      const organization = organizationResult.rows[0];
      if (!organization) {
        return res.status(404).send("Organization not found.");
      }

      const logoUrl = organization.logo_path
        ? `https://${process.env.S3_BUCKET_NAME}.s3.amazonaws.com/${organization.logo_path}`
        : null;

      // Fetch class, term, and school year information
      const classDetailsResult = await db.query(
        `
            SELECT c.class_name, t.term_name, sy.year_label
            FROM classes c
            JOIN terms t ON c.class_id = $1 AND t.term_id = $2
            JOIN school_years sy ON t.school_year_id = sy.id
            WHERE c.organization_id = $3
        `,
        [classId, termId, organizationId]
      );

      if (classDetailsResult.rows.length === 0) {
        return res.status(404).send("Class or term details not found.");
      }

      const {
        class_name: className,
        term_name: termName,
        year_label: schoolYear,
      } = classDetailsResult.rows[0];

      // Fetch subjects for the class
      const subjectsResult = await db.query(
        `
            SELECT subject_id, subject_name
            FROM subjects
            WHERE class_id = $1 AND organization_id = $2
        `,
        [classId, organizationId]
      );

      const subjects = await Promise.all(
        subjectsResult.rows.map(async (subject) => {
          const assessmentsResult = await db.query(
            `
                SELECT assessment_id, title, weight, category
                FROM assessments
                WHERE subject_id = $1 AND class_id = $2 AND term_id = $3 AND organization_id = $4
            `,
            [subject.subject_id, classId, termId, organizationId]
          );

          return {
            ...subject,
            assessments: assessmentsResult.rows,
          };
        })
      );

      // Render the page with organization name and logo
      res.render("print/meritSheetPage", {
        title: "Merit Sheet Page",
        classId,
        termId,
        className,
        termName,
        schoolYear,
        subjects,
        meritSheet: [], // Initialize meritSheet to avoid ReferenceError
        orgName: organization.organization_name,
        logoUrl: logoUrl,
      });
    } catch (error) {
            res.status(500).send("Failed to load merit sheet page.");
    }
  },

  getAssessmentsForSubject: async (req, res) => {
    const { subjectId, classId, termId } = req.query;
    const organizationId = req.session.organizationId;

    try {
      // Fetch assessments for the specified subject, class, term, and organization
      const assessmentsResult = await db.query(
        `
            SELECT a.assessment_id, a.title, a.weight, a.category, a.max_score
            FROM assessments a
            WHERE a.subject_id = $1 AND a.class_id = $2 AND a.term_id = $3 AND a.organization_id = $4
        `,
        [subjectId, classId, termId, organizationId]
      );

      res.json(assessmentsResult.rows);
    } catch (error) {
            res.status(500).send("Failed to fetch assessments.");
    }
  },

  generateMeritSheet: async (req, res) => {
    const organizationId = req.session.organizationId;

    // Accept payload from POST body or GET query; fall back to last run for refreshes
    const payload = req.method === 'GET' ? req.query : req.body;
    let { classId, termId, selectedSubjects, selectedAssessments } = payload;

    // Helper to normalize ids from array, comma string, or single value
    const normalizeIds = (input) => {
      if (!input) return [];
      if (Array.isArray(input)) return input.map((id) => Number(id)).filter((n) => !Number.isNaN(n));
      if (typeof input === 'string' && input.includes(',')) {
        return input
          .split(',')
          .map((id) => Number(id.trim()))
          .filter((n) => !Number.isNaN(n));
      }
      const single = Number(input);
      return Number.isNaN(single) ? [] : [single];
    };

    // Fall back to last successful run stored in session when refreshing
    if ((!classId || !termId || !selectedSubjects || !selectedAssessments) && req.session.lastMeritSheet) {
      const last = req.session.lastMeritSheet;
      classId = classId || last.classId;
      termId = termId || last.termId;
      if (!selectedSubjects) selectedSubjects = last.selectedSubjectIds;
      if (!selectedAssessments) selectedAssessments = last.selectedAssessmentIds;
      console.log('[generateMeritSheet] Using cached session data:', { classId, termId, selectedSubjects, selectedAssessments });
    }

    const subjectIds = normalizeIds(selectedSubjects);
    const assessmentIds = normalizeIds(selectedAssessments);

    try {
      if (!classId || !termId || !organizationId || !subjectIds.length || !assessmentIds.length) {
        // Redirect to the base page if we don't have enough info (e.g., first load without form submit)
        console.log('[generateMeritSheet] Missing required data, redirecting to base page');
        return res.redirect('/print/meritSheetPage');
      }

      // Parse as integers
      const parsedClassId = parseInt(classId, 10);
      const parsedTermId = parseInt(termId, 10);

      if (isNaN(parsedClassId) || isNaN(parsedTermId)) {
        console.log('[generateMeritSheet] Invalid IDs after parsing:', { parsedClassId, parsedTermId });
        req.flash('error', 'Invalid class or term ID.');
        return res.redirect('/print/meritSheetPage');
      }

      console.log('[generateMeritSheet] Proceeding with:', { parsedClassId, parsedTermId, subjectIds, assessmentIds });

      // Fetch organization details
      const organizationResult = await db.query(
        `
            SELECT organization_name, logo_path
            FROM organizations
            WHERE organization_id = $1
        `,
        [organizationId]
      );
      const organization = organizationResult.rows[0];

      if (!organization) {
        return res.status(404).send("Organization not found.");
      }

      const logoUrl = organization.logo_path
        ? `https://${process.env.S3_BUCKET_NAME}.s3.amazonaws.com/${organization.logo_path}`
        : null;

      // Fetch class, term, and school year details
      const classDetailsResult = await db.query(
        `
            SELECT c.class_name, t.term_name, sy.year_label
            FROM classes c
            JOIN terms t ON t.term_id = $1 AND t.organization_id = $2
            JOIN school_years sy ON t.school_year_id = sy.id
            WHERE c.class_id = $3 AND c.organization_id = $2
        `,
        [parsedTermId, organizationId, parsedClassId]
      );

      if (classDetailsResult.rows.length === 0) {
        req.flash("error", "Class or term details not found. Please regenerate.");
        const qs = parsedClassId && parsedTermId ? `?classId=${parsedClassId}&termId=${parsedTermId}` : "";
        return res.redirect(`/print/meritSheetPage${qs}`);
      }

      const {
        class_name: className,
        term_name: termName,
        year_label: schoolYear,
      } = classDetailsResult.rows[0];

      // Fetch selected subjects and assessments
      const subjectsResult = await db.query(
        `
            SELECT subject_id, subject_name
            FROM subjects
            WHERE subject_id = ANY($1::int[]) AND class_id = $2 AND organization_id = $3
        `,
        [subjectIds, parsedClassId, organizationId]
      );

      const selectedSubjectsData = await Promise.all(
        subjectsResult.rows.map(async (subject) => {
          const assessmentsResult = await db.query(
            `
                SELECT assessment_id, title, weight, category, max_score
                FROM assessments
                WHERE assessment_id = ANY($1::int[]) AND subject_id = $2 AND class_id = $3 AND term_id = $4 AND organization_id = $5
            `,
            [assessmentIds, subject.subject_id, parsedClassId, parsedTermId, organizationId]
          );

          return {
            ...subject,
            assessments: assessmentsResult.rows,
          };
        })
      );

      // Fetch students enrolled in the class for the given term
      const enrolledStudentsResult = await db.query(
        `
            SELECT es.student_id, s.first_name, s.last_name
            FROM enrolled_students es
            JOIN students s ON es.student_id = s.student_id
            JOIN enrollments e ON es.enrollment_id = e.enrollment_id
            WHERE es.class_id = $1 AND e.term_id = $2 AND e.organization_id = $3
        `,
        [parsedClassId, parsedTermId, organizationId]
      );

      const students = enrolledStudentsResult.rows;

      const scoresResult = await db.query(
        `
            SELECT ar.student_id, a.subject_id, ar.score, a.title AS assessment_title, ar.grade, a.weight
            FROM assessment_results ar
            JOIN assessments a ON ar.assessment_id = a.assessment_id
            WHERE ar.class_id = $1 AND ar.term_id = $2 AND ar.organization_id = $3
        `,
        [parsedClassId, parsedTermId, organizationId]
      );

      const scores = scoresResult.rows;

      // Process students and attach scores, grades, and positions
      const meritSheetData = students.map((student) => {
        const studentScores = selectedSubjectsData.map((subject) => {
          const subjectAssessments = subject.assessments.map((assessment) => {
            const scoreData = scores.find(
              (score) =>
                score.student_id === student.student_id &&
                score.subject_id === subject.subject_id &&
                score.assessment_title === assessment.title
            );

            return {
              title: assessment.title,
              score: scoreData ? scoreData.score : "-",
              grade: scoreData ? scoreData.grade : "-",
              weight: assessment.weight,
            };
          });

          const totalSubjectScore = subjectAssessments.reduce(
            (total, assessment) => {
              return (
                total +
                (assessment.score !== "-" ? parseFloat(assessment.score) : 0)
              );
            },
            0
          );

          return {
            subjectName: subject.subject_name,
            assessments: subjectAssessments,
            totalScore: totalSubjectScore,
          };
        });

        const totalScore = studentScores.reduce(
          (total, subject) => total + subject.totalScore,
          0
        );
        const averageScore = totalScore / studentScores.length;

        return {
          studentId: student.student_id,
          name: `${student.first_name} ${student.last_name}`,
          scores: studentScores,
          totalScore: totalScore.toFixed(2),
          averageScore: averageScore.toFixed(2),
        };
      });

      // Sort students by total score and assign positions
      meritSheetData.sort((a, b) => b.totalScore - a.totalScore);
      meritSheetData.forEach((student, index) => {
        student.position = `${index + 1}${getOrdinalSuffix(index + 1)}`;
      });

      // Cache last run to support refresh on the same URL (before render in case render fails)
      req.session.lastMeritSheet = {
        classId: parsedClassId,
        termId: parsedTermId,
        selectedSubjectIds: subjectIds,
        selectedAssessmentIds: assessmentIds,
      };

      res.render("print/meritSheetPage", {
        title: "Merit Sheet",
        orgName: organization.organization_name,
        logoUrl,
        className,
        termName,
        schoolYear,
        subjects: selectedSubjectsData,
        meritSheet: meritSheetData,
      });
    } catch (error) {
            res.status(500).send("Failed to generate merit sheet.");
    }
  },

  saveReportChanges: async (req, res) => {
    const { classId, termId } = req.query;
    const organizationId = req.session.organizationId;
    const { studentReports } = req.body;
  
    if (!organizationId || !classId || !termId || !studentReports) {
      return res.status(400).send("Missing required fields.");
    }
  
    try {
      const parsedClassId = parseInt(classId, 10);
      const parsedTermId = parseInt(termId, 10);
  
      for (const studentReport of studentReports) {
        const {
          studentId,
          conductRemarks,
          attitudeRemarks,
          interestRemarks,
          teacherRemarks,
          promotionStatus,       // ✅ from frontend
          promotionClassId,      // ✅ from frontend
        } = studentReport;
  
        if (!studentId || isNaN(studentId) || studentId <= 0) {
                    continue; // skip invalid rows
        }
  
        await db.query(
          `
            INSERT INTO student_reports (
              organization_id, class_id, term_id, student_id, 
              conduct_remarks, attitude_remarks, interest_remarks, teacher_remarks,
              promotion_status, promotion_class_id
            ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
            ON CONFLICT (organization_id, class_id, term_id, student_id)
            DO UPDATE SET
              conduct_remarks = EXCLUDED.conduct_remarks,
              attitude_remarks = EXCLUDED.attitude_remarks,
              interest_remarks = EXCLUDED.interest_remarks,
              teacher_remarks = EXCLUDED.teacher_remarks,
              promotion_status = EXCLUDED.promotion_status,
              promotion_class_id = EXCLUDED.promotion_class_id,
              updated_at = CURRENT_TIMESTAMP
          `,
          [
            organizationId,
            parsedClassId,
            parsedTermId,
            studentId,
            conductRemarks,
            attitudeRemarks,
            interestRemarks,
            teacherRemarks,
            promotionStatus,
            promotionClassId ? parseInt(promotionClassId, 10) : null, // ensure numeric or null
          ]
        );
      }
  
      res.status(200).send("Changes saved successfully.");
    } catch (error) {
            res.status(500).send("Failed to save report changes.");
    }
  },
  
  

  migrationPage: async (req, res) => {
    try {
      const organizationId = req.session.organizationId;
      if (!organizationId) {
        req.flash("error", "Organization ID is missing.");
        return res.redirect("/dashboard");
      }

      const listCommand = new ListObjectsV2Command({
        Bucket: process.env.S3_BUCKET_NAME,
        Prefix: `migrations/org_${organizationId}/`, // ✅ Restrict to org's folder
      });

      const { Contents } = await s3Client.send(listCommand);

      const uploadedFiles = (Contents || []).map((file) => ({
        file_name: file.Key.split("/").pop(),
        s3_url: `https://${process.env.S3_BUCKET_NAME}.s3.amazonaws.com/${file.Key}`,
      }));

      res.render("print/migration", {
        title: "Data Migration",
        uploadedFiles,
        fileUrl: null,
        query: "",
        results: [],
        messages: req.flash(),
      });
    } catch (error) {
            req.flash("error", "Failed to load migration page.");
      res.redirect("/dashboard");
    }
  },

  // Upload File to S3 & Save Metadata in DB
  uploadFile: async (req, res) => {
    try {
      const organizationId = req.session.organizationId;
      if (!organizationId) {
        req.flash("error", "Organization ID is missing.");
        return res.redirect("/print/migration");
      }

      if (!req.file) {
        req.flash("error", "No file uploaded.");
        return res.redirect("/print/migration");
      }

      const fileKey = `migrations/org_${organizationId}/${Date.now()}_${
        req.file.originalname
      }`;
      const fileType = req.file.mimetype;

      const uploadParams = {
        Bucket: process.env.S3_BUCKET_NAME,
        Key: fileKey,
        Body: req.file.buffer,
        ContentType: fileType,
      };

      await s3Client.send(new PutObjectCommand(uploadParams));

      req.flash("success", "File uploaded successfully.");
      res.redirect("/print/migration");
    } catch (error) {
            req.flash("error", "Failed to upload file.");
      res.redirect("/print/migration");
    }
  },

  searchFile: async (req, res) => {
    try {
      const organizationId = req.session.organizationId;
      if (!organizationId) {
        req.flash("error", "Organization ID is missing.");
        return res.redirect("/print/migration");
      }

      const { query } = req.query;
      if (!query) {
        req.flash("error", "Enter a name to search.");
        return res.redirect("/print/migration");
      }

      const listCommand = new ListObjectsV2Command({
        Bucket: process.env.S3_BUCKET_NAME,
        Prefix: `migrations/org_${organizationId}/`, // ✅ Restrict search to org
      });

      const { Contents } = await s3Client.send(listCommand);

      let results = [];
      let fileUrl = null;

      for (let file of Contents || []) {
        if (file.Key.toLowerCase().includes(query.toLowerCase())) {
          fileUrl = `https://${process.env.S3_BUCKET_NAME}.s3.amazonaws.com/${file.Key}`;
          results.push({ file: file.Key, url: fileUrl });
        }
      }

      res.render("print/migration", {
        title: "Data Migration",
        results,
        query,
        fileUrl,
        uploadedFiles: Contents || [],
      });
    } catch (error) {
            req.flash("error", "Search failed.");
      res.redirect("/print/migration");
    }
  },

  previewFile: async (req, res) => {
    try {
      const organizationId = req.session.organizationId;
      if (!organizationId) {
        return res.status(403).json({ error: "Unauthorized access." });
      }

      const { key } = req.params;
      if (!key.startsWith(`migrations/org_${organizationId}/`)) {
        return res
          .status(403)
          .json({ error: "File does not belong to your organization." });
      }

      const fileUrl = await getFromS3(key);
      if (!fileUrl) {
        return res.status(404).json({ error: "File not found in S3." });
      }

      res.json({ fileUrl });
    } catch (error) {
            res.status(500).json({ error: "Failed to preview file." });
    }
  },

  deleteFile: async (req, res) => {
    try {
      const organizationId = req.session.organizationId;
      if (!organizationId) {
        req.flash("error", "Organization ID is missing.");
        return res.redirect("/print/migration");
      }

      const { key } = req.params;
      if (!key) {
        req.flash("error", "Invalid file key.");
        return res.redirect("/print/migration");
      }

      // Construct full key for S3 (ensure correct path)
      const fullKey = `migrations/org_${organizationId}/${key}`;

      // Check if file exists in S3 before attempting to delete
      const listCommand = new ListObjectsV2Command({
        Bucket: process.env.S3_BUCKET_NAME,
        Prefix: fullKey,
      });

      const { Contents } = await s3Client.send(listCommand);
      if (!Contents || Contents.length === 0) {
        req.flash("error", "File does not exist or is unauthorized.");
        return res.redirect("/print/migration");
      }

      // Proceed with deletion
      await deleteFromS3(fullKey);

      req.flash("success", "File deleted successfully.");
      res.redirect("/print/migration");
    } catch (error) {
            req.flash("error", "Failed to delete file.");
      res.redirect("/print/migration");
    }
  },

  // Get guardian emails for selected students
  getGuardianEmails: async (req, res) => {
    try {
      const organizationId = req.session.organizationId;
      const { studentIds } = req.query;

      if (!organizationId || !studentIds) {
        return res.status(400).json({ success: false, message: "Missing parameters." });
      }

      const ids = studentIds.split(',').map(id => parseInt(id, 10)).filter(id => !isNaN(id));
      if (ids.length === 0) {
        return res.status(400).json({ success: false, message: "No valid student IDs." });
      }

      // Fetch students with their guardian emails (new guardian_profiles + legacy guardians table)
      const result = await db.query(
        `SELECT s.student_id,
                s.first_name,
                s.last_name,
                c.class_name,
                COALESCE(
                  jsonb_agg(DISTINCT jsonb_build_object('email', ge.email, 'relationship', ge.relationship))
                  FILTER (WHERE ge.email IS NOT NULL),
                  '[]'::jsonb
                ) AS emails
         FROM students s
         LEFT JOIN classes c ON s.class_id = c.class_id
         LEFT JOIN (
           -- Modern guardian profiles mapped through guardian_students
           SELECT gs.student_id,
                  gp.email,
                  COALESCE(gs.relationship, 'Guardian') AS relationship
           FROM guardian_students gs
           JOIN guardian_profiles gp
             ON gp.guardian_id = gs.guardian_id
            AND gp.organization_id = $2
           WHERE gp.email IS NOT NULL

           UNION ALL

           -- Legacy guardians table fallback
           SELECT g.student_id,
                  g.email,
                  'Guardian' AS relationship
           FROM guardians g
           WHERE g.organization_id = $2
             AND g.email IS NOT NULL
         ) ge ON ge.student_id = s.student_id
         WHERE s.student_id = ANY($1)
           AND s.organization_id = $2
         GROUP BY s.student_id, s.first_name, s.last_name, c.class_name
         ORDER BY s.last_name, s.first_name`,
        [ids, organizationId]
      );

      return res.json({ success: true, students: result.rows });
    } catch (error) {
      console.error('[getGuardianEmails] Error:', error);
      return res.status(500).json({ success: false, message: "Failed to fetch emails." });
    }
  },

  // Email reports to guardians (queued/background processing)
  emailReports: async (req, res) => {
    try {
      const organizationId = req.session.organizationId;
      const { classId, termId, password, emailData } = req.body;

      if (!organizationId || !password || !emailData || !classId || !termId) {
        return res.status(400).json({ success: false, message: "Missing required fields." });
      }

      // Verify password - try user first, then org
      let passwordMatch = false;
      const userId = req.session.userId || (req.session.user && req.session.user.user_id);
      
      if (userId) {
        const userResult = await db.query('SELECT password FROM users WHERE user_id = $1 AND organization_id = $2', [userId, organizationId]);
        if (userResult.rows.length > 0 && userResult.rows[0].password) {
          passwordMatch = await bcrypt.compare(password, userResult.rows[0].password);
        }
      }
      if (!passwordMatch) {
        const orgResult = await db.query('SELECT password FROM organizations WHERE organization_id = $1', [organizationId]);
        if (orgResult.rows.length > 0) {
          passwordMatch = await bcrypt.compare(password, orgResult.rows[0].password);
        }
      }
      if (!passwordMatch) {
        return res.status(401).json({ success: false, message: "Incorrect password." });
      }

      // Create batch ID
      const batchId = `batch_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

      // Insert all email jobs into database
      for (const item of emailData) {
        const { studentId, emails } = item;
        if (!emails || emails.length === 0) continue;

        // Get student name
        const studentResult = await db.query(
          'SELECT first_name, last_name FROM students WHERE student_id = $1 AND organization_id = $2',
          [studentId, organizationId]
        );
        if (!studentResult.rows.length) continue;
        
        const student = studentResult.rows[0];
        const studentName = `${student.first_name} ${student.last_name}`;

        await db.query(
          `INSERT INTO email_history (organization_id, class_id, term_id, user_id, batch_id, student_id, student_name, recipient_emails, status)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'pending')`,
          [organizationId, classId, termId, userId, batchId, studentId, studentName, emails]
        );
      }

      // Start background processing (don't await)
      const { processEmailBatch } = require('../utils/emailQueueProcessor');
      setImmediate(() => {
        processEmailBatch(batchId, organizationId, classId, termId, req.protocol, req.get('host'), req.headers.cookie);
      });

      return res.json({ 
        success: true, 
        message: `Email batch queued successfully. Check history for status.`,
        batchId
      });
    } catch (error) {
      console.error('[emailReports] Error:', error);
      return res.status(500).json({ success: false, message: "Failed to queue reports." });
    }
  },

  /**
   * Email history endpoint - returns all email jobs
   */
  getEmailHistory: asyncHandler(async (req, res) => {
    try {
      const organizationId = req.session.organizationId;
      const { class_id, term_id } = req.query;

      if (!organizationId) {
        return res.status(401).json({ success: false, message: 'Not authorized' });
      }
      
      let query = `
        SELECT 
          id, batch_id, student_name, recipient_emails, status, 
          error_message, pdf_generated, sent_at, created_at
        FROM email_history
        WHERE organization_id = $1
      `;
      const params = [organizationId];
      
      if (class_id) {
        params.push(class_id);
        query += ` AND class_id = $${params.length}`;
      }
      
      if (term_id) {
        params.push(term_id);
        query += ` AND term_id = $${params.length}`;
      }
      
      query += ` ORDER BY created_at DESC LIMIT 500`;
      
      const result = await db.query(query, params);
      res.json({ success: true, data: result.rows });
    } catch (error) {
      console.error('[getEmailHistory] Error:', error);
      res.status(500).json({ success: false, message: 'Failed to fetch email history' });
    }
  }),

  /**
   * Retry failed email
   */
  retryFailedEmail: asyncHandler(async (req, res) => {
    try {
      const { emailIds } = req.body; // Array of email_history ids to retry
      const sessionOrganizationId = req.session.organizationId;

      if (!sessionOrganizationId) {
        return res.status(401).json({ success: false, message: 'Unauthorized' });
      }
      if (!emailIds || !Array.isArray(emailIds) || emailIds.length === 0) {
        return res.status(400).json({ success: false, message: 'No email IDs provided' });
      }

      // Tenant boundary: only consider email_history rows that belong to
      // the caller's organization. This filters out any foreign ids and
      // prevents mutating other tenants' email job state.
      const ownedResult = await db.query(
        `SELECT id, batch_id, organization_id, class_id, term_id
           FROM email_history
          WHERE id = ANY($1) AND organization_id = $2`,
        [emailIds, sessionOrganizationId]
      );

      if (ownedResult.rows.length === 0) {
        return res.status(404).json({ success: false, message: 'Email not found' });
      }

      const ownedIds = ownedResult.rows.map(r => r.id);
      const { batch_id, organization_id, class_id, term_id } = ownedResult.rows[0];

      // Reset status to pending (org-scoped)
      await db.query(
        `UPDATE email_history
            SET status = 'pending', error_message = NULL, updated_at = CURRENT_TIMESTAMP 
          WHERE id = ANY($1) AND organization_id = $2`,
        [ownedIds, sessionOrganizationId]
      );

      // Trigger background processing for these specific emails
      const { processEmailBatch } = require('../utils/emailQueueProcessor');
      const protocol = req.protocol;
      const host = req.get('host');
      const cookies = req.headers.cookie;

      setImmediate(() => {
        processEmailBatch(batch_id, organization_id, class_id, term_id, protocol, host, cookies, ownedIds);
      });

      res.json({ success: true, message: `Retrying ${ownedIds.length} email(s)...` });
    } catch (error) {
      console.error('[retryFailedEmail] Error:', error);
      res.status(500).json({ success: false, message: 'Failed to retry emails' });
    }
  }),

});

module.exports = printController;
