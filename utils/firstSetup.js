// First-time setup (feature first_setup): a school that hasn't personalized yet is walked through
// the basics before its dashboard: its colour, its logo, its details, its first school year and its
// website's look. The colour and the details are asked; the rest can be skipped. Done once:
// organizations.first_setup_done_at (database/migrations/2026-12-18_first_setup.sql).
//
// Who is asked: the school's own account and its managers who hold School Profile & Branding,
// never Managira or a hub looking in. "Hasn't personalized": no setup finished, no logo, the
// colour still the default and no website colour chosen; a school that already chose any of
// those is never asked. Each step is offered only to someone who may make that change
// (School Profile & Branding; Manage School Year & Terms, and only while the school has no
// school year; School Website Settings, which also needs the website in the school's plan).
//
// Every save writes the same columns as Settings does (theme_color and the website's colour,
// organizations.logo under images/logos/<school>/, the name, country, state, address and
// currency, organization_dashboard.order_data.layout, a school year with its terms made current).
const crypto = require("crypto");
const path = require("path");
const features = require("./shards/features");
const { alreadyThere } = require("./schemaHas");

const FEATURE = "first_setup";
const DEFAULT_COLOR = "teal";

let columnReady = false;
let columnCheckedAt = 0;
async function ready(db) {
  if (columnReady) return true;
  if (Date.now() - columnCheckedAt < 60000) return false;
  columnCheckedAt = Date.now();
  columnReady = await alreadyThere(db, { columns: [["organizations", "first_setup_done_at"]] });
  return columnReady;
}

function perm() { return require("../middleware/permissionMiddleware"); }

// The school's own account or a manager of it, signed in as themselves.
function isSchoolLead(session) {
  if (!session || !session.organizationId) return false;
  if (session.superAdminOrgSwitch || session.hubOrgSwitch || session.hubId) return false;
  if (session.guardianId || session.studentId) return false;
  const kind = String(session.accountType || "").trim().toLowerCase();
  if (kind === "organization") return true;
  const role = String(session.userRole || (session.user && session.user.account_type) || "").trim().toLowerCase();
  return role === "manager";
}

async function can(db, req, key) {
  const { userHasPermission, sessionActor } = perm();
  return userHasPermission(db, sessionActor(req), key).catch(() => false);
}

async function schoolRow(db, organizationId) {
  const { rows } = await db.query(
    `SELECT o.organization_id, o.organization_name, o.nickname, o.nickname_display, o.organization_phone,
            o.organization_address, o.organization_province, o.organization_country, o.logo, o.logo_path,
            o.theme_color, o.first_setup_done_at,
            (SELECT d.order_data FROM organization_dashboard d WHERE d.organization_id = o.organization_id LIMIT 1) AS order_data,
            (SELECT COUNT(*)::int FROM school_years y WHERE y.organization_id = o.organization_id) AS school_years,
            (SELECT COUNT(*)::int FROM terms t JOIN school_years y ON y.id = t.school_year_id WHERE y.organization_id = o.organization_id) AS terms,
            (SELECT COUNT(*)::int FROM organization_attendance_calendars c WHERE c.organization_id = o.organization_id) AS calendars,
            EXISTS (SELECT 1 FROM terms t JOIN school_years y ON y.id = t.school_year_id
                     WHERE y.organization_id = o.organization_id AND y.current = TRUE AND t.current = TRUE) AS has_current_term
       FROM organizations o
      WHERE o.organization_id = $1`,
    [organizationId]
  );
  return rows[0] || null;
}

function orderDataOf(raw) {
  let value = raw;
  if (typeof value === "string") { try { value = JSON.parse(value); } catch (_) { value = null; } }
  if (Array.isArray(value)) return { order: value };
  return value && typeof value === "object" ? value : {};
}

function personalized(school) {
  if (!school) return true;
  if (school.first_setup_done_at) return true;
  if (String(school.logo || "").trim() || String(school.logo_path || "").trim()) return true;
  if (school.theme_color && school.theme_color !== DEFAULT_COLOR) return true;
  return Boolean(orderDataOf(school.order_data).theme);
}

