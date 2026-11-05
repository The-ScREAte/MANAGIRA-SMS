(function () {
  'use strict';
  var root = document.querySelector('.tm-app');
  if (!root || root.dataset.studentsBound) return;
  root.dataset.studentsBound = '1';
  var panel = root.querySelector('#tm-student-panel');
  var form = panel.querySelector('form');
  var status = panel.querySelector('[role=status]');
  var list = root.querySelector('#tm-request-list');
  var data = JSON.parse(root.querySelector('#tm-student-options').textContent);
  var studentId, activeRow, lastFocus, history = false, selectionVersion = 0;
  function field(name) { return form.elements.namedItem(name); }
  function opt(select, value, label) { var o = document.createElement('option'); o.value = value; o.textContent = label; select.appendChild(o); }
  opt(field('busId'), '', 'Select bus');
  data.buses.forEach(function (b) { opt(field('busId'), b.bus_id, b.bus_number); });
  opt(field('stopId'), '', 'Select stop');
  data.stops.forEach(function (s) { opt(field('stopId'), s.stop_id, s.stop_name); });
  async function request(url, body) {
    var res = await fetch(url, { credentials:'same-origin', headers:{Accept:'application/json','Content-Type':'application/json'}, method:body ? 'POST' : 'GET', body:body ? JSON.stringify(body) : undefined });
    var result = await res.json();
    if (!res.ok || !result.ok) throw new Error(result.message || 'Unable to load transportation.');
    return result;
  }
  function close() { selectionVersion++; panel.hidden=true; lastFocus?.focus(); }
  function applyAccess() { field('busId').disabled = !field('access').checked; field('stopId').disabled = !field('access').checked; field('addressAsStop').disabled = !field('access').checked; }
  async function open(button) {
    var version = ++selectionVersion;
    studentId = Number(button.dataset.studentOpen); activeRow=button; lastFocus=button;
    panel.hidden=false; form.hidden=true; status.textContent='Loading…'; panel.querySelector('[data-close-student]').focus();
    try {
      var s = (await request('/transportation/manage/student/' + studentId)).student;
      if (version !== selectionVersion) return;
      panel.querySelector('h3').textContent=[s.last_name,s.first_name].filter(Boolean).join(' ');
      field('address').value=s.pickup_address || '';
      field('access').checked=s.access; field('busId').value=s.bus_id || ''; field('stopId').value=s.stop_id || ''; field('addressAsStop').checked=false;
      applyAccess(); form.hidden=false; status.textContent='';
    } catch(e) { if (version === selectionVersion) status.textContent=e.message; }
  }
  field('access').addEventListener('change',applyAccess);
  form.addEventListener('submit',async function(e) {
    e.preventDefault(); var button=form.querySelector('[type=submit]'); button.disabled=true; status.textContent='Saving…';
    try {
      var access=field('access').checked;
      await request('/transportation/manage/student',{studentId:studentId,address:field('address').value.trim(),access:access,addressAsStop:field('addressAsStop').checked,busId:field('busId').value ? Number(field('busId').value) : null,stopId:field('stopId').value ? Number(field('stopId').value) : null});
      var badge=activeRow.querySelector('.tm-student-access-tag'); badge.textContent=access?'Bus access':'No bus access'; badge.className='tm-student-access-tag tm-student-access-tag--'+(access?'yes':'no');
      var check=activeRow.parentElement.querySelector('[data-student-access-checkbox]'); check.checked=access; check.dataset.initialChecked=access?'1':'0';
      status.textContent='Transportation saved.';
    } catch(err) { status.textContent=err.message; } finally { button.disabled=false; }
  });
  function el(tag,text) { var n=document.createElement(tag); if(text) n.textContent=text; return n; }
  async function loadRequests() {
    list.replaceChildren(el('li','Loading…'));
    try {
      var result=await request('/transportation/manage/requests?history='+(history?'1':'0')); list.replaceChildren();
      if (!result.requests.length) list.appendChild(el('li',history?'No previous requests.':'No new requests.'));
      result.requests.forEach(function(q) {
        var row=el('li'); row.appendChild(el('strong',[q.last_name,q.first_name].join(' ')));
        row.appendChild(el('p',q.pickup_address)); row.appendChild(el('p',[q.route_name,q.stop_name].filter(Boolean).join(' · ')));
        row.appendChild(el('p',new Date(q.created_at).toLocaleDateString()+' · '+q.status));
        if (!history) {
          var actions=el('div'); actions.className='tm-request-actions'; var select=el('select'); select.setAttribute('aria-label','Bus for '+q.first_name); opt(select,'','Select bus');
          data.buses.forEach(function(b){opt(select,b.bus_id,b.bus_number);}); actions.appendChild(select);
          ['approved','declined'].forEach(function(decision){
            var b=el('button',decision==='approved'?'Approve':'Decline'); b.type='button'; b.className='tm-btn'+(decision==='approved'?' tm-btn--primary':'');
            b.addEventListener('click',async function(){
              var note=row.querySelector('[role=status]'); b.disabled=true;
              try { await request('/transportation/manage/requests/review',{requestId:q.request_id,decision:decision,busId:select.value?Number(select.value):null}); await loadRequests(); }
              catch(e){note.textContent=e.message; b.disabled=false;}
            }); actions.appendChild(b);
          }); row.appendChild(actions); var note=el('p'); note.setAttribute('role','status'); row.appendChild(note);
        } list.appendChild(row);
      });
    } catch(e){list.replaceChildren(el('li',e.message));}
  }
  root.addEventListener('click',function(e){
    var openButton=e.target.closest('[data-student-open]'); if(openButton) open(openButton);
    if(e.target.closest('[data-close-student]') || e.target===panel) close();
    var filter=e.target.closest('[data-request-history]'); if(filter){history=filter.dataset.requestHistory==='1'; root.querySelectorAll('[data-request-history]').forEach(function(b){b.setAttribute('aria-pressed',String(b===filter));}); loadRequests();}
    if(e.target.closest('.tm-nav-btn[data-pane=requests]')) loadRequests();
  });
  panel.addEventListener('keydown',function(e){
    if(e.key==='Escape')close();
    if(e.key==='Tab'){
      var items=Array.from(panel.querySelectorAll('button,input,select')).filter(function(x){return !x.disabled && x.getClientRects().length;});
      if(e.shiftKey && document.activeElement===items[0]){e.preventDefault();items[items.length-1].focus();}
      else if(!e.shiftKey && document.activeElement===items[items.length-1]){e.preventDefault();items[0].focus();}
    }
  });
})();