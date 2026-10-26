const nodemailer = require('nodemailer');
const db = require('../config/db');
const path = require('path');
const { uploadToS3 } = require('../config/s3');
const { sendEmailSafely, sendEmailInBackground, renderCleanEmail } = require('../utils/emailHelper');
const { ensureEmploymentSchema } = require('../utils/employmentSchema');
const { checkAntiSpam } = require('../utils/formAntiSpam');

const sendWithSingleRetry = async (sendFn) => {
    const firstAttempt = await sendFn();
    if (firstAttempt) {
        return true;
    }
    return sendFn();
};

const sendEmploymentApplicantConfirmationEmail = async ({
    applicantFullName,
    applicantEmail,
    location,
    selectedJob,
    applicationId,
}) => {
    const linkedinUrl = process.env.MANAGIRA_LINKEDIN_URL || 'https://www.linkedin.com/company/managira';
    const applicantConfirmationHtml = renderCleanEmail({
        title: 'Employment Application Received',
        greeting: `Dear <strong>${applicantFullName}</strong>,`,
        paragraphs: [
            `Thank you for applying for the <strong>${selectedJob.title}</strong> role at Managira.`,
            'Your application has been received successfully, and our team will review it.',
        ],
        details: [
            { label: 'Application ID', value: applicationId ? `#${applicationId}` : 'Submitted' },
            { label: 'Position', value: selectedJob.title },
            { label: 'Location', value: location },
        ],
        followManagira: true,
        linkedinUrl,
    });

    sendEmailInBackground(
        {
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

    sendEmailInBackground(
        {
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
    productCategoryPage: (req, res) => {
        const categories = {
            family: {
                key: 'family',
                title: 'Family Connections',
                shortDescription: 'Connect families, school teams, and the public in one communication flow. Strengthen trust through clear updates and shared visibility.',
                image: '/images/products-home-connections.png',
                items: [
                    {
                        key: 'student-records-attendance',
                        title: 'Student Records & Attendance',
                        description: 'Manage student profiles and class attendance in one place so academic and operational teams work from the same source of truth.',
                        whatItDoes: 'Managira combines student profile management with attendance tracking so schools can keep identity details, class placement, and attendance history aligned inside the same operational workflow. This reduces fragmented record keeping and supports cleaner handoffs between school offices and teaching teams.',
                        howItWorks: 'Schools maintain student records through management and student detail flows, then mark attendance by class and date using permission-aware attendance workflows. Attendance history remains linked to the learner profile and can feed broader reporting.',
                        whyItMatters: 'When student records and attendance are disconnected, interventions happen late. Keeping both together helps schools act faster on absence trends, improve data accuracy, and keep parents informed with confidence.',
                        sources: [
                            'MANAGIRA_INTRODUCTION_AND_SYSTEM_OVERVIEW.md: Sections 1.2, 10.1-10.6',
                            'help-content-audit-table.csv: Rows 5 and 10'
                        ]
                    },
                    {
                        key: 'parent-portal',
                        title: 'Parent Portal',
                        description: 'Give guardians a dedicated portal for child information, academic visibility, and direct school communication.',
                        whatItDoes: 'The Parent Portal gives families secure, role-scoped access to student-facing information and communication workflows. Guardians can review relevant child data and interact with the school through structured report and feedback channels.',
                        howItWorks: 'Guardians sign in through dedicated guardian authentication routes and access dashboard, student, and academic pages where enabled. Schools also manage guardian-to-student linking from internal guardian management tools to keep access correct.',
                        whyItMatters: 'Family engagement improves when parents can see reliable, current information without waiting for manual updates. The portal reduces communication gaps and builds trust through transparency.',
                        sources: [
                            'MANAGIRA_INTRODUCTION_AND_SYSTEM_OVERVIEW.md: Sections 1.4, 9.5, 11.4',
                            'help-content-audit-table.csv: Rows 20, 21, and 22'
                        ]
                    },
                    {
                        key: 'student-portal',
                        title: 'Student Portal',
                        description: 'Provide students with guided access to school information and academic progress in a secure, role-aware environment.',
                        whatItDoes: 'Managira supports student-facing access patterns so learners can engage with their academic journey through a structured platform experience. This keeps student access aligned with institution policy and configured permissions.',
                        howItWorks: 'Student access follows the platform\'s layered identity and authorization model, with school-defined configuration controlling what is visible. Student-facing experiences are part of the broader role-driven workflow model used across the platform.',
                        whyItMatters: 'When students can independently check key information, administrative interruptions reduce and ownership increases. It also helps schools maintain a consistent digital experience across staff, learners, and families.',
                        sources: [
                            'MANAGIRA_INTRODUCTION_AND_SYSTEM_OVERVIEW.md: Sections 1.3, 2.6, 5.2',
                            'help-content-audit-table.csv: Context from guardian/student access workflows'
                        ]
                    },
                    {
                        key: 'communication',
                        title: 'Communication',
                        description: 'Coordinate parent communication through structured school channels instead of disconnected messages.',
                        whatItDoes: 'Communication in Managira spans parent-school records, announcements, events, and support-linked messaging paths. The platform also supports email pipelines and asynchronous communication infrastructure for continuity.',
                        howItWorks: 'Schools publish announcements/events from management workflows, guardians submit reports through portal routes, and support/notification operations run through managed email and background processing patterns.',
                        whyItMatters: 'Clear communication reduces misunderstandings, improves response speed, and strengthens school-family relationships, especially during high-volume periods like admissions, exams, and term close.',
                        sources: [
                            'MANAGIRA_INTRODUCTION_AND_SYSTEM_OVERVIEW.md: Sections 7.2, 11.4, 14.1-14.4, 16.4',
                            'help-content-audit-table.csv: Rows 22 and 23'
                        ]
                    },
                    {
                        key: 'student-management',
                        title: 'Student Management',
                        description: 'Create, edit, organize, archive, and maintain complete student records through the full student lifecycle.',
                        whatItDoes: 'Student Management centralizes core learner data, class alignment, guardian linkage, and profile updates in one operational module. It supports both active student management and archive flows for lifecycle continuity.',
                        howItWorks: 'Authorized users manage student records from records and student detail views, edit profile fields, and archive/unarchive as needed without losing historical continuity.',
                        whyItMatters: 'A strong student management foundation improves every downstream workflow, including attendance, assessment, reporting, promotions, and admissions decisions.',
                        sources: [
                            'MANAGIRA_INTRODUCTION_AND_SYSTEM_OVERVIEW.md: Sections 1.2, 2.7, 12.5',
                            'help-content-audit-table.csv: Rows 5 and 6'
                        ]
                    },
                    {
                        key: 'role-based-access-control',
                        title: 'Role-Based Access Control',
                        description: 'Protect sensitive school data by giving each role only the access needed for their responsibilities.',
                        whatItDoes: 'Managira enforces layered access using session identity, role context, permission keys, and feature checks. Managers, supervisors, teachers, and class-level leads each operate within controlled boundaries.',
                        howItWorks: 'Permission middleware and role baselines gate routes and actions across modules, while assignment-specific checks further control class workflows and document/file visibility.',
                        whyItMatters: 'Role-based access improves privacy, governance, and auditability while still enabling delegation. It is essential for scaling operations without overexposing student or finance data.',
                        sources: [
                            'MANAGIRA_INTRODUCTION_AND_SYSTEM_OVERVIEW.md: Sections 2.6, 5.1-5.10'
                        ]
                    },
                    {
                        key: 'assessment-tracking',
                        title: 'Assessment Tracking',
                        description: 'Design assessments, capture scores, and keep grading workflows consistent across classes and terms.',
                        whatItDoes: 'Assessment Tracking supports custom assessment design, controlled edit windows, teacher score entry, and persistent storage of academic outcomes for reporting continuity.',
                        howItWorks: 'Schools define assessments and grading structures, teachers enter scores through assessment workflows, and records remain available for report generation and transcript-related outputs.',
                        whyItMatters: 'Reliable assessment workflows reduce grading inconsistency and provide the academic evidence needed for reports, progression decisions, and parent communication.',
                        sources: [
                            'MANAGIRA_INTRODUCTION_AND_SYSTEM_OVERVIEW.md: Sections 9.1-9.6',
                            'help-content-audit-table.csv: Rows 11, 12, 13, and 14'
                        ]
                    },
                    {
                        key: 'detailed-reports',
                        title: 'Detailed Reports',
                        description: 'Generate report cards and operational views from stored academic and attendance data.',
                        whatItDoes: 'Reporting tools provide school-level visibility, class-level output, and student report production using platform data. Reports can be prepared for print workflows and digital sharing where configured.',
                        howItWorks: 'Authorized users confirm the active term and data completeness, then use report hubs and report-generation workflows to produce review-ready outputs.',
                        whyItMatters: 'Strong reporting turns daily school activity into decision-ready insight for school leadership, educators, and families.',
                        sources: [
                            'MANAGIRA_INTRODUCTION_AND_SYSTEM_OVERVIEW.md: Sections 11.1-11.5',
                            'help-content-audit-table.csv: Row 15'
                        ]
                    },
                    {
                        key: 'multi-school-analytics',
                        title: 'Multi-School Analytics',
                        description: 'Support network-level oversight for hub operators coordinating multiple schools.',
                        whatItDoes: 'Multi-school analytics in the Managira model combines hub-level organization context, dashboard visibility, and activity tracking to help operators monitor distributed school operations.',
                        howItWorks: 'Hub workflows and organization dashboards provide comparative and operational visibility, while invitation and membership tools maintain clear structure for participating schools.',
                        whyItMatters: 'For school networks, centralized visibility reduces blind spots, improves governance, and enables faster decision-making across institutions.',
                        sources: [
                            'MANAGIRA_INTRODUCTION_AND_SYSTEM_OVERVIEW.md: Sections 2.5 and 2.4',
                            'help-content-audit-table.csv: Rows 31 and 32',
                            'HUB_INVITATION_ENHANCED.md: Overview and search/invitation flow'
                        ]
                    },
                    {
                        key: 'school-website',
                        title: 'School Website',
                        description: 'Manage a professional public school website from inside the same platform used for daily operations.',
                        whatItDoes: 'The School Website module gives schools a public communication surface for announcements, events, branding, admissions visibility, and institutional storytelling without separate web development overhead.',
                        howItWorks: 'Authorized users update public content, layout, and theme from account-side website management tools, then publish changes for public visibility.',
                        whyItMatters: 'A modern public website strengthens trust, improves discoverability, and creates a consistent front door for families and prospective applicants.',
                        sources: [
                            'MANAGIRA_INTRODUCTION_AND_SYSTEM_OVERVIEW.md: Sections 7.1-7.8',
                            'help-content-audit-table.csv: Rows 2, 23, and 24'
                        ]
                    },
                    {
                        key: 'online-admissions',
                        title: 'Online Admissions',
                        description: 'Let families apply online and move applications through structured review and approval workflows.',
                        whatItDoes: 'Online Admissions links public application capture with internal review, decisioning, and enrollment continuity. Schools can run both self-admission and school-managed intake pathways.',
                        howItWorks: 'Families submit via public registration routes, applications enter pending queues, and authorized staff review, edit, approve, or reject before final student activation.',
                        whyItMatters: 'Digital admissions reduce queue pressure, improve intake quality, and give schools clearer visibility into application pipelines.',
                        sources: [
                            'MANAGIRA_INTRODUCTION_AND_SYSTEM_OVERVIEW.md: Sections 8.1-8.10',
                            'help-content-audit-table.csv: Rows 7 and 8'
                        ]
                    },
                    {
                        key: 'event-announcement-updates',
                        title: 'Event & Announcement Updates',
                        description: 'Publish timely events and announcements for both internal dashboards and public-facing communication.',
                        whatItDoes: 'Event and announcement management provides one controlled workspace for creating, updating, and publishing school updates that can surface across relevant channels.',
                        howItWorks: 'Users manage announcements/events from dedicated management routes and publish updates to dashboards and public website sections where configured.',
                        whyItMatters: 'Consistent updates improve transparency, reduce misinformation, and keep families aligned with academic calendars and school priorities.',
                        sources: [
                            'MANAGIRA_INTRODUCTION_AND_SYSTEM_OVERVIEW.md: Sections 7.4 and 7.7',
                            'help-content-audit-table.csv: Row 23'
                        ]
                    },
                    {
                        key: 'merit-sheets',
                        title: 'Merit Sheets',
                        description: 'Produce merit sheets from validated academic data to support term-end recognition and reporting.',
                        whatItDoes: 'Merit sheet workflows are part of Managira\'s broader report generation capabilities, allowing schools to create structured academic outputs from recorded student performance.',
                        howItWorks: 'Schools complete assessments and attendance context, then generate merit/report outputs through reporting and print-oriented workflows.',
                        whyItMatters: 'Merit sheets make recognition processes fairer and more transparent by relying on centralized academic records.',
                        sources: [
                            'MANAGIRA_INTRODUCTION_AND_SYSTEM_OVERVIEW.md: Sections 11.1-11.3',
                            'help-content-audit-table.csv: Row 15'
                        ]
                    },
                    {
                        key: 'official-transcript',
                        title: 'Official Transcript',
                        description: 'Generate transcript-style academic history with options for review, signature, print, and email delivery.',
                        whatItDoes: 'Transcript workflows compile student academic history into formal output suitable for school records and authorized sharing. Signature and email support are included where configured.',
                        howItWorks: 'Authorized users open transcript tools for a student, validate output, attach required signature assets, and then print, download, or email the transcript.',
                        whyItMatters: 'Official transcripts are high-trust documents; standardized generation improves consistency, compliance, and confidence in external-facing academic records.',
                        sources: [
                            'MANAGIRA_INTRODUCTION_AND_SYSTEM_OVERVIEW.md: Sections 1.6 and 11.3',
                            'help-content-audit-table.csv: Row 16'
                        ]
                    },
                    {
                        key: 'employee-management',
                        title: 'Employee Management',
                        description: 'Create staff accounts, assign roles, and manage permissions aligned to each team member\'s duties.',
                        whatItDoes: 'Employee Management centralizes staff onboarding, updates, and role assignment so schools can maintain controlled access and clear accountability.',
                        howItWorks: 'Authorized users manage staff through employee routes, configure role/permission settings, and maintain class or operational assignments as school structures evolve.',
                        whyItMatters: 'Schools scale better when staff access is intentional. This module reduces security risk and keeps workflows aligned to real responsibilities.',
                        sources: [
                            'MANAGIRA_INTRODUCTION_AND_SYSTEM_OVERVIEW.md: Sections 5.3-5.10',
                            'help-content-audit-table.csv: Rows 18 and 19'
                        ]
                    },
                    {
                        key: 'finance-management',
                        title: 'Finance Management',
                        description: 'Coordinate school billing, payment collection, and financial visibility through integrated finance workflows.',
                        whatItDoes: 'Finance Management combines bill setup, payment operations, and recurring/billing infrastructure so schools can move from manual fee tracking to structured financial workflows.',
                        howItWorks: 'Schools configure finance settings and bill templates, assign billing targets, process payments, and monitor balances using finance and Paygira workflows backed by scheduler/payment infrastructure.',
                        whyItMatters: 'Strong finance operations protect school sustainability by improving collection consistency, reconciliation, and parent payment visibility.',
                        sources: [
                            'MANAGIRA_INTRODUCTION_AND_SYSTEM_OVERVIEW.md: Sections 2.9 and 2.10',
                            'help-content-audit-table.csv: Rows 26, 27, and 28'
                        ]
                    },
                    {
                        key: 'digest-notification',
                        title: 'Digest Notification',
                        description: 'Use scheduled communication patterns to keep stakeholders updated on school activities and operational milestones.',
                        whatItDoes: 'Digest Notification represents Managira\'s scheduled and asynchronous communication capability, where schools can maintain continuity of updates through managed notification and email workflows.',
                        howItWorks: 'Background jobs and communication infrastructure handle recurring or asynchronous notification-related operations, while school updates originate from announcement, support, and workflow events.',
                        whyItMatters: 'Digest-style updates improve visibility without overwhelming recipients, helping families and staff stay informed about progress, events, and key actions over time.',
                        sources: [
                            'MANAGIRA_INTRODUCTION_AND_SYSTEM_OVERVIEW.md: Sections 2.10, 14.1-14.3, and 16.4',
                            'HUB_INVITATION_ENHANCED.md: Email notification templates and flow'
                        ]
                    },
                    {
                        key: 'questions-setter',
                        title: 'Questions Setter',
                        description: 'Set up structured questions and assessment prompts for controlled academic workflows.',
                        whatItDoes: 'Questions Setter helps schools define and organize assessment question sets so teaching teams can maintain consistency in tests and learning checks.',
                        howItWorks: 'Authorized users configure question structures within assessment workflows and align them to classes, subjects, and evaluation plans.',
                        whyItMatters: 'Standardized question setup improves assessment quality, makes review easier, and supports fairer measurement of student understanding.'
                    },
                    {
                        key: 'time-table',
                        title: 'Time Table',
                        description: 'Organize academic periods, classes, and activity timing into a clear schedule for students and staff.',
                        whatItDoes: 'Time Table support keeps daily and weekly school schedules structured so classes, teachers, and learners can follow one coordinated rhythm.',
                        howItWorks: 'Schools define timetable structures aligned to class and term context, then use schedule visibility to reduce clashes and confusion.',
                        whyItMatters: 'A reliable timetable improves punctuality, classroom readiness, and the overall learning environment.'
                    },
                    {
                        key: 'student-schedule-plan',
                        title: 'Student Schedule Plan',
                        description: 'Give families a clearer view of student plans and routine learning schedules.',
                        whatItDoes: 'Student Schedule Plan helps homes understand what students are expected to do and when, strengthening parent support for daily learning.',
                        howItWorks: 'School schedule and planning details are organized in student-facing or family-facing contexts so guardians can follow key routines.',
                        whyItMatters: 'When homes can see schedule plans, students get better support outside school and trust between school and family improves.'
                    },
                    {
                        key: 'paygira',
                        title: 'Paygira',
                        description: 'Run fee collection and payment workflows through Managira\'s integrated Paygira finance tools.',
                        whatItDoes: 'Paygira powers school billing and collections with structured payment workflows for administrators, staff, and guardians.',
                        howItWorks: 'Schools configure payment settings, create bills, and track collections in finance workflows connected to school operations.',
                        whyItMatters: 'Integrated collections reduce finance friction, improve visibility, and support sustainable school operations.'
                    }
                ]
            },
            student: {
                key: 'student',
                title: 'Student Success',
                shortDescription: 'Support student achievement with structured assessments, reports, and transcripts. Give homes clear, reliable insight into academic progress.',
                image: '/images/products-student-achievement.png',
                items: [
                    {
                        key: 'testing-room',
                        title: 'Testing Room',
                        description: 'Run assessments and exams digitally with structure, reliability, and better turnaround.'
                    },
                    {
                        key: 'google-classroom-integration',
                        title: 'Google Classroom Integration',
                        description: 'Bridge class workflows with Google tools and others so teachers and students stay in sync.'
                    },
                    {
                        key: 'analytics-reporting',
                        title: 'Analytics & Reporting',
                        description: 'Turn performance data into action with study timetable guidance, schedules, and progress visibility.'
                    }
                ]
            },
            operational: {
                key: 'operational',
                title: 'Operational Excellence',
                shortDescription: 'Run school operations with secure controls across staff, finance, and governance. Improve consistency and efficiency with centralized management.',
                image: '/images/products-operational-excellence.png',
                items: [
                    {
                        key: 'hub-management',
                        title: 'Hub Management',
                        description: 'Coordinate multiple schools from one dashboard with centralized controls and oversight.'
                    },
                    {
                        key: 'online-admissions',
                        title: 'Online Admissions',
                        description: 'Handle applications and enrollment more cleanly with structured workflows and tracking.'
                    },
                    {
                        key: 'finance-management',
                        title: 'Finance Management',
                        description: 'See billing and finance records together, plus report management and organization management.'
                    }
                ]
            }
        };

        // Re-group capabilities so each category matches the product narrative.
        const familyItemsByKey = new Map(categories.family.items.map((item) => [item.key, item]));
        const studentItemsByKey = new Map(categories.student.items.map((item) => [item.key, item]));
        const operationalItemsByKey = new Map(categories.operational.items.map((item) => [item.key, item]));

        const pick = (key) => familyItemsByKey.get(key) || studentItemsByKey.get(key) || operationalItemsByKey.get(key);

        categories.family.items = [
            pick('parent-portal'),
            pick('communication'),
            pick('school-website'),
            pick('online-admissions'),
            pick('event-announcement-updates'),
            pick('student-schedule-plan')
        ].filter(Boolean);

        categories.student.items = [
            pick('student-records-attendance'),
            pick('student-portal'),
            pick('assessment-tracking'),
            pick('testing-room'),
            pick('time-table'),
            pick('google-classroom-integration'),
            pick('analytics-reporting'),
            pick('detailed-reports'),
            pick('merit-sheets'),
            pick('official-transcript')
        ].filter(Boolean);

        categories.operational.items = [
            pick('student-management'),
            pick('role-based-access-control'),
            pick('employee-management'),
            pick('questions-setter'),
            pick('digest-notification'),
            pick('paygira'),
            pick('finance-management'),
            pick('multi-school-analytics'),
            pick('hub-management')
        ].filter(Boolean);

        const categoryAliases = {
            'family-connections': 'family',
            'home-connections': 'family',
            family: 'family',
            'student-success': 'student',
            'student-achievement': 'student',
            student: 'student',
            'operational-excellence': 'operational',
            operational: 'operational'
        };

        const requestedCategory = String(req.query.category || '').trim().toLowerCase();
        const categoryKey = categoryAliases[requestedCategory] || 'family';
        const activeCategory = categories[categoryKey];

        const requestedItem = String(req.query.item || '').trim().toLowerCase();
        const defaultItemKey = categoryKey === 'family' ? 'parent-portal' : activeCategory.items[0].key;
        const activeItem = activeCategory.items.find((entry) => entry.key === requestedItem)
            || activeCategory.items.find((entry) => entry.key === defaultItemKey)
            || activeCategory.items[0];

        res.render('legal&Compliance/productCategory', {
            title: `${activeCategory.title} - Managira`,
            description: activeCategory.shortDescription,
            activeCategory,
            activeItem,
            categoryTabs: Object.values(categories).map((entry) => ({ key: entry.key, title: entry.title })),
            showFooterTopSection: true
        });
    },

    aboutUs: (req, res) => {
        res.render('legal&Compliance/AboutUs', {
            title: 'About Managira - School Management That Actually Works',
            description: 'Real school management software built for schools tired of spreadsheets and disconnected systems. Simple setup, reliable operations, and actual support from people who understand schools.',
            keywords: 'managira about us, school management software, education management system, student information system, school administration',
            canonicalUrl: 'https://managira.com/legal/about-us',
            showFooterTopSection: true
        });
    },

    miraAiAssistant: (req, res) => {
        res.render('legal&Compliance/MiraAiAssistant', {
            title: 'Mira - The Educational Intelligence for Easy Management',
            description: 'Mira is Managira\'s built-in AI assistant - an educational intelligence that looks things up, drafts messages, and carries out real school-management tasks through a simple conversation, scoped to your own school and your own real permissions.',
            keywords: 'mira ai assistant, school ai assistant, education ai, managira ai, ai school management',
            canonicalUrl: 'https://managira.com/legal/mira-ai-assistant',
            isMarketingHeroPage: true,
            showFooterTopSection: true,
            // So Google/social previews for this page show the Mira logo
            // instead of the generic Managira share image.
            shareImage: 'https://managira.com/images/miralogo.png',
            shareImageWidth: '756',
            shareImageHeight: '692',
            shareImageType: 'image/png'
        });
    },
    
    faq: (req, res) => {
        let faqEntries = [];
        let faqCategories = [];
        try {
            const managiraFAQ = require('../utils/managiraFAQ');
            faqEntries = Array.isArray(managiraFAQ) ? managiraFAQ : [];
            const seen = new Set();
            for (const item of faqEntries) {
                if (item && item.category && !seen.has(item.category)) {
                    seen.add(item.category);
                    faqCategories.push(item.category);
                }
            }
        } catch (err) {
            console.error('FAQ knowledge load failed:', err);
        }
        res.render('legal&Compliance/FAQ', {
            title: 'Managira FAQ - School Management Software & Mira AI Questions Answered',
            description: 'Answers to common questions about Managira school management software and Mira, its built-in AI assistant - admissions, attendance, grading, billing, parent communication, and what Mira can do.',
            keywords: 'managira faq, mira ai faq, school management software questions, education ai assistant faq',
            canonicalUrl: 'https://managira.com/legal/faq',
            showFooterTopSection: true,
            faqEntries,
            faqCategories
        });
    },

    getHelp: (req, res) => {
        let helpKnowledge = [];
        try {
            const managiraFAQ = require('../utils/managiraFAQ');
            helpKnowledge = managiraFAQ.map(item => ({
                id: item.id,
                category: item.category,
                question: item.question,
                answer: item.answer,
                keywords: item.keywords || []
            }));
        } catch (e) {
            helpKnowledge = [];
        }

        const documentationResources = [
            { title: 'Full User Documentation', subtitle: 'Complete platform guide (Google Doc)', url: 'https://docs.google.com/document/d/1bgFP5cCQyr-9jdaYZTsWO8ONAnAuNUKqKQ2if_4TBOM/edit?usp=drivesdk', external: true, keywords: ['documentation', 'guide', 'manual', 'how to', 'tutorial', 'instructions', 'reference'] },
            { title: 'Walk Through Video', subtitle: 'Video tutorial playlist on YouTube', url: 'https://www.youtube.com/watch?v=y1J0KahfA-c&list=PLxNl6NDBQVL3A7mSgYcUKqTZ8WaB5IZOT&index=1&t=8s', external: true, keywords: ['video', 'walkthrough', 'tutorial', 'youtube', 'watch', 'demo video'] },
            { title: 'Single School Sign Up Steps', subtitle: 'Step-by-step PDF for new schools', url: '/managira%20pdf/Single%20school%20Sign%20Up%20steps.pdf', external: true, keywords: ['sign up', 'register', 'new school', 'onboarding', 'pdf', 'create account', 'getting started'] },
            { title: 'Managira Starter Pack', subtitle: 'Quick-start PDF resource', url: '/managira%20pdf/Managira%20Starter%20Pack.pdf', external: true, keywords: ['starter', 'quick start', 'pdf', 'beginner', 'first time'] },
            { title: 'Features Driving Managira Brochure', subtitle: 'Feature overview brochure (PDF)', url: '/managira%20pdf/Features%20driving%20managira%20Brochure.pdf', external: true, keywords: ['features', 'brochure', 'overview', 'capabilities', 'pdf'] },
            { title: 'User Documentation Hub', subtitle: 'All Managira guides in one page', url: '/legal/user-documentation', external: false, keywords: ['documentation hub', 'all guides', 'resources'] },
            { title: 'Request a Demo', subtitle: 'Schedule a personalised live demo', url: '/legal/request-demo', external: false, keywords: ['demo', 'request', 'sales', 'live demo', 'schedule', 'book'] },
            { title: 'Interactive App Demo', subtitle: 'Explore the visual product tour', url: '/legal/app-demo', external: false, keywords: ['app demo', 'product tour', 'preview', 'see app', 'try'] },
        ];

        res.render('legal&Compliance/Help', {
            title: 'Help Center - Managira',
            success: req.flash('success'),
            messages: req.flash(),
            error: req.flash('error'),
            helpKnowledge,
            documentationResources,
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

            const spamCheck = checkAntiSpam(req.body, { requireConfirm: true, minWords: 3, messageField: 'message' });
            if (!spamCheck.ok) {
                req.flash('error', spamCheck.reason);
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

            sendEmailInBackground({
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

            req.flash('success', 'Help request submitted successfully.');
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

            const normalizedApplicantEmail = email.trim().toLowerCase();

            const existingApplication = await db.query(
                `SELECT id
                 FROM employment_applications
                 WHERE employment_id = $1
                   AND lower(email) = $2
                 LIMIT 1`,
                [employmentId, normalizedApplicantEmail]
            );

            if (existingApplication.rows.length > 0) {
                req.flash('error', `You already applied for ${selectedJob.title}. Only one application per position is allowed.`);
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
                    normalizedApplicantEmail,
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
            const alertRecipient =
                process.env.EMPLOYMENT_ALERT_EMAIL ||
                process.env.ADMIN_NOTIFY_EMAIL_USER ||
                process.env.EMAIL_USER;

            // Keep request fast: trigger both emails in background without awaiting.
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
            ]).then((results) => {
                const [applicantResult, internalResult] = results;
                if (applicantResult?.status === 'rejected' || applicantResult?.value === false) {
                    console.error('[Employment Email] Applicant confirmation email failed for application', applicationId);
                }
                if (internalResult?.status === 'rejected' || internalResult?.value === false) {
                    console.error('[Employment Email] Internal alert email failed for application', applicationId);
                }
            }).catch((backgroundError) => {
                console.error('[Employment Email] Unexpected background email dispatcher failure:', backgroundError.message);
            });

            req.flash('success', `Application submitted for ${selectedJob.title}. We will be in touch. Follow us on LinkedIn for more information.`);
            return res.redirect('/legal/employment');
        } catch (error) {
            req.flash('error', 'Could not submit application right now. Please try again.');
            return res.redirect('/legal/employment');
        }
    },

    userDocumentation: (req, res) => {
        res.render('legal&Compliance/userDocumentation', {
            title: 'User Documentation - Managira School Management System',
            description: 'Complete user documentation for Managira school management system. Learn how to manage students, attendance, assessments, reports, promotions, admissions, and more.',
            keywords: 'managira user documentation, managira guide, school management guide, how to use managira, managira help, managira tutorial, managira Nigeria, school management Nigeria',
            canonicalUrl: 'https://managira.com/legal/user-documentation',
            showFooterTopSection: true
        });
    },


    requestDemoPage: (req, res) => {
        res.render('legal&Compliance/requestDemo', {
            title: 'Request a Demo - Managira',
            description: 'Request a personalised live demo of Managira and see how it can transform your school operations.',
            keywords: 'managira demo request, schedule demo, school management demo, book a demo',
            canonicalUrl: 'https://managira.com/legal/request-demo',
            success: req.flash('success'),
            error: req.flash('error'),
            messages: req.flash(),
            showFooterTopSection: true
        });
    },

    submitDemoRequest: async (req, res) => {
        const {
            name,
            organization,
            role,
            email,
            phone,
            country,
            student_count,
            preferred_date,
            preferred_time,
            message,
        } = req.body;

        try {
            if (!name || !email || !organization) {
                req.flash('error', 'Name, Email, and Organisation are required to request a demo.');
                return res.redirect('/legal/request-demo');
            }

            const trimmedMessage = (message || '').trim();
            if (trimmedMessage.length < 20) {
                req.flash('error', 'Please tell us what you would like to know — at least 20 characters so we can tailor the demo.');
                return res.redirect('/legal/request-demo');
            }

            // Anti-spam: require the note and a minimum of 5 words.
            const spamCheck = checkAntiSpam(req.body, {
                requireConfirm: true,
                minWords: 5,
                messageField: 'message',
            });
            if (!spamCheck.ok) {
                req.flash('error', spamCheck.reason);
                return res.redirect('/legal/request-demo');
            }

            // Compose a structured message that mirrors what Help Center stores.
            // Prefix [DEMO REQUEST] so admins can distinguish demo vs help tickets at a glance.
            const composedMessage = [
                `[DEMO REQUEST] from ${name}`,
                organization ? `Organisation: ${organization}` : null,
                role ? `Role: ${role}` : null,
                country ? `Country: ${country}` : null,
                student_count ? `Approx. students: ${student_count}` : null,
                preferred_date ? `Preferred date: ${preferred_date}` : null,
                preferred_time ? `Preferred time: ${preferred_time}` : null,
                '',
                'Message:',
                message ? message.trim() : '(No additional message provided)',
            ].filter(Boolean).join('\n');

            const newThread = await db.query(
                `INSERT INTO help_threads (name, organization, email, phone)
                 VALUES ($1, $2, $3, $4) RETURNING id`,
                [name, organization || null, email, phone || null]
            );

            const threadId = newThread.rows[0].id;

            await db.query(
                `INSERT INTO help_messages (thread_id, name, email, message, is_response)
                 VALUES ($1, $2, $3, $4, false)`,
                [threadId, name, email, composedMessage]
            );

            const html = renderCleanEmail({
                title: `Demo Request Received (#${threadId})`,
                greeting: `Dear <strong>${name}</strong>,`,
                paragraphs: [
                    'Thanks for requesting a Managira demo. Our team will reach out shortly to schedule a personalised walkthrough.',
                    'In the meantime, you can explore our interactive App Demo and User Documentation from the Resources section.',
                ],
                details: [
                    { label: 'Reference', value: `#${threadId}` },
                    { label: 'Organisation', value: organization || '—' },
                    { label: 'Preferred Date', value: preferred_date || 'Flexible' },
                    { label: 'Preferred Time', value: preferred_time || 'Flexible' },
                ],
            });

            sendEmailInBackground({
                to: email,
                subject: `Managira Demo Request Received - #${threadId}`,
                html,
                attachments: [
                    {
                        filename: 'managira.png',
                        path: path.join(__dirname, '../public/images/managira.png'),
                        cid: 'managira_logo'
                    }
                ]
            }, 'Demo Request Confirmation Email');

            const demoAlertRecipient =
                process.env.DEMO_REQUEST_ALERT_EMAIL ||
                process.env.ADMIN_NOTIFY_EMAIL_USER ||
                process.env.ADMIN_EMAIL ||
                process.env.EMAIL_USER;

            if (demoAlertRecipient) {
                const internalDemoAlertHtml = renderCleanEmail({
                    title: `New Demo Request (#${threadId})`,
                    greeting: 'Hello Team,',
                    paragraphs: [
                        'A new demo request has been submitted from the public Request Demo page.',
                        'Please follow up with the requester to schedule the walkthrough.',
                    ],
                    details: [
                        { label: 'Reference', value: `#${threadId}` },
                        { label: 'Name', value: name || '—' },
                        { label: 'Email', value: email || '—' },
                        { label: 'Phone', value: phone || '—' },
                        { label: 'Organisation', value: organization || '—' },
                        { label: 'Role', value: role || '—' },
                        { label: 'Country', value: country || '—' },
                        { label: 'Approx. Students', value: student_count || '—' },
                        { label: 'Preferred Date', value: preferred_date || 'Flexible' },
                        { label: 'Preferred Time', value: preferred_time || 'Flexible' },
                        { label: 'Message', value: trimmedMessage || '—' },
                    ],
                });

                sendEmailInBackground({
                    to: demoAlertRecipient,
                    subject: `[DEMO REQUEST] ${organization || name} - #${threadId}`,
                    html: internalDemoAlertHtml,
                    attachments: [
                        {
                            filename: 'managira.png',
                            path: path.join(__dirname, '../public/images/managira.png'),
                            cid: 'managira_logo'
                        }
                    ]
                }, 'Demo Request Internal Alert Email');
            }

            req.flash('success', 'Thanks! Your demo request has been received. Our team will be in touch shortly.');
            return res.redirect('/legal/request-demo');
        } catch (error) {
            console.error('[Demo Request] Failed to save:', error.message);
            req.flash('error', 'We could not submit your demo request right now. Please try again.');
            return res.redirect('/legal/request-demo');
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

            const baseSiteUrl = 'https://managira.com';
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
                        url: 'https://managira.com/',
                        description: 'Find schools on Managira by school name, nickname, or public URL.',
                        keywords: 'school management system, school management software, school directory, school portal, school ERP, education management software',
                        potentialAction: {
                            '@type': 'SearchAction',
                            target: 'https://managira.com/?q={search_term_string}',
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
                canonicalUrl: 'https://managira.com/',
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
