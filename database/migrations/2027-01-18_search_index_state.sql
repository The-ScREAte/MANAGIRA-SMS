-- What was last told to search engines (IndexNow) about each public page, so the daily update
-- (utils/searchIndexSync.js) sends only pages that are new or changed. Safe to repeat.
CREATE TABLE IF NOT EXISTS search_index_state (
  url          TEXT PRIMARY KEY,
  last_hash    TEXT NOT NULL,
  submitted_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
