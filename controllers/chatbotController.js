// Chatbot controller - documentation-only retrieval with intent-aware
// ranking and procedure summaries grounded in documentation content.
const {
  listDocumentationArticles,
  searchDocumentationArticles,
} = require('../utils/documentationCenter');

const STOP_WORDS = new Set([
  'a', 'an', 'and', 'are', 'as', 'at', 'be', 'by', 'for', 'from', 'how', 'i', 'in', 'into',
  'is', 'it', 'me', 'my', 'of', 'on', 'or', 'our', 'please', 'show', 'that', 'the', 'their',
  'this', 'to', 'we', 'what', 'where', 'which', 'who', 'with', 'you', 'your',
  'why', 'when', 'can', 'does', 'do', 'should', 'could', 'would', 'go', 'main', 'check'
]);

const SYNONYM_GROUPS = [
  ['add', 'create', 'new', 'register', 'enroll', 'enrol', 'admit'],
  ['student', 'pupil', 'learner'],
  ['employee', 'staff', 'teacher', 'worker'],
  ['guardian', 'parent'],
  ['billing', 'bill', 'payment', 'pay', 'invoice', 'fees', 'fee', 'finance', 'collections', 'collection', 'paygira', 'renewal', 'subscription'],
  ['attendance', 'present', 'absent'],
  ['report', 'result', 'grade', 'transcript'],
  ['settings', 'configure', 'configuration', 'setup'],
  ['document', 'documentation', 'guide', 'manual', 'docs', 'help'],
  ['school', 'organization', 'organisation'],
];

const ACTION_CANONICALS = new Set(['add', 'set', 'promote', 'update', 'edit', 'delete', 'remove', 'view', 'search', 'reset', 'pay', 'print']);
const ACTION_ALIASES = {
  create: 'add',
  new: 'add',
  register: 'add',
  enroll: 'add',
  enrol: 'add',
  admit: 'add',
  set: 'set',
  assign: 'set',
  configure: 'set',
  setup: 'set',
  change: 'update',
  modify: 'update',
  update: 'update',
  edit: 'edit',
  remove: 'remove',
  delete: 'delete',
  promote: 'promote',
  find: 'search',
  search: 'search',
  see: 'view',
  view: 'view',
  check: 'view',
  reset: 'reset',
  pay: 'pay',
  print: 'print',
};

const ENTITY_TERMS = new Set([
  'student', 'employee', 'guardian', 'billing', 'attendance', 'report', 'settings',
  'document', 'school', 'class', 'account', 'plan', 'subscription'
]);

const STEP_VERBS = [
  'go', 'open', 'click', 'select', 'choose', 'enter', 'fill', 'add', 'create', 'register',
  'assign', 'set', 'save', 'submit', 'review', 'confirm', 'upload', 'attach', 'publish'
];

const LOCATION_HINTS = ['go to', 'open', 'navigate', 'under', 'menu', 'settings', 'dashboard', 'management tools'];
const WHY_HINTS = ['because', 'so that', 'in order', 'reason', 'helps', 'ensures'];
const WHEN_HINTS = ['when', 'before', 'after', 'during', 'once', 'then'];
const WHO_HINTS = ['admin', 'administrator', 'teacher', 'staff', 'guardian', 'parent', 'student', 'user', 'role', 'permission'];
const BILLING_PATTERN = /\b(billing|bill|payment|paygira|collection|invoice|fee|subscription|renewal|pricing)\b/;

const NON_CORE_QUERY_TERMS = new Set([
  'search', 'view', 'add', 'update', 'edit', 'delete', 'remove', 'reset', 'print', 'find',
  'open', 'click', 'select', 'choose', 'set', 'create', 'register', 'manage', 'configure',
  'use', 'need', 'want'
]);

const DOC_CATALOG_TTL_MS = 2 * 60 * 1000;
let DOC_CATALOG_CACHE = {
  expiresAt: 0,
  items: [],
};

const STEM_SUFFIXES = ['ing', 'ed', 'es', 's'];

const _normalize = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9\s]+/g, ' ').replace(/\s+/g, ' ').trim();

const _stripTags = (html) => {
  const cleaned = String(html || '')
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ');
  return cleaned.replace(/\s+/g, ' ').trim();
};

const _dedupe = (items) => Array.from(new Set(items.filter(Boolean)));

const _stem = (token) => {
  if (!token || token.length < 4) return token;
  for (const suffix of STEM_SUFFIXES) {
    if (token.endsWith(suffix) && token.length > suffix.length + 2) {
      return token.slice(0, -suffix.length);
    }
  }
  return token;
};

const _tokenize = (text) => {
  return _dedupe(
    _normalize(text)
      .split(/\s+/)
      .filter((token) => token && token.length > 1 && !STOP_WORDS.has(token))
  );
};

const _buildCanonicalTokenMap = () => {
  const map = new Map();
  SYNONYM_GROUPS.forEach((group) => {
    const canonical = group[0];
    group.forEach((term) => {
      map.set(_stem(term), canonical);
    });
  });
  return map;
};

const CANONICAL_TOKEN_MAP = _buildCanonicalTokenMap();
const CANONICAL_TO_TERMS = (() => {
  const map = new Map();
  SYNONYM_GROUPS.forEach((group) => {
    const canonical = group[0];
    const terms = _dedupe(group.map((term) => _stem(term)).concat(group.map((term) => _normalize(term))));
    map.set(canonical, terms);
  });
  return map;
})();

