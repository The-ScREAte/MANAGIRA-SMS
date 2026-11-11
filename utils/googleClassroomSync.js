// Loaded on first use: this library alone is over 100 MB of memory.
const googleLib = () => require("googleapis").google;
const assessmentEntry = require("./assessmentEntry");
const db = require("../config/db");
const {
  ensureGoogleIntegrationSchema,
  markGoogleSync,
} = require("./googleClassroomIntegration");

let syncSchemaReady = false;

function resolveGoogleRedirectUri() {
  const explicitRedirect = String(process.env.GOOGLE_REDIRECT_URI || "").trim();
  if (explicitRedirect) return explicitRedirect;

  const isProduction = process.env.NODE_ENV === "production";
  const localRedirect = String(process.env.GOOGLE_REDIRECT_URI_LOCAL || "").trim();
  const productionRedirect = String(process.env.GOOGLE_REDIRECT_URI_PRODUCTION || "").trim();

  const envSpecificRedirect = isProduction ? productionRedirect : localRedirect;
  if (envSpecificRedirect) return envSpecificRedirect;

  // Fall back to whichever explicit redirect is set, regardless of NODE_ENV,
  // then finally derive one from BASE_URL.
  if (productionRedirect) return productionRedirect;
  if (localRedirect) return localRedirect;

  const baseUrl = String(process.env.BASE_URL_PRODUCTION || process.env.BASE_URL || "https://managira.com").replace(/\/$/, "");
  return `${baseUrl}/account/google-classroom/callback`;
}

function hasGoogleOauthConfig() {
  return Boolean(
    String(process.env.GOOGLE_CLIENT_ID || "").trim() &&
    String(process.env.GOOGLE_CLIENT_SECRET || "").trim()
  );
}

function createGoogleOauthClient() {
  // Take the class out first: `new googleLib().auth.OAuth2()` would run `new googleLib()`.
  const { OAuth2 } = googleLib().auth;
  return new OAuth2(
    process.env.GOOGLE_CLIENT_ID || "",
    process.env.GOOGLE_CLIENT_SECRET || "",
    resolveGoogleRedirectUri()
  );
}

function normalizeGoogleApiError(error) {
  const code = Number(error?.code || error?.response?.status || 0) || null;
  const message =
    error?.response?.data?.error?.message ||
    error?.errors?.[0]?.message ||
    error?.message ||
    "Unknown Google API error";
  return { code, message: String(message) };
}

function isAlreadyExistsError(error) {
  const { code, message } = normalizeGoogleApiError(error);
  if (code === 409 || code === 412) return true;
  return /already exists|already invited|duplicate|already a member/i.test(message);
}

function stripHtml(input) {
  return String(input || "")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/p>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .trim();
}

function normalizeClassLabel(className) {
  const raw = String(className || "").trim();
  if (!raw) return "Class";

  const normalizedSpacing = raw.replace(/\s+/g, " ");
  const levelMatch = normalizedSpacing.match(/^(jss|ss)\s*(\d+)$/i);
  if (levelMatch) {
    return `${levelMatch[1].toUpperCase()} ${levelMatch[2]}`;
  }

  return normalizedSpacing
    .split(" ")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1).toLowerCase())
    .join(" ");
}

function buildClassCourseName(assignment) {
  const normalizedClassLabel = normalizeClassLabel(assignment.class_name);
  const termLabel = String(assignment.term_name || "Current Term").trim();
  const schoolYearLabel = String(assignment.school_year_label || "").trim();
  return schoolYearLabel
    ? `${normalizedClassLabel} - ${termLabel} (${schoolYearLabel})`
    : `${normalizedClassLabel} - ${termLabel}`;
}

function buildSubjectTopicName(subjectName) {
  const raw = String(subjectName || "").trim();
  if (!raw) return "General";
  return raw;
}

async function ensureGoogleClassroomSyncSchema(dbClient = db) {
  if (syncSchemaReady) return;

  await ensureGoogleIntegrationSchema(dbClient);

  await dbClient.query(`
    ALTER TABLE students
      ADD COLUMN IF NOT EXISTS google_user_id VARCHAR(255)
  `);

  await dbClient.query(`
    ALTER TABLE assessments
      ADD COLUMN IF NOT EXISTS google_coursework_id VARCHAR(255)
  `);

  await dbClient.query(`
    CREATE INDEX IF NOT EXISTS idx_students_org_google_user_id
      ON students (organization_id, google_user_id)
      WHERE google_user_id IS NOT NULL
  `);

  await dbClient.query(`
    CREATE INDEX IF NOT EXISTS idx_assessments_google_coursework
      ON assessments (organization_id, google_coursework_id)
      WHERE google_coursework_id IS NOT NULL
  `);

  syncSchemaReady = true;
}

async function getGoogleClient(organizationId, dbClient = db) {
  await ensureGoogleClassroomSyncSchema(dbClient);

  const orgResult = await dbClient.query(
    `SELECT google_classroom_access_token,
            google_classroom_refresh_token,
            google_classroom_token_expiry,
            google_classroom_activated,
            google_classroom_configured
       FROM organizations
      WHERE organization_id = $1
      LIMIT 1`,
    [organizationId]
  );

  const integration = orgResult.rows[0];
  if (!integration) throw new Error("Organization not found.");
  if (!integration.google_classroom_activated || !integration.google_classroom_configured) {
    throw new Error("Google Classroom integration is not active/configured.");
  }
  if (!integration.google_classroom_refresh_token && !integration.google_classroom_access_token) {
    throw new Error("No Google OAuth token found for this organization.");
  }

  const oauthClient = createGoogleOauthClient();
  oauthClient.setCredentials({
    access_token: integration.google_classroom_access_token || undefined,
    refresh_token: integration.google_classroom_refresh_token || undefined,
    expiry_date: integration.google_classroom_token_expiry
      ? new Date(integration.google_classroom_token_expiry).getTime()
      : undefined,
  });

  oauthClient.on("tokens", async (tokens) => {
    try {
      if (!tokens || (!tokens.access_token && !tokens.refresh_token)) return;
      await dbClient.query(
        `UPDATE organizations
            SET google_classroom_access_token = COALESCE($2, google_classroom_access_token),
                google_classroom_refresh_token = COALESCE($3, google_classroom_refresh_token),
                google_classroom_token_expiry = CASE
                  WHEN $4::bigint IS NULL THEN google_classroom_token_expiry
                  ELSE to_timestamp($4::double precision / 1000.0)
                END
          WHERE organization_id = $1`,
        [
          organizationId,
          tokens.access_token || null,
          tokens.refresh_token || null,
          Number.isFinite(Number(tokens.expiry_date)) ? Number(tokens.expiry_date) : null,
        ]
      );
    } catch (_) {
    }
  });

  return oauthClient;
}

