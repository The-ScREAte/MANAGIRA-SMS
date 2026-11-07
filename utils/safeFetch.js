"use strict";

// Fetching an address a person typed in (a calendar link, a school's sign-on address) must
// never reach the server's own network. The check runs at the moment of connecting, so a
// redirect or a name that changes its answer can't get round it.
const dns = require("dns");
const http = require("http");
const https = require("https");
const net = require("net");

const CANT_REACH = "That address can't be reached.";

// Only for the local test copy, where the pretend sign-on servers run on this machine.
const localAllowed = () => process.env.SAFE_FETCH_ALLOW_LOCAL_FOR_TESTS === "1" && process.env.RENDER === undefined;

function isPrivateIp(ip) {
  if (net.isIPv4(ip)) {
    const [a, b, c] = ip.split(".").map(Number);
    return a === 0 || a === 10 || a === 127 || a >= 224
      || (a === 100 && b >= 64 && b <= 127)
      || (a === 169 && b === 254)
      || (a === 172 && b >= 16 && b <= 31)
      || (a === 192 && b === 0 && (c === 0 || c === 2))
      || (a === 192 && b === 168)
      || (a === 198 && (b === 18 || b === 19 || (b === 51 && c === 100)))
      || (a === 203 && b === 0 && c === 113);
  }
  const v6 = String(ip).toLowerCase();
  const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/.exec(v6);
  if (mapped) return isPrivateIp(mapped[1]);
  if (/^::ffff:/.test(v6)) return true;
  // Addresses that carry an IPv4 one inside them, which could be a private one.
  if (v6.startsWith("::") || v6.startsWith("64:ff9b:") || v6.startsWith("2002:") || v6.startsWith("2001:0:")) return true;
  return v6 === "::" || v6 === "::1" || /^f[cd]/.test(v6) || /^fe[89ab]/.test(v6) || v6.startsWith("ff") || v6.startsWith("2001:db8");
}

function safeLookup(hostname, options, callback) {
  const done = typeof options === "function" ? options : callback;
  const opts = typeof options === "function" ? {} : options || {};
  dns.lookup(hostname, { ...opts, all: true }, (error, addresses) => {
    if (error) return done(error);
    if (!addresses.length || (!localAllowed() && addresses.some((row) => isPrivateIp(row.address)))) {
      const refused = new Error(CANT_REACH);
      refused.code = "ENOTFOUND";
      return done(refused);
    }
    if (opts.all) return done(null, addresses);
    return done(null, addresses[0].address, addresses[0].family);
  });
}

const safeAgent = new https.Agent({ lookup: safeLookup });

// A web address we may fetch: https, no login inside it, not a private address.
function checkedUrl(raw) {
  let url;
  try { url = raw instanceof URL ? raw : new URL(String(raw || "").trim()); } catch (_error) { throw new Error("That isn't a web address."); }
  if (localAllowed() && url.protocol === "http:") return url;
  if (url.protocol !== "https:") throw new Error("The address must start with https://.");
  if (url.username || url.password) throw new Error(CANT_REACH);
  const host = url.hostname.replace(/^\[|\]$/g, "");
  if (net.isIP(host) && !localAllowed() && isPrivateIp(host)) throw new Error(CANT_REACH);
  return url;
}

// One request, connecting only through safeLookup. Answers are small, so they're read whole.
const MAX_ANSWER_BYTES = 2 * 1024 * 1024;
function requestOnce(url, init) {
  return new Promise((resolve, reject) => {
    const headers = {};
    new Headers(init.headers || {}).forEach((value, key) => { headers[key] = value; });
    const body = init.body === undefined || init.body === null ? null : Buffer.from(String(init.body));
    if (init.body instanceof URLSearchParams && !headers["content-type"]) headers["content-type"] = "application/x-www-form-urlencoded";
    if (body) headers["content-length"] = String(body.length);
    const secure = url.protocol === "https:";
    const request = (secure ? https : http).request(url, {
      method: init.method || "GET",
      headers,
      signal: init.signal || AbortSignal.timeout(8000),
      ...(secure ? { agent: safeAgent } : { lookup: safeLookup }),
    }, (answer) => {
      const chunks = [];
      let size = 0;
      answer.on("data", (chunk) => {
        size += chunk.length;
        if (size > MAX_ANSWER_BYTES) return request.destroy(new Error(CANT_REACH));
        return chunks.push(chunk);
      });
      answer.on("error", reject);
      answer.on("end", () => {
        const hasBody = ![204, 205, 304].includes(answer.statusCode);
        const out = new Headers();
        Object.entries(answer.headers).forEach(([key, value]) => (Array.isArray(value) ? value : [value]).forEach((one) => out.append(key, one)));
        resolve(new Response(hasBody ? Buffer.concat(chunks) : null, { status: answer.statusCode, statusText: answer.statusMessage, headers: out }));
      });
    });
    request.on("error", reject);
    request.end(body || undefined);
  });
}

// For libraries that take their own fetch. Follows up to three redirects, checking each.
async function safeFetch(input, init = {}, hops = 0) {
  const url = checkedUrl(input instanceof Request ? input.url : input);
  const response = await requestOnce(url, init);
  if (response.status >= 300 && response.status < 400 && response.headers.get("location")) {
    if (hops >= 3) throw new Error(CANT_REACH);
    return safeFetch(new URL(response.headers.get("location"), url), init, hops + 1);
  }
  return response;
}

function lookupPublic(hostname) {
  return new Promise((resolve, reject) => {
    const host = String(hostname).replace(/^\[|\]$/g, "");
    if (net.isIP(host)) {
      if (!localAllowed() && isPrivateIp(host)) return reject(new Error(CANT_REACH));
      return resolve();
    }
    return safeLookup(host, {}, (error) => (error ? reject(error) : resolve()));
  });
}

module.exports = { isPrivateIp, safeLookup, safeAgent, checkedUrl, safeFetch, lookupPublic, localAllowed, CANT_REACH };
