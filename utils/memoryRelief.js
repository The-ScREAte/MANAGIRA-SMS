"use strict";

// What the memory watchdog may free. All of it is rebuilt when next needed;
// nothing a person saved lives here.
const memoryGuard = require("./memoryGuard");
const cacheManager = require("./cacheManager");
const { clearAllBoundedMaps } = require("./boundedMap");

function install() {
  memoryGuard.onPressure(async (level) => {
    clearAllBoundedMaps();
    if (level === "hard") ["admin", "organization", "guardian", "static", "session"].forEach((type) => cacheManager.invalidateAll(type));
    await require("./pdfService").closeIdleBrowser();
  });
  memoryGuard.start();
}

module.exports = { install };
