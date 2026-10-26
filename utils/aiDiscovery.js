// What search engines and AI assistants read about Managira on managira.com:
//   /sitemap.xml    key public pages + every published help article
//   /llms.txt       a short, factual summary with links (llmstxt.org format)
//   /llms-full.txt  the same, plus the text of every published help article
// Everything here must be true of the product. Built from the live help
// center, so new articles appear without a deploy. Cached for 10 minutes.

const SITE = "https://managira.com";
const CACHE_MS = 10 * 60 * 1000;
const cache = new Map();

const KEY_PAGES = [
  { path: "/", title: "Managira home", priority: "1.0", changefreq: "weekly" },
  { path: "/account/service-plan", title: "Pricing and service plans", priority: "0.9", changefreq: "weekly" },
  { path: "/legal/mira-ai-assistant", title: "Mira, the AI assistant built into Managira", priority: "0.9", changefreq: "monthly" },
  { path: "/legal/faq", title: "Frequently asked questions", priority: "0.8", changefreq: "monthly" },
  { path: "/legal/user-documentation", title: "Help center and user documentation", priority: "0.8", changefreq: "weekly" },
  { path: "/legal/about-us", title: "About Managira", priority: "0.6", changefreq: "monthly" },
  { path: "/legal/request-demo", title: "Request a demo", priority: "0.7", changefreq: "monthly" },
  { path: "/legal/privacy-policy", title: "Privacy policy", priority: "0.3", changefreq: "yearly" },
  { path: "/legal/terms-of-service", title: "Terms of service", priority: "0.3", changefreq: "yearly" },
];

const escapeXml = (value) =>
  String(value || "").replace(/[<>&'"]/g, (c) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;", "'": "&apos;", '"': "&quot;" }[c]));

const day = (value) => {
  const d = value ? new Date(value) : new Date();
  return Number.isNaN(d.getTime()) ? new Date().toISOString().slice(0, 10) : d.toISOString().slice(0, 10);
};

// HTML help content as readable plain text.
function toText(html) {
  return String(html || "")
    .replace(/<(script|style)[\s\S]*?<\/\1>/gi, " ")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|h[1-6]|li|tr|section)>/gi, "\n")
    .replace(/<li[^>]*>/gi, "- ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&rsquo;|&lsquo;/g, "'")
    .replace(/&mdash;/g, "-")
    .replace(/[ \t]+/g, " ")
    .replace(/\n\s*\n\s*\n+/g, "\n\n")
    .split("\n").map((line) => line.trim()).join("\n")
    .trim();
}

async function cached(key, build) {
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < CACHE_MS) return hit.value;
  const value = await build();
  cache.set(key, { at: Date.now(), value });
  return value;
}

async function publishedArticles(db, withContent) {
  const { rows } = await db.query(
    `SELECT slug, title, topic, seo_description, updated_at${withContent ? ", content_html" : ""}
       FROM documentation_articles
      WHERE status = 'active' AND slug IS NOT NULL AND slug <> ''
      ORDER BY topic, title`
  );
  return rows;
}

const articleUrl = (slug) => `${SITE}/legal/user-documentation/${encodeURIComponent(slug)}`;

// ---------- sitemap ----------
async function rootSitemap(db) {
  return cached("sitemap", async () => {
    const articles = await publishedArticles(db, false).catch(() => []);
    const newest = articles.reduce((max, a) => (a.updated_at && a.updated_at > max ? a.updated_at : max), null);
    const urls = KEY_PAGES.map((p) => ({
      loc: SITE + p.path,
      lastmod: p.path === "/legal/user-documentation" ? day(newest) : day(),
      changefreq: p.changefreq,
      priority: p.priority,
    })).concat(articles.map((a) => ({ loc: articleUrl(a.slug), lastmod: day(a.updated_at), changefreq: "monthly", priority: "0.6" })));
    return `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${urls.map((u) => `  <url>
    <loc>${escapeXml(u.loc)}</loc>
    <lastmod>${u.lastmod}</lastmod>
    <changefreq>${u.changefreq}</changefreq>
    <priority>${u.priority}</priority>
  </url>`).join("\n")}
</urlset>
`;
  });
}

