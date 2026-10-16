# Managira Security — Confirmed and Tested

The security tests run on Managira: how each was run and its result.

- All protections: [SECURITY_IN_ALL.md](SECURITY_IN_ALL.md)
- Status of every item: [SECURITY_CHECKLIST.md](SECURITY_CHECKLIST.md)

**Test date:** 15 October 2026

**Environment:**
- The current code, running locally against the live database.
- Email disabled; Stripe in test mode.
- Production-only settings tested with production mode switched on.

**Schools:** Managira Int. School (ID 63) and two other schools (IDs 146 and 157), which were only read.

All temporary sign-ins, sessions and test accounts were removed after testing.

**Production:** these results describe the current code. Production is confirmed by re-running the same checks against the live site after deploy.

**Scope:** each test confirms the behavior it checks. Together they give evidence for the controls listed, not a guarantee against every attack. Areas not yet covered are listed at the end.

## Results

| Area | Tests | Result |
|---|---|---|
| Web protections | 17 | ✅ All passed |
| School data separation, 63 → 146 | 21 | ✅ All passed |
| School data separation, 63 → 157 | 18 | ✅ All passed |
| School data separation, 146 → 63 | 19 | ✅ All passed |
| Sign-in with correct and wrong passwords | 4 | ✅ All passed |
| Sign out everywhere on password change | 7 | ✅ All passed |
| Fair-use request limit | 2 | ✅ All passed |
| Upload limits | 4 | ✅ All passed |
| Production cookies and HTTPS | 4 | ✅ All passed |
| Private error details | 1 | ✅ Passed |
| Security log | 2 | ✅ All passed |
| Background job locks | 4 | ✅ All passed |
| Background worker | 1 | ✅ Passed |
| Student exam page | 1 | ✅ Passed |
| File storage access | 3 | ✅ All passed |
| Unit tests | 55 | ✅ All passed |
| Dependency audit | 1 | ✅ No critical issues |

---

## 1. Web protections — 17 / 17

`npm run security:check -- http://localhost:4600`

| Check | Result |
|---|---|
| `X-Content-Type-Options: nosniff` | ✅ |
| `Content-Security-Policy: frame-ancestors` | ✅ |
| `X-Frame-Options: SAMEORIGIN` | ✅ |
| `Referrer-Policy` | ✅ |
| `Permissions-Policy` | ✅ |
| Server software hidden | ✅ |
| Form post from another website refused (403) | ✅ |
| Form post from Managira accepted | ✅ |
| Session cookie `HttpOnly` | ✅ |
| Session cookie `SameSite=Lax` | ✅ |
| 11th sign-in try within 15 minutes refused (429) | ✅ |
| Staff dashboard requires sign-in | ✅ |
| Testing Room requires sign-in | ✅ |
| Account settings require sign-in | ✅ |
| Question bank requires sign-in | ✅ |
| Stripe event without a signature refused | ✅ |
| Paystack event with a wrong signature refused | ✅ |

## 2. School data separation

`npm run security:cross-school -- http://localhost:4600 63 146`

**Method**
- The test signs in as an owner, a student and a parent from School A, then requests School B's records by ID.
- An attempt passes only if it is refused **and** none of School B's names appear in the response.
- **Controls:** each test sign-in must first open its own school's pages, which proves a refusal comes from the school check, not a failed sign-in.

| Who | Attempt | Response | Result |
|---|---|---|---|
| Anyone | Staff email with a wrong password | Returned to sign-in | ✅ |
| Anyone | Owner email with a wrong password | Returned to sign-in | ✅ |
| Owner | **Control:** own student profile | Opens (200) | ✅ |
| Owner | Own page sent with `Cache-Control: no-store` | Confirmed | ✅ |
| Student | **Control:** own Testing Room | Opens (200) | ✅ |
| Parent | **Control:** own dashboard | Opens (200) | ✅ |
| Owner | Other school's ID in the address bar | Own dashboard shown | ✅ |
| Owner | Other school's student profile | Not found | ✅ |
| Owner | Other school's student details | Not found | ✅ |
| Owner | Other school's report card | Not found | ✅ |
| Owner | Other school's student finance | Not found | ✅ |
| Owner | Other school's transcript | Not found | ✅ |
| Owner | Other school's term | Own terms shown | ✅ |
| Owner | Other school's invoice | Not found | ✅ |
| Owner | Other school's receipt | Not found | ✅ |
| Owner | Other school's arrears report | Not found | ✅ |
| Owner | Other school's uploaded file | Refused (403) | ✅ |
| Owner | Other school's question sets | Refused | ✅ |
| Student | Other school's test | Own Testing Room shown | ✅ |
| Parent | Other school's child report | Own reports shown | ✅ |
| Parent | Other school's report-card PDF | Not found | ✅ |

