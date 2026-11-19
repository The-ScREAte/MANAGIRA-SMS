// Read tools in one shape: each calls GET /internal/api/read/<name> on the main app
// (utils/miraRead there) as the signed-in person, and returns its envelope as is:
// { ok, as_of, data, totals, scope, truncated, untrusted? } or { ok: false, error_code, error_message }.
// A group file (tools/read/<group>.js) exports { areas?, tools: [readTool({...})] }:
//   name, description, parameters (JSON schema), query(args) -> { key: value } for the query string,
//   access: { anyOf: [permission keys] } | { allOf: [...] } | { open: true } (+ feature?), the same
//   permissions as the page; areas: router areas it belongs to (services/toolSelector.js, or one the
//   group declares in `areas`); coverage: the Managira area it reads (mira/coverage.json).
const { callInternalApi } = require("../../internalApiClient");

const IDENTITY = new Set(["organizationId", "organization_id", "userId", "userRole", "accountType", "userEmail", "viewerType", "tenantId"]);

function clean(value) {
  if (value === undefined || value === null || value === "") return null;
  if (Array.isArray(value)) return value.map((v) => String(v).slice(0, 120)).join(",");
  return String(value).slice(0, 200);
}

function readTool(def) {
  if (!def.name || !def.description || !def.access || !Array.isArray(def.areas) || !def.areas.length) {
    throw new Error(`read tool ${def.name || "?"} needs name, description, access and areas`);
  }
  return {
    name: def.name,
    description: def.description,
    parameters: def.parameters || { type: "object", properties: {} },
    access: def.access,
    areas: def.areas,
    coverage: def.coverage || null,
    level: 0,
    async handler(args, tenant, context) {
      const params = new URLSearchParams();
      if (context && context.timeZone) params.set("timeZone", String(context.timeZone).slice(0, 64));
      Object.entries((def.query ? def.query(args || {}) : args) || {}).forEach(([key, value]) => {
        // Who is asking and for which school come only from the session (internalApiClient).
        if (IDENTITY.has(key)) return;
        const v = clean(value);
        if (v !== null) params.set(key, v);
      });
      try {
        const result = await callInternalApi(`/internal/api/read/${def.name}${params.toString() ? `?${params}` : ""}`);
        return def.shape ? def.shape(result, args) : result;
      } catch (error) {
        if (error.status === 403 && (!error.code || error.code === "PERMISSION_DENIED")) {
          error.denied = true;
          throw error;
        }
        return { ok: false, error_code: error.code || (error.status === 404 ? "NOT_FOUND" : "FAILED"), error_message: error.message };
      }
    },
  };
}

module.exports = { readTool };
