const path = require('path');
const {
  QUICK_START_RESOURCES,
  buildCanonicalDocumentationUrl,
  buildDocumentationPageData,
  createDocumentationArticle,
  createFeedbackFingerprint,
  deleteDocumentationArticle,
  duplicateDocumentationArticle,
  ensureDocumentationSchema,
  getDocumentationArticleById,
  getDocumentationArticleBySlug,
  recordHelpfulVote,
  searchDocumentationArticles,
  setDocumentationArticleStatus,
  updateDocumentationArticle,
} = require('../utils/documentationCenter');
const managiraFAQ = require('../utils/managiraFAQ');
const db = require('../config/db');
const { uploadToS3, deleteFromS3 } = require('../middleware/s3Upload');

function isDocumentationAdmin(req) {
  const accountType = String(req.session && req.session.accountType || '').trim().toLowerCase();
  const userRole = String(req.session && req.session.userRole || '').trim().toLowerCase();
  return accountType === 'admin' || userRole === 'admin';
}

function buildDocumentationHeaderIdentity(req, documentationAdmin) {
  if (!documentationAdmin) {
    return {};
  }

  return {
    orgHeaderName: 'Admin',
    orgHeaderNickname: 'Admin',
    orgHeaderNicknameDisplay: 'Admin',
    orgHeaderLogo: '/images/managira.png',
  };
}

function buildStructuredData(article) {
  if (!article) {
    return {
      '@context': 'https://schema.org',
      '@type': 'CollectionPage',
      name: 'Managira Documentation Center',
      description: 'Structured documentation and help center for Managira.',
      url: buildCanonicalDocumentationUrl(),
    };
  }

  // Search engines and AI assistants read this: the article, where it sits,
  // its FAQ (questions in <h3> under "Frequently asked questions") and its
  // first set of numbered steps.
  const url = buildCanonicalDocumentationUrl(article.slug);
  const html = String(article.contentHtml || '');
  const strip = (v) => String(v || '').replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/\s+/g, ' ').trim();
  const graph = [{
    '@type': 'TechArticle',
    '@id': `${url}#article`,
    headline: article.title,
    name: article.title,
    description: article.seoDescription || article.excerpt || 'Documentation article',
    url,
    inLanguage: 'en',
    author: { '@type': 'Organization', name: 'Managira', url: 'https://managira.com' },
    publisher: { '@type': 'Organization', name: 'Managira', url: 'https://managira.com' },
    datePublished: article.createdAt,
    dateModified: article.updatedAt,
    articleSection: [article.topic, article.subtopic].filter(Boolean).join(' / '),
    keywords: article.tags,
    isPartOf: { '@type': 'WebSite', name: 'Managira Documentation', url: buildCanonicalDocumentationUrl() },
  }, {
    '@type': 'BreadcrumbList',
    itemListElement: [
      { '@type': 'ListItem', position: 1, name: 'Documentation', item: buildCanonicalDocumentationUrl() },
      ...(article.topic ? [{ '@type': 'ListItem', position: 2, name: article.topic }] : []),
      { '@type': 'ListItem', position: article.topic ? 3 : 2, name: article.title, item: url },
    ],
  }];
  const faqAt = html.search(/<h2[^>]*>\s*Frequently asked questions\s*<\/h2>/i);
  if (faqAt !== -1) {
    const faq = [];
    const re = /<h3[^>]*>([\s\S]*?)<\/h3>\s*<p[^>]*>([\s\S]*?)<\/p>/gi;
    let m;
    const part = html.slice(faqAt);
    while ((m = re.exec(part))) faq.push({ '@type': 'Question', name: strip(m[1]), acceptedAnswer: { '@type': 'Answer', text: strip(m[2]) } });
    if (faq.length) graph.push({ '@type': 'FAQPage', '@id': `${url}#faq`, mainEntity: faq });
  }
  const steps = html.match(/<ol[^>]*>([\s\S]*?)<\/ol>/i);
  if (steps) {
    const items = (steps[1].match(/<li[^>]*>[\s\S]*?<\/li>/gi) || []).map((li, i) => ({ '@type': 'HowToStep', position: i + 1, text: strip(li) })).filter((x) => x.text);
    if (items.length >= 2) graph.push({ '@type': 'HowTo', '@id': `${url}#howto`, name: article.title, step: items });
  }
  return { '@context': 'https://schema.org', '@graph': graph };
}

function escapeJsonForScript(value) {
  return JSON.stringify(value)
    .replace(/</g, '\\u003c')
    .replace(/>/g, '\\u003e')
    .replace(/&/g, '\\u0026')
    .replace(/\u2028/g, '\\u2028')
    .replace(/\u2029/g, '\\u2029');
}

