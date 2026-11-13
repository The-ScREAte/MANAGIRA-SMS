"use strict";
// PowerSchool exports, read into Managira's standard import format (utils/dataMigration.js).
// Each kind of file ("entity") has the fields Managira takes, the column names PowerSchool and
// most other systems use for them, and words that hint at a match. A new source system gets a
// file like this one.

const norm = (value) => String(value || "").toLowerCase().replace(/[^a-z0-9]/g, "");
// A column as PowerSchool's exports name it, without its table: "[Students]Student_Number",
// "[01]Student_Number" and "Students.Student_Number" are all "Student_Number".
const bare = (column) => norm(String(column || "").trim().replace(/^\[[^\]]*\]\s*/, "").replace(/^[A-Za-z]+\./, ""));

// Field: [label, exact names (normalized), hint words]. A * label is required.
const GPA_WEIGHTED = ["weightedgpa", "gpaweighted", "cumulativeweightedgpa", "weightedcumulativegpa", "cumgpaweighted", "gpaw"];
const GPA_UNWEIGHTED = ["unweightedgpa", "gpaunweighted", "cumulativeunweightedgpa", "unweightedcumulativegpa", "cumgpaunweighted", "simplegpa", "gpau"];
const GPA_PLAIN = ["gpa", "cumulativegpa", "cumgpa", "currentgpa", "overallgpa"];
const ENTITIES = {
  students: {
    label: "Students",
    fields: {
      source_id: ["Student number *", ["studentnumber", "stunumber", "studentno", "studentid", "localid", "sisid"], ["number"]],
      first_name: ["First name *", ["firstname", "first", "fname", "givenname", "legalfirstname"], ["first"]],
      last_name: ["Last name *", ["lastname", "last", "lname", "surname", "familyname", "legallastname"], ["last", "surname"]],
      middle_name: ["Middle name", ["middlename", "middle"], ["middle"]],
      date_of_birth: ["Date of birth", ["dob", "birthdate", "dateofbirth", "birthday"], ["birth"]],
      gender: ["Gender", ["gender", "sex"], []],
      class_name: ["Class or grade level", ["gradelevel", "grade", "homeroom", "class", "classname"], ["grade", "homeroom"]],
      email: ["Student email", ["email", "studentemail", "emailaddr", "emailaddress"], ["email"]],
      address: ["Street", ["street", "address", "mailingstreet", "homeaddress", "streetaddress"], ["street", "address"]],
      city: ["City", ["city", "mailingcity"], ["city"]],
      state: ["State", ["state", "mailingstate"], []],
      zip: ["ZIP code", ["zip", "zipcode", "postalcode", "mailingzip"], ["zip", "postal"]],
      phone: ["Home phone", ["homephone", "phone"], []],
      enroll_status: ["Enrollment status", ["enrollstatus", "enrollmentstatus", "status"], ["enroll"]],
      graduation_year: ["Graduation year", ["graduationyear", "gradyear", "classof", "yearofgraduation", "expectedgraduationyear", "graduationyr", "cohortyear"], []],
      guardian1_name: ["Parent 1 name", ["mother", "mothername", "guardian", "guardianname", "parent1", "parent1name"], ["mother"]],
      guardian1_email: ["Parent 1 email", ["guardianemail", "motheremail", "parentemail", "parent1email"], []],
      guardian1_phone: ["Parent 1 phone", ["motherhomephone", "mothercell", "motherdayphone", "guardianphone", "parent1phone", "mothercellphone"], []],
      guardian2_name: ["Parent 2 name", ["father", "fathername", "parent2", "parent2name"], ["father"]],
      guardian2_email: ["Parent 2 email", ["fatheremail", "parent2email"], []],
      guardian2_phone: ["Parent 2 phone", ["fatherhomephone", "fathercell", "fatherdayphone", "parent2phone", "fathercellphone"], []],
      gpa_weighted: ["Weighted GPA", GPA_WEIGHTED, []],
      gpa_unweighted: ["Unweighted GPA", GPA_UNWEIGHTED, []],
      gpa_value: ["GPA (as exported)", GPA_PLAIN, []],
    },
  },
  // Each student's GPA as PowerSchool worked it out, when it comes in a file of its own.
  student_gpas: {
    label: "GPA",
    fields: {
      student_source_id: ["Student number *", ["studentnumber", "studentid", "stunumber"], ["student"]],
      gpa_weighted: ["Weighted GPA", GPA_WEIGHTED, ["weighted"]],
      gpa_unweighted: ["Unweighted GPA", GPA_UNWEIGHTED, ["unweighted"]],
      gpa_value: ["GPA (as exported)", GPA_PLAIN, ["gpa"]],
      as_of: ["As of", ["asof", "asofdate", "term", "storecode", "schoolyear"], []],
    },
  },
  guardians: {
    label: "Parents & guardians",
    fields: {
      student_source_id: ["Student number *", ["studentnumber", "studentid", "stunumber"], ["student"]],
      source_id: ["Contact ID", ["contactid", "personid", "guardianid", "parentid"], ["contact"]],
      full_name: ["Full name", ["name", "contactname", "fullname", "guardianname", "parentname"], []],
      first_name: ["First name", ["firstname", "contactfirstname", "first"], ["first"]],
      last_name: ["Last name", ["lastname", "contactlastname", "last", "surname"], ["last"]],
      email: ["Email", ["email", "emailaddress", "contactemail"], ["email"]],
      phone: ["Phone", ["phone", "homephone", "cellphone", "mobile", "mobilephone", "contactphone"], ["phone", "mobile"]],
      relationship: ["Relationship", ["relationship", "relationshiptype", "relation", "relationtostudent"], ["relation"]],
    },
  },
  staff: {
    label: "Staff",
    fields: {
      source_id: ["Staff number *", ["teachernumber", "staffnumber", "staffid", "teacherid", "employeeid", "usersdcid"], ["teacher", "staff"]],
      first_name: ["First name *", ["firstname", "first"], ["first"]],
      last_name: ["Last name *", ["lastname", "last", "surname"], ["last"]],
      email: ["Email", ["email", "emailaddr", "emailaddress"], ["email"]],
      title: ["Title", ["title", "position", "jobtitle"], ["title", "position"]],
      access_group: ["Role or access group", ["group", "accessgroup", "securitygroup", "role", "rolename", "usergroup", "stafftype", "staffrole"], ["group", "role", "access"]],
      status: ["Active or inactive", ["status", "active", "activestatus", "employmentstatus"], ["active"]],
      schools: ["Schools", ["schoolid", "schools", "schoolids", "homeschoolid", "school", "schoolnumber"], ["school"]],
      phone: ["Phone", ["phone", "homephone", "cellphone"], ["phone"]],
    },
  },
  // A separate list of each member of staff's role or security group (it completes the staff list).
  staff_roles: {
    label: "Staff roles",
    fields: {
      source_id: ["Staff number *", ["teachernumber", "staffnumber", "staffid", "teacherid", "employeeid", "usersdcid"], ["teacher", "staff"]],
      access_group: ["Security group", ["securitygroup", "group", "accessgroup", "usergroup", "rolegroup"], ["group", "access"]],
      role: ["Role", ["role", "rolename", "staffrole"], ["role"]],
      start_date: ["From", ["rolestartdate", "startdate", "datefrom"], []],
      end_date: ["Until", ["roleenddate", "enddate", "dateto"], []],
    },
  },
  // A school's own list of extra details about each student (lockers, house, pathway…): each
  // column becomes one of the school's custom fields, or a detail on the student.
  student_details: {
    label: "More about each student",
    fields: {
      student_source_id: ["Student number *", ["studentnumber", "studentid", "stunumber"], ["student"]],
      student_name: ["The student's name (already on the student)", ["lastfirst", "firstlast", "studentname", "fullname", "name"], []],
    },
  },
  // Every other list: kept read-only, whole (utils/migration/lists.js), never matched column by column.
  other: { label: "Kept read-only", fields: {} },
  // Who teaches each section, as lead or co-teacher, from when to when (PowerSchool's
  // SectionTeacher table).
  section_teachers: {
    label: "Class roles",
    fields: {
      section_source_id: ["Section ID *", ["sectionid", "sectionsdcid", "sectiondcid"], ["section"]],
      teacher_source_id: ["Staff number *", ["teachernumber", "teacherid", "teacher", "staffid", "usersdcid"], ["teacher", "staff"]],
      class_role: ["Class role", ["rolename", "role", "roleid", "teacherrole", "classrole"], ["role"]],
      start_date: ["Start date", ["startdate", "datestart"], ["start"]],
      end_date: ["End date", ["enddate", "dateend"], ["end"]],
    },
  },
  classes: {
    label: "Sections",
    fields: {
      source_id: ["Section ID *", ["sectionid", "sectionsdcid", "sectiondcid", "classid", "id", "dcid"], ["section"]],
      class_name: ["Course name *", ["coursename", "sectionname", "classname", "class", "name"], ["course", "name"]],
      course_number: ["Course number", ["coursenumber", "courseno", "coursecode"], ["course"]],
      section_number: ["Section number", ["sectionnumber", "sectionno"], []],
      grade_level: ["Grade level", ["gradelevel", "gradelevels", "grade", "grades"], ["grade"]],
      teacher_source_id: ["Teacher number", ["teacher", "teachernumber", "teacherid"], ["teacher"]],
      term: ["Term", ["termid", "term", "yearid"], ["term"]],
    },
  },
  // Which students are in which section (PowerSchool's CC table): places each section in the
  // classes its students are in.
  enrollments: {
    label: "Class enrollments",
    fields: {
      student_source_id: ["Student number *", ["studentnumber", "studentid", "stunumber"], ["student"]],
      section_source_id: ["Section ID *", ["sectionid", "sectionsdcid", "sectiondcid"], ["section"]],
      term: ["Term", ["termid", "term"], ["term"]],
      date_enrolled: ["Date enrolled", ["dateenrolled", "entrydate", "startdate"], []],
      date_left: ["Date left", ["dateleft", "exitdate", "enddate"], []],
    },
  },
  grades: {
    label: "Final grades",
    fields: {
      student_source_id: ["Student number *", ["studentnumber", "studentid", "stunumber"], ["student"]],
      course_name: ["Course *", ["coursename", "course", "subject"], ["course"]],
      course_number: ["Course number", ["coursenumber", "courseno", "coursecode"], []],
      grade: ["Grade", ["grade", "lettergrade", "storedgrade"], []],
      percent: ["Percent", ["percent", "percentage", "score"], ["percent"]],
      gpa_points: ["GPA points", ["gpapoints", "gpa", "gradepoints"], ["gpa"]],
      gpa_added_value: ["Honors/AP added value", ["gpaaddedvalue", "addedvalue", "gpaadded", "weightaddedvalue"], ["added"]],
      credits: ["Credits earned", ["earnedcrhrs", "credithours", "credits", "earnedcredits", "creditsearned", "credit"], ["credit"]],
      credits_attempted: ["Credits attempted", ["potentialcrhrs", "creditsattempted", "attemptedcredits", "potentialcredits"], ["attempt", "potential"]],
      term: ["Term", ["storecode", "term", "termname"], []],
      term_id: ["Term ID", ["termid"], []],
      school_year: ["School year", ["schoolyear", "academicyear", "year"], ["year"]],
      grade_level: ["Grade level", ["gradelevel"], []],
      school_name: ["School", ["schoolname", "school"], ["school"]],
    },
  },
  // Either a row per day (a date and a code) or a row of totals per term.
  attendance: {
    label: "Attendance",
    fields: {
      student_source_id: ["Student number *", ["studentnumber", "studentid", "stunumber"], ["student"]],
      date: ["Date", ["attdate", "date", "attendancedate", "day"], ["date"]],
      code: ["Code", ["attendancecode", "attendancecodeid", "code", "presencestatuscd", "status"], ["code", "presence"]],
      present: ["Present", ["present", "ispresent"], []],
      days_present: ["Days present", ["dayspresent", "presentdays", "totalpresent"], []],
      days_absent: ["Days absent", ["daysabsent", "absentdays", "totalabsences", "absences", "totalabsent"], []],
      days_excused: ["Days excused", ["daysexcused", "excuseddays", "excusedabsences", "absencesexcused"], []],
      days_unexcused: ["Days absent, unexcused", ["daysunexcused", "unexcuseddays", "unexcusedabsences", "absencesunexcused"], []],
      days_tardy: ["Days tardy", ["daystardy", "tardydays", "tardies", "totaltardies"], []],
      term: ["Term", ["term", "storecode", "termname"], []],
      term_id: ["Term ID", ["termid", "yearid"], []],
      school_year: ["School year", ["schoolyear", "academicyear"], ["year"]],
    },
  },
};

