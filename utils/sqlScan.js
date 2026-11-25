"use strict";

// A careful reader of SQL text, for the places that must decide "does this statement only read?"
// (config/db.js: may it be run again after a dropped connection; utils/stableReads.js: may its
// answer be kept for a few seconds). Both used to look at the raw text, where a comment marker
// inside a string ('--') or a keyword inside a quoted name could hide or invent a word.
//
// strip(): comments, string literals and quoted names are taken out in ONE left-to-right pass (so
// none of them can hide another); quoted names keep their words, dollar-quoted bodies are kept as
// text (a DO block's body is code), string literals are dropped.
// tokens(): the lower-case words of what is left.

const PIECES = /--[^\n]*|\/\*[\s\S]*?(?:\*\/|$)|[eE]'(?:[^'\\]|\\[\s\S]|'')*(?:'|$)|'(?:[^']|'')*(?:'|$)|\$([A-Za-z_][A-Za-z0-9_]*)?\$([\s\S]*?)\$\1\$|"((?:[^"]|"")*)(?:"|$)/g;

function strip(sql) {
  return String(sql == null ? "" : sql).replace(PIECES, (match, _tag, body, quoted) => {
    if (match[0] === '"') return ` ${String(quoted).replace(/""/g, '"')} `;
    if (match[0] === "$") return ` ${body} `;
    return " ";
  });
}

const WORD = /[a-z_][a-z0-9_]*/g;
const tokensOfStripped = (stripped) => stripped.toLowerCase().match(WORD) || [];
const tokens = (sql) => tokensOfStripped(strip(sql));

// Words that, anywhere in a SELECT / WITH statement, mean it changes something (a data-changing
// CTE, SELECT ... INTO) or depends on something that is not in the statement's own text.
const CHANGES = new Set([
  "insert", "update", "delete", "merge", "truncate", "into",
  "nextval", "setval", "currval", "lastval", "set_config",
  // Functions of this app that write (utils/recordSafety.js, the email history cleanup).
  "sync_classes_to_term", "cleanup_old_email_history",
]);
// Functions the database has built in or this app installed that can write, lock, notify or stop
// things; a statement calling one is never "only a read".
const PG_SAFE = /^pg_(trigger|indexes|class|catalog|namespace|constraint|attribute|tables|type|proc|views|matviews|index|size_pretty|database_size|total_relation_size|relation_size|stat_[a-z_]+|get_[a-z_]+|extension|roles|settings|description|depend|am|opclass|policies|sequences|locks)$/;
const SHARE_LOCK = /\bfor\s+(no\s+key\s+|key\s+)?(update|share)\b/;

// true: one statement, starting with SELECT / WITH / SHOW, with nothing in it that writes or locks.
function isReadOnly(sql) {
  return readOnlyText(strip(sql).toLowerCase());
}
// The same, for text already run through strip() and lower-cased.
function readOnlyText(text) {
  if (!/^\s*(select|with|show)\b/.test(text)) return false;
  if (/;\s*\S/.test(text) || SHARE_LOCK.test(text)) return false; // a second statement; a row lock
  for (const word of text.match(WORD) || []) {
    if (CHANGES.has(word)) return false;
    if (word.startsWith("pg_") && !PG_SAFE.test(word)) return false;
  }
  return true;
}

module.exports = { strip, tokens, tokensOfStripped, isReadOnly, readOnlyText, CHANGES, PG_SAFE, SHARE_LOCK };
