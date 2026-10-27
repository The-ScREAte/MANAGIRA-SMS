// Versioned URLs for files in /public: "/css/x.css" -> "/css/x.css?v=<content hash>".
// Static files are cached for a day by the browser and stale-while-revalidate by
// the service worker, so a changed file must get a new URL to be picked up.
// See LIVE below for when the hash is worked out again.
const crypto = require("crypto");
const fs = require("fs");
const path = require("path");

const PUBLIC_DIR = path.join(__dirname, "..", "public");
const versioned = new Map();

// In production the hash is worked out once per process (each deploy is a new
// process); in development it follows edits, so a changed file shows at once.
const LIVE = process.env.NODE_ENV === "production";
const stamps = new Map();

function assetUrl(publicPath) {
  if (!LIVE) {
    try {
      const file = path.join(PUBLIC_DIR, path.normalize(publicPath).replace(/^([/\\])+/, ""));
      const stamp = fs.statSync(file).mtimeMs;
      if (stamps.get(publicPath) !== stamp) { stamps.set(publicPath, stamp); versioned.delete(publicPath); }
    } catch (_) { /* not a file: unchanged */ }
  }
  if (versioned.has(publicPath)) return versioned.get(publicPath);
  let url = publicPath;
  try {
    const file = path.join(PUBLIC_DIR, path.normalize(publicPath).replace(/^([/\\])+/, ""));
    if (file.startsWith(PUBLIC_DIR)) {
      const hash = crypto.createHash("md5").update(fs.readFileSync(file)).digest("hex").slice(0, 10);
      url = `${publicPath}?v=${hash}`;
    }
  } catch (_) {}
  versioned.set(publicPath, url);
  return url;
}

module.exports = { assetUrl };
