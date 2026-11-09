const crypto = require('crypto');
const he = require('he');
const sanitizeHtml = require('./sanitizeHtml');
const db = require('../config/db');

const DEFAULT_TOPICS = require('./docs/catalog').TOPICS.map((topic) => topic.name);

const QUICK_START_RESOURCES = [
  {
    key: 'full-user-documentation',
    title: 'Full User Documentation',
    subtitle: 'Complete platform guide',
    description: 'The full Google Doc guide for the entire platform.',
    type: 'link',
    url: 'https://docs.google.com/document/d/1bgFP5cCQyr-9jdaYZTsWO8ONAnAuNUKqKQ2if_4TBOM/edit?usp=drivesdk',
    external: true,
  },
  {
    key: 'walk-through-video',
    title: 'Walk Through Video',
    subtitle: 'Official walkthrough playlist',
    description: 'Watch the official Managira walkthrough directly in the page.',
    type: 'youtube',
    url: 'https://www.youtube.com/watch?v=y1J0KahfA-c&list=PLxNl6NDBQVL3A7mSgYcUKqTZ8WaB5IZOT&index=1&t=8s',
    embedUrl: 'https://www.youtube-nocookie.com/embed/y1J0KahfA-c?list=PLxNl6NDBQVL3A7mSgYcUKqTZ8WaB5IZOT',
    external: true,
  },
  {
    key: 'single-school-sign-up',
    title: 'Single School Sign Up Steps',
    subtitle: 'Step-by-step PDF',
    description: 'Download the PDF for single-school onboarding.',
    type: 'file',
    url: '/managira%20pdf/Single%20school%20Sign%20Up%20steps.pdf',
    external: true,
  },
  {
    key: 'starter-pack',
    title: 'Managira Starter Pack',
    subtitle: 'Quick-start PDF resource',
    description: 'A compact starter pack for first-time setup and orientation.',
    type: 'file',
    url: '/managira%20pdf/Managira%20Starter%20Pack.pdf',
    external: true,
  },
  {
    key: 'features-brochure',
    title: 'Features Driving Managira Brochure',
    subtitle: 'Feature overview brochure',
    description: 'Download the brochure that summarizes the platform capabilities.',
    type: 'file',
    url: '/managira%20pdf/Features%20driving%20managira%20Brochure.pdf',
    external: true,
  },
];

// Articles are written in code (utils/docs/articles) and synced by slug on start-up.
const docsCatalog = require('./docs/catalog');
const DEFAULT_ARTICLES = docsCatalog.syncRows();
const CANONICAL_ARTICLE_SYNC = DEFAULT_ARTICLES;

let schemaReady = false;
let schemaPromise = null;

const CODE_CLASSES = [
  'language-javascript',
  'language-js',
  'language-json',
  'language-html',
  'language-css',
  'language-bash',
  'language-shell',
  'language-sql',
  'language-text',
];

const TAG_CORRECTIONS_BY_SLUG = {
  'install-managira-on-your-device': ['mobile app', 'desktop app', 'pwa install', 'iphone', 'home screen shortcut'],
  'register-a-school-and-complete-first-time-setup': ['school registration', 'first-time setup', 'new school setup', 'account setup'],
  'create-school-years-classes-terms-and-set-the-current-term': ['school year', 'term setup', 'current term', 'term dates', 'overlap validation'],
  'report-settings': ['report settings', 'report signature', 'promotion settings', 'grading remarks', 'paygira reporting'],
  'edit-student-information': ['manage students', 'edit student', 'student records', 'student profile'],
  'create-and-manage-bulk-student-records': ['bulk student import', 'student records', 'admissions', 'csv import', 'enrollment'],
  'online-admission': ['online admission', 'student application', 'admissions', 'student registration', 'enrollment'],
  'troubleshooting-common-issues': ['troubleshooting', 'attendance issues', 'report issues', 'login issues', 'plan features'],
};

const TAG_TEXT_REPLACEMENTS = [
  [/\benrollement\b/gi, 'enrollment'],
  [/\bprotal\b/gi, 'portal'],
  [/\s+/g, ' '],
];

function buildCanonicalDocumentationUrl(slug = '') {
  const suffix = slug ? `/${slug}` : '';
  return `https://managira.com/legal/user-documentation${suffix}`;
}

function collapseWhitespace(value) {
  return String(value || '').replace(/\s+/g, ' ').trim();
}

function sanitizeTextField(value, maxLength = 255) {
  return collapseWhitespace(value).slice(0, maxLength);
}

function slugify(value) {
  const normalized = String(value || '')
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .replace(/-{2,}/g, '-');

  return normalized || 'article';
}

function compactAttributes(attributes) {
  return Object.fromEntries(
    Object.entries(attributes || {}).filter(([, value]) => value !== undefined && value !== null && value !== '')
  );
}

