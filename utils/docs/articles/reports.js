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
          "Attendance for the term (and overall lunch, if your school uses lunch and turns it on in Report Settings), and the dates the term began and ends, and when school reopens.",
          "Teacher and principal comments, conduct and interest remarks, and signatures. If your school has remarks in the Custom editor, teachers write them in its <a href=\"/legal/user-documentation/custom-editor\">Report card remarks</a> form.",
          "Your school's own sections, such as skills and effort, filled in by teachers each term. Build them in the <a href=\"/legal/user-documentation/custom-editor\">Custom editor</a>.",
          "The promotion decision: <strong>Promoted To</strong> or <strong>Repeated In</strong> a class. Save it with the report; promotion uses it. See <a href=\"/legal/user-documentation/promote-students-and-manage-graduation\">Promotion</a>.",
        ],
        tip: "Generate one class first and check a few students' report cards before generating the whole school.",
      },
    ],
    faq: [
      ["A subject is missing from a report card.", "Check the student is enrolled in that subject this term, and that its assessments have scores."],
      ["The grades look wrong.", "Check the grading scale in Report Settings and the assessment weights for the term."],
      ["Can parents download report cards?", "Yes. See <a href=\"/legal/user-documentation/parent-grades-and-report-cards\">Grades and report cards</a> in the parent portal guides."],
      ["Parents or students in one class can't see report cards.", "If your school has Class settings, check that class's <strong>Share with</strong>, <strong>Report cards</strong> boxes. A class that doesn't share report cards with parents doesn't send them the report card notice or email either. See <a href=\"/legal/user-documentation/class-settings\">Class settings</a>."],
    ],
    related: ["report-settings", "report-card-templates", "merit-sheet", "configure-dynamic-grading-and-remarks", "promote-students-and-manage-graduation", "grading-or-marking-assessment"],
  },
  {
    slug: "report-settings",
    title: "Report settings",
    topic: "Reports & analytics",
    order: 2,
    summary: "Choose what report cards show: score columns, grade mapping, remarks, promotion rules, reopening date and signatures for report cards and transcripts.",
    tags: ["report settings", "report card design", "signature", "grade mapping", "remarks", "promotion cut-off", "overall lunch", "lunch on report cards"],
    who: "Managers, and staff given <strong>Report Settings</strong>.",
    sections: [
      {
        title: "Set up report cards",
        steps: [
          ["Open <strong>Reports</strong>, then <strong>Report Settings</strong>.", "report-settings.webp", "Reports, Report Settings."],
          "For each class, set the <strong>Promoted Class</strong>, <strong>Repeated Class</strong>, <strong>Cut-Off Point</strong> and <strong>School Reopen Date</strong>. You can apply them to several classes at once.",
          "Open <strong>Advanced</strong> to choose the score columns and which sections appear.",
          "Add your <strong>Grade Mapping</strong> (for example A = 90–100) and <strong>Score Remarks</strong> (for example Excellent = 90–100).",
          "Add <strong>Global Remarks</strong> for teacher comments, conduct, interest and attitude. If your school has remarks in the Custom editor, there's no remarks card here: set them up with the <strong>Report card remarks</strong> form (see <a href=\"/legal/user-documentation/custom-editor\">Custom editor</a>).",
          "For anything else you grade each term (effort, work habits, skills), build a section in the <a href=\"/legal/user-documentation/custom-editor\">Custom editor</a> and tick <strong>Show on report cards</strong>.",
          "Add a <strong>Report Signature</strong>, and a transcript signature, and assign them to classes.",
          "Save, then preview one student's report card before rolling out.",
        ],
        tip: "Set up one class completely, check its report card, then copy the settings to the rest.",
      },
      {
        title: "Choose which forms print on report cards",
        text: "Forms built in the Custom editor with <strong>Show on report cards</strong> ticked, remarks included, print for the classes they're for.",
        steps: [
          "In <strong>Report Settings</strong>, choose the class and open <strong>Advanced</strong>.",
          "If your school has remarks in the Custom editor, every form that prints on report cards is listed, each with a tick, and <strong>Select all</strong>. They all print until you untick one. Otherwise, <strong>Custom editor sections</strong> turns them all on or off.",
          "Select <strong>Save Advanced</strong>.",
        ],
      },
      {
        title: "Print overall lunch on report cards",
        text: "If your school takes lunch on the attendance page, report cards can show each student's lunch for the term beside their attendance.",
        steps: [
          "In <strong>Report Settings</strong>, choose the class and term and open <strong>Advanced</strong>.",
          "Tick <strong>Overall lunch</strong>, beside Attendance under Report Sections. It's off until you turn it on.",
          "Select <strong>Save Advanced</strong>.",
        ],
        example: "The report card shows <em>Lunch: 42 of 58 days</em> beside attendance, or <em>—</em> if lunch wasn't taken that term.",
      },
    ],
    related: ["report-card", "report-card-templates", "configure-dynamic-grading-and-remarks", "transcript", "mark-attendance-for-a-class"],
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
              ["<code>{{attendance.lunch}}</code>", "Lunch for the term, e.g. <em>42 of 58 days</em>, when <strong>Overall lunch</strong> is on in Report Settings, Advanced. Also <code>attendance.lunch_days</code> (days with lunch) and <code>attendance.lunch_taken</code> (days lunch was taken). Listed for schools that use lunch."],
            ],
          },
          {
            title: "Remarks, fees and signature",
            table: [
              ["Field", "Prints"],
              ["<code>{{remarks.teacher}}</code>", "The teacher's remark. Also <code>conduct</code>, <code>attitude</code> and <code>interest</code>."],
              ["<code>{{forms.all}}</code>", "The student's answers to Custom editor sections set to show on report cards, e.g. <em>Skills &amp; effort – Effort: Good, Homework: Excellent</em>."],
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
    tags: ["transcript", "official transcript", "academic record", "graduates", "signature", "transcript design", "registrar"],
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
      {
        title: "Choose a transcript design",
        steps: [
          "Open <strong>Report Settings</strong> and find <strong>Transcript Design</strong>. Select <strong>Preview</strong> under any design to see it with a sample student (no real record is shown).",
          "Choose the design and select <strong>Save design</strong>. Every transcript, including the emailed official copy, uses it.",
        ],
        table: [
          ["Design", "What it looks like"],
          ["<strong>Standard</strong>", "The original Managira transcript, with a table for each term."],
          ["<strong>Classic</strong>", "A traditional record: serif type, the school's crest, each school year's terms side by side, a seal and the signature."],
          ["<strong>Modern</strong>", "A header in the school's colour, a summary with the GPA at a glance, and each term in its own card."],
          ["<strong>Compact</strong>", "The whole record on as few pages as possible, with terms in a neat grid."],
          ["<strong>Registrar</strong>", "A college registrar's record: terms in two columns, each course's credits and quality points, term and cumulative totals under every term, and transcript statistics at the end."],
        ],
        note: "Every design shows each term's GPA and the cumulative GPA to date (see <a href=\"/legal/user-documentation/gpa-on-report-cards-and-transcripts\">GPA on report cards and transcripts</a>), and a printed copy ends with an About this transcript page. On a transcript, the <strong>Design</strong> menu opens it in another design to compare.",
      },
    ],
    related: ["report-settings", "promote-students-and-manage-graduation", "report-card", "gpa-on-report-cards-and-transcripts"],
  },
  {
    slug: "report-builder",
    title: "Report Builder",
    topic: "Reports & analytics",
    order: 6,
    summary: "Build any report you need: students, attendance, grades, staff, fees, messages, transportation and more. Filter, choose columns, save, share, export or email.",
    tags: ["report builder", "custom reports", "export", "csv", "excel", "word", "attendance report", "lunch report", "data"],
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
          ["Students", "Students; answers to your custom forms; admissions and enrollment"],
          ["Academics", "Assessment results, online tests, merit sheets"],
          ["Attendance", "Each mark, per student, per class &amp; day; and lunch, where your school takes it (see below)"],
          ["Families", "Parents and guardians, parent messages"],
          ["Communication", "Messages sent, failed emails"],
          ["Staff", "Staff, staff tasks, activity log"],
          ["Finance", "Fee balances, payments"],
          ["Calendar", "Announcements, events"],
          ["Transportation", "Riders, bus requests, trips, arrival checks, driver reports, buses, drivers, routes"],
        ],
      },
      {
        title: "Attendance and lunch reports",
        text: "Under <strong>Students</strong>, <strong>Attendance</strong>:",
        table: [
          ["Report", "Shows"],
          ["<strong>Per student</strong>", "Each student's days present and absent and attendance %. Add <strong>School days</strong>, <strong>Present on school days</strong> and <strong>Attendance % of school days</strong> to match the attendance page's Overall."],
          ["<strong>Lunch each day</strong>", "Date, student, class, had lunch, attendance that day, and who marked it and when."],
          ["<strong>Lunch per student</strong>", "Days with lunch, days without, days not recorded, and lunch %."],
          ["<strong>Lunch per class &amp; day</strong>", "For each class and day: had lunch, no lunch, and lunch %."],
        ],
        note: "Lunch reports show when your school takes lunch, for staff with <strong>Mark Attendance</strong>. Teachers see their own classes.",
      },
      {
        title: "Examples: reports schools use every week",
        subsections: [
          {
            title: "Students who missed more than five days this month",
            steps: [
              "Choose <strong>Attendance</strong>, then <strong>Per student</strong>.",
              "Filter the dates to this month, and the class if you want one grade.",
              "Sort by days absent, highest first, and keep the students with more than five.",
              "Run it, then email it to your counselor or export it.",
            ],
          },
          {
            title: "Students who often go without lunch",
            steps: [
              "Choose <strong>Attendance</strong>, then <strong>Lunch per student</strong>.",
              "Filter to the term and class, and days without lunch to <strong>3 or more</strong>.",
              "Sort by lunch %, lowest first, and share it with your counselor or nurse.",
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
    related: ["state-reporting-files", "analytical-dashboard", "merit-sheet", "transportation-reports"],
  },
  {
    slug: "state-reporting-files",
    title: "State reporting files",
    topic: "Reports & analytics",
    order: 6.5,
    summary: "Turn a saved report into your state's file (CSV, tab, pipe or fixed width), check it, make it on count dates or a schedule, and record what you sent.",
    tags: ["state reporting", "state report", "state submission", "october count", "census day", "count day", "fixed width", "flat file", "state codes", "ceds", "edfacts", "sis state file", "state upload"],
    who: "Staff given <strong>Report Builder</strong> and <strong>State Reporting</strong> (Reports permissions). Only the person who saved a report changes how its file is written.",
    intro: "Every state publishes its own file layouts for collections such as the October count, attendance and end-of-year reports. Most take a CSV or a fixed-width text file; a few take data through the Ed-Fi API instead. With State file, a saved Report Builder report is written exactly the way your state's layout asks: its field names, order, widths, date style and codes.",
    sections: [
      {
        title: "Build the report",
        steps: [
          "In <strong>Report Builder</strong>, choose the report your state's layout matches (for example <strong>Students</strong> for an enrollment file), and pick the columns in the state's order.",
          "Add the filters the collection needs (for example current students only), and <strong>Save</strong> the report.",
          "Your school's own student fields, such as race and ethnicity, Programs &amp; Indicators or a state student ID (Admissions › Admission Settings › Student fields), are columns too, under Student fields.",
        ],
      },
      {
        title: "Write it the state's way",
        steps: [
          "On the saved report, select <strong>State file</strong>.",
          "<strong>Format</strong>: choose comma-separated (CSV), tab, pipe or fixed width, the date style (CCYYMMDD is the most common), line endings, a header row, and the file name.",
          "<strong>Fields</strong>: give each column the state's field name. For fixed width, give each a width; numbers are padded with zeros and text with spaces unless you choose otherwise. Tick <strong>Required</strong> for fields the state requires.",
          "Use <strong>Codes</strong> to turn your values into the state's: ready-made sets for sex (M / F / X), yes / no (Y / N or 1 / 0) and grade levels (PK, KG, 01 to 12), or your own (for example Free → 01). A field can also carry the same value in every row, such as your district or school code.",
          "Select <strong>Check file</strong>: it lists empty required fields, values too long for their width and values without a state code, and shows the first lines of the file. Fix them, then <strong>Save</strong>.",
        ],
        tip: "Keep your state's file layout open beside you. Layouts change most years, so check the field list each fall.",
      },
      {
        title: "Make it on the state's dates",
        list: [
          "<strong>Count dates</strong>: add the days your state counts students (such as the first Wednesday in October). On each, the file is made from that day's records.",
          "<strong>Repeat</strong>: for collections sent regularly, make it every weekday, every week or every month, at the time you choose.",
          "When a file is made, you and the people the report is shared with who have State Reporting get an email that it's ready. The email has no student data and no attachment.",
          "You can also select <strong>Make file now</strong> at any time.",
        ],
      },
      {
        title: "Download, send and keep a record",
        steps: [
          "Open <strong>Files</strong>, type your password and select <strong>Download</strong>.",
          "Upload the file to your state's portal, as the state's instructions say.",
          "Select <strong>Mark as sent</strong>, with the state's confirmation number if it gives one. The list shows who made, downloaded and sent each file, with its fingerprint, so you can show exactly what went to the state.",
        ],
      },
      {
        title: "How your students' data is protected",
        list: [
          "State files are never emailed. Each file is kept encrypted in Managira for a year, then its content is removed and its record stays.",
          "Downloading asks for your own password every time, and every file made, downloaded or marked as sent is in your activity log.",
          "Each file shows only what the report's owner could see; a file made on a schedule uses the owner's access on that day, and stops if they no longer hold State Reporting.",
        ],
      },
    ],
    faq: [
      ["Can Managira send the file to the state for us?", "Today the file is made automatically and you upload it to your state's portal. Sending straight to a state's secure file server (SFTP) is the next step; ask Managira support if your state accepts it."],
      ["Does Managira support Ed-Fi?", "Not yet. States that collect through the Ed-Fi API (such as Texas, Wisconsin and Michigan) certify each vendor; contact Managira support to discuss your state."],
      ["Our state wants a code we don't keep, such as a state school number.", "Add it as the same value in every row on that field, or keep it as a student field if it differs by student."],
    ],
    related: ["report-builder", "gpa-on-report-cards-and-transcripts", "edit-student-information"],
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
  {
    slug: "gpa-on-report-cards-and-transcripts",
    title: "GPA on report cards and transcripts",
    topic: "Reports & analytics",
    order: 30,
    summary: "How term and cumulative GPA are worked out, where they show, course credits, Honors and AP weights, and keeping GPA from families.",
    tags: ["gpa", "grade point average", "weighted gpa", "unweighted gpa", "honors", "ap", "ib", "cumulative gpa", "term gpa", "semester gpa", "credits", "course credits", "quality points", "transcript gpa", "report card gpa", "parent portal gpa", "student portal gpa"],
    who: "Managers, and staff given <strong>Report Settings</strong>. Only managers and supervisors change the Honors and AP weights. Sharing with families is set in <strong>Class settings</strong>.",
    intro: "Managira works out GPA the way registrars do, on the standard 4.0 scale from your grade letters: A 4.0, A− 3.7, B+ 3.3, B 3.0, B− 2.7, C+ 2.3, C 2.0, C− 1.7, D+ 1.3, D 1.0, D− 0.7, F 0 (A+ stays 4.0). A grade that isn't a letter (Pass, or a number such as 1 to 9) doesn't count, so a class graded with numbers shows no GPA.",
    sections: [
      {
        title: "How term and cumulative GPA are worked out",
        list: [
          "<strong>Term GPA</strong> (semester GPA) counts only that term's courses.",
          "<strong>Cumulative GPA</strong> counts every course from every finished term up to then: all the grade points over all the credits. It is not an average of the term GPAs, so a term with more courses or credits counts for more.",
          "Each course counts by its credits when your school uses <strong>course credits</strong> (below); otherwise every course counts once. Grade points × credits are the course's quality points, and GPA = quality points ÷ credits.",
          "An F counts with no points. Pass, withdrawn and incomplete grades don't count.",
          "GPAs are worked out exactly and rounded to two decimal places once, at the end.",
        ],
      },
      {
        title: "On transcripts",
        list: [
          "Every transcript shows, under each finished term, its <strong>Term</strong> GPA and the <strong>Cumulative</strong> GPA to date (weighted beside unweighted when Honors or AP subjects apply), and ends with the cumulative GPA. There is nothing to turn on.",
          "Where courses carry credits, each course shows its credits, and each term and the whole record show the credits earned (and attempted, when a course was failed).",
          "A printed or emailed transcript ends with an <strong>About this transcript</strong> page: the grade scale, how GPA is worked out, and notes on official copies and privacy.",
          "A term counts once it has ended. The current term appears after its end date, and a term that hasn't started never counts.",
          "If your school moved from another system, each student's GPA from it is printed exactly as it was (weighted and unweighted), never worked out again.",
        ],
      },
      {
        title: "Course credits",
        steps: [
          "Open <strong>Report Settings</strong>, choose the class, then open <strong>What prints on report cards</strong>.",
          "Under <strong>GPA weights</strong>, type each subject's <strong>Credits</strong> beside its level (for example 1 for a full-year course, 0.5 for a semester course). An empty box counts as 1.",
          "Select <strong>Save GPA weights</strong>. Transcripts, report cards and the parent and student portals then count each course by its credits.",
        ],
        note: "Credits are offered where your school has course credits turned on. Until a subject has credits, every course counts once, exactly as before.",
      },
      {
        title: "Show GPA on report cards",
        steps: [
          "Open <strong>Report Settings</strong> and choose the class and term.",
          "Open <strong>What prints on report cards</strong>, tick <strong>GPA</strong> under <strong>Also on the report card</strong>, and select <strong>Save</strong>.",
          "Report cards for that class and term now show the term's GPA. Layouts can print it with <code>{{grades.gpa}}</code> and <code>{{grades.gpa_weighted}}</code>.",
        ],
      },
      {
        title: "Parents and students",
        steps: [
          "Parents see GPA on their child's page and students on their dashboard: this term's GPA so far, and the cumulative GPA over finished terms.",
          "Only grades families can already see count: a subject with a score still waiting for the teacher's approval is left out until it's approved.",
          "To keep GPA from a class's parents or students, open <strong>Class settings</strong> for the class and untick <strong>GPA</strong> under <strong>Share with</strong> for <strong>Parents</strong>, <strong>Students</strong> or both. It's shared until you turn it off.",
        ],
      },
      {
        title: "Honors and AP weights",
        steps: [
          "In <strong>What prints on report cards</strong>, under <strong>GPA weights</strong>, set what <strong>Honors</strong> and <strong>AP / IB</strong> add to a passing grade (0.5 and 1.0 unless you change them).",
          "Set each of the class's subjects to <strong>Regular</strong>, <strong>Honors</strong> or <strong>AP / IB</strong>.",
          "Select <strong>Save GPA weights</strong>.",
        ],
        note: "Transcripts, report cards and the portals then show the weighted GPA beside the unweighted one. A failing grade never gets a bonus.",
      },
    ],
    related: ["report-card", "transcript", "moving-to-managira"],
  },
];
