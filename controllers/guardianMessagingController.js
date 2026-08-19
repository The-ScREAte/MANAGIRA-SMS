// Shared "Notify Guardians" endpoint used by the Report page, Transcript
// page, Transportation, and Announcements & Events. One button per page
// context opens the same modal (public/js/guardianBroadcast.js); this file
// resolves WHO receives it and WHAT the default message says (server-side,
// so every page agrees), verifies the sender's password, then sends.
const db = require("../config/db");
const bcrypt = require("bcryptjs");
const { getMessagingChannelStatus, sendGuardianMessages } = require("../utils/guardianMessaging");
const { createShortLink } = require("../utils/shortLink");
const { ensureTranscriptPdfLink } = require("../utils/transcriptPdf");
const { ensureReportPdfLink } = require("../utils/reportPdf");
const { recordMessageSent, getSentRecipientSet, recordDeliveryAuditRow, updateDeliveryAuditRowStatus } = require("../utils/messageDeliveryLog");
const { MAILROOM_ALL_ACCESS_KEY, isManagerLikeRole, getUserPermissions } = require("../middleware/permissionMiddleware");

function safeString(value) {
  return String(value == null ? "" : value).trim();
}

// null = unrestricted mailroom access (org owner/manager-like roles, or an
// employee explicitly granted "all contacts"). An array (possibly empty)
// means the employee is scoped to only the guardians of students in those
// classes — set via the mailroom scope control on Add/Edit Employee.
async function getMailroomAllowedClassIds(req) {
  const orgId = req.session.organizationId;
  const userRole = req.session?.userRole || req.session?.user?.account_type || null;
  const accountType = req.session?.accountType || req.session?.user?.account_type || null;
  if (isManagerLikeRole(userRole) || isManagerLikeRole(accountType)) return null;
  if (
    String(userRole || "").trim().toLowerCase() === "manager" &&
    String(accountType || "").trim().toLowerCase() === "organization"
  ) {
    return null;
  }

  const userId = req.session?.user?.user_id || req.session?.userId || null;
  if (!userId) return [];

  const permissions = await getUserPermissions(db, userId, orgId);
  if (permissions.includes(MAILROOM_ALL_ACCESS_KEY)) return null;

  const result = await db
    .query(`SELECT class_id FROM user_mailroom_classes WHERE user_id = $1`, [userId])
    .catch(() => ({ rows: [] }));
  return result.rows.map((row) => Number(row.class_id));
}

// Same directory the left-hand contact list is built from, keyed by
// "source:guardianId" — used server-side to validate that a send request's
// recipients are real, org-scoped, permission-scoped guardian contacts
// rather than trusting whatever phone/email the client happened to submit.
async function getMailroomContactsMap(orgId, restrictedClassIds) {
  const restrictClause = restrictedClassIds ? "AND s.class_id = ANY($2::int[])" : "";
  const params = restrictedClassIds ? [orgId, restrictedClassIds] : [orgId];
  const joinType = restrictedClassIds ? "JOIN" : "LEFT JOIN";

  const result = await db.query(
    `SELECT DISTINCT gp.guardian_id, 'profile' AS source, NULLIF(TRIM(gp.phone), '') AS phone, NULLIF(TRIM(gp.email), '') AS email
     FROM guardian_profiles gp
     ${joinType} guardian_students gs ON gs.guardian_id = gp.guardian_id
     ${joinType} students s ON s.student_id = gs.student_id AND s.organization_id = $1
     WHERE gp.organization_id = $1 ${restrictClause}

     UNION ALL

     SELECT DISTINCT g.guardian_id, 'legacy' AS source, NULLIF(TRIM(g.phone), '') AS phone, NULLIF(TRIM(g.email), '') AS email
     FROM guardians g
     ${joinType} students s ON s.student_id = g.student_id AND s.organization_id = $1
     WHERE g.organization_id = $1 ${restrictClause}`,
    params
  );

  const map = new Map();
  (result.rows || []).forEach((row) => {
    map.set(`${row.source}:${row.guardian_id}`, { phone: safeString(row.phone), email: safeString(row.email) });
  });
  return map;
}

// Builds a recipient list straight from the "edit contacts" panel in the
// Send Report modal (studentId -> [values]), instead of the DB-resolved
// guardian rows — lets a school correct a wrong/missing number or email
// for one send without editing the guardian's saved record.
function buildOverrideRecipients(overrides, studentMetaById, fieldName) {
  const list = [];
  Object.entries(overrides || {}).forEach(([studentId, values]) => {
    const meta = studentMetaById[String(studentId)] || {};
    (Array.isArray(values) ? values : []).forEach((raw) => {
      const value = safeString(raw);
      if (!value) return;
      list.push({
        [fieldName]: value,
        studentId: Number(studentId),
        studentName: meta.studentName || "your child",
        className: meta.className || "",
        term: meta.term || "",
        shortLink: meta.shortLink || "",
        guardianName: "Guardian",
        guardianTitleLastName: "Guardian",
      });
    });
  });
  return list;
}

function baseUrlFromRequest(req) {
  const host = safeString(req.get("host"));
  const protocol = safeString(req.protocol) || "https";
  return `${protocol}://${host}`;
}

async function verifyActorPassword(req, password) {
  const orgId = req.session.organizationId;
  const userId = req.session.userId || req.session.user?.user_id;

  if (userId) {
    const userResult = await db.query(
      "SELECT password FROM users WHERE user_id = $1 AND organization_id = $2",
      [userId, orgId]
    );
    if (userResult.rows[0]?.password && (await bcrypt.compare(password, userResult.rows[0].password))) {
      return true;
    }
  }

  const orgResult = await db.query("SELECT password FROM organizations WHERE organization_id = $1", [orgId]);
  if (orgResult.rows[0]?.password && (await bcrypt.compare(password, orgResult.rows[0].password))) {
    return true;
  }
  return false;
}

async function getSchoolName(dbClient, organizationId) {
  const row = (
    await dbClient.query("SELECT organization_name FROM organizations WHERE organization_id = $1 LIMIT 1", [organizationId])
  ).rows[0];
  return safeString(row?.organization_name) || "Your School";
}

