// Which tables belong to a school, and how to find a school's rows. A move refuses to run
// while any table is missing from this map, so a new table can never be left behind.
//
// A table with organization_id belongs to the school automatically. Everything else must
// be listed here: LINKED says how its rows reach the school, PLATFORM says it isn't a
// school's data at all.

const ORG = "$1"; // The schools moving.
const HUB = "$2"; // Their hub, when a hub moves with them.
// The parent's columns are always written with its alias. Left bare, a mistyped name would
// silently read the child's own column and match every school's rows.
const via = (column, parentTable, parentKey = column, parentColumn = "organization_id", value = ORG) => {
  const where = (alias) => `${alias}."${column}" IN (SELECT parent_row."${parentKey}" FROM "${parentTable}" parent_row WHERE parent_row."${parentColumn}" IN (${value}))`;
  where.parent = parentTable; // Comes after its parent when copying, before it when removing.
  where.parentColumns = [parentKey, parentColumn];
  where.column = column;
  return where;
};
const tenant = (alias) => `${alias}.tenant_id IN (${ORG})`;
const inHub = (alias) => `${alias}.hub_id IN (${HUB})`;

const LINKED = {
  broadcast_announcements: tenant,
  broadcast_announcement_receipts: tenant,
  broadcast_announcement_targets: via("announcement_id", "broadcast_announcements", "id", "tenant_id"),
  calendar_push_map: via("connection_id", "calendar_connections"),
  class_schedule_entries: via("schedule_id", "class_schedules"),
  custom_report_favorites: via("report_id", "custom_report_definitions"),
  custom_report_shares: via("report_id", "custom_report_definitions"),
  document_class_assignments: via("document_id", "documents", "id"),
  document_permissions: via("document_id", "documents", "id"),
  enrolled_classes: via("enrollment_id", "enrollments"),
  enrolled_students: via("enrollment_id", "enrollments"),
  guardian_email_preferences: via("guardian_id", "guardian_profiles"),
  guardian_report_recipients: via("report_id", "guardian_reports"),
  guardian_report_replies: via("report_id", "guardian_reports"),
  guardian_students: via("student_id", "students"),
  mira_chat_messages: via("chat_id", "mira_chats", "id", "tenant_id"),
  mira_chats: tenant,
  mira_embeddings: tenant,
  mira_tenant_limits: tenant,
  mira_tool_call_log: tenant,
  mira_usage_ledger: tenant,
  mira_user_preferences: tenant,
  notification_dismissals: via("notification_id", "notifications", "id"),
  notification_reads: via("notification_id", "notifications", "id"),
  org_task_assignees: via("task_id", "org_tasks"),
  org_task_comments: via("task_id", "org_tasks"),
  org_task_reactions: via("task_id", "org_tasks"),
  pending_guardians: via("pending_id", "pending_students"),
  personal_event_tags: via("event_id", "personal_events", "id"),
  student_assessment_responses: via("attempt_id", "student_assessment_attempts"),
  user_classes: via("user_id", "users"),
  user_email_preferences: via("user_id", "users"),
  user_extra_contact_permissions: via("user_id", "users"),
  user_extra_worker_contacts: via("user_id", "users"),
  user_feature_flags: via("user_id", "users"),
  user_mailroom_classes: via("user_id", "users"),
  user_subjects: via("user_id", "users"),
  // One person's light or dark choice, kept with whichever kind of account it is.
  account_appearance: Object.assign((alias) => `(
    (${alias}.account_kind = 'org' AND ${alias}.account_id IN (${ORG}))
    OR (${alias}.account_kind = 'user' AND ${alias}.account_id IN (SELECT user_id FROM users WHERE organization_id IN (${ORG})))
    OR (${alias}.account_kind = 'guardian' AND ${alias}.account_id IN (SELECT guardian_id FROM guardian_profiles WHERE organization_id IN (${ORG})))
    OR (${alias}.account_kind = 'student' AND ${alias}.account_id IN (SELECT student_id FROM students WHERE organization_id IN (${ORG})))
  )`, { parent: ["users", "guardian_profiles", "students"] }),
};

