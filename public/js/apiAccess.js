// Small helpers shared by the Service Accounts and Access Tokens pages:
// JSON requests, the right-side drawers, row action menus, confirm boxes,
// search and copy buttons. Safe to load more than once.
(function () {
  if (window.ApiAccessUI) return;

  async function request(url, options, button) {
    if (button) button.disabled = true;
    try {
      const res = await fetch(url, { credentials: 'same-origin', headers: { Accept: 'application/json', 'Content-Type': 'application/json' }, ...options });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || data.success === false) return { ok: false, message: data.message || 'Something went wrong. Try again.' };
      return { ok: true, data };
    } catch (_e) {
      return { ok: false, message: 'Could not reach the server. Check your connection and try again.' };
    } finally {
      if (button) button.disabled = false;
    }
  }
  const post = (url, body, button) => request(url, { method: 'POST', body: JSON.stringify(body || {}) }, button);
  const get = (url) => request(url, { method: 'GET' });

  function drawer(overlay, options) {
    const opts = options || {};
    let lastFocus = null;
    const close = () => {
      overlay.classList.remove('is-open');
      overlay.setAttribute('aria-hidden', 'true');
      if (lastFocus) lastFocus.focus();
      if (opts.onClose) opts.onClose();
    };
    overlay.addEventListener('click', (event) => {
      if (event.target === overlay || event.target.closest('[data-close]')) close();
    });
    document.addEventListener('keydown', (event) => {
      if (event.key === 'Escape' && overlay.classList.contains('is-open')) close();
    });
    return {
      open(focusEl) {
        lastFocus = document.activeElement;
        overlay.classList.add('is-open');
        overlay.setAttribute('aria-hidden', 'false');
        if (focusEl) setTimeout(() => focusEl.focus(), 50);
      },
      close,
    };
  }

  function rowMenu(table, menu, onAction) {
    if (!table || !menu) return;
    let row = null;
    const hide = () => { menu.hidden = true; row = null; };
    table.addEventListener('click', (event) => {
      const button = event.target.closest('[data-menu]');
      if (!button) return;
      event.stopPropagation();
      if (!menu.hidden && row === button.closest('tr')) return hide();
      row = button.closest('tr');
      const box = button.getBoundingClientRect();
      const host = menu.offsetParent ? menu.offsetParent.getBoundingClientRect() : { top: 0, left: 0 };
      menu.hidden = false;
      menu.style.top = (box.bottom - host.top + 4) + 'px';
      menu.style.left = Math.max(8, box.right - host.left - menu.offsetWidth) + 'px';
    });
    menu.addEventListener('click', (event) => {
      const item = event.target.closest('[data-action]');
      if (!item || !row) return;
      const target = row;
      hide();
      onAction(item.dataset.action, target);
    });
    document.addEventListener('click', (event) => { if (!menu.hidden && !menu.contains(event.target)) hide(); });
    document.addEventListener('keydown', (event) => { if (event.key === 'Escape') hide(); });
  }

  function confirmBox(title, text, okLabel) {
    return new Promise((resolve) => {
      const dialog = document.createElement('div');
      dialog.className = 'aa-confirm';
      dialog.setAttribute('role', 'alertdialog');
      dialog.setAttribute('aria-modal', 'true');
      dialog.innerHTML = '<div class="aa-confirm__box"><h2></h2><p></p><div class="aa-confirm__actions">'
        + '<button type="button" class="aa-btn aa-btn--ghost" data-no>Cancel</button>'
        + '<button type="button" class="aa-btn aa-btn--danger" data-yes></button></div></div>';
      dialog.querySelector('h2').textContent = title;
      dialog.querySelector('p').textContent = text || '';
      dialog.querySelector('[data-yes]').textContent = okLabel || 'Continue';
      const done = (value) => { dialog.remove(); document.removeEventListener('keydown', onKey); resolve(value); };
      const onKey = (event) => { if (event.key === 'Escape') done(false); };
      dialog.addEventListener('click', (event) => {
        if (event.target === dialog || event.target.closest('[data-no]')) done(false);
        if (event.target.closest('[data-yes]')) done(true);
      });
      document.addEventListener('keydown', onKey);
      document.body.appendChild(dialog);
      dialog.querySelector('[data-no]').focus();
    });
  }

  function alertBox(message) {
    return confirmBox('Something went wrong', message, 'OK');
  }

  function search(input, table) {
    if (!input || !table) return;
    input.addEventListener('input', () => {
      const q = input.value.trim().toLowerCase();
      table.querySelectorAll('tbody tr').forEach((tr) => {
        const text = tr.dataset.search || tr.textContent.toLowerCase();
        tr.hidden = Boolean(q) && !text.includes(q);
      });
    });
  }

  function copyButtons(root) {
    root.addEventListener('click', async (event) => {
      const button = event.target.closest('[data-copy]');
      if (!button) return;
      const source = root.querySelector(button.dataset.copy);
      if (!source) return;
      const text = ('value' in source ? source.value : source.textContent).trim();
      try {
        await navigator.clipboard.writeText(text);
      } catch (_e) {
        if ('select' in source) {
          source.select();
        } else {
          const range = document.createRange();
          range.selectNodeContents(source);
          const selection = window.getSelection();
          selection.removeAllRanges();
          selection.addRange(range);
        }
        document.execCommand('copy');
      }
      const label = button.textContent;
      button.textContent = 'Copied';
      setTimeout(() => { button.textContent = label; }, 1600);
    });
  }

  window.ApiAccessUI = { post, get, drawer, rowMenu, confirm: confirmBox, alert: alertBox, search, copyButtons };
})();
