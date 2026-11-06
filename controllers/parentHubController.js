"use strict";

// The parent's side: a student's tiles, their homework and tests, documents, activities and
// the family calendar. A parent sees schoolwork only while their child can, and only when
// the teacher chose to show it. Every page checks the child is theirs first.
const sanitizeHtml = require("../utils/sanitizeHtml");
const features = require("../utils/shards/features");
const { listActivities } = require("../utils/classActivities");
const parentResources = require("../utils/parentResources");
const { guardianHasStudentAccess } = require("./guardianController");
const { getOpenAssessments, resolveCurrentStudentTermContext } = require("./studentController");
const { getStudentTransportationSnapshot } = require("./transportationController");
const { getTransportationIntegrationStatus } = require("../utils/transportation");
const { getClassScheduleForTerm } = require("../utils/classScheduleService");

const HOMEWORK = /home\s*work|assignment|take[-\s]?home/i;
const DAY = /^\d{4}-\d{2}-\d{2}$/;
const toId = (value) => {
  const id = Number.parseInt(value, 10);
  return Number.isInteger(id) && id > 0 ? id : null;
};
const hubOn = (req) => features.isOn("parent_student_hub", { organizationId: req.session.organizationId });
const activitiesOn = (req) => features.isOn("class_activities", { organizationId: req.session.organizationId });
const hasQuestions = (res) => (res.locals.allowedFeatures || []).some((name) => /set assessment questions|assessment questions/i.test(String(name)));

function backToDashboard(req, res, message) {
  if (message) req.flash("error", message);
  return res.redirect("/guardian/dashboard");
}

async function childFor(req, db) {
  const organizationId = req.session.organizationId;
  const studentId = toId(req.query.studentId);
  if (!studentId || !(await guardianHasStudentAccess(db, req.session.guardianId, organizationId, studentId))) return null;
  const { rows } = await db.query(
    `SELECT s.student_id, s.first_name, s.last_name, s.image_url, s.class_id, c.class_name
       FROM students s
       LEFT JOIN classes c ON c.class_id = s.class_id AND c.organization_id = s.organization_id
      WHERE s.student_id = $1 AND s.organization_id = $2`,
    [studentId, organizationId]
  );
  if (!rows[0]) return null;
  const { selectedTerm, enrolledClassId } = await resolveCurrentStudentTermContext(db, organizationId, studentId);
  return {
    id: studentId,
    firstName: rows[0].first_name || "",
    name: [rows[0].first_name, rows[0].last_name].filter(Boolean).join(" "),
    imageUrl: rows[0].image_url,
    className: rows[0].class_name || "",
    classId: enrolledClassId || rows[0].class_id,
    termId: selectedTerm ? selectedTerm.term_id : null,
  };
}

// What the child can open in the Testing Room right now, and the teacher shows to parents.
async function openWorkFor(db, organizationId, child) {
  if (!child.classId || !child.termId) return [];
  const open = await getOpenAssessments(db, organizationId, child.id, child.classId, child.termId);
  const shown = await parentResources.shownSets(db, organizationId, open.map((row) => Number(row.question_set_id)).filter(Boolean));
  return open.filter((row) => shown.has(Number(row.question_set_id))).map((row) => ({
    setId: Number(row.question_set_id),
    title: row.title,
    subject: row.subject_name,
    category: row.category || "",
    due: row.edit_window_end,
    questions: Number(row.question_count) || 0,
    homework: HOMEWORK.test(String(row.category || "")),
    notes: shown.get(Number(row.question_set_id)).parent_notes || "",
  }));
}

const guard = (allowed, handler) => async (req, res, db) => {
  if (!allowed(req)) return backToDashboard(req, res);
  try {
    return await handler(req, res, db);
  } catch (error) {
    console.error("[Parent hub]", error.message);
    return backToDashboard(req, res, "That page could not load. Try again.");
  }
};

const withChild = (handler) => async (req, res, db) => {
  const child = await childFor(req, db);
  if (!child) return backToDashboard(req, res, "You do not have access to that student.");
  return handler(req, res, db, child);
};

// Children of this parent in this school, for the calendar.
async function childrenOf(db, organizationId, guardianId) {
  const { rows } = await db.query(
    `SELECT s.student_id, s.first_name, s.last_name, s.class_id
       FROM students s
      WHERE s.organization_id = $1 AND COALESCE(s.graduated, FALSE) = FALSE
        AND (
          EXISTS (SELECT 1 FROM guardians g WHERE g.student_id = s.student_id AND g.guardian_id = $2 AND g.organization_id = $1)
          OR EXISTS (SELECT 1 FROM guardian_students gs WHERE gs.student_id = s.student_id AND gs.guardian_id = $2)
        )
      ORDER BY LOWER(s.first_name)`,
    [organizationId, guardianId]
  );
  return rows.map((row) => ({ id: Number(row.student_id), name: row.first_name || [row.first_name, row.last_name].filter(Boolean).join(" "), classId: row.class_id }));
}