const _canonicalizeToken = (token) => {
  const normalized = _normalize(token);
  if (!normalized) return '';
  if (CANONICAL_TOKEN_MAP.has(normalized)) return CANONICAL_TOKEN_MAP.get(normalized);
  const stemmed = _stem(normalized);
  if (CANONICAL_TOKEN_MAP.has(stemmed)) return CANONICAL_TOKEN_MAP.get(stemmed);
  return normalized;
};

const _expandTokenSet = (tokens = []) => {
  const expanded = new Set();

  tokens.forEach((token) => {
    const canonical = _canonicalizeToken(token);
    expanded.add(token);
    expanded.add(canonical);
  });

  SYNONYM_GROUPS.forEach((group) => {
    const normalizedGroup = group.map((term) => _stem(term));
    const hit = normalizedGroup.some((term) => expanded.has(term));
    if (hit) {
      normalizedGroup.forEach((term) => expanded.add(term));
      expanded.add(normalizedGroup[0]);
    }
  });

  return Array.from(expanded);
};

const _bigrams = (text) => {
  const source = _normalize(text).replace(/\s+/g, '');
  if (source.length < 2) return [source];
  const grams = [];
  for (let i = 0; i < source.length - 1; i += 1) {
    grams.push(source.slice(i, i + 2));
  }
  return grams;
};

const _diceSimilarity = (left, right) => {
  const a = _bigrams(left);
  const b = _bigrams(right);
  if (!a.length || !b.length) return 0;

  const counts = new Map();
  a.forEach((gram) => counts.set(gram, (counts.get(gram) || 0) + 1));

  let overlap = 0;
  b.forEach((gram) => {
    const remaining = counts.get(gram) || 0;
    if (remaining > 0) {
      overlap += 1;
      counts.set(gram, remaining - 1);
    }
  });

  return (2 * overlap) / (a.length + b.length);
};

const _withArticle = (entity) => {
  const value = String(entity || '').trim();
  if (!value) return '';
  const first = value[0].toLowerCase();
  const article = ['a', 'e', 'i', 'o', 'u'].includes(first) ? 'an' : 'a';
  return `${article} ${value}`;
};

const _sentenceCase = (value) => {
  const text = String(value || '').trim();
  if (!text) return '';
  return text[0].toUpperCase() + text.slice(1);
};

const _articleSearchHaystack = (article) => {
  return _normalize([
    article && article.title,
    article && article.topic,
    article && article.subtopic,
    article && (Array.isArray(article.tags) ? article.tags.join(' ') : ''),
    article && article.seoDescription,
    article && article.excerpt,
    article && article.plainText,
  ].join(' '));
};

const _collectMatchedKeywords = (article, canonicalTerms = []) => {
  const haystack = _articleSearchHaystack(article);
  return _dedupe((canonicalTerms || []).filter((term) => term && term.length > 2 && haystack.includes(term))).slice(0, 5);
};

const _collectMatchedTags = (article, canonicalTerms = [], expandedTerms = []) => {
  const tags = Array.isArray(article && article.tags)
    ? article.tags.map((tag) => _normalize(tag)).filter(Boolean)
    : [];

  if (!tags.length) return [];

  const candidates = _dedupe([...(canonicalTerms || []), ...(expandedTerms || [])]).filter((term) => term && term.length > 2);
  return _dedupe(candidates.filter((term) => tags.some((tag) => tag.includes(term) || term.includes(tag)))).slice(0, 4);
};

const _scoreDeepTextSignal = (article, nq, coreTerms = [], expandedTerms = []) => {
  const plainText = _normalize(article && article.plainText);
  if (!plainText) {
    return { score: 0, coverage: 0 };
  }

  const terms = _dedupe([...(coreTerms || []), ...(expandedTerms || [])])
    .map((term) => _canonicalizeToken(term))
    .filter((term) => term && term.length > 2 && !NON_CORE_QUERY_TERMS.has(term) && !ACTION_CANONICALS.has(term));

  let score = 0;
  if (nq && plainText.includes(nq)) {
    score += 32;
  }

  let matchedTerms = 0;
  terms.forEach((term) => {
    if (!plainText.includes(term)) return;
    matchedTerms += 1;
    const parts = plainText.split(term);
    const occurrences = Math.max(0, parts.length - 1);
    score += Math.min(occurrences, 5) * 3;
  });

  const coverage = terms.length ? matchedTerms / terms.length : 0;
  score += coverage * 36;

  const sentences = _splitSentences(article && article.plainText);
  let bestSentenceSignal = 0;
  sentences.forEach((sentence) => {
    const normalizedSentence = _normalize(sentence);
    if (!normalizedSentence) return;

    let localMatches = 0;
    terms.forEach((term) => {
      if (normalizedSentence.includes(term)) localMatches += 1;
    });

    const localCoverage = terms.length ? localMatches / terms.length : 0;
    const localSimilarity = _diceSimilarity(normalizedSentence, nq);
    const localSignal = (localCoverage * 0.7) + (localSimilarity * 0.3);
    if (localSignal > bestSentenceSignal) {
      bestSentenceSignal = localSignal;
    }
  });

  score += bestSentenceSignal * 30;
  return { score, coverage };
};

