// "Resources & recommendations" in the question set form (feature learning_resources). Replaces
// the older parent-only box (public/js/parentResources.js keeps the same window.ParentResources
// shape, so the form calls load() and afterSave() as before). Files and links are kept whether
// or not parents see them; two ticks say who does: students with the test, and the parent portal.
(function () {
  'use strict';
  if (window.ParentResources) return;

  var state = { setId: null, files: [], pendingFiles: [], pendingLinks: [] };
  var box = null;
  var FILE = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M14 3H6a1 1 0 0 0-1 1v16a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1V8z"/><path d="M14 3v5h5"/></svg>';
  var LINK = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M10 14a4 4 0 0 0 6 0l3-3a4 4 0 0 0-6-6l-1 1M14 10a4 4 0 0 0-6 0l-3 3a4 4 0 0 0 6 6l1-1"/></svg>';

  function esc(value) {
    return String(value === null || value === undefined ? '' : value).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function json(res) { return res.json().catch(function () { return {}; }).then(function (j) { if (!res.ok || j.success === false) throw new Error(j.message || 'Something went wrong. Try again.'); return j; }); }
  function ensureBox() {
    if (box && document.body.contains(box)) return box;
    var anchor = document.getElementById('question-set-description');
    if (!anchor) return null;
    box = document.createElement('section');
    box.className = 'pr-box pr-box--v2';
    box.setAttribute('aria-label', 'Resources and recommendations');
    box.innerHTML = '<div class="pr-head"><strong>Resources &amp; recommendations</strong><span>Optional. Notes, files and links that help with this test or assignment.</span></div>'
      + '<label class="pr-field"><span>Recommendations</span><textarea id="pr-notes" rows="3" maxlength="4000" placeholder="What to revise, how to prepare, or tips for helping at home"></textarea></label>'
      + '<div class="pr-field"><span>Files and links</span><ul class="pr-list" id="pr-list"></ul>'
      + '<div class="pr-actions"><label class="pr-btn">' + FILE + 'Upload files<input type="file" id="pr-files" multiple hidden /></label>'
      + '<button type="button" class="pr-btn" id="pr-link-open">' + LINK + 'Add a link</button></div>'
      + '<div class="pr-linkrow" id="pr-linkrow" hidden><input type="url" id="pr-link-url" placeholder="https://" aria-label="Link address" /><input type="text" id="pr-link-label" maxlength="200" placeholder="Name (optional)" aria-label="Link name" /><button type="button" class="pr-btn pr-btn--primary" id="pr-link-add">Add</button></div>'
      + '<p class="pr-hint" id="pr-hint" hidden>Files and links are added when you save the questions.</p></div>'
      + '<div class="pr-who"><span>Who sees them</span>'
      + '<label class="pr-switch"><input type="checkbox" id="pr-students" /><span>Students, with the test<small>Shown beside the questions (always for open-book tests).</small></span></label>'
      + '<label class="pr-switch"><input type="checkbox" id="pr-show" /><span>Parents, on the parent portal<small>With the test’s title, so they can help at home.</small></span></label></div>'
      + '<p class="pr-error" id="pr-error" role="alert" hidden></p>';
    var holder = anchor.closest('.form-group, .field, .question-field, .question-modal-field, label') || anchor;
    holder.parentNode.insertBefore(box, holder.nextSibling);
    box.addEventListener('click', onClick);
    box.querySelector('#pr-files').addEventListener('change', onFiles);
    box.querySelector('#pr-link-url').addEventListener('keydown', function (e) { if (e.key === 'Enter') { e.preventDefault(); addLink(); } });
    return box;
  }
  function showError(text) { var e = box.querySelector('#pr-error'); e.textContent = text || ''; e.hidden = !text; }
  function renderFiles() {
    var rows = state.files.map(function (f) { return { id: f.id, name: f.name, link: f.link, url: f.url, saved: true }; })
      .concat(state.pendingFiles.map(function (f, i) { return { pending: 'file:' + i, name: f.name }; }))
      .concat(state.pendingLinks.map(function (l, i) { return { pending: 'link:' + i, name: l.label || l.url, link: true }; }));
    box.querySelector('#pr-list').innerHTML = rows.map(function (r) {
      return '<li><span class="pr-ico">' + (r.link ? LINK : FILE) + '</span><span class="pr-name">' + (r.url ? '<a href="' + esc(r.url) + '" target="_blank" rel="noopener">' + esc(r.name) + '</a>' : esc(r.name)) + (r.pending ? ' <em>(adds when saved)</em>' : '') + '</span>'
        + '<button type="button" class="pr-remove" ' + (r.pending ? 'data-pr-unpick="' + r.pending + '"' : 'data-pr-remove="' + r.id + '"') + ' aria-label="Remove ' + esc(r.name) + '">Remove</button></li>';
    }).join('');
    box.querySelector('#pr-hint').hidden = Boolean(state.setId) || !(state.pendingFiles.length || state.pendingLinks.length);
  }
  function uploadFiles(setId, files) {
    var form = new FormData();
    form.append('questionSetId', setId);
    files.forEach(function (file) { form.append('files', file); });
    return fetch('/common/assessment/questions/parent-portal/files', { method: 'POST', credentials: 'same-origin', headers: { Accept: 'application/json' }, body: form }).then(json);
  }
  function postLink(setId, link) {
    return fetch('/common/assessment/questions/parent-portal/link', {
      method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({ questionSetId: setId, url: link.url, label: link.label })
    }).then(json);
  }
  function onFiles(e) {
    var picked = Array.prototype.slice.call(e.target.files || []);
    e.target.value = '';
    if (!picked.length) return;
    showError('');
    if (!state.setId) { state.pendingFiles = state.pendingFiles.concat(picked); renderFiles(); return; }
    uploadFiles(state.setId, picked).then(function (r) { state.files = state.files.concat(r.files || []); renderFiles(); })
      .catch(function (err) { showError(err.message || 'Those files could not be uploaded.'); });
  }
  function addLink() {
    var url = box.querySelector('#pr-link-url').value.trim();
    var label = box.querySelector('#pr-link-label').value.trim();
    if (!/^https?:\/\/\S+$/i.test(url)) { showError('Give a link that starts with https://'); return; }
    showError('');
    var clear = function () { box.querySelector('#pr-link-url').value = ''; box.querySelector('#pr-link-label').value = ''; box.querySelector('#pr-linkrow').hidden = true; };
    if (!state.setId) { state.pendingLinks.push({ url: url, label: label }); clear(); renderFiles(); return; }
    postLink(state.setId, { url: url, label: label }).then(function (r) { state.files.push(r.file); clear(); renderFiles(); })
      .catch(function (err) { showError(err.message); });
  }
  function onClick(e) {
    if (e.target.closest('#pr-link-open')) { var row = box.querySelector('#pr-linkrow'); row.hidden = !row.hidden; if (!row.hidden) box.querySelector('#pr-link-url').focus(); return; }
    if (e.target.closest('#pr-link-add')) return addLink();
    var unpick = e.target.closest('[data-pr-unpick]');
    if (unpick) {
      var parts = unpick.getAttribute('data-pr-unpick').split(':');
      (parts[0] === 'file' ? state.pendingFiles : state.pendingLinks).splice(Number(parts[1]), 1);
      return renderFiles();
    }
    var remove = e.target.closest('[data-pr-remove]');
    if (!remove) return;
    var id = remove.getAttribute('data-pr-remove');
    fetch('/common/assessment/questions/parent-portal/files/' + encodeURIComponent(id) + '/delete', { method: 'POST', credentials: 'same-origin', headers: { Accept: 'application/json' } })
      .then(json)
      .then(function () { state.files = state.files.filter(function (f) { return String(f.id) !== String(id); }); renderFiles(); })
      .catch(function () { showError('That could not be removed.'); });
  }
  function fill(data) {
    if (!ensureBox()) return;
    box.querySelector('#pr-show').checked = Boolean(data.show);
    box.querySelector('#pr-students').checked = Boolean(data.students);
    box.querySelector('#pr-notes').value = data.notes || '';
    box.querySelector('#pr-linkrow').hidden = true;
    state.files = data.files || [];
    state.pendingFiles = [];
    state.pendingLinks = [];
    renderFiles();
    showError('');
  }

  window.ParentResources = {
    load: function (setId) {
      state.setId = setId || null;
      // A new set: students see what the teacher adds, unless they untick it.
      fill({ show: false, students: !setId, notes: '', files: [] });
      if (!setId) return Promise.resolve();
      var asked = setId;
      return fetch('/common/assessment/questions/parent-portal?questionSetId=' + encodeURIComponent(setId), { credentials: 'same-origin', headers: { Accept: 'application/json' } })
        .then(function (res) { return res.ok ? res.json() : null; })
        .then(function (result) { if (asked === state.setId && result && result.success) fill(result); })
        .catch(function () { /* the form still works */ });
    },
    afterSave: function (setId) {
      if (!setId || !ensureBox()) return Promise.resolve();
      var files = state.pendingFiles.slice();
      var links = state.pendingLinks.slice();
      return fetch('/common/assessment/questions/parent-portal', {
        method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify({ questionSetId: setId, show: box.querySelector('#pr-show').checked, students: box.querySelector('#pr-students').checked, notes: box.querySelector('#pr-notes').value })
      }).then(function () {
        var work = [];
        if (files.length) work.push(uploadFiles(setId, files));
        links.forEach(function (l) { work.push(postLink(setId, l)); });
        return Promise.all(work);
      }).then(function () {
        state.setId = setId;
        state.pendingFiles = [];
        state.pendingLinks = [];
      }).catch(function () { /* the set itself is saved */ });
    }
  };

  function begin() { ensureBox(); }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', begin);
  else begin();
})();
