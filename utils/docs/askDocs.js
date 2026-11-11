"use strict";

// Answers a question from the help center, and only from it (the site chat, "Mira Assistant").
//
// Every guide is cut into the pieces a person would quote: each step, paragraph, list item,
// table row and FAQ answer, kept with its guide and heading. A question is matched against
// those pieces (BM25, with the words people actually type mapped to the words the guides use:
// "forgot" finds "Forgot password", "log in" finds "sign in", "mom" finds "parent"). The answer
// is the best piece in the guide's own words: the whole set of steps when it is a step, the
// FAQ answer when it is a question, with a link to that part of the guide. When nothing
// matches well enough, it says so and offers the closest guides instead of guessing.

const { plain } = require("./present");

const STOP = new Set(("a an and are as at be been but by can could did do does doing for from had has have how i if in into is it its "
  + "me my of on or our please should so that the their them then there these they this those to too us was we were what when where "
  + "which while who whom why will with would you your yours am any about also just get gets got happen happens happened "
  + "need needs want wants know tell way ways go going thing things there here able doesn dont don isn cant can't won't "
  + "managira help hi hey hello thanks thank ok okay being been still really").split(/\s+/));

// Words a person types, to the word the guides use.
const IRREGULAR = {
  forgot: "forget", forgotten: "forget", forgetting: "forget", lost: "lose", paid: "pay", sent: "send", taught: "teach",
  made: "make", gave: "give", given: "give", bought: "buy", children: "child", kids: "child", kid: "child", people: "person",
  wrote: "write", written: "write", chose: "choose", chosen: "choose", saw: "see", seen: "see", took: "take", taken: "take",
  ran: "run", began: "begin", begun: "begin", left: "leave", met: "meet", fell: "fall", held: "hold", shown: "show",
  grades: "grade", grading: "grade", graded: "grade", classes: "class", buses: "bus", addresses: "address",
  emailed: "email", emails: "email", texted: "text", texts: "text", logged: "signin", signed: "signin",
};
// Phrases first, so "log in", "sign in" and "login" all read as one word.
const PHRASES = [
  [/\b(log|sign)(ging|ing)?[\s-]*(in|on)\b|\blogin\b|\blogon\b|\bsignin\b/g, " signin "],
  [/\b(log|sign)[\s-]*out\b|\blogout\b|\bsignout\b/g, " signout "],
  [/\bsingle\s*sign[\s-]*on\b|\bsso\b|\bsaml\b|\bopenid\b|\boidc\b/g, " sso "],
  [/\btwo[\s-]*(factor|step)\b|\b2fa\b|\bverification\s+code\b|\bone[\s-]*time\s+code\b/g, " verificationcode "],
  [/\breport\s*cards?\b/g, " reportcard "],
  [/\bmain\s+teachers?\b|\bhomeroom\s+teachers?\b|\bteacher\s+in\s+charge\b/g, " mainteacher "],
  [/\bschool\s+years?\b|\bacademic\s+years?\b/g, " schoolyear "],
  [/\btext\s+messages?\b|\bsms\b/g, " sms message "],
  [/\bmail\s*room\b/g, " mailroom "],
  [/\bpay\s*gira\b/g, " paygira "],
  [/\bparent\s+portal\b/g, " parentportal "],
  [/\bstudent\s+portal\b/g, " studentportal "],
  [/\btesting\s+room\b/g, " testingroom "],
  [/\breport\s+builder\b/g, " reportbuilder "],
  [/\bgoogle\s+classroom\b/g, " googleclassroom "],
  [/\bservice\s+accounts?\b/g, " serviceaccount "],
  [/\b(personal\s+)?access\s+tokens?\b|\bapi\s+(keys?|tokens?)\b|\bclient\s+secrets?\b/g, " accesstoken "],
  [/\be[\s-]?mail\b/g, " email "],
  [/\bwhats\s*app\b/g, " whatsapp "],
  [/\bphone\s+numbers?\b/g, " phone "],
  [/\bpass\s*word\b/g, " password "],
];
// Words that mean the same thing here; a match on one of them counts a little less.
const GROUPS = [
  ["parent", "guardian", "family", "mom", "dad", "mother", "father"],
  ["student", "pupil", "learner", "child"],
  ["staff", "employee", "teacher", "worker", "user"],
  ["bill", "fee", "invoice", "tuition", "charge", "paygira", "payment"],
  ["pay", "payment", "paygira"],
  ["grade", "score", "mark", "result", "assessment"],
  ["delete", "remove", "erase"],
  ["add", "create", "new", "make", "generate"],
  ["arrive", "receive", "come", "deliver", "reach"],
  ["wait", "delay", "slow"],
  ["change", "edit", "update", "modify", "rename"],
  ["forget", "reset", "lose", "recover", "lockout"],
  ["bus", "transport", "transportation", "driver", "route"],
  ["attendance", "absent", "present", "late", "tardy", "absence"],
  ["class", "classroom", "homeroom"],
  ["term", "semester", "quarter", "trimester"],
  ["email", "mail"],
  ["message", "text", "sms", "whatsapp", "mailroom"],
  ["print", "pdf", "download", "export"],
  ["website", "site", "webpage"],
  ["calendar", "event", "schedule"],
  ["hub", "district"],
  ["price", "cost", "plan", "pricing", "subscription", "renewal"],
  ["test", "exam", "quiz", "assessment", "testingroom"],
  ["permission", "role", "access"],
  ["signin", "password", "account"],
  ["mira", "assistant", "ai"],
  ["app", "install", "phone", "mobile"],
];
const GENERIC = new Set(["make", "add", "create", "new", "set", "use", "change", "edit", "update", "find", "see", "open", "show", "start", "turn", "put", "give", "take", "work", "look", "check", "manage", "setup", "generate"]);
const ALTS = new Map();
GROUPS.forEach((group) => group.forEach((word) => {
  const set = ALTS.get(word) || new Set();
  group.forEach((other) => { if (other !== word) set.add(other); });
  ALTS.set(word, set);
}));

