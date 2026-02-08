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
      const target = element.dataset.toggle;
      element.addEventListener('click', (e) => {
        e.preventDefault();
        const targetElement = document.querySelector(target);
        if (targetElement) {
          targetElement.classList.toggle('hidden');
        }
      });
    });
  }

  // Initialize form validation
  function initializeFormValidation() {
    document.querySelectorAll('form[data-validate]').forEach(form => {
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
