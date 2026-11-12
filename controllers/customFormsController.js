"use strict";
// The Custom editor (feature custom_forms, utils/customForms.js).
//   Builders (permission Custom Editor): /common/custom-forms in Management Tools
//   designs sections and reads every answer.
//   Staff fill classroom sections in the classroom's Forms tab; drivers fill driver sections in
//   the driver portal; parents (/guardian/child/forms) and students (/student/forms) fill theirs.
//   There is no page of its own for filling in: /common/forms only answers the JSON calls.
const crypto = require("crypto");
const path = require("path");
const cf = require("../utils/customForms");
const { todayKeyFor } = require("../utils/localDate");
const { userHasPermission, sessionActor, PERMISSIONS } = require("../middleware/permissionMiddleware");
const { resolveActor } = require("../utils/workspace");
const { isEmbeddedRequest } = require("../utils/embeddedMode");

const orgOf = (req) => Number(req.session.organizationId);
const toId = (value) => {
  const id = Number.parseInt(value, 10);
  return Number.isInteger(id) && id > 0 ? id : null;
};
const fail = (res, status, error, extra = {}) => res.status(status).json({ success: false, error, ...extra });
const siteUrl = (req) => `${req.protocol}://${req.get("host")}`;
const isBuilder = (db, req) => userHasPermission(db, sessionActor(req), PERMISSIONS.CUSTOM_FORMS).catch(() => false);
const isDriver = (req) => String(req.session?.userRole || req.session?.user?.account_type || req.session?.accountType || "").trim().toLowerCase() === "driver";
const staffSaver = (req) => {
  const actor = resolveActor(req);
  return { type: isDriver(req) ? "driver" : "staff", id: actor.id || null, name: actor.name };
};
// What this person reaches: their classes, every student, or (drivers) their riders.
async function reachOf(db, req, res) {
  const builder = isDriver(req) ? false : await isBuilder(db, req);
  const riders = isDriver(req) ? await require("./driverController").ridersFor(db, req, res).catch(() => []) : null;
  return cf.staffReach(db, req, { builder, riders });
}
const inReach = (reach, student) => Boolean(student) && (reach.students
  ? reach.students.has(student.id)
  : Boolean(student.classId) && (reach.all || reach.classes.has(student.classId)));

// The feature is on for this school and its tables exist.
async function available(db, req) {
  return cf.featureOn(orgOf(req)) && (await cf.ready(db));
}
const wantsJson = (req) => req.method !== "GET" || req.xhr || /json/i.test(req.get("accept") || "") && !/html/i.test(req.get("accept") || "");
const notAvailable = async (req, res, db) => {
  if (wantsJson(req)) return fail(res, 404, "Custom forms aren't available here yet.");
  // Switched on but its tables aren't there yet: say so on the page (also inside the hub).
  if (cf.featureOn(orgOf(req))) {
    const isEmbedded = isEmbeddedRequest(req, req.path.startsWith("/custom-forms") ? "customForms" : "forms");
    return res.status(503).render("common/customFormsSetup", {
      title: "Custom editor",
      builder: db ? await isBuilder(db, req) : false,
      isEmbedded,
      hideGlobalHeader: isEmbedded,
      hideGlobalFooter: isEmbedded,
      hideGlobalChatbot: true,
    });
  }
  req.flash("error", "Custom forms aren't available for this school yet.");
  return res.redirect("/common/orgDashboard");
};

async function classesOf(db, organizationId, only = null) {
  const { rows } = await db.query(
    `SELECT class_id, class_name FROM classes WHERE organization_id = $1 AND ($2::int[] IS NULL OR class_id = ANY($2::int[]))
      ORDER BY LOWER(class_name)`,
    [organizationId, only ? [...only] : null]
  );
  return rows.map((row) => ({ id: Number(row.class_id), name: row.class_name }));
}

