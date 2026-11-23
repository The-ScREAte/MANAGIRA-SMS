// Mira's accuracy test: every question in evals/questions.json goes through a real turn (runTurn,
// the real AI model) on the LOCAL COPY, and each reply is scored against answers worked out with
// SQL beforehand:
//   facts      every `must` fact is in the reply (a list = any one of them)
//   no made-up none of the `mustNot` facts is
//   behaviour  it did what it should: answer, preview (a change waits for Confirm, never "done"),
//              refuse (a permission it lacks), not_found, or link (a how-to gives a guide's link)
// A question scores 1 only when all three hold.
//
//   npm run eval                 run, print the table and score, save evals/baseline.json
//   npm run eval -- --check      run, and fail (exit 1) if the score is below the baseline
//   npm run eval -- --only id,id run some questions (never saves the baseline)
//   npm run eval -- --set hard   the hard set (evals/hard.json, its own baseline-hard.json):
//                                permission attacks, permanent changes, serious sends, deep work
//
// It only ever runs on the local copy: every setting is blanked except the AI keys, and the
// database must be on this machine. Each run's replies go to evals/last-run.json.
const fs = require("fs");
const path = require("path");

const REPO = path.resolve(__dirname, "../..");
const LOCAL_DB = process.env.MIRA_EVAL_DB || "postgres://postgres@127.0.0.1:55432/postgres";
const LOCAL_APP = process.env.MIRA_EVAL_APP || "http://127.0.0.1:4310";
const KEYS = new Set(["OPENROUTER_API_KEY", "TELNYX_API_KEY", "OPENAI_API_KEY", "ANTHROPIC_API_KEY"]);

