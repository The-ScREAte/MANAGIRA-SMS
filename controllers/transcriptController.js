
// Helper to get first class for org
const { getFirstClassForOrganization } = require("../models/classModel");
const bcrypt = require("bcryptjs");
const { sendEmailSafely } = require("../utils/emailHelper");
const { getOrganizationWebsiteInfo } = require("../utils/schoolWebsiteAccess");
const { renderTranscriptPdf, sessionCookieFromHeader } = require('../utils/pdfService');
const fs = require('fs');
const path = require('path');
const { getMessagingChannelStatus } = require("../utils/guardianMessaging");

// Ensure signature metadata columns exist on report_settings
let ensuredSignatureMeta = false;
async function ensureSignatureMetaColumns(dbClient) {
    if (ensuredSignatureMeta) return;
    try {
        await dbClient.query("ALTER TABLE report_settings ADD COLUMN IF NOT EXISTS signature_name TEXT");
        await dbClient.query("ALTER TABLE report_settings ADD COLUMN IF NOT EXISTS signature_title TEXT");
        ensuredSignatureMeta = true;
    } catch (err) {
        console.error('[transcript] ensureSignatureMetaColumns failed', err);
    }
}

let ensuredDeliveryAuditTable = false;
let lastDeliveryRetentionCleanupAt = 0;
async function ensureDeliveryAuditTable(dbClient) {
    if (ensuredDeliveryAuditTable) return;
    await dbClient.query(`
        CREATE TABLE IF NOT EXISTS delivery_audit_history (
            id SERIAL PRIMARY KEY,
            organization_id INTEGER NOT NULL,
            event_domain VARCHAR(32) NOT NULL,
            event_name VARCHAR(64) NOT NULL,
            class_id INTEGER,
            term_id INTEGER,
            student_id INTEGER,
            student_name VARCHAR(255),
            actor_user_id INTEGER,
            actor_name VARCHAR(255),
            recipient_emails TEXT[],
            status VARCHAR(50),
            batch_id VARCHAR(120),
            pdf_url TEXT,
            notes TEXT,
            metadata JSONB DEFAULT '{}'::jsonb,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
    `);
    await dbClient.query(
        `CREATE INDEX IF NOT EXISTS idx_delivery_audit_org_created ON delivery_audit_history(organization_id, created_at DESC)`
    );
    await dbClient.query(
        `CREATE INDEX IF NOT EXISTS idx_delivery_audit_domain_event ON delivery_audit_history(organization_id, event_domain, event_name)`
    );
    ensuredDeliveryAuditTable = true;
}

async function cleanupDeliveryHistoryRetention(dbClient) {
    const now = Date.now();
    if (now - lastDeliveryRetentionCleanupAt < 6 * 60 * 60 * 1000) return;

    try {
        await dbClient.query(
            `DELETE FROM delivery_audit_history
             WHERE created_at < (CURRENT_TIMESTAMP - INTERVAL '3 months')`
        );
        await dbClient.query(
            `DELETE FROM email_history
             WHERE created_at < (CURRENT_TIMESTAMP - INTERVAL '3 months')`
        );
    } catch (cleanupErr) {
        console.error('[transcript] cleanupDeliveryHistoryRetention failed', cleanupErr?.message || cleanupErr);
    } finally {
        lastDeliveryRetentionCleanupAt = now;
    }
}

