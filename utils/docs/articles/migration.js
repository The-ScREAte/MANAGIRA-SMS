"use strict";

// Moving to Managira from another student information system: what a school can expect, what
// it prepares, and how it works through the move in Managira. The basics only, for schools and
// their staff; the Managira team handles the rest with each school.
const link = (slug, text) => `<a href="/legal/user-documentation/${slug}">${text}</a>`;
const CONTACT = "Email <a href=\"mailto:support@managira.com\">support@managira.com</a>, use <a href=\"/legal/help\">Contact support</a> in the Help Center, or open the chat at the bottom right of any page. Say your school's name and that your question is about your move to Managira.";

module.exports = [
  {
    slug: "moving-to-managira",
    title: "Moving your school to Managira",
    topic: "Moving to Managira",
    order: 1,
    summary: "How a move from your current system works: who does what, what comes across, what to expect while it runs, and who to contact.",
    tags: ["data migration", "migration", "how data migration works", "move to managira", "move our data", "move data from powerschool", "switch from powerschool", "powerschool", "import data", "moving data", "onboarding", "transfer records", "switching systems", "migration contact", "request a migration", "migration request", "existing records", "duplicates", "replace existing records", "overwrite our data", "keep existing data", "already in managira"],
    featured: true,
    who: "School leaders planning a move, and the managers who will work through it. Only your school's managers see the migration screens.",
    intro: "When your school moves to Managira from another student information system, such as PowerSchool, your records come with you. The Managira team works with you from start to finish. You export your data, check it in a private copy of your school, and sign off. Only then does anything reach your live account.",
    sections: [
      {
        title: "How a move works",
        steps: [
          "<strong>Request your move.</strong> A manager opens <strong>Management</strong>, then <strong>Data migration</strong>, and sends the short request form: the system you use now, roughly how many students and staff, and when you'd like to move. Your managers get an email copy.",
          "<strong>Plan.</strong> The Managira team gets in touch within two business days. Together you choose when to move: a quiet week, a weekend or a break works best.",
          "<strong>Your sandbox opens.</strong> The Managira team opens a private copy of your school, the <strong>sandbox</strong>, and emails your managers. They find <strong>Sandbox</strong> in the menu (☰) at the top right of Managira and turn it on when they're ready. While it's on, nothing new can be saved in your live account, so nothing is entered twice.",
          "<strong>Export and upload.</strong> You export your lists from your current system and upload them, exactly as exported. See " + link("prepare-your-data-for-the-move", "Prepare your data for the move") + ".",
          "<strong>Check.</strong> Managira matches your information to its own and shows a check report: duplicates, missing details, dates that aren't dates. You fix anything marked in red in your export and upload it again, as often as you need.",
          "<strong>Explain what's different.</strong> Anything Managira doesn't have a place for comes to you with a few questions. The Managira team then gives each one a home. Nothing is left out without your approval.",
          "<strong>Review and sign.</strong> You compare the counts and grades with your current system, approve each area, check your staff's roles, and sign the migration summary.",
          "<strong>Go live.</strong> Your records move into your live account in one step, and your account opens for new work.",
          "<strong>Catch up.</strong> Anything entered in your old system since, such as last grades or attendance, comes across once more.",
        ],
        note: "While your sandbox is open, your live Managira account takes no new data, so nothing gets entered twice. Everyone can still sign in and look. Plan the move for a time your staff can pause. Your managers are emailed at each step: when the request arrives, when your sandbox opens, when questions are answered, when you sign and when you're live.",
      },
      {
        title: "Records you already have in Managira",
        list: [
          "Nothing already in Managira is replaced. A student, parent or staff member who is already there keeps everything they have; only empty details are filled in from your files.",
          "A student is recognized by their student number, or by the same name and date of birth. Someone who only might be the same, such as the same name with another date of birth, is shown to you to decide before you sign. So is anyone who appears twice in your files.",
          "Staff who already have an account keep their access. Parents with the same email are kept as one person, linked to each of their children.",
          "Names typed all in capitals, phone numbers and emails are tidied as they come in, so your records read the same way throughout.",
        ],
      },
      {
        title: "What comes across",
        table: [
          ["Your records", "In Managira"],
          ["Students", "Each student's record, in their class and enrolled in the current term."],
          ["Parents & guardians", "Linked to their children, ready for the parent portal."],
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
        title: "Who does what",
        table: [
          ["Your school", "The Managira team"],
          ["Chooses when to move.", "Opens your sandbox and stays with you until you're live."],
          ["Exports its lists and uploads them, unchanged.", "Matches your information to Managira and answers questions about it."],
          ["Fixes anything the check report marks in red, in its own export.", "Finds a home for anything Managira doesn't have yet."],
          ["Explains columns and roles Managira asks about.", "Checks staff roles never give more access than before."],
          ["Reviews the counts, grades and roles, approves each area and signs.", "Turns your sandbox off once you're live."],
        ],
        note: "Reviewing is the most important step. Open a few students, parents and staff you know well, in your old system and in the sandbox, and check they match. Once you sign and go live, what you approved is what your live account holds.",
      },
      {
        title: "Keeping your data safe",
        list: [
          "Only your school's managers open the migration. Each confirms it's them with their password and a code from an authenticator app. See " + link("authenticator-codes", "Authenticator codes") + ".",
          "Your exports are kept only as long as the move needs them, and deleted 30 days after you go live.",
          "Health, special education, discipline and other sensitive details stay restricted to your school's managers.",
          "Every step is recorded: who did what, and when.",
        ],
      },
      {
        title: "Who to contact",
        text: CONTACT,
        tip: "If something doesn't look right after you go live, tell us within 30 days. That's when the move can still be put right most easily.",
      },
    ],
    faq: [
      ["How do we start?", "A manager opens Management, then Data migration, and sends the request form. Only managers see it. The Managira team replies within two business days."],
      ["We already entered some students in Managira. Will they be doubled?", "No. They're recognized and kept as they are; only empty details are filled in. Anyone Managira isn't sure about is shown to you to decide before you sign."],
      ["How long does a move take?", "Most of the time goes on checking. Uploading and importing take minutes; how quickly your team reviews and answers questions decides the rest."],
      ["Can we keep working while we move?", "Everyone can sign in and look, but your live account takes no new data while the sandbox is open. That's why a quiet week or a break is the best time."],
      ["Can we try it more than once?", "Yes. Upload your files again and import again as often as you like before you sign. Records are updated, never doubled."],
      ["What if our system isn't PowerSchool?", "Contact the Managira team. Most systems export the same lists as spreadsheets (CSV files)."],
      ["Do teachers and parents need to do anything?", "No. Your managers do the move. Afterwards you invite your staff, and parents join through the parent portal as usual."],
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
    intro: "Before your move, export each list below from your current system as a spreadsheet: CSV, tab-separated text or Excel. You don't need every list: bring what your school uses. If you're not sure how to export one, the Managira team can help.",
    sections: [
      {
        title: "The lists to export",
        table: [
          ["List", "What it holds", "Needed?"],
          ["<strong>Students</strong>", "Each student: their student number, name, date of birth, grade level, address and any other details you keep.", "Yes"],
          ["<strong>Parents & contacts</strong>", "Each parent or guardian, their contact details and the student they belong to.", "Yes"],
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
          "Don't edit values to make them look tidy. Managira keeps your lists exactly as exported, so the import can always run again from them, and tidies names in capitals, phone numbers and emails itself as it reads them.",
          "One list per file, or per sheet of an Excel workbook. Upload them together or one at a time; uploading a list again replaces it.",
          "Keep each person's ID (student number, staff number) in the file: it's how a second import updates records instead of adding them again.",
        ],
        tip: "Fix mistakes in your current system, then export again. The check report in Managira shows you what to fix.",
      },
      {
        title: "File types and sizes",
        table: [
          ["You can send", "Up to"],
          ["CSV files, tab-separated text (.txt, .tsv), Excel workbooks (.xlsx: each sheet is a list), or a .zip of any of these", "60 MB a file, 20 files at a time"],
          ["Any list", "200,000 rows"],
        ],
        list: [
          "A longer list, such as a whole year of daily attendance for a large school, can be split into parts (by date range or by grade) and sent together in one .zip: the parts are read as one list. Or export attendance as each term's totals, which is much smaller.",
          "Older Excel files (.xls), PDFs and Word documents can't be read: save the list as .xlsx or CSV.",
          "Large files are read in the background. You can leave the page while they are, and Managira stays quick for everyone at your school and every other school.",
        ],
      },
      {
        title: "Before you export",
        list: [
          "Make sure each student has one record, with their correct date of birth and grade level.",
          "Make sure each member of staff has their own email address and the right role or access group, and that staff who have left are marked inactive.",
          "Set up your current school year and term in Managira first (Management, School years). Students are enrolled in it when you go live. See " + link("create-school-years-terms-and-set-the-current-term", "Create school years and terms") + ".",
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
    ],
    related: ["moving-to-managira", "work-through-your-data-migration"],
  },
  {
    slug: "work-through-your-data-migration",
    title: "Work through your data migration",
    topic: "Moving to Managira",
    order: 3,
    summary: "For school managers: upload your exports, check the matches and staff roles, review and sign, go live and invite your staff.",
    tags: ["sandbox", "sandbox switch", "turn sandbox on", "turn sandbox off", "migration screens", "already in managira", "same student", "upload exports", "match columns", "check and import", "staff roles", "role report", "review and sign", "go live", "invite staff", "catch-up", "migration summary", "gpa check"],
    who: "Your school's managers, once the Managira team has opened your sandbox. Each confirms it's them with their password and an authenticator code.",
    intro: "Once your sandbox is open, turn on <strong>Sandbox</strong> in the menu (☰) at the top right of Managira, then open <strong>Management</strong>, then <strong>Data migration</strong>. A thin line along the top shows everyone while it's on. The steps run left to right. Nothing reaches your live account until you go live.",
    sections: [
      {
        title: "1. Upload",
        steps: [
          "The first time, set up your authenticator app: scan the code, type the 6-digit code it shows, and save your recovery codes.",
          "Drop your export files on the page, or select it to choose them: CSV, text, Excel or a .zip. Managira works out what each list holds.",
          "Select <strong>Upload</strong>. A bar shows the upload, then Managira reads the files in the background and lists each one with its rows.",
        ],
      },
      {
        title: "2. Match columns",
        text: "Each column in your files is matched to its place in Managira: <strong>Confident</strong> matches are ready; <strong>Unsure</strong> ones need you to confirm or correct them. Columns with no place yet go to step 5.",
      },
      {
        title: "3. Check & import",
        steps: [
          "Select <strong>Import into the sandbox</strong>.",
          "Read the check report. <strong>Red</strong> must be fixed before you go live: fix it in your current system, export again, upload and import. <strong>Amber</strong> is worth a look.",
          "Import again whenever you like. Records are updated, never doubled.",
        ],
      },
      {
        title: "4. Staff roles",
        steps: [
          "Each role or access group in your staff list is matched to a Managira role. A match never gives more access than the old role did.",
          "Confirm the <strong>Unsure</strong> ones, or choose a more limited role.",
          "For a role nobody could match, say what it lets people do and who has it. The Managira team then matches it.",
          "Read the <strong>role report</strong>: everyone's old role, new role, classes and what they can do. Approve each person flagged because their access goes up or is admin-level. Download it as CSV or PDF to keep.",
        ],
      },
      {
        title: "5. Columns to explain",
        text: "For each column Managira has no place for, say what it is, who uses it, how often, and whether it's required. The Managira team gives it a home. If they suggest leaving one out, it stays until you approve that here.",
      },
      {
        title: "6. Review & sign",
        steps: [
          "Compare the counts with your files, and the credits from your grades.",
          "Under <strong>Already in Managira</strong>, see who is already in your account. For anyone listed as possibly the same student, choose <strong>Same student</strong> or <strong>A different student</strong>. Nothing already in Managira is replaced: only empty details are filled in.",
          "Read the <strong>GPA check</strong>: any student whose GPA from your old system doesn't match their grades is listed. Their old GPA is kept on their transcript either way, but a difference usually means grades missing from the export.",
          "Open a few records you know well and check them.",
          "Approve each area, including the role report.",
          "Type your full name and select <strong>Sign</strong>.",
        ],
        note: "If anything still needs doing, Managira lists it under <em>Before you can sign</em>.",
      },
      {
        title: "Large schools: the work runs in the background",
        list: [
          "Reading files, importing into the sandbox, going live and the catch-up each run in the background, with a progress bar at the top of the page. You can leave the page or close it: it carries on, and your managers are emailed when you're live.",
          "While one runs, other changes to the migration wait until it finishes, so nothing is done twice.",
          "Even a school of several thousand students imports in seconds and goes live in a few minutes, without slowing Managira down for anyone else.",
        ],
      },
      {
        title: "7. Go live",
        steps: [
          "Upload your latest exports first, so nothing entered since is missed.",
          "Select <strong>Go live</strong>. Your records move to your live account and it opens for new work.",
          "Compare <em>Your files beside Managira</em> with what you expect.",
          "Under <strong>Staff accounts</strong>, invite your staff: tick people or select <strong>Invite all</strong>. Each gets an email to set their password. When they first sign in, they see their role and what they can do. See " + link("your-access", "Your access") + ".",
          "Once, if you need it: upload new exports and select <strong>Load the catch-up</strong>.",
        ],
        warning: "Check your staff's roles on the Users page before you invite them. Nobody is made a manager without your approval.",
      },
      {
        title: "Who to contact",
        text: CONTACT,
      },
    ],
    faq: [
      ["Why can't I see Sandbox in my menu?", "Only your school's managers see it, and only once the Managira team has opened your sandbox. Until then, Management, Data migration shows the request form."],
      ["Can staff still save while the sandbox is on?", "Everyone can sign in and look, but nothing new can be saved while it's on, so nothing is entered twice. A manager can turn it off from the menu at any time; what you uploaded is kept."],
      ["It asks for my code again.", "For your school's safety, the migration asks for your password and a fresh authenticator code every 30 minutes."],
      ["I lost my phone.", "Type one of your recovery codes instead. If you have none left, contact Managira support to reset your authenticator."],
      ["Can I close the page while it imports or goes live?", "Yes. It runs in the background and carries on; open Data migration again to see where it is."],
      ["A file was refused for having too many rows.", "A list can have up to 200,000 rows. Split it into parts (by date or by grade) and send the parts together in one .zip, or export attendance as each term's totals."],
    ],
    related: ["moving-to-managira", "prepare-your-data-for-the-move", "authenticator-codes", "your-access"],
  },
];
