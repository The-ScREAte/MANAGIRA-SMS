// scripts/sendDemoDigestEmails.js
// Sends fully populated DEMO digest emails (parent weekly, teacher weekly,
// manager weekly, manager monthly summary, hub weekly) to a single recipient
// for screenshot / sales-demo purposes. School name: "Managira Int School".
//
// Usage:
//   node scripts/sendDemoDigestEmails.js
//   node scripts/sendDemoDigestEmails.js you@example.com

require('dotenv').config();
const { sendEmailSafely, renderCleanEmail } = require('../utils/emailHelper');

const RECIPIENT = process.argv[2] || 'bondahdean@gmail.com';
const SCHOOL_NAME = 'Managira Int School';
const SCHOOL_WEBSITE = 'https://managiraintschool.example.com';
const HUB_NAME = 'Greater Boston Education Hub';
const PORTAL_URL = process.env.APP_BASE_URL || 'https://app.managira.com';
const TODAY = new Date();

// ---- helpers ---------------------------------------------------------------
const fmtDate = (d) =>
  d.toLocaleDateString('en-US', { month: 'short', day: '2-digit', year: 'numeric' });
const weekStart = new Date(TODAY); weekStart.setDate(TODAY.getDate() - 7);
const monthStart = new Date(TODAY.getFullYear(), TODAY.getMonth() - 1, 1);
const monthEnd = new Date(TODAY.getFullYear(), TODAY.getMonth(), 0);

const tableStyle =
  'width:100%;border-collapse:collapse;font-size:13px;margin:8px 0 4px;';
const thStyle =
  'text-align:left;padding:8px 10px;background:#0f766e;color:#fff;font-weight:600;font-size:12px;';
const tdStyle =
  'padding:8px 10px;border-bottom:1px solid #e5e7eb;color:#1f2937;';

function renderTable(headers, rows) {
  const head = headers.map((h) => `<th style="${thStyle}">${h}</th>`).join('');
  const body = rows
    .map(
      (r, i) =>
        `<tr style="background:${i % 2 ? '#f8fafc' : '#ffffff'};">${r
          .map((c) => `<td style="${tdStyle}">${c}</td>`)
          .join('')}</tr>`
    )
    .join('');
  return `<table style="${tableStyle}"><thead><tr>${head}</tr></thead><tbody>${body}</tbody></table>`;
}

function pill(text, color) {
  return `<span style="display:inline-block;padding:2px 8px;border-radius:999px;background:${color}22;color:${color};font-size:11px;font-weight:700;">${text}</span>`;
}

async function send(label, mailOptions) {
  console.log(`\n[demo] Sending: ${label}  →  ${mailOptions.to}`);
  try {
    const res = await sendEmailSafely(mailOptions, `Demo: ${label}`);
    console.log(`[demo]  ✓ Sent  (messageId=${res?.messageId || 'n/a'})`);
  } catch (e) {
    console.error(`[demo]  ✗ Failed:`, e?.message || e);
  }
}

// ---- 1. Parent Weekly Digest ----------------------------------------------
function parentDigestHtml() {
  const childrenRows = [
    [
      '<strong>Ethan Carter</strong>',
      'Grade 8 — Section A',
      pill('86%', '#059669'),
      '5 / 5',
      pill('On track', '#059669'),
    ],
    [
      '<strong>Sophia Carter</strong>',
      'Grade 4 — Section B',
      pill('72%', '#0ea5e9'),
      '5 / 5',
      pill('Steady progress', '#0ea5e9'),
    ],
    [
      '<strong>Noah Carter</strong>',
      'Kindergarten — Section A',
      pill('Pending', '#64748b'),
      '4 / 5',
      pill('1 absence', '#d97706'),
    ],
  ];

  const upcoming = [
    ['Mon May 04', 'Mathematics quiz — Grade 8'],
    ['Wed May 06', 'Term project submission — Grade 4'],
    ['Fri May 08', 'Spring sports day — whole school'],
  ];

  return renderCleanEmail({
    title: `Weekly update for your children`,
    greeting: `Dear <strong>Mr. & Mrs. Carter</strong>,`,
    paragraphs: [
      `Here is a summary of your children's week at <strong>${SCHOOL_NAME}</strong> (${fmtDate(weekStart)} — ${fmtDate(TODAY)}).`,
      `<h3 style="margin:18px 0 6px;font-size:15px;color:#0f172a;">Your children</h3>${renderTable(
        ['Student', 'Class', 'Term average', 'Attendance', 'Status'],
        childrenRows
      )}`,
      `<h3 style="margin:20px 0 6px;font-size:15px;color:#0f172a;">Coming up next week</h3>${renderTable(
        ['Date', 'Event'],
        upcoming
      )}`,
      `<p style="margin:14px 0 0;font-size:14px;color:#1f2937;">Sophia is showing steady improvement in English (+6% from last week). Noah was absent on Tuesday — please confirm with the homeroom teacher when you have a moment.</p>`,
    ],
    cta: { url: `${PORTAL_URL}/parent/dashboard`, text: 'Open parent dashboard' },
    note: `You can manage which weekly updates you receive in your parent portal under Settings &rarr; Notifications.`,
    schoolWebsiteUrl: SCHOOL_WEBSITE,
    schoolWebsiteHost: 'managiraintschool.example.com',
  });
}

