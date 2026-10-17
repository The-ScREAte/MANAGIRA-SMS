const notifSvc = require("../utils/notificationService");
const { isEmbeddedRequest } = require("../utils/embeddedMode");
const { userHasPermission, PERMISSIONS } = require('../middleware/permissionMiddleware');
const { formatDisplayName } = require("../utils/organizationDisplayPreferences");

let classDashboardLayoutSchemaReady = false;
const CLASS_DASHBOARD_ORDER_SQL = `
  COALESCE(dashboard_sort_order, 2147483647),
  class_name ASC,
  class_id ASC
`;

async function ensureClassDashboardLayoutSchema(dbClient) {
  if (classDashboardLayoutSchemaReady) return;

  await dbClient.query(`
    ALTER TABLE classes
      ADD COLUMN IF NOT EXISTS dashboard_sort_order INTEGER,
      ADD COLUMN IF NOT EXISTS dashboard_break_after BOOLEAN NOT NULL DEFAULT FALSE
  `);

  await dbClient.query(`
    WITH ranked AS (
      SELECT
        class_id,
        ROW_NUMBER() OVER (
          PARTITION BY organization_id
          ORDER BY class_name ASC, class_id ASC
        ) AS sort_order
      FROM classes
    )
    UPDATE classes c
    SET dashboard_sort_order = ranked.sort_order
    FROM ranked
    WHERE c.class_id = ranked.class_id
      AND c.dashboard_sort_order IS NULL
  `);

  classDashboardLayoutSchemaReady = true;
}

// Terms grouped by school year (current first), each with the enrollment it
// already has, for the enrollment form's term picker.
async function loadTermChoices(db, organizationId) {
  const { rows } = await db.query(`
    SELECT sy.id AS school_year_id, sy.year_label, sy.current AS year_current,
           t.term_id, t.term_name, t.current AS term_current, e.enrollment_id
    FROM school_years sy
    JOIN terms t ON t.school_year_id = sy.id AND t.organization_id = sy.organization_id
    LEFT JOIN enrollments e ON e.term_id = t.term_id AND e.school_year_id = sy.id AND e.organization_id = sy.organization_id
    WHERE sy.organization_id = $1
    ORDER BY sy.current DESC, sy.year_label DESC, t.start_date NULLS LAST, t.term_id
  `, [organizationId]);
  const years = [];
  rows.forEach((r) => {
    let year = years.find((y) => y.school_year_id === r.school_year_id);
    if (!year) {
      year = { school_year_id: r.school_year_id, year_label: r.year_label, current: r.year_current, terms: [] };
      years.push(year);
    }
    year.terms.push({ term_id: r.term_id, term_name: r.term_name, current: r.term_current, enrollment_id: r.enrollment_id });
  });
  return years;
}

// Every class with its students, in one query. A student is listed under the
// class they're enrolled in for `rosterEnrollmentId` (else their class), and
// marked enrolled when they're in that class in `selectedEnrollmentId`.
async function loadEnrollmentClasses(db, organizationId, rosterEnrollmentId, selectedEnrollmentId) {
  const { rows } = await db.query(`
    WITH roster AS (
      SELECT s.student_id, COALESCE(es.class_id, s.class_id) AS class_id
      FROM students s
      LEFT JOIN enrolled_students es ON es.student_id = s.student_id AND es.enrollment_id = $2
      WHERE s.organization_id = $1 AND s.graduated = FALSE
        AND COALESCE(es.class_id, s.class_id) IS NOT NULL
    )
    SELECT c.class_id, c.class_name,
           EXISTS (SELECT 1 FROM enrolled_classes ec WHERE ec.enrollment_id = $3 AND ec.class_id = c.class_id) AS selected,
           COALESCE(
             JSON_AGG(JSON_BUILD_OBJECT(
               'student_id', s.student_id, 'first_name', s.first_name, 'last_name', s.last_name,
               'custom_id', s.custom_student_id, 'image_url', s.image_url,
               'enrolled', EXISTS (SELECT 1 FROM enrolled_students x WHERE x.enrollment_id = $3 AND x.student_id = s.student_id AND x.class_id = c.class_id)
             ) ORDER BY s.last_name, s.first_name) FILTER (WHERE s.student_id IS NOT NULL),
             '[]'::json
           ) AS students
    FROM classes c
    LEFT JOIN roster r ON r.class_id = c.class_id
    LEFT JOIN students s ON s.student_id = r.student_id
    WHERE c.organization_id = $1
      AND (c.obsolete_at IS NULL
           OR EXISTS (SELECT 1 FROM enrolled_classes ec WHERE ec.enrollment_id = $3 AND ec.class_id = c.class_id))
    GROUP BY c.class_id
    ORDER BY COALESCE(c.dashboard_sort_order, 2147483647), c.class_name, c.class_id
  `, [organizationId, rosterEnrollmentId || null, selectedEnrollmentId || null]);
  return rows;
}

