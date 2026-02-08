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
const organizationCache = {};
const CACHE_DURATION = 10 * 60 * 1000; // Cache organization data for 10 minutes
const NodeCache = require("node-cache");
const cache = new NodeCache({ stdTTL: 600 }); // Cache for 10 minutes

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
        SELECT organization_name, organization_address, organization_phone, email, logo_path 
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
              .query("SELECT class_name FROM classes WHERE class_id = $1", [
                promotedClassId,
              ])
              .then((res) => res.rows[0]?.class_name || "No Promoted Class")
          : "No Promoted Class",
        repeatedClassId
          ? db
              .query("SELECT class_name FROM classes WHERE class_id = $1", [
                repeatedClassId,
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
             WHERE es.class_id = $1 AND e.term_id = $2 AND e.organization_id = $3`,
          [parsedClassId, parsedTermId, organizationId]
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
          'SELECT from_percentage AS "fromPercentage", to_percentage AS "toPercentage", remark FROM score_remarks WHERE organization_id = $1',
          [organizationId]
        ),
        db.query(
          "SELECT signature_image_path FROM report_settings WHERE class_id = $1 AND term_id = $2 AND organization_id = $3",
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
          `SELECT student_id, subject_id, category,
                    SUM(total_score) AS total_score
             FROM category_scores
             WHERE class_id = $1 AND term_id = $2 AND organization_id = $3
             GROUP BY student_id, subject_id, category`,
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

          const classScore = parseFloat(
            scoresMap[
              `${student.student_id}_${subject.subject_id}_Class Assessment`
            ] || 0
          );
          const examsScore = parseFloat(
            scoresMap[
              `${student.student_id}_${subject.subject_id}_Exams Assessment`
            ] || 0
          );
          const otherScore = parseFloat(
            scoresMap[
              `${student.student_id}_${subject.subject_id}_Other Assessment`
            ] || 0
          );

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
  
      // Render the report
      res.render("print/printStudentReport", {
        title: "Student Final Report",
        students,
        orgName: organization.organization_name || "Default School Name",
        orgAddress: organization.organization_address,
        orgPhone: organization.organization_phone,
        email: organization.email,
        logoUrl,
        signatureImageUrl,
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
      });
    } catch (error) {
            res.status(500).send("Failed to generate student report.");
    }
  },

  reportSettingsPage: async (req, res) => {
    const { classId, termId } = req.query;
    const organizationId = req.session.organizationId;
  
    if (!classId || isNaN(classId) || !termId || isNaN(termId)) {
      return res.status(400).send("Invalid or missing classId or termId.");
    }
  
    try {
      const parsedClassId = parseInt(classId, 10);
      const parsedTermId = parseInt(termId, 10);
  
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
      const enrolledClassesResult = await db.query(
        `SELECT DISTINCT c.class_id, c.class_name
         FROM enrolled_classes ec
         JOIN classes c ON ec.class_id = c.class_id
         WHERE c.organization_id = $1
         ORDER BY c.class_name ASC`,
        [organizationId]
      );
      const enrolledClasses = enrolledClassesResult.rows;
  
      // Fetch remarks
      const remarksResult = await db.query(
        `SELECT id, remark, remark_type FROM remarks 
         WHERE organization_id = $1`,
        [organizationId]
      );
      const remarks = remarksResult.rows || [];
  
      // Fetch score remarks
      const scoreRemarksResult = await db.query(
        `SELECT * FROM score_remarks 
         WHERE organization_id = $1 AND class_id = $2 AND term_id = $3`,
        [organizationId, parsedClassId, parsedTermId]
      );
      const scoreRemarks = scoreRemarksResult.rows || [];
  
      // Fetch signature image for this class/term
      const reportSettingsResult = await db.query(
        `SELECT signature_image_path FROM report_settings 
         WHERE organization_id = $1 AND class_id = $2 AND term_id = $3`,
        [organizationId, parsedClassId, parsedTermId]
      );
      const reportSettings = reportSettingsResult.rows[0];
      let signatureImageUrl = null;
      if (reportSettings && reportSettings.signature_image_path) {
        signatureImageUrl = await getFromS3(reportSettings.signature_image_path);
      }
  
      // Fetch all signature groups for current term
      const signatureClassesResult = await db.query(
        `SELECT DISTINCT class_id, signature_image_path FROM report_settings 
         WHERE organization_id = $1 AND term_id = $2 AND signature_image_path IS NOT NULL`,
        [organizationId, parsedTermId]
      );
  
      const signatureGroups = {};
      for (const row of signatureClassesResult.rows) {
        if (!signatureGroups[row.signature_image_path]) {
          signatureGroups[row.signature_image_path] = {
            classes: [],
            signature_image_url: await getFromS3(row.signature_image_path),
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
  
      const assignedClassIds = signatureClassesResult.rows.map(
        (row) => row.class_id
      );
      const availableClasses = enrolledClasses.filter(
        (c) => !assignedClassIds.includes(c.class_id)
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
        signatureGroups,
        statusSettingsClasses,
        enrolledClasses,
        classId: parsedClassId,
        termId: parsedTermId,
        messages: req.flash(),
      });
    } catch (error) {
            res.status(500).send("Failed to load report settings page.");
    }
  },

  modifyStatusSettingsPage: async (req, res) => {
    const { classId, termId } = req.query;
    const organizationId = req.session.organizationId;

    if (!classId || isNaN(classId)) {
      return res.status(400).send("Invalid or missing classId.");
    }

    try {
      // Fetch all enrolled classes
      const enrolledClassesResult = await db.query(
        `SELECT class_id, class_name FROM classes WHERE organization_id = $1`,
        [organizationId]
      );
      const enrolledClasses = enrolledClassesResult.rows;

      // Fetch the status setting for this specific class
      const settingsResult = await db.query(
        `
        SELECT promoted_class, repeated_class, activate_promotion, cut_off_point, school_reopen_date
        FROM status_settings
        WHERE organization_id = $1 AND class_id = $2
        LIMIT 1
      `,
        [organizationId, classId]
      );

      const setting = settingsResult.rows[0] || {};

      // Fetch other classes that share this same setting config
      const settingClassesResult = await db.query(
        `
        SELECT class_id
        FROM status_settings
        WHERE organization_id = $1
          AND promoted_class = $2
          AND repeated_class = $3
          AND activate_promotion = $4
          AND cut_off_point = $5
          AND school_reopen_date = $6
      `,
        [
          organizationId,
          setting.promoted_class,
          setting.repeated_class,
          setting.activate_promotion,
          setting.cut_off_point,
          setting.school_reopen_date,
        ]
      );

      const settingClasses = settingClassesResult.rows.map(
        (row) => row.class_id
      );

      // ✅ Pass termId ONLY for navigation (not stored)
      res.render("print/modifyStatusSettings", {
        title: "Modify Status Settings",
        classId,
        termId, // <-- keep termId for redirects/navigation only
        setting,
        settingClasses,
        enrolledClasses,
        success_msg: req.flash("success_msg"),
        error_msg: req.flash("error_msg"),
      });
    } catch (error) {
            res.status(500).send("Failed to load modification page.");
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

  updatePromotionSettings: async (req, res) => {
    const {
      promotedClass,
      repeatedClass,
      cutOffPoint,
      schoolReopenDate,
      activatePromotion,
      selectedStatusClasses,
      classId: originalClassId,
      termId,
    } = req.body;
  
    const organizationId = req.session.organizationId;
    const selectedClassId = parseInt(selectedStatusClasses); // from form radio
  
    try {
      if (selectedClassId !== parseInt(originalClassId)) {
        // Check if selected class + term already has a status setting
        const existing = await db.query(
          `SELECT id FROM status_settings 
           WHERE organization_id = $1 AND class_id = $2 AND term_id = $3`,
          [organizationId, selectedClassId, termId]
        );
  
        if (existing.rows.length > 0) {
          req.flash(
            "error_msg",
            "That class already has a saved status setting for this term."
          );
          return res.redirect(
            `/print/modifyStatusSettings?classId=${originalClassId}&termId=${termId}`
          );
        }
  
        // Update to new classId (with term restriction)
        await db.query(
          `UPDATE status_settings SET
            class_id = $1,
            promoted_class = $2,
            repeated_class = $3,
            cut_off_point = $4,
            school_reopen_date = $5,
            activate_promotion = $6
          WHERE organization_id = $7 AND class_id = $8 AND term_id = $9`,
          [
            selectedClassId,
            promotedClass || null,
            repeatedClass || null,
            parseInt(cutOffPoint, 10) || null,
            schoolReopenDate || null,
            activatePromotion === "on",
            organizationId,
            originalClassId,
            termId,
          ]
        );
      } else {
        // Update values for same class and term
        const result = await db.query(
          `UPDATE status_settings SET
            promoted_class = $1,
            repeated_class = $2,
            cut_off_point = $3,
            school_reopen_date = $4,
            activate_promotion = $5
          WHERE organization_id = $6 AND class_id = $7 AND term_id = $8
          RETURNING *`,
          [
            promotedClass || null,
            repeatedClass || null,
            parseInt(cutOffPoint, 10) || null,
            schoolReopenDate || null,
            activatePromotion === "on",
            organizationId,
            selectedClassId,
            termId,
          ]
        );
  
        // If no record, insert new one
        if (result.rowCount === 0) {
          await db.query(
            `INSERT INTO status_settings (
              organization_id, class_id, term_id, cut_off_point, promoted_class,
              repeated_class, school_reopen_date, activate_promotion
            ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
            [
              organizationId,
              selectedClassId,
              termId,
              parseInt(cutOffPoint, 10) || null,
              promotedClass || null,
              repeatedClass || null,
              schoolReopenDate || null,
              activatePromotion === "on",
            ]
          );
        }
      }
  
      req.flash("success_msg", "Status settings updated successfully.");
      res.redirect(
        `/print/reportSettings?classId=${selectedClassId}&termId=${termId}`
      );
    } catch (error) {
            req.flash("error_msg", "Failed to update status settings.");
      res.redirect(
        `/print/modifyStatusSettings?classId=${originalClassId}&termId=${termId}`
      );
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
      const parsedClassId = parseInt(formClassId, 10);
  
      if (isNaN(parsedClassId) || isNaN(parsedTermId)) {
        req.flash("error", "Invalid class or term ID.");
        return res.redirect(
          `/print/reportSettings?classId=${fallbackClassId}&termId=${termId}`
        );
      }
  
      let classesToApply = Array.isArray(selectedStatusClasses)
        ? selectedStatusClasses.map((id) => parseInt(id, 10))
        : [parseInt(selectedStatusClasses)];
  
      for (const classIdToSave of classesToApply) {
        const existing = await db.query(
          `SELECT id FROM status_settings 
           WHERE organization_id = $1 AND class_id = $2 AND term_id = $3`,
          [organizationId, classIdToSave, parsedTermId]
        );
  
        if (existing.rows.length > 0) {
          req.flash(
            "error",
            `Class with ID ${classIdToSave} already has a saved status setting for this term.`
          );
          continue; // skip this class
        }
  
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
      }
  
      req.flash("success", "Promotion settings processed.");
      res.redirect(
        `/print/reportSettings?classId=${fallbackClassId}&termId=${parsedTermId}`
      );
    } catch (error) {
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

    try {
      await db.query("DELETE FROM remarks WHERE id = $1", [id]);
      req.flash("success", "Remark deleted successfully.");
      res.redirect(`/print/reportSettings?classId=${classId}&termId=${termId}`);
    } catch (error) {
            req.flash("error", "Error deleting remark.");
      res.redirect(`/print/reportSettings?classId=${classId}&termId=${termId}`);
    }
  },

  saveScoreRemarks: async (req, res) => {
    const { remark, from_percentage, to_percentage } = req.body;
    const organizationId = req.session.organizationId;

    // Get classId and termId from query or form
    const termId = req.query.termId || req.body.termId;
    const classId = req.query.classId || req.body.classId;

    try {
      if (!organizationId) {
        req.flash("error", "Organization ID is not set in session.");
        return res.redirect(
          `/print/reportSettings?classId=${classId}&termId=${termId}`
        );
      }

      // Validate classId and termId
      if (!termId || isNaN(termId) || !classId || isNaN(classId)) {
        req.flash("error", "Invalid or missing classId or termId.");
        return res.redirect(`/print/reportSettings`);
      }

      // Convert classId and termId to integers
      const parsedTermId = parseInt(termId, 10);
      const parsedClassId = parseInt(classId, 10);

      // Insert or update score remark for the specific class and term
      await db.query(
        `
                INSERT INTO score_remarks (organization_id, class_id, term_id, remark, from_percentage, to_percentage)
                VALUES ($1, $2, $3, $4, $5, $6)
                ON CONFLICT (organization_id, class_id, term_id, remark) DO UPDATE
                SET from_percentage = EXCLUDED.from_percentage,
                    to_percentage = EXCLUDED.to_percentage
            `,
        [
          organizationId,
          parsedClassId,
          parsedTermId,
          remark,
          from_percentage,
          to_percentage,
        ]
      );

      req.flash("success", "Score remarks saved successfully.");
      res.redirect(
        `/print/reportSettings?classId=${parsedClassId}&termId=${parsedTermId}`
      );
    } catch (error) {
            req.flash("error", "Failed to save score remarks.");
      res.redirect(`/print/reportSettings?classId=${classId}&termId=${termId}`);
    }
  },

  deleteScoreRemark: async (req, res) => {
    const { id } = req.params;
    const termId = req.query.termId;

    try {
      if (!termId) {
        req.flash("error", "Invalid or missing termId.");
        return res.redirect("/print/reportSettings");
      }

      await db.query("DELETE FROM score_remarks WHERE id = $1", [id]);

      req.flash("success", "Score remark deleted successfully.");
      res.redirect(`/print/reportSettings?termId=${termId}`);
    } catch (error) {
            req.flash("error", "Error deleting score remark.");
      res.redirect(`/print/reportSettings?termId=${termId}`);
    }
  },

  uploadSignatureImage: async (req, res) => {
    const { file } = req;
    const organizationId = req.session.organizationId;
    const { classId, termId, applyAllClasses, selectedSignatureClasses } =
      req.body;

    if (!file) {
      req.flash("error", "No file uploaded.");
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
      } else if (classId) {
        classesToApply = [parseInt(classId)];
      }

      const key = `images/reportsignature/${organizationId}/${file.originalname}`;
      const uploadedKey = await uploadToS3(key, file);

      for (const currentClassId of classesToApply) {
        // Delete the existing signature if it already exists
        const existingSignatureResult = await db.query(
          `
                SELECT signature_image_path 
                FROM report_settings 
                WHERE organization_id = $1 AND class_id = $2 AND term_id = $3
            `,
          [organizationId, currentClassId, termId]
        );

        const existingSignaturePath =
          existingSignatureResult.rows[0]?.signature_image_path;
        if (existingSignaturePath) {
          // Remove the S3 URL prefix to get the key if needed
          const s3Prefix = `https://${process.env.S3_BUCKET_NAME}.s3.${process.env.AWS_REGION}.amazonaws.com/`;
          let oldSignatureKey = existingSignaturePath;
          if (existingSignaturePath.startsWith(s3Prefix)) {
            oldSignatureKey = existingSignaturePath.substring(s3Prefix.length);
          }
          await deleteFromS3(oldSignatureKey);
        }

        // Insert or update the new signature image path
        await db.query(
          `
                INSERT INTO report_settings (organization_id, class_id, term_id, signature_image_path)
                VALUES ($1, $2, $3, $4)
                ON CONFLICT (organization_id, class_id, term_id)
                DO UPDATE SET signature_image_path = EXCLUDED.signature_image_path
            `,
          [organizationId, currentClassId, termId, uploadedKey]
        );
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
    const { classId, termId, selectedSubjects, selectedAssessments } = req.body;
    const organizationId = req.session.organizationId;

    try {
      if (!classId || !termId || !organizationId) {
        return res
          .status(400)
          .send("Class, term, or organization ID is missing.");
      }

      const subjectIds = Array.isArray(selectedSubjects)
        ? selectedSubjects.map(Number)
        : [Number(selectedSubjects)];
      const assessmentIds = Array.isArray(selectedAssessments)
        ? selectedAssessments.map(Number)
        : [Number(selectedAssessments)];

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
        [termId, organizationId, classId]
      );

      if (classDetailsResult.rows.length === 0) {
        return res.status(404).send("Class or term details not found.");
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
        [subjectIds, classId, organizationId]
      );

      const selectedSubjectsData = await Promise.all(
        subjectsResult.rows.map(async (subject) => {
          const assessmentsResult = await db.query(
            `
                SELECT assessment_id, title, weight, category, max_score
                FROM assessments
                WHERE assessment_id = ANY($1::int[]) AND subject_id = $2 AND class_id = $3 AND term_id = $4 AND organization_id = $5
            `,
            [assessmentIds, subject.subject_id, classId, termId, organizationId]
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
        [classId, termId, organizationId]
      );

      const students = enrolledStudentsResult.rows;

      const scoresResult = await db.query(
        `
            SELECT ar.student_id, a.subject_id, ar.score, a.title AS assessment_title, ar.grade, a.weight
            FROM assessment_results ar
            JOIN assessments a ON ar.assessment_id = a.assessment_id
            WHERE ar.class_id = $1 AND ar.term_id = $2 AND ar.organization_id = $3
        `,
        [classId, termId, organizationId]
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
});

module.exports = printController;
