// People and records (utils/miraRead/people.js on the main app): one search across the school,
// a student's and a staff member's full profile, a class's staff, a family, and which families
// have accepted the parent portal invitation. Each answers only what the person's own pages
// show them (teachers: their own classes; drivers: none of this).
//
// Every query() names its keys: a model's extra arguments never reach the main app, and the
// identity fields (userId, userRole, accountType, userEmail) are only ever the caller's own.
const { readTool } = require("./_factory");

const id = (value) => (Number.isInteger(Number(value)) && Number(value) > 0 ? Number(value) : null);
const TYPES = ["students", "guardians", "staff", "classes", "subjects", "forms", "events", "announcements", "documents", "buses", "routes", "bills"];

module.exports = {
  areas: {
    people_profiles: {
      label: "People and records: one search across the whole school (students, parents, staff, classes, subjects, forms, events, announcements, documents, buses, routes, bills), a student's or staff member's full profile, who teaches a class, a family's details, and which parents haven't accepted the portal invitation",
      keywords: /\b(profiles?|everything about|tell me about|all about|teach(es|ing)?|teaching load|main teacher|homeroom|assistant teachers?|subject teachers?|famil(y|ies)|siblings?|invit\w*|signed (in|up)|set (a|their) password|portal|accepted|pickup|emergency contacts?)\b/,
    },
  },
  tools: [
    readTool({
      name: "search_records",
      description:
        "One search across the school by name or words: students, parents/guardians, staff, classes, subjects, forms (Custom editor), events, announcements, Docs & Sheets, buses, routes and PayGira bills. " +
        "Use it when you don't know what kind of record a name is, or to find several kinds at once; then open the record with the matching get_ tool. " +
        "Each kind is searched only if the person can open its page (teachers: their own classes' students, parents, classes and subjects); kinds they can't open are listed in not_searched with the permission needed. " +
        "Returns rows { type, id, name, context } and totals per type over everything that matched (not just the rows shown).",
      parameters: {
        type: "object",
        properties: {
          query: { type: "string", description: "The name or words to look for (at least 2 characters), e.g. \"Diaz\", \"Grade 6\", \"field trip\"." },
          types: { type: "array", items: { type: "string", enum: TYPES }, description: "Optional - only these kinds of record. Omit to search every kind." },
          limit: { type: "integer", description: "Optional - rows to show per kind (default 8, at most 50). Totals always count every match." },
        },
        required: ["query"],
      },
      query: (a) => ({ query: a.query, types: Array.isArray(a.types) ? a.types : a.types ? String(a.types) : null, limit: id(a.limit) }),
      access: { open: true },
      areas: ["people_profiles", "students", "employees", "structure"],
      coverage: "people.search",
    }),
    readTool({
      name: "get_student_profile",
      description:
        "Everything about one student in one call, as their student page shows it to this person: basics and class (main and assistant teachers), birthday, parents/guardians, " +
        "this term's attendance (and lunch), this term's grades per subject, PayGira fee balance and bills, bus/transport, the files on their record, and forms still to fill in. " +
        "Sections the person can't see are left out and listed in hidden_sections with what's needed. Teachers only reach students of their own classes. " +
        "Prefer this over several separate lookups when asked about a student in general.",
      parameters: {
        type: "object",
        properties: {
          student: { type: "string", description: "The student's name (or school student ID), e.g. \"Bodhi Diaz\"." },
          studentId: { type: "integer", description: "The student's id, when known (e.g. from search_records or a previous answer)." },
        },
      },
      query: (a) => ({ student: a.student, studentId: id(a.studentId) }),
      access: { anyOf: ["manage_students"] },
      areas: ["people_profiles", "students"],
      coverage: "people.student_profile",
    }),
    readTool({
      name: "get_staff_profile",
      description:
        "One member of staff, as their person card shows them to this person: name, role, email, the classes they teach (main teacher, assistant teacher or subject teacher) and the subjects they teach, and their About me. " +
        "In full (phone, on hold, every class) with Manage Employees or for yourself (person \"me\"); otherwise only a colleague who shares one of your classes, with just the classes you share.",
      parameters: {
        type: "object",
        properties: {
          person: { type: "string", description: "The person's name or email, or \"me\" for the person asking." },
          staffId: { type: "integer", description: "The member of staff's id, when known." },
        },
      },
      query: (a) => ({ person: a.person, staffId: id(a.staffId) }),
      access: { open: true },
      areas: ["people_profiles", "employees"],
      coverage: "people.staff_profile",
    }),
    readTool({
      name: "get_class_staff",
      description:
        "Who teaches a class: its main teacher (or that nobody is in charge), assistant teachers and subject teachers with the subjects they teach, and each one's other classes (teaching load). " +
        "\"Grade 6\" means every Grade 6 class; \"6A\" one section. Teachers see only their own classes, and only the other classes they share with each colleague.",
      parameters: {
        type: "object",
        properties: {
          class: { type: "string", description: "The class or grade in the person's words, e.g. \"Grade 6\", \"6A\", \"Grade 6 - Room 2\"." },
          classId: { type: "integer", description: "The class's id, when known." },
        },
      },
      query: (a) => ({ class: a.class || a.className, classId: id(a.classId) }),
      access: { open: true },
      areas: ["people_profiles", "structure", "employees"],
      coverage: "people.class_staff",
    }),
    readTool({
      name: "get_family",
      description:
        "A family: the parents/guardians of a student (or one parent by name), each with phone and email, their children, whether they've accepted the parent portal invitation, " +
        "and the details the school keeps on them (emergency & pickup and other contact sections). Manage Guardians sees everything; See Contacts the Mailroom's contacts; " +
        "a teacher or supervisor only parents of their classes' students, without the address, and only the contact sections the school shares with teachers. Text the family or staff typed is under untrusted.",
      parameters: {
        type: "object",
        properties: {
          student: { type: "string", description: "A child's name: returns that child's parents and guardians." },
          studentId: { type: "integer", description: "A child's id." },
          guardian: { type: "string", description: "A parent's or guardian's name or email." },
          guardianId: { type: "integer", description: "A parent's id (from search_records or a previous answer)." },
        },
      },
      query: (a) => ({ student: a.student, studentId: id(a.studentId), guardian: a.guardian, guardianId: id(a.guardianId) }),
      access: { open: true },
      areas: ["people_profiles", "students"],
      coverage: "people.family",
    }),
    readTool({
      name: "list_family_invitations",
      description:
        "Which parents have and haven't accepted the parent portal invitation (set their password or signed in), for a class, a grade or the whole school, with totals per status " +
        "(no login, setup pending, active) and how many students have no parent who has accepted. Same rule as Parents & guardians. Teachers see only their own classes.",
      parameters: {
        type: "object",
        properties: {
          classes: { type: "string", description: "Class or grade in the person's words, e.g. \"Grade 6\", \"6A\". Omit for every class the person can see." },
          status: { type: "string", enum: ["not_accepted", "accepted", "all"], description: "Which parents to list: not_accepted (default), accepted, or all. Totals always cover every status." },
        },
      },
      query: (a) => ({ classes: a.classes || a.className, status: ["not_accepted", "accepted", "all"].includes(a.status) ? a.status : null }),
      access: { open: true },
      areas: ["people_profiles", "students"],
      coverage: "people.family_invitations",
    }),
  ],
};