// ---- 2. Teacher Weekly Digest ---------------------------------------------
function teacherDigestHtml() {
  const sections = [
    [
      'Grade 8 — Section A',
      'Mathematics',
      '32',
      pill('94%', '#059669'),
      '4 / 4',
      'All assessments graded',
    ],
    [
      'Grade 8 — Section B',
      'Mathematics',
      '30',
      pill('91%', '#059669'),
      '3 / 4',
      '1 quiz pending grading',
    ],
    [
      'Grade 7 — Section A',
      'Mathematics',
      '34',
      pill('88%', '#0ea5e9'),
      '4 / 4',
      'Homework returned Friday',
    ],
  ];

  const followUps = [
    ['Olivia Bennett (Grade 8A)', 'Missed quiz — needs make-up', pill('High', '#dc2626')],
    ['Liam Walker (Grade 7A)', '3 absences this week', pill('Medium', '#d97706')],
    ['Ava Mitchell (Grade 8B)', 'Strong improvement — recognize', pill('Positive', '#059669')],
  ];

  return renderCleanEmail({
    title: 'Your weekly teaching summary',
    greeting: `Hello <strong>Mr. Anderson</strong>,`,
    paragraphs: [
      `Here is your teaching summary at <strong>${SCHOOL_NAME}</strong> for the week of ${fmtDate(weekStart)} — ${fmtDate(TODAY)}.`,
      `<h3 style="margin:18px 0 6px;font-size:15px;color:#0f172a;">Your sections</h3>${renderTable(
        ['Class', 'Subject', 'Students', 'Avg attendance', 'Lessons logged', 'Notes'],
        sections
      )}`,
      `<h3 style="margin:20px 0 6px;font-size:15px;color:#0f172a;">Students to follow up on</h3>${renderTable(
        ['Student', 'Reason', 'Priority'],
        followUps
      )}`,
      `<p style="margin:14px 0 0;font-size:14px;color:#1f2937;">You have <strong>2 lesson plans</strong> due to be uploaded for next week and <strong>1 quiz</strong> waiting to be graded.</p>`,
    ],
    cta: { url: `${PORTAL_URL}/teacher/dashboard`, text: 'Open teacher dashboard' },
    note: `Tip: you can mark attendance for the entire class in one click from the class roster page.`,
    schoolWebsiteUrl: SCHOOL_WEBSITE,
    schoolWebsiteHost: 'managiraintschool.example.com',
  });
}