function stem(word) {
  let w = IRREGULAR[word] || word;
  if (w.length <= 4) return w;
  if (/ies$/.test(w)) return w.slice(0, -3) + "y";
  if (/(ss|us|is)$/.test(w)) return w;
  if (/ing$/.test(w) && w.length > 6) { w = w.slice(0, -3); return /(.)\1$/.test(w) && !/(ll|ss)$/.test(w) ? w.slice(0, -1) : w; }
  if (/ed$/.test(w) && w.length > 5) { w = w.slice(0, -2); return /(.)\1$/.test(w) && !/(ll|ss)$/.test(w) ? w.slice(0, -1) : w; }
  if (/es$/.test(w) && /(sh|ch|x|z)es$/.test(w)) return w.slice(0, -2);
  if (/s$/.test(w)) return w.slice(0, -1);
  return w;
}

function words(text) {
  let t = ` ${String(text || "").toLowerCase().replace(/[’']/g, "")} `;
  PHRASES.forEach(([pattern, replacement]) => { t = t.replace(pattern, replacement); });
  return t.replace(/[^a-z0-9]+/g, " ").split(" ").filter(Boolean).map((w) => IRREGULAR[w] || w).map(stem);
}
const keyWords = (text) => words(text).filter((w) => w.length > 1 && !STOP.has(w));

// ---------- the guides, cut into pieces ----------
const decode = (s) => String(s || "").replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">")
  .replace(/&quot;/g, '"').replace(/&#39;|&rsquo;|&lsquo;/g, "'").replace(/&ldquo;|&rdquo;/g, '"').replace(/&mdash;/g, "—").replace(/&ndash;/g, "–");
const textOf = (html) => decode(plain(String(html || "").replace(/<figure[\s\S]*?<\/figure>/g, " ")));
const anchorOf = (text) => textOf(text).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 60) || "section";

