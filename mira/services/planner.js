// Before Mira works on a message it understands it and plans it (feature `mira_steps`):
// one sentence on what the person wants and a few short steps, made by a small, fast model
// call. The person sees them as Mira works; the main model gets them as its plan. A plan never
// carries facts: the tools decide those. Quick replies ("yes", "thanks") need no plan.
//
// The Enhance button (enhanceDraft) uses the same small model to turn a draft into a clear
// request for Mira, without answering it or adding anything the person didn't give.
const { streamCompletion, MOCK_MODE } = require("./modelRouter");

const PLAN_LIMIT_MS = 7000;
const ENHANCE_LIMIT_MS = 12000;
const RECENT_MESSAGES = 6;
const RECENT_LINE_MAX = 300;

const ATTACHMENT_BLOCK = /^\[Attached (file|image): ([^\]]+)\]/;
function splitAttachments(text) {
  const blocks = String(text || "").split("\n\n---\n\n");
  const files = [];
  const words = blocks.filter((block) => {
    const match = ATTACHMENT_BLOCK.exec(block);
    if (match) files.push(match[2]);
    return !match;
  });
  return { text: words.join("\n\n").trim(), files };
}

const QUICK_REPLY = /^(yes|yeah|yep|yup|no|nope|nah|ok(ay)?|k|sure|fine|go ahead|go on|do it|please do|proceed|confirm(ed)?|correct|right|exactly|thanks?|thank you( so much)?|thx|ty|great|perfect|cool|nice|awesome|got it|hi|hello|hey|good (morning|afternoon|evening)|bye|the (first|second|third|last|other) one|both|all( of them)?|none|cancel|stop|never ?mind)( please| thanks| thank you)?[\s.!]*$/i;

// A plan helps with a request, not with "yes" or "thanks".
function needsPlan(userText) {
  const { text } = splitAttachments(userText);
  if (!text) return false;
  if (QUICK_REPLY.test(text.trim())) return false;
  return text.trim().length >= 6;
}

function recentLines(history) {
  return (history || [])
    .filter((message) => message.role === "user" || message.role === "assistant")
    .slice(-RECENT_MESSAGES)
    .map((message) => {
      const text = splitAttachments(message.content).text.replace(/\s+/g, " ").trim();
      const short = text.length > RECENT_LINE_MAX ? `${text.slice(0, RECENT_LINE_MAX)}...` : text;
      return `${message.role === "user" ? "Person" : "Mira"}: ${short || "(no text)"}`;
    })
    .join("\n");
}

// Runs a small model call to the end and returns its text, or null when it fails or takes
// too long (the turn goes on without it).
async function quickCompletion(messages, limitMs, onUsage) {
  let text = "";
  let timer;
  const call = streamCompletion({ task: "lookup", messages, tools: [], onToken: (chunk) => { text += chunk; }, onToolCall: () => {} })
    .then((pass) => {
      if (onUsage) Promise.resolve(onUsage(pass)).catch(() => {});
      return text;
    })
    .catch((error) => {
      console.error("[mira/planner] small model call failed:", error.message);
      return null;
    });
  const tooSlow = new Promise((resolve) => { timer = setTimeout(() => resolve(null), limitMs); });
  return Promise.race([call, tooSlow]).finally(() => clearTimeout(timer));
}

function clean(text, max) {
  return String(text || "").replace(/\s+/g, " ").trim().slice(0, max);
}

// The model's JSON, checked: one sentence and up to five short steps, or null.
function parsePlan(raw) {
  const text = String(raw || "");
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start < 0 || end <= start) return null;
  let parsed;
  try {
    parsed = JSON.parse(text.slice(start, end + 1));
  } catch (_) {
    return null;
  }
  const understanding = clean(parsed && parsed.understanding, 280);
  const steps = (Array.isArray(parsed && parsed.steps) ? parsed.steps : [])
    .map((step) => clean(step, 90).replace(/^\d+[.)]\s*/, ""))
    .filter(Boolean)
    .slice(0, 5);
  if (!understanding) return null;
  return { understanding, steps };
}

