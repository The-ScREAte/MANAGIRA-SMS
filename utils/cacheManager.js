/**
 * Centralized Cache Manager for Managira
 * Implements role-based caching with automatic invalidation and background refresh
 */

const NodeCache = require('node-cache');

const REDIS_URL = process.env.REDIS_URL || '';
const REDIS_KEY_PREFIX = process.env.REDIS_CACHE_PREFIX || 'managira:cache';
let redisClientPromise = null;
let redisUnavailableLogged = false;

function buildRedisKey(cacheType, key) {
  return `${REDIS_KEY_PREFIX}:${cacheType}:${key}`;
}

function parseRedisValue(raw) {
  if (raw === null || raw === undefined) {
    return undefined;
  }

  try {
    return JSON.parse(raw);
  } catch (error) {
    return raw;
  }
}

async function getRedisClient() {
  if (!REDIS_URL) {
    return null;
  }

  if (!redisClientPromise) {
    redisClientPromise = (async () => {
      try {
        // Lazy-load redis so environments without redis dependency still run.
        const redisModule = require('redis');
        const client = redisModule.createClient({ url: REDIS_URL });

        client.on('error', (error) => {
          if (!redisUnavailableLogged) {
            console.warn('[cacheManager] Redis error. Falling back to local cache:', error.message);
            redisUnavailableLogged = true;
          }
        });

        await client.connect();
        console.log('[cacheManager] Redis shared cache enabled');
        redisUnavailableLogged = false;
        return client;
      } catch (error) {
        if (!redisUnavailableLogged) {
          console.warn('[cacheManager] Redis unavailable. Using local cache only:', error.message);
          redisUnavailableLogged = true;
        }
        return null;
      }
    })();
  }

  return redisClientPromise;
}

async function readRedis(cacheType, key) {
  const client = await getRedisClient();
  if (!client) {
    return undefined;
  }

  try {
    const raw = await client.get(buildRedisKey(cacheType, key));
    return parseRedisValue(raw);
  } catch (error) {
    return undefined;
  }
}

async function writeRedis(cacheType, key, value, ttl) {
  const client = await getRedisClient();
  if (!client) {
    return;
  }

  const payload = JSON.stringify(value);

  try {
    if (ttl) {
      await client.set(buildRedisKey(cacheType, key), payload, { EX: ttl });
    } else {
      await client.set(buildRedisKey(cacheType, key), payload);
    }
  } catch (error) {
    // Local cache still serves traffic; redis write failures are non-fatal.
  }
}

async function deleteRedis(cacheType, key) {
  const client = await getRedisClient();
  if (!client) {
    return;
  }

  try {
    await client.del(buildRedisKey(cacheType, key));
  } catch (error) {
    // Ignore redis delete failures.
  }
}

async function deleteRedisByPattern(cacheType, pattern) {
  const client = await getRedisClient();
  if (!client) {
    return;
  }

  const scanPattern = buildRedisKey(cacheType, `*${pattern}*`);
  const keysToDelete = [];

  try {
    for await (const keys of client.scanIterator({ MATCH: scanPattern, COUNT: 100 })) {
      for (const key of keys) {
        keysToDelete.push(key);
      }
    }

    if (keysToDelete.length > 0) {
      await client.del(keysToDelete);
    }
  } catch (error) {
    // Ignore redis scan/delete failures.
  }
}

async function flushRedis(cacheType) {
  const client = await getRedisClient();
  if (!client) {
    return;
  }

  const scanPattern = buildRedisKey(cacheType, '*');
  const keysToDelete = [];

  try {
    for await (const keys of client.scanIterator({ MATCH: scanPattern, COUNT: 100 })) {
      for (const key of keys) {
        keysToDelete.push(key);
      }
    }

    if (keysToDelete.length > 0) {
      await client.del(keysToDelete);
    }
  } catch (error) {
    // Ignore redis scan/delete failures.
  }
}

