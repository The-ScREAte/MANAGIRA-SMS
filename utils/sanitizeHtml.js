"use strict";

// sanitize-html, on any Node version. The installed package is used where
// Node can require() its ES-module parser (20.19+ / 22.12+); older Node uses
// vendor/sanitize-html.cjs, a bundle of the same version (npm run build:vendor).
let sanitizeHtml;
try {
  sanitizeHtml = require("sanitize-html");
} catch (error) {
  if (error.code !== "ERR_REQUIRE_ESM" && error.code !== "ERR_REQUIRE_ASYNC_MODULE") throw error;
  sanitizeHtml = require("../vendor/sanitize-html.cjs");
}

module.exports = sanitizeHtml;
