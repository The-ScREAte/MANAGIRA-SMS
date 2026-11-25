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
          "Every student in the class. Select a student to open their page, with tabs for their details, grades, attendance, messages, bills, files, portfolio and transport. See <a href=\"/legal/user-documentation/student-page\">A student's page</a>.",
          "If your school has remarks in the Custom editor, a form set to show beside each student, such as Report card remarks, has its icon beside every student: grey until it's filled in for this term, then your school's color. Tap it to open that student's form. The remark pencil then asks only for remarks no form covers, and goes away once forms cover them all. See <a href=\"/legal/user-documentation/custom-editor\">Custom editor</a>.",
        ],
        image: "class-page.webp",
        caption: "Class Room: the class at a glance, with Class Tools on the left.",
      },
      {
        title: "Attendance",
        text: "Mark attendance, and lunch if your school uses it, for the last few school days in a few taps, add a note or a late mark to any day, and look back over past days. Weekends and holidays are folded into slim strips. See <a href=\"/legal/user-documentation/mark-attendance-for-a-class\">Take attendance</a>.",
        image: "attendance.webp",
        caption: "Attendance: one row per student.",
      },
      {
        title: "Grading",
        text: "Open <strong>Gradebook</strong> and choose a subject to enter scores in its score sheet. Totals, grades and positions are worked out for you. See <a href=\"/legal/user-documentation/grading-or-marking-assessment\">Enter and review scores</a>.",
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
    summary: "Mark attendance and lunch in a few taps, add a note or a late mark to any day, and read past days. Weekends and holidays stay out of your way.",
    tags: ["attendance", "take attendance", "absent", "present", "late", "tardy", "attendance note", "daily attendance", "had lunch", "check all", "edit attendance", "overall attendance", "weekend", "holiday"],
    featured: true,
    who: "A class's <strong>main teacher</strong> and <strong>assistant teachers</strong>, and managers and supervisors given <strong>Mark Attendance</strong>.",
    intro: "The class's Attendance opens on the last 3 <strong>school days</strong>, with today always the far-right column, one column per day and one row per student. The page loads only the days you chose, so it opens quickly however long the term is. A saved day stays locked until you select <strong>Edit</strong>, so its marks never change by accident.",
    sections: [
      {
        title: "Mark a day's attendance",
        steps: [
          ["On your dashboard, open the class and choose <strong>Attendance</strong> in Class Tools.", "attendance.webp", "A class's Attendance: one row per student, one tap each."],
          "Find the day's column. A day nobody has marked yet opens for editing at your first tap; for a day already saved, select <strong>Edit</strong> under the date.",
          "Tick each student who is present. <strong>Check all</strong> marks everyone present (and, where lunch is taken, everyone had lunch); then change the few who are different.",
          "Select <strong>Save</strong>. <strong>Cancel</strong> puts the day back as it was.",
          "If asked <strong>Done taking attendance for today?</strong>, choose <strong>Yes, I’m done</strong> when the day is finished, or <strong>Not yet</strong> to be asked again in 30 minutes.",
        ],
        tip: "Check all first, then tap the two or three who are absent. On a normal day it takes seconds.",
        note: "A ticked box is your school's color with a white tick. Every control on the sheet, the boxes, the lunch plates, the note button and the day's buttons, is the same size, and a little larger on a phone where you tap them.",
      },
      {
        title: "Add a note to a day",
        text: "Every student's day has a small <strong>note</strong> button beside the box, whether they were present or absent, and whether or not the day has been marked. Use it for the reason someone was away, or for a student who left early or came late.",
        steps: [
          "Select the note button beside the student for that day. Choose a quick reason (<em>Sick</em>, <em>Family matter</em>, <em>Medical appointment</em>, <em>Left early</em>, <em>Came late</em> or <em>Travel</em>) or write your own, up to 300 characters.",
          "Select <strong>Save note</strong>. On a day you're editing, or one nobody has marked yet, the note is kept with the day and saves with its <strong>Save</strong> (writing a note on an unmarked day starts editing it). On a day already saved, the note saves by itself and the student's mark stays as it was.",
        ],
        list: [
          "A dot on the note button means the day has a note; hold your pointer over it to read it.",
          "Notes are for staff. Parents and students don't see them. The student's own page shows the notes for their recent days.",
        ],
      },
      {
        title: "Mark a student late",
        text: "In the note pop-up of a student who is marked present, tick <strong>Arrived late</strong> (the <em>Came late</em> choice ticks it for you). The note button turns amber, and the student's page shows the day as <strong>Late</strong>. A late student still counts as present in attendance totals.",
        note: "Late marks, and the notices to parents that use them, are part of <a href=\"/legal/user-documentation/attendance-notices\">Attendance notices</a>, which your school may not have turned on yet. Without it the note pop-up has no <strong>Arrived late</strong> choice.",
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
        title: "Choose which days show",
        steps: [
          "Select <strong>Filters</strong>, then <strong>Show</strong>, to choose <strong>Today</strong>, the last 2 or 3 school days, the last week, 2 weeks or month, the whole term, or one date. Your choice is remembered on this device, and <strong>Reset</strong> goes back to the last 3 school days.",
          "The page then loads just those days. Choosing a longer range loads the rest when you ask for it.",
        ],
        note: "Weekends, holidays and days off never count toward the school days in the filter. Three school days on a Monday are Monday and the Thursday and Friday before it, with the weekend between them kept out of the count.",
      },
      {
        title: "Weekends, holidays and days off",
        text: "Days that aren't school days, the weekend, public holidays and days your school added, are folded into one slim strip between the school days, with its name written along the side (<em>WEEKEND</em>, <em>THANKSGIVING</em>) and a line either side so the weeks read apart.",
        list: [
          "Select the strip to open those days. They open as slim columns, and a small <strong>‹</strong> button folds them again.",
          "If today is a weekend day, the strip carries a small dot.",
          "Choosing a single weekend date in the filter shows it open.",
          "The \"school days aren't marked yet\" reminder leaves these days out.",
        ],
        note: "Which days are the weekend, which holidays apply and which days are closed come from your school's calendar. See <a href=\"/legal/user-documentation/customize-your-school\">Customize your school</a>.",
      },
      {
        title: "Change a past day",
        steps: [
          "Open the day's column (choose a longer range in the filter if it isn't shown).",
          "Select <strong>Edit</strong> under the day, change the marks, and select <strong>Save</strong>. Parents see the corrected attendance in their portal straight away.",
        ],
      },
      {
        title: "When families are told",
        text: "Families are not told the moment you press <strong>Save</strong>, so a mistake can be fixed first.",
        list: [
          "After you choose <strong>Yes, I’m done</strong>, families are told about the day's absences <strong>30 minutes</strong> later.",
          "If nobody answers, they are told <strong>2 hours after the last save</strong>.",
          "A student you correct to present before then is not mentioned.",
          "Each family hears about a student's day once.",
        ],
      },
      {
        title: "Read each student's totals",
        list: [
          "The <strong>Overall</strong> column shows each student's days present for the whole term, not just the days on screen. Where lunch is taken, days with lunch sit beside them.",
          "The <strong>Summary</strong> under the list counts the class's days present and days absent, with <strong>Had lunch</strong> beside them where lunch is taken.",
          "A student's own page has an <strong>Attendance</strong> tab with the same totals, the absent and late counts and their recent days. See <a href=\"/legal/user-documentation/student-page\">A student's page</a>.",
        ],
      },
      {
        title: "Your school's own columns",
        text: "A column beside the names that your school built, such as a behavior check, comes from the <a href=\"/legal/user-documentation/custom-editor\">Custom editor</a>: choose each student's answer for today and it saves by itself. Where lunch is taken with the plate, a lunch column of your own isn't shown twice.",
      },
    ],
    faq: [
      ["Why can't I change a saved day?", "A saved day is locked until you select <strong>Edit</strong> under its date."],
      ["Where did the weekend go?", "It's folded into a slim strip named <em>WEEKEND</em> between the weeks. Select the strip to open the days."],
      ["Can I add a reason when a student leaves early?", "Yes. Use the note button beside the student for that day and choose <em>Left early</em>, or write your own note. It works for present students too."],
      ["Do parents see my notes?", "No. Notes are for staff. Parents are told about repeated absences or late arrivals only if your school's class settings turn that on; see <a href=\"/legal/user-documentation/attendance-notices\">Attendance notices</a>."],
      ["Do parents and students see attendance and lunch?", "Yes, in their portals, unless the class's settings don't share it with them. See <a href=\"/legal/user-documentation/class-settings\">Class settings</a>."],
      ["I don't see the lunch plates.", "Your school doesn't take lunch yet, or lunch is turned off for this class in Class settings."],
      ["Can I report on attendance and lunch?", "Use <a href=\"/legal/user-documentation/report-builder\">Report Builder</a> for attendance and lunch by class, student or date range, and export it."],
    ],
    related: ["attendance-notices", "student-page", "class-page", "class-settings", "report-builder", "customize-your-school"],
  },
  {
    slug: "attendance-notices",
    title: "Attendance notices: tell parents about repeated absences and late arrivals",
    topic: "Classroom & attendance",
    order: 2.5,
    summary: "Parents are told once a week when a student has been absent or late several times. Each class chooses whether to send them and after how many.",
    tags: ["attendance notices", "absent", "late", "tardy", "notify parents", "repeated absences", "truancy", "class settings", "attendance alerts"],
    who: "Staff given <strong>Class Settings</strong> for their classes, and managers for every class. Your school needs attendance notices turned on; ask your Managira contact if you don't see them.",
    intro: "When a student is marked absent, or marked late, several times in the same week, their parents hear about it from the school without anyone having to write. Each class decides whether to send these notices and after how many; the starting point is <strong>3</strong> for both.",
    sections: [
      {
        title: "How it works",
        list: [
          "A week runs Monday to Sunday. Once a day's attendance is done (30 minutes after the teacher confirms, or 2 hours after the last save), Managira counts the student's absences and late arrivals for that week.",
          "When a count reaches the number set for the student's class, each parent linked to the student gets <strong>one</strong> notice in Managira (the bell) and by email: <em>\"Amara has been absent 3 times this week.\"</em>",
          "It is sent once for that student, kind and week. A fourth absence the same week doesn't send another.",
          "A late arrival is a present student marked <strong>Arrived late</strong> in the day's note. See <a href=\"/legal/user-documentation/mark-attendance-for-a-class\">Take attendance</a>.",
        ],
      },
      {
        title: "Set it for a class",
        steps: [
          "Open the class, then <strong>Class settings</strong> in Class Tools.",
          "Find the <strong>Attendance notices</strong> card. It has two rows, <strong>Absent several times</strong> and <strong>Late several times</strong>.",
          "Use the <strong>−</strong> and <strong>+</strong> buttons (or type a number from 1 to 10) under <strong>After</strong>, and use the switch under <strong>Tell parents</strong> to turn a notice on or off.",
        ],
        note: "Each change saves as you make it and says <em>Saved</em> beside its row.",
      },
      {
        title: "Set it for every class",
        text: "In <strong>Management</strong>, <strong>Class settings</strong>, open the <strong>All classes</strong> row (or any class's row) and use the same card. Changing the <strong>All classes</strong> row sets every class at once.",
      },
      {
        title: "Who is told, and who isn't",
        list: [
          "Parents linked to the student on their record. Each parent can turn email notices off in their own settings.",
          "Nobody is told for a class that turned the notice off, or that doesn't share attendance with parents in <a href=\"/legal/user-documentation/class-settings\">Class settings</a>.",
          "Students are not sent these notices.",
        ],
      },
    ],
    faq: [
      ["What are the starting numbers?", "Both notices are on and wait for 3 in a week. You can pick any number from 1 to 10 for each class."],
      ["Does it count weekends and holidays?", "Only days that were marked count, and weekends and holidays aren't marked, so they never add to the number."],
      ["Will parents be told twice?", "No. A parent hears once for each student, kind of notice and week."],
      ["Does it replace the school-wide weekly absence email?", "Yes. Where attendance notices are on, each class's own settings decide, so parents aren't told twice."],
    ],
    related: ["mark-attendance-for-a-class", "class-settings", "parent-notifications-and-settings", "notifications-and-alerts"],
  },
  {
    slug: "class-settings",
    title: "Class settings",
    topic: "Classroom & attendance",
    order: 3,
    summary: "One page per class: lunch, the student portal, what parents and students see, attendance notices and the weekly briefing. Management can set and lock them.",
    tags: ["class settings", "lunch", "turn off lunch", "student portal", "share with", "padlock", "lock", "hide portfolio", "share files with parents", "parents see", "what parents see", "what students see", "hide from parents", "hide from students", "every class", "weekly briefing", "attendance notices"],
    who: "Staff given <strong>Class Settings</strong>, for the classes they lead as main or assistant teacher (teachers have it by default). With its follow-up <strong>Every Class</strong>, every class, from Management (managers have it).",
    intro: "Each class chooses whether it takes lunch, whether its students use the student portal, who sees its attendance, lunch, report cards and bus, and what parents are told about attendance and in the weekly briefing. Everything is on until someone turns it off. The page is one clean column: a row for each setting, a switch for each choice, and each change saves as you make it.",
    sections: [
      {
        title: "Change a class's settings",
        steps: [
          "Open the class from your dashboard, then <strong>Class settings</strong> in Class Tools.",
          "In the first card, turn <strong>Take lunch</strong> and <strong>Student portal</strong> on or off. With lunch on, a plate sits beside each student's checkbox on the attendance page; see <a href=\"/legal/user-documentation/mark-attendance-for-a-class\">Take attendance</a>. With the student portal on, the class's students can be invited to the portal from their page.",
          "Under <strong>Share with</strong>, the table has a <strong>Parents</strong> and a <strong>Students</strong> column. Switch each item on or off for each. Each change saves straight away.",
        ],
        table: [
          ["Share with", "What parents or students see when it's on"],
          ["<strong>Attendance</strong>", "Daily attendance and overall attendance."],
          ["<strong>Lunch</strong>", "Lunch days and overall lunch."],
          ["<strong>Report cards</strong>", "Report cards, as soon as they're published. Parents also get the report card notice and email."],
          ["<strong>GPA</strong>", "This term's GPA and the cumulative GPA over finished terms, from letter grades. See <a href=\"/legal/user-documentation/gpa-on-report-cards-and-transcripts\">GPA on report cards and transcripts</a>."],
          ["<strong>Bus &amp; transport</strong>", "The bus tracker, boarding, and driver reports shared about the student."],
          ["<strong>Student files</strong>", "Files set to <em>Family</em> on the student's record. See <a href=\"/legal/user-documentation/student-files\">Student files</a>."],
          ["<strong>Portfolio</strong>", "Each term's marked work and documented tests. See <a href=\"/legal/user-documentation/student-portfolio\">A student's portfolio</a>."],
          ["<strong>Alerts</strong>", "Whether they can set alerts about scores, absences and the bus. See <a href=\"/legal/user-documentation/notifications-and-alerts\">Your notifications and alerts</a>."],
          ["<strong>Teacher's email, phone and About me</strong>", "What each teacher shows on the Teachers page of a child's page. The phone is off until you turn it on."],
        ],
        note: "Switching an item off hides it from that class's parents or students only; staff still see everything. Turning lunch off doesn't remove lunch already taken: it stays in reports.",
      },
      {
        title: "Attendance notices",
        text: "The <strong>Attendance notices</strong> card says whether parents are told when a student is absent, or late, several times in a week, and after how many (3 to start). See <a href=\"/legal/user-documentation/attendance-notices\">Attendance notices</a>.",
      },
      {
        title: "Weekly briefing for the class",
        text: "The <strong>Weekly briefing</strong> card, for managers, sets what families and students in this class get in the weekly email. <strong>Choose for this class</strong> off means the class follows the school's choices (the rows show them, greyed). Switch it on to choose for this class: parents and students each have a switch for every part of the briefing. See <a href=\"/legal/user-documentation/weekly-briefing\">Weekly briefing</a>.",
      },
      {
        title: "Change many classes at once",
        steps: [
          "Open <strong>Management</strong>, then <strong>Class settings</strong>. Each class has a row with its lunch and student portal switches. Select a class's arrow to open its Share with, Attendance notices rows.",
          "Use the <strong>All classes</strong> row to set a switch for every class at once. A dash there means the classes differ.",
          "A school with many classes lists them a page at a time. Use <strong>Rows per page</strong> (10, 20, 50, 100 or 200) and the arrows under the list, or search for a class by name, teacher or year group.",
        ],
        note: "Changes save straight away.",
      },
      {
        title: "Lock a setting so the class can't change it",
        text: "Managers with <strong>Every Class</strong> see a small padlock at the edge of each row. Select it to lock that setting: the class's own teachers then see a closed padlock and a switch they can't change, and the page refuses their save. Select it again to unlock. Locking a row in <strong>All classes</strong> locks it for every class.",
        note: "Only a manager can lock or unlock. A teacher can still change every setting that isn't locked.",
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
          ["<strong>Every Class</strong> (with Class Settings)", "Change every class's settings, in the class or in Management, Class settings, and lock settings. Managers have it."],
        ],
        note: "Without Class Settings, the page isn't shown. Give these on the staff form; see <a href=\"/legal/user-documentation/roles-and-permissions\">Roles and permissions</a>.",
      },
    ],
    faq: [
      ["How do I stop parents or students seeing attendance, lunch, report cards, the bus, files or the portfolio?", "Open the class's Class settings and, under <strong>Share with</strong>, switch off <strong>Parents</strong> or <strong>Students</strong> for that item. Staff still see it."],
      ["A parent can't see their child's attendance or report cards.", "Check the child's class settings: the <strong>Parents</strong> switch for that item may be off. For a student, check the <strong>Students</strong> switch."],
      ["The student page has no invite button for a student.", "The class's <strong>Student portal</strong> switch is off, or your school hasn't turned the student portal on in Integrations."],
      ["Why can't I change a setting?", "A manager locked it (you see a closed padlock). Ask a manager to unlock it."],
      ["Can one class take lunch and another not?", "Yes. Take lunch is set for each class."],
      ["Can students see their report cards?", "Yes, in their Portfolio as soon as report cards are published, unless the class's <strong>Students</strong> switch for report cards is off."],
      ["Why can't I change the calendar here?", "It's the same for the whole school, so it's changed in Settings by managers and staff given School Profile &amp; Branding. If you can, select <strong>Change in Settings</strong>."],
    ],
    related: ["attendance-notices", "weekly-briefing", "mark-attendance-for-a-class", "class-page", "customize-your-school", "parent-portal", "student-portal", "roles-and-permissions"],
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
          "The list shows the newest documents a page at a time. Use <strong>Rows per page</strong> (10, 20, 50, 100 or 200) and <strong>Prev</strong> and <strong>Next</strong> under it.",
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
