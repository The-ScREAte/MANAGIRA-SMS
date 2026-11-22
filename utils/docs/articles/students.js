"use strict";

// Students & admissions: adding and finding students, admission forms, online applications,
// transfers, promotion and graduation, and the student portal.
module.exports = [
  {
    slug: "create-and-add-student",
    title: "Add a student, or import many at once",
    topic: "Students & admissions",
    order: 1,
    summary: "Add one student with their class, details, photo and parents, or import a whole school from the CSV or Excel template.",
    tags: ["add student", "new student", "import students", "bulk import", "csv template", "excel template", "enrollment"],
    featured: true,
    who: "Managers, and staff given the <strong>Add students</strong> permission.",
    intro: "Add students one at a time as they join, or import them all at once when you start. A student added to a class that's enrolled in the current term is enrolled automatically.",
    sections: [
      {
        title: "Add one student",
        steps: [
          ["Open <strong>Admissions</strong>, then <strong>Add New Student</strong>.", "add-student.webp", "Admissions, Add New Student: details, class, photo and parents on one form."],
          "Fill in the student's details. Fields marked <strong>*</strong> are required; the rest can be added later.",
          "Choose their <strong>class</strong> and school year.",
          "Add their parents or guardians now if you have them: name, relationship, email and mobile number. Parents with an email can be invited to the parent portal.",
          "Save. The student appears in All Students and in their class straight away.",
        ],
        tip: "The fields on this form are set in <a href=\"/legal/user-documentation/admission-settings\">Admission Settings</a>. Add your own (for example medical notes or previous school) there.",
      },
      {
        title: "Import many students",
        steps: [
          ["In <strong>Add New Student</strong>, choose the import option.", "add-student-import.webp", "Import students: download the template, fill it in, upload it."],
          "Select <strong>Download CSV Template</strong> or <strong>Download Excel Template (.xls)</strong>.",
          "Fill in one row per student. Remove the example rows before importing.",
          "Drag the file onto the upload box (or click to choose it) and select <strong>Import</strong>. Check the summary for any rows that need fixing.",
        ],
        example: "A new charter school imports 420 students from its old system's spreadsheet export: one row each with first and last name, gender, date of birth, grade and a parent's email and phone.",
      },
    ],
    faq: [
      ["Can I add a student without a parent?", "Yes. Parents can be added at any time from the student's page or from Management, Guardians."],
      ["Why doesn't a new student appear in attendance?", "Their class isn't enrolled in the current term yet. See <a href=\"/legal/user-documentation/enrolling-classes-and-student-in-aterm-semester\">Enrollment</a>."],
      ["Where do student ID numbers come from?", "Automatically from your Student IDs setting, or typed by hand. See <a href=\"/legal/user-documentation/configure-custom-student-ids\">Student IDs</a>."],
    ],
    related: ["find-students", "admission-settings", "edit-student-information", "create-manage-parent"],
  },
  {
    slug: "find-students",
    title: "Find students: All Students and filters",
    topic: "Students & admissions",
    order: 2,
    summary: "Search the whole school, filter by class, gender, status and portal access in one pop-up, and change many students at once with bulk edits.",
    tags: ["all students", "search students", "filters", "bulk edit", "student list", "portal access"],
    who: "Managers, and staff given the <strong>Students</strong> permission.",
    sections: [
      {
        title: "Search and filter",
        steps: [
          ["Open <strong>Admissions</strong>, then <strong>All Students</strong>. Type a name or student ID in the search box.", "all-students.webp", "Admissions, All Students: search, Filters and bulk edits."],
          ["Select <strong>Filters</strong> to narrow the list by <strong>Class</strong>, <strong>Gender</strong>, <strong>Status</strong> or <strong>Portal access</strong>, then <strong>Done</strong>. <strong>Clear</strong> removes them.", "all-students-filters.webp", "Filters open in a pop-up, and the list shows how many filters are on."],
          "Choose how many to <strong>Show per page</strong>, and use <strong>Prev</strong> and <strong>Next</strong> to move through the list.",
        ],
      },
      {
        title: "Search from anywhere",
        list: [
          "<strong>Search anything</strong> at the top of every page finds students, staff, parents and classes. You see a result only if you could open its page: a teacher sees only their own classes' students.",
          "Tick <strong>Include past records</strong> to include graduated and archived students, which are left out otherwise.",
          "Select <strong>Search deeper</strong> to search more of your school's records at once: more fields of people (email, phone, address, ID), student profile fields, notes, files, report card remarks, forms and their answers, messages, applicants, assessments, buses, bills, activities, events and announcements. Results are grouped as <strong>Exact match</strong>, then by kind with a count for each. Use the filters row to narrow by category.",
          "Press <strong>Ctrl+K</strong> (<strong>Cmd+K</strong> on a Mac) to jump to a page instead. See <a href=\"/legal/user-documentation/navigate-managira\">Find your way around Managira</a>.",
        ],
      },
      {
        title: "Change many students at once",
        text: "Tick the students, then choose <strong>Bulk Edit Students</strong>:",
        list: [
          "<strong>Change Class</strong> or <strong>Assign to Class</strong>: move them together.",
          "<strong>Assign School Year</strong>: put them into a school year.",
          "<strong>Edit Student Emails</strong> and <strong>Edit Student IDs</strong>: fix many in one go.",
          "<strong>Send Password Invite</strong>: invite students with an email to the student portal.",
        ],
      },
    ],
    faq: [
      ["Can I export the list?", "Use <a href=\"/legal/user-documentation/report-builder\">Report Builder</a> for exports to CSV, Excel or Word with exactly the columns you want."],
    ],
    related: ["create-and-add-student", "student-page", "edit-student-information", "report-builder"],
  },
  {
    slug: "student-page",
    title: "A student's page",
    topic: "Students & admissions",
    order: 2.5,
    summary: "One page for a student: details, grades, attendance, messages, bills, files, portfolio and transport, each in its own tab.",
    tags: ["student page", "student profile", "student tabs", "student attendance", "student messages", "student bills", "open student", "student details"],
    who: "Staff who can open the student: managers, and teachers and supervisors for students in their own classes. Each tab shows only to people who can use what's in it.",
    intro: "Open a student from All Students, their class, or the header search. The header shows their name, their student ID where your school uses custom IDs, <strong>Edit student</strong>, and the portal invite or reset. Below it, everything else is a tab. Each tab loads only when you open it, so the page itself opens quickly.",
    sections: [
      {
        title: "The tabs",
        table: [
          ["Tab", "What it shows"],
          ["<strong>Overview</strong>", "Their details, parents and guardians."],
          ["<strong>Grades</strong>", "This term's grades, with a <strong>Report card</strong> button (Terminal Reports)."],
          ["<strong>Attendance</strong>", "Overall attendance and overall lunch, days absent and late, and the last 10 days with each day's note. <strong>Take attendance</strong> opens the class's attendance."],
          ["<strong>Messages</strong>", "The parents' conversations, replied to in place, and what the school sent the family from the Mail Room. <strong>New message</strong> needs the Mail Room."],
          ["<strong>Bills</strong>", "The student's PayGira summary. <strong>Bills &amp; payments</strong> opens their ledger."],
          ["<strong>Files</strong>", "The student's files. See <a href=\"/legal/user-documentation/student-files\">Student files</a>."],
          ["<strong>Portfolio</strong>", "A folder for each term. See <a href=\"/legal/user-documentation/student-portfolio\">A student's portfolio</a>."],
          ["<strong>Transport</strong>", "Their bus and stop, with <strong>Track bus</strong>."],
          ["<strong>Old records</strong>", "Records kept from a previous system, where the school moved to Managira."],
        ],
        note: "A tab appears only for people who can use it. A teacher who can't open Bills doesn't see it.",
      },
      {
        title: "Each term is a new slate",
        text: "Grades, attendance and messages show the <strong>current term</strong> only. When a new term starts, they start fresh. Bills are the exception: money owed carries over, so the Bills tab shows the balance across all terms.",
      },
      {
        title: "Buttons open in a new tab",
        text: "The buttons inside the tabs (Take attendance, Bills &amp; payments, New message, Report card and Track bus) open in a new browser tab, so you never lose your place on the student's page.",
      },
      {
        title: "Long lists load a little at a time",
        list: [
          "Messages show the newest 5, with <strong>Show more</strong>.",
          "Attendance shows the last 10 days, with <strong>Show more</strong> for earlier ones.",
          "The tab's data is read only when you open it.",
        ],
      },
    ],
    faq: [
      ["Where did Message parent, Attendance and Bill go?", "They are tabs now, each with its own button inside."],
      ["Why can't I open a student?", "A teacher or supervisor can open only students in their own classes. Managers can open every student."],
      ["Why doesn't the page show the class and term?", "You open it from the class, which already says which class and term you're in."],
    ],
    related: ["find-students", "edit-student-information", "mark-attendance-for-a-class", "student-files", "student-portfolio"],
  },
  {
    slug: "edit-student-information",
    title: "Edit a student's information",
    topic: "Students & admissions",
    order: 3,
    summary: "Open a student from search or their class to update their details, photo, class, parents and the extra fields your school collects.",
    tags: ["edit student", "student profile", "student details", "update student", "delete student", "remove student", "archive student"],
    who: "Managers and staff given the <strong>Edit students</strong> permission. Teachers can view their own students.",
    sections: [
      {
        title: "Open the student",
        list: [
          "Search for them in <strong>Search anything</strong> at the top of the page, or",
          "open their class and select their name, or",
          "find them in <strong>Admissions</strong>, <strong>All Students</strong> and choose <strong>Edit Student</strong>.",
        ],
      },
      {
        title: "Make changes",
        steps: [
          ["Update the details you need. Each section saves on its own.", "edit-student.webp", "A student's page: details, class, parents and your school's own fields."],
          "Parents and guardians are listed under the student. Staff with the parents permission can edit them, add another, or invite them to the parent portal.",
          "Under <strong>Files</strong>, add, rename or remove the student's files. See <a href=\"/legal/user-documentation/student-files\">Student files</a>.",
          "Select <strong>Save</strong>.",
        ],
      },
    ],
    faq: [
      ["Who sees what I change?", "Staff with access to the student, and the student's parents for the parts they can see in the parent portal."],
      ["Can parents correct details themselves?", "Parents can update the emergency and pickup sections your school shares with them. See <a href=\"/legal/user-documentation/emergency-and-pickup-details\">Emergency &amp; pickup details</a>."],
      ["How do I remove or delete a student who left?", "Open <strong>Admissions</strong>, then <strong>Graduate &amp; Withdraw</strong>, choose the students and archive them as graduated or as having left. They come off the register and their records are kept; find them again in <strong>Graduates &amp; Alumni</strong>. <strong>Delete student</strong>, on the student's page, is only for a student added by mistake who has no scores, attendance, report cards or payments."],
    ],
    related: ["find-students", "transfer-a-student-between-classes-and-subject-matching", "create-manage-parent"],
  },
  {
    slug: "student-files",
    title: "Student files: insurance cards, plans and other papers",
    topic: "Students & admissions",
    order: 3.1,
    summary: "Keep a student's papers on their record, such as an insurance card or a birth certificate, and choose who can see each one.",
    tags: ["student files", "student documents", "upload document", "insurance card", "birth certificate", "immunization record", "IEP", "504 plan", "custody papers", "proof of address", "attach file to student", "expiry date"],
    who: "Staff who can open the student (<strong>Manage Students</strong>). Teachers, for students in their classes.",
    intro: "Every student has <strong>Files</strong> at the top of their page. Files are private: only the people you choose can open them.",
    sections: [
      {
        title: "Add a file",
        steps: [
          ["Open the student. <strong>Files</strong> is under their name.", "student-files.webp", "Files at the top of the student's page."],
          "Select <strong>Add file</strong>.",
          ["Choose the file, its type and who can see it. A title, expiry date and note are optional.", "student-files-add.webp", "Add a file opens on the right."],
          "Select <strong>Upload</strong>.",
        ],
        note: "PDFs, pictures and Word documents, up to 15 MB each.",
      },
      {
        title: "Who can see it",
        table: [
          ["Choice", "Who can open it"],
          ["<strong>Staff</strong>", "Staff who can open the student"],
          ["<strong>Managers only</strong>", "Managers and supervisors"],
          ["<strong>Family</strong>", "Staff, the student's parents and the student"],
        ],
        tip: "Custody papers and IEP or 504 plans start as <strong>Managers only</strong>.",
      },
      {
        title: "Change or remove a file",
        steps: [
          "Select <strong>Edit</strong> beside the file.",
          "Change what you need and select <strong>Save</strong>, or select <strong>Remove file</strong>.",
        ],
        note: "A file close to its expiry date shows in orange; an expired one shows in red.",
      },
      {
        title: "Add files with a new student",
        steps: [
          ["On <strong>Add student</strong>, under <strong>Files</strong>, select <strong>Add a file</strong>.", "add-student-files.webp", "Files on Add student."],
          "Choose the file, its type and who can see it. Add more if you need to.",
          "Save the student as usual.",
        ],
        note: "<strong>Edit student</strong> has the same <strong>Files</strong> section, to add, rename or remove files.",
      },
      {
        title: "Require a file for every new student",
        steps: [
          ["Open <strong>Admissions</strong>, <strong>Admission Settings</strong>, then <strong>Student fields</strong>.", "admission-settings-files.webp", "Student files: optional unless you turn this on."],
          "Turn on <strong>Require a file for each new student</strong>.",
        ],
        note: "It's off unless you turn it on.",
      },
      {
        title: "What families see",
        text: "Files set to <strong>Family</strong> show on the parent's <strong>Documents</strong> and <strong>Portfolio</strong>, and on the student's <strong>Portfolio</strong>. To keep them from a class, untick <strong>Student files</strong> in <a href=\"/legal/user-documentation/class-settings\">Class settings</a>.",
      },
    ],
    faq: [
      ["Who can see a file set to Managers only?", "Managers and supervisors. Teachers and families don't see it in the list."],
      ["Can I replace a file?", "Remove it and add the new one."],
      ["Where are files kept?", "Privately, on the student's record. Opening one gives a link that works for a few minutes."],
    ],
    related: ["edit-student-information", "student-portfolio", "class-settings", "admission-settings"],
  },
  {
    slug: "student-portfolio",
    title: "A student's portfolio: documented and undocumented work",
    topic: "Students & admissions",
    order: 3.2,
    summary: "See each term's marked work for a student. Testing Room work is documented, with a PDF of the test; marks entered by hand are undocumented.",
    tags: ["portfolio", "student portfolio", "documented", "undocumented", "testing room", "marked tests", "test PDF", "student work"],
    who: "Staff who can open the student. Parents and students see their own portfolio.",
    sections: [
      {
        title: "Open a student's portfolio",
        steps: [
          ["Open the student and select <strong>Portfolio</strong>.", "student-portfolio.webp", "A term's portfolio: totals, documented tests, then each subject."],
          "Choose a term at the top, if there's more than one.",
          "Select a subject to see its work and marks.",
        ],
      },
      {
        title: "Documented and undocumented",
        table: [
          ["Label", "Means", "You can"],
          ["<strong>Documented</strong>", "Taken in the Testing Room.", "<strong>View test</strong> or download its <strong>PDF</strong>."],
          ["<strong>Undocumented</strong>", "The teacher entered the mark.", "See the mark."],
        ],
        note: "<em>Waiting for approval</em> means the teacher hasn't approved the mark yet. Only staff see it.",
      },
      {
        title: "What families see",
        steps: [
          ["Parents open their child's page and select <strong>Portfolio</strong>. Students select <strong>Portfolio</strong> on their dashboard.", "parent-portfolio.webp", "A parent's view: shared files first, then the term's work."],
        ],
        list: [
          "Files the school shared with the family come first.",
          "Marks show once the teacher posts them.",
          "A documented test opens in full only when the teacher shares it.",
          "To hide the portfolio from a class, untick <strong>Portfolio</strong> in <a href=\"/legal/user-documentation/class-settings\">Class settings</a>.",
        ],
      },
    ],
    faq: [
      ["Why is a test documented but a parent can't open it?", "The teacher hasn't shared the full test with families. They still see the mark once it's posted."],
      ["How does work become documented?", "Students take it in the Testing Room. See <a href=\"/legal/user-documentation/student-testing-room\">Take a test</a>."],
    ],
    related: ["student-files", "parent-forms-and-portfolio", "class-settings", "student-testing-room"],
  },
  {
    slug: "admission-settings",
    title: "Admission Settings: online admission and the fields you collect",
    topic: "Students & admissions",
    order: 4,
    summary: "One place to open online admission, set the application fee, and choose the fields on student forms and parents' records.",
    tags: ["admission settings", "online admission", "student fields", "custom fields", "contact template", "parents and guardians fields", "application fee"],
    featured: true,
    who: "Managers, and staff given the <strong>Admission Settings</strong> or <strong>Contact template</strong> permission (each tab follows its own permission).",
    intro: "Admission Settings has three tabs. The basic fields every school needs are always asked and can't be removed; you add your own beneath them, and they appear wherever students or parents are added or edited.",
    sections: [
      {
        title: "Open Admission Settings",
        steps: [
          ["Open <strong>Admissions</strong>, then <strong>Admission Settings</strong>.", "admission-settings.webp", "Admissions, Admission Settings: Online admission, Student fields, and Parents & guardians."],
          "Choose a tab: <strong>Online admission</strong>, <strong>Student fields</strong> or <strong>Parents &amp; guardians</strong>.",
        ],
      },
      {
        title: "Online admission",
        steps: [
          "Turn online applications on, and choose the dates they're open.",
          "Choose whether to charge an <strong>application fee</strong>, and how much.",
          "Select <strong>Save online admission</strong>. Families can now apply from your school website.",
        ],
        note: "Applications arrive in <strong>Admissions</strong>, <strong>Online Applications</strong>. See <a href=\"/legal/user-documentation/pending-admissions-review-and-approval\">Review applications</a>.",
      },
      {
        title: "Student fields",
        steps: [
          ["Under <strong>Your fields</strong>, select <strong>Add Student</strong> and choose the type of answer (text, yes or no, a date, a choice and so on).", "admission-settings-fields.webp", "Student fields: the basics are always asked; your own fields follow, in the order you drag them."],
          "Choose whether the field appears on the <strong>Add Student form</strong>, the <strong>Online application</strong>, or both, and whether it's required.",
          "Drag fields to arrange them. Changes appear on the forms straight away.",
        ],
        example: "A school adds <em>Allergies</em> (text), <em>Has an IEP or 504 plan</em> (yes or no) and <em>Previous school</em> (text) to both forms.",
        note: "<strong>Student files</strong>, on the same tab, makes a file required on Add student. See <a href=\"/legal/user-documentation/student-files\">Student files</a>.",
      },
      {
        title: "Parents & guardians",
        text: "This tab holds the sections and fields kept on each parent's record, such as <em>Emergency contact</em> and <em>Allowed to pick up</em>. For each section you choose who else sees it: parents (who can also update it), students, teachers (on the class Pickup list) and drivers. See <a href=\"/legal/user-documentation/emergency-and-pickup-details\">Emergency &amp; pickup details</a>.",
        image: "admission-settings-family.webp",
        caption: "Parents & guardians: each section says who else sees it.",
      },
    ],
    faq: [
      ["What happened to Contact Template?", "It's the Parents & guardians tab of Admission Settings now, so everything about what you collect is in one place. Old links take you there."],
      ["Can I remove a basic field like the student's name?", "No. The basics every school needs are always asked. Add your own fields beneath them."],
      ["Do new fields apply to existing students?", "Yes. They appear empty on existing students, ready to fill in."],
    ],
    related: ["online-admission", "pending-admissions-review-and-approval", "emergency-and-pickup-details", "create-and-add-student"],
  },
  {
    slug: "online-admission",
    title: "Online admission from your school website",
    topic: "Students & admissions",
    order: 5,
    summary: "Families apply on your school website and pay an application fee if you set one; you review every application before it becomes a student.",
    tags: ["online admission", "online application", "enrollment application", "application fee", "school website"],
    who: "Families apply. Managers and staff given <strong>Admission Settings</strong> open it; staff with <strong>Approve admissions</strong> review it.",
    intro: "Online admission lets families apply from home. Nothing becomes a student record until your school approves it.",
    sections: [
      {
        title: "How it works for families",
        steps: [
          "On your school website, the family selects <strong>Apply</strong> and fills in the application, including any fields you added.",
          "If you charge an application fee, they pay it online by card before sending.",
          "They receive a confirmation email, and the application reaches your school.",
        ],
      },
      {
        title: "Turn it on",
        text: "Open <strong>Admissions</strong>, <strong>Admission Settings</strong>, <strong>Online admission</strong>, choose the dates and the fee, and save. Your website shows <strong>Apply</strong> while applications are open. See <a href=\"/legal/user-documentation/admission-settings\">Admission Settings</a>.",
        image: "admission-settings.webp",
        caption: "Admission Settings, Online admission: dates and the application fee.",
      },
    ],
    faq: [
      ["Can families save and come back later?", "Applications are sent in one go, so families should have their documents ready before they start."],
      ["Is the application fee refundable?", "That's your school's decision. Managira collects it through PayGira into your school's own account."],
    ],
    related: ["admission-settings", "pending-admissions-review-and-approval", "school-website"],
  },
  {
    slug: "pending-admissions-review-and-approval",
    title: "Review and approve online applications",
    topic: "Students & admissions",
    order: 6,
    summary: "Check each online application, place the student in a class and school year, then approve it to create the student record, or decline it.",
    tags: ["online applications", "pending admissions", "approve application", "review applications"],
    who: "Managers, and staff given the <strong>Approve admissions</strong> permission.",
    sections: [
      {
        title: "Review an application",
        steps: [
          ["Open <strong>Admissions</strong>, then <strong>Online Applications</strong>, and select an application.", "online-applications.webp", "Admissions, Online Applications: everything families sent from your website."],
          "Check the details and any documents and photos against your school's rules.",
          "Confirm the class, subjects and school year the student will join.",
          "<strong>Save</strong> to come back to it later, or <strong>Approve</strong> to create the student record now.",
        ],
        note: "Approving creates the student (with the next student ID) and links their parents. The family is told by email.",
      },
      {
        title: "Decline an application",
        text: "Delete the application to decline it. Everything in it is removed permanently, so download anything you need to keep first.",
      },
    ],
    related: ["online-admission", "admission-settings", "create-and-add-student"],
  },
  {
    slug: "transfer-a-student-between-classes-and-subject-matching",
    title: "Transfer a student to another class",
    topic: "Students & admissions",
    order: 7,
    summary: "Move a student to a new class during the year. Their history stays, matching subjects carry over, and you add any subjects only the new class has.",
    tags: ["transfer student", "change class", "move student", "subjects", "mid-year transfer"],
    who: "Managers, and staff given the <strong>Edit students</strong> permission.",
    sections: [
      {
        title: "Transfer the student",
        steps: [
          ["Open the student, or tick them in <strong>All Students</strong>.", "all-students.webp", "All Students: tick students, then Bulk Edit Students to change their class."],
          "Choose <strong>Change Class</strong>, select the new class and confirm.",
          "Check their subjects in the new class and add any that don't carry over.",
        ],
      },
      {
        title: "What happens to subjects and records",
        list: [
          "Subjects with the same name in the new class carry over automatically.",
          "Subjects the new class doesn't have stop being active, but their past grades stay in the student's history.",
          "Attendance, grades, parents and transcript history are all kept.",
        ],
        tip: "For a mid-term move, check the student's report card after the transfer so later grades go to the right class and subject.",
      },
    ],
    related: ["enrolling-classes-and-student-in-aterm-semester", "edit-student-information", "find-students"],
  },
  {
    slug: "promote-students-and-manage-graduation",
    title: "Promote students and manage graduation",
    topic: "Students & admissions",
    order: 8,
    summary: "Decide who moves up on each report card, then promote whole classes into the next year or term, now or on a date. Graduate and withdraw students.",
    tags: ["promotion", "end of year", "graduation", "repeat a grade", "withdraw student", "alumni"],
    who: "Managers, and staff given the <strong>Promotion</strong> and <strong>School years &amp; terms</strong> permissions.",
    intro: "Promotion moves students into their next class for a new school year or term, using the decision saved on each student's term report. Students who finish your highest grade graduate, and students who leave are recorded as former students. Their records always stay.",
    sections: [
      {
        title: "1. Decide who moves up",
        text: "On each class's term report, every student has a decision: <strong>Promoted To</strong> a class, or <strong>Repeated In</strong> a class. Save it with the report. See <a href=\"/legal/user-documentation/report-card\">Report cards</a>.",
        tip: "The promotion page's <strong>Before you start</strong> links to <strong>Report and promotion settings</strong>.",
      },
      {
        title: "2. Plan the promotion",
        steps: [
          ["Open <strong>Management</strong>, then <strong>Promotion</strong>. <strong>Suggested</strong> lists the promotion Managira thinks you want next, such as <em>Fall Semester → Spring Semester</em>, with how many students can move. Select <strong>Plan this</strong>, or select <strong>Plan a promotion</strong> to choose for yourself.", "promotion-plan.webp", "Plan Promotion: from which year and term, to which, and when."],
          "Choose the school year and term you're promoting <strong>from</strong>, and the <strong>target</strong> school year and term.",
          "Under <strong>When should this happen?</strong> choose <strong>Schedule Promotion</strong> and a date (it starts on the target term's first day), or <strong>Apply Now</strong>.",
          "Choose the classes (or <strong>Select All Classes</strong>). <strong>Saved Student Decisions</strong> lists each student, their class, the decision and where they go.",
          "Select <strong>Schedule Promotion</strong> (or <strong>Apply Now</strong>). A scheduled promotion runs by itself on its date.",
        ],
        note: "Promotion runs from the current school year to the current or a future one.",
      },
      {
        title: "3. Check, apply or reverse",
        image: "promotion.webp",
        caption: "Promotion History: each promotion, its status and what it did.",
        list: [
          "<strong>Promotion History</strong> lists every promotion. <strong>What this promotion did</strong> shows the enrollments, classes, students and subjects it added.",
          "<strong>Apply Now</strong> runs a scheduled promotion straight away; <strong>Cancel</strong> stops it.",
          "<strong>Reverse</strong> undoes a finished one: the enrollments, classes and subjects it created are removed, and students are back in their previous classes. Check any work done in the new classes since.",
        ],
      },
      {
        title: "Graduate and withdraw",
        steps: [
          "Open <strong>Admissions</strong>, <strong>Former Students</strong>, then <strong>Graduate &amp; Withdraw</strong>.",
          "Students are grouped by graduation year. The first group opens at once; select another group to load it. Use <strong>Search</strong> to find a student in any group.",
          "Tick the students, or choose <strong>Select all</strong> to take every student in the group (not only the ones on this page). Ticked students stay ticked as you move between pages.",
          "Graduate your final-year students, or withdraw students who are leaving.",
          "They move to <strong>Graduates &amp; Alumni</strong>, with their records and transcripts kept.",
        ],
        note: "Each group shows its students a page at a time. Choose <strong>Rows per page</strong> (10, 20, 50, 100 or 200) and use <strong>Prev</strong> and <strong>Next</strong> under the list.",
      },
    ],
    faq: [
      ["Do grades move with students?", "Grades stay with the term and class they were earned in, and appear on the student's history and transcript."],
      ["Can graduates still get a transcript?", "Yes. See <a href=\"/legal/user-documentation/transcript\">Transcripts</a>."],
    ],
    related: ["create-school-years-terms-and-set-the-current-term", "transcript", "find-students"],
  },
];
