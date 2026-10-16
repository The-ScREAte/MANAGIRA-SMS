const createError = (status, message) => {
    const error = new Error(message);
    error.status = status;
    return error;
};

const notFound = (req, res, next) => {
    next(createError(404, 'Page Not Found'));
};

const globalErrorHandler = (err, req, res, next) => {
    if (res.headersSent) {
        return next(err);
    }

    // Upload too large or a blocked file type: say so plainly.
    const uploadMessage = require('../utils/uploadSafety').uploadErrorMessage(err);
    if (uploadMessage) {
        if (req.xhr || /json/i.test(req.get('accept') || '')) return res.status(400).json({ success: false, message: uploadMessage });
        if (req.session && typeof req.flash === 'function') {
            req.flash('error', uploadMessage);
            return res.redirect('back');
        }
        return res.status(400).type('txt').send(uploadMessage);
    }

    const rawMessage = err && err.message ? err.message : 'Internal Server Error';
    const isNetworkError = err && (err.code === 'ENOTFOUND' || /getaddrinfo ENOTFOUND/i.test(rawMessage));
    const status = isNetworkError ? 503 : (err.status || 500);
    // In production, server errors show a plain message; details stay in the logs
    // (raw messages can reveal table names or SQL).
    const hideDetails = process.env.NODE_ENV === 'production' && status >= 500;
    const message = isNetworkError
        ? 'We’re having trouble connecting to the server. Please check your internet connection and try again.'
        : (hideDetails ? 'Something went wrong. Please try again.' : rawMessage);

    // Log only non-404 errors to avoid repeated terminal clutter
    if (status !== 404) {
        console.error(`[Error] ${status}: ${rawMessage}`);
    }

    // Ensure flash messages are not overwritten by error handling
    res.locals.messages = res.locals.messages || {
        success: [],
        error: [],
    };

    // Render error page for HTML requests
    if (req.accepts('html')) {
        res.status(status).render('partials/error', {
            title: `${status} Error`,
            message,
            status,
            session: req.session || null,
            messages: res.locals.messages, // Include flash messages
        });
    } else if (req.accepts('json')) {
        // Send JSON response for API clients
        res.status(status).json({ status, message });
    } else {
        // Fallback for plain text response
        res.type('txt').send(`${status} - ${message}`);
    }
};

module.exports = {
    notFound,
    globalErrorHandler,
};
