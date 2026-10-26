// Managira FAQ Knowledge Base - short, quick-answer items only.
const managiraFAQ = [
  {
    id: 1,
    category: "Getting Started",
    question: "What is Managira?",
    answer: "Managira is an all-in-one school management platform - admissions, attendance, grading and report cards, promotion, billing, transportation, staff management, and parent/guardian communication all run from one system, for individual schools and school districts alike, instead of stitching together separate tools for each job.",
    keywords: ["what is managira", "overview", "school management", "all-in-one school software", "complete school management system"]
  },
  {
    id: 22,
    category: "Getting Started",
    question: "Is Managira an all-in-one school management solution, or just one tool among several?",
    answer: "All-in-one, by design. Admissions, student and guardian records, attendance, assessments and grading, report cards and merit sheets, promotion between terms, staff/employee management, school transportation, billing, announcements, the public school website, and Docs/Sheets are all part of the same platform - a school runs its full administration in Managira rather than combining it with separate, disconnected tools.",
    keywords: ["all-in-one school software", "complete school management platform", "single system school administration", "comprehensive school software"]
  },
  {
    id: 2,
    category: "Getting Started",
    question: "Who can use Managira?",
    answer: "Schools, hubs, administrators, teachers, guardians, and education oversight teams can use Managira.",
    keywords: ["who can use", "users", "schools", "hubs", "teachers", "guardians"]
  },
  {
    id: 3,
    category: "Getting Started",
    question: "How do I register my school?",
    answer: "Go to school registration, complete setup, then follow the User Documentation guides for full onboarding.",
    keywords: ["register school", "signup", "onboarding", "getting started"]
  },
  {
    id: 4,
    category: "Getting Started",
    question: "Is there a free trial?",
    answer: "Yes. Trial availability and length depend on your current platform settings.",
    keywords: ["free trial", "trial period"]
  },
  {
    id: 6,
    category: "Getting Started",
    question: "How do I contact support?",
    answer: "Use the Help Center or email info@managira.com.",
    keywords: ["support", "contact", "help", "email"]
  },
  {
    id: 9,
    category: "Educators & Admins",
    question: "Can staff update student information?",
    answer: "Yes, if their role and permissions allow it.",
    keywords: ["staff permissions", "edit student", "update student"]
  },
  {
    id: 12,
    category: "Educators & Admins",
    question: "Can I customize my school branding?",
    answer: "Yes. You can update logo, theme colors, and related personalization settings.",
    keywords: ["branding", "logo", "theme", "personalization"]
  },
  {
    id: 16,
    category: "Educators & Admins",
    question: "Is there an analytics dashboard?",
    answer: "Yes. Managira includes dashboards for attendance, academic, and operational insights.",
    keywords: ["analytics", "dashboard", "insights"]
  },
  {
    id: 18,
    category: "Hub Management",
    question: "What is a Managira Hub?",
    answer: "A Hub lets one organization - a school district, a network of schools, or an education oversight body - manage and support multiple member schools from a single central workspace, while each school keeps running its own day-to-day operations independently.",
    keywords: ["hub", "multi-school", "oversight", "school district software", "district management"]
  },
  {
    id: 19,
    category: "Hub Management",
    question: "Does Managira support school districts?",
    answer: "Yes. Managira is built for individual schools as well as school districts and multi-school networks - a district oversight team can supervise, support, and coordinate every member school from one Hub dashboard, without taking over each school's own daily administration.",
    keywords: ["school district software", "district management system", "multi-school platform", "school network"]
  },
  {
    id: 20,
    category: "Hub Management",
    question: "Can a school district monitor multiple schools from one place?",
    answer: "Yes. A district's Hub dashboard gives central visibility across every member school - coordinating operations and oversight district-wide - while each school retains its own independent records, staff, and students.",
    keywords: ["district dashboard", "multi-school oversight", "central school district management"]
  },
  {
    id: 21,
    category: "Hub Management",
    question: "Can hubs manage billing for member schools?",
    answer: "Yes. In hub-managed setups - including school districts - billing can be controlled centrally across every member school from the Hub.",
    keywords: ["hub billing", "central billing", "district billing"]
  },
  {
    id: 24,
    category: "Billing & Subscription",
    question: "Can I change my subscription plan?",
    answer: "Yes. Plan changes are available in account billing/settings.",
    keywords: ["upgrade", "downgrade", "change plan"]
  },
  {
    id: 25,
    category: "Billing & Subscription",
    question: "What happens if a payment fails?",
    answer: "You receive notifications and can retry with an active payment method.",
    keywords: ["payment failed", "retry payment", "billing"]
  },
  {
    id: 26,
    category: "Billing & Subscription",
    question: "What payment methods are supported?",
    answer: "Supported methods depend on your configured payment provider and school settings.",
    keywords: ["payment methods", "stripe", "paystack", "bank", "card"]
  },
  {
    id: 29,
    category: "Billing & Subscription",
    question: "How do I cancel a subscription?",
    answer: "Use account billing/settings to cancel according to your billing cycle.",
    keywords: ["cancel subscription", "unsubscribe"]
  },
  {
    id: 30,
    category: "Parents & Guardians",
    question: "How do guardians view their child's records?",
    answer: "Guardians sign in through the Guardian Portal to view assigned student records.",
    keywords: ["guardian portal", "parent access", "view child"]
  },
  {
    id: 32,
    category: "Parents & Guardians",
    question: "Can guardians submit concerns?",
    answer: "Yes. Guardians can submit concerns or feedback from the portal workflows made available by the school.",
    keywords: ["guardian concerns", "feedback", "report issue"]
  },
  {
    id: 35,
    category: "Security & Access",
    question: "Is student data secured?",
    answer: "Yes. All traffic uses HTTPS, and each school's data is kept separate so staff and parents only see their own school. Every staff account has individually granted permissions, sessions end after inactivity, sending messages to families requires the sender's password, and staff actions are recorded in the school's activity log. Card payments are processed by Stripe and Paystack, and Managira never stores full card numbers.",
    keywords: ["security", "data protection", "encryption"]
  },
  {
    id: 39,
    category: "Security & Access",
    question: "How do I reset my password?",
    answer: "Use Forgot Password on the login page, then follow the reset link sent to your email.",
    keywords: ["forgot password", "reset password", "login"]
  },
  {
    id: 41,
    category: "Technical & Platform",
    question: "What devices are supported?",
    answer: "Managira works on modern desktop and mobile browsers.",
    keywords: ["devices", "mobile", "desktop", "browser"]
  },
  {
    id: 42,
    category: "Technical & Platform",
    question: "Can I export data?",
    answer: "Yes. Export options are available in supported modules and reports.",
    keywords: ["export", "csv", "pdf", "download"]
  },
  {
    id: 44,
    category: "Technical & Platform",
    question: "What should I do if something is not working?",
    answer: "Use the Help Center, then contact support if the issue continues.",
    keywords: ["technical issue", "not working", "support"]
  },
  {
    id: 55,
    category: "Student Management",
    question: "How do I add a student?",
    answer: "Use the student/add workflow in your management area for your current term and class setup.",
    keywords: ["add student", "new student"]
  },
  {
    id: 63,
    category: "Attendance",
    question: "How do I mark attendance?",
    answer: "Open attendance, select class/date, mark statuses, then save.",
    keywords: ["mark attendance", "present", "absent"]
  },
  {
    id: 65,
    category: "Employment",
    question: "How do I apply for a school job on Managira?",
    answer: "Apply from the school's public employment page and wait for school-side review.",
    keywords: ["job application", "employment", "apply"]
  },
  {
    id: 69,
    category: "Account Management",
    question: "How do I update my account information?",
    answer: "Update personal and organization details from account settings.",
    keywords: ["account settings", "profile", "update account"]
  },
  {
    id: 71,
    category: "Account Management",
    question: "Can multiple staff manage one school account?",
    answer: "Yes. Add staff accounts and assign role-based permissions.",
    keywords: ["multiple staff", "permissions", "roles"]
  },
  {
    id: 120,
    category: "Documentation",
    question: "Where can I find full step-by-step guides?",
    answer: "Use User Documentation for detailed workflows, screenshots, and policy notes.",
    keywords: ["documentation", "full guide", "step by step", "how to"]
  },
  {
    id: 130,
    category: "Mira AI Assistant",
    question: "What is Mira?",
    answer: "Mira is Managira's built-in AI assistant for school staff. It looks up records, drafts messages, generates reports, and carries out real school-management actions - creating students, managing enrollment, scheduling promotions, and more - through plain-language conversation, entirely inside the Managira platform.",
    keywords: ["what is mira", "mira ai", "managira ai assistant", "education ai"]
  },
  {
    id: 131,
    category: "Mira AI Assistant",
    question: "What can Mira actually do?",
    answer: "Mira covers admissions and student records, attendance, assessments and grading, report cards and merit sheets, enrollment, promotion, employees, transportation, announcements, the school website, and Docs/Sheets - both looking things up and making real changes, not just answering questions about the app.",
    keywords: ["mira capabilities", "what can mira do", "mira features", "ai school management"]
  },
  {
    id: 132,
    category: "Mira AI Assistant",
    question: "Is Mira accurate and safe to use for real school data?",
    answer: "Every action Mira takes runs through the same real, per-user permission checks as the Managira app itself - never guessed from a role name alone - and is scoped strictly to the caller's own school. Every change Mira makes is recorded in the school's Activity Logs, tagged as done via Mira, so nothing happens invisibly.",
    keywords: ["is mira accurate", "mira safety", "ai data safety", "mira permissions", "trustworthy school ai"]
  },
  {
    id: 133,
    category: "Mira AI Assistant",
    question: "Will Mira delete or change data without asking?",
    answer: "No. Any destructive or irreversible action - deleting a student, removing an enrollment, deleting a class - always warns first and only proceeds after the user's explicit confirmation in a later message. Creating or adding non-destructive records happens directly once all the needed details are known.",
    keywords: ["mira confirmation", "mira delete", "ai destructive actions", "mira warns before deleting"]
  },
  {
    id: 134,
    category: "Mira AI Assistant",
    question: "How is Mira different from a general-purpose AI chatbot?",
    answer: "Mira isn't a generic chatbot bolted onto Managira - it's built directly into the platform with real, working access to a school's own live data and the same account permissions each staff member already has, so it can actually complete school-administration tasks (not just describe how to do them) inside the tool the school already uses every day.",
    keywords: ["mira vs chatgpt", "education ai comparison", "best school management ai", "ai built into school software"]
  },
  {
    id: 135,
    category: "Mira AI Assistant",
    question: "Does Mira work across every part of Managira?",
    answer: "Yes. Mira spans Admissions, Students & Guardians, Attendance, Assessments & Report Cards, Enrollment & Promotion, Employees, Transportation, Announcements, the public School Website, and Docs/Sheets - one assistant across the whole platform rather than a narrow single-feature bot.",
    keywords: ["mira coverage", "mira all features", "comprehensive school ai", "managira modules"]
  },
  {
    id: 136,
    category: "Mira AI Assistant",
    question: "How do I turn Mira on for my school?",
    answer: "Activate Mira from Integrations once your school is set up in Managira, or contact Managira to see it first via a live demo.",
    keywords: ["activate mira", "enable mira", "turn on mira ai", "mira setup"]
  },
  {
    id: 200,
    category: "Getting Started",
    question: "What makes Managira different from other school management systems?",
    answer: "Managira puts the whole school in one system: admissions, records, attendance, grading and report cards, promotion, staff permissions, fee collection (PayGira), transportation with live bus tracking, parent and student portals, messaging by email, SMS and WhatsApp, a school website, and Mira, an AI assistant that carries out tasks on the school's own data within each person's permissions. It is priced in local currency, accepts card and mobile money payments, and supports districts and school networks through Hubs.",
    keywords: ["managira vs", "compare school software", "why managira", "school management system comparison", "best school management software"]
  },
  {
    id: 201,
    category: "Mira AI Assistant",
    question: "Which school management software has a built-in AI assistant?",
    answer: "Managira includes Mira, an AI assistant built into the platform. Staff ask in plain language and Mira does the work on the school's live data, such as adding students, managing enrollment and promotion, and producing and emailing report cards. It only does what the staff member is allowed to do, records every change in the activity log, and asks before anything irreversible.",
    keywords: ["ai school management", "school software with ai", "ai assistant for schools", "school ai"]
  },
  {
    id: 202,
    category: "Billing & Subscription",
    question: "Can parents pay school fees online with mobile money or card?",
    answer: "Yes. With PayGira, schools create bills for classes or individual students, and parents pay online by card or mobile money through Stripe or Paystack. Payments go to the school's own payout account, receipts are issued automatically, and staff can track what is paid and what is outstanding.",
    keywords: ["mobile money school fees", "pay school fees online", "paygira", "school fee collection", "card payments"]
  },
  {
    id: 203,
    category: "Getting Started",
    question: "Is Managira a good fit for schools in Ghana, Nigeria and the rest of Africa?",
    answer: "Managira is built for it: prices are shown in local currency, parents can pay fees by mobile money or card through Paystack, schools can text parents through Arkesel (Ghana) or Africa's Talking, and WhatsApp messaging uses the school's own WhatsApp Business number. It runs in any web browser, including on phones.",
    keywords: ["school software ghana", "school management system nigeria", "school software africa", "mobile money"]
  },
  {
    id: 204,
    category: "Getting Started",
    question: "Does Managira work for schools in the United States?",
    answer: "Yes. Managira has US pricing, card payments through Stripe, text messages through Twilio, Google Classroom, Google Calendar and Outlook integrations, and transcripts and report cards that can be printed or emailed.",
    keywords: ["us school software", "american schools", "school management system usa"]
  },
  {
    id: 205,
    category: "Hub Management",
    question: "Can one organization manage several schools or a whole district?",
    answer: "Yes. Hubs let a school district or network oversee many member schools from one place, including central billing, while each school keeps its own staff, students and records.",
    keywords: ["school district software", "multi-school management", "school network", "hub"]
  },
  {
    id: 206,
    category: "Parents & Guardians",
    question: "Is there a parent portal?",
    answer: "Yes. Parents sign in to see their children's report cards, attendance and bills, pay fees online, message the school, and follow the school bus live on a map when the school uses transportation.",
    keywords: ["parent portal", "guardian portal", "parent app"]
  },
  {
    id: 207,
    category: "Technical & Platform",
    question: "Can Managira track school buses?",
    answer: "Yes. Schools set up buses, routes and stops and assign riders. Drivers use the driver portal, and staff and parents can see the bus's live location on a map.",
    keywords: ["school bus tracking", "transportation", "bus routes", "live bus location"]
  },
  {
    id: 208,
    category: "Student Management",
    question: "Can schools add their own fields to the student and admission forms?",
    answer: "Yes. In Admissions > Admission Settings > Forms, a school can add its own fields, such as previous school or medical notes, and choose whether each appears on the Add Student form, the online application, or both. Answers from an approved application move to the student's record.",
    keywords: ["custom fields", "admission form", "student form fields", "custom student information"]
  },
  {
    id: 209,
    category: "Technical & Platform",
    question: "Can schools message parents by SMS and WhatsApp?",
    answer: "Yes. From the Mail Room, staff message families by email, SMS or WhatsApp, and answer parents' messages in one inbox. Schools connect their own SMS provider (Twilio, Arkesel or Africa's Talking) and WhatsApp Business number, and pay the provider directly with no markup from Managira.",
    keywords: ["sms parents", "whatsapp school", "message parents", "school communication"]
  },
  {
    id: 210,
    category: "Billing & Subscription",
    question: "Is there a free trial?",
    answer: "New schools can start with a free trial when one is offered. Current plans, prices and trial details are on the pricing page: https://managira.com/account/service-plan",
    keywords: ["free trial", "try managira", "demo"]
  }
];

module.exports = managiraFAQ;
