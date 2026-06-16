(function () {
  'use strict';

  var SORT_ICON = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 12 12" aria-hidden="true" focusable="false"><path fill="currentColor" d="M10 5H2a.5.5 0 0 1-.46-.31.47.47 0 0 1 .11-.54L5.29.5A1 1 0 0 1 6.7.5l3.65 3.65a.49.49 0 0 1 .11.54A.51.51 0 0 1 10 5z"></path><path fill="currentColor" d="M2 7a.5.5 0 0 0-.46.31.47.47 0 0 0 .11.54L5.3 11.5a1 1 0 0 0 1.41 0l3.65-3.65a.49.49 0 0 0 .11-.54A.53.53 0 0 0 10 7z"></path></svg>';

  function shouldSkipByPath() {
    var path = String((window.location && window.location.pathname) || '').toLowerCase();
    return path.indexOf('report') !== -1 || path.indexOf('/print') === 0;
  }

  function ensureStyles() {
    if (document.getElementById('global-table-sort-style')) return;

    var style = document.createElement('style');
    style.id = 'global-table-sort-style';
    style.textContent = [
      '.global-table-sort-btn {',
      '  display:inline-flex;',
      '  align-items:center;',
      '  justify-content:center;',
      '  width:16px;',
      '  height:16px;',
      '  margin-left:6px;',
      '  padding:0;',
      '  border:none;',
      '  background:transparent;',
      '  color:var(--org-primary-color,#01535b);',
      '  cursor:pointer;',
      '  opacity:.78;',
      '  vertical-align:middle;',
      '}',
      '.global-table-sort-btn:hover,',
      '.global-table-sort-btn:focus,',
      '.global-table-sort-btn:active,',
      '.global-table-sort-btn:focus-visible {',
      '  background:transparent !important;',
      '  box-shadow:none !important;',
      '  outline:none;',
      '  color:var(--org-primary-color,#01535b);',
      '}',
      '.global-table-sort-btn svg { width:10px; height:10px; }'
    ].join('');
    document.head.appendChild(style);
  }

  function normalizeValue(value) {
    return String(value || '').replace(/\s+/g, ' ').trim();
  }

  function parseDate(value) {
    var normalized = normalizeValue(value);
    if (!normalized) return NaN;

    var iso = Date.parse(normalized);
    if (!Number.isNaN(iso)) return iso;

    var slash = normalized.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/);
    if (slash) {
      var day = parseInt(slash[1], 10);
      var month = parseInt(slash[2], 10) - 1;
      var year = parseInt(slash[3], 10);
      if (year < 100) year += 2000;
      return new Date(year, month, day).getTime();
    }

    return NaN;
  }

  function parseNumber(value) {
    var normalized = normalizeValue(value);
    if (!normalized) return NaN;

    var raw = normalized.replace(/[^0-9.,-]/g, '');
    if (!raw) return NaN;

    var hasComma = raw.indexOf(',') !== -1;
    var hasDot = raw.indexOf('.') !== -1;

    if (hasComma && hasDot) {
      raw = raw.replace(/,/g, '');
    } else if (hasComma && !hasDot) {
      raw = raw.replace(/,/g, '.');
    }

    var parsed = parseFloat(raw);
    return Number.isNaN(parsed) ? NaN : parsed;
  }

  function compareValues(a, b, direction) {
    var valueA = normalizeValue(a);
    var valueB = normalizeValue(b);

    var emptyA = !valueA;
    var emptyB = !valueB;
    if (emptyA && !emptyB) return 1;
    if (!emptyA && emptyB) return -1;
    if (emptyA && emptyB) return 0;

    var dateA = parseDate(valueA);
    var dateB = parseDate(valueB);
    if (!Number.isNaN(dateA) && !Number.isNaN(dateB)) {
      return direction === 'desc' ? dateB - dateA : dateA - dateB;
    }

    var numA = parseNumber(valueA);
    var numB = parseNumber(valueB);
    if (!Number.isNaN(numA) && !Number.isNaN(numB)) {
      return direction === 'desc' ? numB - numA : numA - numB;
    }

    var textCompare = valueA.localeCompare(valueB, undefined, { sensitivity: 'base', numeric: true });
    return direction === 'desc' ? textCompare * -1 : textCompare;
  }

  function getCellText(row, index) {
    var cell = row.children[index];
    if (!cell) return '';

    var input = cell.querySelector('input, select, textarea');
    if (input && typeof input.value === 'string' && input.value.trim()) {
      return input.value;
    }

    return cell.textContent || '';
  }

  function headerEligible(header) {
    var text = normalizeValue(header.textContent).toLowerCase();
    if (!text) return false;
    if (text === '#' || text.indexOf('action') !== -1 || text.indexOf('select') !== -1) return false;
    if (header.querySelector('input, select, textarea')) return false;

    var existingButton = header.querySelector('button');
    if (existingButton) return false;

    return true;
  }

  function initTable(table) {
    if (!table || table.dataset.globalSortReady === 'true') return;
    if (table.closest('[data-no-global-sort], .no-global-sort')) return;
    if (table.classList.contains('no-global-sort')) return;

    var headRow = table.querySelector('thead tr');
    var body = table.querySelector('tbody');
    if (!headRow || !body) return;

    var rows = Array.from(body.querySelectorAll('tr'));
    if (rows.length < 2) return;

    if (table.querySelector('.as-sort-btn, .pending-sort-btn, .fin-sort-btn, .table-sort-btn, .sort-toggle-btn, .section-sort-btn')) {
      table.dataset.globalSortReady = 'true';
      return;
    }

    var headers = Array.from(headRow.children);
    var sortableCount = 0;

    headers.forEach(function (header, index) {
      if (!headerEligible(header)) return;

      var button = document.createElement('button');
      button.type = 'button';
      button.className = 'global-table-sort-btn';
      button.dataset.sortDirection = 'asc';
      button.dataset.sortIndex = String(index);
      button.setAttribute('aria-label', 'Sort ' + normalizeValue(header.textContent) + ' descending');
      button.innerHTML = SORT_ICON;

      button.addEventListener('click', function () {
        var currentDirection = button.dataset.sortDirection === 'desc' ? 'desc' : 'asc';
        var nextDirection = currentDirection === 'asc' ? 'desc' : 'asc';

        table.querySelectorAll('.global-table-sort-btn').forEach(function (btn) {
          btn.dataset.sortDirection = 'asc';
          var th = btn.closest('th');
          var label = normalizeValue(th ? th.textContent : 'column') || 'column';
          btn.setAttribute('aria-label', 'Sort ' + label + ' descending');
        });

        button.dataset.sortDirection = nextDirection;
        button.setAttribute('aria-label', 'Sort ' + normalizeValue(header.textContent) + ' ' + (nextDirection === 'asc' ? 'descending' : 'ascending'));

        var sortedRows = Array.from(body.querySelectorAll('tr')).sort(function (left, right) {
          var primary = compareValues(getCellText(left, index), getCellText(right, index), nextDirection);
          if (primary !== 0) return primary;
          return compareValues(getCellText(left, 0), getCellText(right, 0), 'asc');
        });

        sortedRows.forEach(function (row) {
          body.appendChild(row);
        });
      });

      header.appendChild(button);
      sortableCount += 1;
    });

    table.dataset.globalSortReady = 'true';
    if (!sortableCount) table.dataset.noGlobalSort = 'true';
  }

  function initGlobalTableSort(root) {
    if (shouldSkipByPath()) return;
    ensureStyles();

    var scope = root && root.querySelectorAll ? root : document;
    scope.querySelectorAll('table').forEach(initTable);
  }

  document.addEventListener('DOMContentLoaded', function () {
    initGlobalTableSort(document);
  });

  window.addEventListener('spa:pageLoaded', function () {
    var main = document.querySelector('main') || document;
    initGlobalTableSort(main);
  });

  window.initGlobalTableSort = initGlobalTableSort;
})();
