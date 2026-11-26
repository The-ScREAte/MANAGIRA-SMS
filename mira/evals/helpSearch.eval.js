"use strict";

// Offline check of Mira's help-guide search. No model, no network, no database: it reads the
// guides from code, writes realistic questions from every guide's title, section headings,
// steps, FAQ questions and keywords (plus typos, synonym wording, menu names and a hand-written
// set), and compares:
//   OLD  utils/docs/askDocs.ask with the gating Mira used (how-to question, "sure" or "likely"
//        confidence, one guide)
//   NEW  mira/services/helpSearch.searchGuides (several guides, no gating)
// Run:  node mira/evals/helpSearch.eval.js [--misses] [--json]

const { syncRows } = require("../../utils/docs/catalog");
const { ask, piecesOf, keyWords } = require("../../utils/docs/askDocs");
const helpSearch = require("../services/helpSearch");

// The how-to test Mira's orchestrator used before (mira/services/orchestrator.js).
const HOW_TO = /^\s*(how|where|what (is|are|does)|what's|whats|why (can't|cant|doesn't|does|is|isn't)|can (i|we|you|parents|teachers|students|staff)|is (it|there) (possible|a way)|explain|steps to|help me (to )?(set|add|find|change|turn|connect|use))\b|\bhow (do|can|to|does)\b/i;
const FAMILY_GUIDES = new Set(["Parent portal", "Student portal"]);
const ABOUT_FAMILIES = /\b(?:how|where|what|when|can|do|does)\b[^.?!]*\b(?:parents?|guardians?|famil(?:y|ies)|students?|children|kids?)\b[^.?!]*\b(?:see|view|open|find|get|pay|sign in|log in|download|read|reply|submit|use|access)\b/i;

const rows = syncRows();
const bySlug = new Map(rows.map((r) => [r.slug, r]));

// ---------- a repeatable shuffle ----------
let seed = 20261125;
const rand = () => { seed = (seed * 1664525 + 1013904223) % 4294967296; return seed / 4294967296; };
const pick = (list) => list[Math.floor(rand() * list.length)];

const lower = (s) => String(s || "").replace(/\s+/g, " ").trim();
const lc = (s) => { const t = lower(s); return t.charAt(0).toLowerCase() + t.slice(1); };
const strip = (s) => lower(s).replace(/[.?!:]+$/g, "");
const head = (s, n) => lower(s).split(" ").slice(0, n).join(" ");

const GENERIC_HEADING = /^(who can do this|overview|tips?|good to know|before you start|steps?|example|examples|notes?|frequently asked questions|related|summary|what you need|requirements?)$/i;

// ---------- typos and synonym wording ----------
function typo(text) {
  const words = text.split(" ");
  const at = words.map((w, i) => ({ w, i })).filter((x) => /^[a-z]{6,}$/i.test(x.w));
  if (!at.length) return null;
  const { w, i } = pick(at);
  const k = 1 + Math.floor(rand() * (w.length - 3));
  const kind = Math.floor(rand() * 3);
  let t;
  if (kind === 0) t = w.slice(0, k) + w[k + 1] + w[k] + w.slice(k + 2);
  else if (kind === 1) t = w.slice(0, k) + w.slice(k + 1);
  else t = w.slice(0, k) + w[k] + w.slice(k);
  words[i] = t;
  return words.join(" ");
}
const SWAPS = [
  [/\bgrades?\b/i, "marks"], [/\bstudents?\b/i, "kids"], [/\bparents?\b/i, "guardians"], [/\bteachers?\b/i, "staff"],
  [/\bfees?\b/i, "payments"], [/\bsign in\b/i, "log in"], [/\bdelete\b/i, "remove"], [/\badd\b/i, "create"],
  [/\bclass\b/i, "classroom"], [/\bbus\b/i, "school transport"], [/\bpassword\b/i, "login details"], [/\bmessage\b/i, "text"],
  [/\bcreate\b/i, "set up"], [/\bchange\b/i, "edit"], [/\bscores?\b/i, "results"],
];
function synonymWording(text) {
  const hit = SWAPS.filter(([p]) => p.test(text));
  if (!hit.length) return null;
  const [p, to] = pick(hit);
  return text.replace(p, to);
}

