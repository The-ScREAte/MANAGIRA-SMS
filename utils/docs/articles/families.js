"use strict";

// Parents & families: parent records and invitations, the parent portal, emergency & pickup details,
// and the child tiles with homework help.
module.exports = [
  {
    slug: "create-manage-parent",
    title: "Add and manage parents and guardians",
    topic: "Parents & families",
    order: 1,
    summary: "Find a parent, add one to a child, edit their details and contact card, link or unlink children, and invite them to the parent portal.",
    tags: ["parents", "guardians", "add parent", "link student", "unlink parent", "relink", "parent portal invite", "reset parent password", "family contacts", "contact card"],
    who: "Managers, and staff given the <strong>Manage Guardians</strong> permission. Teachers and supervisors see only the parents of students in their own classes.",
    intro: "A parent or guardian belongs to one or more students. Management › Parents &amp; guardians lists every parent in your school with their children and portal status. New parents are added with a student, not from this list.",
    sections: [
      {
        title: "Find a parent",
        steps: [
          ["Go to <strong>Management</strong> and select <strong>Parents &amp; guardians</strong>."],
          ["The list shows each parent's <strong>Name</strong>, <strong>Email</strong>, <strong>Phone</strong>, number of <strong>Children</strong>, <strong>Portal</strong> status and <strong>Last sign-in</strong>. Select a column heading to sort. Use the page bar under the list for more rows.", "guardians-list.webp", "Every parent in the school."],
          ["Select <strong>Filters</strong>."],
          ["Find by <strong>Name</strong> or <strong>Email or phone</strong>, or narrow by <strong>Portal</strong> (<em>Active</em>, <em>Setup pending</em> or <em>No login</em>), <strong>Child's class</strong>, <strong>Children</strong> (has children linked, or none), <strong>Last sign-in</strong> dates, or <strong>Never signed in</strong>. <strong>Clear</strong> resets them."],
        ],
        table: [
          ["Portal status", "Means"],
          ["<strong>Active</strong>", "They chose a password and can sign in."],
          ["<strong>Setup pending</strong>", "Invited, but haven't set a password."],
          ["<strong>No login</strong>", "No invitation sent, or no email on file."],
        ],
      },
      {
        title: "Open a parent",
        steps: [
          ["Select a parent's row. A panel opens with their <strong>Contact</strong> details, their <strong>Children</strong> (class and relationship) and their <strong>Parent portal</strong> status: sign-in email and phone, and last sign-in.", "guardians-panel.webp", "A parent's panel."],
          ["The buttons at the bottom are <strong>Send setup</strong> (or <strong>Send reset</strong> once they're active), <strong>Photo &amp; children</strong> and <strong>Edit</strong>."],
        ],
      },
      {
        title: "Add a parent to a child",
        text: "Parents are added with their child. This list has no Add button. Use any of these:",
        list: [
          "<strong>Add student</strong>: under <strong>Guardian Details</strong>, choose <strong>New guardian</strong>, or <strong>Search existing</strong> to link a parent who already has a child in your school. See <a href=\"/legal/user-documentation/create-and-add-student\">Add a student</a>.",
          "<strong>Edit student</strong>: select <strong>+ Add parent / guardian</strong>. See <a href=\"/legal/user-documentation/edit-student-information\">Edit a student's information</a>.",
          "<strong>Online applications</strong>: approving an application creates the parents from it. See <a href=\"/legal/user-documentation/pending-admissions-review-and-approval\">Review and approve online applications</a>.",
        ],
        tip: "Put the parent's mobile number in with the area code, such as <code>(208) 555-0107</code>, so texts reach them.",
      },
      {
        title: "Edit a parent and their contact card",
        steps: [
          ["Open the parent and select <strong>Edit</strong>. The contact card has tabs: <strong>Contact info</strong>, <strong>Children</strong>, and one for each section your school added to Parents &amp; guardians, such as <strong>Emergency contact</strong> and <strong>Allowed to pick up</strong>.", "guardians-edit-zoom.webp", "The contact card."],
          "Change the name, date of birth, phone, email, address or hometown, and fill in the section tabs. Select <strong>Save</strong>. <strong>Close</strong> leaves without saving.",
          "<strong>Edit fields</strong>, at the bottom, opens <a href=\"/legal/user-documentation/admission-settings\">Admission Settings</a> to change which fields every parent's card has. It shows only to people allowed to change them.",
        ],
        warning: "A parent's email is also their sign-in. Changing it changes how they sign in.",
      },
      {
        title: "Link, relink or unlink a child",
        steps: [
          ["Open the parent and select <strong>Photo &amp; children</strong>. Each child has a card with <strong>View Student</strong>."],
          "Select the <strong>⋮</strong> on a child's card. <strong>File a report</strong> records a report about the child. <strong>Remove from this parent</strong> offers two choices.",
          "<strong>Relink to different guardian</strong> moves the child under another parent: search for one, or add a new one, then select <strong>Relink student</strong>. <strong>Remove only</strong> unlinks the child and confirms with <strong>Yes, remove</strong>.",
        ],
        note: "Unlinking affects only that child. The parent's other children stay linked, and the parent stays in the list.",
      },
      {
        title: "Invite or reset the parent portal",
        steps: [
          "Open the parent and select <strong>Send setup</strong>. The invitation goes to their email. For a parent who is already <em>Active</em> the button says <strong>Send reset</strong> and emails a password link.",
          "The parent opens the email, chooses a password and signs in. Their status changes from <em>Setup pending</em> to <em>Active</em>.",
        ],
        note: "The button needs an email address on the parent's record. Parents sign in with their email and password, and a code emailed to them.",
      },
    ],
    faq: [
      ["Two parents share an email address. Is that a problem?", "Each parent's sign-in needs its own email. Give the second parent their own address so both can use the portal."],
      ["A parent has children at two Managira schools. What do they see?", "Parent accounts at different schools with the same sign-in email belong to one parent. They see the other school's children after they accept that school's invitation on My children."],
      ["Why is a parent missing from the list?", "Teachers and supervisors see only parents of students in their own classes. Check the filters too, and select <strong>Clear</strong>."],
      ["How do I remove a parent from a child?", "Open the parent, select <strong>Photo &amp; children</strong>, then <strong>⋮ › Remove from this parent</strong> beside the child."],
    ],
    related: ["parent-portal", "emergency-and-pickup-details", "create-and-add-student", "mailroom-send-sms-whatsapp-and-email-to-guardians"],
  },
  {
    slug: "emergency-and-pickup-details",
    title: "Emergency & pickup details",
    topic: "Parents & families",
    order: 3,
    summary: "Keep emergency contacts and authorized pickups on each family's record, choose who sees each section, and give teachers a class Pickup list.",
    tags: ["emergency contacts", "pickup", "authorized pickup", "pickup list", "family details", "drivers", "shared with", "parents and guardians fields"],
    featured: true,
    who: "Managers and staff given the <strong>Edit Contact Template</strong> permission choose the sections and sharing. Parents update their own. Students, teachers and drivers see what's shared with them.",
    intro: "Emergency and pickup details live on each parent's record, in sections you design, such as <em>Emergency contact</em> and <em>Allowed to pick up</em>. Each section says who else may see it, so the right people have the right information and nobody else does.",
    sections: [
      {
        title: "Make the sections",
        steps: [
          ["Go to <strong>Admissions › Admission settings</strong>, then open the <strong>Parents &amp; guardians</strong> tab.", "family-sections.webp", "Two sections, each with Shared with chips."],
          "Select <strong>Add section</strong> and name it, for example <em>Emergency contact</em>.",
          "Select <strong>Add field</strong> for each detail: name, phone, relationship, a pickup password. Choose the section, the type of answer and a width.",
          "Drag fields to put them in order, or between sections.",
        ],
        example: "<em>Emergency contact</em> holds a name, a phone number and a choice list for the relationship. <em>Allowed to pick up</em> holds an authorized person, their phone and a pickup password.",
      },
      {
        title: "Choose who sees each section",
        steps: [
          ["Under each section, find <strong>Shared with</strong>. Select a chip to turn it on or off: <strong>Parents</strong>, <strong>Students</strong>, <strong>Teachers</strong> and <strong>Drivers</strong>. Office staff with access always see everything."],
        ],
        table: [
          ["Shared with", "What they get"],
          ["Parents", "See the section on their own dashboard and can update it."],
          ["Students", "See their parents' answers in the student portal."],
          ["Teachers", "See it on their class's <strong>Pickup list</strong>."],
          ["Drivers", "See it for their own riders only, and only with the <strong>Pickup &amp; Emergency</strong> driver permission."],
        ],
        note: "Nothing is shared until you turn a chip on.",
      },
      {
        title: "Parents keep it current",
        steps: [
          ["Parents find each shared section on their dashboard, with an <strong>Update</strong> button. Until they fill it in, it says <em>Not added yet</em>."],
          "They select <strong>Update</strong>, fill in the section and save. Each parent changes only their own record, and only the sections shared with parents.",
        ],
      },
      {
        title: "Staff can fill it in too",
        text: "Open a parent in <strong>Management › Parents &amp; guardians</strong>, select <strong>Edit</strong>, and use the section tabs on the contact card. See <a href=\"/legal/user-documentation/create-manage-parent\">Add and manage parents and guardians</a>.",
      },
      {
        title: "The class Pickup list",
        steps: [
          "A teacher opens their class and selects <strong>Pickup list</strong>.",
          "They see each student, how they go home, and the details from sections shared with teachers. See <a href=\"/legal/user-documentation/class-page\">The class page</a>.",
        ],
        image: "class-pickup-list.webp",
        caption: "A class's Pickup list: who may collect each student, at a glance.",
      },
    ],
    faq: [
      ["Can a parent see another family's details?", "No. Parents only ever see their own record."],
      ["What does a driver see?", "Only the sections shared with drivers, only for students on their own runs, and only with the Pickup &amp; Emergency permission."],
      ["Is anything shared by default?", "No. A section is seen only by your office staff until you turn on who else should see it."],
      ["A parent says the section is missing on their dashboard.", "Check that <strong>Parents</strong> is on under Shared with, and that the section has at least one field."],
    ],
    related: ["admission-settings", "create-manage-parent", "parent-portal", "class-page", "driver-app"],
  },
];
