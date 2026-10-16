// Extra sections for a school's public website (quick facts, programs &
// facilities, leadership, testimonials, FAQ, about image, contact form) and
// the contact-form inbox. Kept in their own table: the existing website
// settings row (organization_dashboard.order_data) is rewritten as a whole
// by several handlers, which would drop anything else stored there.
// A section only appears on the website when it is switched on AND has
// content, so nothing half-set-up is ever shown.

let schemaReady = false;

async function ensureWebsiteSchema(db) {
  if (schemaReady) return;
  await db.query(`
    CREATE TABLE IF NOT EXISTS organization_website_settings (
      organization_id INTEGER PRIMARY KEY,
      settings JSONB NOT NULL DEFAULT '{}'::jsonb,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `);
  await db.query(`
    CREATE TABLE IF NOT EXISTS website_contact_messages (
      id SERIAL PRIMARY KEY,
      organization_id INTEGER NOT NULL,
      name VARCHAR(120) NOT NULL,
      email VARCHAR(200),
      phone VARCHAR(40),
      subject VARCHAR(200),
      message TEXT NOT NULL,
      status VARCHAR(16) NOT NULL DEFAULT 'new',
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `);
  await db.query(`CREATE INDEX IF NOT EXISTS website_contact_messages_org_idx ON website_contact_messages (organization_id, created_at DESC)`);
  schemaReady = true;
}

const SECTION_KEYS = ["quickFacts", "programs", "leadership", "testimonials", "faq", "about", "contact", "page", "welcome", "admissions", "achievements", "social", "hero"];

// Everything on the website below the slideshow, in its default order. The
// school can reorder these, rename the built-in ones and hide them (the
// extra sections have their own on/off switch).
const PAGE_BLOCKS = [
  { key: "quickFacts", label: "Quick Facts" },
  { key: "welcome", label: "Welcome message" },
  { key: "about", label: "About the school", builtin: true, defaultTitle: "About Our School" },
  { key: "programs", label: "Programs & Facilities" },
  { key: "admissions", label: "Admissions" },
  { key: "gallery", label: "Photo gallery", builtin: true, defaultTitle: "Campus Gallery" },
  { key: "events", label: "Events", builtin: true, defaultTitle: "Upcoming Events" },
  { key: "announcements", label: "Announcements", builtin: true, defaultTitle: "Announcements" },
  { key: "articles", label: "News & articles", builtin: true, defaultTitle: "School News" },
  { key: "leadership", label: "Leadership" },
  { key: "achievements", label: "Achievements" },
  { key: "testimonials", label: "Testimonials" },
  { key: "faq", label: "FAQ" },
  { key: "contact", label: "Contact form" },
];
const PAGE_KEYS = PAGE_BLOCKS.map((b) => b.key);
const BUILTIN_KEYS = PAGE_BLOCKS.filter((b) => b.builtin).map((b) => b.key);

const LIMITS = { quickFacts: 6, programs: 9, leadership: 8, testimonials: 8, faq: 12, welcome: 1, admissions: 6, achievements: 9 };

