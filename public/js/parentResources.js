// In the question set form: show it on the parent portal, with notes and files for helping
// at home. Saved after the set itself, so the set's own save is unchanged.
(function () {
  'use strict';
  if (window.ParentResources) return;

  var state = { setId: null, files: [] };
  var box = null;

  function esc(value) {
    return String(value === null || value === undefined ? '' : value).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function ensureBox() {
    if (box && document.body.contains(box)) return box;
    var anchor = document.getElementById('question-set-description');
    if (!anchor) return null;
    box = document.createElement('section');
    box.className = 'pr-box';
    box.setAttribute('aria-label', 'Parent portal');
    box.innerHTML = '<label class="pr-switch"><input type="checkbox" id="pr-show" /><span>Show on parent portal</span></label>'
      + '<div id="pr-more" hidden>'
      + '<label class="pr-field"><span>Notes for parents</span><textarea id="pr-notes" rows="3" maxlength="4000" placeholder="Tips or recommendations for helping at home"></textarea></label>'
      + '<label class="pr-field"><span>Attach resources</span><input type="file" id="pr-files" multiple /></label>'
      + '<ul class="pr-list" id="pr-list"></ul>'
      + '<p class="pr-error" id="pr-error" role="alert" hidden></p>'
      + '</div>';
    var holder = anchor.closest('.form-group, .field, .question-field, .question-modal-field, label') || anchor;
    holder.parentNode.insertBefore(box, holder.nextSibling);
    box.querySelector('#pr-show').addEventListener('change', syncMore);
    box.addEventListener('click', function (event) {
      var remove = event.target.closest('[data-pr-remove]');
      if (!remove) return;
      event.preventDefault();
      var id = remove.getAttribute('data-pr-remove');
      fetch('/common/assessment/questions/parent-portal/files/' + encodeURIComponent(id) + '/delete', { method: 'POST', credentials: 'same-origin', headers: { Accept: 'application/json' } })
        .then(function (res) {
          if (!res.ok) throw new Error('remove');
          state.files = state.files.filter(function (file) { return String(file.id) !== String(id); });
          renderFiles();
        })
        .catch(function () { showError('That file could not be removed.'); });
    });
    return box;
  }
  function syncMore() { box.querySelector('#pr-more').hidden = !box.querySelector('#pr-show').checked; }
  function showError(text) { var e = box.querySelector('#pr-error'); e.textContent = text; e.hidden = !text; }
  function renderFiles() {
    box.querySelector('#pr-list').innerHTML = state.files.map(function (file) {
      return '<li><span>' + esc(file.name) + '</span><button type="button" class="pr-remove" data-pr-remove="' + file.id + '" aria-label="Remove ' + esc(file.name) + '">Remove</button></li>';
    }).join('');
  }
  function fill(show, notes, files) {
    if (!ensureBox()) return;
    box.querySelector('#pr-show').checked = Boolean(show);
    box.querySelector('#pr-notes').value = notes || '';
    box.querySelector('#pr-files').value = '';
    state.files = files || [];
    renderFiles();
    syncMore();
    showError('');
  }

  window.ParentResources = {
    // A set was opened in the form, or the form was cleared for a new one.
    load: function (setId) {
      state.setId = setId || null;
      fill(false, '', []);
      if (!setId) return Promise.resolve();
      var asked = setId;
      return fetch('/common/assessment/questions/parent-portal?questionSetId=' + encodeURIComponent(setId), { credentials: 'same-origin', headers: { Accept: 'application/json' } })
        .then(function (res) { return res.ok ? res.json() : null; })
        .then(function (result) {
          if (asked !== state.setId || !result || !result.success) return;
          fill(result.show, result.notes, result.files);
        })
        .catch(function () { /* the form still works */ });
    },
    // The set was saved: its parent settings and any new files follow.
    afterSave: function (setId) {
      if (!setId || !ensureBox()) return Promise.resolve();
      var show = box.querySelector('#pr-show').checked;
      var notes = box.querySelector('#pr-notes').value;
      var picked = box.querySelector('#pr-files').files;
      return fetch('/common/assessment/questions/parent-portal', {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify({ questionSetId: setId, show: show, notes: notes })
      }).then(function () {
        if (!show || !picked || !picked.length) return null;
        var form = new FormData();
        form.append('questionSetId', setId);
        Array.prototype.forEach.call(picked, function (file) { form.append('files', file); });
        return fetch('/common/assessment/questions/parent-portal/files', { method: 'POST', credentials: 'same-origin', headers: { Accept: 'application/json' }, body: form });
      }).catch(function () { /* the set itself is saved */ });
    }
  };

  function begin() { ensureBox(); }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', begin);
  else begin();
})();
