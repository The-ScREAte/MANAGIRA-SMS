// scripts/sendDeseretParentDigestSample.js
// Sends clean sample digests for parent, teacher, supervisor, and manager
// to one locked recipient.

require("dotenv").config();
const { sendEmailSafely, renderCleanEmail } = require("../utils/emailHelper");

const LOCKED_RECIPIENT = "bondahdean@gmail.com";
const argRecipient = String(process.argv[2] || "").trim().toLowerCase();

if (argRecipient && argRecipient !== LOCKED_RECIPIENT) {
  console.error(`[managira-sample] This script only sends to ${LOCKED_RECIPIENT}.`);
  process.exit(1);
}

const RECIPIENT = LOCKED_RECIPIENT;
const SCHOOL_NAME = "Managira International School";
const FOCUS_CLASS = "JSS1";
const PORTAL_URL = process.env.APP_BASE_URL || "http://localhost:4000";

const today = new Date();
const weekStart = new Date(today);
weekStart.setDate(today.getDate() - 6);
const threeWeekStart = new Date(today);
threeWeekStart.setDate(today.getDate() - 20);

function fmtDate(date) {
  return date.toLocaleDateString("en-US", {
    month: "short",
    day: "2-digit",
    year: "numeric",
  });
}

function recipientDisplayName(email) {
  const local = String(email || "").split("@")[0] || "Parent/Guardian";
  const cleaned = local.replace(/[._-]+/g, " ").trim();
  if (!cleaned) return "Parent/Guardian";
  return cleaned
    .split(/\s+/)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1).toLowerCase())
    .join(" ");
}

function renderTable(headers, rows) {
  const tableStyle = "width:100%;border-collapse:collapse;font-size:13px;margin:8px 0 4px;";
  const thStyle = "text-align:left;padding:8px 10px;background:#0f766e;color:#fff;font-weight:600;font-size:12px;";
  const tdStyle = "padding:8px 10px;border-bottom:1px solid #e5e7eb;color:#1f2937;";

  const head = headers.map((h) => `<th style=\"${thStyle}\">${h}</th>`).join("");
  const body = rows
    .map(
      (row, i) =>
        `<tr style=\"background:${i % 2 ? "#f8fafc" : "#ffffff"};\">${row
          .map((cell) => `<td style=\"${tdStyle}\">${cell}</td>`)
          .join("")}</tr>`
    )
    .join("");

  return `<table style=\"${tableStyle}\"><thead><tr>${head}</tr></thead><tbody>${body}</tbody></table>`;
}

function parentDigestHtml() {
  const childRows = [
    [
      "<strong>Daniel Okoro</strong>",
      `${FOCUS_CLASS} - Gold`,
      "Strong attendance this week",
      "Strong position in class assessments",
      "Steady classroom momentum this week.",
    ],
    [
      "<strong>Deborah Okoro</strong>",
      `${FOCUS_CLASS} - Gold`,
      "Attendance context shared from the last 3 weeks",
      "Assessment profile is still being built",
      "No disruptive alert this week; routines are stable.",
    ],
  ];

  return renderCleanEmail({
    title: SCHOOL_NAME,
    showTitle: false,
    greeting: `Hello ${recipientDisplayName(RECIPIENT)},`,
    paragraphs: [
      `Here is your update from ${SCHOOL_NAME}.`,
      `<h3 style=\"margin:18px 0 6px;font-size:15px;color:#0f172a;\">Your Children</h3>${renderTable(
        ["Child", "Class", "Attendance Snapshot", "Academic Update", "This Week"],
        childRows
      )}`,
    ],
    details: [
      { label: "School", value: SCHOOL_NAME },
      { label: "Weekly window", value: `${fmtDate(weekStart)} to ${fmtDate(today)}` },
      { label: "Quiet-week context", value: `${fmtDate(threeWeekStart)} to ${fmtDate(today)}` },
    ],
    cta: { url: "http://localhost:4000/account/guardian-login", text: "Open Parent Portal" },
    followManagira: false,
    note: `<div style="text-align:center;">We will update you every step of the way.<br>Follow <a href="https://www.linkedin.com/company/managira" target="_blank" rel="noopener" style="color:#0f766e;text-decoration:underline;">Managira</a> for more updates. LinkedIn.<br><strong style="color:#b91c1c;">THIS IS A NO-REPLY MESSAGE. PLEASE DO NOT REPLY TO THIS EMAIL.</strong></div>`,
    noReply: false,
  });
}

