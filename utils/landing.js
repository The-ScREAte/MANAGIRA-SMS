"use strict";

// What managira.com's public pages share (views/home): the menus and the icons. Both the
// desktop menus and the phone menu are drawn from MENUS, so they never drift apart.
const product = (category, item) => `/legal/product-category?category=${category}${item ? `&item=${item}` : ""}`;

const MENUS = [
  {
    key: "platform", label: "Platform", wide: true,
    groups: [
      { title: "Student success", image: "/images/site/menu-students.webp", links: [
        { label: "Testing Room", href: product("student", "testing-room"), note: "Online exams, straight to records" },
        { label: "Report cards", href: product("student", "detailed-reports"), note: "Generate, print or email" },
        { label: "Transcripts", href: product("student", "official-transcript"), note: "Official academic history" },
        { label: "Timetable", href: product("student", "time-table"), note: "Classes and periods, organized" },
      ], all: { label: "All student features", href: product("student") } },
      { title: "Family connections", image: "/images/site/menu-families.webp", links: [
        { label: "Parent Portal", href: product("family", "parent-portal"), note: "Grades, fees and updates" },
        { label: "Communication", href: product("family", "communication"), note: "Email, text and WhatsApp" },
        { label: "School website", href: product("family", "school-website"), note: "Your public presence" },
        { label: "Student schedule plan", href: product("family", "student-schedule-plan"), note: "Routines families can follow" },
      ], all: { label: "All family features", href: product("family") } },
      { title: "Operations", image: "/images/site/menu-operations.webp", links: [
        { label: "PayGira", href: product("operational", "paygira"), note: "Fees and payments" },
        { label: "Hub management", href: product("operational", "hub-management"), note: "Many schools, one dashboard" },
        { label: "Digest notifications", href: product("operational", "digest-notification"), note: "Scheduled updates" },
        { label: "Questions setter", href: product("operational", "questions-setter"), note: "Question banks for exams" },
      ], all: { label: "All operational features", href: product("operational") } },
    ],
  },
  {
    key: "solutions", label: "Solutions",
    groups: [{ links: [
      { label: "For school administrators", href: "/#administrators", note: "Run the whole school" },
      { label: "For students", href: "/#students", note: "One portal for learning" },
      { label: "For parents", href: "/#parents", note: "Every family in the loop" },
      { label: "For districts and hubs", href: product("operational", "hub-management"), note: "Coordinate many schools" },
    ] }],
  },
  {
    key: "mira", label: "Mira",
    feature: { image: "/images/site/mira-wordmark.webp", title: "Your school's AI assistant", text: "Ask a question or hand it a task. Mira works inside your school, within your permissions.", href: "/legal/mira-ai-assistant", cta: "Meet Mira" },
    groups: [{ links: [
      { label: "What Mira can do", href: "/legal/mira-ai-assistant", note: "Questions, tasks and drafts" },
      { label: "Capabilities", href: "/legal/user-documentation/mira-ai-capabilities", note: "Everything Mira can help with" },
      { label: "Getting started", href: "/legal/user-documentation/mira-ai-assistant", note: "Turn Mira on for your school" },
    ] }],
  },
  {
    key: "resources", label: "Resources",
    groups: [{ links: [
      { label: "Help center", href: "/legal/help", note: "Answers and support" },
      { label: "Documentation", href: "/legal/user-documentation", note: "Setup and usage guides" },
      { label: "FAQ", href: "/legal/faq", note: "Common questions" },
    ] }],
  },
  {
    key: "company", label: "Company",
    groups: [{ links: [
      { label: "About us", href: "/legal/about-us", note: "What Managira stands for" },
      { label: "Careers", href: "/legal/employment", note: "Work with us" },
      { label: "Give to Managira", href: "/legal/donations", note: "Support our mission" },
    ] }],
  },
  { key: "pricing", label: "Pricing", href: "/account/service-plan" },
];

