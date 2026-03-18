const nodemailer = require('nodemailer');
const db = require('../config/db');
const path = require('path');
const { uploadToS3 } = require('../config/s3');
const { sendEmailSafely, renderCleanEmail } = require('../utils/emailHelper');
const { ensureEmploymentSchema } = require('../utils/employmentSchema');

const sendEmploymentApplicantConfirmationEmail = async ({
    applicantFullName,
    applicantEmail,
    location,
    selectedJob,
    applicationId,
}) => {
    const applicantConfirmationHtml = renderCleanEmail({
        title: 'Employment Application Received',
        greeting: `Dear <strong>${applicantFullName}</strong>,`,
        paragraphs: [
            `Thank you for applying for the <strong>${selectedJob.title}</strong> role at Managira.`,
            'Your application has been received successfully, and our team will review it.',
            'Follow us on LinkedIn for more information and updates.',
        ],
        details: [
            { label: 'Application ID', value: applicationId ? `#${applicationId}` : 'Submitted' },
            { label: 'Position', value: selectedJob.title },
            { label: 'Location', value: location },
        ],
    });

    const firstAttempt = await sendEmailSafely(
        {
            from: process.env.EMAIL_USER,
            to: applicantEmail,
            subject: `Application Received: ${selectedJob.title}`,
            html: applicantConfirmationHtml,
            attachments: [
                {
                    filename: 'managira.png',
                    path: path.join(__dirname, '../public/images/managira.png'),
                    cid: 'managira_logo'
                }
            ]
        },
        'Employment Applicant Confirmation Email'
    );

    if (firstAttempt) {
        return true;
    }

    // Retry once for transient SMTP/network hiccups.
    return sendEmailSafely(
        {
            from: process.env.EMAIL_USER,
            to: applicantEmail,
            subject: `Application Received: ${selectedJob.title}`,
            html: applicantConfirmationHtml,
            attachments: [
                {
                    filename: 'managira.png',
                    path: path.join(__dirname, '../public/images/managira.png'),
                    cid: 'managira_logo'
                }
            ]
        },
        'Employment Applicant Confirmation Email (Retry)'
    );
};

const sendEmploymentInternalAlertEmail = async ({
    applicantFullName,
    applicantEmail,
    phone,
    location,
    selectedJob,
    applicationId,
    alertRecipient,
}) => {
    if (!alertRecipient) {
        return false;
    }

    const internalAlertHtml = renderCleanEmail({
        title: 'New Employment Application Received',
        greeting: 'Hello Team,',
        paragraphs: [
            'People are applying. A new employment application has been submitted.',
            'Please review this application from the Admin Employment page.',
        ],
        details: [
            { label: 'Position', value: selectedJob.title },
            { label: 'Applicant', value: applicantFullName },
            { label: 'Email', value: applicantEmail },
            { label: 'Phone', value: phone },
            { label: 'Location', value: location },
            { label: 'Application ID', value: applicationId ? `#${applicationId}` : 'Submitted' },
        ],
    });

    return sendEmailSafely(
        {
            from: process.env.EMAIL_USER,
            to: alertRecipient,
            subject: `New Application: ${selectedJob.title}`,
            html: internalAlertHtml,
            attachments: [
                {
                    filename: 'managira.png',
                    path: path.join(__dirname, '../public/images/managira.png'),
                    cid: 'managira_logo'
                }
            ]
        },
        'Employment New Application Alert Email'
    );
};

