const { isPublicRoute } = require("../utils/routeProfile");

const CURRENT_TERM_CACHE_TTL_MS = Number(process.env.CURRENT_TERM_CACHE_TTL_MS || 5 * 60 * 1000);

module.exports = async function setCurrentTerm(req, res, next) {
  const db = req.app.get("db");
  const organizationId = req.session.organizationId;
  const requestPath = req.path || "";

  if (isPublicRoute(requestPath)) {
    res.locals.currentTerm = null;
    return next();
  }

  if (!organizationId) {
    res.locals.currentTerm = null;
    return next();
  }

  const cachedAt = Number(req.session.currentTermCachedAt || 0);
  const isCachedOrgMatch = String(req.session.currentTermCacheOrgId || "") === String(organizationId);

  if (isCachedOrgMatch && cachedAt > 0 && Date.now() - cachedAt < CURRENT_TERM_CACHE_TTL_MS) {
    res.locals.currentTerm = req.session.currentTerm || null;
    req.session.currentTermId = req.session.currentTerm ? req.session.currentTerm.term_id : null;
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
      req.session.currentTerm = currentTerm;
      req.session.currentTermCacheOrgId = organizationId;
      req.session.currentTermCachedAt = Date.now();
      res.locals.currentTerm = currentTerm;
    } else {
      req.session.currentTerm = null;
      req.session.currentTermId = null;
      req.session.currentTermCacheOrgId = organizationId;
      req.session.currentTermCachedAt = Date.now();
      res.locals.currentTerm = null;
    }

    next();
  } catch (error) {
    console.error("❌ Error in setCurrentTerm middleware:", error);
    res.locals.currentTerm = null; // Always set it
    next();
  }
};
  