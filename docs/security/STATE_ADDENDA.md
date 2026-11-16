# State addenda: ready-to-attach information

Districts in several states attach state-specific terms to their agreement (usually the SDPC
National Data Privacy Agreement, with Exhibit G or H for the state). This page holds Managira's
standard answers so they can be copied into those exhibits. The commitments match the Privacy
Policy. *Last reviewed: November 15, 2026.*

## New York: Education Law § 2-d and 8 NYCRR Part 121

New York districts attach their **Parents' Bill of Rights for Data Privacy and Security** and ask the
vendor to sign it and add this **supplemental information** (Part 121.3):

| Required item | Managira's answer |
|---|---|
| Exclusive purposes for which student data (or teacher/principal APPR data) will be used | Only to provide the student information system the district contracted for: records, grades, attendance, reports, family communication and the features the district turns on. Never sold, never used for advertising or marketing, never used to train AI models. |
| How subcontractors are held to these protections | Each subprocessor (listed at managira.com/legal/subprocessors) is bound by a written agreement to use the data only for its service and to protect it with safeguards at least as strong as Managira's. |
| Duration of the agreement and what happens to data at its end | The data is kept while the agreement lasts. At its end, the district exports what it needs, and Managira deletes the data from active systems within 60 days and confirms it in writing (docs/security/DATA_DELETION.md). Encrypted backups expire within 30 days. |
| How a parent, student, eligible student, teacher or principal may challenge the accuracy of the data | Through the district: the district corrects the record in Managira, or asks Managira to, and Managira assists within 30 days. |
| Where the data is stored and the security protections | In the United States (Render, Oregon, and Amazon Web Services, Oregon). Encrypted in transit and at rest, role-based access checked on every request, two-step sign-in, activity logs, nightly encrypted backups. |
| How the data will be protected using encryption | HTTPS (TLS) for every connection; AES-256 for stored files and the database host's encryption at rest; AES-256-GCM for backups and stored integration credentials. |

**Data security and privacy plan (Part 121.6):** Managira's plan is its
[written information security program](INFORMATION_SECURITY_PROGRAM.md), organized by the NIST
Cybersecurity Framework that Part 121 adopts, with the [incident response plan](INCIDENT_RESPONSE.md),
[data retention schedule](DATA_RETENTION.md) and [deletion procedure](DATA_DELETION.md). Staff
with access to student data are trained annually (Part 121.7). A breach is reported to the district
without unreasonable delay and within 72 hours of confirmation (stricter than Part 121.10's 7 days).

## Illinois: Student Online Personal Protection Act (SOPPA, 105 ILCS 85)

| Requirement | Where Managira meets it |
|---|---|
| Written agreement with the district, covering the categories of data, purposes and deletion | The NDPA with Illinois's Exhibit G; this page and the Privacy Policy supply the details |
| Publicly posted list of third parties that receive covered information | managira.com/legal/subprocessors |
| Reasonable security procedures | [INFORMATION_SECURITY_PROGRAM.md](INFORMATION_SECURITY_PROGRAM.md) |
| Breach notification to the district within 30 days | Within 72 hours of confirmation (Privacy Policy section 12) |
| Deletion within a reasonable time when the district asks or no longer needs the data | Within 60 days ([DATA_DELETION.md](DATA_DELETION.md)) |
| No sale, rental, targeted advertising or profiling | Privacy Policy sections 4 and 8 |

## California: Education Code § 49073.1 (AB 1584) and SOPIPA

| Contract term § 49073.1 requires | Managira's answer |
|---|---|
| Pupil records remain the property and under the control of the district | Yes (Privacy Policy section 1) |
| How pupils may keep pupil-generated content and transfer it | The district exports the student's work and records (reports, transcripts, Report Builder) and hands them to the student |
| Prohibition on using records for anything not required by the contract | Yes (Privacy Policy section 4) |
| How parents, guardians and pupils may review and correct records | Through the district, which controls the records (Privacy Policy section 14) |
| Actions taken to keep records secure, including training of staff | The written information security program; annual training |
| Breach notification to affected parents, guardians or pupils | Managira notifies the district within 72 hours and supports its notices to families |
| Records not kept after the contract ends | Deleted within 60 days, with written confirmation |
| How the district and vendor jointly comply with FERPA | Managira is a school official under 34 C.F.R. § 99.31(a)(1) and uses records only for the district (Privacy Policy section 5) |
| Prohibition on targeted advertising | Yes |

SOPIPA (Business and Professions Code § 22584): no targeted advertising, no profiling for
non-school purposes, no sale, reasonable security and deletion on request. All are in the Privacy
Policy.

## Other states

Colorado's Student Data Transparency and Security Act, Connecticut's Public Act 16-189, Texas
Education Code chapter 32 and Utah's Student Data Protection Act ask for the same core terms: use
only for the school, no sale or targeted advertising, security safeguards, breach notice, deletion,
and a public list of third parties. The answers above apply. Where a state sets a shorter breach or
deletion deadline in the district's agreement, Managira meets the shorter one.