// Should this visit to the dashboard go to the setup first?
async function due(db, req) {
  const session = req.session;
  if (!isSchoolLead(session)) return false;
  const organizationId = session.organizationId;
  if (!features.isOn(FEATURE, { organizationId })) return false;
  if (!(await ready(db))) return false;
  const school = await schoolRow(db, organizationId);
  if (!school || school.first_setup_done_at) return false;
  // Started in this session: it carries on to the end, though the colour chosen on the first
  // step already counts as personalizing.
  if (!session.firstSetupStarted && personalized(school)) return false;
  return can(db, req, perm().PERMISSIONS.SETTINGS_PROFILE);
}

// The dashboard's door: a school still to personalize goes to the setup. Once a visit finds
// nothing to do, this session doesn't ask again.
async function sendToSetup(req, res, db) {
  if (req.session.firstSetupClear) return false;
  let needed = false;
  try { needed = await due(db, req); } catch (error) { console.error("[first-setup]", error.message); needed = false; }
  if (!needed) { req.session.firstSetupClear = true; return false; }
  res.redirect("/common/first-setup");
  return true;
}

// The steps this person gets, in order.
// The details a school still hasn't given (the name always comes with sign-up).
function missingDetails(school) {
  const missing = [];
  if (!school.nickname_display || school.nickname_display === school.nickname) missing.push("shortName");
  if (!String(school.organization_phone || "").trim()) missing.push("phone");
  if (!String(school.organization_address || "").trim()) missing.push("address");
  if (!String(school.organization_province || "").trim()) missing.push("state");
  if (!String(school.organization_country || "").trim()) missing.push("country");
  return missing;
}

// How the school year step looks: "create" (no school year yet), "current" (terms, none
// current: pick one), or null (a current term is set, or nothing the step can do).
function yearMode(school) {
  if (school.has_current_term) return null;
  if (!school.school_years) return "create";
  return school.terms ? "current" : null;
}

// Only what the school hasn't set yet, each to someone who may set it. A step done before a
// reload isn't asked again.
async function stepsFor(db, req, school) {
  const { PERMISSIONS } = perm();
  const [year, website] = await Promise.all([
    can(db, req, PERMISSIONS.MANAGE_SCHOOL_YEAR_TERMS),
    can(db, req, PERMISSIONS.SETTINGS_WEBSITE),
  ]);
  const order = orderDataOf(school.order_data);
  const steps = [];
  if (!order.theme && (!school.theme_color || school.theme_color === DEFAULT_COLOR)) steps.push("color");
  if (!String(school.logo || "").trim() && !String(school.logo_path || "").trim()) steps.push("logo");
  if (missingDetails(school).length) steps.push("details");
  if (year && yearMode(school)) steps.push("year");
  // School days and days off belong to a term: offered when the school has one, or makes one
  // on the step before; never over a calendar the school already set.
  if (!school.calendars && (school.terms || steps.includes("year"))) steps.push("calendar");
  if (website && !(typeof order.layout === "string" && order.layout.trim())) steps.push("website");
  return steps;
}

// The school's terms, for choosing the current one.
async function termsToChoose(db, organizationId) {
  const { rows } = await db.query(
    `SELECT t.term_id, t.term_name, t.start_date::text AS start, t.end_date::text AS end, y.id AS year_id, y.year_label
       FROM terms t JOIN school_years y ON y.id = t.school_year_id
      WHERE y.organization_id = $1
      ORDER BY t.start_date DESC NULLS LAST, t.term_id DESC
      LIMIT 24`,
    [organizationId]
  );
  return rows;
}

// Make one of the school's terms (and its year) current, as School years & terms does.
async function setCurrentTerm(db, req, termId) {
  const organizationId = req.session.organizationId;
  const id = Number(termId);
  if (!Number.isInteger(id) || id <= 0) throw new SetupError("Choose the term you're in now.");
  const client = await db.connect();
  try {
    await client.query("BEGIN");
    const term = await client.query(
      `SELECT t.term_id, t.term_name, y.id AS year_id, y.year_label FROM terms t JOIN school_years y ON y.id = t.school_year_id
        WHERE t.term_id = $1 AND y.organization_id = $2`,
      [id, organizationId]
    );
    if (!term.rows[0]) throw new SetupError("Choose one of your school's terms.", 404);
    await client.query("UPDATE school_years SET current = (id = $2) WHERE organization_id = $1", [organizationId, term.rows[0].year_id]);
    await client.query("UPDATE terms SET current = (term_id = $2) WHERE organization_id = $1", [organizationId, id]);
    await client.query("COMMIT");
    try { require("./setupChecklist").forget(organizationId); } catch (_) {}
    return { label: term.rows[0].year_label, current: term.rows[0].term_name };
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {});
    throw error;
  } finally {
    client.release();
  }
}

