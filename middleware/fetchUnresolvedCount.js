const db = require('../config/db'); // Adjust the path to your DB configuration

let dbRetryAfter = 0;
let lastDbErrorLogAt = 0;

const fetchUnresolvedCount = async (req, res, next) => {
    const now = Date.now();

    if (now < dbRetryAfter) {
        res.locals.unresolvedCount = 0;
        return next();
    }

    try {
        const result = await db.query(`
            SELECT COUNT(*) AS unresolved_count 
            FROM help_threads 
            WHERE is_resolved = false AND is_deleted = false
        `);
        // Make the unresolvedCount available in all templates via res.locals
        res.locals.unresolvedCount = result.rows[0].unresolved_count || 0;
        dbRetryAfter = 0;
    } catch (error) {
        const throttleMs = 5 * 60 * 1000;
        if (now - lastDbErrorLogAt > throttleMs) {
            console.error('Error fetching unresolved count:', error);
            lastDbErrorLogAt = now;
        }
        dbRetryAfter = now + 60 * 1000;
        res.locals.unresolvedCount = 0; // Default to 0 if there's an error
    }
    next();
};

module.exports = fetchUnresolvedCount;
