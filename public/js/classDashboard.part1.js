
    if (!window.__classReportCcState) {
      window.__classReportCcState = { cache: {}, loading: {} };
    }

    function loadClassReportCcHover(reportId) {
      var state = window.__classReportCcState;
      if (state.cache[reportId] && Array.isArray(state.cache[reportId].recipients)) {
        renderClassReportCcTooltip(state.cache[reportId].recipients);
        return;
      }
      if (state.loading[reportId]) {
        return;
      }

      state.loading[reportId] = true;
      renderClassReportCcTooltipState('Loading staff...');

      fetch('/common/classReportRecipients?reportId=' + reportId)
        .then(function (r) { return r.json(); })
        .then(function (d) {
          if (!d.success) {
            renderClassReportCcTooltipState('Unable to load CC staff.');
            return;
          }
          var recipients = Array.isArray(d.recipients) ? d.recipients : [];
          state.cache[reportId] = { recipients: recipients };
          renderClassReportCcTooltip(recipients);
        })
        .catch(function () {
          renderClassReportCcTooltipState('Unable to load CC staff.');
        })
        .finally(function () {
          state.loading[reportId] = false;
        });
    }

    function renderClassReportCcTooltip(recipients) {
      var list = document.getElementById('rdCcTooltipList');
      if (!list) return;
      if (!recipients.length) {
        renderClassReportCcTooltipState('No staff were CC\'d on this report.');
        return;
      }

      var html = '';
      recipients.forEach(function (item) {
        html += '<div class="rd-cc-tooltip-item">' + esc(item.display_name || 'Staff') + ' <span class="role">· ' + esc(item.display_role || 'Staff') + '</span></div>';
      });
      list.innerHTML = html;
    }

    function renderClassReportCcTooltipState(text) {
      var list = document.getElementById('rdCcTooltipList');
      if (!list) return;
      list.innerHTML = '<div class="rd-cc-tooltip-state">' + esc(text) + '</div>';
    }

    function openReportDetail(reportId) {
      var modal = document.getElementById('reportDetailModal');
      var content = document.getElementById('reportDetailContent');
      content.innerHTML = '<p style="color:#6b7280;">Loading...</p>';
      modal.classList.add('active');

      fetch('/common/classReportDetail?reportId=' + reportId)
        .then(function(r) { return r.json(); })
        .then(function(d) {
          if (!d.success) { content.innerHTML = '<p style="color:#e74c3c;">Conversation not found.</p>'; return; }
          var rp = d.report;
          var prCls = 'rd-priority-' + (rp.priority || 'normal');
          var priorityKey = String(rp.priority || 'normal').toLowerCase();
          if (priorityKey === 'meduim') priorityKey = 'medium';
          if (priorityKey === 'normal') priorityKey = 'medium';
          var threadSeverityCls = 'rd-severity-' + priorityKey;

          var html = '<div class="rd-modal-body">';
          html += '<h2 class="rd-title">' + esc(rp.subject) + '</h2>';

          // Key line + badges (important info first)
          html += '<div class="rd-keyline">'
            +   '<div class="rd-keyline-student"><span class="rd-meta-label">Student</span><strong>' + esc(rp.student_name) + '</strong></div>'
            +   '<div class="rd-keyline-date">' + formatDashboardDate(rp.created_at) + '</div>'
            + '</div>';
          html += '<div class="rd-meta-inline">'
            +   '<span>Parent: ' + esc(rp.guardian_name) + '</span>'
            +   '<span class="rd-meta-sep"></span>'
            +   '<span class="rd-cc-hover" tabindex="0" onmouseenter="loadClassReportCcHover(' + rp.report_id + ')" onfocus="loadClassReportCcHover(' + rp.report_id + ')">CC: ' + Number(rp.cc_count || 0) + ' staff'
            +     '<span class="rd-cc-tooltip"><span class="rd-cc-tooltip-title">CC Staff</span><span class="rd-cc-tooltip-list" id="rdCcTooltipList"><span class="rd-cc-tooltip-state">Hover to load...</span></span></span>'
            +   '</span>'
            + '</div>';
          html += '<div class="rd-badge-row">'
            +   '<span class="rd-badge ' + prCls + '">' + esc(rp.priority || 'normal') + '</span>'
            + '</div>';

          // Conversation
          var replyCount = d.replies ? d.replies.length : 0;
          var threadCount = replyCount + 1;
          html += '<div class="rd-section"><div class="rd-section-title" id="rdConversationTitle">Conversation (' + threadCount + ')</div><div class="rd-thread-scroll ' + threadSeverityCls + '" id="rdThreadList">';

          // Original report message appears first in the thread. Staff can file a
          // report too (Staff Report …); then it is theirs, not the parent's.
          var filedByStaff = Boolean(rp.filed_by_user_id || rp.filed_by_name);
          var openerMine = filedByStaff && Number(rp.filed_by_user_id || 0) === currentStaffUserId;
          html += '<div class="rd-reply ' + (filedByStaff ? 'is-staff ' + (openerMine ? 'is-mine' : 'is-theirs') : 'is-guardian is-theirs') + '">' +
            '<div class="rd-reply-header">' +
              '<span class="rd-reply-sender">' +
                '<span class="sender-dot ' + (filedByStaff ? 'staff' : 'guardian') + '"></span>' +
                '<span class="sender-name">' + esc(filedByStaff ? (rp.filed_by_name || 'Staff') : rp.guardian_name) + '</span>' +
                '<span class="sender-label">' + (filedByStaff ? 'Staff' : 'Parent') + '</span>' +
              '</span>' +
            '</div>' +
            '<p class="rd-reply-msg">' + esc(rp.message) + '</p>' +
            '<span class="rd-reply-date">' + new Date(rp.created_at).toLocaleString('en-US', {month:'short',day:'numeric',hour:'numeric',minute:'2-digit'}) + '</span>' +
          '</div>';

          if (replyCount > 0) {
            d.replies.forEach(function(reply) {
              var isGuardian = reply.sender_type === 'guardian';
              var bubbleCls = isGuardian ? 'is-guardian' : 'is-staff';
              var isMine = !isGuardian && Number(reply.sender_id || 0) === currentStaffUserId;
              var sideCls = isMine ? 'is-mine' : 'is-theirs';
              var dotCls = isGuardian ? 'guardian' : 'staff';
              var label = isGuardian ? 'Parent' : 'Staff';
              html += '<div class="rd-reply ' + bubbleCls + ' ' + sideCls + '">';
              if (!isGuardian && isMine) {
                html += '<div class="rd-msg-menu-wrap" id="rdMsgMenu-' + reply.reply_id + '">' +
                  '<button type="button" class="rd-msg-menu-btn" onclick="toggleReportMsgMenu(' + reply.reply_id + ')" aria-label="Message actions">⋯</button>' +
                  '<div class="rd-msg-menu-dropdown">' +
                    '<a href="#" class="rd-msg-menu-text" onclick="return deleteClassReply(' + rp.report_id + ', ' + reply.reply_id + ')">Delete message</a>' +
                  '</div>' +
                '</div>';
              }
              html +=
                '<div class="rd-reply-header">' +
                  '<span class="rd-reply-sender">' +
                    '<span class="sender-dot ' + dotCls + '"></span>' +
                    '<span class="sender-name">' + esc(reply.display_name) + '</span>' +
                    '<span class="sender-label">' + label + '</span>' +
                  '</span>' +
                '</div>' +
                '<p class="rd-reply-msg">' + esc(reply.message) + '</p>' +
                '<span class="rd-reply-date">' + new Date(reply.created_at).toLocaleString('en-US', {month:'short',day:'numeric',hour:'numeric',minute:'2-digit'}) + '</span>' +
              '</div>';
            });
          }
          html += '</div></div>';

          // Reply form
          html += '<div class="rd-reply-form">' +
            '<div class="rd-reply-composer">' +
              '<textarea id="staffReplyMsg" rows="1" placeholder="Type a message..." oninput="autoResizeStaffReplyInput(this)" onkeydown="handleStaffReplyKeydown(event, ' + rp.report_id + ')"></textarea>' +
              '<button id="staffReplyBtn" class="rd-reply-send-btn" onclick="submitStaffReply(' + rp.report_id + ')" aria-label="Send reply" title="Send">' +
                '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M22 2L11 13"></path><path d="M22 2L15 22L11 13L2 9L22 2Z"></path></svg>' +
              '</button>' +
            '</div>' +
          '</div>';

          html += '</div>'; // close rd-modal-body
          content.innerHTML = html;
          var replyInput = document.getElementById('staffReplyMsg');
          if (replyInput) {
            autoResizeStaffReplyInput(replyInput);
            replyInput.focus();
          }
        })
        .catch(function() {
          content.innerHTML = '<p style="color:#e74c3c;">Failed to load report.</p>';
        });
    }

    function closeReportModal() {
      document.getElementById('reportDetailModal').classList.remove('active');
    }
    document.getElementById('reportDetailModal').addEventListener('click', function(e) {
      if (e.target === this) closeReportModal();
    });

    function autoResizeStaffReplyInput(textarea) {
      if (!textarea) return;
      textarea.style.height = 'auto';
      var nextHeight = Math.min(textarea.scrollHeight, 220);
      textarea.style.height = nextHeight + 'px';
    }

    function handleStaffReplyKeydown(event, reportId) {
      if (!event) return;
      if (event.key === 'Enter' && !event.shiftKey) {
        event.preventDefault();
        submitStaffReply(reportId);
      }
    }

    function appendStaffReplyToThread(reportId, reply) {
      var thread = document.getElementById('rdThreadList');
      if (!thread || !reply) return;

      var isMine = Number(reply.sender_id || 0) === currentStaffUserId;
      var bubbleCls = 'rd-reply is-staff ' + (isMine ? 'is-mine' : 'is-theirs');
      var sender = esc(reply.display_name || reply.sender_name || 'Staff');
      var msg = esc(reply.message || '');
      var time = new Date(reply.created_at || Date.now()).toLocaleString('en-US', {month:'short',day:'numeric',hour:'numeric',minute:'2-digit'});
      var actions = '';

      if (isMine && reply.reply_id) {
        actions = '<div class="rd-msg-menu-wrap" id="rdMsgMenu-' + Number(reply.reply_id) + '">' +
          '<button type="button" class="rd-msg-menu-btn" onclick="toggleReportMsgMenu(' + Number(reply.reply_id) + ')" aria-label="Message actions">⋯</button>' +
          '<div class="rd-msg-menu-dropdown">' +
            '<a href="#" class="rd-msg-menu-text" onclick="return deleteClassReply(' + Number(reportId) + ', ' + Number(reply.reply_id) + ')">Delete message</a>' +
          '</div>' +
        '</div>';
      }

      var html = '<div class="' + bubbleCls + '">' +
        actions +
        '<div class="rd-reply-header">' +
          '<span class="rd-reply-sender">' +
            '<span class="sender-dot staff"></span>' +
            '<span class="sender-name">' + sender + '</span>' +
            '<span class="sender-label">Staff</span>' +
          '</span>' +
        '</div>' +
        '<p class="rd-reply-msg">' + msg + '</p>' +
        '<span class="rd-reply-date">' + time + '</span>' +
      '</div>';

      thread.insertAdjacentHTML('beforeend', html);
      thread.scrollTop = thread.scrollHeight;

      var title = document.getElementById('rdConversationTitle');
      if (title) {
        var match = String(title.textContent || '').match(/\((\d+)\)/);
        if (match) {
          var next = Number(match[1]) + 1;
          title.textContent = 'Conversation (' + next + ')';
        }
      }
    }

    function submitStaffReply(reportId) {
      var input = document.getElementById('staffReplyMsg');
      if (!input) return;
      var msg = input.value.trim();
      if (!msg) return;
      var btn = document.getElementById('staffReplyBtn');
      btn.disabled = true;

      fetch('/common/staffReplyToReport', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'same-origin',
        body: JSON.stringify({ reportId: reportId, message: msg })
      })
        .then(function(r) { return r.json(); })
        .then(function(d) {
          if (d.success) {
            appendStaffReplyToThread(reportId, d.reply || {
              sender_id: currentStaffUserId,
              display_name: 'You',
              message: msg,
              created_at: new Date().toISOString()
            });
            input.value = '';
            autoResizeStaffReplyInput(input);
            input.focus();
            loadClassReports(); // refresh list counts
          } else {
            alert(d.error || 'Error sending reply');
            btn.disabled = false;
            input.focus();
          }
        })
        .catch(function() {
          alert('Error sending reply');
          input.focus();
        })
        .finally(function() {
          btn.disabled = false;
        });
    }

    function toggleReportMsgMenu(replyId) {
      var wrap = document.getElementById('rdMsgMenu-' + replyId);
      if (!wrap) return;
      var isOpen = wrap.classList.contains('open');
      document.querySelectorAll('.rd-msg-menu-wrap.open').forEach(function(el) { el.classList.remove('open'); });
      if (!isOpen) wrap.classList.add('open');
    }

    function deleteClassReply(reportId, replyId) {
      if (!confirm('Delete this message?')) return false;
      fetch('/common/classReportReplies/' + replyId + '/delete', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ reportId: reportId })
      })
        .then(function(r) { return r.json(); })
        .then(function(d) {
          if (!d.success) {
            alert(d.error || 'Failed to delete message');
            return;
          }
          openReportDetail(reportId);
          loadClassReports();
        })
        .catch(function() {
          alert('Failed to delete message');
        });
      return false;
    }

    document.addEventListener('click', function(e) {
      if (!e.target.closest('.rd-msg-menu-wrap')) {
        document.querySelectorAll('.rd-msg-menu-wrap.open').forEach(function(el) { el.classList.remove('open'); });
      }
    });

    function toggleClassScheduleModal(e) {
      if (e) e.preventDefault();
      openWorkspaceTabByKey('schedule');
    }

    function closeClassScheduleModal() {
      classScheduleState.isEditing = false;
      classScheduleState.pendingAction = '';
      if (classScheduleState.payload) {
        syncDraftRowsFromPayload(classScheduleState.payload);
      }
      closeWorkspaceTab('schedule');
    }

    function setClassScheduleNotice(message, type) {
      var notice = document.getElementById('classScheduleNotice');
      if (!notice) return;
      if (!message) {
        notice.className = 'schedule-notice';
        notice.textContent = '';
        return;
      }
      notice.className = 'schedule-notice is-visible ' + (type ? ('is-' + type) : 'is-info');
      notice.textContent = message;
    }

    function scheduleFetch(url, options) {
      var controller = new AbortController();
      var timeoutId = window.setTimeout(function() {
        controller.abort();
      }, 12000);

      return fetch(url, Object.assign({
        headers: {
          'Content-Type': 'application/json',
          'X-Requested-With': 'XMLHttpRequest',
          'Accept': 'application/json'
        },
        signal: controller.signal
      }, options || {})).then(function(response) {
        return response.text().then(function(text) {
          var payload;
          try {
            payload = text ? JSON.parse(text) : {};
          } catch (error) {
            throw new Error('The server returned an invalid response.');
          } finally {
            window.clearTimeout(timeoutId);
          }
          if (!response.ok || !payload.success) {
            throw new Error(payload.message || 'Request failed.');
          }
          return payload;
        });
      }).catch(function(error) {
        window.clearTimeout(timeoutId);
        if (error && error.name === 'AbortError') {
          throw new Error('Class schedule request timed out.');
        }
        throw error;
      });
    }

    function loadClassSchedule() {
      var container = document.getElementById('classScheduleContent');
      if (!container) return;
      setClassScheduleNotice('', 'info');
      container.innerHTML = '<p style="color:#6b7280;font-size:13px;">Loading class schedule...</p>';
      scheduleFetch('/common/classSchedule?classId=' + classScheduleContext.classId + '&termId=' + classScheduleContext.termId)
        .then(function(payload) {
          classScheduleState.payload = payload;
          classScheduleState.isLoadedOnce = true;
          syncDraftRowsFromPayload(payload);
          renderClassSchedule();
        })
        .catch(function(error) {
          if (classScheduleState.payload) {
            setClassScheduleNotice('Showing the last available schedule state. ' + (error.message || ''), 'error');
            renderClassSchedule();
            return;
          }
          container.innerHTML = '<div class="schedule-empty"><h4>Unable to load class schedule</h4><p>' + esc(error.message || 'Please try again.') + '</p></div>';
        });
    }

    function refreshClassScheduleInBackground() {
      if (!classScheduleState.isLoadedOnce) return;
      scheduleFetch('/common/classSchedule?classId=' + classScheduleContext.classId + '&termId=' + classScheduleContext.termId)
        .then(function(payload) {
          classScheduleState.payload = payload;
          syncDraftRowsFromPayload(payload);
          renderClassSchedule();
        })
        .catch(function() {
          // Keep the already-rendered local state when background refresh fails.
        });
    }

    function syncDraftRowsFromPayload(payload) {
      classScheduleState.isCreating = false;
      classScheduleState.draftRows = payload && payload.schedule && payload.schedule.entries && payload.schedule.entries.length
        ? payload.schedule.entries.map(function(entry) {
            return {
              dayOfWeek: entry.dayOfWeek,
              startTime: entry.startTime,
              endTime: entry.endTime,
              subjectId: entry.customLabel && !entry.subjectId ? 'custom:' + entry.customLabel : (entry.subjectId || ''),
            };
          })
        : buildDraftRowsFromSlots(getDefaultScheduleSlots());
    }

    function isScheduleBusy(actionName) {
      if (!classScheduleState.pendingAction) return false;
      return actionName ? classScheduleState.pendingAction === actionName : true;
    }

    function setSchedulePendingAction(actionName) {
      classScheduleState.pendingAction = actionName || '';
      if (classScheduleState.payload) {
        renderClassSchedule();
      }
    }

    function buildScheduleButtonMarkup(label, onclick, options) {
      var config = options || {};
      var isLoading = Boolean(config.actionName) && isScheduleBusy(config.actionName);
      var isDisabled = isScheduleBusy() && !isLoading;
      var buttonLabel = isLoading ? (config.loadingLabel || (label + '...')) : label;
      var classes = 'nav-link schedule-action-button' + (config.active ? ' active' : '') + (isLoading ? ' is-loading' : '');
      var styleAttr = config.style ? ' style="' + config.style + '"' : '';
      var disabledAttr = (isDisabled || isLoading) ? ' disabled' : '';
      return '<button type="button" class="' + classes + '" onclick="' + onclick + '"' + styleAttr + disabledAttr + '>' + esc(buttonLabel) + '</button>';
    }

    function getScheduleWeekdays() {
      return Array.isArray(classScheduleContext.weekdays) && classScheduleContext.weekdays.length
        ? classScheduleContext.weekdays
        : [
            { value: 1, label: 'Monday' },
            { value: 2, label: 'Tuesday' },
            { value: 3, label: 'Wednesday' },
            { value: 4, label: 'Thursday' },
            { value: 5, label: 'Friday' },
            { value: 6, label: 'Saturday' },
            { value: 7, label: 'Sunday' },
          ];
    }

    function getDefaultScheduleSlots() {
      return [
        { startTime: '07:30', endTime: '08:30' },
        { startTime: '08:30', endTime: '09:30' },
        { startTime: '09:30', endTime: '10:30' },
        { startTime: '10:30', endTime: '11:30' },
      ];
    }

    function buildSlotKey(startTime, endTime) {
      return String(startTime || '') + '__' + String(endTime || '');
    }

    function buildDraftRowsFromSlots(slots) {
      var weekdays = getScheduleWeekdays();
      var safeSlots = Array.isArray(slots) && slots.length ? slots : getDefaultScheduleSlots();
      var rows = [];

      weekdays.forEach(function(day) {
        safeSlots.forEach(function(slot, index) {
          rows.push({
            dayOfWeek: Number(day.value),
            startTime: slot.startTime,
            endTime: slot.endTime,
            subjectId: '',
            rowOrder: index,
          });
        });
      });

      return rows;
    }

    function getDraftSlots() {
      var slotMap = new Map();
      (classScheduleState.draftRows || []).forEach(function(row) {
        var key = buildSlotKey(row.startTime, row.endTime);
        if (!slotMap.has(key)) {
          slotMap.set(key, {
            key: key,
            startTime: row.startTime,
            endTime: row.endTime,
          });
        }
      });

      return Array.from(slotMap.values()).sort(function(left, right) {
        if (left.startTime !== right.startTime) {
          return String(left.startTime).localeCompare(String(right.startTime));
        }
        return String(left.endTime).localeCompare(String(right.endTime));
      });
    }

    function getActiveDraftWeekdays() {
      var activeDayValues = new Set((classScheduleState.draftRows || []).map(function(row) {
        return Number(row.dayOfWeek);
      }));

      return getScheduleWeekdays().filter(function(day) {
        return activeDayValues.has(Number(day.value));
      });
    }

    function getMissingDraftWeekdays() {
      var activeDayValues = new Set(getActiveDraftWeekdays().map(function(day) {
        return Number(day.value);
      }));

      return getScheduleWeekdays().filter(function(day) {
        return !activeDayValues.has(Number(day.value));
      });
    }

    function getCellDraftRow(dayOfWeek, slot) {
      var slotKey = buildSlotKey(slot.startTime, slot.endTime);
      return (classScheduleState.draftRows || []).find(function(row) {
        return Number(row.dayOfWeek) === Number(dayOfWeek) && buildSlotKey(row.startTime, row.endTime) === slotKey;
      });
    }

    function getSubjectOptionsMarkup(selectedValue) {
      var subjects = (classScheduleState.payload && classScheduleState.payload.subjects) || [];
      var sv = String(selectedValue || '');
      var options = ['<option value="">Select subject</option>'];
      options.push('<optgroup label="Subjects">');
      subjects.forEach(function(subject) {
        var selected = String(subject.subjectId) === sv ? ' selected' : '';
        options.push('<option value="' + subject.subjectId + '"' + selected + '>' + esc(subject.subjectName) + '</option>');
      });
      options.push('</optgroup>');
      var breakOptions = [
        { value: 'custom:Break', label: 'Break' },
        { value: 'custom:Lunch Break', label: 'Lunch Break' },
        { value: 'custom:Free Period', label: 'Free Period' },
        { value: 'custom:Assembly', label: 'Assembly' },
      ];
      options.push('<optgroup label="Breaks and Other">');
      breakOptions.forEach(function(opt) {
        var selected = sv === opt.value ? ' selected' : '';
        options.push('<option value="' + esc(opt.value) + '"' + selected + '>' + esc(opt.label) + '</option>');
      });
      options.push('</optgroup>');
      return options.join('');
    }

    function getDayLabel(dayOfWeek) {
      var weekdays = (classScheduleState.payload && classScheduleState.payload.weekdays) || getScheduleWeekdays();
      var match = weekdays.find(function(day) { return Number(day.value) === Number(dayOfWeek); });
      return match ? match.label : 'Day ' + dayOfWeek;
    }

    function renderClassSchedule() {
      var payload = classScheduleState.payload;
      var container = document.getElementById('classScheduleContent');
      var toolbar = document.getElementById('classScheduleToolbar');
      if (!container || !payload) return;

      container.classList.toggle('with-watermark', Boolean(classScheduleContext.logoUrl));
      if (classScheduleContext.logoUrl) {
        container.style.setProperty('--schedule-watermark-image', 'url("' + String(classScheduleContext.logoUrl).replace(/"/g, '\\"') + '")');
      } else {
        container.style.removeProperty('--schedule-watermark-image');
      }

      toolbar.innerHTML = '';
      var currentTerm = payload.currentTerm || {};
      var schedule = payload.schedule;
      var previous = payload.previousSchedule;
      var canEdit = Boolean(payload.canEdit);
      var isEditing = canEdit && classScheduleState.isEditing;

      if (schedule) {
        var toolbarButtons = buildScheduleButtonMarkup('Print', 'printClassSchedule()', {
          style: 'border:1px solid var(--border);'
        });
        if (canEdit && !isEditing) {
          toolbarButtons += buildScheduleButtonMarkup('Edit', 'enterClassScheduleEditMode()', {
            active: true
          });
        }
        if (canEdit && isEditing) {
          toolbarButtons += buildScheduleButtonMarkup('Save', 'saveCurrentClassSchedule()', {
            active: true,
            actionName: 'save',
            loadingLabel: 'Saving...'
          });
          toolbarButtons += buildScheduleButtonMarkup('Delete', 'deleteCurrentClassSchedule()', {
            style: 'border:1px solid #fecaca;color:#b91c1c;',
            actionName: 'delete',
            loadingLabel: 'Deleting...'
          });
          toolbarButtons += buildScheduleButtonMarkup('Cancel', 'cancelClassScheduleEdit()', {
            style: 'border:1px solid var(--border);'
          });
        }
        toolbar.innerHTML = toolbarButtons;
      } else if (canEdit && classScheduleState.isCreating) {
        toolbar.innerHTML = buildScheduleButtonMarkup('Save', 'saveCurrentClassSchedule()', {
          active: true,
          actionName: 'save',
          loadingLabel: 'Saving...'
        }) + buildScheduleButtonMarkup('Cancel', 'cancelClassScheduleEdit()', {
          style: 'border:1px solid var(--border);'
        });
      }

      if (!schedule && previous && canEdit) {
        container.innerHTML =
          '<div class="schedule-prompt">' +
            '<h4>Reuse existing schedule?</h4>' +
            '<p>There is an existing timetable for ' + esc(previous.schoolYearLabel) + ' · ' + esc(previous.termName) + '. Would you like to use it again this semester?</p>' +
            '<div class="schedule-prompt-actions">' +
              buildScheduleButtonMarkup('Yes, use it again', 'reusePreviousClassSchedule()', { active: true, actionName: 'reuse', loadingLabel: 'Reusing...' }) +
              buildScheduleButtonMarkup('No, start from scratch', 'startClassScheduleFromScratch()', { style: 'border:1px solid var(--border);' }) +
            '</div>' +
          '</div>';
        return;
      }

      if (!schedule && canEdit && !classScheduleState.isCreating) {
        container.innerHTML =
          '<div class="schedule-empty">' +
            '<h4>No class schedule yet</h4>' +
            '<p>No timetable has been created for ' + esc(currentTerm.termName || classScheduleContext.termName) + ' yet. Create one now for this class.</p>' +
            '<div class="schedule-editor-actions">' +
              buildScheduleButtonMarkup('Create Schedule', 'startClassScheduleFromScratch()', { active: true }) +
            '</div>' +
          '</div>';
        return;
      }

      if (!schedule && !canEdit) {
        container.innerHTML = '<div class="schedule-empty"><h4>No class schedule yet</h4><p>The class teacher, supervisor, or manager has not created a schedule for ' + esc(currentTerm.termName || classScheduleContext.termName) + ' yet.</p></div>';
        return;
      }

      renderScheduleEditor(schedule, canEdit, isEditing);
    }

    function renderScheduleEditor(schedule, canEdit, isEditing) {
      var container = document.getElementById('classScheduleContent');
      var slots = getDraftSlots();
      var isCompactScheduleViewport = window.matchMedia('(max-width: 640px)').matches;
      if (!slots.length) {
        classScheduleState.draftRows = buildDraftRowsFromSlots(getDefaultScheduleSlots());
        slots = getDraftSlots();
      }

      var weekdays = isEditing ? getActiveDraftWeekdays() : getScheduleWeekdays();
      var missingWeekdays = isEditing ? getMissingDraftWeekdays() : [];
      // Year and term are already in the class header; only when it last changed is new here.
      var summaryGrid = schedule && (schedule.updatedAt || schedule.createdAt)
        ? '<p class="schedule-updated-note">Last updated ' + esc(new Date(schedule.updatedAt || schedule.createdAt).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })) + '</p>'
        : '';

      var headerCells = slots.map(function(slot, index) {
        if (isEditing) {
          return '' +
            '<th class="schedule-slot-header">' +
              '<div class="schedule-slot-header-inner">' +
                '<div class="schedule-slot-period-row">' +
                  '<div class="schedule-slot-period">Period ' + (index + 1) + '</div>' +
                  (slots.length > 1 ? '<button type="button" class="schedule-slot-remove" onclick="removeScheduleColumn(' + index + ')" title="Remove column">&times;</button>' : '') +
                '</div>' +
                '<div class="schedule-slot-time-grid">' +
                  '<input class="schedule-cell-input schedule-slot-time-input" type="time" value="' + esc(slot.startTime) + '" data-slot-index="' + index + '" data-slot-field="startTime" />' +
                  '<input class="schedule-cell-input schedule-slot-time-input" type="time" value="' + esc(slot.endTime) + '" data-slot-index="' + index + '" data-slot-field="endTime" />' +
                '</div>' +
              '</div>' +
            '</th>';
        }

        return '' +
          '<th class="schedule-slot-header">' +
            '<div class="schedule-slot-header-inner">' +
              '<div class="schedule-slot-period">Period ' + (index + 1) + '</div>' +
              '<div class="schedule-slot-time-display">' + esc(formatScheduleTime(slot.startTime)) + '<br />' + esc(formatScheduleTime(slot.endTime)) + '</div>' +
            '</div>' +
          '</th>';
      }).join('');

      var bodyRows = weekdays.filter(function(day) {
        if (isEditing) return true;
        return slots.some(function(slot) {
          var row = getCellDraftRow(day.value, slot);
          return row && (row.subjectId !== '' && row.subjectId !== null && row.subjectId !== undefined);
        });
      }).map(function(day) {
        var cells = slots.map(function(slot, slotIndex) {
          var row = getCellDraftRow(day.value, slot) || { subjectId: '', startTime: slot.startTime, endTime: slot.endTime };
          var subjectName = resolveSubjectName(row.subjectId) || '';

          if (isEditing) {
            return '' +
              '<td>' +
                '<div class="schedule-cell-select-wrap">' +
                  '<select class="schedule-cell-select" data-day-of-week="' + day.value + '" data-slot-index="' + slotIndex + '" data-cell-field="subjectId">' + getSubjectOptionsMarkup(row.subjectId) + '</select>' +
                  '<span class="schedule-cell-arrow">▾</span>' +
                '</div>' +
              '</td>';
          }

          return '' +
            '<td>' +
              '<div class="schedule-readonly-cell' + (subjectName ? '' : ' is-empty') + (subjectName && isAssignedTeacherScheduleSubject(row.subjectId) ? ' is-assigned-teacher-subject' : '') + (subjectName && isCustomScheduleEntry(row.subjectId) ? ' is-custom-entry' : '') + '">' + esc(subjectName || 'Empty') + '</div>' +
            '</td>';
        }).join('');

        return '<tr><th class="schedule-day-cell"><div class="schedule-day-label-row"><span class="schedule-day-label-text">' + esc(day.label) + '</span>' + (isEditing && weekdays.length > 1 ? '<button type="button" class="schedule-slot-remove" onclick="removeScheduleDay(' + Number(day.value) + ')" title="Remove day">&times;</button>' : '') + '</div></th>' + cells + '</tr>';
      }).join('');

      container.innerHTML =
        summaryGrid +
        '<div class="schedule-table-wrap">' +
          '<table class="schedule-table">' +
            '<thead><tr><th class="schedule-day-cell">Day</th>' + headerCells + '</tr></thead>' +
            '<tbody>' + bodyRows + '</tbody>' +
          '</table>' +
        '</div>' +
        (isEditing
          ? '<div class="schedule-editor-actions">' +
              buildScheduleButtonMarkup('Add time column', 'addScheduleColumn()', { style: 'border:1px solid var(--border);' }) +
              (missingWeekdays.length
                ? '<div class="schedule-day-restore-row"><span class="schedule-day-restore-label">Add day:</span>' + missingWeekdays.map(function(day) {
                    return '<button type="button" class="schedule-day-chip" onclick="restoreScheduleDay(' + Number(day.value) + ')">' + esc(day.label) + '</button>';
                  }).join('') + '</div>'
                : '') +
            '</div>'
          : (!canEdit ? '<div class="schedule-inline-note">This schedule is view only for your role.</div>' : ''));

      bindScheduleEditorInputs();
    }

    function resolveSubjectName(subjectId) {
      if (typeof subjectId === 'string' && subjectId.indexOf('custom:') === 0) {
        return subjectId.slice(7);
      }
      var subjects = (classScheduleState.payload && classScheduleState.payload.subjects) || [];
      var match = subjects.find(function(subject) { return String(subject.subjectId) === String(subjectId || ''); });
      return match ? match.subjectName : '';
    }

    function isAssignedTeacherScheduleSubject(subjectId) {
      if (typeof subjectId === 'string' && subjectId.indexOf('custom:') === 0) {
        return false;
      }
      var subjects = (classScheduleState.payload && classScheduleState.payload.subjects) || [];
      var match = subjects.find(function(subject) { return String(subject.subjectId) === String(subjectId || ''); });
      return Boolean(match && match.assignedToCurrentTeacher);
    }

    function isCustomScheduleEntry(subjectId) {
      return typeof subjectId === 'string' && subjectId.indexOf('custom:') === 0;
    }

    function bindScheduleEditorInputs() {
      var container = document.getElementById('classScheduleContent');
      if (!container) return;
      Array.prototype.forEach.call(container.querySelectorAll('[data-slot-index][data-slot-field]'), function(input) {
        input.addEventListener('change', function() {
          updateScheduleSlot(Number(this.getAttribute('data-slot-index')), this.getAttribute('data-slot-field'), this.value);
        });
      });

      Array.prototype.forEach.call(container.querySelectorAll('[data-day-of-week][data-slot-index][data-cell-field]'), function(input) {
        input.addEventListener('change', function() {
          updateScheduleCell(
            Number(this.getAttribute('data-day-of-week')),
            Number(this.getAttribute('data-slot-index')),
            this.getAttribute('data-cell-field'),
            this.value
          );
        });
      });
    }

    function updateScheduleSlot(slotIndex, field, value) {
      if (!classScheduleState.isEditing) return;
      var slots = getDraftSlots();
      var slot = slots[slotIndex];
      if (!slot) return;
      var oldKey = buildSlotKey(slot.startTime, slot.endTime);

      classScheduleState.draftRows = (classScheduleState.draftRows || []).map(function(row) {
        if (buildSlotKey(row.startTime, row.endTime) !== oldKey) return row;
        var updatedRow = Object.assign({}, row);
        updatedRow[field] = value;
        return updatedRow;
      });
      renderClassSchedule();
    }

    function updateScheduleCell(dayOfWeek, slotIndex, field, value) {
      if (!classScheduleState.isEditing) return;
      var slots = getDraftSlots();
      var slot = slots[slotIndex];
      if (!slot) return;
      var slotKey = buildSlotKey(slot.startTime, slot.endTime);

      classScheduleState.draftRows = (classScheduleState.draftRows || []).map(function(row) {
        if (Number(row.dayOfWeek) !== Number(dayOfWeek) || buildSlotKey(row.startTime, row.endTime) !== slotKey) {
          return row;
        }

        var updatedRow = Object.assign({}, row);
        updatedRow[field] = value;
        return updatedRow;
      });
    }

    function addScheduleColumn() {
      if (!classScheduleState.isEditing) return;
      var slots = getDraftSlots();
      var lastSlot = slots[slots.length - 1] || { startTime: '08:00', endTime: '09:00' };
      var nextStartTime = lastSlot.endTime || '09:00';
      var nextEndTime = incrementTimeByHour(nextStartTime);
      var weekdays = getActiveDraftWeekdays();

      weekdays.forEach(function(day, index) {
        classScheduleState.draftRows.push({
          dayOfWeek: Number(day.value),
          startTime: nextStartTime,
          endTime: nextEndTime,
          subjectId: '',
          rowOrder: slots.length + index,
        });
      });

      renderClassSchedule();
    }

    function removeScheduleDay(dayOfWeek) {
      if (!classScheduleState.isEditing) return;
      var weekdays = getActiveDraftWeekdays();
      if (weekdays.length <= 1) {
        setClassScheduleNotice('Keep at least one day in the schedule.', 'error');
        return;
      }

      classScheduleState.draftRows = (classScheduleState.draftRows || []).filter(function(row) {
        return Number(row.dayOfWeek) !== Number(dayOfWeek);
      });

      renderClassSchedule();
    }

    function restoreScheduleDay(dayOfWeek) {
      if (!classScheduleState.isEditing) return;
      var slots = getDraftSlots();
      if (!slots.length) {
        slots = getDefaultScheduleSlots();
      }

      slots.forEach(function(slot, index) {
        classScheduleState.draftRows.push({
          dayOfWeek: Number(dayOfWeek),
          startTime: slot.startTime,
          endTime: slot.endTime,
          subjectId: '',
          rowOrder: index,
        });
      });

      classScheduleState.draftRows.sort(function(left, right) {
        if (Number(left.dayOfWeek) !== Number(right.dayOfWeek)) {
          return Number(left.dayOfWeek) - Number(right.dayOfWeek);
        }
        if (left.startTime !== right.startTime) {
          return String(left.startTime).localeCompare(String(right.startTime));
        }
        return String(left.endTime).localeCompare(String(right.endTime));
      });

      renderClassSchedule();
    }

    function removeScheduleColumn(slotIndex) {
      if (!classScheduleState.isEditing) return;
      var slots = getDraftSlots();
      var slot = slots[slotIndex];
      if (!slot) return;
      var slotKey = buildSlotKey(slot.startTime, slot.endTime);

      classScheduleState.draftRows = (classScheduleState.draftRows || []).filter(function(row) {
        return buildSlotKey(row.startTime, row.endTime) !== slotKey;
      });

      if (!classScheduleState.draftRows.length) {
        classScheduleState.draftRows = buildDraftRowsFromSlots(getDefaultScheduleSlots());
      }

      renderClassSchedule();
    }

    function incrementTimeByHour(timeText) {
      var parts = String(timeText || '08:00').split(':');
      var hours = Number(parts[0] || 0);
      var minutes = Number(parts[1] || 0);
      var totalMinutes = hours * 60 + minutes + 60;
      var nextHours = Math.floor(totalMinutes / 60) % 24;
      var nextMinutes = totalMinutes % 60;
      return String(nextHours).padStart(2, '0') + ':' + String(nextMinutes).padStart(2, '0');
    }

    function startClassScheduleFromScratch() {
      classScheduleState.isCreating = true;
      classScheduleState.isEditing = true;
      classScheduleState.payload.schedule = null;
      classScheduleState.payload.previousSchedule = null;
      classScheduleState.draftRows = buildDraftRowsFromSlots(getDefaultScheduleSlots());
      setClassScheduleNotice('', 'info');
      renderClassSchedule();
    }

    function enterClassScheduleEditMode() {
      classScheduleState.isEditing = true;
      if (classScheduleState.payload && classScheduleState.payload.schedule) {
        syncDraftRowsFromPayload(classScheduleState.payload);
      }
      renderClassSchedule();
    }

    function cancelClassScheduleEdit() {
      classScheduleState.isEditing = false;
      classScheduleState.pendingAction = '';
      if (classScheduleState.payload && classScheduleState.payload.schedule) {
        syncDraftRowsFromPayload(classScheduleState.payload);
      } else {
        classScheduleState.isCreating = false;
        classScheduleState.draftRows = buildDraftRowsFromSlots(getDefaultScheduleSlots());
      }
      setClassScheduleNotice('', 'info');
      renderClassSchedule();
    }

    function collectScheduleRows() {
      return (classScheduleState.draftRows || []).map(function(row) {
        var isCustom = typeof row.subjectId === 'string' && row.subjectId.indexOf('custom:') === 0;
        return {
          dayOfWeek: Number(row.dayOfWeek),
          startTime: row.startTime,
          endTime: row.endTime,
          subjectId: isCustom ? null : (row.subjectId === '' ? null : Number(row.subjectId)),
          customLabel: isCustom ? row.subjectId.slice(7) : null,
        };
      });
    }

    function saveCurrentClassSchedule() {
      if (!classScheduleState.isEditing) return;
      setClassScheduleNotice('', 'info');
      setSchedulePendingAction('save');
      scheduleFetch('/common/classSchedule/save', {
        method: 'POST',
        body: JSON.stringify({
          classId: classScheduleContext.classId,
          termId: classScheduleContext.termId,
          schoolYearId: classScheduleContext.schoolYearId,
          entries: collectScheduleRows(),
        })
      })
        .then(function(payload) {
          classScheduleState.payload.schedule = payload.schedule;
          classScheduleState.payload.previousSchedule = null;
          classScheduleState.isCreating = false;
          classScheduleState.isEditing = false;
          syncDraftRowsFromPayload(classScheduleState.payload);
          setClassScheduleNotice(payload.message || 'Class schedule saved.', 'success');
          setSchedulePendingAction('');
          renderClassSchedule();
        })
        .catch(function(error) {
          setSchedulePendingAction('');
          setClassScheduleNotice(error.message || 'Failed to save class schedule.', 'error');
        });
    }

    function deleteCurrentClassSchedule() {
      if (!classScheduleState.isEditing) return;
      if (!confirm('Delete the class schedule for this term?')) return;
      setSchedulePendingAction('delete');
      scheduleFetch('/common/classSchedule/delete', {
        method: 'POST',
        body: JSON.stringify({
          classId: classScheduleContext.classId,
          termId: classScheduleContext.termId,
        })
      })
        .then(function(payload) {
          classScheduleState.payload.schedule = null;
          classScheduleState.payload.previousSchedule = null;
          classScheduleState.isCreating = false;
          classScheduleState.isEditing = false;
          classScheduleState.draftRows = buildDraftRowsFromSlots(getDefaultScheduleSlots());
          setSchedulePendingAction('');
          setClassScheduleNotice(payload.message || 'Class schedule deleted.', 'success');
          renderClassSchedule();
        })
        .catch(function(error) {
          setSchedulePendingAction('');
          setClassScheduleNotice(error.message || 'Failed to delete class schedule.', 'error');
        });
    }

    function reusePreviousClassSchedule() {
      setSchedulePendingAction('reuse');
      scheduleFetch('/common/classSchedule/reuse', {
        method: 'POST',
        body: JSON.stringify({
          classId: classScheduleContext.classId,
          termId: classScheduleContext.termId,
          schoolYearId: classScheduleContext.schoolYearId,
        })
      })
        .then(function(payload) {
          classScheduleState.payload.schedule = payload.schedule;
          classScheduleState.payload.previousSchedule = null;
          classScheduleState.isCreating = false;
          classScheduleState.isEditing = false;
          syncDraftRowsFromPayload(classScheduleState.payload);
          setSchedulePendingAction('');
          setClassScheduleNotice(payload.message || 'Previous schedule copied.', 'info');
          renderClassSchedule();
        })
        .catch(function(error) {
          setSchedulePendingAction('');
          setClassScheduleNotice(error.message || 'Failed to reuse previous schedule.', 'error');
        });
    }

    function printClassSchedule() {
      var rows = collectScheduleRows();
      var weekdays = getScheduleWeekdays();
      var slots = getDraftSlots();
      var orgPrimaryColor = classScheduleContext.orgPrimaryColor || '#01535b';
      var orgPrimaryHover = classScheduleContext.orgPrimaryHover || orgPrimaryColor;
      var orgTintColor = toAlphaColor(orgPrimaryColor, 0.08);
      var schoolName = classScheduleContext.schoolName || 'School';
      var printedAt = new Date().toLocaleString();
      var ownershipNotice = 'This class schedule is the property of ' + schoolName + '. Any unauthorized use, reproduction, distribution, or alteration of this document may be addressed by the said organization or institution. ' + schoolName + ' reserves the right to take appropriate action regarding misuse.';

      var printWeekdays = weekdays.filter(function(day) {
        return slots.some(function(slot) {
          var dr = getCellDraftRow(day.value, slot);
          return dr && (dr.subjectId !== '' && dr.subjectId !== null && dr.subjectId !== undefined);
        });
      });
      if (!printWeekdays.length) printWeekdays = weekdays;

      var content = '<table style="width:100%;border-collapse:collapse;table-layout:fixed;background:#ffffff;border-radius:18px;overflow:hidden;">' +
        '<thead><tr><th style="border:1px solid #d7dee8;padding:12px 10px;background:' + esc(orgTintColor) + ';color:' + esc(orgPrimaryColor) + ';font-size:11px;text-transform:uppercase;letter-spacing:0.06em;">Day</th>' +
        slots.map(function(slot, index) {
          return '<th style="border:1px solid #d7dee8;padding:12px 10px;background:' + esc(orgTintColor) + ';"><div style="font-size:11px;color:' + esc(orgPrimaryColor) + ';font-weight:800;text-transform:uppercase;letter-spacing:0.06em;">Period ' + (index + 1) + '</div><div style="margin-top:4px;color:#0f172a;font-weight:700;">' + esc(formatScheduleTime(slot.startTime)) + ' - ' + esc(formatScheduleTime(slot.endTime)) + '</div></th>';
        }).join('') +
        '</tr></thead><tbody>' +
        printWeekdays.map(function(day) {
          return '<tr><th style="border:1px solid #d7dee8;padding:12px 10px;background:' + esc(orgTintColor) + ';color:#0f172a;font-size:11px;text-transform:uppercase;letter-spacing:0.05em;">' + esc(day.label) + '</th>' +
            slots.map(function(slot) {
              var row = rows.find(function(entry) {
                return Number(entry.dayOfWeek) === Number(day.value) && buildSlotKey(entry.startTime, entry.endTime) === buildSlotKey(slot.startTime, slot.endTime);
              });
              var isCustomEntry = Boolean(row && row.customLabel);
              var cellLabel = (row && row.customLabel) ? row.customLabel : (resolveSubjectName(row && row.subjectId) || '');
              return '<td style="border:1px solid #d7dee8;padding:14px 10px;text-align:center;vertical-align:middle;min-height:60px;background:rgba(255,255,255,0.92);font-weight:' + (isCustomEntry ? '700' : '600') + ';color:' + (isCustomEntry ? '#c77700' : (cellLabel ? '#0f172a' : '#94a3b8')) + ';">' + esc(cellLabel || 'Empty') + '</td>';
            }).join('') +
          '</tr>';
        }).join('') +
        '</tbody></table>';

      var printWindow = window.open('', '_blank');
      if (!printWindow) return;
      printWindow.document.write('<html><head><title>Class Schedule</title><style>@page{size:landscape;margin:12mm;} body{font-family:' + esc(getComputedStyle(document.body).fontFamily || 'Arial, sans-serif') + ';margin:0;color:#0f172a;background:#f4f7fb;} .schedule-print{position:relative;min-height:100vh;padding:20px;background:linear-gradient(180deg,#ffffff 0%,#f8fbff 100%);display:flex;flex-direction:column;} .schedule-print::after{content:"";position:fixed;inset:0;background-image:' + (classScheduleContext.logoUrl ? 'url("' + esc(classScheduleContext.logoUrl) + '")' : 'none') + ';background-repeat:no-repeat;background-position:center;background-size:360px 360px;opacity:0.06;pointer-events:none;z-index:2;} .schedule-print > *{position:relative;z-index:1;} .schedule-print-header{display:flex;align-items:flex-start;justify-content:space-between;gap:18px;padding:20px 22px;border-radius:24px;background:linear-gradient(135deg,' + esc(orgPrimaryColor) + ' 0%,' + esc(orgPrimaryHover) + ' 100%);color:#ffffff;box-shadow:0 18px 40px rgba(15,23,42,0.14);} .schedule-print-brand{display:flex;align-items:center;gap:16px;} .schedule-print-logo{width:64px;height:64px;border-radius:18px;background:rgba(255,255,255,0.14);border:1px solid rgba(255,255,255,0.3);display:flex;align-items:center;justify-content:center;overflow:hidden;flex:0 0 auto;} .schedule-print-logo img{width:100%;height:100%;object-fit:contain;} .schedule-print-kicker{margin:0 0 6px;font-size:11px;font-weight:700;letter-spacing:0.16em;text-transform:uppercase;color:rgba(255,255,255,0.78);} .schedule-print-school{margin:0;font-size:28px;line-height:1.1;font-weight:800;} .schedule-print-title{margin:6px 0 0;font-size:15px;line-height:1.5;color:rgba(255,255,255,0.9);} .schedule-print-header-side{display:flex;flex-direction:column;align-items:flex-end;gap:10px;min-width:220px;} .schedule-print-pill{display:inline-flex;align-items:center;padding:10px 14px;border-radius:999px;background:rgba(255,255,255,0.14);border:1px solid rgba(255,255,255,0.26);font-size:12px;font-weight:700;text-transform:uppercase;letter-spacing:0.08em;} .schedule-print-header-meta{display:grid;gap:6px;text-align:right;} .schedule-print-header-meta-row{font-size:13px;line-height:1.4;color:rgba(255,255,255,0.92);} .schedule-print-header-meta-label{font-weight:700;color:rgba(255,255,255,0.72);text-transform:uppercase;letter-spacing:0.08em;font-size:10px;margin-right:6px;} .schedule-print-table{margin-top:18px;border-radius:20px;overflow:hidden;border:1px solid #d7dee8;box-shadow:0 10px 28px rgba(15,23,42,0.06);} .schedule-print-disclaimer{max-width:760px;margin:28px auto 0;padding:18px 22px;text-align:center;color:#475569;font-size:13px;line-height:1.75;} .schedule-print-disclaimer strong{display:block;margin-bottom:8px;color:' + esc(orgPrimaryColor) + ';font-size:12px;font-weight:800;letter-spacing:0.08em;text-transform:uppercase;} .schedule-print-footer{margin-top:auto;padding-top:18px;display:flex;justify-content:center;color:#64748b;font-size:12px;font-weight:600;} table{width:100%;border-collapse:collapse;table-layout:fixed;background:#ffffff;} @media print{body{background:#ffffff;} .schedule-print{padding:0;background:#ffffff;} .schedule-print-header{box-shadow:none;} .schedule-print-table{box-shadow:none;}}</style></head><body><div class="schedule-print"><div class="schedule-print-header"><div class="schedule-print-brand">' + (classScheduleContext.logoUrl ? '<div class="schedule-print-logo"><img src="' + esc(classScheduleContext.logoUrl) + '" alt="School logo" /></div>' : '') + '<div><p class="schedule-print-kicker">Class Timetable</p><h1 class="schedule-print-school">' + esc(schoolName) + '</h1><p class="schedule-print-title">' + esc(classScheduleContext.className) + ' Class Schedule</p></div></div><div class="schedule-print-header-side"><div class="schedule-print-pill">' + esc(classScheduleContext.termName) + '</div><div class="schedule-print-header-meta"><div class="schedule-print-header-meta-row"><span class="schedule-print-header-meta-label">Class</span>' + esc(classScheduleContext.className) + '</div><div class="schedule-print-header-meta-row"><span class="schedule-print-header-meta-label">School Year</span>' + esc(classScheduleContext.schoolYearLabel) + '</div></div></div></div><div class="schedule-print-table">' + content + '</div><div class="schedule-print-disclaimer"><strong>Ownership Notice</strong><span>' + esc(ownershipNotice) + '</span></div><div class="schedule-print-footer">Printed on ' + esc(printedAt) + '</div></div></body></html>');
      printWindow.document.close();
      printWindow.focus();
      printWindow.print();
    }

    function toAlphaColor(color, alpha) {
      if (!color) return 'rgba(1, 83, 91, ' + alpha + ')';
      var trimmedColor = String(color).trim();
      if (/^#([0-9a-f]{3}){1,2}$/i.test(trimmedColor)) {
        var hex = trimmedColor.slice(1);
        if (hex.length === 3) {
          hex = hex.split('').map(function(char) { return char + char; }).join('');
        }
        var red = parseInt(hex.slice(0, 2), 16);
        var green = parseInt(hex.slice(2, 4), 16);
        var blue = parseInt(hex.slice(4, 6), 16);
        return 'rgba(' + red + ', ' + green + ', ' + blue + ', ' + alpha + ')';
      }
      var rgbaMatch = trimmedColor.match(/^rgba?\(([^)]+)\)$/i);
      if (rgbaMatch) {
        var parts = rgbaMatch[1].split(',').slice(0, 3).map(function(part) { return part.trim(); });
        return 'rgba(' + parts.join(', ') + ', ' + alpha + ')';
      }
      return trimmedColor;
    }

    function syncClassDashboardSortLabel(button, noun) {
      if (!button) return;
      var direction = button.getAttribute('data-sort-direction') === 'desc' ? 'desc' : 'asc';
      button.setAttribute('aria-label', direction === 'asc' ? 'Sort ' + noun + ' Z to A' : 'Sort ' + noun + ' A to Z');
    }

    function sortClassDashboardStudents(direction) {
      var list = document.getElementById('classDashboardStudentsList');
      if (!list) return;
      var items = Array.prototype.slice.call(list.querySelectorAll('li[data-student-name]'));
      items.sort(function(a, b) {
        var nameA = a.getAttribute('data-student-name') || '';
        var nameB = b.getAttribute('data-student-name') || '';
        return direction === 'desc'
          ? nameB.localeCompare(nameA, undefined, { sensitivity: 'base' })
          : nameA.localeCompare(nameB, undefined, { sensitivity: 'base' });
      });
      items.forEach(function(item, index) {
        var indexNode = item.querySelector('.student-index');
        if (indexNode) indexNode.textContent = String(index + 1);
        list.appendChild(item);
      });
    }

    function sortClassDashboardSubjects(direction) {
      var list = document.getElementById('classDashboardSubjectsList');
      if (!list) return;
      var items = Array.prototype.slice.call(list.querySelectorAll('[data-subject-name]'));
      items.sort(function(a, b) {
        var nameA = a.getAttribute('data-subject-name') || '';
        var nameB = b.getAttribute('data-subject-name') || '';
        return direction === 'desc'
          ? nameB.localeCompare(nameA, undefined, { sensitivity: 'base' })
          : nameA.localeCompare(nameB, undefined, { sensitivity: 'base' });
      });
      items.forEach(function(item) {
        list.appendChild(item);
      });
    }

    document.addEventListener('DOMContentLoaded', function() {
      applyInitialStudentTeacherRemarkIndicators();
      var studentButton = document.getElementById('classDashboardStudentSort');
      if (studentButton) {
        syncClassDashboardSortLabel(studentButton, 'students');
        sortClassDashboardStudents(studentButton.getAttribute('data-sort-direction') || 'asc');
        studentButton.addEventListener('click', function() {
          var nextDirection = studentButton.getAttribute('data-sort-direction') === 'asc' ? 'desc' : 'asc';
          studentButton.setAttribute('data-sort-direction', nextDirection);
          syncClassDashboardSortLabel(studentButton, 'students');
          sortClassDashboardStudents(nextDirection);
        });
      }

      var subjectButton = document.getElementById('classDashboardSubjectSort');
      if (subjectButton) {
        syncClassDashboardSortLabel(subjectButton, 'subjects');
        sortClassDashboardSubjects(subjectButton.getAttribute('data-sort-direction') || 'asc');
        subjectButton.addEventListener('click', function() {
          var nextDirection = subjectButton.getAttribute('data-sort-direction') === 'asc' ? 'desc' : 'asc';
          subjectButton.setAttribute('data-sort-direction', nextDirection);
          syncClassDashboardSortLabel(subjectButton, 'subjects');
          sortClassDashboardSubjects(nextDirection);
        });
      }
    });

    window.toggleClassScheduleModal = toggleClassScheduleModal;
    window.closeClassScheduleModal = closeClassScheduleModal;
    window.addScheduleColumn = addScheduleColumn;
    window.removeScheduleColumn = removeScheduleColumn;
    window.removeScheduleDay = removeScheduleDay;
    window.restoreScheduleDay = restoreScheduleDay;
    window.saveCurrentClassSchedule = saveCurrentClassSchedule;
    window.deleteCurrentClassSchedule = deleteCurrentClassSchedule;
    window.reusePreviousClassSchedule = reusePreviousClassSchedule;
    window.startClassScheduleFromScratch = startClassScheduleFromScratch;
    window.enterClassScheduleEditMode = enterClassScheduleEditMode;
    window.cancelClassScheduleEdit = cancelClassScheduleEdit;
    window.printClassSchedule = printClassSchedule;

  