// Uploads one file for a form field. The key carries the school, so an entry can only point
// at a file uploaded for that school (utils/customForms.js checks it).
async function storeFile(req, res) {
  const file = req.file;
  if (!file) return fail(res, 400, "Choose a file first.");
  const ext = path.extname(String(file.originalname || "")).toLowerCase().replace(/[^.a-z0-9]/g, "").slice(0, 12);
  const key = `custom-forms/${orgOf(req)}/${crypto.randomUUID()}${ext}`;
  try {
    const { uploadToS3 } = require("../middleware/s3Upload");
    const url = await uploadToS3(file, key);
    return res.json({ success: true, file: { name: String(file.originalname || "File").slice(0, 200), key, url } });
  } catch (error) {
    console.error("[Custom forms] upload:", error.message);
    return fail(res, 500, "That file could not be uploaded. Try again.");
  }
}

// A section a staff member may work on, and whether this student is in it and in their reach.
async function staffContext(db, req, res, { studentId = null } = {}) {
  const organizationId = orgOf(req);
  const reach = await reachOf(db, req, res);
  const builder = reach.builder;
  const section = await cf.getSection(db, organizationId, toId(req.params.id));
  if (!section || !cf.sectionsForStaff([section], reach).length) return { error: [404, "That form isn't available to you."] };
  if (!studentId) return { section, reach, builder };
  const student = await cf.studentInfo(db, organizationId, studentId);
  if (!inReach(reach, student) || !cf.inSection(section, student.classId)) return { error: [404, "That student isn't in this form's classes."] };
  return { section, reach, builder, student };
}
// Who may fill a section in from the staff side: staff a classroom section, drivers a driver
// section; builders may correct anything.
const canEditFor = (context) => context.builder
  || (context.section.filledBy === "staff" && !context.reach.driver)
  || (context.section.filledBy === "driver" && Boolean(context.reach.driver));
// A parent or student form handed in on paper: staff may enter it for them (never over what the
// family itself sent).
const paperFor = (context) => !context.builder && !context.reach.driver && ["parent", "student"].includes(context.section.filledBy);
// The term a page is showing (the classroom can look at another term), else the current one;
// and the day it is working on (the attendance page's day), else today where the person is.
const DAY = /^\d{4}-\d{2}-\d{2}$/;
const dayOfRequest = (req) => {
  const asked = String((req.query && req.query.day) || (req.body && req.body.day) || "");
  return DAY.test(asked) ? asked : todayKeyFor(req);
};
const periodOf = async (db, req) => ({
  ...(await cf.periodFor(db, orgOf(req), (req.query && req.query.termId) || (req.body && req.body.termId))),
  day: dayOfRequest(req),
});

// ── Builders ────────────────────────────────────────────────────────────────────────────
async function editorPage(req, res, db) {
  if (!(await available(db, req))) return notAvailable(req, res, db);
  const organizationId = orgOf(req);
  const isEmbedded = isEmbeddedRequest(req, "customForms");
  // The Custom editor has no page of its own: it opens inside Management Tools.
  if (!isEmbedded && String(req.get("Sec-Fetch-Dest") || "") !== "iframe") return res.redirect(`/common/management?panel=custom-forms&page=${encodeURIComponent(req.originalUrl)}&label=${encodeURIComponent("Custom editor")}`);
  const [sections, counts, classes, channels] = await Promise.all([
    cf.listSections(db, organizationId, { fresh: true }),
    cf.entryCounts(db, organizationId),
    classesOf(db, organizationId),
    require("../utils/guardianMessaging").getMessagingChannelStatus(db, organizationId).catch(() => ({})),
  ]);
  res.render("common/customForms", {
    title: "Custom editor",
    isEmbedded: true,
    hideGlobalHeader: true,
    hideGlobalFooter: true,
    hideGlobalChatbot: true,
    boot: {
      sections: sections.map((section) => ({ ...section, entries: (counts.get(section.id) || {}).entries || 0 })),
      classes,
      // Text and WhatsApp are offered only while the school has them switched on.
      channels: { sms: Boolean(channels.sms && channels.sms.ready), whatsapp: Boolean(channels.whatsapp && channels.whatsapp.ready) },
      types: Object.entries(cf.FIELD_TYPES).map(([key, value]) => ({ key, label: value.label, options: Boolean(value.options), input: value.input !== false })),
      icons: cf.ICONS,
      answerIcons: cf.ANSWER_ICONS,
    },
  });
}