function teacherDigestHtml() {
  const subjectRows = [
    [`${FOCUS_CLASS} - Gold`, "Mathematics", "84.0%", "8", "71.5%", "Good"],
    [`${FOCUS_CLASS} - Gold`, "Basic Science", "84.0%", "8", "66.8%", "Fair"],
  ];
  const mainClassRows = [
    [`${FOCUS_CLASS} - Gold`, "Mathematics", "84.0%", "8", "71.5%", "Good"],
    [`${FOCUS_CLASS} - Gold`, "English Language", "84.0%", "8", "68.2%", "Fair"],
    [`${FOCUS_CLASS} - Gold`, "Basic Science", "84.0%", "8", "66.8%", "Fair"],
    [`${FOCUS_CLASS} - Gold`, "Social Studies", "84.0%", "8", "74.4%", "Good"],
  ];

  return renderCleanEmail({
    title: `${SCHOOL_NAME} Weekly Teaching Digest`,
    greeting: "Hello Mrs. Amina Bello,",
    paragraphs: [
      `Here is your weekly teaching digest (${fmtDate(weekStart)} to ${fmtDate(today)}). Only fresh weekly updates are shown.`,
      "<strong>Your subject updates</strong>",
      renderTable(["Class", "Subject", "Attendance", "Missed Marks", "Avg Score", "Rating"], subjectRows),
      "<strong>Main teacher class feed (all subjects)</strong>",
      renderTable(["Class", "Subject", "Class Attendance", "Missed Marks", "Subject Avg", "Rating"], mainClassRows),
    ],
    details: [
      { label: "School", value: SCHOOL_NAME },
      { label: "Assigned classes", value: "1" },
      { label: "Subject updates this week", value: String(subjectRows.length) },
      { label: "Main classes with updates", value: "1" },
      { label: "Recipient", value: RECIPIENT },
    ],
    cta: { url: `${PORTAL_URL}/common/classDashboard`, text: "Open Class Dashboard" },
    followManagira: true,
    note: "This digest focuses on your assigned subjects and your main class feed.",
  });
}

function supervisorDigestHtml() {
  const subjectRows = [
    [`${FOCUS_CLASS} - Gold`, "Mathematics", "84.0%", "8", "71.5%", "Good"],
    ["JSS2 - Blue", "Mathematics", "79.3%", "11", "64.1%", "Fair"],
  ];
  const classFeedRows = [
    [`${FOCUS_CLASS} - Gold`, "Mathematics", "84.0%", "8", "71.5%", "Good"],
    [`${FOCUS_CLASS} - Gold`, "English Language", "84.0%", "8", "68.2%", "Fair"],
    ["JSS2 - Blue", "Mathematics", "79.3%", "11", "64.1%", "Fair"],
    ["JSS2 - Blue", "Basic Science", "79.3%", "11", "61.7%", "Fair"],
  ];

  return renderCleanEmail({
    title: `${SCHOOL_NAME} Weekly Supervisor Digest`,
    greeting: "Hello Mr. Daniel Adeyemi,",
    paragraphs: [
      `Weekly supervisor feed (${fmtDate(weekStart)} to ${fmtDate(today)}). Only classes with fresh weekly entries are shown.`,
      "<strong>Your subject updates</strong>",
      renderTable(["Class", "Subject", "Attendance", "Missed Marks", "Avg Score", "Rating"], subjectRows),
      "<strong>Assigned class feed (all subjects)</strong>",
      renderTable(["Class", "Subject", "Class Attendance", "Missed Marks", "Subject Avg", "Rating"], classFeedRows),
    ],
    details: [
      { label: "School", value: SCHOOL_NAME },
      { label: "Assigned classes", value: "2" },
      { label: "Subject updates this week", value: String(subjectRows.length) },
      { label: "Classes with feed updates", value: "2" },
      { label: "Recipient", value: RECIPIENT },
    ],
    cta: { url: `${PORTAL_URL}/common/classDashboard`, text: "Open Supervisor Dashboard" },
    followManagira: true,
    note: "This digest combines your teaching subjects and your assigned class-wide view.",
  });
}

