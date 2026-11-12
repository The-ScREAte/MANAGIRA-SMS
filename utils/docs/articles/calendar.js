"use strict";

// Calendar, events & activities: events and announcements, activities, the staff calendar and tasks,
// and calendar sync.
module.exports = [
  {
    slug: "events-announcements-notifications",
    title: "Events and announcements",
    topic: "Calendar, events & activities",
    order: 1,
    summary: "Post school events and announcements for staff, families or your website, email everyone if you like, and manage them all in one Management panel.",
    tags: ["events", "announcements", "school calendar", "notify parents", "news"],
    featured: true,
    who: "Managers, and staff given <strong>Publish Events &amp; Announcements</strong> (with <strong>Events</strong> or <strong>Announcements</strong>).",
    intro: "Events (an open house, picture day, a game) go on everyone's calendar. Announcements (a snow day, a reminder) appear on dashboards and in the parent portal. Both are managed in <strong>Events, announcements &amp; activities</strong>.",
    sections: [
      {
        title: "Post an event",
        steps: [
          ["Open <strong>Management</strong>, then <strong>Events, announcements &amp; activities</strong>. You land on the <strong>Events</strong> tab.", "events-panel.webp", "Management, Events, announcements & activities: Events, Activities and Announcements in one place."],
          "Under <strong>New Event</strong>, enter the <strong>Event Name</strong>, <strong>Event Date</strong> and <strong>Event Details</strong>.",
          "Choose its <strong>Visibility</strong>: staff only, staff and families, or your public website too.",
          "Tick <strong>Notify everyone by email</strong> to email all staff and parents, then select <strong>Save Event</strong>.",
        ],
        tip: "On the dashboard, the Events card's <strong>Manage</strong> link opens this same panel.",
      },
      {
        title: "Post an announcement",
        steps: [
          "Open the <strong>Announcements</strong> tab.",
          "Write the announcement, choose who sees it, and choose whether to email it.",
          "Save. It appears on dashboards and in the parent portal straight away.",
        ],
        example: "\"Picture Day is Thursday. Students should wear their school uniform.\" Posted for staff and families, with an email.",
      },
      {
        title: "Without leaving the dashboard",
        text: "Select <strong>New task</strong> on the dashboard's Activity &amp; Announcements card. The dialog has tabs for an <strong>Event</strong>, an <strong>Announcement</strong>, a <strong>Task</strong> and an <strong>Activity</strong>, so you can post any of them in one step.",
        image: "new-task-dialog.webp",
        caption: "New task on the dashboard: an event, an announcement, a task or an activity.",
      },
    ],
    faq: [
      ["Who gets the email?", "Every staff member and parent with an email address, sent with your school's name. People can choose which emails they get in their notification settings."],
      ["Can events appear on our website?", "Yes. Choose a visibility that includes the website, and the event appears in your website's events section."],
    ],
    related: ["activities", "staff-calendar-and-tasks", "school-website", "email-notifications-reference"],
  },
  {
    slug: "activities",
    title: "Activities for the school, a class or one student",
    topic: "Calendar, events & activities",
    order: 2,
    summary: "Add field trips, clubs and appointments for the school, a class or one student. Families see them in their portal, with an optional reminder.",
    tags: ["activities", "field trip", "clubs", "class activities", "reminder email", "family calendar"],
    featured: true,
    who: "Teachers for their own classes and students; anyone with <strong>Publish Events &amp; Announcements</strong> for the whole school.",
    intro: "An activity is something students take part in: a field trip, a club meeting, a game, a tutoring session. Add it for the whole school, one class, or one student, and the right families see it, and only them.",
    sections: [
      {
        title: "Add an activity",
        steps: [
          ["Open <strong>Management</strong>, <strong>Events, announcements &amp; activities</strong>, and choose the <strong>Activities</strong> tab. Teachers can also use the <strong>Activities</strong> section of their class page.", "activities-tab.webp", "The Activities tab: everything coming up, for the school, a class or one student."],
          "Give it a title, and choose who it's <strong>for</strong>: the whole school, a class, or, after choosing a class, one student.",
          "Set the date (and an end date for several days), the times or <strong>All day</strong>, the location and the details.",
          "Tick <strong>Email families a reminder the day before</strong> if you'd like a reminder sent.",
          "Save. Families are notified straight away.",
        ],
        tip: "Teachers can also add activities from <strong>Activities</strong> in their class's Class Tools. In a hurry? Use <strong>New task</strong> on the dashboard and choose the <strong>Activity</strong> tab.",
        image: "new-task-dialog.webp",
        caption: "New task, Activity: add an activity without leaving the dashboard.",
      },
      {
        title: "Who sees it",
        table: [
          ["Activity for", "Who sees it"],
          ["The whole school", "Every family and student, and all staff."],
          ["A class", "That class's students and their parents, and the class's teachers."],
          ["One student", "Only that student and their parents, and the student's teachers."],
        ],
        note: "Families see activities in the <strong>Activities</strong> menu of their portal and on their calendar. Reminder emails come from <strong>reminders@managira.com</strong>, the day before, once.",
        example: "A counselor adds <em>College application workshop</em> for one 12th grader, on Tuesday at 3:30 PM in the library, with a reminder. Only that student and their parents see it and get the reminder.",
      },
    ],
    faq: [
      ["What's the difference between an event and an activity?", "Events are school-wide dates on everyone's calendar. Activities are for the students taking part (the school, a class or one student), with an optional reminder to their families."],
      ["Can I change an activity after posting it?", "Yes. Edit it in the Activities tab. If you change the date, families get a new reminder for the new date."],
    ],
    related: ["events-announcements-notifications", "calendar-sync-google-outlook-apple", "parent-portal", "class-page"],
  },
  {
    slug: "staff-calendar-and-tasks",
    title: "Your calendar and tasks",
    topic: "Calendar, events & activities",
    order: 3,
    summary: "See school events, your lessons, personal events and tasks in one calendar; assign tasks to colleagues, tag them in events, and track what's due.",
    tags: ["calendar", "tasks", "assign task", "mentions", "personal events", "lessons", "timetable"],
    who: "All staff. Posting school events needs <strong>Publish Events &amp; Announcements</strong>.",
    sections: [
      {
        title: "Your calendar",
        steps: [
          ["Open the menu and choose <strong>Calendar</strong>.", "staff-calendar.webp", "The staff calendar: school events, lessons, personal events and tasks."],
          "Click a day to add something, or select an existing item to see or change it.",
          "Use <strong>My calendars</strong> to show or hide layers: school events, your lessons from the timetable, personal events, tasks and connected calendars.",
        ],
      },
      {
        title: "Assign a task",
        steps: [
          "Select <strong>New task</strong> on the dashboard, or add a task in the calendar.",
          "Describe the task. Type <strong>@</strong> and a colleague's name to mention them, and they're added as an assignee.",
          "Set a due date, time and priority, then save. Assignees get a notification and an email.",
          "Each assignee marks the task done; you see who's finished on your dashboard's <strong>For you</strong> tab, and can comment on it there.",
        ],
        example: "\"@Daniel Lee please send the 7th Grade science results to families by Friday.\" Daniel is assigned, and the task shows on both dashboards until he marks it done.",
      },
      {
        title: "Personal events and tags",
        list: [
          "A <strong>personal event</strong> is just for you, plus anyone you tag.",
          "Tag colleagues in an event so it shows on their dashboard and calendar, with a notification.",
          "<strong>Share with colleagues</strong> (in <strong>Sync &amp; share</strong>) lets them see your personal events and tasks.",
        ],
      },
    ],
    related: ["calendar-sync-google-outlook-apple", "events-announcements-notifications", "activities"],
  },
  {
    slug: "calendar-sync-google-outlook-apple",
    title: "Sync your calendar with Google, Outlook or Apple",
    topic: "Calendar, events & activities",
    order: 4,
    summary: "Staff send their Managira calendar to Google Calendar or Outlook in one click; families add their children's calendar in one tap.",
    tags: ["calendar sync", "google calendar", "outlook", "apple calendar", "ical", "subscribe", "private link", "calendar not updating", "calendar not syncing", "connect again"],
    who: "Staff, parents and students.",
    sections: [
      {
        title: "For staff",
        steps: [
          ["In <strong>Calendar</strong>, select <strong>Sync</strong>.", "calendar-sync.webp", "Sync: connect Google Calendar or Outlook."],
          "Select <strong>Connect Google Calendar</strong> or <strong>Connect Outlook</strong>, sign in with Google or Microsoft, and allow Managira to add its calendar.",
          "You come back to Managira and it says <strong>Connected</strong>. In Google Calendar or Outlook there's now a calendar named <strong>Managira</strong> with your school events, activities, personal events, tasks, and your classes or bus runs for the coming weeks.",
          "That's all. Whatever is added or changed in Managira reaches it on its own, in the background. Select <strong>Disconnect</strong> to remove the Managira calendar from your account.",
        ],
        note: "It's one way: Managira only adds to its own Managira calendar. It never reads or changes your other events. Birthdays stay in Managira (the <strong>Birthdays</strong> calendar shows students in your classes, and staff). To share your calendar with colleagues inside Managira, select <strong>Share</strong>. Mira can also find a free time and put a meeting on your calendar for you.",
      },
      {
        title: "For parents and students",
        steps: [
          "Open <strong>Calendar</strong> in the parent or student portal.",
          "Select <strong>Add to my calendar</strong> and choose <strong>Google Calendar</strong>, <strong>Outlook</strong>, <strong>Outlook.com</strong> or <strong>Apple Calendar</strong>.",
          "Confirm in the calendar app. Classes, activities, school events and work closing dates now appear on the phone and stay up to date.",
        ],
        image: "parent-calendar.webp",
        caption: "The parent calendar: every child's classes, activities and school events.",
      },
    ],
    faq: [
      ["My calendar isn't updating. How quickly do changes show up?", "A connected Google Calendar or Outlook gets a change you make in Managira within seconds, and everything else within 10 minutes, even when you aren't signed in."],
      ["I don't see the Managira calendar in Google Calendar.", "Open Sync in Managira: it should say Up to date. In Google Calendar, look under My calendars for Managira and make sure it's ticked. If you deleted it, Managira makes it again with the next change."],
      ["It says Reconnect needed. What do I do?", "You (or your school's Google or Microsoft admin) removed Managira's access, or it expired. Select Connect again and sign in; nothing is lost."],
      ["Can I disconnect?", "Yes. In Sync, select Disconnect. The Managira calendar is removed from your Google or Outlook account; nothing in Managira is deleted."],
    ],
    related: ["staff-calendar-and-tasks", "activities", "parent-portal"],
  },
];
