// Who sees a new feature. A new feature starts on the sandbox shard only. From the admin
// page it can then go to other shards, hubs and schools, or to everyone. Reading it costs
// nothing: each server keeps a copy and refreshes it in the background.
const registry = require("./registry");

// Add a new feature here with access "selected", then wrap it: isOn("key", { organizationId }).
const FEATURES = {
  migration_codes: { label: "Authenticator codes for the data migration, the Migration queue and restricted old-system records (off: managers open them without a code)", access: "off" },
  class_settings: { label: "Class settings: a Class settings page in each classroom and in Management (lunch on or off; what is shared with parents and with students: attendance, lunch, report cards, bus), a summary of the school attendance calendar linking to Settings, and the Class Settings permission", access: "selected" },
  sign_in_authenticator: { label: "Two-step sign-in with an authenticator app: each member of staff can turn it on for themselves; a manager can require it for managers and supervisors, for all staff, or for one person (Settings › Tenant configuration, Edit user)", access: "selected" },
  family_gpa: { label: "GPA for families: this term's and the cumulative GPA on the parent portal (Academic info) and the student portal (dashboard tile, Grades panel), unless the class's Class settings › Share with › GPA is off", access: "selected" },
  transcript_designs: { label: "Transcript designs: five designs chosen in Report Settings, the document-viewer transcript page, and each finished term's GPA and the cumulative GPA on every transcript (while off: the original page, with GPA only when Report Settings' GPA switch is on)", access: "selected" },
  gpa_credits: { label: "Course credits: each subject's credits (Report Settings › GPA weights) weight GPA by credit, and transcripts show credits attempted and earned each term and in total", access: "selected" },
  report_remarks_forms: { label: "Report remarks in the Custom editor (on for every school, this switch no longer gates it): the built-in Report remarks section (suggestions from the school's ready-made remarks, each field printing as a remark), forms shown beside each student in the classroom, and which Custom editor sections print chosen in Report Settings", access: "everyone" },
  state_reporting: { label: "Gov/state reports: Report Builder reports as the state's files (CSV, tab, pipe or fixed width, the state's field names, codes and dates), checked before they go, made on count dates and kept locked until downloaded", access: "selected" },
  report_builder_more: { label: "Report Builder: an Open in Managira column that links each row to its page (student, staff, parent or class), clickable on screen and in Excel, and five more views: Classes, Subjects, Assessments list, Bills and Emails from Managira", access: "selected" },
  weekly_briefing: { label: "Weekly briefing: one short email a week to each family (and to students with a student-portal login) about attendance, new grades, the bus, daily class records like lunch, forms, payments and the week ahead. The school chooses the day, time and sections in Management Tools; a class can choose its own", access: "selected" },
  attendance_notices: { label: "Attendance notices: a student can be marked late on the class attendance page, and each class (Class settings) tells parents when a student is absent or late several times in a week, with the number to wait for (3 to start).", access: "selected" },
  alert_rules: { label: "Alerts people set for themselves: parents, students, teachers and drivers choose what they are told about (a score below or above a percentage, a child absent, a rider not coming) and how (in Managira, email, text message, or in the weekly briefing)", access: "selected" },
  portal_requests: { label: "Parent and student portals: Requests (what the school asks them to fill in, new and done, and bus requests), the bus's Track and Not coming in one button, a student's My tiles / Requests / Bus reports tabs, and a child's Messages showing only that child's", access: "selected" },
  teacher_cards: { label: "Teachers on a child's page: main, assistant and subject teachers with what the class shares (email, phone, About me), and About me on each staff profile (a fun fact and up to two photos)", access: "selected" },
  family_link: { label: "One parent sign-in for children at several Managira schools: other schools' children (same sign-in email, proven by an emailed code) on My children with their school's logo, opened in that school's own portal, and a notice instead of a new password when another school adds them", access: "selected" },
  mira_skills: { label: "Mira skills: playbooks Mira follows, each person's own and the school's (made by those with Mira Settings), used automatically when a request matches, in every chat, or when picked, with a starter library for school work", access: "selected" },
  mira_forms: { label: "Mira: forms and requests - who still has a form to fill in (by class or grade, server totals) and a reminder to only those families, after a preview and the person's yes", access: "selected" },
  // On for everyone from the start (at the school's request, 2026-11-23); it can still be switched off here.
  mira_report_cards: { label: "Mira and report cards: write each student's report-card remarks (from their grades or attendance when asked, every remark previewed first) and put the school's uploaded signatures on chosen classes", access: "everyone" },
  mira_read_more: { label: "Mira reads every area the person can open: one search across the school, student, staff and family profiles, scores, report card status, transcripts and GPA, schedules, lunch, attendance by dates, Custom editor forms and answers, calendars and free/busy, tasks, notifications, the activity log, class settings, parent messages, briefings, driver reports, bus requests, trips, ledgers and overdue balances (read only)", access: "selected" },
  page_finder: { label: "Page finder: Ctrl+K (Cmd+K on a Mac) opens a small search for any page the person can open (Management, Reports, Admissions, PayGira, Settings and more), jumps there with the keyboard, and offers a search of people and records", access: "selected" },
  first_setup: { label: "First-time setup: a school that hasn't personalized yet is walked through its colour, logo, basic details, school year and website look (each optional step can be skipped) before its dashboard", access: "selected" },
  email_refresh: { label: "Emails: the new clean design (school name at the top, a quiet footer with a working unsubscribe for optional emails), sent as \"<school> via Managira\" with replies going to the school. Managira's own emails change once released to everyone", access: "selected" },
};

