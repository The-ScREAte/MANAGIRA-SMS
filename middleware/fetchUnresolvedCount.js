const db = require('../config/db'); // Adjust the path to your DB configuration

const fetchUnresolvedCount = async (req, res, next) => {
    try {
        const result = await db.query(`
            SELECT COUNT(*) AS unresolved_count 
            FROM help_threads 
            WHERE is_resolved = false AND is_deleted = false
        `);
        // Make the unresolvedCount available in all templates via res.locals
        res.locals.unresolvedCount = result.rows[0].unresolved_count || 0;
    } catch (error) {
        console.error('Error fetching unresolved count:', error);
        res.locals.unresolvedCount = 0; // Default to 0 if there's an error
    }
    next();
};

module.exports = fetchUnresolvedCount;