// ---- 3. Manager Weekly Digest (school-wide) -------------------------------
function managerWeeklyHtml() {
  const kpis = [
    ['Total students', '742'],
    ['Active staff', '48 (3 on leave)'],
    ['Attendance this week', '93.4%'],
    ['Term average', '78.6%'],
    ['Outstanding tuition', '$18,420'],
    ['Open support tickets', '4'],
  ];

  const risks = [
    ['Grade 5 — Section C', '21 students', pill('Below 70% attendance', '#dc2626'), 'Homeroom teacher notified'],
    ['Grade 9 — Section B', '29 students', pill('Term avg dropped 4%', '#d97706'), 'Review at staff meeting'],
    ['Kindergarten — Section A', '24 students', pill('2 staff on leave', '#d97706'), 'Substitute scheduled'],
  ];

  const billing = [
    ['Invoices issued', '742'],
    ['Paid in full', '618 (83%)'],
    ['Partially paid', '94 (13%)'],
    ['Unpaid', '30 (4%)'],
  ];

  return renderCleanEmail({
    title: 'Weekly school performance — Managira Int School',
    greeting: `Dear <strong>Principal Catherine Johnson</strong>,`,
    paragraphs: [
      `Here is the weekly performance summary for <strong>${SCHOOL_NAME}</strong> covering ${fmtDate(weekStart)} — ${fmtDate(TODAY)}.`,
      `<h3 style="margin:18px 0 6px;font-size:15px;color:#0f172a;">Key indicators</h3>${renderTable(
        ['Metric', 'Value'],
        kpis
      )}`,
      `<h3 style="margin:20px 0 6px;font-size:15px;color:#0f172a;">Classes that need attention</h3>${renderTable(
        ['Class', 'Size', 'Risk', 'Action'],
        risks
      )}`,
      `<h3 style="margin:20px 0 6px;font-size:15px;color:#0f172a;">Billing snapshot</h3>${renderTable(
        ['Item', 'Count'],
        billing
      )}`,
      `<p style="margin:14px 0 0;font-size:14px;color:#1f2937;">Overall the school is performing well this week. Attendance is up 1.2% and outstanding tuition is down $4,800 from last week.</p>`,
    ],
    cta: { url: `${PORTAL_URL}/admin/dashboard`, text: 'Open admin dashboard' },
    note: `Generated automatically every Monday at 07:00. You can change the schedule in Settings &rarr; Notifications.`,
    schoolWebsiteUrl: SCHOOL_WEBSITE,
    schoolWebsiteHost: 'managiraintschool.example.com',
  });
}

// ---- 4. Manager Monthly Summary -------------------------------------------
function managerMonthlyHtml() {
  const summary = [
    ['Reporting period', `${fmtDate(monthStart)} — ${fmtDate(monthEnd)}`],
    ['Enrolled students', '742 (+18 this month)'],
    ['New admissions', '22'],
    ['Withdrawals', '4'],
    ['Average attendance', '92.1%'],
    ['Term average', '78.6% (+1.4%)'],
    ['Total tuition collected', '$286,400'],
    ['Outstanding balance', '$18,420 (down 21%)'],
  ];

  const departments = [
    ['Early Years (PreK — KG)', '88', '94.0%', '81.2%'],
    ['Elementary (Grades 1–5)', '342', '92.7%', '79.4%'],
    ['Middle School (Grades 6–8)', '236', '91.0%', '76.8%'],
    ['Enrichment Programs', '76', '93.5%', '80.1%'],
  ];

  const highlights = [
    'Grade 8 — Section A scored highest in the inter-class Mathematics challenge.',
    'Grade 4 attendance crossed 96% for the first time this academic year.',
    'Two new teachers (English and Computer Science) successfully onboarded.',
    'Parent portal usage grew from 312 to 401 active accounts.',
  ];

  return renderCleanEmail({
    title: `Monthly summary — ${monthStart.toLocaleDateString('en-US', { month: 'long', year: 'numeric' })}`,
    greeting: `Dear <strong>Principal Catherine Johnson</strong>,`,
    paragraphs: [
      `Here is the monthly performance summary for <strong>${SCHOOL_NAME}</strong>.`,
      `<h3 style="margin:18px 0 6px;font-size:15px;color:#0f172a;">At a glance</h3>${renderTable(
        ['Metric', 'Value'],
        summary
      )}`,
      `<h3 style="margin:20px 0 6px;font-size:15px;color:#0f172a;">Performance by department</h3>${renderTable(
        ['Department', 'Students', 'Attendance', 'Term avg'],
        departments
      )}`,
      `<h3 style="margin:20px 0 6px;font-size:15px;color:#0f172a;">Highlights this month</h3><ul style="margin:6px 0 0;padding-left:20px;color:#1f2937;font-size:14px;line-height:1.7;">${highlights.map((h) => `<li>${h}</li>`).join('')}</ul>`,
      `<p style="margin:14px 0 0;font-size:14px;color:#1f2937;">A full report is available in your dashboard, including class-by-class breakdowns, individual teacher reports, and a 12-month trend view.</p>`,
    ],
    cta: { url: `${PORTAL_URL}/admin/reports/monthly`, text: 'View full monthly report' },
    note: `Generated on the 1st of every month. You can adjust the recipients in Settings &rarr; Reports.`,
    schoolWebsiteUrl: SCHOOL_WEBSITE,
    schoolWebsiteHost: 'managiraintschool.example.com',
  });
}

