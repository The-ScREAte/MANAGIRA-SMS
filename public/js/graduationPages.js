// Close Graduation Year Group + Archived Students: search, per-group select
// all, the selection bar and the confirm dialog. Markup hooks are data-gp-*.
(function () {
  function init() {
    const form = document.querySelector('[data-gp-form]');
    if (!form || form.dataset.gpReady === '1') return;
    form.dataset.gpReady = '1';

    // With lazy groups (Graduate & Withdraw) most rows aren't on the page, so what's ticked is kept as a set of
    // student ids: rows drawn later come back ticked, and the ones not on the page are sent as hidden fields.
    const lazyUrl = form.dataset.gpLazy || '';
    const chosen = new Set();
    const picks = () => Array.from(form.querySelectorAll('.gp-pick:not(:disabled)'));
    const bar = document.querySelector('[data-gp-actionbar]');
    const countEl = document.querySelector('[data-gp-count]');
    const dialog = document.querySelector('[data-gp-dialog]');
    const dialogTitle = document.querySelector('[data-gp-dialog-title]');
    const noun = form.dataset.gpNoun || 'student';

    function selected() {
      if (lazyUrl) return Array.from(chosen);
      return picks().filter((box) => box.checked);
    }

    function syncGroup(group) {
      const all = group.querySelector('.gp-pick-all');
      if (!all) return;
      const boxes = Array.from(group.querySelectorAll('.gp-pick:not(:disabled)')).filter((b) => !b.closest('tr').hidden);
      if (!boxes.length && group.dataset.gpGroup && !group.querySelector('[data-gp-loaded]')) { all.checked = false; all.indeterminate = false; return; }
      const on = boxes.filter((b) => b.checked).length;
      all.checked = boxes.length > 0 && on === boxes.length;
      all.indeterminate = on > 0 && on < boxes.length;
      all.disabled = boxes.length === 0;
    }

    function sync() {
      const n = selected().length;
      if (countEl) countEl.textContent = n + ' ' + noun + (n === 1 ? '' : 's') + ' selected';
      if (bar) bar.classList.toggle('is-visible', n > 0);
      form.querySelectorAll('.gp-group').forEach(syncGroup);
    }

    form.addEventListener('change', (e) => {
      const all = e.target.closest('.gp-pick-all');
      if (all) {
        const group = all.closest('.gp-group');
        group.querySelectorAll('.gp-pick:not(:disabled)').forEach((box) => {
          if (!box.closest('tr').hidden) { box.checked = all.checked; remember(box); }
        });
        // Rows still waiting behind "Show more" count too: select-all means the whole group (or everyone found).
        if (lazyUrl && group.querySelector('[data-gp-pager]')) {
          const q = search ? search.value.trim() : '';
          const on = all.checked;
          lazyFetch('group=' + encodeURIComponent(group.dataset.gpGroup) + '&ids=1' + (q ? '&q=' + encodeURIComponent(q) : '')).then((d) => {
            d.ids.forEach((id) => { if (on) chosen.add(id); else chosen.delete(id); });
            sync();
          }).catch(() => {});
        }
      } else if (e.target.classList && e.target.classList.contains('gp-pick')) {
        remember(e.target);
      }
      sync();
    });
    function remember(box) { if (!lazyUrl) return; if (box.checked) chosen.add(box.value); else chosen.delete(box.value); }

    // ── Groups load when opened, and a search asks the server (the page only holds the first group) ──
    function bodyOf(group) { return group.querySelector('[data-gp-body]'); }
    function fill(group, html, filtered) {
      const body = bodyOf(group);
      if (!body) return;
      body.innerHTML = html;
      if (filtered) body.dataset.gpFiltered = '1'; else delete body.dataset.gpFiltered;
      body.dataset.gpLoaded = '1';
      body.querySelectorAll('.gp-pick').forEach((box) => { if (chosen.has(box.value)) box.checked = true; });
      bindMore(group);
      body.querySelectorAll('.gp-avatar img').forEach((img) => {
        const fallback = () => { img.parentElement.textContent = img.parentElement.dataset.initials || '?'; };
        img.addEventListener('error', fallback, { once: true });
      });
      sync();
    }
    // Under each group: Rows per page and Prev / Next (the shared page bar). A page is fetched when asked for; the group
    // first draws 20, so a different remembered size loads once.
    function pagerSize() { return window.ManagiraPager ? ManagiraPager.savedSize('graduate', 20) : 20; }
    function bindMore(group) {
      const host = group.querySelector('[data-gp-pager]');
      if (!host || host.dataset.bound || !window.ManagiraPager) return;
      host.dataset.bound = '1';
      const searchBox = document.querySelector('[data-gp-search]');
      let first = true;
      const pager = ManagiraPager.create({
        mount: host, key: 'graduate', total: Number(host.dataset.gpTotal) || 0, label: 'Students in ' + (group.querySelector('.gp-group__name') || { textContent: 'this group' }).textContent.trim(),
        onChange: (st) => {
          if (first) { first = false; if (st.size === 20 && st.page === 1) return; }
          const q = searchBox ? searchBox.value.trim() : '';
          lazyFetch('group=' + encodeURIComponent(group.dataset.gpGroup) + '&offset=' + (st.from ? st.from - 1 : 0) + '&limit=' + st.size + (q ? '&q=' + encodeURIComponent(q) : '')).then((d) => {
            const tbody = group.querySelector('.gp-table tbody');
            if (!tbody) return;
            tbody.innerHTML = d.html;
            tbody.querySelectorAll('.gp-pick').forEach((box) => { if (chosen.has(box.value)) box.checked = true; });
            tbody.querySelectorAll('.gp-avatar img').forEach((img) => { img.addEventListener('error', () => { img.parentElement.textContent = img.parentElement.dataset.initials || '?'; }, { once: true }); });
            sync();
          }).catch(() => {});
        },
      });
      pager.refresh();
    }
    function lazyFetch(params) {
      return fetch(lazyUrl + (lazyUrl.indexOf('?') >= 0 ? '&' : '?') + params, { credentials: 'same-origin', headers: { Accept: 'application/json' } })
        .then((r) => r.json()).then((d) => { if (!d.success) throw new Error(d.error || 'failed'); return d; });
    }
    function fetchRows(params) {
      return fetch(lazyUrl + (lazyUrl.indexOf('?') >= 0 ? '&' : '?') + params, { credentials: 'same-origin', headers: { Accept: 'application/json' } })
        .then((r) => r.json()).then((d) => { if (!d.success) throw new Error(d.error || 'failed'); return d.groups; });
    }
    function loadGroup(group) {
      const body = bodyOf(group);
      if (!lazyUrl || !body || body.dataset.gpLoaded === '1' || body.dataset.gpBusy) return Promise.resolve();
      body.dataset.gpBusy = '1';
      body.innerHTML = '<div class="gp-group__empty" role="status">Loading…</div>';
      return fetchRows('group=' + encodeURIComponent(group.dataset.gpGroup) + '&limit=' + pagerSize()).then((groups) => {
        fill(group, groups[0] ? groups[0].html : '', false);
      }).catch(() => { body.innerHTML = '<div class="gp-group__empty">These students could not be loaded. Close and open the group to try again.</div>'; delete body.dataset.gpLoaded; })
        .then(() => { delete body.dataset.gpBusy; });
    }
    if (lazyUrl) {
      form.querySelectorAll('.gp-group').forEach((group) => bindMore(group));
      form.querySelectorAll('.gp-group').forEach((group) => group.addEventListener('toggle', () => { if (group.open) loadGroup(group); }));
      // A group's select-all on a group not drawn yet draws it first.
      form.addEventListener('click', (e) => {
        const all = e.target.closest && e.target.closest('.gp-pick-all');
        if (all) e.stopPropagation();
      }, true);
    }
    // The select-all box sits in the <summary>: don't toggle the group when clicked.
    form.querySelectorAll('.gp-pick-all').forEach((all) => {
      all.addEventListener('click', (e) => e.stopPropagation());
    });

    document.querySelectorAll('[data-gp-clear]').forEach((btn) => btn.addEventListener('click', () => {
      picks().forEach((box) => { box.checked = false; });
      chosen.clear();
      sync();
    }));

    document.querySelectorAll('[data-gp-open]').forEach((btn) => btn.addEventListener('click', () => {
      const n = selected().length;
      if (!n) return;
      if (dialogTitle) dialogTitle.textContent = dialogTitle.dataset.template.replace('{n}', n).replace('{s}', n === 1 ? '' : 's');
      if (dialog && typeof dialog.showModal === 'function') dialog.showModal();
      else if (window.confirm(dialogTitle ? dialogTitle.textContent : 'Continue?')) form.submit();
    }));
    document.querySelectorAll('[data-gp-cancel]').forEach((btn) => btn.addEventListener('click', () => dialog && dialog.close()));
    document.querySelectorAll('[data-gp-confirm]').forEach((btn) => btn.addEventListener('click', () => {
      // Required choices inside the dialog (reason, agreement) must be made first.
      if (typeof form.reportValidity === 'function' && !form.reportValidity()) return;
      btn.disabled = true;
      btn.textContent = 'Saving…';
      if (lazyUrl) {
        // Ticked students whose rows aren't on the page go with the form as hidden fields.
        const present = new Set(Array.from(form.querySelectorAll('.gp-pick:checked')).map((b) => b.value));
        chosen.forEach((id) => {
          if (present.has(id)) return;
          const hidden = document.createElement('input');
          hidden.type = 'hidden'; hidden.name = 'students'; hidden.value = id;
          form.appendChild(hidden);
        });
      }
      form.submit();
    }));

    // Search across every group by name or student ID.
    const search = document.querySelector('[data-gp-search]');
    const noResults = document.querySelector('[data-gp-no-results]');
    if (search && lazyUrl) {
      let timer = null, token = 0;
      search.addEventListener('input', () => {
        clearTimeout(timer);
        timer = setTimeout(() => {
          const q = search.value.trim();
          const mine = ++token;
          const groups = Array.from(form.querySelectorAll('.gp-group'));
          if (!q) {
            // Back to the plain list: groups that showed only matches go back to unloaded, the open ones reload.
            groups.forEach((group) => {
              group.hidden = false;
              const body = bodyOf(group);
              if (body && body.dataset.gpFiltered === '1') { delete body.dataset.gpLoaded; delete body.dataset.gpFiltered; body.innerHTML = '<div class="gp-group__empty" data-gp-placeholder>Open to see the students…</div>'; if (group.open) loadGroup(group); }
            });
            if (noResults) noResults.classList.remove('is-visible');
            return sync();
          }
          fetchRows('q=' + encodeURIComponent(q) + '&limit=' + pagerSize()).then((found) => {
            if (mine !== token) return;
            const hits = new Map(found.map((g) => [g.key, g]));
            groups.forEach((group) => {
              const hit = hits.get(group.dataset.gpGroup);
              group.hidden = !hit;
              if (hit) { fill(group, hit.html, true); group.open = true; }
            });
            if (noResults) noResults.classList.toggle('is-visible', !found.length);
            sync();
          }).catch(() => {});
        }, 250);
      });
    } else if (search) {
      search.addEventListener('input', () => {
        const q = search.value.trim().toLowerCase();
        let anyVisible = false;
        form.querySelectorAll('.gp-group').forEach((group) => {
          let groupHits = 0;
          group.querySelectorAll('tbody tr[data-search]').forEach((row) => {
            const hit = !q || row.dataset.search.includes(q);
            row.hidden = !hit;
            if (hit) groupHits += 1;
          });
          group.hidden = Boolean(q) && groupHits === 0;
          if (q && groupHits) group.open = true;
          if (!group.hidden) anyVisible = true;
        });
        if (noResults) noResults.classList.toggle('is-visible', !anyVisible);
        sync();
      });
    }

    // Photos that fail to load fall back to the student's initials.
    document.querySelectorAll('.gp-avatar img').forEach((img) => {
      const fallback = () => { img.parentElement.textContent = img.parentElement.dataset.initials || '?'; };
      if (img.complete && img.naturalWidth === 0) fallback();
      else img.addEventListener('error', fallback, { once: true });
    });

    sync();
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
  window.addEventListener('spa:pageLoaded', init);
})();