async function resolveCurrentTerm(dbClient, organizationId) {
  const termResult = await dbClient.query(
    `SELECT term_id, term_name
       FROM terms
      WHERE organization_id = $1
        AND current = TRUE
      ORDER BY term_id DESC
      LIMIT 1`,
    [organizationId]
  );

  return termResult.rows[0] || null;
}

// ---------------------------------------------------------------------------
// What a school chose (Settings, Integrations, Google Classroom). Saved on the school in
// google_classroom_options (database/migrations/2026-11-19_google_classroom_choices.sql);
// until that has run on a database every school gets the defaults and grades only fill
// empty cells, never overwrite one.
const DEFAULT_OPTIONS = Object.freeze({
  courses: "class", // "class": one course per class, its subjects as topics; "subject": one per subject of each class
  coursework: "offline", // "offline": assessments without an online test in Managira; "all"; "none"
  gradesFromGoogle: true,
  gradesToGoogle: true,
  parents: true,
});

function normalizeOptions(raw) {
  const given = raw && typeof raw === "object" ? raw : {};
  const yes = (value, fallback) => {
    if (value === undefined || value === null || value === "") return fallback;
    if (Array.isArray(value)) value = value[value.length - 1];
    return value === true || value === 1 || ["1", "true", "on", "yes"].includes(String(value).toLowerCase());
  };
  return {
    courses: given.courses === "subject" ? "subject" : "class",
    coursework: ["all", "none", "offline"].includes(given.coursework) ? given.coursework : "offline",
    gradesFromGoogle: yes(given.gradesFromGoogle, DEFAULT_OPTIONS.gradesFromGoogle),
    gradesToGoogle: yes(given.gradesToGoogle, DEFAULT_OPTIONS.gradesToGoogle),
    parents: yes(given.parents, DEFAULT_OPTIONS.parents),
  };
}

let choiceColumnsReady = false;
let choiceColumnsCheckedAt = 0;
async function columnsReady(dbClient = db) {
  if (choiceColumnsReady || Date.now() - choiceColumnsCheckedAt < 60000) return choiceColumnsReady;
  choiceColumnsCheckedAt = Date.now();
  try {
    const { rows } = await dbClient.query(
      `SELECT COUNT(*)::int AS n FROM information_schema.columns
        WHERE table_schema = current_schema()
          AND ((table_name = 'organizations' AND column_name = 'google_classroom_options')
            OR (table_name = 'assessment_results' AND column_name = 'google_grade'))`
    );
    choiceColumnsReady = Number(rows[0] && rows[0].n) === 2;
  } catch (_) {
    choiceColumnsReady = false;
  }
  return choiceColumnsReady;
}

async function optionsFor(dbClient, organizationId) {
  if (!(await columnsReady(dbClient))) return { ...DEFAULT_OPTIONS };
  const { rows } = await dbClient.query(
    "SELECT google_classroom_options FROM organizations WHERE organization_id = $1",
    [organizationId]
  );
  return normalizeOptions(rows[0] && rows[0].google_classroom_options);
}

// Returns what was saved, or null when the database can't keep choices yet.
async function saveOptions(dbClient, organizationId, raw) {
  if (!(await columnsReady(dbClient))) return null;
  const options = normalizeOptions(raw);
  await dbClient.query(
    "UPDATE organizations SET google_classroom_options = $2::jsonb WHERE organization_id = $1",
    [organizationId, JSON.stringify(options)]
  );
  return options;
}

const appUrl = () => String(process.env.BASE_URL_PRODUCTION || process.env.BASE_URL || "https://managira.com").replace(/\/$/, "");
const errorCode = (error) => normalizeGoogleApiError(error).code;

// Every page of a Google list.
async function listAll(call, args, key) {
  const out = [];
  let pageToken;
  let pages = 0;
  do {
    const response = await call({ ...args, pageSize: 100, pageToken });
    out.push(...((response && response.data && response.data[key]) || []));
    pageToken = response && response.data && response.data.nextPageToken;
    pages += 1;
  } while (pageToken && pages < 200);
  return out;
}

// One run at a time per school: a run claims the school first, so the background job and a
// Sync button pressed at the same moment never both make a course.
async function claimRun(dbClient, organizationId, note) {
  const { rows } = await dbClient.query(
    `UPDATE organizations
        SET google_classroom_last_sync_status = 'running',
            google_classroom_last_sync_note = $2,
            google_classroom_last_sync_at = NOW()
      WHERE organization_id = $1
        AND (COALESCE(google_classroom_last_sync_status, '') <> 'running'
             OR google_classroom_last_sync_at < NOW() - INTERVAL '30 minutes')
      RETURNING organization_id`,
    [organizationId, note || "Sync running."]
  );
  return rows.length > 0;
}

// ---------------------------------------------------------------------------
// Courses: one per class of the current term (its subjects as topics), or one per subject of
// each class. Each names its class, term and school year.

function buildSubjectCourseName(unit) {
  const subjectName = unit.subjects[0] ? String(unit.subjects[0].name || "").trim() : "";
  const classCourse = buildClassCourseName(unit);
  return subjectName ? `${subjectName} - ${classCourse}` : classCourse;
}

