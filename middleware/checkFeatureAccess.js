const db = require('../config/db');
const cacheManager = require('../utils/cacheManager');
const { resolvePlanForOrganization } = require('../utils/accessCache');
const { hydrateOrganizationSession } = require('../utils/sessionContext');

const FEATURE_ROUTE_CACHE_TTL_SEC = Number(process.env.FEATURE_ROUTE_CACHE_TTL_SEC || 300);
const PLAN_FEATURE_CACHE_TTL_SEC = Number(process.env.PLAN_FEATURE_CACHE_TTL_SEC || 90);

function destroySessionAndRedirect(req, res, redirectTo) {
  if (!req.session) {
    return res.redirect(redirectTo);
  }

  req.session.destroy(() => {
    // Clear session cookie so header/nav renders as logged out.
    res.clearCookie('connect.sid');
    return res.redirect(redirectTo);
  });
}

function getFallbackFeatureNames(routePath) {
  if (routePath.startsWith('/common/admissionPending') || routePath.startsWith('/common/getPendingStudentDetails') || routePath.startsWith('/common/savePendingStudentChanges') || routePath.startsWith('/common/deletePendingStudentImage')) {
    return ['Student and Guardian Profile', 'Student and Guadian Profile'];
  }
  if (routePath.startsWith('/common/admissions') || routePath.startsWith('/common/studentDetails') || routePath.startsWith('/common/guardians') || routePath.startsWith('/common/guardianDetails')) {
    return ['Student and Guardian Profile', 'Student and Guadian Profile'];
  }
  if (routePath.startsWith('/common/reports')) {
    return ['Terminal Report', 'Progressive Student Report', 'Progressive Student Report ', 'Class Base Merit Sheet', 'Class Base Merrit sheet', 'Official School Transcript'];
  }
  if (routePath.startsWith('/common/closeSchoolYear') || routePath.startsWith('/common/termDetails')) {
    return ['Terminal Report', 'Progressive Student Report', 'Progressive Student Report '];
  }
  if (routePath.startsWith('/print/printStudentReport') || routePath.startsWith('/print/reportSettings')) {
    return ['Terminal Report'];
  }
  if (routePath.startsWith('/print/meritSheetPage') || routePath.startsWith('/print/generateMeritSheet')) {
    return ['Class Base Merit Sheet', 'Class Base Merrit sheet'];
  }
  if (routePath.startsWith('/transcript/transcript')) {
    return ['Official School Transcript'];
  }
  if (routePath.startsWith('/stats/organization')) {
    return ['Organization Analytics & Insights'];
  }
  if (routePath.startsWith('/stats/classes') || routePath.startsWith('/stats/class-comparison')) {
    return ['Class Base Analytics & Insights'];
  }
  if (routePath.startsWith('/documents')) {
    return ['Create Files', 'Files & Sheets', 'Docs/Sheets'];
  }
  if (routePath.startsWith('/common/assessment')) {
    return ['Assessment Tracking', 'Assessment tracking feature'];
  }
  if (routePath.startsWith('/common/attendanceCollection')) {
    return ['Attendance Tracking', 'Attendance tracking feature'];
  }
  return [];
}

