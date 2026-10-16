# Managira Security — Checklist

Every security item and its status.

- What each protection does: [SECURITY_IN_ALL.md](SECURITY_IN_ALL.md)
- Test results: [SECURITY_CONFIRMED_TESTED.md](SECURITY_CONFIRMED_TESTED.md)

**Status key**

| Mark | Meaning |
|---|---|
| ✅ | In place and tested |
| ☑️ | In place; verified in code, configuration or database |
| 🔵 | Planned |

*Last reviewed: 15 October 2026*

## Priorities

1. **Deploy and verify in production**: re-run the sign-in, header and cookie checks against the live site after each release.
2. **Make private files private**: apply the `migrations/` policy, then move signatures, photos and documents to signed links.
3. **Prove school data separation** across every read, edit, delete, export and download, then add database row-level security as a second layer.
4. **Protect privileged accounts** with two-step sign-in (MFA) for platform administrators and school owners.
5. **Test the attack surface** (APIs, uploads, file storage, Mira, payments) and commission an independent penetration test.
6. **Prove recovery** by restoring a backup of both the database and uploaded files.

## Overview

| # | Area | ✅ | ☑️ | 🔵 |
|---|---|---|---|---|
| 1 | School data separation | 5 | 2 | 6 |
| 2 | Sign-in and accounts | 4 | 8 | 3 |
| 3 | Sessions and cookies | 4 | 2 | 1 |
| 4 | Roles and permissions | 1 | 5 | 1 |
| 5 | Web protections and API limits | 9 | 5 | 6 |
| 6 | Files and uploads | 5 | 1 | 6 |
| 7 | Payments | 4 | 2 | 3 |
| 8 | Database, secrets and keys | 0 | 6 | 5 |
| 9 | Background jobs and Mira | 3 | 1 | 6 |
| 10 | Monitoring and incident response | 2 | 2 | 5 |
| 11 | Dependencies and delivery | 1 | 3 | 3 |
| 12 | Backups and recovery | 0 | 0 | 5 |
| 13 | Database row-level security | 0 | 1 | 3 |
| 14 | Hosting and uptime | 0 | 2 | 5 |
| 15 | Independent review | 0 | 0 | 2 |

---

## 1. School data separation

- ☑️ 135 of 218 tables carry the owning school's ID; the other 83 are platform-wide or linked through a parent record
- ✅ The school is taken from the sign-in; a school ID in the address bar is ignored
- ✅ Records are checked against the signed-in school (students, reports, transcripts, finance, invoices, receipts, terms, parents, admissions, tasks, files, tests)
- ✅ School-locked file storage
- ✅ Parents and students see only their own records
- ☑️ Code review of every update, delete and user-driven read for a school filter
- ✅ Automated cross-school test for owners, students and parents (`npm run security:cross-school`)
- 🔵 Destructive security tests (edits, deletes, account changes, row-level security) run only on a separate database copy
- 🔵 Extend the cross-school test to documents, staff profiles, messages, attendance, timetables, exports and downloads
- 🔵 Cross-school tests for edit and delete actions, including IDs sent in request bodies, run on a database copy
- 🔵 Cross-school tests for platform administrators and hub users
- 🔵 Run the cross-school test automatically against a test database before each release
- 🔵 Review every raw SQL report and export for school filters

## 2. Sign-in and accounts

- ☑️ bcrypt password hashing (cost 10, OWASP minimum)
- ✅ Session created only after the password matches
- ✅ Sign-in limits on every sign-in and password form
- ☑️ Visitor address taken from Cloudflare or the Render-added proxy entry
- ☑️ Fresh session ID at every sign-in
- ☑️ Random, hashed, single-use reset links that expire in 15 minutes
- ✅ Sign out everywhere on a password change or reset (staff, owners, parents, students, hub owners, hub users)
- ☑️ Password re-confirmation before switching schools
- ☑️ Suspended accounts and schools lose access automatically
- ☑️ Sessions of removed schools end
- ☑️ 4-hour idle timeout and 24-hour maximum session
- ✅ Security log of failed sign-ins and sign-in limits
- 🔵 Two-step sign-in (MFA) for platform administrators and school owners, plus re-confirmation for sensitive actions (payout details, large exports, security settings)
- 🔵 Account-recovery paths protected to the same standard as sign-in
- 🔵 Sign-in limits shared across servers (Redis) when more than one web server runs

## 3. Sessions and cookies

- ✅ HttpOnly cookie
- ✅ HTTPS-only cookie in production
- ✅ SameSite cookie
- ☑️ Session key held only in the server environment
- ☑️ Server-side session storage
- ✅ Signed-in pages sent with `no-store`; the service worker caches static files only
- 🔵 A "signed-in devices" page where users can sign out other devices

## 4. Roles and permissions

- ☑️ 21 role permissions guarding 239 routes
- ✅ Separate portals for staff, students, parents and drivers
- ☑️ Plan-based feature access
- ☑️ Platform admin area limited to Managira administrators
- ☑️ Separate hub owner and hub team rights
- ☑️ Text and WhatsApp shown only when switched on
- 🔵 Least-privilege review of every role and administrator permission

## 5. Web protections and API limits

- ✅ Cross-site request blocking (CSRF)
- ✅ Clickjacking protection
- ✅ HTTPS enforcement (HSTS)
- ✅ No content sniffing
- ✅ Private referrers
- ✅ Device permission policy
- ✅ Server software hidden
- ✅ Private error details
- ✅ Fair-use request limit per session and per network
- ☑️ No CORS headers
- ☑️ Clean question text
- ☑️ Escaped page output by default
- ☑️ Parameterized database queries
- ☑️ 10 MB request size limit
- 🔵 Full Content-Security-Policy for scripts (inline scripts moved to files first)
- 🔵 Review of every unescaped output (`<%- %>`), rich text and report template for XSS
- 🔵 Per-action limits on heavy work: large exports, bulk imports, PDF and report generation, searches
- 🔵 Per-school usage limits on paid services (SMS, email)
- 🔵 Request timeouts, pagination and maximum result sizes on list and search endpoints
- 🔵 Edge protection at the CDN layer (Cloudflare rate rules and bot protection)