async function courseUnits(dbClient, organizationId, term, mode) {
  const { rows } = await dbClient.query(
    `WITH in_use AS (
       SELECT DISTINCT ec.class_id
         FROM enrollments e
         JOIN enrolled_classes ec ON ec.enrollment_id = e.enrollment_id
        WHERE e.organization_id = $1 AND e.term_id = $2
     )
     SELECT c.class_id, c.class_name, s.subject_id, s.subject_name,
            COALESCE(sy.year_label, '') AS school_year_label
       FROM classes c
       JOIN subjects s ON s.class_id = c.class_id AND s.organization_id = c.organization_id
                      AND s.obsolete_at IS NULL AND (s.term_id IS NULL OR s.term_id = $2)
       LEFT JOIN terms t ON t.term_id = $2
       LEFT JOIN school_years sy ON sy.id = t.school_year_id
      WHERE c.organization_id = $1
        AND c.obsolete_at IS NULL
        AND (NOT EXISTS (SELECT 1 FROM in_use) OR c.class_id IN (SELECT class_id FROM in_use))
      ORDER BY COALESCE(c.dashboard_sort_order, 2147483647), c.class_name, c.class_id, s.subject_name, s.subject_id`,
    [organizationId, term.term_id]
  );
  if (!rows.length) return [];
  const classIds = [...new Set(rows.map((row) => Number(row.class_id)))];
  const subjectIds = [...new Set(rows.map((row) => Number(row.subject_id)))];

  // Staff with an email who can teach: never drivers or people on hold.
  const staffWhere = `TRIM(COALESCE(u.email, '')) <> ''
                  AND LOWER(COALESCE(u.account_type::text, '')) <> 'driver'
                  AND COALESCE(u.on_hold, FALSE) = FALSE`;
  const [subjectTeachers, mainTeachers, enrolled, subjectStudents] = await Promise.all([
    dbClient.query(
      `SELECT us.subject_id, LOWER(TRIM(u.email)) AS email
         FROM user_subjects us
         JOIN users u ON u.user_id = us.user_id AND u.organization_id = $1
        WHERE us.subject_id = ANY($2::int[]) AND ${staffWhere}`,
      [organizationId, subjectIds]
    ),
    dbClient.query(
      `SELECT uc.class_id, LOWER(TRIM(u.email)) AS email
         FROM user_classes uc
         JOIN users u ON u.user_id = uc.user_id AND u.organization_id = $1
        WHERE uc.main = TRUE AND uc.class_id = ANY($2::int[]) AND ${staffWhere}`,
      [organizationId, classIds]
    ),
    dbClient.query(
      `SELECT DISTINCT es.class_id, st.student_id, st.email, st.google_user_id
         FROM enrollments e
         JOIN enrolled_students es ON es.enrollment_id = e.enrollment_id
         JOIN students st ON st.student_id = es.student_id AND st.organization_id = e.organization_id
        WHERE e.organization_id = $1 AND e.term_id = $2 AND es.class_id = ANY($3::int[])
          AND COALESCE(st.graduated, FALSE) = FALSE`,
      [organizationId, term.term_id, classIds]
    ),
    mode === "subject"
      ? dbClient.query(
        `SELECT subject_id, student_id FROM student_subjects
          WHERE organization_id = $1 AND subject_id = ANY($2::int[]) AND (term_id = $3 OR term_id IS NULL)`,
        [organizationId, subjectIds, term.term_id]
      )
      : { rows: [] },
  ]);

  // A school without this term's enrolment lists: each student's own class.
  let studentRows = enrolled.rows;
  if (!studentRows.length) {
    studentRows = (await dbClient.query(
      `SELECT class_id, student_id, email, google_user_id FROM students
        WHERE organization_id = $1 AND class_id = ANY($2::int[]) AND COALESCE(graduated, FALSE) = FALSE`,
      [organizationId, classIds]
    )).rows;
  }

  const group = (list, key, value) => {
    const map = new Map();
    for (const row of list) {
      const id = Number(row[key]);
      if (!map.has(id)) map.set(id, []);
      map.get(id).push(value(row));
    }
    return map;
  };
  const teachersBySubject = group(subjectTeachers.rows, "subject_id", (row) => row.email);
  const mainByClass = group(mainTeachers.rows, "class_id", (row) => row.email);
  const studentsByClass = group(studentRows, "class_id", (row) => ({
    studentId: Number(row.student_id),
    email: String(row.email || "").trim().toLowerCase(),
    googleUserId: String(row.google_user_id || "").trim(),
  }));
  const takersBySubject = group(subjectStudents.rows, "subject_id", (row) => Number(row.student_id));

  const classes = new Map();
  for (const row of rows) {
    const classId = Number(row.class_id);
    if (!classes.has(classId)) {
      classes.set(classId, {
        classId,
        class_name: row.class_name,
        term_id: Number(term.term_id),
        term_name: term.term_name || "Current Term",
        school_year_label: row.school_year_label,
        subjects: [],
      });
    }
    classes.get(classId).subjects.push({ id: Number(row.subject_id), name: row.subject_name });
  }

  const units = [];
  for (const cls of classes.values()) {
    const students = studentsByClass.get(cls.classId) || [];
    const main = mainByClass.get(cls.classId) || [];
    if (mode === "subject") {
      for (const subject of cls.subjects) {
        const takers = takersBySubject.get(subject.id);
        const takerSet = takers && takers.length ? new Set(takers) : null;
        units.push({
          ...cls,
          subjects: [subject],
          teacherEmails: [...new Set([...(teachersBySubject.get(subject.id) || []), ...main])],
          students: takerSet ? students.filter((st) => takerSet.has(st.studentId)) : students,
        });
      }
    } else {
      const teachers = cls.subjects.flatMap((subject) => teachersBySubject.get(subject.id) || []);
      units.push({ ...cls, teacherEmails: [...new Set([...teachers, ...main])], students });
    }
  }
  return units;
}