// Social links shown in the website footer.
const SOCIAL_NETWORKS = [
  { key: "facebook", label: "Facebook", host: /(^|\.)(facebook|fb)\.com$/i },
  { key: "instagram", label: "Instagram", host: /(^|\.)instagram\.com$/i },
  { key: "x", label: "X (Twitter)", host: /(^|\.)(x|twitter)\.com$/i },
  { key: "youtube", label: "YouTube", host: /(^|\.)(youtube\.com|youtu\.be)$/i },
  { key: "linkedin", label: "LinkedIn", host: /(^|\.)linkedin\.com$/i },
  { key: "tiktok", label: "TikTok", host: /(^|\.)tiktok\.com$/i },
  { key: "whatsapp", label: "WhatsApp", host: /(^|\.)(whatsapp\.com|wa\.me)$/i },
];
// A full https link on that network's own site, or nothing.
function socialUrl(value, host) {
  const raw = String(value || "").trim();
  if (!raw) return "";
  try {
    const url = new URL(/^https?:\/\//i.test(raw) ? raw : `https://${raw}`);
    if (url.protocol !== "https:" && url.protocol !== "http:") return "";
    if (!host.test(url.hostname)) return "";
    url.protocol = "https:";
    return url.toString().slice(0, 300);
  } catch (_) {
    return "";
  }
}

const text = (value, max) => String(value == null ? "" : value).replace(/\s+/g, " ").trim().slice(0, max);
const longText = (value, max) => String(value == null ? "" : value).replace(/\r\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim().slice(0, max);
// Only images this app uploaded (S3) or plain https URLs are kept.
const imageUrl = (value) => {
  const url = String(value || "").trim();
  return /^https:\/\/[^\s"'<>]+$/i.test(url) ? url.slice(0, 600) : "";
};
const email = (value) => {
  const v = String(value || "").trim().toLowerCase();
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v) ? v.slice(0, 200) : "";
};
const list = (value, max, mapItem, keep) =>
  (Array.isArray(value) ? value : []).map(mapItem).filter(keep).slice(0, max);

// Cleans one section exactly as it will be stored.
function normalizeSection(key, input = {}) {
  const enabled = input.enabled === true || input.enabled === "true";
  switch (key) {
    case "quickFacts":
      return {
        enabled,
        items: list(input.items, LIMITS.quickFacts, (i) => ({ value: text(i?.value, 30), label: text(i?.label, 60) }), (i) => i.value && i.label),
      };
    case "programs":
      return {
        enabled,
        title: text(input.title, 80) || "Programs & Facilities",
        intro: longText(input.intro, 400),
        items: list(input.items, LIMITS.programs, (i) => ({ title: text(i?.title, 80), description: longText(i?.description, 500), imageUrl: imageUrl(i?.imageUrl) }), (i) => i.title),
      };
    case "leadership":
      return {
        enabled,
        title: text(input.title, 80) || "Our Leadership",
        items: list(input.items, LIMITS.leadership, (i) => ({ name: text(i?.name, 80), role: text(i?.role, 80), message: longText(i?.message, 400), imageUrl: imageUrl(i?.imageUrl) }), (i) => i.name),
      };
    case "testimonials":
      return {
        enabled,
        title: text(input.title, 80) || "What Families Say",
        items: list(input.items, LIMITS.testimonials, (i) => ({ quote: longText(i?.quote, 500), name: text(i?.name, 80), relation: text(i?.relation, 80) }), (i) => i.quote && i.name),
      };
    case "faq":
      return {
        enabled,
        title: text(input.title, 80) || "Frequently Asked Questions",
        items: list(input.items, LIMITS.faq, (i) => ({ question: text(i?.question, 200), answer: longText(i?.answer, 1000) }), (i) => i.question && i.answer),
      };
    case "about":
      return { imageUrl: imageUrl(input.imageUrl), imageCaption: text(input.imageCaption, 120) };
    case "contact":
      return {
        enabled,
        title: text(input.title, 80) || "Contact Us",
        intro: longText(input.intro, 300),
        notifyEmail: email(input.notifyEmail),
        address: longText(input.address, 300),
        officeHours: text(input.officeHours, 120),
        showMap: input.showMap === true || input.showMap === "true",
      };
    case "welcome":
      return {
        enabled,
        title: text(input.title, 80) || "A Word of Welcome",
        items: list(input.items, LIMITS.welcome, (i) => ({ name: text(i?.name, 80), role: text(i?.role, 80), message: longText(i?.message, 1500), imageUrl: imageUrl(i?.imageUrl) }), (i) => i.message && i.name),
      };
    case "admissions":
      return {
        enabled,
        title: text(input.title, 80) || "Admissions",
        intro: longText(input.intro, 500),
        items: list(input.items, LIMITS.admissions, (i) => ({ title: text(i?.title, 80), description: longText(i?.description, 400) }), (i) => i.title),
      };
    case "achievements":
      return {
        enabled,
        title: text(input.title, 80) || "Achievements & Awards",
        items: list(input.items, LIMITS.achievements, (i) => ({ title: text(i?.title, 100), year: text(i?.year, 12), description: longText(i?.description, 300) }), (i) => i.title),
      };
    case "social": {
      const links = {};
      SOCIAL_NETWORKS.forEach((n) => {
        const url = socialUrl(input[n.key], n.host);
        if (url) links[n.key] = url;
      });
      return { enabled, ...links };
    }
    case "hero":
      // The school banner (name and motto at the top). Shown unless switched off.
      return {
        enabled: !(input.enabled === false || input.enabled === "false"),
        kicker: text(input.kicker, 60),
        tagline: text(input.tagline, 160),
      };
    case "page": {
      const order = [...new Set((Array.isArray(input.order) ? input.order : []).map(String).filter((k) => PAGE_KEYS.includes(k)))];
      const hidden = [...new Set((Array.isArray(input.hidden) ? input.hidden : []).map(String).filter((k) => BUILTIN_KEYS.includes(k)))];
      const titles = {};
      BUILTIN_KEYS.forEach((k) => {
        const t = text(input.titles && input.titles[k], 80);
        if (t) titles[k] = t;
      });
      return { order, hidden, titles };
    }
    default:
      return null;
  }
}

function normalizeSettings(raw = {}) {
  const settings = {};
  SECTION_KEYS.forEach((key) => { settings[key] = normalizeSection(key, raw[key] || {}); });
  return settings;
}

async function getWebsiteSettings(db, organizationId) {
  await ensureWebsiteSchema(db);
  const row = (await db.query(`SELECT settings FROM organization_website_settings WHERE organization_id = $1`, [organizationId])).rows[0];
  return normalizeSettings(row?.settings || {});
}

// Saves one section; the others are left as they are.
async function saveWebsiteSection(db, organizationId, key, input) {
  if (!SECTION_KEYS.includes(key)) {
    const error = new Error("Unknown website section.");
    error.status = 400;
    throw error;
  }
  await ensureWebsiteSchema(db);
  const section = normalizeSection(key, input);
  if (key === "contact" && section.enabled && !section.notifyEmail) {
    const error = new Error("Add the school email address where website messages should be sent.");
    error.status = 400;
    throw error;
  }
  await db.query(
    `INSERT INTO organization_website_settings (organization_id, settings, updated_at)
     VALUES ($1, jsonb_build_object($2::text, $3::jsonb), now())
     ON CONFLICT (organization_id)
     DO UPDATE SET settings = organization_website_settings.settings || jsonb_build_object($2::text, $3::jsonb), updated_at = now()`,
    [organizationId, key, JSON.stringify(section)]
  );
  return section;
}

// What the public website shows: switched on and has content.
function visibleSections(settings) {
  const s = settings || normalizeSettings({});
  const on = (section) => section && section.enabled && Array.isArray(section.items) && section.items.length > 0;
  return {
    quickFacts: on(s.quickFacts) ? s.quickFacts : null,
    programs: on(s.programs) ? s.programs : null,
    leadership: on(s.leadership) ? s.leadership : null,
    testimonials: on(s.testimonials) ? s.testimonials : null,
    faq: on(s.faq) ? s.faq : null,
    about: s.about.imageUrl ? s.about : null,
    // The form needs the school's own email to deliver messages to.
    contact: s.contact.enabled && s.contact.notifyEmail ? s.contact : null,
    welcome: on(s.welcome) ? s.welcome : null,
    admissions: s.admissions && s.admissions.enabled && (s.admissions.items.length || s.admissions.intro) ? s.admissions : null,
    achievements: on(s.achievements) ? s.achievements : null,
    social: s.social && s.social.enabled ? SOCIAL_NETWORKS.filter((n) => s.social[n.key]).map((n) => ({ key: n.key, label: n.label, url: s.social[n.key] })) : [],
    hero: s.hero,
  };
}

// Online registration is open when switched on and today is between the
// start and end dates (the end date counts as a full day).
function registrationState(org, now = new Date()) {
  const enabled = org?.public_registration_enabled === true;
  const start = org?.registration_start_date ? new Date(org.registration_start_date) : null;
  const end = org?.registration_end_date ? new Date(org.registration_end_date) : null;
  const closesAt = end ? new Date(end.getFullYear(), end.getMonth(), end.getDate() + 1) : null;
  let state = "open";
  if (!enabled) state = "off";
  else if (!start || !end) state = "no_dates";
  else if (now < start) state = "not_started";
  else if (now >= closesAt) state = "ended";
  const fmt = (d) => (d ? d.toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" }) : "");
  const messages = {
    open: `Applications are open until ${fmt(end)}.`,
    off: "Online registration isn't open at the moment.",
    no_dates: "Online registration isn't open at the moment.",
    not_started: `Online registration opens on ${fmt(start)}.`,
    ended: `Online registration closed on ${fmt(end)}.`,
  };
  return {
    open: state === "open",
    state,
    message: messages[state],
    startLabel: fmt(start),
    endLabel: fmt(end),
    free: !(parseFloat(org?.public_registration_price) > 0),
  };
}

async function countUnreadMessages(db, organizationId) {
  await ensureWebsiteSchema(db);
  const row = (await db.query(
    `SELECT COUNT(*)::int AS n FROM website_contact_messages WHERE organization_id = $1 AND status = 'new'`,
    [organizationId]
  )).rows[0];
  return row ? row.n : 0;
}

const LAYOUT_NAMES = { wireframe1: "Classic", wireframe2: "Modern", wireframe3: "Magazine", wireframe4: "Story", wireframe5: "Campus", wireframe6: "Spotlight", wireframe7: "Minimal", wireframe8: "Mosaic" };

// The setup checklist at the top of Manage Website: what's done, what's
// left, and where to fix it (target = panel id on the page).
function buildWebsiteOverview({ orgDetails = {}, aboutDetails = {}, settings, imageCount = 0, articleCount = 0, layout, theme, registration, unreadMessages = 0 }) {
  const s = settings || normalizeSettings({});
  const visible = visibleSections(s);
  const aboutText = String(orgDetails.aboutus || "").replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();
  const emails = (aboutDetails.emails || []).filter(Boolean);
  const phones = (aboutDetails.phones || []).filter(Boolean);
  const liveSections = ["quickFacts", "programs", "leadership", "testimonials", "faq"].filter((k) => visible[k]).length;
  const themeName = String(theme || "classic").replace(/^\w/, (c) => c.toUpperCase());
  const items = [
    { key: "about", label: "About your school", target: "mpcAbout", done: aboutText.length >= 40,
      detail: aboutText.length >= 40 ? "Description added" : "Write a short description of your school" },
    { key: "contactInfo", label: "Phone & email", target: "mpcAbout", done: emails.length > 0 && phones.length > 0,
      detail: emails.length && phones.length ? `${emails.length} email${emails.length > 1 ? "s" : ""}, ${phones.length} phone${phones.length > 1 ? "s" : ""}` : "Add the school's phone and email" },
    { key: "photos", label: "Photos", target: "mpcGallery", done: imageCount > 0,
      detail: imageCount ? `${imageCount} photo${imageCount > 1 ? "s" : ""} on the website` : "Upload photos for the slideshow and gallery" },
    { key: "sections", label: "Website sections", target: "mwxSections", done: liveSections > 0,
      detail: liveSections ? `${liveSections} of 5 sections live` : "Add programs, leadership, FAQs and more" },
    { key: "contact", label: "Contact form", target: "mwxContact", done: Boolean(visible.contact),
      detail: visible.contact ? `Messages go to ${s.contact.notifyEmail}` : "Add your school email to receive messages" },
    { key: "design", label: "Layout & style", target: "mpcLayout", done: true,
      detail: `${LAYOUT_NAMES[layout] || "Traditional"} layout, ${themeName} style` },
    { key: "articles", label: "News & articles", target: "mpcArticles", done: articleCount > 0, optional: true,
      detail: articleCount ? `${articleCount} article${articleCount > 1 ? "s" : ""}` : "Optional - share school news" },
    { key: "registration", label: "Online registration", target: "mpcRegistration", done: Boolean(registration && registration.open), optional: true,
      detail: registration ? registration.message : "Optional" },
  ];
  const required = items.filter((i) => !i.optional);
  return {
    items,
    doneCount: required.filter((i) => i.done).length,
    totalCount: required.length,
    unreadMessages,
  };
}

module.exports = {
  SECTION_KEYS,
  PAGE_BLOCKS,
  registrationState,
  countUnreadMessages,
  buildWebsiteOverview,
  LIMITS,
  ensureWebsiteSchema,
  normalizeSettings,
  normalizeSection,
  getWebsiteSettings,
  saveWebsiteSection,
  visibleSections,
  SOCIAL_NETWORKS,
};
