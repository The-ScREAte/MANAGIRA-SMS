// Confirmations, enforced in code (never left to the model).
//
// Every change (a tool of level 1-3, services/levels.js) first makes a preview: either the tool's
// own preview (NATIVE_PREVIEW: its call without confirm only previews) or, for any other tool, a
// preview Managira builds from the exact details without running anything. Each preview gets a
// preview_id: signed, bound to the school, the person, the chat, the tool and a hash of the exact
// details; single use; it expires after PREVIEW_TTL_MS.
//
// A change runs only when the PERSON confirms: the Confirm button on the preview (its preview_id),
// or their own clear yes in their next message to the one preview waiting (or "yes to all" for
// every preview of the last reply). A Level 3 change also needs what it is about typed
// ("delete Grade 6A"). The model never confirms: a model call with confirm=true is refused, and
// the confirmed change is run by the orchestrator itself with the previewed details.
const crypto = require("crypto");

const PREVIEW_TTL_MS = 10 * 60 * 1000;
const STORE_MAX = 5000;
const SECRET = process.env.MIRA_PREVIEW_SECRET || process.env.SESSION_SECRET || process.env.MIRA_SERVICE_TOKEN || crypto.randomBytes(32).toString("hex");

// Tools whose call without confirm only previews (checked by reading each one: the server answers
// "confirmation_required" or the tool returns before writing). Every other change is previewed by
// Managira from its details, and runs only after the person confirms.
const NATIVE_PREVIEW = new Set([
  "remind_form_outstanding", "send_message", "post_or_send_report_cards", "set_enrollment_roster", "create_employee",
  "delete_enrollment", "schedule_promotion", "apply_scheduled_promotion", "cancel_scheduled_promotion", "reverse_promotion",
  "delete_reversed_promotion", "approve_pending_admission", "reject_pending_admission", "unarchive_students",
  "close_graduation_year_group", "delete_class", "delete_subject", "delete_graduation_year_group", "delete_school_year",
  "delete_term", "delete_test", "delete_question_set", "delete_document", "delete_event", "delete_school_announcement",
  "delete_transport_bus", "delete_transport_driver", "delete_transport_route", "delete_transport_schedule", "delete_transport_stop",
  "delete_website_article", "delete_website_image", "set_student_assessment_status", "update_website_section",
  "delete_saved_report", "share_saved_report", "schedule_saved_report",
]);

