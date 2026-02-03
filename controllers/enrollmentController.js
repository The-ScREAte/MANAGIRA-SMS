const enrollmentController = {
    // Enrollment page
    enrollmentGet: async (req, res, db) => {
      try {
        const organizationId = req.session.organizationId;
    
        // Fetch all school years
        const schoolYearResults = await db.query(`
          SELECT id AS school_year_id, year_label, current
          FROM school_years
          WHERE organization_id = $1
          ORDER BY created_at DESC
        `, [organizationId]);
        const schoolYears = schoolYearResults.rows;
    
        // Fetch terms for each school year
        const termResults = await db.query(`
          SELECT term_id, school_year_id, term_name, start_date, end_date, current
          FROM terms
          WHERE organization_id = $1
          ORDER BY start_date
        `, [organizationId]);
        const terms = termResults.rows;
    
        // Attach terms to each school year
        schoolYears.forEach(year => {
          year.terms = terms.filter(term => term.school_year_id === year.school_year_id);
        });
    
        // Determine current term
        const currentTerm = terms.find(t => t.current);
        if (!currentTerm) {
          req.flash('error', 'No current term found. Please set a current term.');
          return res.redirect('/');
        }
    
        // 🔥 Fetch ALL classes in the organization
        const allClassesResult = await db.query(`
          SELECT class_id, class_name
          FROM classes
          WHERE organization_id = $1
          ORDER BY class_name
        `, [organizationId]);
        const allClasses = allClassesResult.rows;
    
        // 🔥 For each class, get enrolled students (for current term + year)
        const classesWithEnrolledStudents = await Promise.all(allClasses.map(async cls => {
          const studentsResult = await db.query(`
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
          `, [cls.class_id, currentTerm.term_id, currentTerm.school_year_id, organizationId]);
    
          return {
            ...cls,
            enrolledStudents: studentsResult.rows
          };
        }));
    
        res.render('enrollment/enrollment', {
          title: 'Enrollment',
          schoolYears,
          classes: classesWithEnrolledStudents, // ✅ shows ALL classes
          currentTerm,
          messages: req.flash()
        });
      } catch (error) {
        console.error('Error fetching enrollment data:', error);
        req.flash('error', 'Failed to load enrollment data.');
        res.redirect('/');
      }
    },
    
      
    

    enrollmentPost: async (req, res, db) => {
      const { schoolYearId, termId, selectedClasses, selectedStudents } = req.body;
      const organizationId = req.session.organizationId;
    
      if (!schoolYearId || !termId || !selectedClasses || selectedClasses.length === 0) {
        return res.status(400).json({ success: false, message: 'School year, term, and classes are required for enrollment.' });
      }
    
      try {
        await db.query('BEGIN');
    
        // Check for existing enrollment
        const existingEnrollmentRes = await db.query(`
          SELECT enrollment_id FROM enrollments
          WHERE school_year_id = $1 AND term_id = $2 AND organization_id = $3
        `, [schoolYearId, termId, organizationId]);
    
        let enrollmentId;
        if (existingEnrollmentRes.rows.length > 0) {
          enrollmentId = existingEnrollmentRes.rows[0].enrollment_id;
        } else {
          const newEnrollmentRes = await db.query(`
            INSERT INTO enrollments (school_year_id, term_id, organization_id, created_at)
            VALUES ($1, $2, $3, NOW())
            RETURNING enrollment_id
          `, [schoolYearId, termId, organizationId]);
          enrollmentId = newEnrollmentRes.rows[0].enrollment_id;
        }
    
        // Insert any new classes (avoid duplicates)
        for (const classId of selectedClasses) {
          await db.query(`
            INSERT INTO enrolled_classes (enrollment_id, class_id)
            SELECT $1, $2
            WHERE NOT EXISTS (
              SELECT 1 FROM enrolled_classes WHERE enrollment_id = $1 AND class_id = $2
            )
          `, [enrollmentId, classId]);
        }
    
        // Insert students (ensure each student only exists once across all classes for that enrollment)
        for (const classId in selectedStudents) {
          const students = selectedStudents[classId];
          for (const studentId of students) {
            const existingStudentCheck = await db.query(`
              SELECT 1 FROM enrolled_students
              WHERE enrollment_id = $1 AND student_id = $2
            `, [enrollmentId, studentId]);
    
            if (existingStudentCheck.rows.length === 0) {
              await db.query(`
                INSERT INTO enrolled_students (enrollment_id, student_id, class_id)
                VALUES ($1, $2, $3)
              `, [enrollmentId, studentId, classId]);
            }
          }
        }
    
        await db.query('COMMIT');
        res.status(200).json({ success: true, message: 'Enrollment updated successfully.' });
      } catch (error) {
        await db.query('ROLLBACK');
        console.error('Error enrolling students:', error);
        res.status(500).json({ success: false, message: 'Failed to enroll students.' });
      }
    },
          
        

    getStudentsByClass: async (req, res, db) => {
        const { classId } = req.query;
    
        try {
            const studentsResult = await db.query(`
                SELECT student_id, first_name, last_name
                FROM students
                WHERE class_id = $1 AND graduated = FALSE
                ORDER BY last_name, first_name
            `, [classId]);
    
            res.json({ students: studentsResult.rows });
        } catch (error) {
            console.error('Error fetching students:', error);
            res.status(500).json({ error: 'Failed to fetch students.' });
        } 
    },
    

    manageEnrollmentGet: async (req, res, db) => {
        try {
          const organizationId = req.session.organizationId;
      
          // Fetch all enrollments (school year + term)
          const enrollmentsResult = await db.query(`
            SELECT e.enrollment_id, sy.year_label AS school_year, sy.current AS is_current_year,
                   t.term_name AS term, t.current AS is_current_term
            FROM enrollments e
            JOIN school_years sy ON e.school_year_id = sy.id
            JOIN terms t ON e.term_id = t.term_id
            WHERE e.organization_id = $1
            ORDER BY sy.current DESC, sy.year_label, t.term_name
          `, [organizationId]);
      
          const enrollments = enrollmentsResult.rows;
      
          // For each enrollment, get ONLY the enrolled classes and their enrolled students
          for (const enrollment of enrollments) {
            // Get enrolled classes for this enrollment
            const classesResult = await db.query(`
              SELECT c.class_id, c.class_name
              FROM enrolled_classes ec
              JOIN classes c ON ec.class_id = c.class_id
              WHERE ec.enrollment_id = $1
            `, [enrollment.enrollment_id]);
      
            const classes = [];
      
            for (const cls of classesResult.rows) {
              // Get only the students enrolled in this class for this enrollment
              const enrolledStudentsResult = await db.query(`
                SELECT s.student_id, s.first_name, s.last_name
                FROM enrolled_students es
                JOIN students s ON es.student_id = s.student_id
                WHERE es.enrollment_id = $1 AND es.class_id = $2
                ORDER BY s.last_name, s.first_name
              `, [enrollment.enrollment_id, cls.class_id]);
      
              classes.push({
                class_id: cls.class_id,
                class_name: cls.class_name,
                enrolled_students: enrolledStudentsResult.rows // ✅ Only enrolled students!
              });
            }
      
            enrollment.classes = classes;
          }
      
          const currentSemester = enrollments.find(e => e.is_current_year && e.is_current_term);
          const noEnrollmentForCurrentSemester = !currentSemester;
      
          res.render('enrollment/manageEnrollment', {
            title: 'Manage Enrollments',
            enrollments,
            noEnrollmentForCurrentSemester,
            currentSemesterName: currentSemester
              ? `${currentSemester.school_year} - ${currentSemester.term}`
              : 'the current school year and term',
            messages: req.flash()
          });
        } catch (error) {
          console.error('Error fetching enrollments:', error);
          req.flash('error', 'Failed to load enrollments.');
          res.redirect('/');
        }
      },
              
        
    modifyEnrollmentGet: async (req, res, db) => {
        try {
            const { enrollmentId } = req.params; // Extract enrollmentId from the route
            const organizationId = req.session.organizationId;
    
            // Fetch the existing enrollment
            const enrollmentResult = await db.query(`
                SELECT school_year_id, term_id 
                FROM enrollments 
                WHERE enrollment_id = $1 AND organization_id = $2
            `, [enrollmentId, organizationId]);
    
            if (enrollmentResult.rows.length === 0) {
                req.flash('error', 'Enrollment not found.');
                return res.redirect('/enrollment/manageEnrollment');
            }
    
            const enrollment = enrollmentResult.rows[0];
    
            // Fetch all school years
            const schoolYearResults = await db.query(`
                SELECT id AS school_year_id, year_label, current
                FROM school_years
                WHERE organization_id = $1
                ORDER BY created_at DESC
            `, [organizationId]);
    
            const schoolYears = schoolYearResults.rows.map(year => ({
                ...year,
                selected: year.school_year_id === enrollment.school_year_id,
            }));
    
            // Fetch terms for the selected school year
            const termResults = await db.query(`
                SELECT term_id, school_year_id, term_name, start_date, end_date
                FROM terms
                WHERE school_year_id = $1 AND organization_id = $2
                ORDER BY start_date
            `, [enrollment.school_year_id, organizationId]);
    
            const currentTerms = termResults.rows.map(term => ({
                ...term,
                selected: term.term_id === enrollment.term_id,
            }));
    
            // Fetch all classes and determine which were previously selected
            const classesResult = await db.query(`
                SELECT c.class_id, c.class_name, 
                    EXISTS (
                        SELECT 1 
                        FROM enrolled_classes ec 
                        WHERE ec.class_id = c.class_id AND ec.enrollment_id = $1
                    ) AS selected
                FROM classes c
                WHERE c.organization_id = $2
                ORDER BY c.class_name
            `, [enrollmentId, organizationId]);
    
            const classes = await Promise.all(classesResult.rows.map(async cls => {
                const studentResults = await db.query(`
                    SELECT s.student_id, s.first_name, s.last_name
                    FROM enrolled_students es
                    INNER JOIN students s ON es.student_id = s.student_id
                    WHERE es.class_id = $1 AND es.enrollment_id = $2 AND s.graduated = FALSE
                    ORDER BY s.last_name, s.first_name
                `, [cls.class_id, enrollmentId]);
            
                return {
                    ...cls,
                    students: studentResults.rows,
                };
            }));
                
            // Pass enrollmentId to the template
            res.render('enrollment/modifyEnrollment', {
                title: 'Modify Enrollment',
                enrollmentId, // Include the enrollmentId
                schoolYears,
                currentTerms,
                classes,
                messages: req.flash(),
            });
        } catch (error) {
            console.error('Error loading modify enrollment data:', error);
            req.flash('error', 'Failed to load modify enrollment data.');
            res.redirect('/enrollment/manageEnrollment');
        }
    },
    
    modifyEnrollmentPost: async (req, res, db) => {
        const { schoolYearId, termId, selectedClasses, selectedStudents } = req.body;
        const { enrollmentId } = req.params;
        const organizationId = req.session.organizationId;
      
        try {
          await db.query('BEGIN');
      
          const conflictingStudents = [];
      
          for (const [newClassId, studentIds] of Object.entries(selectedStudents)) {
            for (const studentId of studentIds) {
              const conflictRes = await db.query(`
                SELECT c.class_id, c.class_name, s.first_name, s.last_name
                FROM enrolled_students es
                JOIN enrolled_classes ec ON es.enrollment_id = ec.enrollment_id AND es.class_id = ec.class_id
                JOIN classes c ON ec.class_id = c.class_id
                JOIN students s ON es.student_id = s.student_id
                WHERE es.student_id = $1
                  AND es.enrollment_id = $2
                  AND es.class_id != $3
              `, [studentId, enrollmentId, newClassId]);
      
              if (conflictRes.rows.length > 0) {
                const currentClass = conflictRes.rows[0].class_name;
                const studentName = `${conflictRes.rows[0].first_name} ${conflictRes.rows[0].last_name}`;
                const newClass = await db.query('SELECT class_name FROM classes WHERE class_id = $1', [newClassId]).then(r => r.rows[0].class_name);
                conflictingStudents.push({
                  studentId,
                  studentName,
                  currentClass,
                  newClass
                });
              }
            }
          }
      
          if (conflictingStudents.length > 0 && !req.query.confirmMove) {
            await db.query('ROLLBACK');
            return res.status(200).json({
              conflicts: conflictingStudents,
              message: 'Some students are already in other classes. Confirm if you want to move them.'
            });
          }
      
          // No conflicts or confirmed to move. Clear existing data and re-insert.
          await db.query('DELETE FROM enrolled_classes WHERE enrollment_id = $1', [enrollmentId]);
          await db.query('DELETE FROM enrolled_students WHERE enrollment_id = $1', [enrollmentId]);
      
          if (selectedClasses && selectedClasses.length > 0) {
            await db.query(`
              INSERT INTO enrolled_classes (enrollment_id, class_id)
              SELECT $1, unnest($2::int[])
            `, [enrollmentId, selectedClasses]);
          }
      
          if (selectedStudents && Object.keys(selectedStudents).length > 0) {
            for (const classId in selectedStudents) {
              const students = selectedStudents[classId];
              for (const studentId of students) {
                await db.query(`
                  INSERT INTO enrolled_students (enrollment_id, student_id, class_id)
                  VALUES ($1, $2, $3)
                `, [enrollmentId, studentId, classId]);
              }
            }
          }
      
          await db.query('COMMIT');
          req.flash('success', 'Enrollment modified successfully.');
          res.status(200).json({ success: true, message: 'Enrollment modified successfully.' });
        } catch (error) {
          await db.query('ROLLBACK');
          console.error('Error modifying enrollment:', error);
          res.status(500).json({ success: false, message: 'Failed to modify enrollment.' });
        }
      },
      
                      
    deleteEnrollment: async (req, res, db) => {
        const enrollmentId = req.params.enrollmentId;

        try {
            await db.query('BEGIN');

            // Delete enrolled students
            await db.query(`DELETE FROM enrolled_students WHERE enrollment_id = $1`, [enrollmentId]);

            // Delete enrolled classes
            await db.query(`DELETE FROM enrolled_classes WHERE enrollment_id = $1`, [enrollmentId]);

            // Delete the enrollment itself
            await db.query(`DELETE FROM enrollments WHERE enrollment_id = $1`, [enrollmentId]);

            await db.query('COMMIT');
            req.flash('success', 'Enrollment deleted successfully.');
            res.redirect('/enrollment/manageEnrollment');
        } catch (error) {
            await db.query('ROLLBACK');
            console.error('Error deleting enrollment:', error);
            req.flash('error', 'Failed to delete enrollment.');
            res.redirect('/enrollment/modifyEnrollment/' + enrollmentId);
        }
    },
        searchUsers: async (req, res, db) => {
            const query = req.query.query;
    
            if (!query) {
                return res.status(400).json({ error: 'No search query provided.' });
            }
    
            try {
                const searchQuery = `
                    SELECT s.student_id, s.first_name, s.last_name, s.image_url, c.class_name, c.class_id
                    FROM students s
                    LEFT JOIN classes c ON s.class_id = c.class_id
                    WHERE (s.first_name ILIKE $1 OR s.last_name ILIKE $1 OR CONCAT(s.first_name, ' ', s.last_name) ILIKE $1)
                    AND s.organization_id = $2
                    ORDER BY s.first_name, s.last_name
                `;
    
                const values = [`%${query}%`, req.session.organizationId];
    
                const result = await db.query(searchQuery, values);
                const users = result.rows;
    
                res.status(200).json({ users });
            } catch (error) {
                console.error('Error fetching users for search:', error);
                res.status(500).json({ error: 'Failed to fetch users.' });
            }
        },
  

      
    
};

module.exports = enrollmentController;
