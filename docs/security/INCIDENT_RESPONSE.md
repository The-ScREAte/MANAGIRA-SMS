# Security Incident Response Plan

Owner: Managira (ScREAte). Review this plan at least once a year and after every incident.
Last reviewed: November 15, 2026.

This plan covers any event that may expose, alter, or destroy student data or other personal
information, or that threatens the availability of the service: a compromised account, a leaked
key, unauthorized access to a database or file store, malware, a lost device with access, or a
report from a school, researcher, or vendor.

The Privacy Policy commits Managira to notify an affected school **no later than 72 hours after
confirming** an incident involving its data, or sooner where a school's agreement or state law
requires (for example, New York Education Law § 2-d requires notice to the school within 7
calendar days of discovery). Treat 72 hours from confirmation as the outer limit and notify
sooner whenever possible.

## 1. Roles

| Role | Responsibility | Person |
|---|---|---|
| Incident lead | Declares the incident, makes decisions, owns the timeline | _Name, phone_ |
| Technical lead | Investigates, contains, and fixes; preserves evidence | _Name, phone_ |
| Communications | Notifies schools, drafts notices, answers questions | _Name, phone_ |
| Legal counsel | Advises on notification duties and law enforcement | _Name, phone_ |

One person may hold more than one role. Keep this table current.

## 2. Severity

- **Critical**: student data confirmed accessed or taken by someone not authorized; a platform
  admin account or production secret compromised; the service down for all schools.
- **High**: suspected access to one school's data; a staff account taken over; a vulnerability that
  exposes data and is being actively exploited.
- **Medium**: a vulnerability that could expose data but shows no sign of use; a single account
  misused within its own access.
- **Low**: an attempt that was blocked (for example, repeated failed sign-ins).

## 3. Steps

### Detect and report (as soon as noticed)
Sources: the `[Security]` lines in Render logs (failed and slowed sign-ins, blocked cross-site
requests, school accounts carrying a platform role), the school activity log, alerts from AWS,
Render, or Stripe, and reports to info@managira.com. Anyone who suspects an incident tells the
incident lead immediately. Start an incident record (Section 5) with the time it was noticed.

### Triage (within 1 hour)
Confirm what is known: what systems, which schools, what data, since when, whether it is ongoing.
Assign a severity. For Critical or High, the incident lead declares an incident and assembles the
roles in Section 1.

### Contain (immediately for Critical and High)
Choose the steps that fit; record each with its time.
- **A staff account**: put the person on hold (Users / Employees), which ends their access on the
  next request, and reset their password.
- **All of one user's sessions**: delete that user's rows from the `user_sessions` table (match `sess->>'userId'`).
- **Everyone's sessions**: change `SESSION_SECRET` on Render and redeploy.
- **A platform admin account**: remove or lock it in the database and rotate every production
  secret below.
- **Leaked or suspected keys**: rotate them in the provider and update Render:
  database password (Render), `AWS_ACCESS_KEY_ID` / `AWS_SECRET_ACCESS_KEY` (AWS IAM),
  SMTP password, Stripe secret and webhook keys, `SETTINGS_ENCRYPTION_KEY` (re-save integration
  settings afterwards), `MIRA_SERVICE_TOKEN` (Mira), Google and Microsoft client secrets.
- **A vulnerable feature**: switch it off for everyone at `/admin/shards/features`, or deploy a fix.
- **A file exposed by link**: delete or replace the object in S3; for the private bucket, links
  expire within minutes on their own.

### Preserve evidence (before changing more than containment requires)
- Export Render logs for the affected period.
- Export the relevant school activity logs and `[Security]` log lines.
- Note the database recovery point (Render point-in-time recovery) from before the incident, and
  take a manual backup or snapshot if a restore may be needed.
- Keep copies of anything the attacker left (files, messages), and do not delete affected accounts
  until their records are saved.

### Eradicate and recover
Fix the cause (code, configuration, or credentials), confirm the fix, and restore data if needed
from Render point-in-time recovery or the encrypted backups (`docs/BACKUPS.md`). Watch logs closely
for at least 72 hours after recovery.

### Notify (no later than 72 hours after confirmation)
- **Affected schools**: email the school's main manager and any contact named in its data privacy
  agreement, using the template in Section 4. Call for Critical incidents.
- **Help schools notify families**: schools usually notify parents and students; give them the
  facts and a draft they can use.
- **Regulators and law enforcement**: counsel decides, based on state breach-notification laws and
  the schools' agreements. If law enforcement asks for a delay, record the request.
- **Vendors**: notify any provider whose service was involved.

### Review (within 14 days of closing)
Write what happened, the timeline, the cause, what worked, what did not, and the changes that will
prevent a repeat. Track each change to completion. Update this plan if needed.

## 4. School notification template

> Subject: Security incident notice from Managira
>
> We are writing to inform you of a security incident that affected [School name]'s data in
> Managira.
>
> **What happened.** On [date], we [discovered/were told] that [plain description]. The incident
> took place [between dates / on date].
>
> **Information involved.** [Types of data, for example student names and grades. Say what was
> not involved.]
>
> **What we have done.** [Containment and fixes, for example accounts locked, keys changed,
> vulnerability fixed.]
>
> **What we ask of you.** [Any steps for the school, and that we can help notify families.]
>
> **Contact.** [Name, email, phone], available to answer your questions.
>
> We are sorry this happened and are committed to protecting your school's information.

## 5. Incident record

Keep one record per incident for at least 3 years: incident ID, date and time noticed, who
reported it, severity, systems and schools affected, data involved, each action with its time and
who took it, evidence collected and where it is kept, notifications sent (to whom, when, how),
root cause, and follow-up actions with owners and due dates.

## 6. Testing

Walk through this plan with the people in Section 1 at least once a year using a realistic
scenario (for example, a leaked AWS key, or a staff account used to view another class), and
record what needed changing.
