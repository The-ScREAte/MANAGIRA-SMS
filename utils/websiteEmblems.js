"use strict";

// School emblems for the website's emblem designs (Crest, Mascot, Orbit): mascots
// and school symbols drawn for Managira (original artwork on a 64 x 64 grid). On
// the website an emblem is a soft watermark in the school's color: a pattern
// across the page or one large emblem. A school can use its logo or its own
// image instead (utils/websiteExtras.js, section "emblem").

const n = (v) => Math.round(v * 100) / 100;
// Circle, ellipse and polygon outlines.
const C = (x, y, r) => `M${n(x - r)} ${n(y)}a${n(r)} ${n(r)} 0 1 0 ${n(2 * r)} 0a${n(r)} ${n(r)} 0 1 0 ${n(-2 * r)} 0Z`;
const E = (x, y, rx, ry) => `M${n(x - rx)} ${n(y)}a${n(rx)} ${n(ry)} 0 1 0 ${n(2 * rx)} 0a${n(rx)} ${n(ry)} 0 1 0 ${n(-2 * rx)} 0Z`;
const P = (...pts) => `M${pts.map(([x, y]) => `${n(x)} ${n(y)}`).join("L")}Z`;
const R = (x, y, w, h) => P([x, y], [x + w, y], [x + w, y + h], [x, y + h]);
// Mirror a point across the middle (x = 32).
const M = ([x, y]) => [64 - x, y];
// A shape that is the same on both sides: its left half, from the top middle down to the bottom middle.
const S = (half) => P(...half, ...half.slice().reverse().map(M));
// The same detail on both sides.
const both = (make) => make((p) => p) + make(M);
// A star or a jagged ring: points around a center.
function ring(cx, cy, outer, inner, points, turn = -90) {
  const pts = [];
  for (let i = 0; i < points * 2; i += 1) {
    const r = i % 2 ? inner : outer;
    const a = ((turn + (i * 180) / points) * Math.PI) / 180;
    pts.push([cx + r * Math.cos(a), cy + r * Math.sin(a)]);
  }
  return P(...pts);
}

