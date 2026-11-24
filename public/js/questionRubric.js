// A rubric on a written (essay) question, in the question editor: a few criteria with marks. Their total is
// the question's marks. Used with QuestionRubric.decorate(card, question) when a question card is drawn and
// QuestionRubric.rubricOf(card) when it is saved. Turned on by window.QuestionRubricConfig.on (the page says
// so once the database has the columns).
(function () {
  'use strict';
  var cfg = window.QuestionRubricConfig || {};
  if (!cfg.on) { window.QuestionRubric = { decorate: function () {}, rubricOf: function () { return null; } }; return; }

  var MAX = 10;
  var TEMPLATES = [
    { label: 'Essay', criteria: [['Content', 5], ['Organisation', 3], ['Language', 2]] },
    { label: 'Short written answer', criteria: [['Accuracy', 3], ['Explanation', 2]] },
  ];

  function esc(v) {
    return String(v == null ? '' : v).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; });
  }
  function rowHtml(name, marks) {
    return '<div class="qr-row">' +
      '<input type="text" class="qr-name" maxlength="80" placeholder="Criterion, e.g. Content" value="' + esc(name) + '" aria-label="Criterion">' +
      '<input type="number" class="qr-marks" min="0.5" max="100" step="0.5" placeholder="Marks" value="' + (marks == null || marks === '' ? '' : esc(marks)) + '" aria-label="Marks for this criterion">' +
      '<button type="button" class="qr-remove" aria-label="Remove criterion" title="Remove">&times;</button>' +
    '</div>';
  }

  function decorate(card, question, again) {
    if (!card || card.querySelector('.qm-rubric-field')) return;
    if (!again && !card.querySelector('.qh')) { setTimeout(function () { decorate(card, question, true); }, 0); return; }
    var body = card.querySelector('.qm-question-card-body');
    if (!body) return;
    var given = question && question.rubric && Array.isArray(question.rubric.criteria) ? question.rubric.criteria : [];
    var box = document.createElement('div');
    box.className = 'qm-field qm-rubric-field';
    box.innerHTML =
      '<div class="qr-head">' +
        '<label class="qr-title">Rubric</label>' +
        '<span class="qr-tools">' +
          '<select class="qr-template" aria-label="Start from a template"><option value="">Template</option>' +
            TEMPLATES.map(function (t, i) { return '<option value="' + i + '">' + esc(t.label) + '</option>'; }).join('') + '</select>' +
          '<button type="button" class="qr-add">+ Criterion</button>' +
        '</span>' +
      '</div>' +
      '<div class="qr-rows"></div>' +
      '<div class="qr-foot" hidden><span class="qr-total"></span><button type="button" class="qr-clear">Remove rubric</button></div>';
    // Placed after the question's hint, and opened from a "Rubric" button beside the Hint button.
    var hintBox = card.querySelector('.qh');
    if (hintBox && hintBox.parentNode) hintBox.parentNode.insertBefore(box, hintBox.nextSibling);
    else body.appendChild(box);
    var toggle = document.createElement('button');
    toggle.type = 'button';
    toggle.className = 'qr-toggle';
    toggle.setAttribute('aria-expanded', 'false');
    toggle.innerHTML = '<svg width="14" height="14" viewBox="0 0 20 20" fill="none" aria-hidden="true"><path d="M4 5h12M4 10h12M4 15h7" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg><span class="qr-toggle__text">Rubric</span>';
    var hintToggle = hintBox ? hintBox.querySelector('.qh-toggle') : null;
    if (hintToggle) hintToggle.parentNode.insertBefore(toggle, hintToggle.nextSibling);
    else box.parentNode.insertBefore(toggle, box);
    if (hintBox) hintBox.classList.add('qh--row');
    var open = given.length > 0;

    var rows = box.querySelector('.qr-rows');
    var foot = box.querySelector('.qr-foot');
    var typeSelect = card.querySelector('.question-type');
    var marksInput = card.querySelector('.question-marks');
    given.slice(0, MAX).forEach(function (c) { rows.insertAdjacentHTML('beforeend', rowHtml(c.name, c.marks)); });

    function total() {
      return Array.prototype.reduce.call(rows.querySelectorAll('.qr-row'), function (sum, row) {
        var name = row.querySelector('.qr-name').value.trim();
        var n = Number(row.querySelector('.qr-marks').value);
        return name && n > 0 ? sum + n : sum;
      }, 0);
    }
    function sync(fromUser) {
      var count = rows.querySelectorAll('.qr-row').length;
      var isEssay = !typeSelect || typeSelect.value === 'essay';
      toggle.hidden = !isEssay;
      box.hidden = !isEssay || !open;
      toggle.setAttribute('aria-expanded', String(open && isEssay));
      toggle.classList.toggle('has-rubric', count > 0);
      toggle.querySelector('.qr-toggle__text').textContent = count ? 'Rubric · ' + count : 'Rubric';
      foot.hidden = !count;
      box.querySelector('.qr-add').hidden = count >= MAX;
      box.querySelector('.qr-template').hidden = count > 0;
      var sum = Math.round(total() * 100) / 100;
      box.querySelector('.qr-total').textContent = count ? 'Total ' + sum + ' marks' : '';
      if (marksInput) {
        var on = isEssay && count > 0 && sum > 0;
        marksInput.readOnly = on;
        marksInput.title = on ? 'Set by the rubric' : '';
        if (on && Number(marksInput.value) !== sum) { marksInput.value = String(sum); marksInput.dispatchEvent(new Event('input', { bubbles: true })); }
      }
      if (fromUser) card.dispatchEvent(new Event('input', { bubbles: true }));
    }

    toggle.addEventListener('click', function () {
      open = !open;
      sync(false);
      if (open) { var first = box.querySelector('.qr-name, .qr-template'); if (first) first.focus(); }
    });
    box.addEventListener('input', function () { sync(true); });
    box.addEventListener('change', function (e) {
      if (!e.target.classList.contains('qr-template')) return;
      var t = TEMPLATES[Number(e.target.value)];
      e.target.value = '';
      if (!t) return;
      rows.innerHTML = t.criteria.map(function (c) { return rowHtml(c[0], c[1]); }).join('');
      sync(true);
    });
    box.addEventListener('click', function (e) {
      if (e.target.closest('.qr-add')) {
        if (rows.querySelectorAll('.qr-row').length >= MAX) return;
        rows.insertAdjacentHTML('beforeend', rowHtml('', ''));
        rows.lastElementChild.querySelector('.qr-name').focus();
        sync(true);
        return;
      }
      var remove = e.target.closest('.qr-remove');
      if (remove) { remove.closest('.qr-row').remove(); sync(true); return; }
      if (e.target.closest('.qr-clear')) { rows.innerHTML = ''; open = false; sync(true); }
    });
    if (typeSelect) typeSelect.addEventListener('change', function () { sync(false); });
    sync(false);
  }

  // What to save with the question: null unless it is an essay with at least one criterion.
  function rubricOf(card) {
    var box = card && card.querySelector('.qm-rubric-field');
    if (!box || card.querySelector('.question-type') && card.querySelector('.question-type').value !== 'essay') return null;
    var criteria = [];
    Array.prototype.forEach.call(box.querySelectorAll('.qr-row'), function (row) {
      var name = row.querySelector('.qr-name').value.replace(/\s+/g, ' ').trim();
      var marks = Number(row.querySelector('.qr-marks').value);
      if (name && marks > 0) criteria.push({ name: name, marks: Math.round(marks * 100) / 100 });
    });
    return criteria.length ? { criteria: criteria } : null;
  }

  window.QuestionRubric = { decorate: decorate, rubricOf: rubricOf };
})();