async function saveSectionApi(req, res, db) {
  if (!(await available(db, req))) return notAvailable(req, res, db);
  try {
    const organizationId = orgOf(req);
    const saved = await cf.saveSection(db, organizationId, req.body || {}, resolveActor(req).id);
    if (!saved) return fail(res, 404, "That section no longer exists.");
    if (saved.error) return fail(res, 400, saved.error);
    let announced = 0;
    if (saved.wentLive && saved.section.filledBy === "parent") {
      announced = await cf.announce(db, { organizationId, section: saved.section, siteUrl: siteUrl(req) }).catch((error) => {
        console.error("[Custom forms] announce:", error.message);
        return 0;
      });
    }
    const counts = await cf.entryCounts(db, organizationId);
    return res.json({ success: true, section: { ...saved.section, entries: (counts.get(saved.section.id) || {}).entries || 0 }, announced });
  } catch (error) {
    console.error("[Custom forms] save:", error.message);
    return fail(res, 500, "The section could not be saved. Try again.");
  }
}

async function deleteSectionApi(req, res, db) {
  if (!(await available(db, req))) return notAvailable(req, res, db);
  const removed = await cf.deleteSection(db, orgOf(req), toId(req.params.id));
  return removed ? res.json({ success: true }) : fail(res, 404, "That section no longer exists.");
}

async function orderApi(req, res, db) {
  if (!(await available(db, req))) return notAvailable(req, res, db);
  await cf.saveOrder(db, orgOf(req), req.body && req.body.ids);
  return res.json({ success: true });
}

// ── Filling in (classroom, driver portal, the editor's Responses) ───────────────────────
// The sections this person fills in or reads, for the classroom (?classId=) or the driver portal.
async function dataApi(req, res, db) {
  if (!(await available(db, req))) return notAvailable(req, res, db);
  const classId = toId(req.query.classId);
  // A driver's riders are looked up only when a form asks for them.
  const reach = isDriver(req) ? { driver: true, builder: false } : await reachOf(db, req, res);
  let sections = cf.sectionsForStaff(await cf.listSections(db, orgOf(req)), reach);
  if (classId) {
    if (!reach.all && !reach.classes.has(classId)) return fail(res, 403, "You can only open forms for your classes.");
    sections = sections.filter((section) => cf.inSection(section, classId));
  }
  return res.json({
    success: true,
    builder: reach.builder,
    driver: Boolean(reach.driver),
    sections: sections.map((section) => ({
      id: section.id, name: section.name, icon: section.icon, tile: cf.ownTile(section, reach.driver ? "driver" : "staff"), filledBy: section.filledBy, multiple: section.multiple, once: section.once, repeat: section.repeat,
      required: section.required, dueDate: section.dueDate, status: section.status, classIds: section.classIds,
      // A section's fields come with its students, so this list stays small however many there are.
      canEdit: canEditFor({ section, reach, builder: reach.builder }),
    })),
  });
}

