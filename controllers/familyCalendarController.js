"use strict";

// The calendar pages for parents and students, and their private calendar links.
const features = require("../utils/shards/features");
const familyCalendar = require("../utils/familyCalendar");
const { baseUrl } = require("../utils/workspace");
const { getOpenAssessments, resolveCurrentStudentTermContext } = require("./studentController");
const { childrenOf, openWorkFor } = require("./parentHubController");

const DAY = /^\d{4}-\d{2}-\d{2}$/;
const toId = (value) => {
  const id = Number.parseInt(value, 10);
  return Number.isInteger(id) && id > 0 ? id : null;
};
const addDays = (key, n) => {
  const day = new Date(`${key}T00:00:00Z`);
  day.setUTCDate(day.getUTCDate() + n);
  return day.toISOString().slice(0, 10);
};
const activitiesOn = (organizationId) => features.isOn("class_activities", { organizationId });
const hubOn = (organizationId) => features.isOn("parent_student_hub", { organizationId });
const allowsQuestions = (list) => (list || []).some((name) => /set assessment questions|assessment questions/i.test(String(name)));
const allowsTestingRoom = (list) => (list || []).some((name) => /testing room|set assessment questions|assessment questions/i.test(String(name)));

function datesFrom(req, res) {
  const from = DAY.test(String(req.query.from || "")) ? req.query.from : null;
  const to = DAY.test(String(req.query.to || "")) ? req.query.to : null;
  if (!from || !to) {
    res.status(400).json({ success: false, message: "Choose dates." });
    return null;
  }
  return { from, to };
}

// Homework and tests closing, for a parent: only what the child can open and the teacher shows.
async function workForChildren(db, organizationId, children, from, to) {
  const out = [];
  const workOf = async (child) => {
    const context = await resolveCurrentStudentTermContext(db, organizationId, child.id);
    return {
      child,
      work: await openWorkFor(db, organizationId, { id: child.id, classId: context.enrolledClassId || child.classId, termId: context.selectedTerm ? context.selectedTerm.term_id : null }),
    };
  };
  // The first alone: right after a restart it sets up what the others then use at once.
  const perChild = children.length ? [await workOf(children[0]), ...await Promise.all(children.slice(1).map(workOf))] : [];
  perChild.forEach(({ child, work }) => work.filter((row) => row.due).forEach((row) => {
    const date = new Date(row.due).toISOString().slice(0, 10);
    if (date < from || date >= to) return;
    out.push({ id: `work-${row.setId}-${child.id}`, kind: "work", title: row.title, date, details: row.subject, link: `/guardian/child/work/${row.setId}?studentId=${child.id}`, studentIds: [child.id] });
  }));
  return out;
}

// A student's own tests closing.
async function workForStudent(db, organizationId, studentId, classId, termId, from, to) {
  if (!classId || !termId) return [];
  const open = await getOpenAssessments(db, organizationId, studentId, classId, termId);
  return open.filter((row) => row.edit_window_end).map((row) => ({
    id: `work-${row.assessment_id}`,
    kind: "work",
    title: row.title,
    date: new Date(row.edit_window_end).toISOString().slice(0, 10),
    details: row.subject_name || "",
    link: `/student/testing-room/${row.assessment_id}`,
    studentIds: [studentId],
  })).filter((row) => row.date >= from && row.date < to);
}

async function studentPerson(db, organizationId, studentId) {
  const { rows } = await db.query(
    "SELECT student_id, first_name, class_id FROM students WHERE student_id = $1 AND organization_id = $2",
    [studentId, organizationId]
  );
  if (!rows[0]) return null;
  const context = await resolveCurrentStudentTermContext(db, organizationId, studentId);
  return {
    id: studentId,
    name: rows[0].first_name || "",
    classId: context.enrolledClassId || rows[0].class_id,
    termId: context.selectedTerm ? context.selectedTerm.term_id : null,
  };
}

const answer = (res, message, error) => {
  console.error(`[Family calendar] ${message}:`, error.message);
  return res.status(500).json({ success: false, message: "The calendar could not load." });
};

function syncHandlers(ownerKind, ownerIdOf, nameOf) {
  return {
    sync: async (req, res, db) => {
      const organizationId = req.session.organizationId;
      if (!activitiesOn(organizationId)) return res.status(404).json({ success: false });
      try {
        const token = await familyCalendar.feedToken(db, organizationId, ownerKind, ownerIdOf(req));
        return res.json({ success: true, links: familyCalendar.linksFor(baseUrl(req), token, nameOf(req)) });
      } catch (error) {
        return answer(res, "sync", error);
      }
    },
    reset: async (req, res, db) => {
      const organizationId = req.session.organizationId;
      if (!activitiesOn(organizationId)) return res.status(404).json({ success: false });
      try {
        const token = await familyCalendar.resetFeed(db, organizationId, ownerKind, ownerIdOf(req));
        return res.json({ success: true, links: familyCalendar.linksFor(baseUrl(req), token, nameOf(req)) });
      } catch (error) {
        return answer(res, "reset", error);
      }
    },
  };
}

