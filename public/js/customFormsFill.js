// Filling in custom sections (feature custom_forms), inside the page that owns them: the
// classroom's Forms tab, the driver portal, and Responses in the Custom editor. Pick a section,
// see its students and what's done, open a student to fill it in or read what was sent.
//   <div data-cf-fill data-base="/common/forms" data-class-id="146"></div>   (classroom)
//   <div data-cf-fill data-base="/driver/forms"></div>                        (driver portal)
//   data-only="12" shows that one form; data-skip-tiles leaves out forms with a place of their own
//   CustomFormsFill.mount(el, { base, sections, selected })                    (the editor)
// Each one loads only when it is first shown, so the page around it stays fast.
(function () {
  'use strict';
  if (window.CustomFormsFill) return;
  var R = window.CustomFormRender;
  if (!R) return;
  var icon = R.icon;
  var esc = R.esc;
  var PLACE = { staff: 'Classroom', parent: 'Parents fill in', student: 'Students fill in', driver: 'Drivers fill in' };
  var PAGE = 60; // students drawn at a time, however big the school

  function toast(text, error) {
    var t = document.createElement('div');
    t.className = 'cf-toast' + (error ? ' cf-toast--error' : '');
    t.setAttribute('role', 'status');
    t.textContent = text;
    document.body.appendChild(t);
    setTimeout(function () { t.remove(); }, 3200);
  }
  function api(url, body) {
    return fetch(url, {
      method: body ? 'POST' : 'GET', credentials: 'same-origin',
      headers: body ? { 'Content-Type': 'application/json', Accept: 'application/json' } : { Accept: 'application/json' },
      body: body ? JSON.stringify(body) : undefined
    }).then(function (res) {
      return res.json().catch(function () { return {}; }).then(function (json) {
        if (!res.ok || !json.success) { var err = new Error(json.error || 'Something went wrong. Try again.'); err.errors = json.errors; throw err; }
        return json;
      });
    });
  }
  function when(at) {
    if (!at) return '';
    var d = new Date(at);
    return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: d.getFullYear() === new Date().getFullYear() ? undefined : 'numeric' });
  }

  function mount(root, opts) {
    var base = opts.base || '/common/forms';
    var sections = opts.sections || [];
    // quick: the fields answered with a tap (the list then carries each student's answer, so a
    // class is filled in on one screen: inline, as a seating chart or in groups). pick: the
    // student being moved on a chart.
    var state = { section: null, students: [], q: '', classId: opts.classId || '', shown: PAGE, quick: [], view: 'list', pick: 0, addRows: 0, addCols: 0 };
    // The term the page is showing (the classroom can look at another term).
    var termId = opts.termId || '';
    function withTerm(url) { return termId ? url + (url.indexOf('?') === -1 ? '?' : '&') + 'termId=' + encodeURIComponent(termId) : url; }
    root.classList.add('cf', 'cf-fillbox');
    if (!sections.length) {
      root.innerHTML = '<div class="cf-blank"><strong>No forms here yet</strong>' + esc(opts.emptyText || 'Forms the school builds in the Custom editor show here.') + '</div>';
      return;
    }
    root.innerHTML = (sections.length > 1 ? '<div class="cf-fill__picks" role="tablist" aria-label="Forms"></div>' : '') + '<div class="cf-card cf-fill__main"></div>';
    var picks = root.querySelector('.cf-fill__picks');
    var pane = root.querySelector('.cf-fill__main');

    function renderPicks() {
      if (!picks) return;
      picks.innerHTML = sections.map(function (s) {
        return '<button type="button" class="cf-pick" role="tab" data-section="' + s.id + '" aria-selected="' + Boolean(state.section && state.section.id === s.id) + '">'
          + '<span class="cf-pick__icon">' + icon(s.icon, 16) + '</span><span><strong>' + esc(s.name) + '</strong><small>' + esc(PLACE[s.filledBy] || '') + '</small></span></button>';
      }).join('');
    }
    function choose(id, thenStudent) {
      state.section = sections.filter(function (s) { return s.id === id; })[0] || sections[0];
      state.q = '';
      state.shown = PAGE;
      renderPicks();
      load(thenStudent);
    }
    function head() {
      var s = state.section;
      var who = s.filledBy === 'staff' ? 'Filled in by staff' : s.filledBy === 'driver' ? 'Filled in by drivers' : s.filledBy === 'parent' ? 'Parents fill this in. You can read what they send.' : 'Students fill this in. You can read what they send.';
      return '<div class="cf-fill__head"><span class="cf-iconbox">' + icon(s.icon) + '</span><div style="min-width:0"><h3>' + esc(s.name) + '</h3><p>' + esc(who)
        + (s.repeat === 'term' ? ' · Every term' : s.repeat === 'year' ? ' · Every year' : '') + (s.once ? ' · Locked once sent' : '') + (s.dueDate ? ' · Due ' + esc(when(s.dueDate + 'T00:00:00')) : '') + '</p></div>'
        + '<span class="cf-progress" data-progress></span></div>'
        + viewsHtml() + keyHtml()
        + '<div class="cf-toolbar">'
        // The list is searched by name; a chart shows everyone at once.
        + (state.view === 'list' ? '<label class="cf-search"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><circle cx="11" cy="11" r="7"/><path d="M20 20l-3.5-3.5"/></svg>'
        + '<input type="search" class="cf-input" data-q placeholder="Find a student" aria-label="Find a student" value="' + esc(state.q) + '" /></label>' : '<span class="cf-spacer"></span>')
        // Staff can take the answers away as a spreadsheet, and nudge families who haven't replied.
        + (base === '/common/forms' ? '<a class="cf-btn cf-btn--sm" href="' + base + '/' + s.id + '/export.csv" download>' + icon('download', 15) + 'Download</a>' : '')
        + (base === '/common/forms' && s.filledBy === 'parent' && s.status === 'live' ? '<button type="button" class="cf-btn cf-btn--sm" data-remind>' + icon('send', 15) + 'Send a reminder</button>' : '')
        + '</div>';
    }
    function load(thenStudent) {
      var s = state.section;
      pane.innerHTML = head() + '<div class="cf-blank">Loading…</div>';
      api(withTerm(base + '/' + s.id + '/students' + (state.classId ? '?classId=' + state.classId : ''))).then(function (res) {
        if (state.section !== s) return;
        if (res.fields) s.fields = res.fields;
        state.students = res.students;
        state.quick = (res.quick || []).map(function (id) { return (s.fields || []).filter(function (f) { return f.id === id; })[0]; }).filter(Boolean);
        state.pick = 0; state.addRows = 0; state.addCols = 0;
        // A seating chart opens as a chart.
        state.view = seatField() ? 'seats' : 'list';
        renderTable();
        if (thenStudent) openStudent(thenStudent);
      }).catch(function (err) { pane.innerHTML = head() + '<div class="cf-blank">' + esc(err.message) + '</div>'; });
    }
    // ── Quick sections: answers given straight in the list, on a seating chart or in groups ──
    function seatField() { return state.quick.filter(function (f) { return f.type === 'seat'; })[0] || null; }
    function groupField() { return state.quick.filter(function (f) { return f.type === 'choice'; })[0] || null; }
    function canQuick() { return state.quick.length > 0 && state.section.canEdit !== false; }
    function viewsHtml() {
      var views = [['list', 'List']];
      if (seatField()) views.push(['seats', 'Seating chart']);
      if (groupField()) views.push(['groups', 'Groups']);
      if (views.length < 2) return '';
      return '<div class="cf-views" role="tablist">' + views.map(function (v) {
        return '<button type="button" role="tab" data-view="' + v[0] + '" aria-selected="' + (state.view === v[0]) + '">' + v[1] + '</button>';
      }).join('') + '</div>';
    }
    function shortName(st) {
      var parts = st.name.split(' ');
      return parts[0] + (parts.length > 1 ? ' ' + parts[parts.length - 1].charAt(0) + '.' : '');
    }
    // One save at a time for each student, so quick taps never cross.
    var saving = {};
    function quickSave(st, values) {
      var before = { data: st.data, entries: st.entries };
      st.data = values;
      st.entries = Object.keys(values).some(function (k) { return values[k] !== null && values[k] !== '' && values[k] !== undefined; }) ? 1 : 0;
      var run = function () {
        return api(withTerm(base + '/' + state.section.id + '/student/' + st.id), { values: values, quick: true }).then(function () {
          st.lastAt = new Date().toISOString();
        }).catch(function (err) {
          st.data = before.data; st.entries = before.entries;
          toast(err.message, true);
          renderTable();
        });
      };
      saving[st.id] = (saving[st.id] || Promise.resolve()).then(run);
      progress();
      return saving[st.id];
    }
    function valuesOf(st) { var out = {}; Object.keys(st.data || {}).forEach(function (k) { out[k] = st.data[k]; }); return out; }
    // A student's photo, or their initials when there is none.
    function avatar(st) {
      var parts = st.name.split(' ');
      var initials = (parts[0].charAt(0) + (parts.length > 1 ? parts[parts.length - 1].charAt(0) : '')).toUpperCase();
      // The initials sit under the photo, so a photo that fails to load still leaves a face.
      return '<span class="cf-avatar" aria-hidden="true">' + esc(initials) + (st.photo ? '<img src="' + esc(st.photo) + '" alt="" loading="lazy" onerror="this.remove()" />' : '') + '</span>';
    }
    function answerHtml(f, v) {
      var name = R.answerIcon(f, v);
      return (name ? '<span class="cf-answericon">' + icon(name, 16) + '</span>' : '') + esc(R.display(f, v));
    }
    function quickCell(st, f) {
      var v = (st.data || {})[f.id];
      var mine = st.by !== 'parent' && st.by !== 'student';
      if (!canQuick() || !mine) return '<td>' + (v === undefined || v === null || v === '' ? '<span style="color:var(--cf-muted)">—</span>' : answerHtml(f, v)) + '</td>';
      if (f.type === 'seat') return '<td>' + (v ? esc(R.display(f, v)) : '<span style="color:var(--cf-muted)">No seat yet</span>') + '</td>';
      // Yes / No and choices shown as buttons or icons: one tap each; the chosen one is lit, tap it again to clear.
      if (f.type === 'yesno' || (f.type === 'choice' && (f.display === 'buttons' || f.display === 'icons'))) {
        var now = f.type === 'yesno' ? (v === true ? 'yes' : v === false ? 'no' : '') : (v == null ? '' : String(v));
        var icons = f.display === 'icons';
        return '<td><span class="cf-pickset' + (icons ? ' cf-pickset--icons' : '') + '" data-quick="' + f.id + '" role="group" aria-label="' + esc(f.label) + ' for ' + esc(st.name) + '">'
          + R.choicesOf(f).map(function (c) {
            return '<button type="button" data-v="' + esc(c[0]) + '" aria-pressed="' + (now === c[0]) + '" title="' + esc(c[1]) + '">'
              + (icons && c[2] ? icon(c[2], 20) + '<span class="cf-sr">' + esc(c[1]) + '</span>' : esc(c[1])) + '</button>';
          }).join('') + '</span></td>';
      }
      var options = f.type === 'rating' ? [1, 2, 3, 4, 5] : (f.options || []);
      return '<td><select class="cf-input cf-quicksel" data-quick="' + f.id + '" aria-label="' + esc(f.label) + ' for ' + esc(st.name) + '"><option value="">—</option>' + options.map(function (o) {
        return '<option value="' + esc(o) + '"' + (String(v) === String(o) ? ' selected' : '') + '>' + esc(o) + '</option>';
      }).join('') + '</select></td>';
    }
    function keyHtml() {
      var f = state.quick.filter(function (x) { return x.display === 'icons' || x.type === 'yesno' || x.display === 'buttons'; })[0];
      if (!f || state.view !== 'list') return '';
      var counts = {};
      state.students.forEach(function (st) {
        var v = (st.data || {})[f.id];
        var k = f.type === 'yesno' ? (v === true ? 'yes' : v === false ? 'no' : '') : (v == null ? '' : String(v));
        if (k) counts[k] = (counts[k] || 0) + 1;
      });
      return '<div class="cf-key" data-key>' + R.choicesOf(f).map(function (c) {
        return '<span>' + (c[2] ? icon(c[2], 16) : '') + esc(c[1]) + ' <strong>' + (counts[c[0]] || 0) + '</strong></span>';
      }).join('') + '</div>';
    }
    function progress() {
      var s = state.section;
      var key = pane.querySelector('[data-key]');
      if (key) key.outerHTML = keyHtml();
      var done = state.students.filter(function (st) { return st.entries > 0; }).length;
      var pct = state.students.length ? Math.round(done / state.students.length * 100) : 0;
      var el = pane.querySelector('[data-progress]');
      var when = s.repeat === 'day' ? ' today' : s.repeat === 'week' ? ' this week' : '';
      if (el) el.innerHTML = done + ' of ' + state.students.length + (s.multiple ? ' have entries' : ' done' + when) + '<span class="cf-progress__bar"><span style="width:' + pct + '%"></span></span>';
    }
    // The seating chart: the room as rows of seats, the front at the top. Tap a student, then a seat.
    function seatsHtml() {
      var f = seatField();
      var edit = canQuick();
      var photos = f.display !== 'names'; // photos and names, or names only
      var seated = {};
      var maxR = 0, maxC = 0;
      state.students.forEach(function (st) {
        var v = (st.data || {})[f.id];
        if (v && v.r && v.c) { seated[v.r + ':' + v.c] = st; maxR = Math.max(maxR, v.r); maxC = Math.max(maxC, v.c); }
      });
      var rows = Math.min(40, Math.max(maxR, 5) + state.addRows), cols = Math.min(40, Math.max(maxC, 6) + state.addCols);
      var loose = state.students.filter(function (st) { var v = (st.data || {})[f.id]; return !(v && v.r && v.c); });
      var picked = state.pick ? state.students.filter(function (st) { return st.id === state.pick; })[0] : null;
      var html = '<div class="cf-seats">'
        + (edit ? '<div class="cf-seats__bar"><span>' + (picked ? 'Now tap a seat for <strong>' + esc(picked.name) + '</strong>.' : 'Tap a student, then a seat. Tap two students to swap them.') + '</span><span class="cf-spacer"></span>'
          + (picked && (picked.data || {})[f.id] ? '<button type="button" class="cf-btn cf-btn--sm" data-unseat>Take out of seat</button>' : '')
          + '<button type="button" class="cf-btn cf-btn--sm" data-grow="row">+ Row</button><button type="button" class="cf-btn cf-btn--sm" data-grow="col">+ Column</button></div>' : '')
        + (loose.length ? '<div class="cf-seats__tray"><small>' + (edit ? 'Not seated yet' : 'No seat') + ' (' + loose.length + ')</small>' + loose.map(function (st) {
          return '<button type="button" class="cf-seatchip" data-seat-student="' + st.id + '" aria-pressed="' + (state.pick === st.id) + '"' + (edit ? '' : ' disabled') + '>' + (photos ? avatar(st) : '') + esc(shortName(st)) + '</button>';
        }).join('') + '</div>' : '')
        + '<div class="cf-seats__front">Front of the room</div>'
        + '<div class="cf-seats__scroll"><div class="cf-seats__grid" style="grid-template-columns:repeat(' + cols + ',minmax(84px,1fr))">';
      for (var r = 1; r <= rows; r += 1) {
        for (var c = 1; c <= cols; c += 1) {
          var st = seated[r + ':' + c];
          html += '<button type="button" class="cf-seat' + (st ? ' is-taken' : '') + (photos ? ' cf-seat--photo' : '') + '" data-seat="' + r + ':' + c + '"' + (st ? ' data-seat-student="' + st.id + '" aria-pressed="' + (state.pick === st.id) + '" title="' + esc(st.name) + '"' : ' aria-label="Row ' + r + ', seat ' + c + '"') + (edit ? '' : ' disabled') + '>'
            + (st ? (photos ? avatar(st) : '') + '<span>' + esc(shortName(st)) + '</span>' : '') + '</button>';
        }
      }
      return html + '</div></div></div>';
    }
    function seatClick(target) {
      var f = seatField();
      var cell = target.closest('[data-seat]');
      var chip = target.closest('[data-seat-student]');
      var id = chip ? Number(chip.getAttribute('data-seat-student')) : 0;
      var byId = function (x) { return state.students.filter(function (st) { return st.id === x; })[0]; };
      if (!state.pick) { if (id) { state.pick = id; renderTable(); } return; }
      var picked = byId(state.pick);
      if (!picked || id === state.pick) { state.pick = 0; return renderTable(); }
      if (!cell) { state.pick = id || 0; return renderTable(); } // another unseated student: pick them instead
      var seat = cell.getAttribute('data-seat').split(':');
      var to = { r: Number(seat[0]), c: Number(seat[1]) };
      var from = (picked.data || {})[f.id] || null;
      var other = id ? byId(id) : null;
      var mine = valuesOf(picked); mine[f.id] = to;
      quickSave(picked, mine);
      if (other) { var theirs = valuesOf(other); theirs[f.id] = from; quickSave(other, theirs); } // swap (or send them back to the tray)
      state.pick = 0;
      renderTable();
    }
    // Groups: a column for each choice of the first dropdown field. Tap a student, then a group.
    function groupsHtml() {
      var f = groupField();
      var edit = canQuick();
      var groups = (f.options || []).map(function (o) { return { key: o, label: o, list: [] }; });
      var none = { key: '', label: 'No group yet', list: [] };
      state.students.forEach(function (st) {
        var v = (st.data || {})[f.id];
        (groups.filter(function (g) { return g.key === v; })[0] || none).list.push(st);
      });
      var picked = state.pick ? state.students.filter(function (st) { return st.id === state.pick; })[0] : null;
      var col = function (g) {
        var gi = g.key ? R.answerIcon(f, g.key) : '';
        return '<section class="cf-group' + (g.key === '' ? ' cf-group--none' : '') + '" data-group="' + esc(g.key) + '"><header><strong>' + (gi ? icon(gi, 18) : '') + esc(g.label) + '</strong><span>' + g.list.length + '</span></header><div>'
          + g.list.map(function (st) { return '<button type="button" class="cf-seatchip" data-group-student="' + st.id + '" aria-pressed="' + (state.pick === st.id) + '"' + (edit ? '' : ' disabled') + '>' + esc(st.name) + '</button>'; }).join('')
          + (edit && picked ? '<button type="button" class="cf-group__drop" data-group-drop>Move ' + esc(shortName(picked)) + ' here</button>' : '')
          + '</div></section>';
      };
      return '<div class="cf-groupsbox">' + (edit ? '<p class="cf-seats__bar"><span>' + (picked ? 'Now tap a group for <strong>' + esc(picked.name) + '</strong>.' : 'Tap a student, then the group to move them to.') + '</span></p>' : '')
        + '<div class="cf-groups">' + (none.list.length || !groups.length ? col(none) : '') + groups.map(col).join('') + '</div></div>';
    }
    function groupClick(target) {
      var f = groupField();
      var chip = target.closest('[data-group-student]');
      if (chip) { var id = Number(chip.getAttribute('data-group-student')); state.pick = state.pick === id ? 0 : id; return renderTable(); }
      var box = target.closest('[data-group]');
      if (!box || !state.pick) return;
      var st = state.students.filter(function (x) { return x.id === state.pick; })[0];
      state.pick = 0;
      if (st) { var values = valuesOf(st); values[f.id] = box.getAttribute('data-group') || null; quickSave(st, values); }
      renderTable();
    }

    function renderTable() {
      var s = state.section;
      if (state.view === 'seats' && seatField()) { pane.innerHTML = head() + seatsHtml(); return progress(); }
      if (state.view === 'groups' && groupField()) { pane.innerHTML = head() + groupsHtml(); return progress(); }
      var inline = state.quick.length > 0;
      var q = state.q.trim().toLowerCase();
      var matches = state.students.filter(function (st) { return !q || st.name.toLowerCase().indexOf(q) !== -1; });
      var rows = matches.slice(0, state.shown);
      var oneClass = state.classId || state.students.every(function (st) { return st.classId === (state.students[0] || {}).classId; });
      var html = head();
      if (!rows.length) html += '<div class="cf-blank">' + (state.students.length ? 'No student matches.' : '<strong>No students here</strong>This form’s classes have no students you can see.') + '</div>';
      else {
        html += '<table class="cf-table' + (inline ? ' cf-table--quick' : '') + '"><thead><tr><th>Student</th>' + (oneClass ? '' : '<th class="cf-hide-sm">Class</th>')
          + (inline ? state.quick.map(function (f) { return '<th>' + esc(f.label) + '</th>'; }).join('') : '<th>' + (s.multiple ? 'Entries' : 'Status') + '</th>') + '<th class="cf-hide-sm">Last saved</th></tr></thead><tbody>'
          + rows.map(function (st) {
            var status = s.multiple
              ? (st.entries ? '<span class="cf-status cf-status--done">' + st.entries + (st.entries === 1 ? ' entry' : ' entries') + '</span>' : '<span class="cf-status">None yet</span>')
              : (st.entries ? '<span class="cf-status cf-status--done">' + (s.once ? 'Submitted' : 'Done') + '</span>' : (s.required ? '<span class="cf-status cf-status--todo">Waiting</span>' : '<span class="cf-status">Not started</span>'));
            return '<tr data-student="' + st.id + '" tabindex="0"><td><strong>' + esc(st.name) + '</strong>' + (oneClass ? '' : '<small class="cf-show-sm">' + esc(st.className) + '</small>') + '</td>'
              + (oneClass ? '' : '<td class="cf-hide-sm">' + esc(st.className) + '</td>') + (inline ? state.quick.map(function (f) { return quickCell(st, f); }).join('') : '<td>' + status + '</td>')
              + '<td class="cf-hide-sm">' + (st.lastAt ? esc(when(st.lastAt)) + (st.lastBy ? '<small>' + esc(st.lastBy) + '</small>' : '') : '<span style="color:var(--cf-muted)">—</span>') + '</td></tr>';
          }).join('') + '</tbody></table>'
          + (matches.length > rows.length ? '<div class="cf-morerow"><button type="button" class="cf-btn cf-btn--sm" data-more>Show more (' + (matches.length - rows.length) + ')</button></div>' : '');
      }
      pane.innerHTML = html;
      progress();
      var input = pane.querySelector('[data-q]');
      if (input && q) { input.focus(); input.setSelectionRange(input.value.length, input.value.length); }
    }

    // ── One student ───────────────────────────────────────────────────────────────────
    var drawer = null;
    function closeDrawer() {
      if (!drawer) return;
      drawer.el.remove();
      drawer.back.remove();
      document.removeEventListener('keydown', drawer.onKey);
      drawer = null;
    }
    function openStudent(studentId) {
      var s = state.section;
      closeDrawer();
      var back = document.createElement('div');
      back.className = 'cf-drawer__backdrop';
      var el = document.createElement('aside');
      el.className = 'cf-drawer cf';
      el.setAttribute('role', 'dialog');
      el.setAttribute('aria-modal', 'true');
      el.innerHTML = '<div class="cf-drawer__head"><span class="cf-iconbox">' + icon(s.icon) + '</span><div style="flex:1;min-width:0"><h2></h2><p></p></div><button type="button" class="cf-btn cf-btn--sm cf-btn--ghost" data-close aria-label="Close">' + icon('close', 16) + '</button></div>'
        + '<div class="cf-drawer__body"><div class="cf-blank">Loading…</div></div><div class="cf-drawer__foot" hidden></div>';
      el.querySelector('h2').textContent = s.name;
      // Under the app header (where the page has one), never over it.
      var header = document.getElementById('top-header');
      if (header) { back.style.top = header.offsetHeight + 'px'; el.style.top = header.offsetHeight + 'px'; }
      document.body.appendChild(back);
      document.body.appendChild(el);
      var onKey = function (e) { if (e.key === 'Escape') closeDrawer(); };
      document.addEventListener('keydown', onKey);
      back.addEventListener('click', closeDrawer);
      el.addEventListener('click', function (e) { if (e.target.closest('[data-close]')) closeDrawer(); });
      drawer = { el: el, back: back, onKey: onKey, studentId: studentId };
      api(withTerm(base + '/' + s.id + '/student/' + studentId)).then(function (res) {
        if (!drawer || drawer.studentId !== studentId) return;
        drawer.data = res;
        el.querySelector('.cf-drawer__head p').textContent = res.student.name + (res.student.className ? ' · ' + res.student.className : '');
        drawStudent();
      }).catch(function (err) { el.querySelector('.cf-drawer__body').innerHTML = '<div class="cf-blank">' + esc(err.message) + '</div>'; });
    }
    function entryCard(en, canEdit) {
      var kind = en.savedByType === 'parent' ? ' (parent)' : en.savedByType === 'student' ? ' (student)' : en.savedByType === 'driver' ? ' (driver)' : '';
      return '<div class="cf-entry"><div class="cf-entry__head"><strong>' + esc(when(en.updatedAt || en.createdAt)) + '</strong><span>' + esc((en.savedBy || '') + kind) + '</span><span class="cf-spacer"></span>'
        + (canEdit ? '<button type="button" class="cf-btn cf-btn--sm" data-edit="' + en.id + '">Edit</button><button type="button" class="cf-btn cf-btn--sm cf-btn--ghost cf-btn--danger" data-delete="' + en.id + '" aria-label="Delete entry">' + icon('trash', 14) + '</button>' : '')
        + '</div><div class="cf-entry__body" data-view="' + en.id + '"></div></div>';
    }
    function drawStudent() {
      var s = state.section;
      var d = drawer.data;
      var body = drawer.el.querySelector('.cf-drawer__body');
      var foot = drawer.el.querySelector('.cf-drawer__foot');
      foot.hidden = true;
      foot.innerHTML = '';
      body.onclick = null;
      var entries = d.entries;
      var editable = d.canEdit && !d.locked;
      if (!s.multiple) {
        var entry = entries[0];
        // A family's form that hasn't come in: staff can enter one handed in on paper.
        if (!entry && d.paper) {
          body.innerHTML = '<div class="cf-blank"><strong>Nothing yet</strong>' + (s.filledBy === 'parent' ? 'The family hasn’t sent it.' : 'The student hasn’t sent it.')
            + '<br><button type="button" class="cf-btn" data-paper style="margin-top:14px">Received on paper? Fill it in</button></div>';
          body.onclick = function (e) { if (e.target.closest('[data-paper]')) editEntry(null); };
          return;
        }
        if (editable) return editEntry(entry || null);
        if (!entry) {
          body.innerHTML = '<div class="cf-blank"><strong>Nothing yet</strong>Nobody has filled it in.</div>';
          return;
        }
        body.innerHTML = (d.locked ? '<div class="cf-note" style="margin:0 0 12px">' + icon('lock', 16) + '<span>Submitted. It can only be sent once.</span></div>' : '') + entryCard(entry, false);
        R.view(body.querySelector('[data-view]'), s, entry.data);
        return;
      }
      body.innerHTML = (editable ? '<button type="button" class="cf-btn cf-btn--primary" data-add style="margin-bottom:14px">' + icon('plus', 15) + 'Add entry</button>' : '')
        + (entries.length ? entries.map(function (en) { return entryCard(en, editable); }).join('') : '<div class="cf-blank"><strong>No entries yet</strong>' + (editable ? 'Add the first one.' : '') + '</div>');
      Array.prototype.forEach.call(body.querySelectorAll('[data-view]'), function (v) {
        var en = entries.filter(function (x) { return String(x.id) === v.getAttribute('data-view'); })[0];
        R.view(v, s, en.data);
      });
      body.onclick = function (e) {
        if (e.target.closest('[data-add]')) return editEntry(null);
        var ed = e.target.closest('[data-edit]');
        if (ed) return editEntry(entries.filter(function (x) { return String(x.id) === ed.getAttribute('data-edit'); })[0]);
        var del = e.target.closest('[data-delete]');
        if (del && window.confirm('Delete this entry? It can’t be undone.')) {
          api(base + '/' + s.id + '/entry/' + del.getAttribute('data-delete') + '/delete', {}).then(function () {
            d.entries = d.entries.filter(function (x) { return String(x.id) !== del.getAttribute('data-delete'); });
            drawStudent();
            refreshRow();
            toast('Deleted.');
          }).catch(function (err) { toast(err.message, true); });
        }
      };
    }
    function editEntry(entry) {
      var s = state.section;
      var body = drawer.el.querySelector('.cf-drawer__body');
      var foot = drawer.el.querySelector('.cf-drawer__foot');
      body.onclick = null;
      // A section collected again starts from last time's answers.
      var start = entry ? entry.data : (!s.multiple && drawer.data.previous) || {};
      body.innerHTML = (s.once ? '<div class="cf-note" style="margin:0 0 14px">' + icon('lock', 16) + '<span>Once it’s submitted it can’t be changed.</span></div>' : '')
        + (!entry && !s.multiple && drawer.data.previous ? '<div class="cf-note" style="margin:0 0 14px">' + icon('info', 16) + '<span>Filled in with last time’s answers. Check them, then save.</span></div>' : '')
        + (entry && entry.savedBy ? '<p class="cf-card__sub" style="margin:0 0 14px">Last saved ' + esc(when(entry.updatedAt)) + ' by ' + esc(entry.savedBy) + '</p>' : '') + '<div data-form></div>';
      drawer.form = R.mount(body.querySelector('[data-form]'), s, {
        values: start,
        upload: function (file) {
          var fd = new FormData();
          fd.append('file', file);
          return fetch(base + '/' + s.id + '/upload', { method: 'POST', credentials: 'same-origin', headers: { Accept: 'application/json' }, body: fd })
            .then(function (res) { return res.json().then(function (j) { if (!res.ok || !j.success) throw new Error(j.error || 'Upload failed.'); return j.file; }); });
        }
      });
      foot.hidden = false;
      foot.innerHTML = (s.multiple ? '<button type="button" class="cf-btn" data-cancel>Back</button>' : '') + '<span class="cf-spacer"></span><span data-msg style="color:var(--cf-danger);font-size:13px;font-weight:600"></span><button type="button" class="cf-btn cf-btn--primary" data-save>' + (s.once ? 'Submit' : 'Save') + '</button>';
      foot.onclick = function (e) {
        if (e.target.closest('[data-cancel]')) return drawStudent();
        if (!e.target.closest('[data-save]')) return;
        if (drawer.form.validate().length) return;
        var btn = foot.querySelector('[data-save]');
        btn.disabled = true;
        btn.textContent = 'Saving…';
        api(base + '/' + s.id + '/student/' + drawer.studentId, { entryId: entry ? entry.id : null, values: drawer.form.values(), termId: termId || undefined }).then(function (res) {
          var list = drawer.data.entries.filter(function (x) { return !entry || x.id !== entry.id; });
          drawer.data.entries = [Object.assign({ savedBy: 'You', savedByType: 'staff' }, res.entry)].concat(list);
          toast(s.once ? 'Submitted.' : 'Saved.');
          refreshRow();
          if (s.multiple) drawStudent();
          else closeDrawer();
        }).catch(function (err) {
          btn.disabled = false;
          btn.textContent = s.once ? 'Submit' : 'Save';
          if (err.errors) drawer.form.showErrors(err.errors);
          foot.querySelector('[data-msg]').textContent = err.message;
        });
      };
    }
    function refreshRow() {
      var st = state.students.filter(function (x) { return x.id === drawer.studentId; })[0];
      if (!st) return;
      st.entries = drawer.data.entries.length;
      st.lastAt = drawer.data.entries[0] ? drawer.data.entries[0].updatedAt : null;
      st.lastBy = drawer.data.entries[0] ? drawer.data.entries[0].savedBy : '';
      if (state.quick.length) st.data = drawer.data.entries[0] ? drawer.data.entries[0].data : null;
      renderTable();
    }

    if (picks) picks.addEventListener('click', function (e) {
      var b = e.target.closest('[data-section]');
      if (b) choose(Number(b.getAttribute('data-section')));
    });
    pane.addEventListener('input', function (e) { if (e.target.hasAttribute('data-q')) { state.q = e.target.value; state.shown = PAGE; renderTable(); } });
    pane.addEventListener('change', function (e) {
      var sel = e.target.closest('select[data-quick]');
      if (!sel) return;
      var st = state.students.filter(function (x) { return x.id === Number(sel.closest('[data-student]').getAttribute('data-student')); })[0];
      var f = state.quick.filter(function (x) { return x.id === sel.getAttribute('data-quick'); })[0];
      if (!st || !f) return;
      var values = valuesOf(st);
      values[f.id] = sel.value === '' ? null : f.type === 'rating' ? Number(sel.value) : sel.value;
      quickSave(st, values);
    });
    pane.addEventListener('click', function (e) {
      if (e.target.closest('[data-more]')) { state.shown += 200; return renderTable(); }
      var view = e.target.closest('[data-view]');
      if (view) { state.view = view.getAttribute('data-view'); state.pick = 0; return renderTable(); }
      var grow = e.target.closest('[data-grow]');
      if (grow) { if (grow.getAttribute('data-grow') === 'row') state.addRows += 1; else state.addCols += 1; return renderTable(); }
      if (e.target.closest('[data-unseat]')) {
        var seated = state.students.filter(function (x) { return x.id === state.pick; })[0];
        if (seated) { var cleared = valuesOf(seated); cleared[seatField().id] = null; quickSave(seated, cleared); }
        state.pick = 0;
        return renderTable();
      }
      if (state.view === 'seats' && e.target.closest('.cf-seats')) return canQuick() ? seatClick(e.target) : undefined;
      if (state.view === 'groups' && e.target.closest('.cf-groupsbox')) return canQuick() ? groupClick(e.target) : undefined;
      // A tap answer in the row (Yes / No, buttons or icons).
      var tap = e.target.closest('.cf-pickset button');
      if (tap) {
        var holder = tap.closest('[data-quick]');
        var field = state.quick.filter(function (x) { return x.id === holder.getAttribute('data-quick'); })[0];
        var student = state.students.filter(function (x) { return x.id === Number(tap.closest('[data-student]').getAttribute('data-student')); })[0];
        if (!student || !field) return;
        var answers = valuesOf(student);
        var raw = tap.getAttribute('data-v');
        var want = field.type === 'yesno' ? raw === 'yes' : raw;
        answers[field.id] = answers[field.id] === want ? null : want; // tap again to clear
        quickSave(student, answers);
        return renderTable();
      }
      if (e.target.closest('select[data-quick]')) return; // answering in the row, not opening the student
      var remind = e.target.closest('[data-remind]');
      if (remind) {
        var waiting = state.students.filter(function (st) { return !st.entries; }).length;
        if (!waiting) { toast('Everyone has filled it in.'); return; }
        if (!window.confirm('Remind the families of ' + waiting + (waiting === 1 ? ' student' : ' students') + ' who haven’t filled it in? They get a notification and an email.')) return;
        remind.disabled = true;
        api(base + '/' + state.section.id + '/remind', { email: true }).then(function (res) {
          toast(res.sent ? 'Reminder sent to the families of ' + res.sent + (res.sent === 1 ? ' student.' : ' students.') : 'They were already reminded today.');
        }).catch(function (err) { toast(err.message, true); }).then(function () { remind.disabled = false; });
        return;
      }
      var row = e.target.closest('[data-student]');
      if (row) openStudent(Number(row.getAttribute('data-student')));
    });
    pane.addEventListener('keydown', function (e) {
      var row = e.target.closest('[data-student]');
      if (row && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); openStudent(Number(row.getAttribute('data-student'))); }
    });
    var sel = opts.selected || {};
    choose(sel.section && sections.some(function (s) { return s.id === sel.section; }) ? sel.section : sections[0].id, sel.student);
  }

  // The classroom tab and the driver portal: load the sections the first time it shows. Every
  // box on a page asking for the same list shares one request.
  var lists = {};
  function listOf(url) {
    if (!lists[url]) lists[url] = api(url).catch(function (err) { delete lists[url]; throw err; });
    return lists[url];
  }
  function autoMount(el) {
    if (el.__cfMounted) return;
    el.__cfMounted = true;
    var base = el.getAttribute('data-base') || '/common/forms';
    var classId = el.getAttribute('data-class-id') || '';
    var term = el.getAttribute('data-term-id') || '';
    var only = Number(el.getAttribute('data-only')) || 0;
    if (!el.firstChild) el.innerHTML = '<div class="cf-blank">Loading…</div>';
    listOf(base + '/data' + (classId ? '?classId=' + encodeURIComponent(classId) : '')).then(function (res) {
      // Its box was asked to show something else meanwhile.
      if ((Number(el.getAttribute('data-only')) || 0) !== only) return;
      var params = new URLSearchParams(location.search);
      var card = el.closest('[data-cf-card]');
      // One form by itself, or every form that has no place of its own.
      var sections = only ? res.sections.filter(function (s) { return s.id === only; })
        : el.hasAttribute('data-skip-tiles') ? res.sections.filter(function (s) { return !s.tile; }) : res.sections;
      // The driver portal shows a card only when there is a form for it.
      if (el.hasAttribute('data-hide-empty') && !sections.length) {
        if (card) card.hidden = true;
        return;
      }
      if (card) card.hidden = false;
      // A fresh box each time, so showing another form leaves nothing of the last one behind.
      var box = document.createElement('div');
      el.innerHTML = '';
      el.appendChild(box);
      mount(box, { base: base, classId: classId, termId: term, sections: sections, emptyText: el.getAttribute('data-empty') || '', selected: { section: Number(params.get('section')) || null, student: Number(params.get('student')) || null } });
    }).catch(function (err) { el.innerHTML = '<div class="cf-blank">' + esc(err.message) + '</div>'; });
  }
  // Show one form by itself in a box (0 = everything under Forms): the class page's menu items.
  function show(el, only) {
    var now = Number(el.getAttribute('data-only')) || 0;
    if (el.__cfMounted && now === (Number(only) || 0)) return;
    if (only) el.setAttribute('data-only', only); else el.removeAttribute('data-only');
    el.__cfMounted = false;
    el.__cfWatched = true;
    autoMount(el);
  }
  function watch() {
    Array.prototype.forEach.call(document.querySelectorAll('[data-cf-fill]'), function (el) {
      if (el.__cfWatched) return;
      el.__cfWatched = true;
      if (el.hasAttribute('data-eager') || !('IntersectionObserver' in window)) return autoMount(el);
      var io = new IntersectionObserver(function (items) {
        if (items.some(function (i) { return i.isIntersecting; })) { io.disconnect(); autoMount(el); }
      });
      io.observe(el);
    });
  }
  window.CustomFormsFill = { mount: mount, show: show };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', watch);
  else watch();
})();
