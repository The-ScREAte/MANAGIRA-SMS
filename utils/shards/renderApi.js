// A small client for Render's API: the servers and databases shards run on.
const BASE = process.env.RENDER_API_BASE || "https://api.render.com/v1";

const isConfigured = () => Boolean(process.env.RENDER_API_KEY && process.env.RENDER_OWNER_ID && process.env.SHARD_REPO_URL);

async function call(method, path, body) {
  const response = await fetch(`${BASE}${path}`, {
    method,
    headers: { Authorization: `Bearer ${process.env.RENDER_API_KEY}`, Accept: "application/json", ...(body ? { "Content-Type": "application/json" } : {}) },
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(30000),
  });
  const text = await response.text();
  if (!response.ok) {
    let message = text.slice(0, 300);
    try { message = JSON.parse(text).message || message; } catch (_error) { /* plain text */ }
    throw new Error(`Render said: ${message} (${response.status})`);
  }
  return text ? JSON.parse(text) : {};
}

const createPostgres = ({ name, plan, region, version = "18" }) => call("POST", "/postgres", {
  name,
  ownerId: process.env.RENDER_OWNER_ID,
  plan,
  region,
  version,
  databaseName: name.replace(/-/g, "_"),
  databaseUser: `${name.replace(/-/g, "_")}_admin`,
});
const getPostgres = (id) => call("GET", `/postgres/${id}`);
const postgresConnection = (id) => call("GET", `/postgres/${id}/connection-info`);

const createService = ({ name, plan, region, branch, envVars, deployOnPush = false }) => call("POST", "/services", {
  type: "web_service",
  name,
  ownerId: process.env.RENDER_OWNER_ID,
  repo: process.env.SHARD_REPO_URL,
  branch,
  autoDeployTrigger: deployOnPush ? "commit" : "off",
  envVars,
  serviceDetails: {
    runtime: "node",
    plan,
    region,
    healthCheckPath: "/health",
    numInstances: 1,
    preDeployCommand: "npm run migrate",
    envSpecificDetails: { buildCommand: "npm ci", startCommand: "node server.js" },
  },
});
const getService = (id) => call("GET", `/services/${id}`);
// A push to GitHub must never reach this shard by itself.
const stopDeployOnPush = (id) => call("PATCH", `/services/${id}`, { autoDeployTrigger: "off" });

const deployCommit = (serviceId, commitId) => call("POST", `/services/${serviceId}/deploys`, { commitId });
const getDeploy = (serviceId, deployId) => call("GET", `/services/${serviceId}/deploys/${deployId}`);

const DEPLOY_FAILED = new Set(["build_failed", "update_failed", "canceled", "pre_deploy_failed", "deactivated"]);

module.exports = { isConfigured, createPostgres, getPostgres, postgresConnection, createService, getService, stopDeployOnPush, deployCommit, getDeploy, DEPLOY_FAILED };
