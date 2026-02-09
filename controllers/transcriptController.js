
// Helper to get first class for org
const { getFirstClassForOrganization } = require("../models/classModel");

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
                SELECT s.student_id, s.first_name, s.last_name, s.date_of_birth, s.gender, s.hometown, c.class_name, g.name AS graduation_year_group
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


            // Fetch first class for this org
            const firstClass = await getFirstClassForOrganization(db, organizationId);
            // Use the same S3 helper as report settings for signature image
            const { getFromS3 } = require("../utils/s3Helpers.js");
            let signatureImageUrl = null;
            if (firstClass) {
                const signatureQuery = `SELECT signature_image_path FROM report_settings WHERE organization_id = $1 AND class_id = $2 AND term_id = -1`;
                const signatureResult = await db.query(signatureQuery, [organizationId, firstClass.class_id]);
                if (signatureResult.rows.length > 0 && signatureResult.rows[0].signature_image_path) {
                    signatureImageUrl = getFromS3(signatureResult.rows[0].signature_image_path);
                }
            }

            // Render the transcript
            res.render('print/transcript', {
                title: `Transcript for ${student.first_name} ${student.last_name}`,
                organization,
                student,
                scores,
                signatureImageUrl,
            });
        } catch (error) {
                        res.status(500).send('Failed to generate transcript.');
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