function buildExcerpt(article) {
  return article && (article.seoDescription || article.excerpt || article.plainText || '');
}

function buildRelatedArticles(selectedArticle, allArticles = [], limit = 4) {
  if (!selectedArticle || !Array.isArray(allArticles) || allArticles.length === 0) {
    return [];
  }

  const selectedTags = new Set((selectedArticle.tags || []).map((tag) => String(tag || '').toLowerCase()));

  return allArticles
    .filter((candidate) => (
      candidate
      && candidate.slug
      && candidate.slug !== selectedArticle.slug
      && candidate.topic
      && selectedArticle.topic
      && String(candidate.topic).toLowerCase() === String(selectedArticle.topic).toLowerCase()
    ))
    .map((candidate) => {
      let score = 12;
      if (candidate.subtopic && selectedArticle.subtopic && candidate.subtopic === selectedArticle.subtopic) score += 8;

      const candidateTags = new Set((candidate.tags || []).map((tag) => String(tag || '').toLowerCase()));
      let sharedTags = 0;
      selectedTags.forEach((tag) => {
        if (candidateTags.has(tag)) sharedTags += 1;
      });
      score += sharedTags * 4;

      return { candidate, score };
    })
    .filter((entry) => entry.score > 0)
    .sort((left, right) => {
      if (right.score !== left.score) return right.score - left.score;
      return new Date(right.candidate.updatedAt || 0).getTime() - new Date(left.candidate.updatedAt || 0).getTime();
    })
    .slice(0, limit)
    .map((entry) => entry.candidate);
}

function buildDocumentationBootstrap(pageData, isAdmin) {
  return {
    isDocumentationAdmin: isAdmin,
    quickStartResources: pageData.quickStartResources,
    featuredArticles: pageData.featuredArticles,
    selectedArticle: pageData.selectedArticle,
    articleIndex: pageData.index,
    availableTopics: pageData.availableTopics,
  };
}

function buildHelpKnowledge() {
  if (!Array.isArray(managiraFAQ)) {
    return [];
  }

  return managiraFAQ.map((item) => ({
    id: item.id,
    category: item.category,
    question: item.question,
    answer: item.answer,
    keywords: item.keywords || [],
  }));
}

function buildDocumentationSearchResources(resources = []) {
  const mappedResources = Array.isArray(resources)
    ? resources.map((resource) => ({
        title: resource.title,
        subtitle: resource.subtitle || resource.description || '',
        url: resource.url,
        external: Boolean(resource.external),
        keywords: [resource.key, resource.type, resource.title, resource.subtitle, resource.description].filter(Boolean),
      }))
    : [];

  return mappedResources.concat([
    {
      title: 'User Documentation Hub',
      subtitle: 'Browse all Managira guides in one place',
      url: '/legal/user-documentation',
      external: false,
      keywords: ['documentation hub', 'all guides', 'resources', 'docs'],
    },
    {
      title: 'Request a Demo',
      subtitle: 'Schedule a personalised live demo',
      url: '/legal/request-demo',
      external: false,
      keywords: ['demo', 'request', 'sales', 'live demo', 'schedule', 'book'],
    },
  ]);
}

function matchStaticResources(query) {
  const normalized = String(query || '').trim().toLowerCase();
  if (!normalized) {
    return [];
  }

  const terms = normalized.split(/\s+/).filter((term) => term.length > 1);

  return QUICK_START_RESOURCES
    .map((resource) => {
      const url = String(resource.url || '').toLowerCase();
      let decodedUrl = url;
      try {
        decodedUrl = decodeURIComponent(url);
      } catch (_) {
        decodedUrl = url;
      }

      const haystack = [resource.title, resource.subtitle, resource.description, resource.key, resource.type, url, decodedUrl]
        .filter(Boolean)
        .join(' ')
        .toLowerCase();

      let score = 0;
      if (haystack.includes(normalized)) {
        score += 8;
      }

      terms.forEach((term) => {
        if (haystack.includes(term)) {
          score += 2;
        }
      });

      return { resource, score };
    })
    .filter((entry) => entry.score > 0)
    .sort((left, right) => right.score - left.score)
    .slice(0, 4)
    .map((entry) => entry.resource);
}

