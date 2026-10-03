// Admin > Announcements > Request Feedback: create, send, track and export
// feedback requests (see utils/platformNotices.js for the rules).
const db = require("../config/db");
const notices = require("../utils/platformNotices");

const STATE_LABELS = { draft: "Draft", scheduled: "Scheduled", active: "Active", closed: "Closed" };

function audienceSummary(request, orgNames) {
  const roles = request.roles.map((r) => notices.ROLE_LABELS[r] || r).join(", ");
  const schools = request.all_organizations
    ? "all schools"
    : request.organization_ids.length === 1
      ? orgNames.get(request.organization_ids[0]) || "1 school"
      : `${request.organization_ids.length} schools`;
  return `${roles} - ${schools}`;
}

function frequencyLabel(request) {
  if (request.frequency === "custom") return `Every ${request.custom_days} days`;
  return notices.FREQUENCY_LABELS[request.frequency] || "Once";
}

// Rows for the Announcements page table.
async function listFeedbackRequests() {
  await notices.ensureNoticesSchema(db);
  const [requests, orgs] = await Promise.all([
    db.query(`SELECT * FROM feedback_requests ORDER BY created_at DESC`),
    notices.activeOrganizations(db),
  ]);
  if (!requests.rows.length) return [];
  const orgNames = new Map(orgs.map((o) => [o.organization_id, o.organization_name]));
  const stats = new Map((await db.query(
    `SELECT request_id, period_key, COUNT(*)::int AS n, AVG(rating)::numeric(3,2) AS avg
     FROM feedback_responses GROUP BY request_id, period_key`
  )).rows.map((r) => [`${r.request_id}:${r.period_key}`, r]));
  const totals = new Map((await db.query(
    `SELECT request_id, COUNT(*)::int AS n, AVG(rating)::numeric(3,2) AS avg FROM feedback_responses GROUP BY request_id`
  )).rows.map((r) => [r.request_id, r]));
  const rows = [];
  for (const request of requests.rows) {
    const members = await notices.audienceMembers(db, { roles: request.roles, allOrganizations: request.all_organizations, organizationIds: request.organization_ids });
    const period = notices.periodKey(request);
    const current = stats.get(`${request.id}:${period}`);
    const total = totals.get(request.id);
    rows.push({
      id: request.id,
      title: request.title,
      audience: audienceSummary(request, orgNames),
      frequency: frequencyLabel(request),
      recipients: members.length,
      responses: current ? current.n : 0,
      totalResponses: total ? total.n : 0,
      averageRating: total && total.avg !== null ? Number(total.avg) : null,
      state: notices.requestState(request),
      stateLabel: STATE_LABELS[notices.requestState(request)],
      anonymous: request.anonymous,
      createdAt: request.created_at,
    });
  }
  return rows;
}

