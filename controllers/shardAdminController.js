// The admin pages for shards, school moves and releases.
const registry = require("../utils/shards/registry");
const provision = require("../utils/shards/provision");
const moves = require("../utils/shards/moves");
const releases = require("../utils/shards/releases");
const render = require("../utils/shards/renderApi");
const { routeValue } = require("../utils/shards/signing");
const features = require("../utils/shards/features");

const actorOf = (req) => req.shardActor || "unknown";
const toId = (value) => {
  const id = Number(value);
  return Number.isInteger(id) && id > 0 ? id : null;
};

async function shardsWithFacts() {
  const shards = await registry.listShards({ fresh: true });
  const control = registry.controlDb();
  const [counts, stats] = await Promise.all([
    control.query(`SELECT shard_id, COUNT(*)::int AS schools, COALESCE(SUM(staff_count + student_count + parent_count), 0)::int AS users
                     FROM shard_schools GROUP BY shard_id`).catch(() => ({ rows: [] })),
    Promise.all(shards.map((shard) => (shard.status === "active" ? registry.statsFor(shard) : Promise.resolve({ healthy: false })))),
  ]);
  const byShard = new Map(counts.rows.map((row) => [row.shard_id, row]));
  return shards.map((shard, index) => ({
    ...shard,
    db_url_encrypted: undefined,
    schools: byShard.get(shard.shard_id)?.schools || 0,
    users: byShard.get(shard.shard_id)?.users || 0,
    stats: stats[index],
  }));
}

const statusOf = (shard) => {
  if (shard.status === "provisioning") return { label: "Setting up", tone: "amber" };
  if (shard.status === "failed") return { label: "Failed", tone: "red" };
  if (shard.status === "retired") return { label: "Retired", tone: "muted" };
  if (!shard.stats?.healthy) return { label: "Down", tone: "red" };
  if (shard.environment !== "production") return { label: "Testing", tone: "blue" };
  return { label: "Healthy", tone: "green" };
};

