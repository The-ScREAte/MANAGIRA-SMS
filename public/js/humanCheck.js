// Checks that a public form is sent by a person (utils/humanCheck.js). A form opts in with
// data-human-check="<form name>": the page fetches a signed challenge, works it out in the
// background (a small proof of work, about a second) and puts the answer in a hidden field.
// Sending waits for it, and for the few seconds a person needs anyway. Forms sent by a script
// can ask for it: `await window.ManagiraHuman.ready(form)`.
(function () {
  if (window.ManagiraHuman) return;
  var MIN_MS = 3300; // a little over the server's three seconds
  var STALE_MS = 100 * 60 * 1000; // a challenge older than this is fetched again

  function hex(buffer) {
    var bytes = new Uint8Array(buffer), out = "";
    for (var i = 0; i < bytes.length; i += 1) out += (bytes[i] < 16 ? "0" : "") + bytes[i].toString(16);
    return out;
  }
  // The answer, in a background worker when the browser has one (the page never stutters).
  var WORKER = "self.onmessage=async function(e){var c=e.data,enc=new TextEncoder();for(var n=0;n<=c.maxnumber;n+=1){var h=await crypto.subtle.digest('SHA-256',enc.encode(c.salt+n));var b=new Uint8Array(h),s='';for(var i=0;i<b.length;i+=1)s+=(b[i]<16?'0':'')+b[i].toString(16);if(s===c.challenge){self.postMessage(n);return;}}self.postMessage(-1);};";
  function solve(c) {
    if (window.Worker && window.Blob && window.crypto && window.crypto.subtle) {
      try {
        return new Promise(function (resolve, reject) {
          var url = URL.createObjectURL(new Blob([WORKER], { type: "text/javascript" }));
          var worker = new Worker(url);
          worker.onmessage = function (e) { worker.terminate(); URL.revokeObjectURL(url); e.data >= 0 ? resolve(e.data) : reject(new Error("unsolved")); };
          worker.onerror = function () { worker.terminate(); URL.revokeObjectURL(url); solveHere(c).then(resolve, reject); };
          worker.postMessage(c);
        });
      } catch (error) { /* fall through to the page itself */ }
    }
    return solveHere(c);
  }
  function solveHere(c) {
    if (!(window.crypto && window.crypto.subtle)) return Promise.reject(new Error("no crypto"));
    var enc = new TextEncoder();
    return (async function () {
      for (var n = 0; n <= c.maxnumber; n += 1) {
        if (hex(await crypto.subtle.digest("SHA-256", enc.encode(c.salt + n))) === c.challenge) return n;
        if (n % 2000 === 0) await new Promise(function (r) { setTimeout(r, 0); });
      }
      throw new Error("unsolved");
    })();
  }

  function statusLine(form) {
    var line = form.querySelector("[data-human-status]");
    if (!line) {
      line = document.createElement("p");
      line.setAttribute("data-human-status", "");
      line.setAttribute("aria-live", "polite");
      line.style.cssText = "display:flex;align-items:center;gap:6px;margin:8px 0 0;font-size:12.5px;line-height:1.4;color:#667085;";
      var submit = form.querySelector("[type=submit]");
      if (submit && submit.parentNode && form.contains(submit.parentNode)) submit.parentNode.insertBefore(line, submit);
      else form.appendChild(line);
    }
    return line;
  }
  function say(form, state) {
    var line = statusLine(form);
    var dot = state === "ok" ? '<span aria-hidden="true" style="color:#12b76a;font-weight:700">✓</span>'
      : state === "error" ? '<span aria-hidden="true" style="color:#d92d20;font-weight:700">!</span>'
      : '<span aria-hidden="true" style="display:inline-block;width:10px;height:10px;border:2px solid #d0d5dd;border-top-color:#667085;border-radius:50%;animation:mh-spin .8s linear infinite"></span>';
    var words = state === "ok" ? "Verified: you're a person." : state === "error" ? "We couldn't check this browser. Refresh the page and try again." : "Checking you're a person…";
    line.innerHTML = dot + "<span></span>";
    line.lastChild.textContent = words;
  }
  if (!document.getElementById("mh-style")) {
    var style = document.createElement("style");
    style.id = "mh-style";
    style.textContent = "@keyframes mh-spin{to{transform:rotate(360deg)}}";
    document.head.appendChild(style);
  }

  function field(form) {
    var input = form.querySelector("input[name=human_proof]");
    if (!input) { input = document.createElement("input"); input.type = "hidden"; input.name = "human_proof"; form.appendChild(input); }
    return input;
  }
  function trap(form) {
    if (form.querySelector("input[name=website_url]")) return;
    var wrap = document.createElement("div");
    wrap.setAttribute("aria-hidden", "true");
    wrap.style.cssText = "position:absolute;left:-10000px;top:auto;width:1px;height:1px;overflow:hidden;";
    wrap.innerHTML = '<label>Leave this empty<input type="text" name="website_url" tabindex="-1" autocomplete="off"></label>';
    form.appendChild(wrap);
  }

  var states = new WeakMap();
  function start(form) {
    var state = states.get(form);
    if (state && state.promise && Date.now() - state.issuedAt < STALE_MS) return state.promise;
    state = { issuedAt: Date.now() };
    say(form, "busy");
    state.promise = fetch("/human-check/challenge?form=" + encodeURIComponent(form.getAttribute("data-human-check") || ""), { credentials: "same-origin", cache: "no-store" })
      .then(function (r) { if (!r.ok) throw new Error("challenge " + r.status); return r.json(); })
      .then(function (c) {
        state.issuedAt = Number(c.issuedAt) || Date.now();
        state.localStart = Date.now();
        return solve(c).then(function (number) {
          var proof = JSON.stringify({ salt: c.salt, challenge: c.challenge, number: number, issuedAt: c.issuedAt, signature: c.signature });
          field(form).value = proof;
          say(form, "ok");
          return proof;
        });
      })
      .catch(function (error) { say(form, "error"); states.delete(form); throw error; });
    states.set(form, state);
    return state.promise;
  }
  // The answer, once the form has been open long enough.
  function ready(form) {
    return start(form).then(function (proof) {
      var state = states.get(form);
      var wait = state && state.localStart ? MIN_MS - (Date.now() - state.localStart) : 0;
      return wait > 0 ? new Promise(function (r) { setTimeout(function () { r(proof); }, wait); }) : proof;
    });
  }

  function wire(form) {
    if (form.__humanCheck) return;
    form.__humanCheck = true;
    trap(form);
    field(form);
    start(form).catch(function () {});
    form.addEventListener("submit", function (event) {
      if (form.__humanSending) return; // the answer is in: let it go
      event.preventDefault();
      event.stopImmediatePropagation();
      var button = event.submitter || form.querySelector("[type=submit]");
      var label = button ? button.textContent : "";
      if (button) { button.disabled = true; button.textContent = "One moment…"; }
      ready(form).then(function () {
        form.__humanSending = true;
        if (button) { button.disabled = false; button.textContent = label; }
        if (form.requestSubmit) form.requestSubmit(button && button.form === form ? button : undefined); else form.submit();
        setTimeout(function () {
          form.__humanSending = false;
          // Each answer works once: a page that stays open (a form sent by a script) gets a new one.
          states.delete(form);
          start(form).catch(function () {});
        }, 0);
      }, function () {
        if (button) { button.disabled = false; button.textContent = label; }
      });
    }, true);
  }
  function wireAll() { document.querySelectorAll("form[data-human-check]").forEach(wire); }
  window.ManagiraHuman = {
    ready: function (form) { wire(form); return ready(form); },
    // After a form sent by a script went through: its answer is spent, so fetch the next one.
    renew: function (form) { states.delete(form); return start(form).catch(function () {}); },
    wire: wire,
  };
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", wireAll); else wireAll();
  window.addEventListener("spa:pageLoaded", wireAll);
})();