function toInputDate(value) {
  if (!value) return "";
  const d = new Date(value);
  const pad = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

module.exports = {
  listFeedbackRequests,

  // GET /admin/feedback-requests/new and /admin/feedback-requests/:id/edit
  formPage: async (req, res) => {
    try {
      await notices.ensureNoticesSchema(db);
      const isEmbedded = req.query.embed === "workspace";
      let request = null;
      if (req.params.id) {
        request = (await db.query(`SELECT * FROM feedback_requests WHERE id = $1`, [req.params.id])).rows[0] || null;
        if (!request) {
          req.flash("error", "That feedback request no longer exists.");
          return res.redirect("/admin/announcements");
        }
      }
      return res.render("admin/feedbackRequestForm", {
        title: request ? "Edit Feedback Request" : "Request Feedback",
        isEmbedded,
        hideGlobalHeader: isEmbedded,
        hideGlobalFooter: isEmbedded,
        hideGlobalChatbot: isEmbedded,
        organizations: await notices.activeOrganizations(db),
        request: request ? { ...request, startsAt: toInputDate(request.starts_at), endsAt: toInputDate(request.ends_at), hasResponses: Number((await db.query(`SELECT COUNT(*)::int AS n FROM feedback_responses WHERE request_id = $1`, [request.id])).rows[0].n) > 0 } : null,
        roleLabels: notices.ROLE_LABELS,
        messages: req.flash(),
      });
    } catch (error) {
      console.error("[feedbackRequests/form]", error);
      req.flash("error", "Could not open the feedback request.");
      return res.redirect("/admin/announcements");
    }
  },

  // GET /admin/feedback-requests/estimate?roles=a,b&organizationIds=1,2&allOrganizations=1
  estimate: async (req, res) => {
    try {
      const split = (v) => String(v || "").split(",").map((x) => x.trim()).filter(Boolean);
      const roles = split(req.query.roles).filter((r) => notices.ROLE_KEYS.includes(r));
      const members = await notices.audienceMembers(db, {
        roles,
        allOrganizations: req.query.allOrganizations === "1",
        organizationIds: split(req.query.organizationIds).map(Number).filter(Boolean),
      });
      const byRole = {};
      members.forEach((m) => { byRole[m.role] = (byRole[m.role] || 0) + 1; });
      return res.json({ success: true, total: members.length, byRole, schools: new Set(members.map((m) => m.orgId)).size });
    } catch (error) {
      console.error("[feedbackRequests/estimate]", error);
      return res.status(500).json({ success: false, message: "Could not count recipients." });
    }
  },

  // POST /admin/feedback-requests and /admin/feedback-requests/:id  (JSON, action: draft | send)
  save: async (req, res) => {
    try {
      await notices.ensureNoticesSchema(db);
      const { data, errors } = notices.normalizeRequestInput(req.body || {});
      if (errors.length) return res.status(400).json({ success: false, message: errors[0], errors });
      const status = req.body?.action === "send" ? "active" : "draft";
      const values = [
        data.title, data.description || null, data.question, data.commentMode, data.commentPrompt, data.anonymous, data.allowEdit,
        data.requireResponse, data.roles, data.allOrganizations, data.organizationIds, data.frequency, data.customDays,
        data.startsAt, data.endsAt, status, data.notify,
      ];
      let id = Number(req.params.id) || null;
      if (id) {
        const existing = (await db.query(`SELECT id, anonymous, (SELECT COUNT(*)::int FROM feedback_responses WHERE request_id = $1) AS answers FROM feedback_requests WHERE id = $1`, [id])).rows[0];
        if (!existing) return res.status(404).json({ success: false, message: "That feedback request no longer exists." });
        if (existing.answers > 0 && existing.anonymous !== data.anonymous) {
          return res.status(400).json({ success: false, message: "People have already answered, so anonymity can't be changed now." });
        }
        await db.query(
          `UPDATE feedback_requests SET title=$1, description=$2, question=$3, comment_mode=$4, comment_prompt=$5, anonymous=$6, allow_edit=$7,
             require_response=$8, roles=$9, all_organizations=$10, organization_ids=$11, frequency=$12, custom_days=$13,
             starts_at=$14, ends_at=$15, status=$16, notify=$17, updated_at=now()
           WHERE id=$18`,
          [...values, id]
        );
      } else {
        id = (await db.query(
          `INSERT INTO feedback_requests (title, description, question, comment_mode, comment_prompt, anonymous, allow_edit,
             require_response, roles, all_organizations, organization_ids, frequency, custom_days, starts_at, ends_at, status, notify, created_by)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18) RETURNING id`,
          [...values, req.session.userId || null]
        )).rows[0].id;
      }
      let notified = 0;
      if (status === "active") notified = await notices.sendDueFeedbackNotifications(db);
      const scheduled = status === "active" && data.startsAt > new Date();
      return res.json({
        success: true,
        id,
        notified,
        message: status === "draft" ? "Saved as a draft." : scheduled ? "Scheduled - it opens on the start date." : "Sent. People will be asked the next time they open Managira.",
        redirect: `/admin/feedback-requests/${id}`,
      });
    } catch (error) {
      console.error("[feedbackRequests/save]", error);
      return res.status(500).json({ success: false, message: "Could not save the feedback request." });
    }
  },

  // POST /admin/feedback-requests/:id/status  { status: active | closed | draft }
  setStatus: async (req, res) => {
    try {
      const status = String(req.body?.status || "");
      if (!["active", "closed", "draft"].includes(status)) return res.status(400).json({ success: false, message: "Unknown status." });
      const result = await db.query(`UPDATE feedback_requests SET status = $1, updated_at = now() WHERE id = $2`, [status, Number(req.params.id)]);
      if (!result.rowCount) return res.status(404).json({ success: false, message: "Not found." });
      if (status === "active") await notices.sendDueFeedbackNotifications(db);
      return res.json({ success: true });
    } catch (error) {
      console.error("[feedbackRequests/status]", error);
      return res.status(500).json({ success: false, message: "Could not update the request." });
    }
  },

  // POST /admin/feedback-requests/:id/delete
  remove: async (req, res) => {
    try {
      await db.query(`DELETE FROM feedback_requests WHERE id = $1`, [Number(req.params.id)]);
      return res.json({ success: true });
    } catch (error) {
      console.error("[feedbackRequests/delete]", error);
      return res.status(500).json({ success: false, message: "Could not delete the request." });
    }
  },

  // GET /admin/feedback-requests/:id  (results)
  resultsPage: async (req, res) => {
    try {
      await notices.ensureNoticesSchema(db);
      const request = (await db.query(`SELECT * FROM feedback_requests WHERE id = $1`, [req.params.id])).rows[0];
      if (!request) {
        req.flash("error", "That feedback request no longer exists.");
        return res.redirect("/admin/announcements");
      }
      const orgs = await notices.activeOrganizations(db);
      const orgNames = new Map(orgs.map((o) => [o.organization_id, o.organization_name]));
      const currentPeriod = notices.periodKey(request);
      const periodParam = req.query.period === "all" ? "all" : String(currentPeriod);
      const period = periodParam === "all" ? null : Number(periodParam);
      const where = `request_id = $1 AND ($2::int IS NULL OR period_key = $2)`;
      const [summary, distribution, byRole, bySchool, comments, periods, members] = await Promise.all([
        db.query(`SELECT COUNT(*)::int AS n, AVG(rating)::numeric(3,2) AS avg FROM feedback_responses WHERE ${where}`, [request.id, period]),
        db.query(`SELECT rating, COUNT(*)::int AS n FROM feedback_responses WHERE ${where} GROUP BY rating`, [request.id, period]),
        db.query(`SELECT role, COUNT(*)::int AS n, AVG(rating)::numeric(3,2) AS avg FROM feedback_responses WHERE ${where} GROUP BY role ORDER BY n DESC`, [request.id, period]),
        db.query(`SELECT organization_id, COUNT(*)::int AS n, AVG(rating)::numeric(3,2) AS avg FROM feedback_responses WHERE ${where} GROUP BY organization_id ORDER BY n DESC`, [request.id, period]),
        db.query(`SELECT rating, comment, role, organization_id, respondent_name, respondent_email, created_at, updated_at, period_key
                  FROM feedback_responses WHERE ${where} ORDER BY created_at DESC LIMIT 300`, [request.id, period]),
        db.query(`SELECT DISTINCT period_key FROM feedback_responses WHERE request_id = $1 ORDER BY period_key DESC`, [request.id]),
        notices.audienceMembers(db, { roles: request.roles, allOrganizations: request.all_organizations, organizationIds: request.organization_ids }),
      ]);
      const counts = [5, 4, 3, 2, 1].map((stars) => ({ stars, n: distribution.rows.find((r) => r.rating === stars)?.n || 0 }));
      const total = summary.rows[0].n;
      const state = notices.requestState(request);
      return res.render("admin/feedbackRequestResults", {
        title: `Feedback: ${request.title}`,
        request,
        state,
        stateLabel: STATE_LABELS[state],
        audience: audienceSummary(request, orgNames),
        frequency: frequencyLabel(request),
        currentPeriod,
        periodParam,
        periods: [...new Set([currentPeriod, ...periods.rows.map((r) => r.period_key)])].sort((a, b) => b - a),
        nextPeriodStart: notices.nextPeriodStart(request),
        recipients: members.length,
        total,
        average: summary.rows[0].avg !== null ? Number(summary.rows[0].avg) : null,
        counts,
        byRole: byRole.rows.map((r) => ({ label: notices.ROLE_LABELS[r.role] || r.role, n: r.n, avg: Number(r.avg) })),
        bySchool: bySchool.rows.map((r) => ({ label: orgNames.get(r.organization_id) || `School #${r.organization_id}`, n: r.n, avg: Number(r.avg) })),
        comments: comments.rows.map((r) => ({
          ...r,
          roleLabel: notices.ROLE_LABELS[r.role] || r.role,
          school: orgNames.get(r.organization_id) || "",
        })),
        messages: req.flash(),
      });
    } catch (error) {
      console.error("[feedbackRequests/results]", error);
      req.flash("error", "Could not load the feedback results.");
      return res.redirect("/admin/announcements");
    }
  },

  // GET /admin/feedback-requests/:id/export.csv?period=all|<n>
  exportCsv: async (req, res) => {
    try {
      const request = (await db.query(`SELECT * FROM feedback_requests WHERE id = $1`, [req.params.id])).rows[0];
      if (!request) return res.status(404).send("Not found");
      const orgNames = new Map((await notices.activeOrganizations(db)).map((o) => [o.organization_id, o.organization_name]));
      const period = req.query.period === "all" || req.query.period === undefined ? null : Number(req.query.period);
      const rows = (await db.query(
        `SELECT created_at, updated_at, period_key, rating, comment, role, organization_id, respondent_name, respondent_email
         FROM feedback_responses WHERE request_id = $1 AND ($2::int IS NULL OR period_key = $2) ORDER BY created_at ASC`,
        [request.id, Number.isInteger(period) ? period : null]
      )).rows;
      const cell = (v) => {
        const text = String(v == null ? "" : v);
        const safe = /^[=+\-@]/.test(text) ? `'${text}` : text; // keep spreadsheet formulas out
        return /[",\n]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
      };
      const header = ["Submitted", "Period", "Rating", "Comment", "Role", "School", ...(request.anonymous ? [] : ["Name", "Email"])];
      const lines = [header.join(",")].concat(rows.map((r) => [
        new Date(r.updated_at || r.created_at).toISOString().replace("T", " ").slice(0, 16),
        r.period_key + 1,
        r.rating,
        r.comment || "",
        notices.ROLE_LABELS[r.role] || r.role,
        orgNames.get(r.organization_id) || "",
        ...(request.anonymous ? [] : [r.respondent_name || "", r.respondent_email || ""]),
      ].map(cell).join(",")));
      const fileName = `feedback-${request.title.replace(/[^a-z0-9]+/gi, "-").toLowerCase().replace(/^-|-$/g, "") || request.id}.csv`;
      res.setHeader("Content-Type", "text/csv; charset=utf-8");
      res.setHeader("Content-Disposition", `attachment; filename="${fileName}"`);
      return res.send("﻿" + lines.join("\n"));
    } catch (error) {
      console.error("[feedbackRequests/export]", error);
      return res.status(500).send("Could not export.");
    }
  },
};
