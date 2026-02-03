/**
 * Centralized Cache Manager for Managira
 * Implements role-based caching with automatic invalidation and background refresh
 */

const NodeCache = require('node-cache');

// Create separate caches for different data types with appropriate TTLs
const caches = {
  // Admin cache - organizations list, admin data (5 min TTL)
  admin: new NodeCache({ stdTTL: 300, checkperiod: 60 }),
  
  // Organization cache - org details, users, classes (3 min TTL)
  organization: new NodeCache({ stdTTL: 180, checkperiod: 30 }),
  
  // Guardian cache - student data, grades (2 min TTL for freshness)
  guardian: new NodeCache({ stdTTL: 120, checkperiod: 30 }),
  
  // Static cache - features, plans, pricing (30 min TTL)
  static: new NodeCache({ stdTTL: 1800, checkperiod: 120 }),
  
  // Session cache - user preferences, theme colors (10 min TTL)
  session: new NodeCache({ stdTTL: 600, checkperiod: 60 })
};

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

    const { ttl, forceRefresh = false } = options;

    // Return cached data if available and not forcing refresh
    if (!forceRefresh) {
      const cached = cache.get(key);
      if (cached !== undefined) {
        // Background refresh if data is getting stale (> 70% of TTL)
        const ttlInfo = cache.getTtl(key);
        if (ttlInfo) {
          const remaining = (ttlInfo - Date.now()) / 1000;
          const defaultTTL = caches[cacheType].options.stdTTL;
          if (remaining < defaultTTL * 0.3) {
            // Trigger background refresh
            this.backgroundRefresh(cacheType, key, fetchFn, ttl);
          }
        }
        return cached;
      }
    }

    // Fetch fresh data
    try {
      const data = await fetchFn();
      if (data !== undefined && data !== null) {
        if (ttl) {
          cache.set(key, data, ttl);
        } else {
          cache.set(key, data);
        }
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
    setImmediate(async () => {
      try {
        const data = await fetchFn();
        if (data !== undefined && data !== null) {
          const cache = caches[cacheType];
          if (ttl) {
            cache.set(key, data, ttl);
          } else {
            cache.set(key, data);
          }
        }
      } catch (error) {
        // Silent fail for background refresh
        console.warn(`Background refresh failed for ${cacheType}:${key}`);
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
    }
  },

  /**
   * Invalidate entire cache type
   */
  invalidateAll(cacheType) {
    const cache = caches[cacheType];
    if (cache) {
      cache.flushAll();
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