const schoolName = (req) => `${req.session.organizationName || "School"} calendar`;
const guardianSync = syncHandlers("guardian", (req) => req.session.guardianId, schoolName);
const studentSync = syncHandlers("student", (req) => req.session.studentId, schoolName);

module.exports = {
  guardianPage: async (req, res, db) => {
    const organizationId = req.session.organizationId;
    if (!activitiesOn(organizationId)) return res.redirect("/guardian/dashboard");
    try {
      const children = await childrenOf(db, organizationId, req.session.guardianId);
      return res.render("guardian/calendar", {
        title: "Calendar",
        children: children.map((child) => ({ id: child.id, name: child.name })),
        initialDate: DAY.test(String(req.query.date || "")) ? req.query.date : "",
        initialChild: toId(req.query.studentId) || "",
        calendarBase: "/guardian/calendar",
        calendarNote: "",
      });
    } catch (error) {
      console.error("[Family calendar] page:", error.message);
      req.flash("error", "The calendar could not load. Try again.");
      return res.redirect("/guardian/dashboard");
    }
  },

  guardianFeed: async (req, res, db) => {
    const organizationId = req.session.organizationId;
    if (!activitiesOn(organizationId)) return res.status(404).json({ success: false });
    const dates = datesFrom(req, res);
    if (!dates) return undefined;
    try {
      const children = await childrenOf(db, organizationId, req.session.guardianId);
      const items = await familyCalendar.itemsFor(db, organizationId, children, dates);
      if (hubOn(organizationId) && allowsQuestions(res.locals.allowedFeatures)) {
        items.push(...await workForChildren(db, organizationId, children, dates.from, dates.to));
      }
      return res.json({ success: true, items });
    } catch (error) {
      return answer(res, "feed", error);
    }
  },
  guardianSync: guardianSync.sync,
  guardianReset: guardianSync.reset,

  studentPage: async (req, res, db) => {
    const organizationId = req.session.organizationId;
    if (!activitiesOn(organizationId)) return res.redirect("/student/dashboard");
    return res.render("guardian/calendar", {
      title: "Calendar",
      children: [],
      initialDate: DAY.test(String(req.query.date || "")) ? req.query.date : "",
      initialChild: "",
      calendarBase: "/student/calendar",
    });
  },

  studentFeed: async (req, res, db) => {
    const organizationId = req.session.organizationId;
    if (!activitiesOn(organizationId)) return res.status(404).json({ success: false });
    const dates = datesFrom(req, res);
    if (!dates) return undefined;
    try {
      const person = await studentPerson(db, organizationId, req.session.studentId);
      if (!person) return res.json({ success: true, items: [] });
      const items = await familyCalendar.itemsFor(db, organizationId, [person], dates);
      if (allowsTestingRoom(req.session.allowedFeatures)) {
        items.push(...await workForStudent(db, organizationId, person.id, person.classId, person.termId, dates.from, dates.to));
      }
      return res.json({ success: true, items });
    } catch (error) {
      return answer(res, "student feed", error);
    }
  },
  studentSync: studentSync.sync,
  studentReset: studentSync.reset,

  // GET /calendar/family/:token.ics: fetched by Google, Outlook or Apple, with no sign-in.
  ics: async (req, res, db) => {
    res.set("X-Robots-Tag", "noindex, nofollow");
    res.set("Referrer-Policy", "no-referrer");
    try {
      const token = String(req.params.token || "");
      const feed = await familyCalendar.findFeed(db, token);
      if (!feed || !activitiesOn(feed.organization_id)) return res.status(404).send("Not found");
      const organizationId = feed.organization_id;
      const from = addDays(new Date().toISOString().slice(0, 10), -60);
      const to = addDays(new Date().toISOString().slice(0, 10), 365);
      const text = await familyCalendar.icsFor(feed, token, async () => {
        const people = feed.owner_kind === "guardian"
          ? await childrenOf(db, organizationId, feed.owner_id)
          : [await studentPerson(db, organizationId, feed.owner_id)].filter(Boolean);
        const items = await familyCalendar.itemsFor(db, organizationId, people, { from, to, withLessons: false });
        return { items, names: new Map(people.map((person) => [person.id, person.name])) };
      }, req.get("host"));
      res.set("Content-Type", "text/calendar; charset=utf-8");
      res.set("Cache-Control", "private, max-age=900");
      res.set("Content-Disposition", 'inline; filename="school-calendar.ics"');
      return res.send(text);
    } catch (error) {
      console.error("[Family calendar] link:", error.message);
      return res.status(500).send("Calendar unavailable");
    }
  },
};
