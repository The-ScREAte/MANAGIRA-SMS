function getOrdinalSuffix(n) {
  const s = ["th", "st", "nd", "rd"];
  const v = n % 100;
  return s[(v - 20) % 10] || s[v] || s[0];
}

const { uploadToS3, deleteFromS3 } = require("../middleware/s3Upload");
const { getClassScheduleForTerm } = require("../utils/classScheduleService");
const {
  notifyStaffOnGuardianReportCreated,
  notifyStaffOnGuardianReply,
} = require("../utils/notificationDigestService");
const notifSvc = require("../utils/notificationService");
const {
  ensureEmailPreferencesSchema,
  getGuardianPreferences,
  getGuardianPreferenceMap,
  setGuardianPreferences,
} = require("../utils/emailPreferences");

async function ensureGuardianReportReadSchema(db) {
  await db.query(
    `CREATE TABLE IF NOT EXISTS guardian_report_reads (
      read_id SERIAL PRIMARY KEY,
      report_id INTEGER NOT NULL,
      guardian_id INTEGER NOT NULL,
      organization_id INTEGER NOT NULL,
      last_viewed_at TIMESTAMP DEFAULT NOW(),
      created_at TIMESTAMP DEFAULT NOW(),
      updated_at TIMESTAMP DEFAULT NOW(),
      UNIQUE(report_id, guardian_id)
    )`
  );
}

async function getGuardianUnreadReportSummary(db, guardianId, organizationId) {
  await ensureGuardianReportReadSchema(db);

  const unreadResult = await db.query(
    `
    SELECT
      r.report_id,
      COUNT(rr.reply_id)::int AS unread_count
    FROM guardian_reports r
    LEFT JOIN guardian_report_reads gr
      ON gr.report_id = r.report_id
     AND gr.guardian_id = r.guardian_id
     AND gr.organization_id = r.organization_id
    LEFT JOIN guardian_report_replies rr
      ON rr.report_id = r.report_id
     AND rr.sender_type = 'staff'
     AND rr.created_at > COALESCE(gr.last_viewed_at, r.created_at)
    WHERE r.guardian_id = $1
      AND r.organization_id = $2
      AND r.deleted_at IS NULL
    GROUP BY r.report_id
    HAVING COUNT(rr.reply_id) > 0
    `,
    [guardianId, organizationId]
  );

  const unreadByReport = new Map();
  let totalUnreadMessages = 0;

  unreadResult.rows.forEach((row) => {
    const unreadCount = Number.parseInt(row.unread_count, 10) || 0;
    unreadByReport.set(String(row.report_id), unreadCount);
    totalUnreadMessages += unreadCount;
  });

  return {
    totalUnreadMessages,
    unreadReportCount: unreadResult.rows.length,
    unreadByReport,
  };
}

async function getGuardianApprovedStudents(db, guardianId, organizationId) {
  return db.query(
    `
    SELECT DISTINCT s.student_id, s.first_name, s.last_name, s.image_url,
           c.class_name, c.class_id, 'approved' as status
    FROM students s
    LEFT JOIN classes c ON s.class_id = c.class_id
    WHERE s.organization_id = $2
      AND (
        EXISTS (
          SELECT 1 FROM guardians g
          WHERE g.student_id = s.student_id
            AND g.guardian_id = $1
            AND g.organization_id = $2
        )
        OR EXISTS (
          SELECT 1 FROM guardian_students gs
          WHERE gs.student_id = s.student_id
            AND gs.guardian_id = $1
        )
      )
    ORDER BY s.first_name ASC
    `,
    [guardianId, organizationId]
  );
}

async function getGuardianPendingStudents(db, guardianId, organizationId) {
  try {
    return await db.query(
      `
      SELECT DISTINCT ps.pending_id, ps.first_name, ps.last_name, ps.image_url,
             c.class_name, c.class_id, 'pending' as status
      FROM pending_students ps
      LEFT JOIN classes c ON ps.class_id = c.class_id
      WHERE ps.organization_id = $2
        AND EXISTS (
          SELECT 1 FROM pending_student_guardians psg
          WHERE psg.pending_student_id = ps.pending_id
            AND psg.guardian_id = $1
        )
      ORDER BY ps.first_name ASC
      `,
      [guardianId, organizationId]
    );
  } catch (error) {
    return { rows: [] };
  }
}