// Each emblem is one or more layers: a filled shape with optional cut-outs
// (eyes, pages, stripes), plus optional lines (drawn with the same color).
const EMBLEMS = [
  // ---------- Mascots ----------
  {
    key: "lion", name: "Lion", group: "mascot",
    layers: [
      // A full mane around an open face; the eyes, nose and mouth are drawn in.
      { fill: ring(32, 33, 30.5, 23.5, 15), cut: "M32 14.5C41.5 14.5 48 21.5 48 31.5C48 42.5 41 51 32 55.5C23 51 16 42.5 16 31.5C16 21.5 22.5 14.5 32 14.5Z" },
      {
        fill: both((m) => P(m([20.5, 27.5]), m([28.5, 30.5]), m([27.2, 33.6]), m([22.2, 32]))) + "M26.5 38.2H37.5L32 45Z"
          + both((m) => "M" + m([32, 44.5]).join(" ") + "L" + m([33, 45.3]).join(" ") + "Q" + m([30.4, 50.4]).join(" ") + " " + m([26.2, 49.6]).join(" ") + "L" + m([26.6, 48.2]).join(" ") + "Q" + m([29.6, 48.8]).join(" ") + " " + m([32, 44.5]).join(" ") + "Z")
          + both((m) => P(m([16.5, 22]), m([21, 17]), m([22.5, 22.5]))),
      },
    ],
  },
  {
    key: "eagle", name: "Eagle", group: "mascot",
    layers: [
      {
        fill: S([[32, 7], [27.5, 9], [26, 15], [27, 21], [25, 24], [14, 18], [2, 11], [4, 17], [9, 20.5], [5, 23], [11, 26], [8, 30], [15, 31], [13, 35.5], [21, 35], [23, 41], [26, 49], [24, 59], [29, 55], [32, 60]]),
        cut: both((m) => C(...m([29.3, 14.2]), 1.5)) + P([30, 17.2], [34, 17.2], [32, 22]) + both((m) => P(m([22, 28]), m([30, 32]), m([24.5, 30.5]))),
      },
    ],
  },
  {
    key: "owl", name: "Owl", group: "mascot",
    layers: [
      {
        fill: S([[32, 14.5], [24, 13.5], [13, 4], [14.5, 15], [10.5, 23], [9.5, 35], [12, 45], [18, 54], [26, 59.5], [32, 61]]),
        cut: both((m) => C(...m([22.6, 29.5]), 8.2)) + P([32, 35.5], [29, 41], [32, 46], [35, 41])
          + both((m) => P(m([20, 47]), m([25, 50.5]), m([23, 51.5]), m([20, 49.5]))) + P([30, 51], [34, 51], [32, 54]),
      },
      { fill: both((m) => C(...m([23.2, 30]), 3.6)) },
    ],
  },
  {
    key: "bear", name: "Bear", group: "mascot",
    layers: [
      {
        fill: C(32, 36.5, 22.5) + C(14.5, 16, 8.6) + C(49.5, 16, 8.6),
        cut: C(14.5, 16, 4.1) + C(49.5, 16, 4.1) + E(32, 46.5, 11.2, 8.6) + both((m) => C(...m([23, 31.5]), 2.9)),
      },
      { fill: E(32, 42.6, 5.2, 3.7) + P([31, 45], [33, 45], [33, 49.5], [31, 49.5]) },
    ],
  },
  {
    key: "wolf", name: "Wolf", group: "mascot",
    layers: [
      {
        fill: S([[32, 20], [25.5, 18.5], [15, 3], [11.5, 22], [5.5, 33], [12, 38], [17.5, 48], [25.5, 53], [32, 61]]),
        cut: both((m) => P(m([24.5, 21]), m([16, 9]), m([14.5, 20]))) + both((m) => P(m([16, 32.5]), m([26, 31]), m([23.5, 35.5])))
          + P([32, 23.5], [35, 34], [32, 41], [29, 34]) + both((m) => P(m([12, 38.5]), m([22, 41]), m([25.5, 50]), m([18.5, 46.5]))),
      },
      { fill: P([28, 51], [36, 51], [32, 56]) },
    ],
  },
  {
    key: "fox", name: "Fox", group: "mascot",
    layers: [
      {
        fill: S([[32, 21], [24, 20], [12, 4], [10, 22], [4, 30], [11, 39], [20, 47], [27, 54], [32, 60]]),
        cut: both((m) => P(m([22.5, 21.5]), m([14, 10]), m([13, 21]))) + both((m) => P(m([5.5, 30.5]), m([24, 36]), m([30, 47]), m([22, 44]), m([12, 38])))
          + both((m) => P(m([18, 30]), m([26, 30.5]), m([24, 33.5]))),
      },
      { fill: P([28.5, 54], [35.5, 54], [32, 58.5]) },
    ],
  },
  {
    key: "bull", name: "Bull", group: "mascot",
    layers: [
      {
        fill: S([[32, 18], [23, 18], [15, 18], [6, 12], [2, 2], [3.5, 14], [9, 22], [18, 25], [8, 28], [17, 33], [20, 45], [23, 55], [28, 60], [32, 60]]),
        cut: both((m) => P(m([20, 33]), m([27, 34.5]), m([22.5, 37]))) + E(32, 52, 8.5, 5.2),
      },
      { fill: both((m) => C(...m([28.4, 52.4]), 1.9)) + S([[32, 24], [28, 26], [32, 29]]) },
    ],
  },
  {
    key: "wildcat", name: "Wildcat", group: "mascot",
    layers: [
      {
        fill: C(32, 37.5, 21.5) + both((m) => P(m([10.5, 30]), m([13, 3.5]), m([27, 17.5]))),
        cut: both((m) => P(m([14, 24]), m([15.5, 10]), m([23, 18]))) + both((m) => P(m([18.5, 31]), m([28, 33.8]), m([26.8, 37.2]), m([20.6, 36]))) + "M28.2 42.6H35.8L32 47.2Z"
          + both((m) => "M" + m([32, 46.8]).join(" ") + "Q" + m([29.6, 51.6]).join(" ") + " " + m([25.8, 49.4]).join(" ") + "L" + m([26.3, 48.3]).join(" ") + "Q" + m([29.6, 50]).join(" ") + " " + m([31.2, 46.8]).join(" ") + "Z"),
      },
      { fill: both((m) => P(m([23.4, 33.4]), m([24.6, 33.8]), m([24.3, 36.7]), m([23.1, 36.3]))) },
    ],
  },
  // ---------- School symbols ----------
  {
    key: "book", name: "Open book", group: "symbol",
    layers: [
      {
        fill: "M5 15.5C14 12 23 13 30.5 18.5V53C23 48.5 14 47.5 5 50.5ZM33.5 18.5C41 13 50 12 59 15.5V50.5C50 47.5 41 48.5 33.5 53Z"
          + "M3 52.5C13 49.5 23 50.5 32 56C41 50.5 51 49.5 61 52.5V56C51 53.5 41 54.5 32 60C23 54.5 13 53.5 3 56Z",
        cut: both((m) => P(m([10, 24]), m([25, 25.5]), m([25, 27.5]), m([10, 26]))) + both((m) => P(m([10, 31]), m([25, 32.5]), m([25, 34.5]), m([10, 33])))
          + both((m) => P(m([10, 38]), m([22, 39.2]), m([22, 41.2]), m([10, 40]))),
      },
    ],
  },
  {
    key: "cap", name: "Graduation cap", group: "symbol",
    layers: [
      { fill: P([32, 9], [62, 22.5], [32, 36], [2, 22.5]) + "M15 29V42C20 48 26 50.5 32 50.5S44 48 49 42V29L32 37Z" + R(55, 23.5, 2.6, 18) + C(56.3, 44.5, 3.4) },
    ],
  },
  { key: "star", name: "Star", group: "symbol", layers: [{ fill: ring(32, 34, 29, 12.2, 5) }] },
  {
    key: "oak", name: "Oak tree", group: "symbol",
    layers: [{ fill: C(32, 22, 15) + C(18.5, 28, 11) + C(45.5, 28, 11) + C(24, 15, 10) + C(40, 15, 10) + C(32, 33, 12) + P([28.5, 40], [35.5, 40], [37, 57], [42, 61], [22, 61], [27, 57]) }],
  },
  {
    key: "torch", name: "Torch", group: "symbol",
    layers: [
      {
        fill: "M32 3C39 10.5 43.5 16 41.5 24.5C40.3 29.5 36.5 32.5 32 32.5S23.7 29.5 22.5 24.5C20.5 16 25 10.5 32 3Z" + P([20, 35], [44, 35], [40, 43], [24, 43]) + P([28, 45], [36, 45], [34, 61], [30, 61]),
        cut: "M32 14C35.5 18.5 37 21.5 36 25.5C35.4 27.8 33.8 29 32 29S28.6 27.8 28 25.5C27 21.5 28.5 18.5 32 14Z",
      },
    ],
  },
  {
    key: "shield", name: "Shield", group: "symbol",
    layers: [
      {
        fill: "M32 4L55 12.5V30C55 44 45.5 54.5 32 61C18.5 54.5 9 44 9 30V12.5Z",
        cut: "M32 10L49.5 16.5V30C49.5 41 42.5 49.5 32 55C21.5 49.5 14.5 41 14.5 30V16.5Z",
      },
      { fill: ring(32, 32, 12.5, 5.2, 5) },
    ],
  },
  {
    key: "crown", name: "Crown", group: "symbol",
    layers: [
      {
        fill: P([7, 46], [10.5, 17], [23, 31], [32, 11], [41, 31], [53.5, 17], [57, 46]) + R(7, 49.5, 50, 7) + C(10.5, 14.5, 3.6) + C(32, 8.5, 3.6) + C(53.5, 14.5, 3.6),
        cut: both((m) => C(...m([20, 40]), 2.4)) + C(32, 38.5, 3.2),
      },
    ],
  },
  {
    key: "atom", name: "Atom", group: "symbol",
    layers: [{ fill: C(32, 32, 5.2) }],
    lines: '<g fill="none" stroke-width="3.6"><ellipse cx="32" cy="32" rx="27" ry="10.5"/><ellipse cx="32" cy="32" rx="27" ry="10.5" transform="rotate(60 32 32)"/><ellipse cx="32" cy="32" rx="27" ry="10.5" transform="rotate(-60 32 32)"/></g>',
  },
  {
    key: "bell", name: "Bell", group: "symbol",
    layers: [{ fill: "M32 8C23.5 8 18 14.5 18 24V36L11.5 45V49H52.5V45L46 36V24C46 14.5 40.5 8 32 8Z" + C(32, 54.5, 5) + C(32, 6.5, 3.2), cut: "M25 23C25.5 18 28 15.5 31 15V18C29.5 18.5 28 20.5 28 23Z" }],
  },
  {
    key: "lighthouse", name: "Lighthouse", group: "symbol",
    layers: [
      { fill: P([26, 22], [38, 22], [42.5, 58], [21.5, 58]) + R(25, 13, 14, 7) + P([22.5, 13], [32, 4.5], [41.5, 13]) + R(16, 58, 32, 4), cut: P([24.2, 31], [39.8, 31], [40.4, 36], [23.6, 36]) + P([23, 44], [41, 44], [41.6, 49], [22.4, 49]) },
      { fill: P([41, 15], [61, 10], [61, 21]) + P([23, 15], [3, 10], [3, 21]), opacity: 0.55 },
    ],
  },
  {
    key: "mountain", name: "Mountain", group: "symbol",
    layers: [{ fill: P([1, 56], [24, 16], [33.5, 32], [42, 22], [63, 56]), cut: P([24, 16], [29.5, 25.5], [26, 23], [24, 27], [21.5, 23.5], [18.5, 25.5]) + P([42, 22], [46.5, 29.5], [43.5, 28], [41, 31], [38, 28]) }],
  },
  {
    key: "anchor", name: "Anchor", group: "symbol",
    layers: [{ fill: C(32, 10, 6.5) + R(29, 15.5, 6, 41) + R(19, 21, 26, 5) + "M5 34L13 30L12.5 37C15 47 23 53.5 32 53.5S49 47 51.5 37L51 30L59 34C57 49 46 59.5 32 59.5S7 49 5 34Z", cut: C(32, 10, 3) }],
  },
];

