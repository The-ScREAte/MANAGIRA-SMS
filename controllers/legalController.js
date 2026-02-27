const nodemailer = require('nodemailer');
const db = require('../config/db');
const { sendEmailSafely, renderCleanEmail } = require('../utils/emailHelper');

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
        const jobs = await db.query(`SELECT * FROM employment ORDER BY created_at DESC`);
        res.render('legal&Compliance/employment', { 
            title: 'Employment Opportunities', 
            jobs: jobs.rows,
            showFooterTopSection: true
        });
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
            const optionalColumns = ['nickname', 'subdomain', 'logo_path', 'city', 'country', 'theme_color', 'deleted'];
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
                    ${availableColumns.has('logo_path') ? 'logo_path' : 'NULL::text AS logo_path'},
                    ${availableColumns.has('city') ? 'city' : 'NULL::text AS city'},
                    ${availableColumns.has('country') ? 'country' : 'NULL::text AS country'},
                    ${availableColumns.has('theme_color') ? 'theme_color' : 'NULL::text AS theme_color'}
                 FROM organizations
                 ${hasDeleted ? 'WHERE deleted = false' : ''}
                 ORDER BY organization_name ASC`
            );
            const orgs = result.rows.map(org => {
                const isProduction = process.env.NODE_ENV === 'production';
                const orgSlug = org.nickname || org.subdomain || '';
                return {
                    ...org,
                    nickname: orgSlug || null,
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
                                logo: toAbsoluteUrl(org.logo_path) || `${baseSiteUrl}/images/profilePlaceholder.png`,
                                image: toAbsoluteUrl(org.logo_path) || `${baseSiteUrl}/images/profilePlaceholder.png`
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
