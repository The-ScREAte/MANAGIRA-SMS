"use strict";

// The Custom editor: a school's own forms, from building one to reading its answers, printing
// them on report cards and reporting on them. What parents and students do with a form is in
// the portal guides (portals.js); this guide is for the people who build and collect them.
const link = (slug, text) => `<a href="/legal/user-documentation/${slug}">${text}</a>`;

module.exports = [
  {
    slug: "custom-editor",
    title: "Custom editor: build your school's own forms",
    topic: "School setup",
    order: 6,
    summary: "Build your own forms: permission slips, lunch counts, seating charts, behavior logs. Choose who fills them in, how often, and where the answers go.",
    tags: ["custom editor", "custom forms", "forms", "permission slip", "consent form", "behavior log", "medical form", "survey", "sign-up", "sections", "fields", "lunch count", "seating chart", "student groups"],
    featured: true,
    who: "Managers, and staff given the <strong>Custom Editor</strong> permission, build forms. Teachers, parents, students and drivers fill in the ones made for them.",
    intro: "Use the Custom editor for anything your school records about students that Managira has no place for yet. You make a <strong>section</strong> (a form), choose where it lives, and add its fields. The answers come back to one place.",
    sections: [
      {
        title: "Open the Custom editor",
        steps: [
          ["Open <strong>Management</strong>, then <strong>Custom editor</strong>.", "custom-editor.webp", "Management, Custom editor: your sections, one per row."],
          "Each row is one section: its name, where it lives, its classes, how often it's collected and how many fields it has.",
          "Select a row to open it. On the right: <strong>Answers</strong>, <strong>Report</strong>, the eye to show or hide it, and arrows to move it.",
        ],
      },
      {
        title: "Create a section",
        steps: [
          "Select <strong>Create New Section</strong>.",
          ["Choose a ready school form, or <strong>Blank section</strong>.", "custom-editor-library.webp", "Start from a ready school form, or a blank section."],
          "Type its name.",
          "<strong>Lives in</strong>: choose who fills it in.",
          "<strong>Classes</strong>: <em>All classes</em>, or <em>Choose classes</em>.",
          "<strong>Collect</strong>: <em>Once</em>, or <em>Many times</em> and then how often.",
          ["Select <strong>Save</strong>.", "custom-editor-section.webp", "An open section: where it lives, its classes, how often it's collected, and its fields."],
        ],
        subsections: [
          {
            title: "Lives in",
            table: [
              ["Lives in", "Who fills it in", "Where they find it"],
              ["<strong>Classroom</strong>", "Teachers and office staff", "The class page, <strong>Forms</strong> tab"],
              ["<strong>Parent portal</strong>", "Parents", "Their child's page, <strong>Forms</strong> tile"],
              ["<strong>Student portal</strong>", "Students", "Their dashboard, <strong>Forms</strong> tile"],
              ["<strong>Driver portal</strong>", "Drivers, for students on their bus", "The driver app, <strong>Forms</strong> card"],
            ],
          },
          {
            title: "Collect",
            table: [
              ["Collect", "What it means", "Good for"],
              ["<strong>Once</strong>", "One answer per student.", "Photo consent, medical details"],
              ["<strong>Every day</strong>", "One answer per student each day.", "Lunch count"],
              ["<strong>Every week</strong>", "One answer per student each week.", "Lunch orders, weekly check-ins"],
              ["<strong>Every term</strong>", "One answer per student, asked again each term.", "Skills and effort, seating charts, groups"],
              ["<strong>Every year</strong>", "One answer per student, asked again each school year.", "Handbook and device agreements"],
              ["<strong>Any time</strong>", "A list that grows: add an entry whenever something happens.", "Behavior log, reading log, health office visits"],
            ],
            tip: "Tick <strong>Lock after it's sent</strong> for a form that must not change, such as a permission slip. Once sent it can't be edited, and it leaves the person's list.",
          },
        ],
        note: "A new section is <strong>Live</strong> as soon as you save. Switch <strong>Live</strong> off to keep working on it in private; it shows as <em>Hidden</em>.",
      },
      {
        title: "Add fields",
        steps: [
          "In the open section, select <strong>Add field</strong> and choose a type.",
          "Type the question. Add help text if it needs explaining.",
          "Tick <strong>Required</strong> if it must be answered.",
          "Select <strong>Add field</strong>. Drag fields to reorder them. Select one to change it.",
        ],
        table: [
          ["Type", "Use it for"],
          ["Text – single line, Text – multiple lines", "Names, notes and explanations"],
          ["Number, Date, Time", "Amounts, dates and times"],
          ["Yes / No", "A simple yes or no. Show it as words, or as a tick and a cross."],
          ["Dropdown list", "Pick one. Show it as a dropdown, as buttons with words, or as icons."],
          ["Checklist (pick several)", "Pick all that apply"],
          ["Rating (1–5)", "A score from 1 to 5"],
          ["Email, Phone, Link", "Contact details and web addresses"],
          ["File upload", "A photo or document, such as a doctor's note"],
          ["Signature", "The person types their name and ticks a box to sign"],
          ["Seat (seating chart)", "Where a student sits. Classroom sections only. It turns the section into a seating chart, with each student's photo and name, or names only."],
          ["Instructions", "Text to read. Nothing to answer."],
        ],
      },
      {
        title: "Show a field only when it's needed",
        steps: [
          "Select the field, then open <strong>More options</strong>.",
          ["Under <strong>Show this field</strong>, choose <em>Show</em> or <em>Hide</em>, the other field to watch, and the answer.", "custom-editor-field.webp", "A field that shows only when another answer calls for it."],
          "Select <strong>Done</strong>, then <strong>Save</strong>.",
        ],
        example: "Show <em>Which medication?</em> only when <em>Does your child take medication?</em> is <em>Yes</em>.",
        list: [
          "<strong>Width</strong>: <em>Half</em> puts two short fields side by side.",
          "<strong>Stop using this field</strong>: hides it from now on. Answers already given are kept.",
        ],
      },
      {
        title: "More options for a section",
        text: "Open <strong>More options</strong> at the bottom of a section. You only see the ones that fit where it lives.",
        table: [
          ["Option", "What it does"],
          ["<strong>Deadline</strong>", "Parent and student forms. The due date shows on the form."],
          ["<strong>Required</strong>", "Marks the form required. Families who haven't filled it in are reminded once, 2 days before the deadline."],
          ["<strong>Tell families by</strong>", "Parent forms. Families always get a notification. Tick <em>Email</em> to email them too. <em>Text message</em> and <em>WhatsApp</em> show when your school has them switched on in Integrations. Used when the form goes live and when you send a reminder."],
          ["<strong>When it's sent, tell</strong>", "Who gets a notification each time someone sends the form: the class's main teacher, the people who build forms, or both."],
          ["<strong>Who sees the answers</strong>", "The class's teachers always do. Tick <em>Parents</em> or <em>Students</em> to share a classroom or driver section with them. Tick <em>Keep it from teachers</em> for sensitive records, such as support plans: then only people who build forms can open it."],
          ["<strong>Attendance</strong>", "Classroom sections collected every day. Adds the section as a column on the attendance page."],
          ["<strong>Report card</strong>", "Prints each student's answers for the term on their report card."],
          ["<strong>Its own tile</strong>", "Gives the section its own place, by name: an item in Class Tools, a tile on the child's page or the student's dashboard, or a card on the driver's page. Without it, the section sits under <strong>Forms</strong>."],
          ["<strong>Notes</strong>", "A note for the people who build forms."],
        ],
      },
      {
        title: "Ready-made school forms",
        text: "Each one opens with its fields ready. Change anything before you save.",
        table: [
          ["Group", "Forms"],
          ["Report card", "Skills &amp; effort, Student reflection"],
          ["Health", "Medical &amp; allergies, Medication authorization, Immunization record, Health office visit"],
          ["Permissions", "Field trip permission, Photo &amp; media consent, Handbook acknowledgement, Device agreement"],
          ["Requests from parents", "Absence note, Early dismissal request, Meeting request"],
          ["Every day in class", "Lunch count, Seating chart, Student groups, Lunch order"],
          ["Classroom records", "Behavior log, Reading log, Support plan"],
          ["Sign-ups &amp; surveys", "Club &amp; sports sign-up, Volunteer sign-up, Family survey"],
        ],
        note: "Managira already keeps " + link("emergency-and-pickup-details", "emergency and pickup details") + ", " + link("mark-attendance-for-a-class", "attendance") + ", " + link("transportation-reports", "driver reports") + " and report card remarks (" + link("report-settings", "Report Settings") + "). Use those; the library leaves them out so nothing is recorded twice.",
      },
      {
        title: "Fill in a form in the classroom",
        steps: [
          ["Open the class, then <strong>Forms</strong> in Class Tools.", "class-forms.webp", "The class page, Forms tab: each student and whether the form is done."],
          "Choose a form. Each student shows <em>Done</em>, <em>Waiting</em> or <em>Not started</em>.",
          "Select a student, fill in the fields, and select <strong>Save</strong>.",
        ],
        list: [
          "<strong>Many times</strong> sections keep a list: add a new entry each time.",
          "<strong>Every term</strong> and <strong>Every year</strong> sections start from the student's last answers, so you only change what's different.",
          "A parent handed the form in on paper? Open the student and select <strong>Received on paper? Fill it in</strong>.",
        ],
        note: "Teachers see the forms for their own classes. They read what parents and students send, but can't change it.",
      },
      {
        title: "Lunch counts, seating charts and groups",
        text: "A section made only of tap-to-answer fields (Yes / No, dropdown, rating, seat) is quick: teachers answer for the whole class on one screen, with no window to open. The editor tells you when a section is quick.",
        list: [
          "<strong>Icons or words:</strong> in the field, choose <strong>Show as</strong>, <strong>Icons</strong>. Each choice gets an icon picked from its words (a fork and knife for <em>School lunch</em>, a bag for <em>Packed lunch</em>). Select an icon to change it, or choose <em>Words only</em>.",
          "<strong>One tap:</strong> the answer you tap lights up and the others fade. Tap it again to clear it.",
          "<strong>A count:</strong> a key above the list shows each answer and how many students have it, so the lunch count is ready for the kitchen.",
        ],
        subsections: [
          {
            title: "A lunch count, taken with attendance",
            steps: [
              "Create a section from <strong>Lunch count</strong> in the library (Classroom, Every day).",
              "In <strong>More options</strong>, keep <strong>Add it to the attendance page</strong> ticked.",
              ["Teachers take attendance as usual and tap each student's lunch in the column beside the name. The tapped icon lights up and saves at once; the heading counts each lunch.", "attendance-forms.webp", "The attendance page with a Lunch column for today."],
            ],
            tip: "Prefer parents to choose? Use <strong>Lunch order</strong>: it lives in the parent portal and comes back every week.",
          },
          {
            title: "A seating chart",
            steps: [
              "Create a section from <strong>Seating chart</strong> in the library. It has one field, of the type <em>Seat</em>.",
              ["In the class, open <strong>Seating chart</strong> in Class Tools. Each student shows with their photo, or their initials. Tap a student, then tap a seat.", "class-seating-chart.webp", "A seating chart: the front of the room at the top."],
              "Tap two seated students to swap them. <strong>+ Row</strong> and <strong>+ Column</strong> make the room bigger.",
            ],
          },
          {
            title: "Student groups",
            steps: [
              "Create a section from <strong>Student groups</strong> in the library and rename the groups (reading groups, project teams, houses).",
              "In the class, open the form and choose <strong>Groups</strong>. Tap a student, then the group to move them to.",
            ],
            note: "Any quick section with a dropdown can be shown as groups, and its <strong>List</strong> lets you answer for each student in the row.",
          },
        ],
      },
      {
        title: "Forms for parents, students and drivers",
        list: [
          "<strong>Parents</strong> open their child's page and select <strong>Forms</strong>. See " + link("parent-forms-and-portfolio", "Forms and your child's portfolio") + ".",
          "<strong>Students</strong> select <strong>Forms</strong> on their dashboard.",
          "<strong>Drivers</strong> find a <strong>Forms</strong> card in the driver app, for the students on their bus only.",
        ],
        note: "When a parent form goes live, its families get a notification. Tick <strong>Email them too</strong> before you save to send an email as well.",
      },
      {
        title: "Read the answers",
        steps: [
          ["In the Custom editor, open the section and select <strong>Answers</strong>.", "custom-editor-answers.webp", "Answers: who has filled it in, with Download and Send a reminder."],
          "Select a student to read what was sent.",
          "<strong>Download</strong> saves a spreadsheet (CSV): one row per answer with its day, and students who haven't answered marked <em>Not yet</em>.",
          "<strong>Report</strong> opens Report Builder on this form, with its fields already chosen as columns.",
          "<strong>Send a reminder</strong> (parent forms) sends a notification and an email to families who haven't filled it in. A family is reminded once a day at most.",
        ],
        note: "The class's main teacher gets a notification each time a parent, student or driver sends a form. Change who hears under <strong>More options</strong>, <strong>When it's sent, tell</strong>.",
      },
      {
        title: "Print answers on report cards",
        text: "Use this for things like effort, behavior, work habits or skills that you grade every term.",
        steps: [
          "Create a section that lives in <strong>Classroom</strong> and is collected <strong>Every term</strong>. <em>Skills &amp; effort</em> in the library is ready-made.",
          "Open <strong>More options</strong> and tick <strong>Show on report cards</strong>. Save.",
          "Teachers fill it in for each student on the class page, <strong>Forms</strong> tab.",
          ["Generate report cards as usual. Each student's answers for that term print under the section's name.", "report-card-forms.webp", "A report card with a Skills & effort section from the Custom editor."],
        ],
        list: [
          "To leave them off: open <strong>Reports</strong>, <strong>Report Settings</strong>, <strong>Advanced</strong>, and untick <strong>Custom editor sections</strong>.",
          "On your own " + link("report-card-templates", "report card template") + ", add the field <code>{{forms.all}}</code> where the answers should print.",
        ],
      },
      {
        title: "Report on answers in Report Builder",
        steps: [
          "The quick way: in the Custom editor, select <strong>Report</strong> on the section. Report Builder opens on that form with its fields as columns. Select <strong>Run</strong>.",
          "Or open <strong>Reports</strong>, <strong>Report Builder</strong>, choose <strong>Students</strong>, then <strong>Custom forms</strong>.",
          "Filter by <strong>Form</strong>, class, term or day.",
          "Choose columns. Every field of your forms is a column, listed under its form's name.",
          "Run it. Save, share or export it like any other report. See " + link("report-builder", "Report Builder") + ".",
        ],
      },
    ],
    faq: [
      ["How is this different from the fields in Admission Settings?", "Admission Settings adds details to the student's or parent's own record, asked when they join. The Custom editor is for forms you collect later, by class, term or event, each with its own list of answers."],
      ["Can I change a form after people have answered?", "Yes. Add or reword fields at any time. To retire a field, use Stop using this field: it is hidden from now on and the answers already given are kept."],
      ["A parent can't see a form.", "Check the section is Live, lives in Parent portal, and includes their child's class. A locked form leaves the list once it has been sent."],
      ["Who can see the answers?", "People who build forms see every answer. Teachers see their own classes, and drivers their own riders. Parents and students see what they sent, and what you choose to share. A protected section opens only for people who build forms."],
      ["Does a new term clear the answers?", "No. An Every term section starts a fresh answer each term. Earlier terms keep theirs, and you can still download or report on them. The same is true of each day and each week."],
      ["Can parents and teachers both fill in the same form?", "A form lives in one place. For a parent form, a teacher can enter an answer that came on paper. For a lunch count, choose Lunch count for teachers or Lunch order for parents."],
      ["Why don't I see Text message or WhatsApp?", "They show only when your school has that channel switched on in Settings, Integrations. Email and notifications are always there."],
      ["What happens when I remove a section?", "Its answers are removed with it. To keep the answers, switch Live off instead: the section is hidden and nothing is lost."],
      ["How many forms can a school have?", "Up to 200 sections, each with up to 80 fields."],
    ],
    related: ["class-page", "report-card", "report-builder", "admission-settings", "emergency-and-pickup-details", "parent-forms-and-portfolio"],
  },
];