// A link from a notification: to the classroom's Forms tab, the driver portal or the editor.
async function goPage(req, res, db) {
  if (!(await available(db, req))) return notAvailable(req, res, db);
  const sectionId = toId(req.query.section);
  const studentId = toId(req.query.student);
  if (isDriver(req)) return res.redirect("/driver/dashboard#forms");
  const reach = await reachOf(db, req, res);
  const section = sectionId ? await cf.getSection(db, orgOf(req), sectionId) : null;
  const student = studentId ? await cf.studentInfo(db, orgOf(req), studentId) : null;
  const query = `section=${sectionId || ""}${studentId ? `&student=${studentId}` : ""}`;
  if (section && student && student.classId && !reach.builder && inReach(reach, student) && cf.sectionsForStaff([section], reach).length) {
    return res.redirect(`/common/classDashboard/${student.classId}/forms?${query}`);
  }
  if (reach.builder) return res.redirect(`/common/management?panel=custom-forms&page=${encodeURIComponent(`/common/custom-forms?${query}&responses=1`)}`);
  if (student && student.classId && inReach(reach, student)) return res.redirect(`/common/classDashboard/${student.classId}/forms?${query}`);
  return res.redirect("/common/orgDashboard");
}

// /common/forms has no page: the Custom editor (Management) or the classroom has it.
async function staffPage(req, res, db) {
  const query = req.originalUrl.includes("?") ? req.originalUrl.slice(req.originalUrl.indexOf("?") + 1) : "";
  return res.redirect(`/common/custom-forms/go${query ? `?${query}` : ""}`);
}

async function studentsApi(req, res, db) {
  if (!(await available(db, req))) return notAvailable(req, res, db);
  try {
    const context = await staffContext(db, req, res);
    if (context.error) return fail(res, ...context.error);
    const students = await cf.studentsFor(db, orgOf(req), context.section, {
      reachClasses: context.reach.all || context.reach.students ? null : context.reach.classes,
      studentIds: context.reach.students || null,
      classId: toId(req.query.classId),
      period: await periodOf(db, req),
    });
    // Photos for the seating chart, small and ready to show.
    students.forEach((student) => { if (student.photo) student.photo = res.locals.publicImageUrl(student.photo, { width: 96 }); });
    return res.json({
      success: true, students,
      fields: context.section.fields.filter((field) => !field.retired).map(({ notes, ...field }) => field),
      // The fields that can be answered with a tap, straight in the list (none when it isn't that kind of section).
      quick: cf.quickFields(context.section).map((field) => field.id),
    });
  } catch (error) {
    console.error("[Custom forms] students:", error.message);
    return fail(res, 500, "The list could not load. Try again.");
  }
}

async function entriesApi(req, res, db) {
  if (!(await available(db, req))) return notAvailable(req, res, db);
  const context = await staffContext(db, req, res, { studentId: toId(req.params.studentId) });
  if (context.error) return fail(res, ...context.error);
  const { entries, previous } = await cf.entriesFor(db, orgOf(req), context.section, context.student.id, await periodOf(db, req));
  const paper = paperFor(context);
  return res.json({
    success: true,
    student: { id: context.student.id, name: context.student.name, className: context.student.className },
    entries,
    // Last term's or year's answers, to start this one from.
    previous,
    // What families, students or drivers sent is theirs (builders may correct it). Staff may
    // enter a form handed in on paper. A locked section can't be changed once it's in.
    canEdit: canEditFor(context) || (paper && entries.every((entry) => entry.savedByType === "staff")),
    paper,
    locked: Boolean(context.section.once && entries.length && !context.builder),
  });
}

async function saveEntryApi(req, res, db) {
  if (!(await available(db, req))) return notAvailable(req, res, db);
  try {
    const context = await staffContext(db, req, res, { studentId: toId(req.params.studentId) });
    if (context.error) return fail(res, ...context.error);
    const paper = paperFor(context);
    if (!canEditFor(context) && !paper) return fail(res, 403, "Someone else fills this one in.");
    const organizationId = orgOf(req);
    const saver = staffSaver(req);
    const result = await cf.saveEntry(db, {
      organizationId, section: context.section, studentId: context.student.id, entryId: toId(req.body.entryId), payload: req.body.values || {}, saver,
      override: context.builder, paperOnly: paper, period: await periodOf(db, req),
      // Answers tapped straight into the list, the seating chart or the attendance page.
      partial: req.body.quick === true && cf.quickFields(context.section).length > 0,
    });
    if (result.errors) return fail(res, 400, result.errors[0].message, { errors: result.errors });
    if (result.error) return fail(res, result.status || 400, result.error);
    if (result.entry) {
      await cf.afterSave(db, { organizationId, section: context.section, student: context.student, saver })
        .catch((error) => console.error("[Custom forms] notice:", error.message));
    }
    return res.json({ success: true, entry: result.entry });
  } catch (error) {
    console.error("[Custom forms] save entry:", error.message);
    return fail(res, 500, "It could not be saved. Try again.");
  }
}

