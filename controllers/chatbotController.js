const managiraFAQ = require('../utils/managiraFAQ');

// Synonym map for smarter matching
const SYNONYMS = {
  'price': ['pricing', 'cost', 'fee', 'billing', 'payment', 'subscription', 'plan', 'charge'],
  'pricing': ['price', 'cost', 'fee', 'billing', 'payment', 'subscription', 'plan'],
  'cost': ['price', 'pricing', 'fee', 'billing', 'payment', 'charge'],
  'fee': ['price', 'pricing', 'cost', 'billing', 'payment', 'tuition', 'charge'],
  'pay': ['payment', 'billing', 'fee', 'cost', 'price', 'subscription'],
  'money': ['payment', 'billing', 'fee', 'cost', 'price'],
  'login': ['sign in', 'log in', 'access', 'authenticate', 'password'],
  'signin': ['login', 'log in', 'access', 'authenticate'],
  'signup': ['register', 'registration', 'create account', 'sign up'],
  'register': ['signup', 'sign up', 'create account', 'registration', 'enroll'],
  'password': ['login', 'forgot', 'reset', 'credentials', 'sign in'],
  'forgot': ['forget', 'reset', 'lost', 'password'],
  'forget': ['forgot', 'reset', 'lost', 'password'],
  'reset': ['forgot', 'forget', 'change', 'password', 'restore'],
  'kid': ['child', 'student', 'son', 'daughter', 'children', 'kids'],
  'child': ['kid', 'student', 'son', 'daughter', 'children', 'kids'],
  'children': ['kids', 'students', 'child', 'kid'],
  'parent': ['guardian', 'mother', 'father', 'family', 'mom', 'dad'],
  'guardian': ['parent', 'mother', 'father', 'family'],
  'mom': ['parent', 'guardian', 'mother'],
  'dad': ['parent', 'guardian', 'father'],
  'teacher': ['educator', 'staff', 'instructor', 'faculty'],
  'educator': ['teacher', 'staff', 'instructor', 'faculty'],
  'staff': ['teacher', 'educator', 'employee', 'faculty', 'worker'],
  'employee': ['staff', 'teacher', 'worker', 'hire'],
  'grade': ['mark', 'score', 'result', 'assessment', 'performance', 'grades'],
  'grades': ['grade', 'marks', 'scores', 'results', 'assessments', 'performance'],
  'mark': ['grade', 'score', 'result', 'assessment'],
  'score': ['grade', 'mark', 'result', 'performance'],
  'report': ['report card', 'merit sheet', 'transcript', 'results', 'statement'],
  'attendance': ['present', 'absent', 'roll call', 'check in'],
  'absent': ['attendance', 'missing', 'away'],
  'present': ['attendance', 'here', 'check in'],
  'class': ['classroom', 'course', 'subject', 'section', 'grade level'],
  'subject': ['class', 'course', 'topic'],
  'school': ['institution', 'organization', 'academy', 'college', 'centre'],
  'institution': ['school', 'organization', 'academy'],
  'hub': ['government', 'district', 'network', 'ministry', 'oversight', 'central'],
  'government': ['hub', 'ministry', 'district', 'department'],
  'trial': ['free', 'demo', 'try', 'test'],
  'free': ['trial', 'demo', 'no cost', 'complimentary'],
  'data': ['information', 'records', 'details'],
  'export': ['download', 'extract', 'csv', 'pdf', 'backup'],
  'download': ['export', 'extract', 'save', 'get'],
  'secure': ['security', 'safe', 'protected', 'encryption', 'privacy'],
  'security': ['secure', 'safe', 'protected', 'encryption', 'privacy'],
  'safe': ['security', 'secure', 'protected'],
  'permission': ['permissions', 'access', 'role', 'authorization', 'rbac'],
  'permissions': ['permission', 'access', 'roles', 'authorization', 'rbac'],
  'role': ['roles', 'permission', 'access', 'position', 'title'],
  'roles': ['role', 'permissions', 'access', 'positions'],
  'help': ['support', 'assist', 'contact', 'question'],
  'support': ['help', 'assist', 'contact', 'service'],
  'contact': ['support', 'help', 'email', 'reach', 'call'],
  'announcement': ['announcements', 'news', 'update', 'notice', 'event'],
  'event': ['events', 'announcement', 'activity', 'happening'],
  'website': ['site', 'page', 'portal', 'public dashboard', 'web'],
  'portal': ['website', 'dashboard', 'platform', 'site'],
  'file': ['files', 'document', 'documents', 'spreadsheet', 'sheet'],
  'document': ['documents', 'file', 'files', 'sheet', 'spreadsheet'],
  'spreadsheet': ['spreadsheets', 'sheet', 'sheets', 'file', 'excel', 'cells'],
  'formula': ['formulas', 'sum', 'average', 'count', 'calculate', 'calculation'],
  'calculate': ['formula', 'sum', 'average', 'count', 'compute'],
  'transcript': ['transcripts', 'academic record', 'academic history', 'report'],
  'enroll': ['enrollment', 'enrolment', 'register', 'admission', 'apply'],
  'enrollment': ['enroll', 'enrolment', 'register', 'admission', 'application'],
  'admission': ['enrollment', 'enroll', 'apply', 'application', 'register'],
  'apply': ['application', 'admission', 'enrollment', 'enroll'],
  'promote': ['promotion', 'advance', 'next year', 'next grade', 'progress'],
  'promotion': ['promote', 'advance', 'next year', 'progress'],
  'customise': ['customize', 'personalise', 'personalize', 'brand', 'logo', 'theme'],
  'customize': ['customise', 'personalise', 'personalize', 'brand', 'logo', 'theme'],
  'logo': ['brand', 'customise', 'customize', 'branding', 'personalise'],
  'brand': ['branding', 'logo', 'customise', 'customize', 'colour', 'color', 'theme'],
  'colour': ['color', 'theme', 'brand', 'customise'],
  'color': ['colour', 'theme', 'brand', 'customize'],
  'mobile': ['phone', 'tablet', 'device', 'responsive', 'app'],
  'phone': ['mobile', 'device', 'cell'],
  'device': ['mobile', 'phone', 'tablet', 'desktop', 'laptop'],
  'work': ['function', 'operate', 'use', 'how'],
  'start': ['begin', 'setup', 'get started', 'onboard'],
  'setup': ['start', 'begin', 'configure', 'install', 'onboard'],
  'change': ['update', 'modify', 'edit', 'switch'],
  'update': ['change', 'modify', 'edit', 'upgrade'],
  'delete': ['remove', 'cancel', 'deactivate'],
  'remove': ['delete', 'cancel', 'deactivate'],
  'cancel': ['delete', 'remove', 'stop', 'end', 'unsubscribe'],
  'manage': ['management', 'handle', 'administer', 'control', 'organize'],
  'management': ['manage', 'handling', 'administration', 'control'],
  'add': ['create', 'new', 'insert', 'include'],
  'create': ['add', 'new', 'make', 'build', 'set up'],
  'invite': ['invitation', 'add', 'send', 'join'],
  'join': ['invite', 'connect', 'link', 'attach'],
  'term': ['semester', 'quarter', 'period', 'academic term'],
  'semester': ['term', 'quarter', 'period'],
  'year': ['academic year', 'school year', 'annual'],
  'documentation': ['docs', 'guide', 'manual', 'user guide', 'help guide', 'tutorial', 'instructions'],
  'guide': ['documentation', 'manual', 'tutorial', 'instructions', 'help'],
  'manual': ['documentation', 'guide', 'tutorial', 'instructions'],
  'tutorial': ['guide', 'documentation', 'manual', 'instructions', 'video'],
  'record': ['records', 'data', 'information', 'history', 'log'],
  'print': ['download', 'export', 'pdf', 'hard copy'],
  'bulk': ['import', 'batch', 'mass', 'multiple', 'many'],
  'import': ['bulk', 'upload', 'migrate', 'csv'],
  'donate': ['donation', 'donations', 'contribute', 'give', 'fund'],
  'donation': ['donate', 'donations', 'contribute', 'give', 'fund'],
  'employ': ['employment', 'job', 'hire', 'career', 'work', 'vacancy'],
  'employment': ['employ', 'job', 'hire', 'career', 'vacancy', 'apply'],
  'job': ['employment', 'career', 'hire', 'work', 'vacancy', 'position'],
  'hire': ['employment', 'job', 'recruit', 'staff'],
};

