#!/usr/bin/env node
// Bundles sanitize-html (and its ESM-only parser, htmlparser2) into one
// CommonJS file, so the same patched version also loads on Node versions
// that can't require() ES modules (before 20.19 / 22.12).
// Re-run after updating sanitize-html: npm run build:vendor
"use strict";

const path = require("path");
const esbuild = require("esbuild");

const version = require("sanitize-html/package.json").version;
const outfile = path.join(__dirname, "..", "vendor", "sanitize-html.cjs");

esbuild.buildSync({
  entryPoints: [require.resolve("sanitize-html")],
  outfile,
  bundle: true,
  platform: "node",
  format: "cjs",
  target: "node18",
  legalComments: "inline",
  banner: { js: `/* sanitize-html ${version}, bundled by scripts/buildVendor.js. Do not edit; run npm run build:vendor. */` },
  footer: { js: `module.exports.__bundledVersion = ${JSON.stringify(version)};` },
});

console.log(`vendor/sanitize-html.cjs built from sanitize-html ${version}`);
