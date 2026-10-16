"use strict";

// Everything a school website layout needs, in one plain object. Every layout
// (views/partials/website/*) reads from this, so the same content shows in
// all of them and only the design changes.

// Stored layout values (organization_dashboard.order_data.layout) -> design.
const LAYOUTS = [
  { value: "wireframe1", key: "classic", name: "Classic", description: "Full-width photo banner, centered sections in alternating bands." },
  { value: "wireframe2", key: "horizon", name: "Modern", description: "Split welcome with photos beside it, clean card sections." },
  { value: "wireframe3", key: "editorial", name: "Magazine", description: "Newspaper masthead, lead story, side column for events and notices." },
  { value: "wireframe4", key: "story", name: "Story", description: "Large photo opening, numbered chapters and an events timeline." },
  { value: "wireframe5", key: "campus", name: "Campus", description: "Side navigation with the school's details, focused content beside it." },
  { value: "wireframe6", key: "spotlight", name: "Spotlight", description: "Bold brand-color welcome beside your photos, sections in alternating rows." },
  { value: "wireframe7", key: "minimal", name: "Minimal", description: "Quiet and text-first: headings on the left, content on the right." },
  { value: "wireframe8", key: "mosaic", name: "Mosaic", description: "A grid of tiles: photos, welcome, facts, events and news side by side." },
];
const LAYOUT_VALUES = LAYOUTS.map((l) => l.value);

function layoutFor(value) {
  return LAYOUTS.find((l) => l.value === value) || LAYOUTS[0];
}

// Default order of the page's sections (the school can change it).
const DEFAULT_ORDER = [
  "quickFacts", "welcome", "about", "programs", "admissions", "gallery", "events",
  "announcements", "articles", "leadership", "achievements", "testimonials", "faq", "contact",
];

const DEFAULT_TITLES = {
  about: "About Our School",
  gallery: "Campus Gallery",
  events: "Upcoming Events",
  announcements: "Announcements",
  articles: "School News",
};

// Anchor ids the site menu links to (kept from the original page).
const ANCHORS = {
  gallery: "image-gallery",
  articles: "text-articles",
  events: "events",
  announcements: "announcements",
  about: "about-us",
  contact: "contact",
};

const clean = (value) => String(value == null ? "" : value).trim();
const list = (values) => (Array.isArray(values) ? values : []).map(clean).filter(Boolean);

function stripHtml(html) {
  return String(html || "").replace(/<[^>]*>/g, " ").replace(/&nbsp;/g, " ").replace(/\s+/g, " ").trim();
}

function initials(name) {
  return String(name || "")
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0].toUpperCase())
    .join("");
}

