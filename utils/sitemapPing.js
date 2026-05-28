/**
 * utils/sitemapPing.js
 *
 * Fire-and-forget search engine notifications:
 *
 *   pingSchoolUrl(nickname)  → IndexNow POST (Google, Bing, Yandex simultaneously)
 *                              Called right after a new org is created so Google
 *                              discovers and indexes the school within hours/days.
 *
 *   pingSearchEngines()      → Bing sitemap ping (still supported, legacy fallback)
 *
 * IndexNow docs: https://www.indexnow.org/
 * Requires env var: INDEXNOW_KEY
 * The key verification file must be served at:
 *   https://www.managira.com/<INDEXNOW_KEY>.txt  (plain text containing just the key)
 */
const https = require("https");

function _fireAndForget(url) {
  https.get(url, (res) => { res.resume(); }).on("error", () => {});
}

function _postJson(hostname, path, body) {
  const data = JSON.stringify(body);
  const req = https.request({
    hostname,
    path,
    method: "POST",
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Content-Length": Buffer.byteLength(data),
    },
  });
  req.on("error", () => {});
  req.write(data);
  req.end();
}

/**
 * Ping IndexNow for a specific school URL immediately after registration.
 * This tells Google, Bing, and Yandex about the new school page within minutes.
 * @param {string} nickname - the org's subdomain slug (e.g. "devinde")
 */
function pingSchoolUrl(nickname) {
  if (process.env.NODE_ENV !== "production") return;
  if (!nickname) return;

  const key = process.env.INDEXNOW_KEY;
  if (!key) return;

  const schoolUrl = `https://${nickname}.managira.com/`;
  const sitemapUrl = "https://www.managira.com/sitemap-schools.xml";

  const body = {
    host: "managira.com",
    key,
    keyLocation: `https://www.managira.com/${key}.txt`,
    urlList: [schoolUrl],
  };

  // Submit to IndexNow (routes to Google, Bing, Yandex, etc.)
  _postJson("api.indexnow.org", "/IndexNow", body);

  // Also submit directly to Bing IndexNow endpoint
  _postJson("www.bing.com", "/IndexNow", body);

  // Also ping Bing sitemap for good measure
  _fireAndForget(`https://www.bing.com/ping?sitemap=${encodeURIComponent(sitemapUrl)}`);
}

/**
 * Ping Bing sitemap endpoint (legacy — still works for general updates).
 */
function pingSearchEngines() {
  if (process.env.NODE_ENV !== "production") return;

  const sitemapUrl = encodeURIComponent("https://www.managira.com/sitemap-schools.xml");
  _fireAndForget(`https://www.bing.com/ping?sitemap=${sitemapUrl}`);
}

module.exports = { pingSearchEngines, pingSchoolUrl };
