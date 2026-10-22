// Public product tour (/legal/app-demo), managed from /admin/app-demo.
//   sections (app_demo_categories)  e.g. School Management, Parents, Students, Mira
//   └ features                      cards on the page, each opens a guided tour
//     └ screens (steps)             title + explanation, walked through in order
//       └ media (versions)          images, a PDF, or an interactive page capture
//                                   ('html', see utils/appDemoCapture.js), e.g. Light / Dark

const MEDIA_TYPES = {
  "image/jpeg": "image",
  "image/png": "image",
  "image/webp": "image",
  "image/gif": "image",
  "application/pdf": "pdf",
};
const MAX_FILE_BYTES = 25 * 1024 * 1024;
const MAX_FILES_PER_UPLOAD = 20;
const CACHE_TTL_MS = 60 * 1000;

const SECTIONS = [
  { key: "management", name: "School Management", description: "For owners, administrators, teachers and finance staff who run the school day to day." },
  { key: "parents", name: "Parents", description: "What parents and guardians receive from the school, and how their messages reach teachers." },
  { key: "students", name: "Students", description: "The portal students use to follow their classes, records and results." },
  { key: "mira", name: "Mira", description: "Managira's AI assistant, helping staff and families get answers and finish everyday school tasks." },
];

const file = (name) => `/Demo%20Images/${encodeURIComponent(name)}`;
const step = (name, label, caption) => ({ label, caption, media: [{ media_url: file(name), media_type: name.endsWith(".pdf") ? "pdf" : "image" }] });

