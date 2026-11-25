# Managira menu map

Every menu and menu item, by kind of user. Built from the code (header, hubs, page finder, views) and checked in a browser on the local copy (org 63) as: manager (user 240), teacher (299), supervisor (241), parent (guardian 30181), student (10181) and driver (243).

How to read it
- **Icon** is the name in `utils/navIcons.js` (a line icon on a 24px grid). Where a menu draws its own picture, it says so: "FA" = a Font Awesome icon (`fa-...`), "inline" = a small SVG written in the page, "image" = a picture file.
- **Shown when** says what gates the item: a permission name, a plan feature, a feature flag released to the school, a school setting, or an integration that must be on.
- "Observed" means it was seen in the browser in org 63. "From code" means org 63 does not have it on (transport and Text/WhatsApp-gated screens, and so on), so it is read from the code only.
- Permissions are per person. Teachers and supervisors start from the defaults in `middleware/permissionMiddleware.js` and a manager can tick more or fewer, so what a real teacher sees can differ from the defaults.

---

# 1. Organization staff: Manager (and what every staff member shares)

## 1.1 Top bar (every signed-in staff page)

| Item | Icon | What it does | Shown when |
|---|---|---|---|
| School logo and name | school logo image | Goes to the dashboard. | Always. Parents with several schools see overlapping logos instead. |
| Search anything | inline magnifier | Searches people and records as you type. | Every role except parent. Folds into an icon on phones. |
| Hello, (first name)! | none | Greeting. | Always. |
| Mira | image (Mira logo) | Opens the Mira assistant beside the page. Ctrl or Cmd click opens it full page. | Mira is offered to the school. Without "Use Mira" it explains how to get it. |
| Help | inline circle with question mark | Opens a small help menu. | Always. |
| - Guides | inline open book | Opens the step-by-step help in a new tab. | Always. |
| - Send feedback | inline speech bubble | Opens Settings, Feedback. | Staff only (never parent, student, driver). |
| - Your access | inline shield | Shows your role, classes and what you can do. | Staff whose account type is not Organization (the owner). |
| - Two-step sign-in | inline phone | Opens Settings, Two-step sign-in. | Feature `sign_in_authenticator`, and a manager or someone with `manage_settings`. |
| Notifications | inline bell | Opens the notification list, with an unread count badge. | Always. |
| - Mark all read | inline double tick | Marks every notification as read. | Inside the bell panel. |
| - Clear all | inline trash can | Removes every notification. | Inside the bell panel. |
| Menu (three bars) | none | Opens the main menu below. | Always. |
| Page finder (Ctrl K or Cmd K) | per group (see 1.11) | Jumps to any page this person can open. | Staff and drivers. Only offers pages the person is allowed into. |

## 1.2 Main (hamburger) menu

| Item | Icon | What it does | Shown when |
|---|---|---|---|
| Management Tools | management | Opens the Management hub. | The person has at least one Management item (`workspaceAccess().management.any`). |
| School Website | website | Opens the public school site in a new tab. | Plan feature School Website. |
| Mailroom | mailroom | Opens the message centre (text, WhatsApp, email). | Permission `mailroom`. |
| Calendar | calendar | Opens the school calendar. | Signed in to a school, not parent or student. |
| Birthdays | birthdays | Lists today's and this week's birthdays. | Always for staff. |
| Admissions | addStudent | Opens the Admissions hub. | Any Admissions item, plus plan feature Student and Guardian Profile. |
| Reports | reports | Opens the Reports hub. | Any Reports item, plus a report plan feature (Terminal Report, Progressive Student Report, Class Base Merit Sheet or Official School Transcript). |
| Sandbox (switch) | sandbox (flask) | Turns the data-migration sandbox on or off, after a question. | Managers, once Managira has opened the sandbox for the school. |
| Open data migration (link under the switch) | none | Opens Data migration. | Only while the sandbox is on. |
| Settings | settings | Opens Settings. | Always. |
| Logout | logout | Signs out. Drawn in red. | Always. |
| Hello, (name)! (first row) | none | Greeting row. | Phone width only. |

