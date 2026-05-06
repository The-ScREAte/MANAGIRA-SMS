/**
 * Qualification analyzer for employment applications.
 *
 * Compares an applicant's cover letter + parsed resume text against
 * weighted keywords extracted from the job description and returns
 * a score (0-100), a recommendation, and supporting evidence.
 *
 * This is a heuristic — never a replacement for human review.
 */

// Common English stopwords + HR boilerplate that should never count as
// "skills" or "qualifications".
const STOPWORDS = new Set([
  "the","and","for","with","that","this","from","have","has","had","are","was",
  "were","will","would","should","could","may","might","must","into","onto",
  "over","under","about","above","below","across","after","before","between",
  "through","within","without","upon","each","every","some","such","than",
  "then","there","here","when","where","why","how","what","who","whom","which",
  "while","also","very","just","like","more","most","other","others","off",
  "out","own","per","via","etc","you","your","yours","our","ours","their",
  "they","them","its","but","not","any","all","can","or","of","to","in","on",
  "at","by","is","be","an","a","as","it","we","i","he","she","him","her","us",
  "my","me","do","does","did","done","go","going","get","got","make","made",
  "using","use","used","take","taken","provide","provided","providing","help",
  "helps","helping","need","needs","needed","want","wants","wanted","look",
  "looking","seeking","seek","seeks","including","include","includes",
  // HR boilerplate
  "job","jobs","role","roles","position","positions","candidate","candidates",
  "applicant","applicants","apply","applying","please","team","teams","year",
  "years","yr","experience","experienced","required","requirement",
  "requirements","preferred","plus","ability","abilities","able","based",
  "skill","skills","strong","good","excellent","great","ideal","responsibilities",
  "responsibility","duties","duty","work","working","worked","works","tasks",
  "task","day","daily","new","ensure","ensures","ensuring","general","various",
  "additional","company","organization","organisation","employer","staff",
  "employee","personnel","department","office","environment",
  // French stopwords + HR boilerplate (accents already stripped by normalize)
  "le","la","les","un","une","des","du","de","d","l","et","ou","mais",
  "donc","car","ni","que","qui","quoi","dont","ou","pour","par","avec",
  "sans","sous","sur","dans","chez","vers","entre","apres","avant","pendant",
  "depuis","jusqu","jusqua","selon","contre","ce","cet","cette","ces",
  "il","elle","ils","elles","on","nous","vous","je","tu","moi","toi","lui",
  "son","sa","ses","mon","ma","mes","ton","ta","tes","notre","nos","votre",
  "vos","leur","leurs","est","sont","etait","etaient","sera","seront","ete",
  "avoir","avons","avez","ont","ai","as","a","aura","auront","eu","etre",
  "faire","fait","faits","faite","faites","plus","moins","tres","aussi",
  "alors","ainsi","aussi","encore","deja","toujours","jamais","souvent",
  "bien","mal","si","non","oui","pas","ne","meme","autre","autres","tout",
  "tous","toute","toutes","chaque","quelque","quelques","plusieurs",
  // French HR boilerplate
  "poste","postes","emploi","emplois","candidat","candidats","candidate",
  "candidates","candidature","candidatures","profil","profils","recherche",
  "recherchons","cherche","cherchons","requis","requise","requises","exige",
  "exigee","souhaite","souhaitee","obligatoire","experience","experiences",
  "experimente","experimentee","annee","annees","an","ans","mois","jour",
  "jours","competence","competences","qualite","qualites","capacite","capacites",
  "connaissance","connaissances","missions","mission","taches","tache",
  "responsabilite","responsabilites","entreprise","societe","equipe","equipes",
  "bureau","bureaux","departement","service","services","personnel","salarie",
  "salaries","employe","employes","travail","travailler","travaille",
  "poste","niveau","domaine","secteur","environnement","general","generale",
  "divers","diverse","diverses","nouveau","nouvelle","nouvelles","nouveaux",
  "bon","bonne","bonnes","bons","excellent","excellente","fort","forte",
  "ideal","ideale","capable","y","en","au","aux",
]);

