"use strict";

// Requests in the parent and student portals (feature portal_requests): what the school asks them
// to fill in. New = a Custom editor form they fill in that still has no answer this period (the
// same rule as the Forms page, customForms.portalForms); Old = forms they've sent, newest first.
// Bus requests the family made are listed beside them in the page (busRequests, /transportation).
// Every link opens the form on the family's or student's own Forms page, which checks again.

const cf = require("./customForms");

const FEATURE = "portal_requests";
const OLD_LIMIT = 60;
const isOn = (organizationId) => require("./shards/features").isOn(FEATURE, { organizationId: Number(organizationId) });
const formsAvailable = async (db, organizationId) => cf.featureOn(organizationId) && (await cf.ready(db));

// people: [{ id, name, firstName, classId }]. audience: "parent" or "student".
async function forms(db, organizationId, people, audience, { bucket = "new", day = null, linkFor }) {
  const kids = (people || []).filter((p) => p && p.id && p.classId);
  if (!kids.length || !(await formsAvailable(db, organizationId))) return [];
  if (bucket === "new") {
    const lists = await Promise.all(kids.map((child) => cf.portalForms(db, organizationId, child, audience, { day }).then((list) => ({ child, list }))));
    const out = [];
    lists.forEach(({ child, list }) => list.forEach((form) => {
      if (!form.fillsIn || !form.todo) return;
      out.push({
        kind: "form", key: `form-${form.id}-${child.id}`, formId: form.id, studentId: child.id, studentName: child.name,
        title: form.name, icon: form.icon || null, required: Boolean(form.required), dueDate: form.dueDate || null,
        repeat: form.repeat || null, href: linkFor(child, form.id), status: "new",
      });
    }));
    // Due soonest first; required before optional; then by name.
    return out.sort((a, b) => String(a.dueDate || "9999").localeCompare(String(b.dueDate || "9999")) || Number(b.required) - Number(a.required) || a.title.localeCompare(b.title));
  }
  // Old: what this audience sent, newest first (only sections it fills in).
  const sections = (await cf.listSections(db, organizationId)).filter((section) => section.filledBy === audience);
  if (!sections.length) return [];
  const byId = new Map(sections.map((section) => [section.id, section]));
  const childById = new Map(kids.map((child) => [Number(child.id), child]));
  const { rows } = await db.query(
    `SELECT DISTINCT ON (section_id, student_id) entry_id, section_id, student_id, saved_by_name, updated_at
       FROM custom_section_entries
      WHERE organization_id = $1 AND student_id = ANY($2::int[]) AND section_id = ANY($3::int[]) AND saved_by_type = $4
      ORDER BY section_id, student_id, updated_at DESC`,
    [organizationId, kids.map((child) => child.id), sections.map((section) => section.id), audience]
  );
  return rows
    .sort((a, b) => new Date(b.updated_at) - new Date(a.updated_at))
    .slice(0, OLD_LIMIT)
    .map((row) => {
      const section = byId.get(Number(row.section_id));
      const child = childById.get(Number(row.student_id));
      const live = section.status === "live" && cf.inSection(section, child.classId);
      return {
        kind: "form", key: `form-${section.id}-${child.id}`, formId: section.id, studentId: child.id, studentName: child.name,
        title: section.name, icon: section.icon || null, sentAt: row.updated_at, sentBy: row.saved_by_name || "",
        href: live ? linkFor(child, section.id) : null, status: "sent",
      };
    });
}

// A parent's children in this school (guardian_students), with their class.
async function childrenOfGuardian(db, organizationId, guardianId) {
  const { rows } = await db.query(
    `SELECT s.student_id, s.first_name, s.last_name, s.class_id
       FROM guardian_students gs
       JOIN students s ON s.student_id = gs.student_id AND s.organization_id = $1
      WHERE gs.guardian_id = $2 AND COALESCE(s.graduated, FALSE) = FALSE
      ORDER BY LOWER(s.first_name), s.student_id`,
    [organizationId, guardianId]
  );
  return rows.map((row) => ({
    id: Number(row.student_id),
    firstName: row.first_name || "",
    name: [row.first_name, row.last_name].filter(Boolean).join(" ").trim() || "Your child",
    classId: row.class_id ? Number(row.class_id) : null,
  }));
}

module.exports = { FEATURE, isOn, forms, childrenOfGuardian, formsAvailable };