function buildMediaResponseHtml(media) {
  if (!media) return '';

  if (media.type === 'image') {
    const caption = media.caption ? `<figcaption>${media.caption}</figcaption>` : '';
    return `<figure class="doc-media doc-image"><img class="doc-inline-image" src="${media.url}" alt="${media.alt || media.title || 'Documentation image'}" data-caption="${media.caption || ''}">${caption}</figure>`;
  }

  if (media.type === 'video') {
    const caption = media.caption ? `<figcaption>${media.caption}</figcaption>` : '';
    return `<figure class="doc-media doc-video"><video class="doc-inline-video" controls playsinline preload="metadata" src="${media.url}"></video>${caption}</figure>`;
  }

  if (media.type === 'attachment') {
    const label = media.title || media.filename || 'Download attachment';
    return `<p><a class="doc-attachment-card" href="${media.url}" target="_blank" rel="noopener noreferrer">${label}</a></p>`;
  }

  return '';
}

async function renderDocumentationIndex(req, res) {
  const documentationAdmin = isDocumentationAdmin(req);
  const headerIdentity = buildDocumentationHeaderIdentity(req, documentationAdmin);

  await ensureDocumentationSchema(db);
  const pageData = await buildDocumentationPageData({
    includeDrafts: documentationAdmin,
    database: db,
  });

  return res.render('legal&Compliance/userDocumentation', {
    title: 'User Documentation - Managira School Management System',
    description: 'Complete user documentation for Managira school management system.',
    keywords: 'managira user documentation, managira guide, school management guide',
    canonicalUrl: 'https://managira.com/legal/user-documentation',
    showFooterTopSection: true,
    docsTree: pageData.tree,
    allArticles: pageData.index,
    availableTopics: pageData.availableTopics,
    documentationAdmin,
    forceAdminHeader: documentationAdmin,
    ...headerIdentity,
  });
}

async function renderDocumentationArticle(req, res) {
  const documentationAdmin = isDocumentationAdmin(req);
  const headerIdentity = buildDocumentationHeaderIdentity(req, documentationAdmin);
  const requestedSlug = req.params.slug || null;

  await ensureDocumentationSchema(db);
  const pageData = await buildDocumentationPageData({
    includeDrafts: documentationAdmin,
    selectedSlug: requestedSlug,
    database: db,
  });

  if (!pageData.selectedArticle) {
    return res.status(404).render('legal&Compliance/userDocumentationArticle', {
      layout: false,
      title: 'Documentation Not Found - Managira',
      description: 'The requested Managira documentation article could not be found.',
      keywords: 'managira documentation, help center, article not found',
      canonicalUrl: buildCanonicalDocumentationUrl(),
      structuredData: buildStructuredData(null),
      showFooterTopSection: true,
      docsTree: pageData.tree,
      featuredArticles: pageData.featuredArticles,
      quickStartResources: pageData.quickStartResources,
      helpKnowledge: buildHelpKnowledge(),
      documentationSearchResources: buildDocumentationSearchResources(pageData.quickStartResources),
      selectedArticle: null,
      selectedSlug: null,
      availableTopics: pageData.availableTopics,
      documentationAdmin,
      docsBootstrapJson: escapeJsonForScript(buildDocumentationBootstrap(pageData, documentationAdmin)),
      pageNotFound: true,
      currentPath: req.originalUrl,
      ...headerIdentity,
    });
  }

  const selectedArticle = pageData.selectedArticle;
  const relatedArticles = buildRelatedArticles(selectedArticle, pageData.articles, 4);
  const title = selectedArticle
    ? `${selectedArticle.title} - Managira Documentation`
    : 'User Documentation - Managira';
  const description = selectedArticle
    ? buildExcerpt(selectedArticle)
    : 'Structured documentation, quick start guides, and searchable help articles for Managira.';
  const keywords = selectedArticle
    ? selectedArticle.tags.join(', ')
    : 'managira documentation, help center, user guide, school management documentation';
  const canonicalUrl = selectedArticle
    ? buildCanonicalDocumentationUrl(selectedArticle.slug)
    : buildCanonicalDocumentationUrl();

  return res.render('legal&Compliance/userDocumentationArticle', {
    layout: false,
    title,
    description,
    keywords,
    canonicalUrl,
    structuredData: buildStructuredData(selectedArticle),
    showFooterTopSection: true,
    docsTree: pageData.tree,
    featuredArticles: pageData.featuredArticles,
    quickStartResources: pageData.quickStartResources,
    relatedArticles,
    helpKnowledge: buildHelpKnowledge(),
    documentationSearchResources: buildDocumentationSearchResources(pageData.quickStartResources),
    selectedArticle,
    selectedSlug: requestedSlug,
    availableTopics: pageData.availableTopics,
    documentationAdmin,
    docsBootstrapJson: escapeJsonForScript(buildDocumentationBootstrap(pageData, documentationAdmin)),
    pageNotFound: false,
    currentPath: req.originalUrl,
    ...headerIdentity,
  });
}