// ── Saving ───────────────────────────────────────────────────────────────────────────────

class SetupError extends Error {
  constructor(message, status = 400) { super(message); this.status = status; }
}

// The website keeps its own copy of the colour (and its design) in organization_dashboard.
async function mergeOrderData(db, organizationId, patch) {
  const existing = await db.query("SELECT order_data FROM organization_dashboard WHERE organization_id = $1", [organizationId]);
  const current = orderDataOf(existing.rows[0] && existing.rows[0].order_data);
  const payload = {
    order: Array.isArray(current.order) ? current.order : [],
    theme: current.theme || "classic",
    layout: typeof current.layout === "string" && current.layout.trim() ? current.layout.trim() : "wireframe1",
    aboutDetails: current.aboutDetails && typeof current.aboutDetails === "object" ? current.aboutDetails : {},
    ...patch,
  };
  await db.query(
    `INSERT INTO organization_dashboard (organization_id, order_data) VALUES ($1, $2)
     ON CONFLICT (organization_id) DO UPDATE SET order_data = EXCLUDED.order_data`,
    [organizationId, payload]
  );
}

async function saveColor(db, req, colorKey) {
  const { BRAND_COLOR_OPTIONS } = require("./themePalette");
  const option = BRAND_COLOR_OPTIONS.find((o) => o.key === colorKey);
  if (!option) throw new SetupError("Choose one of the colours.");
  const organizationId = req.session.organizationId;
  await db.query("UPDATE organizations SET theme_color = $1 WHERE organization_id = $2", [option.key, organizationId]);
  await mergeOrderData(db, organizationId, { theme: option.value });
  require("./orgTheme").forgetOrgThemeColor(organizationId);
  req.session.themeColor = option.key;
  return { color: option.key };
}

const LOGO_TYPES = { "image/png": ".png", "image/jpeg": ".jpg", "image/webp": ".webp", "image/gif": ".gif" };
const LOGO_MAX_BYTES = 5 * 1024 * 1024;

async function saveLogo(db, req, file) {
  if (!file) throw new SetupError("Choose a picture of your logo.");
  const ext = LOGO_TYPES[String(file.mimetype || "").toLowerCase()];
  if (!ext) throw new SetupError("Use a PNG, JPG, WebP or GIF picture.");
  if (file.size > LOGO_MAX_BYTES) throw new SetupError("Use a picture under 5 MB.");
  const { uploadToS3, deleteFromS3 } = require("../middleware/s3Upload");
  const organizationId = req.session.organizationId;
  const previous = (await db.query("SELECT logo FROM organizations WHERE organization_id = $1", [organizationId])).rows[0];
  // A random part in every name (two schools' "logo.png" never meet), a lower-case picture extension.
  const base = path.basename(String(file.originalname || "logo"), path.extname(String(file.originalname || "")))
    .normalize("NFKD").replace(/[^a-zA-Z0-9_-]+/g, "-").replace(/-+/g, "-").replace(/^-|-$/g, "").toLowerCase().slice(0, 60) || "logo";
  const key = `images/logos/${organizationId}/${Date.now()}-${crypto.randomBytes(4).toString("hex")}-${base}${ext}`;
  const url = await uploadToS3(file, key);
  await db.query("UPDATE organizations SET logo = $1 WHERE organization_id = $2", [url, organizationId]);
  req.session.logo = url;
  const oldKey = previousKey(previous && previous.logo);
  if (oldKey && oldKey !== key) deleteFromS3(oldKey).catch(() => {});
  return { logo: url };
}