// The pieces of one guide, in order, each with its heading and the anchor of its section.
function piecesOf(article) {
  const html = String(article.contentHtml || "");
  const pieces = [];
  const used = new Set();
  let heading = "";
  let anchor = "";
  let faq = false;
  let question = "";
  let listIndex = 0;
  // Block-level parts in document order. Nested lists inside an item are rare; their text
  // stays with the item.
  const blocks = html.match(/<h2[^>]*>[\s\S]*?<\/h2>|<h3[^>]*>[\s\S]*?<\/h3>|<(ol|ul)[^>]*>[\s\S]*?<\/\1>|<table[^>]*>[\s\S]*?<\/table>|<p[^>]*>[\s\S]*?<\/p>|<pre[^>]*>[\s\S]*?<\/pre>/g) || [];
  const idFor = (inner) => {
    let id = anchorOf(inner);
    for (let n = 2; used.has(id); n += 1) id = `${anchorOf(inner)}-${n}`;
    used.add(id);
    return id;
  };
  blocks.forEach((block) => {
    const tag = block.slice(1, 3).toLowerCase();
    if (tag === "h2") {
      heading = textOf(block);
      anchor = idFor(block.replace(/^<h2[^>]*>|<\/h2>$/g, ""));
      faq = /frequently asked|questions/i.test(heading);
      question = "";
      return;
    }
    if (tag === "h3") {
      const id = idFor(block.replace(/^<h3[^>]*>|<\/h3>$/g, ""));
      if (faq) { question = textOf(block); anchor = anchor || id; return; }
      heading = textOf(block);
      anchor = id;
      return;
    }
    if (tag === "ol" || tag === "ul") {
      listIndex += 1;
      const items = (block.match(/<li[^>]*>[\s\S]*?<\/li>/g) || []).map(textOf).filter(Boolean);
      items.forEach((text, at) => pieces.push({ kind: tag === "ol" ? "step" : "item", text, heading, anchor, list: listIndex, at, of: items }));
      return;
    }
    if (tag === "ta") {
      const rows = (block.match(/<tr[^>]*>[\s\S]*?<\/tr>/g) || []).map((row) => (row.match(/<t[hd][^>]*>[\s\S]*?<\/t[hd]>/g) || []).map(textOf));
      const [head, ...body] = rows;
      body.forEach((cells) => {
        const text = cells.length >= 2 ? `${cells[0]}: ${cells.slice(1).join(" · ")}` : cells.join(" ");
        if (text.trim()) pieces.push({ kind: "row", text, heading: heading || (head || []).join(" "), anchor });
      });
      return;
    }
    const text = textOf(block);
    if (!text) return;
    if (faq && question) {
      pieces.push({ kind: "faq", text, heading: question, anchor });
      return;
    }
    pieces.push({ kind: tag === "pr" ? "code" : "para", text, heading, anchor });
  });
  // What the guide is about, for questions that name a whole subject.
  if (article.seoDescription) pieces.unshift({ kind: "summary", text: textOf(article.seoDescription), heading: article.title, anchor: "" });
  return pieces;
}

// ---------- the index ----------
// Two levels: which guide answers the question (its title, tags, summary, headings and text),
// then which part of that guide answers it (each piece's own words).
const K1 = 1.2;
const B = 0.6;
// Titles first, then keywords (a guide's tags and topic) and its section titles, then the rest.
const GUIDE_FIELDS = { title: 3, tags: 2.5, summary: 2, heading: 2.2, text: 1 };
const PIECE_HEADING = 1.5;

function bm25(idf, f, length, avg, b = B) {
  return f ? idf * (f * (K1 + 1)) / (f + K1 * (1 - b + b * (length / avg))) : 0;
}

