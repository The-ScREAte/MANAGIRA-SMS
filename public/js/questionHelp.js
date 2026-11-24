// "Help for this question" on each question card: a recommendation,
// a link and up to three files. Saved with the question (utils/questionHelp.js) and shown to the
// student under it. The question form calls QuestionHelp.decorate(card, question) for each card
// and QuestionHelp.helpOf(card) when it saves.
(function () {
  'use strict';
  if (window.QuestionHelp) return;
  var MAX_FILES = 3;
  var ICON = '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M9.5 9a2.5 2.5 0 1 1 3.5 2.3c-.6.3-1 .9-1 1.6V14M12 17h.01"/></svg>';

  function esc(value) {
    return String(value === null || value === undefined ? '' : value).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  // An uploaded file opens through Managira (/files/...), which checks the person is signed in to
  // the school; the storage address is never used as a link.
  function fileHref(f) {
    var key = f && f.key ? String(f.key) : '';
    if (!/^(custom-forms|question-help|parent-resources)\/\d+\//.test(key)) return '#';
    return '/files/' + key.split('/').map(encodeURIComponent).join('/');
  }
  function summary(h) {
    var parts = [];
    if (h.text) parts.push('a recommendation');
    if (h.link && h.link.url) parts.push('a link');
    if (h.files.length) parts.push(h.files.length === 1 ? '1 file' : h.files.length + ' files');
    return parts.length ? 'Help: ' + parts.join(', ') : '';
  }

  function decorate(card, question) {
    if (!card || card.querySelector('.qh')) return;
    var given = question && question.help && typeof question.help === 'object' ? question.help : {};
    var h = card.__qh = {
      text: given.text || '',
      link: { url: (given.link && given.link.url) || '', label: (given.link && given.link.label) || '' },
      files: Array.isArray(given.files) ? given.files.filter(function (f) { return f && f.key; }).map(function (f) { return { name: f.name, key: f.key, url: f.url }; }) : []
    };
    var box = document.createElement('div');
    box.className = 'qm-field qh';
    box.innerHTML = '<button type="button" class="qh-toggle" aria-expanded="false">' + ICON + '<span class="qh-toggle__text">Add a hint</span></button>'
      + '<div class="qh-body" hidden>'
      + '<label class="qh-label">Hint<textarea class="qh-text" rows="2" maxlength="2000" placeholder="A hint, or where to look"></textarea></label>'
      + '<ul class="qh-files"></ul>'
      + '</div>';
    var anchor = card.querySelector('.qbf-media') || (card.querySelector('.question-text-editor') ? card.querySelector('.question-text-editor').closest('.qm-field') : null);
    var body = card.querySelector('.qm-question-card-body');
    if (anchor && anchor.parentNode) anchor.parentNode.insertBefore(box, anchor.nextSibling);
    else if (body) body.appendChild(box);
    else card.appendChild(box);

    var text = box.querySelector('.qh-text');
    text.value = h.text;
    // Files and a link added earlier stay for students until removed here; new ones go in the test's Resources.
    function renderFiles() {
      var rows = h.files.map(function (f, i) {
        return '<li><a href="' + esc(fileHref(f)) + '" target="_blank" rel="noopener">' + esc(f.name) + '</a><button type="button" data-qh-remove="' + i + '">Remove</button></li>';
      });
      if (h.link && h.link.url) rows.push('<li><a href="' + esc(h.link.url) + '" target="_blank" rel="noopener">' + esc(h.link.label || h.link.url) + '</a><button type="button" data-qh-remove="link">Remove</button></li>');
      box.querySelector('.qh-files').innerHTML = rows.join('');
      var label = summary(h);
      box.querySelector('.qh-toggle__text').textContent = label ? 'Hint added' : 'Hint';
      box.classList.toggle('has-help', Boolean(label));
    }
    renderFiles();
    box.querySelector('.qh-toggle').addEventListener('click', function () {
      var bodyEl = box.querySelector('.qh-body');
      bodyEl.hidden = !bodyEl.hidden;
      this.setAttribute('aria-expanded', String(!bodyEl.hidden));
      if (!bodyEl.hidden) text.focus();
    });
    box.addEventListener('input', function () {
      h.text = text.value;
      renderFiles();
    });
    box.addEventListener('click', function (e) {
      var rm = e.target.closest('[data-qh-remove]');
      if (!rm) return;
      var which = rm.getAttribute('data-qh-remove');
      if (which === 'link') h.link = { url: '', label: '' };
      else h.files.splice(Number(which), 1);
      renderFiles();
    });
  }

  // What to save with the question, or null when there's no help.
  function helpOf(card) {
    var h = card && card.__qh;
    if (!h) return null;
    var link = /^https?:\/\/\S+$/i.test(h.link.url || '') ? { url: h.link.url, label: h.link.label || '' } : null;
    var textValue = String(h.text || '').trim();
    if (!textValue && !link && !h.files.length) return null;
    return { text: textValue, link: link, files: h.files.slice(0, MAX_FILES) };
  }

  window.QuestionHelp = { decorate: decorate, helpOf: helpOf };
  // Cards drawn before this file loaded (a restored draft).
  Array.prototype.forEach.call(document.querySelectorAll('#question-items .qm-question-card'), function (card) { decorate(card, {}); });
})();

