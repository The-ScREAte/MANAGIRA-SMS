  function renderArrearsRecipients(selectedIds) {
    var host = document.getElementById('arrearsRecipientList');
    var count = document.getElementById('arrearsRecipientCount');
    if (!host) return;
    var ids = Array.isArray(selectedIds) ? selectedIds : getSelectedArrearsIds();
    var wanted = ids.length ? arrearsRecipients.filter(function(item) { return ids.indexOf(String(item.student_id)) !== -1; }) : arrearsRecipients;
    count.textContent = wanted.length + (wanted.length === 1 ? ' parent' : ' parents');
    if (!wanted.length) {
      host.innerHTML = '<div class="empty-state" style="padding:26px 10px;"><h3>Nobody chosen yet</h3><p>Tick one or more students in the list first.</p></div>';
      return;
    }
    host.innerHTML = wanted.map(function(item) {
      var merged = getMergedArrearsRecipient(item.student_id);
      var status = merged.guardian_email ? 'ready' : (merged.guardian_name ? 'missing_email' : 'missing_guardian');
      return '<div class="arrears-recipient-item">'
        + '<div style="flex:1;min-width:0;"><strong>' + (merged.student_name || 'Student') + '</strong><span>' + (merged.guardian_name || 'No guardian') + ' · ' + (merged.guardian_email || merged.guardian_phone || 'No contact') + '</span><span>' + (merged.class_name || 'No class') + ' · ' + fmt(merged.outstanding || 0) + '</span>'
        + '<div id="arrears-recipient-editor-' + item.student_id + '" style="display:none;margin-top:10px;">'
        + '<div class="fin-row" style="grid-template-columns:1fr 1fr;gap:8px;">'
        + '<div class="fin-field"><label style="font-size:.72rem;">Guardian Name</label><input type="text" value="' + (merged.guardian_name || '').replace(/"/g, '&quot;') + '" data-oninput="fin.recipient.guardian_name" data-mga0="' + item.student_id + '"></div>'
        + '<div class="fin-field"><label style="font-size:.72rem;">Relationship</label><input type="text" value="' + (merged.guardian_relationship || 'Guardian').replace(/"/g, '&quot;') + '" data-oninput="fin.recipient.relationship" data-mga0="' + item.student_id + '"></div>'
        + '</div>'
        + '<div class="fin-row" style="grid-template-columns:1fr 1fr;gap:8px;">'
        + '<div class="fin-field"><label style="font-size:.72rem;">Email</label><input type="email" value="' + (merged.guardian_email || '').replace(/"/g, '&quot;') + '" data-oninput="fin.recipient.email" data-mga0="' + item.student_id + '"></div>'
        + '<div class="fin-field"><label style="font-size:.72rem;">Phone</label><input type="text" value="' + (merged.guardian_phone || '').replace(/"/g, '&quot;') + '" data-oninput="fin.recipient.phone" data-mga0="' + item.student_id + '"></div>'
        + '</div></div></div>'
        + '<div style="display:flex;align-items:flex-start;gap:8px;flex-shrink:0;">'
        + '<button type="button" class="fin-btn sm" data-onclick="fin.recipientEditor" data-mga0="' + item.student_id + '">✎</button>'
        + '<span class="flag ' + status + '">' + (status === 'ready' ? 'Ready' : (status === 'missing_email' ? 'Missing Email' : 'Missing Guardian')) + '</span>'
        + '</div>'
        + '</div>';
    }).join('');
  }
  window.openArrearsEmailDrawer = function (studentId, openEditor) {
    if (studentId) {
      clearArrearsSelection();
      var checkbox = document.querySelector('.arrears-select[value="' + studentId + '"]');
      if (checkbox) checkbox.checked = true;
      syncArrearsSelection();
    } else {
      syncArrearsSelection();
    }
    injectArrearsFilterPayload(document.getElementById('arrearsEmailForm'));
    renderArrearsRecipients(studentId ? [String(studentId)] : getSelectedArrearsIds());
    setModalOpen('arrearsEmailModal', true);
    if (studentId && openEditor) {
      var editor = document.getElementById('arrears-recipient-editor-' + studentId);
      if (editor) editor.style.display = '';
    }
  };
  window.openArrearsEmailAll = function () {
    injectArrearsFilterPayload(document.getElementById('arrearsEmailForm'));
    var emailField = document.getElementById('arrearsEmailSelectedIds');
    if (emailField) emailField.value = '';
    renderArrearsRecipients([]);
    setModalOpen('arrearsEmailModal', true);
  };
  window.closeArrearsEmailDrawer = function () { setModalOpen('arrearsEmailModal', false); };
  window.openArrearsNoteModal = function (studentId, studentName) {
    var idField = document.getElementById('arrearsNoteStudentId');
    var nameField = document.getElementById('arrearsNoteStudentName');
    if (idField) idField.value = studentId;
    if (nameField) nameField.value = studentName || '';
    setModalOpen('arrearsNoteModal', true);
  };
  window.closeArrearsNoteModal = function () { setModalOpen('arrearsNoteModal', false); };
  document.querySelectorAll('.arrears-select').forEach(function(cb) {
    cb.addEventListener('change', syncArrearsSelection);
  });
  syncArrearsSelection();
  syncArrearsManualRecipients();

  /* Collapsible arrears panels — default closed on every screen */
  document.querySelectorAll('[data-arrears-collapse]').forEach(function(panel) {
    var toggle = panel.querySelector('[data-arrears-collapse-toggle]');
    if (!toggle) return;
    toggle.addEventListener('click', function () {
      var willOpen = !panel.classList.contains('open');
      panel.classList.toggle('open', willOpen);
      toggle.setAttribute('aria-expanded', willOpen ? 'true' : 'false');
      var badge = toggle.querySelector('.badge');
      if (badge) badge.textContent = willOpen ? 'Open' : 'Tap to open';
    });
  });

  window.bindOverviewFilters = function () {
    var overviewYearSelect = document.getElementById('finOverviewYear');
    var overviewTermSelect = document.getElementById('finOverviewTerm');
    if (!overviewYearSelect || !overviewTermSelect) return;
    if (overviewYearSelect.dataset.boundOverviewFilter === 'true') return;
    overviewYearSelect.dataset.boundOverviewFilter = 'true';
    overviewTermSelect.dataset.boundOverviewFilter = 'true';
    window.syncSingleTermSelect(overviewYearSelect, overviewTermSelect, { keepBlankWhenYearChanges: false });
    overviewYearSelect.addEventListener('change', function () {
      window.syncSingleTermSelect(overviewYearSelect, overviewTermSelect, { keepBlankWhenYearChanges: true });
      overviewYearSelect.form && overviewYearSelect.form.submit();
    });
    overviewTermSelect.addEventListener('change', function () {
      overviewTermSelect.form && overviewTermSelect.form.submit();
    });
  };
  window.bindOverviewFilters();

  var billListYearFilter = document.getElementById('billListYearFilter');
  var billListTermFilter = document.getElementById('billListTermFilter');
  if (billListYearFilter && billListTermFilter) {
    window.syncSingleTermSelect(billListYearFilter, billListTermFilter, { keepBlankWhenYearChanges: false });
    billListYearFilter.addEventListener('change', function () {
      window.syncSingleTermSelect(billListYearFilter, billListTermFilter, { keepBlankWhenYearChanges: true });
      billListYearFilter.form.submit();
    });
    billListTermFilter.addEventListener('change', function () { billListTermFilter.form.submit(); });
  }

  var studentBillingYearFilter = document.getElementById('studentBillingYearFilter');
  var studentBillingTermFilter = document.getElementById('studentBillingTermFilter');
  if (studentBillingYearFilter && studentBillingTermFilter) {
    window.syncSingleTermSelect(studentBillingYearFilter, studentBillingTermFilter, { keepBlankWhenYearChanges: false });
    studentBillingYearFilter.addEventListener('change', function () {
      window.syncSingleTermSelect(studentBillingYearFilter, studentBillingTermFilter, { keepBlankWhenYearChanges: true });
      studentBillingYearFilter.form.submit();
    });
    studentBillingTermFilter.addEventListener('change', function () { studentBillingTermFilter.form.submit(); });
  }

  // Filter pop-ups: one open at a time; a click elsewhere or Esc closes them.
  if (!window.__finFilterPopBound) {
    window.__finFilterPopBound = true;
    document.addEventListener('click', function (e) {
      document.querySelectorAll('[data-fin-filter][open]').forEach(function (fold) {
        if (!fold.contains(e.target)) fold.removeAttribute('open');
      });
    });
    document.addEventListener('keydown', function (e) {
      if (e.key !== 'Escape') return;
      document.querySelectorAll('[data-fin-filter][open]').forEach(function (fold) {
        fold.removeAttribute('open');
        var summary = fold.querySelector('summary');
        if (summary) summary.focus();
      });
    });
    document.addEventListener('toggle', function (e) {
      var fold = e.target;
      if (!fold.matches || !fold.matches('[data-fin-filter]') || !fold.open) return;
      document.querySelectorAll('[data-fin-filter][open]').forEach(function (other) { if (other !== fold) other.removeAttribute('open'); });
      var first = fold.querySelector('select, input:not([type=hidden])');
      if (first) first.focus();
    }, true);
  }

  var billCreateYearSelect = document.getElementById('billCreateYearSelect');
  var billCreateTermSelect = document.getElementById('billCreateTermSelect');
  var billTypeSelect = document.getElementById('billTypeSel');
  var billCreateRecurrenceSelect = document.getElementById('billCreateRecurrence');
  var billCreateExcludeCheckbox = document.getElementById('billCreateExcludeNonSchoolDays');
  var billCreateStartDate = document.getElementById('billCreateStartDate');
  var billCreateEndDate = document.getElementById('billCreateEndDate');
  if (billTypeSelect) {
    window.syncBillScheduleControls(billTypeSelect, billCreateRecurrenceSelect, billCreateExcludeCheckbox);
    billTypeSelect.addEventListener('change', function () {
      window.syncBillScheduleControls(billTypeSelect, billCreateRecurrenceSelect, billCreateExcludeCheckbox);
    });
  }
  if (billCreateYearSelect && billCreateTermSelect) {
    window.syncSingleTermSelect(billCreateYearSelect, billCreateTermSelect, { keepBlankWhenYearChanges: false });
    window.syncBillTargetClasses();
    window.syncBillTargetStudents();
    window.autofillBillScheduleDates(billCreateTermSelect, billCreateStartDate, billCreateEndDate);
    syncCreateBillDateLimits();
    billCreateYearSelect.addEventListener('change', function () {
      window.syncSingleTermSelect(billCreateYearSelect, billCreateTermSelect, { keepBlankWhenYearChanges: true });
      window.syncBillTargetClasses();
      window.syncBillTargetStudents();
      window.autofillBillScheduleDates(billCreateTermSelect, billCreateStartDate, billCreateEndDate);
      syncCreateBillDateLimits();
    });
    billCreateTermSelect.addEventListener('change', function () {
      window.syncBillTargetClasses();
      window.syncBillTargetStudents();
      window.autofillBillScheduleDates(billCreateTermSelect, billCreateStartDate, billCreateEndDate);
      syncCreateBillDateLimits();
    });
  }
  if (billCreateStartDate) billCreateStartDate.addEventListener('change', syncCreateBillDateLimits);
  if (billCreateEndDate) billCreateEndDate.addEventListener('change', syncCreateBillDateLimits);
  var createBillDraftRuntime = (typeof window !== 'undefined' && typeof window.createBillDraft !== 'undefined')
    ? window.createBillDraft
    : null;
  if (createBillDraftRuntime) applyCreateBillDraft(createBillDraftRuntime);
  syncCreateBillPaymentMethodMaster();
  syncCreateBillDateLimits();
  var shouldOpenCreateBillFormRuntime = (typeof window !== 'undefined' && typeof window.shouldOpenCreateBillForm !== 'undefined')
    ? window.shouldOpenCreateBillForm
    : false;
  if (shouldOpenCreateBillFormRuntime) {
    var createBillAccordion = document.getElementById('acc-create-bill');
    if (createBillAccordion && !createBillAccordion.classList.contains('open')) {
      finToggleAcc('acc-create-bill');
    }
  }

  var editBillYearSelect = document.getElementById('ebl-school_year_id');
  var editBillTermSelect = document.getElementById('ebl-term_id');
  var editBillAudienceSelect = document.getElementById('ebl-applies_to');
  var editBillTypeSelect = document.getElementById('ebl-bill_type');
  var editBillRecurrenceSelect = document.getElementById('ebl-recurrence');
  var editBillExcludeCheckbox = document.getElementById('ebl-exclude_non_school_days');
  var editBillStartDate = document.getElementById('ebl-due_date');
  var editBillEndDate = document.getElementById('ebl-recurrence_end_date');
  if (editBillTypeSelect) {
    window.syncBillScheduleControls(editBillTypeSelect, editBillRecurrenceSelect, editBillExcludeCheckbox);
    editBillTypeSelect.addEventListener('change', function () {
      window.syncBillScheduleControls(editBillTypeSelect, editBillRecurrenceSelect, editBillExcludeCheckbox);
    });
  }
  if (editBillYearSelect && editBillTermSelect) {
    window.syncSingleTermSelect(editBillYearSelect, editBillTermSelect, { keepBlankWhenYearChanges: false });
    if (typeof syncEditBillTargets === 'function') syncEditBillTargets();
    editBillYearSelect.addEventListener('change', function () {
      window.syncSingleTermSelect(editBillYearSelect, editBillTermSelect, { keepBlankWhenYearChanges: true });
      if (typeof syncEditBillTargets === 'function') syncEditBillTargets();
      window.autofillBillScheduleDates(editBillTermSelect, editBillStartDate, editBillEndDate);
    });
    editBillTermSelect.addEventListener('change', function () {
      if (typeof syncEditBillTargets === 'function') syncEditBillTargets();
      window.autofillBillScheduleDates(editBillTermSelect, editBillStartDate, editBillEndDate);
    });
  }
  if (editBillAudienceSelect && typeof syncEditBillTargets === 'function') {
    editBillAudienceSelect.addEventListener('change', syncEditBillTargets);
  }
  ['ebl-target_class_ids', 'ebl-target_student_ids'].forEach(function(id) {
    var select = document.getElementById(id);
    if (select && typeof syncEditBillTargets === 'function') {
      select.addEventListener('change', syncEditBillTargets);
    }
  });
  [['ebl-target_class_search', 'ebl-target_class_ids'], ['ebl-target_student_search', 'ebl-target_student_ids']].forEach(function(pair) {
    var input = document.getElementById(pair[0]);
    if (!input) return;
    input.addEventListener('input', function () {
      if (typeof filterEditBillTargetOptions === 'function') filterEditBillTargetOptions(pair[1], input.value || '');
    });
  });
  [['ebl-target_class_select_all', 'ebl-target_class_ids', true], ['ebl-target_class_clear', 'ebl-target_class_ids', false], ['ebl-target_student_select_all', 'ebl-target_student_ids', true], ['ebl-target_student_clear', 'ebl-target_student_ids', false]].forEach(function(config) {
    var button = document.getElementById(config[0]);
    if (!button) return;
    button.addEventListener('click', function () {
      if (typeof setAllEditBillTargets === 'function') setAllEditBillTargets(config[1], config[2]);
    });
  });
  ['ebl-target_class_ids', 'ebl-target_student_ids'].forEach(function(id) {
    if (typeof enableEditBillToggleMultiSelect === 'function') enableEditBillToggleMultiSelect(id);
  });
  var editBillAssigneeSelect = document.getElementById('ebl-assignee');
  if (editBillAssigneeSelect && typeof syncEditBillCollectorSummary === 'function') {
    editBillAssigneeSelect.addEventListener('change', syncEditBillCollectorSummary);
    syncEditBillCollectorSummary();
  }
  var editBillPayAll = document.getElementById('ebl-payAll');
  if (editBillPayAll) {
    editBillPayAll.addEventListener('change', function () {
      if (typeof toggleAllEditBillPaymentMethods === 'function') toggleAllEditBillPaymentMethods(editBillPayAll.checked);
    });
  }
  document.querySelectorAll('.ebl-pay-method').forEach(function(input) {
    input.addEventListener('change', function () {
      if (typeof syncEditBillPaymentMethodMaster === 'function') syncEditBillPaymentMethodMaster();
    });
  });
  if (typeof syncEditBillPaymentMethodMaster === 'function') syncEditBillPaymentMethodMaster();

  document.querySelectorAll('[data-arrears-multiselect]').forEach(function(box) {
    box.setAttribute('data-empty-label', box.querySelector('[data-arrears-summary]') ? box.querySelector('[data-arrears-summary]').textContent : 'All items');
    box.setAttribute('data-empty-meta', box.querySelector('[data-arrears-meta]') ? box.querySelector('[data-arrears-meta]').textContent : 'No filters applied');
    var trigger = box.querySelector('[data-arrears-trigger]');
    if (trigger) {
      trigger.addEventListener('click', function () {
        var willOpen = !box.classList.contains('open');
        closeArrearsMultiselects(box);
        box.classList.toggle('open', willOpen);
      });
    }
    var selectAll = box.querySelector('[data-arrears-select-all]');
    if (selectAll) {
      selectAll.addEventListener('click', function () {
        box.querySelectorAll('input[type="checkbox"]').forEach(function(input) {
          var option = input.closest('.arrears-multiselect-option');
          if (input.disabled || (option && option.hidden)) return;
          input.checked = true;
        });
        if (box.querySelector('input[name="schoolYearIds"]')) window.syncArrearsYearTerms();
        else if (box.querySelector('input[name="termIds"]')) window.syncArrearsClasses();
        updateArrearsMultiselectSummary(box);
      });
    }
    var clear = box.querySelector('[data-arrears-clear]');
    if (clear) {
      clear.addEventListener('click', function () {
        box.querySelectorAll('input[type="checkbox"]').forEach(function(input) { input.checked = false; });
        if (box.querySelector('input[name="schoolYearIds"]')) window.syncArrearsYearTerms();
        else if (box.querySelector('input[name="termIds"]')) window.syncArrearsClasses();
        updateArrearsMultiselectSummary(box);
      });
    }
    box.querySelectorAll('input[type="checkbox"]').forEach(function(input) {
      input.addEventListener('change', function () {
        if (input.name === 'schoolYearIds') window.syncArrearsYearTerms();
        if (input.name === 'termIds') window.syncArrearsClasses();
        updateArrearsMultiselectSummary(box);
      });
    });
    updateArrearsMultiselectSummary(box);
  });
  window.syncArrearsYearTerms();

  document.addEventListener('click', function (event) {
    var holder = event.target.closest('[data-arrears-multiselect]');
    if (!holder) closeArrearsMultiselects();
  });

  document.addEventListener('keydown', function (event) {
    if (event.key === 'Escape') closeArrearsMultiselects();
  });

  if (arrearsPresetForm) {
    arrearsPresetForm.addEventListener('submit', function () { injectArrearsFilterPayload(arrearsPresetForm); });
  }
  document.querySelectorAll('[data-arrears-preset]').forEach(function(btn) {
    btn.addEventListener('click', function () {
      if (!arrearsFilterForm) return;
      var filters = {};
      try { filters = JSON.parse(btn.getAttribute('data-arrears-preset') || '{}'); } catch (_) { filters = {}; }
      ['schoolYearIds','termIds','classIds','billIds'].forEach(function(name) {
        var selected = filters[name] || [];
        arrearsFilterForm.querySelectorAll('input[name="' + name + '"]').forEach(function(input) {
          input.checked = selected.indexOf(String(input.value)) !== -1;
        });
      });
      window.syncArrearsYearTerms();
      arrearsFilterForm.querySelectorAll('input[name="statuses"]').forEach(function(input) {
        input.checked = (filters.statuses || []).indexOf(input.value) !== -1;
      });
      ['dueFrom','dueTo','minOutstanding','search','paymentMethodFilter','emailStatusFilter'].forEach(function(name) {
        var el = arrearsFilterForm.querySelector('[name="' + name + '"]');
        if (el) el.value = filters[name] || (name === 'minOutstanding' ? '' : '');
      });
      document.querySelectorAll('[data-arrears-multiselect]').forEach(function(box) { updateArrearsMultiselectSummary(box); });
      arrearsFilterForm.submit();
    });
  });

  function finSetPrimaryChargeCard(authorizationCode) {
    return fetch('/account/cards/set-primary', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ authorizationCode: authorizationCode })
    });
  }

  function finSetFallbackOrder(authorizationCode, fallbackOrder) {
    return fetch('/account/cards/set-fallback-order', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ authorizationCode: authorizationCode, fallbackOrder: fallbackOrder })
    });
  }

  document.querySelectorAll('[data-fin-set-primary]').forEach(function(button) {
    button.addEventListener('click', async function () {
      try {
        var res = await finSetPrimaryChargeCard(button.getAttribute('data-fin-set-primary'));
        var data = await res.json();
        if (data && data.success) window.location.reload();
        else alert((data && data.message) || 'Failed to update primary card.');
      } catch (error) {
        alert('Unable to update the primary card right now.');
      }
    });
  });

  document.querySelectorAll('[data-fin-fallback-order]').forEach(function(input) {
    var submitFallback = async function () {
      try {
        var res = await finSetFallbackOrder(input.getAttribute('data-fin-fallback-order'), input.value.trim());
        var data = await res.json();
        if (data && data.success) window.location.reload();
        else alert((data && data.message) || 'Failed to update fallback order.');
      } catch (error) {
        alert('Unable to update fallback order right now.');
      }
    };
    input.addEventListener('change', submitFallback);
    input.addEventListener('blur', submitFallback);
  });

  // ===== Client-side table pagination (audit-log style) =====
  function finBuildPager(opts) {
    var bar = opts.bar;
    if (!bar) return null;
    var sizeSel = bar.querySelector('[data-fin-pagesize]');
    var prevBtn = bar.querySelector('[data-fin-prev]');
    var nextBtn = bar.querySelector('[data-fin-next]');
    var info = bar.querySelector('[data-fin-info]');
    var state = { size: sizeSel ? (Number(sizeSel.value) || 20) : 20, page: 1 };
    function render() {
      var items = opts.getItems();
      var visible = items.filter(function(it) { return opts.isVisible ? opts.isVisible(it.main) : true; });
      var total = visible.length;
      var totalPages = Math.max(1, Math.ceil(total / state.size));
      if (state.page > totalPages) state.page = totalPages;
      if (state.page < 1) state.page = 1;
      var start = (state.page - 1) * state.size;
      var end = start + state.size;
      items.forEach(function(it) {
        it.main.style.display = 'none';
        (it.extras || []).forEach(function(ex) { ex.style.display = 'none'; });
      });
      visible.slice(start, end).forEach(function(it) { it.main.style.display = ''; });
      if (info) info.textContent = state.page + '/' + totalPages;
      if (prevBtn) prevBtn.disabled = state.page <= 1;
      if (nextBtn) nextBtn.disabled = state.page >= totalPages;
      // Show the bar whenever there is data so the page-size control stays reachable.
      bar.hidden = total === 0;
    }
    function scrollTop() { if (opts.wrap) opts.wrap.scrollTop = 0; }
    if (sizeSel) sizeSel.addEventListener('change', function() {
      state.size = Number(sizeSel.value) || 20;
      state.page = 1;
      render();
      scrollTop();
    });
    if (prevBtn) prevBtn.addEventListener('click', function() {
      if (state.page > 1) { state.page -= 1; render(); scrollTop(); }
    });
    if (nextBtn) nextBtn.addEventListener('click', function() {
      state.page += 1; render(); scrollTop();
    });
    render();
    return { refresh: render, reset: function() { state.page = 1; render(); } };
  }

  (function initFinPagers() {
    // Payment History
    var paymentsWrap = document.getElementById('finPaymentsWrap');
    var paymentsBar = document.getElementById('finPaymentsPagebar');
    if (paymentsWrap && paymentsBar) {
      var pBody = paymentsWrap.querySelector('tbody');
      window.finPaymentsPager = finBuildPager({
        bar: paymentsBar,
        wrap: paymentsWrap,
        getItems: function() {
          return Array.prototype.map.call(pBody.querySelectorAll(':scope > tr'), function(tr) {
            return { main: tr, extras: [] };
          });
        }
      });
    }

    // Defaulters & Arrears (main row + its detail row)
    var arrearsTable = document.getElementById('arrearsTable');
    var arrearsBar = document.getElementById('finArrearsPagebar');
    if (arrearsTable && arrearsBar) {
      var aBody = arrearsTable.querySelector('tbody');
      window.finArrearsPager = finBuildPager({
        bar: arrearsBar,
        wrap: document.getElementById('finArrearsWrap'),
        getItems: function() {
          var items = [];
          Array.prototype.forEach.call(aBody.querySelectorAll(':scope > tr'), function(tr) {
            if (tr.id && tr.id.indexOf('arrears-detail-') === 0) {
              if (items.length) items[items.length - 1].extras.push(tr);
            } else {
              items.push({ main: tr, extras: [] });
            }
          });
          return items;
        }
      });
    }
  })();


