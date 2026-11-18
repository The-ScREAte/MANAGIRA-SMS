// First-time setup (utils/firstSetup.js): the page, and one save for each step.
const firstSetup = require("../utils/firstSetup");

const US_STATES = ["Alabama", "Alaska", "Arizona", "Arkansas", "California", "Colorado", "Connecticut", "Delaware", "District of Columbia", "Florida", "Georgia", "Hawaii", "Idaho", "Illinois", "Indiana", "Iowa", "Kansas", "Kentucky", "Louisiana", "Maine", "Maryland", "Massachusetts", "Michigan", "Minnesota", "Mississippi", "Missouri", "Montana", "Nebraska", "Nevada", "New Hampshire", "New Jersey", "New Mexico", "New York", "North Carolina", "North Dakota", "Ohio", "Oklahoma", "Oregon", "Pennsylvania", "Rhode Island", "South Carolina", "South Dakota", "Tennessee", "Texas", "Utah", "Vermont", "Virginia", "Washington", "West Virginia", "Wisconsin", "Wyoming"];

function countries() {
  const { COUNTRIES_BY_CONTINENT } = require("../utils/countries");
  return Object.values(COUNTRIES_BY_CONTINENT).flat()
    .filter((c, i, all) => all.findIndex((o) => o.code === c.code) === i)
    .sort((a, b) => a.name.localeCompare(b.name));
}

async function page(req, res, db) {
  if (!(await firstSetup.due(db, req))) return res.redirect("/common/orgDashboard");
  req.session.firstSetupStarted = true;
  const school = await firstSetup.schoolRow(db, req.session.organizationId);
  const steps = await firstSetup.stepsFor(db, req, school);
  const { BRAND_COLOR_OPTIONS, THEME_PALETTE } = require("../utils/themePalette");
  const colors = BRAND_COLOR_OPTIONS.map((o) => ({ key: o.key, name: o.name, hex: (THEME_PALETTE[o.key] || THEME_PALETTE.teal).primary }));
  const logoRaw = school.logo || school.logo_path || "";
  const order = firstSetup.orderDataOf(school.order_data);
  const yearMode = steps.includes("year") ? firstSetup.yearMode(school) : null;
  return res.render("common/firstSetup", {
    layout: false,
    title: "Set up your school",
    steps,
    colors,
    school: {
      name: school.organization_name || "",
      // The web address isn't a name: the box starts empty then.
      shortName: school.nickname_display && school.nickname_display !== school.nickname ? school.nickname_display : "",
      phone: school.organization_phone || "",
      address: school.organization_address || "",
      state: school.organization_province || "",
      country: school.organization_country || "US",
      color: school.theme_color || "teal",
      logo: logoRaw ? res.locals.publicImageUrl(logoRaw, { public: true, width: 256 }) : "",
      layout: typeof order.layout === "string" ? order.layout : "wireframe1",
    },
    countries: countries(),
    usStates: US_STATES,
    year: firstSetup.defaultYear(),
    // Without a term the calendar has nothing to hang on: the page skips it if the year step is skipped.
    hasTerms: Boolean(school.terms),
    // Only the details the school hasn't given are asked.
    missingDetails: firstSetup.missingDetails(school),
    // School year: "create" (none yet) or "current" (terms, none current: pick one).
    yearMode,
    termsToChoose: yearMode === "current" ? await firstSetup.termsToChoose(db, req.session.organizationId) : [],
    structures: Object.keys(firstSetup.STRUCTURES).map((key) => ({ key, names: firstSetup.STRUCTURES[key] })),
    layouts: steps.includes("website") ? firstSetup.websiteLayouts(req.session.organizationId).map((l) => ({ value: l.value, key: l.key, base: l.base || l.key, name: l.name, description: l.description, style: l.group !== "standard" ? l.style : "", emblem: Boolean(l.emblem), motion: Boolean(l.motion) })) : [],
  });
}

// Each save: the school's own account or a manager, signed in as themselves, holding the
// permission for that change (Settings' own rule).
function save(permissionKey, work) {
  return async (req, res, db) => {
    res.set("Cache-Control", "no-store");
    try {
      const { userHasPermission, sessionActor, PERMISSIONS } = require("../middleware/permissionMiddleware");
      if (!firstSetup.isSchoolLead(req.session)) return res.status(403).json({ error: "Only the school's managers set this up." });
      const key = typeof permissionKey === "function" ? permissionKey(PERMISSIONS) : permissionKey;
      if (key && !(await userHasPermission(db, sessionActor(req), key))) {
        return res.status(403).json({ error: "You don't have permission to change this. Skip it for now." });
      }
      const result = await work(db, req);
      return res.json({ ok: true, ...result });
    } catch (error) {
      if (error instanceof firstSetup.SetupError) return res.status(error.status).json({ error: error.message });
      console.error("[first-setup]", error.message);
      return res.status(500).json({ error: "That couldn't be saved. Try again." });
    }
  };
}

module.exports = {
  page: async (req, res, db) => {
    try { return await page(req, res, db); } catch (error) {
      console.error("[first-setup] page", error.message);
      req.session.firstSetupClear = true;
      return res.redirect("/common/orgDashboard");
    }
  },
  color: save((P) => P.SETTINGS_PROFILE, (db, req) => firstSetup.saveColor(db, req, String((req.body && req.body.color) || ""))),
  logo: save((P) => P.SETTINGS_PROFILE, (db, req) => firstSetup.saveLogo(db, req, req.file)),
  details: save((P) => P.SETTINGS_PROFILE, (db, req) => firstSetup.saveDetails(db, req, req.body || {})),
  year: save((P) => P.MANAGE_SCHOOL_YEAR_TERMS, (db, req) => firstSetup.saveYear(db, req, req.body || {})),
  currentTerm: save((P) => P.MANAGE_SCHOOL_YEAR_TERMS, (db, req) => firstSetup.setCurrentTerm(db, req, req.body && req.body.termId)),
  calendar: save((P) => P.SETTINGS_PROFILE, (db, req) => firstSetup.saveCalendar(db, req, req.body || {})),
  holidays: save((P) => P.SETTINGS_PROFILE, (db, req) => firstSetup.holidaysFor(db, req)),
  website: save((P) => P.SETTINGS_WEBSITE, (db, req) => firstSetup.saveWebsite(db, req, String((req.body && req.body.layout) || ""))),
  finish: save(null, async (db, req) => { await firstSetup.finish(db, req); return { next: "/common/orgDashboard" }; }),
};
