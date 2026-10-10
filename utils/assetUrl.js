// Versioned URLs for files in /public: "/css/x.css" -> "/css/x.css?v=<content hash>".
// Static files are cached for a day by the browser and stale-while-revalidate by
// the service worker, so a changed file must get a new URL to be picked up.
// The hash is computed once per process (deploys and dev restarts recompute it).
const crypto = require("crypto");
const fs = require("fs");
const path = require("path");

const PUBLIC_DIR = path.join(__dirname, "..", "public");
const versioned = new Map();

function assetUrl(publicPath) {
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