const _splitSentences = (plainText) => {
  const source = String(plainText || '').replace(/\s+/g, ' ').trim();
  if (!source) return [];
  return source
    .split(/(?<=[.!?])\s+/)
    .map((segment) => segment.trim())
    .filter((segment) => segment.length >= 20 && segment.length <= 240);
};

const _startsWithAny = (value, prefixes = []) => {
  return prefixes.some((prefix) => value.startsWith(prefix));
};

const _hasMainTeacherIntent = (query, tokens = [], expandedTerms = []) => {
  const q = _normalize(query);
  if (q.includes('main teacher')) return true;
  const termSet = new Set([...(tokens || []), ...(expandedTerms || [])].map((t) => _canonicalizeToken(t)));
  return termSet.has('employee') && (q.includes('teacher') && (q.includes('main') || q.includes('class teacher')));
};

const _extractNeedleSentences = (plainText, needles = []) => {
  const sentences = _splitSentences(plainText);
  if (!sentences.length) return [];
  const normalizedNeedles = needles.map((n) => _normalize(n)).filter(Boolean);
  return _dedupe(
    sentences.filter((s) => {
      const ns = _normalize(s);
      return normalizedNeedles.some((needle) => needle && ns.includes(needle));
    })
  ).slice(0, 4).map((s) => _sentenceCase(s));
};

const _extractListStepsFromHtml = (contentHtml) => {
  const html = String(contentHtml || '');
  if (!html) return [];

  const matches = html.match(/<li[^>]*>[\s\S]*?<\/li>/gi) || [];
  const cleaned = matches
    .map((item) => _stripTags(item))
    .map((item) => item.replace(/^\d+[\).\-:\s]*/, '').trim())
    .filter((item) => item.length >= 8)
    .slice(0, 8);

  return _dedupe(cleaned).slice(0, 5);
};

const _extractSentenceSteps = (plainText, expandedTerms = []) => {
  const source = String(plainText || '').replace(/\s+/g, ' ').trim();
  if (!source) return [];

  const segments = source
    .split(/(?<=[.!?])\s+/)
    .map((segment) => segment.trim())
    .filter((segment) => segment.length >= 12 && segment.length <= 220);

  const termSet = new Set((expandedTerms || []).map((term) => _normalize(term)));

  const ranked = segments
    .map((segment) => {
      const normalized = _normalize(segment);
      let score = 0;

      STEP_VERBS.forEach((verb) => {
        if (normalized.includes(verb)) score += 2;
      });

      termSet.forEach((term) => {
        if (term && normalized.includes(term)) score += 1;
      });

      if (/^(step|first|next|then|finally)\b/.test(normalized)) score += 2;
      if (/\b(go to|open|click|select|choose|fill|save|submit|confirm)\b/.test(normalized)) score += 3;

      return { segment, score };
    })
    .filter((entry) => entry.score >= 2)
    .sort((left, right) => right.score - left.score)
    .slice(0, 5)
    .map((entry) => entry.segment);

  return _dedupe(ranked);
};

class ChatbotController {
  static async _getDocumentationCatalog() {
    const now = Date.now();
    if (DOC_CATALOG_CACHE.expiresAt > now && Array.isArray(DOC_CATALOG_CACHE.items) && DOC_CATALOG_CACHE.items.length > 0) {
      return DOC_CATALOG_CACHE.items;
    }

    const items = await listDocumentationArticles({ includeDrafts: false });
    DOC_CATALOG_CACHE = {
      expiresAt: now + DOC_CATALOG_TTL_MS,
      items: Array.isArray(items) ? items : [],
    };
    return DOC_CATALOG_CACHE.items;
  }

  static _scoreCatalogArticle(article, nq, canonicalTerms, expandedTerms, intent, questionType) {
    const title = _normalize(article.title || '');
    const topic = _normalize(article.topic || '');
    const subtopic = _normalize(article.subtopic || '');
    const tags = Array.isArray(article.tags) ? article.tags.map((tag) => _normalize(tag)).join(' ') : '';
    const text = _normalize(article.plainText || article.excerpt || article.seoDescription || '');
    const haystack = _normalize([title, topic, subtopic, tags, text].join(' '));

    let score = 0;
    if (nq && title.includes(nq)) score += 28;
    if (nq && haystack.includes(nq)) score += 10;

    (canonicalTerms || []).forEach((term) => {
      if (!term) return;
      if (title.includes(term)) score += 8;
      if (topic.includes(term) || subtopic.includes(term)) score += 6;
      if (tags.includes(term)) score += 8;
      if (text.includes(term)) score += 2;
    });

    (expandedTerms || []).forEach((term) => {
      if (!term) return;
      if (title.includes(term)) score += 4;
      if (tags.includes(term)) score += 4;
      if (text.includes(term)) score += 1;
    });

    if (intent && intent.phrase) {
      const phrase = _normalize(intent.phrase);
      if (title.includes(phrase)) score += 10;
      if (haystack.includes(phrase)) score += 6;
    }

    if (questionType === 'where' && /\b(go to|open|navigate|menu|settings|dashboard|management tools)\b/.test(text)) {
      score += 8;
    }

    if (questionType === 'why' && /\b(because|reason|helps|ensures|so that|in order)\b/.test(text)) {
      score += 7;
    }

    if (article.featured) score += 4;

    score += Math.round(_diceSimilarity(title, nq) * 16);
    const deepSignal = _scoreDeepTextSignal(article, nq, canonicalTerms, expandedTerms);
    score += Math.min(56, deepSignal.score);
    return score;
  }

