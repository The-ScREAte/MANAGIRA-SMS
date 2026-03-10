const puppeteer = require("puppeteer");
const path = require("path");
const fs = require("fs");
const db = require("../config/db");
const { sendEmailSafely, renderCleanEmail } = require("./emailHelper");
const { getOrganizationWebsiteInfo } = require("./schoolWebsiteAccess");

// Background email processing function
async function processEmailBatch(batchId, organizationId, classId, termId, protocol, host, cookies, specificIds = null) {
  let browser = null;
  try {
    console.log(`[processEmailBatch] Started processing batch ${batchId}`);

    // Get org details
    const orgResult = await db.query(
      'SELECT organization_name, organization_address, organization_phone, email, logo_path FROM organizations WHERE organization_id = $1',
      [organizationId]
    );
    const org = orgResult.rows[0];
    if (!org) {
      console.error(`[processEmailBatch] Organization ${organizationId} not found`);
      return;
    }

    const websiteInfo = await getOrganizationWebsiteInfo(db, organizationId);

    const buildS3Url = (key) => {
      if (!key) return null;
      if (key.startsWith('http://') || key.startsWith('https://')) return key;
      return `https://${process.env.S3_BUCKET_NAME}.s3.${process.env.AWS_REGION}.amazonaws.com/${key}`;
    };

    // Get pending emails for this batch
    let query = `SELECT * FROM email_history WHERE batch_id = $1 AND status = 'pending'`;
    const params = [batchId];
    
    if (specificIds && specificIds.length > 0) {
      query += ` AND id = ANY($2)`;
      params.push(specificIds);
    }

    const emailsResult = await db.query(query, params);
    const emails = emailsResult.rows;

    console.log(`[processEmailBatch] Found ${emails.length} emails to process`);

    for (const emailRecord of emails) {
      try {
        // Update status to sending
        await db.query(
          `UPDATE email_history SET status = 'sending', updated_at = CURRENT_TIMESTAMP WHERE id = $1`,
          [emailRecord.id]
        );

        const { student_id, student_name, recipient_emails } = emailRecord;

        // Generate PDF
        const reportUrl = `${protocol}://${host}/print/printStudentReport?classId=${classId}&termId=${termId}&studentId=${student_id}`;
        
        if (!browser) {
          browser = await puppeteer.launch({
            headless: true,
            args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-web-security']
          });
        }

        const page = await browser.newPage();
        
        if (cookies) {
          const cookieValue = cookies.match(/connect\.sid=([^;]+)/)?.[1] || '';
          if (cookieValue) {
            await page.setCookie({
              name: 'connect.sid',
              value: cookieValue,
              domain: host.split(':')[0],
              path: '/'
            });
          }
        }
        
        await page.goto(reportUrl, { waitUntil: 'networkidle0', timeout: 30000 });
        await page.evaluate(() => {
          document.querySelectorAll('.actions-no-print, .student-checkbox, hr, #emailModal').forEach(el => el.style.display = 'none');
        });

        const timestamp = Date.now();
        const pdfPath = path.join(__dirname, '../uploads', `report_${student_id}_${timestamp}.pdf`);
        const uploadsDir = path.join(__dirname, '../uploads');
        if (!fs.existsSync(uploadsDir)) fs.mkdirSync(uploadsDir, { recursive: true });

        await page.pdf({
          path: pdfPath,
          format: 'A4',
          printBackground: true,
          margin: { top: '8mm', right: '8mm', bottom: '8mm', left: '8mm' }
        });

        await page.close();

        // Mark PDF as generated
        await db.query(
          `UPDATE email_history SET pdf_generated = true WHERE id = $1`,
          [emailRecord.id]
        );

        // Send emails
        const emailHtml = renderCleanEmail({
          title: "Student Report Card",
          greeting: "Dear Parent/Guardian,",
          paragraphs: [
            `Please find attached the <strong>academic report card</strong> for <strong>${student_name}</strong>.`,
          ],
          details: [
            { label: "Student", value: student_name },
            { label: "School", value: org.organization_name },
            { label: "Date", value: new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' }) },
          ],
          note: "This report is confidential and intended only for the student's parent/guardian. Please do not forward or share without permission.",
          schoolWebsiteUrl: websiteInfo.websiteUrl || "",
          schoolWebsiteHost: websiteInfo.websiteHost || "",
        });

        const logoFilePath = path.join(__dirname, '../public/images/managira.png');

        // Send to all recipient emails
        let allSent = true;
        for (const email of recipient_emails) {
          const sent = await sendEmailSafely({
            to: email,
            subject: `Report Card - ${student_name} | ${org.organization_name}`,
            html: emailHtml,
            attachments: [
              { filename: `${student_name.replace(/ /g, '_')}_Report.pdf`, path: pdfPath },
              { filename: 'managira-logo.png', path: logoFilePath, cid: 'managira_logo' }
            ]
          }, 'Report Email');

          if (!sent) allSent = false;
        }

        // Clean up PDF
        if (fs.existsSync(pdfPath)) fs.unlinkSync(pdfPath);

        // Update status
        if (allSent) {
          await db.query(
            `UPDATE email_history SET status = 'sent', sent_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP WHERE id = $1`,
            [emailRecord.id]
          );
        } else {
          await db.query(
            `UPDATE email_history SET status = 'failed', error_message = 'Some emails failed to send', updated_at = CURRENT_TIMESTAMP WHERE id = $1`,
            [emailRecord.id]
          );
        }

      } catch (err) {
        console.error(`[processEmailBatch] Error processing email ${emailRecord.id}:`, err.message);
        await db.query(
          `UPDATE email_history SET status = 'failed', error_message = $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2`,
          [err.message, emailRecord.id]
        );
      }
    }

    if (browser) await browser.close();
    console.log(`[processEmailBatch] Completed processing batch ${batchId}`);

  } catch (error) {
    console.error('[processEmailBatch] Fatal error:', error);
    if (browser) try { await browser.close(); } catch (e) {}
  }
}

module.exports = { processEmailBatch };