function previousKey(url) {
  const value = String(url || "").trim();
  if (!value) return null;
  const prefix = `https://${process.env.S3_BUCKET_NAME}.s3.${process.env.AWS_REGION}.amazonaws.com/`;
  if (value.startsWith(prefix)) return value.slice(prefix.length);
  return value.startsWith("images/logos/") ? value : null;
}

const clean = (value, max) => String(value == null ? "" : value).replace(/\s+/g, " ").trim().slice(0, max);

// Saves only the details the step asked for (it shows just the missing ones); the rest stays.
async function saveDetails(db, req, body) {
  const { COUNTRY_NAME_LOOKUP } = require("./countries");
  const has = (key) => Object.prototype.hasOwnProperty.call(body || {}, key);
  const organizationId = req.session.organizationId;
  const sets = [];
  const values = [];
  const set = (column, value) => { values.push(value); sets.push(`${column} = $${values.length}`); };

  let name = null;
  if (has("name")) {
    name = clean(body.name, 150);
    if (!name) throw new SetupError("Enter your school's name.");
    set("organization_name", name);
  }
  if (has("shortName")) {
    // The school nickname, exactly as Settings › Customize saves it (organizations.nickname_display,
    // 3 to 60 characters; the web address itself never changes).
    const shortName = require("./orgNicknameSlug").normalizeDisplayName(body.shortName);
    if (shortName && shortName.length < 3) throw new SetupError("A nickname needs at least 3 characters.");
    if (shortName.length > 60) throw new SetupError("A nickname is at most 60 characters.");
    // The website's header shows nickname_display, which starts as the web address
    // ("cedar-grove"). Left empty, it becomes the school's name (Settings allows 3 to 60 characters).
    const current = (await db.query("SELECT organization_name, nickname, nickname_display FROM organizations WHERE organization_id = $1", [organizationId])).rows[0] || {};
    const fullName = name || current.organization_name || "";
    const fallback = fullName.length >= 3 ? fullName.slice(0, 60) : null;
    if (shortName) set("nickname_display", shortName);
    else if (fallback && (!current.nickname_display || current.nickname_display === current.nickname)) set("nickname_display", fallback);
  }
  if (has("phone")) {
    const phone = clean(body.phone, 30);
    if (phone && !/^[+()0-9.\-\s]{7,30}$/.test(phone)) throw new SetupError("Enter the phone number with digits only (spaces, dashes and + are fine).");
    set("organization_phone", phone || null);
  }
  // The address column never holds NULL (an empty one is ""), as on sign-up.
  if (has("address")) set("organization_address", clean(body.address, 250));
  if (has("state")) set("organization_province", clean(body.state, 100) || null);
  let country = null;
  if (has("country")) {
    country = clean(body.country, 2).toUpperCase();
    if (!/^[A-Z]{2}$/.test(country) || !COUNTRY_NAME_LOOKUP[country]) throw new SetupError("Choose your country.");
    const { getCurrencyForCountry, normalizeCurrencyCode } = require("./currencyLocalization");
    set("organization_country", country);
    const currency = normalizeCurrencyCode(getCurrencyForCountry(country));
    if (currency) set("organization_currency", currency);
  }
  if (sets.length) {
    values.push(organizationId);
    await db.query(`UPDATE organizations SET ${sets.join(", ")} WHERE organization_id = $${values.length}`, values);
  }
  if (name) req.session.organizationName = name;
  if (country) require("./schoolCountry").forgetSchoolCountry(organizationId);
  if (has("address") || has("state") || country) {
    // The map pin follows the address, in the background (as Settings does).
    const row = (await db.query("SELECT organization_address, organization_province, organization_country FROM organizations WHERE organization_id = $1", [organizationId])).rows[0] || {};
    Promise.resolve().then(() => require("./geocode").autoGeocodeOrg(db, organizationId, row.organization_address || null, row.organization_province || null, row.organization_country || "US")).catch(() => {});
  }
  return { saved: sets.length };
}

// The school year as US schools usually start it: August to June.
function defaultYear(today = new Date()) {
  const y = today.getMonth() >= 6 ? today.getFullYear() : today.getFullYear() - 1;
  return { label: `${y}-${y + 1}`, start: `${y}-08-15`, end: `${y + 1}-06-10` };
}