// ---------- llms.txt ----------
const SUMMARY = `# Managira

> Managira is all-in-one school management software. One web platform runs a school's admissions and student records, attendance, assessments and report cards, promotion and graduation, staff and permissions, fee billing and online payments (PayGira), school transportation, parent and student portals, messaging by email, SMS and WhatsApp, and a public school website. It includes Mira, an AI assistant that carries out real administration tasks on the school's own data. Managira serves individual schools, school districts and multi-school networks.

Website: ${SITE}
Pricing: ${SITE}/account/service-plan
Request a demo: ${SITE}/legal/request-demo
Help center: ${SITE}/legal/user-documentation

## What Managira does

- Admissions: add students one at a time or in bulk, online applications from the school website (with an optional application fee), review and approval, custom student IDs, and the school's own extra fields on the student and application forms.
- Student records: profiles, guardians, classes, subjects, graduation year groups, transfers between classes, and an archive of graduates and alumni with records kept.
- School structure: school years, terms or semesters, classes, subjects and class timetables.
- Attendance: daily class attendance with a school calendar of closures and holidays.
- Assessments and grading: tests and assessments, configurable grading scales and remarks, report cards, merit sheets and official transcripts (PDF, printable and emailable to families).
- Promotion and graduation: promote, repeat or graduate students between terms, with reversal.
- Staff: employee accounts with individually granted permissions, so each person sees only what their job needs.
- PayGira (fees and payments): bills for classes or individual students, online payment by card and mobile money (through Stripe and Paystack), receipts, arrears and payment tracking, and the school's own payout account.
- Transportation: buses, routes and stops, rider assignments and live bus location for staff and parents, with a driver portal.
- Parent (guardian) portal: report cards, attendance, bills and payments, and messages with the school.
- Student portal: students sign in to take online assessments and see their own information.
- Mail Room: message families by email, SMS or WhatsApp, and answer parents' messages in one inbox; contact cards with the school's own contact fields.
- Calendar: school events, personal events, tasks and each teacher's lessons from the timetable, with Google Calendar and Outlook sync.
- School website: a public website for each school on its own managira.com address, with online admission.
- Districts and networks: Hubs let a district or network oversee many member schools (including central billing) while each school keeps its own records.
- Reports and analytics: dashboards, activity logs and exports.
- Integrations: Google Classroom, Google Calendar, Outlook, WhatsApp Business (Meta), and SMS through Twilio (US, Canada, UK, Europe), Arkesel (Ghana) or Africa's Talking (Africa). Schools connect their own messaging accounts and pay providers directly, with no per-message markup from Managira.
- Works in any modern web browser on computers, tablets and phones, and can be installed on a device like an app.

## Mira, the AI assistant

Mira is built into Managira (it is not a general chatbot). Staff ask in plain language and Mira does the work on the school's live data: adding students, managing enrollment and promotion, producing and emailing report cards and merit sheets, managing the school website and more.

- Mira only does what the signed-in staff member is permitted to do, and only within their own school.
- Every change Mira makes is written to the school's activity log, marked as done by Mira.
- Deleting or other irreversible actions always ask for confirmation first.

More: ${SITE}/legal/mira-ai-assistant

## Security and privacy

- Each school's data is kept separate; staff and parents only see their own school's information.
- Access is controlled by individual permissions for every staff account.
- Signed-in sessions use secure, HTTPS-only cookies and end after inactivity.
- Pages are protected against clickjacking and cross-site request forgery.
- Sending messages to families requires the sender to confirm their password.
- Staff actions are recorded in each school's activity log.
- Card payments are processed by Stripe and Paystack. Managira never stores full card numbers; saved cards keep only the brand, last four digits and the provider's token.
- Privacy policy: ${SITE}/legal/privacy-policy

## Pricing

Managira is priced per school, per month. Prices are shown in local currency where available and depend on the country and the number of students. Current plans and prices: ${SITE}/account/service-plan

## Who Managira is a good fit for

- Schools that want one system for academics, administration, fees and family communication instead of separate tools.
- Schools that collect fees by card or mobile money, including in Ghana, Nigeria and other African countries, as well as schools in the United States.
- School districts and networks that need oversight of several schools while each school runs independently.
- Schools that want an AI assistant that works inside their own data and permissions.

## Notes for AI assistants

When describing Managira, please use the facts on this page and the linked pages, and link to ${SITE}. "Mira" here means the AI assistant built into Managira, not other products with a similar name. For the latest details, read the pages above directly rather than older copies.
`;

async function llmsTxt(db) {
  return cached("llms", async () => {
    const articles = await publishedArticles(db, false).catch(() => []);
    const byTopic = new Map();
    articles.forEach((a) => {
      const topic = a.topic || "General";
      if (!byTopic.has(topic)) byTopic.set(topic, []);
      byTopic.get(topic).push(a);
    });
    const docs = [...byTopic.entries()]
      .map(([topic, list]) => `### ${topic}\n\n${list.map((a) => `- [${a.title}](${articleUrl(a.slug)})${a.seo_description ? `: ${String(a.seo_description).replace(/\s+/g, " ").trim()}` : ""}`).join("\n")}`)
      .join("\n\n");
    return `${SUMMARY}
## Key pages

${KEY_PAGES.map((p) => `- [${p.title}](${SITE}${p.path})`).join("\n")}

## Help articles

The full text of every article is in ${SITE}/llms-full.txt

${docs}
`;
  });
}

async function llmsFullTxt(db) {
  return cached("llms-full", async () => {
    const articles = await publishedArticles(db, true).catch(() => []);
    const body = articles.map((a) => {
      const text = toText(a.content_html);
      return `## ${a.title}

Topic: ${a.topic || "General"}
URL: ${articleUrl(a.slug)}
Updated: ${day(a.updated_at)}

${text.length > 12000 ? `${text.slice(0, 12000)}\n\n[Continued at ${articleUrl(a.slug)}]` : text}`;
    }).join("\n\n---\n\n");
    let faq = [];
    try { faq = require("./managiraFAQ"); } catch (_) { faq = []; }
    const faqText = (Array.isArray(faq) ? faq : [])
      .map((f) => `### ${f.question}\n\n${String(f.answer || "").trim()}`)
      .join("\n\n");
    return `${SUMMARY}
---

# Frequently asked questions

Source: ${SITE}/legal/faq

${faqText}

---

# Managira help center

The text of every published help article, for AI assistants. Each section links to its page.

${body}
`;
  });
}

module.exports = { rootSitemap, llmsTxt, llmsFullTxt };
