const db = require("../config/db");
const { isEmbeddedRequest } = require("../utils/embeddedMode");

const statsController = {
  //  Get Classes By Term
  getClassesByTerm: async (req, res) => {
    const { termId } = req.params;
    const organizationId = req.session.organizationId;

    try {
      const classes = (await db.query(`
        SELECT c.class_id, c.class_name
        FROM enrolled_classes ec
        INNER JOIN classes c ON ec.class_id = c.class_id
        INNER JOIN enrollments e ON ec.enrollment_id = e.enrollment_id
        WHERE e.term_id = $1 AND e.organization_id = $2
        ORDER BY COALESCE(c.dashboard_sort_order, 2147483647), c.class_name ASC, c.class_id ASC
      `, [termId, organizationId])).rows;

      res.json(classes);
    } catch (err) {
            res.status(500).json({ error: "Failed to fetch classes." });
    }
  },

  // 🆚 Compare Classes Statistics
  compareClassesStats: async (req, res) => {
    const { selectedClasses } = req.body;
    const organizationId = req.session.organizationId;
    if (!organizationId) return res.status(401).json({ error: "Unauthorized" });
    if (!selectedClasses?.length) return res.status(400).json({ error: "No classes selected." });

    try {
      const classStats = (await db.query(`
        SELECT 
          c.class_name,
          COUNT(DISTINCT s.student_id) AS enrolled_students,
          AVG(ar.total_percentage) AS average_score,
          COUNT(CASE WHEN ar.total_percentage >= 50 THEN 1 END) AS pass_count,
          COUNT(CASE WHEN ar.total_percentage < 50 THEN 1 END) AS fail_count
        FROM classes c
        LEFT JOIN students s
          ON c.class_id = s.class_id AND s.organization_id = $2
        LEFT JOIN assessment_results ar
          ON s.student_id = ar.student_id AND ar.organization_id = $2
        WHERE c.class_id = ANY($1::int[])
          AND c.organization_id = $2
        GROUP BY c.class_name
        ORDER BY MIN(COALESCE(c.dashboard_sort_order, 2147483647)), c.class_name
      `, [selectedClasses, organizationId])).rows;

      res.json(classStats);
    } catch (err) {
            res.status(500).json({ error: "Failed to compare classes." });
    }
  },

  getOrganizationStats: async (req, res) => {
    const organizationId = req.session.organizationId;
    if (!organizationId) return res.status(403).send("Unauthorized access.");

    const { selectedSchoolYearId, selectedTermId } = req.query;
    const isEmbedded = isEmbeddedRequest(req, "organizationStats");

    try {
      const schoolYearsResult = await db.query(
        `SELECT sy.id AS school_year_id, sy.year_label, t.term_id, t.term_name, t.start_date, t.end_date, t.current
         FROM school_years sy
         LEFT JOIN terms t ON sy.id = t.school_year_id
         WHERE sy.organization_id = $1
         ORDER BY sy.created_at DESC, t.start_date`,
        [organizationId]
      );

      if (!schoolYearsResult.rows.length) {
        req.flash("error", "No school years found.");
        return res.redirect("/common/manageRecords");
      }

      const schoolYears = [];
      schoolYearsResult.rows.forEach(row => {
        let year = schoolYears.find(y => y.school_year_id === row.school_year_id);
        if (!year) {
          year = { school_year_id: row.school_year_id, year_label: row.year_label, terms: [] };
          schoolYears.push(year);
        }
        if (row.term_id) {
          year.terms.push({ ...row });
        }
      });

      const selectedSchoolYear = schoolYears.find(y => y.school_year_id == selectedSchoolYearId)
        || schoolYears.find(y => Array.isArray(y.terms) && y.terms.length > 0)
        || schoolYears[0];
      const selectedSchoolYearTerms = Array.isArray(selectedSchoolYear?.terms) ? selectedSchoolYear.terms : [];

      let currentTerm = null;
      if (selectedTermId) {
        currentTerm = selectedSchoolYearTerms.find(t => t.term_id == selectedTermId) || null;
        if (!currentTerm) {
          req.flash("error", "Selected term not found for this school year. Showing the first available term instead.");
        }
      }

      if (!currentTerm) {
        currentTerm = selectedSchoolYearTerms.find(t => t.current) || selectedSchoolYearTerms[0] || null;
      }

      if (!currentTerm) {
        req.flash("error", "No term is available for the selected school year yet.");
        return res.render("stats/organizationStats", {
          title: "Organization Stats",
          isEmbedded,
          hideGlobalHeader: isEmbedded,
          hideGlobalFooter: isEmbedded,
          hideGlobalChatbot: isEmbedded,
          schoolYears,
          selectedSchoolYear,
          currentTerm: null,
          organizationData: {
            total_students: 0,
            total_employees: 0,
            total_classes: 0,
            total_subjects: 0,
          },
          attendanceByClass: [],
          assessmentByClass: [],
          topPerformingClasses: [],
          classStrengthProfile: [],
          studentCountPerClass: [],
          organizationGrowth: [],
          enrollmentOverTerms: [],
          genderDistribution: [],
          employeeRoles: [],
        });
      }

      const organizationData = (await db.query(`
        SELECT 
          (SELECT COUNT(*) FROM students WHERE organization_id = $1) AS total_students,
          (SELECT COUNT(*) FROM users WHERE organization_id = $1) AS total_employees,
          (SELECT COUNT(*) FROM classes WHERE organization_id = $1) AS total_classes,
          (
            SELECT COUNT(DISTINCT LOWER(TRIM(subject_name)))
            FROM subjects
            WHERE organization_id = $1
              AND subject_name IS NOT NULL
              AND TRIM(subject_name) <> ''
          ) AS total_subjects
      `, [organizationId])).rows[0];

      const attendanceByClass = (await db.query(`
        SELECT c.class_name,
               COUNT(a.student_id) AS total_attendance,
               COUNT(CASE WHEN a.status = 'Present' THEN 1 END) AS present_days,
               COUNT(CASE WHEN a.status = 'Absent' THEN 1 END) AS absent_days
        FROM classes c
        LEFT JOIN students s ON c.class_id = s.class_id
        LEFT JOIN attendance_records a ON s.student_id = a.student_id AND a.term_id = $2
        WHERE c.organization_id = $1
        GROUP BY c.class_name
        ORDER BY MIN(COALESCE(c.dashboard_sort_order, 2147483647)), c.class_name
      `, [organizationId, currentTerm.term_id])).rows;

      const assessmentByClass = (await db.query(`
        SELECT c.class_name,
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
        LIMIT 5
      `, [organizationId, currentTerm.term_id])).rows;

      const organizationGrowth = (await db.query(`
        SELECT sy.year_label,
               COUNT(DISTINCT s.student_id) AS total_students,
               COUNT(DISTINCT u.user_id) AS total_users,
               COUNT(DISTINCT c.class_id) AS total_classes
        FROM school_years sy
        LEFT JOIN enrollments e ON e.school_year_id = sy.id
        LEFT JOIN enrolled_students es ON es.enrollment_id = e.enrollment_id
        LEFT JOIN students s ON s.student_id = es.student_id AND s.organization_id = $1
        LEFT JOIN classes c ON c.organization_id = $1
        LEFT JOIN users u ON u.organization_id = $1
        WHERE sy.organization_id = $1
        GROUP BY sy.year_label
        ORDER BY sy.year_label
      `, [organizationId])).rows;

      const enrollmentOverTerms = (await db.query(`
        SELECT t.term_name,
               COUNT(DISTINCT es.student_id) AS enrolled_students
        FROM terms t
        LEFT JOIN enrollments e ON t.term_id = e.term_id
        LEFT JOIN enrolled_students es ON e.enrollment_id = es.enrollment_id
        WHERE t.organization_id = $1
        GROUP BY t.term_name, t.start_date
        ORDER BY t.start_date
      `, [organizationId])).rows;

      const genderDistribution = (await db.query(`
        SELECT gender, COUNT(*) AS count
        FROM students
        WHERE organization_id = $1
        GROUP BY gender
      `, [organizationId])).rows;

      const employeeRoles = (await db.query(`
        SELECT account_type, COUNT(*) AS count
        FROM users
        WHERE organization_id = $1
        GROUP BY account_type
      `, [organizationId])).rows;

      // ✅ Radar Chart for Class Strength Profile
const classStrengthProfile = await db.query(`
  SELECT
    sub.subject_name,
    ROUND(AVG(ar.total_percentage), 2) AS avg_score
  FROM assessment_results ar
  JOIN students s ON ar.student_id = s.student_id
  JOIN subjects sub ON ar.subject_id = sub.subject_id
  WHERE s.organization_id = $1 AND ar.term_id = $2
  GROUP BY sub.subject_name
  ORDER BY sub.subject_name
`, [organizationId, currentTerm.term_id]);

// ✅ Bar Chart – Student Count per Class
const studentCountPerClass = await db.query(`
  SELECT c.class_name, COUNT(s.student_id) AS student_count
  FROM classes c
  LEFT JOIN students s ON c.class_id = s.class_id
  WHERE c.organization_id = $1
  GROUP BY c.class_name
  ORDER BY student_count DESC
`, [organizationId]);


      res.render("stats/organizationStats", {
        title: "Organization Stats",
        isEmbedded,
        hideGlobalHeader: isEmbedded,
        hideGlobalFooter: isEmbedded,
        hideGlobalChatbot: isEmbedded,
        schoolYears,
        selectedSchoolYear,
        currentTerm,
        organizationData,
        attendanceByClass,
        assessmentByClass,
        topPerformingClasses: assessmentByClass,
        classStrengthProfile: classStrengthProfile.rows,
        studentCountPerClass: studentCountPerClass.rows,
        organizationGrowth,
        enrollmentOverTerms,
        genderDistribution,
        employeeRoles,
      });
    } catch (error) {
            req.flash("error", "Failed to load organization stats.");
      res.redirect("/");
    }
  },

};

module.exports = statsController;
