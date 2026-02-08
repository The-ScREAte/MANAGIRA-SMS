const managiraFAQ = require('../utils/managiraFAQ');

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
      .filter(term => term.length > 2);

    const results = [];

    managiraFAQ.forEach(faq => {
      let score = 0;

      const normalizedQuestion = normalize(faq.question);

      // Exact match on full question
      if (normalizedQuery === normalizedQuestion) {
        score += 100; // force to the top
      }

      // Exact match on any keyword
      faq.keywords.forEach(keyword => {
        if (normalizedQuery === normalize(keyword)) {
          score += 80;
        }
      });

      // Partial matches across fields
      const questionWords = faq.question.toLowerCase();
      searchTerms.forEach(term => {
        if (questionWords.includes(term)) {
          score += 3; // Higher score for question matches
        }
      });

      faq.keywords.forEach(keyword => {
        const normalizedKeyword = normalize(keyword);
        searchTerms.forEach(term => {
          if (normalizedKeyword.includes(term) || term.includes(normalizedKeyword)) {
            score += 2;
          }
        });
      });

      const answerWords = faq.answer.toLowerCase();
      searchTerms.forEach(term => {
        if (answerWords.includes(term)) {
          score += 1;
        }
      });

      const categoryWords = faq.category.toLowerCase();
      searchTerms.forEach(term => {
        if (categoryWords.includes(term)) {
          score += 2;
        }
      });

      if (score > 0) {
        results.push({ ...faq, score });
      }
    });

    // If still no results, return top 3 popular FAQs as a helpful fallback
    if (results.length === 0) {
      return managiraFAQ.slice(0, 3);
    }

    // Sort by score and return top 5 for broader coverage
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

      // Check if query is Managira related
      const managiraKeywords = [
        'managira', 'student', 'school', 'grade', 'enrollment', 'assessment',
        'billing', 'payment', 'organization', 'admin', 'teacher', 'employee',
        'attendance', 'report', 'account', 'login', 'register', 'class',
        'transcript', 'fee', 'tuition', 'academic', 'dashboard', 'management',
        'education', 'learning', 'curriculum', 'term', 'semester', 'year',
        'parent', 'guardian', 'staff', 'faculty', 'principal', 'records'
      ];

      const isManagiraRelated = managiraKeywords.some(keyword => 
        query.toLowerCase().includes(keyword)
      );

      if (!isManagiraRelated) {
        return res.json({
          success: false,
          message: "I can only help with Managira-related questions. Please ask about our school management features, student enrollment, billing, or other Managira services."
        });
      }

      const results = ChatbotController.searchFAQ(query);

      if (results.length === 0) {
        return res.json({
          success: true,
          message: "I couldn't find specific information about that. Here are some ways I can help:",
          suggestions: [
            "Ask about student enrollment and registration",
            "Learn about our billing and payment features", 
            "Get help with account management",
            "Find information about reports and assessments"
          ],
          contact: "For more detailed assistance, please contact our support team at info@managira.com"
        });
      }

      return res.json({
        success: true,
        results: results,
        contact: results.length < 3 ? "For more information, contact us at info@managira.com" : null
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
        .filter(faq => [1, 3, 7, 15].includes(faq.id)) // Popular FAQ IDs from real FAQ
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