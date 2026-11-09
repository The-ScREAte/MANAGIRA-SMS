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
    related: ["create-and-add-student", "edit-student-information", "report-builder"],
  },
  {
    slug: "edit-student-information",
    title: "Edit a student's information",
    topic: "Students & admissions",
    order: 3,
    summary: "Open a student from search or their class to update their details, photo, class, parents and the extra fields your school collects.",
    tags: ["edit student", "student profile", "student details", "update student"],
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
          "Select <strong>Save</strong>.",
        ],
      },
    ],
    faq: [
      ["Who sees what I change?", "Staff with access to the student, and the student's parents for the parts they can see in the parent portal."],
      ["Can parents correct details themselves?", "Parents can update the emergency and pickup sections your school shares with them. See <a href=\"/legal/user-documentation/emergency-and-pickup-details\">Emergency &amp; pickup details</a>."],
    ],
    related: ["find-students", "transfer-a-student-between-classes-and-subject-matching", "create-manage-parent"],
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
    summary: "Move students up a grade at the end of the year, keep some back, graduate your final year and record students who leave, with every step reversible.",
    tags: ["promotion", "end of year", "graduation", "repeat a grade", "withdraw student", "alumni"],
    who: "Managers, and staff given the <strong>Promotion</strong> and <strong>School years &amp; terms</strong> permissions.",
    intro: "At the end of the year, promotion moves each class's students into the next class for the new school year. Students who finish your highest grade graduate, and students who leave are recorded as former students. Their records always stay.",
    sections: [
      {
        title: "Set promotion rules",
        steps: [
          ["Open <strong>Management</strong>, then <strong>Promotion</strong>.", "promotion.webp", "Management, Promotion: rules, students to promote, and history."],
          "For each class, choose the class its students move into, and any minimum average for promotion.",
          "Save the rules.",
        ],
      },
      {
        title: "Promote",
        steps: [
          "Review the list of students and untick anyone who should repeat the year.",
          "Select <strong>Apply Now</strong> and confirm. Students move into their new classes for the new school year.",
        ],
        note: "Made a mistake? Open the promotion history and reverse it. Students go back to their previous classes; check any work done in the new classes since.",
      },
      {
        title: "Graduate and withdraw",
        steps: [
          "Open <strong>Admissions</strong>, <strong>Graduate &amp; Former Students</strong>, then <strong>Graduate &amp; Withdraw</strong>.",
          "Graduate your final-year students, or withdraw students who are leaving.",
          "They move to <strong>Graduates &amp; Alumni</strong>, with their records and transcripts kept.",
        ],
      },
    ],
    faq: [
      ["Do grades move with students?", "Grades stay with the term and class they were earned in, and appear on the student's history and transcript."],
      ["Can graduates still get a transcript?", "Yes. See <a href=\"/legal/user-documentation/transcript\">Transcripts</a>."],
    ],
    related: ["create-school-years-terms-and-set-the-current-term", "transcript", "find-students"],
  },
  {
    slug: "student-portal",
    title: "The student portal",
    topic: "Students & admissions",
    order: 9,
    summary: "Students sign in to see their classes, teachers, schedule, grades, activities, calendar and bus, and to take online tests in the Testing Room.",
    tags: ["student portal", "student login", "testing room", "online tests", "student invite", "student calendar"],
    who: "Students, once your school turns on <strong>Student Portal</strong> in Integrations and invites them.",
    sections: [
      {
        title: "Give students access",
        steps: [
          "Turn on <strong>Student Portal</strong> in <strong>Management</strong>, <strong>Integrations</strong>.",
          "Make sure each student has an email address.",
          "Send invites: tick students in <strong>Admissions</strong>, <strong>All Students</strong> and choose <strong>Send Password Invite</strong>, or send one from a student's page in their class.",
          "Students open the email, choose a password and sign in.",
        ],
      },
      {
        title: "What students see",
        image: "student-portal.webp",
        caption: "The student portal on a phone: classes, schedule, grades and what's coming up.",
        list: [
          "Their classes, teachers, schedule and grades.",
          "<strong>Activities</strong> and their <strong>Calendar</strong>, including activities just for them.",
          "The <strong>Testing Room</strong>, where they take online assessments their teachers open.",
          "Who's picking them up, and their bus, if your school shares them.",
          "<strong>Settings</strong>, where they choose Light, Classic or Dark.",
        ],
      },
    ],
    faq: [
      ["A student didn't get the invite.", "Check their email in Admissions, All Students (Edit Student Emails), then send the invite again. Ask them to check spam."],
      ["Can students see other students' grades?", "No. Students only ever see their own information."],
    ],
    related: ["assessment-questions-and-online-tests", "activities", "find-students"],
  },
];
