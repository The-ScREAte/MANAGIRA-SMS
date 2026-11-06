// Starting a school's move from the admin page and keeping its record: progress, result,
// and what to do if the server restarted halfway.
const { connectTo } = require("./catalog");
const { moveSchool, retryRemoval, setMoveState, MoveRefused } = require("./moveSchool");
const registry = require("./registry");

async function addStep(control, moveId, text) {
  await control.query(
    "UPDATE shard_moves SET steps = steps || $2::jsonb WHERE move_id = $1",
    [moveId, JSON.stringify([{ at: new Date().toISOString(), text }])]
  ).catch(() => {});
}

async function startMove({ organizationId, toShardId, rehearsal, actor }) {
  const control = registry.controlDb();
  const school = (await control.query(
    "SELECT d.*, s.environment AS from_environment FROM shard_schools d JOIN shards s ON s.shard_id = d.shard_id WHERE d.organization_id = $1",
    [organizationId]
  )).rows[0];
  if (!school) throw new MoveRefused("That school isn't in the directory yet.");
  const shards = await registry.listShards({ fresh: true });
  const from = shards.find((shard) => shard.shard_id === school.shard_id);
  const to = shards.find((shard) => shard.shard_id === Number(toShardId));
  if (!to || to.status !== "active") throw new MoveRefused("Choose a shard that is running.");
  if (from.shard_id === to.shard_id) throw new MoveRefused("The school is already on that shard.");
  if (from.environment === "production" && to.environment !== "production") throw new MoveRefused("Real schools can't go to a test shard.");
  if (from.environment !== "production" && to.environment === "production") throw new MoveRefused("Test schools can't go to a production shard.");
  // A hub and all its schools move together.
  const members = school.hub_id
    ? (await control.query("SELECT organization_id FROM shard_schools WHERE hub_id = $1", [school.hub_id])).rows.map((row) => row.organization_id)
    : [organizationId];
  const hubName = school.hub_id ? (await control.query("SELECT name FROM shard_hubs WHERE hub_id = $1", [school.hub_id])).rows[0]?.name : null;
  if (!rehearsal) {
    const { rows } = await control.query("SELECT COUNT(*)::int AS schools FROM shard_schools WHERE shard_id = $1", [to.shard_id]);
    if (rows[0].schools + members.length > to.capacity_schools) throw new MoveRefused(`${to.name} is full.`);
  }
  const running = await control.query("SELECT 1 FROM shard_moves WHERE organization_ids && $1::int[] AND status = 'running'", [members]);
  if (running.rows.length) throw new MoveRefused("Already moving.");

  const sourceUrl = registry.shardDatabaseUrl(from);
  const destinationUrl = registry.shardDatabaseUrl(to);
  const move = (await control.query(
    `INSERT INTO shard_moves (organization_id, organization_ids, hub_id, school_name, from_shard_id, to_shard_id, rehearsal, requested_by)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING *`,
    [organizationId, members, school.hub_id, hubName || school.name, from.shard_id, to.shard_id, Boolean(rehearsal), actor]
  )).rows[0];

  runMove(move, { sourceUrl, destinationUrl }).catch((error) => console.error("[shards] move:", error.message));
  return move;
}

async function runMove(move, { sourceUrl, destinationUrl }) {
  const control = registry.controlDb();
  const ids = move.organization_ids;
  try {
    if (!move.rehearsal) await control.query("UPDATE shard_schools SET status = 'moving', updated_at = NOW() WHERE organization_id = ANY($1::int[])", [ids]);
    const summary = await moveSchool({
      organizationIds: ids,
      hubId: move.hub_id,
      sourceUrl,
      destinationUrl,
      rehearsal: move.rehearsal,
      onStep: (text) => addStep(control, move.move_id, text),
      repoint: async () => {
        await control.query("UPDATE shard_schools SET shard_id = $2, status = 'active', updated_at = NOW() WHERE organization_id = ANY($1::int[])", [ids, move.to_shard_id]);
        if (move.hub_id) await control.query("UPDATE shard_hubs SET shard_id = $2, updated_at = NOW() WHERE hub_id = $1", [move.hub_id, move.to_shard_id]);
      },
    });
    await control.query(
      "UPDATE shard_moves SET status = $2, summary = $3, error = $4, finished_at = NOW() WHERE move_id = $1",
      [move.move_id, summary.cleanupError ? "needs_cleanup" : "done", JSON.stringify(summary), summary.cleanupError || null]
    );
  } catch (error) {
    if (!move.rehearsal) await control.query("UPDATE shard_schools SET status = 'active', updated_at = NOW() WHERE organization_id = ANY($1::int[]) AND shard_id = $2", [ids, move.from_shard_id]).catch(() => {});
    await control.query("UPDATE shard_moves SET status = 'failed', error = $2, finished_at = NOW() WHERE move_id = $1", [move.move_id, error.message]);
  }
}

// The old copy couldn't be removed at the end of a move: try again.
async function retryCleanup(moveId) {
  const control = registry.controlDb();
  const move = (await control.query("SELECT * FROM shard_moves WHERE move_id = $1 AND status = 'needs_cleanup'", [moveId])).rows[0];
  if (!move) throw new MoveRefused("Nothing to remove.");
  const from = (await registry.listShards({ fresh: true })).find((shard) => shard.shard_id === move.from_shard_id);
  await retryRemoval({ organizationIds: move.organization_ids, hubId: move.hub_id, sourceUrl: registry.shardDatabaseUrl(from) });
  await control.query("UPDATE shard_moves SET status = 'done', error = NULL WHERE move_id = $1", [moveId]);
}

// After a restart: the destination's transaction died with the connection, so the copy
// was never committed. Whatever was paused goes back to normal.
async function finishInterruptedMoves() {
  const control = registry.controlDb();
  const { rows } = await control.query("SELECT * FROM shard_moves WHERE status = 'running' AND started_at < NOW() - INTERVAL '2 minutes'");
  for (const move of rows) {
    const shards = await registry.listShards({ fresh: true });
    const from = shards.find((shard) => shard.shard_id === move.from_shard_id);
    const directory = (await control.query("SELECT shard_id FROM shard_schools WHERE organization_id = $1", [move.organization_id])).rows[0];
    const alreadyThere = directory?.shard_id === move.to_shard_id;
    if (!alreadyThere && !move.rehearsal) {
      const source = connectTo(registry.shardDatabaseUrl(from));
      await source.connect();
      await setMoveState(source, { ids: move.organization_ids, hubId: move.hub_id }, null, "moving").finally(() => source.end());
      await control.query("UPDATE shard_schools SET status = 'active' WHERE organization_id = ANY($1::int[])", [move.organization_ids]);
    }
    await control.query(
      "UPDATE shard_moves SET status = $2, error = $3, finished_at = NOW() WHERE move_id = $1",
      [move.move_id, alreadyThere ? "needs_cleanup" : "failed", alreadyThere ? "Restarted while removing the old copy." : "Restarted. Nothing moved. Try again."]
    );
  }
}

module.exports = { startMove, retryCleanup, finishInterruptedMoves, MoveRefused };
