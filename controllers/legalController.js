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
    }
};

module.exports = legalController;
