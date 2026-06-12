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
    id: 12,
    category: "Educators & Admins",
    question: "Can I customise the portal with my school's logo and colours?",
    answer: "Yes. Under the Personalisation settings, you can upload your school logo, set your brand colours and fonts, and customise your public-facing school website. This ensures Managira looks and feels like your own platform.",
    keywords: ["customise", "customize", "portal", "school logo", "colours", "colors", "branding", "personalisation", "personalization", "fonts", "theme", "appearance", "look"]
  },
  {
    id: 14,
    category: "Educators & Admins",
    question: "Is training provided for new users?",
    answer: "Yes. We provide onboarding documentation, in-app guides, and video tutorials on our YouTube channel. For larger institutions, we can arrange personalised training sessions to help your team get comfortable with the platform.",
    keywords: ["training", "new users", "onboarding", "documentation", "tutorials", "youtube", "learn", "how to use", "guide", "instructions"]
  },
  {
    id: 16,
    category: "Educators & Admins",
    question: "Is there an analytics dashboard?",
    answer: "Yes. Managira's analytics dashboard provides visual insights into student performance trends, attendance statistics, class comparisons, and operational metrics. Leaders can use this data to make informed decisions about curriculum, staffing, and resource allocation.",
    keywords: ["analytics", "dashboard", "student performance", "attendance stats", "insights", "data-driven", "statistics", "charts", "graphs", "metrics", "data"]
  },

  // Hub Management & Government Institutions
  {
    id: 18,
    category: "Hub Management & Government Institutions",
    question: "What is a Managira Hub?",
    answer: "A Managira Hub is a centralised management layer for education ministries, school districts, dioceses, private school groups, and other bodies that oversee multiple schools. It provides a single dashboard for monitoring performance, coordinating operations, managing staff oversight, and handling shared administration across member institutions.",
    keywords: ["hub", "government", "education department", "school district", "multiple schools", "centralised", "oversight", "network", "group of schools", "manage schools", "hub users", "ministries", "education offices"]
  },
  {
    id: 21,
    category: "Hub Management & Government Institutions",
    question: "Can a Hub control billing for member schools?",
    answer: "Yes. When a school joins a Hub, billing is managed centrally by the Hub operator. Member schools no longer see individual billing options — all subscription management is handled at the Hub level, simplifying financial administration.",
    keywords: ["hub billing", "centralised billing", "subscription", "member schools", "financial", "hub payment", "pay for schools"]
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
    answer: "Managira supports secure payments through Stripe and other configured payment methods depending on the workflow. For school payments, a school can enable options such as online card or wallet checkout through Stripe and bank transfer, while some Managira billing flows may also use region-specific gateways such as Paystack. The payment methods a user sees depend on the school's configuration and the bill being paid.",
    keywords: ["payment methods", "stripe", "paystack", "credit card", "wallet", "bank transfer", "how to pay", "accepted payments", "debit card", "school payments", "paygira"]
  },
  {
    id: 28,
    category: "Billing & Subscription",
    question: "How does Managira pricing work?",
    answer: "Managira offers flexible pricing based on the size and needs of your institution. Every school starts with a free trial for a full academic term, and annual billing options or volume pricing may be available for larger organisations. For a formal quote, visit the pricing page or contact managirainfo@gmail.com.",
    keywords: ["how much", "cost", "price", "pricing", "expensive", "affordable", "rate", "fee", "charges", "subscription cost", "discount", "annual billing", "sales", "yearly", "bulk discount", "save money"]
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
    answer: "Parents and guardians access their child's information through the Guardian Portal, which is Managira's secure parent-facing area. Schools provide login credentials, and once signed in, guardians can view grades, attendance, report cards, announcements, and other updates in real time.",
    keywords: ["parents", "guardians", "access", "guardian portal", "grades", "attendance", "report cards", "child info", "kid grades", "my child", "son", "daughter", "view grades", "parent portal", "guardian login", "parent login"]
  },
  {
    id: 32,
    category: "Parents & Guardians",
    question: "Can parents submit reports or concerns?",
    answer: "Yes. The Guardian Portal includes a reporting feature where parents can submit concerns, questions, or feedback directly to the school. Schools can review and respond to these reports through their admin dashboard.",
    keywords: ["parent reports", "concerns", "feedback", "guardian portal", "reporting", "complaint", "issue", "problem", "worry"]
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
    id: 39,
    category: "Security & Access",
    question: "How do I reset or change my password?",
    answer: "If you know your current password, you can change it from Account Settings after signing in. If you've forgotten it, use the 'Forgot Password' link on the login page to receive a secure reset email. This reset flow is available for school users, guardians, and hub administrators. If the email does not arrive, check your spam folder first and then contact your school administrator or support team.",
    keywords: ["forget password", "forgot password", "login page", "reset link", "email", "can't login", "locked out", "password reset", "lost password", "change password", "update password", "new password", "modify password", "password settings", "account settings", "guardian password", "hub password", "parent password", "all accounts"]
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
    id: 44,
    category: "Technical & Platform",
    question: "What should I do if I encounter a technical issue?",
    answer: "Visit our Get Help page to submit a support request, or email info@managira.com directly. Please include details about the issue, your browser, and any error messages you see. Our support team typically responds within 24 hours.",
    keywords: ["technical issue", "support team", "help", "info@managira.com", "support request", "bug", "error", "problem", "not working", "broken", "issue"]
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
    answer: "Yes. From the student's profile or student management pages, you can change the student's class assignment. Managira preserves the student's academic history and can also help carry matching subjects into the new class when you choose to keep existing subjects.",
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
  {
    id: 110,
    category: "Student Management",
    question: "How do I set up my school to use custom student IDs?",
    answer: "Open Settings and go to the Student ID Settings card. Turn on Custom student IDs if you want your school to use its own format, add an optional prefix such as MGT, then decide whether IDs should be auto-generated. If auto-generation is on, choose the starting number and save. The system shows a preview like MGT001 and uses that format across student management pages.",
    keywords: ["set up student id", "student id settings", "custom student id", "custom student ids", "school student id format", "student id in settings", "use custom student ids", "prefix", "auto generate id", "starting number", "student id setup", "how to use student id"]
  }
];

module.exports = managiraFAQ;