const enrollmentController = {
    // Enrollment page
    enrollmentGet: async (req, res, db) => {
      const isEmbedded = isEmbeddedRequest(req, "enroll");
      try {
        const organizationId = req.session.organizationId;
        await ensureClassDashboardLayoutSchema(db);
        const termYears = await loadTermChoices(db, organizationId);
        const allTerms = termYears.flatMap((y) => y.terms.map((t) => ({ ...t, school_year_id: y.school_year_id })));
        const currentTerm = allTerms.find((t) => t.current) || allTerms[0] || null;
        if (!currentTerm) {
          req.flash('error', 'Add a school year and term first.');
          return res.redirect(isEmbedded ? '/enrollment/manageEnrollment?embed=workspace' : '/common/manageRecords');
        }
        // Class lists start from this term's enrollment (or each student's class).
        const classes = await loadEnrollmentClasses(db, organizationId, currentTerm.enrollment_id, null);

        res.render('enrollment/enrollment', {
          title: 'Enroll students',
          mode: 'add',
          termYears,
          selectedTermId: Number(req.query.termId) || currentTerm.term_id,
          classes,
          enrollmentId: null,
          messages: req.flash(),
          isEmbedded,
          hideGlobalHeader: isEmbedded,
          hideGlobalFooter: isEmbedded,
          hideGlobalChatbot: isEmbedded,
        });
      } catch (error) {
        req.flash('error', 'Failed to load enrollment data.');
        res.redirect(isEmbedded ? '/enrollment/manageEnrollment?embed=workspace' : '/');
      }
    },

    enrollmentPost: async (req, res, db) => {
      // Dedicated connection: BEGIN/COMMIT on the pool can run on different
      // connections and strand writes in an open transaction.
      let txClient = null;
      const { schoolYearId, termId, selectedClasses, selectedStudents } = req.body;
      const organizationId = req.session.organizationId;
    
      if (!organizationId) {
        return res.status(401).json({ success: false, message: 'Unauthorized.' });
      }
      if (!schoolYearId || !termId || !selectedClasses || selectedClasses.length === 0) {
        return res.status(400).json({ success: false, message: 'School year, term, and classes are required for enrollment.' });
      }
    
      try {
        // Tenant boundary: only accept class ids and student ids that
        // belong to the caller's organization. Foreign ids are dropped
        // silently so a hostile or buggy client cannot link a foreign
        // class or student into this org's enrollment.
        const normalizedClassIds = (Array.isArray(selectedClasses) ? selectedClasses : [selectedClasses])
          .map(v => Number(v))
          .filter(v => Number.isInteger(v) && v > 0);
        const ownedClassesRes = normalizedClassIds.length
          ? await db.query(
              `SELECT class_id FROM classes WHERE class_id = ANY($1::int[]) AND organization_id = $2`,
              [normalizedClassIds, organizationId]
            )
          : { rows: [] };
        const ownedClassIds = new Set(ownedClassesRes.rows.map(r => Number(r.class_id)));

        const requestedStudentIds = [];
        Object.values(selectedStudents || {}).forEach(arr => {
          (Array.isArray(arr) ? arr : []).forEach(v => {
            const n = Number(v);
            if (Number.isInteger(n) && n > 0) requestedStudentIds.push(n);
          });
        });
        const ownedStudentsRes = requestedStudentIds.length
          ? await db.query(
              `SELECT student_id FROM students WHERE student_id = ANY($1::int[]) AND organization_id = $2`,
              [requestedStudentIds, organizationId]
            )
          : { rows: [] };
        const ownedStudentIds = new Set(ownedStudentsRes.rows.map(r => Number(r.student_id)));

        // Verify school_year + term belong to this org
        const termCheck = await db.query(
          `SELECT 1 FROM terms WHERE term_id = $1 AND school_year_id = $2 AND organization_id = $3`,
          [termId, schoolYearId, organizationId]
        );
        if (!termCheck.rows.length) {
          return res.status(403).json({ success: false, message: 'Term or school year does not belong to your organization.' });
        }

        txClient = await db.connect();
        await txClient.query('BEGIN');
    
        // Check for existing enrollment
        const existingEnrollmentRes = await txClient.query(`
          SELECT enrollment_id FROM enrollments
          WHERE school_year_id = $1 AND term_id = $2 AND organization_id = $3
        `, [schoolYearId, termId, organizationId]);
    
        let enrollmentId;
        if (existingEnrollmentRes.rows.length > 0) {
          enrollmentId = existingEnrollmentRes.rows[0].enrollment_id;
        } else {
          const newEnrollmentRes = await txClient.query(`
            INSERT INTO enrollments (school_year_id, term_id, organization_id, created_at)
            VALUES ($1, $2, $3, NOW())
            RETURNING enrollment_id
          `, [schoolYearId, termId, organizationId]);
          enrollmentId = newEnrollmentRes.rows[0].enrollment_id;
        }
    
        // Insert any new classes (avoid duplicates) -- only org-owned
        for (const classId of normalizedClassIds) {
          if (!ownedClassIds.has(Number(classId))) continue;
          await txClient.query(`
            INSERT INTO enrolled_classes (enrollment_id, class_id)
            SELECT $1, $2
            WHERE NOT EXISTS (
              SELECT 1 FROM enrolled_classes WHERE enrollment_id = $1 AND class_id = $2
            )
          `, [enrollmentId, classId]);
        }
    
        // Insert students (ensure each student only exists once across all classes for that enrollment)
        for (const classId in selectedStudents) {
          const classIdNum = Number(classId);
          if (!ownedClassIds.has(classIdNum)) continue; // skip foreign classes
          const students = selectedStudents[classId];
          for (const studentId of students) {
            const studentIdNum = Number(studentId);
            if (!ownedStudentIds.has(studentIdNum)) continue; // skip foreign students
            const existingStudentCheck = await txClient.query(`
              SELECT 1 FROM enrolled_students
              WHERE enrollment_id = $1 AND student_id = $2
            `, [enrollmentId, studentIdNum]);
    
            if (existingStudentCheck.rows.length === 0) {
              await txClient.query(`
                INSERT INTO enrolled_students (enrollment_id, student_id, class_id)
                VALUES ($1, $2, $3)
              `, [enrollmentId, studentIdNum, classIdNum]);
            }
          }
        }
    
        await txClient.query('COMMIT');

        // I1 — notify class teachers of new enrollment(s)
        const enrolledClassIds = [...new Set(Object.keys(selectedStudents || {}).map(Number).filter(Boolean).filter(id => ownedClassIds.has(id)))];
        if (enrolledClassIds.length) {
          const orgId = req.session.organizationId;
          notifSvc.notifyPerClassTeachers(db, {
            orgId: Number(orgId),
            classIds: enrolledClassIds,
            type: 'enrollment_added',
            title: 'Students enrolled in your class',
            body: 'New students have been added.',
            linkTemplate: '/common/classDashboard?classId={classId}',
          }).catch(err => console.error('[Notif] enrollment_added failed:', err.message));
        }

        res.status(200).json({ success: true, message: 'Enrollment updated successfully.' });
      } catch (error) {
        if (txClient) await txClient.query('ROLLBACK').catch(() => {});
                res.status(500).json({ success: false, message: 'Failed to enroll students.' });
      } finally {
        if (txClient) txClient.release();
      }
    },
          
        

    getStudentsByClass: async (req, res, db) => {
        const { classId } = req.query;
        const organizationId = req.session.organizationId;

        if (!organizationId) {
            return res.status(401).json({ error: 'Unauthorized.' });
        }
    
        try {
            const studentsResult = await db.query(`
                SELECT student_id, first_name, last_name
                FROM students
                WHERE class_id = $1 AND organization_id = $2 AND graduated = FALSE
                ORDER BY last_name, first_name
            `, [Number.parseInt(classId, 10) || null, organizationId]);
    
            res.json({ students: studentsResult.rows });
        } catch (error) {
                        res.status(500).json({ error: 'Failed to fetch students.' });
        } 
    },
    

    manageEnrollmentGet: async (req, res, db) => {
        try {
          const organizationId = req.session.organizationId;
          const isEmbedded = isEmbeddedRequest(req, "manageEnrollment");
          await ensureClassDashboardLayoutSchema(db);
      
          // Fetch all enrollments (school year + term)
          const enrollmentsResult = await db.query(`
            SELECT e.enrollment_id, sy.year_label AS school_year, sy.current AS is_current_year,
                   t.term_name AS term, t.current AS is_current_term
            FROM enrollments e
            JOIN school_years sy ON e.school_year_id = sy.id
            JOIN terms t ON e.term_id = t.term_id
            WHERE e.organization_id = $1
            ORDER BY (sy.current AND t.current) DESC, t.start_date DESC NULLS LAST, t.term_id DESC
          `, [organizationId]);
      
          const enrollments = enrollmentsResult.rows;
      
          // The enrolled classes and their enrolled students for every enrollment,
          // in two queries (not one per class).
          const enrollmentIds = enrollments.map((e) => e.enrollment_id);
          const [classesResult, studentsResult] = enrollmentIds.length
            ? await Promise.all([
                db.query(`
                  SELECT ec.enrollment_id, c.class_id, c.class_name
                  FROM enrolled_classes ec
                  JOIN classes c ON ec.class_id = c.class_id
                  WHERE ec.enrollment_id = ANY($1::int[])
                  ORDER BY COALESCE(c.dashboard_sort_order, 2147483647), c.class_name ASC, c.class_id ASC
                `, [enrollmentIds]),
                db.query(`
                  SELECT es.enrollment_id, es.class_id, s.student_id, s.first_name, s.last_name
                  FROM enrolled_students es
                  JOIN students s ON es.student_id = s.student_id
                  WHERE es.enrollment_id = ANY($1::int[]) AND s.graduated = FALSE
                  ORDER BY s.last_name, s.first_name
                `, [enrollmentIds]),
              ])
            : [{ rows: [] }, { rows: [] }];
          const studentsByClass = new Map();
          studentsResult.rows.forEach((row) => {
            const key = `${row.enrollment_id}:${row.class_id}`;
            if (!studentsByClass.has(key)) studentsByClass.set(key, []);
            studentsByClass.get(key).push({ student_id: row.student_id, first_name: row.first_name, last_name: row.last_name });
          });
          enrollments.forEach((enrollment) => {
            enrollment.classes = classesResult.rows
              .filter((cls) => cls.enrollment_id === enrollment.enrollment_id)
              .map((cls) => ({
                class_id: cls.class_id,
                class_name: cls.class_name,
                enrolled_students: studentsByClass.get(`${enrollment.enrollment_id}:${cls.class_id}`) || [],
              }));
          });

          const currentSemester = enrollments.find(e => e.is_current_year && e.is_current_term);
          const noEnrollmentForCurrentSemester = !currentSemester;
      
          res.render('enrollment/manageEnrollment', {
            title: 'Manage Enrollments',
            isEmbedded,
            hideGlobalHeader: isEmbedded,
            hideGlobalFooter: isEmbedded,
            hideGlobalChatbot: isEmbedded,
            enrollments,
            noEnrollmentForCurrentSemester,
            currentSemesterName: currentSemester
              ? `${currentSemester.school_year} - ${currentSemester.term}`
              : 'the current school year and term',
            messages: req.flash()
          });
        } catch (error) {
                    req.flash('error', 'Failed to load enrollments.');
          res.redirect('/');
        }
      },
              
        
    modifyEnrollmentGet: async (req, res, db) => {
        const isEmbedded = isEmbeddedRequest(req, "modifyEnrollment");
        const back = isEmbedded ? '/enrollment/manageEnrollment?embed=workspace' : '/enrollment/manageEnrollment';
        try {
            const { enrollmentId } = req.params;
            const organizationId = req.session.organizationId;
            await ensureClassDashboardLayoutSchema(db);

            const enrollmentResult = await db.query(`
                SELECT enrollment_id, school_year_id, term_id
                FROM enrollments
                WHERE enrollment_id = $1 AND organization_id = $2
            `, [enrollmentId, organizationId]);
            if (!enrollmentResult.rows.length) {
                req.flash('error', 'Enrollment not found.');
                return res.redirect(back);
            }
            const enrollment = enrollmentResult.rows[0];
            const [termYears, classes] = await Promise.all([
                loadTermChoices(db, organizationId),
                loadEnrollmentClasses(db, organizationId, enrollment.enrollment_id, enrollment.enrollment_id),
            ]);

            res.render('enrollment/modifyEnrollment', {
                title: 'Edit enrollment',
                mode: 'edit',
                termYears,
                selectedTermId: enrollment.term_id,
                classes,
                enrollmentId: enrollment.enrollment_id,
                isEmbedded,
                hideGlobalHeader: isEmbedded,
                hideGlobalFooter: isEmbedded,
                hideGlobalChatbot: isEmbedded,
                messages: req.flash(),
            });
        } catch (error) {
            req.flash('error', 'Failed to load the enrollment.');
            res.redirect(back);
        }
    },
    
    modifyEnrollmentPost: async (req, res, db) => {
      // Dedicated connection: BEGIN/COMMIT on the pool can run on different
      // connections and strand writes in an open transaction.
      let txClient = null;
        const { schoolYearId, termId, selectedClasses, selectedStudents } = req.body;
        const { enrollmentId } = req.params;
        const organizationId = req.session.organizationId;

        if (!organizationId) {
          return res.status(401).json({ success: false, message: 'Unauthorized.' });
        }

        try {
          // Tenant boundary: the enrollment being modified must belong
          // to the caller's organization.
          const enrollmentOwn = await db.query(
            `SELECT 1 FROM enrollments WHERE enrollment_id = $1 AND organization_id = $2`,
            [enrollmentId, organizationId]
          );
          if (!enrollmentOwn.rows.length) {
            return res.status(403).json({ success: false, message: 'Enrollment does not belong to your organization.' });
          }

          // Tenant boundary: filter class ids and student ids to the caller's org.
          const requestedClassIds = (Array.isArray(selectedClasses) ? selectedClasses : (selectedClasses ? [selectedClasses] : []))
            .map(v => Number(v))
            .filter(v => Number.isInteger(v) && v > 0);
          const ownedClassesRes = requestedClassIds.length
            ? await db.query(
                `SELECT class_id FROM classes WHERE class_id = ANY($1::int[]) AND organization_id = $2`,
                [requestedClassIds, organizationId]
              )
            : { rows: [] };
          const ownedClassIds = new Set(ownedClassesRes.rows.map(r => Number(r.class_id)));

          const requestedStudentIds = [];
          Object.values(selectedStudents || {}).forEach(arr => {
            (Array.isArray(arr) ? arr : []).forEach(v => {
              const n = Number(v);
              if (Number.isInteger(n) && n > 0) requestedStudentIds.push(n);
            });
          });
          const ownedStudentsRes = requestedStudentIds.length
            ? await db.query(
                `SELECT student_id FROM students WHERE student_id = ANY($1::int[]) AND organization_id = $2`,
                [requestedStudentIds, organizationId]
              )
            : { rows: [] };
          const ownedStudentIds = new Set(ownedStudentsRes.rows.map(r => Number(r.student_id)));

          txClient = await db.connect();
          await txClient.query('BEGIN');
      
          const conflictingStudents = [];
      
          for (const [newClassId, studentIds] of Object.entries(selectedStudents || {})) {
            const newClassIdNum = Number(newClassId);
            if (!ownedClassIds.has(newClassIdNum)) continue;
            for (const studentId of (studentIds || [])) {
              const studentIdNum = Number(studentId);
              if (!ownedStudentIds.has(studentIdNum)) continue;
              const conflictRes = await txClient.query(`
                SELECT c.class_id, c.class_name, s.first_name, s.last_name
                FROM enrolled_students es
                JOIN enrolled_classes ec ON es.enrollment_id = ec.enrollment_id AND es.class_id = ec.class_id
                JOIN classes c ON ec.class_id = c.class_id
                JOIN students s ON es.student_id = s.student_id
                WHERE es.student_id = $1
                  AND es.enrollment_id = $2
                  AND es.class_id != $3
              `, [studentIdNum, enrollmentId, newClassIdNum]);
      
              if (conflictRes.rows.length > 0) {
                const currentClass = conflictRes.rows[0].class_name;
                const studentName = `${conflictRes.rows[0].first_name} ${conflictRes.rows[0].last_name}`;
                const newClass = await txClient.query('SELECT class_name FROM classes WHERE class_id = $1 AND organization_id = $2', [newClassIdNum, organizationId]).then(r => r.rows[0]?.class_name || '');
                conflictingStudents.push({
                  studentId: studentIdNum,
                  studentName,
                  currentClass,
                  newClass
                });
              }
            }
          }
      
          if (conflictingStudents.length > 0 && !req.query.confirmMove) {
            if (txClient) await txClient.query('ROLLBACK').catch(() => {});
            return res.status(200).json({
              conflicts: conflictingStudents,
              message: 'Some students are already in other classes. Confirm if you want to move them.'
            });
          }
      
          // No conflicts or confirmed to move. Clear existing data and re-insert.
          // Org-bound: the enrollment is already validated above, and the
          // class/student ids being reinserted have all been validated to
          // belong to this org.
          await txClient.query('DELETE FROM enrolled_classes WHERE enrollment_id = $1', [enrollmentId]);
          await txClient.query('DELETE FROM enrolled_students WHERE enrollment_id = $1', [enrollmentId]);
      
          const safeClassIds = requestedClassIds.filter(id => ownedClassIds.has(id));
          if (safeClassIds.length > 0) {
            await txClient.query(`
              INSERT INTO enrolled_classes (enrollment_id, class_id)
              SELECT $1, unnest($2::int[])
            `, [enrollmentId, safeClassIds]);
          }
      
          if (selectedStudents && Object.keys(selectedStudents).length > 0) {
            for (const classId in selectedStudents) {
              const classIdNum = Number(classId);
              if (!ownedClassIds.has(classIdNum)) continue;
              const students = selectedStudents[classId];
              for (const studentId of (students || [])) {
                const studentIdNum = Number(studentId);
                if (!ownedStudentIds.has(studentIdNum)) continue;
                await txClient.query(`
                  INSERT INTO enrolled_students (enrollment_id, student_id, class_id)
                  VALUES ($1, $2, $3)
                `, [enrollmentId, studentIdNum, classIdNum]);
              }
            }
          }
      
          await txClient.query('COMMIT');
          req.flash('success', 'Enrollment modified successfully.');
          res.status(200).json({ success: true, message: 'Enrollment modified successfully.' });
        } catch (error) {
          if (txClient) await txClient.query('ROLLBACK').catch(() => {});
                    res.status(500).json({ success: false, message: 'Failed to modify enrollment.' });
        } finally {
          if (txClient) txClient.release();
        }
      },
      
                      
    deleteEnrollment: async (req, res, db) => {
      // Dedicated connection: BEGIN/COMMIT on the pool can run on different
      // connections and strand writes in an open transaction.
      let txClient = null;
        const enrollmentId = req.params.enrollmentId;
        const organizationId = req.session.organizationId;

        if (!organizationId) {
            req.flash('error', 'Unauthorized.');
            return res.redirect('/account/login');
        }

        try {
            // Tenant boundary: the enrollment must belong to the caller's
            // organization before any cascade deletes touch related tables.
            const ownership = await db.query(
                `SELECT 1 FROM enrollments WHERE enrollment_id = $1 AND organization_id = $2`,
                [enrollmentId, organizationId]
            );
            if (!ownership.rows.length) {
                req.flash('error', 'Enrollment does not belong to your organization.');
                return res.redirect('/enrollment/manageEnrollment');
            }

            txClient = await db.connect();
            await txClient.query('BEGIN');

            // Delete enrolled students
            await txClient.query(`DELETE FROM enrolled_students WHERE enrollment_id = $1`, [enrollmentId]);

            // Delete enrolled classes
            await txClient.query(`DELETE FROM enrolled_classes WHERE enrollment_id = $1`, [enrollmentId]);

            // Delete the enrollment itself (org-scoped as a final guard)
            await txClient.query(
                `DELETE FROM enrollments WHERE enrollment_id = $1 AND organization_id = $2`,
                [enrollmentId, organizationId]
            );

            await txClient.query('COMMIT');
            req.flash('success', 'Enrollment deleted successfully.');
            res.redirect('/enrollment/manageEnrollment');
        } catch (error) {
            if (txClient) await txClient.query('ROLLBACK').catch(() => {});
                        req.flash('error', 'Failed to delete enrollment.');
            res.redirect('/enrollment/modifyEnrollment/' + enrollmentId);
        } finally {
          if (txClient) txClient.release();
        }
    },
        searchUsers: async (req, res, db) => {
          const orgId = req.session.organizationId;

          if (!orgId) {
            return res.status(401).json({ error: 'Unauthorized organization context.' });
          }

          const query = String(req.query.query || "").trim();

          // Enforce minimum length server-side (cannot be bypassed like the frontend check)
          if (query.length < 2) {
            return res.status(400).json({ error: 'Search query must be at least 2 characters.' });
          }

          // Escape LIKE special characters so user input cannot inject wildcards
          const escapedQuery = query.replace(/[\\%_]/g, '\\$&');
          const likeQuery = `%${escapedQuery}%`;

          const isStudent = String(req.session.userRole || req.session.accountType || '').trim().toLowerCase() === 'student';
          if (isStudent) {
            const studentId = Number(req.session.studentId || req.session.userId || 0);
            if (!studentId) {
              return res.status(401).json({ error: 'Unauthorized student context.' });
            }

            try {
              const currentTermResult = await db.query(
                `SELECT term_id
                 FROM terms
                 WHERE organization_id = $1 AND current = TRUE
                 ORDER BY start_date DESC, term_id DESC
                 LIMIT 1`,
                [orgId]
              );
              const currentTermId = currentTermResult.rows[0]?.term_id || null;

              const classResult = currentTermId
                ? await db.query(
                    `SELECT es.class_id
                     FROM enrollments e
                     JOIN enrolled_students es ON es.enrollment_id = e.enrollment_id
                     WHERE e.organization_id = $1
                       AND e.term_id = $2
                       AND es.student_id = $3
                     ORDER BY e.created_at DESC
                     LIMIT 1`,
                    [orgId, currentTermId, studentId]
                  )
                : { rows: [] };

              let classId = classResult.rows[0]?.class_id || null;
              if (!classId) {
                const studentClassResult = await db.query(
                  `SELECT class_id
                   FROM students
                   WHERE organization_id = $1 AND student_id = $2
                   LIMIT 1`,
                  [orgId, studentId]
                );
                classId = studentClassResult.rows[0]?.class_id || null;
              }

              if (!classId) {
                return res.status(200).json({ results: [] });
              }

              const [teacherResult, subjectResult] = await Promise.all([
                db.query(
                  `SELECT DISTINCT
                      'teacher' AS type,
                      u.user_id AS id,
                      u.first_name,
                      u.last_name,
                      COALESCE(NULLIF(u.image_url, ''), 'profilePlaceholder.png') AS image_url,
                      c.class_name,
                      c.class_id,
                      u.account_type,
                      subj.subject_name,
                      FALSE AS student_scope
                   FROM student_subjects ss
                   JOIN subjects subj
                     ON subj.subject_id = ss.subject_id
                    AND subj.organization_id = ss.organization_id
                    AND subj.class_id = $3
                   JOIN user_subjects us ON us.subject_id = subj.subject_id
                   JOIN users u
                     ON u.user_id = us.user_id
                    AND u.organization_id = ss.organization_id
                   LEFT JOIN classes c ON c.class_id = subj.class_id
                   WHERE ss.organization_id = $2
                     AND ss.student_id = $4
                     AND LOWER(COALESCE(u.account_type::text, '')) = 'teacher'
                     AND (
                       u.first_name ILIKE $1 ESCAPE '\\'
                       OR u.last_name ILIKE $1 ESCAPE '\\'
                       OR CONCAT(u.first_name, ' ', u.last_name) ILIKE $1 ESCAPE '\\'
                       OR CONCAT(u.last_name, ', ', u.first_name) ILIKE $1 ESCAPE '\\'
                     )
                   ORDER BY u.last_name, u.first_name
                   LIMIT 20`,
                  [likeQuery, orgId, classId, studentId]
                ),
                db.query(
                  `SELECT DISTINCT
                      'subject' AS type,
                      subj.subject_id AS id,
                      subj.subject_name AS first_name,
                      '' AS last_name,
                      NULL::text AS image_url,
                      c.class_name,
                      c.class_id,
                      NULL::text AS account_type,
                      subj.subject_name,
                      TRUE AS student_scope
                   FROM student_subjects ss
                   JOIN subjects subj
                     ON subj.subject_id = ss.subject_id
                    AND subj.organization_id = ss.organization_id
                    AND subj.class_id = $3
                   LEFT JOIN classes c ON c.class_id = subj.class_id
                   WHERE ss.organization_id = $2
                     AND ss.student_id = $4
                     AND subj.subject_name ILIKE $1 ESCAPE '\\'
                   ORDER BY subj.subject_name
                   LIMIT 20`,
                  [likeQuery, orgId, classId, studentId]
                )
              ]);

              const orgNameDisplayFormat = String(req.session?.nameDisplayFormat || 'first_last');
              const results = [...teacherResult.rows, ...subjectResult.rows].map((item) => ({
                ...item,
                display_name:
                  formatDisplayName(item, orgNameDisplayFormat) ||
                  item.subject_name ||
                  item.class_name ||
                  '',
              }));

              return res.status(200).json({ results });
            } catch (error) {
              return res.status(500).json({ error: 'Failed to fetch users.' });
            }
          }

          try {
            // Resolve which result types the requesting user is permitted to see.
            // We only run DB queries for types the user can actually navigate to,
            // so no result ever links to a page they'd be bounced off.
            const userId = req.session.user?.user_id || req.session.userId || null;
            const userRole = req.session.userRole || req.session.user?.account_type || null;
            const accountType = req.session.accountType || req.session.user?.account_type || null;
            const userEmail = req.session.user?.email || null;
            const userCtx = { userId, userRole, organizationId: orgId, accountType, userEmail };

            const [canSeeStudents, canSeeEmployees] = await Promise.all([
              userHasPermission(db, userCtx, PERMISSIONS.MANAGE_STUDENTS),
              userHasPermission(db, userCtx, PERMISSIONS.MANAGE_EMPLOYEES),
            ]);

            // Teachers and supervisors are class-scoped: they only see students,
            // guardians, and classes belonging to their assigned classes.
            // Managers/admins (isManagerLikeRole) see everything.
            const normalizedRole = String(userRole || accountType || '').trim().toLowerCase();
            const isClassScoped = userId && (
              normalizedRole === 'teacher' ||
              normalizedRole === 'supervisor' ||
              normalizedRole === 'superviser'
            );

            // assignedClassIds: null = no restriction; [] = teacher has no classes (return empty for class-gated types)
            let assignedClassIds = null;
            if (isClassScoped) {
              const classResult = await db.query(
                'SELECT class_id FROM user_classes WHERE user_id = $1',
                [userId]
              );
              assignedClassIds = classResult.rows.map(r => r.class_id);
            }

            // Runs fn(classIds) when there's a restriction with classes assigned,
            // returns empty immediately if teacher has no classes at all.
            const withClassScope = (fn) => {
              if (assignedClassIds === null) return fn(null);      // no restriction
              if (assignedClassIds.length === 0) return Promise.resolve({ rows: [] }); // no assigned classes
              return fn(assignedClassIds);
            };

            const empty = Promise.resolve({ rows: [] });

            const [studentsRes, employeesRes, guardiansRes, classesRes, subjectsRes, orgProfileRes] = await Promise.all([
              canSeeStudents
                ? withClassScope((classIds) =>
                    classIds
                      ? db.query(
                          `
                            SELECT 'student' AS type, s.student_id AS id, s.first_name, s.last_name, s.image_url,
                               c.class_name, c.class_id, NULL::text AS account_type, NULL::text AS subject_name, s.graduated
                            FROM students s
                            LEFT JOIN classes c ON s.class_id = c.class_id AND c.organization_id = $2
                            WHERE s.organization_id = $2
                              AND s.class_id = ANY($3::int[])
                              AND (
                                s.first_name ILIKE $1 ESCAPE '\\' OR s.last_name ILIKE $1 ESCAPE '\\'
                                OR CONCAT(s.first_name, ' ', s.last_name) ILIKE $1 ESCAPE '\\'
                                OR CONCAT(s.last_name, ', ', s.first_name) ILIKE $1 ESCAPE '\\'
                                OR s.student_id::text ILIKE $1 ESCAPE '\\'
                                OR COALESCE(s.custom_student_id, '') ILIKE $1 ESCAPE '\\'
                              )
                            LIMIT 20
                          `,
                          [likeQuery, orgId, classIds]
                        )
                      : db.query(
                          `
                            SELECT 'student' AS type, s.student_id AS id, s.first_name, s.last_name, s.image_url,
                               c.class_name, c.class_id, NULL::text AS account_type, NULL::text AS subject_name, s.graduated
                            FROM students s
                            LEFT JOIN classes c ON s.class_id = c.class_id AND c.organization_id = $2
                            WHERE s.organization_id = $2
                              AND (
                                s.first_name ILIKE $1 ESCAPE '\\' OR s.last_name ILIKE $1 ESCAPE '\\'
                                OR CONCAT(s.first_name, ' ', s.last_name) ILIKE $1 ESCAPE '\\'
                                OR CONCAT(s.last_name, ', ', s.first_name) ILIKE $1 ESCAPE '\\'
                                OR s.student_id::text ILIKE $1 ESCAPE '\\'
                                OR COALESCE(s.custom_student_id, '') ILIKE $1 ESCAPE '\\'
                              )
                            LIMIT 20
                          `,
                          [likeQuery, orgId]
                        )
                  )
                : empty,

              // Employees are not class-scoped — a teacher assigned to a class still
              // shouldn't see other employees they have no business managing.
              canSeeEmployees
                ? db.query(
                    `
                      SELECT 'employee' AS type, u.user_id AS id, u.first_name, u.last_name,
                         COALESCE(NULLIF(u.image_url, ''), 'profilePlaceholder.png') AS image_url,
                         NULL::text AS class_name, NULL::int AS class_id, u.account_type, NULL::text AS subject_name
                      FROM users u
                      WHERE u.organization_id = $2
                      AND (
                        u.first_name ILIKE $1 ESCAPE '\\' OR u.last_name ILIKE $1 ESCAPE '\\'
                        OR CONCAT(u.first_name, ' ', u.last_name) ILIKE $1 ESCAPE '\\'
                        OR CONCAT(u.last_name, ', ', u.first_name) ILIKE $1 ESCAPE '\\'
                      )
                      LIMIT 20
                    `,
                    [likeQuery, orgId]
                  )
                : empty,

              // Guardians — only show if their linked student is in the teacher's class
              withClassScope((classIds) =>
                db.query(
                  classIds
                    ? `
                        SELECT DISTINCT ON (
                          LOWER(TRIM(COALESCE(g.first_name, ''))),
                          LOWER(TRIM(COALESCE(g.last_name, ''))),
                          LOWER(TRIM(COALESCE(g.email, ''))),
                          REGEXP_REPLACE(COALESCE(g.phone, ''), '[^0-9]', '', 'g')
                        )
                           'guardian' AS type, g.guardian_id AS id, g.first_name, g.last_name, g.image_url,
                           NULL::text AS class_name, NULL::int AS class_id, NULL::text AS account_type, NULL::text AS subject_name
                        FROM guardians g
                        INNER JOIN students s ON g.student_id = s.student_id
                        WHERE g.organization_id = $2
                          AND s.class_id = ANY($3::int[])
                          AND (
                            g.first_name ILIKE $1 ESCAPE '\\' OR g.last_name ILIKE $1 ESCAPE '\\'
                            OR CONCAT(g.first_name, ' ', g.last_name) ILIKE $1 ESCAPE '\\'
                            OR CONCAT(g.last_name, ', ', g.first_name) ILIKE $1 ESCAPE '\\'
                          )
                        ORDER BY
                          LOWER(TRIM(COALESCE(g.first_name, ''))),
                          LOWER(TRIM(COALESCE(g.last_name, ''))),
                          LOWER(TRIM(COALESCE(g.email, ''))),
                          REGEXP_REPLACE(COALESCE(g.phone, ''), '[^0-9]', '', 'g'),
                          CASE WHEN COALESCE(g.image_url, '') <> '' AND g.image_url <> 'profilePlaceholder.png' THEN 0 ELSE 1 END,
                          g.guardian_id DESC
                        LIMIT 20
                      `
                    : `
                        SELECT DISTINCT ON (
                          LOWER(TRIM(COALESCE(g.first_name, ''))),
                          LOWER(TRIM(COALESCE(g.last_name, ''))),
                          LOWER(TRIM(COALESCE(g.email, ''))),
                          REGEXP_REPLACE(COALESCE(g.phone, ''), '[^0-9]', '', 'g')
                        )
                           'guardian' AS type, g.guardian_id AS id, g.first_name, g.last_name, g.image_url,
                           NULL::text AS class_name, NULL::int AS class_id, NULL::text AS account_type, NULL::text AS subject_name
                        FROM guardians g
                        WHERE g.organization_id = $2
                          AND (
                            g.first_name ILIKE $1 ESCAPE '\\' OR g.last_name ILIKE $1 ESCAPE '\\'
                            OR CONCAT(g.first_name, ' ', g.last_name) ILIKE $1 ESCAPE '\\'
                            OR CONCAT(g.last_name, ', ', g.first_name) ILIKE $1 ESCAPE '\\'
                          )
                        ORDER BY
                          LOWER(TRIM(COALESCE(g.first_name, ''))),
                          LOWER(TRIM(COALESCE(g.last_name, ''))),
                          LOWER(TRIM(COALESCE(g.email, ''))),
                          REGEXP_REPLACE(COALESCE(g.phone, ''), '[^0-9]', '', 'g'),
                          CASE WHEN COALESCE(g.image_url, '') <> '' AND g.image_url <> 'profilePlaceholder.png' THEN 0 ELSE 1 END,
                          g.guardian_id DESC
                        LIMIT 20
                      `,
                  classIds ? [likeQuery, orgId, classIds] : [likeQuery, orgId]
                )
              ),

              // Classes — teachers only see classes they are assigned to
              withClassScope((classIds) =>
                classIds
                  ? db.query(
                      `
                        SELECT 'class' AS type, c.class_id AS id, c.class_name AS first_name, '' AS last_name, NULL::text AS image_url,
                           c.class_name, c.class_id, NULL::text AS account_type, NULL::text AS subject_name
                        FROM classes c
                        WHERE c.organization_id = $2
                          AND c.class_id = ANY($3::int[])
                          AND c.class_name ILIKE $1 ESCAPE '\\'
                        LIMIT 20
                      `,
                      [likeQuery, orgId, classIds]
                    )
                  : db.query(
                      `
                        SELECT 'class' AS type, c.class_id AS id, c.class_name AS first_name, '' AS last_name, NULL::text AS image_url,
                           c.class_name, c.class_id, NULL::text AS account_type, NULL::text AS subject_name
                        FROM classes c
                        WHERE c.organization_id = $2
                          AND c.class_name ILIKE $1 ESCAPE '\\'
                        LIMIT 20
                      `,
                      [likeQuery, orgId]
                    )
              ),

              db.query(
                `
                  -- One row per subject per class, from the current term when there is one.
                  SELECT * FROM (
                    SELECT DISTINCT ON (LOWER(s.subject_name), s.class_id)
                       'subject' AS type, s.subject_id AS id, s.subject_name AS first_name, '' AS last_name, NULL::text AS image_url,
                       c.class_name, s.class_id, NULL::text AS account_type, s.subject_name AS subject_name
                    FROM subjects s
                    LEFT JOIN classes c ON c.class_id = s.class_id AND c.organization_id = s.organization_id
                    LEFT JOIN terms t ON t.term_id = s.term_id
                    WHERE s.organization_id = $2
                      AND s.subject_name ILIKE $1 ESCAPE '\\'
                      AND (s.term_id IS NULL OR t.current
                           OR NOT EXISTS (SELECT 1 FROM terms t2 WHERE t2.organization_id = $2 AND t2.current))
                    ORDER BY LOWER(s.subject_name), s.class_id, t.current DESC NULLS LAST, s.subject_id DESC
                  ) x
                  ORDER BY LOWER(subject_name), class_name NULLS LAST
                  LIMIT 20
                `,
                [likeQuery, orgId]
              ),

              db.query(
                `
                  SELECT 'organization_profile' AS type, o.organization_id AS id,
                     o.first_name, o.last_name,
                     COALESCE(NULLIF(o.image_url, ''), 'profilePlaceholder.png') AS image_url,
                     NULL::text AS class_name, NULL::int AS class_id,
                     'Organization Profile'::text AS account_type, NULL::text AS subject_name
                  FROM organizations o
                  WHERE o.organization_id = $2
                  AND (
                    o.first_name ILIKE $1 ESCAPE '\\'
                    OR o.last_name ILIKE $1 ESCAPE '\\'
                    OR CONCAT(o.first_name, ' ', o.last_name) ILIKE $1 ESCAPE '\\'
                    OR CONCAT(o.last_name, ', ', o.first_name) ILIKE $1 ESCAPE '\\'
                    OR o.organization_name ILIKE $1 ESCAPE '\\'
                  )
                `,
                [likeQuery, orgId]
              ),
            ]);

            const orgNameDisplayFormat = String(req.session?.nameDisplayFormat || "first_last");

            const results = [
              ...studentsRes.rows,
              ...orgProfileRes.rows,
              ...employeesRes.rows,
              ...guardiansRes.rows,
              ...classesRes.rows,
              ...subjectsRes.rows,
            ].map((item) => ({
              ...item,
              display_name:
                formatDisplayName(item, orgNameDisplayFormat) ||
                item.subject_name ||
                item.class_name ||
                "",
            }));

            res.status(200).json({ results });
          } catch (error) {
                        res.status(500).json({ error: 'Failed to fetch users.' });
          }
        },
  

      
    
};

module.exports = enrollmentController;