// The unit's Google course: the one already linked if Google still has it, otherwise a new one.
async function courseFor(classroom, dbClient, organizationId, unit, mode) {
  const desiredName = mode === "subject" ? buildSubjectCourseName(unit) : buildClassCourseName(unit);
  const section = normalizeClassLabel(unit.class_name);
  const { rows } = await dbClient.query(
    `SELECT subject_id, google_course_id, sync_status
       FROM google_classroom_course_mappings
      WHERE organization_id = $1 AND term_id = $2 AND class_id = $3
        AND TRIM(COALESCE(google_course_id, '')) <> ''
      ORDER BY updated_at DESC, id DESC`,
    [organizationId, unit.term_id, unit.classId]
  );
  // Each link says how its course was made ('subject' for a subject's own course, 'linked' for
  // a class's), so after a school changes how courses are made, every course is a clean one.
  let courseId = null;
  if (mode === "subject") {
    const own = rows.find((row) => Number(row.subject_id) === unit.subjects[0].id && row.sync_status === "subject");
    if (own) courseId = own.google_course_id;
  } else {
    const shared = new Map();
    rows.filter((row) => row.sync_status !== "subject")
      .forEach((row) => shared.set(row.google_course_id, (shared.get(row.google_course_id) || 0) + 1));
    // The course most of the class's subjects are on (the latest one on a tie).
    if (shared.size) courseId = [...shared.entries()].sort((a, b) => b[1] - a[1])[0][0];
  }

  let created = false;
  if (courseId) {
    try {
      const existing = await classroom.courses.get({ id: courseId });
      const name = String((existing && existing.data && existing.data.name) || "").trim();
      if (name !== desiredName) {
        await classroom.courses.patch({
          id: courseId,
          updateMask: "name,section",
          requestBody: { name: desiredName, section },
        }).catch(() => {});
      }
    } catch (error) {
      // Only a course Google no longer has is made again; any other answer stops here, so a
      // passing error never makes a second course.
      if (errorCode(error) !== 404) throw error;
      courseId = null;
    }
  }
  if (!courseId) {
    const requestBody = { name: desiredName, section, ownerId: "me", courseState: "ACTIVE" };
    let response;
    try {
      response = await classroom.courses.create({ requestBody });
    } catch (error) {
      if (errorCode(error) !== 400) throw error;
      delete requestBody.courseState; // an account that can't open it straight away: Google keeps it provisioned
      response = await classroom.courses.create({ requestBody });
    }
    courseId = String((response && response.data && response.data.id) || "").trim();
    if (!courseId) throw new Error(`Google did not return a course for ${unit.class_name}.`);
    created = true;
  }

  await dbClient.query(
    `INSERT INTO google_classroom_course_mappings
       (organization_id, term_id, class_id, subject_id, google_course_id, google_course_name, sync_status, last_synced_at)
     SELECT $1, $2, $3, subject_id, $5, $6, $7, NOW() FROM unnest($4::int[]) AS subject_id
     ON CONFLICT (organization_id, term_id, class_id, subject_id)
     DO UPDATE SET google_course_id = EXCLUDED.google_course_id,
                   google_course_name = EXCLUDED.google_course_name,
                   sync_status = EXCLUDED.sync_status,
                   last_synced_at = NOW(),
                   updated_at = NOW()`,
    [organizationId, unit.term_id, unit.classId, unit.subjects.map((subject) => subject.id), courseId, desiredName, mode === "subject" ? "subject" : "linked"]
  );
  return { courseId, created };
}

// Adds whoever isn't on the course yet: straight onto it where the school's Google allows,
// otherwise by invitation. Returns who is on it (email -> Google id) and how many were added.
async function addToCourse(classroom, courseId, emails, role) {
  const resource = role === "TEACHER" ? classroom.courses.teachers : classroom.courses.students;
  const listed = await listAll((args) => resource.list(args), { courseId }, role === "TEACHER" ? "teachers" : "students").catch(() => []);
  const onCourse = new Map();
  for (const person of listed) {
    const email = String((person.profile && person.profile.emailAddress) || "").toLowerCase();
    if (email) onCourse.set(email, String(person.userId || (person.profile && person.profile.id) || ""));
  }
  let added = 0;
  let invited = 0;
  for (const email of emails) {
    if (!email || onCourse.has(email)) continue;
    try {
      const response = await resource.create({ courseId, requestBody: { userId: email } });
      onCourse.set(email, String((response && response.data && response.data.userId) || ""));
      added += 1;
      continue;
    } catch (error) {
      if (isAlreadyExistsError(error)) { onCourse.set(email, onCourse.get(email) || ""); continue; }
    }
    try {
      await classroom.invitations.create({ requestBody: { courseId, userId: email, role } });
      invited += 1;
    } catch (error) {
      if (!isAlreadyExistsError(error)) continue;
    }
  }
  return { onCourse, added, invited };
}

async function inviteParents(classroom, dbClient, organizationId, students) {
  const linked = students.filter((student) => student.googleUserId);
  if (!linked.length) return 0;
  const { rows } = await dbClient.query(
    `SELECT DISTINCT gs.student_id, LOWER(TRIM(gp.email)) AS email
       FROM guardian_students gs
       JOIN guardian_profiles gp ON gp.guardian_id = gs.guardian_id AND gp.organization_id = $1
      WHERE gs.student_id = ANY($2::int[]) AND TRIM(COALESCE(gp.email, '')) <> ''`,
    [organizationId, linked.map((student) => student.studentId)]
  );
  const googleIdOf = new Map(linked.map((student) => [student.studentId, student.googleUserId]));
  let sent = 0;
  for (const row of rows) {
    try {
      await classroom.userProfiles.guardianInvitations.create({
        studentId: googleIdOf.get(Number(row.student_id)),
        requestBody: { invitedEmailAddress: row.email },
      });
      sent += 1;
    } catch (error) {
      if (isAlreadyExistsError(error)) continue;
      // Guardian summaries are off for this school's Google: don't ask again for every parent.
      if (errorCode(error) === 403) return sent;
    }
  }
  return sent;
}

function googleFor(organizationId, dbClient, options) {
  if (options.classroom) return options.classroom;
  return getGoogleClient(organizationId, dbClient).then((auth) => googleLib().classroom({ version: "v1", auth }));
}

