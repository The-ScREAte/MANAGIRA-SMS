// The app's shared stylesheets as one file, so a page makes one request for
// them instead of ~17 before it can show anything (on a slow connection every
// request is a full round trip). Files are joined in the order head.ejs used to
// list them, so the styles apply exactly as before. Built once per server start.
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const CSS_DIR = path.join(__dirname, "..", "public", "css");
const BASE = [
  "style", "buttons", "index", "orgDashboard", "classDashboard", "attendanceCollection",
  "addStudent", "assessment", "deleteStudent", "editStudent", "manageClassSubjectAndGradYr",
  "manageRecords", "registerSchoolYear", "studentDetails", "manageStudents",
];
// Served from /css/ like the originals, so relative paths inside them still work.
const BUNDLES = {
  "app-bundle": [...BASE, "guardian"],
  "app-bundle-chat": [...BASE, "chatbot", "guardian"],
};

const built = new Map();
function build(name) {
  if (!built.has(name)) {
    const css = BUNDLES[name]
      .map((file) => `/* ${file}.css */\n${fs.readFileSync(path.join(CSS_DIR, `${file}.css`), "utf8")}`)
      .join("\n");
    built.set(name, { css, hash: crypto.createHash("md5").update(css).digest("hex").slice(0, 10) });
  }
  return built.get(name);
}

// URL for head.ejs; the version makes the file safe to cache for good.
function cssBundleUrl(withChatbot) {
  const name = withChatbot ? "app-bundle-chat" : "app-bundle";
  return `/css/${name}.css?v=${build(name).hash}`;
}

function serveCssBundle(req, res, next) {
  const name = req.params.name;
  if (!Object.prototype.hasOwnProperty.call(BUNDLES, name)) return next();
  const { css, hash } = build(name);
  res.type("text/css");
  res.set("Cache-Control", req.query.v === hash ? "public, max-age=31536000, immutable" : "public, max-age=300");
  return res.send(css);
}

module.exports = { cssBundleUrl, serveCssBundle };