const PLAN_PROMPT = `You plan how Mira, the AI assistant inside Managira (a school management system), will handle a school staff member's newest message. You don't answer it and you can't look anything up.

Reply with JSON only: {"understanding": "...", "steps": ["...", "..."]}
- understanding: one sentence saying what they want, in plain words, starting "You want", "You'd like" or "You're asking". Include the class, term, people or records they named, or that the recent conversation already settled. If something important is unclear, say so ("... but not which class").
- steps: what Mira itself will look up or do in Managira, in order, ending with what it gives back. Usually 2 or 3, never more than 4, each under 9 words and each saying something new (no padding, no "check your permission"). Examples: "Find Grade 5's students", "Check this term's attendance", "List anyone below 80%", "Draft one message per family".
- A question about using Managira ("how do I add a teacher?", "where do I turn on Apple Pay?"): the steps are "Find the help guide on <subject>" and "Walk you through it". Never write the how-to steps, menus or buttons yourself: you don't know them.
- "Them", "those", "their families", "the same class": say who they are from the recent conversation.
- Never include facts, figures, names or results that aren't in the conversation, and never say anything was found.
- Small talk needs one step.
- Write in the language the person wrote in.`;

// { understanding, steps } or null.
async function planTurn({ userText, history, tenant, classScope, calendarLine, onUsage }) {
  if (!needsPlan(userText)) return null;
  const { text, files } = splitAttachments(userText);
  if (MOCK_MODE) {
    return { understanding: `You're asking: "${clean(text, 200)}"`, steps: ["Look it up in Managira", "Give you the answer"] };
  }
  const context = [
    calendarLine || "",
    tenant ? `They are ${tenant.roleLabel || "a member of staff"} at ${tenant.organizationName || "their school"}.` : "",
    classScope && classScope.className ? `They chose the class "${classScope.className}" as the focus.` : "",
  ].filter(Boolean).join(" ");
  const recent = recentLines(history);
  const messages = [
    { role: "system", content: PLAN_PROMPT },
    {
      role: "user",
      content: `${context}\n\n${recent ? `Recent conversation:\n${recent}\n\n` : ""}Newest message:\n${text}${files.length ? `\n(They attached: ${files.join(", ")})` : ""}`,
    },
  ];
  return parsePlan(await quickCompletion(messages, PLAN_LIMIT_MS, onUsage));
}

// What Mira is told: its own plan, never above the person's own words.
function planForModel(plan) {
  if (!plan) return null;
  const steps = plan.steps.length ? ` Steps: ${plan.steps.map((step, index) => `${index + 1}. ${step.replace(/[.\s]+$/, "")}.`).join(" ")}` : "";
  return `Your plan for the person's newest message, made before looking anything up: ${plan.understanding}${steps} Work through it with your tools and adapt it when a result changes things; if the plan misread the message, follow the message. The plan is what you'll do, not something to tell the person: the tool results and help guides are the facts. Don't repeat the plan in your reply.`;
}

// ---- Enhance ----

const ENHANCE_PROMPT = `You improve a school staff member's draft message to Mira, the AI assistant inside Managira (a school management system), before they send it. Reply with the improved message only: no quotes, no heading, no explanation, and never an answer to it.
- Keep their meaning, their language and their voice: it is still their message, in the first person.
- Make it clear and specific: what they want, about which students, class, subject or term (only the ones they gave, or that the recent conversation settled), and what they want back (a list, a count, a table, a draft message, a PDF, a chart).
- Never add names, numbers, dates, classes, amounts or facts they didn't give. If something is missing, keep it general ("my class", "this term") rather than inventing it.
- Fix spelling and grammar. Keep it short: one to three sentences, or a short list for a request with several parts.
- If the draft is already clear, return it tidied with the same meaning.`;

// A tidy-up without a model: spacing, a capital, an ending.
function tidyDraft(text) {
  let out = String(text || "").replace(/[ \t]+/g, " ").replace(/\s*\n\s*/g, "\n").trim();
  if (!out) return out;
  out = out.charAt(0).toUpperCase() + out.slice(1);
  out = out.replace(/\bi\b/g, "I");
  if (!/[.?!:)]$/.test(out)) {
    out += /^(who|what|when|where|which|why|how|can|could|do|does|did|is|are|was|were|will|would|should|have|has)\b/i.test(out) ? "?" : ".";
  }
  return out;
}