const checkFeatureAccess = async (req, res, next) => {
  // Debug logs removed for production
  const routePath = req.originalUrl.split('?')[0];
  const isPublicDashboard = routePath === '/common/publicDashboard';

  // Best-effort: re-hydrate the organization context from the logged-in user
  // before evaluating any feature guard. This prevents page refreshes from
  // destroying the session when req.session.organizationId is momentarily
  // missing but req.session.userId / req.user is still valid.
  try {
    await hydrateOrganizationSession(req);
  } catch (_e) {
    // Hydration is best-effort; fall through to the normal checks below.
  }

  // Admin-side roles (Admin, Mini Admin, Internal Worker) are platform users
  // with no organizationId. They should never be evaluated by org feature
  // gates, and must NEVER have their session destroyed by this middleware
  // just because they happen to land on a /common/* route (e.g. via SPA
  // preloads). Short-circuit them through.
  const _adminAccount = String(req.session?.accountType || '').trim().toLowerCase();
  const _adminRole = String(req.session?.userRole || '').trim().toLowerCase();
  const _adminSet = new Set(['admin', 'mini admin', 'internal worker']);
  if (_adminSet.has(_adminAccount) || _adminSet.has(_adminRole)) {
    return next();
  }

  const normalizedRouteCandidates = (() => {
    const prefixes = ['/common', '/print', '/account', '/transcript', '/stats', '/documents'];
    const candidates = new Set([routePath]);

    for (const prefix of prefixes) {
      if (routePath === prefix) {
        candidates.add('/');
      } else if (routePath.startsWith(prefix + '/')) {
        candidates.add(routePath.slice(prefix.length));
      }
    }

    return Array.from(candidates);
  })();

  const organizationId =
    req.session?.organizationId ||
    req.query.organizationId ||
    req.schoolDetails?.organization_id;

  // Support both normal users and super admin org switch
  const userRole = req.session?.userRole || req.session?.user?.account_type || req.session?.user?.role || null;
  const normalizedUserRole = String(userRole || '').trim().toLowerCase();
  const userId = (req.session?.user && req.session.user.user_id) || req.session?.userId || null;
  const classId = req.query.classId || req.body.classId;

  if (!organizationId) {
  // ...removed warn for clean background operation...
    if (isPublicDashboard) {
      return res.status(400).send("Missing organization ID.");
    }

    // SPA preloads / XHR-style background fetches must NEVER tear down the
    // user's session — they should just be a no-op response. This is the
    // root cause of the "missing org id" flash on refresh: a background
    // preload races ahead of the session restore and then destroys the
    // session before the real page request can run.
    const isXhrLike =
      req.xhr ||
      req.headers['x-requested-with'] === 'XMLHttpRequest' ||
      req.headers['sec-fetch-dest'] === 'empty' ||
      req.headers['sec-fetch-mode'] === 'cors';
    if (isXhrLike) {
      return res.status(204).end();
    }

    req.flash('error', 'Your organization session is no longer valid. Please sign in again.');
    return destroySessionAndRedirect(req, res, '/');
  }

  try {
    const planContext = await resolvePlanForOrganization(db, organizationId);
    if (!planContext) {
      req.flash('error', 'Organization not found.');
      return destroySessionAndRedirect(req, res, '/');
    }
    const planIdToCheck = planContext.planId;

    // 1️⃣ Check If Route Requires a Feature (Feature-Based Access)
    const routeFeatureCache = await cacheManager.getOrFetch(
      'static',
      `access:route-feature:${routePath}`,
      async () => {
        const { rows: featureRows } = await db.query(
          `SELECT f.id FROM feature_routes fr
           JOIN features f ON f.id = fr.feature_id
           WHERE fr.route_path = ANY($1::text[])
              OR (
                fr.route_path <> '/'
                AND EXISTS (
                  SELECT 1
                  FROM unnest($1::text[]) AS c(path)
                  WHERE c.path LIKE fr.route_path || '/%'
                )
              )
           LIMIT 1`,
          [normalizedRouteCandidates]
        );

        let featureId = featureRows.length > 0 ? featureRows[0].id : null;
        if (!featureId) {
          const fallbackFeatureNames = getFallbackFeatureNames(routePath);
          if (fallbackFeatureNames.length > 0) {
            const { rows: fallbackFeatureRows } = await db.query(
              `SELECT id FROM features WHERE feature_name = ANY($1::text[]) LIMIT 1`,
              [fallbackFeatureNames]
            );
            if (fallbackFeatureRows.length > 0) {
              featureId = fallbackFeatureRows[0].id;
            }
          }
        }

        return { featureId: featureId || null };
      },
      { ttl: FEATURE_ROUTE_CACHE_TTL_SEC }
    );

    const featureId = routeFeatureCache?.featureId || null;

    if (featureId) {
      const planFeatureAccess = await cacheManager.getOrFetch(
        'static',
        `access:plan-feature:${planIdToCheck}:${featureId}`,
        async () => {
          const { rows: planAccess } = await db.query(
            `SELECT 1 FROM plan_features pf
             WHERE pf.feature_id = $1 AND pf.plan_id = $2`,
            [featureId, planIdToCheck]
          );
          return { allowed: planAccess.length > 0 };
        },
        { ttl: PLAN_FEATURE_CACHE_TTL_SEC }
      );

      if (!planFeatureAccess?.allowed) {
        console.warn('[FeatureDenied]', {
          route: routePath,
          normalizedRouteCandidates,
          organizationId,
          userId,
          userRole,
          planIdToCheck,
          featureId,
          sessionId: req.sessionID,
        });
  // ...removed warn for clean background operation...
        if (isPublicDashboard) {
          return res.status(200).send(`<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Website Not Activated</title>
  <style>
    :root {
      --bg-1: #f4f7fb;
      --bg-2: #eaf1f7;
      --card-bg: #ffffff;
      --border: #d7e2ee;
      --text-main: #1f2937;
      --text-muted: #4b5563;
      --accent: #01535b;
    }

    * {
      box-sizing: border-box;
    }

    html,
    body {
      margin: 0;
      min-height: 100%;
    }

    body {
      font-family: "Segoe UI", Tahoma, Geneva, Verdana, sans-serif;
      background: linear-gradient(180deg, var(--bg-1) 0%, var(--bg-2) 100%);
      display: grid;
      place-items: center;
      padding: 24px;
      color: var(--text-main);
    }

    .notice-card {
      width: min(720px, 100%);
      background: var(--card-bg);
      border: 1px solid var(--border);
      border-radius: 16px;
      box-shadow: 0 20px 44px rgba(2, 12, 27, 0.08);
      padding: 28px 24px;
      text-align: center;
    }

    .notice-title {
      margin: 0 0 12px;
      font-size: clamp(1.25rem, 2vw, 1.55rem);
      color: var(--accent);
      line-height: 1.2;
    }

    .notice-text {
      margin: 0;
      font-size: 1rem;
      line-height: 1.6;
      color: var(--text-muted);
    }
  </style>
</head>
<body>
  <main class="notice-card" role="main" aria-live="polite">
    <h1 class="notice-title">Website Not Activated Yet</h1>
    <p class="notice-text">Oops! This school has not set up a website with Managira yet. Please reach out to the school to encourage them to activate their School Website plan.</p>
  </main>
</body>
</html>`);
        } else {
          req.flash('error', 'Your plan does not support this feature.');
          return res.redirect('/common/orgDashboard');
        }
      }
    }

    // ✅ Allow unauthenticated access ONLY to /common/publicDashboard
    if (isPublicDashboard) {
      return next();
    }

    // 🔐 From here on, user must be authenticated
    // Allow super admin org switch session
    if (
      !req.session ||
      (!req.session.user &&
        !(req.session.superAdminOrgSwitch && req.session.userId && req.session.organizationId))
    ) {
  // ...removed warn for clean background operation...
  // ...removed orphaned object from log removal...
      req.flash("error", "Please log in to continue.");
      return res.redirect("/account/login");
    }

    // 2️⃣ Role-Based Access Check
    const roleAccessMap = {
      '/account/managePublicContent': ['manager'],
      '/common/adminPanel': ['admin'],
    };

    if (roleAccessMap[routePath] && !roleAccessMap[routePath].includes(normalizedUserRole)) {
      console.warn('[RoleDenied]', {
        route: routePath,
        requiredRoles: roleAccessMap[routePath],
        userRole,
        normalizedUserRole,
        organizationId,
        userId,
        sessionId: req.sessionID,
      });
  // ...removed warn for clean background operation...
      req.flash('error', 'You do not have permission to access this page.');
      return res.redirect('/common/orgDashboard');
    }

    // 3️⃣ Teachers Can Only Access Their Assigned Classes
    if (routePath.startsWith('/common/classDashboard') && classId) {
      if (normalizedUserRole === "manager" || normalizedUserRole === "supervisor" || normalizedUserRole === "admin") {
        return next();
      }

      if (normalizedUserRole === "teacher") {
        const { rows: classAccess } = await db.query(
          `SELECT 1 FROM user_classes WHERE user_id = $1 AND class_id = $2`,
          [userId, classId]
        );

        if (classAccess.length === 0) {
          // ...removed warn for clean background operation...
          req.flash('error', 'You do not have permission to view this class.');
          return res.redirect('/common/orgDashboard');
        }
      }
    }

    // 4️⃣ ✅ Allow ONLY Main Teachers to Access Attendance
    if (routePath.startsWith('/common/attendanceCollection')) {
      if (normalizedUserRole === 'manager' || normalizedUserRole === 'admin') {
        return next();
      }

      if (normalizedUserRole === "teacher") {
        if (!classId) {
          // ...removed warn for clean background operation...
          req.flash('error', 'Invalid class selection.');
          return res.redirect('/common/orgDashboard');
        }

        const { rows: mainTeacherCheck } = await db.query(
          `SELECT user_id FROM user_classes WHERE class_id = $1 AND main = TRUE`,
          [classId]
        );

        if (mainTeacherCheck.length === 0) {
          // ...removed warn for clean background operation...
          req.flash('error', 'No main teacher assigned.');
          return res.redirect('/common/orgDashboard');
        }

        const mainTeacherId = mainTeacherCheck[0].user_id;

        if (userId !== mainTeacherId) {
          // ...removed warn for clean background operation...
          req.flash('error', 'You do not have permission to access attendance records.');
          return res.redirect('/common/orgDashboard');
        }
      }
    }

    next();
  } catch (err) {
    console.error('❌ Feature access check failed:', err);
    req.flash('error', 'An error occurred while checking your access.');
    res.redirect('/common/orgDashboard');
  }
};

module.exports = checkFeatureAccess;