const BY_KEY = new Map(EMBLEMS.map((e) => [e.key, e]));
const DEFAULT_EMBLEM = "shield";

// The emblem's drawing: mask definitions and shapes, ids starting with idPrefix
// (several copies of one emblem on a page each need their own).
function emblemParts(key, idPrefix, color) {
  const emblem = BY_KEY.get(key) || BY_KEY.get(DEFAULT_EMBLEM);
  const defs = [];
  const body = [];
  emblem.layers.forEach((layer, i) => {
    const opacity = layer.opacity != null ? ` opacity="${layer.opacity}"` : "";
    if (layer.cut) {
      const id = `${idPrefix}-${emblem.key}-${i}`;
      defs.push(`<mask id="${id}" maskUnits="userSpaceOnUse" x="0" y="0" width="64" height="64"><rect width="64" height="64" fill="#fff"/><path d="${layer.cut}" fill="#000"/></mask>`);
      body.push(`<path d="${layer.fill}" mask="url(#${id})"${opacity}/>`);
    } else {
      body.push(`<path d="${layer.fill}"${opacity}/>`);
    }
  });
  if (emblem.lines) body.push(emblem.lines.replace("<g ", `<g stroke="${color}" `));
  return { emblem, defs: defs.join(""), body: body.join("") };
}

