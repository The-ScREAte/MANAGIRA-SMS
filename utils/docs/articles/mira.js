"use strict";

// Mira AI assistant: what it is, how it keeps data safe, and what it can do.
module.exports = [
  {
    slug: "mira-ai-assistant",
    title: "Mira, your AI assistant",
    topic: "Mira AI assistant",
    order: 1,
    summary: "Ask Mira in plain words and it does the work in Managira, from finding students to building reports, always within your own permissions.",
    tags: ["mira", "ai assistant", "artificial intelligence", "school ai", "automation", "chat"],
    featured: true,
    who: "Staff: teachers, drivers, managers and every other employee, once your school turns Mira on in Integrations. Parents and students don't use Mira.",
    intro: "Mira is built into Managira. It isn't a general chatbot: it works on your school's real data, through the same pages and checks you use, so it can only do what you're allowed to do.",
    sections: [
      {
        title: "Ask Mira",
        steps: [
          ["Select the <strong>Mira</strong> button in the header. If you're not signed in to Mira, you sign in through Managira's own page.", "mira.webp", "Mira: ask in plain words; Mira shows what it found and what it did."],
          "Type what you need, as you'd ask a colleague. For example: <em>How many 8th graders were absent this week?</em>",
          "Mira finds the answer or does the work, and shows you what it did.",
        ],
        example: "<em>Post an announcement for families: school closes at noon on Friday for teacher training.</em> Mira writes it, shows it to you, and posts it once you agree.",
      },
      {
        title: "How Mira keeps your school's data safe",
        list: [
          "<strong>Your permissions, nothing more.</strong> Mira checks every action against your own permissions. If you can't do something on the page, Mira can't do it for you, and it says which permission is missing.",
          "<strong>Your school only.</strong> Mira works inside your own school.",
          "<strong>Real numbers only.</strong> Mira states only figures that came from your school's records. It doesn't guess totals.",
          "<strong>Nothing deleted by surprise.</strong> Mira only offers to delete, remove or undo something when you ask for it, and asks you to confirm first. Something that can't be undone needs its name typed.",
          "<strong>Nothing attached is lost.</strong> Mira won't delete a class, term, school year, enrollment, subject, bus, route, stop or document that still has records attached. It tells you exactly what's attached and asks what you want. Only if you ask it to remove what's attached too does it go further, warning you and showing every record that would go.",
          "<strong>Big messages need a typed confirm.</strong> A message to more than 500 families shows how many it reaches, and you type that number to send it.",
          "<strong>Checked answers.</strong> Before you see a reply, Mira checks its names, figures, dates and claims like \"all fees are paid\" against your school's records. If something can't be confirmed, Mira shows you the records instead of guessing.",
          "<strong>Checked changes.</strong> After a change, Mira looks the record up again and says it's done only when the record shows it.",
          "<strong>Everything is recorded.</strong> Changes Mira makes appear in your school's activity log, marked as done by Mira.",
        ],
      },
      {
        title: "Turn Mira on",
        text: "A manager activates <strong>Mira (AI Assistant)</strong> in <strong>Management</strong>, <strong>Integrations</strong>. Staff also need the <strong>Use Mira (AI Assistant)</strong> permission.",
      },
    ],
    faq: [
      ["Is Mira the same as the chat bubble on the website?", "No. The chat on the website and help center answers questions about Managira for anyone. Mira works inside your school's Managira, for signed-in staff."],
      ["Does Mira sign out with me?", "Yes. Logging out of Mira signs you out of Managira too, and Mira follows your school's sign-in rules."],
      ["Can Mira make mistakes?", "Mira shows you what it found and what it changed, and asks before anything that can't be undone. Check its work the way you'd check a colleague's."],
    ],
    related: ["mira-ai-capabilities", "roles-and-permissions", "report-builder"],
  },
  {
    slug: "mira-ai-capabilities",
    title: "What Mira can do",
    topic: "Mira AI assistant",
    order: 2,
    summary: "Examples of what to ask Mira across students, classes, attendance, grades, report cards, Report Builder, families, transportation, the website and documents.",
    tags: ["mira", "ai assistant", "examples", "prompts", "report builder", "automation"],
    who: "Staff with Mira, each within their own permissions.",
    intro: "Mira can do most things you can do in Managira. Here's what you can ask, area by area. Each works only if your permissions allow it.",
    sections: [
      {
        title: "Open Mira",
        text: "Select <strong>Mira</strong> in the header, or <strong>Mira (AI Assistant)</strong> in Management, and type your request.",
        image: "mira.webp",
        caption: "Mira in Management: what it can do for your school.",
      },
      {
        title: "Students and admissions",
        list: [
          "<em>Find Emma Johnson and show her parents' phone numbers.</em>",
          "<em>Add these three new students to 6th Grade</em> (Mira checks for duplicates first).",
          "<em>Show this week's online applications</em>, then <em>approve the one from the Carter family</em>.",
          "<em>Which students are below 90% attendance this month? Draft a message to each family.</em>",
        ],
      },
      {
        title: "Classes, terms and promotion",
        list: [
          "<em>Create the 2027–2028 school year with Fall and Spring semesters.</em>",
          "<em>Add Spanish and assign it to 6th, 7th and 8th Grade.</em>",
          "<em>Preview end-of-year promotion for 8th Grade</em>, then <em>schedule it for June 15</em>.",
        ],
      },
      {
        title: "Assessments, grades and reports",
        list: [
          "<em>Create a Unit 4 Test for 7th Grade Science, worth 20%, out of 50.</em>",
          "<em>Show me attempts waiting to be graded</em>, then grade them with you.",
          "<em>Make the report cards for 5th Grade this semester and email them to parents.</em>",
          "<em>Build the merit sheet for 8th Grade's semester exams.</em>",
          "<em>Write a teacher remark for each 5th Grade student who missed four or more days this term, based on their attendance.</em> (You see every remark before it's saved.)",
          "<em>Put the Head Teacher's signature on Grade 5's report cards and the Deputy's on Grade 6.</em>",
          "<em>Which students still have no remarks on their report card?</em>",
        ],
      },
      {
        title: "Report Builder",
        text: "Ask for any Report Builder report in plain words, and Mira runs it with the right filters and columns:",
        list: [
          "<em>List 9th graders who missed more than five days in October.</em>",
          "<em>Which families still owe more than $100?</em>",
          "<em>Show every bus trip on the Northside route last week.</em>",
          "<em>Export the staff list with emails to Excel.</em>",
        ],
      },
      {
        title: "Families and messages",
        list: [
          "<em>Draft a friendly reminder about picture day for 3rd Grade families.</em>",
          "<em>Send it by text</em> (Mira asks you to confirm before anything is sent).",
          "<em>Email every parent that the school closes early on Friday.</em> (A message to the whole school shows how many families it reaches, and you type that number to send it.)",
          "<em>Which parents in 5th Grade haven't accepted their parent portal invitation?</em>",
          "<em>Which emails failed to send this week?</em>",
        ],
      },
      {
        title: "Events, activities and calendar",
        list: [
          "<em>Add a field trip to the science museum for 4th Grade on May 12, with a reminder to families.</em>",
          "<em>Post the winter concert on December 10 for families and the website.</em>",
          "<em>What's on my calendar this week?</em>",
        ],
      },
      {
        title: "Transportation",
        list: [
          "<em>Which students are riding bus 4 today?</em>",
          "<em>Where is the Northside bus right now?</em>",
          "<em>Assign Liam Carter to the Maple Street stop.</em>",
        ],
      },
      {
        title: "Website, school settings and documents",
        list: [
          "<em>Switch our website to the Prism design.</em>",
          "<em>Write a news article about our robotics team winning regionals.</em>",
          "<em>Turn on automatic student IDs starting at RA-1000.</em>",
          "<em>Create a sign-up sheet for parent volunteers and share it with the office.</em>",
        ],
      },
    ],
    faq: [
      ["What can't Mira do?", "Anything your own permissions don't allow, and anything outside your school. It also won't delete or undo things unless you ask, and it confirms first."],
      ["What's new in Mira?", "Ask Mira <em>What's new?</em> for the newest things it can help with at your school."],
    ],
    related: ["mira-ai-assistant", "report-builder", "roles-and-permissions"],
  },
  {
    slug: "mira-skills",
    title: "Mira skills: teach Mira how you like things done",
    topic: "Mira AI assistant",
    order: 3,
    summary: "Save a playbook once, such as how you word a family message, and Mira follows it every time it fits. Personal skills, school skills and a ready-made library.",
    tags: ["mira skills", "playbook", "templates", "family messages", "report card comments", "lesson plans", "school skills", "automatic skills"],
    who: "Every member of staff who uses Mira can keep personal skills. School skills are made by managers, or by anyone a manager gives <strong>Manage Mira's school skills</strong>. Your school needs Mira skills turned on.",
    intro: "A skill is a set of instructions Mira follows, like a standing brief: your school's tone for family messages, how you structure a lesson plan, or what a behavior write-up must include. Skills shape <em>how</em> Mira writes and works. They never change what Mira is allowed to see or do, and every change still waits for your confirmation.",
    sections: [
      {
        title: "Two kinds of skill",
        table: [
          ["Kind", "Who it applies to", "Who can make it"],
          ["<strong>Personal</strong>", "Only you. Nobody else sees or changes it.", "Any member of staff who uses Mira."],
          ["<strong>School</strong>", "Everyone at the school. A school skill wins when it disagrees with a personal one.", "Managers, and anyone a manager gave <strong>Manage Mira's school skills</strong>."],
        ],
      },
      {
        title: "Choose when a skill is used",
        list: [
          "<strong>Automatic</strong>: Mira applies it when your request matches its name, its <em>When should Mira use it?</em> line or its trigger words.",
          "<strong>In every chat</strong>: always applied.",
          "<strong>Only when picked</strong>: applied when you choose it with the star in the message box.",
        ],
        note: "Mira applies at most 5 skills to a reply and shows <em>Following skills: …</em> above the answer, so you can see what it followed. A follow-up such as <em>make them shorter</em> keeps the skills of the reply before it.",
      },
      {
        title: "Make a skill",
        steps: [
          "Open Mira and choose <strong>Skills</strong>.",
          "Start from the <strong>Library</strong>, or choose <strong>New skill</strong>. The library is written for school work: family messages, attendance follow-up, report card comments, lesson plans, behavior write-ups, IEP and 504 care, missing work, class newsletters, leadership data, bus notices, admissions replies, substitute plans and bilingual messages. A template opens in the editor first, so you can adjust it before saving.",
          "Give it a name, say when Mira should use it, and write the instructions. Choose <strong>Personal</strong> or, if you may, <strong>School</strong>.",
          "Save. Changes apply to your next message.",
        ],
      },
      {
        title: "What a skill can't do",
        list: [
          "It can't give Mira access you don't have. Mira always works with your own permissions.",
          "It can't skip a confirmation. Anything that changes records or reaches people still shows a preview that you confirm.",
          "It can't change how Mira handles figures: Mira still states only what your school's records show.",
        ],
      },
    ],
    faq: [
      ["Why didn't Mira use my skill?", "Check its <em>When should Mira use it?</em> line and trigger words, or set it to <strong>In every chat</strong>. Skills set to <strong>Only when picked</strong> need the star."],
      ["Who can see my personal skills?", "Only you."],
      ["Who can make school skills?", "Managers, the school's own account, and anyone a manager gave <strong>Manage Mira's school skills</strong> to on the staff form or the Mira page. Mira Settings alone is not enough."],
    ],
    related: ["mira-ai-assistant", "mira-ai-capabilities", "roles-and-permissions"],
  },
];
