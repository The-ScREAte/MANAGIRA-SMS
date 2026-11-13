"use strict";
// What each uploaded list is, from its name first and its columns second. A school's export can
// hold a hundred lists or more (meals, library, bus scans, nurse visits, alumni, applications…):
// only the ones Managira loads into its features are taken as such; every other list is kept
// read-only, on each student's record when it has a student number, or for the school, and the
// sensitive ones (health, special education, discipline, counseling, legal, staff HR) restricted.
// A name that says nothing ("export.csv") falls back to the columns, and only on a clear match.
const ps = require("./powerschool");

const bare = (value) => String(value || "").toLowerCase().replace(/^\[[^\]]*\]/, "").replace(/[^a-z0-9]/g, "");

// The list's own name: the last part of "export.zip › 05_students.csv", without its number,
// extension, part number or school-year suffix.
function baseName(fileName) {
  const last = String(fileName || "").split(/›|\//).pop().trim(); // "zip › 05_students.csv", "School A/05_students.csv"
  return last
    .replace(/\.[a-z0-9]{2,5}$/i, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^\d+_+/, "")
    .replace(/_?part_?\d+$/, "")
    .replace(/^_+|_+$/g, "");
}
const withoutYears = (name) => name.replace(/(_?(19|20)\d{2}(_\d{2,4})?)+$/, "").replace(/_+$/, "");

// [kind, the name says so, the name says it's something else]
const NAMED = [
  ["staff_roles", /staff_?roles?|security_?groups?|roles?_(and_)?permissions|user_?roles/, /^$/],
  ["section_teachers", /co_?teachers|section_?teachers|sectionteachers|class_?teachers|teacher_?roles|class_?roles/, /^$/],
  ["student_gpas", /(^|_)gpa(_|$)|class_?rank|^gpas?$/, /alumni|graduat|eligib|snapshot|history|ncaa|naia/],
  ["grades", /stored_?grades|storedgrades|transcripts?|historical_?grades|final_?grades|grade_?history/, /alumni|graduat|request|current|gradebook|standard|athletic|honor|hold|tutor|ai_|evaluation|foreign|change|override/],
  ["attendance", /attendance|^att$|^daily_?att/, /code|definition|letter|contract|truanc|court|staff|after_?school|program|sub(stitute)?s?(_|$)|event|conference|meeting|award|perfect|practice|game|club|chronic|seat_?time|minutes|kiosk|homebound|hospital|tutor|study|breakfast|scan|drill/],
  ["enrollments", /^(cc|student_?schedules?|student_?class_?schedules?|schedules?|class_?enrollments?|section_?enrollments?|course_?enrollments?|enrollments?|student_?sections?)$/, /^$/],
  ["classes", /^(sections?|class_?sections?|classes_?(and_)?sections?|classes|master_?schedule|course_?sections|section_?list|sections?_?master|section_?master_?list|class_?master|master_?sections?|class_?list)$/, /^$/],
  ["guardians", /parents?|guardians?|contacts?|family|families/, /portal|pickup|dismissal|consent|request|message|communicat|visitor|volunteer|conference|teacher|ferpa|drill|after_?school|donation|booster|survey|registration|childcare|billing|statement|night|emergency|financial|split|sibling|household|alumni|legal|order|outreach|home_?visit|engagement|tax|application|eligib|waiver|preference|bus|track|token|link|sro|officer|host|homestay|_logs?(_|$)|method|language|interpreter/],
  ["staff", /^(staff|teachers|staff_?directory|staff_?list|staff_?roster|staff_?profiles?|staff_?master|staff_?information|staff_?info|staff_?records|employees|employee_?(list|directory|profiles?|master|roster|information)|faculty|faculty_?(list|directory|roster|profiles?)|teachers?_?(list|directory|roster|profiles?)|personnel|users?|all_?staff_?roster)$/, /^$/],
  ["students", /^(students?|student_?demographics|demographics|student_?list|student_?roster|student_?information|student_?info|student_?profiles?|student_?master|student_?directory|student_?data|student_?records|student_?census|students_?(export|all|master)|all_?students|enrolled_?students|active_?students|student_?biographical|student_?bio)$/, /^$/],
];

// Names that are clearly about something else: never taken as a core list from their columns.
const OTHER_TOPIC = /credential|endorsement|caseload|mentor|coverage|cdl|drug|prereq|rotation|seat|lab_?group|partner|sociogram|nomination|chart|drop_?off|released?_|_log$|_log_|pickup|dismissal|professional|development|training|builder|roster|current|definition|truanc|letter|staff_|_staff|meal|cafeteria|lunch|bus|transport|route|librar|book|health|nurse|medic|immuni|allerg|dental|screening|injur|disciplin|incident|detention|behavior|pbis|bully|threat|suicide|title_?ix|safety|counsel|fee|payment|tuition|billing|invoice|donation|store|yearbook|device|chromebook|mdm|test_?score|assessment|activit|athletic|sport|club|college|scholar|award|honor|survey|login|audit|message|communicat|calendar|bell|menu|inventory|room|facilit|key|badge|locker|parking|permit|volunteer|visitor|drill|work_?order|alumni|graduat|applica|waitlist|lottery|registration|transfer|request|catalog|course_?request|plan|intervention|monitoring|iep|504|sped|special|evaluation|medicaid|transition|service|substitute|leave|certification|license|hr_|payroll|budget|purchase|po_|onerost|integration|privacy|sso|account|alias|name_?change|document|retention|access_?matrix|interpreter|language|homeless|foster|summer|childcare|after_?school|field_?trip|permission_?slip|conference|hall_?pass|gradebook|standard|report_?card|comment|crdc|state_?report|count_?day|cte|career|dual|work_?based|community_?service|four_?year|eligib/;

// Lists that hold what only some staff may see: kept restricted.
const RESTRICTED = /passport|visa(_|$)|sevis|(^|_)i_?20(_|$)|ds_?2019|immigra|probation|juvenile|expul|restraint|seclusion|crisis|risk_?assess|(^|_)sro(_|$)|resource_?officer|tip_?line|web_?filter|chat_?safety|safety_?monitor|(^|_)ssn(_|$)|tax_?id|insurance|birth_?verif|mediation|no_?contact|social_?work|(^|_)(fba|bip|esy|rti|ell|el|esl|lep)(_|$)|manifestation|related_?services|assistive|testing_?accommodation|english_?learner|language_?waiver|fr_?application|free_?reduced|food_?service_?eligib|meal_?eligib|income|collections|write_?off|financial_?responsib|dependent_?care|sociogram|peer_?nomination|climate_?survey|credential|endorsement|evaluation|(^|_)cdl(_|$)|drug_?test|caseload|research|crosswalk|subpoena|foia|sealed|title_?vi(_|$)|tribal|migrant|military|special_?populations|vitals|glucose|diaper|personal_?care|feeding|g_?tube|seizure|diabetes|controlled_?substance|(^|_)lice(_|$)|contagious|communicable|quarantine|(^|_)physicals?(_|$)|athletic_?trainer|injur|(^|_)ouch(_|$)|(^|_)nap(_|$)|sleep|sensory|paraprofessional|1_?to_?1|goal_?progress|(^|_)referrals?(_|$)|reevaluation|mtss|dyslex|special_?needs|conduct|medical_?protocol|health|nurse|medic|immuni|allerg|care_?plan|dental|injur|concuss|screening|special_?(ed|program)|iep|504|sped|evaluation|medicaid|transition|service_?log|disciplin|incident|detention|behavior|bully|threat|suicide|title_?ix|safety_?plan|counsel|custody|subpoena|legal|ferpa|release_of_information|homeless|foster|mtss|intervention|progress_?monitor|staff_?hr|hr_?records|certification|background|leave|payroll|truanc|court|name_?change|alias/;

const { STUDENT_KEYS } = ps;

// The column holding the student number, if the list has one.
function studentColumn(header) {
  for (const key of STUDENT_KEYS) {
    const hit = header.find((h) => bare(h) === key);
    if (hit) return hit;
  }
  return null;
}

// Words schools write in capitals, so "iep_504_meeting_notes" reads "IEP 504 meeting notes".
const ACRONYMS = new Map(["iep", "sped", "cte", "ferpa", "mtss", "rti", "pbis", "gpa", "ell", "esl", "el", "lep", "sso", "mdm", "ap", "ib", "ncaa", "naia", "sat", "act", "psat", "gps",
  "usda", "rfid", "lms", "ai", "id", "ids", "ssn", "fba", "bip", "esy", "sel", "sro", "ada", "fte", "ceeb", "nces", "sced", "dvr", "cctv", "cdl", "dot", "pta", "pto", "nhs", "ffa",
  "jrotc", "rotc", "stem", "steam", "it", "av", "pe", "k5", "k8", "k12", "fr", "frl", "ged", "aup", "mckinney", "wida", "iready", "ixl"].map((w) => [w, w === "k5" ? "K-5" : w === "k8" ? "K-8" : w === "k12" ? "K-12" : w === "mckinney" ? "McKinney" : w === "iready" ? "i-Ready" : w === "ixl" ? "IXL" : w === "ids" ? "IDs" : w.toUpperCase()]));
const ROMAN = new Set(["ii", "iii", "iv", "vi", "ix", "x"]);
// How a list's name reads to a person: "Library checkouts 2019-2026", "Title IX cases".
function labelOf(fileName) {
  const raw = baseName(fileName).replace(/(19|20)(\d{2})_(\d{2,4})(?=_|$)/g, "$1$2-$3");
  const words = raw.split("_").filter(Boolean).map((word, i, all) => {
    if (ACRONYMS.has(word)) return ACRONYMS.get(word);
    if (ROMAN.has(word) && i > 0 && /^title$/.test(all[i - 1])) return word.toUpperCase();
    return word;
  }).join(" ").trim();
  return words ? words[0].toUpperCase() + words.slice(1) : "Other list";
}

// The columns alone, for a list whose name says nothing: only clear matches count.
function fromColumns(header) {
  const cols = new Set(header.map(bare));
  const has = (...names) => names.some((n) => cols.has(n));
  const entity = ps.detectEntity(header);
  if (entity === "students") return has(...STUDENT_KEYS) && has("firstname") && has("lastname") && has("dob", "dateofbirth", "birthdate", "gradelevel", "grade") ? "students" : null;
  return fits(entity, header) ? entity : null;
}

// The columns must agree with what a list's name (or its columns) says it is: a grades list has a
// course and a mark, an attendance list a date and a code (or day totals), a parents list their
// names and a way to reach them, a class enrollment a student and a section.
function fits(entity, header) {
  const m = new Set(ps.bestMatches(entity, header).values());
  const any = (...targets) => targets.some((t) => m.has(t));
  switch (entity) {
    case "students": return m.has("source_id") && ((m.has("first_name") && m.has("last_name")) || m.has("full_name"));
    case "guardians": return any("student_source_id", "source_id") && any("full_name", "first_name", "last_name") && any("email", "phone", "relationship");
    case "grades": return m.has("student_source_id") && m.has("course_name") && any("grade", "percent", "credits", "gpa_points");
    case "attendance": return m.has("student_source_id") && ((m.has("date") && any("code", "present")) || any("days_present", "days_absent", "days_excused", "days_unexcused", "days_tardy"));
    case "enrollments": return m.has("student_source_id") && m.has("section_source_id");
    case "classes": return m.has("source_id") && m.has("class_name");
    case "student_gpas": return m.has("student_source_id") && any("gpa_weighted", "gpa_unweighted", "gpa_value");
    case "staff": return m.has("source_id") && any("first_name", "last_name", "full_name");
    case "section_teachers": return m.has("section_source_id") && m.has("teacher_source_id");
    case "staff_roles": return m.has("source_id") && any("access_group", "role");
    default: return true;
  }
}

// A list of extra details about each student (lockers, house, pathway…): each column becomes a
// labeled detail on the student, not a list of its own.
const DETAILS = /^(custom_?fields|student_?custom_?fields|extra_?fields|student_?fields|custom_?data)$/;

// { entity, label, restricted, studentColumn, details, by }: entity is a core list ("students", …) or "other".
function recognize(fileName, header) {
  const name = baseName(fileName);
  const plain = withoutYears(name);
  const other = (by) => ({ entity: "other", label: labelOf(fileName), restricted: RESTRICTED.test(name), studentColumn: studentColumn(header), details: false, by });
  if (DETAILS.test(plain) && studentColumn(header)) return { entity: "student_details", label: ps.ENTITIES.student_details.label, restricted: false, studentColumn: studentColumn(header), details: true, by: "name" };
  for (const [entity, says, unless] of NAMED) {
    if (!says.test(plain)) continue;
    // Named like a core list but about something else ("staff attendance", "attendance codes"):
    // kept read-only, never guessed again from its columns.
    if (unless.test(plain)) return other("name");
    // The columns must agree: a list named "students" without student numbers isn't one. A
    // parents list on its own (each parent once, by their contact number) is parents too: a
    // relationships list, or the family's number, links them to their children.
    if (!fits(entity, header)) return other("name, but not its columns");
    return { entity, label: ps.ENTITIES[entity] ? ps.ENTITIES[entity].label : entity, restricted: false, studentColumn: studentColumn(header), by: "name" };
  }
  if (OTHER_TOPIC.test(name)) return other("name");
  const entity = fromColumns(header);
  if (entity) return { entity, label: ps.ENTITIES[entity] ? ps.ENTITIES[entity].label : entity, restricted: false, studentColumn: studentColumn(header), by: "columns" };
  return other("nothing matched");
}

module.exports = { recognize, baseName, labelOf, studentColumn, fits, RESTRICTED, STUDENT_KEYS };