// What kind of file this is, from its columns (the school can change it).
function detectEntity(header) {
  const cols = new Set(header.map(bare));
  const has = (...names) => names.some((name) => cols.has(name));
  if (has("attdate", "attendancedate", "attendancecode", "attendancecodeid", "presencestatuscd", "dayspresent", "daysabsent", "totalabsences")) return "attendance";
  if (has("storedgrade", "earnedcrhrs", "potentialcrhrs", "gpapoints", "lettergrade") || (has("grade") && has("coursename", "course"))) return "grades";
  if (has("sectionid", "sectionsdcid", "sectiondcid") && has("studentnumber", "studentid", "stunumber", "dateenrolled")) return "enrollments";
  if (has("sectionid", "sectionsdcid", "sectiondcid") && has("teachernumber", "teacherid", "teacher", "usersdcid") && has("rolename", "roleid", "role", "startdate", "enddate") && !has("coursename")) return "section_teachers";
  if (has("relationship", "relationshiptype", "contactid", "relation")) return "guardians";
  if (has("studentnumber", "studentid", "stunumber") && has(...GPA_WEIGHTED, ...GPA_UNWEIGHTED, ...GPA_PLAIN) && !has("firstname", "lastname", "coursename", "grade")) return "student_gpas";
  if (has("sectionid", "sectionnumber", "sectionsdcid") || (has("coursenumber", "coursename") && !has("studentnumber"))) return "classes";
  if (has("teachernumber", "staffid", "staffnumber", "employeeid") && !has("studentnumber", "studentid")) return "staff";
  return "students";
}

