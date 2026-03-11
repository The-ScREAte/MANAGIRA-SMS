"use strict";

function createRequestLatencyMonitor(options = {}) {
  const thresholdMs = Number(options.thresholdMs || process.env.REQUEST_SLOW_MS || 1200);
  const logger = options.logger || console;

  return (req, res, next) => {
    const start = process.hrtime.bigint();

    res.on("finish", () => {
      const end = process.hrtime.bigint();
      const durationMs = Number(end - start) / 1e6;

      if (durationMs >= thresholdMs) {
        logger.warn(
          `[REQ][SLOW] ${req.method} ${req.originalUrl || req.url} ${res.statusCode} ${durationMs.toFixed(1)}ms`
        );
      }
    });

    next();
  };
}

module.exports = {
  createRequestLatencyMonitor,
};
