// Calendar + tasks ("workspace") schema and shared helpers.
// Events and announcements stay in their existing tables (school_events,
// announcements); this adds times/location/tags to events and a small task
// system (tasks, assignees, replies, reactions) for staff.

let schemaPromise = null;

function ensureWorkspaceSchema(db) {
  if (!schemaPromise) {
    schemaPromise = (async () => {
      await db.query(`
        ALTER TABLE school_events
          ADD COLUMN IF NOT EXISTS end_date DATE,
          ADD COLUMN IF NOT EXISTS start_time TIME,
          ADD COLUMN IF NOT EXISTS end_time TIME,
          ADD COLUMN IF NOT EXISTS all_day BOOLEAN NOT NULL DEFAULT TRUE,
          ADD COLUMN IF NOT EXISTS location TEXT,
          ADD COLUMN IF NOT EXISTS color VARCHAR(20),
          ADD COLUMN IF NOT EXISTS created_by INTEGER
      `);
      await db.query(`
        CREATE TABLE IF NOT EXISTS school_event_tags (
          event_id INTEGER NOT NULL REFERENCES school_events(id) ON DELETE CASCADE,
          user_id INTEGER NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
          organization_id INTEGER NOT NULL REFERENCES organizations(organization_id) ON DELETE CASCADE,
          created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          PRIMARY KEY (event_id, user_id)
        )
      `);
      await db.query(`CREATE INDEX IF NOT EXISTS idx_school_event_tags_user ON school_event_tags (organization_id, user_id)`);
      await db.query(`CREATE INDEX IF NOT EXISTS idx_school_events_org_date ON school_events (organization_id, event_date)`);
      await db.query(`
        CREATE TABLE IF NOT EXISTS org_tasks (
          task_id SERIAL PRIMARY KEY,
          organization_id INTEGER NOT NULL REFERENCES organizations(organization_id) ON DELETE CASCADE,
          title TEXT NOT NULL,
          details TEXT,
          due_date DATE,
          due_time TIME,
          priority VARCHAR(10) NOT NULL DEFAULT 'normal',
          created_by INTEGER NOT NULL DEFAULT 0,
          created_by_name TEXT,
          created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )
      `);
      await db.query(`CREATE INDEX IF NOT EXISTS idx_org_tasks_org ON org_tasks (organization_id, created_at DESC)`);
      await db.query(`
        CREATE TABLE IF NOT EXISTS org_task_assignees (
          task_id INTEGER NOT NULL REFERENCES org_tasks(task_id) ON DELETE CASCADE,
          user_id INTEGER NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
          status VARCHAR(10) NOT NULL DEFAULT 'open',
          done_at TIMESTAMPTZ,
          PRIMARY KEY (task_id, user_id)
        )
      `);
      await db.query(`CREATE INDEX IF NOT EXISTS idx_org_task_assignees_user ON org_task_assignees (user_id)`);
      await db.query(`
        CREATE TABLE IF NOT EXISTS org_task_comments (
          comment_id SERIAL PRIMARY KEY,
          task_id INTEGER NOT NULL REFERENCES org_tasks(task_id) ON DELETE CASCADE,
          author_id INTEGER NOT NULL DEFAULT 0,
          author_name TEXT,
          body TEXT NOT NULL,
          created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )
      `);
      await db.query(`CREATE INDEX IF NOT EXISTS idx_org_task_comments_task ON org_task_comments (task_id, created_at)`);
      await db.query(`
        CREATE TABLE IF NOT EXISTS org_task_reactions (
          task_id INTEGER NOT NULL REFERENCES org_tasks(task_id) ON DELETE CASCADE,
          actor_id INTEGER NOT NULL,
          emoji VARCHAR(16) NOT NULL,
          created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          PRIMARY KEY (task_id, actor_id, emoji)
        )
      `);
      // Personal events: only the owner, people they tag, and people they share their calendar with.
      await db.query(`
        CREATE TABLE IF NOT EXISTS personal_events (
          id SERIAL PRIMARY KEY,
          organization_id INTEGER NOT NULL REFERENCES organizations(organization_id) ON DELETE CASCADE,
          owner_id INTEGER NOT NULL,
          owner_name TEXT,
          title TEXT NOT NULL,
          details TEXT,
          location TEXT,
          event_date DATE NOT NULL,
          end_date DATE,
          start_time TIME,
          end_time TIME,
          all_day BOOLEAN NOT NULL DEFAULT TRUE,
          color VARCHAR(20),
          created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )
      `);
      await db.query(`CREATE INDEX IF NOT EXISTS idx_personal_events_owner ON personal_events (organization_id, owner_id, event_date)`);
      await db.query(`
        CREATE TABLE IF NOT EXISTS personal_event_tags (
          event_id INTEGER NOT NULL REFERENCES personal_events(id) ON DELETE CASCADE,
          user_id INTEGER NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
          PRIMARY KEY (event_id, user_id)
        )
      `);
      await db.query(`CREATE INDEX IF NOT EXISTS idx_personal_event_tags_user ON personal_event_tags (user_id)`);
      // Calendar sync and sharing.
      await db.query(`
        CREATE TABLE IF NOT EXISTS calendar_feed_tokens (
          organization_id INTEGER NOT NULL REFERENCES organizations(organization_id) ON DELETE CASCADE,
          user_id INTEGER NOT NULL,
          token VARCHAR(64) NOT NULL UNIQUE,
          created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          PRIMARY KEY (organization_id, user_id)
        )
      `);
      await db.query(`
        CREATE TABLE IF NOT EXISTS calendar_shares (
          organization_id INTEGER NOT NULL REFERENCES organizations(organization_id) ON DELETE CASCADE,
          owner_id INTEGER NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
          viewer_id INTEGER NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
          created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          PRIMARY KEY (owner_id, viewer_id)
        )
      `);
      await db.query(`CREATE INDEX IF NOT EXISTS idx_calendar_shares_viewer ON calendar_shares (viewer_id)`);
      await db.query(`
        CREATE TABLE IF NOT EXISTS calendar_imports (
          import_id SERIAL PRIMARY KEY,
          organization_id INTEGER NOT NULL REFERENCES organizations(organization_id) ON DELETE CASCADE,
          user_id INTEGER NOT NULL,
          label VARCHAR(80) NOT NULL,
          provider VARCHAR(20) NOT NULL DEFAULT 'other',
          url TEXT NOT NULL,
          last_error TEXT,
          last_synced_at TIMESTAMPTZ,
          created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )
      `);
      await db.query(`CREATE INDEX IF NOT EXISTS idx_calendar_imports_user ON calendar_imports (organization_id, user_id)`);
    })().catch((err) => {
      schemaPromise = null;
      throw err;
    });
  }
  return schemaPromise;
}

