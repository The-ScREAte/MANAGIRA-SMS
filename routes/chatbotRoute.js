const express = require('express');
const router = express.Router();
const ChatbotController = require('../controllers/chatbotController');

const { checkRateLimit } = require('../utils/rateLimiter');
const { clientIp } = require('../utils/authRateLimit');

// Questions per visitor: 30 a minute is plenty for a person and stops floods of searches.
function questionLimit(req, res, next) {
  const limit = checkRateLimit('chatbot:' + clientIp(req), { max: 30, windowMs: 60 * 1000 });
  if (!limit.allowed) return res.status(429).json({ success: false, message: 'Too many questions at once. Please wait a moment.' });
  return next();
}

// POST /api/chatbot/query - Send a question to the chatbot
router.post('/query', questionLimit, ChatbotController.getResponse);

// GET /api/chatbot/popular - Get popular questions
router.get('/popular', ChatbotController.getPopularQuestions);

// GET /api/chatbot/faq/:id - Get specific FAQ by ID
router.get('/faq/:id', ChatbotController.getFAQById);

module.exports = router;