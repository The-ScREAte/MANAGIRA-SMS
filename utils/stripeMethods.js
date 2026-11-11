"use strict";
// The ways parents can pay online through Stripe. What Managira's Stripe account has switched
// on is read from Stripe (its default payment method configuration, once an hour); each school
// then chooses which of those its parents see (PayGira › Settings, saved as `online_methods`
// in finance_psp_settings; never saved means all of them). Card is always offered.
//
// The parent's checkout and the PaymentIntent use the same list of types, so a method the
// school switched off can't be paid with even by a hand-made request. Apple Pay and Google Pay
// are card wallets: they ride on "card" and are shown or hidden in the form itself.
const Stripe = require("stripe");

const CATALOG = [
  { id: "card", label: "Card", detail: "Visa, Mastercard, American Express, Discover" },
  { id: "apple_pay", label: "Apple Pay", detail: "On iPhone, iPad and Safari on a Mac", wallet: "applePay" },
  { id: "google_pay", label: "Google Pay", detail: "On Android and Chrome", wallet: "googlePay" },
  { id: "link", label: "Link", detail: "Stripe's one-click checkout with saved details" },
  { id: "cashapp", label: "Cash App Pay", detail: "Pay from a Cash App balance or linked card" },
  { id: "us_bank_account", label: "Bank account (ACH)", detail: "Paid straight from a US bank account; takes a few days to clear" },
  { id: "amazon_pay", label: "Amazon Pay", detail: "With an Amazon account" },
  { id: "klarna", label: "Klarna", detail: "Pay in installments" },
  { id: "affirm", label: "Affirm", detail: "Pay over time, for larger amounts" },
  { id: "afterpay_clearpay", label: "Afterpay", detail: "Pay in four installments" },
];
const BY_ID = new Map(CATALOG.map((method) => [method.id, method]));

const HOUR = 60 * 60 * 1000;
const known = new Map(); // last characters of a key -> { at, ids }

// The method ids Managira's Stripe account has on. Unreadable: what was last seen, or just
// cards and their wallets (always safe to ask for), tried again in five minutes.
async function platformMethods(secretKey) {
  const key = String(secretKey || "").trim();
  if (!key) return new Set(["card"]);
  const tag = key.slice(-10);
  const seen = known.get(tag);
  if (seen && Date.now() - seen.at < HOUR) return seen.ids;
  let ids;
  let at = Date.now();
  try {
    const { data } = await new Stripe(key).paymentMethodConfigurations.list({ limit: 20 });
    const config = data.find((c) => !c.parent && c.is_default && c.active) || data.find((c) => !c.parent && c.active);
    ids = new Set(["card"]);
    if (config) {
      for (const method of CATALOG) {
        const entry = config[method.id];
        if (entry && entry.available && entry.display_preference && entry.display_preference.value === "on") ids.add(method.id);
      }
    }
  } catch (_) {
    ids = seen ? seen.ids : new Set(["card", "apple_pay", "google_pay"]);
    at = Date.now() - HOUR + 5 * 60 * 1000;
  }
  known.set(tag, { at, ids });
  return ids;
}

// The school's saved choice, or null when it never chose (then everything Stripe has on).
function chosenBy(pspSettings) {
  const raw = pspSettings && pspSettings.online_methods;
  if (!Array.isArray(raw)) return null;
  return raw.map((id) => String(id || "").trim().toLowerCase()).filter((id) => BY_ID.has(id));
}

// What a school's parents are offered.
function checkoutFor(available, chosen) {
  const picked = Array.isArray(chosen) ? new Set(["card", ...chosen]) : null;
  const on = (id) => available.has(id) && (!picked || picked.has(id));
  const offered = CATALOG.filter((method) => on(method.id));
  const types = offered.filter((method) => !method.wallet).map((method) => method.id);
  return {
    types, // payment_method_types of the PaymentIntent, paymentMethodTypes of the form
    selectedIds: offered.map((method) => method.id),
    paymentMethodOrder: types,
    expressWallets: { applePay: on("apple_pay") ? "auto" : "never", googlePay: on("google_pay") ? "auto" : "never" },
    expressMethods: { link: on("link") ? "auto" : "never", amazonPay: on("amazon_pay") ? "auto" : "never", paypal: "never" },
    displayLabels: offered.map((method) => method.label),
  };
}

// For the school's settings: every method Stripe has on, each with whether parents see it.
function choicesFor(available, chosen) {
  const picked = Array.isArray(chosen) ? new Set(["card", ...chosen]) : null;
  return CATALOG.filter((method) => available.has(method.id))
    .map((method) => ({ ...method, on: method.id === "card" || !picked || picked.has(method.id), fixed: method.id === "card" }));
}

// What a school saves: only ids Managira knows, card always.
function normalizeChoice(raw) {
  const list = Array.isArray(raw) ? raw : raw ? [raw] : [];
  return ["card", ...new Set(list.map((id) => String(id || "").trim().toLowerCase()).filter((id) => BY_ID.has(id) && id !== "card"))];
}

module.exports = { CATALOG, platformMethods, chosenBy, checkoutFor, choicesFor, normalizeChoice };
