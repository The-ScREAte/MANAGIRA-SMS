"use strict";

const PUBLIC_ACCOUNT_EXACT = new Set([
  "/account/login",
  "/account/register",
  "/account/payment",
  "/account/service-plan",
  "/account/guardian-login",
  "/account/forget-password",
  "/account/reset-password",
]);

const PUBLIC_ACCOUNT_PREFIXES = [
  "/account/accept-hub-invitation/",
  "/account/accept-hub-invitation-existing/",
];

const PUBLIC_HUB_EXACT = new Set([
  "/hub/login",
  "/hub/setup-password",
]);

const PUBLIC_COMMON_EXACT = new Set([
  "/common/publicRegister",
  "/common/set-password",
]);

const SPA_EXCLUDED_EXACT = new Set([
  "/account/logout",
  "/account/managePublicContent",
  "/account/personalization",
  "/common/addStudent",
  "/common/createEmployee",
  "/common/createTest",
  "/common/editTest",
  "/common/modifyEmployee",
  "/common/registerSchoolYear",
  "/common/reports",
  "/promotion/applyPromotion",
  "/admin/exit-org",
]);

const SPA_EXCLUDED_PREFIXES = [
  "/admin/org/",
  "/print/",
  "/stats/",
];

const SPA_ROUTES_BY_USER_TYPE = {
  public: [],
  organization: [
    "/",
    "/common/orgDashboard",
    "/common/management",
    "/common/publicDashboard",
    "/common/admissions",
    "/account/account",
    "/account/settings",
    "/account/update",
    "/account/update-card",
    "/account/update-plan",
    "/account/cancel-subscription",
    "/account/confirm-password",
    "/common/studentDetails",
    "/common/studentInfo",
    "/common/editStudent",
    "/common/admissionPending",
    "/common/archivedStudents",
    "/common/manageClassSubjectAndGradYr",
    "/common/classDashboard",
    "/common/addClassSubject",
    "/common/manageEmployees",
    "/common/employeeDetails",
    "/common/guardians",
    "/common/guardianDetails",
    "/common/assessment",
    "/common/modifyAssessment",
    "/common/manageAssessment",
    "/common/manageRecords",
    "/common/manageSchoolYear",
    "/common/closeSchoolYear",
    "/common/termDetails",
    "/common/closeGraduationYearGroup",
    "/common/createEventAnnouncement",
    "/common/manageEventsAnnouncements",
    "/common/attendanceCollection",
    "/enrollment/enroll",
    "/enrollment/manageEnrollment",
    "/enrollment/modifyEnrollment",
    "/promotion/apply",
    "/promotion/closeGraduationYearGroup",
    "/transcript/transcript",
    "/document",
  ],
  guardian: [
    "/guardian/dashboard",
    "/guardian/academic-details",
    "/guardian/student",
    "/guardian/studentDetails",
    "/guardian/settings",
    "/guardian/report",
    "/guardian/reports",
    "/guardian/edit-pending-student",
  ],
  hub: [
    "/hub/dashboard",
    "/hub/settings",
    "/hub/organizations",
  ],
  admin: [
    "/admin",
    "/admin/superDashboard",
    "/admin/superSettings",
    "/admin/create-promo",
    "/admin/employment",
    "/admin/donations",
    "/admin/announcements",
    "/admin/helpMessages",
    "/admin/helpHistory",
    "/admin/servicePricing",
    "/admin/scheduled-holds",
    "/admin/data-export",
    "/admin/hubs",
    "/admin/editAdminUser",
  ],
};

function normalizePath(inputPath) {
  const rawPath = String(inputPath || "/").split("?")[0].split("#")[0] || "/";
  if (rawPath.length > 1 && rawPath.endsWith("/")) {
    return rawPath.slice(0, -1);
  }
  return rawPath;
}

function matchesExactOrPrefix(path, exactSet, prefixes) {
  if (exactSet && exactSet.has(path)) {
    return true;
  }
  return Array.isArray(prefixes) && prefixes.some((prefix) => path.startsWith(prefix));
}

function isPublicAccountRoute(path) {
  return matchesExactOrPrefix(path, PUBLIC_ACCOUNT_EXACT, PUBLIC_ACCOUNT_PREFIXES);
}

function isPublicHubRoute(path) {
  return matchesExactOrPrefix(path, PUBLIC_HUB_EXACT, []);
}

function isPublicRoute(inputPath) {
  const path = normalizePath(inputPath);
  return path === "/"
    || path.startsWith("/legal/")
    || PUBLIC_COMMON_EXACT.has(path)
    || isPublicAccountRoute(path)
    || isPublicHubRoute(path);
}

