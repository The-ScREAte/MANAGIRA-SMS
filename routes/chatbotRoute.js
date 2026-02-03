const express = require('express');
const router = express.Router();
const ChatbotController = require('../controllers/chatbotController');

// POST /api/chatbot/query - Send a question to the chatbot
router.post('/query', ChatbotController.getResponse);

// GET /api/chatbot/popular - Get popular questions
router.get('/popular', ChatbotController.getPopularQuestions);

// GET /api/chatbot/faq/:id - Get specific FAQ by ID
router.get('/faq/:id', ChatbotController.getFAQById);

module.exports = router;