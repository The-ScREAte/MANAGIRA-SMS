/**
 * utils/sitemapPing.js
 *
 * Fire-and-forget: notifies search engines that the school sitemap has been
 * updated. Called after a new org registers or an org is un-held, so crawlers
 * discover the new school page as fast as possible instead of waiting weeks.
 *
 * Currently pings Bing (which still supports sitemap ping).
 * Google's sitemap ping was deprecated Jan 2024 — new schools should be
 * submitted via Google Search Console → URL Inspection → "Request Indexing".
 */
const https = require("https");

function pingSearchEngines() {
  if (process.env.NODE_ENV !== "production") return;

  const sitemapUrl = encodeURIComponent(
    "https://www.managira.com/sitemap-schools.xml"
  );

  const endpoints = [
    `https://www.bing.com/ping?sitemap=${sitemapUrl}`,
  ];

  for (const url of endpoints) {
    https
      .get(url, (res) => {
        res.resume(); // drain so the socket is freed
      })
      .on("error", () => {}); // silently swallow — non-critical
  }
}

module.exports = { pingSearchEngines };
