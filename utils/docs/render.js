"use strict";

// Turns a documentation article written in code (utils/docs/articles/*.js) into the HTML the
// help center stores and shows. Every article follows one shape, so every guide reads the same:
//   intro, "Who can do this", sections of numbered steps with screenshots, examples and tips,
//   then "Frequently asked questions" (read by search engines and AI assistants as an FAQ).
//
// Article fields:
//   slug, title, topic, order, summary (the search result description, under 160 characters),
//   tags, featured, who, intro (HTML), sections, faq [[question, answer]], related [slug].
// A section: { title, text?, steps?, list?, table?, code?, subsections?, example?, tip?, note?, warning?, html? }.
// A subsection: { title, text?, steps?, list?, table?, tables? [{ label, rows }], code?, prints?, tip?, note? }.
// A step: "text", or [text, image, caption]: the image is a file in public/images/docs/.

const IMAGE_ROOT = "/images/docs/";

const esc = (value) => String(value == null ? "" : value)
  .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

// Text fields may hold simple inline HTML written in code (<strong>, <em>, <a>, <code>).
const inline = (value) => String(value == null ? "" : value);

function figure(image, caption, alt) {
  if (!image) return "";
  const src = image.startsWith("/") || image.startsWith("http") ? image : IMAGE_ROOT + image;
  const cap = caption ? `<figcaption>${inline(caption)}</figcaption>` : "";
  return `<figure class="doc-media doc-image"><img src="${esc(src)}" alt="${esc(alt || String(caption || "").replace(/<[^>]+>/g, "") || "Screenshot")}">${cap}</figure>`;
}

function steps(list) {
  const items = list.map((step) => {
    const [text, image, caption] = Array.isArray(step) ? step : [step];
    return `<li><p>${inline(text)}</p>${figure(image, caption, caption)}</li>`;
  });
  return `<ol>${items.join("")}</ol>`;
}

const callout = (kind, label, body) =>
  `<div class="doc-callout doc-callout--${kind}"><p><strong>${esc(label)}</strong> ${inline(body)}</p></div>`;

// Each cell carries its column's name, so a phone can show a row as a stacked card.
function table(rows, cls) {
  const [head, ...body] = rows;
  const label = (i) => esc(String(head[i] || "").replace(/<[^>]+>/g, ""));
  return `<table${cls ? ` class="${cls}"` : ""}><thead><tr>${head.map((cell) => `<th scope="col">${inline(cell)}</th>`).join("")}</tr></thead>`
    + `<tbody>${body.map((row) => `<tr>${row.map((cell, i) => `<td data-label="${label(i)}">${inline(cell)}</td>`).join("")}</tr>`).join("")}</tbody></table>`;
}

// A sheet drawn as a table (an example layout): long fields may wrap after a dot or colon.
const breakable = (rows) => rows.map((row) => row.map((cell) => String(cell).replace(/<code>([^<]*)<\/code>/g,
  (match, text) => `<code>${text.replace(/([.:])(?=.)/g, "$1<wbr>")}</code>`)));

function section(part) {
  const out = [];
  if (part.title) out.push(`<h2>${esc(part.title)}</h2>`);
  if (part.text) out.push(...[].concat(part.text).map((p) => `<p>${inline(p)}</p>`));
  if (part.steps) out.push(steps(part.steps));
  if (part.image) out.push(figure(part.image, part.caption, part.caption));
  if (part.list) out.push(`<ul>${part.list.map((item) => `<li>${inline(item)}</li>`).join("")}</ul>`);
  if (part.table) out.push(table(part.table));
  if (part.code) out.push(`<pre><code>${esc(part.code)}</code></pre>`);
  if (part.subsections) part.subsections.forEach((sub) => out.push(subsection(sub)));
  if (part.example) out.push(callout("info", "Example:", part.example));
  if (part.tip) out.push(callout("tip", "Tip:", part.tip));
  if (part.note) out.push(callout("info", "Good to know:", part.note));
  if (part.warning) out.push(callout("warning", "Important:", part.warning));
  if (part.html) out.push(part.html);
  return out.join("\n");
}

// A labelled table, e.g. "In your sheet" next to "Prints".
const labelled = ({ label, rows }) => `<p class="doc-table-label">${inline(label)}</p>${table(breakable(rows), "doc-sheet")}`;

function subsection(part) {
  const out = [`<h3>${esc(part.title)}</h3>`];
  if (part.text) out.push(...[].concat(part.text).map((p) => `<p>${inline(p)}</p>`));
  if (part.steps) out.push(steps(part.steps));
  if (part.image) out.push(figure(part.image, part.caption, part.caption));
  if (part.list) out.push(`<ul>${part.list.map((item) => `<li>${inline(item)}</li>`).join("")}</ul>`);
  if (part.table) out.push(table(part.table));
  if (part.tables) part.tables.forEach((item) => out.push(labelled(item)));
  if (part.code) out.push(`<pre><code>${esc(part.code)}</code></pre>`);
  if (part.prints) out.push(`<p class="doc-table-label">Prints</p><p class="doc-prints">${inline(part.prints)}</p>`);
  if (part.tip) out.push(callout("tip", "Tip:", part.tip));
  if (part.note) out.push(callout("info", "Good to know:", part.note));
  return out.join("\n");
}

function renderArticle(article) {
  // An article kept exactly as written (billing and pricing guides are left unchanged).
  if (article.rawHtml) return String(article.rawHtml).trim();
  const out = [];
  if (article.intro) out.push(...[].concat(article.intro).map((p) => `<p>${inline(p)}</p>`));
  if (article.who) out.push(callout("info", "Who can do this:", article.who));
  (article.sections || []).forEach((part) => out.push(section(part)));
  if (article.faq && article.faq.length) {
    out.push("<h2>Frequently asked questions</h2>");
    article.faq.forEach(([question, answer]) => out.push(`<h3>${esc(question)}</h3>`, `<p>${inline(answer)}</p>`));
  }
  return out.join("\n");
}

// Every image an article uses (tests check each one exists).
function imagesOf(article) {
  const found = [];
  const add = (image) => { if (image && !image.startsWith("http")) found.push(image.startsWith("/") ? image : IMAGE_ROOT + image); };
  const walk = (part) => {
    if (part.image) add(part.image);
    (part.steps || []).forEach((step) => { if (Array.isArray(step)) add(step[1]); });
    (part.subsections || []).forEach(walk);
  };
  (article.sections || []).forEach(walk);
  return found;
}

module.exports = { renderArticle, imagesOf, IMAGE_ROOT };
