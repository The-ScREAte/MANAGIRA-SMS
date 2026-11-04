# Managira: Code and Data Architecture

How the whole app is built and how it runs: code tree, who can log in, the database,
Mira, background jobs, and everything that uses memory.

Figures come from the code and the live database as of 2026-11-03. Memory figures are
measured on a laptop with Node 24 (Render runs Node 20), so treat them as approximate.

---

## 1. The big picture

```
                    Browser (staff, parent, student, driver, hub, admin)
                              │
                              ▼
        ┌──────────────────── Render Web Service ─────────────────────┐
        │  node server.js (port 10000)                                │
        │   ├─ Express app: pages (EJS), forms, JSON APIs             │
        │   ├─ Scheduled jobs (unless RUN_SCHEDULED_JOBS=false)       │
        │   ├─ Mira on port 4100 (unless MIRA_STANDALONE_SERVICE=true)│
        │   └─ Chrome, opened when a PDF is needed                    │
        └──────────┬──────────────────────┬───────────────────────────┘
                   │                      │
                   ▼                      ▼
        Render Postgres (pgvector)     Outside services
        249 tables, 79 MB              S3 (files), Stripe, Paystack, Flutterwave,
        max 103 connections            Resend/email, Telnyx (SMS), WhatsApp,
        64 MB shared buffers           Google (Classroom, Calendar), AI models

   Optional, not set up today:  node worker.js  (jobs in their own service)
```

Stack: Node, Express, EJS pages, PostgreSQL. There is no separate front-end framework
for the main app; pages are rendered on the server. Each school's data is separated by
`organization_id`, not by separate databases.

---

## 2. Code tree

```
MANAGIRA-SMS/
├── server.js              Main app: middleware, routes, startup, shutdown (~1,500 lines)
├── worker.js              Scheduled jobs only, for a separate Background Worker
├── package.json           npm start = node server.js; npm run dev = scripts/dev.js
│
├── config/                db.js: connection pool, retries, run-once table setup
├── routes/ (24)           URL → controller, with permission checks
│   ├── accountRoute       /account        login, settings, integrations, website, billing
│   ├── financeRoute       /account/settings   PayGira and My PayGira
│   ├── payoutRoute        /account/settings   payouts
│   ├── adminRoute         /admin          Managira staff console
│   ├── hubRoute           /hub            hub (group of schools) portal
│   ├── commonRoute        /common         school staff: most of the app
│   ├── printRoute         /print          report cards, merit sheets, signatures
│   ├── transcriptRoute    /transcript     official transcripts
│   ├── enrollmentRoutes   /enrollment     enrolling classes into terms
│   ├── promotionRoute     /promotion      apply and reverse promotions
│   ├── statsRoutes        /stats          analytics
│   ├── documentRoute      /documents      docs and sheets
│   ├── transportationRoute /transportation buses, routes, stops, live tracking
│   ├── driverRoute        /driver         driver portal
│   ├── guardianRoute      /guardian       parent portal
│   ├── studentRoute       /student        student portal
│   ├── announcementRoute  /announcements
│   ├── notificationsRoute /notifications  noticesRoute /notices
│   ├── chatbotRoute       /api/chatbot    help chatbot
│   ├── publicApiRoute     /api/v1         public API for service accounts
│   ├── apiAccessRoute     /api-access     managing service accounts
│   ├── internalApiRoute   /internal/api   Mira's private door into the app
│   └── legalRoute         /legal          public marketing and legal pages
│
├── controllers/ (35)      The work behind each route (~100,000 lines). Largest:
│   ├── commonController      25,022
│   ├── accountController     13,909
│   ├── internalApiController 10,011  (what Mira can do)
│   ├── printController        9,178
│   ├── financeController      8,078
│   └── adminController        7,400
│
├── middleware/ (24)       Runs on requests. See section 3
├── utils/ (150)           Shared logic: permissions menus, report builder, PDF, email,
│                          caches, billing, messaging, calendars, memory protection
├── jobs/                  scheduler.js, keepAlive.js, billing and payout jobs
├── views/                 EJS pages by area:
│   ├── layout.ejs, partials/    shared page frame, header, permission picker
│   └── common/ account/ admin/ hub/ guardian/ student/ driver/ print/
│       finance/ enrollment/ promotion/ stats/ transportation/ legal&Compliance/
├── public/                Browser files: js/ (43), css/ (41), images, service-worker.js
├── mira/                  The AI assistant (section 6)
├── database/, scripts/    Database helpers and one-off maintenance scripts (29)
├── tests/                 Automated tests (node --test)
└── docs/                  This file and other guides
```