// Every reader gets its own copy, so one request can never change what the next one reads.
// node-cache made that copy with a slow general-purpose cloner on every read and write, and the
// permission and feature lists are read on every request; a list or record of plain values is
// now copied directly, and anything else still goes through the same cloner as before.
const deepClone = (() => { try { return require('clone'); } catch (_) { return (value) => structuredClone(value); } })();
const isPlainValue = (value) => value === null || (typeof value !== 'object' && typeof value !== 'function');
function copyOf(value) {
  if (isPlainValue(value)) return value;
  if (Array.isArray(value)) return value.every(isPlainValue) ? value.slice() : deepClone(value);
  if (Object.getPrototypeOf(value) === Object.prototype && Object.values(value).every(isPlainValue)) return { ...value };
  return deepClone(value);
}
function makeCache(options) {
  const cache = new NodeCache({ ...options, useClones: false });
  const rawGet = cache.get.bind(cache);
  const rawSet = cache.set.bind(cache);
  cache.get = (key) => {
    const value = rawGet(key);
    return value === undefined ? value : copyOf(value);
  };
  // The stored value itself, for a caller that only reads it (getOrFetch with copy: false).
  cache.peek = rawGet;
  cache.set = (key, value, ttl) => (ttl === undefined ? rawSet(key, copyOf(value)) : rawSet(key, copyOf(value), ttl));
  return cache;
}

// Create separate caches for different data types with appropriate TTLs
const caches = {
  // Admin cache - organizations list, admin data (5 min TTL)
  admin: makeCache({ stdTTL: 300, checkperiod: 60 }),
  
  // Organization cache - org details, users, classes (3 min TTL)
  organization: makeCache({ stdTTL: 180, checkperiod: 30 }),
  
  // Guardian cache - student data, grades (2 min TTL for freshness)
  guardian: makeCache({ stdTTL: 120, checkperiod: 30 }),
  
  // Static cache - features, plans, pricing (30 min TTL)
  static: makeCache({ stdTTL: 1800, checkperiod: 120 }),
  
  // Session cache - user preferences, theme colors (10 min TTL)
  session: makeCache({ stdTTL: 600, checkperiod: 60 })
};

// Cap each cache so a burst of distinct keys (many schools, many pages) can't
// grow memory without limit. When full, the oldest tenth of entries is dropped.
const CACHE_MAX_KEYS = Number(process.env.CACHE_MAX_KEYS) || 3000;
function trimCache(cache) {
  try {
    const count = cache.getStats().keys;
    if (count <= CACHE_MAX_KEYS) return;
    const keys = cache.keys();
    cache.del(keys.slice(0, Math.max(1, Math.ceil(keys.length / 10))));
  } catch (_) {}
}
function setLocal(cache, key, data, ttl) {
  if (ttl) cache.set(key, data, ttl);
  else cache.set(key, data);
  trimCache(cache);
}
// One background refresh per key at a time (repeat visits used to start many).
const refreshingKeys = new Set();

