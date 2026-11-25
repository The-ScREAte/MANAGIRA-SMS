// utils/searchNotify.js
//
// ONE place that tells search engines a public page is new or changed.
//
//   notifyAll(urls, reason)  -> one IndexNow request (per site address) to https://api.indexnow.org/IndexNow.
//
// api.indexnow.org is the shared IndexNow endpoint: it passes every submission on to all the
// participating engines at once (Bing, Yandex, Naver, Seznam, Yep ...), so there is no second post
// to www.bing.com: that would only tell Bing twice. Google does not take IndexNow and has no
// sitemap ping any more: it finds pages through robots.txt "Sitemap:" lines and Search Console.
//
// Inert unless NODE_ENV=production, INDEXNOW_KEY is set and SEARCH_NOTIFY is not "off".
// Never throws. URLs are de-duplicated, sent in batches of at most 10,000 (the IndexNow limit).
// IndexNow wants every URL in one request to be on the request's "host", so a batch holding
// school addresses (name.managira.com) is split by address; the requests go out together.
// Each request has a 10 s timeout and is retried once after a pause on a 429 or 5xx answer.
const https = require("https");

const ENDPOINT = { hostname: "api.indexnow.org", path: "/IndexNow" };
const MAX_PER_REQUEST = 10000;
const TIMEOUT_MS = 10000;
const RETRY_PAUSE_MS = 2000;

function enabled(env = process.env) {
  return env.NODE_ENV === "production" && !!env.INDEXNOW_KEY && String(env.SEARCH_NOTIFY || "").toLowerCase() !== "off";
}

// Only https addresses on managira.com or one of its subdomains, once each.
function cleanUrls(urls) {
  const seen = new Set();
  for (const raw of Array.isArray(urls) ? urls : []) {
    try {
      const u = new URL(String(raw || "").trim());
      if (u.protocol !== "https:") continue;
      if (u.hostname !== "managira.com" && !u.hostname.endsWith(".managira.com")) continue;
      u.hash = "";
      seen.add(u.toString());
    } catch (_) { /* not a URL */ }
  }
  return [...seen];
}

function post(body, transport) {
  if (transport) return transport({ ...ENDPOINT, body });
  return new Promise((resolve) => {
    const data = JSON.stringify(body);
    let settled = false;
    const done = (status) => { if (!settled) { settled = true; resolve(status); } };
    const req = https.request({
      ...ENDPOINT,
      method: "POST",
      timeout: TIMEOUT_MS,
      headers: { "Content-Type": "application/json; charset=utf-8", "Content-Length": Buffer.byteLength(data) },
    }, (res) => { res.resume(); res.on("end", () => done(res.statusCode)); res.on("error", () => done(0)); });
    req.on("timeout", () => { req.destroy(); done(0); });
    req.on("error", () => done(0));
    req.end(data);
    setTimeout(() => { req.destroy(); done(0); }, TIMEOUT_MS + 1000).unref();
  });
}

async function postWithRetry(body, opts) {
  let status = await post(body, opts.transport).catch(() => 0);
  if (status === 429 || status >= 500) {
    await new Promise((r) => setTimeout(r, opts.retryPauseMs == null ? RETRY_PAUSE_MS : opts.retryPauseMs));
    status = await post(body, opts.transport).catch(() => 0);
  }
  return status;
}

/**
 * @param {string[]} urls   absolute public URLs that are new or changed
 * @param {string} reason   a few words for the log line ("deploy", "school page", ...)
 * @param {{env?:object, transport?:Function, retryPauseMs?:number}} [opts] tests pass a stub transport
 * @returns {Promise<{sent:number, ok:boolean, skipped?:string}>} never rejects
 */
async function notifyAll(urls, reason, opts = {}) {
  try {
    const env = opts.env || process.env;
    if (!enabled(env)) return { sent: 0, ok: false, skipped: "off" };
    const list = cleanUrls(urls);
    if (!list.length) return { sent: 0, ok: true, skipped: "nothing" };
    const key = env.INDEXNOW_KEY;
    const byHost = new Map();
    for (const url of list) {
      const host = new URL(url).hostname;
      if (!byHost.has(host)) byHost.set(host, []);
      byHost.get(host).push(url);
    }
    const jobs = [];
    for (const [host, hostUrls] of byHost) {
      for (let i = 0; i < hostUrls.length; i += MAX_PER_REQUEST) {
        jobs.push({ host, keyLocation: `https://${host}/${key}.txt`, urlList: hostUrls.slice(i, i + MAX_PER_REQUEST) });
      }
    }
    const send = async (job) => {
      const status = await postWithRetry({ host: job.host, key, keyLocation: job.keyLocation, urlList: job.urlList }, opts);
      return { count: job.urlList.length, ok: status === 200 || status === 202 };
    };
    const results = [];
    for (let i = 0; i < jobs.length; i += 8) results.push(...await Promise.all(jobs.slice(i, i + 8).map(send))); // together, at most 8 at a time
    const sent = results.filter((r) => r.ok).reduce((n, r) => n + r.count, 0);
    const ok = results.every((r) => r.ok);
    console.log(`[SearchNotify] ${reason || "update"}: ${sent}/${list.length} URL(s) sent to IndexNow${ok ? "" : " (some failed)"}`);
    return { sent, ok };
  } catch (error) {
    try { console.error("[SearchNotify] failed:", error && error.message); } catch (_) { /* nothing */ }
    return { sent: 0, ok: false };
  }
}

module.exports = { notifyAll, enabled, cleanUrls, MAX_PER_REQUEST };