// The emblem as SVG, in the color of the text around it unless given one.
function emblemSvg(key, { idPrefix = "em", color = "currentColor", title = "" } = {}) {
  const { defs, body } = emblemParts(key, idPrefix, color);
  const label = title ? `<title>${title}</title>` : "";
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" fill="${color}"${title ? ' role="img"' : ' aria-hidden="true" focusable="false"'}>${label}${defs ? `<defs>${defs}</defs>` : ""}${body}</svg>`;
}

// A data: link for CSS masks, in solid black (the page gives the color): the emblem
// alone, or a wallpaper tile with two small emblems set apart, for a soft pattern.
const dataUrl = (svg) => `data:image/svg+xml,${encodeURIComponent(svg)}`;
function emblemMaskUrl(key) {
  return dataUrl(emblemSvg(key, { color: "#000", idPrefix: "mk" }));
}
function emblemPatternUrl(key) {
  const a = emblemParts(key, "pa", "#000");
  const b = emblemParts(key, "pb", "#000");
  return dataUrl(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 120 120" fill="#000"><defs>${a.defs}${b.defs}</defs>`
    + `<g transform="translate(14 14) scale(.5)">${a.body}</g><g transform="translate(74 74) scale(.5)">${b.body}</g></svg>`);
}

module.exports = { EMBLEMS, DEFAULT_EMBLEM, emblemSvg, emblemMaskUrl, emblemPatternUrl, isEmblem: (key) => BY_KEY.has(key) };
