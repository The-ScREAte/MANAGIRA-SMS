// Managira FAQ Knowledge Base - Based on official FAQ page
const managiraFAQ = [
  // Getting Started
  {
    id: 1,
    category: "Getting Started",
    question: "What is Managira?",
    answer: "Managira is an all-in-one school management platform designed to help educational institutions — from individual schools to government bodies overseeing multiple institutions — manage student records, track academic performance, handle attendance, generate reports, and keep parents and guardians informed. It replaces paperwork with a secure, digital solution that works on any device.",
    keywords: ["what is managira", "school management", "platform", "educators", "parents", "guardians", "administrative", "student performance", "government", "institutions", "about", "overview", "what does managira do"]
  },
  {
    id: 2,
    category: "Getting Started",
    question: "Who can use Managira?",
    answer: "Managira serves schools, colleges, training centres, government education departments, administrators, teachers, parents, and guardians. Whether you're running a single school or managing a network of institutions, Managira scales to fit your needs.",
    keywords: ["who can use", "schools", "administrators", "teachers", "students", "families", "government", "colleges", "training centres", "who is it for", "target audience", "users"]
  },
  {
    id: 3,
    category: "Getting Started",
    question: "How do I register my school on Managira?",
    answer: "Visit our registration page and fill out your school details. Once registered, you can set up your school profile, add your logo and branding, create classes, and invite teachers and staff — all in about 15 minutes. You'll receive a guided onboarding experience to help you get started quickly.",
    keywords: ["register", "registration", "school", "sign up", "setup", "onboarding", "15 minutes", "create account", "new school", "get started", "how to join", "start"]
  },
  {
    id: 4,
    category: "Getting Started",
    question: "Is there a free trial available?",
    answer: "Yes! Every new school gets a free trial that lasts for a full academic term. During the trial, you'll have access to all core features including student management, attendance tracking, grade recording, and report generation — so you can experience the full platform before choosing a plan.",
    keywords: ["free trial", "trial", "term", "new schools", "features", "plan", "academic term", "try free", "demo", "test", "no cost", "free"]
  },
  {
    id: 5,
    category: "Getting Started",
    question: "How long does it take to set up Managira?",
    answer: "Most schools are up and running within 15 minutes. You simply register, add your school details and branding, create your classes, and start adding students. Bulk import options are available if you're migrating from another system.",
    keywords: ["setup time", "how long", "15 minutes", "quick setup", "migration", "import", "fast", "easy", "getting started"]
  },
  {
    id: 6,
    category: "Getting Started",
    question: "How can I contact Managira support?",
    answer: "You can reach our support team through the 'Get Help' page on the platform, or email us directly at info@managira.com. We also have a YouTube channel with step-by-step video tutorials for common tasks.",
    keywords: ["contact", "support", "help", "email", "youtube", "tutorials", "reach us", "customer service", "assistance", "talk to someone", "phone", "call"]
  },
  {
    id: 7,
    category: "Getting Started",
    question: "What if I have a feature request?",
    answer: "We welcome your feedback! You can submit feature requests directly to managirainfo@gmail.com. We also send out periodic surveys to gather suggestions from our community. Many of our most popular features have come from user feedback.",
    keywords: ["feature request", "feedback", "suggestions", "survey", "managirainfo@gmail.com", "request", "idea", "suggest", "improvement", "new feature", "wish list"]
  },

  // Educators & Admins
  {
    id: 8,
    category: "Educators & Admins",
    question: "How does Managira help educators?",
    answer: "Managira gives educators a complete digital toolkit: record grades and assessments, track daily attendance, create and print report cards and merit sheets, manage class rosters, and communicate with parents — all from a single dashboard. Real-time analytics show student progress trends so teachers can identify who needs extra support.",
    keywords: ["educators", "grades", "attendance", "reports", "communicate", "families", "student progress", "teachers", "dashboard", "benefits", "advantages", "why use"]
  },
  {
    id: 9,
    category: "Educators & Admins",
    question: "Can teachers and administrators update student information?",
    answer: "Yes. Authorised users can update student profiles including personal details, grades, attendance records, and behavioural notes. The platform uses role-based access control, so administrators can decide exactly which staff members have permission to view or edit specific types of data.",
    keywords: ["teachers", "administrators", "update", "student information", "grades", "attendance", "personal details", "role-based", "edit student", "modify", "change"]
  },
  {
    id: 10,
    category: "Educators & Admins",
    question: "Can I track teacher performance or workload?",
    answer: "Administrators can view detailed metrics for each teacher, including how many classes they manage, tests and assessments they've created, grades they've entered, and attendance they've recorded. This helps school leaders distribute workload fairly and recognise top-performing staff.",
    keywords: ["track", "teacher performance", "workload", "administrators", "class assignments", "test creation", "metrics", "monitor", "evaluate"]
  },
  {
    id: 11,
    category: "Educators & Admins",
    question: "Can I generate report cards or merit sheets?",
    answer: "Absolutely. Managira includes a powerful report generator that creates professional terminal reports and merit sheets automatically from your recorded grades and assessments. You can customise the layout, add school branding, and print or download reports in bulk.",
    keywords: ["generate", "report cards", "merit sheets", "report generator", "terminal reports", "print", "download", "results", "academic report"]
  },
  {
    id: 12,
    category: "Educators & Admins",
    question: "Can I customise the portal with my school's logo and colours?",
    answer: "Yes. Under the Personalisation settings, you can upload your school logo, set your brand colours and fonts, and customise your public-facing school website. This ensures Managira looks and feels like your own platform.",
    keywords: ["customise", "customize", "portal", "school logo", "colours", "colors", "branding", "personalisation", "personalization", "fonts", "theme", "appearance", "look"]
  },
  {
    id: 13,
    category: "Educators & Admins",
    question: "How does the enrollment system work?",
    answer: "Schools can create public enrollment forms that parents and guardians fill out online to apply for admission. Applications are reviewed and approved by school administrators. You can also manually add students or bulk-import from spreadsheets.",
    keywords: ["enrollment", "enrolment", "admission", "application", "public form", "parents", "import", "spreadsheets", "apply", "register student", "new student", "accept", "admit"]
  },
  {
    id: 14,
    category: "Educators & Admins",
    question: "Is training provided for new users?",
    answer: "Yes. We provide onboarding documentation, in-app guides, and video tutorials on our YouTube channel. For larger institutions, we can arrange personalised training sessions to help your team get comfortable with the platform.",
    keywords: ["training", "new users", "onboarding", "documentation", "tutorials", "youtube", "learn", "how to use", "guide", "instructions"]
  },
  {
    id: 15,
    category: "Educators & Admins",
    question: "How are announcements delivered?",
    answer: "Announcements are published to dashboards across the platform, ensuring that administrators, teachers, and staff see important updates as soon as they log in. Schools can also display announcements on their public-facing website for parents and the wider community.",
    keywords: ["announcements", "dashboards", "communication", "public website", "news", "updates", "notice", "notify", "broadcast", "message", "inform"]
  },
  {
    id: 16,
    category: "Educators & Admins",
    question: "Is there an analytics dashboard?",
    answer: "Yes. Managira's analytics dashboard provides visual insights into student performance trends, attendance statistics, class comparisons, and operational metrics. Leaders can use this data to make informed decisions about curriculum, staffing, and resource allocation.",
    keywords: ["analytics", "dashboard", "student performance", "attendance stats", "insights", "data-driven", "statistics", "charts", "graphs", "metrics", "data"]
  },
  {
    id: 17,
    category: "Educators & Admins",
    question: "Can I manage school years and terms?",
    answer: "Yes. Managira supports full academic year management — you can register school years, define terms, close terms to lock in grades, and promote students to the next year. The system maintains a complete historical record of every academic period.",
    keywords: ["school years", "terms", "academic year", "promotion", "grades", "historical record", "semester", "quarter", "period", "close term", "open term"]
  },

  // Hub Management & Government Institutions
  {
    id: 18,
    category: "Hub Management & Government Institutions",
    question: "What is a Managira Hub?",
    answer: "A Managira Hub is a centralised management layer designed for government education departments, school districts, and educational bodies that oversee multiple schools. Hubs provide a single dashboard to monitor performance, manage staff, coordinate operations, and maintain oversight across all member institutions.",
    keywords: ["hub", "government", "education department", "school district", "multiple schools", "centralised", "oversight", "network", "group of schools", "manage schools"]
  },
  {
    id: 19,
    category: "Hub Management & Government Institutions",
    question: "Who typically uses Hubs?",
    answer: "Hubs are used by government education ministries, regional education offices, school district administrators, and private education groups that manage networks of schools. Any organisation responsible for overseeing multiple educational institutions can benefit from the Hub system.",
    keywords: ["hub users", "government", "ministries", "education offices", "school districts", "networks", "who uses hubs", "ministry"]
  },
  {
    id: 20,
    category: "Hub Management & Government Institutions",
    question: "How do I set up a Hub?",
    answer: "Hubs are created by Managira administrators. Once your Hub is set up, you receive a dedicated login and dashboard. From there, you can invite schools to join your network, set organisation limits, and begin monitoring your member institutions.",
    keywords: ["hub setup", "create hub", "dedicated login", "invite schools", "organisation limits", "start hub", "new hub"]
  },
  {
    id: 21,
    category: "Hub Management & Government Institutions",
    question: "Can a Hub control billing for member schools?",
    answer: "Yes. When a school joins a Hub, billing is managed centrally by the Hub operator. Member schools no longer see individual billing options — all subscription management is handled at the Hub level, simplifying financial administration.",
    keywords: ["hub billing", "centralised billing", "subscription", "member schools", "financial", "hub payment", "pay for schools"]
  },
  {
    id: 22,
    category: "Hub Management & Government Institutions",
    question: "Can I invite existing schools to join my Hub?",
    answer: "Yes. Hub operators can send invitations to existing Managira schools as well as new institutions. Schools receive an email invitation and can accept to join the Hub network while retaining all their existing data and settings.",
    keywords: ["invite schools", "existing schools", "join hub", "email invitation", "retain data", "add school to hub", "connect school"]
  },
  {
    id: 23,
    category: "Hub Management & Government Institutions",
    question: "What data can Hub operators see?",
    answer: "Hub operators can view aggregated statistics across all member schools — including total students, staff counts, class numbers, and performance trends. They can also see individual school details, but day-to-day data entry remains the responsibility of each school's own administrators and teachers.",
    keywords: ["hub data", "aggregated statistics", "students", "staff", "performance", "oversight", "hub view", "hub dashboard", "hub reports"]
  },

  // Billing & Subscription
  {
    id: 24,
    category: "Billing & Subscription",
    question: "Can I upgrade or downgrade my plan?",
    answer: "Yes. You can change your plan at any time from the Settings or Billing section of your account. Upgrades take effect immediately, and downgrades apply at the end of your current billing cycle.",
    keywords: ["upgrade", "downgrade", "plan", "switch", "settings", "billing", "subscription", "change plan", "different plan"]
  },
  {
    id: 25,
    category: "Billing & Subscription",
    question: "What happens if I miss a payment?",
    answer: "If a payment is missed, you'll receive notifications with steps to resolve it. After a grace period, access to premium features will be temporarily restricted. Your data remains safe and intact — once payment is made, full access is restored immediately.",
    keywords: ["miss payment", "payment", "access limited", "grace period", "notifications", "restore access", "overdue", "late payment", "unpaid"]
  },
  {
    id: 26,
    category: "Billing & Subscription",
    question: "What payment methods do you accept?",
    answer: "We accept payments through Paystack, which supports credit/debit cards, mobile money, and bank transfers depending on your region. All transactions are processed securely with industry-standard encryption.",
    keywords: ["payment methods", "paystack", "credit card", "mobile money", "bank transfer", "how to pay", "accepted payments", "debit card"]
  },
  {
    id: 27,
    category: "Billing & Subscription",
    question: "Is there a discount for annual billing?",
    answer: "Please visit our pricing page or contact our sales team at managirainfo@gmail.com for information about annual billing options and available discounts for larger institutions.",
    keywords: ["discount", "annual billing", "pricing", "sales", "yearly", "bulk discount", "cheaper", "save money"]
  },
  {
    id: 28,
    category: "Billing & Subscription",
    question: "How much does Managira cost?",
    answer: "Managira offers flexible pricing plans based on the size and needs of your institution. Every school starts with a free trial for a full academic term. Visit our pricing page or contact managirainfo@gmail.com for detailed pricing information.",
    keywords: ["how much", "cost", "price", "pricing", "expensive", "affordable", "rate", "fee", "charges", "subscription cost"]
  },
  {
    id: 29,
    category: "Billing & Subscription",
    question: "How do I cancel my subscription?",
    answer: "You can cancel your subscription from the Settings or Billing section of your account. Your access continues until the end of your current billing period. Your data will remain accessible for export before the account is deactivated.",
    keywords: ["cancel", "subscription", "stop", "end", "unsubscribe", "quit", "leave", "deactivate", "close account"]
  },

  // Parents & Guardians
  {
    id: 30,
    category: "Parents & Guardians",
    question: "How do parents access their child's information?",
    answer: "Parents and guardians can access their child's school information through the dedicated Guardian Portal. Schools provide login credentials, and once logged in, parents can view grades, attendance records, report cards, and school announcements — all in real time.",
    keywords: ["parents", "guardians", "access", "guardian portal", "grades", "attendance", "report cards", "child info", "kid grades", "my child", "son", "daughter", "view grades"]
  },
  {
    id: 31,
    category: "Parents & Guardians",
    question: "How do parents or guardians register their children?",
    answer: "Schools can enable a public enrollment form on their Managira-powered website. Parents fill out the application online, and school administrators review and approve each submission. Schools can also register students directly on behalf of parents.",
    keywords: ["parents", "guardians", "register children", "public application", "enrollment", "school admins", "enroll child", "add child", "new student", "apply for school"]
  },
  {
    id: 32,
    category: "Parents & Guardians",
    question: "Can parents submit reports or concerns?",
    answer: "Yes. The Guardian Portal includes a reporting feature where parents can submit concerns, questions, or feedback directly to the school. Schools can review and respond to these reports through their admin dashboard.",
    keywords: ["parent reports", "concerns", "feedback", "guardian portal", "reporting", "complaint", "issue", "problem", "worry"]
  },
  {
    id: 33,
    category: "Parents & Guardians",
    question: "How can parents stay updated on school activities?",
    answer: "Managira keeps parents informed through the public school website, dashboard announcements, and the Guardian Portal. Parents can see real-time updates on events, grades, and achievements without needing to visit the school in person.",
    keywords: ["parents", "stay updated", "notifications", "announcements", "public website", "real-time", "events", "activities", "informed", "news"]
  },
  {
    id: 34,
    category: "Parents & Guardians",
    question: "What is the Guardian Portal?",
    answer: "The Guardian Portal is a dedicated section of Managira designed for parents and guardians. It provides a secure login where parents can view their child's grades, attendance, report cards, school announcements, and submit reports or concerns to the school.",
    keywords: ["guardian portal", "parent portal", "parent login", "guardian login", "parent dashboard", "guardian dashboard", "parent access"]
  },

  // Security & Access
  {
    id: 35,
    category: "Security & Access",
    question: "What security measures protect student data?",
    answer: "Managira uses enterprise-grade security including TLS/SSL encryption for all data in transit, encryption at rest for stored data, role-based access controls, and secure hosting on Amazon Web Services (AWS). We follow OWASP security best practices and conduct regular vulnerability assessments using tools like Snyk.",
    keywords: ["security measures", "student data", "encryption", "secure servers", "role-based access", "data protection", "AWS", "OWASP", "safe", "protected", "hack", "breach"]
  },
  {
    id: 36,
    category: "Security & Access",
    question: "Is Managira compliant with data protection regulations?",
    answer: "Yes. Managira adheres to international data protection standards including GDPR (EU), FERPA (US), and applicable national data protection laws. We take compliance seriously to ensure your institution meets its regulatory obligations.",
    keywords: ["compliant", "GDPR", "FERPA", "data protection", "regulations", "privacy", "legal", "law", "compliant"]
  },
  {
    id: 37,
    category: "Security & Access",
    question: "Can I control who sees what information?",
    answer: "Absolutely. Administrators have full control over roles and permissions. You can define exactly which staff members can access, edit, or manage specific types of data — from student records to financial information. This ensures privacy and security at every level.",
    keywords: ["control", "information", "administrators", "roles", "permissions", "access", "edit", "restrict", "limit", "who can see", "privacy"]
  },
  {
    id: 38,
    category: "Security & Access",
    question: "How long is student data retained?",
    answer: "Student records are retained for as long as your school's account remains active on Managira. If a school discontinues use, data can be exported and then archived or permanently deleted in accordance with your institution's policies and applicable legal requirements.",
    keywords: ["student data", "retained", "school account", "active", "archived", "deleted", "policies", "how long kept", "data storage", "retention"]
  },
  {
    id: 39,
    category: "Security & Access",
    question: "What should I do if I forget my password?",
    answer: "Click the 'Forgot Password' link on the login page. You'll receive an email with a secure link to reset your password. The reset link expires after a set period for security purposes. If you don't receive the email, check your spam folder or contact your school administrator.",
    keywords: ["forget password", "forgot password", "login page", "reset link", "email", "can't login", "locked out", "password reset", "lost password", "change password"]
  },
  {
    id: 40,
    category: "Security & Access",
    question: "How do I change my password?",
    answer: "You can change your password from the Account Settings page after logging in. If you've forgotten your current password, use the 'Forgot Password' link on the login page to receive a reset email.",
    keywords: ["change password", "update password", "new password", "modify password", "password settings", "account settings"]
  },

  // Technical & Platform
  {
    id: 41,
    category: "Technical & Platform",
    question: "What devices does Managira support?",
    answer: "Managira is fully responsive and works on desktops, laptops, tablets, and mobile phones. There's no app to download — you simply access it through your web browser. It's been optimised for Chrome, Safari, Firefox, and Edge.",
    keywords: ["multiple devices", "desktops", "tablets", "mobile devices", "accessible", "responsive", "browsers", "phone", "laptop", "app", "download", "install"]
  },
  {
    id: 42,
    category: "Technical & Platform",
    question: "Can I export my data from Managira?",
    answer: "Yes. Managira supports data export in multiple formats. You can download student records, attendance data, grade reports, and other information as CSV or PDF files. This ensures you always have full ownership and portability of your data.",
    keywords: ["export", "data", "CSV", "PDF", "download", "portability", "backup", "save data", "extract"]
  },
  {
    id: 43,
    category: "Technical & Platform",
    question: "Does Managira have a public-facing school website?",
    answer: "Yes. Every school on Managira gets a customisable public dashboard that serves as a school website. You can publish announcements, display school information, showcase events, and enable online enrollment — all branded with your school's logo and colours.",
    keywords: ["public website", "school website", "dashboard", "announcements", "enrollment", "branding", "website", "web page", "online presence", "site"]
  },
  {
    id: 44,
    category: "Technical & Platform",
    question: "What should I do if I encounter a technical issue?",
    answer: "Visit our Get Help page to submit a support request, or email info@managira.com directly. Please include details about the issue, your browser, and any error messages you see. Our support team typically responds within 24 hours.",
    keywords: ["technical issue", "support team", "help", "info@managira.com", "support request", "bug", "error", "problem", "not working", "broken", "issue"]
  },
  {
    id: 45,
    category: "Technical & Platform",
    question: "Can I use Managira for academic transcript generation?",
    answer: "Yes. Managira includes a transcript generation feature that compiles a student's complete academic history across all enrolled terms and years. Transcripts can be printed or downloaded as professional PDF documents.",
    keywords: ["transcript", "academic history", "PDF", "print", "download", "generation", "academic record", "student history"]
  },
  {
    id: 46,
    category: "Security & Access",
    question: "How do staff roles and permissions work for organizations?",
    answer: "Organizations use role-based access with secure server-side checks. Managers have full organization-level access. Teachers and Supervisors can be given specific permissions based on their job. Access is enforced on protected routes in addition to UI visibility, so users cannot rely on direct URL access to bypass restrictions.",
    keywords: ["roles", "permissions", "rbac", "organization roles", "teacher permissions", "supervisor permissions", "access control", "server-side", "who can do what", "staff access"]
  },
  {
    id: 47,
    category: "Security & Access",
    question: "What are the default permissions for Teacher and Supervisor roles?",
    answer: "By default, Teacher includes: Manage Assessments and Mark Attendance. Supervisor includes: Manage Students, Manage Guardians, Manage Assessments, Mark Attendance, Manage Reports, Approve Admissions, Publish Events & Announcements, Manage Classes & Subjects, Generate Transcripts, and Manage Promotions. These defaults are applied automatically when staff are created or updated.",
    keywords: ["default permissions", "teacher default", "supervisor default", "manage assessments", "mark attendance", "manage students", "manage guardians", "manage reports", "what can teachers do", "what can supervisors do"]
  },
  {
    id: 48,
    category: "Security & Access",
    question: "Can we assign extra permissions to specific teachers or supervisors?",
    answer: "Yes. During Create Employee and Modify Employee, organizations can add optional extra permissions for individual staff members. This allows selective delegation (for example, granting additional responsibilities to a specific teacher) without changing the staff member's base role.",
    keywords: ["assign permissions", "extra permissions", "create employee", "modify employee", "delegate access", "teacher extra access", "supervisor access", "additional permissions", "grant access"]
  },
  {
    id: 49,
    category: "Security & Access",
    question: "Where are assigned permissions saved?",
    answer: "Assigned permissions are stored in the database in a dedicated user_permissions table scoped by organization. This means permissions persist across sessions and are enforced consistently by the backend.",
    keywords: ["saved permissions", "database", "user_permissions", "persistent permissions", "organization scoped", "stored"]
  },
  {
    id: 50,
    category: "Security & Access",
    question: "Can non-manager staff grant high-risk permissions?",
    answer: "No. High-risk permissions such as employee management and organization settings are restricted. Non-manager users cannot assign Manager role and cannot grant high-risk permissions, even if they attempt to submit them manually.",
    keywords: ["high risk permissions", "manager only", "grant restrictions", "secure delegation", "manage employees", "manage settings", "restricted"]
  },
  {
    id: 51,
    category: "Security & Access",
    question: "How can organizations review who has which permissions?",
    answer: "Use the Manage Employees page to review staff records. The page now shows each employee's assigned permissions so administrators can quickly audit access and update permissions when responsibilities change.",
    keywords: ["manage employees", "permission audit", "view permissions", "staff access review", "security review", "check permissions", "who has access"]
  },
  {
    id: 52,
    category: "Security & Access",
    question: "Which organization actions are now protected by explicit permission checks?",
    answer: "Permission checks now protect key organization actions, including employee management, admissions approval workflows, event/announcement publishing, school-year and term management, class/subject setup, transcript generation routes, promotion workflows, and billing/settings operations. Sensitive attendance and student archive actions are also protected by authentication and explicit permissions.",
    keywords: ["protected routes", "secure endpoints", "employee management security", "attendance security", "archive students", "authorization", "what is protected"]
  },
  {
    id: 53,
    category: "Security & Access",
    question: "Which granular permissions are available now?",
    answer: "Available granular permissions include admissions approval, events/announcements publishing, school-year and term management, class/subject setup, transcript generation, promotion approval, and billing/settings delegation. Organizations can combine these with role defaults and optional extras per staff member.",
    keywords: ["granular permissions", "available permissions", "custom permissions", "granular access", "admissions approval", "announcement publishing", "term management", "transcript permission", "billing delegation", "list of permissions"]
  },
  {
    id: 54,
    category: "Technical & Platform",
    question: "Does Managira support collaborative files and spreadsheets with formulas?",
    answer: "Yes. Managira includes Files for rich-text documents and spreadsheets. You can assign files to classes and teachers, auto-save edits, select ranges of cells, use basic formulas like SUM, AVERAGE, COUNT, MIN, and MAX, and expand sheets by adding more rows and columns whenever needed.",
    keywords: ["files", "documents", "spreadsheets", "sheet", "cells", "formula", "sum", "average", "count", "min", "max", "add rows", "add columns", "auto save", "assign files", "collaborative", "shared files"]
  },

  // Student Management
  {
    id: 55,
    category: "Student Management",
    question: "How do I add a new student?",
    answer: "You can add students from the class dashboard by clicking 'Add Student'. Fill in the student's personal details, guardian information, and class assignment. You can also bulk-import students from CSV or spreadsheet files for faster setup.",
    keywords: ["add student", "new student", "create student", "register student", "student registration", "enroll student", "enter student", "input student"]
  },
  {
    id: 56,
    category: "Student Management",
    question: "How do I edit or update student details?",
    answer: "Navigate to the student's profile from the class dashboard or student list. Click 'Edit' to update personal information, contact details, guardian details, or class assignment. Changes are saved immediately.",
    keywords: ["edit student", "update student", "modify student", "change student info", "student details", "student profile"]
  },
  {
    id: 57,
    category: "Student Management",
    question: "Can I transfer a student between classes?",
    answer: "Yes. From the student's profile, you can change their class assignment. This moves the student to a different class while preserving all their academic records and history.",
    keywords: ["transfer student", "move student", "change class", "switch class", "reassign student", "different class"]
  },
  {
    id: 58,
    category: "Student Management",
    question: "How do I archive or remove a student?",
    answer: "Students can be archived from the Manage Students section. Archived students are removed from active class lists but their records are preserved for historical reference. You can view archived students at any time.",
    keywords: ["archive student", "remove student", "delete student", "inactive student", "deactivate student", "withdrawn", "left school"]
  },
  {
    id: 59,
    category: "Student Management",
    question: "How do I view a student's complete academic history?",
    answer: "Open the student's profile and navigate to their academic details. You'll see grades, assessments, attendance records, and reports across all terms and years they've been enrolled. You can also generate a full transcript from this view.",
    keywords: ["student history", "academic history", "student record", "past grades", "previous terms", "all records", "complete record"]
  },

  // Assessments & Grading
  {
    id: 60,
    category: "Assessments & Grading",
    question: "How do I create a test or assessment?",
    answer: "Go to the Assessment section from your class dashboard. Click 'Create Test' to define the assessment name, total marks, and other details. Once created, you can enter marks for each student.",
    keywords: ["create test", "new test", "create assessment", "new assessment", "add test", "set up test", "exam", "quiz"]
  },
  {
    id: 61,
    category: "Assessments & Grading",
    question: "How do I enter student grades?",
    answer: "After creating a test or assessment, navigate to it and you'll see a list of students. Enter marks for each student and save. The system automatically calculates percentages and can generate rankings.",
    keywords: ["enter grades", "input marks", "record grades", "grade students", "score entry", "mark entry", "results"]
  },
  {
    id: 62,
    category: "Assessments & Grading",
    question: "Can I modify or delete an assessment?",
    answer: "Yes. You can edit assessment details or delete assessments from the Manage Assessment section. Note that deleting an assessment also removes all associated student marks, so use this with caution.",
    keywords: ["modify assessment", "edit test", "delete test", "change assessment", "update test", "remove test"]
  },

  // Attendance
  {
    id: 63,
    category: "Attendance",
    question: "How do I mark attendance?",
    answer: "Navigate to the Attendance section from the class dashboard. You'll see a list of students — mark each as present, absent, or late for the day. Attendance can also be marked in bulk for faster processing.",
    keywords: ["mark attendance", "take attendance", "record attendance", "present absent", "daily attendance", "attendance register", "roll call"]
  },
  {
    id: 64,
    category: "Attendance",
    question: "Can I view attendance history and reports?",
    answer: "Yes. Managira tracks all attendance data over time. You can view daily, weekly, and term-based attendance reports for individual students or entire classes. This helps identify patterns and address chronic absenteeism.",
    keywords: ["attendance history", "attendance report", "attendance record", "past attendance", "attendance data", "attendance stats", "absenteeism"]
  },

  // Employment
  {
    id: 65,
    category: "Employment",
    question: "How do I apply for a job at a school using Managira?",
    answer: "Visit the school's public page on Managira and look for the Employment section. You can browse available positions and submit your application with your details, qualifications, and cover letter. The school will review your application and respond via email.",
    keywords: ["apply job", "employment", "job application", "career", "vacancy", "work at school", "hire", "position", "job opening"]
  },
  {
    id: 66,
    category: "Employment",
    question: "How does a school manage employee applications?",
    answer: "School administrators can view, approve, or reject employment applications from the Admin dashboard under Manage Employment. Approved applicants receive an email notification, and rejected applicants are notified as well.",
    keywords: ["manage employment", "approve application", "reject application", "employment management", "staff hiring", "review applications"]
  },
  {
    id: 67,
    category: "Employment",
    question: "How do I create a new employee account?",
    answer: "From the Manage Employees section, click 'Create Employee'. Fill in the employee's details including name, email, role (Teacher, Supervisor, or Manager), and assigned classes. The employee will receive an email invitation to set up their account.",
    keywords: ["create employee", "new employee", "add staff", "add teacher", "hire employee", "employee account", "invite teacher", "onboard staff"]
  },

  // Donations
  {
    id: 68,
    category: "Donations",
    question: "Does Managira accept donations?",
    answer: "Yes. Managira accepts donations to support the continued development of the platform and to help make educational technology accessible to more schools. You can make a donation through the Donations page on our website.",
    keywords: ["donations", "donate", "contribute", "support", "give", "fund", "sponsor", "charity", "help fund"]
  },

  // Account Management
  {
    id: 69,
    category: "Account Management",
    question: "How do I update my account information?",
    answer: "Go to Account Settings from the navigation menu. You can update your personal details, email address, organisation name, and other profile information. Changes are saved immediately.",
    keywords: ["update account", "account settings", "profile", "change email", "change name", "edit profile", "my account", "personal info"]
  },
  {
    id: 70,
    category: "Account Management",
    question: "How do I update my school's information?",
    answer: "Navigate to Account Settings and select the Organisation/School settings section. You can update your school name, address, contact information, logo, and other details.",
    keywords: ["update school", "school info", "school settings", "organisation settings", "school name", "school address", "school details"]
  },
  {
    id: 71,
    category: "Account Management",
    question: "Can multiple staff members manage the same school?",
    answer: "Yes. You can create multiple employee accounts with different roles and permissions. Managers have full access, while Teachers and Supervisors have access based on their assigned permissions. This allows collaborative school management.",
    keywords: ["multiple staff", "multiple users", "shared access", "team management", "collaborative", "many admins", "several managers"]
  },

  // Promotion System
  {
    id: 72,
    category: "Promotions",
    question: "How does student promotion work in Managira?",
    answer: "Managira automates student promotions based on academic performance. In Report Settings, you set a cut-off point (e.g. 50%), a 'Promoted To' class, and a 'Repeated In' class. When student reports are generated, the system automatically calculates whether each student meets the cut-off. Students who pass are marked for promotion to the next class; those who don't are marked to repeat. You can then apply promotions instantly with the 'Apply Now' button, which moves all students to their new classes in one click.",
    keywords: ["promotion", "promote", "advance", "next class", "next grade", "cut off", "cutoff", "pass", "fail", "repeat", "move students", "apply now", "automatic promotion", "promoted to", "repeated in"]
  },
  {
    id: 73,
    category: "Promotions",
    question: "Can I promote students instantly without scheduling?",
    answer: "Yes! Use the 'Apply Now' button on the Promotion page. This immediately enrolls all students into their promoted or repeated classes based on their report scores. No need to wait for a scheduled job — promotions happen in real-time with one click.",
    keywords: ["apply now", "instant promotion", "immediate", "one click", "quick promote", "no schedule", "promote now", "fast promotion"]
  },
  {
    id: 74,
    category: "Promotions",
    question: "How do I set promotion cut-off points?",
    answer: "Go to Report Settings for the relevant class and term. You'll find fields to set the minimum passing percentage (cut-off point), the class students are promoted to if they pass, and the class they repeat if they don't meet the cut-off. These settings are used automatically when generating student reports.",
    keywords: ["cut off", "cutoff", "passing grade", "minimum score", "promotion settings", "report settings", "pass mark", "threshold"]
  },
  {
    id: 75,
    category: "Promotions",
    question: "Can I reverse a promotion that was already applied?",
    answer: "Yes. On the Promotion page, you can reverse promotions that have already been applied. This will move students back to their original classes. You can also delete reversed promotions to clean up the records.",
    keywords: ["reverse promotion", "undo promotion", "cancel promotion", "move back", "wrong promotion", "fix promotion", "revert"]
  },

  // Term & Semester Management
  {
    id: 76,
    category: "Term Management",
    question: "How do terms and semesters work in Managira?",
    answer: "Each school year contains one or more terms (or semesters). You define the name, start date, and end date for each term when registering a school year. The system validates that term dates don't overlap and that each term's start date comes before its end date. One term is always set as 'current', which controls what appears on dashboards, attendance, and assessments.",
    keywords: ["term", "semester", "school year", "academic year", "current term", "term dates", "set current", "quarters", "periods"]
  },
  {
    id: 77,
    category: "Term Management",
    question: "What happens if I set the wrong term as current?",
    answer: "Managira includes a smart warning system. If you try to set a term as 'current' that doesn't align with today's date, you'll see a confirmation prompt like: 'Based on today's date, it looks like you should be in Term 2, but you are selecting Term 3. Do you want to proceed?' This helps prevent accidental misconfiguration while still allowing you to view historical records.",
    keywords: ["wrong term", "smart warning", "term warning", "accidental", "set current", "current term", "date mismatch", "confirmation", "prompt"]
  },
  {
    id: 78,
    category: "Term Management",
    question: "Can term dates overlap?",
    answer: "No. Managira validates all term dates when you create or update a school year. If any two terms have overlapping date ranges, the system will display an error and prevent saving. This ensures clean academic periods with no conflicts in attendance or assessment records.",
    keywords: ["overlap", "overlapping terms", "date conflict", "term dates", "validation", "date range", "duplicate dates"]
  },
  {
    id: 79,
    category: "Term Management",
    question: "How do I switch to a new term or semester?",
    answer: "Go to Manage Records, find the school year and term you want to activate, and click 'Set as Current'. The system will check if the selected term aligns with today's date and warn you if it doesn't. Once set, all dashboards, attendance, and assessments will reflect the new current term.",
    keywords: ["switch term", "change term", "new semester", "activate term", "set as current", "next term", "advance term", "move to next term"]
  },

  // Password Reset
  {
    id: 80,
    category: "Account Management",
    question: "How do I reset my password if I forgot it?",
    answer: "Click 'Forgot Password' on the login page and enter your email address. Managira supports password reset for all account types — school administrators, staff users, guardians, and hub administrators. You'll receive a reset link via email that's valid for 1 hour. Click the link to set a new password.",
    keywords: ["forgot password", "forget password", "reset password", "lost password", "can't login", "password recovery", "change password", "new password", "locked out"]
  },
  {
    id: 81,
    category: "Account Management",
    question: "Can guardians and hub admins reset their passwords?",
    answer: "Yes! All account types can reset passwords using the same 'Forgot Password' flow. Whether you're a school user, organisation admin, guardian, or hub administrator, simply enter your registered email on the forgot password page and you'll receive a reset link.",
    keywords: ["guardian password", "hub password", "parent password", "all accounts", "password reset all", "universal reset", "any account type"]
  },

  // Email System
  {
    id: 82,
    category: "System & Performance",
    question: "Why do some pages take long to load when emails are being sent?",
    answer: "Managira processes all emails in the background, so page loads are never delayed by email sending. If you experience slow loading, it's not related to emails — it may be due to network connectivity or server load. All actions like approvals, password resets, and report emails complete instantly on your screen while emails are delivered separately in the background.",
    keywords: ["slow loading", "email delay", "page slow", "email blocking", "performance", "speed", "loading time", "background email", "non-blocking"]
  },
  {
    id: 83,
    category: "System & Performance",
    question: "What happens if an email fails to send?",
    answer: "If an email fails to send (e.g., due to a temporary server issue), the action itself (like approving an application or resetting a password) still completes successfully. The email failure is logged for troubleshooting but does not affect the core operation. For report card emails, you can view email history and retry failed emails from the Email History page.",
    keywords: ["email failed", "email error", "email not received", "email problem", "retry email", "email history", "email log", "delivery failure"]
  },

  // User Documentation topics
  {
    id: 84,
    category: "User Documentation",
    question: "Where can I find the Managira user documentation?",
    answer: "The full Managira User Documentation is available at /legal/user-documentation. It covers everything from getting started, setting up your organization, roles and permissions, student management, attendance tracking, assessments, report cards, promotions, admissions, school websites, and troubleshooting. You can also find a link to it on the FAQ page and in the footer of every page.",
    keywords: ["user documentation", "documentation", "user guide", "manual", "help guide", "how to use managira", "docs", "user docs", "guide", "tutorial", "instructions"]
  },
  {
    id: 85,
    category: "User Documentation",
    question: "How do I set up my school organization on Managira?",
    answer: "To set up your organization: 1) Set up school years and terms. 2) Create classes using the naming structure that fits your school. 3) Create subjects. 4) Configure graduation years. 5) Activate the current school year and term. 6) Start enrollment to assign students to classes. 7) Invite staff through Employee Management and assign roles. 8) Set up your school website. Full details are in the User Documentation at /legal/user-documentation.",
    keywords: ["setup organization", "set up school", "organization setup", "configure school", "first time setup", "initial setup", "onboard school", "school configuration", "how to setup"]
  },
  {
    id: 86,
    category: "User Documentation",
    question: "What are the different service plans available on Managira?",
    answer: "Managira offers three plans: 1) Starter Plan — core student, attendance, assessment, and reporting tools. 2) Professional Plan — adds parent/guardian portal access and official transcript capability. 3) Premium/Business Plan — adds school website, class-based analytics and merit sheets, document management, and included multi-school hub support. All plans include student profiles, assessment tracking, attendance, terminal reports, and organization dashboard with analytics. Visit /legal/user-documentation for the full plan comparison.",
    keywords: ["plans", "pricing", "starter", "professional", "premium", "business plan", "service plan", "plan comparison", "which plan", "features comparison", "plan differences"]
  },
  {
    id: 87,
    category: "User Documentation",
    question: "How does the school website feature work in Managira?",
    answer: "The School Website gives each school a professional public presence. Schools can publish hero images, banners, image galleries, about sections, announcements, event information, and contact details. Authorized users manage content directly — uploading images, creating/updating/reordering sections, and publishing updates. When online admissions are enabled, the school website also acts as a public entry point for applications. This feature is available on the Premium/Business plan. See /legal/user-documentation for full details.",
    keywords: ["school website", "public website", "website feature", "publish website", "school site", "web presence", "school page", "website setup", "online presence"]
  },
  {
    id: 88,
    category: "User Documentation",
    question: "How does the admissions process work on Managira?",
    answer: "Managira supports two admissions pathways: 1) Self Admission — parents/guardians apply through the school website by entering student and guardian details and making any required payment. Applications are stored as pending for review. 2) School Managed Admission — authorized users admit students through manual entry, bulk-assisted workflows, or image/document-based extraction. All pending admissions are reviewed and approved/rejected by authorized school users. See /legal/user-documentation for the complete admissions guide.",
    keywords: ["admissions", "admission process", "enroll student", "enrollment process", "student admission", "apply for admission", "self admission", "school admission", "how to admit", "new student admission"]
  },
  {
    id: 89,
    category: "User Documentation",
    question: "How do assessments and tests work in Managira?",
    answer: "Managira lets schools build assessment structures matching their academic model — letter grades, percentages, or custom scoring. Authorized users create assessment structures per class and subject, deciding how many tests, exams, and assignments contribute to the final grade with weighted components. Assessment periods can be opened/closed per the school calendar. Teachers enter scores through simple forms, and results flow into report cards and the parent portal automatically. See /legal/user-documentation for details.",
    keywords: ["assessments", "tests", "grading", "scoring", "exam", "assessment structure", "grade entry", "score entry", "weighted grades", "test setup", "how assessments work"]
  },
  {
    id: 90,
    category: "User Documentation",
    question: "How does attendance tracking work in Managira?",
    answer: "Teachers record attendance for assigned classes. The system captures each student's status and stores a full attendance history. Managers can access attendance for any class, while teachers can collect attendance only for classes where they are Main Teacher. School leaders can review summaries by class, grade, or across the school. Parents can view attendance through the parent portal. Attendance settings align with the school calendar to handle holidays and exam periods. See /legal/user-documentation for complete details.",
    keywords: ["attendance tracking", "mark attendance", "attendance system", "roll call", "attendance record", "student attendance", "how attendance works", "attendance collection", "daily attendance"]
  },
  {
    id: 91,
    category: "User Documentation",
    question: "How do I generate report cards in Managira?",
    answer: "Schools can generate terminal report cards using recorded grades, attendance data, and teacher comments. Reports can be printed or shared digitally. School leaders can also access school-level reporting on enrollment, attendance, grade distribution, and academic indicators. Reports can be shared with parents through the parent portal or by email. All reports respect user roles and permissions. See /legal/user-documentation for full reporting guidance.",
    keywords: ["report cards", "generate reports", "terminal reports", "student reports", "print report", "report generation", "how to generate report", "create report card", "merit sheet"]
  },
  {
    id: 92,
    category: "User Documentation",
    question: "What common issues can I troubleshoot myself in Managira?",
    answer: "Common issues and fixes: 1) Cannot mark attendance — confirm you are listed as the Main Teacher for that class. 2) Teacher cannot see a class — verify role assignments in user settings. 3) Report not generating — confirm all grades are entered and current term is correctly selected. 4) Parent cannot log in — use the Forgot Password option to reset access. 5) Feature is not visible — review your service plan or contact support. For more troubleshooting help, see /legal/user-documentation.",
    keywords: ["troubleshooting", "common issues", "problems", "fix", "not working", "cannot", "error", "issue", "help fix", "broken", "bug", "something wrong"]
  },
  {
    id: 93,
    category: "User Documentation",
    question: "How does promotion and graduation work in Managira?",
    answer: "Schools can review student performance and apply promotion rules based on their own criteria including score thresholds and attendance expectations. Promotions can be applied immediately or scheduled after term closure. Authorized users can review, reverse, or correct actions. When students graduate or leave, records can be archived while preserving the full academic history. See /legal/user-documentation for the complete promotion and graduation guide.",
    keywords: ["promotion", "graduation", "student progression", "promote students", "graduate students", "archive students", "next grade", "advancement", "how promotion works"]
  },

  // Email Notifications
  {
    id: 94,
    category: "Email Notifications",
    question: "What kinds of emails does Managira send?",
    answer: "Managira sends several categories of emails: (1) Account & security — password reset, password set confirmations, account invitations. (2) Billing — payment receipts, new invoices, subscription cancellation, renewal-failed notices, scheduled-hold notices, student-tier-exceeded notices. (3) Onboarding — organization registration confirmation with Starter Pack, employee invites, guardian portal welcome. (4) Hub membership — invitations, joined notices, detachment requests, approvals, rejections, removals. (5) Admissions & enrollment — application received, approved, rejected, public registration payment confirmation. (6) Academic — assessment access updates, files assigned to a class, report cards, official transcripts, class change, teacher reassignment. (7) Communications — staff-to-guardian reports and replies, broadcasts of events and announcements. (8) Digests — weekly Saturday digests for parents, teachers, managers, and hubs. (9) Operations — support ticket created/responded/resolved/reopened, demo request received, employment application updates.",
    keywords: ["emails", "email types", "notifications", "what emails", "managira sends", "email categories", "list emails", "email list"]
  },
  {
    id: 95,
    category: "Email Notifications",
    question: "Which weekly digests does Managira send?",
    answer: "Managira sends four weekly digests every Saturday: (1) Weekly Parent Digest to guardians — summarizes their children's progress for the week. (2) Weekly Teacher Digest to teachers — summarizes their assigned classes and subjects. (3) Weekly Leadership Report to managers and supervisors — covers at-risk students and school metrics. (4) Weekly Hub Overview to hub administrators — cross-organization summary across all member schools. There is no monthly digest.",
    keywords: ["weekly digest", "digests", "saturday digest", "weekly report", "leadership report", "parent digest", "teacher digest", "hub digest", "monthly digest"]
  },
  {
    id: 96,
    category: "Email Notifications",
    question: "Which emails go to guardians (parent portal users)?",
    answer: "Guardians receive: welcome / password setup, additional-student-added notice, admission application received, public registration payment confirmation, admission approved or rejected, attendance alerts when a child is absent multiple times in a week, the weekly Saturday parent digest, class-change notices, staff reports about their child and replies, report cards (with PDF), official transcripts when shared, and broadcasts of events and announcements that are public-visible. All guardian-portal logins are protected by the guardian password setup/reset flow.",
    keywords: ["guardian emails", "parent emails", "parent notifications", "what guardians receive", "parent portal emails", "guardian notifications"]
  },
  {
    id: 97,
    category: "Email Notifications",
    question: "Which emails go to teachers, managers, and supervisors?",
    answer: "Teachers receive: weekly teaching digest, assignment-changed notices, assessment lock/unlock and access updates, files assigned to their class, broadcasts of events and announcements, and copies of guardian reports for students they class-teach. Managers and supervisors receive: weekly leadership report, broadcasts of events and announcements, and copies of guardian reports and replies as fallback recipients. All staff also receive role-agnostic emails: invitation to set password, password-set confirmation, password reset, and on-hold or reactivation notices.",
    keywords: ["teacher emails", "manager emails", "supervisor emails", "staff notifications", "what staff receive", "teacher notifications"]
  },
  {
    id: 98,
    category: "Email Notifications",
    question: "Which Managira emails cannot be turned off?",
    answer: "Transactional and legal-of-record emails are always sent and cannot be silenced. These include: password reset request and confirmation, all invitation and password-set emails (employee, guardian, hub), organization registration confirmation, all billing emails (payment receipt, invoice, subscription cancellation, renewal-failed, scheduled hold), all support ticket emails (created, responded, resolved, reopened), demo request received, employment application confirmations and decisions, transcript share, public registration payment confirmation, admission approval and rejection, and all hub-membership decision emails (invite, welcome, joined, detachment approved/rejected, removed). User-toggleable emails are limited to digests, broadcasts, and routine staff/guardian notifications.",
    keywords: ["forced emails", "cannot disable", "always sent", "must-send emails", "transactional emails", "required emails", "mandatory emails"]
  },
  {
    id: 99,
    category: "Email Notifications",
    question: "How do I choose which emails I receive?",
    answer: "Each user can opt out of optional (non-transactional) emails from their own settings page. Organization users (Manager, Supervisor, Teacher, Cashier) open Account Settings and select the Notifications tab to toggle items like the weekly digest, broadcasts, guardian-report alerts, and assignment-change notices. Parents/guardians open the Parent Portal Settings page and use the Email Notifications section to toggle the weekly parent digest, attendance alerts, class-change notices, broadcasts, report-card delivery, and staff replies. Hub administrators manage their preferences from the hub admin settings. Choices save instantly, are per-user, and only affect optional emails — security, billing, and other transactional emails are always sent.",
    keywords: ["opt out", "unsubscribe", "email preferences", "turn off emails", "notification settings", "stop receiving", "manage emails", "email opt-in", "notifications tab"]
  }
];

module.exports = managiraFAQ;
