const createError = (status, message) => {
    const error = new Error(message);
    error.status = status;
    return error;
};

const isDatabaseUnavailable = (err) => {
    try {
        return Boolean(err) && require('../config/db').isConnectRefusal(err);
    } catch (_) {
        return false;
    }
};

// Plain on purpose: it can't depend on the database or the page layout.
const BUSY_PAGE = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta http-equiv="refresh" content="15"><title>One moment</title><style>body{margin:0;min-height:100vh;display:grid;place-items:center;background:#f8fafc;color:#1e293b;font:16px/1.5 system-ui,sans-serif;padding:24px;text-align:center}h1{margin:0 0 8px;font-size:22px}p{margin:0;color:#64748b}@media (prefers-color-scheme:dark){body{background:#14161a;color:#e5e7eb}p{color:#9ca3af}}</style></head><body><main><h1>We&rsquo;ll be right back</h1><p>We&rsquo;re reconnecting. This page will try again by itself in a few seconds.</p></main></body></html>`;

const notFound = (req, res, next) => {
    next(createError(404, 'Page Not Found'));
};

const globalErrorHandler = (err, req, res, next) => {
    if (res.headersSent) {
        return next(err);
    }

    // Too large for the body limits: answered before any page data has been set up.
    if (err && err.type === 'entity.too.large') {
        return res.status(413).type('txt').send('That request is too large.');
    }

    // Errors can arrive before the middleware that gives pages this value.
    res.locals.req = res.locals.req || req;

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

    // The database is briefly refusing connections (restarting, or out of room).
    // Nothing is wrong with what the person did, so the page tries again by itself.
    if (isDatabaseUnavailable(err)) {
        console.error(`[Error] 503: database unavailable: ${err.message}`);
        res.set('Retry-After', '15');
        if (req.xhr || /json/i.test(req.get('accept') || '')) {
            return res.status(503).json({ success: false, error: 'We’re busy right now. Please try again in a moment.' });
        }
        return res.status(503).type('html').send(BUSY_PAGE);
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