const ICONS = {
  chevron: '<path d="m6 9 6 6 6-6"/>',
  arrow: '<path d="M5 12h14"/><path d="m12 5 7 7-7 7"/>',
  check: '<path d="M20 6 9 17l-5-5"/>',
  play: '<polygon points="7 4 20 12 7 20 7 4"/>',
  admissions: '<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M19 8v6"/><path d="M22 11h-6"/>',
  attendance: '<rect x="3" y="4" width="18" height="18" rx="2"/><path d="M16 2v4"/><path d="M8 2v4"/><path d="M3 10h18"/><path d="m9 16 2 2 4-4"/>',
  exam: '<path d="M9 11l3 3L22 4"/><path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11"/>',
  report: '<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6"/><path d="M8 13h8"/><path d="M8 17h5"/>',
  chart: '<path d="M3 3v18h18"/><path d="M7 15l4-4 3 3 5-6"/>',
  wallet: '<rect x="2" y="5" width="20" height="14" rx="2"/><path d="M2 10h20"/><path d="M16 15h2"/>',
  bus: '<path d="M8 6v6"/><path d="M15 6v6"/><path d="M2 12h19.6"/><path d="M18 18h3s.5-1.7.8-2.8c.1-.4.2-.8.2-1.2 0-.4-.1-.8-.2-1.2l-1.4-5C20.1 6.8 19.1 6 18 6H4a2 2 0 0 0-2 2v10h3"/><circle cx="7" cy="18" r="2"/><path d="M9 18h5"/><circle cx="16" cy="18" r="2"/>',
  message: '<path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>',
  clock: '<circle cx="12" cy="12" r="10"/><path d="M12 6v6l4 2"/>',
  shield: '<path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/><path d="m9 12 2 2 4-4"/>',
  device: '<rect x="5" y="2" width="14" height="20" rx="2"/><path d="M12 18h.01"/>',
  heart: '<path d="M19 14c1.49-1.46 3-3.21 3-5.5A5.5 5.5 0 0 0 16.5 3c-1.76 0-3 .5-4.5 2-1.5-1.5-2.74-2-4.5-2A5.5 5.5 0 0 0 2 8.5c0 2.3 1.5 4.05 3 5.5l7 7z"/>',
  sparkle: '<path d="M12 3l1.9 5.8L20 10.7l-6.1 1.9L12 18.5l-1.9-5.9L4 10.7l6.1-1.9z"/>',
  speak: '<path d="M7.9 20A9 9 0 1 0 4 16.1L2 22z"/><path d="M8 12h.01"/><path d="M12 12h.01"/><path d="M16 12h.01"/>',
  draft: '<path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z"/>',
  calendar: '<rect x="3" y="4" width="18" height="18" rx="2"/><path d="M16 2v4"/><path d="M8 2v4"/><path d="M3 10h18"/>',
  bolt: '<path d="M13 2 3 14h9l-1 8 10-12h-9z"/>',
  lock: '<rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/>',
  key: '<circle cx="7.5" cy="15.5" r="5.5"/><path d="m21 2-9.6 9.6"/><path d="m15.5 7.5 3 3L22 7l-3-3"/>',
  stairs: '<path d="M3 20h5v-5h5v-5h5V5h3"/>',
  book: '<path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"/><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z"/>',
  food: '<path d="M3 2v7c0 1.1.9 2 2 2h4a2 2 0 0 0 2-2V2"/><path d="M7 2v20"/><path d="M21 15V2a5 5 0 0 0-5 5v6c0 1.1.9 2 2 2h3zm0 0v7"/>',
  health: '<path d="M22 12h-4l-3 9L9 3l-3 9H2"/>',
  shirt: '<path d="M20.38 3.46 16 2a4 4 0 0 1-8 0L3.62 3.46a2 2 0 0 0-1.34 2.23l.58 3.47a1 1 0 0 0 .99.84H6v10c0 1.1.9 2 2 2h8a2 2 0 0 0 2-2V10h2.15a1 1 0 0 0 .99-.84l.58-3.47a2 2 0 0 0-1.34-2.23z"/>',
  trip: '<path d="M2 20h20"/><path d="m5 20 7-14 7 14"/><path d="M12 6V2"/><path d="m12 2 5 2-5 2"/>',
  trophy: '<path d="M6 9H4.5a2.5 2.5 0 0 1 0-5H6"/><path d="M18 9h1.5a2.5 2.5 0 0 0 0-5H18"/><path d="M4 22h16"/><path d="M10 14.66V17c0 .55-.47.98-.97 1.21C7.85 18.75 7 20.24 7 22"/><path d="M14 14.66V17c0 .55.47.98.97 1.21C16.15 18.75 17 20.24 17 22"/><path d="M18 2H6v7a6 6 0 0 0 12 0V2Z"/>',
  plus: '<path d="M12 5v14"/><path d="M5 12h14"/>',
  code: '<path d="m16 18 6-6-6-6"/><path d="m8 6-6 6 6 6"/>',
  globe: '<circle cx="12" cy="12" r="10"/><path d="M2 12h20"/><path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/>',
  network: '<rect x="9" y="2" width="6" height="6" rx="1"/><rect x="2" y="16" width="6" height="6" rx="1"/><rect x="16" y="16" width="6" height="6" rx="1"/><path d="M5 16v-3h14v3"/><path d="M12 13V8"/>',
};

function icon(name, size = 20) {
  return `<svg class="lp-icon" width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICONS[name] || ""}</svg>`;
}

// A partner's mark and name, in the page's own colour. A key from utils/brandMarks.js draws its
// mark; any other text is shown as a name with a letter badge.
const MARKS = require("./brandMarks");
const MARK_NAMES = { google: "Google Workspace", airtel: "Airtel Money", vodafone: "Vodafone Cash", twilio: "Twilio SMS", amazonwebservices: "AWS" };
const escapeHtml = (text) => String(text).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
function brand(key, size = 20) {
  const mark = MARKS[key];
  const name = escapeHtml(mark ? MARK_NAMES[key] || mark.title : key);
  const art = mark
    ? `<svg class="lp-brand__mark" width="${size}" height="${size}" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="${mark.d}"/></svg>`
    : `<span class="lp-brand__badge" style="width:${size}px;height:${size}px" aria-hidden="true">${escapeHtml(String(key).trim().charAt(0))}</span>`;
  return `<span class="lp-brand">${art}<span>${name}</span></span>`;
}

// The new public look: everywhere in development; in production once new_landing is released.
function isNewLook() {
  return process.env.NODE_ENV !== "production" || require("./shards/features").isOn("new_landing");
}

module.exports = { MENUS, icon, product, brand, isNewLook };
