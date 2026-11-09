"use strict";

// Classroom & attendance: the class page and daily attendance.
module.exports = [
  {
    slug: "class-page",
    title: "Your class page",
    topic: "Classroom & attendance",
    order: 1,
    summary: "One page per class: students, attendance, grading, assessment questions, schedule, activities, the Pickup list, parent messages and transportation.",
    tags: ["class page", "classroom", "class dashboard", "teachers", "pickup list", "class schedule"],
    who: "Teachers for their own classes; managers and supervisors for every class.",
    intro: "Select a class on your dashboard to open its page. A teacher sees the classes assigned to them; managers and supervisors see every class.",
    sections: [
      {
        title: "What's on a class page",
        image: "class-page.webp",
        caption: "A class page: the students, and a menu of everything for this class.",
        table: [
          ["Section", "What you do there"],
          ["<strong>Class Room</strong>", "See every student; open one to see their details, parents and history."],
          ["<strong>Attendance</strong>", "Mark today's attendance and look back over past days."],
          ["<strong>Grading</strong>", "Enter and review scores for the class's assessments."],
          ["<strong>Assessment Questions</strong>", "Write questions for online tests in the Testing Room."],
          ["<strong>Class Schedule</strong>", "The class timetable by day and period."],
          ["<strong>Activities</strong>", "Field trips, clubs and events for the class or one student."],
          ["<strong>Pickup list</strong>", "Who may pick up each student, from the details your school shares with teachers."],
          ["<strong>Parent Messages</strong>", "Messages from parents of students in the class."],
          ["<strong>Transportation</strong>", "Which students ride which bus, live bus tracking and class bus reports."],
          ["<strong>Docs &amp; Sheets</strong>", "Class documents and spreadsheets."],
        ],
      },
    ],
    faq: [
      ["Why don't I see all of these?", "Some sections need a permission or a feature your school turns on, such as Transportation."],
    ],
    related: ["mark-attendance-for-a-class", "activities", "emergency-and-pickup-details", "grading-or-marking-assessment"],
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
          ["On your dashboard, open the class and choose <strong>Attendance</strong>.", "attendance.webp", "A class's Attendance: one row per student, one tap each."],
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
    ],
    related: ["class-page", "mira-ai-capabilities"],
  },
];
