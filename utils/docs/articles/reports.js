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
        title: "Generate and print report cards for a class",
        steps: [
          ["Open <strong>Reports</strong>, then <strong>Term Reports</strong>, then <strong>Terminal reports</strong>, and choose the school year and term.", "term-reports.webp", "Reports, Terminal reports: choose the term, then the class."],
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
          "The promotion decision: <strong>Promoted To</strong> or <strong>Repeated In</strong> a class. Save it with the report; promotion uses it. See <a href=\"/legal/user-documentation/promote-students-and-manage-graduation\">Promotion</a>.",
        ],
        tip: "Generate one class first and check a few students' report cards before generating the whole school.",
      },
    ],
    faq: [
      ["A subject is missing from a report card.", "Check the student is enrolled in that subject this term, and that its assessments have scores."],
      ["The grades look wrong.", "Check the grading scale in Report Settings and the assessment weights for the term."],
      ["Can parents download report cards?", "Yes. See <a href=\"/legal/user-documentation/parent-grades-and-report-cards\">Grades and report cards</a> in the parent portal guides."],
    ],
    related: ["report-settings", "report-card-templates", "merit-sheet", "configure-dynamic-grading-and-remarks", "promote-students-and-manage-graduation", "grading-or-marking-assessment"],
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
    related: ["report-card", "report-card-templates", "configure-dynamic-grading-and-remarks", "transcript"],
  },
  {
    slug: "report-card-templates",
    title: "Custom report card templates",
    topic: "Reports & analytics",
    order: 3,
    summary: "Design your school's own report card in a Sheet, a Doc or Excel, add fields for names, scores and remarks, and print it for the classes you choose.",
    tags: ["report card template", "custom report card", "report card design", "excel report card", "report card fields", "placeholders", "tick box report card", "nursery report card"],
    featured: true,
    who: "Managers, and staff given <strong>Manage School Records</strong>.",
    intro: "Make report cards look exactly like your school's own. Lay out the card once in Docs &amp; Sheets, or bring it in from Excel, and put a field such as <code>{{student.name}}</code> wherever a student's details belong. The classes you choose print with your layout; every other class keeps the standard report card.",
    sections: [
      {
        title: "How fields work",
        list: [
          "A field is a name between double curly braces, like <code>{{student.name}}</code>. When report cards print, each field is replaced with that student's details.",
          "Words around a field print as you typed them: <code>{{attendance.present}} of {{attendance.total}} days</code> prints <em>58 of 61 days</em>.",
          "A row with subject fields, like <code>{{subject.name}}</code>, prints once for every subject the student takes.",
          "Your formatting prints too: bold text, colors, borders, merged cells and column widths.",
        ],
      },
      {
        title: "Create the template",
        steps: [
          ["Open <strong>Management</strong>, then <strong>Docs &amp; sheets</strong>, and select <strong>New Doc/Sheet</strong>.", "rt-new.webp", "New doc or sheet: choose Sheet for a table layout."],
          "Choose <strong>Sheet</strong> (best for most report cards: rows, columns, borders and merged cells) or <strong>Doc</strong> (a letter-style card). Name it, for example <em>7th Grade report card</em>, and select <strong>Create</strong>.",
          ["Lay out the card as you would in a spreadsheet: the school's name at the top, labels in bold, a header row for subjects. Changes save as you go.", "rt-editor.webp", "A finished layout: labels in bold, and a field in each cell where data goes."],
        ],
        tip: "Want a head start? Open <strong>Fields</strong> and, under <strong>Start from a sample</strong>, choose <strong>Scores</strong>, <strong>Tick boxes</strong> or <strong>Nursery card</strong> for a complete layout you can adjust. Undo brings back what you had.",
      },
      {
        title: "Bring in your card from Excel",
        text: "Already have your report card in Excel? Upload it instead of starting over.",
        steps: [
          ["In the sheet, open <strong>File</strong> and select <strong>Upload Excel (.xlsx)</strong>.", "rt-upload.webp", "File, then Upload Excel (.xlsx)."],
          "Choose the file. Its text, merged cells, fonts, fill colors, borders and column widths come across from the first sheet in the file.",
          "Replace the sample names and numbers with fields, as shown below.",
        ],
        note: "You can also copy a range in Excel or Google Sheets and paste it straight into the sheet.",
      },
      {
        title: "Add fields",
        steps: [
          "Select the cell where a detail belongs.",
          ["Open <strong>Fields</strong> and click a field to put it in that cell. You can also type a field, or copy one with its copy button.", "rt-fields.webp", "Fields: grouped by School, Term, Student, Results, Subjects and more, with a search box."],
          "For subjects, put the subject fields side by side in one row, under a row of headings. That one row repeats for each subject.",
        ],
      },
      {
        title: "Fields you can use",
        text: "The <strong>Fields</strong> panel lists every field; your school's own remark types appear there under Remarks. These are the ones schools use most.",
        subsections: [
          {
            title: "Student and results",
            table: [
              ["Field", "Prints"],
              ["<code>{{student.name}}</code>", "Full name. Also <code>first_name</code> and <code>last_name</code>."],
              ["<code>{{student.id}}</code>, <code>{{student.class}}</code>", "Student ID and class."],
              ["<code>{{student.photo}}</code>", "The student's photo."],
              ["<code>{{student.position_in_class}}</code>", "Position, e.g. <em>12th / 18 students</em>. Use <code>student.position</code> for just <em>12th</em>."],
              ["<code>{{student.overall}}</code>", "Overall percentage and score, e.g. <em>78.00 % | 624.00 / 800.00</em>."],
              ["<code>{{student.average}}</code>", "Average percentage."],
              ["<code>{{student.promoted_to}}</code>", "The class the student moves up to, when promotion is on."],
            ],
          },
          {
            title: "Subjects (the row repeats for each subject)",
            table: [
              ["Field", "Prints"],
              ["<code>{{subject.no}}</code>", "Row number: 1, 2, 3…"],
              ["<code>{{subject.name}}</code>", "Subject name."],
              ["<code>{{subject.class_score}}</code>, <code>{{subject.exam_score}}</code>", "Class and exam scores."],
              ["<code>{{subject.total}}</code>, <code>{{subject.percentage}}</code>", "Total score and percentage."],
              ["<code>{{subject.grade}}</code>, <code>{{subject.position}}</code>", "Grade, and position in the subject."],
              ["<code>{{subject.remark}}</code>", "Remark, e.g. <em>Excellent</em>."],
              ["<code>{{subject.mark:Excellent}}</code>", "A ✓ when the remark or grade is Excellent."],
            ],
          },
          {
            title: "School, term and attendance",
            table: [
              ["Field", "Prints"],
              ["<code>{{school.name}}</code>, <code>{{school.motto}}</code>", "School name and motto."],
              ["<code>{{school.address}}</code>, <code>{{school.phone}}</code>", "Address and phone."],
              ["<code>{{school.logo}}</code>", "Your logo."],
              ["<code>{{term.name}}</code>, <code>{{term.year}}</code>", "Term and school year."],
              ["<code>{{term.next_begins}}</code>", "When school reopens."],
              ["<code>{{attendance.present}}</code>, <code>{{attendance.total}}</code>", "Days present, and days school was open. Also <code>attendance.absent</code>."],
            ],
          },
          {
            title: "Remarks, fees and signature",
            table: [
              ["Field", "Prints"],
              ["<code>{{remarks.teacher}}</code>", "The teacher's remark. Also <code>conduct</code>, <code>attitude</code> and <code>interest</code>."],
              ["<code>{{fees.outstanding}}</code>", "Balance due. Also <code>total_billed</code> and <code>total_paid</code>. Filled from PayGira when bills are set to show in Report Settings."],
              ["<code>{{signature.image}}</code>", "The signature from Report Settings."],
              ["<code>{{signature.name}}</code>, <code>{{signature.title}}</code>", "Who signed, and their title."],
              ["<code>{{grades.key}}</code>", "Your grading key, e.g. <em>A (90 to 100) = Excellent</em>."],
            ],
          },
        ],
      },
      {
        title: "Examples",
        subsections: [
          {
            title: "A score table",
            text: "Headings in one row, and the subject fields in the row under it.",
            tables: [
              { label: "In your sheet", rows: [
                ["Subject", "Total", "Grade", "Remark"],
                ["<code>{{subject.name}}</code>", "<code>{{subject.total}}</code>", "<code>{{subject.grade}}</code>", "<code>{{subject.remark}}</code>"],
              ] },
              { label: "Prints", rows: [
                ["Subject", "Total", "Grade", "Remark"],
                ["Mathematics", "92.00", "A", "Excellent"],
                ["Science", "85.00", "B", "Very Good"],
                ["Social Studies", "78.00", "C", "Good"],
              ] },
            ],
          },
          {
            title: "Tick boxes",
            text: "Put <code>mark:</code> and a remark or grade in each column. A ✓ appears in the column that matches the student's result.",
            tables: [
              { label: "In your sheet", rows: [
                ["Subject", "Excellent", "Very Good"],
                ["<code>{{subject.name}}</code>", "<code>{{subject.mark:Excellent}}</code>", "<code>{{subject.mark:Very Good}}</code>"],
              ] },
              { label: "Prints", rows: [
                ["Subject", "Excellent", "Very Good"],
                ["Reading", "✓", ""],
                ["Mathematics", "", "✓"],
              ] },
            ],
            note: "Add a column for each remark or grade you use. The word after <code>mark:</code> must match it; capital letters don't matter.",
          },
          {
            title: "A sentence",
            code: "{{student.first_name}} attended {{attendance.present}} of {{attendance.total}} days this term.",
            prints: "Noah attended 58 of 61 days this term.",
          },
          {
            title: "One subject in a fixed place",
            text: "Put the subject's name in square brackets. The line doesn't repeat.",
            code: "Mathematics: {{subject[Mathematics].total}} ({{subject[Mathematics].grade}})",
            prints: "Mathematics: 92.00 (A)",
          },
          {
            title: "Pictures at the size you want",
            text: "Add a colon and a height in pixels to the logo, photo or signature.",
            code: "{{school.logo:120}}   {{student.photo:90}}   {{signature.image:60}}",
            note: "Without a size, the logo prints 80 pixels tall, a photo 90 and a signature 50.",
          },
          {
            title: "Choice results",
            text: "For assessments recorded as a choice (Yes / No, Pass / Fail), use the assessment's name after <code>choice:</code>. In the subject row, <code>{{subject.choice:Practical}}</code> prints that subject's result for <em>Practical</em>. <code>{{choices.all}}</code> lists every choice result in one line.",
          },
        ],
      },
      {
        title: "Use it for your classes",
        steps: [
          ["Open <strong>Settings</strong>. Under <strong>Report card</strong>, turn on <strong>Use as a report card</strong>.", "rt-settings.webp", "Settings, Report card: turn it on, choose the classes, then save."],
          "Under <strong>Classes</strong>, choose every class that should print with this layout, then select <strong>Save</strong>.",
        ],
        note: "Each class uses one template. Choosing a class here moves it from any other template, and classes without one keep the standard report card, so you can roll out a new layout one class at a time.",
      },
      {
        title: "Preview and print",
        steps: [
          ["Under <strong>Preview with real data</strong>, choose a class and select <strong>Preview</strong>. The class's report cards open in a new tab.", "rt-preview.webp", "The preview: your layout filled in for each student, with a row for every subject."],
          "Adjust the sheet and preview again until it looks right.",
          "Print as usual: open <strong>Reports</strong>, then <strong>Term Reports</strong>, then <strong>Terminal reports</strong>. The classes you chose print with your layout.",
        ],
      },
    ],
    faq: [
      ["A field prints blank.", "Check the spelling between the braces, and that the student has that information this term. For example, remarks must be entered first, and fees show only when bills are set to show in Report Settings."],
      ["The subject row prints only once.", "Make sure the row has a field that starts with <code>subject.</code>, like <code>{{subject.name}}</code>. Fields for one named subject, like <code>{{subject[Mathematics].total}}</code>, stay in place on purpose."],
      ["Can each grade level have its own layout?", "Yes. Make one template for each layout and choose its classes. Each class uses one template at a time."],
      ["Why can't I download the template?", "A file used as a report card can't be downloaded. Print report cards from Terminal reports, or turn off <strong>Use as a report card</strong> to download the file."],
    ],
    related: ["report-card", "report-settings", "docs-and-sheets"],
  },
  {
    slug: "merit-sheet",
    title: "Merit sheets",
    topic: "Reports & analytics",
    order: 4,
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
    order: 5,
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
    order: 6,
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
    order: 7,
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
