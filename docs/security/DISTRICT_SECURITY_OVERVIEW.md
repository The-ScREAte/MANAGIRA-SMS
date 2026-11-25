# Managira security and privacy: answers for district reviews

Prepared for school district technology, security and privacy reviewers, and for completing their
questionnaires: the Student Data Privacy Consortium's National Data Privacy Agreement (NDPA,
including Exhibit F), HECVAT Lite, state student-privacy addenda, and district vendor
assessments. Each answer describes what the product does today. Items marked **In progress** are
built and waiting for a dated step listed at the end.

*Last reviewed: November 16, 2026. Contact: info@managira.com; security reports: security@managira.com.*

## 1. Company and certifications

| Question | Answer |
|---|---|
| Product | Managira, a student information system for K-12 schools and districts, operated by ScREAte. |
| SOC 2 / ISO 27001 | Not held. Managira's controls follow the NIST Cybersecurity Framework and are described below against the NDPA Exhibit F areas. |
| Independent penetration test | Not yet performed. Automated cross-school access tests check that one school can't reach another's records (`npm run security:cross-school`). A district that wants to test its own tenant should arrange it with Managira in writing first. |
| Privacy policy | managira.com/legal/privacy, last updated November 15, 2026: FERPA school official, COPPA, state laws, breach notification, retention and deletion. |
| NDPA | Ready to sign the SDPC National Data Privacy Agreement, including Exhibit E (general offer of terms) or a state-specific version. State answers (New York 2-d, Illinois SOPPA, California AB 1584): `docs/security/STATE_ADDENDA.md`. |
| Written security program | `docs/security/INFORMATION_SECURITY_PROGRAM.md` (NIST CSF), with the incident plan, retention schedule, deletion procedure and disaster recovery plan beside it. |
| Subprocessors | Published at managira.com/legal/subprocessors. |
| Vulnerability disclosure | managira.com/legal/security and `/.well-known/security.txt`; reports to security@managira.com. |
| Last code audit | November 16, 2026: every state-changing route checked for school and permission checks, unescaped output, single sign-on and transportation; every confirmed issue fixed and retested. |

## 2. Data ownership and use (NDPA Articles II–IV)

- The school or district owns its data. Managira acts as a **school official** with a legitimate
  educational interest under FERPA (34 C.F.R. § 99.31(a)(1)) and uses student data only to
  provide the service the school contracted for.
- No sale of student data, no targeted advertising, no profiles for non-educational purposes, and
  no use of student data to train artificial intelligence models.
- COPPA: for children under 13, the school provides consent on behalf of parents for
  educational use; Managira collects only what the service requires.
- Parents and eligible students request access or correction through their school; Managira
  helps the school respond.

## 3. Where data is stored

| Data | Location |
|---|---|
| Database | Render, Oregon, United States. Encrypted connections (TLS); encrypted at rest. |
| Uploaded and generated files | Amazon S3. **In progress:** moving from Ireland to Oregon (`docs/security/STORAGE.md`). |
| Backups | Render point-in-time recovery (United States); Managira's nightly encrypted backups to a private United States bucket (**In progress**: being turned on, `docs/BACKUPS.md`). |

## 4. Subprocessors

| Subprocessor | Purpose | Data |
|---|---|---|
| Render | Application and database hosting | All service data |
| Amazon Web Services | File storage (S3) | Uploaded and generated files |
| Namecheap Private Email | Sending email (codes, notices, report cards) | Recipient address and message |
| Stripe | Card and bank payments, when a school uses PayGira | Payer details; Managira stores no card numbers |
| Twilio | Text messages, when a school turns them on | Phone number and message |
| Meta (WhatsApp) | WhatsApp messages, when a school turns them on | Phone number and message |
| Anthropic, OpenAI | Mira, the staff assistant, when a school turns it on; never for parents or students | The staff member's question and the records Mira looks up for them; the providers' API terms exclude training on this data |
| Google, Microsoft | Google Classroom and calendar connections a school or person turns on | Only what that feature needs (see the privacy policy, section 9) |

A current list is available to schools on request. Bus maps use OpenStreetMap tiles; no student data is sent to draw them.

## 5. Access control (NDPA Exhibit F: Identify, Protect)

- **Roles and permissions.** Each person has a role (Manager, Supervisor, Teacher, Driver) and
  specific permissions; every request is checked on the server. Teachers see only their own
  classes and subjects. A person can give others only roles at or below their own and only
  permissions they hold. Managira's internal roles can never be given to a school account.
- **Tenant isolation.** The school is always taken from the sign-in, never from the request;
  records are checked against the signed-in school; file links work only for the school that
  owns the file.
