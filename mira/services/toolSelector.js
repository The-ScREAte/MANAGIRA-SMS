// Picks which tools to offer the model on a turn. Sending all ~160 tool
// schemas every turn costs ~27k prompt tokens, is slow, and makes the model
// worse at choosing - so each turn gets a small core set plus the areas the
// conversation is actually about. Areas used recently in the chat stay
// loaded, so a short follow-up ("yes", "the first one") keeps the tools it
// needs. The model can always ask for another area with load_tools.

const CORE_TOOLS = ["find_student", "list_students", "get_class", "get_term", "list_school_years", "list_projects"];

// name -> { label (shown to the model), keywords (matched against the
// conversation), tools }
const AREAS = {
  students: {
    label: "Students, guardians, fees, attendance, birthdays, archived students",
    keywords: /\b(students?|pupils?|learners?|child(ren)?|kids?|guardians?|parents?|contacts?|fees?|paid|payments?|owe|owing|balance|attendance|absent|absences|present|late|birthdays?|archiv\w*|duplicates?)\b/,
    tools: [
      "find_student", "list_students", "check_student_duplicates", "create_students", "get_fees", "get_attendance",
      "find_contact", "get_guardian_details", "list_archived_students", "unarchive_students", "get_upcoming_birthdays",
    ],
  },
  admissions: {
    label: "Pending admissions (review, approve, reject applications)",
    keywords: /\b(admissions?|admit|applicants?|applications?|pending|approve|reject)\b/,
    tools: [
      "list_pending_admissions", "get_pending_admission_details", "update_pending_admission", "approve_pending_admission",
      "reject_pending_admission", "check_student_duplicates",
    ],
  },
  assessments: {
    label: "Tests/assessments, online question sets, grading attempts, posting scores",
    keywords: /\b(tests?|exams?|assessments?|quiz\w*|questions?|scores?|marks?|weights?|lock\w*|unlock\w*|attempts?|online|grad(e|ing) (the )?attempts?|post(ed)? scores?)\b/,
    tools: [
      "list_assessments", "create_test", "modify_test", "delete_test", "set_test_status", "set_test_date_window",
      "list_question_sets", "set_test_questions", "delete_question_set", "review_question_set", "reuse_question_set",
      "list_question_set_students", "post_question_set_scores", "unpost_question_set_scores", "set_student_assessment_status",
      "get_attempt_for_grading", "save_attempt_grade",
    ],
  },
  reports: {
    label: "Report cards (download, post to parent portal, send to guardians), merit sheets, report settings, grading scale, remarks",
    keywords: /\b(reports?|report cards?|merit|rank\w*|positions?|pdf|print\w*|grading|grade bands?|grades?|remarks?|results?|terminal|transcripts?|download|post(ed|ing)?|publish\w*)\b/,
    tools: [
      "generate_report_pdf", "post_or_send_report_cards", "get_merit_sheet", "generate_merit_sheet_pdf", "generate_report_card_summary",
      "get_report_settings", "set_report_card_display_options", "set_grading_scale_band", "delete_grading_scale_band",
      "list_remarks", "add_remark", "delete_remark",
    ],
  },
  statistics: {
    label: "Organization statistics, analytics, class comparison",
    keywords: /\b(stat(s|istics)?|analytics?|insights?|performance|averages?|pass rate|compar\w*|trends?|overview|dashboard|best|worst|top|charts?|graphs?|how (is|are) .{1,40} doing|summary)\b/,
    tools: ["get_organization_statistics", "compare_classes"],
  },
  structure: {
    label: "School years, terms, classes, subjects, graduation year groups",
    keywords: /\b(school years?|academic years?|terms?|semesters?|classes|class|subjects?|courses?|graduat\w*|year groups?|reorder|rename)\b/,
    tools: [
      "list_school_years", "create_school_year", "rename_school_year", "delete_school_year", "add_term_to_school_year", "delete_term",
      "create_classes", "rename_class", "delete_class", "reorder_classes", "list_subjects", "create_subject", "assign_subject_to_classes",
      "rename_subject", "delete_subject", "list_graduation_year_groups", "create_graduation_year_group", "rename_graduation_year_group",
      "delete_graduation_year_group", "get_close_group_candidates", "close_graduation_year_group",
    ],
  },
  enrollment: {
    label: "Enrollment rosters and promotions (moving students to the next class/term)",
    keywords: /\b(enrol\w*|rosters?|promot\w*|move (them |students )?up|next class|repeat\w*)\b/,
    tools: [
      "list_enrollments", "get_enrollment_roster", "set_enrollment_roster", "delete_enrollment", "list_promotion_schedules",
      "get_promotion_preview", "schedule_promotion", "apply_scheduled_promotion", "cancel_scheduled_promotion", "reverse_promotion",
      "delete_reversed_promotion", "set_promotion_settings",
    ],
  },
  employees: {
    label: "Employees/staff (list, add, put on hold)",
    keywords: /\b(employees?|staff|teachers?|workers?|hire|on hold|suspend\w*|managers?|supervisors?)\b/,
    tools: ["list_employees", "create_employee", "set_employee_hold"],
  },
  transport: {
    label: "Transportation (buses, drivers, routes, stops, schedules, student transport)",
    keywords: /\b(bus(es)?|transport\w*|drivers?|routes?|stops?|pick ?ups?|drop ?offs?|rides?|vehicles?)\b/,
    tools: [
      "list_transport_buses", "list_transport_drivers", "list_transport_routes", "list_transport_stops", "list_transport_schedules",
      "get_student_transportation", "get_transportation_live_status", "create_transport_bus", "set_transport_bus_status",
      "delete_transport_bus", "create_transport_route", "set_transport_route_status", "delete_transport_route", "create_transport_stop",
      "delete_transport_stop", "create_transport_driver", "set_transport_driver_status", "delete_transport_driver",
      "create_transport_schedule", "set_transport_schedule_status", "delete_transport_schedule", "assign_student_transportation",
      "remove_student_transportation",
    ],
  },
  communication: {
    label: "Messages to guardians (Mailroom: email/text/WhatsApp), events, announcements, failed emails, notification preferences",
    keywords: /\b(events?|announce\w*|notices?|messages?|emails?|notify|notifications?|send|calendar|holidays?|bounced?|failed|draft|mailroom|text|sms|whatsapp|remind\w*)\b/,
    tools: [
      "list_events", "create_event", "update_event", "delete_event", "list_school_announcements", "create_school_announcement",
      "update_school_announcement", "delete_school_announcement", "create_announcement", "draft_message", "list_failed_emails",
      "check_email_availability", "fix_failed_email", "send_message", "list_sent_messages", "get_notification_preferences", "set_notification_preferences",
      "set_organization_notification_preferences",
    ],
  },
  website: {
    label: "Public school website (setup checklist, sections: quick facts, programs & facilities, leadership, testimonials, FAQ, contact form and its messages; gallery, articles, about us, theme, layout, online registration)",
    keywords: /\b(website|web ?site|site|gallery|articles?|blog|about us|homepage|home page|theme|layout|self[- ]?enrol\w*|public page|online registration|programs?|facilities|leadership|testimonials?|faqs?|quick facts|contact form|enquir\w*|inquir\w*)\b/,
    tools: [
      "list_website_gallery_images", "list_website_articles", "get_website_about_us", "get_website_settings", "upload_website_image",
      "update_website_image", "delete_website_image", "create_website_article", "update_website_article", "delete_website_article",
      "update_website_about_us", "set_website_layout", "set_website_theme", "set_website_self_enrollment",
      "update_website_section", "list_website_messages",
    ],
  },
  documents: {
    label: "Docs & Sheets (read, create, edit, share, assign to class)",
    keywords: /\b(docs?|documents?|(?<!merit )sheets?|spreadsheets?|cells?|share\w*|worksheets?|notes?)\b/,
    tools: [
      "list_documents", "get_document", "create_document", "set_document_title", "set_document_text", "set_sheet_cells", "resize_sheet",
      "insert_class_data_into_sheet", "share_document_with_user", "remove_document_share", "assign_document_to_class",
      "unassign_document_from_class", "delete_document",
    ],
  },
  settings: {
    label: "School settings (profile, logo, font, display, nickname, student IDs, integrations status, feedback)",
    keywords: /\b(settings?|integrations?|font|logo|profile|nickname|display|name format|student ids?|customi[sz]\w*|feedback|bugs?|suggest\w*|whatsapp|sms|google classroom|portal)\b/,
    tools: [
      "get_integrations_status", "get_school_customization", "update_school_profile", "set_school_font", "set_display_preferences",
      "set_school_nickname", "set_student_id_settings", "submit_feedback",
    ],
  },
};