function sanitizeArticleContent(html) {
  const cleanHtml = sanitizeHtml(String(html || ''), {
    allowedTags: [
      'h2', 'h3', 'h4', 'p', 'strong', 'em', 'b', 'i', 'u', 's', 'ul', 'ol', 'li', 'blockquote',
      'code', 'pre', 'a', 'img', 'figure', 'figcaption', 'iframe', 'video', 'source',
      'div', 'span', 'hr', 'table', 'thead', 'tbody', 'tr', 'th', 'td', 'br', 'wbr', 'mark'
    ],
    allowedAttributes: {
      p: ['class'],
      a: ['href', 'target', 'rel', 'title', 'class'],
      img: ['src', 'alt', 'title', 'class', 'data-caption'],
      figure: ['class', 'style'],
      figcaption: ['class'],
      iframe: ['src', 'allow', 'allowfullscreen', 'frameborder', 'title', 'loading', 'class'],
      video: ['src', 'controls', 'playsinline', 'preload', 'poster', 'class'],
      source: ['src', 'type'],
      div: ['class', 'data-callout'],
      span: ['class', 'style'],
      code: ['class'],
      pre: ['class'],
      table: ['class'],
      th: ['colspan', 'rowspan', 'scope'],
      td: ['colspan', 'rowspan', 'data-label'],
      hr: ['class'],
      mark: ['class'],
    },
    allowedStyles: {
      figure: {
        width: [/^\d+(?:\.\d+)?(?:px|%)$/],
        'max-width': [/^\d+(?:\.\d+)?(?:px|%)$/],
      },
      span: {
        'font-weight': [/^(?:normal|bold|[1-9]00)$/i],
        'font-style': [/^(?:normal|italic)$/i],
        'text-decoration': [/^(?:none|underline|line-through)$/i],
      },
    },
    allowedClasses: {
      div: ['doc-callout', 'doc-callout--info', 'doc-callout--warning', 'doc-callout--tip'],
      figure: ['doc-media', 'doc-image', 'doc-video', 'doc-attachment'],
      a: ['doc-attachment-card'],
      img: ['doc-inline-image'],
      iframe: ['doc-youtube-embed'],
      video: ['doc-inline-video'],
      pre: CODE_CLASSES,
      code: CODE_CLASSES,
      hr: ['doc-divider'],
    },
    allowedSchemes: ['http', 'https', 'mailto', 'tel', 'data'],
    allowedSchemesByTag: {
      img: ['http', 'https', 'data'],
      source: ['http', 'https'],
      video: ['http', 'https'],
      iframe: ['https'],
      a: ['http', 'https', 'mailto', 'tel'],
    },
    transformTags: {
      b: 'strong',
      i: 'em',
      a: (tagName, attribs) => {
        const href = collapseWhitespace(attribs.href || '');
        if (!href) {
          return { tagName: 'span', text: '' };
        }

        const transformed = {
          tagName,
          attribs: compactAttributes({
            href,
            title: attribs.title || undefined,
            class: attribs.class || undefined,
          }),
        };

        if (attribs.target === '_blank') {
          transformed.attribs.target = '_blank';
          transformed.attribs.rel = 'noopener noreferrer';
        }

        return transformed;
      },
      iframe: (tagName, attribs) => {
        const src = collapseWhitespace(attribs.src || '');
        const isTrusted = /^https:\/\/(www\.)?youtube(-nocookie)?\.com\//i.test(src);
        if (!isTrusted) {
          return { tagName: 'div', text: '' };
        }

        return {
          tagName,
          attribs: {
            src,
            allow: attribs.allow || 'accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share',
            allowfullscreen: 'allowfullscreen',
            frameborder: '0',
            title: attribs.title || 'Embedded video',
            loading: 'lazy',
            class: 'doc-youtube-embed',
          },
        };
      },
      img: (tagName, attribs) => ({
        tagName,
        attribs: compactAttributes({
          src: collapseWhitespace(attribs.src || ''),
          alt: sanitizeTextField(attribs.alt || 'Documentation image', 200),
          title: sanitizeTextField(attribs.title || '', 200) || undefined,
          class: 'doc-inline-image',
          'data-caption': sanitizeTextField(attribs['data-caption'] || '', 240) || undefined,
        }),
      }),
    },
  });

  const normalizeHeadingLikeBodyText = (fullMatch, level, innerHtml) => {
    const plain = stripHtml(innerHtml || '');
    const wordCount = plain ? plain.split(/\s+/).filter(Boolean).length : 0;
    // Headings are usually short labels. Long sentence-like headings are most
    // often accidental formatting from contenteditable and should be paragraphs.
    if (wordCount >= 14) {
      return `<p>${innerHtml}</p>`;
    }
    return fullMatch;
  };

  return cleanHtml
    // If users accidentally wrap full blocks inside headings, flatten those wrappers
    // so paragraph/list formatting and normal-weight text survive round-trips.
    .replace(/<h([2-4])>\s*<(p|ul|ol|div|table|blockquote|pre)([^>]*)>([\s\S]*?)<\/\2>\s*<\/h\1>/gi, '<$2$3>$4</$2>')
    .replace(/<h([2-4])>([\s\S]*?)<\/h\1>/gi, normalizeHeadingLikeBodyText)
    .replace(/<h([2-4])>\s*<br\s*\/?>(?:\s|&nbsp;)*<\/h\1>/gi, '')
    .replace(/<h([2-4])>\s*<\/h\1>/gi, '')
    .replace(/<p>\s*<\/p>/g, '')
    .replace(/<p>\s*(<br\s*\/?>)\s*<\/p>/g, '')
    .trim();
}

function stripHtml(value) {
  const plain = sanitizeHtml(String(value || ''), {
    allowedTags: [],
    allowedAttributes: {},
  });

  return collapseWhitespace(he.decode(plain));
}

