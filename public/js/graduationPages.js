// Close Graduation Year Group + Archived Students: search, per-group select
// all, the selection bar and the confirm dialog. Markup hooks are data-gp-*.
(function () {
  function init() {
    const form = document.querySelector('[data-gp-form]');
    if (!form || form.dataset.gpReady === '1') return;
    form.dataset.gpReady = '1';

    const picks = () => Array.from(form.querySelectorAll('.gp-pick:not(:disabled)'));
    const bar = document.querySelector('[data-gp-actionbar]');
    const countEl = document.querySelector('[data-gp-count]');
    const dialog = document.querySelector('[data-gp-dialog]');
    const dialogTitle = document.querySelector('[data-gp-dialog-title]');
    const noun = form.dataset.gpNoun || 'student';

    function selected() { return picks().filter((box) => box.checked); }

    function syncGroup(group) {
      const all = group.querySelector('.gp-pick-all');
      if (!all) return;
      const boxes = Array.from(group.querySelectorAll('.gp-pick:not(:disabled)')).filter((b) => !b.closest('tr').hidden);
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
          if (!box.closest('tr').hidden) box.checked = all.checked;
        });
      }
      sync();
    });
    // The select-all box sits in the <summary>: don't toggle the group when clicked.
    form.querySelectorAll('.gp-pick-all').forEach((all) => {
      all.addEventListener('click', (e) => e.stopPropagation());
    });

    document.querySelectorAll('[data-gp-clear]').forEach((btn) => btn.addEventListener('click', () => {
      picks().forEach((box) => { box.checked = false; });
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
      form.submit();
    }));

    // Search across every group by name or student ID.
    const search = document.querySelector('[data-gp-search]');
    const noResults = document.querySelector('[data-gp-no-results]');
    if (search) {
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
