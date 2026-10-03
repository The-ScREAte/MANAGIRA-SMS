// Feedback request prompt (star rating + comment) for signed-in school users.
// window.ManagiraFeedback.render(container, request, { existing, onDone })
// builds the form; the auto prompt checks /notices/active and shows it in a
// modal, with its own close (X) button handling "not now". Server rules
// live in utils/platformNotices.js.
(function () {
  "use strict";

  var WORDS = ["", "Poor", "Fair", "Good", "Very good", "Excellent"];
  var SNOOZE_MS = 3 * 24 * 60 * 60 * 1000;

  function el(tag, attrs, text) {
    var node = document.createElement(tag);
    Object.keys(attrs || {}).forEach(function (key) {
      if (key === "class") node.className = attrs[key];
      else node.setAttribute(key, attrs[key]);
    });
    if (text != null) node.textContent = text;
    return node;
  }

  function render(container, request, options) {
    options = options || {};
    var existing = options.existing || null;
    var rating = existing ? Number(existing.rating) || 0 : 0;
    container.innerHTML = "";

    var form = el("form", { class: "mfb-form", novalidate: "novalidate" });
    form.appendChild(el("h2", { class: "mfb-title", id: "mfbTitle" }, request.title));
    if (request.description) form.appendChild(el("p", { class: "mfb-desc" }, request.description));

    var question = el("p", { class: "mfb-question", id: "mfbQuestion" }, request.question);
    form.appendChild(question);

    var starsWrap = el("div", { class: "mfb-stars", role: "radiogroup", "aria-labelledby": "mfbQuestion" });
    var stars = [];
    for (var i = 1; i <= 5; i++) {
      var star = el("button", { type: "button", class: "mfb-star", role: "radio", "aria-label": i + " star" + (i > 1 ? "s" : "") + " - " + WORDS[i], "data-value": String(i) }, "★");
      stars.push(star);
      starsWrap.appendChild(star);
    }
    form.appendChild(starsWrap);
    var word = el("div", { class: "mfb-word", "aria-live": "polite" }, rating ? WORDS[rating] : "Tap a star to rate");
    form.appendChild(word);

    var comment = null;
    if (request.commentMode !== "off") {
      var label = el("label", { class: "mfb-label", for: "mfbComment" }, request.commentPrompt);
      comment = el("textarea", { id: "mfbComment", class: "mfb-comment", maxlength: "2000", rows: "4", placeholder: "Share your feedback..." });
      if (existing && existing.comment) comment.value = existing.comment;
      form.appendChild(label);
      form.appendChild(comment);
    }

    var error = el("div", { class: "mfb-error", role: "alert" });
    form.appendChild(error);

    // Dismissing lives in the dialog's own close (X) button when the request
    // isn't required, so the only button here is the one real action.
    var actions = el("div", { class: "mfb-actions" });
    var submit = el("button", { type: "submit", class: "mfb-submit" }, existing ? "Update feedback" : "Submit feedback");
    actions.appendChild(submit);
    form.appendChild(actions);
    if (request.anonymous) form.appendChild(el("p", { class: "mfb-note" }, "Your answer is anonymous."));

    function paint(value) {
      stars.forEach(function (star, index) {
        var on = index < value;
        star.classList.toggle("on", on);
        star.setAttribute("aria-checked", index + 1 === rating ? "true" : "false");
        star.tabIndex = (rating ? index + 1 === rating : index === 0) ? 0 : -1;
      });
    }
    function choose(value) {
      rating = value;
      paint(rating);
      word.textContent = WORDS[rating];
      error.textContent = "";
    }
    stars.forEach(function (star, index) {
      star.addEventListener("click", function () { choose(index + 1); });
      star.addEventListener("mouseenter", function () { paint(index + 1); word.textContent = WORDS[index + 1]; });
      star.addEventListener("keydown", function (event) {
        var next = null;
        if (event.key === "ArrowRight" || event.key === "ArrowUp") next = Math.min(5, (rating || 0) + 1);
        if (event.key === "ArrowLeft" || event.key === "ArrowDown") next = Math.max(1, (rating || 2) - 1);
        if (next) { event.preventDefault(); choose(next); stars[next - 1].focus(); }
      });
    });
    starsWrap.addEventListener("mouseleave", function () { paint(rating); word.textContent = rating ? WORDS[rating] : "Tap a star to rate"; });
    paint(rating);

    form.addEventListener("submit", async function (event) {
      event.preventDefault();
      error.textContent = "";
      if (!rating) { error.textContent = "Please choose a star rating."; return; }
      if (comment && request.commentMode === "required" && comment.value.trim().length < 2) {
        error.textContent = "Please add a comment before submitting.";
        comment.focus();
        return;
      }
      submit.disabled = true;
      submit.textContent = "Sending...";
      try {
        var res = await fetch("/notices/feedback/" + request.id, {
          method: "POST",
          credentials: "same-origin",
          headers: { "Content-Type": "application/json", Accept: "application/json" },
          body: JSON.stringify({ rating: rating, comment: comment ? comment.value : "" }),
        });
        var data = await res.json().catch(function () { return {}; });
        if (!res.ok || !data.success) throw new Error(data.message || "Your feedback could not be sent. Please try again.");
        container.innerHTML = "";
        var done = el("div", { class: "mfb-done", role: "status" });
        done.appendChild(el("div", { class: "mfb-check", "aria-hidden": "true" }, "✓"));
        done.appendChild(el("h2", { class: "mfb-title" }, "Thank you for your feedback!"));
        done.appendChild(el("p", { class: "mfb-desc" }, data.updated ? "Your response has been updated." : "Your response has been submitted successfully."));
        container.appendChild(done);
        if (options.onDone) options.onDone(data);
      } catch (err) {
        error.textContent = err.message;
        submit.disabled = false;
        submit.textContent = existing ? "Update feedback" : "Submit feedback";
      }
    });

    container.appendChild(form);
    return form;
  }

  function snoozeKey(request) { return "mgFeedbackSnooze:" + request.id + ":" + request.period; }
  function isSnoozed(request) {
    try { return Number(localStorage.getItem(snoozeKey(request)) || 0) > Date.now(); } catch (_) { return false; }
  }
  function snooze(request) {
    try { localStorage.setItem(snoozeKey(request), String(Date.now() + SNOOZE_MS)); } catch (_) {}
  }

  function openModal(request) {
    var previousFocus = document.activeElement;
    var overlay = el("div", { class: "mfb-overlay" });
    var dialog = el("div", { class: "mfb-dialog", role: "dialog", "aria-modal": "true", "aria-labelledby": "mfbTitle" });
    var body = el("div", { class: "mfb-body" });
    if (!request.required) {
      var close = el("button", { type: "button", class: "mfb-close", "aria-label": "Close" }, "×");
      close.addEventListener("click", later);
      dialog.appendChild(close);
    }
    dialog.appendChild(body);
    overlay.appendChild(dialog);
    document.body.appendChild(overlay);
    document.documentElement.classList.add("mfb-open");

    function remove() {
      overlay.classList.add("leaving");
      document.documentElement.classList.remove("mfb-open");
      document.removeEventListener("keydown", onKey);
      setTimeout(function () { overlay.remove(); }, 180);
      if (previousFocus && previousFocus.focus) previousFocus.focus();
    }
    function later() { snooze(request); remove(); }
    function onKey(event) {
      if (event.key === "Escape" && !request.required) later();
      if (event.key === "Tab") {
        var focusable = dialog.querySelectorAll("button, textarea, [tabindex='0']");
        if (!focusable.length) return;
        var first = focusable[0], last = focusable[focusable.length - 1];
        if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
        else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
      }
    }
    document.addEventListener("keydown", onKey);

    render(body, request, {
      onDone: function () { setTimeout(function () { remove(); setTimeout(check, 400); }, 2200); },
    });
    var firstStar = dialog.querySelector(".mfb-star");
    if (firstStar) firstStar.focus();
  }

  // Wait while an announcement pop-up is open so the two never stack.
  // (Not an offsetParent check: that's always null for position:fixed
  // elements like this overlay, in every browser, so it never worked.)
  function announcementOpen() {
    var overlay = document.getElementById("ann-modal-overlay");
    return Boolean(overlay && !overlay.hidden);
  }
  function showWhenClear(request, attempts) {
    if (document.querySelector(".mfb-overlay")) return;
    if (announcementOpen() && attempts < 120) {
      setTimeout(function () { showWhenClear(request, attempts + 1); }, 1500);
      return;
    }
    openModal(request);
  }

  function check() {
    fetch("/notices/active", { credentials: "same-origin", headers: { Accept: "application/json" } })
      .then(function (res) { return res.ok ? res.json() : null; })
      .then(function (data) {
        var request = data && data.feedback;
        if (!request || document.querySelector(".mfb-overlay")) return;
        if (!request.required && isSnoozed(request)) return;
        // A short settle pause before the first look - gives an announcement
        // popup (public/js/announcementFeed.js), which fetches independently
        // and can be quicker, a moment to open first if it's going to.
        setTimeout(function () { showWhenClear(request, 0); }, 600);
      })
      .catch(function () {});
  }

  window.ManagiraFeedback = { render: render, check: check };

  if (document.currentScript && document.currentScript.dataset.autoprompt === "1" && window.top === window) {
    var start = function () { setTimeout(check, 1500); };
    if (document.readyState === "complete") start();
    else window.addEventListener("load", start);
  }
})();
