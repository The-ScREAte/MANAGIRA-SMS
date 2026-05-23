// Managira Chatbot JavaScript

class ManagiraChatbot {
  constructor() {
    this.isOpen = false;
    this.isLoading = false;
    this.isMinimized = false;
    this.messages = [];
    this.originalViewportHeight = window.innerHeight;
    this.keyboardVisible = false;
    this.requestController = null;
    this.boundHandlers = [];
    this.init();
  }

  init() {
    // Don't initialize chatbot on public dashboard
    if (document.body.getAttribute('data-page') === 'publicDashboard') {
      return;
    }
    // Don't initialize chatbot inside iframes (e.g. embedded workspace panels)
    if (window.self !== window.top) {
      return;
    }
    this.createChatbotHTML();
    this.bindEvents();
    this.loadPopularQuestions();
    this.showWelcomeMessage();
  }

  createChatbotHTML() {
    // Remove stale chatbot nodes (can happen after SPA swaps / repeated init)
    document.querySelectorAll('.chatbot-toggle, .chatbot-container').forEach((el) => el.remove());

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
    this.removeBoundEvents();

    const bind = (target, eventName, handler, options) => {
      target.addEventListener(eventName, handler, options);
      this.boundHandlers.push({ target, eventName, handler, options });
    };

    // Toggle chatbot
    bind(this.toggleButton, 'click', () => this.toggle());
    
    // Close chatbot (starts fresh chat)
    bind(this.closeButton, 'click', () => this.close());
    
    // Minimize/Maximize chatbot (preserves chat)
    bind(this.minimizeButton, 'click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      this.toggleMinimize();
    });
    
    // Send message on button click
    bind(this.sendButton, 'click', () => this.sendMessage());
    
    // Send message on Enter key
    bind(this.input, 'keypress', (e) => {
      if (e.key === 'Enter' && !this.isLoading) {
        this.sendMessage();
      }
    });

