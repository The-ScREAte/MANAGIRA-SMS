const createError = (status, message) => {
    const error = new Error(message);
    error.status = status;
    return error;
};

const notFound = (req, res, next) => {
    next(createError(404, 'Page Not Found'));
};

const globalErrorHandler = (err, req, res, next) => {
    const status = err.status || 500;
    const message = err.message || 'Internal Server Error';

    // Log only non-404 errors to avoid repeated terminal clutter
    if (status !== 404) {
        console.error(`[Error] ${status}: ${message}`);
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
