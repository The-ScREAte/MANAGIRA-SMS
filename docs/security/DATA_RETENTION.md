# Data retention schedule

How long Managira keeps each kind of information, and what removes it. Part of the
[written information security program](INFORMATION_SECURITY_PROGRAM.md); the commitments match the
Privacy Policy (section 13). *Last reviewed: November 15, 2026.*

The rule underneath everything: a school's data belongs to the school. Managira keeps student
records for as long as the school uses Managira and tells it to, and deletes them within 60 days of
the end of the school's agreement or its written request ([DATA_DELETION.md](DATA_DELETION.md)).

| Information | Kept | What removes it |
|---|---|---|
| Student records (profiles, grades, attendance, lunch, report cards, transcripts, forms, files, photos) | While the school's agreement lasts, as the school keeps them | The school deletes or archives; at the end of the agreement, the deletion procedure within 60 days |
| Parent and staff accounts and contact details | While the school keeps them | The school removes the person; the deletion procedure at the end |
| Activity log (sign-ins, permission changes, exports, actions) | 3 years | Weekly clean-up (`activity-log-purge`; `ACTIVITY_LOG_RETENTION_DAYS`, 1095) |
| Sign-in sessions | The school's session time (24 hours unless it chose otherwise; up to 90 days with Keep me logged in) | Expire; removed hourly (`SESSION_PRUNE_INTERVAL_SEC`); all of a person's sessions end on a password change |
| Emailed sign-in codes | 10 minutes | Expire; never stored in readable form (only a hash) |
| Remembered browsers (skip the code) | The school's trust duration (1 to 30 days; 3 by default) | Expire; removed 7 days after; cleared on a password change |
| Authenticator app keys and recovery codes | While the person uses the app | Turning it off, or a manager's reset |
| State reporting files (made from Report Builder) | Content 1 year, encrypted; the record of who made, downloaded and sent it stays | Report schedule job removes the content (`state_report_files.expires_at`) |
| Links to student files | 5 minutes (an hour on the email history page) | Expire |
| Text-message links to report cards | 90 days | Stop working after 90 days |
| Data-migration uploads, staging records and snapshots | 30 days after go-live | Nightly `migration-purge` |
| Nightly database backups (once turned on) | 30 days, the newest always kept; a removed one recoverable for 7 more days | Backup job (`BACKUP_KEEP_DAYS`) and the bucket's version rule |
| Render's own database recovery | 3 days (Hobby) or 7 days (Professional and above) | Render |
| Uploaded files after a change or deletion (United States bucket) | 30 days as an older version | The bucket's version rule |
| Server logs | As Render keeps them for the plan | Render |
| Payment records (PayGira) | As tax and accounting law requires | Managira, at the end of the legal period |

Anything not listed is kept only as long as the school keeps it, and is deleted with the school's
data. Reviewed once a year with the information security program.
