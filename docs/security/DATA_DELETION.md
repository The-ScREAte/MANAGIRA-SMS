# Returning and deleting a school's data

What Managira does when a school's agreement ends, or when a school asks in writing for its data to
be deleted. The Privacy Policy (section 13) promises deletion from active systems within 60 days,
after the school has had the chance to export its data, with written confirmation on request.
*Last reviewed: November 15, 2026.*

## 1. Confirm the request

- The request comes in writing from the school's main manager or the district's authorized
  contact. Confirm it by replying to the address on file (never only to the sender of the request).
- Record the date received. The 60 days start then, or on the agreement's end date if later.

## 2. Return the data first

- The school exports what it needs: student lists, grades and report cards, attendance, transcripts
  and documents (Reports, Report Builder exports, transcripts as PDF), and PayGira records.
- Managira can also prepare a CSV export of the school's core records (the school, staff, school
  years, classes, students, grades and attendance): Admin › Data export (`/admin/data-export`).
- Agree the date the school confirms it has everything (or 30 days, whichever is first).

## 3. Delete

1. **Stop use:** Admin › Organizations › the school › Delete. The school is put on hold and marked
   deleted, so nobody can sign in.
2. **Report what exists:** `node scripts/schoolDataReport.js <organizationId>` lists, read-only, every
   table that still holds the school's rows. Keep the output.
3. **Delete the records:** Admin › Super dashboard › Permanently delete. This removes the school and,
   through the database's links, its records.
4. **Check nothing is left:** run `node scripts/schoolDataReport.js <organizationId>` again. Every count
   must be 0. Remove anything that remains (tables without a database link to the school) and run it
   again until it shows 0.
5. **Files:** delete the school's folders in file storage (folders carry the school's id, for example
   `images/studentimages/<id>/`, `report-cards/org_<id>/`, `custom-forms/<id>/`).
6. **Backups:** nothing extra. Encrypted backups expire on their normal 30-day cycle, and Render's
   recovery copies within 7 days.

## 4. Confirm in writing

Send the school a short confirmation: what was deleted, the date, the final report showing 0 rows,
and that backups expire by a stated date. Keep a copy with the request.

## Template

> **Confirmation of data deletion**
>
> On [date], at the request of [school / district] received on [date], Managira deleted the school's
> student and staff records, files and account from its active systems. A final check on [date]
> found no remaining records. Encrypted backups containing the data expire no later than [date].
>
> [Name], [title], Managira (ScREAte)
