/* One Bus button on each child's card (parent dashboard, feature portal_requests):
 *   <button data-bus-menu="123" data-bus-menu-name="Ama" data-bus-snapshot="{...}" [data-bus-boarding]>
 * opens a small menu: Track the bus (public/js/busTracker.js), and where the school has boarding
 * (public/js/busBoarding.js, window.BusBoarding) Not coming today / Riding today after all and Stop
 * using the bus. The driver's screen and the class see "Not coming" (transport_not_riding).
 */
(function () {
  'use strict';
  if (window.__managiraBusMenu) return;
  window.__managiraBusMenu = true;
  var open = null;

  function close() {
    if (open) { open.menu.remove(); open.button.setAttribute('aria-expanded', 'false'); }
    open = null;
  }
  function item(label, action, hint) {
    var b = document.createElement('button');
    b.type = 'button';
    b.setAttribute('role', 'menuitem');
    b.setAttribute('data-act', action);
    var strong = document.createElement('span');
    strong.className = 'bm-label';
    strong.textContent = label;
    b.appendChild(strong);
    if (hint) { var small = document.createElement('small'); small.textContent = hint; b.appendChild(small); }
    return b;
  }
  function show(button) {
    var id = button.getAttribute('data-bus-menu');
    var name = button.getAttribute('data-bus-menu-name') || 'Your child';
    var menu = document.createElement('div');
    menu.className = 'bm-menu';
    menu.setAttribute('role', 'menu');
    menu.appendChild(item('Track the bus', 'track', 'Where it is and when it reaches the stop'));
    var boarding = button.hasAttribute('data-bus-boarding') && window.BusBoarding;
    if (boarding) {
      var state = window.BusBoarding.state(id);
      if (state.boarded || state.missed) {
        var line = document.createElement('p');
        line.className = 'bm-state';
        line.textContent = state.boarded ? name + ' boarded' + (state.at ? ' at ' + state.at : '') + '.' : name + ' didn’t board today.';
        menu.appendChild(line);
      } else if (state.off) {
        menu.appendChild(item('Riding today after all', 'coming', 'Puts ' + name + ' back on today’s list'));
      } else {
        menu.appendChild(item('Not coming today', 'away', 'The driver and teacher will see it'));
      }
      menu.appendChild(item('Stop using the bus', 'stop', 'Asks the transport team'));
    }
    // On the page itself, so the next child's card can't cover it.
    document.body.appendChild(menu);
    // Wide screens zoom the page (globalScale.css): measure what one CSS pixel of `top` moves the
    // menu on screen, and place it in screen pixels under the button.
    menu.style.left = '0px';
    menu.style.top = '100px';
    var probe = menu.getBoundingClientRect();
    var k = probe.top > 0 ? probe.top / 100 : 1;
    var at = button.getBoundingClientRect();
    var w = probe.width, h = probe.height;
    var vw = window.innerWidth, vh = window.innerHeight;
    var left = Math.max(8, Math.min(at.left, vw - w - 8));
    var top = at.bottom + 4 + h > vh - 8 ? Math.max(8, at.top - h - 4) : at.bottom + 4;
    menu.style.left = (left / k) + 'px';
    menu.style.top = (top / k) + 'px';
    button.setAttribute('aria-expanded', 'true');
    open = { menu: menu, button: button };
    menu.addEventListener('click', function (event) {
      var act = event.target.closest('[data-act]');
      if (!act) return;
      var what = act.getAttribute('data-act');
      close();
      if (what === 'track') {
        var snapshot = null;
        try { snapshot = JSON.parse(button.getAttribute('data-bus-snapshot') || 'null'); } catch (_) { snapshot = null; }
        if (window.BusTracker && window.BusTracker.open) window.BusTracker.open(id, { name: name, snapshot: snapshot });
      } else if (what === 'away') window.BusBoarding.notComing(id, name);
      else if (what === 'coming') window.BusBoarding.comingAfterAll(id, name);
      else if (what === 'stop') window.BusBoarding.stop(id);
    });
    var first = menu.querySelector('button');
    if (first) first.focus();
  }

  document.addEventListener('click', function (event) {
    var target = event.target && event.target.closest ? event.target : null;
    var button = target && target.closest('[data-bus-menu]');
    if (!button) { if (open && !(target && target.closest('.bm-menu'))) close(); return; }
    event.preventDefault();
    var same = open && open.button === button;
    close();
    if (!same) show(button);
  });
  document.addEventListener('keydown', function (event) { if (event.key === 'Escape' && open) { var b = open.button; close(); b.focus(); } });
  window.addEventListener('scroll', close, true);
  window.addEventListener('resize', close);
})();
