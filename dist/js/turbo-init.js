// Turbo-compatible initialization helper
// This file helps manage JavaScript initialization across Turbo navigation

(function() {
  'use strict';

  // Store initialization functions
  const initFunctions = new Map();

  // Global function to register initializers
  window.registerTurboInit = function(name, initFunction) {
    initFunctions.set(name, initFunction);
  };

  // Global function to initialize page
  window.initializePage = function() {
    
    
    // Run all registered initialization functions
    initFunctions.forEach((fn, name) => {
      try {
        fn();
        
      } catch (error) {
        
      }
    });

    // Re-initialize any data attributes or plugins
    initializeDataAttributes();
    initializeFormValidation();
    initializeTooltips();
  };

  // Initialize data-attribute based functionality
  function initializeDataAttributes() {
    // Example: data-confirm attributes
    document.querySelectorAll('[data-confirm]').forEach(element => {
      if (element.dataset.turboBoundConfirm === '1' || element.hasAttribute('data-spa-bound-confirm')) return;
      element.dataset.turboBoundConfirm = '1';
      element.setAttribute('data-spa-bound-confirm', '1');
      element.addEventListener('click', (e) => {
        const message = element.dataset.confirm;
        if (!confirm(message)) {
          e.preventDefault();
          e.stopPropagation();
        }
      });
    });

    // Example: data-toggle attributes
    document.querySelectorAll('[data-toggle]').forEach(element => {
      if (element.dataset.turboBoundToggle === '1' || element.hasAttribute('data-spa-bound-toggle')) return;
      element.dataset.turboBoundToggle = '1';
      element.setAttribute('data-spa-bound-toggle', '1');

      element.addEventListener('click', (e) => {
        const rawTarget = String(element.dataset.toggle || '').trim();
        if (!rawTarget) return;

        // Password icon toggles are handled by page-specific scripts.
        if (element.classList.contains('input-icon-btn')) return;

        if (element.tagName === 'A') {
          e.preventDefault();
        }

        let targetElement = null;
        if (/^[A-Za-z][A-Za-z0-9_:\-.]*$/.test(rawTarget)) {
          targetElement = document.getElementById(rawTarget);
        }
        if (!targetElement) {
          try {
            targetElement = document.querySelector(rawTarget);
          } catch (_) {
            targetElement = null;
          }
        }

        if (targetElement) {
          targetElement.classList.toggle('hidden');
        }
      });
    });
  }

  // Initialize form validation
  function initializeFormValidation() {
    document.querySelectorAll('form[data-validate]').forEach(form => {
      if (form.dataset.turboBoundValidate === '1') return;
      form.dataset.turboBoundValidate = '1';
      form.addEventListener('submit', (e) => {
        const requiredFields = form.querySelectorAll('[required]');
        let valid = true;

        requiredFields.forEach(field => {
          if (!field.value.trim()) {
            valid = false;
            field.classList.add('error');
          } else {
            field.classList.remove('error');
          }
        });

        if (!valid) {
          e.preventDefault();
          alert('Please fill in all required fields');
        }
      });
    });
  }

  // Initialize tooltips or popovers
  function initializeTooltips() {
    document.querySelectorAll('[data-tooltip]').forEach(element => {
      element.setAttribute('title', element.dataset.tooltip);
    });
  }

  // Handle Turbo events
  document.addEventListener('turbo:load', () => {
    initializePage();
  });

  // Handle Turbo form submissions
  document.addEventListener('turbo:submit-start', (event) => {
    const form = event.target;
    const submitBtn = form.querySelector('[type="submit"]');
    
    if (submitBtn) {
      submitBtn.disabled = true;
      const originalText = submitBtn.textContent;
      submitBtn.dataset.originalText = originalText;
      submitBtn.textContent = 'Loading...';
    }
  });

  document.addEventListener('turbo:submit-end', (event) => {
    const form = event.target;
    const submitBtn = form.querySelector('[type="submit"]');
    
    if (submitBtn) {
      submitBtn.disabled = false;
      if (submitBtn.dataset.originalText) {
        submitBtn.textContent = submitBtn.dataset.originalText;
      }
    }
  });

  // Handle navigation errors
  document.addEventListener('turbo:fetch-request-error', (event) => {
    
    alert('Connection error. Please check your internet connection.');
  });

  // Cache management - clear cache on certain actions
  window.clearTurboCache = function() {
    if (window.Turbo) {
      Turbo.clearCache();
      
    }
  };

  // Force a full page reload (useful for debugging)
  window.forceReload = function() {
    location.reload();
  };

  // Utility: Check if Turbo is active
  window.isTurboActive = function() {
    return !!window.Turbo;
  };

  
})();

// Example usage in other scripts:
// 
// registerTurboInit('myFeature', function() {
//   // Your initialization code here
//   
//   
//   // Set up event listeners
//   document.querySelectorAll('.my-button').forEach(btn => {
//     btn.addEventListener('click', handleClick);
//   });
// });
