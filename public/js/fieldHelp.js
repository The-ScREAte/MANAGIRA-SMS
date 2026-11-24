// Keeps a field-help bubble inside the screen: shifts it sideways, or flips it below, when it would be clipped.
(function () {
  if (window.__fieldHelp) return;
  window.__fieldHelp = true;
  function place(wrap) {
    var tip = wrap.querySelector('.fh__tip');
    if (!tip) return;
    tip.style.setProperty('--fh-shift', '-50%');
    tip.style.bottom = ''; tip.style.top = '';
    var r = tip.getBoundingClientRect();
    var vw = document.documentElement.clientWidth;
    var dx = 0;
    if (r.left < 8) dx = 8 - r.left;
    else if (r.right > vw - 8) dx = (vw - 8) - r.right;
    if (dx) tip.style.setProperty('--fh-shift', 'calc(-50% + ' + Math.round(dx) + 'px)');
    if (r.top < 8) { tip.style.bottom = 'auto'; tip.style.top = 'calc(100% + 7px)'; }
  }
  function on(e) { var w = e.target.closest && e.target.closest('.fh'); if (w) { var tip = w.querySelector('.fh__tip'); if (tip) { tip.style.display = 'block'; place(w); tip.style.display = ''; } } }
  document.addEventListener('mouseover', on);
  document.addEventListener('focusin', on);
  document.addEventListener('touchstart', on, { passive: true });
  document.addEventListener('keydown', function (e) { if (e.key === 'Escape') { var a = document.activeElement; if (a && a.classList && a.classList.contains('fh__btn')) a.blur(); } });
})();
