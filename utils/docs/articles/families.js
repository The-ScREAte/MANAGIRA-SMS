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
];
