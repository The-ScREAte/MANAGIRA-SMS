// pgvector-backed vector store, in Mira's own schema (mira_embeddings).
// Deliberately behind a small interface (upsert/search) so a dedicated
// vector service can be swapped in later without touching ragService.js
// or any tool - only this file would change.
const db = require("../config/db");
const { ensureMiraSchema } = require("../db/schema");

function toVectorLiteral(embedding) {
  return `[${embedding.join(",")}]`;
}

async function upsertEmbedding({ tenantId, sourceType, sourceId, content, embedding }) {
  await ensureMiraSchema(db);
  await db.query(
    `INSERT INTO mira_embeddings (tenant_id, source_type, source_id, content, embedding, updated_at)
     VALUES ($1, $2, $3, $4, $5, now())
     ON CONFLICT (tenant_id, source_type, source_id)
     DO UPDATE SET content = EXCLUDED.content, embedding = EXCLUDED.embedding, updated_at = now()`,
    [tenantId, sourceType, String(sourceId), content, toVectorLiteral(embedding)]
  );
}

// Cosine-distance nearest neighbors, scoped to tenantId - never searches
// across tenants, even if the caller somehow supplied a bad query.
async function search({ tenantId, embedding, limit = 5, sourceType }) {
  await ensureMiraSchema(db);
  const params = [tenantId, toVectorLiteral(embedding), limit];
  let sourceFilter = "";
  if (sourceType) {
    params.push(sourceType);
    sourceFilter = `AND source_type = $${params.length}`;
  }
  const result = await db.query(
    `SELECT source_type, source_id, content, 1 - (embedding <=> $2::vector) AS similarity
     FROM mira_embeddings
     WHERE tenant_id = $1 ${sourceFilter}
     ORDER BY embedding <=> $2::vector ASC
     LIMIT $3`,
    params
  );
  return result.rows;
}

async function deleteEmbedding({ tenantId, sourceType, sourceId }) {
  await ensureMiraSchema(db);
  await db.query(`DELETE FROM mira_embeddings WHERE tenant_id = $1 AND source_type = $2 AND source_id = $3`, [
    tenantId,
    sourceType,
    String(sourceId),
  ]);
}

module.exports = { upsertEmbedding, search, deleteEmbedding };