const STRUCTURES = {
  semesters: ["Fall Semester", "Spring Semester"],
  trimesters: ["Trimester 1", "Trimester 2", "Trimester 3"],
  quarters: ["Quarter 1", "Quarter 2", "Quarter 3", "Quarter 4"],
  year: ["Full Year"],
};

const DAY = 24 * 60 * 60 * 1000;
const isoDay = (date) => date.toISOString().slice(0, 10);
function parseDay(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(value || ""))) return null;
  const date = new Date(`${value}T00:00:00Z`);
  return Number.isNaN(date.getTime()) || isoDay(date) !== value ? null : date;
}

// The year split into back-to-back terms of (nearly) equal length.
function termsFor(structure, start, end) {
  const names = STRUCTURES[structure];
  if (!names) return null;
  const startDay = parseDay(start);
  const endDay = parseDay(end);
  if (!startDay || !endDay) return null;
  const days = Math.round((endDay - startDay) / DAY) + 1;
  if (days < names.length * 7) return null;
  const terms = [];
  let from = startDay;
  names.forEach((name, i) => {
    const to = i === names.length - 1 ? endDay : new Date(startDay.getTime() + (Math.round((days * (i + 1)) / names.length) - 1) * DAY);
    terms.push({ name, start: isoDay(from), end: isoDay(to) });
    from = new Date(to.getTime() + DAY);
  });
  return terms;
}

async function saveYear(db, req, body) {
  const label = clean(body.label, 9);
  const match = /^(\d{4})-(\d{4})$/.exec(label);
  if (!match || Number(match[2]) !== Number(match[1]) + 1) throw new SetupError("Write the school year as 2026-2027.");
  const startDay = parseDay(body.start);
  const endDay = parseDay(body.end);
  if (!startDay || !endDay) throw new SetupError("Choose the first and last day of the school year.");
  if (endDay <= startDay) throw new SetupError("The last day comes after the first day.");
  if ((endDay - startDay) / DAY > 400) throw new SetupError("A school year is at most about 13 months.");
  const terms = termsFor(String(body.structure || ""), body.start, body.end);
  if (!terms) throw new SetupError("Choose how the year is divided.");
  const organizationId = req.session.organizationId;
  const today = isoDay(new Date());
  // The term they say they're in now; else the one holding today.
  const chosen = Number(body.currentIndex);
  const currentIndex = Number.isInteger(chosen) && chosen >= 0 && chosen < terms.length
    ? chosen
    : Math.max(0, terms.findIndex((t) => t.end >= today));
  const structure = String(body.structure || "");
  // The year this setup made earlier in the session (Back, then Continue again).
  const made = req.session.firstSetupYear && Number(req.session.firstSetupYear.id) ? req.session.firstSetupYear : null;
  let replaced = false;
  const client = await db.connect();
  try {
    await client.query("BEGIN");
    // One at a time per school (two tabs): a second look changes nothing it shouldn't.
    await client.query("SELECT pg_advisory_xact_lock(hashtext('first-setup-year:' || $1::text))", [organizationId]);
    const existing = await client.query("SELECT id FROM school_years WHERE organization_id = $1", [organizationId]);
    const ownYear = made && existing.rows.length === 1 && Number(existing.rows[0].id) === Number(made.id) ? Number(made.id) : null;
    if (existing.rows.length && !ownYear) {
      throw new SetupError("Your school already has a school year. Change it in School years & terms, or skip this for now.", 409);
    }
    const same = ownYear && made.label === label && made.start === body.start && made.end === body.end && made.structure === structure;
    if (same) {
      // Nothing changed: only which term is current.
      await client.query(
        `WITH ordered AS (SELECT term_id, ROW_NUMBER() OVER (ORDER BY start_date, term_id) - 1 AS ord FROM terms WHERE school_year_id = $1)
         UPDATE terms t SET current = (o.ord = $2) FROM ordered o WHERE o.term_id = t.term_id`,
        [ownYear, currentIndex]
      );
      await client.query("UPDATE school_years SET current = (id = $2) WHERE organization_id = $1", [organizationId, ownYear]);
    } else {
      let yearId = ownYear;
      if (ownYear) {
        // Changed: this setup's own year takes the new dates and terms (a calendar set on the
        // step after it goes with its terms; that step asks again).
        await client.query("DELETE FROM organization_attendance_calendars WHERE organization_id = $1 AND school_year_id = $2", [organizationId, ownYear]);
        await client.query("DELETE FROM terms WHERE school_year_id = $1", [ownYear]);
        await client.query("UPDATE school_years SET year_label = $2, current = TRUE WHERE id = $1", [ownYear, label]);
        replaced = true;
      } else {
        const year = await client.query(
          "INSERT INTO school_years (year_label, organization_id, current) VALUES ($1, $2, TRUE) RETURNING id",
          [label, organizationId]
        );
        yearId = year.rows[0].id;
      }
      await client.query(
        `INSERT INTO terms (term_name, start_date, end_date, school_year_id, organization_id, current)
         SELECT name, start_date, end_date, $5, $6, ord = $7
           FROM unnest($1::text[], $2::date[], $3::date[], $4::int[]) AS t(name, start_date, end_date, ord)`,
        [terms.map((t) => t.name), terms.map((t) => t.start), terms.map((t) => t.end), terms.map((_, i) => i), yearId, organizationId, currentIndex]
      );
      req.session.firstSetupYear = { id: yearId, label, start: body.start, end: body.end, structure };
    }
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {});
    // Something else already uses that year (another page added to it): leave it be.
    if (error && error.code === "23503") throw new SetupError("Your school year is in use now. Change it in School years & terms, or skip this for now.", 409);
    throw error;
  } finally {
    client.release();
  }
  try { require("./setupChecklist").forget(organizationId); } catch (_) {}
  return { label, terms, current: terms[currentIndex].name, replaced };
}

