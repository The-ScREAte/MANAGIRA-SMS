# Managira written information security program

Managira (operated by ScREAte) keeps this written program to protect the student, family and staff
information schools entrust to it. It meets the FTC's COPPA Rule (as amended in 2025) requirement
for a written information security program, and is organized by the five functions of the NIST
Cybersecurity Framework that the SDPC National Data Privacy Agreement (Exhibit F) and New York's
Part 121 refer to.

*Owner: Managira's security lead (named in [INCIDENT_RESPONSE.md](INCIDENT_RESPONSE.md), section 1).
Reviewed at least once a year and after any significant change or incident. Last reviewed:
November 15, 2026.*

## 1. Scope

All information schools and families put into Managira or that Managira creates for them: student
records, grades, attendance, files and photos, parent and staff contact details, payments
metadata, messages, and the logs of who did what. It covers the application, its database, file
storage, backups, email, and the outside services listed at
[managira.com/legal/subprocessors](https://managira.com/legal/subprocessors).

## 2. Roles

| Role | Responsibility |
|---|---|
| Security lead | Owns this program, the risk assessment, incident response and vendor reviews |
| Engineering | Builds and reviews changes against [SECURITY_CHECKLIST.md](SECURITY_CHECKLIST.md) and AGENTS.md |
| Support | Verifies who is asking before any account change; never shares data outside the school |
| Each school | Decides who in the school sees what (roles and permissions), and its sign-in rules |

## 3. Identify: risk assessment

- Once a year, and before any major feature, the security lead reviews: what data is held and where
  ([DATA_RETENTION.md](DATA_RETENTION.md)), who can reach it, the outside services, and the threats
  that matter most to schools (account takeover, one school reaching another's data, exposed files,
  lost backups, a vendor breach).
- Findings and fixes are tracked in [SECURITY_CHECKLIST.md](SECURITY_CHECKLIST.md).
- The district questionnaire answers live in [DISTRICT_SECURITY_OVERVIEW.md](DISTRICT_SECURITY_OVERVIEW.md).

## 4. Protect

**Access**
- Every request is checked on the server against the school's roles and permissions. A person can
  give others only roles at or below their own and only permissions they hold. A school's records
  are only ever read with that school's id from the sign-in, never from the request.
- Teachers work only on their own classes, and parents and students only on their own records.
- Managira staff reach school data only to support or secure the service. Their access is removed
  when no longer needed.

**Sign-in**
- Passwords are at least 10 characters, may not be common ones, their own name or email, or ones found in known data breaches, and are stored
  only as salted bcrypt hashes.
- Password sign-ins are confirmed with a code: emailed (unless the school turns it off), or from
  an authenticator app. A school can require the app for managers and supervisors, for all
  staff, or for one person.
- Schools can sign in through their own identity provider (SAML 2.0 or OpenID Connect), with that
  provider's two-step sign-in. Sessions end after the school's chosen time.

**Data**
- HTTPS everywhere, with HSTS. Database and files are encrypted at rest; nightly backups are
  encrypted (AES-256-GCM) before they leave the server.
- Student files open only through links that work for minutes.
- Integration credentials are stored encrypted.

**Development**
- Every change runs the automated tests and a dependency audit before release. Dependabot checks
  weekly, and security fixes are released promptly.
- New features reach the sandbox first and are released school by school.

## 5. Detect

- The activity log records sign-ins, permission and role changes, exports and significant actions,
  kept 3 years and shown to school administrators.
- A security log records failed sign-ins, slowed sign-ins and refused cross-site or cross-school
  requests.
- `/health` is monitored for uptime, and security reports from outside researchers are welcomed at
  security@managira.com ([managira.com/legal/security](https://managira.com/legal/security)).

## 6. Respond

- [INCIDENT_RESPONSE.md](INCIDENT_RESPONSE.md) is the written plan: who responds, how to contain
  (put accounts on hold, end sessions, rotate keys), preserve evidence, and recover.
- Affected schools are told within 72 hours of confirming unauthorized access to their data (or
  sooner where their agreement or state law requires), and Managira helps them notify families.

## 7. Recover

- [DISASTER_RECOVERY.md](DISASTER_RECOVERY.md) sets the recovery point and time objectives and the
  restore steps; a restore drill runs once a year.

## 8. Vendors

- Each outside service is bound by a written agreement to use school data only for its service and
  to protect it, and is listed publicly before it receives student data.
- The security lead reviews each vendor's security commitments once a year.

## 9. People

- Everyone at Managira with access to school data signs a confidentiality agreement and completes
  security and student-privacy training when they join and once a year.
- Background checks are completed where the law allows before access to student data is given.

## 10. Data lifecycle

- What is kept and for how long: [DATA_RETENTION.md](DATA_RETENTION.md).
- Return and deletion at the end of a school's agreement: [DATA_DELETION.md](DATA_DELETION.md).
- State-specific terms (New York, Illinois, California and others): [STATE_ADDENDA.md](STATE_ADDENDA.md).

## 11. Review

The security lead reviews this program, the risk assessment and the incident plan at least once a
year, and after any incident, and records the date above.
