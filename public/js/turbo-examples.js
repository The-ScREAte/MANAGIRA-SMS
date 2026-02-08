// Example implementations for common Turbo scenarios

// ============================================
// Example 1: Modal that works with Turbo
// ============================================
registerTurboInit('modals', function() {
  // Open modal
  document.addEventListener('click', (e) => {
    if (e.target.matches('[data-modal-open]')) {
      e.preventDefault();
      const modalId = e.target.dataset.modalOpen;
      const modal = document.getElementById(modalId);
      if (modal) {
        modal.classList.remove('hidden');
        document.body.style.overflow = 'hidden';
      }
    }
  });

  // Close modal
  document.addEventListener('click', (e) => {
    if (e.target.matches('[data-modal-close]') || e.target.matches('.modal-backdrop')) {
      e.preventDefault();
      const modal = e.target.closest('.modal');
      if (modal) {
        modal.classList.add('hidden');
        document.body.style.overflow = 'auto';
      }
    }
  });
});

// ============================================
// Example 2: Dropdown menus
// ============================================
registerTurboInit('dropdowns', function() {
  document.addEventListener('click', (e) => {
    // Open dropdown
    if (e.target.matches('[data-dropdown-trigger]')) {
      e.stopPropagation();
      const dropdown = e.target.nextElementSibling;
      
      // Close other dropdowns
      document.querySelectorAll('.dropdown-menu').forEach(d => {
        if (d !== dropdown) d.classList.add('hidden');
      });
      
      // Toggle this dropdown
      dropdown.classList.toggle('hidden');
    }
  });

  // Close dropdowns when clicking outside
  document.addEventListener('click', () => {
    document.querySelectorAll('.dropdown-menu').forEach(d => {
      d.classList.add('hidden');
    });
  });
});

// ============================================
// Example 3: Form submission with loading state
// ============================================
registerTurboInit('formHandling', function() {
  document.addEventListener('turbo:submit-start', (event) => {
    const form = event.target;
    const button = form.querySelector('button[type="submit"]');
    
    if (button) {
      button.disabled = true;
      button.innerHTML = '<span class="spinner-sm"></span> Loading...';
    }

    // Add loading class to form
    form.classList.add('form-loading');
  });

  document.addEventListener('turbo:submit-end', (event) => {
    const form = event.target;
    const button = form.querySelector('button[type="submit"]');
    
    if (button) {
      button.disabled = false;
      // Restore original button text (store it in data attribute)
      const originalText = button.dataset.originalText || 'Submit';
      button.innerHTML = originalText;
    }

    form.classList.remove('form-loading');
  });
});

// ============================================
// Example 4: Tabs navigation
// ============================================
registerTurboInit('tabs', function() {
  document.addEventListener('click', (e) => {
    if (e.target.matches('[data-tab]')) {
      e.preventDefault();
      const tabName = e.target.dataset.tab;
      const tabGroup = e.target.closest('[data-tab-group]');
      
      if (tabGroup) {
        // Remove active class from all tabs and contents
        tabGroup.querySelectorAll('[data-tab]').forEach(tab => {
          tab.classList.remove('active');
        });
        tabGroup.querySelectorAll('[data-tab-content]').forEach(content => {
          content.classList.add('hidden');
        });
        
        // Add active class to clicked tab
        e.target.classList.add('active');
        
        // Show corresponding content
        const content = tabGroup.querySelector(`[data-tab-content="${tabName}"]`);
        if (content) {
          content.classList.remove('hidden');
        }
      }
    }
  });
});

// ============================================
// Example 5: Infinite scroll
// ============================================
registerTurboInit('infiniteScroll', function() {
  const container = document.querySelector('[data-infinite-scroll]');
  if (!container) return;

  const loadMore = () => {
    const nextPageLink = container.querySelector('[data-next-page]');
    if (!nextPageLink) return;

    const rect = nextPageLink.getBoundingClientRect();
    const isVisible = rect.top < window.innerHeight * 1.5;

    if (isVisible && !nextPageLink.dataset.loading) {
      nextPageLink.dataset.loading = 'true';
      
      // Load next page
      fetch(nextPageLink.href, {
        headers: {
          'Accept': 'text/html',
          'Turbo-Frame': 'scroll-content'
        }
      })
      .then(response => response.text())
      .then(html => {
        const parser = new DOMParser();
        const doc = parser.parseFromString(html, 'text/html');
        const newContent = doc.querySelector('[data-infinite-scroll-content]');
        
        if (newContent) {
          container.querySelector('[data-infinite-scroll-content]').insertAdjacentHTML('beforeend', newContent.innerHTML);
          
          // Update next page link
          const newNextLink = doc.querySelector('[data-next-page]');
          if (newNextLink) {
            nextPageLink.href = newNextLink.href;
            nextPageLink.dataset.loading = 'false';
          } else {
            nextPageLink.remove();
          }
        }
      });
    }
  };

  window.addEventListener('scroll', loadMore);
  window.addEventListener('resize', loadMore);
});

