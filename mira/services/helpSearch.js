"use strict";

// Mira's look through ALL of Managira's help guides (the same ones the help center shows).
//
//   searchGuides(query, { audience, limit, context })  the best sections, one per guide, ranked
//   guideContext({ question, previous, viewerType })    a short block of excerpts for the prompt
//   guideText(slugOrUrl, { section, maxChars })         the whole of one guide, as text
//
// Pure and in memory: no database, no network, no model. The guides are read from code
// (utils/docs/catalog), cut into sections (a heading with its steps, notes and table rows; each
// FAQ question is its own section), and scored with BM25 over the guide title, keywords, topic,
// section heading and text. On top of that: the words people type mapped to the words the guides
// use (synonyms and menu names), phrase boosts, small typos corrected against the guides' own
// vocabulary, and a nudge toward the guides written for the person's own role (never excluding
// the others). The index is built once, and again when the guides change.

const fs = require("fs");
const path = require("path");

let askDocs = null;
function docs() {
  if (!askDocs) askDocs = require("../../utils/docs/askDocs");
  return askDocs;
}

const DOC_ROOT = "/legal/user-documentation/";

// ---------- words ----------
// What a person types, to what the guides say. Each line is words that mean the same here; a
// match on one counts a little less than the word itself. Only single words (after the guides'
// own phrase joining: "report card" is "reportcard", "log in" is "signin") start a match; longer
// phrases are what it expands to.
const GROUPS = [
  ["grade", "mark", "score", "result", "gradebook", "grading"],
  ["student", "pupil", "learner", "child", "kid", "kids", "children"],
  ["absent", "absence", "attendance", "truancy", "present", "tardy", "late", "roll call"],
  ["teacher", "staff", "employee", "instructor", "educator", "faculty", "worker"],
  ["fee", "payment", "paygira", "bill", "invoice", "tuition", "charge", "owe", "arrears", "balance", "receipt"],
  ["reportcard", "transcript", "report card", "terminal report", "merit sheet"],
  ["parent", "guardian", "family", "mom", "dad", "mother", "father"],
  ["signin", "login", "password", "credentials", "sign in"],
  ["add", "create", "new", "register", "make", "setup", "set up"],
  ["delete", "remove", "erase", "discard", "trash"],
  ["class", "classroom", "homeroom", "grade level", "form"],
  ["bus", "transportation", "transport", "driver", "route", "stop", "shuttle"],
  ["sms", "text", "textmessage", "message", "messaging"],
  ["mailroom", "message", "inbox", "mail room"],
  ["email", "mail"],
  ["edit", "change", "update", "modify", "rename", "correct"],
  ["permission", "role", "access", "privilege", "right"],
  ["website", "site", "webpage", "web site"],
  ["notification", "alert", "notify", "remind", "reminder"],
  ["exam", "test", "quiz", "assessment", "homework", "assignment"],
  ["lunch", "meal", "cafeteria", "food"],
  ["timetable", "schedule", "period", "lesson"],
  ["calendar", "event", "holiday", "date"],
  ["export", "download", "excel", "csv", "spreadsheet", "pdf"],
  ["import", "upload", "bulk", "migrate", "migration", "transfer in"],
  ["admission", "application", "apply", "applicant", "enrol", "enroll", "enrollment", "enrolment"],
  ["promotion", "promote", "graduate", "graduation", "repeat", "advance"],
  ["pickup", "dismissal", "collect", "pick up"],
  ["price", "cost", "pricing", "plan", "subscription", "renewal", "billing", "cheap", "expensive"],
  ["forget", "reset", "lose", "recover", "locked", "lockout", "forgot"],
  ["sso", "saml", "openid", "single signon", "google sign in", "microsoft"],
  ["verificationcode", "authenticator", "twostep", "two step", "2fa", "two factor", "verification"],
  ["mira", "assistant", "ai", "chatbot", "bot"],
  ["form", "customform", "custom form", "questionnaire", "survey"],
  ["dashboard", "home", "homepage", "overview"],
  ["hub", "district", "network", "multi school"],
  ["integration", "connect", "connection", "link up", "sync", "google classroom", "api"],
  ["remark", "comment", "feedback note"],
  ["signature", "sign off", "stamp"],
  ["archive", "alumni", "graduated"],
  ["school year", "academic year", "session", "term", "semester", "trimester", "quarter"],
  ["print", "printout", "printing"],
  ["photo", "picture", "image", "gallery"],
  ["birthday", "birth date", "dob"],
  ["contact", "phone", "phone number", "address"],
  ["activity", "club", "extracurricular"],
  ["task", "todo", "to do"],
];

