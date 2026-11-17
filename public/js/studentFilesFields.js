// Files on Add student and Edit student (views/partials/studentFilesFields.ejs): "Add a file" adds a row,
// the row's type sets who sees it until that's changed by hand, × takes the row away. Bound once.
(function () {
  if (window.__managiraStudentFiles) return;
  window.__managiraStudentFiles = true;
  function follow(row) {
    var type = row.querySelector('[data-sff-type]');
    var sharing = row.querySelector('[data-sff-sharing]');
    if (!type || !sharing || sharing.dataset.touched) return;
    var wanted = type.options[type.selectedIndex].getAttribute('data-sharing');
    sharing.value = sharing.querySelector('option[value="' + wanted + '"]') ? wanted : 'staff';
  }
  document.addEventListener('click', function (event) {
    var add = event.target.closest('[data-sff-add]');
    if (add) {
      var box = add.closest('[data-sff]');
      var template = box.querySelector('template[data-sff-row]');
      var count = Number(box.dataset.sffCount || 0) + 1;
      box.dataset.sffCount = String(count);
      var key = (box.getAttribute('data-sff-prefix') || 'new') + count;
      var holder = document.createElement('div');
      holder.innerHTML = template.innerHTML.replace(/\{\{KEY\}\}/g, key);
      var row = holder.firstElementChild;
      box.querySelector('[data-sff-rows]').appendChild(row);
      follow(row);
      var input = row.querySelector('input[type="file"]');
      if (input) input.click();
      return;
    }
    var remove = event.target.closest('[data-sff-remove]');
    if (remove) remove.closest('[data-sff-new]').remove();
  });
  document.addEventListener('change', function (event) {
    var row = event.target.closest('[data-sff-new]');
    if (!row) return;
    if (event.target.matches('[data-sff-sharing]')) event.target.dataset.touched = '1';
    if (event.target.matches('[data-sff-type]')) follow(row);
    // A chosen file names the row until a title is typed.
    if (event.target.type === 'file' && event.target.files && event.target.files[0]) {
      var title = row.querySelector('input[name^="docTitle_"]');
      if (title && !title.value) title.placeholder = event.target.files[0].name.replace(/\.[^.]+$/, '');
    }
  });
})();
