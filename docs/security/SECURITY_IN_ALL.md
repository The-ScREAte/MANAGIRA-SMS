# Managira Security — In All

The protections that keep Managira, its schools and their data secure: what each one does, and how strongly it has been confirmed.

- Test results: [SECURITY_CONFIRMED_TESTED.md](SECURITY_CONFIRMED_TESTED.md)
- Status of every item, including planned work: [SECURITY_CHECKLIST.md](SECURITY_CHECKLIST.md)

*Last reviewed: 15 October 2026*

### Evidence levels

| Level | Meaning |
|---|---|
| **Tested** | Confirmed by an automated or recorded test (see [SECURITY_CONFIRMED_TESTED.md](SECURITY_CONFIRMED_TESTED.md)) |
| **Verified** | Confirmed by inspecting the code, configuration or database |
| **Implemented** | Present in the code; no dedicated test yet |

### Scope

These controls form Managira's security foundation. A passing test confirms the specific behavior it checks; it is not a guarantee against every possible attack. An independent penetration test is planned (see the checklist).

---

## Recent additions — 15 October 2026

| Protection | What it adds | Evidence |
|---|---|---|
| Security headers | Clickjacking protection, HSTS, `nosniff`, referrer and device-permission policies on every response | Tested |
| Cross-site request blocking | Refuses form posts and API calls that come from other websites | Tested |
| HTTPS-only session cookie | Session cookie limited to encrypted connections in production | Tested |
| Sign-in limits | Per-account and per-network limits on every sign-in and password form | Tested |
| Fair-use request limit | Caps requests per session and per network to protect shared capacity | Tested |
| Sign out everywhere | Ends an account's other sessions when its password changes or is reset | Tested |
| Upload limits | Size limits and blocked executable/script types on every upload | Tested |
| Private error details | Technical error details kept out of user-facing pages | Tested |
| Security log | Masked records of failed sign-ins, limits and blocked requests | Tested |
| Job locks and worker | One-at-a-time scheduled jobs and a dedicated background worker | Tested |
| No-store private pages | Every signed-in account type receives non-cacheable pages | Tested |
| Automated checks | GitHub Actions security workflow and weekly Dependabot checks | Implemented |
| Security test suite | `security:check` and `security:cross-school` commands | Tested |
| Signed links for school files | Migration files open through signed links that expire (5–60 minutes) | Tested |
| Private-folder policy tool | `scripts/s3PrivateFolders.js` makes chosen S3 folders private, with preview and restore | Implemented |

---

## 1. School data separation

| Protection | What it does | Evidence |
|---|---|---|
| School-tagged records | 135 of 218 tables carry the owning school's ID. The other 83 hold platform-wide data (plans, pricing, administration, hubs) or belong to a parent record that carries the school ID (for example, task comments, enrollments and test responses). | Verified |
| School taken from the sign-in | The school is read from the signed-in session. A school ID placed in the address bar is ignored. | Tested |
| Ownership checks on records | Students, report cards, transcripts, finance details, invoices, receipts, arrears reports, terms, parents, admissions, task comments, files, tests and question sets open only for their own school. Another school's record returns "not found" or is refused. | Tested |
| School-locked file storage | Migration files are stored in the school's own folder and open only for that school. | Tested |
| Portal boundaries | Parents see only their own children; students see only their own class, tests and results. | Tested |
| Approved tests only | Students can open only approved, active tests for their own class. | Verified |

## 2. Sign-in and account protection