// Common word stems for basic stemming
function basicStem(word) {
  return word
    .replace(/ies$/, 'y')
    .replace(/tion$/, 't')
    .replace(/sion$/, 's')
    .replace(/ment$/, '')
    .replace(/ness$/, '')
    .replace(/ing$/, '')
    .replace(/ous$/, '')
    .replace(/ful$/, '')
    .replace(/able$/, '')
    .replace(/ible$/, '')
    .replace(/ly$/, '')
    .replace(/ed$/, '')
    .replace(/er$/, '')
    .replace(/est$/, '')
    .replace(/s$/, '');
}

class ChatbotController {
  // Search through FAQ based on user query
  static searchFAQ(query) {
    if (!query || query.trim().length === 0) {
      return [];
    }

    const normalize = (str) => str.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
    const normalizedQuery = normalize(query);

    const searchTerms = normalizedQuery
      .split(' ')
      .filter(term => term.length > 1); // Allow 2-char terms like "id", "ok"

    // Expand search terms with synonyms
    const expandedTerms = new Set(searchTerms);
    searchTerms.forEach(term => {
      // Direct synonym lookup
      if (SYNONYMS[term]) {
        SYNONYMS[term].forEach(syn => expandedTerms.add(syn));
      }
      // Stemmed synonym lookup
      const stemmed = basicStem(term);
      if (stemmed !== term && SYNONYMS[stemmed]) {
        SYNONYMS[stemmed].forEach(syn => expandedTerms.add(syn));
      }
    });

    const results = [];

    managiraFAQ.forEach(faq => {
      let score = 0;

      const normalizedQuestion = normalize(faq.question);
      const normalizedAnswer = normalize(faq.answer);
      const normalizedCategory = normalize(faq.category);

      // Exact match on full question
      if (normalizedQuery === normalizedQuestion) {
        score += 100;
      }

      // Check if query is a substring of the question or vice versa
      if (normalizedQuestion.includes(normalizedQuery) && normalizedQuery.length > 3) {
        score += 50;
      }
      if (normalizedQuery.includes(normalizedQuestion) && normalizedQuestion.length > 3) {
        score += 40;
      }

      // Exact match on any keyword
      faq.keywords.forEach(keyword => {
        const normalizedKeyword = normalize(keyword);
        if (normalizedQuery === normalizedKeyword) {
          score += 80;
        }
        // Query contains full keyword
        if (normalizedQuery.includes(normalizedKeyword) && normalizedKeyword.length > 2) {
          score += 30;
        }
        // Keyword contains full query
        if (normalizedKeyword.includes(normalizedQuery) && normalizedQuery.length > 2) {
          score += 25;
        }
      });

      // Original terms matching (higher weight)
      searchTerms.forEach(term => {
        const stemmedTerm = basicStem(term);
        // Question matching
        if (normalizedQuestion.includes(term)) {
          score += 5;
        } else {
          // Stemmed question matching
          const questionWords = normalizedQuestion.split(' ');
          if (questionWords.some(w => basicStem(w) === stemmedTerm)) {
            score += 3;
          }
        }
      });

      // Keyword matching with stems
      faq.keywords.forEach(keyword => {
        const normalizedKeyword = normalize(keyword);
        const keywordWords = normalizedKeyword.split(' ');

        searchTerms.forEach(term => {
          const stemmedTerm = basicStem(term);
          if (normalizedKeyword.includes(term) || term.includes(normalizedKeyword)) {
            score += 4;
          } else if (keywordWords.some(w => basicStem(w) === stemmedTerm)) {
            score += 3;
          }
        });
      });

      // Expanded synonym terms matching (lower weight than direct matches)
      expandedTerms.forEach(synTerm => {
        if (searchTerms.includes(synTerm)) return; // Skip original terms already scored

        if (normalizedQuestion.includes(synTerm)) {
          score += 3;
        }
        if (normalizedAnswer.includes(synTerm)) {
          score += 1;
        }
        faq.keywords.forEach(keyword => {
          if (normalize(keyword).includes(synTerm)) {
            score += 2;
          }
        });
      });

      // Answer content matching
      searchTerms.forEach(term => {
        if (normalizedAnswer.includes(term)) {
          score += 1;
        }
      });

      // Category matching
      searchTerms.forEach(term => {
        if (normalizedCategory.includes(term)) {
          score += 2;
        }
      });

      if (score > 0) {
        results.push({ ...faq, score });
      }
    });

    // If no results, return top 3 popular FAQs as fallback
    if (results.length === 0) {
      return managiraFAQ.slice(0, 3);
    }

    return results
      .sort((a, b) => b.score - a.score)
      .slice(0, 5)
      .map(({ score, ...faq }) => faq);
  }