function summarizeText(value, query = '', maxLength = 180) {
  const text = stripHtml(value);
  if (!text) return '';

  const normalizedQuery = collapseWhitespace(query).toLowerCase();
  if (!normalizedQuery) {
    return text.length > maxLength ? `${text.slice(0, maxLength - 1).trim()}…` : text;
  }

  const matchIndex = text.toLowerCase().indexOf(normalizedQuery);
  if (matchIndex === -1) {
    return text.length > maxLength ? `${text.slice(0, maxLength - 1).trim()}…` : text;
  }

  const start = Math.max(0, matchIndex - Math.floor(maxLength / 3));
  const end = Math.min(text.length, start + maxLength);
  const prefix = start > 0 ? '…' : '';
  const suffix = end < text.length ? '…' : '';
  return `${prefix}${text.slice(start, end).trim()}${suffix}`;
}

function normalizeTags(value) {
  const rawTags = Array.isArray(value)
    ? value
    : String(value || '').split(',');

  const normalized = [];
  const seen = new Set();

  rawTags.forEach((tag) => {
    let nextTag = sanitizeTextField(tag, 80);
    TAG_TEXT_REPLACEMENTS.forEach(([pattern, replacement]) => {
      nextTag = nextTag.replace(pattern, replacement);
    });
    nextTag = nextTag.toLowerCase().trim();
    if (!nextTag) return;
    const key = nextTag;
    if (seen.has(key)) return;
    seen.add(key);
    normalized.push(nextTag);
  });

  return normalized.slice(0, 8);
}

async function applyProfessionalTagCorrections(database = db) {
  const result = await database.query('SELECT id, slug, tags FROM documentation_articles');

  for (const row of result.rows) {
    const slug = String(row.slug || '').trim();
    const currentTags = Array.isArray(row.tags) ? row.tags : [];
    const preferredTags = TAG_CORRECTIONS_BY_SLUG[slug];
    const nextTags = normalizeTags(preferredTags || currentTags);

    const currentSerialized = JSON.stringify(currentTags);
    const nextSerialized = JSON.stringify(nextTags);
    if (currentSerialized === nextSerialized) {
      continue;
    }

    await database.query(
      `UPDATE documentation_articles
          SET tags = $2,
              updated_at = CURRENT_TIMESTAMP
        WHERE id = $1`,
      [row.id, nextTags]
    );
  }
}

function normalizeMedia(value) {
  let media = value;
  if (typeof media === 'string') {
    try {
      media = JSON.parse(media);
    } catch (_) {
      media = [];
    }
  }

  if (!Array.isArray(media)) {
    return [];
  }

  return media
    .map((item) => ({
      type: sanitizeTextField(item && item.type, 32),
      url: collapseWhitespace(item && item.url),
      s3Key: sanitizeTextField(item && item.s3Key, 255),
      title: sanitizeTextField(item && item.title, 200),
      caption: sanitizeTextField(item && item.caption, 240),
      alt: sanitizeTextField(item && item.alt, 200),
      mimeType: sanitizeTextField(item && item.mimeType, 120),
      filename: sanitizeTextField(item && item.filename, 255),
      embedUrl: collapseWhitespace(item && item.embedUrl),
    }))
    .filter((item) => item.type && (item.url || item.embedUrl));
}

function mapArticleRow(row) {
  if (!row) return null;

  const contentHtml = sanitizeArticleContent(row.content_html || '');
  const plainText = stripHtml(contentHtml);
  const topic = sanitizeTextField(row.topic, 120);
  const subtopic = sanitizeTextField(row.subtopic || '', 120);

  return {
    id: Number(row.id),
    slug: row.slug,
    title: sanitizeTextField(row.title, 200),
    topic,
    subtopic,
    status: row.status === 'draft' ? 'draft' : 'active',
    featured: Boolean(row.featured),
    tags: Array.isArray(row.tags) ? row.tags.filter(Boolean) : [],
    seoDescription: sanitizeTextField(row.seo_description || '', 320),
    contentHtml,
    plainText,
    excerpt: summarizeText(contentHtml),
    media: normalizeMedia(row.media),
    createdBy: row.created_by || null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    helpfulYes: Number(row.helpful_yes || 0),
    helpfulNo: Number(row.helpful_no || 0),
    breadcrumb: [topic, subtopic, sanitizeTextField(row.title, 200)].filter(Boolean),
  };
}

function buildTopicTree(articles) {
  const byTopic = new Map();

  for (const article of articles) {
    if (!byTopic.has(article.topic)) {
      byTopic.set(article.topic, { topic: article.topic, subtopics: new Map(), articles: [] });
    }

    const topicEntry = byTopic.get(article.topic);
    if (article.subtopic) {
      if (!topicEntry.subtopics.has(article.subtopic)) {
        topicEntry.subtopics.set(article.subtopic, []);
      }
      topicEntry.subtopics.get(article.subtopic).push(article);
    } else {
      topicEntry.articles.push(article);
    }
  }

  const tree = Array.from(byTopic.values()).map((entry) => ({
    topic: entry.topic,
    articles: entry.articles.sort((left, right) => left.title.localeCompare(right.title)),
    subtopics: Array.from(entry.subtopics.entries())
      .sort((left, right) => left[0].localeCompare(right[0]))
      .map(([subtopic, articlesForSubtopic]) => ({
        subtopic,
        articles: articlesForSubtopic.sort((left, right) => left.title.localeCompare(right.title)),
      })),
  }));

  tree.sort((left, right) => {
    const leftIndex = DEFAULT_TOPICS.indexOf(left.topic);
    const rightIndex = DEFAULT_TOPICS.indexOf(right.topic);
    if (leftIndex === -1 && rightIndex === -1) return left.topic.localeCompare(right.topic);
    if (leftIndex === -1) return 1;
    if (rightIndex === -1) return -1;
    return leftIndex - rightIndex;
  });

  return tree;
}