const AREA_NAMES = Object.keys(AREAS);
const AREA_BY_TOOL = new Map();
AREA_NAMES.forEach((area) => AREAS[area].tools.forEach((tool) => {
  if (!AREA_BY_TOOL.has(tool)) AREA_BY_TOOL.set(tool, area);
}));

// Used when nothing in the conversation points anywhere specific.
const DEFAULT_AREAS = ["students", "structure"];

const LOAD_TOOLS_NAME = "load_tools";

const LOAD_TOOLS_SCHEMA = {
  name: LOAD_TOOLS_NAME,
  description:
    "You only see the tools for what this conversation is about. If the request needs an area you don't have tools for, call this with that area " +
    "and its tools become available immediately in this same turn. Areas: " +
    AREA_NAMES.map((area) => `${area} = ${AREAS[area].label}`).join("; ") + ".",
  parameters: {
    type: "object",
    properties: {
      areas: { type: "array", items: { type: "string", enum: AREA_NAMES }, description: "One or more areas to load." },
    },
    required: ["areas"],
  },
};

// Attached file contents can mention anything, so they don't steer which
// tools are offered - only what the people in the conversation wrote.
function stripAttachments(text) {
  return String(text || "")
    .split("\n\n---\n\n")
    .filter((block) => !/^\[Attached (file|image): /.test(block))
    .join(" ");
}

function areasMentioned(text) {
  const lower = stripAttachments(text).toLowerCase();
  return AREA_NAMES.filter((area) => AREAS[area].keywords.test(lower));
}

// history: [{ role, content, toolCalls? }] oldest first (as loaded by the
// orchestrator). Returns the set of area names for this turn.
function selectAreas({ userText, history }) {
  const areas = new Set(areasMentioned(userText));

  // Recent turns carry the topic of short follow-ups ("yes", "do it"). The
  // window matches how far back the orchestrator replays tool calls.
  const recent = history.slice(-8);
  recent.forEach((message) => {
    areasMentioned(message.content).forEach((area) => areas.add(area));
    (message.toolCalls || []).forEach((call) => {
      const area = AREA_BY_TOOL.get(call.name);
      if (area) areas.add(area);
    });
  });

  if (!areas.size) DEFAULT_AREAS.forEach((area) => areas.add(area));
  return areas;
}

function toolNamesForAreas(areas) {
  const names = new Set(CORE_TOOLS);
  areas.forEach((area) => (AREAS[area]?.tools || []).forEach((tool) => names.add(tool)));
  return names;
}

// Narrows the full schema list to the chosen areas, always keeping
// load_tools so the model can reach anything else.
function selectToolSchemas(allSchemas, areas) {
  const names = toolNamesForAreas(areas);
  return [...allSchemas.filter((schema) => names.has(schema.name)), LOAD_TOOLS_SCHEMA];
}

function normalizeRequestedAreas(args) {
  const requested = Array.isArray(args?.areas) ? args.areas : args?.area ? [args.area] : [];
  return requested.map((area) => String(area || "").trim().toLowerCase()).filter((area) => AREAS[area]);
}

module.exports = {
  AREAS,
  AREA_NAMES,
  CORE_TOOLS,
  LOAD_TOOLS_NAME,
  selectAreas,
  selectToolSchemas,
  normalizeRequestedAreas,
  toolNamesForAreas,
};
