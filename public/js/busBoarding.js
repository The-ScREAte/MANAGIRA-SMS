// Parents: a pop-up when a child boards, and "not coming" on the child's card.
// Teachers: Coming or Not coming beside each rider on the class's Transportation tab.
(function () {
  'use strict';
  if (window.BusBoarding) return;
  window.BusBoarding = true;

  var PARENT_EVERY_MS = 20000;
  var CLASS_EVERY_MS = 60000;
  var POPUP_MS = 12000;
  var OLDEST_POPUP_MS = 30 * 60 * 1000;
  var SEEN_KEY = 'managira-boarding-seen';

  function pad(n) { return n < 10 ? '0' + n : String(n); }
  function today() { var d = new Date(); return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()); }
  function clock(at) { try { return new Date(at).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }); } catch (_) { return ''; } }
  function send(url, body) {
    return fetch(url, {
      method: body ? 'POST' : 'GET',
      credentials: 'same-origin',
      headers: body ? { 'Content-Type': 'application/json', Accept: 'application/json', 'X-Requested-With': 'XMLHttpRequest' } : { Accept: 'application/json' },
      body: body ? JSON.stringify(body) : undefined
    }).then(function (res) {
      return res.json().catch(function () { return null; }).then(function (json) {
        if (!res.ok || !json || !json.success) throw new Error((json && json.message) || 'Something went wrong. Try again.');
        return json;
      });
    });
  }

  /* ---------- the pop-up ---------- */
  var ICON_OK = '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 13l4 4L19 7"/></svg>';
  var ICON_NO = '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18"/></svg>';
  function popupBox() {
    var box = document.getElementById('bb-popups');
    if (!box) {
      box = document.createElement('div');
      box.id = 'bb-popups';
      box.className = 'bb-popups';
      box.setAttribute('role', 'status');
      document.body.appendChild(box);
    }
    return box;
  }
  function popup(title, detail, tone) {
    var card = document.createElement('div');
    card.className = 'bb-popup bb-popup--' + (tone || 'ok');
    var icon = document.createElement('span');
    icon.className = 'bb-popup__icon';
    icon.innerHTML = tone === 'no' ? ICON_NO : ICON_OK;
    var text = document.createElement('div');
    text.className = 'bb-popup__text';
    var strong = document.createElement('strong');
    strong.textContent = title;
    text.appendChild(strong);
    if (detail) {
      var small = document.createElement('small');
      small.textContent = detail;
      text.appendChild(small);
    }
    var close = document.createElement('button');
    close.type = 'button';
    close.className = 'bb-popup__x';
    close.setAttribute('aria-label', 'Close');
    close.innerHTML = ICON_NO;
    close.addEventListener('click', function () { card.remove(); });
    card.appendChild(icon);
    card.appendChild(text);
    card.appendChild(close);
    popupBox().appendChild(card);
    // A child who didn't board stays on screen until it's closed.
    if (tone !== 'no') setTimeout(function () { card.remove(); }, POPUP_MS);
  }
  function loadSeen() { try { return JSON.parse(localStorage.getItem(SEEN_KEY) || '[]'); } catch (_) { return []; } }
  function saveSeen(list) { try { localStorage.setItem(SEEN_KEY, JSON.stringify(list.slice(-100))); } catch (_) { /* this visit only */ } }
  function names(list) {
    if (list.length > 3) return list.length + ' children';
    if (list.length < 2) return list[0] || '';
    return list.slice(0, -1).join(', ') + ' and ' + list[list.length - 1];
  }
  // Children boarding together are one pop-up.
  function showNewEvents(events) {
    var seen = loadSeen();
    var groups = {};
    var now = Date.now();
    events.forEach(function (event) {
      var key = event.id + ':' + (event.boarded ? 1 : 0);
      if (seen.indexOf(key) >= 0) return;
      seen.push(key);
      if (now - new Date(event.at).getTime() > OLDEST_POPUP_MS) return;
      var group = (event.boarded ? 'y' : 'n') + event.stop + clock(event.at);
      (groups[group] = groups[group] || { boarded: event.boarded, stop: event.stop, at: event.at, names: [] }).names.push(event.name);
    });
    saveSeen(seen);
    Object.keys(groups).forEach(function (key) {
      var group = groups[key];
      var who = names(group.names);
      popup(group.boarded ? who + ' boarded' : who + ' did not board', [group.stop, clock(group.at)].filter(Boolean).join(' · '), group.boarded ? 'ok' : 'no');
    });
  }

  /* ---------- parents ---------- */
  var parent = { notRiding: {}, latest: {}, timer: 0, stopped: false, ready: false };
  function latestByStudent(events) {
    var latest = {};
    events.forEach(function (event) { latest[event.studentId] = event; });
    return latest;
  }
  function syncParentButtons() {
    document.querySelectorAll('[data-riding]').forEach(function (button) {
      var id = button.getAttribute('data-riding');
      var event = parent.latest[id];
      var off = Boolean(parent.notRiding[id]);
      button.classList.toggle('is-off', off && !event);
      button.classList.toggle('is-boarded', Boolean(event && event.boarded));
      button.classList.toggle('is-missed', Boolean(event && !event.boarded));
      button.disabled = Boolean(event);
      button.textContent = event
        ? (event.boarded ? 'Boarded ' + clock(event.at) : 'Did not board')
        : (off ? 'Not coming today' : 'Not coming');
      button.setAttribute('aria-pressed', String(off));
    });
  }
  function applyParent(result) {
    parent.notRiding = {};
    result.notRiding.forEach(function (row) { parent.notRiding[row.studentId] = row.by; });
    parent.latest = latestByStudent(result.events);
    syncParentButtons();
    showNewEvents(result.events);
    if (!result.riders) { parent.stopped = true; clearInterval(parent.timer); }
  }
  function pollParent() {
    if (parent.stopped || document.visibilityState !== 'visible') return;
    send('/transportation/riding/mine?date=' + today()).then(applyParent).catch(function () { /* the next round tries again */ });
  }
  function startParent() {
    if (parent.ready) return;
    parent.ready = true;
    pollParent();
    parent.timer = setInterval(pollParent, PARENT_EVERY_MS);
    document.addEventListener('visibilitychange', pollParent);
  }
  function closeMenus() {
    document.querySelectorAll('.bb-menu').forEach(function (menu) { menu.remove(); });
    parent.menuFor = null;
  }
  function setParentRiding(studentId, coming) {
    return send('/transportation/riding/mine', { studentId: Number(studentId), date: today(), coming: coming }).then(function () {
      if (coming) delete parent.notRiding[studentId]; else parent.notRiding[studentId] = 'parent';
      syncParentButtons();
    });
  }
  function openParentMenu(button) {
    var menu = document.createElement('div');
    menu.className = 'bb-menu';
    menu.setAttribute('role', 'menu');
    menu.innerHTML = '<button type="button" role="menuitem" data-riding-today>Not coming today</button><button type="button" role="menuitem" data-riding-stop>Stop using the bus</button>';
    // On the page itself, so the next child's card can't cover it.
    document.body.appendChild(menu);
    var at = button.getBoundingClientRect();
    menu.style.left = Math.max(8, Math.min(at.left, window.innerWidth - menu.offsetWidth - 8)) + 'px';
    menu.style.top = (at.bottom + 4 + menu.offsetHeight > window.innerHeight - 8 ? Math.max(8, at.top - menu.offsetHeight - 4) : at.bottom + 4) + 'px';
    parent.menuFor = button.getAttribute('data-riding');
    menu.addEventListener('click', function (event) {
      var id = button.getAttribute('data-riding');
      var name = button.getAttribute('data-riding-name') || 'Your child';
      if (event.target.closest('[data-riding-today]')) {
        closeMenus();
        setParentRiding(id, false).then(function () { popup(name + ' isn’t coming today', 'The driver and teacher can see this.'); }).catch(function (error) { popup(error.message, '', 'no'); });
      } else if (event.target.closest('[data-riding-stop]')) {
        closeMenus();
        send('/transportation/riding/mine/stop', { studentId: Number(id) }).then(function () { popup('Request sent', 'The transport team will follow up.'); }).catch(function (error) { popup(error.message, '', 'no'); });
      }
    });
  }
  document.addEventListener('click', function (event) {
    var target = event.target.closest ? event.target : null;
    var button = target && target.closest('[data-riding]');
    if (!button) { if (target && !target.closest('.bb-menu')) closeMenus(); return; }
    event.preventDefault();
    var id = button.getAttribute('data-riding');
    var open = parent.menuFor === id;
    closeMenus();
    if (parent.notRiding[id]) {
      setParentRiding(id, true).catch(function (error) { popup(error.message, '', 'no'); });
    } else if (!open) {
      openParentMenu(button);
    }
  });
  window.addEventListener('scroll', closeMenus, true);

  /* ---------- teachers ---------- */
  var classes = { panel: null, classId: '', notRiding: {}, latest: {}, timer: 0 };
  function syncClassButtons() {
    if (!classes.panel) return;
    classes.panel.querySelectorAll('[data-coming]').forEach(function (button) {
      var id = button.getAttribute('data-coming');
      var event = classes.latest[id];
      var by = classes.notRiding[id];
      button.disabled = Boolean(event);
      button.setAttribute('aria-pressed', String(!by));
      button.className = 'tp-coming' + (event ? (event.boarded ? ' is-boarded' : ' is-missed') : (by ? ' is-off' : ''));
      button.textContent = event ? (event.boarded ? 'Boarded' : 'Didn’t board') : (by ? 'Not coming' : 'Coming');
      button.title = event ? [event.stop, clock(event.at)].filter(Boolean).join(' · ') : (by === 'parent' ? 'Set by a parent' : '');
    });
  }
  function pollClass() {
    if (!classes.panel || !document.body.contains(classes.panel) || document.visibilityState !== 'visible' || !classes.panel.offsetParent) return;
    send('/transportation/class/' + encodeURIComponent(classes.classId) + '/riding?date=' + today()).then(function (result) {
      classes.notRiding = {};
      result.notRiding.forEach(function (row) { classes.notRiding[row.studentId] = row.by; });
      classes.latest = latestByStudent(result.events);
      syncClassButtons();
    }).catch(function () { /* the next round tries again */ });
  }
  function bindClass() {
    var panel = document.querySelector('[data-class-riding]');
    classes.panel = panel;
    clearInterval(classes.timer);
    if (!panel) return;
    classes.classId = panel.getAttribute('data-class-riding');
    pollClass();
    classes.timer = setInterval(pollClass, CLASS_EVERY_MS);
    if (panel.dataset.ridingBound) return;
    panel.dataset.ridingBound = '1';
    if (window.IntersectionObserver) {
      new IntersectionObserver(function (entries) { if (entries[0].isIntersecting) pollClass(); }).observe(panel);
    }
    panel.addEventListener('click', function (event) {
      var button = event.target.closest && event.target.closest('[data-coming]');
      if (!button || button.disabled) return;
      var id = button.getAttribute('data-coming');
      var coming = Boolean(classes.notRiding[id]);
      if (coming) delete classes.notRiding[id]; else classes.notRiding[id] = 'staff';
      syncClassButtons();
      send('/transportation/class/' + encodeURIComponent(classes.classId) + '/riding', { studentId: Number(id), date: today(), coming: coming }).catch(function () {
        if (coming) classes.notRiding[id] = 'staff'; else delete classes.notRiding[id];
        syncClassButtons();
      });
    });
  }

  /* ---------- begin ---------- */
  function begin() {
    if (document.querySelector('script[data-boarding-parent]')) startParent();
    syncParentButtons();
    bindClass();
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', begin);
  else begin();
  window.addEventListener('spa:pageLoaded', begin);
})();