function normalize(text) {
  return String(text || "")
    .toLowerCase()
    .replace(/[\u2018\u2019\u201c\u201d]/g, "'")
    // Strip diacritics so French (é, è, ê, ç, à, î, ô, û, ü...) matches ASCII
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9+#\s\-.,!?;:']/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function splitSentences(text) {
  return String(text || "")
    .split(/[.!?;,:\n\r]+/)
    .map((s) => s.trim())
    .filter(Boolean);
}

// Word splitter that strips punctuation but keeps + and # (e.g. "C++", "C#")
// and hyphens used inside words (e.g. "well-versed").
function tokenizeWords(text) {
  return normalize(text)
    .split(/[^a-z0-9+#\-]+/)
    .map((w) => w.replace(/^[\-.]+|[\-.]+$/g, ""))
    .filter(Boolean);
}

// Lightweight stemmer: collapse plurals and common verb endings so that
// "managing", "managed", "manages" all match "manage". Also handles common
// French endings: -ment, -tion, -er/-ir/-re infinitives, -ant/-ent participles.
function stem(word) {
  if (!word || word.length <= 3) return word;
  let w = word;
  // English first
  if (w.endsWith("ies") && w.length > 4) w = w.slice(0, -3);
  else if (w.endsWith("sses")) w = w.slice(0, -2);
  else if (w.endsWith("ing") && w.length > 5) w = w.slice(0, -3);
  else if (w.endsWith("ed") && w.length > 4) w = w.slice(0, -2);
  // French verb / noun suffixes (after diacritic stripping)
  else if (w.endsWith("ements") && w.length > 7) w = w.slice(0, -6);
  else if (w.endsWith("ement") && w.length > 6) w = w.slice(0, -5);
  else if (w.endsWith("tions") && w.length > 6) w = w.slice(0, -5);
  else if (w.endsWith("tion") && w.length > 5) w = w.slice(0, -4);
  else if (w.endsWith("ants") && w.length > 5) w = w.slice(0, -3);
  else if (w.endsWith("ant") && w.length > 4) w = w.slice(0, -2);
  else if (w.endsWith("ents") && w.length > 5) w = w.slice(0, -3);
  else if (w.endsWith("ent") && w.length > 4) w = w.slice(0, -2);
  else if (/(?:er|ir|re)$/.test(w) && w.length > 5) w = w.slice(0, -2);
  else if (w.endsWith("s") && !w.endsWith("ss") && w.length > 3) w = w.slice(0, -1);
  if (w.endsWith("e") && w.length > 4) w = w.slice(0, -1);
  return w;
}

function isUsefulToken(t) {
  if (!t) return false;
  if (t.length < 3) return false;
  if (STOPWORDS.has(t)) return false;
  if (/^\d+$/.test(t)) return false;
  return true;
}

/**
 * Extract weighted keywords from the job description.
 * Returns an array of { term, weight, kind: 'phrase'|'word' }.
 * Phrases get a higher weight; words appearing inside chosen phrases
 * are removed to avoid double-counting.
 */
function extractKeywords(jobDescription, maxWords = 18, maxPhrases = 8) {
  const sentences = splitSentences(jobDescription);

  const bigramFreq = new Map();
  const wordFreq = new Map();

  for (const sentence of sentences) {
    const tokens = tokenizeWords(sentence);
    for (let i = 0; i < tokens.length; i++) {
      const t = tokens[i];
      if (isUsefulToken(t)) {
        wordFreq.set(t, (wordFreq.get(t) || 0) + 1);
      }
      if (i < tokens.length - 1) {
        const a = tokens[i], b = tokens[i + 1];
        if (isUsefulToken(a) && isUsefulToken(b)) {
          const phrase = `${a} ${b}`;
          bigramFreq.set(phrase, (bigramFreq.get(phrase) || 0) + 1);
        }
      }
    }
  }

  const phrases = [...bigramFreq.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, maxPhrases)
    .map(([term, count]) => ({ term, weight: 2 + Math.min(count - 1, 2), kind: "phrase" }));

  const phraseWords = new Set();
  phrases.forEach((p) => p.term.split(" ").forEach((w) => phraseWords.add(w)));

  const words = [...wordFreq.entries()]
    .filter(([w]) => !phraseWords.has(w))
    .sort((a, b) => b[1] - a[1])
    .slice(0, maxWords)
    .map(([term, count]) => ({ term, weight: 1 + Math.min(count - 1, 1), kind: "word" }));

  return [...phrases, ...words];
}

/**
 * Build a regex that matches a keyword against the corpus, allowing
 * simple inflectional variants.
 */
function buildKeywordMatcher(term) {
  const parts = term.split(" ").map((w) => {
    const stemmed = stem(w);
    const escaped = stemmed.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    return `${escaped}(?:e|es|ed|ing|er|ers|tion|tions|ment|ments|y|ies|s)?`;
  });
  return new RegExp(`(^|[^a-z0-9])${parts.join("[\\s-]+")}([^a-z0-9]|$)`, "i");
}

// ---------------------------------------------------------------------------
// Dimension scorers: education, experience, soft skills, motivation
// ---------------------------------------------------------------------------

const EDUCATION_TERMS = [
  // English
  "phd","doctorate","mba","masters","master's","msc","ma","m.a","ms","m.s",
  "bachelor","bachelors","bachelor's","bsc","b.sc","ba","b.a","bs","b.s",
  "hnd","diploma","associate","degree","postgraduate","undergraduate",
  "certificate","certified","certification","license","licensed","accredited",
  "high school","secondary school","wassce","sssce","gce","a-level","o-level",
  // French (accents stripped: é -> e, ê -> e, ç -> c, etc.)
  "doctorat","these","master","maitrise","licence","licence pro","licence professionnelle",
  "bac","bac+2","bac+3","bac+4","bac+5","baccalaureat","brevet","cap","bep",
  "bts","but","dut","deug","dess","dea","diplome","diplomee","diplome",
  "ingenieur","ingenieure","grande ecole","ecole superieure","universite",
  "certificat","certifie","certifiee","agrege","agregee","habilitation",
];

const EDUCATION_LEVEL_RANK = {
  // English
  "high school": 1, "secondary school": 1, "wassce": 1, "sssce": 1,
  "gce": 1, "o-level": 1, "a-level": 1.5,
  "diploma": 2, "associate": 2, "hnd": 2.5, "certificate": 2,
  "bachelor": 3, "bachelors": 3, "bachelor's": 3, "bsc": 3, "b.sc": 3,
  "ba": 3, "b.a": 3, "bs": 3, "b.s": 3, "degree": 3, "undergraduate": 3,
  "masters": 4, "master's": 4, "msc": 4, "ma": 4, "m.a": 4, "ms": 4,
  "m.s": 4, "mba": 4, "postgraduate": 4,
  "phd": 5, "doctorate": 5,
  // French (accents stripped)
  "baccalaureat": 1, "bac": 1, "brevet": 1, "cap": 1.5, "bep": 1.5,
  "bac+2": 2, "dut": 2, "bts": 2, "deug": 2, "but": 2.5,
  "licence": 3, "bac+3": 3, "licence pro": 3, "licence professionnelle": 3,
  "maitrise": 3.5, "bac+4": 3.5,
  "master": 4, "bac+5": 4, "dess": 4, "dea": 4,
  "ingenieur": 4, "ingenieure": 4, "grande ecole": 4, "ecole superieure": 4,
  "doctorat": 5, "these": 5,
};

const SOFT_SKILL_TERMS = [
  // English
  "communication","communicate","leadership","teamwork","team player",
  "problem solving","problem-solving","critical thinking","time management",
  "self-motivated","self motivated","organized","organised","detail oriented",
  "detail-oriented","attention to detail","adaptable","adaptability",
  "interpersonal","collaboration","collaborative","initiative","proactive",
  "reliable","dependable","analytical","creative","creativity","fast learner",
  "quick learner","multitasking","negotiation","presentation",
  // French (accents stripped)
  "communiquer","communicant","leadership","esprit d'equipe","travail d'equipe",
  "resolution de problemes","esprit critique","gestion du temps",
  "autonome","autonomie","organise","organisee","rigoureux","rigueur",
  "souci du detail","adaptable","adaptabilite","polyvalent","polyvalence",
  "interpersonnel","collaboration","collaboratif","initiative","proactif",
  "fiable","analytique","creatif","creative","creativite","apprentissage rapide",
  "negociation","presentation","sens du service","sens du contact","dynamique",
  "motive","motivee",
];

const MOTIVATION_PATTERNS = [
  // English
  /passionate\s+about/i,
  /passion\s+for/i,
  /excited\s+(?:to|about)/i,
  /eager\s+to/i,
  /enthusiastic\s+about/i,
  /committed\s+to/i,
  /dedicated\s+to/i,
  /driven\s+to/i,
  /motivated\s+(?:to|by)/i,
  /love\s+(?:to|for|working)/i,
  /strong\s+desire/i,
  /great\s+interest/i,
  /keen\s+(?:interest|to)/i,
  /thrive\s+(?:in|on)/i,
  /look\s+forward\s+to\s+contributing/i,
  /align(?:s|ed)?\s+with\s+my/i,
  /perfect\s+(?:fit|opportunity)/i,
  /grow\s+(?:my|with)/i,
  /long[- ]term\s+career/i,
  // French (matched after accent-stripping in normalize() / on raw text without accents)
  /passionn?e?\s+par/i,
  /passion\s+pour/i,
  /enthousiast?e?\s+(?:a|de|pour)/i,
  /motiv[eé]?e?\s+(?:par|pour|a)/i,
  /tres\s+motiv/i,
  /int[eé]ress[eé]?e?\s+par/i,
  /grand\s+int[eé]r[eê]t/i,
  /vif\s+int[eê]r[eê]t/i,
  /d[eé]sir\s+(?:de|d')/i,
  /envie\s+(?:de|d')/i,
  /enthousiasm[eé]?\s+a\s+l'id[eé]e/i,
  /ravi[e]?\s+(?:de|d')/i,
  /heureu[xs]e?\s+(?:de|d')/i,
  /h[aâ]te\s+de/i,
  /contribuer\s+(?:a|au)/i,
  /rejoindre\s+(?:votre|l'equipe|l'entreprise)/i,
  /[eé]volu(?:er|tion)\s+(?:au\s+sein|avec|dans)/i,
  /carri[eè]re\s+(?:long|durable)/i,
  /investi[re]?\s+(?:a\s+long\s+terme|durablement)/i,
  /id[eé]al\s+pour\s+moi/i,
  /correspond\s+(?:parfaitement|a\s+mon)/i,
  /partage\s+(?:vos|les)\s+valeurs/i,
];

const COMPANY_NAME = /managira|one\s*place/i;

function scoreEducation(jobDescription, corpus) {
  // Normalize the JD too so accented French (\u00e9cole, dipl\u00f4me\u2026) matches.
  const jdLower = normalize(jobDescription);
  let requiredRank = 0;
  let requiredLabel = null;
  for (const [term, rank] of Object.entries(EDUCATION_LEVEL_RANK)) {
    const re = new RegExp(`(^|[^a-z0-9])${term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}([^a-z0-9]|$)`, "i");
    if (re.test(jdLower) && rank > requiredRank) {
      requiredRank = rank;
      requiredLabel = term;
    }
  }

  // What does the applicant claim?
  let applicantRank = 0;
  const applicantTerms = [];
  for (const term of EDUCATION_TERMS) {
    const re = new RegExp(`(^|[^a-z0-9])${term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}([^a-z0-9]|$)`, "i");
    if (re.test(corpus)) {
      applicantTerms.push(term);
      const r = EDUCATION_LEVEL_RANK[term] || 0;
      if (r > applicantRank) applicantRank = r;
    }
  }

  // Score 0..1
  let score;
  if (requiredRank === 0 && applicantRank === 0) {
    score = 0.5; // job didn't specify, applicant didn't mention
  } else if (requiredRank === 0) {
    score = 0.85; // applicant exceeds an unspecified bar
  } else if (applicantRank === 0) {
    score = 0.2; // job asks but applicant didn't mention any credential
  } else if (applicantRank >= requiredRank) {
    score = 1;
  } else {
    score = Math.max(0.25, applicantRank / requiredRank);
  }

  return {
    score,
    requiredLabel,
    requiredRank,
    applicantRank,
    applicantTerms,
  };
}

function scoreExperience(jobDescription, corpus) {
  // Normalize JD so French (é, è …) and English match the same way.
  const jd = normalize(jobDescription);
  // Find required years in the JD: "3+ years", "minimum of 5 years",
  // "3 ans d'experience", "minimum 5 annees".
  let requiredYears = 0;
  const yearWord = `(?:years?|ans?|annees?)`;
  const reqMatches = [...jd.matchAll(new RegExp(`(\\d+)\\s*\\+?\\s*(?:to\\s*\\d+\\s*|a\\s*\\d+\\s*)?${yearWord}`, "g"))];
  for (const m of reqMatches) {
    const n = parseInt(m[1], 10);
    if (n > requiredYears && n < 40) requiredYears = n;
  }

  // Applicant claimed years (English + French)
  let applicantYears = 0;
  const appMatches = [...corpus.matchAll(new RegExp(
    `(\\d+)\\s*\\+?\\s*(?:to\\s*\\d+\\s*|a\\s*\\d+\\s*)?${yearWord}\\s*(?:of\\s+|d['\\s]+|de\\s+)?(?:experience|exp|work|working|in|with|as|dans|en|comme|aupres|au\\s+sein)?`,
    "g"
  ))];
  for (const m of appMatches) {
    const n = parseInt(m[1], 10);
    if (n > applicantYears && n < 50) applicantYears = n;
  }

  // Also look for date-range hints like "2018 - 2024"
  if (!applicantYears) {
    const ranges = [...corpus.matchAll(/\b(20\d{2}|19\d{2})\s*[-–to]+\s*(present|current|now|20\d{2}|19\d{2})\b/g)];
    let total = 0;
    for (const r of ranges) {
      const start = parseInt(r[1], 10);
      const endRaw = r[2];
      const end = /^\d{4}$/.test(endRaw) ? parseInt(endRaw, 10) : new Date().getFullYear();
      if (end >= start) total += (end - start);
    }
    if (total) applicantYears = Math.min(total, 40);
  }

  let score;
  if (!requiredYears && !applicantYears) score = 0.5;
  else if (!requiredYears && applicantYears) score = 0.9;
  else if (requiredYears && !applicantYears) score = 0.3;
  else if (applicantYears >= requiredYears) score = 1;
  else score = Math.max(0.2, applicantYears / requiredYears);

  return { score, requiredYears, applicantYears };
}

function scoreSoftSkills(corpus) {
  const matched = [];
  for (const term of SOFT_SKILL_TERMS) {
    const re = new RegExp(`(^|[^a-z0-9])${term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}([^a-z0-9]|$)`, "i");
    if (re.test(corpus)) matched.push(term);
  }
  // Reward up to 6 unique soft skills.
  const score = Math.min(matched.length, 6) / 6;
  return { score, matched };
}

function scoreMotivation(coverLetter) {
  const raw = String(coverLetter || "");
  if (!raw || raw.length < 40) {
    return { score: 0.1, signals: [], coverLetterLength: raw.length };
  }
  // Normalize so French accents don't block the patterns below.
  const text = normalize(raw);
  const signals = [];
  for (const re of MOTIVATION_PATTERNS) {
    const m = text.match(re);
    if (m) signals.push(m[0].toLowerCase());
  }
  const mentionsCompany = COMPANY_NAME.test(text);
  let score = Math.min(signals.length, 4) / 4 * 0.7;
  if (mentionsCompany) score += 0.2;
  // Cover letter length signal: 200..1500 chars is sweet spot
  const len = raw.length;
  if (len >= 200 && len <= 1500) score += 0.1;
  else if (len > 80) score += 0.05;
  score = Math.min(score, 1);
  return { score, signals, mentionsCompany, coverLetterLength: len };
}

function analyzeQualification({ jobDescription, coverLetter, resumeText }) {
  const keywords = extractKeywords(jobDescription || "");
  const cover = normalize(coverLetter || "");
  const resume = normalize(resumeText || "");
  const corpus = `${cover} \n ${resume}`;

  // Dimension 1: keyword fit (weighted by phrase importance)
  const matched = [];
  const missing = [];
  let totalWeight = 0;
  let earnedWeight = 0;

  for (const kw of keywords) {
    totalWeight += kw.weight;
    const re = buildKeywordMatcher(kw.term);
    if (re.test(corpus)) {
      earnedWeight += kw.weight;
      matched.push(kw.term);
    } else {
      missing.push(kw.term);
    }
  }
  const keywordScore = totalWeight ? earnedWeight / totalWeight : 0.5;

  // Dimensions 2-4
  const education = scoreEducation(jobDescription, corpus);
  const experience = scoreExperience(jobDescription, corpus);
  const soft = scoreSoftSkills(corpus);
  const motivation = scoreMotivation(coverLetter || "");

  // Weighted blend: skills/keywords drive the score, but qualifications,
  // experience and desire also matter.
  const weights = {
    keyword: 0.45,
    experience: 0.20,
    education: 0.15,
    soft: 0.10,
    motivation: 0.10,
  };

  const blended =
    keywordScore   * weights.keyword +
    experience.score * weights.experience +
    education.score  * weights.education +
    soft.score       * weights.soft +
    motivation.score * weights.motivation;

  let score = Math.round(blended * 100);

  // If we could not extract resume text, cap the score — we don't trust
  // a high number that came purely from a cover letter.
  const hasResumeText = resume.length > 80;
  if (!hasResumeText && score > 70) score = 70;

  let recommendation;
  if (score >= 65) recommendation = "qualified";
  else if (score >= 40) recommendation = "review";
  else recommendation = "not-qualified";

  return {
    score,
    recommendation,
    matched,
    missing,
    keywords: keywords.map((k) => k.term),
    coverLetterLength: cover.length,
    resumeTextLength: resume.length,
    hasResumeText,
    breakdown: {
      keyword:    Math.round(keywordScore * 100),
      experience: Math.round(experience.score * 100),
      education:  Math.round(education.score * 100),
      softSkills: Math.round(soft.score * 100),
      motivation: Math.round(motivation.score * 100),
    },
    education,
    experience,
    softSkills: soft,
    motivation,
  };
}

/**
 * Best-effort fetch + parse of a remote resume URL into plain text.
 * Supports PDF (pdf-parse) and DOCX (mammoth). Returns "" on failure.
 */
async function fetchResumeText(url) {
  if (!url) return "";
  try {
    const res = await fetch(url);
    if (!res.ok) return "";
    const ct = (res.headers.get("content-type") || "").toLowerCase();
    const buf = Buffer.from(await res.arrayBuffer());

    if (ct.includes("pdf") || /\.pdf(\?|$)/i.test(url)) {
      const pdfParse = require("pdf-parse");
      const data = await pdfParse(buf);
      return data.text || "";
    }
    if (
      ct.includes("officedocument.wordprocessingml") ||
      /\.docx(\?|$)/i.test(url)
    ) {
      const mammoth = require("mammoth");
      const out = await mammoth.extractRawText({ buffer: buf });
      return out.value || "";
    }
    if (ct.startsWith("text/") || /\.txt(\?|$)/i.test(url)) {
      return buf.toString("utf8");
    }
    return "";
  } catch (_err) {
    return "";
  }
}

module.exports = {
  analyzeQualification,
  fetchResumeText,
  extractKeywords,
};