// Menu and page names people copy from the screen, and what the guides call them.
const MENU_NAMES = [
  [/class\s*(?:&|and)\s*notif\w*\.?\s*settings?|class settings/i, "class settings notification"],
  [/attendance\s*(?:&|and)\s*lunch/i, "attendance lunch class"],
  [/report remarks?/i, "report remark comment"],
  [/mail\s*room/i, "mailroom message"],
  [/custom editor/i, "custom editor form"],
  [/page finder|ctrl\s*k|cmd\s*k/i, "page finder search"],
  [/management tools?/i, "management hub"],
  [/users?\s*\/\s*employees?|users and employees/i, "employee account permission"],
  [/billing\s*(?:&|and)\s*plan/i, "billing plan subscription"],
  [/data migration/i, "migration sandbox import"],
  [/two[\s-]*step sign[\s-]*in/i, "twostep verification authenticator"],
  [/service accounts?/i, "service account api token"],
  [/pay\s*gira/i, "paygira bill payment"],
  [/\bhow much\b|\bpric(?:e|es|ing)\b|\bcosts?\b|\bper (?:student|school|year|term)\b|\bfree trial\b/i, "price subscription renewal plan"],
  [/\b(?:on|from|in) (?:a |my |the )?(?:phone|mobile|tablet|ipad|iphone|android)\b|\bmobile app\b|\bhome screen\b/i, "install device app"],
];

const SYN_WEIGHT = 0.45;

function norm(text) {
  return docs().keyWords(text);
}

// word -> [{ token, weight }] built once from GROUPS.
let synMap = null;
function synonyms() {
  if (synMap) return synMap;
  synMap = new Map();
  const put = (from, to) => {
    if (!synMap.has(from)) synMap.set(from, new Set());
    to.forEach((t) => { if (t !== from) synMap.get(from).add(t); });
  };
  GROUPS.forEach((group) => {
    const elements = group.map((entry) => norm(entry)).filter((tokens) => tokens.length);
    const singles = elements.filter((tokens) => tokens.length === 1).map((tokens) => tokens[0]);
    const all = [...new Set(elements.flat())];
    singles.forEach((single) => put(single, all));
  });
  return synMap;
}

// ---------- the guides, as sections ----------
const clean = (s) => String(s || "").replace(/\s+/g, " ").trim();
const sentence = (s) => { const t = clean(s); return t ? t.charAt(0).toUpperCase() + t.slice(1) : ""; };
const decodeHtml = (s) => String(s || "").replace(/<[^>]+>/g, " ").replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;/g, "'");

