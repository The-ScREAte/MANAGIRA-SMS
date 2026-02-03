module.exports = (req, res, next) => {
    if (req.session.userRole) {
        res.locals.userRole = req.session.userRole; // Make role available in templates
    } else {
        res.locals.userRole = "default"; // Fallback role
    }
    next();
};