function dayStart(date) {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

function buildEvents(rows, now) {
  const today = dayStart(now);
  const events = (rows || [])
    .map((row) => {
      const date = row.event_date ? new Date(row.event_date) : null;
      if (!date || Number.isNaN(date.getTime())) return null;
      return {
        name: clean(row.name),
        details: clean(row.details),
        date,
        day: date.getDate(),
        month: date.toLocaleDateString("en-US", { month: "short" }),
        weekday: date.toLocaleDateString("en-US", { weekday: "short" }),
        year: date.getFullYear(),
        label: date.toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric", year: "numeric" }),
        isPast: dayStart(date) < today,
      };
    })
    .filter((e) => e && e.name);
  const upcoming = events.filter((e) => !e.isPast).sort((a, b) => a.date - b.date);
  const past = events.filter((e) => e.isPast).sort((a, b) => b.date - a.date);
  // Upcoming first; recent past ones fill in when there are few upcoming.
  return { upcoming, recent: past.slice(0, Math.max(0, 6 - upcoming.length)) };
}

function registrationInfo(org, now) {
  const start = org && org.registration_start_date ? new Date(org.registration_start_date) : null;
  const end = org && org.registration_end_date ? new Date(org.registration_end_date) : null;
  const open = Boolean(
    org && org.public_registration_enabled && org.organization_id && start && end &&
    start <= now && now < new Date(end.getFullYear(), end.getMonth(), end.getDate() + 1)
  );
  return {
    open,
    url: org ? `/common/publicRegister?organizationId=${org.organization_id}` : "",
    endLabel: end ? end.toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" }) : "",
  };
}

/**
 * @param {object} input
 *   orgDetails, aboutDetails, slideshowImages, galleryImages, texts, events,
 *   announcements, extras (visibleSections), page ({order,hidden,titles}),
 *   layout (stored value), now
 */
function buildSiteModel(input = {}) {
  const org = input.orgDetails || {};
  const about = input.aboutDetails || {};
  const extras = input.extras || {};
  const page = input.page || { order: [], hidden: [], titles: {} };
  const now = input.now || new Date();
  const layout = layoutFor(input.layout);

  const emails = list(about.emails);
  const phones = list(about.phones);
  const mottos = list(about.mottos);
  if (!emails.length && org.email) emails.push(clean(org.email));
  if (!phones.length && org.organization_phone) phones.push(clean(org.organization_phone));
  const motto = mottos[0] || clean(org.motto);
  const address = clean((extras.contact && extras.contact.address) ||
    [org.organization_address, org.organization_province, org.organization_country].map(clean).filter(Boolean).join(", "));

  const hero = extras.hero || { enabled: true, kicker: "", tagline: "" };
  const announcements = (input.announcements || [])
    .filter((a) => a && (a.visibility === "public" || a.visibility === "both") && clean(a.message))
    .map((a) => clean(a.message));
  const gallery = (input.galleryImages || [])
    .filter((img) => img && img.image_url)
    .map((img) => ({ url: img.image_url, caption: clean(img.caption) }));
  const slides = (input.slideshowImages || [])
    .filter((img) => img && img.image_url)
    .map((img) => ({ url: img.image_url, caption: clean(img.caption) }));
  const articles = (input.texts || [])
    .filter((t) => t && (clean(t.heading) || stripHtml(t.paragraph)))
    .map((t) => {
      const plain = stripHtml(t.paragraph);
      return {
        title: clean(t.heading),
        html: t.paragraph || "",
        excerpt: plain.length > 220 ? `${plain.slice(0, 217).replace(/\s+\S*$/, "")}…` : plain,
        readMinutes: Math.max(1, Math.round(plain.split(/\s+/).length / 200)),
      };
    });
  const events = buildEvents(input.events, now);

  const has = {
    quickFacts: Boolean(extras.quickFacts),
    welcome: Boolean(extras.welcome),
    about: Boolean(clean(org.aboutus) || motto || emails.length || phones.length || address),
    programs: Boolean(extras.programs),
    admissions: Boolean(extras.admissions),
    gallery: gallery.length > 0,
    events: events.upcoming.length + events.recent.length > 0,
    announcements: announcements.length > 0,
    articles: articles.length > 0,
    leadership: Boolean(extras.leadership),
    achievements: Boolean(extras.achievements),
    testimonials: Boolean(extras.testimonials),
    faq: Boolean(extras.faq),
    contact: Boolean(extras.contact),
  };
  const hidden = new Set(Array.isArray(page.hidden) ? page.hidden : []);
  const chosen = (Array.isArray(page.order) ? page.order : []).filter((k) => DEFAULT_ORDER.includes(k));
  const order = [...chosen, ...DEFAULT_ORDER.filter((k) => !chosen.includes(k))];
  const blocks = order.filter((key) => has[key] && !hidden.has(key));

  const titles = {
    ...DEFAULT_TITLES,
    quickFacts: "At a Glance",
    welcome: extras.welcome ? extras.welcome.title : "",
    programs: extras.programs ? extras.programs.title : "",
    admissions: extras.admissions ? extras.admissions.title : "",
    leadership: extras.leadership ? extras.leadership.title : "",
    achievements: extras.achievements ? extras.achievements.title : "",
    testimonials: extras.testimonials ? extras.testimonials.title : "",
    faq: extras.faq ? extras.faq.title : "",
    contact: extras.contact ? extras.contact.title : "Contact Us",
    ...(page.titles || {}),
  };

  return {
    layout: layout.key,
    layoutName: layout.name,
    school: {
      id: org.organization_id,
      name: clean(org.organization_name) || "Our School",
      initials: initials(org.organization_name),
      logo: clean(org.logo),
      motto,
      about: clean(org.aboutus),
      aboutImage: extras.about || null,
      emails,
      phones,
      address,
    },
    banner: {
      show: hero.enabled !== false,
      kicker: hero.kicker || "Official School Website",
      tagline: hero.tagline || motto,
    },
    slides,
    registration: registrationInfo(org, now),
    gallery,
    articles,
    events,
    announcements,
    extras,
    social: Array.isArray(extras.social) ? extras.social : [],
    blocks,
    anchors: ANCHORS,
    titles,
    year: now.getFullYear(),
  };
}

module.exports = { LAYOUTS, LAYOUT_VALUES, layoutFor, buildSiteModel, stripHtml };