// ============================================
// Example 6: Auto-save form
// ============================================
registerTurboInit('autoSave', function() {
  const forms = document.querySelectorAll('[data-auto-save]');
  
  forms.forEach(form => {
    let timeout;
    
    form.addEventListener('input', (e) => {
      clearTimeout(timeout);
      
      timeout = setTimeout(() => {
        const formData = new FormData(form);
        
        fetch(form.action, {
          method: 'POST',
          body: formData,
          headers: {
            'X-Requested-With': 'XMLHttpRequest'
          }
        })
        .then(response => response.json())
        .then(data => {
          // Show save indicator
          const indicator = form.querySelector('[data-save-indicator]');
          if (indicator) {
            indicator.textContent = '✓ Saved';
            indicator.classList.add('show');
            
            setTimeout(() => {
              indicator.classList.remove('show');
            }, 2000);
          }
        })
        .catch(error => {
          
        });
      }, 1000); // Save 1 second after user stops typing
    });
  });
});

// ============================================
// Example 7: Confirmation dialog
// ============================================
registerTurboInit('confirmations', function() {
  document.addEventListener('turbo:before-fetch-request', (event) => {
    const element = event.target;
    const confirmMessage = element.dataset.confirm;
    
    if (confirmMessage && !confirm(confirmMessage)) {
      event.preventDefault();
    }
  });
});

// ============================================
// Example 8: Flash messages that auto-dismiss
// ============================================
registerTurboInit('flashMessages', function() {
  const messages = document.querySelectorAll('[data-flash-message]');
  
  messages.forEach(message => {
    const duration = parseInt(message.dataset.duration) || 5000;
    
    setTimeout(() => {
      message.style.opacity = '0';
      message.style.transform = 'translateY(-20px)';
      
      setTimeout(() => {
        message.remove();
      }, 300);
    }, duration);
    
    // Allow manual dismissal
    const closeBtn = message.querySelector('[data-dismiss]');
    if (closeBtn) {
      closeBtn.addEventListener('click', () => {
        message.style.opacity = '0';
        setTimeout(() => message.remove(), 300);
      });
    }
  });
});

// ============================================
// Example 9: Search with debounce
// ============================================
registerTurboInit('liveSearch', function() {
  const searchInputs = document.querySelectorAll('[data-live-search]');
  
  searchInputs.forEach(input => {
    let timeout;
    
    input.addEventListener('input', (e) => {
      clearTimeout(timeout);
      const url = input.dataset.liveSearch;
      const query = e.target.value;
      
      timeout = setTimeout(() => {
        if (query.length >= 2) {
          fetch(`${url}?q=${encodeURIComponent(query)}`, {
            headers: { 'Accept': 'text/html' }
          })
          .then(response => response.text())
          .then(html => {
            const resultsContainer = document.querySelector('[data-search-results]');
            if (resultsContainer) {
              resultsContainer.innerHTML = html;
            }
          });
        }
      }, 300);
    });
  });
});

// ============================================
// Example 10: Client-side validation
// ============================================
registerTurboInit('validation', function() {
  const forms = document.querySelectorAll('[data-validate]');
  
  forms.forEach(form => {
    form.addEventListener('submit', (e) => {
      let isValid = true;
      
      // Clear previous errors
      form.querySelectorAll('.error').forEach(el => el.classList.remove('error'));
      form.querySelectorAll('.error-message').forEach(el => el.remove());
      
      // Validate required fields
      form.querySelectorAll('[required]').forEach(field => {
        if (!field.value.trim()) {
          isValid = false;
          field.classList.add('error');
          
          const errorMsg = document.createElement('span');
          errorMsg.className = 'error-message';
          errorMsg.textContent = 'This field is required';
          field.parentNode.appendChild(errorMsg);
        }
      });
      
      // Validate email fields
      form.querySelectorAll('[type="email"]').forEach(field => {
        const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
        if (field.value && !emailRegex.test(field.value)) {
          isValid = false;
          field.classList.add('error');
          
          const errorMsg = document.createElement('span');
          errorMsg.className = 'error-message';
          errorMsg.textContent = 'Please enter a valid email';
          field.parentNode.appendChild(errorMsg);
        }
      });
      
      if (!isValid) {
        e.preventDefault();
        // Scroll to first error
        const firstError = form.querySelector('.error');
        if (firstError) {
          firstError.scrollIntoView({ behavior: 'smooth', block: 'center' });
          firstError.focus();
        }
      }
    });
  });
});


