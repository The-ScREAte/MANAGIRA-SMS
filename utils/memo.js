"use strict";

// Keeps each answer for a short time. Requests asking for the same key at the same
// moment share one database query instead of each running their own.
const { BoundedMap } = require("./boundedMap");

function memo(load, { ttlMs = 30000, max = 5000 } = {}) {
  const entries = new BoundedMap(max);
  const get = (key) => {
    const hit = entries.get(key);
    if (hit && hit.until > Date.now()) return hit.value;
    const value = Promise.resolve().then(() => load(key));
    entries.set(key, { value, until: Date.now() + ttlMs });
    // A failed lookup is never kept, so the next request tries again.
    value.catch(() => { if (entries.get(key)?.value === value) entries.delete(key); });
    return value;
  };
  get.forget = (key) => entries.delete(key);
  return get;
}

module.exports = { memo };
