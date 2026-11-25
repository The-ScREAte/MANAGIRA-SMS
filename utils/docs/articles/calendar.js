"use strict";

// Calendar, events & activities: events and announcements, activities, the staff calendar and tasks,
// and calendar sync.
const link = (slug, text) => `<a href="/legal/user-documentation/${slug}">${text}</a>`;
const TOPIC = "Calendar, events & activities";
const EVENTS_MENU = "<strong>Management › Events, announcements &amp; activities</strong>";

module.exports = [
  {
    slug: "events-announcements-notifications",
    title: "Post events and announcements",
    topic: TOPIC,
    order: 1,
    summary: "Post school events and announcements for staff, families or your website, email everyone if you like, and manage them all in one Management panel.",
    tags: ["events", "announcements", "school calendar", "notify parents", "news", "visibility", "internal only", "website events", "snow day"],
    featured: true,
    who: "Managers, and staff given <strong>Publish Events &amp; Announcements</strong> with its <strong>Events</strong> or <strong>Announcements</strong> follow-up.",
    intro: "Events (an open house, picture day, a concert) go on the school calendar. Announcements (a reminder, a schedule change) show on dashboards and in the parent portal. Both are managed in one Management panel.",
    sections: [
      {
        title: "Open the panel",
        steps: [
          ["Go to " + EVENTS_MENU + "."],
          ["Three tabs: <strong>Events</strong>, <strong>Activities</strong> and <strong>Announcements</strong>. Each shows how many there are this term.", "cal-events-panel.webp", "The Events tab: New Event on the left, this term's events on the right."],
        ],
        tip: "The dashboard's Events card has a <strong>Manage</strong> link that opens this same panel.",
      },
      {
        title: "Post an event",
        steps: [
          "On the <strong>Events</strong> tab, under <strong>New Event</strong>, type the <strong>Event Name</strong>, pick the <strong>Event Date</strong> and describe it in <strong>Event Details</strong>.",
          ["Choose its <strong>Visibility</strong>."],
          ["Check <strong>Notify everyone by email</strong> to email all staff and parents."],
          "Select <strong>Save Event</strong>. It appears under <strong>Current Term Events</strong>.",
        ],
        table: [
          ["Visibility", "Who sees it"],
          ["<strong>Internal Only</strong>", "Staff and families, inside Managira."],
          ["<strong>External Only</strong>", "Your public school website only. Shown when your school has a website."],
          ["<strong>Both</strong>", "Inside Managira and on your website. Shown when your school has a website."],
        ],
        example: "<em>Fall Concert</em>, December 10: <em>The 6th to 8th grade bands and choir perform at 6:30 PM in the gymnasium. Doors open at 6:00 PM.</em> Visibility <strong>Both</strong>.",
      },
      {
        title: "Change or remove an event",
        steps: [
          ["Select an event in the list to open it. Change anything, then save, or delete it."],
        ],
      },
      {
        title: "Post an announcement",
        steps: [
          ["Open the <strong>Announcements</strong> tab.", "cal-announcements.webp", "New Announcement, and this term's announcements."],
          ["Write the <strong>Announcement Message</strong>, choose <strong>Visibility</strong>, and check <strong>Notify everyone by email</strong> if you want an email too."],
          "Select <strong>Post Announcement</strong>. It shows on dashboards and in the parent portal straight away.",
        ],
        example: "<em>Picture Day is Thursday, December 3. Students should wear their school uniform. Retake day is in January.</em> Visibility <strong>Both</strong>, with an email.",
      },
      {
        title: "Other places to post",
        list: [
          "<strong>Dashboard › New task</strong> opens a window with tabs for an <strong>Event</strong>, an <strong>Announcement</strong>, a <strong>Task</strong> and an <strong>Activity</strong>.",
          "<strong>Calendar › Create</strong> adds an event, announcement or task. See " + link("staff-calendar-and-tasks", "Your calendar and tasks") + ".",
        ],
        image: "cal-task-dialog.webp",
        caption: "New task on the dashboard, with tabs for an event, an announcement, a task and an activity.",
      },
    ],
    faq: [
      ["Who gets the email?", "Every staff member and parent with an email address, sent with your school's name. People can turn off optional emails in their notification settings. See " + link("email-notifications-reference", "Emails Managira sends") + "."],
      ["Why don't I see External Only or Both?", "Those choices appear only when your school has a website. Without one, every event and announcement is Internal Only."],
      ["Why can't I see the Events tab?", "Your account needs <strong>Publish Events &amp; Announcements</strong> with its <strong>Events</strong> follow-up. Announcements needs its own follow-up. Ask a manager."],
    ],
    related: ["activities", "staff-calendar-and-tasks", "school-website", "email-notifications-reference"],
  },

  {
    slug: "activities",
    title: "Add activities for the school, a class or one student",
    topic: TOPIC,
    order: 2,
    summary: "Add field trips, clubs and appointments for the whole school, a class or one student. Families see them in their portal, with an optional reminder.",
    tags: ["activities", "field trip", "clubs", "class activities", "reminder email", "family calendar", "appointment"],
    featured: true,
    who: "Teachers for their own classes and students. Managers and anyone with <strong>Publish Events &amp; Announcements</strong> for the whole school.",
    intro: "An activity is something students take part in: a field trip, a club meeting, a game, a tutoring session. Add it for the whole school, one class, or one student, and the right families see it, and only them.",
    sections: [
      {
        title: "Where to find activities",
        steps: [
          ["For the school, go to " + EVENTS_MENU + " and open the <strong>Activities</strong> tab.", "cal-activities-tab.webp", "Everything coming up, with Past activities folded below."],
          ["A teacher opens the class, then <strong>Activities</strong> in Class Tools."],
        ],
      },
      {
        title: "Add an activity",
        steps: [
          "Select <strong>Add activity</strong>.",
          ["Fill in the window."],
          "Type a <strong>Title</strong>. Under <strong>Who it's for</strong>, choose <strong>Whole school</strong>, a class, or, after choosing a class, one student.",
          "Pick the <strong>Date</strong>, the <strong>Starts</strong> and <strong>Ends</strong> times, and the <strong>Location</strong>.",
          "Add <strong>Details for parents</strong>. Check <strong>Email families a reminder the day before</strong> if you want one sent.",
          "Select <strong>Save</strong>. Families are notified straight away.",
        ],
        example: "<em>Field trip to the Science Museum</em>, December 8, 9:00 AM to 2:30 PM, Riverside Science Museum, for <strong>6th Grade</strong>: <em>Students bring a packed lunch and wear their school T-shirt. Buses leave at 8:45 AM.</em> With a reminder.",
      },
      {
        title: "Who sees it",
        table: [
          ["Activity for", "Who sees it"],
          ["Whole school", "Every family and student, and all staff."],
          ["A class", "That class's students and their parents, and the class's teachers."],
          ["One student", "Only that student and their parents, and the student's teachers."],
        ],
        note: "Families see activities in the <strong>Activities</strong> menu of their portal and on their calendar. Reminder emails come from <strong>reminders@managira.com</strong>, once, the day before.",
      },
    ],
    faq: [
      ["What is the difference between an event and an activity?", "Events are school-wide dates on everyone's calendar. Activities are for the students taking part (the school, a class or one student), with an optional reminder to their families."],
      ["Can I change an activity after posting it?", "Yes. Open it from the list and edit it. If you change the date, families get a new reminder for the new date."],
      ["Why can't a teacher add one for the whole school?", "The whole school needs <strong>Publish Events &amp; Announcements</strong>. Teachers can add activities for their own classes and students."],
    ],
    related: ["events-announcements-notifications", "calendar-sync-google-outlook-apple", "parent-portal", "class-page"],
  },

  {
    slug: "staff-calendar-and-tasks",
    title: "Your calendar and tasks",
    topic: TOPIC,
    order: 3,
    summary: "See school events, your classes, birthdays, personal events and tasks in one calendar, assign tasks to colleagues, and share your calendar.",
    tags: ["calendar", "tasks", "assign task", "mentions", "personal events", "birthdays", "agenda", "share calendar", "timetable"],
    who: "All staff. Posting school events needs <strong>Publish Events &amp; Announcements</strong> with its <strong>Events</strong> follow-up, and announcements its <strong>Announcements</strong> follow-up.",
    intro: "The calendar shows everything that applies to you in one place: school events, your classes, tasks, birthdays and your own events.",
    sections: [
      {
        title: "Open the calendar",
        steps: [
          ["Open the menu and choose <strong>Calendar</strong>.", "cal-page.webp", "The calendar, in Month view."],
          ["Switch between <strong>Month</strong>, <strong>Week</strong>, <strong>Day</strong> and <strong>Agenda</strong>. <strong>Today</strong> jumps back to now, and the arrows move forward or back."],
          ["<strong>Coming up</strong>, on the left, lists what is next."],
        ],
      },
      {
        title: "Show or hide layers",
        steps: [
          ["Under <strong>My calendars</strong>, check or uncheck a layer."],
        ],
        list: [
          "<strong>School events</strong>: events and activities you can see.",
          "<strong>Personal</strong>: events only you (and anyone you tag) see.",
          "<strong>My tasks</strong>: tasks assigned to you or by you.",
          "<strong>My classes</strong>: your classes and bus runs.",
          "<strong>Birthdays</strong>: students in your classes and staff. Managers and supervisors see every class.",
        ],
        note: "Bus runs appear only while transportation is on. Birthdays are names only, never ages.",
      },
      {
        title: "Create an event, announcement or task",
        steps: [
          ["Select <strong>Create</strong>, or click a day."],
          ["Choose the <strong>Event</strong>, <strong>Announcement</strong> or <strong>Task</strong> tab and fill it in.", "cal-create.webp", "Create: an event with its start, end, location, details, who to tag and who it is visible to."],
          "For an event, <strong>Visible to</strong> is <strong>Staff only (internal)</strong>, <strong>Staff, parents &amp; website</strong> (or <strong>Staff &amp; parents</strong> without a website), <strong>Website only</strong>, or <strong>Just me (personal) · plus anyone I tag</strong>. Staff without the Events permission can add only personal events.",
          "Use <strong>Tag staff</strong> to add colleagues. The event shows on their calendar and they get a notification.",
          "Select <strong>Save</strong>.",
        ],
      },
      {
        title: "Assign a task",
        steps: [
          ["Select <strong>New task</strong> on the dashboard's Activity &amp; announcements card, or the <strong>Task</strong> tab in Create.", "cal-task-dialog.webp", "Task: a title, details, who it is for, a due date and a priority."],
          "Write what needs doing. Under <strong>Assign to</strong>, search for a colleague. You can also type <strong>@</strong> and their name in the details.",
          "Set a <strong>Due date</strong>, a <strong>Time</strong> and a <strong>Priority</strong> (<strong>Low</strong>, <strong>Normal</strong> or <strong>High</strong>), then select <strong>Save</strong>.",
          "Each person assigned gets a notification and an email. You see who has finished on your dashboard's <strong>For you</strong> tab, where you can also comment on the task.",
        ],
        example: "<em>Send the 6th Grade science results to families</em>, assigned to a colleague, due Friday at 3:00 PM, priority <strong>High</strong>.",
      },
      {
        title: "Share your calendar",
        steps: [
          ["Select <strong>Share</strong>, add your colleagues and select <strong>Save</strong>."],
        ],
        note: "Sharing shows your personal events and tasks to the people you add. Everyone sees school events anyway.",
      },
      {
        title: "Mira and your calendar",
        text: "Mira, Managira's assistant, can read your calendar, find a free time and add a meeting to your own calendar when you ask.",
      },
    ],
    faq: [
      ["Why can't I see the School events layer's Create option?", "Posting a school event needs <strong>Publish Events &amp; Announcements</strong>. Without it you can add personal events and tasks."],
      ["Where are announcements on the calendar?", "Announcements aren't on the calendar. They show on dashboards and in the parent portal."],
    ],
    related: ["calendar-sync-google-outlook-apple", "events-announcements-notifications", "activities"],
  },

  {
    slug: "calendar-sync-google-outlook-apple",
    title: "Sync your calendar with Google, Outlook or Apple",
    topic: TOPIC,
    order: 4,
    summary: "Staff send their Managira calendar to Google Calendar or Outlook in one step. Parents and students add their family calendar to their phone.",
    tags: ["calendar sync", "google calendar", "outlook", "apple calendar", "ical", "subscribe", "calendar not updating", "calendar not syncing", "reconnect", "disconnect"],
    who: "Staff, parents and students.",
    intro: "Managira can put your calendar on your phone and computer's calendar app, so you see school dates where you already look.",
    sections: [
      {
        title: "For staff: Google Calendar and Outlook",
        steps: [
          ["In <strong>Calendar</strong>, select <strong>Sync</strong>."],
          "In the Calendar sync window, select the button beside Google Calendar or Outlook, sign in with Google or Microsoft, and allow Managira to add its calendar.",
          "You return to Managira and the window says <strong>Connected</strong>, with your account.",
          "In Google Calendar or Outlook there is now a calendar named <strong>Managira · your school's name</strong>. It holds your school events, activities, personal events, tasks and, for the next 8 weeks, your classes, bus runs and birthdays.",
        ],
        list: [
          "It is one way. Managira adds only to its own calendar and never reads or changes your other events.",
          "Changes you make in Managira reach it within seconds, and everything else within 10 minutes, even when you aren't signed in.",
          "Select <strong>Disconnect</strong> to remove the calendar from your account. Nothing in Managira is deleted.",
          "If it says <strong>Reconnect needed</strong>, access expired or was removed. Select the button and sign in again.",
        ],
        note: "The Calendar sync window lists only the providers set up for your school's Managira, so you may see one or both. Google is asked only to create and fill the Managira calendar.",
      },
      {
        title: "For parents and students",
        steps: [
          "Open <strong>Calendar</strong> in the parent or student portal.",
          "Select <strong>Add to my calendar</strong> and choose <strong>Google Calendar</strong>, <strong>Outlook</strong>, <strong>Outlook.com</strong> or <strong>Apple Calendar</strong>.",
          ["Confirm in the calendar app. Classes, activities, school events and work closing dates appear on the phone and stay up to date.", "parent-calendar.webp", "The parent calendar: every child's classes, activities and school events."],
        ],
      },
    ],
    faq: [
      ["My calendar isn't updating.", "Open <strong>Sync</strong> in Managira: it should say it is up to date. In Google Calendar or Outlook, make sure the Managira calendar is checked in your list of calendars. If you deleted it, Managira makes it again with the next change."],
      ["It says Reconnect needed. What do I do?", "Your access expired, or you or your Google or Microsoft administrator removed it. Select the button again and sign in. Nothing is lost."],
      ["Can I share my calendar with a colleague?", "Yes, inside Managira. Select <strong>Share</strong> in Calendar. See " + link("staff-calendar-and-tasks", "Your calendar and tasks") + "."],
    ],
    related: ["staff-calendar-and-tasks", "activities", "parent-portal"],
  },
];
