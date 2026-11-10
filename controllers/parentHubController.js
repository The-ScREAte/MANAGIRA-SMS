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
const assessmentApproval = require("../utils/assessmentApproval");
const testResults = require("../utils/testResults");

const HOMEWORK = /home\s*work|assignment|take[-\s]?home/i;
const DAY = /^\d{4}-\d{2}-\d{2}$/;
const toId = (value) => {
  const id = Number.parseInt(value, 10);
  return Number.isInteger(id) && id > 0 ? id : null;
};
const hubOn = (req) => features.isOn("parent_student_hub", { organizationId: req.session.organizationId });
const activitiesOn = (req) => features.isOn("class_activities", { organizationId: req.session.organizationId });
// Finished tests the teacher shared and posted (the assessments flow).
const resultsFor = (req, db, child) => (assessmentApproval.flowOn(req.session.organizationId)
  ? testResults.sharedResults(db, req.session.organizationId, child.id, { classId: child.classId, termId: child.termId }).catch(() => [])
  : Promise.resolve([]));
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
      const [files, results] = await Promise.all([
        parentResources.filesForSets(db, organizationId, sets.map((row) => Number(row.question_set_id))),
        hasQuestions(res) ? resultsFor(req, db, child) : [],
      ]);
      return res.json({
        success: true,
        transport,
        counts: {
          activities: upcoming.length,
          homework: work.filter((row) => row.homework).length,
          testing: work.filter((row) => !row.homework).length,
          documents: files.length + results.length,
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
    const [work, results] = await Promise.all([openWorkFor(db, req.session.organizationId, child), resultsFor(req, db, child)]);
    res.render("guardian/childList", { title: "Testing Room", child, mode: "work", work: work.filter((row) => !row.homework), results });
  })),

  // A finished test the teacher shared in full: questions, the child's answers, the right ones.
  result: guard(hubOn, withChild(async (req, res, db, child) => {
    const result = assessmentApproval.flowOn(req.session.organizationId)
      ? await testResults.review(db, req.session.organizationId, child.id, toId(req.params.attemptId), res.locals.publicImageUrl)
      : null;
    if (!result) {
      req.flash("error", "That test isn't shared yet.");
      return res.redirect(`/guardian/child/testing-room?studentId=${child.id}`);
    }
    return res.render("guardian/childResult", { title: result.title, child, result });
  })),

  documents: guard(hubOn, withChild(async (req, res, db, child) => {
    const organizationId = req.session.organizationId;
    const sets = await parentResources.termSetsForChild(db, organizationId, child.id, child.classId, child.termId);
    const files = await parentResources.filesForSets(db, organizationId, sets.map((row) => Number(row.question_set_id)));
    const setById = new Map(sets.map((row) => [Number(row.question_set_id), row]));
    const results = await resultsFor(req, db, child);
    res.render("guardian/childList", {
      title: results.length ? "Documents & results" : "Assessment documents",
      child,
      mode: "documents",
      results,
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

  childrenOf,
  openWorkFor,
};