const shardAdmin = {
  overview: async (req, res, next) => {
    try {
      const [shards, activity] = await Promise.all([
        shardsWithFacts(),
        registry.controlDb().query("SELECT * FROM shard_audit ORDER BY created_at DESC LIMIT 25").then(({ rows }) => rows).catch(() => []),
      ]);
      res.render("admin/shards/index", {
        title: "Shards",
        activity,
        shards: shards.map((shard) => ({ ...shard, health: statusOf(shard) })),
        renderReady: render.isConfigured(),
        secretReady: Boolean(process.env.SHARD_SECRET),
      });
    } catch (error) {
      next(error);
    }
  },

  newShard: (req, res) => {
    res.render("admin/shards/new", { title: "Create a shard", renderReady: render.isConfigured(), secretReady: Boolean(process.env.SHARD_SECRET) });
  },

  createShard: async (req, res, next) => {
    try {
      const { errors, shard } = await provision.createShard(req.body);
      if (errors) {
        req.flash("error", errors.join(" "));
        return res.redirect("/admin/shards/new");
      }
      registry.audit(req, "created_shard", shard.name, { environment: shard.environment, region: shard.region });
      return res.redirect(`/admin/shards/${shard.shard_id}`);
    } catch (error) {
      return next(error);
    }
  },

  detail: async (req, res, next) => {
    try {
      const id = toId(req.params.shardId);
      const shards = await shardsWithFacts();
      const shard = shards.find((row) => row.shard_id === id);
      if (!shard) {
        req.flash("error", "That shard doesn't exist.");
        return res.redirect("/admin/shards");
      }
      const control = registry.controlDb();
      const [schools, recent] = await Promise.all([
        control.query(`SELECT d.*, h.name AS hub_name FROM shard_schools d LEFT JOIN shard_hubs h ON h.hub_id = d.hub_id WHERE d.shard_id = $1 ORDER BY h.name NULLS FIRST, LOWER(d.name)`, [id]),
        control.query(
          `SELECT m.*, a.name AS from_name, b.name AS to_name FROM shard_moves m JOIN shards a ON a.shard_id = m.from_shard_id JOIN shards b ON b.shard_id = m.to_shard_id
            WHERE m.from_shard_id = $1 OR m.to_shard_id = $1 ORDER BY m.started_at DESC LIMIT 15`,
          [id]
        ),
      ]);
      return res.render("admin/shards/detail", {
        title: shard.name,
        shard: { ...shard, health: statusOf(shard) },
        schools: schools.rows,
        moves: recent.rows,
        openLink: shard.is_control || !process.env.SHARD_SECRET ? null : `/admin?via=${encodeURIComponent(routeValue(shard.name))}`,
        targets: shards.filter((row) => row.shard_id !== id && row.status === "active" && (row.environment === "production") === (shard.environment === "production")),
      });
    } catch (error) {
      return next(error);
    }
  },

  saveSettings: async (req, res, next) => {
    const id = toId(req.params.shardId);
    const back = `/admin/shards/${id}`;
    try {
      const countries = String(req.body.countries || "").split(/[\s,]+/).map((code) => code.trim().toUpperCase()).filter(Boolean);
      const capacitySchools = Number(req.body.capacitySchools);
      const capacityUsers = Number(req.body.capacityUsers);
      const appUrl = String(req.body.appUrl || "").trim().replace(/\/$/, "");
      const problems = [];
      if (countries.some((code) => !/^[A-Z]{2}$/.test(code))) problems.push("Countries are two-letter codes, like GH, NG.");
      if (!Number.isInteger(capacitySchools) || capacitySchools < 1 || !Number.isInteger(capacityUsers) || capacityUsers < 1) problems.push("Capacity must be a whole number.");
      if (appUrl && !/^https?:\/\//.test(appUrl)) problems.push("The server address starts with https://.");
      if (problems.length) {
        req.flash("error", problems.join(" "));
        return res.redirect(back);
      }
      const control = registry.controlDb();
      const shard = (await control.query("SELECT * FROM shards WHERE shard_id = $1", [id])).rows[0];
      if (!shard) return res.redirect("/admin/shards");
      const acceptsNew = req.body.acceptsNew === "on" && shard.environment === "production";
      await control.query(
        `UPDATE shards SET accepts_new = $2, capacity_schools = $3, capacity_users = $4, countries = $5, app_url = $6, render_service_id = $7, updated_at = NOW() WHERE shard_id = $1`,
        [id, acceptsNew, capacitySchools, capacityUsers, countries, appUrl || null, String(req.body.renderServiceId || "").trim() || null]
      );
      const serviceId = String(req.body.renderServiceId || "").trim();
      if (serviceId && shard.environment === "production" && render.isConfigured()) await render.stopDeployOnPush(serviceId);
      const databaseUrl = String(req.body.databaseUrl || "").trim();
      if (databaseUrl) await control.query("UPDATE shards SET db_url_encrypted = $2 WHERE shard_id = $1", [id, registry.encryptDatabaseUrl(databaseUrl)]);
      registry.forgetShards();
      registry.audit(req, "changed_shard", shard.name, { acceptsNew, capacitySchools, capacityUsers, countries, databaseChanged: Boolean(databaseUrl) });
      req.flash("success", "Saved.");
      return res.redirect(back);
    } catch (error) {
      return next(error);
    }
  },

  setRetired: async (req, res, next) => {
    const id = toId(req.params.shardId);
    try {
      const control = registry.controlDb();
      const retire = req.body.retired === "1";
      const { rows } = await control.query("SELECT COUNT(*)::int AS schools FROM shard_schools WHERE shard_id = $1", [id]);
      const shard = (await control.query("SELECT is_control FROM shards WHERE shard_id = $1", [id])).rows[0];
      if (retire && (shard?.is_control || rows[0].schools)) {
        req.flash("error", shard?.is_control ? "The control shard can't be retired." : "Move its schools to another shard first.");
      } else {
        await control.query("UPDATE shards SET status = $2, accepts_new = FALSE, updated_at = NOW() WHERE shard_id = $1", [id, retire ? "retired" : "active"]);
        registry.forgetShards();
        registry.audit(req, retire ? "retired_shard" : "reactivated_shard", String(id));
        req.flash("success", retire ? "Retired." : "Active.");
      }
      return res.redirect(`/admin/shards/${id}`);
    } catch (error) {
      return next(error);
    }
  },

  startMove: async (req, res) => {
    try {
      const move = await moves.startMove({
        organizationId: toId(req.body.organizationId),
        toShardId: toId(req.body.toShardId),
        rehearsal: req.body.rehearsal === "1" || req.body.rehearsal === true,
        actor: actorOf(req),
      });
      registry.audit(req, move.rehearsal ? "tested_move" : "moved_school", move.school_name, { organizationId: move.organization_id, from: move.from_shard_id, to: move.to_shard_id });
      res.json({ success: true, moveId: move.move_id });
    } catch (error) {
      res.status(error instanceof moves.MoveRefused ? 400 : 500).json({ success: false, message: error.message });
    }
  },

  moveStatus: async (req, res) => {
    const { rows } = await registry.controlDb().query("SELECT move_id, status, rehearsal, steps, summary, error FROM shard_moves WHERE move_id = $1", [toId(req.params.moveId)]);
    if (!rows[0]) return res.status(404).json({ success: false });
    return res.json({ success: true, move: rows[0] });
  },

  retryCleanup: async (req, res) => {
    try {
      await moves.retryCleanup(toId(req.params.moveId));
      registry.audit(req, "removed_old_copy", String(req.params.moveId));
      req.flash("success", "Removed.");
    } catch (error) {
      req.flash("error", error.message);
    }
    res.redirect(req.get("referer") || "/admin/shards");
  },

  features: async (req, res, next) => {
    try {
      res.render("admin/shards/features", { title: "Features", ...(await features.featureList()) });
    } catch (error) {
      next(error);
    }
  },

  saveFeature: async (req, res) => {
    try {
      await features.saveFeature(req.params.featureKey, req.body, actorOf(req));
      registry.audit(req, "changed_feature", req.params.featureKey, { access: req.body.access });
      req.flash("success", "Saved.");
    } catch (error) {
      req.flash("error", error.message);
    }
    res.redirect("/admin/shards/features");
  },

  releases: async (req, res, next) => {
    try {
      await releases.checkOpenDeployments().catch(() => {});
      const [list, shards] = await Promise.all([releases.listReleases(), shardsWithFacts()]);
      res.render("admin/shards/releases", {
        title: "Releases",
        releases: list,
        production: shards.filter((shard) => shard.environment === "production" && shard.status === "active"),
        testing: shards.filter((shard) => shard.environment !== "production" && shard.status === "active"),
        renderReady: render.isConfigured(),
      });
    } catch (error) {
      next(error);
    }
  },

  addCandidate: async (req, res) => {
    try {
      const release = await releases.addCandidate(actorOf(req));
      registry.audit(req, "added_release", release.commit_sha.slice(0, 7));
    } catch (error) {
      req.flash("error", error.message);
    }
    res.redirect("/admin/shards/releases");
  },

  approve: async (req, res) => {
    try {
      const release = await releases.approveRelease(toId(req.params.releaseId), actorOf(req));
      registry.audit(req, "approved_release", release.commit_sha.slice(0, 7));
      req.flash("success", "Approved.");
    } catch (error) {
      req.flash("error", error.message);
    }
    res.redirect("/admin/shards/releases");
  },

  rollOut: async (req, res) => {
    try {
      const ids = [].concat(req.body.shardIds || []).map(toId).filter(Boolean);
      const results = await releases.rollOut(toId(req.params.releaseId), ids, actorOf(req));
      const failed = results.filter((result) => result.error);
      if (failed.length) req.flash("error", failed.map((result) => `${result.shard}: ${result.error}`).join(" "));
      const started = results.filter((result) => !result.error).map((result) => result.shard);
      if (started.length) {
        registry.audit(req, "sent_release", started.join(", "), { releaseId: toId(req.params.releaseId) });
        req.flash("success", `Deploying to ${started.join(", ")}.`);
      }
    } catch (error) {
      req.flash("error", error.message);
    }
    res.redirect("/admin/shards/releases");
  },

  rollBack: async (req, res) => {
    try {
      const deployment = await releases.rollBack(toId(req.params.deploymentId), actorOf(req));
      registry.audit(req, "rolled_back", deployment.commit_sha.slice(0, 7), { shardId: deployment.shard_id });
      req.flash("success", "Rolling back.");
    } catch (error) {
      req.flash("error", error.message);
    }
    res.redirect("/admin/shards/releases");
  },
};

module.exports = shardAdmin;
