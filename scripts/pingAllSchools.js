/**
 * scripts/pingAllSchools.js
 *
 * One-time script: submit ALL existing school URLs to IndexNow so Google,
 * Bing, and Yandex discover them immediately — without waiting for
 * organic crawling.
 *
 * IndexNow accepts up to 10,000 URLs in a single POST, so even large
 * databases are submitted in one shot.
 *
 * Usage:
 *   node scripts/pingAllSchools.js
 *
 * Prerequisites:
 *   - INDEXNOW_KEY and DB_CONNECTION_STRING must be in .env
 *   - The key file must be live at https://www.managira.com/<key>.txt
 *
 * HTTP 200 / 202 = accepted. HTTP 422 = key file not reachable yet.
 */
require("dotenv").config();
const https = require("https");
const { Pool } = require("pg");

const pool = new Pool({
  connectionString: process.env.DB_CONNECTION_STRING,
  ssl: { rejectUnauthorized: false },
});

// ── Helper: POST JSON and return status + body ────────────────────────────────
function postJson(hostname, path, body) {
  return new Promise((resolve, reject) => {
    const data = JSON.stringify(body);
    const req = https.request(
      {
        hostname,
        path,
        method: "POST",
        headers: {
          "Content-Type": "application/json; charset=utf-8",
          "Content-Length": Buffer.byteLength(data),
        },
      },
      (res) => {
        let buf = "";
        res.on("data", (c) => (buf += c));
        res.on("end", () => resolve({ status: res.statusCode, body: buf.trim() }));
      }
    );
    req.on("error", reject);
    req.write(data);
    req.end();
  });
}

// ── Main ─────────────────────────────────────────────────────────────────────
async function run() {
  const key = process.env.INDEXNOW_KEY;
  if (!key) {
    console.error("❌  INDEXNOW_KEY is not set in .env");
    process.exit(1);
  }

  // Fetch all active organizations that have a subdomain
  const { rows } = await pool.query(
    `SELECT nickname, organization_name
     FROM organizations
     WHERE deleted = false
       AND nickname IS NOT NULL
       AND nickname <> ''
     ORDER BY organization_name ASC`
  );

  if (rows.length === 0) {
    console.log("No organizations found in the database.");
    return;
  }

  console.log(`Found ${rows.length} organization(s).\n`);

  // Build URL list — school homepages + the public directory page
  const schoolUrls = rows.map((r) => `https://${r.nickname}.managira.com/`);
  const urlList = [
    ...schoolUrls,
    "https://www.managira.com/legal/directory",
  ];

  const body = {
    host: "managira.com",
    key,
    keyLocation: `https://www.managira.com/${key}.txt`,
    urlList,
  };

  console.log(`Submitting ${urlList.length} URL(s) to IndexNow...\n`);

  // ── Submit to api.indexnow.org (aggregates to Google, Bing, Yandex, etc.) ──
  try {
    const r = await postJson("api.indexnow.org", "/IndexNow", body);
    const ok = r.status === 200 || r.status === 202;
    console.log(
      `${ok ? "✅" : "❌"}  api.indexnow.org → HTTP ${r.status}${r.body ? ` — ${r.body}` : ""}`
    );
    if (r.status === 422) {
      console.warn(
        "   HTTP 422 means the key file at https://www.managira.com/" +
          key +
          ".txt is not reachable yet.\n   Deploy the app with the file, then re-run this script."
      );
    }
  } catch (err) {
    console.error(`❌  api.indexnow.org error: ${err.message}`);
  }

  // ── Also submit directly to Bing ──────────────────────────────────────────
  try {
    const r = await postJson("www.bing.com", "/IndexNow", body);
    const ok = r.status === 200 || r.status === 202;
    console.log(
      `${ok ? "✅" : "❌"}  www.bing.com      → HTTP ${r.status}${r.body ? ` — ${r.body}` : ""}`
    );
  } catch (err) {
    console.error(`❌  www.bing.com error: ${err.message}`);
  }

  // ── Summary ───────────────────────────────────────────────────────────────
  console.log("\n── Schools submitted ────────────────────────────────────────");
  rows.forEach((r) =>
    console.log(`   ${r.organization_name.padEnd(45)} → https://${r.nickname}.managira.com/`)
  );
  console.log("─────────────────────────────────────────────────────────────");
  console.log("\nDone. Google/Bing will crawl and index these pages within 1–3 days.");
  console.log(
    "Tip: go to Google Search Console → Sitemaps and submit\n" +
      "     https://www.managira.com/sitemap-schools.xml\n" +
      "to speed up discovery further.\n"
  );

  await pool.end();
}

run().catch((err) => {
  console.error("Fatal error:", err);
  pool.end();
  process.exit(1);
});