// One row per guardian for a student. guardianTitleLastName falls back to
// the guardian's full name — this codebase doesn't store an honorific/
// gender field, so "Mr./Mrs. Lastname" can't be reliably generated.
async function getGuardiansForStudent(dbClient, organizationId, studentId) {
  const result = await dbClient.query(
    `SELECT DISTINCT ON (COALESCE(phone, '') || '|' || COALESCE(email, '')) guardian_name, phone, email, student_name
     FROM (
       SELECT COALESCE(NULLIF(TRIM(CONCAT(gp.first_name, ' ', gp.last_name)), ''), 'Guardian') AS guardian_name,
              NULLIF(TRIM(gp.phone), '') AS phone,
              NULLIF(TRIM(gp.email), '') AS email,
              TRIM(CONCAT(s.first_name, ' ', s.last_name)) AS student_name
       FROM guardian_students gs
       JOIN guardian_profiles gp ON gp.guardian_id = gs.guardian_id AND gp.organization_id = $2
       JOIN students s ON s.student_id = gs.student_id
       WHERE gs.student_id = $1

       UNION ALL

       SELECT 'Guardian' AS guardian_name, NULLIF(TRIM(g.phone), '') AS phone, NULLIF(TRIM(g.email), '') AS email, TRIM(CONCAT(s.first_name, ' ', s.last_name)) AS student_name
       FROM guardians g
       JOIN students s ON s.student_id = g.student_id
       WHERE g.student_id = $1 AND g.organization_id = $2
     ) contacts
     WHERE phone IS NOT NULL OR email IS NOT NULL`,
    [studentId, organizationId]
  ).catch(() => ({ rows: [] }));

  return result.rows.map((row) => ({
    phone: safeString(row.phone),
    email: safeString(row.email),
    guardianName: safeString(row.guardian_name) || "Guardian",
    guardianTitleLastName: safeString(row.guardian_name) || "Guardian",
    studentName: safeString(row.student_name) || "your child",
  }));
}

async function getGuardiansForClass(dbClient, organizationId, classId) {
  const result = await dbClient.query(
    `SELECT DISTINCT ON (phone) guardian_name, phone, student_name
     FROM (
       SELECT COALESCE(NULLIF(TRIM(CONCAT(gp.first_name, ' ', gp.last_name)), ''), 'Guardian') AS guardian_name,
              gp.phone AS phone,
              TRIM(CONCAT(s.first_name, ' ', s.last_name)) AS student_name
       FROM students s
       JOIN guardian_students gs ON gs.student_id = s.student_id
       JOIN guardian_profiles gp ON gp.guardian_id = gs.guardian_id AND gp.organization_id = $2
       WHERE s.class_id = $1 AND s.organization_id = $2 AND gp.phone IS NOT NULL AND TRIM(gp.phone) <> ''

       UNION ALL

       SELECT 'Guardian' AS guardian_name, g.phone AS phone, TRIM(CONCAT(s.first_name, ' ', s.last_name)) AS student_name
       FROM students s
       JOIN guardians g ON g.student_id = s.student_id
       WHERE s.class_id = $1 AND s.organization_id = $2 AND g.organization_id = $2 AND g.phone IS NOT NULL AND TRIM(g.phone) <> ''
     ) contacts
     WHERE phone IS NOT NULL AND TRIM(phone) <> ''`,
    [classId, organizationId]
  ).catch(() => ({ rows: [] }));

  return result.rows.map((row) => ({
    phone: safeString(row.phone),
    guardianName: safeString(row.guardian_name) || "Guardian",
    guardianTitleLastName: safeString(row.guardian_name) || "Guardian",
    studentName: safeString(row.student_name) || "your child",
  }));
}

async function getAllGuardianContacts(dbClient, organizationId) {
  const result = await dbClient.query(
    `SELECT DISTINCT ON (phone) guardian_name, phone
     FROM (
       SELECT COALESCE(NULLIF(TRIM(CONCAT(gp.first_name, ' ', gp.last_name)), ''), 'Guardian') AS guardian_name, gp.phone AS phone
       FROM guardian_profiles gp
       WHERE gp.organization_id = $1 AND gp.phone IS NOT NULL AND TRIM(gp.phone) <> ''

       UNION ALL

       SELECT 'Guardian' AS guardian_name, g.phone AS phone
       FROM guardians g
       WHERE g.organization_id = $1 AND g.phone IS NOT NULL AND TRIM(g.phone) <> ''
     ) contacts
     WHERE phone IS NOT NULL AND TRIM(phone) <> ''`,
    [organizationId]
  ).catch(() => ({ rows: [] }));

  return result.rows.map((row) => ({
    phone: safeString(row.phone),
    guardianName: safeString(row.guardian_name) || "Guardian",
    guardianTitleLastName: safeString(row.guardian_name) || "Guardian",
  }));
}

async function getGuardiansForSelectedStudents(dbClient, organizationId, studentIds, classId, termId) {
  const ids = (Array.isArray(studentIds) ? studentIds : []).map((id) => Number(id)).filter((id) => Number.isFinite(id) && id > 0);
  if (!ids.length) return [];

  const [studentRows, postedRows] = await Promise.all([
    dbClient.query(
      `SELECT s.student_id, s.first_name, s.last_name, c.class_name
       FROM students s
       LEFT JOIN classes c ON c.class_id = s.class_id
       WHERE s.organization_id = $1 AND s.student_id = ANY($2::int[])`,
      [organizationId, ids]
    ),
    dbClient.query(
      `SELECT student_id, pdf_url FROM posted_report_cards
       WHERE organization_id = $1 AND class_id = $2 AND term_id = $3 AND student_id = ANY($4::int[])`,
      [organizationId, classId, termId, ids]
    ),
  ]);

  const classNameByStudent = new Map((studentRows.rows || []).map((r) => [Number(r.student_id), safeString(r.class_name)]));
  const pdfUrlByStudent = new Map((postedRows.rows || []).map((r) => [Number(r.student_id), safeString(r.pdf_url)]));

  const guardianRows = await Promise.all(ids.map((id) => getGuardiansForStudent(dbClient, organizationId, id)));

  const recipients = [];
  ids.forEach((studentId, index) => {
    (guardianRows[index] || []).forEach((g) => {
      recipients.push({
        ...g,
        studentId,
        className: classNameByStudent.get(studentId) || "",
        pdfUrl: pdfUrlByStudent.get(studentId) || "",
      });
    });
  });
  return recipients;
}