**More school pairs**
- **63 → 157:** 18 / 18 passed.
- **146 → 63:** 19 / 19 passed. This run also covered another school's parent profile (own list shown), admission (not found) and task comments (refused).

## 3. Sign-in — 4 / 4

| Test | Result |
|---|---|
| Staff email with a wrong password, then open the dashboard | ✅ Returned to sign-in |
| Owner email with a wrong password, then open the dashboard | ✅ Returned to sign-in |
| Temporary staff account with the correct password | ✅ Dashboard opens |
| Session after a correct sign-in | ✅ Holds the right user and school |

Other accounts on the same network can still sign in while one account is limited. The message reads "Too many attempts. Try again in 15 minutes."

## 4. Sign out everywhere on password change — 7 / 7

Tested with temporary sessions for accounts that don't exist.

| Case | Expected | Result |
|---|---|---|
| Staff changes their own password | Other devices signed out; current device kept | ✅ |
| School owner reset | Owner signed out; other staff kept | ✅ |
| Student reset | Student signed out | ✅ |
| Parent reset | Parent signed out | ✅ |
| Hub owner reset | Owner signed out; hub team kept | ✅ |
| Hub user reset | That hub user signed out | ✅ |
| Remaining sessions | Only the expected sessions remain | ✅ |

## 5. Fair-use request limit — 2 / 2

A separate server ran with the signed-out limit lowered to 20 requests a minute.

| Test | Result |
|---|---|
| 25 requests in a row | ✅ First 20 served, next 5 refused (429) and logged once |
| `/health` while limited | ✅ Still served |

## 6. Upload limits — 4 / 4

| Upload | Result |
|---|---|
| 1 MB photo | ✅ Accepted |
| `page.html` | ✅ Refused: "That file type isn't allowed." |
| `tool.exe` | ✅ Refused: "That file type isn't allowed." |
| 16 MB photo (limit 15 MB) | ✅ Refused: "That file is too large." |

## 7. Production cookies and HTTPS — 4 / 4

Production mode, request sent the way Render sends it (HTTPS, `managira.com`):

```
Strict-Transport-Security: max-age=15552000
Set-Cookie: connect.sid=…; Domain=.managira.com; Path=/; HttpOnly; Secure; SameSite=Lax
```

| Check | Result |
|---|---|
| `Secure` | ✅ |
| `HttpOnly` | ✅ |
| `SameSite=Lax` | ✅ |
| HSTS | ✅ |

## 8. Private error details — 1 / 1

In production, a database error returned only:

```
500 {"status":500,"message":"Something went wrong. Please try again."}
```

## 9. Security log — 2 / 2

| Event | Logged |
|---|---|
| Failed sign-in | ✅ `{"event":"sign_in_failed","form":"login","account":"cs***@school.invalid", …}` |
| Sign-in limit reached | ✅ `{"event":"sign_in_rate_limited", …}` |

Email addresses are masked; passwords and tokens are never written.

## 10. Background job locks — 4 / 4

| Case | Result |
|---|---|
| Same job started twice at once | ✅ One ran, the other skipped |
| Job runs again after the first finishes | ✅ |
| Payout and email job locks | ✅ Taken and released |
| Locks held afterwards | ✅ None |

## 11. Background worker — 1 / 1

`npm run worker` starts, keeps running and stops cleanly. ✅

## 12. Student exam page — 1 / 1

A student opens a test on desktop with the new headers and limits in place, with no page errors. ✅

## 13. File storage access — 3 / 3

| Test | Result |
|---|---|
| Signed link to a school migration file | ✅ File served (206) |
| Migration page renders with signed links | ✅ Opens (200) |
| Anonymous listing of the bucket | ✅ Refused (403) |

## 14. Unit tests — 55 / 55

`npm test` passes, including the billing tests. ✅

## 15. Dependency audit

`npm audit --omit=dev` reports no critical issues. Open high and moderate issues, and their upgrade plan, are tracked in the checklist. ✅

---

## Not yet covered by tests

Tracked in [SECURITY_CHECKLIST.md](SECURITY_CHECKLIST.md):

- Cross-school tests for documents, staff profiles, messages, attendance, timetables and exports.
- Cross-school tests for edit and delete actions (to be run on a database copy).
- Mira data access by school.
- Duplicate webhook delivery and provider timeouts.
- Job recovery after a crash mid-run.
- Backup restore.

## Re-run the tests

```bash
npm run security:check -- http://localhost:4000
npm run security:cross-school -- http://localhost:4000 63 146
npm test
npm audit --omit=dev
```
