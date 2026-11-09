"use strict";

// Parents & families: parent records and invitations, the parent portal, emergency & pickup details,
// and the child tiles with homework help.
module.exports = [
  {
    slug: "create-manage-parent",
    title: "Add and manage parents and guardians",
    topic: "Parents & families",
    order: 1,
    summary: "Add parents to their children, keep their contact details current, link a parent to more than one child, and invite them to the parent portal.",
    tags: ["parents", "guardians", "add parent", "link student", "parent portal invite", "family contacts"],
    who: "Managers, and staff given the <strong>Parents &amp; guardians</strong> permission.",
    intro: "A parent or guardian belongs to one or more students. Add them when you add a student, from the student's page, or from Management, Guardians, where every parent in your school is listed with their children and portal status.",
    sections: [
      {
        title: "Find a parent",
        steps: [
          ["Open <strong>Management</strong>, then <strong>Guardians</strong>.", "guardians.webp", "Management, Guardians: every parent, their children and whether they use the parent portal."],
          "Search by name, or select <strong>Filters</strong> to find parents by <strong>Email or phone</strong> or <strong>Portal</strong> status: <em>Active</em>, <em>Setup pending</em> or <em>No login</em>.",
          "Select a parent to see their details, children and portal account.",
        ],
      },
      {
        title: "Add or update a parent",
        steps: [
          "Open the student and add a parent with their name, relationship, email and mobile number (with the country code, for example <code>+1 555 010 2030</code>, so texts reach them).",
          "To change details, open the parent and choose <strong>Edit Guardian Information</strong>, then save.",
          "For a parent with more than one child at your school, use <strong>Relink student</strong> to connect them to each child, so they see all their children in one portal.",
        ],
        tip: "The extra details you keep on parents, such as emergency contacts and who may pick up, are set in <a href=\"/legal/user-documentation/admission-settings\">Admission Settings</a>, Parents &amp; guardians.",
      },
      {
        title: "Invite parents to the parent portal",
        steps: [
          "Open the parent and select <strong>Parent portal</strong> to send their invitation. It goes to their email.",
          "The parent opens the email, chooses a password and signs in. Their status changes from <em>Setup pending</em> to <em>Active</em>.",
        ],
      },
    ],
    faq: [
      ["Two parents share an email address. Is that a problem?", "Each parent's sign-in needs its own email. Add the second parent's own address so both can use the portal."],
      ["How do I remove a parent from a child?", "Open the parent and choose Remove from this parent beside the child. The parent's other children aren't affected."],
    ],
    related: ["parent-portal", "emergency-and-pickup-details", "mailroom-send-sms-whatsapp-and-email-to-guardians"],
  },
  {
    slug: "parent-portal",
    title: "The parent portal",
    topic: "Parents & families",
    order: 2,
    summary: "Parents see grades, report cards, attendance, schedules, activities and the calendar, pay bills, track the bus and message the school, on any device.",
    tags: ["parent portal", "parent app", "report cards", "pay fees", "messages", "calendar", "bus tracking"],
    featured: true,
    who: "Parents and guardians your school has invited.",
    intro: "The parent portal puts everything about a family's children in one place. Parents sign in on the same Managira sign-in page as staff, and it works on any phone or computer.",
    sections: [
      {
        title: "What parents see",
        image: "parent-portal.webp",
        caption: "The parent portal on a phone: a card for each child, with what's new.",
        list: [
          "A card for each child. Selecting <strong>View</strong> opens tiles: academic information, schedule, calendar, activities, homework, the testing room, assessment documents, transportation and messages.",
          "<strong>Report cards</strong> and results as soon as the school publishes them.",
          "<strong>Attendance</strong>, including today's.",
          "<strong>Activities</strong> and a <strong>Calendar</strong> with every child's classes, activities and school events, which they can add to their own Google, Outlook or Apple calendar.",
          "<strong>Bills and payments</strong> through PayGira, with receipts.",
          "<strong>Messages</strong> with the school in the inbox.",
          "<strong>Track bus</strong>, and <strong>Not coming today</strong> for a child who won't ride, if the school uses Transportation.",
          "Emergency and pickup details they can keep up to date, if the school shares them.",
        ],
      },
      {
        title: "Getting parents started",
        steps: [
          "Make sure each parent has an email address on their record.",
          "Invite them from <strong>Management</strong>, <strong>Guardians</strong> (<strong>Parent portal</strong> on their page).",
          "Share your school's sign-in link with families, for example in your next newsletter or in the Mail Room.",
        ],
      },
    ],
    faq: [
      ["Can both parents use the portal?", "Yes. Each parent has their own sign-in with their own email, and sees the same children."],
      ["A parent sees no children.", "They aren't linked to a student yet. Link them from Management, Guardians (Relink student)."],
      ["Can parents change their details?", "They can update the emergency and pickup sections the school shares with them, and their own appearance in Settings."],
    ],
    related: ["create-manage-parent", "parent-tiles-and-homework-help", "live-bus-tracking", "set-up-paygira-bills-collections-and-guardian-payments"],
  },
  {
    slug: "emergency-and-pickup-details",
    title: "Emergency & pickup details",
    topic: "Parents & families",
    order: 3,
    summary: "Keep emergency contacts and authorized pickups on each family's record, choose who sees each section, and give teachers a class Pickup list.",
    tags: ["emergency contacts", "pickup", "authorized pickup", "pickup list", "family details", "drivers"],
    featured: true,
    who: "Managers and staff given the <strong>Contact template</strong> permission choose the sharing. Parents update; students, teachers and drivers see what's shared with them.",
    intro: "Emergency and pickup details live on each parent's record, in sections you design (for example <em>Emergency contact</em> and <em>Allowed to pick up</em>). Each section says who else may see it, so the right people have the right information, and nobody else does.",
    sections: [
      {
        title: "Choose who sees each section",
        steps: [
          ["Open <strong>Admissions</strong>, <strong>Admission Settings</strong>, then the <strong>Parents &amp; guardians</strong> tab.", "admission-settings-family.webp", "Each section's Shared with chips: parents, students, teachers and drivers."],
          "Add the sections and fields you need, or use the ones there.",
          "For each section, tick <strong>Shared with</strong>: <strong>Parents</strong>, <strong>Students</strong>, <strong>Teachers</strong> and <strong>Drivers</strong>. Office staff always see everything.",
        ],
        table: [
          ["Shared with", "What they get"],
          ["Parents", "See the section on their own record in the parent portal and can update it."],
          ["Students", "See who's picking them up in the student portal."],
          ["Teachers", "See it on their class's <strong>Pickup list</strong>."],
          ["Drivers", "See it for their own riders only, if they also have the <strong>Pickup &amp; Emergency</strong> driver permission."],
        ],
      },
      {
        title: "Parents keep it current",
        text: "Parents find the shared sections on their dashboard, update them and save. Each parent can only change their own record, and only the sections shared with parents.",
        image: "family-details-parent.webp",
        caption: "In the parent portal, parents update the sections shared with them.",
      },
      {
        title: "The class Pickup list",
        steps: [
          "A teacher opens their class and chooses <strong>Pickup list</strong>.",
          "They see each student with who may pick them up and their emergency contacts, from the sections shared with teachers.",
        ],
        image: "class-pickup-list.webp",
        caption: "A class's Pickup list: who may collect each student, at a glance.",
      },
    ],
    faq: [
      ["Can a parent see another family's details?", "No. Parents only ever see their own record."],
      ["What does a driver see?", "Only the sections shared with drivers, only for students on their own runs, and only with the Pickup & Emergency permission."],
      ["Is anything shared by default?", "No. Nothing is shared beyond the office until you tick who should see it."],
    ],
    related: ["admission-settings", "parent-portal", "class-page", "driver-app"],
  },
  {
    slug: "parent-tiles-and-homework-help",
    title: "Child tiles and homework help for parents",
    topic: "Parents & families",
    order: 4,
    summary: "Parents open a tile for each part of their child's day, and teachers can share an assessment's questions, notes and files for homework help.",
    tags: ["parent portal", "homework help", "child tiles", "assessment documents", "teachers"],
    who: "Parents see the tiles. Teachers choose what to share on assessments.",
    sections: [
      {
        title: "Child tiles",
        text: "In the parent portal, <strong>View</strong> on a child's card opens tiles: academic information, schedule, calendar, activities, homework, the testing room, assessment documents, transportation and messages. Each tile shows only that child's information.",
        image: "parent-child-tiles.webp",
        caption: "A child's tiles in the parent portal.",
      },
      {
        title: "Share homework help",
        steps: [
          "When a teacher sets up an assessment's questions, they turn on <strong>Show on parent portal</strong>.",
          "They can add notes for parents and attach files, such as a study guide or worked examples.",
          "Parents see it under the child's <strong>Homework</strong> and <strong>Assessment documents</strong> tiles.",
        ],
        note: "Parents only ever see what their child can already see.",
      },
    ],
    related: ["parent-portal", "assessment-questions-and-online-tests"],
  },
];
