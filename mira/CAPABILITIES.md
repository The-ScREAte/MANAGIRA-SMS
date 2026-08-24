# What Mira can do so far

Simple running list. Every action below is scoped to the logged-in user's own organization only, and every action that changes data is checked against that user's real, individually-granted permission (not their role name) before it runs. Every write action is recorded in Activity Logs (`/common/activityLogs`), tagged "via Mira (AI assistant)".

## Look things up (read-only, no permission required beyond being staff)

| Tool | What it does |
|---|---|
| `find_student` | Search students by name |
| `find_contact` | Search guardians/parents by name |
| `get_fees` | A student's fee payments and totals |
| `get_attendance` | A student's attendance records/summary |
| `get_class` | List classes with student counts |
| `get_term` | List terms, with their school year and which is current |
| `list_school_years` | List school years, with term counts and which is current |
| `list_projects` | The caller's own school info |
| `generate_report_card_summary` | Quick attendance + fee snapshot for a student |
| `draft_message` | Drafts a message to a guardian - never sends it |
| `list_subjects` | List subjects, grouped by name, with which classes have (and don't have) each one |
| `list_graduation_year_groups` | List graduation year groups, with how many classes reference each |
| `list_assessments` | List tests for a term - weight, max score, category, lock/active status, edit window, assigned classes/subjects |
| `list_question_sets` | Full question text, options, and answer keys for a test - doubles as previewing a test's questions |
| `list_question_set_students` | Every enrolled student's attempt status for a test - started/submitted, locked, posted, score |
| `get_attempt_for_grading` | One student's attempt - each question, their answer, and current awarded marks |
| `list_enrollments` | List every school year/term that has an enrollment open, with class/student counts |
| `get_enrollment_roster` | Full roster (open classes + which students are in each) for one school year/term |
| `get_guardian_details` | A guardian's contact info, linked student(s), and parent-portal access status. Guardian data lives in two parallel tables kept in sync by fuzzy matching, not a real link - this reads the modern one (`guardian_profiles`) first and only falls back to the old per-student one for un-migrated records, labeling which one it found (`source: "profile"` or `"legacy"`) |
| `get_integrations_status` | **VIEW-ONLY, by explicit design.** Whether Google Classroom/WhatsApp/SMS/Student Portal/Transportation are activated, configured, connected, and who last changed each - Mira has no way to activate, connect, disconnect, or configure any of them (see below) |
| `list_failed_emails` | People whose email is bouncing - name, broken address, why, how many times, when |
| `check_email_availability` | Validate a proposed replacement email's format and that no one else in the org already owns it |
| `get_upcoming_birthdays` | Students/staff with a birthday today or in the next 7 days - read-only reporting, no actions |
| `list_students` | The full student roster (Admissions/All Students page) - class, gender, DOB, graduated status, portal access. Filter by className/graduated. Richer than `find_student`'s quick name search |
| `check_student_duplicates` | Pre-flight duplicate check before `create_students` - does a matching student already exist? |
| `list_pending_admissions` | Open admission applications submitted via the public registration form - not real students yet |
| `get_pending_admission_details` | One pending admission's requested subjects and guardian(s), on top of what the list already shows |
| `get_organization_statistics` | Full stats dashboard for one term (defaults to current) - counts, attendance, top classes, growth, gender/role breakdowns, subject strength - plus real chart image URLs (see "Charts" below) |
| `compare_classes` | Side-by-side comparison (2+ classes) - enrolled/avg score/pass/fail, plus a comparison chart image URL |
| `get_report_settings` | A class/term's promotion rules, grading scale, and which report-card columns/sections are shown |
| `list_remarks` | The org's comment-bank templates (teacher/conduct/attitude/interest, or custom types) |
| `get_close_group_candidates` | Every student currently in a graduation year group, with graduated status - check before `close_graduation_year_group` |
| `list_archived_students` | Archived (closed-out) students, optionally scoped to one graduation year group |
| `get_notification_preferences` | The caller's own personal notification toggles (role-specific) plus the org-wide ones |
| `get_school_customization` | School name/address/country/province/currency, font, name/date display format, nickname, custom student ID settings |
| `get_merit_sheet` | Ranked class merit-sheet table (score per subject, total, average, rank) as data - the normal first step before ever generating a PDF |

**Charts, a new capability**: Mira's chat UI previously had zero chart-rendering ability (markdown tables only). It was extended to support markdown image syntax (`![alt](url)`), **restricted specifically to `https://quickchart.io/` URLs** - not arbitrary image hosts - since allowing any external image host would let injected text render a tracking-pixel-style `<img>` pointing at an attacker's server. `get_organization_statistics` and `compare_classes` build real Chart.js configs (bar/line/doughnut/radar) rendered by the free QuickChart.io service and return them as ready-to-embed URLs - Mira should actually embed these in replies (`![Attendance by Class](url)`), not just describe the numbers. Only aggregate counts/percentages/class names are ever sent to build a chart - never individual student names or other PII.

## Change things (each requires the specific real permission below)

### Admissions & Students

| Tool | Permission required | Notes |
|---|---|---|
| `create_students` | Manage Students | Add 1-50 students in one call - the real "Add New Student" page's full logic (custom student ID allocation, guardian fuzzy-match/dedup + portal account provisioning, subject/enrollment linking, duplicate detection) runs exactly as-is, delegated to the real form handler and its real validation middleware, not reimplemented. Duplicate detected → whole batch rejected until the user confirms `allowDuplicateSave: true` |
| `update_pending_admission` | Approve Admissions | Edit an applicant's details before deciding - only pass what's changing; subjects/guardians REPLACE the whole list if given, otherwise left untouched |
| `approve_pending_admission` | Approve Admissions | **DESTRUCTIVE/IRREVERSIBLE.** Creates a real student, enrolls them, links guardians with real portal accounts, permanently deletes the pending record. Warns first |
| `reject_pending_admission` | Approve Admissions | **DESTRUCTIVE/IRREVERSIBLE.** Permanently deletes the application, notifies the guardian(s). Warns first |

**A real, pre-existing cross-tenant security bug was found and fixed while building this**: `rejectPendingStudent` (the real handler behind the reject button) never scoped any of its queries by `organization_id` - unlike every other handler on this page (approve, save-changes, get-details), which all correctly do. Since `pending_id` is a single globally-unique counter shared across every organization on the platform (not scoped per org), a staff member from any org with Approve Admissions could reject - permanently delete - another org's pending admission just by guessing or iterating small integers. Fixed directly in `controllers/commonController.js` (added the missing `organization_id` check to every query in that handler). Mira's own `resolvePendingAdmission` helper independently re-verifies organization ownership before ever calling approve/reject too, as defense in depth on top of that fix - verified with a real cross-org test (a foreign `pending_id` correctly 404s and is left untouched).

`create_students` is normalization-first by design: the tool description spells out the exact per-student shape (name, DOB or dateOfBirthUnknown, gender, className, optional guardians/subjects/custom ID/future enrollment), and Mira is expected to convert whatever messy format a user pastes in (a list, a spreadsheet dump, a paragraph) into that shape before calling - never inventing a class, gender, or date that wasn't actually given. One subtle bug caught during testing and fixed: class/graduation-year-group/school-year/term ids resolved from names are real database integers, but the real form's own validation middleware (`validateStudents`) always calls `.trim()` on every field, because a real browser submission is always string-encoded - passing a bare number crashed with a 500. Fixed by stringifying every resolved id before building the delegated request body, matching what an actual form submission would send.

**A second real, pre-existing bug found and fixed during an exhaustive re-test pass**: `resolveClassByName` (the shared helper `create_students`, `assign_document_to_class`, and `unassign_document_from_class` all use to turn a class name into a `class_id`) matched purely by substring `ILIKE`, which is genuinely ambiguous for real class-naming conventions - e.g. this org has both "SS 1" and "JSS 1", and "SS 1" is literally a trailing substring of "JSS 1", so asking for "SS 1" falsely 409'd as ambiguous. This affected Documents' class-assignment tools too (built in an earlier pass, just never hit by testing that happened to only use non-colliding names like "JSS 1"/"JSS 3"). Fixed by trying an exact case-insensitive match first, only falling back to substring search when nothing matches exactly - verified against the real "SS 1"/"JSS 1" collision on both features.

**Known real-app limitation, not a Mira bug**: the legacy `guardians` compatibility table has a `UNIQUE(student_id, first_name)` constraint - two guardians added for the same student must have different first names (e.g. "Sarah" and "John" is fine; two guardians both literally named "Sam" for one student will fail with a database error). This is an existing constraint of the real app's data model, not something Mira introduced or can route around.

Exhaustively re-tested per explicit request: 40+ real-org assertions across future-dated enrollment, graduation-year-group resolution, guardian dedup/reuse across siblings (by email, then phone+name), multiple distinct guardians per student, accented/hyphenated/apostrophe names, invalid email rejection, batch-size cap (50), in-batch duplicate detection with `allowDuplicateSave` override, all-or-nothing transactional rollback (one bad row in a batch saves nothing), whitespace-only field rejection, manual custom-ID conflict + suggested-next-ID, prefix-not-doubled on manual IDs, subjects correctly scoped per-class with warnings for genuinely wrong-class subject names, gender normalization, and repeated/flakiness checks - run clean three times in a row with the org restored to its exact original baseline every time.

### Report Settings, Close Graduation Year Group

Both `/stats/organization` and `/print/reportSettings` have **no real `PERMISSIONS.X` gate in the main app at all** - only `isAuthenticated` plus a plan-feature check, not a role permission. Mira gates them with the closest sensible existing keys (not a guess made lightly, but a deliberate choice since nothing in the app specifies one): `MANAGE_RECORDS` for statistics (same broad "admin visibility" permission Docs/Sheets uses), `MANAGE_REPORTS` for report settings ("Manage Reports/Printing" in the permission catalog). Close Graduation Year Group/Archived Students, by contrast, DO have real exact gates already (`MANAGE_SCHOOL_YEAR_TERMS` / `MANAGE_STUDENTS`) and Mira uses those directly.

| Tool | Permission required | Notes |
|---|---|---|
| `set_report_card_display_options` | Manage Reports | Toggle position/attendance/score columns/remark sections/grade key on the printed report - only pass what's changing; complex nested settings not exposed here (PayGira billing display, cross-class grade-presentation propagation) are read-modify-written completely unchanged |
| `set_grading_scale_band` | Manage Reports | Create/update one percentage-range grade band (e.g. "80-100% = A") |
| `delete_grading_scale_band` | Manage Reports | Remove one grading band by id |
| `set_promotion_settings` | Manage Reports | Pass/fail cutoff, promoted/repeated class, auto-promotion toggle, reopen date |
| `add_remark` | Manage Reports | Add a comment-bank template |
| `delete_remark` | Manage Reports | Remove one |
| `close_graduation_year_group` | Manage School Years & Terms | **Marks students graduated + archives them.** Fully reversible via `unarchive_students` - real effect is just `students.graduated=TRUE` + an `archived_student_info` row, no enrollment/grade data touched. Warns first. Verifies the named students actually belong to the named group (the real page's own UI has zero server-side validation of this) |
| `unarchive_students` | Manage Students | Exact inverse of the above. Warns first |

Report Settings' underlying data model is the most complex settings surface in the app (nested JSONB with cross-class propagation, a per-range lock system, bulk row-based promotion updates) - rather than reimplement any of that, every write here delegates through the real controller functions, and read-modify-write only ever touches the one field a tool exposes, letting the real handler's own normalization logic re-derive everything else exactly as if a person had resubmitted the form unchanged. Verified with real round-trip tests: flipping one display toggle left every other toggle (including ones with no dedicated tool) provably untouched, and a promotion cutoff change/restore round-tripped exactly.

### Report Card & Merit Sheet PDFs

| Tool | Permission required | Notes |
|---|---|---|
| `get_merit_sheet` | Manage Reports | **The normal first step for a merit sheet.** Computes the same ranked table as the real page (every student's total per subject, overall total, average, rank) as plain data - no PDF, no browser launch, ~2-3s. Present it as a markdown table |
| `generate_merit_sheet_pdf` | Manage Reports | **Second step, only if a real file is actually wanted.** Same class/subjects/assessments as `get_merit_sheet`, but renders and uploads an actual PDF (~10-25s, launches a real browser) |
| `generate_report_pdf` | Manage Reports | One or more students' report card as a real PDF, up to 10 per call. Give studentNames or `allInClass:true` |
| `email_report_pdf` | Manage Reports | Emails a real PDF **attachment** (not a link) to the student's guardian(s) on file. Warns who it's going to first |

By explicit design, Mira does not edit report content/settings here at all - that's the separate Report Settings section above. This section only ever generates and hands over the final PDF, exactly like the real "Generate Report"/"Merit Sheet" buttons, defaulting to the org's current school year/term unless a different one is named.

**Merit sheets are table-first by design, per explicit user instruction**: `get_merit_sheet` and `generate_merit_sheet_pdf` are two separate tools rather than one, specifically so a plain "show me the merit sheet for JSS 1" only computes and displays the numbers (fast, no PDF generated at all) - Mira should only reach for `generate_merit_sheet_pdf` when the user actually wants a downloadable/printable file. `get_merit_sheet`'s computation is a direct, line-by-line port of the real page's own ranking logic (same score/grade lookup against `score_remarks`, same total/average/position calculation, same tie/no-data handling) - kept as a single shared helper (`resolveMeritSheetSelections`) with the PDF tool so the two can never silently drift apart. It also correctly reflects the org's own configured name-display format (e.g. "Last, First") and custom student ID prefix, verified against real data. Report cards don't have this two-step split (there's no cheap "just the numbers" version of a report card the way a merit sheet's ranking table is) - `generate_report_pdf` always produces the real file directly, same as the real "Generate Report" button.

**Architecture**: the real app generates these PDFs by launching a headless browser (Puppeteer) that navigates to the real print page using the *browser's own* session cookie, so the exact same rendering pipeline (including the app's global page layout) produces the file. Mira has no browser session to hand over - it's called service-to-service with only a bearer token - so it mints a genuine, narrowly-scoped, short-lived (10-minute) session server-side, in the same session store express-session itself uses, for the exact identity already validated for this conversation (never a different user), hands it to Puppeteer, and destroys it again once the PDF is captured. This isn't a general impersonation mechanism - it only ever recreates the one session Mira's own caller already proved they own.

**Two real, pre-existing bugs found and fixed while building this:**
1. `emailReportPdfApi`/merit-sheet generation reuse `resolveClassByName` - the same helper whose real substring-matching bug ("SS 1" vs "JSS 1") was fixed during the Add-Student testing pass; both features automatically inherit that fix.
2. **Merit sheets with more than ~20 subjects+assessments silently failed** for everyone, not just Mira - the real "generate merit sheet" page passes the selected subject/assessment IDs as repeated query-string parameters, and Express's default query parser caps a repeated-key array at 20 entries; past that it silently reinterprets the "array" as a plain object, which the real controller's own `Array.isArray(...)` check then rejects - redirecting to a bare error page with no indication why. A real class easily has more than 20 assessments across all its subjects, so "generate the merit sheet with everything" was a normal request that happened to break. Fixed for Mira's path by switching to a same-origin JSON POST (no array-count limit) instead of the query-string GET - verified against the exact case that previously failed (31 assessment IDs). This is a real bug in the human-facing page too; it wasn't fixed there since only Mira's generation path was in scope for this change.

Verified end-to-end against real org data: a fresh (uncached) report PDF generation, a cached-reuse of the same PDF, a merit sheet with the default "everything" selection (previously the exact case that failed), and a real email send with the PDF genuinely attached (confirmed delivered) - all produced valid, correctly-sized PDF files (checked for the `%PDF` file signature and a real S3-hosted `Content-Type: application/pdf` response, not just a 200 status).

### Account Settings - Notifications, Feedback, Customize School

Notifications and Feedback have **no real `PERMISSIONS.X` gate in the main app at all** (only `isAuthenticated`) - Mira's personal-preference and feedback-submission tools need no permission beyond being staff (matching the real page, where any role can use them), but `set_organization_notification_preferences` self-imposes a **Manage Settings** check even though the real route doesn't require one, since it's an org-wide setting affecting every future guardian invite, not just the caller's own preferences - verified a Teacher-role caller is blocked from it while still being able to freely change their own personal toggles. Customize School's routes ARE all really gated with Manage Settings in the real app, matched directly.

| Tool | Permission required | Notes |
|---|---|---|
| `set_notification_preferences` | none beyond staff | The caller's own personal toggles only - only pass what's changing |
| `set_organization_notification_preferences` | Manage Settings (self-imposed) | Org-wide toggle (currently just guardian auto-invite-on-add) |
| `submit_feedback` | none beyond staff | Bug report / feature request / review / general - write-only, no way to see past submissions from here |
| `update_school_profile` | Manage Settings | Name/address/country/province - only pass what's changing |
| `set_school_font` | Manage Settings | One of the app's 15 supported fonts |
| `set_display_preferences` | Manage Settings | Name order (first-last vs last-first) and date format app-wide |
| `set_school_nickname` | Manage Settings | The human-readable display label only - the `.managira.com` subdomain itself is locked at registration and not touched |
| `set_student_id_settings` | Manage Settings | Whether custom student IDs are used, the prefix, auto-generate, starting number - feeds directly into `create_students`' custom ID logic |

**School visual theme/color is deliberately NOT duplicated here** - Customize School's "School Theme" card calls the exact same backend handler as the existing `set_website_theme` tool (School Website section); use that instead. Logo upload and the school holiday-calendar rules (weekend days, public-holiday country, manual day overrides) are real fields on this page not yet covered by a tool - logo needs the same attached-image handling School Website's upload tool uses (skipped here for the same batch-ambiguity reason `create_students` skips photos), and calendar rules were judged lower-priority for a first pass; both stay manual-UI-only for now.

One real bug found and fixed while building this: `set_school_nickname`'s underlying real handler (`updateNicknamePost`) calls `req.session.save(callback)` on success (the only Customize School handler that does) - Mira's delegation initially didn't provide that method on its internal fake session object, so the call threw *after* the database write had already succeeded, and the handler's own try/catch mistook that for the whole update failing. Fixed by giving the delegated session a real (no-op) `save()` method - verified the nickname update now correctly reports success.

### Email Issues

| Tool | Notes |
|---|---|
| `fix_failed_email` | Corrects a person's broken email on their real record (staff/student/guardian), then sends a real verification email to prove it now works - clears the failure record on success, or re-logs it with the new address if it still bounces. This page tracks WHO has a broken address and WHY, not individual failed sends - there's no stored subject/body, so there's no generic "resend" action, only "fix the address and re-verify." |

Needs an org owner, Manager, Supervisor, Admin, or Mini Admin role - this page has no real granular `PERMISSIONS.X` key in the main app (it's gated by an inline role-name allowlist inside the controller itself), so Mira reproduces that exact same allowlist server-side rather than substituting a permission key that would grant different access than the real page does.

### School Years & Terms

| Tool | Permission required | Notes |
|---|---|---|
| `create_school_year` | Manage School Years & Terms | Needs the year label + at least one term (name/dates) |
| `rename_school_year` | Manage School Years & Terms | Label only - not terms or "current" status |
| `delete_school_year` | Manage School Years & Terms | Warns first, only deletes after explicit user confirmation; blocked if anything (classes, enrollments, attendance, etc.) still depends on it |
| `add_term_to_school_year` | Manage School Years & Terms | Dates can't overlap existing terms in that year |
| `delete_term` | Manage School Years & Terms | Same warn-then-confirm flow; blocked if it's the year's last term or has dependent records |

### Classes, Subjects & Graduation Year Groups

| Tool | Permission required | Notes |
|---|---|---|
| `create_classes` | Manage Classes & Subjects | One or more class names at once |
| `rename_class` | Manage Classes & Subjects | Exact current name → new name |
| `delete_class` | Manage Classes & Subjects | Warns first; **blocked entirely** if the class still has students, attendance, assessments, or any other real data - this used to silently cascade-delete all of it, now it can't |
| `reorder_classes` | Manage Classes & Subjects | Sets the dashboard display order from a list of class names, top to bottom |
| `create_subject` | Manage Classes & Subjects | Subject name + one or more classes to assign it to |
| `assign_subject_to_classes` | Manage Classes & Subjects | Adds an existing subject to more classes |
| `rename_subject` | Manage Classes & Subjects | Renames it across every class it's assigned to at once |
| `delete_subject` | Manage Classes & Subjects | Warns with the exact counts of what will be lost (assessment results, enrollments, etc.) - can remove from just one class or the whole subject; **not blocked** like class/school-year deletes, since that already-cascades by design |
| `create_graduation_year_group` | Manage Classes & Subjects | Takes a 4-digit year; name is always auto-generated ("Graduation Class of {year} Group"), matching the app |
| `rename_graduation_year_group` | Manage Classes & Subjects | Exact current name → new name |
| `delete_graduation_year_group` | Manage Classes & Subjects | Warns first; blocked if any classes still reference it |

### Assessments (Tests)

A test is identified by its exact title within a term - Mira resolves it by (term, title), defaulting to the school's current term if none is named, and asking for the school year label too if that term name is ambiguous (e.g. "1st Semester" existing in more than one year).

| Tool | Permission required | Notes |
|---|---|---|
| `create_test` | Manage Assessments | Needs name, weight, max score, category (Class Assessment / Exams Assessment / Other), a subject, and at least one class - the subject must already be assigned to that class |
| `modify_test` | Manage Assessments | Name/weight/max score/category only - doesn't touch class/subject assignment, lock status, or the date window |
| `delete_test` | Manage Assessments | Warns first with the exact class count and score count affected; **blocked entirely** if any student scores have already been entered - this used to silently cascade-delete real scores, now it can't |
| `set_test_status` | Manage Assessments | lock / unlock / activate / deactivate - reversible, never touches existing scores |
| `set_test_date_window` | Manage Assessments | Sets when score entry opens/closes; omit a bound to leave it as-is, or pass `""` to clear it |

### Assessment Questions

Every tool here requires BOTH Manage Assessments AND Set Assessment Questions permissions (matching the real page's double permission gate). A question set is resolved by (term, class, subject, test title) - the same way tests themselves are found.

| Tool | Notes |
|---|---|
| `set_test_questions` | Create or replace a test's question set (matching "Set Questions") - always the full question list, not a partial edit. **Blocked entirely** if any student has already started/submitted an attempt on the existing set - this used to silently wipe their answers and marks, now it can't. Auto-enables the test's "question sets on dashboard" flag so creating one never hits a confusing dead end |
| `delete_question_set` | Warns first with the exact attempt count; **blocked entirely** if any attempts exist - same fix as above |
| `review_question_set` | Approve or reject a pending set |
| `reuse_question_set` | Copy a question set to a different class/subject/term, creating the target test automatically if needed; optional shuffle. Non-destructive |
| `post_question_set_scores` | Publish all pending submitted+graded attempts into the gradebook |
| `unpost_question_set_scores` | Remove posted scores from the gradebook (attempts/answers are kept) |
| `set_student_assessment_status` | Lock (safe, immediate) or unlock (**DESTRUCTIVE** - warn-then-confirm required) one student or all students. Unlocking a student **deletes their existing attempt, answers, and posted score outright** so they can retake - there is no recovery, so this always requires explicit confirmation first |
| `save_attempt_grade` | Save awarded marks per question for one student's attempt (clamped to each question's max) |

### Announcements

| Tool | Permission required | Notes |
|---|---|---|
| `create_announcement` | Publish Events & Announcements | Banner announcement, title + body |

### Enrollment

An enrollment is resolved by (term, year label) - the same way tests are found, defaulting to the school's current term if none is named. The real "Modify Enrollment" form always deletes and fully re-inserts the whole class/student roster for a term (there's no incremental add/remove-one-student endpoint in the app), so `set_enrollment_roster` mirrors that exact behavior: the roster you give it is the COMPLETE intended state, not a delta. There's no dedicated "Manage Enrollment" permission in the app today (the real page only checks login, not a role permission) - Mira gates writes on **Manage Students** instead, since enrollment is fundamentally about assigning students to classes.

| Tool | Permission required | Notes |
|---|---|---|
| `set_enrollment_roster` | Manage Students | Opens/sets which classes + students are enrolled for a term. Warns first with a full diff (classes/students added, removed, moved to a different class) before writing anything; only executes after explicit confirmation. Anything left out of the roster is removed from that term's enrollment - attendance, scores, and other records are untouched, since nothing else keys off enrollment |
| `delete_enrollment` | Manage Students | Removes the entire enrollment (all classes/students) for a term. Warns first with exact counts; only deletes after explicit confirmation. Attendance/scores/other records are unaffected |

### Promotion

Unlike every other section above, **all seven tools here - including the two read/preview ones - require Approve Promotions** (the enum's other key, `Manage Promotions`, isn't checked by any real route today): the real `/promotion/*` routes gate *viewing* the page on it too, not just changing it, so Mira matches that instead of treating reads as open. A promotion run bulk-creates next-term class + subject enrollment for every student a class's report generation already marked Promoted/Repeated with a destination class - it never touches a student's current class or graduation status, and every write is logged so it can be reversed. Per-student overrides (custom destination class or subject list) are UI-only for now; Mira always uses the already-computed default decisions. A schedule is identified by its (source term/year → target term/year) pair, the same way it's shown in Promotion History, not by a raw ID.

| Tool | Notes |
|---|---|
| `list_promotion_schedules` | Promotion history - source/target term, status, classes, whether it can still be reversed |
| `get_promotion_preview` | Already-computed promotion decisions for one or more classes, plus whether promotion is even activated per class (if not, it's silently skipped when applied - surfaced here instead of discovered after) |
| `schedule_promotion` | Schedules or immediately applies a promotion for one or more classes into a target term. **Bulk action** - affects every eligible student in the given classes at once. Warns first with per-class eligible counts and which classes will be skipped for not having promotion activated; blocked if the same source→target combo is already scheduled or applied |
| `apply_scheduled_promotion` | Runs an already-scheduled (not-yet-applied) promotion immediately instead of waiting for its date. Only works while status is "scheduled" |
| `cancel_scheduled_promotion` | Cancels a not-yet-applied schedule so it never runs. Only works while status is "scheduled" (Mira enforces this - the underlying endpoint would delete regardless of status if asked to, so this guards against canceling something already applied) |
| `reverse_promotion` | **DESTRUCTIVE.** Undoes an applied promotion's enrollments/subjects exactly where safe to, via its recorded audit trail. Only works within 15 days of when it ran, on a promotion that has an audit trail (older records can't be auto-reversed); doesn't undo anything a human changed by hand since. The 15-day window is UI-only in the real app - Mira enforces it itself too rather than being more permissive than the actual page |
| `delete_reversed_promotion` | Deletes a reversed promotion's history entry - it was already undone, so this just clears the record |

### Employees

Directly controls who can log in and what they can do, so this is more conservative than every section above: only **list, create (invite), and hold/resume** are exposed - changing an existing employee's role/permissions/classes, and deleting an employee, stay manual-UI-only. Like Promotion, reading requires **Manage Employees** too, not just writing (the real routes gate viewing the same way).

| Tool | Notes |
|---|---|
| `list_employees` | Name, email, role, on-hold status, pending-setup status (haven't set a password yet), assigned classes, granted permissions |
| `create_employee` | Invites a new staff account (Manager/Supervisor/Teacher/Driver) - sends a REAL email for them to set their own password. Creating a Manager account, or granting any high-risk permission (Manage Employees, Manage Settings, Manage School Years & Terms, Approve Promotions, Manage Billing), only works if the calling user themself has manager-level access - otherwise those are silently dropped, exactly like the real form, and the confirmation preview says so upfront. Warns first with the final role/classes/permissions that will actually apply; only creates after explicit confirmation |
| `set_employee_hold` | Puts a staff account on hold, or resumes one already on hold. **You can't put your own account on hold this way** - the real endpoint has no such protection at all, so Mira enforces it itself rather than being able to lock the calling user out by accident. Putting someone ON hold needs explicit confirmation (it notifies them by email and in-app); resuming is safe and runs immediately. A no-op if they're already in the requested state |

### Transportation

The biggest section, and the only one whose read tools are usable by more than staff. Buses, routes, stops, drivers, and weekly schedules are resolved by their names/numbers (unique per org), matching how a person would say them. All twenty-one staff-facing tools need **Manage Students** (there's no dedicated transportation permission in the app, and the real page reuses this same one). `get_student_transportation` and `get_transportation_live_status`, when asked about a specific student, are also open to **a guardian asking about their own linked child** and **a student asking about themself** - not staff-only - matching the real parent/student dashboards, which show exactly this data. Nothing here can start/end a trip or post a GPS location - those represent a driver physically operating a vehicle right now, which isn't something Mira should ever simulate.

**Translating GPS to plain English** is the headline capability: the app itself only ever shows a raw map pin and a timestamp (no reverse geocoding, no next-stop, no ETA exist anywhere in the codebase) - `get_transportation_live_status` adds all three. It reverse-geocodes the latest ping into a real address (OpenStreetMap Nominatim, same free service already used for forward geocoding, with a short cache since the same bus can be asked about repeatedly during one trip), replays the full trip's ping history against the route's stops using the exact same "arrived within 150m, last-passed-stop only moves forward" heuristic the driver's own live map computes client-side (nothing server-side persists "which stop are we at"), and estimates the next stop's ETA from distance and the ping's own speed (falling back to an assumed 25 km/h if the bus is reported stationary). If there's no active trip, it says so plainly instead of returning stale or blank data.

| Tool | Notes |
|---|---|
| `list_transport_buses` | Number, name, plate, capacity, status, assigned driver, vehicle details |
| `list_transport_drivers` | Every Driver-role employee, whether they're in the transportation roster yet, phone/license, assigned bus/route |
| `list_transport_routes` | Name, code, status, destination, and each route's ordered stop list |
| `list_transport_stops` | The full org-wide stop pool (not just ones on a route) - address, coordinates, pickup/dropoff times |
| `list_transport_schedules` | The weekly recurring bus/route/driver assignment per day, with per-day active/inactive status |
| `get_student_transportation` | A student's bus/route/stop/times/driver/distance-from-home, and whether there's a trip active right now. Staff: any student by name. Guardian: their own child (omit name if they have just one). Student: always themself |
| `get_transportation_live_status` | The human-readable "where's the bus" report described above - by student (staff/guardian-of-child/student-self) or by bus/route number (staff only) |
| `create_transport_bus` | Create or edit (same busNumber = upsert) a bus - name, plate, capacity, driver, status, vehicle details |
| `set_transport_bus_status` | active / in_service / maintenance / out_of_service - hold/pause a vehicle. Reversible, immediate |
| `delete_transport_bus` | **DESTRUCTIVE.** Its weekly schedule rows are deleted too; assigned students lose that bus. Warns first with exact counts - the real page has zero such warning today |
| `create_transport_route` | Create or edit (same routeName = upsert) a route - code, status, destination, stops. Passing `stopNames` REPLACES the whole stop list; omitting it leaves current stops untouched (the underlying edit handler would otherwise silently detach every stop on any edit - Mira guards against that) |
| `set_transport_route_status` | active / inactive. Reversible, immediate, never touches the route's stops |
| `delete_transport_route` | **DESTRUCTIVE.** Stops become unattached (not deleted); assigned students and schedules lose the route link. Warns first with exact counts |
| `create_transport_stop` | Give lat/lng directly, or an address to auto-geocode |
| `delete_transport_stop` | **DESTRUCTIVE.** Assigned students lose that stop. Warns first with the count |
| `create_transport_driver` | Add/edit (same email = upsert) a driver. A new email creates a brand-new Driver-role employee too, via the exact same invite pipeline as `create_employee`. Passing `scheduleDays` REPLACES the driver's entire weekly schedule - the underlying handler unconditionally wipes and rebuilds it on every save, so Mira only sends it when the caller actually means to replace the week |
| `set_transport_driver_status` | active / inactive, transportation-only (doesn't touch their employee login - use `set_employee_hold` for that). A direct status update, not a full edit, so it can never accidentally wipe their schedule the way calling the real edit form would |
| `delete_transport_driver` | Removes them from the transportation roster only - never deletes their employee account or login. Warns first if schedule rows reference them |
| `create_transport_schedule` | One bus's route/driver/times for one day of the week. Blocked if that bus already has an entry for that day (the real form allows a silent duplicate; Mira doesn't) |
| `set_transport_schedule_status` | Pause/resume one bus's one-day entry - the most granular hold in the whole feature |
| `delete_transport_schedule` | Deletes one day's entry. Nothing else references a schedule row, so no wider impact |
| `assign_student_transportation` | Give a student bus/route/stop access |
| `remove_student_transportation` | Revoke a student's bus access (soft - deactivates the assignment, doesn't delete it, so re-assigning later just works) |

### Events & Announcements

Two simple tables (`school_events`, `announcements`) that nothing else in the app references, so deletes have zero blast radius beyond the row itself - and unlike some other pages, the real create/update/delete routes here already re-verify **Publish Events & Announcements** server-side, so there was no gap to patch. **Not the same feature as the pre-existing `create_announcement` tool** - that one posts to a completely different, platform-level admin announcements table; these new tools are named `*_event`/`*_school_announcement` specifically so the two are never confused. Events are identified by exact name (plus date, if the name repeats - real data in this org already has two same-named, same-dated events, so this is a genuinely tested case, not theoretical); announcements are identified by a distinctive snippet of their text.

`list_events` returns a `timing` label ("today" / "tomorrow" / "in 5 days" / "3 days ago") alongside each date and supports `when=today|upcoming|past` filtering - this is how Mira answers "what's happening today" or "what's the next event" without the caller having to do date math themselves. Both list tools default to the current school year/term, matching what the real page itself shows; pass `scope="all"` to see every term.

`visibility` (`org` / `public` / `both`) controls whether an item appears on the school's public website. Mira defaults every new/edited item to **`org` (internal-only)** rather than the database's own `both` default - never publishes something externally unless explicitly told to.

| Tool | Notes |
|---|---|
| `list_events` | Name, date, details, visibility, human timing label, filterable by term-scope and date-window |
| `list_school_announcements` | Message text, visibility, when posted |
| `create_event` | Name, date, details, visibility (defaults org). `notifyByEmail` sends a REAL email to guardians immediately - needs explicit confirmation first; omitted, it's off and nothing extra happens |
| `update_event` | Edit name/date/details/visibility - only pass what's changing. Same `notifyByEmail` confirmation gate |
| `delete_event` | **DESTRUCTIVE.** Warns first |
| `create_school_announcement` | Message + visibility (defaults org). Same `notifyByEmail` confirmation gate |
| `update_school_announcement` | Edit text/visibility, identified by a text snippet. Same `notifyByEmail` confirmation gate |
| `delete_school_announcement` | **DESTRUCTIVE.** Warns first |

### School Website

Full control over the org's public-facing website (`/account/managePublicContent`, rendered live at the public dashboard) - gallery images, articles, About Us, layout, style, and self-enrollment settings. Everything needs **Manage Settings**. Three real gaps found and fixed while building/testing this: `updatePublicRegistration` (self-enrollment settings) had **no auth or permission check on the route at all** - fixed directly in the route, not just worked around here; the JSON body size limit (Express default 100kb) was too small to carry an uploaded image through to the new upload endpoint - raised to 10mb app-wide; and `update_website_image`'s `allocation` field had no server-side whitelist at the internal-API layer - the real `updateImagePost` handler does a raw SQL `UPDATE` with zero validation of its own (the browser's `<select>` only offering "hero"/"slideshow" is a client-side constraint, not a real guard), and the tool schema's `enum` only shapes what the model is *likely* to send, not a hard boundary - fixed by validating `allocation` against `["hero","slideshow","siteImage"]` at the actual trust boundary (`updateWebsiteImageApi`), same pattern already used for layout/theme.

**Images and vision, together**: `upload_website_image` doesn't take image bytes as a tool parameter - Mira already sees an image the user attaches in chat natively (vision), and the model would have to re-type millions of characters of base64 to pass it as a text argument, which isn't practical. Instead, the actual attached image now flows through a small, new `context` argument added to every tool call (`mira/tools/index.js`'s `runTool`, additive and non-breaking for all other tools) - Mira looks at the photo, writes a real caption describing what it actually sees, and calls this tool with just that caption; the real image bytes are grabbed straight from the conversation's attachment and uploaded for real, no re-typing involved. Verified end-to-end against the real production S3 bucket: uploaded a real file, confirmed it's genuinely publicly fetchable at its stored URL (same URL the public website itself would render), then confirmed real deletion removes it from S3, not just the database row.

Images/articles are identified by `imageId`/exact heading, or (for images) a distinctive caption snippet - ambiguous if more than one matches (real data in this org already has three images sharing an identical caption, a genuinely tested case). Article headings aren't unique in the database either (no constraint, matching the real app) - `create_website_article` will happily create a second article with a heading that already exists, and Mira's own `update`/`delete` tools then correctly detect and reject the resulting ambiguity (rather than guessing which one) the moment you try to act on that heading again; tested end-to-end (create duplicate -> confirmed 409 ambiguous on the next lookup -> cleaned up). Settings (`about-us`, layout, theme, self-enrollment) all share one JSON column in the database that four different real form submissions read-patch-write independently - Mira's tools fetch the current value first and only change the fields explicitly given, so editing just the motto can never accidentally wipe the saved contact emails/phones.

**Allocation semantics, tested with a real 5-image mixed batch** (upload 5, set some to gallery/`siteImage`, others to `hero`): at upload time `contentType` can only be `slideshow` or `siteImage` (`hero` isn't offered - matches the real form, which only exposes "hero" as an *edit-time* option); moving an image to `hero` afterward is always a separate `update_website_image` call. The database has no uniqueness constraint on `allocation = 'hero'` - multiple images can be marked hero simultaneously (confirmed: 3 QA images set to hero at once, all persisted), but the real public-facing page's hero query (`... WHERE allocation = 'hero'` with no `ORDER BY`, taking only `rows[0]`) only ever displays one of them, arbitrarily. Mira will let a user mark several images hero if asked, but should mention only one will actually show publicly if the user seems to expect all of them to appear as heroes.

| Tool | Notes |
|---|---|
| `list_website_gallery_images` | imageId, URL, caption, allocation (hero/slideshow/siteImage) |
| `list_website_articles` | Heading + paragraph for every article |
| `get_website_about_us` | About text, motto, public contact emails/phones |
| `get_website_settings` | Layout, style/theme, self-enrollment (enabled/dates/price/currency) |
| `upload_website_image` | Publishes an image attached in the current chat message, with a real caption Mira wrote after actually looking at it - see above |
| `update_website_image` | Edit caption/allocation - only pass what's changing |
| `delete_website_image` | **DESTRUCTIVE.** Removes the real file from storage, not just the listing. Warns first |
| `create_website_article` | Heading (3-100 chars) + paragraph (10+ chars) |
| `update_website_article` | Edit heading/paragraph, identified by exact current heading |
| `delete_website_article` | **DESTRUCTIVE.** Warns first |
| `update_website_about_us` | About text/motto/emails/phones - only pass what's changing; emails/phones REPLACE the whole list when given |
| `set_website_layout` | One of 4 real layout designs |
| `set_website_theme` | Visual color style |
| `set_website_self_enrollment` | Enabled/dates/price/currency - only pass what's changing. Never invents a price the user didn't give |

### Docs/Sheets

Full control over `/documents` - create, edit, share, assign, and delete Docs (rich text) and Sheets (spreadsheets). Access has two independent layers, both re-derived from the database exactly like the real page: the org-wide **Manage Records** permission (create/delete/manage-sharing/insert-class-data/see every doc in the org), and a per-document `view`/`comment`/`edit` level granted either directly to a person or via a class assignment reaching everyone on that class's staff roster. A document's creator and any Manage Records holder always get `edit`, permission row or not.

**Three real, pre-existing bugs found and fixed while building this** (none were introduced by Mira - they were already broken for every real user of the feature, just never hit before): `getClassData` ("Insert Students"/"Insert Subjects") joined `enrollments` on a `student_id` column that doesn't exist, and filtered students on a `students.status` column that doesn't exist either - fixed to join through `enrolled_students` (the real per-student-per-class-per-term table) with no status filter, since term/class membership there already means "active in this class this term." The same handler's subjects query also referenced a `class_subjects` junction table that doesn't exist - fixed to read `subjects.class_id` directly (subjects belong straight to a class in this schema, no junction table). Separately, every class-based permission/notification check across the whole feature (`documentEditor`, `documentsList`, `_hasEditPermission`, `classDocuments`, the new-assignment teacher-email lookup) queried a `class_employees` table that doesn't exist - fixed to `user_classes` (the real table). Before this fix, **"assign a doc to a class" didn't actually work at all** - a teacher on that class trying to open the document via class access alone would hit a 500 and get bounced back to the doc list; verified fixed end-to-end (a teacher who reached edit access purely through a class assignment, no direct share, could open and actually edit the document).

Content is a single JSON blob per document, replaced wholesale on save (a Quill Delta for Docs, `{cells, colCount, rowCount}` - a sparse `"A1"->value` map - for Sheets) - there's no cell-level or paragraph-level API in the real app, so every Mira write tool fetches the current blob, merges the change in JS, and writes the whole thing back. `set_sheet_cells` only touches the cells you name (everything else in the sheet is untouched) and auto-grows the grid if you write past its current bounds. Formula cells (starting with `=`) are stored as raw text - Mira doesn't evaluate them, same as the server; only the client-side editor computes results when the sheet is opened. `set_document_text` only exposes plain text, not rich formatting (bold/italic/color) - `mode: "append"` preserves whatever formatting already existed elsewhere in the doc since it only adds new plain-text ops, but `mode: "replace"` wipes it, same as the real editor's save-the-whole-thing behavior.

Sharing (`document_permissions`) and class assignment (`document_class_assignments`) are each a destructive replace-all on the real `updatePermissions` endpoint - share/assign/remove tools fetch the current list, merge in just the one change, and resend the full array, so adding one person's access never wipes anyone else's (tested: assigning a second class left the first class's assignment intact).

| Tool | Notes |
|---|---|
| `list_documents` | documentId/title/type/creator/updated - scoped to what the caller can actually see, same as the real page. Optional className filter |
| `get_document` | Full content (plain text or cell map), who it's shared with, class assignments, and the caller's own access level |
| `create_document` | title + docType (document/spreadsheet). Needs Manage Records |
| `set_document_title` | Rename. Needs edit access |
| `set_document_text` | Doc only. replace or append plain text |
| `set_sheet_cells` | Sheet only. Set/clear specific cells by A1-style ref, merge semantics |
| `resize_sheet` | Sheet only. Grow-only, add rows/columns |
| `insert_class_data_into_sheet` | Sheet only. Mirrors the editor's Insert Students (column A)/Insert Subjects (row 1 from column B) buttons exactly, including that both overwrite existing cells there. Needs Manage Records |
| `share_document_with_user` | Direct view/comment/edit grant to one person, merge semantics. Needs Manage Records |
| `remove_document_share` | Removes one person's direct grant only. Needs Manage Records |
| `assign_document_to_class` | Assigns to one class, merge semantics. Notifies that class's teachers by email + in-app. Needs Manage Records |
| `unassign_document_from_class` | Removes one class's assignment only. Needs Manage Records |
| `delete_document` | **DESTRUCTIVE.** Soft-deleted, but no restore feature exists anywhere in the app. Warns first. Needs Manage Records |

## Deliberately NOT covered yet

- Activating, connecting, disconnecting, or configuring ANY integration (Google Classroom, WhatsApp, SMS providers, Student Portal, Transportation) - by explicit user requirement, Mira can only report what's active/connected, never change it. `getIntegrationsStatusApi` in `controllers/internalApiController.js` deliberately imports only the read-only `get*IntegrationStatus` function from each integration's utils module and nothing else - the activate/connect/disconnect/save-settings/OAuth-token functions in those same modules are never imported, so there's no code path here that could touch them even by mistake.
- Sending or resending an arbitrary/custom email from the Email Issues page - the real page has no compose-new-email or resend-original-message feature (there's no stored subject/body to resend), only "correct this person's address and re-verify it." `fix_failed_email` is that one real action; it's not a general-purpose email sender.
- Any action on the Birthdays page - the real page has none (confirmed: no forms, no buttons, no fetch calls in the template), it's pure reporting. `get_upcoming_birthdays` matches that exactly.
- PayGira billing display config, cross-class grade-presentation propagation, and classroom-remark-type management inside Report Settings' `display_settings` - these are real fields on the page but genuinely the most complex nested config in the app; `set_report_card_display_options` reads and rewrites them completely unchanged rather than exposing edit controls for them. Use the real page for these specifically.
- Bulk-editing promotion settings across many classes/rows in one call (the real page supports a multi-row bulk editor) - `set_promotion_settings` is deliberately one class at a time, for a cleaner audit trail per change.
- Custom remark TYPE creation (e.g. adding a whole new "Sports" remark category alongside teacher/conduct/attitude/interest) - `add_remark`/`list_remarks`/`delete_remark` only manage remark TEXT within the existing types (built-in + any already-created custom ones); creating a new custom type stays manual-UI-only for now.
- Editing an existing grading band's range/label in place - `set_grading_scale_band` always creates a new band (or the real handler's own upsert-by-range logic updates one matching the exact same from/to percentages); to genuinely change a band's range, delete the old one and create the new one.
- Student/guardian photo upload during `create_students` - the real form supports it, but wiring an attached-chat-image through to a specific student/guardian in a batch (same `context.images` mechanism as `upload_website_image`) added real ambiguity (which photo goes with which of N students?) for a field that's entirely optional and already defaults cleanly to the placeholder image. Skipped for now; add a photo manually via the real page afterward if wanted.
- Editing an already-created student's details (name, class, custom ID, etc) or deleting a student outright - both stay manual-UI-only, same reasoning as Employees: real hard-delete and identity changes on a live student record are the highest-stakes actions on this page. `create_students` is create-only.
- Bulk-importing students directly from an uploaded file (CSV/Excel/PDF/OCR) - the real page's `parseBulkStudents` endpoint only *parses* a file into form fields for a human to review before submitting; there's no separate bulk-insert endpoint and no fixed downloadable template to validate against. `create_students` covers the actual "add many students in one go" use case directly (just describe the students, or paste/attach the data and let Mira extract it) without needing a file upload step at all.
- Approving/rejecting a pending admission WITH inline edits in the same call - the real "Approve" button supports this (edit-then-approve in one submit), but Mira keeps them as two separate tools (`update_pending_admission` then `approve_pending_admission`) for a cleaner audit trail and so a mistake in the edit doesn't also trigger the irreversible approval.
- Uploading a "slideshow" image without also being asked to (`upload_website_image` defaults to `siteImage`) - a slideshow upload creates a whole new `slideshows` grouping row every time in the real app (by design, not a bug Mira should paper over), so Mira only does it when the user actually asks for the homepage slideshow specifically.
- Events/announcements are NOT manageable from the School Website tools above, even though the underlying admin page's own controller fetches them - the real page has no UI for it at all (dead/inert wiring left over in that controller), so it's genuinely not a feature to expose. Use the separate `create_event`/`create_school_announcement` tools (Events & Announcements section) instead - `visibility: "public"`/`"both"` on those is what actually makes an item appear on the public website.
- Editing term dates/names on an existing year, or changing which year/term is "current" - this bundles enrollment-carryover side effects too consequential to automate from chat. Manual UI only for now.
- Reassigning which classes/subjects a test is attached to (`modify_test` is metadata-only) - the real form's reconciliation logic (preserving scored rows when a class/subject is dropped) is materially riskier to expose than the rest of assessment management, left to the UI for now.
- Uploading/importing questions from a PDF/Word/Excel/image file (AI extraction) - inherently tied to a file-upload flow, not a fit for chat; type or describe questions directly instead.
- The org-level "Set Assessment Questions" feature flag (a plan/subscription toggle) isn't re-checked by Mira the way the browser route does - only the per-user permission is. Irrelevant for orgs where the feature is already enabled (as it is here), but a plan without it wouldn't be blocked from Mira the same way it's blocked from the page.
- Incrementally adding/removing a single student from an enrollment - the real app doesn't have this either (Modify Enrollment always replaces the whole roster), so `set_enrollment_roster` requires the complete intended list each time; use `get_enrollment_roster` first to see the current state.
- Per-student promotion overrides (custom destination class, or which subjects carry over) - the real page supports editing these before running, but Mira only runs promotions using the default computed decisions. Use the manual UI for one-off overrides, then let Mira run the promotion.
- Modifying an existing employee's role, permissions, or class/subject assignments, and deleting an employee outright - both stay manual-UI-only for now (real hard-delete, and permission escalation, are the highest-stakes actions on this page and the easiest to get wrong via chat). Subject assignment on `create_employee` is also left out - subject names can collide across classes in a way that's genuinely ambiguous to resolve safely by name alone.
- Editing a guardian's contact info, sending a portal password-setup email, and relinking/unlinking a student from a guardian - the Guardians page is read-only in Mira for now. The real write endpoints for these don't independently re-check the Manage Guardians permission server-side (only the browser UI hides the buttons), and edits have to keep two parallel guardian tables in sync via fuzzy name/phone/email matching rather than a real foreign key - both are real fragility in the underlying feature, not just extra Mira scope.
- Starting or ending a bus trip, or posting a GPS location - these represent a driver physically operating a vehicle right now; Mira "starting a trip" could make riders/parents believe a bus is running when no one is driving it, so this stays strictly a driver-in-the-vehicle action.
- Editing a bus/route/driver's full details in one call beyond create-or-upsert (e.g. "just change the plate number") - `create_transport_bus`/`create_transport_route`/`create_transport_driver` already double as edit by re-using the same identifying name, so this is really just a documentation note: pass the fields you want changed plus the ones you want kept, since these are upserts, not patches.
- Reverse-geocoded addresses depend on a free public service (OpenStreetMap Nominatim) with a 1-request/second usage policy - `get_transportation_live_status` still returns accurate coordinates, next-stop, and ETA if that lookup fails or is rate-limited, just with "address lookup unavailable" instead of a real address.
- The `/documents?create=1` URL param is a pure browser UX convenience (auto-opens the "New Doc/Sheet" modal) - it doesn't create anything server-side, so it has no Mira equivalent; `create_document` is the real action.
- Rich text formatting (bold/italic/color/lists/etc) on Docs isn't exposed to Mira - `set_document_text` only reads/writes plain text. Applying real Quill formatting programmatically was judged not worth the complexity versus the actual "have Mira write/edit content" use case.
- Comment threads on a doc/sheet - `permission_level: 'comment'` exists in the data model and Mira can grant it, but there's no comment-thread UI anywhere in the real app for that level to actually do anything with (the real editor treats "comment" identically to "edit" for spreadsheet cell inputs, and identically to "view" for the Quill toolbar) - documenting the real app's own inconsistency here, not something to paper over.
- Restoring a deleted Doc/Sheet - deletion is soft (`is_deleted = TRUE`) in the database, but there is no restore endpoint or UI anywhere in the real app, so Mira doesn't offer one either; `delete_document` is worded as permanent for that reason.

## How permission checks actually work

Mira never decides "can this user do X" from their role name (Manager/Supervisor/Teacher/Driver) alone. Every change goes through the same real, per-user permission grant the main app's UI uses (`user_permissions` table) - so a Supervisor individually granted a permission can use it, and a Manager without one is blocked, exactly matching what they'd see in Employees → Modify Employee → permissions. This also includes the "your email matches your organization's own signup email = you're the owner, full access" rule the browser UI already applies - Mira checks the exact same thing rather than being stricter than the real app for that case.
