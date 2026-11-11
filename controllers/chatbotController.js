// The site chat ("Mira Assistant" on the public site and the help center): answers come from
// the help center's guides only (utils/docs/askDocs.js), in the guides' own words, with a link
// to the part of the guide they come from. A question the guides don't answer says so and
// offers the closest guides; nothing is made up.
const { listDocumentationArticles } = require('../utils/documentationCenter');
const { ask } = require('../utils/docs/askDocs');
const { BoundedMap } = require('../utils/boundedMap');

// The same question within a few minutes gets the same answer at once.
const ANSWER_CACHE_MS = 5 * 60 * 1000;
const ANSWER_CACHE = new BoundedMap(500);
const POPULAR_CACHE_MS = 5 * 60 * 1000;
let popularQuestions = { value: [], expires: 0 };

const DOCS_HOME = { label: 'Browse all guides', url: '/legal/user-documentation' };
const normalize = (text) => String(text || '').toLowerCase().replace(/[^a-z0-9\s]+/g, ' ').replace(/\s+/g, ' ').trim();

// The guides as the help center has them (cached there), so an article edited by the docs team
// is answered from straight away.
async function guides() {
  return listDocumentationArticles({ includeDrafts: false });
}

function payloadFor(result) {
  if (result.type === 'small_talk') {
    return {
      success: true,
      type: 'message',
      message: "Hi! Ask me anything about using Managira, like \"How do I reset my password?\" or \"How do parents pay fees?\", and I'll answer from our guides.",
    };
  }
  if (result.type === 'answer') {
    const source = result.source;
    const primaryDoc = {
      title: source.section ? `${source.title}: ${source.section}` : source.title,
      topic: source.topic || '',
      excerpt: source.excerpt || '',
      url: source.url,
      contentType: 'article',
      typeLabel: source.url.startsWith('/legal/user-documentation') ? 'Guide' : 'Page',
      external: false,
    };
    const relatedDocs = (result.related || []).map((doc) => ({
      title: doc.title, excerpt: doc.excerpt || '', url: doc.url, contentType: 'article', typeLabel: 'Guide', external: false,
    }));
    return {
      success: true,
      type: 'results',
      confidence: result.confidence,
      summary: result.answer.lines[0] || '',
      answer: {
        mode: result.answer.mode,
        title: result.answer.title || source.title,
        // A likely match is said to be one.
        lead: result.confidence === 'likely' ? 'This looks like the closest answer in our guides:' : '',
        lines: result.answer.lines,
      },
      primaryDoc,
      relatedDocs,
      docHits: [primaryDoc].concat(relatedDocs),
    };
  }
  const closest = (result.closest || []).map((doc) => ({ label: doc.title, url: doc.url }));
  return {
    success: true,
    type: 'no_results',
    message: closest.length
      ? "I couldn't find an exact answer to that in our guides. These are the closest:"
      : "I couldn't find that in our guides. Try asking it another way, or browse the guides.",
    links: closest.concat(DOCS_HOME),
  };
}

class ChatbotController {
  static async getResponse(req, res) {
    try {
      const query = req.body && req.body.query;
      if (!query || typeof query !== 'string' || !query.trim()) {
        return res.json({ success: false, message: 'Please enter a question.' });
      }
      const q = query.trim().slice(0, 300);
      const key = normalize(q);
      const hit = ANSWER_CACHE.get(key);
      if (hit && Date.now() - hit.at < ANSWER_CACHE_MS) return res.json(hit.payload);
      const payload = payloadFor(ask(q, await guides()));
      ANSWER_CACHE.set(key, { at: Date.now(), payload });
      return res.json(payload);
    } catch (error) {
      console.error('[chatbot]', error && error.message);
      return res.json({
        success: false,
        message: "I'm having trouble reading the guides right now. Please try again in a moment.",
        links: [DOCS_HOME],
      });
    }
  }

  // The guides shown on the welcome screen.
  static async getPopularQuestions(req, res) {
    try {
      res.set('Cache-Control', 'private, max-age=300');
      if (popularQuestions.expires > Date.now()) {
        return res.json({ success: true, questions: popularQuestions.value });
      }
      const docs = await guides();
      const topDocs = docs
        .filter((article) => article && article.slug && article.title)
        .sort((left, right) => {
          const leftFeatured = left.featured ? 1 : 0;
          const rightFeatured = right.featured ? 1 : 0;
          if (leftFeatured !== rightFeatured) return rightFeatured - leftFeatured;
          return new Date(right.updatedAt || 0).getTime() - new Date(left.updatedAt || 0).getTime();
        })
        .slice(0, 3)
        .map((article) => ({ question: article.title, url: '/legal/user-documentation/' + article.slug }));
      popularQuestions = { value: topDocs, expires: Date.now() + POPULAR_CACHE_MS };
      return res.json({ success: true, questions: topDocs });
    } catch (error) {
      res.set('Cache-Control', 'no-store');
      return res.json({ success: false, message: 'Unable to load documentation suggestions' });
    }
  }
}

module.exports = ChatbotController;
