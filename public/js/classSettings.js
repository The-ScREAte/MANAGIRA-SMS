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

    // Management: only the "All classes" row's share rows are on the page (each class's load when it opens),
    // so what each class has on and locked is kept as data (STATE) and the switches that are drawn follow it.
    var STATE = null;
    try {
      var stateEl = from === 'management' ? document.querySelector('[data-cs-state]') : null;
      if (stateEl) STATE = JSON.parse(stateEl.textContent);
    } catch (e) { STATE = null; }
    function stateIds() { return Object.keys(STATE); }
    function cellFor(id, key) {
      var el = root.querySelector('input[data-cs-key="' + key + '"][data-cs-class="' + id + '"]');
      return {
        el: el,
        get checked() { return !!STATE[id].on[key]; },
        set checked(v) { STATE[id].on[key] = !!v; if (el) el.checked = !!v; }
      };
    }
    function classCells(key) {
      if (STATE) return stateIds().map(function (id) { return cellFor(id, key); });
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
        if (STATE) STATE[input.getAttribute('data-cs-class')].on[key] = on;
        syncAll(key);
      }
      syncNeeds(input);
      var msg = statusFor(input);
      input.setAttribute('aria-busy', 'true');
      show(msg, 'Saving…', 'saving');
      var body = isAll ? { all: true, key: key, on: on } : { classId: Number(input.getAttribute('data-cs-class') || root.getAttribute('data-class-id')), key: key, on: on, from: from };
      queue = queue.then(function () { return post(url, body); }).then(function (json) {
        show(msg, describe(input, on, isAll), 'saved');
        root.dispatchEvent(new CustomEvent('managira:class-settings-saved', { bubbles: true, detail: { key: key, on: on, all: isAll, classId: body.classId || null, services: (json && json.services) || null } }));
      }, function (error) {
        targets.forEach(function (c, i) { c.checked = before[i]; });
        if (STATE && !isAll) STATE[input.getAttribute('data-cs-class')].on[key] = before[0];
        if (isAll && allBefore) {
          input.checked = allBefore.checked;
          input.indeterminate = allBefore.indeterminate;
        }
        syncAll(key);
        syncNeeds(input);
        show(msg, error.message, 'error');
      }).then(function () { input.removeAttribute('aria-busy'); });
    });

    // Attendance and Lunch rows ("Share with" and the attendance notices) show only while the class takes them:
    // their own switch is on. In the table, "All classes" shows them while any class takes them.
    function syncNeeds(input) {
      var key = input && input.getAttribute('data-cs-key');
      if (key !== 'attendance' && key !== 'lunch') return;
      var scope = from === 'management' ? input.closest('.cset-crow') : root;
      var on = input.checked || input.indeterminate;
      if (scope) scope.querySelectorAll('[data-cs-needs="' + key + '"]').forEach(function (el) { el.hidden = !on; });
      var all = from === 'management' ? allCell(key) : null;
      if (all && all !== input) {
        var allScope = all.closest('.cset-crow');
        var allOn = all.checked || all.indeterminate;
        if (allScope) allScope.querySelectorAll('[data-cs-needs="' + key + '"]').forEach(function (el) { el.hidden = !allOn; });
      }
    }

    // Management lists the classes a page at a time (Rows per page: 10 to 200); a search looks at every class.
    var csRows = Array.prototype.slice.call(root.querySelectorAll('[data-cs-name]'));
    var pagerHost = root.querySelector('[data-cs-pager]');
    var csPager = null;
    if (pagerHost && window.ManagiraPager) {
      csPager = ManagiraPager.create({ mount: pagerHost, key: 'class-settings', total: csRows.length, label: 'Classes', onChange: function (st) {
        csRows.forEach(function (tr, i) { tr.hidden = !(i >= st.from - 1 && i < st.to); });
      } });
      csPager.refresh();
    }
    function refreshMore(q) { if (pagerHost) { pagerHost.hidden = Boolean(q) || (csPager && csPager.state.total <= 10); if (!q && csPager) csPager.refresh(); } }

    // Find a class (Management): filters the rows by name, teacher or year group.
    var search = root.querySelector('[data-cs-search]');
    if (search) {
      var none = root.querySelector('[data-cs-none]');
      var count = root.querySelector('[data-cs-count]');
      search.addEventListener('input', function () {
        var q = search.value.trim().toLowerCase();
        var shown = 0;
        // A search looks at every class; cleared, the page bar's page shows again (or every class, with no bar).
        csRows.forEach(function (tr) {
          var hit = (tr.getAttribute('data-cs-find') || '').indexOf(q) >= 0;
          if (q) { tr.hidden = !hit; if (hit) shown += 1; } else if (!csPager) { tr.hidden = false; }
        });
        refreshMore(q);
        if (!q) shown = csRows.filter(function (tr) { return !tr.hidden; }).length;
        if (none) none.hidden = shown > 0;
        if (count) count.textContent = q ? shown + ' of ' + count.getAttribute('data-total') + ' classes' : count.getAttribute('data-total-text');
      });
    }

    // The padlock: management locks (or unlocks) a setting, so the class's own teachers can't change it.
    root.addEventListener('click', function (event) {
      var button = event.target.closest && event.target.closest('[data-cs-lock]');
      if (!button || !root.contains(button) || button.getAttribute('aria-busy') === 'true') return;
      var keys = String(button.getAttribute('data-cs-lock-keys') || '').split(',').filter(Boolean);
      if (!keys.length) return;
      var lock = button.getAttribute('aria-pressed') !== 'true';
      var isAll = button.hasAttribute('data-cs-lock-all');
      var body = isAll ? { all: true, key: keys[0], keys: keys, lock: lock } : { classId: Number(button.getAttribute('data-cs-lock-class') || root.getAttribute('data-class-id')), key: keys[0], keys: keys, lock: lock, from: from };
      var msg = statusFor(button);
      function paint(node, on) {
        node.setAttribute('aria-pressed', on ? 'true' : 'false');
        node.classList.toggle('is-locked', on);
        node.setAttribute('aria-label', on ? 'Locked for the class. Unlock' : 'Lock for the class');
        node.setAttribute('title', on ? "Locked: the class can't change this" : "Lock so the class can't change this");
        var shackle = node.querySelector('path');
        if (shackle) shackle.setAttribute('d', on ? 'M8 11V8a4 4 0 0 1 8 0v3' : 'M8 11V8a4 4 0 0 1 7.4-2');
      }
      button.setAttribute('aria-busy', 'true');
      show(msg, 'Saving…', 'saving');
      queue = queue.then(function () { return post(url, body); }).then(function () {
        var same = Array.prototype.slice.call(root.querySelectorAll('[data-cs-lock]')).filter(function (b) { return b.getAttribute('data-cs-lock-keys') === button.getAttribute('data-cs-lock-keys'); });
        if (STATE) {
          var lockClass = button.getAttribute('data-cs-lock-class');
          keys.forEach(function (k) { (isAll ? stateIds() : [lockClass]).forEach(function (id) { STATE[id].locked[k] = lock; }); });
          var every = stateIds().every(function (id) { return keys.every(function (k) { return STATE[id].locked[k]; }); });
          same.forEach(function (b) {
            if (b.hasAttribute('data-cs-lock-all')) paint(b, every);
            else if (isAll || b === button) paint(b, lock);
          });
        } else if (isAll) same.forEach(function (b) { paint(b, lock); }); else {
          paint(button, lock);
          var every = same.filter(function (b) { return !b.hasAttribute('data-cs-lock-all'); }).every(function (b) { return b.getAttribute('aria-pressed') === 'true'; });
          same.filter(function (b) { return b.hasAttribute('data-cs-lock-all'); }).forEach(function (b) { paint(b, every); });
        }
        show(msg, lock ? 'Locked: the class can’t change it.' : 'Unlocked.', 'saved');
      }, function (error) { show(msg, error.message, 'error'); }).then(function () { button.removeAttribute('aria-busy'); });
    });

    // A class's row opens to show who each item is shared with.
    root.addEventListener('click', function (event) {
      var button = event.target.closest && event.target.closest('[data-cs-toggle]');
      if (!button || !root.contains(button)) return;
      var row = button.closest('.cset-crow');
      var body = row && row.querySelector('.cset-crow__body');
      if (!body) return;
      var open = body.hidden;
      body.hidden = !open;
      var lazyId = body.getAttribute('data-cs-lazy');
      if (open && lazyId && !body.dataset.csLoaded && !body.dataset.csBusy) {
        body.dataset.csBusy = '1';
        fetch((root.getAttribute('data-rows-url') || '/common/class-settings/rows') + '?class=' + encodeURIComponent(lazyId), { credentials: 'same-origin', headers: { Accept: 'application/json' } })
          .then(function (r) { return r.json(); })
          .then(function (d) { if (!d.success) throw new Error(d.message); body.innerHTML = d.html; body.dataset.csLoaded = '1'; })
          .catch(function () { var note = body.querySelector('[data-cs-lazy-note]'); if (note) note.textContent = 'These rows could not load. Close and open the class to try again.'; })
          .then(function () { delete body.dataset.csBusy; });
      }
      row.classList.toggle('is-open', open);
      button.setAttribute('aria-expanded', open ? 'true' : 'false');
    });

    root.querySelectorAll('input[data-cs-all]').forEach(function (all) { syncAll(all.getAttribute('data-cs-key')); });
  }

  function begin() { document.querySelectorAll('[data-class-settings]').forEach(mount); }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', begin);
  else begin();
  window.addEventListener('spa:pageLoaded', begin);
})();
