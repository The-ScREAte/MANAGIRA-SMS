const { google } = require("googleapis");
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
  return new google.auth.OAuth2(
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

async function getAssessmentQuestionSetBundle(dbClient, assessment) {
  const setResult = await dbClient.query(
    `SELECT question_set_id,
            set_title,
            set_description,
            review_status
       FROM assessment_question_sets
      WHERE organization_id = $1
        AND term_id = $2
        AND class_id = $3
        AND subject_id = $4
        AND assessment_id = $5
        AND COALESCE(is_active, TRUE) = TRUE
      ORDER BY
        CASE WHEN LOWER(COALESCE(review_status, 'pending')) = 'approved' THEN 0 ELSE 1 END,
        updated_at DESC,
        question_set_id DESC
      LIMIT 1`,
    [
      assessment.organization_id,
      assessment.term_id,
      assessment.class_id,
      assessment.subject_id,
      assessment.assessment_id,
    ]
  );

  const setRow = setResult.rows[0] || null;
  if (!setRow) return null;

  const questionRows = await dbClient.query(
    `SELECT question_text,
            options_json,
            marks,
            position_index
       FROM assessment_questions
      WHERE question_set_id = $1
      ORDER BY position_index ASC, question_id ASC`,
    [setRow.question_set_id]
  );

  return {
    setTitle: setRow.set_title || "Question Set",
    setDescription: setRow.set_description || "",
    reviewStatus: String(setRow.review_status || "pending").toLowerCase(),
    questions: questionRows.rows || [],
  };
}

function buildCourseworkDescription(baseDescription, questionSetBundle) {
  const lines = [];
  const intro = stripHtml(baseDescription || "");
  if (intro) {
    lines.push(intro);
  }

  if (!questionSetBundle) {
    return lines.join("\n\n").trim();
  }

  lines.push(`Question Set: ${questionSetBundle.setTitle}`);
  if (questionSetBundle.setDescription) {
    lines.push(stripHtml(questionSetBundle.setDescription));
  }

  const questions = Array.isArray(questionSetBundle.questions)
    ? questionSetBundle.questions
    : [];

  questions.forEach((questionRow, index) => {
    const marks = Number(questionRow.marks || 0);
    const questionText = stripHtml(questionRow.question_text || "");
    if (!questionText) return;

    lines.push(`Q${index + 1}${marks > 0 ? ` (${marks} mark${marks === 1 ? "" : "s"})` : ""}: ${questionText}`);

    const options = Array.isArray(questionRow.options_json)
      ? questionRow.options_json
      : [];
    if (options.length) {
      options.forEach((option, optionIndex) => {
        const normalizedOption = stripHtml(option || "");
        if (!normalizedOption) return;
        const letter = String.fromCharCode(65 + optionIndex);
        lines.push(`  ${letter}. ${normalizedOption}`);
      });
    }
  });

  // Google Classroom description length limit safety.
  const output = lines.join("\n\n").trim();
  if (output.length <= 14000) return output;
  return `${output.slice(0, 13950)}\n\n[Question content truncated due to length.]`;
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

async function getClassSubjectAssignments(dbClient, organizationId, termId) {
  const result = await dbClient.query(
    `SELECT c.class_id,
            c.class_name,
            s.subject_id,
            s.subject_name,
            $2::int AS term_id,
            COALESCE(t.term_name, 'Current Term') AS term_name,
            COALESCE(sy.year_label, '') AS school_year_label,
            COALESCE(teacher.email, '') AS teacher_email
       FROM classes c
       JOIN subjects s
         ON s.class_id = c.class_id
        AND s.organization_id = c.organization_id
       LEFT JOIN terms t
         ON t.term_id = $2
       LEFT JOIN school_years sy
         ON sy.id = t.school_year_id
       LEFT JOIN LATERAL (
         SELECT u.email
           FROM user_subjects us
           JOIN users u ON u.user_id = us.user_id
          WHERE us.subject_id = s.subject_id
            AND u.organization_id = c.organization_id
            AND LOWER(COALESCE(u.account_type::text, '')) = 'teacher'
            AND TRIM(COALESCE(u.email, '')) <> ''
          ORDER BY u.user_id ASC
          LIMIT 1
       ) AS teacher ON TRUE
      WHERE c.organization_id = $1
      ORDER BY c.class_id, s.subject_id`,
    [organizationId, termId]
  );

  return result.rows || [];
}

async function getOrCreateGoogleCourse(classroom, dbClient, organizationId, assignment) {
  const normalizedClassLabel = normalizeClassLabel(assignment.class_name);
  const desiredCourseName = buildClassCourseName(assignment);

  const mappingResult = await dbClient.query(
    `SELECT google_course_id
       FROM google_classroom_course_mappings
      WHERE organization_id = $1
        AND term_id = $2
        AND class_id = $3
        AND subject_id = $4
      LIMIT 1`,
    [organizationId, assignment.term_id, assignment.class_id, assignment.subject_id]
  );

  let googleCourseId = mappingResult.rows[0]?.google_course_id || null;

  if (!googleCourseId) {
    const classLevelResult = await dbClient.query(
      `SELECT google_course_id
         FROM google_classroom_course_mappings
        WHERE organization_id = $1
          AND term_id = $2
          AND class_id = $3
          AND TRIM(COALESCE(google_course_id, '')) <> ''
        ORDER BY updated_at DESC, last_synced_at DESC
        LIMIT 1`,
      [organizationId, assignment.term_id, assignment.class_id]
    );
    googleCourseId = classLevelResult.rows[0]?.google_course_id || null;
  }

  if (googleCourseId) {
    try {
      const existingCourse = await classroom.courses.get({ id: googleCourseId });
      const existingName = String(existingCourse?.data?.name || "").trim();
      let persistedCourseName = existingName || desiredCourseName;

      if (existingName !== desiredCourseName) {
        try {
          await classroom.courses.patch({
            id: googleCourseId,
            updateMask: "name,section",
            requestBody: {
              name: desiredCourseName,
              section: normalizedClassLabel,
            },
          });
          persistedCourseName = desiredCourseName;
        } catch (_) {
        }
      }

      await dbClient.query(
        `UPDATE google_classroom_course_mappings
            SET google_course_name = $5,
                google_course_id = $6,
                last_synced_at = NOW(),
                updated_at = NOW()
          WHERE organization_id = $1
            AND term_id = $2
            AND class_id = $3`,
        [organizationId, assignment.term_id, assignment.class_id, assignment.subject_id, persistedCourseName, googleCourseId]
      );
      return googleCourseId;
    } catch (_) {
      googleCourseId = null;
    }
  }

  const createdCourse = await classroom.courses.create({
    requestBody: {
      name: desiredCourseName,
      section: normalizedClassLabel,
      ownerId: "me",
    },
  });

  googleCourseId = String(createdCourse?.data?.id || "").trim();
  if (!googleCourseId) {
    throw new Error(`Google did not return a course id for class ${assignment.class_id}/${assignment.subject_id}.`);
  }

  await dbClient.query(
    `INSERT INTO google_classroom_course_mappings
      (organization_id, term_id, class_id, subject_id, google_course_id, google_course_name, sync_status, last_synced_at)
     VALUES ($1, $2, $3, $4, $5, $6, 'linked', NOW())
     ON CONFLICT (organization_id, term_id, class_id, subject_id)
     DO UPDATE SET google_course_id = EXCLUDED.google_course_id,
                   google_course_name = EXCLUDED.google_course_name,
                   sync_status = 'linked',
                   last_synced_at = NOW(),
                   updated_at = NOW()`,
    [
      organizationId,
      assignment.term_id,
      assignment.class_id,
      assignment.subject_id,
      googleCourseId,
      desiredCourseName,
    ]
  );

  await dbClient.query(
    `UPDATE google_classroom_course_mappings
        SET google_course_id = $4,
            google_course_name = $5,
            sync_status = 'linked',
            last_synced_at = NOW(),
            updated_at = NOW()
      WHERE organization_id = $1
        AND term_id = $2
        AND class_id = $3`,
    [organizationId, assignment.term_id, assignment.class_id, googleCourseId, desiredCourseName]
  );

  return googleCourseId;
}

async function getOrCreateTopicForSubject(classroom, courseId, subjectName) {
  const desiredTopicName = buildSubjectTopicName(subjectName);

  try {
    const topicsResult = await classroom.courses.topics.list({ courseId, pageSize: 100 });
    const existingTopics = Array.isArray(topicsResult?.data?.topic) ? topicsResult.data.topic : [];
    const existing = existingTopics.find(
      (topic) => String(topic.name || "").trim().toLowerCase() === desiredTopicName.toLowerCase()
    );
    if (existing?.topicId) return String(existing.topicId);
  } catch (_) {
  }

  try {
    const created = await classroom.courses.topics.create({
      courseId,
      requestBody: {
        name: desiredTopicName,
      },
    });
    const topicId = String(created?.data?.topicId || "").trim();
    return topicId || null;
  } catch (_) {
    return null;
  }
}

async function inviteTeacher(classroom, courseId, teacherEmail) {
  if (!teacherEmail) return;

  // Prefer direct roster add so teachers don't need to accept invitations when policy permits.
  try {
    await classroom.courses.teachers.create({ courseId, requestBody: { userId: teacherEmail } });
    return;
  } catch (error) {
    if (isAlreadyExistsError(error)) return;
  }

  // Fallback to invitation flow when direct roster add is not allowed.
  try {
    await classroom.invitations.create({
      requestBody: {
        courseId,
        userId: teacherEmail,
        role: "TEACHER",
      },
    });
  } catch (error) {
    if (!isAlreadyExistsError(error)) {
      throw error;
    }
  }
}

async function syncStudentsForClass(classroom, dbClient, organizationId, classId, courseId) {
  const studentsResult = await dbClient.query(
    `SELECT student_id, first_name, last_name, email, google_user_id
       FROM students
      WHERE organization_id = $1
        AND class_id = $2`,
    [organizationId, classId]
  );

  let linkedCount = 0;

  for (const student of studentsResult.rows || []) {
    const studentEmail = String(student.email || "").trim();
    if (!studentEmail) continue;

    let linked = false;

    // Prefer direct roster add so students appear immediately when policy allows.
    try {
      await classroom.courses.students.create({
        courseId,
        requestBody: {
          userId: studentEmail,
        },
      });
      linked = true;
    } catch (error) {
      if (isAlreadyExistsError(error)) {
        linked = true;
      } else {
        // Fallback to invitation flow when direct roster add is blocked.
        try {
          await classroom.invitations.create({
            requestBody: {
              courseId,
              userId: studentEmail,
              role: "STUDENT",
            },
          });
          linked = true;
        } catch (inviteError) {
          if (isAlreadyExistsError(inviteError)) {
            linked = true;
          } else {
            continue;
          }
        }
      }
    }

    if (linked) linkedCount += 1;

    if (!student.google_user_id) {
      try {
        const profile = await classroom.userProfiles.get({ userId: studentEmail });
        const resolvedGoogleUserId = String(profile?.data?.id || "").trim();
        if (resolvedGoogleUserId) {
          await dbClient.query(
            `UPDATE students
                SET google_user_id = $2
              WHERE student_id = $1
                AND organization_id = $3`,
            [student.student_id, resolvedGoogleUserId, organizationId]
          );
        }
      } catch (_) {
      }
    }
  }

  return linkedCount;
}

async function syncGuardiansForClass(classroom, dbClient, organizationId, classId) {
  const guardiansResult = await dbClient.query(
    `SELECT g.email,
            s.google_user_id
       FROM guardians g
       JOIN students s
         ON s.student_id = g.student_id
        AND s.organization_id = g.organization_id
      WHERE g.organization_id = $1
        AND s.class_id = $2
        AND TRIM(COALESCE(g.email, '')) <> ''
        AND TRIM(COALESCE(s.google_user_id, '')) <> ''`,
    [organizationId, classId]
  );

  for (const guardian of guardiansResult.rows || []) {
    try {
      await classroom.userProfiles.guardianInvitations.create({
        studentId: guardian.google_user_id,
        requestBody: {
          invitedEmailAddress: guardian.email,
        },
      });
    } catch (error) {
      if (!isAlreadyExistsError(error)) {
        continue;
      }
    }
  }
}

async function syncGoogleClassroomForOrganization(organizationId, options = {}) {
  const dbClient = options.dbClient || db;
  await ensureGoogleClassroomSyncSchema(dbClient);

  const term = await resolveCurrentTerm(dbClient, organizationId);
  if (!term) {
    await markGoogleSync(dbClient, organizationId, "idle", "No current term found. Nothing to sync.");
    return { coursesProcessed: 0, studentInvitesSent: 0 };
  }

  const auth = await getGoogleClient(organizationId, dbClient);
  const classroom = google.classroom({ version: "v1", auth });

  const assignments = await getClassSubjectAssignments(dbClient, organizationId, term.term_id);
  if (!assignments.length) {
    await markGoogleSync(dbClient, organizationId, "synced", "No class-subject assignments found for current term.");
    return { coursesProcessed: 0, studentInvitesSent: 0 };
  }

  let coursesProcessed = 0;
  let studentInvitesSent = 0;
  let failedAssignments = 0;
  const failureSamples = [];

  for (const assignment of assignments) {
    try {
      const courseId = await getOrCreateGoogleCourse(classroom, dbClient, organizationId, assignment);
      await inviteTeacher(classroom, courseId, assignment.teacher_email || "");
      studentInvitesSent += await syncStudentsForClass(
        classroom,
        dbClient,
        organizationId,
        assignment.class_id,
        courseId
      );
      await syncGuardiansForClass(classroom, dbClient, organizationId, assignment.class_id);

      coursesProcessed += 1;
    } catch (error) {
      failedAssignments += 1;
      const normalized = normalizeGoogleApiError(error);
      if (failureSamples.length < 3) {
        failureSamples.push(`${assignment.class_name} ${assignment.subject_name}: ${normalized.message}`);
      }
      await markGoogleSync(
        dbClient,
        organizationId,
        "error",
        `Failed syncing ${assignment.class_name} ${assignment.subject_name}: ${normalized.message}`
      );
    }
  }

  const hasFailures = failedAssignments > 0;
  const syncStatus = hasFailures ? "error" : "synced";
  const syncNote = hasFailures
    ? `Sync completed with failures. Success: ${coursesProcessed}, failed: ${failedAssignments}, student invites: ${studentInvitesSent}. Sample errors: ${failureSamples.join(' | ')}`
    : `Sync complete. ${coursesProcessed} course(s) reconciled, ${studentInvitesSent} student invite(s) sent.`;

  await markGoogleSync(dbClient, organizationId, syncStatus, syncNote);

  return { coursesProcessed, studentInvitesSent, failedAssignments };
}

async function pushAssessmentToGoogleClassroom(organizationId, assessmentId, options = {}) {
  const dbClient = options.dbClient || db;
  await ensureGoogleClassroomSyncSchema(dbClient);

  const assessmentResult = await dbClient.query(
    `SELECT a.assessment_id,
            a.organization_id,
            a.title,
            a.description,
            a.max_score,
            a.category,
            a.class_id,
            a.subject_id,
            a.term_id,
            a.google_coursework_id,
            COALESCE(s.subject_name, '') AS subject_name,
            gcm.google_course_id
       FROM assessments a
       LEFT JOIN subjects s
         ON s.subject_id = a.subject_id
       JOIN google_classroom_course_mappings gcm
         ON gcm.organization_id = a.organization_id
        AND gcm.term_id = a.term_id
        AND gcm.class_id = a.class_id
        AND gcm.subject_id = a.subject_id
      WHERE a.organization_id = $1
        AND a.assessment_id = $2
      LIMIT 1`,
    [organizationId, assessmentId]
  );

  const assessment = assessmentResult.rows[0];
  if (!assessment || !assessment.google_course_id) return false;

  const auth = await getGoogleClient(organizationId, dbClient);
  const classroom = google.classroom({ version: "v1", auth });

  const questionSetBundle = await getAssessmentQuestionSetBundle(dbClient, assessment);
  const courseworkDescription = buildCourseworkDescription(assessment.description || "", questionSetBundle);
  const topicId = await getOrCreateTopicForSubject(
    classroom,
    assessment.google_course_id,
    assessment.subject_name
  );
  const courseworkRequest = {
    title: assessment.title,
    description: courseworkDescription,
    workType: "ASSIGNMENT",
    state: "PUBLISHED",
    maxPoints: Number(assessment.max_score || 0),
  };
  if (topicId) courseworkRequest.topicId = topicId;

  if (assessment.google_coursework_id) {
    try {
      const patchMask = topicId
        ? "title,description,maxPoints,topicId"
        : "title,description,maxPoints";
      await classroom.courses.courseWork.patch({
        courseId: assessment.google_course_id,
        id: assessment.google_coursework_id,
        updateMask: patchMask,
        requestBody: {
          title: courseworkRequest.title,
          description: courseworkRequest.description,
          maxPoints: courseworkRequest.maxPoints,
          ...(topicId ? { topicId } : {}),
        },
      });
      return true;
    } catch (error) {
      const normalized = normalizeGoogleApiError(error);
      // If the coursework was removed on Google side, recreate and re-link.
      if (normalized.code !== 404) {
        throw error;
      }
    }
  }

  const created = await classroom.courses.courseWork.create({
    courseId: assessment.google_course_id,
    requestBody: courseworkRequest,
  });

  const googleCourseworkId = String(created?.data?.id || "").trim();
  if (!googleCourseworkId) return false;

  await dbClient.query(
    `UPDATE assessments
        SET google_coursework_id = $2
      WHERE organization_id = $1
        AND assessment_id = $3`,
    [organizationId, googleCourseworkId, assessmentId]
  );

  return true;
}

async function pushPendingAssessmentsForOrganization(organizationId, options = {}) {
  const dbClient = options.dbClient || db;
  await ensureGoogleClassroomSyncSchema(dbClient);
  const includeExisting = Boolean(options.includeExisting);

  const explicitTermId = Number(options.termId || 0);
  let termId = Number.isInteger(explicitTermId) && explicitTermId > 0 ? explicitTermId : null;
  if (!termId) {
    const currentTerm = await resolveCurrentTerm(dbClient, organizationId);
    termId = currentTerm ? Number(currentTerm.term_id) : null;
  }
  if (!termId) {
    return 0;
  }

  const pendingResult = await dbClient.query(
    `SELECT a.assessment_id
       FROM assessments a
       JOIN google_classroom_course_mappings gcm
         ON gcm.organization_id = a.organization_id
        AND gcm.term_id = a.term_id
        AND gcm.class_id = a.class_id
        AND gcm.subject_id = a.subject_id
      WHERE a.organization_id = $1
        AND a.term_id = $2
        AND ($4::boolean = TRUE OR a.google_coursework_id IS NULL)
      ORDER BY a.assessment_id ASC
      LIMIT $3`,
    [organizationId, termId, Number(options.limit || 200), includeExisting]
  );

  let pushed = 0;
  const failures = [];
  for (const row of pendingResult.rows || []) {
    try {
      const didPush = await pushAssessmentToGoogleClassroom(organizationId, row.assessment_id, {
        dbClient,
      });
      if (didPush) pushed += 1;
    } catch (err) {
      const message = err?.message || "Unknown error";
      console.error(
        `[googleClassroomSync] Failed to push assessment ${row.assessment_id} (org ${organizationId}):`,
        message
      );
      failures.push({ assessmentId: row.assessment_id, message });
    }
  }

  if (failures.length) {
    const summary = failures
      .slice(0, 3)
      .map((f) => `#${f.assessmentId}: ${f.message}`)
      .join("; ");
    await markGoogleSync(
      dbClient,
      organizationId,
      "error",
      `${failures.length} assessment(s) failed to push to Google Classroom. ${summary}${failures.length > 3 ? "..." : ""}`
    ).catch(() => {});
  }

  return pushed;
}

async function syncQueuedGoogleClassroomOrganizations(options = {}) {
  const dbClient = options.dbClient || db;
  await ensureGoogleClassroomSyncSchema(dbClient);

  const queuedResult = await dbClient.query(
    `SELECT organization_id
       FROM organizations
      WHERE google_classroom_activated = TRUE
        AND google_classroom_configured = TRUE
        AND COALESCE(google_classroom_last_sync_status, 'idle') IN ('queued', 'connected', 'idle')
      ORDER BY google_classroom_last_sync_at NULLS FIRST
      LIMIT $1`,
    [Number(options.limit || 10)]
  );

  let processed = 0;
  for (const row of queuedResult.rows || []) {
    try {
      await syncGoogleClassroomForOrganization(row.organization_id, { dbClient });
      await pushPendingAssessmentsForOrganization(row.organization_id, { dbClient, limit: 120 });
      processed += 1;
    } catch (error) {
      const normalized = normalizeGoogleApiError(error);
      await markGoogleSync(
        dbClient,
        row.organization_id,
        "error",
        normalized.message
      );
    }
  }

  return processed;
}

async function resolveStudentFromSubmission(dbClient, organizationId, classroom, submissionUserId) {
  const direct = await dbClient.query(
    `SELECT student_id
       FROM students
      WHERE organization_id = $1
        AND google_user_id = $2
      LIMIT 1`,
    [organizationId, String(submissionUserId || "")]
  );
  if (direct.rows[0]) return direct.rows[0].student_id;

  try {
    const profile = await classroom.userProfiles.get({ userId: submissionUserId });
    const email = String(profile?.data?.emailAddress || "").trim().toLowerCase();
    const googleUserId = String(profile?.data?.id || "").trim();
    if (!email) return null;

    const byEmail = await dbClient.query(
      `SELECT student_id
         FROM students
        WHERE organization_id = $1
          AND LOWER(COALESCE(email, '')) = $2
        LIMIT 1`,
      [organizationId, email]
    );

    const studentId = byEmail.rows[0]?.student_id || null;
    if (studentId && googleUserId) {
      await dbClient.query(
        `UPDATE students
            SET google_user_id = $2
          WHERE student_id = $1
            AND organization_id = $3`,
        [studentId, googleUserId, organizationId]
      );
    }

    return studentId;
  } catch (_) {
    return null;
  }
}

async function pullGradesFromGoogleClassroom(options = {}) {
  const dbClient = options.dbClient || db;
  await ensureGoogleClassroomSyncSchema(dbClient);

  const organizationsResult = await dbClient.query(
    `SELECT organization_id
       FROM organizations
      WHERE google_classroom_activated = TRUE
        AND google_classroom_configured = TRUE
        AND TRIM(COALESCE(google_classroom_refresh_token, google_classroom_access_token, '')) <> ''
      ORDER BY organization_id
      LIMIT $1`,
    [Number(options.limitOrganizations || 50)]
  );

  let gradesUpserted = 0;

  for (const row of organizationsResult.rows || []) {
    const organizationId = row.organization_id;
    try {
      const auth = await getGoogleClient(organizationId, dbClient);
      const classroom = google.classroom({ version: "v1", auth });

      const assessmentsResult = await dbClient.query(
        `SELECT a.assessment_id,
                a.subject_id,
                a.term_id,
                a.class_id,
                a.category,
                a.google_coursework_id,
                COALESCE(a.entry_mode, 'score') AS entry_mode, a.choice_options,
                gcm.google_course_id
           FROM assessments a
           JOIN google_classroom_course_mappings gcm
             ON gcm.organization_id = a.organization_id
            AND gcm.term_id = a.term_id
            AND gcm.class_id = a.class_id
            AND gcm.subject_id = a.subject_id
          WHERE a.organization_id = $1
            AND TRIM(COALESCE(a.google_coursework_id, '')) <> ''`,
        [organizationId]
      );

      for (const assessment of assessmentsResult.rows || []) {
        let response;
        try {
          response = await classroom.courses.courseWork.studentSubmissions.list({
            courseId: assessment.google_course_id,
            courseWorkId: assessment.google_coursework_id,
            states: ["TURNED_IN", "RETURNED"],
          });
        } catch (_) {
          continue;
        }

        for (const submission of response?.data?.studentSubmissions || []) {
          const assignedGrade = Number(submission.assignedGrade);
          if (!Number.isFinite(assignedGrade)) continue;
          // A choice assessment (Yes / No ...): the grade earns the choice with
          // the most points at or below it; without points the teacher picks.
          let savedScore = assignedGrade;
          let savedChoice = null;
          if (assessmentEntry.isChoice(assessment)) {
            const picked = assessmentEntry.choiceForScore(assessment, assignedGrade);
            if (!picked) continue;
            savedScore = picked.points;
            savedChoice = picked.label;
          }

          const studentId = await resolveStudentFromSubmission(
            dbClient,
            organizationId,
            classroom,
            submission.userId
          );
          if (!studentId) continue;

          await dbClient.query(
            `INSERT INTO assessment_results
              (assessment_id, student_id, score, subject_id, term_id, organization_id, class_id, category, choice_label)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
             ON CONFLICT (student_id, assessment_id)
             DO UPDATE SET score = EXCLUDED.score,
                           choice_label = EXCLUDED.choice_label,
                           subject_id = EXCLUDED.subject_id,
                           term_id = EXCLUDED.term_id,
                           organization_id = EXCLUDED.organization_id,
                           class_id = EXCLUDED.class_id,
                           category = EXCLUDED.category`,
            [
              assessment.assessment_id,
              studentId,
              savedScore,
              assessment.subject_id,
              assessment.term_id,
              organizationId,
              assessment.class_id,
              assessment.category || null,
              savedChoice,
            ]
          );
          gradesUpserted += 1;
        }
      }
    } catch (error) {
      const normalized = normalizeGoogleApiError(error);
      await markGoogleSync(dbClient, organizationId, "error", `Grade pull failed: ${normalized.message}`);
    }
  }

  return gradesUpserted;
}

module.exports = {
  ensureGoogleClassroomSyncSchema,
  getGoogleClient,
  syncGoogleClassroomForOrganization,
  syncQueuedGoogleClassroomOrganizations,
  pushAssessmentToGoogleClassroom,
  pushPendingAssessmentsForOrganization,
  pullGradesFromGoogleClassroom,
  createGoogleOauthClient,
  hasGoogleOauthConfig,
  resolveGoogleRedirectUri,
};