// Courses, teachers, students and (when chosen) parents for the current term.
async function syncGoogleClassroomForOrganization(organizationId, options = {}) {
  const dbClient = options.dbClient || db;
  await ensureGoogleClassroomSyncSchema(dbClient);
  const term = await resolveCurrentTerm(dbClient, organizationId);
  if (!term) return { coursesProcessed: 0, studentInvitesSent: 0, failedAssignments: 0, note: "No current term yet, so there is nothing to put in Google Classroom." };

  const classroom = await googleFor(organizationId, dbClient, options);
  const choices = options.choices || await optionsFor(dbClient, organizationId);
  const units = await courseUnits(dbClient, organizationId, term, choices.courses);
  if (!units.length) return { coursesProcessed: 0, studentInvitesSent: 0, failedAssignments: 0, note: "No classes with subjects this term." };

  const counts = { courses: 0, made: 0, students: 0, invited: 0, teachers: 0, parents: 0, noEmail: new Set(), failed: 0 };
  const failures = [];
  const googleIds = new Map();
  for (const unit of units) {
    try {
      const { courseId, created } = await courseFor(classroom, dbClient, organizationId, unit, choices.courses);
      if (created) counts.made += 1;
      const teachers = await addToCourse(classroom, courseId, unit.teacherEmails, "TEACHER");
      counts.teachers += teachers.added + teachers.invited;
      unit.students.filter((student) => !student.email).forEach((student) => counts.noEmail.add(student.studentId));
      const roster = await addToCourse(classroom, courseId, unit.students.map((student) => student.email).filter(Boolean), "STUDENT");
      counts.students += roster.added;
      counts.invited += roster.invited;
      for (const student of unit.students) {
        const googleId = student.email && roster.onCourse.get(student.email);
        if (googleId && googleId !== student.googleUserId) {
          googleIds.set(student.studentId, googleId);
          student.googleUserId = googleId;
        }
      }
      if (choices.parents) counts.parents += await inviteParents(classroom, dbClient, organizationId, unit.students);
      counts.courses += 1;
    } catch (error) {
      counts.failed += 1;
      if (failures.length < 3) failures.push(`${unit.class_name}${choices.courses === "subject" ? ` ${unit.subjects[0].name}` : ""}: ${normalizeGoogleApiError(error).message}`);
    }
  }
  if (googleIds.size) {
    await dbClient.query(
      `UPDATE students s SET google_user_id = v.google_id
         FROM unnest($2::int[], $3::text[]) AS v(student_id, google_id)
        WHERE s.student_id = v.student_id AND s.organization_id = $1`,
      [organizationId, [...googleIds.keys()], [...googleIds.values()]]
    );
  }

  const parts = [`${counts.courses} course${counts.courses === 1 ? "" : "s"} up to date${counts.made ? ` (${counts.made} new)` : ""}`];
  if (counts.students || counts.invited) parts.push(`${counts.students} student${counts.students === 1 ? "" : "s"} added${counts.invited ? `, ${counts.invited} invited` : ""}`);
  if (counts.teachers) parts.push(`${counts.teachers} teacher${counts.teachers === 1 ? "" : "s"} added`);
  if (counts.parents) parts.push(`${counts.parents} parent invitation${counts.parents === 1 ? "" : "s"} sent`);
  if (counts.noEmail.size) parts.push(`${counts.noEmail.size} student${counts.noEmail.size === 1 ? " has" : "s have"} no email, so ${counts.noEmail.size === 1 ? "isn't" : "aren't"} in Google Classroom`);
  if (counts.failed) parts.push(`${counts.failed} could not be updated (${failures.join(" | ")})`);
  return {
    coursesProcessed: counts.courses,
    studentInvitesSent: counts.students + counts.invited,
    failedAssignments: counts.failed,
    studentsWithoutEmail: counts.noEmail.size,
    note: `${parts.join(". ")}.`,
  };
}

// ---------------------------------------------------------------------------
// Assessments as Google assignments. Questions are never copied into Google: an assessment
// with an online test links to the Testing Room, so a secure test stays secure.

const ONLINE_TEST_SQL = `EXISTS (SELECT 1 FROM assessment_question_sets qs
                                  WHERE qs.organization_id = a.organization_id AND qs.assessment_id = a.assessment_id
                                    AND COALESCE(qs.is_active, TRUE) AND qs.retake_student_id IS NULL)`;

function courseworkDescription(row) {
  const lines = [];
  const intro = stripHtml(row.description || "");
  if (intro) lines.push(intro);
  if (row.online) lines.push(`This test is taken online in Managira's Testing Room: ${appUrl()}/student/testing-room/${row.assessment_id}`);
  const text = lines.join("\n\n").trim();
  return text.length <= 14000 ? text : `${text.slice(0, 13950)}…`;
}

// Google takes whole points only; 7.5 becomes 8 there (grades still travel exactly).
const googlePoints = (maxScore) => {
  const points = Number(maxScore || 0);
  return points > 0 ? Math.ceil(points) : 0;
};

async function assessmentsForGoogle(dbClient, organizationId, { termId, assessmentId = null, includeExisting = true, coursework, limit = 500 }) {
  if (coursework === "none") return [];
  const { rows } = await dbClient.query(
    `SELECT a.assessment_id, a.title, a.description, a.max_score, a.class_id, a.subject_id, a.term_id,
            a.google_coursework_id, COALESCE(s.subject_name, '') AS subject_name, gcm.google_course_id,
            ${ONLINE_TEST_SQL} AS online
       FROM assessments a
       LEFT JOIN subjects s ON s.subject_id = a.subject_id
       JOIN google_classroom_course_mappings gcm
         ON gcm.organization_id = a.organization_id AND gcm.term_id = a.term_id
        AND gcm.class_id = a.class_id AND gcm.subject_id = a.subject_id
      WHERE a.organization_id = $1
        AND ($2::int IS NULL OR a.term_id = $2)
        AND ($3::int IS NULL OR a.assessment_id = $3)
        AND ($4::boolean OR a.google_coursework_id IS NULL)
        AND a.obsolete_at IS NULL AND COALESCE(a.is_active, TRUE)
        AND ($5::boolean OR NOT ${ONLINE_TEST_SQL})
      ORDER BY a.assessment_id
      LIMIT $6`,
    [organizationId, termId || null, assessmentId || null, Boolean(includeExisting), coursework === "all", Number(limit) || 500]
  );
  return rows;
}

async function topicFor(classroom, courseId, subjectName, topics) {
  const name = buildSubjectTopicName(subjectName);
  if (!topics.has(courseId)) {
    const listed = await listAll((args) => classroom.courses.topics.list(args), { courseId }, "topic").catch(() => []);
    topics.set(courseId, new Map(listed.map((topic) => [String(topic.name || "").trim().toLowerCase(), String(topic.topicId)])));
  }
  const known = topics.get(courseId);
  if (known.has(name.toLowerCase())) return known.get(name.toLowerCase());
  try {
    const created = await classroom.courses.topics.create({ courseId, requestBody: { name } });
    const topicId = String((created && created.data && created.data.topicId) || "").trim() || null;
    if (topicId) known.set(name.toLowerCase(), topicId);
    return topicId;
  } catch (_) {
    return null;
  }
}

