// The student's tiles open at once; how many are open arrives just after.
(function () {
  'use strict';
  function begin() {
    var root = document.querySelector('[data-hub-counts]');
    if (!root || root.dataset.bound) return;
    root.dataset.bound = '1';
    var studentId = root.getAttribute('data-hub-counts');
    var bus = root.querySelector('[data-transport-tile]');
    if (bus) {
      bus.addEventListener('click', function () {
        if (!bus.hasAttribute('data-bus-tracker')) window.location.href = '/guardian/dashboard';
      });
    }
    fetch('/guardian/child/counts?studentId=' + encodeURIComponent(studentId), { credentials: 'same-origin', headers: { Accept: 'application/json' } })
      .then(function (res) { return res.ok ? res.json() : null; })
      .then(function (result) {
        if (!result || !result.success) return;
        root.querySelectorAll('[data-count]').forEach(function (badge) {
          var count = Number(result.counts[badge.getAttribute('data-count')]) || 0;
          badge.textContent = count > 99 ? '99+' : String(count);
          badge.hidden = count === 0;
        });
        if (bus && result.transport) {
          bus.setAttribute('data-transport-snapshot', JSON.stringify(result.transport));
          bus.setAttribute('data-bus-tracker', studentId);
        }
      })
      .catch(function () { /* the tiles still work */ });
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', begin);
  else begin();
  window.addEventListener('spa:pageLoaded', begin);
})();