async function renderHelpCenter(req, res) {
  const documentationAdmin = isDocumentationAdmin(req);

  await ensureDocumentationSchema(db);
  const pageData = await buildDocumentationPageData({
    includeDrafts: documentationAdmin,
    database: db,
  });

  const helpBootstrap = {
    isDocumentationAdmin: documentationAdmin,
    articleIndex: pageData.index,
    quickStartResources: pageData.quickStartResources,
    availableTopics: pageData.availableTopics,
  };

  return res.render('legal&Compliance/Help', {
    title: 'Help Center - Managira',
    description: 'Search the Managira help center across live documentation articles, quick start guides, and embedded onboarding resources.',
    keywords: 'managira help center, documentation search, school management help, support articles',
    canonicalUrl: 'https://managira.com/legal/help',
    success: req.flash('success'),
    error: req.flash('error'),
    showFooterTopSection: true,
    documentationAdmin,
    helpBootstrapJson: escapeJsonForScript(helpBootstrap),
    documentationResources: pageData.quickStartResources,
    currentPath: req.originalUrl,
  });
}

async function documentationSearchJson(req, res) {
  try {
    const documentationAdmin = isDocumentationAdmin(req);
    const includeDrafts = documentationAdmin;
    const q = String(req.query.q || '').trim();

    const articles = await searchDocumentationArticles(q, {
      includeDrafts,
      limit: 12,
      database: db,
    });

    return res.json({
      success: true,
      query: q,
      articles: articles.map((article) => ({
        id: article.id,
        slug: article.slug,
        title: article.title,
        topic: article.topic,
        subtopic: article.subtopic,
        status: article.status,
        featured: article.featured,
        seoDescription: article.seoDescription,
        excerpt: article.excerpt,
        updatedAt: article.updatedAt,
        breadcrumb: article.breadcrumb,
      })),
      resources: matchStaticResources(q),
    });
  } catch (error) {
    return res.status(500).json({ success: false, message: 'Unable to search documentation right now.' });
  }
}

async function documentationIndexJson(req, res) {
  try {
    const documentationAdmin = isDocumentationAdmin(req);
    const pageData = await buildDocumentationPageData({
      includeDrafts: documentationAdmin,
      database: db,
    });

    return res.json({
      success: true,
      articles: pageData.index,
      topics: pageData.availableTopics,
    });
  } catch (error) {
    return res.status(500).json({ success: false, message: 'Unable to load documentation index.' });
  }
}

async function documentationArticleJson(req, res) {
  try {
    const documentationAdmin = isDocumentationAdmin(req);
    const article = await getDocumentationArticleBySlug(req.params.slug, {
      includeDrafts: documentationAdmin,
      database: db,
    });

    if (!article) {
      return res.status(404).json({ success: false, message: 'Article not found.' });
    }

    return res.json({ success: true, article });
  } catch (error) {
    return res.status(500).json({ success: false, message: 'Unable to load article.' });
  }
}

async function documentationHelpfulVote(req, res) {
  try {
    const articleId = Number(req.body.articleId || req.body.article_id);
    const vote = String(req.body.vote || '').trim().toLowerCase();
    if (!Number.isInteger(articleId) || !['yes', 'no'].includes(vote)) {
      return res.status(400).json({ success: false, message: 'Invalid article feedback.' });
    }

    const article = await getDocumentationArticleById(articleId, { includeDrafts: true, database: db });
    if (!article) {
      return res.status(404).json({ success: false, message: 'Article not found.' });
    }

    const counts = await recordHelpfulVote(articleId, vote, createFeedbackFingerprint(req), { database: db });
    return res.json({
      success: true,
      counts,
      helpfulYes: counts.helpfulYes,
      helpfulNo: counts.helpfulNo,
    });
  } catch (error) {
    return res.status(500).json({ success: false, message: 'Unable to record article feedback.' });
  }
}

async function documentationCreateArticle(req, res) {
  try {
    const article = await createDocumentationArticle(req.body, {
      userId: req.session.userId || null,
      database: db,
    });
    const pageData = await buildDocumentationPageData({ includeDrafts: true, database: db });
    return res.status(201).json({ success: true, article, index: pageData.index, topics: pageData.availableTopics });
  } catch (error) {
    return res.status(400).json({ success: false, message: error.message || 'Unable to create article.' });
  }
}