// Everything a hub owns: it travels only when the hub itself moves.
const HUB_TABLES = {
  managira_hubs: inHub,
  hub_activity_logs: inHub,
  hub_billing: inHub,
  hub_billing_charges: inHub,
  hub_billing_invoices: inHub,
  hub_contacts: inHub,
  hub_detachment_requests: inHub,
  hub_email_preferences: inHub,
  hub_notification_marks: inHub,
  hub_organization_invitations: inHub,
  hub_saved_reports: inHub,
  hub_users: inHub,
  hub_user_email_preferences: via("hub_user_id", "hub_users", "hub_user_id", "hub_id", HUB),
};

// Not a school's data. REFERENCE tables are also kept the same on every shard.
const REFERENCE = [
  "features", "feature_routes", "plans", "plan_features", "pricing_regions", "pricing_region_countries",
  "plan_region_prices", "plan_student_tiers", "billing_periods", "dynamic_billing_cycles", "promo_codes",
  "permissions", "documentation_articles", "app_demo_categories", "app_demo_features", "app_demo_screens",
  "app_demo_screen_media", "login_ads", "feedback_requests", "hub_billing_addons", "hub_integration_prices",
  "donations", "employment", "app_settings",
];

const PLATFORM = new Set([
  ...REFERENCE,
  // The control shard's own work.
  "admin_email_campaigns", "admin_users", "birthday_email_log", "documentation_article_feedback",
  "email_suppression_list", "employment_applications", "help_messages", "help_responses", "help_threads",
  "internal_contacts", "internal_contact_note_contributors", "login_ad_receipts", "plan_region_prices_audit",
  // Sign-ins and one-time links: people sign in again on the new shard.
  "user_sessions", "hub_sessions", "password_reset_tokens",
  // Hub tables stay put when a school moves on its own (a hub's own move takes them along).
  ...Object.keys(HUB_TABLES), "hub_billing_stripe_refs",
  // This system's own tables.
  "schema_migrations", "shards", "shard_schools", "shard_moves", "shard_releases", "shard_deployments", "shard_audit", "shard_hubs", "shard_feature_access",
  // The database's own nightly backups (utils/backups.js).
  "backup_runs",
]);

// Rows shared by every shard inside otherwise school-owned tables: announcements to all
// schools. They are kept the same everywhere, so a school's marks on them can travel.
const SHARED_ROWS = {
  broadcast_announcements: "tenant_id IS NULL",
  broadcast_announcement_targets: "announcement_id IN (SELECT id FROM broadcast_announcements WHERE tenant_id IS NULL)",
};
const SHARED_PARENT_LINKS = new Set(["broadcast_announcement_receipts.announcement_id"]);

const isBackupTable = (table) => /_backup(_|$)/.test(table);

// How a table relates to a school: { kind: "school", where(alias) } or { kind: "platform" },
// or null when nobody has decided yet.
function classifyTable(table, columns, { withHub = false } = {}) {
  if (withHub && Object.hasOwn(HUB_TABLES, table)) {
    return { kind: "school", where: HUB_TABLES[table], parent: HUB_TABLES[table].parent || null };
  }
  if (PLATFORM.has(table) || isBackupTable(table)) return { kind: "platform" };
  if (Object.hasOwn(LINKED, table)) return { kind: "school", where: LINKED[table], parent: LINKED[table].parent || null };
  if (columns.includes("organization_id")) return { kind: "school", where: (alias) => `${alias}.organization_id IN (${ORG})` };
  return null;
}

module.exports = { classifyTable, REFERENCE, PLATFORM, LINKED, HUB_TABLES, SHARED_ROWS, SHARED_PARENT_LINKS };
