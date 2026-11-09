// A reply may only state figures that came from somewhere: a tool result, a
// message in the conversation, or the context Mira was given. This finds the
// figures in a reply that appear nowhere in that evidence, so the
// orchestrator can send the reply back once for correction before it stands.
//
// Small numbers (under 10) are left alone: they are everywhere (list items,
// "2 classes") and can't be told apart from real data. Rounding is allowed
// (a tool's 87.46 may be said as 87.5 or 87), and so are thousands
// separators and a trailing % or currency sign.

const FIGURE = /(?<![\w.])\d{1,3}(?:,\d{3})+(?:\.\d+)?(?![\w])|(?<![\w.])\d+(?:\.\d+)?(?![\w])/g;

function figuresIn(text) {
  return String(text || "")
    // Links and images: their addresses come from tools, never from the model's head.
    .replace(/\]\([^)]*\)/g, "]")
    .replace(/https?:\/\/\S+/g, " ")
    // List numbering ("1. ", "2) ") isn't data.
    .replace(/^\s*\d+[.)]\s+/gm, " ")
    .match(FIGURE) || [];
}

function toNumber(figure) {
  return Number(String(figure).replace(/,/g, ""));
}

function unsupportedFigures(reply, evidence) {
  const found = figuresIn(reply).filter((figure) => toNumber(figure) >= 10);
  if (!found.length) return [];
  const pool = (Array.isArray(evidence) ? evidence : [evidence]).map((part) => String(part || "")).join("\n");
  const known = new Set();
  const values = [];
  // Evidence is read loosely: every run of digits counts, so the day in a
  // timestamp like 2026-10-12T00:00:00Z backs up "October 12".
  (pool.match(/\d{1,3}(?:,\d{3})+(?:\.\d+)?|\d+(?:\.\d+)?/g) || []).forEach((figure) => {
    known.add(String(figure).replace(/,/g, ""));
    values.push(toNumber(figure));
  });
  const supported = (figure) => {
    const plain = String(figure).replace(/,/g, "");
    if (known.has(plain)) return true;
    const value = toNumber(figure);
    // Rounded from a figure the tools gave (to whole numbers or one decimal).
    return values.some((v) => Math.abs(v - value) <= (plain.includes(".") ? 0.05 : 0.5));
  };
  return [...new Set(found.filter((figure) => !supported(figure)))];
}

module.exports = { unsupportedFigures, figuresIn };