// PowerSchool numbers its terms from its year: TermID 3300 is the 2023-2024 year (YearID 33,
// counted from 1990), 3301 its first semester.
function schoolYearOfTermId(value) {
  const text = String(value || "").trim();
  if (!/^-?\d{4}$/.test(text)) return "";
  const yearId = Math.floor(Math.abs(Number(text)) / 100);
  if (yearId < 5 || yearId > 80) return "";
  return `${1990 + yearId}-${1991 + yearId}`;
}

// What an attendance code means: present, tardy (present, and late), excused or absent. Most
// PowerSchool schools keep only the exceptions, so a blank code is present. null: unknown.
function attendanceKind(code, present) {
  const flag = String(present == null ? "" : present).trim();
  if (flag) return /^(1|y|yes|true|t|p|present)$/i.test(flag) ? "present" : "absent";
  const c = String(code == null ? "" : code).trim().toLowerCase();
  if (!c || /^(p|pr|pres|present|0)$/.test(c)) return "present";
  if (/^(t|tu|te|tx|tardy|late|l)$/.test(c)) return "tardy";
  if (/^(e|ex|exc|ae|ea|ax|excused)$/.test(c)) return "excused";
  if (/^(a|ab|abs|absent|u|ua|au|unx|unexcused)$/.test(c)) return "absent";
  return null;
}

