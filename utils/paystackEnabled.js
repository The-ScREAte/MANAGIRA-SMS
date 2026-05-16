// utils/paystackEnabled.js
// ============================================================================
// Paystack kill-switch.
//
// All Paystack code paths in this codebase are preserved (controllers, routes,
// jobs, EJS markup) because we will re-enable Paystack later. For now we want
// the entire app to act as if only Stripe exists, without ripping anything out.
//
// Behaviour when PAYSTACK_ENABLED is false (the current default):
//   * `effectiveBillingProvider(stored)` always returns 'stripe', so the
//     recurring billing job, plan-upgrade prorated charge, and the org-card
//     queries never look up Paystack-saved cards.
//   * `isPaystackEnabled()` returns false, which lets controllers/views hide
//     Paystack-specific UI (paystack-token card flow, MoMo selector, etc.).
//
// To re-enable Paystack later, set process.env.PAYSTACK_ENABLED=true (or flip
// the DEFAULT_PAYSTACK_ENABLED constant). No other code change is required.
// ============================================================================

const DEFAULT_PAYSTACK_ENABLED = false;

function isPaystackEnabled() {
  const raw = String(process.env.PAYSTACK_ENABLED || "").trim().toLowerCase();
  if (raw === "true" || raw === "1" || raw === "yes") return true;
  if (raw === "false" || raw === "0" || raw === "no") return false;
  return DEFAULT_PAYSTACK_ENABLED;
}

// Stripe is the default forced provider while Paystack is disabled.
const FORCED_PROVIDER_WHEN_DISABLED = "stripe";

function effectiveBillingProvider(storedValue) {
  if (!isPaystackEnabled()) return FORCED_PROVIDER_WHEN_DISABLED;
  return (storedValue && String(storedValue).trim().toLowerCase()) || "paystack";
}

module.exports = {
  isPaystackEnabled,
  effectiveBillingProvider,
  FORCED_PROVIDER_WHEN_DISABLED,
};