// ---------- the generated questions ----------
const questions = [];
function add(category, text, slug, extra = {}) {
  const t = lower(text);
  if (t.length < 4) return;
  const row = bySlug.get(slug);
  const audience = row && FAMILY_GUIDES.has(row.topic) ? (/student/i.test(row.topic) ? "student" : "parent") : row && row.topic === "Driver app" ? "driver" : "staff";
  questions.push({ category, text: t, accept: extra.accept || [slug], audience: extra.audience || audience });
}

// Headings that name the same thing in more than one guide would be unfair questions.
const headingOwners = new Map();
const sectionsByGuide = new Map();
rows.forEach((row) => {
  const pieces = piecesOf(row);
  const secs = new Map();
  pieces.forEach((p) => {
    if (p.kind === "summary") return;
    const key = `${p.kind === "faq" ? "q" : "s"}|${p.heading}`;
    if (!p.heading) return;
    if (!secs.has(key)) secs.set(key, { faq: p.kind === "faq", heading: p.heading, steps: [], text: [] });
    const s = secs.get(key);
    (p.kind === "step" ? s.steps : s.text).push(p.text);
  });
  sectionsByGuide.set(row.slug, [...secs.values()]);
  secs.forEach((s) => {
    const k = keyWords(s.heading).join(" ");
    if (!headingOwners.has(k)) headingOwners.set(k, new Set());
    headingOwners.get(k).add(row.slug);
  });
});
const uniqueHeading = (slug, heading) => { const o = headingOwners.get(keyWords(heading).join(" ")); return o && o.size === 1 && o.has(slug); };

rows.forEach((row) => {
  const name = strip(row.title.split(":")[0]);
  const descr = row.title.includes(":") ? strip(row.title.split(":").slice(1).join(":")) : "";
  const secs = sectionsByGuide.get(row.slug) || [];
  // 1. the guide's title
  add("title", pick([`how do I use ${lc(name)}`, `where can I find ${lc(name)}`, `help with ${lc(name)}`, `what is ${lc(name)}`]), row.slug);
  if (descr) add("title", `how do I ${lc(descr)}`, row.slug);
  add("keyword", strip(row.title).toLowerCase().replace(/[:,]/g, ""), row.slug);
  // 2. its keywords
  const tags = (row.tags || []).filter((t) => t.length > 3);
  if (tags.length >= 2) add("keyword", `${pick(tags)} ${pick(tags)}`.replace(/^(.+) \1$/, "$1"), row.slug);
  if (tags.length) add("keyword", `${pick(tags)} help`, row.slug);
  // 3. section headings
  const real = secs.filter((s) => !s.faq && !GENERIC_HEADING.test(s.heading) && keyWords(s.heading).length >= 2 && uniqueHeading(row.slug, s.heading));
  real.slice(0, 5).forEach((s) => {
    const h = strip(s.heading);
    add("heading", pick([`how do I ${lc(h)}`, `where can I ${lc(h)}`, `I need to ${lc(h)}`, `${lc(h)} in ${row.topic.toLowerCase()}`]), row.slug);
  });
  // 4. steps: the first step of a few sections, said as a need
  real.filter((s) => s.steps.length && !/[›☰]/.test(s.steps[0]) && strip(s.steps[0]).split(" ").length <= 12).slice(0, 3).forEach((s) => {
    add("step", `where do I ${lc(head(strip(s.steps[0]).replace(/^(select|open|go to|choose|click|use)\s+/i, "$1 "), 9))}`, row.slug);
  });
  // 5. FAQs as asked
  const faqs = secs.filter((s) => s.faq && uniqueHeading(row.slug, s.heading));
  faqs.slice(0, 5).forEach((s) => {
    const q = strip(s.heading);
    add("faq", `${q}?`, row.slug);
  });
  faqs.filter((s) => /^(can't|cannot|why|i can't|i cannot|what if)/i.test(s.heading)).slice(0, 1).forEach((s) => add("trouble", `I ${strip(s.heading).replace(/^(why can't i|why can't|why do|why does|what if i can't|what if)\s*/i, "can't ")}`, row.slug));
});