---

## 3. What happens on one request

In order, in `server.js`:

```
Request
 1. botProbes              scanners (/.env, .php) get a quick 404
 2. securityHeaders, uploadGate (2 large uploads at a time), crossSiteRequestGuard
 3. School website / subdomain lookup, Mira proxy (mira.* → port 4100)
 4. compression, latency monitor, static files (public/)
 5. /api/v1 public API (no session needed)
 6. session (stored in the user_sessions table)
 7. rate limit, flash messages, passport
 8. setCurrentTerm, hub branding
 9. setAllowedFeatures     the school's plan features
10. setAllowedRoles
11. setAllowedPermissions  this person's real permissions, inside the plan
12. setThemeColor, setMiraStatus, preloadCache
13. page layout, body parsing (10 MB limit), activity log
14. Route → requirePermission → checkFeatureAccess → controller → EJS page
15. notFound, globalErrorHandler (database down = "We'll be right back" page)
```

A permission check always goes through `userHasPermission`
(`middleware/permissionMiddleware.js`):

```
Inside the school's plan?  no → refused, even for the owner
Owner or platform admin?   yes → allowed
Driver?                    yes → refused
Saved permissions?         yes → exactly as ticked
Never saved?               → role defaults, expanded so nobody lost access
```

---

## 4. Who logs in, from top to bottom

```
Managira (platform)
│  Admin, Mini Admin, Internal Worker  → /admin
│  Tables: admin_users, admins, users
│
├── Hub: a group of schools → /hub
│   │  Tables: managira_hubs, hub_users, hub_sessions, hub_billing*, hub_contacts
│   │  A hub can assign a plan: organizations.hub_assigned_plan_id wins over plan_id
│   │
│   └── Organization (the tenant: one school) → organizations.organization_id
│       │
│       ├── Staff → /common, /account           table: users
│       │    Manager       what was ticked (the owner has everything)
│       │    Supervisor    ticked, or role defaults if never saved
│       │    Teacher       same, limited to their classes
│       │    Driver        /driver only, no school permissions
│       │
│       ├── Parent/guardian → /guardian
│       │    guardian_profiles, guardian_accounts, guardian_students, guardians
│       │
│       ├── Student → /student
│       │    students, student_accounts
│       │
│       └── Service account → /api/v1 (API keys)
│            api_service_accounts, api_access_tokens, api_usage, api_allowances
│
└── An organization can also stand alone, with no hub.
```

Plans decide what a school can use: `plans` → `plan_features` → `features`, and
`feature_routes` ties features to pages.

---

## 5. The database

PostgreSQL with `pgvector` (for Mira) and `pgcrypto`. **249 tables, about 79 MB.**
Most tables point to `organizations`: 107 tables have a foreign key to it.

### How the main tables connect

