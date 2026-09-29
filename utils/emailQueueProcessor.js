const db = require("../config/db");
const { sendEmailSafely, renderCleanEmail } = require("./emailHelper");
const { isEmailEnabledForRecipient } = require("./emailPreferences");
const { getOrganizationWebsiteInfo } = require("./schoolWebsiteAccess");
const { renderReportCardsPerStudent, sessionCookieFromHeader } = require("./pdfService");

async function markEmailFailed(emailRecordId, message) {
  await db.query(
    `UPDATE email_history SET status = 'failed', error_message = $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2`,
    [message, emailRecordId]
  );
}

// Background email processing function
async function processEmailBatch(batchId, organizationId, classId, termId, protocol, host, cookies, specificIds = null) {
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

    // Get pending emails for this batch
    let query = `SELECT * FROM email_history WHERE batch_id = $1 AND status = 'pending'`;
    const params = [batchId];

    if (specificIds && specificIds.length > 0) {
      query += ` AND id = ANY($2)`;
      params.push(specificIds);
    }

    const emailsResult = await db.query(query, params);
    const emails = emailsResult.rows;
    const emailHistoryLink = `/print/emailHistoryPage?classId=${encodeURIComponent(String(classId || ""))}&termId=${encodeURIComponent(String(termId || ""))}`;

    console.log(`[processEmailBatch] Found ${emails.length} emails to process`);
    if (!emails.length) return;

    const recordsByStudent = new Map();
    emails.forEach((emailRecord) => {
      const studentId = Number(emailRecord.student_id);
      if (!recordsByStudent.has(studentId)) recordsByStudent.set(studentId, []);
      recordsByStudent.get(studentId).push(emailRecord);
    });

    await db.query(
      `UPDATE email_history SET status = 'sending', updated_at = CURRENT_TIMESTAMP WHERE id = ANY($1::int[])`,
      [emails.map((emailRecord) => emailRecord.id)]
    );

    const sendRecord = async (emailRecord, pdfBuffer) => {
      const { student_name, recipient_emails } = emailRecord;

      await db.query(
        `UPDATE email_history SET pdf_generated = true WHERE id = $1`,
        [emailRecord.id]
      );

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

      // Send to all recipient emails
      let allSent = true;
      for (const email of recipient_emails) {
        // Honor each guardian's preference for report card emails.
        const allowed = await isEmailEnabledForRecipient(db, email, 'report_card_email');
        if (!allowed) continue;
        const sent = await sendEmailSafely({
          to: email,
          subject: `Report Card - ${student_name} | ${org.organization_name}`,
          html: emailHtml,
          failureNotification: {
            orgId: organizationId,
            recipientType: 'broadcast',
            recipientId: 0,
            title: 'Report email delivery failed',
            body: `Report email for ${student_name} could not be delivered to ${email}. Update the saved email and resend from Email History.`,
            link: emailHistoryLink,
            dedupeHours: 12,
          },
          attachments: [
            {
              filename: `${String(student_name || 'Student').replace(/ /g, '_')}_Report.pdf`,
              content: pdfBuffer,
              contentType: 'application/pdf',
            },
          ],
        }, 'Report Email');

        if (!sent) allSent = false;
      }

      if (allSent) {
        await db.query(
          `UPDATE email_history SET status = 'sent', sent_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP WHERE id = $1`,
          [emailRecord.id]
        );
      } else {
        await markEmailFailed(emailRecord.id, 'Some emails failed to send');
      }
    };

    // Every report card in the batch comes from one page load of the same
    // report page staff see, then each is emailed as its own PDF.
    try {
      await renderReportCardsPerStudent(
        {
          baseUrl: `${protocol}://${host}`,
          sessionCookie: sessionCookieFromHeader(cookies),
          classId,
          termId,
          studentIds: Array.from(recordsByStudent.keys()),
        },
        {
          onReport: async (studentId, pdfBuffer) => {
            for (const emailRecord of recordsByStudent.get(studentId) || []) {
              try {
                await sendRecord(emailRecord, pdfBuffer);
              } catch (err) {
                console.error(`[processEmailBatch] Error processing email ${emailRecord.id}:`, err.message);
                await markEmailFailed(emailRecord.id, err.message);
              }
            }
          },
          onError: async (studentId, err) => {
            for (const emailRecord of recordsByStudent.get(studentId) || []) {
              await markEmailFailed(emailRecord.id, err.userMessage || err.message);
            }
          },
        }
      );
    } catch (renderError) {
      // Nothing could be rendered (for example the session expired): fail the
      // remaining emails with a clear reason instead of sending a wrong PDF.
      console.error(`[processEmailBatch] Could not render report cards for batch ${batchId}:`, renderError.message);
      await db.query(
        `UPDATE email_history SET status = 'failed', error_message = $1, updated_at = CURRENT_TIMESTAMP
          WHERE id = ANY($2::int[]) AND status = 'sending'`,
        [renderError.userMessage || 'Report card PDF could not be generated.', emails.map((emailRecord) => emailRecord.id)]
      );
    }

    console.log(`[processEmailBatch] Completed processing batch ${batchId}`);
  } catch (error) {
    console.error('[processEmailBatch] Fatal error:', error);
  }
}

module.exports = { processEmailBatch };
