/**
 * utils/sitemapPing.js
 *
 * Kept for the places that already call it; everything goes through utils/searchNotify.js now
 * (one IndexNow request to api.indexnow.org, which reaches every IndexNow engine).
 *
 *   pingSchoolUrl(nickname)  a school's public page is new or changed.
 *   pingSearchEngines()      nothing to do: Bing's sitemap ping is retired. Engines read the
 *                            sitemaps listed in robots.txt; the daily job (utils/searchIndexSync.js)
 *                            submits what changed.
 */
const { notifyAll } = require("./searchNotify");

function pingSchoolUrl(nickname) {
  const nick = String(nickname || "").trim().toLowerCase();
  if (!/^[a-z0-9-]+$/.test(nick)) return;
  notifyAll([`https://${nick}.managira.com/`], "school page").catch(() => {});
}

function pingSearchEngines() {}

module.exports = { pingSearchEngines, pingSchoolUrl };
