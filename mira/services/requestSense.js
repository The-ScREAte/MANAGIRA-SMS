// Making sense of a request before anything is previewed (enforced in code, not left to the model):
//
// - Where it goes: putting something on a calendar or in front of people can be a school event, an
//   announcement, an activity or the person's own calendar. Unless their words (in this message or
//   the last few) say which, Mira asks, with who sees each; it never picks for them.
// - Nothing invented: a time, place or description the person never gave (nor any tool returned)
//   isn't put into a change; Mira asks instead (a missing time means all day).
// - Checked first: "doesn't clash", "when everyone's free" need the calendar looked up before a
//   preview is made.
// - Not done yet: while only a preview exists, the reply never says it's scheduled, created or sent.

const KINDS = {
  event: { tools: ["create_event"], words: /\b(school )?events?\b|school calendar|on the (school )?calendar|calendar event/i, label: "School event", who: "on the school calendar for staff; families and the website see it only if you choose that" },
  announcement: { tools: ["create_school_announcement", "create_announcement"], words: /\b(announce\w*|notices?|circulars?|bulletins?|memo)\b|\bpost (a|an|this|that|it)\b/i, label: "Announcement", who: "a notice on dashboards (and an email to families only if you ask)" },
  activity: { tools: ["create_activity"], words: /\b(activit(y|ies)|field ?trips?|clubs?|excursions?|outings?|class trips?|practice|rehearsals?)\b/i, label: "Activity", who: "for one class or the whole school; that class's parents and students see it and are notified" },
  personal: { tools: ["add_to_my_calendar"], words: /\b(my (own )?calendar|remind me|for me only|just me|personal|my diary|block (out|off) (my|some))\b/i, label: "Just your calendar", who: "only you see it" },
};
const KIND_OF_TOOL = new Map(Object.entries(KINDS).flatMap(([kind, k]) => k.tools.map((tool) => [tool, kind])));

// The person's own words for this request: this message and their last three.
function personWords(userText, history = []) {
  const earlier = history.filter((m) => m.role === "user").slice(-3).map((m) => String(m.content || ""));
  return [...earlier, String(userText || "")].join("\n");
}

// "Doesn't clash with any event" is about other things on the calendar, not what to make.
const ABOUT_OTHERS = /\b(clash\w*|conflict\w*|overlap\w*|around|between|before|after|other|any|no|existing)\s+(with\s+)?(any |other |an |the |existing |school )*(events?|activit(y|ies)|announcements?)\b/gi;
function kindsNamed(words) {
  const text = String(words || "").replace(ABOUT_OTHERS, " ");
  return Object.entries(KINDS).filter(([, k]) => k.words.test(text)).map(([kind]) => kind);
}

// null when the tool fits what the person asked for; otherwise what to ask.
function whereItGoes(tool, userText, history) {
  const kind = KIND_OF_TOOL.get(tool);
  if (!kind) return null;
  const named = kindsNamed(personWords(userText, history));
  if (named.includes(kind)) return null;
  const options = Object.values(KINDS).map((k) => `- ${k.label}: ${k.who}`).join("\n");
  return {
    status: "needs_choice",
    nothing_changed_yet: true,
    ask: named.length
      ? `The person asked for ${named.map((n) => KINDS[n].label.toLowerCase()).join(" or ")}, not ${KINDS[kind].label.toLowerCase()}. Use the tool for what they asked for.`
      : `Don't create it yet. Ask the person, in one short question, where this should go:\n${options}\nThen make the preview for what they choose.`,
  };
}

