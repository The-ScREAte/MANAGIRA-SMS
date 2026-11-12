// The assessments flow, shared by the gradebook, the Assessments page and the questions page:
// a panel from the right to add an assessment, then "Add questions now?", then the questions
// builder for it. Pages opened inside the panel say what happened with postMessage
// (managira:assessments-created, managira:questions-saved, managira:questions-closed).
(function () {
  'use strict';
  if (window.AssessmentFlow) return;

  var listeners = [];
  window.addEventListener('message', function (event) {
    if (event.origin !== window.location.origin) return;
    var data = event.data || {};
    if (typeof data.type !== 'string' || data.type.indexOf('managira:') !== 0) return;
    listeners.slice().forEach(function (entry) { if (entry.type === data.type) entry.fn(data, event); });
  });
  function on(type, fn) {
    var entry = { type: type, fn: fn };
    listeners.push(entry);
    return function () { listeners = listeners.filter(function (e) { return e !== entry; }); };
  }

  function esc(value) {
    return String(value === null || value === undefined ? '' : value).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  var CLOSE_ICON = '<svg width="18" height="18" viewBox="0 0 20 20" fill="none" aria-hidden="true"><path d="M15 5L5 15M5 5l10 10" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>';

  // Panels and questions open under the app header (where the page has one), never over it.
  function underHeader(el) {
    var header = document.getElementById('top-header');
    if (header) el.style.top = header.offsetHeight + 'px';
  }

  // A panel from the right holding a page (src) or content (html).
  function drawer(options) {
    var opts = options || {};
    var root = document.createElement('div');
    root.className = 'af-drawer' + (opts.wide ? ' af-drawer--wide' : '');
    root.innerHTML =
      '<div class="af-drawer__scrim" data-af-close></div>' +
      '<aside class="af-drawer__panel" role="dialog" aria-modal="true" aria-label="' + esc(opts.title || '') + '">' +
      '  <header class="af-drawer__head">' +
      '    <div><h2 class="af-drawer__title">' + esc(opts.title || '') + '</h2>' +
      (opts.subtitle ? '<p class="af-drawer__sub">' + esc(opts.subtitle) + '</p>' : '') + '</div>' +
      '    <button type="button" class="af-icon-btn" data-af-close aria-label="Close">' + CLOSE_ICON + '</button>' +
      '  </header>' +
      '  <div class="af-drawer__body"><div class="af-drawer__loading"><span class="af-spinner"></span>Loading…</div></div>' +
      '</aside>';
    underHeader(root);
    document.body.appendChild(root);
    var body = root.querySelector('.af-drawer__body');
    var closed = false;
    var api = {
      el: root,
      iframe: null,
      close: function (reason) {
        if (closed) return;
        closed = true;
        root.classList.remove('is-open');
        document.removeEventListener('keydown', onKey);
        setTimeout(function () { root.remove(); }, 220);
        if (typeof opts.onClose === 'function') opts.onClose(reason || 'closed');
      },
      setContent: function (html) {
        body.innerHTML = html;
        api.iframe = null;
      },
      setTitle: function (title, subtitle) {
        root.querySelector('.af-drawer__title').textContent = title || '';
        var sub = root.querySelector('.af-drawer__sub');
        if (sub) sub.textContent = subtitle || '';
      },
    };
    function onKey(event) { if (event.key === 'Escape' && !opts.keepOnEscape) api.close('escape'); }
    root.addEventListener('click', function (event) {
      if (event.target.closest('[data-af-close]')) api.close('closed');
    });
    document.addEventListener('keydown', onKey);
    if (opts.src) {
      var frame = document.createElement('iframe');
      frame.className = 'af-drawer__frame';
      frame.title = opts.title || 'Panel';
      frame.addEventListener('load', function () {
        var loading = body.querySelector('.af-drawer__loading');
        if (loading) loading.remove();
        frame.classList.add('is-ready');
      });
      frame.src = opts.src;
      body.appendChild(frame);
      api.iframe = frame;
    } else if (opts.html) {
      body.innerHTML = opts.html;
    }
    requestAnimationFrame(function () { root.classList.add('is-open'); });
    return api;
  }

  // A small dialog: title, text, buttons. Resolves with the chosen button's value.
  function dialog(options) {
    var opts = options || {};
    return new Promise(function (resolve) {
      var root = document.createElement('div');
      root.className = 'af-dialog';
      var buttons = (opts.buttons || [{ label: 'OK', value: true, primary: true }]).map(function (b, i) {
        return '<button type="button" class="af-btn ' + (b.primary ? 'af-btn--primary' : 'af-btn--ghost') + '" data-af-i="' + i + '">' + esc(b.label) + '</button>';
      }).join('');
      root.innerHTML =
        '<div class="af-dialog__scrim"></div>' +
        '<div class="af-dialog__card" role="alertdialog" aria-modal="true" aria-labelledby="afDialogTitle">' +
        (opts.icon ? '<div class="af-dialog__icon af-dialog__icon--' + esc(opts.tone || 'info') + '">' + opts.icon + '</div>' : '') +
        '  <h3 class="af-dialog__title" id="afDialogTitle">' + esc(opts.title || '') + '</h3>' +
        (opts.text ? '<p class="af-dialog__text">' + esc(opts.text) + '</p>' : '') +
        (opts.html || '') +
        '  <div class="af-dialog__actions">' + buttons + '</div>' +
        '</div>';
      underHeader(root);
      document.body.appendChild(root);
      requestAnimationFrame(function () { root.classList.add('is-open'); });
      function done(value) {
        root.classList.remove('is-open');
        document.removeEventListener('keydown', onKey);
        setTimeout(function () { root.remove(); }, 180);
        resolve(value);
      }
      function onKey(event) { if (event.key === 'Escape') done(opts.escapeValue === undefined ? false : opts.escapeValue); }
      document.addEventListener('keydown', onKey);
      root.addEventListener('click', function (event) {
        var btn = event.target.closest('[data-af-i]');
        if (!btn) return;
        var chosen = (opts.buttons || [{ value: true }])[Number(btn.getAttribute('data-af-i'))];
        done(typeof opts.read === 'function' ? { value: chosen.value, form: opts.read(root) } : chosen.value);
      });
      var primary = root.querySelector('.af-btn--primary');
      if (primary) primary.focus();
    });
  }

  function confirmBox(options) {
    var opts = options || {};
    return dialog({
      title: opts.title, text: opts.text, html: opts.html, tone: opts.tone, icon: opts.icon,
      buttons: [{ label: opts.cancelLabel || 'Cancel', value: false }, { label: opts.okLabel || 'OK', value: true, primary: true }],
    });
  }

  var toastTimer = null;
  function toast(text, isError) {
    var el = document.querySelector('.af-toast');
    if (!el) {
      el = document.createElement('div');
      el.className = 'af-toast';
      el.setAttribute('role', 'status');
      document.body.appendChild(el);
    }
    el.textContent = text;
    el.classList.toggle('is-error', Boolean(isError));
    el.classList.add('is-open');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { el.classList.remove('is-open'); }, 4200);
  }

  var QUESTION_ICON = '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M9 11l3 3L22 4"/><path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11"/></svg>';

  // Add an assessment for this term (this class and subject ticked). Calls onCreated with what
  // was made.
  function createAssessment(options) {
    var opts = options || {};
    var params = new URLSearchParams({ termId: String(opts.termId || ''), embed: 'workspace', flow: '1' });
    if (opts.organizationId) params.set('organizationId', String(opts.organizationId));
    if (opts.classId) params.set('classId', String(opts.classId));
    if (opts.subjectId) params.set('subjectId', String(opts.subjectId));
    var off = null;
    var panel = drawer({
      title: 'New assessment',
      subtitle: 'Questions are optional.',
      src: '/common/createTest?' + params.toString(),
      onClose: function () { if (off) off(); },
    });
    off = on('managira:assessments-created', function (data) {
      var created = Array.isArray(data.created) ? data.created : [];
      off();
      off = null;
      panel.close('created');
      if (typeof opts.onCreated === 'function') opts.onCreated(created, data.message || '');
    });
    return panel;
  }

  // "Add questions now?" after an assessment is made. When several were made (one per class
  // or subject), the teacher picks which one gets the questions.
  function askAddQuestions(options) {
    var opts = options || {};
    var created = (opts.created || []).filter(function (row) { return row && row.assessmentId; });
    if (!created.length) return Promise.resolve(null);
    var first = created[0];
    var pick = created.length > 1
      ? '<label class="af-field"><span>Questions for</span><select class="af-select" data-af-pick>' + created.map(function (row, i) {
        return '<option value="' + i + '">' + esc([row.title, row.className, row.subjectName].filter(Boolean).join(' · ')) + '</option>';
      }).join('') + '</select></label>'
      : '';
    return dialog({
      icon: QUESTION_ICON,
      tone: 'success',
      title: '“' + (first.title || 'Your assessment') + '” is ready',
      text: 'Add questions so students can take it online?',
      html: pick,
      read: function (root) { var s = root.querySelector('[data-af-pick]'); return s ? Number(s.value) : 0; },
      escapeValue: { value: false },
      buttons: [{ label: 'Not now', value: false }, { label: 'Add questions', value: true, primary: true }],
    }).then(function (answer) {
      if (!answer || !answer.value) return null;
      return created[answer.form || 0] || first;
    });
  }

  // The questions builder for one assessment, in a wide panel. onDone(saved) when it closes.
  function openQuestions(options) {
    var opts = options || {};
    var params = new URLSearchParams({ embed: 'workspace', flow: '1', open: opts.questionSetId ? 'edit' : 'new' });
    ['classId', 'subjectId', 'termId', 'schoolYearId', 'assessmentId', 'questionSetId'].forEach(function (key) {
      if (opts[key]) params.set(key, String(opts[key]));
    });
    var saved = false;
    var offs = [];
    var panel = drawer({
      title: opts.title || 'Questions',
      subtitle: opts.subtitle || '',
      src: '/common/allClassAssessmentExams?' + params.toString(),
      wide: true,
      keepOnEscape: true,
      onClose: function () {
        offs.forEach(function (off) { off(); });
        if (typeof opts.onDone === 'function') opts.onDone(saved);
      },
    });
    offs.push(on('managira:questions-saved', function (data) {
      saved = true;
      toast(data.message || 'Questions saved.');
      panel.close('saved');
    }));
    offs.push(on('managira:questions-closed', function () { panel.close('closed'); }));
    return panel;
  }

  window.AssessmentFlow = {
    on: on,
    drawer: drawer,
    dialog: dialog,
    confirm: confirmBox,
    toast: toast,
    esc: esc,
    createAssessment: createAssessment,
    askAddQuestions: askAddQuestions,
    openQuestions: openQuestions,
  };
})();
