// Class settings (feature class_settings): the switches and "Share with" tick boxes in a
// classroom's Class settings panel and on Management › Class settings. Each saves as it changes
// (one at a time, in order); a failure puts it back and says why. In the table, an "All classes"
// box sets the whole column and shows a dash while classes differ. Each [data-class-settings]
// root is bound once.
(function () {
  'use strict';

  function post(url, body) {
    return fetch(url, {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json', 'X-Requested-With': 'XMLHttpRequest' },
      body: JSON.stringify(body)
    }).then(function (res) {
      return res.json().catch(function () { return null; }).then(function (json) {
        if (!json) throw new Error(res.redirected ? 'Your session has ended. Sign in again to continue.' : "That didn't save. Try again.");
        if (!res.ok || !json.success) throw new Error(json.message || "That didn't save. Try again.");
        return json;
      });
    }, function () {
      throw new Error("We couldn't reach Managira. Check your connection and try again.");
    });
  }

  function show(el, text, kind) {
    if (!el) return;
    clearTimeout(el.__csTimer);
    el.textContent = text || '';
    el.classList.remove('is-saving', 'is-saved', 'is-error');
    if (kind) el.classList.add('is-' + kind);
    if (kind === 'saved') {
      el.__csTimer = setTimeout(function () { el.textContent = ''; el.classList.remove('is-saved'); }, 2600);
    }
  }

  function mount(root) {
    if (!root || root.__csBound) return;
    root.__csBound = true;
    var url = root.getAttribute('data-save-url');
    var from = root.getAttribute('data-from') || '';
    var queue = Promise.resolve();

    function classCells(key) {
      return Array.prototype.slice.call(root.querySelectorAll('input[data-cs-key="' + key + '"][data-cs-class]'));
    }
    function allCell(key) {
      return root.querySelector('input[data-cs-key="' + key + '"][data-cs-all]');
    }
    // "All classes" shows on when every class is on, off when none is, and in between otherwise.
    function syncAll(key) {
      var all = allCell(key);
      if (!all) return;
      var cells = classCells(key);
      var on = cells.filter(function (c) { return c.checked; }).length;
      all.checked = cells.length > 0 && on === cells.length;
      all.indeterminate = on > 0 && on < cells.length;
      all.setAttribute('data-mixed', all.indeterminate ? '1' : '');
    }
    function statusFor(input) {
      var row = input.closest('[data-cs-row]');
      return (row && row.querySelector('[data-cs-msg]')) || root.querySelector('[data-cs-status]');
    }
    // The classroom says "Saved" beside the switch; the table says what changed, at the top.
    function describe(input, on, isAll) {
      if (input.closest('[data-cs-row]')) return 'Saved';
      var what = input.getAttribute('data-cs-what') || 'has this setting';
      var row = input.closest('[data-cs-name]');
      var where = isAll ? 'Every class' : (row ? row.getAttribute('data-cs-name') : 'This class');
      return 'Saved: ' + where + (on ? ' now ' : ' no longer ') + what + '.';
    }

    root.addEventListener('change', function (event) {
      var input = event.target;
      if (!input || !input.matches || !input.matches('input[data-cs-key]') || !root.contains(input)) return;
      var key = input.getAttribute('data-cs-key');
      var on = input.checked;
      var isAll = input.hasAttribute('data-cs-all');
      var targets = isAll ? classCells(key) : [input];
      var before = targets.map(function (c) { return c === input ? !on : c.checked; });
      var allBefore = isAll ? { checked: !on, indeterminate: input.getAttribute('data-mixed') === '1' } : null;
      if (isAll) {
        targets.forEach(function (c) { c.checked = on; });
        input.indeterminate = false;
        input.setAttribute('data-mixed', '');
      } else {
        syncAll(key);
      }
      var msg = statusFor(input);
      input.setAttribute('aria-busy', 'true');
      show(msg, 'Saving…', 'saving');
      var body = isAll ? { all: true, key: key, on: on } : { classId: Number(input.getAttribute('data-cs-class') || root.getAttribute('data-class-id')), key: key, on: on, from: from };
      queue = queue.then(function () { return post(url, body); }).then(function () {
        show(msg, describe(input, on, isAll), 'saved');
        root.dispatchEvent(new CustomEvent('managira:class-settings-saved', { bubbles: true, detail: { key: key, on: on, all: isAll, classId: body.classId || null } }));
      }, function (error) {
        targets.forEach(function (c, i) { c.checked = before[i]; });
        if (isAll && allBefore) {
          input.checked = allBefore.checked;
          input.indeterminate = allBefore.indeterminate;
        }
        syncAll(key);
        show(msg, error.message, 'error');
      }).then(function () { input.removeAttribute('aria-busy'); });
    });

    // Find a class (Management): filters the rows by name, teacher or year group.
    var search = root.querySelector('[data-cs-search]');
    if (search) {
      var none = root.querySelector('[data-cs-none]');
      var count = root.querySelector('[data-cs-count]');
      search.addEventListener('input', function () {
        var q = search.value.trim().toLowerCase();
        var shown = 0;
        root.querySelectorAll('tr[data-cs-name]').forEach(function (tr) {
          var hit = !q || (tr.getAttribute('data-cs-find') || '').indexOf(q) >= 0;
          tr.hidden = !hit;
          if (hit) shown += 1;
        });
        if (none) none.hidden = shown > 0;
        if (count) count.textContent = q ? shown + ' of ' + count.getAttribute('data-total') + ' classes' : count.getAttribute('data-total-text');
      });
    }

    root.querySelectorAll('input[data-cs-all]').forEach(function (all) { syncAll(all.getAttribute('data-cs-key')); });
  }

  function begin() { document.querySelectorAll('[data-class-settings]').forEach(mount); }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', begin);
  else begin();
  window.addEventListener('spa:pageLoaded', begin);
})();
