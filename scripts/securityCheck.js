#!/usr/bin/env node
// Checks the protections listed in docs/SECURITY.md against a running server.
// Usage: node scripts/securityCheck.js [baseUrl]   (default http://localhost:4000)
// Safe to run against production: it only signs in with a fake .invalid account
// (which gets rate-limited for 15 minutes) and sends requests that are rejected.
"use strict";

const BASE = (process.argv[2] || process.env.SECURITY_CHECK_URL || "http://localhost:4000").replace(/\/$/, "");
const isHttps = BASE.startsWith("https://");
const results = [];

function record(name, ok, detail = "") {
  results.push({ name, ok, detail });
}

async function request(path, options = {}) {
  return fetch(BASE + path, { redirect: "manual", ...options });
}

function form(data) {
  return new URLSearchParams(data).toString();
}

(async () => {
  // 1. Security headers
  const home = await request("/account/login");
  const h = (name) => home.headers.get(name) || "";
  record("Header: X-Content-Type-Options nosniff", h("x-content-type-options") === "nosniff");
  record("Header: frame-ancestors (clickjacking)", /frame-ancestors/.test(h("content-security-policy")), h("content-security-policy"));
  record("Header: X-Frame-Options", /sameorigin/i.test(h("x-frame-options")));
  record("Header: Referrer-Policy", Boolean(h("referrer-policy")), h("referrer-policy"));
  record("Header: Permissions-Policy", Boolean(h("permissions-policy")));
  record("Header: no X-Powered-By", !h("x-powered-by"));
  if (isHttps) record("Header: Strict-Transport-Security (HTTPS only)", /max-age=\d+/.test(h("strict-transport-security")));

  // 2. Cross-site form posts are blocked; same-site ones are not
  const evil = await request("/account/login", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded", origin: "https://evil.example" },
    body: form({ email: "csrf-check@school.invalid", password: "x" }),
  });
  record("Cross-site POST blocked (403)", evil.status === 403, `status ${evil.status}`);
  const own = await request("/account/login", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded", origin: BASE },
    body: form({ email: "csrf-own@school.invalid", password: "x" }),
  });
  record("Same-site POST allowed", own.status !== 403, `status ${own.status}`);

  // 3. Session cookie flags (a failed sign-in stores a message, so a cookie is set)
  const cookie = (own.headers.get("set-cookie") || "");
  record("Session cookie HttpOnly", /httponly/i.test(cookie), cookie.split(";").slice(1).join(";").trim());
  record("Session cookie SameSite=Lax", /samesite=lax/i.test(cookie));
  if (isHttps) record("Session cookie Secure (HTTPS only)", /;\s*secure/i.test(cookie));

  // 4. Sign-in rate limit: 10 tries per account per 15 minutes
  const account = `ratelimit-${Date.now()}@school.invalid`;
  let lastStatus = 0;
  let blockedAt = 0;
  for (let i = 1; i <= 11; i += 1) {
    const r = await request("/account/login", {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded", accept: "application/json", origin: BASE },
      body: form({ email: account, password: `wrong-${i}` }),
    });
    lastStatus = r.status;
    if (r.status === 429 && !blockedAt) blockedAt = i;
  }
  record("Sign-in limited after 10 tries (429)", blockedAt === 11, `blocked at try ${blockedAt || "never"} (last ${lastStatus})`);

  // 5. Signed-out users can't reach staff, student or API pages
  for (const path of ["/common/orgDashboard", "/student/testing-room", "/account/settings", "/common/assessment/questions/bank"]) {
    const r = await request(path);
    const location = r.headers.get("location") || "";
    const ok = (r.status >= 300 && r.status < 400 && /login/i.test(location)) || r.status === 401 || r.status === 403;
    record(`Signed out: ${path} needs sign-in`, ok, `${r.status} ${location}`);
  }

  // 6. Webhooks reject unsigned calls
  const stripe = await request("/account/settings/finance/webhooks/stripe", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ type: "payment_intent.succeeded" }),
  });
  record("Stripe webhook rejects unsigned call", stripe.status >= 400, `status ${stripe.status}`);
  const paystack = await request("/account/paystack-webhook", {
    method: "POST",
    headers: { "content-type": "application/json", "x-paystack-signature": "0".repeat(128) },
    body: JSON.stringify({ event: "charge.success" }),
  });
  record("Paystack webhook rejects bad signature", paystack.status >= 400, `status ${paystack.status}`);

  // Report
  const width = Math.max(...results.map((r) => r.name.length));
  let failed = 0;
  for (const r of results) {
    if (!r.ok) failed += 1;
    console.log(`${r.ok ? "PASS" : "FAIL"}  ${r.name.padEnd(width)}  ${r.ok ? "" : r.detail}`);
  }
  console.log(`\n${results.length - failed}/${results.length} passed against ${BASE}`);
  process.exit(failed ? 1 : 0);
})().catch((error) => {
  console.error("Security check could not run:", error.message);
  process.exit(2);
});
