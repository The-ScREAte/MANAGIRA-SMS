"use strict";

// Getting started: finding your way around, who sees what, the header, search, Home, the page finder,
// installing the app and fixing common problems. (The first-time setup guide is in schoolSetup.js.)

const link = (slug, title) => `<a href="/legal/user-documentation/${slug}">${title}</a>`;

module.exports = [
  {
    slug: "navigate-managira",
    title: "Find your way around Managira",
    topic: "Getting started",
    order: 2,
    summary: "The header, the menu, the workspaces and the shortcuts: where everything lives and how to get there fast.",
    tags: ["dashboard", "menu", "workspaces", "navigation", "header", "search", "page finder", "rows per page", "phone"],
    featured: true,
    who: "Everyone at your school. Each person sees only the menus their role and permissions allow.",
    intro: "Managira opens on your home screen. The header across the top and the ☰ menu take you everywhere else. This guide is the map; each part has a guide of its own.",
    sections: [
      {
        title: "The parts of the screen",
        image: "account-home.webp",
        caption: "A manager's Home screen, with the header across the top.",
        table: [
          ["Part", "What it does", "Guide"],
          ["<strong>Header</strong>", "Search, Mira, help, notifications and the menu, on every page.", link("the-app-header", "The app header")],
          ["<strong>Search anything</strong>", "Finds students, parents, staff, classes and subjects. <strong>Search deeper</strong> reads more of your records.", link("search-anything-and-search-deeper", "Search anything and Search deeper")],
          ["<strong>Home</strong>", "Your classes, the school year, today's numbers, events, tasks and recent activity.", link("staff-home-dashboard", "Home: the staff dashboard")],
          ["<strong>☰ menu</strong>", "Opens the workspaces (Management Tools, Admissions, Reports), Mailroom, Calendar, Birthdays, Settings and Log out.", link("the-app-header", "The app header")],
          ["<strong>Ctrl+K</strong>", "A list of every page you can open. Type a few letters and press <strong>Enter</strong>.", link("find-a-page-with-ctrl-k", "Find a page with Ctrl+K")],
          ["<strong>Setup steps</strong>", "A small tab on the left edge that lists what is left to set up.", link("staff-home-dashboard", "Home: the staff dashboard")],
        ],
      },
      {
        title: "The workspaces",
        text: "Management Tools, Admissions and Reports open as workspaces: a list of pages on the left and the page on the right, so you can move between pages without losing your place. PayGira and the classroom work the same way.",
        table: [
          ["Workspace", "What's in it"],
          ["<strong>Management Tools</strong>", "School years and terms, classes and subjects, assessments, enrollment, staff, parents, transportation, events and activities, the school website, PayGira, integrations and service accounts."],
          ["<strong>Admissions</strong>", "All students, adding students, online applications, former students, and Admission settings."],
          ["<strong>Reports</strong>", "Statistics, report cards, transcripts, Report settings and Report Builder."],
          ["<strong>Settings</strong>", "Your profile and appearance, your school's details, billing and plan, security, sign-in rules, access tokens and notifications."],
        ],
        tip: "Select the arrows icon at the top of a workspace's list to put its items in the order you use them. Your order is remembered on every device.",
      },
      {
        title: "Every page opens inside its menu",
        text: "Pages that belong to a workspace or a class always open with their menu beside them, even from a bookmark, an email link or a student's page. You never land on a page with no way back.",
      },
      {
        title: "Long lists",
        text: "Long lists show a page at a time. Under the list, use <strong>Rows per page</strong> (10, 20, 50, 100 or 200), and <strong>Prev</strong> and <strong>Next</strong>. The range, such as <strong>21–40 of 1,801</strong>, shows where you are. Your choice is remembered on that device.",
      },
      {
        title: "On a phone",
        text: "Managira works in any browser on phones and tablets. A workspace opens its list as a <strong>Menu</strong> button above the page, and wide tables scroll sideways inside their box. You can also " + link("install-managira-on-your-device", "install Managira like an app") + ".",
      },
    ],
    faq: [
      ["Why don't I see a menu a colleague has?", "Menus follow each person's role and permissions. A manager can give you more in <strong>Management Tools › Users / Employees</strong>. See " + link("your-access", "Your access") + " to check what you have."],
      ["How do I get back to Home?", "Select your school's name at the top left."],
      ["How do I jump straight to a page?", "Press <strong>Ctrl+K</strong> (<strong>Cmd+K</strong> on a Mac) and type its name."],
    ],
    related: ["what-each-person-can-do-in-managira", "the-app-header", "staff-home-dashboard", "find-a-page-with-ctrl-k"],
  },
  {
    slug: "what-each-person-can-do-in-managira",
    title: "What each person can do in Managira",
    topic: "Getting started",
    order: 2.5,
    summary: "What managers, supervisors, teachers, drivers, parents, students and districts see when they sign in, and where to learn more.",
    tags: ["roles", "who sees what", "manager", "supervisor", "teacher", "driver", "parent", "student", "district", "hub", "school account", "owner"],
    featured: true,
    who: "Anyone who wants to know what a role sees. Managers choose roles and permissions for staff.",
    intro: "Everyone signs in on the same page, then lands on a home screen made for their role. Staff roles add permissions on top, so two teachers can see different menus.",
    sections: [
      {
        title: "Managers and the school's own account",
        image: "account-role-owner.webp",
        caption: "Home for the school's own account. A manager's looks the same.",
        text: "The school's own account (the one that registered the school) and every Manager can open everything the school's plan includes, and give permissions to others.",
        list: [
          "<strong>Sees:</strong> every class on <strong>Home</strong>, and the menu: <strong>Management Tools</strong>, <strong>School website</strong>, <strong>Mailroom</strong>, <strong>Calendar</strong>, <strong>Birthdays</strong>, <strong>Admissions</strong>, <strong>Reports</strong> and <strong>Settings</strong>.",
          "<strong>Can:</strong> run the school's setup, staff, parents, students, billing, sign-in rules and single sign-on. Only managers change other managers.",
          "<strong>Learn more:</strong> " + link("staff-home-dashboard", "Home") + ", " + link("create-and-manage-employee-accounts-and-permissions", "Staff accounts and permissions") + ", " + link("tenant-configuration", "Tenant configuration") + ".",
        ],
      },
      {
        title: "Supervisors",
        image: "account-role-supervisor.webp",
        caption: "Home for a supervisor.",
        list: [
          "<strong>Sees:</strong> every class on Home, like a manager, and the menus their permissions allow.",
          "<strong>Can:</strong> work across the school but not change managers, and only give permissions they hold themselves.",
          "<strong>Learn more:</strong> " + link("roles-and-permissions", "Roles and permissions") + ".",
        ],
      },
      {
        title: "Teachers",
        images: [["account-role-teacher.webp", "Home for a teacher: only their own classes."], ],
        list: [
          "<strong>Sees:</strong> only the classes they are assigned to, on Home and in search. Birthdays shows only their classes' students.",
          "<strong>Can:</strong> take attendance for classes they lead, grade, and work in their classroom pages. A <strong>main teacher</strong> leads a class; <strong>assistants</strong> work with them.",
          "<strong>Learn more:</strong> " + link("class-page", "The class page") + ", " + link("mark-attendance-for-a-class", "Take attendance") + ", " + link("your-access", "Your access") + ".",
        ],
      },
      {
        title: "Drivers",
        images: [["account-role-driver.webp", "A driver's home on a phone: today's trip, route and stops."], ],
        list: [
          "<strong>Sees:</strong> today's trip, the route and its stops. Drivers get only driving pages. A lead driver also gets Users / Employees, to look after the other drivers.",
          "<strong>Can:</strong> start and end a trip, mark riders who are not coming, and send a report to the school.",
          "<strong>Learn more:</strong> " + link("driver-app", "The driver app") + ".",
        ],
      },
      {
        title: "Parents and guardians",
        images: [],
        list: [
          "<strong>Sees:</strong> their children, as <strong>My Children</strong> cards. The menu has <strong>Dashboard</strong>, <strong>School website</strong>, <strong>Activities</strong>, <strong>Calendar</strong>, <strong>Messages</strong>, <strong>PayGira</strong> (when the school uses it), <strong>Settings</strong> and <strong>Logout</strong>.",
          "<strong>Can:</strong> open grades, attendance, report cards, messages and bills for their own children, and follow the bus.",
          "<strong>Learn more:</strong> " + link("parent-portal", "The parent portal") + ".",
        ],
      },
      {
        title: "Students",
        images: [],
        list: [
          "<strong>Sees:</strong> their own class, attendance, GPA (hidden until they tap the eye) and tiles for Schedule, Calendar, Activities, Grades, Teachers and Bus. The menu adds <strong>Testing Room</strong> when the school uses online tests.",
          "<strong>Can:</strong> take online tests, see results the school shares, and fill in forms.",
          "<strong>Learn more:</strong> " + link("student-portal", "The student portal") + ".",
        ],
      },
      {
        title: "Districts and hubs",
        list: [
          "<strong>Sees:</strong> a left menu with <strong>Overview</strong>, <strong>Schools</strong>, <strong>Invitations</strong>, <strong>Leave requests</strong>, <strong>Billing</strong> and <strong>Reports</strong>, and what needs attention.",
          "<strong>Can:</strong> invite schools, open a school it manages, see billing and reports across all its schools.",
          "<strong>Learn more:</strong> " + link("school-districts-education-hubs", "Districts and education hubs") + ".",
        ],
      },
    ],
    faq: [
      ["Can one person be a teacher and a manager?", "A person has one role at a school. Managers can give a teacher extra permissions, such as Manage Students, without making them a manager."],
      ["A teacher can't see a class. Why?", "Teachers see only classes they are assigned to. A manager assigns classes on the person's staff form, in <strong>Management Tools › Users / Employees</strong>."],
      ["Can a parent have children at two schools?", "Yes. A parent with the same email at several Managira schools signs in once and sees each school's children after accepting the invitation on My Children. See " + link("parent-portal", "The parent portal") + "."],
    ],
    related: ["navigate-managira", "roles-and-permissions", "your-access", "sign-in-to-managira"],
  },
  {
    slug: "the-app-header",
    title: "The app header: search, Mira, help, notifications and menu",
    topic: "Getting started",
    order: 2.6,
    summary: "What each button in the bar across the top does: Search anything, Mira, the help menu, the bell, the ☰ menu and Log out.",
    tags: ["header", "bell", "notifications", "help menu", "hamburger", "menu", "log out", "logout", "mira button", "your access", "send feedback"],
    who: "Everyone signed in. Parents, students and drivers see a shorter header.",
    intro: "The header stays at the top of every page. From left to right: your school's name, <strong>Search anything</strong>, a greeting, <strong>Mira</strong>, the <strong>?</strong> help menu, the bell and the ☰ menu.",
    sections: [
      {
        title: "What is where",
        image: "account-home.webp",
        caption: "The header on a manager's Home screen.",
        steps: [
          ["<strong>Search anything</strong> finds people and classes. See " + link("search-anything-and-search-deeper", "Search anything and Search deeper") + "."],
          ["The <strong>Mira</strong> button opens your AI assistant beside the page."],
          ["The <strong>?</strong> button opens the help menu."],
          ["The <strong>bell</strong> shows your notifications. The red number is how many you haven't read."],
          ["The <strong>☰</strong> button opens the menu of pages."],
        ],
      },
      {
        title: "Notifications (the bell)",
        image: "account-bell-zoom.webp",
        caption: "The notifications panel.",
        steps: [
          "Select the <strong>bell</strong>. The panel lists your newest notifications, such as birthdays, tasks and alerts.",
          "Select a notification to open what it is about.",
          "Select the <strong>✓</strong> at the top to mark everything read, or the <strong>×</strong> beside one to remove it. The <strong>trash</strong> icon clears them all.",
        ],
        note: "Which alerts you get, and how, is your choice in <strong>Settings › Notifications</strong>. See " + link("notifications-and-alerts", "Your notifications and alerts") + ".",
      },
      {
        title: "The ? help menu",
        list: [
          "<strong>Guides</strong> opens these step-by-step guides in a new tab.",
          "<strong>Send feedback</strong> opens <strong>Settings › Feedback</strong> to tell Managira what to fix or what you need (staff only).",
          "<strong>Your access</strong> shows your role, classes and what you can do. See " + link("your-access", "Your access") + ". The school's own account doesn't have it.",
          "<strong>Two-step sign-in</strong> opens your authenticator app settings, for managers and people with Settings access. See " + link("two-step-sign-in", "Two-step sign-in") + ".",
        ],
      },
      {
        title: "The ☰ menu",
        images: [["account-menu-teacher-zoom.webp", "A teacher's menu."]],
        text: "The menu lists only what you can open, so yours may be shorter. A manager sees:",
        list: [
          "<strong>Management Tools</strong>, <strong>Admissions</strong> and <strong>Reports</strong>: the workspaces. See " + link("navigate-managira", "Find your way around") + ".",
          "<strong>School website</strong>: your public website, in a new tab.",
          "<strong>Mailroom</strong>: messages to families (with the Mailroom permission). See " + link("mailroom-send-sms-whatsapp-and-email-to-guardians", "Mailroom") + ".",
          "<strong>Calendar</strong>: your calendar and tasks. See " + link("staff-calendar-and-tasks", "Calendar and tasks") + ".",
          "<strong>Birthdays</strong>: who has a birthday this week. See " + link("birthdays-page", "Birthdays") + ".",
          "<strong>Settings</strong>: your profile and your school's settings. See " + link("profile-and-appearance", "Your profile and appearance") + ".",
          "<strong>Logout</strong>.",
        ],
        note: "Your school may also show a <strong>Sandbox</strong> switch here while a data migration is open. Parents, students and drivers have their own, shorter menus. See " + link("what-each-person-can-do-in-managira", "What each person can do") + ".",
      },
      {
        title: "Mira",
        image: "account-mira-panel.webp",
        caption: "Mira opens beside the page. The page makes room for it.",
        steps: [
          "Select the <strong>Mira</strong> button.",
          "Ask your question. Use <strong>Open in a new tab</strong> in Mira's bar for the full page, or <strong>Close</strong> to put it away. Mira stays open as you move between pages.",
        ],
        note: "If your school hasn't turned Mira on, or you haven't been given it, the panel says so and tells you who to ask. See " + link("mira-ai-assistant", "Mira, the AI assistant") + ".",
      },
      {
        title: "Log out",
        steps: [
          "Open the <strong>☰</strong> menu and select <strong>Logout</strong>.",
          "Select <strong>Log out</strong> to sign out, or <strong>Cancel</strong> (or press Esc) to stay signed in. Anything not saved on the page is lost.",
        ],
        tip: "Always log out on a shared computer. Closing the tab doesn't sign you out if you checked Keep me logged in.",
      },
    ],
    faq: [
      ["Why is there no Search box on my phone header?", "On a narrow screen the search box folds into a search icon. Tap it to open the box."],
      ["Why did the bell number go up on its own?", "Notifications arrive while the page is open: tasks assigned to you, alerts you chose, and birthdays."],
      ["Why can't I see the Mira button's panel?", "Mira has to be on for your school, and you need your own Use Mira permission. Ask a manager."],
    ],
    related: ["navigate-managira", "search-anything-and-search-deeper", "find-a-page-with-ctrl-k", "notifications-and-alerts"],
  },
  {
    slug: "search-anything-and-search-deeper",
    title: "Search anything and Search deeper",
    topic: "Getting started",
    order: 2.7,
    summary: "Find a student, parent, staff member or class from the header, then use Search deeper to look through notes, forms, messages, bills and more.",
    tags: ["search", "find a student", "search deeper", "deep search", "include past records", "filters", "find a parent", "find staff"],
    who: "Staff. You only find what you can open: teachers and supervisors find their own classes' students and parents. Parents, students and drivers don't have Search deeper.",
    intro: "<strong>Search anything</strong> at the top of every page finds people and classes as you type. <strong>Search deeper</strong> looks through much more of your school's records.",
    sections: [
      {
        title: "Search anything",
        steps: [
          ["Select the <strong>Search anything</strong> box at the top and start typing a name, email, ID or class.", "account-search-results.webp", "Results appear under the box as you type."],
          "Select a result to open it. A student opens their page, a staff member or parent opens a card on the right side, and a class opens its classroom.",
        ],
        list: [
          "Results are grouped by kind, such as <strong>Students</strong> and <strong>Parents &amp; guardians</strong>, each with a count.",
          "Each list shows only what you can open. Teachers see their own classes' students, parents, classes and subjects.",
        ],
      },
      {
        title: "Include past records",
        steps: [
          "Check <strong>Include past records</strong> at the top of the results to add graduated and withdrawn students.",
          "Leave it unchecked to keep them out. The box is remembered while the tab stays open.",
        ],
        note: "When nothing matches and past records are off, the message reminds you to check it.",
      },
      {
        title: "Search deeper",
        image: "account-deep-search.webp",
        caption: "Search deeper opens a window under the header.",
        steps: [
          "Type what you want, then select <strong>Search deeper</strong> at the top of the results.",
          "Check the <strong>Filters</strong> row. Every category is on until you narrow it.",
          "Select <strong>Search</strong>, or press Enter. Select a result to open it.",
        ],
      },
      {
        title: "The filters",
        table: [
          ["Category", "What it searches"],
          ["<strong>People</strong>", "Students, parents, staff and applicants: names, email, phone, address, ID, a staff member's role and About me."],
          ["<strong>Profiles &amp; files</strong>", "Student profile details, student files and Custom editor forms and answers."],
          ["<strong>Notes &amp; communication</strong>", "Student alerts, portfolio notes, parent messages and replies, and announcements."],
          ["<strong>Academics</strong>", "Classes and subjects, assessments and report card remarks."],
          ["<strong>Transport</strong>", "Buses, drivers, routes and stops (when transportation is on)."],
          ["<strong>Finance</strong>", "Bills (PayGira)."],
          ["<strong>Calendar &amp; tasks</strong>", "Activities, events and your own tasks."],
          ["<strong>Other details</strong>", "Application answers, fields kept from an old system, a student's other contacts, PayGira fee and payment notes, and driver reports."],
        ],
        list: [
          "<strong>Include past records</strong> sits at the left of the row. <strong>Reset</strong> at the right turns every category back on.",
          "A category appears only when you can search it. Results come best first, under <strong>Exact match</strong>, then <strong>Related</strong>, each with its own count.",
          "Search deeper covers your school's records only. The guides and app pages aren't in it: use " + link("find-a-page-with-ctrl-k", "Ctrl+K") + " for pages.",
        ],
      },
    ],
    faq: [
      ["Why can't I find a student?", "They may be in a class you aren't assigned to, or a past student. Check <strong>Include past records</strong>, or ask a manager."],
      ["Can parents search?", "No. Parents don't have search. Students can search their own teachers."],
      ["Why is a category missing from the filters?", "You only see categories you have the permission to open."],
    ],
    related: ["the-app-header", "find-a-page-with-ctrl-k", "find-students"],
  },
  {
    slug: "staff-home-dashboard",
    title: "Home: the staff dashboard",
    topic: "Getting started",
    order: 2.8,
    summary: "Your classes, the school year, today's numbers, events, tasks and recent activity, and how to choose what Home shows.",
    tags: ["dashboard", "home", "org dashboard", "quick actions", "customize", "enrolled classes", "announcements", "setup steps", "needs attention"],
    who: "Staff. A teacher sees only their own classes; managers and supervisors see every class.",
    intro: "Home is what you see after you sign in. It answers \"what needs me today?\" and takes you to the page that does the work.",
    sections: [
      {
        title: "What's on Home",
        image: "account-home.webp",
        caption: "A manager's Home.",
        list: [
          "<strong>Dashboard</strong> and <strong>School website</strong> tabs at the top. The second shows your public website.",
          "<strong>Enrolled classes</strong>: each class with its teacher. A warning mark means the class has no main teacher yet. Use the pencil to edit the class.",
          "<strong>School Year</strong>: the current term, days left and how far through it you are.",
          "Number tiles: <strong>Admissions waiting</strong>, <strong>Attendance today</strong>, <strong>Fees collected this term</strong> and <strong>Transport</strong>. Each opens the page behind it. Tiles appear only for what you can use.",
          "<strong>Events</strong> shows what is coming up. <strong>Manage</strong> opens events, announcements and activities.",
          "<strong>Activity &amp; Announcements</strong> has <strong>For you</strong> (tasks and things you are tagged in), <strong>Activities</strong> and <strong>Announcements</strong>. <strong>New task</strong> adds a task.",
          "<strong>Needs attention</strong> and <strong>Recent activity</strong> lower down.",
        ],
      },
      {
        title: "Quick actions",
        steps: [
          ["Select <strong>Quick actions</strong> above the cards."],
          "Select an item to go there. The list follows what you use most.",
        ],
      },
      {
        title: "Choose what Home shows",
        steps: [
          ["Select <strong>Customize</strong>."],
          "Check or uncheck the cards: Enrolled classes, Current school year, Admissions waiting, Attendance today, Fees collected this term, Transport, Events and more. Your choice is saved for you only.",
        ],
      },
      {
        title: "Your classes",
        text: "Select a class name to open its classroom. Under the list, use <strong>Rows per page</strong> to show more. A teacher sees only their own classes here; their Home looks like this:",
        images: [["account-role-teacher.webp", "A teacher's Home: one class, and only the tiles they can use."]],
      },
      {
        title: "The setup steps tab",
        text: "While a new school is still setting up, a slim tab sits on the left edge of every page, showing how many steps are done. Hover over it, or select it, to open the list.",
        images: [],
        list: [
          "<strong>Required</strong> steps can't be skipped. <strong>Recommended</strong> steps can: select <strong>Skip</strong>.",
          "A step is crossed out once it is done. Select a step to go to its page. Select <strong>×</strong> to close the list.",
          "The tab goes away when every step is done or skipped.",
        ],
        note: "First-time setup is in " + link("register-a-school-and-complete-first-time-setup", "Register a school and complete first-time setup") + ".",
      },
    ],
    faq: [
      ["Why does my Home show fewer cards than my manager's?", "Cards appear only for what your role can open, and you can hide cards with <strong>Customize</strong>."],
      ["What does the warning mark beside a class mean?", "The class has no main teacher yet. Choose one on a staff member's form in Users / Employees."],
      ["Where did my class go?", "Teachers see only classes they are assigned to. Ask a manager to check your classes."],
    ],
    related: ["navigate-managira", "birthdays-page", "staff-calendar-and-tasks", "the-app-header"],
  },
  {
    slug: "birthdays-page",
    title: "Birthdays",
    topic: "Getting started",
    order: 2.85,
    summary: "See whose birthday it is today and in the coming week, for the students in your classes and for staff.",
    tags: ["birthdays", "birthday", "celebrate", "this week"],
    who: "Staff. Managers, supervisors and the school's own account see every class; teachers see their own classes' students.",
    intro: "The <strong>Birthdays</strong> page lists the birthdays in the next seven days, so nobody's day goes by unnoticed.",
    sections: [
      {
        title: "Open the page",
        steps: [
          ["Open the <strong>☰</strong> menu and select <strong>Birthdays</strong>."],
          ["Read the list. A banner shows how many birthdays there are this week.", "account-birthdays.webp", "Birthdays this week, soonest first."],
        ],
      },
      {
        title: "What each card shows",
        list: [
          "The person's name, their class (or their role, for staff) and the age they are turning.",
          "<strong>Birthday today</strong> for today, or <strong>Upcoming</strong> with the date for the days ahead.",
          "A short birthday wish for the people celebrating today.",
        ],
      },
      {
        title: "Who is on the list",
        list: [
          "Managers and supervisors see students from every class, and staff.",
          "Teachers see students in the classes they are assigned to, and staff.",
          "Only current students with a class appear. Past students are left out.",
        ],
      },
    ],
    faq: [
      ["Does Managira email anyone about birthdays?", "Families can receive a birthday greeting from the school if they haven't turned birthday emails off. The Birthdays page itself sends nothing."],
      ["Why don't I see a student's birthday?", "They may not be in one of your classes, or their date of birth isn't saved on their page."],
    ],
    related: ["staff-home-dashboard", "the-app-header", "staff-calendar-and-tasks"],
  },
  {
    slug: "find-a-page-with-ctrl-k",
    title: "Find a page with Ctrl+K",
    topic: "Getting started",
    order: 2.9,
    summary: "Press Ctrl+K (Cmd+K on a Mac) and type a page's name to open it, without going through menus.",
    tags: ["ctrl k", "cmd k", "page finder", "keyboard shortcut", "go to page", "quick find"],
    who: "Staff. The list holds only pages you can open.",
    intro: "The page finder is a quick way to open any page in Managira. Type a few letters, press <strong>Enter</strong>, and you're there with that page's menu beside it.",
    sections: [
      {
        title: "Open and use it",
        steps: [
          ["Press <strong>Ctrl+K</strong> (<strong>Cmd+K</strong> on a Mac) on any page.", "account-page-finder.webp", "The finder opens in the middle of the page."],
          "Type part of a page's name, or a word people use for it, such as <em>report</em>, <em>billing</em> or <em>attendance</em>. Every word you type must match.",
          ["Use <strong>↑</strong> and <strong>↓</strong> to choose, then press <strong>Enter</strong>."],
        ],
        list: [
          "<strong>Ctrl/Cmd+Enter</strong> opens the page in a new tab. <strong>Esc</strong> closes the finder.",
          "Pages you opened lately come first when the box is empty.",
        ],
      },
      {
        title: "What it lists",
        list: [
          "Only pages <strong>you</strong> can open. A teacher sees fewer pages than a manager. A driver sees only the driver pages, and Settings.",
          "Teachers and supervisors also see each of their own classes as a page.",
          "Settings sections open on the right section.",
        ],
      },
      {
        title: "Looking for a person, not a page",
        text: "The last row of the list hands your words to <strong>Search anything</strong>, to look for a student, parent, staff member or record. See " + link("search-anything-and-search-deeper", "Search anything and Search deeper") + ".",
      },
    ],
    faq: [
      ["Nothing happens when I press Ctrl+K.", "Click on the page first so it has focus. The finder is for signed-in staff, so it isn't on parent, student or public pages."],
      ["A page I use isn't in the list.", "The list only has pages you can open. If a colleague has it, ask a manager to check your permissions."],
    ],
    related: ["navigate-managira", "search-anything-and-search-deeper", "the-app-header"],
  },
  {
    slug: "install-managira-on-your-device",
    title: "Install Managira on your phone or computer",
    topic: "Getting started",
    order: 3,
    summary: "Add Managira to your iPhone, Android phone, iPad, Mac or PC so it opens like an app, with no app store needed.",
    tags: ["install", "app", "iphone", "android", "home screen", "desktop", "pwa", "add to dock"],
    who: "Everyone: staff, parents, students and drivers.",
    intro: "Managira runs in your browser, and you can install it so it opens from your home screen or dock like any other app. Nothing is downloaded from an app store.",
    sections: [
      {
        title: "iPhone or iPad",
        steps: [
          "Open <strong>Safari</strong> and go to your school's Managira address (or managira.com). Sign in first.",
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
      ["Do I need to install it?", "No. Everything works in the browser. Installing makes it quicker to open."],
      ["Will I get notifications?", "Notifications appear in the bell inside Managira, and the ones you choose also arrive by email, text or in the weekly briefing. See " + link("notifications-and-alerts", "Your notifications and alerts") + "."],
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
    tags: ["troubleshooting", "help", "not working", "login problems", "missing menu", "support", "can't sign in", "timed out"],
    intro: "Most problems have a quick fix. Find what you see below. If it still doesn't work, ask Mira or contact support.",
    sections: [
      {
        title: "Signing in",
        list: [
          "<strong>Wrong password:</strong> select <strong>Forgot password?</strong> on the sign-in page. See " + link("reset-a-password-or-recover-account-access", "Reset your password") + ".",
          "<strong>Waiting after several tries:</strong> Managira never locks anyone out. After a few wrong passwords it asks you to wait a little before the next try, and the right password always works.",
          "<strong>No verification code:</strong> check spam and junk for an email from reminders@managira.com, wait a minute, then select <strong>Send a new code</strong>. See " + link("sign-in-to-managira", "Sign in to Managira") + ".",
          "<strong>\"Your session timed out\":</strong> your sign-in ended after quiet time or your school's session limit. Sign in again and you come back to the page you were on. See " + link("tenant-configuration", "Tenant configuration") + ".",
          "<strong>\"Your school signs in with…\":</strong> your school uses single sign-on. Select <strong>Continue with</strong> your provider. See " + link("single-sign-on", "Single sign-on") + ".",
        ],
      },
      {
        title: "A menu, page or button is missing",
        list: [
          "Menus follow your permissions. Check yours in " + link("your-access", "Your access") + " (the <strong>?</strong> menu), and ask a manager to change them in <strong>Management Tools › Users / Employees</strong>.",
          "Some features depend on your school's plan. If a manager can't see it either, check <strong>Settings › Billing &amp; plan</strong>.",
          "Transportation, the Student Portal and Mira are switched on in <strong>Management Tools › Integrations</strong>.",
          "Press <strong>Ctrl+K</strong> to see every page you can open. See " + link("find-a-page-with-ctrl-k", "Find a page with Ctrl+K") + ".",
        ],
      },
      {
        title: "Classes, students or subjects don't show",
        list: [
          "Check the right <strong>school year and term</strong> is current in <strong>Management Tools › School years &amp; terms</strong>.",
          "Check the class is <strong>enrolled in the current term</strong> and the student is in that class.",
          "A teacher sees only the classes assigned to them. A manager assigns classes on the person's staff form.",
          "Past students are left out of search until you check <strong>Include past records</strong>.",
        ],
      },
      {
        title: "Report cards and grades",
        list: [
          "Check scores are entered for every assessment, and the grading scale is set in <strong>Reports › Report settings</strong>.",
          "Choose the right term before generating. Report cards use the term's enrolled subjects.",
        ],
      },
      {
        title: "Messages and payments",
        list: [
          "<strong>Texts not arriving:</strong> see " + link("sms-integrations", "Text messages") + ".",
          "<strong>Emails not arriving:</strong> ask families to check spam, and look at Management Tools for addresses that bounce.",
          "<strong>Payments:</strong> see " + link("set-up-paygira-bills-collections-and-guardian-payments", "PayGira") + " for receipts, failed payments and payouts.",
        ],
      },
      {
        title: "Still stuck?",
        text: "Open the chat at the bottom right of any page and ask Mira, or use the <a href=\"/legal/help\">Help Center</a> to contact support. Tell us what you were doing, what you expected and what happened instead. A screenshot helps.",
      },
    ],
    related: ["sign-in-to-managira", "roles-and-permissions", "navigate-managira"],
  },
];