  static _detectQuestionType(query) {
    const q = _normalize(query);
    if (!q) return 'general';

    if (_startsWithAny(q, ['why ', 'why is', 'why does', 'why do'])) return 'why';
    if (_startsWithAny(q, ['what ', 'what is', 'what does', 'what are'])) return 'what';
    if (_startsWithAny(q, ['where ', 'where is', 'where do', 'where can'])) return 'where';
    if (_startsWithAny(q, ['when ', 'when do', 'when is', 'when can'])) return 'when';
    if (_startsWithAny(q, ['who ', 'who can', 'who should'])) return 'who';
    if (_startsWithAny(q, ['how ', 'how do', 'how to', 'steps'])) return 'how';
    if (_startsWithAny(q, ['check ', 'show ', 'view ', 'find '])) return 'where';
    if (_startsWithAny(q, ['can ', 'is ', 'are ', 'does ', 'do ', 'should ', 'could '])) return 'decision';

    return 'general';
  }

  static _deriveIntent(tokens = [], expandedTerms = []) {
    const termSet = new Set([...(tokens || []), ...(expandedTerms || [])]);

    let action = null;
    for (const term of termSet) {
      const canonicalAction = ACTION_ALIASES[term] || (ACTION_CANONICALS.has(term) ? term : null);
      if (canonicalAction) {
        action = canonicalAction;
        break;
      }
    }

    let entity = null;
    for (const term of termSet) {
      const canonicalEntity = _canonicalizeToken(term);
      if (ENTITY_TERMS.has(canonicalEntity)) {
        entity = canonicalEntity;
        break;
      }
    }

    if (!action && !entity) return null;

    const actionLabel = action || 'find';
    const entityLabel = entity || 'this';
    return {
      action: actionLabel,
      entity: entityLabel,
      phrase: `${actionLabel} ${entityLabel}`.trim(),
    };
  }

  static _scoreArticle(article, nq, terms, expandedTerms, intent, questionType = 'general') {
    const title = _normalize(article.title || '');
    const topic = _normalize(article.topic || '');
    const subtopic = _normalize(article.subtopic || '');
    const tags = _normalize(Array.isArray(article.tags) ? article.tags.join(' ') : '');
    const excerpt = _normalize(article.seoDescription || article.excerpt || '');
    const text = _normalize(article.plainText || article.contentHtml || '');
    const haystack = _normalize([title, topic, subtopic, tags, excerpt].join(' '));

    let score = Number(article.rank || 0) * 120;

    if (nq && title.includes(nq)) score += 60;
    if (nq && haystack.includes(nq)) score += 30;

    terms.forEach((term) => {
      if (title.includes(term)) score += 10;
      if (topic.includes(term) || subtopic.includes(term)) score += 5;
      if (tags.includes(term)) score += 4;
      if (excerpt.includes(term)) score += 3;
      if (text.includes(term)) score += 1;
    });

    expandedTerms.forEach((term) => {
      if (!term) return;
      if (title.includes(term)) score += 5;
      if (topic.includes(term) || subtopic.includes(term)) score += 3;
      if (tags.includes(term)) score += 3;
      if (excerpt.includes(term)) score += 2;
      if (text.includes(term)) score += 1;
    });

    if (intent && intent.phrase) {
      const phrase = _normalize(intent.phrase);
      if (title.includes(phrase)) score += 24;
      if (haystack.includes(phrase)) score += 14;
    }

    score += Math.round(_diceSimilarity(title, nq) * 30);
    score += Math.round(_diceSimilarity(excerpt, nq) * 12);

    // Prefer docs that reflect query terms in title/topic/subtopic/tags, not only body text.
    const headerHaystack = _normalize([title, topic, subtopic, tags].join(' '));
    const normalizedCoreTerms = _dedupe(
      (terms || [])
        .map((term) => _canonicalizeToken(term))
        .filter((term) => term && term.length > 2 && !NON_CORE_QUERY_TERMS.has(term) && !ACTION_CANONICALS.has(term))
    );
    const headerMatches = normalizedCoreTerms.filter((term) => headerHaystack.includes(term)).length;
    const headerCoverage = normalizedCoreTerms.length ? (headerMatches / normalizedCoreTerms.length) : 0;
    score += Math.round(headerCoverage * 26);

    // If an entity intent exists (e.g., teacher -> employee), require stronger entity presence in headers.
    if (intent && intent.entity) {
      const entityVariants = CANONICAL_TO_TERMS.get(intent.entity) || [intent.entity];
      const hasEntityInHeader = entityVariants.some((variant) => variant && headerHaystack.includes(variant));
      const hasEntityInBody = entityVariants.some((variant) => variant && text.includes(variant));
      if (hasEntityInHeader) {
        score += 18;
      } else if (hasEntityInBody) {
        score += 4;
      } else {
        score -= 16;
      }
    }

    const hasSettingsIntent = expandedTerms.includes('settings') || terms.includes('settings');
    const hasEmployeeIntent = expandedTerms.includes('employee') || terms.includes('employee');
    if (hasEmployeeIntent && hasSettingsIntent) {
      if (/\b(employee|staff|teacher|permission|role)\b/.test(headerHaystack)) {
        score += 16;
      }
      if (/\breport settings\b/.test(title)) {
        score -= 12;
      }
    }

    if (article.featured) score += 5;

    const hasBillingIntent = expandedTerms.includes('billing') || terms.includes('billing');
    const billingTitlePattern = BILLING_PATTERN;
    const billingContentPattern = BILLING_PATTERN;
    const settingsTitlePattern = /\b(settings|report settings)\b/;

    if (hasBillingIntent) {
      if (billingTitlePattern.test(title)) {
        score += 18;
      }
      if (!billingContentPattern.test(haystack)) {
        score -= 18;
      }
      if (settingsTitlePattern.test(title) && !billingTitlePattern.test(title)) {
        score -= 10;
      }
    }

    if (questionType === 'where') {
      if (/\b(go to|open|navigate|management tools|settings|menu)\b/.test(text)) {
        score += 10;
      }
      if (/\b(set up|setup|configure|manage)\b/.test(title)) {
        score += 6;
      }
      if (/\b(calculated|calculation|formula|computed)\b/.test(title)) {
        score -= 8;
      }
    }

    const hasMainTeacherIntent = _hasMainTeacherIntent(nq, terms, expandedTerms);
    if (hasMainTeacherIntent) {
      const hasMainTeacherInText = /\bmain teacher\b/.test(text) || /\bmain teacher\b/.test(headerHaystack);
      const hasTeacherRoleHeader = /\b(role|permission|teacher|class teacher|employee)\b/.test(headerHaystack);
      if (hasMainTeacherInText) score += 30;
      if (hasTeacherRoleHeader) score += 14;
      if (/\breport settings\b/.test(title)) score -= 20;
    }

    const deepSignal = _scoreDeepTextSignal(article, nq, terms, expandedTerms);
    score += Math.min(34, deepSignal.score * 0.45);

    return score;
  }