// Resolves recipients + a sensible default message for a given context.
// Shared by both /resolve (preview) and /broadcast (actual send), so they
// can never disagree about who "12 guardians of Grade 10A" actually is.
async function resolveContext(dbClient, req, body, { generatePdf = true } = {}) {
  const organizationId = req.session.organizationId;
  const context = safeString(body.context).toLowerCase();
  const schoolName = await getSchoolName(dbClient, organizationId);
  const baseUrl = baseUrlFromRequest(req);

  if (context === "transcript") {
    const studentId = Number(body.contextId || 0);
    if (!studentId) throw new Error("Missing student.");
    const studentRow = (
      await dbClient.query(
        `SELECT s.student_id, s.first_name, s.last_name, c.class_name
         FROM students s LEFT JOIN classes c ON c.class_id = s.class_id
         WHERE s.student_id = $1 AND s.organization_id = $2`,
        [studentId, organizationId]
      )
    ).rows[0];
    if (!studentRow) throw new Error("Student not found.");
    const studentName = `${studentRow.first_name || ""} ${studentRow.last_name || ""}`.trim();

    const recipients = await getGuardiansForStudent(dbClient, organizationId, studentId);

    // Transcripts always carry the PDF link — generate it now (on-demand,
    // via Puppeteer + S3) rather than relying on one existing already.
    let shortLink = "";
    try {
      const pdfUrl = await ensureTranscriptPdfLink(dbClient, req, studentId);
      if (pdfUrl) {
        shortLink = await createShortLink(dbClient, { targetUrl: pdfUrl, organizationId, baseUrl });
      }
    } catch (_) {
      shortLink = "";
    }

    // Fallback wording only fires if PDF generation genuinely failed
    // (e.g. no session cookie available) — not a normal case.
    const defaultMessage = shortLink
      ? `Hi {{guardianTitleLastName}}, {{schoolName}}: {{studentName}}'s transcript is ready. View: ${shortLink}`
      : `Hi {{guardianTitleLastName}}, {{schoolName}}: {{studentName}}'s transcript is ready. This is also available on your parent portal.`;

    return {
      recipients,
      recipientDescription: `${recipients.length} guardian${recipients.length === 1 ? "" : "s"} of ${studentName || "this student"}`,
      defaultMessage,
      schoolName,
    };
  }

  if (context === "report") {
    const studentIds = Array.isArray(body.studentIds) ? body.studentIds : String(body.studentIds || "").split(",").filter(Boolean);
    const classId = Number(body.classId || 0);
    const termId = Number(body.termId || 0);
    if (!studentIds.length || !classId || !termId) throw new Error("Missing report selection.");
    const numericStudentIds = studentIds.map((id) => Number(id)).filter((id) => Number.isFinite(id) && id > 0);

    const recipients = await getGuardiansForSelectedStudents(dbClient, organizationId, studentIds, classId, termId);

    const termRow = (await dbClient.query("SELECT term_name FROM terms WHERE term_id = $1 AND organization_id = $2 LIMIT 1", [termId, organizationId])).rows[0];
    const termName = safeString(termRow?.term_name) || `Term ${termId}`;
    recipients.forEach((r) => { r.term = termName; });

    // Built regardless of DB-known guardians, so a manually-added email/
    // phone (via the modal's "edit contacts" panel) for a student with no
    // guardian on file still resolves a name/class/link for its message.
    const studentMetaRows = numericStudentIds.length
      ? await dbClient.query(
          `SELECT s.student_id, TRIM(CONCAT(s.first_name, ' ', s.last_name)) AS student_name, c.class_name
           FROM students s LEFT JOIN classes c ON c.class_id = s.class_id
           WHERE s.organization_id = $1 AND s.student_id = ANY($2::int[])`,
          [organizationId, numericStudentIds]
        )
      : { rows: [] };
    const studentMetaById = {};
    (studentMetaRows.rows || []).forEach((r) => {
      studentMetaById[String(r.student_id)] = { studentName: safeString(r.student_name) || "your child", className: safeString(r.class_name) || "" };
    });
    const shortLinkByStudentId = {};

    // "Posted" = every selected student already has a cached report-card
    // PDF (posted_report_cards). Checked WITHOUT generating anything, so
    // opening the modal (a preview) never kicks off Puppeteer — only an
    // actual Send (generatePdf: true) does that, as the explicit "post"
    // step of the send sequence.
    const distinctStudentIds = [...new Set(recipients.map((r) => r.studentId).filter(Boolean))];
    const alreadyPostedIds = new Set(recipients.filter((r) => r.pdfUrl).map((r) => r.studentId));
    const posted = distinctStudentIds.length > 0 && distinctStudentIds.every((id) => alreadyPostedIds.has(id));

    let postedAt = null;
    if (posted) {
      const postedAtRow = (
        await dbClient.query(
          `SELECT MAX(posted_at) AS posted_at FROM posted_report_cards
           WHERE organization_id = $1 AND class_id = $2 AND term_id = $3 AND student_id = ANY($4::int[])`,
          [organizationId, classId, termId, distinctStudentIds]
        )
      ).rows[0];
      postedAt = postedAtRow?.posted_at || null;
    }

    // Report cards always carry the PDF link. Short-linking an already-
    // cached pdfUrl is cheap (DB insert) and happens on every resolve/send.
    // Generating a MISSING one (Puppeteer + S3) — the actual "post" step —
    // only happens when generatePdf is true (i.e. during an actual Send,
    // not while the modal is just previewing recipients).
    const pdfFailedStudentIds = [];
    const pdfUrlByStudentId = new Map();
    const shortLinkByPdfUrl = new Map();
    for (const recipient of recipients) {
      const studentIdKey = recipient.studentId || null;

      let pdfUrl = recipient.pdfUrl || (studentIdKey ? pdfUrlByStudentId.get(studentIdKey) : "");
      if (!pdfUrl && studentIdKey && generatePdf) {
        // eslint-disable-next-line no-await-in-loop
        pdfUrl = await ensureReportPdfLink(dbClient, req, {
          studentId: studentIdKey,
          classId,
          termId,
          studentName: recipient.studentName,
        });
        pdfUrlByStudentId.set(studentIdKey, pdfUrl);
      }
      if (!pdfUrl) {
        if (generatePdf && studentIdKey && !pdfFailedStudentIds.includes(studentIdKey)) pdfFailedStudentIds.push(studentIdKey);
        continue;
      }

      if (!shortLinkByPdfUrl.has(pdfUrl)) {
        // eslint-disable-next-line no-await-in-loop
        const link = await createShortLink(dbClient, { targetUrl: pdfUrl, organizationId, baseUrl });
        shortLinkByPdfUrl.set(pdfUrl, link);
      }
      recipient.shortLink = shortLinkByPdfUrl.get(pdfUrl);
      if (studentIdKey) shortLinkByStudentId[String(studentIdKey)] = recipient.shortLink;
    }

    // A student can have zero guardians on file (never hit the loop above)
    // but still get a manually-added email/phone via the modal's "edit
    // contacts" panel — make sure their PDF/link exists too when sending.
    if (generatePdf) {
      for (const sid of numericStudentIds) {
        if (shortLinkByStudentId[String(sid)]) continue;
        const meta = studentMetaById[String(sid)] || {};
        // eslint-disable-next-line no-await-in-loop
        let pdfUrl = pdfUrlByStudentId.get(sid) || (await ensureReportPdfLink(dbClient, req, { studentId: sid, classId, termId, studentName: meta.studentName }));
        if (!pdfUrl) {
          if (!pdfFailedStudentIds.includes(sid)) pdfFailedStudentIds.push(sid);
          continue;
        }
        if (!shortLinkByPdfUrl.has(pdfUrl)) {
          // eslint-disable-next-line no-await-in-loop
          const link = await createShortLink(dbClient, { targetUrl: pdfUrl, organizationId, baseUrl });
          shortLinkByPdfUrl.set(pdfUrl, link);
        }
        shortLinkByStudentId[String(sid)] = shortLinkByPdfUrl.get(pdfUrl);
      }
    }

    // Fallback wording only fires if PDF generation genuinely failed for
    // every recipient (e.g. no session cookie available) — not a normal case.
    const anyLinked = recipients.some((r) => r.shortLink) || posted;
    const defaultMessage = anyLinked
      ? `Hi {{guardianTitleLastName}}, {{schoolName}}: {{studentName}}'s {{className}} report card ({{term}}) is ready. View: {{shortLink}}`
      : `Hi {{guardianTitleLastName}}, {{schoolName}}: {{studentName}}'s {{className}} report card ({{term}}) is ready. This is also available on your parent portal.`;

    Object.keys(studentMetaById).forEach((sid) => {
      studentMetaById[sid].term = termName;
      studentMetaById[sid].shortLink = shortLinkByStudentId[sid] || "";
    });

    return {
      recipients,
      recipientDescription: `${recipients.length} guardian${recipients.length === 1 ? "" : "s"} of ${studentIds.length} selected student${studentIds.length === 1 ? "" : "s"}`,
      defaultMessage,
      schoolName,
      posted,
      postedAt,
      pdfFailedStudentIds,
      studentMetaById,
    };
  }

  if (context === "transportation") {
    const classId = Number(body.contextId || 0);
    if (!classId) throw new Error("Missing class.");
    const classRow = (await dbClient.query("SELECT class_name FROM classes WHERE class_id = $1 AND organization_id = $2", [classId, organizationId])).rows[0];
    const recipients = await getGuardiansForClass(dbClient, organizationId, classId);

    return {
      recipients,
      recipientDescription: `${recipients.length} guardian${recipients.length === 1 ? "" : "s"} of ${safeString(classRow?.class_name) || "this class"}`,
      defaultMessage: `{{schoolName}}: Transport update for {{studentName}}'s route. Please contact the office for details.`,
      schoolName,
    };
  }

  if (context === "announcement" || context === "event") {
    const id = Number(body.contextId || 0);
    if (!id) throw new Error("Missing item.");
    const isEvent = context === "event";
    const row = (
      await dbClient.query(
        isEvent
          ? "SELECT name AS title, event_date AS date, details, visibility FROM school_events WHERE id = $1 AND organization_id = $2"
          : "SELECT message AS title, NULL AS date, message AS details, visibility FROM announcements WHERE announcement_id = $1 AND organization_id = $2",
        [id, organizationId]
      )
    ).rows[0];
    if (!row) throw new Error("Not found.");
    if (safeString(row.visibility).toLowerCase() === "org") {
      throw new Error("This is internal-only — no guardians to notify.");
    }

    const recipients = await getAllGuardianContacts(dbClient, organizationId);
    // Announcements/events are always sent in full — no truncation — with a
    // fixed "Announcement/Event from {schoolName}:" lead-in, so guardians
    // get the complete text rather than a shortened preview.
    const title = safeString(row.title);
    const dateStr = row.date ? new Date(row.date).toISOString().slice(0, 10) : "";
    const detail = safeString(row.details).replace(/\s+/g, " ");

    const defaultMessage = isEvent
      ? `Event from {{schoolName}}: ${title} on ${dateStr || "TBD"}. ${detail}`
      : `Announcement from {{schoolName}}: ${detail}`;

    return {
      recipients,
      recipientDescription: `${recipients.length} guardian${recipients.length === 1 ? "" : "s"} school-wide`,
      defaultMessage,
      schoolName,
    };
  }

  throw new Error("Unsupported recipient scope.");
}

