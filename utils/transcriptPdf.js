// Gives transcripts the same persistent PDF pipeline report cards already
// have: render the existing /transcript/:studentId page with Puppeteer
// (reusing the requester's session cookie), upload the PDF to S3, and cache
// the resulting URL — so "Notify Guardians" can link to a real, stable PDF
// instead of a temp file that's deleted after one use.
const { PutObjectCommand } = require("@aws-sdk/client-s3");
const { s3Client } = require("../config/s3");
const puppeteer = require("puppeteer");

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

function buildPdfUrl(bucketName, regionName, pdfKey) {
  const cleanKey = String(pdfKey || "").replace(/^\/+/, "");
  if (!regionName || regionName === "us-east-1") {
    return `https://${bucketName}.s3.amazonaws.com/${cleanKey}`;
  }
  return `https://${bucketName}.s3.${regionName}.amazonaws.com/${cleanKey}`;
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

  const cookieHeader = String(req.headers.cookie || "");
  const sessionCookieMatch = cookieHeader.match(/(?:^|;\s*)connect\.sid=([^;]+)/);
  const sessionCookieValue = sessionCookieMatch ? sessionCookieMatch[1] : "";
  if (!sessionCookieValue) return "";

  const host = String(req.get("host") || "").trim();
  const protocol = String(req.protocol || "https").trim();
  const bucketName = String(process.env.S3_BUCKET_NAME || process.env.S3_PUBLIC_BUCKET_NAME || "oneplaces3").trim();
  const regionName = String(process.env.AWS_REGION || "").trim();

  let browser = null;
  let page = null;
  try {
    browser = await puppeteer.launch({
      headless: true,
      args: ["--no-sandbox", "--disable-setuid-sandbox", "--disable-web-security"],
    });
    page = await browser.newPage();
    await page.setCookie({
      name: "connect.sid",
      value: sessionCookieValue,
      domain: host.split(":")[0],
      path: "/",
    });

    const transcriptUrl = `${protocol}://${host}/transcript/${studentId}`;
    await page.goto(transcriptUrl, { waitUntil: "domcontentloaded", timeout: 30000 });
    await page.waitForSelector(".transcript", { timeout: 15000 });
    await page.evaluate(() => {
      document.querySelectorAll(".transcript-controls").forEach((el) => {
        el.style.display = "none";
      });
    });

    const pdfBuffer = await page.pdf({
      format: "A4",
      printBackground: true,
      preferCSSPageSize: true,
      margin: { top: "8mm", right: "8mm", bottom: "8mm", left: "8mm" },
    });

    const pdfKey = `transcripts/org_${organizationId}/student_${studentId}_${Date.now()}.pdf`;
    await s3Client.send(
      new PutObjectCommand({
        Bucket: bucketName,
        Key: pdfKey,
        Body: pdfBuffer,
        ContentType: "application/pdf",
      })
    );

    const pdfUrl = buildPdfUrl(bucketName, regionName, pdfKey);

    await dbClient.query(
      `INSERT INTO posted_transcripts (organization_id, student_id, pdf_url)
       VALUES ($1, $2, $3)
       ON CONFLICT (organization_id, student_id) DO UPDATE SET pdf_url = EXCLUDED.pdf_url, posted_at = NOW()`,
      [organizationId, studentId, pdfUrl]
    );

    return pdfUrl;
  } catch (_) {
    return "";
  } finally {
    try {
      if (page) await page.close();
    } catch (_) {}
    try {
      if (browser) await browser.close();
    } catch (_) {}
  }
}

module.exports = { ensureTranscriptPdfLink, ensurePostedTranscriptsSchema };
