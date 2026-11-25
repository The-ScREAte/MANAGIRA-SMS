"use strict";

// Mira AI assistant: the panel and the page, confirmations, what Mira can do, who can use it, skills.
module.exports = [
  {
    slug: "mira-ai-assistant",
    title: "Ask Mira, your AI assistant",
    topic: "Mira AI assistant",
    order: 1,
    summary: "Open Mira from the header, ask in plain words, and confirm any change before it happens. Mira works only within your own permissions.",
    tags: ["mira", "ai assistant", "artificial intelligence", "chat", "confirm", "preview", "history", "side panel", "assistant"],
    featured: true,
    who: "Staff: teachers, drivers, managers and every other employee, once your school has turned Mira on and given them <strong>Use Mira (AI Assistant)</strong>. Parents and students do not use Mira.",
    intro: "Mira is built into Managira. It is not a general chatbot: it works on your school's records through the same checks the pages use, so it can do only what you are allowed to do.",
    sections: [
      {
        title: "Open Mira",
        steps: [
          ["Select the Mira button in the header, beside the help and bell icons."],
          ["Mira opens in a panel on the right and the page makes room for it. You can keep working on the page while you chat.", "mira-panel.webp", "Mira beside the dashboard."],
          ["Type what you need in <strong>Ask Mira anything</strong> and press Enter. The <strong>Find</strong>, <strong>Draft</strong>, <strong>Plan</strong> and <strong>Report</strong> buttons under the box start you off."],
        ],
        tip: "Hold Ctrl (Windows) or Cmd (Mac) while you select the Mira button to open the full page in a new tab.",
      },
      {
        title: "The panel's buttons",
        steps: [
          ["Along the top of the panel are the chat history (☰), <strong>Open in a new tab</strong> and <strong>Close</strong>."],
          ["Select the history button to see your earlier chats. <strong>New chat</strong> starts a fresh one, and <strong>Select</strong> lets you delete several. Open a chat to carry on where you stopped.", "mira-history-zoom.webp", "Chat history, newest first."],
          "<strong>Open in a new tab</strong> opens Mira's full page with the same conversation. The panel stays open as you move between Managira pages.",
        ],
        note: "Inside the message box are the paperclip (attach a text, PDF or Word file), the star (<a href=\"/legal/user-documentation/mira-skills\">use a skill</a>), <strong>Enhance</strong> (rewrites your draft more clearly without answering it; <strong>Undo</strong> puts your words back) and the microphone.",
      },
      {
        title: "Mira's full page",
        steps: [
          ["The full page has the same chat with the history list always on the left. Your name and the <strong>Skills</strong>, <strong>Settings</strong> and <strong>Log out</strong> choices sit at the bottom left.", "mira-full.webp", "Mira in its own tab."],
          "<strong>Log out</strong> in Mira signs you out of Managira too, and Mira follows your school's sign-in rules. If your sign-in has timed out, Mira sends you to Managira's own sign-in page, never its own password form.",
        ],
      },
      {
        title: "Changes wait for your OK",
        text: "When you ask Mira to change something, it shows a card with exactly what it will do. Nothing is changed until you say so.",
        steps: [
          ["Read the card. It names the action and says <strong>Waiting for your OK</strong>."],
          ["Select <strong>Confirm</strong> to go ahead, or <strong>Cancel</strong> to drop it. Replying <em>yes</em> to the one waiting also confirms it. If Mira prepared several changes, <strong>Confirm all</strong> confirms them together."],
          ["A high-risk change, such as deleting a class, also asks you to type its name before <strong>Confirm</strong> works."],
        ],
        list: [
          "A preview works once, for you only, and expires after 10 minutes.",
          "Mira does not delete, remove or undo anything unless you ask for it. It will not delete a class, term, subject, bus or student record that still has records attached. It tells you what is attached and asks what you want.",
          "A single action changes at most 200 records, and a message from Mira reaches at most 500 families.",
          "Everything Mira changes is in your school's activity log.",
        ],
      },
      {
        title: "What Mira will not do",
        list: [
          "Anything your own permissions do not allow. Mira says which permission is missing, or that your school's plan does not include it.",
          "Anything with money or billing, prices, plans, permissions, roles, sign-in, single sign-on, passwords, service accounts, API keys or integrations. Do those on their own pages.",
          "Delete a student.",
          "Anything outside your school.",
        ],
      },
      {
        title: "How Mira answers",
        list: [
          "<strong>It looks things up.</strong> Mira shows what it is doing, a step at a time, in a folded line above its answer. Open it to see the steps.",
          "<strong>Real figures only.</strong> Mira states only numbers that came from your school's records. Dates are checked too, and Mira is given your own date, time and time zone.",
          "<strong>How-to questions use the help guides.</strong> Ask <em>How do I add a bus route?</em> and Mira answers from the guides and links the one it used.",
          "<strong>It knows the page you have open.</strong> In the side panel, <em>this class</em> means the class page you are on.",
        ],
      },
    ],
    faq: [
      ["I don't see the Mira button.", "The button shows for staff only. Parents and students never see it."],
      ["The panel says Mira isn't turned on, or that I don't have access.", "See <a href=\"/legal/user-documentation/mira-turn-on-and-access\">Turn on Mira and choose who uses it</a>."],
      ["Is Mira the same as the chat bubble on the website?", "No. The website and help center chat answers questions about Managira for anyone. Mira works inside your school, for signed-in staff."],
      ["Can Mira make mistakes?", "It can. It shows you what it found and asks before it changes anything, so check its work the way you would a colleague's."],
      ["Why did Mira ask where something should go?", "Words like \"put the concert on the calendar\" could mean a school event, an announcement, an activity or only your own calendar, and each has a different audience. Mira asks, listing who sees each one."],
    ],
    related: ["mira-ai-capabilities", "mira-turn-on-and-access", "mira-skills", "roles-and-permissions"],
  },
  {
    slug: "mira-ai-capabilities",
    title: "What Mira can do",
    topic: "Mira AI assistant",
    order: 2,
    summary: "Examples of what to ask Mira across students, classes, attendance, forms, report cards, reports, families, your calendar and transportation.",
    tags: ["mira", "ai assistant", "examples", "prompts", "report builder", "automation", "calendar", "forms"],
    who: "Staff who can use Mira, each within their own permissions.",
    intro: "Ask in your own words. Mira can do much of what you can do in Managira, and only that. The examples below show the kinds of request it handles. Which ones work for you depends on your permissions.",
    sections: [
      {
        title: "Start a chat",
        steps: [
          ["Open Mira from the header."],
          ["Type your request. The <strong>Find</strong> and <strong>Draft</strong> buttons give you a starting phrase.", "mira-panel-chips-zoom.webp", "Starter buttons under the message box."],
        ],
      },
      {
        title: "Look things up",
        list: [
          "<em>Find Audrey Diaz and show her class and her parents' phone numbers.</em>",
          "<em>Which 6th Grade students were absent this week?</em>",
          "<em>Which students are on Bus 12 today?</em>",
          "<em>Which students in Grade 6 ride the bus and owe fees?</em> Mira checks every condition together, each under its own permission, and refuses the whole question if you cannot check one of them.",
          "<em>Which classes have report cards still to post, and how many scores are missing?</em>",
        ],
      },
      {
        title: "Forms and requests",
        list: [
          "<em>Who hasn't returned the field trip permission slip in Grade 4?</em> Mira counts over the whole class or grade and names the classes it used.",
          "<em>Remind the families who still owe it.</em> Mira shows who it will remind and waits for your OK.",
        ],
      },
      {
        title: "Your calendar",
        list: [
          "<em>What's on my calendar this week?</em>",
          "<em>Find a free 30 minutes on Thursday afternoon.</em>",
          "<em>Put a parent meeting with the Robinson family on my calendar Thursday at 2:00.</em> It goes on your own calendar only.",
        ],
      },
      {
        title: "Events, announcements and messages",
        list: [
          "<em>Add the Fall Concert on December 10 as a school event.</em>",
          "<em>Post an announcement that school closes at noon on Friday.</em>",
          "<em>Draft a note to Grade 3 families about picture day.</em> Mira writes the draft. You decide whether and how it goes out.",
        ],
        note: "When your words do not say whether something is a school event, an announcement, an activity or a note on your own calendar, Mira asks first.",
      },
      {
        title: "Classes, report cards and reports",
        list: [
          "<em>Which students still have no remark on their report card?</em>",
          "<em>Put the Head Teacher's signature on Grade 5's report cards.</em>",
          "<em>Build a report of 9th graders who missed more than five days in October.</em> Mira runs it the way Report Builder would.",
          "<em>Assign Liam Carter to the Maple Street stop.</em> The change is checked against your school's buses, routes and stops, and anything you did not ask to change stays as it was.",
        ],
      },
      {
        title: "How-to questions",
        list: [
          "<em>How do I add a bus route?</em> or <em>How do I turn on text messages?</em> Mira answers from Managira's help guides and links the one it used.",
        ],
      },
    ],
    faq: [
      ["What can't Mira do?", "See <a href=\"/legal/user-documentation/mira-ai-assistant\">Ask Mira</a>: nothing beyond your permissions, nothing with money, sign-in or integrations, and no deleting students."],
      ["Mira said it couldn't check something.", "It looks every figure and name up before it replies. If a lookup is not possible with your permissions, Mira says so instead of guessing."],
      ["Why does it say a permission is missing?", "Mira uses your own permissions. Ask a manager to add the permission to your staff record, or do the task on its page if someone else holds it."],
    ],
    related: ["mira-ai-assistant", "mira-skills", "report-builder"],
  },
  {
    slug: "mira-turn-on-and-access",
    title: "Turn on Mira and choose who uses it",
    topic: "Mira AI assistant",
    order: 3,
    summary: "Switch Mira on for your school in Integrations, choose who can open it in Management › Mira, and see what staff see when Mira is off or they lack access.",
    tags: ["mira", "turn on mira", "use mira", "access", "permissions", "mira settings", "trial", "who can use mira"],
    who: "Managers, and staff given <strong>Integrations</strong> (to turn Mira on) and <strong>Mira Settings</strong> (to choose who uses it).",
    intro: "Mira has two switches: one for the school, and one for each person. Both must be on before someone can use it.",
    sections: [
      {
        title: "1. Turn Mira on for the school",
        steps: [
          ["Go to <strong>Management › Integrations</strong> and open <strong>Mira (AI Assistant)</strong>."],
          "Select <strong>⋮</strong>, choose <strong>Activate</strong> and confirm with your own password.",
        ],
        text: "More about the cards on this page is in <a href=\"/legal/user-documentation/integrations\">Integrations</a>.",
      },
      {
        title: "2. Choose who can open Mira",
        steps: [
          ["Go to <strong>Management › Mira (AI Assistant)</strong>.", "mira-manage.webp", "Management, Mira: who can open Mira."],
          ["The top of the page shows whether Mira is <strong>Active</strong>, how many days of the free trial are left, and how many people have it (<strong>seats</strong>)."],
          ["In the <strong>Can open Mira</strong> column, switch Mira on or off for each person. It saves at once."],
        ],
        list: [
          "The switch is the same permission as <strong>Use Mira (AI Assistant)</strong> on the staff form. It does not change anything else a person can do.",
          "Mira still does only what that person's own permissions allow. Change those on the staff form in <strong>Users / Employees</strong>.",
          "Use <strong>Show more</strong> under the list for the rest of your staff.",
        ],
      },
      {
        title: "Who can write school skills",
        text: "Skills that apply to everyone are written by managers, and by staff a manager gives <strong>Org-wide skill creation</strong> (it sits under <strong>Use Mira (AI Assistant)</strong> on the staff form). <strong>Mira Settings</strong> alone is not enough. See <a href=\"/legal/user-documentation/mira-skills\">Mira skills</a>.",
      },
      {
        title: "What staff see when Mira is off",
        steps: [
          ["If the school has not turned Mira on, the Mira button still shows. It opens a note: <strong>Mira isn't turned on for</strong> your school. Someone who can turn it on sees <strong>Turn on Mira</strong>, which goes to Integrations.", "mira-off-zoom.webp", "Mira off, seen by a manager."],
          ["Everyone else is told to ask their school's manager."],
          ["If Mira is on but a person has no <strong>Use Mira</strong> switch, they see <strong>You don't have access to Mira yet</strong>. Managers who hold Mira Settings also get <strong>Manage Mira access</strong>."],
        ],
        tip: "After you give someone access, they can open the Mira button again right away. No new sign-in is needed.",
      },
    ],
    faq: [
      ["Does Mira cost extra?", "Mira is a paid add-on on some plans and included on others. The Mira page shows a free trial while one is running, and <strong>Billing & plan</strong> in Settings shows what applies to your school."],
      ["I switched Mira off. Is anything lost?", "No. Chats, skills and each person's access stay saved. Switch Mira back on and everyone has what they had."],
      ["Why can't I see the Mira page in Management?", "It needs the <strong>Mira Settings</strong> permission."],
      ["Can parents or students use Mira?", "No. Mira is for staff only."],
    ],
    related: ["mira-ai-assistant", "integrations", "mira-skills", "roles-and-permissions"],
  },
  {
    slug: "mira-skills",
    title: "Mira skills: teach Mira how you like things done",
    topic: "Mira AI assistant",
    order: 4,
    summary: "Save a playbook once, such as how you word a family message, and Mira follows it whenever it fits. Personal skills, school skills and a ready-made Library.",
    tags: ["mira skills", "playbook", "templates", "library", "family messages", "report card comments", "school skills", "automatic", "every chat", "when picked"],
    who: "Every member of staff who uses Mira can keep personal skills. School skills are written by managers, or by staff given <strong>Org-wide skill creation</strong>.",
    intro: "A skill is a standing brief Mira follows: your school's tone for family messages, how you like a lesson plan laid out, or what a behavior note must include. Skills change <em>how</em> Mira writes. They never change what it may see or do, and every change still waits for your confirmation.",
    sections: [
      {
        title: "Open your skills",
        steps: [
          ["In Mira, select your name at the bottom left."],
          ["Choose <strong>Skills</strong>."],
          ["The window has three tabs. <strong>Yours</strong> are only for you. <strong>School</strong> apply to everyone. <strong>Library</strong> is a set of ready-made skills.", "mira-skills-yours-zoom.webp", "Skills: Yours."],
        ],
      },
      {
        title: "Start from the Library",
        steps: [
          ["Open the <strong>Library</strong> tab. It is written for school work: family messages, attendance follow-up, report card comments, lesson plans, behavior write-ups, IEP and 504 care, missing work, class newsletters, leadership data, bus notices, admissions replies, substitute plans and bilingual messages.", "mira-skills-library-zoom.webp", "The Library, grouped by kind of work."],
          ["Select <strong>Add</strong> beside a skill. It opens in the editor first so you can change it. A manager sees <strong>Add for school</strong> as well.", "mira-skills-editor-zoom.webp", "A template in the editor."],
          ["Check the <strong>Name</strong>, the <strong>When to use it</strong> line and the <strong>Instructions</strong>, then select <strong>Save</strong>. Your next message uses it."],
        ],
        note: "To write one yourself, select <strong>New skill</strong> on the <strong>Yours</strong> or <strong>School</strong> tab.",
      },
      {
        title: "Choose when it is used",
        table: [
          ["Use it", "What happens"],
          ["<strong>Automatic</strong>", "Mira applies it when your request fits its name, its <strong>When to use it</strong> line or its trigger words."],
          ["<strong>Every chat</strong>", "Mira always applies it."],
          ["<strong>When picked</strong>", "Mira applies it only when you choose it with the star in the message box."],
        ],
      },
      {
        title: "Pick a skill for one message",
        steps: [
          ["Select the star beside the message box."],
          "Choose a skill under <strong>Use a skill</strong>. Each shows whether it is a School or Yours skill. <strong>Manage</strong> opens the Skills window.",
        ],
        list: [
          "Mira applies at most 5 skills to a reply, school skills first. If a school skill and one of yours disagree, the school's wins.",
          "A line above the answer says which skills it followed.",
          "A follow-up such as <em>make them shorter</em> keeps the skills of the reply before it.",
        ],
      },
      {
        title: "School skills, and turning skills off",
        steps: [
          ["Open the <strong>School</strong> tab. Everyone sees these skills. Only managers, and staff with <strong>Org-wide skill creation</strong>, can add or change them."],
          "Use the switch on a skill to turn it off without deleting it.",
        ],
      },
      {
        title: "What a skill can't do",
        list: [
          "Give Mira access you do not have.",
          "Skip a confirmation. Changes and messages still show a card to confirm.",
          "Change how Mira handles figures: it still states only what your records show.",
        ],
      },
    ],
    faq: [
      ["Why didn't Mira use my skill?", "Check its <strong>When to use it</strong> line and trigger words, or set it to <strong>Every chat</strong>. A skill set to <strong>When picked</strong> needs the star."],
      ["Who can see my personal skills?", "Only you. Nobody else can see or change them, managers included."],
      ["I can't add a School skill.", "That needs a manager, or <strong>Org-wide skill creation</strong> on your staff record. <strong>Mira Settings</strong> alone is not enough."],
      ["I don't see Skills in Mira.", "Skills are released school by school. If your Mira has no Skills choice, it is not on for your school yet."],
    ],
    related: ["mira-ai-assistant", "mira-turn-on-and-access", "mira-ai-capabilities"],
  },
];
