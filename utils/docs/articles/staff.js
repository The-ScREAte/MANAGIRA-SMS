"use strict";

// Staff & permissions: adding staff, giving each person exactly what their job needs.
module.exports = [
  {
    slug: "create-and-manage-employee-accounts-and-permissions",
    title: "Add and manage staff",
    topic: "Staff & permissions",
    order: 1,
    summary: "Invite teachers, office staff and drivers, give each person a role and the permissions their job needs, assign classes, and put staff on hold or remove them.",
    tags: ["add staff", "employees", "teachers", "invite staff", "users", "hold staff", "remove staff"],
    featured: true,
    who: "Managers, and staff given the <strong>Users / Employees</strong> permission with <strong>Add Staff</strong>, <strong>Edit Staff &amp; Access</strong> or <strong>Hold &amp; Remove Staff</strong>.",
    intro: "Every staff member signs in with their own account. Their <strong>role</strong> describes their job, and their <strong>permissions</strong> decide exactly what they can see and do, so each person gets what their work needs and nothing more.",
    sections: [
      {
        title: "Add a staff member",
        steps: [
          ["Open <strong>Management</strong>, then <strong>Users / Employees</strong>, and choose to add an employee.", "employees.webp", "Management, Users / Employees: everyone on your staff, with their role and status."],
          ["Enter their <strong>First Name</strong>, <strong>Last Name</strong>, <strong>Email Address</strong> and <strong>Role</strong>: <em>Manager</em>, <em>Supervisor</em>, <em>Teacher</em> or <em>Driver</em>.", "add-employee.webp", "Adding a staff member: their details, role and permissions."],
          "Tick their <strong>Permissions</strong>. The role fills in sensible defaults; add or remove from there.",
          "For a teacher, choose the classes and subjects they teach. Tick <strong>Main teacher</strong> beside a class to put them in charge of it.",
          "Save. They receive an email to set their password and sign in.",
        ],
        tip: "High-risk permissions, such as deleting students or managing billing, are marked and left out of the defaults. Give them only to the few people who need them.",
      },
      {
        title: "Put a main teacher in charge of each class",
        text: "Each class has one main teacher. They mark its attendance, keep its schedule, and work on every subject and report card of the class; other teachers of the class work on the subjects they teach.",
        steps: [
          "Open the teacher from <strong>Users / Employees</strong>, and open <strong>Classes &amp; Subjects</strong>.",
          "Beside the class, tick <strong>Main teacher</strong>. If someone else led the class, it shows their name; saving puts this teacher in charge instead.",
          "Save.",
        ],
        tip: "Classes with nobody in charge are listed at the top of <strong>Users / Employees</strong>, where you can choose a main teacher for each in one step. The dashboard and the class page say so too.",
      },
      {
        title: "Change someone's access",
        steps: [
          "Open the person from <strong>Users / Employees</strong> and edit their role or permissions.",
          "Save. The change applies the next time they open a page; there's no need for them to sign out.",
        ],
        note: "Unticking a permission really removes it, even if their role would normally include it.",
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
      ["A teacher can't mark attendance.", "Attendance is marked by the class's main teacher. Tick Main teacher beside the class on their record in Users / Employees, and check they have the Mark Attendance permission."],
      ["Can someone have two roles?", "Each person has one role. Add the permissions of the other job to their account instead."],
      ["The invitation email didn't arrive.", "Check their email address for typos, ask them to look in spam, and send it again from their page."],
    ],
    related: ["roles-and-permissions", "single-sign-on", "driver-app"],
  },
  {
    slug: "roles-and-permissions",
    title: "Roles and permissions",
    topic: "Staff & permissions",
    order: 2,
    summary: "What each role starts with, how permissions are grouped, which ones are high-risk, and how your plan affects what can be given.",
    tags: ["roles", "permissions", "access control", "manager", "teacher", "supervisor", "driver", "security"],
    who: "Managers and anyone who sets up staff access.",
    intro: "Permissions are grouped by area. A person's saved permissions are what count: the role only suggests defaults for someone new. Features outside your school's plan can't be given to anyone, managers included.",
    sections: [
      {
        title: "Roles",
        table: [
          ["Role", "Typically does"],
          ["<strong>Manager</strong>", "Runs the school: settings, staff, every workspace. Only managers can change other managers, single sign-on and sign-in rules."],
          ["<strong>Supervisor</strong>", "Oversees classes and staff: students, reports and day-to-day administration, as permitted."],
          ["<strong>Teacher</strong>", "Their own classes: attendance, assessments and scores, activities, the Pickup list and class bus reports."],
          ["<strong>Driver</strong>", "The driver app: their bus runs, boarding and reports. Leads can also manage other drivers."],
        ],
      },
      {
        title: "Permission groups",
        table: [
          ["Group", "Permissions"],
          ["People", "Users / Employees (with Add Staff, Edit Staff &amp; Access, Hold &amp; Remove Staff), Manage Students (with Add, Edit and Delete Students, Enrollment, Graduates &amp; Alumni), Manage Guardians, See Contacts, Edit Contact Template"],
          ["Academics", "Manage Classes &amp; Subjects, Manage Assessments &amp; Scores (with Set Assessment Questions), Assess Other School Years, Mark Attendance, Manage School Records, Manage School Years &amp; Terms"],
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
        title: "High-risk permissions",
        text: "These can change many records or money at once, and are left out of new staff defaults: <strong>Users / Employees</strong>, <strong>Edit Staff &amp; Access</strong>, <strong>Hold &amp; Remove Staff</strong>, <strong>Delete Students</strong>, <strong>Manage School Years &amp; Terms</strong>, <strong>Approve Promotions</strong>, <strong>Manage Billing</strong>, <strong>Manage Organization Settings</strong> and <strong>Single Sign-On</strong>.",
      },
      {
        title: "Mira follows the same rules",
        text: "Mira, the AI assistant, can only do what the person asking is allowed to do. If they're missing a permission, Mira says which one. See <a href=\"/legal/user-documentation/mira-ai-assistant\">Mira</a>.",
      },
    ],
    faq: [
      ["Why can't I give a permission?", "It may be outside your school's plan, or it may be a follow-up whose main permission isn't ticked."],
      ["Do parents and students have permissions?", "No. Parents and students use their own portals and only ever see their own family's or their own information."],
    ],
    related: ["create-and-manage-employee-accounts-and-permissions", "mira-ai-assistant", "single-sign-on"],
  },
];