| Protection | What it does | Evidence |
|---|---|---|
| Hashed passwords | Passwords are stored as bcrypt hashes (cost 10, OWASP minimum) and can't be read back. | Verified |
| Password confirmed before access | A signed-in session is created only after the password matches. A wrong password never opens an account. | Tested |
| Sign-in limits | Each account gets 10 tries per 15 minutes, and each network 300 (enough for a whole school on one connection). This covers school, parent, student and hub sign-in. Forgot-password: 5 requests per account. | Tested |
| Visitor address behind the proxy | Limits use the visitor's address as reported by Cloudflare (`CF-Connecting-IP`) or the last entry added by Render (`X-Forwarded-For`), which a visitor can't set. | Implemented |
| Fresh session at sign-in | Every sign-in gets a new session ID, which blocks session fixation. | Verified |
| Secure reset links | Reset links are random (32 bytes), stored hashed, expire after 15 minutes and work once. | Verified |
| Sign out everywhere on password change | A password change signs the account out on other devices; a reset link signs it out on all devices. This covers staff, school owners, parents, students, hub owners and hub users. | Tested |
| Password re-confirmation | Switching between schools asks for the password again. | Verified |
| Suspended accounts | Accounts and schools placed on hold lose access on their next request. | Verified |
| Removed schools | Sessions of a removed school are ended. | Verified |
| Session time limits | Users are signed out after 4 hours idle; every session ends after 24 hours. | Verified |

## 3. Sessions and cookies

| Protection | What it does | Evidence |
|---|---|---|
| HttpOnly cookie | Page scripts can't read the session cookie. | Tested |
| HTTPS-only cookie | In production the session cookie travels only over encrypted connections. | Tested |
| SameSite cookie | Browsers don't attach the session cookie to form posts from other sites. | Tested |
| Private signing key | Sessions are signed with a key held only in the server environment. | Verified |
| Server-side sessions | Session data is stored in the database, not the browser, and works across several servers. | Verified |
| Private pages not cached | Signed-in pages are sent with `Cache-Control: no-store`. The app's service worker caches only static files (styles, scripts, images), never pages. | Tested |

## 4. Roles and permissions

| Protection | What it does | Evidence |
|---|---|---|
| Role-based permissions | 21 permissions guard 239 routes, so staff can only do what their role allows. | Verified |
| Portal separation | Students, drivers and parents can't open staff pages. | Tested |
| Plan-based features | Paid features open only for schools whose plan includes them. | Verified |
| Platform admin area | Platform administration is limited to Managira administrators. | Verified |
| Hub team rights | Hub owners and hub team members have separate permissions. | Verified |
| Messaging channels | Text and WhatsApp appear only when the school switches them on. | Verified |

## 5. Web protections

| Protection | What it does | Evidence |
|---|---|---|
| Cross-site request blocking (CSRF) | Forms and API calls sent from other websites are refused, so another site can't act for a signed-in user. Managira's own domain and school subdomains are allowed. | Tested |
| Clickjacking protection | Only Managira can frame Managira pages (`frame-ancestors`, `X-Frame-Options`). | Tested |
| HTTPS enforcement | Browsers are told to always use HTTPS (HSTS, 180 days). | Tested |
| No content sniffing | Browsers treat files strictly as their declared type (`nosniff`). | Tested |
| Private referrers | Full page addresses aren't sent to other sites (`Referrer-Policy`). | Tested |
| Device permissions | Camera, microphone, location and payment features are allowed only on Managira's own pages. | Tested |
| Hidden server details | The server doesn't advertise its software. | Tested |
| No cross-origin reads | No CORS headers are sent, so other websites' scripts can't read Managira responses. | Verified |
| Clean question text | Test questions keep simple formatting (bold, italics, underline, line breaks, sub/superscript); all other HTML is removed. | Verified |
| Escaped page output | Page text is escaped by default (`<%= %>`), which blocks injected scripts. | Verified |
| Parameterized queries | Database queries pass values as parameters, which blocks SQL injection. | Verified |
| Private error details | In production, users see "Something went wrong"; technical details go only to the server log. | Tested |
| Request size limit | Requests are capped at 10 MB. | Verified |
| Fair-use request limit | Each signed-in session can make 600 requests a minute and each network 1,200 when signed out. Health checks and provider callbacks are exempt. | Tested |

## 6. Files and uploads

