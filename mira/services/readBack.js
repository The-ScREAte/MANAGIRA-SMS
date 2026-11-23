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
// create_event, delete_event, create_activity, delete_class, create_classes.

const same = (a, b) => String(a || "").trim().toLowerCase() === String(b || "").trim().toLowerCase();
const day = (value) => String(value || "").slice(0, 10);

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

const COVERED = Object.keys(READ_BACKS);

/**
 * verify(tool, args, run) -> { state: "confirmed" | "missing" | "not_checked", missing: [...], lookedUp? }
 * `run(name, args)` runs a read tool as the signed-in person (runTool) and returns { status, result }.
 */
async function verify(tool, args, run) {
  const readBack = READ_BACKS[tool];
  if (!readBack) return { state: "not_checked", missing: [] };
  const [name, lookupArgs] = readBack.lookup(args || {});
  try {
    const { status, result } = await run(name, lookupArgs);
    if (status !== "ok" || !result || result.ok === false || /^(needs_info|error|blocked|failed)$/.test(String(result.status || ""))) {
      return { state: "not_checked", missing: [], lookedUp: name };
    }
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
