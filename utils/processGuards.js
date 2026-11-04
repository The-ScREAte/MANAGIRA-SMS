"use strict";

// Without these, Node ends the whole process (status 1) on one failed promise that
// nothing was waiting for, such as a database refusal inside a background task.
// Every school then sees errors until the host restarts it.
function install(label) {
  process.on("unhandledRejection", (reason) => {
    console.error(`[${label}] Unhandled promise rejection:`, (reason && reason.stack) || reason);
  });

  process.on("uncaughtException", (error, origin) => {
    console.error(`[${label}] Uncaught ${origin}:`, (error && error.stack) || error);
    // A dropped database connection or socket leaves nothing broken here, so keep
    // serving. Anything else may have left the program in an unknown state: stop
    // cleanly and let the host start a fresh copy.
    if (isHarmlessConnectionError(error)) return;
    process.exitCode = 1;
    process.kill(process.pid, "SIGTERM");
  });
}

function isHarmlessConnectionError(error) {
  const code = String((error && error.code) || "");
  const message = String((error && error.message) || "").toLowerCase();
  return ["ECONNRESET", "EPIPE", "ETIMEDOUT", "ECONNREFUSED", "ENOTFOUND", "EAI_AGAIN", "08004", "57P01", "57P03", "53300"].includes(code)
    || message.includes("service temporarily unavailable")
    || message.includes("connection terminated")
    || message.includes("connection timeout");
}

module.exports = { install, isHarmlessConnectionError };