| Protection | What it does | Evidence |
|---|---|---|
| Size limits | Photos and logos 15 MB, migration files 25 MB, slideshow media 50 MB, imports 8–10 MB, legal documents 5 MB. Larger files are refused while uploading. | Tested |
| Blocked file types | HTML, JavaScript, PHP, executables, scripts and installers are refused. | Tested |
| Clear messages | Users see "That file is too large." or "That file type isn't allowed." | Tested |
| Protected report layouts | Report-card layouts can be viewed and printed, not downloaded. | Verified |
| Signed file links | School migration files are opened through signed links that expire after 5–60 minutes and are issued only to the owning school. | Tested |
| Bucket listing blocked | The storage bucket's contents can't be listed without credentials. | Tested |

## 7. Payments

| Protection | What it does | Evidence |
|---|---|---|
| Signed Stripe events | Stripe notifications are accepted only with a valid signature, which includes a timestamp check against replays. | Tested |
| Signed Paystack events | Paystack notifications are verified with HMAC-SHA512, using a constant-time comparison. | Tested |
| No stored card numbers | Card details are held by Stripe and Paystack, never by Managira. | Verified |
| Idempotent charges | School renewals, hub billing and payouts send Stripe idempotency keys, so a retried request doesn't create a second charge. | Verified |
| One renewal at a time | Each school's renewal is locked while charging and its due date re-checked inside the lock. | Tested |
| Single payout run | Payouts are processed by one run at a time. | Tested |

## 8. Database, secrets and keys

| Protection | What it does | Evidence |
|---|---|---|
| Encrypted database connection | The app connects to Postgres over TLS. | Verified |
| Non-superuser database account | The app's database user isn't a superuser and can't bypass row security. | Verified |
| Environment-held keys | Database, Stripe, Paystack, AWS, email and session keys live in the server environment, outside the code. | Verified |
| Encrypted provider keys | SMS and WhatsApp credentials are encrypted with AES-256-GCM. | Verified |
| Protected internal API | Mira's internal access requires a service token, checked in constant time. | Verified |
| Local secrets excluded | The local `.env` file is excluded from Git. | Verified |

## 9. Background jobs and Mira

| Protection | What it does | Evidence |
|---|---|---|
| One run at a time | Each of the 12 scheduled jobs (billing, payouts, email, digests, holds and others) holds a database lock while running, so two copies never run at once, including across servers. | Tested |
| Reliable locks | Each lock is taken and released on the same database connection, so it can't be left held. | Tested |
| Separate worker | Jobs can run on a dedicated worker, away from web traffic. | Tested |
| Mira usage limits | Mira tracks usage per school against set limits. | Verified |

## 10. Monitoring and records

| Protection | What it does | Evidence |
|---|---|---|
| Security log | Failed sign-ins, sign-in limits, request limits and blocked cross-site requests are written to the server log, with emails masked. Passwords and tokens are never logged. | Tested |
| Activity log | School actions are recorded. A weekly task deletes entries older than 3 years. | Verified |
| Performance logs | Slow requests and slow queries can be logged (`LOG_SLOW_REQUESTS`, `LOG_SLOW_DB_QUERIES`). | Verified |
| Health check | `/health` reports that the service is running. | Tested |

## 11. Software dependencies and delivery

| Protection | What it does | Evidence |
|---|---|---|
| Dependency audit | Production dependencies are audited with `npm audit`; no critical issues are open. | Tested |
| Automated checks on every change | GitHub Actions runs the unit tests, the dependency audit (fails on critical issues) and syntax checks of the security modules on every push and pull request. | Implemented |
| Weekly update checks | Dependabot checks the app and Mira for package updates every week. | Implemented |
| Complete runtime packages | Every package the app needs at runtime is declared. | Verified |

---

## Security checks

```bash
npm run security:check -- http://localhost:4000
npm run security:cross-school -- http://localhost:4000
npm test
npm audit --omit=dev
```

## Production settings

| Setting | Value |
|---|---|
| `NODE_ENV` | `production` |
| `SESSION_SECRET` | Long random value |
| `SETTINGS_ENCRYPTION_KEY` | 64-character hex value |
| `RUN_SCHEDULED_JOBS` | `false` on web servers when the background worker runs |
| `LOG_SLOW_REQUESTS` | `true` |
| `REQUEST_LIMIT_SIGNED_IN` / `REQUEST_LIMIT_VISITOR` | Optional; default 600 and 1,200 per minute |