const transcriptController = (db) => ({
    generateTranscript: async (req, res) => {
        const { studentId } = req.params;
        const organizationId = req.session.organizationId;
        await ensureSignatureMetaColumns(db);
        await ensureDeliveryAuditTable(db);
        await cleanupDeliveryHistoryRetention(db);

        if (!studentId || !organizationId) {
            return res.status(400).send('Invalid student or organization ID.');
        }

        try {
            // Fetch organization details
            const organizationQuery = `
                SELECT organization_name, organization_address, organization_country, organization_province, organization_phone, email, logo_path
                FROM organizations
                WHERE organization_id = $1;
            `;
            const organizationResult = await db.query(organizationQuery, [organizationId]);
            const organization = organizationResult.rows[0];

            if (!organization) {
                return res.status(404).send('Organization not found.');
            }

            const websiteInfo = await getOrganizationWebsiteInfo(db, organizationId);

            // Fetch student details
            const studentQuery = `
                                    SELECT s.student_id, s.first_name, s.last_name, s.date_of_birth, s.gender, s.hometown,
                                            (
                                                SELECT gp.email
                                                FROM guardian_students gs
                                                JOIN guardian_profiles gp ON gp.guardian_id = gs.guardian_id AND gp.organization_id = s.organization_id
                                                WHERE gs.student_id = s.student_id
                                                LIMIT 1
                                            ) AS guardian_email,
                                            c.class_id, c.class_name,
                                            g.name AS graduation_year_group
                FROM students s
                LEFT JOIN classes c ON s.class_id = c.class_id
                LEFT JOIN graduation_year_groups g ON s.graduation_year_group_id = g.id
                WHERE s.student_id = $1 AND s.organization_id = $2;
            `;
            const studentResult = await db.query(studentQuery, [studentId, organizationId]);
            const student = studentResult.rows[0];

            if (!student) {
                return res.status(404).send('Student not found.');
            }

            const actorUserId = Number(req.session.userId || (req.session.user && req.session.user.user_id)) || null;
            const actorNameResult = actorUserId
                ? await db.query(
                    `SELECT COALESCE(NULLIF(TRIM(CONCAT(first_name, ' ', last_name)), ''), email, 'Unknown') AS actor_name
                     FROM users
                     WHERE user_id = $1 AND organization_id = $2
                     LIMIT 1`,
                    [actorUserId, organizationId]
                )
                : { rows: [] };
            const actorName = String(actorNameResult.rows[0]?.actor_name || 'Unknown').trim() || 'Unknown';

            // PDF renders (the emailed copy) are audited by emailTranscript itself.
            if (req.query.pdf !== 'true') {
                await db.query(
                    `INSERT INTO delivery_audit_history (
                        organization_id, event_domain, event_name, class_id, term_id, student_id,
                        student_name, actor_user_id, actor_name, recipient_emails, status, notes, metadata
                    ) VALUES ($1, 'transcript', 'transcript_saved', $2, NULL, $3, $4, $5, $6, $7, 'saved', $8, $9::jsonb)`,
                    [
                        organizationId,
                        student.class_id || null,
                        Number(student.student_id),
                        `${student.first_name} ${student.last_name}`.trim(),
                        actorUserId,
                        actorName,
                        student.guardian_email ? [String(student.guardian_email).trim().toLowerCase()] : [],
                        'Transcript generated/opened from transcript page.',
                        JSON.stringify({ source: 'generateTranscript' }),
                    ]
                );
            }

                        // Fetch total percentage and grade for each subject for ended semesters
                        const scoresQuery = `
                                                                SELECT sub.subject_name,
                                                                                         MAX(ar.total_percentage) AS total_percentage,
                                                                                         MAX(
                                                                                             COALESCE(
                                                                                                 (
                                                                                                     SELECT COALESCE(NULLIF(sr.grade_label, ''),
                                                                                                         CASE
                                                                                                             WHEN ar.total_percentage >= 90 THEN 'A'
                                                                                                             WHEN ar.total_percentage >= 80 THEN 'B'
                                                                                                             WHEN ar.total_percentage >= 70 THEN 'C'
                                                                                                             ELSE 'D'
                                                                                                         END
                                                                                                     )
                                                                                                     FROM score_remarks sr
                                                                                                     WHERE sr.organization_id = ar.organization_id
                                                                                                         AND sr.class_id = ar.class_id
                                                                                                         AND sr.term_id = ar.term_id
                                                                                                         AND NULLIF(TRIM(sr.grade_label), '') IS NOT NULL
                                                                                                                                                                                                         ORDER BY
                                                                                                                                                                                                             CASE
                                                                                                                                                                                                                 WHEN ar.total_percentage IS NULL THEN 1000000000
                                                                                                                                                                                                                 WHEN ar.total_percentage::numeric BETWEEN sr.from_percentage AND sr.to_percentage THEN 0
                                                                                                                                                                                                                 WHEN ar.total_percentage::numeric < sr.from_percentage THEN sr.from_percentage - ar.total_percentage::numeric
                                                                                                                                                                                                                 ELSE ar.total_percentage::numeric - sr.to_percentage
                                                                                                                                                                                                             END ASC,
                                                                                                                                                                                                             sr.from_percentage DESC
                                                                                                     LIMIT 1
                                                                                                 ),
                                                                                                 CASE
                                                                                                     WHEN ar.total_percentage IS NULL THEN NULL
                                                                                                     WHEN ar.total_percentage >= 90 THEN 'A'
                                                                                                     WHEN ar.total_percentage >= 80 THEN 'B'
                                                                                                     WHEN ar.total_percentage >= 70 THEN 'C'
                                                                                                     ELSE 'D'
                                                                                                 END
                                                                                             )
                                                                                         ) AS grade,
                                                                                         t.term_name,
                                                                                         t.start_date,
                                                                                         t.end_date,
                                                                                         sy.year_label
                                FROM assessment_results ar
                                JOIN assessments a ON ar.assessment_id = a.assessment_id
                                JOIN subjects sub ON a.subject_id = sub.subject_id
                                JOIN terms t ON ar.term_id = t.term_id
                                JOIN school_years sy ON t.school_year_id = sy.id
                                WHERE ar.student_id = $1 AND ar.organization_id = $2
                                                                        AND (
                                                                                t.current = FALSE
                                                                                OR (t.end_date IS NOT NULL AND t.end_date < CURRENT_DATE)
                                                                        )
                                                                GROUP BY sub.subject_name, t.term_name, t.start_date, t.end_date, sy.year_label
                                                                ORDER BY COALESCE(t.end_date, t.start_date), t.start_date, sub.subject_name;
                        `;
            const scoresResult = await db.query(scoresQuery, [studentId, organizationId]);
            const scores = scoresResult.rows;


            // Fetch first class for this org (fallback) and resolve transcript signature for the student's class
            const firstClass = await getFirstClassForOrganization(db, organizationId);
            const buildS3Url = (key) => {
                if (!key) return null;
                if (key.startsWith('http://') || key.startsWith('https://')) return key;
                return `https://${process.env.S3_BUCKET_NAME}.s3.${process.env.AWS_REGION}.amazonaws.com/${key}`;
            };
            let signatureImageUrl = null;
            let signatureName = null;
            let signatureTitle = null;
            const signatureClassId = student.class_id || firstClass?.class_id;
            if (signatureClassId) {
                const signatureQuery = `SELECT signature_image_path, signature_name, signature_title FROM report_settings WHERE organization_id = $1 AND class_id = $2 AND term_id = -1`;
                const signatureResult = await db.query(signatureQuery, [organizationId, signatureClassId]);
                const signaturePath = signatureResult.rows[0]?.signature_image_path;
                signatureImageUrl = signaturePath ? buildS3Url(signaturePath) : null;
                signatureName = signatureResult.rows[0]?.signature_name || null;
                signatureTitle = signatureResult.rows[0]?.signature_title || null;
            }

            // Render the transcript
            const transcriptMessagingStatus = await getMessagingChannelStatus(db, organizationId).catch(() => ({
                sms: { ready: false },
                whatsapp: { ready: false },
            }));

            res.render('print/transcript', {
                title: `Transcript for ${student.first_name} ${student.last_name}`,
                organization,
                student,
                scores,
                signatureImageUrl,
                signatureName,
                signatureTitle,
                official: req.query.official === 'true',
                canBroadcastToGuardians: Boolean(transcriptMessagingStatus.sms?.ready || transcriptMessagingStatus.whatsapp?.ready),
                hideGlobalHeader: true,
                hideGlobalFooter: true,
            });
        } catch (error) {
                        res.status(500).send('Failed to generate transcript.');
        }
    },

    emailTranscript: async (req, res) => {
        try {
            await ensureSignatureMetaColumns(db);
            await ensureDeliveryAuditTable(db);
            await cleanupDeliveryHistoryRetention(db);
            const { studentId, targetEmail, password } = req.body;
            const organizationId = req.session.organizationId;
            const actorUserId = Number(req.session.userId || (req.session.user && req.session.user.user_id)) || null;

            console.log('[emailTranscript] Request received:', { studentId, targetEmail: targetEmail ? 'provided' : 'none', hasPassword: !!password });

            if (!organizationId) {
                console.log('[emailTranscript] Unauthorized: missing organizationId');
                return res.status(401).json({ success: false, message: "Unauthorized. Please log in again." });
            }

            if (!password) {
                console.log('[emailTranscript] Missing password');
                return res.status(400).json({ success: false, message: "Password is required." });
            }

            // Fetch organization details
            const orgResult = await db.query('SELECT password, organization_name FROM organizations WHERE organization_id = $1', [organizationId]);
            if (orgResult.rows.length === 0) {
                console.log('[emailTranscript] Organization not found');
                return res.status(404).json({ success: false, message: "Organization not found. Please log in again." });
            }

            const organization = orgResult.rows[0];
            
            // Check password - try logged-in user's password first, then org password
            let passwordMatch = false;
            const userId = req.session.userId || (req.session.user && req.session.user.user_id);
            
            if (userId) {
                const userResult = await db.query('SELECT password FROM users WHERE user_id = $1 AND organization_id = $2', [userId, organizationId]);
                if (userResult.rows.length > 0 && userResult.rows[0].password) {
                    passwordMatch = await bcrypt.compare(password, userResult.rows[0].password);
                }
            }
            
            // Fall back to organization password
            if (!passwordMatch) {
                passwordMatch = await bcrypt.compare(password, organization.password);
            }
            
            console.log('[emailTranscript] Password verification:', { match: passwordMatch });
            if (!passwordMatch) {
                console.log('[emailTranscript] Incorrect password');
                return res.status(401).json({ success: false, message: "Incorrect password. Please try again." });
            }

            // Fetch student data
            const studentQuery = `
                SELECT s.student_id, s.first_name, s.last_name, s.class_id,
                    (
                        SELECT gp.email
                        FROM guardian_students gs
                        JOIN guardian_profiles gp ON gp.guardian_id = gs.guardian_id AND gp.organization_id = s.organization_id
                        WHERE gs.student_id = s.student_id
                        LIMIT 1
                    ) AS guardian_email
                FROM students s
                WHERE s.student_id = $1 AND s.organization_id = $2
            `;
            const studentResult = await db.query(studentQuery, [studentId, organizationId]);
            const student = studentResult.rows[0];
            if (!student) {
                console.log('[emailTranscript] Student not found');
                return res.status(404).json({ success: false, message: "Student not found." });
            }

            const recipientEmail = targetEmail || student.guardian_email;
            if (!recipientEmail) {
                console.log('[emailTranscript] No email address available');
                return res.status(400).json({ success: false, message: "No email address provided or guardian email on file." });
            }

            const websiteInfo = await getOrganizationWebsiteInfo(db, organizationId);

            const fullStudentQuery = `
                SELECT s.student_id, s.first_name, s.last_name, s.date_of_birth, s.gender, s.hometown,
                    (
                        SELECT gp.email
                        FROM guardian_students gs
                        JOIN guardian_profiles gp ON gp.guardian_id = gs.guardian_id AND gp.organization_id = s.organization_id
                        WHERE gs.student_id = s.student_id
                        LIMIT 1
                    ) AS guardian_email,
                    c.class_id, c.class_name,
                    g.name AS graduation_year_group
                FROM students s
                LEFT JOIN classes c ON s.class_id = c.class_id
                LEFT JOIN graduation_year_groups g ON s.graduation_year_group_id = g.id
                WHERE s.student_id = $1 AND s.organization_id = $2
            `;
            const fullStudentResult = await db.query(fullStudentQuery, [studentId, organizationId]);
            const fullStudent = fullStudentResult.rows[0];

            const actorNameResult = actorUserId
                ? await db.query(
                    `SELECT COALESCE(NULLIF(TRIM(CONCAT(first_name, ' ', last_name)), ''), email, 'Unknown') AS actor_name
                     FROM users
                     WHERE user_id = $1 AND organization_id = $2
                     LIMIT 1`,
                    [actorUserId, organizationId]
                )
                : { rows: [] };
            const actorName = String(actorNameResult.rows[0]?.actor_name || 'Unknown').trim() || 'Unknown';

            // Rendered from the transcript page itself, so the emailed copy has
            // the school's theme colour, font, logo and signature exactly as
            // staff see it.
            const pdfBuffer = await renderTranscriptPdf({
                baseUrl: `${req.protocol}://${req.get('host')}`,
                sessionCookie: sessionCookieFromHeader(req.headers.cookie),
                studentId: student.student_id,
            });

            // Read email template
            const emailTemplatePath = path.join(__dirname, '../utils/templates/transcriptEmail.html');
            let emailHtml = await fs.promises.readFile(emailTemplatePath, 'utf8');

            // Replace placeholders
            emailHtml = emailHtml
                .replace(/{{studentName}}/g, `${student.first_name} ${student.last_name}`)
                .replace(/{{organizationName}}/g, organization.organization_name)
                .replace(/{{dateIssued}}/g, new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' }))
                .replace(/{{fileName}}/g, `${student.first_name}_${student.last_name}_Transcript.pdf`)
                .replace(/{{schoolWebsiteSection}}/g, websiteInfo.websiteUrl
                    ? `<p><strong>School Website:</strong> <a href="${websiteInfo.websiteUrl}" target="_blank" rel="noopener" style="color:#0f766e;text-decoration:underline;">${websiteInfo.websiteHost}</a></p>`
                    : '')
                .replace(/{{year}}/g, new Date().getFullYear());

            console.log('[emailTranscript] Sending email with PDF attachment...');

            const emailSent = await sendEmailSafely(
                {
                    to: recipientEmail,
                    skipMxCheck: true,
                    subject: `Official Transcript - ${student.first_name} ${student.last_name}`,
                    html: emailHtml,
                    attachments: [
                        {
                            filename: `${student.first_name}_${student.last_name}_Transcript.pdf`,
                            content: pdfBuffer,
                            contentType: 'application/pdf'
                        }
                    ]
                },
                'Transcript Email'
            );


            if (!emailSent) {
                console.log('[emailTranscript] Email failed to send');
                await db.query(
                    `INSERT INTO delivery_audit_history (
                        organization_id, event_domain, event_name, class_id, term_id, student_id,
                        student_name, actor_user_id, actor_name, recipient_emails, status, notes, metadata
                    ) VALUES ($1, 'transcript', 'transcript_email_failed', $2, NULL, $3, $4, $5, $6, $7, 'failed', $8, $9::jsonb)`,
                    [
                        organizationId,
                        fullStudent.class_id || null,
                        Number(fullStudent.student_id),
                        `${fullStudent.first_name} ${fullStudent.last_name}`.trim(),
                        actorUserId,
                        actorName,
                        [recipientEmail],
                        'Transcript email sending failed.',
                        JSON.stringify({ source: 'emailTranscript' }),
                    ]
                );
                return res.status(500).json({ success: false, message: "Failed to send email. Please try again later." });
            }

            console.log('[emailTranscript] Email sent successfully');
            await db.query(
                `INSERT INTO delivery_audit_history (
                    organization_id, event_domain, event_name, class_id, term_id, student_id,
                    student_name, actor_user_id, actor_name, recipient_emails, status, notes, metadata
                ) VALUES ($1, 'transcript', 'transcript_email_sent', $2, NULL, $3, $4, $5, $6, $7, 'sent', $8, $9::jsonb)`,
                [
                    organizationId,
                    fullStudent.class_id || null,
                    Number(fullStudent.student_id),
                    `${fullStudent.first_name} ${fullStudent.last_name}`.trim(),
                    actorUserId,
                    actorName,
                    [recipientEmail],
                    'Transcript emailed successfully.',
                    JSON.stringify({ source: 'emailTranscript' }),
                ]
            );
            return res.status(200).json({ success: true, message: `Transcript sent successfully to ${recipientEmail}` });
        } catch (error) {
            console.error('[emailTranscript] Error:', error);
            return res.status(500).json({ success: false, message: error?.userMessage || "An error occurred while sending the transcript." });
        }
    },

    uploadSignatureImage: async function (req, res) {
        const { file } = req;
        const organizationId = req.session.organizationId;
        const db = req.app.get('db');
        if (!file) {
            req.flash('error', 'No file uploaded.');
            return res.redirect('back');
        }
        try {
            // Use first available class for this org
            const firstClass = await getFirstClassForOrganization(db, organizationId);
            if (!firstClass) {
                req.flash('error', 'No class found for this organization.');
                return res.redirect('back');
            }
            const transcriptTermId = -1; // Use -1 for transcript signature

            // Get previous signature image path (if any)
            const prevResult = await db.query(
                `SELECT signature_image_path FROM report_settings WHERE organization_id = $1 AND class_id = $2 AND term_id = $3`,
                [organizationId, firstClass.class_id, transcriptTermId]
            );
            const previousSignature = prevResult.rows[0]?.signature_image_path;

            // Upload to S3 using memory upload helper
            const { uploadToS3, deleteFromS3 } = require('../middleware/s3Upload');
            const signatureKey = `images/transcript_signature/${organizationId}/${file.originalname}`;
            const s3Url = await uploadToS3(file, signatureKey);

            // Save to report_settings (upsert for this class/term)
            await db.query(
                `INSERT INTO report_settings (organization_id, class_id, term_id, signature_image_path)
                 VALUES ($1, $2, $3, $4)
                 ON CONFLICT (organization_id, class_id, term_id) DO UPDATE SET signature_image_path = EXCLUDED.signature_image_path`,
                [organizationId, firstClass.class_id, transcriptTermId, s3Url]
            );

            // Delete previous signature from S3 if it exists
            if (previousSignature) {
                const s3Prefix = `https://${process.env.S3_BUCKET_NAME}.s3.${process.env.AWS_REGION}.amazonaws.com/`;
                let oldSignatureKey = previousSignature;
                if (previousSignature.startsWith(s3Prefix)) {
                    oldSignatureKey = previousSignature.substring(s3Prefix.length);
                }
                await deleteFromS3(oldSignatureKey);
            }

            req.flash('success', 'Signature uploaded successfully.');
            res.redirect('back');
        } catch (error) {
                        req.flash('error', 'Failed to upload signature.');
            res.redirect('back');
        }
    },

    saveDigitalSignature: async function (req, res) {
        const organizationId = req.session.organizationId;
        const db = req.app.get('db');
        const { signatureData } = req.body;

        if (!signatureData) {
            return res.status(400).json({ success: false, error: 'No signature data provided.' });
        }

        try {
            // Use first available class for this org
            const firstClass = await getFirstClassForOrganization(db, organizationId);
            if (!firstClass) {
                return res.status(400).json({ success: false, error: 'No class found for this organization.' });
            }
            const transcriptTermId = -1;

            // Get previous signature image path (if any)
            const prevResult = await db.query(
                `SELECT signature_image_path FROM report_settings WHERE organization_id = $1 AND class_id = $2 AND term_id = $3`,
                [organizationId, firstClass.class_id, transcriptTermId]
            );
            const previousSignature = prevResult.rows[0]?.signature_image_path;

            // Convert base64 to buffer
            const base64Data = signatureData.replace(/^data:image\/png;base64,/, '');
            const buffer = Buffer.from(base64Data, 'base64');

            // Create a file-like object for uploadToS3
            const file = {
                buffer: buffer,
                mimetype: 'image/png',
                originalname: `digital_signature_${Date.now()}.png`
            };

            // Upload to S3
            const { uploadToS3, deleteFromS3 } = require('../middleware/s3Upload');
            const signatureKey = `images/transcript_signature/${organizationId}/${file.originalname}`;
            const s3Url = await uploadToS3(file, signatureKey);

            // Save to report_settings (upsert)
            await db.query(
                `INSERT INTO report_settings (organization_id, class_id, term_id, signature_image_path)
                 VALUES ($1, $2, $3, $4)
                 ON CONFLICT (organization_id, class_id, term_id) DO UPDATE SET signature_image_path = EXCLUDED.signature_image_path`,
                [organizationId, firstClass.class_id, transcriptTermId, s3Url]
            );

            // Delete previous signature from S3 if it exists
            if (previousSignature) {
                const s3Prefix = `https://${process.env.S3_BUCKET_NAME}.s3.${process.env.AWS_REGION}.amazonaws.com/`;
                let oldSignatureKey = previousSignature;
                if (previousSignature.startsWith(s3Prefix)) {
                    oldSignatureKey = previousSignature.substring(s3Prefix.length);
                }
                try { await deleteFromS3(oldSignatureKey); } catch (e) { /* ignore cleanup errors */ }
            }

            return res.json({ success: true, message: 'Digital signature saved successfully.' });
        } catch (error) {
            return res.status(500).json({ success: false, error: 'Failed to save digital signature.' });
        }
    },
});



module.exports = transcriptController;
