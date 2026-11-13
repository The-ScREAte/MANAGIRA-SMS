"use strict";
// The other apps a school ran beside its old student system (a library system, a food service
// point of sale, a nurse's office app…), read from the names of the lists it exported. For each:
// where Managira already does the job, or how to keep the app and connect it to Managira through
// a service account (Management › Service Accounts, utils/apiAccess.js API_AREAS), so it keeps
// its students, classes and staff up to date from Managira as it did from the old system.
// Everything in the lists is kept either way (read-only, on each student or for the school).

// `has`: what Managira already offers (null: nothing like it), `where`: where to find it,
// `integration`: switched on in Settings › Integrations. `connect`: the API areas an app of this
// kind needs (keys of API_AREAS), and what it would do with them.
const t = (words) => new RegExp(`(^|_)(${words})`);
// Lists that are records, not an app's (counseling, safety, legal): kept restricted, no suggestion.
const NOT_AN_APP = t("suicide|threat|title_?ix|counsel|safety_plan|subpoena|ferpa|court|homeless|foster|retention|sensitive_data|bullying|investigation");
const AREAS = [
  { key: "transport", label: "Transportation", match: t("bus(es)?(_|$)|transport|routes?(_|$)|stops?(_|$)|drivers?(_|$)|gps|ridership|mileage|pretrip"),
    has: "Transportation: buses, routes, stops, riders, live bus tracking and driver reports", where: "In Settings › Integrations › Transportation", integration: true,
    connect: ["students", "transport"], about: "A routing app (such as Transfinder or Edulog) reads riders and stops." },
  { key: "special", label: "Special education", match: t("iep|sped|504|special_?ed|evaluation|learning_support|medicaid"),
    has: "IEP, Section 504 and the other indicators on each student (Programs & Indicators, staff only)", partly: true, where: "Plans and evaluations stay in your special education app",
    connect: ["students", "classes", "attendance", "grades"], about: "A special education app reads students, classes, attendance and grades; plans stay in that app (kept restricted here)." },
  { key: "health", label: "Health office", match: t("nurse|health|immuni[sz]|medicat|vaccin|screening|clinic|medical"),
    has: "Medical alerts at the top of each student's record, and the old health records kept restricted", partly: true, where: "A nurse's visit log stays in your health app",
    connect: ["students", "guardians", "attendance"], about: "A nurse's office app (such as SNAP Health) reads students and parents; health details stay in that app." },
  { key: "food", label: "Food service and meals", match: t("cafeteria|lunch|meal|nutrition|food|free_(and_)?reduced|frl(_|$)|pos(_|$)"),
    has: null, where: "Meal balances can be billed in PayGira",
    connect: ["students", "guardians", "paygira"], about: "Keep your point of sale for the lunch line; it reads students and families from Managira." },
  { key: "fees", label: "Fees, tuition and payments", match: t("tuition|billing|invoice|payment|fees?(_|$)|late_fee|statement|store_order|yearbook|dues|deposit|extended_day|refund|financial_aid"),
    has: "PayGira: bills, repeating bills, each student's ledger, online payments and receipts", where: "In PayGira",
    connect: ["students", "guardians", "paygira"], about: "A payment or tuition app reads families, bills and balances." },
  { key: "devices", label: "Devices", match: t("device|mdm|chromebook|laptop|ipad|asset"),
    has: null, connect: ["students", "staff", "classes"], about: "A device or help-desk app (such as Incident IQ) reads students, staff and classes." },
  { key: "library", label: "Library", match: t("librar|circulation|checkout|textbook|books?(_|$)"),
    has: null, connect: ["students", "classes", "staff"], about: "Keep your library system (such as Destiny); it reads students, classes and staff from Managira, so new students can borrow on day one." },
  { key: "visitors", label: "Visitors and pickup", match: t("visitor|sign_?in_?out|reunification|pickup|dismissal"),
    has: "Emergency & pickup details, with do-not-release alerts on each student", partly: true, where: "A visitor sign-in log stays in your visitor app",
    connect: ["students", "guardians"], about: "A visitor app (such as Raptor) reads students and who may collect them." },
  { key: "college", label: "College and career", match: t("college|career|naviance|scoir|work_based|cte(_|$)|dual_enrollment|four_year_(academic_)?plan"),
    has: null, connect: ["students", "grades"], about: "A college and career app (such as Naviance or SCOIR) reads students and their grades." },
  { key: "admissions", label: "Admissions and enrollment", match: t("admission|inquir|applica|waitlist|reenroll|enrollment_contract"),
    has: "Admissions: online applications, review and enrollment", where: "In Admissions",
    connect: null },
  { key: "behavior", label: "Behavior and discipline", match: t("disciplin|detention|incident|behavio|hall_pass|referral|bullying"),
    has: "The Custom editor: your own incident or behavior form, collected any time", partly: true, where: "In Management › Custom editor",
    connect: ["students", "classes"], about: "A behavior app (such as PBIS Rewards) reads students and classes." },
  { key: "athletics", label: "Athletics", match: t("athlet|sports?(_|$)|teams?(_|$)"),
    has: null, connect: ["students", "grades", "calendar"], about: "An athletics app reads students, grades for eligibility and the school calendar." },
  { key: "fundraising", label: "Fundraising and alumni", match: t("donor|gift|pledge|campaign|gala|auction|alumni_directory|endow|development_office"),
    has: null, connect: ["guardians", "students"], about: "A fundraising app (such as Raiser's Edge) reads families and students." },
  { key: "signin", label: "Sign-in accounts", match: t("sso|user_accounts|linked_accounts|single_sign"),
    has: "Single sign-on with your provider (SAML or OpenID Connect), and student and parent portals", where: "In Settings › Tenant configuration › Single sign-on",
    connect: null },
  { key: "learning", label: "Classroom apps", match: t("canvas|schoology|google_classroom|lms|assignment_sync"),
    has: "Google Classroom, both ways", where: "In Settings › Integrations › Google Classroom", integration: true,
    connect: ["students", "classes", "grades"], about: "Another learning app reads students and classes and sends grades in." },
];

const norm = (text) => String(text || "").split(/[›/\\]/).pop().trim().toLowerCase().replace(/^\d+[_ .-]*/, "").replace(/\.(csv|txt|tsv|xlsx?)$/i, "").replace(/[^a-z0-9]+/g, "_");

// From the import's kept lists (report.lists: { name, label, rows }): the areas found, each with
// the lists that showed it. One list counts for its first matching area only.
function appsFrom(listReport, { areaLabels = {} } = {}) {
  const found = new Map();
  for (const list of listReport || []) {
    const text = `${norm(list.name)}_${norm(list.label)}`;
    if (NOT_AN_APP.test(text)) continue;
    const area = AREAS.find((a) => a.match.test(text));
    if (!area) continue;
    const entry = found.get(area.key) || { ...area, match: undefined, lists: [], rows: 0 };
    entry.lists.push(list.label || list.name);
    entry.rows += Number(list.rows) || 0;
    found.set(area.key, entry);
  }
  return AREAS.filter((a) => found.has(a.key)).map((a) => {
    const entry = found.get(a.key);
    return { ...entry, connectLabels: (entry.connect || []).map((k) => areaLabels[k] || k) };
  });
}

module.exports = { AREAS, appsFrom };
