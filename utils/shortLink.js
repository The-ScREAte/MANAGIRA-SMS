// Cost trap #2: a presigned S3 report/transcript URL is 200-300+ chars on
// its own — that alone burns 2-4 SMS segments before any actual message
// text is counted. This gives every long link a short /r/<code> redirect
// instead, so the link costs the same handful of characters regardless of
// how long the real S3 URL is.
const crypto = require("crypto");

let schemaReady = false;

async function ensureShortLinkSchema(dbClient) {
  if (schemaReady) return;
  await dbClient.query(`
    CREATE TABLE IF NOT EXISTS short_links (
      code TEXT PRIMARY KEY,
      target_url TEXT NOT NULL,
      organization_id INTEGER,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
  await dbClient.query(`CREATE INDEX IF NOT EXISTS idx_short_links_org ON short_links (organization_id, created_at DESC)`);
  schemaReady = true;
}

function generateCode() {
  // Base62-ish via base64url, trimmed — short, URL-safe, unambiguous enough
  // for a one-time text link (not meant to be typed by hand).
  return crypto.randomBytes(5).toString("base64url").slice(0, 7);
}

// baseUrl: protocol+host of the request making the link (e.g. "https://managira.com"),
// so the shortened link always points back at whichever host generated it.
async function createShortLink(dbClient, { targetUrl, organizationId, baseUrl }) {
  const url = String(targetUrl || "").trim();
  if (!url) throw new Error("targetUrl is required.");
  await ensureShortLinkSchema(dbClient);

  let code = generateCode();
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const result = await dbClient.query(
      `INSERT INTO short_links (code, target_url, organization_id)
       VALUES ($1, $2, $3)
       ON CONFLICT (code) DO NOTHING
       RETURNING code`,
      [code, url, organizationId || null]
    );
    if (result.rows.length) break;
    code = generateCode();
  }

  const base = String(baseUrl || "").replace(/\/+$/, "");
  return `${base}/r/${code}`;
}

async function resolveShortLink(dbClient, code) {
  await ensureShortLinkSchema(dbClient);
  const result = await dbClient.query(`SELECT target_url FROM short_links WHERE code = $1 LIMIT 1`, [String(code || "").trim()]);
  return result.rows[0]?.target_url || null;
}

module.exports = {
  ensureShortLinkSchema,
  createShortLink,
  resolveShortLink,
};