  // Get response for user query
  static getResponse(req, res) {
    try {
      const { query } = req.body;

      if (!query || query.trim().length === 0) {
        return res.json({
          success: false,
          message: "Please enter a question about Managira."
        });
      }

      // Search FAQ first — if we find results, the query IS Managira-related
      const results = ChatbotController.searchFAQ(query);

      if (results.length > 0) {
        return res.json({
          success: true,
          results: results,
          contact: results.length < 3 ? "For more information, contact us at info@managira.com" : null
        });
      }

      // No results found — offer suggestions
      return res.json({
        success: true,
        message: "I couldn't find specific information about that. Here are some ways I can help:",
        suggestions: [
          "How do I register my school?",
          "How does billing and payment work?",
          "How do parents access their child's information?",
          "How do roles and permissions work?",
          "How do files and spreadsheets work?"
        ],
        contact: "For more detailed assistance, please contact our support team at info@managira.com"
      });

    } catch (error) {
      return res.json({
        success: false,
        message: "I'm having trouble processing your request. Please try again or contact support at info@managira.com"
      });
    }
  }

  // Get popular questions
  static getPopularQuestions(req, res) {
    try {
      const popularQuestions = managiraFAQ
        .filter(faq => [1, 3, 7, 72, 76, 80, 82, 84].includes(faq.id))
        .map(faq => ({
          id: faq.id,
          question: faq.question,
          category: faq.category
        }));

      return res.json({
        success: true,
        questions: popularQuestions
      });
    } catch (error) {
      return res.json({
        success: false,
        message: "Unable to load popular questions"
      });
    }
  }

  // Get FAQ by ID
  static getFAQById(req, res) {
    try {
      const { id } = req.params;
      const faq = managiraFAQ.find(f => f.id === parseInt(id));

      if (!faq) {
        return res.json({
          success: false,
          message: "Question not found"
        });
      }

      return res.json({
        success: true,
        faq: faq
      });
    } catch (error) {
      return res.json({
        success: false,
        message: "Unable to load question"
      });
    }
  }
}

module.exports = ChatbotController;