// Sensitive columns, from their name and their values.
const SENSITIVE = [
  ["custody", /custody|court|restrain|nocontact|donotrelease|protectiveorder|pickuprestrict|notallowed|legalorder/],
  ["ssn", /socialsecurity|ssnumber|socsec/],
  ["sped", /iep|504|sped|specialed|specialeducation|disabilit|accommodat/],
  ["medical", /medical|medication|allerg|health|diagnos|immuniz|condition|doctor|physician|nurse/],
  ["discipline", /disciplin|incident|suspen|expul|infraction|referral|behavio/],
  ["secret", /combination|password|passcode|pincode|^pin$/],
  ["demographics", /^race|ethnic|hispanic|latino|tribal|nativeamerican/],
  ["programs", /englishlearner|^ell$|^lep$|limitedenglish|gifted|homeless|foster|migrant|meal|^frl$|freereduced|lunchstatus|economicallydisadv|military/],
];
// A column's words, from its name: "Class_Name" → class, name; "SSN" → ssn.
const words = (column) => String(column || "").replace(/([a-z])([A-Z])/g, "$1 $2").toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);
function sensitiveOf(column, samples) {
  const name = norm(column);
  if (words(column).includes("ssn")) return "ssn";
  for (const [kind, rule] of SENSITIVE) if (rule.test(name)) return kind;
  const values = samples.filter(Boolean);
  if (values.length && values.filter((v) => /^\d{3}-?\d{2}-?\d{4}$/.test(String(v).trim())).length >= Math.ceil(values.length / 2)) return "ssn";
  return null;
}