```
plans ── plan_features ── features ── feature_routes
  │
managira_hubs ── hub_users, hub_billing*, hub_activity_logs
  │
organizations  (the tenant: 107 tables point here)
  │
  ├── school_years ── terms ── term_classes
  │
  ├── graduation_year_groups ── classes ── subjects
  │                               │
  │     users ── user_permissions, user_classes, user_subjects, user_mailroom_classes
  │                               │
  ├── students ── enrolled_students, student_subjects, student_term_subjects
  │     │
  │     ├── guardians / guardian_students ── guardian_profiles ── guardian_accounts
  │     ├── assessment_results, category_scores, attendance_records
  │     ├── student_positions, student_term_positions, posted_report_cards
  │     ├── finance_bill_assignments, finance_payments
  │     └── transport_student_assignments
  │
  ├── assessments, assessment_question_sets ── assessment_questions
  │       └── student_assessment_attempts ── student_assessment_responses
  │
  ├── finance_bills ── finance_bill_assignments, finance_bill_collectors
  │
  └── transport_routes ── transport_stops, transport_bus_schedules, transport_drivers
          └── transport_buses, transport_live_locations, transport_trip_sessions
```

### All tables by area (249)

```
Platform and plans
  admin_users admins admin_announcements admin_email_campaigns app_settings plans
  plan_features plan_region_prices plan_region_prices_audit plan_student_tiers
  pricing_regions pricing_region_countries features feature_routes promo_codes
  permissions dynamic_billing_cycles billing_periods donations

Hubs
  managira_hubs hub_users hub_sessions hub_contacts hub_activity_logs hub_billing
  hub_billing_addons hub_billing_charges hub_billing_invoices hub_billing_stripe_refs
  hub_detachment_requests hub_email_preferences hub_user_email_preferences
  hub_integration_prices hub_notification_marks hub_organization_invitations
  hub_saved_reports

School setup
  organizations organization_dashboard organization_email_preferences
  organization_setup_skips organization_plan_change_events
  organization_custom_remark_types organization_attendance_calendars
  organization_attendance_calendar_days school_years terms term_classes term_definitions
  classes subjects subject_library graduation_year_groups enrollments enrolled_classes
  class_schedules class_schedule_entries short_links

Staff
  users user_permissions user_classes user_subjects user_mailroom_classes
  user_extra_organizations user_extra_contact_permissions user_extra_worker_contacts
  user_feature_flags user_ui_preferences user_email_preferences user_feedback
  employee_access_acknowledgements password_reset_tokens user_sessions
  account_appearance staff_term_popup_views org_tasks org_task_assignees
  org_task_comments org_task_reactions employment employment_applications

Students and admissions
  students student_accounts student_contact_methods student_field_values
  student_form_fields student_archive_events archived_student_info enrolled_students
  student_subjects student_term_subjects student_subjects_dedup_backup_2026
  pending_students pending_guardians pending_student_subjects pending_student_payments
  application_field_values public_registration_payments

Parents
  guardians guardian_students guardian_profiles guardian_accounts
  guardian_email_preferences guardian_message_log guardian_payment_methods
  guardian_reports guardian_report_reads guardian_report_recipients
  guardian_report_replies

Assessments and attendance
  assessments assessment_definitions assessment_results category_scores
  assessment_question_sets assessment_questions student_assessment_attempts
  student_assessment_responses student_assessment_lock_overrides attendance_records

Reports and promotions
  student_reports report_settings report_template_classes status_settings remarks
  score_remarks score_remark_class_locks score_remark_default_state
  score_remark_rule_locks student_positions student_term_positions class_positions
  posted_report_cards posted_transcripts obsolete_signatures
  report_paygira_manual_overrides promotion_schedule promotion_schedule_audit
  promotion_schedule_classes promotion_subject_selections custom_report_definitions
  custom_report_favorites custom_report_schedules custom_report_shares

PayGira and payments
  finance_bills finance_bill_assignments finance_bill_collectors finance_payments
  finance_fee_templates finance_student_credits finance_psp_settings
  finance_pending_stripe_payments finance_collection_signoffs
  finance_collection_signoff_corrections finance_arrears_notes finance_arrears_reports
  finance_arrears_email_logs finance_arrears_filter_presets org_payouts
  org_payout_transactions payments stored_cards billing_invoices billing_retry_attempts
  stripe_processed_intents paystack_subaccounts paystack_payouts flutterwave_accounts

Transportation
  transport_buses transport_drivers transport_routes transport_stops
  transport_bus_schedules transport_student_assignments transport_live_locations
  transport_trip_sessions transport_notification_events

Communication
  announcements announcement_views broadcast_announcements
  broadcast_announcement_targets broadcast_announcement_receipts notifications
  notification_dispatches notification_digest_runs notification_dismissals
  notification_policies notification_quiet_streaks notification_reads email_history
  email_delivery_failures email_suppression_list delivery_audit_history
  sms_delivery_logs help_threads help_messages help_responses feedback_requests
  feedback_responses login_ads login_ad_receipts internal_contacts
  internal_contact_note_contributors contact_fields contact_field_sections
  contact_field_values

School website, documents, calendars
  organization_website_settings organization_images organization_texts slideshows
  website_contact_messages documents document_class_assignments document_permissions
  documentation_articles documentation_article_feedback school_events school_event_tags
  personal_events personal_event_tags calendar_connections calendar_feed_tokens
  calendar_imports calendar_push_map calendar_shares birthday_email_log
  birthday_notification_marks birthday_notification_runs
  google_classroom_course_mappings

API and activity
  api_clients api_client_secrets api_service_accounts api_access_tokens
  api_personal_access_tokens api_allowances api_usage api_limit_requests
  api_deleted_records organization_activity_logs

App demo
  app_demo_categories app_demo_features app_demo_screens app_demo_screen_media
  app_demo_capture_windows

Mira
  mira_chats mira_chat_messages mira_embeddings mira_tool_call_log mira_usage_ledger
  mira_tenant_limits mira_user_preferences
```

