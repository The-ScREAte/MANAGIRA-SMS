function getOrdinalSuffix(n) {
  const s = ["th", "st", "nd", "rd"];
  const v = n % 100;
  return s[(v - 20) % 10] || s[v] || s[0];
}

const { uploadToS3, deleteFromS3 } = require("../middleware/s3Upload");

module.exports = {
  dashboardGet: async (req, res, db) => {
    const organizationId = req.session.organizationId;
    const guardianId = req.session.guardianId;

        try {
      // Get guardian profile info with full details
      const guardianProfile = await db.query(
        `SELECT gp.*, ga.login_email 
         FROM guardian_profiles gp
         LEFT JOIN guardian_accounts ga ON ga.guardian_id = gp.guardian_id
         WHERE gp.guardian_id = $1 AND gp.organization_id = $2`,
        [guardianId, organizationId]
      );

      if (!guardianProfile.rows.length) {
        console.error('[Guardian Dashboard] Guardian profile not found:', { guardianId, organizationId });
        req.flash('error', 'Guardian profile not found');
        return res.redirect('/account/login');
      }

      const guardian = guardianProfile.rows[0];

      // Query approved students from OLD guardians table AND new guardian_students linking table
      const kids = await db.query(
        `
        SELECT DISTINCT s.student_id, s.first_name, s.last_name, s.image_url,
               c.class_name, c.class_id, 'approved' as status
        FROM students s
        LEFT JOIN classes c ON s.class_id = c.class_id
        WHERE s.organization_id = $4
          AND (
            -- Old guardians table matching
            EXISTS (
              SELECT 1 FROM guardians g 
              WHERE g.student_id = s.student_id 
                AND g.first_name = $1 
                AND g.last_name = $2 
                AND (g.phone = $3 OR $3 IS NULL)
                AND g.organization_id = $4
            )
            -- New guardian_students linking table
            OR EXISTS (
              SELECT 1 FROM guardian_students gs
              WHERE gs.student_id = s.student_id
                AND gs.guardian_id = $5
            )
          )
        ORDER BY s.first_name ASC
        `,
        [guardian.first_name, guardian.last_name, guardian.phone, organizationId, guardianId]
      );

      // Query pending students linked to this guardian via pending_guardians table
      // This matches guardians by name, phone, and email from existing guardian profile
      let pendingKids = { rows: [] };
      try {
        pendingKids = await db.query(
          `
          SELECT DISTINCT ps.pending_id, ps.first_name, ps.last_name, ps.image_url,
                 c.class_name, c.class_id, 'pending' as status
          FROM pending_students ps
          LEFT JOIN classes c ON ps.class_id = c.class_id
          WHERE ps.organization_id = $1
            AND EXISTS (
              SELECT 1 FROM pending_guardians pg
              WHERE pg.pending_id = ps.pending_id
                AND pg.first_name = $2
                AND pg.last_name = $3
                AND (pg.phone = $4 OR pg.email = $5)
            )
          ORDER BY ps.first_name ASC
          `,
          [organizationId, guardian.first_name, guardian.last_name, guardian.phone, guardian.email]
        );
      } catch (pendingError) {
        // Continue without pending students if query fails
      }

      // Combine approved and pending students
      const allChildren = [...kids.rows, ...pendingKids.rows];

            return res.render("guardian/dashboard", {
        title: "Parent Portal",
        guardian: guardian,
        children: allChildren,
        currentTermId: req.session.currentTermId || null,
        messages: req.flash(),
        req,
      });
    } catch (error) {
      console.error('[Guardian Dashboard] Error:', error);
      console.error('[Guardian Dashboard] Error stack:', error.stack);
      console.error('[Guardian Dashboard] Session info:', { 
        guardianId: req.session.guardianId, 
        organizationId: req.session.organizationId 
      });
            req.flash('error', 'Error loading dashboard');
      return res.redirect('/account/login');
    }
  },

  studentDetailsCommonGet: async (req, res, db) => {
    const organizationId = req.session.organizationId;
    const guardianId = req.session.guardianId;

    const studentId = req.query.studentId;
    const termId = req.query.termId || req.session.currentTermId;

    if (!studentId || !termId) {
      return res.status(400).send("Student ID and Term ID are required.");
    }

    try {
      if (!organizationId) {
        req.flash("error", "Organization ID is missing.");
        return res.redirect("/guardian/dashboard");
      }

      // ✅ Security: guardian must be linked to this student
      // Prefer guardian_students, but fall back to legacy guardians matching (same behavior as dashboard)
      let hasAccess = false;
      const link = await db.query(
        `SELECT 1 FROM guardian_students WHERE guardian_id=$1 AND student_id=$2 LIMIT 1`,
        [guardianId, studentId]
      );
      if (link.rows.length) {
        hasAccess = true;
      } else {
        const guardianProfile = await db.query(
          `SELECT first_name, last_name, phone
           FROM guardian_profiles
           WHERE guardian_id = $1 AND organization_id = $2
           LIMIT 1`,
          [guardianId, organizationId]
        );
        if (guardianProfile.rows.length) {
          const g = guardianProfile.rows[0];
          const legacy = await db.query(
            `SELECT 1
             FROM guardians
             WHERE student_id = $1 AND organization_id = $2
               AND first_name = $3 AND last_name = $4
               AND (phone = $5 OR $5 IS NULL)
             LIMIT 1`,
            [studentId, organizationId, g.first_name, g.last_name, g.phone]
          );
          hasAccess = legacy.rows.length > 0;
        }
      }

      if (!hasAccess) {
        req.flash("error", "You do not have access to that student.");
        return res.redirect("/guardian/dashboard");
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

      // For guardians: show subjects the student is enrolled in
      const subjectsResult = await db.query(
        `
          SELECT s.subject_id, s.subject_name
          FROM student_subjects ss
          INNER JOIN subjects s ON ss.subject_id = s.subject_id
          WHERE ss.student_id = $1 AND ss.organization_id = $2
          ORDER BY s.subject_name
        `,
        [studentId, organizationId]
      );

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

      // Fetch assessments and scores for the student for the specified term
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

      // Positions
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

      // Unique assessments for headers
      const uniqueAssessments = Array.from(
        new Set(assessmentsResult.rows.map((a) => a.title))
      ).map((title) => {
        return assessmentsResult.rows.find((a) => a.title === title);
      });

      // Guardians associated with the student (staff page shows this; for guardians we'll keep it, but the template will hide it)
      const guardiansResult = await db.query(
        `SELECT * FROM guardians WHERE student_id = $1`,
        [studentId]
      );

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

      return res.render("common/studentDetails", {
        title: "Student Details",
        student,
        guardians: guardiansResult.rows,
        subjects,
        uniqueAssessments,
        isMainTeacher: false,
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
    } catch (error) {
            req.flash("error", "Error loading student details");
      return res.redirect("/guardian/dashboard");
    }
  },

  studentDetailsGet: async (req, res, db) => {
    const organizationId = req.session.organizationId;
    const guardianId = req.session.guardianId;

    const studentId = req.query.studentId;
    const termId = req.query.termId || req.session.currentTermId;

    try {
      if (!studentId) return res.status(400).send("Student ID is required.");
      if (!termId) return res.status(400).send("Term ID is required.");

      // ✅ Security: guardian must be linked to this student
      const link = await db.query(
        `SELECT 1 FROM guardian_students WHERE guardian_id=$1 AND student_id=$2 LIMIT 1`,
        [guardianId, studentId]
      );
      if (!link.rows.length) {
        req.flash("error", "You do not have access to that student.");
        return res.redirect("/guardian/dashboard");
      }

      // Student details
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

      if (!studentResult.rows.length) return res.status(404).send("Student not found.");
      const student = studentResult.rows[0];

      // Subjects student is enrolled in
      const subjectsResult = await db.query(
        `
        SELECT s.subject_id, s.subject_name
        FROM student_subjects ss
        INNER JOIN subjects s ON ss.subject_id = s.subject_id
        WHERE ss.student_id = $1 AND ss.organization_id = $2
        ORDER BY s.subject_name
        `,
        [studentId, organizationId]
      );

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

      // Assessments + scores for that term
      const assessmentsResult = await db.query(
        `
        SELECT DISTINCT ON (a.assessment_id)
          a.assessment_id, a.title, a.weight, a.max_score, a.category, a.subject_id,
          ar.score, ar.total_subject_score, ar.total_percentage, ar.grade
        FROM assessments a
        LEFT JOIN assessment_results ar
          ON a.assessment_id = ar.assessment_id AND ar.student_id = $1
        WHERE a.organization_id = $2 AND a.term_id = $3
          AND a.subject_id IN (SELECT subject_id FROM student_subjects WHERE student_id=$1 AND organization_id=$2)
        ORDER BY a.assessment_id
        `,
        [studentId, organizationId, termId]
      );

      assessmentsResult.rows.forEach((assessment) => {
        if (!subjectsMap.has(assessment.subject_id)) return;
        const subject = subjectsMap.get(assessment.subject_id);

        subject.assessments.push(assessment);

        if (assessment.score !== null) {
          subject.totalScore += parseFloat(assessment.score);
          subject.totalMaxScore += parseFloat(assessment.max_score);
        }
        if (assessment.total_percentage !== null) subject.totalPercentage = parseFloat(assessment.total_percentage);
        if (assessment.grade) subject.grade = assessment.grade;
      });

      // Positions (if your table stores term_id like your staff page expects)
      const positionsResult = await db.query(
        `
        SELECT subject_id, position
        FROM student_positions
        WHERE student_id = $1 AND organization_id = $2 AND term_id = $3
        `,
        [studentId, organizationId, termId]
      );
      const positions = positionsResult.rows.reduce((acc, row) => {
        acc[row.subject_id] = row.position;
        return acc;
      }, {});

      subjectsMap.forEach((s) => {
        s.position = positions[s.subject_id] ? `${positions[s.subject_id]}${getOrdinalSuffix(positions[s.subject_id])}` : "-";
      });

      const subjects = Array.from(subjectsMap.values());

      // Guardians (from your existing table) so the parent can see who else is listed
      const guardiansResult = await db.query(`SELECT * FROM guardians WHERE student_id=$1`, [studentId]);

      // Teacher info
      const mainTeacherResult = await db.query(
        `
        SELECT u.first_name, u.last_name, u.email
        FROM user_classes uc
        JOIN users u ON u.user_id = uc.user_id
        WHERE uc.class_id = $1 AND uc.main = TRUE
        LIMIT 1
        `,
        [student.class_id]
      );

      const subjectTeachersResult = await db.query(
        `
        SELECT s.subject_id, s.subject_name, u.first_name, u.last_name, u.email
        FROM subjects s
        LEFT JOIN user_subjects us ON us.subject_id = s.subject_id
        LEFT JOIN users u ON u.user_id = us.user_id
        WHERE s.class_id = $1 AND s.organization_id = $2
        ORDER BY s.subject_name
        `,
        [student.class_id, organizationId]
      );

      // Terms list for dropdown
      const termsResult = await db.query(
        `SELECT term_id, term_name FROM terms WHERE organization_id=$1 ORDER BY start_date DESC`,
        [organizationId]
      );

      return res.render("guardian/student", {
        title: "Student Progress",
        student,
        subjects,
        guardians: guardiansResult.rows,
        mainTeacher: mainTeacherResult.rows[0] || null,
        subjectTeachers: subjectTeachersResult.rows,
        terms: termsResult.rows,
        selectedTermId: termId,
        messages: req.flash(),
        req,
      });
    } catch (error) {
            req.flash('error', 'Error loading student details');
      return res.redirect('/guardian/dashboard');
    }
  },

  settingsGet: async (req, res, db) => {
    const organizationId = req.session.organizationId;
    const guardianId = req.session.guardianId;

    try {
      // Get guardian profile info
      const guardianProfile = await db.query(
        `SELECT gp.*, ga.login_email, ga.login_phone 
         FROM guardian_profiles gp
         LEFT JOIN guardian_accounts ga ON ga.guardian_id = gp.guardian_id
         WHERE gp.guardian_id = $1 AND gp.organization_id = $2`,
        [guardianId, organizationId]
      );

      if (!guardianProfile.rows.length) {
        req.flash('error', 'Guardian profile not found');
        return res.redirect('/account/login');
      }

      const guardian = guardianProfile.rows[0];

      // Get guardian's students
      const students = await db.query(
        `SELECT s.student_id, s.first_name, s.last_name, s.image_url
         FROM guardians g
         JOIN students s ON g.student_id = s.student_id
         WHERE g.guardian_id = $1 AND g.organization_id = $2
         ORDER BY s.first_name ASC`,
        [guardianId, organizationId]
      );

      return res.render("guardian/settings", {
        title: "Settings",
        guardian: guardian,
        students: students.rows,
        messages: req.flash(),
        req,
      });
    } catch (error) {
            req.flash('error', 'Error loading settings');
      return res.redirect('/guardian/dashboard');
    }
  },

  settingsPost: async (req, res, db) => {
    const organizationId = req.session.organizationId;
    const guardianId = req.session.guardianId;
    const { firstName, lastName, phone, email, address, hometown, studentId } = req.body;

    try {
      // Handle guardian profile image upload
      let guardianImageUrl = null;
      if (req.files && req.files['guardianImage']) {
        const guardianImageFile = req.files['guardianImage'][0];
        const s3Key = `images/guardians/${organizationId}/${guardianImageFile.originalname}`;
        guardianImageUrl = await uploadToS3(guardianImageFile, s3Key);
        
        // Update guardian profile image
        await db.query(
          `UPDATE guardian_profiles 
           SET image_url = $1, updated_at = NOW()
           WHERE guardian_id = $2 AND organization_id = $3`,
          [guardianImageUrl, guardianId, organizationId]
        );
      }

      // Handle student image upload if a student was selected
      if (studentId && req.files && req.files['studentImage']) {
        const studentImageFile = req.files['studentImage'][0];
        const s3Key = `images/studentimages/${organizationId}/${studentImageFile.originalname}`;
        const studentImageUrl = await uploadToS3(studentImageFile, s3Key);
        
        // Update student image
        await db.query(
          `UPDATE students 
           SET image_url = $1
           WHERE student_id = $2 AND organization_id = $3`,
          [studentImageUrl, studentId, organizationId]
        );
      }

      // Update guardian profile
      await db.query(
        `UPDATE guardian_profiles 
         SET first_name = $1, last_name = $2, phone = $3, email = $4, 
             address = $5, hometown = $6, updated_at = NOW()
         WHERE guardian_id = $7 AND organization_id = $8`,
        [firstName, lastName, phone, email, address, hometown, guardianId, organizationId]
      );

      // Update guardian account email and phone
      await db.query(
        `UPDATE guardian_accounts 
         SET login_email = $1, login_phone = $2
         WHERE guardian_id = $3 AND organization_id = $4`,
        [email, phone, guardianId, organizationId]
      );

      req.flash('success', 'Settings updated successfully!');
      return res.redirect('/guardian/settings');
    } catch (error) {
            req.flash('error', 'Error updating settings');
      return res.redirect('/guardian/settings');
    }
  },

  reportGet: async (req, res, db) => {
    const organizationId = req.session.organizationId;
    const guardianId = req.session.guardianId;

    try {
      // Get guardian's children by guardian_id to ensure only their children are shown
      const children = await db.query(
        `SELECT s.student_id, s.first_name, s.last_name
         FROM guardians g
         JOIN students s ON g.student_id = s.student_id
         WHERE g.guardian_id = $1 AND g.organization_id = $2
         ORDER BY s.first_name ASC`,
        [guardianId, organizationId]
      );

      // Get staff members for CC (teachers, managers, supervisors)
      const staffQuery = await db.query(
        `SELECT user_id, first_name, last_name, role
         FROM users
         WHERE organization_id = $1
           AND role IN ('Teacher', 'Manager', 'Supervisor', 'Admin')
           AND account_status = 'active'
         ORDER BY role, first_name ASC`,
        [organizationId]
      );

      return res.render("guardian/report", {
        title: "Submit Report",
        children: children.rows,
        staff: staffQuery.rows,
        messages: req.flash(),
        req,
      });
    } catch (error) {
            req.flash('error', 'Error loading report page');
      return res.redirect('/guardian/dashboard');
    }
  },

  reportPost: async (req, res, db) => {
    const organizationId = req.session.organizationId;
    const guardianId = req.session.guardianId;
    const { studentId, reportType, subject, message } = req.body;

    try {
      // Create guardian_reports table if it doesn't exist and insert report
      await db.query(
        `CREATE TABLE IF NOT EXISTS guardian_reports (
          report_id SERIAL PRIMARY KEY,
          guardian_id INTEGER NOT NULL,
          student_id INTEGER,
          organization_id INTEGER NOT NULL,
          report_type VARCHAR(50),
          subject VARCHAR(255),
          message TEXT,
          status VARCHAR(50) DEFAULT 'pending',
          priority VARCHAR(50) DEFAULT 'normal',
          created_at TIMESTAMP DEFAULT NOW(),
          updated_at TIMESTAMP DEFAULT NOW(),
          deleted_at TIMESTAMP
        )`
      );

      // Ensure recipients table exists
      await db.query(
        `CREATE TABLE IF NOT EXISTS guardian_report_recipients (
          recipient_id SERIAL PRIMARY KEY,
          report_id INTEGER NOT NULL,
          user_id INTEGER NOT NULL,
          user_name VARCHAR(255),
          user_role VARCHAR(100),
          added_at TIMESTAMP DEFAULT NOW(),
          UNIQUE(report_id, user_id)
        )`
      );

      const studentIdVal = studentId && studentId !== 'general' ? studentId : null;

      const insertResult = await db.query(
        `INSERT INTO guardian_reports (guardian_id, student_id, organization_id, report_type, subject, message, status)
         VALUES ($1, $2, $3, $4, $5, $6, 'pending') RETURNING report_id`,
        [guardianId, studentIdVal, organizationId, reportType, subject, message]
      );

      const reportId = insertResult.rows[0].report_id;

      // Handle CC recipients (checkboxes named cc_recipients)
      const cc = req.body.cc_recipients;
      if (cc) {
        const recipientIds = Array.isArray(cc) ? cc : [cc];
        for (const userId of recipientIds) {
          // fetch user name and role
          const userInfo = await db.query(
            `SELECT first_name || ' ' || last_name as name, role FROM users WHERE user_id = $1 AND organization_id = $2`,
            [userId, organizationId]
          );
          if (userInfo.rows.length > 0) {
            const name = userInfo.rows[0].name;
            const role = userInfo.rows[0].role;
            try {
              await db.query(
                `INSERT INTO guardian_report_recipients (report_id, user_id, user_name, user_role)
                 VALUES ($1, $2, $3, $4) ON CONFLICT (report_id, user_id) DO NOTHING`,
                [reportId, userId, name, role]
              );
            } catch (innerErr) {
                          }
          }
        }
      }

      req.flash('success', 'Report submitted successfully! The school will review and respond soon.');
      return res.redirect('/guardian/report');
    } catch (error) {
            req.flash('error', 'Error submitting report');
      return res.redirect('/guardian/report');
    }
  },

  academicDetailsGet: async (req, res, db) => {
    const organizationId = req.session.organizationId;
    const guardianId = req.session.guardianId;
    const studentId = req.query.studentId;
    const termId = req.query.termId || req.session.currentTermId;

        if (!studentId || !termId) {
      req.flash('error', 'Student ID and Term ID are required');
      return res.redirect('/guardian/dashboard');
    }

    try {
      // ✅ Security: Verify guardian has access to this student
      const guardianProfile = await db.query(
        `SELECT first_name, last_name, phone
         FROM guardian_profiles
         WHERE guardian_id = $1 AND organization_id = $2`,
        [guardianId, organizationId]
      );

      if (!guardianProfile.rows.length) {
        req.flash('error', 'Guardian profile not found');
        return res.redirect('/account/login');
      }

      const guardian = guardianProfile.rows[0];
      
      // Check access via guardian_students or legacy guardians table
      const link = await db.query(
        `SELECT 1 FROM guardian_students WHERE guardian_id=$1 AND student_id=$2 LIMIT 1`,
        [guardianId, studentId]
      );

      let hasAccess = link.rows.length > 0;

      if (!hasAccess) {
        const legacy = await db.query(
          `SELECT 1
           FROM guardians
           WHERE student_id = $1 AND organization_id = $2
             AND first_name = $3 AND last_name = $4
             AND (phone = $5 OR $5 IS NULL)
           LIMIT 1`,
          [studentId, organizationId, guardian.first_name, guardian.last_name, guardian.phone]
        );
        hasAccess = legacy.rows.length > 0;
      }

      if (!hasAccess) {
        req.flash('error', 'You do not have access to that student');
        return res.redirect('/guardian/dashboard');
      }

      // Fetch student details
      const studentResult = await db.query(
        `SELECT s.*, c.class_name, c.class_id, g.name AS grad_year_group_name
         FROM students s
         LEFT JOIN classes c ON s.class_id = c.class_id
         LEFT JOIN graduation_year_groups g ON s.graduation_year_group_id = g.id
         WHERE s.student_id = $1 AND s.organization_id = $2`,
        [studentId, organizationId]
      );

      if (!studentResult.rows.length) {
        req.flash('error', 'Student not found');
        return res.redirect('/guardian/dashboard');
      }

      const student = studentResult.rows[0];
      const classId = student.class_id;

      // Get term info
      const termResult = await db.query(
        `SELECT t.term_name, t.term_id, sy.year_label
         FROM terms t
         INNER JOIN school_years sy ON t.school_year_id = sy.id
         WHERE t.term_id = $1 AND t.organization_id = $2`,
        [termId, organizationId]
      );

      const termNameForPage = termResult.rows[0]?.term_name || 'Unknown';
      const yearLabel = termResult.rows[0]?.year_label || '';

      // Get enrolled class for this term
      const enrolledClassResult = await db.query(
        `SELECT c.class_name
         FROM enrolled_students es
         JOIN classes c ON es.class_id = c.class_id
         JOIN enrollments e ON es.enrollment_id = e.enrollment_id
         WHERE es.student_id = $1 AND e.term_id = $2 AND e.organization_id = $3
         LIMIT 1`,
        [studentId, termId, organizationId]
      );

      const enrolledClassForTerm = enrolledClassResult.rows[0]?.class_name || 'Not enrolled';

      // Fetch main teacher
      const mainTeacherResult = await db.query(
        `SELECT u.first_name, u.last_name, u.email
         FROM user_classes uc
         JOIN users u ON u.user_id = uc.user_id
         WHERE uc.class_id = $1 AND uc.main = TRUE
         LIMIT 1`,
        [classId]
      );

      // Fetch subjects student is enrolled in
      const subjectsResult = await db.query(
        `SELECT s.subject_id, s.subject_name
         FROM student_subjects ss
         INNER JOIN subjects s ON ss.subject_id = s.subject_id
         WHERE ss.student_id = $1 AND ss.organization_id = $2
         ORDER BY s.subject_name`,
        [studentId, organizationId]
      );

      // Fetch subject teachers only for subjects the student is enrolled in
      const subjectTeachersResult = await db.query(
        `SELECT s.subject_id, s.subject_name, u.first_name, u.last_name, u.email
         FROM student_subjects ss
         INNER JOIN subjects s ON ss.subject_id = s.subject_id
         LEFT JOIN user_subjects us ON us.subject_id = s.subject_id
         LEFT JOIN users u ON u.user_id = us.user_id
         WHERE ss.student_id = $1 AND ss.organization_id = $2
         ORDER BY s.subject_name`,
        [studentId, organizationId]
      );

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

      // Fetch assessments and scores for current term
      const assessmentsResult = await db.query(
        `SELECT DISTINCT ON (a.assessment_id) 
           a.assessment_id, a.title, a.weight, ar.score, a.subject_id, a.max_score, a.category,
           ar.total_subject_score, ar.total_percentage, ar.grade
         FROM assessments a
         LEFT JOIN assessment_results ar ON a.assessment_id = ar.assessment_id AND ar.student_id = $1
         WHERE a.subject_id IN (SELECT subject_id FROM student_subjects WHERE student_id = $1 AND organization_id = $3)
           AND a.organization_id = $3 AND a.term_id = $2
         ORDER BY a.assessment_id`,
        [studentId, termId, organizationId]
      );

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

      // Fetch positions
      const positionsResult = await db.query(
        `SELECT subject_id, position
         FROM student_positions
         WHERE student_id = $1 AND organization_id = $2 AND term_id = $3`,
        [studentId, organizationId, termId]
      );

      const positions = positionsResult.rows.reduce((acc, position) => {
        acc[position.subject_id] = position.position;
        return acc;
      }, {});

      subjectsMap.forEach((subject) => {
        subject.position = positions[subject.subject_id] ? 
          `${positions[subject.subject_id]}${getOrdinalSuffix(positions[subject.subject_id])}` : '-';
      });

      const subjects = Array.from(subjectsMap.values());

      // Unique assessments for headers
      const uniqueAssessments = Array.from(
        new Set(assessmentsResult.rows.map((a) => a.title))
      ).map((title) => {
        return assessmentsResult.rows.find((a) => a.title === title);
      });

      // Fetch attendance records for the term
      const attendanceResult = await db.query(
        `SELECT date, status
         FROM attendance_records
         WHERE student_id = $1 AND organization_id = $2 AND term_id = $3
         ORDER BY date DESC`,
        [studentId, organizationId, termId]
      );

      // Calculate attendance summary
      const attendance = attendanceResult.rows;
      const attendanceSummary = {
        totalDays: attendance.length,
        present: attendance.filter(a => a.status && a.status.toLowerCase() === 'present').length,
        absent: attendance.filter(a => a.status && a.status.toLowerCase() === 'absent').length,
        late: attendance.filter(a => a.status && a.status.toLowerCase() === 'late').length,
        attendanceRate: 0
      };

      if (attendanceSummary.totalDays > 0) {
        attendanceSummary.attendanceRate = (
          (attendanceSummary.present / attendanceSummary.totalDays) * 100
        ).toFixed(1);
      }

      // Fetch past report cards (if table exists)
      let pastResults = [];
      try {
        const pastResultsQuery = await db.query(
          `SELECT 
             t.term_name,
             sy.year_label,
             rc.overall_average,
             rc.overall_grade,
             rc.class_position,
             rc.total_students,
             rc.remarks,
             rc.created_at
           FROM report_cards rc
           INNER JOIN terms t ON rc.term_id = t.term_id
           INNER JOIN school_years sy ON t.school_year_id = sy.id
           WHERE rc.student_id = $1 
             AND rc.organization_id = $2 
             AND rc.term_id != $3
           ORDER BY rc.created_at DESC
           LIMIT 10`,
          [studentId, organizationId, termId]
        );
        pastResults = pastResultsQuery.rows;
      } catch (error) {
                pastResults = [];
      }

      // Fetch last 3 terms for dropdown
      const termsResult = await db.query(
        `SELECT term_id, term_name 
         FROM terms 
         WHERE organization_id = $1 
         ORDER BY start_date DESC
         LIMIT 3`,
        [organizationId]
      );

      return res.render('guardian/studentAcademicDetails', {
        title: `${student.first_name}'s Academic Details`,
        student,
        mainTeacher: mainTeacherResult.rows[0] || null,
        subjectTeachers: subjectTeachersResult.rows,
        subjects,
        uniqueAssessments,
        attendance,
        attendanceSummary,
        pastResults,
        terms: termsResult.rows,
        selectedTermId: termId,
        termNameForPage,
        enrolledClassForTerm,
        messages: req.flash(),
        req,
      });
    } catch (error) {
            req.flash('error', 'Error loading academic details');
      return res.redirect('/guardian/dashboard');
    }
  },

  // ==================== TICKETING/REPORTS SYSTEM ====================
  
  reportsListGet: async (req, res, db) => {
    const guardianId = req.session.guardianId;
    const organizationId = req.session.organizationId;

    try {
      const reports = await db.query(
        `SELECT r.*, s.first_name || ' ' || s.last_name as student_name,
                COUNT(rr.reply_id) as reply_count,
                MAX(rr.created_at) as last_reply_at
         FROM guardian_reports r
         JOIN students s ON r.student_id = s.student_id
         LEFT JOIN guardian_report_replies rr ON r.report_id = rr.report_id
         WHERE r.guardian_id = $1 AND r.organization_id = $2 AND r.deleted_at IS NULL
         GROUP BY r.report_id, s.first_name, s.last_name
         ORDER BY r.created_at DESC`,
        [guardianId, organizationId]
      );

      res.render('guardian/reports', {
        title: 'My Reports',
        reports: reports.rows,
        messages: req.flash(),
        req
      });
    } catch (error) {
            req.flash('error', 'Error loading reports');
      res.redirect('/guardian/dashboard');
    }
  },

  reportNewGet: async (req, res, db) => {
    const guardianId = req.session.guardianId;
    const organizationId = req.session.organizationId;

    try {
      // Get guardian's students
      const studentsQuery = await db.query(
        `SELECT s.student_id, s.first_name, s.last_name, c.class_name
         FROM guardians g
         JOIN students s ON g.student_id = s.student_id
         LEFT JOIN classes c ON s.class_id = c.class_id
         WHERE g.first_name = (SELECT first_name FROM guardian_profiles WHERE guardian_id = $1)
           AND g.last_name = (SELECT last_name FROM guardian_profiles WHERE guardian_id = $1)
           AND g.organization_id = $2
         ORDER BY s.first_name ASC`,
        [guardianId, organizationId]
      );

      // Get staff for CC (teachers, managers, supervisors)
      const staffQuery = await db.query(
        `SELECT user_id, first_name, last_name, role
         FROM users
         WHERE organization_id = $1 
           AND role IN ('Teacher', 'Manager', 'Supervisor', 'Admin')
           AND account_status = 'active'
         ORDER BY role, first_name ASC`,
        [organizationId]
      );

      res.render('guardian/reportNew', {
        title: 'Submit Report',
        students: studentsQuery.rows,
        staff: staffQuery.rows,
        messages: req.flash(),
        req
      });
    } catch (error) {
            req.flash('error', 'Error loading form');
      res.redirect('/guardian/dashboard');
    }
  },

  reportCreatePost: async (req, res, db) => {
    const guardianId = req.session.guardianId;
    const organizationId = req.session.organizationId;
    const { student_id, subject, message, priority, cc_recipients } = req.body;

    try {
      // Create report
      const reportResult = await db.query(
        `INSERT INTO guardian_reports (guardian_id, student_id, organization_id, subject, message, priority)
         VALUES ($1, $2, $3, $4, $5, $6)
         RETURNING report_id`,
        [guardianId, student_id, organizationId, subject, message, priority || 'normal']
      );

      const reportId = reportResult.rows[0].report_id;

      // Add CC recipients if selected
      if (cc_recipients && cc_recipients.length > 0) {
        const recipientIds = Array.isArray(cc_recipients) ? cc_recipients : [cc_recipients];
        
        for (const userId of recipientIds) {
          const userInfo = await db.query(
            `SELECT first_name || ' ' || last_name as name, role FROM users WHERE user_id = $1`,
            [userId]
          );
          
          if (userInfo.rows.length > 0) {
            await db.query(
              `INSERT INTO guardian_report_recipients (report_id, user_id, user_name, user_role)
               VALUES ($1, $2, $3, $4)`,
              [reportId, userId, userInfo.rows[0].name, userInfo.rows[0].role]
            );
          }
        }
      }

      req.flash('success', 'Report submitted successfully');
      res.redirect(`/guardian/reports/${reportId}`);
    } catch (error) {
            req.flash('error', 'Error submitting report');
      res.redirect('/guardian/reports/new');
    }
  },

  reportDetailsGet: async (req, res, db) => {
    const guardianId = req.session.guardianId;
    const organizationId = req.session.organizationId;
    const reportId = req.params.id;

    try {
      // Get report details
      const reportQuery = await db.query(
        `SELECT r.*, s.first_name || ' ' || s.last_name as student_name
         FROM guardian_reports r
         JOIN students s ON r.student_id = s.student_id
         WHERE r.report_id = $1 AND r.guardian_id = $2 AND r.organization_id = $3 AND r.deleted_at IS NULL`,
        [reportId, guardianId, organizationId]
      );

      if (reportQuery.rows.length === 0) {
        req.flash('error', 'Report not found');
        return res.redirect('/guardian/reports');
      }

      const report = reportQuery.rows[0];

      // Get replies
      const repliesQuery = await db.query(
        `SELECT * FROM guardian_report_replies
         WHERE report_id = $1
         ORDER BY created_at ASC`,
        [reportId]
      );

      // Get CC recipients
      const recipientsQuery = await db.query(
        `SELECT * FROM guardian_report_recipients
         WHERE report_id = $1
         ORDER BY user_name ASC`,
        [reportId]
      );

      res.render('guardian/reportDetails', {
        title: 'Report Details',
        report,
        replies: repliesQuery.rows,
        recipients: recipientsQuery.rows,
        messages: req.flash(),
        req
      });
    } catch (error) {
            req.flash('error', 'Error loading report');
      res.redirect('/guardian/reports');
    }
  },

  reportReplyPost: async (req, res, db) => {
    const guardianId = req.session.guardianId;
    const organizationId = req.session.organizationId;
    const reportId = req.params.id;
    const { message } = req.body;

    try {
      // Verify ownership
      const reportCheck = await db.query(
        `SELECT report_id FROM guardian_reports 
         WHERE report_id = $1 AND guardian_id = $2 AND organization_id = $3 AND deleted_at IS NULL`,
        [reportId, guardianId, organizationId]
      );

      if (reportCheck.rows.length === 0) {
        req.flash('error', 'Report not found');
        return res.redirect('/guardian/reports');
      }

      // Get guardian name
      const guardianInfo = await db.query(
        `SELECT first_name || ' ' || last_name as name FROM guardian_profiles WHERE guardian_id = $1`,
        [guardianId]
      );

      // Add reply
      await db.query(
        `INSERT INTO guardian_report_replies (report_id, sender_type, sender_id, sender_name, message)
         VALUES ($1, 'guardian', $2, $3, $4)`,
        [reportId, guardianId, guardianInfo.rows[0].name, message]
      );

      // Update report status to in_progress if it was open
      await db.query(
        `UPDATE guardian_reports 
         SET status = CASE WHEN status = 'open' THEN 'in_progress' ELSE status END
         WHERE report_id = $1`,
        [reportId]
      );

      req.flash('success', 'Reply added');
      res.redirect(`/guardian/reports/${reportId}`);
    } catch (error) {
            req.flash('error', 'Error adding reply');
      res.redirect(`/guardian/reports/${reportId}`);
    }
  },

  editPendingStudentGet: async (req, res, db) => {
    const guardianId = req.session.guardianId;
    const organizationId = req.session.organizationId;
    const pendingId = req.query.pendingId;

    try {
      // Verify the guardian has access to this pending student
      const studentQuery = await db.query(
        `SELECT ps.*, pg.first_name as guardian_first_name, pg.last_name as guardian_last_name, 
                pg.phone as guardian_phone, pg.email as guardian_email
         FROM pending_students ps
         JOIN pending_guardians pg ON pg.pending_id = ps.pending_id
         WHERE ps.pending_id = $1 AND ps.organization_id = $2`,
        [pendingId, organizationId]
      );

      if (!studentQuery.rows.length) {
        req.flash('error', 'Pending student not found');
        return res.redirect('/guardian/dashboard');
      }

      const student = studentQuery.rows[0];

      // Verify guardian access
      const guardianProfile = await db.query(
        `SELECT first_name, last_name, phone, email
         FROM guardian_profiles
         WHERE guardian_id = $1 AND organization_id = $2`,
        [guardianId, organizationId]
      );

      if (!guardianProfile.rows.length) {
        req.flash('error', 'Guardian profile not found');
        return res.redirect('/guardian/dashboard');
      }

      const guardian = guardianProfile.rows[0];
      
      // Check if guardian matches
      if (student.guardian_first_name !== guardian.first_name || 
          student.guardian_last_name !== guardian.last_name ||
          (student.guardian_phone !== guardian.phone && student.guardian_email !== guardian.email)) {
        req.flash('error', 'You do not have permission to edit this application');
        return res.redirect('/guardian/dashboard');
      }

      // Get classes and graduation year groups
      const classesQuery = await db.query(
        `SELECT class_id, class_name FROM classes WHERE organization_id = $1 ORDER BY class_name ASC`,
        [organizationId]
      );

      const graduationGroupsQuery = await db.query(
        `SELECT id, name FROM graduation_year_groups WHERE organization_id = $1 ORDER BY name ASC`,
        [organizationId]
      );

      res.render('guardian/editPendingStudent', {
        title: 'Edit Application',
        student,
        classes: classesQuery.rows,
        graduationYearGroups: graduationGroupsQuery.rows,
        messages: req.flash(),
        req
      });
    } catch (error) {
      console.error('[Edit Pending Student] Error:', error);
      req.flash('error', 'Error loading application');
      res.redirect('/guardian/dashboard');
    }
  },

  editPendingStudentPost: async (req, res, db) => {
    const guardianId = req.session.guardianId;
    const organizationId = req.session.organizationId;
    const { pendingId, firstName, lastName, dateOfBirth, gender, hometown, classId, graduationYearGroupId } = req.body;

    try {
      // Verify access (same as GET)
      const accessCheck = await db.query(
        `SELECT ps.pending_id, pg.first_name as guardian_first_name, pg.last_name as guardian_last_name,
                pg.phone as guardian_phone, pg.email as guardian_email
         FROM pending_students ps
         JOIN pending_guardians pg ON pg.pending_id = ps.pending_id
         WHERE ps.pending_id = $1 AND ps.organization_id = $2 AND ps.approved = false`,
        [pendingId, organizationId]
      );

      if (!accessCheck.rows.length) {
        return res.status(403).json({ success: false, error: 'Access denied' });
      }

      const guardianProfile = await db.query(
        `SELECT first_name, last_name, phone, email
         FROM guardian_profiles
         WHERE guardian_id = $1 AND organization_id = $2`,
        [guardianId, organizationId]
      );

      const guardian = guardianProfile.rows[0];
      const student = accessCheck.rows[0];

      if (student.guardian_first_name !== guardian.first_name || 
          student.guardian_last_name !== guardian.last_name ||
          (student.guardian_phone !== guardian.phone && student.guardian_email !== guardian.email)) {
        return res.status(403).json({ success: false, error: 'Access denied' });
      }

      // Handle image upload if provided
      let imageUrl = null;
      if (req.file) {
        const s3Key = `images/pending-students/${organizationId}/${Date.now()}_${req.file.originalname}`;
        imageUrl = await uploadToS3(req.file, s3Key);
      }

      // Update pending student
      const updateQuery = imageUrl 
        ? `UPDATE pending_students 
           SET first_name = $1, last_name = $2, date_of_birth = $3, gender = $4, 
               hometown = $5, class_id = $6, graduation_year_group_id = $7, image_url = $8
           WHERE pending_id = $9 AND organization_id = $10`
        : `UPDATE pending_students 
           SET first_name = $1, last_name = $2, date_of_birth = $3, gender = $4, 
               hometown = $5, class_id = $6, graduation_year_group_id = $7
           WHERE pending_id = $8 AND organization_id = $9`;

      const updateParams = imageUrl
        ? [firstName, lastName, dateOfBirth, gender, hometown, classId, graduationYearGroupId, imageUrl, pendingId, organizationId]
        : [firstName, lastName, dateOfBirth, gender, hometown, classId, graduationYearGroupId, pendingId, organizationId];

      await db.query(updateQuery, updateParams);

      req.flash('success', 'Application updated successfully');
      res.redirect('/guardian/dashboard');
    } catch (error) {
      console.error('[Edit Pending Student Post] Error:', error);
      req.flash('error', 'Error updating application');
      res.redirect('/guardian/dashboard');
    }
  },

  withdrawPendingStudent: async (req, res, db) => {
    const guardianId = req.session.guardianId;
    const organizationId = req.session.organizationId;
    const { pendingId } = req.body;

    try {
      // Verify access
      const accessCheck = await db.query(
        `SELECT ps.pending_id, pg.first_name as guardian_first_name, pg.last_name as guardian_last_name,
                pg.phone as guardian_phone, pg.email as guardian_email
         FROM pending_students ps
         JOIN pending_guardians pg ON pg.pending_id = ps.pending_id
         WHERE ps.pending_id = $1 AND ps.organization_id = $2`,
        [pendingId, organizationId]
      );

      if (!accessCheck.rows.length) {
        return res.json({ success: false, error: 'Pending student not found' });
      }

      const guardianProfile = await db.query(
        `SELECT first_name, last_name, phone, email
         FROM guardian_profiles
         WHERE guardian_id = $1 AND organization_id = $2`,
        [guardianId, organizationId]
      );

      if (!guardianProfile.rows.length) {
        return res.json({ success: false, error: 'Guardian not found' });
      }

      const guardian = guardianProfile.rows[0];
      const student = accessCheck.rows[0];

      if (student.guardian_first_name !== guardian.first_name || 
          student.guardian_last_name !== guardian.last_name ||
          (student.guardian_phone !== guardian.phone && student.guardian_email !== guardian.email)) {
        return res.json({ success: false, error: 'You do not have permission to withdraw this application' });
      }

      // Delete pending student (CASCADE will delete related records)
      await db.query(
        `DELETE FROM pending_students WHERE pending_id = $1 AND organization_id = $2`,
        [pendingId, organizationId]
      );

      console.log('[Withdraw Pending Student] Successfully withdrew application:', pendingId);
      res.json({ success: true, message: 'Application withdrawn successfully' });
    } catch (error) {
      console.error('[Withdraw Pending Student] Error:', error);
      res.json({ success: false, error: 'Error withdrawing application' });
    }
  },
};
