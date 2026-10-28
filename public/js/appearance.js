// Gray and dark appearance for school pages (loaded only when the signed-in
// person picked one; white is the normal design). Every page keeps its own
// stylesheets; for each one this adds a screen-only copy of its color rules,
// placed right after it, with light backgrounds, dark text and light borders
// remapped. Inline styles are remapped too, and text that still ends up hard
// to read gets a readable color. Brand and status colors keep their hue.
// Prints and PDFs are untouched: the copies are screen-only and inline
// changes are undone while printing.
(function () {
  // Runs on this page, and on any other document handed in: the product tour's
  // player (public/js/appDemoPlayer.js) applies the look to captured pages,
  // which run no scripts of their own.
  function run(window, document) {
    const getComputedStyle = (el) => window.getComputedStyle(el);
    const root = document.documentElement;
    let MODE = root.getAttribute('data-appearance');
    if (MODE !== 'white' && MODE !== 'gray' && MODE !== 'dark') return;
    // A page shown inside another one (the hubs' panels) follows that page's light or dark.
    try {
      const up = window.parent !== window ? window.parent.document.documentElement.getAttribute('data-appearance') : null;
      if ((up === 'white' || up === 'gray' || up === 'dark') && up !== MODE) { MODE = up; root.setAttribute('data-appearance', MODE); }
    } catch (_e) { /* a page from another site */ }
    let DARK = MODE === 'dark';
    // White is the normal design: only text that is clearly hard to read is darkened.
    let WHITE = MODE === 'white';

    // ---------- color math (sRGB <-> OKLCH) ----------
    const ctx = document.createElement('canvas').getContext('2d');
    const parsed = new Map();
    const lin = (c) => { c /= 255; return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4); };
    const gam = (x) => { const v = x <= 0.0031308 ? 12.92 * x : 1.055 * Math.pow(x, 1 / 2.4) - 0.055; return v * 255; };
    function toLch(c) {
      const r = lin(c.r), g = lin(c.g), b = lin(c.b);
      const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
      const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
      const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
      const L = 0.2104542553 * l + 0.7936177850 * m - 0.0040720468 * s;
      const A = 1.9779984951 * l - 2.4285922050 * m + 0.4505937099 * s;
      const B = 0.0259040371 * l + 0.7827717662 * m - 0.8086757660 * s;
      return { L, C: Math.hypot(A, B), h: (Math.atan2(B, A) * 180 / Math.PI + 360) % 360, a: c.a };
    }
    function fromLch(L, C, h, a) {
      for (let i = 0; i < 24; i++) {
        const A = C * Math.cos(h * Math.PI / 180), B = C * Math.sin(h * Math.PI / 180);
        const l = Math.pow(L + 0.3963377774 * A + 0.2158037573 * B, 3);
        const m = Math.pow(L - 0.1055613458 * A - 0.0638541728 * B, 3);
        const s = Math.pow(L - 0.0894841775 * A - 1.2914855480 * B, 3);
        const r = gam(4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s);
        const g = gam(-1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s);
        const b = gam(-0.0041960863 * l - 0.7034186147 * m + 1.7076147010 * s);
        const inGamut = [r, g, b].every((v) => v >= -0.5 && v <= 255.5);
        if (inGamut || C < 0.001) return { r: clamp(r), g: clamp(g), b: clamp(b), a: a == null ? 1 : a };
        C *= 0.85; // pull chroma in until the color fits sRGB
      }
      return { r: 0, g: 0, b: 0, a: a == null ? 1 : a };
    }
    const clamp = (v) => Math.round(Math.max(0, Math.min(255, v)));
    const css = (c) => (c.a >= 1 ? `rgb(${c.r}, ${c.g}, ${c.b})` : `rgba(${c.r}, ${c.g}, ${c.b}, ${Math.round(c.a * 1000) / 1000})`);
    const lum = (c) => 0.2126 * lin(c.r) + 0.7152 * lin(c.g) + 0.0722 * lin(c.b);
    const ratio = (a, b) => { const x = lum(a), y = lum(b); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); };

    function parse(value) {
      const v = String(value || '').trim();
      if (!v) return null;
      if (parsed.has(v)) return parsed.get(v);
      let out = null;
      if (!/var\(|inherit|initial|unset|revert|currentcolor|attr\(/i.test(v)) {
        if (/^transparent$/i.test(v)) out = { r: 0, g: 0, b: 0, a: 0 };
        else {
          ctx.fillStyle = '#010203'; ctx.fillStyle = v; const one = ctx.fillStyle;
          ctx.fillStyle = '#030201'; ctx.fillStyle = v; const two = ctx.fillStyle;
          if (one === two) out = readCanvas(one);
        }
      }
      parsed.set(v, out);
      return out;
    }
    function readCanvas(s) {
      let m = s.match(/^#([0-9a-f]{6})$/i);
      if (m) return { r: parseInt(m[1].slice(0, 2), 16), g: parseInt(m[1].slice(2, 4), 16), b: parseInt(m[1].slice(4, 6), 16), a: 1 };
      m = s.match(/^rgba?\(([^)]+)\)$/i);
      if (m) { const p = m[1].split(/[\s,/]+/).filter(Boolean).map(Number); return { r: p[0], g: p[1], b: p[2], a: p[3] == null ? 1 : p[3] }; }
      m = s.match(/^color\(srgb\s+([^)]+)\)$/i);
      if (m) { const p = m[1].split(/[\s/]+/).filter(Boolean).map(Number); return { r: p[0] * 255, g: p[1] * 255, b: p[2] * 255, a: p[3] == null ? 1 : p[3] }; }
      m = s.match(/^oklch\(([^)]+)\)$/i);
      if (m) {
        const p = m[1].split(/[\s/]+/).filter(Boolean);
        const L = p[0].endsWith('%') ? parseFloat(p[0]) / 100 : parseFloat(p[0]);
        return fromLch(L, parseFloat(p[1]) || 0, parseFloat(p[2]) || 0, p[3] == null ? 1 : (p[3].endsWith('%') ? parseFloat(p[3]) / 100 : parseFloat(p[3])));
      }
      return null;
    }

    // ---------- the three remaps (each one leaves its own output unchanged) ----------
    // Light: crisp white surfaces and neutral lines. Classic: two calm greige tones (a
    // lighter one for cards and panels, one for the page). Dark: blue-gray planes.
    // Every remap maps its own output to itself, so a page looks the same however often
    // it is checked, and every page keeps the same proportions.
    const TINT_H = 255;
    const tint = (c, k) => (c.C < 0.012 ? { C: 0.008, h: TINT_H } : { C: Math.min(c.C, 0.06) * k, h: c.h });
    // Classic, three levels: warm-white cards and inputs (#fdfbf6), ivory panels (#f8f6ef),
    // a cream work area (#f2eee1). Every near-white lands on one of them, the same way on
    // every page (each level maps to itself).
    const CLASSIC_CARD = { r: 253, g: 251, b: 246 };
    const CLASSIC_PANEL = { r: 248, g: 246, b: 239 };
    const CLASSIC_PAGE = { r: 242, g: 238, b: 225 };
    function mapBg(c) {
      // Translucent fills (progress tracks, hover tints, overlays) adapt to whatever is
      // under them, so they keep their own color in every look.
      if (!c || c.a < 0.25) return null;
      const o = toLch(c);
      if (DARK) {
        if (o.L >= 0.8 && o.C <= 0.12) { const t = tint(o, 0.55); return fromLch(0.205 + (o.L - 0.8) * 0.25, t.C, t.h, c.a); }
        if (o.L >= 0.55 && o.C <= 0.035) { const t = tint(o, 1); return fromLch(0.31 + (o.L - 0.55) * 0.3, t.C, t.h, c.a); }
        return null;
      }
      if (o.L < 0.94 || o.C > 0.03) return null; // colors, pastels and darker grays keep theirs
      if (WHITE) return o.L >= 0.965 ? { r: 255, g: 255, b: 255, a: c.a } : fromLch(o.L, 0, 0, c.a);
      return Object.assign({}, o.L >= 0.982 ? CLASSIC_CARD : o.L >= 0.962 ? CLASSIC_PANEL : CLASSIC_PAGE, { a: c.a });
    }
    function mapText(c) {
      if (!c || c.a < 0.03 || !DARK) return null;
      const o = toLch(c);
      if (o.L > 0.62) return null;
      const t = o.C < 0.03 ? { C: 0.006, h: TINT_H } : { C: Math.min(o.C, 0.16), h: o.h };
      return fromLch(Math.max(0.7, 0.96 - o.L * 0.42), t.C, t.h, c.a);
    }
    function mapLine(c) {
      if (!c || c.a < 0.03) return null;
      const o = toLch(c);
      if (DARK) {
        if (o.L >= 0.7 && o.C <= 0.1) { const t = tint(o, 0.7); return fromLch(0.33 + (o.L - 0.7) * 0.25, t.C, t.h, c.a); }
        return null;
      }
      if (o.L < 0.85 || o.C > 0.06) return null;
      return fromLch(Math.min(o.L, WHITE ? 0.905 : 0.9), 0, 0, c.a); // crisp neutral lines
    }
    const COLOR_RE = /#[0-9a-f]{3,8}\b|(?:rgba?|hsla?|oklch|oklab|lab|lch|hwb|color)\([^()]*\)|\b(?:white|black|whitesmoke|gainsboro|ghostwhite|snow|ivory|aliceblue|azure|beige|linen|seashell|honeydew|mintcream|lavender|floralwhite|oldlace|lightgray|lightgrey|silver)\b/gi;
    // Split "a, b, c" at top-level commas (gradient layers, or stops inside one).
    function splitTop(v) {
      const out = [];
      let depth = 0, cur = '';
      for (const ch of v) {
        if (ch === '(') depth++;
        if (ch === ')') depth--;
        if (ch === ',' && depth === 0) { out.push(cur); cur = ''; } else cur += ch;
      }
      if (cur.trim()) out.push(cur);
      return out;
    }
    // Gradient layers: a solid layer has all its stops remapped; a layer that
    // fades out (a glow or highlight) only has its solid stops remapped, so a
    // soft white shine on a brand banner stays as it is.
    const mapGradient = (v) => {
      if (!/gradient\(/i.test(v)) return null;
      const layers = splitTop(v).map((layer) => {
        if (!/gradient\(/i.test(layer)) return layer;
        const fades = /\btransparent\b/i.test(layer) || (layer.match(COLOR_RE) || []).some((m) => { const c = parse(m); return c && c.a < 0.05; });
        return layer.replace(COLOR_RE, (m) => {
          const c = parse(m);
          if (!c || (fades && c.a < 0.9)) return m;
          const out = mapBg(c);
          return out ? css(out) : m;
        });
      });
      const out = layers.join(',');
      return out === v ? null : out;
    };

    // Values written with var() or color-mix(): work them out against the page's
    // own variables (only when every variable is set on the page), then remap.
    let probe = null;
    const resolved = new Map();
    function resolve(value, asImage) {
      const key = (asImage ? 'i:' : 'c:') + value;
      if (resolved.has(key)) return resolved.get(key);
      let out = null;
      const names = value.match(/var\(\s*(--[\w-]+)/g) || [];
      const rootStyle = getComputedStyle(root);
      const known = names.every((n) => rootStyle.getPropertyValue(n.replace(/var\(\s*/, '')).trim() !== '');
      if (known) {
        if (!probe) { probe = document.createElement('i'); probe.setAttribute('data-ap-skip', ''); probe.style.display = 'none'; root.appendChild(probe); }
        probe.style.cssText = 'display:none';
        if (asImage) probe.style.backgroundImage = value; else probe.style.color = value;
        if (asImage ? probe.style.backgroundImage : probe.style.color) {
          const cs = getComputedStyle(probe);
          out = asImage ? cs.backgroundImage : cs.color;
        }
      }
      resolved.set(key, out);
      return out;
    }
    const dynamic = (v) => /var\(|color-mix\(/i.test(v);
    const mapValue = (value, fn) => {
      const direct = fn(parse(value));
      if (direct) return direct;
      if (!dynamic(value)) return null;
      const r = resolve(value, false);
      return r ? fn(parse(r)) : null;
    };
    const mapImage = (value) => {
      const direct = /var\(/i.test(value) ? null : mapGradient(value);
      if (direct) return direct;
      if (!dynamic(value)) return null;
      const r = resolve(value, true);
      return r ? mapGradient(r) : null;
    };

    const BG = ['background-color'];
    const TEXT = ['color', 'fill', 'stroke', 'caret-color', 'text-decoration-color', '-webkit-text-fill-color'];
    const LINE = ['border-top-color', 'border-right-color', 'border-bottom-color', 'border-left-color', 'outline-color', 'column-rule-color'];
    const SHORT = ['background', 'border', 'border-color', 'border-top', 'border-right', 'border-bottom', 'border-left', 'outline'];
    const BRAND_VAR = /primary|brand|accent|org-|theme|success|danger|warning|error|info|highlight|gold|red|green|blue|teal/i;
    function mapVar(name, value) {
      const c = parse(value);
      if (!c) return null;
      const n = name.toLowerCase();
      if (/soft|tint|bg|background|surface|card|panel|plane|paper|canvas|fill|light|base|row|stripe|hover|head/.test(n) && !/text|ink|fg/.test(n)) return mapBg(c);
      if (/border|line|divider|outline|ring|rule|grid|separator/.test(n)) return mapLine(c);
      if (BRAND_VAR.test(n)) return null;
      if (/text|ink|fg|muted|heading|title|label|copy|body|color|dark/.test(n)) return mapText(c);
      const o = toLch(c);
      if (o.L >= 0.9 && o.C <= 0.05) return mapBg(c);
      return null;
    }

    // ---------- stylesheets: a remapped copy right after each one ----------
    const copies = new Map(); // owner node -> generated <style>
    function declarations(style) {
      const out = [];
      const bgRule = parse(style.getPropertyValue('background-color'));
      const bgKept = bgRule && bgRule.a > 0.5 && !mapBg(bgRule) && toLch(bgRule).L > 0.7; // e.g. a yellow button keeps its dark text
      const seen = new Set();
      for (let i = 0; i < style.length; i++) {
        const prop = style[i];
        const value = style.getPropertyValue(prop);
        const imp = style.getPropertyPriority(prop) ? ' !important' : '';
        if (!value) continue;
        let next = null;
        let relevant = false;
        if (prop.startsWith('--')) { next = mapVar(prop, value); relevant = !!next; }
        else if (BG.includes(prop)) { relevant = true; next = mapValue(value, mapBg); }
        else if (prop === 'background-image') { relevant = /gradient\(/i.test(value); next = relevant ? mapImage(value) : null; }
        else if (TEXT.includes(prop)) { relevant = true; next = bgKept ? null : mapValue(value, mapText); if (next) next = css(next); }
        else if (LINE.includes(prop)) { relevant = true; next = mapValue(value, mapLine); }
        if (!relevant) continue;
        if (next && typeof next === 'object') next = css(next);
        out.push(`${prop}: ${next || value}${imp}`);
        seen.add(prop);
      }
      // Shorthands still holding var(): repeat them unchanged so their order is kept.
      SHORT.forEach((p) => {
        const v = style.getPropertyValue(p);
        if (!v || !/var\(/i.test(v) || seen.has(p)) return;
        const imp = style.getPropertyPriority(p) ? ' !important' : '';
        // "background: <a color or gradients>" written with var(): work it out and remap.
        if (p === 'background' && !/url\(/i.test(v)) {
          if (/gradient\(/i.test(v)) {
            const img = mapImage(v);
            if (img) { out.push(`background: ${v}${imp}`, `background-image: ${img}${imp}`); return; }
          } else {
            const c = mapValue(v, mapBg);
            if (c) { out.push(`background: ${css(c)}${imp}`); return; }
          }
        }
        out.push(`${p}: ${v}${imp}`);
      });
      return out;
    }
    function rulesCss(rules) {
      let text = '';
      for (const rule of Array.from(rules || [])) {
        try {
          if (rule.type === 1) { // style rule
            const d = declarations(rule.style);
            if (d.length) text += `${rule.selectorText}{${d.join(';')}}\n`;
            if (rule.cssRules && rule.cssRules.length) { const inner = rulesCss(rule.cssRules); if (inner) text += `${rule.selectorText}{${inner}}\n`; }
          } else if (rule.type === 4) { // @media
            const inner = rulesCss(rule.cssRules);
            if (inner && !/^\s*print\s*$/i.test(rule.conditionText || rule.media.mediaText)) text += `@media ${rule.conditionText || rule.media.mediaText}{${inner}}\n`;
          } else if (rule.type === 12) { // @supports
            const inner = rulesCss(rule.cssRules);
            if (inner) text += `@supports ${rule.conditionText}{${inner}}\n`;
          } else if (rule.type === 3) { // @import
            if (rule.styleSheet) text += rulesCss(rule.styleSheet.cssRules);
          } else if (rule.cssRules && !(rule.type === 7)) { // @layer, @container and friends (not keyframes)
            text += rulesCss(rule.cssRules);
          }
        } catch (_e) { /* skip anything unreadable */ }
      }
      return text;
    }
    function skipOwner(node) {
      if (!node || node.hasAttribute('data-ap-copy')) return true;
      if (node.tagName === 'LINK' && /\/css\/appearance\.css/.test(node.getAttribute('href') || '')) return true;
      if (node.hasAttribute('data-ap-base')) return true; // appearance.css inlined into a demo capture
      return false;
    }
    function copySheet(owner) {
      if (skipOwner(owner) || !owner.isConnected) return;
      const sheet = owner.sheet;
      if (!sheet) return;
      let rules;
      try { rules = sheet.cssRules; } catch (_e) { return; } // another site's stylesheet
      const media = (sheet.media && sheet.media.mediaText) || '';
      if (media && /print/i.test(media) && !/screen|all/i.test(media)) return;
      let text = rulesCss(rules);
      if (media && !/^(all|screen)$/i.test(media.trim())) text = text ? `@media ${media}{${text}}` : '';
      const old = copies.get(owner);
      if (!text) { if (old) { old.remove(); copies.delete(owner); } return; }
      if (old && old.textContent === text) return;
      const style = old || document.createElement('style');
      style.setAttribute('data-ap-copy', '');
      style.media = 'screen';
      style.textContent = text;
      if (!old || style.previousSibling !== owner) owner.after(style);
      copies.set(owner, style);
    }
    function copyAll(scope) {
      (scope || document).querySelectorAll('style:not([data-ap-copy]), link[rel~="stylesheet"]').forEach((node) => {
        if (node.tagName === 'LINK' && !node.sheet) { node.addEventListener('load', () => quiet(() => { copySheet(node); dropOrphans(); settle(document.body); }), { once: true }); return; }
        copySheet(node);
      });
    }
    function dropOrphans() {
      copies.forEach((style, owner) => { if (!owner.isConnected) { style.remove(); copies.delete(owner); } });
    }

    // ---------- inline styles ----------
    const changed = new Map(); // element -> { prop: [value, priority] } for undoing while printing
    window.__apChanged = changed; // a demo capture saves the page's own colors (public/js/demoCapture.js)
    function remember(el, prop) {
      let saved = changed.get(el);
      if (!saved) { saved = {}; changed.set(el, saved); }
      if (!(prop in saved)) saved[prop] = [el.style.getPropertyValue(prop), el.style.getPropertyPriority(prop)];
    }
    function setStyle(el, prop, value, priority) {
      if (el.style.getPropertyValue(prop) === value && el.style.getPropertyPriority(prop) === (priority || '')) return;
      remember(el, prop);
      el.style.setProperty(prop, value, priority || '');
    }
    // Put an element's own inline colors back (before printing, or when its class changes).
    function restore(el) {
      const saved = changed.get(el);
      if (!saved) return;
      Object.keys(saved).forEach((prop) => {
        const [v, p] = saved[prop];
        if (v) el.style.setProperty(prop, v, p); else el.style.removeProperty(prop);
      });
      changed.delete(el);
    }
    function fixInline(el) {
      const st = el.style;
      if (!st || !st.length) return;
      if (el.closest('[data-ap-skip]')) return; // e.g. light/dark previews that must show their real colors
      const bgKept = (() => { const c = parse(st.backgroundColor); return c && c.a > 0.5 && !mapBg(c) && toLch(c).L > 0.7; })();
      for (const prop of BG) { const c = mapBg(parse(st.getPropertyValue(prop))); if (c) setStyle(el, prop, css(c), st.getPropertyPriority(prop)); }
      const g = st.getPropertyValue('background-image');
      if (g) { const next = mapGradient(g); if (next && next !== g) setStyle(el, 'background-image', next, st.getPropertyPriority('background-image')); }
      if (!bgKept) for (const prop of TEXT) { const c = mapText(parse(st.getPropertyValue(prop))); if (c) setStyle(el, prop, css(c), st.getPropertyPriority(prop)); }
      for (const prop of LINE) { const c = mapLine(parse(st.getPropertyValue(prop))); if (c) setStyle(el, prop, css(c), st.getPropertyPriority(prop)); }
      for (let i = 0; i < st.length; i++) {
        const prop = st[i];
        if (!prop.startsWith('--')) continue;
        const c = mapVar(prop, st.getPropertyValue(prop));
        if (c) setStyle(el, prop, css(c), st.getPropertyPriority(prop));
      }
    }
    function fixInlineIn(scope) {
      if (scope.nodeType === 1 && scope.hasAttribute('style')) fixInline(scope);
      if (scope.querySelectorAll) scope.querySelectorAll('[style]').forEach(fixInline);
    }

    // ---------- colors the stylesheet copies can't see (var() and color-mix()) ----------
    // Read what the browser worked out for each element and remap what is still light.
    const SKIP_TAGS = new Set(['IMG', 'SVG', 'CANVAS', 'VIDEO', 'IFRAME', 'PICTURE', 'SCRIPT', 'STYLE', 'NOSCRIPT', 'TEMPLATE', 'OPTION']);
    const SKIP_SEL = 'svg, canvas, video, [data-ap-skip]';
    const SIDES = ['top', 'right', 'bottom', 'left'];
    const elementsOf = (scope) => (scope.nodeType === 1 ? [scope, ...scope.querySelectorAll('*')] : Array.from(scope.querySelectorAll('body *')));
    // A control under the pointer, pressed or focused shows its passing look
    // (a hover fill, a focus ring). Colors read then would stay after it ends,
    // e.g. a tab clicked in Classic kept the hover's white text on a light
    // background. Such a control is read once it is back at rest.
    const CONTROL_SEL = 'button, a, [role="button"], [role="tab"], summary, label, input, select, textarea';
    function busyControl(el) {
      const c = el.closest(CONTROL_SEL);
      if (!c || !c.matches(':hover, :active, :focus')) return null;
      if (!c.__apLater) {
        c.__apLater = true;
        const later = () => {
          if (c.matches(':hover, :active, :focus')) return;
          c.removeEventListener('pointerleave', later);
          c.removeEventListener('focusout', later);
          c.__apLater = false;
          setTimeout(() => { if (c.isConnected) quiet(() => settle(c)); }, 0);
        };
        c.addEventListener('pointerleave', later);
        c.addEventListener('focusout', later);
      }
      return c;
    }

    function fixSurfaces(scope) {
      const writes = [];
      for (const el of elementsOf(scope)) {
        if (SKIP_TAGS.has(el.tagName) || el.closest(SKIP_SEL) || busyControl(el)) continue;
        const s = getComputedStyle(el);
        const bg = mapBg(parse(s.backgroundColor));
        if (bg) writes.push([el, 'background-color', css(bg)]);
        const img = s.backgroundImage;
        if (img && img !== 'none' && !/url\(/i.test(img)) { const g = mapGradient(img); if (g) writes.push([el, 'background-image', g]); }
        for (const side of SIDES) {
          if (s.getPropertyValue(`border-${side}-width`) === '0px' || s.getPropertyValue(`border-${side}-style`) === 'none') continue;
          const line = mapLine(parse(s.getPropertyValue(`border-${side}-color`)));
          if (line) writes.push([el, `border-${side}-color`, css(line)]);
        }
      }
      writes.forEach(([el, prop, value]) => setStyle(el, prop, value, 'important'));
      if (!DARK) liftCards(scope);
    }

    // ---------- Light and Classic: cards and panels lift off the page with a soft shadow ----------
    // A bordered, rounded, light box of some size with no shadow of its own is a card; one
    // inside a card already lifted stays flat, so nothing doubles up.
    const CARD_SHADOW = '0 1px 2px rgba(16, 24, 40, 0.05), 0 4px 16px rgba(16, 24, 40, 0.06)';
    function liftCards(scope) {
      for (const el of elementsOf(scope)) {
        if (SKIP_TAGS.has(el.tagName) || /^(INPUT|SELECT|TEXTAREA|BUTTON|A|LABEL|TD|TH|TR|LI|SUMMARY|HEADER|NAV)$/.test(el.tagName) || el.closest(SKIP_SEL)) continue;
        if (el.parentElement && el.parentElement.closest('[data-ap-card]')) continue;
        const s = getComputedStyle(el);
        if (s.boxShadow !== 'none' || s.position === 'fixed' || parseFloat(s.borderTopWidth) < 0.5 || parseFloat(s.borderTopLeftRadius) < 6) continue;
        const bg = parse(s.backgroundColor);
        if (!bg || bg.a < 0.9 || toLch(bg).L < 0.93) continue;
        const r = el.getBoundingClientRect();
        if (r.width < 160 || r.height < 56) continue;
        el.setAttribute('data-ap-card', '');
        setStyle(el, 'box-shadow', CARD_SHADOW, 'important');
      }
    }

    // ---------- last check: text that is still hard to read ----------
    const page = () => parse(getComputedStyle(document.body).backgroundColor) || (DARK ? { r: 24, g: 26, b: 30, a: 1 } : { r: 228, g: 230, b: 234, a: 1 });
    function backgroundOf(el, memo) {
      const trail = [];
      let found = null;
      for (let node = el; node && node.nodeType === 1; node = node.parentElement) {
        if (memo.has(node)) { found = memo.get(node); break; }
        trail.push(node);
        const s = getComputedStyle(node);
        const c = parse(s.backgroundColor);
        if (c && c.a > 0.6) { found = c; break; }
        const img = s.backgroundImage;
        if (img && img !== 'none') {
          const layers = splitTop(img);
          const base = layers[layers.length - 1] || '';
          if (/url\(/i.test(base)) { found = 'image'; break; }
          const first = (base.match(COLOR_RE) || [])[0];
          const fc = first && parse(first);
          if (fc && fc.a > 0.6) { found = fc; break; }
        }
      }
      if (!found) found = page();
      trail.forEach((n) => memo.set(n, found));
      return found;
    }
    function readable(color, bg) {
      const o = toLch(color);
      const darkBg = lum(bg) < 0.2;
      for (let i = 1; i <= 20; i++) {
        const L = darkBg ? Math.min(0.98, o.L + (0.98 - o.L) * (i / 20)) : Math.max(0.12, o.L - (o.L - 0.12) * (i / 20));
        const next = fromLch(L, Math.min(o.C, 0.14), o.h, 1);
        if (ratio(next, bg) >= 4.5) return next;
      }
      return darkBg ? { r: 245, g: 246, b: 248, a: 1 } : { r: 17, g: 24, b: 39, a: 1 };
    }
    function hasText(el) {
      for (const n of el.childNodes) if (n.nodeType === 3 && n.nodeValue.trim()) return true;
      return false;
    }
    function checkContrast(scope) {
      const memo = new Map();
      const writes = [];
      for (const el of elementsOf(scope)) {
        if (el.closest('svg, canvas, [data-ap-skip], script, style, noscript, template')) continue;
        const isField = /^(INPUT|SELECT|TEXTAREA|BUTTON)$/.test(el.tagName);
        const isIcon = el.tagName === 'I' && /\bfa-/.test(el.className || '');
        if (!isField && !isIcon && !hasText(el)) continue;
        if (busyControl(el)) continue;
        const s = getComputedStyle(el);
        if (s.visibility === 'hidden' || s.display === 'none') continue;
        const fill = s.webkitTextFillColor;
        const color = parse(fill && fill !== s.color && parse(fill) && parse(fill).a > 0 ? fill : s.color);
        if (!color || color.a < 0.35) continue;
        const bg = backgroundOf(el, memo);
        if (bg === 'image') continue;
        // Light and Classic: gray text on a light, calm background reads as near-black (crisp, not faded).
        if (!DARK && !isIcon) {
          const t = toLch(color), b = toLch(bg);
          if (t.C < 0.065 && t.L > 0.3 && t.L < 0.8 && b.L > 0.85 && b.C < 0.05) { // grays, slate grays included
            const ink = css(fromLch(0.17 + (t.L - 0.3) * 0.12, 0, 0, 1));
            writes.push([el, 'color', ink]);
            if (fill && fill !== s.color) writes.push([el, '-webkit-text-fill-color', ink]);
            continue;
          }
        }
        // Brand and status fills keep their designed text (white on a brand button);
        // only text that is truly hard to read there is changed.
        const branded = toLch(bg).C > 0.08;
        const target = branded ? 2.4 : (WHITE || isIcon ? 3 : 4.5);
        const now = ratio(color, bg);
        if (now >= target - 0.01) continue;
        let better;
        if (branded) {
          const white = { r: 255, g: 255, b: 255, a: 1 }, ink = { r: 17, g: 24, b: 39, a: 1 };
          better = css(ratio(white, bg) >= ratio(ink, bg) ? white : ink);
        } else better = css(readable(color, bg));
        writes.push([el, 'color', better]);
        if (fill && fill !== s.color) writes.push([el, '-webkit-text-fill-color', better]);
      }
      writes.forEach(([el, prop, value]) => setStyle(el, prop, value, 'important'));
    }
    // Transitions are paused while reading, so colors are read as they end up, not mid-animation.
    let stillFrame = 0;
    function settle(scope) {
      root.classList.add('ap-still');
      fixSurfaces(scope);
      checkContrast(scope);
      if (!stillFrame) stillFrame = requestAnimationFrame(() => requestAnimationFrame(() => { stillFrame = 0; quiet(() => root.classList.remove('ap-still')); }));
    }

    // ---------- brand color: very dark brands are lifted a little on dark pages ----------
    function liftBrand() {
      if (!DARK) return;
      const c = parse(getComputedStyle(root).getPropertyValue('--org-primary-color'));
      if (!c) return;
      const o = toLch(c);
      if (o.L >= 0.42) return;
      const up = fromLch(0.5, Math.max(o.C, 0.02), o.h, 1);
      root.style.setProperty('--org-primary-color', css(up));
      root.style.setProperty('--org-primary-hover', css(fromLch(0.45, Math.max(o.C, 0.02), o.h, 1)));
    }

    // ---------- charts ----------
    function charts() {
      const C = window.Chart;
      if (WHITE || !C || !C.defaults) return;
      const text = DARK ? '#cbd2dc' : '#374151';
      const grid = DARK ? 'rgba(255,255,255,0.08)' : 'rgba(15,23,42,0.08)';
      C.defaults.color = text;
      C.defaults.borderColor = grid;
      if (typeof C.getChart === 'function') {
        document.querySelectorAll('canvas').forEach((cv) => {
          const chart = C.getChart(cv);
          if (!chart) return;
          Object.values(chart.options.scales || {}).forEach((sc) => { if (sc.ticks) sc.ticks.color = text; if (sc.grid) sc.grid.color = grid; });
          const legend = chart.options.plugins && chart.options.plugins.legend;
          if (legend && legend.labels) legend.labels.color = text;
          chart.update('none');
        });
      }
    }

    // ---------- run ----------
    let busy = false;
    let observer = null;
    // Our own changes must not wake the observer again.
    function quiet(fn) {
      busy = true;
      try { fn(); } finally { if (observer) observer.takeRecords(); busy = false; }
    }
    function pass(scopes) {
      quiet(() => {
        dropOrphans();
        copyAll(document);
        (scopes || [document.body]).forEach(fixInlineIn);
      });
    }
    // Pages designed dark (the marketing homepage) keep their own look: Light and
    // Classic are for light pages. Read the page's own background without ours.
    function designedDark() {
      root.setAttribute('data-appearance', 'none');
      const own = [document.body, root].map((n) => parse(getComputedStyle(n).backgroundColor)).find((c) => c && c.a > 0.5);
      root.setAttribute('data-appearance', MODE);
      return Boolean(own) && toLch(own).L < 0.5;
    }

    let passive = false; // a page designed dark: left exactly as it is
    function start() {
      if (!DARK && designedDark()) {
        passive = true;
        root.setAttribute('data-appearance', 'none');
        root.classList.add('ap-ready');
        return;
      }
      liftBrand();
      pass();
      quiet(() => settle(document.body));
      root.classList.add('ap-ready');
      charts();

      observer = new MutationObserver((records) => {
        if (busy) return;
        const touched = new Set();
        const recolor = new Set();
        let sheetsChanged = false;
        for (const r of records) {
          const t = r.target;
          if (r.type === 'attributes') {
            if (t.nodeType !== 1 || t === root) continue;
            // A class change can switch the colors of the element and everything inside it
            // (an active menu link and its label): start again from their real styles.
            if (r.attributeName === 'class') recolor.add(t);
            touched.add(t);
            continue;
          }
          if (t.nodeType === 1 && t.tagName === 'STYLE' && !t.hasAttribute('data-ap-copy')) sheetsChanged = true;
          r.addedNodes.forEach((n) => {
            if (n.nodeType !== 1 || n.hasAttribute('data-ap-copy')) return;
            if (n.tagName === 'STYLE' || n.tagName === 'LINK' || (n.querySelector && n.querySelector('style, link[rel~="stylesheet"]'))) sheetsChanged = true;
            if (n.tagName !== 'STYLE' && n.tagName !== 'LINK' && n.tagName !== 'SCRIPT') touched.add(n);
          });
          if (r.removedNodes.length) sheetsChanged = true;
        }
        if (!touched.size && !sheetsChanged) return;
        // Fixed before the next paint, so nothing flashes light.
        quiet(() => {
          if (sheetsChanged) { dropOrphans(); copyAll(document); }
          if (recolor.size) changed.forEach((_, el) => { for (let up = el; up; up = up.parentElement) if (recolor.has(up)) { restore(el); break; } });
          const roots = Array.from(touched).filter((n) => {
            if (!n.isConnected) return false;
            for (let up = n.parentElement; up; up = up.parentElement) if (touched.has(up)) return false;
            return true;
          });
          roots.forEach((n) => { fixInlineIn(n); settle(n); });
          if (sheetsChanged && !roots.length) settle(document.body);
        });
      });
      observer.observe(document.documentElement, { childList: true, subtree: true, attributes: true, attributeFilter: ['style', 'class'] });

      window.addEventListener('load', () => { pass(); quiet(() => settle(document.body)); charts(); }, { once: true });
      window.addEventListener('spa:pageLoaded', () => { pass(); quiet(() => settle(document.body)); charts(); });

      // Printing: put inline colors back (the remapped stylesheets are screen-only).
      let printed = [];
      window.addEventListener('beforeprint', () => quiet(() => {
        printed = Array.from(changed.keys());
        printed.forEach(restore);
        root.style.removeProperty('--org-primary-color');
        root.style.removeProperty('--org-primary-hover');
      }));
      window.addEventListener('afterprint', () => {
        quiet(() => { liftBrand(); printed.forEach((el) => { if (el.isConnected) fixInline(el); }); settle(document.body); });
        printed = [];
      });
    }

    // Colors again for content shown without a class or style change (the demo player's expanders).
    window.__apRefresh = function () { if (observer) quiet(() => settle(document.body)); };

    // Light, Classic and Dark in place (the header menu and the settings picker), so
    // the page doesn't load again: undo every change, then run in the new mode.
    // Pages shown inside this one change with it.
    window.__apSetMode = function (next) {
      if (next !== 'white' && next !== 'gray' && next !== 'dark') return;
      if (next !== MODE && !passive) {
        quiet(() => {
          root.classList.add('ap-still');
          changed.forEach((_, el) => restore(el));
          document.querySelectorAll('[data-ap-card]').forEach((el) => el.removeAttribute('data-ap-card'));
          copies.forEach((style) => style.remove());
          copies.clear();
          resolved.clear();
          root.style.removeProperty('--org-primary-color');
          root.style.removeProperty('--org-primary-hover');
          MODE = next; DARK = MODE === 'dark'; WHITE = MODE === 'white';
          root.setAttribute('data-appearance', MODE);
        });
        liftBrand();
        pass();
        quiet(() => settle(document.body));
        charts();
        window.dispatchEvent(new CustomEvent('ap:mode', { detail: MODE }));
      }
      document.querySelectorAll('iframe').forEach((frame) => {
        try { if (frame.contentWindow && typeof frame.contentWindow.__apSetMode === 'function') frame.contentWindow.__apSetMode(next); } catch (_e) { /* another site */ }
      });
    };

    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start, { once: true });
    else start();
  }

  window.__apRun = run;
  run(window, document);
})();