// Variants: typos and synonym wording of questions already written.
const base = questions.slice();
base.filter((q) => q.category === "heading" || q.category === "title" || q.category === "faq").forEach((q, i) => {
  if (i % 3 === 0) { const t = typo(q.text); if (t && t !== q.text) questions.push({ ...q, category: "typo", text: t }); }
  if (i % 3 === 1) { const t = synonymWording(q.text); if (t && t !== q.text) questions.push({ ...q, category: "synonym", text: t }); }
});

// ---------- hand-written questions: menu names, products, roles ----------
const S = (words) => rows.filter((r) => words.some((w) => r.slug.includes(w))).map((r) => r.slug);
const manual = [
  ["menu", "Class & notif. settings", S(["class-settings"])],
  ["menu", "where is Attendance & lunch", S(["attendance", "lunch"])],
  ["menu", "Report remarks", S(["remark", "grading"])],
  ["menu", "open the Mailroom", S(["mailroom", "mail-room", "messages", "text-messag"])],
  ["menu", "Custom editor", S(["custom"])],
  ["menu", "how do I use the page finder", S(["search", "page-finder", "header", "find-a-page", "navigate"])],
  ["menu", "Management Tools menu", S(["management", "header", "home", "navigate", "what-each"])],
  ["menu", "Users / Employees", S(["employee", "staff"])],
  ["menu", "Billing & Plan", S(["billing", "subscription", "renewal", "pricing"])],
  ["menu", "Data migration sandbox", S(["migrat", "powerschool", "import"])],
  ["menu", "Two-step sign-in", S(["two-step", "authenticator", "verification", "sign-in"])],
  ["menu", "PayGira", S(["paygira"])],
  ["product", "what can Mira do", S(["mira"]).concat("mira-capabilities-list")],
  ["product", "what can I ask Mira", S(["mira"]).concat("mira-capabilities-list")],
  ["product", "can Mira send messages to parents", S(["mira", "mailroom", "report-card-send", "whatsapp"])],
  ["product", "how do I turn Mira on for my teachers", S(["mira"])],
  ["product", "what does Managira do", S(["getting-started", "welcome", "start", "overview", "home", "navigate", "what-each", "register"]).concat("about-managira")],
  ["product", "how much does Managira cost", S(["pricing", "subscription", "renewal", "billing", "plan"]).concat("about-managira")],
  ["product", "how is my subscription renewal amount worked out", S(["renewal", "pricing", "subscription"])],
  ["product", "does Managira work on a phone", S(["install", "phone", "app", "mobile", "getting-started", "header", "profile"]).concat("about-managira")],
  ["product", "can we use single sign on with Google", S(["single-sign-on", "sso"])],
  ["role", "how do I see my child's grades", S(["parent-grades", "parent-portal"])],
  ["role", "how do I pay my child's school bill", S(["parent-pay", "pay-bills"])],
  ["role", "where do parents see attendance", S(["parent-grades", "parent-portal", "attendance"])],
  ["role", "how does a student take an online test", S(["student", "test", "testing"])],
  ["role", "how does a driver start a trip", S(["driver"])],
  ["role", "driver cannot see the stops", S(["driver", "route"])],
  ["role", "teacher cannot see my class", S(["class", "permission", "teacher"])],
  ["role", "how do I give a teacher permission to take attendance", S(["permission", "employee", "attendance"])],
  ["role", "how do parents sign in the first time", S(["parent-sign-in", "invit", "family"])],
  ["role", "how do I link a parent to a student", S(["famil", "guardian", "parent"])],
  ["task", "post report cards to the parent portal", S(["report-card", "report-settings"])],
  ["task", "print a transcript", S(["transcript", "report"])],
  ["task", "promote students to the next grade", S(["promot", "graduat"])],
  ["task", "take attendance for my class", S(["attendance"])],
  ["task", "set up the school year and terms", S(["school-year", "term"])],
  ["task", "move our data from PowerSchool", S(["migrat", "powerschool"])],
  ["task", "build my own form for parents to fill in", S(["custom"])],
  ["task", "change the grading scale", S(["grading"])],
  ["task", "connect Google Classroom", S(["google", "integration"])],
  ["task", "track the bus live", S(["live-bus", "tracking"])],
  ["task", "set up online admission on our website", S(["admission", "website"])],
  ["task", "email all parents of one class", S(["mail", "message", "communic", "text"])],
  ["task", "why did my parent invite email not arrive", S(["email", "invit", "family"])],
  ["task", "export a list of students to Excel", S(["report-builder", "export", "student"])],
  ["task", "see who has not paid fees", S(["paygira", "arrears"])],
  ["task", "add a new teacher account", S(["employee", "staff"])],
  ["task", "how do I reset a teacher's password", S(["password", "employee", "sign-in"])],
  ["task", "create a test for grade 6 science", S(["assessment", "test", "grading"])],
  ["task", "what do parents see of the gradebook", S(["parent-grades", "grading"])],
  ["task", "bus route not showing for a student", S(["transport", "route"])],
  ["task", "add a district hub school", S(["hub", "district"])],
  ["task", "get an API token", S(["api", "integration", "token"])],
  ["task", "lunch attendance for a class", S(["attendance", "lunch", "class-settings"])],
];
manual.forEach(([cat, text, accept]) => {
  if (!accept.length) return;
  questions.push({ category: cat, text, accept, audience: cat === "role" && /parent|child|student/i.test(text) ? (/student|test/i.test(text) ? "student" : "parent") : /driver/i.test(text) ? "driver" : "staff" });
});

