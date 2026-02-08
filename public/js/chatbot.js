// Managira Chatbot JavaScript

class ManagiraChatbot {
  constructor() {
    this.isOpen = false;
    this.isLoading = false;
    this.isMinimized = false;
    this.messages = [];
    this.originalViewportHeight = window.innerHeight;
    this.keyboardVisible = false;
    this.init();
  }

  init() {
    // Don't initialize chatbot on public dashboard
    if (document.body.getAttribute('data-page') === 'publicDashboard') {
      return;
    }
    this.createChatbotHTML();
    this.bindEvents();
    this.loadPopularQuestions();
    this.showWelcomeMessage();
  }

  createChatbotHTML() {
    // Create chatbot toggle button
    const toggleButton = document.createElement('button');
    toggleButton.className = 'chatbot-toggle';
    toggleButton.innerHTML = `
      <svg viewBox="0 0 24 24">
        <path d="M12 3C17.5 3 22 6.58 22 11C22 15.42 17.5 19 12 19C10.76 19 9.57 18.82 8.47 18.5L5 20V16.5C3.24 14.93 2 12.62 2 10C2 5.58 6.5 2 12 2L12 3M8.5 14L9.5 12H14.5L15.5 14H8.5Z"/>
      </svg>
    `;

    // Create chatbot container
    const container = document.createElement('div');
    container.className = 'chatbot-container';
    container.innerHTML = `
      <div class="chatbot-header">
        <h3>Managira Assistant</h3>
        <div class="chatbot-controls">
          <button class="chatbot-minimize">−</button>
          <button class="chatbot-close">&times;</button>
        </div>
      </div>
      <div class="chatbot-content">
        <div class="chatbot-messages" id="chatbot-messages"></div>
        <div class="chatbot-input-area">
          <input 
            type="text" 
            class="chatbot-input" 
            id="chatbot-input"
            placeholder="Ask me about Managira..."
            maxlength="200"
          />
          <button class="chatbot-send" id="chatbot-send">
            <svg viewBox="0 0 24 24">
              <path d="M2,21L23,12L2,3V10L17,12L2,14V21Z"/>
            </svg>
          </button>
        </div>
      </div>
    `;

    // Add elements to page
    document.body.appendChild(toggleButton);
    document.body.appendChild(container);

    // Store references
    this.toggleButton = toggleButton;
    this.container = container;
    this.messagesContainer = document.getElementById('chatbot-messages');
    this.input = document.getElementById('chatbot-input');
    this.sendButton = document.getElementById('chatbot-send');
    this.closeButton = container.querySelector('.chatbot-close');
    this.minimizeButton = container.querySelector('.chatbot-minimize');
  }

  bindEvents() {
    // Toggle chatbot
    this.toggleButton.addEventListener('click', () => this.toggle());
    
    // Close chatbot (starts fresh chat)
    this.closeButton.addEventListener('click', () => this.close());
    
    // Minimize/Maximize chatbot (preserves chat)
    this.minimizeButton.addEventListener('click', () => this.toggleMinimize());
    
    // Send message on button click
    this.sendButton.addEventListener('click', () => this.sendMessage());
    
    // Send message on Enter key
    this.input.addEventListener('keypress', (e) => {
      if (e.key === 'Enter' && !this.isLoading) {
        this.sendMessage();
      }
    });

    // Close on outside click (but not when minimized)
    document.addEventListener('click', (e) => {
      if (this.isOpen && !this.isMinimized &&
          !this.container.contains(e.target) && 
          !this.toggleButton.contains(e.target)) {
        this.close();
      }
    });

    // Handle mobile keyboard visibility
    this.setupMobileKeyboardHandling();
  }

  setupMobileKeyboardHandling() {
    // Detect mobile device
    const isMobile = window.innerWidth <= 768;
    if (!isMobile) return;

    // Input focus events for mobile keyboard handling
    this.input.addEventListener('focus', () => {
      this.keyboardVisible = true;
      setTimeout(() => {
        if (this.isOpen && !this.isMinimized) {
          this.container.classList.add('keyboard-active');
          this.scrollToBottom();
        }
      }, 300);
    });

    this.input.addEventListener('blur', () => {
      this.keyboardVisible = false;
      setTimeout(() => {
        this.container.classList.remove('keyboard-active');
      }, 300);
    });

    // Viewport resize handling for keyboard detection
    window.addEventListener('resize', () => {
      const currentHeight = window.innerHeight;
      const heightDifference = this.originalViewportHeight - currentHeight;
      
      // If height reduced significantly, keyboard is likely visible
      if (heightDifference > 150 && this.isOpen && !this.isMinimized) {
        this.container.classList.add('keyboard-active');
      } else {
        this.container.classList.remove('keyboard-active');
      }
    });
  }