async function guardianHasStudentAccess(db, guardianId, organizationId, studentId) {
  const ownership = await db.query(
    `
    SELECT 1
    FROM students s
    WHERE s.student_id = $1
      AND s.organization_id = $2
      AND (
        EXISTS (
          SELECT 1 FROM guardians g
          WHERE g.student_id = s.student_id
            AND g.guardian_id = $3
            AND g.organization_id = $2
        )
        OR EXISTS (
          SELECT 1 FROM guardian_students gs
          WHERE gs.student_id = s.student_id
            AND gs.guardian_id = $3
        )
      )
    LIMIT 1
    `,
    [studentId, organizationId, guardianId]
  );

  return ownership.rows.length > 0;
}

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

      const kids = await getGuardianApprovedStudents(db, guardianId, organizationId);
      const pendingKids = await getGuardianPendingStudents(db, guardianId, organizationId);
      const inboxSummary = await getGuardianUnreadReportSummary(db, guardianId, organizationId);

      // Combine approved and pending students
      const allChildren = [...kids.rows, ...pendingKids.rows];

            return res.render("guardian/dashboard", {
        title: "Parent Portal",
        guardian: guardian,
        children: allChildren,
        inboxSummary,
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

      const hasAccess = await guardianHasStudentAccess(db, guardianId, organizationId, studentId);

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

      const classSchedule = student.class_id
        ? await getClassScheduleForTerm(db, { organizationId, classId: student.class_id, termId })
        : null;

      return res.render("guardian/student", {
        title: "Student Progress",
        student,
        subjects,
        guardians: guardiansResult.rows,
        mainTeacher: mainTeacherResult.rows[0] || null,
        subjectTeachers: subjectTeachersResult.rows,
        terms: termsResult.rows,
        selectedTermId: termId,
        classSchedule,
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
      const students = await getGuardianApprovedStudents(db, guardianId, organizationId);

      // Email notification preferences for this guardian
      let notificationPrefs = [];
      let savedNotificationPrefs = {};
      try {
        await ensureEmailPreferencesSchema(db);
        notificationPrefs = getGuardianPreferences();
        savedNotificationPrefs = await getGuardianPreferenceMap(db, guardianId);
      } catch (_) {
        notificationPrefs = [];
        savedNotificationPrefs = {};
      }

      // PayGira saved cards (for Cards & Billing card on settings page).
      // Table is auto-created the first time the PayGira routes are hit;
      // we just read here and gracefully fall back if it doesn't exist yet.
      let cards = [];
      try {
        const c = await db.query(
          `SELECT card_id, brand, last4, holder_name, exp_month, exp_year, is_default, student_id
             FROM guardian_payment_methods
            WHERE guardian_id=$1 AND organization_id=$2
            ORDER BY is_default DESC, created_at DESC`,
          [guardianId, organizationId]
        );
        cards = c.rows;
      } catch (_) { cards = []; }

      // List of children (for the "attach card to child" dropdown)
      let children = [];
      try {
        const k = await db.query(
          `SELECT DISTINCT s.student_id, s.first_name, s.last_name
             FROM students s
            WHERE s.organization_id = $1
              AND (
                EXISTS (SELECT 1 FROM guardians g
                         WHERE g.student_id=s.student_id AND g.guardian_id=$2 AND g.organization_id=$1)
                OR EXISTS (SELECT 1 FROM guardian_students gs
                         WHERE gs.student_id=s.student_id AND gs.guardian_id=$2)
              )
            ORDER BY s.first_name`,
          [organizationId, guardianId]
        );
        children = k.rows;
      } catch (_) { children = []; }

      return res.render("guardian/settings", {
        title: "Settings",
        guardian: guardian,
        students: students.rows,
        notificationPrefs,
        savedNotificationPrefs,
        cards,
        children,
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
      const normalizedFirstName = String(firstName || '').trim();
      const normalizedLastName = String(lastName || '').trim();
      const normalizedPhone = String(phone || '').trim();
      const normalizedEmail = String(email || '').trim().toLowerCase();
      const normalizedAddress = String(address || '').trim();
      const normalizedHometown = String(hometown || '').trim();

      // Handle guardian profile image upload
      let guardianImageUrl = null;
      if (req.files && req.files['guardianImage']) {
        const guardianImageFile = req.files['guardianImage'][0];
        const s3Key = `images/guardians/${organizationId}/${Date.now()}_${guardianImageFile.originalname}`;
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
        // Verify the student belongs to this guardian before updating
        const hasStudentAccess = await guardianHasStudentAccess(db, guardianId, organizationId, studentId);
        if (!hasStudentAccess) {
          req.flash('error', 'You do not have access to that student');
          return res.redirect('/guardian/settings');
        }
        const studentImageFile = req.files['studentImage'][0];
        const s3Key = `images/studentimages/${organizationId}/${Date.now()}_${studentImageFile.originalname}`;
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
        [normalizedFirstName, normalizedLastName, normalizedPhone, normalizedEmail, normalizedAddress, normalizedHometown, guardianId, organizationId]
      );

      // Update guardian account email and phone
      await db.query(
        `UPDATE guardian_accounts 
         SET login_email = $1, login_phone = $2
         WHERE guardian_id = $3 AND organization_id = $4`,
        [normalizedEmail, normalizedPhone, guardianId, organizationId]
      );

      if (guardianImageUrl) {
        await db.query(
          `UPDATE guardians
           SET first_name = $1, last_name = $2, phone = $3, email = $4,
               address = $5, hometown = $6, image_url = $7
           WHERE guardian_id = $8 AND organization_id = $9`,
          [normalizedFirstName, normalizedLastName, normalizedPhone, normalizedEmail, normalizedAddress, normalizedHometown, guardianImageUrl, guardianId, organizationId]
        );
      } else {
        await db.query(
          `UPDATE guardians
           SET first_name = $1, last_name = $2, phone = $3, email = $4,
               address = $5, hometown = $6
           WHERE guardian_id = $7 AND organization_id = $8`,
          [normalizedFirstName, normalizedLastName, normalizedPhone, normalizedEmail, normalizedAddress, normalizedHometown, guardianId, organizationId]
        );
      }

      req.flash('success', 'Settings updated successfully!');
      return res.redirect('/guardian/settings');
    } catch (error) {
            req.flash('error', 'Error updating settings');
      return res.redirect('/guardian/settings');
    }
  },

  notificationsPost: async (req, res, db) => {
    const guardianId = req.session.guardianId;
    if (!guardianId) {
      req.flash('error', 'You must be signed in.');
      return res.redirect('/account/login');
    }

    try {
      await ensureEmailPreferencesSchema(db);
      const allowed = getGuardianPreferences().map(p => p.key);

      const submittedRaw = req.body.preferences;
      const submitted = Array.isArray(submittedRaw)
        ? submittedRaw
        : (submittedRaw ? [submittedRaw] : []);

      await setGuardianPreferences(db, guardianId, allowed, submitted);

      req.flash('success', 'Notification preferences saved.');
      return res.redirect('/guardian/settings');
    } catch (error) {
      req.flash('error', 'Failed to save notification preferences.');
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
        `SELECT user_id, first_name, last_name, account_type AS role
         FROM users
         WHERE organization_id = $1
           AND account_type IN ('Teacher', 'Manager', 'Supervisor', 'Admin')
           AND on_hold = FALSE
         ORDER BY account_type, first_name ASC`,
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

      // Verify the student belongs to this guardian before inserting
      if (studentIdVal) {
        const hasAccess = await guardianHasStudentAccess(db, guardianId, organizationId, studentIdVal);
        if (!hasAccess) {
          req.flash('error', 'You do not have access to that student');
          return res.redirect('/guardian/report');
        }
      }

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
            `SELECT first_name || ' ' || last_name as name, COALESCE(account_type::text, 'Staff') AS role FROM users WHERE user_id = $1 AND organization_id = $2`,
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

      // Notify selected school staff that a guardian has filed a report.
      notifyStaffOnGuardianReportCreated(db, {
        organizationId,
        reportId,
      }).catch((notifyError) => {
        console.error("[Guardian Report] Staff notification failed:", notifyError.message);
      });

      // A1 — in-app bell notification to each guardian_report_recipients staff member
      notifSvc.notifyReportRecipients(db, {
        orgId: Number(organizationId),
        reportId,
        type: 'guardian_report_new',
        title: `New report: ${subject}`,
        body: String(message || '').substring(0, 120),
        link: `/common/reports`,
      }).catch(err => console.error('[Notif] guardian_report_new failed:', err.message));

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
      const hasAccess = await guardianHasStudentAccess(db, guardianId, organizationId, studentId);

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

      const classSchedule = classId
        ? await getClassScheduleForTerm(db, { organizationId, classId, termId })
        : null;

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
        classSchedule,
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
      // Get guardian profile for name/phone matching
      const guardianProfile = await db.query(
        `SELECT first_name, last_name, phone FROM guardian_profiles WHERE guardian_id = $1 AND organization_id = $2`,
        [guardianId, organizationId]
      );
      const gp = guardianProfile.rows[0];

      let students = [];
      if (gp) {
        const studentsQuery = await getGuardianApprovedStudents(db, guardianId, organizationId);
        students = studentsQuery.rows;
      }

      await ensureGuardianReportReadSchema(db);

      const reports = await db.query(
        `SELECT r.*, s.first_name || ' ' || s.last_name as student_name,
                COUNT(rr.reply_id) as reply_count,
                MAX(rr.created_at) as last_reply_at,
                COALESCE(unread.unread_count, 0) as unread_count
         FROM guardian_reports r
         JOIN students s ON r.student_id = s.student_id
         LEFT JOIN guardian_report_replies rr ON r.report_id = rr.report_id
         LEFT JOIN (
           SELECT r2.report_id, COUNT(rr2.reply_id)::int AS unread_count
           FROM guardian_reports r2
           LEFT JOIN guardian_report_reads gr2
             ON gr2.report_id = r2.report_id
            AND gr2.guardian_id = r2.guardian_id
            AND gr2.organization_id = r2.organization_id
           LEFT JOIN guardian_report_replies rr2
             ON rr2.report_id = r2.report_id
            AND rr2.sender_type = 'staff'
            AND rr2.created_at > COALESCE(gr2.last_viewed_at, r2.created_at)
           WHERE r2.guardian_id = $1 AND r2.organization_id = $2 AND r2.deleted_at IS NULL
           GROUP BY r2.report_id
         ) unread ON unread.report_id = r.report_id
         WHERE r.guardian_id = $1 AND r.organization_id = $2 AND r.deleted_at IS NULL
         GROUP BY r.report_id, s.first_name, s.last_name, unread.unread_count
         ORDER BY r.created_at DESC`,
        [guardianId, organizationId]
      );

      res.render('guardian/reports', {
        title: 'My Reports',
        reports: reports.rows,
        students,
        messages: req.flash(),
        req
      });
    } catch (error) {
            req.flash('error', 'Error loading reports');
      res.redirect('/guardian/dashboard');
    }
  },

  reportNewGet: async (req, res, db) => {
    // Form is now an inline modal on the reports list page
    res.redirect('/guardian/reports');
  },

  // AJAX: Get staff relevant to a student (class teachers + supervisors/managers)
  getStudentStaff: async (req, res, db) => {
    const guardianId = req.session.guardianId;
    const organizationId = req.session.organizationId;
    const studentId = req.query.studentId;

    if (!studentId) {
      return res.json({ success: false, staff: [] });
    }

    try {
      const hasAccess = await guardianHasStudentAccess(db, guardianId, organizationId, studentId);

      if (!hasAccess) {
        return res.json({ success: false, staff: [] });
      }

      // Get the student's class_id
      const studentResult = await db.query(
        `SELECT class_id FROM students WHERE student_id = $1 AND organization_id = $2`,
        [studentId, organizationId]
      );

      const classId = studentResult.rows[0]?.class_id;
      let staff = [];

      if (classId) {
        // Get class teachers assigned to this student's class
        const teachersQuery = await db.query(
          `SELECT u.user_id, u.first_name, u.last_name, u.account_type AS role, TRUE AS is_class_teacher
           FROM user_classes uc
           JOIN users u ON uc.user_id = u.user_id
           WHERE uc.class_id = $1 AND u.organization_id = $2 AND u.on_hold = FALSE
           ORDER BY uc.main DESC, u.first_name ASC`,
          [classId, organizationId]
        );
        staff = teachersQuery.rows;
      }

      // Also get supervisors and managers (always relevant)
      const managersQuery = await db.query(
        `SELECT u.user_id, u.first_name, u.last_name, u.account_type AS role, FALSE AS is_class_teacher
         FROM users u
         WHERE u.organization_id = $1
           AND u.account_type IN ('Manager', 'Supervisor')
           AND u.on_hold = FALSE
           AND u.user_id NOT IN (SELECT user_id FROM unnest($2::int[]) AS user_id)
         ORDER BY u.account_type, u.first_name ASC`,
        [organizationId, staff.map(s => s.user_id)]
      );

      staff = [...staff, ...managersQuery.rows];

      res.json({ success: true, staff });
    } catch (error) {
      console.error('[Guardian] Error fetching student staff:', error);
      res.json({ success: false, staff: [] });
    }
  },

  reportCreatePost: async (req, res, db) => {
    const guardianId = req.session.guardianId;
    const organizationId = req.session.organizationId;
    const { student_id, subject, message, priority, cc_recipients } = req.body;

    try {
      // Verify the student belongs to this guardian
      if (!student_id) {
        req.flash('error', 'Please select a student');
        return res.redirect('/guardian/reports');
      }
      const hasAccess = await guardianHasStudentAccess(db, guardianId, organizationId, student_id);
      if (!hasAccess) {
        req.flash('error', 'You do not have access to that student');
        return res.redirect('/guardian/reports');
      }

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
            `SELECT first_name || ' ' || last_name as name, COALESCE(account_type::text, 'Staff') AS role FROM users WHERE user_id = $1`,
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

      // Notify selected school staff that a guardian has filed a report.
      notifyStaffOnGuardianReportCreated(db, {
        organizationId,
        reportId,
      }).catch((notifyError) => {
        console.error("[Guardian Report] Staff notification failed:", notifyError.message);
      });

      // A1 — in-app bell notification to each guardian_report_recipients staff member
      notifSvc.notifyReportRecipients(db, {
        orgId: Number(organizationId),
        reportId,
        type: 'guardian_report_new',
        title: `New report: ${subject}`,
        body: String(message || '').substring(0, 120),
        link: `/common/reports`,
      }).catch(err => console.error('[Notif] guardian_report_new failed:', err.message));

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
      await ensureGuardianReportReadSchema(db);

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

      await db.query(
        `INSERT INTO guardian_report_reads (report_id, guardian_id, organization_id, last_viewed_at, updated_at)
         VALUES ($1, $2, $3, NOW(), NOW())
         ON CONFLICT (report_id, guardian_id)
         DO UPDATE SET last_viewed_at = EXCLUDED.last_viewed_at, updated_at = NOW()`,
        [reportId, guardianId, organizationId]
      );

      // Get replies with real sender names
      const repliesQuery = await db.query(
        `SELECT rr.*,
                CASE 
                  WHEN rr.sender_type = 'staff' THEN COALESCE(
                    (SELECT u.first_name || ' ' || u.last_name FROM users u WHERE u.user_id = rr.sender_id),
                    rr.sender_name
                  )
                  WHEN rr.sender_type = 'guardian' THEN COALESCE(
                    (SELECT gp.first_name || ' ' || gp.last_name FROM guardian_profiles gp WHERE gp.guardian_id = rr.sender_id),
                    rr.sender_name
                  )
                  ELSE rr.sender_name
                END AS display_name
         FROM guardian_report_replies rr
         WHERE rr.report_id = $1
         ORDER BY rr.created_at ASC`,
        [reportId]
      );

      // Get CC recipients with real names
      const recipientsQuery = await db.query(
        `SELECT grr.*,
                COALESCE(u.first_name || ' ' || u.last_name, grr.user_name) AS display_name,
                COALESCE(u.account_type::text, grr.user_role) AS display_role
         FROM guardian_report_recipients grr
         LEFT JOIN users u ON u.user_id = grr.user_id
         WHERE grr.report_id = $1
         ORDER BY display_name ASC`,
        [reportId]
      );

      // Get class teachers for this student
      let classTeachers = [];
      if (report.student_id) {
        const studentClass = await db.query(
          `SELECT class_id FROM students WHERE student_id = $1 AND organization_id = $2`,
          [report.student_id, organizationId]
        );
        const classId = studentClass.rows[0]?.class_id;
        if (classId) {
          const teachersQuery = await db.query(
            `SELECT u.first_name || ' ' || u.last_name AS name, u.account_type AS role, uc.main
             FROM user_classes uc
             JOIN users u ON uc.user_id = u.user_id
             WHERE uc.class_id = $1 AND u.organization_id = $2 AND u.on_hold = FALSE
             ORDER BY uc.main DESC, u.first_name ASC`,
            [classId, organizationId]
          );
          classTeachers = teachersQuery.rows;
        }
      }

      res.render('guardian/reportDetails', {
        title: 'Report Details',
        report,
        replies: repliesQuery.rows,
        recipients: recipientsQuery.rows,
        classTeachers,
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

      // Notify relevant school staff that the guardian replied.
      notifyStaffOnGuardianReply(db, {
        organizationId,
        reportId: Number.parseInt(reportId, 10),
        replyMessage: message,
      }).catch((notifyError) => {
        console.error("[Guardian Reply] Staff notification failed:", notifyError.message);
      });

      // A2 — in-app bell notification to each report recipient staff member
      notifSvc.notifyReportRecipients(db, {
        orgId: Number(organizationId),
        reportId: Number.parseInt(reportId, 10),
        type: 'guardian_reply',
        title: 'Guardian replied to a report',
        body: String(message || '').substring(0, 120),
        link: `/common/reports`,
      }).catch(err => console.error('[Notif] guardian_reply failed:', err.message));

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

  reportDeletePost: async (req, res, db) => {
    const guardianId = req.session.guardianId;
    const organizationId = req.session.organizationId;
    const reportId = req.params.id;

    try {
      // Verify ownership before deleting
      const check = await db.query(
        `SELECT report_id FROM guardian_reports
         WHERE report_id = $1 AND guardian_id = $2 AND organization_id = $3`,
        [reportId, guardianId, organizationId]
      );

      if (check.rows.length === 0) {
        req.flash('error', 'Report not found');
        return res.redirect('/guardian/reports');
      }

      // Hard delete: remove replies, recipients, reads, then the report itself
      await db.query(`DELETE FROM guardian_report_replies WHERE report_id = $1`, [reportId]);
      await db.query(`DELETE FROM guardian_report_recipients WHERE report_id = $1`, [reportId]);
      await db.query(`DELETE FROM guardian_report_reads WHERE report_id = $1`, [reportId]);
      await db.query(`DELETE FROM guardian_reports WHERE report_id = $1 AND guardian_id = $2 AND organization_id = $3`, [reportId, guardianId, organizationId]);

      req.flash('success', 'Report deleted');
      return res.redirect('/guardian/reports');
    } catch (error) {
      req.flash('error', 'Error deleting report');
      return res.redirect('/guardian/reports');
    }
  },

  editPendingStudentGet: async (req, res, db) => {

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
        ? [firstName, lastName, dateOfBirth, gender, hometown, classId, graduationYearGroupId || null, imageUrl, pendingId, organizationId]
        : [firstName, lastName, dateOfBirth, gender, hometown, classId, graduationYearGroupId || null, pendingId, organizationId];

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
