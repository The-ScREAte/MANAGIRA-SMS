// Embeds text and retrieves context for the orchestrator. Uses OpenAI's
// embeddings API when a key is configured; otherwise falls back to a
// deterministic mock embedding (same 1536 dimensionality, so pgvector
// storage/search is exercised end to end) - clearly not semantically
// meaningful, only for proving the RAG plumbing without a live key.
const crypto = require("crypto");
const vectorStore = require("./vectorStore");

const EMBEDDING_DIMENSIONS = 1536;
const MOCK_EMBEDDINGS = !process.env.OPENAI_API_KEY;

function mockEmbed(text) {
  // Deterministic pseudo-embedding: hash the text into a seed, then
  // generate a reproducible vector from it. Same input -> same vector,
  // so search behavior is at least stable/testable even though it
  // carries no real semantic meaning.
  const seed = crypto.createHash("sha256").update(text).digest();
  const vector = new Array(EMBEDDING_DIMENSIONS);
  for (let i = 0; i < EMBEDDING_DIMENSIONS; i++) {
    const byte = seed[i % seed.length];
    vector[i] = (byte / 255) * 2 - 1; // normalize to [-1, 1]
  }
  return vector;
}

async function embedText(text) {
  if (MOCK_EMBEDDINGS) return mockEmbed(text);

  const OpenAI = require("openai");
  const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  const response = await client.embeddings.create({ model: "text-embedding-3-small", input: text });
  return response.data[0].embedding;
}

// Called by jobs/reindexWorker.js (queued) or inline when Redis/BullMQ
// isn't configured (see services/queue.js).
async function reindexSource({ tenantId, sourceType, sourceId, content }) {
  const embedding = await embedText(content);
  await vectorStore.upsertEmbedding({ tenantId, sourceType, sourceId, content, embedding });
  return { tenantId, sourceType, sourceId, dimensions: embedding.length };
}

// Called by the orchestrator before the model call - returns the top
// matching chunks of previously-indexed content for this tenant, to
// splice into the system/context messages.
async function retrieveContext({ tenantId, query, limit = 5 }) {
  const embedding = await embedText(query);
  const matches = await vectorStore.search({ tenantId, embedding, limit });
  return matches;
}

module.exports = { embedText, reindexSource, retrieveContext, MOCK_EMBEDDINGS, EMBEDDING_DIMENSIONS };