  toggle() {
    if (this.isOpen) {
      if (this.isMinimized) {
        // If minimized, restore to full size
        this.toggleMinimize();
      } else {
        this.close();
      }
    } else {
      this.open();
    }
  }

  open() {
    this.isOpen = true;
    this.isMinimized = false;
    this.container.classList.add('active');
    this.container.classList.remove('minimized');
    this.minimizeButton.innerHTML = '−'; // Reset to minimize icon
    
    // Hide toggle button on mobile when chat is open
    if (window.innerWidth <= 768) {
      this.toggleButton.style.opacity = '0';
      this.toggleButton.style.pointerEvents = 'none';
    }
    
    this.input.focus();
  }

  close() {
    this.isOpen = false;
    this.isMinimized = false;
    this.container.classList.remove('active');
    this.container.classList.remove('minimized');
    this.container.classList.remove('keyboard-active');
    
    // Show toggle button again
    this.toggleButton.style.opacity = '1';
    this.toggleButton.style.pointerEvents = 'auto';
    
    // Clear chat history for fresh start
    this.messages = [];
    this.messagesContainer.innerHTML = '';
    this.showWelcomeMessage();
  }

  toggleMinimize() {
    this.isMinimized = !this.isMinimized;
    
    if (this.isMinimized) {
      this.container.classList.add('minimized');
      this.minimizeButton.innerHTML = '□'; // Maximize icon
      
      // Show toggle button when minimized
      this.toggleButton.style.opacity = '1';
      this.toggleButton.style.pointerEvents = 'auto';
    } else {
      this.container.classList.remove('minimized');
      this.minimizeButton.innerHTML = '−'; // Minimize icon
      
      // Hide toggle button when expanded on mobile
      if (window.innerWidth <= 768) {
        this.toggleButton.style.opacity = '0';
        this.toggleButton.style.pointerEvents = 'none';
      }
    }
  }