// Where a column goes: a Managira field, one of the school's own student fields
// ("custom:<id>"), or nowhere. Confident: its name is a known name for that field. Unsure: it
// only looks like one.
function matchColumn(entity, column, customFields = [], taken = new Set()) {
  const fields = (ENTITIES[entity] || ENTITIES.students).fields;
  const key = bare(column);
  for (const [target, [, exact]] of Object.entries(fields)) {
    if (!taken.has(target) && exact.includes(key)) return { target, confidence: "confident" };
  }
  if (entity === "students") {
    for (const field of customFields) {
      const label = norm(field.label);
      if (label && label === key) return { target: `custom:${field.field_id}`, confidence: "confident" };
    }
    for (const field of customFields) {
      const label = norm(field.label);
      if (label.length >= 4 && (key.includes(label) || label.includes(key))) return { target: `custom:${field.field_id}`, confidence: "unsure" };
    }
  }
  for (const [target, [, , hints]] of Object.entries(fields)) {
    if (!taken.has(target) && hints.some((hint) => hint.length >= 4 && key.includes(hint))) return { target, confidence: "unsure" };
  }
  return { target: null, confidence: "none" };
}

const targetLabel = (entity, target, customFields = []) => {
  if (!target) return "";
  if (target.startsWith("custom:")) {
    const field = customFields.find((f) => `custom:${f.field_id}` === target);
    return field ? `${field.label} (your field)` : "Your field";
  }
  const def = (ENTITIES[entity] || {}).fields || {};
  return def[target] ? def[target][0].replace(" *", "") : target;
};
const requiredOf = (entity) => Object.entries(ENTITIES[entity].fields).filter(([, [label]]) => label.endsWith("*")).map(([key]) => key);

module.exports = { ENTITIES, detectEntity, matchColumn, sensitiveOf, targetLabel, requiredOf, norm, bare, schoolYearOfTermId, attendanceKind };