const cacheManager = {
  /**
   * Get data from cache or fetch fresh if not available
   * @param {string} cacheType - 'admin', 'organization', 'guardian', 'static', 'session'
   * @param {string} key - Unique cache key
   * @param {Function} fetchFn - Async function to fetch data if cache miss
   * @param {Object} options - { ttl: number, forceRefresh: boolean }
   */
  async getOrFetch(cacheType, key, fetchFn, options = {}) {
    const cache = caches[cacheType];
    if (!cache) {
      console.error(`Invalid cache type: ${cacheType}`);
      return fetchFn();
    }

    // copy: false is for callers that only read what they get (a large snapshot polled often):
    // they share the stored value instead of receiving their own copy.
    const { ttl, forceRefresh = false, copy = true } = options;

    // Return cached data if available and not forcing refresh
    if (!forceRefresh) {
      const cached = copy ? cache.get(key) : cache.peek(key);
      if (cached !== undefined) {
        // Background refresh if data is getting stale (> 70% of its own lifetime). Measured
        // against the lifetime this entry was given: against the cache's longer default, an
        // entry kept for 5 minutes always looked stale and was fetched again on every read.
        const ttlInfo = cache.getTtl(key);
        if (ttlInfo) {
          const remaining = (ttlInfo - Date.now()) / 1000;
          const lifetime = ttl || caches[cacheType].options.stdTTL;
          if (remaining < lifetime * 0.3) {
            // Trigger background refresh
            this.backgroundRefresh(cacheType, key, fetchFn, ttl);
          }
        }
        return cached;
      }

      const sharedCached = await readRedis(cacheType, key);
      if (sharedCached !== undefined) {
        setLocal(cache, key, sharedCached, ttl);
        return sharedCached;
      }
    }

    // Fetch fresh data
    try {
      const data = await fetchFn();
      if (data !== undefined && data !== null) {
        setLocal(cache, key, data, ttl);
        writeRedis(cacheType, key, data, ttl).catch(() => {});
      }
      return data;
    } catch (error) {
      console.error(`Cache fetch error for ${cacheType}:${key}:`, error);
      throw error;
    }
  },

  /**
   * Background refresh without blocking
   */
  backgroundRefresh(cacheType, key, fetchFn, ttl) {
    const refreshKey = `${cacheType}:${key}`;
    if (refreshingKeys.has(refreshKey)) return;
    refreshingKeys.add(refreshKey);
    setImmediate(async () => {
      try {
        const data = await fetchFn();
        if (data !== undefined && data !== null) {
          const cache = caches[cacheType];
          setLocal(cache, key, data, ttl);
          writeRedis(cacheType, key, data, ttl).catch(() => {});
        }
      } catch (error) {
        // Silent fail for background refresh
        console.warn(`Background refresh failed for ${cacheType}:${key}`);
      } finally {
        refreshingKeys.delete(refreshKey);
      }
    });
  },

  /**
   * Invalidate specific cache key
   */
  invalidate(cacheType, key) {
    const cache = caches[cacheType];
    if (cache) {
      cache.del(key);
      deleteRedis(cacheType, key).catch(() => {});
    }
  },

  /**
   * Invalidate all keys matching a pattern for a cache type
   */
  invalidatePattern(cacheType, pattern) {
    const cache = caches[cacheType];
    if (cache) {
      const keys = cache.keys();
      keys.forEach(key => {
        if (key.includes(pattern)) {
          cache.del(key);
        }
      });
      deleteRedisByPattern(cacheType, pattern).catch(() => {});
    }
  },

  /**
   * Invalidate entire cache type
   */
  invalidateAll(cacheType) {
    const cache = caches[cacheType];
    if (cache) {
      cache.flushAll();
      flushRedis(cacheType).catch(() => {});
    }
  },

  /**
   * Set data directly in cache
   */
  set(cacheType, key, data, ttl) {
    const cache = caches[cacheType];
    if (cache) {
      if (ttl) {
        cache.set(key, data, ttl);
      } else {
        cache.set(key, data);
      }
      writeRedis(cacheType, key, data, ttl).catch(() => {});
    }
  },

  /**
   * Get data directly from cache
   */
  get(cacheType, key) {
    const cache = caches[cacheType];
    if (cache) {
      return cache.get(key);
    }
    return undefined;
  },

  async getShared(cacheType, key, ttl) {
    const cache = caches[cacheType];
    if (!cache) {
      return undefined;
    }

    const localValue = cache.get(key);
    if (localValue !== undefined) {
      return localValue;
    }

    const sharedValue = await readRedis(cacheType, key);
    if (sharedValue !== undefined) {
      if (ttl) {
        cache.set(key, sharedValue, ttl);
      } else {
        cache.set(key, sharedValue);
      }
    }

    return sharedValue;
  },

  /**
   * Get cache statistics
   */
  getStats(cacheType) {
    const cache = caches[cacheType];
    if (cache) {
      return cache.getStats();
    }
    return null;
  },

  /**
   * Preload commonly accessed data based on role
   */
  async preloadForRole(role, userId, organizationId) {
    switch (role) {
      case 'Admin':
      case 'Mini Admin':
        // Admin doesn't preload org-specific data
        break;
      case 'Manager':
      case 'Supervisor':
      case 'Teacher':
        // Preload organization-specific data
        if (organizationId) {
          // These will be loaded on first access
        }
        break;
      case 'Guardian':
        // Guardian-specific preloading handled separately
        break;
    }
  }
};

module.exports = cacheManager;