Largest tables: `assessment_results` 8.2 MB, `category_scores` 6.7 MB,
`organization_activity_logs` 5.4 MB, `mira_embeddings` 4.8 MB, `attendance_records` 3.4 MB.

---

## 6. Mira

```
mira/
├── server.js           Own Express app, port 4100
├── routes/             auth, chat, classes, preferences, upload
├── controllers/        chat, preferences
├── services/
│   ├── orchestrator    Runs a conversation and its tool calls
│   ├── toolSelector    Picks which tools fit the question
│   ├── modelRouter     Chooses the AI model
│   ├── ragService      Finds relevant school content
│   ├── vectorStore     Searches mira_embeddings (pgvector)
│   ├── queue           Reindex queue (BullMQ)
│   └── usageLedger     Tracks use per school
├── tools/ (about 165)  One file per action: createStudents, listEmployees...
├── internalApiClient   Calls the main app
├── jobs/reindexWorker  Updates embeddings
└── db/schema.js        Creates the mira_* tables
```

How a question flows:

```
Person asks Mira
 → mira.* is proxied by the main server to port 4100
 → orchestrator picks tools, asks the AI model
 → a tool calls /internal/api/... with X-Internal-Token and the person's identity
 → internalApiController checks that person's real permissions and plan
 → the answer goes back through the model to the person
```

Mira can never do more than the person using her. She has her own database pool
(4 connections in production) on the same database.

---

## 7. Background jobs

`jobs/scheduler.js` runs these inside the web server today:

| How often | Job |
|---|---|
| Every minute | Recurring billing |
| Every minute | Transport arrival alerts |
| Every minute | Admin email campaigns |
| Every 3 minutes | Retry pending Paystack payouts |
| Every 5 minutes | Payout sweep |
| Every 5 minutes | Google Classroom sync (up to 8 schools) |
| Every 30 minutes | Pull grades from Google Classroom (up to 40 schools) |
| Hourly | Hub billing sweep, weekly digest check, scheduled report emails |
| Daily | Absence alerts, scheduled holds and reminders, purge old admission rejections |
| Weekly | Purge old activity logs |
| Every 10 minutes | Keep-alive self-ping |

---

## 8. Everything that uses memory

### Always in memory once the server starts