// Plain markdown to the HTML shape the guides use, for the extra documents (what Mira can do,
// what Managira is).
function markdownToHtml(md) {
  const out = [];
  let list = null;
  const close = () => { if (list) { out.push(`</${list}>`); list = null; } };
  const escape = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  String(md || "").split(/\r?\n/).forEach((raw) => {
    const line = raw.trim();
    if (!line) { close(); return; }
    const bullet = line.match(/^[-*]\s+(.*)$/);
    const numbered = line.match(/^\d+[.)]\s+(.*)$/);
    const heading = line.match(/^(#{1,4})\s+(.*)$/);
    if (heading) { close(); out.push(heading[1].length <= 2 ? `<h2>${escape(heading[2])}</h2>` : `<h3>${escape(heading[2])}</h3>`); return; }
    if (bullet) { if (list !== "ul") { close(); out.push("<ul>"); list = "ul"; } out.push(`<li>${escape(bullet[1])}</li>`); return; }
    if (numbered) { if (list !== "ol") { close(); out.push("<ol>"); list = "ol"; } out.push(`<li>${escape(numbered[1])}</li>`); return; }
    close();
    out.push(`<p>${escape(line.replace(/^>\s*/, ""))}</p>`);
  });
  close();
  return out.join("");
}

function readIf(file) {
  try { return fs.readFileSync(file, "utf8"); } catch (_) { return ""; }
}

// Documents that are not guides but answer real questions: Mira's own capability list and the
// public product overview. They link to the matching public page.
function extraRows() {
  const rows = [];
  const capabilities = readIf(path.join(__dirname, "..", "CAPABILITIES.md"));
  if (capabilities) {
    rows.push({
      slug: "mira-capabilities-list", title: "What Mira can do: the full list", topic: "Mira AI assistant", extra: true,
      url: `${DOC_ROOT}mira-ai-capabilities`, tags: ["mira", "capabilities", "what can mira do", "what can i ask", "examples"],
      seoDescription: "Everything Mira can look up and change, and what it deliberately does not do.",
      contentHtml: markdownToHtml(capabilities.replace(/`/g, "")),
    });
  }
  const overview = readIf(path.join(__dirname, "..", "..", "public", "llms-full.txt")) || readIf(path.join(__dirname, "..", "..", "public", "llms.txt"));
  if (overview) {
    rows.push({
      slug: "about-managira", title: "About Managira: what it does and what it costs", topic: "Getting started", extra: true,
      url: DOC_ROOT.slice(0, -1), tags: ["managira", "what does managira do", "overview", "features", "pricing", "plans", "demo"],
      seoDescription: "What Managira is, what it covers, and where to see plans and pricing.",
      contentHtml: markdownToHtml(overview),
    });
  }
  return rows;
}

// One guide's pieces grouped into sections: { heading, anchor, faq, lines: [{ kind, text, list }] }.
function sectionsOf(row) {
  const pieces = docs().piecesOf(row);
  const sections = [];
  const byKey = new Map();
  pieces.forEach((piece) => {
    let heading = piece.heading || "";
    let anchor = piece.anchor || "";
    const faq = piece.kind === "faq";
    if (piece.kind === "summary" || !heading) { heading = ""; anchor = ""; }
    const key = `${faq ? "q" : "s"}|${heading}|${anchor}`;
    let section = byKey.get(key);
    if (!section) {
      section = { heading, anchor, faq, lines: [] };
      byKey.set(key, section);
      sections.push(section);
    }
    section.lines.push({ kind: piece.kind, text: clean(piece.text), list: piece.list || 0 });
  });
  return sections;
}

// A section as text: numbered steps, bullets, paragraphs, within a character budget.
function renderLines(section, maxChars) {
  const lines = [];
  let count = 0;
  let lastList = -1;
  let n = 0;
  let used = 0;
  for (const line of section.lines) {
    if (line.kind === "summary" && section.lines.length > 1) continue;
    let text;
    if (line.kind === "step") { n = line.list === lastList ? n + 1 : 1; lastList = line.list; text = `${n}. ${sentence(line.text)}`; } else if (line.kind === "item" || line.kind === "row") { text = `- ${sentence(line.text)}`; } else { text = sentence(line.text); }
    if (used + text.length > maxChars) {
      if (!lines.length) lines.push(`${text.slice(0, Math.max(60, maxChars - 1)).trimEnd()}…`);
      else lines.push("…");
      break;
    }
    lines.push(text);
    used += text.length + 1;
    count += 1;
  }
  return count ? lines : lines;
}

// ---------- the index ----------
const K1 = 1.2;
const B = 0.5;
const W = { title: 3, tags: 2.5, topic: 0.5, heading: 3.2, body: 1 };
const FAMILY_TOPICS = new Set(["Parent portal", "Student portal", "Parents & families"]);
const FAMILY_ONLY = new Set(["Parent portal", "Student portal"]);
const DRIVER_TOPICS = new Set(["Driver app"]);
const ADMIN_TOPICS = new Set(["Billing & subscriptions", "Integrations & API", "Staff & permissions", "Account & sign-in", "Districts & hubs", "School setup", "Moving to Managira"]);

function buildIndex(rows) {
  const guides = [];
  const sections = [];
  const df = new Map();
  const vocab = new Map();
  const seen = new Set();
  (rows || []).forEach((row) => {
    if (!row || !row.slug || !row.title || seen.has(row.slug)) return;
    seen.add(row.slug);
    const guide = {
      slug: row.slug, title: row.title, topic: row.topic || "", url: row.url || `${DOC_ROOT}${row.slug}`, extra: Boolean(row.extra),
      summary: clean(row.seoDescription), family: FAMILY_TOPICS.has(row.topic), familyOnly: FAMILY_ONLY.has(row.topic), sections: [],
    };
    const titleTokens = norm(row.title);
    const tagTokens = norm([...(row.tags || []), ...(row.keywords || [])].join(" "));
    const topicTokens = norm(row.topic || "");
    let secs;
    try { secs = sectionsOf(row); } catch (_) { secs = []; }
    secs.forEach((sec) => {
      const headingText = sec.faq ? sec.heading : sec.heading;
      const headTokens = norm(headingText);
      const bodyTokens = norm(sec.lines.map((l) => l.text).join(" "));
      const tf = new Map();
      const add = (tokens, weight) => tokens.forEach((t) => tf.set(t, (tf.get(t) || 0) + weight));
      add(titleTokens, W.title); add(tagTokens, W.tags); add(topicTokens, W.topic); add(headTokens, W.heading); add(bodyTokens, W.body);
      const length = bodyTokens.length + headTokens.length * 2 + 12;
      const record = {
        guide, heading: sec.heading, anchor: sec.anchor, faq: sec.faq, lines: sec.lines, tf, length,
        // The heading as said (with the guide's title), for phrase matches.
        seqHead: ` ${[...titleTokens, "|", ...headTokens].join(" ")} `,
        seqBody: ` ${bodyTokens.join(" ")} `,
        headSet: new Set(headTokens), titleSet: new Set(titleTokens),
        anchorSet: new Set([...titleTokens, ...tagTokens, ...headTokens]),
        hasSteps: sec.lines.some((l) => l.kind === "step"),
        overview: !sec.heading && !sec.faq,
      };
      guide.sections.push(record);
      sections.push(record);
      tf.forEach((_v, t) => { df.set(t, (df.get(t) || 0) + 1); });
    });
    // One vocabulary entry per guide for each word, for correcting typos.
    const guideWords = new Set();
    guide.sections.forEach((s) => s.tf.forEach((_v, t) => guideWords.add(t)));
    guideWords.forEach((t) => vocab.set(t, (vocab.get(t) || 0) + 1));
    if (guide.sections.length) guides.push(guide);
  });
  const n = sections.length;
  const idf = (t) => { const d = df.get(t) || 0; return d ? Math.log(1 + (n - d + 0.5) / (d + 0.5)) : 0; };
  const avg = sections.reduce((sum, s) => sum + s.length, 0) / Math.max(1, n);
  return { guides, sections, vocab, df, idf, avg, bySlug: new Map(guides.map((g) => [g.slug, g])), typoCache: new Map() };
}

// ---------- typos ----------
function editDistance(a, b, limit) {
  if (Math.abs(a.length - b.length) > limit) return limit + 1;
  let prev2 = null;
  let prev = Array.from({ length: b.length + 1 }, (_v, j) => j);
  for (let i = 1; i <= a.length; i++) {
    const row = [i];
    let best = i;
    for (let j = 1; j <= b.length; j++) {
      let d = Math.min(prev[j] + 1, row[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
      if (prev2 && i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) d = Math.min(d, prev2[j - 2] + 1);
      row.push(d);
      best = Math.min(best, d);
    }
    if (best > limit) return limit + 1;
    prev2 = prev;
    prev = row;
  }
  return prev[b.length];
}

// The guides' word a misspelt word most likely means, or null.
function correct(index, word) {
  if (index.typoCache.has(word)) return index.typoCache.get(word);
  const limit = word.length >= 8 ? 2 : 1;
  let best = null;
  index.vocab.forEach((count, known) => {
    if (known.length < 4 || Math.abs(known.length - word.length) > limit) return;
    const d = editDistance(word, known, limit);
    if (d > limit) return;
    if (!best || d < best.d || (d === best.d && count > best.count)) best = { known, d, count };
  });
  const result = best ? best.known : null;
  if (index.typoCache.size > 5000) index.typoCache.clear();
  index.typoCache.set(word, result);
  return result;
}

// ---------- the query ----------
// Words that say nothing about the subject (the guides' own list does not cover these).
const EXTRA_STOP = new Set(["cannot", "unable", "anyone", "someone", "everyone", "everything", "something", "anything", "all", "one", "every", "each", "some", "many", "more", "most", "other", "only", "very", "much", "lot", "same", "let", "put", "give", "make", "again", "already", "now", "today", "yet", "sure", "like", "etc", "per", "via", "kind", "sort"]);
const GENERIC = new Set(["add", "create", "new", "set", "use", "change", "edit", "update", "find", "see", "open", "show", "start", "turn", "put", "give", "take", "work", "look", "check", "manage", "setup", "generate", "make", "view", "get"]);
const FAMILY_WORDS = /\b(?:parents?|guardians?|famil(?:y|ies)|students?|children|child|kids?|pupils?|mom|dad)\b/i;
const FAMILY_ACTS = /\b(?:see|view|open|find|get|pay|sign in|log in|login|download|read|reply|submit|use|access|check|track|take|join|message)\b/i;

// Concepts: each asked word with the words that mean the same, each with a weight.
function conceptsOf(index, text, weight) {
  let raw = String(text || "");
  const extras = [];
  MENU_NAMES.forEach(([pattern, add]) => { if (pattern.test(raw)) extras.push(add); });
  const rawWords = raw.toLowerCase().replace(/[’']/g, "").match(/[a-z0-9]+/g) || [];
  // Misspelt words are read as the nearest word the guides use, before anything else.
  const stems = new Map();
  rawWords.forEach((w) => { stems.set(w, docs().stem(w)); });
  const fixed = rawWords.map((w) => {
    const s = stems.get(w);
    if (w.length < 5 || /\d/.test(w) || index.vocab.has(s) || index.vocab.has(w) || synonyms().has(s)) return w;
    return correct(index, s) || w;
  });
  raw = fixed.join(" ") + " " + extras.join(" ");
  const tokens = norm(raw).filter((t) => !EXTRA_STOP.has(t) && !/^\d+$/.test(t));
  const seenTok = new Set();
  const concepts = [];
  let unknown = 0;
  const syn = synonyms();
  tokens.forEach((t) => {
    if (seenTok.has(t)) return;
    seenTok.add(t);
    const members = [{ t, w: 1 }];
    (syn.get(t) ? [...syn.get(t)] : []).forEach((alt) => { if (index.idf(alt) > 0) members.push({ t: alt, w: SYN_WEIGHT }); });
    // A word the guides never use and nothing replaces carries no weight.
    if (!members.some((m) => index.idf(m.t) > 0)) { if (!GENERIC.has(t)) unknown += 1; return; }
    concepts.push({ t, members, weight: weight * (GENERIC.has(t) ? 0.55 : 1) });
  });
  return { concepts, tokens, unknown };
}

// ---------- scoring ----------
function bm25(index, section, token) {
  const f = section.tf.get(token);
  if (!f) return 0;
  return index.idf(token) * (f * (K1 + 1)) / (f + K1 * (1 - B + B * (section.length / index.avg)));
}

function dice(a, b) {
  if (!a.size || !b.size) return 0;
  let both = 0;
  a.forEach((t) => { if (b.has(t)) both += 1; });
  return (2 * both) / (a.size + b.size);
}

function scoreSection(index, section, concepts, bigrams, qset, unknownWorth) {
  let sum = 0;
  let covered = 0;
  let total = unknownWorth;
  let anchored = 0;
  concepts.forEach((c) => {
    let best = 0;
    c.members.forEach((m) => { const s = bm25(index, section, m.t) * m.w; if (s > best) best = s; });
    // How much a concept is worth: its idf, so a rare word missing costs more than a common one.
    const worth = c.weight * Math.max(0.2, index.idf(c.t) || index.idf(c.members[0].t));
    total += worth;
    if (best > 0) {
      sum += best * c.weight;
      // Said by the guide itself (not just a synonym) counts fully toward coverage.
      const own = section.tf.has(c.t);
      covered += own ? worth : worth * 0.6;
      if (!GENERIC.has(c.t) && c.members.some((m) => section.anchorSet.has(m.t))) anchored += 1;
    }
  });
  // Two asked words in a row, as the heading or text says them.
  let phrase = 0;
  bigrams.forEach(([a, b, weight]) => {
    const pair = ` ${a} ${b} `;
    if (section.seqHead.includes(pair)) phrase += 1.6 * weight;
    else if (section.seqBody.includes(pair)) phrase += 0.6 * weight;
  });
  // The question is (nearly) the guide's title or the section's heading.
  const fit = total - unknownWorth;
  const bonus = fit * (FIT_TITLE * dice(qset, section.titleSet) ** 2 + FIT_HEAD * dice(qset, section.headSet) ** 2);
  const coverage = total ? covered / total : 0;
  return { score: (sum + phrase + bonus) * (0.45 + 0.55 * coverage), coverage, raw: sum, anchored };
}

function bigramsOf(tokens, weight) {
  const out = [];
  for (let i = 0; i + 1 < tokens.length; i++) out.push([tokens[i], tokens[i + 1], weight]);
  return out;
}

function audienceFactor(guide, audience, familyAsked) {
  const a = String(audience || "staff").toLowerCase();
  if (guide.extra) return 0.9;
  if (a === "parent" || a === "student" || a === "family" || a === "guardian") {
    if (guide.familyOnly) return a === "student" ? (/student/i.test(guide.topic) ? 1.3 : 1.1) : (/parent/i.test(guide.topic) ? 1.3 : 1.1);
    if (guide.family) return 1.2;
    return 0.85;
  }
  if (a === "driver") return DRIVER_TOPICS.has(guide.topic) ? 1.3 : (guide.familyOnly ? 0.9 : 1);
  // Staff and admins: the staff guides first, family guides when the question is about families.
  if (guide.familyOnly) return familyAsked ? 1.05 : 0.8;
  if (a === "admin" && ADMIN_TOPICS.has(guide.topic)) return 1.08;
  return 1;
}

const MIN_COVERAGE = 0.55;
const HOW_TO = /^\s*(how|where|which (?:page|menu|button)|can (?:i|we|you|a|parents?|teachers?|students?|staff)|why (?:can't|cannot|cant|isn't|doesn't|won't)|i (?:can't|cannot|need|want|have)|steps?\b|help me)\b|\bhow (?:do|can|to|does)\b/i;
const WHAT_IS = /^\s*(?:what\s+(?:is|are|does)|what's|explain|tell me about)\b/i;
// A how-to question is answered best by the part with steps; a "what is" by the overview.
function kindFactor(section, howTo, whatIs) {
  if (whatIs && section.overview) return 1.15;
  if (howTo && section.hasSteps) return 1.15;
  if (howTo && section.overview) return 0.88;
  return 1;
}
const FIT_TITLE = 0.9;
const FIT_HEAD = 1.1;

// The query is the current message; `context` is the turn before, counted for less.
function search(index, query, options = {}) {
  const limit = Math.max(1, Math.min(8, Number(options.limit) || 5));
  const audience = options.audience || "staff";
  const q = String(query || "").slice(0, 600);
  const main = conceptsOf(index, q, 1);
  if (!main.concepts.length) return [];
  let concepts = main.concepts;
  // A short follow-up ("and for parents?") borrows the words of the turn before.
  const prior = String(options.context || "").slice(0, 400);
  if (prior && main.concepts.length <= 3) {
    const have = new Set(concepts.map((c) => c.t));
    const extra = conceptsOf(index, prior, 0.5).concepts.filter((c) => !have.has(c.t));
    concepts = concepts.concat(extra);
  }
  const bigrams = bigramsOf(main.tokens, 1);
  const qset = new Set(main.concepts.map((c) => c.t));
  const unknownWorth = main.unknown * 2.2;
  const familyAsked = FAMILY_WORDS.test(q) && FAMILY_ACTS.test(q);
  const howTo = HOW_TO.test(q);
  const whatIs = WHAT_IS.test(q);
  // Candidate sections: any that has at least one asked word.
  const best = new Map();
  index.sections.forEach((section) => {
    // Cheap skip: no concept touches this section.
    let touched = false;
    for (const c of concepts) { for (const m of c.members) { if (section.tf.has(m.t)) { touched = true; break; } } if (touched) break; }
    if (!touched) return;
    const r = scoreSection(index, section, concepts, bigrams, qset, unknownWorth);
    const factor = audienceFactor(section.guide, audience, familyAsked) * kindFactor(section, howTo, whatIs);
    const score = r.score * factor;
    const entry = best.get(section.guide.slug) || { guide: section.guide, list: [] };
    entry.list.push({ section, score, coverage: r.coverage, anchored: r.anchored });
    best.set(section.guide.slug, entry);
  });
  const ranked = [];
  best.forEach((entry) => {
    entry.list.sort((a, b) => b.score - a.score);
    const top = entry.list[0];
    const second = entry.list[1] ? entry.list[1].score : 0;
    const next = entry.list[1] && entry.list[1].score >= top.score * 0.55 && entry.list[1].coverage >= MIN_COVERAGE ? entry.list[1].section : null;
    ranked.push({ guide: entry.guide, top, next, total: top.score + 0.2 * second, coverage: top.coverage, anchored: top.anchored });
  });
  ranked.sort((a, b) => b.total - a.total);
  if (!ranked.length) return [];
  const lead = ranked[0].total;
  const results = [];
  for (const r of ranked) {
    if (results.length >= limit) break;
    if (r.coverage < MIN_COVERAGE || !r.anchored) continue;
    if (r.total < lead * 0.3) break;
    const sec = r.top.section;
    results.push({
      slug: r.guide.slug, title: r.guide.title, topic: r.guide.topic, section: sec.heading && sec.heading !== r.guide.title ? sec.heading : "",
      anchor: sec.anchor, url: `${r.guide.url}${r.guide.extra ? "" : (sec.anchor ? `#${sec.anchor}` : "")}`, score: Number(r.total.toFixed(3)),
      coverage: Number(r.coverage.toFixed(3)), faq: sec.faq, _section: sec, _next: r.next, _guide: r.guide,
    });
  }
  return results;
}

// ---------- the shared index ----------
let shared = { signature: null, index: null };
function guideRows() {
  const rows = require("../../utils/docs/catalog").syncRows();
  return rows.concat(extraRows());
}
function signatureOf(rows) {
  let sum = 0;
  rows.forEach((row) => { sum += String(row.contentHtml || "").length + String(row.title || "").length; });
  return `${rows.length}:${sum}`;
}
function sharedIndex() {
  const rows = guideRows();
  const signature = signatureOf(rows);
  if (!shared.index || shared.signature !== signature) shared = { signature, index: buildIndex(rows) };
  return shared.index;
}
function resetForTests() { shared = { signature: null, index: null }; synMap = null; }

const publicResult = (r, withLines = false, maxChars = 700) => {
  const out = { title: r.title, topic: r.topic, section: r.section, url: r.url, slug: r.slug, score: r.score };
  if (withLines) out.lines = renderLines(r._section, maxChars);
  return out;
};

// searchGuides(query, { audience, limit, context, index }) -> [{ title, topic, section, url, slug, score, coverage, snippet }]
function searchGuides(query, options = {}) {
  const index = options.index || sharedIndex();
  return search(index, query, options).map((r) => ({
    slug: r.slug, title: r.title, topic: r.topic, section: r.section, url: r.url, score: r.score, coverage: r.coverage,
    snippet: renderLines(r._section, options.snippetChars || 320).join(" "),
  }));
}

// ---------- what goes into the prompt ----------
const CONTEXT_BUDGET = 3500;
const DATA_HINT_SCORE = 14;
const HEADING = "Relevant help guides (Managira's own documentation; the only source for menus, buttons and steps):";
const FOOTER = "Answer from these guides. End with the link(s) you used on their own lines as [Read the guide: Title](url). If they don't cover the question, say so plainly and use search_help_guides with different words or get_help_guide to read a whole guide before saying you can't find it. Never describe menus, buttons or steps that are in neither a guide nor a tool result.";
const NOT_A_QUESTION = /^\s*(?:y|yes|yep|yeah|no|nope|ok|okay|thanks?|thank you|sure|go ahead|confirm(?:ed)?|cancel|done|great|cool|perfect|hi|hello|hey)[\s.!?]*$/i;
// A question for the records ("which students ...", "how many ...") is for the tools.
const DATA_QUESTION = /^\s*(?:which|who|list|show me|show|give me|how many|count|what(?:'s| is| are) the (?:total|number|average)|find (?:me )?(?:all|the)?)\b[^?]*\b(?:students?|staff|teachers?|parents?|guardians?|classes|absent|late|owe\w*|unpaid|paid|scores?|grades?|fees?|bills?|riders?|buses|drivers?|forms?|today|this (?:week|term|month)|yesterday|overdue)\b/i;

function guideContext({ question, previous, viewerType = "staff", index, budget = CONTEXT_BUDGET, maxGuides = 4 } = {}) {
  const q = clean(question);
  if (!q || NOT_A_QUESTION.test(q) || norm(q).length === 0) return { text: "", results: [], size: 0 };
  const data = DATA_QUESTION.test(q);
  const audience = viewerType === "staff" ? "staff" : viewerType;
  const idx = index || sharedIndex();
  let results = search(idx, q, { audience, limit: maxGuides + 1, context: clean(previous) });
  if (!results.length) return { text: "", results: [], size: 0 };
  // A data question gets the tools first: a hint only when a guide is a clear match.
  if (data) {
    results = results.filter((r) => r.coverage >= 0.8 && r.score >= DATA_HINT_SCORE).slice(0, 1);
    if (!results.length) return { text: "", results: [], size: 0 };
  }
  const header = `${HEADING}\n`;
  let remaining = budget - header.length - FOOTER.length - 2;
  const blocks = [];
  const used = [];
  const picks = results.slice(0, maxGuides);
  picks.forEach((r, i) => {
    const sec = r._section;
    const share = i === 0 ? 1300 : Math.floor((remaining - 1300) / Math.max(1, picks.length - 1));
    const cap = Math.max(200, Math.min(i === 0 ? 1300 : 900, share, remaining - 120));
    if (remaining < 220) return;
    const where = r.section ? `${r.title} › ${r.section}` : r.title;
    const lines = renderLines(sec, cap - where.length - r.url.length - 20);
    if (!lines.length) return;
    const body = lines.join("\n");
    let block = `## ${where} (${r.url})\n${body}`;
    // The best guide also gives its next-best section when there is room.
    if (i === 0 && r._next && r._next.heading) {
      const more = renderLines(r._next, 500);
      const extra = `## ${r.title} › ${r._next.heading}\n${more.join("\n")}`;
      if (more.length && block.length + extra.length + 1 <= cap + 400) block += `\n${extra}`;
    }
    if (block.length > remaining) return;
    blocks.push(block);
    used.push(r);
    remaining -= block.length + 1;
  });
  if (!blocks.length) return { text: "", results: [], size: 0 };
  const text = `${header}${blocks.join("\n")}\n${FOOTER}`;
  return { text, results: used.map((r) => ({ title: r.title, section: r.section, url: r.url, score: r.score })), size: text.length };
}

// ---------- one whole guide ----------
function findGuide(index, ref) {
  const raw = clean(ref);
  if (!raw) return null;
  const slug = raw.replace(/^https?:\/\/[^/]+/i, "").replace(/[?#].*$/, "").replace(/^\/?legal\/user-documentation\/?/i, "").replace(/^\/+|\/+$/g, "");
  if (slug && index.bySlug.has(slug)) return index.bySlug.get(slug);
  // A link or slug that names no guide finds nothing; a title in words is matched loosely.
  if (!/\s/.test(raw)) return null;
  const hits = search(index, raw, { limit: 1 });
  return hits[0] ? index.bySlug.get(hits[0].slug) : null;
}

function guideText(ref, options = {}) {
  const index = options.index || sharedIndex();
  const maxChars = Math.max(500, Math.min(12000, Number(options.maxChars) || 6000));
  const guide = findGuide(index, ref);
  if (!guide) return null;
  const sections = guide.sections.slice();
  if (options.section) {
    const want = norm(options.section);
    const score = (s) => { const h = new Set(norm(s.heading)); return want.length ? want.filter((w) => h.has(w)).length / want.length : 0; };
    const focus = sections.map((s, i) => ({ s, i, v: score(s) })).filter((x) => x.v > 0).sort((a, b) => b.v - a.v || a.i - b.i)[0];
    if (focus) { sections.splice(focus.i, 1); sections.unshift(focus.s); }
  }
  const parts = [`${guide.title}${guide.topic ? ` (${guide.topic})` : ""}`, guide.summary].filter(Boolean);
  let used = parts.join("\n").length;
  let truncated = false;
  for (const sec of sections) {
    const lines = renderLines(sec, 1800);
    if (!lines.length) continue;
    const head = sec.faq ? `Q: ${sec.heading}` : (sec.heading ? `## ${sec.heading}` : "");
    const block = [head, ...(sec.faq ? lines.map((l) => `A: ${l}`) : lines)].filter(Boolean).join("\n");
    if (used + block.length + 2 > maxChars) { truncated = true; break; }
    parts.push(block);
    used += block.length + 2;
  }
  return { title: guide.title, topic: guide.topic, url: guide.url, slug: guide.slug, text: parts.join("\n\n") + (truncated ? "\n\n[Trimmed. Ask for a section by name to read the rest.]" : ""), truncated, sections: sections.map((s) => s.heading).filter(Boolean).slice(0, 60) };
}

module.exports = {
  searchGuides, guideContext, guideText, buildIndex, sharedIndex, guideRows, extraRows, resetForTests,
  CONTEXT_BUDGET, DOC_ROOT, GROUPS, norm, synonyms, renderLines,
};
