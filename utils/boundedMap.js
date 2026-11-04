"use strict";

// A Map with a size cap. When full, adding a new key drops the oldest one, so
// caches keyed by visitor (IP address, feed link, email domain) can never grow
// without limit and push the server over its memory allowance.
// Every BoundedMap is registered so the memory guard can empty them under pressure.
const registry = new Set();

class BoundedMap extends Map {
  // keepUnderPressure: for lists that protect something (password tries, "already
  // emailed"), which the memory guard must not wipe. They are still capped.
  constructor(max = 1000, { keepUnderPressure = false } = {}) {
    super();
    this.max = Math.max(1, Number(max) || 1000);
    if (!keepUnderPressure) registry.add(this);
  }

  set(key, value) {
    if (!this.has(key)) {
      while (this.size >= this.max) {
        const oldest = this.keys().next().value;
        this.delete(oldest);
      }
    } else {
      // Refresh position so recently-written keys survive longest.
      this.delete(key);
    }
    return super.set(key, value);
  }
}

function clearAllBoundedMaps() {
  let cleared = 0;
  for (const map of registry) {
    cleared += map.size;
    map.clear();
  }
  return cleared;
}

module.exports = { BoundedMap, clearAllBoundedMaps };