| What | About | Notes |
|---|---|---|
| Main app in total | 180 MB | Measured idle, with everything below it included |
| **`googleapis` library** | **114 MB** | The largest single item; loaded at startup even for schools not using Google |
| Mira, loaded into the same process | 44 MB | Avoidable by running Mira as its own service |
| `puppeteer` library | 30 MB | Library only; Chrome itself is separate |
| AWS S3 library | 30 MB | |
| `sharp` image library | 28 MB | |
| `stripe` | 20 MB | |
| `nodemailer` | 19 MB | |
| 150 util files, 35 controllers | Not measured | About 100,000 lines of controller code stays loaded |

### Loaded on first use, then stays

| What | About | Used for |
|---|---|---|
| `exceljs` | 35 MB | Spreadsheet exports |
| `mammoth` | 19 MB | Reading Word files |
| `tesseract.js` | Not measured | Reading text from images |
| `pdf-parse` | 2 MB | Reading PDFs |

### Short bursts, the likeliest causes of hitting the limit

| What | Size | Control now in place |
|---|---|---|
| **Chrome for PDFs** | Not measured; usually the largest burst | 2 PDFs at a time; closes after 1 minute |
| **Uploads held in memory** | Up to 120 MB per request | 2 large uploads at a time, others wait |
| Report Builder exports | Up to 10,000 rows held in memory | Row limit only |
| Bulk report cards | Many PDFs requested together | The same limit: 2 render at once, the rest wait |
| Bulk student import | Up to 10 MB file parsed | File size limit |
| Image and video processing | Sharp, plus `ffmpeg` as a separate program | Admin uploads go to disk |
| Large pages | All Students 2.5 MB, Transportation 875 KB per page view | None |
| Request bodies | Up to 10 MB each | Size limit |
| Scheduled report emails | File built per recipient | One at a time |
| Mira conversations | Tool results and model replies | Limited by traffic |

### Stored lists, all now capped

| What | Cap |
|---|---|
| Five main caches (admin, organization, guardian, static, session) | 3,000 entries each |
| Visitor location lookups | 2,000 |
| Rate-limit counters | 20,000 |
| Email domain lookups | 2,000 |
| Birthday "already emailed" list | 5,000 |
| Password retry counters | 5,000 |
| PayGira version numbers | 2,000 |
| Others (calendars, geocoding, roads, API features, AI discovery, remark options) | 500 to 1,000 |
| Report card posting jobs | 500 |
| Mira's school context cache | **Not capped**; one entry per school |
| Some other small lists keyed by school or file | **Not capped**; limited by number of schools or files |

### Inside the browser, not your server

Saved page copies in the service worker (dropped when access changes, or after 30 minutes).

### On the database server, a separate memory limit

| What | Notes |
|---|---|
| Each open connection | Up to 15 (app) + 4 (Mira) + any worker or laptop |
| Shared buffers | 64 MB; suggests a very small plan |
| `npm run dev` on a laptop | Uses the live database, up to 5 more connections |
| Page setup statements | `CREATE TABLE IF NOT EXISTS` on first use, once per process |
| Sessions | 292 rows, in `user_sessions` |

### What protects the server now

```
utils/processGuards    a failed background task no longer stops the server
utils/memoryGuard      watches the whole container; frees caches at 75%, more at 88%
utils/memoryRelief     clears caches and closes idle Chrome
utils/boundedMap       capped lists
middleware/uploadGate  limits uploads
middleware/botProbes   refuses scanners early
utils/pdfService       limits Chrome
config/db              smaller connection pool, retries
```

### The biggest remaining opportunities, in order

1. Load `googleapis` only when needed: about 114 MB saved at startup.
2. Move PDF creation to its own service, so Chrome can't push the website over its limit.
3. Move background jobs to `worker.js`.
4. Move Mira to its own service: about 44 MB.
5. Stream Report Builder exports and large pages instead of holding them in memory.