  async sendMessage() {
    const query = this.input.value.trim();
    if (!query || this.isLoading) return;

    // Add user message
    this.addMessage(query, 'user');
    this.input.value = '';
    
    // Show loading
    this.showLoading();

    try {
      const response = await fetch('/api/chatbot/query', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ query })
      });

      const data = await response.json();
      this.hideLoading();

      if (data.success) {
        if (data.results && data.results.length > 0) {
          this.showFAQResults(data.results, data.contact);
        } else if (data.suggestions) {
          this.showSuggestions(data.message, data.suggestions, data.contact);
        } else {
          this.addMessage(data.message, 'bot');
        }
      } else {
        this.addMessage(data.message, 'bot');
      }
    } catch (error) {
      
      this.hideLoading();
      this.addMessage('Sorry, I\'m having trouble connecting. Please try again later or contact support at info@managira.com', 'bot');
    }
  }

  addMessage(content, type) {
    const messageDiv = document.createElement('div');
    messageDiv.className = `message message-${type}`;
    
    const bubbleDiv = document.createElement('div');
    bubbleDiv.className = 'message-bubble';
    bubbleDiv.textContent = content;
    
    messageDiv.appendChild(bubbleDiv);
    this.messagesContainer.appendChild(messageDiv);
    this.scrollToBottom();
  }

  showFAQResults(results, contact) {
    const messageDiv = document.createElement('div');
    messageDiv.className = 'message message-bot';
    
    const bubbleDiv = document.createElement('div');
    bubbleDiv.className = 'message-bubble';
    bubbleDiv.innerHTML = 'Here\'s what I found:';
    
    const resultsDiv = document.createElement('div');
    resultsDiv.className = 'faq-results';
    
    results.forEach(faq => {
      const faqDiv = document.createElement('div');
      faqDiv.className = 'faq-item';
      faqDiv.innerHTML = `
        <div class="faq-question">${faq.question}</div>
        <div class="faq-category">${faq.category}</div>
      `;
      
      faqDiv.addEventListener('click', () => {
        this.showFAQAnswer(faq);
      });
      
      resultsDiv.appendChild(faqDiv);
    });
    
    messageDiv.appendChild(bubbleDiv);
    messageDiv.appendChild(resultsDiv);
    
    if (contact) {
      const contactDiv = document.createElement('div');
      contactDiv.className = 'contact-info';
      contactDiv.textContent = contact;
      messageDiv.appendChild(contactDiv);
    }
    
    this.messagesContainer.appendChild(messageDiv);
    this.scrollToBottom();
  }

  showFAQAnswer(faq) {
    this.addMessage(faq.answer, 'bot');
  }

  showSuggestions(message, suggestions, contact) {
    const messageDiv = document.createElement('div');
    messageDiv.className = 'message message-bot';
    
    const bubbleDiv = document.createElement('div');
    bubbleDiv.className = 'message-bubble';
    bubbleDiv.textContent = message;
    
    const suggestionsDiv = document.createElement('div');
    suggestionsDiv.className = 'suggestions';
    
    suggestions.forEach(suggestion => {
      const suggestionDiv = document.createElement('div');
      suggestionDiv.className = 'suggestion-item';
      suggestionDiv.textContent = suggestion;
      
      suggestionDiv.addEventListener('click', () => {
        this.input.value = suggestion;
        this.sendMessage();
      });
      
      suggestionsDiv.appendChild(suggestionDiv);
    });
    
    messageDiv.appendChild(bubbleDiv);
    messageDiv.appendChild(suggestionsDiv);
    
    if (contact) {
      const contactDiv = document.createElement('div');
      contactDiv.className = 'contact-info';
      contactDiv.textContent = contact;
      messageDiv.appendChild(contactDiv);
    }
    
    this.messagesContainer.appendChild(messageDiv);
    this.scrollToBottom();
  }

  showLoading() {
    this.isLoading = true;
    this.sendButton.disabled = true;
    
    const loadingDiv = document.createElement('div');
    loadingDiv.className = 'message message-bot';
    loadingDiv.id = 'loading-message';
    
    const bubbleDiv = document.createElement('div');
    bubbleDiv.className = 'message-bubble';
    
    const typingDiv = document.createElement('div');
    typingDiv.className = 'typing-indicator';
    typingDiv.innerHTML = `
      <div class="typing-dot"></div>
      <div class="typing-dot"></div>
      <div class="typing-dot"></div>
    `;
    
    bubbleDiv.appendChild(typingDiv);
    loadingDiv.appendChild(bubbleDiv);
    this.messagesContainer.appendChild(loadingDiv);
    this.scrollToBottom();
  }

  hideLoading() {
    this.isLoading = false;
    this.sendButton.disabled = false;
    
    const loadingMessage = document.getElementById('loading-message');
    if (loadingMessage) {
      loadingMessage.remove();
    }
  }

  showWelcomeMessage() {
    const welcomeDiv = document.createElement('div');
    welcomeDiv.className = 'welcome-message';
    welcomeDiv.innerHTML = `
      <h4>👋 Welcome to Managira!</h4>
      <p>I'm here to help answer your questions about our school management platform. Ask me anything about student enrollment, billing, reports, or other Managira features.</p>
    `;
    
    this.messagesContainer.appendChild(welcomeDiv);
  }

  async loadPopularQuestions() {
    try {
      const response = await fetch('/api/chatbot/popular');
      const data = await response.json();
      
      if (data.success && data.questions) {
        this.showPopularQuestions(data.questions);
      }
    } catch (error) {
      
    }
  }

  showPopularQuestions(questions) {
    const popularDiv = document.createElement('div');
    popularDiv.className = 'popular-questions';
    
    const titleDiv = document.createElement('h5');
    titleDiv.textContent = 'Popular Questions:';
    popularDiv.appendChild(titleDiv);
    
    questions.forEach(question => {
      const questionDiv = document.createElement('div');
      questionDiv.className = 'popular-question';
      questionDiv.textContent = question.question;
      
      questionDiv.addEventListener('click', async () => {
        this.input.value = question.question;
        await this.sendMessage();
      });
      
      popularDiv.appendChild(questionDiv);
    });
    
    this.messagesContainer.appendChild(popularDiv);
  }

  scrollToBottom() {
    setTimeout(() => {
      this.messagesContainer.scrollTop = this.messagesContainer.scrollHeight;
    }, 100);
  }
}

// Initialize chatbot when DOM is loaded
document.addEventListener('DOMContentLoaded', () => {
  // Only initialize if we're not on admin pages or certain restricted pages
  const currentPath = window.location.pathname;
  const restrictedPaths = ['/admin', '/api'];
  
  const shouldInitialize = !restrictedPaths.some(path => currentPath.startsWith(path));
  
  if (shouldInitialize) {
    new ManagiraChatbot();
  }
});