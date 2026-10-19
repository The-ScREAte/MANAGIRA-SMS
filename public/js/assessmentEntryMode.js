// "How are results recorded?" for an assessment: a score, or the school's own
// choices (Yes / No, Pass / Fail, anything typed). Used when creating tests
// (one block per test card) and when editing one. See utils/assessmentEntry.js
// for the rules the server applies.
(function () {
  if (window.AssessmentEntryMode) return;

  var PRESETS = [
    { name: 'Yes / No', options: [['Yes', 1], ['No', 0]] },
    { name: 'Pass / Fail', options: [['Pass', 1], ['Fail', 0]] },
    { name: 'Complete / Incomplete', options: [['Complete', 1], ['Incomplete', 0]] },
    { name: 'Met / Not met', options: [['Met', 1], ['Not met', 0]] },
  ];
  var MAX_CHOICES = 10;
  var counter = 0;

  function esc(v) {
    return String(v == null ? '' : v).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  function rowHtml(label, points) {
    return '<div class="aem-row">' +
      '<input type="text" class="aem-row__label" maxlength="40" placeholder="Choice, e.g. Yes" value="' + esc(label) + '" aria-label="Choice">' +
      '<input type="number" class="aem-row__points" min="0" max="999.99" step="0.01" placeholder="Points" value="' + (points == null ? '' : esc(points)) + '" aria-label="Points for this choice">' +
      '<button type="button" class="aem-row__remove" aria-label="Remove this choice" title="Remove">&times;</button>' +
    '</div>';
  }

  function build(host, opts) {
    counter += 1;
    var name = 'aem-mode-' + counter;
    var initial = opts.initial || {};
    var mode = initial.entryMode === 'choice' ? 'choice' : 'score';
    var options = Array.isArray(initial.choiceOptions) && initial.choiceOptions.length ? initial.choiceOptions : [{ label: 'Yes', points: null }, { label: 'No', points: null }];
    var withPoints = options.every(function (o) { return o.points !== null && o.points !== undefined && o.points !== ''; });

    var box = document.createElement('div');
    box.className = 'aem';
    box.innerHTML =
      '<div class="aem__title">How are results recorded?</div>' +
      '<div class="aem__modes" role="radiogroup" aria-label="How results are recorded">' +
        '<label class="aem__mode"><input type="radio" name="' + name + '" value="score"' + (mode === 'score' ? ' checked' : '') + '>' +
          '<span><strong>Score</strong><small>A number out of the score below</small></span></label>' +
        '<label class="aem__mode"><input type="radio" name="' + name + '" value="choice"' + (mode === 'choice' ? ' checked' : '') + '>' +
          '<span><strong>Choice</strong><small>Yes / No, Pass / Fail or your own words</small></span></label>' +
      '</div>' +
      '<div class="aem__choices"' + (mode === 'choice' ? '' : ' hidden') + '>' +
        '<div class="aem__presets"><span>Start from</span>' +
          PRESETS.map(function (p, i) { return '<button type="button" class="aem__preset" data-preset="' + i + '">' + esc(p.name) + '</button>'; }).join('') +
        '</div>' +
        '<label class="aem__points-toggle"><input type="checkbox" class="aem__with-points"' + (withPoints ? ' checked' : '') + '> Give each choice points (they count in totals and grades)</label>' +
        '<div class="aem__rows">' + options.map(function (o) { return rowHtml(o.label, o.points); }).join('') + '</div>' +
        '<button type="button" class="aem__add">+ Add a choice</button>' +
        '<p class="aem__hint" aria-live="polite"></p>' +
        (opts.locked ? '<p class="aem__note">Results are already saved for this assessment, so it stays a choice assessment, and choices already given to students keep their names. You can add choices and change points.</p>' : '') +
      '</div>';
    if (opts.locked) {
      Array.prototype.forEach.call(box.querySelectorAll('input[type="radio"]'), function (r) { r.disabled = true; });
    }
    return box;
  }

  function attach(host, opts) {
    opts = opts || {};
    if (!host || host.__aem) return host && host.__aem;
    var anchor = opts.insertAfter || host.firstElementChild;
    var box = build(host, opts);
    if (anchor && anchor.parentNode) anchor.parentNode.insertBefore(box, anchor.nextSibling);
    else host.insertBefore(box, host.firstChild);

    var weight = opts.weightInput || host.querySelector('input[name="testWeight[]"], input[name="testWeight"]');
    var maxScore = opts.maxInput || host.querySelector('input[name="maxScore[]"], input[name="maxScore"]');
    var saved = { weight: weight ? weight.value : '', max: maxScore ? maxScore.value : '' };

    function modeValue() {
      var checked = box.querySelector('.aem__modes input:checked');
      return checked ? checked.value : 'score';
    }
    function withPoints() { return box.querySelector('.aem__with-points').checked; }
    function rows() { return Array.prototype.slice.call(box.querySelectorAll('.aem-row')); }

    function sync() {
      var choice = modeValue() === 'choice';
      box.querySelector('.aem__choices').hidden = !choice;
      box.classList.toggle('aem--no-points', choice && !withPoints());
      var hint = box.querySelector('.aem__hint');
      var add = box.querySelector('.aem__add');
      add.hidden = rows().length >= MAX_CHOICES;
      if (!choice) {
        if (weight && weight.dataset.aemSet) { weight.value = saved.weight; weight.readOnly = false; delete weight.dataset.aemSet; }
        if (maxScore && maxScore.dataset.aemSet) { maxScore.value = saved.max; maxScore.readOnly = false; delete maxScore.dataset.aemSet; }
        markField(weight, ''); markField(maxScore, '');
        return;
      }
      if (weight && !weight.dataset.aemSet) saved.weight = weight.value;
      if (maxScore && !maxScore.dataset.aemSet) saved.max = maxScore.value;
      if (withPoints()) {
        var top = rows().reduce(function (m, r) { var n = parseFloat(r.querySelector('.aem-row__points').value); return Number.isFinite(n) && n > m ? n : m; }, 0);
        if (weight && weight.dataset.aemSet === 'zero') { weight.value = saved.weight && Number(saved.weight) > 0 ? saved.weight : ''; weight.readOnly = false; delete weight.dataset.aemSet; }
        if (maxScore) { maxScore.value = top > 0 ? String(top) : ''; maxScore.readOnly = true; maxScore.dataset.aemSet = 'top'; }
        markField(weight, ''); markField(maxScore, 'Set by the highest choice');
        hint.textContent = 'Counts like a score: the points chosen are added to totals, grades and positions. "Score out of" is the highest choice.';
      } else {
        if (weight) { weight.value = '0'; weight.readOnly = true; weight.dataset.aemSet = 'zero'; }
        if (maxScore) { maxScore.value = '0'; maxScore.readOnly = true; maxScore.dataset.aemSet = 'zero'; }
        markField(weight, 'Choices without points don’t count'); markField(maxScore, 'Choices without points don’t count');
        hint.textContent = 'Doesn’t change totals or grades. The choice shows on the score sheet, report card and portals.';
      }
    }

    function markField(input, note) {
      if (!input) return;
      var holder = input.closest('label, .form-group') || input.parentNode;
      var tag = holder.querySelector('.aem-field-note');
      if (!note) { if (tag) tag.remove(); return; }
      if (!tag) { tag = document.createElement('small'); tag.className = 'aem-field-note'; holder.appendChild(tag); }
      tag.textContent = note;
    }

    box.addEventListener('change', sync);
    box.addEventListener('input', function (e) { if (e.target.classList.contains('aem-row__points')) sync(); });
    box.addEventListener('click', function (e) {
      var preset = e.target.closest('.aem__preset');
      if (preset) {
        var p = PRESETS[Number(preset.dataset.preset)];
        var pts = withPoints();
        box.querySelector('.aem__rows').innerHTML = p.options.map(function (o) { return rowHtml(o[0], pts ? o[1] : null); }).join('');
        sync();
        return;
      }
      if (e.target.closest('.aem__add')) {
        if (rows().length >= MAX_CHOICES) return;
        box.querySelector('.aem__rows').insertAdjacentHTML('beforeend', rowHtml('', null));
        var last = rows()[rows().length - 1];
        last.querySelector('.aem-row__label').focus();
        sync();
        return;
      }
      var remove = e.target.closest('.aem-row__remove');
      if (remove) {
        if (rows().length <= 2) { alert('A choice assessment needs at least two choices.'); return; }
        remove.closest('.aem-row').remove();
        sync();
      }
    });

    var api = {
      box: box,
      read: function () {
        if (modeValue() !== 'choice') return { entryMode: 'score', choiceOptions: null };
        var pts = withPoints();
        return {
          entryMode: 'choice',
          choiceOptions: rows().map(function (r) {
            var label = r.querySelector('.aem-row__label').value.replace(/\s+/g, ' ').trim();
            var raw = r.querySelector('.aem-row__points').value;
            return { label: label, points: pts && raw !== '' ? Number(raw) : null };
          }).filter(function (o) { return o.label; }),
        };
      },
      // An error message, or '' when the choices are fine.
      validate: function () {
        var value = api.read();
        if (value.entryMode !== 'choice') return '';
        var labels = value.choiceOptions.map(function (o) { return o.label.toLowerCase(); });
        if (labels.length < 2) return 'Add at least two choices (for example Yes and No).';
        if (new Set(labels).size !== labels.length) return 'Each choice needs a different name.';
        if (withPoints()) {
          if (value.choiceOptions.some(function (o) { return o.points === null || !(o.points >= 0); })) return 'Give every choice points (0 or more), or turn points off.';
          if (!value.choiceOptions.some(function (o) { return o.points > 0; })) return 'At least one choice needs more than 0 points.';
        }
        return '';
      },
      countsInTotal: function () { return modeValue() !== 'choice' || withPoints(); },
    };
    host.__aem = api;
    sync();
    return api;
  }

  window.AssessmentEntryMode = { attach: attach, PRESETS: PRESETS };
})();
