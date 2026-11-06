// A release is a commit that was tried on the test shard. Production shards only receive
// a release someone approved, on the shards they choose, with the old version recorded so
// it can be put back.
const registry = require("./registry");
const render = require("./renderApi");

const CANDIDATE_TITLE = (commit) => `Release ${commit.slice(0, 7)}`;

class ReleaseError extends Error {}

async function listReleases() {
  const control = registry.controlDb();
  const [releases, deployments] = await Promise.all([
    control.query("SELECT * FROM shard_releases ORDER BY created_at DESC LIMIT 30"),
    control.query(`SELECT d.*, s.name AS shard_name FROM shard_deployments d JOIN shards s ON s.shard_id = d.shard_id ORDER BY d.started_at DESC LIMIT 200`),
  ]);
  return releases.rows.map((release) => ({ ...release, deployments: deployments.rows.filter((row) => row.release_id === release.release_id) }));
}

// Whatever the test shard is running right now becomes a release to approve.
async function addCandidate(actor) {
  const test = (await registry.listShards({ fresh: true })).find((shard) => shard.environment !== "production" && shard.status === "active" && !shard.same_database);
  if (!test) throw new ReleaseError("There is no test shard running yet.");
  const stats = await registry.statsFor(test);
  if (!stats.healthy) throw new ReleaseError(`${test.name} isn't answering: ${stats.error}`);
  if (!stats.commit) throw new ReleaseError(`${test.name} doesn't report a version. It reports one when it runs on Render.`);
  const { rows } = await registry.controlDb().query(
    `INSERT INTO shard_releases (commit_sha, title, tested_on, created_by) VALUES ($1, $2, $3, $4)
     ON CONFLICT (commit_sha) DO UPDATE SET tested_on = EXCLUDED.tested_on RETURNING *`,
    [stats.commit, CANDIDATE_TITLE(stats.commit), test.name, actor]
  );
  return rows[0];
}

async function approveRelease(releaseId, actor) {
  const { rows } = await registry.controlDb().query(
    "UPDATE shard_releases SET status = 'approved', approved_by = $2, approved_at = NOW() WHERE release_id = $1 AND status = 'candidate' RETURNING *",
    [releaseId, actor]
  );
  if (!rows[0]) throw new ReleaseError("Only a release waiting for approval can be approved.");
  return rows[0];
}

async function deployTo(shard, commit, { releaseId = null, isRollback = false, actor }) {
  if (!shard.render_service_id) throw new ReleaseError(`${shard.name} has no Render service connected. Add it on its page.`);
  if (!render.isConfigured()) throw new ReleaseError("Deploying needs RENDER_API_KEY, RENDER_OWNER_ID and SHARD_REPO_URL.");
  const before = await registry.statsFor(shard);
  const deploy = await render.deployCommit(shard.render_service_id, commit);
  const { rows } = await registry.controlDb().query(
    `INSERT INTO shard_deployments (release_id, shard_id, commit_sha, previous_commit, render_deploy_id, is_rollback, started_by)
     VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING *`,
    [releaseId, shard.shard_id, commit, before.commit || null, deploy.id || null, isRollback, actor]
  );
  return rows[0];
}

async function rollOut(releaseId, shardIds, actor) {
  const control = registry.controlDb();
  const release = (await control.query("SELECT * FROM shard_releases WHERE release_id = $1", [releaseId])).rows[0];
  if (!release) throw new ReleaseError("That release doesn't exist.");
  if (release.status !== "approved") throw new ReleaseError("Approve the release after testing it, before sending it anywhere.");
  const shards = (await registry.listShards({ fresh: true })).filter((shard) => shardIds.includes(shard.shard_id) && shard.status === "active");
  if (!shards.length) throw new ReleaseError("Choose at least one shard.");
  const results = [];
  for (const shard of shards) {
    try {
      results.push({ shard: shard.name, deployment: await deployTo(shard, release.commit_sha, { releaseId, actor }) });
    } catch (error) {
      results.push({ shard: shard.name, error: error.message });
    }
  }
  return results;
}

async function rollBack(deploymentId, actor) {
  const control = registry.controlDb();
  const deployment = (await control.query("SELECT * FROM shard_deployments WHERE deployment_id = $1", [deploymentId])).rows[0];
  if (!deployment) throw new ReleaseError("That deployment doesn't exist.");
  if (!deployment.previous_commit) throw new ReleaseError("The version before this one wasn't recorded.");
  const shard = (await registry.listShards({ fresh: true })).find((row) => row.shard_id === deployment.shard_id);
  if (!shard) throw new ReleaseError("That shard no longer exists.");
  return deployTo(shard, deployment.previous_commit, { releaseId: deployment.release_id, isRollback: true, actor });
}

// Brings open deployments up to date, and only calls one finished once the shard itself
// says it is running that version.
async function checkOpenDeployments() {
  if (!render.isConfigured()) return 0;
  const control = registry.controlDb();
  const { rows } = await control.query(
    `SELECT d.*, s.render_service_id, s.name, s.app_url, s.environment FROM shard_deployments d JOIN shards s ON s.shard_id = d.shard_id WHERE d.status = 'deploying'`
  );
  for (const deployment of rows) {
    try {
      const deploy = await render.getDeploy(deployment.render_service_id, deployment.render_deploy_id);
      if (render.DEPLOY_FAILED.has(deploy.status)) {
        await control.query("UPDATE shard_deployments SET status = 'failed', error = $2, finished_at = NOW() WHERE deployment_id = $1", [deployment.deployment_id, deploy.status]);
      } else if (deploy.status === "live") {
        const stats = await registry.statsFor({ name: deployment.name, app_url: deployment.app_url, environment: deployment.environment });
        const matches = stats.healthy && (!stats.commit || stats.commit === deployment.commit_sha);
        await control.query(
          "UPDATE shard_deployments SET status = $2, error = $3, finished_at = NOW() WHERE deployment_id = $1",
          [deployment.deployment_id, matches ? "live" : "failed", matches ? null : (stats.commit ? `Still running ${stats.commit.slice(0, 7)}.` : stats.error)]
        );
      }
    } catch (error) {
      console.error("[shards] deployment check:", error.message);
    }
  }
  return rows.length;
}

module.exports = { ReleaseError, listReleases, addCandidate, approveRelease, rollOut, rollBack, checkOpenDeployments };