// The starting tour, written once when the tables are created.
const SEED = [
  { section: "management", title: "Organization Dashboard", tag: "Overview",
    summary: "Get an at-a-glance view of school activity, priority items, and operational updates from one central hub. Every staff member starts here and moves straight into their assigned areas.",
    screens: [step("Organization Dashboard.png", "Organization dashboard", "The school's home screen: activity, priorities and quick links to every area.")] },
  { section: "management", title: "Organization Statistics", tag: "Insights",
    summary: "Monitor school-wide performance, enrollment trends, student progress, and key operational metrics in one consolidated view that also feeds the weekly email digest.",
    screens: [step("Organization Statistics.png", "School statistics", "Enrollment, performance and operations in one consolidated view for leadership.")] },
  { section: "management", title: "Class Dashboard", tag: "Classroom",
    summary: "Manage all classroom activity from one workspace: schedules, reporting, attendance, assessments, payments, and documents. Step through a teacher's complete school day.",
    screens: [
      step("Class Dashboard.png", "Class Dashboard", "The central class workspace with quick access to all teaching actions, updates, and class tools in one view."),
      step("Reporting Page.png", "Reporting Page", "Review class and student performance data with organised summaries to support teaching decisions and progress tracking."),
      step("Class Schedule.png", "Class Schedule", "View the weekly lesson timetable for the class with clear subject and timing breakdowns across the school day."),
      step("Internal PayGira View.png", "My PayGira", "Collectors and overseers manage bill assignments, record payments, and monitor outstanding balances directly from the class workspace."),
      step("Attendance.png", "Attendance", "Capture daily attendance quickly and flag absences for follow-up without disrupting classroom routines."),
      step("Assessment.png", "Assessment", "Enter and review student scores in a consistent grading interface that keeps academic records accurate and organised."),
      step("Documents Page.png", "Documents", "Access and manage class-level documents, shared resources, and official files from a structured document page."),
    ] },
  { section: "management", title: "Student Enrollment", tag: "Admissions",
    summary: "Register new students through a structured, step-by-step admissions workflow that ensures accurate placement and complete records from the first submission.",
    screens: [step("Student Enrollment.png", "Enrollment form", "A guided admissions form that captures every detail needed to place a new student.")] },
  { section: "management", title: "PayGira Finance", tag: "Finance",
    summary: "Run the full payment cycle from one place: create bills, track collections, manage school-wide charges, and configure payment settings.",
    screens: [
      step("PayGira Overview.png", "Overview", "A summary of all active bills, outstanding balances, and recent payment activity across the school."),
      step("PayGira Bill Management.png", "Bill Management", "Create, edit, and manage individual bills with full control over amounts, due dates, and student assignments."),
      step("PayGira Org Wide Stats.png", "Org-Wide Bills", "View and manage bills that apply across the entire organisation, including bulk charges and institution-level fees."),
      step("PayGira Payment Tracking.png", "Payment Tracking", "Monitor payment statuses in real time, identify outstanding accounts, and keep collection records up to date."),
      step("PayGira Fee Recovery.png", "Fee Recovery", "Follow up on overdue accounts and manage arrears recovery workflows to reduce unpaid balances."),
      step("PayGira Settings.png", "Payment Settings", "Configure payment providers, payout destinations, and school-specific billing preferences from one settings panel."),
    ] },
  { section: "management", title: "Report Card", tag: "Academics",
    summary: "Generate polished report cards with grades, teacher remarks, and summary data. Share results by email or the parent portal, no printing required.",
    screens: [step("ReportCard.png", "Report card", "Grades, remarks and term summaries in a clean, printable layout.")] },
  { section: "management", title: "Merit Sheet", tag: "Academics",
    summary: "Review class rankings and comparative performance in a clear merit sheet designed for academic analysis and printing.",
    screens: [step("Merit Sheet.png", "Merit sheet", "Class rankings and comparative performance at a glance.")] },
  { section: "management", title: "Transcript", tag: "Academics",
    summary: "Produce formal transcripts presenting a student's complete academic history, ready for internal review, printing, and official use.",
    screens: [step("Transcript.pdf", "Official transcript", "A student's complete academic history as an official document.")] },
  { section: "management", title: "Report Digest", tag: "Reports",
    summary: "Schools, hubs, parents, and teachers receive scheduled summary emails with attendance highlights and performance updates, automatically, without anyone running a report.",
    screens: [
      step("weekly school Performance.png", "Weekly school performance", "Sent every Monday to school leadership with attendance, term averages, and at-risk classes."),
      step("weekly teachers Summary.png", "Weekly teacher summary", "Each teacher gets their own sections, follow-up list, and grading backlog in one email."),
      step("Weekly Parent Update.png", "Weekly parent update", "Parents see every child's class, term average, attendance, and what is coming up next week."),
      step("Monthly school Overview.png", "Monthly school overview", "Sent on the 1st of the month with enrollment, attendance, billing, and department-level breakdowns."),
      step("weekly Hub Overview.png", "Weekly hub overview", "Hub directors see every member school side-by-side with totals and status flags."),
    ] },
  { section: "management", title: "School Website", tag: "Website",
    summary: "Present your school's public website, built and customized for your institution. Give prospective families, students, and the community a professional first impression.",
    screens: [step("School Website.png", "Public school website", "Your school's identity and information, front and center for families and the community.")] },
  { section: "parents", title: "Parent Communication", tag: "Communication",
    summary: "Keep families informed without extra work: a weekly update for every parent, and a direct line to the teacher when something needs attention.",
    screens: [
      step("Weekly Parent Update.png", "Weekly parent update", "Every parent receives one email covering each child's class, term average, attendance and what is coming up next week."),
      step("Parent-Teacher Comm.png", "Messages to teachers", "Messages parents send arrive in the class workspace, where teachers reply and follow up without leaving the class."),
    ] },
  { section: "students", title: "Student Portal", tag: "Portal",
    summary: "A focused portal that brings academic records, transcript details, and guardian information together in one clear view.",
    screens: [step("Student Portal.png", "Student portal", "Academic records, transcript details and guardian information in one place.")] },
];

let schemaPromise = null;
let schemaReady = false;
let tourCache = { at: 0, tour: null };

function ensureAppDemoSchema(db) {
  if (schemaReady) return Promise.resolve();
  if (!schemaPromise) {
    schemaPromise = createSchema(db)
      .then(() => { schemaReady = true; })
      .catch((err) => { schemaPromise = null; throw err; });
  }
  return schemaPromise;
}

