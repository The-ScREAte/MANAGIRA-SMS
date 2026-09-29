// Guarantees a report card has a real, persistent PDF link before a
// "Notify Guardians" message goes out — mirrors utils/transcriptPdf.js but
// for report cards. Checks posted_report_cards first (the class-wide "Post
// Report" action may have already generated one); if missing, generates
// this one student's PDF through utils/pdfService and caches it the same way.
const {
  renderReportCardsPdf,
  storePdf,
  safeFileSegment,
  sessionCookieFromHeader,
} = require("./pdfService");

let schemaReady = false;
async function ensurePostedReportCardsTable(dbClient) {
  if (schemaReady) return;
  await dbClient.query(`
    CREATE TABLE IF NOT EXISTS posted_report_cards (
      posted_report_card_id SERIAL PRIMARY KEY,
      organization_id INT NOT NULL,
      class_id INT NOT NULL,
      term_id INT NOT NULL,
      school_year_id INT NULL,
      student_id INT NOT NULL,
      pdf_s3_key TEXT NOT NULL,
      pdf_url TEXT NOT NULL,
      posted_by INT NULL,
      posted_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      UNIQUE (organization_id, class_id, term_id, student_id)
    )
  `);
  schemaReady = true;
}

// Returns a stable S3 URL for this student's report card (class/term
// scoped), generating and caching one if it doesn't exist yet. Returns ""
// if generation isn't possible right now (e.g. no session cookie) —
// callers should fall back to "check the portal" wording in that case.
async function ensureReportPdfLink(dbClient, req, { studentId, classId, termId, studentName }) {
  const organizationId = Number(req.session.organizationId || 0);
  if (!organizationId || !studentId || !classId || !termId) return "";

  await ensurePostedReportCardsTable(dbClient);

  const cached = await dbClient.query(
    `SELECT pdf_url FROM posted_report_cards
     WHERE organization_id = $1 AND class_id = $2 AND term_id = $3 AND student_id = $4 LIMIT 1`,
    [organizationId, classId, termId, studentId]
  );
  const existingUrl = cached.rows[0]?.pdf_url;
  if (existingUrl) return existingUrl;

  const sessionCookie = sessionCookieFromHeader(req.headers.cookie);
  if (!sessionCookie) return "";

  try {
    const { buffer } = await renderReportCardsPdf({
      baseUrl: `${String(req.protocol || "https").trim()}://${String(req.get("host") || "").trim()}`,
      sessionCookie,
      classId,
      termId,
      studentIds: [studentId],
    });

    const safeStudentName = safeFileSegment(studentName, `student_${studentId}`);
    const pdfKey = `report-cards/org_${organizationId}/term_${termId}/class_${classId}/student_${studentId}_${Date.now()}_${safeStudentName}.pdf`;
    const pdfUrl = await storePdf(pdfKey, buffer);

    await dbClient.query(
      `INSERT INTO posted_report_cards (organization_id, class_id, term_id, student_id, pdf_s3_key, pdf_url, posted_at)
       VALUES ($1, $2, $3, $4, $5, $6, NOW())
       ON CONFLICT (organization_id, class_id, term_id, student_id)
       DO UPDATE SET pdf_s3_key = EXCLUDED.pdf_s3_key, pdf_url = EXCLUDED.pdf_url, posted_at = NOW()`,
      [organizationId, classId, termId, studentId, pdfKey, pdfUrl]
    ).catch(() => {});

    return pdfUrl;
  } catch (error) {
    console.error("[ensureReportPdfLink] Could not generate report card PDF:", error.message);
    return "";
  }
}

module.exports = { ensureReportPdfLink };
