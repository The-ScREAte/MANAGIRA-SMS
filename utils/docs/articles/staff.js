"use strict";

// Staff & permissions: adding staff, giving each person exactly what their job needs.
module.exports = [
  {
    slug: "create-and-manage-employee-accounts-and-permissions",
    title: "Add and manage staff",
    topic: "Staff & permissions",
    order: 1,
    summary: "Invite teachers, office staff and drivers, give each person a role and the permissions their job needs, assign classes, and put staff on hold or remove them.",
    tags: ["add staff", "employees", "teachers", "invite staff", "users", "hold staff", "remove staff", "add a teacher", "add a new teacher", "add an employee", "new staff member", "teacher access to their own class", "give a teacher access to only their class", "limit a teacher to their class", "assign a teacher to a class"],
    featured: true,
    who: "Managers, and staff given the <strong>Users / Employees</strong> permission with <strong>Add Staff</strong>, <strong>Edit Staff &amp; Access</strong> or <strong>Hold &amp; Remove Staff</strong>.",
    intro: "Every staff member signs in with their own account. Their <strong>role</strong> describes their job, and their <strong>permissions</strong> decide exactly what they can see and do, so each person gets what their work needs and nothing more.",
    sections: [
      {
        title: "Add a staff member",
        steps: [
          ["Open <strong>Management</strong>, then <strong>Users / Employees</strong>, and choose to add an employee.", "employees.webp", "Management, Users / Employees: everyone on your staff, with their role and status."],
          ["Enter their <strong>First Name</strong>, <strong>Last Name</strong>, <strong>Email Address</strong> and <strong>Role</strong>: <em>Manager</em>, <em>Supervisor</em>, <em>Teacher</em> or <em>Driver</em>.", "add-employee.webp", "Adding a staff member: their details, role and permissions."],
          "Choose the role first. Until you do, the screen says <em>Choose a role to see its permissions</em>. Then only that role's <strong>basic permissions</strong> show, already switched on and grouped in a few bundles.",
          "Need more? Open <strong>Advanced permissions</strong> and switch on anything else the person needs. Each one you add is marked <strong>Extra</strong>, and the button counts them.",
          "For a teacher, choose the classes and subjects they teach. Tick the class, then <strong>Main teacher</strong> beside it to put them in charge of it.",
          "Save. They receive an email to set their password and sign in.",
        ],
        tip: "High-risk permissions, such as deleting students, managing billing or changing staff access, are shown only for the Manager role, in their own section inside Advanced. A teacher, supervisor or driver never sees them.",
      },
      {
        title: "Put a main teacher in charge of each class",
        text: "Each class has one main teacher. They mark its attendance, keep its schedule, and work on every subject and report card of the class; other teachers of the class work on the subjects they teach.",
        steps: [
          "Open the teacher from <strong>Users / Employees</strong>, and open <strong>Classes &amp; Subjects</strong>.",
          "Tick the class, then the box under <strong>Main teacher</strong> beside it. If someone already leads the class, their name shows there instead of a box: open that person and untick it first, then come back.",
          "Save.",
        ],
        tip: "Classes with nobody in charge are listed at the top of <strong>Users / Employees</strong>, where you can choose a main teacher for each in one step. The dashboard and the class page say so too.",
      },
      {
        title: "Change someone's access",
        steps: [
          "Open the person from <strong>Users / Employees</strong>. The screen shows exactly the access they have today; anything beyond their role's basics is under <strong>Advanced permissions</strong>, marked <strong>Extra</strong>.",
          "Change a switch, or change the role. The role switches at once: the new role's basics are on, and anything you added beyond the old role's basics is kept under Advanced.",
          "Save. The change applies the next time they open a page; there's no need for them to sign out.",
        ],
        note: "Unticking a permission really removes it, even if their role would normally include it. Opening and saving a person without changing anything leaves their access exactly as it was.",
      },
      {
        title: "Require an authenticator app for one person",
        text: "On someone's Edit user page, a manager can tick <strong>Require an authenticator app at sign-in</strong>. When they next sign in with a password, Managira takes them to Settings, Two-step sign-in to set up the app, and asks for its code from then on. To require it for everyone in a role, use <strong>Settings</strong>, <strong>Tenant configuration</strong>. See <a href=\"/legal/user-documentation/two-step-sign-in\">Two-step sign-in with an authenticator app</a>.",
      },
      {
        title: "When someone leaves",
        list: [
          "<strong>Put on hold</strong> to pause their sign-in while keeping everything they did (for example, during leave).",
          "<strong>Remove</strong> when they leave for good. Their past work, such as grades they entered, stays in the records.",
          "You can <strong>restore</strong> a held or removed person later.",
        ],
        warning: "Only a manager can change, hold or remove another manager, and managers change their own account in Settings, not here.",
      },
    ],
    faq: [
      ["A teacher can't see their class.", "Check the class is assigned to them in Users / Employees, and that the class is enrolled in the current term."],
      ["A teacher can't mark attendance.", "Attendance is marked by the class's main teacher and assistant teachers. Tick Main teacher (or Assistant) beside the class on their record in Users / Employees, and check they have the Mark Attendance permission."],
      ["Can someone have two roles?", "Each person has one role. Add the permissions of the other job to their account instead."],
      ["The invitation email didn't arrive.", "Check their email address for typos, ask them to look in spam, and send it again from their page."],
    ],
    related: ["roles-and-permissions", "single-sign-on", "two-step-sign-in", "driver-app"],
  },
  {
    slug: "roles-and-permissions",
    title: "Roles and permissions",
    topic: "Staff & permissions",
    order: 2,
    summary: "What each role starts with, how permissions are grouped, which ones are high-risk, and how your plan affects what can be given.",
    tags: ["roles", "permissions", "access control", "manager", "teacher", "supervisor", "driver", "security"],
    who: "Managers and anyone who sets up staff access.",
    intro: "Permissions are grouped by area. A person's saved permissions are what count: the role only chooses the <em>basics</em> that are switched on for someone new, and everything else is behind Advanced permissions. Features outside your school's plan can't be given to anyone, managers included.",
    sections: [
      {
        title: "Roles",
        table: [
          ["Role", "Typically does"],
          ["<strong>Manager</strong>", "Runs the school: settings, staff, every workspace. Only managers can change other managers, single sign-on and sign-in rules."],
          ["<strong>Supervisor</strong>", "Oversees classes and staff: students, reports and day-to-day administration, as permitted."],
          ["<strong>Teacher</strong>", "Their own classes: attendance, assessments and scores, activities, the Pickup list, class bus reports and the settings of the classes they lead."],
          ["<strong>Driver</strong>", "The driver app: their bus runs, boarding and reports. Leads can also manage other drivers."],
        ],
      },
      {
        title: "What each role starts with",
        text: "Choosing a role switches on only the few permissions the job needs every day. Giving more is a deliberate step, in Advanced permissions.",
        table: [
          ["Role", "Basic permissions"],
          ["<strong>Teacher</strong>", "Their own classes only: see their students, Mark Attendance, Manage Assessments &amp; Scores, Class Settings (their classes), Terminal Reports, Use Mira. No staff, finance, settings or website."],
          ["<strong>Supervisor</strong>", "See, add and edit students, Mark Attendance, Manage Assessments &amp; Scores, Terminal Reports, announcements and events, Use Mira."],
          ["<strong>Manager</strong>", "Users / Employees (add, edit and hold staff), students (not deleting them), classes and subjects, attendance, assessments, reports and report settings, announcements and events, Use Mira. Billing, settings, terms, promotions and the rest are in <em>High risk - Managers only</em>."],
          ["<strong>Driver</strong>", "The Driver dashboard: their routes and riders. Anything more is chosen per driver under Advanced."],
        ],
        note: "Jobs such as <em>Office / registrar</em>, <em>Bursar / finance</em>, <em>Transport lead</em>, <em>Class lead</em> and <em>Principal / head</em> work best as your school's own roles (Add a role on the staff form). Each role you add starts with its basics and can be saved with the permissions you tick.",
      },
      {
        title: "Permission groups",
        table: [
          ["Group", "Permissions"],
          ["People", "Users / Employees (with Add Staff, Edit Staff &amp; Access, Hold &amp; Remove Staff), Manage Students (with Add, Edit and Delete Students, Enrollment, Graduates &amp; Alumni), Manage Guardians, See Contacts, Edit Contact Template"],
          ["Academics", "Manage Classes &amp; Subjects, Manage Assessments &amp; Scores (with Set Assessment Questions), Assess Other School Years, Mark Attendance, Class Settings (with Every Class), Manage School Records, Manage School Years &amp; Terms"],
          ["Admissions &amp; Promotions", "Approve Admissions, Approve Promotions, Manage Promotions"],
          ["Reports", "Manage Reports/Printing (with Terminal Reports, Report Builder, Report Settings), Generate Transcripts"],
          ["Communication", "Publish Events &amp; Announcements (with Announcements, Events), Mailroom, Use Mira (AI Assistant)"],
          ["Transportation", "Transportation (with Buses, Manage Drivers, Routes &amp; Stops, Schedules, Rider List, Student Stops &amp; Routes, Driver Reports), Class Bus Reports"],
          ["Driver", "Lead Driver, Student Details, Pickup &amp; Emergency, Reports, School Website, Any Route"],
          ["Finance", "PayGira (with its pages), Manage Billing"],
          ["Administration", "Manage Organization Settings, Single Sign-On, Custom Editor"],
        ],
        image: "add-employee.webp",
        caption: "Permissions are ticked on each person, grouped by area.",
        note: "Some permissions are follow-ups of a main one (for example <em>Add Staff</em> under <em>Users / Employees</em>). A follow-up only counts while its main permission is held.",
      },
      {
        title: "Permissions for class settings",
        text: "If your school has Class settings, <strong>Class Settings</strong> lets someone turn class features on and off and choose what parents and students see, for the classes they lead as main or assistant teacher; teachers have it by default. Its follow-up <strong>Every Class</strong> adds every class's settings, from Management, Class settings; managers have it. Without Class Settings, the page isn't shown. The school calendar is changed in Settings, with <strong>Manage Organization Settings</strong> and <strong>School Profile &amp; Branding</strong>. See <a href=\"/legal/user-documentation/class-settings\">Class settings</a>.",
      },
      {
        title: "High-risk permissions",
        text: "These can change many records or money at once. They are never part of a Teacher, Supervisor or Driver's basics, and they show only for the Manager role (in <em>High risk - Managers only</em>, inside Advanced); someone who already holds one keeps seeing it, marked Extra. They are: <strong>Users / Employees</strong>, <strong>Edit Staff &amp; Access</strong>, <strong>Hold &amp; Remove Staff</strong>, <strong>Delete Students</strong>, <strong>Every Class</strong>, <strong>Manage School Years &amp; Terms</strong>, <strong>Approve Promotions</strong>, <strong>Manage Billing</strong>, <strong>Manage Organization Settings</strong> and <strong>Single Sign-On</strong>.",
      },
      {
        title: "Mira follows the same rules",
        text: "Mira, the AI assistant, can only do what the person asking is allowed to do. If they're missing a permission, Mira says which one. See <a href=\"/legal/user-documentation/mira-ai-assistant\">Mira</a>.",
      },
    ],
    faq: [
      ["Why can't I give a permission?", "It may be outside your school's plan, or it may be a follow-up whose main permission isn't ticked."],
      ["Where are Billing, Settings and the other high-risk permissions?", "They show only when the role is Manager, in <em>High risk - Managers only</em> inside Advanced permissions. A Teacher, Supervisor or Driver can't be given them from this screen; someone who already holds one still sees it, marked Extra."],
      ["I switched the role. Did I lose what I added?", "No. Extras you added beyond the old role's basics are kept and shown under Advanced. Anything you added beyond the old role's basics is kept."],
      ["Do parents and students have permissions?", "No. Parents and students use their own portals and only ever see their own family's or their own information."],
    ],
    related: ["create-and-manage-employee-accounts-and-permissions", "mira-ai-assistant", "single-sign-on"],
  },
  {
    slug: "your-access",
    title: "Your access: your role, classes and what you can do",
    topic: "Staff & permissions",
    order: 20,
    summary: "See your role, your classes and what you can and can't do in Managira. Managers can see anyone's, with their history.",
    tags: ["your access", "my access", "my role", "what can i do", "what can i do in managira", "what i have access to", "see my access", "role history", "access history", "first sign in", "what can they do"],
    who: "Every member of staff sees their own. Managers can open anyone's.",
    intro: "<strong>Your access</strong> shows, in plain words, what your account lets you do: your role, your school, your classes (and whether you're the main or an assistant teacher), and what's included and not. If your school moved to Managira from another system, it also shows your roles there.",
    sections: [
      {
        title: "Open your access",
        steps: [
          "Select <strong>?</strong> at the top of Managira, then <strong>Your access</strong>.",
          "Read your role and classes, then <strong>What you can do</strong> and <strong>Not included</strong>.",
        ],
        note: "Staff whose accounts came from your school's old system see this page the first time they open Managira.",
      },
      {
        title: "See someone else's (managers)",
        text: "Managers can open any member of staff's access page, with their roles in your old system (read-only, with dates) and every change made to their role, permissions or classes since: who made it, when, and what it was before and after.",
      },
      {
        title: "Something isn't right",
        text: "Ask a manager at your school: they change roles, permissions and classes on the staff page. See <a href=\"/legal/user-documentation/create-and-manage-employee-accounts-and-permissions\">Add and manage staff</a>.",
      },
    ],
    related: ["create-and-manage-employee-accounts-and-permissions", "assistant-teachers", "moving-to-managira"],
  },
  {
    slug: "assistant-teachers",
    title: "Assistant teachers",
    topic: "Staff & permissions",
    order: 21,
    summary: "Give a class assistant teachers beside its main teacher: they see and work on the whole class without being in charge of it.",
    tags: ["assistant teacher", "co-teacher", "teaching assistant", "second teacher", "class assistant", "assistant"],
    who: "Managers, and staff given <strong>Edit Staff &amp; Access</strong>.",
    intro: "A class has one <strong>main teacher</strong>, who is in charge of it. Beside them it can have any number of <strong>assistant teachers</strong>, who help run the whole class.",
    sections: [
      {
        title: "Make someone an assistant teacher",
        steps: [
          "Open <strong>Users / Employees</strong> and edit the teacher (or add a new one).",
          "Under <strong>Classes &amp; Subjects</strong>, tick the class.",
          "Beside it, tick <strong>Assistant</strong>.",
          "Select <strong>Save Changes</strong>.",
        ],
        note: "A person is either the main teacher or an assistant of a class, never both. Drivers can't be either.",
      },
      {
        title: "What an assistant teacher can do",
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
        tip: "What anyone can do still depends on their permissions too: an assistant takes attendance only if they hold Mark Attendance, and changes Class settings only with Class Settings.",
      },
    ],
    related: ["create-and-manage-employee-accounts-and-permissions", "your-access", "mark-attendance-for-a-class"],
  },
];