// Questions that should find nothing.
const outOfScope = [
  "what is the weather in Accra tomorrow", "write me a poem about the sea", "who won the world cup in 2010", "capital of Australia",
  "tell me a joke", "translate hello into french", "what's 17 times 23", "recommend a good pizza restaurant", "how tall is mount everest",
  "best way to cook jollof rice", "who is the president of france", "explain quantum entanglement", "zxqv blorptastic wumbo",
  "what time is the football match", "how do I fix my car engine", "plan my holiday to spain",
];

// ---------- running ----------
function oldMethod(q) {
  if (!HOW_TO.test(q.text)) return { returned: false, slugs: [] };
  const usable = (r) => r && r.type === "answer" && (r.confidence === "sure" || r.confidence === "likely") && String(r.source.url || "").startsWith("/legal/user-documentation/");
  let result = null;
  if (q.audience === "staff" && !ABOUT_FAMILIES.test(q.text)) {
    const staff = ask(q.text, rows.filter((r) => !FAMILY_GUIDES.has(r.topic)));
    if (usable(staff)) result = staff;
  }
  if (!result) { const all = ask(q.text, rows); if (usable(all)) result = all; }
  if (!result) return { returned: false, slugs: [] };
  const slug = result.source.url.replace("/legal/user-documentation/", "").replace(/#.*$/, "");
  return { returned: true, slugs: [slug] };
}
function newMethod(q) {
  const results = helpSearch.searchGuides(q.text, { audience: q.audience, limit: 5 });
  return { returned: results.length > 0, slugs: results.map((r) => r.slug), top: results[0] };
}

function run({ withOld = true } = {}) {
  helpSearch.resetForTests();
  helpSearch.sharedIndex();
  const stats = { old: { any: 0, k1: 0, k3: 0, k5: 0 }, new: { any: 0, k1: 0, k3: 0, k5: 0 } };
  const byCat = {};
  const misses = [];
  let slowest = 0;
  const times = [];
  questions.forEach((q) => {
    const o = withOld ? oldMethod(q) : { returned: false, slugs: [] };
    const t = process.hrtime.bigint();
    const n = newMethod(q);
    const ms = Number(process.hrtime.bigint() - t) / 1e6;
    times.push(ms); slowest = Math.max(slowest, ms);
    const hit = (r, k) => r.slugs.slice(0, k).some((s) => q.accept.includes(s));
    [["old", o], ["new", n]].forEach(([key, r]) => {
      if (r.returned) stats[key].any += 1;
      [1, 3, 5].forEach((k) => { if (hit(r, k)) stats[key][`k${k}`] += 1; });
    });
    const c = (byCat[q.category] = byCat[q.category] || { n: 0, k1: 0, k3: 0, any: 0, oldAny: 0, oldK1: 0 });
    c.n += 1; if (hit(n, 1)) c.k1 += 1; if (hit(n, 3)) c.k3 += 1; if (n.returned) c.any += 1; if (o.returned) c.oldAny += 1; if (hit(o, 1)) c.oldK1 += 1;
    if (!hit(n, 3)) misses.push({ q, got: n.slugs.slice(0, 3) });
  });
  const falsePositives = outOfScope.filter((text) => helpSearch.searchGuides(text, { audience: "staff", limit: 3 }).length > 0);
  times.sort((a, b) => a - b);
  return { total: questions.length, stats, byCat, misses, falsePositives, outOfScope: outOfScope.length, p50: times[Math.floor(times.length / 2)], p95: times[Math.floor(times.length * 0.95)], slowest };
}

module.exports = { run, questions, outOfScope, rows };

if (require.main === module) {
  const r = run();
  const pct = (a) => `${((100 * a) / r.total).toFixed(1)}%`;
  console.log(`Questions: ${r.total} over ${rows.length} guides (+ ${r.outOfScope} out-of-scope)\n`);
  console.log("method  returns any guide   top-1     top-3     top-5");
  console.log(`OLD     ${pct(r.stats.old.any).padEnd(18)}  ${pct(r.stats.old.k1).padEnd(8)}  ${pct(r.stats.old.k3).padEnd(8)}  ${pct(r.stats.old.k5)}`);
  console.log(`NEW     ${pct(r.stats.new.any).padEnd(18)}  ${pct(r.stats.new.k1).padEnd(8)}  ${pct(r.stats.new.k3).padEnd(8)}  ${pct(r.stats.new.k5)}`);
  console.log("\nby kind of question (new: top-1 / top-3 / any; old: any / top-1)");
  Object.entries(r.byCat).forEach(([k, c]) => console.log(`  ${k.padEnd(8)} n=${String(c.n).padEnd(4)} ${((100 * c.k1) / c.n).toFixed(0).padStart(3)}% ${((100 * c.k3) / c.n).toFixed(0).padStart(3)}% ${((100 * c.any) / c.n).toFixed(0).padStart(3)}%   old ${((100 * c.oldAny) / c.n).toFixed(0).padStart(3)}% ${((100 * c.oldK1) / c.n).toFixed(0).padStart(3)}%`));
  console.log(`\nout-of-scope questions answered with a guide: ${r.falsePositives.length}/${r.outOfScope}${r.falsePositives.length ? `  (${r.falsePositives.join(" | ")})` : ""}`);
  console.log(`speed per search: p50 ${r.p50.toFixed(1)} ms, p95 ${r.p95.toFixed(1)} ms, slowest ${r.slowest.toFixed(1)} ms`);
  if (process.argv.includes("--misses")) r.misses.slice(0, 80).forEach((m) => console.log(`MISS [${m.q.category}/${m.q.audience}] "${m.q.text}" want ${m.q.accept.slice(0, 3).join(",")} got ${m.got.join(",")}`));
}