  static _computeMatchConfidence(article, nq, coreTerms) {
    const title = _normalize(article.title || '');
    const haystack = _normalize([
      article.title,
      article.topic,
      article.subtopic,
      Array.isArray(article.tags) ? article.tags.join(' ') : '',
      article.seoDescription,
      article.excerpt,
      article.plainText,
    ].join(' '));

    const essentialTerms = (coreTerms || []).filter(Boolean);
    const termMatchesHaystack = (term) => {
      const variants = CANONICAL_TO_TERMS.get(term) || [term];
      return variants.some((variant) => variant && haystack.includes(variant));
    };
    const unmatchedTerms = essentialTerms.filter((term) => !termMatchesHaystack(term));
    const matched = essentialTerms.length - unmatchedTerms.length;
    const coverage = essentialTerms.length ? (matched / essentialTerms.length) : 0;

    const titleSimilarity = _diceSimilarity(title, nq);
    const rankSignal = Math.max(0, Math.min(1, Number(article.rank || 0)));

    return {
      coverage,
      titleSimilarity,
      rankSignal,
      unmatchedTerms,
      confidence: (coverage * 0.65) + (titleSimilarity * 0.25) + (rankSignal * 0.10),
    };
  }

  static _rankSentencesForType(sentences, questionType, matchedTerms = []) {
    const terms = new Set((matchedTerms || []).filter(Boolean));

    return (sentences || [])
      .map((sentence) => {
        const normalized = _normalize(sentence);
        let score = 0;

        terms.forEach((term) => {
          if (term && normalized.includes(term)) score += 1;
        });

        if (questionType === 'why') {
          WHY_HINTS.forEach((hint) => {
            if (normalized.includes(hint)) score += 2;
          });
        }

        if (questionType === 'where') {
          LOCATION_HINTS.forEach((hint) => {
            if (normalized.includes(hint)) score += 2;
          });
        }

        if (questionType === 'when') {
          WHEN_HINTS.forEach((hint) => {
            if (normalized.includes(hint)) score += 2;
          });
        }

        if (questionType === 'who' || questionType === 'decision') {
          WHO_HINTS.forEach((hint) => {
            if (normalized.includes(hint)) score += 1;
          });
        }

        if (questionType === 'how') {
          if (/\b(go to|open|click|select|choose|fill|save|submit|confirm|create|add)\b/.test(normalized)) score += 3;
          STEP_VERBS.forEach((verb) => {
            if (normalized.includes(verb)) score += 1;
          });
        }

        if (questionType === 'what') {
          if (/\b(is|are|means|refers to|overview)\b/.test(normalized)) score += 2;
        }

        return { sentence, score };
      })
      .sort((left, right) => right.score - left.score);
  }

