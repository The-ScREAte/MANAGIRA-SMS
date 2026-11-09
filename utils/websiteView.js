"use strict";

// Everything a school website layout needs, in one plain object. Every layout
// (views/partials/website/*) reads from this, so the same content shows in
// all of them and only the design changes.

// Stored layout values (organization_dashboard.order_data.layout) -> design.
// group: where the design picker lists it (standard, 3d, emblem).
// A design with a "feature" shows only where that feature is on (utils/shards/features.js);
// motion: true designs animate in 3D as visitors scroll (public/js/schoolSiteMotion.js);
// emblem: true designs show the school's emblem as a watermark (utils/websiteEmblems.js);
// base: an emblem design drawn on another design's page structure.
const DESIGNS_FEATURE = "website_designs";
const LAYOUTS = [
  { value: "wireframe9", key: "academy", name: "Academy", description: "A full-screen opening, next steps and big numbers." },
  { value: "wireframe1", key: "classic", name: "Classic", description: "A wide photo banner and centered sections." },
  { value: "wireframe2", key: "horizon", name: "Modern", description: "Your welcome beside your photos, in clean cards." },
  { value: "wireframe3", key: "editorial", name: "Magazine", description: "A newspaper look with a lead story." },
  { value: "wireframe4", key: "story", name: "Story", description: "A large photo opening and numbered chapters." },
  { value: "wireframe5", key: "campus", name: "Campus", description: "A side menu with your school's details." },
  { value: "wireframe6", key: "spotlight", name: "Spotlight", description: "A bold welcome in your color beside your photos." },
  { value: "wireframe7", key: "minimal", name: "Minimal", description: "Quiet and text-first." },
  { value: "wireframe8", key: "mosaic", name: "Mosaic", description: "A grid of tiles: photos, facts and news." },
  { value: "wireframe10", key: "glide", name: "Glide", group: "3d", feature: DESIGNS_FEATURE, motion: true, style: "Simple", description: "Calm and simple. Your photo tilts into place as visitors scroll." },
  { value: "wireframe11", key: "prism", name: "Prism", group: "3d", feature: DESIGNS_FEATURE, motion: true, style: "Modern", description: "Glass panels, a 3D photo stack and a photo wall that straightens." },
  { value: "wireframe12", key: "panorama", name: "Panorama", group: "3d", feature: DESIGNS_FEATURE, motion: true, style: "Bold", description: "Full-screen scenes and a gallery that sweeps sideways." },
  { value: "wireframe13", key: "orbit", base: "prism", name: "Orbit", group: "3d", feature: DESIGNS_FEATURE, motion: true, emblem: true, style: "Emblem", description: "Your emblem floats in 3D behind glass and turns as visitors scroll." },
  { value: "wireframe14", key: "crest", base: "classic", name: "Crest", group: "emblem", feature: DESIGNS_FEATURE, emblem: true, style: "Classic", description: "Your emblem large behind the school's name, with a soft pattern." },
  { value: "wireframe15", key: "mascot", base: "spotlight", name: "Mascot", group: "emblem", feature: DESIGNS_FEATURE, emblem: true, style: "Spirit", description: "A bold welcome in your color with your mascot beside it." },
];
LAYOUTS.forEach((l) => { if (!l.group) l.group = "standard"; });
const LAYOUT_VALUES = LAYOUTS.map((l) => l.value);
// Whole photos (never cropped; a soft blur of the photo fills any spare space) come with the same release.
const WHOLE_PHOTOS_FEATURE = DESIGNS_FEATURE;
const LAYOUT_GROUPS = [
  { key: "standard", name: "Standard", note: "Clean, classic pages." },
  { key: "3d", name: "3D", note: "Smooth 3D movement as visitors scroll." },
  { key: "emblem", name: "Emblem", note: "Your mascot or symbol as a soft watermark." },
];

const everyFeature = () => true;
// The designs a school can use: every design, less those behind a feature that is off for it.
function layoutsFor(isOn = everyFeature) {
  return LAYOUTS.filter((l) => !l.feature || isOn(l.feature));
}

function layoutFor(value, isOn = everyFeature) {
  return layoutsFor(isOn).find((l) => l.value === value) || LAYOUTS.find((l) => l.value === "wireframe1");
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

// The emblem an emblem design shows: one of ours, the school's logo or its own image.
// Image links go into the page's CSS, so only plain https links are used.
const cssSafeUrl = (url) => (/^https:\/\/[^\s"'()<>\\]+$/i.test(String(url || "")) ? String(url) : "");
function emblemFor(setting, org) {
  const s = setting || {};
  const placement = s.placement === "single" ? "single" : "pattern";
  const imageUrl = s.kind === "image" ? cssSafeUrl(s.imageUrl) : (s.kind === "logo" ? cssSafeUrl(clean(org.logo)) : "");
  if (imageUrl) return { kind: "image", imageUrl, placement, isLogo: s.kind === "logo" };
  const emblems = require("./websiteEmblems");
  const icon = emblems.isEmblem(s.icon) ? s.icon : emblems.DEFAULT_EMBLEM;
  return { kind: "icon", icon, placement, svg: (prefix) => emblems.emblemSvg(icon, { idPrefix: prefix }), maskUrl: emblems.emblemMaskUrl(icon), patternUrl: emblems.emblemPatternUrl(icon) };
}

/**
 * @param {object} input
 *   orgDetails, aboutDetails, slideshowImages, galleryImages, texts, events,
 *   announcements, extras (visibleSections), page ({order,hidden,titles}),
 *   layout (stored value), now, isOn (feature key -> on for this school)
 */
function buildSiteModel(input = {}) {
  const org = input.orgDetails || {};
  const about = input.aboutDetails || {};
  const extras = input.extras || {};
  const page = input.page || { order: [], hidden: [], titles: {} };
  const now = input.now || new Date();
  const isOn = typeof input.isOn === "function" ? input.isOn : () => false;
  const layout = layoutFor(input.layout, isOn);

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
  // Photos and videos (videos carry a poster frame to show before they play).
  const media = (img) => ({
    url: img.image_url,
    caption: clean(img.caption),
    type: img.media_type === "video" || /\.(mp4|webm|mov)(\?|$)/i.test(img.image_url) ? "video" : "image",
    poster: clean(img.poster_url),
  });
  const gallery = (input.galleryImages || []).filter((img) => img && img.image_url).map(media);
  const slides = (input.slideshowImages || []).filter((img) => img && img.image_url).map(media);
  // A still photo for backgrounds (stats band, closing banner): first photo found.
  const stills = slides.concat(gallery).map((m) => (m.type === "video" ? m.poster : m.url)).filter(Boolean);
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
    // The page structure, and the design drawn on it (the same, unless the design has a base).
    layout: layout.base || layout.key,
    design: layout.key,
    layoutName: layout.name,
    motion: Boolean(layout.motion),
    wholePhotos: Boolean(layout.motion) || isOn(WHOLE_PHOTOS_FEATURE),
    emblem: layout.emblem ? emblemFor(extras.emblem, org) : null,
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
    stills,
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

module.exports = { LAYOUTS, LAYOUT_GROUPS, LAYOUT_VALUES, WHOLE_PHOTOS_FEATURE, DESIGNS_FEATURE, layoutsFor, layoutFor, buildSiteModel, stripHtml };
