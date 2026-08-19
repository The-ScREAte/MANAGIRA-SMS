// Guarantees a report card has a real, persistent PDF link before a
// "Notify Guardians" message goes out — mirrors utils/transcriptPdf.js but
// for report cards. Checks posted_report_cards first (the class-wide "Post
// Report" action may have already generated one); if missing, generates
// this one student's PDF on demand via Puppeteer + S3, same as
// printController's whatsappReports flow, and caches it the same way.
const { PutObjectCommand } = require("@aws-sdk/client-s3");
const { s3Client } = require("../config/s3");
const puppeteer = require("puppeteer");

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

function buildPdfUrl(bucketName, regionName, pdfKey) {
  const cleanKey = String(pdfKey || "").replace(/^\/+/, "");
  if (!regionName || regionName === "us-east-1") {
    return `https://${bucketName}.s3.amazonaws.com/${cleanKey}`;
  }
  return `https://${bucketName}.s3.${regionName}.amazonaws.com/${cleanKey}`;
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
    await page.setJavaScriptEnabled(false);
    await page.setCookie({
      name: "connect.sid",
      value: sessionCookieValue,
      domain: host.split(":")[0],
      path: "/",
    });

    const reportUrl = `${protocol}://${host}/print/printStudentReport?classId=${classId}&termId=${termId}&studentId=${studentId}&postingMode=1`;
    await page.goto(reportUrl, { waitUntil: "domcontentloaded", timeout: 30000 });
    await page.waitForSelector(".student-report", { timeout: 15000 });
    await page.evaluate(() => {
      document.querySelectorAll(".actions-no-print, .student-checkbox, hr, #emailModal, #whatsappModal").forEach((el) => {
        el.style.display = "none";
      });
    });

    const pdfBuffer = await page.pdf({
      format: "A4",
      printBackground: true,
      preferCSSPageSize: true,
      margin: { top: "8mm", right: "8mm", bottom: "8mm", left: "8mm" },
    });

    const safeStudentName = String(studentName || `student_${studentId}`)
      .replace(/[^a-zA-Z0-9_-]+/g, "_")
      .replace(/_+/g, "_")
      .replace(/^_+|_+$/g, "");
    const pdfKey = `report-cards/org_${organizationId}/term_${termId}/class_${classId}/student_${studentId}_${Date.now()}_${safeStudentName}.pdf`;

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
      `INSERT INTO posted_report_cards (organization_id, class_id, term_id, student_id, pdf_s3_key, pdf_url, posted_at)
       VALUES ($1, $2, $3, $4, $5, $6, NOW())
       ON CONFLICT (organization_id, class_id, term_id, student_id)
       DO UPDATE SET pdf_s3_key = EXCLUDED.pdf_s3_key, pdf_url = EXCLUDED.pdf_url, posted_at = NOW()`,
      [organizationId, classId, termId, studentId, pdfKey, pdfUrl]
    ).catch(() => {});

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

module.exports = { ensureReportPdfLink };
