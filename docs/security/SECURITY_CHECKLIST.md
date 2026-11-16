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

*Last reviewed: 16 November 2026*

## Priorities

1. **Verify every release in production**: re-run `npm run security:check -- https://managira.com` after each deploy.
2. **Make storage private and move it to the United States**: the app now opens every private file through signed links; apply the bucket policy and the move (`docs/security/STORAGE.md`).
3. **Prove school data separation** across every read, edit, delete, export and download, then add database row-level security as a second layer.
4. **Protect platform administrators** with an authenticator app at sign-in. Schools already have it: each person can turn it on, and a school can require it for managers and supervisors, all staff, or one person.
5. **Test the attack surface** (APIs, uploads, file storage, Mira, payments) and commission an independent penetration test.
6. **Turn on nightly backups** (`docs/BACKUPS.md`) and prove recovery by restoring the database and uploaded files.

## Overview

| # | Area | ✅ | ☑️ | 🔵 |
|---|---|---|---|---|
| 1 | School data separation | 5 | 3 | 6 |
| 2 | Sign-in and accounts | 6 | 11 | 3 |
| 3 | Sessions and cookies | 4 | 3 | 1 |
| 4 | Roles and permissions | 2 | 5 | 1 |
| 5 | Web protections and API limits | 9 | 5 | 6 |
| 6 | Files and uploads | 8 | 3 | 5 |
| 7 | Payments | 4 | 2 | 3 |
| 8 | Database, secrets and keys | 0 | 7 | 5 |
| 9 | Background jobs and Mira | 3 | 2 | 5 |
| 10 | Monitoring and incident response | 2 | 6 | 4 |
| 11 | Dependencies and delivery | 2 | 5 | 3 |
| 12 | Backups and recovery | 0 | 2 | 5 |
| 13 | Database row-level security | 0 | 1 | 3 |
| 14 | Hosting and uptime | 1 | 2 | 5 |
| 15 | Independent review | 0 | 0 | 2 |

---

## 1. School data separation

- ☑️ 135 of 218 tables carry the owning school's ID; the other 83 are platform-wide or linked through a parent record
- ✅ The school is taken from the sign-in; a school ID in the address bar is ignored
- ✅ Records are checked against the signed-in school (students, reports, transcripts, finance, invoices, receipts, terms, parents, admissions, tasks, files, tests)
- ✅ School-locked file storage
- ✅ Parents and students see only their own records
- ☑️ Code review of every update, delete and user-driven read for a school filter
- ☑️ Audit of every state-changing route for school and permission checks (16 November 2026): cross-school writes in assessments, admissions, announcements and transportation closed; teachers kept to their own classes on the student, parent and bus pages
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
- ☑️ Emailed verification code on every password sign-in (unless the school turns it off); a right code remembers that browser for the school's chosen period (3 days by default)
- ✅ Two-step sign-in with an authenticator app (TOTP) for staff and school accounts: anyone can turn it on; a school can require it for managers and supervisors, all staff, or one person; 10 single-use recovery codes; a manager resets a lost phone with their own password
- ✅ Passwords found in known data breaches are refused (k-anonymity check: the password never leaves Managira)
- ☑️ Single sign-on (SAML 2.0, OpenID Connect) per school, tested before it can be turned on
- ☑️ The same reply whatever the email when someone asks for a password reset
- ✅ Security log of failed sign-ins and sign-in limits
- 🔵 Two-step sign-in for Managira platform administrators, plus re-confirmation for large exports
- 🔵 Account-recovery paths protected to the same standard as sign-in
- 🔵 Sign-in limits shared across servers (Redis) when more than one web server runs

## 3. Sessions and cookies

- ✅ HttpOnly cookie
- ✅ HTTPS-only cookie in production
- ✅ SameSite cookie
- ☑️ Session key held only in the server environment
- ☑️ Server-side session storage
- ✅ Signed-in pages sent with `no-store`; the service worker caches static files only
- ☑️ A single sign-on session ends when the browser closes (no Keep me logged in)
- 🔵 A "signed-in devices" page where users can sign out other devices

## 4. Roles and permissions

