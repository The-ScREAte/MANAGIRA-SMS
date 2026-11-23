// The last step before a reply reaches the person (enforced in code, whatever the model wrote):
// no tool names, no raw record IDs, no emojis. Runs after the accuracy checks, so it only ever
// takes away; it never adds a fact.
//
// - Tool names ("get_class", `find_low_attendance`) become plain words ("get class").
// - Raw IDs go: "student ID 10142", "(class_id: 1004)", "ID #88", UUIDs, preview ids, and a table
//   column of bare ID numbers. A student number people see on screen ("S1004-23") stays.
// - Emojis go (©, ® and ™ stay).
// Link addresses are never touched: a link a tool gave keeps working.

const EMOJI = /(?![©®™])[\p{Extended_Pictographic}\u{1F1E6}-\u{1F1FF}](?:️|‍|[\u{1F3FB}-\u{1F3FF}])*(?:‍(?:\p{Extended_Pictographic})️?)*/gu;
const KEYCAP = /[0-9#*]️⃣/gu;
const UUID = /\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi;
const PREVIEW_ID = /\b[A-Za-z0-9_-]{16}\.[A-Za-z0-9_-]{22}\b/g;
// Raw IDs, never the end of an ordinary word ("paid 50", "valid 3"):
//   "(student ID 10142)", "(id 5)"      the whole bracket goes
//   "class_id: 1004", "studentId 7"      a code-style name and its number go
//   "Record ID #88"                      the "ID #88" goes, the word before it stays
const ID_NUMBER = String.raw`\s*(?:number\s*)?[:#=]?\s*#?\d+`;
const ID_IN_BRACKETS = new RegExp(String.raw`\s*\(\s*(?:[A-Za-z]+[ _-])?[iI][dD]\b${ID_NUMBER}\s*\)`, "g");
const ID_CODE_NAME = new RegExp(String.raw`\b(?:[A-Za-z]+_[iI][dD]|[a-z]+Id)\b${ID_NUMBER}`, "g");
const ID_BARE = new RegExp(String.raw`\b[iI][dD]\b${ID_NUMBER}`, "g");
const ID_HEADER = /^(?:id|.*[ _-]id|.*Id)$/i;

// Keeps link targets as they are while `fn` changes the rest of a line.
function outsideLinks(text, fn) {
  const parts = String(text).split(/(\]\([^)]*\)|https?:\/\/\S+)/g);
  return parts.map((part, i) => (i % 2 ? part : fn(part))).join("");
}

// A table column that holds only bare ID numbers is dropped, header and all.
function dropIdColumns(text) {
  const lines = text.split("\n");
  const out = [];
  for (let i = 0; i < lines.length; i++) {
    const isRow = (line) => /^\s*\|.*\|\s*$/.test(line || "");
    if (!isRow(lines[i]) || !/^\s*\|[\s:|-]+\|\s*$/.test(lines[i + 1] || "")) { out.push(lines[i]); continue; }
    let end = i + 2;
    while (end < lines.length && isRow(lines[end])) end++;
    const cells = (line) => line.trim().replace(/^\||\|$/g, "").split("|").map((c) => c.trim());
    const header = cells(lines[i]);
    const body = lines.slice(i + 2, end).map(cells);
    const drop = new Set(header.map((h, c) => (ID_HEADER.test(h.replace(/[*_`]/g, "")) && body.length && body.every((row) => /^\d*$/.test((row[c] || "").replace(/[*_`]/g, ""))) ? c : -1)).filter((c) => c >= 0));
    const keep = (row) => row.filter((_, c) => !drop.has(c));
    if (!drop.size || keep(header).length === 0) { out.push(...lines.slice(i, end)); i = end - 1; continue; }
    out.push(`| ${keep(header).join(" | ")} |`, `| ${keep(header).map(() => "---").join(" | ")} |`, ...body.map((row) => `| ${keep(row).join(" | ")} |`));
    i = end - 1;
  }
  return out.join("\n");
}

// What removing an ID can leave behind, mended (only on a line an ID was taken from):
//   "Record was updated; too."         -> "Record was updated."     (a clause of filler words)
//   "Emma, student number, is in 5A."   -> "Emma is in 5A."          (a label with nothing left)
//   "Saved under ." / "sent to ."        -> "Saved." / "sent."        (a word left pointing at nothing)
const FILLER = String.raw`(?:and|or|also|too|as well|both|either|plus|the|a|an|its|their|his|her|record|number|no\.?|#)`;
const LABEL = String.raw`(?:(?:student|class|user|staff|employee|record|guardian|parent|account|reference|ref)\s+)?(?:number|no\.|#|code|ref)`;
const POINTER = String.raw`(?:with|for|of|to|under|as|at|on|in|by|from|is|was|are)`;
function mendGaps(text) {
  return text
    .replace(new RegExp(String.raw`\s*[;,:]\s*(?:${FILLER}\s*)+(?=[.;,!?)]|$)`, "gi"), "")
    .replace(new RegExp(String.raw`\s*,\s*${LABEL}\s*,\s*`, "gi"), " ")
    .replace(new RegExp(String.raw`\s+${LABEL}\s*(?=[.;,!?)]|$)`, "gi"), "")
    .replace(new RegExp(String.raw`\s+${POINTER}\s*(?=[.;,!?)]|$)`, "gi"), "")
    .replace(/^\s*[;,:]\s*/, "");
}

/**
 * cleanReply(text, toolNames) -> the reply as the person sees it.
 * `toolNames` are every tool Mira has (REGISTRY's names and load_tools).
 */
function cleanReply(text, toolNames = []) {
  if (!text) return text;
  const names = [...new Set(toolNames)].filter((n) => /_/.test(n)).sort((a, b) => b.length - a.length);
  const toolName = names.length ? new RegExp(`\`?\\b(${names.map((n) => n.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|")})\\b\`?`, "g") : null;
  let out = dropIdColumns(String(text));
  out = out.split("\n").map((line) => outsideLinks(line, (part) => {
    let p = part.replace(KEYCAP, "").replace(EMOJI, "");
    if (toolName) p = p.replace(toolName, (_, n) => n.replace(/_/g, " "));
    const before = p;
    const after = p.replace(UUID, " ").replace(PREVIEW_ID, " ").replace(ID_IN_BRACKETS, " ").replace(ID_CODE_NAME, " ").replace(ID_BARE, " ");
    return after === before ? after : mendGaps(after);
  })).join("\n");
  // Tidy what the removals left: empty brackets, doubled spaces, a space before punctuation.
  return out
    .replace(/\(\s*\)/g, "")
    .replace(/(\S)[ \t]{2,}/g, "$1 ")
    .replace(/(\S) +([,.;:!?])(?=\s|$)/g, "$1$2")
    .replace(/[ \t]+$/gm, "")
    .replace(/^(?:[ \t]*\n)+/, "")
    .trimEnd();
}

module.exports = { cleanReply, dropIdColumns };
