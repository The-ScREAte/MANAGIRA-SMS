"use strict";

// What the public help center pages need from an article's stored HTML: anchors for every
// heading (so "On this page" and shared links work without scripts), image sizes and lazy
// loading (no layout jumps, fast first paint), and a reading time.
const fs = require("fs");
const path = require("path");
const catalog = require("./catalog");

const MANIFEST = path.join(__dirname, "..", "..", "public", "images", "docs", "manifest.json");
let sizes = null;
function imageSizes() {
  if (sizes) return sizes;
  try {
    sizes = JSON.parse(fs.readFileSync(MANIFEST, "utf8"));
  } catch (_error) {
    sizes = {};
  }
  return sizes;
}

const plain = (html) => String(html || "").replace(/<[^>]+>/g, " ").replace(/&nbsp;/g, " ").replace(/&amp;/g, "&")
  .replace(/&#39;|&rsquo;/g, "'").replace(/&quot;/g, '"').replace(/\s+/g, " ").trim();

const anchorOf = (text) => plain(text).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 60) || "section";

function prepareArticle(html) {
  const used = new Set();
  const toc = [];
  let body = String(html || "").replace(/<h([23])>([\s\S]*?)<\/h\1>/g, (match, level, inner) => {
    let id = anchorOf(inner);
    for (let n = 2; used.has(id); n += 1) id = `${anchorOf(inner)}-${n}`;
    used.add(id);
    // The outline lists the sections; the questions under the FAQ stay out of it.
    if (level === "2") toc.push({ id, title: plain(inner) });
    return `<h${level} id="${id}">${inner}</h${level}>`;
  });
  const known = imageSizes();
  body = body.replace(/<img ([^>]*?)src="([^"]+)"([^>]*)>/g, (match, before, src, after) => {
    const size = known[src.replace(/^\/images\/docs\//, "")];
    const dims = size ? ` width="${size[0]}" height="${size[1]}"` : "";
    return `<img ${before}src="${src}"${after}${dims} loading="lazy" decoding="async">`;
  });
  const words = plain(body).split(" ").filter(Boolean).length;
  return { html: body, toc, minutes: Math.max(1, Math.round(words / 200)) };
}

// The sidebar: every topic in order, with its published articles in reading order.
function navigation(articles) {
  const bySlugOrder = new Map(catalog.ARTICLES.map((article, index) => [article.slug, index]));
  const groups = new Map(catalog.TOPICS.map((topic) => [topic.name, { ...topic, articles: [] }]));
  articles
    .filter((article) => article.status === "active")
    .forEach((article) => {
      if (!groups.has(article.topic)) groups.set(article.topic, { name: article.topic, icon: "doc", blurb: "", articles: [] });
      groups.get(article.topic).articles.push({ slug: article.slug, title: article.title, summary: article.seoDescription || article.excerpt || "" });
    });
  const rank = (slug) => (bySlugOrder.has(slug) ? bySlugOrder.get(slug) : 1e6);
  return [...groups.values()]
    .filter((group) => group.articles.length)
    .map((group) => ({ ...group, articles: group.articles.sort((a, b) => rank(a.slug) - rank(b.slug) || a.title.localeCompare(b.title)) }));
}

// A small search index (titles, topics, summaries, tags) for instant search in the page.
function searchIndex(articles) {
  return articles
    .filter((article) => article.status === "active")
    .map((article) => ({ s: article.slug, t: article.title, c: article.topic, d: article.seoDescription || article.excerpt || "", k: (article.tags || []).join(" ") }));
}

