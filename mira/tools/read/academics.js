// Academic reads (utils/miraRead/academics.js on the main app): gradebook scores, report card
// status, transcripts, GPA, class schedules, lunch and attendance summaries. Each answers with what
// the person's own pages show them; the main app checks the same permission and class limits.
const { readTool } = require("./_factory");

// Only the arguments each tool knows go to the main app (never anything else the model sends).
const pick = (keys) => (args) => Object.fromEntries(keys.map((key) => [key, args[key]]));
const list = (value) => (Array.isArray(value) ? value.join(", ") : value);

const TERM = { type: "string", description: "Term name as the school names it (e.g. \"Fall Semester\", optionally with the school year \"Fall Semester 2026-2027\"). Omit for the current term." };
const CLASSES = { type: "string", description: "Class names or grades as the person said them (\"Grade 6\", \"6A, 7B\", \"Grade 6 - Room 2\"), comma-separated. Omit for every class the person can open." };
const DAY = (what) => ({ type: "string", description: `${what}: YYYY-MM-DD (or a month as YYYY-MM). Work dates out from the calendar you were given, never by hand.` });

module.exports = {
  areas: {
    academics: {
      label: "Grades & records: gradebook scores and missing scores, report cards posted or sent, transcripts, GPA, class schedules (timetables), lunch, attendance totals for a date range (who was absent N days, days nobody marked)",
      keywords: /\b(gpa|grade point|transcripts?|gradebook|grade ?book|missing (scores?|marks?|grades?|work)|not (yet )?(graded|scored|marked)|scores?|marks?|report cards?|posted|unposted|not posted|not sent|timetables?|schedules?|periods?|lunch(es)?|meals?|absent|absences|absentees?|attendance|tard(y|ies)|unmarked|not marked|cumulative|honor roll)\b/,
    },
  },
  tools: [
    readTool({
      name: "get_scores",
      description:
        "Gradebook scores as staff see them for a class (or a student) and term: each student's total per subject (score, out of, percent, grade), how many scores are entered or missing, and scores still waiting for approval. " +
        "With one subject or one student it also lists every assessment's score. status \"missing\" lists only the assessments with no score entered yet (who still needs a score). Teachers see only the classes and subjects they teach. " +
        "Totals are exact over the whole scope.",
      parameters: {
        type: "object",
        properties: {
          class: CLASSES,
          student: { type: "string", description: "A student's name or id. Give this or class." },
          subject: { type: "string", description: "Subject name(s), comma-separated. Omit for every subject the person can open." },
          term: TERM,
          status: { type: "string", enum: ["all", "missing"], description: "all (default) or missing: only assessments with no score entered." },
        },
        required: [],
      },
      query: pick(["class", "student", "subject", "term", "status"]),
      access: { anyOf: ["manage_assessments"] },
      areas: ["assessments", "academics"],
      coverage: "gradebook",
    }),
    readTool({
      name: "get_report_card_status",
      description:
        "For each student of some classes and a term: whether their report card is posted to the parent portal (when, by whom) and whether it was sent to the family (email, WhatsApp or text message), with exact totals. " +
        "status \"not_posted\" or \"not_sent\" lists only those students. Teachers see only their own classes. Send history is kept 3 months.",
      parameters: {
        type: "object",
        properties: {
          classes: CLASSES,
          term: TERM,
          status: { type: "string", enum: ["all", "not_posted", "not_sent"], description: "all (default), not_posted or not_sent." },
        },
        required: [],
      },
      query: (args) => ({ classes: list(args.classes ?? args.class), term: args.term, status: args.status }),
      access: { anyOf: ["reports_terminal"] },
      areas: ["reports", "academics"],
      coverage: "report_cards",
    }),
    readTool({
      name: "get_transcript",
      description:
        "A summary of a student's transcript, as the transcript page works it out: which finished terms it covers, each term's GPA and the cumulative GPA (where the school prints GPA), total credits where the school uses course credits, " +
        "and whether a GPA from the school's previous system is on it. It has no course-by-course grades and no previous-system records: those are only on the transcript page, which asks for the person's password. " +
        "Give the link it returns so they can open the full transcript there.",
      parameters: {
        type: "object",
        properties: { student: { type: "string", description: "The student's name or id." } },
        required: ["student"],
      },
      query: pick(["student"]),
      access: { anyOf: ["generate_transcripts"] },
      areas: ["reports", "academics"],
      coverage: "transcripts",
    }),
    readTool({
      name: "get_gpa",
      description:
        "Each student's GPA for a term (from the gradebook's subject grades) and their cumulative GPA over finished terms (as the transcript prints it), unweighted and weighted, for some classes; " +
        "with the class's average, highest and lowest GPA and how many students fall in each GPA band. Teachers see only classes they lead (GPA covers every subject).",
      parameters: {
        type: "object",
        properties: { classes: CLASSES, term: TERM },
        required: [],
      },
      query: (args) => ({ classes: list(args.classes ?? args.class), term: args.term }),
      access: { anyOf: ["reports_terminal", "generate_transcripts"] },
      areas: ["reports", "statistics", "academics"],
      coverage: "gpa",
    }),
    readTool({
      name: "get_class_schedule",
      description:
        "The class schedule (timetable) for a term as the classroom's Schedule shows it: each period's day, start and end time, subject or label. Ask by class, or by teacher (\"me\" for the person's own: their subjects and every period of a class they lead).",
      parameters: {
        type: "object",
        properties: {
          class: CLASSES,
          teacher: { type: "string", description: "A member of staff's name, or \"me\". Give this or class." },
          term: TERM,
        },
        required: [],
      },
      query: (args) => ({ class: list(args.class ?? args.classes), teacher: args.teacher, term: args.term }),
      access: { open: true },
      areas: ["structure", "academics"],
      coverage: "class_schedule",
    }),
    readTool({
      name: "get_lunch",
      description:
        "Lunch taken with attendance: for some classes (only those that take lunch) each student's days with lunch in a date range and their overall lunch for the term (\"42 of 58 days\"), with each day's class count; or one student's lunch day by day. " +
        "Default range: the current term up to today. Teachers see only the classes they lead.",
      parameters: {
        type: "object",
        properties: {
          classes: CLASSES,
          student: { type: "string", description: "One student's name or id, instead of classes." },
          from: DAY("First day"),
          to: DAY("Last day"),
          term: TERM,
        },
        required: [],
      },
      query: (args) => ({ classes: list(args.classes ?? args.class), student: args.student, from: args.from, to: args.to, term: args.term }),
      access: { anyOf: ["mark_attendance"] },
      areas: ["students", "academics"],
      coverage: "lunch",
    }),
    readTool({
      name: "get_attendance_summary",
      description:
        "Attendance totals for some classes over a date range (default: the current term up to today): each student's days present, absent and not marked, with exact totals. " +
        "min_absences keeps only students absent at least that many days (\"absent more than 3 days in October\": from 2026-10-01, to 2026-10-31, min_absences 4). " +
        "status \"absent\" lists students absent at least once, \"not_marked\" lists the school days on which nobody marked a class. Teachers see only the classes they lead.",
      parameters: {
        type: "object",
        properties: {
          classes: CLASSES,
          from: DAY("First day"),
          to: DAY("Last day"),
          term: TERM,
          min_absences: { type: "number", description: "Only students absent at least this many days (\"more than 3\" = 4)." },
          status: { type: "string", enum: ["all", "absent", "late", "not_marked"], description: "all (default), absent, late, or not_marked (class days nobody marked)." },
        },
        required: [],
      },
      query: (args) => ({ classes: list(args.classes ?? args.class), from: args.from, to: args.to, term: args.term, min_absences: args.min_absences, status: args.status }),
      access: { anyOf: ["mark_attendance"] },
      areas: ["students", "academics"],
      coverage: "attendance",
    }),
  ],
};