  static _buildAnswerPayload(topArticle, intent, matchedTerms, query) {
    const questionType = ChatbotController._detectQuestionType(query);
    const hasMainTeacherIntent = _hasMainTeacherIntent(query, matchedTerms, matchedTerms);
    const listSteps = _extractListStepsFromHtml(topArticle && topArticle.contentHtml);
    const sentenceSteps = _extractSentenceSteps(topArticle && topArticle.plainText, matchedTerms || []);
    const allSentences = _splitSentences(topArticle && topArticle.plainText);
    const rankedForType = ChatbotController._rankSentencesForType(allSentences, questionType, matchedTerms);
    const topLines = _dedupe(rankedForType.map((entry) => _sentenceCase(entry.sentence)).filter(Boolean)).slice(0, 4);

    if (hasMainTeacherIntent) {
      const targetedLines = _extractNeedleSentences(topArticle && topArticle.plainText, ['main teacher', 'class teacher', 'green dot']);
      const lines = targetedLines.length
        ? targetedLines
        : topLines.length
          ? topLines
          : ['Open the linked documentation and follow the class teacher assignment steps exactly as documented.'];
      return {
        mode: 'where',
        title: 'Main Teacher Setup',
        lead: `To set a main teacher, follow "${topArticle.title}".`,
        lines,
      };
    }

    if (questionType === 'how') {
      const steps = _dedupe(listSteps.concat(sentenceSteps))
        .map((line) => _sentenceCase(String(line || '').replace(/\s+/g, ' ').trim()))
        .filter(Boolean)
        .slice(0, 5);

      const lead = intent && intent.entity
        ? `How to ${intent.action} ${_withArticle(intent.entity)} (from "${topArticle.title}")`
        : `How to do this (from "${topArticle.title}")`;

      return {
        mode: 'how',
        title: 'Procedure',
        lead,
        lines: steps.length ? steps : ['Open the primary documentation article and follow its full steps.'],
      };
    }

    if (questionType === 'where') {
      return {
        mode: 'where',
        title: 'Where To Find It',
        lead: `Based on "${topArticle.title}":`,
        lines: topLines.length ? topLines : ['Open the primary documentation article to locate the exact menu path.'],
      };
    }

    if (questionType === 'why') {
      return {
        mode: 'why',
        title: 'Why It Matters',
        lead: `From "${topArticle.title}":`,
        lines: topLines.length ? topLines : ['The documentation explains the purpose and expected outcome in the linked article.'],
      };
    }

    if (questionType === 'what') {
      return {
        mode: 'what',
        title: 'What It Is',
        lead: `From "${topArticle.title}":`,
        lines: topLines.length ? topLines : ['Open the primary documentation article for the exact definition and scope.'],
      };
    }

    if (questionType === 'when') {
      return {
        mode: 'when',
        title: 'When To Use It',
        lead: `From "${topArticle.title}":`,
        lines: topLines.length ? topLines : ['Use the linked article for timing, prerequisites, and order of actions.'],
      };
    }

    if (questionType === 'who' || questionType === 'decision') {
      return {
        mode: questionType,
        title: 'Answer',
        lead: `From "${topArticle.title}":`,
        lines: topLines.length ? topLines : ['The linked documentation provides the exact eligibility and rule details.'],
      };
    }

    return {
      mode: 'general',
      title: 'Answer',
      lead: `From "${topArticle.title}":`,
      lines: topLines.length ? topLines : ['Open the primary documentation article for the complete answer.'],
    };
  }

  static _buildProcedurePayload(topArticle, intent, matchedTerms) {
    const listSteps = _extractListStepsFromHtml(topArticle && topArticle.contentHtml);
    const sentenceSteps = _extractSentenceSteps(topArticle && topArticle.plainText, matchedTerms || []);
    const steps = _dedupe(listSteps.concat(sentenceSteps)).slice(0, 4);

    const actionLabel = intent && intent.entity
      ? `To ${intent.action} ${_withArticle(intent.entity)}`
      : 'Follow these documented steps';

    const normalizedSteps = steps
      .map((step) => _sentenceCase(step.replace(/\s+/g, ' ').trim()))
      .filter(Boolean);

    return {
      sourceTitle: topArticle && topArticle.title,
      lead: `${actionLabel}, use this procedure from "${topArticle.title}".`,
      steps: normalizedSteps.length ? normalizedSteps : [
        'Open the primary documentation article below and follow its full procedure.'
      ],
    };
  }

  static _toDocHit(article, canonicalTerms = [], expandedTerms = []) {
    return {
      title: article.title,
      topic: article.topic,
      subtopic: article.subtopic,
      excerpt: article.seoDescription || article.excerpt || '',
      url: '/legal/user-documentation/' + article.slug,
      contentType: 'article',
      typeLabel: 'Article',
      external: false,
      matchedKeywords: _collectMatchedKeywords(article, canonicalTerms),
      matchedTags: _collectMatchedTags(article, canonicalTerms, expandedTerms),
    };
  }

