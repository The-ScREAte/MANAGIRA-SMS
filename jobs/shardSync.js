// Keeps the directory, the platform's reference data and open deployments up to date.
// Quiet when there is nothing to do, and harmless before the shard tables exist.
const db = require("../config/db");
const registry = require("../utils/shards/registry");
const { syncFromControl } = require("../utils/shards/referenceData");
const { checkOpenDeployments } = require("../utils/shards/releases");
const { finishInterruptedMoves } = require("../utils/shards/moves");

const DIRECTORY_MS = Number(process.env.SHARD_DIRECTORY_MS || 5 * 60 * 1000);
const REFERENCE_MS = Number(process.env.SHARD_REFERENCE_MS || 10 * 60 * 1000);
const DEPLOYMENTS_MS = 60 * 1000;

let warned = new Set();
const quietly = (name, work) => async () => {
  try {
    await work();
    warned.delete(name);
  } catch (error) {
    if (!warned.has(name)) console.error(`[shards] ${name}:`, error.message);
    warned.add(name);
  }
};

const syncDirectory = quietly("directory", async () => {
  const me = await registry.thisShard();
  if (me?.status === "active") await registry.syncDirectory(db);
});
const syncReference = quietly("reference data", async () => {
  const me = await registry.thisShard();
  if (me?.status === "active" && !me.is_control) await syncFromControl(db, { environment: me.environment });
});
const checkDeployments = quietly("deployments", async () => {
  const me = await registry.thisShard();
  if (me?.is_control) await checkOpenDeployments();
});
const recoverMoves = quietly("moves", async () => {
  const me = await registry.thisShard();
  if (me?.is_control) await finishInterruptedMoves();
});

const every = (work, ms) => setInterval(work, ms).unref();

setTimeout(() => {
  recoverMoves();
  syncDirectory();
  syncReference();
}, Number(process.env.SHARD_FIRST_SYNC_MS || 20000)).unref();
every(syncDirectory, DIRECTORY_MS);
every(syncReference, REFERENCE_MS);
every(checkDeployments, DEPLOYMENTS_MS);