async function pushOneAssessment(classroom, dbClient, organizationId, row, { topics, mode }) {
  const topicId = mode === "subject" ? null : await topicFor(classroom, row.google_course_id, row.subject_name, topics);
  const body = {
    title: row.title,
    description: courseworkDescription(row),
    maxPoints: googlePoints(row.max_score),
    ...(topicId ? { topicId } : {}),
  };
  if (row.google_coursework_id) {
    try {
      await classroom.courses.courseWork.patch({
        courseId: row.google_course_id,
        id: row.google_coursework_id,
        updateMask: topicId ? "title,description,maxPoints,topicId" : "title,description,maxPoints",
        requestBody: body,
      });
      return true;
    } catch (error) {
      // Removed in Google (or on another course after the school changed how courses are made):
      // made again below. Anything else is a real failure.
      if (![404, 403].includes(errorCode(error))) throw error;
    }
  }
  const created = await classroom.courses.courseWork.create({
    courseId: row.google_course_id,
    requestBody: { ...body, workType: "ASSIGNMENT", state: "PUBLISHED" },
  });
  const courseworkId = String((created && created.data && created.data.id) || "").trim();
  if (!courseworkId) return false;
  await dbClient.query(
    "UPDATE assessments SET google_coursework_id = $2 WHERE organization_id = $1 AND assessment_id = $3",
    [organizationId, courseworkId, row.assessment_id]
  );
  if (row.google_coursework_id && await columnsReady(dbClient)) {
    // A new assignment has no grades yet: every grade is sent again.
    await dbClient.query("UPDATE assessment_results SET google_grade = NULL WHERE organization_id = $1 AND assessment_id = $2", [organizationId, row.assessment_id]);
  }
  return true;
}

async function pushAssessmentToGoogleClassroom(organizationId, assessmentId, options = {}) {
  const dbClient = options.dbClient || db;
  await ensureGoogleClassroomSyncSchema(dbClient);
  const choices = options.choices || await optionsFor(dbClient, organizationId);
  const [row] = await assessmentsForGoogle(dbClient, organizationId, { assessmentId, coursework: choices.coursework, limit: 1 });
  if (!row) return false;
  const classroom = await googleFor(organizationId, dbClient, options);
  return pushOneAssessment(classroom, dbClient, organizationId, row, { topics: new Map(), mode: choices.courses });
}

async function pushPendingAssessmentsForOrganization(organizationId, options = {}) {
  const result = await pushAssessmentsForOrganization(organizationId, options);
  return result.pushed;
}

async function pushAssessmentsForOrganization(organizationId, options = {}) {
  const dbClient = options.dbClient || db;
  await ensureGoogleClassroomSyncSchema(dbClient);
  const choices = options.choices || await optionsFor(dbClient, organizationId);
  let termId = Number(options.termId || 0) || null;
  if (!termId) {
    const term = await resolveCurrentTerm(dbClient, organizationId);
    termId = term ? Number(term.term_id) : null;
  }
  if (!termId) return { pushed: 0, failed: 0 };
  const rows = await assessmentsForGoogle(dbClient, organizationId, {
    termId,
    includeExisting: Boolean(options.includeExisting),
    coursework: choices.coursework,
    limit: options.limit || 200,
  });
  if (!rows.length) return { pushed: 0, failed: 0 };
  const classroom = await googleFor(organizationId, dbClient, options);
  const topics = new Map();
  let pushed = 0;
  const failures = [];
  for (const row of rows) {
    try {
      if (await pushOneAssessment(classroom, dbClient, organizationId, row, { topics, mode: choices.courses })) pushed += 1;
    } catch (error) {
      failures.push(`${row.title}: ${normalizeGoogleApiError(error).message}`);
    }
  }
  if (failures.length && !options.quiet) {
    await markGoogleSync(dbClient, organizationId, "error",
      `${failures.length} assessment${failures.length === 1 ? "" : "s"} could not be sent to Google Classroom. ${failures.slice(0, 3).join(" | ")}`).catch(() => {});
  }
  return { pushed, failed: failures.length, failures };
}

// ---------------------------------------------------------------------------
// Grades, both ways. assessment_results.google_grade is the grade both places last agreed on:
//  - changed only in Google: Managira takes it (waiting for the teacher's ✓ in the assessments
//    flow, like a score from an online test);
//  - changed only in Managira: Google gets it, once families can see it;
//  - changed in both, or different and never matched: Managira's is kept (and sent).
// A locked assessment takes nothing from Google.