async function documentationUpdateArticle(req, res) {
  try {
    const articleId = Number(req.params.id);
    if (!Number.isInteger(articleId)) {
      return res.status(400).json({ success: false, message: 'Invalid article id.' });
    }

    const article = await updateDocumentationArticle(articleId, req.body, { database: db });
    const pageData = await buildDocumentationPageData({ includeDrafts: true, database: db });
    return res.json({ success: true, article, index: pageData.index, topics: pageData.availableTopics });
  } catch (error) {
    return res.status(400).json({ success: false, message: error.message || 'Unable to update article.' });
  }
}

async function documentationToggleStatus(req, res) {
  try {
    const articleId = Number(req.params.id);
    const status = String(req.body.status || '').trim().toLowerCase() === 'draft' ? 'draft' : 'active';
    if (!Number.isInteger(articleId)) {
      return res.status(400).json({ success: false, message: 'Invalid article id.' });
    }

    const article = await setDocumentationArticleStatus(articleId, status, { database: db });
    const pageData = await buildDocumentationPageData({ includeDrafts: true, database: db });
    return res.json({ success: true, article, index: pageData.index });
  } catch (error) {
    return res.status(400).json({ success: false, message: error.message || 'Unable to update article status.' });
  }
}

async function documentationDuplicateArticle(req, res) {
  try {
    const articleId = Number(req.params.id);
    if (!Number.isInteger(articleId)) {
      return res.status(400).json({ success: false, message: 'Invalid article id.' });
    }

    const article = await duplicateDocumentationArticle(articleId, {
      userId: req.session.userId || null,
      database: db,
    });
    const pageData = await buildDocumentationPageData({ includeDrafts: true, database: db });
    return res.status(201).json({ success: true, article, index: pageData.index, topics: pageData.availableTopics });
  } catch (error) {
    return res.status(400).json({ success: false, message: error.message || 'Unable to duplicate article.' });
  }
}

async function documentationDeleteArticle(req, res) {
  try {
    const articleId = Number(req.params.id);
    if (!Number.isInteger(articleId)) {
      return res.status(400).json({ success: false, message: 'Invalid article id.' });
    }

    const deletedArticle = await deleteDocumentationArticle(articleId, { database: db });
    if (!deletedArticle) {
      return res.status(404).json({ success: false, message: 'Article not found.' });
    }

    for (const media of deletedArticle.media || []) {
      if (!media.s3Key) continue;
      try {
        await deleteFromS3(media.s3Key);
      } catch (_) {
        // Ignore cleanup errors for already-missing media.
      }
    }

    const pageData = await buildDocumentationPageData({ includeDrafts: true, database: db });
    return res.json({ success: true, deletedId: articleId, index: pageData.index, topics: pageData.availableTopics });
  } catch (error) {
    return res.status(400).json({ success: false, message: error.message || 'Unable to delete article.' });
  }
}

async function documentationUploadMedia(req, res) {
  try {
    const file = req.file;
    if (!file) {
      return res.status(400).json({ success: false, message: 'No file was uploaded.' });
    }

    const mime = String(file.mimetype || '').toLowerCase();
    const isImage = mime.startsWith('image/');
    const isVideo = mime.startsWith('video/');
    const isAttachment = [
      'application/pdf',
      'application/msword',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      'application/vnd.ms-excel',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'text/plain',
    ].includes(mime);

    if (!isImage && !isVideo && !isAttachment) {
      return res.status(400).json({ success: false, message: 'Unsupported file type for documentation media.' });
    }

    const safeName = path.basename(file.originalname || `upload-${Date.now()}`).replace(/[^a-zA-Z0-9._-]+/g, '-');
    const kind = isImage ? 'image' : (isVideo ? 'video' : 'attachment');
    const key = `documentation/articles/${Date.now()}-${safeName}`;
    const url = await uploadToS3(file, key);

    const media = {
      type: kind,
      url,
      s3Key: key,
      title: String(req.body.title || '').trim().slice(0, 200),
      caption: String(req.body.caption || '').trim().slice(0, 240),
      alt: String(req.body.alt || '').trim().slice(0, 200),
      mimeType: mime,
      filename: safeName,
    };

    return res.json({
      success: true,
      media,
      html: buildMediaResponseHtml(media),
    });
  } catch (error) {
    return res.status(500).json({ success: false, message: 'Unable to upload documentation media.' });
  }
}

module.exports = {
  documentationArticleJson,
  documentationCreateArticle,
  documentationDeleteArticle,
  documentationDuplicateArticle,
  documentationHelpfulVote,
  documentationIndexJson,
  documentationSearchJson,
  documentationToggleStatus,
  documentationUpdateArticle,
  documentationUploadMedia,
  renderDocumentationArticle,
  renderDocumentationIndex,
};