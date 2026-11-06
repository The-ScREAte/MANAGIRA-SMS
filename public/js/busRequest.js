// Asking for a bus, from the classroom's grey bus icon or the parent portal:
// blank map -> "Request bus for student" -> the student's address -> the closest
// routes and stops -> submit. Any element with data-bus-request="<studentId>" opens it.
(function () {
  'use strict';
  if (window.BusRequest) return;

  var LEAFLET_JS = 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.js';
  var LEAFLET_JS_SRI = 'sha256-20nQCchB9co0qIjJZRGuk2/Z9VM+kNiyxNV1lvTlZBo=';
  var LEAFLET_CSS = 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.css';
  var CLOSE_ICON = '<svg width="18" height="18" viewBox="0 0 20 20" fill="none" aria-hidden="true"><path d="M15 5L5 15M5 5l10 10" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>';
  var EXPAND_ICON = '<svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M14 4h6v6M20 4l-7 7M10 20H4v-6M4 20l7-7"/></svg>';
  var SHRINK_ICON = '<svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M20 10h-6V4M14 10l7-7M4 14h6v6M10 14l-7 7"/></svg>';
  var TICK_ICON = '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg>';

  function esc(value) {
    return String(value == null ? '' : value).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function request(url, body) {
    return fetch(url, {
      method: body ? 'POST' : 'GET',
      credentials: 'same-origin',
      headers: body
        ? { 'Content-Type': 'application/json', Accept: 'application/json', 'X-Requested-With': 'XMLHttpRequest' }
        : { Accept: 'application/json' },
      body: body ? JSON.stringify(body) : undefined
    }).then(function (res) {
      return res.json().catch(function () { return null; }).then(function (json) {
        if (!res.ok || !json || !json.success) throw new Error((json && json.message) || 'Something went wrong. Please try again.');
        return json;
      });
    });
  }
  function loadStyle(href) {
    if (document.querySelector('link[href^="' + href.split('?')[0] + '"]')) return;
    var link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = href;
    document.head.appendChild(link);
  }
  function loadScript(src, integrity) {
    return new Promise(function (resolve, reject) {
      var script = document.createElement('script');
      script.src = src;
      if (integrity) { script.integrity = integrity; script.crossOrigin = ''; }
      script.onload = resolve;
      script.onerror = reject;
      document.head.appendChild(script);
    });
  }
  loadStyle('/css/busRequest.css');
  var mapTools = null;
  function loadMapTools() {
    if (mapTools) return mapTools;
    loadStyle(LEAFLET_CSS);
    mapTools = (window.L ? Promise.resolve() : loadScript(LEAFLET_JS, LEAFLET_JS_SRI))
      .then(function () { return window.ManagiraMaps ? null : loadScript('/js/managiraMaps.js'); })
      .catch(function (error) { mapTools = null; throw error; });
    return mapTools;
  }
  function changed() { document.dispatchEvent(new CustomEvent('busrequest:changed')); }
  function fmtDistance(km, unit) {
    if (unit === 'mi') { var mi = km * 0.621371; return (mi < 10 ? mi.toFixed(1) : Math.round(mi)) + ' mi'; }
    return km < 1 ? Math.round(km * 1000 / 10) * 10 + ' m' : (km < 10 ? km.toFixed(1) : Math.round(km)) + ' km';
  }
  function fmtTime(value) {
    var parts = String(value || '').split(':');
    var hour = parseInt(parts[0], 10);
    if (!isFinite(hour)) return '';
    return (hour % 12 || 12) + ':' + (parts[1] || '00') + (hour < 12 ? ' AM' : ' PM');
  }

  /* ---------- the screen ---------- */
  function open(studentId, trigger) {
    // (styles are loaded with this script, so the screen never opens unstyled)
    var state = {
      studentId: Number(studentId),
      name: (trigger && trigger.getAttribute('data-bus-request-name')) || 'Student',
      firstName: '',
      canCancel: Boolean(trigger && trigger.hasAttribute('data-bus-request-cancel')),
      address: '', lat: null, lng: null, unit: 'km', options: [], picked: null, map: null, pin: null, stopLayer: null, center: null
    };

    var root = document.createElement('div');
    root.className = 'brq';
    root.setAttribute('role', 'dialog');
    root.setAttribute('aria-modal', 'true');
    root.setAttribute('aria-label', 'Request a bus for ' + state.name);
    root.innerHTML = '<div class="brq-sheet">'
      + '<header class="brq-head"><div class="brq-head__text"><h2 class="brq-head__title" id="brq-title"></h2><p class="brq-head__sub" id="brq-sub"></p></div>'
      + '<button type="button" class="brq-icon" data-brq-expand aria-label="Make the map bigger" title="Make the map bigger" aria-pressed="false">' + EXPAND_ICON + '</button>'
      + '<button type="button" class="brq-icon" data-brq-close aria-label="Close">' + CLOSE_ICON + '</button></header>'
      + '<div class="brq-mapwrap"><div class="brq-map" id="brq-map"></div></div>'
      + '<div class="brq-card" id="brq-card"></div></div>';
    document.body.appendChild(root);
    document.documentElement.classList.add('brq-open');
    var card = root.querySelector('#brq-card');
    var titleEl = root.querySelector('#brq-title');
    var subEl = root.querySelector('#brq-sub');
    function setHead(sub) {
      titleEl.textContent = state.name;
      subEl.textContent = sub;
    }
    setHead('Loading…');

    function close() {
      document.removeEventListener('keydown', onKey);
      if (state.map) { try { state.map.remove(); } catch (_) { /* already gone */ } }
      root.remove();
      document.documentElement.classList.remove('brq-open');
      if (trigger && trigger.focus) trigger.focus({ preventScroll: true });
    }
    function onKey(event) { if (event.key === 'Escape') close(); }
    document.addEventListener('keydown', onKey);
    root.querySelector('[data-brq-close]').addEventListener('click', close);
    root.addEventListener('click', function (event) { if (event.target === root) close(); });
    root.querySelector('[data-brq-expand]').addEventListener('click', function (event) {
      var button = event.currentTarget;
      var big = root.classList.toggle('is-expanded');
      button.innerHTML = big ? SHRINK_ICON : EXPAND_ICON;
      button.setAttribute('aria-pressed', String(big));
      button.setAttribute('aria-label', big ? 'Make the map smaller' : 'Make the map bigger');
      button.setAttribute('title', big ? 'Make the map smaller' : 'Make the map bigger');
      if (state.map) {
        state.map.invalidateSize({ pan: false });
        if (state.lat !== null) fitResults(); else if (state.center) state.map.setView([state.center.lat, state.center.lng], 13, { animate: false });
      }
    });

    function show(html) {
      card.innerHTML = html;
      var first = card.querySelector('input:not([type="radio"]), .brq-btn');
      if (first) first.focus({ preventScroll: true });
    }
    function showError(message) {
      var old = card.querySelector('.brq-alert');
      if (old) old.remove();
      var note = document.createElement('p');
      note.className = 'brq-alert';
      note.setAttribute('role', 'alert');
      note.textContent = message;
      (card.querySelector('.brq-card__scroll') || card).appendChild(note);
    }

    /* ---------- map ---------- */
    function startMap() {
      var center = state.center;
      loadMapTools().then(function () {
        if (!root.isConnected) return;
        var L = window.L;
        var map = state.map = L.map(root.querySelector('#brq-map'), { zoomControl: false, attributionControl: true })
          .setView(center ? [center.lat, center.lng] : [20, 0], center ? 13 : 2);
        if (window.ManagiraMaps && window.ManagiraMaps.addTiles) window.ManagiraMaps.addTiles(map);
        if (!(window.matchMedia && window.matchMedia('(pointer: coarse)').matches)) L.control.zoom({ position: 'bottomright' }).addTo(map);
        state.stopLayer = L.layerGroup().addTo(map);
        if (state.lat !== null) drawResults();
        map.on('click', function (event) {
          if (!state.pinning) return;
          locate({ lat: event.latlng.lat, lng: event.latlng.lng });
        });
      }).catch(function () { /* the form works without the map */ });
    }
    function drawResults() {
      if (!state.map) return;
      var L = window.L;
      var place = [state.lat, state.lng];
      if (!state.pin) {
        state.pin = L.marker(place, {
          draggable: true, zIndexOffset: 1000, title: 'Drag to the right place',
          icon: L.divIcon({ className: '', html: '<div class="brq-pin"></div>', iconSize: [22, 22], iconAnchor: [11, 11] })
        }).addTo(state.map);
        state.pin.on('dragend', function () {
          var at = state.pin.getLatLng();
          locate({ lat: at.lat, lng: at.lng });
        });
      } else {
        state.pin.setLatLng(place);
      }
      state.stopLayer.clearLayers();
      var bounds = [place];
      state.options.forEach(function (option, index) {
        var at = [option.latitude, option.longitude];
        bounds.push(at);
        L.marker(at, {
          keyboard: false,
          icon: L.divIcon({ className: '', html: '<div class="brq-stop' + (index === state.picked ? ' is-on' : '') + '">' + (index + 1) + '</div>', iconSize: [26, 26], iconAnchor: [13, 13] })
        }).on('click', function () { pick(index); }).addTo(state.stopLayer);
      });
      fitResults();
    }
    function fitResults() {
      if (!state.map || state.lat === null) return;
      state.map.invalidateSize({ pan: false });
      var bounds = [[state.lat, state.lng]].concat(state.options.map(function (o) { return [o.latitude, o.longitude]; }));
      state.map.fitBounds(bounds, { maxZoom: 15, animate: false, padding: [28, 28] });
    }
    function pick(index) {
      state.picked = index;
      card.querySelectorAll('.brq-option').forEach(function (el, i) {
        el.classList.toggle('is-on', i === index);
        el.querySelector('input').checked = i === index;
      });
      if (state.stopLayer) {
        var el = root.querySelectorAll('.brq-stop');
        el.forEach(function (node, i) { node.classList.toggle('is-on', i === index); });
      }
    }

    /* ---------- steps ---------- */
    function stepIntro(data) {
      if (data.hasAccess) {
        setHead('Has bus access');
        show('<div class="brq-card__scroll"><p>The school has already put this student on a bus.</p></div>');
        return;
      }
      if (data.pending) { stepWaiting(data.pending); return; }
      setHead('No bus yet');
      show('<div class="brq-card__actions"><button type="button" class="brq-btn" data-next>Request bus for student</button></div>');
      card.querySelector('[data-next]').addEventListener('click', stepAddress);
    }
    function stepWaiting(pending) {
      var place = [pending.routeName, pending.stopName].filter(Boolean).join(' · ');
      setHead('Request waiting for the school');
      show('<div class="brq-card__scroll"><div class="brq-kv"><span>Address</span><strong>' + esc(pending.address || 'Pin on map') + '</strong></div>'
        + (place ? '<div class="brq-kv"><span>Route and stop</span><strong>' + esc(place) + '</strong></div>' : '')
        + '</div>' + (state.canCancel ? '<div class="brq-card__actions"><button type="button" class="brq-btn brq-btn--danger" data-cancel>Cancel request</button></div>' : ''));
      var cancel = card.querySelector('[data-cancel]');
      if (cancel) cancel.addEventListener('click', function () {
        cancel.disabled = true;
        request('/transportation/requests/' + pending.id + '/cancel', {}).then(function () {
          changed();
          stepIntro({ hasAccess: false, pending: null });
        }).catch(function (error) { cancel.disabled = false; showError(error.message); });
      });
    }
    function stepAddress() {
      state.pinning = false;
      setHead('Where should the bus pick them up?');
      show('<form class="brq-card__scroll" id="brq-address-form" novalidate>'
        + '<label class="brq-label" for="brq-address">Student\'s address</label><input class="brq-input" id="brq-address" autocomplete="street-address" maxlength="300" placeholder="Street, area, town" value="' + esc(state.address) + '" /></form>'
        + '<div class="brq-card__actions"><button type="submit" form="brq-address-form" class="brq-btn" data-find>Find closest routes</button></div>');
      card.querySelector('form').addEventListener('submit', function (event) {
        event.preventDefault();
        var value = card.querySelector('#brq-address').value.trim();
        if (!value) { showError('Please enter the address.'); return; }
        state.address = value;
        state.lat = state.lng = null;
        locate({ address: value });
      });
    }
    function locate(where) {
      var button = card.querySelector('[data-find], [data-submit]');
      if (button) button.disabled = true;
      request('/transportation/requests/options', { studentId: state.studentId, address: where.address, lat: where.lat, lng: where.lng }).then(function (result) {
        if (!root.isConnected) return;
        state.unit = result.unit || state.unit;
        if (!result.located) {
          if (button) button.disabled = false;
          state.pinning = true;
          showError('We couldn\'t find that address. Check the spelling, or tap the map to place a pin.');
          return;
        }
        state.pinning = false;
        state.lat = result.lat;
        state.lng = result.lng;
        state.options = result.options || [];
        state.picked = state.options.length ? 0 : null;
        stepChoose();
        drawResults();
      }).catch(function (error) {
        if (button) button.disabled = false;
        showError(error.message);
      });
    }
    function stepChoose() {
      var list = state.options.map(function (option, index) {
        var details = [option.stopName, option.busNumber ? 'Bus ' + option.busNumber : '', fmtTime(option.pickupTime)].filter(Boolean).join(' · ');
        return '<label class="brq-option' + (index === state.picked ? ' is-on' : '') + '"><input type="radio" name="brq-option" value="' + index + '"' + (index === state.picked ? ' checked' : '') + ' />'
          + '<span class="brq-option__text"><strong>' + esc(option.routeName) + '</strong><span>' + esc(details) + '</span></span>'
          + '<span class="brq-option__dist">' + esc(fmtDistance(option.distanceKm, state.unit)) + '</span></label>';
      }).join('');
      setHead('Choose the closest route and stop');
      show('<div class="brq-card__scroll">'
        + '<div class="brq-address"><p>' + esc(state.address || 'Pin on the map') + '</p><button type="button" class="brq-link" data-edit>Change</button></div>'
        + (list ? '<fieldset class="brq-options"><legend class="sr-only" style="position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0)">Choose a stop</legend>' + list + '</fieldset>'
                : '<p class="brq-alert" style="background:var(--brq-soft);color:var(--brq-muted)!important">No stops close by yet. Send the request and the school will find one.</p>')
        + '</div><div class="brq-card__actions"><button type="button" class="brq-btn" data-submit>Submit request</button></div>');
      card.querySelector('[data-edit]').addEventListener('click', stepAddress);
      card.querySelectorAll('input[name="brq-option"]').forEach(function (input) {
        input.addEventListener('change', function () { pick(Number(input.value)); });
      });
      card.querySelector('[data-submit]').addEventListener('click', submit);
    }
    function submit(event) {
      var button = event.currentTarget;
      var option = state.picked === null ? null : state.options[state.picked];
      button.disabled = true;
      request('/transportation/requests', {
        studentId: state.studentId, address: state.address, lat: state.lat, lng: state.lng,
        stopId: option ? option.stopId : null
      }).then(function () {
        changed();
        setHead('Request sent');
        show('<div class="brq-card__scroll"><div class="brq-tick">' + TICK_ICON + '</div><p>The school will review it and answer under Requests.</p></div>'
          + '<div class="brq-card__actions"><button type="button" class="brq-btn" data-done>Done</button></div>');
        card.querySelector('[data-done]').addEventListener('click', close);
      }).catch(function (error) {
        button.disabled = false;
        showError(error.message);
      });
    }

    /* ---------- begin ---------- */
    request('/transportation/requests/start?studentId=' + encodeURIComponent(state.studentId)).then(function (data) {
      if (!root.isConnected) return;
      state.name = data.student.name || state.name;
      setHead('');
      state.firstName = data.student.firstName || '';
      state.address = data.student.address || '';
      state.unit = data.unit || 'km';
      state.center = data.center;
      startMap();
      stepIntro(data);
    }).catch(function (error) {
      if (!root.isConnected) return;
      setHead('');
      show('<div class="brq-card__scroll"><p class="brq-alert" style="margin-top:0!important" role="alert"></p></div>');
      card.querySelector('.brq-alert').textContent = error.message;
    });
  }

  document.addEventListener('click', function (event) {
    var trigger = event.target.closest && event.target.closest('[data-bus-request]');
    if (!trigger) return;
    event.preventDefault();
    event.stopPropagation();
    open(trigger.getAttribute('data-bus-request'), trigger);
  });

  /* ---------- parent portal: Children / Requests, New / Old ---------- */
  var STATUS = { pending: 'Waiting', approved: 'Approved', declined: 'Declined', cancelled: 'Cancelled' };
  function mountParentRequests() {
    var tabs = document.querySelector('[data-gdr-tabs]');
    var panel = document.querySelector('[data-gdr-panel="requests"]');
    if (!tabs || !panel || tabs.dataset.bound === '1') return;
    tabs.dataset.bound = '1';
    var list = panel.querySelector('[data-gdr-list]');
    var badge = tabs.querySelector('[data-gdr-count]');
    var bucket = 'new';

    function setCount(count) { badge.textContent = count; badge.hidden = !count; }
    function render(requests) {
      if (bucket === 'new') setCount(requests.length);
      if (!requests.length) {
        list.innerHTML = '<p class="gdr-empty">' + (bucket === 'new' ? 'No new requests.' : 'No old requests yet.') + '</p>';
        return;
      }
      list.innerHTML = '<ul class="gdr-list">' + requests.map(function (r) {
        var place = [r.routeName, r.stopName].filter(Boolean).join(' · ');
        return '<li class="gdr-item"><div class="gdr-item__top"><strong>' + esc(r.studentName) + '</strong><span class="gdr-pill gdr-pill--' + esc(r.status) + '">' + esc(STATUS[r.status] || r.status) + '</span></div>'
          + (place ? '<p>' + esc(place) + '</p>' : '')
          + (r.address ? '<p>' + esc(r.address) + '</p>' : '')
          + (r.decisionNote ? '<p>School\'s note: ' + esc(r.decisionNote) + '</p>' : '')
          + (r.status === 'pending' ? '<button type="button" class="gdr-cancel" data-gdr-cancel="' + r.id + '">Cancel request</button>' : '')
          + '</li>';
      }).join('') + '</ul>';
    }
    function load() {
      var asked = bucket;
      return request('/transportation/requests/mine?bucket=' + asked).then(function (result) {
        if (asked === bucket) render(result.requests);
        else if (asked === 'new') setCount(result.requests.length);
      }).catch(function (error) {
        if (asked !== bucket) return;
        list.innerHTML = '<p class="gdr-empty"></p>';
        list.firstChild.textContent = error.message;
      });
    }
    tabs.addEventListener('click', function (event) {
      var tab = event.target.closest('[data-gdr-tab]');
      if (!tab) return;
      var name = tab.getAttribute('data-gdr-tab');
      tabs.querySelectorAll('[data-gdr-tab]').forEach(function (other) {
        var on = other === tab;
        other.classList.toggle('is-on', on);
        other.setAttribute('aria-selected', String(on));
      });
      document.querySelectorAll('[data-gdr-panel]').forEach(function (section) {
        section.hidden = section.getAttribute('data-gdr-panel') !== name;
      });
      if (name === 'requests') load();
    });
    panel.addEventListener('click', function (event) {
      var segment = event.target.closest('[data-gdr-bucket]');
      if (segment) {
        bucket = segment.getAttribute('data-gdr-bucket');
        panel.querySelectorAll('[data-gdr-bucket]').forEach(function (other) {
          var on = other === segment;
          other.classList.toggle('is-on', on);
          other.setAttribute('aria-selected', String(on));
        });
        list.innerHTML = '<p class="gdr-empty">Loading…</p>';
        load();
        return;
      }
      var cancel = event.target.closest('[data-gdr-cancel]');
      if (cancel) {
        cancel.disabled = true;
        request('/transportation/requests/' + cancel.getAttribute('data-gdr-cancel') + '/cancel', {}).then(load).catch(function (error) {
          cancel.disabled = false;
          window.alert(error.message);
        });
      }
    });
    document.addEventListener('busrequest:changed', load);
    load();
  }

  window.BusRequest = { open: open, mountParentRequests: mountParentRequests };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', mountParentRequests);
  else mountParentRequests();
  window.addEventListener('spa:pageLoaded', mountParentRequests);
})();