function buildIndex(articles) {
  const guides = [];
  const pieces = [];
  const seenGuides = new Set();
  (articles || []).forEach((article) => {
    if (!article || !article.slug || !article.title) return;
    const sameKey = `${article.title}\n${String(article.seoDescription || "").slice(0, 80)}`;
    if (seenGuides.has(article.slug) || seenGuides.has(sameKey)) return;
    seenGuides.add(article.slug);
    seenGuides.add(sameKey);
    const tf = new Map();
    const add = (list, weight) => list.forEach((w) => tf.set(w, (tf.get(w) || 0) + weight));
    const own = piecesOf(article);
    let length = 0;
    add(keyWords(article.title), GUIDE_FIELDS.title);
    add(keyWords([...(article.tags || []), ...(article.keywords || [])].join(" ")), GUIDE_FIELDS.tags);
    add(keyWords([article.topic, article.subtopic].filter(Boolean).join(" ")), GUIDE_FIELDS.tags * 0.5);
    add(keyWords(article.seoDescription), GUIDE_FIELDS.summary);
    const headings = new Set();
    own.forEach((piece) => {
      if (piece.kind === "summary") return;
      if (piece.heading && !headings.has(piece.heading)) { headings.add(piece.heading); add(keyWords(piece.heading), GUIDE_FIELDS.heading); }
      const body = keyWords(piece.text);
      length += body.length;
      add(body, GUIDE_FIELDS.text);
    });
    const guide = {
      article, tf, length: Math.max(length, 20), titleWords: [...new Set(keyWords(article.title))], pieces: [],
      // Section titles and FAQ questions: a question that is one of them finds its guide.
      headingWords: [...headings].map((heading) => [...new Set(keyWords(heading))]).filter((list) => list.length),
    };
    own.forEach((piece) => {
      const ptf = new Map();
      const body = keyWords(piece.text);
      body.forEach((w) => ptf.set(w, (ptf.get(w) || 0) + 1));
      keyWords(piece.heading).forEach((w) => ptf.set(w, (ptf.get(w) || 0) + PIECE_HEADING));
      const entry = { guide, article, piece, tf: ptf, length: body.length + 4 };
      guide.pieces.push(entry);
      pieces.push(entry);
    });
    guides.push(guide);
  });
  const idfOf = (docs) => {
    const df = new Map();
    docs.forEach((doc) => doc.tf.forEach((_v, w) => df.set(w, (df.get(w) || 0) + 1)));
    return (w) => {
      const n = df.get(w) || 0;
      return n ? Math.log(1 + (docs.length - n + 0.5) / (n + 0.5)) : 0;
    };
  };
  const avg = (docs) => docs.reduce((sum, doc) => sum + doc.length, 0) / Math.max(1, docs.length);
  return { guides, pieces, guideIdf: idfOf(guides), pieceIdf: idfOf(pieces), guideAvg: avg(guides), pieceAvg: avg(pieces) };
}

let cached = { source: null, index: null };
function indexFor(articles) {
  if (cached.source !== articles || !cached.index) cached = { source: articles, index: buildIndex(articles) };
  return cached.index;
}

// How closely a question is one of these titles: how much of the question the title says and
// how much of the title is the question (a word that means the same counts in part).
function bestHeadingHit(headingWords, asked, askedTotal, askedWords, askedAlts) {
  let best = 0;
  for (const list of headingWords || []) {
    const words = new Set(list);
    const said = asked.reduce((sum, a) => sum + (words.has(a.w) ? a.n : a.alts.some((x) => words.has(x)) ? a.n * 0.5 : 0), 0) / (askedTotal || 1);
    const isAsked = list.reduce((sum, w) => sum + (askedWords.has(w) ? 1 : askedAlts.has(w) ? 0.4 : 0), 0) / list.length;
    best = Math.max(best, 0.6 * said + 0.4 * isAsked);
  }
  return best;
}

// ---------- asking ----------
const docUrl = (article, anchor) => `/legal/user-documentation/${article.slug}${anchor ? `#${anchor}` : ""}`;
const sentence = (text) => {
  const t = String(text || "").replace(/\s+/g, " ").trim();
  return t ? t.charAt(0).toUpperCase() + t.slice(1) : "";
};
const SMALL_TALK = /^(hi|hey|hello|good (morning|afternoon|evening)|thanks?( you)?|thank you|ok(ay)?|cool|great|bye)[!. ]*$/i;

