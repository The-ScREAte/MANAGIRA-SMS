// Gives transcripts the same persistent PDF pipeline report cards already
// have: render the existing /transcript/:studentId page through
// utils/pdfService (reusing the requester's session cookie), store it, and cache
// the resulting URL — so "Notify Guardians" can link to a real, stable PDF
// instead of a temp file that's deleted after one use.
const { renderTranscriptPdf, storePdf, sessionCookieFromHeader } = require("./pdfService");

let schemaReady = false;

async function ensurePostedTranscriptsSchema(dbClient) {
  if (schemaReady) return;
  await dbClient.query(`
    CREATE TABLE IF NOT EXISTS posted_transcripts (
      organization_id INTEGER NOT NULL,
      student_id INTEGER NOT NULL,
      pdf_url TEXT NOT NULL,
      posted_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      PRIMARY KEY (organization_id, student_id)
    )
  `);
  schemaReady = true;
}

// Returns a stable S3 URL for this student's transcript, generating and
// caching one if it doesn't exist yet. Returns "" (never throws to the
// caller's message-building path) if generation isn't possible right now —
// callers should fall back to "check the portal" wording in that case.
async function ensureTranscriptPdfLink(dbClient, req, studentId) {
  const organizationId = Number(req.session.organizationId || 0);
  if (!organizationId || !studentId) return "";

  await ensurePostedTranscriptsSchema(dbClient);

  const cached = await dbClient.query(
    `SELECT pdf_url FROM posted_transcripts WHERE organization_id = $1 AND student_id = $2 LIMIT 1`,
    [organizationId, studentId]
  );
  const existingUrl = cached.rows[0]?.pdf_url;
  if (existingUrl) return existingUrl;

  const sessionCookie = sessionCookieFromHeader(req.headers.cookie);
  if (!sessionCookie) return "";

  try {
    // Guardian notices link the unofficial copy (watermarked "UNOFFICIAL").
    const buffer = await renderTranscriptPdf({
      baseUrl: `${String(req.protocol || "https").trim()}://${String(req.get("host") || "").trim()}`,
      sessionCookie,
      studentId,
      official: false,
    });

    const pdfUrl = await storePdf(`transcripts/org_${organizationId}/student_${studentId}_${Date.now()}.pdf`, buffer);

    await dbClient.query(
      `INSERT INTO posted_transcripts (organization_id, student_id, pdf_url)
       VALUES ($1, $2, $3)
       ON CONFLICT (organization_id, student_id) DO UPDATE SET pdf_url = EXCLUDED.pdf_url, posted_at = NOW()`,
      [organizationId, studentId, pdfUrl]
    );

    return pdfUrl;
  } catch (error) {
    console.error("[ensureTranscriptPdfLink] Could not generate transcript PDF:", error.message);
    return "";
  }
}

module.exports = { ensureTranscriptPdfLink, ensurePostedTranscriptsSchema };
