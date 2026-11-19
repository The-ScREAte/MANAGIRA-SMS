"use strict";
// A template for a read group (files starting with "_" aren't loaded). Copy to <group>.js.
const { ReadError, needAny, classesInReach, cap } = require("./index");

module.exports = {
  // GET /internal/api/read/example_tool?classId=1005
  example_tool: {
    async run(db, actor, q) {
      await needAny(db, actor, ["manage_students"], "Manage Students");
      const reach = await classesInReach(db, actor); // null = every class
      const classId = parseInt(q.classId, 10);
      if (reach && classId && !reach.has(classId)) throw new ReadError("PERMISSION_DENIED", "You can see only your own classes.");
      const { rows } = await db.query("SELECT student_id, first_name FROM students WHERE organization_id = $1 AND class_id = $2", [actor.organizationId, classId]);
      const { rows: shown, truncated } = cap(rows);
      return { data: shown, totals: { students: rows.length }, scope: { classId }, truncated };
    },
  },
};
