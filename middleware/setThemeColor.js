const db = require('../config/db');
const { appearanceOwner, loadAppearance, normalizeAppearance } = require('../utils/organizationAppearance');

/**
 * Middleware to set the organization's theme color in the session
 * This is used to dynamically style buttons and UI elements
 */
// Pages drawn for a PDF or a print never use gray or dark.
function isPrintRender(req) {
    const q = req.query || {};
    if (q.pdf || q.print || q.export) return true;
    if (req.get('X-Managira-Render') === 'pdf') return true;
    return /HeadlessChrome/i.test(String(req.get('user-agent') || ''));
}

const setThemeColor = async (req, res, next) => {
    res.locals.appearance = 'gray';
    res.locals.appearanceOwner = false;
    res.locals.isPrintRender = isPrintRender(req);

    // Each person's own choice (light or dark), read once per session.
    const owner = appearanceOwner(req.session);
    const ownerKey = owner ? owner.join(':') : '';
    if (owner && req.session.appearanceKey !== ownerKey) {
        try {
            req.session.appearance = await loadAppearance(db, req.session);
            req.session.appearanceKey = ownerKey;
        } catch (err) {
            console.error('Unable to load appearance:', err.message);
            req.session.appearance = 'gray';
        }
    }
    if (owner) {
        res.locals.appearanceOwner = true;
        res.locals.appearance = normalizeAppearance(req.session.appearance);
    }

    // Skip if no organization is logged in
    if (!req.session.organizationId) {
        res.locals.themeColor = 'teal'; // Default theme
        return next();
    }

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
