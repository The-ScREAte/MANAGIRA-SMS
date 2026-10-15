// Suggestions under subject and term name fields, from the school's library
// (utils/academicLibrary.js). A field opts in with list="subject-library" or
// list="term-library" pointing at a <datalist> on the page; this script swaps
// the browser's own popup for a list right below the field, so people pick the
// existing subject or term instead of typing a near-duplicate. Fields added
// later (Add another subject / term) work too.
(function () {
  if (window.__libraryPickerReady) return;
  window.__libraryPickerReady = true;

  var LISTS = { 'subject-library': 'subject', 'term-library': 'term', 'assessment-library': 'assessment' };
  var MAX_ITEMS = 50;

  var style = document.createElement('style');
  style.textContent = [
    '.lib-pick{position:absolute;z-index:100000;box-sizing:border-box;max-height:260px;overflow-y:auto;margin:0;padding:4px;list-style:none;',
    'background:var(--ap-surface,#fff);color:var(--ap-text,#0f172a);border:1px solid var(--ap-line,#d7dee8);border-radius:10px;',
    'box-shadow:0 12px 28px rgba(15,23,42,.16);font:inherit;font-size:14px;-webkit-overflow-scrolling:touch;overscroll-behavior:contain}',
    '.lib-pick[hidden]{display:none}',
    '.lib-pick__head{padding:6px 10px 4px;font-size:11px;font-weight:700;letter-spacing:.04em;text-transform:uppercase;color:var(--ap-muted,#64748b)}',
    '.lib-pick__item{display:flex;align-items:center;gap:8px;padding:9px 10px;border-radius:7px;cursor:pointer;line-height:1.3}',
    '.lib-pick__label{min-width:0;flex:1 1 auto;overflow-wrap:anywhere}',
    '.lib-pick__item mark{background:none;color:inherit;font-weight:700}',
    '.lib-pick__item.is-active,.lib-pick__item:hover{background:color-mix(in srgb,var(--org-primary-color,#01535b) 12%,transparent)}',
    '.lib-pick__item.is-exact::after{content:"\\2713";margin-left:auto;color:var(--org-primary-color,#01535b);font-weight:700}',
    '.lib-pick__new{padding:8px 10px;font-size:13px;color:var(--ap-muted,#64748b)}',
    '.lib-pick__note{margin-left:6px;font-size:11px;color:var(--ap-muted,#64748b)}',
    '.lib-pick__item.is-suggested{color:var(--org-primary-color,#01535b)}',
    '.lib-ask{position:fixed;inset:0;z-index:100001;display:flex;align-items:center;justify-content:center;padding:16px;background:rgba(15,23,42,.45)}',
    '.lib-ask__card{width:min(440px,100%);box-sizing:border-box;padding:22px;border-radius:14px;background:var(--ap-surface,#fff);color:var(--ap-text,#0f172a);box-shadow:0 20px 50px rgba(15,23,42,.3);font:inherit}',
    '.lib-ask__title{margin:0 0 8px;font-size:18px;font-weight:700}',
    '.lib-ask__text{margin:0 0 18px;font-size:15px;line-height:1.5;color:var(--ap-muted,#475569)}',
    '.lib-ask__actions{display:flex;flex-wrap:wrap;gap:10px;justify-content:flex-end}',
    '.lib-ask__btn{margin:0;padding:10px 16px;border-radius:9px;font:inherit;font-size:14px;font-weight:600;cursor:pointer;border:1px solid var(--org-primary-color,#01535b);background:transparent;color:var(--org-primary-color,#01535b)}',
    '.lib-ask__btn--use{background:var(--org-primary-color,#01535b);color:#fff}',
    '@media (hover:none) and (pointer:coarse){.lib-pick{font-size:16px}.lib-pick__item{padding:12px 10px}}'
  ].join('');
  document.head.appendChild(style);

  var panel = document.createElement('ul');
  panel.className = 'lib-pick';
  panel.setAttribute('role', 'listbox');
  panel.hidden = true;

  var field = null;   // the input the list belongs to
  var items = [];     // names currently shown
  var active = -1;    // highlighted row

  function optionsFor(input) {
    var list = document.getElementById(input.dataset.libraryList);
    if (!list) return [];
    return Array.prototype.map.call(list.options, function (o) { return o.value; }).filter(Boolean);
  }
  // Options marked data-recent (e.g. this term's assessments) are what an
  // empty field shows; the rest appear once something matching is typed.
  function recentFor(input) {
    var list = document.getElementById(input.dataset.libraryList);
    if (!list) return null;
    var marked = Array.prototype.filter.call(list.options, function (o) { return o.hasAttribute('data-recent'); });
    if (!list.querySelector('option[data-recent]') && !list.hasAttribute('data-recent-only')) return null;
    return marked.map(function (o) { return o.value; });
  }

  // Takes over a field: no browser popup, our list instead.
  function adopt(input) {
    if (!input || input.tagName !== 'INPUT') return false;
    if (input.dataset.libraryList) return true;
    var id = input.getAttribute('list');
    if (!LISTS[id]) return false;
    input.dataset.libraryList = id;
    input.removeAttribute('list');
    input.setAttribute('autocomplete', 'off');
    input.setAttribute('role', 'combobox');
    input.setAttribute('aria-autocomplete', 'list');
    input.setAttribute('aria-expanded', 'false');
    return true;
  }

  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; });
  }
  function highlight(name, typed) {
    if (!typed) return escapeHtml(name);
    var at = name.toLowerCase().indexOf(typed.toLowerCase());
    if (at < 0) return escapeHtml(name);
    return escapeHtml(name.slice(0, at)) + '<mark>' + escapeHtml(name.slice(at, at + typed.length)) + '</mark>' + escapeHtml(name.slice(at + typed.length));
  }

  // ---------- "Did you mean ...?" ----------
  // Names that mean the same thing compare equal: "Semester 1", "1st Semester"
  // and "first semester"; small typos and short forms ("Sem 1") are close.
  var ORDINALS = { first: '1', second: '2', third: '3', fourth: '4', fifth: '5', one: '1', two: '2', three: '3', four: '4' };
  var TERM_WORDS = { semester: 1, term: 1, trimester: 1, quarter: 1, sem: 1 };
  function tokens(name) {
    return String(name || '').toLowerCase().replace(/&/g, ' and ').split(/[^a-z0-9]+/).filter(Boolean).map(function (t) {
      var m = t.match(/^(\d+)(st|nd|rd|th)$/);
      return m ? String(Number(m[1])) : (ORDINALS[t] || t);
    }).sort();
  }
  function distance(a, b) {
    var before = [], prev = [], cur, i, j;
    for (j = 0; j <= b.length; j++) prev[j] = j;
    for (i = 1; i <= a.length; i++) {
      cur = [i];
      for (j = 1; j <= b.length; j++) {
        cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
        if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) cur[j] = Math.min(cur[j], before[j - 2] + 1);
      }
      before = prev;
      prev = cur;
    }
    return prev[b.length];
  }
  function numbers(list) { return list.filter(function (t) { return /^\d+$/.test(t); }).join(','); }
  function words(list) { return list.filter(function (t) { return !/^\d+$/.test(t); }); }
  function prefixed(short, long) {
    if (short.length !== long.length) return false;
    var pool = long.slice();
    return short.every(function (t) {
      var at = pool.findIndex(function (w) { return w === t || (t.length >= 3 && w.indexOf(t) === 0); });
      if (at < 0) return false;
      pool.splice(at, 1);
      return true;
    });
  }
  function withoutTermWords(list) { return list.filter(function (t) { return !TERM_WORDS[t]; }); }
  // The existing name the typed one most likely means (not an exact match).
  function nearMatch(typed, names, kind) {
    var low = String(typed || '').trim().toLowerCase();
    if (low.length < 3) return null;
    if (names.some(function (n) { return n.trim().toLowerCase() === low; })) return null;
    var tk = tokens(typed), key = tk.join(' ');
    var best = null, bestScore = Infinity;
    names.forEach(function (name) {
      var nk = tokens(name), nkey = nk.join(' '), score = Infinity;
      if (nkey === key) score = 0;
      else if (numbers(tk) === numbers(nk) && prefixed(words(tk), words(nk))) score = 1;
      else if (kind === 'term' && numbers(tk) === numbers(nk) && withoutTermWords(tk).length &&
        withoutTermWords(tk).join(' ') === withoutTermWords(nk).join(' ')) score = 1;
      else {
        var d = distance(key, nkey);
        if (d <= Math.max(1, Math.floor(nkey.length * 0.2)) && numbers(tk) === numbers(nk)) score = 1 + d;
      }
      if (score < bestScore) { best = name; bestScore = score; }
    });
    return best;
  }

  // Pages may be zoomed (globalScale.css) and browsers report zoomed positions
  // differently, so measure where the list's own (0,0) lands and how big one of
  // its pixels is, then line it up under the field from that.
  function place() {
    if (!field) return;
    var r = field.getBoundingClientRect();
    panel.style.left = '0px';
    panel.style.top = '0px';
    var origin = panel.getBoundingClientRect();
    panel.style.left = '100px';
    var scale = (panel.getBoundingClientRect().left - origin.left) / 100 || 1;
    panel.style.left = ((r.left - origin.left) / scale) + 'px';
    panel.style.top = ((r.bottom + 4 - origin.top) / scale) + 'px';
    panel.style.width = (Math.max(r.width, 200) / scale) + 'px';
  }

  function render() {
    if (!field) return;
    var kind = LISTS[field.dataset.libraryList];
    var typed = field.value.trim();
    var low = typed.toLowerCase();
    var all = optionsFor(field);
    var recent = recentFor(field);
    var starts = [], contains = [];
    (low ? all : (recent || all)).forEach(function (name) {
      var n = name.toLowerCase();
      if (!low || n.indexOf(low) === 0) starts.push(name);
      else if (n.indexOf(low) > 0) contains.push(name);
    });
    var recentSet = recent ? new Set(recent.map(function (n) { return n.toLowerCase(); })) : null;
    items = starts.concat(contains).slice(0, MAX_ITEMS);
    var exact = all.some(function (name) { return name.toLowerCase() === low; });
    var near = typed && !exact ? nearMatch(typed, all, kind) : null;
    if (near) items = [near].concat(items.filter(function (n) { return n !== near; })).slice(0, MAX_ITEMS);
    var html = '';
    if (items.length) {
      html += '<li class="lib-pick__head" aria-hidden="true">' + (recent && !low ? 'This term' : 'Existing ' + kind + 's') + '</li>';
      items.forEach(function (name, i) {
        var classes = 'lib-pick__item' + (i === active ? ' is-active' : '') + (name.toLowerCase() === low ? ' is-exact' : '') + (name === near ? ' is-suggested' : '');
        var label = name === near ? 'Did you mean <strong>' + escapeHtml(name) + '</strong>?' : highlight(name, typed);
        if (recentSet && !recentSet.has(name.toLowerCase())) label += ' <span class="lib-pick__note">Used before</span>';
        html += '<li class="' + classes + '" role="option" data-index="' + i + '" aria-selected="' + (i === active) + '"><span class="lib-pick__label">' + label + '</span></li>';
      });
    }
    // Only when nothing matches: then the typed name really is new.
    if (typed && !exact && !items.length) {
      html += '<li class="lib-pick__new" aria-hidden="true">"' + escapeHtml(typed) + '" will be added as a new ' + kind + '.</li>';
    }
    panel.innerHTML = html;
    var show = !!html;
    panel.hidden = !show;
    field.setAttribute('aria-expanded', String(show));
    if (show) {
      if (!panel.isConnected) document.body.appendChild(panel);
      place();
    }
  }

  function open(input) {
    if (!adopt(input)) return;
    field = input;
    active = -1;
    render();
  }
  function close() {
    panel.hidden = true;
    if (field) field.setAttribute('aria-expanded', 'false');
    field = null;
    active = -1;
  }
  function choose(index) {
    if (!field || index < 0 || index >= items.length) return;
    var input = field;
    input.value = items[index];
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.dispatchEvent(new Event('change', { bubbles: true }));
    close();
  }

  document.addEventListener('focusin', function (e) {
    if (adopt(e.target)) open(e.target);
  });
  document.addEventListener('input', function (e) {
    if (e.target === field) { active = -1; render(); }
    else if (adopt(e.target)) open(e.target);
  });
  document.addEventListener('keydown', function (e) {
    if (!field || e.target !== field || panel.hidden) return;
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      if (!items.length) return;
      active = e.key === 'ArrowDown' ? (active + 1) % items.length : (active <= 0 ? items.length - 1 : active - 1);
      render();
      var row = panel.querySelector('.is-active');
      if (row) row.scrollIntoView({ block: 'nearest' });
    } else if (e.key === 'Enter' && active >= 0) {
      e.preventDefault();
      choose(active);
    } else if (e.key === 'Escape' || e.key === 'Tab') {
      close();
    }
  });
  // Picking keeps the field focused (pointerdown, not click).
  panel.addEventListener('pointerdown', function (e) {
    var row = e.target.closest('.lib-pick__item');
    e.preventDefault();
    if (row) choose(Number(row.dataset.index));
  });
  document.addEventListener('focusout', function (e) {
    if (e.target === field) setTimeout(function () { if (document.activeElement !== field) close(); }, 120);
  });
  document.addEventListener('pointerdown', function (e) {
    if (field && e.target !== field && !panel.contains(e.target)) close();
  });
  window.addEventListener('resize', function () { if (field) place(); });
  window.addEventListener('scroll', function () { if (field) place(); }, true);

  // A small choice dialog: resolves 'use', 'new' or 'cancel'.
  function ask(kind, typed, near) {
    return new Promise(function (resolve) {
      var noun = kind || 'name';
      var box = document.createElement('div');
      box.className = 'lib-ask';
      box.setAttribute('role', 'dialog');
      box.setAttribute('aria-modal', 'true');
      box.innerHTML = '<div class="lib-ask__card">' +
        '<p class="lib-ask__title">Did you mean \u201c' + escapeHtml(near) + '\u201d?</p>' +
        '<p class="lib-ask__text">You typed \u201c' + escapeHtml(typed) + '\u201d. This school already has the ' + noun + ' \u201c' + escapeHtml(near) + '\u201d. Use it to keep one name, or add \u201c' + escapeHtml(typed) + '\u201d as a new ' + noun + '.</p>' +
        '<div class="lib-ask__actions">' +
        '<button type="button" class="lib-ask__btn" data-answer="new">Add as new ' + noun + '</button>' +
        '<button type="button" class="lib-ask__btn lib-ask__btn--use" data-answer="use">Use \u201c' + escapeHtml(near) + '\u201d</button>' +
        '</div></div>';
      function done(answer) {
        document.removeEventListener('keydown', onKey, true);
        box.remove();
        resolve(answer);
      }
      function onKey(e) { if (e.key === 'Escape') { e.preventDefault(); done('cancel'); } }
      box.addEventListener('click', function (e) {
        var b = e.target.closest('[data-answer]');
        if (b) done(b.dataset.answer);
        else if (e.target === box) done('cancel');
      });
      document.addEventListener('keydown', onKey, true);
      document.body.appendChild(box);
      box.querySelector('.lib-ask__btn--use').focus();
    });
  }

  // Before a form with subject/term names is saved, a name that looks like an
  // existing one asks first. Runs ahead of the page's own submit handling.
  window.addEventListener('submit', function (e) {
    var form = e.target;
    if (!form || form.tagName !== 'FORM') return;
    if (form.dataset.libraryChecked === '1') { form.dataset.libraryChecked = ''; return; }
    adoptAll(form);
    var checks = [], byName = {};
    Array.prototype.forEach.call(form.elements, function (el) {
      if (!el.dataset || !el.dataset.libraryList || !el.value.trim()) return;
      if (el.dataset.libraryKept === el.value.trim()) return;
      var kind = LISTS[el.dataset.libraryList];
      var key = kind + '\n' + el.value.trim().toLowerCase();
      if (byName[key]) { byName[key].fields.push(el); return; }
      var near = nearMatch(el.value, optionsFor(el), kind);
      if (near) checks.push(byName[key] = { kind: kind, typed: el.value.trim(), near: near, fields: [el] });
    });
    if (!checks.length) return;
    e.preventDefault();
    e.stopImmediatePropagation();
    var submitter = e.submitter;
    close();
    (function next(i) {
      if (i >= checks.length) {
        form.dataset.libraryChecked = '1';
        if (form.requestSubmit) form.requestSubmit(submitter && submitter.form === form ? submitter : undefined);
        else if (form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }))) form.submit();
        return;
      }
      var c = checks[i];
      ask(c.kind, c.typed, c.near).then(function (answer) {
        if (answer === 'cancel') { c.fields[0].focus(); return; }
        c.fields.forEach(function (el) {
          if (answer === 'use') {
            el.value = c.near;
            el.dispatchEvent(new Event('input', { bubbles: true }));
            el.dispatchEvent(new Event('change', { bubbles: true }));
          } else {
            el.dataset.libraryKept = c.typed;
          }
        });
        close();
        next(i + 1);
      });
    })(0);
  }, true);

  // Fields already on the page lose the browser popup right away.
  function adoptAll(root) {
    (root || document).querySelectorAll('input[list="subject-library"], input[list="term-library"], input[list="assessment-library"]').forEach(adopt);
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', function () { adoptAll(); });
  else adoptAll();
  window.addEventListener('spa:pageLoaded', function () { close(); adoptAll(); });
})();