// Inline SVG icons for the topics (24px, stroke).
const ICONS = {
  rocket: '<path d="M4.5 16.5c-1.5 1.26-2 5-2 5s3.74-.5 5-2c.71-.84.7-2.13-.09-2.91a2.18 2.18 0 0 0-2.91-.09z"/><path d="m12 15-3-3a22 22 0 0 1 2-3.95A12.88 12.88 0 0 1 22 2c0 2.72-.78 7.5-6 11a22.35 22.35 0 0 1-4 2z"/><path d="M9 12H4s.55-3.03 2-4c1.62-1.08 5 0 5 0"/><path d="M12 15v5s3.03-.55 4-2c1.08-1.62 0-5 0-5"/>',
  key: '<circle cx="7.5" cy="15.5" r="5.5"/><path d="m21 2-9.6 9.6"/><path d="m15.5 7.5 3 3L22 7l-3-3"/>',
  building: '<path d="M3 21h18"/><path d="M5 21V7l7-4 7 4v14"/><path d="M9 21v-6h6v6"/><path d="M10 9h4"/>',
  graduation: '<path d="M22 10 12 5 2 10l10 5 10-5z"/><path d="M6 12v5c3 3 9 3 12 0v-5"/>',
  family: '<circle cx="9" cy="7" r="4"/><path d="M3 21v-2a4 4 0 0 1 4-4h4a4 4 0 0 1 4 4v2"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/><path d="M21 21v-2a4 4 0 0 0-3-3.85"/>',
  badge: '<rect x="3" y="4" width="18" height="16" rx="2"/><circle cx="9" cy="10" r="2"/><path d="M15 8h2"/><path d="M15 12h2"/><path d="M7 16h10"/>',
  board: '<rect x="2" y="3" width="20" height="14" rx="2"/><path d="M8 21h8"/><path d="M12 17v4"/>',
  check: '<path d="M9 11l3 3L22 4"/><path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11"/>',
  chart: '<path d="M3 3v18h18"/><path d="M18 17V9"/><path d="M13 17V5"/><path d="M8 17v-3"/>',
  calendar: '<rect x="3" y="4" width="18" height="18" rx="2"/><path d="M16 2v4"/><path d="M8 2v4"/><path d="M3 10h18"/>',
  message: '<path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>',
  globe: '<circle cx="12" cy="12" r="10"/><path d="M2 12h20"/><path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/>',
  bus: '<path d="M8 6v6"/><path d="M15 6v6"/><path d="M2 12h19.6"/><path d="M18 18h3s.5-1.7.8-2.8c.1-.4.2-.8.2-1.2 0-.4-.1-.8-.2-1.2l-1.4-5C20.1 6.8 19.1 6 18 6H4a2 2 0 0 0-2 2v10h3"/><circle cx="7" cy="18" r="2"/><path d="M9 18h5"/><circle cx="16" cy="18" r="2"/>',
  wallet: '<path d="M21 12V7H5a2 2 0 0 1 0-4h14v4"/><path d="M3 5v14a2 2 0 0 0 2 2h16v-5"/><path d="M18 12a2 2 0 0 0 0 4h4v-4z"/>',
  plug: '<path d="M12 22v-5"/><path d="M9 8V2"/><path d="M15 8V2"/><path d="M18 8v5a6 6 0 0 1-12 0V8z"/>',
  sparkle: '<path d="m12 3-1.9 5.8a2 2 0 0 1-1.3 1.3L3 12l5.8 1.9a2 2 0 0 1 1.3 1.3L12 21l1.9-5.8a2 2 0 0 1 1.3-1.3L21 12l-5.8-1.9a2 2 0 0 1-1.3-1.3z"/>',
  network: '<rect x="9" y="2" width="6" height="6" rx="1"/><rect x="2" y="16" width="6" height="6" rx="1"/><rect x="16" y="16" width="6" height="6" rx="1"/><path d="M5 16v-3h14v3"/><path d="M12 8v5"/>',
  card: '<rect x="2" y="5" width="20" height="14" rx="2"/><path d="M2 10h20"/>',
  doc: '<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6"/>',
  home: '<path d="M3 10.5 12 3l9 7.5"/><path d="M5 9v12h14V9"/><path d="M10 21v-6h4v6"/>',
  laptop: '<rect x="4" y="4" width="16" height="11" rx="2"/><path d="M2 19h20"/><path d="M10 19l.5-1h3l.5 1"/>',
};
const icon = (name, size = 20) => `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICONS[name] || ICONS.doc}</svg>`;

module.exports = { prepareArticle, navigation, searchIndex, icon, plain };
