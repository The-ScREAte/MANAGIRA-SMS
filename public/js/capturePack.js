// Packs an interactive demo capture (public/js/demoCapture.js). A capture's views
// repeat almost all of their markup, so each view's body (and each page head) is
// cut into pieces where the 24 characters before a cut point hash to a marker:
// cuts fall in the same places in every view, and a change only touches the
// pieces around it. Pieces are stored once (data.pool); each view lists its own
// (state.parts) and each head its own (data.headParts).
// Used by the capture bar while recording and before uploading, and by the
// server for older captures.
(function (root) {
  "use strict";

  // Cut points: after ">" and after "&gt;" (a pane's markup sits escaped in its
  // iframe's srcdoc, where it has no ">" at all); past 8KB without either, any
  // character can end a piece, so long runs never become one huge piece.
  function splitMarkup(html) {
    const out = [];
    let start = 0;
    for (let i = 0; i < html.length; i++) {
      const len = i + 1 - start;
      if (len < 200) continue;
      const c = html.charCodeAt(i);
      const boundary = c === 62 || len >= 8192 ||
        (c === 59 && html.charCodeAt(i - 1) === 116 && html.charCodeAt(i - 2) === 103 && html.charCodeAt(i - 3) === 38);
      if (!boundary) continue;
      let h = 0;
      for (let j = Math.max(start, i - 24); j <= i; j++) h = (Math.imul(h, 31) + html.charCodeAt(j)) | 0;
      if ((h & 31) === 0 || len >= 65536) { out.push(html.slice(start, i + 1)); start = i + 1; }
    }
    if (start < html.length) out.push(html.slice(start));
    return out;
  }

  // Adds markup to a shared pool and returns its list of pieces.
  function createPacker() {
    const pool = [];
    const ids = new Map();
    return {
      pool,
      add(html) {
        return splitMarkup(String(html || "")).map((piece) => {
          let k = ids.get(piece);
          if (k === undefined) { k = pool.length; pool.push(piece); ids.set(piece, k); }
          return k;
        });
      },
    };
  }

  const join = (data, parts) => (parts || []).map((k) => data.pool[k]).join("");

  // A view's body / a head, packed or not.
  const bodyOf = (data, i) => (Array.isArray(data.pool) ? join(data, data.states[i].parts) : data.states[i].body);
  const headOf = (data, i) => (Array.isArray(data.headParts) ? join(data, data.headParts[i]) : data.heads[i]);

  // Drops pieces no view or head uses any more (after views were edited) and renumbers.
  function compact(data) {
    const used = new Map();
    const pool = [];
    const remap = (parts) => parts.map((k) => {
      let n = used.get(k);
      if (n === undefined) { n = pool.length; pool.push(data.pool[k]); used.set(k, n); }
      return n;
    });
    const headParts = data.headParts.map(remap);
    const states = data.states.map((st) => Object.assign({}, st, { parts: remap(st.parts) }));
    return Object.assign({}, data, { headParts, states, pool });
  }

  function pack(data) {
    if (Array.isArray(data.pool) && Array.isArray(data.headParts)) return compact(data);
    // Unpacked, or packed the older way (bodies only, larger pieces): pack afresh.
    const packer = createPacker();
    const heads = data.heads || [];
    const headParts = heads.map((h, i) => packer.add(headOf(data, i)));
    const states = data.states.map((st, i) => {
      const out = Object.assign({}, st, { parts: packer.add(bodyOf(data, i)) });
      delete out.body;
      return out;
    });
    const packed = Object.assign({}, data, { states, headParts, pool: packer.pool });
    delete packed.heads;
    return packed;
  }

  const api = { pack, compact, createPacker, splitMarkup, bodyOf, headOf };
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.ManagiraCapturePack = api;
})(typeof self !== "undefined" ? self : this);
