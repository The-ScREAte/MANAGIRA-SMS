/**
 * Express middleware for HTTP caching headers
 * Implements role-based caching strategies
 */

const cacheManager = require('../utils/cacheManager');

/**
 * Set cache control headers based on resource type
 */
const setCacheHeaders = (options = {}) => {
  const { maxAge = 300, isPrivate = true, staleWhileRevalidate = 60 } = options;
  
  return (req, res, next) => {
    // Skip caching for POST, PUT, DELETE, PATCH requests
    if (['POST', 'PUT', 'DELETE', 'PATCH'].includes(req.method)) {
      res.set('Cache-Control', 'no-store');
      return next();
    }

    // Skip caching if user is not authenticated for private resources
    if (isPrivate && !req.session?.userId) {
      res.set('Cache-Control', 'no-store');
      return next();
    }

    // Set appropriate cache headers
    const cacheControl = isPrivate
      ? `private, max-age=${maxAge}, stale-while-revalidate=${staleWhileRevalidate}`
      : `public, max-age=${maxAge}, stale-while-revalidate=${staleWhileRevalidate}`;
    
    res.set('Cache-Control', cacheControl);
    
    // Add ETag support for conditional requests
    res.set('Vary', 'Cookie, Accept-Encoding');
    
    next();
  };
};

/**
 * Middleware for static asset caching
 */
const staticAssetCache = (req, res, next) => {
  // Long cache for static assets (1 year)
  res.set('Cache-Control', 'public, max-age=31536000, immutable');
  next();
};

/**
 * Middleware for API response caching
 */
const apiCache = (options = {}) => {
  const { ttl = 60, key: keyGenerator } = options;
  
  return async (req, res, next) => {
    // Only cache GET requests
    if (req.method !== 'GET') {
      return next();
    }

    // Generate cache key
    const userId = req.session?.userId || 'anonymous';
    const orgId = req.session?.organizationId || 'none';
    const role = req.session?.accountType || req.session?.userRole || 'guest';
    const defaultKey = `${role}:${userId}:${orgId}:${req.originalUrl}`;
    const cacheKey = keyGenerator ? keyGenerator(req) : defaultKey;

    // Determine cache type based on role
    let cacheType = 'organization';
    if (role === 'Admin' || role === 'Mini Admin') {
      cacheType = 'admin';
    } else if (role === 'Guardian') {
      cacheType = 'guardian';
    }

    // Check cache first
    const cached = await cacheManager.getShared(cacheType, cacheKey, ttl);
    if (cached) {
      // Add header to indicate cache hit
      res.set('X-Cache', 'HIT');
      return res.json(cached);
    }

    // Store original json method
    const originalJson = res.json.bind(res);
    
    // Override json method to cache response
    res.json = (data) => {
      if (res.statusCode === 200 && data) {
        cacheManager.set(cacheType, cacheKey, data, ttl);
      }
      res.set('X-Cache', 'MISS');
      return originalJson(data);
    };

    next();
  };
};

/**
 * Cache invalidation middleware
 * Use after data modification operations
 */
const invalidateCache = (cacheType, keyPattern) => {
  return (req, res, next) => {
    const orgId = req.session?.organizationId;
    const userId = req.session?.userId;
    
    // Build pattern with context
    let pattern = keyPattern || '';
    if (orgId) {
      pattern = pattern.replace('{orgId}', orgId);
    }
    if (userId) {
      pattern = pattern.replace('{userId}', userId);
    }

    // Invalidate on response finish
    res.on('finish', () => {
      if (res.statusCode >= 200 && res.statusCode < 300) {
        cacheManager.invalidatePattern(cacheType, pattern);
      }
    });

    next();
  };
};

/**
 * Preload cache for common data based on role
 */
const preloadCache = async (req, res, next) => {
  if (!req.session?.userId) {
    return next();
  }

  const role = req.session?.accountType || req.session?.userRole;
  const userId = req.session.userId;
  const organizationId = req.session.organizationId;

  // Preload in background without blocking
  setImmediate(() => {
    cacheManager.preloadForRole(role, userId, organizationId);
  });

  next();
};

module.exports = {
  setCacheHeaders,
  staticAssetCache,
  apiCache,
  invalidateCache,
  preloadCache
};
