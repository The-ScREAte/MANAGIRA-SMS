// Side menus each person can put in their own order: press the arrange
// button, drag items (mouse or touch), press it again to save. The order is
// saved to the person's account (/common/ui-preferences/menu-order) and kept
// on the device too, so it shows at once on the next visit.
//   <button class="menu-arrange-btn" data-arrange-toggle="management"></button>
//   <ul data-arrange-menu="management" data-arrange-owner="63-240">
// Optional data-arrange-order='["a","b"]' gives the saved order from the server.
(function () {
  var ICON_ARRANGE = '<path d="M7 4v16M3 8l4-4 4 4M17 20V4M13 16l4 4 4-4"/>';
  var ICON_DONE = '<path d="M5 12l5 5L20 7"/>';
  var ICON_HANDLE = '<svg viewBox="0 0 16 16" fill="currentColor" aria-hidden="true"><circle cx="5.5" cy="3.5" r="1.3"/><circle cx="10.5" cy="3.5" r="1.3"/><circle cx="5.5" cy="8" r="1.3"/><circle cx="10.5" cy="8" r="1.3"/><circle cx="5.5" cy="12.5" r="1.3"/><circle cx="10.5" cy="12.5" r="1.3"/></svg>';
  var slug = function (s) { return String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60); };
  var same = function (a, b) { return (a || []).join('\n') === (b || []).join('\n'); };

  function init(list) {
    if (!list || list.dataset.arrangeReady) return;
    var menu = list.dataset.arrangeMenu;
    var btn = document.querySelector('[data-arrange-toggle="' + menu + '"]');
    if (!btn) return;
    list.dataset.arrangeReady = '1';
    var store = 'menu-order:' + menu + ':' + (list.dataset.arrangeOwner || '');
    var original = Array.prototype.slice.call(list.children);
    var labels = original.filter(function (li) { return li.classList.contains('nav-section-label'); });
    var arranging = false;

    // A stable key for every item; items opening the same section are told apart by their label.
    var heads = original.map(function (li) {
      var link = li.querySelector(':scope > .nav-link');
      if (!link) return null;
      var key = link.dataset.navKey || (link.id === 'subjects-section-toggle' ? 'grading' : '') || link.dataset.section || slug(link.getAttribute('href')) || slug(link.id);
      return key ? { li: li, key: slug(key), label: slug(link.textContent) } : null;
    }).filter(Boolean);
    var counts = {};
    heads.forEach(function (h) { counts[h.key] = (counts[h.key] || 0) + 1; });
    heads.forEach(function (h) { h.li.dataset.arrangeKey = counts[h.key] > 1 ? (h.key + '-' + h.label).slice(0, 60) : h.key; });

    // Each item, with anything listed under it (e.g. Grading's subjects).
    function groups() {
      var out = [];
      Array.prototype.forEach.call(list.children, function (li) {
        if (li.dataset.arrangeKey) out.push({ key: li.dataset.arrangeKey, nodes: [li] });
        else if (li.classList.contains('nav-section-children') && out.length) out[out.length - 1].nodes.push(li);
      });
      return out;
    }
    var defaultOrder = groups().map(function (g) { return g.key; });
    function currentOrder() { return groups().map(function (g) { return g.key; }); }
    function isCustom(order) { return !same(order, defaultOrder); }
    // Section headings only make sense in the school's own order.
    function showLabels() {
      var custom = isCustom(currentOrder());
      list.classList.toggle('is-custom-order', custom);
      labels.forEach(function (l) { l.hidden = custom; });
    }
    function apply(order) {
      var byKey = {};
      groups().forEach(function (g) { byKey[g.key] = g; });
      var keys = (order || []).filter(function (k) { return byKey[k]; });
      defaultOrder.forEach(function (k) { if (keys.indexOf(k) < 0) keys.push(k); });
      if (!isCustom(keys)) original.forEach(function (n) { list.appendChild(n); });
      else keys.forEach(function (k) { byKey[k].nodes.forEach(function (n) { list.appendChild(n); }); });
      showLabels();
    }
    function readLocal() { try { return JSON.parse(localStorage.getItem(store) || 'null'); } catch (e) { return null; } }
    function writeLocal(order) { try { if (order && order.length) localStorage.setItem(store, JSON.stringify(order)); else localStorage.removeItem(store); } catch (e) {} }

    // Start in the saved order: from the page when it has it, otherwise this
    // device's copy at once and then the account's (hub pages can be served from cache).
    var fromPage = null;
    try { fromPage = list.dataset.arrangeOrder ? JSON.parse(list.dataset.arrangeOrder) : null; } catch (e) { fromPage = null; }
    if (Array.isArray(fromPage)) { apply(fromPage); writeLocal(fromPage); }
    else {
      var local = readLocal();
      if (Array.isArray(local)) apply(local);
      // On a device without its own copy the page has already opened the
      // school's first item; if the person hasn't done anything yet, open their top item instead.
      var touched = false;
      var touch = function () { touched = true; };
      document.addEventListener('pointerdown', touch, { once: true, capture: true });
      document.addEventListener('keydown', touch, { once: true, capture: true });
      fetch('/common/ui-preferences/menu-order?menu=' + encodeURIComponent(menu), { credentials: 'same-origin', headers: { Accept: 'application/json' } })
        .then(function (r) { return r.ok ? r.json() : null; })
        .then(function (j) {
          if (!j || !j.success || arranging) return;
          var order = Array.isArray(j.order) ? j.order : [];
          if (same(order, local)) return;
          var before = topItem(list);
          apply(order);
          writeLocal(order);
          var after = topItem(list);
          if (!touched && after && (!before || before.key !== after.key)) {
            var li = list.querySelector('li[data-arrange-key="' + after.key + '"]');
            var link = li && (li.querySelector(':scope > .nav-link[data-embed-url]') || li.querySelector('.nav-sublink[data-embed-url]'));
            if (link) link.click();
          }
        }).catch(function () {});
    }

    function save(order) {
      writeLocal(order);
      fetch('/common/ui-preferences/menu-order', {
        method: 'POST', credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify({ menu: menu, order: order })
      }).catch(function () {});
    }

    // Shown below the menu while arranging, so nothing above it moves.
    var footer = document.createElement('div');
    footer.className = 'menu-arrange-footer';
    footer.hidden = true;
    footer.innerHTML = '<span>Drag the dots to reorder</span><button type="button">Reset</button>';
    list.insertAdjacentElement('afterend', footer);

    // A drag handle beside each item, only while arranging. Lined up with the item's
    // own row, so an open sub-list under it doesn't move the handle.
    function addHandles() {
      groups().forEach(function (g) {
        var li = g.nodes[0];
        var link = li.querySelector(':scope > .nav-link');
        var handle = document.createElement('button');
        handle.type = 'button';
        handle.className = 'menu-arrange-handle';
        handle.setAttribute('aria-label', 'Move ' + (link ? link.textContent.trim().replace(/\s+/g, ' ') : 'item') + ' (use the up and down arrows)');
        handle.innerHTML = ICON_HANDLE;
        if (link) handle.style.top = (link.offsetTop + (link.offsetHeight - 26) / 2) + 'px';
        li.appendChild(handle);
      });
    }
    function removeHandles() {
      Array.prototype.forEach.call(list.querySelectorAll('.menu-arrange-handle'), function (h) { h.remove(); });
    }

    btn.type = 'button';
    btn.classList.add('menu-arrange-btn');
    btn.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"></svg>';
    function setArranging(on) {
      arranging = on;
      list.classList.toggle('is-arranging', on);
      btn.classList.toggle('is-on', on);
      btn.setAttribute('aria-pressed', on ? 'true' : 'false');
      btn.setAttribute('aria-label', on ? 'Done arranging' : 'Arrange this menu');
      btn.title = on ? 'Done' : 'Arrange this menu';
      btn.querySelector('svg').innerHTML = on ? ICON_DONE : ICON_ARRANGE;
      footer.hidden = !on;
      if (on) addHandles(); else removeHandles();
    }
    setArranging(false);
    btn.addEventListener('click', function () {
      if (arranging) {
        var order = currentOrder();
        apply(order);
        save(isCustom(order) ? order : null);
      }
      setArranging(!arranging);
    });
    footer.querySelector('button').addEventListener('click', function () {
      apply(null);
      save(null);
      setArranging(false);
    });

    // While arranging, items don't open.
    list.addEventListener('click', function (e) {
      if (!arranging) return;
      e.preventDefault();
      e.stopPropagation();
    }, true);

    // The top-level item under a point (an item's sub-list counts as the item).
    function itemAt(x, y) {
      var hit = document.elementFromPoint(x, y);
      var li = hit && hit.closest('li');
      while (li && li.parentElement !== list) li = li.parentElement.closest('li');
      if (li && li.classList.contains('nav-section-children')) li = li.previousElementSibling;
      return li && li.dataset.arrangeKey ? li : null;
    }
    function scrollParent(el) {
      for (var n = el.parentElement; n && n !== document.body; n = n.parentElement) {
        var oy = getComputedStyle(n).overflowY;
        if ((oy === 'auto' || oy === 'scroll') && n.scrollHeight > n.clientHeight) return n;
      }
      return null;
    }

    // Drag with mouse or touch. Items are moved in place, so headings and
    // everything else stay where they are until the order is saved.
    var dragging = null;
    var scroller = null;
    list.addEventListener('pointerdown', function (e) {
      if (!arranging || (e.pointerType === 'mouse' && e.button !== 0)) return;
      var handle = e.target.closest && e.target.closest('.menu-arrange-handle');
      if (!handle) return;
      e.preventDefault();
      var li = handle.parentElement;
      dragging = li;
      scroller = scrollParent(list);
      li.classList.add('is-dragging');
      try { list.setPointerCapture(e.pointerId); } catch (err) {}
    });
    list.addEventListener('pointermove', function (e) {
      if (!dragging) return;
      e.preventDefault();
      if (scroller) {
        var box = scroller.getBoundingClientRect();
        if (e.clientY < box.top + 36) scroller.scrollTop -= 10;
        else if (e.clientY > box.bottom - 36) scroller.scrollTop += 10;
      }
      var over = itemAt(e.clientX, e.clientY);
      if (!over || over === dragging) return;
      var gs = groups();
      var from = gs.findIndex(function (g) { return g.nodes[0] === dragging; });
      var to = gs.findIndex(function (g) { return g.nodes[0] === over; });
      if (from < 0 || to < 0) return;
      var moving = gs[from].nodes;
      var anchor = from < to ? gs[to].nodes[gs[to].nodes.length - 1].nextSibling : gs[to].nodes[0];
      moving.forEach(function (n) { list.insertBefore(n, anchor); });
    });
    function endDrag() {
      if (dragging) dragging.classList.remove('is-dragging');
      dragging = null;
      scroller = null;
    }
    // The handles also work from the keyboard.
    list.addEventListener('keydown', function (e) {
      var handle = arranging && e.target.closest && e.target.closest('.menu-arrange-handle');
      if (!handle || (e.key !== 'ArrowUp' && e.key !== 'ArrowDown')) return;
      e.preventDefault();
      var gs = groups();
      var from = gs.findIndex(function (g) { return g.nodes[0] === handle.parentElement; });
      var to = from + (e.key === 'ArrowUp' ? -1 : 1);
      if (from < 0 || to < 0 || to >= gs.length) return;
      var anchor = to > from ? gs[to].nodes[gs[to].nodes.length - 1].nextSibling : gs[to].nodes[0];
      gs[from].nodes.forEach(function (n) { list.insertBefore(n, anchor); });
      handle.focus();
    });
    list.addEventListener('pointerup', endDrag);
    list.addEventListener('pointercancel', endDrag);
  }

  // The top item of a menu in the person's own order, which a plain visit
  // opens first. Null in the school's default order, or when the address
  // already asks for a particular section.
  function topItem(list) {
    if (!list || !list.classList.contains('is-custom-order') || /[?&](section|panel)=/.test(location.search)) return null;
    var li = Array.prototype.find.call(list.children, function (n) { return n.dataset.arrangeKey && !n.hidden; });
    if (!li) return null;
    var link = li.querySelector(':scope > .nav-link');
    var target = link && link.dataset.embedUrl ? link : li.querySelector('.nav-sublink[data-embed-url]');
    return {
      key: li.dataset.arrangeKey,
      section: (link && link.dataset.section) || '',
      url: target ? target.dataset.embedUrl : '',
      label: target ? (target.dataset.embedLabel || '') : ''
    };
  }

  function initAll() { document.querySelectorAll('[data-arrange-menu]').forEach(init); }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', initAll);
  else initAll();
  window.ManagiraMenuArrange = { init: init, initAll: initAll, topItem: topItem };
})();
