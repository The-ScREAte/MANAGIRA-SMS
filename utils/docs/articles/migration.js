"use strict";

// Moving to Managira from another student information system: what a school can expect, what
// it prepares, and who does what. The basics only, for schools and their staff; the Managira
// team handles the rest with each school (never how the move works inside).
const link = (slug, text) => `<a href="/legal/user-documentation/${slug}">${text}</a>`;
const CONTACT = "Email <a href=\"mailto:support@managira.com\">support@managira.com</a>, use <a href=\"/legal/help\">Contact support</a> in the Help Center, or open the chat at the bottom right of any page. Say your school's name and that your question is about your move to Managira.";

module.exports = [
  {
    slug: "moving-to-managira",
    title: "Moving your school to Managira",
    topic: "Moving to Managira",
    order: 1,
    summary: "How a move from your current system works: who does what, what comes across, how to ask for it, what to expect while it runs, and who to contact.",
    tags: ["data migration", "migration", "how data migration works", "move to managira", "move our data", "move data from powerschool", "switch from powerschool", "powerschool", "import data", "moving data", "onboarding", "transfer records", "switching systems", "migration contact", "request a migration", "migration request", "request your move", "existing records", "duplicates", "replace existing records", "overwrite our data", "keep existing data", "already in managira"],
    featured: true,
    who: "School leaders planning a move, and your school's managers. Only managers see <strong>Data migration</strong> in Management.",
    intro: "When your school moves to Managira from another student information system, such as PowerSchool, your records come with you. The Managira team works with you from start to finish, and nothing reaches your live account until you've checked it and approved it.",
    sections: [
      {
        title: "How a move works",
        steps: [
          "<strong>Ask for your move.</strong> A manager sends a short request. See the next section.",
          "<strong>Plan it together.</strong> The Managira team emails you within two business days. You choose when to move. A quiet week, a weekend or a break works best.",
          "<strong>Your move opens.</strong> The team opens it for your school and emails your managers. From then on, the managers work through it with the team. See " + link("work-through-your-data-migration", "Work through your data migration") + ".",
          "<strong>Send your files.</strong> You export lists from your current system and upload them as they are. See " + link("prepare-your-data-for-the-move", "Prepare your data for the move") + ".",
          "<strong>Check together.</strong> Your managers look over what came across and approve it. The team answers questions along the way.",
          "<strong>Go live.</strong> Your records move into your Managira account and your school starts working in it.",
          "<strong>Catch up.</strong> Anything entered in your old system since, such as the last grades or attendance, can be brought across once more.",
        ],
        note: "Your managers get an email at each stage: when your request arrives, when your move opens, when questions are answered and when you're live.",
      },
      {
        title: "Ask for your move",
        text: "Before your move opens, <strong>Data migration</strong> in Management shows a request form. Only managers see it.",
        steps: [
          ["Go to <strong>Management</strong> and select <strong>Data migration</strong>.", "setup-migration-request.webp", "Management › Data migration, before a move is open."],
          ["In the menu on the left, <strong>Data migration</strong> is under the other Management tools."],
          ["Under <strong>Your current system</strong>, type the system you use now and about how many students and staff you have."],
          ["Under <strong>What you'd like to bring</strong>, leave the boxes checked for what you want: <strong>Students</strong>, <strong>Parents &amp; guardians</strong>, <strong>Staff</strong>, <strong>Classes &amp; teachers</strong>, <strong>Final grades &amp; transcripts</strong> and <strong>Attendance</strong>."],
          "Under <strong>When</strong>, choose a <strong>Timing</strong>: <em>As soon as possible</em>, <em>Within a month</em>, <em>Over a school break</em> or <em>On a date</em>. Pick a <strong>Date</strong> if you chose a date.",
          "Under <strong>Who we should contact</strong>, check the <strong>Name</strong> and <strong>Email</strong> (they start with yours) and add a <strong>Phone</strong> if you like. Use <strong>Anything we should know</strong> for other schools in your district, records you'd like to leave behind or a deadline.",
          ["Select <strong>Send request</strong>."],
        ],
        note: "The page then says <em>We have your request</em>. You can use <strong>Withdraw request</strong> there to take it back. If the team can't start a request, the page shows their note and you can send a new one.",
      },
      {
        title: "Records you already have in Managira",
        list: [
          "Nothing already in Managira is replaced. A student, parent or staff member who is already there keeps everything they have. Only empty details are filled in from your files.",
          "Where Managira isn't sure that two records are the same person, you decide before anything goes live.",
          "Staff who already have an account keep their access. Parents with the same email stay one person, linked to each of their children.",
          "Names typed all in capitals, phone numbers and emails are tidied as they come in.",
        ],
      },
      {
        title: "What comes across",
        table: [
          ["Your records", "In Managira"],
          ["Students", "Each student's record, in their class and enrolled in the current term."],
          ["Parents &amp; guardians", "Linked to their children, ready for the parent portal."],
          ["Staff", "An account each, with the role that matches their old one. Nobody gets more access than before without your approval. Staff can't sign in until you invite them."],
          ["Classes, sections and teachers", "Each course becomes a subject of its class, with its teachers. Homeroom teachers are put in charge of their class."],
          ["Final grades and transcripts", "Each student's past courses, grades and credits. Their GPA from your old system is kept exactly as it was and printed on their transcript."],
          ["Attendance", "Days present and absent for each term, which count on report cards."],
          ["Custody and pickup notes", "An alert at the top of the student's record that every staff member who opens it sees."],
          ["Anything else", "A field of its own, a labeled detail on the record, or a read-only page on the student's record, as you agree with the Managira team."],
        ],
        tip: "Social Security numbers are never brought across unless your school tells us there's a legal need to keep them.",
      },
      {
        title: "While your move is open",
        list: [
          "Everyone can still sign in and look around. New records can't be saved in your live account while your move is open, so nothing is entered twice. Plan the move for a time your staff can pause.",
          "A thin line along the top of Managira tells your staff that a move is open.",
          "Managers can turn the move off and on from the menu (☰) at the top right, under <strong>Sandbox</strong>.",
        ],
      },
      {
        title: "Who does what",
        table: [
          ["Your school", "The Managira team"],
          ["Chooses when to move.", "Opens your move and stays with you until you're live."],
          ["Exports its lists and uploads them, unchanged.", "Answers questions and finds a home for anything Managira doesn't have yet."],
          ["Checks what came across and approves it.", "Makes sure staff roles never give more access than before."],
          ["Signs off and invites staff.", "Closes the move down once you're live."],
        ],
        note: "Checking is the most important step. Open a few students, parents and staff you know well, in your old system and in Managira, and make sure they match. Once you approve and go live, what you approved is what your account holds.",
      },
      {
        title: "Keeping your data safe",
        list: [
          "Only your school's managers open the migration. You may be asked for your password again, and for a code from an authenticator app. See " + link("authenticator-codes", "Authenticator codes") + ".",
          "Your exports are kept only as long as the move needs them.",
          "Health, special education, discipline and other sensitive details stay restricted to your school's managers.",
          "Every step is recorded: who did what, and when.",
        ],
      },
      {
        title: "Who to contact",
        text: CONTACT,
        tip: "If something doesn't look right after you go live, tell us within 30 days. That's when it is easiest to put right.",
      },
    ],
    faq: [
      ["How do we start?", "A manager goes to Management, then Data migration, and sends the request form. Only managers see it. The Managira team replies within two business days."],
      ["We already entered some students in Managira. Will they be doubled?", "No. They are kept as they are and only empty details are filled in. Anyone Managira isn't sure about is shown to you to decide before you go live."],
      ["How long does a move take?", "Uploading takes minutes. Most of the time goes on checking, so how quickly your team reviews and answers questions decides the rest."],
      ["Can we keep working while we move?", "Everyone can sign in and look, but your live account takes no new records while the move is open. That's why a quiet week or a break is the best time."],
      ["Can we try it more than once?", "Yes. You can upload your files again as often as you like before you approve. Records are updated, not doubled."],
      ["What if our system isn't PowerSchool?", "Contact the Managira team. Most systems export the same lists as spreadsheets (CSV files)."],
      ["Do teachers and parents need to do anything?", "No. Your managers do the move. Afterwards you invite your staff, and parents join through the parent portal as usual."],
      ["I can't see Data migration in Management.", "Only managers see it. Ask your school's manager to send the request."],
    ],
    related: ["prepare-your-data-for-the-move", "work-through-your-data-migration", "authenticator-codes", "your-access"],
  },
  {
    slug: "prepare-your-data-for-the-move",
    title: "Prepare your data for the move",
    topic: "Moving to Managira",
    order: 2,
    summary: "The lists to export from your current system (PowerSchool or another) before your move, and how to keep them ready to upload.",
    tags: ["export", "powerschool export", "csv", "data export", "prepare migration", "migration files", "stored grades", "attendance export", "staff export", "what to export", "excel", "xlsx", "zip file", "file size", "upload limit", "large files", "file formats"],
    who: "Whoever exports reports from your current system, with your school's managers.",
    intro: "Before your move, export each list below from your current system as a spreadsheet: CSV, tab-separated text or Excel. You don't need every list. Bring what your school uses. If you're not sure how to export one, the Managira team can help.",
    sections: [
      {
        title: "The lists to export",
        table: [
          ["List", "What it holds", "Needed?"],
          ["<strong>Students</strong>", "Each student: their student number, name, date of birth, grade level, address and any other details you keep.", "Yes"],
          ["<strong>Parents &amp; contacts</strong>", "Each parent or guardian, their contact details and the student they belong to.", "Yes"],
          ["<strong>Staff</strong>", "Each member of staff: their staff number, name, email, title, their role or access group, their schools, and whether they're active.", "Yes"],
          ["<strong>Sections</strong>", "Your courses and sections, their teacher and grade level.", "If you use classes"],
          ["<strong>Class enrollments</strong>", "Which students are in which section.", "If sections have no grade level"],
          ["<strong>Class roles</strong>", "Each section's lead and co-teachers, with their dates.", "If you have co-teachers"],
          ["<strong>Stored grades</strong>", "Each student's final grades: course, grade, percent, credits and grade points, with honors or AP added value.", "For transcripts"],
          ["<strong>GPA</strong>", "Each student's GPA as your system worked it out (weighted and unweighted).", "For transcripts"],
          ["<strong>Attendance</strong>", "Each day's attendance with its code, or each term's days present and absent.", "If you track attendance"],
        ],
      },
      {
        title: "Keep the files as they are",
        list: [
          "Export straight from your system, with the column headings it gives. Don't rename or delete columns.",
          "Don't edit values to make them look tidy. Managira tidies names in capitals, phone numbers and emails itself.",
          "One list per file, or per sheet of an Excel workbook. Upload them together or one at a time. Uploading a list again replaces it.",
          "Keep each person's ID (student number, staff number) in the file. It's how a second upload updates records instead of adding them again.",
        ],
        tip: "Fix mistakes in your current system, then export again. The check report in Managira shows you what to fix.",
      },
      {
        title: "File types and sizes",
        table: [
          ["You can send", "Up to"],
          ["CSV files, tab-separated text (.txt, .tsv), Excel workbooks (.xlsx: each sheet is a list), or a .zip of any of these", "60 MB a file"],
          ["Any list", "200,000 rows"],
        ],
        list: [
          "A longer list, such as a whole year of daily attendance for a large school, can be split into parts (by date range or by grade) and sent together in one .zip. Or export attendance as each term's totals, which is much smaller.",
          "Older Excel files (.xls), PDFs and Word documents can't be read. Save the list as .xlsx or CSV.",
        ],
      },
      {
        title: "Before you export",
        list: [
          "Make sure each student has one record, with their correct date of birth and grade level.",
          "Make sure each member of staff has their own email address and the right role or access group, and that staff who have left are marked inactive.",
          "Set up your current school year and term in Managira first (Management, School years &amp; terms). Students are enrolled in it when you go live. See " + link("create-school-years-terms-and-set-the-current-term", "Create school years and terms") + ".",
        ],
      },
      {
        title: "Who to contact",
        text: CONTACT,
      },
    ],
    faq: [
      ["Do we export health or special education information?", "Only if your school wants it in Managira. If you do, it stays restricted to your school's managers."],
      ["Our staff list has no roles. Is that a problem?", "No. Managira matches each person from their title instead, and asks you about anything it isn't sure of."],
      ["A file was refused for having too many rows.", "A list can have up to 200,000 rows. Split it into parts and send them together in one .zip, or export attendance as each term's totals."],
    ],
    related: ["moving-to-managira", "work-through-your-data-migration"],
  },
  {
    slug: "work-through-your-data-migration",
    title: "Work through your data migration",
    topic: "Moving to Managira",
    order: 3,
    summary: "For school managers: the steps you take once the Managira team has opened your move, from uploading your files to going live and inviting staff.",
    tags: ["sandbox", "sandbox switch", "turn sandbox on", "turn sandbox off", "migration screens", "already in managira", "same student", "upload exports", "match columns", "check and import", "staff roles", "role report", "review and sign", "go live", "invite staff", "catch-up", "migration summary", "gpa check"],
    who: "Your school's managers, once the Managira team has opened your move. You may be asked for your password again, and for a code from an authenticator app.",
    intro: "When the team opens your move, you get an email. Turn on <strong>Sandbox</strong> in the menu (☰) at the top right of Managira, then open <strong>Management</strong>, then <strong>Data migration</strong>. The steps run in order across the top, and each opens once the one before is done. Nothing reaches your live account until you go live.",
    sections: [
      {
        title: "The steps",
        table: [
          ["Step", "What you do"],
          ["<strong>1. Upload</strong>", "Drop your export files on the page, or select it to choose them: CSV, text, Excel or a .zip. A bar shows the upload, then each file is listed with its rows."],
          ["<strong>2. Match columns</strong>", "Check that each column in your files is matched to the right place in Managira. Confirm or correct anything marked <em>Unsure</em>."],
          ["<strong>3. Columns to explain</strong>", "For any column Managira has no place for, say what it is and who uses it. The team finds it a home, and nothing is left out without your approval."],
          ["<strong>4. Check &amp; import</strong>", "Select <strong>Import into the sandbox</strong> and read the check report. Anything in red must be fixed in your current system, exported again and uploaded again. Amber is worth a look."],
          ["<strong>5. Staff roles</strong>", "Each old role is matched to a Managira role, never with more access than before. Confirm the matches, approve anyone whose access goes up, and download the role report."],
          ["<strong>6. Review &amp; sign</strong>", "Compare the counts with your files, decide on anyone who might be the same person, open a few records you know, approve each area, then type your full name and select <strong>Sign</strong>."],
          ["<strong>7. Go live</strong>", "Upload your latest files first, then select <strong>Go live</strong>. Afterwards, invite your staff and, once if you need it, load the catch-up."],
        ],
        note: "If anything still needs doing, Managira lists it under <em>Before you can sign</em>. You can upload and check again as often as you like before you sign.",
      },
      {
        title: "Once you're live",
        steps: [
          "Compare <em>Your files beside Managira</em> with what you expect.",
          "Under <strong>Staff accounts</strong>, invite your staff: check people or select <strong>Invite all</strong>. Each gets an email to set their password. When they first sign in, they see their role and what they can do. See " + link("your-access", "Your access") + ".",
          "If entries were made in your old system after your last upload, upload new files and select <strong>Load the catch-up</strong>, once.",
        ],
        warning: "Check your staff's roles on the Users page before you invite them. Nobody is made a manager without your approval.",
      },
      {
        title: "Who to contact",
        text: CONTACT,
      },
    ],
    faq: [
      ["Why can't I see Sandbox in my menu?", "Only your school's managers see it, and only once the Managira team has opened your move. Until then, Management, Data migration shows the request form."],
      ["Can staff still save while the sandbox is on?", "Everyone can sign in and look, but nothing new can be saved in your live account while it's on, so nothing is entered twice. A manager can turn it off from the menu at any time. What you uploaded is kept."],
      ["It asks for my code again.", "For your school's safety, the migration can ask for your password and a fresh authenticator code every 30 minutes."],
      ["I lost my phone.", "Type one of your recovery codes instead. If you have none left, contact Managira support to reset your authenticator."],
      ["Can I close the page while a step is running?", "Yes. Big steps carry on by themselves. Open Data migration again to see where it is."],
    ],
    related: ["moving-to-managira", "prepare-your-data-for-the-move", "authenticator-codes", "your-access"],
  },
];
