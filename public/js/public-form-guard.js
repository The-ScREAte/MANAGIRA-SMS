(function () {
  function countMeaningfulWords(value) {
    const normalized = String(value || '').trim();
    if (!normalized) return 0;
    const matches = normalized.match(/[A-Za-z0-9][A-Za-z0-9'-]*/g);
    return matches ? matches.length : 0;
  }

  function getFieldLabel(field) {
    if (field.dataset.minWordsLabel) {
      return field.dataset.minWordsLabel;
    }

    if (field.id) {
      const label = document.querySelector('label[for="' + field.id + '"]');
      if (label) {
        return label.textContent.replace(/\*/g, '').trim();
      }
    }

    return field.name || 'This field';
  }

  function validateForm(form) {
    const wordFields = Array.from(form.querySelectorAll('[data-min-words]'));

    for (const field of wordFields) {
      const minWords = Number.parseInt(field.dataset.minWords || '3', 10);
      const optional = field.dataset.optional === 'true';
      const value = String(field.value || '').trim();

      if (!value && optional) {
        field.setCustomValidity('');
        continue;
      }

      if (countMeaningfulWords(value) < minWords) {
        const message = getFieldLabel(field) + ' must contain at least ' + minWords + ' words.';
        field.setCustomValidity(message);
        field.reportValidity();
        field.focus();
        return false;
      }

      field.setCustomValidity('');
    }

    const confirmation = form.querySelector('input[name="human_confirmation"]');
    if (confirmation && !confirmation.checked) {
      confirmation.setCustomValidity('Please confirm that this is a genuine submission.');
      confirmation.reportValidity();
      confirmation.focus();
      return false;
    }

    if (confirmation) {
      confirmation.setCustomValidity('');
    }

    const confirmMessage = form.dataset.confirmMessage || 'Submit this form?';
    return window.confirm(confirmMessage);
  }

  document.addEventListener('DOMContentLoaded', function () {
    document.querySelectorAll('[data-public-form-guard]').forEach(function (form) {
      const startedAtInput = form.querySelector('input[name="form_started_at"]');
      if (startedAtInput && !startedAtInput.value) {
        startedAtInput.value = String(Date.now());
      }

      form.addEventListener('submit', function (event) {
        if (!validateForm(form)) {
          event.preventDefault();
        }
      });
    });
  });
})();