async function deleteEntryApi(req, res, db) {
  if (!(await available(db, req))) return notAvailable(req, res, db);
  const context = await staffContext(db, req, res);
  if (context.error) return fail(res, ...context.error);
  const entryId = toId(req.params.entryId);
  const { rows } = await db.query(
    "SELECT student_id, saved_by_type, saved_by_id FROM custom_section_entries WHERE organization_id = $1 AND section_id = $2 AND entry_id = $3",
    [orgOf(req), context.section.id, entryId]
  );
  const entry = rows[0];
  if (!entry) return fail(res, 404, "That entry no longer exists.");
  const student = await cf.studentInfo(db, orgOf(req), Number(entry.student_id));
  if (!inReach(context.reach, student)) return fail(res, 404, "That entry no longer exists.");
  const own = ["staff", "driver"].includes(entry.saved_by_type) && Number(entry.saved_by_id) === Number(resolveActor(req).id) && !context.section.once;
  if (!context.builder && !own) return fail(res, 403, "Only the person who saved it, or someone who builds forms, can delete it.");
  await cf.deleteEntry(db, orgOf(req), context.section.id, entryId);
  return res.json({ success: true });
}

// Answers › Download: every answer in reach as a spreadsheet (CSV opens in Excel and Sheets).
async function exportApi(req, res, db) {
  if (!(await available(db, req))) return notAvailable(req, res, db);
  const context = await staffContext(db, req, res);
  if (context.error) return fail(res, ...context.error);
  const rows = await cf.exportRows(db, orgOf(req), context.section, {
    reachClasses: context.reach.all || context.reach.students ? null : context.reach.classes,
    studentIds: context.reach.students || null,
    period: await periodOf(db, req),
  });
  // Quoted, and a cell starting like a formula is made plain text so a spreadsheet never runs it.
  const cell = (value) => {
    let text = String(value == null ? "" : value);
    if (/^[=+\-@\t\r]/.test(text)) text = `'${text}`;
    return `"${text.replace(/"/g, '""')}"`;
  };
  const csv = "\ufeff" + rows.map((row) => row.map(cell).join(",")).join("\r\n");
  const name = String(context.section.name || "answers").replace(/[^\w -]+/g, "").trim().replace(/\s+/g, "-").slice(0, 60) || "answers";
  res.setHeader("Content-Type", "text/csv; charset=utf-8");
  res.setHeader("Content-Disposition", `attachment; filename="${name}.csv"`);
  res.setHeader("Cache-Control", "no-store");
  return res.send(csv);
}

// Answers › Send a reminder: the families who haven't filled in a parent form hear now.
async function remindApi(req, res, db) {
  if (!(await available(db, req))) return notAvailable(req, res, db);
  const context = await staffContext(db, req, res);
  if (context.error) return fail(res, ...context.error);
  if (context.section.filledBy !== "parent") return fail(res, 400, "Reminders go to families, for forms parents fill in.");
  if (context.section.status !== "live") return fail(res, 400, "Make the section live first.");
  const sent = await cf.remindMissing(db, {
    organizationId: orgOf(req), section: context.section, siteUrl: siteUrl(req), email: true,
    reachClasses: context.reach.all ? null : context.reach.classes, period: await periodOf(db, req),
  });
  return res.json({ success: true, sent });
}

