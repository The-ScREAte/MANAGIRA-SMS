#!/usr/bin/env node
// Search-engine readiness check for the public pages.  npm run seo:check
//   BASE_URL=https://managira.com npm run seo:check      (the live site)
//   npm run seo:check                                     (local copy, http://127.0.0.1:4310)
// For a local/other BASE_URL, every https://managira.com/... address in the sitemap is fetched from
// BASE_URL with the "Host: managira.com" header, and compared with its canonical address.
// Needs no database and loads no .env. Exits 1 when anything fails.
const http = require("http");
const https = require("https");

const SITE = "https://managira.com";
const BASE = String(process.env.BASE_URL || "http://127.0.0.1:4310").replace(/\/$/, "");
const local = new URL(BASE).origin !== SITE && new URL(BASE).hostname !== "www.managira.com";
const KEY = process.env.INDEXNOW_KEY || "";

function get(urlText, { limit = 3_000_000 } = {}) {
  const u = new URL(urlText.startsWith("/") ? BASE + urlText : urlText);
  const mod = u.protocol === "https:" ? https : http;
  return new Promise((resolve) => {
    const req = mod.request(u, { method: "GET", timeout: 20000, headers: { "Accept-Encoding": "identity", "User-Agent": "managira-seo-check", ...(local ? { Host: new URL(SITE).host } : {}) } }, (res) => {
      const chunks = []; let size = 0;
      res.on("data", (c) => { size += c.length; if (size <= limit) chunks.push(c); });
      res.on("end", () => resolve({ status: res.statusCode, headers: res.headers, body: Buffer.concat(chunks), size }));
      res.on("error", () => resolve({ status: 0, headers: {}, body: Buffer.alloc(0), size: 0 }));
    });
    req.on("timeout", () => req.destroy());
    req.on("error", () => resolve({ status: 0, headers: {}, body: Buffer.alloc(0), size: 0 }));
    req.end();
  });
}
const toFetch = (loc) => { const u = new URL(loc); return local ? BASE + u.pathname + u.search : loc; };
const text = (r) => r.body.toString("utf8");
const locs = (xml) => [...xml.matchAll(/<loc>\s*([^<\s]+)\s*<\/loc>/g)].map((m) => m[1].replace(/&amp;/g, "&"));
const unesc = (v) => String(v).replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&");
function metas(html) {
  const out = []; for (const m of html.matchAll(/<meta\s+([^>]*?)\/?>/gi)) {
    const a = {}; for (const x of m[1].matchAll(/([a-zA-Z:-]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g)) a[x[1].toLowerCase()] = unesc(x[2] != null ? x[2] : x[3]);
    out.push(a);
  } return out;
}
const metaBy = (list, attr, val) => list.filter((a) => (a[attr] || "").toLowerCase() === val);

const rows = []; let failures = 0, warnings = 0;
// Help guides (/legal/user-documentation/...) have their own owners: a long title there is a warning, not a failure.
const SOFT = (where, check) => /^\/legal\/user-documentation(\/|$)/.test(where) && /title/.test(check);
function record(where, check, ok, detail) {
  const warn = !ok && SOFT(where, check);
  if (!ok && !warn) failures += 1; if (warn) warnings += 1;
  rows.push({ where, check, ok, warn, detail: detail || "" });
}

function checkPage(loc, r, seen) {
  const w = new URL(loc).pathname;
  record(w, "status 200", r.status === 200, r.status);
  record(w, "html", /text\/html/.test(r.headers["content-type"] || ""), r.headers["content-type"]);
  if (r.status !== 200) return;
  const html = text(r);
  const xr = String(r.headers["x-robots-tag"] || "");
  record(w, "no X-Robots noindex", !/noindex/i.test(xr), xr);
  const lang = /<html[^>]*\blang="[a-z]{2}/i.test(html);
  record(w, "html lang", lang);
  const m = metas(html);
  record(w, "viewport", metaBy(m, "name", "viewport").length === 1);
  const robots = metaBy(m, "name", "robots").map((a) => a.content || "");
  record(w, "robots not noindex", !robots.some((c) => /noindex/i.test(c)), robots.join(";"));
  const canon = [...html.matchAll(/<link\s+[^>]*rel="canonical"[^>]*>/gi)].map((x) => (x[0].match(/href="([^"]*)"/) || [])[1]);
  record(w, "one canonical = URL", canon.length === 1 && unesc(canon[0]) === loc, canon.join(" | "));
  const title = ((html.match(/<title[^>]*>([\s\S]*?)<\/title>/i) || [])[1] || "").trim();
  const t = unesc(title);
  record(w, "title 10-60 chars", t.length >= 10 && t.length <= 60, `${t.length}: ${t}`);
  const d = (metaBy(m, "name", "description")[0] || {}).content || "";
  record(w, "description 70-160", d.length >= 70 && d.length <= 160, d.length);
  if (seen) { (seen.titles[t] = seen.titles[t] || []).push(w); (seen.descs[d] = seen.descs[d] || []).push(w); }
  const h1 = (html.match(/<h1[\s>]/gi) || []).length;
  record(w, "one h1", h1 === 1, h1);
  const og = {}; for (const a of m) if ((a.property || "").startsWith("og:")) og[a.property] = a.content;
  record(w, "og title/desc/url/image", !!(og["og:title"] && og["og:description"] && og["og:url"] && /^https:\/\//.test(og["og:image"] || "")), Object.keys(og).join(","));
  const tw = metaBy(m, "name", "twitter:card").length === 1;
  record(w, "twitter card", tw);
  const blocks = [...html.matchAll(/<script[^>]*type="application\/ld\+json"[^>]*>([\s\S]*?)<\/script>/gi)].map((x) => x[1]);
  let ldOk = true, ldDetail = `${blocks.length} block(s)`; const types = [];
  for (const b of blocks) { try { const j = JSON.parse(b); for (const n of (j["@graph"] || [j])) types.push([].concat(n["@type"] || []).join("/")); } catch (e) { ldOk = false; ldDetail = "invalid JSON: " + e.message; } }
  record(w, "JSON-LD parses", ldOk, ldDetail);
  if (w === "/") {
    record(w, "home has Organization+WebSite+SoftwareApplication", ["Organization", "WebSite", "SoftwareApplication"].every((t2) => types.includes(t2)), types.join(","));
  } else if (w !== "/legal/mira-ai-assistant" && blocks.length) {
    record(w, "inner page has BreadcrumbList", types.includes("BreadcrumbList"), types.join(","));
  }
  if (w === "/legal/faq") record(w, "FAQPage JSON-LD", types.includes("FAQPage"), types.join(","));
  return { html, og };
}

async function main() {
  console.log(`Checking ${BASE}${local ? " (Host: managira.com)" : ""}\n`);
  const robots = await get("/robots.txt");
  record("robots.txt", "status 200 text/plain", robots.status === 200 && /text\/plain/.test(robots.headers["content-type"] || ""), robots.status);
  const sitemapLines = text(robots).split("\n").filter((l) => /^sitemap:/i.test(l)).map((l) => l.split(/:\s*/).slice(1).join(":").trim());
  record("robots.txt", "lists sitemap.xml", sitemapLines.includes(`${SITE}/sitemap.xml`), sitemapLines.join(" "));
  record("robots.txt", "lists schools sitemaps", sitemapLines.includes(`${SITE}/sitemap-schools.xml`) && sitemapLines.includes(`${SITE}/sitemap-schools-index.xml`));
  record("robots.txt", "does not block /", !/^Disallow:\s*\/\s*$/m.test(text(robots).split(/\n\n/)[0] || ""));

  const sm = await get("/sitemap.xml", { limit: 60_000_000 });
  record("sitemap.xml", "200 application/xml", sm.status === 200 && /application\/xml/.test(sm.headers["content-type"] || ""), sm.headers["content-type"]);
  const xml = text(sm); const urls = locs(xml);
  record("sitemap.xml", "valid urlset, 1-50000 URLs, <50MB", /<urlset[^>]*sitemaps\.org/.test(xml) && urls.length >= 1 && urls.length <= 50000 && sm.size < 50 * 1024 * 1024, urls.length);
  record("sitemap.xml", "unique absolute https URLs on managira.com", new Set(urls).size === urls.length && urls.every((u) => u.startsWith(SITE + "/")), "");
  const mods = [...xml.matchAll(/<lastmod>([^<]+)<\/lastmod>/g)].map((x) => x[1]);
  record("sitemap.xml", "lastmod ISO on every URL", mods.length === urls.length && mods.every((x) => /^\d{4}-\d{2}-\d{2}(T[\d:.]+(Z|[+-]\d{2}:\d{2}))?$/.test(x) && !Number.isNaN(Date.parse(x))), `${mods.length}/${urls.length}`);
  record("sitemap.xml", "lastmod not all identical", new Set(mods).size > 1, [...new Set(mods)].length + " distinct");
  record("sitemap.xml", "lastmod not in the future", mods.every((x) => Date.parse(x) <= Date.now() + 86400000));
  record("sitemap.xml", "no changefreq/priority", !/<changefreq>|<priority>/.test(xml));
  const gz = await new Promise((resolve) => { const u = new URL(toFetch(`${SITE}/sitemap.xml`)); (u.protocol === "https:" ? https : http).get(u, { headers: { "Accept-Encoding": "gzip", ...(local ? { Host: "managira.com" } : {}) } }, (res) => { res.resume(); resolve(res.headers["content-encoding"] || ""); }).on("error", () => resolve("")); });
  record("sitemap.xml", "gzip served", gz === "gzip" || gz === "br", gz || "none");
  for (const name of ["sitemap-schools.xml", "sitemap-schools-index.xml"]) {
    const r = await get("/" + name);
    record(name, "200 application/xml, parses", r.status === 200 && /application\/xml/.test(r.headers["content-type"] || "") && /<(urlset|sitemapindex)/.test(text(r)), r.status);
  }

  const seen = { titles: {}, descs: {} };
  let queue = urls.slice(); const internal = new Set();
  const redirects = [];
  async function worker() {
    while (queue.length) {
      const loc = queue.shift();
      const r = await get(toFetch(loc));
      if (r.status >= 300 && r.status < 400) { redirects.push(loc); record(new URL(loc).pathname, "not redirected", false, r.status + " -> " + r.headers.location); continue; }
      const out = checkPage(loc, r, seen);
      if (out) {
        if (internal.size < 60) for (const x of out.html.matchAll(/<a\s[^>]*href="(\/[^"#?]*)"/gi)) if (internal.size < 60) internal.add(x[1]);
        if (new URL(loc).pathname === "/" || new URL(loc).pathname === "/legal/faq") {
          const img = out.og["og:image"]; if (img && !seen[img]) { seen[img] = 1; const ir = await get(toFetch(img)); record(new URL(loc).pathname, "og:image reachable image", ir.status === 200 && /^image\//.test(ir.headers["content-type"] || ""), `${ir.status} ${ir.headers["content-type"] || ""} ${img}`); }
        }
      }
    }
  }
  await Promise.all([worker(), worker(), worker(), worker()]);
  for (const [t, where] of Object.entries(seen.titles)) if (where.length > 1) record(where[0], "title unique", false, `shared by ${where.length}: ${t}`);
  for (const [d, where] of Object.entries(seen.descs)) if (d && where.length > 1) record(where[0], "description unique", false, `shared by ${where.length}`);
  record("sitemap pages", "title unique across pages", !Object.values(seen.titles).some((w) => w.length > 1), Object.entries(seen.titles).filter(([, w]) => w.length > 1).map(([t]) => t).join(" | "));
  record("sitemap pages", "description unique across pages", !Object.entries(seen.descs).some(([d, w]) => d && w.length > 1));

  let broken = [];
  for (const p of [...internal]) { if (/^\/(account|admin|common|api|hub|student|guardian|driver|finance|print)\b/.test(p) && p !== "/account/service-plan") continue; const r = await get(p); if (r.status >= 400 || r.status === 0) broken.push(`${p} ${r.status}`); }
  record("internal links", "sampled public links not broken", broken.length === 0, broken.join(", "));
  const nf = await get("/this-page-does-not-exist-seo-check");
  record("404", "unknown URL returns 404", nf.status === 404, nf.status);
  if (KEY) {
    const k = await get(`/${KEY}.txt`);
    record("IndexNow", "key file equals key", k.status === 200 && text(k).trim() === KEY, k.status);
  } else {
    record("IndexNow", "key file (set INDEXNOW_KEY to check)", true, "skipped");
  }

  const w1 = Math.max(...rows.map((r) => r.where.length), 5), w2 = Math.max(...rows.map((r) => r.check.length), 5);
  for (const r of rows) if (!r.ok || process.env.VERBOSE) console.log(`${r.ok ? "PASS" : r.warn ? "WARN" : "FAIL"}  ${r.where.padEnd(Math.min(w1, 55))}  ${r.check.padEnd(w2)}  ${String(r.detail).slice(0, 110)}`);
  console.log(`\n${rows.length - failures - warnings} passed, ${warnings} warnings (help guide titles), ${failures} failed (${urls.length} sitemap URLs checked)`);
  process.exit(failures ? 1 : 0);
}
main().catch((e) => { console.error("seo check crashed:", e.message); process.exit(2); });
