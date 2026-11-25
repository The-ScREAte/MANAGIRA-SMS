// Tells Bing, Yandex and the other IndexNow search engines about every public page in the sitemap.
// Run after a release that adds or changes public pages or help guides:  npm run indexnow
// Needs INDEXNOW_KEY in the environment (its file is already served at https://managira.com/<key>.txt).
// Google does not use IndexNow: submit https://managira.com/sitemap.xml in Google Search Console instead.
require("dotenv").config();
const https = require("https");

const HOST = "managira.com";
const key = process.env.INDEXNOW_KEY;
if (!key) { console.error("INDEXNOW_KEY is not set."); process.exit(1); }

function get(url) {
  return new Promise((resolve, reject) => {
    https.get(url, (res) => { let data = ""; res.on("data", (c) => (data += c)); res.on("end", () => resolve(data)); }).on("error", reject);
  });
}
function post(hostname, body) {
  return new Promise((resolve) => {
    const req = https.request({ hostname, path: "/IndexNow", method: "POST", headers: { "Content-Type": "application/json; charset=utf-8", "Content-Length": Buffer.byteLength(body) } },
      (res) => { res.resume(); res.on("end", () => resolve(res.statusCode)); });
    req.on("error", () => resolve(0));
    req.write(body); req.end();
  });
}

(async () => {
  const xml = await get(`https://${HOST}/sitemap.xml`);
  const urls = [...xml.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1]).filter((u) => u.startsWith(`https://${HOST}/`));
  if (!urls.length) { console.error("No URLs found in the sitemap."); process.exit(1); }
  const body = JSON.stringify({ host: HOST, key, keyLocation: `https://${HOST}/${key}.txt`, urlList: urls });
  for (const endpoint of ["api.indexnow.org", "www.bing.com"]) console.log(`${endpoint}: ${await post(endpoint, body)} (${urls.length} URLs)`);
})();