async function staffUpload(req, res, db) {
  if (!(await available(db, req))) return notAvailable(req, res, db);
  const context = await staffContext(db, req, res);
  if (context.error) return fail(res, ...context.error);
  if (!canEditFor(context) || !context.section.fields.some((field) => field.type === "file")) return fail(res, 400, "This form has no file field you can fill in.");
  return storeFile(req, res);
}

// ── Parents and students ────────────────────────────────────────────────────────────────
async function guardianChild(db, req) {
  const { guardianHasStudentAccess } = require("./guardianController");
  const studentId = toId(req.query.studentId);
  if (!studentId || !(await guardianHasStudentAccess(db, req.session.guardianId, orgOf(req), studentId))) return null;
  return cf.studentInfo(db, orgOf(req), studentId);
}

const portalSaver = (req, audience) => {
  const name = [req.session.firstName, req.session.lastName].filter(Boolean).join(" ").trim();
  return audience === "parent"
    ? { type: "parent", id: Number(req.session.guardianId) || null, name: name || "Parent" }
    : { type: "student", id: Number(req.session.studentId) || null, name: name || "Student" };
};

async function portalSave(req, res, db, student, audience) {
  const organizationId = orgOf(req);
  const section = await cf.getSection(db, organizationId, toId(req.params.sectionId));
  if (!section || section.status !== "live" || section.filledBy !== audience || !cf.inSection(section, student.classId)) {
    return fail(res, 404, "That form isn't open.");
  }
  const saver = portalSaver(req, audience);
  const result = await cf.saveEntry(db, {
    organizationId, section, studentId: student.id, entryId: toId(req.body.entryId), payload: req.body.values || {}, saver,
    period: { ...(await cf.currentPeriod(db, organizationId)), day: todayKeyFor(req) },
  });
  if (result.errors) return fail(res, 400, result.errors[0].message, { errors: result.errors });
  if (result.error) return fail(res, result.status || 400, result.error);
  await cf.afterSave(db, { organizationId, section, student, saver })
    .catch((error) => console.error("[Custom forms] notice:", error.message));
  return res.json({ success: true, entry: result.entry });
}

async function portalUpload(req, res, db, student, audience) {
  const section = await cf.getSection(db, orgOf(req), toId(req.params.sectionId));
  if (!section || section.status !== "live" || section.filledBy !== audience || !cf.inSection(section, student.classId)
    || !section.fields.some((field) => field.type === "file" && !field.retired)) {
    return fail(res, 404, "That form isn't open.");
  }
  return storeFile(req, res);
}

// A forms page: one form opened from its own tile (?form=12), or everything under "Forms".
function onePage(all, req) {
  const only = toId(req.query.form);
  if (!only) return { title: "Forms", forms: all.filter((form) => !form.tile), single: false };
  const forms = all.filter((form) => form.id === only);
  return { title: forms[0] ? forms[0].name : "Forms", forms, single: true };
}

async function guardianPage(req, res, db) {
  if (!(await available(db, req))) return res.redirect("/guardian/dashboard");
  const child = await guardianChild(db, req);
  if (!child) {
    req.flash("error", "You do not have access to that student.");
    return res.redirect("/guardian/dashboard");
  }
  const page = onePage(await cf.portalForms(db, orgOf(req), child, "parent", { day: todayKeyFor(req) }), req);
  res.render("guardian/childForms", { ...page, child, base: `/guardian/child/forms`, query: `?studentId=${child.id}` });
}

async function guardianSave(req, res, db) {
  if (!(await available(db, req))) return fail(res, 404, "Forms aren't available.");
  const child = await guardianChild(db, req);
  if (!child) return fail(res, 403, "You do not have access to that student.");
  try {
    return await portalSave(req, res, db, child, "parent");
  } catch (error) {
    console.error("[Custom forms] parent save:", error.message);
    return fail(res, 500, "It could not be sent. Try again.");
  }
}