module.exports = {
  getGuardiansForStudent,
  getGuardiansForClass,
  getAllGuardianContacts,

  // Org-wide directory for the Mailroom page — every guardian with a phone
  // and/or email on file, grouped by guardian so one row shows both,
  // together with the student(s) they're linked to.
  mailroomDirectory: async (req, res) => {
    const orgId = req.session.organizationId;
    if (!orgId) return res.status(401).json({ success: false, message: "Not authenticated." });
    try {
      const restrictedClassIds = await getMailroomAllowedClassIds(req);
      // null = unrestricted (every guardian org-wide); an array (possibly
      // empty) means the employee's mailroom access is scoped to specific
      // classes only — a student with no class in that list stays hidden,
      // and a guardian with no linked student at all is unresolvable so it
      // stays hidden too rather than guessing.
      const restrictClause = restrictedClassIds ? "AND s.class_id = ANY($2::int[])" : "";
      const params = restrictedClassIds ? [orgId, restrictedClassIds] : [orgId];

      const result = await db.query(
        `SELECT guardian_id, source, guardian_name, phone, email,
                array_remove(array_agg(DISTINCT student_name), NULL) AS student_names
         FROM (
           SELECT gp.guardian_id, 'profile' AS source,
                  COALESCE(NULLIF(TRIM(CONCAT(gp.first_name, ' ', gp.last_name)), ''), 'Guardian') AS guardian_name,
                  NULLIF(TRIM(gp.phone), '') AS phone,
                  NULLIF(TRIM(gp.email), '') AS email,
                  NULLIF(TRIM(CONCAT(s.first_name, ' ', s.last_name)), '') AS student_name
           FROM guardian_profiles gp
           ${restrictedClassIds ? "JOIN" : "LEFT JOIN"} guardian_students gs ON gs.guardian_id = gp.guardian_id
           ${restrictedClassIds ? "JOIN" : "LEFT JOIN"} students s ON s.student_id = gs.student_id AND s.organization_id = $1
           WHERE gp.organization_id = $1 AND (gp.phone IS NOT NULL OR gp.email IS NOT NULL)
             AND (TRIM(COALESCE(gp.phone, '')) <> '' OR TRIM(COALESCE(gp.email, '')) <> '')
             ${restrictClause}

           UNION ALL

           SELECT g.guardian_id, 'legacy' AS source, 'Guardian' AS guardian_name,
                  NULLIF(TRIM(g.phone), '') AS phone,
                  NULLIF(TRIM(g.email), '') AS email,
                  NULLIF(TRIM(CONCAT(s.first_name, ' ', s.last_name)), '') AS student_name
           FROM guardians g
           ${restrictedClassIds ? "JOIN" : "LEFT JOIN"} students s ON s.student_id = g.student_id AND s.organization_id = $1
           WHERE g.organization_id = $1 AND (g.phone IS NOT NULL OR g.email IS NOT NULL)
             AND (TRIM(COALESCE(g.phone, '')) <> '' OR TRIM(COALESCE(g.email, '')) <> '')
             ${restrictClause}
         ) contacts
         GROUP BY guardian_id, source, guardian_name, phone, email
         ORDER BY guardian_name`,
        params
      );
      const contacts = (result.rows || []).map((row) => ({
        guardianId: row.guardian_id,
        source: row.source,
        guardianName: row.guardian_name,
        phone: safeString(row.phone),
        email: safeString(row.email),
        studentNames: Array.isArray(row.student_names) ? row.student_names : [],
      }));
      return res.json({ success: true, contacts });
    } catch (error) {
      return res.status(500).json({ success: false, message: "Unable to load contacts." });
    }
  },

  // Ad-hoc send to any selection of guardian contacts, not tied to a
  // class/term/student context — password-gated like every other send in
  // this app, logged to the same delivery_audit_history table so it shows
  // up alongside report/transcript sends without needing a second history UI.
  mailroomSend: async (req, res) => {
    const orgId = req.session.organizationId;
    if (!orgId) return res.status(401).json({ success: false, message: "Not authenticated." });
    try {
      const channel = safeString(req.body?.channel).toLowerCase();
      const message = safeString(req.body?.message);
      const password = safeString(req.body?.password);
      const recipients = Array.isArray(req.body?.recipients) ? req.body.recipients : [];

      if (!["sms", "whatsapp", "email"].includes(channel)) {
        return res.status(400).json({ success: false, message: "Invalid channel." });
      }
      if (!message) return res.status(400).json({ success: false, message: "Message is required." });
      if (!recipients.length) return res.status(400).json({ success: false, message: "Select at least one recipient." });
      if (!password) return res.status(400).json({ success: false, message: "Enter your password to confirm." });

      const passwordOk = await verifyActorPassword(req, password);
      if (!passwordOk) return res.status(401).json({ success: false, message: "Incorrect password." });

      // Never trust a client-submitted phone/email directly — validate every
      // recipient against this employee's actual (permission-scoped)
      // guardian directory and send to the DB's contact value, not
      // whatever the request body claims. This is what makes the mailroom
      // class-scope restriction actually enforceable, not just a UI hint.
      const restrictedClassIds = await getMailroomAllowedClassIds(req);
      const allowedContacts = await getMailroomContactsMap(orgId, restrictedClassIds);
      const field = channel === "email" ? "email" : "phone";

      const normalizedRecipients = [];
      let skippedOutOfScope = 0;
      recipients.forEach((r) => {
        const guardianId = safeString(r.guardianId);
        const source = safeString(r.source);
        const allowed = guardianId && source ? allowedContacts.get(`${source}:${guardianId}`) : null;
        const value = allowed ? allowed[field] : "";
        if (!value) {
          skippedOutOfScope += 1;
          return;
        }
        normalizedRecipients.push({
          phone: field === "phone" ? value : "",
          email: field === "email" ? value : "",
          guardianName: safeString(r.guardianName) || "Guardian",
          guardianTitleLastName: safeString(r.guardianName) || "Guardian",
          studentName: safeString(r.studentName) || "",
        });
      });

      if (!normalizedRecipients.length) {
        return res.status(400).json({
          success: false,
          message: "None of the selected recipients are within your mailroom access.",
        });
      }

      const actorUserId = Number(req.session.userId || req.session.user?.user_id) || null;
      const actorNameRow = actorUserId
        ? (
            await db.query(
              `SELECT COALESCE(NULLIF(TRIM(CONCAT(first_name, ' ', last_name)), ''), email, 'Unknown') AS actor_name
               FROM users WHERE user_id = $1 AND organization_id = $2 LIMIT 1`,
              [actorUserId, orgId]
            )
          ).rows[0]
        : null;
      const actorName = actorNameRow?.actor_name || "Unknown";
      const batchId = `mailroom-${Date.now()}`;

      // The provider round trips (SMTP/SMS/WhatsApp API calls) are the slow
      // part, not the DB writes — so write a "pending" row per recipient and
      // respond immediately, then do the actual sending in the background.
      // The client shows these as pending and polls history for the flip to
      // sent/failed, instead of the Send button sitting frozen for however
      // long every provider call takes to round-trip.
      const pendingRows = await Promise.all(
        normalizedRecipients.map((r) =>
          recordDeliveryAuditRow(db, {
            organizationId: orgId,
            eventDomain: channel,
            eventName: "mailroom_send",
            actorUserId,
            actorName,
            recipient: r.phone || r.email,
            status: "pending",
            batchId,
            metadata: { guardianName: r.guardianName, message },
          })
        )
      );

      const skippedNote = skippedOutOfScope
        ? ` (${skippedOutOfScope} recipient${skippedOutOfScope === 1 ? "" : "s"} outside your mailroom access were skipped.)`
        : "";

      res.json({
        success: true,
        pending: true,
        batchId,
        skippedOutOfScope,
        rows: pendingRows.map((row, i) => ({
          id: row.id,
          recipient: normalizedRecipients[i].phone || normalizedRecipients[i].email,
          guardianName: normalizedRecipients[i].guardianName,
          channel,
          status: "pending",
        })),
        message: `Sending to ${normalizedRecipients.length} recipient${normalizedRecipients.length === 1 ? "" : "s"}...${skippedNote}`,
      });

      const schoolName = await getSchoolName(db, orgId);
      sendGuardianMessages(db, orgId, {
        channel,
        recipients: normalizedRecipients,
        messageTemplate: message,
        schoolName,
        onResult: (result, index) => {
          const rowId = pendingRows[index]?.id;
          if (!rowId) return;
          updateDeliveryAuditRowStatus(db, {
            id: rowId,
            status: result.success ? "sent" : "failed",
            metadata: { guardianName: result.guardianName, message, error: result.error || null },
          }).catch(() => {});
        },
      }).catch((error) => {
        // The batch never started (e.g. provider not configured) — every
        // row that's still pending gets marked failed instead of hanging.
        console.error("[Mailroom] Send batch failed to start:", error);
        pendingRows.forEach((row) => {
          updateDeliveryAuditRowStatus(db, {
            id: row.id,
            status: "failed",
            metadata: { message, error: error?.message || "Send failed." },
          }).catch(() => {});
        });
      });
    } catch (error) {
      if (!res.headersSent) {
        return res.status(500).json({ success: false, message: error?.message || "Unable to send." });
      }
    }
  },

  // Retries a single failed row in place (same history entry flips back to
  // pending, then to sent/failed) rather than creating a duplicate.
  mailroomResend: async (req, res) => {
    const orgId = req.session.organizationId;
    if (!orgId) return res.status(401).json({ success: false, message: "Not authenticated." });
    try {
      const id = Number(req.body?.id);
      const password = safeString(req.body?.password);
      if (!id) return res.status(400).json({ success: false, message: "Missing message id." });
      if (!password) return res.status(400).json({ success: false, message: "Enter your password to confirm." });

      const passwordOk = await verifyActorPassword(req, password);
      if (!passwordOk) return res.status(401).json({ success: false, message: "Incorrect password." });

      const row = (
        await db.query(
          `SELECT id, event_domain, recipient_emails, metadata FROM delivery_audit_history
           WHERE id = $1 AND organization_id = $2 AND event_name = 'mailroom_send' LIMIT 1`,
          [id, orgId]
        )
      ).rows[0];
      if (!row) return res.status(404).json({ success: false, message: "Message not found." });

      const channel = safeString(row.event_domain);
      const recipientValue = Array.isArray(row.recipient_emails) ? safeString(row.recipient_emails[0]) : "";
      const metadata = row.metadata || {};
      const message = safeString(metadata.message);
      if (!recipientValue || !message || !["sms", "whatsapp", "email"].includes(channel)) {
        return res.status(400).json({ success: false, message: "This message can't be resent." });
      }

      await updateDeliveryAuditRowStatus(db, { id, status: "pending", metadata: { ...metadata, error: null } });
      res.json({ success: true, id, status: "pending" });

      const schoolName = await getSchoolName(db, orgId);
      const recipient = {
        phone: channel === "email" ? "" : recipientValue,
        email: channel === "email" ? recipientValue : "",
        guardianName: safeString(metadata.guardianName) || "Guardian",
        guardianTitleLastName: safeString(metadata.guardianName) || "Guardian",
        studentName: "",
      };
      sendGuardianMessages(db, orgId, { channel, recipients: [recipient], messageTemplate: message, schoolName })
        .then((results) => {
          const r = results[0] || { success: false, error: "Send failed." };
          return updateDeliveryAuditRowStatus(db, {
            id,
            status: r.success ? "sent" : "failed",
            metadata: { ...metadata, error: r.error || null },
          });
        })
        .catch((error) => {
          updateDeliveryAuditRowStatus(db, {
            id,
            status: "failed",
            metadata: { ...metadata, error: error?.message || "Send failed." },
          }).catch(() => {});
        });
    } catch (error) {
      if (!res.headersSent) {
        return res.status(500).json({ success: false, message: error?.message || "Unable to resend." });
      }
    }
  },

  mailroomHistory: async (req, res) => {
    const orgId = req.session.organizationId;
    if (!orgId) return res.status(401).json({ success: false, message: "Not authenticated." });
    try {
      // History doesn't track which class a past recipient belonged to, so
      // it can't be filtered row-by-row the way the directory/send are.
      // Instead: a class-restricted employee only ever sees the history of
      // messages THEY sent (which, since sends are already scope-validated,
      // is guaranteed to be within their own scope) — never other
      // employees' sends, which could reveal contacts outside their access.
      const restrictedClassIds = await getMailroomAllowedClassIds(req);
      const isRestricted = restrictedClassIds !== null;
      const actorUserId = req.session.userId || req.session.user?.user_id || null;

      const result = await db.query(
        isRestricted
          ? `SELECT id, event_domain, recipient_emails, status, batch_id, actor_name, metadata, created_at
             FROM delivery_audit_history
             WHERE organization_id = $1 AND event_name = 'mailroom_send' AND actor_user_id = $2
               AND created_at >= NOW() - INTERVAL '30 days'
             ORDER BY COALESCE(updated_at, created_at) DESC
             LIMIT 200`
          : `SELECT id, event_domain, recipient_emails, status, batch_id, actor_name, metadata, created_at
             FROM delivery_audit_history
             WHERE organization_id = $1 AND event_name = 'mailroom_send'
               AND created_at >= NOW() - INTERVAL '30 days'
             ORDER BY COALESCE(updated_at, created_at) DESC
             LIMIT 200`,
        isRestricted ? [orgId, actorUserId] : [orgId]
      );
      return res.json({ success: true, history: result.rows || [] });
    } catch (error) {
      return res.status(500).json({ success: false, message: "Unable to load history." });
    }
  },

  channelStatus: async (req, res) => {
    const orgId = req.session.organizationId;
    if (!orgId) return res.status(401).json({ success: false, message: "Not authenticated." });
    try {
      const status = await getMessagingChannelStatus(db, orgId);
      return res.json({ success: true, ...status });
    } catch (error) {
      return res.status(500).json({ success: false, message: "Unable to check messaging status." });
    }
  },

  // Preview: who gets it + a suggested (still-editable) message, without
  // sending anything and without generating a report PDF that isn't
  // already cached (that only happens on an actual Send — see broadcast).
  resolve: async (req, res) => {
    const orgId = req.session.organizationId;
    if (!orgId) return res.status(401).json({ success: false, message: "Not authenticated." });
    try {
      const channelStatus = await getMessagingChannelStatus(db, orgId);
      const { recipients, recipientDescription, defaultMessage, posted, postedAt } = await resolveContext(
        db,
        req,
        req.body || {},
        { generatePdf: false }
      );
      return res.json({
        success: true,
        recipientCount: recipients.length,
        recipientDescription,
        defaultMessage,
        posted: Boolean(posted),
        postedAt: postedAt || null,
        channels: {
          sms: channelStatus.sms,
          whatsapp: channelStatus.whatsapp,
          email: channelStatus.email,
        },
      });
    } catch (error) {
      return res.status(400).json({ success: false, message: error?.message || "Unable to resolve recipients." });
    }
  },

  // Send sequence: verify password -> post to portal if not already posted
  // (report context only; stops here and reports the error if posting
  // fails) -> fire each selected channel using the now-posted PDF link.
  // `channels` may be a single string (legacy shared modal, one channel at
  // a time) or an array (Send Report modal, multiple checkboxes).
  broadcast: async (req, res) => {
    const orgId = req.session.organizationId;
    if (!orgId) return res.status(401).json({ success: false, message: "Not authenticated." });

    try {
      const rawChannels = req.body?.channels;
      const channels = (Array.isArray(rawChannels) ? rawChannels : rawChannels ? [rawChannels] : [req.body?.channel])
        .map((c) => safeString(c).toLowerCase())
        .filter((c) => ["sms", "whatsapp", "email"].includes(c));
      const password = safeString(req.body?.password);
      const message = safeString(req.body?.message);
      const context = safeString(req.body?.context).toLowerCase();

      if (!password) return res.status(400).json({ success: false, message: "Enter your password to confirm." });
      const passwordOk = await verifyActorPassword(req, password);
      if (!passwordOk) return res.status(401).json({ success: false, message: "Incorrect password." });

      if (channels.length && !message) {
        return res.status(400).json({ success: false, message: "Message is required." });
      }

      const actorUserId = Number(req.session.userId || req.session.user?.user_id) || null;
      const actorNameRow = actorUserId
        ? (
            await db.query(
              `SELECT COALESCE(NULLIF(TRIM(CONCAT(first_name, ' ', last_name)), ''), email, 'Unknown') AS actor_name
               FROM users WHERE user_id = $1 AND organization_id = $2 LIMIT 1`,
              [actorUserId, orgId]
            )
          ).rows[0]
        : null;
      const actorName = actorNameRow?.actor_name || "Unknown";
      const batchId = `sr_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

      // "Post to portal" is now optional (report context) — a school can
      // notify guardians without (re)posting, or post without notifying.
      // Default true for every other context, where posting never applied.
      const shouldPost = context === "report" ? req.body?.post !== false : true;

      // generatePdf: true here is the "post" step — for a report, this is
      // where any not-yet-posted student's PDF actually gets generated.
      const { recipients, schoolName, posted, pdfFailedStudentIds, studentMetaById } = await resolveContext(
        db,
        req,
        req.body || {},
        { generatePdf: context === "report" ? shouldPost : true }
      );

      if (context === "report" && shouldPost && Array.isArray(pdfFailedStudentIds) && pdfFailedStudentIds.length) {
        return res.status(500).json({
          success: false,
          message: `Could not post the report card for ${pdfFailedStudentIds.length} student(s). Nothing was sent — refresh and try again.`,
        });
      }

      // No channels selected = post-only (report context) / preview-only
      // for other contexts. Posting itself already happened above, and
      // post-only doesn't need any guardian contact info at all.
      if (!channels.length) {
        if (context === "report" && !shouldPost) {
          return res.json({ success: true, posted: false, sentCount: 0, failedCount: 0, message: "No changes made." });
        }
        return res.json({
          success: true,
          posted: true,
          sentCount: 0,
          failedCount: 0,
          message: "Posted to portal.",
        });
      }

      // "Edit contacts" panel in the Send Report modal — corrected/added
      // emails or phone numbers for this send only, keyed by studentId.
      // Only the checked ("include") rows in that panel end up here, so
      // unchecking a contact there is how a school leaves someone out.
      const emailOverrides = context === "report" ? req.body?.emailOverrides : null;
      const phoneOverrides = context === "report" ? req.body?.phoneOverrides : null;

      // For "already sent" checks below — report context sends are keyed
      // by classId:termId:studentId so re-sending the same report doesn't
      // silently re-log against a different key.
      const classId = context === "report" ? Number(req.body?.classId || 0) : null;
      const termId = context === "report" ? Number(req.body?.termId || 0) : null;

      const allResults = [];
      for (const channel of channels) {
        let channelRecipients = recipients;
        let usingOverride = false;
        if (channel === "email" && emailOverrides && Object.keys(emailOverrides).length) {
          channelRecipients = buildOverrideRecipients(emailOverrides, studentMetaById || {}, "email");
          usingOverride = true;
        } else if ((channel === "sms" || channel === "whatsapp") && phoneOverrides && Object.keys(phoneOverrides).length) {
          channelRecipients = buildOverrideRecipients(phoneOverrides, studentMetaById || {}, "phone");
          usingOverride = true;
        }

        // Blank contacts never get this far (DB queries + override
        // collection both already drop empty values) — this is just a
        // defensive final filter before anything is dialed/emailed.
        const contactField = channel === "email" ? "email" : "phone";
        channelRecipients = channelRecipients.filter((r) => safeString(r[contactField]));

        // For the DEFAULT (non-override) path only — a school that opened
        // the edit drawer and explicitly re-checked an "Already sent" row
        // is making an informed choice to resend, so overrides are never
        // filtered here. This is what stops an accidental double-send when
        // someone just hits "Send Report" again without reviewing.
        let skippedAlreadySent = 0;
        if (context === "report" && !usingOverride && classId && termId) {
          const contextKeys = channelRecipients.map((r) => `${classId}:${termId}:${r.studentId}`);
          // eslint-disable-next-line no-await-in-loop
          const sentSet = await getSentRecipientSet(db, { organizationId: orgId, context: "report", contextKeys, channel });
          const before = channelRecipients.length;
          channelRecipients = channelRecipients.filter((r) => {
            const key = `${classId}:${termId}:${r.studentId}|${String(r[contactField] || "").trim().toLowerCase()}`;
            return !sentSet.has(key);
          });
          skippedAlreadySent = before - channelRecipients.length;
          for (let i = 0; i < skippedAlreadySent; i += 1) {
            allResults.push({ success: false, skipped: true, error: "Already sent — skipped to avoid repeating." });
          }
        }

        if (!channelRecipients.length) {
          if (!skippedAlreadySent) {
            allResults.push({ success: false, error: `No ${channel === "email" ? "email addresses" : "phone numbers"} found for ${channel}.` });
          }
          continue;
        }

        // eslint-disable-next-line no-await-in-loop
        const results = await sendGuardianMessages(db, orgId, {
          channel,
          recipients: channelRecipients,
          messageTemplate: message,
          schoolName,
        }).catch((error) => channelRecipients.map(() => ({ success: false, error: error?.message || "Send failed." })));

        if (context === "report" && classId && termId) {
          for (const [i, result] of results.entries()) {
            if (!result.success) continue;
            const recipient = channelRecipients[i];
            const studentId = recipient?.studentId;
            const contact = channel === "email" ? result.email : result.phone;
            if (!studentId || !contact) continue;
            // eslint-disable-next-line no-await-in-loop
            await recordMessageSent(db, {
              organizationId: orgId,
              context: "report",
              contextKey: `${classId}:${termId}:${studentId}`,
              channel,
              recipient: contact,
            }).catch(() => {});
            // Also logged to the shared delivery_audit_history table so
            // this send shows up on the existing Report History page
            // (/print/emailHistoryPage) alongside email sends.
            // eslint-disable-next-line no-await-in-loop
            await recordDeliveryAuditRow(db, {
              organizationId: orgId,
              eventDomain: channel,
              eventName: "report_notify_sent",
              classId,
              termId,
              studentId,
              studentName: recipient?.studentName || null,
              actorUserId,
              actorName,
              recipient: contact,
              status: "sent",
              batchId,
              metadata: { source: "sendReportModal" },
            }).catch(() => {});
          }
        }

        allResults.push(...results);
      }

      const sentCount = allResults.filter((r) => r.success).length;
      const skippedCount = allResults.filter((r) => r.skipped).length;
      const failedCount = allResults.length - sentCount - skippedCount;
      const postedPrefix = context === "report" && shouldPost ? "Posted · " : "";
      const skippedSuffix = skippedCount ? ` · ${skippedCount} already sent (skipped)` : "";

      return res.json({
        success: failedCount === 0,
        posted: context === "report" ? shouldPost : undefined,
        sentCount,
        failedCount,
        skippedCount,
        results: allResults,
        message: failedCount
          ? `${postedPrefix}Sent to ${sentCount} guardian(s), ${failedCount} failed${skippedSuffix}.`
          : `${postedPrefix}Sent to ${sentCount} guardian(s) (0 failed)${skippedSuffix}.`,
      });
    } catch (error) {
      return res.status(400).json({ success: false, message: error?.message || "Unable to send." });
    }
  },

  // Which guardian contacts (for the given students/channel/report) have
  // already been messaged — lets the "Edit contacts" drawer flag them and
  // default their "include" checkbox to unchecked, so re-sending a report
  // doesn't double-text/email everyone by default.
  sentStatus: async (req, res) => {
    const orgId = req.session.organizationId;
    if (!orgId) return res.status(401).json({ success: false, message: "Not authenticated." });
    try {
      const { classId, termId, studentIds, channel } = req.body || {};
      const normalizedChannel = safeString(channel).toLowerCase();
      const ids = (Array.isArray(studentIds) ? studentIds : []).map((id) => Number(id)).filter((id) => Number.isFinite(id) && id > 0);
      if (!classId || !termId || !ids.length || !["sms", "whatsapp", "email"].includes(normalizedChannel)) {
        return res.status(400).json({ success: false, message: "Missing parameters." });
      }

      const contextKeys = ids.map((id) => `${Number(classId)}:${Number(termId)}:${id}`);
      const sentSet = await getSentRecipientSet(db, { organizationId: orgId, context: "report", contextKeys, channel: normalizedChannel });

      // { [studentId]: ["+233...", ...] } — recipients already messaged.
      const sentByStudentId = {};
      ids.forEach((id) => {
        const key = `${Number(classId)}:${Number(termId)}:${id}`;
        sentByStudentId[id] = [...sentSet]
          .filter((entry) => entry.startsWith(`${key}|`))
          .map((entry) => entry.slice(key.length + 1));
      });

      return res.json({ success: true, sentByStudentId });
    } catch (error) {
      return res.status(500).json({ success: false, message: "Unable to check delivery status." });
    }
  },

  // Persists edits made in the "Edit contacts" drawer back to the actual
  // guardian record, so a corrected number/email doesn't need re-entering
  // on the next report send. Only touches rows the client can trace back
  // to a specific guardian_id/source — a brand-new value typed for a
  // student with no guardian on file has nowhere to be saved (skipped,
  // reported back so the UI can say so honestly rather than pretend).
  saveContacts: async (req, res) => {
    const orgId = req.session.organizationId;
    if (!orgId) return res.status(401).json({ success: false, message: "Not authenticated." });
    try {
      const type = safeString(req.body?.type).toLowerCase();
      const changes = Array.isArray(req.body?.changes) ? req.body.changes : [];
      const password = safeString(req.body?.password);
      if (!["email", "phone"].includes(type)) {
        return res.status(400).json({ success: false, message: "Invalid contact type." });
      }
      if (!changes.length) {
        return res.json({ success: true, saved: 0, failed: 0, skipped: 0 });
      }
      if (!password) return res.status(400).json({ success: false, message: "Enter your password to confirm." });
      const passwordOk = await verifyActorPassword(req, password);
      if (!passwordOk) return res.status(401).json({ success: false, message: "Incorrect password." });

      const column = type === "email" ? "email" : "phone";
      let saved = 0;
      let failed = 0;
      let skipped = 0;

      for (const change of changes) {
        const guardianId = Number(change?.guardianId || 0);
        const source = safeString(change?.source).toLowerCase();
        const value = safeString(change?.value);
        if (!guardianId || !["profile", "legacy"].includes(source) || !value) {
          skipped += 1;
          continue;
        }
        try {
          const table = source === "profile" ? "guardian_profiles" : "guardians";
          // eslint-disable-next-line no-await-in-loop
          const result = await db.query(
            `UPDATE ${table} SET ${column} = $1 WHERE guardian_id = $2 AND organization_id = $3`,
            [value, guardianId, orgId]
          );
          if (result.rowCount > 0) saved += 1;
          else skipped += 1;
        } catch (error) {
          failed += 1;
        }
      }

      return res.json({
        success: failed === 0,
        saved,
        failed,
        skipped,
        message: failed
          ? `Saved ${saved}, ${failed} failed to save.`
          : skipped
            ? `Saved ${saved}. ${skipped} had no existing guardian record to update, so ${skipped === 1 ? "it" : "they"} only applied to this send.`
            : `Saved ${saved} contact${saved === 1 ? "" : "s"} for next time.`,
      });
    } catch (error) {
      return res.status(500).json({ success: false, message: "Unable to save contacts." });
    }
  },

  // Resend one specific report message from the History page — for a
  // guardian who says they never got it. Independent of the "already
  // sent" skip logic in broadcast() (this IS the deliberate resend path),
  // but still logs the same way so History shows the new attempt too.
  resend: async (req, res) => {
    const orgId = req.session.organizationId;
    if (!orgId) return res.status(401).json({ success: false, message: "Not authenticated." });
    try {
      const { classId, termId, studentId, channel, recipient, password } = req.body || {};
      const normalizedChannel = safeString(channel).toLowerCase();
      if (!classId || !termId || !studentId || !recipient || !["sms", "whatsapp", "email"].includes(normalizedChannel)) {
        return res.status(400).json({ success: false, message: "Missing parameters." });
      }
      if (!safeString(password)) return res.status(400).json({ success: false, message: "Enter your password to confirm." });
      const passwordOk = await verifyActorPassword(req, password);
      if (!passwordOk) return res.status(401).json({ success: false, message: "Incorrect password." });

      const { schoolName, defaultMessage, studentMetaById } = await resolveContext(
        db,
        req,
        { context: "report", studentIds: [studentId], classId, termId },
        { generatePdf: true }
      );

      const meta = studentMetaById[String(studentId)] || {};
      const recipientRow = {
        [normalizedChannel === "email" ? "email" : "phone"]: safeString(recipient),
        studentId: Number(studentId),
        studentName: meta.studentName || "your child",
        className: meta.className || "",
        term: meta.term || "",
        shortLink: meta.shortLink || "",
        guardianName: "Guardian",
        guardianTitleLastName: "Guardian",
      };

      const results = await sendGuardianMessages(db, orgId, {
        channel: normalizedChannel,
        recipients: [recipientRow],
        messageTemplate: defaultMessage,
        schoolName,
      });
      const result = results[0] || { success: false, error: "Send failed." };

      if (result.success) {
        const actorUserId = Number(req.session.userId || req.session.user?.user_id) || null;
        const actorNameRow = actorUserId
          ? (
              await db.query(
                `SELECT COALESCE(NULLIF(TRIM(CONCAT(first_name, ' ', last_name)), ''), email, 'Unknown') AS actor_name
                 FROM users WHERE user_id = $1 AND organization_id = $2 LIMIT 1`,
                [actorUserId, orgId]
              )
            ).rows[0]
          : null;
        const contextKey = `${Number(classId)}:${Number(termId)}:${Number(studentId)}`;
        await recordMessageSent(db, { organizationId: orgId, context: "report", contextKey, channel: normalizedChannel, recipient }).catch(() => {});
        await recordDeliveryAuditRow(db, {
          organizationId: orgId,
          eventDomain: normalizedChannel,
          eventName: "report_notify_sent",
          classId: Number(classId),
          termId: Number(termId),
          studentId: Number(studentId),
          studentName: meta.studentName || null,
          actorUserId,
          actorName: actorNameRow?.actor_name || "Unknown",
          recipient,
          status: "sent",
          batchId: `resend_${Date.now()}`,
          metadata: { source: "historyResend" },
        }).catch(() => {});
      }

      return res.json({
        success: result.success,
        message: result.success ? "Resent." : result.error || "Resend failed.",
      });
    } catch (error) {
      return res.status(400).json({ success: false, message: error?.message || "Unable to resend." });
    }
  },
};
