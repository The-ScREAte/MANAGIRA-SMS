// The front door: every request for managira.com and its school subdomains comes here
// first and goes on to the shard that holds that school. It keeps no state of its own,
// so it can run as several copies, and it keeps working from its last copy of the
// directory if the control database is briefly away.
//
// Run with: node edge.js   Needs CONTROL_DB_URL, SHARD_SECRET and PORT.
require("dotenv").config();
const http = require("http");
const https = require("https");
const { Pool } = require("pg");
const { ROUTE_COOKIE, edgeToken, routeFromCookies, routeFromValue } = require("./utils/shards/signing");

const BASE_DOMAIN = process.env.SHARD_BASE_DOMAIN || "managira.com";
const REFRESH_MS = Number(process.env.EDGE_REFRESH_MS || 10000);
const UPSTREAM_TIMEOUT_MS = 120000;
const MAX_WEBHOOK_BYTES = 5 * 1024 * 1024;
// Payment and messaging providers post here with no school in the address. Every
// production shard gets it, and the one holding that school's records acts on it.
const WEBHOOKS = [/^\/account\/webhook$/, /^\/account\/paystack-webhook$/, /^\/account\/whatsapp\/webhook$/, /^\/account\/sms\/webhook\//, /^\/account\/settings\/finance\/webhooks\/stripe$/];
const HOP_BY_HOP = new Set(["connection", "keep-alive", "proxy-authenticate", "proxy-authorization", "te", "trailer", "upgrade"]);

const agents = { "http:": new http.Agent({ keepAlive: true, maxSockets: 512 }), "https:": new https.Agent({ keepAlive: true, maxSockets: 512 }) };
const clients = { "http:": http, "https:": https };

let directory = { shards: new Map(), bySubdomain: new Map(), control: null, production: [], loadedAt: 0 };

function parseDirectory(shards, schools, hubs) {
  const byId = new Map(shards.map((shard) => [shard.shard_id, shard]));
  const named = new Map();
  const live = shards.filter((shard) => shard.status === "active" && shard.app_url);
  live.forEach((shard) => named.set(shard.name, { ...shard, url: new URL(shard.app_url) }));
  const bySubdomain = new Map();
  const add = (subdomain, shardId) => {
    const shard = byId.get(shardId);
    if (subdomain && shard && named.has(shard.name)) bySubdomain.set(String(subdomain).toLowerCase(), named.get(shard.name));
  };
  schools.forEach((school) => add(school.subdomain, school.shard_id));
  hubs.forEach((hub) => add(hub.subdomain, hub.shard_id));
  const liveShards = [...named.values()];
  return {
    shards: named,
    bySubdomain,
    control: liveShards.find((shard) => shard.is_control) || null,
    production: liveShards.filter((shard) => shard.environment === "production"),
    loadedAt: Date.now(),
  };
}

// A link emailed by a shard names that shard, signed.
function routeFromLink(path) {
  const query = path.indexOf("?");
  return query < 0 ? null : routeFromValue(new URLSearchParams(path.slice(query + 1)).get("via"));
}

// Which shard answers this request.
function chooseShard(req, current = directory) {
  const host = String(req.headers.host || "").split(":")[0].toLowerCase();
  const path = String(req.url || "");
  const linked = routeFromLink(path);
  if (linked && current.shards.get(linked)) return current.shards.get(linked);
  if (/^\/admin\/shards(\/|$|\?)/.test(path)) return current.control;
  if (host.endsWith(`.${BASE_DOMAIN}`) && host !== `www.${BASE_DOMAIN}`) {
    const labels = host.slice(0, -(BASE_DOMAIN.length + 1)).split(".");
    // school.managira.com or school.hub.managira.com
    const known = current.bySubdomain.get(labels[0]) || (labels[1] && current.bySubdomain.get(labels[1]));
    if (known) return known;
  }
  const named = routeFromCookies(req.headers.cookie);
  return (named && current.shards.get(named)) || current.control;
}

function clientAddress(req) {
  const forwarded = String(req.headers["x-forwarded-for"] || "").split(",").map((part) => part.trim()).filter(Boolean);
  return forwarded[forwarded.length - 1] || req.socket.remoteAddress || "";
}

function upstreamHeaders(req, shard) {
  const headers = {};
  Object.entries(req.headers).forEach(([name, value]) => {
    if (!HOP_BY_HOP.has(name)) headers[name] = value;
  });
  headers.host = shard.url.host;
  headers["x-managira-edge"] = edgeToken();
  headers["x-managira-host"] = req.headers.host || "";
  headers["x-managira-client-ip"] = clientAddress(req);
  headers["x-managira-proto"] = String(req.headers["x-forwarded-proto"] || "http").split(",")[0].trim();
  return headers;
}

function requestTo(shard, req, headers) {
  const { url } = shard;
  return clients[url.protocol].request({
    protocol: url.protocol,
    hostname: url.hostname,
    port: url.port || undefined,
    method: req.method,
    path: req.url,
    headers,
    agent: agents[url.protocol],
    timeout: UPSTREAM_TIMEOUT_MS,
  });
}

function busyPage(res, status = 502) {
  if (res.headersSent) { res.destroy(); return; }
  res.writeHead(status, { "Content-Type": "text/html; charset=utf-8", "Retry-After": "30", "Cache-Control": "no-store" });
  res.end('<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>One moment</title><body style="font:16px system-ui,sans-serif;display:grid;place-items:center;min-height:90vh;margin:0;color:#0f172a;text-align:center"><div><h1 style="font-size:1.3rem;margin:0 0 6px">One moment</h1><p style="margin:0;color:#64748b">Managira will be back shortly. Please try again.</p></div>');
}

function forward(req, res, shard) {
  const upstream = requestTo(shard, req, upstreamHeaders(req, shard));
  upstream.on("response", (answer) => {
    const headers = {};
    Object.entries(answer.headers).forEach(([name, value]) => {
      if (!HOP_BY_HOP.has(name)) headers[name] = value;
    });
    if (routeFromLink(String(req.url || "")) === shard.name) {
      const cookie = `${ROUTE_COOKIE}=${encodeURIComponent(new URLSearchParams(String(req.url).split("?")[1]).get("via"))}; Path=/; Domain=.${BASE_DOMAIN}; Max-Age=2592000; HttpOnly; SameSite=Lax${headers["strict-transport-security"] || String(req.headers["x-forwarded-proto"]).startsWith("https") ? "; Secure" : ""}`;
      headers["set-cookie"] = [].concat(headers["set-cookie"] || [], cookie);
    }
    res.writeHead(answer.statusCode, headers);
    answer.pipe(res);
  });
  upstream.on("timeout", () => upstream.destroy(new Error("timed out")));
  upstream.on("error", (error) => {
    console.error(`[edge] ${shard.name}: ${error.message}`);
    busyPage(res);
  });
  req.on("aborted", () => upstream.destroy());
  req.pipe(upstream);
}

// A provider's retry is the safety net: it only sees success if some shard handled it.
function fanOutWebhook(req, res) {
  const parts = [];
  let size = 0;
  let tooBig = false;
  req.on("data", (part) => {
    size += part.length;
    if (size > MAX_WEBHOOK_BYTES) { tooBig = true; return; }
    parts.push(part);
  });
  req.on("end", async () => {
    if (tooBig) { res.writeHead(413); res.end(); return; }
    const body = Buffer.concat(parts);
    const answers = await Promise.all(directory.production.map((shard) => new Promise((resolve) => {
      const headers = upstreamHeaders(req, shard);
      delete headers["transfer-encoding"];
      headers["content-length"] = String(body.length);
      const upstream = requestTo(shard, req, headers);
      upstream.on("response", (answer) => {
        const chunks = [];
        answer.on("data", (chunk) => chunks.push(chunk));
        answer.on("end", () => resolve({ status: answer.statusCode, body: Buffer.concat(chunks) }));
      });
      upstream.on("timeout", () => upstream.destroy(new Error("timed out")));
      upstream.on("error", () => resolve({ status: 502, body: Buffer.alloc(0) }));
      upstream.end(body);
    })));
    const best = answers.find((answer) => answer.status >= 200 && answer.status < 300) || answers[0] || { status: 502, body: Buffer.alloc(0) };
    res.writeHead(best.status);
    res.end(best.body);
  });
}

function handle(req, res) {
  if (req.url === "/edge/health") {
    const ready = Boolean(directory.control);
    res.writeHead(ready ? 200 : 503, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ status: ready ? "ok" : "starting", shards: directory.shards.size, schools: directory.bySubdomain.size, ageSeconds: Math.round((Date.now() - directory.loadedAt) / 1000) }));
    return;
  }
  const path = String(req.url || "").split("?")[0];
  if (path.startsWith("/internal/")) { res.writeHead(404); res.end(); return; } // Between shards only.
  if (req.method === "POST" && directory.production.length > 1 && WEBHOOKS.some((pattern) => pattern.test(path))) {
    fanOutWebhook(req, res);
    return;
  }
  const shard = chooseShard(req);
  if (!shard) { busyPage(res, 503); return; }
  forward(req, res, shard);
}