const legalController = {
    aboutUs: (req, res) => {
        res.render('legal&Compliance/AboutUs', { 
            title: 'About Managira - School Management That Actually Works',
            description: 'Real school management software built for schools tired of spreadsheets and disconnected systems. Simple setup, reliable operations, and actual support from people who understand schools.',
            keywords: 'managira about us, school management software, education management system, student information system, school administration',
            canonicalUrl: 'https://www.managira.com/legal/about-us',
            showFooterTopSection: true
        });
    },
    
    faq: (req, res) => {
        res.render('legal&Compliance/FAQ', { 
            title: 'FAQ',
            showFooterTopSection: true
        });
    },

    getHelp: (req, res) => {
        res.render('legal&Compliance/Help', {
            title: 'Help',
            success: req.flash('success'),
            messages: req.flash(),
            error: req.flash('error'),
            showFooterTopSection: true
        });
    },

    postHelp: async (req, res) => {
        const { name, organization, phone, email, message } = req.body;
    
        try {
            if (!name || !email || !message) {
                req.flash('error', 'Name, Email, and Message are required.');
                return res.redirect('/legal/help');
            }
    
            // Create a new thread
            const newThread = await db.query(
                `INSERT INTO help_threads (name, organization, email, phone) 
                 VALUES ($1, $2, $3, $4) RETURNING id`,
                [name, organization || null, email, phone || null]
            );
    
            const threadId = newThread.rows[0].id;
    
            // Insert the customer's message
            await db.query(
                `INSERT INTO help_messages (thread_id, name, email, message, is_response) 
                 VALUES ($1, $2, $3, $4, false)`, // `is_response` is `false` for customer
                [threadId, name, email, message]
            );
    
            const html = renderCleanEmail({
                title: `Support Ticket Created (#${threadId})`,
                greeting: `Dear <strong>${name}</strong>,`,
                paragraphs: [
                    'Thank you for reaching out. Your support ticket has been created and our team will respond shortly.',
                ],
                details: [
                    { label: 'Ticket Number', value: `#${threadId}` },
                    { label: 'Your Message', value: message },
                ],
            });

            const emailSent = await sendEmailSafely({
                from: process.env.EMAIL_USER,
                to: email,
                subject: `Support Ticket Created - Ticket #${threadId}`,
                html,
                attachments: [
                  {
                    filename: 'managira.png',
                    path: require('path').join(__dirname, '../public/images/managira.png'),
                    cid: 'managira_logo'
                  }
                ]
            }, 'Legal Help Confirmation Email');

            if (!emailSent) {
                req.flash('error', 'Help request submitted, but confirmation email could not be sent.');
            } else {
                req.flash('success', 'Help request submitted successfully.');
            }
            res.redirect('/legal/help');
        } catch (error) {
                        req.flash('error', 'Failed to submit your request.');
            res.redirect('/legal/help');
        }
    },

    employmentPage: async (req, res) => {
        await ensureEmploymentSchema(db);

        const jobs = await db.query(`
            SELECT
                e.*,
                COALESCE(a.application_count, 0)::int AS application_count
            FROM employment e
            LEFT JOIN (
                SELECT employment_id, COUNT(*) AS application_count
                FROM employment_applications
                GROUP BY employment_id
            ) a ON a.employment_id = e.id
            WHERE e.is_active = TRUE
            ORDER BY e.created_at DESC
        `);
        res.render('legal&Compliance/employment', {
            title: 'Job Posting',
            jobs: jobs.rows,
            messages: req.flash(),
            showFooterTopSection: true
        });
    },

    submitEmploymentApplication: async (req, res) => {
        await ensureEmploymentSchema(db);

        const employmentId = Number.parseInt(req.params.id, 10);
        const {
            first_name,
            last_name,
            email,
            phone,
            location,
            whatsapp_number,
            cover_letter_note,
            has_institution_experience,
            institution_experience_name,
            contact_via_text,
            contact_via_email,
        } = req.body;
        const resume = req.files?.resume?.[0];
        const coverLetterFile = req.files?.cover_letter_file?.[0];

        if (!Number.isInteger(employmentId)) {
            req.flash('error', 'Invalid job selected.');
            return res.redirect('/legal/employment');
        }

        try {
            const jobResult = await db.query(
                `SELECT id, title, application_mode FROM employment WHERE id = $1`,
                [employmentId]
            );

            if (!jobResult.rows.length) {
                req.flash('error', 'This job posting no longer exists.');
                return res.redirect('/legal/employment');
            }

            const selectedJob = jobResult.rows[0];
            if (selectedJob.application_mode !== 'in_app') {
                req.flash('error', 'This role only accepts external applications.');
                return res.redirect('/legal/employment');
            }

            if (!first_name || !last_name || !email || !phone || !location || !resume) {
                req.flash('error', 'Please complete all required fields and upload your resume.');
                return res.redirect('/legal/employment');
            }

            const wantsText = contact_via_text === 'on';
            const wantsEmail = contact_via_email === 'on';
            const hasInstitutionExperience = has_institution_experience === 'yes';
            const normalizedInstitutionName = institution_experience_name ? institution_experience_name.trim() : '';

            if (hasInstitutionExperience && !normalizedInstitutionName) {
                req.flash('error', 'Please enter the institution name if you selected yes.');
                return res.redirect('/legal/employment');
            }

            if (!hasInstitutionExperience && normalizedInstitutionName) {
                req.flash('error', 'Institution name should only be entered when you select yes.');
                return res.redirect('/legal/employment');
            }

            if (!wantsText && !wantsEmail) {
                req.flash('error', 'Select at least one preferred contact method (text or email).');
                return res.redirect('/legal/employment');
            }

            const [uploadedResume, uploadedCoverLetter] = await Promise.all([
                uploadToS3(resume),
                coverLetterFile ? uploadToS3(coverLetterFile) : Promise.resolve(null),
            ]);
            const normalizedCoverLetterNote = cover_letter_note
                ? cover_letter_note.trim()
                : (coverLetterFile ? 'Cover letter uploaded as document.' : 'No cover letter provided.');

            const savedApplication = await db.query(
                `INSERT INTO employment_applications (
                    employment_id,
                    first_name,
                    last_name,
                    email,
                    phone,
                    location,
                    whatsapp_number,
                    has_institution_experience,
                    institution_experience_name,
                    contact_via_text,
                    contact_via_email,
                    cover_letter,
                    resume_url,
                    resume_s3_key,
                    resume_filename,
                    cover_letter_url,
                    cover_letter_s3_key,
                    cover_letter_filename
                ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18)
                RETURNING id, created_at`,
                [
                    employmentId,
                    first_name.trim(),
                    last_name.trim(),
                    email.trim().toLowerCase(),
                    phone.trim(),
                    location.trim(),
                    whatsapp_number ? whatsapp_number.trim() : null,
                    hasInstitutionExperience,
                    hasInstitutionExperience ? normalizedInstitutionName : null,
                    wantsText,
                    wantsEmail,
                    normalizedCoverLetterNote,
                    uploadedResume.Location,
                    uploadedResume.Key,
                    resume.originalname || null,
                    uploadedCoverLetter ? uploadedCoverLetter.Location : null,
                    uploadedCoverLetter ? uploadedCoverLetter.Key : null,
                    coverLetterFile ? coverLetterFile.originalname : null,
                ]
            );

            const applicationId = savedApplication.rows[0]?.id;
            const applicantFullName = `${first_name.trim()} ${last_name.trim()}`;
            const normalizedApplicantEmail = email.trim().toLowerCase();
            const alertRecipient = process.env.EMPLOYMENT_ALERT_EMAIL || process.env.EMAIL_USER;

            // Keep request fast: both applicant confirmation and internal alert are asynchronous.
            setImmediate(() => {
                Promise.allSettled([
                    sendEmploymentApplicantConfirmationEmail({
                        applicantFullName,
                        applicantEmail: normalizedApplicantEmail,
                        location: location.trim(),
                        selectedJob,
                        applicationId,
                    }),
                    sendEmploymentInternalAlertEmail({
                        applicantFullName,
                        applicantEmail: normalizedApplicantEmail,
                        phone: phone.trim(),
                        location: location.trim(),
                        selectedJob,
                        applicationId,
                        alertRecipient,
                    }),
                ]).catch(() => {
                    // Intentionally swallow background email errors to avoid impacting UX.
                });
            });

            req.flash('success', `Application submitted for ${selectedJob.title}. We will be in touch. Follow us on LinkedIn for more information.`);
            return res.redirect('/legal/employment');
        } catch (error) {
            req.flash('error', 'Could not submit application right now. Please try again.');
            return res.redirect('/legal/employment');
        }
    },

    donationsPage: async (req, res) => {
        const donations = await db.query(`SELECT * FROM donations ORDER BY created_at DESC`);
        res.render('legal&Compliance/donations', { 
            title: 'Donations', 
            donations: donations.rows,
            showFooterTopSection: true
        });
    },
        
    privacyPolicy: (req, res) => {
        res.render('legal&Compliance/PrivacyPolicy', { 
            title: 'Privacy Policy',
            showFooterTopSection: true
        });
    },
    
    termsOfService: (req, res) => {
        res.render('legal&Compliance/TermsofService', { 
            title: 'Terms of Service',
            showFooterTopSection: true
        });
    },

    directory: async (req, res) => {
        try {
            const optionalColumns = ['nickname', 'subdomain', 'logo', 'logo_path', 'city', 'country', 'theme_color', 'deleted'];
            const columnsResult = await db.query(
                `SELECT column_name
                 FROM information_schema.columns
                 WHERE table_schema = 'public'
                   AND table_name = 'organizations'
                   AND column_name = ANY($1::text[])`,
                [optionalColumns]
            );

            const availableColumns = new Set(columnsResult.rows.map(row => row.column_name));
            const hasDeleted = availableColumns.has('deleted');
            const hasNickname = availableColumns.has('nickname');
            const hasSubdomain = availableColumns.has('subdomain');

            const result = await db.query(
                `SELECT
                    organization_id,
                    organization_name,
                    ${hasNickname ? 'nickname' : 'NULL::text AS nickname'},
                    ${hasSubdomain ? 'subdomain' : 'NULL::text AS subdomain'},
                    ${availableColumns.has('logo') ? 'logo' : 'NULL::text AS logo'},
                    ${availableColumns.has('logo_path') ? 'logo_path' : 'NULL::text AS logo_path'},
                    ${availableColumns.has('city') ? 'city' : 'NULL::text AS city'},
                    ${availableColumns.has('country') ? 'country' : 'NULL::text AS country'},
                    ${availableColumns.has('theme_color') ? 'theme_color' : 'NULL::text AS theme_color'}
                 FROM organizations
                 ${hasDeleted ? 'WHERE deleted = false' : ''}
                 ORDER BY organization_name ASC`
            );
            const resolveLogoUrl = (...candidates) => {
                const fallbackLogo = '/images/profilePlaceholder.png';
                const value = candidates.find(item => typeof item === 'string' && item.trim());
                if (!value) return fallbackLogo;

                const normalized = value.trim();
                if (!normalized) return fallbackLogo;

                const lower = normalized.toLowerCase();
                if (
                    lower === 'profileplaceholder.png' ||
                    lower.endsWith('/profileplaceholder.png') ||
                    lower.endsWith('\\profileplaceholder.png')
                ) {
                    return fallbackLogo;
                }

                if (/^https?:\/\//i.test(normalized)) return normalized;

                const bucketName = process.env.S3_BUCKET_NAME;
                if (!normalized.startsWith('/') && bucketName && /^images\//i.test(normalized)) {
                    return `https://${bucketName}.s3.amazonaws.com/${normalized}`;
                }

                return normalized.startsWith('/') ? normalized : `/${normalized}`;
            };

            const orgs = result.rows.map(org => {
                const isProduction = process.env.NODE_ENV === 'production';
                const orgSlug = org.nickname || org.subdomain || '';
                return {
                    ...org,
                    nickname: orgSlug || null,
                    logo_url: resolveLogoUrl(org.logo, org.logo_path),
                    public_url: isProduction 
                        ? (orgSlug ? `https://${orgSlug}.managira.com` : `/common/publicDashboard?organizationId=${org.organization_id}`)
                        : `/common/publicDashboard?organizationId=${org.organization_id}`
                };
            });

            const baseSiteUrl = 'https://www.managira.com';
            const toAbsoluteUrl = (value) => {
                if (!value) return null;
                if (/^https?:\/\//i.test(value)) return value;
                const normalizedPath = value.startsWith('/') ? value : `/${value}`;
                return `${baseSiteUrl}${normalizedPath}`;
            };

            const structuredData = {
                '@context': 'https://schema.org',
                '@graph': [
                    {
                        '@type': 'CollectionPage',
                        name: 'Managira School Directory',
                        url: 'https://www.managira.com/legal/directory',
                        description: 'Find schools on Managira by school name, nickname, or public URL.',
                        keywords: 'school management system, school management software, school directory, school portal, school ERP, education management software',
                        potentialAction: {
                            '@type': 'SearchAction',
                            target: 'https://www.managira.com/legal/directory?q={search_term_string}',
                            'query-input': 'required name=search_term_string'
                        }
                    },
                    {
                        '@type': 'ItemList',
                        name: 'Managira Organization Directory',
                        description: 'Directory of schools using Managira with searchable school names, nicknames, and public URLs.',
                        itemListElement: orgs.slice(0, 200).map((org, index) => ({
                            '@type': 'ListItem',
                            position: index + 1,
                            item: {
                                '@type': 'School',
                                name: org.organization_name,
                                alternateName: org.nickname || undefined,
                                url: org.public_url.startsWith('http') ? org.public_url : `${baseSiteUrl}${org.public_url}`,
                                logo: toAbsoluteUrl(org.logo_url) || `${baseSiteUrl}/images/profilePlaceholder.png`,
                                image: toAbsoluteUrl(org.logo_url) || `${baseSiteUrl}/images/profilePlaceholder.png`
                            }
                        }))
                    }
                ]
            };

            res.render('legal&Compliance/directory', {
                title: 'School Directory | School Management System | Managira',
                description: 'School directory on Managira. Find schools by full school name, nickname, or URL. Discover school websites, portals, and public updates.',
                keywords: 'school management system, school management software, management system for schools, school directory, school portal, school website, school ERP software, find school by name, school nickname search, school URL search, education management software, schools on managira',
                canonicalUrl: 'https://www.managira.com/legal/directory',
                organizations: orgs,
                structuredData,
                showFooterTopSection: true
            });
        } catch (err) {
            console.error('Directory page error:', err);
            res.status(500).send('Error loading directory');
        }
    }
};

module.exports = legalController;
