
// Helper to get first class for org
const { getFirstClassForOrganization } = require("../models/classModel");
const bcrypt = require("bcryptjs");
const { sendEmailSafely } = require("../utils/emailHelper");
const puppeteer = require('puppeteer');
const fs = require('fs');
const path = require('path');
const ejs = require('ejs');
const axios = require('axios');

const transcriptController = (db) => ({
    generateTranscript: async (req, res) => {
        const { studentId } = req.params;
        const organizationId = req.session.organizationId;

        if (!studentId || !organizationId) {
            return res.status(400).send('Invalid student or organization ID.');
        }

        try {
            // Fetch organization details
            const organizationQuery = `
                SELECT organization_name, organization_address, organization_phone, email, logo_path
                FROM organizations
                WHERE organization_id = $1;
            `;
            const organizationResult = await db.query(organizationQuery, [organizationId]);
            const organization = organizationResult.rows[0];

            if (!organization) {
                return res.status(404).send('Organization not found.');
            }

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

            // Fetch total percentage and grade for each subject for closed school years
            const scoresQuery = `
                SELECT sub.subject_name, 
                       ar.total_percentage, 
                       ar.grade, 
                       t.term_name, 
                       sy.year_label
                FROM assessment_results ar
                JOIN assessments a ON ar.assessment_id = a.assessment_id
                JOIN subjects sub ON a.subject_id = sub.subject_id
                JOIN terms t ON ar.term_id = t.term_id
                JOIN school_years sy ON t.school_year_id = sy.id
                WHERE ar.student_id = $1 AND ar.organization_id = $2
                  AND sy.current = FALSE -- Include only closed school years
                GROUP BY sub.subject_name, ar.total_percentage, ar.grade, t.term_name, sy.year_label
                ORDER BY sy.year_label, t.term_name, sub.subject_name;
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
            const signatureClassId = student.class_id || firstClass?.class_id;
            if (signatureClassId) {
                const signatureQuery = `SELECT signature_image_path FROM report_settings WHERE organization_id = $1 AND class_id = $2 AND term_id = -1`;
                const signatureResult = await db.query(signatureQuery, [organizationId, signatureClassId]);
                const signaturePath = signatureResult.rows[0]?.signature_image_path;
                if (signaturePath) {
                    signatureImageUrl = buildS3Url(signaturePath);
                }
            }

            // Render the transcript
            res.render('print/transcript', {
                title: `Transcript for ${student.first_name} ${student.last_name}`,
                organization,
                student,
                scores,
                signatureImageUrl,
                official: req.query.official === 'true',
            });
        } catch (error) {
                        res.status(500).send('Failed to generate transcript.');
        }
    },

    emailTranscript: async (req, res) => {
        let browser = null;
        let pdfPath = null;
        
        try {
            const { studentId, targetEmail, password } = req.body;
            const organizationId = req.session.organizationId;

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

            console.log('[emailTranscript] Generating PDF with Puppeteer...');

            // Fetch all the data needed for the transcript (same as generateTranscript)
            const organizationQuery = `
                SELECT organization_name, organization_address, organization_phone, email, logo_path
                FROM organizations WHERE organization_id = $1
            `;
            const orgData = await db.query(organizationQuery, [organizationId]);
            const orgDetails = orgData.rows[0];

            // Build S3 URL for logo if it exists
            const buildS3Url = (key) => {
                if (!key) return null;
                if (key.startsWith('http://') || key.startsWith('https://')) return key;
                return `https://${process.env.S3_BUCKET_NAME}.s3.${process.env.AWS_REGION}.amazonaws.com/${key}`;
            };
            const orgLogoUrl = orgDetails.logo_path ? buildS3Url(orgDetails.logo_path) : null;
            const fetchImageAsDataUrl = async (url, label) => {
                try {
                    const response = await axios.get(url, { responseType: 'arraybuffer' });
                    const mime = response.headers['content-type'] || 'image/png';
                    return `data:${mime};base64,${Buffer.from(response.data).toString('base64')}`;
                } catch (err) {
                    console.warn(`[emailTranscript] Failed to inline ${label}:`, err.message);
                    return null;
                }
            };
            const orgLogoDataUrl = orgLogoUrl ? await fetchImageAsDataUrl(orgLogoUrl, 'logo') : null;

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

            const scoresQuery = `
                SELECT sub.subject_name, 
                       ar.total_percentage, 
                       ar.grade, 
                       t.term_name, 
                       sy.year_label
                FROM assessment_results ar
                JOIN assessments a ON ar.assessment_id = a.assessment_id
                JOIN subjects sub ON a.subject_id = sub.subject_id
                JOIN terms t ON ar.term_id = t.term_id
                JOIN school_years sy ON t.school_year_id = sy.id
                WHERE ar.student_id = $1 AND ar.organization_id = $2
                  AND sy.current = FALSE
                GROUP BY sub.subject_name, ar.total_percentage, ar.grade, t.term_name, sy.year_label
                ORDER BY sy.year_label, t.term_name, sub.subject_name
            `;
            const scoresResult = await db.query(scoresQuery, [studentId, organizationId]);
            const scores = scoresResult.rows;

            // Get signature
            const firstClass = await getFirstClassForOrganization(db, organizationId);
            let signatureImageUrl = null;
            const signatureClassId = fullStudent.class_id || firstClass?.class_id;
            if (signatureClassId) {
                const signatureQuery = `SELECT signature_image_path FROM report_settings WHERE organization_id = $1 AND class_id = $2 AND term_id = -1`;
                const signatureResult = await db.query(signatureQuery, [organizationId, signatureClassId]);
                const signaturePath = signatureResult.rows[0]?.signature_image_path;
                signatureImageUrl = signaturePath ? buildS3Url(signaturePath) : null;
            }
            const signatureDataUrl = signatureImageUrl ? await fetchImageAsDataUrl(signatureImageUrl, 'signature') : null;

            // Render EJS template to HTML string
            const templatePath = path.join(__dirname, '../views/print/transcript.ejs');
            const html = await ejs.renderFile(templatePath, {
                title: `Transcript for ${fullStudent.first_name} ${fullStudent.last_name}`,
                organization: orgDetails,
                student: fullStudent,
                scores,
                signatureImageUrl: signatureDataUrl || signatureImageUrl,
                official: true,
                session: { ...req.session, logo: orgLogoDataUrl || orgLogoUrl },
                req: { query: { official: 'true', pdf: 'true' } }
            });

            console.log('[emailTranscript] Rendering HTML to PDF...');
            console.log('[emailTranscript] Logo URL:', orgLogoUrl);

            // Launch browser and generate PDF from HTML
            browser = await puppeteer.launch({
                headless: true,
                args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-web-security']
            });
            const page = await browser.newPage();
            
            // Set content directly instead of navigating to URL
            await page.setContent(html, {
                waitUntil: 'networkidle0',
                timeout: 15000
            });

            // Generate PDF
            const timestamp = Date.now();
            pdfPath = path.join(__dirname, '../uploads', `transcript_${studentId}_${timestamp}.pdf`);
            
            await page.pdf({
                path: pdfPath,
                format: 'A4',
                printBackground: true,
                margin: { top: '20px', right: '20px', bottom: '20px', left: '20px' }
            });

            await browser.close();
            browser = null;

            console.log('[emailTranscript] PDF generated successfully');

            // Read email template
            const emailTemplatePath = path.join(__dirname, '../utils/templates/transcriptEmail.html');
            let emailHtml = fs.readFileSync(emailTemplatePath, 'utf8');

            // Replace placeholders
            emailHtml = emailHtml
                .replace(/{{studentName}}/g, `${student.first_name} ${student.last_name}`)
                .replace(/{{organizationName}}/g, organization.organization_name)
                .replace(/{{dateIssued}}/g, new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' }))
                .replace(/{{fileName}}/g, `${student.first_name}_${student.last_name}_Transcript.pdf`)
                .replace(/{{year}}/g, new Date().getFullYear());

            // Get logo for email
            const logoPath = path.join(__dirname, '../public/images/managira.png');

            console.log('[emailTranscript] Sending email with PDF attachment...');

            const emailSent = await sendEmailSafely(
                {
                    to: recipientEmail,
                    subject: `Official Transcript - ${student.first_name} ${student.last_name}`,
                    html: emailHtml,
                    attachments: [
                        {
                            filename: `${student.first_name}_${student.last_name}_Transcript.pdf`,
                            path: pdfPath
                        },
                        {
                            filename: 'managira-logo.png',
                            path: logoPath,
                            cid: 'managira_logo'
                        }
                    ]
                },
                'Transcript Email'
            );

            // Clean up PDF file
            if (fs.existsSync(pdfPath)) {
                fs.unlinkSync(pdfPath);
            }

            if (!emailSent) {
                console.log('[emailTranscript] Email failed to send');
                return res.status(500).json({ success: false, message: "Failed to send email. Please try again later." });
            }

            console.log('[emailTranscript] Email sent successfully');
            return res.status(200).json({ success: true, message: `Transcript sent successfully to ${recipientEmail}` });
        } catch (error) {
            console.error('[emailTranscript] Error:', error);
            
            // Cleanup
            if (browser) {
                try { await browser.close(); } catch (e) {}
            }
            if (pdfPath && fs.existsSync(pdfPath)) {
                try { fs.unlinkSync(pdfPath); } catch (e) {}
            }
            
            return res.status(500).json({ success: false, message: "An error occurred while sending the transcript." });
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
