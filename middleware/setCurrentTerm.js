module.exports = async function setCurrentTerm(req, res, next) {
  const db = req.app.get("db");
  const organizationId = req.session.organizationId;

  if (!organizationId) {
    res.locals.currentTerm = null;
    return next();
  }

  try {
    const termResult = await db.query(
      `
        SELECT t.term_id, t.term_name, t.start_date, t.end_date
        FROM terms t
        JOIN school_years sy ON t.school_year_id = sy.id
        WHERE sy.organization_id = $1 AND sy.current = TRUE AND t.current = TRUE
        LIMIT 1
      `,
      [organizationId]
    );

    if (termResult.rows.length > 0) {
      const currentTerm = termResult.rows[0];
      req.session.currentTermId = currentTerm.term_id;
      res.locals.currentTerm = currentTerm;
    } else {
      res.locals.currentTerm = null;
    }

    next();
  } catch (error) {
    console.error("❌ Error in setCurrentTerm middleware:", error);
    res.locals.currentTerm = null; // Always set it
    next();
  }
};
  