function buildIndexEntry(article) {
  return {
    id: article.id,
    slug: article.slug,
    title: article.title,
    topic: article.topic,
    subtopic: article.subtopic,
    status: article.status,
    featured: article.featured,
    tags: article.tags,
    seoDescription: article.seoDescription,
    excerpt: summarizeText(article.plainText, '', 160),
    plainText: article.plainText,
    updatedAt: article.updatedAt,
    breadcrumb: article.breadcrumb,
  };
}

function normalizeArticleInput(data) {
  const title = sanitizeTextField(data.title, 200);
  const topic = sanitizeTextField(data.topic, 120);
  const subtopic = sanitizeTextField(data.subtopic || '', 120);
  const status = String(data.status || '').trim().toLowerCase() === 'draft' ? 'draft' : 'active';
  const featured = Boolean(data.featured);
  const tags = normalizeTags(data.tags);
  const seoDescription = sanitizeTextField(data.seoDescription || data.seo_description || '', 320);
  const contentHtml = sanitizeArticleContent(data.contentHtml || data.content_html || '');
  const media = normalizeMedia(data.media);

  if (!title) {
    throw new Error('Title is required.');
  }

  if (!topic) {
    throw new Error('Topic is required.');
  }

  return {
    title,
    topic,
    subtopic: subtopic || null,
    status,
    featured,
    tags,
    seoDescription: seoDescription || null,
    contentHtml,
    media,
  };
}

async function generateUniqueSlug(title, database = db, excludeId = null) {
  const baseSlug = slugify(title);
  let candidate = baseSlug;
  let counter = 2;

  while (true) {
    const params = excludeId ? [candidate, excludeId] : [candidate];
    const sql = excludeId
      ? 'SELECT 1 FROM documentation_articles WHERE slug = $1 AND id <> $2 LIMIT 1'
      : 'SELECT 1 FROM documentation_articles WHERE slug = $1 LIMIT 1';
    const result = await database.query(sql, params);
    if (result.rows.length === 0) {
      return candidate;
    }
    candidate = `${baseSlug}-${counter}`;
    counter += 1;
  }
}

