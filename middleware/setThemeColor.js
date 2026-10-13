const db = require('../config/db');
const { ensureAppearanceSchema, normalizeAppearance } = require('../utils/organizationAppearance');

/**
 * Middleware to set the organization's theme color in the session
 * This is used to dynamically style buttons and UI elements
 */
const setThemeColor = async (req, res, next) => {
    // Skip if no organization is logged in
    if (!req.session.organizationId) {
        delete req.session.appearanceOrganizationId;
        delete req.session.orgAppearance;
        res.locals.themeColor = 'teal'; // Default theme
        return next();
    }

    // Read by organization, not by user: all members and iframe panels share
    // the school's choice. Existing schools get white, independently of brand.
    try {
        await ensureAppearanceSchema(db);
        const { rows } = await db.query(
            'SELECT appearance_mode FROM organizations WHERE organization_id = $1',
            [req.session.organizationId]
        );
        req.session.orgAppearance = normalizeAppearance(rows[0]?.appearance_mode);
        req.session.appearanceOrganizationId = req.session.organizationId;
    } catch (err) {
        console.error('Unable to load school appearance:', err.message);
        req.session.orgAppearance = 'white';
    }
    res.locals.orgAppearance = req.session.orgAppearance;

    // If theme color is already in session, use it
    if (req.session.themeColor) {
        res.locals.themeColor = req.session.themeColor;
        return next();
    }

    try {
        // Fetch theme color from database
        const { rows } = await db.query(
            `SELECT theme_color FROM organizations WHERE organization_id = $1`,
            [req.session.organizationId]
        );

        if (rows.length > 0 && rows[0].theme_color) {
            req.session.themeColor = rows[0].theme_color;
            res.locals.themeColor = rows[0].theme_color;
        } else {
            req.session.themeColor = 'teal';
            res.locals.themeColor = 'teal';
        }
    } catch (err) {
        console.error('❌ Error fetching theme color:', err);
        res.locals.themeColor = 'teal';
    }

    next();
};

module.exports = setThemeColor;
