"use strict";

// The help center's articles, written in code so every push keeps them current
// (utils/documentationCenter.js syncs them into documentation_articles by slug).
// Topics are listed in the order the sidebar shows them; articles in a topic by `order`.
const { renderArticle, imagesOf } = require("./render");

const TOPICS = [
  { name: "Getting started", icon: "rocket", blurb: "Set up your school and find your way around." },
  { name: "Account & sign-in", icon: "key", blurb: "Signing in, passwords, single sign-on and sign-in rules." },
  { name: "School setup", icon: "building", blurb: "School years, terms, classes, subjects and enrollment." },
  { name: "Students & admissions", icon: "graduation", blurb: "Adding students, online admission, transfers and promotion." },
  { name: "Parents & families", icon: "family", blurb: "Parent accounts, linking children and pickup details." },
  { name: "Parent portal", icon: "home", blurb: "What parents see and do: grades, tests, messages and settings." },
  { name: "Student portal", icon: "laptop", blurb: "What students see, taking tests and seeing results." },
  { name: "Staff & permissions", icon: "badge", blurb: "Employee accounts, roles and what each person can do." },
  { name: "Classroom & attendance", icon: "board", blurb: "The class page, attendance and the pickup list." },
  { name: "Assessments & grades", icon: "check", blurb: "Tests, question sets, marking and grading scales." },
  { name: "Reports & analytics", icon: "chart", blurb: "Report cards, transcripts, Report Builder and dashboards." },
  { name: "Calendar, events & activities", icon: "calendar", blurb: "Events, announcements, activities, tasks and calendar sync." },
  { name: "Communication", icon: "message", blurb: "Mail Room, text messages, WhatsApp and email notifications." },
  { name: "School website", icon: "globe", blurb: "Your public website: designs, sections, photos and admissions." },
  { name: "Transportation", icon: "bus", blurb: "Buses, routes, the driver app and live bus tracking." },
  { name: "PayGira & payments", icon: "wallet", blurb: "Bills, online payments, receipts and arrears." },
  { name: "Integrations & API", icon: "plug", blurb: "Connect other tools, service accounts and the Managira API." },
  { name: "Mira AI assistant", icon: "sparkle", blurb: "What Mira can do for staff, and how it keeps data safe." },
  { name: "Districts & hubs", icon: "network", blurb: "Run many schools together as a district or network." },
  { name: "Billing & subscriptions", icon: "card", blurb: "Your Managira plan and renewals." },
];

const ARTICLES = [
  ...require("./articles/gettingStarted"),
  ...require("./articles/account"),
  ...require("./articles/schoolSetup"),
  ...require("./articles/students"),
  ...require("./articles/families"),
  ...require("./articles/portals"),
  ...require("./articles/staff"),
  ...require("./articles/classroom"),
  ...require("./articles/assessments"),
  ...require("./articles/reports"),
  ...require("./articles/calendar"),
  ...require("./articles/communication"),
  ...require("./articles/website"),
  ...require("./articles/transportation"),
  ...require("./articles/paygira"),
  ...require("./articles/integrations"),
  ...require("./articles/mira"),
  ...require("./articles/hubs"),
  ...require("./articles/billing"),
];

// Older addresses of the same guide: they answer with a permanent redirect, and the
// old copies are moved to draft so search engines keep one page per subject.
const REDIRECTS = {
  "create-school-years-classes-terms-and-set-the-current-term": "create-school-years-terms-and-set-the-current-term",
  "create-and-manage-employee": "create-and-manage-employee-accounts-and-permissions",
  "email-other-notifications-reference": "email-notifications-reference",
  "promoting-repetition-graduation": "promote-students-and-manage-graduation",
  "invite-schools-into-a-hub-and-manage-multi-school-oversight": "school-districts-education-hubs",
  "collection-through-paygira": "set-up-paygira-bills-collections-and-guardian-payments",
};

const topicIndex = (name) => {
  const at = TOPICS.findIndex((topic) => topic.name === name);
  return at === -1 ? TOPICS.length : at;
};

const ordered = ARTICLES.slice().sort((a, b) => topicIndex(a.topic) - topicIndex(b.topic) || (a.order || 0) - (b.order || 0) || a.title.localeCompare(b.title));
const bySlug = new Map(ordered.map((article) => [article.slug, article]));

// What the help center stores for each article.
const rendered = new Map();
function syncRows() {
  return ordered.map((article) => {
    if (!rendered.has(article.slug)) rendered.set(article.slug, renderArticle(article));
    return {
      slug: article.slug,
      title: article.title,
      topic: article.topic,
      subtopic: null,
      status: "active",
      featured: Boolean(article.featured),
      tags: article.tags || [],
      seoDescription: article.summary,
      contentHtml: rendered.get(article.slug),
      media: [],
    };
  });
}

// Previous and next guide in the reading order, and the guides an article points to.
function neighbours(slug) {
  const at = ordered.findIndex((article) => article.slug === slug);
  if (at === -1) return { previous: null, next: null };
  return { previous: ordered[at - 1] || null, next: ordered[at + 1] || null };
}
const relatedOf = (slug) => ((bySlug.get(slug) || {}).related || []).map((other) => bySlug.get(other)).filter(Boolean);
const topicOf = (name) => TOPICS.find((topic) => topic.name === name) || null;

module.exports = { TOPICS, ARTICLES: ordered, REDIRECTS, bySlug, syncRows, neighbours, relatedOf, topicOf, topicIndex, imagesOf };
