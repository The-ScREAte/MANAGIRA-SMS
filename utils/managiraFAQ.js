// Managira FAQ Knowledge Base - Based on official FAQ page
const managiraFAQ = [
  // Getting Started
  {
    id: 1,
    category: "Getting Started",
    question: "What is Managira?",
    answer: "Managira is a school management platform designed to help schools, educators, and the general public, including parents and guardians, stay connected. It simplifies administrative tasks, tracks student performance, and enhances communication between teachers, administrators, and families.",
    keywords: ["what is managira", "school management", "platform", "educators", "parents", "guardians", "administrative", "student performance"]
  },
  {
    id: 2,
    category: "Getting Started",
    question: "Who can use Managira?",
    answer: "Managira is built for schools, administrators, teachers, students, and families. Schools can efficiently manage student records, teachers can monitor academic progress, and families can stay informed about their child's educational activities through the public website of the school.",
    keywords: ["who can use", "schools", "administrators", "teachers", "students", "families", "student records", "academic progress"]
  },
  {
    id: 3,
    category: "Getting Started",
    question: "How do I register my school on Managira?",
    answer: "Schools can register by visiting the sign-up page and filling out the required details. Once registered, administrators can add teachers, students, and other staff members to manage school operations effectively.",
    keywords: ["register", "registration", "school", "sign up", "administrators", "teachers", "staff"]
  },
  {
    id: 4,
    category: "Getting Started",
    question: "Is there a free trial available?",
    answer: "Yes, we offer a free trial that lasts for a term for new schools to explore Managira's features before committing to a plan.",
    keywords: ["free trial", "trial", "term", "new schools", "features", "plan"]
  },
  {
    id: 5,
    category: "Getting Started",
    question: "How can I contact Managira support?",
    answer: "You can reach our support team via the 'Help' section or by emailing us.",
    keywords: ["contact", "support", "help", "email"]
  },
  {
    id: 6,
    category: "Getting Started",
    question: "What if I have a feature request?",
    answer: "We welcome feedback! We will occasionally send out survey forms for suggestions. You can also submit feature requests to managirainfo@gmail.com.",
    keywords: ["feature request", "feedback", "suggestions", "survey", "managirainfo@gmail.com"]
  },

  // Educators & Admins
  {
    id: 7,
    category: "Educators & Admins",
    question: "How does Managira help educators?",
    answer: "Educators can use Managira to record grades, track attendance, create reports, and communicate with families. It provides real-time insights into student progress, making it easier for teachers to support their students' learning.",
    keywords: ["educators", "grades", "attendance", "reports", "communicate", "families", "student progress", "teachers"]
  },
  {
    id: 8,
    category: "Educators & Admins",
    question: "Can teachers and administrators update student information?",
    answer: "Yes, authorized personnel such as teachers and school administrators can update student information, including grades, attendance, and personal details, through their designated accounts.",
    keywords: ["teachers", "administrators", "update", "student information", "grades", "attendance", "personal details"]
  },
  {
    id: 9,
    category: "Educators & Admins",
    question: "Can I track teacher performance or workload?",
    answer: "Yes, administrators can view class assignments, test creation activity, and other metrics to evaluate teacher involvement.",
    keywords: ["track", "teacher performance", "workload", "administrators", "class assignments", "test creation", "metrics"]
  },
  {
    id: 10,
    category: "Educators & Admins",
    question: "Can I generate report cards or merit sheets?",
    answer: "Yes, there is a built-in report generator that allows you to create terminal reports and merit sheets with minimal effort.",
    keywords: ["generate", "report cards", "merit sheets", "report generator", "terminal reports"]
  },
  {
    id: 11,
    category: "Educators & Admins",
    question: "Can I customize the portal with my school's logo and colors?",
    answer: "Yes, Managira supports branding options. You can upload your logo and set your preferred colors and fonts under Personalization settings.",
    keywords: ["customize", "portal", "school logo", "colors", "branding", "personalization", "fonts"]
  },
  {
    id: 12,
    category: "Educators & Admins",
    question: "Can schools customize Managira to fit their needs?",
    answer: "Yes, Managira is designed to be flexible. Schools can customize features, add school branding, and tailor settings to fit their specific needs.",
    keywords: ["customize", "flexible", "features", "school branding", "settings", "specific needs"]
  },
  {
    id: 13,
    category: "Educators & Admins",
    question: "Is training provided for new users?",
    answer: "Yes, onboarding sessions and documentation are provided to help administrators and teachers get started quickly.",
    keywords: ["training", "new users", "onboarding", "documentation", "administrators", "teachers"]
  },
  {
    id: 14,
    category: "Educators & Admins",
    question: "How are announcements delivered?",
    answer: "Announcements can be shared via dashboards ensuring everyone is kept in the loop.",
    keywords: ["announcements", "dashboards", "communication"]
  },
  {
    id: 15,
    category: "Educators & Admins",
    question: "Is there an analytics dashboard?",
    answer: "Absolutely. Managira includes a dashboard that shows student performance trends, attendance stats, and other key insights for data-driven decision making.",
    keywords: ["analytics", "dashboard", "student performance", "attendance stats", "insights", "data-driven"]
  },

  // Billing & Subscription
  {
    id: 16,
    category: "Billing & Subscription",
    question: "Can I upgrade or downgrade my plan?",
    answer: "Yes, you can switch your plan at any time based on your school's evolving needs. Visit the settings or billing section to manage your subscription.",
    keywords: ["upgrade", "downgrade", "plan", "switch", "settings", "billing", "subscription"]
  },
  {
    id: 17,
    category: "Billing & Subscription",
    question: "What happens if I miss a payment?",
    answer: "If a payment is missed, your access will be limited after a grace period. Notifications will be sent in advance with steps to restore full access.",
    keywords: ["miss payment", "payment", "access limited", "grace period", "notifications", "restore access"]
  },

  // Parents & Guardians
  {
    id: 18,
    category: "Parents & Guardians",
    question: "How do parents or guardians register their children?",
    answer: "Schools can enable a public application form that allows families to apply or register students. This is reviewed and approved by school admins.",
    keywords: ["parents", "guardians", "register children", "public application", "families", "school admins"]
  },
  {
    id: 19,
    category: "Parents & Guardians",
    question: "How can the general public, including parents and guardians, stay updated?",
    answer: "Managira provides real-time notifications, announcements, ensuring that families stay informed about school events through the public website.",
    keywords: ["general public", "parents", "guardians", "stay updated", "notifications", "announcements", "public website"]
  },

  // Security & Access
  {
    id: 20,
    category: "Security & Access",
    question: "What security measures are in place to protect student data?",
    answer: "Managira uses encryption, secure servers, and role-based access control to ensure that student and school data remain confidential. Compliance with global data protection standards ensures a safe and secure experience.",
    keywords: ["security measures", "student data", "encryption", "secure servers", "role-based access", "data protection"]
  },
  {
    id: 21,
    category: "Security & Access",
    question: "How is student data protected?",
    answer: "All student data is encrypted in transit and at rest. Managira adheres to international standards like GDPR to ensure privacy.",
    keywords: ["student data", "encrypted", "transit", "rest", "GDPR", "privacy", "international standards"]
  },
  {
    id: 22,
    category: "Security & Access",
    question: "Can I control who sees what information?",
    answer: "Yes, administrators can manage roles and permissions to control what data each user can access or edit.",
    keywords: ["control", "information", "administrators", "roles", "permissions", "access", "edit"]
  },
  {
    id: 23,
    category: "Security & Access",
    question: "How long is student data retained on Managira?",
    answer: "Student records are retained as long as the school's account remains active. If a school discontinues its use of Managira, data can be archived or deleted based on school policies and legal requirements.",
    keywords: ["student data", "retained", "school account", "active", "archived", "deleted", "policies", "legal requirements"]
  },
  {
    id: 24,
    category: "Security & Access",
    question: "What should I do if I forget my password?",
    answer: "If you forget your password, click on the 'Forgot Password' link on the login page. Follow the instructions to receive a reset link via email.",
    keywords: ["forget password", "forgot password", "login page", "reset link", "email"]
  },

  // Technical Support
  {
    id: 25,
    category: "Technical Support",
    question: "What should I do if I encounter a technical issue?",
    answer: "You can contact our support team via the 'Help' section, or email support@managira.com. A support agent will assist you promptly.",
    keywords: ["technical issue", "support team", "help", "support@managira.com", "support agent"]
  },
  {
    id: 26,
    category: "Technical Support",
    question: "Does Managira support multiple devices?",
    answer: "Yes, Managira is accessible on desktops, tablets, and mobile devices, allowing users to stay connected from anywhere.",
    keywords: ["multiple devices", "desktops", "tablets", "mobile devices", "accessible", "connected"]
  }
];

module.exports = managiraFAQ;