function managerDigestHtml() {
  const schoolSummaryRows = [
    ["Attendance entered", "640 marks"],
    ["Attendance rate", "82.8% (530 present, 110 absent)"],
    ["Class coverage", "8/9 classes (88.9%)"],
    ["Students at risk", "27/412 (6.6%)"],
    ["Students with scored profile", "388/412 (94.2%)"],
  ];
  const riskRows = [
    ["Amina Yusuf", `${FOCUS_CLASS} - Gold`, "67.5%", "52.1%", "Attendance < 70% and score < 55%"],
    ["Samuel Peters", "JSS2 - Blue", "62.3%", "58.4%", "Attendance < 70%"],
    ["Grace Chukwu", "JSS3 - Red", "74.1%", "49.8%", "Score < 55%"],
  ];

  return renderCleanEmail({
    title: `${SCHOOL_NAME} Weekly Leadership Report`,
    greeting: "Hello Principal Ruth Okafor,",
    paragraphs: [
      `Weekly school summary (${fmtDate(weekStart)} to ${fmtDate(today)}).`,
      renderTable(["Metric", "This Week"], schoolSummaryRows),
      `Top at-risk students to review this week: ${riskRows.length} (sample view).`,
      renderTable(["Student", "Class", "Attendance", "Avg Score", "Risk Trigger"], riskRows),
    ],
    details: [
      { label: "School", value: SCHOOL_NAME },
      { label: "Attendance risk threshold", value: "70%" },
      { label: "Score risk threshold", value: "55%" },
      { label: "Recipient", value: RECIPIENT },
    ],
    cta: { url: `${PORTAL_URL}/admin/dashboard`, text: "Open Leadership Dashboard" },
    followManagira: true,
    note: "This summary focuses on whole-school performance and risk priorities.",
  });
}

async function send(label, subject, html) {
  console.log(`[managira-sample] Sending ${label} to ${RECIPIENT}...`);
  const sent = await sendEmailSafely(
    {
      to: RECIPIENT,
      subject,
      html,
    },
    `Managira ${label}`
  );

  if (!sent) {
    throw new Error(`${label} email failed`);
  }

  console.log(`[managira-sample] ${label} sent successfully.`);
}

async function run() {
  const mode = String(process.argv[3] || "all").trim().toLowerCase();

  const messages = [
    {
      label: "Parent Digest",
      subject: `${SCHOOL_NAME} - Parent / Guardian Update`,
      html: parentDigestHtml(),
    },
    {
      label: "Teacher Digest",
      subject: `${SCHOOL_NAME} - Weekly Teaching Digest`,
      html: teacherDigestHtml(),
    },
    {
      label: "Supervisor Digest",
      subject: `${SCHOOL_NAME} - Weekly Supervisor Digest`,
      html: supervisorDigestHtml(),
    },
    {
      label: "Manager Digest",
      subject: `${SCHOOL_NAME} - Weekly Leadership Report`,
      html: managerDigestHtml(),
    },
  ];

  const selectedMessages = mode === "parent"
    ? messages.filter((item) => item.label === "Parent Digest")
    : messages;

  for (const item of selectedMessages) {
    // eslint-disable-next-line no-await-in-loop
    await send(item.label, item.subject, item.html);
  }
}

run().catch((error) => {
  console.error("[managira-sample] Unexpected error:", error?.message || error);
  process.exit(1);
});
