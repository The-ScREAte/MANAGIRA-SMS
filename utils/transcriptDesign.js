"use strict";

// Transcript designs: the school chooses one in Report Settings (organizations.transcript_design,
// database/migrations/2026-12-10_transcript_design.sql). Standard is the original page and stays
// the default; each design is a partial in views/print/transcriptDesigns/ drawn from the same data.
// A transcript can be opened in another design with ?design= (the emailed, official copy always
// uses the school's choice).

const DESIGNS = [
  { key: "standard", name: "Standard", description: "The original Managira transcript." },
  { key: "classic", name: "Classic", description: "A traditional registrar's record: serif type, the school's crest, years side by side, seal and signature." },
  { key: "modern", name: "Modern", description: "A band in the school's colour, a summary with GPA at a glance, and each term in its own card." },
  { key: "compact", name: "Compact", description: "Everything on as few pages as possible: terms in a neat grid, small clear type." },
  { key: "registrar", name: "Registrar", description: "A college registrar's record: terms in two columns, each course's credits and quality points, term and cumulative totals, and transcript statistics." },
];
const KEYS = new Set(DESIGNS.map((d) => d.key));
const DEFAULT = "standard";

const valid = (key) => (KEYS.has(String(key || "")) ? String(key) : null);
// The design to draw: the one asked for (a preview), else the school's, else Standard.
const pick = (asked, saved) => valid(asked) || valid(saved) || DEFAULT;

async function designFor(db, organizationId) {
  try {
    const { rows } = await db.query("SELECT transcript_design FROM organizations WHERE organization_id = $1", [Number(organizationId)]);
    return valid(rows[0] && rows[0].transcript_design) || DEFAULT;
  } catch (error) {
    if (error && error.code === "42703") return DEFAULT; // the migration hasn't run here yet
    throw error;
  }
}

async function saveDesign(db, organizationId, key) {
  const design = valid(key);
  if (!design) throw Object.assign(new Error("Choose one of the transcript designs."), { status: 400 });
  try {
    await db.query("UPDATE organizations SET transcript_design = $2 WHERE organization_id = $1 AND transcript_design IS DISTINCT FROM $2", [Number(organizationId), design]);
  } catch (error) {
    if (error && error.code === "42703") throw Object.assign(new Error("Transcript designs are still being set up. Try again shortly."), { status: 503 });
    throw error;
  }
  return design;
}

// A made-up student for previews in Report Settings: no real record is shown there. With
// `credits`, its courses carry credits (half a credit a semester; a full one for English and math),
// the way a school with course credits sees its transcripts.
function sampleData(organization = {}, { credits = false } = {}) {
  // Dates as the database gives them: local midnight (a date string would be read as UTC by some designs).
  const day = (text) => { const [y, m, d] = text.split("-").map(Number); return new Date(y, m - 1, d); };
  const term = (year, name, start, end, rows) => rows.map(([subject, pct, grade], i) => ({
    year_label: year, term_name: name, start_date: day(start), end_date: day(end), subject_id: 9000 + i,
    subject_name: subject, total_percentage: pct, grade,
  }));
  const scores = [
    ...term("2024 - 2025", "Fall Semester", "2024-08-19", "2024-12-20", [["English Language Arts", 91, "A"], ["Algebra I", 86, "B+"], ["Biology", 89, "B+"], ["World History", 94, "A"], ["Spanish I", 82, "B−"], ["Art", 97, "A"]]),
    ...term("2024 - 2025", "Spring Semester", "2025-01-06", "2025-05-30", [["English Language Arts", 93, "A"], ["Algebra I", 88, "B+"], ["Biology", 92, "A−"], ["World History", 90, "A−"], ["Spanish I", 85, "B"], ["Physical Education", 98, "A"]]),
    ...term("2025 - 2026", "Fall Semester", "2025-08-18", "2025-12-19", [["English Language Arts II", 90, "A−"], ["Geometry", 84, "B"], ["Chemistry", 87, "B+"], ["U.S. History", 95, "A"], ["Spanish II", 88, "B+"], ["Music", 96, "A"]]),
  ];
  const gpa = require("./gpa");
  // Each subject's level and credits, as Report Settings would hold them.
  const info = new Map(scores.map((r) => [r.subject_id, {
    level: /History|English/.test(r.subject_name) ? "honors" : null,
    credits: credits ? (/English|Algebra|Geometry/.test(r.subject_name) ? 1 : 0.5) : null,
  }]));
  return {
    organization: {
      organization_name: organization.organization_name || "Your School",
      organization_address: organization.organization_address || "100 Main Street",
      organization_province: organization.organization_province || "Springfield, IL",
      organization_country: organization.organization_country || "United States",
      organization_phone: organization.organization_phone || "(555) 010-2000",
      email: organization.email || "registrar@school.example",
      logo: organization.logo || "",
      logo_path: organization.logo_path || "",
    },
    student: {
      student_id: 0, first_name: "Jordan", last_name: "Sample", date_of_birth: new Date(2010, 3, 12), gender: "Female",
      hometown: "Springfield", class_name: "Grade 10", graduation_year_group: "Class of 2028", custom_student_id: "S-104233",
    },
    scores,
    history: [],
    historyTotals: null,
    sourceGpa: null,
    // Worked out exactly as a real transcript is (utils/gpa.js transcriptFromRows).
    gpaSummary: gpa.transcriptFromRows(scores, { info, usesCredits: Boolean(credits), settings: gpa.DEFAULT_SETTINGS }),
  };
}

module.exports = { DESIGNS, DEFAULT, valid, pick, designFor, saveDesign, sampleData };
