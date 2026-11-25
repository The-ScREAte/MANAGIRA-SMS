"use strict";

// Reports & analytics: Terminal reports (report cards), Report settings, report card layouts, transcripts, GPA,
// merit sheets, Report builder, Gov/state reports and Organization stats.
// Pictures: ~/.managira-local-copy/tools/docshots/scripts/reports-*.js
const T = "Reports & analytics";
const link = (slug, title) => `<a href="/legal/user-documentation/${slug}">${title}</a>`;

module.exports = [
  // ---------------------------------------------------------------------------------------------
  {
    slug: "report-card",
    title: "Generate, check and print report cards",
    topic: T,
    order: 1,
    summary: "Open a term, generate a class's report cards, add remarks, then print them or download them as one PDF.",
    tags: ["report cards", "terminal reports", "term report", "print report cards", "download report cards", "pdf", "progress report", "generate report", "quick actions", "save changes", "print report cards for the whole class", "how do I print report cards", "print a class's report cards"],
    featured: true,
    who: "Managers and supervisors, and staff given <strong>Terminal Reports</strong>. A teacher sees only their own classes.",
    intro: "A report card gathers one student's term: each subject's scores, grade and remark, attendance, comments and signatures. Generate a whole class at once, check it, then print it.",
    sections: [
      {
        title: "Open a term and a class",
        steps: [
          ["Open <strong>Reports</strong>, then <strong>Term reports</strong>, then <strong>Terminal reports</strong>.", "reports-terms.webp", "Reports, Term reports, Terminal reports."],
          ["Choose the term. The current school year is on top and past school years are listed below it."],
          ["Find the class and select <strong>Generate report</strong>. The button says <strong>Generating…</strong> until the report cards open.", "reports-classes.webp", "Every class in the term has its own Generate report button."],
        ],
        note: "A teacher sees only the classes they lead or teach. If the button is missing, the page says <strong>Report cards need Terminal Reports</strong>: ask a manager for that permission.",
        example: "Open Fall Semester, then <strong>Generate report</strong> beside <em>6th Grade</em> to see Audrey Diaz's report card and her classmates'.",
      },
      {
        title: "Check the report cards",
        text: "The page is one report card per student, one under the other. The school's name, address and logo come from your school's profile.",
        steps: [
          ["Scroll through the cards. Each shows the student's details, every subject with its scores, grade, position and remark, then attendance, remarks and the signature.", "reports-card.webp", "A class's report cards, with the toolbar on top."],
          ["Use <strong>Search student…</strong> to jump to one student. Check <strong>Select All</strong>, or the small box at the top right of a card, to choose which cards the next action uses."],
        ],
        list: [
          "<strong>Quick Actions</strong>: Print Selected, Download PDF, Send Report and History (see below).",
          "<strong>Save Changes</strong>: saves remarks and any attendance you typed by hand.",
          "What each card shows is set in " + link("report-settings", "Report settings") + ". A class with its own layout shows a small layout tag by its name on the term page: select the tag to see the standard card instead. See " + link("report-card-templates", "Custom report card templates") + ".",
        ],
      },
      {
        title: "Add remarks",
        text: "Remarks (conduct, attitude, interest and the teacher's remark, plus any you add) are written on the card.",
        steps: [
          ["Beside a remark, select the round arrow to pick one of your school's ready-made remarks, or type your own in the line."],
          ["Select <strong>Save Changes</strong> at the top right. Do this before you print or send, so the remarks are on the copies."],
        ],
        tip: "Ready-made remarks are written once in " + link("report-remarks-and-signatures", "Report remarks and signatures") + ". Forms your school builds in the " + link("custom-editor", "Custom editor") + " can print on the card too.",
      },
      {
        title: "Print or download",
        steps: [
          ["Check the cards you want, or <strong>Select All</strong>, then open <strong>Quick Actions</strong>."],
          ["Choose <strong>Print Selected</strong> to print, or <strong>Download PDF</strong> for one PDF file. The button says it is working until the file is ready."],
        ],
        list: [
          "<strong>Send Report</strong> posts the cards to families and can tell them by email, text or WhatsApp: " + link("report-card-send-and-history", "Send report cards and see what was sent") + ".",
          "<strong>History</strong> opens everything sent for this class and term.",
          "<strong>Schedule Promotion</strong> appears only when promotion is turned on for the class: " + link("promote-students-and-manage-graduation", "Promotion") + ".",
        ],
      },
    ],
    faq: [
      ["A subject is missing from a report card.", "Check the student is enrolled in that subject this term, and that its assessments have scores."],
      ["The grades look wrong.", "Check the grade scale for the class in " + link("report-settings-grades-and-promotion", "Grades and promotion") + " and the assessment weights for the term."],
      ["Who can open the report cards in the parent and student portals?", "That is a class choice. See " + link("class-settings", "Class settings") + " (Share with)."],
      ["Where are merit sheets?", "In Report builder: " + link("merit-sheet", "Merit sheets") + "."],
    ],
    related: ["report-card-send-and-history", "report-settings", "report-remarks-and-signatures", "report-card-templates", "merit-sheet", "class-settings"],
  },

  // ---------------------------------------------------------------------------------------------
  {
    slug: "report-card-send-and-history",
    title: "Send report cards to families and see what was sent",
    topic: T,
    order: 1.1,
    summary: "Post a class's report cards to the parent and student portals, tell families by email, text or WhatsApp, and check the history.",
    tags: ["send report cards", "email report cards", "post report cards", "publish report cards", "notify parents", "whatsapp report cards", "text report cards", "report card history", "resend", "email history"],
    who: "Staff given <strong>Terminal Reports</strong>. You confirm with your own password.",
    intro: "Sending does two things: it posts the report cards to the portals, and it tells families they are ready. Both happen from one window.",
    sections: [
      {
        title: "Send report cards",
        steps: [
          ["Open the class's report cards (" + link("report-card", "Generate report cards") + "), check the students, and open <strong>Quick Actions</strong>. Choose <strong>Send Report</strong>."],
          ["The window <strong>Send report</strong> opens and counts the guardians of the students you checked.", "reports-send.webp", "Send report, on the right."],
          ["Leave <strong>Parent + student portal</strong> checked to post the cards, so families open them in their portal. Uncheck it if you only want to send a message."],
          ["Under <strong>Notify via</strong> choose at least one way: <strong>Email</strong>, <strong>WhatsApp</strong> or <strong>SMS</strong>. WhatsApp and SMS are offered where your school has them set up."],
          ["Read the <strong>Message</strong> and change it if you like. The words in double braces, such as the student's name and class, are filled in for each family."],
          ["Type your password under <strong>Password</strong>, then select <strong>Send</strong>. Confirm the question that follows."],
        ],
        note: "<strong>Send</strong> stays gray until you choose a way to notify and a family has a contact for it. Report cards go out from reports@managira.com with your school's name.",
      },
      {
        title: "Check or change who gets it",
        steps: [
          ["Check <strong>Email</strong>, then select <strong>Contacts</strong> beside it. A list of the students and their parents' addresses opens.", "reports-send-email.webp", "Contacts, beside Email."],
          ["Edit an address, add one with the + button, or uncheck a person to skip them. A parent already sent this card shows <strong>Already sent</strong> and is unchecked. Select <strong>Done</strong>.", "reports-send-contacts.webp", "Email contacts for the students you checked."],
        ],
        tip: "WhatsApp and SMS have a <strong>Contacts</strong> list too. A text longer than one segment shows its length under the message.",
      },
      {
        title: "See what was sent",
        steps: [
          ["From the report cards, choose <strong>Quick Actions</strong> then <strong>History</strong>.", "reports-history.webp", "History for 6th Grade, Fall Semester."],
          ["The tiles on top count <strong>Total Jobs</strong>, <strong>Sent</strong>, <strong>Pending</strong>, <strong>Failed</strong> and <strong>Report PDF Ready</strong>."],
          ["Open <strong>Filters</strong> to narrow by class, term, student, status, report or transcript, dates, batch or a word, then select <strong>Refresh</strong>. <strong>Clear Filters</strong> starts again."],
        ],
        list: [
          "A batch of messages is one row. <strong>View</strong> shows each recipient's result.",
          "<strong>Open PDF</strong> opens the report card that was sent. <strong>PDF pending</strong> means it is still being made.",
          "<strong>Resend</strong> sends a batch again.",
          "A teacher sees the history of their own classes only.",
        ],
      },
    ],
    faq: [
      ["Families didn't get the email.", "Open History and check the status. Check the address under Contacts, and ask the parent to look in spam."],
      ["Send is gray.", "Check at least one way under Notify via, and make sure a family has an address or number for it."],
      ["Can I send a message without posting?", "Yes. Uncheck Parent + student portal, choose how to notify, and send."],
    ],
    related: ["report-card", "report-settings", "class-settings", "parent-grades-and-report-cards"],
  },

  // ---------------------------------------------------------------------------------------------
  {
    slug: "report-settings",
    title: "Report settings: choose what appears on report cards",
    topic: T,
    order: 2,
    summary: "Choose a class, then decide which score columns, sections, attendance, lunch, remarks and forms appear on its report cards.",
    tags: ["report settings", "report card design", "score columns", "scaled score", "overall lunch", "lunch on report cards", "attendance on report card", "custom editor sections", "subject scaling", "billing table", "grade key", "report card sections", "report card remarks", "where are report card remarks set up", "remark types"],
    who: "Managers, and staff given <strong>Report Settings</strong>. A new teacher's default permissions leave it out.",
    intro: "Report settings has five cards. This guide covers <strong>Promotion &amp; grading by class</strong> and its <strong>What prints on report cards</strong> part. The others have their own guides.",
    sections: [
      {
        title: "Open Report settings",
        steps: [
          ["Open <strong>Reports</strong>, then <strong>Term reports</strong>, then <strong>Report settings</strong>.", "reports-settings.webp", "Reports, Term reports, Report settings."],
        ],
        table: [
          ["Card", "What it holds", "Guide"],
          ["Promotion &amp; grading by class", "Promotion rules, the grade scale and what prints, one class at a time", "This guide and " + link("report-settings-grades-and-promotion", "Grades and promotion")],
          ["Report Card Layout", "Which class uses which custom layout", link("report-card-templates", "Custom report card templates")],
          ["Report remarks", "Remark types and ready-made remarks", link("report-remarks-and-signatures", "Report remarks and signatures")],
          ["Signature Management", "Signatures for report cards and transcripts", link("report-remarks-and-signatures", "Report remarks and signatures")],
          ["Transcript Design", "The look of every transcript", link("transcript-design", "Choose a transcript design")],
        ],
      },
      {
        title: "Pick a class",
        steps: [
          ["Open <strong>Promotion &amp; grading by class</strong>. Every class is listed on the left. <strong>Set</strong> means the class has promotion settings; <strong>Not set</strong> means it has none yet.", "reports-settings-class.webp", "Classes on the left, the chosen class on the right."],
          ["Select a class. Everything on the right, including what prints, is for that class."],
        ],
        tip: "Set up one class completely and check its report card. Then copy the choices to the others with the <strong>Apply to all classes</strong> and <strong>Select classes</strong> options that appear beside the promotion and subject scaling choices.",
      },
      {
        title: "Choose what prints",
        steps: [
          ["Under <strong>Grades</strong>, open <strong>What prints on report cards</strong>.", "reports-settings-prints.webp", "The panel opens in the class's settings."],
          ["Check the columns in <strong>Scores</strong>: <strong>Class Score</strong>, <strong>Exams Score</strong>, <strong>Other Score</strong>, <strong>Total Score</strong>, <strong>Scaled Score</strong>, <strong>Overall %</strong>, <strong>Grade</strong>, <strong>Position</strong> and <strong>Remarks Col</strong>. The arrows beside Class Score and Exams Score choose which assessments count there."],
          ["Check the sections in <strong>Attendance &amp; lunch</strong>, <strong>Remarks</strong> and <strong>Also on the report card</strong> (below)."],
          ["Select <strong>Save</strong> at the bottom of the panel. Check one student's card before you roll it out."],
        ],
      },
      {
        title: "What each choice does",
        table: [
          ["Choice", "On the report card"],
          ["<strong>Subject scaling</strong>: Scale every subject to the same maximum", "Shows each subject out of one number (100 unless you change <strong>Maximum score per subject</strong>). <strong>Classes it applies to</strong> picks the classes."],
          ["<strong>Fees (PayGira)</strong>: Show the billing table", "Prints the student's bills on the card. More options appear once it is on."],
          ["<strong>Promotion</strong>: Use promotion this term, Promotion", "Prints the promoted or repeated decision. See " + link("promote-students-and-manage-graduation", "Promotion") + "."],
          ["<strong>Attendance</strong>", "Days present out of days school was open."],
          ["<strong>Overall lunch</strong>", "Lunch beside attendance, such as <em>42 of 58 days</em>, or a dash if lunch wasn't taken. Off until you check it."],
          ["<strong>Type attendance by hand</strong> and <strong>Out of</strong>", "Teachers type each student's days on the card, out of the number you set, instead of using the attendance page."],
          ["<strong>Teacher's, Conduct, Attitude and Interest remarks</strong>", "Which remark lines print."],
          ["<strong>Grade key</strong>", "The line explaining your grade scale."],
          ["<strong>Choice results</strong>", "Results recorded as a choice, such as Yes / No or Pass / Fail."],
          ["<strong>GPA</strong>", "The term GPA. See " + link("gpa-on-report-cards-and-transcripts", "GPA") + "."],
          ["<strong>Custom editor forms</strong>", "Forms from the " + link("custom-editor", "Custom editor") + " set to print on report cards. Each has its own check, and the report remarks form shows <em>prints as remarks</em>."],
        ],
      },
      {
        title: "When attendance is off for a class",
        text: "If a class doesn't take attendance or lunch (its <strong>Take attendance</strong> or <strong>Take lunch</strong> switch in Class settings), <strong>Attendance</strong>, <strong>Lunch</strong> and <strong>Type attendance by hand</strong> are grayed out here with <em>Attendance is off for this class.</em> (or <em>…this school.</em>), and the report card leaves them out. See <a href=\"/legal/user-documentation/class-settings\">Class settings</a>.",
      },
      {
        title: "Print overall lunch",
        text: "If your school takes lunch on the attendance page, the card can show each student's lunch for the term.",
        steps: [
          ["Choose the class and open <strong>What prints on report cards</strong>."],
          ["Check <strong>Overall lunch</strong> under <strong>Attendance &amp; lunch</strong>."],
          ["Select <strong>Save</strong>."],
        ],
      },
    ],
    faq: [
      ["A change doesn't show on the report cards.", "Settings are saved per class. Check you chose the right class, selected Save, and then reopened the report cards."],
      ["Why can't a teacher open Report settings?", "A new teacher's default permissions leave out Report Settings. A manager can give it on the staff form."],
      ["Where do I turn on GPA?", "Under Also on the report card in this panel: " + link("gpa-on-report-cards-and-transcripts", "GPA") + "."],
    ],
    related: ["report-settings-grades-and-promotion", "report-remarks-and-signatures", "report-card", "report-card-templates", "gpa-on-report-cards-and-transcripts", "mark-attendance-for-a-class"],
  },

  // ---------------------------------------------------------------------------------------------
  {
    slug: "report-settings-grades-and-promotion",
    title: "Set the grade scale and promotion rules for a class",
    topic: T,
    order: 2.1,
    summary: "Set each class's promoted and repeated class, cut-off and reopen date, and the grade scale with letters, numbers or both.",
    tags: ["grade scale", "grade mapping", "grading", "letter grades", "promotion settings", "cut off", "cut-off point", "promoted class", "repeated class", "school reopen date", "numbers", "core subjects"],
    who: "Managers, and staff given <strong>Report Settings</strong>.",
    intro: "These settings are kept for each class, in <strong>Report settings</strong>, <strong>Promotion &amp; grading by class</strong>. They decide the grade and remark printed for a score and whether a student is promoted.",
    sections: [
      {
        title: "Set promotion for classes",
        steps: [
          ["Open <strong>Reports</strong>, <strong>Term reports</strong>, <strong>Report settings</strong>, then <strong>Promotion &amp; grading by class</strong>. Select a class. The <strong>Promotion</strong> card shows <strong>Promoted Class</strong>, <strong>Repeated Class</strong>, <strong>Cut Off Point</strong> and <strong>School Reopen Date</strong>.", "reports-settings-class.webp", "A class with no promotion settings yet."],
          ["Select <strong>Edit</strong> on the card."],
          ["For each class choose <strong>Promoted to</strong> and <strong>Repeated To</strong>, type the <strong>Cut off</strong> as a percentage or overall score, and pick the <strong>Reopen Date</strong>.", "reports-settings-promotion-edit-zoom.webp", "One row per class."],
          ["Select <strong>Save promotion</strong>. <strong>Cancel</strong> leaves the old values."],
        ],
        list: [
          "Choosing a cut-off or reopen date offers <strong>Apply to all classes</strong>, <strong>Apply to classes with no date</strong> (or no cut off) and <strong>Select classes</strong>, so you don't type it for every class.",
          "The cut-off can be a <strong>Percentage (%)</strong> or <strong>Overall Score</strong>. Choose which, then who it applies to.",
          "A new term starts with the promotion settings of the class's last term, so you rarely retype them.",
          "The decision itself is printed when <strong>Promotion</strong> is checked under What prints. The move happens in " + link("promote-students-and-manage-graduation", "Promotion") + ".",
        ],
      },
      {
        title: "Set the grade scale",
        steps: [
          ["Under <strong>Grades</strong>, the <strong>Grade scale</strong> lists each letter, its percentage range and its remark."],
          ["Select <strong>+ Add grades</strong>. Fill a rule row: <strong>Grade Label</strong>, <strong>Score Remark</strong>, <strong>From %</strong> and <strong>To %</strong>, and choose <strong>Apply To Classes</strong>. Use the + to add more rows, then <strong>Save Rules</strong>."],
          ["Use the ⋮ menu on a row to edit it or remove it."],
        ],
        note: "A school with no scale of its own uses the US scale: A 90 and up, B 80, C 70, D 60 to 69, F below 60.",
      },
      {
        title: "Show grades as letters, numbers or both",
        steps: [
          ["Beside <strong>Format</strong>, choose <strong>Letters</strong>, <strong>Numbers</strong> or <strong>Letters + Numbers</strong>."],
          ["With numbers, select <strong>Configure Numbers</strong>. Choose <strong>Show total</strong> (Yes or No), and how the total is worked out: <strong>All subjects</strong>, or <strong>Core + additional subjects</strong> (pick the core subjects, how many additional ones count, and whether they are picked at random or from the top). Choose the classes under <strong>Assigned Classes</strong> and select <strong>Done</strong>."],
        ],
        warning: "A grade that is a number, not a letter, does not count toward GPA.",
      },
    ],
    faq: [
      ["The Promotion card shows dashes.", "The class has no promotion settings yet. Select Edit and fill them in."],
      ["Does a grade scale change old report cards?", "Report cards are worked out from the scale when they open, so reopening one uses the scale as it is now."],
    ],
    related: ["report-settings", "report-card", "promote-students-and-manage-graduation", "configure-dynamic-grading-and-remarks", "gpa-on-report-cards-and-transcripts"],
  },

  // ---------------------------------------------------------------------------------------------
  {
    slug: "report-remarks-and-signatures",
    title: "Report remarks, ready-made remarks and signatures",
    topic: T,
    order: 2.2,
    summary: "Add remark types, write ready-made remarks teachers can pick, and add signatures for report cards and transcripts.",
    tags: ["report remarks", "ready-made remarks", "teacher remarks", "conduct remark", "custom remark type", "signature", "head teacher signature", "transcript signature", "class remark types", "saved remarks"],
    who: "Managers, and staff given <strong>Report Settings</strong>. Adding a remark type also needs the Custom editor.",
    intro: "Remarks are the short comments on a report card. Signatures print at the bottom of report cards and transcripts.",
    sections: [
      {
        title: "Report remarks",
        steps: [
          ["Open <strong>Reports</strong>, <strong>Term reports</strong>, <strong>Report settings</strong>. The <strong>Report remarks</strong> card lists the types teachers write each term.", "reports-settings-remarks.webp", "Teacher's, Conduct, Interest and Attitude remarks."],
          ["To add a type such as a Head Teacher's remark, select <strong>+ Add remark</strong>. It opens the " + link("custom-editor", "Custom editor") + ", where each remark is a field of the Report remarks form."],
          ["<strong>Custom Remarks</strong> adds a remark type of your own by name. <strong>Class Remark Types</strong> chooses which types teachers can fill in from the classroom."],
        ],
      },
      {
        title: "Write ready-made remarks",
        steps: [
          ["Under <strong>Ready-made remarks</strong>, type a remark (up to 150 characters) and choose its <strong>Select Remark Type</strong>."],
          ["Select <strong>+ Add another</strong> for more, then <strong>Save Remarks</strong>."],
          ["Open <strong>Saved Remarks</strong> to read, edit or delete them.", "reports-settings-saved-remarks-zoom.webp", "Saved remarks, listed by type."],
        ],
        note: "Teachers then pick these from the arrow beside each remark on the report card, as in " + link("report-card", "Generate, check and print report cards") + ".",
      },
      {
        title: "Add a custom remark type",
        steps: [
          ["Select <strong>Custom Remarks</strong>. Type a <strong>Name</strong>, such as <em>Head Teacher's remark</em>."],
          ["Select <strong>Save</strong>. The type appears when you write ready-made remarks. A type you stop using can be made obsolete or deleted."],
        ],
      },
      {
        title: "Add a signature",
        steps: [
          ["Open <strong>Signature Management</strong>. <strong>Report cards</strong> lists the signatures in use and the classes each applies to; <strong>Transcripts</strong> has its own.", "reports-settings-signatures.webp", "Signatures for report cards and transcripts."],
          ["Select <strong>+ Add</strong> beside <strong>New report signature</strong> (or <strong>New transcript signature</strong>).", "reports-settings-sig-card-zoom.webp", "Signatures in use, and the add button."],
          ["Draw the signature in the box, or select <strong>Clear</strong> to start again. Type the <strong>Signer Title</strong> and <strong>Signer Name</strong>."],
          ["Check the classes under <strong>Apply Signature To</strong>, then select <strong>Save Signature</strong>."],
        ],
        list: [
          "<strong>+ Classes</strong> adds more classes to a signature. A class holds one signature: choosing it again replaces the old one.",
          "<strong>Make obsolete</strong> keeps the signature but stops using it. <strong>Delete</strong> removes it.",
          "A transcript with no signature for the class shows a note asking you to add one.",
        ],
      },
    ],
    faq: [
      ["The ready-made remarks don't show on the report card.", "Select Save Remarks first, then reopen the report cards. The remark types must also be checked under What prints on report cards."],
      ["Where are the remark forms?", "The Report remarks form is part of the " + link("custom-editor", "Custom editor") + "."],
    ],
    related: ["report-settings", "report-card", "custom-editor", "transcript"],
  },

  // ---------------------------------------------------------------------------------------------
  {
    slug: "report-card-templates",
    title: "Custom report card templates",
    topic: T,
    order: 3,
    summary: "Design your school's own report card in a Sheet or Doc, add fields for names, scores and remarks, and print it for the classes you choose.",
    tags: ["report card template", "custom report card", "report card design", "excel report card", "report card fields", "placeholders", "checkbox report card", "nursery report card", "gpa field", "template fields", "report card layout"],
    featured: true,
    who: "Managers, and staff given <strong>Manage School Records</strong>.",
    intro: "Make report cards look exactly like your school's own. Lay out the card once in Docs &amp; sheets, put a field such as <code>{{student.name}}</code> wherever a student's details belong, and choose the classes that use it. Every other class keeps the standard report card.",
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
          ["Open <strong>Management</strong>, then <strong>Docs &amp; sheets</strong>, and select <strong>New Doc/Sheet</strong>. Choose <strong>Sheet</strong> (best for most report cards: rows, columns, borders and merged cells) or <strong>Doc</strong> (a letter-style card).", "reports-template-new.webp", "Choose Sheet, then name it."],
          ["Type a <strong>Title</strong> such as <em>6th Grade report card</em> and select <strong>Create</strong>."],
          ["Select <strong>Fields</strong> at the top. Under <strong>Samples</strong>, choose <strong>Scores</strong>, <strong>Tick boxes</strong> or, in a sheet, <strong>Nursery card</strong> for a complete layout to adjust.", "reports-template-fields.webp", "The Report card fields panel."],
          ["Lay out the card like a spreadsheet: logo, labels in bold, a header row for subjects. Changes save as you go."],
        ],
        tip: "Already have your card in Excel? Open <strong>File</strong>, then <strong>Upload Excel (.xlsx)</strong>. Text, merged cells, colors, borders and column widths come across from the first sheet. You can also paste a range from Excel or Google Sheets.",
      },
      {
        title: "Add fields",
        steps: [
          ["Select the cell where a detail belongs."],
          ["Open <strong>Fields</strong>, find the field, and click it to put it in the cell. Use the search box to find one fast, or the copy button to copy it and paste it anywhere.", "reports-template-field-list-zoom.webp", "Fields are grouped, with a search box."],
          ["For subjects, put the subject fields side by side in one row under a row of headings. That one row repeats for each subject."],
        ],
      },
      {
        title: "Fields you can use",
        text: "The <strong>Fields</strong> panel lists every field, including your school's own remark types. These are the ones schools use most.",
        subsections: [
          {
            title: "Student and results",
            table: [
              ["Field", "Prints"],
              ["<code>{{student.name}}</code>", "Full name. Also <code>first_name</code> and <code>last_name</code>."],
              ["<code>{{student.id}}</code>, <code>{{student.class}}</code>", "Student ID and class."],
              ["<code>{{student.photo}}</code>", "The student's photo."],
              ["<code>{{student.position_in_class}}</code>", "Position, such as <em>12th / 18 students</em>. Use <code>student.position</code> for just <em>12th</em>."],
              ["<code>{{student.overall}}</code>", "Overall percentage and score, such as <em>78.00 % | 624.00 / 800.00</em>."],
              ["<code>{{student.average}}</code>", "Average percentage."],
              ["<code>{{student.promoted_to}}</code>", "The class the student moves up to, when promotion is on."],
              ["<code>{{grades.gpa}}</code>, <code>{{grades.gpa_weighted}}</code>", "The term GPA and the weighted GPA. See " + link("gpa-on-report-cards-and-transcripts", "GPA") + "."],
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
              ["<code>{{subject.remark}}</code>", "Remark, such as <em>Excellent</em>."],
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
              ["<code>{{attendance.lunch}}</code>", "Lunch for the term, such as <em>42 of 58 days</em>, when <strong>Overall lunch</strong> is checked in Report settings. Also <code>attendance.lunch_days</code> and <code>attendance.lunch_taken</code>."],
            ],
          },
          {
            title: "Remarks, fees and signature",
            table: [
              ["Field", "Prints"],
              ["<code>{{remarks.teacher}}</code>", "The teacher's remark. Also <code>conduct</code>, <code>attitude</code> and <code>interest</code>."],
              ["<code>{{forms.all}}</code>", "The student's answers to Custom editor forms set to print on report cards, such as <em>Skills &amp; effort – Effort: Good, Homework: Excellent</em>."],
              ["<code>{{fees.outstanding}}</code>", "Balance due. Also <code>total_billed</code> and <code>total_paid</code>. Filled from PayGira when the billing table is on in Report settings."],
              ["<code>{{signature.image}}</code>", "The signature from Report settings."],
              ["<code>{{signature.name}}</code>, <code>{{signature.title}}</code>", "Who signed, and their title."],
              ["<code>{{grades.key}}</code>", "Your grade key, such as <em>A (90 to 100) = Excellent</em>."],
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
            title: "Checkboxes",
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
          ["In the sheet, open <strong>Settings</strong>. Under <strong>Report card</strong>, turn on <strong>Use as a report card</strong>."],
          ["Under <strong>Classes</strong>, choose every class that should print with this layout."],
          ["Select <strong>Save</strong>.", "reports-template-settings.webp", "Settings, Report card: turn it on, choose the classes, then save."],
        ],
        note: "Each class uses one template. Choosing a class here moves it from any other template, and the window tells you which. Classes without a template keep the standard report card, so you can roll a layout out one class at a time.",
      },
      {
        title: "Preview and print",
        steps: [
          ["Under <strong>Preview</strong>, choose a class and select <strong>Preview</strong>. The class's report cards open in a new tab."],
          ["Adjust the sheet and preview again until it looks right.", "reports-template-card.webp", "The layout filled in for a student, with a row for every subject."],
          ["Print as usual from " + link("report-card", "Terminal reports") + ". The classes you chose use your layout."],
        ],
      },
    ],
    faq: [
      ["A field prints blank.", "Check the spelling between the braces, and that the student has that information this term. Remarks must be entered first, and fees show only when the billing table is on in Report settings."],
      ["The subject row prints only once.", "Make sure the row has a field that starts with <code>subject.</code>, like <code>{{subject.name}}</code>. Fields for one named subject, like <code>{{subject[Mathematics].total}}</code>, stay in place on purpose."],
      ["Can each grade level have its own layout?", "Yes. Make one template for each layout and choose its classes. Each class uses one template at a time."],
      ["Why can't I download the template?", "A file used as a report card can't be downloaded. Print from Terminal reports, or turn off <strong>Use as a report card</strong> to download the file."],
    ],
    related: ["report-card", "report-settings", "docs-and-sheets", "gpa-on-report-cards-and-transcripts"],
  },

  // ---------------------------------------------------------------------------------------------
  {
    slug: "merit-sheet",
    title: "Merit sheets: rank a class for a term",
    topic: T,
    order: 4,
    summary: "Rank a class by totals, averages and grades for a term, or by subject, in Report builder, then export or save the sheet.",
    tags: ["merit sheet", "class ranking", "honor roll", "class position", "rank students", "merit list", "top students"],
    who: "Staff given <strong>Report Builder</strong> (and <strong>Terminal Reports</strong>). A teacher sees only their own classes.",
    intro: "A merit sheet lists a class's students from best to lowest for a term. It is a report in " + link("report-builder", "Report builder") + ".",
    sections: [
      {
        title: "Build a merit sheet",
        steps: [
          ["Open <strong>Reports</strong>, then <strong>Report builder</strong>. Under <strong>Create new report</strong>, select <strong>Merit sheet</strong>, then <strong>Choose columns</strong>."],
          ["On <strong>Columns</strong>, keep the ones you want, in the order you want, then select <strong>Choose criteria</strong>. Beside the title, <strong>Class ranking</strong> ranks whole students; <strong>By subject</strong> ranks each subject on its own."],
          ["On <strong>Criteria</strong>, the report already has <strong>Class</strong>, <strong>Term</strong> and <strong>Subject scaling</strong>. Open <strong>Class</strong>, check the class, and check the <strong>Term</strong>."],
          ["Select <strong>Run report</strong>. Students are listed by position with their totals, average, percentage and grade.", "reports-merit-results.webp", "A ranked class, 25 rows at a time."],
        ],
        list: [
          "<strong>Subject scaling</strong> chooses raw scores, or scores scaled to one maximum so subjects count fairly.",
          "Add <strong>Subjects counted</strong>, <strong>Assessments counted</strong> or <strong>Categories counted</strong> criteria to rank on only some of the work. A merit sheet of every subject's semester exam makes an honor roll.",
          "Add <strong>Overall grade</strong>, <strong>Position</strong> or <strong>Percentage</strong> criteria to keep only some students.",
        ],
        example: "Choose <em>6th Grade</em> and <em>Fall Semester</em> to rank the class by position, with student name, ID, total score, average, percentage, overall grade and remark.",
      },
      {
        title: "Print, export or save it",
        text: "From <strong>Save / export</strong> a merit sheet works like any report: " + link("report-builder-save-export-schedule", "Save, export, share and schedule a report") + ".",
      },
    ],
    faq: [
      ["The sheet ranks every class together.", "Add the Class criterion and check the class. With none checked, the report includes all classes."],
      ["A student I expect is missing.", "A merit sheet lists students enrolled in the class this term. Check the term and the class."],
    ],
    related: ["report-builder", "report-builder-save-export-schedule", "report-card", "grading-or-marking-assessment"],
  },

  // ---------------------------------------------------------------------------------------------
  {
    slug: "transcript",
    title: "Open, print and email a student's transcript",
    topic: T,
    order: 5,
    summary: "Find a student, confirm your password, review the transcript, print an unofficial copy or email the official one.",
    tags: ["transcript", "official transcript", "academic record", "graduates", "unofficial copy", "email transcript", "send transcript", "registrar", "notify guardians", "print transcript"],
    who: "Staff given <strong>Generate Transcripts</strong>. Each opening is recorded.",
    intro: "A transcript is a student's record across every finished term, with each term's GPA and the cumulative GPA. It is <strong>official only when it is sent by email</strong> from its page. A copy you view or print is marked <strong>Unofficial</strong>.",
    sections: [
      {
        title: "Find a student",
        steps: [
          ["Open <strong>Reports</strong>, then <strong>Term reports</strong>, then <strong>Transcripts</strong>. Read the notice about confidential records.", "reports-transcripts.webp", "Reports, Term reports, Transcripts."],
          ["Type a name or student ID, or pick a <strong>Class</strong> or a status (<strong>All students</strong>, <strong>Current</strong>, <strong>Graduated</strong> or <strong>Transferred or withdrawn</strong>), then select <strong>Search</strong>."],
          ["Select the button on the student's row to open the transcript."],
          ["Type your own password under <strong>Confirm it's you</strong> and select <strong>Open transcript</strong>."],
        ],
      },
      {
        title: "Read the transcript",
        steps: [
          ["The document is on the left. On the right are the student, an <strong>Academic summary</strong> (cumulative GPA, terms completed, and credits earned where your school uses credits), the <strong>Design</strong> list and <strong>Official copies</strong>.", "reports-transcript.webp", "A transcript in the document viewer."],
          ["The bar on top has the breadcrumb and the actions."],
        ],
        list: [
          "Only finished terms appear, each with its <strong>Term</strong> GPA and the <strong>Cumulative</strong> GPA to date. The current term appears after its end date. See " + link("gpa-on-report-cards-and-transcripts", "GPA") + ".",
          "A note on top says <strong>No signature is set for this class yet</strong> when the class has none: " + link("report-remarks-and-signatures", "add a transcript signature") + ".",
          "A printed or emailed copy ends with an <strong>About this transcript</strong> page: the grade scale, how GPA is worked out, official copies and privacy.",
        ],
      },
      {
        title: "Email the official copy",
        steps: [
          ["Select <strong>Email official copy</strong>. Check or type the <strong>Email</strong> (it fills with the guardian's), then <strong>Continue</strong>."],
          ["Confirm with your <strong>Password</strong> and select <strong>Send</strong>."],
        ],
        note: "The official copy is a password-protected PDF sent from reports@managira.com. It always uses the school's chosen design, whichever design you are viewing.",
      },
      {
        title: "Print, or tell guardians",
        steps: [
          ["<strong>Print</strong> prints an unofficial copy, marked as such."],
          ["<strong>Notify guardians</strong> sends a message that the transcript is ready, with a link to the parent portal and the school's email to ask for it. It never attaches the transcript. Confirm your password and select <strong>Send</strong>.", "reports-transcript-notify.webp", "Notify Guardians."],
        ],
      },
    ],
    faq: [
      ["Why does a transcript show no terms?", "Only terms that have ended count. A student with only the current term has no finished term yet."],
      ["Where do I choose the design?", "In Report settings: " + link("transcript-design", "Choose a transcript design") + "."],
      ["The printed copy says Unofficial.", "That is on purpose. Email the official copy from the transcript's page."],
    ],
    related: ["transcript-design", "gpa-on-report-cards-and-transcripts", "report-remarks-and-signatures", "promote-students-and-manage-graduation"],
  },

  // ---------------------------------------------------------------------------------------------
  {
    slug: "transcript-design",
    title: "Choose a transcript design",
    topic: T,
    order: 5.1,
    summary: "Pick the look of every transcript from five designs, preview each one with a sample student, and compare designs on a real transcript.",
    tags: ["transcript design", "transcript look", "standard classic modern compact registrar", "registrar transcript", "transcript layout"],
    who: "Managers, and staff given <strong>Report Settings</strong>.",
    intro: "The school picks one design. Every transcript, including the emailed official copy, uses it.",
    sections: [
      {
        title: "Pick the design",
        steps: [
          ["Open <strong>Reports</strong>, <strong>Term reports</strong>, <strong>Report settings</strong>, then <strong>Transcript Design</strong>.", "reports-settings-design.webp", "Five designs, with the one in use marked."],
          ["Select <strong>Preview</strong> under a design to see it with a sample student. No real record is shown."],
          ["Select the design, then <strong>Save design</strong>."],
        ],
        warning: "Saving changes the look of every transcript the school sends from then on.",
      },
      {
        title: "The five designs",
        table: [
          ["Design", "What it looks like"],
          ["<strong>Standard</strong> (the default)", "The original Managira transcript, with a table for each term."],
          ["<strong>Classic</strong>", "A traditional record: serif type, the school's crest, each school year's terms, a seal and the signature."],
          ["<strong>Modern</strong>", "A header in the school's color, a summary with the GPA at a glance, and each term in its own card."],
          ["<strong>Compact</strong>", "The whole record on as few pages as possible, with terms in a grid."],
          ["<strong>Registrar</strong>", "A college registrar's record: terms in two columns, each course's credits and quality points, term and cumulative totals, and transcript statistics."],
        ],
      },
      {
        title: "See a real transcript in another design",
        steps: [
          ["Open a transcript (" + link("transcript", "Open, print and email a transcript") + "). Under <strong>Design</strong> on the right, select another design."],
        ],
        list: [
          "The page changes only for you. The note under the list says the emailed copy uses the school default.",
        ],
        images: [
          ["reports-transcript-classic.webp", "Classic"],
          ["reports-transcript-modern.webp", "Modern"],
          ],
      },
    ],
    faq: [
      ["Why does the emailed transcript look different from what I'm viewing?", "The official copy always uses the school's saved design. Viewing another design is a comparison only."],
      ["Do all designs show GPA?", "Yes. Every design shows each term's GPA and the cumulative GPA to date."],
    ],
    related: ["transcript", "report-settings", "gpa-on-report-cards-and-transcripts"],
  },

  // ---------------------------------------------------------------------------------------------
  {
    slug: "report-builder",
    title: "Report builder: build a report",
    topic: T,
    order: 6,
    summary: "Choose a report, pick its columns, filter it, run it and read the results. Then save, export or schedule it.",
    tags: ["report builder", "custom reports", "attendance report", "lunch report", "students report", "criteria", "columns", "open in managira", "student page link", "class list", "data", "my reports", "can i report on lunch"],
    featured: true,
    who: "Managers, and staff given <strong>Report Builder</strong>. Each report also needs the permission for what it shows, and a teacher sees only their own classes.",
    intro: "Report builder answers questions like <em>which 9th graders missed more than five days this month?</em> or <em>which families still owe fees?</em> Five steps: select a report, choose columns, set criteria, run it, then save or export.",
    sections: [
      {
        title: "Open Report builder",
        steps: [
          ["Open <strong>Reports</strong>, then <strong>Report builder</strong>. The five steps run across the top.", "reports-builder.webp", "Select report, Columns, Criteria, Run report, Save / export."],
          ["<strong>My reports</strong> on the left holds reports you saved and reports shared with you. <strong>Create new report</strong> on the right lists what you can build."],
        ],
        table: [
          ["Group", "Reports"],
          ["Students", "Students (and custom form answers), Admissions &amp; enrollment, Assessments, Merit sheet, Attendance (and lunch)"],
          ["Parents &amp; messages", "Parents &amp; guardians, Parent messages, Messages sent"],
          ["School", "Staff, Fees &amp; payments, Announcements &amp; events, Activity log"],
          ["Transportation", "Riders &amp; requests, Trips &amp; reports, Buses, drivers &amp; routes"],
        ],
        note: "You see only the reports your permissions allow. A teacher's list has no fees or parent messages, for example.",
      },
      {
        title: "Steps 1 and 2: choose the report and columns",
        steps: [
          ["Select a report, such as <strong>Students</strong>, then <strong>Choose columns</strong>."],
          ["Some reports have more than one view next to the title (for example Students and Custom forms). Select a view to change what the columns are about."],
          ["On the left, <strong>Available columns</strong> are in groups. Select <strong>Expand all</strong> or a group, then a column to add it. Use <strong>Find</strong> to search.", "reports-builder-available-zoom.webp", "Columns, in groups."],
          ["On the right, <strong>Report columns</strong> is your list. Drag a column's handle to reorder it, select the red x to remove it, or <strong>Reset</strong> to go back to the starting set.", "reports-builder-chosen-zoom.webp", "Your columns, in order."],
        ],
      },
      {
        title: "Open in Managira: a link to each record",
        text: "Where your school has it, a report offers a link column that opens the record in Managira.",
        steps: [
          ["Add <strong>Student page</strong> (or <strong>Staff page</strong>, <strong>Parent page</strong> or <strong>Class page</strong>) from the column groups."],
          ["On screen each row shows an <strong>Open</strong> link that opens the page in a new tab, if you are allowed to see that page."],
        ],
        note: "In Excel the link is clickable; in CSV and Word it is the full web address.",
      },
      {
        title: "Step 3: set criteria",
        steps: [
          ["Select <strong>Choose criteria</strong>. Criteria are optional: with none, the report includes every record.", "reports-builder-criteria.webp", "Available criteria on the left, yours on the right."],
          ["Add a criterion, such as <strong>Class</strong>. Select its drop-down, check one or more choices, and select <strong>Done</strong>."],
          ["Remove one with its red x, or select <strong>Clear</strong> to remove them all."],
        ],
      },
      {
        title: "Step 4: run the report",
        steps: [
          ["Select <strong>Run report</strong>. Results fill the table, 25 rows at a time. Select a heading to sort."],
          ["Use <strong>Show</strong> to change rows per page, and <strong>Prev</strong> and <strong>Next</strong> to move between pages."],
          ["Select <strong>Back</strong> to change columns or criteria, or <strong>Save / export</strong> to keep or send it."],
        ],
        note: "If a run fails, <strong>Try again</strong> appears over the table.",
      },
      {
        title: "Attendance and lunch reports",
        text: "Under <strong>Attendance</strong>:",
        table: [
          ["Report", "Shows"],
          ["<strong>Per student</strong>", "Each student's days present and absent and attendance %. Add <strong>School days</strong>, <strong>Present on school days</strong> and <strong>Attendance % of school days</strong> to match the attendance page's Overall."],
          ["<strong>Lunch each day</strong>", "Date, student, class, had lunch, attendance that day, and who marked it and when."],
          ["<strong>Lunch per student</strong>", "Days with lunch, days without, days not recorded, and lunch %."],
          ["<strong>Lunch per class &amp; day</strong>", "For each class and day: had lunch, no lunch, and lunch %."],
        ],
        note: "Lunch reports appear when your school takes lunch, for staff with <strong>Mark Attendance</strong>. Teachers see their own classes.",
      },
      {
        title: "Reports schools use every week",
        subsections: [
          {
            title: "Students who missed more than five days this month",
            steps: [
              "Choose <strong>Attendance</strong>, then the per-student view.",
              "Add criteria for the dates (this month) and the class if you want one grade.",
              "Sort by days absent, highest first, and look at the students with more than five.",
              "Run it, then export it or share it with your counselor.",
            ],
          },
          {
            title: "Families who still owe fees",
            steps: [
              "Choose <strong>Fees &amp; payments</strong>, then the fee balances view.",
              "Add a criterion for balances above zero, and for a class or bill if you like.",
              "Add the parent name, email and phone columns.",
              "Export to Excel for the office.",
            ],
          },
          {
            title: "A class list with parent contacts",
            steps: [
              "Choose <strong>Students</strong> and add the <strong>Class</strong> criterion.",
              "Keep <strong>Parent / guardian</strong> and <strong>Parent phone</strong>, and add email if you need it.",
              "Export to Word or Excel for field trips, substitutes or emergencies.",
            ],
          },
          {
            title: "Who rides each bus",
            steps: [
              "Choose <strong>Riders &amp; requests</strong>, then the riders view.",
              "Add a route or bus criterion, and the stop and parent phone columns.",
            ],
          },
        ],
        tip: "Ask Mira instead: <em>List 9th graders who missed more than five days in October.</em> See " + link("mira-ai-capabilities", "What Mira can do") + ".",
      },
    ],
    faq: [
      ["Why are some columns missing?", "Columns about parents, attendance or fees need those permissions. Ask a manager."],
      ["A driver sees fewer rows than I do.", "People with limited access see only their own rows, such as a driver's own trips. Full access opens everyone's."],
      ["Can I report on lunch?", "Yes. Under Attendance there are four lunch views, listed above."],
    ],
    related: ["report-builder-save-export-schedule", "merit-sheet", "state-reporting-files", "transportation-reports", "analytical-dashboard"],
  },

  // ---------------------------------------------------------------------------------------------
  {
    slug: "report-builder-save-export-schedule",
    title: "Save, export, share and schedule a report",
    topic: T,
    order: 6.1,
    summary: "Keep a report in My reports, export it to Excel, Word or CSV, share it with colleagues, or have it emailed on a schedule.",
    tags: ["save report", "export report", "csv", "excel", "word", "share report", "schedule report", "email report", "my reports", "report template", "mgrt", "import report", "export header"],
    who: "Staff given <strong>Report Builder</strong>.",
    intro: "After you run a report, the last step is <strong>Save / export</strong>. Everything there uses the report you last ran, so what you save or export matches the results on screen.",
    sections: [
      {
        title: "Save a report",
        steps: [
          ["From the results, select <strong>Save / export</strong>.", "reports-builder-finish.webp", "Save, Export and Gov/state report."],
          ["Select <strong>Save</strong>. Type a <strong>Name</strong>."],
          ["Under <strong>Export header</strong>, check what files print on top: <strong>School name</strong>, <strong>Logo</strong>, <strong>Address</strong>, <strong>Phone</strong>, <strong>Date</strong>, and choose the position, <strong>Left</strong> or <strong>Center</strong>. The preview shows it."],
          ["Select <strong>Save</strong>. The report is now in <strong>My reports</strong>."],
        ],
        list: [
          "On a saved report, <strong>Duplicate</strong> and <strong>Save as new</strong> make a copy under a new name.",
          "If you change a saved report, a bar asks you to <strong>Save changes</strong> or <strong>Discard</strong>.",
          "Use the <strong>Filter</strong> box above My reports to find one.",
        ],
        note: "A saved report keeps your columns and criteria, not its results: it runs fresh each time you open it.",
      },
      {
        title: "Export",
        steps: [
          ["Select <strong>Export</strong>.", "reports-builder-export.webp", "Export opens a small window."],
          ["Choose <strong>Excel</strong>, <strong>Word</strong> or <strong>CSV</strong>. <strong>Template</strong> exports the report's setup (not its data) as a file another person can add with <strong>Import</strong> above My reports."],
        ],
        table: [
          ["Format", "Up to"],
          ["CSV", "100,000 rows"],
          ["Excel", "25,000 rows"],
          ["Word", "10,000 rows"],
        ],
        note: "Narrow the report with criteria if you reach a limit.",
      },
      {
        title: "Share a saved report",
        steps: [
          ["Open the saved report from <strong>My reports</strong> and go to <strong>Save / export</strong>. Select <strong>Share</strong>.", "reports-builder-saved-actions.webp", "Share and Schedule appear once a report is saved."],
          ["Find a person, check them, and select <strong>Save</strong>."],
        ],
        note: "A colleague sees the report in their My reports, and runs it with their own permissions: they see only what they are allowed to see.",
      },
      {
        title: "Email a report on a schedule",
        steps: [
          ["On a saved report, select <strong>Schedule</strong>. Choose <strong>Repeat</strong>: <strong>Weekly</strong> or <strong>Monthly</strong> (<strong>Off</strong> stops it)."],
          ["Weekly: check the <strong>Days</strong>. Monthly: choose the <strong>Date</strong> (31 means the last day)."],
          ["Choose the <strong>Time</strong> and the <strong>File</strong>: Excel, Word or CSV. Check <strong>Include shared people</strong> to send it to the people you shared it with too."],
          ["Select <strong>Save</strong>. The line under the options says who it will go to."],
        ],
        note: "Scheduled reports are emailed from reports@managira.com, each run as the report's owner with their permissions.",
      },
    ],
    faq: [
      ["Why can't I see Share or Schedule?", "Save the report first. They appear once it is saved."],
      ["My export is cut off.", "Each format has a row limit. Add criteria to narrow the report."],
      ["I changed a saved report and lost the change.", "Select Save changes in the bar that appears, or Save as new in the Save window."],
    ],
    related: ["report-builder", "state-reporting-files", "merit-sheet"],
  },

  // ---------------------------------------------------------------------------------------------
  {
    slug: "state-reporting-files",
    title: "Gov/state reports: write a saved report the state's way",
    topic: T,
    order: 6.5,
    summary: "Turn a saved report into your state's file (CSV, tab, pipe or fixed width), check it, schedule it and send it securely.",
    tags: ["gov/state report", "government report", "state reporting", "state submission", "october count", "census day", "count day", "fixed width", "flat file", "state codes", "send report to state", "files made", "mark as sent"],
    who: "Staff given <strong>Report Builder</strong> with its <strong>Gov/state reporting</strong> permission (Users / Employees, Edit, Reports). Only the person who saved a report changes how its file is written.",
    intro: "Every state publishes its own file layouts for collections such as the October count or attendance. A Gov/state report writes one of your saved Report builder reports the way your state's layout asks: its field names, order, widths, date style and codes. Then it sends the file securely to the people you choose.",
    sections: [
      {
        title: "Start from a saved report",
        steps: [
          ["In " + link("report-builder", "Report builder") + ", build the report your state's layout matches, such as <strong>Students</strong> for an enrollment file. Add the columns in the state's order and the criteria the collection needs, and save it (" + link("report-builder-save-export-schedule", "Save a report") + ")."],
          ["Open the saved report, go to <strong>Save / export</strong>, and select <strong>Gov/state report</strong>.", "reports-state-button.webp", "Gov/state report, beside Export."],
        ],
        note: "The report decides which students and which columns. The Gov/state report only decides how the file is written and who it goes to. Your school's own student fields, such as race and ethnicity or a state student ID, are columns too.",
      },
      {
        title: "1. File type",
        steps: [
          ["Choose the type your state's instructions say: <strong>CSV</strong>, <strong>Tab-separated</strong>, <strong>Pipe</strong> or <strong>Fixed width</strong>. CSV is the most common.", "reports-state-types-zoom.webp", "Four file types."],
          ["Choose how <strong>Dates look like</strong> (CCYYMMDD is the most common) and whether <strong>First line lists the field names</strong>."],
          ["Open <strong>More options</strong> for quotes, line endings, the file name (<code>{school}</code>, <code>{report}</code> and <code>{date}</code> are filled in), plain letters only and ALL CAPITALS."],
        ],
      },
      {
        title: "2. Fields",
        steps: [
          ["Type each field's name as your state's layout lists it. Leave a name empty to keep the report's own. For fixed width, type the number of <strong>Characters</strong> too.", "reports-state-fields.webp", "From the report, name in the state's file, state codes."],
          ["Under <strong>State codes</strong> pick a ready-made set: sex, yes / no or grade levels (PK, KG, 01 to 12)."],
          ["Select <strong>More</strong> on a field for anything else: check <strong>The state requires this field</strong> so the check flags an empty one, add your own codes (for example 6th Grade to 06), or check <strong>Flag any value that has no code</strong>.", "reports-state-more.webp", "More, for one field."],
        ],
        tip: "Keep your state's file layout open beside you. Layouts change most years, so check the field list each fall.",
      },
      {
        title: "3. Check and make",
        steps: [
          ["Open <strong>3. Check &amp; make</strong>. The check shows how many rows are in the file, anything to fix (an empty required field, a value too long, a value with no code), and the first rows as the state will get them.", "reports-state-check.webp", "Ready: 30 rows, nothing to fix."],
          ["Select <strong>Make the file</strong>."],
        ],
        note: "<strong>Check again</strong> runs the check after you change something. <strong>Show the file as plain text</strong> shows exactly what is written.",
      },
      {
        title: "Schedule and send",
        steps: [
          ["Open <strong>Schedule &amp; send</strong>. Under <strong>Send it to</strong>, type an email address and select <strong>Add</strong>, up to 10, such as your state or district data office."],
          ["Under <strong>On these dates</strong> select <strong>+ Add a date</strong> for each count day, and, if the file is needed regularly, repeat it every weekday, week or month."],
          ["Select <strong>Save</strong>. On each date Managira makes the file from that day's records and sends it to everyone on the list. You are told it was made and who got it."],
        ],
        list: [
          "The file is <strong>never attached</strong> to an email.",
          "<strong>Staff at your school</strong> with Gov/state reporting get a link to sign in and download it.",
          "<strong>Anyone else</strong> gets a secure link that works for 7 days and a 6-digit code in a separate email. Five wrong codes lock it, and it allows up to 5 downloads.",
          "To send a file by hand, open <strong>Files made</strong> and select <strong>Send</strong> on it.",
          "Only add people allowed to see this information.",
        ],
      },
      {
        title: "Files made",
        steps: [
          ["Open <strong>Files made</strong>. Each file is kept in Managira for a year.", "reports-state-files.webp", "A file, not sent yet."],
          ["To upload it yourself, type your password and select <strong>Download</strong>. Then upload it to your state's portal."],
          ["Select <strong>Mark as sent</strong>, with the state's confirmation number if it gives one."],
        ],
        list: [
          "Each file shows who it was sent to and whether they downloaded it. Every make, send and download is in your activity log.",
          "Files are stored encrypted. After a year the content is removed and the record stays.",
          "A scheduled file is made as the report's owner, with their access that day, and stops if they no longer have Gov/state reporting.",
        ],
      },
    ],
    faq: [
      ["Is the Gov/state report different from the report I made?", "No. It is that report, written in your state's format. Change the report to change which students or columns are in it."],
      ["Who will it be sent to?", "The people you add under Send it to. With nobody there, you (and the people the report is shared with) are told it's ready, and you download it."],
      ["Can Managira upload it to the state's website for us?", "Not yet. It is sent to the people you choose, or you download it and upload it yourself."],
      ["Does Managira support Ed-Fi?", "Not yet. Contact Managira support to talk about your state."],
    ],
    related: ["report-builder", "report-builder-save-export-schedule", "edit-student-information"],
  },

  // ---------------------------------------------------------------------------------------------
  {
    slug: "analytical-dashboard",
    title: "Organization stats: your school at a glance",
    topic: T,
    order: 7,
    summary: "See enrollment, scores, pass rate, attendance, score entry and staffing for a term, compare classes, and download a PDF.",
    tags: ["analytics", "statistics", "organization stats", "view statistics", "dashboard", "school performance", "enrollment trends", "pass rate", "compare classes", "download pdf", "data"],
    who: "Managers, and staff given <strong>Manage School Records</strong>, on plans that include organization analytics.",
    intro: "One page of numbers and charts for a term. Use it to spot a class that needs help or scores that are still missing, then build a list in " + link("report-builder", "Report builder") + ".",
    sections: [
      {
        title: "Open it and choose a term",
        steps: [
          ["Open <strong>Reports</strong>, then <strong>Organization stats</strong>.", "reports-stats.webp", "Reports, Organization stats."],
          ["Use the term drop-down at the top right. The current term is marked <strong>(current)</strong>."],
        ],
      },
      {
        title: "The numbers on top",
        steps: [
          ["Eight tiles sum up the term."],
        ],
        table: [
          ["Tile", "Means"],
          ["Enrolled students", "Students in a class this term"],
          ["Average score", "The average of students' subject percentages"],
          ["Pass rate", "Subject results at 50% or above"],
          ["Attendance rate", "Present marks as a share of all marks, and how many students are below 75%"],
          ["Score entry", "Scores entered out of all scores expected for the term"],
          ["Students needing support", "Students averaging below 50%"],
          ["Active classes", "Classes with students enrolled"],
          ["Staff", "Active staff, and how many are teachers"],
        ],
      },
      {
        title: "The charts",
        list: [
          "<strong>Academic performance</strong>: Average score by class, Pass rate by class, Subject performance, Score distribution, Top students and Students needing support.",
          "<strong>This term</strong>: Score entry progress, Attendance rate by class and Students per class.",
          "<strong>Enrollment &amp; staff</strong>: Enrollment over terms, Gender and Staff by role.",
          "Under any chart, <strong>View as table</strong> shows the numbers behind it. Long lists have <strong>Show all</strong>.",
        ],
        images: [["reports-stats-tall.webp", "The whole page for one term"]],
      },
      {
        title: "Compare classes",
        steps: [
          ["Select <strong>Compare classes</strong>. Check two or more classes and select <strong>Compare</strong>.", "reports-stats-compare.webp", "Compare classes opens above the numbers."],
          ["A chart and table show each class's enrolled students, average score, pass rate and attendance. A dash means no scores or attendance were saved."],
        ],
      },
      {
        title: "Download or print",
        steps: [
          ["Select <strong>Download PDF</strong> for the page as a PDF. <strong>Print</strong> prints it where your school allows it."],
        ],
      },
    ],
    faq: [
      ["The page says statistics appear once students are enrolled.", "Enroll students in the term, or save scores and attendance. The page shows what exists for the term."],
      ["I can't see Organization stats.", "It needs Manage School Records and a plan with organization analytics."],
      ["How do I see the list behind a number?", "Build it in " + link("report-builder", "Report builder") + "."],
    ],
    related: ["report-builder", "report-card"],
  },

  // ---------------------------------------------------------------------------------------------
  {
    slug: "gpa-on-report-cards-and-transcripts",
    title: "GPA on report cards and transcripts",
    topic: T,
    order: 30,
    summary: "How term and cumulative GPA are worked out, where GPA shows, and how to turn it on for report cards.",
    tags: ["gpa", "grade point average", "weighted gpa", "unweighted gpa", "cumulative gpa", "term gpa", "semester gpa", "quality points", "transcript gpa", "report card gpa", "parent portal gpa", "student portal gpa", "turn on gpa"],
    who: "Managers, and staff given <strong>Report Settings</strong>. Sharing with families is set in <strong>Class settings</strong>.",
    intro: "Managira works out GPA the way registrars do, on the 4.0 scale from your grade letters: A 4.0, A− 3.7, B+ 3.3, B 3.0, B− 2.7, C+ 2.3, C 2.0, C− 1.7, D+ 1.3, D 1.0, D− 0.7, F 0 (A+ stays 4.0). A grade that isn't a letter (Pass, or a number) doesn't count, so a class graded with numbers shows no GPA.",
    sections: [
      {
        title: "How term and cumulative GPA are worked out",
        list: [
          "<strong>Term GPA</strong> counts only that term's courses.",
          "<strong>Cumulative GPA</strong> counts every course from every finished term up to then: all the grade points over all the credits. It is not an average of the term GPAs, so a term with more courses counts for more.",
          "A course counts by its credits when your school uses course credits (see " + link("gpa-honors-ap-and-credits", "Honors, AP and credits") + "); otherwise every course counts once. Grade points × credits are the course's quality points, and GPA = quality points ÷ credits.",
          "An F counts with no points. Pass, withdrawn and incomplete grades don't count.",
          "GPAs are worked out exactly and rounded to two decimal places once, at the end.",
        ],
      },
      {
        title: "Show GPA on report cards",
        steps: [
          ["Open <strong>Reports</strong>, <strong>Term reports</strong>, <strong>Report settings</strong>, then <strong>Promotion &amp; grading by class</strong>. Choose the class."],
          ["Open <strong>What prints on report cards</strong>, and check <strong>GPA</strong> under <strong>Also on the report card</strong>.", "reports-settings-gpa-switch-zoom.webp", "GPA is off until you check it."],
          ["Select <strong>Save</strong>. The class's report cards now show the term GPA. A custom layout prints it with <code>{{grades.gpa}}</code> and <code>{{grades.gpa_weighted}}</code>."],
        ],
      },
      {
        title: "On transcripts",
        list: [
          "Every transcript shows, under each finished term, its <strong>Term</strong> GPA and the <strong>Cumulative</strong> GPA to date, weighted beside unweighted when Honors or AP subjects apply. There is nothing to turn on.",
          "The <strong>Academic summary</strong> beside the document shows the cumulative GPA and the terms completed.",
          "A term counts once it has ended. The current term appears after its end date.",
          "A GPA from your school's earlier records is printed as it was given, never worked out again.",
        ],
        images: [],
      },
      {
        title: "Parents and students",
        steps: [
          ["Where your school has it turned on, parents see GPA on their child's page and students on their dashboard: this term's GPA so far, and the cumulative GPA over finished terms. It stays hidden behind dots until the eye is tapped."],
          ["Only grades families can already see count: a subject with a score still waiting for the teacher's approval is left out until it's approved."],
          ["To keep GPA from a class's parents or students, open <strong>Class settings</strong> for the class and uncheck <strong>GPA</strong> under <strong>Share with</strong>. See " + link("class-settings", "Class settings") + "."],
        ],
      },
    ],
    faq: [
      ["Why is there no GPA for a class?", "Its grades are numbers or Pass, not letters. Only letter grades count."],
      ["Why doesn't the current term show on a transcript?", "A term counts after its end date."],
    ],
    related: ["gpa-honors-ap-and-credits", "report-card", "transcript", "report-settings", "moving-to-managira"],
  },

  // ---------------------------------------------------------------------------------------------
  {
    slug: "gpa-honors-ap-and-credits",
    title: "Honors, AP and course credits for GPA",
    topic: T,
    order: 31,
    summary: "Mark subjects as Regular, Honors or AP / IB, set the bonus each adds, and give courses their credits.",
    tags: ["honors", "ap", "ib", "weighted gpa", "course credits", "credits", "gpa weights", "level", "quality points"],
    who: "Managers and supervisors set the Honors and AP / IB bonus. Staff given <strong>Report Settings</strong> set subject levels; a teacher sets them only for subjects in their class scope.",
    intro: "A weighted GPA adds a bonus to a passing grade in an Honors or AP / IB subject. Credits make a full-year course count more than a semester course.",
    sections: [
      {
        title: "Set levels and the bonus",
        steps: [
          ["Open <strong>Reports</strong>, <strong>Term reports</strong>, <strong>Report settings</strong>, <strong>Promotion &amp; grading by class</strong>, choose the class and open <strong>What prints on report cards</strong>. Scroll to <strong>GPA weights</strong>.", "reports-settings-gpa.webp", "GPA weights, under the report card options."],
          ["Type what <strong>Honors adds</strong> and what <strong>AP / IB adds</strong> to a passing grade. They start at 0.5 and 1.0. These weights belong to the school, not the class."],
          ["Beside each subject choose <strong>Regular</strong>, <strong>Honors</strong> or <strong>AP / IB</strong> under <strong>Level</strong>."],
          ["Select <strong>Save GPA weights</strong>."],
        ],
        note: "Transcripts, report cards and the portals then show the weighted GPA beside the unweighted one. A failing grade never gets a bonus.",
      },
      {
        title: "Give courses credits",
        steps: [
          ["In the same table, type each subject's <strong>Credits</strong>, such as 1 for a full-year course and 0.5 for a semester course. An empty box counts as 1."],
          ["Select <strong>Save GPA weights</strong>."],
        ],
        list: [
          "Transcripts then print each course's credits and the credits earned (and attempted, when a course was failed).",
          "Credits can be 0 to 20.",
          "Until a subject has credits, every course counts once.",
        ],
        note: "The Credits column appears where your school has course credits turned on.",
      },
    ],
    faq: [
      ["Why can't I change the bonus?", "Only managers and supervisors change the Honors and AP / IB weights."],
      ["Does a weight change old transcripts?", "GPA is worked out when a transcript opens, so it uses the weights and levels as they are now."],
    ],
    related: ["gpa-on-report-cards-and-transcripts", "transcript", "report-settings"],
  },
];
