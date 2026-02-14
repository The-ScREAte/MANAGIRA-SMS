const db = require("../config/db");
const bcrypt = require("bcryptjs");
const crypto = require("crypto");
const { uploadToS3, deleteFromS3 } = require("../config/s3");
const { sendEmailSafely, renderCleanEmail } = require("../utils/emailHelper");

// Helper function to send emails
async function sendEmail({ to, subject, html }) {
  try {
    return await sendEmailSafely({
      to,
      subject,
      html,
      from: process.env.NOTIFY_EMAIL_USER,
    }, "Hub email");
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
  getHubOrganization: async (hubId, organizationId) => {
    const orgResult = await db.query(
      `SELECT o.organization_id, o.organization_name, o.email, o.nickname, o.first_name, o.last_name,
              o.organization_phone, o.organization_address, o.joined_hub_at, o.on_hold,
              (SELECT COUNT(*) FROM students s WHERE s.organization_id = o.organization_id) AS student_count,
              (SELECT COUNT(*) FROM users u WHERE u.organization_id = o.organization_id) AS staff_count,
              (SELECT COUNT(*) FROM classes c WHERE c.organization_id = o.organization_id) AS class_count,
              (SELECT COUNT(*) FROM subjects sub WHERE sub.organization_id = o.organization_id) AS subject_count
       FROM organizations o
       WHERE o.organization_id = $1
         AND o.hub_id = $2
         AND o.deleted = false
         AND o.is_hub_member = true`,
      [organizationId, hubId]
    );

    return orgResult.rows[0] || null;
  },

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

  hubOverviewStatsGet: async (req, res) => {
    let hubId = null;
    let currentStep = 'initialize';
    try {
      hubId = req.session.hubId;
      console.log('[HubOverview] Request started', { hubId });

      const organizationScopeSql = `
        SELECT organization_id, on_hold
        FROM organizations
        WHERE hub_id = $1 AND deleted = false AND is_hub_member = true
      `;

      const organizationIdScopeSql = `
        SELECT organization_id
        FROM organizations
        WHERE hub_id = $1 AND deleted = false AND is_hub_member = true
      `;

      currentStep = 'organizationStatsResult';
      const organizationStatsResult = await db.query(
        `SELECT
           COUNT(*)::int AS organization_count,
           COUNT(*) FILTER (WHERE on_hold = false)::int AS active_organizations,
           COUNT(*) FILTER (WHERE on_hold = true)::int AS on_hold_organizations
         FROM (${organizationScopeSql}) scoped_orgs`,
        [hubId]
      );

      currentStep = 'enrollmentStaffingResult';
      const enrollmentStaffingResult = await db.query(
        `SELECT
           (SELECT COUNT(*)::int FROM students WHERE organization_id IN (${organizationIdScopeSql})) AS total_students,
           (SELECT COUNT(*)::int FROM users WHERE organization_id IN (${organizationIdScopeSql})) AS total_staff,
           (SELECT COUNT(*)::int FROM classes WHERE organization_id IN (${organizationIdScopeSql})) AS total_classes,
           (SELECT COUNT(*)::int FROM subjects WHERE organization_id IN (${organizationIdScopeSql})) AS total_subjects`,
        [hubId]
      );

      currentStep = 'attendanceTotalsResult';
      const attendanceTotalsResult = await db.query(
        `SELECT
           COUNT(*)::int AS total_records,
           COUNT(*) FILTER (WHERE LOWER(COALESCE(a.status::text, '')) = 'present')::int AS present_days,
           COUNT(*) FILTER (WHERE LOWER(COALESCE(a.status::text, '')) = 'absent')::int AS absent_days
         FROM attendance_records a
         JOIN students s ON s.student_id = a.student_id
         WHERE s.organization_id IN (${organizationIdScopeSql})`,
        [hubId]
      );

      currentStep = 'assessmentTotalsResult';
      const assessmentTotalsResult = await db.query(
        `SELECT
           COUNT(ar.student_id)::int AS total_results,
           COALESCE(ROUND(AVG(ar.total_percentage)::numeric, 1), 0) AS average_score,
           COUNT(*) FILTER (WHERE ar.total_percentage >= 50)::int AS pass_count,
           COUNT(*) FILTER (WHERE ar.total_percentage < 50)::int AS fail_count
         FROM assessment_results ar
         JOIN students s ON s.student_id = ar.student_id
         WHERE s.organization_id IN (${organizationIdScopeSql})`,
        [hubId]
      );

      currentStep = 'attendanceByOrganizationResult';
      const attendanceByOrganizationResult = await db.query(
        `SELECT
           o.organization_id,
           o.organization_name,
           COUNT(a.student_id)::int AS total_records,
           COUNT(*) FILTER (WHERE LOWER(COALESCE(a.status::text, '')) = 'present')::int AS present_days,
           COUNT(*) FILTER (WHERE LOWER(COALESCE(a.status::text, '')) = 'absent')::int AS absent_days,
           COALESCE(
             ROUND(
               (
                 COUNT(*) FILTER (WHERE LOWER(COALESCE(a.status::text, '')) = 'present')::numeric
                 / NULLIF(COUNT(a.student_id), 0)
               ) * 100,
               1
             ),
             0
           ) AS present_rate
         FROM organizations o
         LEFT JOIN students s ON s.organization_id = o.organization_id
         LEFT JOIN attendance_records a ON a.student_id = s.student_id
         WHERE o.hub_id = $1
           AND o.deleted = false
           AND o.is_hub_member = true
         GROUP BY o.organization_id, o.organization_name
         ORDER BY present_rate DESC, total_records DESC
         LIMIT 10`,
        [hubId]
      );

      currentStep = 'topPerformingOrganizationsResult';
      const topPerformingOrganizationsResult = await db.query(
        `SELECT
           o.organization_id,
           o.organization_name,
           COALESCE(ROUND(AVG(ar.total_percentage)::numeric, 1), 0) AS average_score,
           COUNT(ar.student_id)::int AS results_count
         FROM organizations o
         LEFT JOIN students s ON s.organization_id = o.organization_id
         LEFT JOIN assessment_results ar ON ar.student_id = s.student_id
         WHERE o.hub_id = $1
           AND o.deleted = false
           AND o.is_hub_member = true
         GROUP BY o.organization_id, o.organization_name
         ORDER BY average_score DESC, results_count DESC
         LIMIT 10`,
        [hubId]
      );

      currentStep = 'organizationLoadComparisonResult';
      const organizationLoadComparisonResult = await db.query(
        `SELECT
           o.organization_id,
           o.organization_name,
           o.on_hold,
           COUNT(DISTINCT s.student_id)::int AS student_count,
           COUNT(DISTINCT u.user_id)::int AS staff_count,
           COUNT(DISTINCT c.class_id)::int AS class_count,
           COUNT(DISTINCT sub.subject_id)::int AS subject_count
         FROM organizations o
         LEFT JOIN students s ON s.organization_id = o.organization_id
         LEFT JOIN users u ON u.organization_id = o.organization_id
         LEFT JOIN classes c ON c.organization_id = o.organization_id
         LEFT JOIN subjects sub ON sub.organization_id = o.organization_id
         WHERE o.hub_id = $1
           AND o.deleted = false
           AND o.is_hub_member = true
         GROUP BY o.organization_id, o.organization_name, o.on_hold
         ORDER BY student_count DESC, o.organization_name ASC
         LIMIT 10`,
        [hubId]
      );

      const orgStats = organizationStatsResult.rows[0] || {};
      const enrollmentStaffing = enrollmentStaffingResult.rows[0] || {};
      const attendanceTotals = attendanceTotalsResult.rows[0] || {};
      const assessmentTotals = assessmentTotalsResult.rows[0] || {};

      const totalStudents = parseInt(enrollmentStaffing.total_students || 0, 10);
      const totalStaff = parseInt(enrollmentStaffing.total_staff || 0, 10);
      const totalClasses = parseInt(enrollmentStaffing.total_classes || 0, 10);

      const totalAttendanceRecords = parseInt(attendanceTotals.total_records || 0, 10);
      const presentDays = parseInt(attendanceTotals.present_days || 0, 10);
      const absentDays = parseInt(attendanceTotals.absent_days || 0, 10);

      const totalAssessmentResults = parseInt(assessmentTotals.total_results || 0, 10);
      const passCount = parseInt(assessmentTotals.pass_count || 0, 10);
      const failCount = parseInt(assessmentTotals.fail_count || 0, 10);

      const attendanceRate = totalAttendanceRecords > 0
        ? Math.round((presentDays / totalAttendanceRecords) * 1000) / 10
        : 0;
      const passRate = totalAssessmentResults > 0
        ? Math.round((passCount / totalAssessmentResults) * 1000) / 10
        : 0;
      const studentsPerClass = totalClasses > 0
        ? Math.round((totalStudents / totalClasses) * 10) / 10
        : 0;
      const studentsPerStaff = totalStaff > 0
        ? Math.round((totalStudents / totalStaff) * 10) / 10
        : 0;

      currentStep = 'respondJson';
      console.log('[HubOverview] Request completed', {
        hubId,
        attendanceOrgRows: attendanceByOrganizationResult.rowCount,
        topSchoolRows: topPerformingOrganizationsResult.rowCount,
        loadRows: organizationLoadComparisonResult.rowCount
      });

      return res.json({
        highlights: {
          attendanceRate,
          averageAssessmentScore: parseFloat(assessmentTotals.average_score || 0),
          passRate,
          studentsPerClass,
          studentsPerStaff
        },
        enrollmentStaffing: {
          organizationCount: parseInt(orgStats.organization_count || 0, 10),
          activeOrganizations: parseInt(orgStats.active_organizations || 0, 10),
          onHoldOrganizations: parseInt(orgStats.on_hold_organizations || 0, 10),
          totalStudents,
          totalStaff,
          totalClasses,
          totalSubjects: parseInt(enrollmentStaffing.total_subjects || 0, 10)
        },
        attendanceByOrganization: attendanceByOrganizationResult.rows.map((row) => ({
          organizationId: row.organization_id,
          organizationName: row.organization_name,
          totalRecords: parseInt(row.total_records || 0, 10),
          presentDays: parseInt(row.present_days || 0, 10),
          absentDays: parseInt(row.absent_days || 0, 10),
          presentRate: parseFloat(row.present_rate || 0)
        })),
        topPerformingOrganizations: topPerformingOrganizationsResult.rows.map((row) => ({
          organizationId: row.organization_id,
          organizationName: row.organization_name,
          averageScore: parseFloat(row.average_score || 0),
          resultsCount: parseInt(row.results_count || 0, 10)
        })),
        organizationLoadComparison: organizationLoadComparisonResult.rows.map((row) => {
          const studentCount = parseInt(row.student_count || 0, 10);
          const staffCount = parseInt(row.staff_count || 0, 10);
          const classCount = parseInt(row.class_count || 0, 10);
          return {
            organizationId: row.organization_id,
            organizationName: row.organization_name,
            onHold: row.on_hold,
            studentCount,
            staffCount,
            classCount,
            subjectCount: parseInt(row.subject_count || 0, 10),
            studentsPerClass: classCount > 0 ? Math.round((studentCount / classCount) * 10) / 10 : 0,
            studentsPerStaff: staffCount > 0 ? Math.round((studentCount / staffCount) * 10) / 10 : 0
          };
        }),
        enrollmentOverTerms: [],
        genderDistribution: [],
        employeeRoles: [],
        subjectPerformance: [],
        studentsPerClassByClass: [],
        organizationLegend: organizationLoadComparisonResult.rows.map((row) => ({
          organizationId: row.organization_id,
          organizationName: row.organization_name,
          studentCount: parseInt(row.student_count || 0, 10),
          staffCount: parseInt(row.staff_count || 0, 10),
          classCount: parseInt(row.class_count || 0, 10)
        })),
        totals: {
          totalAttendanceRecords,
          presentDays,
          absentDays,
          totalAssessmentResults,
          passCount,
          failCount
        },
        generatedAt: new Date().toISOString()
      });
    } catch (error) {
      console.error('[HubOverview] Request failed', {
        hubId,
        currentStep,
        message: error.message,
        code: error.code,
        detail: error.detail,
        hint: error.hint,
        where: error.where,
        stack: error.stack
      });
      return res.status(500).json({
        success: false,
        message: 'Failed to load hub overview statistics.'
      });
    }
  },

  organizationDetailsGet: async (req, res) => {
    try {
      const hub = req.hubInfo;
      const { organizationId } = req.params;
      const allowedTabs = ['students', 'staff', 'classes'];
      const activeTab = allowedTabs.includes(req.query.tab) ? req.query.tab : 'students';

      const organization = await hubController.getHubOrganization(hub.hub_id, organizationId);

      if (!organization) {
        req.flash('error', 'Organization not found or not part of your hub.');
        return res.redirect('/hub/dashboard');
      }

      const schoolYearsResult = await db.query(
        `SELECT sy.id AS school_year_id, sy.year_label, t.term_id, t.term_name, t.start_date, t.end_date, t.current
         FROM school_years sy
         LEFT JOIN terms t ON sy.id = t.school_year_id
         WHERE sy.organization_id = $1
         ORDER BY sy.created_at DESC, t.start_date`,
        [organizationId]
      );

      const schoolYears = [];
      schoolYearsResult.rows.forEach((row) => {
        let year = schoolYears.find((entry) => entry.school_year_id === row.school_year_id);
        if (!year) {
          year = { school_year_id: row.school_year_id, year_label: row.year_label, terms: [] };
          schoolYears.push(year);
        }
        if (row.term_id) {
          year.terms.push({ ...row });
        }
      });

      const selectedSchoolYearId = req.query.selectedSchoolYearId;
      const selectedTermId = req.query.selectedTermId;
      const selectedSchoolYear = schoolYears.find((year) => String(year.school_year_id) === String(selectedSchoolYearId)) || schoolYears[0] || null;

      let currentTerm = null;
      if (selectedSchoolYear && selectedSchoolYear.terms.length > 0) {
        currentTerm = selectedSchoolYear.terms.find((term) => String(term.term_id) === String(selectedTermId))
          || selectedSchoolYear.terms.find((term) => term.current)
          || selectedSchoolYear.terms[0];
      }

      const organizationDataResult = await db.query(
        `SELECT
          (SELECT COUNT(*) FROM students WHERE organization_id = $1) AS total_students,
          (SELECT COUNT(*) FROM users WHERE organization_id = $1) AS total_employees,
          (SELECT COUNT(*) FROM classes WHERE organization_id = $1) AS total_classes,
          (SELECT COUNT(*) FROM subjects WHERE organization_id = $1) AS total_subjects`,
        [organizationId]
      );
      const organizationData = organizationDataResult.rows[0] || {
        total_students: 0,
        total_employees: 0,
        total_classes: 0,
        total_subjects: 0,
      };

      let attendanceByClass = [];
      let assessmentByClass = [];
      let classStrengthProfile = [];

      if (currentTerm) {
        attendanceByClass = (await db.query(
          `SELECT c.class_name,
                  COUNT(a.student_id) AS total_attendance,
                  COUNT(CASE WHEN a.status = 'Present' THEN 1 END) AS present_days,
                  COUNT(CASE WHEN a.status = 'Absent' THEN 1 END) AS absent_days
           FROM classes c
           LEFT JOIN students s ON c.class_id = s.class_id
           LEFT JOIN attendance_records a ON s.student_id = a.student_id AND a.term_id = $2
           WHERE c.organization_id = $1
           GROUP BY c.class_name
           ORDER BY c.class_name`,
          [organizationId, currentTerm.term_id]
        )).rows;

        assessmentByClass = (await db.query(
          `SELECT c.class_name,
                  COUNT(DISTINCT a.assessment_id) AS total_assessments,
                  AVG(ar.total_percentage) AS average_score,
                  COUNT(CASE WHEN ar.total_percentage >= 50 THEN 1 END) AS pass_count,
                  COUNT(CASE WHEN ar.total_percentage < 50 THEN 1 END) AS fail_count
           FROM classes c
           LEFT JOIN students s ON c.class_id = s.class_id
           LEFT JOIN assessment_results ar ON s.student_id = ar.student_id AND ar.term_id = $2
           LEFT JOIN assessments a ON ar.assessment_id = a.assessment_id
           WHERE c.organization_id = $1
           GROUP BY c.class_name
           ORDER BY average_score DESC
           LIMIT 5`,
          [organizationId, currentTerm.term_id]
        )).rows;

        classStrengthProfile = (await db.query(
          `SELECT sub.subject_name,
                  ROUND(AVG(ar.total_percentage), 2) AS avg_score
           FROM assessment_results ar
           JOIN students s ON ar.student_id = s.student_id
           JOIN subjects sub ON ar.subject_id = sub.subject_id
           WHERE s.organization_id = $1 AND ar.term_id = $2
           GROUP BY sub.subject_name
           ORDER BY sub.subject_name`,
          [organizationId, currentTerm.term_id]
        )).rows;
      }

      const organizationGrowth = (await db.query(
        `SELECT sy.year_label,
                COUNT(DISTINCT s.student_id) AS total_students,
                COUNT(DISTINCT u.user_id) AS total_employees,
                COUNT(DISTINCT c.class_id) AS total_classes
         FROM school_years sy
         LEFT JOIN enrollments e ON e.school_year_id = sy.id
         LEFT JOIN enrolled_students es ON es.enrollment_id = e.enrollment_id
         LEFT JOIN students s ON s.student_id = es.student_id AND s.organization_id = $1
         LEFT JOIN classes c ON c.organization_id = $1
         LEFT JOIN users u ON u.organization_id = $1
         WHERE sy.organization_id = $1
         GROUP BY sy.year_label
         ORDER BY sy.year_label`,
        [organizationId]
      )).rows;

      const enrollmentOverTerms = (await db.query(
        `SELECT t.term_name,
                COUNT(DISTINCT es.student_id) AS enrolled_students
         FROM terms t
         LEFT JOIN enrollments e ON t.term_id = e.term_id
         LEFT JOIN enrolled_students es ON e.enrollment_id = es.enrollment_id
         WHERE t.organization_id = $1
         GROUP BY t.term_name, t.start_date
         ORDER BY t.start_date`,
        [organizationId]
      )).rows;

      const genderDistribution = (await db.query(
        `SELECT gender, COUNT(*) AS count
         FROM students
         WHERE organization_id = $1
         GROUP BY gender`,
        [organizationId]
      )).rows;

      const employeeRoles = (await db.query(
        `SELECT account_type, COUNT(*) AS count
         FROM users
         WHERE organization_id = $1
         GROUP BY account_type`,
        [organizationId]
      )).rows;

      const studentCountPerClass = (await db.query(
        `SELECT c.class_name, COUNT(s.student_id) AS student_count
         FROM classes c
         LEFT JOIN students s ON c.class_id = s.class_id
         WHERE c.organization_id = $1
         GROUP BY c.class_name
         ORDER BY student_count DESC`,
        [organizationId]
      )).rows;

      const topPerformingClasses = assessmentByClass;

      res.render('hub/organizationDetails', {
        title: `${organization.organization_name} - Hub Organization Details`,
        hub,
        organization,
        activeTab,
        schoolYears,
        selectedSchoolYear,
        currentTerm,
        organizationData,
        attendanceByClass,
        assessmentByClass,
        topPerformingClasses,
        classStrengthProfile,
        studentCountPerClass,
        organizationGrowth,
        enrollmentOverTerms,
        genderDistribution,
        employeeRoles,
        messages: req.flash(),
        showFooterTopSection: true,
      });
    } catch (error) {
      req.flash('error', 'Unable to load organization details.');
      res.redirect('/hub/dashboard');
    }
  },

  organizationStudentsListGet: async (req, res) => {
    try {
      const hub = req.hubInfo;
      const { organizationId } = req.params;

      const organization = await hubController.getHubOrganization(hub.hub_id, organizationId);
      if (!organization) {
        return res.status(404).json({ success: false, message: 'Organization not found.' });
      }

      const studentsResult = await db.query(
        `SELECT s.student_id, s.first_name, s.last_name, s.gender,
                c.class_name,
                COALESCE((
                  SELECT gp.email
                  FROM guardian_students gs
                  JOIN guardian_profiles gp ON gp.guardian_id = gs.guardian_id
                  WHERE gs.student_id = s.student_id AND gp.organization_id = s.organization_id
                  LIMIT 1
                ), 'N/A') AS guardian_email
         FROM students s
         LEFT JOIN classes c ON c.class_id = s.class_id
         WHERE s.organization_id = $1
         ORDER BY s.first_name ASC, s.last_name ASC`,
        [organizationId]
      );

      res.json({ success: true, items: studentsResult.rows });
    } catch (error) {
      res.status(500).json({ success: false, message: 'Unable to load students.' });
    }
  },

  organizationStudentDetailsGet: async (req, res) => {
    try {
      const hub = req.hubInfo;
      const { organizationId, studentId } = req.params;

      const organization = await hubController.getHubOrganization(hub.hub_id, organizationId);
      if (!organization) {
        return res.status(404).json({ success: false, message: 'Organization not found.' });
      }

      const studentResult = await db.query(
        `SELECT s.student_id, s.first_name, s.last_name, s.gender, s.date_of_birth, s.hometown,
                c.class_name
         FROM students s
         LEFT JOIN classes c ON c.class_id = s.class_id
         WHERE s.student_id = $1 AND s.organization_id = $2`,
        [studentId, organizationId]
      );

      if (studentResult.rows.length === 0) {
        return res.status(404).json({ success: false, message: 'Student not found.' });
      }

      const guardiansResult = await db.query(
        `SELECT gp.first_name, gp.last_name, gp.email, gp.phone, gs.relationship
         FROM guardian_students gs
         JOIN guardian_profiles gp ON gp.guardian_id = gs.guardian_id
         WHERE gs.student_id = $1 AND gp.organization_id = $2
         ORDER BY gp.first_name, gp.last_name`,
        [studentId, organizationId]
      );

      res.json({
        success: true,
        item: {
          ...studentResult.rows[0],
          guardians: guardiansResult.rows,
        },
      });
    } catch (error) {
      res.status(500).json({ success: false, message: 'Unable to load student details.' });
    }
  },

  organizationStaffListGet: async (req, res) => {
    try {
      const hub = req.hubInfo;
      const { organizationId } = req.params;

      const organization = await hubController.getHubOrganization(hub.hub_id, organizationId);
      if (!organization) {
        return res.status(404).json({ success: false, message: 'Organization not found.' });
      }

      const staffResult = await db.query(
        `SELECT user_id, first_name, last_name, email, account_type, on_hold, created_at
         FROM users
         WHERE organization_id = $1
         ORDER BY first_name ASC, last_name ASC`,
        [organizationId]
      );

      res.json({ success: true, items: staffResult.rows });
    } catch (error) {
      res.status(500).json({ success: false, message: 'Unable to load staff.' });
    }
  },

  organizationStaffDetailsGet: async (req, res) => {
    try {
      const hub = req.hubInfo;
      const { organizationId, staffId } = req.params;

      const organization = await hubController.getHubOrganization(hub.hub_id, organizationId);
      if (!organization) {
        return res.status(404).json({ success: false, message: 'Organization not found.' });
      }

      const staffResult = await db.query(
        `SELECT user_id, first_name, last_name, email, account_type, on_hold, created_at, updated_at
         FROM users
         WHERE user_id = $1 AND organization_id = $2`,
        [staffId, organizationId]
      );

      if (staffResult.rows.length === 0) {
        return res.status(404).json({ success: false, message: 'Staff member not found.' });
      }

      res.json({ success: true, item: staffResult.rows[0] });
    } catch (error) {
      res.status(500).json({ success: false, message: 'Unable to load staff details.' });
    }
  },

  organizationClassesListGet: async (req, res) => {
    try {
      const hub = req.hubInfo;
      const { organizationId } = req.params;

      const organization = await hubController.getHubOrganization(hub.hub_id, organizationId);
      if (!organization) {
        return res.status(404).json({ success: false, message: 'Organization not found.' });
      }

      const classesResult = await db.query(
        `SELECT c.class_id, c.class_name,
                COUNT(DISTINCT s.student_id) AS student_count,
                COUNT(DISTINCT sub.subject_id) AS subject_count
         FROM classes c
         LEFT JOIN students s ON s.class_id = c.class_id
         LEFT JOIN subjects sub ON sub.class_id = c.class_id
         WHERE c.organization_id = $1
         GROUP BY c.class_id, c.class_name
         ORDER BY c.class_name ASC`,
        [organizationId]
      );

      res.json({ success: true, items: classesResult.rows });
    } catch (error) {
      res.status(500).json({ success: false, message: 'Unable to load classes.' });
    }
  },

  organizationClassDetailsGet: async (req, res) => {
    try {
      const hub = req.hubInfo;
      const { organizationId, classId } = req.params;

      const organization = await hubController.getHubOrganization(hub.hub_id, organizationId);
      if (!organization) {
        return res.status(404).json({ success: false, message: 'Organization not found.' });
      }

      const classResult = await db.query(
        `SELECT c.class_id, c.class_name
         FROM classes c
         WHERE c.class_id = $1 AND c.organization_id = $2`,
        [classId, organizationId]
      );

      if (classResult.rows.length === 0) {
        return res.status(404).json({ success: false, message: 'Class not found.' });
      }

      const subjectsResult = await db.query(
        `SELECT subject_id, subject_name
         FROM subjects
         WHERE class_id = $1 AND organization_id = $2
         ORDER BY subject_name ASC`,
        [classId, organizationId]
      );

      const studentsResult = await db.query(
        `SELECT student_id, first_name, last_name
         FROM students
         WHERE class_id = $1 AND organization_id = $2
         ORDER BY first_name ASC, last_name ASC`,
        [classId, organizationId]
      );

      res.json({
        success: true,
        item: {
          ...classResult.rows[0],
          subjects: subjectsResult.rows,
          students: studentsResult.rows,
        },
      });
    } catch (error) {
      res.status(500).json({ success: false, message: 'Unable to load class details.' });
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
      
      const emailHtml = renderCleanEmail({
        title: `Hub Invitation from ${hub.hub_name}`,
        greeting: `Dear ${contact_person_name},`,
        paragraphs: [
          `${hub.hub_name} has invited ${organization_name} to join their hub on Managira SMS.`,
          'A hub is a parent organization that manages multiple schools or educational institutions.',
          message ? `Message from ${hub.hub_name}: ${message}` : '',
        ].filter(Boolean),
        details: [
          { label: 'Hub', value: hub.hub_name },
          { label: 'Organization', value: organization_name },
          { label: 'Plan', value: hub.plan_name || 'Professional' },
          { label: 'Access URL', value: `${organization_name.toLowerCase().replace(/\s+/g, '')}.${hub.hub_nickname}.managira.com` },
        ],
        cta: { url: invitationUrl, text: 'Accept Invitation' },
        note: `This invitation expires on ${expiresAt.toLocaleDateString()}. If you have questions, contact ${hub.hub_name} at ${hub.hub_email}.`,
      });

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
      
      const emailHtml = renderCleanEmail({
        title: `Reminder: Hub Invitation from ${hub.hub_name}`,
        greeting: `Dear ${invitation.contact_person_name},`,
        paragraphs: [
          `This is a reminder that ${hub.hub_name} invited ${invitation.organization_name} to join their hub on Managira SMS.`,
          invitation.message ? `Message from ${hub.hub_name}: ${invitation.message}` : '',
        ].filter(Boolean),
        cta: { url: invitationUrl, text: 'Accept Invitation' },
        note: `This invitation expires on ${newExpiresAt.toLocaleDateString()}.`,
      });

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
        const emailHtml = renderCleanEmail({
          title: 'Hub Membership Update',
          greeting: `Dear ${organization.organization_name} Administrator,`,
          paragraphs: [
            `Your organization has been removed from the ${hub.hub_name} hub.`,
            `If you believe this is an error, contact ${hub.hub_name} at ${hub.hub_email}.`,
            'Log in to your dashboard to set up your organization subscription.',
          ],
          details: [
            { label: 'Status', value: 'Organization is now independent' },
            { label: 'New Subdomain', value: `${organization.organization_nickname}.managira.com` },
            { label: 'Data', value: 'All existing data remains intact' },
          ],
        });

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
      const emailHtml = renderCleanEmail({
        title: 'Detachment Request Approved',
        greeting: `Dear ${request.organization_name} Administrator,`,
        paragraphs: [
          `Your request to detach from ${hub.hub_name} has been approved.`,
          'Log in to your dashboard and set up your own subscription plan to continue service.',
          'If you need help, contact support@managira.com.',
        ],
        details: [
          { label: 'Status', value: 'Approved' },
          { label: 'New Subdomain', value: `${request.nickname}.managira.com` },
          { label: 'Data', value: 'All your organization data remains intact' },
        ],
      });

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
      const emailHtml = renderCleanEmail({
        title: 'Detachment Request Update',
        greeting: `Dear ${request.organization_name} Administrator,`,
        paragraphs: [
          `Your request to detach from ${hub.hub_name} has been reviewed.`,
          notes ? `Response from ${hub.hub_name}: ${notes}` : '',
          `If you wish to discuss this decision, contact ${hub.hub_name} at ${hub.hub_email}.`,
          'You can submit a new request in the future if needed.',
        ].filter(Boolean),
        details: [{ label: 'Status', value: 'Reviewed' }],
      });

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
      const emailHtml = renderCleanEmail({
        title: 'Hub Invitation',
        greeting: `Dear ${org.organization_name} Team,`,
        paragraphs: [
          `${hub.hub_name} has invited your organization to join their hub on Managira SMS.`,
          'A hub allows multiple organizations to be managed under one parent organization while keeping each organization operationally independent.',
          `If you have questions, contact ${hub.hub_name} at ${hub.hub_email}.`,
        ],
        details: [
          { label: 'New Subdomain', value: `${org.nickname}.${hub.hub_nickname}.managira.com` },
          { label: 'Subscription', value: `Managed by ${hub.hub_name}` },
          { label: 'Data', value: 'All your data remains with your organization' },
          { label: 'Control', value: 'You keep full control of operations' },
        ],
        cta: {
          url: `${process.env.BASE_URL || 'https://managira.com'}/account/accept-hub-invitation-existing/${token}`,
          text: 'Accept Invitation',
        },
        note: `This invitation expires on ${expiresAt.toLocaleDateString()}.`,
      });

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
