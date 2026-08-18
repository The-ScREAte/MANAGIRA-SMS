// Mira's own tables - all prefixed `mira_`, never colliding with the main
// app's schema even though they may live in the same physical Postgres
// instance today (see config/db.js). Idempotent DDL, same
// ensureXSchema(db) convention as the main app (utils/smsIntegration.js
// etc.) - called lazily on first use, not eagerly at boot.
let schemaReady = false;

async function ensureMiraSchema(db) {
  if (schemaReady) return;

  await db.query(`
    CREATE TABLE IF NOT EXISTS mira_chats (
      id              SERIAL PRIMARY KEY,
      tenant_id       INTEGER NOT NULL,
      user_id         INTEGER NOT NULL,
      viewer_type     VARCHAR(10) NOT NULL DEFAULT 'staff' CHECK (viewer_type IN ('staff','guardian','student')),
      title           VARCHAR(255) NOT NULL DEFAULT 'New chat',
      project_id      VARCHAR(64) NULL,
      created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `);
  await db.query(`CREATE INDEX IF NOT EXISTS mira_chats_tenant_user_idx ON mira_chats(tenant_id, viewer_type, user_id, updated_at DESC)`);

  await db.query(`
    CREATE TABLE IF NOT EXISTS mira_chat_messages (
      id              SERIAL PRIMARY KEY,
      chat_id         INTEGER NOT NULL REFERENCES mira_chats(id) ON DELETE CASCADE,
      role            VARCHAR(16) NOT NULL CHECK (role IN ('user','assistant','tool')),
      content         TEXT NOT NULL,
      tool_calls      JSONB NULL,
      feedback        VARCHAR(10) NULL CHECK (feedback IN ('like','dislike')),
      created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `);
  await db.query(`ALTER TABLE mira_chat_messages ADD COLUMN IF NOT EXISTS feedback VARCHAR(10) NULL`);
  await db.query(`CREATE INDEX IF NOT EXISTS mira_chat_messages_chat_idx ON mira_chat_messages(chat_id, created_at ASC)`);

  await db.query(`
    CREATE TABLE IF NOT EXISTS mira_tool_call_log (
      id              SERIAL PRIMARY KEY,
      tenant_id       INTEGER NOT NULL,
      user_id         INTEGER NOT NULL,
      chat_id         INTEGER NULL REFERENCES mira_chats(id) ON DELETE SET NULL,
      tool_name       VARCHAR(64) NOT NULL,
      arguments       JSONB NOT NULL DEFAULT '{}'::jsonb,
      result_summary  TEXT NULL,
      status          VARCHAR(16) NOT NULL DEFAULT 'ok' CHECK (status IN ('ok','denied','error')),
      created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `);
  await db.query(`CREATE INDEX IF NOT EXISTS mira_tool_call_log_tenant_idx ON mira_tool_call_log(tenant_id, created_at DESC)`);

  await db.query(`
    CREATE TABLE IF NOT EXISTS mira_usage_ledger (
      id              SERIAL PRIMARY KEY,
      tenant_id       INTEGER NOT NULL,
      user_id         INTEGER NOT NULL,
      provider        VARCHAR(32) NOT NULL,
      model           VARCHAR(64) NOT NULL,
      prompt_tokens   INTEGER NOT NULL DEFAULT 0,
      completion_tokens INTEGER NOT NULL DEFAULT 0,
      estimated_cost_usd NUMERIC(10,6) NOT NULL DEFAULT 0,
      created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `);
  await db.query(`CREATE INDEX IF NOT EXISTS mira_usage_ledger_tenant_day_idx ON mira_usage_ledger(tenant_id, created_at)`);

  await db.query(`
    CREATE TABLE IF NOT EXISTS mira_tenant_limits (
      tenant_id             INTEGER PRIMARY KEY,
      daily_cost_cap_usd    NUMERIC(10,2) NULL,
      monthly_cost_cap_usd  NUMERIC(10,2) NULL,
      requests_per_minute   INTEGER NOT NULL DEFAULT 20,
      updated_at            TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `);

  // Vector store. CREATE EXTENSION requires privileges most managed
  // Postgres plans grant by default (confirmed available, not yet enabled,
  // on this project's instance) - if it's not permitted in a given
  // environment this throws clearly rather than silently degrading, since
  // RAG is non-functional without it.
  await db.query(`CREATE EXTENSION IF NOT EXISTS vector`);
  await db.query(`
    CREATE TABLE IF NOT EXISTS mira_embeddings (
      id              SERIAL PRIMARY KEY,
      tenant_id       INTEGER NOT NULL,
      source_type     VARCHAR(32) NOT NULL,
      source_id       VARCHAR(64) NOT NULL,
      content         TEXT NOT NULL,
      embedding       VECTOR(1536) NOT NULL,
      updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
      UNIQUE (tenant_id, source_type, source_id)
    )
  `);
  await db.query(`CREATE INDEX IF NOT EXISTS mira_embeddings_tenant_idx ON mira_embeddings(tenant_id, source_type)`);
  await db.query(`
    CREATE INDEX IF NOT EXISTS mira_embeddings_vector_idx ON mira_embeddings
    USING hnsw (embedding vector_cosine_ops)
  `);

  schemaReady = true;
}

module.exports = { ensureMiraSchema };
