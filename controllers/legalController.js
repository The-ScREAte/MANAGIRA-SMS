const nodemailer = require('nodemailer');
const db = require('../config/db');

const legalController = {
    aboutUs: (req, res) => {
        res.render('legal&Compliance/AboutUs', { 
            title: 'About Us - Managira | School Management Platform',
            description: 'Learn about Managira\'s mission to revolutionize school management through automation, communication tools, and data-driven insights for educational institutions.',
            keywords: 'managira about us, school management platform, education technology, school administration software',
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
    
            // Send confirmation email
            const transporter = nodemailer.createTransport({
                host: process.env.SMTP_HOST,           // e.g., smtp.gmail.com, smtp.zoho.com
                port: parseInt(process.env.SMTP_PORT), // usually 465 or 587
                secure: process.env.SMTP_SECURE === 'true', // true for 465, false for 587
                auth: {
                  user: process.env.ADMIN_NOTIFY_EMAIL_USER,
                  pass: process.env.ADMIN_NOTIFY_EMAIL_PASSWORD,
                },
              });
    
            const mailOptions = {
                from: process.env.EMAIL_USER,
                to: email,
                subject: `Support Ticket Created - Ticket #${threadId}`,
                text: `Dear ${name},\n\nThank you for reaching out. Your support ticket (#${threadId}) has been created. Our team will respond shortly.\n\nMessage: "${message}"\n\nBest regards,\nSupport Team`,
            };
    
            transporter.sendMail(mailOptions, (error) => {
                if (error) {
                    req.flash('error', 'Failed to send confirmation email.');
                } else {
                    req.flash('success', 'Help request submitted successfully.');
                }
                res.redirect('/legal/help');
            });
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
