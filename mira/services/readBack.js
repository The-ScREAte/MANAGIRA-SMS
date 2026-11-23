// After a confirmed change runs, Managira looks the record up again before Mira reports it
// (enforced in code, never left to the model): an event that was created must be on the events
// list, a deleted class must be gone. Each change gets a verdict:
//   confirmed    the record shows the change
//   missing      the change said it worked, but the record doesn't show it
//   not_checked  no read-back for this tool (or the lookup itself couldn't run); the tool's own
//                success is all there is
// The orchestrator says "done" only for confirmed (and not_checked) changes, and lists exactly
// what isn't done when any change failed or is missing.
//
// Read-backs exist for the changes Mira makes most (local copy's mira_tool_call_log, 2026-11-22):
// create_event, delete_event, create_activity, delete_class, create_classes; and (2026-11-23) for
// the riskiest: send_message, post_or_send_report_cards, set_enrollment_roster,
// update_website_section, create_students, create_subject, delete_subject, delete_test,
// create_school_announcement, delete_school_announcement, delete_document.
// Not read back: remind_form_outstanding (reminders leave no record any read tool shows) and
// the other change tools - their own success is all there is (not_checked).

const same = (a, b) => String(a || "").trim().toLowerCase() === String(b || "").trim().toLowerCase();
const day = (value) => String(value || "").slice(0, 10);
const words = (text) => String(text || "").replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim().toLowerCase();
const fullName = (s) => words([s.first_name || s.firstName, s.last_name || s.lastName].filter(Boolean).join(" ") || s.name || "");
const ok = (missing) => ({ ok: !missing.length, missing });

// name -> { lookup(args) -> [tool, args], check(args, result) -> { ok, missing? } }
const READ_BACKS = {
  create_event: {
    lookup: () => ["list_events", { scope: "all", when: "all" }],
    check: (args, result) => {
      const events = (result && result.events) || [];
      const found = events.some((e) => same(e.name, args.eventName) && (!args.eventDate || day(e.eventDate) === day(args.eventDate)));
      return { ok: found, missing: found ? [] : [`${args.eventName}${args.eventDate ? ` on ${day(args.eventDate)}` : ""} isn't on the events list`] };
    },
  },
  delete_event: {
    lookup: () => ["list_events", { scope: "all", when: "all" }],
    check: (args, result) => {
      const events = (result && result.events) || [];
      const still = events.some((e) => same(e.name, args.eventName) && (!args.eventDate || day(e.eventDate) === day(args.eventDate)));
      return { ok: !still, missing: still ? [`${args.eventName} is still on the events list`] : [] };
    },
  },
  create_activity: {
    lookup: (args) => ["list_activities", { ...(args.className ? { className: args.className } : {}), from: day(args.date), to: day(args.endDate || args.date) }],
    check: (args, result) => {
      const list = (result && result.activities) || [];
      const found = list.some((a) => same(a.title, args.title) && day(a.date) === day(args.date));
      return { ok: found, missing: found ? [] : [`${args.title} on ${day(args.date)} isn't on the activities list`] };
    },
  },
  delete_class: {
    lookup: (args) => ["get_class", { query: args.className }],
    check: (args, result) => {
      const still = Array.isArray(result) && result.some((c) => same(c.class_name, args.className));
      return { ok: !still, missing: still ? [`${args.className} is still in the class list`] : [] };
    },
  },
  create_classes: {
    lookup: () => ["get_class", {}],
    check: (args, result) => {
      const names = new Set((Array.isArray(result) ? result : []).map((c) => String(c.class_name || "").trim().toLowerCase()));
      const missing = (args.classNames || []).filter((name) => !names.has(String(name).trim().toLowerCase()));
      return { ok: !missing.length, missing: missing.map((name) => `${name} isn't in the class list`) };
    },
  },
};

