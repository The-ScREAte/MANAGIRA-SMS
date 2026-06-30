// Chatbot controller â€” searches the public FAQ and documentation articles,
// then returns links so users read the full answer on the source page.
const managiraFAQ = require('../utils/managiraFAQ');
const {
  QUICK_START_RESOURCES,
  listDocumentationArticles,
  searchDocumentationArticles,
} = require('../utils/documentationCenter');

const _normalize = (s) => s.toLowerCase().replace(/[^a-z0-9\s]+/g, ' ').trim();

class ChatbotController {
  static _resourceMeta(resource = {}) {
    const type = String(resource.type || '').toLowerCase();
    const url = String(resource.url || '').toLowerCase();

    if (type === 'youtube' || url.includes('youtube.com') || url.includes('youtu.be')) {
      return { contentType: 'video', typeLabel: 'Video' };
    }

    if (type === 'file' || url.endsWith('.pdf')) {
      return { contentType: 'pdf', typeLabel: 'PDF' };
    }

    if (type === 'link') {
      return { contentType: 'guide', typeLabel: 'Guide' };
    }

    return { contentType: 'resource', typeLabel: 'Resource' };
  }

  static _scoreResource(resource, nq, terms) {
    const normalizedUrl = String(resource.url || '').toLowerCase();
    let decodedUrl = normalizedUrl;
    try {
      decodedUrl = decodeURIComponent(normalizedUrl);
    } catch (_) {
      decodedUrl = normalizedUrl;
    }

    const haystack = _normalize([
      resource.title,
      resource.subtitle,
      resource.description,
      resource.key,
      resource.type,
      normalizedUrl,
      decodedUrl,
    ].filter(Boolean).join(' '));

    let score = 0;
    if (nq && haystack.includes(nq)) score += 20;

    terms.forEach((term) => {
      if (haystack.includes(term)) score += 4;
    });

    return score;
  }

  static _shouldSearchFAQ(nq) {
    const wordCount = String(nq || '').split(/\s+/).filter(Boolean).length;
    return wordCount >= 4;
  }

  static _isExactFaqMatch(faq, nq) {
    if (!nq) return false;
    const nQuestion = _normalize(faq.question);
    const nAnswer = _normalize(faq.answer);
    const nKeywords = Array.isArray(faq.keywords)
      ? faq.keywords.map((kw) => _normalize(kw)).filter(Boolean)
      : [];

    if (nQuestion.includes(nq) || nAnswer.includes(nq)) return true;
    return nKeywords.some((kw) => kw.includes(nq));
  }

  /**
   * Score a public FAQ entry against the query.
   * Checks: question substring, keyword overlap, category, answer.
   */
  static _scoreFAQ(faq, nq, terms) {
    let score = 0;
    const nQuestion = _normalize(faq.question);
    const nAnswer = _normalize(faq.answer);
    const nCategory = _normalize(faq.category || '');

    if (nq.length > 2 && nQuestion.includes(nq)) score += 50;

    terms.forEach((term) => {
      if (nQuestion.includes(term)) score += 5;
      if (nCategory.includes(term)) score += 2;
      if (nAnswer.includes(term)) score += 1;
      (faq.keywords || []).forEach((kw) => {
        const nkw = _normalize(kw);
        if (nkw.includes(term) || term.includes(nkw)) score += 3;
      });
    });

    return score;
  }

  static async getResponse(req, res) {
    try {
      const { query } = req.body;
      if (!query || query.trim().length === 0) {
        return res.json({ success: false, message: 'Please enter a question.' });
      }

      const q = query.trim();
      const nq = _normalize(q);
      const terms = nq.split(/\s+/).filter((t) => t.length > 1);

      // â”€â”€ Search public FAQ â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
      let faqHits = [];
      if (ChatbotController._shouldSearchFAQ(nq)) {
        faqHits = managiraFAQ
          .filter((item) => ChatbotController._isExactFaqMatch(item, nq))
          .slice(0, 3)
          .map((item) => ({
            question: item.question,
            category: item.category,
            url: '/legal/faq?q=' + encodeURIComponent(item.question),
          }));
      }

      // â”€â”€ Search documentation articles â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
      const docArticles = await searchDocumentationArticles(q, {
        includeDrafts: false,
        limit: 6,
      });

      const articleDocHits = docArticles.map((a) => ({
        title: a.title,
        topic: a.topic,
        subtopic: a.subtopic,
        excerpt: a.seoDescription || a.excerpt || '',
        url: '/legal/user-documentation/' + a.slug,
        contentType: 'article',
        typeLabel: 'Article',
        external: false,
      }));

      const resourceDocHits = QUICK_START_RESOURCES
        .map((resource) => ({ resource, score: ChatbotController._scoreResource(resource, nq, terms) }))
        .filter((entry) => entry.score > 0)
        .sort((left, right) => right.score - left.score)
        .slice(0, 4)
        .map((entry) => {
          const meta = ChatbotController._resourceMeta(entry.resource);
          return {
          title: entry.resource.title,
          topic: 'Resource',
          subtopic: entry.resource.type === 'file' ? 'File' : 'Guide',
          excerpt: entry.resource.subtitle || entry.resource.description || '',
          url: entry.resource.url,
          contentType: meta.contentType,
          typeLabel: meta.typeLabel,
          external: Boolean(entry.resource.external),
          };
        });

      const docHits = articleDocHits.concat(resourceDocHits).slice(0, 8);

      const total = faqHits.length + docHits.length;
      if (total === 0) {
        return res.json({
          success: true,
          type: 'no_results',
          message: "I searched our documentation but couldn't find anything specific for that. Try rephrasing, or browse directly:",
          links: [
            { label: 'View Documentation', url: '/legal/user-documentation' },
            { label: 'Help Centre', url: '/legal/help' },
          ],
        });
      }

      let summary;
      if (docHits.length > 0 && faqHits.length > 0) {
        summary = `I found ${docHits.length} documentation guide${docHits.length !== 1 ? 's' : ''} and ${faqHits.length} quick FAQ result${faqHits.length !== 1 ? 's' : ''}. Start with the guides for full steps.`;
      } else if (docHits.length > 0) {
        summary = `I found ${docHits.length} documentation result${docHits.length !== 1 ? 's' : ''} that should help. Open any result below.`;
      } else {
        summary = `I found ${faqHits.length} quick FAQ result${faqHits.length !== 1 ? 's' : ''}.`;
      }

      return res.json({ success: true, type: 'results', summary, faqHits, docHits });
    } catch (error) {
      return res.json({
        success: false,
        message: "I'm having trouble searching right now. Please visit our documentation directly.",
        links: [
          { label: 'Documentation', url: '/legal/user-documentation' },
        ],
      });
    }
  }

  // Return popular FAQ links for the welcome screen
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
      return res.json({ success: false, message: 'Unable to load popular questions' });
    }
  }

  // Keep for backward compatibility
  static getFAQById(req, res) {
    try {
      const { id } = req.params;
      const faq = managiraFAQ.find((f) => f.id === parseInt(id));
      if (!faq) return res.json({ success: false, message: 'Question not found' });
      return res.json({ success: true, faq });
    } catch (error) {
      return res.json({ success: false, message: 'Unable to load question' });
    }
  }
}

module.exports = ChatbotController;
