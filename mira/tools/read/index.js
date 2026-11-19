// Every group file in this folder (not starting with "_"): their tools, and any router areas
// they add. Read by tools/index.js (the registry), services/access.js (each tool's rule) and
// services/toolSelector.js (areas and keywords).
const fs = require("fs");
const path = require("path");

const tools = [];
const areas = {};
fs.readdirSync(__dirname)
  .filter((file) => file.endsWith(".js") && file !== "index.js" && !file.startsWith("_"))
  .sort()
  .forEach((file) => {
    const group = require(path.join(__dirname, file));
    (group.tools || []).forEach((tool) => tools.push(tool));
    Object.entries(group.areas || {}).forEach(([key, area]) => {
      if (areas[key]) throw new Error(`read area ${key} is declared twice`);
      areas[key] = area;
    });
  });

module.exports = { tools, areas };
