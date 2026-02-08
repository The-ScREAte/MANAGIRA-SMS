const db = require('../config/db');

const checkFeatureAccess = async (req, res, next) => {
  // Debug logs removed for production
  const routePath = req.originalUrl.split('?')[0];
  const isPublicDashboard = routePath === '/common/publicDashboard';

  const organizationId =
    req.session?.organizationId ||
    req.query.organizationId ||
    req.schoolDetails?.organization_id;

  // Support both normal users and super admin org switch
  const userRole = req.session?.userRole || req.session?.user?.role || null;
  const userId = (req.session?.user && req.session.user.user_id) || req.session?.userId || null;
  const classId = req.query.classId || req.body.classId;

  if (!organizationId) {
  // ...removed warn for clean background operation...
    if (isPublicDashboard) {
      return res.status(400).send("Missing organization ID.");
    } else {
      req.flash('error', 'You need an organization to access this feature.');
      return res.redirect('/common/orgDashboard');
    }
  }

  try {
    // Determine the plan_id to check (hub's plan if hub member, otherwise org's plan)
    let planIdToCheck;
    
    // Try to check if organization is a hub member (with fallback if columns don't exist)
    try {
      const { rows: orgRows } = await db.query(
        'SELECT plan_id, is_hub_member, hub_id FROM organizations WHERE organization_id = $1',
        [organizationId]
      );
      
      if (orgRows.length === 0) {
        req.flash('error', 'Organization not found.');
        return res.redirect('/common/orgDashboard');
      }
      
      const org = orgRows[0];
      
      // If organization is a hub member, get hub's plan
      if (org.is_hub_member && org.hub_id) {
        try {
          const { rows: hubRows } = await db.query(
            'SELECT plan_id FROM managira_hubs WHERE hub_id = $1',
            [org.hub_id]
          );
          if (hubRows.length > 0 && hubRows[0].plan_id) {
            planIdToCheck = hubRows[0].plan_id;
          } else {
            planIdToCheck = org.plan_id;
          }
        } catch (hubError) {
          // Hub table doesn't exist yet, use org plan
          planIdToCheck = org.plan_id;
        }
      } else {
        // Regular organization, use its own plan
        planIdToCheck = org.plan_id;
      }
    } catch (columnError) {
      // Hub columns don't exist yet, fallback to basic query
      const { rows: orgRows } = await db.query(
        'SELECT plan_id FROM organizations WHERE organization_id = $1',
        [organizationId]
      );
      
      if (orgRows.length === 0) {
        req.flash('error', 'Organization not found.');
        return res.redirect('/common/orgDashboard');
      }
      
      planIdToCheck = orgRows[0].plan_id;
    }

    // 1️⃣ Check If Route Requires a Feature (Feature-Based Access)
    const { rows: featureRows } = await db.query(
      `SELECT f.id FROM feature_routes fr
       JOIN features f ON f.id = fr.feature_id
       WHERE fr.route_path = $1`,
      [routePath]
    );

    if (featureRows.length > 0) {
      const featureId = featureRows[0].id;

      // Check if the plan (hub's or org's) has access to this feature
      const { rows: planAccess } = await db.query(
        `SELECT 1 FROM plan_features pf
         WHERE pf.feature_id = $1 AND pf.plan_id = $2`,
        [featureId, planIdToCheck]
      );

      if (planAccess.length === 0) {
  // ...removed warn for clean background operation...
        if (isPublicDashboard) {
          return res.status(403).send("This organization does not support school website access.");
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
      '/account/managePublicContent': ['Manager'],
      '/common/adminPanel': ['Admin'],
    };

    if (roleAccessMap[routePath] && !roleAccessMap[routePath].includes(userRole)) {
  // ...removed warn for clean background operation...
      req.flash('error', 'You do not have permission to access this page.');
      return res.redirect('/common/orgDashboard');
    }

    // 3️⃣ Teachers Can Only Access Their Assigned Classes
    if (routePath.startsWith('/common/classDashboard') && classId) {
      if (userRole === "Manager" || userRole === "Supervisor" || userRole === "Admin") {
        return next();
      }

      if (userRole === "Teacher") {
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
      if (userRole === 'Manager' || userRole === 'Admin') {
        return next();
      }

      if (userRole === "Teacher") {
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