// How well one document (a guide or a piece) answers the asked word groups: its score, and the
// share of what was asked that it says (a word that means the same counts in part).
function match(doc, groups, idf, avgLength, b = B) {
  let score = 0;
  let covered = 0;
  const total = groups.reduce((sum, g) => sum + g.weight, 0);
  groups.forEach((g) => {
    let best = bm25(idf(g.word), doc.tf.get(g.word) || 0, doc.length, avgLength, b) * g.scale;
    // The word itself said counts fully, whatever else matches; only a word that means the same, in part.
    let share = best > 0 ? 1 : 0;
    g.alts.forEach((a) => {
      const alt = bm25(idf(a), doc.tf.get(a) || 0, doc.length, avgLength, b) * 0.55 * g.scale;
      if (alt > best) { best = alt; if (!share) share = 0.5; }
    });
    score += best;
    covered += g.weight * share;
  });
  return { score, coverage: total ? covered / total : 0 };
}

// Questions whose answer is a page of the site, not a guide.
const PAGES = [
  { test: /\b(how much|price|prices|pricing|cost|costs|fee for managira|plans?)\b/i, unless: /\b(text|sms|whatsapp|bill|fee|tuition|parent|student|paygira|invoice|late fee|bus)\b/i,
    answer: { mode: "text", title: "Plans and prices", lines: ["Managira has three plans, Starter, Pro and Premium, each with a free trial. The Pricing page shows what each one includes and what it costs for your number of students."] },
    source: { title: "Pricing", url: "/pricing" } },
  { test: /\b(demo|talk to (sales|someone|a person)|contact (you|sales|support|managira)|support team|speak to)\b/i,
    answer: { mode: "text", title: "Talk to us", lines: ["Book a demo and we'll show you Managira with your own school's needs in mind, or write to info@managira.com."] },
    source: { title: "Request a demo", url: "/request-demo" } },
];