## 6. Files and uploads

- ✅ Size limits on every upload
- ✅ Executable and script file types refused
- ✅ Clear upload messages
- ☑️ Report-card layouts can't be downloaded
- ✅ School migration files served through signed, expiring links
- ✅ Storage bucket contents can't be listed anonymously
- 🔵 Make the `migrations/` folder private after deploy (`node scripts/s3PrivateFolders.js --apply`)
- 🔵 Move signatures, staff and student photos, and documents to private storage served through signed links (logos and website media stay public)
- 🔵 File-content verification (not only the name and type), safe server-side file names, image-dimension limits
- 🔵 Per-school storage quotas
- 🔵 Malware scanning for risky uploads
- 🔵 Safe handling of archives (no extraction outside the target folder)

## 7. Payments

- ✅ Signed Stripe events with timestamp check
- ✅ Signed Paystack events (constant-time check)
- ☑️ No stored card numbers
- ☑️ Stripe idempotency keys on renewals, hub billing and payouts
- ✅ One renewal at a time per school
- ✅ Single payout run
- 🔵 Tests for duplicate webhook delivery, retries and provider timeouts
- 🔵 Every payment confirmed by a server-side check or webhook, never only the browser redirect
- 🔵 Cross-school tests for every payment, payout and subscription page

## 8. Database, secrets and keys

- ☑️ TLS-encrypted database connection
- ☑️ Database user is not a superuser and can't bypass row security
- ☑️ Keys held in the server environment
- ☑️ SMS and WhatsApp credentials encrypted (AES-256-GCM)
- ☑️ Internal Mira API protected by a service token
- ☑️ Local `.env` excluded from Git
- 🔵 Separate database users for the web app, worker and migrations, each with only the rights it needs
- 🔵 Retire the database referenced in early Git history and change its password
- 🔵 Scan logs, build artifacts and deployment settings for credentials
- 🔵 Key-rotation schedule for database, Stripe, Paystack, AWS and email keys
- 🔵 Confirm encryption at rest for the database and file storage, and set data-retention and secure-deletion rules for student records

## 9. Background jobs and Mira

- ✅ Each scheduled job runs one at a time across servers
- ✅ Reliable job locks
- ✅ Dedicated background worker available (`npm run worker`)
- ☑️ Mira usage tracked per school against limits
- 🔵 Idempotent job steps, with tests for recovery after a crash mid-run
- 🔵 Test that Mira returns only the signed-in user's school data
- 🔵 Treat uploaded documents and prompts as untrusted; prompts can't override access rules
- 🔵 Mira actions follow the same permissions as the app
- 🔵 Review URL-fetching features for server-side request forgery (SSRF)
- 🔵 Queued jobs carry a trusted school identity

## 10. Monitoring and incident response

- ✅ Security log (failed sign-ins, sign-in and request limits, blocked cross-site requests)
- ✅ Health check (`/health`)
- ☑️ Activity log, with entries older than 3 years removed weekly
- ☑️ Slow request and slow query logging available
- 🔵 Alerts for repeated failed sign-ins, refused cross-school requests, unusual exports, billing anomalies and resource spikes
- 🔵 One combined log of permission changes, exports and billing changes
- 🔵 Log access control and tamper protection
- 🔵 Written incident procedure: who responds, disabling compromised accounts, preserving evidence, rotating keys, notifying schools and regulators
- 🔵 Confirm the activity-log retention period meets legal and contractual needs

## 11. Dependencies and delivery

- ✅ Dependency audit with no critical issues
- ☑️ GitHub Actions on every push and pull request: unit tests, dependency audit (fails on critical), security module checks
- ☑️ Weekly Dependabot checks for the app and Mira
- ☑️ Every runtime package declared
- 🔵 Major-version upgrades for `puppeteer`, `nodemailer`, `http-proxy-middleware`, `sharp`, `exceljs` and `mammoth`, tested before release
- 🔵 Process and timeline for urgent security updates
- 🔵 Automated security scanning (static analysis) in GitHub Actions

## 12. Backups and recovery

- 🔵 Confirm daily Postgres backups, retention, point-in-time recovery and restricted backup access on Render
- 🔵 Restore a backup into a separate environment and record the time taken
- 🔵 Back up and restore-test uploaded files
- 🔵 Tested deployment rollback
- 🔵 Written recovery steps for web server and database outages

## 13. Database row-level security

- ☑️ The app's database user can't bypass row security
- 🔵 Set the school ID on each database connection per request
- 🔵 Turn on row-level security table by table, on a database copy first, using the same role and connection path as the live app
- 🔵 Run the cross-school test against the copy before going live

## 14. Hosting and uptime

- 🔵 Production verification after each deploy: sign-in, headers, cookies and HTTPS checked against the live site
- ☑️ Sessions shared through the database, ready for several servers
- ☑️ Graceful shutdown during deploys
- 🔵 Paid Render plan for the web service
- 🔵 Background worker on Render, with `RUN_SCHEDULED_JOBS=false` on web servers
- 🔵 Two web instances
- 🔵 Larger Postgres plan as usage grows

## 15. Independent review

- 🔵 Independent penetration test covering cross-school access, privilege escalation, account takeover, APIs, uploads and payments
- 🔵 Fix and retest all findings before making formal security commitments to schools or funders
