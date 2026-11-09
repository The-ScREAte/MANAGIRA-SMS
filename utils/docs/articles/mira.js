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
          "<strong>Nothing deleted by surprise.</strong> Mira only offers to delete, remove or undo something when you ask for it, and asks you to confirm first.",
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
];
