// scripts/sendDemoTranscriptEmail.js
// Sends a fully populated DEMO transcript PDF to a single recipient for
// screenshot / sales-demo purposes. Uses the production transcript print
// template + puppeteer so the PDF matches what schools actually receive.
//
// Usage:
//   node scripts/sendDemoTranscriptEmail.js
//   node scripts/sendDemoTranscriptEmail.js you@example.com

require('dotenv').config();
const fs = require('fs');
const path = require('path');
const ejs = require('ejs');
const puppeteer = require('puppeteer');

const { sendEmailSafely, renderCleanEmail } = require('../utils/emailHelper');

const RECIPIENT = process.argv[2] || 'bondahdean@gmail.com';
const SCHOOL_NAME = 'Managira Int School';
const SCHOOL_WEBSITE = 'https://managiraintschool.example.com';
const SCHOOL_HOST = 'managiraintschool.example.com';
const PORTAL_URL = process.env.APP_BASE_URL || 'https://app.managira.com';
const TODAY = new Date();
const ISSUED_LABEL = TODAY.toLocaleDateString('en-US', {
  year: 'numeric',
  month: 'long',
  day: 'numeric',
});

const LOGO_PATH = path.join(__dirname, '..', 'public', 'images', 'managira.png');

// ---- Demo data -------------------------------------------------------------
const organization = {
  organization_name: SCHOOL_NAME,
  organization_address: '440 S 2nd St W',
  organization_province: 'Boston',
  organization_country: 'MA, USA',
  organization_phone: '+1 (617) 555-0182',
  email: 'managiraintschool@example.com',
};

const student = {
  first_name: 'Ethan',
  last_name: 'Carter',
  date_of_birth: '2008-04-12',
  gender: 'Male',
  hometown: 'Brookline, MA',
  class_id: 1,
  class_name: 'Grade 12 — Section A',
  graduation_year_group: 'Graduation Class of 2026',
  guardian_email: RECIPIENT,
};

// Build a rich, multi-year set of scores so the transcript looks substantial.
function buildScores() {
  const subjectsByLevel = {
    'Grade 9': [
      { subject: 'English Language Arts', pct: 88, grade: 'A-' },
      { subject: 'Algebra I', pct: 84, grade: 'B+' },
      { subject: 'Biology', pct: 91, grade: 'A' },
      { subject: 'World History', pct: 86, grade: 'B+' },
      { subject: 'Spanish I', pct: 79, grade: 'B' },
      { subject: 'Physical Education', pct: 95, grade: 'A' },
    ],
    'Grade 10': [
      { subject: 'English Language Arts', pct: 90, grade: 'A' },
      { subject: 'Geometry', pct: 87, grade: 'A-' },
      { subject: 'Chemistry', pct: 89, grade: 'A-' },
      { subject: 'U.S. History', pct: 92, grade: 'A' },
      { subject: 'Spanish II', pct: 83, grade: 'B+' },
      { subject: 'Computer Science Foundations', pct: 94, grade: 'A' },
    ],
    'Grade 11': [
      { subject: 'AP English Language', pct: 91, grade: 'A' },
      { subject: 'Algebra II', pct: 88, grade: 'A-' },
      { subject: 'Physics', pct: 86, grade: 'B+' },
      { subject: 'Government & Civics', pct: 93, grade: 'A' },
      { subject: 'AP Computer Science A', pct: 96, grade: 'A' },
      { subject: 'Studio Art', pct: 90, grade: 'A' },
    ],
    'Grade 12': [
      { subject: 'AP English Literature', pct: 93, grade: 'A' },
      { subject: 'Pre-Calculus', pct: 90, grade: 'A' },
      { subject: 'AP Biology', pct: 92, grade: 'A' },
      { subject: 'Economics', pct: 89, grade: 'A-' },
      { subject: 'AP Computer Science Principles', pct: 97, grade: 'A' },
      { subject: 'Senior Capstone Project', pct: 95, grade: 'A' },
    ],
  };

  const yearRanges = {
    'Grade 9': { year: '2022 / 2023', terms: [
      { name: 'Fall Semester', start: '2022-08-29', end: '2022-12-16' },
      { name: 'Spring Semester', start: '2023-01-09', end: '2023-05-26' },
    ]},
    'Grade 10': { year: '2023 / 2024', terms: [
      { name: 'Fall Semester', start: '2023-08-28', end: '2023-12-15' },
      { name: 'Spring Semester', start: '2024-01-08', end: '2024-05-24' },
    ]},
    'Grade 11': { year: '2024 / 2025', terms: [
      { name: 'Fall Semester', start: '2024-08-26', end: '2024-12-13' },
      { name: 'Spring Semester', start: '2025-01-06', end: '2025-05-23' },
    ]},
    'Grade 12': { year: '2025 / 2026', terms: [
      { name: 'Fall Semester', start: '2025-08-25', end: '2025-12-12' },
      { name: 'Spring Semester', start: '2026-01-05', end: '2026-05-22' },
    ]},
  };

  const out = [];
  Object.keys(subjectsByLevel).forEach((level) => {
    const { year, terms } = yearRanges[level];
    terms.forEach((term, termIdx) => {
      subjectsByLevel[level].forEach((s) => {
        // Slight variation between fall & spring for realism.
        const drift = termIdx === 0 ? 0 : 1;
        const pct = Math.min(99, s.pct + drift);
        out.push({
          subject_name: s.subject,
          total_percentage: pct,
          grade: s.grade,
          term_name: `${level} — ${term.name}`,
          year_label: year,
          start_date: term.start,
          end_date: term.end,
        });
      });
    });
  });
  return out;
}

