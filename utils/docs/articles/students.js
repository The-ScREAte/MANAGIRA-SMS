"use strict";

// Students & admissions: adding and finding students, a student's page, files and portfolio,
// admission forms, online applications, transfers, promotion, graduation and former students.
module.exports = [
  {
    slug: "create-and-add-student",
    title: "Add a student, or import many at once",
    topic: "Students & admissions",
    order: 1,
    summary: "Add one student with their class, details, photo, files and parents, or fill many forms at once from a CSV or Excel template.",
    tags: ["add student", "new student", "register student", "import students", "bulk import", "csv template", "excel template", "enrollment", "student photo", "guardian", "future term"],
    featured: true,
    who: "Managers, and staff given the <strong>Add students</strong> permission.",
    intro: "Add students one at a time as they join, or fill many forms at once from a spreadsheet. A student placed in a class is enrolled in the current term automatically, so they show in attendance and the gradebook straight away.",
    sections: [
      {
        title: "Open the form",
        steps: [
          ["Go to <strong>Admissions</strong> and select <strong>Add student</strong> in the menu on the left."],
          ["The page is titled <strong>Add student</strong>. The buttons at the top right are <strong>Add Form</strong>, <strong>Import</strong>, <strong>Save</strong> and <strong>Clear</strong>."],
        ],
        list: [
          "<strong>Add Form</strong> adds another blank student card, so you can enter several students and save them together.",
          "<strong>Import</strong> fills cards from a spreadsheet. See \"Import many students\" below.",
          "<strong>Save</strong> saves every card on the page.",
          "<strong>Clear</strong> removes all cards. The <strong>⋮</strong> menu on one card has <strong>Remove Form</strong> for that card only.",
        ],
        image: "add-student-page.webp",
        caption: "Admissions, Add Student: one card per student.",
      },
      {
        title: "Fill in a student's card",
        text: "Fields marked <strong>*</strong> are required. The rest can be added later from the student's page.",
        steps: [
          ["Under <strong>Enrollment</strong>, choose <strong>Current Term</strong> for a student starting now, or <strong>Future Term</strong> to pre-enroll them. For a future term, pick the <strong>School Year</strong> and <strong>Term</strong>. They are registered but not placed in a class until that term opens."],
          ["Under <strong>Student Information</strong>, enter <strong>First Name</strong>, <strong>Last Name</strong>, <strong>Date of Birth</strong> and <strong>Gender</strong>. If you don't know the birth date, check <strong>N/K (Date of birth not known)</strong>. <strong>Hometown</strong>, <strong>Student Address</strong> and <strong>Student Email</strong> are optional. Your school's own fields appear here too."],
          ["Under <strong>Academic Placement</strong>, choose the <strong>Class</strong>. <strong>Graduation Year Group</strong> is optional."],
          ["Select <strong>Show Subjects</strong> to choose the student's subjects. They load once you've chosen a class, and the badge counts how many you've checked."],
          ["<strong>Programs &amp; Indicators</strong> (IEP, Section 504, English learner and so on) and <strong>More Details</strong> show only if your school has turned those fields on. See <a href=\"/legal/user-documentation/admission-settings\">Admission Settings</a>.", "add-student-more-zoom.webp", "Programs & Indicators are staff-only fields."],
          ["Under <strong>Photo</strong>, choose a picture. It's optional."],
        ],
        note: "If your school uses its own student ID numbers, an <strong>ID</strong> box appears at the top of each card. See <a href=\"/legal/user-documentation/configure-custom-student-ids\">Set up student ID numbers</a>.",
      },
      {
        title: "Add student files",
        text: "Where your school keeps student files, a <strong>Files</strong> section sits under the photo. Select <strong>Add a file</strong>, choose the file, its type and who can see it, and repeat for more. It says <strong>Optional</strong> or <strong>Required</strong> beside the heading. See <a href=\"/legal/user-documentation/student-files\">Student files</a>.",
      },
      {
        title: "Add parents or guardians",
        steps: [
          ["Under <strong>Guardian Details</strong>, choose <strong>Search existing</strong> if the parent already has a child in your school, or <strong>New guardian</strong> to create one."],
          ["For a new guardian, enter first and last name, phone, email, address and hometown. Check <strong>Use student address</strong> to copy the student's address. A photo is optional.", "add-student-guardian-new-zoom.webp", "A new guardian's details."],
          "Select <strong>+ Add Another Guardian</strong> for more parents. <strong>Remove Guardian</strong> takes one off the card.",
        ],
        note: "Guardian Details says <em>Required for parent portal</em>: a parent needs an email to be invited. The invitation is sent afterward, from the parent's record. See <a href=\"/legal/user-documentation/create-manage-parent\">Add and manage parents and guardians</a>.",
      },
      {
        title: "Save",
        steps: [
          "Select <strong>Save</strong> at the top. A box says <em>Saving Students</em> while it works.",
          "If a required field is empty, the page takes you to it. Fill it in and save again.",
          "The students appear in <a href=\"/legal/user-documentation/find-students\">All Students</a> and in their classes.",
        ],
      },
      {
        title: "Import many students",
        steps: [
          ["Select <strong>Import</strong>. In the window, download the template: <strong>CSV</strong>, <strong>Excel</strong> or <strong>Word</strong>. It has a column for each of your own student fields.", "add-student-import-zoom.webp", "Download a template, then drop your file on the box."],
          "Fill in one row per student and delete the example row.",
          "Drag the file onto the box, or click it to choose the file. Excel, CSV, PDF, Word and pictures are accepted.",
          ["A summary shows how many students were read, which of your own columns matched, which columns were ignored and which cells to check. Open <strong>Ignored columns</strong> or <strong>Cells to check</strong> to see them."],
          ["Select <strong>Review forms</strong>. Each student is now a card on the page. Nothing is saved yet. Fix anything marked, then select <strong>Save</strong>."],
        ],
        example: "A school adds three new sixth graders from a spreadsheet. The file has columns for first and last name, birth date, gender, class and a parent's name, phone and email. After <strong>Review forms</strong>, the secretary fixes one birth date marked in the cards and saves all three.",
        tip: "Duplicate rows are skipped and rows that can't be read are counted. The summary says how many of each.",
      },
    ],
    faq: [
      ["Can I add a student without a parent?", "Yes. Add parents later from the student's page, from Edit student, or from <strong>Management › Parents &amp; guardians</strong>."],
      ["Why doesn't a new student appear in attendance?", "Their class isn't enrolled in the current term yet, or you chose <strong>Future Term</strong>. See <a href=\"/legal/user-documentation/enrolling-classes-and-student-in-aterm-semester\">Enrollment</a>."],
      ["Where do the extra fields come from?", "From <a href=\"/legal/user-documentation/admission-settings\">Admission Settings</a>. Fields you add there appear on every card and in the import template."],
      ["Can parents apply online instead?", "Yes, if your school turns on online admission. Applications arrive in <strong>Online applications</strong> for you to approve. See <a href=\"/legal/user-documentation/online-admission\">Online admission</a>."],
    ],
    related: ["find-students", "student-page", "admission-settings", "edit-student-information", "create-manage-parent"],
  },
  {
    slug: "find-students",
    title: "Find students: All students, search and filters",
    topic: "Students & admissions",
    order: 2,
    summary: "Search every student in your school, filter by class, gender or status, open a student, and change several students at once.",
    tags: ["all students", "search students", "find a student", "filters", "bulk edit", "edit selected", "student list", "portal emails"],
    who: "Managers, and staff with the <strong>Manage Students</strong> permission. Teachers and supervisors see only the students in their own classes.",
    intro: "All students is the list of everyone enrolled at your school. Use it to look someone up, narrow the list down, or update a group of students in one go.",
    sections: [
      {
        title: "Open All students",
        image: "students-all.webp",
        caption: "Admissions › All students. Every student, with their class, email, school year and status.",
        steps: [
          ["Go to <strong>Admissions</strong> and select <strong>All students</strong> in the menu on the left."],
          "The list shows 20 students at a time, sorted by name. Select a column heading (Student, ID, Class, Gender, Email, School Year or Status) to sort by it. Select it again to reverse the order.",
        ],
      },
      {
        title: "Search for a student",
        steps: [
          ["Type a name or student ID in the search box at the top of the list."],
          ["The list narrows as you type. The line under the box says how many students match.", "students-all-search-result-zoom.webp", "Typing “Audrey” finds Audrey Diaz in 6th Grade."],
        ],
        tip: "To find a student from any page, use <strong>Search anything</strong> at the top of the screen instead. See <a href=\"/legal/user-documentation/navigate-managira\">Find your way around Managira</a>.",
      },
      {
        title: "Filter the list",
        steps: [
          ["Select <strong>Filters</strong>, to the right of the search box."],
          ["Choose a <strong>Class</strong>, a <strong>Gender</strong> or a <strong>Status</strong> (Active or Graduated). You can combine them."],
          "Select <strong>Done</strong>. The Filters button shows how many filters are on.",
          "To see everyone again, open <strong>Filters</strong> and select <strong>Clear</strong>.",
        ],
        example: "To list the girls in 6th Grade, choose Class <strong>6th Grade</strong> and Gender <strong>Female</strong>, then select <strong>Done</strong>.",
      },
      {
        title: "Open or edit a student",
        text: "Each row has its own buttons on the right:",
        list: [
          "<strong>View student</strong> (the eye) opens the student's page: their details, grades, attendance, messages, bills and files. See <a href=\"/legal/user-documentation/student-page\">A student's page</a>.",
          "<strong>Edit</strong> (the pencil) changes their class, school year, email or student ID without leaving the list.",
          "The <strong>padlock</strong> emails the student a link to set their student portal password: an invitation the first time, a reset after that. It shows when your school uses the student portal, and works only for a student with an email address.",
        ],
      },
      {
        title: "Move through a long list",
        list: [
          "Use <strong>Rows per page</strong> to show 10, 20, 50, 100 or 200 students at a time. Managira remembers your choice on this device.",
          "The range (for example <em>21–40 of 5,400</em>) shows where you are. Use the arrows to go to the previous or next page.",
        ],
      },
      {
        title: "Change several students at once",
        steps: [
          "Check the box beside each student you want to change. To check everyone on the page, check the box in the heading row.",
          ["A bar appears above the list. Select <strong>Edit Selected</strong>."],
          ["Check what you want to change: <strong>Class</strong>, <strong>School year</strong>, <strong>Emails</strong> or <strong>Student IDs</strong>. Then pick the new value."],
          "Select <strong>Review</strong>, check the summary of changes, and confirm.",
        ],
        list: [
          "<strong>Student IDs</strong> shows only when your school types its own student IDs. See <a href=\"/legal/user-documentation/configure-custom-student-ids\">Set up student ID numbers</a>.",
          "<strong>Send Portal Emails</strong>, in the same bar, invites the selected students to the student portal. Only students with an email address receive it.",
          "The <strong>×</strong> at the end of the bar clears your selection.",
        ],
        note: "Choosing a school year adds students to that year. It never removes them from an earlier term, so their past grades and attendance stay where they are.",
      },
    ],
    faq: [
      ["Why can't I see some students?", "Teachers and supervisors see only the students in their own classes. Graduated students show only when the Status filter is <strong>All</strong> or <strong>Graduated</strong>."],
      ["Some students say “Not enrolled in” the current term. What does that mean?", "They aren't enrolled in this term yet, so they won't appear in its class lists, attendance or promotion. Enroll them from Management › Enrollment. See <a href=\"/legal/user-documentation/enrolling-classes-and-student-in-aterm-semester\">Enroll classes and students in a term</a>."],
      ["Can I export the list?", "Yes. Use <a href=\"/legal/user-documentation/report-builder\">Report Builder</a> to export students to CSV, Excel or Word with exactly the columns you need."],
    ],
    related: ["create-and-add-student", "student-page", "edit-student-information", "report-builder"],
  },
  {
    slug: "student-page",
    title: "A student's page",
    topic: "Students & admissions",
    order: 2.5,
    summary: "One page for a student: details, grades, attendance, messages, bills, files, portfolio and transport, each in its own tab.",
    tags: ["student page", "student profile", "student tabs", "student attendance", "student messages", "student bills", "open student", "student details", "portal invite", "reset student password"],
    who: "Staff who can open the student: managers, and teachers and supervisors for students in their own classes. Each tab shows only to people who can use what's in it.",
    intro: "Open a student from All Students, from their class, or from the header search. Everything about them is on this page, one tab at a time. Each tab loads when you open it.",
    sections: [
      {
        title: "The header",
        steps: [
          ["The top of the page shows the student's photo and name. A green <strong>Portal</strong> badge means they have signed in to the student portal. The student ID shows beside the name where your school uses custom IDs.", "student-page.webp", "Audrey Diaz's page, opened from Admissions › All Students."],
          ["<strong>Edit student</strong> opens their full form. See <a href=\"/legal/user-documentation/edit-student-information\">Edit a student's information</a>."],
          "The button beside it invites the student to the student portal (<strong>Invite to student portal</strong>) the first time, and says <strong>Reset portal password</strong> after that. It emails a link, so the student needs an email address, and the class's <strong>Student portal</strong> switch in <a href=\"/legal/user-documentation/class-settings\">Class settings</a> must be on.",
        ],
      },
      {
        title: "The tabs",
        table: [
          ["Tab", "What it shows"],
          ["<strong>Overview</strong>", "Gender, date of birth and email, and the parents and guardians with a <strong>View</strong> button each."],
          ["<strong>Grades</strong>", "This term's marks by subject, with a <strong>Report card</strong> button (needs Terminal Reports)."],
          ["<strong>Attendance &amp; lunch</strong>", "Overall attendance and overall lunch, days absent and late, and the recent days with each day's note. <strong>Take attendance</strong> opens the class's sheet."],
          ["<strong>Messages</strong>", "The parents' conversations, answered in place, and what the school sent the family from the Mailroom. <strong>New message</strong> needs the Mailroom."],
          ["<strong>Bills</strong>", "The PayGira summary: balance and last payment. <strong>Bills &amp; payments</strong> opens the full ledger."],
          ["<strong>Files</strong>", "The student's files. See <a href=\"/legal/user-documentation/student-files\">Student files</a>."],
          ["<strong>Portfolio</strong>", "A folder for each term. See <a href=\"/legal/user-documentation/student-portfolio\">A student's portfolio</a>."],
          ["<strong>Transport</strong>", "Their bus and stop, with <strong>Track bus</strong>. Shown where transportation is on."],
          ["<strong>Old records</strong>", "Records kept from your school's previous system. Shown only if the student has some."],
        ],
        note: "A tab appears only to people who can use it. A teacher who can't open Bills doesn't see that tab.",
      },
      {
        title: "Look at each tab",
        steps: [
          ["<strong>Grades</strong> lists each subject's scores for the current term.", "student-page-grades.webp", "Grades, with the Report card button."],
          ["<strong>Attendance &amp; lunch</strong> shows how often the student was present and who marked each day.", "student-page-attendance.webp", "Attendance and lunch."],
          ["<strong>Messages</strong> shows conversations with the family, newest first."],
          ["<strong>Bills</strong> summarizes what is owed and the last payment."],
          ["<strong>Portfolio</strong> shows the term's marked work."],
          ["<strong>Transport</strong> shows the student's bus."],
        ],
      },
      {
        title: "Each term is a new slate",
        text: "Grades, attendance and messages show the <strong>current term</strong>, and start fresh when a new term does. Bills are the exception: money owed carries over, so Bills shows the balance across all terms.",
      },
      {
        title: "Buttons open in a new tab",
        text: "<strong>Take attendance</strong>, <strong>Bills &amp; payments</strong>, <strong>New message</strong>, <strong>Report card</strong> and <strong>Track bus</strong> open in a new browser tab, so you never lose your place.",
      },
    ],
    faq: [
      ["Why can't I open a student?", "A teacher or supervisor can open only students in their own classes. Managers can open every student."],
      ["Why is there no Old records tab?", "It appears only for students who have records from a previous system."],
      ["Why is the portal button missing?", "Your school's student portal must be on, and the student's class must have <strong>Student portal</strong> switched on in Class settings."],
      ["Where did Message parent, Attendance and Bill go?", "They are tabs now, each with its own button inside."],
    ],
    related: ["find-students", "edit-student-information", "mark-attendance-for-a-class", "student-files", "student-portfolio"],
  },
  {
    slug: "edit-student-information",
    title: "Edit a student's information",
    topic: "Students & admissions",
    order: 3,
    summary: "Change a student's details, photo, class, subjects, files and parents, and the extra fields your school collects.",
    tags: ["edit student", "student profile", "student details", "update student", "delete student", "remove student", "change photo", "change class", "student subjects"],
    who: "Managers and staff given the <strong>Edit Students</strong> permission. Teachers and supervisors edit students in their own classes only.",
    intro: "The Edit student form holds everything about a student in one place. You can reach it from the student's page, or edit only the class, school year or email from the pencil in All Students.",
    sections: [
      {
        title: "Open Edit student",
        steps: [
          ["Open the student, then select <strong>Edit student</strong> at the top right of their page."],
        ],
        list: [
          "To find the student first, use <strong>Search anything</strong> at the top, open their class, or search in <a href=\"/legal/user-documentation/find-students\">All Students</a>.",
          "The pencil in All Students changes only class, school year and email. Use Edit student for anything else.",
        ],
      },
      {
        title: "Change the details",
        steps: [
          ["<strong>Photo</strong>: choose a picture under <strong>Change photo</strong>, or select <strong>Remove photo</strong> if there is one. Removing needs the <strong>Edit Students</strong> permission."],
          ["<strong>Personal information</strong> holds first and last name, date of birth (or <strong>Not known</strong>), gender, hometown, address, email, <strong>Graduation Year Group</strong> and <strong>Class</strong>.", "edit-student-page.webp", "Edit student: photo, personal information, then your school's own fields."],
          "<strong>More details</strong> holds your school's own fields, including Programs &amp; Indicators such as IEP and Section 504 plan. They're set up in <a href=\"/legal/user-documentation/admission-settings\">Admission Settings</a>.",
          "<strong>Files</strong> lists the student's files. Change a file's type, title or who can see it, check <strong>Remove</strong>, or select <strong>Add file</strong>. See <a href=\"/legal/user-documentation/student-files\">Student files</a>.",
          "<strong>Subjects</strong> shows the subjects of the student's class as check boxes.",
          ["<strong>Parents &amp; guardians</strong> shows each parent's details. Select <strong>+ Add parent / guardian</strong> to add another."],
          ["Select <strong>Save</strong> at the bottom."],
        ],
        note: "Moving a student to another class changes their class in the current term only. Earlier terms keep the class they had. See <a href=\"/legal/user-documentation/transfer-a-student-between-classes-and-subject-matching\">Transfer a student</a>.",
      },
      {
        title: "Delete a student added by mistake",
        text: "The <strong>⋮</strong> button beside Save opens <strong>Delete student</strong>. It works only for a student with no scores, attendance, report cards or payments. For anyone who has left the school, use <a href=\"/legal/user-documentation/promote-students-and-manage-graduation\">Graduate &amp; Withdraw</a> instead, which keeps their records.",
        warning: "Deleting a student is permanent.",
      },
    ],
    faq: [
      ["Who sees what I change?", "Staff with access to the student, and the student's parents for the parts they can see in the parent portal."],
      ["Can parents correct details themselves?", "Parents can update the emergency and pickup sections your school shares with them. See <a href=\"/legal/user-documentation/emergency-and-pickup-details\">Emergency &amp; pickup details</a>."],
      ["I changed a parent's email here. Do they get a new invitation?", "No. Send the invitation from <strong>Management › Parents &amp; guardians</strong>. See <a href=\"/legal/user-documentation/create-manage-parent\">Add and manage parents and guardians</a>."],
    ],
    related: ["find-students", "student-page", "transfer-a-student-between-classes-and-subject-matching", "create-manage-parent"],
  },
  {
    slug: "student-files",
    title: "Student files: insurance cards, plans and other papers",
    topic: "Students & admissions",
    order: 3.1,
    summary: "Keep a student's papers on their record, such as an insurance card or a birth certificate, and choose who can see each one.",
    tags: ["student files", "student documents", "upload document", "insurance card", "birth certificate", "immunization record", "IEP", "504 plan", "custody papers", "proof of address", "attach file to student", "expiry date"],
    who: "Staff who can open the student (<strong>Manage Students</strong>). Teachers and supervisors, for students in their own classes. Managers and supervisors only see <strong>Managers only</strong> files.",
    intro: "Every student has a <strong>Files</strong> tab. Files are private: only the people you choose can open them.",
    sections: [
      {
        title: "Add a file",
        steps: [
          ["Open the student and select the <strong>Files</strong> tab. The number beside it counts the files.", "student-files.webp", "The Files tab, with Add file at the top right."],
          "Select <strong>Add file</strong>. A panel opens on the right.",
          ["Choose or drop the file. Pick its <strong>Type</strong>, and an <strong>Expires</strong> date if it runs out (an insurance card, say). Give it a <strong>Title</strong>, choose <strong>Who can see it</strong>, and add a <strong>Note</strong> if you like.", "student-files-add.webp", "The Student file panel opens beside the page."],
          "Select <strong>Upload</strong>.",
        ],
        note: "PDFs, pictures and Word documents, up to 15 MB each.",
      },
      {
        title: "Who can see a file",
        table: [
          ["Choice", "Who can open it"],
          ["<strong>Staff</strong>", "Staff who can open the student"],
          ["<strong>Managers only</strong>", "Managers and supervisors"],
          ["<strong>Family</strong>", "Staff, the student's parents and the student"],
        ],
        tip: "Custody papers and IEP or 504 plans start as <strong>Managers only</strong>.",
      },
      {
        title: "Open, change or remove a file",
        steps: [
          "Select <strong>Open</strong> to view the file. It opens through a link that works for a few minutes.",
          "Select <strong>Edit</strong> to change the type, title, expiry date, who can see it or the note, then <strong>Save</strong>.",
          "In Edit, select <strong>Remove file</strong> to delete it, file included.",
        ],
        note: "An expiry date within a few weeks shows in orange, and an expired file shows in red. To replace a file, remove it and add the new one.",
      },
      {
        title: "Add files when you add or edit a student",
        steps: [
          "On <strong>Add student</strong>, the <strong>Files</strong> section has <strong>Add a file</strong>. Add as many as you need, then save the student.",
          "<strong>Edit student</strong> has the same <strong>Files</strong> section to add, rename or remove files.",
        ],
      },
      {
        title: "Require a file for every new student",
        steps: [
          ["Go to <strong>Admissions › Admission settings</strong>, then <strong>Student fields</strong>."],
          ["Turn on <strong>Require a file for each new student</strong>. It says <em>Optional</em> until you do."],
        ],
      },
      {
        title: "What families see",
        text: "Files set to <strong>Family</strong> show on the parent's <strong>Documents</strong> and <strong>Portfolio</strong>, and on the student's <strong>Portfolio</strong>. To keep them from a class, turn off <strong>Student files</strong> under Share with in <a href=\"/legal/user-documentation/class-settings\">Class settings</a>.",
      },
    ],
    faq: [
      ["Who can see a file set to Managers only?", "Managers and supervisors. Teachers and families don't see it in the list."],
      ["Where are files kept?", "Privately, on the student's record. A link to open one works for only a few minutes."],
      ["Why can't I see a student's Files tab?", "You need access to the student. Teachers see only students in their own classes."],
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
    intro: "A portfolio gathers a student's marked work, one folder per term. It's the record of what was marked and what was taken in the Testing Room.",
    sections: [
      {
        title: "Open a student's portfolio",
        steps: [
          ["Open the student and select the <strong>Portfolio</strong> tab.", "student-page-portfolio.webp", "A term's portfolio: totals, documented tests, then each subject."],
          "Choose a term at the top. The current term is marked <em>Now</em>.",
          "Read the four totals: <strong>Marked work</strong>, <strong>Average</strong>, <strong>Documented</strong> and <strong>Report card</strong>.",
          "Select a subject to open its list of work and marks.",
        ],
      },
      {
        title: "Documented and undocumented",
        table: [
          ["Label", "Means", "You can"],
          ["<strong>Documented</strong>", "Taken in the Testing Room.", "<strong>Open with answers</strong> or <strong>Download PDF</strong>."],
          ["<strong>Undocumented</strong>", "The teacher entered the mark.", "See the mark."],
        ],
        note: "<em>Waiting for approval</em> means the teacher hasn't approved the mark yet. Only staff see it that way.",
      },
      {
        title: "What families see",
        steps: [
          ["Parents open their child's page and select <strong>Portfolio</strong>. Students select <strong>Portfolio</strong> on their dashboard."],
        ],
        list: [
          "Files the school shared with the family come first.",
          "Marks show once the teacher posts them.",
          "A documented test opens in full only when the teacher shares it.",
          "To hide the portfolio from a class, turn off <strong>Portfolio</strong> in <a href=\"/legal/user-documentation/class-settings\">Class settings</a>.",
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
    summary: "One place to open online admission, set the application fee, and choose the fields on student forms and on parents' records.",
    tags: ["admission settings", "online admission", "student fields", "custom fields", "contact template", "parents and guardians fields", "application fee", "programs and indicators", "IEP", "504", "required fields"],
    featured: true,
    who: "Managers, and staff given the <strong>Admission settings</strong> or <strong>Edit Contact Template</strong> permission. Each tab follows its own permission.",
    intro: "Admission Settings has three tabs. The basic fields every school needs are always asked and can't be removed. You add your own beneath them, and they appear wherever students or parents are added or edited.",
    sections: [
      {
        title: "Open Admission Settings",
        steps: [
          ["Go to <strong>Admissions</strong> and select <strong>Admission settings</strong>."],
          ["Choose a tab: <strong>Online admission</strong>, <strong>Student fields</strong> or <strong>Parents &amp; guardians</strong>."],
        ],
        image: "admission-settings.webp",
        caption: "Admissions, Admission Settings.",
        note: "<strong>Online admission</strong> shows only where your plan includes the school website. You see only the tabs your permissions allow.",
      },
      {
        title: "Online admission",
        steps: [
          ["Turn on <strong>Accept applications online</strong>. The line above it says <em>Open</em> or <em>Closed</em>."],
          ["Set <strong>Opens on</strong> and <strong>Closes on</strong>, choose the <strong>Currency</strong> and enter an <strong>Application fee</strong>. Leave the fee empty for a free application."],
          ["Select <strong>Save online admission</strong>."],
          ["Select <strong>Preview the application form</strong> to see exactly what families see.", "admission-online-preview.webp", "The preview link sits at the top right of the card."],
        ],
        note: "Applications arrive in <strong>Admissions › Online applications</strong>. See <a href=\"/legal/user-documentation/online-admission\">Online admission</a>. Families pay the fee by card to your school's own account.",
      },
      {
        title: "Student fields",
        steps: [
          ["Open <strong>Student fields</strong>. <strong>Always asked</strong> lists the basic fields. Select <strong>Show</strong> to see them.", "admission-fields.webp", "Student fields: your own fields are grouped by where they appear on the form."],
          ["Select <strong>Add field</strong>. Name it, then choose the type: <strong>Short text</strong>, <strong>Paragraph</strong>, <strong>Number</strong>, <strong>Date</strong>, <strong>Choice list</strong> or <strong>Yes / No</strong>."],
          "Under <strong>Show under</strong>, choose the part of the form: <strong>Student Information</strong>, <strong>More Details</strong>, <strong>Programs &amp; Indicators</strong> or <strong>Academic Placement</strong>.",
          "Under <strong>Ask on</strong>, check <strong>Add student</strong> and <strong>Online application</strong> (only where you have the website). Choose <strong>Half</strong> or <strong>Full</strong> width, check <strong>Required</strong> if every student needs an answer, and add <strong>Help</strong> text if you want a small ? beside it.",
          ["The filter above the list, <strong>All</strong>, <strong>Add student</strong> and <strong>Online application</strong>, shows the fields of one form."],
          ["The <strong>⋯</strong> menu on a field has <strong>Edit</strong>, <strong>Obsolete</strong> (hides it from forms and keeps old answers, then <strong>Restore</strong> brings it back) and <strong>Delete</strong> (only for a field nobody has answered)."],
          "Drag fields to change their order. Changes appear on the forms straight away.",
        ],
        example: "A school adds <em>Allergies</em> (short text) and <em>Home language</em> (choice list: English, Spanish, Vietnamese, Other) to both forms, and <em>Photo release signed</em> (Yes / No) to Add Student only.",
        note: "A field's type can't change once someone has answered it. Make it obsolete and add a new one instead. The field name can't match one of the basic fields.",
      },
      {
        title: "Programs & Indicators",
        text: "These are staff-only fields for programs such as IEP, Section 504 plan, English learner, Gifted &amp; talented, Meal eligibility, Military family, Homeless (McKinney-Vento), Foster care and Migrant. Select <strong>Standard indicators</strong> under <strong>Programs &amp; Indicators</strong> to add the ones you don't have yet. They show on Add Student and Edit student, not on the online application, and families don't see them.",
      },
      {
        title: "Require a file for each new student",
        steps: [
          ["On the <strong>Student fields</strong> tab, turn on <strong>Require a file for each new student</strong>."],
        ],
        note: "See <a href=\"/legal/user-documentation/student-files\">Student files</a>.",
      },
      {
        title: "Parents & guardians",
        steps: [
          ["Open <strong>Parents &amp; guardians</strong>. <strong>Always asked</strong> lists first name and last name (both required), phone, email, address, hometown and date of birth.", "family-sections.webp", "Sections and fields kept on each parent's record."],
          "Select <strong>Add section</strong> to make a section, for example <em>Emergency contact</em> or <em>Allowed to pick up</em>, and <strong>Add field</strong> to put fields in it. Fields work like student fields, and you can drag them between sections.",
          ["Under each section, <strong>Shared with</strong> chooses who else sees it: <strong>Parents</strong>, <strong>Students</strong>, <strong>Teachers</strong> and <strong>Drivers</strong>. A checked chip is on."],
        ],
        note: "See <a href=\"/legal/user-documentation/emergency-and-pickup-details\">Emergency &amp; pickup details</a> for what each choice does.",
      },
    ],
    faq: [
      ["What happened to Contact Template?", "It's the <strong>Parents &amp; guardians</strong> tab of Admission Settings now, so everything about what you collect is in one place. Old links take you there."],
      ["Can I remove a basic field like the student's name?", "No. The basics every school needs are always asked. Add your own fields beneath them."],
      ["Do new fields apply to existing students?", "Yes. They appear empty on existing students, ready to fill in."],
      ["Why don't I see the Online admission tab?", "It needs the school website on your plan and the <strong>Admission settings</strong> permission."],
    ],
    related: ["online-admission", "pending-admissions-review-and-approval", "emergency-and-pickup-details", "create-and-add-student", "student-files"],
  },
  {
    slug: "online-admission",
    title: "Online admission from your school website",
    topic: "Students & admissions",
    order: 5,
    summary: "Families apply on your school website and pay an application fee if you set one. You review every application before it becomes a student.",
    tags: ["online admission", "online application", "enrollment application", "application fee", "school website", "apply online", "apply now"],
    who: "Families apply, from a computer or a phone. Managers and staff given <strong>Admission settings</strong> turn it on. Staff with <strong>Approve Admissions</strong> review applications.",
    intro: "Online admission lets families apply from home. Nothing becomes a student record until your school approves it.",
    sections: [
      {
        title: "Turn it on",
        text: "Open <strong>Admissions › Admission settings › Online admission</strong>, turn on <strong>Accept applications online</strong>, set the dates and fee, and save. Your website shows <strong>Apply Now</strong> while applications are open. See <a href=\"/legal/user-documentation/admission-settings\">Admission Settings</a>.",
        image: "admission-settings.webp",
        caption: "Admission Settings, Online admission.",
      },
      {
        title: "What a family does on a computer",
        steps: [
          ["The family selects <strong>Apply Now</strong> on your school website. The first page tells them how it works: complete the form, pay the application fee, then confirmation. It shows the fee and what to have ready."],
          ["They select <strong>Start Application</strong>.", "oa-start-zoom.webp", "Start Application."],
          ["They answer <em>Do you already have a child enrolled in this school?</em> <strong>Yes</strong> finds their profile. <strong>No</strong> starts fresh."],
          ["Under <strong>Student Information</strong> they enter first and last name, date of birth, gender, hometown, an optional student email, the class they want and a photo. Your own fields marked for the online application show here too."],
          ["Under <strong>Guardian Details</strong> they enter the parent's name, phone, email and hometown, and an optional photo. <strong>+ Add Another Guardian</strong> adds more."],
          ["With no fee, <strong>Submit Application</strong> asks <em>Ready to submit your application?</em> and then shows <strong>Application Submitted!</strong>. With a fee, the button reads <strong>Continue to Payment</strong> and takes them to a card payment before the application is sent."],
        ],
      },
      {
        title: "What a family sees on a phone",
        steps: [
          ["The welcome page lists the three steps and the fee.", "oa-phone-welcome.webp", "The welcome page on a phone."],
          ["The form shows one field at a time down the screen, with a progress bar of three steps: <strong>Guardian</strong>, <strong>Student Info</strong> and <strong>Payment</strong> or <strong>Submit</strong>."],
        ],
      },
      {
        title: "After they apply",
        text: "The application appears under <strong>Admissions › Online applications</strong>. See <a href=\"/legal/user-documentation/pending-admissions-review-and-approval\">Review and approve online applications</a>.",
      },
    ],
    faq: [
      ["Can families save and come back later?", "No. An application is sent in one go, so families should have the student's photo and the parent's details ready before they start."],
      ["Is the application fee refundable?", "The page tells families the fee is non-refundable. It's paid by card into your school's own account."],
      ["Why does the page say applications are closed?", "Today's date is outside <strong>Opens on</strong> and <strong>Closes on</strong>, or <strong>Accept applications online</strong> is off. Staff can still preview the form."],
      ["Does a family need an account?", "No. They don't sign in to apply."],
    ],
    related: ["admission-settings", "pending-admissions-review-and-approval", "school-website"],
  },
  {
    slug: "pending-admissions-review-and-approval",
    title: "Review and approve online applications",
    topic: "Students & admissions",
    order: 6,
    summary: "Check each online application, place the student in a class and term, then approve it to create the student, or reject it.",
    tags: ["online applications", "pending admissions", "approve application", "reject application", "review applications", "reverse decision"],
    who: "Managers, and staff given the <strong>Approve Admissions</strong> permission.",
    intro: "Every application a family sends waits here. Nothing becomes a student until you approve it.",
    sections: [
      {
        title: "Find the applications",
        steps: [
          ["Go to <strong>Admissions</strong> and select <strong>Online applications</strong>."],
          ["The tabs are <strong>Pending</strong>, <strong>Rejected</strong> and <strong>All</strong>, each with a count. Search by name, or filter by gender or class.", "applications-list.webp", "Pending applications for the school."],
        ],
        note: "A teacher or supervisor without the permission doesn't see this page.",
      },
      {
        title: "Review one application",
        steps: [
          ["Select <strong>Review</strong> on a row."],
          ["The panel shows the student, <strong>Placement</strong>, <strong>Subjects</strong>, any <strong>More details</strong> and the <strong>Parents &amp; guardians</strong>. Every field can be corrected.", "applications-review.webp", "An application open for review."],
          "Under <strong>Placement</strong>, check the <strong>Class</strong> and <strong>Year group</strong>. Choose <strong>This term</strong>, or <strong>A later term</strong> and pick the school year and term.",
          "Check the student's <strong>Subjects</strong>, or select <strong>Select all</strong>.",
          "Check the parents. <strong>Add parent</strong> adds another, and the <strong>×</strong> beside one removes them.",
        ],
      },
      {
        title: "Approve, save or reject",
        steps: [
          ["<strong>Approve</strong> adds the student and notifies the parents. A box asks you to confirm.", "applications-approve-confirm.webp", "Approve asks first."],
          "<strong>Save</strong> keeps your changes and leaves the application pending, so you can finish later.",
          ["<strong>Reject</strong> moves the application to <strong>Rejected</strong>. A box asks you to confirm."],
        ],
        note: "Approving gives the student the next student ID and links their parents.",
      },
      {
        title: "Reverse a rejection",
        steps: [
          ["Open the <strong>Rejected</strong> tab and select <strong>Reverse decision</strong> beside the application. It goes back to <strong>Pending</strong>."],
        ],
        note: "Rejected applications are kept for 60 days, then deleted for good.",
      },
    ],
    faq: [
      ["Does the family get a message?", "Yes. Approving and rejecting both notify the parents, by email. A rejection also shows in the app for parents who have a portal account."],
      ["Can I change the class before approving?", "Yes. Change <strong>Placement</strong> in the panel before you select Approve."],
      ["Where did Delete go?", "Applications aren't deleted by hand now. Reject moves one to Rejected, and it is removed after 60 days."],
    ],
    related: ["online-admission", "admission-settings", "create-and-add-student"],
  },
  {
    slug: "transfer-a-student-between-classes-and-subject-matching",
    title: "Transfer a student to another class",
    topic: "Students & admissions",
    order: 7,
    summary: "Move a student, or several, to another class. Their history stays and earlier terms keep the class they were in.",
    tags: ["transfer student", "change class", "move student", "subjects", "mid-year transfer", "bulk edit class"],
    who: "Managers, and staff given the <strong>Edit Students</strong> permission.",
    intro: "A class change applies to the current term. Terms that are over keep the class the student was in, so report cards and transcripts stay true.",
    sections: [
      {
        title: "Move one student",
        steps: [
          ["Go to <strong>Admissions › All students</strong> and find the student. Select the pencil (<strong>Edit</strong>) on their row."],
          ["Choose the new <strong>Class</strong>. You can also change the <strong>School year</strong> or <strong>Email</strong>."],
          "Select <strong>Review</strong>, check the change, and confirm.",
        ],
        image: "transfer-edit-window.webp",
        caption: "The Edit student window in All Students.",
        tip: "You can also change the class under <strong>Personal information</strong> on <a href=\"/legal/user-documentation/edit-student-information\">Edit student</a>.",
      },
      {
        title: "Move several students",
        steps: [
          "Check the students in <a href=\"/legal/user-documentation/find-students\">All Students</a>, select <strong>Edit Selected</strong>, check <strong>Class</strong>, choose the class, then <strong>Review</strong> and confirm.",
        ],
      },
      {
        title: "Check afterward",
        list: [
          "Open the student's <strong>Edit student</strong> page and look at <strong>Subjects</strong>. Check any subject the new class has that they should take.",
          "Attendance, grades, parents and transcript history are kept.",
          "A student who already has attendance, scores or a report card in a term stays in that term.",
        ],
        tip: "For a move partway through a term, look at the student's report card afterward so later marks go to the right class and subject.",
      },
    ],
    faq: [
      ["Do last term's grades move with the student?", "No. Earlier terms keep the class they were earned in."],
      ["Can a student be in two classes?", "A student has one class at a time. Choose the class they should be in now."],
    ],
    related: ["enrolling-classes-and-student-in-aterm-semester", "edit-student-information", "find-students"],
  },
  {
    slug: "promote-students-and-manage-graduation",
    title: "Promote students and manage graduation",
    topic: "Students & admissions",
    order: 8,
    summary: "Decide who moves up, plan a promotion into the next year or term, then graduate or withdraw students and find them again in Former Students.",
    tags: ["promotion", "end of year", "graduation", "repeat a grade", "withdraw student", "alumni", "graduates", "transferred", "restore student", "former students"],
    who: "Managers, and staff given the <strong>Promotion</strong> and <strong>School years &amp; terms</strong> permissions. Graduate &amp; Withdraw needs <strong>School years &amp; terms</strong>.",
    intro: "Promotion moves students into their next class for a new school year or term, using the decision saved on each student's report. Students who finish your highest grade graduate, and students who leave are recorded as former students. Their records always stay.",
    sections: [
      {
        title: "1. Decide who moves up",
        text: "On each class's term report, every student has a decision: <strong>Promoted To</strong> a class, or <strong>Repeated In</strong> a class. Save it with the report. See <a href=\"/legal/user-documentation/report-card\">Report cards</a>.",
        tip: "The promotion page's <strong>Before you start</strong> explains this and links to the report and promotion settings.",
      },
      {
        title: "2. Plan the promotion",
        steps: [
          ["Go to <strong>Management › Promotion</strong>."],
          ["<strong>Suggested</strong> lists the promotion Managira thinks you want next, such as <em>Fall Semester → Spring Semester</em>, with how many students can move. Select <strong>Plan this</strong> to fill the form in, or select <strong>Plan a promotion</strong> to choose for yourself.", "promotion-page.webp", "Promotion: history of every promotion, and Plan a promotion at the top right."],
          ["Choose <strong>Promoting From School Year</strong> and <strong>Promoting From Term</strong>, then the <strong>Target School Year</strong> and <strong>Target Term</strong>.", "promotion-plan.webp", "Plan Promotion."],
          "Under <strong>When should this happen?</strong> choose <strong>Schedule Promotion</strong> and a date (it starts on the target term's first day), or <strong>Apply Now</strong>.",
          "Choose the classes under <strong>Classes to Apply Promotion</strong>, or check <strong>Select All Classes</strong>. <strong>Saved Student Decisions</strong> lists each student, their class, the decision and where they go.",
          "Select <strong>Schedule Promotion</strong> (or <strong>Apply Now</strong>). A scheduled promotion runs by itself on its date.",
        ],
        note: "Promotion runs from the current school year to the current or a later one. Promotion settings you saved for a class carry into the next term.",
      },
      {
        title: "3. Check, apply or reverse",
        list: [
          "<strong>Promotion History</strong> lists every promotion with its status. <strong>What this promotion did</strong> shows the enrollments, classes, students and subjects it added.",
          "<strong>Apply Now</strong> runs a scheduled promotion straight away. <strong>Cancel</strong> stops it.",
          "<strong>Reverse</strong> undoes a finished one: the enrollments, classes and subjects it created are removed, and students are back in their previous classes. Check any work done in the new classes since.",
        ],
      },
      {
        title: "Graduate and withdraw students",
        steps: [
          ["Go to <strong>Admissions › Former students › Graduate &amp; Withdraw</strong>."],
          ["Students are grouped by graduation year, or by class when they have no group. The first group opens at once. Select another group's heading to load it."],
          ["Use <strong>Search students by name or ID</strong> to find someone in any group."],
          ["Check the students. The bar at the bottom counts them. <strong>Clear</strong> unchecks everyone. Checked students stay checked as you move between pages."],
          ["Select <strong>Archive</strong>. Choose <strong>Graduated</strong> (they finished at the school) or <strong>Transferred or withdrawn</strong> (they left before graduating). For the second, choose a <strong>Reason for leaving</strong>. Add a <strong>Note</strong> if you like.", "former-archive-dialog-zoom.webp", "Why are they leaving the active register?"],
          "Check <strong>I confirm and understand</strong> and select the button at the bottom of the box.",
        ],
        list: [
          "They leave classes, attendance, fees and the bus list. Grades and history are kept.",
          "You can undo it within 24 hours. A student who left can be restored after the billing hold ends (30 days).",
          "Billing still includes them for those 30 days.",
        ],
      },
      {
        title: "Find and restore former students",
        steps: [
          ["Go to <strong>Admissions › Former students › Graduates &amp; alumni</strong>. The tabs are <strong>Graduates</strong> and <strong>Transferred &amp; withdrawn</strong>, each with a count. Search by name.", "former-alumni.webp", "Graduates & Alumni: last class, date, and when undo is available."],
          ["Check a student and select <strong>Restore</strong> to put them back on the active register. A student who can't be restored yet has a disabled box."],
        ],
        note: "Transcripts for graduates are still available. See <a href=\"/legal/user-documentation/transcript\">Transcripts</a>.",
      },
    ],
    faq: [
      ["Do grades move with students?", "Grades stay with the term and class they were earned in, and appear on the student's history and transcript."],
      ["Can graduates still get a transcript?", "Yes. See <a href=\"/legal/user-documentation/transcript\">Transcripts</a>."],
      ["I archived a student by mistake.", "Undo is available for 24 hours. Open <strong>Graduates &amp; alumni</strong>, check them and select <strong>Restore</strong>."],
      ["Why is Restore grayed out?", "A student who left can be restored only after the 30-day billing hold. Until then, a recently archived student shows <em>Undo available until</em> with a time, and can be undone before it."],
    ],
    related: ["create-school-years-terms-and-set-the-current-term", "transcript", "find-students", "report-card"],
  },
];