const ACCESS = new Set(["off", "selected", "everyone"]);
const REFRESH_MS = Number(process.env.SHARD_CACHE_MS || 30000);

let saved = new Map();
let sandbox = { schools: new Set(), hubs: new Set() };
let loading = null;

function refresh() {
  if (!loading) {
    const control = registry.controlDb();
    loading = Promise.all([
      control.query(`
        SELECT a.feature_key, a.access, a.organization_ids, a.hub_ids,
               ARRAY(SELECT s.organization_id FROM shard_schools s WHERE s.hub_id = ANY(a.hub_ids) OR s.shard_id = ANY(a.shard_ids)) AS reached_schools,
               ARRAY(SELECT h.hub_id FROM shard_hubs h WHERE h.shard_id = ANY(a.shard_ids)) AS reached_hubs
          FROM shard_feature_access a`)
        .then(({ rows }) => {
          saved = new Map(rows.map((row) => [row.feature_key, {
            access: row.access,
            schools: new Set([...row.organization_ids, ...row.reached_schools].map(Number)),
            hubs: new Set([...row.hub_ids, ...row.reached_hubs].map(Number)),
          }]));
        }),
      control.query(`
        SELECT d.organization_id, NULL::int AS hub_id FROM shard_schools d JOIN shards s ON s.shard_id = d.shard_id WHERE s.environment = 'sandbox'
        UNION ALL
        SELECT NULL, h.hub_id FROM shard_hubs h JOIN shards s ON s.shard_id = h.shard_id WHERE s.environment = 'sandbox'`)
        .then(({ rows }) => {
          sandbox = {
            schools: new Set(rows.filter((row) => row.organization_id).map((row) => Number(row.organization_id))),
            hubs: new Set(rows.filter((row) => row.hub_id).map((row) => Number(row.hub_id))),
          };
        }),
    ])
      .catch(() => {}) // Keeps the last known answer. Before the migration: the defaults.
      .finally(() => { loading = null; });
  }
  return loading;
}

// Kept fresh on a timer, so a server that has been quiet never answers from an old copy.
let timer = null;
function keepFresh() {
  if (timer) return;
  refresh();
  timer = setInterval(refresh, REFRESH_MS);
  timer.unref();
}

function isOn(key, { organizationId = null, hubId = null } = {}) {
  keepFresh();
  const entry = saved.get(key);
  const access = entry?.access || FEATURES[key]?.access || "everyone";
  if (access === "everyone") return true;
  if (access === "off") return false;
  if (sandbox.schools.has(Number(organizationId)) || sandbox.hubs.has(Number(hubId))) return true;
  if (!entry) return false;
  return entry.schools.has(Number(organizationId)) || entry.hubs.has(Number(hubId));
}

async function featureList() {
  const control = registry.controlDb();
  const [access, schools, hubs, shards] = await Promise.all([
    control.query("SELECT * FROM shard_feature_access").then(({ rows }) => rows).catch(() => []),
    control.query("SELECT d.organization_id, d.name, d.hub_id, s.name AS shard FROM shard_schools d JOIN shards s ON s.shard_id = d.shard_id ORDER BY LOWER(d.name)").then(({ rows }) => rows).catch(() => []),
    control.query("SELECT d.hub_id, d.name, s.name AS shard FROM shard_hubs d JOIN shards s ON s.shard_id = d.shard_id ORDER BY LOWER(d.name)").then(({ rows }) => rows).catch(() => []),
    registry.listShards({ fresh: true }),
  ]);
  const onSandbox = (row) => shards.some((shard) => shard.name === row.shard && shard.environment === "sandbox");
  const byKey = new Map(access.map((row) => [row.feature_key, row]));
  return {
    schools: schools.map((row) => ({ ...row, sandbox: onSandbox(row) })),
    hubs: hubs.map((row) => ({ ...row, sandbox: onSandbox(row) })),
    shards: shards.filter((shard) => shard.status === "active" && shard.environment !== "sandbox"),
    sandboxName: shards.find((shard) => shard.environment === "sandbox")?.name || null,
    features: Object.entries(FEATURES).map(([key, feature]) => ({
      key,
      label: feature.label,
      access: byKey.get(key)?.access || feature.access,
      organizationIds: byKey.get(key)?.organization_ids || [],
      hubIds: byKey.get(key)?.hub_ids || [],
      shardIds: byKey.get(key)?.shard_ids || [],
    })),
  };
}

const toIds = (value) => [...new Set([].concat(value || []).map(Number))].filter((id) => Number.isInteger(id) && id > 0);

async function saveFeature(key, { access, organizationIds, hubIds, shardIds }, actor) {
  if (!Object.hasOwn(FEATURES, key)) throw new Error("That feature doesn't exist.");
  if (!ACCESS.has(access)) throw new Error("Choose who sees it.");
  await registry.controlDb().query(
    `INSERT INTO shard_feature_access (feature_key, access, organization_ids, hub_ids, shard_ids, updated_by, updated_at)
     VALUES ($1, $2, $3, $4, $5, $6, NOW())
     ON CONFLICT (feature_key) DO UPDATE SET access = EXCLUDED.access, organization_ids = EXCLUDED.organization_ids,
       hub_ids = EXCLUDED.hub_ids, shard_ids = EXCLUDED.shard_ids, updated_by = EXCLUDED.updated_by, updated_at = NOW()`,
    [key, access, toIds(organizationIds), toIds(hubIds), toIds(shardIds), actor]
  );
  await refresh();
}

module.exports = { FEATURES, isOn, featureList, saveFeature, refresh, keepFresh };
