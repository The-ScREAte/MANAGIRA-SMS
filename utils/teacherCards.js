"use strict";

// A child's teachers, for their family and for the student (feature teacher_cards): the class's
// main teacher, its assistant teachers and the teachers of the child's own subjects in that class.
// Names, photos and roles always show; email, phone and About me only where the child's class
// shares them with that audience (Class settings › Share with: teacherEmail, teacherPhone,
// teacherAbout). Never drivers, people on hold, removed accounts or Managira's own roles.

const classSettings = require("./classSettings");
const staffAbout = require("./staffAbout");
const { assistantReady } = require("./mainTeacher");

const FEATURE = "teacher_cards";
const isOn = (organizationId) => require("./shards/features").isOn(FEATURE, { organizationId: Number(organizationId) });
const SCHOOL_ROLES = ["manager", "supervisor", "teacher"];
const nameOf = (row) => [row.first_name, row.last_name].filter(Boolean).join(" ").trim() || "Teacher";

// audience: "parents" or "students". child: { id, classId }.
async function forChild(db, organizationId, child, audience) {
  if (!child || !child.id || !child.classId) return { teachers: [], shares: {} };
  const assistants = await assistantReady(db);
  const [{ rows }, sharedMap] = await Promise.all([
    db.query(
      `WITH leads AS (
         SELECT uc.user_id, BOOL_OR(COALESCE(uc.main, FALSE)) AS main,
                ${assistants ? "BOOL_OR(COALESCE(uc.assistant, FALSE))" : "FALSE"} AS assistant
           FROM user_classes uc
          WHERE uc.class_id = $3 AND (COALESCE(uc.main, FALSE)${assistants ? " OR COALESCE(uc.assistant, FALSE)" : ""})
          GROUP BY uc.user_id
       ), taught AS (
         SELECT us.user_id, ARRAY_AGG(DISTINCT subj.subject_name ORDER BY subj.subject_name) AS subjects
           FROM student_subjects ss
           JOIN subjects subj ON subj.subject_id = ss.subject_id AND subj.organization_id = ss.organization_id AND subj.class_id = $3
           JOIN user_subjects us ON us.subject_id = subj.subject_id
           JOIN user_classes uc ON uc.user_id = us.user_id AND uc.class_id = $3
          WHERE ss.organization_id = $1 AND ss.student_id = $2
          GROUP BY us.user_id
       )
       SELECT u.user_id, u.first_name, u.last_name, u.email, u.phone_number, u.image_url, u.profile_image_url,
              COALESCE(l.main, FALSE) AS main, COALESCE(l.assistant, FALSE) AS assistant, COALESCE(t.subjects, '{}') AS subjects
         FROM users u
         LEFT JOIN leads l ON l.user_id = u.user_id
         LEFT JOIN taught t ON t.user_id = u.user_id
        WHERE u.organization_id = $1
          AND (l.user_id IS NOT NULL OR t.user_id IS NOT NULL)
          AND COALESCE(u.on_hold, FALSE) = FALSE
          AND u.removed_at IS NULL
          AND LOWER(COALESCE(u.account_type::text, '')) = ANY($4::text[])
        ORDER BY COALESCE(l.main, FALSE) DESC, COALESCE(l.assistant, FALSE) DESC, LOWER(u.last_name), LOWER(u.first_name), u.user_id`,
      [organizationId, child.id, child.classId, SCHOOL_ROLES]
    ),
    classSettings.sharedFor(db, organizationId, [child.id], audience),
  ]);
  const shares = sharedMap.get(Number(child.id)) || classSettings.withDefaults(null)[audience];
  const showAbout = shares.teacherAbout !== false && staffAbout.isOn(organizationId);
  const about = showAbout ? await staffAbout.many(db, organizationId, rows.map((r) => r.user_id)) : new Map();
  const teachers = rows.map((row) => {
    const mine = about.get(Number(row.user_id));
    const roleLine = row.main ? "Main teacher" : row.assistant ? "Assistant teacher" : "Subject teacher";
    return {
      id: Number(row.user_id),
      name: nameOf(row),
      role: roleLine,
      main: Boolean(row.main),
      subjects: (row.subjects || []).filter(Boolean),
      photo: row.profile_image_url || row.image_url || null,
      email: shares.teacherEmail !== false ? row.email || "" : "",
      phone: shares.teacherPhone === true ? String(row.phone_number || "").trim() : "",
      funFact: mine ? mine.funFact : "",
      photos: mine ? mine.photos : [],
    };
  });
  return { teachers, shares: { email: shares.teacherEmail !== false, phone: shares.teacherPhone === true, about: showAbout } };
}

module.exports = { FEATURE, isOn, forChild };
