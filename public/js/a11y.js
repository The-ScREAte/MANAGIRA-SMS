// Accessibility helpers shared by every page (WCAG 2.1 AA). Loaded once from the head, so it also
// covers pages the app swaps in without a full load (spa-router.js).
//  - the page title is announced and the keyboard lands on the new page after a swap
//  - pop-ups that open from a click or key press (role="dialog") take the keyboard, keep it inside
//    when aria-modal is set, close on Escape through their own close button, and give it back
//  - messages and toasts are announced; icon-only controls and unlabelled fields get a name
//  - FullCalendar quirks that axe reports (empty aria-controls, unnamed arrows)
(function () {
  'use strict';
  if (window.__a11y) return;
  window.__a11y = true;

  function textOf(el) { return (el.textContent || '').replace(/\s+/g, ' ').trim(); }
  var FOCUSABLE = 'a[href],button:not([disabled]),input:not([disabled]):not([type="hidden"]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"]),summary';
  var lastGesture = 0;
  ['pointerdown', 'keydown', 'touchstart'].forEach(function (t) {
    document.addEventListener(t, function () { lastGesture = Date.now(); }, true);
  });

  function visible(el) {
    if (!el || !el.isConnected) return false;
    if (el.closest('[hidden],[aria-hidden="true"],[inert]')) return false;
    var cs = window.getComputedStyle(el);
    if (cs.display === 'none' || cs.visibility === 'hidden' || Number(cs.opacity) === 0) return false;
    var r = el.getBoundingClientRect();
    if (r.width < 2 || r.height < 2) return false;
    return r.right > 4 && r.bottom > 4 && r.left < window.innerWidth - 4 && r.top < window.innerHeight - 4;
  }
  // Drawn at all (not display:none), wherever on the page it is.
  function shown(el) {
    if (!el || !el.isConnected || el.closest('[hidden],[aria-hidden="true"],[inert]')) return false;
    return el.getClientRects().length > 0 && window.getComputedStyle(el).visibility !== 'hidden';
  }
  function focusables(root) {
    return Array.prototype.filter.call(root.querySelectorAll(FOCUSABLE), function (el) {
      return !el.disabled && el.tabIndex >= 0 && visible(el);
    });
  }

  // ---- announcer + page change -------------------------------------------------------------
  var announcer;
  function say(text) {
    if (!document.body) return;
    if (!announcer || !announcer.isConnected) {
      announcer = document.createElement('div');
      announcer.id = 'a11y-announcer';
      announcer.className = 'sr-only';
      announcer.setAttribute('role', 'status');
      announcer.setAttribute('aria-live', 'polite');
      announcer.setAttribute('aria-atomic', 'true');
      document.body.appendChild(announcer);
    }
    announcer.textContent = '';
    setTimeout(function () { announcer.textContent = text; }, 60);
  }
  window.a11yAnnounce = say;

  window.addEventListener('spa:pageLoaded', function () {
    var main = document.querySelector('main');
    say((document.title || '').replace(/\s*\|\s*Managira\s*$/, '') || 'Page loaded');
    if (main) {
      if (!main.hasAttribute('tabindex')) main.setAttribute('tabindex', '-1');
      try { main.focus({ preventScroll: true }); } catch (e) { /* older browsers */ }
    }
  });

  document.addEventListener('click', function (e) {
    var a = e.target && e.target.closest && e.target.closest('a.skip-link');
    if (!a) return;
    var target = document.getElementById((a.getAttribute('href') || '').slice(1));
    if (!target) return;
    e.preventDefault();
    e.stopPropagation();
    if (!target.hasAttribute('tabindex')) target.setAttribute('tabindex', '-1');
    target.focus();
    target.scrollIntoView();
  }, true);

  // Escape closes an open menu (the header's menu button, a "more" menu) and returns to its button.
  document.addEventListener('keydown', function (e) {
    if (e.key !== 'Escape' || e.defaultPrevented) return;
    var active = document.activeElement;
    var openers = document.querySelectorAll('[aria-expanded="true"][aria-controls]');
    for (var i = 0; i < openers.length; i++) {
      var btn = openers[i];
      var panel = document.getElementById(btn.getAttribute('aria-controls'));
      if (!panel || panel.getAttribute('role') === 'dialog' || panel.closest('[role="dialog"]')) continue;
      if (!/menu|dropdown|popover|nav/i.test(panel.className + ' ' + (panel.getAttribute('role') || ''))) continue;
      if (active !== btn && !panel.contains(active)) continue;
      btn.click();
      try { btn.focus(); } catch (err) { /* ignore */ }
      return;
    }
  });

  // A <div role="button"> is not a button to the keyboard: Enter and Space press it.
  document.addEventListener('keydown', function (e) {
    if (e.defaultPrevented || e.altKey || e.ctrlKey || e.metaKey) return;
    if (e.key !== 'Enter' && e.key !== ' ') return;
    var el = e.target;
    if (!el || el.nodeType !== 1) return;
    if (!/^(button|switch|menuitem|tab|option)$/.test(el.getAttribute('role') || '') && !el.hasAttribute('data-a11y-click')) return;
    if (/^(BUTTON|A|INPUT|SELECT|TEXTAREA|SUMMARY)$/.test(el.tagName) || el.hasAttribute('data-a11y-own-keys')) return;
    e.preventDefault();
    el.click();
  });

  // ---- field errors (3.3.1, 3.3.3) ---------------------------------------------------------
  // A field in error says so in words next to it, is marked aria-invalid and points at the message.
  // Used by the browser's own "required / wrong format" check below, by pages (a11yFieldError) and
  // for fields a page marks with an error class.
  var errSeq = 0;
  function labelOf(el) {
    var t = el.getAttribute('aria-label');
    if (!t && el.labels && el.labels[0]) t = textOf(el.labels[0]);
    if (!t && el.id) { var l = document.querySelector('label[for="' + (window.CSS && CSS.escape ? CSS.escape(el.id) : el.id) + '"]'); if (l) t = textOf(l); }
    if (!t) { var near = el.closest('.form-group,.field,.input-group,.form-field'); var lab = near && near.querySelectorAll('label').length === 1 && near.querySelector('label'); if (lab) t = textOf(lab); }
    if (!t) t = el.getAttribute('placeholder') || '';
    return (t || '').replace(/[*:]+\s*$/, '').trim();
  }
  function defaultMessage(el) {
    var name = labelOf(el);
    var empty = !String(el.value || '').trim();
    if (el.validationMessage && el.validity && !el.validity.valid && !empty) return el.validationMessage;
    return empty ? (name ? name + ' is required.' : 'This field is required.') : (name ? 'Check ' + name + '.' : 'Check this entry.');
  }
  function fieldError(el, message) {
    if (!el || el.nodeType !== 1) return;
    var msg = el.__errMsg;
    if (!msg || !msg.isConnected) {
      msg = document.createElement('span');
      msg.className = 'a11y-field-error';
      msg.id = 'a11y-err-' + (++errSeq);
      var host = el.closest('.input-with-menu,.field,.form-group') || el;
      host.insertAdjacentElement('afterend', msg);
      el.__errMsg = msg;
    }
    msg.textContent = message || defaultMessage(el);
    el.setAttribute('aria-invalid', 'true');
    var ids = (el.getAttribute('aria-describedby') || '').split(/\s+/).filter(Boolean);
    if (ids.indexOf(msg.id) < 0) { ids.push(msg.id); el.setAttribute('aria-describedby', ids.join(' ')); }
  }
  function clearFieldError(el) {
    if (!el || el.nodeType !== 1) return;
    if (el.__errMsg) {
      var id = el.__errMsg.id;
      el.__errMsg.remove();
      el.__errMsg = null;
      var ids = (el.getAttribute('aria-describedby') || '').split(/\s+/).filter(function (x) { return x && x !== id; });
      if (ids.length) el.setAttribute('aria-describedby', ids.join(' ')); else el.removeAttribute('aria-describedby');
    }
    el.removeAttribute('aria-invalid');
  }
  window.a11yFieldError = fieldError;
  window.a11yClearFieldError = clearFieldError;
  // The browser's own check ("required", wrong email...): the bubble goes away by itself, so the words stay by the field.
  document.addEventListener('invalid', function (e) {
    var el = e.target;
    if (!el || !/^(INPUT|SELECT|TEXTAREA)$/.test(el.tagName)) return;
    fieldError(el, el.validationMessage && String(el.value || '').trim() ? el.validationMessage : '');
  }, true);
  function recheck(e) {
    var el = e.target;
    if (el && el.getAttribute && el.getAttribute('aria-invalid') === 'true' && (!el.validity || el.validity.valid) && String(el.value || '').trim() !== '') clearFieldError(el);
  }
  document.addEventListener('input', recheck, true);
  document.addEventListener('change', recheck, true);
  var ERR_CLASS = /(^|\s)(error|is-invalid|invalid|has-error|input-error)(\s|$)/;
  function errorClasses(root) {
    var list = root.matches && root.matches('input,select,textarea') ? [root] : [];
    if (root.querySelectorAll) Array.prototype.push.apply(list, root.querySelectorAll('input.error,select.error,textarea.error,input.is-invalid,select.is-invalid,textarea.is-invalid,input.invalid,select.invalid,textarea.invalid,input.input-error,.has-error input,.has-error select,.has-error textarea'));
    list.forEach(function (el) {
      var flagged = ERR_CLASS.test(el.className) || !!el.closest('.has-error');
      if (flagged && el.getAttribute('aria-invalid') !== 'true') {
        el.setAttribute('aria-invalid', 'true');
        var wrapper = el.closest('.has-error');
        var existing = wrapper && wrapper.querySelector('.cff-error,.error-message,.field-error');
        if (existing && existing.id) { el.setAttribute('aria-describedby', existing.id); }
        else if (existing) { existing.id = 'a11y-err-' + (++errSeq); el.setAttribute('aria-describedby', existing.id); }
        else if (!el.getAttribute('aria-describedby')) fieldError(el);
      } else if (!flagged && el.getAttribute('aria-invalid') === 'true' && !(el.validity && !el.validity.valid && el.__errMsg)) {
        clearFieldError(el);
      }
    });
  }

  // ---- pop-ups -----------------------------------------------------------------------------
  var open = new Map(); // dialog element -> element that had the keyboard before it opened
  function dialogs() {
    return document.querySelectorAll('[role="dialog"],[role="alertdialog"],dialog[open]');
  }
  var scanQueued = false;
  function queueScan() {
    if (scanQueued) return;
    scanQueued = true;
    requestAnimationFrame(function () { scanQueued = false; scan(); });
  }
  // A drawer or pop-up marked aria-hidden must not be reachable with Tab either: inert follows it.
  var HIDEABLE = '[aria-hidden][role="dialog"],aside[aria-hidden],[aria-hidden][class*="drawer"],[aria-hidden][class*="modal"],[aria-hidden][class*="popover"],[aria-hidden][class*="panel"],[aria-hidden][class*="overlay"]';
  function syncInert(root) {
    var els = [];
    if (root.matches && root.matches(HIDEABLE)) els.push(root);
    if (root.querySelectorAll) Array.prototype.push.apply(els, root.querySelectorAll(HIDEABLE));
    els.forEach(function (el) {
      var hidden = el.getAttribute('aria-hidden') === 'true';
      if (hidden && el.querySelector(FOCUSABLE)) { if (!el.inert) el.inert = true; }
      else if (!hidden && el.inert && el.hasAttribute('inert')) el.inert = false;
    });
  }
  function scan() {
    var now = Date.now();
    Array.prototype.forEach.call(dialogs(), function (d) {
      if (d.classList.contains('chatbot-container') || d.hasAttribute('data-a11y-skip')) return;
      var isVis = visible(d);
      if (isVis && !open.has(d)) {
        var opener = document.activeElement && !d.contains(document.activeElement) ? document.activeElement : null;
        open.set(d, opener);
        if (now - lastGesture < 1500 && !d.contains(document.activeElement)) {
          var f = focusables(d);
          var close = closeButton(d);
          var target = f.find(function (el) { return /^(input|select|textarea)$/i.test(el.tagName); }) || f.find(function (el) { return el !== close; }) || f[0];
          if (!target) { if (!d.hasAttribute('tabindex')) d.setAttribute('tabindex', '-1'); target = d; }
          try { target.focus({ preventScroll: true }); } catch (e) { /* ignore */ }
        }
      } else if (!isVis && open.has(d)) {
        var back = open.get(d);
        open.delete(d);
        var active = document.activeElement;
        if (back && back.isConnected && (!active || active === document.body || d.contains(active))) {
          try { back.focus({ preventScroll: true }); } catch (e) { /* ignore */ }
        }
      }
    });
    open.forEach(function (_back, d) { if (!d.isConnected) open.delete(d); });
  }
  // The pop-up's own close control: marked as one, or named Close / Cancel / x.
  function closeButton(d) {
    var found = d.querySelector('[data-close],[data-dismiss],[data-modal-close],[data-drawer-close]');
    if (found) return found;
    var all = d.querySelectorAll('button,[role="button"],a');
    for (var i = 0; i < all.length; i++) {
      var label = (all[i].getAttribute('aria-label') || textOf(all[i]) || all[i].getAttribute('title') || '').trim();
      if (/^(close|cancel|dismiss|done|x|\u00d7|\u2715)$/i.test(label) || /^close\b/i.test(label)) return all[i];
    }
    return null;
  }
  function topDialog() {
    var top = null;
    open.forEach(function (_b, d) { if (visible(d)) top = d; });
    return top;
  }
  document.addEventListener('keydown', function (e) {
    var d = topDialog();
    if (!d) return;
    if (e.key === 'Tab' && d.getAttribute('aria-modal') === 'true') {
      var f = focusables(d);
      if (!f.length) { e.preventDefault(); return; }
      var first = f[0], last = f[f.length - 1];
      if (!d.contains(document.activeElement)) { e.preventDefault(); first.focus(); }
      else if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
    }
    if (e.key === 'Escape' && !e.defaultPrevented) {
      // The page's own Escape handler runs first; only when this pop-up is still showing is its
      // close button pressed.
      setTimeout(function () {
        if (!visible(d)) return;
        var close = closeButton(d);
        if (close && !close.disabled) close.click();
      }, 30);
    }
  });

  // ---- names and live regions --------------------------------------------------------------
  var TOASTS = '[class*="toast"],[class*="snackbar"],.flash-message,.flash-success,.flash-error';
  function hasName(el) {
    if (el.getAttribute('aria-label') || el.getAttribute('aria-labelledby') || el.getAttribute('title')) return true;
    if (textOf(el)) return true;
    return !!el.querySelector('img[alt]:not([alt=""]),[aria-label],svg title');
  }
  var uid = 0;
  // Pop-ups that slide in under the header (public/js/belowHeaderPanels.js) are dialogs.
  function markPanels(root) {
    var list = root.matches && root.matches('[data-below-header]') ? [root] : [];
    if (root.querySelectorAll) Array.prototype.push.apply(list, root.querySelectorAll('[data-below-header]'));
    list.forEach(function (el) {
      if (el.getAttribute('role')) return;
      el.setAttribute('role', 'dialog');
      if (el.getAttribute('aria-label') || el.getAttribute('aria-labelledby')) return;
      var h = el.querySelector('h1,h2,h3,h4,[class*="title"]');
      if (h && textOf(h)) { if (!h.id) h.id = 'a11y-dlg-title-' + (++uid); el.setAttribute('aria-labelledby', h.id); }
      else el.setAttribute('aria-label', 'Details');
    });
  }
  // A card, row or tile that opens something with onclick but is not a link or button: the keyboard
  // can reach it and Enter / Space press it, and screen readers call it a button.
  var CLICKABLE_SKIP = /overlay|backdrop|mask|modal|drawer|-bg\b|dismiss|scrim/i;
  function clickables(root) {
    var list = root.matches && root.matches('[onclick],[data-onclick]') ? [root] : [];
    if (root.querySelectorAll) Array.prototype.push.apply(list, root.querySelectorAll('[onclick],[data-onclick]'));
    list.forEach(function (el) {
      if (el.hasAttribute('tabindex') || el.hasAttribute('role') || el.hasAttribute('data-a11y-click')) return;
      if (!/^(DIV|SPAN|LI|TR|TD|ARTICLE|SECTION|P|IMG|I|H[1-6])$/.test(el.tagName)) return;
      var handler = el.getAttribute('data-onclick'), fn = handler && window.__mgAct && window.__mgAct.H[handler];
      var code = (el.getAttribute('onclick') || (fn ? String(fn).replace(/^function\s*\([^)]*\)\s*\{|\}\s*$/g, '') : '')).replace(/\s+/g, '');
      if ((!handler || fn) && (/^(event\.stopPropagation\(\)|return(false|true)|event\.preventDefault\(\))?;?$/.test(code) || /^event\.stopPropagation\(\);?$/.test(code))) return;
      if (CLICKABLE_SKIP.test(el.className + ' ' + el.id)) return;
      if (el.querySelector('a[href],button,input,select,textarea,[tabindex]')) return;
      el.setAttribute('tabindex', '0');
      el.setAttribute('data-a11y-click', '1');
      if (!/^(TR|TD)$/.test(el.tagName)) el.setAttribute('role', 'button');
    });
  }
  // 1.3.5: fields that ask for the signed-in or signing-up person's own details say what they are
  // (name, email, phone, address, password). Only the pages that collect the person's own details;
  // a staff member typing in a student's or colleague's details is not "the user".
  var OWN_PAGES = /^\/(account\/(register|settings|login|student-login|guardian-login|forget-password|reset-password|confirm-password|personalization)|guardian\/(settings|family-details)|driver\/settings|student\/settings|common\/(publicRegister|setPassword)|hub\/(login|setup-password)|legal\/request-demo)/i;
  var NEW_PW = /^\/(account\/(register|reset-password)|common\/setPassword|hub\/setup-password)/i;
  function guessAutocomplete(el, path) {
    var type = (el.getAttribute('type') || 'text').toLowerCase();
    var key = ((el.name || '') + ' ' + (el.id || '')).toLowerCase().replace(/[\[\]\d]+/g, ' ').replace(/[_-]/g, '');
    if (/student|child|pupil|ward|employee|teacher|holder|account|bank|business|momo|label/.test(key)) return '';
    if (/publicregister/i.test(path) && !/guardian/.test(key)) return '';
    if (/orgname|organizationname/.test(key)) return 'organization';
    if (/^org/.test(key.trim())) return '';
    if (type === 'password') {
      if (/confirm|new/.test(key) || NEW_PW.test(path)) return 'new-password';
      return 'current-password';
    }
    if (type === 'email' || /\bemail\b|confirmemail/.test(key)) return 'email';
    if (type === 'tel' || /phone|mobile|\btel\b/.test(key)) return 'tel';
    if (/(first|given)name|\bfname\b/.test(key)) return 'given-name';
    if (/(last|family)name|surname|\blname\b/.test(key)) return 'family-name';
    if (/orgname|organizationname/.test(key)) return 'organization';
    if (/^org/.test(key.trim())) return '';
    if (/address/.test(key)) return el.tagName === 'TEXTAREA' ? 'street-address' : 'address-line1';
    if (/country/.test(key)) return 'country-name';
    if (/province|\bstate\b|region/.test(key)) return 'address-level1';
    if (/\bcity\b|\btown\b/.test(key)) return 'address-level2';
    if (/zip|postal/.test(key)) return 'postal-code';
    if (/^(full)?name$/.test(key.trim())) return 'name';
    return '';
  }
  function autocompletes(root) {
    var path = window.location.pathname;
    if (!OWN_PAGES.test(path) || !root.querySelectorAll) return;
    Array.prototype.forEach.call(root.querySelectorAll('input:not([autocomplete]),textarea:not([autocomplete]),select:not([autocomplete])'), function (el) {
      var type = (el.getAttribute('type') || 'text').toLowerCase();
      if (/^(hidden|checkbox|radio|submit|button|file|image|reset|range|color|date|number)$/.test(type)) return;
      if (el.closest('[data-no-autofill]')) return;
      var v = guessAutocomplete(el, path);
      if (v) el.setAttribute('autocomplete', v);
    });
  }
  // A page that brings its own <main> inside the layout's one: only the outer one is the landmark.
  function nestedMains(root) {
    var mains = Array.prototype.slice.call(root.querySelectorAll ? root.querySelectorAll('main') : []);
    if (root.tagName === 'MAIN') mains.push(root);
    mains.forEach(function (m) {
      if (m.parentElement && m.parentElement.closest('main') && m.getAttribute('role') !== 'presentation') m.setAttribute('role', 'presentation');
    });
  }
  function fixNode(root) {
    markPanels(root);
    nestedMains(root);
    clickables(root);
    errorClasses(root);
    autocompletes(root);
    if (!root || root.nodeType !== 1) return;
    var list = [root];
    Array.prototype.push.apply(list, root.querySelectorAll('button,[role="button"],a[href],input,select,textarea,.fc-icon,[aria-controls=""],' + TOASTS));
    list.forEach(function (el) {
      var tag = el.tagName;
      if (el.getAttribute && el.getAttribute('aria-controls') === '') el.removeAttribute('aria-controls');
      if (el.classList.contains('fc-icon') && el.getAttribute('role') === 'img') { el.removeAttribute('role'); el.setAttribute('aria-hidden', 'true'); }
      if (el.matches(TOASTS) && !el.getAttribute('role') && !el.hasAttribute('aria-live') && !el.closest('[role="status"],[role="alert"]')) {
        el.setAttribute('role', /error|fail|danger/i.test(el.className) ? 'alert' : 'status');
      }
      if (tag === 'BUTTON' || tag === 'A' || el.getAttribute('role') === 'button') {
        var glyph = textOf(el);
        if (glyph.length === 1 && !el.getAttribute('aria-label') && !el.getAttribute('aria-labelledby')) {
          var byGlyph = { '\u22ee': 'More actions', '\u22ef': 'More actions', '\u2026': 'More actions', '\u00d7': 'Close', '\u2715': 'Close', '\u2716': 'Close', '+': 'Add', '\u2212': 'Remove', '\u2013': 'Remove' }[glyph];
          if (byGlyph) el.setAttribute('aria-label', el.getAttribute('title') || byGlyph);
        }
        if (!hasName(el)) {
          var hint = el.getAttribute('data-tooltip') || el.getAttribute('data-title') || el.getAttribute('data-label') || el.getAttribute('name');
          if (hint) el.setAttribute('aria-label', hint);
        } else if (!el.getAttribute('aria-label') && !textOf(el) && el.getAttribute('title')) {
          el.setAttribute('aria-label', el.getAttribute('title'));
        }
      } else if (tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA') {
        var type = (el.getAttribute('type') || 'text').toLowerCase();
        if (/^(hidden|submit|button|reset|image)$/.test(type)) return;
        if (el.getAttribute('aria-label') || el.getAttribute('aria-labelledby')) return;
        if (el.id && document.querySelector('label[for="' + (window.CSS && CSS.escape ? CSS.escape(el.id) : el.id) + '"]')) return;
        if (el.closest('label')) return;
        var name = el.getAttribute('title') || el.getAttribute('placeholder');
        if (name) el.setAttribute('aria-label', name);
      }
    });
  }
  // The gridcells of FullCalendar are named by their date number while holding the day's events.
  function fixCalendar(root) {
    if (!root || root.nodeType !== 1) return;
    // The day's own number link ("Go to October 26") names the day; the cell is read from its content.
    root.querySelectorAll('td.fc-day[role="gridcell"][aria-labelledby]').forEach(function (td) { td.removeAttribute('aria-labelledby'); });
    root.querySelectorAll('a.fc-more-link:not([role])').forEach(function (a) { a.setAttribute('role', 'button'); });
  }

  // ---- headings: one h1 per page and no skipped levels (the look never changes) ----------------
  // The level a screen reader announces is corrected with aria-level; sizes and styles are untouched.
  function headings() {
    var scope = document.querySelector('main') || document.body;
    var all = Array.prototype.filter.call(scope.querySelectorAll('h1,h2,h3,h4,h5,h6,[role="heading"]'), function (h) {
      return !h.closest('#top-header,nav,footer,[role="banner"],[role="navigation"],[role="contentinfo"],.managira-footer,[data-a11y-heading]') && shown(h);
    });
    var prev = 0, seenH1 = false, injected = scope.querySelector('[data-a11y-heading]');
    all.forEach(function (h) {
      var native = /^H[1-6]$/.test(h.tagName) ? Number(h.tagName[1]) : Number(h.getAttribute('data-a11y-native') || h.getAttribute('aria-level') || 2);
      if (!h.hasAttribute('data-a11y-native') && h.getAttribute('role') === 'heading') h.setAttribute('data-a11y-native', String(native));
      var level = native;
      if (level === 1) { if (seenH1) level = 2; seenH1 = true; }
      else if (prev === 0) level = Math.min(level, seenH1 ? 2 : 2);
      if (prev > 0 && level > prev + 1) level = prev + 1;
      if (level === 1) seenH1 = true;
      prev = level;
      if (level !== native) { h.setAttribute('aria-level', String(level)); h.setAttribute('data-a11y-leveled', '1'); if (!/^H[1-6]$/.test(h.tagName)) h.setAttribute('role', 'heading'); }
      else if (h.hasAttribute('data-a11y-leveled')) { h.removeAttribute('aria-level'); h.removeAttribute('data-a11y-leveled'); }
    });
    if (!seenH1 && !document.querySelector('h1') ) {
      var title = (document.title || '').replace(/\s*\|\s*Managira\s*$/, '').trim();
      if (title && scope.firstChild && !injected && !document.body.classList.contains('student-portal-no-h1')) {
        var h = document.createElement('h1');
        h.className = 'sr-only';
        h.setAttribute('data-a11y-heading', '1');
        h.textContent = title;
        scope.insertBefore(h, scope.firstChild);
      }
    } else if (injected && (seenH1 || document.querySelectorAll('h1').length > 1)) {
      injected.remove();
    }
  }

  var pending = new Set(), flushQueued = false, headTimer = null;
  function flush() {
    flushQueued = false;
    pending.forEach(function (n) { if (n.isConnected) { fixNode(n); syncInert(n); } });
    if (document.querySelector('.fc')) fixCalendar(document.body);
    headings();
    pending.clear();
    scan();
  }
  // A table or box that scrolls sideways can be scrolled with the arrow keys once it can take focus.
  function scrollables(root) {
    root.querySelectorAll('table,pre,[class*="scroll"],[class*="table"],[class*="wrap"]').forEach(function (el) {
      if (el.hasAttribute('tabindex') || el.scrollWidth <= el.clientWidth + 2 || !el.clientWidth) return;
      var ox = window.getComputedStyle(el).overflowX;
      if (ox !== 'auto' && ox !== 'scroll') return;
      if (el.querySelector(FOCUSABLE)) return;
      el.setAttribute('tabindex', '0');
    });
  }
  function start() {
    setTimeout(function () { if (document.body.getElementsByTagName('*').length < 6000) scrollables(document.body); }, 1500);
    fixNode(document.body);
    fixCalendar(document.body);
    syncInert(document.body);
    setTimeout(headings, 300);
    new MutationObserver(function (records) {
      var sawDialogChange = false;
      records.forEach(function (r) {
        if (r.type === 'attributes' && r.attributeName === 'aria-hidden') syncInert(r.target);
        if (r.type === 'childList') {
          r.addedNodes.forEach(function (n) { if (n.nodeType === 1) pending.add(n); });
          sawDialogChange = true;
        } else {
          sawDialogChange = true;
          var t = r.target;
          if (r.attributeName === 'class' && t.matches && (t.matches('input,select,textarea') || t.classList.contains('has-error'))) pending.add(t);
        }
      });
      clearTimeout(headTimer); headTimer = setTimeout(headings, 200);
      if (pending.size && !flushQueued) { flushQueued = true; setTimeout(flush, 80); }
      else if (sawDialogChange) queueScan();
    }).observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['class', 'style', 'hidden', 'aria-hidden', 'open'] });
  }
  if (document.body) start(); else document.addEventListener('DOMContentLoaded', start);
})();
