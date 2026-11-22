  var arrearsManualRecipients = {};
  function updateArrearsMultiselectSummary(box) {
    if (!box) return;
    var summary = box.querySelector('[data-arrears-summary]');
    var meta = box.querySelector('[data-arrears-meta]');
    var checked = Array.prototype.slice.call(box.querySelectorAll('input[type="checkbox"]:checked'));
    var labels = checked.map(function(input) {
      var copy = input.closest('.arrears-multiselect-option');
      var strong = copy ? copy.querySelector('strong') : null;
      return strong ? strong.textContent.trim() : String(input.value || '').trim();
    }).filter(Boolean);
    if (summary) {
      if (!labels.length) summary.textContent = box.getAttribute('data-empty-label') || 'All items';
      else if (labels.length === 1) summary.textContent = labels[0];
      else summary.textContent = labels.length + ' selected';
    }
    if (meta) {
      meta.textContent = labels.length ? (labels.length + ' chosen') : (box.getAttribute('data-empty-meta') || 'Ready');
    }
    box.querySelectorAll('.arrears-multiselect-option').forEach(function(option) {
      var input = option.querySelector('input[type="checkbox"]');
      option.classList.toggle('checked', !!(input && input.checked));
    });
  }
  function closeArrearsMultiselects(exceptBox) {
    document.querySelectorAll('[data-arrears-multiselect]').forEach(function(box) {
      if (box !== exceptBox) box.classList.remove('open');
    });
  }
  function syncArrearsManualRecipients() {
    var input = document.getElementById('arrearsManualGuardiansJson');
    if (input) input.value = JSON.stringify(arrearsManualRecipients);
  }
  function getArrearsRecipient(studentId) {
    var id = String(studentId);
    return arrearsRecipients.find(function(item) { return String(item.student_id) === id; }) || null;
  }
  function getMergedArrearsRecipient(studentId) {
    var base = getArrearsRecipient(studentId) || { student_id: studentId };
    var manual = arrearsManualRecipients[String(studentId)] || {};
    return {
      student_id: base.student_id,
      student_name: base.student_name || 'Student',
      class_name: base.class_name || '',
      outstanding: base.outstanding || 0,
      guardian_name: manual.guardian_name != null ? manual.guardian_name : (base.guardian_name || ''),
      guardian_email: manual.email != null ? manual.email : (base.guardian_email || ''),
      guardian_phone: manual.phone != null ? manual.phone : (base.guardian_phone || ''),
      guardian_relationship: manual.relationship != null ? manual.relationship : (base.guardian_relationship || 'Guardian'),
    };
  }
  function getSelectedArrearsIds() {
    return Array.prototype.slice.call(document.querySelectorAll('.arrears-select:checked')).map(function(cb) { return cb.value; });
  }
  function syncArrearsSelection() {
    var ids = getSelectedArrearsIds();
    var count = document.getElementById('arrearsSelectedCount');
    if (count) count.textContent = ids.length + ' selected';
    var reportField = document.getElementById('arrearsReportSelectedIds');
    if (reportField) reportField.value = ids.join(',');
    var emailField = document.getElementById('arrearsEmailSelectedIds');
    if (emailField) emailField.value = ids.join(',');
    var selectAll = document.getElementById('arrearsSelectAll');
    var all = document.querySelectorAll('.arrears-select');
    if (selectAll && all.length) selectAll.checked = ids.length === all.length;
  }
  window.toggleAllArrears = function (source) {
    document.querySelectorAll('.arrears-select').forEach(function(cb) { cb.checked = !!source.checked; });
    syncArrearsSelection();
  };
  window.clearArrearsSelection = function () {
    document.querySelectorAll('.arrears-select').forEach(function(cb) { cb.checked = false; });
    var selectAll = document.getElementById('arrearsSelectAll');
    if (selectAll) selectAll.checked = false;
    syncArrearsSelection();
  };
  window.toggleArrearsDetails = function (studentId) {
    var row = document.getElementById('arrears-detail-' + studentId);
    if (!row) return;
    row.style.display = row.style.display === 'none' ? '' : 'none';
  };
  function injectArrearsFilterPayload(form) {
    if (!form || !arrearsFilterForm) return;
    var host = form.querySelector('.arrears-filter-payload');
    if (!host) return;
    host.innerHTML = '';
    var fd = new FormData(arrearsFilterForm);
    fd.forEach(function(value, key) {
      var input = document.createElement('input');
      input.type = 'hidden';
      input.name = key;
      input.value = value;
      host.appendChild(input);
    });
  }
  function setModalOpen(id, open) {
    var modal = document.getElementById(id);
    if (modal) modal.classList[open ? 'add' : 'remove']('open');
    /* Lock body scroll while any arrears modal is open to prevent
       the "ghost scroll / stuck UI" feeling on small screens. */
    var anyOpen = !!document.querySelector('#arrearsReportModal.open, #arrearsEmailModal.open, #arrearsNoteModal.open');
    document.body.style.overflow = anyOpen ? 'hidden' : '';
  }
  /* Click outside arrears modal panel closes it */
  ['arrearsReportModal','arrearsEmailModal','arrearsNoteModal'].forEach(function(id) {
    var m = document.getElementById(id);
    if (!m) return;
    m.addEventListener('click', function(e) { if (e.target === m) setModalOpen(id, false); });
  });
  document.addEventListener('keydown', function (e) {
    if (e.key !== 'Escape') return;
    ['arrearsReportModal','arrearsEmailModal','arrearsNoteModal'].forEach(function(id) {
      var m = document.getElementById(id);
      if (m && m.classList.contains('open')) setModalOpen(id, false);
    });
  });
  window.openArrearsReportModal = function () {
    injectArrearsFilterPayload(document.getElementById('arrearsReportForm'));
    syncArrearsSelection();
    setModalOpen('arrearsReportModal', true);
  };
  window.closeArrearsReportModal = function () { setModalOpen('arrearsReportModal', false); };
  window.toggleArrearsRecipientEditor = function (studentId) {
    var editor = document.getElementById('arrears-recipient-editor-' + studentId);
    if (!editor) return;
    editor.style.display = editor.style.display === 'none' ? '' : 'none';
  };
  window.updateArrearsRecipientField = function (studentId, field, value) {
    var id = String(studentId);
    var manual = arrearsManualRecipients[id] || {};
    manual[field] = value;
    arrearsManualRecipients[id] = manual;
    syncArrearsManualRecipients();
  };
  // Money in the school's currency (this script runs on its own, apart from the student drawer's).