async function exchangeGradesForOrganization(organizationId, options = {}) {
  const dbClient = options.dbClient || db;
  const choices = options.choices || await optionsFor(dbClient, organizationId);
  const out = { pulled: 0, pushed: 0, aboveMax: 0, failed: 0, later: 0 };
  const maxPushes = Number(options.maxPushes || 1500);
  if (!choices.gradesFromGoogle && !choices.gradesToGoogle) return out;
  if (choices.coursework === "none") return out;
  const tracked = await columnsReady(dbClient);
  const send = choices.gradesToGoogle && tracked; // sending needs the agreed grade, or it could overwrite Google's
  const assessmentApproval = require("./assessmentApproval");
  const flow = assessmentApproval.flowOn(organizationId);

  const { rows: assessments } = await dbClient.query(
    `SELECT a.assessment_id, a.subject_id, a.term_id, a.class_id, a.category, a.max_score, a.is_locked,
            a.google_coursework_id, COALESCE(a.entry_mode, 'score') AS entry_mode, a.choice_options,
            gcm.google_course_id
       FROM assessments a
       JOIN google_classroom_course_mappings gcm
         ON gcm.organization_id = a.organization_id AND gcm.term_id = a.term_id
        AND gcm.class_id = a.class_id AND gcm.subject_id = a.subject_id
       JOIN terms t ON t.term_id = a.term_id
      WHERE a.organization_id = $1
        AND TRIM(COALESCE(a.google_coursework_id, '')) <> ''
        AND a.obsolete_at IS NULL
        AND (t.current = TRUE OR t.end_date >= CURRENT_DATE - 30)
        AND ($2::boolean OR NOT ${ONLINE_TEST_SQL})`,
    [organizationId, choices.coursework === "all"]
  );
  if (!assessments.length) return out;

  const classroom = await googleFor(organizationId, dbClient, options);
  const studentOf = new Map((await dbClient.query(
    "SELECT student_id, google_user_id FROM students WHERE organization_id = $1 AND TRIM(COALESCE(google_user_id, '')) <> ''",
    [organizationId]
  )).rows.map((row) => [String(row.google_user_id), Number(row.student_id)]));
  const touched = new Map(); // "subject|class|term" -> Set of students whose totals changed

  for (const assessment of assessments) {
    let submissions;
    try {
      submissions = await listAll(
        (args) => classroom.courses.courseWork.studentSubmissions.list(args),
        { courseId: assessment.google_course_id, courseWorkId: assessment.google_coursework_id },
        "studentSubmissions"
      );
    } catch (_) {
      out.failed += 1;
      continue;
    }
    const { rows: results } = await dbClient.query(
      `SELECT student_id, score, choice_label${tracked ? ", google_grade" : ", NULL::numeric AS google_grade"}${flow ? ", pending_since" : ", NULL::timestamptz AS pending_since"}
         FROM assessment_results WHERE organization_id = $1 AND assessment_id = $2`,
      [organizationId, assessment.assessment_id]
    );
    const resultOf = new Map(results.map((row) => [Number(row.student_id), row]));
    const num = (value) => (value === null || value === undefined || value === "" ? null : Number(value));
    const same = (a, b) => a !== null && b !== null && Math.abs(a - b) < 0.005;
    const maxScore = Number(assessment.max_score || 0);

    const take = []; // [studentId, score, choice, googleGrade]
    const agree = []; // [studentId, grade] both places hold now
    for (const submission of submissions) {
      const studentId = studentOf.get(String(submission.userId || ""));
      if (!studentId) continue;
      const result = resultOf.get(studentId) || null;
      const ours = result ? num(result.score) : null;
      const agreed = result ? num(result.google_grade) : null;
      const theirs = typeof submission.assignedGrade === "number" ? submission.assignedGrade : null;

      if (send && ours !== null && !result.pending_since && !same(ours, agreed)) {
        // Managira's grade changed since the two last matched (or they never did): Google gets it.
        if (same(theirs, ours)) { agree.push([studentId, ours]); continue; }
        if (out.pushed >= maxPushes) { out.later += 1; continue; } // sent in the next run
        try {
          await classroom.courses.courseWork.studentSubmissions.patch({
            courseId: assessment.google_course_id,
            courseWorkId: assessment.google_coursework_id,
            id: submission.id,
            updateMask: "assignedGrade,draftGrade",
            requestBody: { assignedGrade: ours, draftGrade: ours },
          });
          agree.push([studentId, ours]);
          out.pushed += 1;
        } catch (_) {
          out.failed += 1;
        }
        continue;
      }

      if (!choices.gradesFromGoogle || theirs === null || assessment.is_locked) continue;
      if (same(theirs, agreed)) continue; // Google hasn't changed it
      if (same(theirs, ours)) { if (tracked) agree.push([studentId, ours]); continue; }
      // Managira changed it too (or holds a different grade): Managira's stays.
      if (ours !== null && (!tracked || agreed === null || !same(ours, agreed))) continue;
      if (maxScore > 0 && theirs > maxScore + 0.005) { out.aboveMax += 1; continue; }
      let score = Math.min(Math.round(theirs * 100) / 100, 999.99);
      let choice = null;
      if (assessmentEntry.isChoice(assessment)) {
        const picked = assessmentEntry.choiceForScore(assessment, theirs);
        if (!picked) continue;
        score = picked.points;
        choice = picked.label;
      }
      take.push([studentId, score, choice, theirs]);
    }

    if (take.length) {
      const columns = [take.map((t) => t[0]), take.map((t) => t[1]), take.map((t) => t[2])];
      const params = [organizationId, assessment.assessment_id, assessment.subject_id, assessment.term_id, assessment.class_id, assessment.category || null, ...columns];
      const googleGrade = tracked ? ", google_grade" : "";
      if (tracked) params.push(take.map((t) => t[3]));
      const pendingInsert = flow ? ", pending_since, pending_source" : "";
      const pendingValues = flow ? ", NOW(), 'google'" : "";
      const pendingUpdate = flow
        ? `, posted_score = CASE WHEN assessment_results.pending_since IS NULL THEN assessment_results.score ELSE assessment_results.posted_score END,
             posted_choice = CASE WHEN assessment_results.pending_since IS NULL THEN assessment_results.choice_label ELSE assessment_results.posted_choice END,
             pending_since = COALESCE(assessment_results.pending_since, NOW()),
             pending_source = CASE WHEN assessment_results.pending_since IS NULL THEN 'google' ELSE assessment_results.pending_source END`
        : "";
      await dbClient.query(
        `INSERT INTO assessment_results (assessment_id, student_id, score, choice_label, subject_id, term_id, organization_id, class_id, category${googleGrade}${pendingInsert})
         SELECT $2, v.student_id, v.score, v.choice, $3, $4, $1, $5, $6${tracked ? ", v.google_grade" : ""}${pendingValues}
           FROM unnest($7::int[], $8::numeric[], $9::text[]${tracked ? ", $10::numeric[]" : ""}) AS v(student_id, score, choice${tracked ? ", google_grade" : ""})
         ON CONFLICT (student_id, assessment_id) DO UPDATE SET
           score = EXCLUDED.score,
           choice_label = EXCLUDED.choice_label${tracked ? ", google_grade = EXCLUDED.google_grade" : ""}${pendingUpdate}`,
        params
      );
      out.pulled += take.length;
      const key = `${assessment.subject_id}|${assessment.class_id}|${assessment.term_id}`;
      if (!touched.has(key)) touched.set(key, new Set());
      take.forEach((t) => touched.get(key).add(t[0]));
    }
    if (agree.length && tracked) {
      await dbClient.query(
        `UPDATE assessment_results ar SET google_grade = v.grade
           FROM unnest($3::int[], $4::numeric[]) AS v(student_id, grade)
          WHERE ar.organization_id = $1 AND ar.assessment_id = $2 AND ar.student_id = v.student_id`,
        [organizationId, assessment.assessment_id, agree.map((a) => a[0]), agree.map((a) => a[1])]
      );
    }
  }

  if (touched.size) {
    const { commonController, recomputeSubjectTotalsForStudent } = require("../controllers/commonController");
    for (const [key, students] of touched) {
      const [subjectId, classId, termId] = key.split("|").map(Number);
      for (const studentId of students) {
        await recomputeSubjectTotalsForStudent(dbClient, { studentId, subjectId, classId, termId, organizationId }).catch(() => {});
      }
      await commonController.updateStudentPositions(dbClient, subjectId, organizationId, classId, termId).catch(() => {});
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// One full run for a school: courses and people, assessments, then grades. Its result is the
// line the school sees under Google Classroom in Settings.
async function runForOrganization(organizationId, options = {}) {
  const dbClient = options.dbClient || db;
  if (!options.claimed && !(await claimRun(dbClient, organizationId, "Sync running."))) return { skipped: true };
  try {
    const choices = await optionsFor(dbClient, organizationId);
    const run = { ...options, dbClient, choices };
    const roster = await syncGoogleClassroomForOrganization(organizationId, run);
    const work = await pushAssessmentsForOrganization(organizationId, { ...run, includeExisting: options.includeExisting !== false, limit: 500, quiet: true });
    const grades = await exchangeGradesForOrganization(organizationId, run);
    const parts = [roster.note.replace(/\.$/, "")];
    if (choices.coursework !== "none") parts.push(`${work.pushed} assessment${work.pushed === 1 ? "" : "s"} in Google${work.failed ? ` (${work.failed} could not be sent: ${work.failures.slice(0, 2).join(" | ")})` : ""}`);
    if (grades.pulled) parts.push(`${grades.pulled} grade${grades.pulled === 1 ? "" : "s"} brought in from Google${flowWaits(organizationId) ? ", waiting for the teacher's ✓" : ""}`);
    if (grades.pushed) parts.push(`${grades.pushed} grade${grades.pushed === 1 ? "" : "s"} sent to Google${grades.later ? ` (${grades.later} more in the next half hour)` : ""}`);
    if (grades.aboveMax) parts.push(`${grades.aboveMax} grade${grades.aboveMax === 1 ? " was" : "s were"} above the assessment's maximum and stayed in Google`);
    const failed = roster.failedAssignments > 0 || work.failed > 0;
    await markGoogleSync(dbClient, organizationId, failed ? "error" : "synced", `${parts.join(". ")}.`);
    return { roster, work, grades };
  } catch (error) {
    await markGoogleSync(dbClient, organizationId, "error", normalizeGoogleApiError(error).message).catch(() => {});
    throw error;
  }
}

function flowWaits(organizationId) {
  try { return require("./assessmentApproval").flowOn(organizationId); } catch (_) { return false; }
}

// The background job: schools waiting for a run, and every connected school again each six
// hours so new students and staff reach Google without anyone pressing Sync.
async function syncQueuedGoogleClassroomOrganizations(options = {}) {
  const dbClient = options.dbClient || db;
  await ensureGoogleClassroomSyncSchema(dbClient);
  const { rows } = await dbClient.query(
    `SELECT organization_id
       FROM organizations
      WHERE google_classroom_activated = TRUE
        AND google_classroom_configured = TRUE
        AND TRIM(COALESCE(google_classroom_refresh_token, google_classroom_access_token, '')) <> ''
        AND (COALESCE(google_classroom_last_sync_status, 'idle') IN ('queued', 'connected', 'idle')
             OR (google_classroom_last_sync_status IN ('synced', 'error') AND google_classroom_last_sync_at < NOW() - INTERVAL '6 hours')
             OR (google_classroom_last_sync_status = 'running' AND google_classroom_last_sync_at < NOW() - INTERVAL '30 minutes'))
      ORDER BY google_classroom_last_sync_at NULLS FIRST
      LIMIT $1`,
    [Number(options.limit || 10)]
  );
  let processed = 0;
  for (const row of rows) {
    try {
      // Only new assessments here: an edited one is sent when it's saved, and Sync sends them all.
      const result = await runForOrganization(row.organization_id, { dbClient, includeExisting: false });
      if (!result.skipped) processed += 1;
    } catch (_) {
      // Already noted on the school.
    }
  }
  return processed;
}

// Every half hour: grades both ways for each connected school.
async function pullGradesFromGoogleClassroom(options = {}) {
  const dbClient = options.dbClient || db;
  await ensureGoogleClassroomSyncSchema(dbClient);
  const { rows } = await dbClient.query(
    `SELECT organization_id
       FROM organizations
      WHERE google_classroom_activated = TRUE
        AND google_classroom_configured = TRUE
        AND TRIM(COALESCE(google_classroom_refresh_token, google_classroom_access_token, '')) <> ''
        AND COALESCE(google_classroom_last_sync_status, '') <> 'running'
      ORDER BY organization_id
      LIMIT $1`,
    [Number(options.limitOrganizations || 50)]
  );
  let moved = 0;
  for (const row of rows) {
    try {
      const result = await exchangeGradesForOrganization(row.organization_id, { dbClient });
      moved += result.pulled + result.pushed;
    } catch (error) {
      await markGoogleSync(dbClient, row.organization_id, "error", `Grades could not be exchanged: ${normalizeGoogleApiError(error).message}`).catch(() => {});
    }
  }
  return moved;
}

module.exports = {
  DEFAULT_OPTIONS,
  normalizeOptions,
  optionsFor,
  saveOptions,
  columnsReady,
  claimRun,
  runForOrganization,
  ensureGoogleClassroomSyncSchema,
  getGoogleClient,
  syncGoogleClassroomForOrganization,
  syncQueuedGoogleClassroomOrganizations,
  pushAssessmentToGoogleClassroom,
  pushPendingAssessmentsForOrganization,
  pushAssessmentsForOrganization,
  exchangeGradesForOrganization,
  pullGradesFromGoogleClassroom,
  createGoogleOauthClient,
  hasGoogleOauthConfig,
  resolveGoogleRedirectUri,
  // for tests
  _courseUnits: courseUnits,
  _courseworkDescription: courseworkDescription,
};
