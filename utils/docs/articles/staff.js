"use strict";

// Staff & permissions: adding staff, giving each person exactly what their job needs.
// Pictures come from ~/.managira-local-copy/tools/docshots/scripts/staff-accounts.js (and classroom-more.js).
module.exports = [
  {
    slug: "create-and-manage-employee-accounts-and-permissions",
    title: "Add and manage staff: Users / Employees",
    topic: "Staff & permissions",
    order: 1,
    summary: "Find your staff, add a teacher, supervisor, manager or driver, choose their role, classes and permissions, and put someone on hold or remove them.",
    tags: ["add staff", "employees", "users", "teachers", "invite staff", "add user", "edit user", "hold staff", "remove staff", "restore staff", "add a teacher", "add a new teacher", "new staff member", "assign a teacher to a class", "main teacher", "give a teacher access to only their class", "limit a teacher to their class", "invitation", "authenticator", "custom role", "allow all permissions", "staff list"],
    featured: true,
    who: "Managers, and staff given <strong>Users / Employees</strong> with its follow-ups <strong>Add Staff</strong>, <strong>Edit Staff &amp; Access</strong> and <strong>Hold &amp; Remove Staff</strong>.",
    intro: "Everyone who signs in for your school has an account in <strong>Users / Employees</strong>. A person's <strong>role</strong> describes their job and their <strong>permissions</strong> decide what they can see and do, so each person gets what their work needs and nothing more.",
    sections: [
      {
        title: "Open Users / Employees",
        image: "staff-list.webp",
        caption: "Management › Users / Employees: everyone on your staff, with their role and last sign-in.",
        steps: [
          ["Go to <strong>Management › Users / Employees</strong>."],
          ["Read the columns: <strong>Status</strong>, <strong>Name</strong>, <strong>Email</strong>, <strong>Role</strong>, <strong>Last sign-in</strong>, <strong>Classes</strong> and <strong>Subjects</strong>. Select a column heading to sort by it. When your school uses single sign-on, a <strong>Sign-in</strong> column says how each person signs in."],
        ],
        list: [
          "<strong>Active</strong> means they have signed in. <strong>Invite sent</strong> means the invitation hasn't been used yet. <strong>On hold</strong> and <strong>Removed</strong> can't sign in.",
          "The list shows 20 people at a time. Use the page bar under it: <strong>Rows per page</strong> (10, 20, 50, 100 or 200), the range, and the arrows.",
          "Select anyone's row to open their card on the right with their email, role, title, how they sign in, last sign-in and classes.",
        ],
        note: "Teachers and supervisors don't have this page. They see only their own classes and the staff they share them with, from the header search.",
      },
      {
        title: "Find someone: filters",
        steps: [
          ["Select <strong>Filters</strong> at the top right of the page."],
          ["Search by <strong>Name</strong> or <strong>Email</strong>, or narrow the list by <strong>Status</strong> (<em>Current users</em>, <em>Active</em>, <em>Invite sent</em>, <em>On hold</em> or <em>Removed (disabled)</em>), <strong>Role</strong>, <strong>Permission</strong>, and <strong>Last sign-in</strong> dates (or <strong>Never signed in</strong>). A line at the bottom says how many people match.", "staff-filters-zoom.webp", "Filters can be combined. Clear puts everyone back."],
          "Select <strong>Clear</strong> to see everyone again.",
        ],
        tip: "To find who can do something, choose it under <strong>Permission</strong>. For example, pick <strong>Mark Attendance</strong> to see everyone who can take attendance.",
      },
      {
        title: "Add a staff member",
        steps: [
          ["Select <strong>Add user</strong>. The form opens beside the list.", "staff-add-form.webp", "Add user: details, role, classes, permissions."],
          ["Enter their <strong>First name</strong>, <strong>Last name</strong> and <strong>Email</strong>. <strong>Date of birth</strong> is optional."],
          ["Choose a <strong>Role</strong>: <em>Manager</em>, <em>Supervisor</em>, <em>Teacher</em> or <em>Driver</em>, or one of <em>Your school's roles</em>. Until you do, the form says <em>Choose a role to see its permissions</em>. Driver shows only while transportation is on."],
          "For a teacher or driver, choose their classes (see <strong>Pick classes, subjects and main teacher</strong> below). For a driver, choose classes only; drivers don't get subjects.",
          "Check the permissions. Choosing a role switches on its basics at once; change them if you need to (see <strong>Choose permissions</strong>).",
          ["Check <strong>I confirm I am adding this person…</strong>. It's your record that you're allowed to give this access, and it is saved with your name and the date. If you change the role or a permission afterwards, check it again."],
          ["Select <strong>Create</strong>."],
        ],
        note: "The person gets an email with a link to set their password, and their status is <strong>Invite sent</strong> until they sign in. If your school uses single sign-on, someone set to sign in that way gets <strong>Log in with</strong> your provider instead of a password link.",
      },
      {
        title: "Pick classes, subjects and main teacher",
        steps: [
          ["Open <strong>Classes &amp; Subjects</strong>. The line says how many classes are selected. Use <strong>Search classes</strong> to find one in a long list.", "staff-add-classes-zoom.webp", "Check a class, then the subjects the person teaches in it."],
          "Check the class. Its subjects appear under it: check the ones this person teaches, or <strong>Select All Subjects</strong>.",
          "Beside the class, check <strong>Main teacher</strong> to put them in charge of it, or <strong>Assistant teacher</strong> to have them help run it. A class has one main teacher. If someone already leads it, their name shows there instead of a box: open that person and uncheck it first.",
        ],
        tip: "Classes with nobody in charge are listed in a yellow bar at the top of <strong>Users / Employees</strong>. Select <strong>Choose</strong>, pick a teacher beside each class, and select <strong>Put in charge</strong>. See <a href=\"/legal/user-documentation/assistant-teachers\">Main and assistant teachers</a>.",
      },
      {
        title: "Choose permissions",
        steps: [
          ["Under <strong>Permissions</strong>, the role's basics are already switched on, in a few groups. Switch a permission on or off. A small arrow beside it opens its follow-ups, such as <strong>Add Staff</strong> under <strong>Users / Employees</strong>.", "staff-add-presets-zoom.webp", "A Teacher starts with a short list."],
          ["Need more? Open <strong>Advanced permissions</strong>. Every other permission is there, grouped by area. Anything you add beyond the role's basics is marked <strong>Extra</strong>, and the button counts them.", "staff-add-advanced-zoom.webp", "Advanced permissions."],
          ["For a Manager, <strong>Allow all permissions</strong>, at the bottom of Advanced, switches on every permission the role shows."],
          ["<strong>High risk - Managers only</strong> holds permissions that can change many records or money at once. It shows only when the role is Manager."],
        ],
        note: "A permission outside your school's plan can't be given to anyone, managers included. See <a href=\"/legal/user-documentation/roles-and-permissions\">Roles and permissions</a> for what each one does.",
      },
      {
        title: "Make a role of your own",
        text: "When a job isn't one of the four, such as Food Service or Front office, make a role for it once and use it again.",
        steps: [
          ["In the <strong>Role</strong> list, choose <strong>＋ Add a role</strong>. Type a <strong>Role name</strong>, choose the role it is <strong>Based on</strong> (Teacher, Supervisor, Manager or Driver), and select <strong>Add role</strong>."],
          "Check the permissions the role should have. Select <strong>Save to this role</strong> to keep them for the next person, or <strong>Remove role</strong> to delete it.",
        ],
        list: [
          "The role's account type is the one it's based on, so everything that depends on Manager, Supervisor, Teacher or Driver still works. The Users list shows the role's name.",
          "A role only checks permissions. Each person's saved permissions are what count.",
          "Nobody can make or change a role that gives more than they could give themselves. Only a manager makes a Manager-based role.",
        ],
      },
      {
        title: "How they sign in (single sign-on schools)",
        text: "When your school has single sign-on turned on, the form has a <strong>Sign-in</strong> choice: your provider's name, or <strong>Managira password</strong> (<em>Emails a link to set one</em>). A new person starts on the provider. The school's main manager always keeps a password. See <a href=\"/legal/user-documentation/single-sign-on\">Single sign-on</a>.",
      },
      {
        title: "Edit someone",
        steps: [
          ["Select their row, then <strong>Edit</strong> in their card. You can also change their name, email, classes, subjects, role and permissions here.", "staff-panel.webp", "Their card, with Edit at the bottom."],
          ["The form shows exactly the access they have today. Change what you need, check the confirmation, and select <strong>Save</strong>."],
        ],
        note: "Unchecking a permission really removes it, even if the role would normally include it. Changing the role switches on the new role's basics; anything you added beyond the old basics stays under Advanced. Opening and saving without changes leaves access exactly as it was. The change applies the next time they open a page.",
      },
      {
        title: "Require an authenticator app for one person",
        text: "On the Edit user page, a manager can check <strong>Require authenticator app</strong>. When that person next signs in with a password, Managira takes them to Settings to set up the app, then asks for its code at sign-in. To require it for a whole group, use Settings › Tenant configuration. See <a href=\"/legal/user-documentation/two-step-sign-in\">Two-step sign-in</a>.",
      },
      {
        title: "Hold, remove and restore",
        image: "staff-edit-actions-zoom.webp",
        caption: "Save, Hold Employee and the trash can (Remove user) at the bottom of Edit user.",
        list: [
          "<strong>Hold Employee</strong> pauses their sign-in and keeps everything. It turns into <strong>Resume Employee</strong> while they're on hold. Use it for leave.",
          "The <strong>trash can</strong> (<strong>Remove user</strong>) is for someone who has left for good. Their records, such as grades they entered, stay. Managira asks you to confirm.",
          "To bring someone back, set <strong>Status</strong> to <strong>Removed (disabled)</strong>, open their card and select <strong>Enable</strong>.",
        ],
        note: "Hold and remove need <strong>Hold &amp; Remove Staff</strong>.",
      },
      {
        title: "What each person may change",
        text: "Only a manager can change another manager. Only a manager can change their own account through these pages; everyone else changes their own details in Settings. Someone who isn't a manager adds, changes, holds or removes only staff at or below their own role (the order is Manager, Supervisor, Teacher, Driver, so a lead driver works on drivers). They can give only permissions they hold themselves; what they can't give stays as it was.",
      },
    ],
    faq: [
      ["A teacher can't see their class.", "Check the class is checked on their record in Users / Employees, and that it is enrolled in the current term."],
      ["A teacher can't take attendance.", "Attendance is for the class's main teacher and assistants. Check <strong>Main teacher</strong> or <strong>Assistant teacher</strong> beside the class on their record, and check they have <strong>Mark Attendance</strong>."],
      ["Can someone have two roles?", "No. Each person has one role. Give them the extra permissions their other job needs, or make a role of your own."],
      ["The invitation email didn't arrive.", "Check the address for typos and ask them to look in spam. Correct the email on Edit user if it was wrong."],
      ["Create is grayed out.", "Check the confirmation box above it. It needs a fresh check after you change the role or a permission."],
      ["Why don't I see Add user?", "You need <strong>Users / Employees</strong> with <strong>Add Staff</strong>."],
    ],
    related: ["roles-and-permissions", "assistant-teachers", "your-access", "single-sign-on", "two-step-sign-in", "driver-app"],
  },
  {
    slug: "roles-and-permissions",
    title: "Roles and permissions explained",
    topic: "Staff & permissions",
    order: 2,
    summary: "What Manager, Supervisor, Teacher and Driver start with, how permissions are grouped, which ones are high risk, and why some can't be given.",
    tags: ["roles", "permissions", "access control", "manager", "teacher", "supervisor", "driver", "high risk", "extra", "advanced permissions", "plan features", "follow-up permission", "allow all permissions"],
    who: "Managers and anyone who sets up staff access.",
    intro: "A <strong>role</strong> is a person's job and a <strong>permission</strong> is one thing they may do. Choosing a role switches on the few permissions that job needs every day. Everything else is a deliberate step in <strong>Advanced permissions</strong>, and a person's saved permissions are always what count.",
    sections: [
      {
        title: "The four roles",
        table: [
          ["Role", "Typically does"],
          ["<strong>Manager</strong>", "Runs the school: staff, settings and every workspace. Only managers change other managers, single sign-on and sign-in rules."],
          ["<strong>Supervisor</strong>", "Oversees classes and staff: students, reports and day-to-day administration, as permitted."],
          ["<strong>Teacher</strong>", "Their own classes: attendance, assessments and scores, activities, the Pickup list, and the settings of classes they lead."],
          ["<strong>Driver</strong>", "The driver app: their runs, boarding and reports. A <strong>Lead Driver</strong> can also manage other drivers."],
        ],
        note: "Roles rank Manager, Supervisor, Teacher, Driver. Someone who isn't a manager can only give a role at or below their own. For other jobs, make a role of your own on the staff form. See <a href=\"/legal/user-documentation/create-and-manage-employee-accounts-and-permissions\">Add and manage staff</a>.",
      },
      {
        title: "What each role starts with",
        table: [
          ["Role", "Basic permissions"],
          ["<strong>Teacher</strong>", "Their own classes only: their students, Mark Attendance, Manage Assessments &amp; Scores, Class Settings (for classes they lead), Terminal Reports, Use Mira. No staff, finance, settings or website. A new teacher doesn't start with Enrollment, Graduates &amp; alumni or Report settings."],
          ["<strong>Supervisor</strong>", "See, add and edit students, Mark Attendance, Manage Assessments &amp; Scores, Terminal Reports, announcements and events, Use Mira."],
          ["<strong>Manager</strong>", "Users / Employees (add, edit and hold staff), students (not deleting them), classes and subjects, attendance, assessments, reports and report settings, announcements and events, Use Mira. Billing, settings, terms and promotions are in <em>High risk - Managers only</em>."],
          ["<strong>Driver</strong>", "The Driver dashboard: their routes and riders. Anything more is chosen per driver."],
        ],
        note: "These presets only pre-tick the form. Once someone is saved, their saved permissions are authoritative: unchecking one removes it even if the role normally includes it.",
      },
      {
        title: "How the permission list is laid out",
        image: "staff-add-presets-zoom.webp",
        caption: "Basics first, then Advanced permissions.",
        list: [
          "The basics are grouped (for example <em>Students &amp; families</em> and <em>Classes, attendance &amp; assessments</em>). A count such as <em>1 of 3</em> shows how many follow-ups are on.",
          "A <strong>follow-up</strong> sits under a main permission and counts only while the main one is on. <strong>Add Staff</strong> works only with <strong>Users / Employees</strong>.",
          "<strong>Advanced permissions</strong> lists every other permission by group. One you add beyond the role's basics is marked <strong>Extra</strong>.",
        ],
      },
      {
        title: "Permission groups",
        table: [
          ["Group", "Permissions"],
          ["People", "Users / Employees (Add Staff, Edit Staff &amp; Access, Hold &amp; Remove Staff), Manage Students (Add, Edit and Delete Students, Enrollment, Graduates &amp; alumni), Manage Guardians, See Contacts, Edit Contact Template"],
          ["Academics", "Manage Classes &amp; Subjects, Manage Assessments &amp; Scores (Set Assessment Questions), Assess Other School Years, Mark Attendance, Class Settings (Every Class), Manage School Records, Manage School Years &amp; Terms"],
          ["Admissions &amp; Promotions", "Approve Admissions, Approve Promotions, Manage Promotions"],
          ["Reports", "Manage Reports/Printing (Terminal Reports, Report Builder, Report Settings), Generate Transcripts"],
          ["Communication", "Publish Events &amp; Announcements, Mailroom, Use Mira"],
          ["Transportation", "Transportation (Buses, Manage Drivers, Routes &amp; Stops, Schedules, Rider List, Student Stops &amp; Routes, Driver Reports), Class Bus Reports"],
          ["Driver", "Lead Driver, Student Details, Pickup &amp; Emergency, Reports, School Website, Any Route"],
          ["Finance", "PayGira (with its pages), Manage Billing"],
          ["Administration", "Manage Organization Settings, Single Sign-On, Custom Editor"],
        ],
        note: "Transportation and Driver permissions exist only while transportation is turned on for your school.",
      },
      {
        title: "High-risk permissions",
        text: "These can change many records, or money, at once. They aren't part of any role's basics and show only when the role is Manager: <strong>Users / Employees</strong>, <strong>Edit Staff &amp; Access</strong>, <strong>Hold &amp; Remove Staff</strong>, <strong>Delete Students</strong>, <strong>Every Class</strong>, <strong>Manage School Years &amp; Terms</strong>, <strong>Approve Promotions</strong>, <strong>Manage Billing</strong>, <strong>Manage Organization Settings</strong> and <strong>Single Sign-On</strong>. Someone who already holds one keeps seeing it, marked <strong>Extra</strong>.",
      },
      {
        title: "Class settings, Mira and plans",
        list: [
          "<strong>Class Settings</strong> lets someone change the settings of the classes they lead as main or assistant teacher. Its follow-up <strong>Every Class</strong> adds every class, from Management. See <a href=\"/legal/user-documentation/class-settings\">Class settings</a>.",
          "<strong>Use Mira</strong> is set per person. Mira can do only what the person asking may do, and says which permission is missing. See <a href=\"/legal/user-documentation/mira-ai-assistant\">Mira</a>.",
          "A feature outside your school's plan can't be given to anyone, managers included, and the form doesn't offer it.",
        ],
      },
    ],
    faq: [
      ["Why can't I give a permission?", "It may be outside your school's plan, a follow-up whose main permission is off, or a permission you don't hold yourself. Someone who isn't a manager can give only what they have."],
      ["Where are Billing, Settings and the other high-risk permissions?", "In <em>High risk - Managers only</em> inside Advanced permissions, and only while the role is Manager."],
      ["I switched the role. Did I lose what I added?", "No. Extras you added beyond the old role's basics are kept under Advanced."],
      ["Do parents and students have permissions?", "No. They use their own portals and see only their own family's or their own information."],
    ],
    related: ["create-and-manage-employee-accounts-and-permissions", "your-access", "assistant-teachers", "mira-ai-assistant", "single-sign-on"],
  },
  {
    slug: "your-access",
    title: "Your access: your role, classes and what you can do",
    topic: "Staff & permissions",
    order: 20,
    summary: "See your role, your classes and what you can and can't do in Managira. Managers can see anyone's, with the history of changes.",
    tags: ["your access", "my access", "my role", "what can i do", "what can i do in managira", "what i have access to", "see my access", "role history", "access history", "first sign in", "what can they do", "why can't i see"],
    who: "Every member of staff sees their own. Managers can open anyone's.",
    intro: "<strong>Your access</strong> says, in plain words, what your account lets you do: your role, your classes and whether you are the main or an assistant teacher, and what you can and can't do. If your school moved to Managira from another system, it also shows your roles there.",
    sections: [
      {
        title: "Open your access",
        image: "your-access-page.webp",
        caption: "Your access for a teacher: role, classes, and what they can do.",
        steps: [
          "Select <strong>?</strong> at the top of Managira, then <strong>Your access</strong>.",
          ["Read <strong>Role</strong>, then <strong>Classes</strong>. A teacher sees only the classes listed, with <strong>Main teacher</strong> or <strong>Assistant</strong> beside each and the subjects they teach."],
          "Scroll to <strong>What you can do</strong> for each permission with what it covers, and <strong>Not included</strong> for what you can't do.",
        ],
        note: "The school's own account doesn't have this page. Staff whose accounts came from your school's old system see it the first time they open Managira. Drivers see only driving.",
      },
      {
        title: "See someone else's (managers)",
        text: "A manager can open any member of staff's access page. It adds their roles in your old system (read-only, with dates) and a log of every change to their role, permissions or classes: who made it, when, and what it was before and after.",
      },
      {
        title: "Something isn't right",
        text: "Ask a manager at your school. They change roles, permissions and classes in Users / Employees. See <a href=\"/legal/user-documentation/create-and-manage-employee-accounts-and-permissions\">Add and manage staff</a>.",
      },
    ],
    faq: [
      ["I can't find a page I used to use.", "Open Your access and check <strong>What you can do</strong>. A manager may have changed your permissions, and the log shows when."],
      ["Why does it say I see only some classes?", "Teachers see only the classes they are assigned to."],
    ],
    related: ["create-and-manage-employee-accounts-and-permissions", "roles-and-permissions", "assistant-teachers", "moving-to-managira"],
  },
  {
    slug: "assistant-teachers",
    title: "Assistant teachers",
    topic: "Staff & permissions",
    order: 21,
    summary: "A class has one main teacher in charge and any number of assistants who work on the whole class. Choose them on the staff form.",
    tags: ["assistant teacher", "co-teacher", "teaching assistant", "second teacher", "class assistant", "assistant", "put in charge"],
    who: "Managers, and staff given <strong>Edit Staff &amp; Access</strong>.",
    intro: "A class has one <strong>main teacher</strong>, who is in charge of it. Beside them it can have any number of <strong>assistant teachers</strong>, who help run the whole class. Both are chosen on the staff form, next to the person's classes.",
    sections: [
      {
        title: "Choose the main teacher or an assistant",
        steps: [
          "Go to <strong>Management › Users / Employees</strong>, open the teacher and select <strong>Edit</strong> (or select <strong>Add user</strong>).",
          ["Open <strong>Classes &amp; Subjects</strong> and check the class.", "staff-add-classes-zoom.webp", "The Main teacher and Assistant teacher columns."],
          "Check <strong>Main teacher</strong> or <strong>Assistant teacher</strong> beside it, and the subjects they teach.",
          "Confirm and select <strong>Save</strong>.",
        ],
        note: "A person is main teacher or assistant of a class, never both. Drivers can't be either. If someone already leads the class, open them first and uncheck it.",
      },
      {
        title: "When a class has nobody in charge",
        text: "Users / Employees, the dashboard and the class page all say which classes have no main teacher. On Users / Employees select <strong>Choose</strong>, pick a person beside each class and select <strong>Put in charge</strong>.",
      },
      {
        title: "What each kind of teacher can do",
        table: [
          ["", "Main teacher", "Assistant teacher", "Subject teacher"],
          ["Every subject of the class", "Yes", "Yes", "Only theirs"],
          ["Take the class's attendance", "Yes", "Yes", "No"],
          ["Change the class's Class settings", "Yes", "Yes", "No"],
          ["Students' pages", "Every subject", "Every subject", "Their subjects"],
          ["The class's lessons on their calendar", "Yes", "Yes", "Their subjects"],
          ["Edit the class schedule", "Yes", "No", "No"],
          ["In charge of the class", "Yes", "No", "No"],
        ],
        tip: "Permissions still apply. An assistant takes attendance only with <strong>Mark Attendance</strong> and changes Class settings only with <strong>Class Settings</strong>.",
      },
    ],
    faq: [
      ["Why can't a teacher take attendance?", "They aren't the class's main or assistant teacher, or they don't hold Mark Attendance."],
      ["Can a class have two main teachers?", "No. Make the second person an assistant."],
    ],
    related: ["create-and-manage-employee-accounts-and-permissions", "your-access", "mark-attendance-for-a-class", "class-settings"],
  },
];
