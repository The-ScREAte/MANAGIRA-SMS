"use strict";

// Districts & hubs: running many schools together. Pictures are taken on the local test copy's
// sample district (hub 2, "Managira Int. District", with two schools).
const link = (slug, text) => `<a href="/legal/user-documentation/${slug}">${text}</a>`;

module.exports = [
  {
    slug: "school-districts-education-hubs",
    title: "Districts and hubs: sign in and find your way around",
    topic: "Districts & hubs",
    order: 1,
    summary: "What a hub is, how district leaders sign in, what the menu and the Overview show, and who can see what.",
    tags: ["school district", "hub", "multi-school", "network", "campuses", "district oversight", "hub sign in", "hub login", "hub dashboard", "overview", "hub admin", "hub user", "central billing"],
    featured: true,
    who: "District and network leaders with a hub account: hub admins and hub users. Each school keeps its own managers, staff, students and families.",
    intro: "A hub sits above your schools. Leaders sign in to the hub to see every member school together. Each school still runs day to day in its own Managira, with its own staff and records.",
    sections: [
      {
        title: "Sign in to your hub",
        steps: [
          ["Go to <strong>managira.com/hub/login</strong>. You can also start from the regular sign-in page and choose the hub link.", "hub-login.webp", "The Hub sign in page."],
          ["Enter your <strong>Email Address</strong> and <strong>Password</strong>, then select <strong>Sign In</strong>."],
          "If you were invited, open the email first and set your password from the link. If you forget it, select <strong>Forgot password?</strong> on the sign-in page.",
        ],
        note: "Hub accounts are set up by Managira. If your district doesn't have one yet, select <strong>Contact support</strong> on the sign-in page.",
      },
      {
        title: "Find your way around",
        image: "hub-overview.webp",
        caption: "The hub's Overview. The menu is on the left.",
        text: "The menu on the left shows only what you can use. A hub user sees fewer items than a hub admin.",
        table: [
          ["Menu item", "What it's for", "Guide"],
          ["<strong>Overview</strong>", "Totals across your schools, what needs your attention and recent activity.", "This page"],
          ["<strong>Schools</strong>", "Every member school. View one, open it, edit it, put it on hold.", link("hub-manage-your-schools", "Manage your schools")],
          ["<strong>Invitations</strong>", "Schools you've invited that haven't joined yet.", link("hub-invite-a-school", "Invite a school")],
          ["<strong>Leave requests</strong>", "Schools asking to leave the hub.", link("hub-manage-your-schools", "Manage your schools")],
          ["<strong>Billing</strong>", "Your plan, card and bills.", "See below"],
          ["<strong>Reports</strong>", "Reports across your schools.", link("hub-reports", "Hub reports")],
          ["Your name, at the bottom", "Your profile, the hub's details, contact people, users and email choices.", link("hub-users-and-roles", "Hub users and roles") + " and " + link("hub-settings-and-contacts", "Hub settings")],
        ],
      },
      {
        title: "Read the Overview",
        steps: [
          ["The row of totals shows <strong>Schools</strong> (and how many places are left), <strong>Students</strong>, <strong>Staff</strong> and <strong>Classes</strong> across the whole hub. Select <strong>Schools</strong> to open the list."],
          ["<strong>Needs your attention</strong> lists what is waiting: schools asking to leave, invitations not accepted yet, schools on hold. Select a line to go there. When nothing is waiting it says <strong>All clear</strong>."],
          ["<strong>Recent activity</strong> shows what people in your hub did lately, such as opening a school.", null, null],
          ["<strong>Invite a school</strong>, at the top right, starts an invitation. It appears only if you're allowed to invite."],
        ].map((s) => (s[1] ? s : s[0])),
      },
      {
        title: "Hub admins and hub users",
        table: [
          ["Role", "What they can do"],
          ["<strong>Hub admin</strong>", "Everything: every school, invitations, billing, settings and users. The person who owns the hub is always a hub admin."],
          ["<strong>Hub user</strong>", "Only what a hub admin checked for them, for example View reports and View schools. Anything else is missing from their menu."],
        ],
        text: "See " + link("hub-users-and-roles", "Hub users and roles") + " to add people and choose what each one can do.",
      },
      {
        title: "Where to find billing",
        text: "<strong>Billing</strong> in the menu shows your plan, your card and your bills. Until Managira has set up your plan, it says <em>Billing isn't set up yet</em> and Managira sends you a link to add your card. Hub users need <strong>See billing</strong> to open it, and <strong>Manage billing</strong> to approve charges or change the card. Prices are on your hub's plan and bills, and aren't covered in this guide.",
        image: "hub-billing.webp",
        caption: "Billing, before a plan has been set up.",
      },
      {
        title: "What stays with each school",
        list: [
          "Each school's managers run their own students, staff, classes, grades and settings.",
          "You see what a hub is set up to show: totals, reports and, with the right permission, lists of students, staff and classes.",
          "You can go into a school only through <strong>Open school</strong>, which asks first and is logged. See " + link("hub-manage-your-schools", "Manage your schools") + ".",
          "Every school receives its own parents' payments. A hub pays for its schools' plans, not for what families pay.",
        ],
      },
    ],
    faq: [
      ["Can district staff see student records?", "Only a hub user who was given <strong>View students and staff</strong>, and hub admins. Anyone who opens a school itself sees what its owner sees, and the visit is logged."],
      ["How do hub users sign in?", "On the Hub sign in page, with their own email and password. Each person has their own account."],
      ["Why is an item missing from my menu?", "A hub admin checked what each hub user can see. Ask a hub admin to give you the permission."],
      ["Where do I change my password?", "Select <strong>Forgot password?</strong> on the sign-in page. It emails you a link."],
    ],
    related: ["hub-manage-your-schools", "hub-invite-a-school", "hub-users-and-roles", "hub-settings-and-contacts", "hub-reports"],
  },
  {
    slug: "hub-manage-your-schools",
    title: "Manage your schools: view, open, edit, hold and remove",
    topic: "Districts & hubs",
    order: 2,
    summary: "Look at each member school, open it as its owner, edit its details, put it on hold, answer leave requests, or take it out of the hub.",
    tags: ["hub schools", "open school", "view school", "edit school", "on hold", "resume", "remove from hub", "delete school", "leave request", "detach", "school stats", "district schools"],
    who: "Hub admins, and hub users with <strong>View schools</strong> (look), <strong>Open schools</strong>, <strong>Edit school details</strong>, <strong>Put schools on hold</strong>, <strong>Remove or delete schools</strong> or <strong>Handle leave requests</strong>.",
    intro: "The Schools page lists every school in your hub. From there you can look at a school's numbers, go into it, or change its status.",
    sections: [
      {
        title: "See your schools",
        steps: [
          ["Select <strong>Schools</strong> in the menu.", "hub-schools.webp", "Schools: every member school with its contact, numbers and status."],
          "Each row shows the school's name and web address, its contact, how many <strong>Students</strong>, <strong>Staff</strong> and <strong>Classes</strong> it has, its <strong>Status</strong> and when it <strong>Joined</strong>. Select a heading to sort.",
          ["<strong>Active</strong> means the school is working normally. <strong>On hold</strong> means its access is paused."],
        ],
      },
      {
        title: "Look at one school",
        steps: [
          ["Select <strong>View</strong> on a school's row."],
          ["The page opens on <strong>School stats</strong>: enrolled students, average score, pass rate, attendance rate, score entry, students needing support, active classes and staff. Use the term list to look at another term. <strong>Download PDF</strong> and <strong>Print</strong> give you the report.", "hub-school-detail.webp", "One school's page."],
          ["The tabs <strong>Students</strong>, <strong>Staff</strong> and <strong>Classes &amp; subjects</strong> list people and classes. Search, then pick a name to see their details on the right.", "hub-school-students.webp", "The Students tab."],
        ],
        note: "The Students, Staff and Classes tabs show only if you have <strong>View students and staff</strong>.",
      },
      {
        title: "Open a school",
        text: "<strong>Open school</strong> takes you into the school's own Managira, with what its owner sees.",
        steps: [
          ["Select <strong>Open school</strong> on the school's row, or at the top of its page."],
          ["Read the question, then select <strong>Open school</strong>. Select <strong>Cancel</strong> to stay in the hub."],
          "When you're done, use <strong>Back to hub</strong> at the top left to return to your hub.",
        ],
        warning: "Every visit is logged with your name. A school that is on hold can't be opened until you resume it.",
      },
      {
        title: "Edit a school's details",
        steps: [
          ["Select the <strong>⋯</strong> menu on the row, then <strong>Edit details</strong>. On a school's own page, select <strong>Edit details</strong>."],
          ["Change the <strong>School name</strong>, <strong>Phone</strong>, <strong>Address</strong>, <strong>Country</strong> or <strong>Region / state</strong>, and choose a <strong>Hub contact</strong> for the school. The web address and email are shown but can't be changed here."],
          "Select <strong>Save</strong>.",
        ],
        tip: "If your hub has more than one plan, a <strong>Plan</strong> choice appears here too. Leave it on the hub default unless a school needs another.",
      },
      {
        title: "Put a school on hold, or take it out",
        steps: [
          "Open the <strong>⋯</strong> menu on the school's row.",
          "<strong>Put on hold</strong> pauses the school's access. Choose <strong>Resume</strong> to let it work again.",
          "<strong>Remove from hub</strong> takes the school out of your hub. <strong>Delete permanently</strong> deletes it. Both ask you to confirm.",
        ],
        warning: "Deleting a school can't be undone. Use <strong>Remove from hub</strong> if you only want it out of your hub.",
      },
      {
        title: "Answer a leave request",
        text: "A school's manager can ask to leave your hub and become independent. The request shows under <strong>Leave requests</strong>, with the reason they gave.",
        steps: [
          ["Select <strong>Leave requests</strong> in the menu.", "hub-requests.webp", "Leave requests. This hub has none waiting."],
          "Select <strong>Approve</strong> to let the school go. It becomes independent, gets its own web address and needs its own plan. Its students, staff, classes and records stay with it.",
          "Select <strong>Reject</strong> to keep it, and write a short note so the school knows why.",
        ],
        note: "Approving can't be undone.",
      },
    ],
    faq: [
      ["Why can't I open a school?", "It may be on hold (resume it first), or you may not have <strong>Open schools</strong>. Ask a hub admin."],
      ["Does opening a school change anything?", "No. You see what its owner sees, and any change you make there is yours to answer for. The visit is logged."],
      ["What happens to a school's data if it leaves?", "Nothing is deleted. Its students, staff, classes and records stay with the school."],
    ],
    related: ["school-districts-education-hubs", "hub-invite-a-school", "hub-users-and-roles", "roles-and-permissions"],
  },
  {
    slug: "hub-invite-a-school",
    title: "Invite a school to your hub",
    topic: "Districts & hubs",
    order: 3,
    summary: "Invite a brand-new school, or a school already on Managira by its exact sign-in email, and follow the invitation until it's accepted.",
    tags: ["invite school", "hub invitation", "add school to hub", "join hub", "accept invitation", "existing school", "new school", "places", "resend invitation", "cancel invitation"],
    who: "Hub admins, and hub users with <strong>Invite schools</strong>. The school's manager accepts.",
    intro: "A hub can have a set number of schools. You invite a school one of two ways: as a new school that sets up its account from your invitation, or as a school that already uses Managira.",
    sections: [
      {
        title: "Start an invitation",
        steps: [
          ["Select <strong>Invite a school</strong> on the Overview, Schools or Invitations page."],
          ["The window shows how many places you've used (for example <em>2 of 5 places used</em>). Choose <strong>New school</strong> or <strong>On Managira</strong>.", "hub-invite-choose.webp", "Two ways to invite."],
        ],
        note: "When all your places are used, Managira tells you. Contact support to add more.",
      },
      {
        title: "Invite a new school",
        steps: [
          ["Select <strong>New school</strong>. Fill in the <strong>School name</strong>, <strong>Contact person</strong> and <strong>Contact email</strong>. <strong>Phone number</strong>, <strong>Hub contact</strong> and <strong>Message</strong> are optional.", "hub-invite-new.webp", "The new school form."],
          ["Select <strong>Send</strong>. The contact person gets an email with a link."],
        ],
        tip: "Choose a <strong>Hub contact</strong> so the school knows who to call. They are shown in the school's Settings once you share them. See " + link("hub-settings-and-contacts", "Hub settings and contact people") + ".",
      },
      {
        title: "Invite a school that is already on Managira",
        text: "To protect every school's privacy, no page lists Managira's schools. You find one by the exact email it signs in with.",
        steps: [
          ["Select <strong>On Managira</strong>, then type the school's full sign-in email."],
          ["When the email matches, only the school's name is shown. Select <strong>Invite</strong>."],
        ],
        note: "The email must be the one the school's owner signs in with. You can't search by name, and the school's address is never shown to you.",
      },
      {
        title: "Follow your invitations",
        steps: [
          ["Select <strong>Invitations</strong> in the menu. Each waiting invitation shows the school, whether it is a <strong>New school</strong> or an <strong>Existing school</strong>, the contact, and when it was sent and expires.", "hub-invitations.webp", "Invitations still waiting for an answer."],
          ["<strong>Resend</strong> sends the email again. <strong>Cancel invitation</strong> withdraws it, after you confirm."],
        ],
      },
      {
        title: "What the school does",
        subsections: [
          {
            title: "A new school",
            steps: [
              "The contact person opens the link in the email.",
              "They choose the school's nickname, then enter the manager's name, email, phone and a password.",
              "They accept the Terms and the Privacy Policy and submit. The school is created inside your hub, with a web address under your hub's name.",
            ],
          },
          {
            title: "A school already on Managira",
            steps: [
              "The school's manager opens the link in the email. The page names your hub and lists what changes: the school's web address, billing by the hub, and its place in the hub.",
              "It also says what stays the same: all its students, staff, classes and records, its sign-in, and control of day-to-day work.",
              "The manager checks the box to confirm, then selects <strong>Accept &amp; Join Hub</strong>. <strong>Decline</strong> turns the invitation down.",
            ],
          },
        ],
        text: "Once accepted, the school appears under <strong>Schools</strong> and the invitation leaves the list. You are told by email if you chose that notification.",
      },
    ],
    faq: [
      ["The school says its link has expired.", "Select <strong>Resend</strong> on the invitation, or cancel it and send a new one."],
      ["Managira says no school uses that email.", "Check the spelling. It must be the email the school's owner signs in with, not a staff member's or a general office address. If the school is new to Managira, invite it as a <strong>New school</strong>."],
      ["Does the school lose its data by joining?", "No. Its students, staff, classes and records stay as they are. Its web address and billing change, because the hub now pays for its plan."],
    ],
    related: ["hub-manage-your-schools", "school-districts-education-hubs", "hub-settings-and-contacts"],
  },
  {
    slug: "hub-users-and-roles",
    title: "Hub users and roles: add people and choose what they can do",
    topic: "Districts & hubs",
    order: 4,
    summary: "Add district staff to your hub as hub admins or hub users, choose their permissions, and resend, hold or remove them.",
    tags: ["hub users", "hub admin", "hub roles", "hub permissions", "add user to hub", "district staff", "invite hub user", "users and roles", "on hold", "last sign-in", "licenses"],
    who: "Hub admins, and hub users with <strong>Manage hub users</strong>.",
    intro: "Anyone at your district who needs the hub gets their own account. A hub admin sees and does everything. A hub user sees and does only what you check for them.",
    sections: [
      {
        title: "Open Users & roles",
        steps: [
          ["Select your name at the bottom of the menu, then the <strong>Users &amp; roles</strong> tab.", "hub-settings-users.webp", "Users &amp; roles. The owner is always listed first."],
          ["The table shows each <strong>Person</strong>, their <strong>Role</strong>, what they <strong>Can see and do</strong>, their <strong>Status</strong> and their <strong>Last sign-in</strong>."],
        ],
        list: [
          "<strong>Active</strong>: they have set a password and can sign in.",
          "<strong>Invited</strong>: the email went out but they haven't set a password yet.",
          "<strong>On hold</strong>: they can't sign in until you resume them.",
        ],
        note: "The owner of the hub is set by Managira and can't be changed here. If your plan limits users, the page says how many user licenses are used.",
      },
      {
        title: "Add a user",
        steps: [
          ["Select <strong>Add a user</strong>."],
          ["Enter their <strong>First name</strong>, <strong>Last name</strong> and <strong>Email</strong>. <strong>Phone</strong> and <strong>Job title</strong> are optional. Turn on <strong>Contact person</strong> to list them as someone schools can reach, and <strong>Share with schools</strong> to show them on the schools' Settings page.", "hub-user-form.webp", "Add user opens at the right."],
          ["Choose a <strong>Role</strong>: <strong>Hub admin</strong> or <strong>Hub user</strong>."],
          "For a hub user, check their permissions. <strong>Select all</strong> and <strong>Clear</strong> help. A hub admin gets everything.",
          "Under <strong>Sign-in</strong>, choose <strong>Email invitation</strong> (they set their own password) or <strong>Set password</strong> (you type one, or select <strong>Generate</strong>, and give it to them).",
          "Select <strong>Add</strong>.",
        ],
      },
      {
        title: "What each permission allows",
        table: [
          ["Group", "Permission", "Lets them"],
          ["Reports", "<strong>View reports</strong>", "Open Reports and the saved reports."],
          ["Reports", "<strong>Build and save reports</strong>", "Make new reports across your schools and save them."],
          ["Reports", "<strong>Download and print reports</strong>", "Download CSV files, print or save as PDF."],
          ["Schools", "<strong>View schools</strong>", "Open each school and see its report."],
          ["Schools", "<strong>View students and staff</strong>", "See student, staff and class lists and their details."],
          ["Schools", "<strong>Open schools</strong>", "Go into a school's own account, like its owner. Every visit is logged."],
          ["Schools", "<strong>Edit school details</strong>", "Change a school's name, address, country and phone."],
          ["Schools", "<strong>Put schools on hold</strong>", "Pause and resume a school's access."],
          ["Schools", "<strong>Remove or delete schools</strong>", "Take a school out of the hub or delete it."],
          ["Invitations &amp; requests", "<strong>Invite schools</strong>", "Send, resend and cancel invitations."],
          ["Invitations &amp; requests", "<strong>Handle leave requests</strong>", "Approve or decline schools asking to leave."],
          ["Hub settings", "<strong>Edit hub details</strong>", "Change the hub's address, phone and logo."],
          ["Hub settings", "<strong>Manage contact people</strong>", "Add and edit the people schools can contact."],
          ["Hub settings", "<strong>Manage hub users</strong>", "Add users and choose their role and permissions."],
          ["Billing", "<strong>See billing</strong>", "See the plan, charges, bills and payments."],
          ["Billing", "<strong>Manage billing</strong>", "Approve or decline charges, add paid extras and change the card."],
        ],
        tip: "Start new hub users with <strong>View reports</strong> and <strong>View schools</strong>. Add more only when they need it.",
      },
      {
        title: "Change, hold or remove someone",
        steps: [
          ["On their row, select <strong>Edit</strong> to change their details, role or permissions.", null, null],
          "Open the <strong>⋯</strong> menu on their row for the rest: <strong>Email a password reset link</strong> (or <strong>Resend invitation</strong> if they haven't signed in yet), <strong>Put on hold</strong> (then <strong>Resume access</strong>), or remove them from the hub.",
          "Removing someone ends their access at once, after you confirm.",
        ].map((s) => (Array.isArray(s) ? s[0] : s)),
        note: "You can't change your own role or permissions, or put yourself on hold.",
      },
    ],
    faq: [
      ["A hub user can't see something they need.", "Open their row, select <strong>Edit</strong> and check the permission. The menu changes the next time they load a page."],
      ["Does a hub user see student details?", "Only with <strong>View students and staff</strong>. Without it they see totals and reports only."],
      ["They never got the invitation email.", "Open the <strong>⋯</strong> menu on their row and select <strong>Resend invitation</strong>. Ask them to check their spam folder."],
      ["Can a hub user also be a school's staff member?", "Yes, but they sign in to each separately. A hub account is for the hub only."],
    ],
    related: ["school-districts-education-hubs", "hub-settings-and-contacts", "hub-manage-your-schools", "roles-and-permissions"],
  },
  {
    slug: "hub-settings-and-contacts",
    title: "Hub settings: your profile, the hub's details, contact people and emails",
    topic: "Districts & hubs",
    order: 5,
    summary: "Change your profile and look, update the hub's logo, phone and address, list the people schools can contact, and choose which hub emails you get.",
    tags: ["hub settings", "hub profile", "hub logo", "hub address", "contact people", "share with schools", "main contact", "hub notifications", "appearance", "dark mode"],
    who: "Every hub person for their own profile and emails. <strong>Edit hub details</strong> and <strong>Manage contact people</strong> are separate permissions.",
    intro: "Settings has four tabs. Open it by selecting your name at the bottom of the hub menu.",
    sections: [
      {
        title: "Open Settings",
        image: "hub-settings.webp",
        caption: "Settings, with your name at the bottom of the menu ringed.",
        steps: [
          ["Select your name at the bottom of the menu."],
          ["Choose a tab: <strong>General</strong>, <strong>Contact people</strong>, <strong>Users &amp; roles</strong> or <strong>Notifications</strong>."],
        ],
      },
      {
        title: "General: you and the hub",
        list: [
          "<strong>Your profile</strong> shows your name, email and role. Select <strong>Edit</strong> to change your name, phone and job title. To change your password, use <strong>Forgot password?</strong> on the sign-in page.",
          "<strong>Appearance</strong> offers <strong>Light</strong>, <strong>Classic</strong> and <strong>Dark</strong>. It's just for you.",
          "<strong>Hub details</strong> shows the hub's owner, phone, address, plan, places used and logo. Select <strong>Edit</strong> to change the phone, address or logo. It appears only if you have <strong>Edit hub details</strong>.",
        ],
      },
      {
        title: "Contact people",
        text: "These are the people your schools can call or email. A school sees the ones you share on its own <strong>Settings</strong> page, under <strong>Your hub</strong>.",
        steps: [
          ["Open the <strong>Contact people</strong> tab and select <strong>Add contact</strong>.", "hub-settings-contacts.webp", "Each contact is a card."],
          "Enter the <strong>Full name</strong>, and optionally <strong>Job title</strong>, <strong>Email</strong> and <strong>Phone</strong>. Turn on <strong>Share with schools</strong> to show them to schools.",
          "Use <strong>Edit</strong> on a card to change it, <strong>Make main</strong> to make them the main contact, or the bin to delete the card.",
        ],
        note: "A school can also be given its own hub contact when you invite it or edit its details. The school sees that person marked <em>Your contact</em>.",
      },
      {
        title: "Notifications",
        steps: [
          ["Open the <strong>Notifications</strong> tab. Each switch is one email: a weekly hub overview, a school joining, invitations sent, a school asking to leave, school status changes, hub user changes, and billing and payments."],
          "You only see the emails your permissions allow. Security and membership emails are always sent.",
        ],
      },
    ],
    faq: [
      ["Why is there no Edit button on Hub details?", "You need the <strong>Edit hub details</strong> permission. Ask a hub admin."],
      ["Who sees my contact card?", "Schools in your hub, only when <strong>Share with schools</strong> is on."],
      ["Can I change the hub's web address?", "No. It's set when Managira creates the hub."],
    ],
    related: ["school-districts-education-hubs", "hub-users-and-roles", "hub-invite-a-school"],
  },
  {
    slug: "hub-reports",
    title: "Hub reports: compare your schools",
    topic: "Districts & hubs",
    order: 6,
    summary: "Build a report across your schools in three steps, save it for everyone with report access, and download or print it.",
    tags: ["hub reports", "district report", "compare schools", "attendance report", "academic performance", "enrollment and staffing", "school comparison", "saved reports", "download csv", "print"],
    who: "Hub admins, and hub users with <strong>View reports</strong>. <strong>Build and save reports</strong> and <strong>Download and print reports</strong> are separate permissions.",
    intro: "Reports puts the numbers of all your schools side by side. Saved reports are shared with everyone in the hub who can view reports.",
    sections: [
      {
        title: "Open Reports",
        steps: [
          ["Select <strong>Reports</strong> in the menu. Saved reports are listed; open one to see it again.", "hub-reports.webp", "Reports saved by your hub."],
          ["Select <strong>New report</strong> to build another."],
        ],
      },
      {
        title: "Build a report in three steps",
        steps: [
          ["<strong>Report</strong>: choose what to compare. The choices are <strong>Attendance</strong>, <strong>Academic performance</strong>, <strong>Gender</strong>, <strong>Marks entry</strong>, <strong>Students needing support</strong>, <strong>Enrollment &amp; staffing</strong> and <strong>School comparison</strong>. Select <strong>Continue</strong>."],
          "<strong>Columns</strong>: check the columns you want, then <strong>Continue</strong>.",
          "<strong>Schools and term</strong>: choose which schools and which term. Leave <strong>Leave out schools with no data for the term</strong> checked to skip empty ones.",
          "Select <strong>Generate report</strong>.",
        ],
      },
      {
        title: "Save, download and print",
        list: [
          "<strong>Save this report</strong>, then <strong>Save</strong>, to keep it in the list for everyone who can view reports.",
          "<strong>CSV</strong> downloads the table as a file. <strong>Print or PDF</strong> prints it or saves it as a PDF. You need <strong>Download and print reports</strong> for these.",
          "Each school's own page also has a report you can download as a PDF or print. See " + link("hub-manage-your-schools", "Manage your schools") + ".",
        ],
      },
    ],
    faq: [
      ["Why is a school missing from my report?", "It may have no data for that term and you left <strong>Leave out schools with no data for the term</strong> on. Uncheck it, or pick another term."],
      ["Can I change a saved report?", "Build a new one with the changes you need. A saved report stays as it was saved."],
    ],
    related: ["school-districts-education-hubs", "hub-manage-your-schools", "report-builder"],
  },
];