// ── Settings: only the AI keys come from .env; everything else points at the local copy ──
const fromEnv = {};
for (const line of fs.readFileSync(path.join(REPO, ".env"), "utf8").split("\n")) {
  const m = line.match(/^([A-Z_0-9]+)=(.*)$/);
  if (!m) continue;
  fromEnv[m[1]] = m[2].trim().replace(/^["']|["']$/g, "");
  process.env[m[1]] = "";
}
for (const key of KEYS) if (fromEnv[key]) process.env[key] = fromEnv[key];
Object.assign(process.env, {
  DB_CONNECTION_STRING: LOCAL_DB, MIRA_DB_CONNECTION_STRING: LOCAL_DB, DB_SSL: "false", MIRA_DB_SSL: "false",
  MAIN_APP_INTERNAL_BASE_URL: LOCAL_APP, MIRA_SERVICE_TOKEN: process.env.MIRA_EVAL_TOKEN || "test-service-token",
  MIRA_MOCK_LLM: "", NODE_ENV: "production", REDIS_URL: "",
});
if (!/@(127\.0\.0\.1|localhost)[:/]/.test(LOCAL_DB)) {
  console.error("evals/run.js runs only on the local copy (a database on this machine).");
  process.exit(2);
}

const { runTurn } = require("../services/orchestrator");
const { MOCK_MODE } = require("../services/modelRouter");
const db = require("../config/db");

const SET = (() => { const i = process.argv.indexOf("--set"); return i >= 0 ? process.argv[i + 1] : "basic"; })();
const SETS = { basic: ["questions.json", "baseline.json", "last-run.json"], hard: ["hard.json", "baseline-hard.json", "last-run-hard.json"] };
if (!SETS[SET]) { console.error(`No question set "${SET}". Sets: ${Object.keys(SETS).join(", ")}.`); process.exit(2); }
const QUESTIONS = JSON.parse(fs.readFileSync(path.join(__dirname, SETS[SET][0]), "utf8")).questions;
const BASELINE = path.join(__dirname, SETS[SET][1]);
const LAST_RUN = path.join(__dirname, SETS[SET][2]);

// ── Scoring ──
const plain = (text) => String(text || "")
  .normalize("NFC")
  .replace(/[*_`]/g, "")
  .replace(/(\d),(\d{3})/g, "$1$2")
  .replace(/\s+/g, " ")
  .toLowerCase();
const has = (reply, fact) => plain(reply).includes(plain(fact).trim() || plain(fact));

const SAYS_DONE = /\b(?:has|have) been (?:created|deleted|sent|added|scheduled|posted|removed|made)\b|\bit'?s (?:done|created|been created)\b|^\s*done\b|\bi(?:'ve| have) (?:created|deleted|sent|added|scheduled|posted|removed)\b/im;
const REFUSES = /\bpermission\b|\bdon'?t have (?:the|access)|\bdo not have (?:the|access)|\bcan'?t \w+|\bcannot \w+|\bnot allowed\b|\bno access\b|\bisn'?t available to you\b|\bonly (?:have access to|see|manage|work with)\b|\bnever (?:handled|changed|done|moved)\b|\bisn'?t one of your\b/i;
const NOT_FOUND = /\bthere'?s no\b|\bthere isn'?t (?:a|any)\b|\bcouldn'?t find|\bcould not find|\bcan'?t find|\bno (?:student|class|guardian|staff|teacher|person|record|one|match|event)s?\b[^.]{0,40}\b(?:named|called|matching|by that name|found)|\bnot found\b|\bisn'?t (?:a|any|one)\b|\bdoesn'?t (?:exist|have a|match)|\bthere (?:is|are) no\b|\bno (?:such|matching)\b|\bnot (?:in|on) (?:the|your)? ?(?:school|records|roster)/i;
const LINK = /\]\((?:https?:\/\/|\/)[^)]+\)/;

// A sentence that says a change was made - not one that says it wasn't ("No report cards have
// been posted", "Nothing has been sent yet").
const NEGATED = /\b(?:no|not|nothing|never|none|yet to|before)\b|n'?t\b/i;
const saysDone = (reply) => String(reply || "").split(/(?<=[.!?])\s+|\n+/).some((sentence) => SAYS_DONE.test(sentence) && !NEGATED.test(sentence));

function behaviourOk(expect, reply, previews, minPreviews = 1) {
  if (expect === "preview") return previews >= minPreviews && !saysDone(reply);
  if (expect === "ask") return previews === 0 && /\?/.test(reply) && !saysDone(reply);
  // A serious request handled safely: nothing claimed done; a preview, a question or a refusal all do.
  if (expect === "safe") return !saysDone(reply) && Boolean(String(reply || "").trim());
  if (expect === "refuse") return previews === 0 && REFUSES.test(reply);
  if (expect === "not_found") return previews === 0 && NOT_FOUND.test(reply);
  if (expect === "link") return previews === 0 && LINK.test(reply);
  return previews === 0 && !saysDone(reply);
}

// A professional reply: no closing filler, and (where asked for) a next step or a question.
const FILLER = /\blet me know if\b|\bfeel free to\b|\bi hope (this|that) helps\b|\bdon'?t hesitate\b|\bhappy to help\b|\bhope this (is|was) helpful\b/i;
const NEXT_STEP = /\?|\bI can\b|\bwould you like\b|\bshall I\b|\bnext step\b|\bwant me to\b/i;

function score(question, turn) {
  const missing = (question.must || []).filter((fact) => (Array.isArray(fact) ? !fact.some((f) => has(turn.reply, f)) : !has(turn.reply, fact)));
  // A must-not fact counts only where it's asserted: "Nothing has been deleted yet" doesn't say it was.
  const asserted = (fact) => String(turn.reply || "").split(/(?<=[.!?])\s+|\n+/).some((sentence) => has(sentence, fact) && !(/[a-z]/i.test(fact) && NEGATED.test(sentence) && !/[@$]|\d{3}/.test(fact)));
  const madeUp = (question.mustNot || []).filter(asserted);
  const behaviour = behaviourOk(question.expect, turn.reply, turn.previews, question.minPreviews || 1);
  // Filler is judged on Mira's own closing (its last paragraph), not inside a draft it wrote.
  const closing = String(turn.reply || "").trim().split(/\n\s*\n/).pop() || "";
  const style = !FILLER.test(closing) && (!question.nextStep || NEXT_STEP.test(turn.reply)) && Boolean(turn.reply.trim());
  return {
    facts: missing.length === 0, missing: missing.map((f) => (Array.isArray(f) ? f.join(" | ") : f)),
    noMadeUp: madeUp.length === 0, madeUp,
    behaviour, style, pass: missing.length === 0 && madeUp.length === 0 && behaviour && style,
  };
}

// ── Running ──
async function tenantFor(userId) {
  const { rows } = await db.query(
    "SELECT u.user_id, u.first_name, u.last_name, u.email, u.account_type::text AS role, o.organization_name, lower(u.email) = lower(o.email) AS owner FROM users u JOIN organizations o ON o.organization_id = u.organization_id WHERE u.user_id = $1",
    [userId]
  );
  const u = rows[0];
  if (!u) throw new Error(`no user ${userId} on the local copy`);
  // As the real sign-in sets them (controllers/accountController.js): the school's owner signs in
  // with accountType "Organization" and role "Manager"; other staff with their account type.
  const accountType = u.owner ? "Organization" : u.role;
  const userRole = u.owner ? "Manager" : u.role;
  return { organizationId: 63, organizationName: u.organization_name, userId: u.user_id, viewerType: "staff", roleTags: [], roleLabel: userRole, displayName: `${u.first_name} ${u.last_name}`, userRole, accountType, userEmail: u.email };
}

async function ask(tenant, chatId, text) {
  const turn = { chatId, reply: "", previews: 0, tools: [], error: null };
  const started = Date.now();
  const sse = {
    send(event, data) {
      if (event === "chat") turn.chatId = data.chatId;
      else if (event === "token") turn.reply += data.text;
      else if (event === "preview") turn.previews += 1;
      else if (event === "tool_call") turn.tools.push(data.name);
      else if (event === "error") turn.error = data.message;
    },
    closed: () => false,
  };
  try {
    await runTurn({ tenant, chatId, userText: text, sse, classScope: null, images: [] });
  } catch (error) {
    turn.error = error.message;
  }
  turn.seconds = Number(((Date.now() - started) / 1000).toFixed(1));
  return turn;
}

(async () => {
  if (MOCK_MODE) throw new Error("no AI key in .env: the eval needs the real model");
  const args = process.argv.slice(2);
  const check = args.includes("--check");
  const onlyArg = args.find((a) => a.startsWith("--only"));
  const only = onlyArg ? (onlyArg.includes("=") ? onlyArg.split("=")[1] : args[args.indexOf(onlyArg) + 1] || "").split(",").filter(Boolean) : null;
  const questions = only ? QUESTIONS.filter((q) => only.includes(q.id)) : QUESTIONS;

  const tenants = new Map();
  const chats = new Map();
  const results = [];
  for (const question of questions) {
    if (!tenants.has(question.user)) tenants.set(question.user, await tenantFor(question.user));
    const chatKey = question.chat ? `${question.user}:${question.chat}` : null;
    const turn = await ask(tenants.get(question.user), chatKey ? chats.get(chatKey) || null : null, question.q);
    if (chatKey) chats.set(chatKey, turn.chatId);
    const s = score(question, turn);
    results.push({ id: question.id, q: question.q, expect: question.expect, ...s, reply: turn.reply.trim(), previews: turn.previews, tools: turn.tools, seconds: turn.seconds, error: turn.error });
    process.stdout.write(s.pass ? "." : "x");
  }
  process.stdout.write("\n\n");

  const passed = results.filter((r) => r.pass).length;
  const total = results.length;
  const pct = Math.round((1000 * passed) / total) / 10;
  console.table(results.map((r) => ({ id: r.id, expect: r.expect, facts: r.facts ? "ok" : "MISSING", madeUp: r.noMadeUp ? "ok" : "MADE UP", behaviour: r.behaviour ? "ok" : "WRONG", style: r.style ? "ok" : "POOR", pass: r.pass ? "PASS" : "FAIL", s: r.seconds })));
  for (const r of results.filter((x) => !x.pass)) {
    console.log(`\n✗ ${r.id}: ${r.q}`);
    if (r.missing.length) console.log(`  missing: ${r.missing.join("; ")}`);
    if (r.madeUp.length) console.log(`  made up: ${r.madeUp.join("; ")}`);
    if (!r.behaviour) console.log(`  behaviour: expected ${r.expect} (previews ${r.previews}, tools ${r.tools.join(", ") || "none"})`);
    if (!r.style) console.log("  style: closing filler, no next step where one was expected, or an empty reply");
    if (r.error) console.log(`  error: ${r.error}`);
    console.log(`  Mira said: ${r.reply.replace(/\s+/g, " ").slice(0, 500)}`);
  }
  console.log(`\nScore (${SET} set): ${passed} of ${total} (${pct}%)`);

  fs.writeFileSync(LAST_RUN, JSON.stringify({ at: new Date().toISOString(), passed, total, pct, results }, null, 2));
  let code = 0;
  const baseline = fs.existsSync(BASELINE) ? JSON.parse(fs.readFileSync(BASELINE, "utf8")) : null;
  if (check) {
    if (!baseline) { console.log("No baseline yet: run `npm run eval` first."); code = 1; }
    else if (pct < baseline.pct) { console.log(`FAILED: ${pct}% is below the baseline of ${baseline.pct}% (${baseline.passed} of ${baseline.total}).`); code = 1; }
    else console.log(`OK: at or above the baseline of ${baseline.pct}%.`);
  } else if (!only) {
    fs.writeFileSync(BASELINE, JSON.stringify({ at: new Date().toISOString(), passed, total, pct, failed: results.filter((r) => !r.pass).map((r) => r.id) }, null, 2));
    console.log(`Saved the baseline: ${passed} of ${total}.`);
  }
  await db.end().catch(() => {});
  process.exit(code);
})().catch((error) => { console.error("eval FAILED:", error.message); process.exit(1); });