// ── School calendar: school days, public holidays and days off (Settings › School rules) ──

// The school year the calendar covers: the current one's terms, else the usual US year.
async function yearRange(db, organizationId) {
  const { rows } = await db.query(
    `SELECT MIN(t.start_date)::text AS start, MAX(t.end_date)::text AS end
       FROM terms t JOIN school_years y ON y.id = t.school_year_id
      WHERE y.organization_id = $1 AND y.current = TRUE`,
    [organizationId]
  );
  if (rows[0] && rows[0].start && rows[0].end) return { start: rows[0].start, end: rows[0].end };
  const fallback = defaultYear();
  return { start: fallback.start, end: fallback.end };
}

async function countryOf(db, organizationId) {
  const { rows } = await db.query("SELECT organization_country FROM organizations WHERE organization_id = $1", [organizationId]);
  const code = String((rows[0] && rows[0].organization_country) || "").toUpperCase();
  const { COUNTRY_NAME_LOOKUP } = require("./countries");
  return COUNTRY_NAME_LOOKUP[code] ? code : "US";
}

// The public holidays a school year holds (the same list Settings adds).
function publicHolidays(countryCode, start, end) {
  const Holidays = require("date-holidays");
  const list = [];
  try {
    const hd = new Holidays(countryCode);
    for (let year = Number(start.slice(0, 4)); year <= Number(end.slice(0, 4)); year += 1) {
      (hd.getHolidays(year) || []).forEach((h) => {
        if (String(h.type || "").toLowerCase() !== "public") return;
        const date = String(h.date || h.start || "").slice(0, 10);
        if (date >= start && date <= end && !list.some((x) => x.date === date)) list.push({ date, name: h.name || "Public holiday" });
      });
    }
  } catch (_) { /* a country the list doesn't know: none */ }
  return list.sort((a, b) => a.date.localeCompare(b.date));
}

async function holidaysFor(db, req) {
  const organizationId = req.session.organizationId;
  const [range, country] = await Promise.all([yearRange(db, organizationId), countryOf(db, organizationId)]);
  const { COUNTRY_NAME_LOOKUP } = require("./countries");
  return { country, countryName: COUNTRY_NAME_LOOKUP[country], start: range.start, end: range.end, holidays: publicHolidays(country, range.start, range.end) };
}