    // Close on outside click (but not when minimized)
    bind(document, 'click', (e) => {
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
    const bind = (target, eventName, handler, options) => {
      target.addEventListener(eventName, handler, options);
      this.boundHandlers.push({ target, eventName, handler, options });
    };

    bind(this.input, 'focus', () => {
      this.keyboardVisible = true;
      setTimeout(() => {
        if (this.isOpen && !this.isMinimized) {
          this.container.classList.add('keyboard-active');
          this.scrollToBottom();
        }
      }, 300);
    });

    bind(this.input, 'blur', () => {
      this.keyboardVisible = false;
      setTimeout(() => {
        this.container.classList.remove('keyboard-active');
      }, 300);
    });

    // Viewport resize handling for keyboard detection
    bind(window, 'resize', () => {
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
        // If open, convert toggle action to minimize for predictable behavior
        this.toggleMinimize();
      }
    } else {
      this.open();
    }
  }

  open() {
    // If DOM nodes were replaced, rebuild references safely
    if (!this.container || !document.body.contains(this.container) || !this.toggleButton || !document.body.contains(this.toggleButton)) {
      this.createChatbotHTML();
      this.bindEvents();
      this.resetConversation();
    }

    this.isOpen = true;
    this.isMinimized = false;
    this.container.classList.add('active');
    this.container.classList.remove('minimized');
    this.container.classList.remove('keyboard-active');
    this.minimizeButton.innerHTML = '−'; // Reset to minimize icon

    // Hide toggle button whenever full chat is open
    this.toggleButton.style.opacity = '0';
    this.toggleButton.style.pointerEvents = 'none';
    
    if (this.input && window.innerWidth > 768) {
      this.input.focus();
    }
  }

  close() {
    this.isOpen = false;
    this.isMinimized = false;
    this.isLoading = false;
    this.container.classList.remove('active');
    this.container.classList.remove('minimized');
    this.container.classList.remove('keyboard-active');
    this.minimizeButton.innerHTML = '−';

    if (this.sendButton) {
      this.sendButton.disabled = false;
    }
    this.abortInFlightRequest();
    this.hideLoading();
    
    // Show toggle button again
    this.toggleButton.style.opacity = '1';
    this.toggleButton.style.pointerEvents = 'auto';
    
    // Reset chatbot so re-open starts fresh
    this.resetConversation();
  }

  toggleMinimize() {
    this.isMinimized = !this.isMinimized;
    
    if (this.isMinimized) {
      this.container.classList.add('minimized');
      this.container.classList.remove('active');
      this.minimizeButton.innerHTML = '□'; // Maximize icon
      
      // Show toggle button when minimized (acts as restore control)
      this.toggleButton.style.opacity = '1';
      this.toggleButton.style.pointerEvents = 'auto';
    } else {
      this.container.classList.remove('minimized');
      this.container.classList.add('active');
      this.minimizeButton.innerHTML = '−'; // Minimize icon

      // Hide toggle button when expanded
      this.toggleButton.style.opacity = '0';
      this.toggleButton.style.pointerEvents = 'none';

      if (this.input) {
        this.input.focus();
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
      this.requestController = new AbortController();
      const response = await fetch('/api/chatbot/query', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        signal: this.requestController.signal,
        body: JSON.stringify({ query })
      });

      const data = await response.json();
      this.hideLoading();
      this.requestController = null;

      if (data.success) {
        if (data.type === 'results') {
          this.showSearchResults(data.summary, data.faqHits || [], data.docHits || []);
        } else if (data.type === 'no_results') {
          this.showNoResults(data.message, data.links || []);
        } else {
          this.addMessage(data.message, 'bot');
        }
      } else {
        this.showErrorLinks(data.message, data.links || []);
      }
    } catch (error) {
      if (error.name === 'AbortError') {
        return;
      }
      this.hideLoading();
      this.requestController = null;
      this.addMessage('Sorry, I\'m having trouble connecting. Please try again later or contact support at info@managira.com', 'bot');
    }
  }

  formatBotContent(text) {
    if (text == null) return '';
    const escape = (s) => String(s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
    let html = escape(text);
    // Auto-link URLs
    html = html.replace(/\b(https?:\/\/[^\s<]+)/g, (url) => {
      const clean = url.replace(/[.,);:!?]+$/, '');
      const trail = url.slice(clean.length);
      return `<a href="${clean}" target="_blank" rel="noopener noreferrer">${clean}</a>${trail}`;
    });
    // Auto-link emails
    html = html.replace(/\b([A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,})\b/g,
      '<a href="mailto:$1">$1</a>');
    // Bold **text**
    html = html.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
    return html;
  }

  formatTime(date) {
    try {
      return date.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
    } catch (_) {
      return '';
    }
  }

  addMessage(content, type) {
    const messageDiv = document.createElement('div');
    messageDiv.className = `message message-${type}`;

    const bubbleDiv = document.createElement('div');
    bubbleDiv.className = 'message-bubble';
    if (type === 'bot') {
      bubbleDiv.innerHTML = this.formatBotContent(content);
    } else {
      bubbleDiv.textContent = content;
    }

    const meta = document.createElement('div');
    meta.className = 'message-meta';
    meta.textContent = (type === 'bot' ? 'Managira • ' : '') + this.formatTime(new Date());

    messageDiv.appendChild(bubbleDiv);
    messageDiv.appendChild(meta);
    this.messagesContainer.appendChild(messageDiv);
    this.scrollToBottom();
  }

  showSearchResults(summary, faqHits, docHits) {
    const escape = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    const messageDiv = document.createElement('div');
    messageDiv.className = 'message message-bot';

    const bubbleDiv = document.createElement('div');
    bubbleDiv.className = 'message-bubble';
    bubbleDiv.textContent = summary;
    messageDiv.appendChild(bubbleDiv);

    if (faqHits.length > 0) {
      const section = document.createElement('div');
      section.className = 'chatbot-results-section';
      const heading = document.createElement('div');
      heading.className = 'chatbot-results-heading';
      heading.textContent = 'From the FAQ';
      section.appendChild(heading);
      faqHits.forEach((hit) => {
        const a = document.createElement('a');
        a.className = 'chatbot-result-card chatbot-result-card--faq';
        a.href = hit.url;
        a.innerHTML = `<span class="chatbot-result-card__type">FAQ</span><span class="chatbot-result-card__title">${escape(hit.question)}</span><span class="chatbot-result-card__cta">Read →</span>`;
        section.appendChild(a);
      });
      messageDiv.appendChild(section);
    }

    if (docHits.length > 0) {
      const section = document.createElement('div');
      section.className = 'chatbot-results-section';
      const heading = document.createElement('div');
      heading.className = 'chatbot-results-heading';
      heading.textContent = 'From Documentation';
      section.appendChild(heading);
      docHits.forEach((hit) => {
        const a = document.createElement('a');
        a.className = 'chatbot-result-card chatbot-result-card--article';
        a.href = hit.url;
        const excerptHtml = hit.excerpt
          ? `<span class="chatbot-result-card__excerpt">${escape(hit.excerpt.slice(0, 90))}${hit.excerpt.length > 90 ? '\u2026' : ''}</span>`
          : '';
        a.innerHTML = `<span class="chatbot-result-card__type">Article</span><span class="chatbot-result-card__title">${escape(hit.title)}</span>${excerptHtml}<span class="chatbot-result-card__cta">Read →</span>`;
        section.appendChild(a);
      });
      messageDiv.appendChild(section);
    }

    const meta = document.createElement('div');
    meta.className = 'message-meta';
    meta.textContent = 'Managira • ' + this.formatTime(new Date());
    messageDiv.appendChild(meta);
    this.messagesContainer.appendChild(messageDiv);
    this.scrollToBottom();
  }

  showNoResults(message, links) {
    const messageDiv = document.createElement('div');
    messageDiv.className = 'message message-bot';
    const bubble = document.createElement('div');
    bubble.className = 'message-bubble';
    bubble.textContent = message;
    messageDiv.appendChild(bubble);
    if (links.length > 0) {
      const linksDiv = document.createElement('div');
      linksDiv.className = 'chatbot-browse-links';
      links.forEach((l) => {
        const a = document.createElement('a');
        a.className = 'chatbot-browse-link';
        a.href = l.url;
        a.textContent = l.label;
        linksDiv.appendChild(a);
      });
      messageDiv.appendChild(linksDiv);
    }
    const meta = document.createElement('div');
    meta.className = 'message-meta';
    meta.textContent = 'Managira • ' + this.formatTime(new Date());
    messageDiv.appendChild(meta);
    this.messagesContainer.appendChild(messageDiv);
    this.scrollToBottom();
  }

  showErrorLinks(message, links) {
    const messageDiv = document.createElement('div');
    messageDiv.className = 'message message-bot';
    const bubble = document.createElement('div');
    bubble.className = 'message-bubble';
    bubble.textContent = message || "I'm having trouble right now. Try these links:";
    messageDiv.appendChild(bubble);
    if (links.length > 0) {
      const linksDiv = document.createElement('div');
      linksDiv.className = 'chatbot-browse-links';
      links.forEach((l) => {
        const a = document.createElement('a');
        a.className = 'chatbot-browse-link';
        a.href = l.url;
        a.textContent = l.label;
        linksDiv.appendChild(a);
      });
      messageDiv.appendChild(linksDiv);
    }
    const meta = document.createElement('div');
    meta.className = 'message-meta';
    meta.textContent = 'Managira • ' + this.formatTime(new Date());
    messageDiv.appendChild(meta);
    this.messagesContainer.appendChild(messageDiv);
    this.scrollToBottom();
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
    if (!this.messagesContainer) return;

    const welcomeDiv = document.createElement('div');
    welcomeDiv.className = 'welcome-message';
    welcomeDiv.innerHTML = `
      <h4>Managira Help</h4>
      <p>Ask anything and I'll try to help.</p>
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
    if (!this.messagesContainer) return;

    const popularDiv = document.createElement('div');
    popularDiv.className = 'popular-questions';
    
    const titleDiv = document.createElement('h5');
    titleDiv.textContent = 'Popular topics:';
    popularDiv.appendChild(titleDiv);
    
    questions.forEach((q) => {
      const a = document.createElement('a');
      a.className = 'popular-question popular-question--link';
      a.href = q.url;
      a.textContent = q.question;
      popularDiv.appendChild(a);
    });
    
    this.messagesContainer.appendChild(popularDiv);
  }

  scrollToBottom() {
    setTimeout(() => {
      if (this.messagesContainer) {
        this.messagesContainer.scrollTop = this.messagesContainer.scrollHeight;
      }
    }, 100);
  }

  resetConversation() {
    this.abortInFlightRequest();
    this.isLoading = false;
    this.messages = [];

    if (this.input) {
      this.input.value = '';
    }
    if (this.sendButton) {
      this.sendButton.disabled = false;
    }
    if (this.messagesContainer) {
      this.messagesContainer.innerHTML = '';
    }

    this.showWelcomeMessage();
    this.loadPopularQuestions();
  }

  abortInFlightRequest() {
    if (this.requestController) {
      this.requestController.abort();
      this.requestController = null;
    }
  }

  removeBoundEvents() {
    if (!Array.isArray(this.boundHandlers) || this.boundHandlers.length === 0) {
      return;
    }

    this.boundHandlers.forEach(({ target, eventName, handler, options }) => {
      try {
        target.removeEventListener(eventName, handler, options);
      } catch (_) {
      }
    });

    this.boundHandlers = [];
  }

  destroy() {
    this.abortInFlightRequest();
    this.removeBoundEvents();
    if (this.container) {
      this.container.remove();
      this.container = null;
    }
    if (this.toggleButton) {
      this.toggleButton.remove();
      this.toggleButton = null;
    }

    this.messagesContainer = null;
    this.input = null;
    this.sendButton = null;
    this.closeButton = null;
    this.minimizeButton = null;
  }
}

function shouldInitializeChatbot() {
  const currentPath = window.location.pathname;
  const restrictedPaths = ['/admin', '/api'];
  const isRestricted = restrictedPaths.some(path => currentPath.startsWith(path));
  const isPublicDashboard = document.body.getAttribute('data-page') === 'publicDashboard';
  return !isRestricted && !isPublicDashboard;
}

function initChatbotIfNeeded() {
  const shouldInitialize = shouldInitializeChatbot();

  if (!shouldInitialize) {
    if (window.managiraChatbotInstance) {
      window.managiraChatbotInstance.destroy();
      window.managiraChatbotInstance = null;
    }
    return;
  }

  if (!window.managiraChatbotInstance) {
    window.managiraChatbotInstance = new ManagiraChatbot();
  }
}

// Initial load
document.addEventListener('DOMContentLoaded', initChatbotIfNeeded);

// SPA navigations
window.addEventListener('spa:pageLoaded', initChatbotIfNeeded);