// The riskiest changes (2026-11-23).
Object.assign(READ_BACKS, {
  send_message: {
    lookup: () => ["list_sent_messages", { limit: 50 }],
    check: (args, result) => {
      const start = words(args.message).slice(0, 60);
      const found = ((result && result.messages) || []).some((m) => words(m.message).startsWith(start) && m.status !== "failed");
      return ok(found ? [] : ["the message isn't in the Mailroom's sent list"]);
    },
  },
  post_or_send_report_cards: {
    lookup: (args) => ["get_class_readiness", { classes: args.className, ...(args.termName ? { term: args.termName } : {}), status: "all" }],
    // Posting runs in the background: while it's under way there's nothing to read back yet.
    pending: (args, changeResult) => Boolean(changeResult && changeResult.posting && changeResult.posting.started),
    check: (args, result) => {
      const row = ((result && result.data) || []).find((c) => same(c.class, args.className));
      if (!row) return ok([`${args.className} isn't in the report card list`]);
      const posted = args.post !== false;
      const n = posted ? Number(row.report_cards_posted) : Number(row.report_cards_sent);
      return ok(n > 0 ? [] : [`no report cards for ${args.className} show as ${posted ? "posted" : "sent"}`]);
    },
  },
  set_enrollment_roster: {
    lookup: (args) => ["get_enrollment_roster", { ...(args.termName ? { termName: args.termName } : {}), ...(args.yearLabel ? { yearLabel: args.yearLabel } : {}) }],
    check: (args, result) => {
      const classes = (result && result.classes) || [];
      const missing = [];
      for (const wanted of args.roster || []) {
        const c = classes.find((x) => same(x.className, wanted.className));
        if (!c) { missing.push(`${wanted.className} isn't open for the term`); continue; }
        const names = new Set((c.students || []).map(fullName));
        (wanted.studentNames || []).filter((n) => !names.has(words(n))).forEach((n) => missing.push(`${n} isn't on ${wanted.className}'s roster`));
      }
      return ok(missing);
    },
  },
  update_website_section: {
    lookup: () => ["get_website_settings", {}],
    check: (args, result) => {
      const section = result && result.sections && result.sections[args.section];
      if (!section) return ok([`the website's ${args.section} section isn't there`]);
      const missing = ["enabled", "title", "intro", "notifyEmail", "address", "officeHours", "showMap", "imageCaption"]
        .filter((key) => args[key] !== undefined && key in section && words(section[key]) !== words(args[key]))
        .map((key) => `the ${args.section} section's ${key} doesn't show the change`);
      return ok(missing);
    },
  },
  create_students: {
    // One lookup per student, by name (at most 50 in a call).
    lookups: (args) => (args.students || []).slice(0, 50).map((s) => ["find_student", { query: [s.firstName, s.lastName].filter(Boolean).join(" ") }]),
    checkAll: (args, results) => ok((args.students || []).slice(0, 50).filter((s, i) => {
      const want = words([s.firstName, s.lastName].join(" "));
      const found = results[i];
      return !(Array.isArray(found) && found.some((row) => fullName(row) === want));
    }).map((s) => `${s.firstName} ${s.lastName} isn't in the student list`)),
  },
  create_subject: {
    lookup: () => ["list_subjects", {}],
    check: (args, result) => {
      const subject = (Array.isArray(result) ? result : []).find((x) => same(x.subject_name, args.subjectName));
      if (!subject) return ok([`${args.subjectName} isn't in the subject list`]);
      const assigned = new Set((subject.assigned_classes || []).map((c) => words(c.class_name)));
      return ok((args.classNames || []).filter((c) => !assigned.has(words(c))).map((c) => `${args.subjectName} isn't assigned to ${c}`));
    },
  },
  delete_subject: {
    lookup: () => ["list_subjects", {}],
    check: (args, result) => {
      const subject = (Array.isArray(result) ? result : []).find((x) => same(x.subject_name, args.subjectName));
      if (!subject) return ok([]);
      if (!args.className) return ok([`${args.subjectName} is still in the subject list`]);
      const still = (subject.assigned_classes || []).some((c) => same(c.class_name, args.className));
      return ok(still ? [`${args.subjectName} is still assigned to ${args.className}`] : []);
    },
  },
  delete_test: {
    lookup: (args) => ["list_assessments", { ...(args.termName ? { termName: args.termName } : {}), ...(args.yearLabel ? { yearLabel: args.yearLabel } : {}) }],
    check: (args, result) => {
      const still = ((result && result.assessments) || []).some((a) => same(a.title, args.title));
      return ok(still ? [`${args.title} is still in the term's assessments`] : []);
    },
  },
  create_school_announcement: {
    lookup: () => ["list_school_announcements", { scope: "all" }],
    check: (args, result) => {
      const found = ((result && result.announcements) || []).some((a) => words(a.message) === words(args.message));
      return ok(found ? [] : ["the announcement isn't in the announcements list"]);
    },
  },
  delete_school_announcement: {
    lookup: () => ["list_school_announcements", { scope: "all" }],
    check: (args, result) => {
      const still = ((result && result.announcements) || []).some((a) => words(a.message).includes(words(args.currentText)));
      return ok(still ? ["the announcement is still in the announcements list"] : []);
    },
  },
  set_student_remarks: {
    lookup: (args) => ["list_student_remarks", { className: args.className, ...(args.termName ? { termName: args.termName } : {}) }],
    check: (args, result) => {
      const rows = new Map(((result && result.students) || []).map((s) => [words(s.student), s]));
      const missing = [];
      for (const entry of args.remarks || []) {
        const row = rows.get(words(entry.studentName));
        ["teacher", "conduct", "attitude", "interest"].filter((key) => typeof entry[key] === "string" && entry[key].trim())
          .forEach((key) => { if (!row || words(row[key]) !== words(entry[key])) missing.push(`${entry.studentName}'s ${key} remark doesn't show the change`); });
      }
      return ok(missing);
    },
  },
  apply_report_signature: {
    lookup: () => ["list_report_signatures", {}],
    check: (args, result) => {
      const said = words(args.signature);
      const sig = ((result && result.signatures) || []).find((s) => [s.name, s.title, s.label].some((x) => words(x) === said));
      if (!sig) return ok([`the signature ${args.signature} isn't in the list`]);
      const on = new Set((sig.classes || []).map(words));
      return ok((args.classNames || []).filter((c) => !on.has(words(c))).map((c) => `${c} doesn't show ${args.signature}`));
    },
  },
  delete_document: {
    lookup: () => ["list_documents", {}],
    check: (args, result) => {
      const still = ((result && result.documents) || []).some((d) => (args.documentId && Number(d.documentId) === Number(args.documentId)) || (!args.documentId && args.title && same(d.title, args.title)));
      return ok(still ? [`${args.title || `document ${args.documentId}`} is still in the documents list`] : []);
    },
  },
});