// ---- 5. Hub Weekly Digest -------------------------------------------------
function hubWeeklyHtml() {
  const orgs = [
    ['Managira Int School', '742', '93.4%', '78.6%', pill('On track', '#059669')],
    ['St. Catherine Academy', '518', '90.8%', '76.2%', pill('On track', '#059669')],
    ['Sunrise Preparatory', '286', '88.1%', '74.5%', pill('Watch', '#d97706')],
    ['Lincoln Memorial College', '904', '94.2%', '80.1%', pill('On track', '#059669')],
    ['Greenfield Academy', '212', '85.7%', '71.0%', pill('Needs review', '#dc2626')],
  ];

  const totals = [
    ['Schools in hub', '5'],
    ['Total students', '2,662'],
    ['Total active staff', '184'],
    ['Hub-wide attendance', '91.3%'],
    ['Hub-wide term average', '76.9%'],
    ['Open hub-level tickets', '2'],
  ];

  return renderCleanEmail({
    title: `Weekly hub overview — ${HUB_NAME}`,
    greeting: `Dear <strong>Hub Director Michael Thompson</strong>,`,
    paragraphs: [
      `Here is the consolidated weekly overview for the <strong>${HUB_NAME}</strong> covering ${fmtDate(weekStart)} — ${fmtDate(TODAY)}.`,
      `<h3 style="margin:18px 0 6px;font-size:15px;color:#0f172a;">Hub totals</h3>${renderTable(
        ['Metric', 'Value'],
        totals
      )}`,
      `<h3 style="margin:20px 0 6px;font-size:15px;color:#0f172a;">Schools in this hub</h3>${renderTable(
        ['School', 'Students', 'Attendance', 'Term avg', 'Status'],
        orgs
      )}`,
      `<p style="margin:14px 0 0;font-size:14px;color:#1f2937;">Greenfield Academy attendance dropped 3.4% this week — we recommend reaching out to the principal for context. Lincoln Memorial College continues to lead the hub on both attendance and academic performance.</p>`,
    ],
    cta: { url: `${PORTAL_URL}/hub/dashboard`, text: 'Open hub dashboard' },
    note: `This overview is delivered every Monday morning. You can pause or change the recipients in your hub settings.`,
  });
}

// ---- run ------------------------------------------------------------------
(async () => {
  console.log(`\n=== Managira Demo Digest Emails ===`);
  console.log(`Recipient : ${RECIPIENT}`);
  console.log(`School    : ${SCHOOL_NAME}`);
  console.log(`Hub       : ${HUB_NAME}`);

  const sends = [
    {
      label: 'Parent weekly digest',
      to: RECIPIENT,
      subject: `Your weekly update from ${SCHOOL_NAME}`,
      html: parentDigestHtml(),
    },
    {
      label: 'Teacher weekly digest',
      to: RECIPIENT,
      subject: `Your teaching summary — week of ${fmtDate(weekStart)}`,
      html: teacherDigestHtml(),
    },
    {
      label: 'Manager weekly digest',
      to: RECIPIENT,
      subject: `${SCHOOL_NAME} — weekly performance summary`,
      html: managerWeeklyHtml(),
    },
    {
      label: 'Manager monthly summary',
      to: RECIPIENT,
      subject: `${SCHOOL_NAME} — ${monthStart.toLocaleDateString('en-US', { month: 'long', year: 'numeric' })} monthly summary`,
      html: managerMonthlyHtml(),
    },
    {
      label: 'Hub weekly overview',
      to: RECIPIENT,
      subject: `${HUB_NAME} — weekly hub overview`,
      html: hubWeeklyHtml(),
    },
  ];

  for (const m of sends) {
    // eslint-disable-next-line no-await-in-loop
    await send(m.label, m);
  }

  console.log(`\n=== Done ===\n`);
  // give the SMTP pool a moment to flush before exiting
  setTimeout(() => process.exit(0), 1500);
})();
