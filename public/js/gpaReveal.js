// GPA tiles stay hidden until the eye is tapped; hidden again on every page load (nothing is
// remembered). The number is read from an attribute only when revealed.
(function () {
  function bind(tile) {
    if (tile.dataset.ready) return;
    tile.dataset.ready = "1";
    var eye = tile.querySelector("[data-gpa-eye]");
    var value = tile.querySelector("[data-gpa-value]");
    var detail = tile.querySelector("[data-gpa-detail]");
    eye.addEventListener("click", function (event) {
      event.preventDefault();
      event.stopPropagation();
      var show = eye.getAttribute("aria-pressed") !== "true";
      eye.setAttribute("aria-pressed", String(show));
      eye.setAttribute("aria-label", show ? "Hide GPA" : "Show GPA");
      eye.title = show ? "Hide GPA" : "Show GPA";
      tile.classList.toggle("is-shown", show);
      value.textContent = show ? value.getAttribute("data-value") : "••••";
      if (detail) detail.textContent = show ? detail.getAttribute("data-detail") : (detail.getAttribute("data-detail") ? "Tap the eye to show" : "");
    });
  }
  function start() { document.querySelectorAll("[data-gpa-stat]").forEach(bind); }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", start); else start();
  document.addEventListener("managira:page-ready", start);
})();
