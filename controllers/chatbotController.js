// Chatbot controller â€” searches the public FAQ and documentation articles,
// then returns links so users read the full answer on the source page.
const managiraFAQ = require('../utils/managiraFAQ');
const { searchDocumentationArticles } = require('../utils/documentationCenter');

const _normalize = (s) => s.toLowerCase().replace(/[^a-z0-9\s]+/g, ' ').trim();

class ChatbotController {
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
      const faqHits = managiraFAQ
        .map((item) => ({ item, score: ChatbotController._scoreFAQ(item, nq, terms) }))
        .filter((r) => r.score > 0)
        .sort((a, b) => b.score - a.score)
        .slice(0, 4)
        .map((r) => ({
          question: r.item.question,
          category: r.item.category,
          url: '/legal/faq?q=' + encodeURIComponent(r.item.question),
        }));

      // â”€â”€ Search documentation articles â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
      const docArticles = await searchDocumentationArticles(q, {
        includeDrafts: false,
        limit: 3,
      });

      const docHits = docArticles.map((a) => ({
        title: a.title,
        topic: a.topic,
        subtopic: a.subtopic,
        excerpt: a.seoDescription || a.excerpt || '',
        url: '/legal/user-documentation/' + a.slug,
      }));

      const total = faqHits.length + docHits.length;
      if (total === 0) {
        return res.json({
          success: true,
          type: 'no_results',
          message: "I searched our FAQ and documentation but couldn't find anything specific for that. Try rephrasing, or browse directly:",
          links: [
            { label: 'Browse FAQ', url: '/legal/faq' },
            { label: 'View Documentation', url: '/legal/user-documentation' },
            { label: 'Help Centre', url: '/legal/help' },
          ],
        });
      }

      let summary;
      if (faqHits.length > 0 && docHits.length > 0) {
        summary = `I found ${faqHits.length} FAQ result${faqHits.length !== 1 ? 's' : ''} and ${docHits.length} guide${docHits.length !== 1 ? 's' : ''}. Click any link to read the full answer.`;
      } else if (faqHits.length > 0) {
        summary = `I found ${faqHits.length} FAQ result${faqHits.length !== 1 ? 's' : ''}. Click to open the full answer on the FAQ page.`;
      } else {
        summary = `I found ${docHits.length} documentation article${docHits.length !== 1 ? 's' : ''} that should help. Click to read.`;
      }

      return res.json({ success: true, type: 'results', summary, faqHits, docHits });
    } catch (error) {
      return res.json({
        success: false,
        message: "I'm having trouble searching right now. Please visit our FAQ or documentation directly.",
        links: [
          { label: 'FAQ', url: '/legal/faq' },
          { label: 'Documentation', url: '/legal/user-documentation' },
        ],
      });
    }
  }

  // Return popular FAQ links for the welcome screen
  static getPopularQuestions(req, res) {
    try {
      const popularIds = [3, 4, 30];
      const popular = managiraFAQ
        .filter((f) => popularIds.includes(f.id))
        .map((f) => ({
          question: f.question,
          url: '/legal/faq?q=' + encodeURIComponent(f.question),
        }));
      // Add one documentation article link
      popular.push({
        question: 'Browse the setup guides & articles',
        url: '/legal/user-documentation',
      });
      return res.json({ success: true, questions: popular });
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
