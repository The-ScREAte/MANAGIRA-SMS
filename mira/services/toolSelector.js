// Picks which tools to offer the model on a turn. Sending all ~160 tool
// schemas every turn costs ~27k prompt tokens, is slow, and makes the model
// worse at choosing - so each turn gets a small core set plus the areas the
// conversation is actually about. Areas used recently in the chat stay
// loaded, so a short follow-up ("yes", "the first one") keeps the tools it
// needs. The model can always ask for another area with load_tools.

const CORE_TOOLS = ["work_out_date", "search_records", "whats_new", "search_help_guides", "get_help_guide", "find_student", "list_students", "get_class", "get_term", "list_school_years", "list_projects", "report_builder_catalog", "run_report"];

// name -> { label (shown to the model), keywords (matched against the
// conversation), tools }
const AREAS = {
  forms: {
    label: "Forms & requests: forms, permission slips, consent and sign-ups asked of parents or students, who hasn't completed them, and reminders",
    keywords: /\b(tasks?|requests?|requested|forms?|permission slips?|slips?|consent|sign[- ]?ups?|to[- ]?dos?|outstanding|pending|not (?:yet )?(?:completed|complete|submitted|filled|signed|done)|incomplete|haven'?t (?:completed|filled|signed|submitted|returned)|hasn'?t (?:completed|filled|signed|submitted|returned)|overdue|remind\w*|fill(?:ed)? in|returned)\b/,
    tools: ["get_form_requests", "remind_form_outstanding"],
  },
  report_builder: {
    label: "Report Builder: any list or count (students, attendance, fees, scores, staff, parents, messages, activity), saved reports, sharing, email schedules, Excel/CSV/Word exports, Managira templates (.mgrt)",
    keywords: /\b(report builder|custom reports?|saved reports?|my reports|reports?(?! cards?)|lists?|roster|how many|count|total|export\w*|excel|xlsx|csv|spreadsheet|word (document|file|doc)|docx|download|templates?|mgrt|columns?|filters?|(schedul\w*|shar\w*|email\w*|star\w*|favou?rit\w*) (a |the |this |that |my )?(saved )?report)\b/,
    tools: [
      "report_builder_catalog", "run_report", "list_saved_reports", "save_report", "delete_saved_report", "share_saved_report",
      "schedule_saved_report", "favorite_saved_report", "export_report", "import_report_template",
    ],
  },
  students: {
    label: "Students, guardians, fees, attendance (including who is below an attendance level), birthdays, archived students",
    keywords: /\b(students?|pupils?|learners?|child(ren)?|kids?|guardians?|parents?|contacts?|fees?|paid|payments?|owe|owing|balance|attendance|absent|absences|present|late|birthdays?|archiv\w*|duplicates?)\b/,
    tools: [
      "find_student", "list_students", "check_student_duplicates", "create_students", "get_fees", "get_attendance", "find_low_attendance",
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
    label: "Tests/assessments, online question sets, grading attempts, posting scores, showing work to parents",
    keywords: /\b(homework|parent portal|tests?|exams?|assessments?|quiz\w*|questions?|scores?|marks?|weights?|lock\w*|unlock\w*|attempts?|online|grad(e|ing) (the )?attempts?|post(ed)? scores?)\b/,
    tools: [
      "show_work_to_parents",
      "list_assessments", "create_test", "modify_test", "delete_test", "set_test_status", "set_test_date_window",
      "list_question_sets", "set_test_questions", "delete_question_set", "review_question_set", "reuse_question_set",
      "list_question_set_students", "post_question_set_scores", "unpost_question_set_scores", "set_student_assessment_status",
      "get_attempt_for_grading", "save_attempt_grade",
    ],
  },
  reports: {
    label: "Report cards (download, post to parent portal, send to guardians), merit sheets, report settings, grading scale, remarks",
    keywords: /\b(reports?|report cards?|merit|rank\w*|positions?|top( \d+)?|best|highest|first in|pdf|print\w*|grading|grade bands?|grades\b(?!\s*\d)|remarks?|comments?|signatures?|signed|results?|terminal|transcripts?|download|post(ed|ing)?|publish\w*)\b/,
    tools: [
      "generate_report_pdf", "post_or_send_report_cards", "get_merit_sheet", "generate_merit_sheet_pdf", "generate_report_card_summary",
      "get_report_settings", "set_report_card_display_options", "set_grading_scale_band", "delete_grading_scale_band",
      "list_remarks", "add_remark", "delete_remark", "list_student_remarks", "set_student_remarks", "list_report_signatures", "apply_report_signature",
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
    label: "Transportation (buses, drivers, routes, stops, schedules, student transport, who's riding or boarded today)",
    keywords: /\b(bus(es)?|transport\w*|drivers?|routes?|stops?|pick ?ups?|drop ?offs?|rides?|riding|boarded|boarding|not coming|vehicles?)\b/,
    tools: [
      "get_bus_riding_today",
      "list_transport_buses", "list_transport_drivers", "list_transport_routes", "list_transport_stops", "list_transport_schedules",
      "get_student_transportation", "get_transportation_live_status", "create_transport_bus", "set_transport_bus_status",
      "delete_transport_bus", "create_transport_route", "set_transport_route_status", "delete_transport_route", "create_transport_stop",
      "delete_transport_stop", "create_transport_driver", "set_transport_driver_status", "delete_transport_driver",
      "create_transport_schedule", "set_transport_schedule_status", "delete_transport_schedule", "assign_student_transportation",
      "remove_student_transportation",
    ],
  },
  communication: {
    label: "Messages to guardians (Mailroom: email/text/WhatsApp, and a draft for each family to review), events, class activities, the calendar, announcements, failed emails, notification preferences",
    keywords: /\b(activit(y|ies)|field trips?|clubs?|events?|announce\w*|notices?|messages?|emails?|notify|notifications?|send|famil(y|ies)|write to|reach out|calendars?|agenda|schedule|sync|synced|outlook|holidays?|bounced?|failed|draft|mailroom|text|sms|whatsapp|remind\w*)\b/,
    tools: [
      "get_my_calendar", "get_calendar_sync_status", "list_activities", "create_activity", "list_events", "create_event", "update_event", "delete_event", "list_school_announcements", "create_school_announcement",
      "update_school_announcement", "delete_school_announcement", "create_announcement", "draft_message", "draft_family_messages", "list_failed_emails",
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
    label: "School settings (profile, logo, font, display, nickname, student IDs, integrations status, single sign-on status, feedback)",
    keywords: /\b(sso|saml|single sign|sign[- ]?on|okta|entra|openid|oidc|settings?|integrations?|font|logo|profile|nickname|display|name format|student ids?|customi[sz]\w*|feedback|bugs?|suggest\w*|whatsapp|sms|google classroom|portal)\b/,
    tools: [
      "get_sso_status", "get_integrations_status", "get_school_customization", "update_school_profile", "set_school_font", "set_display_preferences",
      "set_school_nickname", "set_student_id_settings", "submit_feedback",
    ],
  },
};

// Read tools (tools/read/) bring their own areas and say which areas they belong to.
{
  const read = require("../tools/read");
  Object.entries(read.areas).forEach(([key, area]) => {
    if (AREAS[key]) throw new Error(`area ${key} already exists`);
    AREAS[key] = { label: area.label, keywords: area.keywords, tools: [] };
  });
  read.tools.forEach((tool) => tool.areas.forEach((key) => {
    if (!AREAS[key]) throw new Error(`${tool.name}: no area ${key}`);
    if (!AREAS[key].tools.includes(tool.name)) AREAS[key].tools.push(tool.name);
  }));
}

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

  if (!areas.size && !SMALL_TALK.test(stripAttachments(userText))) DEFAULT_AREAS.forEach((area) => areas.add(area));
  return areas;
}

function toolNamesForAreas(areas) {
  const names = new Set(CORE_TOOLS);
  areas.forEach((area) => (AREAS[area]?.tools || []).forEach((tool) => names.add(tool)));
  return names;
}

// Narrows the full schema list to the chosen areas, always keeping
// load_tools so the model can reach anything else.
// `allowed(name)` (the person's own permissions, services/access.js) drops
// tools they can't use, so Mira is never offered them.
// Light per message: a question gets only the read tools of its areas; tools that change
// something come only when the person asks for an action (or loads an area with load_tools).
// The model can always load more with load_tools.
function selectToolSchemas(allSchemas, areas, allowed = () => true, { writes = true, writeAreas = null } = {}) {
  const names = toolNamesForAreas(areas);
  const writeNames = writeAreas ? toolNamesForAreas(writeAreas) : null;
  const { LEVELS } = require("./levels");
  const offered = (name) => writes || !((LEVELS[name] || 0) >= 1) || (writeNames && writeNames.has(name));
  return [...allSchemas.filter((schema) => names.has(schema.name) && allowed(schema.name) && offered(schema.name)), LOAD_TOOLS_SCHEMA];
}

// Whether the person asks Mira to change something. A word counts as a request only where it's
// used as one: starting a sentence ("Send report cards..."), after a request ("can you add...",
// "I need to email..."), or as a verb followed by what it acts on ("remind them", "post a notice").
// "Their invite" or "parent messages" are things, not requests. The model can still load_tools.
const ACTION_VERBS = "add|create|make|send|resend|email|text|sms|whatsapp|message|notify|remind|post|repost|publish|unpost|share|unshare|schedule|reschedule|book|invite|assign|unassign|enrol|enroll|unenroll|promote|reverse|approve|reject|decline|admit|delete|remove|cancel|close|archive|unarchive|restore|hold|resume|mark|grade|save|upload|import|export|draft|write|fix|lock|unlock|put|place|register|record|reorder|attach|insert|resize|replace|apply|move|rename|update|change|edit|set|turn|enable|disable|link|unlink|reset|merge|retry|open|reopen|graduate|withdraw|transfer|assign|swap|use|pick|choose|go with|make it|change it|move it";
const ACTION_WORD = new RegExp(`\\b(${ACTION_VERBS})\\b`, "gi");
const REQUEST_BEFORE = /(^|\b)(please|pls|kindly|can you|could you|would you|will you|can we|could we|i want to|i'd like to|i would like to|i need to|we need to|need to|help me|let'?s|go ahead and|and then|then|also|and|now|just|quickly|mira,?|ok,?|okay,?|yes,?|so)\s*$/i;
const OBJECT_AFTER = /^(it|them|this|that|these|those|a|an|the|my|our|his|her|their|every|everyone|everybody|all|each|both|him|her|me|us|[A-Z][a-z]+'s)\b/;
function sentenceAsks(sentence) {
  const text = sentence.replace(/^\s*(hey |hi |hello )?mira[,:]?\s*/i, "").trim();
  if (!text) return false;
  ACTION_WORD.lastIndex = 0;
  let match;
  while ((match = ACTION_WORD.exec(text))) {
    const before = text.slice(0, match.index).trim();
    const after = text.slice(match.index + match[0].length).trim();
    if (!before || REQUEST_BEFORE.test(before)) return true;
    if (OBJECT_AFTER.test(after) && !/\b(who|what|which|whose|whom|how many|how much|when|where|did|has|have|had|was|were|is|are)\b[^.?!]*$/i.test(before)) return true;
  }
  return false;
}
// A fresh question ("Who's absent today?") starts something new; anything else in a conversation
// about a change ("yes", "the first one", "oh, midterm is December 2, 4pm") keeps working on it.
const FRESH_QUESTION = /^\s*(who|whom|whose|what|which|how many|how much|where|when|why|is|are|was|were|do|does|did|has|have|can i see|show me|list|tell me)\b/i;
function asksForAction(userText, history = []) {
  const text = stripAttachments(userText);
  if (text.split(/[.?!\n;]+/).some(sentenceAsks)) return true;
  if (FRESH_QUESTION.test(text) && text.trim().length > 40) return false;
  const recentUser = [...history].filter((m) => m.role === "user").slice(-3);
  return recentUser.some((m) => stripAttachments(m.content || "").split(/[.?!\n;]+/).some(sentenceAsks));
}

// Greetings and thanks need no areas at all (the core tools still come).
const SMALL_TALK = /^\s*(hi|hello|hey|hiya|good (morning|afternoon|evening|night)|thanks?|thank you|thx|ok|okay|cool|great|nice|perfect|bye|goodbye|see you)\b[\s!.,?]*(mira)?[\s!.,?]*$/i;

function normalizeRequestedAreas(args) {
  const requested = Array.isArray(args?.areas) ? args.areas : args?.area ? [args.area] : [];
  return requested.map((area) => String(area || "").trim().toLowerCase()).filter((area) => AREAS[area]);
}

// Tools that delete, remove or undo are only offered when the person asked
// for that in this message or the two before it (a "yes" to a delete warning
// still finds the request). A model never reaches for one on its own.
const DESTRUCTIVE_TOOL = /^(delete_|remove_|close_|reverse_|cancel_|unpost_|reject_|unassign_|set_employee_hold$)/;
const DESTRUCTIVE_ASK = /\b(delete\w*|remov\w*|eras\w*|drop|close|closing|revers\w*|undo|cancel\w*|unpost\w*|reject\w*|declin\w*|unassign\w*|take (it |them |him |her )?off|get rid|on hold|hold|suspend\w*|archive\w*)\b/i;

function destructiveAllowed(userText, history) {
  const recentUser = [userText, ...history.filter((m) => m.role === "user").slice(-2).map((m) => m.content)];
  return recentUser.some((text) => DESTRUCTIVE_ASK.test(stripAttachments(text)));
}

function isDestructiveTool(name) {
  return DESTRUCTIVE_TOOL.test(name);
}

// Common requests and the tools that can do them. When the person can use
// none of them, Mira is told before it answers, so it says so at once.
const INTENTS = [
  { test: /\b(send|message|email|e-mail|text|sms|whatsapp|notify|write to|reach out|draft)\b[^.?!]*\b(parents?|guardians?|famil(y|ies)|mothers?|fathers?)\b|\b(parents?|guardians?|famil(y|ies))\b[^.?!]*\b(message|email|text|notify)\b/i, tools: ["send_message", "draft_family_messages", "draft_message"], what: "messaging families" },
  { test: /\b(fees?|owe[sd]?|owing|balance|payments?|paid|bills?|tuition|arrears)\b/i, tools: ["get_fees"], what: "fees and payments" },
  { test: /\b(staff|employees?|teachers?)\b[^.?!]*\b(list|all|emails?|contacts?|phone|who)\b|\b(list|all|who are)\b[^.?!]*\b(staff|employees)\b/i, tools: ["list_employees"], what: "the staff list" },
  { test: /\b(admissions?|applicants?|applications?)\b/i, tools: ["list_pending_admissions"], what: "admissions" },
  { test: /\breport cards?\b|\bmerit sheets?\b/i, tools: ["generate_report_pdf", "post_or_send_report_cards", "get_merit_sheet"], what: "report cards" },
  { test: /\b(add|create|schedule|put|post|make|set up|plan)\b[^.?!]*\b(school )?events?\b/i, tools: ["create_event"], what: "adding school events" },
  { test: /\b(add|create|hire|invite|register|onboard)\s+(?:a |an |the |another |some )?(?:new )?(staff( members?)?|employees?|teachers?|colleagues?)\b/i, tools: ["create_employee"], what: "adding staff" },
];

function blockedIntents(userText, allowed) {
  const text = stripAttachments(userText);
  return INTENTS.filter((intent) => intent.test.test(text) && !intent.tools.some(allowed));
}

module.exports = {
  isDestructiveTool,
  destructiveAllowed,
  blockedIntents,
  AREAS,
  AREA_NAMES,
  CORE_TOOLS,
  LOAD_TOOLS_NAME,
  selectAreas,
  areasMentioned,
  asksForAction,
  selectToolSchemas,
  normalizeRequestedAreas,
  toolNamesForAreas,
};