async function saveCalendar(db, req, body) {
  const calendar = require("./attendanceCalendar");
  const organizationId = req.session.organizationId;
  const schoolDays = [...new Set((Array.isArray(body.schoolDays) ? body.schoolDays : []).map(Number).filter((d) => Number.isInteger(d) && d >= 0 && d <= 6))];
  if (!schoolDays.length) throw new SetupError("Choose at least one school day.");
  const weekendDays = [0, 1, 2, 3, 4, 5, 6].filter((d) => !schoolDays.includes(d));
  const includeHolidays = body.publicHolidays !== false;
  const range = await yearRange(db, organizationId);
  const daysOff = (Array.isArray(body.daysOff) ? body.daysOff : []).slice(0, 40).map((d) => ({ date: String((d && d.date) || ""), label: clean(d && d.label, 80) }));
  for (const day of daysOff) {
    if (!parseDay(day.date)) throw new SetupError("Each day off needs a date.");
    if (!day.label) throw new SetupError("Give each day off a name, such as Thanksgiving break.");
  }
  // The term the school's calendar hangs on, as Settings chooses it.
  const term = await db.query(
    `SELECT t.term_id, t.school_year_id FROM terms t JOIN school_years sy ON sy.id = t.school_year_id
      WHERE sy.organization_id = $1 ORDER BY sy.current DESC, t.current DESC, t.start_date DESC LIMIT 1`,
    [organizationId]
  );
  if (!term.rows[0]) throw new SetupError("Set up a school year first, or skip this for now.", 409);
  const userId = req.session.userId || (req.session.user && req.session.user.user_id) || null;
  const countryCode = await countryOf(db, organizationId);
  const profile = await calendar.upsertAttendanceCalendarProfile(db, {
    organizationId,
    schoolYearId: term.rows[0].school_year_id,
    termId: term.rows[0].term_id,
    countryCode,
    weekendDays,
    includePublicHolidays: includeHolidays,
    userId: req.session.accountType === "Organization" ? null : userId,
  });
  if (includeHolidays) {
    const now = new Date();
    await calendar.syncPublicHolidayDays(db, {
      calendarId: profile.calendar_id, organizationId, countryCode,
      startDate: `${now.getUTCFullYear()}-01-01`, endDate: `${now.getUTCFullYear() + 2}-12-31`,
      userId: req.session.accountType === "Organization" ? null : userId,
    });
  } else {
    await db.query("DELETE FROM organization_attendance_calendar_days WHERE calendar_id = $1 AND source = 'public_holiday'", [profile.calendar_id]);
  }
  for (const day of daysOff) {
    await calendar.upsertManualCalendarDay(db, {
      calendarId: profile.calendar_id, organizationId, calendarDate: day.date, label: day.label,
      countsForAttendance: false, userId: req.session.accountType === "Organization" ? null : userId,
    });
  }
  try { require("./setupChecklist").forget(organizationId); } catch (_) {}
  const holidays = includeHolidays ? publicHolidays(countryCode, range.start, range.end).length : 0;
  return { schoolDays, holidays, daysOff: daysOff.length };
}

function websiteLayouts() {
  const { layoutsFor } = require("./websiteView");
  return layoutsFor();
}

async function saveWebsite(db, req, layout) {
  const organizationId = req.session.organizationId;
  const choice = websiteLayouts(organizationId).find((l) => l.value === layout);
  if (!choice) throw new SetupError("Choose one of the designs.");
  await mergeOrderData(db, organizationId, { layout: choice.value });
  return { layout: choice.value };
}

async function finish(db, req) {
  const organizationId = req.session.organizationId;
  await db.query("UPDATE organizations SET first_setup_done_at = COALESCE(first_setup_done_at, NOW()) WHERE organization_id = $1", [organizationId]);
  req.session.firstSetupClear = true;
  // The dashboard celebrates once (notificationsRoute /new-term-popup).
  req.session.firstSetupCelebrate = true;
  try { require("./setupChecklist").forget(organizationId); } catch (_) {}
}

module.exports = {
  FEATURE,
  STRUCTURES,
  SetupError,
  isSchoolLead,
  due,
  sendToSetup,
  schoolRow,
  stepsFor,
  orderDataOf,
  defaultYear,
  termsFor,
  websiteLayouts,
  saveColor,
  saveLogo,
  saveDetails,
  saveYear,
  saveWebsite,
  saveCalendar,
  holidaysFor,
  missingDetails,
  yearMode,
  termsToChoose,
  setCurrentTerm,
  finish,
  ready,
};
