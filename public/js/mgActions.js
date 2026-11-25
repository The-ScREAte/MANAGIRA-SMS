/* Click, change, submit and other handlers for elements that carry data-on<event>="<id>".
   They replace inline on-event attributes, which the Content-Security-Policy refuses.
   Each function runs with `this` = the element and `event` = the event, exactly as the inline
   code did. A value the page used to print into the code is read from the element's
   data-mga0, data-mga1... attributes. To add one: give the element data-onclick="<id>" and
   add "<id>": function(event){ ... } below. Each element is bound once, directly (so event.stopPropagation() behaves as it did inline), and
   elements added later are bound as they appear. */
(function () {
var R=window.__mgAct;
if(!R){R=window.__mgAct={H:{},C:{},T:{}};
R.fire=function(el,e,id){var f=R.H[id];if(!f)return;if(f.call(el,e)===false)e.preventDefault();};
R.bind=function(el){if(el.__mgB)return;el.__mgB=1;var at=el.attributes;for(var i=0;i<at.length;i++){var n=at[i].name;if(n.indexOf('data-on')===0&&R.T[n.slice(7)]){(function(t,n){el.addEventListener(t,function(e){R.fire(el,e,el.getAttribute(n));});})(n.slice(7),n);}}};
R.scan=function(root){if(!root||root.nodeType!==1||!R.sel)return;if(root.matches(R.sel))R.bind(root);var l=root.querySelectorAll(R.sel);for(var i=0;i<l.length;i++)R.bind(l[i]);};
R.T_=function(v){if(v===null)return v;if(v===''||isNaN(v))return v==='true'?true:v==='false'?false:v==='null'?null:v==='undefined'?undefined:v;return Number(v);};
R.imgs=function(){document.querySelectorAll('img[data-onerror]').forEach(function(img){var s=img.getAttribute('src')||'';if(s&&!/\.svg(\?|$)/i.test(s)&&img.complete&&img.naturalWidth===0&&img.naturalHeight===0&&!img.__mgSeen){img.__mgSeen=1;img.dispatchEvent(new Event('error'));}});};
R.start=function(){if(!R.noop){R.noop=1;document.addEventListener('click',function(e){var a=e.target.closest&&e.target.closest('a[data-noop]');if(a)e.preventDefault();});}R.sel=Object.keys(R.T).map(function(t){return '[data-on'+t+']';}).join(',');R.scan(document.documentElement);R.imgs();if(!R.mo&&window.MutationObserver){R.mo=new MutationObserver(function(ms){for(var i=0;i<ms.length;i++){var a=ms[i].addedNodes;for(var j=0;j<a.length;j++)R.scan(a[j]);}});R.mo.observe(document.documentElement,{childList:true,subtree:true});}};}
var H={
"account-acceptHubInvitationExisting.1": function(event){ toggleSubmitButton()
},
"account-accountPersonalization.1": function(event){ updateFontSample()
},
"account-apiAgreement.1": function(event){ window.print()
},
"account-finance.10": function(event){ finSelectAllChips('studentChips', true, true)
},
"account-finance.11": function(event){ finSelectAllChips('studentChips', false)
},
"account-finance.12": function(event){ finTogglePayAll(this)
},
"account-finance.13": function(event){ openEditBill(JSON.parse(this.getAttribute('data-mga0')))
},
"account-finance.14": function(event){ event.stopPropagation();
},
"account-finance.15": function(event){ return confirm('Email every parent who still owes this bill, with what they owe and a link to pay?');
},
"account-finance.16": function(event){ event.stopPropagation(); openEditBill(JSON.parse(this.getAttribute('data-mga0')))
},
"account-finance.17": function(event){ return confirm('Delete this bill for every student it was sent to?');
},
"account-finance.18": function(event){ return confirm('Remove this payment? The student\'s balance goes back up, and the change is kept in the activity log.');
},
"account-finance.19": function(event){ finRunSignoffFilter()
},
"account-finance.2": function(event){ finToggleAcc('acc-create-bill')
},
"account-finance.20": function(event){ return confirm('Reopen this sign-off for correction? Audit logs will be saved, the history lock will be removed, and the collection will return to class PayGira so it can be signed off again after corrections.');
},
"account-finance.21": function(event){ finToggleAcc('acc-create-template', this)
},
"account-finance.22": function(event){ return confirm('Delete template?')
},
"account-finance.23": function(event){ document.getElementById('finPayoutHistoryCard').style.display='none';
},
"account-finance.24": function(event){ openArrearsReportModal()
},
"account-finance.25": function(event){ openArrearsEmailAll()
},
"account-finance.26": function(event){ toggleAllArrears(this)
},
"account-finance.27": function(event){ if(this.__mgOnce)return;this.__mgOnce=1;this.src='' + this.getAttribute('data-mga0') + '';
},
"account-finance.28": function(event){ toggleArrearsDetails('' + this.getAttribute('data-mga0') + '')
},
"account-finance.29": function(event){ openArrearsEmailDrawer('' + this.getAttribute('data-mga0') + '', true)
},
"account-finance.3": function(event){ finToggleAcc('acc-record-payment')
},
"account-finance.30": function(event){ openArrearsNoteModal('' + this.getAttribute('data-mga0') + '', this.getAttribute('data-name'))
},
"account-finance.31": function(event){ openArrearsEmailDrawer()
},
"account-finance.32": function(event){ clearArrearsSelection()
},
"account-finance.33": function(event){ return confirm('Delete this saved report?');
},
"account-finance.34": function(event){ closeArrearsReportModal()
},
"account-finance.35": function(event){ closeArrearsEmailDrawer()
},
"account-finance.36": function(event){ closeArrearsNoteModal()
},
"account-finance.37": function(event){ submitEditBillForm()
},
"account-finance.38": function(event){ submitEditBillForm('draft')
},
"account-finance.4": function(event){ finToggleAcc('acc-create-payout')
},
"account-finance.5": function(event){ window.syncBillTargetClasses && window.syncBillTargetClasses()
},
"account-finance.6": function(event){ finSelectAllChips('classChips', true, true)
},
"account-finance.7": function(event){ finSelectAllChips('classChips', false)
},
"account-finance.8": function(event){ finChipChanged(this,'classCount')
},
"account-finance.9": function(event){ finFilterStudents(this.value)
},
"account-finance.avatar": function(event){ if(this.__mgOnce)return;this.__mgOnce=1;this.src=this.getAttribute('data-mga0');
},
"account-financeOverviewDetailSection.1": function(event){ finRunReportFilter()
},
"account-financeOverviewDetailSection.2": function(event){ finRunReportFilter()
},
"account-financeOverviewDetailSection.3": function(event){ finResetReportFilter()
},
"account-guardianLogin.1": function(event){ togglePasswordVisibility('password', this)
},
"account-guardianLogin.2": function(event){ event.preventDefault()
},
"account-hubInvitation.1": function(event){ if (window.combinePhoneCountryCombos) window.combinePhoneCountryCombos(this);
},
"account-managePublicContent.1": function(event){ removeFileField(this)
},
"account-myPaygira.1": function(event){ mpOpenBill(__mgAct.T_(this.getAttribute('data-mga0')))
},
"account-myPaygira.2": function(event){ mpCloseBill()
},
"account-myPaygira.3": function(event){ mpCloseCollect()
},
"account-myPaygira.4": function(event){ mpCloseBulkCollect()
},
"account-myPaygira.5": function(event){ mpCloseSignoff()
},
"account-register.1": function(event){ if (window.combinePhoneCountryCombos) window.combinePhoneCountryCombos(this);
},
"account-register.2": function(event){ checkPasswordStrength(this.value)
},
"account-register.3": function(event){ toggleMultiplePasswords(['password', 'confirmPassword'], this)
},
"account-resetPassword.1": function(event){ return validatePasswords();
},
"account-resetPassword.2": function(event){ checkPasswordStrength(this.value)
},
"account-resetPassword.3": function(event){ toggleMultiplePasswords(['password', 'confirmPassword'], this)
},
"account-settings.1": function(event){ toggleSidPanel(this.checked)
},
"account-settings.2": function(event){ updateSidPreview()
},
"account-settings.3": function(event){ var t=this.closest('label').querySelector('span:first-of-type'); var th=t.querySelector('span'); t.style.background=this.checked?'var(--primary, #01535b)':'#cbd5e1'; th.style.left=this.checked?'13px':'2px'; var sr=document.getElementById('sidStartingRow'); if(sr) sr.style.display=this.checked?'':'none';
},
"account-settings.4": function(event){ updateSidNextPreview()
},
"account-settings.5": function(event){ return confirm('Remove your profile photo?');
},
"account-settings.6": function(event){ this.remove()
},
"account-settings.7": function(event){ return confirm('Change who covers the service fee? This applies to every online payment from now on.');
},
"account-settings.8": function(event){ var b=document.querySelector('.nav-link[data-target="access-tokens"]'); if (b) { b.click(); } return false;
},
"account-studentLogin.1": function(event){ togglePasswordVisibility('password', this)
},
"account-studentLogin.2": function(event){ event.preventDefault()
},
"account-update.1": function(event){ toggleMultiplePasswords(['password', 'confirmPassword'], this)
},
"account-update.2": function(event){ showDetachmentModal()
},
"account-update.3": function(event){ closeDetachmentModal()
},
"account-updateCard.1": function(event){ togglePaystackFields()
},
"account-updateCard.2": function(event){ updateBankName()
},
"admin-backups.1": function(event){ this.querySelector('button').disabled = true; this.querySelector('button').textContent = 'Backing up…';
},
"admin-createPromo.1": function(event){ return confirm('Delete this promo code?');
},
"admin-editAdminUser.1": function(event){ return confirm('Send a new password setup email to this admin? The previous link will be invalidated.');
},
"admin-emailSuppressions.remove": function(event){ return confirm('Remove suppression for ' + this.getAttribute('data-mga0') + '?');
},
"admin-helpHistory.1": function(event){ toggleDetails('' + this.getAttribute('data-mga0') + '')
},
"admin-helpHistory.2": function(event){ confirmReopen(event, '' + this.getAttribute('data-mga0') + '')
},
"admin-helpHistory.3": function(event){ confirmDelete(event, '' + this.getAttribute('data-mga0') + '')
},
"admin-helpMessages.1": function(event){ return confirmBulk(event)
},
"admin-helpMessages.2": function(event){ toggleAll(this)
},
"admin-helpMessages.3": function(event){ event.stopPropagation()
},
"admin-helpMessages.4": function(event){ updateBulkBtn()
},
"admin-helpMessages.5": function(event){ toggleDetails('' + this.getAttribute('data-mga0') + '')
},
"admin-helpMessages.6": function(event){ return validateRespond(this)
},
"admin-helpMessages.7": function(event){ submitNoMsg(this, '/admin/resolveMessage', '' + this.getAttribute('data-mga0') + '', 'Mark this ticket as closed?')
},
"admin-helpMessages.8": function(event){ submitNoMsg(this, '/admin/tempDeleteMessage', '' + this.getAttribute('data-mga0') + '', 'Delete this ticket?')
},
"admin-manageDonations.1": function(event){ return confirm('Delete this donation campaign and its image?')
},
"admin-manageEmployment.1": function(event){ return confirm('Send approval email for this applicant?');
},
"admin-manageEmployment.10": function(event){ return confirm('Delete this job posting?')
},
"admin-manageEmployment.2": function(event){ return confirm('Send rejection email for this applicant?');
},
"admin-manageEmployment.3": function(event){ return confirm('Send second interview invitation?');
},
"admin-manageEmployment.4": function(event){ return confirm('Send rejection email after first interview?');
},
"admin-manageEmployment.5": function(event){ return confirm('Send final interview invitation?');
},
"admin-manageEmployment.6": function(event){ return confirm('Send rejection email after second interview?');
},
"admin-manageEmployment.7": function(event){ return confirm('Send rejection email after final interview?');
},
"admin-manageEmployment.8": function(event){ return confirm('Reverse rejection and notify applicant to disregard previous rejection email?');
},
"admin-manageEmployment.9": function(event){ return confirm('Delete this application permanently?');
},
"admin-migrations.1": function(event){ return confirm('Open ' + this.getAttribute('data-mga0') + '\'s migration? Their managers are emailed and find Sandbox in their menu; while they have it on, their live account takes no new data.');
},
"admin-migrations.2": function(event){ return confirm('Cancel this migration? Its sandbox and files are deleted.')
},
"admin-migrations.3": function(event){ return confirm('' + this.getAttribute('data-mga0') + '')
},
"admin-migrations.4": function(event){ return confirm('Roll back this go-live? What it loaded is removed from the school\'s live account.')
},
"admin-migrations.5": function(event){ return confirm('Empty this sandbox? Every upload and answer in it is removed.')
},
"admin-migrations.6": function(event){ return confirm('Reset this authenticator?')
},
"admin-orgChart.1": function(event){ ocOpenEdit(__mgAct.T_(this.getAttribute('data-mga0')))
},
"admin-orgChart.2": function(event){ event.stopPropagation(); this.closest('.oc-node-wrap').classList.toggle('bio-open');
},
"admin-orgChart.3": function(event){ event.stopPropagation(); this.closest('li').classList.toggle('collapsed');
},
"admin-orgChart.4": function(event){ if(event.target===this) ocCloseEdit()
},
"admin-orgChart.5": function(event){ ocCloseEdit()
},
"admin-organizations.1": function(event){ this.remove()
},
"admin-partials-hubHeader.1": function(event){ return confirm('Turn the data migration sandbox on for every school in ' + this.getAttribute('data-mga0') + '? Each school moves its own data: their managers find Sandbox in their menu and turn it on when they are ready.')
},
"admin-partials-sandboxMenu.1": function(event){ return confirm('Turn the sandbox on for ' + this.getAttribute('data-mga0') + '? Its managers find Sandbox in their menu and turn it on when they are ready. While it is on, its live account takes no new data.')
},
"admin-profile.1": function(event){ if (window.combinePhoneCountryCombos) window.combinePhoneCountryCombos(this);
},
"admin-sandboxMenu.off": function(event){ return confirm(this.getAttribute('data-mga0'))
},
"admin-superDashboard.1": function(event){ return confirmBulkSubmit(this, 'application')
},
"admin-superDashboard.10": function(event){ toggleDetails('ticket-' + this.getAttribute('data-mga0') + '')
},
"admin-superDashboard.11": function(event){ return confirmAction('restore this ticket?')
},
"admin-superDashboard.12": function(event){ return confirmAction('permanently delete this ticket? This cannot be undone.')
},
"admin-superDashboard.13": function(event){ toggleDetails('contact-' + this.getAttribute('data-mga0') + '')
},
"admin-superDashboard.14": function(event){ return confirmAction('restore this referral?')
},
"admin-superDashboard.15": function(event){ return confirmAction('permanently delete this referral? This cannot be undone.')
},
"admin-superDashboard.2": function(event){ toggleDetails('org-' + this.getAttribute('data-mga0') + '')
},
"admin-superDashboard.3": function(event){ return confirmAction('restore this organization?')
},
"admin-superDashboard.4": function(event){ return confirmAction('permanently delete this organization? This cannot be undone.')
},
"admin-superDashboard.5": function(event){ return confirmBulkSubmit(this, 'hub')
},
"admin-superDashboard.6": function(event){ toggleDetails('hub-' + this.getAttribute('data-mga0') + '')
},
"admin-superDashboard.7": function(event){ return confirmAction('restore this hub?')
},
"admin-superDashboard.8": function(event){ return confirmAction('permanently delete this hub? This cannot be undone.')
},
"admin-superDashboard.9": function(event){ return confirmBulkSubmit(this, 'ticket')
},
"admissionPending.approve": function(event){ return confirmApprove(event, Number(this.getAttribute('data-mga0')))
},
"admissionPending.delImg": function(event){ deleteStudentImage(Number(this.getAttribute('data-mga0')))
},
"admissionPending.reject": function(event){ rejectStudent(Number(this.getAttribute('data-mga0')))
},
"admissionPending.save": function(event){ saveChanges(Number(this.getAttribute('data-mga0')))
},
"cd.ccHoverFocus": function(event){ loadClassReportCcHover(Number(this.getAttribute('data-mga0')))
},
"cd.ccHoverIn": function(event){ loadClassReportCcHover(Number(this.getAttribute('data-mga0')))
},
"cd.deleteReply": function(event){ return deleteClassReply(Number(this.getAttribute('data-mga0')), Number(this.getAttribute('data-mga1')))
},
"cd.removeColumn": function(event){ removeScheduleColumn(Number(this.getAttribute('data-mga0')))
},
"cd.removeDay": function(event){ removeScheduleDay(Number(this.getAttribute('data-mga0')))
},
"cd.replyInput": function(event){ autoResizeStaffReplyInput(this)
},
"cd.replyKeydown": function(event){ handleStaffReplyKeydown(event, Number(this.getAttribute('data-mga0')))
},
"cd.restoreDay": function(event){ restoreScheduleDay(Number(this.getAttribute('data-mga0')))
},
"cd.scheduleAction": function(event){ var fn = window[this.getAttribute('data-mga0')]; if (typeof fn === 'function') fn();
},
"cd.submitReply": function(event){ submitStaffReply(Number(this.getAttribute('data-mga0')))
},
"cd.toggleMsgMenu": function(event){ toggleReportMsgMenu(Number(this.getAttribute('data-mga0')))
},
"common-addStudent.1": function(event){ openBulkImportModal()
},
"common-addStudent.10": function(event){ this.src='/images/profilePlaceholder.png'
},
"common-addStudent.11": function(event){ removeGuardian(this)
},
"common-addStudent.12": function(event){ closeBulkImportModal()
},
"common-addStudent.13": function(event){ document.getElementById('bulkFileInput').click()
},
"common-addStudent.14": function(event){ handleFileDrop(event)
},
"common-addStudent.15": function(event){ handleDragOver(event)
},
"common-addStudent.16": function(event){ handleDragLeave(event)
},
"common-addStudent.17": function(event){ handleFileSelect(event)
},
"common-addStudent.18": function(event){ downloadWordTemplate()
},
"common-addStudent.2": function(event){ clearImportedDraft()
},
"common-addStudent.3": function(event){ confirmAddStudent(event)
},
"common-addStudent.4": function(event){ toggleFormMenu(event, this)
},
"common-addStudent.5": function(event){ removeStudentForm(this)
},
"common-addStudent.6": function(event){ toggleSubjectsCollapsible(this.getAttribute('data-mga0'))
},
"common-addStudent.7": function(event){ setGuardianMode(this, 'existing')
},
"common-addStudent.8": function(event){ setGuardianMode(this, 'new')
},
"common-addStudent.9": function(event){ addGuardian(this)
},
"common-admissionPending.1": function(event){ loadStudentDetails(__mgAct.T_(this.getAttribute('data-mga0')))
},
"common-admissionPending.2": function(event){ closeStudentForm()
},
"common-admissionPending.3": function(event){ updateTermOptions(this)
},
"common-admissionPending.4": function(event){ addGuardian()
},
"common-announcementComposer.1": function(event){ window.parent && window.parent.postMessage({managiraDrawerSaved:false}, window.location.origin)
},
"common-attendanceCollection.1": function(event){ toggleFilters()
},
"common-attendanceCollection.2": function(event){ resetFilters()
},
"common-attendanceCollection.3": function(event){ toggleEditSaveMode('' + this.getAttribute('data-mga0') + '')
},
"common-attendanceCollection.4": function(event){ cancelEditMode('' + this.getAttribute('data-mga0') + '')
},
"common-attendanceCollection.5": function(event){ markAllPresentForDate('' + this.getAttribute('data-mga0') + '', this.checked)
},
"common-attendanceCollection.6": function(event){ window.lunchAllForDate && window.lunchAllForDate('' + this.getAttribute('data-mga0') + '')
},
"common-attendanceCollection.7": function(event){ toggleAttendanceSummary()
},
"common-classDashboard.1": function(event){ openWorkspaceTabByKey('overview')
},
"common-classDashboard.10": function(event){ openWorkspaceTabByKey('paygira')
},
"common-classDashboard.11": function(event){ openWorkspaceTabByKey('attendance')
},
"common-classDashboard.12": function(event){ openWorkspaceTabByKey('assessment-questions')
},
"common-classDashboard.13": function(event){ window.AssessmentFlow && window.AssessmentFlow.toast('Ask your admin for access to Assessment Questions.')
},
"common-classDashboard.14": function(event){ toggleSubjectsNavSection(event)
},
"common-classDashboard.15": function(event){ openToReviewDrawer()
},
"common-classDashboard.16": function(event){ openSubjectWorkspaceTab(__mgAct.T_(this.getAttribute('data-mga0')))
},
"common-classDashboard.17": function(event){ openWorkspaceTabByKey('docs')
},
"common-classDashboard.18": function(event){ openWorkspaceTabByKey('settings')
},
"common-classDashboard.19": function(event){ toggleWorkspaceMeta(this)
},
"common-classDashboard.2": function(event){ toggleReportsPanel(event)
},
"common-classDashboard.20": function(event){ toggleTeachersDropdown(this)
},
"common-classDashboard.21": function(event){ openStudentWorkspaceTab(__mgAct.T_(this.getAttribute('data-mga0')))
},
"common-classDashboard.22": function(event){ openStudentTransportModal(__mgAct.T_(this.getAttribute('data-mga0')), '' + this.getAttribute('data-mga1') + '', event)
},
"common-classDashboard.23": function(event){ openStudentTeacherRemarkModal(this, event)
},
"common-classDashboard.24": function(event){ event.stopPropagation(); openToReviewDrawer();
},
"common-classDashboard.25": function(event){ if (event.key === 'Enter') { event.stopPropagation(); openToReviewDrawer(); }
},
"common-classDashboard.26": function(event){ loadClassReports()
},
"common-classDashboard.27": function(event){ toggleScheduleMobile(this)
},
"common-classDashboard.28": function(event){ if ((event.key === 'Enter' || event.key === ' ') && event.target === this) { event.preventDefault(); this.click(); }
},
"common-classDashboard.29": function(event){ if (!event.target.closest('.tp-coming')) openStudentTransportModal(__mgAct.T_(this.getAttribute('data-mga0')), '' + this.getAttribute('data-mga1') + '', event)
},
"common-classDashboard.3": function(event){ openWorkspaceTabByKey('briefing')
},
"common-classDashboard.30": function(event){ closeReportModal()
},
"common-classDashboard.31": function(event){ handleStudentTeacherRemarkOverlayClick(event)
},
"common-classDashboard.32": function(event){ closeStudentTeacherRemarkModal()
},
"common-classDashboard.33": function(event){ saveStudentTeacherRemark()
},
"common-classDashboard.34": function(event){ handleStudentTransportModalOverlayClick(event)
},
"common-classDashboard.35": function(event){ closeStudentTransportModal()
},
"common-classDashboard.4": function(event){ toggleClassScheduleModal(event)
},
"common-classDashboard.5": function(event){ openWorkspaceTabByKey('pickup')
},
"common-classDashboard.6": function(event){ openWorkspaceTabByKey('transportation')
},
"common-classDashboard.7": function(event){ openWorkspaceTabByKey('activities')
},
"common-classDashboard.8": function(event){ openWorkspaceTabByKey('forms')
},
"common-classDashboard.9": function(event){ openWorkspaceFormTab(__mgAct.T_(this.getAttribute('data-mga0')))
},
"common-classDashboard.activateTab": function(event){ activateWorkspaceTab(this.getAttribute('data-tab-id'))
},
"common-classDashboard.closeTab": function(event){ closeWorkspaceTab(this.getAttribute('data-tab-id'))
},
"common-classDashboard.reportDetail": function(event){ openReportDetail(Number(this.getAttribute('data-mga0')))
},
"common-createEmployee.1": function(event){ toggleSubjects('' + this.getAttribute('data-mga0') + '', 'subjects-container-' + this.getAttribute('data-mga1') + '')
},
"common-createEmployee.selectAll": function(event){ var box = this; document.querySelectorAll('#' + this.getAttribute('data-mga0') + ' input[type=checkbox]').forEach(function (cb) { cb.checked = box.checked; });
},
"common-createEventAnnouncement.1": function(event){ switchType('event')
},
"common-createEventAnnouncement.2": function(event){ switchType('announcement')
},
"common-createTest.1": function(event){ toggleTestMenu(event, this)
},
"common-createTest.2": function(event){ removeTestForm(this)
},
"common-createTest.3": function(event){ toggleClassListCollapse('class-list-1', 'arrow-class-list-1')
},
"common-createTest.4": function(event){ toggleSelectAllClassesAndSubjects(1)
},
"common-createTest.5": function(event){ toggleSubjects('subjects-container-' + this.getAttribute('data-mga0') + '-1', this)
},
"common-createTest.6": function(event){ addTestForm()
},
"common-createTest.classList": function(event){ toggleClassListCollapse('class-list-' + this.getAttribute('data-mga0'), 'arrow-class-list-' + this.getAttribute('data-mga0'))
},
"common-createTest.selectAll": function(event){ toggleSelectAllClassesAndSubjects(Number(this.getAttribute('data-mga0')))
},
"common-createTest.subjects": function(event){ toggleSubjects('subjects-container-' + this.getAttribute('data-mga0') + '-' + this.getAttribute('data-mga1'), this)
},
"common-documents.1": function(event){ openCreateModal()
},
"common-documents.2": function(event){ selectType('document')
},
"common-documents.3": function(event){ selectType('spreadsheet')
},
"common-documents.4": function(event){ closeCreateModal()
},
"common-documents.5": function(event){ createDocument()
},
"common-documents.open": function(event){ if(event.target.closest('.doc-card-actions'))return; window.open('/documents/edit/' + this.getAttribute('data-mga0') + '?returnUrl='+encodeURIComponent(window.location.href),'_blank','noopener');
},
"common-editStudent.1": function(event){ confirmUpdate(event)
},
"common-editStudent.2": function(event){ addGuardian()
},
"common-editStudent.3": function(event){ toggleActionMenu()
},
"common-editStudent.4": function(event){ submitDeleteStudent()
},
"common-editStudent.5": function(event){ return confirmDelete('Are you sure you want to delete this image?')
},
"common-failedEmails.1": function(event){ this.src='/images/profilePlaceholder.png'
},
"common-failedEmails.2": function(event){ liveCheck(__mgAct.T_(this.getAttribute('data-mga0')), this)
},
"common-failedEmails.3": function(event){ testEmail(__mgAct.T_(this.getAttribute('data-mga0')))
},
"common-guardianDetails.1": function(event){ toggleEditForm()
},
"common-guardianDetails.2": function(event){ requestPasswordSetup()
},
"common-guardianDetails.3": function(event){ toggleDotsMenu(this)
},
"common-guardianDetails.4": function(event){ openReportModal('' + this.getAttribute('data-mga0') + '', '' + this.getAttribute('data-mga1') + '')
},
"common-guardianDetails.5": function(event){ openGuardianStudentActionModal('' + this.getAttribute('data-mga0') + '', '' + this.getAttribute('data-mga1') + '')
},
"common-guardianDetails.6": function(event){ closeReportModal()
},
"common-guardianDetails.7": function(event){ submitReport()
},
"common-guardianDetails.8": function(event){ closeGuardianActionModal()
},
"common-manageAssessment.1": function(event){ openCreateTestModal()
},
"common-manageClassSubjectAndGradYr.1": function(event){ openAddClassSubjectModal()
},
"common-manageClassSubjectAndGradYr.10": function(event){ confirmDelete('/common/deleteGraduationYearGroup?id=' + this.getAttribute('data-mga0') + '')
},
"common-manageClassSubjectAndGradYr.2": function(event){ toggleAllClassesCollapse()
},
"common-manageClassSubjectAndGradYr.3": function(event){ toggleMenu(event, this)
},
"common-manageClassSubjectAndGradYr.4": function(event){ obsoleteItem('class', { id: '' + this.getAttribute('data-mga0') + '' }, this)
},
"common-manageClassSubjectAndGradYr.5": function(event){ confirmDelete('/common/deleteClass?classId=' + this.getAttribute('data-mga0') + '')
},
"common-manageClassSubjectAndGradYr.6": function(event){ toggleSubjectGroup(this)
},
"common-manageClassSubjectAndGradYr.7": function(event){ obsoleteItem('subject', { subjectKey: this.dataset.key }, this)
},
"common-manageClassSubjectAndGradYr.8": function(event){ confirmDelete('/common/deleteSubject?subjectKey=' + this.getAttribute('data-mga0') + '')
},
"common-manageClassSubjectAndGradYr.9": function(event){ obsoleteItem('gradGroup', { id: '' + this.getAttribute('data-mga0') + '' }, this)
},
"common-manageEmployees.1": function(event){ openAddEmployeeModal()
},
"common-manageEventsAnnouncements.1": function(event){ toggleCreateCard('create-event-card')
},
"common-manageEventsAnnouncements.2": function(event){ toggleCard('ev-card-' + this.getAttribute('data-mga0') + '')
},
"common-manageEventsAnnouncements.3": function(event){ return confirm('Permanently delete this event?');
},
"common-manageEventsAnnouncements.4": function(event){ toggleCreateCard('create-ann-card')
},
"common-manageEventsAnnouncements.5": function(event){ toggleCard('ann-card-' + this.getAttribute('data-mga0') + '')
},
"common-manageEventsAnnouncements.6": function(event){ return confirm('Permanently delete this announcement?');
},
"common-manageRecords.1": function(event){ openRegisterSchoolYearModal()
},
"common-manageRecords.10": function(event){ addTermToSchoolYear(event, '' + this.getAttribute('data-mga0') + '')
},
"common-manageRecords.11": function(event){ return submitRegisterSchoolYearModal(event, this)
},
"common-manageRecords.12": function(event){ addRsyTerm(); return false;
},
"common-manageRecords.2": function(event){ return validateAndConfirmChanges(this)
},
"common-manageRecords.3": function(event){ toggleTerms('' + this.getAttribute('data-mga0') + '')
},
"common-manageRecords.4": function(event){ event.stopPropagation()
},
"common-manageRecords.5": function(event){ toggleYearMenu(event, this)
},
"common-manageRecords.6": function(event){ enableSchoolYearEdit(this)
},
"common-manageRecords.7": function(event){ deleteSchoolYear('' + this.getAttribute('data-mga0') + '', this)
},
"common-manageRecords.8": function(event){ toggleTermMenu(event, this)
},
"common-manageRecords.9": function(event){ deleteTerm('' + this.getAttribute('data-mga0') + '', this)
},
"common-modifyAssessment.1": function(event){ toggleClassesCollapse()
},
"common-modifyAssessment.2": function(event){ selectAllClassesAndSubjects()
},
"common-modifyAssessment.3": function(event){ toggleSubjects('' + this.getAttribute('data-mga0') + '')
},
"common-modifyAssessment.4": function(event){ selectAllSubjects('' + this.getAttribute('data-mga0') + '')
},
"common-modifyAssessment.5": function(event){ deleteAssessment()
},
"common-modifyEmployee.1": function(event){ toggleClassCollapse('subjects-' + this.getAttribute('data-mga0') + '')
},
"common-modifyEmployee.2": function(event){ return confirm('Remove this user from the school?\n\nThey won\'t be able to sign in and leave the staff lists. Everything they did (attendance, scores, payments, documents) is kept.\n\nTo bring them back: Users > Status: Removed > select them > Enable.');
},
"common-publicRegisterStudent.1": function(event){ startRegistration()
},
"common-publicRegisterStudent.10": function(event){ submitFreeApplication()
},
"common-publicRegisterStudent.11": function(event){ continueToPayment()
},
"common-publicRegisterStudent.12": function(event){ backToRegistration()
},
"common-publicRegisterStudent.13": function(event){ prSyncPayoutCards()
},
"common-publicRegisterStudent.14": function(event){ payNow()
},
"common-publicRegisterStudent.15": function(event){ window.location.reload()
},
"common-publicRegisterStudent.16": function(event){ this.closest('.acc-card').remove()
},
"common-publicRegisterStudent.2": function(event){ guardianExists(true)
},
"common-publicRegisterStudent.3": function(event){ guardianExists(false)
},
"common-publicRegisterStudent.4": function(event){ clearGuardianSelection()
},
"common-publicRegisterStudent.5": function(event){ toggleAcc('accStudent')
},
"common-publicRegisterStudent.6": function(event){ toggleAcc('accGuardian')
},
"common-publicRegisterStudent.7": function(event){ previewGuardianImage(this, 0)
},
"common-publicRegisterStudent.8": function(event){ addGuardian()
},
"common-publicRegisterStudent.9": function(event){ backToWelcome()
},
"common-publicRegisterStudent.acc": function(event){ toggleAcc('accGuardian' + this.getAttribute('data-mga0'))
},
"common-publicRegisterStudent.preview": function(event){ previewGuardianImage(this, Number(this.getAttribute('data-mga0')))
},
"common-registerSchoolYear.1": function(event){ return validateRegisterSchoolYearForm(this)
},
"common-registerSchoolYear.2": function(event){ addTerm(); return false;
},
"common-registerSchoolYear.3": function(event){ toggleTermDeleteMenu(event, this)
},
"common-registerSchoolYear.4": function(event){ removeField(this)
},
"common-setPassword.1": function(event){ return validatePasswords();
},
"common-setPassword.2": function(event){ checkPasswordStrength(this.value)
},
"common-setPassword.3": function(event){ toggleMultiplePasswords(['password', 'confirmPassword'], this)
},
"common-studentDocumentForm.1": function(event){ return confirm('Remove this file? It is deleted for everyone.');
},
"driver-settings.1": function(event){ if (window.combinePhoneCountryCombos) window.combinePhoneCountryCombos(this);
},
"enrollment-form.1": function(event){ this.remove()
},
"fin.recipient.email": function(event){ updateArrearsRecipientField(this.getAttribute('data-mga0'), 'email', this.value)
},
"fin.recipient.guardian_name": function(event){ updateArrearsRecipientField(this.getAttribute('data-mga0'), 'guardian_name', this.value)
},
"fin.recipient.phone": function(event){ updateArrearsRecipientField(this.getAttribute('data-mga0'), 'phone', this.value)
},
"fin.recipient.relationship": function(event){ updateArrearsRecipientField(this.getAttribute('data-mga0'), 'relationship', this.value)
},
"fin.recipientEditor": function(event){ toggleArrearsRecipientEditor(this.getAttribute('data-mga0'))
},
"finance-invoice.1": function(event){ window.print()
},
"finance-invoice.2": function(event){ window.close()
},
"finance-receipt.1": function(event){ window.print()
},
"finance-receipt.2": function(event){ window.close()
},
"guardian-dashboard.1": function(event){ withdrawApplication(__mgAct.T_(this.getAttribute('data-mga0')), this)
},
"guardian-editPendingStudent.1": function(event){ previewImage(this)
},
"guardian-editPendingStudent.2": function(event){ window.location.href='/guardian/dashboard'
},
"guardian-paygira.1": function(event){ openPgPay('' + this.getAttribute('data-mga0') + '')
},
"guardian-paygira.2": function(event){ event.stopPropagation()
},
"guardian-paygira.3": function(event){ closePgPay()
},
"guardian-paygira.4": function(event){ clearSavedCardSelection()
},
"guardian-reportDetails.1": function(event){ loadGuardianCcHover()
},
"guardian-reportDetails.10": function(event){ handleStaffReplyKeydown(event, __mgAct.T_(this.getAttribute('data-mga0')))
},
"guardian-reportDetails.11": function(event){ submitStaffReply(__mgAct.T_(this.getAttribute('data-mga0')))
},
"guardian-reportDetails.2": function(event){ loadGuardianCcHover()
},
"guardian-reportDetails.3": function(event){ toggleMsgMenu('report-root')
},
"guardian-reportDetails.4": function(event){ return confirm('Delete this conversation and all its replies? This cannot be undone.')
},
"guardian-reportDetails.5": function(event){ return submitInlineForm('deleteReportForm')
},
"guardian-reportDetails.6": function(event){ toggleMsgMenu('' + this.getAttribute('data-mga0') + '')
},
"guardian-reportDetails.7": function(event){ return confirm('Delete this message?')
},
"guardian-reportDetails.8": function(event){ return submitInlineForm('deleteReplyForm-' + this.getAttribute('data-mga0') + '')
},
"guardian-reportDetails.9": function(event){ autoResizeStaffReplyInput(this)
},
"guardian-reports.1": function(event){ openModal()
},
"guardian-reports.2": function(event){ toggleReportMenu('' + this.getAttribute('data-mga0') + '')
},
"guardian-reports.3": function(event){ return confirm('Delete this report and all replies? This cannot be undone.')
},
"guardian-reports.4": function(event){ closeModal()
},
"guardian-settings.1": function(event){ if (window.combinePhoneCountryCombos) window.combinePhoneCountryCombos(this);
},
"guardian-settings.2": function(event){ updateStudentPreview()
},
"guardian-settings.3": function(event){ return confirm('Remove this card?');
},
"guardian-studentAcademicDetails.1": function(event){ this.form.submit()
},
"hdr.avatar": function(event){ var span = document.createElement('span'); span.className = 'sr-avatar'; span.textContent = this.getAttribute('data-mga0'); this.replaceWith(span);
},
"hub-login.1": function(event){ togglePasswordVisibility('password', this)
},
"hub-login.2": function(event){ event.preventDefault()
},
"hub-settings.1": function(event){ this.remove()
},
"legal-Compliance-MiraAiAssistant.1": function(event){ if(this.__mgOnce)return;this.__mgOnce=1;this.src='/images/image.png';
},
"legal-Compliance-directory.1": function(event){ this.src='/images/profilePlaceholder.png'
},
"legal-Compliance-directory.2": function(event){ showSimilarOrgs()
},
"legal-Compliance-userDocumentation.1": function(event){ event.preventDefault();event.stopPropagation();
},
"migration-archive.1": function(event){ window.print()
},
"migration-request.1": function(event){ return confirm('Withdraw your data migration request?');
},
"migration-school.1": function(event){ window.print()
},
"migration-school.2": function(event){ return confirm('Apply your approved areas to your live account again?')
},
"migration-school.3": function(event){ return confirm('Go live now? Your data moves into your live account. It runs in the background and takes a few minutes for a large school.')
},
"migration-verify.1": function(event){ window.print()
},
"misc.hide": function(event){ this.style.display='none'
},
"misc.print": function(event){ window.print()
},
"misc.remove": function(event){ this.remove()
},
"misc.select": function(event){ this.select();
},
"partials-footer.1": function(event){ this.parentNode.remove()
},
"partials-header.1": function(event){ if(this.__mgOnce)return;this.__mgOnce=1;this.src='/images/image.png';
},
"print-emailHistory.batch": function(event){ openBatchDetailsModal(decodeURIComponent(this.getAttribute('data-mga0')))
},
"print-emailHistory.resend": function(event){ resendGuardianMessage(this.getAttribute('data-mga0'))
},
"print-emailHistory.retry": function(event){ retryEmail(Number(this.getAttribute('data-mga0')))
},
"print-meritSheetPage.1": function(event){ return validateMeritSheetForm()
},
"print-printStudentReport.1": function(event){ toggleActionsMenu()
},
"print-printStudentReport.10": function(event){ selectRemark('' + this.getAttribute('data-mga0') + '', __mgAct.T_(this.getAttribute('data-mga1')), '' + this.getAttribute('data-mga2') + '')
},
"print-printStudentReport.11": function(event){ this.parentElement.remove()
},
"print-printStudentReport.12": function(event){ this.parentElement.remove(); saveEmailsToStorage();
},
"print-printStudentReport.13": function(event){ closeSendReportDrawer()
},
"print-printStudentReport.14": function(event){ closeEmailModal()
},
"print-printStudentReport.15": function(event){ sendReportEmails()
},
"print-printStudentReport.16": function(event){ closeWhatsappModal()
},
"print-printStudentReport.17": function(event){ sendReportWhatsApp()
},
"print-printStudentReport.2": function(event){ toggleSelectAll()
},
"print-printStudentReport.3": function(event){ printSelected(); return false;
},
"print-printStudentReport.4": function(event){ downloadSelectedReports(); return false;
},
"print-printStudentReport.5": function(event){ openSendReportModal(); return false;
},
"print-printStudentReport.6": function(event){ updateSelectedCount()
},
"print-printStudentReport.7": function(event){ updateClass('' + this.getAttribute('data-mga0') + '')
},
"print-printStudentReport.8": function(event){ toggleDropdown('' + this.getAttribute('data-mga0') + '', __mgAct.T_(this.getAttribute('data-mga1')))
},
"print-printStudentReport.9": function(event){ this.select();
},
"print-printStudentReport.addContact": function(event){ addSendReportContactField(Number(this.getAttribute('data-mga0')), this.getAttribute('data-mga1'))
},
"print-printStudentReport.addEmail": function(event){ addEmailField(__mgAct.T_(this.getAttribute('data-mga0')))
},
"print-printStudentReport.addWhatsapp": function(event){ addWhatsappField(__mgAct.T_(this.getAttribute('data-mga0')))
},
"print-reportSettings.1": function(event){ toggleAdvancedDsPanel()
},
"print-reportSettings.10": function(event){ event.stopPropagation()
},
"print-reportSettings.11": function(event){ dsAdvToggleSub(this.closest('.ds-adv-group'))
},
"print-reportSettings.2": function(event){ deleteSignatureForClass(__mgAct.T_(this.getAttribute('data-mga0')), '' + this.getAttribute('data-mga1') + '', '' + this.getAttribute('data-mga2') + '')
},
"print-reportSettings.3": function(event){ deleteEntireSignature('' + this.getAttribute('data-mga0') + '', '' + this.getAttribute('data-mga1') + '')
},
"print-reportSettings.4": function(event){ clearCanvas()
},
"print-reportSettings.5": function(event){ saveDigitalSignature()
},
"print-reportSettings.6": function(event){ deleteTranscriptSignatureForClass(__mgAct.T_(this.getAttribute('data-mga0')), '' + this.getAttribute('data-mga1') + '')
},
"print-reportSettings.7": function(event){ deleteEntireTranscriptSignature('' + this.getAttribute('data-mga0') + '')
},
"print-reportSettings.8": function(event){ clearTranscriptCanvas()
},
"print-reportSettings.9": function(event){ saveTranscriptSignature()
},
"print-transcript.1": function(event){ if (window.history.length > 1) { window.history.back(); } else { window.location.href = '' + this.getAttribute('data-mga0') + ''; }
},
"print-transcript.2": function(event){ openEmailModal()
},
"print-transcript.3": function(event){ trackTranscriptPrintAndPrint()
},
"print-transcript.4": function(event){ closeEmailStepModal()
},
"print-transcript.5": function(event){ proceedToPasswordStep()
},
"print-transcript.6": function(event){ backToEmailStep()
},
"print-transcript.7": function(event){ sendTranscriptEmail()
},
"print-transcriptClassic.1": function(event){ openEmailModal()
},
"print-transcriptClassic.2": function(event){ trackTranscriptPrintAndPrint()
},
"print-transcriptClassic.3": function(event){ closeEmailStepModal()
},
"print-transcriptClassic.4": function(event){ proceedToPasswordStep()
},
"print-transcriptClassic.5": function(event){ backToEmailStep()
},
"print-transcriptClassic.6": function(event){ sendTranscriptEmail()
},
"print.selectRemark": function(event){ selectRemark(this.getAttribute('data-mga0'), Number(this.getAttribute('data-mga1')), this.textContent.trim())
},
"print.toggleDropdown": function(event){ toggleDropdown(this.getAttribute('data-mga0'), Number(this.getAttribute('data-mga1')))
},
"promotion-applyPromotion.1": function(event){ showForm()
},
"promotion-applyPromotion.2": function(event){ togglePromotionClassCollapsible()
},
"promotion-applyPromotion.3": function(event){ return confirm('Apply this promotion now? Students will be moved to their new classes immediately.');
},
"promotion-applyPromotion.4": function(event){ return confirm('Reverse this promotion? This will undo the enrollments, classes, and subjects it created.');
},
"promotion-applyPromotion.5": function(event){ toggleMoreSchedules()
},
"rsy.removeField": function(event){ removeRsyField(this)
},
"rsy.termMenu": function(event){ toggleRsyTermDeleteMenu(event, this)
},
"static.demo": function(event){ window.open('https://www.youtube.com/watch?v=y1J0KahfA-c')
},
"static.pricing": function(event){ location.href='/account/service-plan'
},
"stats-organizationStats.1": function(event){ window.print()
},
"student-takeAssessment.1": function(event){ return window.taConfirmSubmit ? window.taConfirmSubmit() : true;
}
};
for(var id in H)R.H[id]=H[id];
R.C=R.C||{};
var C={
"account-finance.15": function(){ return 'Email every parent who still owes this bill, with what they owe and a link to pay?'; },
"account-finance.17": function(){ return 'Delete this bill for every student it was sent to?'; },
"account-finance.18": function(){ return 'Remove this payment? The student\'s balance goes back up, and the change is kept in the activity log.'; },
"account-finance.20": function(){ return 'Reopen this sign-off for correction? Audit logs will be saved, the history lock will be removed, and the collection will return to class PayGira so it can be signed off again after corrections.'; },
"account-finance.22": function(){ return 'Delete template?'; },
"account-finance.33": function(){ return 'Delete this saved report?'; },
"account-settings.5": function(){ return 'Remove your profile photo?'; },
"account-settings.7": function(){ return 'Change who covers the service fee? This applies to every online payment from now on.'; },
"admin-createPromo.1": function(){ return 'Delete this promo code?'; },
"admin-editAdminUser.1": function(){ return 'Send a new password setup email to this admin? The previous link will be invalidated.'; },
"admin-emailSuppressions.remove": function(){ return 'Remove suppression for ' + this.getAttribute('data-mga0') + '?'; },
"admin-manageDonations.1": function(){ return 'Delete this donation campaign and its image?'; },
"admin-manageEmployment.1": function(){ return 'Send approval email for this applicant?'; },
"admin-manageEmployment.10": function(){ return 'Delete this job posting?'; },
"admin-manageEmployment.2": function(){ return 'Send rejection email for this applicant?'; },
"admin-manageEmployment.3": function(){ return 'Send second interview invitation?'; },
"admin-manageEmployment.4": function(){ return 'Send rejection email after first interview?'; },
"admin-manageEmployment.5": function(){ return 'Send final interview invitation?'; },
"admin-manageEmployment.6": function(){ return 'Send rejection email after second interview?'; },
"admin-manageEmployment.7": function(){ return 'Send rejection email after final interview?'; },
"admin-manageEmployment.8": function(){ return 'Reverse rejection and notify applicant to disregard previous rejection email?'; },
"admin-manageEmployment.9": function(){ return 'Delete this application permanently?'; },
"admin-migrations.1": function(){ return 'Open ' + this.getAttribute('data-mga0') + '\'s migration? Their managers are emailed and find Sandbox in their menu; while they have it on, their live account takes no new data.'; },
"admin-migrations.2": function(){ return 'Cancel this migration? Its sandbox and files are deleted.'; },
"admin-migrations.3": function(){ return '' + this.getAttribute('data-mga0') + ''; },
"admin-migrations.4": function(){ return 'Roll back this go-live? What it loaded is removed from the school\'s live account.'; },
"admin-migrations.5": function(){ return 'Empty this sandbox? Every upload and answer in it is removed.'; },
"admin-migrations.6": function(){ return 'Reset this authenticator?'; },
"admin-partials-hubHeader.1": function(){ return 'Turn the data migration sandbox on for every school in ' + this.getAttribute('data-mga0') + '? Each school moves its own data: their managers find Sandbox in their menu and turn it on when they are ready.'; },
"admin-partials-sandboxMenu.1": function(){ return 'Turn the sandbox on for ' + this.getAttribute('data-mga0') + '? Its managers find Sandbox in their menu and turn it on when they are ready. While it is on, its live account takes no new data.'; },
"admin-sandboxMenu.off": function(){ return this.getAttribute('data-mga0'); },
"common-manageEventsAnnouncements.3": function(){ return 'Permanently delete this event?'; },
"common-manageEventsAnnouncements.6": function(){ return 'Permanently delete this announcement?'; },
"common-modifyEmployee.2": function(){ return 'Remove this user from the school?\n\nThey won\'t be able to sign in and leave the staff lists. Everything they did (attendance, scores, payments, documents) is kept.\n\nTo bring them back: Users > Status: Removed > select them > Enable.'; },
"common-studentDocumentForm.1": function(){ return 'Remove this file? It is deleted for everyone.'; },
"guardian-reportDetails.4": function(){ return 'Delete this conversation and all its replies? This cannot be undone.'; },
"guardian-reportDetails.7": function(){ return 'Delete this message?'; },
"guardian-reports.3": function(){ return 'Delete this report and all replies? This cannot be undone.'; },
"guardian-settings.3": function(){ return 'Remove this card?'; },
"migration-request.1": function(){ return 'Withdraw your data migration request?'; },
"migration-school.2": function(){ return 'Apply your approved areas to your live account again?'; },
"migration-school.3": function(){ return 'Go live now? Your data moves into your live account. It runs in the background and takes a few minutes for a large school.'; },
"promotion-applyPromotion.3": function(){ return 'Apply this promotion now? Students will be moved to their new classes immediately.'; },
"promotion-applyPromotion.4": function(){ return 'Reverse this promotion? This will undo the enrollments, classes, and subjects it created.'; }
};
for(var cid in C)R.C[cid]=C[cid];
R.T['change']=1;R.T['click']=1;R.T['dragleave']=1;R.T['dragover']=1;R.T['drop']=1;R.T['error']=1;R.T['focus']=1;R.T['input']=1;R.T['keydown']=1;R.T['mousedown']=1;R.T['mouseenter']=1;R.T['submit']=1;
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',R.start);else R.start();
})();