const COVERED = Object.keys(READ_BACKS);

const lookupFailed = (status, result) => status !== "ok" || !result || result.ok === false || /^(needs_info|error|blocked|failed)$/.test(String(result.status || ""));

/**
 * verify(tool, args, run, changeResult) -> { state: "confirmed" | "missing" | "not_checked", missing: [...], lookedUp? }
 * `run(name, args)` runs a read tool as the signed-in person (runTool) and returns { status, result }.
 * `changeResult` is what the change itself returned (posting report cards runs in the background).
 */
async function verify(tool, args, run, changeResult = null) {
  const readBack = READ_BACKS[tool];
  if (!readBack) return { state: "not_checked", missing: [] };
  if (readBack.pending && readBack.pending(args || {}, changeResult)) return { state: "not_checked", missing: [], pending: true };
  if (readBack.lookups) {
    try {
      const lookups = readBack.lookups(args || {});
      const results = [];
      for (const [name, lookupArgs] of lookups) {
        const { status, result } = await run(name, lookupArgs);
        if (lookupFailed(status, result)) return { state: "not_checked", missing: [], lookedUp: name };
        results.push(result);
      }
      const { ok: fine, missing } = readBack.checkAll(args || {}, results);
      return { state: fine ? "confirmed" : "missing", missing: missing || [], lookedUp: lookups[0] && lookups[0][0] };
    } catch (error) {
      console.error(`[mira/readBack] ${tool}: the read-back couldn't run`, error.message);
      return { state: "not_checked", missing: [] };
    }
  }
  const [name, lookupArgs] = readBack.lookup(args || {});
  try {
    const { status, result } = await run(name, lookupArgs);
    if (lookupFailed(status, result)) return { state: "not_checked", missing: [], lookedUp: name };
    const { ok, missing } = readBack.check(args || {}, result);
    return { state: ok ? "confirmed" : "missing", missing: missing || [], lookedUp: name };
  } catch (error) {
    console.error(`[mira/readBack] ${tool}: the read-back couldn't run`, error.message);
    return { state: "not_checked", missing: [], lookedUp: name };
  }
}

/**
 * outcomeReply(outcomes) -> the reply when any confirmed change failed or isn't in the records:
 * what's done and what's not, written by code. outcomes: [{ label, state, why? }] with state
 * done | failed | missing | not_checked | skipped.
 */
function outcomeReply(outcomes) {
  const done = outcomes.filter((o) => o.state === "done");
  const saved = outcomes.filter((o) => o.state === "not_checked");
  const notDone = outcomes.filter((o) => ["failed", "missing", "skipped"].includes(o.state));
  const lines = [];
  if (done.length) lines.push(`**Done** (checked in Managira):\n${done.map((o) => `- ${o.label}`).join("\n")}`);
  if (saved.length) lines.push(`**Saved** (Managira reported it done):\n${saved.map((o) => `- ${o.label}`).join("\n")}`);
  if (notDone.length) {
    lines.push(`**Not done:**\n${notDone.map((o) => `- ${o.label}${o.why ? ` - ${o.why}` : ""}`).join("\n")}`);
  }
  return lines.join("\n\n");
}

module.exports = { verify, outcomeReply, COVERED };