// One transaction under a lock, so the tour is set up exactly once even when
// several servers start together. Also upgrades the first version of these
// tables (no sections, one file per screen) in place.
async function createSchema(db) {
  const client = await db.connect();
  try {
    await client.query("BEGIN");
    await client.query("SELECT pg_advisory_xact_lock(hashtext('app_demo_schema'))");
    const { rows } = await client.query("SELECT to_regclass('public.app_demo_categories') IS NOT NULL AS ready");
    if (!rows[0].ready) {
      await client.query(`
        CREATE TABLE app_demo_categories (
          id SERIAL PRIMARY KEY,
          name TEXT NOT NULL,
          description TEXT,
          sort_order INTEGER NOT NULL DEFAULT 0,
          created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )
      `);
      await client.query(`
        CREATE TABLE IF NOT EXISTS app_demo_features (
          id SERIAL PRIMARY KEY,
          title TEXT NOT NULL,
          category TEXT,
          summary TEXT,
          is_active BOOLEAN NOT NULL DEFAULT TRUE,
          sort_order INTEGER NOT NULL DEFAULT 0,
          created_by INTEGER,
          created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )
      `);
      await client.query(`ALTER TABLE app_demo_features ADD COLUMN IF NOT EXISTS category_id INTEGER REFERENCES app_demo_categories(id) ON DELETE SET NULL`);
      await client.query(`
        CREATE TABLE IF NOT EXISTS app_demo_screens (
          id SERIAL PRIMARY KEY,
          feature_id INTEGER NOT NULL REFERENCES app_demo_features(id) ON DELETE CASCADE,
          label TEXT,
          caption TEXT,
          sort_order INTEGER NOT NULL DEFAULT 0,
          created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )
      `);
      await client.query("CREATE INDEX IF NOT EXISTS app_demo_screens_feature_idx ON app_demo_screens (feature_id, sort_order, id)");
      await client.query(`
        CREATE TABLE app_demo_screen_media (
          id SERIAL PRIMARY KEY,
          screen_id INTEGER NOT NULL REFERENCES app_demo_screens(id) ON DELETE CASCADE,
          label TEXT,
          media_type TEXT NOT NULL,
          media_url TEXT NOT NULL,
          s3_key TEXT,
          mime_type TEXT,
          media_width INTEGER,
          media_height INTEGER,
          sort_order INTEGER NOT NULL DEFAULT 0,
          created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )
      `);
      await client.query("CREATE INDEX app_demo_screen_media_screen_idx ON app_demo_screen_media (screen_id, sort_order, id)");

      // First version: each screen held its one file itself.
      const legacy = await client.query(
        `SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'app_demo_screens' AND column_name = 'media_url'`
      );
      if (legacy.rowCount) {
        await client.query(`
          INSERT INTO app_demo_screen_media (screen_id, media_type, media_url, s3_key, mime_type, media_width, media_height, sort_order)
          SELECT id, media_type, media_url, s3_key, mime_type, media_width, media_height, 1 FROM app_demo_screens
        `);
        await client.query(`
          ALTER TABLE app_demo_screens
            DROP COLUMN media_type, DROP COLUMN media_url, DROP COLUMN s3_key,
            DROP COLUMN mime_type, DROP COLUMN media_width, DROP COLUMN media_height
        `);
      }
      await seed(client);
    }
    // Interactive captures (media_type 'html') keep a rendered cover image, and
    // admins open capture windows for one school at a time.
    // guide: the explanation for each recorded click ([{ text }]); accent: highlight colour;
    // guided: walk visitors through the clicks with Back / Next (otherwise they explore freely).
    await client.query(`
      ALTER TABLE app_demo_screen_media
        ADD COLUMN IF NOT EXISTS poster_url TEXT, ADD COLUMN IF NOT EXISTS poster_s3_key TEXT,
        ADD COLUMN IF NOT EXISTS guide JSONB, ADD COLUMN IF NOT EXISTS accent TEXT,
        ADD COLUMN IF NOT EXISTS guided BOOLEAN NOT NULL DEFAULT TRUE
    `);
    await client.query(`
      CREATE TABLE IF NOT EXISTS app_demo_capture_windows (
        id SERIAL PRIMARY KEY,
        organization_id INTEGER NOT NULL,
        enabled_by INTEGER,
        starts_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        ends_at TIMESTAMPTZ NOT NULL,
        ended_at TIMESTAMPTZ
      )
    `);
    await client.query("COMMIT");
  } catch (err) {
    await client.query("ROLLBACK").catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

// Creates the sections and files every seed feature under its section. A
// feature that already exists (same title) keeps its screens and is only moved.
async function seed(client) {
  const sectionIds = {};
  for (const [i, s] of SECTIONS.entries()) {
    const { rows } = await client.query(
      `INSERT INTO app_demo_categories (name, description, sort_order) VALUES ($1, $2, $3) RETURNING id`,
      [s.name, s.description, i + 1]
    );
    sectionIds[s.key] = rows[0].id;
  }
  const existing = await client.query(`SELECT id, lower(title) AS title FROM app_demo_features`);
  const byTitle = new Map(existing.rows.map((r) => [r.title, r.id]));
  for (const [i, f] of SEED.entries()) {
    const id = byTitle.get(f.title.toLowerCase());
    if (id) {
      await client.query(
        `UPDATE app_demo_features SET category_id = $1, category = $2, sort_order = $3 WHERE id = $4`,
        [sectionIds[f.section], f.tag, i + 1, id]
      );
      byTitle.delete(f.title.toLowerCase());
      continue;
    }
    const feature = await client.query(
      `INSERT INTO app_demo_features (title, category, summary, category_id, sort_order) VALUES ($1, $2, $3, $4, $5) RETURNING id`,
      [f.title, f.tag, f.summary, sectionIds[f.section], i + 1]
    );
    for (const [j, s] of f.screens.entries()) {
      const screen = await client.query(
        `INSERT INTO app_demo_screens (feature_id, label, caption, sort_order) VALUES ($1, $2, $3, $4) RETURNING id`,
        [feature.rows[0].id, s.label, s.caption, j + 1]
      );
      for (const [k, m] of s.media.entries()) {
        await client.query(
          `INSERT INTO app_demo_screen_media (screen_id, media_type, media_url, mime_type, sort_order) VALUES ($1, $2, $3, $4, $5)`,
          [screen.rows[0].id, m.media_type, m.media_url, m.media_type === "pdf" ? "application/pdf" : "image/png", k + 1]
        );
      }
    }
  }
  // Anything else an admin added goes to the first section.
  if (byTitle.size) {
    await client.query(`UPDATE app_demo_features SET category_id = $1 WHERE id = ANY($2::int[])`, [sectionIds.management, [...byTitle.values()]]);
  }
}

// Uploaded PDFs are streamed through the app so PDF.js can read them without
// bucket CORS rules; interactive captures open in their player; images and
// bundled files load directly.
function mediaFileUrl(media) {
  if (media.media_type === "html") return `/legal/app-demo/play/${media.id}`;
  return media.media_type === "pdf" && media.s3_key ? `/legal/app-demo/media/${media.id}/file` : media.media_url;
}

// { sections: [{ ...section, features: [{ ...feature, screens: [{ ...screen, media: [] }] }] }] }
// The public tour leaves out hidden features, steps without a file, features
// without steps and empty sections; the editor (includeHidden) sees everything.
async function getTour(db, { includeHidden = false } = {}) {
  if (!includeHidden && tourCache.tour && Date.now() - tourCache.at < CACHE_TTL_MS) return tourCache.tour;
  await ensureAppDemoSchema(db);
  const [sections, features, screens, media] = await Promise.all([
    db.query(`SELECT id, name, description, sort_order FROM app_demo_categories ORDER BY sort_order ASC, id ASC`),
    db.query(`SELECT id, category_id, title, category, summary, is_active, sort_order FROM app_demo_features
               ${includeHidden ? "" : "WHERE is_active = TRUE"} ORDER BY sort_order ASC, id ASC`),
    db.query(`SELECT id, feature_id, label, caption, sort_order FROM app_demo_screens ORDER BY sort_order ASC, id ASC`),
    db.query(`SELECT id, screen_id, label, media_type, media_url, s3_key, mime_type, media_width, media_height, poster_url, guide, accent, guided, sort_order
                FROM app_demo_screen_media ORDER BY sort_order ASC, id ASC`),
  ]);

  const screenById = new Map(screens.rows.map((s) => [s.id, { ...s, media: [] }]));
  for (const m of media.rows) {
    const s = screenById.get(m.screen_id);
    if (s) s.media.push({ ...m, file_url: mediaFileUrl(m) });
  }
  const featureById = new Map(features.rows.map((f) => [f.id, { ...f, screens: [] }]));
  for (const s of screenById.values()) {
    const f = featureById.get(s.feature_id);
    if (f && (includeHidden || s.media.length)) f.screens.push(s);
  }
  const list = sections.rows.map((s) => ({ ...s, features: [] }));
  const sectionById = new Map(list.map((s) => [s.id, s]));
  const unsorted = { id: null, name: "Unsorted", description: "Features without a section.", features: [] };
  for (const f of featureById.values()) {
    if (!includeHidden && !f.screens.length) continue;
    (sectionById.get(f.category_id) || unsorted).features.push(f);
  }
  if (unsorted.features.length) list.push(unsorted);
  const tour = { sections: includeHidden ? list : list.filter((s) => s.features.length) };
  if (!includeHidden) tourCache = { at: Date.now(), tour };
  return tour;
}

function invalidateTourCache() {
  tourCache = { at: 0, tour: null };
}

module.exports = {
  MEDIA_TYPES,
  MAX_FILE_BYTES,
  MAX_FILES_PER_UPLOAD,
  ensureAppDemoSchema,
  getTour,
  invalidateTourCache,
  mediaFileUrl,
};