async function guardianUpload(req, res, db) {
  if (!(await available(db, req))) return fail(res, 404, "Forms aren't available.");
  const child = await guardianChild(db, req);
  if (!child) return fail(res, 403, "You do not have access to that student.");
  return portalUpload(req, res, db, child, "parent");
}

async function studentSelf(db, req) {
  return cf.studentInfo(db, orgOf(req), Number(req.session.studentId));
}

async function studentPage(req, res, db) {
  if (!(await available(db, req))) return res.redirect("/student/dashboard");
  const student = await studentSelf(db, req);
  const page = onePage(student ? await cf.portalForms(db, orgOf(req), student, "student", { day: todayKeyFor(req) }) : [], req);
  res.render("student/forms", { ...page, child: student, base: "/student/forms", query: "" });
}

async function studentSave(req, res, db) {
  if (!(await available(db, req))) return fail(res, 404, "Forms aren't available.");
  const student = await studentSelf(db, req);
  if (!student) return fail(res, 403, "Sign in again.");
  try {
    return await portalSave(req, res, db, student, "student");
  } catch (error) {
    console.error("[Custom forms] student save:", error.message);
    return fail(res, 500, "It could not be sent. Try again.");
  }
}

async function studentUpload(req, res, db) {
  if (!(await available(db, req))) return fail(res, 404, "Forms aren't available.");
  const student = await studentSelf(db, req);
  if (!student) return fail(res, 403, "Sign in again.");
  return portalUpload(req, res, db, student, "student");
}

// How many forms a family still has to fill in for this child (the parent hub's tile).
// For the child's tiles: how many forms under "Forms" are waiting, the same for each form with a
// tile of its own ("form-12": 1), and the tiles to take away (a locked form already sent).
async function guardianToDo(db, req, child) {
  const none = { forms: 0, tiles: {}, gone: [] };
  if (!(await available(db, req)) || !child) return none;
  const live = await cf.liveFor(db, orgOf(req), "parent");
  if (!live.some((section) => section.filledBy === "parent")) return none;
  const forms = await cf.portalForms(db, orgOf(req), child, "parent", { day: todayKeyFor(req) });
  const here = new Set(forms.map((form) => form.id));
  return {
    forms: forms.filter((form) => form.todo && !form.tile).length,
    tiles: Object.fromEntries(forms.filter((form) => form.tile && form.todo).map((form) => [`form-${form.id}`, 1])),
    gone: live.filter((section) => cf.ownTile(section, "parent") && !here.has(section.id)).map((section) => section.id),
  };
}

const wrap = (handler) => async (req, res, db) => {
  try {
    return await handler(req, res, db);
  } catch (error) {
    console.error("[Custom forms]", error.message);
    if (req.accepts(["html", "json"]) === "json" || req.xhr || req.method !== "GET") return fail(res, 500, "Something went wrong. Try again.");
    req.flash("error", "That page could not load. Try again.");
    return res.redirect("back");
  }
};

module.exports = {
  editorPage: wrap(editorPage),
  saveSection: wrap(saveSectionApi),
  deleteSection: wrap(deleteSectionApi),
  order: wrap(orderApi),
  data: wrap(dataApi),
  exportCsv: wrap(exportApi),
  remind: wrap(remindApi),
  go: wrap(goPage),
  staffPage: wrap(staffPage),
  students: wrap(studentsApi),
  entries: wrap(entriesApi),
  saveEntry: wrap(saveEntryApi),
  deleteEntry: wrap(deleteEntryApi),
  staffUpload: wrap(staffUpload),
  guardianPage: wrap(guardianPage),
  guardianSave: wrap(guardianSave),
  guardianUpload: wrap(guardianUpload),
  studentPage: wrap(studentPage),
  studentSave: wrap(studentSave),
  studentUpload: wrap(studentUpload),
  guardianToDo,
};
