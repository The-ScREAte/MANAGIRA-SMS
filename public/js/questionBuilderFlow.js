// The questions builder in the assessments flow:
// - a new set starts with a choice: write questions, reuse earlier ones, or upload printed ones;
// - + beside Assessment adds the assessment that isn't there yet, then carries on;
// - any question can show a picture, and "Label a picture" puts numbered spots on it, each with
//   its answer (students type an answer per spot);
// - what parents and the student see after grading, and what open / closed book means;
// - opened in a panel (gradebook, Assessments), it tells that page when it's saved or closed.
(function () {
  'use strict';
  var hooks = window.QuestionBuilderHooks;
  var cfg = window.QuestionBuilderFlowConfig || {};
  if (!hooks) return;
  var flow = window.AssessmentFlow;
  var inPanel = Boolean(cfg.open) && window.parent !== window;
  var MAX_SPOTS = 20;

  function esc(value) {
    return String(value === null || value === undefined ? '' : value).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function tell(type, extra) {
    if (!inPanel) return;
    var message = { type: type };
    Object.keys(extra || {}).forEach(function (key) { message[key] = extra[key]; });
    window.parent.postMessage(message, window.location.origin);
  }

  // ---------------------------------------------------------------- sharing and exam mode
  var shareSelect = null;
  var modeHint = null;
  function addSettings() {
    var mode = document.getElementById('question-open-book');
    if (!mode || document.getElementById('qbf-parent-share') || document.querySelector('.qbf-hint[data-qbf-mode]')) return;
    var modeField = mode.closest('.qm-field');
    modeHint = document.createElement('p');
    modeHint.className = 'qbf-hint';
    modeHint.setAttribute('data-qbf-mode', '');
    modeField.appendChild(modeHint);
    function syncMode() {
      modeHint.textContent = mode.value === 'true'
        ? 'Students can use notes and your resources.'
        : 'One secure page: leaving it locks the test. Resources stay hidden.';
    }
    mode.addEventListener('change', syncMode);
    syncMode();
    if (cfg.extras === false) return; // sharing needs the flow's columns

    var field = document.createElement('div');
    field.className = 'qm-field qbf-share-field';
    field.innerHTML =
      '<label for="qbf-parent-share">Share with family</label>' +
      '<select id="qbf-parent-share" title="Shared once you post the grade (✓ on the gradebook)">' +
      '  <option value="">Nothing</option>' +
      '  <option value="grade">Grade</option>' +
      '  <option value="full">Grade and answers</option>' +
      '</select>';
    modeField.parentNode.insertBefore(field, modeField.nextSibling);
    shareSelect = field.querySelector('select');
    shareSelect.value = 'grade';
  }

  // ---------------------------------------------------------------- + Assessment
  function addCreateButton() {
    var select = hooks.assessmentSelect;
    if (!select || !cfg.canCreateAssessments || !flow || document.getElementById('qbf-new-assessment')) return;
    var wrap = document.createElement('div');
    wrap.className = 'qbf-select-row';
    select.parentNode.insertBefore(wrap, select);
    wrap.appendChild(select);
    var btn = document.createElement('button');
    btn.type = 'button';
    btn.id = 'qbf-new-assessment';
    btn.className = 'qbf-plus';
    btn.title = 'Add an assessment that isn’t here yet';
    btn.setAttribute('aria-label', 'Add an assessment');
    btn.innerHTML = '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" aria-hidden="true"><path d="M12 5v14M5 12h14"/></svg>';
    wrap.appendChild(btn);
    btn.addEventListener('click', function () {
      var classId = Number(hooks.classSelect && hooks.classSelect.value);
      var subjectId = Number(hooks.subjectSelect && hooks.subjectSelect.value);
      var termId = Number(hooks.termSelect && hooks.termSelect.value) || cfg.termId;
      if (!classId) { hooks.setQuestionStatus('Choose the class first, then add its assessment.', true); return; }
      flow.createAssessment({
        organizationId: cfg.organizationId,
        termId: termId,
        classId: classId,
        subjectId: subjectId || null,
        onCreated: async function (created) {
          if (!created.length) { flow.toast('Nothing new was added: an assessment with that name may already be here.', true); return; }
          var mine = created.filter(function (row) { return Number(row.classId) === classId && (!subjectId || Number(row.subjectId) === subjectId); })[0] || created[0];
          if (hooks.subjectSelect && mine.subjectId && Number(hooks.subjectSelect.value) !== Number(mine.subjectId)) {
            hooks.subjectSelect.value = String(mine.subjectId);
          }
          await hooks.renderQuestionModalAssessments();
          if (hooks.assessmentSelect) {
            hooks.assessmentSelect.value = String(mine.assessmentId);
            hooks.assessmentSelect.dispatchEvent(new Event('change', { bubbles: true }));
          }
          hooks.refreshRules();
          flow.toast('“' + (mine.title || 'The assessment') + '” added. Now add its questions.');
        },
      });
    });
  }

  // ---------------------------------------------------------------- how to start a new set
  var start = null;
  function questionCards() { return Array.prototype.slice.call(document.querySelectorAll('#question-items .qm-question-card')); }
  function pristine() {
    var cards = questionCards();
    if (cards.length > 1) return false;
    if (!cards.length) return true;
    var text = cards[0].querySelector('.question-text');
    return !(text && String(text.value || '').trim()) && !cards[0].__qbfMedia;
  }
  var START_CARDS = [
    { key: 'write', title: 'Write', text: 'Start blank', icon: '<path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z"/>' },
    { key: 'reuse', title: 'Reuse', text: 'Copy an earlier set', icon: '<rect x="8" y="8" width="13" height="13" rx="2"/><path d="M16 8V5a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h3"/>' },
    { key: 'upload', title: 'Upload', text: 'PDF, Word or photo', icon: '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><path d="m17 8-5-5-5 5"/><path d="M12 3v12"/>' },
  ];
  function ensureStart() {
    if (start && document.body.contains(start)) return start;
    var items = document.getElementById('question-items');
    var questionsSection = items ? items.closest('.qm-section') : null;
    if (!questionsSection) return null;
    questionsSection.classList.add('qbf-questions-section');
    start = document.createElement('section');
    start.className = 'qbf-start';
    start.setAttribute('aria-label', 'How to start');
    start.innerHTML =
      '<div class="qbf-start__head"><h3>Start with</h3></div>' +
      '<div class="qbf-start__cards">' + START_CARDS.map(function (card) {
        return '<button type="button" class="qbf-start__card" data-qbf-start="' + card.key + '">' +
          '<span class="qbf-start__icon"><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + card.icon + '</svg></span>' +
          '<strong>' + card.title + '</strong><span>' + card.text + '</span></button>';
      }).join('') + '</div>' +
      '<div class="qbf-library" hidden>' +
      '  <div class="qbf-library__bar"><button type="button" class="qbf-link" data-qbf-back>← Back</button>' +
      '  <input type="search" class="qbf-library__search" placeholder="Search by title, subject, class or test" aria-label="Search earlier questions" /></div>' +
      '  <div class="qbf-library__list" role="list"></div>' +
      '</div>';
    questionsSection.parentNode.insertBefore(start, questionsSection);
    start.addEventListener('click', onStartClick);
    var search = start.querySelector('.qbf-library__search');
    var timer = null;
    search.addEventListener('input', function () {
      clearTimeout(timer);
      timer = setTimeout(function () { loadLibrary(search.value); }, 250);
    });
    return start;
  }
  function showStart(show) {
    var el = ensureStart();
    if (!el) return;
    el.hidden = !show;
    var modal = document.querySelector('#question-modal-overlay .question-modal');
    if (modal) modal.classList.toggle('qbf-choosing', Boolean(show));
    if (show) {
      el.querySelector('.qbf-start__cards').hidden = false;
      el.querySelector('.qbf-library').hidden = true;
    }
  }
  function onStartClick(event) {
    var back = event.target.closest('[data-qbf-back]');
    if (back) { showStart(true); return; }
    var pick = event.target.closest('[data-qbf-set]');
    if (pick) { copySet(Number(pick.getAttribute('data-qbf-set')), pick.getAttribute('data-title')); return; }
    var card = event.target.closest('[data-qbf-start]');
    if (!card) return;
    var key = card.getAttribute('data-qbf-start');
    if (key === 'write') {
      showStart(false);
      var editor = document.querySelector('#question-items .question-text-editor');
      if (editor) editor.focus();
    } else if (key === 'reuse') {
      start.querySelector('.qbf-start__cards').hidden = true;
      start.querySelector('.qbf-library').hidden = false;
      start.querySelector('.qbf-library__search').focus();
      loadLibrary('');
    } else if (key === 'upload') {
      var input = document.getElementById('qm-pdf-file-input');
      if (!input) return;
      input.addEventListener('change', function once() {
        input.removeEventListener('change', once);
        if (input.files && input.files.length) showStart(false);
      });
      input.click();
    }
  }
  function loadLibrary(query) {
    var list = start.querySelector('.qbf-library__list');
    list.innerHTML = '<p class="qbf-muted">Loading…</p>';
    fetch('/common/assessment/questions/library?q=' + encodeURIComponent(query || ''), { credentials: 'same-origin', headers: { Accept: 'application/json' } })
      .then(function (res) { return res.json(); })
      .then(function (data) {
        var sets = (data && data.sets) || [];
        if (!sets.length) {
          list.innerHTML = '<p class="qbf-muted">' + (query ? 'Nothing matches “' + esc(query) + '”.' : 'No earlier questions yet. Write them, or upload a printed test.') + '</p>';
          return;
        }
        list.innerHTML = sets.map(function (set) {
          return '<button type="button" class="qbf-library__item" role="listitem" data-qbf-set="' + set.questionSetId + '" data-title="' + esc(set.title) + '">' +
            '<strong>' + esc(set.title) + '</strong>' +
            '<span>' + esc([set.className, set.subjectName, set.termName].filter(Boolean).join(' · ')) + '</span>' +
            '<em>' + set.questionCount + ' question' + (set.questionCount === 1 ? '' : 's') + '</em></button>';
        }).join('');
      })
      .catch(function () { list.innerHTML = '<p class="qbf-muted">Earlier questions couldn’t be loaded. Try again.</p>'; });
  }
  function copySet(setId, title) {
    var list = start.querySelector('.qbf-library__list');
    list.setAttribute('aria-busy', 'true');
    fetch('/common/assessment/questions/library/' + setId, { credentials: 'same-origin', headers: { Accept: 'application/json' } })
      .then(function (res) { return res.json(); })
      .then(function (data) {
        var questions = (data && data.questions) || [];
        if (!questions.length) throw new Error('empty');
        var items = hooks.questionItems;
        items.innerHTML = '';
        questions.forEach(function (question) { items.appendChild(hooks.buildQuestionItem(question)); });
        hooks.renumberQuestionCards();
        hooks.updateQuestionCount();
        hooks.saveDraft();
        showStart(false);
        hooks.setQuestionStatus('Copied ' + questions.length + ' question' + (questions.length === 1 ? '' : 's') + ' from “' + (title || 'an earlier set') + '”. Change anything, add more, then save.', false);
      })
      .catch(function () { flow && flow.toast('Those questions couldn’t be copied. Try again.', true); })
      .finally(function () { list.removeAttribute('aria-busy'); });
  }

  // ---------------------------------------------------------------- pictures
  var PICTURE_ICON = '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="9" cy="9" r="2"/><path d="m21 15-3.1-3.1a2 2 0 0 0-2.8 0L6 21"/></svg>';

  function isLabel(card) {
    var type = card.querySelector('.question-type');
    return Boolean(type && type.value === 'image_label');
  }
  function renderMedia(card) {
    var box = card.querySelector('.qbf-media');
    var media = card.__qbfMedia;
    var labelMode = isLabel(card);
    card.classList.toggle('is-image-label', labelMode);
    var empty = box.querySelector('.qbf-media__empty');
    var stage = box.querySelector('.qbf-media__stage');
    var hint = box.querySelector('.qbf-media__hint');
    hint.textContent = labelMode
      ? 'Add a picture, then click it to number each part.'
      : 'Optional picture.';
    if (!media || !media.image) {
      empty.hidden = false;
      stage.hidden = true;
      return;
    }
    empty.hidden = true;
    stage.hidden = false;
    var img = stage.querySelector('img');
    if (img.getAttribute('src') !== media.image.url) img.setAttribute('src', media.image.url || '');
    img.alt = media.image.alt || '';
    var canvas = stage.querySelector('.qbf-media__canvas');
    canvas.classList.toggle('is-labeling', labelMode);
    canvas.querySelectorAll('.qbf-spot').forEach(function (el) { el.remove(); });
    var labels = labelMode ? (media.labels || []) : [];
    labels.forEach(function (label, index) {
      var spot = document.createElement('span');
      spot.className = 'qbf-spot';
      spot.textContent = String(index + 1);
      spot.style.left = (label.x * 100) + '%';
      spot.style.top = (label.y * 100) + '%';
      canvas.appendChild(spot);
    });
    var rows = stage.querySelector('.qbf-labels');
    rows.hidden = !labelMode;
    if (labelMode) {
      rows.innerHTML = labels.length
        ? labels.map(function (label, index) {
          return '<div class="qbf-label-row"><span class="qbf-spot qbf-spot--static">' + (index + 1) + '</span>' +
            '<input type="text" class="qbf-label-answer" data-i="' + index + '" maxlength="200" placeholder="Answer for spot ' + (index + 1) + '" value="' + esc(label.answer || '') + '" />' +
            '<button type="button" class="qbf-x" data-qbf-remove-spot="' + index + '" aria-label="Remove spot ' + (index + 1) + '">×</button></div>';
        }).join('') + '<p class="qbf-hint">Use “/” for other right answers.</p>'
        : '<p class="qbf-hint">Click the picture to add spot 1.</p>';
    }
  }
  function uploadPicture(card, file) {
    if (!file) return;
    var box = card.querySelector('.qbf-media');
    var status = box.querySelector('.qbf-media__status');
    if (!/^image\/(png|jpe?g|webp|gif)$/i.test(file.type)) { status.textContent = 'Use a PNG, JPG, WEBP or GIF picture.'; return; }
    if (file.size > 8 * 1024 * 1024) { status.textContent = 'Use a picture under 8 MB.'; return; }
    var form = new FormData();
    form.append('image', file);
    status.textContent = 'Uploading…';
    fetch('/common/assessment/questions/image', { method: 'POST', credentials: 'same-origin', headers: { Accept: 'application/json' }, body: form })
      .then(function (res) { return res.json().then(function (data) { return { ok: res.ok, data: data }; }); })
      .then(function (result) {
        if (!result.ok || !result.data.success) throw new Error(result.data.error || 'The picture couldn’t be uploaded.');
        var keep = card.__qbfMedia && card.__qbfMedia.labels ? card.__qbfMedia.labels : [];
        card.__qbfMedia = { image: { key: result.data.image.key, url: result.data.image.url, alt: file.name.replace(/\.[a-z0-9]+$/i, '').slice(0, 120) }, labels: keep };
        status.textContent = '';
        renderMedia(card);
        hooks.saveDraft();
      })
      .catch(function (error) { status.textContent = error.message || 'The picture couldn’t be uploaded. Try again.'; });
  }

  function decorate(card, question) {
    if (!card || card.querySelector('.qbf-media') || cfg.extras === false) return; // pictures need the flow's columns
    var typeSelect = card.querySelector('.question-type');
    if (typeSelect && !typeSelect.querySelector('option[value="image_label"]')) {
      var option = document.createElement('option');
      option.value = 'image_label';
      option.textContent = 'Label a picture';
      typeSelect.appendChild(option);
    }
    if (typeSelect && question && question.questionType === 'image_label') typeSelect.value = 'image_label';
    var media = question && question.media && question.media.image ? question.media : null;
    card.__qbfMedia = media ? {
      image: { key: media.image.key, url: media.image.url, alt: media.image.alt || '' },
      labels: (media.labels || []).map(function (label) { return { x: Number(label.x), y: Number(label.y), answer: label.answer || '' }; }),
    } : null;

    var box = document.createElement('div');
    box.className = 'qm-field qbf-media';
    box.innerHTML =
      '<div class="qbf-media__empty">' +
      '  <button type="button" class="qbf-pic-btn" data-qbf-pick>' + PICTURE_ICON + '<span>Add a picture</span></button>' +
      '  <span class="qbf-media__hint"></span>' +
      '</div>' +
      '<div class="qbf-media__stage" hidden>' +
      '  <div class="qbf-media__canvas"><img alt="" draggable="false" /></div>' +
      '  <div class="qbf-media__side">' +
      '    <div class="qbf-labels" hidden></div>' +
      '    <div class="qbf-media__actions"><button type="button" class="qbf-link" data-qbf-pick>Replace picture</button><button type="button" class="qbf-link qbf-link--danger" data-qbf-clear>Remove picture</button></div>' +
      '  </div>' +
      '</div>' +
      '<p class="qbf-media__status" role="status"></p>' +
      '<input type="file" accept="image/png,image/jpeg,image/webp,image/gif" hidden />';
    var textField = card.querySelector('.question-text-editor') ? card.querySelector('.question-text-editor').closest('.qm-field') : null;
    var body = card.querySelector('.qm-question-card-body');
    if (textField && textField.parentNode) textField.parentNode.insertBefore(box, textField.nextSibling);
    else if (body) body.appendChild(box);
    else card.appendChild(box);

    var input = box.querySelector('input[type="file"]');
    box.addEventListener('click', function (event) {
      if (event.target.closest('[data-qbf-pick]')) { input.click(); return; }
      if (event.target.closest('[data-qbf-clear]')) {
        if (card.__qbfMedia && card.__qbfMedia.labels && card.__qbfMedia.labels.length && !window.confirm('Remove the picture and its spots?')) return;
        card.__qbfMedia = null;
        renderMedia(card);
        hooks.saveDraft();
        return;
      }
      var remove = event.target.closest('[data-qbf-remove-spot]');
      if (remove && card.__qbfMedia) {
        card.__qbfMedia.labels.splice(Number(remove.getAttribute('data-qbf-remove-spot')), 1);
        renderMedia(card);
        hooks.saveDraft();
        return;
      }
      var canvas = event.target.closest('.qbf-media__canvas');
      if (canvas && isLabel(card) && card.__qbfMedia && event.target.tagName === 'IMG') {
        var labels = card.__qbfMedia.labels || (card.__qbfMedia.labels = []);
        if (labels.length >= MAX_SPOTS) { box.querySelector('.qbf-media__status').textContent = 'Use at most ' + MAX_SPOTS + ' spots.'; return; }
        var rect = event.target.getBoundingClientRect();
        labels.push({
          x: Math.round(Math.min(Math.max((event.clientX - rect.left) / rect.width, 0), 1) * 10000) / 10000,
          y: Math.round(Math.min(Math.max((event.clientY - rect.top) / rect.height, 0), 1) * 10000) / 10000,
          answer: '',
        });
        renderMedia(card);
        var inputs = box.querySelectorAll('.qbf-label-answer');
        if (inputs.length) inputs[inputs.length - 1].focus();
        hooks.saveDraft();
      }
    });
    box.addEventListener('input', function (event) {
      var answer = event.target.closest('.qbf-label-answer');
      if (!answer || !card.__qbfMedia) return;
      var label = card.__qbfMedia.labels[Number(answer.getAttribute('data-i'))];
      if (label) label.answer = answer.value;
    });
    input.addEventListener('change', function () {
      uploadPicture(card, input.files && input.files[0]);
      input.value = '';
    });
    if (typeSelect) typeSelect.addEventListener('change', function () { renderMedia(card); });
    // A pasted or dropped picture works too.
    box.addEventListener('dragover', function (event) { event.preventDefault(); box.classList.add('is-drop'); });
    box.addEventListener('dragleave', function () { box.classList.remove('is-drop'); });
    box.addEventListener('drop', function (event) {
      event.preventDefault();
      box.classList.remove('is-drop');
      var file = event.dataTransfer && event.dataTransfer.files && event.dataTransfer.files[0];
      if (file) uploadPicture(card, file);
    });
    renderMedia(card);
    if (start && !start.hidden && media) showStart(false);
  }

  function mediaOf(card) {
    var media = card && card.__qbfMedia;
    if (!media || !media.image || !media.image.key) return null;
    var out = { image: { key: media.image.key, url: media.image.url, alt: media.image.alt || '' } };
    if (isLabel(card)) out.labels = (media.labels || []).map(function (label) { return { x: label.x, y: label.y, answer: String(label.answer || '').trim() }; });
    return out;
  }

  function previewMedia(media) {
    if (!media || !media.image || !media.image.url) return '';
    var spots = (media.labels || []).map(function (label, index) {
      return '<span class="qbf-spot" style="left:' + (Number(label.x) * 100) + '%;top:' + (Number(label.y) * 100) + '%">' + (index + 1) + '</span>';
    }).join('');
    return '<div class="qbf-preview-pic"><div class="qbf-media__canvas"><img src="' + esc(media.image.url) + '" alt="' + esc(media.image.alt || '') + '" />' + spots + '</div></div>';
  }

  // ---------------------------------------------------------------- the builder's life cycle
  function loadSet(set) {
    addSettings();
    if (shareSelect) shareSelect.value = set ? (set.parentShare || '') : 'grade';
  }
  function parentShare() {
    return shareSelect ? shareSelect.value : undefined;
  }
  function afterSave(result) {
    if (!inPanel) return false;
    tell('managira:questions-saved', { questionSetId: result && result.questionSetId, message: 'Questions saved and sent for review.' });
    return true;
  }
  function closed() {
    showStart(false);
    tell('managira:questions-closed');
  }

  // Each time the builder opens for a new set, offer the three ways to start.
  var overlay = document.getElementById('question-modal-overlay');
  if (overlay && 'MutationObserver' in window) {
    var wasOpen = overlay.classList.contains('show');
    new MutationObserver(function () {
      var open = overlay.classList.contains('show');
      if (open && !wasOpen) {
        addSettings();
        addCreateButton();
        setTimeout(function () { showStart(hooks.mode() !== 'edit' && pristine()); }, 0);
      }
      if (!open) showStart(false);
      wasOpen = open;
    }).observe(overlay, { attributes: true, attributeFilter: ['class'] });
  }

  window.QuestionBuilderFlow = {
    decorate: decorate,
    mediaOf: mediaOf,
    previewMedia: previewMedia,
    loadSet: loadSet,
    parentShare: parentShare,
    afterSave: afterSave,
    closed: closed,
  };

  addSettings();
  addCreateButton();
  // Cards built before this file loaded (a restored draft) get their picture tools now.
  questionCards().forEach(function (card) { decorate(card, {}); });

  // Opened for one assessment (gradebook, + Assessment, the Assessments page).
  if (cfg.open) {
    document.documentElement.classList.add('qbf-in-panel');
    var target = cfg.open;
    if (target.mode === 'edit' && target.questionSetId) {
      hooks.openEditQuestionSet({
        questionSetId: target.questionSetId,
        assessmentId: target.assessmentId,
        classId: target.classId,
        subjectId: target.subjectId,
        termId: target.termId,
        schoolYearId: target.schoolYearId,
      });
    } else {
      hooks.openNew(target).then(function () {
        showStart(pristine());
      });
    }
  }
})();