// ---- Render transcript HTML → PDF ------------------------------------------
async function renderTranscriptPdf() {
  const templatePath = path.join(__dirname, '..', 'views', 'print', 'transcript.ejs');

  // Inline the logo so puppeteer doesn't try to fetch over the network.
  const logoBuffer = fs.readFileSync(LOGO_PATH);
  const logoDataUrl = `data:image/png;base64,${logoBuffer.toString('base64')}`;

  const html = await ejs.renderFile(templatePath, {
    title: `Transcript for ${student.first_name} ${student.last_name}`,
    organization,
    student,
    scores: buildScores(),
    signatureImageUrl: null,
    signatureName: 'Catherine Johnson, Ed.D.',
    signatureTitle: 'Principal',
    official: true,
    session: { logo: logoDataUrl, fontStyle: 'Inter' },
    req: { query: { official: 'true', pdf: 'true' } },
  });

  const browser = await puppeteer.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-web-security'],
  });

  try {
    const page = await browser.newPage();
    await page.setContent(html, { waitUntil: 'networkidle0', timeout: 20000 });

    const outDir = path.join(__dirname, '..', 'uploads');
    if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });
    const pdfPath = path.join(
      outDir,
      `demo_transcript_${student.first_name}_${student.last_name}_${Date.now()}.pdf`
    );

    await page.pdf({
      path: pdfPath,
      format: 'A4',
      printBackground: true,
      margin: { top: '20px', right: '20px', bottom: '20px', left: '20px' },
    });

    return pdfPath;
  } finally {
    await browser.close();
  }
}

// ---- Build & send email ----------------------------------------------------
async function main() {
  console.log(`[demo-transcript] Recipient: ${RECIPIENT}`);
  console.log('[demo-transcript] Generating populated transcript PDF...');

  const pdfPath = await renderTranscriptPdf();
  const pdfFilename = `${student.first_name}_${student.last_name}_Transcript.pdf`;

  console.log(`[demo-transcript] PDF ready: ${pdfPath}`);

  const html = renderCleanEmail({
    title: 'Official Student Transcript',
    greeting: 'Dear Mr. & Mrs. Carter,',
    paragraphs: [
      `Please find attached the official academic transcript for <strong>${student.first_name} ${student.last_name}</strong>, issued by ${SCHOOL_NAME}.`,
      'This document covers the complete high-school record from Grade 9 through Grade 12, including subjects, term percentages, and final letter grades for each semester.',
      'The transcript is digitally signed by the principal and is suitable for college applications, scholarship submissions, and official verification requests.',
    ],
    details: [
      { label: 'Student', value: `${student.first_name} ${student.last_name}` },
      { label: 'Current Class', value: student.class_name },
      { label: 'Graduation Group', value: student.graduation_year_group },
      { label: 'Issuing School', value: SCHOOL_NAME },
      { label: 'Date Issued', value: ISSUED_LABEL },
      { label: 'Document Type', value: 'Official Transcript (Verified)' },
    ],
    note:
      'For verification, colleges and employers may contact the school registrar directly using the contact information shown on the transcript.',
    cta: {
      url: PORTAL_URL,
      text: 'Open the parent portal',
    },
    schoolWebsiteUrl: SCHOOL_WEBSITE,
    schoolWebsiteHost: SCHOOL_HOST,
    noReply: true,
  });

  const mailOptions = {
    to: RECIPIENT,
    skipMxCheck: true,
    subject: `Official Transcript — ${student.first_name} ${student.last_name} — ${SCHOOL_NAME}`,
    html,
    attachments: [
      { filename: pdfFilename, path: pdfPath },
    ],
  };

  console.log('[demo-transcript] Sending email...');
  const res = await sendEmailSafely(mailOptions, 'Demo: Official Transcript');
  console.log(`[demo-transcript]  ✓ Sent  (messageId=${res?.messageId || 'n/a'})`);

  // Clean up the temp PDF after sending.
  try { fs.unlinkSync(pdfPath); } catch (_) {}
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('[demo-transcript]  ✗ Failed:', err);
    process.exit(1);
  });
