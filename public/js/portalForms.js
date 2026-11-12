// Forms on the parent and student portals (feature custom_forms): what to fill in first, then
// what was sent, then what the school shares. One tap opens a form; Send saves it.
(function () {
  'use strict';
  var R = window.CustomFormRender;
  var app = document.getElementById('cfp-app');
  if (!R || !app) return;
  var icon = R.icon;
  var esc = R.esc;
  var boot = JSON.parse(document.getElementById('cfp-boot').textContent || '{}');
  var forms = boot.forms || [];
  var open = {};
  var mounted = {};
  if (!forms.length) return;
  // Opened from its own tile: the form is there, ready to fill in.
  if (boot.single) open[forms[0].id] = true;

  function day(at) {
    if (!at) return '';
    var d = new Date(String(at).length === 10 ? at + 'T00:00:00' : at);
    return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
  }
  function sub(f) {
    if (f.fillsIn && f.todo) return [f.dueDate ? 'Due ' + day(f.dueDate) : '', f.required ? 'Required' : ''].filter(Boolean).join(' · ') || 'To fill in';
    if (f.fillsIn && f.multiple) return f.entries.length + (f.entries.length === 1 ? ' entry' : ' entries');
    if (f.fillsIn) return 'Sent ' + day(f.entries[0] && f.entries[0].updatedAt);
    return f.entries.length ? 'Updated ' + day(f.entries[0].updatedAt) : 'Nothing yet';
  }
  function pill(f) {
    if (f.fillsIn && f.todo) return '<span class="cf-pill cf-pill--warn">To do</span>';
    if (f.fillsIn) return '<span class="cf-pill cf-pill--live">Sent</span>';
    return '<span class="cf-pill">From school</span>';
  }
  function card(f) {
    return '<article class="cfp-form" data-form="' + f.id + '"><button type="button" class="cfp-form__head" data-toggle="' + f.id + '" aria-expanded="' + Boolean(open[f.id]) + '">'
      + '<span class="cfp-form__icon">' + icon(f.icon, 20) + '</span><span><strong>' + esc(f.name) + '</strong><small>' + esc(sub(f)) + '</small></span>' + pill(f) + '</button>'
      + '<div class="cfp-form__body" data-body="' + f.id + '"' + (open[f.id] ? '' : ' hidden') + '></div></article>';
  }
  function render() {
    var todo = forms.filter(function (f) { return f.fillsIn && f.todo; });
    var sent = forms.filter(function (f) { return f.fillsIn && !f.todo; });
    var shared = forms.filter(function (f) { return !f.fillsIn; });
    app.innerHTML = [['To fill in', todo], ['Sent', sent], ['Shared by the school', shared]].filter(function (g) { return g[1].length; }).map(function (g) {
      return '<section class="cfp-group"><h2>' + g[0] + '</h2>' + g[1].map(card).join('') + '</section>';
    }).join('');
    forms.forEach(function (f) { if (open[f.id]) body(f); });
  }
  function body(f, editing) {
    var el = app.querySelector('[data-body="' + f.id + '"]');
    if (!el) return;
    if (!f.fillsIn) {
      el.innerHTML = f.entries.length ? f.entries.map(function (e) { return '<div class="cf-entry"><div class="cf-entry__head"><strong>' + esc(day(e.updatedAt)) + '</strong></div><div class="cf-entry__body" data-view="' + e.id + '"></div></div>'; }).join('') : '<p class="cf-card__sub">The school hasn’t filled this in yet.</p>';
      f.entries.forEach(function (e) { R.view(el.querySelector('[data-view="' + e.id + '"]'), f, e.data); });
      return;
    }
    // One record: the form, filled with what was sent (or read only if the school filled it).
    if (!f.multiple) {
      var current = f.entries[0];
      if (current && !current.mine) {
        el.innerHTML = '<p class="cf-card__sub">The school filled this in.</p><div data-view></div>';
        R.view(el.querySelector('[data-view]'), f, current.data);
        return;
      }
      return formInto(el, f, current || null);
    }
    // A list: add a new one, and see (and change) the ones sent before.
    if (editing !== undefined) return formInto(el, f, editing);
    el.innerHTML = '<div><button type="button" class="cf-btn cf-btn--primary" data-add="' + f.id + '">' + icon('plus', 15) + 'Add</button></div>'
      + f.entries.map(function (e) {
        return '<div class="cf-entry"><div class="cf-entry__head"><strong>' + esc(day(e.updatedAt)) + '</strong><span class="cf-spacer"></span>'
          + (e.mine ? '<button type="button" class="cf-btn cf-btn--sm" data-edit="' + f.id + ':' + e.id + '">Edit</button>' : '<span>From school</span>') + '</div><div class="cf-entry__body" data-view="' + e.id + '"></div></div>';
      }).join('');
    f.entries.forEach(function (e) { R.view(el.querySelector('[data-view="' + e.id + '"]'), f, e.data); });
  }
  function formInto(el, f, entry) {
    // A form collected again starts from last time's answers.
    var start = entry ? entry.data : (!f.multiple && f.previous) || {};
    el.innerHTML = (!entry && !f.multiple && f.previous ? '<p class="cf-card__sub">Last time’s answers are filled in. Check them, then send.</p>' : '')
      + (f.once ? '<p class="cf-card__sub">This can be sent only once.</p>' : '')
      + '<div data-fields></div><div class="cfp-actions"><button type="button" class="cf-btn cf-btn--primary" data-send>' + (entry ? 'Save changes' : 'Send') + '</button>'
      + (f.multiple ? '<button type="button" class="cf-btn" data-back>Cancel</button>' : '') + '<span class="cfp-msg" data-msg role="status"></span></div>';
    var form = R.mount(el.querySelector('[data-fields]'), f, {
      values: start,
      upload: function (file) {
        var fd = new FormData();
        fd.append('file', file);
        return fetch(boot.base + '/' + f.id + '/upload' + boot.query, { method: 'POST', credentials: 'same-origin', headers: { Accept: 'application/json' }, body: fd })
          .then(function (res) { return res.json().then(function (j) { if (!res.ok || !j.success) throw new Error(j.error || 'That file could not be uploaded.'); return j.file; }); });
      }
    });
    mounted[f.id] = form;
    el.querySelector('[data-send]').onclick = function () {
      var msg = el.querySelector('[data-msg]');
      msg.className = 'cfp-msg';
      msg.textContent = '';
      if (form.validate().length) { msg.textContent = 'Check the highlighted answers.'; return; }
      var btn = this;
      btn.disabled = true;
      btn.textContent = 'Sending…';
      fetch(boot.base + '/' + f.id + boot.query, {
        method: 'POST', credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify({ entryId: entry ? entry.id : null, values: form.values() })
      }).then(function (res) { return res.json().then(function (j) { if (!res.ok || !j.success) { var e = new Error(j.error || 'It could not be sent. Try again.'); e.errors = j.errors; throw e; } return j; }); })
        .then(function (res) {
          var saved = { id: res.entry.id, data: res.entry.data, updatedAt: res.entry.updatedAt, mine: true };
          f.entries = [saved].concat(f.entries.filter(function (e) { return !entry || e.id !== entry.id; }));
          f.todo = false;
          open[f.id] = true;
          render();
          var again = app.querySelector('[data-body="' + f.id + '"] [data-msg]') || app.querySelector('[data-form="' + f.id + '"] .cfp-form__head small');
          if (again && again.hasAttribute('data-msg')) { again.className = 'cfp-msg cfp-msg--ok'; again.textContent = 'Sent. Thank you!'; }
          var head = app.querySelector('[data-form="' + f.id + '"]');
          if (head) head.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
        })
        .catch(function (err) {
          btn.disabled = false;
          btn.textContent = entry ? 'Save changes' : 'Send';
          if (err.errors) form.showErrors(err.errors);
          msg.textContent = err.message;
        });
    };
    var back = el.querySelector('[data-back]');
    if (back) back.onclick = function () { body(f); };
  }

  app.addEventListener('click', function (e) {
    var t = e.target.closest('[data-toggle]');
    if (t) {
      var id = Number(t.getAttribute('data-toggle'));
      open[id] = !open[id];
      t.setAttribute('aria-expanded', String(open[id]));
      var el = app.querySelector('[data-body="' + id + '"]');
      el.hidden = !open[id];
      if (open[id]) body(forms.filter(function (f) { return f.id === id; })[0]);
      return;
    }
    var add = e.target.closest('[data-add]');
    if (add) return body(forms.filter(function (f) { return f.id === Number(add.getAttribute('data-add')); })[0], null);
    var ed = e.target.closest('[data-edit]');
    if (ed) {
      var parts = ed.getAttribute('data-edit').split(':');
      var f = forms.filter(function (x) { return x.id === Number(parts[0]); })[0];
      return body(f, f.entries.filter(function (x) { return x.id === Number(parts[1]); })[0]);
    }
  });

  // The first thing to do opens by itself.
  var first = forms.filter(function (f) { return f.fillsIn && f.todo; })[0];
  if (first) open[first.id] = true;
  var wanted = Number(new URLSearchParams(location.search).get('form'));
  if (wanted) open[wanted] = true;
  render();
})();
