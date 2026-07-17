// scripts/sendDemoDigestEmails.js
// Sends fully populated DEMO weekly digest emails (teacher, supervisor,
// manager, hub) to a single recipient
// for screenshot / sales-demo purposes. School name: "Managira Int. School".
//
// Usage:
//   node scripts/sendDemoDigestEmails.js
//   node scripts/sendDemoDigestEmails.js you@example.com

require('dotenv').config();
const { sendEmailSafely, renderCleanEmail } = require('../utils/emailHelper');

const RECIPIENT = process.argv[2] || 'bondahdean@gmail.com';
const SCHOOL_NAME = 'Managira Int. School';
const SCHOOL_WEBSITE = 'https://manis.managira.com';
const SCHOOL_WEBSITE_LABEL = 'manis.managira.com';
const HUB_NAME = 'Greater Boston Education Hub';
const LOGIN_URL = 'https://managira.com/account/login';
const HUB_LOGIN_URL = 'https://managira.com/hub/login';
const TODAY = new Date();

// ---- helpers ---------------------------------------------------------------
const fmtDate = (d) =>
  d.toLocaleDateString('en-US', { month: 'short', day: '2-digit', year: 'numeric' });
const weekStart = new Date(TODAY); weekStart.setDate(TODAY.getDate() - 7);

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

function renderHighlights(items) {
  return `<ul style="margin:8px 0 0;padding-left:18px;color:#1f2937;font-size:14px;line-height:1.6;">${items
    .map((item) => `<li>${item}</li>`)
    .join('')}</ul>`;
}

function digestFooterNote({ includeWebsite = false } = {}) {
  const websiteHtml = includeWebsite
    ? `<br><span style="color:#334155;">School website: <a href="${SCHOOL_WEBSITE}" target="_blank" rel="noopener" style="color:#0f766e;text-decoration:underline;">${SCHOOL_WEBSITE_LABEL}</a></span>`
    : '';

  return `<div style="text-align:center;">We will update you every step of the way.<br>Follow <a href="https://www.linkedin.com/company/managira" target="_blank" rel="noopener" style="color:#0f766e;text-decoration:underline;">Managira</a> for more updates. LinkedIn.<br><strong style="color:#b91c1c;">THIS IS A NO-REPLY MESSAGE. PLEASE DO NOT REPLY TO THIS EMAIL.</strong>${websiteHtml}</div>`;
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
    note: digestFooterNote(),
    noReply: false,
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
      '94% (30 present, 2 absent)',
      '84% average',
      'All assessments were graded on time.',
    ],
    [
      'Grade 8 — Section B',
      'Mathematics',
      '91% (27 present, 3 absent)',
      '79% average',
      'One quiz is still pending.',
    ],
    [
      'Grade 7 — Section A',
      'Mathematics',
      '88% (30 present, 3 absent, 1 late)',
      '74% average',
      'Attendance slipped slightly and needs follow-up.',
    ],
  ];

  return renderCleanEmail({
    title: 'Teachers Update',
    showTitle: false,
    greeting: `Hello <strong>Mr. Anderson</strong>,`,
    paragraphs: [
      `Here is your teaching update for ${fmtDate(weekStart)} — ${fmtDate(TODAY)}.`,
      renderHighlights([
        'Three mathematics sections recorded fresh attendance and grading activity this week.',
        'Grade 8 — Section B still has one pending quiz to close out.',
        'Grade 7 — Section A had the lowest attendance and needs a quick check-in.',
      ]),
      `<h3 style="margin:18px 0 6px;font-size:15px;color:#0f172a;">Your subject updates</h3>${renderTable(
        ['Class', 'Subject', 'Attendance Snapshot', 'Academic Update', 'This Week'],
        sections
      )}`,
    ],
    cta: { url: LOGIN_URL, text: 'Login here' },
    note: digestFooterNote({ includeWebsite: true }),
    noReply: false,
  });
}

// ---- 3. Supervisor Weekly Digest -----------------------------------------
function supervisorDigestHtml() {
  const sections = [
    [
      'Grade 8 — Section A',
      'Mathematics',
      '94% (30 present, 2 absent)',
      '84% average',
      'Assessment records are complete.',
    ],
    [
      'Grade 8 — Section A',
      'English Language',
      '94% (30 present, 2 absent)',
      '78% average',
      'One learner needs a writing follow-up.',
    ],
    [
      'Grade 7 — Section B',
      'Basic Science',
      '87% (26 present, 4 absent)',
      '71% average',
      'This class logged the highest absences.',
    ],
  ];

  return renderCleanEmail({
    title: 'School Update',
    showTitle: false,
    greeting: `Hello <strong>Mr. Daniel Adeyemi</strong>,`,
    paragraphs: [
      `Here is your supervisor update for ${fmtDate(weekStart)} — ${fmtDate(TODAY)}.`,
      renderHighlights([
        'Three class sections submitted fresh updates this week.',
        'Grade 8 — Section A posted complete updates across core subjects.',
        'Grade 7 — Section B needs attendance follow-up.',
      ]),
      `<h3 style="margin:18px 0 6px;font-size:15px;color:#0f172a;">Assigned class feed</h3>${renderTable(
        ['Class', 'Subject', 'Attendance Snapshot', 'Academic Update', 'This Week'],
        sections
      )}`,
    ],
    cta: { url: LOGIN_URL, text: 'Login here' },
    note: digestFooterNote({ includeWebsite: true }),
    noReply: false,
  });
}