const REACTIONS = ["👍", "✅", "🙌", "❤️", "👀"];
const PRIORITIES = ["low", "normal", "high"];
const VISIBILITIES = ["org", "public", "both"];
const PERSONAL = "personal";
const EVENT_COLORS = ["teal", "blue", "violet", "amber", "rose", "green", "slate"];

// Who is acting: staff user id (0 for an account without a users row) + display name.
function resolveActor(req) {
  const s = req.session || {};
  const id = Number(s.userId || (s.user && s.user.user_id) || 0) || 0;
  const first = (s.user && s.user.first_name) || s.firstName || "";
  const last = (s.user && s.user.last_name) || s.lastName || "";
  const name = [first, last].filter(Boolean).join(" ").trim() || s.organizationName || "School admin";
  return { id, name, organizationId: Number(s.organizationId) || null };
}

function cleanText(value, max = 5000) {
  return String(value == null ? "" : value).replace(/\r\n/g, "\n").trim().slice(0, max);
}

function parseDate(value) {
  const s = String(value || "").trim();
  return /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : null;
}

function parseTime(value) {
  const s = String(value || "").trim();
  return /^\d{2}:\d{2}(:\d{2})?$/.test(s) ? s.slice(0, 5) : null;
}

function parseIdList(value) {
  const list = Array.isArray(value) ? value : String(value || "").split(",");
  return [...new Set(list.map((v) => Number(v)).filter((n) => Number.isInteger(n) && n > 0))].slice(0, 50);
}

// Only keep ids that are active staff in this organization.
async function filterStaffIds(db, organizationId, ids) {
  if (!ids.length) return [];
  const r = await db.query(
    `SELECT user_id, first_name, last_name, email
       FROM users
      WHERE organization_id = $1 AND user_id = ANY($2::int[])
        AND LOWER(COALESCE(account_type::text, '')) NOT IN ('admin', 'internal worker', 'mini admin')`,
    [organizationId, ids]
  );
  return r.rows;
}

// True when the signed-in person is a staff member of this organization (not a platform admin).
async function isOrgMember(db, req) {
  const id = resolveActor(req).id;
  if (!id) return false;
  const r = await db.query(
    `SELECT 1 FROM users WHERE user_id = $1 AND organization_id = $2
       AND LOWER(COALESCE(account_type::text, '')) NOT IN ('admin', 'internal worker', 'mini admin')`,
    [id, req.session.organizationId]
  ).catch(() => ({ rowCount: 0 }));
  return r.rowCount > 0;
}

function baseUrl(req) {
  return `${req.protocol}://${req.get("host")}`;
}

