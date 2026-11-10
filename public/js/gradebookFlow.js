// The gradebook in the assessments flow: the newest assessments on the right (shown on load),
// one Filter for students and "Last 5 … 1" assessments, which totals show (saved to the
// person's account), a ✓ on each column that posts its waiting grades to parents, and
// + Assessment to add one and its questions (public/js/assessmentFlow.js).
(function () {
  'use strict';
  var configEl = document.getElementById('gb-config');
  if (!configEl) return;
  var cfg = {};
  try { cfg = JSON.parse(configEl.textContent || '{}'); } catch (_) { return; }
  var view = { lastN: cfg.view && cfg.view.lastN ? Number(cfg.view.lastN) : null, hidden: (cfg.view && cfg.view.hidden) || [] };
  var flow = window.AssessmentFlow;
  var table = document.querySelector('#save-scores-form table');
  var scroller = document.querySelector('#save-scores-form .table-container');
  var columnCount = document.querySelectorAll('th[data-gb-col]').length;

  // ---- The newest assessments are on the right: show them first.
  function showNewest() {
    if (!scroller) return;
    scroller.scrollLeft = scroller.scrollWidth;
  }

  // ---- One Filter: which students (the page's own filter does the hiding) and how many
  // assessments show (all, scrolling for older ones, or the last few; remembered).
  var filterBtn = document.getElementById('gb-filter-btn');
  var filterMenu = document.getElementById('gb-filter-menu');
  var filterLabel = document.getElementById('gb-filter-label');
  var genderSelect = document.getElementById('assessment-gender-filter');
  var STUDENT_LABELS = { all: 'All students', male: 'Male', female: 'Female' };
  function studentChoice() { return genderSelect ? String(genderSelect.value || 'all') : 'all'; }
  function applyColumns() {
    var hideBefore = view.lastN && columnCount > view.lastN ? columnCount - view.lastN : 0;
    document.querySelectorAll('[data-gb-col]').forEach(function (cell) {
      cell.classList.toggle('gb-off', Number(cell.getAttribute('data-gb-col')) < hideBefore);
    });
    syncFilter();
  }
  function syncFilter() {
    var students = studentChoice();
    var parts = [];
    if (students !== 'all') parts.push(STUDENT_LABELS[students] || students);
    if (view.lastN) parts.push(columnCount > view.lastN ? 'Last ' + view.lastN + ' of ' + columnCount : 'Last ' + view.lastN);
    if (filterLabel) filterLabel.textContent = parts.length ? parts.join(' · ') : 'Filter';
    if (filterBtn) filterBtn.classList.toggle('is-active', parts.length > 0);
    if (!filterMenu) return;
    filterMenu.querySelectorAll('[data-gb-last]').forEach(function (item) {
      var value = item.getAttribute('data-gb-last');
      var on = value ? Number(value) === view.lastN : !view.lastN;
      item.setAttribute('aria-checked', on ? 'true' : 'false');
      item.classList.toggle('is-on', on);
    });
    filterMenu.querySelectorAll('[data-gb-students]').forEach(function (item) {
      var on = item.getAttribute('data-gb-students') === students;
      item.setAttribute('aria-checked', on ? 'true' : 'false');
      item.classList.toggle('is-on', on);
    });
  }
  function saveView() {
    fetch('/common/gradebook/view', {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify(view),
    }).catch(function () {});
  }
  function closeMenus(except) {
    if (filterMenu && except !== filterMenu) { filterMenu.hidden = true; if (filterBtn) filterBtn.setAttribute('aria-expanded', 'false'); }
    if (sumPop && except !== sumPop) { sumPop.hidden = true; if (sumBtn) sumBtn.setAttribute('aria-expanded', 'false'); }
  }
  if (filterBtn && filterMenu) {
    filterBtn.addEventListener('click', function (event) {
      event.stopPropagation();
      var open = filterMenu.hidden;
      closeMenus(filterMenu);
      filterMenu.hidden = !open;
      filterBtn.setAttribute('aria-expanded', open ? 'true' : 'false');
    });
    filterMenu.addEventListener('click', function (event) {
      event.stopPropagation();
      var students = event.target.closest('[data-gb-students]');
      if (students && genderSelect) {
        genderSelect.value = students.getAttribute('data-gb-students');
        genderSelect.dispatchEvent(new Event('change', { bubbles: true }));
        syncFilter();
        return;
      }
      var item = event.target.closest('[data-gb-last]');
      if (!item) return;
      var value = item.getAttribute('data-gb-last');
      view.lastN = value ? Number(value) : null;
      applyColumns();
      saveView();
      requestAnimationFrame(showNewest);
    });
  }

  // ---- Totals: tick the ones to see.
  // At least one total always shows: the ≡ sits in the top right of the last one shown.
  var sumBtn = document.getElementById('gb-sum-btn');
  var sumPop = document.getElementById('gb-sum-pop');
  var sumHeads = Array.prototype.slice.call(document.querySelectorAll('th[data-gb-sum]'));
  if (sumHeads.length && sumHeads.every(function (th) { return view.hidden.indexOf(th.getAttribute('data-gb-sum')) !== -1; })) view.hidden = [];
  function applyTotals() {
    document.querySelectorAll('[data-gb-sum]').forEach(function (cell) {
      cell.classList.toggle('gb-off', view.hidden.indexOf(cell.getAttribute('data-gb-sum')) !== -1);
    });
    var shown = sumHeads.filter(function (th) { return !th.classList.contains('gb-off'); });
    var host = shown[shown.length - 1];
    sumHeads.forEach(function (th) { th.classList.toggle('gb-sum-host', th === host); });
    if (sumBtn && host && sumBtn.parentNode !== host) host.appendChild(sumBtn);
    if (sumBtn) sumBtn.classList.toggle('has-hidden', view.hidden.length > 0);
    if (sumPop) {
      sumPop.querySelectorAll('[data-gb-sum-toggle]').forEach(function (box) {
        box.checked = view.hidden.indexOf(box.getAttribute('data-gb-sum-toggle')) === -1;
        box.disabled = box.checked && shown.length <= 1;
      });
    }
  }
  function placeSumPop() {
    var rect = sumBtn.getBoundingClientRect();
    var width = 230;
    var left = Math.min(Math.max(8, rect.right - width), window.innerWidth - width - 8);
    sumPop.style.left = left + 'px';
    sumPop.style.top = Math.min(rect.bottom + 6, window.innerHeight - 240) + 'px';
  }
  if (sumBtn && sumPop) {
    sumBtn.addEventListener('click', function (event) {
      event.stopPropagation();
      var open = sumPop.hidden;
      closeMenus(sumPop);
      sumPop.hidden = !open;
      sumBtn.setAttribute('aria-expanded', open ? 'true' : 'false');
      if (open) placeSumPop();
    });
    sumPop.addEventListener('click', function (event) { event.stopPropagation(); });
    sumPop.addEventListener('change', function (event) {
      var box = event.target.closest('[data-gb-sum-toggle]');
      if (!box) return;
      var key = box.getAttribute('data-gb-sum-toggle');
      view.hidden = view.hidden.filter(function (k) { return k !== key; });
      if (!box.checked) view.hidden.push(key);
      applyTotals();
      placeSumPop();
      saveView();
    });
  }
  document.addEventListener('click', function (event) {
    if (event.target.closest('#gb-filter-menu')) return;
    closeMenus(null);
  });
  document.addEventListener('keydown', function (event) { if (event.key === 'Escape') closeMenus(null); });
  window.addEventListener('scroll', function () { if (sumPop && !sumPop.hidden) placeSumPop(); }, true);

  // ---- ✓ on a column: post its waiting grades to parents.
  function hasUnsaved() {
    var save = document.getElementById('header-save-scores-button');
    return Boolean(save && save.classList.contains('has-unsaved'));
  }
  function markColumnPosted(assessmentId) {
    var th = document.querySelector('th[data-assessment-id="' + assessmentId + '"]');
    if (!th) return;
    var col = th.getAttribute('data-gb-col');
    document.querySelectorAll('td[data-gb-col="' + col + '"] .gb-dot--waiting, td[data-gb-col="' + col + '"] .gb-dot--new').forEach(function (dot) {
      dot.className = 'gb-dot gb-dot--posted';
      dot.title = 'Posted: parents and the student see it';
    });
    var btn = th.querySelector('[data-gb-approve]');
    if (btn) btn.remove();
    var hint = document.querySelector('.gb-legend__hint');
    if (hint && !document.querySelector('[data-gb-approve]')) hint.remove();
  }
  document.addEventListener('click', function (event) {
    var btn = event.target.closest('[data-gb-approve]');
    if (!btn || btn.disabled || !flow) return;
    event.preventDefault();
    var assessmentId = Number(btn.getAttribute('data-gb-approve'));
    var title = btn.getAttribute('data-title') || 'this assessment';
    var count = btn.querySelector('.gb-approve__count');
    var waiting = count ? Number(count.textContent) || 0 : 0;
    if (hasUnsaved()) {
      flow.dialog({
        title: 'Save your changes first',
        text: 'Some scores on this page aren’t saved yet. Save them, then approve “' + title + '”.',
        buttons: [{ label: 'Cancel', value: false }, { label: 'Save now', value: true, primary: true }],
      }).then(function (yes) {
        if (yes) document.getElementById('header-save-scores-button').click();
      });
      return;
    }
    flow.confirm({
      title: 'Post ' + waiting + ' grade' + (waiting === 1 ? '' : 's') + ' for “' + title + '”?',
      text: 'Parents and the student will see ' + (waiting === 1 ? 'it' : 'them') + ', and each family gets a notice. You can still change a grade later; it then waits for your approval again.',
      okLabel: 'Approve and post',
    }).then(function (yes) {
      if (!yes) return;
      btn.disabled = true;
      fetch('/common/assessment/approve', {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify({ assessmentId: assessmentId }),
      })
        .then(function (res) { return res.json().then(function (data) { return { ok: res.ok, data: data }; }); })
        .then(function (result) {
          if (!result.ok || !result.data.success) throw new Error(result.data.error || 'The grades couldn’t be approved.');
          markColumnPosted(assessmentId);
          flow.toast(result.data.message || 'Grades posted.');
        })
        .catch(function (error) {
          btn.disabled = false;
          flow.toast(error.message || 'The grades couldn’t be approved. Try again.', true);
        });
    });
  });

  // ---- + adds an assessment, then (optionally) its questions.
  function reload() { window.location.reload(); }
  var addBtn = document.getElementById('gb-add-assessment');
  if (addBtn && flow) {
    addBtn.addEventListener('click', function () {
      flow.createAssessment({
        organizationId: cfg.organizationId,
        termId: cfg.termId,
        classId: cfg.classId,
        subjectId: cfg.subjectId,
        onCreated: function (created) {
          var mine = created.filter(function (row) { return Number(row.classId) === cfg.classId && Number(row.subjectId) === cfg.subjectId; });
          if (!created.length) {
            flow.toast('Nothing new was added: an assessment with that name may already be here.', true);
            return;
          }
          if (!cfg.canAddQuestions) { reload(); return; }
          flow.askAddQuestions({ created: (mine.length ? mine : created).map(function (row) { return Object.assign({ className: cfg.className, subjectName: cfg.subjectName }, row); }) })
            .then(function (pick) {
              if (!pick) { reload(); return; }
              flow.openQuestions({
                classId: pick.classId,
                subjectId: pick.subjectId,
                termId: cfg.termId,
                schoolYearId: cfg.schoolYearId,
                assessmentId: pick.assessmentId,
                title: 'Add questions · ' + (pick.title || ''),
                subtitle: [cfg.className, cfg.subjectName].filter(Boolean).join(' · '),
                onDone: reload,
              });
            });
        },
      });
    });
  }

  applyColumns();
  applyTotals();
  showNewest();
  window.addEventListener('load', showNewest);
  if (table && 'ResizeObserver' in window) {
    var lastWidth = 0;
    new ResizeObserver(function () {
      if (!scroller || scroller.scrollWidth === lastWidth) return;
      lastWidth = scroller.scrollWidth;
      showNewest();
    }).observe(table);
  }
})();
