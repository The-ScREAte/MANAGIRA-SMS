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

// 64 random bits (11 characters, URL-safe): a link can't be found by trying codes. Codes made
// before this were 7 characters; they keep working until they expire.
function generateCode() {
  return crypto.randomBytes(8).toString("base64url");
}

// A link to a stored student file (a report card sent by text) works for this long after it was
// made; after that the family signs in to see it. Other links (a web page) don't expire.
const FILE_LINK_DAYS = 90;

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
  const text = String(code || "").trim();
  if (!/^[A-Za-z0-9_-]{6,16}$/.test(text)) return null;
  await ensureShortLinkSchema(dbClient);
  const result = await dbClient.query(
    `SELECT target_url, created_at < NOW() - make_interval(days => $2) AS past_file_age FROM short_links WHERE code = $1 LIMIT 1`,
    [text, FILE_LINK_DAYS]
  );
  const row = result.rows[0];
  if (!row) return null;
  const storedFiles = require("./storedFiles");
  const key = storedFiles.keyOf(row.target_url);
  if (row.past_file_age && key && !storedFiles.isPublicKey(key)) return null;
  return row.target_url;
}

module.exports = {
  FILE_LINK_DAYS,
  ensureShortLinkSchema,
  createShortLink,
  resolveShortLink,
};
