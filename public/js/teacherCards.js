// Teacher cards (views/partials/teacherCards.ejs): the About me "More" toggle and the photo preview.
// One delegated listener on the document, so it also works on the copy of the cards the student
// portal puts into its sheet.
(function () {
  if (window.__tcCards) return;
  window.__tcCards = true;
  var phone = window.matchMedia('(max-width: 640px)');
  var box = null;

  function close() {
    if (box) box.hidden = true;
    document.removeEventListener('keydown', onKey, true);
  }
  function onKey(e) {
    if (e.key === 'Escape') { e.stopPropagation(); close(); }
  }
  function open(src, alt) {
    if (!box) {
      box = document.createElement('div');
      box.className = 'tc-lb';
      box.setAttribute('role', 'dialog');
      box.setAttribute('aria-modal', 'true');
      box.setAttribute('aria-label', 'Photo');
      box.innerHTML = '<button type="button" class="tc-lb__x" aria-label="Close">&times;</button><img alt="" />';
      box.addEventListener('click', function (e) { if (e.target !== box.querySelector('img')) close(); });
      document.body.appendChild(box);
    }
    var head = document.getElementById('top-header');
    box.style.top = head ? head.offsetHeight + 'px' : '0px';
    var img = box.querySelector('img');
    img.src = src;
    img.alt = alt || '';
    box.hidden = false;
    document.addEventListener('keydown', onKey, true);
    box.querySelector('.tc-lb__x').focus();
  }

  document.addEventListener('click', function (e) {
    var more = e.target.closest && e.target.closest('[data-tc-more]');
    if (more) {
      var text = more.parentNode.querySelector('.tc-about__text');
      var on = more.getAttribute('aria-expanded') !== 'true';
      more.setAttribute('aria-expanded', on ? 'true' : 'false');
      more.textContent = on ? 'Less' : 'More';
      if (text) text.classList.toggle('is-open', on);
      return;
    }
    var photo = e.target.closest && e.target.closest('[data-tc-photo]');
    if (photo && phone.matches) {
      e.preventDefault();
      var img = photo.querySelector('img');
      open(photo.getAttribute('href'), img ? img.alt : '');
    }
  });
})();