function isSpaExcludedRoute(inputPath) {
  const path = normalizePath(inputPath);
  return matchesExactOrPrefix(path, SPA_EXCLUDED_EXACT, SPA_EXCLUDED_PREFIXES);
}

function getUserTypeFromSession(session) {
  if (!session || !session.firstName) {
    return "public";
  }

  if (session.accountType === "Admin" || session.accountType === "Mini Admin") {
    return "admin";
  }

  if (session.accountType === "Hub") {
    return "hub";
  }

  if (session.userRole === "Guardian") {
    return "guardian";
  }

  return "organization";
}

function isAuthenticatedAppRoute(inputPath) {
  const path = normalizePath(inputPath);
  if (isPublicRoute(path)) {
    return false;
  }

  return path.startsWith("/admin/")
    || path === "/admin"
    || path.startsWith("/guardian/")
    || path.startsWith("/common/")
    || path.startsWith("/enrollment/")
    || path.startsWith("/print/")
    || path.startsWith("/promotion/")
    || path.startsWith("/transcript/")
    || path.startsWith("/stats/")
    || path.startsWith("/document/")
    || path === "/document"
    || path.startsWith("/account/")
    || path.startsWith("/hub/");
}

function isSpaRouteForUser(inputPath, session) {
  const path = normalizePath(inputPath).split("?")[0];
  const userType = typeof session === "string" ? session : getUserTypeFromSession(session);
  const routes = SPA_ROUTES_BY_USER_TYPE[userType] || SPA_ROUTES_BY_USER_TYPE.public;

  return routes.some((route) => path === route || path.startsWith(`${route}/`));
}

function shouldLoadSpaRouter(inputPath, session) {
  const path = normalizePath(inputPath);
  const userType = getUserTypeFromSession(session);
  if (userType === "public") {
    return false;
  }

  return isSpaRouteForUser(path, session) && !isSpaExcludedRoute(path);
}

function getRouteFlags(inputPath, session) {
  const path = normalizePath(inputPath);
  const userType = getUserTypeFromSession(session);

  return {
    path,
    userType,
    isHomePage: path === "/",
    isLegalPage: path.startsWith("/legal/"),
    isAccountPage: path.startsWith("/account/"),
    isHubPage: path.startsWith("/hub/"),
    isAdminPage: path.startsWith("/admin/") || path === "/admin",
    isGuardianPage: path.startsWith("/guardian/"),
    isCommonPage: path.startsWith("/common/"),
    isEnrollmentPage: path.startsWith("/enrollment/"),
    isPrintPage: path.startsWith("/print/"),
    isPromotionPage: path.startsWith("/promotion/"),
    isTranscriptPage: path.startsWith("/transcript/"),
    isStatsPage: path.startsWith("/stats/"),
    isDocumentPage: path === "/document" || path.startsWith("/document/"),
    isPublicRoute: isPublicRoute(path),
    isPublicAccountPage: isPublicAccountRoute(path),
    isPublicHubPage: isPublicHubRoute(path),
    isAuthenticatedAppPage: isAuthenticatedAppRoute(path),
    isSpaExcludedRoute: isSpaExcludedRoute(path),
    shouldLoadSpaRouter: shouldLoadSpaRouter(path, session),
  };
}

function getClientSpaConfig() {
  return {
    routesByType: SPA_ROUTES_BY_USER_TYPE,
    excludedExact: Array.from(SPA_EXCLUDED_EXACT),
    excludedPrefixes: SPA_EXCLUDED_PREFIXES.slice(),
    publicAccountExact: Array.from(PUBLIC_ACCOUNT_EXACT),
    publicAccountPrefixes: PUBLIC_ACCOUNT_PREFIXES.slice(),
    publicHubExact: Array.from(PUBLIC_HUB_EXACT),
  };
}

module.exports = {
  PUBLIC_ACCOUNT_EXACT,
  PUBLIC_ACCOUNT_PREFIXES,
  PUBLIC_HUB_EXACT,
  PUBLIC_COMMON_EXACT,
  SPA_EXCLUDED_EXACT,
  SPA_EXCLUDED_PREFIXES,
  SPA_ROUTES_BY_USER_TYPE,
  normalizePath,
  isPublicAccountRoute,
  isPublicHubRoute,
  isPublicRoute,
  isSpaExcludedRoute,
  isAuthenticatedAppRoute,
  isSpaRouteForUser,
  shouldLoadSpaRouter,
  getUserTypeFromSession,
  getRouteFlags,
  getClientSpaConfig,
};