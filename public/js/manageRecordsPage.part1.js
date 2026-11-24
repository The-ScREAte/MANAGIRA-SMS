      let pendingEnrollmentSubmitForm = null;
      let pendingEnrollmentPreviousTermId = null;

      function getSelectedEnrollMode() {
        const selectedModeInput = document.querySelector('#enrollCopyModal input[name="enrollCopyMode"]:checked');
        return selectedModeInput ? String(selectedModeInput.value) : 'classes_only';
      }

      function renderEnrollCopyClassGrid(selectedMode) {
        const grid = document.getElementById('enrollCopyClassGrid');
        if (!grid) return;

        const previousClassMap = new Map(
          (Array.isArray(previousTermEnrollmentClasses) ? previousTermEnrollmentClasses : [])
            .filter((item) => Number.isFinite(Number(item.class_id)))
            .map((item) => [Number(item.class_id), {
              class_id: Number(item.class_id),
              class_name: String(item.class_name || `Class ${item.class_id}`),
              student_count: Number(item.student_count || 0),
            }])
        );

        const checkedClassIds = new Set(
          Array.from(grid.querySelectorAll('.enroll-copy-class-checkbox:checked'))
            .map((checkbox) => Number(checkbox.value))
            .filter((value) => Number.isFinite(value))
        );

        const classes = (Array.isArray(organizationEnrollmentClasses) ? organizationEnrollmentClasses : [])
          .filter((item) => Number.isFinite(Number(item.class_id)))
          .map((item) => {
            const classId = Number(item.class_id);
            const previousMeta = previousClassMap.get(classId);
            return {
              class_id: classId,
              class_name: String(item.class_name || previousMeta?.class_name || `Class ${classId}`),
              student_count: previousMeta ? Number(previousMeta.student_count || 0) : 0,
              wasEnrolledPreviously: Boolean(previousMeta),
            };
          });

        grid.innerHTML = classes.map((item) => {
          const classId = Number(item.class_id);
          const className = String(item.class_name || `Class ${classId}`);
          const studentCount = Number(item.student_count || 0);
          const isChecked = checkedClassIds.size > 0
            ? checkedClassIds.has(classId)
            : Boolean(item.wasEnrolledPreviously);
          const subtitle = selectedMode === 'classes_and_students'
            ? (item.wasEnrolledPreviously
              ? ` <small>(${studentCount} student${studentCount === 1 ? '' : 's'})</small>`
              : ' <small>(no previous-term students to carry)</small>')
            : (item.wasEnrolledPreviously
              ? ' <small>(enrolled in previous term)</small>'
              : ' <small>(new class for next term)</small>');

          return `
            <label class="enroll-copy-class-item">
              <input type="checkbox" class="enroll-copy-class-checkbox" value="${classId}" ${isChecked ? 'checked' : ''}>
              <span>${className}${subtitle}</span>
            </label>
          `;
        }).join('');
      }

      function setEnrollmentCopyInputs(form, enabled, selectedClassIds, previousTermId, mode) {
        const enrollHidden = form.querySelector('.enroll-previous-term-hidden');
        const modeHidden = form.querySelector('.enroll-previous-term-mode-hidden');
        const previousHidden = form.querySelector('.previous-current-term-hidden');
        const classInputContainer = form.querySelector('.enroll-class-inputs');
        if (!enrollHidden || !modeHidden || !previousHidden || !classInputContainer) return;

        enrollHidden.value = enabled ? '1' : '0';
        modeHidden.value = enabled ? String(mode || 'classes_and_students') : '';
        previousHidden.value = enabled && Number.isFinite(Number(previousTermId)) ? String(Number(previousTermId)) : '';

        classInputContainer.innerHTML = '';
        if (!enabled) return;

        (Array.isArray(selectedClassIds) ? selectedClassIds : []).forEach((classId) => {
          const parsedClassId = Number(classId);
          if (!Number.isFinite(parsedClassId)) return;
          const input = document.createElement('input');
          input.type = 'hidden';
          input.name = 'enrollClassIds[]';
          input.value = String(parsedClassId);
          classInputContainer.appendChild(input);
        });
      }

      function closeEnrollCopyModal() {
        const modal = document.getElementById('enrollCopyModal');
        if (modal) {
          modal.classList.remove('is-open');
        }
        pendingEnrollmentSubmitForm = null;
        pendingEnrollmentPreviousTermId = null;
      }

      function closeEnrollDecisionModal() {
        const modal = document.getElementById('enrollDecisionModal');
        if (modal) {
          modal.classList.remove('is-open');
        }
      }

      function openEnrollDecisionModal(form, previousTermId) {
        const modal = document.getElementById('enrollDecisionModal');
        if (!modal) return false;

        pendingEnrollmentSubmitForm = form;
        pendingEnrollmentPreviousTermId = Number(previousTermId);
        modal.classList.add('is-open');
        return true;
      }

      function openEnrollCopyModal(form, previousTermId) {
        const modal = document.getElementById('enrollCopyModal');
        const description = document.getElementById('enrollCopyModalDesc');
        const confirmButton = document.getElementById('enrollCopyConfirmBtn');
        if (!modal || !description || !confirmButton) {
          return false;
        }

        const classes = Array.isArray(previousTermEnrollmentClasses)
          ? previousTermEnrollmentClasses.filter((item) => Number.isFinite(Number(item.class_id)))
          : [];

        const allClasses = Array.isArray(organizationEnrollmentClasses)
          ? organizationEnrollmentClasses.filter((item) => Number.isFinite(Number(item.class_id)))
          : [];

        if (!allClasses.length) {
          alert('No classes were found in this organization to enroll.');
          return false;
        }

        description.textContent = `Select classes to enroll from ${previousCurrentTermNameForEnrollment || 'the previous current term'} into the newly selected current term.`;
        const modeRadio = modal.querySelector('input[name="enrollCopyMode"][value="classes_only"]');
        if (modeRadio) {
          modeRadio.checked = true;
        }
        renderEnrollCopyClassGrid('classes_only');

        pendingEnrollmentSubmitForm = form;
        confirmButton.dataset.previousTermId = String(Number(previousTermId));
        closeEnrollDecisionModal();
        modal.classList.add('is-open');
        return true;
      }

      function submitFormWithBypass(form) {
        if (!form) return;
        form.dataset.submitBypass = '1';
        form.submit();
      }

      function parseYearLabel(value) {
        const text = String(value || '').trim();
        const match = text.match(/^(\d{4})\s*-\s*(\d{4})$/);
        if (!match) return null;
        const start = Number(match[1]);
        const end = Number(match[2]);
        return { start, end };
      }

      function addDaysIso(dateIso, daysToAdd) {
        const date = new Date(`${dateIso}T00:00:00`);
        date.setDate(date.getDate() + daysToAdd);
        return date.toISOString().slice(0, 10);
      }

      function extractTermRank(termName) {
        const label = String(termName || '').toLowerCase();
        const numeric = label.match(/(?:term|semester)?\s*(\d+)/i);
        if (numeric) return Number(numeric[1]);

        const map = {
          first: 1,
          second: 2,
          third: 3,
          fourth: 4,
          fifth: 5,
          sixth: 6
        };

        for (const key of Object.keys(map)) {
          if (label.includes(key)) return map[key];
        }

        return Number.MAX_SAFE_INTEGER;
      }

      function smartSortTermFieldsets(termSection) {
        const termFields = Array.from(termSection.getElementsByTagName('fieldset'));
        termFields.sort((a, b) => {
          const aStart = a.querySelector('input[name="startDates[]"]')?.value || '';
          const bStart = b.querySelector('input[name="startDates[]"]')?.value || '';

          if (aStart && bStart && aStart !== bStart) return aStart.localeCompare(bStart);
          if (aStart && !bStart) return -1;
          if (!aStart && bStart) return 1;

          const aName = a.querySelector('input[name="termNames[]"]')?.value || '';
          const bName = b.querySelector('input[name="termNames[]"]')?.value || '';
          const rankDiff = extractTermRank(aName) - extractTermRank(bName);
          if (rankDiff !== 0) return rankDiff;
          return aName.localeCompare(bName, undefined, { sensitivity: 'base' });
        });

        termSection.innerHTML = '';
        groupTermFieldsets(termSection, termFields);
        return termFields;
      }

      // Current term first, then upcoming. In a year that still has current or
      // upcoming terms, completed ones fold under "Completed terms" until
      // opened (they stay inside the form, so saving is unchanged).
      function groupTermFieldsets(termSection, termFields) {
        const wrapper = termSection.closest('.school-year-wrapper');
        const isCurrentYear = !!(wrapper && wrapper.classList.contains('current-year-wrapper'));
        const current = [];
        const upcoming = [];
        const completed = [];
        termFields.forEach((field) => {
          const radio = field.querySelector('input.current-term-radio');
          if (isCurrentYear && radio && radio.checked) current.push(field);
          else if (field.dataset.termCompleted === 'true') completed.push(field);
          else upcoming.push(field);
        });
        const title = (text) => {
          const el = document.createElement('p');
          el.className = 'term-group__title';
          el.textContent = text;
          return el;
        };
        const open = current.length + upcoming.length;
        if (!open) {
          completed.forEach((field) => termSection.appendChild(field));
          return;
        }
        const titled = [current, upcoming, completed].filter((list) => list.length).length > 1;
        if (current.length) {
          if (titled) termSection.appendChild(title('Current'));
          current.forEach((field) => termSection.appendChild(field));
        }
        if (upcoming.length) {
          if (titled) termSection.appendChild(title('Upcoming'));
          upcoming.forEach((field) => termSection.appendChild(field));
        }
        if (completed.length) {
          const box = document.createElement('details');
          box.className = 'term-group--completed';
          const summary = document.createElement('summary');
          summary.textContent = 'Completed terms (' + completed.length + ')';
          box.appendChild(summary);
          completed.forEach((field) => box.appendChild(field));
          termSection.appendChild(box);
        }
      }

      function applySequentialDateRules(termSection) {
        const ordered = smartSortTermFieldsets(termSection);
        ordered.forEach((fieldset, idx) => {
          const startInput = fieldset.querySelector('input[name="startDates[]"]');
          const endInput = fieldset.querySelector('input[name="endDates[]"]');
          const prevEnd = idx > 0
            ? ordered[idx - 1].querySelector('input[name="endDates[]"]')?.value
            : '';

          const minStart = prevEnd ? addDaysIso(prevEnd, 1) : '';
          startInput.min = minStart;
          if (startInput.value && minStart && startInput.value < minStart) {
            startInput.value = '';
          }

          endInput.min = startInput.value || minStart || '';
          if (endInput.value && endInput.min && endInput.value < endInput.min) {
            endInput.value = '';
          }
        });
      }

      function attachTermDateListeners(termSection) {
        const fields = Array.from(termSection.getElementsByTagName('fieldset'));
        fields.forEach((fieldset) => {
          const startInput = fieldset.querySelector('input[name="startDates[]"]');
          const endInput = fieldset.querySelector('input[name="endDates[]"]');
          const nameInput = fieldset.querySelector('input[name="termNames[]"]');

          [startInput, endInput, nameInput].forEach((input) => {
            if (!input) return;
            input.addEventListener('change', () => applySequentialDateRules(termSection));
            if (input === nameInput) {
              input.addEventListener('blur', () => smartSortTermFieldsets(termSection));
            }
          });
        });
      }

      // Toggle terms visibility
      function toggleTerms(yearId) {
        const termSection = document.getElementById(`termSection${yearId}`);
        const arrow = document.getElementById(`arrow${yearId}`);
        const isHidden = window.getComputedStyle(termSection).display === "none";

        if (isHidden) {
          termSection.style.display = "block";
          arrow.innerHTML = "&#9650;"; // Change to up arrow
        } else {
          termSection.style.display = "none";
          arrow.innerHTML = "&#9660;"; // Change to down arrow
        }
      }

      // Validation to ensure the current term belongs to the selected current school year
      function validateAndConfirmChanges(form) {
        if (form.dataset.submitBypass === '1') {
          form.dataset.submitBypass = '0';
          return true;
        }

        syncCurrentSelectionForForm(form);

        const yearInput = form.querySelector('input[name="year_label"]');
        const parsedYear = parseYearLabel(yearInput ? yearInput.value : '');
        if (!parsedYear || parsedYear.end !== parsedYear.start + 1) {
          alert('Kindly use School Year format YYYY-YYYY (example: 2026-2027).');
          if (yearInput) yearInput.focus();
          return false;
        }

        const currentYearSelected = form.querySelector(
          'input.current-year-radio:checked'
        );
        const currentTermSelected = form.querySelector(
          'input.current-term-radio:checked'
        );

        // --- Prevent overlapping term dates ---
        const startDates = Array.from(form.querySelectorAll('input[name="startDates[]"]'));
        const endDates = Array.from(form.querySelectorAll('input[name="endDates[]"]'));
        const termNames = Array.from(form.querySelectorAll('input[name="termNames[]"]'));
        let ranges = [];
        for (let i = 0; i < startDates.length; i++) {
          const start = new Date(startDates[i].value);
          const end = new Date(endDates[i].value);
          if (start > end) {
            alert(`Start date must be before end date for term: ${termNames[i].value}`);
            return false;
          }
          ranges.push({start, end, name: termNames[i].value});
        }
        // Check for overlaps
        for (let i = 0; i < ranges.length; i++) {
          for (let j = i + 1; j < ranges.length; j++) {
            if (
              (ranges[i].start <= ranges[j].end && ranges[i].end >= ranges[j].start)
            ) {
              alert(`Date ranges for terms "${ranges[i].name}" and "${ranges[j].name}" overlap. Please correct them.`);
              return false;
            }
          }
        }

        const ordered = ranges
          .map((r) => ({ ...r, startKey: r.start.toISOString().slice(0, 10), endKey: r.end.toISOString().slice(0, 10) }))
          .sort((a, b) => a.startKey.localeCompare(b.startKey));

        for (let i = 1; i < ordered.length; i++) {
          const requiredStart = addDaysIso(ordered[i - 1].endKey, 1);
          if (ordered[i].startKey < requiredStart) {
            alert(`Please make sure "${ordered[i].name}" starts on or after ${requiredStart} to avoid overlapping terms.`);
            return false;
          }
        }
        // --- End overlap check ---

        if (currentYearSelected) {
          const currentYearId = parseInt(currentYearSelected.value, 10);
          let yearLabel = '';
          const yearLabelInput = form.querySelector('input[name="year_label"]');
          if (yearLabelInput) {
            yearLabel = yearLabelInput.value;
          }
          // Ensure that the selected current term belongs to the current year
          if (currentTermSelected) {
            const termSection = document.getElementById(
              `termSection${currentYearId}`
            );
            if (!termSection) {
              alert(
                `The selected current term does not belong to the selected current school year. Please correct your selection.`
              );
              return false;
            }
            const selectedTermId = parseInt(currentTermSelected.value, 10);
            const validTermIds = Array.from(
              termSection.querySelectorAll(
                'input[type="hidden"][name="termIds[]"]'
              )
            ).map((termInput) => parseInt(termInput.value, 10));
            if (!validTermIds.includes(selectedTermId)) {
              alert(
                `The selected current term does not belong to the selected current school year. Please correct your selection.`
              );
              return false;
            }

            // ——— Smart term selection warning based on current date ———
            const today = new Date();
            today.setHours(0, 0, 0, 0);
            const termFieldsets = termSection.querySelectorAll('fieldset');
            let suggestedTermName = null;
            let selectedTermName = '';

            termFieldsets.forEach(function(fs) {
              const tidInput = fs.querySelector('input[name="termIds[]"]');
              const tnameInput = fs.querySelector('input[name="termNames[]"]');
              const sInput = fs.querySelector('input[name="startDates[]"]');
              const eInput = fs.querySelector('input[name="endDates[]"]');
              if (!tidInput || !tnameInput || !sInput || !eInput) return;

              const tid = parseInt(tidInput.value, 10);
              const tStart = new Date(sInput.value);
              const tEnd = new Date(eInput.value);
              tStart.setHours(0, 0, 0, 0);
              tEnd.setHours(0, 0, 0, 0);

              if (tid === selectedTermId) {
                selectedTermName = tnameInput.value;
              }

              // Check if today falls within this term's date range (with 7-day grace on either side)
              const graceStart = new Date(tStart);
              graceStart.setDate(graceStart.getDate() - 7);
              const graceEnd = new Date(tEnd);
              graceEnd.setDate(graceEnd.getDate() + 7);
              if (today >= graceStart && today <= graceEnd) {
                suggestedTermName = tnameInput.value;
              }
            });

            if (suggestedTermName && selectedTermName && suggestedTermName !== selectedTermName) {
              const proceed = confirm(
                `⚠️ Based on today's date, it looks like you should be in "${suggestedTermName}", but you are selecting "${selectedTermName}" as the current term under school year "${yearLabel}".\n\nDo you want to proceed?`
              );
              if (!proceed) return false;
            }

            const hasCurrentTermChanged = Number.isFinite(previousCurrentTermIdForEnrollment)
              && previousCurrentTermIdForEnrollment > 0
              && Number.isFinite(selectedTermId)
              && selectedTermId !== previousCurrentTermIdForEnrollment;

            if (hasCurrentTermChanged) {
              const opened = openEnrollDecisionModal(form, previousCurrentTermIdForEnrollment);
              if (!opened) return false;
              return false;
            }
          } else {
            if (yearLabel) {
              alert(
                `School year "${yearLabel}" is set as current, but no term is selected as current. Please select a term.`
              );
            } else {
              alert(
                `A school year is set as current, but no term is selected as current. Please select a term for the current school year.`
              );
            }
            return false;
          }
        }

        return confirm(
          `You are about to save changes to the school year. Do you want to proceed?`
        );
      }

      document.addEventListener('click', function (event) {
        const modal = document.getElementById('enrollCopyModal');
        const decisionModal = document.getElementById('enrollDecisionModal');
        if (decisionModal && event.target === decisionModal) {
          closeEnrollDecisionModal();
          return;
        }
        if (modal && event.target === modal) {
          closeEnrollCopyModal();
          return;
        }

        const decisionCancelButton = event.target.closest('#enrollDecisionCancelBtn');
        if (decisionCancelButton) {
          closeEnrollDecisionModal();
          pendingEnrollmentSubmitForm = null;
          pendingEnrollmentPreviousTermId = null;
          return;
        }

        const decisionNoButton = event.target.closest('#enrollDecisionNoBtn');
        if (decisionNoButton) {
          const form = pendingEnrollmentSubmitForm;
          if (!form) {
            closeEnrollDecisionModal();
            return;
          }
          setEnrollmentCopyInputs(form, false, [], null, '');
          closeEnrollDecisionModal();
          submitFormWithBypass(form);
          return;
        }

        const decisionYesButton = event.target.closest('#enrollDecisionYesBtn');
        if (decisionYesButton) {
          const form = pendingEnrollmentSubmitForm;
          const previousTermId = pendingEnrollmentPreviousTermId;
          if (!form || !Number.isFinite(Number(previousTermId))) {
            closeEnrollDecisionModal();
            pendingEnrollmentSubmitForm = null;
            pendingEnrollmentPreviousTermId = null;
            return;
          }
          const opened = openEnrollCopyModal(form, previousTermId);
          if (!opened) {
            closeEnrollDecisionModal();
          }
          return;
        }

        const cancelButton = event.target.closest('#enrollCopyCancelBtn');
        if (cancelButton) {
          closeEnrollCopyModal();
          return;
        }

        const confirmButton = event.target.closest('#enrollCopyConfirmBtn');
        if (!confirmButton) return;

        const form = pendingEnrollmentSubmitForm;
        if (!form) {
          closeEnrollCopyModal();
          return;
        }

        const selectedClassIds = Array.from((document.getElementById('enrollCopyClassGrid') || document).querySelectorAll('.enroll-copy-class-checkbox:checked'))
          .map((checkbox) => Number(checkbox.value))
          .filter((value) => Number.isFinite(value));

        if (!selectedClassIds.length) {
          alert('Select at least one class to enroll, or click Cancel.');
          return;
        }

        const selectedMode = getSelectedEnrollMode();
        if (!selectedMode) {
          alert('Choose an enrollment option before continuing.');
          return;
        }

        const previousTermId = Number(confirmButton.dataset.previousTermId);
        setEnrollmentCopyInputs(form, true, selectedClassIds, previousTermId, selectedMode);
        closeEnrollCopyModal();
        submitFormWithBypass(form);
      });

      document.addEventListener('change', function(event) {
        if (!event.target.matches('#enrollCopyModal input[name="enrollCopyMode"]')) {
          return;
        }
        renderEnrollCopyClassGrid(getSelectedEnrollMode());
      });

      function closeNote() {
        document.getElementById("noteSection").style.display = "none";
      }

      function syncCurrentSelectionForForm(form) {
        const currentYearHidden = form.querySelector('.current-year-hidden');
        const currentYearRadio = form.querySelector('input.current-year-radio');
        if (currentYearHidden) {
          currentYearHidden.value = currentYearRadio && currentYearRadio.checked ? currentYearRadio.value : '';
        }

        const currentTermHidden = form.querySelector('.current-term-hidden');
        const selectedTermRadio = form.querySelector('input.current-term-radio:checked');
        if (currentTermHidden) {
          currentTermHidden.value = selectedTermRadio ? selectedTermRadio.value : '';
        }
      }

      // Toggle three-dot menu for term actions
      function toggleTermMenu(event, button) {
        event.stopPropagation();
        const dropdown = button.nextElementSibling;
        const isCurrentlyShown = dropdown.classList.contains('show');
        
        // Close all other open menus
        document.querySelectorAll('.term-menu-dropdown.show').forEach(menu => {
          menu.classList.remove('show');
        });
        
        // Toggle current menu
        if (!isCurrentlyShown) {
          dropdown.classList.add('show');
        }
      }

      // Toggle three-dot menu for school year actions
      function toggleYearMenu(event, button) {
        event.stopPropagation();
        const dropdown = button.nextElementSibling;
        const isCurrentlyShown = dropdown.classList.contains('show');
        
        // Close all other open menus
        document.querySelectorAll('.term-menu-dropdown.show').forEach(menu => {
          menu.classList.remove('show');
        });
        
        // Toggle current menu
        if (!isCurrentlyShown) {
          dropdown.classList.add('show');
        }
      }

      // Completed years and terms are locked (Current, name and dates) until Edit.
      function unlockFields(root) {
        root.querySelectorAll('input.current-year-radio[disabled], input.current-term-radio[disabled]').forEach((input) => { input.disabled = false; });
        root.querySelectorAll('input[readonly]').forEach((input) => { input.readOnly = false; });
      }

      // A completed school year keeps its terms and dates as they were; only its name can change.
      function enableSchoolYearEdit(button) {
        const wrapper = button.closest('.school-year-wrapper');
        if (!wrapper) return;
        const name = wrapper.querySelector('input[name="year_label"]');
        if (!name) return;
        name.removeAttribute('readonly');
        wrapper.classList.add('name-unlocked');
        name.focus();
        name.select();
        const menu = button.closest('.term-menu-dropdown');
        if (menu) menu.classList.remove('open', 'show', 'active');
      }

      // Delete school year function
      async function deleteSchoolYear(yearId, button) {
        const firstWarning =
          'WARNING: This permanently deletes the school year and all terms inside it.\n\n' +
          'Deletion will only succeed when there are NO records linked to this school year in the system.\n' +
          'If linked records exist, deletion will be blocked.\n\n' +
          'Do you want to continue?';

        if (!confirm(firstWarning)) {
          return;
        }

        const confirmationText = prompt('Type DELETE to permanently remove this school year:');
        if (confirmationText !== 'DELETE') {
          alert('Deletion cancelled. Confirmation text did not match.');
          return;
        }

        try {
          const response = await fetch('/common/deleteSchoolYear', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/x-www-form-urlencoded',
              'Accept': 'application/json'
            },
            body: new URLSearchParams({ yearId: yearId })
          });

          let data = null;
          try {
            data = await response.json();
          } catch (_) {
            data = null;
          }

          if (response.ok && data && data.success) {
            alert(data.message || 'School year deleted successfully.');
            window.location.reload();
          } else {
            alert((data && data.message) || 'Failed to delete school year.');
          }
        } catch (err) {
          alert('An error occurred while deleting the school year.');
          console.error(err);
        }
      }

      // Close dropdown when clicking outside
      document.addEventListener('click', function(event) {
        if (!event.target.closest('.term-menu-container')) {
          document.querySelectorAll('.term-menu-dropdown.show').forEach(menu => {
            menu.classList.remove('show');
          });
        }
      });

      function initManageRecordsPage() {
        const schoolYearsBlock = document.getElementById("schoolYearsBlock");
        if (!schoolYearsBlock) {
          return;
        }

        if (schoolYearsBlock.dataset.manageRecordsInitDone === '1') {
          return;
        }
        schoolYearsBlock.dataset.manageRecordsInitDone = '1';

        if (schoolYearsBlock) {
          const toggleBtn = schoolYearsBlock.querySelector(".section-collapse-toggle");
          const setCollapsed = (collapsed) => {
            schoolYearsBlock.classList.toggle("is-collapsed", collapsed);
            if (toggleBtn) {
              toggleBtn.textContent = collapsed ? "Expand" : "Collapse";
              toggleBtn.setAttribute("aria-expanded", collapsed ? "false" : "true");
            }
          };

          setCollapsed(false);
          if (toggleBtn) {
            toggleBtn.addEventListener("click", function () {
              const collapsed = schoolYearsBlock.classList.contains("is-collapsed");
              setCollapsed(!collapsed);
            });
          }
        }

        let schoolYearContainer = document.getElementById("schoolYearContainer");
        if (!schoolYearContainer) {
          return;
        }

        let schoolYearWrappers = Array.from(
          schoolYearContainer.getElementsByClassName("school-year-wrapper")
        );

        // Sort school years: current year first, then by year label
        schoolYearWrappers.sort((a, b) => {
          let isCurrentA = a.classList.contains('current-year-wrapper');
          let isCurrentB = b.classList.contains('current-year-wrapper');
          
          // If one is current and the other is not, current comes first
          if (isCurrentA && !isCurrentB) return -1;
          if (!isCurrentA && isCurrentB) return 1;
          
          // If both are current or both are not current, sort by year label
          let yearA = parseInt(
            a.querySelector('input[name="year_label"]').value
          );
          let yearB = parseInt(
            b.querySelector('input[name="year_label"]').value
          );
          return yearB - yearA; // Descending order (newest first)
        });

        // Current school year on top, then upcoming (soonest first), then
        // completed ones folded under "Completed school years" until opened.
        const yearGroups = { current: [], upcoming: [], completed: [] };
        schoolYearWrappers.forEach((wrapper) => {
          if (wrapper.classList.contains('current-year-wrapper')) yearGroups.current.push(wrapper);
          else if (wrapper.dataset.schoolYearCompleted === 'true') yearGroups.completed.push(wrapper);
          else yearGroups.upcoming.push(wrapper);
        });
        yearGroups.upcoming.reverse();
        schoolYearContainer.innerHTML = "";
        [['current', 'Current school year'], ['upcoming', 'Upcoming'], ['completed', 'Completed school years']].forEach(([key, label]) => {
          const list = yearGroups[key];
          if (!list.length) return;
          let box;
          if (key === 'completed') {
            box = document.createElement('details');
            box.className = 'sy-group sy-group--completed';
            const summary = document.createElement('summary');
            summary.textContent = label + ' (' + list.length + ')';
            box.appendChild(summary);
          } else {
            box = document.createElement('section');
            box.className = 'sy-group';
            const heading = document.createElement('p');
            heading.className = 'sy-group__title';
            heading.textContent = label;
            box.appendChild(heading);
          }
          list.forEach((wrapper) => box.appendChild(wrapper));
          schoolYearContainer.appendChild(box);
        });

        // Sort terms within each school year and enforce sequential date rules
        schoolYearWrappers.forEach((schoolYearWrapper) => {
          const form = schoolYearWrapper.querySelector('form.school-year-form');
          if (form && !form.dataset.foldAware) {
            // A field that needs filling inside a folded section opens it.
            form.dataset.foldAware = '1';
            form.addEventListener('invalid', (event) => {
              let node = event.target.closest('details');
              while (node) { node.open = true; node = node.parentElement && node.parentElement.closest('details'); }
            }, true);
          }
          if (form) {
            const yearRadio = form.querySelector('input.current-year-radio');
            if (yearRadio) {
              yearRadio.addEventListener('change', function () {
                syncCurrentSelectionForForm(form);
              });
            }
            form.querySelectorAll('input.current-term-radio').forEach((radio) => {
              radio.addEventListener('change', function () {
                // Making a term current makes its school year current too: one choice, not two.
                if (radio.checked && yearRadio && !yearRadio.disabled && !yearRadio.checked) yearRadio.checked = true;
                syncCurrentSelectionForForm(form);
              });
            });
            syncCurrentSelectionForForm(form);
          }

          let termSections =
            schoolYearWrapper.getElementsByClassName("term-section");

          Array.from(termSections).forEach((termSection) => {
            smartSortTermFieldsets(termSection);
            attachTermDateListeners(termSection);
            applySequentialDateRules(termSection);
          });

          const yearInput = schoolYearWrapper.querySelector('input[name="year_label"]');
          if (yearInput) {
            yearInput.addEventListener('blur', function () {
              if (!yearInput.value.trim()) return;
              const parsed = parseYearLabel(yearInput.value);
              if (!parsed || parsed.end !== parsed.start + 1) {
                alert('Please use School Year format YYYY-YYYY (example: 2026-2027).');
                yearInput.focus();
              }
            });
          }
        });

        // The current year opens with its terms showing; other years start closed.
        schoolYearWrappers.forEach((wrapper) => {
          const termSection = wrapper.querySelector('.term-section');
          const arrow = wrapper.querySelector('.arrow');
          const open = wrapper.classList.contains('current-year-wrapper');
          if (termSection) {
            termSection.style.display = open ? 'block' : 'none';
          }
          if (arrow) {
            arrow.innerHTML = open ? '&#9650;' : '&#9660;';
          }
        });
      }

      document.addEventListener("DOMContentLoaded", initManageRecordsPage);
      window.addEventListener("spa:pageLoaded", initManageRecordsPage);
      document.addEventListener('keydown', function (event) {
        if (event.key === 'Escape') {
          const decisionModal = document.getElementById('enrollDecisionModal');
          if (decisionModal && decisionModal.classList.contains('is-open')) {
            closeEnrollDecisionModal();
            return;
          }

          const modal = document.getElementById('enrollCopyModal');
          if (modal && modal.classList.contains('is-open')) {
            closeEnrollCopyModal();
          }
        }
      });
      if (document.readyState !== 'loading') {
        initManageRecordsPage();
      }

      function addTermToSchoolYear(event, yearId) {
        if (event) {
          event.preventDefault();
        }
        const trigger = event && event.target ? event.target : null;
        const form = trigger ? trigger.closest('form.school-year-form') : null;
        const termSection = document.getElementById(`termSection${yearId}`);
        if (!termSection) {
          return;
        }
        const termDiv = document.createElement("fieldset");
        termDiv.innerHTML = `
          <legend>Term / Semester</legend>
          <input type="hidden" name="termIds[]" value="" />
          <div class="term-section-header">
            <input type="text" name="termNames[]" list="term-library" autocomplete="off" placeholder="Term / Semester Name" required />
            <label>
              <input type="radio" name="currentTermChoice" value="" class="current-term-radio"> Current
            </label>
          </div>
          <div class="date-fields">
            <div>
              <label>Start Date:</label>
              <input type="date" name="startDates[]" required />
            </div>
            <div>
              <label>End Date:</label>
              <input type="date" name="endDates[]" required />
            </div>
          </div>
        `;
        const completedTerms = termSection.querySelector(':scope > details.term-group--completed');
        termSection.insertBefore(termDiv, completedTerms);
        attachTermDateListeners(termSection);
        applySequentialDateRules(termSection);

        if (form) {
          termDiv.querySelectorAll('input.current-term-radio').forEach((radio) => {
            radio.addEventListener('change', function () {
              syncCurrentSelectionForForm(form);
            });
          });
          syncCurrentSelectionForForm(form);
        }
      }

      // async function deleteTerm(termId, button) {
      //   // Prevent deleting the last term in the school year
      //   const termSection =
      //     button.closest(".term-section") ||
      //     button.closest("form").querySelector(".term-section");
      //   const termFieldsets = termSection.querySelectorAll("fieldset");
      //   if (termFieldsets.length <= 1) {
      //     alert(
      //       "A school year must have at least one term. You cannot delete the last term."
      //     );
      //     return;
      //   }

      //   if (!termId || termId === "") {
      //     // No termId means it's a new, unsaved term – just remove from DOM
      //     const fieldset = button.closest("fieldset");
      //     fieldset.remove();
      //     return;
      //   }

      //   if (!confirm("Are you sure you want to delete this term?")) {
      //     return;
      //   }

      //   button.disabled = true;
      //   button.textContent = "Deleting...";
      //   try {
      //     const response = await fetch("/common/deleteTerm", {
      //       method: "POST",
      //       headers: { "Content-Type": "application/json" },
      //       body: JSON.stringify({ term_id: termId }),
      //     });
      //     const data = await response.json();
      //     if (data.success) {
      //       const fieldset = button.closest("fieldset");
      //       fieldset.remove();
      //       alert("Term deleted successfully.");
      //     } else {
      //       alert(data.message || "Failed to delete term.");
      //       button.disabled = false;
      //       button.textContent = "Delete Term";
      //     }
      //   } catch (err) {
      //     alert("An error occurred while deleting the term.");
      //     button.disabled = false;
      //     button.textContent = "Delete Term";
      //   }
      // }

      /* ---- Create School Year modal (AJAX, no page navigation) ---- */
      let rsyTermCount = 0;

      function openRegisterSchoolYearModal() {
        const overlay = document.getElementById('rsyModalOverlay');
        if (!overlay) return;
        const form = document.getElementById('rsyModalForm');
        const termsContainer = document.getElementById('rsyTermsContainer');
        const status = document.getElementById('rsyModalStatus');
        if (form) form.reset();
        if (termsContainer) termsContainer.innerHTML = '';
        if (status) status.classList.remove('show');
        rsyTermCount = 0;
        startRsyPlan();
        overlay.classList.add('is-open');
        document.body.style.overflow = 'hidden';
        const yearInput = document.getElementById('rsySchoolYear');
        if (yearInput) setTimeout(() => yearInput.focus(), 50);
      }

      function closeRegisterSchoolYearModal() {
        const overlay = document.getElementById('rsyModalOverlay');
        if (!overlay) return;
        overlay.classList.remove('is-open');
        document.body.style.overflow = '';
      }

      function showRsyModalError(message) {
        const status = document.getElementById('rsyModalStatus');
        if (!status) return;
        status.textContent = message;
        status.classList.add('show');
      }

      function addDaysIsoRsy(dateIso, daysToAdd) {
        const date = new Date(`${dateIso}T00:00:00`);
        date.setDate(date.getDate() + daysToAdd);
        return date.toISOString().slice(0, 10);
      }

      function parseYearLabelRsy(value) {
        const text = String(value || '').trim();
        const match = text.match(/^(\d{4})\s*-\s*(\d{4})$/);
        if (!match) return null;
        return { start: Number(match[1]), end: Number(match[2]) };
      }

      function extractTermRankRsy(termName) {
        const label = String(termName || '').toLowerCase();
        const numeric = label.match(/(?:term|semester)?\s*(\d+)/i);
        if (numeric) return Number(numeric[1]);
        const map = { first: 1, second: 2, third: 3, fourth: 4, fifth: 5, sixth: 6 };
        for (const key of Object.keys(map)) {
          if (label.includes(key)) return map[key];
        }
        return Number.MAX_SAFE_INTEGER;
      }

      function smartSortRsyTermCards() {
        const termsContainer = document.getElementById('rsyTermsContainer');
        const cards = Array.from(termsContainer.querySelectorAll('.rsy-term-card'));

        cards.sort((a, b) => {
          const aStart = a.querySelector('input[name$="[startDate]"]')?.value || '';
          const bStart = b.querySelector('input[name$="[startDate]"]')?.value || '';
          if (aStart && bStart && aStart !== bStart) return aStart.localeCompare(bStart);
          if (aStart && !bStart) return -1;
          if (!aStart && bStart) return 1;
          const aName = a.querySelector('input[name$="[termName]"]')?.value || '';
          const bName = b.querySelector('input[name$="[termName]"]')?.value || '';
          const rankDiff = extractTermRankRsy(aName) - extractTermRankRsy(bName);
          if (rankDiff !== 0) return rankDiff;
          return aName.localeCompare(bName, undefined, { sensitivity: 'base' });
        });

        cards.forEach((card, idx) => {
          const title = card.querySelector('.rsy-term-card-header h3');
          if (title) title.textContent = `Term ${idx + 1}`;
          termsContainer.appendChild(card);
        });

        return cards;
      }

      function applyRsyTermDateConstraints() {
        const orderedCards = smartSortRsyTermCards();
        orderedCards.forEach((card, idx) => {
          const startInput = card.querySelector('input[name$="[startDate]"]');
          const endInput = card.querySelector('input[name$="[endDate]"]');
          const prevEndInput = idx > 0
            ? orderedCards[idx - 1].querySelector('input[name$="[endDate]"]')
            : null;
          const prevEnd = prevEndInput ? prevEndInput.value : '';
          const minStart = prevEnd ? addDaysIsoRsy(prevEnd, 1) : '';
          startInput.min = minStart;
          if (startInput.value && minStart && startInput.value < minStart) {
            startInput.value = '';
          }
          endInput.min = startInput.value || minStart || '';
          if (endInput.value && endInput.min && endInput.value < endInput.min) {
            endInput.value = '';
          }
        });
      }

      function attachRsyTermListeners(termCard) {
        const startInput = termCard.querySelector('input[name$="[startDate]"]');
        const endInput = termCard.querySelector('input[name$="[endDate]"]');
        const nameInput = termCard.querySelector('input[name$="[termName]"]');
        [startInput, endInput, nameInput].forEach((input) => {
          if (input) input.addEventListener('change', applyRsyTermDateConstraints);
        });
        if (nameInput) nameInput.addEventListener('blur', () => smartSortRsyTermCards());
      }

      // ── How the year divides: suggestions that fill the term cards (public/js/termPlanner.js) ──
      let rsyPlanEdited = false;   // a term card changed by hand: the structure is now Custom
      let rsyDatesEdited = false;  // first or last day changed by hand: the label no longer moves them
      function rsyPlanner() { return window.ManagiraTerms || null; }
      function rsyStructure() {
        const picked = document.querySelector('input[name="rsyStructure"]:checked');
        return picked ? picked.value : 'custom';
      }
      function setRsyStructure(value) {
        const input = document.querySelector('input[name="rsyStructure"][value="' + value + '"]');
        if (input) input.checked = true;
        const custom = value === 'custom';
        document.getElementById('rsyYearDates').hidden = custom;
      }
      function fillRsyTerms() {
        const planner = rsyPlanner();
        const structure = rsyStructure();
        if (!planner || structure === 'custom') return;
        const terms = planner.termsFor(structure, document.getElementById('rsyYearStart').value, document.getElementById('rsyYearEnd').value);
        const container = document.getElementById('rsyTermsContainer');
        // A term name being typed loses focus first, so its suggestions list closes with it.
        if (document.activeElement && container.contains(document.activeElement)) document.activeElement.blur();
        document.querySelectorAll('.lib-pick').forEach((list) => { list.hidden = true; });
        container.innerHTML = '';
        rsyTermCount = 0;
        if (!terms) { addRsyTerm(); return; }
        terms.forEach((term) => addRsyTerm(term));
        rsyPlanEdited = false;
      }
      function startRsyPlan() {
        const planner = rsyPlanner();
        rsyPlanEdited = false;
        rsyDatesEdited = false;
        if (!planner) { setRsyStructure('custom'); addRsyTerm(); return; }
        let labels = [];
        try { labels = JSON.parse(document.querySelector('.rsy-structures').getAttribute('data-year-labels') || '[]'); } catch (_) {}
        const suggestion = planner.suggestYear(labels);
        document.getElementById('rsySchoolYear').value = suggestion.label;
        document.getElementById('rsyYearStart').value = suggestion.start;
        document.getElementById('rsyYearEnd').value = suggestion.end;
        setRsyStructure('semesters');
        fillRsyTerms();
      }
      function initRsyPlan() {
        // Once per modal (the page-switcher can bring a fresh one; the body stays).
        const host = document.querySelector('.rsy-structures');
        if (!host || host.dataset.planInit === '1') return;
        host.dataset.planInit = '1';
        document.querySelectorAll('input[name="rsyStructure"]').forEach((input) => {
          input.addEventListener('change', () => {
            if (rsyPlanEdited && input.value !== 'custom' && !window.confirm('Replace the terms below with ' + input.closest('label').querySelector('strong').textContent.toLowerCase() + '?')) {
              setRsyStructure('custom');
              return;
            }
            setRsyStructure(input.value);
            fillRsyTerms();
          });
        });
        ['rsyYearStart', 'rsyYearEnd'].forEach((id) => {
          document.getElementById(id).addEventListener('change', () => { rsyDatesEdited = true; if (!rsyPlanEdited) fillRsyTerms(); });
        });
        // A new label moves the suggested dates with it, until the dates are chosen by hand.
        document.getElementById('rsySchoolYear').addEventListener('input', (event) => {
          const planner = rsyPlanner();
          const dates = planner && planner.datesForLabel(event.target.value);
          if (!dates || rsyDatesEdited) return;
          document.getElementById('rsyYearStart').value = dates.start;
          document.getElementById('rsyYearEnd').value = dates.end;
          if (!rsyPlanEdited) fillRsyTerms();
        });
        // Changing a term by hand makes the plan Custom (nothing is replaced without asking).
        document.getElementById('rsyTermsContainer').addEventListener('input', () => {
          if (rsyStructure() === 'custom') return;
          rsyPlanEdited = true;
        });
      }

      function addRsyTerm(values) {
        const termsContainer = document.getElementById('rsyTermsContainer');
        const termIndex = rsyTermCount++;
        const termDiv = document.createElement('div');
        termDiv.className = 'rsy-term-card';
        termDiv.innerHTML = `
          <div class="rsy-term-card-header">
            <h3>Term ${termIndex + 1}</h3>
            <div style="position: relative;">
              <button type="button" class="rsy-term-menu-btn" onclick="toggleRsyTermDeleteMenu(event, this)">⋮</button>
              <div class="rsy-term-menu-dropdown">
                <button type="button" class="rsy-term-menu-item" onclick="removeRsyField(this)">🗑️ Remove</button>
              </div>
            </div>
          </div>
          <div class="rsy-term-fields">
          <div class="rsy-form-group">
            <label class="rsy-form-label">Name</label>
            <input type="text" name="terms[${termIndex}][termName]" list="term-library" autocomplete="off" class="rsy-form-input" placeholder="e.g. 1st Semester" required>
          </div>
          <div class="rsy-date-row">
            <div class="rsy-form-group" style="margin-bottom:0;">
              <label class="rsy-form-label">Start</label>
              <input type="date" name="terms[${termIndex}][startDate]" class="rsy-form-input" required>
            </div>
            <div class="rsy-form-group" style="margin-bottom:0;">
              <label class="rsy-form-label">End</label>
              <input type="date" name="terms[${termIndex}][endDate]" class="rsy-form-input" required>
            </div>
          </div>
          </div>
        `;
        if (values) {
          termDiv.querySelector('input[name$="[termName]"]').value = values.name || '';
          termDiv.querySelector('input[name$="[startDate]"]').value = values.start || '';
          termDiv.querySelector('input[name$="[endDate]"]').value = values.end || '';
        }
        termsContainer.appendChild(termDiv);
        attachRsyTermListeners(termDiv);
        applyRsyTermDateConstraints();
      }

      function toggleRsyTermDeleteMenu(event, button) {
        event.stopPropagation();
        const dropdown = button.nextElementSibling;
        const isShown = dropdown.classList.contains('show');
        document.querySelectorAll('.rsy-term-menu-dropdown.show').forEach(m => m.classList.remove('show'));
        if (!isShown) dropdown.classList.add('show');
      }

      function removeRsyField(button) {
        button.closest('.rsy-term-card').remove();
        applyRsyTermDateConstraints();
      }

      function validateRegisterSchoolYearModalForm(form) {
        const schoolYearInput = form.querySelector('#rsySchoolYear');
        const parsedYear = parseYearLabelRsy(schoolYearInput.value);
        if (!parsedYear) {
          showRsyModalError('Please use the School Year format YYYY-YYYY (for example 2026-2027).');
          schoolYearInput.focus();
          return false;
        }
        if (parsedYear.end !== parsedYear.start + 1) {
          showRsyModalError('Please enter consecutive years. Example: 2026-2027.');
          schoolYearInput.focus();
          return false;
        }

        const termsContainer = document.getElementById('rsyTermsContainer');
        if (!termsContainer.children.length) {
          showRsyModalError('Please add at least one term or semester.');
          return false;
        }

        const startDates = Array.from(form.querySelectorAll('input[name^="terms"][name$="[startDate]"]'));
        const endDates = Array.from(form.querySelectorAll('input[name^="terms"][name$="[endDate]"]'));
        const termNames = Array.from(form.querySelectorAll('input[name^="terms"][name$="[termName]"]'));
        let ranges = [];
        for (let i = 0; i < startDates.length; i++) {
          const start = new Date(startDates[i].value);
          const end = new Date(endDates[i].value);
          if (start > end) {
            showRsyModalError(`Start date must be before end date for term: ${termNames[i].value}`);
            return false;
          }
          ranges.push({ start, end, name: termNames[i].value });
        }
        for (let i = 0; i < ranges.length; i++) {
          for (let j = i + 1; j < ranges.length; j++) {
            if (ranges[i].start <= ranges[j].end && ranges[i].end >= ranges[j].start) {
              showRsyModalError(`Date ranges for "${ranges[i].name}" and "${ranges[j].name}" overlap.`);
              return false;
            }
          }
        }

        const ordered = ranges
          .map((r) => ({ ...r, startKey: r.start.toISOString().slice(0, 10), endKey: r.end.toISOString().slice(0, 10) }))
          .sort((a, b) => a.startKey.localeCompare(b.startKey));
        for (let i = 1; i < ordered.length; i++) {
          const requiredStart = addDaysIsoRsy(ordered[i - 1].endKey, 1);
          if (ordered[i].startKey < requiredStart) {
            showRsyModalError(`Please adjust term dates so "${ordered[i].name}" starts on or after ${requiredStart}.`);
            return false;
          }
        }

        return true;
      }

      async function submitRegisterSchoolYearModal(event, form) {
        event.preventDefault();

        const status = document.getElementById('rsyModalStatus');
        if (status) status.classList.remove('show');

        if (!validateRegisterSchoolYearModalForm(form)) return false;

        const submitBtn = document.getElementById('rsyModalSubmitBtn');
        const originalLabel = submitBtn ? submitBtn.textContent : '';
        if (submitBtn) {
          submitBtn.disabled = true;
          submitBtn.classList.add('is-saving');
          submitBtn.textContent = 'Registering…';
        }

        try {
          const params = new URLSearchParams(new FormData(form));
          const response = await fetch('/common/registerSchoolYear', {
            method: 'POST',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            body: params
          });

          if (response.redirected && /\/common\/manageRecords(?:$|[/?])/.test(new URL(response.url).pathname)) {
            closeRegisterSchoolYearModal();
            window.location.reload();
            return false;
          }

          // Registration failed server-side — pull the flash error out of
          // whatever page the redirect landed on (registerSchoolYear itself).
          const text = await response.text();
          const doc = new DOMParser().parseFromString(text, 'text/html');
          const errMsg = doc.querySelector('.flash-message.error .flash-content');
          showRsyModalError(errMsg ? errMsg.textContent.trim() : 'Failed to register school year. Please try again.');
        } catch (err) {
          showRsyModalError('An error occurred while registering the school year.');
        } finally {
          if (submitBtn) {
            submitBtn.disabled = false;
            submitBtn.classList.remove('is-saving');
            submitBtn.textContent = originalLabel;
          }
        }

        return false;
      }

      function initRsyModal() {
        initRsyPlan();
        if (document.body.dataset.rsyModalInitDone === '1') return;
        document.body.dataset.rsyModalInitDone = '1';

        const closeBtn = document.getElementById('rsyModalClose');
        if (closeBtn) closeBtn.addEventListener('click', closeRegisterSchoolYearModal);

        const overlay = document.getElementById('rsyModalOverlay');
        if (overlay) {
          overlay.addEventListener('click', function (event) {
            /* closes only with X or Escape */
          });
        }

        document.addEventListener('click', function (event) {
          if (!event.target.closest('.rsy-term-menu-btn')) {
            document.querySelectorAll('.rsy-term-menu-dropdown.show').forEach(m => m.classList.remove('show'));
          }
        });

        document.addEventListener('keydown', function (event) {
          if (event.key === 'Escape') {
            const overlayEl = document.getElementById('rsyModalOverlay');
            if (overlayEl && overlayEl.classList.contains('is-open')) {
              closeRegisterSchoolYearModal();
            }
          }
        });
      }

      document.addEventListener('DOMContentLoaded', initRsyModal);
      window.addEventListener('spa:pageLoaded', initRsyModal);
      if (document.readyState !== 'loading') {
        initRsyModal();
      }
    
