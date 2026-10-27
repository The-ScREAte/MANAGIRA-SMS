// Packs an interactive demo capture (public/js/demoCapture.js). A capture's views
// repeat almost all of their markup, so each view's body is cut into pieces after
// a ">" where the 24 characters before it hash to a marker: cuts fall in the same
// places in every view, and a change only touches the pieces around it. Pieces are
// stored once (data.pool) and each view lists its own (state.parts).
// Used by the capture bar before uploading and by the server for older captures.
(function (root) {
  "use strict";

  function splitMarkup(html) {
    const out = [];
    let start = 0;
    for (let i = 0; i < html.length; i++) {
      if (html.charCodeAt(i) !== 62) continue; // ">"
      const len = i + 1 - start;
      if (len < 200) continue;
      let h = 0;
      for (let j = Math.max(start, i - 24); j <= i; j++) h = (Math.imul(h, 31) + html.charCodeAt(j)) | 0;
      if ((h & 31) === 0 || len >= 8192) { out.push(html.slice(start, i + 1)); start = i + 1; }
    }
    if (start < html.length) out.push(html.slice(start));
    return out;
  }

  function pack(data) {
    if (Array.isArray(data.pool)) return data;
    const pool = [];
    const ids = new Map();
    const idOf = (piece) => {
      let k = ids.get(piece);
      if (k === undefined) { k = pool.length; pool.push(piece); ids.set(piece, k); }
      return k;
    };
    const states = data.states.map((st) => {
      const out = Object.assign({}, st, { parts: splitMarkup(st.body).map(idOf) });
      delete out.body;
      return out;
    });
    return Object.assign({}, data, { states, pool });
  }

  // A view's body, packed or not.
  const bodyOf = (data, i) => (Array.isArray(data.pool) ? data.states[i].parts.map((k) => data.pool[k]).join("") : data.states[i].body);

  const api = { pack, bodyOf };
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.ManagiraCapturePack = api;
})(typeof self !== "undefined" ? self : this);
