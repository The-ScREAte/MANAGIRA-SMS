"use strict";

// Reports & analytics: report cards, report settings, merit sheets, transcripts, Report Builder, statistics.
module.exports = [
  {
    slug: "report-card",
    title: "Report cards",
    topic: "Reports & analytics",
    order: 1,
    summary: "Generate a class's term report cards with scores, grades, attendance and remarks, then print them or email them to families in one go.",
    tags: ["report cards", "terminal reports", "term report", "print report cards", "email report cards", "progress report"],
    featured: true,
    who: "Managers, and staff given <strong>Terminal Reports</strong> (under Manage Reports/Printing).",
    intro: "A report card gathers a student's term: each subject's scores, grade and remark, attendance, comments and signatures. You decide what it shows in <a href=\"/legal/user-documentation/report-settings\">Report Settings</a>.",
    sections: [
      {
        title: "Generate report cards",
        steps: [
          ["Open <strong>Reports</strong>, then <strong>Term Reports</strong>, and choose the school year and term.", "term-reports.webp", "Reports, Term Reports: choose the term, then the class."],
          "Choose the class and generate. Each student's report card opens, ready to check.",
          "Print them all, download them as a PDF, or email them to families.",
        ],
        note: "Report cards are emailed from <strong>reports@managira.com</strong> with your school's name, to the parents on each student's record.",
      },
      {
        title: "What's on a report card",
        list: [
          "The student's name, ID, class, term and position.",
          "Each subject with its scores, total, percentage, grade, position and remark.",
          "Attendance for the term, and the dates the term began and ends, and when school reopens.",
          "Teacher and principal comments, conduct and interest remarks, and signatures.",
        ],
        tip: "Generate one class first and check a few students' report cards before generating the whole school.",
      },
    ],
    faq: [
      ["A subject is missing from a report card.", "Check the student is enrolled in that subject this term, and that its assessments have scores."],
      ["The grades look wrong.", "Check the grading scale in Report Settings and the assessment weights for the term."],
      ["Can parents download report cards?", "Yes. Parents see published report cards in the parent portal."],
    ],
    related: ["report-settings", "merit-sheet", "configure-dynamic-grading-and-remarks", "grading-or-marking-assessment"],
  },
  {
    slug: "report-settings",
    title: "Report settings",
    topic: "Reports & analytics",
    order: 2,
    summary: "Choose what report cards show: score columns, grade mapping, remarks, promotion rules, reopening date and signatures for report cards and transcripts.",
    tags: ["report settings", "report card design", "signature", "grade mapping", "remarks", "promotion cut-off"],
    who: "Managers, and staff given <strong>Report Settings</strong>.",
    sections: [
      {
        title: "Set up report cards",
        steps: [
          ["Open <strong>Reports</strong>, then <strong>Report Settings</strong>.", "report-settings.webp", "Reports, Report Settings."],
          "For each class, set the <strong>Promoted Class</strong>, <strong>Repeated Class</strong>, <strong>Cut-Off Point</strong> and <strong>School Reopen Date</strong>. You can apply them to several classes at once.",
          "Open <strong>Advanced</strong> to choose the score columns and which sections appear.",
          "Add your <strong>Grade Mapping</strong> (for example A = 90–100) and <strong>Score Remarks</strong> (for example Excellent = 90–100).",
          "Add <strong>Global Remarks</strong> for teacher comments, conduct, interest and attitude.",
          "Add a <strong>Report Signature</strong>, and a transcript signature, and assign them to classes.",
          "Save, then preview one student's report card before rolling out.",
        ],
        tip: "Set up one class completely, check its report card, then copy the settings to the rest.",
      },
    ],
    related: ["report-card", "configure-dynamic-grading-and-remarks", "transcript"],
  },
  {
    slug: "merit-sheet",
    title: "Merit sheets",
    topic: "Reports & analytics",
    order: 3,
    summary: "Rank a class by performance for a term, for chosen subjects and assessment types, and print or share the sheet.",
    tags: ["merit sheet", "class ranking", "honor roll", "class position"],
    who: "Managers, and staff given <strong>Report Builder</strong>.",
    sections: [
      {
        title: "Generate a merit sheet",
        steps: [
          ["Open <strong>Reports</strong>, then <strong>Report Builder</strong>, and choose <strong>Merit sheet</strong>.", "report-builder.webp", "Report Builder: choose Merit sheet, then the term, class and subjects."],
          "Choose the school year and term, the class, the subjects and the assessment types to include.",
          "Run it. Students are listed by rank with their scores and grades.",
          "Print it, export it, or email it.",
        ],
        example: "Use a merit sheet of every subject's semester exam to build the semester's honor roll.",
      },
    ],
    related: ["report-builder", "report-card"],
  },
  {
    slug: "transcript",
    title: "Transcripts",
    topic: "Reports & analytics",
    order: 4,
    summary: "Produce an official, signed transcript of a student's results across every term, for current students and graduates, and email or print it.",
    tags: ["transcript", "official transcript", "academic record", "graduates", "signature"],
    who: "Managers, and staff given <strong>Generate Transcripts</strong>.",
    sections: [
      {
        title: "Set the transcript signature",
        steps: [
          "Open <strong>Reports</strong>, <strong>Report Settings</strong>, and fill in the <strong>Transcript Signature</strong>: the signer's name, title and signature.",
          "Assign it to the classes it applies to.",
        ],
      },
      {
        title: "Produce a transcript",
        steps: [
          ["Open <strong>Reports</strong>, then <strong>Transcript</strong>, and find the student (graduates are included). You can also open it from the student's page.", "transcripts.webp", "Reports, Transcript: official transcripts for current students and graduates."],
          "Review it. If it's password-protected, unlock it to view.",
          "Download, print, or email it. Transcripts are emailed from <strong>reports@managira.com</strong>.",
        ],
        note: "A transcript printed without being sent is marked as unofficial. Send it from Managira for an official copy.",
      },
    ],
    related: ["report-settings", "promote-students-and-manage-graduation", "report-card"],
  },
  {
    slug: "report-builder",
    title: "Report Builder",
    topic: "Reports & analytics",
    order: 5,
    summary: "Build any report you need: students, attendance, grades, staff, fees, messages, transportation and more. Filter, choose columns, save, share, export or email.",
    tags: ["report builder", "custom reports", "export", "csv", "excel", "word", "attendance report", "data"],
    featured: true,
    who: "Managers, and staff given <strong>Report Builder</strong>. Each report also needs the permission for what it shows.",
    intro: "Report Builder answers questions like <em>which 9th graders missed more than five days this month?</em> or <em>which families still owe fees?</em> Pick a report, filter it, choose the columns, and export it.",
    sections: [
      {
        title: "Build a report",
        steps: [
          ["Open <strong>Reports</strong>, then <strong>Report Builder</strong>, and choose a report.", "report-builder.webp", "Reports, Report Builder: choose a report, filter it, choose columns."],
          "Add <strong>filters</strong>: school year and term, class, dates, status and more.",
          "Choose and order the <strong>columns</strong>, and sort.",
          "Run it. The results show on screen.",
        ],
      },
      {
        title: "Reports you can build",
        table: [
          ["Area", "Reports"],
          ["Students", "Students; admissions and enrollment"],
          ["Academics", "Assessment results, online tests, merit sheets"],
          ["Attendance", "Daily attendance, attendance summary, attendance by class"],
          ["Families", "Parents and guardians, parent messages"],
          ["Communication", "Messages sent, failed emails"],
          ["Staff", "Staff, staff tasks, activity log"],
          ["Finance", "Fee balances, payments"],
          ["Calendar", "Announcements, events"],
          ["Transportation", "Riders, bus requests, trips, arrival checks, driver reports, buses, drivers, routes"],
        ],
      },
      {
        title: "Examples: reports schools use every week",
        subsections: [
          {
            title: "Students who missed more than five days this month",
            steps: [
              "Choose <strong>Attendance</strong>, then the attendance summary.",
              "Filter the dates to this month, and the class if you want one grade.",
              "Sort by days absent, highest first, and keep the students with more than five.",
              "Run it, then email it to your counselor or export it.",
            ],
          },
          {
            title: "Families who still owe fees",
            steps: [
              "Choose <strong>Fees &amp; payments</strong>, then <strong>Fee balances</strong>.",
              "Filter to balances above zero, and to a class or bill if you like.",
              "Add the parent name, email and phone columns.",
              "Export to Excel for the office, or follow up from the Mail Room.",
            ],
          },
          {
            title: "A class list with parent contacts",
            steps: [
              "Choose <strong>Students</strong>.",
              "Filter to the class.",
              "Add the parent and guardian columns: name, relationship, phone and email.",
              "Export to Word or Excel for field trips, substitutes or emergencies.",
            ],
          },
          {
            title: "Results for one assessment",
            steps: [
              "Choose <strong>Assessments</strong>, then the assessment results.",
              "Filter to the term, class, subject and assessment.",
              "Sort by score to see who needs help and who can be stretched.",
            ],
          },
          {
            title: "Who rides each bus",
            steps: [
              "Choose <strong>Riders</strong>.",
              "Filter to the route or bus.",
              "Add the stop and parent phone columns, and share it with the driver's lead.",
            ],
          },
        ],
        tip: "Ask Mira instead: <em>List 9th graders who missed more than five days in October</em> or <em>Which families still owe more than $100?</em> Mira builds the same report in Report Builder for you. See <a href=\"/legal/user-documentation/mira-ai-capabilities\">What Mira can do</a>.",
      },
      {
        title: "Save, share and export",
        list: [
          "<strong>Save</strong> a report to run it again with one click. You can share a saved report with colleagues.",
          "<strong>Export</strong> to CSV (up to 100,000 rows), Excel (up to 25,000 rows) or Word (up to 10,000 rows).",
          "<strong>Email</strong> it. Reports are sent from <strong>reports@managira.com</strong>.",
        ],
        note: "Saving and exporting always use the last report you ran, so what you export matches what you see.",
      },
    ],
    faq: [
      ["Why are some columns missing?", "Columns about parents or attendance need those permissions. Ask a manager if you need them."],
      ["A driver sees fewer rows than I do.", "People with limited access see only their own rows, for example a driver's own trips. Full access opens everyone's."],
    ],
    related: ["analytical-dashboard", "merit-sheet", "transportation-reports"],
  },
  {
    slug: "analytical-dashboard",
    title: "School statistics and dashboards",
    topic: "Reports & analytics",
    order: 6,
    summary: "See your school at a glance: performance, attendance, assessments, growth, demographics, enrollment, staffing and subject strengths.",
    tags: ["analytics", "statistics", "dashboard", "school performance", "enrollment trends", "data"],
    who: "Managers, and staff given <strong>Manage School Records</strong> (Organization Analytics &amp; Insights must be in your plan).",
    sections: [
      {
        title: "Open your statistics",
        steps: [
          ["Open <strong>Reports</strong>, then <strong>Organization Stats</strong>.", "organization-stats.webp", "Reports, Organization Stats: your school's performance and trends."],
          "Choose the school year and term to look at.",
        ],
      },
      {
        title: "What you'll see",
        list: [
          "<strong>Performance overview</strong> and <strong>assessment performance</strong>.",
          "<strong>Attendance by class</strong>.",
          "<strong>Class and growth analytics</strong>, and <strong>top performing classes</strong>.",
          "<strong>Organization growth</strong> and <strong>enrollment over terms</strong>.",
          "<strong>Demographics</strong>, <strong>gender distribution</strong> and <strong>students per class</strong>.",
          "<strong>Enrollment and staffing</strong>, and <strong>employee roles</strong>.",
          "<strong>Subject performance</strong> and each subject's <strong>strength profile</strong>.",
        ],
        tip: "For a list behind any number, build it in <a href=\"/legal/user-documentation/report-builder\">Report Builder</a> and export it.",
      },
    ],
    related: ["report-builder", "report-card"],
  },
];
