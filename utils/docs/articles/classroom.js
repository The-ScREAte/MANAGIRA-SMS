"use strict";

// Classroom & attendance: the class page and daily attendance.
// Pictures: ~/.managira-local-copy/tools/docshots/scripts/classroom-*.js
module.exports = [
  {
    slug: "class-page",
    title: "Your class page: Class Tools and every tab",
    topic: "Classroom & attendance",
    order: 1,
    summary: "Open a class and use Class Tools: Class Room, Attendance &amp; lunch, Gradebook, Forms, Activities, Pickup list, Docs & sheets and settings.",
    tags: ["class page", "classroom", "class dashboard", "teachers", "class tools", "pickup list", "my paygira", "class room", "open a class", "class workspace", "arrange menu"],
    featured: true,
    who: "Teachers for the classes they're assigned to; managers and supervisors for every class. Each tab shows only to people who can use it.",
    intro: "A class has its own workspace. <strong>Class Tools</strong> on the left lists everything you can do for the class, and each item opens as a tab you can keep open beside the others.",
    sections: [
      {
        title: "Open a class",
        steps: [
          "Sign in. Your dashboard lists your classes: a teacher sees the classes they are assigned to, managers and supervisors see every class.",
          "Select the class. The workspace opens on <strong>Class Room</strong>. The header names the class, the school year, the term and the term's dates.",
          ["<strong>Class Tools</strong> is the list on the left. Select an item to open it as a tab above the page; select <strong>×</strong> on a tab to close it.", "classroom-overview.webp", "6th Grade: the Class Room tab, with Class Tools on the left."],
        ],
        note: "On a phone, select <strong>Class Tools</strong> at the top to open the list.",
      },
      {
        title: "Put the tools in your order",
        text: "Select the arrows button at the top of Class Tools, then drag items into the order you want. Your order is kept for you only.",
      },
      {
        title: "Class Room",
        text: [
          "The class at a glance: <strong>Teachers</strong> (open it to see the main teacher and assistants, or <em>No main teacher</em>), <strong>Students</strong>, <strong>Subjects</strong> and <strong>Messages</strong>, then the list of students and the subjects of the class.",
          "Select a student to open their page, with tabs for details, grades, attendance and lunch, messages, bills, files, portfolio and transport. See <a href=\"/legal/user-documentation/student-page\">A student's page</a>. The pencil beside a name edits the student.",
          "If your school has remarks in the Custom editor, a form set to show beside each student has its icon beside every name: gray until it's filled in for this term, then your school's color. Tap it to open that student's form. See <a href=\"/legal/user-documentation/custom-editor\">Custom editor</a>.",
        ],
      },
      {
        title: "Every item in Class Tools",
        text: "Some items appear only when your school uses the feature or you hold the permission.",
        table: [
          ["Item", "What it's for"],
          ["<strong>Class Room</strong>", "The overview described above."],
          ["<strong>Parent Messages</strong>", "Messages from the class's parents and your replies, in one place. A number shows unread conversations."],
          ["<strong>Weekly briefing</strong>", "Appears only where the school has no Class settings tab and the weekly briefing is on, for managers. See <a href=\"/legal/user-documentation/weekly-briefing\">Weekly briefing</a>."],
          ["<strong>Class Schedule</strong>", "The class timetable by day and period. The main teacher edits it."],
          ["<strong>Pickup list</strong>", "Who may collect each student, from the details your school shares with teachers. See <a href=\"/legal/user-documentation/emergency-and-pickup-details\">Emergency &amp; pickup details</a>."],
          ["<strong>Transportation</strong>", "Which students ride which bus, the live bus, and bus reports. Only while transportation is on. See <a href=\"/legal/user-documentation/set-up-transportation\">Set up transportation</a>."],
          ["<strong>Activities</strong>", "Field trips, clubs and events for the class or one student. See <a href=\"/legal/user-documentation/activities\">Activities</a>."],
          ["<strong>Forms</strong>", "The forms your school built for this class. A form with its own place, such as a seating chart, gets its own item. See <a href=\"/legal/user-documentation/custom-editor\">Custom editor</a>."],
          ["<strong>My PayGira</strong>", "Bills assigned to you to collect. See <a href=\"/legal/user-documentation/set-up-paygira-bills-collections-and-guardian-payments\">PayGira</a>."],
          ["<strong>Attendance &amp; lunch</strong>", "Take attendance and lunch. It says <strong>Attendance</strong> or <strong>Lunch</strong> when the class takes only one, and is hidden when it takes neither. See <a href=\"/legal/user-documentation/mark-attendance-for-a-class\">Take attendance</a>."],
          ["<strong>Assessment Questions</strong>", "Questions for online tests. Grayed with <em>Ask your admin for access</em> if you lack <strong>Set Assessment Questions</strong>. See <a href=\"/legal/user-documentation/assessment-questions-and-online-tests\">Assessment questions</a>."],
          ["<strong>Gradebook</strong>", "Opens a list of the class's subjects (and <strong>Review</strong>); choose one to enter scores. See <a href=\"/legal/user-documentation/grading-or-marking-assessment\">Enter and review scores</a>."],
          ["<strong>Docs &amp; sheets</strong>", "Documents and spreadsheets attached to the class. See <a href=\"/legal/user-documentation/docs-and-sheets\">Docs and sheets</a>."],
          ["<strong>Class &amp; notif. settings</strong>", "Lunch, the student portal, what parents and students see, and attendance notices. See <a href=\"/legal/user-documentation/class-settings\">Class settings</a>."],
        ],
      },
      {
        title: "A teacher's view of someone else's class",
        text: "A teacher sees Class Tools only for classes they're assigned to, and works on the subjects they teach unless they are the class's main teacher or an assistant. Attendance, lunch and Class settings are for the main teacher and assistants. See <a href=\"/legal/user-documentation/assistant-teachers\">Main and assistant teachers</a>.",
      },
    ],
    faq: [
      ["Why don't I see all of these tools?", "Some need a permission or a feature your school turns on, such as Transportation or PayGira. Attendance &amp; lunch appears only for the class's main or assistant teachers who hold Mark Attendance."],
      ["Why does Class Room say No main teacher?", "Nobody is in charge of the class yet. A manager chooses the main teacher in Users / Employees. See <a href=\"/legal/user-documentation/assistant-teachers\">Main and assistant teachers</a>."],
      ["Can I change the order of the tools?", "Yes. Select the arrows button at the top of Class Tools and drag the items."],
    ],
    related: ["mark-attendance-for-a-class", "class-settings", "assistant-teachers", "grading-or-marking-assessment", "activities", "custom-editor"],
  },
  {
    slug: "mark-attendance-for-a-class",
    title: "Take attendance and lunch",
    topic: "Classroom & attendance",
    order: 2,
    summary: "Mark attendance and lunch in a few taps, add a note or a late mark, choose which days show, and fix a past day. Weekends and holidays stay out of the way.",
    tags: ["attendance", "take attendance", "absent", "present", "late", "tardy", "attendance note", "daily attendance", "had lunch", "check all", "edit attendance", "overall attendance", "weekend", "holiday", "lunch", "days off", "unmarked days", "arrived late", "absent today"],
    featured: true,
    who: "A class's <strong>main teacher</strong> and <strong>assistant teachers</strong> who hold <strong>Mark Attendance</strong>, and managers and supervisors given it.",
    intro: "Attendance and lunch share one sheet: one row per student and one column per school day, with today on the far right. A saved day stays locked until you select <strong>Edit</strong>, so marks never change by accident.",
    sections: [
      {
        title: "Open the attendance sheet",
        steps: [
          ["Open the class, then select <strong>Attendance &amp; lunch</strong> in Class Tools."],
          ["The sheet opens on the last 3 school days. Today's column is shaded and says <strong>Today</strong>."],
        ],
        image: "attendance-sheet.webp",
        caption: "The sheet on its own: filters on the right, days across, <strong>Overall</strong> at the end.",
        note: "The chips above the sheet (<strong>US</strong>, <strong>Weekends</strong>, <strong>Public Holidays</strong>) show your school's calendar for the term. If none is set the sheet shows every date and a link <strong>Set up the calendar</strong>.",
      },
      {
        title: "Mark a day",
        steps: [
          ["Select <strong>Edit</strong> under the date. For a day nobody has marked yet, your first tap on a box starts editing."],
          ["Editing shows <strong>Save</strong> and <strong>Cancel</strong>, and <strong>Check all</strong> under them. Check all marks everyone present, and everyone as having had lunch when you check the plate beside it.", "attendance-editing-zoom.webp", "Check all has a box for attendance and a plate for lunch."],
          ["Change the few who are different: check a box for a present student, leave it empty for absent."],
          "Select <strong>Save</strong>. <strong>Cancel</strong> puts attendance and lunch back as they were.",
          "If Managira asks <strong>Done taking attendance for today?</strong>, choose <strong>Yes, I’m done</strong> when the day is finished, or <strong>Not yet</strong> to be asked again in 30 minutes.",
        ],
        tip: "Check all first, then uncheck the two or three who are absent. A normal day takes seconds.",
      },
      {
        title: "Take lunch",
        text: "Where your school takes lunch, a plate sits beside each box.",
        list: [
          "Tap the plate when a student had lunch. It saves with the day's attendance, by the same <strong>Save</strong>.",
          "Lunch is recorded only on days someone takes it. A day you leave the plates alone counts as not recorded, not as no lunch.",
          "A small count under the date shows how many students had lunch.",
        ],
        note: "Each class chooses <strong>Take attendance</strong> and <strong>Take lunch</strong> in <a href=\"/legal/user-documentation/class-settings\">Class settings</a>. A school that doesn't use lunch, or keeps attendance somewhere else, turns it off for every class in Management › Class &amp; notif. settings.",
      },
      {
        title: "Add a note or mark a student late",
        text: "Every student's day has a small note button, whether the student was present or absent and whether the day is marked yet.",
        steps: [
          ["Select the note button. Pick a quick choice (<em>Sick</em>, <em>Family matter</em>, <em>Medical appointment</em>, <em>Left early</em>, <em>Came late</em> or <em>Travel</em>) or write your own, up to 300 characters.", "attendance-note-zoom.webp", "The note pop-up."],
          ["For a present student, check <strong>Arrived late</strong>. The <em>Came late</em> choice checks it for you. The student's page shows the day as <strong>Late</strong>, and they still count as present."],
          "Select <strong>Save note</strong>. On a day you're editing, or one nobody marked yet, the note is kept with the day and saves with <strong>Save</strong>. On a saved day it saves by itself and the student's mark doesn't change. <strong>Clear</strong> removes it.",
        ],
        list: [
          "A dot on the note button means that day has a note.",
          "Notes are for staff. Parents and students don't see them.",
          "Arrived late is part of <a href=\"/legal/user-documentation/attendance-notices\">Attendance notices</a>, which need to be turned on for your school.",
        ],
      },
      {
        title: "Choose which days show",
        steps: [
          ["Select <strong>Filters</strong>."],
          ["Under <strong>Show</strong> choose <strong>Today</strong>, <strong>Last 2 school days</strong>, <strong>Last 3 school days</strong>, <strong>Last week</strong>, <strong>Last 2 weeks</strong>, <strong>Last month</strong>, <strong>Whole term</strong>, or one date from <strong>One day</strong>. <strong>Name order</strong> sorts A to Z or Z to A, and <strong>Gender</strong> narrows the list.", "attendance-filters-zoom.webp", "Show, Name order and Gender."],
          "<strong>Reset</strong> goes back to the last 3 school days. Your range is remembered on this device. The page loads only the days you chose, so it opens fast however long the term is.",
        ],
        note: "School days don't include weekends, holidays or days off. Three school days on a Monday are Monday and the Thursday and Friday before it.",
      },
      {
        title: "Weekends, holidays and days off",
        text: "Days that aren't school days are folded into one slim strip, named on its side (<em>WEEKEND</em>, <em>THANKSGIVING</em>), so the weeks read apart.",
        steps: [
          ["Choose <strong>Last week</strong> or longer to see them.", "attendance-strip-zoom.webp", "A closed weekend strip."],
          ["Select the strip to open the days as slim columns. Select the small <strong>‹</strong> button to fold them again."],
        ],
        list: [
          "A day filtered to on its own opens by itself.",
          "Which days are the weekend, which holidays apply and which days are closed come from your school's calendar, set by managers in Settings. See <a href=\"/legal/user-documentation/customize-your-school\">Customize your school</a>.",
        ],
      },
      {
        title: "Days nobody marked",
        text: "When school days from the past week aren't marked, a yellow note lists them. Weekends and days off are left out. Select <strong>×</strong> to hide the note.",
      },
      {
        title: "Change a past day",
        steps: [
          "Show the day (choose a longer range under <strong>Show</strong> if needed).",
          "Select <strong>Edit</strong> under its date, change the marks, and select <strong>Save</strong>. Parents see the corrected attendance in their portal.",
        ],
      },
      {
        title: "When families are told",
        text: "Families aren't told the moment you press Save, so a mistake can be fixed first.",
        list: [
          "After you choose <strong>Yes, I’m done</strong>, families hear about the day's absences 30 minutes later.",
          "If nobody answers, they hear 2 hours after the last save.",
          "A student you correct to present before then isn't mentioned, and each family hears once per day.",
        ],
      },
      {
        title: "Read the totals",
        list: [
          "<strong>Overall</strong> shows each student's days present for the whole term, with lunch beside it where lunch is taken, not just the days on screen.",
          "The <strong>Summary</strong> under the sheet (select <strong>Show summary</strong>) counts students, days present and days absent for <strong>Male</strong>, <strong>Female</strong> and the <strong>Class</strong>.",
          "A student's own page has the same totals, with their absent and late days and recent days: open the student, then <strong>Attendance &amp; lunch</strong>. See <a href=\"/legal/user-documentation/student-page\">A student's page</a>.",
        ],
      },
      {
        title: "Your school's own columns",
        text: "A column beside the names that your school built, such as a behavior check, comes from the <a href=\"/legal/user-documentation/custom-editor\">Custom editor</a>. Choose each student's answer for today and it saves by itself.",
      },
    ],
    faq: [
      ["Why can't I change a saved day?", "A saved day is locked until you select <strong>Edit</strong> under its date."],
      ["I don't see Attendance & lunch in Class Tools.", "It appears for the class's main and assistant teachers who hold <strong>Mark Attendance</strong>, and for managers. Ask a manager to check your classes in Users / Employees. See <a href=\"/legal/user-documentation/assistant-teachers\">Main and assistant teachers</a>."],
      ["Where did the weekend go?", "It's a slim strip between the weeks. Select it to open the days."],
      ["Can I add a reason when a student leaves early?", "Yes. Use the note button for that day and choose <em>Left early</em>. It works for present students too."],
      ["Do parents see my notes?", "No. Parents hear about repeated absences or late arrivals only if your class settings turn that on. See <a href=\"/legal/user-documentation/attendance-notices\">Attendance notices</a>."],
      ["Do parents and students see attendance and lunch?", "Yes, unless the class's settings don't share them. See <a href=\"/legal/user-documentation/class-settings\">Class settings</a>."],
      ["I don't see the lunch plates.", "Your school doesn't take lunch, or lunch is off for this class in Class settings."],
      ["Can I report on attendance and lunch?", "Yes. Use <a href=\"/legal/user-documentation/report-builder\">Report Builder</a>."],
    ],
    related: ["attendance-notices", "class-settings", "class-page", "student-page", "assistant-teachers", "report-builder", "customize-your-school"],
  },
  {
    slug: "attendance-notices",
    title: "Attendance notices for repeated absences and late arrivals",
    topic: "Classroom & attendance",
    order: 2.5,
    summary: "Parents are told once when a student has been absent or late several times in a week. Each class chooses whether to send them and after how many.",
    tags: ["attendance notices", "absent", "late", "tardy", "notify parents", "repeated absences", "truancy", "attendance alerts", "arrived late"],
    who: "Staff given <strong>Class Settings</strong>, for the classes they lead, and managers with <strong>Every Class</strong> for any class. Your school needs attendance notices turned on; ask your Managira contact if you don't see them.",
    intro: "When a student is marked absent, or late, several times in the same week, their parents hear from the school without anyone writing. Each class decides whether to send these notices and after how many. Both start on, at <strong>3</strong>.",
    sections: [
      {
        title: "How it works",
        list: [
          "A week runs Monday to Sunday. Once a day's attendance is done (30 minutes after the teacher confirms, or 2 hours after the last save), Managira counts the student's absences and late arrivals for that week.",
          "When a count reaches the class's number, each parent linked to the student gets <strong>one</strong> notice in Managira (the bell) and by email, such as <em>Amara has been absent 3 times this week</em>.",
          "It is sent once per student, kind and week. A fourth absence the same week doesn't send another.",
          "A late arrival is a present student marked <strong>Arrived late</strong>. See <a href=\"/legal/user-documentation/mark-attendance-for-a-class\">Take attendance</a>.",
        ],
      },
      {
        title: "Set it for a class",
        steps: [
          "Open the class, then <strong>Class &amp; notif. settings</strong> in Class Tools.",
          "Scroll to <strong>Attendance notices</strong>. It has two rows: <strong>Absent several times</strong> and <strong>Late several times</strong>.",
          ["Use <strong>−</strong> and <strong>+</strong> (or type a number from 1 to 10) under <strong>After</strong>, and the switch under <strong>Tell parents</strong> to turn each notice on or off.", "classroom-notices-card.webp", "Attendance notices at the bottom of a class's settings."],
        ],
        note: "Each change saves as you make it.",
      },
      {
        title: "Set it for every class",
        text: "Managers go to <strong>Management › Class &amp; notif. settings</strong>, open the <strong>All classes</strong> row (or any class's row) with its arrow, and use the same two rows. Changing <strong>All classes</strong> sets every class at once.",
      },
      {
        title: "Who is told",
        list: [
          "Parents linked to the student. Each parent can turn the email off in their own settings.",
          "Nobody, for a class that turned the notice off or doesn't share <strong>Attendance</strong> with parents in <a href=\"/legal/user-documentation/class-settings\">Class settings</a>.",
          "Students aren't sent these notices.",
        ],
      },
    ],
    faq: [
      ["What are the starting numbers?", "Both notices are on and wait for 3 in a week. You can pick any number from 1 to 10 for each class."],
      ["Do weekends and holidays count?", "No. Only days that were marked count."],
      ["Will parents be told twice?", "No. A parent hears once per student, kind of notice and week."],
      ["Does it replace the school-wide weekly absence email?", "Yes, where attendance notices are on. Each class's own settings decide, so parents aren't told twice."],
    ],
    related: ["mark-attendance-for-a-class", "class-settings", "parent-notifications-and-settings", "notifications-and-alerts"],
  },
  {
    slug: "class-settings",
    title: "Class settings: lunch, sharing and what parents see",
    topic: "Classroom & attendance",
    order: 3,
    summary: "Per class: lunch, the student portal, what parents and students see, attendance notices and the weekly briefing. Managers can set every class and lock settings.",
    tags: ["class settings", "lunch", "turn off lunch", "turn off attendance", "student portal", "share with", "padlock", "lock", "hide portfolio", "share files with parents", "parents see", "what parents see", "what students see", "hide from parents", "hide from students", "every class", "weekly briefing", "attendance notices", "class & notif. settings", "who can change class settings", "class settings permission"],
    who: "Staff given <strong>Class Settings</strong>, for the classes they lead as main or assistant teacher (teachers have it by default). With its follow-up <strong>Every Class</strong>, every class, from Management (managers have it). Only managers change the school-wide switches and the padlocks.",
    intro: "Each class chooses whether it takes lunch, whether its students use the student portal, who sees its attendance, lunch, report cards and bus, and what parents are told about attendance. Everything is on until someone turns it off, and each change saves as you make it.",
    sections: [
      {
        title: "Change one class's settings",
        steps: [
          ["Open the class, then select <strong>Class &amp; notif. settings</strong> in Class Tools."],
          "At the top, switch <strong>Take attendance</strong>, <strong>Take lunch</strong> and <strong>Student portal</strong>. With attendance off, the class has no attendance sheet, and attendance is left off its report cards, its students' pages and the portals; the same goes for lunch. With lunch on, a plate sits beside each student on the attendance sheet. With the student portal on, the class's students can be invited from their page.",
          ["Under <strong>Share with</strong>, the <strong>Parents</strong> and <strong>Students</strong> columns have a switch for each item. Switch an item off to hide it from that audience for this class.", "class-settings-rows-zoom.webp", "Share with, then Attendance notices, for 6th Grade."],
        ],
        table: [
          ["Share with", "What parents or students see when it's on"],
          ["<strong>Attendance</strong>", "Daily and overall attendance."],
          ["<strong>Lunch</strong>", "Lunch days and overall lunch."],
          ["<strong>Report cards</strong>", "Report cards once they're published, and the report card notice."],
          ["<strong>GPA</strong>", "This term's GPA and the cumulative GPA, from letter grades. See <a href=\"/legal/user-documentation/gpa-on-report-cards-and-transcripts\">GPA</a>."],
          ["<strong>Bus &amp; transport</strong>", "The bus tracker, boarding, and driver reports shared about the student."],
          ["<strong>Student files</strong>", "Files set to share with the family. See <a href=\"/legal/user-documentation/student-files\">Student files</a>."],
          ["<strong>Portfolio</strong>", "Each term's marked work. See <a href=\"/legal/user-documentation/student-portfolio\">A student's portfolio</a>."],
          ["<strong>Alerts</strong>", "Whether they can set alerts about scores, absences and the bus. See <a href=\"/legal/user-documentation/notifications-and-alerts\">Notifications and alerts</a>."],
          ["<strong>Teacher's email</strong>, <strong>phone</strong>, <strong>About me</strong>", "What each teacher shows on a child's Teachers page. The phone is off until you turn it on."],
        ],
        note: "Switching an item off hides it from that class's parents or students only. Staff still see everything, and lunch already taken stays in reports.",
      },
      {
        title: "Attendance notices and weekly briefing",
        text: "Further down are the <strong>Attendance notices</strong> rows (see <a href=\"/legal/user-documentation/attendance-notices\">Attendance notices</a>) and, for managers, the class's <strong>Weekly briefing</strong>. <strong>Choose for this class</strong> off means the class follows the school's choices. See <a href=\"/legal/user-documentation/weekly-briefing\">Weekly briefing</a>.",
      },
      {
        title: "Change many classes: Management",
        steps: [
          ["Go to <strong>Management › Class &amp; notif. settings</strong>.", "class-settings-management.webp", "Every class on one page."],
          "Each class has a row with its <strong>Take attendance</strong>, <strong>Take lunch</strong> and <strong>Student portal</strong> switches. Select its arrow to open <strong>Share with</strong> and the notices.",
          ["The <strong>All classes</strong> row sets a switch for every class at once. A dash means the classes differ."],
          "With many classes, use <strong>Find a class</strong> and the page bar under the list.",
        ],
      },
      {
        title: "Turn attendance or lunch off for the school",
        text: "At the top of the Management page, managers see a <strong>School</strong> card with <strong>Attendance</strong> (<em>Take attendance in Managira. Off if your school keeps it elsewhere</em>) and <strong>Lunch</strong>. A service switched off is left out of the classroom, report cards, the portals and briefings. Class Tools then says <strong>Attendance</strong> or <strong>Lunch</strong> alone, or leaves the item out.",
      },
      {
        title: "Lock a setting",
        steps: [
          ["Managers with <strong>Every Class</strong> see a small padlock at the edge of each row. Select it to lock that setting.", "class-settings-padlock-zoom.webp", "A closed padlock: this row is locked."],
          ["The class's own teachers now see a closed padlock and a switch they can't change, and the page says <em>Your school locked this setting. Only management can change it.</em>"],
          "Select the padlock again to unlock. Locking a row in <strong>All classes</strong> locks it for every class.",
        ],
        note: "The Parents and Students switches of a row lock together. Only a manager can lock or unlock. Teachers can still change everything that isn't locked.",
      },
      {
        title: "The school's attendance calendar",
        text: "Class settings shows the term's calendar: weekends, public holidays and days off, which attendance and lunch skip. It is the same for the whole school and is changed in Settings by managers and staff given School Profile &amp; Branding (<strong>Change in Settings</strong>). See <a href=\"/legal/user-documentation/customize-your-school\">Customize your school</a>.",
      },
      {
        title: "Who can change these settings",
        table: [
          ["Permission", "Lets them"],
          ["<strong>Class Settings</strong>", "Change the settings of the classes they lead, as main or assistant teacher. Teachers have it by default."],
          ["<strong>Every Class</strong> (with Class Settings)", "Change every class, from Management, and lock settings. Managers have it."],
        ],
        note: "Without Class Settings the page isn't shown. See <a href=\"/legal/user-documentation/roles-and-permissions\">Roles and permissions</a>.",
      },
    ],
    faq: [
      ["How do I stop parents or students seeing attendance, lunch, report cards, the bus, files or the portfolio?", "Open the class's settings and, under <strong>Share with</strong>, switch off <strong>Parents</strong> or <strong>Students</strong> for that item."],
      ["A parent can't see their child's attendance or report cards.", "Check the child's class settings: the <strong>Parents</strong> switch for that item may be off. For a student, check <strong>Students</strong>."],
      ["The student page has no invite button.", "The class's <strong>Student portal</strong> switch is off, or your school hasn't turned the student portal on in Integrations."],
      ["Why can't I change a setting?", "A manager locked it (you see a closed padlock). Ask a manager to unlock it."],
      ["Can one class take lunch and another not?", "Yes. <strong>Take attendance</strong> and <strong>Take lunch</strong> are set for each class, and a manager can lock them."],
      ["Why can't I change the calendar here?", "It is the same for the whole school, so it is changed in Settings."],
    ],
    related: ["attendance-notices", "weekly-briefing", "mark-attendance-for-a-class", "class-page", "customize-your-school", "parent-portal", "student-portal", "roles-and-permissions"],
  },
  {
    slug: "docs-and-sheets",
    title: "Docs and sheets",
    topic: "Classroom & attendance",
    order: 4,
    summary: "Write letters and notes in Docs and keep tables and lists in Sheets inside Managira: share them with colleagues or attach them to a class.",
    tags: ["documents", "spreadsheets", "docs", "sheets", "share", "class documents", "new doc", "new sheet", "docs & sheets"],
    who: "Staff on a plan that includes Docs &amp; sheets. Managers and staff with <strong>Manage School Records</strong> create and manage the school's documents.",
    intro: "Docs &amp; sheets keeps school paperwork next to the students it's about: permission letters, lesson notes, sign-up lists, seating charts. Nothing to download, and you choose who can see each one.",
    sections: [
      {
        title: "Find Docs &amp; sheets",
        image: "docs-sheets-list.webp",
        caption: "Management › Docs & sheets: the school's documents.",
        list: [
          "Managers: <strong>Management › Docs &amp; sheets</strong>.",
          "In a class: <strong>Docs &amp; sheets</strong> in Class Tools shows the documents attached to that class.",
        ],
      },
      {
        title: "Create a doc or sheet",
        steps: [
          ["Select <strong>New Doc/Sheet</strong>."],
          ["Choose <strong>Doc</strong> (letters, notes, report cards) or <strong>Sheet</strong> (tables, lists), type a <strong>Title</strong>, and select <strong>Create</strong>."],
          "Write or fill it in. Changes save as you go.",
        ],
        note: "Creating needs <strong>Manage School Records</strong>.",
      },
      {
        title: "Share it and find it again",
        image: "docs-sheets-class.webp",
        caption: "Docs & sheets inside a class.",
        list: [
          "Give a colleague access so it appears in their own Docs &amp; sheets.",
          "Attach it to a class so it shows under that class, for its teachers.",
          "The list shows the newest documents a page at a time: use <strong>Rows per page</strong> (10, 20, 50, 100 or 200) and <strong>Prev</strong> and <strong>Next</strong>. Use search to find an older one.",
          "The trash can on a card deletes it.",
        ],
        tip: "Ask Mira: <em>Create a sheet of the 6th Grade students and share it with the front office.</em>",
      },
      {
        title: "Make your own report card",
        text: "A Sheet or Doc can also be your school's report card layout, filled in for each student when report cards print. See <a href=\"/legal/user-documentation/report-card-templates\">Custom report card templates</a>.",
      },
    ],
    faq: [
      ["I don't see Docs & sheets.", "Your plan may not include it, or you lack <strong>Manage School Records</strong>."],
      ["Who can see a document?", "The person who made it, and anyone it is shared with or attached to a class for."],
    ],
    related: ["class-page", "report-card-templates", "mira-ai-capabilities"],
  },
];
