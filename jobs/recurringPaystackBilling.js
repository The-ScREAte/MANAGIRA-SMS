// Legacy compatibility shim.
// Recurring organization billing is Stripe-based and implemented in
// jobs/recurringStripeBilling.js.

module.exports = require('./recurringStripeBilling');
