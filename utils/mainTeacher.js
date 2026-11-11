"use strict";

// A class's main teacher is the one person in charge of it: they mark its attendance, keep its
// schedule, and work on every subject and report card of the class. One per class
// (user_classes.main). It is chosen on the staff form, beside the person's classes and
// permissions, and nowhere else; pages that list classes say which ones have nobody in charge.

const nameOf = (row) => [row.first_name, row.last_name].filter(Boolean).join(" ").trim() || "Unnamed";

// class id -> { userId, name } for every class of the school that has a main teacher.
async function mainTeachersByClass(db, organizationId) {
  const { rows } = await db.query(
    `SELECT DISTINCT ON (uc.class_id) uc.class_id, u.user_id, u.first_name, u.last_name
       FROM user_classes uc
       JOIN classes c ON c.class_id = uc.class_id AND c.organization_id = $1
       JOIN users u ON u.user_id = uc.user_id AND u.organization_id = $1
      WHERE uc.main = TRUE
      ORDER BY uc.class_id, u.user_id`,
    [organizationId]
  );
  return new Map(rows.map((row) => [Number(row.class_id), { userId: Number(row.user_id), name: nameOf(row) }]));
}

// The classes in use that have nobody in charge, each with the staff already assigned to it
// (the people who could be chosen). "In use" is the current term's classes; a school with no
// current term gets every class that isn't retired.
async function classesWithoutMainTeacher(db, organizationId) {
  const { rows } = await db.query(
    `WITH in_use AS (
       SELECT DISTINCT ec.class_id
         FROM terms t
         JOIN enrollments e ON e.term_id = t.term_id AND e.organization_id = t.organization_id
         JOIN enrolled_classes ec ON ec.enrollment_id = e.enrollment_id
        WHERE t.organization_id = $1 AND t.current = TRUE
     )
     SELECT c.class_id, c.class_name,
            COALESCE(json_agg(json_build_object('user_id', u.user_id, 'name', TRIM(COALESCE(u.first_name, '') || ' ' || COALESCE(u.last_name, '')))
                              ORDER BY u.first_name, u.last_name, u.user_id)
                     FILTER (WHERE u.user_id IS NOT NULL), '[]'::json) AS staff
       FROM classes c
       LEFT JOIN user_classes uc ON uc.class_id = c.class_id
       LEFT JOIN users u ON u.user_id = uc.user_id AND u.organization_id = c.organization_id
                        AND LOWER(u.account_type::text) <> 'driver' AND COALESCE(u.on_hold, FALSE) = FALSE
      WHERE c.organization_id = $1
        AND c.obsolete_at IS NULL
        AND (NOT EXISTS (SELECT 1 FROM in_use) OR c.class_id IN (SELECT class_id FROM in_use))
        AND NOT EXISTS (
              SELECT 1 FROM user_classes m
                JOIN users mu ON mu.user_id = m.user_id AND mu.organization_id = c.organization_id
               WHERE m.class_id = c.class_id AND m.main = TRUE)
      GROUP BY c.class_id, c.class_name, c.dashboard_sort_order
      ORDER BY COALESCE(c.dashboard_sort_order, 2147483647), c.class_name, c.class_id`,
    [organizationId]
  );
  return rows.map((row) => ({ class_id: Number(row.class_id), class_name: row.class_name, staff: Array.isArray(row.staff) ? row.staff : [] }));
}

const idList = (value) => [...new Set((Array.isArray(value) ? value : value === undefined || value === null || value === "" ? [] : [value])
  .map((entry) => Number(entry)).filter((entry) => Number.isInteger(entry) && entry > 0))];

// Saves a person's classes (already checked to be this school's) with the ones they lead.
// `client` is the caller's transaction. When the form didn't show the choice (`shown` false:
// an older page, or a caller that only changes classes), the classes they already lead and
// still hold stay theirs. Whoever led a class this person now leads steps down: one per class.
async function saveClasses(client, { organizationId, userId, classIds, mainClassIds, shown, canLead = true }) {
  const classes = idList(classIds);
  const before = (await client.query(`SELECT class_id FROM user_classes WHERE user_id = $1 AND main = TRUE`, [userId]))
    .rows.map((row) => Number(row.class_id));
  const wanted = new Set(shown ? idList(mainClassIds) : before);
  const leads = canLead ? classes.filter((classId) => wanted.has(classId)) : [];

  await client.query(`DELETE FROM user_classes WHERE user_id = $1`, [userId]);
  if (classes.length) {
    await client.query(
      `INSERT INTO user_classes (user_id, class_id, main)
       SELECT $1, class_id, class_id = ANY($3::int[]) FROM unnest($2::int[]) AS class_id`,
      [userId, classes, leads]
    );
  }
  if (leads.length) {
    await client.query(
      `UPDATE user_classes uc SET main = FALSE
        WHERE uc.class_id = ANY($1::int[]) AND uc.user_id <> $2 AND uc.main = TRUE
          AND EXISTS (SELECT 1 FROM users u WHERE u.user_id = uc.user_id AND u.organization_id = $3)`,
      [leads, userId, organizationId]
    );
  }
  return { classes, leads };
}

module.exports = { mainTeachersByClass, classesWithoutMainTeacher, saveClasses, idList };
