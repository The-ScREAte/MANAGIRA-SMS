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
