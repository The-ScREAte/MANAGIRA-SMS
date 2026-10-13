// Management workspace pages: give each cell of a `.ws-cards` table its column
// name, so on phones the rows can show as labelled cards (see workspace.css).
(function () {
  function label(root) {
    (root || document).querySelectorAll('table.ws-cards').forEach(function (table) {
      var heads = Array.prototype.map.call(table.querySelectorAll('thead th'), function (th) { return th.textContent.replace(/\s+/g, ' ').trim(); });
      table.querySelectorAll('tbody tr').forEach(function (tr) {
        var col = 0;
        Array.prototype.forEach.call(tr.children, function (cell) {
          if (heads[col] && !cell.hasAttribute('data-label')) cell.setAttribute('data-label', heads[col]);
          col += cell.colSpan || 1;
        });
      });
    });
  }
  window.wsLabelTables = label;
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', function () { label(); });
  else label();
})();
