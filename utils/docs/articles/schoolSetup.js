"use strict";

// School setup: signing a school up, first-time setup, the school's details, school years and terms,
// classes and subjects, enrollment, student IDs. Pictures are taken on the local test copy.
const link = (slug, text) => `<a href="/legal/user-documentation/${slug}">${text}</a>`;

module.exports = [
  {
    slug: "register-a-school-and-complete-first-time-setup",
    title: "Set up your school in Managira",
    topic: "Getting started",
    order: 1,
    summary: "Create your school's account, answer the First-time setup questions, then follow the Setup steps list: classes, students, staff and families.",
    tags: ["getting started", "sign up", "register a school", "create account", "first-time setup", "first time setup", "setup steps", "first steps", "onboarding", "school color", "logo", "get started", "free trial"],
    featured: true,
    who: "The person who signs the school up. They become its first manager and its owner account.",
    intro: "Getting a school ready takes an afternoon. You create the school's account once. The first time you sign in, a short First-time setup asks for your colors, logo and school year. Then the <strong>Setup steps</strong> list shows what is left, in a sensible order.",
    sections: [
      {
        title: "Create your school's account",
        steps: [
          "Go to <a href=\"https://managira.com\" target=\"_blank\">managira.com</a> and select <strong>Get started</strong>. Choose a plan and how often to pay. Every plan starts with a free trial, and the plan decides which features your school has. You can change it later in <strong>Settings</strong>, <strong>Billing &amp; plan</strong>.",
          ["Under <strong>1 About you</strong>, enter your <strong>First name</strong> and <strong>Last name</strong>.", "setup-register.webp", "Create your school's account."],
          ["Under <strong>2 Your school</strong>, enter the <strong>School name</strong> and a <strong>Short name</strong>. The short name becomes your web address, shown under it (for example <code>your-school.managira.com</code>). Then add the <strong>School address</strong>, <strong>Country</strong>, <strong>State or region</strong> and <strong>School phone</strong>."],
          ["Under <strong>3 Verify your school</strong>, choose a <strong>Proof of registration</strong>: a document that shows your school is registered, such as a state registration, an accreditation letter or a certificate (PDF, Word or image). <strong>Another document</strong> is optional."],
          "Under <strong>4 Your sign-in</strong>, enter your <strong>Work email</strong> twice, then a <strong>Password</strong> twice. The password needs 10 or more characters, an uppercase and a lowercase letter, a number and a symbol.",
          ["Check that you agree to the Terms of Service and Privacy Policy, then select <strong>Continue to payment</strong>."],
          "On the payment page, enter your card. For a free trial the page says <em>Your card is saved for after the trial. It is not charged today.</em> Select <strong>Start free trial</strong> (or <strong>Pay and continue</strong> if there's no trial).",
          "Wait for <em>Setting up your school…</em> to finish, then check your email. You'll get a welcome message with a link to sign in.",
        ],
        tip: "Choose the short name carefully. It is your school's web address and appears on every page you share with families. It can't be changed later, although the name shown for your school can.",
      },
      {
        title: "First-time setup",
        text: "The first time you sign in, Managira opens <strong>First-time setup</strong> before your dashboard. It shows to the school's own account, and to a manager who can edit the school profile. It asks only for what your school hasn't set yet, so you may see fewer steps. A bar at the top says <em>Step 1 of 6</em>, and a preview on the right shows what your choice looks like.",
        subsections: [
          {
            title: "1. Color",
            steps: [
              ["Pick your school's color. It's used for buttons, headers and your website. Select <strong>Continue</strong>.", "setup-first-colour.webp", "Welcome! Pick your school's color."],
            ],
          },
          {
            title: "2. Logo",
            steps: [
              ["Select <strong>Choose a picture</strong>, or drop one on the box. A square picture with a clear background looks best (PNG, JPG, WebP or GIF, up to 5 MB). Select <strong>Continue</strong>."],
              ["No logo yet? Select <strong>Skip for now</strong>."],
            ],
          },
          {
            title: "3. Details",
            steps: [
              ["Fill in what's missing: <strong>School nickname</strong> (the short name shown for your school, 3 to 60 characters), <strong>Phone</strong>, <strong>State</strong> and <strong>Street address</strong>. These head report cards, transcripts and emails to families."],
            ],
          },
          {
            title: "4. School year",
            steps: [
              ["Check the <strong>School year</strong>, <strong>First day</strong> and <strong>Last day</strong>. Managira suggests the year you are in.", "setup-first-year.webp", "Set up your school year."],
              ["Under <strong>How is the year divided?</strong> choose <strong>Semesters</strong>, <strong>Trimesters</strong>, <strong>Quarters</strong> or <strong>Full year</strong>. The terms below fill in by themselves."],
              ["Under <strong>Which term are you in now?</strong> pick the current term."],
            ],
            note: "If your school already has terms but none is current, this step only asks which term is current. It appears only for managers who may change school years.",
          },
          {
            title: "5. Calendar",
            steps: [
              ["Under <strong>School days</strong>, check the days your school meets. Attendance is only taken on these days."],
              ["<strong>Public holidays are days off</strong> lists this year's holidays. Turn it off if your school meets on them."],
              ["Select <strong>+ Add a day off</strong> for breaks and teacher work days."],
            ],
          },
          {
            title: "6. Website",
            steps: [
              ["Pick the look of your school's public website. Every design shows the same content, and you can change it later.", "setup-first-website.webp", "Choose your website's look."],
            ],
            note: "This step shows only to managers who can edit the school website, and only if your plan includes it.",
          },
        ],
      },
      {
        title: "Finish",
        steps: [
          ["The last page says <strong>You're ready to go</strong> and lists what you set. Select <strong>Go to your dashboard</strong>."],
          ["Your dashboard welcomes you to the current term. Select <strong>Let's go</strong> or <strong>Thanks</strong> to close it."],
        ],
        list: [
          "Each step saves as you continue. <strong>Back</strong> returns to the one before, and a small <em>Saved</em> shows beside the step count.",
          "<strong>Color</strong> and <strong>Details</strong> are required. Everything else has <strong>Skip for now</strong>.",
          "Once you finish, First-time setup never shows again. Everything in it can be changed later in Settings and Management.",
        ],
      },
      {
        title: "Work through Setup steps",
        text: "A small <strong>Setup steps</strong> tab sits at the bottom left of the screen, with how many steps are done. Select it to open the list. Each step opens the page where it's done, and crosses itself out when it's finished. <strong>Required</strong> steps can only be crossed out by doing them. <strong>Recommended</strong> ones have <strong>Skip</strong> if your school doesn't need them.",
        image: "setup-steps.webp",
        caption: "Setup steps lists what your school still has to set up.",
        table: [
          ["Step", "Where it's done", "Guide"],
          ["Add your school's logo and contact details", "Settings › Customize school", link("customize-your-school", "Customize your school")],
          ["Create the school year and its current term", "Management › School years &amp; terms", link("create-school-years-terms-and-set-the-current-term", "School years and terms")],
          ["Add your classes, and subjects to your classes", "Management › Classes &amp; subjects", link("setting-up-classes-subjects-graduation-year-group", "Classes and subjects")],
          ["Put your classes into the current term", "Management › Enrollment", link("enrolling-classes-and-student-in-aterm-semester", "Enrollment")],
          ["Add your students", "Admissions › Add student", link("create-and-add-student", "Add a student")],
          ["Set up this term's assessments and the grading scale", "Management › Assessments; Reports › Report settings", link("create-a-test-or-assessment", "Assessments")],
          ["Invite your teachers and staff", "Management › Users / Employees", link("create-and-manage-employee-accounts-and-permissions", "Add staff")],
          ["Set the school calendar", "Settings › Customize school › School rules", link("customize-your-school", "Customize your school")],
          ["Add a signature for report cards", "Reports › Report settings", link("report-settings", "Report settings")],
          ["Invite parents and guardians", "Management › Parents &amp; guardians", link("create-manage-parent", "Parents and guardians")],
        ],
      },
      {
        title: "Recommended order",
        list: [
          "<strong>Structure first:</strong> school year and term, then classes and subjects, then enrollment. Students, attendance and grades all hang on these.",
          "<strong>People next:</strong> students, then staff (so teachers can be given their classes), then parents.",
          "<strong>Then everything else:</strong> assessments, report settings, fees, website and online admission.",
        ],
        example: "Riverside Academy creates the 2026–2027 school year with Fall and Spring semesters, sets Fall as current, adds its classes and subjects, imports 420 students, invites 32 staff, and opens online admission for next year, all in one afternoon.",
      },
    ],
    faq: [
      ["Can we import our students from a spreadsheet?", "Yes. In <strong>Admissions › Add student</strong>, select <strong>Import</strong>, download the CSV or Excel template, fill it in and upload it. See " + link("create-and-add-student", "Add a student") + ". If you're coming from another student information system, see " + link("moving-to-managira", "Moving your school to Managira") + "."],
      ["Can I change the school's name or short name later?", "Yes, in <strong>Settings › Customize school</strong>. The web address you chose at sign-up stays the same."],
      ["Can someone else finish the setup?", "Yes. Invite a colleague as a Manager in Users / Employees and they can work through Setup steps with you."],
      ["Why didn't I see First-time setup?", "It only opens for a school that hasn't chosen a color or logo yet, and only for the school's own account or a manager who can edit the school profile. You can do every step later in Settings and Management."],
      ["The Setup steps tab has gone.", "It disappears once every required step is done and every recommended one is done or skipped."],
    ],
    related: ["navigate-managira", "customize-your-school", "create-school-years-terms-and-set-the-current-term", "create-and-add-student"],
  },
  {
    slug: "customize-your-school",
    title: "Customize your school: logo, name, colors, calendar and formats",
    topic: "School setup",
    order: 1,
    summary: "Settings › Customize school: your logo, name, address, short name, brand color, font, how names and dates show, and the school calendar.",
    tags: ["customize school", "logo", "brand color", "school details", "short name", "web address", "school calendar", "attendance calendar", "holidays", "public holidays", "days off", "weekends", "school rules", "date format", "name order", "font", "special days"],
    who: "Managers, and staff given <strong>School Profile &amp; Branding</strong> under Settings.",
    intro: "Your school's name, logo and color appear on every page, report card, email and on your public website. Set them once in <strong>Customize school</strong>. The school calendar there decides which days count for attendance.",
    sections: [
      {
        title: "Open Customize school",
        steps: [
          ["Open the menu (☰) at the top right and select <strong>Settings</strong>.", "setup-settings-menu.webp", "The menu, with Settings ringed."],
          ["Select <strong>Customize school</strong> in the Settings menu on the left.", "setup-customize.webp", "Customize school has three cards."],
          ["Each card opens with <strong>Expand</strong>. The three cards are <strong>School profile</strong>, <strong>Look and feel</strong> and <strong>School rules</strong>."],
          ["After you change anything in a card, <strong>Unsaved changes</strong> appears at the bottom. Select <strong>Save changes</strong> to save everything you changed in that card."],
        ],
      },
      {
        title: "School profile",
        image: "setup-customize-profile.webp",
        caption: "School profile: logo, details, short name and web address.",
        steps: [
          ["<strong>Logo</strong>: select <strong>Choose logo</strong> and pick a square image, at least 200 × 200 pixels (PNG or JPG). It shows in the header, on report cards, transcripts, receipts and your website."],
          ["<strong>School details</strong>: change the <strong>School name</strong>, <strong>Address</strong> and <strong>Country</strong>. The currency follows the country."],
          ["<strong>Short name and web address</strong>: the <strong>Short name</strong> is the name shown for your school in the header and emails (3 to 60 characters). Your <strong>Web address</strong> has a padlock. It was set when you signed up and can't be changed."],
          "Select <strong>Save changes</strong>.",
        ],
      },
      {
        title: "Look and feel",
        image: "setup-customize-look.webp",
        caption: "Brand color, font, and how names and dates show.",
        steps: [
          ["<strong>Brand color</strong>: pick a color. It's used for your school's pages, buttons and website."],
          ["<strong>Font</strong>: choose a typeface. The box under it previews how names, grades and announcements will look."],
          ["<strong>Names and dates</strong>: choose <strong>Name order</strong> (<em>Ada Lovelace</em>, first name first, or <em>Lovelace, Ada</em>, last name first) and a <strong>Date format</strong>. This changes how names and dates appear across the portals, PayGira and student pages."],
          "Select <strong>Save changes</strong>.",
        ],
        tip: "After you change the color, open a report card preview before you print a whole class, so it reads well on paper.",
      },
      {
        title: "School calendar: weekends, holidays and days off",
        text: "<strong>School rules</strong> holds the <strong>School calendar</strong>. It decides which days count for attendance and lunch across the whole school.",
        image: "setup-customize-rules.webp",
        caption: "School rules: the School calendar, then Student IDs further down.",
        steps: [
          ["Open <strong>School rules</strong>. Under <strong>Public holidays from</strong>, choose the country whose public holidays your school follows. It starts with your school's country."],
          ["Under <strong>Weekend days</strong>, check the days your school doesn't meet. Attendance isn't counted on these days."],
          "Check <strong>Don't count attendance on public holidays</strong> if your school is closed on them.",
          "Leave <strong>Show weekends and holidays on the attendance sheet</strong> checked to see them grayed beside the school days. Then <strong>Last 3 days</strong> is the last 3 calendar days. Uncheck it to hide them, and it becomes the last 3 school days.",
          ["Under <strong>Special days</strong>, choose a <strong>Date</strong>, add a <strong>Reason</strong> such as a teacher training day or a snow day, and choose <strong>Don't count</strong> (or <strong>Count</strong> for a day your school meets that would normally be off). Select <strong>Add day</strong>."],
          "Select <strong>Save changes</strong> for the other settings. <strong>Add day</strong> saves by itself.",
        ],
        note: "Special days you added are listed with <strong>Delete</strong>. Holidays added by Managira show <em>Auto</em>. If your school uses Class settings, each class's Class settings shows this calendar with a link back here. See " + link("class-settings", "Class settings") + ".",
      },
      {
        title: "Student ID numbers",
        text: "<strong>Student IDs</strong> sits under the calendar in <strong>School rules</strong>. See " + link("configure-custom-student-ids", "Set up student ID numbers") + ".",
      },
    ],
    faq: [
      ["Will changing the short name break old links?", "No. The short name is only the name shown for your school. Your web address stays the same."],
      ["Who sees the logo and color?", "Everyone: staff, parents, students, and visitors to your school website."],
      ["Why is a weekend day still showing in attendance?", "Check <strong>Show weekends and holidays on the attendance sheet</strong> to see them grayed. Uncheck it to hide them."],
      ["I can't find Customize school.", "You need <strong>School Profile &amp; Branding</strong> under Settings, or the Manager role. Ask your school's manager."],
    ],
    related: ["register-a-school-and-complete-first-time-setup", "school-website", "configure-custom-student-ids", "class-settings"],
  },
  {
    slug: "create-school-years-terms-and-set-the-current-term",
    title: "Create school years and terms, and set the current term",
    topic: "School setup",
    order: 2,
    summary: "Register a school year with its terms, set the current term, rename or remove terms, and move to the next term when one ends.",
    tags: ["school year", "term", "semester", "trimester", "quarter", "current term", "academic calendar", "register school year", "term names", "next step", "overlap", "carry over classes"],
    featured: true,
    who: "Managers, and staff given <strong>Manage School Years &amp; Terms</strong>.",
    intro: "Attendance, assessments, report cards and promotion all belong to a school year and a term. Register your year first, then mark the term you're in as <strong>Current</strong>. The current term decides what staff see by default.",
    sections: [
      {
        title: "Open School years & terms",
        image: "setup-years.webp",
        caption: "Each school year and its terms. The current ones are marked with a dot.",
        steps: [
          ["Go to <strong>Management</strong> and select <strong>School years &amp; terms</strong>, the first item in the menu."],
        ],
      },
      {
        title: "Register a school year",
        steps: [
          ["Select <strong>New school year</strong>."],
          ["Managira suggests the next school year. Check the <strong>School year</strong> (two years in the form <em>2027-2028</em>), the <strong>First day</strong> and the <strong>Last day</strong>.", "setup-years-register.webp", "Register school year."],
          ["Under <strong>Divided into</strong>, choose <strong>Semesters</strong> (2 terms), <strong>Trimesters</strong> (3), <strong>Quarters</strong> (4), <strong>Full year</strong> (1) or <strong>Custom</strong> (your own terms). The terms below fill in with names and dates, shared out evenly."],
          ["Change any term's <strong>Name</strong>, <strong>Start</strong> or <strong>End</strong>. Use <strong>+ Add term</strong> for another, or the <strong>⋮</strong> on a term to remove it.", "setup-years-quarters.webp", "Quarters: four terms."],
          ["Select <strong>Register</strong>."],
        ],
        note: "If you change the structure after editing a term by hand, Managira asks before it refills them. Choose <strong>Custom</strong> to keep your own terms. A term can't overlap another term, in this school year or in another one. Managira tells you which term it clashes with.",
        example: "A middle school uses two semesters: <em>Fall Semester</em> (August 17 to December 18) and <em>Spring Semester</em> (January 11 to May 28).",
      },
      {
        title: "Set the current term",
        steps: [
          ["In the school year, choose <strong>Current</strong> beside the term you're in now. The school year's <strong>Current</strong> button follows it."],
          ["Select <strong>Save Changes</strong>."],
        ],
        warning: "Only one term is current at a time. Attendance, grades and reports open on the current term for everyone, so make sure it's the right one.",
      },
      {
        title: "When you switch to another term",
        steps: [
          ["If today's date falls in a different term, Managira asks first: <em>Based on today's date, it looks like you should be in…</em>. Select <strong>OK</strong> if you do mean the other term, or <strong>Cancel</strong>.", "setup-years-switch.webp", "A check against today's date."],
          ["Managira then asks <strong>Apply Enrollment Update?</strong> <strong>Yes</strong> carries your classes (and, if you choose, their students) into the new term. <strong>No</strong> saves without it. <strong>Cancel</strong> goes back.", "setup-years-decide.webp", "Carry classes into the new term?"],
          ["If you chose <strong>Yes</strong>, pick <strong>Enroll classes only</strong> or <strong>Enroll classes and students</strong>, check the classes, and select <strong>Enroll and Save</strong>."],
        ],
        tip: "You can also do this later in " + link("enrolling-classes-and-student-in-aterm-semester", "Enrollment") + ".",
      },
      {
        title: "The Next step card",
        text: "When a term has no classes or students yet, a <strong>Next step</strong> card appears at the top. It names the terms and has <strong>Go to Enrollment</strong>.",
        image: "setup-years-next.webp",
        caption: "Next step: these terms have no classes or students yet.",
      },
      {
        title: "Rename, remove and term names",
        steps: [
          ["Open the <strong>⋮</strong> on a term for <strong>Delete Term / Semester</strong>."],
          ["Open the <strong>⋮</strong> on a school year for <strong>Delete School Year</strong>. A year that has finished also has <strong>Rename school year</strong>."],
          "<strong>Term names</strong>, above the list, holds every term name your school uses, so each is set up once. Rename one there and it changes in every school year that has it. A name no year uses can be removed.",
        ],
        warning: "A term, or a school year, can't be deleted while students are enrolled in it or it holds records such as attendance, scores or report cards. Managira says what's in the way.",
      },
      {
        title: "When a term ends",
        text: "A term whose end date has passed shows <strong>Completed</strong>, and its dates can't be edited. If it's still current, a note says <em>This term has ended. Choose the next term as Current to keep working.</em> To do that, select <strong>Current</strong> beside the next term and save. Choosing a term as current also makes its school year current. To move students up a class, see " + link("promote-students-and-manage-graduation", "Promotion and graduation") + ".",
      },
    ],
    faq: [
      ["Can we name terms our own way?", "Yes. Type any name in a term's <strong>Name</strong> field, such as Quarter 1, Trimester 2 or Fall Semester. Names you use are kept under <strong>Term names</strong> to reuse."],
      ["What happens to last year's data?", "It stays. Completed school years remain in the list, and their report cards and transcripts stay available."],
      ["Why does the school year show Completed?", "Every term in it has ended. It can still be renamed."],
      ["Why can't I delete a term?", "Students are enrolled in it, or it already holds records. Move or remove those first, or leave it as it is."],
    ],
    related: ["setting-up-classes-subjects-graduation-year-group", "enrolling-classes-and-student-in-aterm-semester", "promote-students-and-manage-graduation"],
  },
  {
    slug: "setting-up-classes-subjects-graduation-year-group",
    title: "Set up classes, subjects and graduation year groups",
    topic: "School setup",
    order: 3,
    summary: "Create your classes, add subjects and give them to classes, group students by graduation year, and tidy the lists.",
    tags: ["classes", "subjects", "graduation year", "grad year", "grade levels", "homeroom", "courses", "add class", "add subject", "obsolete", "restore", "dashboard class arrangement"],
    who: "Managers, and staff given <strong>Manage Classes &amp; Subjects</strong>.",
    intro: "Classes are your grade levels or homerooms, for example <em>7th Grade</em> or <em>Grade 3 - Room 1</em>. Subjects are what's taught in them. A graduation year group, such as <em>2030</em>, follows a group of students from year to year.",
    sections: [
      {
        title: "Open Classes & subjects",
        image: "setup-classes.webp",
        caption: "Classes, subjects and graduation years on one page.",
        steps: [
          ["Go to <strong>Management</strong> and select <strong>Classes &amp; subjects</strong>."],
          ["With many classes, type in the search box above the list to find one."],
        ],
      },
      {
        title: "Add classes",
        steps: [
          ["Select <strong>Add new</strong>. A window opens at the right with three tabs. The tab you used last opens again."],
          ["On the <strong>Class</strong> tab, type a name under <strong>Class names</strong>. Select <strong>＋ Add class</strong> for more rows, or paste a column of names.", "setup-classes-add-class.webp", "Add new, Class tab."],
          ["Select <strong>Save</strong>."],
        ],
        note: "A class you add joins the current term at once, so it shows on the dashboard right away. For a coming term, use " + link("enrolling-classes-and-student-in-aterm-semester", "Enrollment") + ".",
      },
      {
        title: "Add subjects",
        steps: [
          ["Open the <strong>Subject</strong> tab. <strong>New subject</strong> is on. Type the <strong>Subject name</strong> and check the classes that have it.", "setup-classes-add-subject.webp", "Add new, Subject tab."],
          ["Use the search box, <strong>Select all</strong> or <strong>Clear</strong> to pick classes quickly. <strong>Select all</strong> applies to what the search shows."],
          ["<strong>＋ Add subject</strong> adds another subject, each with its own classes, in the same save."],
          ["To give a subject you already have to more classes, choose <strong>Existing subject</strong>, pick it, check the classes and select <strong>Add to classes</strong>."],
          "Select <strong>Save</strong>.",
        ],
        tip: "Use the same subject names in every class. Report Builder and analytics then compare like with like across grades.",
      },
      {
        title: "Add graduation years",
        steps: [
          ["Open the <strong>Graduation year</strong> tab. Type a year, or select one of the <strong>Quick add</strong> years, then <strong>Save</strong>.", "setup-gradyear-zoom.webp", "Quick add years."],
        ],
        text: "Groups make promotion and graduation a few clicks each year. Students are added to a group when you add or edit them.",
      },
      {
        title: "Rename, make obsolete or delete",
        steps: [
          "Edit a name in place and select the update button under the list (<strong>Update All Classes</strong>, <strong>Update All Subjects</strong> or <strong>Update All Graduation Year Groups</strong>). Students, grades and reports keep their records under the new name.",
          ["Open the <strong>⋮</strong> beside a name for <strong>Make obsolete</strong> or <strong>Delete</strong>.", "setup-classes-menu.webp", "The menu of a class."],
        ],
        list: [
          "<strong>Make obsolete</strong> keeps the class, subject or group on every record that already uses it, and stops offering it for new work. Obsolete items stay listed, crossed out, with <strong>Restore</strong>.",
          "<strong>Delete</strong> is refused while a class, subject or group already has saved records, such as students, scores or attendance. Managira says what is in the way. Make it obsolete instead.",
        ],
      },
      {
        title: "Arrange classes on the dashboard",
        text: "<strong>Dashboard Class Arrangement</strong> sets the order classes appear in on the dashboard, for example youngest to oldest. Select <strong>Expand</strong>, drag classes into order, use <strong>Break after</strong> or <strong>Continue</strong> to group them, then select <strong>Save Dashboard Layout</strong>.",
      },
    ],
    faq: [
      ["Can I rename a class?", "Yes, at any time. Students, grades and reports keep their records under the new name."],
      ["What if a class is no longer used?", "Make it obsolete. Its past records stay in earlier terms, and it's no longer offered for new work."],
      ["A subject is missing from a class.", "Open <strong>Add new</strong>, then the <strong>Subject</strong> tab and <strong>Existing subject</strong>, and add the subject to that class."],
    ],
    related: ["enrolling-classes-and-student-in-aterm-semester", "create-school-years-terms-and-set-the-current-term", "create-and-add-student"],
  },
  {
    slug: "enrolling-classes-and-student-in-aterm-semester",
    title: "Enroll classes and students in a term",
    topic: "School setup",
    order: 4,
    summary: "Put your classes, and the students in them, into a school year's term, see who is enrolled, and move a student to another class.",
    tags: ["enrollment", "enroll classes", "enroll students", "term enrollment", "move student", "class roster", "add student from another class", "delete enrollment"],
    who: "Managers, and staff given <strong>Enrollment</strong> (which needs Manage Students).",
    intro: "A class shows on dashboards, attendance and the gradebook once it's enrolled in a term. A class you add joins the current term by itself, and a student added to a class is enrolled with it. So you mostly use Enrollment to prepare a coming term, or to fix who is where.",
    sections: [
      {
        title: "See who is enrolled",
        steps: [
          { text: "Go to <strong>Management</strong> and select <strong>Enrollment</strong>. Each term shows its classes and students. Use <strong>Find a term, class or student</strong> to search.", images: [["setup-enroll.webp", "Management › Enrollment."]] },
          ["Select a term to see its classes, with a count for each. Open a class to see its students.", "setup-enroll-term.webp", "A term's classes and students."],
        ],
      },
      {
        title: "Enroll classes and students",
        steps: [
          ["Select <strong>Enroll students</strong>."],
          ["A window opens at the right. Under <strong>1 Term</strong>, choose the term. If it already has an enrollment, a note says <em>Term already enrolled</em> with <strong>Open it</strong>.", "setup-enroll-new.webp", "Enroll students."],
          ["Under <strong>2 Classes</strong>, select <strong>Choose classes</strong>. Search, check classes or check <strong>All classes</strong>, then select <strong>Done</strong>."],
          "Under <strong>3 Students</strong>, each class opens to its students, all checked. Uncheck anyone who shouldn't be enrolled. <strong>All</strong> checks or unchecks a whole class, and <strong>Find student</strong> narrows the list.",
          ["Select <strong>Enroll</strong>. The classes now appear on dashboards, attendance and the gradebook for that term."],
        ],
        note: "A term has one enrollment. To change it, open the term and select <strong>Edit</strong>.",
      },
      {
        title: "Move a student to another class",
        steps: [
          ["Open the term, select <strong>Edit</strong>, and open the class the student should join. Type their name in <strong>Add student from another class</strong>."],
          ["Pick the student from the list that appears."],
          "If they are in another class this term, Managira tells you. Select <strong>Move them</strong>, or <strong>Cancel</strong>.",
          "Select <strong>Save</strong>. The student moves and stays enrolled.",
        ],
        tip: "To move a student and match their subjects to the new class, see " + link("transfer-a-student-between-classes-and-subject-matching", "Transfer a student") + ".",
      },
      {
        title: "What Enrollment never takes away",
        list: [
          "A student who already has attendance, scores or a report card in a term can't be taken out of that term. Move them to another class instead.",
          "<strong>Delete</strong>, in the Edit window, is refused while students are enrolled in the term or the term holds records.",
          "Adding a student with a school year only adds them to that year's term. It never moves or removes an enrollment in another.",
        ],
      },
    ],
    faq: [
      ["Do I have to enroll every term?", "Within a year, yes: enroll classes into each new term, or carry them over when you set a new current term. Promotion carries classes and students into the next school year for you."],
      ["Why isn't a class on the dashboard?", "A class you add joins the current term automatically. If one is missing, it may have been taken out of the term in Enrollment, or the term you're looking at isn't the current one."],
      ["Why can't I remove a student from a term?", "They already have attendance, scores or a report card in it. Move them to another class instead."],
    ],
    related: ["create-school-years-terms-and-set-the-current-term", "transfer-a-student-between-classes-and-subject-matching", "promote-students-and-manage-graduation"],
  },
  {
    slug: "configure-custom-student-ids",
    title: "Set up student ID numbers",
    topic: "School setup",
    order: 5,
    summary: "Let Managira number new students automatically with your own prefix and starting number, or type IDs yourself. Duplicate IDs are never allowed.",
    tags: ["student id", "student number", "id format", "auto-generate", "prefix", "custom student ids", "start numbering", "state id"],
    who: "Managers, and staff given <strong>School Profile &amp; Branding</strong> under Settings.",
    intro: "Every student has an ID. By default you type it when you add a student. You can also have Managira number new students for you, in your own format.",
    sections: [
      {
        title: "Choose your format",
        steps: [
          ["Go to <strong>Settings</strong>, <strong>Customize school</strong>, open <strong>School rules</strong> and scroll to <strong>Student IDs</strong>.", "setup-customize-ids.webp", "Student IDs, under the School calendar."],
          ["Turn on <strong>Custom student IDs</strong>."],
          ["Enter an <strong>ID prefix</strong> (optional, up to 10 letters, numbers, dashes or underscores, such as <code>LES-</code>). The gray box shows a sample."],
          "Turn on <strong>Auto-generate IDs</strong> if Managira should assign them. Staff can still edit an ID for a student.",
          ["Under <strong>Start numbering from</strong>, choose the first number. The line below says the next free number."],
          "Select <strong>Save changes</strong>.",
        ],
      },
      {
        title: "How numbering works",
        list: [
          "With <strong>Auto-generate IDs</strong> on, each new student gets the next number when they're added or their application is approved.",
          "Without it, you type each ID on the Add student form. A prefix you set is used for the sample only.",
          "An ID already used in your school is refused, and Managira suggests the next free one.",
          "Changing the format affects new students only. Existing IDs stay as they are.",
          "Change <strong>Start numbering from</strong> only to start a new range, for example after moving to a new format.",
        ],
      },
    ],
    faq: [
      ["Can we use our state student ID?", "Yes. Leave automatic IDs off and type each student's state ID when you add them, or include it in your import spreadsheet."],
      ["Can I change one student's ID?", "Yes. Edit the student and change their ID. It must not already be used in your school."],
      ["Where do I see a student's ID?", "In All Students and on the student's page, beside their name."],
    ],
    related: ["create-and-add-student", "customize-your-school"],
  },
];
