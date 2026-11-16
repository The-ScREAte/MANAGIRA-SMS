"use strict";

// Classroom & attendance: the class page and daily attendance.
module.exports = [
  {
    slug: "class-page",
    title: "Your class page: every tab explained",
    topic: "Classroom & attendance",
    order: 1,
    summary: "A tour of every class page tab: attendance, grading, assessment questions, schedule, activities, pickup, forms, messages, transportation, documents and PayGira.",
    tags: ["class page", "classroom", "class dashboard", "teachers", "class tools", "pickup list", "my paygira"],
    featured: true,
    who: "Teachers for their own classes; managers and supervisors for every class.",
    intro: "Select a class on your dashboard to open its page. <strong>Class Tools</strong> on the left opens each tool as a tab, so you can keep several open and switch between them.",
    sections: [
      {
        title: "Class Room",
        text: [
          "Every student in the class. Select a student to see their details, parents, grades and attendance.",
          "If your school has remarks in the Custom editor, a form set to show beside each student, such as Report card remarks, has its icon beside every student: grey until it's filled in for this term, then your school's color. Tap it to open that student's form. The remark pencil then asks only for remarks no form covers, and goes away once forms cover them all. See <a href=\"/legal/user-documentation/custom-editor\">Custom editor</a>.",
        ],
        image: "class-page.webp",
        caption: "Class Room: the class at a glance, with Class Tools on the left.",
      },
      {
        title: "Attendance",
        text: "Mark attendance, and lunch if your school uses it, for the last few school days in a few taps, and look back over past days. See <a href=\"/legal/user-documentation/mark-attendance-for-a-class\">Take attendance</a>.",
        image: "attendance.webp",
        caption: "Attendance: one row per student.",
      },
      {
        title: "Grading",
        text: "Open <strong>Grading</strong> and choose a subject to enter scores in its score sheet. Totals, grades and positions are worked out for you. See <a href=\"/legal/user-documentation/grading-or-marking-assessment\">Enter and review scores</a>.",
        image: "grading-sheet.webp",
        caption: "A subject's score sheet: one column per assessment, with totals, grade and position.",
      },
      {
        title: "Assessment Questions",
        text: "Write the questions for online tests that students take in the Testing Room. See <a href=\"/legal/user-documentation/assessment-questions-and-online-tests\">Assessment questions and online tests</a>.",
        image: "assessment-questions.webp",
        caption: "Assessment Questions: the class's question sets.",
      },
      {
        title: "Class Schedule",
        text: "The class timetable by day and period.",
        image: "class-schedule.webp",
        caption: "Class Schedule: the week at a glance.",
      },
      {
        title: "Activities",
        text: "Field trips, clubs and events for the class or one student, with an optional reminder to families. See <a href=\"/legal/user-documentation/activities\">Activities</a>.",
        image: "class-activities.webp",
        caption: "Activities for this class.",
      },
      {
        title: "Pickup list",
        text: "Who may pick up each student, from the details your school shares with teachers. See <a href=\"/legal/user-documentation/emergency-and-pickup-details\">Emergency &amp; pickup details</a>.",
        image: "class-pickup-list.webp",
        caption: "Pickup list: who may collect each student.",
      },
      {
        title: "Forms",
        text: "The forms your school built for this class: fill them in for each student, and read what parents and students sent. A form your school gave its own place, such as a seating chart, has its own item in Class Tools. See <a href=\"/legal/user-documentation/custom-editor\">Custom editor</a>.",
        image: "class-forms.webp",
        caption: "Forms: each student and whether the form is done.",
      },
      {
        title: "Parent Messages",
        text: "Messages from the class's parents, and your replies, in one place.",
        image: "class-messages.webp",
        caption: "Parent Messages for this class.",
      },
      {
        title: "Transportation",
        text: "Which students ride which bus, the live bus on its route, and class bus reports. Mark a student as not riding today from here.",
        image: "class-transportation.webp",
        caption: "Transportation: each student's bus and stop, and the live bus.",
      },
      {
        title: "Docs & Sheets",
        text: "Documents and spreadsheets attached to the class. See <a href=\"/legal/user-documentation/docs-and-sheets\">Docs and sheets</a>.",
        image: "class-docs.webp",
        caption: "The class's documents and sheets.",
      },
      {
        title: "My PayGira",
        text: "If you collect payments, the bills assigned to you appear here. Select <strong>Collect</strong> beside a student to record a payment; a receipt is sent automatically. See <a href=\"/legal/user-documentation/set-up-paygira-bills-collections-and-guardian-payments\">PayGira</a>.",
        image: "class-paygira.webp",
        caption: "My PayGira: bills you collect, with what's collected and outstanding.",
      },
      {
        title: "Lunch and what parents and students see",
        text: "If your school has Class settings, choose whether the class takes lunch and who sees its attendance, lunch, report cards and bus: parents, students or both. It opens on the right, beside the class. See <a href=\"/legal/user-documentation/class-settings\">Class settings</a>.",
      },
    ],
    faq: [
      ["Why don't I see all of these tabs?", "Some need a permission or a feature your school turns on, such as Transportation or PayGira. Ask a manager."],
      ["Can I change the order of the tools?", "Yes. Select the arrows icon at the top of Class Tools and drag them into your order."],
    ],
    related: ["mark-attendance-for-a-class", "class-settings", "grading-or-marking-assessment", "activities", "emergency-and-pickup-details", "custom-editor"],
  },
  {
    slug: "mark-attendance-for-a-class",
    title: "Take attendance",
    topic: "Classroom & attendance",
    order: 2,
    summary: "Mark attendance and lunch in a few taps, check the whole class at once, and edit a past day. Weekends and holidays are skipped for you.",
    tags: ["attendance", "take attendance", "absent", "present", "daily attendance", "had lunch", "check all", "edit attendance", "overall attendance"],
    featured: true,
    who: "A class's <strong>main teacher</strong> and <strong>assistant teachers</strong>, and managers and supervisors given <strong>Mark Attendance</strong>.",
    intro: "The class's Attendance opens on the last 3 days, with today always the far-right column. Weekends and holidays show greyed, so on a Sunday that's Friday, Saturday and today; a school that hides them (Settings, School rules) sees the last 3 school days instead. One column per day and one row per student. A saved day stays locked until you select Edit, so its marks never change by accident.",
    sections: [
      {
        title: "Mark a day's attendance",
        steps: [
          ["On your dashboard, open the class and choose <strong>Attendance</strong> in Class Tools.", "attendance.webp", "A class's Attendance: one row per student, one tap each."],
          "Find the day's column. A day nobody has marked yet opens for editing at your first tap; for a day already saved, select <strong>Edit</strong> (the pencil) under the date.",
          "Tick each student who is present. <strong>Check all</strong> marks everyone present (and, where lunch is taken, everyone had lunch); then change the few who are different.",
          "Select <strong>Save</strong> (the tick). <strong>Cancel</strong> (the cross) puts the day back as it was.",
        ],
        tip: "Check all first, then tap the two or three who are absent. On a normal day it takes seconds.",
        note: "Once saved, present shows as a tick and absent as a dash.",
      },
      {
        title: "Take lunch",
        text: "If your school takes lunch, a plate sits beside each student's checkbox, so you take lunch as you take attendance.",
        list: [
          "Tap the plate when a student had lunch. It's grey until you tap it, then turns your school's color.",
          "Lunch saves with the day's attendance, by the same <strong>Save</strong>.",
          "Lunch is recorded only on days someone takes it. A day you leave the plates alone counts as not recorded, not as no lunch.",
          "A small count under the date shows how many students had lunch that day.",
        ],
        note: "A class that doesn't need lunch can turn it off in <a href=\"/legal/user-documentation/class-settings\">Class settings</a>.",
      },
      {
        title: "See other days and change a past day",
        steps: [
          "Select <strong>Filters</strong> to choose which days show, from the last school day to the whole term, or one date. Your choice is remembered next time.",
          "Select <strong>Edit</strong> under the day, change the marks, and select <strong>Save</strong>. Parents see the corrected attendance straight away.",
        ],
      },
      {
        title: "Read each student's totals",
        list: [
          "The <strong>Overall</strong> column shows each student's days present for the term. Where lunch is taken, days with lunch sit beside them.",
          "The <strong>Summary</strong> under the list counts the class's days present and days absent, with <strong>Had lunch</strong> beside them where lunch is taken.",
        ],
      },
      {
        title: "Weekends, holidays and closures",
        text: "Days your school calendar marks as weekends, public holidays or days off don't count for attendance: they show greyed, or not at all if your school hides them. Set them in <strong>Settings</strong>, <strong>Customize School</strong>, <strong>School calendar</strong>. See <a href=\"/legal/user-documentation/customize-your-school\">Customize your school</a>.",
      },
      {
        title: "Your school's own columns",
        text: "A column beside the names that your school built, such as a behavior check, comes from the <a href=\"/legal/user-documentation/custom-editor\">Custom editor</a>: choose each student's answer for today and it saves by itself. Where lunch is taken with the plate, a lunch column of your own isn't shown twice.",
      },
    ],
    faq: [
      ["Why can't I change a saved day?", "A saved day is locked until you select <strong>Edit</strong> (the pencil) under its date."],
      ["Do parents and students see attendance and lunch?", "Yes, in their portals, unless the class's settings don't share it with them. See <a href=\"/legal/user-documentation/class-settings\">Class settings</a>."],
      ["I don't see the lunch plates.", "Your school doesn't take lunch yet, or lunch is turned off for this class in Class settings."],
      ["Can I report on attendance and lunch?", "Use <a href=\"/legal/user-documentation/report-builder\">Report Builder</a> for attendance and lunch by class, student or date range, and export it."],
    ],
    related: ["class-page", "class-settings", "report-builder", "customize-your-school"],
  },
  {
    slug: "class-settings",
    title: "Class settings",
    topic: "Classroom & attendance",
    order: 3,
    summary: "Class settings turn lunch on or off for a class and choose who sees its attendance, lunch, report cards and bus: parents, students or both.",
    tags: ["class settings", "lunch", "turn off lunch", "share with", "parents see", "what parents see", "what students see", "hide from parents", "hide from students", "every class"],
    who: "Staff given <strong>Class Settings</strong>, for the classes they lead as main or assistant teacher (teachers have it by default). With its follow-up <strong>Every Class</strong>, every class, from Management (managers have it).",
    intro: "If your school has Class settings, each class chooses whether it takes lunch, and who sees its attendance, lunch, report cards and bus in their portal. Everything is on, for parents and students, until someone turns it off.",
    sections: [
      {
        title: "Change lunch and who sees what for a class",
        steps: [
          "Open the class from your dashboard, then <strong>Class settings</strong> in Class Tools. It opens on the right.",
          "Under <strong>This class</strong>, turn <strong>Take lunch</strong> on or off. When it's on, a plate sits beside each student's checkbox on the attendance page; see <a href=\"/legal/user-documentation/mark-attendance-for-a-class\">Take attendance</a>.",
          "Under <strong>Share with</strong>, tick or untick <strong>Parents</strong> and <strong>Students</strong> for each item. Each change saves straight away.",
        ],
        table: [
          ["Share with", "What parents or students see when it's ticked"],
          ["<strong>Attendance</strong>", "Daily attendance and overall attendance."],
          ["<strong>Lunch</strong>", "Lunch days and overall lunch."],
          ["<strong>Report cards</strong>", "Report cards, as soon as they're published. Parents also get the report card notice and email."],
          ["<strong>GPA</strong>", "This term's GPA and the cumulative GPA over finished terms, from letter grades. See <a href=\"/legal/user-documentation/gpa-on-report-cards-and-transcripts\">GPA on report cards and transcripts</a>."],
          ["<strong>Bus &amp; transport</strong>", "The bus tracker, boarding, and driver reports shared about the student."],
        ],
        note: "Unticking a box hides that item from that class's parents or students only; staff still see everything. Turning lunch off doesn't remove lunch already taken: it stays in reports.",
      },
      {
        title: "Change many classes at once",
        steps: [
          "Open <strong>Management</strong>, then <strong>Class settings</strong>. Each class has a row, with a <strong>Parents</strong> and a <strong>Students</strong> box under each item.",
          "Tick or untick a class's boxes, or use the <strong>All classes</strong> row to set a box for every class at once. A dash there means the classes differ.",
        ],
        note: "Changes save straight away.",
      },
      {
        title: "See the school's attendance calendar",
        text: "Class settings shows the term's school calendar: weekends, public holidays and the days off coming up, which attendance and lunch skip. The calendar is the same for the whole school and is changed in Settings: staff allowed to change it see <strong>Change in Settings</strong>. See <a href=\"/legal/user-documentation/customize-your-school\">Customize your school</a>.",
      },
      {
        title: "Who can change these settings",
        table: [
          ["Permission", "Lets them"],
          ["<strong>Class Settings</strong>", "Change the settings of the classes they lead, as main or assistant teacher, from the class. Teachers have it by default."],
          ["<strong>Every Class</strong> (with Class Settings)", "Change every class's settings, in the class or in Management, Class settings. Managers have it."],
        ],
        note: "Without Class Settings, the page isn't shown. Give these on the staff form; see <a href=\"/legal/user-documentation/roles-and-permissions\">Roles and permissions</a>.",
      },
    ],
    faq: [
      ["How do I stop parents or students seeing attendance, lunch, report cards or the bus?", "Open the class's Class settings and, under <strong>Share with</strong>, untick <strong>Parents</strong> or <strong>Students</strong> for that item. Staff still see it."],
      ["A parent can't see their child's attendance or report cards.", "Check the child's class settings: the <strong>Parents</strong> box for that item may be unticked. For a student, check the <strong>Students</strong> box."],
      ["Can one class take lunch and another not?", "Yes. Take lunch is set for each class."],
      ["Can students see their report cards?", "Yes, in their Portfolio as soon as report cards are published, unless the class's <strong>Students</strong> box for report cards is unticked."],
      ["Why can't I change the calendar here?", "It's the same for the whole school, so it's changed in Settings by managers and staff given School Profile &amp; Branding. If you can, select <strong>Change in Settings</strong>."],
    ],
    related: ["mark-attendance-for-a-class", "class-page", "customize-your-school", "parent-portal", "student-portal", "roles-and-permissions"],
  },
  {
    slug: "docs-and-sheets",
    title: "Docs and sheets",
    topic: "Classroom & attendance",
    order: 4,
    summary: "Write letters and notes in Docs and keep tables and lists in Sheets, inside Managira: share them with colleagues or attach them to a class.",
    tags: ["documents", "spreadsheets", "docs", "sheets", "share", "class documents"],
    who: "Staff whose school's plan includes Docs &amp; Sheets. Managers and staff with <strong>Manage School Records</strong> manage the school's documents.",
    intro: "Docs &amp; Sheets keeps school paperwork next to the students it's about: permission letters, lesson notes, sign-up lists, seating charts. Nothing to download, and you choose exactly who can see each one.",
    sections: [
      {
        title: "Create a doc or sheet",
        steps: [
          ["Open <strong>Management</strong>, then <strong>Docs &amp; sheets</strong> (or <strong>Docs &amp; Sheets</strong> on a class page), and select <strong>New doc or sheet</strong>.", "documents.webp", "Docs & sheets: your school's documents and spreadsheets."],
          "Choose a <strong>Doc</strong> (letters, notes, report cards) or a <strong>Sheet</strong> (tables, lists), give it a name, and select <strong>Create</strong>.",
          "Write or fill it in. Changes save as you go.",
        ],
      },
      {
        title: "Share it",
        list: [
          "<strong>Share with a colleague</strong> so they can open it from their own Docs &amp; Sheets.",
          "<strong>Attach to a class</strong> so it shows under that class, for its teachers.",
          "Find documents with <strong>Search</strong>, or filter to <strong>This class</strong> or <strong>Personal</strong>.",
        ],
        tip: "Ask Mira: <em>Create a sheet of 6th Grade students with their parents' phone numbers and share it with the front office.</em>",
      },
      {
        title: "Make your own report card",
        text: "A Sheet or Doc can also be your school's report card layout, filled in for each student when report cards print. See <a href=\"/legal/user-documentation/report-card-templates\">Custom report card templates</a>.",
      },
    ],
    related: ["class-page", "report-card-templates", "mira-ai-capabilities"],
  },
];
