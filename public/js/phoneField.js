// Under every phone field: how the number will be dialled for texts and
// WhatsApp ("+233 24 412 3456"), or a note when it can't receive them.
// Numbers are checked on the server with the school's country (/phone-check),
// so local numbers ("0244 123 456") are fine as typed. Never blocks a form.
(function () {
  "use strict";
  if (window.__phoneFieldReady) return;
  window.__phoneFieldReady = true;

  var cache = {};
  var timers = new WeakMap();

  function isPhoneField(el) {
    if (!el || el.tagName !== "INPUT" || el.type === "hidden" || el.readOnly || el.disabled) return false;
    if (el.getAttribute("data-phone-hint") === "off") return false;
    var name = (el.name || el.id || "") + "";
    if (el.type !== "tel" && !/phone/i.test(name)) return false;
    if (/id$/i.test(name)) return false; // e.g. WhatsApp "phone number ID"
    var form = el.form;
    if (form && /login|signin|sign-in/i.test(form.getAttribute("action") || "")) return false;
    return true;
  }

  function hintFor(el) {
    var next = el.nextElementSibling;
    if (next && next.classList.contains("phone-hint")) return next;
    var hint = document.createElement("div");
    hint.className = "phone-hint";
    hint.setAttribute("aria-live", "polite");
    el.insertAdjacentElement("afterend", hint);
    return hint;
  }

  function show(el, result) {
    var value = el.value.trim();
    var existing = el.nextElementSibling && el.nextElementSibling.classList.contains("phone-hint") ? el.nextElementSibling : null;
    if (!value || !result || result.valid === null) {
      if (existing) existing.remove();
      return;
    }
    var hint = hintFor(el);
    if (result.valid) {
      hint.className = "phone-hint is-ok";
      hint.textContent = "Texts and WhatsApp go to " + result.display;
    } else {
      hint.className = "phone-hint is-warn";
      hint.textContent = "This number can't receive texts. Check it, or add the country code (it starts with +).";
    }
  }

  function check(el) {
    var value = el.value.trim();
    if (!value) return show(el, null);
    if (cache[value]) return show(el, cache[value]);
    fetch("/phone-check?n=" + encodeURIComponent(value), { credentials: "same-origin", headers: { Accept: "application/json" } })
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (result) {
        if (!result) return;
        cache[value] = result;
        if (el.value.trim() === value) show(el, result);
      })
      .catch(function () { /* hint is optional */ });
  }

  document.addEventListener("focusout", function (event) {
    if (isPhoneField(event.target)) check(event.target);
  }, true);

  // Once a hint is showing, keep it in step while the number is corrected.
  document.addEventListener("input", function (event) {
    var el = event.target;
    if (!isPhoneField(el)) return;
    var next = el.nextElementSibling;
    if (!next || !next.classList.contains("phone-hint")) return;
    clearTimeout(timers.get(el));
    timers.set(el, setTimeout(function () { check(el); }, 500));
  }, true);

  var style = document.createElement("style");
  style.textContent =
    ".phone-hint{margin-top:4px;font-size:12px;line-height:1.35;}" +
    ".phone-hint.is-ok{color:#166534;}" +
    ".phone-hint.is-warn{color:#b45309;}";
  document.head.appendChild(style);
})();
