// Managira FAQ Knowledge Base - Based on official FAQ page
const managiraFAQ = [
  // Getting Started
  {
    id: 1,
    category: "Getting Started",
    question: "What is Managira?",
    answer: "Managira is an all-in-one school management platform designed to help educational institutions — from individual schools to government bodies overseeing multiple institutions — manage student records, track academic performance, handle attendance, generate reports, and keep parents and guardians informed. It replaces paperwork with a secure, digital solution that works on any device.",
    keywords: ["what is managira", "school management", "platform", "educators", "parents", "guardians", "administrative", "student performance", "government", "institutions"]
  },
  {
    id: 2,
    category: "Getting Started",
    question: "Who can use Managira?",
    answer: "Managira serves schools, colleges, training centres, government education departments, administrators, teachers, parents, and guardians. Whether you're running a single school or managing a network of institutions, Managira scales to fit your needs.",
    keywords: ["who can use", "schools", "administrators", "teachers", "students", "families", "government", "colleges", "training centres"]
  },
  {
    id: 3,
    category: "Getting Started",
    question: "How do I register my school on Managira?",
    answer: "Visit our registration page and fill out your school details. Once registered, you can set up your school profile, add your logo and branding, create classes, and invite teachers and staff — all in about 15 minutes. You'll receive a guided onboarding experience to help you get started quickly.",
    keywords: ["register", "registration", "school", "sign up", "setup", "onboarding", "15 minutes"]
  },
  {
    id: 4,
    category: "Getting Started",
    question: "Is there a free trial available?",
    answer: "Yes! Every new school gets a free trial that lasts for a full academic term. During the trial, you'll have access to all core features including student management, attendance tracking, grade recording, and report generation — so you can experience the full platform before choosing a plan.",
    keywords: ["free trial", "trial", "term", "new schools", "features", "plan", "academic term"]
  },
  {
    id: 5,
    category: "Getting Started",
    question: "How long does it take to set up Managira?",
    answer: "Most schools are up and running within 15 minutes. You simply register, add your school details and branding, create your classes, and start adding students. Bulk import options are available if you're migrating from another system.",
    keywords: ["setup time", "how long", "15 minutes", "quick setup", "migration", "import"]
  },
  {
    id: 6,
    category: "Getting Started",
    question: "How can I contact Managira support?",
    answer: "You can reach our support team through the 'Get Help' page on the platform, or email us directly at support@managira.com. We also have a YouTube channel with step-by-step video tutorials for common tasks.",
    keywords: ["contact", "support", "help", "email", "youtube", "tutorials"]
  },
  {
    id: 7,
    category: "Getting Started",
    question: "What if I have a feature request?",
    answer: "We welcome your feedback! You can submit feature requests directly to managirainfo@gmail.com. We also send out periodic surveys to gather suggestions from our community. Many of our most popular features have come from user feedback.",
    keywords: ["feature request", "feedback", "suggestions", "survey", "managirainfo@gmail.com"]
  },

  // Educators & Admins
  {
    id: 8,
    category: "Educators & Admins",
    question: "How does Managira help educators?",
    answer: "Managira gives educators a complete digital toolkit: record grades and assessments, track daily attendance, create and print report cards and merit sheets, manage class rosters, and communicate with parents — all from a single dashboard. Real-time analytics show student progress trends so teachers can identify who needs extra support.",
    keywords: ["educators", "grades", "attendance", "reports", "communicate", "families", "student progress", "teachers", "dashboard"]
  },
  {
    id: 9,
    category: "Educators & Admins",
    question: "Can teachers and administrators update student information?",
    answer: "Yes. Authorised users can update student profiles including personal details, grades, attendance records, and behavioural notes. The platform uses role-based access control, so administrators can decide exactly which staff members have permission to view or edit specific types of data.",
    keywords: ["teachers", "administrators", "update", "student information", "grades", "attendance", "personal details", "role-based"]
  },
  {
    id: 10,
    category: "Educators & Admins",
    question: "Can I track teacher performance or workload?",
    answer: "Administrators can view detailed metrics for each teacher, including how many classes they manage, tests and assessments they've created, grades they've entered, and attendance they've recorded. This helps school leaders distribute workload fairly and recognise top-performing staff.",
    keywords: ["track", "teacher performance", "workload", "administrators", "class assignments", "test creation", "metrics"]
  },
  {
    id: 11,
    category: "Educators & Admins",
    question: "Can I generate report cards or merit sheets?",
    answer: "Absolutely. Managira includes a powerful report generator that creates professional terminal reports and merit sheets automatically from your recorded grades and assessments. You can customise the layout, add school branding, and print or download reports in bulk.",
    keywords: ["generate", "report cards", "merit sheets", "report generator", "terminal reports", "print", "download"]
  },
  {
    id: 12,
    category: "Educators & Admins",
    question: "Can I customise the portal with my school's logo and colours?",
    answer: "Yes. Under the Personalisation settings, you can upload your school logo, set your brand colours and fonts, and customise your public-facing school website. This ensures Managira looks and feels like your own platform.",
    keywords: ["customise", "portal", "school logo", "colours", "branding", "personalisation", "fonts"]
  },
  {
    id: 13,
    category: "Educators & Admins",
    question: "How does the enrollment system work?",
    answer: "Schools can create public enrollment forms that parents and guardians fill out online to apply for admission. Applications are reviewed and approved by school administrators. You can also manually add students or bulk-import from spreadsheets.",
    keywords: ["enrollment", "admission", "application", "public form", "parents", "import", "spreadsheets"]
  },
  {
    id: 14,
    category: "Educators & Admins",
    question: "Is training provided for new users?",
    answer: "Yes. We provide onboarding documentation, in-app guides, and video tutorials on our YouTube channel. For larger institutions, we can arrange personalised training sessions to help your team get comfortable with the platform.",
    keywords: ["training", "new users", "onboarding", "documentation", "tutorials", "youtube"]
  },
  {
    id: 15,
    category: "Educators & Admins",
    question: "How are announcements delivered?",
    answer: "Announcements are published to dashboards across the platform, ensuring that administrators, teachers, and staff see important updates as soon as they log in. Schools can also display announcements on their public-facing website for parents and the wider community.",
    keywords: ["announcements", "dashboards", "communication", "public website"]
  },
  {
    id: 16,
    category: "Educators & Admins",
    question: "Is there an analytics dashboard?",
    answer: "Yes. Managira's analytics dashboard provides visual insights into student performance trends, attendance statistics, class comparisons, and operational metrics. Leaders can use this data to make informed decisions about curriculum, staffing, and resource allocation.",
    keywords: ["analytics", "dashboard", "student performance", "attendance stats", "insights", "data-driven"]
  },
  {
    id: 17,
    category: "Educators & Admins",
    question: "Can I manage school years and terms?",
    answer: "Yes. Managira supports full academic year management — you can register school years, define terms, close terms to lock in grades, and promote students to the next year. The system maintains a complete historical record of every academic period.",
    keywords: ["school years", "terms", "academic year", "promotion", "grades", "historical record"]
  },

  // Hub Management & Government Institutions
  {
    id: 18,
    category: "Hub Management & Government Institutions",
    question: "What is a Managira Hub?",
    answer: "A Managira Hub is a centralised management layer designed for government education departments, school districts, and educational bodies that oversee multiple schools. Hubs provide a single dashboard to monitor performance, manage staff, coordinate operations, and maintain oversight across all member institutions.",
    keywords: ["hub", "government", "education department", "school district", "multiple schools", "centralised", "oversight"]
  },
  {
    id: 19,
    category: "Hub Management & Government Institutions",
    question: "Who typically uses Hubs?",
    answer: "Hubs are used by government education ministries, regional education offices, school district administrators, and private education groups that manage networks of schools. Any organisation responsible for overseeing multiple educational institutions can benefit from the Hub system.",
    keywords: ["hub users", "government", "ministries", "education offices", "school districts", "networks"]
  },
  {
    id: 20,
    category: "Hub Management & Government Institutions",
    question: "How do I set up a Hub?",
    answer: "Hubs are created by Managira administrators. Once your Hub is set up, you receive a dedicated login and dashboard. From there, you can invite schools to join your network, set organisation limits, and begin monitoring your member institutions.",
    keywords: ["hub setup", "create hub", "dedicated login", "invite schools", "organisation limits"]
  },
  {
    id: 21,
    category: "Hub Management & Government Institutions",
    question: "Can a Hub control billing for member schools?",
    answer: "Yes. When a school joins a Hub, billing is managed centrally by the Hub operator. Member schools no longer see individual billing options — all subscription management is handled at the Hub level, simplifying financial administration.",
    keywords: ["hub billing", "centralised billing", "subscription", "member schools", "financial"]
  },
  {
    id: 22,
    category: "Hub Management & Government Institutions",
    question: "Can I invite existing schools to join my Hub?",
    answer: "Yes. Hub operators can send invitations to existing Managira schools as well as new institutions. Schools receive an email invitation and can accept to join the Hub network while retaining all their existing data and settings.",
    keywords: ["invite schools", "existing schools", "join hub", "email invitation", "retain data"]
  },
  {
    id: 23,
    category: "Hub Management & Government Institutions",
    question: "What data can Hub operators see?",
    answer: "Hub operators can view aggregated statistics across all member schools — including total students, staff counts, class numbers, and performance trends. They can also see individual school details, but day-to-day data entry remains the responsibility of each school's own administrators and teachers.",
    keywords: ["hub data", "aggregated statistics", "students", "staff", "performance", "oversight"]
  },

  // Billing & Subscription
  {
    id: 24,
    category: "Billing & Subscription",
    question: "Can I upgrade or downgrade my plan?",
    answer: "Yes. You can change your plan at any time from the Settings or Billing section of your account. Upgrades take effect immediately, and downgrades apply at the end of your current billing cycle.",
    keywords: ["upgrade", "downgrade", "plan", "switch", "settings", "billing", "subscription"]
  },
  {
    id: 25,
    category: "Billing & Subscription",
    question: "What happens if I miss a payment?",
    answer: "If a payment is missed, you'll receive notifications with steps to resolve it. After a grace period, access to premium features will be temporarily restricted. Your data remains safe and intact — once payment is made, full access is restored immediately.",
    keywords: ["miss payment", "payment", "access limited", "grace period", "notifications", "restore access"]
  },
  {
    id: 26,
    category: "Billing & Subscription",
    question: "What payment methods do you accept?",
    answer: "We accept payments through Paystack, which supports credit/debit cards, mobile money, and bank transfers depending on your region. All transactions are processed securely with industry-standard encryption.",
    keywords: ["payment methods", "paystack", "credit card", "mobile money", "bank transfer"]
  },
  {
    id: 27,
    category: "Billing & Subscription",
    question: "Is there a discount for annual billing?",
    answer: "Please visit our pricing page or contact our sales team at managirainfo@gmail.com for information about annual billing options and available discounts for larger institutions.",
    keywords: ["discount", "annual billing", "pricing", "sales"]
  },

  // Parents & Guardians
  {
    id: 28,
    category: "Parents & Guardians",
    question: "How do parents access their child's information?",
    answer: "Parents and guardians can access their child's school information through the dedicated Guardian Portal. Schools provide login credentials, and once logged in, parents can view grades, attendance records, report cards, and school announcements — all in real time.",
    keywords: ["parents", "guardians", "access", "guardian portal", "grades", "attendance", "report cards"]
  },
  {
    id: 29,
    category: "Parents & Guardians",
    question: "How do parents or guardians register their children?",
    answer: "Schools can enable a public enrollment form on their Managira-powered website. Parents fill out the application online, and school administrators review and approve each submission. Schools can also register students directly on behalf of parents.",
    keywords: ["parents", "guardians", "register children", "public application", "enrollment", "school admins"]
  },
  {
    id: 30,
    category: "Parents & Guardians",
    question: "Can parents submit reports or concerns?",
    answer: "Yes. The Guardian Portal includes a reporting feature where parents can submit concerns, questions, or feedback directly to the school. Schools can review and respond to these reports through their admin dashboard.",
    keywords: ["parent reports", "concerns", "feedback", "guardian portal", "reporting"]
  },
  {
    id: 31,
    category: "Parents & Guardians",
    question: "How can parents stay updated on school activities?",
    answer: "Managira keeps parents informed through the public school website, dashboard announcements, and the Guardian Portal. Parents can see real-time updates on events, grades, and achievements without needing to visit the school in person.",
    keywords: ["parents", "stay updated", "notifications", "announcements", "public website", "real-time"]
  },

  // Security & Access
  {
    id: 32,
    category: "Security & Access",
    question: "What security measures protect student data?",
    answer: "Managira uses enterprise-grade security including TLS/SSL encryption for all data in transit, encryption at rest for stored data, role-based access controls, and secure hosting on Amazon Web Services (AWS). We follow OWASP security best practices and conduct regular vulnerability assessments using tools like Snyk.",
    keywords: ["security measures", "student data", "encryption", "secure servers", "role-based access", "data protection", "AWS", "OWASP"]
  },
  {
    id: 33,
    category: "Security & Access",
    question: "Is Managira compliant with data protection regulations?",
    answer: "Yes. Managira adheres to international data protection standards including GDPR (EU), FERPA (US), and applicable national data protection laws. We take compliance seriously to ensure your institution meets its regulatory obligations.",
    keywords: ["compliant", "GDPR", "FERPA", "data protection", "regulations", "privacy"]
  },
  {
    id: 34,
    category: "Security & Access",
    question: "Can I control who sees what information?",
    answer: "Absolutely. Administrators have full control over roles and permissions. You can define exactly which staff members can access, edit, or manage specific types of data — from student records to financial information. This ensures privacy and security at every level.",
    keywords: ["control", "information", "administrators", "roles", "permissions", "access", "edit"]
  },
  {
    id: 35,
    category: "Security & Access",
    question: "How long is student data retained?",
    answer: "Student records are retained for as long as your school's account remains active on Managira. If a school discontinues use, data can be exported and then archived or permanently deleted in accordance with your institution's policies and applicable legal requirements.",
    keywords: ["student data", "retained", "school account", "active", "archived", "deleted", "policies"]
  },
  {
    id: 36,
    category: "Security & Access",
    question: "What should I do if I forget my password?",
    answer: "Click the 'Forgot Password' link on the login page. You'll receive an email with a secure link to reset your password. The reset link expires after a set period for security purposes. If you don't receive the email, check your spam folder or contact your school administrator.",
    keywords: ["forget password", "forgot password", "login page", "reset link", "email"]
  },

  // Technical & Platform
  {
    id: 37,
    category: "Technical & Platform",
    question: "What devices does Managira support?",
    answer: "Managira is fully responsive and works on desktops, laptops, tablets, and mobile phones. There's no app to download — you simply access it through your web browser. It's been optimised for Chrome, Safari, Firefox, and Edge.",
    keywords: ["multiple devices", "desktops", "tablets", "mobile devices", "accessible", "responsive", "browsers"]
  },
  {
    id: 38,
    category: "Technical & Platform",
    question: "Can I export my data from Managira?",
    answer: "Yes. Managira supports data export in multiple formats. You can download student records, attendance data, grade reports, and other information as CSV or PDF files. This ensures you always have full ownership and portability of your data.",
    keywords: ["export", "data", "CSV", "PDF", "download", "portability"]
  },
  {
    id: 39,
    category: "Technical & Platform",
    question: "Does Managira have a public-facing school website?",
    answer: "Yes. Every school on Managira gets a customisable public dashboard that serves as a school website. You can publish announcements, display school information, showcase events, and enable online enrollment — all branded with your school's logo and colours.",
    keywords: ["public website", "school website", "dashboard", "announcements", "enrollment", "branding"]
  },
  {
    id: 40,
    category: "Technical & Platform",
    question: "What should I do if I encounter a technical issue?",
    answer: "Visit our Get Help page to submit a support request, or email support@managira.com directly. Please include details about the issue, your browser, and any error messages you see. Our support team typically responds within 24 hours.",
    keywords: ["technical issue", "support team", "help", "support@managira.com", "support request"]
  },
  {
    id: 41,
    category: "Technical & Platform",
    question: "Can I use Managira for academic transcript generation?",
    answer: "Yes. Managira includes a transcript generation feature that compiles a student's complete academic history across all enrolled terms and years. Transcripts can be printed or downloaded as professional PDF documents.",
    keywords: ["transcript", "academic history", "PDF", "print", "download", "generation"]
  }
];

module.exports = managiraFAQ;