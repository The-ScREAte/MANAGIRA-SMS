(function () {
  "use strict";

  var prefersReducedMotion = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  document.querySelectorAll("[data-mira-logo][data-mira-logo-idle-after-entrance]").forEach(function (el) {
    if (prefersReducedMotion) return;

    el.addEventListener("animationend", function onEntranceEnd(event) {
      if (event.animationName !== "miraLogoEntrance") return;
      el.classList.remove("mira-logo-entrance");
      el.classList.add("mira-logo-idle");
      el.removeEventListener("animationend", onEntranceEnd);
    });
  });
})();