// Tasks and tagged events for one person's "Activity & Announcements" card.
async function loadViewerActivity(db, { organizationId, actorId }) {
  await ensureWorkspaceSchema(db);
  const [tasks, tagged] = await Promise.all([
    db.query(
      `SELECT t.task_id, t.title, t.details, t.due_date, t.due_time, t.priority, t.created_by, t.created_by_name,
              t.created_at, t.updated_at,
              me.status AS my_status,
              (SELECT COUNT(*)::int FROM org_task_comments c WHERE c.task_id = t.task_id) AS comment_count,
              COALESCE((SELECT json_agg(json_build_object('id', u.user_id, 'name', TRIM(CONCAT(u.first_name, ' ', u.last_name)), 'first', u.first_name, 'status', a.status) ORDER BY u.first_name)
                          FROM org_task_assignees a JOIN users u ON u.user_id = a.user_id WHERE a.task_id = t.task_id), '[]') AS assignees,
              COALESCE((SELECT json_agg(json_build_object('emoji', r.emoji, 'n', r.n, 'mine', r.mine))
                          FROM (SELECT emoji, COUNT(*)::int AS n, BOOL_OR(actor_id = $2) AS mine
                                  FROM org_task_reactions WHERE task_id = t.task_id GROUP BY emoji) r), '[]') AS reactions
         FROM org_tasks t
         LEFT JOIN org_task_assignees me ON me.task_id = t.task_id AND me.user_id = $2
        WHERE t.organization_id = $1
          AND (me.user_id IS NOT NULL OR t.created_by = $2)
          AND (
            EXISTS (SELECT 1 FROM org_task_assignees o WHERE o.task_id = t.task_id AND o.status = 'open')
            OR t.updated_at > NOW() - INTERVAL '14 days'
          )
        ORDER BY t.updated_at DESC
        LIMIT 30`,
      [organizationId, actorId]
    ),
    db.query(
      `SELECT * FROM (
         SELECT 'event' AS kind, e.id, e.name, e.event_date, e.start_time, e.all_day, e.location, NULL::text AS owner_name
           FROM school_event_tags tg JOIN school_events e ON e.id = tg.event_id
          WHERE tg.organization_id = $1 AND tg.user_id = $2 AND COALESCE(e.end_date, e.event_date) >= CURRENT_DATE - 1
         UNION ALL
         SELECT 'personal', p.id, p.title, p.event_date, p.start_time, p.all_day, p.location, p.owner_name
           FROM personal_event_tags tg JOIN personal_events p ON p.id = tg.event_id
          WHERE p.organization_id = $1 AND tg.user_id = $2 AND p.owner_id <> $2 AND COALESCE(p.end_date, p.event_date) >= CURRENT_DATE - 1
       ) x
       ORDER BY event_date, start_time NULLS FIRST
       LIMIT 10`,
      [organizationId, actorId]
    ),
  ]);
  // Dated things coming up for this person (next 30 days): open tasks and personal events.
  const upcoming = await db.query(
    `SELECT * FROM (
       SELECT 'task' AS kind, t.task_id AS id, t.title AS name, t.due_date AS event_date, t.due_time AS start_time,
              (t.due_time IS NULL) AS all_day, NULL::text AS location
         FROM org_tasks t
        WHERE t.organization_id = $1 AND t.due_date BETWEEN CURRENT_DATE AND CURRENT_DATE + 30
          AND (
            EXISTS (SELECT 1 FROM org_task_assignees a WHERE a.task_id = t.task_id AND a.user_id = $2 AND a.status = 'open')
            OR (t.created_by = $2 AND EXISTS (SELECT 1 FROM org_task_assignees a WHERE a.task_id = t.task_id AND a.status = 'open'))
          )
       UNION ALL
       SELECT 'personal', p.id, p.title, p.event_date, p.start_time, p.all_day, p.location
         FROM personal_events p
        WHERE p.organization_id = $1 AND COALESCE(p.end_date, p.event_date) >= CURRENT_DATE AND p.event_date <= CURRENT_DATE + 30
          AND (p.owner_id = $2 OR EXISTS (SELECT 1 FROM personal_event_tags g WHERE g.event_id = p.id AND g.user_id = $2))
     ) x
     ORDER BY event_date, start_time NULLS FIRST
     LIMIT 12`,
    [organizationId, actorId]
  );
  return { tasks: tasks.rows, taggedEvents: tagged.rows, upcoming: upcoming.rows };
}

module.exports = {
  ensureWorkspaceSchema,
  loadViewerActivity,
  REACTIONS,
  PRIORITIES,
  VISIBILITIES,
  PERSONAL,
  EVENT_COLORS,
  resolveActor,
  cleanText,
  parseDate,
  parseTime,
  parseIdList,
  filterStaffIds,
  baseUrl,
  isOrgMember,
};