// ── Invented details ──
const STOP = new Set("the a an and or of to for on in at with about from this that these those our their your will be is are was were it its as by into over per via we you they them he she his her my me i us please can could would should".split(" "));
const words = (text) => String(text || "").toLowerCase().match(/[a-z0-9']+/g) || [];

function timeVariants(value) {
  const m = String(value || "").trim().match(/^(\d{1,2}):?(\d{2})?\s*(am|pm)?$/i);
  if (!m) return [];
  let hour = Number(m[1]);
  const minute = m[2] || "00";
  if (m[3]) hour = (hour % 12) + (/pm/i.test(m[3]) ? 12 : 0);
  const h12 = hour % 12 || 12;
  const ampm = hour >= 12 ? "pm" : "am";
  const out = [`${String(hour).padStart(2, "0")}:${minute}`, `${hour}:${minute}`, `${h12}:${minute}${ampm}`, `${h12}:${minute} ${ampm}`];
  if (minute === "00") out.push(`${h12}${ampm}`, `${h12} ${ampm}`, `${h12} o'clock`, `${h12}o'clock`);
  if (hour === 12 && minute === "00") out.push("noon", "midday");
  if (hour === 0 && minute === "00") out.push("midnight");
  return out.map((v) => v.toLowerCase());
}

const TIME_FIELDS = /^(start_?time|end_?time|time|starts?_?at|ends?_?at)$/i;
const TEXT_FIELDS = /^(details|event_?details|description|location|place|venue|notes?|agenda)$/i;
const DETAIL_TOOLS = new Set(["create_activity", "create_event", "update_event", "add_to_my_calendar"]);

// The fields of a change the person never gave: [{ field, value }].
function inventedDetails(tool, args, known) {
  if (!DETAIL_TOOLS.has(tool) || !args) return [];
  const said = String(known || "").toLowerCase();
  const saidWords = new Set(words(said));
  const out = [];
  Object.entries(args).forEach(([field, value]) => {
    if (value === undefined || value === null || value === "" || typeof value === "boolean") return;
    if (TIME_FIELDS.test(field)) {
      const variants = timeVariants(value);
      const given = variants.some((v) => said.includes(v));
      // An end time worked out from a length they gave ("for an hour") is theirs too.
      const fromLength = /end/i.test(field) && /\b(\d+|an?|one|two|half)\s*(hours?|hrs?|minutes?|mins?)\b/i.test(said);
      if (!given && !fromLength) out.push({ field, value });
      return;
    }
    if (TEXT_FIELDS.test(field) && typeof value === "string") {
      const significant = words(value).filter((w) => w.length >= 4 && !STOP.has(w));
      if (!significant.length) return;
      const found = significant.filter((w) => saidWords.has(w) || saidWords.has(w.replace(/s$/, "")) || saidWords.has(`${w}s`)).length;
      if (found / significant.length < 0.7) out.push({ field, value });
    }
  });
  return out;
}

function inventedReply(found) {
  return {
    status: "needs_info",
    nothing_changed_yet: true,
    not_given: found.map((f) => f.field),
    ask: `Nothing was prepared: the person never gave ${found.map((f) => `${f.field} ("${String(f.value).slice(0, 60)}")`).join(", ")}. Call the tool again now without ${found.length === 1 ? "it" : "them"}: a description can be just what they said (e.g. the title, with any time they gave), no time means all day. Ask only if the change can't be made without it. Don't make anything up.`,
  };
}

// ── Checked first ──
const CLASH_ASK = /\b(clash\w*|conflict\w*|overlap\w*|double[- ]?book\w*|free (day|slot|time|date)|(when|where) (everyone|nobody|no one|we) (is|are) free|nothing else (on|that day)|not busy|available (day|date|time|slot))\b/i;
const CALENDAR_TOOLS = /^(get_calendar|list_events|get_my_calendar|find_free_time|get_availability)$/;
function needsCalendarFirst(userText, history, callsThisTurn) {
  if (!CLASH_ASK.test(personWords(userText, history))) return null;
  if ((callsThisTurn || []).some((call) => CALENDAR_TOOLS.test(call.name))) return null;
  return {
    status: "needs_lookup",
    nothing_changed_yet: true,
    ask: "They asked for it not to clash: look up the calendar for those dates first (get_calendar with scope school, and list_events), say what's already on, then choose a date that's clear and preview it.",
  };
}

// ── Dates the school names ("midterm") ──
// Resolved only by the calendar (a lookup that returned the word) or by the person ("by midterm I
// mean October 16"); never worked out by Mira.
const NAMED_DATE = /\b(mid-?terms?|mid-?semester|exams? (week|period|season)|finals? week|sports? day|field day|open day|homecoming|graduation( day)?|end of (the )?(term|semester|year)|start of (the )?(term|semester|year)|half[- ]?term|(spring|winter|fall|summer|thanksgiving|easter|christmas|mid-?winter) (break|holidays?|recess)|report card day|parents'? (evening|night|day)|picture day)\b/gi;
const DATE_NEAR = /\b(jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*\.?\s+\d{1,2}\b|\b\d{1,2}(st|nd|rd|th)?\s+(of\s+)?(jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)|\b\d{4}-\d{2}-\d{2}\b|\b\d{1,2}\/\d{1,2}\b/i;
function unresolvedNamedDates(userText, history, toolTexts, reply) {
  const said = personWords(userText, history.concat([]).slice(-10));
  const found = [...new Set((said.match(NAMED_DATE) || []).map((w) => w.toLowerCase()))];
  if (!found.length) return [];
  const looked = String((toolTexts || []).join("\n")).toLowerCase();
  return found.filter((word) => {
    const core = word.replace(/-/g, "").split(" ")[0];
    if (looked.replace(/-/g, "").includes(core)) return false; // the calendar names it
    // The person said what it means ("by midterm I mean October 16").
    const near = new RegExp(`${word.replace(/[-]/g, "-?").replace(/ /g, "\\s+")}[^.?!\\n]{0,40}`, "gi");
    if ([...said.matchAll(near)].some((m) => DATE_NEAR.test(m[0]))) return false;
    // The reply asks about it instead of guessing.
    if (new RegExp(`${core}[^?]{0,160}\\?`, "i").test(String(reply || "").replace(/-/g, ""))) return false;
    return true;
  });
}

// ── Not done yet ──
// A reply that presents a preview or asks for a go-ahead.
const PREVIEW_TALK = /\b(here'?s the preview|preview|shall i (go ahead|schedule|create|post|send|add|book|set)|go ahead and (schedule|create|post|send|add)|confirm (it|this)|ready to (schedule|create|post|send))\b/i;
function presentsPreview(reply) {
  return PREVIEW_TALK.test(String(reply || ""));
}

const DONE_CLAIM = /\b(i('ve| have)|it('s| has| is)|this (has|is)|they('ve| have)|has been|have been|is now|are now|successfully|all set)\b[^.!?\n]{0,40}\b(scheduled|created|added|sent|posted|published|booked|set up|deleted|removed|saved|updated|confirmed)\b/i;
// "The PTA meeting is scheduled as follows", "Ama has been added": stated as already done.
const DONE_STATE = /\b(is|are|was|were|has been|have been|got)\s+(now\s+)?(successfully\s+)?(scheduled|created|added|sent|posted|published|booked|set up|deleted|removed|saved|confirmed)\b(?!\s+(once|when|after|if|as soon as))/i;
function claimsDone(reply) {
  const text = String(reply || "");
  return DONE_CLAIM.test(text) || DONE_STATE.test(text);
}

// Who sees each kind of change, for previews Managira builds.
const WHO_SEES = {
  create_activity: KINDS.activity.who,
  create_event: KINDS.event.who,
  update_event: KINDS.event.who,
  create_school_announcement: KINDS.announcement.who,
  create_announcement: "a notice on staff dashboards",
  add_to_my_calendar: KINDS.personal.who,
};

module.exports = { KINDS, whereItGoes, inventedDetails, inventedReply, needsCalendarFirst, claimsDone, presentsPreview, unresolvedNamedDates, WHO_SEES, timeVariants, personWords };
