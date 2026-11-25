"use strict";

// Communication: the Mailroom, WhatsApp Business, notifications, the weekly briefing and the
// emails Managira sends.
const link = (slug, text) => `<a href="/legal/user-documentation/${slug}">${text}</a>`;
const TOPIC = "Communication";

module.exports = [
  {
    slug: "mailroom-send-sms-whatsapp-and-email-to-guardians",
    title: "Mailroom: message families and answer their replies",
    topic: TOPIC,
    order: 1,
    summary: "Message one family, a class or many families by email, text or WhatsApp, read parents' messages in the Inbox, and check what was sent.",
    tags: ["mail room", "mailroom", "message parents", "text parents", "whatsapp", "email parents", "school communication", "inbox", "contacts", "history"],
    featured: true,
    who: "Managers, and staff given the <strong>Mailroom</strong> permission. A manager chooses whether each person may message every family or only the families of chosen classes.",
    intro: "The Mailroom is where staff message families and answer the messages parents send. Email is always available. Text and WhatsApp appear once your school connects them in Management › Integrations.",
    sections: [
      {
        title: "Open the Mailroom",
        steps: [
          ["Open <strong>Mailroom</strong> from the menu, or use <strong>Send a message</strong> in your dashboard's quick actions.", "mail-room.webp", "The Mailroom: contacts on the left, the message and its history on the right."],
          ["At the top right, <strong>Send</strong> and <strong>Inbox</strong> switch between writing and reading. The red number on Inbox counts messages waiting for a reply."],
        ],
      },
      {
        title: "Choose who to message",
        steps: [
          ["On the left, <strong>Contacts</strong> lists parents and guardians with their children, class, phone and email. Select <strong>Search &amp; filters</strong> to open the search."],
          ["Search a name, student, phone or email, or choose a class under <strong>All classes</strong>. <strong>Select all</strong> picks everyone who matches.", "mail-filters.webp", "Searching and filtering the contacts."],
          "Check the boxes beside the people you want. The message card counts <strong>recipients selected</strong>.",
        ],
        note: "You see only the families you are allowed to message. A manager sets that for each person under <strong>Users / Employees</strong>: every family, or only the families of selected classes.",
      },
      {
        title: "Write and send",
        steps: [
          ["Select <strong>Compose</strong>, then type your message."],
          ["Check how to send it: <strong>Email</strong>, <strong>Text (SMS)</strong> or <strong>WhatsApp</strong>. You can check more than one.", "mail-compose.webp", "Three people chosen, a message written, and the ways to send it."],
          "For email, add a subject. Select <strong>Send</strong>.",
          "A <strong>Send message</strong> window shows a preview. Type <strong>Your password</strong> and select <strong>Send</strong>, so a message to families is never sent by mistake.",
        ],
        example: "<em>Hello, early dismissal at 12:30 PM on Wednesday, December 2, for parent-teacher conference preparation. Buses will run at the early time.</em> Sent by email to the families of one grade.",
        note: "Text (SMS) and WhatsApp stay grayed out, with a note, until your school has set them up. See " + link("sms-integrations", "Text messages with Twilio") + " and " + link("connect-whatsapp-business-to-message-parents", "Connect WhatsApp Business") + ".",
      },
      {
        title: "History",
        steps: [
          ["Under the message, <strong>History</strong> lists what was sent: the channel, the person, the address, whether it was sent, who sent it, and when. Use <strong>All</strong>, <strong>Text</strong>, <strong>WhatsApp</strong> or <strong>Email</strong> to filter."],
          "A long message shows <strong>Read more</strong>. A family with no phone number or email for the channel is listed as not sent, so you can reach them another way.",
        ],
        note: "Emails that bounce are listed in <strong>Management › Email issues</strong>. See " + link("email-issues", "Fix emails that didn't arrive") + ".",
      },
      {
        title: "Read and answer parents' messages",
        steps: [
          ["Select <strong>Inbox</strong>. <strong>Needs reply</strong> shows messages waiting for you, <strong>Open</strong> the conversations still going and <strong>All</strong> every one. Search by parent, student, class or subject."],
          "Select a conversation to read it and reply. The reply goes to the parent in Managira.",
        ],
      },
    ],
    faq: [
      ["Why can't I choose Text or WhatsApp?", "Your school hasn't set that channel up yet. A manager can connect it in Management › Integrations. Email is always there."],
      ["Does Managira charge for texts?", "Texts and WhatsApp messages go through your school's own provider accounts, which bill your school directly."],
      ["Why is the contact list empty?", "You may be limited to the families of certain classes, and none are chosen. Ask a manager to check your Mailroom access under Users / Employees."],
      ["Can a family opt out?", "A message staff write to families can't be switched off, because the school must be able to reach them. Optional emails such as digests can be. See " + link("email-notifications-reference", "Emails Managira sends") + "."],
    ],
    related: ["sms-integrations", "connect-whatsapp-business-to-message-parents", "email-issues", "email-notifications-reference", "create-manage-parent"],
  },

  {
    slug: "connect-whatsapp-business-to-message-parents",
    title: "Connect WhatsApp Business",
    topic: TOPIC,
    order: 2,
    summary: "Message parents on WhatsApp from your school's own WhatsApp Business number: connect it with Meta, finish the checklist, and send from the Mailroom.",
    tags: ["whatsapp", "whatsapp business", "meta", "message template", "display name", "parents", "mail room"],
    who: "Managers, and staff given the <strong>Integrations</strong> permission.",
    intro: "WhatsApp messages come from your school's own WhatsApp Business number, through Meta's WhatsApp Business Platform. Meta bills your school directly for conversations.",
    sections: [
      {
        title: "What you need",
        list: [
          "A phone number for the school that isn't already used in the WhatsApp or WhatsApp Business app. A new number, or a landline that can receive a call or text, works best.",
          "A Facebook account for the person setting it up. Meta uses it to create or choose your school's Meta Business account.",
        ],
      },
      {
        title: "Connect your number",
        steps: [
          ["Go to <strong>Management › Integrations</strong> and select <strong>Expand</strong> on <strong>WhatsApp Business</strong>.", "whatsapp-card.webp", "The WhatsApp Business card, expanded, with its setup checklist."],
          "Open the <strong>⋮</strong> menu on the card and choose <strong>Activate</strong>. Confirm with your password.",
          "From the same menu, choose the connect option. In Meta's window, sign in with Facebook and pick or create your school's Meta Business account.",
          "Add the school's phone number and enter the code Meta sends to it.",
          "Back in Managira, the card shows <strong>Active &amp; Connected</strong> and the connected number.",
        ],
      },
      {
        title: "Finish the setup checklist",
        text: "The <strong>Setup checklist</strong> on the card shows what Meta still needs. Each step turns to a check when Meta approves it.",
        list: [
          "<strong>Verify phone number</strong>: verify by one-time code in WhatsApp Manager.",
          "<strong>Get display name approved</strong>: in WhatsApp Manager, make sure your display name matches your school's name. Messages can't be sent until Meta approves it, which usually takes a day or two.",
          "<strong>Get a message template approved</strong>: WhatsApp lets a school message a parent who hasn't written first only with an approved template. Create one in WhatsApp Manager, for example a general school notice.",
          "<strong>Confirm a real message was delivered</strong>: unlocks when the steps above are approved. Send a test message to yourself from the Mailroom.",
        ],
        tip: "Each checklist step has a button that opens the right page in Meta.",
      },
      {
        title: "Send a message",
        text: "Once the checklist is complete, <strong>WhatsApp</strong> is no longer grayed out in the " + link("mailroom-send-sms-whatsapp-and-email-to-guardians", "Mailroom") + ". Parents' replies arrive in its Inbox.",
      },
    ],
    faq: [
      ["Can parents reply on WhatsApp?", "Yes. Their replies arrive in the Mailroom Inbox."],
      ["Can we keep using WhatsApp on a phone with the same number?", "No. A number connected to the WhatsApp Business Platform can't also be used in the WhatsApp or WhatsApp Business app."],
      ["Why is WhatsApp grayed out in the Mailroom?", "The connection or a checklist step isn't finished. Open the card in Management › Integrations and see which step is still waiting."],
    ],
    related: ["mailroom-send-sms-whatsapp-and-email-to-guardians", "sms-integrations", "integrations"],
  },

  {
    slug: "notifications-and-alerts",
    title: "Choose your notifications and alerts",
    topic: TOPIC,
    order: 3,
    summary: "Choose what you are told about, such as scores, absences, report cards and the bus, and how: in Managira, by email, by text, or in the weekly briefing.",
    tags: ["alerts", "notifications", "text message alerts", "sms alerts", "low grade alert", "absent alert", "report card ready", "bus alert", "email preferences", "settings", "set by your school"],
    featured: true,
    who: "Parents, students, teachers, drivers and every other member of staff, each in their own Settings. Managers decide what the school makes available in Class settings.",
    intro: "Everyone has one list for what they are told about, in <strong>Settings › Notifications</strong>. Each alert is a row with a switch for every way to be told. Nothing is on that you didn't choose, except the few alerts your school sends by default.",
    sections: [
      {
        title: "Open your notifications",
        table: [
          ["Who", "Where"],
          ["Staff", "<strong>Settings › Notifications</strong>"],
          ["Parents", "<strong>Settings</strong>, then <strong>Notifications</strong>"],
          ["Students and drivers", "Their <strong>Settings</strong> page"],
        ],
        steps: [
          ["As staff, open <strong>Settings</strong> from the menu and choose <strong>Notifications</strong>."],
        ],
        note: "A parent can also set alerts for one child: open the child's page and choose the <strong>Alerts</strong> tile. A child's own alerts replace the ones set for all children, and <strong>Use the alerts I set for all my children</strong> goes back.",
      },
      {
        title: "Read the list",
        steps: [
          ["<strong>Alerts</strong> come first, grouped as Academics, Attendance and Bus. Each has a switch under each way to be told.", "notif-teacher.webp", "A teacher's Notifications: alerts first, then emails, then Save."],
          ["The columns are <strong>In Managira</strong>, <strong>Email</strong>, <strong>Weekly briefing</strong> and, where your school has a text provider, <strong>Text message</strong>."],
          ["A score alert has a percentage you can change."],
          ["<strong>Emails</strong> follow, each with a switch in the Email column."],
          ["Select <strong>Save notifications</strong>. It stays gray until something changes, and one button saves alerts and emails together."],
        ],
        note: "A row marked <strong>Set by your school</strong> is locked. Your school decided it, and you can't change it.",
      },
      {
        title: "The alerts",
        table: [
          ["Alert", "Who can set it", "What it does"],
          ["<strong>Student needs improvement</strong>", "Parents, students, teachers", "Tells you when a posted score falls below your percentage (50% to start for parents)."],
          ["<strong>Student doing well</strong>", "Parents, students, teachers", "Tells you when a posted score reaches your percentage (90% to start for parents)."],
          ["<strong>Report card ready</strong>", "Parents", "Tells a parent when a child's report card is sent."],
          ["<strong>Absent</strong>", "Parents", "Tells a parent when their child is marked absent."],
          ["<strong>Bus about to arrive</strong> and <strong>Bus has arrived</strong>", "Parents, students", "Tells you when the bus nears and reaches the stop. Shown only where transportation is on."],
          ["<strong>Rider not coming</strong>", "Drivers", "Tells a driver when a family says their child isn't riding today."],
        ],
        note: "Score alerts fire when a grade is posted, so you hear about approved grades only, never one a teacher hasn't confirmed. Teachers hear only about their own classes and subjects.",
      },
      {
        title: "Text messages and the weekly briefing",
        list: [
          "<strong>Text message</strong> appears when your school has a text provider connected. The text goes to the mobile number on your profile, so check it is right. Students have no number on file, so they choose email or the briefing.",
          "<strong>Weekly briefing</strong> collects an alert into the family's weekly email instead of sending it alone. It is offered only where your school sends the briefing. See " + link("weekly-briefing", "Weekly briefing") + ".",
        ],
      },
      {
        title: "For managers: the school's emails",
        steps: [
          ["Managers also see <strong>For the whole school</strong> under Emails, for example <strong>Auto-send parent portal password setup invite</strong>."],
        ],
      },
      {
        title: "What the school decides",
        text: "For each class, your school chooses whether parents and students can set alerts at all (Class settings, <strong>Share with</strong>, <strong>Alerts</strong>). A class that keeps alerts from them takes every alert away: none is offered or delivered. Each alert also follows its own item: absent needs attendance shared, bus alerts need Bus &amp; transport shared and a child who rides, and report card ready follows Report cards. See " + link("class-settings", "Class settings") + ".",
      },
    ],
    faq: [
      ["I never turned an alert on, but I get one.", "Schools send a few by default: a report card notice, bus arrival notices, and for parents a low-score alert in the bell. Switch them off in Notifications."],
      ["Why is a row locked?", "It says <strong>Set by your school</strong>. The school decided it for you."],
      ["Why don't I see Text message?", "Your school hasn't connected a text provider, so it isn't offered. Students never get text alerts."],
      ["Can I stop all email?", "You can turn off optional emails. Sign-in codes, passwords, invitations, receipts, billing and admission emails always arrive."],
      ["I set alerts for all my children, but one needs different ones.", "Open that child's page, choose <strong>Alerts</strong> and set theirs. They replace the all-children alerts for that child only."],
    ],
    related: ["email-notifications-reference", "weekly-briefing", "attendance-notices", "parent-notifications-and-settings", "class-settings", "profile-and-appearance"],
  },

  {
    slug: "weekly-briefing",
    title: "Weekly briefing: one email a week per family",
    topic: TOPIC,
    order: 4,
    summary: "Send each family one weekly email covering every child, and each student with a portal login their own. Set the day, the sections and the class choices.",
    tags: ["weekly briefing", "weekly digest", "parent email", "weekly email", "briefing", "family email", "student email", "sections"],
    who: "Managers set it for the school. It needs the weekly briefing turned on for your school; ask your Managira contact if you don't see it.",
    intro: "The weekly briefing replaces the older weekly parent digest. Each family gets one email covering every current child, and each student with a student-portal login gets their own. It shows only what the family or student already sees in the portal, and a section, child or whole email with nothing to report is left out.",
    sections: [
      {
        title: "What is in it",
        table: [
          ["Section", "What it shows"],
          ["<strong>Attendance</strong>", "The week's attendance, where the class shares it."],
          ["<strong>Lunch</strong>", "Lunch, where the class takes it and shares it."],
          ["<strong>New grades</strong>", "Grades approved this week. A grade still waiting for the teacher's confirmation never appears."],
          ["<strong>Bus</strong>", "A driver's note about the child, only once it was shared with parents."],
          ["<strong>Daily class records</strong>", "Where the school shows them to families."],
          ["<strong>Forms to fill in</strong>", "Forms the family still needs to fill in."],
          ["<strong>Payments</strong>", "One-time bills as the ledger counts them; repeating bills are named only. For parents only."],
          ["<strong>Tests coming up</strong>", "Tests the student can take soon."],
          ["<strong>Class activities</strong> and <strong>School events</strong>", "Activities and events shared with families."],
        ],
        note: "Alerts a person chose to have in the briefing appear too. See " + link("notifications-and-alerts", "Choose your notifications and alerts") + ". Each class's <strong>Share with</strong> switches also apply: attendance, lunch and the bus appear only where the class shares them with that audience.",
      },
      {
        title: "Set it for the school",
        steps: [
          ["Go to <strong>Management › Class &amp; notif. settings</strong>."],
          ["Scroll to the <strong>Weekly briefing</strong> card.", "briefing-school.webp", "The school's choices: when it goes, and what each audience gets."],
          ["Under <strong>Sent every</strong>, choose the <strong>day</strong>, the <strong>hour</strong> and the <strong>time zone</strong>."],
          ["Switch each section on or off for <strong>Parents</strong> and for <strong>Students</strong>. Everything is on until you turn it off. <strong>Send the weekly briefing</strong> is the main switch for an audience.", "briefing-sections-zoom.webp", "One row per section, a column per audience."],
          ["Select <strong>Save</strong>."],
        ],
      },
      {
        title: "Set it for one class",
        steps: [
          "Open the class, then <strong>Class &amp; notif. settings</strong> in Class Tools. Scroll to <strong>Weekly briefing</strong>.",
          ["Turn on <strong>Choose for this class</strong>. The rows below come alive."],
          "Switch each section on or off for parents and students. Each change saves as you make it, so there is no Save button.",
        ],
        note: "Only managers see the Weekly briefing card.",
      },
      {
        title: "Preview a family's email",
        text: "See exactly what one family, or one student, would get this week. Nothing is sent.",
        steps: [
          "In <strong>Management › Class &amp; notif. settings</strong>, scroll to the <strong>Preview</strong> row at the bottom of the <strong>Weekly briefing</strong> card.",
          "Choose a <strong>Class</strong>, then a <strong>Student</strong>. The student list fills in once a class is chosen.",
          "Under <strong>For</strong>, choose <strong>Family</strong> (what the parents get) or <strong>Student</strong> (what the student gets).",
          "Select <strong>Open preview</strong>. The email opens in a new tab, marked as a preview.",
        ],
        tip: "Preview a family whose child has new grades or a bus note this week, to check the sections read the way you expect.",
      },
      {
        title: "Who gets it",
        list: [
          "<strong>Families</strong>: one email per address, covering each current child, on the day you chose. A parent who turned the briefing off, or a family with nothing to report, gets nothing.",
          "<strong>Students</strong>: only students with a student-portal login, and only where the school's student portal is on.",
          "Each email goes out from the school as \"&lt;school&gt; via Managira\", once per address per day, with a link to unsubscribe.",
        ],
      },
    ],
    faq: [
      ["Why didn't a family get a briefing?", "There was nothing to report that week, they unsubscribed, or the sections are switched off for their child's class."],
      ["Can a class send different sections?", "Yes. Turn on <strong>Choose for this class</strong> in the class's Class &amp; notif. settings."],
      ["Does it show grades a teacher hasn't confirmed?", "No. Only grades approved this week are included."],
    ],
    related: ["notifications-and-alerts", "class-settings", "parent-notifications-and-settings", "email-notifications-reference"],
  },

  {
    slug: "email-issues",
    title: "Fix emails that didn't arrive (Email issues)",
    topic: TOPIC,
    order: 5,
    summary: "See the addresses emails couldn't reach, correct them, and send a test to clear the problem.",
    tags: ["email issues", "failed emails", "bounced", "undeliverable", "wrong email address", "mailbox full", "test and save"],
    who: "Managers, and staff with access to Email issues.",
    intro: "When an email bounces, Managira lists the address here so you can fix it and people keep getting messages. The list updates by itself when a failure is detected.",
    sections: [
      {
        title: "Open Email issues",
        steps: [
          ["Go to <strong>Management › Email issues</strong>. A red number shows how many addresses need attention.", "email-issues.webp", "Email issues, with the count beside it in the menu."],
          "Each row shows the person, the address that failed with a box to correct it, the reason (for example <em>Mailbox full</em> or <em>Address does not exist</em>), how many attempts failed and when it last failed.",
        ],
      },
      {
        title: "Correct an address",
        steps: [
          "Type the right address in the box.",
          "Select <strong>Test &amp; Save</strong>. Managira sends a test email.",
          "If it arrives, the issue clears by itself.",
        ],
        tip: "Select <strong>How to fix an address</strong> at the top of the page for the same steps.",
      },
      {
        title: "When there are none",
        text: "A check and <strong>All emails are working</strong> mean there are no undeliverable addresses on record.",
      },
    ],
    faq: [
      ["Why does the same address keep failing?", "A full mailbox clears when the person frees space. An address that doesn't exist needs a new one. Ask the family for a current address."],
      ["Where do bounced Mailroom messages show?", "Here, as email issues, and in the Mailroom's History. See " + link("mailroom-send-sms-whatsapp-and-email-to-guardians", "Mailroom") + "."],
    ],
    related: ["mailroom-send-sms-whatsapp-and-email-to-guardians", "email-notifications-reference"],
  },

  {
    slug: "email-notifications-reference",
    title: "Emails Managira sends",
    topic: TOPIC,
    order: 6,
    summary: "Which emails go to staff, parents and students, which address each comes from, and which ones people can turn off.",
    tags: ["emails", "notifications", "email preferences", "reminders", "report card emails", "spam", "unsubscribe", "from address"],
    who: "Everyone.",
    intro: "Managira's emails are short and plain. School emails to families come from your school's name, and replies go to the school.",
    sections: [
      {
        title: "Where emails come from",
        table: [
          ["From", "What it sends"],
          ["<strong>reminders@managira.com</strong>", "Sign-in verification codes, activity reminders and other reminders."],
          ["<strong>reports@managira.com</strong>", "Report cards, terminal reports, transcripts and Report Builder emails."],
          ["Managira's main address", "Receipts, invoices, invitations and password emails."],
          ["<strong>\"Your school\" via Managira</strong>", "Messages from your school to parents, students or staff. Replies go to the school's own address."],
        ],
        tip: "Ask families to add these addresses to their contacts so school emails never land in spam.",
      },
      {
        title: "Always sent",
        list: [
          "Password resets, verification codes and sign-in emails.",
          "Invitations to Managira, the parent portal and the student portal.",
          "Receipts, invoices, billing and payment confirmations.",
          "Application confirmations and admission decisions.",
          "Messages staff write to families in the Mailroom. A school must be able to reach every family.",
        ],
      },
      {
        title: "Emails people can turn off",
        steps: [
          ["Each person chooses theirs in <strong>Settings › Notifications</strong>, under <strong>Emails</strong>.", "notif-manager.webp", "A manager's Notifications. Each email has a switch."],
          "Every optional email also carries an unsubscribe link. Opening it changes nothing. The button on its page does.",
        ],
        list: [
          "Staff: weekly reports or teaching digests, new guardian reports and replies, events and announcements, tasks and shared calendars, scheduled reports, news from Managira, and, for managers, account suspension or reactivation.",
          "Parents and students: activities and reminders, weekly briefing, alerts they chose, new bills and payment reminders.",
        ],
        note: "Emails needed for security, billing or an action someone took can't be turned off. Your school can also lock a choice, shown as <strong>Set by your school</strong>. See " + link("notifications-and-alerts", "Choose your notifications and alerts") + ".",
      },
      {
        title: "When an email doesn't arrive",
        text: "A manager sees bounced addresses in <strong>Management › Email issues</strong>. See " + link("email-issues", "Fix emails that didn't arrive") + ".",
      },
    ],
    related: ["notifications-and-alerts", "email-issues", "mailroom-send-sms-whatsapp-and-email-to-guardians", "events-announcements-notifications"],
  },
];