- **Parents and students** use separate portals and see only their own children or themselves,
  and only what the school's class settings share.
- **Least privilege at Managira.** Access to customer data is limited to staff who support and
  secure the service; platform administrators can't sign in through a school's single sign-on.

## 6. Authentication

- **Single sign-on**: any SAML 2.0 or OpenID Connect identity provider, per school (for example
  Google, Microsoft Entra ID or ClassLink), including the district's own multi-factor
  authentication. A connection is tested before it can be turned on.
- **Password sign-in** is confirmed by a one-time code sent by email on every new browser,
  unless the school turns it off.
- **Two-step sign-in with an authenticator app** (TOTP, RFC 6238): any member of staff can turn
  it on; the school can require it for managers and supervisors, for all staff, or for one person
  (Settings, Tenant configuration; Edit user). Ten single-use recovery codes; a manager resets a
  lost phone with their own password; every change is in the activity log.
- Passwords: at least 10 characters (NIST SP 800-63B), never a commonly used one, their own name or email, or one found in a known data breach
  (checked by k-anonymity, so the password never leaves Managira), stored only as salted bcrypt
  hashes; reset links are single-use and expire in 15 minutes; a password change signs the
  person out everywhere.
- A single sign-on session ends when the browser closes.
- Repeated wrong passwords are slowed (never locked out), and each attempt is logged.
- Sessions end after 24 hours by default (the school can choose), and after 4 hours without
  activity; cookies are HttpOnly, Secure and SameSite.

## 7. Encryption

- In transit: HTTPS only, with HSTS; file storage will refuse any request that isn't HTTPS once
  its storage policy is applied (**In progress**).
- At rest: database encrypted by the host; files AES-256; nightly backups encrypted with
  AES-256-GCM before they leave the server; stored integration credentials and tokens encrypted
  with AES-256-GCM.

## 8. Files

- Student files (photos, signatures, report cards, transcripts, forms, documents) are private.
  They open only through a link Managira signs after checking who is asking, and the link works
  for 5 minutes. **In progress:** the storage policy that refuses every unsigned request
  (`docs/security/STORAGE.md`).
- Report cards sent by text use short links with 64 random bits that expire after 90 days.
- Gov/state reports a school sends to people outside it (a state or district data office) are
  never attached to email: each person gets a link with 256 random bits that works for 7 days
  and asks for a 6-digit code sent in a separate email (5 wrong codes lock it, 5 downloads at
  most). Only hashes of the link and code are stored; every send and download is logged.
- Uploads are size-limited, and programs and script files are refused.

## 9. Application security

- Protection against cross-site request forgery, clickjacking and content sniffing; escaped page
  output; parameterized database queries; request size and rate limits.
- Every public form (demo requests, online admission, school websites) uses Managira's own
  proof-of-work check and hourly limits, with no third-party challenge service.
- Automated tests and a dependency audit run on every change; Dependabot checks weekly. No known
  critical or high-severity vulnerabilities in dependencies (November 15, 2026).

## 10. Logging and monitoring (Detect)

- Activity log of sign-ins, permission and role changes, exports and significant actions,
  available to school administrators, kept 3 years.
- Security log of failed sign-ins and refused requests; health monitoring of the service.

## 11. Incident response and breach notification (Respond, Recover)

- Written incident response plan (`docs/security/INCIDENT_RESPONSE.md`): roles, containment,
  evidence, key rotation, recovery, review.
- The affected school is notified **within 72 hours** of confirming unauthorized access to its
  data, or sooner where its agreement or state law requires, with what happened, the data
  involved, the steps taken and a contact. Managira supports the school's notices to families.

## 12. Retention, return and deletion (NDPA Article IV, Section 6)

- A school can export its data at any time.
- At the end of the agreement, or on the school's written request, student data is deleted from
  active systems **within 60 days**, after the school has had the chance to export it. Encrypted
  backups expire in their normal cycle (30 days). Deletion is confirmed in writing on request.

## 13. Business continuity

- Render's point-in-time recovery (to any moment of the last days) and Managira's nightly
  encrypted backups kept 30 days outside Render, with a tested restore procedure.
- Deploys shut down gracefully; sessions are shared through the database.

## Steps that complete the "In progress" items

| Step | Owner | Guide |
|---|---|---|
| Deploy the current release | Managira | — |
| Make file storage private, then move it to the United States (same day as the deploy) | Managira | `docs/security/STORAGE.md` |
| Turn on nightly backups | Managira | `docs/BACKUPS.md` |
| Publish DKIM and enforce DMARC for managira.com | Managira | `docs/security/EMAIL_DNS.md` |
| Name the incident response team | Managira | `docs/security/INCIDENT_RESPONSE.md`, section 1 |