module.exports = {
  // Opens at once. The numbers on the tiles come from counts below.
  hub: guard(hubOn, withChild(async (req, res, db, child) => {
    const integration = await getTransportationIntegrationStatus(db, req.session.organizationId).catch(() => null);
    res.render("guardian/childHub", {
      title: child.name,
      child,
      showSchoolwork: hasQuestions(res),
      showActivities: activitiesOn(req),
      showTransport: Boolean(integration && integration.activated),
    });
  })),

  counts: async (req, res, db) => {
    if (!hubOn(req)) return res.status(404).json({ success: false });
    try {
      const child = await childFor(req, db);
      if (!child) return res.status(403).json({ success: false });
      const organizationId = req.session.organizationId;
      const today = new Date().toISOString().slice(0, 10);
      const [work, sets, upcoming, transport] = await Promise.all([
        hasQuestions(res) ? openWorkFor(db, organizationId, child) : [],
        hasQuestions(res) ? parentResources.termSetsForChild(db, organizationId, child.id, child.classId, child.termId) : [],
        activitiesOn(req) ? listActivities(db, organizationId, { classIds: child.classId ? [child.classId] : [], from: today }) : [],
        getStudentTransportationSnapshot(db, organizationId, child.id).catch(() => null),
      ]);
      const files = await parentResources.filesForSets(db, organizationId, sets.map((row) => Number(row.question_set_id)));
      return res.json({
        success: true,
        transport,
        counts: {
          activities: upcoming.length,
          homework: work.filter((row) => row.homework).length,
          testing: work.filter((row) => !row.homework).length,
          documents: files.length,
        },
      });
    } catch (error) {
      console.error("[Parent hub] counts:", error.message);
      return res.status(500).json({ success: false });
    }
  },

  schedule: guard(hubOn, withChild(async (req, res, db, child) => {
    const schedule = child.classId && child.termId
      ? await getClassScheduleForTerm(db, { organizationId: req.session.organizationId, classId: child.classId, termId: child.termId })
      : null;
    res.render("guardian/childList", {
      title: "Schedule",
      child,
      mode: "schedule",
      days: schedule ? schedule.groupedByDay.filter((day) => day.items.length) : [],
    });
  })),

  activities: guard(activitiesOn, withChild(async (req, res, db, child) => {
    const all = await listActivities(db, req.session.organizationId, { classIds: child.classId ? [child.classId] : [] });
    const today = new Date().toISOString().slice(0, 10);
    res.render("guardian/childList", {
      title: "Activities",
      child,
      mode: "activities",
      coming: all.filter((row) => (row.endDate || row.date) >= today),
      past: all.filter((row) => (row.endDate || row.date) < today).reverse(),
    });
  })),

  homework: guard(hubOn, withChild(async (req, res, db, child) => {
    const work = await openWorkFor(db, req.session.organizationId, child);
    res.render("guardian/childList", { title: "Homework", child, mode: "work", work: work.filter((row) => row.homework) });
  })),

  testingRoom: guard(hubOn, withChild(async (req, res, db, child) => {
    const work = await openWorkFor(db, req.session.organizationId, child);
    res.render("guardian/childList", { title: "Testing Room", child, mode: "work", work: work.filter((row) => !row.homework) });
  })),

  documents: guard(hubOn, withChild(async (req, res, db, child) => {
    const organizationId = req.session.organizationId;
    const sets = await parentResources.termSetsForChild(db, organizationId, child.id, child.classId, child.termId);
    const files = await parentResources.filesForSets(db, organizationId, sets.map((row) => Number(row.question_set_id)));
    const setById = new Map(sets.map((row) => [Number(row.question_set_id), row]));
    res.render("guardian/childList", {
      title: "Assessment documents",
      child,
      mode: "documents",
      files: files.map((file) => ({ ...file, title: setById.get(file.setId)?.title || "", subject: setById.get(file.setId)?.subject_name || "" })),
    });
  })),

  work: guard(hubOn, withChild(async (req, res, db, child) => {
    const organizationId = req.session.organizationId;
    const setId = toId(req.params.setId);
    const work = (await openWorkFor(db, organizationId, child)).find((row) => row.setId === setId);
    if (!work) {
      req.flash("error", "That work is no longer open.");
      return res.redirect(`/guardian/child?studentId=${child.id}`);
    }
    const [questions, files] = await Promise.all([
      parentResources.questionsForParents(db, organizationId, setId),
      parentResources.filesForSets(db, organizationId, [setId]),
    ]);
    return res.render("guardian/childWork", {
      title: work.title,
      child,
      work,
      files,
      questions: questions.map((row) => ({
        type: row.question_type,
        marks: Number(row.marks) || 0,
        html: sanitizeHtml(String(row.question_text || ""), { allowedTags: ["b", "strong", "i", "em", "u", "br", "sub", "sup", "p"], allowedAttributes: {} }),
        options: Array.isArray(row.options_json) ? row.options_json.map((option) => String(option && typeof option === "object" ? option.text || option.label || "" : option)) : [],
      })),
    });
  })),

  file: guard(hubOn, withChild(async (req, res, db, child) => {
    const organizationId = req.session.organizationId;
    const file = await parentResources.fileById(db, organizationId, toId(req.params.fileId));
    const sets = file ? await parentResources.termSetsForChild(db, organizationId, child.id, child.classId, child.termId) : [];
    if (!file || !sets.some((row) => Number(row.question_set_id) === Number(file.question_set_id))) {
      req.flash("error", "That document isn't available.");
      return res.redirect(`/guardian/child?studentId=${child.id}`);
    }
    return res.redirect(file.file_url);
  })),

  calendar: guard(activitiesOn, async (req, res, db) => {
    const children = await childrenOf(db, req.session.organizationId, req.session.guardianId);
    res.render("guardian/calendar", {
      title: "Calendar",
      children: children.map((child) => ({ id: child.id, name: child.name })),
      initialDate: DAY.test(String(req.query.date || "")) ? req.query.date : "",
      initialChild: toId(req.query.studentId) || "",
    });
  }),

  calendarFeed: async (req, res, db) => {
    if (!activitiesOn(req)) return res.status(404).json({ success: false });
    try {
      const organizationId = req.session.organizationId;
      const from = DAY.test(String(req.query.from || "")) ? req.query.from : null;
      const to = DAY.test(String(req.query.to || "")) ? req.query.to : null;
      if (!from || !to) return res.status(400).json({ success: false, message: "Choose dates." });
      const children = await childrenOf(db, organizationId, req.session.guardianId);
      const classIds = [...new Set(children.map((child) => child.classId).filter(Boolean))].map(Number);
      const [activities, events] = await Promise.all([
        listActivities(db, organizationId, { classIds, from, to }),
        db.query(
          `SELECT id, name, to_char(event_date, 'YYYY-MM-DD') AS day, to_char(end_date, 'YYYY-MM-DD') AS end_day, start_time, end_time, location, details
             FROM school_events
            WHERE organization_id = $1 AND visibility IN ('public', 'both') AND event_date IS NOT NULL
              AND event_date < $3::date AND COALESCE(end_date, event_date) >= $2::date
            ORDER BY event_date`,
          [organizationId, from, to]
        ),
      ]);
      const items = activities.map((row) => ({
        id: `activity-${row.id}`,
        kind: "activity",
        title: row.title,
        date: row.date,
        endDate: row.endDate,
        startTime: row.startTime,
        endTime: row.endTime,
        location: row.location,
        details: row.details,
        studentIds: row.classId === null ? children.map((child) => child.id) : children.filter((child) => Number(child.classId) === row.classId).map((child) => child.id),
      }));
      events.rows.forEach((row) => items.push({
        id: `event-${row.id}`,
        kind: "event",
        title: row.name,
        date: row.day,
        endDate: row.end_day,
        startTime: row.start_time ? String(row.start_time).slice(0, 5) : null,
        endTime: row.end_time ? String(row.end_time).slice(0, 5) : null,
        location: row.location || "",
        details: row.details || "",
        studentIds: children.map((child) => child.id),
      }));
      // Homework and tests a teacher shows to parents, on the day they close.
      if (hubOn(req) && hasQuestions(res)) {
        const perChild = await Promise.all(children.map(async (child) => {
          const context = await resolveCurrentStudentTermContext(db, organizationId, child.id);
          return { child, work: await openWorkFor(db, organizationId, { id: child.id, classId: context.enrolledClassId || child.classId, termId: context.selectedTerm?.term_id }) };
        }));
        perChild.forEach(({ child, work }) => work.filter((row) => row.due).forEach((row) => {
          const date = new Date(row.due).toISOString().slice(0, 10);
          if (date < from || date >= to) return;
          items.push({ id: `work-${row.setId}-${child.id}`, kind: "work", title: row.title, date, details: row.subject, link: `/guardian/child/work/${row.setId}?studentId=${child.id}`, studentIds: [child.id] });
        }));
      }
      return res.json({ success: true, items });
    } catch (error) {
      console.error("[Parent calendar]", error.message);
      return res.status(500).json({ success: false, message: "The calendar could not load." });
    }
  },
};