function cleanEnhanced(raw, original) {
  let out = String(raw || "").trim();
  out = out.replace(/^```[a-z]*\n?|\n?```$/g, "").trim();
  out = out.replace(/^(improved|enhanced|rewritten|revised)( message| draft| version)?\s*:\s*/i, "");
  if (/^(["'`]).*\1$/s.test(out) || /^“.*”$/s.test(out)) out = out.slice(1, -1).trim();
  if (!out || out.length > Math.max(2000, String(original || "").length * 4)) return null;
  return out.slice(0, 4000);
}

// { text, changed }: the improved draft, or the tidied original when the model can't help.
async function enhanceDraft({ draft, history, classScope, onUsage }) {
  const original = String(draft || "").trim();
  if (!original) return { text: "", changed: false };
  const fallback = tidyDraft(original);
  if (MOCK_MODE) return { text: fallback, changed: fallback !== original };
  const recent = recentLines(history);
  const messages = [
    { role: "system", content: ENHANCE_PROMPT },
    {
      role: "user",
      content: `${classScope && classScope.className ? `They chose the class "${classScope.className}" as the focus.\n\n` : ""}${recent ? `Recent conversation:\n${recent}\n\n` : ""}Draft to improve:\n${original}`,
    },
  ];
  const improved = cleanEnhanced(await quickCompletion(messages, ENHANCE_LIMIT_MS, onUsage), original);
  const text = improved || fallback;
  return { text, changed: text !== original };
}

// ---- Steps, in plain words ----

const TOOL_STEPS = {
  whats_new: "Checking what's available to your school",
  find_free_time: "Finding free time on your calendar",
  add_to_my_calendar: "Adding it to your calendar",
  find_student: "Finding the student",
  list_students: "Listing students",
  get_class: "Looking up classes",
  get_term: "Checking the term",
  list_school_years: "Checking school years",
  list_projects: "Checking your school",
  report_builder_catalog: "Checking which reports exist",
  run_report: "Running the report",
  export_report: "Preparing the download",
  get_attendance: "Checking attendance",
  find_low_attendance: "Finding students below the attendance level",
  get_fees: "Checking fees",
  find_contact: "Finding the parent or guardian",
  get_guardian_details: "Reading guardian details",
  get_upcoming_birthdays: "Checking birthdays",
  list_assessments: "Looking up assessments",
  generate_report_pdf: "Preparing report cards",
  post_or_send_report_cards: "Preparing report cards for parents",
  get_merit_sheet: "Reading the merit sheet",
  get_organization_statistics: "Reading school statistics",
  compare_classes: "Comparing classes",
  draft_family_messages: "Writing a draft for each family",
  send_message: "Preparing the message",
  list_sent_messages: "Checking sent messages",
  list_events: "Checking events",
  get_my_calendar: "Reading your calendar",
  get_website_settings: "Reading the website settings",
  list_pending_admissions: "Checking pending admissions",
  list_activities: "Checking activities",
  create_activity: "Adding the activity",
  create_event: "Adding the event",
  update_event: "Updating the event",
  list_question_sets: "Looking up online tests",
  get_report_settings: "Reading report settings",
  list_saved_reports: "Checking saved reports",
  save_report: "Saving the report",
  list_archived_students: "Checking archived students",
  get_calendar_sync_status: "Checking your calendar connection",
  get_sso_status: "Checking single sign-on",
  get_integrations_status: "Checking integrations",
};

function toolStepLabel(name, args) {
  const tool = String(name || "");
  let label = TOOL_STEPS[tool];
  if (!label) {
    if (/attendance/.test(tool)) label = "Checking attendance";
    else if (/^draft_/.test(tool)) label = "Writing drafts";
    else if (/^(send_|post_or_send)/.test(tool)) label = "Preparing to send";
    else if (/report|merit|statistics|compare/.test(tool)) label = "Running the numbers";
    else if (/^(create|update|set|add|rename|assign|approve|schedule|upload|save|share|favorite|import|unarchive|modify|reuse)_/.test(tool)) label = "Getting the change ready";
    else if (/^(delete|remove|reject|reverse|cancel|unpost)_/.test(tool)) label = "Checking what this would change";
    else if (/^(list|get|check)_/.test(tool)) label = `Checking ${tool.replace(/^(list|get|check)_/, "").replace(/_/g, " ")}`;
    else label = "Looking it up";
  }
  const about = args && typeof args === "object"
    ? [args.query, args.className, args.class_name, args.studentName, args.reportKey, args.report].find((value) => typeof value === "string" && value.trim())
    : null;
  return about ? `${label}: ${clean(about, 40)}` : label;
}

module.exports = { needsPlan, planTurn, parsePlan, planForModel, enhanceDraft, cleanEnhanced, tidyDraft, toolStepLabel, splitAttachments };
