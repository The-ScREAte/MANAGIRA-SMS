// Where people book a call with the Managira team (demos, interviews), and where job
// applicants send proposals. Everything shows Managira's own addresses: managira.com/book
// forwards to the booking page set here (MANAGIRA_BOOKING_URL), so the booking service can
// change without touching emails or pages.
const { BASE_URL } = require("./emailLinks");

const BOOKING_TARGET = String(process.env.MANAGIRA_BOOKING_URL || "https://calendly.com/managirasms/managira-team-review-meeting").trim();
const BOOKING_URL = `${BASE_URL}/book`;
const CAREERS_EMAIL = String(process.env.CAREERS_EMAIL || process.env.ADMIN_EMAIL || "info@managira.com").trim();

module.exports = { BOOKING_TARGET, BOOKING_URL, CAREERS_EMAIL };
