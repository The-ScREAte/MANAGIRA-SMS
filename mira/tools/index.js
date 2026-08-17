// Tool registry. Every tool handler receives (args, tenant) - tenant comes
// from the validated session (middleware/tenantScope.js), never from
// client/model input, so a tool can never be tricked into acting outside
// the caller's own organization. Additional tools land in phase 5.
const findStudent = require("./findStudent");

const REGISTRY = {
  [findStudent.name]: findStudent,
};

function listToolSchemas() {
  return Object.values(REGISTRY).map((t) => ({ name: t.name, description: t.description, parameters: t.parameters }));
}

async function runTool(name, args, tenant) {
  const tool = REGISTRY[name];
  if (!tool) {
    return { status: "denied", result: `Unknown tool: ${name}` };
  }
  try {
    const result = await tool.handler(args, tenant);
    return { status: "ok", result };
  } catch (error) {
    console.error(`[mira/tools] ${name} failed`, error);
    return { status: "error", result: error.message };
  }
}

module.exports = { REGISTRY, listToolSchemas, runTool };