const YES = /\b(yes|yep|yeah|yup|ya|sure|ok|okay|okey|confirm(ed|s)?|go ahead|go for it|proceed|do it|do that|do so|send (it|them|now|the)|send|approved?|correct|that'?s (right|fine|good|correct)|please do|looks good|sounds good|absolutely|affirmative|carry on|perfect|fine|delete|remove|post|publish|save|create|add|schedule|apply|go)\b/i;
const NO_START = /^\s*(no|nope|nah|not|stop|wait|hold|cancel|don'?t)\b/i;
const NO_ANY = /\b(don'?t|do not|not yet|hold on|hold off|never ?mind|nevermind|wait|instead|but)\b/i;
const ALL = /\b(all|both|every|each|everything|them all)\b/i;

function clean(text) {
  return String(text || "")
    .replace(/^\[Attached (file|image): [^\]]+\][\s\S]*?(\n\n|$)/gm, "")
    .replace(/\s+/g, " ")
    .trim();
}

function isYes(text) {
  const words = clean(text);
  if (!words || words.length > 400) return false;
  if (NO_START.test(words) || NO_ANY.test(words)) return false;
  return YES.test(words);
}

function isNo(text) {
  const words = clean(text);
  return Boolean(words) && words.length <= 200 && (NO_START.test(words) || /^\s*(cancel|never ?mind|forget it|leave it)\b/i.test(words));
}

// The details of a call, independent of key order, confirm itself and empty values.
function tidy(value) {
  if (Array.isArray(value)) {
    const list = value.map(tidy).filter((v) => v !== undefined);
    return list.length ? list : undefined;
  }
  if (value && typeof value === "object") {
    const out = {};
    Object.keys(value).sort().forEach((key) => {
      if (key === "confirm" || key === "preview_id") return;
      const v = tidy(value[key]);
      if (v !== undefined) out[key] = v;
    });
    return Object.keys(out).length ? out : undefined;
  }
  if (value === null || value === undefined || value === "") return undefined;
  if (typeof value === "string") return value.trim().replace(/\s+/g, " ");
  return value;
}
const detailsKey = (args) => JSON.stringify(tidy(args || {}) || {});
const detailsOf = (args) => tidy(args || {}) || {};

// What a Level 3 change is about: its first named detail (className, title ...).
function keyDetail(args) {
  const entries = Object.entries(args || {}).filter(([key, value]) => !["confirm", "preview_id"].includes(key) && (typeof value === "string" && value.trim() || typeof value === "number"));
  const named = entries.find(([key]) => /name|title|label|report|stop|route|bus|driver|term|year|group|section|set|class|student|employee|person/i.test(key)) || entries[0];
  return named ? String(named[1]).trim() : "";
}

function typedDetail(text, detail) {
  if (!detail) return true;
  const said = clean(text).toLowerCase();
  const want = String(detail).toLowerCase().replace(/\s+/g, " ");
  if (said.includes(want)) return true;
  const words = want.split(/[^a-z0-9]+/).filter((w) => w.length >= 3);
  if (words.length < 3) return false;
  return words.filter((w) => said.includes(w)).length / words.length >= 0.6;
}

// ── The store ──
const store = new Map();
const sign = (p) => crypto.createHmac("sha256", SECRET)
  .update([p.nonce, p.organizationId, p.userId, p.chatId, p.tool, p.key, p.expiresAt].join("|"))
  .digest("base64url").slice(0, 22);

function prune(now = Date.now()) {
  for (const [id, p] of store) if (p.expiresAt < now - PREVIEW_TTL_MS) store.delete(id);
  while (store.size > STORE_MAX) store.delete(store.keys().next().value);
}

function create({ tenant, chatId, turn, tool, args, level, label }) {
  prune();
  const nonce = crypto.randomBytes(12).toString("base64url");
  const p = {
    nonce, organizationId: Number(tenant.organizationId), userId: Number(tenant.userId), chatId: Number(chatId), turn: Number(turn) || 0,
    tool, args: detailsOf(args), key: detailsKey(args), level, label: label || tool,
    keyDetail: level >= 3 ? keyDetail(args) : "", createdAt: Date.now(), expiresAt: Date.now() + PREVIEW_TTL_MS, state: "waiting",
  };
  p.id = `${nonce}.${sign(p)}`;
  store.set(p.id, p);
  return p;
}

const mine = (p, tenant, chatId) => p && p.organizationId === Number(tenant.organizationId) && p.userId === Number(tenant.userId) && p.chatId === Number(chatId);

function verify(id, tenant, chatId, now = Date.now()) {
  const p = store.get(String(id || ""));
  if (!p || !mine(p, tenant, chatId)) return { ok: false, reason: "That preview is no longer waiting (previews last 10 minutes). Nothing was changed. Ask Mira to prepare it again." };
  const expected = sign(p);
  const given = String(id).split(".")[1] || "";
  if (given.length !== expected.length || !crypto.timingSafeEqual(Buffer.from(given), Buffer.from(expected))) return { ok: false, reason: "That preview couldn't be verified." };
  if (p.state !== "waiting") return { ok: false, reason: p.state === "done" ? "That change was already made." : "That preview was cancelled." };
  if (p.expiresAt < now) return { ok: false, reason: "That preview has expired (previews last 10 minutes). Ask Mira to prepare it again." };
  return { ok: true, preview: p };
}

function waiting(tenant, chatId, now = Date.now()) {
  return [...store.values()].filter((p) => mine(p, tenant, chatId) && p.state === "waiting" && p.expiresAt >= now).sort((a, b) => a.createdAt - b.createdAt);
}

function mark(p, state) {
  if (p) p.state = state;
}

// What the person's message (or button) confirms or cancels. Returns
// { run: [previews], cancelled: [previews], refusal: "..." | null }.
function decide({ tenant, chatId, userText, confirmId, typed, cancelId }) {
  const out = { run: [], cancelled: [], refusal: null };
  if (cancelId) {
    const checked = verify(cancelId, tenant, chatId);
    if (checked.ok) { mark(checked.preview, "cancelled"); out.cancelled.push(checked.preview); }
    return out;
  }
  if (confirmId) {
    // One id (Confirm) or several (Confirm all on one reply's previews); a typed detail per Level 3 one.
    const ids = [].concat(confirmId).map(String).slice(0, 25);
    for (const id of ids) {
      const checked = verify(id, tenant, chatId);
      if (!checked.ok) { out.refusal = checked.reason; out.run = []; return out; }
      const p = checked.preview;
      const said = typed && typeof typed === "object" ? typed[id] : typed;
      if (p.level >= 3 && !typedDetail(`${said || ""} ${userText || ""}`, p.keyDetail)) {
        out.refusal = `This can't be undone, so type "${p.keyDetail}" to confirm it. Nothing was changed.`;
        out.run = [];
        return out;
      }
      out.run.push(p);
    }
    return out;
  }
  const open = waiting(tenant, chatId);
  if (!open.length) return out;
  if (isNo(userText)) {
    open.forEach((p) => mark(p, "cancelled"));
    out.cancelled.push(...open);
    return out;
  }
  if (!isYes(userText)) return out; // anything else: the previews stay waiting until they expire
  const latestTurn = Math.max(...open.map((p) => p.turn));
  const batch = open.filter((p) => p.turn === latestTurn);
  const chosen = batch.length === 1 ? batch : ALL.test(clean(userText)) ? batch : [];
  if (!chosen.length) {
    out.refusal = `${batch.length} changes are waiting for a yes. Ask the person to press Confirm on each one, or to reply "yes to all". Nothing was changed.`;
    return out;
  }
  const untyped = chosen.filter((p) => p.level >= 3 && !typedDetail(userText, p.keyDetail));
  if (untyped.length) {
    out.refusal = `This can't be undone, so the person must type what it is about to confirm: ${untyped.map((p) => `"${p.keyDetail}"`).join(", ")}. Nothing was changed.`;
    return out;
  }
  out.run.push(...chosen);
  return out;
}

const MODEL_CONFIRM_REFUSAL = "Not done: you can't confirm a change. Managira runs it only when the person confirms the preview (the Confirm button, or their own yes). Show the preview and stop.";

// A tool's own answer is a preview when it asks for a confirmation.
function looksLikePreview(result) {
  if (!result || typeof result !== "object") return false;
  return /^(confirm|confirmation_required|confirm_\w+|preview)$/.test(String(result.status || "")) || Boolean(result.preview) || Boolean(result.warning);
}

module.exports = {
  PREVIEW_TTL_MS, NATIVE_PREVIEW, MODEL_CONFIRM_REFUSAL,
  isYes, isNo, detailsKey, detailsOf, keyDetail, typedDetail,
  create, verify, waiting, mark, decide, looksLikePreview,
  _store: store,
};
