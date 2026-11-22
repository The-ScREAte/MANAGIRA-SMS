"use strict";

// Communication: the Mail Room, WhatsApp Business, and the emails Managira sends.
module.exports = [
  {
    slug: "mailroom-send-sms-whatsapp-and-email-to-guardians",
    title: "Mail Room: message families by email, text or WhatsApp",
    topic: "Communication",
    order: 1,
    summary: "Message one family, a class or the whole school by email, text or WhatsApp, answer replies in one inbox, and check what was delivered.",
    tags: ["mail room", "mailroom", "message parents", "text parents", "whatsapp", "email parents", "school communication"],
    featured: true,
    who: "Managers, and staff given the <strong>Mailroom</strong> permission. A manager chooses whether each person may message every family or only the families of chosen classes.",
    intro: "The Mail Room is where staff message families. Email is always available; text messages and WhatsApp appear once your school connects them in Integrations. Each family receives the message on the channel you choose, from your school.",
    sections: [
      {
        title: "Send a message",
        steps: [
          ["Open the Mail Room from the menu, or <strong>Send a message</strong> in your dashboard's quick actions.", "mailroom.webp", "The Mail Room: choose who, choose how, write, send."],
          "Choose who it's for: one or more families, a class, or everyone you're allowed to message.",
          "Choose the channel: <strong>Email</strong>, <strong>Text</strong> or <strong>WhatsApp</strong>.",
          "Write the message, check the preview, and select send. You'll be asked to confirm your password, so messages to families are never sent by mistake.",
        ],
        example: "\"Early dismissal at 12:30 PM on Wednesday for parent-teacher conferences.\" Sent by text to every 6th–8th grade family in two minutes.",
      },
      {
        title: "Replies and delivery",
        list: [
          "Parents' replies come into the Mail Room's inbox, so the conversation stays in one place.",
          "The delivery history shows each message and whether it reached each family. A family with no mobile number or email for that channel is listed, so you can follow up another way.",
          "Emails that bounce are listed in <strong>Management</strong>, <strong>Email Issues</strong> for a manager to fix.",
        ],
      },
      {
        title: "Who each person can message",
        text: "When a manager ticks <strong>Mailroom</strong> for a staff member in <strong>Users / Employees</strong>, they choose a contact scope: <strong>all contacts</strong>, or <strong>only guardians of students in selected classes</strong>. A homeroom teacher, for example, can be limited to their own class's families.",
      },
    ],
    faq: [
      ["Why can't I choose Text or WhatsApp?", "They appear once your school connects them in Management, Integrations. See <a href=\"/legal/user-documentation/sms-integrations\">Text messages with Twilio</a> and <a href=\"/legal/user-documentation/connect-whatsapp-business-to-message-parents\">WhatsApp Business</a>."],
      ["Does Managira charge for texts?", "No. Texts and WhatsApp messages are paid for by your school's own provider accounts, with no markup from Managira."],
    ],
    related: ["sms-integrations", "connect-whatsapp-business-to-message-parents", "email-notifications-reference", "create-manage-parent"],
  },
  {
    slug: "connect-whatsapp-business-to-message-parents",
    title: "Connect WhatsApp Business",
    topic: "Communication",
    order: 2,
    summary: "Message parents on WhatsApp from your school's own WhatsApp Business number: connect it with Meta, get approved, and send from the Mail Room.",
    tags: ["whatsapp", "whatsapp business", "meta", "message template", "parents", "mail room"],
    who: "Managers, and staff given the <strong>Integrations</strong> permission.",
    intro: "WhatsApp messages come from your school's own WhatsApp Business number, through Meta's official WhatsApp Business Platform. Meta charges your school directly for each conversation.",
    sections: [
      {
        title: "What you need",
        list: [
          "A phone number for the school that isn't already used with WhatsApp or the WhatsApp Business app. A new number, or a landline that can receive a call or text, works best.",
          "A Facebook account for the person setting it up. Meta uses it to create or choose your school's Meta Business account.",
        ],
      },
      {
        title: "Connect your number",
        steps: [
          ["Open <strong>Management</strong>, then <strong>Integrations</strong>, and expand <strong>WhatsApp Business</strong>.", "integrations-whatsapp.webp", "The WhatsApp Business card in Integrations."],
          "Choose <strong>Activate</strong> and confirm with your password.",
          "Choose <strong>Connect WhatsApp</strong>. In Meta's window, sign in with Facebook and pick or create your school's Meta Business account.",
          "Add the school's phone number and enter the code Meta sends to it.",
          "Back in Managira, follow the setup checklist on the card. Each step turns green when Meta approves it.",
        ],
      },
      {
        title: "Finish the checklist",
        list: [
          "<strong>Verify phone number:</strong> done when you enter Meta's code.",
          "<strong>Get display name approved:</strong> in WhatsApp Manager, make sure your display name matches your school's name. Meta usually approves it within a day or two. Messages can't be sent until it is.",
          "<strong>Get a message template approved:</strong> WhatsApp only lets a school message a parent who hasn't written first by using an approved template. Create one in WhatsApp Manager, for example a general school notice.",
        ],
      },
    ],
    faq: [
      ["Can parents reply on WhatsApp?", "Yes. Their replies arrive in the Mail Room inbox."],
      ["Can we keep using WhatsApp on a phone with the same number?", "No. A number connected to the WhatsApp Business Platform can't also be used in the WhatsApp or WhatsApp Business app."],
    ],
    related: ["mailroom-send-sms-whatsapp-and-email-to-guardians", "sms-integrations", "integrations"],
  },
  {
    slug: "notifications-and-alerts",
    title: "Your notifications and alerts",
    topic: "Communication",
    order: 2.5,
    summary: "Choose what you're told about, scores, absences, report cards and the bus, and how: in Managira, by email, by text or in the weekly briefing.",
    tags: ["alerts", "notifications", "text message alerts", "sms alerts", "low grade alert", "absent alert", "report card ready", "bus alert", "email preferences", "settings", "set by your school"],
    featured: true,
    who: "Parents, students, teachers and drivers, each in their own Settings. Managers decide what the school makes available in Class settings.",
    intro: "Everyone gets one list for everything they're told about, under <strong>Settings</strong>, <strong>Notifications</strong>. Each alert is a row with a switch for every way to be told. Nothing is on that you didn't choose, except the few alerts the school sends by default.",
    sections: [
      {
        title: "Where to find it",
        table: [
          ["Who", "Where"],
          ["Staff", "Menu, <strong>Settings</strong>, <strong>Notifications</strong>."],
          ["Parents", "Menu, <strong>Settings</strong>, then open <strong>Notifications</strong>."],
          ["Students and drivers", "Their <strong>Settings</strong> page."],
        ],
        note: "A parent can also set alerts for one child: open the child's page and choose the <strong>Alerts</strong> tile. A child's own alerts replace the ones set for all children, and <strong>Use the alerts I set for all my children</strong> goes back.",
      },
      {
        title: "How the list works",
        list: [
          "<strong>Alerts</strong> come first, grouped as Academics, Attendance and Bus. Each row shows its name, a percentage where it needs one, and a switch under each way to be told: <strong>In Managira</strong>, <strong>Email</strong>, <strong>Text message</strong> and <strong>Weekly briefing</strong>. Nothing switched on means the alert is off.",
          "<strong>Emails</strong> follow, with their switch in the same Email column. A manager also sees the school's own emails.",
          "One <strong>Save</strong> button under the whole list saves the alerts and the emails together. It stays grey until something changes.",
          "A row marked <strong>Set by your school</strong> is locked: the school decided it, and you can't change it.",
        ],
      },
      {
        title: "The alerts",
        table: [
          ["Alert", "Who can set it", "What it does"],
          ["<strong>Needs improvement</strong>", "Parents, students, teachers", "Tells you when a posted score falls below your percentage (50% to start for parents)."],
          ["<strong>Happy news</strong>", "Parents, students, teachers", "Tells you when a posted score reaches your percentage (90% to start for parents)."],
          ["<strong>Report card ready</strong>", "Parents", "Tells a parent when a child's report card is sent."],
          ["<strong>Absent</strong>", "Parents", "Tells a parent when their child is marked absent."],
          ["<strong>Bus about to arrive</strong> and <strong>Bus has arrived</strong>", "Parents, students", "Tells you when the bus nears and reaches the stop. Shown only where transportation is on."],
          ["<strong>Rider not coming</strong>", "Drivers", "Tells a driver when a family says their child isn't riding today."],
        ],
        note: "Score alerts fire when a grade is posted, so you hear about approved grades only, never one a teacher hasn't confirmed. Teachers hear only about their own classes and subjects.",
      },
      {
        title: "Text messages",
        text: "When your school has a text provider connected, every alert that matters can also be set to <strong>Text message</strong>. The text goes to the mobile number on your profile, so check it is right. A report card text goes only to a parent who chose it. Students have no number on file, so they choose email or the briefing instead. Without a provider, the text column isn't shown.",
      },
      {
        title: "Weekly briefing",
        text: "Choose <strong>Weekly briefing</strong> on an alert to have it collected into the family's weekly email instead of arriving on its own. It is offered only where the school sends the weekly briefing. See <a href=\"/legal/user-documentation/weekly-briefing\">Weekly briefing</a>.",
      },
      {
        title: "What the school decides",
        text: "For each class, the school chooses whether parents and students can set alerts at all (Class settings, <strong>Share with</strong>, <strong>Alerts</strong>). A class that keeps alerts from parents or students takes every alert away from them: they aren't offered, and none is delivered. Each alert also follows its own item. Absent needs attendance shared, bus alerts need Bus &amp; transport shared and a child who actually rides, and report card ready follows Report cards. See <a href=\"/legal/user-documentation/class-settings\">Class settings</a>.",
      },
    ],
    faq: [
      ["I never turned an alert on, but I get one.", "Schools send a few by default: a report card notice, bus arrival notices, and for parents a low-score alert in the bell. Switch them off in Notifications, or open the row to change them."],
      ["Why is a row locked?", "It says <strong>Set by your school</strong>. The school decided it for you."],
      ["Why don't I see Text message?", "Your school hasn't connected a text provider, so it isn't offered. Students never get text alerts."],
      ["Can I stop all email?", "You can turn off optional emails. Sign-in codes, passwords, invitations, receipts and billing and admission emails always arrive."],
      ["I set alerts for all my children, but one needs different ones.", "Open that child's page, choose <strong>Alerts</strong>, and set theirs. They replace the all-children alerts for that child only."],
    ],
    related: ["email-notifications-reference", "weekly-briefing", "attendance-notices", "parent-notifications-and-settings", "class-settings", "profile-and-appearance"],
  },
  {
    slug: "weekly-briefing",
    title: "Weekly briefing",
    topic: "Communication",
    order: 2.6,
    summary: "One weekly email per family, covering each child, and one per student with a portal login. Set the day, the sections and who gets what.",
    tags: ["weekly briefing", "weekly digest", "parent email", "weekly email", "briefing", "family email", "student email", "preview"],
    who: "Managers set it for the school; staff given <strong>Class Settings</strong> can set it for a class. Your school needs the weekly briefing turned on; ask your Managira contact if you don't see it.",
    intro: "The weekly briefing replaces the older weekly parent digest. Each family gets one email covering every current child, and each student with a student-portal login gets their own. It shows only what the family or student already sees in the portal, and anything with nothing to report is left out, down to the whole email.",
    sections: [
      {
        title: "What's in it",
        table: [
          ["Section", "What it shows"],
          ["<strong>Grades</strong>", "Grades approved this week. A grade still waiting for the teacher's confirmation never appears."],
          ["<strong>Attendance</strong>", "The week's attendance, where the class shares it."],
          ["<strong>Lunch</strong>", "Lunch, where the class takes it and shares it."],
          ["<strong>Bus</strong>", "A driver's note about the child, only once it was shared with parents."],
          ["<strong>Events</strong>", "School events shared with families."],
          ["<strong>Forms</strong> and <strong>daily class records</strong>", "Where the school shows them to families."],
          ["<strong>Bills</strong>", "One-time bills as the ledger counts them; repeating bills are named only."],
          ["<strong>Alerts</strong>", "Alerts a person chose to have in the briefing. See <a href=\"/legal/user-documentation/notifications-and-alerts\">Your notifications and alerts</a>."],
        ],
        note: "Each class's Share with switches also apply: attendance, lunch and the bus appear only where the class shares them with that audience.",
      },
      {
        title: "Set it for the school",
        steps: [
          "Open <strong>Management</strong>, then <strong>Weekly briefing</strong>. Only managers see it.",
          "Choose the <strong>day</strong>, <strong>hour</strong> and <strong>time zone</strong> it is sent.",
          "Choose which sections go to <strong>parents</strong> and which to <strong>students</strong>. Everything is on until you turn it off.",
        ],
      },
      {
        title: "Set it for one class",
        steps: [
          "Open the class, then <strong>Class settings</strong>.",
          "In the <strong>Weekly briefing</strong> card, turn on <strong>Choose for this class</strong>.",
          "Switch each section on or off for parents and for students. Each change saves as you make it; there is no Save button.",
        ],
        note: "With <strong>Choose for this class</strong> off, the class follows the school's choices and the rows only show them.",
      },
      {
        title: "Preview a student's briefing",
        text: "Staff can preview any student's briefing from the school's briefing page. A preview is never sent to anyone.",
      },
      {
        title: "Who gets it, and how",
        list: [
          "Families: one email per address, covering each current child, on the chosen day. A parent who turned the briefing off, or a family with nothing to report, gets nothing.",
          "Students: only students with a student-portal login, and only where the school's student portal is on.",
          "Each email goes out once per address per day, from the school as \"&lt;school&gt; via Managira\", with a link to unsubscribe.",
        ],
      },
    ],
    faq: [
      ["Why didn't a family get a briefing?", "Nothing to report that week, they unsubscribed, or the sections are switched off for their child's class."],
      ["Can a class send different sections?", "Yes. Turn on <strong>Choose for this class</strong> in the class's Class settings."],
      ["Does it show grades a teacher hasn't confirmed?", "No. Only grades approved this week are included."],
    ],
    related: ["notifications-and-alerts", "class-settings", "parent-notifications-and-settings", "email-notifications-reference"],
  },
  {
    slug: "email-notifications-reference",
    title: "Emails Managira sends",
    topic: "Communication",
    order: 3,
    summary: "Which emails go to staff, parents and students, which address each comes from, and which ones people can turn off.",
    tags: ["emails", "notifications", "email preferences", "reminders", "report card emails", "spam"],
    who: "Everyone.",
    sections: [
      {
        title: "Where emails come from",
        table: [
          ["From", "What it sends"],
          ["<strong>reminders@managira.com</strong>", "Sign-in verification codes, activity reminders and other reminders."],
          ["<strong>reports@managira.com</strong>", "Report cards, term reports, transcripts and Report Builder emails."],
          ["Managira's main address", "Receipts, invoices, invitations and password emails."],
        ],
        tip: "Ask families to add these addresses to their contacts, so school emails never land in spam.",
      },
      {
        title: "Always sent",
        list: [
          "Password resets, verification codes and sign-in emails.",
          "Invitations to Managira, the parent portal and the student portal.",
          "Receipts, invoices and payment confirmations.",
          "Application confirmations and admission decisions.",
        ],
      },
      {
        title: "Notifications you can turn off",
        list: [
          "New school events and announcements.",
          "Tasks and mentions (staff).",
          "Activities and reminders for families.",
          "New bills and payment reminders.",
        ],
        image: "notifications-settings.webp",
        caption: "Settings, Notifications: each person chooses the emails they get.",
        note: "Each person chooses theirs in <strong>Settings</strong>, <strong>Notifications</strong>. Emails needed for security, billing or an action someone took can't be turned off.",
      },
    ],
    related: ["profile-and-appearance", "mailroom-send-sms-whatsapp-and-email-to-guardians", "events-announcements-notifications"],
  },
];
