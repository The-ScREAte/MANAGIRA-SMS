// Mira's week, read-only: how often its answer check sent a reply back or blocked it, why, which
// questions caused it, which tool calls were refused for bad details, and what it cost by model.
//
//   node scripts/weeklyReport.js                 the database in .env (every school)
//   node scripts/weeklyReport.js --org 63        one school
//   node scripts/weeklyReport.js --days 14       another window (default 7)
//   node scripts/weeklyReport.js --local         the local copy (127.0.0.1:55432) instead
//
// Every query runs inside a READ ONLY transaction: this script can't change anything.
const path = require("path");

const args = process.argv.slice(2);
const flag = (name) => args.includes(`--${name}`);
const value = (name, fallback) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 && args[i + 1] ? args[i + 1] : fallback;
};
if (flag("local")) {
  process.env.MIRA_DB_CONNECTION_STRING = "postgres://postgres@127.0.0.1:55432/postgres";
  process.env.MIRA_DB_SSL = "false";
} else {
  require("dotenv").config({ path: path.resolve(__dirname, "../../.env") });
}
const { Pool } = require("pg");
const connectionString = process.env.MIRA_DB_CONNECTION_STRING || process.env.DB_CONNECTION_STRING;
if (!connectionString) { console.error("No database: set DB_CONNECTION_STRING in .env, or use --local."); process.exit(2); }
const ssl = String(process.env.MIRA_DB_SSL || process.env.DB_SSL || "").toLowerCase() === "false" || /@(127\.0\.0\.1|localhost)[:/]/.test(connectionString) ? false : { rejectUnauthorized: false };
const pool = new Pool({ connectionString, ssl, max: 1 });

const days = Math.max(1, Math.min(90, Number(value("days", 7)) || 7));
const org = value("org", null) ? Number(value("org")) : null;

// "the name Lucy Bennett" -> "a name no record gives"; one kind per problem, for the top reasons.
function kindOf(problem) {
  const p = String(problem || "");
  if (/^the figure /.test(p)) return "a figure no record gives";
  if (/^the name /.test(p)) return "a name no record gives";
  if (/^the date /.test(p)) return "a date no record gives";
  if (/^the weekday /.test(p)) return "a wrong weekday";
  if (/^"/.test(p)) return "an all/none claim no lookup backs";
  if (/^that it's done/.test(p)) return "saying a change was done (only a preview existed)";
  if (/^not looked up: /.test(p)) return `part of the question not looked up (${p.replace(/^not looked up: /, "")})`;
  if (/preview Managira didn't make/.test(p)) return "a preview Mira wrote itself";
  if (/calendar name/.test(p)) return "a calendar name no calendar gives";
  return p.slice(0, 80);
}

const table = (rows) => (rows.length ? console.table(rows) : console.log("  (none)"));

(async () => {
  const client = await pool.connect();
  try {
    await client.query("BEGIN READ ONLY");
    const where = `created_at > now() - make_interval(days => $1)${org ? " AND tenant_id = $2" : ""}`;
    const params = org ? [days, org] : [days];

    console.log(`\nMira, the last ${days} days${org ? ` (school ${org})` : " (every school)"} - as of ${new Date().toISOString().slice(0, 16).replace("T", " ")} UTC\n`);

    const checks = (await client.query(
      `SELECT arguments->>'question' AS question, (arguments->>'pass')::int AS pass, arguments->'problems' AS problems
         FROM mira_tool_call_log WHERE tool_name = 'reply_check' AND ${where}`, params)).rows;
    const replies = (await client.query(
      `SELECT count(*)::int AS n FROM mira_chat_messages m JOIN mira_chats c ON c.id = m.chat_id
        WHERE m.role = 'assistant' AND m.${where.replace(/created_at/g, "created_at").replace("tenant_id", "c.tenant_id")}`, params).catch(() => ({ rows: [{ n: null }] }))).rows[0].n;
    const sentBack = checks.filter((c) => c.pass === 1).length;
    const blocked = checks.filter((c) => c.pass === 2).length;
    console.log("1. The answer check");
    table([{ "replies given": replies, "sent back for correction": sentBack, "blocked (records shown instead)": blocked, "share sent back": replies ? `${((100 * sentBack) / replies).toFixed(1)}%` : "-" }]);

    const kinds = new Map();
    const examples = new Map();
    for (const c of checks.filter((x) => x.pass === 1)) {
      for (const problem of Array.isArray(c.problems) ? c.problems : []) {
        const kind = kindOf(problem);
        kinds.set(kind, (kinds.get(kind) || 0) + 1);
        if (!examples.has(kind)) examples.set(kind, String(problem).slice(0, 70));
      }
    }
    console.log("\n2. Top 10 reasons a reply was sent back");
    table([...kinds.entries()].sort((a, b) => b[1] - a[1]).slice(0, 10).map(([reason, times]) => ({ reason, times, example: examples.get(reason) })));

    const questions = new Map();
    for (const c of checks) {
      const key = String(c.question || "").replace(/\s+/g, " ").trim().slice(0, 90);
      const q = questions.get(key) || { question: key, "sent back": 0, blocked: 0 };
      q[c.pass === 2 ? "blocked" : "sent back"] += 1;
      questions.set(key, q);
    }
    console.log("\n3. The questions that caused them");
    table([...questions.values()].sort((a, b) => b.blocked - a.blocked || b["sent back"] - a["sent back"]).slice(0, 15));

    const refused = (await client.query(
      `SELECT tool_name AS tool, count(*)::int AS times, min(result_summary) AS example
         FROM mira_tool_call_log
        WHERE status = 'denied' AND result_summary LIKE 'Not run:%' AND tool_name <> 'reply_check' AND ${where}
        GROUP BY tool_name ORDER BY times DESC LIMIT 15`, params)).rows;
    console.log("\n4. Tool calls refused for bad details (missing, wrong or unreadable)");
    table(refused.map((r) => ({ ...r, example: String(r.example).slice(0, 90) })));

    const cost = (await client.query(
      `SELECT provider, model, count(*)::int AS calls, sum(prompt_tokens)::bigint AS prompt_tokens, sum(completion_tokens)::bigint AS completion_tokens,
              round(sum(estimated_cost_usd)::numeric, 4) AS est_cost_usd
         FROM mira_usage_ledger WHERE ${where} GROUP BY 1, 2 ORDER BY est_cost_usd DESC NULLS LAST, calls DESC`, params)).rows;
    console.log("\n5. Cost by model (estimates from services/usageLedger.js prices)");
    table(cost.map((r) => ({ ...r, prompt_tokens: Number(r.prompt_tokens), completion_tokens: Number(r.completion_tokens), est_cost_usd: Number(r.est_cost_usd) })));
    const total = cost.reduce((sum, r) => sum + Number(r.est_cost_usd || 0), 0);
    console.log(`   Total: about $${total.toFixed(4)} over ${cost.reduce((s, r) => s + r.calls, 0)} model calls.\n`);
    await client.query("ROLLBACK");
  } finally {
    client.release();
    await pool.end();
  }
})().catch((error) => { console.error("weekly report failed:", error.message); process.exit(1); });