function ask(question, articles) {
  const q = String(question || "").trim().slice(0, 300);
  if (!q) return { type: "empty" };
  if (SMALL_TALK.test(q)) return { type: "small_talk" };
  const page = PAGES.find((entry) => entry.test.test(q) && !(entry.unless && entry.unless.test(q)));
  if (page) return { type: "answer", confidence: "sure", answer: page.answer, source: { ...page.source, section: "", excerpt: "" }, related: [] };
  const index = indexFor(articles);
  // One group per word asked: the word and the words that mean the same.
  const seen = new Set();
  const groups = [];
  keyWords(q).forEach((w) => {
    if (seen.has(w)) return;
    seen.add(w);
    const alts = [...(ALTS.get(w) || [])].filter((a) => !seen.has(a));
    let weight = index.guideIdf(w) || (alts.length ? Math.max(...alts.map(index.guideIdf)) * 0.6 : 0);
    // A word no guide uses can't be answered from them: it weighs heavily. Everyday verbs
    // ("make", "set", "change") say what to do, not what about: they count little.
    if (!weight) weight = 2.5;
    if (GENERIC.has(w)) weight = Math.min(weight, 0.5);
    groups.push({ word: w, alts, weight, scale: GENERIC.has(w) ? 0.4 : 1 });
  });
  if (!groups.length) return { type: "no_results" };
  // Everyday verbs count for a fraction of the words that say what the question is about.
  const aboutWeight = Math.max(0, ...groups.filter((g) => g.scale === 1).map((g) => g.weight));
  if (aboutWeight) groups.forEach((g) => { if (g.scale < 1) g.weight = Math.min(g.weight, 0.3 * aboutWeight); });
  const askedWords = new Set(groups.map((g) => g.word));
  const askedAlts = new Set(groups.flatMap((g) => g.alts));
  const howTo = /^\s*(how\b|what are the steps|steps to|where do i|can i\b)/i.test(q);
  const whatIs = /^\s*(what\s+(is|are)|what's|explain|tell me about)\b/i.test(q);

  // 1. The guides that answer it.
  const guides = index.guides.map((guide) => {
    const m = match(guide, groups, index.guideIdf, index.guideAvg, 0.25);
    // A guide whose title is what was asked ("Take a test", "Report cards") comes first.
    // Words common to every guide ("student", "class") barely count elsewhere, but in a title
    // they say what the guide is about: how much of the question the title says, and how much
    // of the title is the question, each word counted once (everyday verbs as half).
    const titleWords = new Set(guide.titleWords);
    const asked = groups.map((g) => ({ w: g.word, alts: g.alts, n: g.scale < 1 ? 0.5 : 1 }));
    const askedTotal = asked.reduce((sum, a) => sum + a.n, 0);
    const saidByTitle = asked.reduce((sum, a) => sum + (titleWords.has(a.w) ? a.n : a.alts.some((x) => titleWords.has(x)) ? a.n * 0.5 : 0), 0) / askedTotal;
    const titleIsAsked = guide.titleWords.length
      ? guide.titleWords.reduce((sum, w) => sum + (askedWords.has(w) ? 1 : askedAlts.has(w) ? 0.4 : 0), 0) / guide.titleWords.length
      : 0;
    const titleHit = Math.max(0.6 * saidByTitle + 0.4 * titleIsAsked, 0.5 * bestHeadingHit(guide.headingWords, asked, askedTotal, askedWords, askedAlts));
    return { guide, score: m.score * (1 + 0.5 * titleHit) + 4.5 * titleHit, coverage: m.coverage };
  }).filter((entry) => entry.score > 0).sort((a, b) => b.score - a.score);
  const closest = guides.slice(0, 3).map((entry) => ({ title: entry.guide.article.title, url: docUrl(entry.guide.article, "") }));
  if (!guides.length) return { type: "no_results", closest };

  // 2. The part of each of the top guides that answers it; the guide's place counts most.
  const top = guides.slice(0, 4);
  const topScore = top[0].score;
  const kindBoost = { faq: 1.1, step: howTo ? 1.35 : 1.05, item: 1.05, row: 1.03, para: 1, summary: whatIs ? 1.6 : 0.85, code: 0.8 };
  const candidates = [];
  top.forEach((entry) => {
    entry.guide.pieces.forEach((piece) => {
      const m = match(piece, groups, index.pieceIdf, index.pieceAvg);
      if (m.score <= 0 && piece.piece.kind !== "summary") return;
      const pieceScore = m.score * (kindBoost[piece.piece.kind] || 1);
      candidates.push({ entry, piece, pieceScore, pieceCoverage: m.coverage });
    });
  });
  if (!candidates.length) return { type: "no_results", closest };
  const bestPiece = Math.max(...candidates.map((c) => c.pieceScore)) || 1;
  // Within the guide that answers it, a part under a section title that says what was asked
  // counts a little more (it picks the section, not the guide).
  const askedList = groups.map((g) => ({ w: g.word, alts: g.alts, n: g.scale < 1 ? 0.5 : 1 }));
  const askedSum = askedList.reduce((sum, a) => sum + a.n, 0) || 1;
  candidates.forEach((c) => {
    const leading = c.entry.score >= topScore * 0.95;
    const heading = leading && c.piece.piece.heading && c.piece.piece.heading !== c.piece.article.title ? [...new Set(keyWords(c.piece.piece.heading))] : [];
    const headingHit = heading.length ? bestHeadingHit([heading], askedList, askedSum, askedWords, askedAlts) : 0;
    c.total = 0.7 * (c.entry.score / topScore) + 0.3 * (c.pieceScore / bestPiece) + 0.12 * headingHit;
  });
  candidates.sort((a, b) => b.total - a.total);
  let win = candidates[0];
  if (whatIs) {
    const summary = candidates.find((c) => c.entry === win.entry && c.piece.piece.kind === "summary" && c.pieceCoverage >= 0.5);
    if (summary) win = summary;
  }

  // Sure when the guide covers what was asked and its part covers most of it; likely when
  // they cover a good part of it (the reply says so); otherwise the closest guides, no guess.
  const coverage = 0.5 * win.entry.coverage + 0.5 * win.pieceCoverage;
  const confidence = win.entry.coverage >= 0.65 && coverage >= 0.55 ? "sure" : win.entry.coverage >= 0.5 && coverage >= 0.42 ? "likely" : "none";
  if (confidence === "none") {
    return { type: "no_results", closest, ...(process.env.ASK_DOCS_DEBUG ? { debug: { guides: guides.slice(0, 4).map((e) => `${e.guide.article.slug} ${e.score.toFixed(2)} cov ${e.coverage.toFixed(2)}`), piece: `${win.piece.piece.kind} ${win.pieceScore.toFixed(2)} cov ${win.pieceCoverage.toFixed(2)}` } } : {}) };
  }

  const { article, piece } = win.piece;
  const sameGuide = candidates.filter((c) => c.entry === win.entry).map((c) => ({ piece: c.piece.piece, coverage: c.pieceCoverage }));
  const answer = compose(piece, sameGuide, groups);
  const related = guides.filter((entry) => entry !== win.entry && entry.guide.article.title !== article.title)
    .filter((entry) => entry.score >= topScore * 0.55 && entry.coverage >= 0.55)
    .slice(0, 2)
    .map((entry) => ({ title: entry.guide.article.title, url: docUrl(entry.guide.article, ""), excerpt: entry.guide.article.seoDescription || "" }));
  return {
    type: "answer",
    confidence,
    answer,
    source: { title: article.title, topic: article.topic, url: docUrl(article, piece.anchor), section: piece.heading && piece.heading !== article.title ? piece.heading : "", excerpt: article.seoDescription || "" },
    related,
    coverage,
    ...(process.env.ASK_DOCS_DEBUG ? { debug: { guides: guides.slice(0, 4).map((e) => `${e.guide.article.slug} ${e.score.toFixed(2)} cov ${e.coverage.toFixed(2)}`), piece: `${win.piece.piece.kind} ${win.pieceScore.toFixed(2)} cov ${win.pieceCoverage.toFixed(2)}` } } : {}),
  };
}

// The answer, in the guide's own words.
function compose(piece, sameGuide, groups) {
  const heading = piece.heading || "";
  if (piece.kind === "faq") return { mode: "text", title: heading, lines: [sentence(piece.text)] };
  if (piece.kind === "step") {
    // The whole set of steps, so the person can follow it from the start.
    return { mode: "steps", title: heading, lines: piece.of.slice(0, 8).map(sentence) };
  }
  if (piece.kind === "item") {
    // The matching item, with the other items of the same list that also match.
    const items = sameGuide
      .filter((entry) => entry.piece.kind === "item" && entry.piece.list === piece.list && entry.coverage >= 0.34)
      .map((entry) => entry.piece)
      .sort((a, b) => a.at - b.at)
      .slice(0, 3);
    return { mode: items.length > 1 ? "bullets" : "text", title: heading, lines: (items.length ? items : [piece]).map((p) => sentence(p.text)) };
  }
  // A paragraph or row: it, and the next paragraph of the same section when it is short.
  const lines = [sentence(piece.text)];
  const next = sameGuide.map((entry) => entry.piece).find((p) => p !== piece && p.kind === "para" && p.heading === piece.heading && p.anchor === piece.anchor);
  if (piece.text.length < 140 && next && next.text.length < 260 && groups.some((g) => keyWords(next.text).includes(g.word))) lines.push(sentence(next.text));
  return { mode: "text", title: heading, lines };
}

module.exports = { ask, buildIndex, piecesOf, keyWords, words, stem };
