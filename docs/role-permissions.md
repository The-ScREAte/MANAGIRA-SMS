# Role permissions: what each role starts with

Everyone gets only what their job needs by default, and giving more is a deliberate step.

On **Add user** and **Edit user**, choosing a role switches on only that role's *basic* permissions, grouped in a few
bundles. Everything else sits behind **Advanced permissions**. The code is `utils/permissionBasics.js`, and
`tests/permissionBasics.test.js` keeps these rules true:

- Every basic is a real permission, and never without its main permission.
- No High Risk permission is a basic of any role except Manager.
- Whoever handles money has no staff access, settings or school-plan access.
- Teachers: their own classes only. No staff, finance, settings or website.
- Mira is a basic wherever the role may use her (a driver can't).
- Nothing is stored or checked differently. Only the screen, and the starting ticks for **new** people, changed.
  Existing staff keep exactly what they have (checked for every staff member on the local copy).

## The table

The first four are the roles built into Managira. The rest are jobs a school adds as **its own role** ("Add a role" on
the staff form, based on the account type shown). Each starts with these basics and can be saved with the permissions
ticked for it.

| Role | Based on | Basic permissions (follow-ups in brackets) | Why | Left to Advanced |
|---|---|---|---|---|
| Teacher | Teacher | Manage Students; Mark Attendance; Manage Assessments & Scores; Class Settings; Manage Reports/Printing (Terminal Reports); Use Mira (AI Assistant) | Their own classes: attendance, scores, their classes' settings, report cards, the student list (view only), Mira | Staff, finance, school settings, website, adding or changing students, messaging families |
| Supervisor | Supervisor | Manage Students (Add Students, Edit Students); Mark Attendance; Manage Assessments & Scores; Manage Reports/Printing (Terminal Reports); Publish Events & Announcements (Announcements, Events); Use Mira (AI Assistant) | Day-to-day oversight: students (not deleting), attendance, scores, report cards, announcements, Mira | Fees, staff, school settings, deleting students, promotions, transcripts, guardians |
| Manager | Manager | Users / Employees (Add Staff, Edit Staff & Access, Hold & Remove Staff) [high risk]; Manage Students (Add Students, Edit Students, Enrollment, Graduates & Alumni); Manage Classes & Subjects; Mark Attendance; Manage Assessments & Scores; Manage Reports/Printing (Terminal Reports, Report Settings); Publish Events & Announcements (Announcements, Events); Use Mira (AI Assistant) | Runs the school: staff, students, classes, academics, reports, announcements, Mira | Billing, settings, terms, promotions, PayGira, transportation and the rest: High risk - Managers only, and Advanced |
| Driver | Driver | The Driver dashboard (routes and riders) only | The driver app: their routes and riders | Everything else is chosen per driver (Lead Driver, rider details...) under Advanced |
| Class lead | Teacher | Manage Students (Edit Students); Mark Attendance; Manage Assessments & Scores; Class Settings; Manage Reports/Printing (Terminal Reports); Use Mira (AI Assistant); Mailroom | A teacher in charge of a class: also changes their students' details and messages their own families | Staff, finance, school settings, the school website |
| Office / registrar | Supervisor | Manage Students (Add Students, Edit Students, Enrollment, Graduates & Alumni); Manage Guardians; See Contacts (Edit Contacts); Approve Admissions; Generate Transcripts; Mailroom; Use Mira (AI Assistant) | Admissions, student and family records, transcripts and messages to families | Fees, staff, school settings, deleting students, promotions |
| Bursar / finance | Supervisor | PayGira (Classroom PayGira, Main PayGira); See Contacts; Mailroom; Use Mira (AI Assistant) | Bills, payments, overdue balances, and reminders to families. No staff access, no settings | Deleting bills, correcting payments, paying staff and vendors, payment settings, the school's plan (all high risk) |
| Transport lead | Driver | Lead Driver; Student Details; Pickup & Emergency; Any Route; Transportation (Buses, Manage Drivers, Routes & Stops, Schedules, Rider List, Student Stops & Routes, Driver Reports) | Leads the drivers: buses, routes, schedules and who rides | Transportation settings (high risk), everything outside transportation |
| Principal / head | Manager | Manage Students (Add Students, Edit Students, Enrollment, Graduates & Alumni); Manage Classes & Subjects; Mark Attendance; Manage Assessments & Scores; Manage Reports/Printing (Terminal Reports, Report Settings); Approve Promotions [high risk]; Manage School Years & Terms [high risk]; Publish Events & Announcements (Announcements, Events); Use Mira (AI Assistant) | Runs the school's academic year: students, classes, scores, report cards, promotions and terms | Fees, staff access, school settings, billing, integrations |

## How the screen behaves

1. Nothing shows until a role is chosen: *Choose a role to see its permissions.*
2. The role's basics are switched on, in at most 7 bundles (Students & families, Classes/attendance/assessments, Reports,
   Communication, Fees & payments, Transportation, Staff & school), each with one plain line.
3. **Advanced permissions** (collapsed; the open state is remembered for the session) holds everything else, grouped as before.
4. High-risk permissions show only for the Manager role, in a collapsed *High risk - Managers only* section. Someone who already
   holds one keeps seeing it, marked **Extra**, so nothing is hidden. The Advanced button counts extras ("Advanced permissions - 2 extra").
5. No descriptions: a name and a switch, with a divider after each.
6. **Allow all permissions** is only for Managers, only inside Advanced, and needs ALLOW ALL typed.
7. Changing the role switches at once and keeps every extra.
