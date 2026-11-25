"use strict";

// Parent portal and student portal: everything families and students see and do, step by step.
// Written for a parent on a phone and a 6th grader: short words, short steps. Where another guide
// already explains something (PayGira, the bus, pickup details, calendar sync), these link to it.
// Pictures are phone pictures (390 wide) taken as Michelle Robinson (parent) and Audrey Diaz (student).
const link = (slug, text) => `<a href="/legal/user-documentation/${slug}">${text}</a>`;
// What the school shares decides what a family or a student sees (Class settings › Share with).
const SHARES = "Your school chooses, class by class, what families can see. If something is missing for your child, the school has turned it off for that class. Ask the school office.";
const STUDENT_SHARES = "Your school chooses, class by class, what students can see. If something is missing, your school has turned it off for your class. Ask your teacher.";

module.exports = [
  // ================================================================== Parent portal
  {
    slug: "parent-portal",
    title: "The parent portal: your home page",
    topic: "Parent portal",
    order: 1,
    summary: "What the parent home page shows: your children, requests, bus reports, messages and the menu. Start here.",
    tags: ["parent portal", "parents", "dashboard", "children", "home page", "my children", "menu"],
    featured: true,
    who: "Parents and guardians your school has added. You sign in with the email your school has for you.",
    intro: "The parent portal is one place for everything about your children at school. It works on a phone or a computer.",
    sections: [
      {
        title: "Sign in",
        text: "Your school emails you a link the first time. Open it, choose a password and sign in. Next time, sign in the usual way. See " + link("parent-sign-in", "Sign in as a parent") + ".",
      },
      {
        title: "The home page",
        image: "parent-dashboard-top.webp",
        caption: "The top of your home page: a welcome, then your family details.",
        list: [
          "<strong>Hello, Michelle</strong>: your welcome. The round button on the right opens <strong>Messages</strong>.",
          "<strong>Emergency contact</strong> and <strong>Allowed to pick up</strong>: what the school has on file. Tap <strong>Update</strong> to change them. See " + link("emergency-and-pickup-details", "Emergency &amp; pickup details") + ".",
          "Under them, three tabs: <strong>My Children</strong>, <strong>Requests</strong> and <strong>Bus reports</strong>.",
        ],
      },
      {
        title: "The three tabs",
        steps: [
          ["<strong>My Children</strong> has a card for each child with their class and a <strong>View</strong> button. Tap <strong>View</strong> to open the child's page."],
          ["<strong>Requests</strong> lists forms the school wants you to fill in. The number on the tab is how many are waiting. See " + link("parent-forms-and-portfolio", "Forms, requests and portfolio") + ".", "parent-requests.webp", "Requests: New forms to fill in, and Old ones you have sent."],
          ["<strong>Bus reports</strong> shows notes from the driver that the school shared with you, such as something left on the bus. The tab shows only when your school uses the bus. See " + link("parent-bus", "The bus") + "."],
        ],
      },
      {
        title: "The menu",
        steps: [
          ["Tap the three lines at the top right.", "parent-menu.webp", "The menu opens on the right."],
          ["Pick a page: <strong>Dashboard</strong>, <strong>School website</strong>, <strong>Activities</strong>, <strong>Calendar</strong>, <strong>Messages</strong>, <strong>PayGira</strong>, <strong>Settings</strong> or <strong>Logout</strong>. <strong>Logout</strong> asks you first."],
        ],
        list: [
          "The bell shows what's new: grades, forms, bus and more. See " + link("parent-notifications-and-settings", "Notifications and settings") + ".",
          "The <strong>?</strong> opens the help center.",
        ],
      },
      {
        title: "Where to find things",
        table: [
          ["I want to…", "Go to", "Guide"],
          ["See grades, attendance, report cards", "Child's page › <strong>Academic info</strong>", link("parent-grades-and-report-cards", "Grades and report cards")],
          ["See the schedule, lunch or teachers", "Child's page", link("parent-schedule-lunch-and-teachers", "Schedule, lunch and teachers")],
          ["See what's coming up", "<strong>Calendar</strong> or <strong>Activities</strong>", link("parent-calendar-and-activities", "Calendar and activities")],
          ["See tests and homework", "Child's page › <strong>Testing Room</strong>", link("parent-tests-and-results", "Tests and results")],
          ["Fill in a form", "<strong>Requests</strong> tab", link("parent-forms-and-portfolio", "Forms and portfolio")],
          ["Message a teacher", "<strong>Messages</strong>", link("parent-messages", "Messages")],
          ["Pay a bill", "<strong>PayGira</strong>", link("parent-pay-bills", "Pay school bills")],
          ["Track the bus", "<strong>Bus</strong> button on a child's card", link("parent-bus", "The bus")],
          ["Choose what you hear about", "<strong>Alerts</strong> and <strong>Settings</strong>", link("parent-alerts", "Alerts") + ", " + link("parent-notifications-and-settings", "Settings")],
          ["See a child at another school", "<strong>My Children</strong>", link("parent-children-at-several-schools", "Children at several schools")],
        ],
      },
      {
        title: "Why something may be missing",
        text: SHARES,
      },
    ],
    faq: [
      ["I see no children.", "The school hasn't linked you to a student yet, or your email isn't the one on file. Ask the school office."],
      ["Why can I see something for one child but not the other?", "What you see follows each child's class. Two children in two classes can have different tiles."],
      ["I forgot my password.", "On the sign-in page choose <strong>Forgot password</strong>. See " + link("reset-a-password-or-recover-account-access", "Reset your password") + "."],
    ],
    related: ["parent-sign-in", "parent-tiles-and-homework-help", "parent-grades-and-report-cards", "parent-messages", "create-manage-parent"],
  },
  {
    slug: "parent-sign-in",
    title: "Sign in as a parent",
    topic: "Parent portal",
    order: 2,
    summary: "Use the email from your school to set a password the first time, then sign in, stay signed in and handle the emailed code.",
    tags: ["parent sign in", "invitation", "set password", "first time", "login", "verification code", "forgot password"],
    who: "Parents and guardians.",
    intro: "Your school sends you an invitation email the first time. After that you sign in with your email and password.",
    sections: [
      {
        title: "The first time",
        steps: [
          "Open the email from your school. Use the same address the school has for you.",
          "Choose <strong>Set password</strong> (or the link in the email).",
          "Type a new password, at least 10 characters. Type it again and save.",
          "Sign in with your email and your new password.",
        ],
        note: "The link in the email works for a short time. If it has run out, use <strong>Forgot password</strong> on the sign-in page, or ask the school to send it again.",
      },
      {
        title: "Every time after",
        steps: [
          "Go to your school's Managira sign-in page. See " + link("sign-in-to-managira", "Sign in to Managira") + ".",
          "Type your <strong>email</strong> and choose to continue. Type your <strong>password</strong>.",
          "If Managira emails you a <strong>code</strong>, type it in. It is a short number that proves it is you.",
          "Check <strong>Keep me logged in</strong> on your own phone or computer, if you like.",
        ],
        tip: "If you chose to remember the browser, Managira doesn't ask for a code again for a few days on that browser.",
      },
      {
        title: "If you can't sign in",
        list: [
          "Check the email address. It must be the one your school has for you.",
          "Choose <strong>Forgot password</strong> to get a new link. See " + link("reset-a-password-or-recover-account-access", "Reset your password") + ".",
          "Still stuck? Ask the school office to check your email on your parent record.",
        ],
      },
    ],
    faq: [
      ["I have children at two schools. Do I need two sign-ins?", "No. Use one sign-in. See " + link("parent-children-at-several-schools", "Children at several schools") + "."],
      ["Does it log me out?", "You are signed out after a time of no use. The page tells you and takes you back to where you were after you sign in."],
    ],
    related: ["parent-portal", "sign-in-to-managira", "reset-a-password-or-recover-account-access"],
  },
  {
    slug: "parent-tiles-and-homework-help",
    title: "Your child's page and its tiles",
    topic: "Parent portal",
    order: 3,
    summary: "One tile for each part of your child's school day: grades, schedule, lunch, alerts, calendar, tests, forms and more.",
    tags: ["child page", "tiles", "homework", "parent portal", "view child", "app tiles"],
    who: "Parents and guardians.",
    intro: "Tap <strong>View</strong> on a child's card to open their page. It has a tile for each part of school.",
    sections: [
      {
        title: "Open your child's page",
        steps: [
          ["On <strong>My Children</strong>, tap <strong>View</strong> on the child's card. You can also tap the child's name or photo.", "parent-dashboard-card-zoom.webp", "View is at the top right of the card."],
          ["The page shows your child's name and class, then the tiles. A red number on a tile means something is new."],
          "To go back, tap <strong>My children</strong> at the top left.",
        ],
      },
      {
        title: "What each tile shows",
        table: [
          ["Tile", "What you see", "Guide"],
          ["<strong>Academic info</strong>", "Attendance, grades, GPA and report cards.", link("parent-grades-and-report-cards", "Grades and report cards")],
          ["<strong>Schedule</strong>", "The week, class by class.", link("parent-schedule-lunch-and-teachers", "Schedule, lunch and teachers")],
          ["<strong>Teachers</strong>", "Who teaches your child, with a Message button.", link("parent-schedule-lunch-and-teachers", "Schedule, lunch and teachers")],
          ["<strong>Lunch</strong>", "Days with lunch, and a note for the kitchen.", link("parent-schedule-lunch-and-teachers", "Schedule, lunch and teachers")],
          ["<strong>Alerts</strong>", "Choose what you hear about this child.", link("parent-alerts", "Alerts")],
          ["<strong>Calendar</strong> and <strong>Activities</strong>", "Classes, events, clubs and trips.", link("parent-calendar-and-activities", "Calendar and activities")],
          ["<strong>Homework</strong>", "Homework the teacher shared, with notes and files.", "Below."],
          ["<strong>Testing Room</strong>", "Tests the teacher shared with you.", link("parent-tests-and-results", "Tests and results")],
          ["<strong>Documents &amp; results</strong>", "Files from the school and shared results.", link("parent-tests-and-results", "Tests and results")],
          ["<strong>Forms</strong>", "Forms to fill in, and what you sent.", link("parent-forms-and-portfolio", "Forms and portfolio")],
          ["<strong>Portfolio</strong>", "Term by term: marks, tests and the report card.", link("parent-forms-and-portfolio", "Forms and portfolio")],
          ["<strong>Transportation</strong>", "Your child's bus and stop.", link("parent-bus", "The bus")],
          ["<strong>Messages</strong>", "Your conversations about this child only.", link("parent-messages", "Messages")],
        ],
        note: "A tile you don't see is turned off for your child's class, or your school doesn't use it. Ask the school office.",
      },
      {
        title: "Cumulative GPA",
        text: "Where your school shows GPA, a <strong>Cumulative GPA</strong> card may sit above the tiles. It shows dots until you tap the eye, and hides again each time you open the page. It counts finished terms only. This term's GPA is in <strong>Academic info</strong>. See " + link("gpa-on-report-cards-and-transcripts", "GPA") + ".",
      },
      {
        title: "Homework",
        text: "Open <strong>Homework</strong> to see work the teacher chose to share with parents, with notes and files. It says <em>Nothing open right now</em> when there is none. You see only what your child can already see.",
      },
    ],
    faq: [
      ["A number on a tile won't go away.", "It goes when you open the tile and see the new things."],
      ["Where did Report cards go?", "Open <strong>Academic info</strong> and tap <strong>Report Card</strong>."],
    ],
    related: ["parent-portal", "parent-grades-and-report-cards", "parent-tests-and-results", "parent-alerts"],
  },
  {
    slug: "parent-grades-and-report-cards",
    title: "Grades, attendance and report cards",
    topic: "Parent portal",
    order: 4,
    summary: "See your child's attendance, grades, GPA and report cards for each term. A grade shows once the teacher posts it.",
    tags: ["grades", "report cards", "attendance", "academic info", "gpa", "term", "parent portal"],
    who: "Parents and guardians.",
    intro: "<strong>Academic info</strong> is where your child's school results live.",
    sections: [
      {
        title: "Open Academic info",
        steps: [
          ["On your child's page, tap <strong>Academic info</strong>.", "parent-child.webp", "Academic info is the first tile."],
          ["The top shows your child's name and the term you are viewing."],
        ],
      },
      {
        title: "Choose a term",
        steps: [
          ["Under <strong>Academic Period</strong>, pick a term from the list and tap <strong>Show</strong>."],
          "Everything below changes to that term.",
        ],
      },
      {
        title: "Attendance and grades",
        steps: [
          ["<strong>Attendance</strong> shows total school days, days present, days absent and the attendance rate. Where the school takes lunch, overall lunch shows too.", "parent-attendance-grades.webp", "Attendance, then Current Term Performance."],
          "<strong>Current Term Performance</strong> lists each subject with its marks. Slide the table sideways to see every column. Tap a column heading to sort.",
          "<strong>GPA this term</strong> and <strong>Cumulative GPA</strong> show above the table where your school shows GPA.",
        ],
        note: "A mark shows once the teacher posts it. While a mark is waiting, the subject's total waits too, so a total never counts something you can't see.",
      },
      {
        title: "Report cards",
        steps: [
          ["Tap <strong>Report Card</strong> near the top."],
          "A list of <strong>Posted Report Cards</strong> opens. Tap <strong>Open</strong> beside one to read it as a PDF.",
          "The list says <em>There is nothing to show</em> until the school posts a report card.",
        ],
        tip: "Report cards for past terms are in the child's " + link("parent-forms-and-portfolio", "Portfolio") + " too.",
      },
    ],
    faq: [
      ["A grade is missing.", "The teacher hasn't posted it yet. You get a notice when they do."],
      ["I don't see attendance, lunch, GPA or report cards.", SHARES],
      ["Why is my child's GPA different from last term?", "This term's GPA counts this term's courses. The cumulative GPA counts every finished term."],
    ],
    related: ["parent-tiles-and-homework-help", "parent-tests-and-results", "gpa-on-report-cards-and-transcripts", "report-card"],
  },
  {
    slug: "parent-schedule-lunch-and-teachers",
    title: "Schedule, lunch and teachers",
    topic: "Parent portal",
    order: 5,
    summary: "See your child's weekly schedule, their lunch days, leave a note for the kitchen, and message their teachers.",
    tags: ["schedule", "timetable", "lunch", "teachers", "contact teacher", "lunch note", "parent portal"],
    who: "Parents and guardians.",
    intro: "Three small pages on your child's page: <strong>Schedule</strong>, <strong>Lunch</strong> and <strong>Teachers</strong>.",
    sections: [
      {
        title: "Schedule",
        steps: [
          ["On your child's page, tap <strong>Schedule</strong>.", "parent-schedule.webp", "The week, Monday to Friday, class by class with times."],
          "Each day lists the classes in order. It says <em>No schedule yet</em> if the school hasn't made one.",
        ],
      },
      {
        title: "Lunch",
        steps: [
          ["Tap <strong>Lunch</strong>. The cards show <strong>Days with lunch</strong>, <strong>Overall lunch</strong> and <strong>Days without</strong> for this term."],
          "Under <strong>Each day</strong>, a check means lunch that day. A cross means no lunch.",
          "To tell the kitchen something, type in <strong>Note for lunch</strong> (an allergy, a special meal) and tap <strong>Save</strong>.",
        ],
        note: "Lunch shows only when your child's class takes lunch and shares it with parents.",
      },
      {
        title: "Teachers",
        steps: [
          ["Tap <strong>Teachers</strong>."],
          "Each card shows the teacher's name, role and subject. The school decides whether their email, phone and a short <strong>About me</strong> show.",
          "Tap <strong>Message</strong> to write to that teacher. See " + link("parent-messages", "Messages") + ".",
        ],
      },
    ],
    faq: [
      ["Lunch says it hasn't been taken yet.", "The teacher hasn't marked lunch this term. It fills in as they do."],
      ["Why can't I see the teacher's phone?", "The school keeps phones off unless it turns them on for the class."],
    ],
    related: ["parent-tiles-and-homework-help", "parent-messages", "class-settings"],
  },
  {
    slug: "parent-calendar-and-activities",
    title: "Your child's calendar and activities",
    topic: "Parent portal",
    order: 6,
    summary: "See school events, classes, clubs and trips for your children, and add them to your phone's calendar.",
    tags: ["calendar", "activities", "events", "trips", "clubs", "sync calendar", "parent portal"],
    who: "Parents and guardians.",
    intro: "Find what's coming up for your children in one calendar, and see clubs and trips in <strong>Activities</strong>.",
    sections: [
      {
        title: "Calendar",
        steps: [
          ["Open <strong>Calendar</strong> from the menu or a child's page.", "parent-calendar.webp", "Choose children and calendars, then see what's coming up."],
          "Under <strong>Children</strong>, tap <strong>All children</strong> or one child.",
          "Under <strong>My calendars</strong>, check or uncheck <strong>School events</strong>, <strong>Activities</strong>, <strong>Classes</strong> and <strong>Due</strong> to show or hide them. The number is how many there are.",
          "<strong>Coming up</strong> lists the next things. Below it, switch between <strong>Month</strong>, <strong>Week</strong>, <strong>Day</strong> and <strong>Agenda</strong>, and use the arrows or <strong>Today</strong>.",
        ],
        tip: "To see it on your own phone's calendar, tap <strong>Sync</strong>. See " + link("calendar-sync-google-outlook-apple", "Calendar sync") + ".",
      },
      {
        title: "Activities",
        steps: [
          ["Open <strong>Activities</strong> from the menu or your child's page."],
          "Each card shows the date, time, place and what to bring.",
          "Tap <strong>Past</strong> at the bottom to see ones that are over.",
        ],
        note: "A number on the <strong>Activities</strong> tile is how many new ones there are. See " + link("activities", "Activities") + " for how the school sets them up.",
      },
    ],
    faq: [["An activity I know about isn't here.", "Activities show for the grades and classes the school chose. Ask the school office."]],
    related: ["parent-portal", "activities", "calendar-sync-google-outlook-apple"],
  },
  {
    slug: "parent-tests-and-results",
    title: "Tests, homework and results",
    topic: "Parent portal",
    order: 7,
    summary: "See the tests and homework your teacher shared, finished results once posted, and the answers when the teacher shares them.",
    tags: ["testing room", "test results", "review answers", "homework", "documents", "parent portal"],
    who: "Parents and guardians.",
    intro: "Your child takes tests on their own. You see them here when the teacher chooses to share.",
    sections: [
      {
        title: "Testing Room",
        steps: [
          ["On your child's page, tap <strong>Testing Room</strong>.", "parent-testing-room.webp", "Tests the teacher shared with parents."],
          "Tap a test to see its questions and the teacher's notes. The page says <em>Nothing open right now</em> when there is none.",
          "Finished tests, with their grade, show here once the teacher posts the grade.",
        ],
        note: "Only the teacher can take away or add what you see. You get a notice when a grade is posted.",
      },
      {
        title: "What you can see after a test",
        table: [
          ["The teacher shares…", "You see…"],
          ["Nothing", "No result here. The grade still shows in Academic info once posted."],
          ["The grade", "The test and its grade."],
          ["Grade and answers", "The grade, each question, your child's answer and the right one."],
        ],
      },
      {
        title: "Documents &amp; results",
        steps: [
          ["Tap <strong>Documents &amp; results</strong> to see files from the school, such as an insurance card, and files teachers attached."],
          "Tap a file to open it. A link lasts a few minutes, so open it again if it stops working.",
        ],
      },
    ],
    faq: [
      ["Why don't I see my child's test?", "The teacher hasn't shared it with parents. The grade appears in Academic info once posted."],
      ["Can I help my child take a test here?", "No. Tests are taken by your child in the student portal. See " + link("student-testing-room", "Take a test") + "."],
    ],
    related: ["parent-tiles-and-homework-help", "parent-grades-and-report-cards", "student-testing-room"],
  },
  {
    slug: "parent-messages",
    title: "Messages to the school",
    topic: "Parent portal",
    order: 8,
    summary: "Write to your child's teachers, copy others in, and read the replies. Open one child's messages from their page.",
    tags: ["messages", "contact teacher", "send message", "reply", "inbox", "parent portal"],
    who: "Parents and guardians.",
    intro: "Use <strong>Messages</strong> to write to the school about a child. Replies come back in the same conversation.",
    sections: [
      {
        title: "Open Messages",
        steps: [
          ["Open <strong>Messages</strong> from the menu or the round button on the home page.", "parent-messages.webp", "Your conversations. 1 unread means a reply is waiting."],
          ["For one child only, open the child's page and tap <strong>Messages</strong>. It shows that child's conversations, with <strong>All messages</strong> to go back."],
          "<strong>Search &amp; Filter</strong> finds an older conversation.",
        ],
      },
      {
        title: "Send a message",
        steps: [
          ["Tap <strong>+ New message</strong>."],
          ["Choose the <strong>Student</strong>, type a <strong>Subject</strong>, pick a <strong>Priority</strong> and write your <strong>Message</strong>.", "parent-message-new.webp", "The message window."],
          ["Under <strong>CC Staff Members</strong>, check who else should read it. The child's class teachers are checked for you."],
          ["Tap <strong>Send message</strong>."],
        ],
      },
      {
        title: "Read and reply",
        steps: [
          ["Tap a conversation. Your message and every reply show in order. The unread replies are marked.", "parent-message-thread.webp", "Michelle's message and Mr. Sullivan's reply."],
          ["Type under <strong>Type a message…</strong> and tap the arrow to reply."],
        ],
        tip: "The three dots on a message let you delete your own message or the whole conversation.",
      },
    ],
    faq: [
      ["How long until I get a reply?", "That depends on the teacher. The bell tells you the moment one arrives."],
      ["Can another parent see my messages?", "No. A conversation is between you and the staff you chose."],
    ],
    related: ["parent-portal", "parent-schedule-lunch-and-teachers", "mailroom-send-sms-whatsapp-and-email-to-guardians"],
  },
  {
    slug: "parent-forms-and-portfolio",
    title: "Forms, requests and your child's portfolio",
    topic: "Parent portal",
    order: 9,
    summary: "Fill in the forms your school sends, see what you have sent, and open your child's portfolio of files and marked work.",
    tags: ["forms", "requests", "permission slip", "consent", "portfolio", "marked tests", "student files", "parent portal"],
    who: "Parents and guardians.",
    intro: "Your school can ask you to fill in forms, such as a permission slip. They show in <strong>Requests</strong> and on each child's <strong>Forms</strong> tile.",
    sections: [
      {
        title: "Find forms to fill in",
        steps: [
          ["On the home page, tap the <strong>Requests</strong> tab. <strong>New</strong> lists forms waiting. <strong>Old</strong> lists forms you have sent.", "parent-requests.webp", "Each request names the child, a due date and says Required."],
          ["Tap <strong>Fill in</strong>. The form opens on that child's <strong>Forms</strong> page. You can also open it from the child's <strong>Forms</strong> tile."],
        ],
        note: "The <strong>Requests</strong> tab also holds your bus requests. A number on a tile or the tab means a form is waiting. You get a notice when a new form arrives, and a reminder before a required form is due.",
      },
      {
        title: "Fill in a form",
        steps: [
          ["Open a form under <strong>To fill in</strong>. A due date shows if there is one. Fields with a red star are required.", "parent-form-open.webp", "A permission slip with a question and a signature."],
          "Answer each question. Where it asks for a signature, type your full name and check the box.",
          ["Tap <strong>Send</strong>."],
        ],
        list: [
          "<strong>Sent</strong> lists what you sent. Open one to change it and tap <strong>Save changes</strong>.",
          "A form that says <em>This can be sent only once</em> can't be changed after you send it. Check your answers first.",
          "<strong>Shared by the school</strong> lists records you can read, such as a reading log.",
        ],
      },
      {
        title: "The portfolio",
        steps: [
          ["On your child's page, tap <strong>Portfolio</strong>."],
          ["<strong>Student files</strong> holds papers the school shared with you. Tap <strong>Open</strong> to read one."],
          "Pick one of the last three terms. You see the average, <strong>Marked work</strong> and the <strong>Report card</strong> for that term.",
          "<strong>Documented assessments</strong> are tests taken in the Testing Room. Tap <strong>Open</strong> or <strong>Download PDF</strong>.",
          "<strong>Assessments &amp; assignments</strong> lists each subject's work with its mark. <em>Undocumented</em> means the teacher typed the mark in.",
        ],
        note: "You see marks once the teacher posts them, the same as in " + link("parent-grades-and-report-cards", "Grades and report cards") + ". The school decides whether the portfolio and files show for each class.",
      },
    ],
    faq: [
      ["I sent the wrong answer.", "Open the form under Sent and change it. If it could be sent only once, message the teacher or the school office."],
      ["I gave the form to the teacher on paper.", "That is fine. The teacher enters it for you, and it leaves your list."],
      ["A test isn't in the portfolio.", "It shows once the teacher has marked and posted it."],
    ],
    related: ["parent-tiles-and-homework-help", "parent-tests-and-results", "parent-messages"],
  },
  {
    slug: "parent-bus",
    title: "The bus: track it, say not coming, bus requests and reports",
    topic: "Parent portal",
    order: 10,
    summary: "Watch your child's bus on a map, tell the driver your child isn't coming today, ask for a bus and read bus reports.",
    tags: ["bus", "track bus", "not coming today", "riding today", "bus request", "bus reports", "transportation", "parent portal"],
    who: "Parents and guardians, where your school uses the bus.",
    intro: "If your child rides the bus, you can see where it is, tell the driver when your child won't ride, and read notes from the driver.",
    sections: [
      {
        title: "Open the Bus menu",
        steps: [
          ["On <strong>My Children</strong>, tap <strong>Bus</strong> on your child's card.", "parent-dashboard-bus-zoom.webp", "The Bus button on a child's card."],
          ["Two choices open: <strong>Track the bus</strong> and <strong>Not coming today</strong>."],
        ],
      },
      {
        title: "Track the bus",
        steps: [
          ["Tap <strong>Track the bus</strong>. A map opens with the bus, your child's stop and the route."],
          "The top left says <em>Stopped</em>, <em>Moving</em> or <em>Estimated position</em>. The time shows how long until the bus gets to your stop.",
          "Tap the arrows to make the map bigger, and the round target to find the bus. Tap <strong>X</strong> to close.",
        ],
        note: "If the bus has not sent its place for a little while, the map says <em>Estimated position</em> and the time is a guess. It never says the bus passed you. See " + link("live-bus-tracking", "Live bus tracking") + ".",
      },
      {
        title: "Not coming today",
        steps: [
          ["Tap <strong>Bus</strong>, then <strong>Not coming today</strong>. The driver and the teacher see it."],
          "Changed your mind? Tap <strong>Bus</strong> again, then <strong>Riding today after all</strong>.",
        ],
        tip: "To stop using the bus for good, open the tracker from your child's <strong>Transportation</strong> tile and tap <strong>Stop using the bus</strong> at the bottom. It asks first.",
      },
      {
        title: "Ask for a bus",
        text: "If your child doesn't ride yet, their card has a <strong>Request a bus</strong> button. Fill it in and the school answers in <strong>Requests</strong>. See " + link("transportation-bus-requests", "Bus requests") + ".",
      },
      {
        title: "Bus reports",
        steps: [
          ["Tap the <strong>Bus reports</strong> tab on the home page.", "parent-bus-reports.webp", "A report the school shared, with its date and the school's note."],
          "Each report names your child. It shows only when the school shared it with you.",
        ],
      },
    ],
    faq: [
      ["The tracker has no bus.", "The driver hasn't started the trip yet, or your child's class doesn't share the bus with parents."],
      ["Do I get a message when the bus is close?", "Yes, if you turn on the <strong>Bus is about to arrive</strong> alert. See " + link("parent-alerts", "Alerts") + "."],
    ],
    related: ["live-bus-tracking", "parent-alerts", "transportation-bus-requests", "parent-portal"],
  },
  {
    slug: "parent-pay-bills",
    title: "Pay your child's school bills",
    topic: "Parent portal",
    order: 11,
    summary: "See what each child owes, pay a bill or part of it, and get an invoice or receipt.",
    tags: ["pay school fees", "pay a bill", "pay online", "parent payments", "pay in the parent portal", "fees", "tuition", "invoice", "receipt", "outstanding", "parent portal"],
    who: "Parents and guardians, where the school uses PayGira.",
    intro: "The <strong>PayGira</strong> page lists every bill for all your children in one place.",
    sections: [
      {
        title: "Find your bills",
        steps: [
          ["Tap the menu, then <strong>PayGira</strong>.", "parent-paygira.webp", "Totals at the top, then a card for each child."],
          "The four boxes show <strong>Total billed</strong>, <strong>Total paid</strong>, <strong>Outstanding</strong> and <strong>Available balance</strong> (credit you can use), for all children together.",
          "Under them, each child's card lists their bills with the amount left, how much is paid and a badge such as <strong>Paid</strong>, <strong>Partial</strong> or <strong>Pending</strong>.",
        ],
      },
      {
        title: "Pay a bill",
        steps: [
          ["Tap <strong>Pay</strong> on the bill (<strong>Pay dates</strong> on a bill that repeats)."],
          ["Check the <strong>Amount</strong>. You can pay part of a bill by typing less. Choose <strong>Pay with</strong> and follow the steps."],
          "When the payment goes through, the bill and your totals update.",
        ],
        note: "Which ways to pay you see depends on your school. It can offer a card, other online ways and paying at the school office (cash). If the school takes cards, you can also save one in <strong>Settings</strong> for faster payments.",
      },
      {
        title: "Invoice and receipt",
        text: "Tap the small page icon beside a bill for its <strong>invoice</strong>, or a <strong>receipt</strong> after you have paid. <strong>Recent Payments</strong> at the bottom lists your payments.",
      },
    ],
    faq: [
      ["Why does my child's card say Outstanding?", "It is what is still owed for that child's bills."],
      ["I paid in cash at the office.", "The school records it, and it shows here when they do."],
      ["Is my card number kept?", "Only the last 4 digits are stored and shown."],
    ],
    related: ["set-up-paygira-bills-collections-and-guardian-payments", "parent-notifications-and-settings", "parent-portal"],
  },
  {
    slug: "parent-alerts",
    title: "Alerts: choose what you hear about",
    topic: "Parent portal",
    order: 12,
    summary: "Pick which news you get about your children, and how: in Managira, by email, by text or in the weekly briefing. Set it for all children or one.",
    tags: ["alerts", "notifications", "low score", "absent", "bus alert", "weekly briefing", "text message", "parent portal"],
    who: "Parents and guardians.",
    intro: "Alerts tell you when something matters, such as a low score or an absence. You choose what and how.",
    sections: [
      {
        title: "Alerts for one child",
        steps: [
          ["On your child's page, tap <strong>Alerts</strong>."],
          ["The page lists alerts under <strong>Academics</strong>, <strong>Attendance</strong> and <strong>Bus</strong>. Each row has a switch for <strong>In Managira</strong>, <strong>Email</strong>, <strong>Text message</strong> and <strong>Weekly briefing</strong>.", "parent-alerts.webp", "Switches for each alert."],
          "Turn on the ways you want. A row with nothing on is off.",
          "For <strong>Needs improvement</strong> and <strong>Happy news</strong>, type the percentage that sets it off.",
          "Tap <strong>Save notifications</strong>. The button turns on once you change something.",
        ],
      },
      {
        title: "Alerts for all your children",
        steps: [
          ["Open <strong>Settings</strong> from the menu and open <strong>Notifications</strong>. The same list is there, and what you save applies to every child.", "parent-settings-notifications.webp", "The same alerts in Settings, with the school's emails under them."],
          ["On a child's Alerts page, the switch <strong>Use my alerts for all my children</strong> goes on while that child follows your common choices. Turn it off to set different alerts for just that child."],
        ],
        tip: "A child's own alerts replace your common ones for that child. Turn the switch on again to go back.",
      },
      {
        title: "What each alert means",
        table: [
          ["Alert", "You hear when…"],
          ["<strong>Needs improvement</strong>", "a posted score is below your percentage."],
          ["<strong>Happy news</strong>", "a posted score is at or above your percentage."],
          ["<strong>Report card ready</strong>", "the school posts a report card."],
          ["<strong>Absent from school</strong>", "your child is marked absent."],
          ["<strong>Bus is about to arrive</strong> and <strong>Bus has arrived</strong>", "the bus is near, or at, your child's stop. Only where the school uses the bus and your child rides."],
        ],
        note: "A row marked <em>Set by your school</em> is locked. Text message shows only where your school has texting. Weekly briefing shows only where it is turned on. See " + link("notifications-and-alerts", "Your notifications and alerts") + " and " + link("weekly-briefing", "Weekly briefing") + ".",
      },
    ],
    faq: [
      ["I don't see an Alerts tile.", "Your school keeps alerts off for your child's class. Ask the school office."],
      ["I get a report card email I didn't ask for.", "Report cards and bus notices were always sent. Turn them off in Alerts."],
    ],
    related: ["parent-notifications-and-settings", "notifications-and-alerts", "weekly-briefing"],
  },
  {
    slug: "parent-notifications-and-settings",
    title: "The bell and your settings",
    topic: "Parent portal",
    order: 13,
    summary: "What the bell tells you, and how to change the look, your photo, your details and your saved cards.",
    tags: ["notifications", "settings", "bell", "appearance", "profile", "dark mode", "saved cards", "parent portal"],
    who: "Parents and guardians.",
    intro: "The bell shows what's new. <strong>Settings</strong> is where you change how Managira looks and your own details.",
    sections: [
      {
        title: "The bell",
        list: [
          "Tap the bell at the top. The number is how many are new.",
          "You may see new grades, forms to fill in, new activities, attendance notices, report cards, bus news and payments.",
          "Tap a notice to open it. The check mark at the top marks all as read. The bin clears them.",
        ],
        note: "What you hear is up to you. See " + link("parent-alerts", "Alerts") + ".",
      },
      {
        title: "Open Settings",
        steps: [
          ["Tap the menu, then <strong>Settings</strong>.", "parent-settings.webp", "Appearance first, then Profile, Notifications and Saved cards."],
          ["<strong>Appearance</strong>: choose <strong>Light</strong>, <strong>Classic</strong> or <strong>Dark</strong>. It changes at once, just for you."],
        ],
      },
      {
        title: "Profile",
        steps: [
          ["Open <strong>Profile</strong>. You can change <strong>Your Profile Image</strong>, a child's picture under <strong>Student Images</strong>, and your names, phone and address under <strong>Personal Information</strong>.", "parent-settings-profile.webp", "Photo, student images and personal information."],
          "Tap <strong>Save Changes</strong>.",
        ],
      },
      {
        title: "Notifications and saved cards",
        list: [
          "<strong>Notifications</strong>: one list for alerts and emails, saved with one button. See " + link("parent-alerts", "Alerts") + ".",
          "<strong>Saved cards</strong>: cards for paying school bills. It says if your school doesn't take cards. See " + link("parent-pay-bills", "Pay school bills") + ".",
        ],
      },
    ],
    related: ["parent-portal", "parent-alerts", "parent-pay-bills"],
  },
  {
    slug: "parent-children-at-several-schools",
    title: "Children at several schools: one sign-in",
    topic: "Parent portal",
    order: 14,
    summary: "If your children go to different Managira schools, see them all with one sign-in. Accept the invitation, switch schools and hide one that isn't yours.",
    tags: ["several schools", "two schools", "family link", "same email", "accept", "not me", "school logo", "parent portal"],
    who: "Parents and guardians whose children are at more than one Managira school and whose schools have your same email.",
    intro: "When another Managira school has you as a parent with the same sign-in email, it can show up on your My Children page. You choose to accept it first.",
    sections: [
      {
        title: "Accept the invitation",
        steps: [
          ["On <strong>My Children</strong>, look for a box that says a school <em>added you as a parent</em>. It shows the school's logo and the child's name.", "parent-family-invite.webp", "Managira Int. Middle added Michelle as the parent of Maya."],
          ["Tap <strong>Accept</strong> if the child is yours."],
          "Tap <strong>Not me</strong> if it isn't yours. It hides the invitation.",
        ],
        note: "Another school's children show only after you have proven your email. Sign in with the emailed code, or use the box on the home page that asks you to confirm your email. A phone number never links anyone.",
      },
      {
        title: "After you accept",
        steps: [
          ["Every child now shows a small school logo on their picture. Your header shows each school's logo, with the one you are looking at in front.", "parent-family-accepted.webp", "Three children at two schools."],
          ["The logos in the header are the schools linked to you."],
          "Tap <strong>View</strong> on the other school's child. Managira opens that child's page in their school, with that school's rules, logo and what it shares.",
          "To go back, open your <strong>Dashboard</strong>. It brings you home to the school you signed in with.",
        ],
        tip: "Each school keeps its own forms, bills, messages and bus. Forms from every school show in <strong>Requests</strong>, labeled <em>For [child] at [school]</em>.",
      },
    ],
    faq: [
      ["I don't see the invitation.", "The other school needs your same sign-in email, and you need to have signed in with the emailed code once. Ask that school which email it has."],
      ["Can the other school see my first school?", "No. Each school sees only its own children."],
    ],
    related: ["parent-portal", "parent-sign-in"],
  },

  // ================================================================== Student portal
  {
    slug: "student-portal",
    title: "The student portal: your home page",
    topic: "Student portal",
    order: 1,
    summary: "Sign in, then see your attendance, GPA, tiles, requests and bus reports. Start here.",
    tags: ["student portal", "students", "dashboard", "home", "sign in", "tiles"],
    featured: true,
    who: "Students, once your school turns on the student portal for your class and invites you.",
    intro: "The student portal is where you see your classes, grades, tests, calendar and bus.",
    sections: [
      {
        title: "Sign in",
        text: "Your school sends you an email. Open it, choose a password and sign in. Then sign in the same way each time. Forgot it? Choose <strong>Forgot password</strong>. See " + link("sign-in-to-managira", "Sign in to Managira") + ".",
      },
      {
        title: "Your home page",
        steps: [
          ["The top shows your name, your class, the term and the school year. Under it are small cards.", "student-dashboard.webp", "Audrey's home page."],
          ["<strong>Attendance</strong> shows your percentage. <strong>GPA</strong> shows dots. Tap the eye to see it, and tap again to hide it. <strong>Term</strong> says how many days are left. <strong>Lunch</strong> shows days with lunch."],
          ["Three tabs sit under the cards: <strong>My tiles</strong>, <strong>Requests</strong> and <strong>Bus reports</strong>."],
        ],
        note: "Some cards show only where your school shares them with your class: attendance, lunch, GPA and the bus. " + STUDENT_SHARES,
      },
      {
        title: "Your tiles",
        steps: [
          ["<strong>My tiles</strong> is a tile for each area. A red number on a tile means something is waiting, such as a test.", "student-tiles-zoom.webp", "Schedule, Calendar, Activities, Grades, Teachers, Bus, Testing Room, Forms, Portfolio and Settings."],
        ],
        table: [
          ["Tile", "What it opens", "Guide"],
          ["<strong>Schedule</strong>", "Your classes, day by day.", ""],
          ["<strong>Calendar</strong> and <strong>Activities</strong>", "What is coming up.", link("student-calendar-and-activities", "Calendar and activities")],
          ["<strong>Grades</strong>", "Your marks for each subject.", link("student-results", "Grades and results")],
          ["<strong>Teachers</strong>", "Who teaches you, and their email.", link("student-bus-and-teachers", "Bus and teachers")],
          ["<strong>Bus</strong>", "Your bus and stop.", link("student-bus-and-teachers", "Bus and teachers")],
          ["<strong>Testing Room</strong>", "Tests to take.", link("student-testing-room", "Take a test")],
          ["<strong>Forms</strong>, <strong>Portfolio</strong>", "Forms to fill in. Your work, term by term.", link("student-forms-and-portfolio", "Forms and portfolio")],
          ["<strong>Settings</strong>", "Look and alerts.", link("student-settings-and-alerts", "Settings and alerts")],
        ],
      },
      {
        title: "Schedule",
        steps: [
          ["Tap <strong>Schedule</strong>. It opens a window with your week. Slide it sideways to see every class.", "student-panel-schedule.webp", "Periods with times, Monday to Friday."],
          "Tap the <strong>X</strong> to close it.",
        ],
      },
      {
        title: "Requests and Bus reports",
        steps: [
          ["<strong>Requests</strong> lists forms your school wants you to fill in. It says <em>You're all caught up</em> when there is nothing."],
          ["<strong>Bus reports</strong> shows notes from the driver the school shared with your family, only while your class shares the bus with students."],
        ],
      },
    ],
    faq: [
      ["I didn't get the email.", "Check spam. Ask the school office to check your email and send it again."],
      ["Can I see other students' grades?", "No. You only ever see your own."],
      ["Why is my GPA hidden?", "It hides itself each time you open the page. Tap the eye to show it."],
    ],
    related: ["student-testing-room", "student-results", "student-calendar-and-activities", "student-bus-and-teachers"],
  },
  {
    slug: "student-testing-room",
    title: "Take a test in the Testing Room",
    topic: "Student portal",
    order: 2,
    summary: "Open a test, start it, answer every kind of question, and send it in. Your answers save as you go.",
    tags: ["testing room", "take a test", "online test", "student portal", "open book", "closed book", "locked", "submit"],
    who: "Students.",
    intro: "Your teacher can put a test in the Testing Room. You take it on your phone or computer.",
    sections: [
      {
        title: "Find your tests",
        steps: [
          ["On your home page, tap <strong>Testing Room</strong>. A red number on the tile is how many tests you can take."],
          ["<strong>Available</strong> lists tests you can take now. Each shows the subject, how many questions, points, time and whether it is <strong>Open book</strong> or <strong>Closed book</strong>. A due date shows if there is one.", "student-testing-room.webp", "Final Exam is closed book. Map Skills Quiz is open book."],
          "<strong>Locked</strong> is a closed-book test you left before you sent it. Ask your teacher to unlock it.",
          ["<strong>Completed</strong> is finished tests. They say <em>Awaiting grade</em> until your teacher posts the grade."],
        ],
      },
      {
        title: "Start the test",
        steps: [
          ["Tap <strong>Start</strong> under the test. A card shows <strong>Questions</strong>, <strong>Points</strong>, <strong>Time</strong> and which <strong>Attempt</strong> this is.", "student-test-intro.webp", "Check it, then tap Start test."],
          "Read the line under the numbers. Open book means you can use the files your teacher added. Closed book is explained below.",
          "Tap <strong>Start test</strong>. The clock starts if the test has a time.",
        ],
      },
      {
        title: "Answer the questions",
        steps: [
          ["The top shows the timer, <strong>Submit</strong> and <strong>Exit</strong>. Under it, numbers jump to a question. They fill in as you answer."],
          ["Scroll to answer each question. For a picture, type what each number shows in its box."],
          "Your answers save as you go. You do not need to save.",
        ],
        table: [
          ["Question", "How to answer"],
          ["Choose one, True or False", "Tap one."],
          ["Choose several", "Tap every right answer."],
          ["Short answer", "Type a word or a few words."],
          ["Label a picture", "Type what each number shows."],
          ["Essay", "Write your answer. Your teacher marks it."],
        ],
        tip: "Tap <strong>Help for this question</strong> where it shows for a hint from your teacher.",
      },
      {
        title: "Send it in",
        steps: [
          "Tap <strong>Submit</strong> at the top when you are done.",
          "Managira tells you how many questions have no answer. Go back to fill them, or confirm to send.",
          "The test moves to <strong>Completed</strong>. See " + link("student-results", "Grades and results") + ".",
        ],
        warning: "With a time limit, the test sends itself when time runs out. Answers that arrive long after the time ends don't count. The ones saved in time do.",
      },
      {
        title: "Open book and closed book",
        list: [
          "<strong>Open book</strong>: files your teacher attached open beside the questions. On a phone, switch between <strong>Questions</strong> and <strong>Resources</strong>. You can tap <strong>Exit</strong> and come back later with <strong>Resume</strong>.",
          "<strong>Closed book</strong>: stay on the test until you send it. Switching to another tab or app locks the test. Ask your teacher to unlock it. Copy and paste shortcuts are off.",
          "A test may allow more than one go. It says <em>2 of 2 attempts left</em>.",
        ],
      },
    ],
    faq: [
      ["I left a test by mistake.", "If it was open book, tap <strong>Resume</strong>. If it was closed book it is locked: ask your teacher."],
      ["The test isn't there.", "Your teacher hasn't given it to you yet, or its time is over."],
    ],
    related: ["student-results", "student-portal", "assessment-questions-and-online-tests"],
  },
  {
    slug: "student-results",
    title: "Grades and results",
    topic: "Student portal",
    order: 3,
    summary: "See your marks for each subject, your GPA, and your finished tests once your teacher posts them.",
    tags: ["grades", "results", "gpa", "review answers", "student portal", "marks"],
    who: "Students.",
    intro: "Your teacher posts grades when they are checked. Until then they wait.",
    sections: [
      {
        title: "Your grades",
        steps: [
          ["On your home page, tap <strong>Grades</strong>.", "student-panel-grades.webp", "Each subject with your marks. Slide to see every column."],
          "<strong>GPA this term</strong> shows at the top where your school shares it.",
          "A dash means no mark yet. A mark appears when your teacher posts it. A subject's total waits too, so it never counts a mark you can't see.",
        ],
      },
      {
        title: "Your GPA",
        steps: [
          ["On the home page, tap the eye on the <strong>GPA</strong> card to show it. Tap again to hide it."],
        ],
        note: "It shows only where your school shares GPA with your class. See " + link("gpa-on-report-cards-and-transcripts", "GPA") + ".",
      },
      {
        title: "After a test",
        list: [
          "Your test moves to <strong>Completed</strong> in the Testing Room and says <em>Awaiting grade</em>.",
          "When your teacher posts it, the grade shows there and in <strong>Grades</strong>.",
          "If your teacher shares answers, tap <strong>See your answers</strong>. You see each question, your answer, the right one and your marks.",
        ],
      },
    ],
    faq: [["My test says Awaiting grade for days.", "Your teacher hasn't posted it. Ask them."]],
    related: ["student-testing-room", "student-portal", "student-forms-and-portfolio"],
  },
  {
    slug: "student-calendar-and-activities",
    title: "Your calendar and activities",
    topic: "Student portal",
    order: 4,
    summary: "See your classes, events, clubs and trips, and add them to your phone's calendar.",
    tags: ["calendar", "activities", "events", "clubs", "student portal", "schedule"],
    who: "Students.",
    intro: "One calendar shows your classes and what's happening at school.",
    sections: [
      {
        title: "Calendar",
        steps: [
          ["On your home page, tap <strong>Calendar</strong>.", "student-calendar.webp", "Pick the calendars, then see Coming up."],
          "Under <strong>My calendars</strong>, check or uncheck <strong>School events</strong>, <strong>Activities</strong>, <strong>Classes</strong> and <strong>Due</strong>.",
          "<strong>Coming up</strong> lists what is next. Below it, pick <strong>Month</strong>, <strong>Week</strong>, <strong>Day</strong> or <strong>Agenda</strong>.",
        ],
        tip: "Tap <strong>Sync</strong> to see it on your phone's calendar. See " + link("calendar-sync-google-outlook-apple", "Calendar sync") + ".",
      },
      {
        title: "Activities",
        steps: [
          ["Tap <strong>Activities</strong> on your home page. A number on the tile is how many are new."],
          "Each card shows the date, time, place and who it is for, such as <em>Whole school</em> or <em>Just for you</em>.",
          ["The same list is in a small window on your home page."],
        ],
        note: "Learn how the school sets them up in " + link("activities", "Activities") + ".",
      },
    ],
    related: ["student-portal", "activities", "calendar-sync-google-outlook-apple"],
  },
  {
    slug: "student-bus-and-teachers",
    title: "Your bus and your teachers",
    topic: "Student portal",
    order: 5,
    summary: "See your bus and stop, watch it on the map, and find your teachers and their email.",
    tags: ["bus", "track my bus", "teachers", "student portal", "transportation"],
    who: "Students.",
    intro: "Two small windows on your home page: <strong>Bus</strong> and <strong>Teachers</strong>.",
    sections: [
      {
        title: "Teachers",
        steps: [
          ["Tap <strong>Teachers</strong>.", "student-panel-teachers.webp", "Your teachers, with their role, subject and email."],
          "Tap a teacher's email to write to them. The school decides whether the email shows.",
        ],
      },
      {
        title: "Bus",
        steps: [
          ["Tap <strong>Bus</strong>. You see your bus, route, stop and pick-up time."],
          ["Tap <strong>Track my bus</strong>. A map shows where it is and how long until your stop."],
        ],
        note: "The Bus tile shows only if you ride the bus and your class shares it with students. See " + link("live-bus-tracking", "Live bus tracking") + ". Your parents tell the driver when you are not riding."
      },
    ],
    related: ["student-portal", "live-bus-tracking"],
  },
  {
    slug: "student-forms-and-portfolio",
    title: "Forms and your portfolio",
    topic: "Student portal",
    order: 6,
    summary: "Fill in forms your school asks for, and see your marks, files and report card term by term.",
    tags: ["forms", "portfolio", "report card", "student files", "consistency", "student portal"],
    who: "Students.",
    intro: "<strong>Forms</strong> is for things the school wants you to fill in. <strong>Portfolio</strong> shows how you are doing.",
    sections: [
      {
        title: "Forms",
        steps: [
          ["Tap <strong>Forms</strong>. A red number means a form is waiting.", "student-forms.webp", "No forms right now. When there is one it shows here."],
          "Open a form, answer the questions and tap <strong>Send</strong>. Required questions have a red star.",
          "Forms you have already sent move out of the waiting list.",
        ],
        note: "Forms waiting also show in the <strong>Requests</strong> tab on your home page.",
      },
      {
        title: "Portfolio",
        steps: [
          ["Tap <strong>Portfolio</strong>. <strong>Student files</strong> shows papers the school shared with you."],
          "Pick a term. You see your <strong>Average</strong>, how steady you are, your <strong>Marked work</strong> and your <strong>Report card</strong> once it is posted.",
          "<strong>Consistency</strong> says <em>Steady</em>, <em>Mostly steady</em> or <em>Up and down</em>. It looks at how much your marks change.",
          "<strong>Subjects</strong> shows each subject's percentage. Tap one to see its work.",
        ],
        note: "Your school decides whether files and the portfolio show for your class.",
      },
    ],
    related: ["student-portal", "student-results"],
  },
  {
    slug: "student-settings-and-alerts",
    title: "Settings and alerts",
    topic: "Student portal",
    order: 7,
    summary: "Change how Managira looks and choose which news you get, by email or in your weekly briefing.",
    tags: ["settings", "appearance", "dark mode", "alerts", "notifications", "student portal", "bell"],
    who: "Students.",
    intro: "<strong>Settings</strong> is just for you.",
    sections: [
      {
        title: "Appearance",
        steps: [
          ["Tap <strong>Settings</strong> on your home page. Choose <strong>Light</strong>, <strong>Classic</strong> or <strong>Dark</strong>.", "student-settings.webp", "Three looks, then Notifications."],
        ],
      },
      {
        title: "Notifications",
        steps: [
          "Under <strong>Notifications</strong>, each alert has switches for <strong>Email</strong> and <strong>Weekly briefing</strong>.",
          "<strong>Needs improvement</strong> and <strong>Happy news</strong> use a percentage. Type the number you want.",
          "<strong>Bus is about to arrive</strong> and <strong>Bus has arrived</strong> show only if you ride the bus. They start off.",
          "Tap <strong>Save notifications</strong>.",
        ],
        note: "Your school decides what you can set up. A row marked <em>Set by your school</em> is locked. See " + link("notifications-and-alerts", "Your notifications and alerts") + ".",
      },
      {
        title: "The bell",
        text: "The bell at the top shows tests you can take now or in the next two weeks, new grades, the start or end of the term that week, and your birthday.",
      },
    ],
    related: ["student-portal", "notifications-and-alerts"],
  },
];
