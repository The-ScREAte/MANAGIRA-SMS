// After a confirmed change, the records are read again before Mira reports it (services/readBack.js),
// and waiting previews are kept in the database so a restart loses none and none runs twice
// (services/confirmGate.js). No real database: a fake one stands in.
const test = require("node:test");
const assert = require("node:assert/strict");

const readBack = require("../services/readBack");

const run = (results) => async (name) => ({ status: "ok", result: results[name] });

test("a created event is done only when the events list shows it", async () => {
  const args = { eventName: "Science Fair", eventDate: "2026-12-04", eventDetails: "Gym" };
  const there = await readBack.verify("create_event", args, run({ list_events: { events: [{ name: "Science Fair", eventDate: "2026-12-04T00:00:00.000Z" }] } }));
  assert.equal(there.state, "confirmed");
  const gone = await readBack.verify("create_event", args, run({ list_events: { events: [{ name: "Science Fair", eventDate: "2026-12-05" }] } }));
  assert.equal(gone.state, "missing");
  assert.match(gone.missing[0], /Science Fair on 2026-12-04 isn't on the events list/);
});

test("a deleted class is done only when it's gone; created classes are checked one by one", async () => {
  assert.equal((await readBack.verify("delete_class", { className: "6B" }, run({ get_class: { found: false, message: "No class" } }))).state, "confirmed", "no class by that name any more");
  assert.equal((await readBack.verify("delete_class", { className: "6B" }, run({ get_class: { status: "needs_info", message: "Which?" } }))).state, "not_checked", "a lookup that answers with a question proves nothing");
  assert.equal((await readBack.verify("delete_class", { className: "6B" }, run({ get_class: [{ class_name: "6A" }] }))).state, "confirmed");
  assert.equal((await readBack.verify("delete_class", { className: "6B" }, run({ get_class: [{ class_name: "6B" }] }))).state, "missing");
  const some = await readBack.verify("create_classes", { classNames: ["7A", "7B"] }, run({ get_class: [{ class_name: "7A" }] }));
  assert.equal(some.state, "missing");
  assert.deepEqual(some.missing, ["7B isn't in the class list"]);
});

test("no read-back, or a lookup that can't run, is never called confirmed", async () => {
  assert.equal((await readBack.verify("send_message", {}, run({}))).state, "not_checked");
  const broken = await readBack.verify("create_event", { eventName: "X" }, async () => { throw new Error("down"); });
  assert.equal(broken.state, "not_checked");
  const denied = await readBack.verify("create_event", { eventName: "X" }, async () => ({ status: "denied", result: "No access" }));
  assert.equal(denied.state, "not_checked");
});

test("a failed or partial change is listed as not done, in code's own words", () => {
  const reply = readBack.outcomeReply([
    { label: "Create event Science Fair", state: "done" },
    { label: "Create class 7B", state: "missing", why: "Managira said it worked, but the records don't show it." },
    { label: "Send the reminder", state: "skipped", why: "stopped because the change before it went wrong" },
    { label: "Update the website", state: "not_checked" },
  ]);
  assert.match(reply, /\*\*Done\*\* \(checked in Managira\):\n- Create event Science Fair/);
  assert.match(reply, /\*\*Saved\*\* \(Managira reported it done\):\n- Update the website/);
  assert.match(reply, /\*\*Not done:\*\*\n- Create class 7B - Managira said it worked, but the records don't show it\.\n- Send the reminder - stopped/);
  assert.doesNotMatch(reply.split("**Not done:**")[1], /Science Fair/);
});

// A fake database for mira_previews: enough SQL to run confirmGate's own queries.
function fakeDb() {
  const rows = new Map();
  return {
    rows,
    async query(sql, params) {
      if (/^\s*INSERT INTO mira_previews/.test(sql)) {
        const [id, org, user, chat, turn, tool, args, key, level, label, keyDetail, state, created, expires] = params;
        if (!rows.has(id)) rows.set(id, { id, organization_id: org, user_id: user, chat_id: chat, turn, tool, args: JSON.parse(args), details_key: key, level, label, key_detail: keyDetail, state, created_ms: created, expires_ms: expires });
        return { rows: [] };
      }
      if (/^\s*SELECT id, organization_id/.test(sql)) {
        const [org, user, chat] = params;
        return { rows: [...rows.values()].filter((r) => r.organization_id === org && r.user_id === user && r.chat_id === chat) };
      }
      if (/SET state = 'done' WHERE id = \$1 AND state = 'waiting'/.test(sql)) {
        const r = rows.get(params[0]);
        if (r && r.state === "waiting") { r.state = "done"; return { rows: [{ id: r.id }] }; }
        return { rows: [] };
      }
      if (/^\s*SELECT state FROM mira_previews/.test(sql)) return { rows: rows.has(params[0]) ? [{ state: rows.get(params[0]).state }] : [] };
      if (/^\s*UPDATE mira_previews SET state = \$2/.test(sql)) { const r = rows.get(params[0]); if (r) r.state = params[1]; return { rows: [] }; }
      if (/^\s*DELETE FROM mira_previews/.test(sql)) return { rows: [] };
      throw new Error(`unexpected SQL: ${sql}`);
    },
  };
}

test("a waiting preview survives a restart and still runs only once", async () => {
  const T = { organizationId: 63, userId: 240 };
  const db = fakeDb();
  // The first server makes the preview and stores it.
  const first = require("../services/confirmGate");
  first.useDb(db);
  const p = first.create({ tenant: T, chatId: 9, turn: 1, tool: "create_event", args: { eventName: "Science Fair", eventDate: "2026-12-04" }, level: 1, label: "Create event Science Fair" });
  await first.save(p);
  assert.equal(db.rows.get(p.id).state, "waiting");

  // A restart: a fresh copy of the gate with an empty memory store.
  delete require.cache[require.resolve("../services/confirmGate")];
  const second = require("../services/confirmGate");
  second.useDb(db);
  assert.equal(second.waiting(T, 9).length, 0, "memory is empty after the restart");
  await second.load(T, 9);
  const out = second.decide({ tenant: T, chatId: 9, userText: "yes" });
  assert.equal(out.run.length, 1, "the person's yes still finds the preview");
  assert.equal(await second.claim(out.run[0]), true);
  assert.equal(db.rows.get(p.id).state, "done");

  // The old server's copy (or a second server) can't run it again.
  assert.equal(await first.claim(first._store.get(p.id)), false, "claimed already, in the database");
  await second.load(T, 9);
  assert.equal(second.decide({ tenant: T, chatId: 9, userText: "yes" }).run.length, 0, "single use");
});

test("the riskiest changes are read back too", async () => {
  const sent = { list_sent_messages: { messages: [{ message: "School closes early on Friday at 1 PM.", status: "sent" }] } };
  assert.equal((await readBack.verify("send_message", { message: "School closes early on Friday at 1 PM." }, run(sent))).state, "confirmed");
  assert.equal((await readBack.verify("send_message", { message: "Something else" }, run(sent))).state, "missing");
  const subjects = { list_subjects: [{ subject_name: "Art", assigned_classes: [{ class_name: "6A" }] }] };
  assert.equal((await readBack.verify("create_subject", { subjectName: "Art", classNames: ["6A"] }, run(subjects))).state, "confirmed");
  assert.equal((await readBack.verify("create_subject", { subjectName: "Art", classNames: ["6B"] }, run(subjects))).state, "missing");
  assert.equal((await readBack.verify("delete_subject", { subjectName: "Music" }, run(subjects))).state, "confirmed");
  assert.equal((await readBack.verify("delete_subject", { subjectName: "Art", className: "6A" }, run(subjects))).state, "missing");
  const site = { get_website_settings: { sections: { faq: { enabled: true, title: "FAQ" } } } };
  assert.equal((await readBack.verify("update_website_section", { section: "faq", title: "FAQ", enabled: true }, run(site))).state, "confirmed");
  assert.equal((await readBack.verify("update_website_section", { section: "faq", title: "Questions" }, run(site))).state, "missing");
  const roster = { get_enrollment_roster: { classes: [{ className: "6A", students: [{ first_name: "Ama", last_name: "Owusu" }] }] } };
  assert.equal((await readBack.verify("set_enrollment_roster", { roster: [{ className: "6A", studentNames: ["Ama Owusu"] }] }, run(roster))).state, "confirmed");
  assert.equal((await readBack.verify("set_enrollment_roster", { roster: [{ className: "6A", studentNames: ["Kofi Mensah"] }, { className: "6B", studentNames: [] }] }, run(roster))).missing.length, 2);
  const found = async (name, args) => ({ status: "ok", result: args.query === "Ama Owusu" ? [{ first_name: "Ama", last_name: "Owusu" }] : [] });
  assert.equal((await readBack.verify("create_students", { students: [{ firstName: "Ama", lastName: "Owusu" }] }, found)).state, "confirmed");
  assert.deepEqual((await readBack.verify("create_students", { students: [{ firstName: "Ama", lastName: "Owusu" }, { firstName: "Kofi", lastName: "Mensah" }] }, found)).missing, ["Kofi Mensah isn't in the student list"]);
  const ann = { list_school_announcements: { announcements: [{ message: "Sports day is on Friday." }] } };
  assert.equal((await readBack.verify("create_school_announcement", { message: "Sports day is on Friday." }, run(ann))).state, "confirmed");
  assert.equal((await readBack.verify("delete_school_announcement", { currentText: "Sports day" }, run(ann))).state, "missing");
  assert.equal((await readBack.verify("delete_test", { title: "Quiz 1" }, run({ list_assessments: { assessments: [{ title: "Quiz 2" }] } }))).state, "confirmed");
  assert.equal((await readBack.verify("delete_document", { documentId: 7 }, run({ list_documents: { documents: [{ documentId: 7, title: "Policy" }] } }))).state, "missing");
  const cards = { get_class_readiness: { ok: true, data: [{ class: "6A", report_cards_posted: 30, report_cards_sent: 0 }] } };
  assert.equal((await readBack.verify("post_or_send_report_cards", { className: "6A", post: true }, run(cards))).state, "confirmed");
  assert.equal((await readBack.verify("post_or_send_report_cards", { className: "6A", post: false }, run(cards))).state, "missing", "sent-only needs a sent count");
  const pending = await readBack.verify("post_or_send_report_cards", { className: "6A", post: true }, run(cards), { posting: { started: true } });
  assert.equal(pending.state, "not_checked", "posting in the background has nothing to read yet");
  assert.equal((await readBack.verify("remind_form_outstanding", { form: "Trip" }, run({}))).state, "not_checked", "reminders leave no record to read");
});

test("report-card remarks and signatures are read back", async () => {
  const remarks = { list_student_remarks: { students: [{ student: "Felix Patel", teacher: "Attendance of 92% needs to improve.", conduct: "" }] } };
  assert.equal((await readBack.verify("set_student_remarks", { className: "5A", remarks: [{ studentName: "Felix Patel", teacher: "Attendance of 92% needs to improve." }] }, run(remarks))).state, "confirmed");
  assert.equal((await readBack.verify("set_student_remarks", { className: "5A", remarks: [{ studentName: "Felix Patel", conduct: "Polite." }] }, run(remarks))).state, "missing");
  const sigs = { list_report_signatures: { signatures: [{ name: "Grace Owusu", title: "Head Teacher", label: "Grace Owusu, Head Teacher", classes: ["5A", "5B"] }] } };
  assert.equal((await readBack.verify("apply_report_signature", { signature: "Grace Owusu", classNames: ["5A", "5B"] }, run(sigs))).state, "confirmed");
  assert.deepEqual((await readBack.verify("apply_report_signature", { signature: "Grace Owusu", classNames: ["5C"] }, run(sigs))).missing, ["5C doesn't show Grace Owusu"]);
});