- ☑️ 21 role permissions guarding 239 routes
- ✅ Separate portals for staff, students, parents and drivers
- ☑️ Plan-based feature access
- ☑️ Platform admin area limited to Managira administrators
- ✅ Staff give only roles at or below their own and only permissions they hold; Managira's own roles can't be given to a school account, and a school account holding one is signed out (`tests/staffChangeGuard.test.js`)
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
- ✅ `migrations/` folder private on S3; files open only through signed links
- ✅ Every private file (photos, signatures, report cards, transcripts, form answers, sign-up documents, job applications) opened through a signed link that works for minutes, after a check of who is asking (`tests/storedFiles.test.js`)
- ✅ Text-message links to report cards: 64 random bits, expire after 90 days
- ☑️ File storage encrypted at rest (AES-256; SSE-C refused); access control lists off
- ☑️ New uploads named with a random part; sign-up documents in a private folder of their own
- 🔵 Apply the private bucket policy (only site pictures public, HTTPS only) and move storage to a United States bucket (`docs/security/STORAGE.md`)
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
- 🔵 Confirm encryption at rest for the database with Render (file storage confirmed: see section 6)
- ☑️ Student data returned or deleted within 60 days of a school's request or the end of its agreement (Privacy Policy, section 13)

## 9. Background jobs and Mira

- ✅ Each scheduled job runs one at a time across servers
- ✅ Reliable job locks
- ✅ Dedicated background worker available (`npm run worker`)
- ☑️ Mira usage tracked per school against limits
- 🔵 Idempotent job steps, with tests for recovery after a crash mid-run
- 🔵 Test that Mira returns only the signed-in user's school data
- 🔵 Treat uploaded documents and prompts as untrusted; prompts can't override access rules
- ☑️ Mira actions follow the same permissions as the app (`mira/services/access.js`)
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
- ☑️ Written incident procedure: who responds, disabling compromised accounts, preserving evidence, rotating keys, notifying schools and regulators (`docs/security/INCIDENT_RESPONSE.md`; fill in the people in Section 1)
- 🔵 Confirm the activity-log retention period meets legal and contractual needs
- ☑️ Schools told of a confirmed incident affecting their data within 72 hours (Privacy Policy, section 12; `docs/security/INCIDENT_RESPONSE.md`)
- ☑️ Published vulnerability disclosure policy (managira.com/legal/security) and `/.well-known/security.txt`
- ☑️ Refused requests are not written to the activity log as if they happened

## 11. Dependencies and delivery

- ✅ Dependency audit with no critical or high issues (3 low, in a holiday calendar package)
- ☑️ Install scripts run only for packages allowed by name (`allowScripts` in `package.json`)
- ✅ Patched HTML sanitizer loads on every supported Node version (bundled copy checked by a test)
- ☑️ GitHub Actions on every push and pull request: unit tests, dependency audit (fails on critical), security module checks
- ☑️ Weekly Dependabot checks for the app and Mira
- ☑️ Every runtime package declared
- ☑️ Puppeteer upgraded to 25 (PDF generation tested)
- 🔵 Major-version upgrades for `nodemailer`, `http-proxy-middleware`, `sharp`, `exceljs` and `mammoth`, tested before release
- 🔵 Process and timeline for urgent security updates
- 🔵 Automated security scanning (static analysis) in GitHub Actions

## 12. Backups and recovery

- ☑️ Nightly encrypted database backups (AES-256-GCM) to a private bucket of their own, kept 30 days; restore tested on the local copy (13 s, every table identical) (`docs/BACKUPS.md`)
- 🔵 Make the backup bucket (`scripts/s3BackupBucket.js`) and set `BACKUPS_ENABLED=true` in production
- ☑️ Render point-in-time recovery (3 days on Hobby, 7 days on Professional)
- 🔵 Restore a production backup into a separate database and record the time taken
- 🔵 Uploaded files versioned (kept 30 days after a change or deletion) once storage moves to the United States bucket
- 🔵 Tested deployment rollback
- 🔵 Written recovery steps for web server and database outages

## 13. Database row-level security

- ☑️ The app's database user can't bypass row security
- 🔵 Set the school ID on each database connection per request
- 🔵 Turn on row-level security table by table, on a database copy first, using the same role and connection path as the live app
- 🔵 Run the cross-school test against the copy before going live

## 14. Hosting and uptime

- ✅ Production verified after deploy: sign-in, headers, cookies, HTTPS and private files checked against managira.com
- 🔵 Run production on Node 24 LTS (set `NODE_VERSION=24` in Render; the app runs on 20.11 and 24)
- ☑️ Sessions shared through the database, ready for several servers
- ☑️ Graceful shutdown during deploys
- 🔵 Paid Render plan for the web service
- 🔵 Background worker on Render, with `RUN_SCHEDULED_JOBS=false` on web servers
- 🔵 Two web instances
- 🔵 Larger Postgres plan as usage grows

## 15. Independent review

- 🔵 Independent penetration test covering cross-school access, privilege escalation, account takeover, APIs, uploads and payments
- 🔵 Fix and retest all findings before making formal security commitments to schools or funders
