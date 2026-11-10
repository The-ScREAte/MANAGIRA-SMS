"use strict";

// School setup: the school's details, school years and terms, classes and subjects, enrollment, student IDs.
module.exports = [
  {
    slug: "customize-your-school",
    title: "Customize your school: logo, details, colors and calendar",
    topic: "School setup",
    order: 1,
    summary: "Add your logo, contact details, web address, brand color, font, name and date formats, school calendar and student ID format in Settings, Customize School.",
    tags: ["customize school", "logo", "brand color", "school details", "web address", "school calendar"],
    who: "Managers, and staff given the <strong>Profile</strong> settings permission.",
    intro: "Your school's name, logo and color appear on every page, report card, email and on your public website. Set them once in <strong>Customize School</strong>.",
    sections: [
      {
        title: "Open Customize School",
        steps: [
          ["Open the menu (☰), choose <strong>Settings</strong>, then <strong>Customize School</strong>.", "customize-school.webp", "Settings, Customize School: logo, details, web address, color, font, formats, calendar and student IDs."],
          "Work down the sections and save each one.",
        ],
      },
      {
        title: "What you can set",
        table: [
          ["Section", "What it controls"],
          ["<strong>Logo</strong>", "Shown in the header, on report cards, transcripts, receipts and your website. A square PNG with a clear background looks best."],
          ["<strong>School details</strong>", "Name, motto, address, phone and email, used on documents and your website's contact section."],
          ["<strong>Short name and web address</strong>", "Your nickname and public address, for example <code>riverside.managira.com</code>."],
          ["<strong>Brand color</strong> and <strong>Font</strong>", "The color and typeface of your school's pages, emails and website."],
          ["<strong>Names and dates</strong>", "How names (first name first, or last name first) and dates (for example 11/09/2026) are shown everywhere."],
          ["<strong>School calendar</strong>", "School days, holidays and closures, used by attendance and the calendar."],
          ["<strong>Student IDs</strong>", "Automatic student numbers with your own prefix. See <a href=\"/legal/user-documentation/configure-custom-student-ids\">Student IDs</a>."],
        ],
        tip: "Change the brand color and look at a report card preview before printing a whole class, so the color reads well on paper.",
      },
    ],
    faq: [
      ["Will changing the web address break old links?", "Links with the old address stop working, so update any links you've shared, such as on social media or in emails."],
      ["Who sees the motto?", "It appears on your public website and on documents where your school's details are printed."],
    ],
    related: ["register-a-school-and-complete-first-time-setup", "school-website", "configure-custom-student-ids"],
  },
  {
    slug: "create-school-years-terms-and-set-the-current-term",
    title: "Create school years and terms, and set the current term",
    topic: "School setup",
    order: 2,
    summary: "Add a school year with its terms or semesters, set the current term, and switch to the next term when one ends.",
    tags: ["school year", "term", "semester", "current term", "academic calendar", "trimester"],
    featured: true,
    who: "Managers, and staff given the <strong>School years &amp; terms</strong> permission.",
    intro: "Attendance, assessments, report cards and promotion all belong to a school year and a term. Create your year first, then mark the term you're in as <strong>Current</strong>: it decides what staff see by default.",
    sections: [
      {
        title: "Create a school year",
        steps: [
          ["Open <strong>Management</strong>, then <strong>School years</strong>, and select <strong>New school year</strong>.", "school-years.webp", "Management, School years: the current year and term are marked with a dot."],
          "Enter the <strong>School Year Label</strong> (for example <em>2026 - 2027</em>) with its start and end dates.",
          "Add each term or semester with its <strong>Term Name</strong>, <strong>Start Date</strong> and <strong>End Date</strong>. Terms can't overlap.",
          "Select <strong>Register School Year</strong>.",
        ],
        example: "A middle school uses two semesters: <em>Fall Semester</em> (August 17 to December 18) and <em>Spring Semester</em> (January 5 to May 28).",
      },
      {
        title: "Set the current term",
        steps: [
          "In the school year, choose <strong>Current</strong> beside the term you're in now.",
          "Save. Attendance, grades and reports now open on that term for everyone.",
        ],
        warning: "Only one term is current at a time. If staff see a warning naming a different term while they work, a manager should check the current term here.",
      },
      {
        title: "When a term ends",
        text: "When a term's end date passes, your dashboard suggests the next term. Select it to make it current. To carry classes and students into the new term, use <strong>Enroll Classes and Students</strong>, or promote them at the end of the year. See <a href=\"/legal/user-documentation/promote-students-and-manage-graduation\">Promotion and graduation</a>.",
      },
    ],
    faq: [
      ["Can we name terms our own way?", "Yes. Use Term names to set the names your school uses, such as Quarter 1, Trimester 2 or Fall Semester."],
      ["What happens to last year's data?", "It stays. Completed school years are listed at the bottom of the page, and their report cards and transcripts remain available."],
    ],
    related: ["setting-up-classes-subjects-graduation-year-group", "enrolling-classes-and-student-in-aterm-semester", "promote-students-and-manage-graduation"],
  },
  {
    slug: "setting-up-classes-subjects-graduation-year-group",
    title: "Set up classes, subjects and graduation year groups",
    topic: "School setup",
    order: 3,
    summary: "Create your classes (grades or homerooms), add subjects and assign them to classes, and group students by the year they graduate.",
    tags: ["classes", "subjects", "graduation year", "grade levels", "homeroom", "courses"],
    who: "Managers, and staff given the <strong>Classes &amp; subjects</strong> permission.",
    intro: "Classes are your grade levels or homerooms (for example <em>7th Grade</em> or <em>3B</em>). Subjects are what's taught in them. A graduation year group (for example <em>Class of 2030</em>) follows a group of students from year to year.",
    sections: [
      {
        title: "Add classes",
        steps: [
          ["Open <strong>Management</strong>, then <strong>Classes, Subjects &amp; Grad Years</strong>.", "classes-subjects.webp", "Classes, Subjects & Grad Years: classes, subjects and graduation groups in one place."],
          "Add your classes. You can add several at once.",
          "Save. New classes appear once they're enrolled in a term (see <a href=\"/legal/user-documentation/enrolling-classes-and-student-in-aterm-semester\">Enrollment</a>).",
        ],
      },
      {
        title: "Add subjects and assign them",
        steps: [
          "Add each subject once (for example <em>English Language Arts</em>, <em>Science</em>, <em>Spanish</em>).",
          "Tick the classes that take it and select <strong>Assign to Selected Classes</strong>. One subject can belong to many classes.",
        ],
        tip: "Use the same subject names in every class. Report Builder and analytics then compare like with like across grades.",
      },
      {
        title: "Graduation year groups",
        text: "Create a group for each graduating class (for example <em>Class of 2030</em>) and add students to it. Groups make promotion and graduation a few clicks each year.",
      },
      {
        title: "Arrange classes on the dashboard",
        text: "<strong>Dashboard Class Arrangement</strong> sets the order classes appear in on the dashboard, from youngest to oldest or however your school prefers. Select <strong>Save Dashboard Layout</strong>.",
      },
    ],
    faq: [
      ["Can I rename a class?", "Yes, at any time. Students, grades and reports keep their records under the new name."],
      ["What if a class is no longer used?", "Remove it from the current term's enrollment. Its past records stay in earlier terms."],
    ],
    related: ["enrolling-classes-and-student-in-aterm-semester", "create-school-years-terms-and-set-the-current-term", "create-and-add-student"],
  },
  {
    slug: "enrolling-classes-and-student-in-aterm-semester",
    title: "Enroll classes and students in a term",
    topic: "School setup",
    order: 4,
    summary: "Put your classes, and the students in them, into the current school year and term, and move a student to another class.",
    tags: ["enrollment", "enroll classes", "term enrollment", "move student", "class roster"],
    who: "Managers, and staff given the <strong>Enrollment</strong> permission.",
    intro: "A class shows on dashboards, attendance and grade books only once it's enrolled in a term. Students added to a class that's already enrolled are enrolled automatically, so you mostly do this when you create a class or start a new year.",
    sections: [
      {
        title: "Enroll classes",
        steps: [
          ["Open <strong>Management</strong>, then <strong>Enrollment</strong>. Each term shows its classes and students; select a term to see or edit it.", "enrollment.webp", "Management, Enrollment: the classes and students in each term."],
          ["Select <strong>Enroll students</strong>. Choose the <strong>Term</strong>, then the <strong>Classes</strong> (or <strong>All classes</strong>).", "enrollment-enroll.webp", "Enroll students: the term, its classes, then their students."],
          "Each class's students are ticked. Untick anyone who shouldn't be enrolled.",
          "Select <strong>Enroll</strong>. The classes now appear on dashboards, attendance and grade books for that term.",
        ],
        note: "A term has one enrollment. If it already has one, select <strong>Edit it instead</strong>. From School years, <strong>Enroll Classes and Students</strong> brings the current classes into a new term in one step.",
      },
      {
        title: "Move a student to another class",
        steps: [
          "In <strong>Enrollment</strong>, select the term. Under the class the student should join, use <strong>Add a student from another class</strong>.",
          "Managira shows who is in another class this term. Select <strong>Move them</strong>.",
          "Select <strong>Save changes</strong>. The student moves and stays enrolled.",
        ],
        tip: "To move a student and match their subjects to the new class, see <a href=\"/legal/user-documentation/transfer-a-student-between-classes-and-subject-matching\">Transfer a student</a>.",
      },
    ],
    faq: [
      ["Do I have to enroll every term?", "Promotion carries classes and students into the next school year for you. Within a year, enroll classes into each new term from School years."],
      ["Why isn't a class on the dashboard?", "It isn't enrolled in the current term yet, or the term you're looking at isn't the current one."],
    ],
    related: ["create-school-years-terms-and-set-the-current-term", "transfer-a-student-between-classes-and-subject-matching", "promote-students-and-manage-graduation"],
  },
  {
    slug: "configure-custom-student-ids",
    title: "Set up student ID numbers",
    topic: "School setup",
    order: 5,
    summary: "Let Managira number new students automatically with your own prefix and starting number, or type IDs yourself. Duplicate IDs are never allowed.",
    tags: ["student id", "student number", "id format", "auto-generate", "prefix"],
    who: "Managers, and staff given the <strong>Profile</strong> settings permission.",
    sections: [
      {
        title: "Choose your format",
        steps: [
          ["Open <strong>Settings</strong>, then <strong>Customize School</strong>, and go to <strong>Student IDs</strong>.", "student-ids.webp", "Customize School, Student IDs: a prefix, a starting number and a preview."],
          "Turn on automatic IDs, enter a <strong>prefix</strong> (for example <code>RA-</code>) and the <strong>starting number</strong>.",
          "Check the preview (for example <code>RA-00421</code>) and save.",
        ],
      },
      {
        title: "How numbering works",
        list: [
          "Each new student gets the next number when they're added or their application is approved.",
          "Staff can still type an ID by hand. An ID already used in your school is refused.",
          "Changing the format affects new students only; existing IDs stay as they are.",
        ],
      },
    ],
    faq: [
      ["Can we use our state student ID?", "Yes. Turn automatic IDs off and type each student's state ID when you add them, or include it in your import spreadsheet."],
    ],
    related: ["create-and-add-student", "customize-your-school"],
  },
];
