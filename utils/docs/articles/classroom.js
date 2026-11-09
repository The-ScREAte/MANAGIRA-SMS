"use strict";

// Classroom & attendance: the class page and daily attendance.
module.exports = [
  {
    slug: "class-page",
    title: "Your class page: every tab explained",
    topic: "Classroom & attendance",
    order: 1,
    summary: "A tour of every class page tab: attendance, grading, assessment questions, schedule, activities, pickup, parent messages, transportation, documents and PayGira.",
    tags: ["class page", "classroom", "class dashboard", "teachers", "class tools", "pickup list", "my paygira"],
    featured: true,
    who: "Teachers for their own classes; managers and supervisors for every class.",
    intro: "Select a class on your dashboard to open its page. <strong>Class Tools</strong> on the left opens each tool as a tab, so you can keep several open and switch between them.",
    sections: [
      {
        title: "Class Room",
        text: "Every student in the class. Select a student to see their details, parents, grades and attendance.",
        image: "class-page.webp",
        caption: "Class Room: the class at a glance, with Class Tools on the left.",
      },
      {
        title: "Attendance",
        text: "Mark today's attendance in a few taps and look back over past days. See <a href=\"/legal/user-documentation/mark-attendance-for-a-class\">Take attendance</a>.",
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
    ],
    faq: [
      ["Why don't I see all of these tabs?", "Some need a permission or a feature your school turns on, such as Transportation or PayGira. Ask a manager."],
      ["Can I change the order of the tools?", "Yes. Select the arrows icon at the top of Class Tools and drag them into your order."],
    ],
    related: ["mark-attendance-for-a-class", "grading-or-marking-assessment", "activities", "emergency-and-pickup-details"],
  },
  {
    slug: "mark-attendance-for-a-class",
    title: "Take attendance",
    topic: "Classroom & attendance",
    order: 2,
    summary: "Mark each student present or absent in a few taps, mark the whole class at once, and fix a past day. Weekends and holidays are skipped for you.",
    tags: ["attendance", "take attendance", "absent", "present", "daily attendance"],
    featured: true,
    who: "Teachers for their own classes, and staff given <strong>Mark Attendance</strong>.",
    sections: [
      {
        title: "Mark today's attendance",
        steps: [
          ["On your dashboard, open the class and choose <strong>Attendance</strong> in Class Tools.", "attendance.webp", "A class's Attendance: one row per student, one tap each."],
          "Select today's date (or edit it).",
          "Mark each student <strong>present</strong> or <strong>absent</strong>. To save time, mark everyone at once, then change the few who are different.",
          "Select <strong>Save</strong>.",
        ],
        tip: "Mark everyone present first, then tap the two or three who are absent. On a normal day it takes seconds.",
      },
      {
        title: "Change a past day",
        text: "Open the date in the class's Attendance, change the marks and save. Parents see the corrected attendance straight away.",
      },
      {
        title: "Weekends, holidays and closures",
        text: "Days your school calendar marks as weekends, holidays or closures are skipped automatically. Set them in <strong>Settings</strong>, <strong>Customize School</strong>, <strong>School calendar</strong>.",
      },
    ],
    faq: [
      ["Do parents see attendance?", "Yes. Parents see their children's attendance in the parent portal."],
      ["Can I report on attendance?", "Use <a href=\"/legal/user-documentation/report-builder\">Report Builder</a> for attendance by class, student or date range, and export it."],
    ],
    related: ["class-page", "report-builder", "customize-your-school"],
  },
  {
    slug: "docs-and-sheets",
    title: "Docs and sheets",
    topic: "Classroom & attendance",
    order: 3,
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
