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

## Change things (each requires the specific real permission below)

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

### Announcements

| Tool | Permission required | Notes |
|---|---|---|
| `create_announcement` | Publish Events & Announcements | Banner announcement, title + body |

## Deliberately NOT covered yet

- Editing term dates/names on an existing year, or changing which year/term is "current" - this bundles enrollment-carryover side effects too consequential to automate from chat. Manual UI only for now.

## How permission checks actually work

Mira never decides "can this user do X" from their role name (Manager/Supervisor/Teacher/Driver) alone. Every change goes through the same real, per-user permission grant the main app's UI uses (`user_permissions` table) - so a Supervisor individually granted a permission can use it, and a Manager without one is blocked, exactly matching what they'd see in Employees → Modify Employee → permissions.
