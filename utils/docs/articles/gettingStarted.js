"use strict";

// Getting started: setting up a school, finding your way around, installing the app, fixing common problems.
module.exports = [
  {
    slug: "register-a-school-and-complete-first-time-setup",
    title: "Set up your school in Managira",
    topic: "Getting started",
    order: 1,
    summary: "Create your school's account, then follow the Setup steps checklist: school details, school year and term, classes, subjects, students, staff and families.",
    tags: ["getting started", "sign up", "register a school", "setup steps", "first steps", "onboarding"],
    featured: true,
    who: "The person who registers the school. They become its first manager.",
    intro: "Getting a school ready in Managira takes an afternoon. You create the school's account once, then the <strong>Setup steps</strong> checklist at the bottom of every page shows what is left to do, in the right order, and links straight to each step.",
    sections: [
      {
        title: "Create your school's account",
        steps: [
          "Go to <a href=\"https://managira.com\" target=\"_blank\">managira.com</a> and select <strong>Get started</strong>.",
          "Choose a plan and how often to pay. The plan decides which features your school has; you can change it later in <strong>Settings</strong>, <strong>Billing &amp; Plan</strong>.",
          "Fill in <strong>Register Your Organization</strong>: your name, the school's name and a short <strong>nickname</strong> (it becomes your web address, for example <code>riverside.managira.com</code>), address, state, phone and your email and password.",
          "Upload a <strong>Proof of Existence</strong>, an official document showing the school is registered (for example a state registration or accreditation letter), and complete payment.",
          "Check your email. You'll receive a welcome message with a link to sign in.",
        ],
        tip: "Choose the nickname carefully. It is your school's public web address and appears on every page you share with families.",
      },
      {
        title: "Work through Setup steps",
        text: "Sign in and open <strong>Setup steps</strong> at the bottom left of the screen. Each step opens the page where it is done, and ticks itself off when it is finished.",
        image: "setup-steps.webp",
        caption: "Setup steps lists what your school still has to set up. Each step opens the page where it's done.",
        table: [
          ["Step", "Where it's done", "Guide"],
          ["Add your school's logo and contact details", "Settings, Customize School", "<a href=\"/legal/user-documentation/customize-your-school\">Customize your school</a>"],
          ["Create the school year and its current term", "Management, School Years", "<a href=\"/legal/user-documentation/create-school-years-terms-and-set-the-current-term\">School years and terms</a>"],
          ["Add your classes, and subjects to your classes", "Management, Classes, Subjects &amp; Grad Years", "<a href=\"/legal/user-documentation/setting-up-classes-subjects-graduation-year-group\">Classes and subjects</a>"],
          ["Put your classes into the current term", "Management, Enrollment", "<a href=\"/legal/user-documentation/enrolling-classes-and-student-in-aterm-semester\">Enrollment</a>"],
          ["Add your students", "Admissions, Add New Student", "<a href=\"/legal/user-documentation/create-and-add-student\">Add a student</a>"],
          ["Set up this term's assessments and the grading scale", "Management, Assessments; Reports, Report Settings", "<a href=\"/legal/user-documentation/create-a-test-or-assessment\">Assessments</a>"],
          ["Invite your teachers and staff", "Management, Users / Employees", "<a href=\"/legal/user-documentation/create-and-manage-employee-accounts-and-permissions\">Add staff</a>"],
          ["Set the school calendar", "Calendar", "<a href=\"/legal/user-documentation/staff-calendar-and-tasks\">Calendar</a>"],
          ["Add a signature for report cards, set promotion rules", "Reports, Report Settings; Management, Promotion", "<a href=\"/legal/user-documentation/report-settings\">Report settings</a>"],
          ["Invite parents and guardians", "Management, Guardians", "<a href=\"/legal/user-documentation/create-manage-parent\">Parents and guardians</a>"],
          ["Set up school fees", "PayGira", "<a href=\"/legal/user-documentation/set-up-paygira-bills-collections-and-guardian-payments\">PayGira</a>"],
          ["Set up the school website and open online admissions", "Management, School Website; Admissions, Admission Settings", "<a href=\"/legal/user-documentation/school-website\">School website</a>"],
        ],
      },
      {
        title: "Recommended order",
        list: [
          "<strong>Structure first:</strong> school year and term, then classes and subjects, then enrollment. Students, attendance and grades all hang on these.",
          "<strong>People next:</strong> students, then staff (so teachers can be given their classes), then parents.",
          "<strong>Then everything else:</strong> assessments, report settings, fees, website and online admission.",
        ],
        example: "Riverside Academy creates the 2026–2027 school year with Fall and Spring semesters, sets Fall as current, adds Kindergarten to 8th Grade with their subjects, imports 420 students, invites 32 staff, and opens online admission for next year, all in one afternoon.",
      },
    ],
    faq: [
      ["Can we import our students from a spreadsheet?", "Yes. In Admissions, Add New Student, choose the import option, download the CSV or Excel template, fill it in and upload it. See <a href=\"/legal/user-documentation/create-and-add-student\">Add a student</a>."],
      ["Can I change the school's name or nickname later?", "Yes. The name, logo, colors and contact details are in Settings, Customize School. Changing the nickname changes your web address, so tell families when you do."],
      ["Can someone else finish the setup?", "Yes. Invite a colleague as a Manager in Users / Employees and they can work through Setup steps with you."],
    ],
    related: ["navigate-managira", "customize-your-school", "create-school-years-terms-and-set-the-current-term", "create-and-add-student"],
  },
  {
    slug: "navigate-managira",
    title: "Find your way around Managira",
    topic: "Getting started",
    order: 2,
    summary: "The dashboard, the menu, and the Management, Admissions, Reports and PayGira workspaces: where everything lives and how to get there fast.",
    tags: ["dashboard", "menu", "workspaces", "navigation", "search", "notifications", "quick actions"],
    who: "Everyone at your school. Each person sees only the menus their permissions allow.",
    intro: "Managira opens on your dashboard. From there, the menu (top right) takes you to everything else, grouped into a few workspaces. What you see depends on your role and permissions, so a teacher's menu is shorter than a principal's.",
    sections: [
      {
        title: "Your dashboard",
        image: "dashboard.webp",
        caption: "The staff dashboard: today at a glance, quick actions, events, and Activity & Announcements.",
        list: [
          "<strong>Quick actions</strong> list the pages you can open, ordered by how often you use them.",
          "<strong>Events</strong> shows what's coming up. People who manage events see a <strong>Manage</strong> link that opens Events, announcements &amp; activities in Management.",
          "<strong>Activity &amp; Announcements</strong> has three tabs: <strong>For you</strong> (tasks and things you're tagged in), <strong>Activities</strong> and <strong>Announcements</strong>. <strong>New task</strong> creates a task, or an activity, without leaving the dashboard.",
        ],
      },
      {
        title: "The menu and workspaces",
        text: "Select the menu button (☰) at the top right. The big areas open as workspaces: a list on the left and the page on the right, so you can move between pages without losing your place.",
        table: [
          ["Workspace", "What's in it"],
          ["<strong>Management</strong>", "School years, classes and subjects, assessments, enrollment, promotion, staff, guardians, transportation, events and activities, the school website, PayGira, integrations and service accounts."],
          ["<strong>Admissions</strong>", "All students, adding students, online applications, graduates and alumni, and Admission Settings."],
          ["<strong>Reports</strong>", "Organization statistics, term report cards, transcripts, report settings and Report Builder."],
          ["<strong>PayGira</strong>", "Bills, payments, arrears, payouts and PayGira settings."],
          ["<strong>Settings</strong>", "Your school's details, your profile and appearance, billing and plan, security, sign-in rules, single sign-on, access tokens and notifications."],
        ],
        tip: "Select the arrows icon at the top of a workspace's list to arrange its items in the order you use them. Your order is remembered on every device.",
      },
      {
        title: "Search, notifications and Mira",
        list: [
          "<strong>Search anything</strong> at the top finds students, staff, classes and pages.",
          "The <strong>bell</strong> shows your notifications: tasks, mentions, messages and alerts.",
          "The <strong>Mira</strong> button opens the AI assistant, which can do much of this work for you. See <a href=\"/legal/user-documentation/mira-ai-assistant\">Mira</a>.",
        ],
      },
      {
        title: "On a phone",
        text: "Managira works in any browser on phones and tablets. Workspaces open their list as a <strong>Menu</strong> button above the page, and long tables scroll sideways inside their box. You can also <a href=\"/legal/user-documentation/install-managira-on-your-device\">install Managira like an app</a>.",
      },
    ],
    faq: [
      ["Why don't I see a menu a colleague has?", "Menus follow each person's permissions. A manager can give you more in Management, Users / Employees."],
      ["How do I get back to the dashboard?", "Select your school's logo or name at the top left."],
    ],
    related: ["register-a-school-and-complete-first-time-setup", "profile-and-appearance", "roles-and-permissions"],
  },
  {
    slug: "install-managira-on-your-device",
    title: "Install Managira on your phone or computer",
    topic: "Getting started",
    order: 3,
    summary: "Add Managira to your iPhone, Android phone, iPad, Mac or PC so it opens like an app, with no app store needed.",
    tags: ["install", "app", "iphone", "android", "home screen", "desktop", "pwa"],
    who: "Everyone: staff, parents, students and drivers.",
    intro: "Managira runs in your browser, and you can also install it so it opens from your home screen or dock like any other app. Nothing is downloaded from an app store, and it always has the latest version.",
    sections: [
      {
        title: "iPhone or iPad",
        steps: [
          "Open <strong>Safari</strong> and go to your school's Managira address (or managira.com). Sign in first, so the app opens signed in.",
          "Tap the <strong>Share</strong> button (the square with an arrow pointing up).",
          "Scroll down and tap <strong>Add to Home Screen</strong>, check the name, then tap <strong>Add</strong>.",
        ],
      },
      {
        title: "Android phone or tablet",
        steps: [
          "Open <strong>Chrome</strong> and go to your school's Managira address. Sign in.",
          "Tap the <strong>⋮</strong> menu, then <strong>Install app</strong> (or <strong>Add to Home screen</strong>).",
          "Tap <strong>Install</strong>. Managira appears with your other apps.",
        ],
      },
      {
        title: "Mac or PC",
        steps: [
          "Open Managira in <strong>Chrome</strong> or <strong>Edge</strong> and sign in.",
          "Select the <strong>Install</strong> icon at the right of the address bar (a screen with a down arrow), or open the browser menu and choose <strong>Install Managira</strong>.",
          "Managira opens in its own window. Pin it to your dock or taskbar.",
        ],
        note: "On a Mac with Safari, choose <strong>File</strong>, then <strong>Add to Dock</strong>.",
      },
    ],
    faq: [
      ["Do I need to install it?", "No. Everything works in the browser. Installing just makes it quicker to open."],
      ["Will I get notifications?", "Notifications appear in the bell inside Managira, and important ones also arrive by email."],
      ["How do I remove it?", "Remove it like any other app: press and hold the icon on a phone, or right-click it on a computer."],
    ],
    related: ["sign-in-to-managira", "navigate-managira"],
  },
  {
    slug: "troubleshooting-common-issues",
    title: "Troubleshooting common issues",
    topic: "Getting started",
    order: 4,
    summary: "Quick fixes for the most common problems: signing in, missing menus, classes or students not showing, report cards, messages and payments.",
    tags: ["troubleshooting", "help", "not working", "login problems", "missing menu", "support"],
    intro: "Most problems have a quick fix you can make yourself. Find the symptom below; if it still doesn't work, ask Mira in the chat or contact support.",
    sections: [
      {
        title: "Signing in",
        list: [
          "<strong>Wrong password:</strong> select <strong>Forgot password?</strong> on the sign-in page. See <a href=\"/legal/user-documentation/reset-a-password-or-recover-account-access\">Reset your password</a>.",
          "<strong>Waiting after several tries:</strong> Managira never locks anyone out, but after a few wrong passwords it asks you to wait a little before the next try. The right password always works.",
          "<strong>No verification code:</strong> check spam and junk folders for an email from reminders@managira.com, and wait a minute before asking for another.",
          "<strong>Signed out unexpectedly:</strong> your school may sign people out after a set time. See <a href=\"/legal/user-documentation/tenant-configuration\">Tenant configuration</a>.",
        ],
      },
      {
        title: "A menu, page or button is missing",
        list: [
          "Menus follow your permissions. Ask a manager to check yours in <strong>Management</strong>, <strong>Users / Employees</strong>.",
          "Some features depend on your school's plan. If a manager also can't see it, check <strong>Settings</strong>, <strong>Billing &amp; Plan</strong>.",
          "Transportation, the Student Portal and Mira are switched on in <strong>Management</strong>, <strong>Integrations</strong>.",
        ],
      },
      {
        title: "Classes, students or subjects don't show",
        list: [
          "Check the right <strong>school year and term</strong> is set as current in Management, School Years.",
          "Check the class is <strong>enrolled in the current term</strong> (Management, Enrollment) and the student is in that class.",
          "A teacher sees only the classes assigned to them. A manager can assign classes in Users / Employees.",
        ],
      },
      {
        title: "Report cards and grades",
        list: [
          "Check scores are entered for every assessment, and the grading scale is set in Reports, Report Settings.",
          "Choose the right term before generating. Report cards use the term's enrolled subjects.",
        ],
      },
      {
        title: "Messages and payments",
        list: [
          "<strong>Texts not arriving:</strong> check Twilio is connected and your number is registered for business texting. See <a href=\"/legal/user-documentation/sms-integrations\">Text messages with Twilio</a>.",
          "<strong>Emails not arriving:</strong> ask families to check spam, and look at Management, Email Issues for addresses that bounce.",
          "<strong>Payments:</strong> see <a href=\"/legal/user-documentation/set-up-paygira-bills-collections-and-guardian-payments\">PayGira</a> for receipts, failed payments and payouts.",
        ],
      },
      {
        title: "Still stuck?",
        text: "Open the chat at the bottom right of any page and ask Mira, or use the <a href=\"/legal/help\">Help Center</a> to contact support. Tell us what you were doing, what you expected, and what happened instead; a screenshot helps.",
      },
    ],
    related: ["sign-in-to-managira", "roles-and-permissions", "navigate-managira"],
  },
];
