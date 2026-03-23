const db = require("../config/db");

module.exports = {
  // Page to view and schedule promotions
  applyPromotionPage: async (req, res) => {
    const organizationId = req.session.organizationId;

    try {
      const currentTermResult = await db.query(
        `SELECT * FROM terms WHERE current = true AND organization_id = $1`,
        [organizationId]
      );

      const currentSchoolYearResult = await db.query(
        `SELECT id AS school_year_id, year_label AS label FROM school_years WHERE current = true AND organization_id = $1`,
        [organizationId]
      );

      const allTermsResult = await db.query(
        `SELECT term_id, school_year_id, term_name FROM terms WHERE organization_id = $1 ORDER BY start_date`,
        [organizationId]
      );

      const allYearsResult = await db.query(
        `SELECT id AS school_year_id, year_label AS label FROM school_years WHERE organization_id = $1 ORDER BY created_at DESC`,
        [organizationId]
      );

      const structuredYears = allYearsResult.rows.map(year => ({
        ...year,
        terms: allTermsResult.rows.filter(t => t.school_year_id === year.school_year_id)
      }));

      const classesResult = await db.query(
        `SELECT class_id, class_name FROM classes WHERE organization_id = $1 ORDER BY class_name`,
        [organizationId]
      );

      const scheduleResult = await db.query(
        `SELECT * FROM promotion_schedule WHERE organization_id = $1 ORDER BY scheduled_date DESC`,
        [organizationId]
      );

      // Fetch classes for each schedule
      const schedules = await Promise.all(scheduleResult.rows.map(async (schedule) => {
        const scheduleClasses = await db.query(
          `SELECT c.class_name FROM promotion_schedule_classes psc
           JOIN classes c ON psc.class_id = c.class_id
           WHERE psc.schedule_id = $1`,
          [schedule.id]
        );
        return {
          ...schedule,
          classes: scheduleClasses.rows.map(row => row.class_name)
        };
      }));

      res.render("promotion/applyPromotion", {
        title: "Promotion Scheduler",
        currentTerm: currentTermResult.rows[0],
        currentSchoolYear: currentSchoolYearResult.rows[0],
        allTerms: allTermsResult.rows,
        allYears: structuredYears,
        allClasses: classesResult.rows,
        schedules,
        messages: req.flash(),
        success_msg: req.flash("success_msg"),
        error_msg: req.flash("error_msg")
      });
    } catch (err) {
            res.status(500).send("Failed to load promotion scheduling.");
    }
  },

  // Schedule a promotion
  schedulePromotion: async (req, res) => {
    const {
      fromSchoolYearId,
      fromTermId,
      targetYearId,
      targetTermId,
      scheduledDate,
      classIds,
      applyMode
    } = req.body;
    const organizationId = req.session.organizationId;
    const normalizedApplyMode = applyMode === 'applyNow' ? 'applyNow' : 'scheduleLater';
    const selectedClassIds = Array.isArray(classIds)
      ? classIds.map(Number).filter(Boolean)
      : (classIds ? [Number(classIds)].filter(Boolean) : []);
  
    try {
      // 0️⃣ Check if it's already scheduled
      const existingSchedule = await db.query(`
        SELECT id FROM promotion_schedule
        WHERE organization_id = $1
          AND current_term_id = $2 AND current_school_year_id = $3
          AND target_term_id = $4 AND target_school_year_id = $5
          AND status = 'scheduled'
      `, [
        organizationId,
        fromTermId,
        fromSchoolYearId,
        targetTermId,
        targetYearId
      ]);
  
      if (existingSchedule.rows.length > 0) {
        req.flash("error", "This promotion is already scheduled.");
        return res.redirect("/promotion/apply");
      }
  
      // 1️⃣ Fetch students intended for promotion
      const promotedStudentsResult = await db.query(`
        SELECT student_id, promotion_class_id
        FROM student_reports
        WHERE organization_id = $1 AND term_id = $2
          AND promotion_status IN ('Promoted', 'Repeated') AND promotion_class_id IS NOT NULL
      `, [organizationId, fromTermId]);
  
      const studentsToPromote = promotedStudentsResult.rows;
      if (studentsToPromote.length === 0) {
        req.flash("error", "No students eligible for promotion.");
        return res.redirect("/promotion/apply");
      }
  
      // 2️⃣ Check for already applied promotion pairs
      const enrollmentResult = await db.query(`
        SELECT enrollment_id FROM enrollments
        WHERE term_id = $1 AND school_year_id = $2 AND organization_id = $3
      `, [targetTermId, targetYearId, organizationId]);
  
      let existingPairs = new Set();
      if (enrollmentResult.rows.length > 0) {
        const enrollmentId = enrollmentResult.rows[0].enrollment_id;
  
        const existingPromotions = await db.query(`
          SELECT student_id, class_id FROM enrolled_students
          WHERE enrollment_id = $1 AND added_by_promotion = TRUE
        `, [enrollmentId]);
  
        existingPairs = new Set(
          existingPromotions.rows.map(r => `${r.student_id}-${r.class_id}`)
        );
      }
  
      // 3️⃣ Filter out already-applied students
      const newPromotionPairs = studentsToPromote.filter(
        row => !existingPairs.has(`${row.student_id}-${row.promotion_class_id}`)
      );
  
      if (newPromotionPairs.length === 0) {
        req.flash("error", "This promotion you're trying to schedule has either already been scheduled or applied. No new changes detected.");
        return res.redirect("/promotion/apply");
      }
  
      // 4️⃣ Insert the schedule
      const effectiveScheduleDate = normalizedApplyMode === 'applyNow'
        ? new Date()
        : new Date(scheduledDate);

      if (normalizedApplyMode === 'scheduleLater' && Number.isNaN(effectiveScheduleDate.getTime())) {
        req.flash("error", "Please select a valid schedule date.");
        return res.redirect("/promotion/apply");
      }

      const scheduleInsertResult = await db.query(`
        INSERT INTO promotion_schedule (
          organization_id, current_school_year_id, current_term_id,
          target_school_year_id, target_term_id, scheduled_date, status
        )
        VALUES ($1, $2, $3, $4, $5, $6, 'scheduled')
        RETURNING id
      `, [
        organizationId,
        fromSchoolYearId,
        fromTermId,
        targetYearId,
        targetTermId,
        effectiveScheduleDate
      ]);
  
      const scheduleId = scheduleInsertResult.rows[0].id;
  
      // 5️⃣ Insert selected classes (if any)
      if (selectedClassIds.length > 0) {
        await db.query(`
          INSERT INTO promotion_schedule_classes (schedule_id, class_id, organization_id)
          SELECT $1, unnest($2::int[]), $3
        `, [scheduleId, selectedClassIds, organizationId]);
      }

      if (normalizedApplyMode === 'applyNow') {
        const justCreated = await db.query(
          `SELECT * FROM promotion_schedule WHERE id = $1 AND organization_id = $2`,
          [scheduleId, organizationId]
        );

        const result = await module.exports._applyPromotionCore(justCreated.rows[0]);
        if (result.success) {
          req.flash("success", `Promotion applied! ${result.enrolledCount} students enrolled into their new classes.`);
        } else {
          req.flash("error", result.reason || "Promotion could not be applied now.");
        }
      } else {
        req.flash("success", "Promotion scheduled successfully.");
      }

      res.redirect("/promotion/apply");
  
    } catch (err) {
            req.flash("error", "Failed to schedule promotion.");
      res.redirect("/promotion/apply");
    }
  },
  
    
      
  // Cancel a scheduled promotion
  cancelScheduledPromotion: async (req, res) => {
    const organizationId = req.session.organizationId;
    const scheduleId = req.body.scheduleId;

    try {
      await db.query(
        `DELETE FROM promotion_schedule_classes WHERE schedule_id = $1`,
        [scheduleId]
      );

      await db.query(
        `DELETE FROM promotion_schedule WHERE id = $1 AND organization_id = $2`,
        [scheduleId, organizationId]
      );

      req.flash("success_msg", "Scheduled promotion has been deleted.");
      res.redirect("/promotion/apply");
    } catch (err) {
            req.flash("error_msg", "Failed to delete promotion.");
      res.redirect("/promotion/apply");
    }
  },

  reverseAppliedPromotion: async (req, res) => {
    const organizationId = req.session.organizationId;
    const scheduleId = req.body.scheduleId;
  
    try {
      await db.query('BEGIN');
  
      // 1️⃣ Get the promotion schedule to reverse
      const scheduleResult = await db.query(
        `SELECT * FROM promotion_schedule WHERE id = $1 AND organization_id = $2 AND status = 'completed'`,
        [scheduleId, organizationId]
      );
  
      if (scheduleResult.rows.length === 0) {
        req.flash("error_msg", "Promotion cannot be reversed (expired or not applicable).");
        await db.query('ROLLBACK');
        return res.redirect("/promotion/apply");
      }
  
      const { target_term_id, target_school_year_id } = scheduleResult.rows[0];
  
      // 2️⃣ Find the enrollment (if any)
      const enrollmentResult = await db.query(`
        SELECT enrollment_id FROM enrollments
        WHERE term_id = $1 AND school_year_id = $2 AND organization_id = $3
      `, [target_term_id, target_school_year_id, organizationId]);
  
      if (enrollmentResult.rows.length > 0) {
        const enrollmentId = enrollmentResult.rows[0].enrollment_id;
  
        // 3️⃣ Remove ONLY students added by promotion
        await db.query(`
          DELETE FROM enrolled_students 
          WHERE enrollment_id = $1 AND added_by_promotion = TRUE
        `, [enrollmentId]);
  
        // 4️⃣ Remove any classes that no longer have students
        await db.query(`
          DELETE FROM enrolled_classes ec
          WHERE ec.enrollment_id = $1
            AND NOT EXISTS (
              SELECT 1 FROM enrolled_students es
              WHERE es.enrollment_id = ec.enrollment_id AND es.class_id = ec.class_id
            )
        `, [enrollmentId]);
  
        // 5️⃣ Optionally delete the enrollment if it’s now empty
        const checkEnrollmentEmpty = await db.query(`
          SELECT 1 FROM enrolled_students WHERE enrollment_id = $1
        `, [enrollmentId]);
  
        if (checkEnrollmentEmpty.rows.length === 0) {
          await db.query(`DELETE FROM enrollments WHERE enrollment_id = $1`, [enrollmentId]);
        }
      }
  
      // 6️⃣ Delete term if it was auto-created by promotion
      const termCheck = await db.query(`
        SELECT term_id FROM terms 
        WHERE term_id = $1 AND organization_id = $2 AND created_by_promotion = TRUE
      `, [target_term_id, organizationId]);
  
      if (termCheck.rows.length > 0) {
        await db.query(`DELETE FROM terms WHERE term_id = $1`, [target_term_id]);
      }
  
      // 7️⃣ Delete school year if it was auto-created by promotion
      const yearCheck = await db.query(`
        SELECT id FROM school_years 
        WHERE id = $1 AND organization_id = $2 AND created_by_promotion = TRUE
      `, [target_school_year_id, organizationId]);
  
      if (yearCheck.rows.length > 0) {
        await db.query(`DELETE FROM school_years WHERE id = $1`, [target_school_year_id]);
      }
  
      // 8️⃣ Mark promotion as reversed
      await db.query(`
        UPDATE promotion_schedule
        SET status = 'reversed'
        WHERE id = $1
      `, [scheduleId]);
  
      await db.query('COMMIT');
  
      req.flash("success_msg", "Promotion reversed. Only promotion-added data removed.");
      res.redirect("/promotion/apply");
    } catch (err) {
      await db.query('ROLLBACK');
            req.flash("error_msg", "Failed to reverse promotion.");
      res.redirect("/promotion/apply");
    }
  },
  
  
  
  deleteReversedPromotion: async (req, res) => {
    const organizationId = req.session.organizationId;
    const scheduleId = req.body.scheduleId;
  
    try {
      await db.query(
        `DELETE FROM promotion_schedule_classes WHERE schedule_id = $1`,
        [scheduleId]
      );
  
      await db.query(
        `DELETE FROM promotion_schedule WHERE id = $1 AND organization_id = $2 AND status = 'reversed'`,
        [scheduleId, organizationId]
      );
  
      req.flash("success_msg", "Reversed promotion has been deleted.");
      res.redirect("/promotion/apply");
    } catch (err) {
            req.flash("error_msg", "Failed to delete reversed promotion.");
      res.redirect("/promotion/apply");
    }
  },
  

  // Shared core logic for applying a single promotion
  _applyPromotionCore: async (promo) => {
    const {
      id: scheduleId,
      organization_id,
      target_term_id,
      target_school_year_id,
      current_term_id
    } = promo;

    await db.query('BEGIN');

    // 1️⃣ Get class filter from promotion_schedule_classes
    const classFilterResult = await db.query(
      `SELECT class_id FROM promotion_schedule_classes WHERE schedule_id = $1`,
      [scheduleId]
    );
    const filterClassIds = classFilterResult.rows.map(r => r.class_id);

    // 2️⃣ Check activate_promotion flag on status_settings for filtered classes
    let classCondition = '';
    const queryParams = [organization_id, current_term_id];
    if (filterClassIds.length > 0) {
      classCondition = ` AND ss.class_id = ANY($3)`;
      queryParams.push(filterClassIds);
    }

    // Only process classes where activate_promotion = true
    const activeClassesResult = await db.query(
      `SELECT ss.class_id FROM status_settings ss
       WHERE ss.organization_id = $1 AND ss.term_id = $2 AND ss.activate_promotion = true${classCondition}`,
      queryParams
    );
    const activeClassIds = activeClassesResult.rows.map(r => r.class_id);

    if (activeClassIds.length === 0) {
      await db.query('ROLLBACK');
      return { success: false, reason: 'No classes have promotion activated' };
    }

    // 3️⃣ Fetch students with promotion data, filtered by active classes
    const promotedStudentsResult = await db.query(`
      SELECT student_id, class_id AS current_class_id, promotion_status, promotion_class_id
      FROM student_reports
      WHERE organization_id = $1 AND term_id = $2
        AND class_id = ANY($3)
        AND promotion_status IN ('Promoted', 'Repeated') AND promotion_class_id IS NOT NULL
    `, [organization_id, current_term_id, activeClassIds]);

    if (promotedStudentsResult.rows.length === 0) {
      await db.query('ROLLBACK');
      return { success: false, reason: 'No students eligible for promotion. Generate reports first to auto-calculate promotion status.' };
    }

    // 4️⃣ Ensure enrollment exists or create one
    let enrollmentId;
    const existingEnrollmentResult = await db.query(`
      SELECT enrollment_id FROM enrollments
      WHERE term_id = $1 AND school_year_id = $2 AND organization_id = $3
    `, [target_term_id, target_school_year_id, organization_id]);

    if (existingEnrollmentResult.rows.length > 0) {
      enrollmentId = existingEnrollmentResult.rows[0].enrollment_id;
    } else {
      const newEnrollmentResult = await db.query(`
        INSERT INTO enrollments (school_year_id, term_id, organization_id, created_at)
        VALUES ($1, $2, $3, NOW())
        RETURNING enrollment_id
      `, [target_school_year_id, target_term_id, organization_id]);
      enrollmentId = newEnrollmentResult.rows[0].enrollment_id;
    }

    const finalEnrollments = promotedStudentsResult.rows.map(row => ({
      student_id: row.student_id,
      target_class_id: row.promotion_class_id
    }));

    // 5️⃣ Insert classes
    const classCheckResult = await db.query(
      `SELECT class_id FROM enrolled_classes WHERE enrollment_id = $1`,
      [enrollmentId]
    );
    const existingClassIds = new Set(classCheckResult.rows.map(r => r.class_id));
    const newClassIds = [...new Set(
      finalEnrollments.map(r => r.target_class_id)
    )].filter(cid => !existingClassIds.has(cid));

    if (newClassIds.length > 0) {
      await db.query(`
        INSERT INTO enrolled_classes (enrollment_id, class_id)
        SELECT $1, unnest($2::int[])
      `, [enrollmentId, newClassIds]);
    }

    // 6️⃣ Insert students
    let enrolledCount = 0;
    for (const { student_id, target_class_id } of finalEnrollments) {
      const result = await db.query(`
        INSERT INTO enrolled_students (enrollment_id, student_id, class_id, added_by_promotion)
        VALUES ($1, $2, $3, TRUE)
        ON CONFLICT DO NOTHING
      `, [enrollmentId, student_id, target_class_id]);
      enrolledCount += result.rowCount;
    }

    // 7️⃣ Mark schedule as completed
    await db.query(`
      UPDATE promotion_schedule SET status = 'completed' WHERE id = $1
    `, [scheduleId]);

    await db.query('COMMIT');
    return { success: true, enrolledCount, totalEligible: finalEnrollments.length };
  },

  // Cron job entry point
  applyScheduledPromotions: async () => {
    try {
      const now = new Date().toISOString();
      const promotionsResult = await db.query(`
        SELECT * FROM promotion_schedule 
        WHERE scheduled_date <= $1 AND status = 'scheduled'
      `, [now]);

      for (const promo of promotionsResult.rows) {
        try {
          const result = await module.exports._applyPromotionCore(promo);
          if (result.success) {
            console.log(`✅ Promotion ${promo.id} applied: ${result.enrolledCount}/${result.totalEligible} students enrolled`);
          } else {
            console.warn(`⚠️ Promotion ${promo.id} skipped: ${result.reason}`);
          }
        } catch (innerErr) {
          await db.query('ROLLBACK');
          console.error(`❌ Promotion ${promo.id} failed:`, innerErr.message);
        }
      }
    } catch (err) {
      console.error("❌ applyScheduledPromotions error:", err.message);
    }
  },

  // "Apply Now" - instant promotion
  applyNow: async (req, res) => {
    const scheduleId = req.body.scheduleId;
    const organizationId = req.session.organizationId;

    try {
      const scheduleResult = await db.query(
        `SELECT * FROM promotion_schedule WHERE id = $1 AND organization_id = $2 AND status = 'scheduled'`,
        [scheduleId, organizationId]
      );

      if (scheduleResult.rows.length === 0) {
        req.flash("error", "Promotion not found or already applied.");
        return res.redirect("/promotion/apply");
      }

      const result = await module.exports._applyPromotionCore(scheduleResult.rows[0]);

      if (result.success) {
        req.flash("success", `Promotion applied! ${result.enrolledCount} students enrolled into their new classes.`);
      } else {
        req.flash("error", result.reason);
      }
      res.redirect("/promotion/apply");
    } catch (err) {
      await db.query('ROLLBACK');
      console.error("❌ Apply Now failed:", err);
      req.flash("error", "Failed to apply promotion: " + err.message);
      res.redirect("/promotion/apply");
    }
  }
};
