"use strict";

// Parent portal and student portal: everything families and students see and do, step by step.
// Where another guide already explains something (PayGira, the bus, pickup details, calendar
// sync), these link to it instead of repeating it.
const link = (slug, text) => `<a href="/legal/user-documentation/${slug}">${text}</a>`;

module.exports = [
  // ------------------------------------------------------------------ Parent portal
  {
    slug: "parent-portal",
    title: "The parent portal",
    topic: "Parent portal",
    order: 1,
    summary: "How parents sign in, what the home page shows, and where to find grades, tests, messages, bills, the bus and settings.",
    tags: ["parent portal", "parents", "sign in", "children", "dashboard"],
    featured: true,
    who: "Parents and guardians your school has invited.",
    intro: "The parent portal puts everything about a family's children in one place, on any phone or computer.",
    sections: [
      {
        title: "Give parents access (school staff)",
        steps: [
          "Make sure each parent has an email address on their record.",
          "Invite them from <strong>Management</strong>, <strong>Guardians</strong>: open the parent and choose <strong>Parent portal</strong>.",
          "Parents open the email, choose a password and sign in on your school's Managira sign-in page.",
        ],
        note: "Each parent has their own sign-in and sees the same children.",
      },
      {
        title: "The home page",
        image: "parent-portal.webp",
        caption: "A card for each child, with Track bus, Not coming and View.",
        list: [
          "<strong>My Children</strong>: a card for each child. <strong>View</strong> opens the child's page.",
          "<strong>Track bus</strong>, <strong>Not coming</strong> and <strong>Request bus</strong>, when the school uses Transportation. See " + link("live-bus-tracking", "Live bus tracking") + ".",
          "<strong>Requests</strong>: your bus requests and their answers. <strong>Bus reports</strong>: reports about your child the school shared.",
          "Your family details (emergency contacts, pickup), when the school shares them. See " + link("emergency-and-pickup-details", "Emergency &amp; pickup details") + ".",
          "The bell shows new grades, activities and other notices. The envelope opens <strong>Messages</strong>.",
        ],
      },
      {
        title: "Where to find things",
        table: [
          ["To…", "Open", "Guide"],
          ["See grades, attendance and report cards", "Child's page, <strong>Academic info</strong>", link("parent-grades-and-report-cards", "Grades and report cards")],
          ["See tests and results", "Child's page, <strong>Testing Room</strong>", link("parent-tests-and-results", "Tests and results")],
          ["Help with homework", "Child's page, <strong>Homework</strong>", link("parent-tiles-and-homework-help", "Your child's page")],
          ["Message the school", "Menu, <strong>Messages</strong>", link("parent-messages", "Messages")],
          ["Pay bills", "Menu, <strong>PayGira</strong>", link("set-up-paygira-bills-collections-and-guardian-payments", "PayGira")],
          ["Update emergency and pickup details", "Home page, your family details", link("emergency-and-pickup-details", "Emergency &amp; pickup details")],
          ["See activities and school dates", "Menu, <strong>Activities</strong> or <strong>Calendar</strong>", link("activities", "Activities") + ", " + link("calendar-sync-google-outlook-apple", "Calendar sync")],
          ["Change notices and your details", "Menu, <strong>Settings</strong>", link("parent-notifications-and-settings", "Notifications and settings")],
        ],
      },
    ],
    faq: [
      ["I see no children.", "The school hasn't linked you to a student yet. Ask the school office. (Staff: <strong>Management</strong>, <strong>Guardians</strong>, <strong>Relink student</strong>.)"],
      ["I forgot my password.", "Use <strong>Forgot password</strong> on the sign-in page. See " + link("reset-a-password-or-recover-account-access", "Reset your password") + "."],
    ],
    related: ["parent-tiles-and-homework-help", "parent-grades-and-report-cards", "parent-tests-and-results", "create-manage-parent"],
  },
  {
    slug: "parent-tiles-and-homework-help",
    title: "Your child's page",
    topic: "Parent portal",
    order: 2,
    summary: "A tile for each part of your child's school day: grades, schedule, calendar, activities, homework, tests, documents, bus and messages.",
    tags: ["child page", "tiles", "homework help", "parent portal"],
    who: "Parents see the tiles. Teachers choose what to share.",
    sections: [
      {
        title: "The tiles",
        text: "On the home page, select <strong>View</strong> on a child's card. A number on a tile means something new.",
        image: "parent-child-tiles.webp",
        caption: "A child's page: one tile for each part of the day.",
        table: [
          ["Tile", "Shows"],
          ["<strong>Academic info</strong>", "Grades, attendance, teachers and report cards. See " + link("parent-grades-and-report-cards", "Grades and report cards") + "."],
          ["<strong>Schedule</strong>", "The class timetable for each day."],
          ["<strong>Calendar</strong>", "Classes, activities and school events together."],
          ["<strong>Activities</strong>", "Trips, clubs and events coming up, and past ones."],
          ["<strong>Homework</strong>", "Homework the teacher shared, with notes and files."],
          ["<strong>Testing Room</strong>", "Tests open now and finished results. See " + link("parent-tests-and-results", "Tests and results") + "."],
          ["<strong>Documents &amp; results</strong>", "Shared test results and the files teachers attached."],
          ["<strong>Transportation</strong>", "The bus and its stops. See " + link("live-bus-tracking", "Live bus tracking") + "."],
          ["<strong>Messages</strong>", "Your conversations about this child. See " + link("parent-messages", "Messages") + "."],
        ],
      },
      {
        title: "Homework help",
        list: [
          "When a teacher turns on <strong>Show on parent portal</strong> for a set of questions, it appears with the teacher's notes: homework and assignments under <strong>Homework</strong>, tests under <strong>Testing Room</strong>.",
          "Files the teacher attached (study guides, worked examples) are under <strong>Documents &amp; results</strong>.",
        ],
        note: "You only ever see what your child can already see.",
      },
    ],
    related: ["parent-portal", "parent-tests-and-results", "assessment-questions-and-online-tests"],
  },
  {
    slug: "parent-grades-and-report-cards",
    title: "Grades and report cards",
    topic: "Parent portal",
    order: 3,
    summary: "See your child's grades for each subject, attendance, teachers and report cards. New grades show once the teacher posts them.",
    tags: ["grades", "report cards", "attendance", "academic info", "parent portal"],
    who: "Parents and guardians.",
    sections: [
      {
        title: "Academic info",
        steps: [
          ["On your child's page, open <strong>Academic info</strong>. Choose the term at the top.", "parent-grades.webp", "Academic info: teachers, schedule, attendance and grades for the term."],
          "<strong>Teaching Staff</strong> and <strong>Class Schedule</strong> open with a tap.",
          "<strong>Attendance Summary</strong>: school days, days present and absent, and the attendance rate.",
          "<strong>Current Term Performance</strong>: each subject's assessments, total and grade.",
        ],
        note: "A grade shows once the teacher posts it. While a subject has a grade waiting, its total waits too, so a total never counts a grade you can't see.",
      },
      {
        title: "Report cards",
        steps: [
          ["Select <strong>Report Card</strong> at the top of Academic info. Each report card the school posted is listed; select <strong>Open PDF</strong>.", "parent-report-cards.webp", "Posted report cards, ready to open."],
        ],
      },
    ],
    faq: [
      ["A grade is missing.", "The teacher hasn't posted it yet. You'll get a notice when they do."],
      ["Can I see last term?", "Yes: choose it in <strong>Academic period</strong>."],
    ],
    related: ["parent-portal", "parent-tests-and-results", "report-card"],
  },
  {
    slug: "parent-tests-and-results",
    title: "Tests and results",
    topic: "Parent portal",
    order: 4,
    summary: "See the tests your child can take, their finished results once posted, and the questions and answers when the teacher shares them.",
    tags: ["testing room", "test results", "review answers", "parent portal", "documents"],
    who: "Parents and guardians.",
    sections: [
      {
        title: "Testing Room",
        steps: [
          ["On your child's page, open <strong>Testing Room</strong>. At the top: tests open now that the teacher shared. Under <strong>Finished</strong>: results the teacher posted, with the grade.", "parent-testing-room.webp", "Open tests and finished results, with the grade."],
          ["Select a finished test to see the questions, your child's answers and the right answers, when the teacher shares them.", "parent-test-review.webp", "A finished test: the grade, each question, your child's answer and the right one."],
        ],
      },
      {
        title: "Documents & results",
        image: "parent-documents.webp",
        caption: "Test results and the files teachers attached, in one place.",
        text: "Every shared result and the files teachers attached stay here for the term.",
      },
      {
        title: "What you see, and when",
        table: [
          ["The teacher shares", "You see"],
          ["Nothing", "No result here; the grade still shows in Academic info once posted."],
          ["The grade", "The test and its grade."],
          ["Grade and answers", "The grade, every question, your child's answer and the right one."],
        ],
        note: "Results show only after the teacher posts the grade. You get a notice when they do.",
      },
    ],
    related: ["parent-tiles-and-homework-help", "parent-grades-and-report-cards", "assessment-questions-and-online-tests"],
  },
  {
    slug: "parent-messages",
    title: "Messages",
    topic: "Parent portal",
    order: 5,
    summary: "Send the school a message about your child, copy in their teachers, and follow each conversation in one place.",
    tags: ["messages", "contact teacher", "parent portal", "inbox"],
    who: "Parents and guardians.",
    sections: [
      {
        title: "Send a message",
        steps: [
          ["Open <strong>Messages</strong> from the menu (or the envelope on the home page), then <strong>+ New message</strong>.", "parent-messages.webp", "Messages: your conversations with the school."],
          "Choose the child, add a subject and priority, and write your message. To copy a teacher in, tick them under <strong>CC Staff Members</strong>. Send it.",
          "Replies show in the conversation, and the bell tells you.",
        ],
        tip: "Use <strong>Search &amp; Filter</strong> to find an older conversation.",
      },
    ],
    related: ["parent-portal", "mailroom-send-sms-whatsapp-and-email-to-guardians"],
  },
  {
    slug: "parent-notifications-and-settings",
    title: "Notifications and settings",
    topic: "Parent portal",
    order: 6,
    summary: "What the bell tells you, and how to change the look, your photo, your details, email notices and saved cards.",
    tags: ["notifications", "settings", "email notifications", "parent portal", "appearance"],
    who: "Parents and guardians.",
    sections: [
      {
        title: "The bell",
        list: [
          "<strong>New grade</strong>: a teacher posted a grade for your child.",
          "<strong>New activity</strong>: a trip, club or event was added.",
          "Bus, payment and message notices, when your school uses them.",
          "Tap a notice to open it. <strong>Mark all read</strong> and <strong>Clear all</strong> are at the top.",
        ],
      },
      {
        title: "Settings",
        image: "parent-settings.webp",
        caption: "Settings: appearance, profile, email notices and saved cards.",
        table: [
          ["Section", "What you can do"],
          ["<strong>Appearance</strong>", "Light, Classic or Dark."],
          ["<strong>Profile Settings</strong>", "Your photo, your children's photos and your details."],
          ["<strong>Email Notifications</strong>", "Choose which emails you get about your children. Security and admission emails always come."],
          ["<strong>PayGira Cards &amp; Billing</strong>", "Saved cards for paying school bills. See " + link("set-up-paygira-bills-collections-and-guardian-payments", "PayGira") + "."],
        ],
      },
    ],
    related: ["parent-portal", "emergency-and-pickup-details"],
  },

  // ------------------------------------------------------------------ Student portal
  {
    slug: "student-portal",
    title: "The student portal",
    topic: "Student portal",
    order: 1,
    summary: "How students get access and sign in, and what they see: classes, schedule, grades, tests, calendar and the bus.",
    tags: ["student portal", "students", "sign in", "testing room"],
    featured: true,
    who: "Students, once your school turns on <strong>Student Portal</strong> in Integrations and invites them.",
    sections: [
      {
        title: "Give students access (school staff)",
        steps: [
          "Turn on <strong>Student Portal</strong> in <strong>Management</strong>, <strong>Integrations</strong>.",
          "Make sure each student has an email address.",
          "Send invites: tick students in <strong>Admissions</strong>, <strong>All Students</strong> and choose <strong>Send Password Invite</strong>.",
          "Students open the email, choose a password and sign in.",
        ],
      },
      {
        title: "What students see",
        text: "The dashboard shows the student's class, attendance this term and how many tests are open, then a tile for each area.",
        image: "student-portal.webp",
        caption: "The student dashboard: attendance, open tests and a tile for each area.",
        table: [
          ["Tile", "Shows", "Guide"],
          ["<strong>Schedule</strong>", "Classes for each day of the week.", ""],
          ["<strong>Calendar</strong> and <strong>Activities</strong>", "Classes, activities and school events.", link("student-calendar-and-activities", "Calendar and activities")],
          ["<strong>Grades</strong>", "Each subject's posted grades.", ""],
          ["<strong>Subject Teachers</strong>", "Who teaches each subject.", ""],
          ["<strong>Transportation</strong>", "Your bus and stop, if your school uses it.", link("live-bus-tracking", "Live bus tracking")],
          ["<strong>Testing Room</strong>", "Tests to take, and finished ones with the grade.", link("student-testing-room", "Take a test") + ", " + link("student-results", "Your results")],
        ],
        note: "<strong>Settings</strong> (in the menu) sets Light, Classic or Dark.",
      },
    ],
    faq: [
      ["A student didn't get the invite.", "Check their email in Admissions, All Students (Edit Student Emails), then send the invite again. Ask them to check spam."],
      ["Can students see other students' grades?", "No. Students only ever see their own."],
    ],
    related: ["student-testing-room", "student-results", "find-students"],
  },
  {
    slug: "student-testing-room",
    title: "Take a test",
    topic: "Student portal",
    order: 2,
    summary: "Start a test, answer every kind of question (pictures too) and submit. Answers save as you go; open-book files sit beside the questions.",
    tags: ["testing room", "take a test", "online test", "student portal", "open book", "closed book"],
    who: "Students.",
    sections: [
      {
        title: "Open the Testing Room",
        image: "student-testing-room.webp",
        caption: "Tests you can take now, each with its questions, points, time and mode.",
        text: "Open <strong>Testing Room</strong> from the menu or the dashboard.",
        list: [
          "<strong>Available</strong>: tests you can take now, with the subject, questions, points, time limit, open or closed book, and when it's due.",
          "<strong>Locked</strong>: a closed-book test you left before submitting. Ask your teacher to unlock it.",
          "<strong>Completed</strong>: finished tests, with the grade once your teacher posts it.",
        ],
      },
      {
        title: "Take it",
        steps: [
          "Select <strong>Start</strong>, check the questions, points, time and attempt, then select <strong>Start test</strong>.",
          ["Answer each question. The numbers at the top jump to a question and fill in as you answer; the timer and <strong>Submit</strong> stay at the top. For a picture, type what each number shows in its box.", "student-take-test.webp", "The timer and Submit at the top, and numbers to jump between questions."],
          "Select <strong>Submit</strong> when you're done. Managira tells you how many questions have no answer before you confirm.",
        ],
        table: [
          ["Question", "How to answer"],
          ["Choose one / True or False", "Pick one."],
          ["Choose several", "Pick every right answer."],
          ["Short answer", "Type a word or phrase."],
          ["Label a picture", "Type what each number shows."],
          ["Essay", "Write your answer; your teacher marks it."],
        ],
      },
      {
        title: "Good to know",
        list: [
          "Your answers save as you go.",
          "<strong>Closed book</strong>: stay on the test page until you submit. Switching to another tab or app locks the test; ask your teacher to unlock it.",
          "<strong>Open book</strong>: files your teacher attached open on the left, beside the questions (on a phone, switch between <strong>Questions</strong> and <strong>Resources</strong>). You can select <strong>Exit</strong> and come back later with <strong>Resume</strong>.",
          "With a time limit, the test submits itself when time runs out. Answers sent long after that don't count; the ones saved in time do.",
        ],
      },
    ],
    related: ["student-results", "student-portal", "assessment-questions-and-online-tests"],
  },
  {
    slug: "student-results",
    title: "Your results",
    topic: "Student portal",
    order: 3,
    summary: "See your grade once your teacher posts it, and your answers next to the right ones when your teacher shares them.",
    tags: ["results", "grades", "review answers", "student portal"],
    who: "Students.",
    sections: [
      {
        title: "After you submit",
        list: [
          "Your test moves to <strong>Completed</strong>, marked <em>Awaiting grade</em> until your teacher posts it.",
          "When your teacher posts it, the grade shows there and under <strong>Grades</strong> on your dashboard.",
        ],
      },
      {
        title: "See your answers",
        steps: [
          ["When your teacher shares answers, select <strong>See your answers</strong>. Each question shows your answer, the right one and your marks.", "student-test-result.webp", "Your test: grade, answers and marks."],
        ],
      },
    ],
    related: ["student-testing-room", "student-portal"],
  },
  {
    slug: "student-calendar-and-activities",
    title: "Calendar and activities",
    topic: "Student portal",
    order: 4,
    summary: "See your classes, activities and school events by day, and add them to your phone's calendar.",
    tags: ["calendar", "activities", "student portal", "schedule"],
    who: "Students.",
    sections: [
      {
        title: "Your calendar",
        image: "student-calendar.webp",
        caption: "The calendar: dots show days with something on; the day's classes and activities below.",
        list: [
          "Select a day to see its classes, activities and events.",
          "<strong>Activities</strong> lists what's coming up, including activities just for you.",
          "To see it on your phone's calendar, see " + link("calendar-sync-google-outlook-apple", "Calendar sync") + ".",
        ],
      },
    ],
    related: ["student-portal", "activities"],
  },
];