async function seedDefaultArticles(database) {
  for (const article of DEFAULT_ARTICLES) {
    const slug = await generateUniqueSlug(article.title, database);
    await database.query(
      `INSERT INTO documentation_articles (
        slug, title, topic, subtopic, status, featured, tags, seo_description, content_html, media, created_by
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
      [
        slug,
        article.title,
        article.topic,
        article.subtopic || null,
        article.status || 'active',
        Boolean(article.featured),
        article.tags || [],
        article.seoDescription || null,
        sanitizeArticleContent(article.contentHtml || ''),
        JSON.stringify(article.media || []),
        null,
      ]
    );
  }
}

async function syncCanonicalDocumentationArticles(database) {
  for (const article of CANONICAL_ARTICLE_SYNC) {
    await database.query(
      `INSERT INTO documentation_articles (
         slug, title, topic, subtopic, status, featured, tags, seo_description, content_html, media, created_by
       ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
       ON CONFLICT (slug) DO UPDATE SET
         title = EXCLUDED.title,
         topic = EXCLUDED.topic,
         subtopic = EXCLUDED.subtopic,
         status = EXCLUDED.status,
         featured = EXCLUDED.featured,
         tags = EXCLUDED.tags,
         seo_description = EXCLUDED.seo_description,
         content_html = EXCLUDED.content_html,
         updated_at = NOW()
       WHERE (documentation_articles.title, documentation_articles.topic, documentation_articles.subtopic, documentation_articles.status,
              documentation_articles.featured, documentation_articles.tags, documentation_articles.seo_description, documentation_articles.content_html)
         IS DISTINCT FROM
             (EXCLUDED.title, EXCLUDED.topic, EXCLUDED.subtopic, EXCLUDED.status,
              EXCLUDED.featured, EXCLUDED.tags, EXCLUDED.seo_description, EXCLUDED.content_html)`,
      [
        article.slug,
        article.title,
        article.topic,
        article.subtopic || null,
        article.status || 'active',
        Boolean(article.featured),
        article.tags || [],
        article.seoDescription || null,
        sanitizeArticleContent(article.contentHtml || ''),
        JSON.stringify(article.media || []),
        null,
      ]
    );
  }
  // Older copies of a guide now answer with a redirect (docsCatalog.REDIRECTS): keep them out of lists.
  await database.query(
    "UPDATE documentation_articles SET status = 'draft', updated_at = NOW() WHERE slug = ANY($1::text[]) AND status <> 'draft'",
    [Object.keys(docsCatalog.REDIRECTS)]
  );
}

// Writing help center content (table setup and the article sync) happens only in production or
// on a database on this computer. A development server pointed at the hosted database reads it
// and previews the articles in code (withCatalogPreview), so unfinished guides never reach schools.
function documentationWritesAllowed() {
  if (process.env.NODE_ENV === 'production') return true;
  return /@(localhost|127\.0\.0\.1|\[::1\])[:/]/.test(String(process.env.DB_CONNECTION_STRING || ''));
}

function withCatalogPreview(rows) {
  if (documentationWritesAllowed()) return rows;
  const bySlug = new Map(rows.map((row) => [row.slug, row]));
  let previewId = -1;
  for (const article of CANONICAL_ARTICLE_SYNC) {
    const existing = bySlug.get(article.slug);
    bySlug.set(article.slug, {
      ...(existing || { id: previewId--, created_by: null, created_at: new Date(), updated_at: new Date(), helpful_yes: 0, helpful_no: 0 }),
      slug: article.slug,
      title: article.title,
      topic: article.topic,
      subtopic: article.subtopic || null,
      status: article.status || 'active',
      featured: Boolean(article.featured),
      tags: article.tags || [],
      seo_description: article.seoDescription || null,
      content_html: article.contentHtml || '',
      media: article.media || [],
    });
  }
  const retired = new Set(Object.keys(docsCatalog.REDIRECTS));
  return [...bySlug.values()].map((row) => (retired.has(row.slug) ? { ...row, status: 'draft' } : row));
}

async function ensureDocumentationSchema(database = db) {
  if (schemaReady) {
    return;
  }
  if (!documentationWritesAllowed()) {
    schemaReady = true;
    return;
  }

  if (schemaPromise) {
    await schemaPromise;
    return;
  }

  schemaPromise = (async () => {
    await database.query(`
      CREATE TABLE IF NOT EXISTS documentation_articles (
        id SERIAL PRIMARY KEY,
        slug TEXT NOT NULL UNIQUE,
        title TEXT NOT NULL,
        topic TEXT NOT NULL,
        subtopic TEXT,
        status TEXT NOT NULL DEFAULT 'draft',
        featured BOOLEAN NOT NULL DEFAULT FALSE,
        tags TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
        seo_description TEXT,
        content_html TEXT NOT NULL DEFAULT '',
        media JSONB NOT NULL DEFAULT '[]'::jsonb,
        created_by INTEGER REFERENCES users(user_id) ON DELETE SET NULL,
        created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        helpful_yes INTEGER NOT NULL DEFAULT 0,
        helpful_no INTEGER NOT NULL DEFAULT 0
      )
    `);

    await database.query(`
      ALTER TABLE documentation_articles
      ADD COLUMN IF NOT EXISTS slug TEXT
    `);
    await database.query(`
      ALTER TABLE documentation_articles
      ADD COLUMN IF NOT EXISTS topic TEXT
    `);
    await database.query(`
      ALTER TABLE documentation_articles
      ADD COLUMN IF NOT EXISTS subtopic TEXT
    `);
    await database.query(`
      ALTER TABLE documentation_articles
      ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'draft'
    `);
    await database.query(`
      ALTER TABLE documentation_articles
      ADD COLUMN IF NOT EXISTS featured BOOLEAN NOT NULL DEFAULT FALSE
    `);
    await database.query(`
      ALTER TABLE documentation_articles
      ADD COLUMN IF NOT EXISTS tags TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[]
    `);
    await database.query(`
      ALTER TABLE documentation_articles
      ADD COLUMN IF NOT EXISTS seo_description TEXT
    `);
    await database.query(`
      ALTER TABLE documentation_articles
      ADD COLUMN IF NOT EXISTS content_html TEXT NOT NULL DEFAULT ''
    `);
    await database.query(`
      ALTER TABLE documentation_articles
      ADD COLUMN IF NOT EXISTS media JSONB NOT NULL DEFAULT '[]'::jsonb
    `);
    await database.query(`
      ALTER TABLE documentation_articles
      ADD COLUMN IF NOT EXISTS created_by INTEGER REFERENCES users(user_id) ON DELETE SET NULL
    `);
    await database.query(`
      ALTER TABLE documentation_articles
      ADD COLUMN IF NOT EXISTS created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
    `);
    await database.query(`
      ALTER TABLE documentation_articles
      ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
    `);
    await database.query(`
      ALTER TABLE documentation_articles
      ADD COLUMN IF NOT EXISTS helpful_yes INTEGER NOT NULL DEFAULT 0
    `);
    await database.query(`
      ALTER TABLE documentation_articles
      ADD COLUMN IF NOT EXISTS helpful_no INTEGER NOT NULL DEFAULT 0
    `);

    await database.query(`
      UPDATE documentation_articles
      SET slug = COALESCE(NULLIF(slug, ''), 'article-' || id)
      WHERE slug IS NULL OR slug = ''
    `);

    await database.query(`
      DO $$
      BEGIN
        IF EXISTS (
          SELECT 1 FROM pg_constraint WHERE conname = 'documentation_articles_status_check'
        ) THEN
          ALTER TABLE documentation_articles DROP CONSTRAINT documentation_articles_status_check;
        END IF;

        ALTER TABLE documentation_articles
        ADD CONSTRAINT documentation_articles_status_check
        CHECK (status IN ('draft', 'active'));
      END $$
    `);

    await database.query(`
      CREATE INDEX IF NOT EXISTS idx_documentation_articles_status
      ON documentation_articles(status)
    `);
    await database.query(`
      CREATE INDEX IF NOT EXISTS idx_documentation_articles_topic
      ON documentation_articles(topic, subtopic)
    `);
    await database.query(`
      CREATE INDEX IF NOT EXISTS idx_documentation_articles_updated_at
      ON documentation_articles(updated_at DESC)
    `);
    await database.query(`
      CREATE INDEX IF NOT EXISTS idx_documentation_articles_tags
      ON documentation_articles USING GIN(tags)
    `);

    await database.query(`
      CREATE TABLE IF NOT EXISTS documentation_article_feedback (
        id SERIAL PRIMARY KEY,
        article_id INTEGER NOT NULL REFERENCES documentation_articles(id) ON DELETE CASCADE,
        fingerprint_hash TEXT NOT NULL,
        vote TEXT NOT NULL,
        created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(article_id, fingerprint_hash)
      )
    `);

    await database.query(`
      DO $$
      BEGIN
        IF EXISTS (
          SELECT 1 FROM pg_constraint WHERE conname = 'documentation_article_feedback_vote_check'
        ) THEN
          ALTER TABLE documentation_article_feedback DROP CONSTRAINT documentation_article_feedback_vote_check;
        END IF;

        ALTER TABLE documentation_article_feedback
        ADD CONSTRAINT documentation_article_feedback_vote_check
        CHECK (vote IN ('yes', 'no'));
      END $$
    `);

    const countResult = await database.query('SELECT COUNT(*)::int AS total FROM documentation_articles');
    if (Number(countResult.rows[0] && countResult.rows[0].total) === 0) {
      await seedDefaultArticles(database);
    }

    await syncCanonicalDocumentationArticles(database);
    await applyProfessionalTagCorrections(database);

    schemaReady = true;
  })();

  try {
    await schemaPromise;
  } finally {
    schemaPromise = null;
  }
}

// The cleaned article list, kept for a minute (cleaning every article on every page view was
// the slowest part of the help center). Any change made here clears it at once.
const LIST_CACHE_MS = 60 * 1000;
const listCache = new Map();
function clearDocumentationCache() {
  listCache.clear();
}

async function listDocumentationArticles(options = {}) {
  const {
    includeDrafts = false,
    database = db,
  } = options;

  await ensureDocumentationSchema(database);

  const cacheKey = includeDrafts ? 'all' : 'active';
  const hit = database === db ? listCache.get(cacheKey) : null;
  if (hit && Date.now() - hit.at < LIST_CACHE_MS) return hit.articles;

  const result = await database.query(
    `SELECT id, slug, title, topic, subtopic, status, featured, tags, seo_description,
            content_html, media, created_by, created_at, updated_at, helpful_yes, helpful_no
       FROM documentation_articles
      WHERE ($1::boolean = TRUE OR status = 'active')
      ORDER BY
        CASE status WHEN 'active' THEN 0 ELSE 1 END,
        topic ASC,
        subtopic ASC NULLS FIRST,
        featured DESC,
        updated_at DESC,
        title ASC`,
    [includeDrafts]
  );

  const articles = withCatalogPreview(result.rows)
    .filter((row) => includeDrafts || row.status === 'active')
    .map(mapArticleRow);
  if (database === db) listCache.set(cacheKey, { at: Date.now(), articles });
  return articles;
}

async function getDocumentationArticleBySlug(slug, options = {}) {
  const {
    includeDrafts = false,
    database = db,
  } = options;

  await ensureDocumentationSchema(database);
  const result = await database.query(
    `SELECT id, slug, title, topic, subtopic, status, featured, tags, seo_description,
            content_html, media, created_by, created_at, updated_at, helpful_yes, helpful_no
       FROM documentation_articles
      WHERE slug = $1
        AND ($2::boolean = TRUE OR status = 'active')
      LIMIT 1`,
    [slug, includeDrafts]
  );

  return mapArticleRow(result.rows[0]);
}

async function getDocumentationArticleById(id, options = {}) {
  const {
    includeDrafts = true,
    database = db,
  } = options;

  await ensureDocumentationSchema(database);
  const result = await database.query(
    `SELECT id, slug, title, topic, subtopic, status, featured, tags, seo_description,
            content_html, media, created_by, created_at, updated_at, helpful_yes, helpful_no
       FROM documentation_articles
      WHERE id = $1
        AND ($2::boolean = TRUE OR status = 'active')
      LIMIT 1`,
    [id, includeDrafts]
  );

  return mapArticleRow(result.rows[0]);
}

async function searchDocumentationArticles(query, options = {}) {
  const {
    includeDrafts = false,
    limit = 10,
    database = db,
  } = options;

  await ensureDocumentationSchema(database);
  const normalizedQuery = collapseWhitespace(query);
  if (!normalizedQuery) {
    return [];
  }

  const likeQuery = `%${normalizedQuery}%`;
  const result = await database.query(
    `SELECT id, slug, title, topic, subtopic, status, featured, tags, seo_description,
            content_html, media, created_by, created_at, updated_at, helpful_yes, helpful_no,
            ts_rank(
              to_tsvector(
                'simple',
                coalesce(title, '') || ' ' ||
                coalesce(topic, '') || ' ' ||
                coalesce(subtopic, '') || ' ' ||
                array_to_string(tags, ' ') || ' ' ||
                coalesce(seo_description, '') || ' ' ||
                regexp_replace(coalesce(content_html, ''), '<[^>]+>', ' ', 'g')
              ),
              plainto_tsquery('simple', $1)
            ) AS rank
       FROM documentation_articles
      WHERE ($2::boolean = TRUE OR status = 'active')
        AND (
          to_tsvector(
            'simple',
            coalesce(title, '') || ' ' ||
            coalesce(topic, '') || ' ' ||
            coalesce(subtopic, '') || ' ' ||
            array_to_string(tags, ' ') || ' ' ||
            coalesce(seo_description, '') || ' ' ||
            regexp_replace(coalesce(content_html, ''), '<[^>]+>', ' ', 'g')
          ) @@ plainto_tsquery('simple', $1)
          OR title ILIKE $3
          OR topic ILIKE $3
          OR coalesce(subtopic, '') ILIKE $3
          OR coalesce(seo_description, '') ILIKE $3
          OR array_to_string(tags, ' ') ILIKE $3
          OR regexp_replace(coalesce(content_html, ''), '<[^>]+>', ' ', 'g') ILIKE $3
        )
      ORDER BY rank DESC NULLS LAST, featured DESC, updated_at DESC
      LIMIT $4`,
    [normalizedQuery, includeDrafts, likeQuery, limit]
  );

  return result.rows.map((row) => {
    const article = mapArticleRow(row);
    return {
      ...article,
      excerpt: summarizeText(article.contentHtml || article.plainText, normalizedQuery, 180),
      rank: Number(row.rank || 0),
    };
  });
}

async function createDocumentationArticle(data, options = {}) {
  const {
    userId = null,
    database = db,
  } = options;

  await ensureDocumentationSchema(database);
  const normalized = normalizeArticleInput(data);
  const slug = await generateUniqueSlug(normalized.title, database);

  const result = await database.query(
    `INSERT INTO documentation_articles (
      slug, title, topic, subtopic, status, featured, tags, seo_description, content_html, media, created_by, updated_at
    ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,CURRENT_TIMESTAMP)
    RETURNING id, slug, title, topic, subtopic, status, featured, tags, seo_description,
              content_html, media, created_by, created_at, updated_at, helpful_yes, helpful_no`,
    [
      slug,
      normalized.title,
      normalized.topic,
      normalized.subtopic,
      normalized.status,
      normalized.featured,
      normalized.tags,
      normalized.seoDescription,
      normalized.contentHtml,
      JSON.stringify(normalized.media),
      userId,
    ]
  );

  return mapArticleRow(result.rows[0]);
}

async function updateDocumentationArticle(id, data, options = {}) {
  const {
    database = db,
  } = options;

  await ensureDocumentationSchema(database);
  const existing = await getDocumentationArticleById(id, { includeDrafts: true, database });
  if (!existing) {
    throw new Error('Article not found.');
  }

  const normalized = normalizeArticleInput(data);
  const slug = normalized.title === existing.title
    ? existing.slug
    : await generateUniqueSlug(normalized.title, database, id);

  const result = await database.query(
    `UPDATE documentation_articles
        SET slug = $2,
            title = $3,
            topic = $4,
            subtopic = $5,
            status = $6,
            featured = $7,
            tags = $8,
            seo_description = $9,
            content_html = $10,
            media = $11,
            updated_at = CURRENT_TIMESTAMP
      WHERE id = $1
      RETURNING id, slug, title, topic, subtopic, status, featured, tags, seo_description,
                content_html, media, created_by, created_at, updated_at, helpful_yes, helpful_no`,
    [
      id,
      slug,
      normalized.title,
      normalized.topic,
      normalized.subtopic,
      normalized.status,
      normalized.featured,
      normalized.tags,
      normalized.seoDescription,
      normalized.contentHtml,
      JSON.stringify(normalized.media),
    ]
  );

  return mapArticleRow(result.rows[0]);
}

async function setDocumentationArticleStatus(id, status, options = {}) {
  const {
    database = db,
  } = options;

  await ensureDocumentationSchema(database);
  const normalizedStatus = String(status || '').trim().toLowerCase() === 'draft' ? 'draft' : 'active';
  const result = await database.query(
    `UPDATE documentation_articles
        SET status = $2,
            updated_at = CURRENT_TIMESTAMP
      WHERE id = $1
      RETURNING id, slug, title, topic, subtopic, status, featured, tags, seo_description,
                content_html, media, created_by, created_at, updated_at, helpful_yes, helpful_no`,
    [id, normalizedStatus]
  );

  return mapArticleRow(result.rows[0]);
}

async function duplicateDocumentationArticle(id, options = {}) {
  const {
    userId = null,
    database = db,
  } = options;

  await ensureDocumentationSchema(database);
  const existing = await getDocumentationArticleById(id, { includeDrafts: true, database });
  if (!existing) {
    throw new Error('Article not found.');
  }

  return createDocumentationArticle({
    title: `${existing.title} (Copy)`,
    topic: existing.topic,
    subtopic: existing.subtopic,
    status: 'draft',
    featured: false,
    tags: existing.tags,
    seoDescription: existing.seoDescription,
    contentHtml: existing.contentHtml,
    media: existing.media,
  }, { userId, database });
}

async function deleteDocumentationArticle(id, options = {}) {
  const {
    database = db,
  } = options;

  await ensureDocumentationSchema(database);
  const result = await database.query(
    `DELETE FROM documentation_articles
      WHERE id = $1
      RETURNING id, slug, title, topic, subtopic, status, featured, tags, seo_description,
                content_html, media, created_by, created_at, updated_at, helpful_yes, helpful_no`,
    [id]
  );

  return mapArticleRow(result.rows[0]);
}

function createFeedbackFingerprint(req) {
  const fingerprintSource = [
    req.ip || req.headers['x-forwarded-for'] || '',
    req.headers['user-agent'] || '',
    req.headers['accept-language'] || '',
  ].join('::');

  return crypto.createHash('sha256').update(fingerprintSource).digest('hex');
}

async function recordHelpfulVote(articleId, vote, fingerprintHash, options = {}) {
  const {
    database = db,
  } = options;

  await ensureDocumentationSchema(database);
  const normalizedVote = String(vote || '').trim().toLowerCase() === 'no' ? 'no' : 'yes';

  const feedbackColumnsResult = await database.query(
    `SELECT column_name
       FROM information_schema.columns
      WHERE table_schema = 'public'
        AND table_name = 'documentation_article_feedback'`
  );
  const feedbackColumns = new Set((feedbackColumnsResult.rows || []).map((row) => row.column_name));
  const hashColumn = feedbackColumns.has('fingerprint_hash') ? 'fingerprint_hash' : 'request_hash';

  // Compatibility path for older DB schemas where feedback table used request_hash
  // and did not have a unique constraint for ON CONFLICT.
  const existing = await database.query(
    `SELECT id
       FROM documentation_article_feedback
      WHERE article_id = $1 AND ${hashColumn} = $2
      LIMIT 1`,
    [articleId, fingerprintHash]
  );

  if (existing.rows[0]) {
    if (feedbackColumns.has('updated_at')) {
      await database.query(
        `UPDATE documentation_article_feedback
            SET vote = $1, updated_at = CURRENT_TIMESTAMP
          WHERE id = $2`,
        [normalizedVote, existing.rows[0].id]
      );
    } else {
      await database.query(
        `UPDATE documentation_article_feedback
            SET vote = $1
          WHERE id = $2`,
        [normalizedVote, existing.rows[0].id]
      );
    }
  } else {
    if (feedbackColumns.has('user_agent')) {
      await database.query(
        `INSERT INTO documentation_article_feedback (article_id, ${hashColumn}, vote, user_agent)
         VALUES ($1, $2, $3, $4)`,
        [articleId, fingerprintHash, normalizedVote, 'docs-widget']
      );
    } else {
      await database.query(
        `INSERT INTO documentation_article_feedback (article_id, ${hashColumn}, vote)
         VALUES ($1, $2, $3)`,
        [articleId, fingerprintHash, normalizedVote]
      );
    }
  }

  await database.query(
    `UPDATE documentation_articles
        SET helpful_yes = COALESCE(counts.helpful_yes, 0),
            helpful_no = COALESCE(counts.helpful_no, 0)
       FROM (
         SELECT article_id,
                COUNT(*) FILTER (WHERE vote = 'yes')::int AS helpful_yes,
                COUNT(*) FILTER (WHERE vote = 'no')::int AS helpful_no
           FROM documentation_article_feedback
          WHERE article_id = $1
          GROUP BY article_id
       ) AS counts
      WHERE documentation_articles.id = $1`,
    [articleId]
  );

  const updated = await database.query(
    'SELECT helpful_yes, helpful_no FROM documentation_articles WHERE id = $1 LIMIT 1',
    [articleId]
  );

  return {
    helpfulYes: Number(updated.rows[0] && updated.rows[0].helpful_yes || 0),
    helpfulNo: Number(updated.rows[0] && updated.rows[0].helpful_no || 0),
  };
}

async function buildDocumentationPageData(options = {}) {
  const {
    includeDrafts = false,
    selectedSlug = null,
    database = db,
  } = options;

  const articles = await listDocumentationArticles({ includeDrafts, database });
  const selectedArticle = selectedSlug
    ? articles.find((article) => article.slug === selectedSlug) || null
    : null;
  const tree = buildTopicTree(articles);
  const featuredArticles = articles
    .filter((article) => article.featured && article.status === 'active')
    .slice(0, 6);
  const index = articles.map(buildIndexEntry);
  const availableTopics = Array.from(new Set([...DEFAULT_TOPICS, ...articles.map((article) => article.topic)])).filter(Boolean);

  return {
    selectedArticle,
    articles,
    featuredArticles,
    tree,
    index,
    availableTopics,
    quickStartResources: QUICK_START_RESOURCES,
  };
}

// Writes clear the cached list once they finish.
const clearingCacheAfter = (fn) => async (...args) => {
  try {
    return await fn(...args);
  } finally {
    clearDocumentationCache();
  }
};

module.exports = {
  DEFAULT_TOPICS,
  clearDocumentationCache,
  documentationWritesAllowed,
  QUICK_START_RESOURCES,
  buildCanonicalDocumentationUrl,
  buildDocumentationPageData,
  buildIndexEntry,
  buildTopicTree,
  createDocumentationArticle: clearingCacheAfter(createDocumentationArticle),
  createFeedbackFingerprint,
  deleteDocumentationArticle: clearingCacheAfter(deleteDocumentationArticle),
  duplicateDocumentationArticle: clearingCacheAfter(duplicateDocumentationArticle),
  ensureDocumentationSchema,
  getDocumentationArticleById,
  getDocumentationArticleBySlug,
  listDocumentationArticles,
  mapArticleRow,
  normalizeMedia,
  recordHelpfulVote: clearingCacheAfter(recordHelpfulVote),
  sanitizeArticleContent,
  searchDocumentationArticles,
  setDocumentationArticleStatus: clearingCacheAfter(setDocumentationArticleStatus),
  slugify,
  stripHtml,
  summarizeText,
  updateDocumentationArticle: clearingCacheAfter(updateDocumentationArticle),
};