// ---- 4. Manager Weekly Digest (school-wide) -------------------------------
function managerWeeklyHtml() {
  const kpis = [
    ['Attendance entered', '742 marks'],
    ['Attendance rate', '93.4% (694 present, 48 absent)'],
    ['Class coverage', '28 / 30 classes (93.3%)'],
    ['Students at risk', '17 / 742 (2.3%)'],
    ['Students with scored profile', '711 / 742 (95.8%)'],
  ];

  const risks = [
    ['Daniel Moore', 'Grade 5 — Section C', 'Attendance fell to 66%.'],
    ['Faith Robinson', 'Grade 9 — Section B', 'Average score closed the week at 52%.'],
    ['Isaac Young', 'Grade 7 — Section A', 'Attendance dropped to 63% and average score to 49%.'],
  ];

  return renderCleanEmail({
    title: 'School Update',
    showTitle: false,
    greeting: `Dear <strong>Principal Catherine Johnson</strong>,`,
    paragraphs: [
      `Here is your school update for ${fmtDate(weekStart)} — ${fmtDate(TODAY)}.`,
      renderHighlights([
        '742 attendance marks were entered across 28 classes.',
        'Overall attendance closed at 93.4%.',
        '17 students need follow-up this week.',
      ]),
      `<h3 style="margin:18px 0 6px;font-size:15px;color:#0f172a;">School snapshot</h3>${renderTable(
        ['Metric', 'Value'],
        kpis
      )}`,
      `<h3 style="margin:20px 0 6px;font-size:15px;color:#0f172a;">Students needing attention</h3>${renderTable(
        ['Student', 'Class', 'This Week'],
        risks
      )}`,
    ],
    cta: { url: LOGIN_URL, text: 'Login here' },
    note: digestFooterNote({ includeWebsite: true }),
    noReply: false,
  });
}

// ---- 5. Hub Weekly Digest -------------------------------------------------
function hubWeeklyHtml() {
  const orgs = [
    ['Managira Int. School', '742', '93.4% attendance', '78.6% average', 'No students flagged this week.'],
    ['St. Catherine Academy', '518', '90.8% attendance', '76.2% average', 'No students flagged this week.'],
    ['Sunrise Preparatory', '286', '88.1% attendance', '74.5% average', '5 students flagged for follow-up.'],
    ['Lincoln Memorial College', '904', '94.2% attendance', '80.1% average', 'No students flagged this week.'],
    ['Greenfield Academy', '212', '85.7% attendance', '71.0% average', '9 students flagged for follow-up.'],
  ];

  return renderCleanEmail({
    title: `${HUB_NAME} Weekly Hub Digest`,
    greeting: `Dear <strong>Hub Director Michael Thompson</strong>,`,
    paragraphs: [
      `Here is the consolidated weekly overview for the <strong>${HUB_NAME}</strong> covering ${fmtDate(weekStart)} — ${fmtDate(TODAY)}.`,
      renderHighlights([
        '5 member schools contributed data to this week’s hub summary.',
        '2,662 students and 184 staff are represented across the hub.',
        'Lincoln Memorial College led attendance, while Greenfield Academy needs the closest follow-up.',
      ]),
      `<h3 style="margin:20px 0 6px;font-size:15px;color:#0f172a;">Member schools</h3>${renderTable(
        ['School', 'Students', 'Attendance Snapshot', 'Academic Update', 'This Week'],
        orgs
      )}`,
      `<p style="margin:14px 0 0;font-size:14px;color:#1f2937;">Greenfield Academy attendance dropped 3.4% this week, while Lincoln Memorial College continued to lead the hub on both attendance and academic performance.</p>`,
    ],
    cta: { url: HUB_LOGIN_URL, text: 'Login here' },
    note: digestFooterNote(),
    noReply: false,
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
      label: 'Teacher weekly digest',
      to: RECIPIENT,
      subject: 'Teachers Update',
      html: teacherDigestHtml(),
    },
    {
      label: 'Supervisor weekly digest',
      to: RECIPIENT,
      subject: 'School Update',
      html: supervisorDigestHtml(),
    },
    {
      label: 'Manager weekly digest',
      to: RECIPIENT,
      subject: 'School Update',
      html: managerWeeklyHtml(),
    },
    {
      label: 'Hub weekly overview',
      to: RECIPIENT,
      subject: 'Hub Update',
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
