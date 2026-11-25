// utils/searchIndexSync.js
// Tells search engines about public pages that are NEW or CHANGED, once per change.
// Builds the current public URL list (help guides, key pages, listed school pages), compares each
// page's fingerprint with what was last submitted (table search_index_state), and sends only the
// difference in one notifyAll() call. Runs after a deploy/start and daily (jobs/scheduler.js).
// Never throws; does nothing unless utils/searchNotify.enabled().
const crypto = require("crypto");
const searchNotify = require("./searchNotify");

const sha = (text) => crypto.createHash("sha256").update(String(text)).digest("hex").slice(0, 32);

async function ensureTable(db) {
  await db.query(`CREATE TABLE IF NOT EXISTS search_index_state (
    url TEXT PRIMARY KEY, last_hash TEXT NOT NULL, submitted_at TIMESTAMPTZ NOT NULL DEFAULT NOW())`);
}

// [{ url, hash }]. A page's hash is its real last-change time; a school page is hashed by being
// listed at all (edits to it are sent when they are made, see utils/sitemapPing.js).
async function currentPages(db) {
  const pages = (await require("./aiDiscovery").publicUrls(db)).map((u) => ({ url: u.loc, hash: sha(u.lastmod.toISOString()) }));
  const schools = await require("./publicSchools").listPublicSchools(db).catch(() => []);
  for (const s of schools) pages.push({ url: `https://${s.nickname}.managira.com/`, hash: sha("listed") });
  return pages;
}

async function runSearchIndexSync(db, opts = {}) {
  try {
    if (!searchNotify.enabled(opts.env)) return { sent: 0, skipped: "off" };
    try { await ensureTable(db); } catch (error) {
      console.error("[SearchNotify] state table unavailable, skipping:", error.message);
      return { sent: 0, skipped: "no-table" };
    }
    const pages = await currentPages(db);
    const { rows } = await db.query("SELECT url, last_hash FROM search_index_state");
    const known = new Map(rows.map((r) => [r.url, r.last_hash]));
    const changed = pages.filter((p) => known.get(p.url) !== p.hash);
    if (!changed.length) return { sent: 0, skipped: "nothing-changed" };
    const result = await searchNotify.notifyAll(changed.map((p) => p.url), opts.reason || "changed pages", opts);
    if (result.ok) {
      // Remember only what was accepted; a failed send is tried again next run.
      for (let i = 0; i < changed.length; i += 500) {
        const part = changed.slice(i, i + 500);
        await db.query(
          `INSERT INTO search_index_state (url, last_hash, submitted_at)
           SELECT u, h, NOW() FROM unnest($1::text[], $2::text[]) AS t(u, h)
           ON CONFLICT (url) DO UPDATE SET last_hash = EXCLUDED.last_hash, submitted_at = NOW()`,
          [part.map((p) => p.url), part.map((p) => p.hash)]
        );
      }
    }
    return { sent: result.sent, ok: result.ok };
  } catch (error) {
    console.error("[SearchNotify] daily update failed:", error && error.message);
    return { sent: 0, ok: false };
  }
}

module.exports = { runSearchIndexSync, currentPages };
