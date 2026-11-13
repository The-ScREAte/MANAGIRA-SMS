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
  ["student_gpas", /(^|_)gpa(_|$)|class_?rank|^gpas?$/, /alumni|graduat|eligib/],
  ["grades", /stored_?grades|storedgrades|transcripts?|historical_?grades|final_?grades|grade_?history/, /alumni|graduat|request|current|gradebook|standard|athletic|honor/],
  ["attendance", /attendance|^att$|^daily_?att/, /code|definition|letter|contract|truanc|court|staff|after_?school|program|sub(stitute)?s?(_|$)|event|conference|meeting/],
  ["enrollments", /^(cc|student_?schedules?|schedules?|class_?enrollments?|section_?enrollments?|course_?enrollments?|enrollments?)$/, /^$/],
  ["classes", /^(sections?|class_?sections?|classes_?(and_)?sections?|classes|master_?schedule|course_?sections|section_?list)$/, /^$/],
  ["guardians", /parents?|guardians?|contacts?|family|families/, /portal|pickup|dismissal|consent|request|message|communicat|visitor|volunteer|conference|teacher|ferpa|drill|after_?school|donation|booster|survey|registration|childcare|billing|statement|night/],
  ["staff", /^(staff|teachers|staff_?directory|staff_?list|staff_?roster|employees|faculty|users?|all_?staff_?roster)$/, /^$/],
  ["students", /^(students?|student_?demographics|demographics|student_?list|student_?roster|student_?information|students_?export)$/, /^$/],
];

// Names that are clearly about something else: never taken as a core list from their columns.
const OTHER_TOPIC = /drop_?off|released?_|_log$|_log_|pickup|dismissal|professional|development|training|builder|roster|current|definition|truanc|letter|staff_|_staff|meal|cafeteria|lunch|bus|transport|route|librar|book|health|nurse|medic|immuni|allerg|dental|screening|injur|disciplin|incident|detention|behavior|pbis|bully|threat|suicide|title_?ix|safety|counsel|fee|payment|tuition|billing|invoice|donation|store|yearbook|device|chromebook|mdm|test_?score|assessment|activit|athletic|sport|club|college|scholar|award|honor|survey|login|audit|message|communicat|calendar|bell|menu|inventory|room|facilit|key|badge|locker|parking|permit|volunteer|visitor|drill|work_?order|alumni|graduat|applica|waitlist|lottery|registration|transfer|request|catalog|course_?request|plan|intervention|monitoring|iep|504|sped|special|evaluation|medicaid|transition|service|substitute|leave|certification|license|hr_|payroll|budget|purchase|po_|onerost|integration|privacy|sso|account|alias|name_?change|document|retention|access_?matrix|interpreter|language|homeless|foster|summer|childcare|after_?school|field_?trip|permission_?slip|conference|hall_?pass|gradebook|standard|report_?card|comment|crdc|state_?report|count_?day|cte|career|dual|work_?based|community_?service|four_?year|eligib/;

// Lists that hold what only some staff may see: kept restricted.
const RESTRICTED = /special_?needs|conduct|medical_?protocol|health|nurse|medic|immuni|allerg|care_?plan|dental|injur|concuss|screening|special_?(ed|program)|iep|504|sped|evaluation|medicaid|transition|service_?log|disciplin|incident|detention|behavior|bully|threat|suicide|title_?ix|safety_?plan|counsel|custody|subpoena|legal|ferpa|release_of_information|homeless|foster|mtss|intervention|progress_?monitor|staff_?hr|hr_?records|certification|background|leave|payroll|truanc|court|name_?change|alias/;

const STUDENT_KEYS = ["studentnumber", "studentid", "stunumber", "studentno", "permid", "localstudentid", "studentidnumber", "stuid", "studentnum", "pupilnumber"];

// The column holding the student number, if the list has one.
function studentColumn(header) {
  for (const key of STUDENT_KEYS) {
    const hit = header.find((h) => bare(h) === key);
    if (hit) return hit;
  }
  return null;
}

// How a list's name reads to a person: "Library checkouts 2019-2026".
function labelOf(fileName) {
  const words = baseName(fileName)
    .replace(/(19|20)(\d{2})_(\d{2,4})(?=_|$)/g, "$1$2-$3")
    .replace(/_/g, " ")
    .trim();
  return words ? words[0].toUpperCase() + words.slice(1) : "Other list";
}

// The columns alone, for a list whose name says nothing: only clear matches count.
function fromColumns(header) {
  const cols = new Set(header.map(bare));
  const has = (...names) => names.some((n) => cols.has(n));
  const entity = ps.detectEntity(header);
  if (entity === "students") return has(...STUDENT_KEYS) && has("firstname") && has("lastname") && has("dob", "dateofbirth", "birthdate", "gradelevel", "grade") ? "students" : null;
  return entity;
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
    // The columns must agree: a list named "students" without student numbers isn't one.
    const need = { students: () => Boolean(studentColumn(header)), guardians: () => Boolean(studentColumn(header)), grades: () => Boolean(studentColumn(header)), attendance: () => Boolean(studentColumn(header)), enrollments: () => Boolean(studentColumn(header)), student_gpas: () => Boolean(studentColumn(header)) }[entity];
    if (need && !need()) return other("name, but not its columns");
    return { entity, label: ps.ENTITIES[entity] ? ps.ENTITIES[entity].label : entity, restricted: false, studentColumn: studentColumn(header), by: "name" };
  }
  if (OTHER_TOPIC.test(name)) return other("name");
  const entity = fromColumns(header);
  if (entity) return { entity, label: ps.ENTITIES[entity] ? ps.ENTITIES[entity].label : entity, restricted: false, studentColumn: studentColumn(header), by: "columns" };
  return other("nothing matched");
}

module.exports = { recognize, baseName, labelOf, studentColumn, RESTRICTED, STUDENT_KEYS };