Other versions of this menu
- School on hold: only Settings and Logout.
- Hub account (a hub's own login): Dashboard (dashboard), Settings (settings), Logout (logout).
- Observed for the manager in org 63: Management Tools, School Website, Mailroom, Calendar, Birthdays, Admissions, Reports, Settings, Logout (9 items; the Sandbox switch was not offered).
- At 390px wide the same items appear, with the greeting as the first row. There is no bottom tab bar anywhere in the app.

## 1.3 Dashboard (Org Dashboard, `/common/orgDashboard`)

A new school that has not personalised yet is sent to First-time setup (`/common/first-setup`) instead.

| Item | Icon | What it does | Shown when |
|---|---|---|---|
| Org Dashboard (button) | none | The current page marker. | Always. |
| School Website (button) | none | Opens the public site in a new tab. | Plan feature School Website. |
| Quick actions (menu) | FA fa-bolt | Lists shortcuts; the ones you use most move to the top. "Show all N" expands it. | Needs a current school year and term. |
| - New task | FA fa-square-check | Adds a calendar task. | Workspace members. |
| - Calendar | FA fa-calendar-days | Opens the calendar. | Always. |
| - Add student | FA fa-user-plus | Opens the add-student form. | `manage_students`. |
| - All students | FA fa-user-graduate | Opens the student list. | `manage_students`. |
| - Transport | FA fa-bus | Opens Transportation. | `manage_transportation` (transport must be on). From code. |
| - Admissions | FA fa-inbox | Opens Admissions. | `approve_admissions` and plan feature Student and Guardian Profile. |
| - Add staff | FA fa-id-badge | Opens the add-user form. | `manage_employees`. |
| - Management | FA fa-users-gear | Opens Management. | `manage_employees`. |
| - Events & announcements | FA fa-calendar-plus | Opens that panel in Management. | `publish_events_announcements`. |
| - Fees & payments | FA fa-wallet | Opens PayGira. | `paygira_workspace` and plan feature PayGira. |
| - Overdue fees | FA fa-file-invoice-dollar | Opens PayGira, Overdue. | `paygira_recovery` (with the item above). |
| - Send a message | FA fa-paper-plane | Opens the Mailroom composer. | `mailroom`. |
| - Reports | FA fa-chart-column | Opens Reports. | `manage_reports` and a report plan feature. |
| - School years & terms | FA fa-calendar-days | Opens that Management panel. | `manage_records`. |
| - Classes & subjects | FA fa-chalkboard | Opens that Management panel. | `manage_classes_subjects`. |
| - My profile & settings | FA fa-user-gear | Opens Settings. | Always. |
| Customize | FA fa-sliders | Tick which dashboard cards show; at least 3 must stay on. | Same as Quick actions. |
| Enrolled classes card | FA fa-chalkboard-user | Lists classes, their teachers, and "Add a teacher" or "No main teacher, choose one" links. | Always. Teachers see only their own classes. |
| Current school year card | FA fa-calendar | Term progress and next-term shortcut. | Always. |
| Admissions waiting (number tile) | FA fa-inbox | Links to Admissions. | Observed for manager only. By permission. |
| Attendance today (number tile) | FA fa-clipboard-check | Shows today's attendance rate. | Observed for manager only. By permission and the school's Attendance switch. |
| Fees collected this term (number tile) | FA fa-wallet | Links to PayGira. | Observed for manager only. By PayGira permission. |
| Events card | FA fa-calendar | Upcoming events. | Always. |
| Activity & announcements card | FA fa-bolt | Feed of posts, with an "Assigned to you" part. | Always. |
| Needs attention card | FA fa-bell | Things waiting on this person. | Always. |
| Recent activity card | FA fa-clock-rotate-left | Who did what lately. | Always. |

Observed for the manager: 15 quick actions (no Transport; transport is off in org 63).

## 1.4 Management hub (`/common/management`; sidebar is titled "Workspace")

Sidebar controls: Arrange this menu (up-down arrows glyph, per person; "Reset" restores the order), Collapse sidebar (panel glyph), and a "Menu" button on phones that opens the sidebar as an overlay.

| Item | Icon | What it does | Shown when |
|---|---|---|---|
| School years & terms | schoolYears | Make school years and name terms. | `manage_records` or `manage_school_year_terms`. |
| Classes & subjects | classesSubjects | Add classes, subjects and graduation years. | `manage_classes_subjects`. |
| Class & notif. settings | settings | Per-class switches, what families see, weekly briefing. | `class_settings_all` and feature `class_settings`. Teachers see their own classes inside the class instead. |
| Assessments | grading | Set up assessments and see scores. | `manage_assessments` and plan feature Assessment Tracking. |
| Assessment questions | questions | Write online test questions. | `set_assessment_questions`, plan feature Set Assessment Questions, and the Google Classroom or Student Portal integration on. |
| Enrollment | enrollment | Put students into classes for a term. | `students_enrollment` and plan feature Student and Guardian Profile. |
| Promotion | promotion | Move students up a grade or repeat. | `approve_promotions`. |
| Users / Employees | staff | Add staff and set roles and permissions. | `manage_employees`. |
| Parents & guardians | guardians | Look after parent records and portal access. | `manage_guardians` and plan feature Student and Guardian Profile. |
| Contact template | contactTemplate | Old home of the guardian contact fields. | Never shown now (forced off). It moved to Admissions, Admission Settings. |
| Transportation | transportation | Opens bus, driver, route and rider tools. | Transportation integration on and `manage_transportation`. From code. |
| Transportation "Turn on" (greyed) | transportation | Takes you to Integrations to switch transport on. | Transportation integration off and `settings_integrations`. Observed. |
| Mira (AI Assistant) "Turn on" (greyed) | mira | Takes you to Integrations to switch Mira on. | Mira integration off and `settings_integrations`. From code. |
| Mira (AI Assistant) | mira | Choose who can open Mira. | Mira integration on and `settings_mira`. |
| Events, announcements & activities | announcements | Publish events, notices and class activities. | `publish_events_announcements`. |
| School website | website | Edit the public website. | Plan feature School Website and `settings_website`. |
| Data migration | enrollment | Ask to move data in from another system. | Managers when offered, or while the sandbox is on. |
| Custom editor | forms | Build the school's own forms and records. | `custom_forms`. |
| Docs & sheets | docs | Documents and spreadsheets. | Manager or supervisor roles, or `manage_records`, plus plan feature Create Files. |
| PayGira | paygira | Opens the PayGira hub (section 1.7). | `paygira_workspace`, `paygira_show_in_management`, plan feature PayGira, and not hidden by a hub. |
| Integrations | integrations | Connect outside services. | `settings_integrations`. |
| Service accounts | serviceAccounts | API keys for other software. | `settings_service_accounts`. |
| Email issues | emailIssues | Emails that bounced, with a red count. | Organization, admin, mini admin, supervisor, manager roles. |

Observed for the manager: 20 items (the "Transportation Turn on" row replaces Transportation; no Mira "Turn on" row because Mira is on).

What is inside each Management panel (observed unless marked)
- School years & terms: New school year, a "Term names" list, a three-dot menu per year, Remove, Save Changes.
- Classes & subjects: three blocks, Classes, Dashboard Class Arrangement, Subjects; buttons Add new, three-dot menus, Update All Classes, Update All Subjects.
- Class & notif. settings: cards School (Attendance and Lunch switches), Classes (an "all classes" row plus one row per class), Weekly briefing. Per-class switches: Take lunch, Student portal, then a share switch for Parents and for Students on each of Attendance, Lunch, Report cards, GPA, Bus & transport, Student files, Portfolio, Alerts, Teacher's email, Teacher's phone, Teacher's About me, plus absent and late notices and lock icons. Weekly briefing sections: Attendance, Lunch, New grades, Bus, Daily class records, Forms to fill in, Payments (parents only), Tests coming up, Class activities, School events.
- Users / Employees: Filters, Add user, Put in charge, sortable table.
- Mira: "Mira information" and "Who can open Mira".
- Events, announcements & activities: tabs Events, Activities, Announcements; New Event.
- School website: Website setup, Page Sections & Order, About & contact details, Website design, Light or dark, Photos & videos, Website Sections, Contact Form & Messages, News.
- Custom editor: New section opens the library: Report card (Skills & effort, Student reflection, Report remarks), Health (Medical & allergies, Medication authorization, Immunization record, Health office visit), Permissions (Field trip permission, Photo & media consent, Handbook acknowledgement, Device agreement), Requests from parents (Absence note, Early dismissal request, Meeting request), Every day in class (Lunch count, Seating chart, Student groups, Lunch order), Classroom records (Behavior log, Reading log, Support plan), Sign-ups & surveys (Club & sports sign-up, Volunteer sign-up, Family survey). Each section is filled by Classroom, Parent portal, Student portal or Driver portal. Field types: Text single line, Text multiple lines, Number, Date, Time, Yes / No, Dropdown list, Checklist, Rating, Email, Phone, Link, File upload, Signature, Seat, Instructions. ("Lunch count" is hidden from the library when the school's Lunch switch takes lunch.)
- Data migration: a request form (current system, what to bring, when, who to contact).
- Integrations (11 cards, each with a three-dot menu): Student Portal, Parent Portal, Mira (AI Assistant), Transportation, Google Maps, Maps, Google Classroom, Twilio SMS, Arkesel SMS, Africa's Talking SMS, WhatsApp Business. Text and WhatsApp screens in Mailroom and elsewhere only appear when a text or WhatsApp card is activated.
- Service accounts: list of API accounts.
- Email issues: failed addresses, or "All emails are working".

## 1.5 Admissions hub (`/common/admissions`)

| Item | Icon | What it does | Shown when |
|---|---|---|---|
| All Students | students | The student list, with Edit student and Bulk edit. | `manage_students` and plan feature Student and Guardian Profile. |
| Add Student | addStudent | Enrol a new student (sections: Enrollment, Student information, Academic placement, Subjects, Photo, Files, Guardian details). | `students_add` and the same plan feature. |
| Online Applications | applications | Applications sent from the school website. | `approve_admissions`, plan features Profile and School Website. |
| Former Students (group) | graduation | Opens the two items below. | `students_alumni` or `manage_school_year_terms`. |
| - Graduate & Withdraw | leaveSchool | Close a graduation group or withdraw students. | `manage_school_year_terms`. |
| - Graduates & Alumni | alumni | Past students. | `students_alumni`. |
| Admission Settings | sliders | Tabs: Online admission, Student fields, Parents & guardians. | `settings_admissions` or `edit_contact_template`. |

## 1.6 Reports hub (`/common/reports`)

| Item | Icon | What it does | Shown when |
|---|---|---|---|
| Organization Stats | stats | Charts: academics, this term, enrollment and staff. | `manage_records` and plan feature Organization Analytics & Insights. |
| Term Reports (group) | termReports | Opens the three items below. | Any of them. |
| - Terminal reports | reportCard | Prepare and print report cards. | `reports_terminal` or `manage_school_year_terms`, and a term-report plan feature. |
| - Transcript | transcript | Official transcripts. | `generate_transcripts` and plan feature Official School Transcript. |
| - Report Settings | sliders | Sections: Report Card Layout, Report remarks, Signature Management, Transcript Design. | `reports_settings` and a term-report plan feature. |
| Report Builder | reportBuilder | Five steps: Select report, Columns, Criteria, Run report, Save / export (Excel, Word, CSV, Template; Share, Schedule, Gov/state report, Import). | `reports_builder`. |

Report Builder report kinds (12): Students, Admissions & enrollment, Assessments, Merit sheet, Attendance, Parents & guardians, Parent messages, Messages sent, Staff, Fees & payments, Announcements & events, Activity log. Some columns need transport, fees or attendance to be on.

## 1.7 PayGira hub (`/account/settings/finance`; also reached from Management, the dashboard and Settings)

Each place shows when the person holds any of its pages; each page has its own permission and all need `paygira_workspace`.

| Item | Icon | What it does | Shown when |
|---|---|---|---|
| Overview | overview | Collected, owed, latest payments, charts. | `paygira_overview`. |
| Bills | bills | School bills. Tabs: All bills, Repeating. | `paygira_bills` (All bills) and `paygira_subscriptions` (Repeating). |
| - New bill (button) | none | Opens the bill form; "More options" holds note, how often (Once, Repeating, In installments), repeat period. | `paygira_bills`. |
| Student ledger | orgBills | What each student owes. Tabs: Balances, Overdue. | `paygira_org_bills` (Balances) and `paygira_recovery` (Overdue). |
| - Overdue tab tools | none | Filters, saved filters, Save a report, Email all parents, Email their parents. | `paygira_recovery`. |
| Payments | payments | Payments received and collections signed off. Buttons: Record a payment, Find. | `paygira_payments`, `paygira_record_payments` or `paygira_delete_payments`. |
| Pay staff & vendors | payouts | Money the school sends out. Tabs: Someone at the school, Someone else. | `paygira_payouts`. |
| Settings | sliders | How PayGira works for the school. | `paygira_settings`. |

Related money pages (not in this sidebar)
- Settings, Billing & Plan: Hub-Managed Billing, Where parent payments go, Payment Methods (Manage cards), Platform Service Fee, Current Plan (Change Plan), Cancel subscription, Invoices. Needs `manage_billing`.
- "My PayGira" opens inside a class (teachers' own collections).
- Parent PayGira is covered in section 3.

## 1.8 Settings (`/account/settings`)

| Item | Icon | What it does | Shown when |
|---|---|---|---|
| Customize School | school | School profile (Logo, School details, Short name and web address); Look and feel (Brand color, Font, Names and dates); School rules (School calendar with holidays and extra days, Student IDs). | `manage_settings` with `settings_profile`. |
| Profile | profile | Appearance (Light, Classic, Dark) and Your details. | Always. |
| Your hub | hub | The district or hub this school belongs to. | School belongs to a hub. |
| Billing & Plan | billing | Cards, plan, invoices, where parent payments go. | `manage_billing`. Only item shown when the school is on hold. |
| Security | security | Email and Change Password. | Staff (hidden if a hub restricts it). |
| Two-step sign-in | security | Authenticator app setup. | Feature `sign_in_authenticator` shows it to allowed people. |
| Tenant configuration | security | Sections: Session, Two-step sign-in, Single sign-on. | `manage_settings` and manager or owner. |
| Single sign-on (alone) | security | Set up SAML or OpenID sign-in. | `manage_sso` and manager, when Tenant configuration is not shown. |
| Access Tokens | accessTokens | Tabs: Personal Access Tokens, Client Secrets, Usage & allowance; buttons How to connect, New. | `settings_service_accounts`, with Customize and Security access. |
| Notifications | notifications | Switches. Groups: Academics (score thresholds), Emails, For the whole school. | Feature `alert_rules`, or any email preference exists. |
| Feedback | feedback | Send feedback to Managira. | Always. |

The settings sidebar also shows the school's country flag at the top and a Collapse button. Inside Management the same screens open without the sidebar. Integrations is a section of the same page, but it never shows in the Settings sidebar; it opens from Management.

## 1.9 Class workspace (`/common/classDashboard/:id`)

Sidebar titled "Class Tools" (button "Class Tools" on phones); "Arrange this menu" works here too. Items open as workspace tabs.

| Item | Icon | What it does | Shown when |
|---|---|---|---|
| Class Room | classroom | Class home: Teachers, Students (with a pencil remark button per student), Subjects. | Always. |
| Parent Messages | messages | Messages from this class's parents, with a count badge. | Always. |
| Weekly briefing | mailroom | This class's weekly briefing choices. | Manager role, feature `weekly_briefing`, and Class & notif. settings not available. |
| Class Schedule | schedule | Weekly timetable. | Always. |
| Pickup list | inline people glyph | Who is collected, and by whom. | Pickup list is on for the class. From code. |
| Transportation | transportation | Bus, route and stop for each student, with bus reports. | Transportation on. From code. |
| Activities | activities | Class activities. | Always. |
| Forms | forms | Forms filled in class, plus one entry per form given its own tile. | Custom editor ready. |
| My PayGira | paygira | The person's own collections. | PayGira workspace open to this person. |
| Attendance and lunch | attendance | Take attendance and lunch. The name follows the school switches (Attendance, Lunch, or Attendance and lunch). | Attendance plan feature, `mark_attendance`, a school switch on, and (for teachers) main or assistant teacher. |
| Assessment Questions | questions | Test questions for the class. Greyed "Ask your admin for access" if the person has `manage_assessments` but not the questions permission. | Assessment plan feature. |
| Gradebook (expands) | grading | Opens Review (when questions are allowed) and one entry per subject. | Assessment plan feature. |
| Docs & Sheets | docs | Files assigned to the class. | Plan feature Create Files. |
| Class & notif. settings | settings | This class's sharing switches and notices. | Feature `class_settings` and the person may manage the class. |

Other controls: a three-dot "Class workspace options" menu (Assess other school year, Back to current term; needs access to other school years); Year and Term pickers; a bar of open tabs with close buttons. Section labels in the sidebar: "Communication" and "Tools".

Observed: manager sees 14 entries (Gradebook lists 8 subjects plus Review); teacher 299 in a class he does not lead sees no Attendance, a greyed Assessment Questions, and no Class & notif. settings.

## 1.10 Other staff pages

| Item | Icon | What it does | Shown when |
|---|---|---|---|
| Mailroom tabs: Send, Inbox | none | Compose messages or read replies. | `mailroom`. |
| Mailroom channel filter: All, Text, WhatsApp, Email | none | Chooses how a message goes. | Text and WhatsApp appear only when that integration is activated; Email always. |
| Calendar panels: My calendars, Coming up | none | Calendar sources and next events. | Always. |
| Student page tabs: Overview, Grades, (Attendance), Messages, Bills, Files, Portfolio, Transport, Old records | none | One student's details. | Each by permission, school switch and data (for example Bills needs the PayGira student ledger). |
| Your access (`/common/my-access`) | inline shield | Role, what you can do, what is not included. | Non-owner staff. |
| First-time setup | none | Colour, logo, details, school year, website look. | A school not yet personalised. |

## 1.11 Page finder (Ctrl K) catalogue

| Group | Pages offered | Gate |
|---|---|---|
| Home | Home (Dashboard for drivers), Calendar, Birthdays, Mail Room | Mail Room needs `mailroom`. |
| People | All students, Add a student, Online applications, Graduates & alumni, Admission settings, Users / employees, Parents & guardians | The same rules as the menus. |
| School | School years & terms, Classes & subjects, Class & notif. settings, Enrollment, Promotion, Events announcements & activities, School website, Transportation, Weekly briefing, Email issues | Same rules; Weekly briefing is managers with feature `weekly_briefing`. |
| Teaching | Assessments, Assessment questions, Custom editor, Docs & sheets | Same rules. |
| Reports | Terminal reports (report cards), Transcripts, Report settings, Report builder, Organization stats | Same rules. |
| Settings | Integrations, Mira, Service accounts, Settings, Profile, Customize school, Billing & plan, Notifications, Two-step sign-in, Your access, Help center | Same rules. |
| Money | PayGira: Overview, All bills, Repeating, Balances, Overdue, Payments, Pay staff & vendors, Settings | Same rules. |
| Your classes | One entry per class (up to 60) | Teachers and supervisors list their own. |
| Recent | The last pages opened | Always. |

## Counts for section 1
- Top bar: 14 items (incl. 4 help-menu items and 2 bell actions).
- Main menu: 11 entries (Management Tools, School Website, Mailroom, Calendar, Birthdays, Admissions, Reports, Sandbox switch, Open data migration, Settings, Logout) plus the phone greeting.
- Dashboard: 18 quick actions plus Customize, 9 dashboard cards and tiles.
- Management hub: 23 possible items (20 observed for the manager).
- Admissions: 7. Reports: 7. PayGira: 6 places, 8 pages.
- Settings: 11 sidebar items (plus Integrations section outside the sidebar).
- Class workspace: 14 sidebar entries.
- Page finder: 9 groups, about 55 pages.

---

# 2. Teacher and Supervisor: what is different

Defaults from `ROLE_DEFAULT_PERMISSIONS`
- Teacher: `manage_students`, `manage_assessments`, `mark_attendance`, `manage_classes_subjects`, `manage_reports`, `transport_class_reports`, `class_settings` (own classes only).
- Supervisor: all of Teacher's, plus `manage_guardians`, `set_assessment_questions`, `approve_admissions`, `publish_events_announcements`, `generate_transcripts`, `manage_promotions`.
- Manager: everything. A supervisor also counts as a "full menu role" (sees Email issues and Docs & sheets without extra ticks).
- A manager may add or remove any permission per person, so the lists below are what was observed in org 63, not guaranteed defaults.

## 2.1 Main menu

| Item | Teacher | Supervisor | Why |
|---|---|---|---|
| Management Tools (management) | Shown (3 items) | Shown (8 items) | Needs any Management item. |
| School Website (website) | Shown | Shown | Plan feature. |
| Mailroom (mailroom) | Not shown | Not shown | Needs `mailroom`, which neither role has by default. |
| Calendar (calendar), Birthdays (birthdays) | Shown | Shown | Always. |
| Admissions (addStudent) | Shown | Shown | Has students permission. |
| Reports (reports) | Shown | Shown | Has report permissions in org 63. |
| Sandbox switch | Never | Never | Managers only. |
| Settings (settings), Logout (logout) | Shown | Shown | Always. |

Help menu: Guides, Send feedback, Your access (no Two-step sign-in unless allowed).

## 2.2 Hubs and Settings as observed

| Menu | Teacher (299) | Supervisor (241) |
|---|---|---|
| Management | Classes & subjects, Assessments, Enrollment | Classes & subjects, Assessments, Assessment questions, Enrollment, Parents & guardians, Events announcements & activities, Docs & sheets, Email issues |
| Admissions | All Students, Add Student, Former Students > Graduates & Alumni | All Students, Add Student, Online Applications, Former Students > Graduates & Alumni |
| Reports | Term Reports > Terminal reports, Report Settings; Report Builder | Term Reports > Terminal reports, Transcript, Report Settings; Report Builder |
| Settings | Profile, Your hub, Security, Notifications, Feedback | Same as teacher |
| PayGira hub | Not in the menu; "My PayGira" inside a class | Same |
| Class & notif. settings | Not in Management; shown inside their own classes | Same (needs `class_settings_all` for Management) |
| Dashboard quick actions | New task, Calendar, Add student, All students, Reports, Classes & subjects, My profile & settings | Not captured; follows the permissions above |
| Dashboard cards | Enrolled classes (their own), Current school year, Events, Activity & announcements, Needs attention, Recent activity (no number tiles) | Same idea |

Class workspace: a teacher sees Attendance and lunch only in classes where they are main or assistant teacher; Assessment Questions is greyed "Ask your admin for access" without `set_assessment_questions`; Class & notif. settings is for classes they may manage.

## Counts for section 2
- Main menu: 8 entries for each (9 for a person with `mailroom`).
- Management: 3 (teacher) and 8 (supervisor) observed. Admissions: 4 and 5. Reports: 4 and 5. Settings: 5 each. Dashboard quick actions: 7 (teacher).

---

# 3. Parent / guardian portal

## 3.1 Top bar and main menu

| Item | Icon | What it does | Shown when |
|---|---|---|---|
| Hello, (name)! | none | Greeting. | Always. |
| Help (Guides only) | inline question mark, inline open book | Opens the guides. | Always. Parents get no feedback, access or Mira items. |
| Notifications | inline bell | Notification list. | Always. |
| No search box | none | Parents do not get the search bar. | Always. |
| Dashboard | dashboard | Home. | Always. |
| School Website | website | Public site in a new tab. | Plan feature School Website. |
| Activities | activities | School and class activities. | Always. |
| Calendar | calendar | School calendar. | Always. |
| Messages | messages | Reports and messages with the school (`/guardian/reports`). | Always. |
| PayGira | paygira | Bills and payments. | Plan feature PayGira. |
| Settings | settings | Appearance, profile, notifications, saved cards. | Always. |
| Logout | logout | Signs out (red). | Always. |

## 3.2 Dashboard (`/guardian/dashboard`)

| Item | Icon | What it does | Shown when |
|---|---|---|---|
| Messages quick link (with unread count) | inline envelope glyph | Opens Messages. | Always. |
| My Children (tab) | none | Cards for each child with View. | Always. |
| Requests (tab, New and Old) | none | Requests the family sent and their answers. | Feature `portal_requests`. |
| Bus reports (tab) | none | Bus reports about their children. | Transportation on and bus requests allowed. From code. |
| Child card: View, or Edit and Withdraw | inline chevron | Opens the child, or edits a pending application. | A child is linked or pending. |
| Link prompts (Accept, Not me, Send a code, Confirm) | none | Link a child at another school. | Feature `family_link`. |

## 3.3 Child page tiles (`/guardian/child`)

Header shows the child's name, the school (if several), and the cumulative GPA when the school shares GPA.

| Tile | Icon | What it does | Shown when |
|---|---|---|---|
| Academic info | stats | Grades, attendance and results. | Always. |
| Schedule | schedule | The child's timetable. | Always. |
| Teachers | staff | The child's teachers. | Feature `teacher_cards`. |
| Lunch | lunch | Lunch days. | The class takes lunch and the school's Lunch switch and sharing are on. |
| Alerts | notifications | Choose alerts about scores, absences and the bus. | Feature `alert_rules` and the school shares Alerts. |
| Calendar | calendar | Child-specific calendar. | Always. |
| Activities | activities | The child's class activities. | Always. |
| Homework | homework | Homework set. | Plan feature Set Assessment Questions. |
| Testing Room | questions | Online tests. | Same. |
| Documents & results | docs | Test results and school files. Reads "Documents" when only files are shared. | Same, or school shares Student files. |
| Forms | forms | Forms the school asks parents to fill in. | Custom editor ready. |
| (A form's own name) | the form's own icon | A form the school gave a tile. | Custom editor ready. |
| Portfolio | portfolio | Marked work and documented tests. | School shares Portfolio. |
| Transportation | transportation | Opens the bus tracker. | Transportation on and the school shares Bus & transport. From code. |
| Messages | messages | Messages about this child. | Always. |

Observed for child 10181: 13 tiles (Transportation absent, transport is off). Each tile can show a small count badge.

## 3.4 Other parent pages

| Item | Icon | What it does | Shown when |
|---|---|---|---|
| PayGira page | none | Per-child Outstanding and bills due; Recent Payments; pay online. | Plan feature PayGira. |
| Messages page: + New message | none | Write to the school. | Always. |
| Settings: Appearance | none | Light, Classic or Dark. | Always. |
| Settings: Profile (Your Profile Image, Student Images, Personal Information) | none | Edit photos and details. | Always. |
| Settings: Notifications (Academics, Attendance, Emails) | none | Choose what comes to you. | Always. |
| Settings: Saved cards (PayGira, Cards & Billing) | none | Cards for school bills. | PayGira on. |
| Calendar: All, one button per child, Add to my calendar | none | Filter the calendar. | Always. |

## Counts for section 3
- Main menu: 8 entries (7 for a school without PayGira or the website). Dashboard: 3 tabs and 1 quick link. Child tiles: 15 possible, 13 observed. Settings: 4 blocks.

---

# 4. Student portal

## 4.1 Top bar and main menu

| Item | Icon | What it does | Shown when |
|---|---|---|---|
| Search anything | inline magnifier | Searches within what the student can reach. | Always (students get the search box). |
| Help (Guides only), Notifications | inline | Guides and notifications. | Always. |
| Dashboard | dashboard | Home. | Always. |
| School Website | website | Public site. | Plan feature School Website. |
| Activities | activities | Activities. | Always. |
| Calendar | calendar | Student calendar. | Always. |
| Testing Room | questions | Take online tests. | Plan feature Set Assessment Questions. |
| Settings | settings | Appearance and notifications. | Always. |
| Logout | logout | Signs out (red). | Always. |

## 4.2 Dashboard (`/student/dashboard`)

| Item | Icon | What it does | Shown when |
|---|---|---|---|
| Attendance (stat) | attendance | Attendance rate, present and absent. | The school shares Attendance. |
| GPA (stat) | inline eye toggle | GPA (hide or show). | GPA shared and letter grades. |
| Term (stat) | calendar | Days left in the term; opens its details. | Always. |
| Lunch (stat) | dashboard | Days with lunch. | Student takes lunch. |
| My tiles (tab) | none | The tiles below. | Always. |
| Requests (tab, New and Old) | none | The student's requests. | Feature `portal_requests`. |
| Bus reports (tab) | none | Bus reports. | Transportation on. From code. |
| Schedule (tile) | schedule | Opens the timetable panel. | Always. |
| Calendar (tile) | calendar | Opens the calendar. | Always. |
| Activities (tile) | activities | Opens activities. | Always. |
| Grades (tile) | grading | Opens grades. | Always. |
| Teachers (tile) | staff | Opens teachers. | Always. |
| Bus (tile) | transportation | Opens bus details. | Transport shared with students. |
| Testing Room (tile) | questions | Takes online tests, with open-test badge. | Testing room enabled. |
| Forms (tile) and one tile per form | forms or the form's icon | School forms. | Custom editor ready. |
| Portfolio (tile) | portfolio | Marked work. | Portfolio shared. |
| Settings (tile) | settings | Opens Settings. | Always. |

## 4.3 Other student pages

| Item | Icon | What it does | Shown when |
|---|---|---|---|
| Testing Room: Available, Completed | none | Tests to take and finished ones. | Testing room enabled. |
| Settings: Appearance, Notifications (Academics) | none | Look and alerts. | Always. |
| Portfolio: Subjects, Documented assessments | none | Term-by-term work. | Portfolio shared. |

## Counts for section 4
- Main menu: 7 entries observed (9 with the optional ones counted as above). Dashboard: 4 stats, 3 tabs, 10 tiles (+ form tiles).

---

# 5. Driver (transport) screens

## 5.1 Top bar and main menu

| Item | Icon | What it does | Shown when |
|---|---|---|---|
| Search anything | inline magnifier | Search box. | Shown to drivers. |
| Mira button | image | Mira. | Visible but not usable without Mira access. |
| Help (Guides only), Notifications | inline | Guides and notifications. | Always. |
| Dashboard | dashboard | Today's trip. | Always. |
| Calendar | calendar | School calendar. | Always. |
| Management | management | Management hub (only the items granted). | Driver given any Management permission, such as a lead with Users / Employees. |
| Reports | reports | Report Builder. | `reports_builder`. |
| School Website | website | Public site. | `driver_school_website` and plan feature School Website. |
| Settings | settings | Appearance, details, notifications. | Always. |
| Logout | logout | Signs out (red). | Always. |

Observed for driver 243: Dashboard, Calendar, Settings, Logout (4 entries).

## 5.2 Dashboard ("Today's trip", `/driver/dashboard`)

| Item | Icon | What it does | Shown when |
|---|---|---|---|
| Report | none | Opens "Send a report" (type, issue, students, priority, details) to the lead. | Transportation on. |
| Route chooser | none | Pick the route. | More than one route assigned. |
| Go / Open map | inline play triangle | Starts the trip and the navigation screen. | Bus and route assigned. |
| End trip, Live badge | none | Ends the trip; shows live sharing. | During a trip. |
| Stops list | none | Ordered stops. | Bus and route assigned. |
| Students (tabs: Bus access, No bus access) and search | none | Riders and non-riders. | Always. |
| Forms cards (one per driver-portal form, plus Forms) | none | Forms about riders. | Custom editor ready. |
| Messages when off | none | "Transportation is turned off at your school". | Transport off (what the observed driver sees). |

Observed: Today's trip page with the two Students tabs only, as transport is off in org 63.

## 5.3 Trip navigation screen (from code, `public/js/driverNav.js`)

| Item | Icon | What it does | Shown when |
|---|---|---|---|
| Turn banner and stop chip | inline arrow | Next turn; tap the chip to open stops. | During a trip. |
| Minimize | inline | Shrinks the map. | During a trip. |
| Compass | inline | Turn the map to travel direction or north. | During a trip. |
| Whole route | inline | Show the full route. | During a trip. |
| Zoom in, Zoom out | inline plus and minus | Zoom. | During a trip. |
| Re-center | inline arrow | Return to the bus. | After panning. |
| Navigate menu: Google Maps, Apple Maps, Waze | none | Hand the route to a maps app. | Waze when the school turns Waze or Google Maps navigation on. |
| End | none | Ends the trip (asks first). | During a trip. |
| Stops sheet: search, Add stop, Report | none | Find a stop or student, add a stop, send a report. | During a trip. |
| Arrival prompts: Yes, No, No students, Keep driving, Back | none | Confirm arrival at a stop. | At stops. |
| Boarding: All boarded, Except | none | Mark who got on. | School has boarding on. |

## 5.4 Driver Settings and other

| Item | Icon | What it does | Shown when |
|---|---|---|---|
| Settings: Appearance, Your details (photo, email, phone), Notifications | none | Personal settings. | Always. |
| Transportation workspace (managers and leads, `/transportation/manage`): Overview, Requests, Reports (New, Old, Arrivals), Buses, Drivers, Schedule, Students, Settings (Map, School location, Units) | none (text buttons only) | Runs buses, routes, drivers, riders. | Transport on and `transport_*` permissions per tab. From code. |

## Counts for section 5
- Main menu: 4 observed (up to 7). Dashboard: 7 controls. Trip screen: 12 controls. Transportation workspace: 8 tabs.

---

# Not in a menu but reachable

- `/common/contact-template`: kept for old links; Admission Settings holds it now.
- `/common/briefing` and `/common/briefing/class/:id`: weekly briefing pages, opened from Class & notif. settings.
- `/common/first-setup`: opened by being redirected from a new school's dashboard.
- `/common/employeeDetails`, `/common/createEmployee`, `/common/modifyEmployee`: opened from Users / Employees, dashboard teacher names and "Add a teacher".
- `/common/studentDetails`, `/common/editStudent`: opened from All Students and class rows.
- `/account/settings/finance/arrears`: the Overdue tab of Student ledger.
- `/finance` invoice and receipt pages: opened from bills and payments.
- `/account/service-plan`, `/account/updatePlan`, `/account/updateCard`, `/account/payment`: plan and card pages reached from Billing & Plan and the public site.
- `/account/accessTokens`, `/account/integrations`, `/account/mira`: shown inside Management or Settings frames.
- `/common/my-access`: only from the Help menu and the page finder.
- `/common/publicDashboard`, `/common/publicRegisterStudent`: the public school site and its application form.
- `/guardian/edit-pending-student`: edit a pending application from the dashboard.
- `/print/printStudentReport`: report cards, opened from Terminal reports.
- `/common/migration`: only in the sandbox or by the manager's Data migration item.
- Student and parent one-off pages: take a test, test result, child alerts, lunch, teachers, portfolio, forms.

# Inconsistencies noticed

1. Same page, different names: "Classes & subjects" (menu) vs "Classes, Subjects & Grad Years" (hub label) vs "Classes, subjects & graduation years" (page title); "Organization Stats" vs "View Statistics" vs "Organization statistics"; "Parents & guardians" vs "Guardians"; "Docs & sheets" vs "Docs/Sheets"; "Add Student" vs "Add New Student" vs "Add New Students"; "Transcript" (menu) vs "Transcripts"; "Mailroom" vs "Mail Room" (finder) vs "Send a message" (quick action); "Class & notif. settings" vs "Class settings" in the hub link.
2. The Management sidebar is headed "Workspace" while the menu item and the page are "Management Tools"; the class sidebar is "Class Tools". PayGira says "Bills" in the menu but "All bills" as a tab, and "Student ledger" holds "Balances" and "Overdue". Integrations has both "Google Maps" and "Maps".
3. Icons shared by different things: `security` (Security, Two-step sign-in, Tenant configuration, Single sign-on); `sliders` (Report Settings, Admission Settings, PayGira Settings); `settings` (Settings, Class & notif. settings, Student/Parent Settings tile); `enrollment` (Enrollment and Data migration); `messages` (Parent Messages and parent Messages); `mailroom` (Mailroom and Weekly briefing); `notifications` (Alerts tile and Settings, Notifications); `staff` (Users / Employees and Teachers); and the student Lunch stat uses the `dashboard` house.
4. Three icon systems at once: navIcons line icons, Font Awesome on the dashboard quick actions and settings groups, and inline SVGs in the Help menu, bell and driver screens. Mira uses a picture, not a navIcon.
5. Reachable only by URL or a side route: `/common/contact-template`, `/common/my-access` (Help menu only), `/common/briefing`; the "Contact template" Management item is still coded but forced off.
