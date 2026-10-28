const db = require('../config/db');
const { getOrgThemeColor } = require('../utils/orgTheme');
const { getSchoolCountry } = require('../utils/schoolCountry');
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
    res.locals.appearance = 'light';
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
            req.session.appearance = 'light';
        }
    }
    if (owner) {
        res.locals.appearanceOwner = true;
        res.locals.appearance = normalizeAppearance(req.session.appearance);
    }

    // The school's country, for phone fields (see public/js/dialCodes.js): the
    // signed-in school's, or the school whose website this is.
    try {
        res.locals.schoolCountry = req.session.organizationId
            ? await getSchoolCountry(db, req.session.organizationId)
            : String(req.schoolDetails?.organization_country || '').trim().toUpperCase();
    } catch (_) {
        res.locals.schoolCountry = '';
    }

    // Skip if no organization is logged in
    if (!req.session.organizationId) {
        res.locals.themeColor = 'teal'; // Default theme
        return next();
    }

    // The school's current color for everyone signed in to it (cached for a
    // few seconds, and cleared the moment the school saves a new one).
    try {
        const color = await getOrgThemeColor(db, req.session.organizationId);
        if (req.session.themeColor !== color) req.session.themeColor = color;
        res.locals.themeColor = color;
    } catch (err) {
        res.locals.themeColor = req.session.themeColor || 'teal';
    }

    next();
};

module.exports = setThemeColor;