  static async getResponse(req, res) {
    try {
      const { query } = req.body;
      if (!query || query.trim().length === 0) {
        return res.json({ success: false, message: 'Please enter a question.' });
      }

      const q = query.trim();
      const nq = _normalize(q);
      const tokens = _tokenize(nq);
      const expandedTerms = _expandTokenSet(tokens);
      const coreTerms = _dedupe(
        tokens
          .map((term) => _canonicalizeToken(term))
          .filter((term) => term && term.length > 2 && !NON_CORE_QUERY_TERMS.has(term) && !ACTION_CANONICALS.has(term))
      );
      const canonicalTerms = _dedupe(expandedTerms.map((term) => _canonicalizeToken(term)));
      const intent = ChatbotController._deriveIntent(tokens, expandedTerms);
      const questionType = ChatbotController._detectQuestionType(q);

      const termLevelCandidates = _dedupe([
        ...coreTerms,
        ...canonicalTerms.filter((term) => term && !NON_CORE_QUERY_TERMS.has(term) && !ACTION_CANONICALS.has(term)),
        ...expandedTerms.filter((term) => term && !NON_CORE_QUERY_TERMS.has(term) && !ACTION_CANONICALS.has(term)),
      ]).filter((term) => term && term.length > 2).slice(0, 6);

      const queryCandidates = _dedupe([
        q,
        coreTerms.join(' '),
        canonicalTerms.slice(0, 8).join(' '),
        intent && intent.phrase,
        intent ? `how to ${intent.phrase}` : '',
        ...termLevelCandidates,
      ]).filter((candidate) => candidate && candidate.trim().length > 1);

      const articleResultSets = await Promise.all(
        queryCandidates.map((candidate) => {
          return searchDocumentationArticles(candidate, {
            includeDrafts: false,
            limit: 14,
          });
        })
      );

      const articleBySlug = new Map();
      articleResultSets.flat().forEach((article) => {
        if (!article || !article.slug) return;
        const existing = articleBySlug.get(article.slug);
        if (!existing || Number(article.rank || 0) > Number(existing.rank || 0)) {
          articleBySlug.set(article.slug, article);
        }
      });

      // Broader scan: rank entire docs catalog (including tags) and merge top candidates.
      const catalog = await ChatbotController._getDocumentationCatalog();
      const catalogCandidates = (catalog || [])
        .map((article) => ({
          article,
          score: ChatbotController._scoreCatalogArticle(article, nq, coreTerms, expandedTerms, intent, questionType),
        }))
        .filter((entry) => entry.score >= 10)
        .sort((left, right) => right.score - left.score)
        .slice(0, 32);

      catalogCandidates.forEach((entry) => {
        if (!entry || !entry.article || !entry.article.slug) return;
        const existing = articleBySlug.get(entry.article.slug);
        const rankedVariant = {
          ...entry.article,
          rank: Number(entry.article.rank || 0) + Math.min(0.6, entry.score / 220),
        };
        if (!existing) {
          articleBySlug.set(entry.article.slug, rankedVariant);
          return;
        }
        if (Number(rankedVariant.rank || 0) > Number(existing.rank || 0)) {
          articleBySlug.set(entry.article.slug, rankedVariant);
        }
      });

      const rankedEntries = Array.from(articleBySlug.values())
        .map((article) => ({
          article,
          score: ChatbotController._scoreArticle(article, nq, tokens, expandedTerms, intent, questionType),
        }))
        .filter((entry) => entry.score > 6)
        .sort((left, right) => right.score - left.score)
        .slice(0, 8);

      const rankedArticles = rankedEntries.map((entry) => entry.article);

      const hasBillingIntent = canonicalTerms.includes('billing');
      const hasSettingsIntent = canonicalTerms.includes('settings');
      const hasEmployeeIntent = canonicalTerms.includes('employee');
      const hasMainTeacherIntent = _hasMainTeacherIntent(q, tokens, expandedTerms);

      if (rankedArticles.length === 0) {
        if (hasBillingIntent) {
          const fallback = await searchDocumentationArticles('bills', { includeDrafts: false, limit: 5 });
          if (fallback.length > 0) {
            rankedEntries.push(...fallback.map((article) => ({
              article,
              score: ChatbotController._scoreArticle(article, nq, tokens, expandedTerms, intent, questionType),
            })));
            rankedEntries
              .sort((left, right) => right.score - left.score)
              .splice(8);
          }
        }
      }

      if (rankedEntries.length === 0) {
        return res.json({
          success: true,
          type: 'no_results',
          message: "I could not find this in the documentation. Please rephrase your request or open the documentation hub.",
          links: [
            { label: 'View Documentation', url: '/legal/user-documentation' },
          ],
        });
      }

      const pickPreferredPrimary = () => {
        if (hasMainTeacherIntent) {
          const preferredMainTeacher = rankedEntries.find((entry) => {
            const hay = _articleSearchHaystack(entry.article);
            return hay.includes('main teacher') || hay.includes('assign a main teacher') || hay.includes('class teacher');
          });
          if (preferredMainTeacher) return preferredMainTeacher.article;
        }

        if (questionType === 'where' && hasBillingIntent) {
          const preferredBilling = rankedEntries.find((entry) => {
            const title = _normalize(entry.article && entry.article.title);
            const topic = _normalize(entry.article && entry.article.topic);
            const header = _normalize([title, topic].join(' '));
            const navOrSetup = /\b(set up|setup|configure|manage|payment|paygira|bill|collection|invoice|fee)\b/.test(header);
            const explanatoryOnly = /\b(calculated|calculation|formula|computed)\b/.test(title);
            return navOrSetup && !explanatoryOnly;
          });
          if (preferredBilling) return preferredBilling.article;
        }

        if (questionType === 'where' && hasEmployeeIntent && hasSettingsIntent) {
          const preferredTeacherSettings = rankedEntries.find((entry) => {
            const title = _normalize(entry.article && entry.article.title);
            const topic = _normalize(entry.article && entry.article.topic);
            const header = _normalize([title, topic].join(' '));
            const employeeAdminDoc = /\b(employee|staff|teacher|permission|role)\b/.test(header);
            const reportSettingsDoc = /\breport settings\b/.test(title);
            return employeeAdminDoc && !reportSettingsDoc;
          });
          if (preferredTeacherSettings) return preferredTeacherSettings.article;
        }

        return rankedEntries[0].article;
      };

      let topArticle = pickPreferredPrimary();
      let confidenceReport = ChatbotController._computeMatchConfidence(topArticle, nq, coreTerms);
      const isLowConfidence = confidenceReport.confidence < 0.34
        || (coreTerms.length >= 2 && confidenceReport.coverage < 0.34 && confidenceReport.titleSimilarity < 0.24);
      const hasTooManyMissingCoreTerms = coreTerms.length >= 3
        && confidenceReport.unmatchedTerms.length >= 2
        && confidenceReport.coverage < 0.67;

      if ((isLowConfidence || hasTooManyMissingCoreTerms) && hasBillingIntent) {
        const billingEntry = rankedEntries.find((entry) => BILLING_PATTERN.test(_articleSearchHaystack(entry.article)));
        if (billingEntry) {
          topArticle = billingEntry.article;
          confidenceReport = ChatbotController._computeMatchConfidence(topArticle, nq, coreTerms);
        }
      }

      const stillLowConfidence = confidenceReport.confidence < 0.34
        || (coreTerms.length >= 2 && confidenceReport.coverage < 0.34 && confidenceReport.titleSimilarity < 0.24);
      const stillTooManyMissingCoreTerms = coreTerms.length >= 3
        && confidenceReport.unmatchedTerms.length >= 2
        && confidenceReport.coverage < 0.67;

      if (stillLowConfidence || stillTooManyMissingCoreTerms) {
        return res.json({
          success: true,
          type: 'no_results',
          message: "I could not find a reliable match for that in the documentation.",
          links: [
            { label: 'View Documentation', url: '/legal/user-documentation' },
          ],
        });
      }

      const answer = ChatbotController._buildAnswerPayload(topArticle, intent, canonicalTerms, q);

      // Prefer lines that explicitly mention key query words from full text when available.
      const evidenceLines = _extractNeedleSentences(
        topArticle && topArticle.plainText,
        _dedupe([...(coreTerms || []), ...(canonicalTerms || [])]).slice(0, 6)
      );
      const hasMainTeacherIntentNow = _hasMainTeacherIntent(q, tokens, expandedTerms);
      if (evidenceLines.length > 0 && answer && Array.isArray(answer.lines) && !hasMainTeacherIntentNow) {
        answer.lines = _dedupe(evidenceLines.concat(answer.lines)).slice(0, 5);
      }

      const primaryDoc = ChatbotController._toDocHit(topArticle, canonicalTerms, expandedTerms);

      const topScore = rankedEntries[0] ? rankedEntries[0].score : 0;
      const primaryTopic = _normalize(topArticle.topic || '');
      const relatedDocs = rankedEntries
        .filter((entry) => entry.article.slug !== topArticle.slug)
        .filter((entry) => topScore <= 0 || entry.score >= (topScore * 0.55))
        .map((entry) => ({
          hit: ChatbotController._toDocHit(entry.article, canonicalTerms, expandedTerms),
          score: entry.score,
          topic: _normalize(entry.article.topic || ''),
          billingRelevant: BILLING_PATTERN.test(_articleSearchHaystack(entry.article)),
          billingTitleRelevant: BILLING_PATTERN.test(_normalize(entry.article.title || '')),
        }))
        .filter((entry) => {
          if (hasBillingIntent && !entry.billingTitleRelevant) return false;
          const keywordCount = (entry.hit.matchedKeywords || []).length;
          if (keywordCount >= 2) return true;
          return Boolean(primaryTopic && entry.topic && primaryTopic === entry.topic && keywordCount >= 1);
        })
        .slice(0, 3)
        .map((entry) => entry.hit);

      const summary = `${answer.lead} ${answer.lines.length} point${answer.lines.length === 1 ? '' : 's'} available.`;

      return res.json({
        success: true,
        type: 'results',
        summary,
        answer,
        primaryDoc,
        relatedDocs,
        faqHits: [],
        docHits: [primaryDoc].concat(relatedDocs),
      });
    } catch (error) {
      return res.json({
        success: false,
        message: "I'm having trouble searching the documentation right now. Please try again.",
        links: [
          { label: 'Documentation', url: '/legal/user-documentation' },
        ],
      });
    }
  }

  // Return popular documentation links for the welcome screen
  static async getPopularQuestions(req, res) {
    try {
      const docs = await listDocumentationArticles({ includeDrafts: false });
      const topDocs = docs
        .filter((article) => article && article.slug && article.title)
        .sort((left, right) => {
          const leftFeatured = left.featured ? 1 : 0;
          const rightFeatured = right.featured ? 1 : 0;
          if (leftFeatured !== rightFeatured) return rightFeatured - leftFeatured;
          const leftUpdated = new Date(left.updatedAt || 0).getTime();
          const rightUpdated = new Date(right.updatedAt || 0).getTime();
          return rightUpdated - leftUpdated;
        })
        .slice(0, 3)
        .map((article) => ({
          question: article.title,
          url: '/legal/user-documentation/' + article.slug,
        }));

      return res.json({ success: true, questions: topDocs });
    } catch (error) {
      return res.json({ success: false, message: 'Unable to load documentation suggestions' });
    }
  }

  // FAQ endpoint kept only for backward compatibility, but disabled by design.
  static getFAQById(req, res) {
    return res.json({
      success: false,
      message: 'FAQ responses are disabled. Please use documentation search.',
    });
  }
}

module.exports = ChatbotController;
