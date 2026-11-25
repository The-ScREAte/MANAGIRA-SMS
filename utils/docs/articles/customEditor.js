"use strict";

// The Custom editor: a school's own forms, from building one to reading its answers, printing
// them on report cards and reporting on them. What parents and students do with a form is in
// the portal guides (portals.js); these guides are for the people who build and collect them.
const link = (slug, text) => `<a href="/legal/user-documentation/${slug}">${text}</a>`;
const TOPIC = "Forms & Custom editor";
const WHO_BUILD = "Managers, and staff given the <strong>Custom Editor</strong> permission.";

module.exports = [
  {
    slug: "custom-editor",
    title: "Custom editor: build your school's own forms",
    topic: TOPIC,
    order: 1,
    summary: "Make permission slips, seating charts, behavior logs and sign-ups of your own, choose who fills them in, and collect the answers in one place.",
    tags: ["custom editor", "custom forms", "forms", "permission slip", "consent form", "behavior log", "medical form", "survey", "sign-up", "sections", "fields", "seating chart", "student groups", "report remarks"],
    featured: true,
    who: WHO_BUILD + " Teachers, parents, students and drivers fill in the forms made for them.",
    intro: "Use the Custom editor for anything your school records about students that Managira has no page for yet. You make a <strong>section</strong> (one form), choose who fills it in and how often, add its fields, and the answers come back to one place.",
    sections: [
      {
        title: "Open the Custom editor",
        steps: [
          ["Go to <strong>Management › Custom editor</strong>."],
          ["Your sections are listed one per row, with the place it lives in, its classes, how often it is collected and how many fields and answers it has.", "forms-list.webp", "Management › Custom editor. Report remarks is there in every school."],
          ["On the right of each row: <strong>Answers</strong> (the list icon), <strong>Report</strong> (the chart icon), the eye to hide or show it, and arrows to move it up or down. Select a row to open it."],
        ],
      },
      {
        title: "How the pieces fit",
        table: [
          ["Guide", "What it covers"],
          [link("custom-editor-build-a-section", "Build a section"), "Start from a ready school form or a blank one, choose where it lives, its classes and how often it is collected."],
          [link("custom-editor-fields", "Add and change fields"), "Every field type, choices, required, and showing a field only when another answer calls for it."],
          [link("custom-editor-more-options", "More options"), "Deadlines, how families hear, who is told, who sees the answers, report card, its own tile."],
          [link("custom-editor-quick-forms", "Quick forms, seating charts and groups"), "Answer for a whole class on one screen."],
          [link("custom-editor-classroom-forms", "Fill in forms in the classroom"), "The class's Forms tab, and what parents, students and drivers do."],
          [link("custom-editor-answers", "Read and report on answers"), "Answers, Download, Remind, and Report."],
          [link("custom-editor-report-remarks", "Report remarks"), "Teacher's remarks through the editor, and adding a form's answers to the report card."],
        ],
      },
      {
        title: "Where each person finds a form",
        table: [
          ["Place", "Who fills it in", "Where they find it"],
          ["<strong>Classroom</strong>", "Teachers and office staff", "The class's <strong>Forms</strong> tab in Class Tools"],
          ["<strong>Parent portal</strong>", "Parents", "Their child's page, and <strong>Requests</strong> on the dashboard. See " + link("parent-forms-and-portfolio", "Forms and your child's portfolio")],
          ["<strong>Student portal</strong>", "Students", "Their <strong>Forms</strong> page. See " + link("student-portal", "The student portal")],
          ["<strong>Driver portal</strong>", "Drivers, for students on their bus", "A <strong>Forms</strong> card on the driver's page"],
        ],
      },
    ],
    faq: [
      ["How is this different from the fields in Admission settings?", "Admission settings adds details to the student's or parent's own record, asked when they join. The Custom editor is for forms you collect later, by class, term or event, each with its own list of answers. See " + link("admission-settings", "Admission settings") + "."],
      ["Who can see the answers?", "People who build forms see every answer. Teachers see their own classes, and drivers their own riders. Parents and students see what they sent, and what you choose to share. A section marked <strong>Hide from teachers</strong> opens only for people who build forms."],
      ["How many forms can a school have?", "Up to 200 sections, each with up to 80 fields."],
      ["What happens when I delete a section?", "Its answers are deleted with it. To keep the answers, switch <strong>Live</strong> off instead: the section is hidden and nothing is lost."],
    ],
    related: ["custom-editor-build-a-section", "custom-editor-fields", "custom-editor-classroom-forms", "custom-editor-answers", "report-card", "parent-forms-and-portfolio"],
  },

  {
    slug: "custom-editor-build-a-section",
    title: "Build a section: from the library or a blank form",
    topic: TOPIC,
    order: 2,
    summary: "Create a form from a ready school form or a blank section, choose who fills it in, which classes it is for and how often it is collected.",
    tags: ["new section", "library", "blank section", "place", "classes", "collect once", "many times", "lock once sent", "live", "hidden"],
    who: WHO_BUILD,
    intro: "A section is one form. You choose where it lives, which classes it is for and how often it is collected, then add its fields.",
    sections: [
      {
        title: "Start a new section",
        steps: [
          ["Go to <strong>Management › Custom editor</strong> and select <strong>New section</strong>."],
          ["Choose a ready school form, or <strong>Blank</strong> to start from nothing.", "forms-library.webp", "The library of ready school forms, in groups."],
        ],
        subsections: [
          {
            title: "The ready school forms",
            text: "Each one opens with its fields filled in. Change anything before you save.",
            images: [],
            table: [
              ["Group", "Forms"],
              ["Report card", "Report remarks, Skills &amp; effort, Student reflection"],
              ["Health", "Medical &amp; allergies, Medication authorization, Immunization record, Health office visit"],
              ["Permissions", "Field trip permission, Photo &amp; media consent, Handbook acknowledgement, Device agreement"],
              ["Requests from parents", "Absence note, Early dismissal request, Meeting request"],
              ["Every day in class", "Seating chart, Student groups, Lunch order"],
              ["Classroom records", "Behavior log, Reading log, Support plan"],
              ["Sign-ups &amp; surveys", "Club &amp; sports sign-up, Volunteer sign-up, Family survey"],
            ],
            note: "Managira already keeps " + link("emergency-and-pickup-details", "emergency and pickup details") + ", " + link("mark-attendance-for-a-class", "attendance and lunch") + " and " + link("transportation-reports", "driver reports") + ". The library leaves them out so nothing is recorded twice.",
          },
        ],
      },
      {
        title: "Name it and choose where it lives",
        steps: [
          ["Type the section's name in the box at the top. Select the icon beside it to change the picture."],
          ["Under <strong>Place</strong>, choose who fills it in.", "forms-section-place-zoom.webp", "Place: Classroom, Parent portal, Student portal or Driver portal."],
        ],
        table: [
          ["Place", "Who fills it in"],
          ["<strong>Classroom</strong>", "Teachers and office staff, on the class's Forms tab."],
          ["<strong>Parent portal</strong>", "Parents, for their own child."],
          ["<strong>Student portal</strong>", "Students, for themselves."],
          ["<strong>Driver portal</strong>", "Drivers, for the students on their bus."],
        ],
      },
      {
        title: "Choose the classes",
        steps: [
          ["Under <strong>Classes</strong>, leave <strong>All</strong> for every class, or select <strong>Choose</strong>.", "forms-section-classes-zoom.webp", "Choose shows every class as a chip. Select the ones you want."],
          "Use <strong>Find</strong> to narrow the list of classes. The count under the list says how many you picked.",
        ],
        example: "A field trip form for 6th Grade only: choose <strong>6th Grade</strong>. Only its parents see the form.",
      },
      {
        title: "Choose how often it is collected",
        steps: [
          ["Under <strong>Collect</strong>, choose <strong>Once</strong> or <strong>Many times</strong>."],
          ["For <strong>Many times</strong>, choose how often."],
        ],
        table: [
          ["Collect", "What it means", "Good for"],
          ["<strong>Once</strong>", "One answer per student.", "Photo consent, a field trip permission"],
          ["<strong>Every day</strong>", "One answer per student each day.", "Daily check-ins"],
          ["<strong>Every week</strong>", "One answer per student each week.", "Lunch orders"],
          ["<strong>Every term</strong>", "One answer per student, asked again each term.", "Skills and effort, seating charts, groups"],
          ["<strong>Every year</strong>", "One answer per student, asked again each school year.", "Handbook and device agreements"],
          ["<strong>Any time</strong>", "A list that grows: add an entry whenever something happens.", "Behavior log, reading log, health office visits"],
        ],
        tip: "For a form that must not change once sent, such as a permission slip, check <strong>Lock once sent</strong> under <strong>Once</strong>. A locked form can't be edited after it is sent, and it leaves the person's list.",
      },
      {
        title: "Add fields, then save",
        steps: [
          "Add the questions. See " + link("custom-editor-fields", "Add and change fields") + ".",
          ["Select <strong>Preview</strong> to see the form the way the person filling it in will.", "forms-preview.webp", "Preview shows the form without saving anything."],
          "Select <strong>Save</strong>. The new section appears in your list.",
        ],
        note: "A new section is <strong>Live</strong> as soon as you save it. Switch <strong>Live</strong> off to keep working on it in private: it then shows as <em>Hidden</em>. When a parent form goes live, its families are notified.",
      },
    ],
    faq: [
      ["Can I change Place or Collect after people have answered?", "You can, but think first. Answers stay with the section. A form that changes from Every term to Once, for example, shows only the answers that still fit."],
      ["Why can't I choose Text message or WhatsApp?", "Those appear under More options only when your school has switched that channel on in Management › Integrations. See " + link("custom-editor-more-options", "More options") + "."],
    ],
    related: ["custom-editor", "custom-editor-fields", "custom-editor-more-options", "custom-editor-quick-forms"],
  },

  {
    slug: "custom-editor-fields",
    title: "Add and change fields in a form",
    topic: TOPIC,
    order: 3,
    summary: "Add questions to a section, pick the right field type, make a field required, and show it only when another answer calls for it.",
    tags: ["fields", "field types", "dropdown", "checklist", "signature", "file upload", "required", "show when", "conditional", "yes no", "rating", "instructions"],
    who: WHO_BUILD,
    intro: "Each question in a form is a field. A section can hold up to 80.",
    sections: [
      {
        title: "Add a field",
        steps: [
          ["Open the section, then select <strong>Add field</strong> above the list of fields.", "forms-add-field.webp", "Add field opens the list of field types."],
          ["Choose a type."],
          "Type the <strong>Label</strong> (the question). Add <strong>Help</strong> if it needs explaining, and check <strong>Required</strong> if it must be answered.",
          "Select <strong>Done</strong>, then <strong>Save</strong> the section.",
        ],
        tip: "Drag a field by its handle to reorder the list. Select a field to change it later.",
      },
      {
        title: "Field types",
        table: [
          ["Type", "Use it for"],
          ["Text – single line, Text – multiple lines", "Names, notes and explanations"],
          ["Number, Date, Time", "Amounts, dates and times"],
          ["Yes / No", "A simple yes or no. Show it as <strong>Words</strong>, or as a check and a cross."],
          ["Dropdown list", "Pick one. Show it as a <strong>List</strong>, as <strong>Buttons</strong> with words, or as <strong>Icons</strong>."],
          ["Checklist (pick several)", "Pick all that apply"],
          ["Rating (1–5)", "A score from 1 to 5"],
          ["Email, Phone, Link", "Contact details and web addresses"],
          ["File upload", "A photo or a document, such as a doctor's note"],
          ["Signature", "The person types their name and checks a box to sign"],
          ["Seat (seating chart)", "Where a student sits. Classroom sections only. See " + link("custom-editor-quick-forms", "Quick forms, seating charts and groups")],
          ["Instructions", "Text to read. Nothing to answer"],
        ],
      },
      {
        title: "Choices for a dropdown or checklist",
        steps: [
          ["Add a <strong>Dropdown list</strong> or <strong>Checklist</strong>. Under <strong>Choices</strong>, type each option on its own row.", "forms-field-dropdown-zoom.webp", "Choices, and how a dropdown shows: List, Buttons or Icons."],
          "For a dropdown, choose <strong>Show as</strong>: <strong>List</strong>, <strong>Buttons</strong> or <strong>Icons</strong>. Icons are picked from each choice's words. Select an icon to change it.",
        ],
      },
      {
        title: "Show a field only when it is needed",
        steps: [
          "Select the field, then open <strong>More</strong> in the field's panel.",
          ["Under <strong>Visibility</strong>, choose <strong>Show</strong> or <strong>Hide</strong>, the other field to watch, and the answer."],
          "Select <strong>Done</strong>, then <strong>Save</strong>.",
        ],
        example: "Show <em>Which medication?</em> only when <em>Does your child take medication?</em> is <em>Yes</em>.",
        list: [
          "<strong>Width</strong>: <em>Half</em> puts two short fields side by side.",
          "<strong>Stop using</strong>: hides the field from now on. Answers already given are kept. A field you stopped using shows <em>Not used</em> in the list.",
          "<strong>Delete</strong> (bottom left of the panel) removes the field from the form.",
        ],
      },
    ],
    faq: [
      ["Can I change a field after people have answered?", "Yes. Reword it or add fields at any time. To retire a field without losing its answers, check <strong>Stop using</strong>."],
      ["Why is Seat missing from my list of types?", "Seat is for classroom sections only. Change <strong>Place</strong> to <strong>Classroom</strong> first."],
    ],
    related: ["custom-editor", "custom-editor-build-a-section", "custom-editor-more-options"],
  },

  {
    slug: "custom-editor-more-options",
    title: "More options: deadlines, who is told, who sees answers",
    topic: TOPIC,
    order: 4,
    summary: "Set a deadline, choose how families hear, who is told when a form is sent, who sees the answers, and whether it prints on report cards or gets its own tile.",
    tags: ["deadline", "due date", "required", "notify", "tell", "seen by", "hide from teachers", "protected", "attendance column", "report card", "own tile", "beside each student", "email families"],
    who: WHO_BUILD,
    intro: "Under <strong>More</strong> at the bottom of a section are the choices that change who hears about the form and who sees the answers. You only see the ones that fit where the form lives.",
    sections: [
      {
        title: "Open More",
        steps: [
          ["Open the section and select <strong>More</strong> under the fields. It opens by itself when a choice is already on.", "forms-more-parent.webp", "More, for a parent form."],
        ],
      },
      {
        title: "Deadline and required",
        text: "For parent and student forms.",
        steps: [
          ["Under <strong>Due</strong>, pick a date. Check <strong>Required</strong> to mark the form as required."],
        ],
        note: "Families who haven't filled in a required form are reminded once, two days before the deadline.",
      },
      {
        title: "How families hear",
        text: "For parent forms.",
        steps: [
          ["Under <strong>Notify</strong>, <strong>Notification</strong> is always on. Check <strong>Email</strong> to email families too."],
        ],
        note: "Families are told when the form goes live, and when someone selects <strong>Remind</strong>. <strong>Text</strong> and <strong>WhatsApp</strong> appear once your school switches them on in Management › Integrations.",
      },
      {
        title: "Who is told when it is sent",
        steps: [
          ["Under <strong>Tell</strong>, choose <strong>Main teacher</strong>, <strong>Form builders</strong> or both."],
        ],
      },
      {
        title: "Who sees the answers",
        steps: [
          ["Under <strong>Seen by</strong>, the class's teachers always see the answers. For a classroom or driver form, check <strong>Parents</strong> or <strong>Students</strong> to share them."],
        ],
        warning: "Check <strong>Hide from teachers</strong> for sensitive records such as support plans. Then only people who build forms can open them. The row's pill reads <em>Protected</em>.",
      },
      {
        title: "Report card, attendance column and Beside each student",
        steps: [
          ["<strong>Report card</strong>, then <strong>On report card</strong>, prints each student's answers for the term on their report card. It is for classroom forms collected once, every term or every year.", "forms-more-reportcard-zoom.webp", "On report card, with Beside each student next to it."],
          "<strong>Attendance</strong>, then <strong>On attendance page</strong> (classroom forms collected every day), adds the form as a column on the class's attendance page.",
          "<strong>Students list</strong>, then <strong>Beside each student</strong> (classroom forms), puts the form's icon beside each student in the class's Students list: gray until it is filled in for this term, then your school's color. A tap opens that student's form.",
        ],
      },
      {
        title: "Its own tile",
        steps: [
          ["<strong>Tile</strong>, then <strong>Own tile</strong>, gives the form a place of its own, by name."],
        ],
        list: [
          "Classroom form: an item in Class Tools.",
          "Parent form: a tile on the child's page.",
          "Student form: a tile on the student's dashboard.",
          "Driver form: a card on the driver's page.",
        ],
        note: "Without it, the form sits under <strong>Forms</strong>. <strong>Notes</strong>, the last row, is a note for the people who build forms.",
      },
    ],
    faq: [
      ["Why don't I see some of these rows?", "Each row shows only where it fits. <strong>Due</strong> and <strong>Notify</strong> are for portal forms; <strong>Attendance</strong> is for classroom forms collected every day; <strong>Report card</strong> is not offered for lists that grow or for protected forms."],
      ["Can teachers read a protected form?", "No. <strong>Hide from teachers</strong> limits it to the people who build forms."],
    ],
    related: ["custom-editor", "custom-editor-build-a-section", "custom-editor-answers", "custom-editor-report-remarks"],
  },

  {
    slug: "custom-editor-quick-forms",
    title: "Quick forms, seating charts and student groups",
    topic: TOPIC,
    order: 5,
    summary: "Answer for a whole class on one screen with tap-to-answer forms, arrange a seating chart, and sort students into groups.",
    tags: ["quick form", "seating chart", "student groups", "tap to answer", "seat", "groups", "reading groups", "lunch order"],
    who: "Managers and staff with the <strong>Custom Editor</strong> permission build them. Teachers use them in their class.",
    intro: "A section made only of tap-to-answer fields (Yes / No, dropdown, rating, seat) is <strong>quick</strong>: a teacher answers for every student on one screen. The editor shows <em>Quick</em> under <strong>Collect</strong> when a section qualifies.",
    sections: [
      {
        title: "Student groups",
        steps: [
          "In <strong>Management › Custom editor</strong>, select <strong>New section</strong> and choose <strong>Student groups</strong> under Every day in class. Rename the groups: reading groups, project teams or houses.",
          ["In the class, open <strong>Forms</strong> in Class Tools and choose <strong>Student groups</strong>. The <strong>List</strong> shows a dropdown beside each student.", "forms-class-groups.webp", "List: pick each student's group from a dropdown."],
          ["Select <strong>Groups</strong> to see the groups as columns."],
          ["Tap a student, then tap the group to move them to.", "forms-class-groups-board.webp", "Students with no group sit under No group yet."],
        ],
      },
      {
        title: "A seating chart",
        steps: [
          "Create a section from <strong>Seating chart</strong> in the library. It has one field of the type <em>Seat</em> and its own tile.",
          ["In the class, open <strong>Seating chart</strong> in Class Tools. Students without a seat wait at the top as <strong>Not seated yet</strong>. Tap a student, then tap a seat.", "forms-class-seating.webp", "The front of the room is at the top."],
          ["Tap two seated students to swap them. <strong>+ Row</strong> and <strong>+ Column</strong> make the room bigger."],
        ],
        tip: "Choose how each seat shows: photos or names only. Open the Seat field and set <strong>Show</strong> to <strong>Photos</strong> or <strong>Names</strong>.",
      },
      {
        title: "Icons, words and counts",
        list: [
          "<strong>Icons or words</strong>: in a dropdown field, choose <strong>Show as</strong> and then <strong>Icons</strong>. Each choice gets an icon picked from its words, and you can change it.",
          "<strong>One tap</strong>: the answer you tap lights up and the others fade. Tap it again to clear it.",
          "<strong>A count</strong>: a key above the list shows each answer and how many students have it.",
        ],
      },
      {
        title: "Lunch",
        text: "Lunch is built into attendance, with a plate beside each student's checkbox. You don't need a form for it. See " + link("mark-attendance-for-a-class", "Take attendance") + ".",
        tip: "Want parents to order ahead? Use <strong>Lunch order</strong> from the library. It lives in the parent portal and is asked every week.",
      },
    ],
    faq: [
      ["Why isn't my section quick?", "A quick section has up to four tap-to-answer fields, none of them shown on a condition. Add a text field or a fifth field and it becomes a normal form."],
      ["Can parents see the seating chart?", "Only if you check <strong>Parents</strong> under <strong>Seen by</strong> in More. See " + link("custom-editor-more-options", "More options") + "."],
    ],
    related: ["custom-editor", "custom-editor-classroom-forms", "mark-attendance-for-a-class", "class-page"],
  },

  {
    slug: "custom-editor-classroom-forms",
    title: "Fill in forms in the classroom",
    topic: TOPIC,
    order: 6,
    summary: "Open a class's Forms tab, see who has answered, fill in a form for a student, and see what parents, students and drivers do with theirs.",
    tags: ["forms tab", "fill in a form", "class forms", "done", "not started", "waiting", "behavior log", "entries", "parent forms", "driver forms"],
    who: "Teachers for their own classes, and staff who can open the class. Managers and supervisors see every class.",
    intro: "Each class has a <strong>Forms</strong> tab that lists every form that applies to it and who has answered.",
    sections: [
      {
        title: "Open the Forms tab",
        steps: [
          ["Open the class, then select <strong>Forms</strong> in Class Tools."],
          ["Each form is a button at the top. Choose one."],
          ["Under it, every student shows a status.", "forms-class-tab.webp", "A form, its progress, and one row per student."],
        ],
        list: [
          "<strong>Done</strong> (or <strong>Submitted</strong> for a parent form): an answer is in.",
          "<strong>Waiting</strong>: a parent or student form that has not been sent.",
          "<strong>Not started</strong>: nothing saved yet.",
          "<strong>Find</strong> narrows the list. <strong>Download</strong> saves it as a spreadsheet.",
        ],
      },
      {
        title: "Fill in a form for a student",
        steps: [
          ["Select a student. A panel opens with the form's fields.", "forms-class-fill.webp", "Skills & effort for one student."],
          "Fill in the fields and select <strong>Save</strong>.",
        ],
        note: "A form collected <strong>Every term</strong> or <strong>Every year</strong> starts from the student's last answers, so you change only what is different.",
      },
      {
        title: "Forms that grow",
        text: "A form collected <strong>Any time</strong>, such as a behavior log, keeps a list. Select a student to see their entries, then <strong>Add</strong> a new one. Each entry shows its date and who wrote it, with <strong>Edit</strong> and a delete button.",
        image: "forms-class-behavior.webp",
        caption: "A student's behavior log: one entry per event.",
      },
      {
        title: "Beside each student",
        text: "A form with <strong>Beside each student</strong> on (Report remarks is one) puts its icon next to every name on the class page. Gray means it isn't filled in for this term. Tap it to open that student's form.",
        image: "forms-class-students.webp",
        caption: "The Students list on the class page, with each form's icon beside the names.",
      },
      {
        title: "Parents, students and drivers",
        list: [
          "<strong>Parents</strong> fill in a form from their child's page or from <strong>Requests</strong> on their dashboard. See " + link("parent-forms-and-portfolio", "Forms and your child's portfolio") + ".",
          "<strong>Students</strong> fill in theirs on their <strong>Forms</strong> page. See " + link("student-portal", "The student portal") + ".",
          "<strong>Drivers</strong> find a <strong>Forms</strong> card on their page, for the students on their bus only.",
          "Teachers read what parents and students send but can't change it. If a family hands a form in on paper, a teacher can enter it for them.",
        ],
        note: "The class's main teacher gets a notification each time a parent, student or driver sends a form. Change who hears under <strong>More › Tell</strong>.",
      },
    ],
    faq: [
      ["A form is missing from the class's Forms tab.", "Check the section is <strong>Live</strong>, that it includes this class, and that you can open the class. A form with its own tile is in Class Tools by its name instead."],
      ["Why can't I edit a parent's answer?", "Answers parents and students send are theirs. Staff read them. You can enter an answer for a family only when nothing was sent, such as a paper form."],
    ],
    related: ["custom-editor", "custom-editor-quick-forms", "custom-editor-answers", "class-page"],
  },

  {
    slug: "custom-editor-answers",
    title: "Read and report on a form's answers",
    topic: TOPIC,
    order: 7,
    summary: "See who has answered, download the answers as a spreadsheet, remind families, and build a report on a form in Report Builder.",
    tags: ["answers", "download", "csv", "remind", "reminder", "report", "report builder", "who has not answered", "submitted", "waiting"],
    who: WHO_BUILD + " Teachers read the answers for their own classes.",
    intro: "Every section keeps its answers in one list. Read them, download them, nudge families who haven't answered, and report on them.",
    sections: [
      {
        title: "Open the answers",
        steps: [
          ["In <strong>Management › Custom editor</strong>, select the list icon on the section's row, or open the section and select <strong>Answers</strong>."],
          ["The list shows each student, their status and when it was last saved.", "forms-answers.webp", "A field trip permission: 19 of 30 done."],
          "Select a student to read what was sent. A parent form shows <strong>Submitted</strong> or <strong>Waiting</strong>.",
        ],
      },
      {
        title: "Download the answers",
        steps: [
          "Select <strong>Download</strong>. Managira saves a spreadsheet (CSV): one row per answer with its day, and students who haven't answered marked <em>Not yet</em>.",
        ],
        note: "Cells that start with a formula character are made safe, so opening the file never runs anything.",
      },
      {
        title: "Remind families",
        steps: [
          "For a parent form, select <strong>Remind</strong>. Families who haven't filled it in get a notification, and an email if the form's <strong>Notify</strong> includes it.",
        ],
        note: "A family is reminded once a day at most. A required form also reminds once on its own, two days before its deadline.",
      },
      {
        title: "Report on the answers",
        steps: [
          "Select <strong>Report</strong> on the section. " + link("report-builder", "Report Builder") + " opens on this form with its fields already chosen as columns.",
          "Select <strong>Run</strong>. Save, share or export the report like any other.",
          "Or open <strong>Reports › Report builder</strong>, choose <strong>Students</strong>, then <strong>Custom forms</strong>. Filter by form, class, term or day. Every field of your forms is a column, listed under its form's name.",
        ],
      },
    ],
    faq: [
      ["Does a new term clear the answers?", "No. An Every term section starts a fresh answer each term. Earlier terms keep theirs, and you can still download or report on them. The same is true of each day and each week."],
      ["Who gets a notification when someone sends a form?", "The class's main teacher, the people who build forms, or both. Change it under <strong>More › Tell</strong>."],
    ],
    related: ["custom-editor", "custom-editor-more-options", "report-builder", "custom-editor-classroom-forms"],
  },

  {
    slug: "custom-editor-report-remarks",
    title: "Report remarks: teacher comments through the Custom editor",
    topic: TOPIC,
    order: 8,
    summary: "Write teacher remarks through the Custom editor with tap-to-add suggestions, and add a form's answers to the report card.",
    tags: ["report remarks", "teacher remarks", "remark suggestions", "prints as", "beside each student", "skills and effort", "forms.all", "head teacher remark"],
    who: WHO_BUILD + " Teachers write the remarks.",
    intro: "Every school has a <strong>Report remarks</strong> section in the Custom editor. Each remark prints on the report card in its usual place. Other forms, such as skills and effort, can print on report cards too.",
    sections: [
      {
        title: "The Report remarks section",
        steps: [
          ["Go to <strong>Management › Custom editor</strong> and open <strong>Report remarks</strong>.", "forms-remarks-section.webp", "Teacher's, Conduct, Interest and Attitude remarks, each printing in its own place."],
          "Switch <strong>On</strong> or <strong>Off</strong> at the top to leave remarks out. Answers are kept, and Report settings shows <strong>Turn on</strong> to bring them back.",
        ],
      },
      {
        title: "Add or change a remark",
        steps: [
          ["Select <strong>Add remark</strong>, name it (for example <em>Head Teacher's Remarks</em>) and select <strong>Done</strong>."],
          ["Open a remark to give it <strong>Suggestions</strong>: your school's ready-made remarks, one per line."],
          "Select <strong>Save</strong>.",
        ],
        note: "You can also start from <strong>Report settings</strong>: select <strong>+ Add remark</strong> at the top right of Report remarks and the Custom editor opens beside the page.",
      },
      {
        title: "How teachers write them",
        steps: [
          "With <strong>Beside each student</strong> on (it is on in Report remarks), teachers tap the remark icon beside the student on the class page.",
          "They tap a suggestion or type, then save.",
        ],
        note: "Remarks written the old way still print until a form answer replaces them.",
      },
      {
        title: "Add another form to the report card",
        text: "Use this for things you grade every term, like effort, behavior or work habits.",
        steps: [
          "Create a section whose <strong>Place</strong> is <strong>Classroom</strong> and that is collected <strong>Every term</strong>. <em>Skills &amp; effort</em> in the library is ready-made.",
          "Open <strong>More</strong> and check <strong>On report card</strong> under <strong>Report card</strong>. Save.",
          "Teachers fill it in for each student on the class's <strong>Forms</strong> tab.",
          "Generate report cards as usual. Each student's answers for the term print under the section's name.",
        ],
        list: [
          "A typed field can print as a remark: open the field and choose <strong>Prints as</strong>, then the remark. The answer prints in that remark's usual place. Each remark can come from one field.",
          "To leave a form off the report cards, uncheck it in <strong>Report settings › Advanced</strong>. See " + link("report-settings", "Report settings") + ".",
          "On your own " + link("report-card-templates", "report card template") + ", add the field <code>{{forms.all}}</code> where the answers should print.",
        ],
      },
    ],
    faq: [
      ["Where did the old remark pencil go?", "Teachers keep it until <strong>Beside each student</strong> is on for Report remarks. After that they write remarks from the Students list."],
      ["Where do I add a Head Teacher's remark?", "In the Custom editor on Report remarks, select <strong>Add remark</strong>. Report settings has a <strong>+ Add remark</strong> link to the same place."],
    ],
    related: ["custom-editor", "report-card", "report-settings", "report-card-templates"],
  },
];