async function refresh(pool) {
  const [shards, schools, hubs] = await Promise.all([
    pool.query("SELECT shard_id, name, environment, status, is_control, app_url FROM shards"),
    pool.query("SELECT subdomain, shard_id FROM shard_schools WHERE subdomain IS NOT NULL"),
    pool.query("SELECT subdomain, shard_id FROM shard_hubs WHERE subdomain IS NOT NULL"),
  ]);
  directory = parseDirectory(shards.rows, schools.rows, hubs.rows);
}

function start() {
  const url = process.env.CONTROL_DB_URL;
  if (!url || !process.env.SHARD_SECRET) throw new Error("edge.js needs CONTROL_DB_URL and SHARD_SECRET.");
  const local = /@(localhost|127\.0\.0\.1)[:/]/.test(url);
  const pool = new Pool({ connectionString: url, ssl: local ? false : { rejectUnauthorized: false }, max: 2, application_name: "managira-edge" });
  pool.on("error", (error) => console.error("[edge] control database:", error.message));
  const load = () => refresh(pool).catch((error) => console.error("[edge] directory:", error.message));
  load();
  setInterval(load, REFRESH_MS);
  const server = http.createServer(handle);
  server.keepAliveTimeout = 65000;
  server.headersTimeout = 70000;
  server.listen(Number(process.env.PORT || 10000), () => console.log(`[edge] listening on ${server.address().port}`));
  return server;
}

if (require.main === module) start();

module.exports = { parseDirectory, chooseShard, routeFromLink, WEBHOOKS, clientAddress };
