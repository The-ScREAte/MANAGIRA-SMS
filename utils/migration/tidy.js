"use strict";
// Tidies what an old system exported before it reaches the sandbox and, from there, Managira:
// names typed all in capitals (or all in lower case) become "Ama Mensah", US phone numbers
// "(555) 123-4567", emails lower case, M / F "Male" / "Female", spaces collapsed. Anything
// already in mixed case, or not clearly one of these, is left exactly as it was typed.
const LOWER_WORDS = new Set(["de", "da", "del", "della", "der", "den", "di", "du", "la", "le", "van", "von", "y", "bin", "al"]);
const NUMERALS = new Set(["ii", "iii", "iv"]);

const squash = (v) => String(v === null || v === undefined ? "" : v).replace(/\s+/g, " ").trim();

function name(value) {
  const text = squash(value);
  if (!text || !/\p{L}/u.test(text)) return text;
  if (text !== text.toUpperCase() && text !== text.toLowerCase()) return text; // typed with care: kept
  return text.toLowerCase().split(" ").map((word, i) => {
    if (i > 0 && LOWER_WORDS.has(word)) return word;
    if (i > 0 && NUMERALS.has(word)) return word.toUpperCase();
    return word
      .replace(/(^|[-'’])(\p{L})/gu, (_m, before, letter) => before + letter.toUpperCase())
      .replace(/^(Mc)(\p{L})/u, (_m, prefix, letter) => prefix + letter.toUpperCase()); // McKenzie; "Mac" is left alone (Machado, Macias)
  }).join(" ");
}

// What an export writes where it has nothing: "n/a", "none", "000-000-0000".
const PLACEHOLDER = /^(n\/?a|na|none|no ?(email|phone)|unknown|null|nil|tbd|-+|\.+|x+|\?+)$/i;
function phone(value) {
  const text = squash(value);
  const bare = text.replace(/\D/g, "");
  if (PLACEHOLDER.test(text) || (bare.length >= 7 && /^(\d)\1+$/.test(bare))) return ""; // nothing to call
  if (/(x|ext\.?|#)\s*\d+$/i.test(text)) return text; // an extension: kept as typed
  const digits = text.replace(/\D/g, "");
  const us = digits.length === 11 && digits[0] === "1" ? digits.slice(1) : digits;
  if (us.length === 10 && !/^\+(?!1)/.test(text)) return `(${us.slice(0, 3)}) ${us.slice(3, 6)}-${us.slice(6)}`;
  return text;
}

// An email, or nothing: a placeholder or a value with no "@" can't be written to.
const email = (value) => { const text = squash(value).toLowerCase(); return PLACEHOLDER.test(text) || !text.includes("@") ? "" : text; };

function gender(value) {
  const text = squash(value);
  const key = text.toLowerCase();
  if (["m", "male", "boy"].includes(key)) return "Male";
  if (["f", "female", "girl"].includes(key)) return "Female";
  return text;
}

const KINDS = [
  [/^(first_name|last_name|middle_name|preferred_name|full_name|guardian\d_name)$/, name],
  [/(^|_)email$/, email],
  [/(^|_)phone$/, phone],
  [/^gender$/, gender],
  [/^state$/, (v) => (/^[a-z]{2}$/i.test(squash(v)) ? squash(v).toUpperCase() : squash(v))],
];
// Tidies a staged record's fields in place; returns how many values changed.
function record(entity, data) {
  if (!["students", "guardians", "staff"].includes(entity) || !data) return 0;
  let changed = 0;
  for (const [key, value] of Object.entries(data)) {
    if (typeof value !== "string") continue;
    const kind = KINDS.find(([rule]) => rule.test(key));
    if (!kind) continue;
    const tidy = kind[1](value);
    if (tidy !== value) { data[key] = tidy; changed += 1; }
  }
  return changed;
}

// The same person, however their name was typed: lower case, accents and spaces aside.
const key = (...parts) => parts.map((p) => squash(p).normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase()).join("|");

module.exports = { name, phone, email, gender, record, key, squash };
